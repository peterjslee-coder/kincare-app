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
 * Uses Twilio Video SDK loaded via CDN (window.Twilio.Video).
 */
const VideoCallOverlay = window.VideoCallOverlay = ({ callState, onEndCall, currentUserId }) => {
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

        // Check if Twilio Video SDK is loaded — try multiple CDNs if needed
        if (!window.Twilio || !window.Twilio.Video) {
          const cdnUrls = [
            'https://sdk.twilio.com/js/video/releases/2.28.1/twilio-video.min.js',
            'https://unpkg.com/twilio-video@2.28.1/dist/twilio-video.min.js',
            'https://cdn.jsdelivr.net/npm/twilio-video@2.28.1/dist/twilio-video.min.js',
          ];
          let loaded = false;
          for (const cdnUrl of cdnUrls) {
            if (window.Twilio && window.Twilio.Video) { loaded = true; break; }
            try {
              await new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = cdnUrl;
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
              });
              if (window.Twilio && window.Twilio.Video) { loaded = true; break; }
            } catch { /* try next CDN */ }
          }
          if (!loaded || !window.Twilio || !window.Twilio.Video) {
            throw new Error('Video SDK could not be loaded from any source. Check your internet connection and try again.');
          }
        }

        const Video = window.Twilio.Video;

        // Connect to room with wide-angle video constraints
        const connectOptions = {
          name: callState.roomName,
          audio: true,
          video: callState.callType === 'video' ? {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          } : false,
          dominantSpeaker: true,
        };

        const twilioRoom = await Video.connect(token, connectOptions);

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
          handleParticipantConnected(participant);
          setRemoteConnected(true);
          setStatus('connected');
          startTimer();
        });

        twilioRoom.on('participantDisconnected', () => {
          setRemoteConnected(false);
          clearRemoteVideo();
          // End call when remote disconnects
          setTimeout(() => {
            handleEndCall();
          }, 1500);
        });

        twilioRoom.on('disconnected', () => {
          setStatus('ended');
          stopTimer();
        });

        // If there are already participants, we're connected
        if (twilioRoom.participants.size > 0) {
          setRemoteConnected(true);
          setStatus('connected');
          startTimer();
        }

      } catch (err) {
        if (!cancelled) {
          console.error('[VideoCall] Connection error:', err);
          setError(err.message);
          setStatus('ended');
        }
      }
    }

    connectToRoom();

    return () => {
      cancelled = true;
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
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
      document.body.appendChild(audioEl);
      audioEl.setAttribute('data-twilio-remote-audio', 'true');
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

  function handleEndCall() {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
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
        top: 16,
        right: 16,
        width: 120,
        height: 160,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor: '#333',
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
              background: '#1b6b5a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              color: 'white',
              fontWeight: 700,
            }
          }, (callState.remoteParticipantName || '?')[0]?.toUpperCase()),
      React.createElement('div', {
        style: { color: 'white', fontSize: 22, fontWeight: 600 }
      }, callState.remoteParticipantName || 'Unknown'),
      React.createElement('div', {
        style: { color: 'rgba(255,255,255,0.6)', fontSize: 14 }
      }, status === 'connecting' ? 'Connecting...'
        : status === 'ringing' ? 'Ringing...'
        : status === 'connected' ? formatDuration(callDuration)
        : 'Call ended')
    ),

    // Video call status overlay (top center)
    isVideo && React.createElement('div', {
      style: {
        position: 'absolute',
        top: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        color: 'white',
        fontSize: 14,
        backgroundColor: 'rgba(0,0,0,0.5)',
        padding: '6px 16px',
        borderRadius: 20,
        zIndex: 10001,
      }
    }, status === 'connecting' ? 'Connecting...'
      : status === 'ringing' ? `Calling ${callState.remoteParticipantName || ''}...`
      : status === 'connected' ? formatDuration(callDuration)
      : 'Call ended'),

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
        bottom: 115,
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
        style: { color: 'white', fontSize: 12, minWidth: 20 },
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
          accentColor: '#1b6b5a',
          cursor: 'pointer',
        }
      }),
      React.createElement('span', {
        style: { color: 'white', fontSize: 12, minWidth: 32 },
      }, zoomLevel.toFixed(1) + 'x')
    ),

    // CSS-based zoom fallback for devices without native zoom
    isVideo && !zoomSupported && status === 'connected' && React.createElement('div', {
      style: {
        position: 'absolute',
        bottom: 115,
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
            backgroundColor: zoomLevel === z ? '#1b6b5a' : 'rgba(255,255,255,0.2)',
            color: 'white',
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
    React.createElement('div', {
      style: {
        position: 'absolute',
        bottom: 40,
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
          color: 'white',
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
          ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.36 2.18"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
          : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>'
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
          color: 'white',
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
          ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m2-2h8a2 2 0 0 1 2 2v9.34m-2.66 2.66H3"/><path d="M16 16v-2a2 2 0 0 0-2-2H9.5"/></svg>'
          : '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>'
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
          color: 'white',
          fontSize: 22,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 0.2s',
        }
      }, React.createElement('span', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', transform: 'rotate(135deg)' },
        dangerouslySetInnerHTML: { __html: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' }
      }))
    )
  );
};
