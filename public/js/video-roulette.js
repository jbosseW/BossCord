// video-roulette.js — Random 1-on-1 video chat (Omegle-style)
// Part of BossCord

// Add spin keyframe animation for waiting spinner
(function() {
  if (!document.getElementById('roulette-styles')) {
    var style = document.createElement('style');
    style.id = 'roulette-styles';
    style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }
})();

function RouletteView() {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var [status, setStatus] = useState('idle'); // 'idle' | 'waiting' | 'connected'
  var [partnerName, setPartnerName] = useState('');
  var [partnerColor, setPartnerColor] = useState('#f0b232');
  var [error, setError] = useState(null);
  var [consentChecked, setConsentChecked] = useState(false);
  var localVideoRef = useRef(null);
  var remoteVideoRef = useRef(null);
  var pcRef = useRef(null);
  var localStreamRef = useRef(null);
  var remoteStreamRef = useRef(null);
  var mountedRef = useRef(true);

  var iceServers = useMemo(function() {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }, []);

  // Attach local stream to video element after render
  useEffect(function() {
    if (localVideoRef.current && localStreamRef.current) {
      if (localVideoRef.current.srcObject !== localStreamRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    }
  });

  // Attach remote stream to video element after render
  useEffect(function() {
    if (remoteVideoRef.current && remoteStreamRef.current) {
      if (remoteVideoRef.current.srcObject !== remoteStreamRef.current) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
    }
  });

  // Cleanup function — tears down peer connection and local media
  var cleanup = useCallback(function() {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch(e) {}
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(function(t) { t.stop(); });
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  }, []);

  // Cleanup on unmount
  useEffect(function() {
    mountedRef.current = true;
    return function() {
      mountedRef.current = false;
      cleanup();
      if (ctx.socket) ctx.socket.emit('roulette_leave');
    };
  }, []);

  // Handle incoming WebRTC signal data
  function handleSignal(data) {
    var signal = data.signal;
    if (!signal || !pcRef.current) return;
    var pc = pcRef.current;

    if (signal.type === 'offer') {
      pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }))
        .then(function() { return pc.createAnswer(); })
        .then(function(answer) { return pc.setLocalDescription(answer); })
        .then(function() {
          if (ctx.socket) {
            ctx.socket.emit('roulette_signal', {
              signal: { type: 'answer', sdp: pc.localDescription.sdp }
            });
          }
        })
        .catch(function(err) {
          console.error('[Roulette] answer failed:', err.message);
        });
    } else if (signal.type === 'answer') {
      if (pc.signalingState === 'have-local-offer') {
        pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }))
          .catch(function(err) {
            console.error('[Roulette] setRemoteDescription failed:', err.message);
          });
      }
    } else if (signal.type === 'ice-candidate' && signal.candidate) {
      pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(function() {});
    }
  }

  // Set up RTCPeerConnection for a matched partner
  function setupPeerConnection(partnerId, isInitiator) {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch(e) {}
    }

    var pc = new RTCPeerConnection({
      iceServers: iceServers,
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });
    pcRef.current = pc;

    // Add local tracks with bandwidth optimization
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(function(track) {
        var sender = pc.addTrack(track, localStreamRef.current);
        if (sender && sender.getParameters) {
          try {
            var params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
            if (track.kind === 'audio') {
              params.encodings[0].maxBitrate = 32000;
              params.encodings[0].dtx = true;
            } else if (track.kind === 'video') {
              params.encodings[0].maxBitrate = 800000;
              params.degradationPreference = 'maintain-framerate';
            }
            sender.setParameters(params).catch(function() {});
          } catch (e) { /* ignore */ }
        }
      });
    }

    // Prefer VP9 for video, Opus for audio (better compression)
    if (pc.getTransceivers) {
      try {
        pc.getTransceivers().forEach(function(t) {
          if (!t.setCodecPreferences) return;
          var kind = t.sender && t.sender.track ? t.sender.track.kind : null;
          if (!kind) return;
          var caps = RTCRtpReceiver.getCapabilities ? RTCRtpReceiver.getCapabilities(kind) : null;
          if (!caps || !caps.codecs) return;
          if (kind === 'video') {
            var sorted = caps.codecs.slice().sort(function(a, b) {
              var aS = a.mimeType.toLowerCase().indexOf('vp9') !== -1 ? 0 : 1;
              var bS = b.mimeType.toLowerCase().indexOf('vp9') !== -1 ? 0 : 1;
              return aS - bS;
            });
            try { t.setCodecPreferences(sorted); } catch (e) {}
          }
        });
      } catch (e) {}
    }

    // Send ICE candidates to partner via signaling server
    pc.onicecandidate = function(event) {
      if (event.candidate && ctx.socket) {
        ctx.socket.emit('roulette_signal', {
          signal: { type: 'ice-candidate', candidate: event.candidate.toJSON() }
        });
      }
    };

    // Receive remote video/audio track
    pc.ontrack = function(event) {
      var stream = event.streams && event.streams[0];
      if (!stream) {
        stream = new MediaStream([event.track]);
      }
      // Store the remote stream so the useEffect can attach it after re-render
      remoteStreamRef.current = stream;
    };

    // Monitor connection health — ICE restart on failure
    pc.onconnectionstatechange = function() {
      if (pc.connectionState === 'failed') {
        console.warn('[Roulette] ICE restart');
        pc.createOffer({ iceRestart: true })
          .then(function(offer) { return pc.setLocalDescription(offer); })
          .then(function() {
            if (ctx.socket) {
              ctx.socket.emit('roulette_signal', {
                signal: { type: 'offer', sdp: pc.localDescription.sdp }
              });
            }
          })
          .catch(function(err) {
            console.error('[Roulette] ICE restart failed:', err.message);
          });
      }
    };

    // Initiator creates the offer
    if (isInitiator) {
      pc.createOffer().then(function(offer) {
        return pc.setLocalDescription(offer);
      }).then(function() {
        if (ctx.socket) {
          ctx.socket.emit('roulette_signal', {
            signal: { type: 'offer', sdp: pc.localDescription.sdp }
          });
        }
      }).catch(function(err) {
        console.error('[Roulette] createOffer failed:', err.message);
      });
    }
  }

  // Socket event listeners for roulette signaling
  useEffect(function() {
    if (!ctx.socket) return;
    var socket = ctx.socket;

    function onWaiting() {
      if (!mountedRef.current) return;
      setStatus('waiting');
    }

    function onMatched(data) {
      if (!mountedRef.current) return;
      setPartnerName(data.partnerName || 'Stranger');
      setPartnerColor(data.partnerColor || '#f0b232');
      setStatus('connected');
      setupPeerConnection(data.partnerId, data.isInitiator);
    }

    function onSignal(data) {
      if (!mountedRef.current || !pcRef.current) return;
      handleSignal(data);
    }

    function onPartnerLeft() {
      if (!mountedRef.current) return;
      setStatus('waiting');
      setPartnerName('');
      if (pcRef.current) {
        try { pcRef.current.close(); } catch(e) {}
        pcRef.current = null;
      }
      remoteStreamRef.current = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      // Auto-rejoin the queue
      socket.emit('roulette_join');
    }

    function onEnded(data) {
      if (!mountedRef.current) return;
      if (data && data.reason === 'left') {
        setStatus('idle');
        cleanup();
      }
    }

    socket.on('roulette_waiting', onWaiting);
    socket.on('roulette_matched', onMatched);
    socket.on('roulette_signal', onSignal);
    socket.on('roulette_partner_left', onPartnerLeft);
    socket.on('roulette_ended', onEnded);

    return function() {
      socket.off('roulette_waiting', onWaiting);
      socket.off('roulette_matched', onMatched);
      socket.off('roulette_signal', onSignal);
      socket.off('roulette_partner_left', onPartnerLeft);
      socket.off('roulette_ended', onEnded);
    };
  }, [ctx.socket]);

  // Start roulette — request camera/mic then join queue
  function handleStart() {
    setError(null);
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }).then(function(stream) {
      if (!mountedRef.current) {
        stream.getTracks().forEach(function(t) { t.stop(); });
        return;
      }
      localStreamRef.current = stream;
      setStatus('waiting');
      if (ctx.socket) ctx.socket.emit('roulette_join');
    }).catch(function(err) {
      console.error('[Roulette] getUserMedia failed:', err.message);
      setError('Camera/microphone access denied. Please allow permissions.');
    });
  }

  // Skip current partner and find a new one
  function handleNext() {
    if (pcRef.current) {
      try { pcRef.current.close(); } catch(e) {}
      pcRef.current = null;
    }
    remoteStreamRef.current = null;
    if (remotePVRef.current) { remotePVRef.current.cleanup(); remotePVRef.current = null; }
    setPartnerName('');
    setStatus('waiting');
    if (ctx.socket) ctx.socket.emit('roulette_next');
  }

  // Stop roulette entirely
  function handleStop() {
    cleanup();
    setStatus('idle');
    setPartnerName('');
    if (ctx.socket) ctx.socket.emit('roulette_leave');
  }

  // ==================== IDLE STATE ====================
  if (status === 'idle') {
    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#111113', gap: '24px', padding: '20px'
      }
    },
      React.createElement('div', {
        style: { fontSize: '48px' }
      }, '\uD83C\uDFB2'),
      React.createElement('h2', {
        style: { fontSize: '28px', fontWeight: 700, color: '#dcddde', textAlign: 'center', margin: 0 }
      }, 'Video Roulette'),
      React.createElement('p', {
        style: { color: '#949ba4', fontSize: '16px', textAlign: 'center', maxWidth: '400px', lineHeight: '1.5', margin: 0 }
      }, 'Meet random people face-to-face. You\'ll be paired with a stranger for a video call. Click Next to skip, or Stop to leave.'),

      // Consent / Liability Agreement Box
      React.createElement('div', {
        style: {
          maxWidth: '480px', width: '100%', background: '#1e1f22',
          borderRadius: '12px', border: '1px solid #2a2b2f',
          padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px'
        }
      },
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }
        },
          // Shield icon
          React.createElement('svg', {
            width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none',
            stroke: '#f0b232', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round'
          },
            React.createElement('path', { d: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' })
          ),
          React.createElement('span', {
            style: { color: '#f0b232', fontWeight: 700, fontSize: '15px' }
          }, 'Consent & Liability Agreement')
        ),
        React.createElement('div', {
          style: {
            color: '#b5bac1', fontSize: '13px', lineHeight: '1.6',
            maxHeight: '160px', overflowY: 'auto', paddingRight: '6px'
          }
        },
          React.createElement('p', { style: { margin: '0 0 8px 0' } },
            'By using Video Roulette, you acknowledge and agree to the following:'
          ),
          React.createElement('ul', {
            style: { margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '6px' }
          },
            React.createElement('li', null, 'You are at least 18 years of age or the age of majority in your jurisdiction.'),
            React.createElement('li', null, 'You may be connected with strangers. BossCord does not screen, verify, or monitor participants.'),
            React.createElement('li', null, 'You are solely responsible for your interactions. Do not share personal information, engage in illegal activity, or display inappropriate content.'),
            React.createElement('li', null, 'BossCord is not liable for any damages, harm, or losses arising from your use of Video Roulette, including but not limited to exposure to objectionable content.'),
            React.createElement('li', null, 'Sessions may be ended at any time by either party or by BossCord without notice.'),
            React.createElement('li', null, 'Recording other users without their consent may violate applicable laws and is strictly prohibited.')
          )
        ),
        // Checkbox row
        React.createElement('label', {
          style: {
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            cursor: 'pointer', userSelect: 'none', marginTop: '4px'
          }
        },
          React.createElement('input', {
            type: 'checkbox',
            checked: consentChecked,
            onChange: function(e) { setConsentChecked(e.target.checked); },
            style: {
              width: '18px', height: '18px', marginTop: '2px',
              accentColor: '#5865f2', cursor: 'pointer', flexShrink: 0
            }
          }),
          React.createElement('span', {
            style: { color: '#dcddde', fontSize: '13px', lineHeight: '1.4' }
          }, 'I have read and agree to the Consent & Liability Agreement. I understand that I proceed at my own risk.')
        )
      ),

      error ? React.createElement('div', {
        style: { color: '#ed4245', fontSize: '14px', textAlign: 'center', padding: '8px 16px', background: 'rgba(237,66,69,0.1)', borderRadius: '8px' }
      }, error) : null,

      React.createElement('button', {
        disabled: !consentChecked,
        style: {
          padding: '14px 48px', background: consentChecked ? '#57f287' : '#2d7d46', border: 'none',
          borderRadius: '28px', color: consentChecked ? '#1c1c1e' : '#6b7a6f', fontSize: '18px',
          fontWeight: 700, cursor: consentChecked ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
          transition: 'transform 0.1s, background 0.2s, color 0.2s', minHeight: '52px',
          opacity: consentChecked ? 1 : 0.7
        },
        onClick: consentChecked ? handleStart : undefined,
        onMouseEnter: consentChecked ? function(e) { e.target.style.transform = 'scale(1.05)'; } : undefined,
        onMouseLeave: consentChecked ? function(e) { e.target.style.transform = 'scale(1)'; } : undefined
      }, 'Start')
    );
  }

  // ==================== WAITING / CONNECTED STATE ====================
  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      background: '#111113', overflow: 'hidden'
    }
  },
    // Header bar
    React.createElement('div', {
      style: {
        height: '48px', minHeight: '48px', display: 'flex', alignItems: 'center',
        padding: '0 16px', background: '#1e1f22', borderBottom: '1px solid #252528',
        gap: '8px', flexShrink: 0
      }
    },
      React.createElement('span', { style: { fontSize: '18px' } }, '\uD83C\uDFB2'),
      React.createElement('span', {
        style: { fontWeight: 700, fontSize: '16px', color: '#dcddde' }
      }, 'Video Roulette'),
      React.createElement('div', {
        style: {
          marginLeft: '12px', padding: '3px 10px', borderRadius: '12px',
          background: status === 'connected' ? 'rgba(87,242,135,0.15)' : 'rgba(240,178,50,0.15)',
          color: status === 'connected' ? '#57f287' : '#f0b232',
          fontSize: '12px', fontWeight: 600
        }
      }, status === 'connected' ? 'Connected to ' + partnerName : 'Searching...')
    ),

    // Video grid — 2 tiles side by side (or stacked on mobile)
    React.createElement('div', {
      style: {
        flex: 1, display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: '6px', padding: '8px', overflow: 'hidden'
      }
    },
      // Your video tile
      React.createElement('div', {
        style: {
          flex: 1, position: 'relative', background: '#1a1a1d',
          borderRadius: '12px', overflow: 'hidden', minHeight: '200px'
        }
      },
        React.createElement('video', {
          ref: localVideoRef,
          autoPlay: true, playsInline: true, muted: true,
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
        }),
        React.createElement('div', {
          style: {
            position: 'absolute', bottom: '8px', left: '10px',
            background: 'rgba(0,0,0,0.6)', padding: '3px 10px',
            borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 600
          }
        }, 'You')
      ),

      // Stranger's video tile (or waiting placeholder)
      React.createElement('div', {
        style: {
          flex: 1, position: 'relative', background: '#1a1a1d',
          borderRadius: '12px', overflow: 'hidden', minHeight: '200px',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }
      },
        status === 'connected' ? React.createElement('video', {
          ref: remoteVideoRef,
          autoPlay: true, playsInline: true,
          style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' }
        }) : React.createElement('div', {
          style: {
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '16px'
          }
        },
          // Spinning loader
          React.createElement('div', {
            style: {
              width: '48px', height: '48px', border: '3px solid #333',
              borderTopColor: '#f0b232', borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }
          }),
          React.createElement('span', {
            style: { color: '#949ba4', fontSize: '16px' }
          }, 'Looking for someone...')
        ),
        status === 'connected' ? React.createElement('div', {
          style: {
            position: 'absolute', bottom: '8px', left: '10px',
            background: 'rgba(0,0,0,0.6)', padding: '3px 10px',
            borderRadius: '6px', color: '#fff', fontSize: '13px', fontWeight: 600
          }
        }, partnerName) : null
      )
    ),

    // Bottom toolbar — Next and Stop buttons
    React.createElement('div', {
      style: {
        height: '64px', minHeight: '64px', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: '#1e1f22', borderTop: '1px solid #252528',
        gap: '16px', flexShrink: 0
      }
    },
      // Next button (only visible when connected to a partner)
      status === 'connected' ? React.createElement('button', {
        style: {
          padding: '10px 32px', background: '#f0b232', border: 'none',
          borderRadius: '24px', color: '#1c1c1e', fontSize: '16px',
          fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          minHeight: '44px', transition: 'background 0.15s'
        },
        onClick: handleNext
      }, 'Next \u27A1') : null,

      // Stop button (always visible)
      React.createElement('button', {
        style: {
          padding: '10px 32px', background: '#ed4245', border: 'none',
          borderRadius: '24px', color: '#fff', fontSize: '16px',
          fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          minHeight: '44px', transition: 'background 0.15s'
        },
        onClick: handleStop
      }, 'Stop')
    )
  );
}
