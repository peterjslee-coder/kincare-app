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
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const roomRef = useRef(null);
  const timerRef = useRef(null);

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

        // Check if Twilio Video SDK is loaded
        if (!window.Twilio || !window.Twilio.Video) {
          throw new Error('Video SDK not loaded — please refresh the page');
        }

        const Video = window.Twilio.Video;

        // Connect to room
        const connectOptions = {
          name: callState.roomName,
          audio: true,
          video: callState.callType === 'video',
          dominantSpeaker: true,
        };

        const twilioRoom = await Video.connect(token, connectOptions);

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
      ref.current.appendChild(track.attach());
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
      setCallDuration(d => d + 1);
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
    if (onEndCall) onEndCall();
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
      React.createElement('div', {
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
      }, isMuted ? '🔇' : '🎤'),

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
      }, isCameraOff ? '📷' : '📹'),

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
      }, '📞')
    )
  );
};
