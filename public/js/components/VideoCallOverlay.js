/**
 * VideoCallOverlay — In-app video/voice calling via Twilio Video
 *
 * Props:
 *   callState: { active, roomName, callType, remoteParticipantName, callDirection }
 *   onEndCall: () => void
 *   currentUserId: string
 *
 * Call types: 'video' or 'voice' (voice = video room with camera off)
 *
 * Uses Twilio Video SDK loaded from self-hosted /vendor/ (window.Twilio.Video).
 */
const VideoCallOverlay = window.VideoCallOverlay = ({ callState, onEndCall, currentUserId, ringStatus }) => {
  const [status, setStatus] = useState('connecting'); // connecting | ringing | connected | ended
  const [room, setRoom] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(callState?.callType === 'voice');
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [error, setError] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomSupported, setZoomSupported] = useState(false);
  const [zoomRange, setZoomRange] = useState({ min: 1, max: 5, step: 0.1 });
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roomRef = useRef(null);
  const timerRef = useRef(null);
  const durationRef = useRef(0);
  const localTrackRef = useRef(null);
  // v1.105.140 — tracks WE acquired with getUserMedia. Twilio stops the tracks it creates
  // itself; tracks handed to it are ours to stop. Miss this and the microphone indicator
  // stays lit after the call ends, which is the single worst bug a care app could ship.
  const acquiredTracksRef = useRef([]);
  // v1.105.160 — see the incoming-call branch below.
  const emptyRoomTimer = useRef(null);
  // ─── v1.105.173 — a web call has to survive a minute on an iPhone ───
  //
  // Sara called Pete on voice: "it worked for a minute but then went quiet." She is on the
  // WEB app, and an iPhone's Auto-Lock is 30 seconds or a minute. When an iOS web page is
  // backgrounded or the screen locks, Safari suspends it and WebRTC media stops dead. The
  // native app can hold a call in the background; a page cannot — unless it asks the screen
  // to stay on, which we never did.
  const wakeLockRef = useRef(null);
  // Media dropped and the SDK is retrying. Distinct from 'connecting' (never been up) and
  // from 'ended' (over) — the person needs to know it is coming back rather than gone.
  const [reconnecting, setReconnecting] = useState(false);
  // iOS refuses to autoplay a media element created outside a user gesture. The FIRST attach
  // rides in on the tap that answered the call; a re-attach after any interruption does not,
  // and fails silently — a call that looks connected and is inaudible, permanently.
  const [audioBlocked, setAudioBlocked] = useState(false);
  // A remote who vanishes might be gone, or might be switching from wifi to cellular.
  const remoteGraceTimer = useRef(null);

  // ─── v1.105.173 — the lock is dropped every time the page is hidden ───
  //
  // Take it again on the way back, and use the same moment to ask the audio to resume: iOS
  // suspends media with the page, and coming back is a user-initiated event, which is exactly
  // the gesture autoplay wanted.
  useEffect(() => {
    if (!callState?.active) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      requestWakeLock();
      resumeAudio();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [callState?.active]);

  // Connect to Twilio room on mount
  useEffect(() => {
    if (!callState?.active || !callState?.roomName) return;

    let cancelled = false;

    async function connectToRoom() {
      try {
        setStatus('connecting');

        // Get token from backend
        const tokenRes = await apiFetch('/api/video/token', {
          method: 'POST',
          body: JSON.stringify({ roomName: callState.roomName }),
        });

        if (!tokenRes?.ok) {
          const errData = await tokenRes.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to get video token');
        }

        const { token } = await tokenRes.json();

        if (cancelled) return;

        // Check if Twilio Video SDK is loaded — self-hosted primary, CDN fallback
        if (!window.Twilio || !window.Twilio.Video) {
          const sdkUrls = [
            '/vendor/twilio-video.min.js',  // self-hosted (primary)
            'https://sdk.twilio.com/js/video/releases/2.28.1/twilio-video.min.js',
            'https://unpkg.com/twilio-video@2.28.1/dist/twilio-video.min.js',
            'https://cdn.jsdelivr.net/npm/twilio-video@2.28.1/dist/twilio-video.min.js',
          ];
          let loaded = false;
          for (const url of sdkUrls) {
            if (window.Twilio && window.Twilio.Video) { loaded = true; break; }
            try {
              await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = url;
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
              });
              if (window.Twilio && window.Twilio.Video) { loaded = true; break; }
            } catch { /* try next source */ }
          }
          if (!loaded || !window.Twilio || !window.Twilio.Video) {
            throw new Error('Video SDK could not be loaded. Please refresh the page and try again.');
          }
        }

        const Video = window.Twilio.Video;

        // Connect to room with wide-angle video constraints
        // ─── v1.105.140 — get the microphone FIRST, and say so when you can't ───
        //
        // Pete: "it tried to connect but still can't." Everything upstream is fine — I probed
        // production from a browser: /api/video/token returns a valid 475-char JWT, the
        // self-hosted SDK loads (2.28.1), and Video.connect with audio:false/video:false
        // reached a real Twilio room. Signalling, CSP and credentials are not the problem.
        //
        // What that probe skipped is the only thing left: local media. Twilio calls
        // getUserMedia inside connect(), so a blocked microphone surfaces as a connect
        // failure with an opaque message — which is exactly "tried to connect but still
        // can't". Asking for the media ourselves, first, turns one unreadable failure into a
        // sentence that names the cause and, where possible, the fix.
        //
        // The tracks are then handed to Twilio rather than released, so the person is not
        // asked for the microphone twice in one call.
        let mediaTracks = null;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          // No API at all: an insecure context, or a WebView that does not expose capture.
          throw new Error('This device won\u2019t let InPlace use the microphone from here. Try the InPlace app, or open yourinplace.com in Safari.');
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: callState.callType === 'video'
              ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }
              : false,
          });
          mediaTracks = stream.getTracks();
          acquiredTracksRef.current = mediaTracks;
        } catch (mediaErr) {
          const name = mediaErr && mediaErr.name;
          const needs = callState.callType === 'video' ? 'camera and microphone' : 'microphone';
          let human;
          if (name === 'NotAllowedError' || name === 'SecurityError') {
            human = `InPlace needs your ${needs} for calls. Allow it in Settings \u2192 InPlace, then try again.`;
          } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
            human = `No ${needs} was found on this device.`;
          } else if (name === 'NotReadableError' || name === 'AbortError') {
            human = `Something else is using your ${needs}. Close it and try again.`;
          } else {
            human = `Couldn\u2019t reach your ${needs} (${name || 'unknown error'}).`;
          }
          // Report it: a call that fails is exactly the thing nobody sends feedback about
          // twice, and the error NAME is the whole diagnosis.
          try {
            if (typeof reportClientError === 'function') {
              reportClientError(mediaErr, {
                page: 'call',
                callType: callState.callType,
                mediaErrorName: name || 'unknown',
                standalone: !!(window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches),
                capacitor: !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()),
              });
            }
          } catch { /* reporting must never be what breaks the call */ }
          throw new Error(human);
        }

        const connectOptions = {
          name: callState.roomName,
          // The tracks acquired above, not another request for them.
          tracks: mediaTracks,
          dominantSpeaker: true,
        };

        // v1.105.139 — a connect that never resolves used to leave a full-screen black
        // overlay saying "Connecting..." with no end to it. Twilio's own default has no
        // deadline, and neither did we. 30s, then say so, so the person is looking at an
        // error with a way out instead of at a call they think is still trying.
        const twilioRoom = await Promise.race([
          Video.connect(token, connectOptions),
          new Promise((_, reject) => setTimeout(
            () => reject(new Error("Couldn't connect the call. Check your signal and try again.")),
            30000
          )),
        ]);

        // Detect camera zoom capability for local video track
        if (callState.callType === 'video') {
          twilioRoom.localParticipant.videoTracks.forEach(publication => {
            if (publication.track) {
              localTrackRef.current = publication.track;
              try {
                const mediaTrack = publication.track.mediaStreamTrack;
                const caps = mediaTrack.getCapabilities ? mediaTrack.getCapabilities() : {};
                if (caps.zoom) {
                  setZoomSupported(true);
                  setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1 });
                  // Reset to minimum zoom (widest angle)
                  mediaTrack.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] }).catch(() => {});
                  setZoomLevel(caps.zoom.min);
                }
              } catch (e) { /* zoom not supported */ }
            }
          });
        }

        if (cancelled) {
          twilioRoom.disconnect();
          return;
        }

        roomRef.current = twilioRoom;
        setRoom(twilioRoom);
        setStatus(callState.callDirection === 'outgoing' ? 'ringing' : 'connected');
        // v1.105.173 — from the moment we are in the room, not from the moment someone
        // answers: a phone that locks while it is still ringing has the same problem.
        requestWakeLock();

        // Attach local tracks
        twilioRoom.localParticipant.tracks.forEach(publication => {
          if (publication.track) {
            attachTrack(publication.track, 'local');
          }
        });

        // Handle existing remote participants
        twilioRoom.participants.forEach(participant => {
          handleParticipantConnected(participant);
        });

        // Handle new remote participants
        twilioRoom.on('participantConnected', participant => {
          clearEmptyRoomTimer(); // they are here after all
          clearRemoteGrace();    // ...or back after all
          setReconnecting(false);
          handleParticipantConnected(participant);
          setRemoteConnected(true);
          setStatus('connected');
          startTimer();
          requestWakeLock();
        });

        // ─── v1.105.173 — 1.5 seconds was not a grace period, it was a hang-up ───
        //
        // A remote who vanishes might have hung up, or might be a phone changing from wifi to
        // cellular in a hallway. Ending the call in a second and a half makes those two the
        // same thing. Now it waits, says "Reconnecting…", and only gives up if they really
        // have not come back — and any participantConnected cancels it.
        twilioRoom.on('participantDisconnected', () => {
          if (cancelled) return;
          setRemoteConnected(false);
          clearRemoteVideo();
          setReconnecting(true);
          clearRemoteGrace();
          remoteGraceTimer.current = setTimeout(() => {
            if (cancelled) return;
            const room = roomRef.current;
            if (room && room.participants.size === 0) handleEndCall();
            else setReconnecting(false);
          }, 12000);
        });

        // ─── v1.105.173 — a dropped connection is not a finished call ───
        //
        // Twilio retries signalling and media on its own; until now nothing listened, so the
        // screen kept showing a running timer over a call that had gone silent. These say so,
        // and the re-attach on 'reconnected' is what gets the audio back — see attachTrack.
        twilioRoom.on('reconnecting', () => {
          if (cancelled) return;
          setReconnecting(true);
        });
        twilioRoom.on('reconnected', () => {
          if (cancelled) return;
          setReconnecting(false);
          clearRemoteGrace();
          // The tracks survive a reconnect but their audio elements may have been suspended
          // by iOS while the page was hidden. Ask them to play again; if the browser refuses,
          // audioBlocked puts a button on screen.
          resumeAudio();
          requestWakeLock();
        });

        twilioRoom.on('disconnected', () => {
          setStatus('ended');
          stopTimer();
          releaseWakeLock();
        });

        // If there are already participants, we're connected
        if (twilioRoom.participants.size > 0) {
          setRemoteConnected(true);
          setStatus('connected');
          startTimer();
        } else if (callState.callDirection === 'incoming') {
          // ─── v1.105.160 — answering a call the caller has already left ───
          //
          // Pete: "it showed her where to tap to accept the call but nothing happened when she
          // hit it." Two things made that. Her ringing banner did not clear when he hung up
          // (fixed in Messages.js), and if she tapped Accept anyway she joined an empty room
          // and sat on "Connecting…" — technically connected, to nobody, forever.
          //
          // Answering means the caller should ALREADY be in the room. Empty is not "not yet",
          // it is "gone". A short grace for the hand-off, then say so plainly instead of
          // spinning.
          emptyRoomTimer.current = setTimeout(() => {
            if (cancelled) return;
            const room = roomRef.current;
            if (room && room.participants.size === 0) {
              setError(`${callState.remoteParticipantName || 'They'} already hung up.`);
              handleEndCall();
            }
          }, 8000);
        }

      } catch (err) {
        if (!cancelled) {
          console.error('[VideoCall] Connection error:', err);
          // The call is not happening; nothing should still be holding the microphone.
          (acquiredTracksRef.current || []).forEach((t) => {
            try { if (t && t.readyState !== 'ended') t.stop(); } catch { /* already gone */ }
          });
          acquiredTracksRef.current = [];
          setError(err.message);
          setStatus('ended');
        }
      }
    }

    connectToRoom();

    return () => {
      cancelled = true;
      releaseWakeLock();
      if (remoteGraceTimer.current) { clearTimeout(remoteGraceTimer.current); remoteGraceTimer.current = null; }
      if (emptyRoomTimer.current) { clearTimeout(emptyRoomTimer.current); emptyRoomTimer.current = null; }
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
      // Unmounting is also a way to end a call — the microphone must go off here too, not
      // only down the handleEndCall path.
      (acquiredTracksRef.current || []).forEach((t) => {
        try { if (t && t.readyState !== 'ended') t.stop(); } catch { /* already gone */ }
      });
      acquiredTracksRef.current = [];
      stopTimer();
    };
  }, [callState?.active, callState?.roomName]);

  function handleParticipantConnected(participant) {
    participant.tracks.forEach(publication => {
      if (publication.isSubscribed && publication.track) {
        attachTrack(publication.track, 'remote');
      }
    });
    participant.on('trackSubscribed', track => {
      attachTrack(track, 'remote');
    });
    participant.on('trackUnsubscribed', track => {
      detachTrack(track, 'remote');
    });
    // v1.105.173 — the remote side's own reconnect, which is the common case on a phone that
    // changes network. Their tracks come back; their audio element has to be asked to play.
    if (typeof participant.on === 'function') {
      participant.on('reconnecting', () => setReconnecting(true));
      participant.on('reconnected', () => { setReconnecting(false); resumeAudio(); });
    }
  }

  function attachTrack(track, type) {
    const ref = type === 'local' ? localVideoRef : remoteVideoRef;
    if (ref.current && track.kind === 'video') {
      ref.current.innerHTML = '';
      const videoEl = track.attach();
      // Prevent zoomed-in cropping — fit entire frame in view
      videoEl.style.width = '100%';
      videoEl.style.height = '100%';
      videoEl.style.objectFit = type === 'local' ? 'cover' : 'contain';
      ref.current.appendChild(videoEl);
    }
    if (type === 'remote' && track.kind === 'audio') {
      const audioEl = track.attach();
      // v1.105.173 — playsInline stops iOS taking the element fullscreen; autoplay is the
      // hint, playRemoteAudio is what actually finds out whether it worked.
      audioEl.setAttribute('playsinline', 'true');
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);
      audioEl.setAttribute('data-twilio-remote-audio', 'true');
      playRemoteAudio(audioEl);
    }
  }

  function detachTrack(track, type) {
    track.detach().forEach(el => el.remove());
  }

  function clearRemoteVideo() {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.innerHTML = '';
    }
    document.querySelectorAll('[data-twilio-remote-audio]').forEach(el => el.remove());
  }

  function startTimer() {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      setCallDuration(d => { durationRef.current = d + 1; return d + 1; });
    }, 1000);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function clearRemoteGrace() {
    if (remoteGraceTimer.current) { clearTimeout(remoteGraceTimer.current); remoteGraceTimer.current = null; }
  }

  function clearEmptyRoomTimer() {
    if (emptyRoomTimer.current) { clearTimeout(emptyRoomTimer.current); emptyRoomTimer.current = null; }
  }

  // ─── Keep the screen awake for the duration of the call (v1.105.173) ───
  //
  // iOS 16.4+ and Chrome support the Screen Wake Lock API. Where it does not exist there is
  // nothing to be done from a web page, so this degrades to exactly today's behaviour rather
  // than throwing. The lock is released by the browser whenever the page is hidden, so it has
  // to be re-taken on visibilitychange — asking once is asking for the first minute only.
  async function requestWakeLock() {
    try {
      if (!navigator.wakeLock || wakeLockRef.current) return;
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockRef.current.addEventListener('release', () => { wakeLockRef.current = null; });
    } catch { /* denied or unsupported — the call still works, the screen may sleep */ }
  }

  function releaseWakeLock() {
    try { if (wakeLockRef.current) wakeLockRef.current.release(); } catch {}
    wakeLockRef.current = null;
  }

  // Play a remote audio element and notice when the browser refuses. `play()` returns a
  // promise that REJECTS on an autoplay block; ignoring it is how a call goes silent with no
  // error anywhere.
  function playRemoteAudio(el) {
    try {
      const r = el.play();
      if (r && typeof r.catch === 'function') {
        r.then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true));
      }
    } catch { setAudioBlocked(true); }
  }

  // The way out of an autoplay block: one tap, which is a gesture, which is all iOS wanted.
  function resumeAudio() {
    document.querySelectorAll('[data-twilio-remote-audio]').forEach((el) => playRemoteAudio(el));
  }

  function stopAcquiredTracks() {
    (acquiredTracksRef.current || []).forEach((t) => {
      try { if (t && t.readyState !== 'ended') t.stop(); } catch { /* already gone */ }
    });
    acquiredTracksRef.current = [];
  }

  function handleEndCall() {
    clearEmptyRoomTimer();
    clearRemoteGrace();
    releaseWakeLock();
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    stopAcquiredTracks();
    stopTimer();
    clearRemoteVideo();
    document.querySelectorAll('[data-twilio-remote-audio]').forEach(el => el.remove());
    setStatus('ended');
    if (onEndCall) onEndCall(durationRef.current || 0);
  }

  function toggleMute() {
    if (!roomRef.current) return;
    roomRef.current.localParticipant.audioTracks.forEach(publication => {
      if (isMuted) {
        publication.track.enable();
      } else {
        publication.track.disable();
      }
    });
    setIsMuted(!isMuted);
  }

  function toggleCamera() {
    if (!roomRef.current) return;
    roomRef.current.localParticipant.videoTracks.forEach(publication => {
      if (isCameraOff) {
        publication.track.enable();
      } else {
        publication.track.disable();
      }
    });
    setIsCameraOff(!isCameraOff);
  }

  function handleZoomChange(newZoom) {
    const val = parseFloat(newZoom);
    setZoomLevel(val);
    if (localTrackRef.current) {
      try {
        const mediaTrack = localTrackRef.current.mediaStreamTrack;
        mediaTrack.applyConstraints({ advanced: [{ zoom: val }] }).catch(() => {});
      } catch (e) { /* zoom not supported */ }
    }
  }

  function formatDuration(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  if (!callState?.active) return null;

  const isVideo = callState.callType === 'video';

  // ─── v1.105.141 — say whether it actually rang ───
  //
  // Pete: "Julia didn't pick up, not sure if it rang on her side or she's just not
  // available." Until now the caller saw "Ringing…" whether the invite reached her open app,
  // went out as a push, or reached nothing at all — three very different facts wearing one
  // word. The server answers the invite now (server.js `call_ring_status`) and this is that
  // answer, in plain language. Only while the call is still unanswered: once someone picks
  // up, how it rang stops mattering.
  const who = callState.remoteParticipantName || 'They';
  const ringLine = (status === 'connected' || callState.callDirection !== 'outgoing') ? null
    : ringStatus === 'app' ? `${who} has InPlace open — it's ringing on their screen.`
    : ringStatus === 'push' ? `${who} isn't in the app. We've sent a notification to their phone.`
    : ringStatus === 'nowhere' ? `${who} has no device set up for notifications. They'll see a missed call in InPlace.`
    : null;

  return React.createElement('div', {
    style: {
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: isVideo ? '#000' : 'rgba(0,0,0,0.92)',
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
    }
  },
    // Remote video (full screen background for video calls)
    isVideo && React.createElement('div', {
      ref: remoteVideoRef,
      style: {
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        backgroundColor: '#000',
      }
    }),

    // Local video preview (small picture-in-picture for video calls)
    isVideo && React.createElement('div', {
      ref: localVideoRef,
      style: {
        position: 'absolute',
        top: 'calc(16px + var(--sat, 0px))',
        right: 16,
        width: 120,
        height: 160,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: 'var(--text-primary)',
        zIndex: 10001,
        border: '2px solid rgba(255,255,255,0.3)',
      }
    }),

    // Voice call — centered avatar/name area
    !isVideo && React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        zIndex: 10001,
      }
    },
      callState.remoteParticipantPhoto
        ? React.createElement('img', {
            src: callState.remoteParticipantPhoto,
            style: {
              width: 96,
              height: 96,
              borderRadius: '50%',
              objectFit: 'cover',
            }
          })
        : React.createElement('div', {
            style: {
              width: 96,
              height: 96,
              borderRadius: '50%',
              background: 'var(--role-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              color: 'var(--text-on-primary)',
              fontWeight: 700,
            }
          }, (callState.remoteParticipantName || '?')[0]?.toUpperCase()),
      React.createElement('div', {
        style: { color: 'var(--text-on-primary)', fontSize: 22, fontWeight: 600 }
      }, callState.remoteParticipantName || 'Unknown'),
      React.createElement('div', {
        style: { color: 'rgba(255,255,255,0.6)', fontSize: 14 }
      }, reconnecting ? 'Reconnecting\u2026'
        : status === 'connecting' ? 'Connecting...'
        : status === 'ringing' ? 'Ringing...'
        : status === 'connected' ? formatDuration(callDuration)
        : 'Call ended'),
      // v1.105.173 — a call the browser has muted on us. It looks connected and it is
      // inaudible, so it has to say so, and the tap that dismisses it is the gesture iOS
      // was holding out for.
      audioBlocked && React.createElement('button', {
        onClick: resumeAudio,
        style: {
          marginTop: 10, padding: '10px 18px', borderRadius: 999, border: 'none',
          background: 'var(--color-warning, #e65100)', color: '#fff',
          fontSize: 14, fontWeight: 700, cursor: 'pointer',
        },
      }, '\uD83D\uDD08 Tap to hear them'),
      // v1.105.141 — what actually happened to the invite. See ringLine().
      ringLine && React.createElement('div', {
        style: { color: 'rgba(255,255,255,0.55)', fontSize: 12.5, maxWidth: 260, textAlign: 'center', lineHeight: 1.4 }
      }, ringLine)
    ),

    // Video call status overlay (top center)
    isVideo && React.createElement('div', {
      style: {
        position: 'absolute',
        top: 'calc(20px + var(--sat, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        color: 'var(--text-on-primary)',
        fontSize: 14,
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: '6px 16px',
        borderRadius: 20,
        zIndex: 10001,
      }
    }, reconnecting ? 'Reconnecting\u2026'
      : status === 'connecting' ? 'Connecting...'
      : status === 'ringing' ? `Calling ${callState.remoteParticipantName || ''}...`
      : status === 'connected' ? formatDuration(callDuration)
      : 'Call ended'),

    // v1.105.173 — the same "we have gone quiet on you" button, on a video call.
    isVideo && audioBlocked && React.createElement('button', {
      onClick: resumeAudio,
      style: {
        position: 'absolute',
        top: 'calc(96px + var(--sat, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '10px 18px', borderRadius: 999, border: 'none',
        background: 'var(--color-warning, #e65100)', color: '#fff',
        fontSize: 14, fontWeight: 700, cursor: 'pointer', zIndex: 10002,
      },
    }, '\uD83D\uDD08 Tap to hear them'),

    // v1.105.141 — the same honest line, for a video call
    isVideo && ringLine && React.createElement('div', {
      style: {
        position: 'absolute',
        top: 'calc(56px + var(--sat, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        color: 'rgba(255,255,255,0.75)',
        fontSize: 12.5,
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: '5px 14px',
        borderRadius: 16,
        maxWidth: '80%',
        textAlign: 'center',
        zIndex: 10001,
      }
    }, ringLine),

    // Error message
    error && React.createElement('div', {
      style: {
        color: '#ff6b6b',
        fontSize: 14,
        padding: '8px 16px',
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 8,
        marginBottom: 20,
        zIndex: 10001,
      }
    }, error),

    // Zoom slider (above controls, video calls only)
    isVideo && zoomSupported && status === 'connected' && React.createElement('div', {
      style: {
        position: 'absolute',
        bottom: 'calc(115px + var(--sab, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: '8px 16px',
        borderRadius: 20,
        zIndex: 10001,
      }
    },
      React.createElement('span', {
        style: { color: 'var(--text-on-primary)', fontSize: 12, minWidth: 20 },
      }, '🔍'),
      React.createElement('input', {
        type: 'range',
        min: zoomRange.min,
        max: zoomRange.max,
        step: zoomRange.step,
        value: zoomLevel,
        onChange: (e) => handleZoomChange(e.target.value),
        style: {
          width: 140,
          accentColor: 'var(--role-color)',
          cursor: 'pointer',
        }
      }),
      React.createElement('span', {
        style: { color: 'var(--text-on-primary)', fontSize: 12, minWidth: 32 },
      }, zoomLevel.toFixed(1) + 'x')
    ),

    // CSS-based zoom fallback for devices without native zoom
    isVideo && !zoomSupported && status === 'connected' && React.createElement('div', {
      style: {
        position: 'absolute',
        bottom: 'calc(115px + var(--sab, 0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: '8px 16px',
        borderRadius: 20,
        zIndex: 10001,
      }
    },
      React.createElement('span', {
        style: { color: 'rgba(255,255,255,0.6)', fontSize: 11 }
      }, 'Wide angle'),
      ...[1, 1.5, 2].map(z =>
        React.createElement('button', {
          key: z,
          onClick: () => {
            setZoomLevel(z);
            // Apply CSS transform zoom to local video
            if (localVideoRef.current) {
              const vid = localVideoRef.current.querySelector('video');
              if (vid) vid.style.transform = `scale(${z})`;
            }
          },
          style: {
            padding: '4px 10px',
            borderRadius: 12,
            border: 'none',
            backgroundColor: zoomLevel === z ? 'var(--role-color)' : 'rgba(255,255,255,0.2)',
            color: 'var(--text-on-primary)',
            fontSize: 12,
            fontWeight: zoomLevel === z ? 700 : 400,
            cursor: 'pointer',
          }
        }, z + 'x')
      ),
      React.createElement('span', {
        style: { color: 'rgba(255,255,255,0.6)', fontSize: 11 }
      }, 'Close up')
    ),

    // Controls bar (bottom)
    // v1.105.139 — Pete: "Phone call in app looks terrible and hidden behind bottom row" and
    // "Video call froze the app had to close out and relaunch." Those are one bug. The whole
    // overlay was laid out against the raw viewport, so on an iPhone the End Call button sat
    // in the home-indicator strip — and a call you cannot hang up IS a frozen app; relaunching
    // was the only exit he had.
    React.createElement('div', {
      style: {
        position: 'absolute',
        bottom: 'calc(40px + var(--sab, 0px))',
        display: 'flex',
        gap: 20,
        zIndex: 10001,
      }
    },
      // Mute button
      React.createElement('button', {
        onClick: toggleMute,
        title: isMuted ? 'Unmute' : 'Mute',
        style: {
          width: 56, height: 56,
          borderRadius: '50%',
          border: 'none',
          backgroundColor: isMuted ? '#ff4444' : 'rgba(255,255,255,0.2)',
          color: 'var(--text-on-primary)',
          fontSize: 22,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.2s',
        }
      }, React.createElement('span', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
        dangerouslySetInnerHTML: { __html: isMuted
          ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bg-surface)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.36 2.18"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
          : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bg-surface)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
        }
      })),

      // Camera toggle (video calls only)
      isVideo && React.createElement('button', {
        onClick: toggleCamera,
        title: isCameraOff ? 'Turn camera on' : 'Turn camera off',
        style: {
          width: 56, height: 56,
          borderRadius: '50%',
          border: 'none',
          backgroundColor: isCameraOff ? '#ff4444' : 'rgba(255,255,255,0.2)',
          color: 'var(--text-on-primary)',
          fontSize: 22,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.2s',
        }
      }, React.createElement('span', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
        dangerouslySetInnerHTML: { __html: isCameraOff
          ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bg-surface)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m2-2h8a2 2 0 0 1 2 2v9.34m-2.66 2.66H3"/><path d="M16 16v-2a2 2 0 0 0-2-2H9.5"/></svg>'
          : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bg-surface)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
        }
      })),

      // End call button
      React.createElement('button', {
        onClick: handleEndCall,
        title: 'End call',
        style: {
          width: 56, height: 56,
          borderRadius: '50%',
          border: 'none',
          backgroundColor: '#e74c3c',
          color: 'var(--text-on-primary)',
          fontSize: 22,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.2s',
        }
      }, React.createElement('span', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(135deg)' },
        dangerouslySetInnerHTML: { __html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--bg-surface)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' }
      }))
    )
  );
};
