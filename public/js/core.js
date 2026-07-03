const { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } = React;

// ===================== PROOF-OF-WORK SOLVER =====================
// Runs SHA-256 hash puzzle in a Web Worker to avoid blocking UI.
const _powWorkerCode = `
self.onmessage = async function(e) {
  var challenge = e.data.challenge;
  var difficulty = e.data.difficulty;
  var encoder = new TextEncoder();
  var nonce = 0;
  var BATCH = 4096;

  function hasLeadingZeros(buf, bits) {
    var fullBytes = Math.floor(bits / 8);
    var remainBits = bits % 8;
    for (var i = 0; i < fullBytes; i++) {
      if (buf[i] !== 0) return false;
    }
    if (remainBits > 0) {
      var mask = 0xFF << (8 - remainBits);
      if ((buf[fullBytes] & mask) !== 0) return false;
    }
    return true;
  }

  while (true) {
    var promises = [];
    var base = nonce;
    for (var i = 0; i < BATCH; i++) {
      var n = (base + i).toString(16);
      var data = encoder.encode(challenge + n);
      promises.push(
        crypto.subtle.digest('SHA-256', data).then(function(buf) {
          return { nonce: this, hash: new Uint8Array(buf) };
        }.bind(n))
      );
    }
    nonce += BATCH;
    var results = await Promise.all(promises);
    for (var j = 0; j < results.length; j++) {
      if (hasLeadingZeros(results[j].hash, difficulty)) {
        self.postMessage({ done: true, nonce: results[j].nonce });
        return;
      }
    }
    self.postMessage({ progress: nonce });
  }
};
`;

function solvePoW(challenge, difficulty) {
  return new Promise(function(resolve, reject) {
    try {
      var blob = new Blob([_powWorkerCode], { type: 'application/javascript' });
      var url = URL.createObjectURL(blob);
      var worker = new Worker(url);
      var timeout = setTimeout(function() {
        worker.terminate();
        URL.revokeObjectURL(url);
        reject(new Error('PoW solver timed out'));
      }, 120000); // 2 minute timeout
      worker.onmessage = function(e) {
        if (e.data.done) {
          clearTimeout(timeout);
          worker.terminate();
          URL.revokeObjectURL(url);
          resolve(e.data.nonce);
        }
      };
      worker.onerror = function(err) {
        clearTimeout(timeout);
        worker.terminate();
        URL.revokeObjectURL(url);
        reject(err);
      };
      worker.postMessage({ challenge: challenge, difficulty: difficulty });
    } catch (err) {
      reject(err);
    }
  });
}

async function fetchAndSolvePoW(type) {
  var resp = await fetch('/api/pow/challenge' + (type === 'account' ? '?type=account' : ''));
  if (!resp.ok) throw new Error('Failed to get challenge');
  var data = await resp.json();
  var nonce = await solvePoW(data.challenge, data.difficulty);
  return { challenge: data.challenge, nonce: nonce };
}

// ===================== VOICE MANAGER (WebRTC) =====================
class VoiceManager {
  constructor() {
    this.localStream = null;
    this.peers = new Map();
    this.audioElements = new Map();
    this.socket = null;
    this.roomCode = null;
    this.channelId = null;
    this.isMuted = false;
    this.isDeafened = false;
    this.onMuteChange = null;
    this.onDeafenChange = null;
    this.onError = null;
    this._signalHandler = null;
    this._audioContext = null;
    this._iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
    ];
    // Video/screen share
    this.cameraStream = null;
    this.screenStream = null;
    this.isCameraOn = false;
    this.isScreenSharing = false;
    this.onCameraChange = null;
    this.onScreenShareChange = null;
    this.remoteVideoStreams = new Map(); // compound key (peerId:streamId) -> { stream, track, peerId }
    this.onRemoteVideoChange = null;
    this._videoElements = new Map();
    this.peerNames = new Map(); // peerId -> userName
  }

  async join(socket, roomCode, channelId) {
    if (this.localStream) {
      this.leave();
    }

    this.socket = socket;
    this.roomCode = roomCode;
    this.channelId = channelId;

    // Create and resume AudioContext during user gesture to unlock audio playback
    try {
      if (!this._audioContext || this._audioContext.state === 'closed') {
        this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (this._audioContext.state === 'suspended') {
        await this._audioContext.resume();
      }
    } catch (e) {
      console.warn('[VoiceManager] AudioContext setup:', e.message);
    }

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
    } catch (err) {
      console.error('[VoiceManager] getUserMedia failed:', err.name, err.message);
      if (this.onError) {
        if (!window.isSecureContext) {
          this.onError('Voice chat requires HTTPS. Connect via a secure (https://) URL.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          this.onError('No microphone found. Please connect a microphone and try again.');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          this.onError('Microphone is busy or unavailable. Close other apps using the mic and try again.');
        } else if (err.name === 'OverconstrainedError') {
          this.onError('Microphone does not support the required settings. Try a different microphone.');
        } else {
          this.onError('Microphone access denied. Click the lock/site icon in your browser address bar to allow microphone access, then try again.');
        }
      }
      this.socket = null;
      this.roomCode = null;
      this.channelId = null;
      throw err;
    }

    this._signalHandler = (data) => {
      if (data && data.from && data.signal) {
        this.handleSignal(data);
      }
    };
    this.socket.on('voice_signal', this._signalHandler);

    this.socket.emit('voice_join', { roomCode: roomCode, channelId: channelId });
  }

  leave() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(function(track) { track.stop(); });
      this.localStream = null;
    }

    for (var entry of this.peers) {
      var peerId = entry[0];
      var pc = entry[1];
      try { pc.close(); } catch (e) { /* ignore */ }
    }
    this.peers.clear();

    for (var audioEntry of this.audioElements) {
      var audioId = audioEntry[0];
      var entry = audioEntry[1];
      try {
        if (entry.type === 'ctx' && entry.source) {
          entry.source.disconnect();
        } else if (entry.type === 'el' && entry.el) {
          entry.el.pause();
          entry.el.srcObject = null;
          if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
        }
      } catch (e) { /* ignore */ }
    }
    this.audioElements.clear();

    if (this.socket && this.channelId) {
      this.socket.emit('voice_leave', {
        roomCode: this.roomCode,
        channelId: this.channelId
      });
    }

    if (this.socket && this._signalHandler) {
      this.socket.off('voice_signal', this._signalHandler);
      this._signalHandler = null;
    }

    // Clean up camera and screen share
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(function(t) { t.stop(); });
      this.cameraStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(function(t) { t.stop(); });
      this.screenStream = null;
    }
    this.isCameraOn = false;
    this.isScreenSharing = false;
    this.remoteVideoStreams.clear();
    this.peerNames.clear();
    if (this.onCameraChange) this.onCameraChange(false);
    if (this.onScreenShareChange) this.onScreenShareChange(false);
    if (this.onRemoteVideoChange) this.onRemoteVideoChange();

    this.isMuted = false;
    this.isDeafened = false;
    if (this.onMuteChange) this.onMuteChange(false);
    if (this.onDeafenChange) this.onDeafenChange(false);

    this.socket = null;
    this.roomCode = null;
    this.channelId = null;
  }

  handleExistingUsers(users) {
    // Called when we receive voice_users (list of users already in the channel).
    // Store peer names for video labels.
    // We do NOT create offers here. Existing users receive voice_user_joined
    // and create offers TO US. We wait for their offers and respond with answers.
    if (!users || !Array.isArray(users)) return;
    for (var i = 0; i < users.length; i++) {
      var u = users[i];
      var uid = u.id || u.userId;
      var uname = u.name || u.userName;
      if (uid && uname) this.peerNames.set(uid, uname);
    }
  }

  handleUserJoined(userId, userName) {
    console.log('[VoiceManager] handleUserJoined:', userId, userName, 'localStream:', !!this.localStream, 'socket:', !!this.socket);
    if (userName) this.peerNames.set(userId, userName);
    if (!this.localStream || !this.socket) return;
    if (this.peers.has(userId)) return;

    var self = this;
    var pc = this.createPeerConnection(userId);
    this.peers.set(userId, pc);

    pc.createOffer()
      .then(function(offer) {
        return pc.setLocalDescription(offer);
      })
      .then(function() {
        self.socket.emit('voice_signal', {
          to: userId,
          signal: {
            type: 'offer',
            sdp: pc.localDescription.sdp
          }
        });
      })
      .catch(function(err) {
        console.error('[VoiceManager] createOffer failed for', userId, err.message);
        self._cleanupPeer(userId);
      });
  }

  handleUserLeft(userId) {
    this._cleanupPeer(userId);
  }

  handleSignal(data) {
    var from = data.from;
    var signal = data.signal;
    console.log('[VoiceManager] handleSignal from:', from, 'type:', signal ? signal.type : 'none');

    if (!signal || !signal.type) return;
    if (!this.localStream || !this.socket) return;

    var self = this;

    if (signal.type === 'offer') {
      var existingPc = this.peers.get(from);
      if (existingPc) {
        try { existingPc.close(); } catch (e) { /* ignore */ }
      }

      var pc = this.createPeerConnection(from);
      this.peers.set(from, pc);

      pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }))
        .then(function() {
          return pc.createAnswer();
        })
        .then(function(answer) {
          return pc.setLocalDescription(answer);
        })
        .then(function() {
          self.socket.emit('voice_signal', {
            to: from,
            signal: {
              type: 'answer',
              sdp: pc.localDescription.sdp
            }
          });
        })
        .catch(function(err) {
          console.error('[VoiceManager] answer failed for', from, err.message);
          self._cleanupPeer(from);
        });

    } else if (signal.type === 'answer') {
      var answerPc = this.peers.get(from);
      if (answerPc && answerPc.signalingState === 'have-local-offer') {
        answerPc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }))
          .catch(function(err) {
            console.error('[VoiceManager] setRemoteDescription (answer) failed for', from, err.message);
          });
      }

    } else if (signal.type === 'ice-candidate') {
      var icePc = this.peers.get(from);
      if (icePc && signal.candidate) {
        icePc.addIceCandidate(new RTCIceCandidate(signal.candidate))
          .catch(function(err) {
            // ICE candidate errors are non-fatal
          });
      }
    }
  }

  createPeerConnection(remoteId) {
    var self = this;
    var pc = new RTCPeerConnection({
      iceServers: this._iceServers,
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require'
    });

    if (this.localStream) {
      this.localStream.getTracks().forEach(function(track) {
        var sender = pc.addTrack(track, self.localStream);
        // Optimize audio: cap bitrate and enable DTX (silence suppression)
        if (track.kind === 'audio') {
          self._applyAudioParams(sender);
        }
      });
    }

    // Prefer Opus for audio, VP9 then VP8 for video (better compression)
    this._setCodecPreferences(pc);

    pc.onicecandidate = function(event) {
      if (event.candidate && self.socket) {
        self.socket.emit('voice_signal', {
          to: remoteId,
          signal: {
            type: 'ice-candidate',
            candidate: event.candidate.toJSON()
          }
        });
      }
    };

    pc.ontrack = function(event) {
      var stream = event.streams && event.streams[0];
      if (!stream) {
        stream = new MediaStream([event.track]);
      }
      var trackKind = event.track.kind;
      console.log('[VoiceManager] ontrack fired for', remoteId, 'track kind:', trackKind, 'stream tracks:', stream.getTracks().length);

      // Handle video tracks separately — use compound key so same peer can share camera + screen
      if (trackKind === 'video') {
        var streamKey = remoteId + ':' + stream.id;
        self.remoteVideoStreams.set(streamKey, { stream: stream, track: event.track, peerId: remoteId, muted: false });
        event.track.onended = function() {
          self.remoteVideoStreams.delete(streamKey);
          if (self.onRemoteVideoChange) self.onRemoteVideoChange();
        };
        // onmute fires during bandwidth adaptation — do NOT remove the stream,
        // just flag it so the UI can show a placeholder instead of destroying the element
        event.track.onmute = function() {
          var entry = self.remoteVideoStreams.get(streamKey);
          if (entry) entry.muted = true;
        };
        event.track.onunmute = function() {
          var entry = self.remoteVideoStreams.get(streamKey);
          if (entry) entry.muted = false;
        };
        if (self.onRemoteVideoChange) self.onRemoteVideoChange();
        return;
      }

      // Audio track handling
      var existing = self.audioElements.get(remoteId);
      if (existing && existing.el) {
        existing.el.srcObject = stream;
        existing.el.play().catch(function() {});
        return;
      }

      var audio = document.createElement('audio');
      audio.autoplay = true;
      audio.playsInline = true;
      audio.volume = 1.0;
      audio.srcObject = stream;
      document.body.appendChild(audio);

      var playRetries = 0;
      var playAttempt = function() {
        if (playRetries >= 10) {
          console.warn('[VoiceManager] Audio play gave up after 10 retries for', remoteId);
          return;
        }
        playRetries++;
        audio.play().then(function() {
          console.log('[VoiceManager] Audio playing for', remoteId);
        }).catch(function(e) {
          console.warn('[VoiceManager] Audio play failed for', remoteId, e.message, '- retrying in 500ms');
          setTimeout(playAttempt, 500);
        });
      };
      playAttempt();

      if (self.isDeafened) { audio.muted = true; }
      self.audioElements.set(remoteId, { type: 'el', el: audio, stream: stream });
    };

    pc.onconnectionstatechange = function() {
      console.log('[VoiceManager] Connection state:', pc.connectionState, 'for', remoteId);
      if (pc.connectionState === 'failed') {
        // ICE restart to recover the connection
        console.warn('[VoiceManager] ICE restart for', remoteId);
        pc.createOffer({ iceRestart: true })
          .then(function(offer) { return pc.setLocalDescription(offer); })
          .then(function() {
            if (self.socket) {
              self.socket.emit('voice_signal', {
                to: remoteId,
                signal: { type: 'offer', sdp: pc.localDescription.sdp }
              });
            }
          })
          .catch(function(err) {
            console.error('[VoiceManager] ICE restart failed for', remoteId, err.message);
            self._cleanupPeer(remoteId);
          });
      }
    };

    return pc;
  }

  toggleMute() {
    if (!this.localStream) return;
    this.isMuted = !this.isMuted;
    this.localStream.getAudioTracks().forEach(function(track) {
      track.enabled = !this.isMuted;
    }.bind(this));
    if (this.onMuteChange) this.onMuteChange(this.isMuted);
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
    var self = this;
    // Mute/unmute all incoming audio
    for (var entry of this.audioElements) {
      var info = entry[1];
      if (info.el) {
        info.el.muted = self.isDeafened;
      }
    }
    // When deafening, also mute outgoing mic. When undeafening, restore mic.
    if (this.isDeafened && !this.isMuted) {
      this.isMuted = true;
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(function(track) { track.enabled = false; });
      }
      if (this.onMuteChange) this.onMuteChange(true);
    } else if (!this.isDeafened && this.isMuted) {
      this.isMuted = false;
      if (this.localStream) {
        this.localStream.getAudioTracks().forEach(function(track) { track.enabled = true; });
      }
      if (this.onMuteChange) this.onMuteChange(false);
    }
    if (this.onDeafenChange) this.onDeafenChange(this.isDeafened);
  }

  async startCamera() {
    if (this.cameraStream) return;
    var self = this;
    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
        audio: false
      });
      var videoTrack = this.cameraStream.getVideoTracks()[0];
      if (videoTrack) {
        for (var entry of this.peers) {
          var pc = entry[1];
          try {
            var sender = pc.addTrack(videoTrack, self.cameraStream);
            self._applyVideoBandwidth(sender, 1000, false);
          } catch (e) { /* ignore */ }
        }
        // Renegotiate with all peers
        this._renegotiateAllPeers();
      }
      this.isCameraOn = true;
      if (this.onCameraChange) this.onCameraChange(true);
      if (this.socket) {
        this.socket.emit('media_start', { roomCode: this.roomCode, channelId: this.channelId, type: 'camera' });
      }
    } catch (err) {
      console.error('[VoiceManager] startCamera failed:', err.message);
      if (this.onError) this.onError('Camera access denied.');
    }
  }

  stopCamera() {
    if (!this.cameraStream) return;
    var self = this;
    var videoTrack = this.cameraStream.getVideoTracks()[0];
    if (videoTrack) {
      for (var entry of this.peers) {
        var pc = entry[1];
        var senders = pc.getSenders();
        for (var i = 0; i < senders.length; i++) {
          if (senders[i].track === videoTrack) {
            try { pc.removeTrack(senders[i]); } catch (e) { /* ignore */ }
          }
        }
      }
      videoTrack.stop();
    }
    this.cameraStream = null;
    this.isCameraOn = false;
    if (this.onCameraChange) this.onCameraChange(false);
    if (this.socket) {
      this.socket.emit('media_stop', { channelId: this.channelId, type: 'camera' });
    }
    this._renegotiateAllPeers();
  }

  async startScreenShare() {
    if (this.screenStream) return;
    var self = this;
    try {
      this.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15, max: 30 } },
        audio: false
      });
      var videoTrack = this.screenStream.getVideoTracks()[0];
      if (videoTrack) {
        // Hint to browser this is screen content (text/detail optimization)
        if (videoTrack.contentHint !== undefined) videoTrack.contentHint = 'detail';
        // Handle user stopping screen share via browser UI
        videoTrack.onended = function() { self.stopScreenShare(); };
        for (var entry of this.peers) {
          var pc = entry[1];
          try {
            var sender = pc.addTrack(videoTrack, self.screenStream);
            self._applyVideoBandwidth(sender, 1500, true);
          } catch (e) { /* ignore */ }
        }
        this._renegotiateAllPeers();
      }
      this.isScreenSharing = true;
      if (this.onScreenShareChange) this.onScreenShareChange(true);
      if (this.socket) {
        this.socket.emit('media_start', { roomCode: this.roomCode, channelId: this.channelId, type: 'screen' });
      }
    } catch (err) {
      console.error('[VoiceManager] startScreenShare failed:', err.message);
      // User cancelled - not an error
    }
  }

  stopScreenShare() {
    if (!this.screenStream) return;
    var self = this;
    var videoTrack = this.screenStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = null;
      for (var entry of this.peers) {
        var pc = entry[1];
        var senders = pc.getSenders();
        for (var i = 0; i < senders.length; i++) {
          if (senders[i].track === videoTrack) {
            try { pc.removeTrack(senders[i]); } catch (e) { /* ignore */ }
          }
        }
      }
      videoTrack.stop();
    }
    this.screenStream = null;
    this.isScreenSharing = false;
    if (this.onScreenShareChange) this.onScreenShareChange(false);
    if (this.socket) {
      this.socket.emit('media_stop', { channelId: this.channelId, type: 'screen' });
    }
    this._renegotiateAllPeers();
  }

  _applyAudioParams(sender) {
    if (!sender || !sender.getParameters) return;
    try {
      var params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      // Cap audio at 32kbps (Opus is efficient, 32k is clear for voice)
      params.encodings[0].maxBitrate = 32000;
      // Enable DTX — stops sending packets during silence, saves bandwidth
      params.encodings[0].dtx = true;
      sender.setParameters(params).catch(function() {});
    } catch (e) { /* ignore */ }
  }

  _setCodecPreferences(pc) {
    if (!pc.getTransceivers) return;
    try {
      var transceivers = pc.getTransceivers();
      for (var i = 0; i < transceivers.length; i++) {
        var t = transceivers[i];
        if (!t.setCodecPreferences) continue;
        var kind = t.receiver && t.receiver.track ? t.receiver.track.kind : (t.sender && t.sender.track ? t.sender.track.kind : null);
        if (!kind) continue;
        var codecs = RTCRtpReceiver.getCapabilities ? RTCRtpReceiver.getCapabilities(kind) : null;
        if (!codecs || !codecs.codecs) continue;

        if (kind === 'audio') {
          // Prefer Opus (already default, but be explicit)
          var sorted = codecs.codecs.slice().sort(function(a, b) {
            var aOpus = a.mimeType.toLowerCase().indexOf('opus') !== -1 ? 0 : 1;
            var bOpus = b.mimeType.toLowerCase().indexOf('opus') !== -1 ? 0 : 1;
            return aOpus - bOpus;
          });
          try { t.setCodecPreferences(sorted); } catch (e) { /* ignore */ }
        } else if (kind === 'video') {
          // Prefer VP9 > VP8 (better compression at same quality)
          var sorted = codecs.codecs.slice().sort(function(a, b) {
            var aScore = a.mimeType.toLowerCase().indexOf('vp9') !== -1 ? 0 : a.mimeType.toLowerCase().indexOf('vp8') !== -1 ? 1 : 2;
            var bScore = b.mimeType.toLowerCase().indexOf('vp9') !== -1 ? 0 : b.mimeType.toLowerCase().indexOf('vp8') !== -1 ? 1 : 2;
            return aScore - bScore;
          });
          try { t.setCodecPreferences(sorted); } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }
  }

  _applyVideoBandwidth(sender, maxBitrateKbps, isScreen) {
    if (!sender || !sender.getParameters) return;
    try {
      var params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = maxBitrateKbps * 1000;
      // Screen share: prefer resolution (text clarity). Camera: prefer framerate (smooth motion)
      params.degradationPreference = isScreen ? 'maintain-resolution' : 'maintain-framerate';
      sender.setParameters(params).catch(function() {});
    } catch (e) { /* ignore */ }
  }

  _renegotiateAllPeers() {
    var self = this;
    for (var entry of this.peers) {
      // IIFE to capture peerId and pc correctly (var has no block scope)
      (function(peerId, pc) {
        pc.createOffer()
          .then(function(offer) { return pc.setLocalDescription(offer); })
          .then(function() {
            if (self.socket) {
              self.socket.emit('voice_signal', {
                to: peerId,
                signal: { type: 'offer', sdp: pc.localDescription.sdp }
              });
            }
          })
          .catch(function(err) {
            console.error('[VoiceManager] renegotiate failed for', peerId, err.message);
          });
      })(entry[0], entry[1]);
    }
  }

  _cleanupPeer(peerId) {
    var pc = this.peers.get(peerId);
    if (pc) {
      try { pc.close(); } catch (e) { /* ignore */ }
      this.peers.delete(peerId);
    }

    var entry = this.audioElements.get(peerId);
    if (entry) {
      try {
        if (entry.type === 'ctx' && entry.source) {
          entry.source.disconnect();
        } else if (entry.type === 'el' && entry.el) {
          entry.el.pause();
          entry.el.srcObject = null;
          if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
        }
      } catch (e) { /* ignore */ }
      this.audioElements.delete(peerId);
    }

    // Clean up all remote video streams for this peer (compound keys: peerId:streamId)
    var keysToDelete = [];
    for (var vEntry of this.remoteVideoStreams) {
      if (vEntry[1].peerId === peerId) {
        keysToDelete.push(vEntry[0]);
      }
    }
    for (var i = 0; i < keysToDelete.length; i++) {
      this.remoteVideoStreams.delete(keysToDelete[i]);
    }
    if (keysToDelete.length > 0 && this.onRemoteVideoChange) {
      this.onRemoteVideoChange();
    }

    // Remove peer name
    if (this.peerNames) this.peerNames.delete(peerId);
  }

  getPeerName(peerId) {
    return this.peerNames.get(peerId) || 'User';
  }

  cleanup() {
    this.leave();
    if (this._audioContext && this._audioContext.state !== 'closed') {
      try { this._audioContext.close(); } catch (e) { /* ignore */ }
      this._audioContext = null;
    }
  }
}

var _globalVoiceManager = new VoiceManager();

// ===================== MOBILE DETECTION =====================
function useIsMobile() {
  var check = function() { return window.innerWidth < 768; };
  var [mobile, setMobile] = useState(check);
  useEffect(function() {
    function onResize() { setMobile(check()); }
    window.addEventListener('resize', onResize);
    return function() { window.removeEventListener('resize', onResize); };
  }, []);
  return mobile;
}

// ===================== SOCKET CONTEXT =====================
const SocketContext = createContext(null);

function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [publicRooms, setPublicRooms] = useState([]);
  const [currentRoomCode, setCurrentRoomCode] = useState(null);
  const [currentChannelId, setCurrentChannelId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [errorMessage, setErrorMessage] = useState(null);
  const [wipeWarning, setWipeWarning] = useState(null);
  const [updateWarning, setUpdateWarning] = useState(null);
  const [connected, setConnected] = useState(false);
  const [currentVoiceChannel, setCurrentVoiceChannel] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [voiceError, setVoiceError] = useState(null);
  const [account, setAccount] = useState(null);
  const [accountKey, setAccountKey] = useState(null);
  const [slurFilterEnabled, setSlurFilterEnabled] = useState(false);
  const slurFilterRegex = useRef(null);
  const [powStatus, setPowStatus] = useState(null); // null, 'solving', 'solving_account'
  const [pinRequired, setPinRequired] = useState(false);
  const [pinSetupRequired, setPinSetupRequired] = useState(false);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const [serverStats, setServerStats] = useState({ online: 0, members: 0 });

  // Notification badge counts
  const [unreadDMs, setUnreadDMs] = useState(0);
  const [unreadFriendRequests, setUnreadFriendRequests] = useState(0);

  // Active tab tracking (set by App component for idle disconnect + badge reset)
  const [activeTab, setActiveTab] = useState('chat');
  const activeTabRef = useRef('chat');

  // Namespace sockets for /games and /market (lazy-connected)
  const [gamesSocket, setGamesSocket] = useState(null);
  const [marketSocket, setMarketSocket] = useState(null);
  const gamesSocketRef = useRef(null);
  const marketSocketRef = useRef(null);
  const accountKeyRef = useRef(null);
  const sessionTokenRef = useRef(null);

  // Idle disconnect timers for namespace sockets
  const gamesIdleTimerRef = useRef(null);
  const marketIdleTimerRef = useRef(null);
  const IDLE_DISCONNECT_MS = 2 * 60 * 1000; // 2 minutes

  // Keep accountKeyRef in sync
  useEffect(function() {
    accountKeyRef.current = accountKey || localStorage.getItem('bosscord_key') || null;
  }, [accountKey]);

  // Keep activeTabRef in sync
  useEffect(function() {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  // Idle disconnect for namespace sockets when user leaves their tab
  useEffect(function() {
    // Games socket idle logic
    if (activeTab === 'games') {
      // User is on games tab - cancel any idle timer
      if (gamesIdleTimerRef.current) {
        clearTimeout(gamesIdleTimerRef.current);
        gamesIdleTimerRef.current = null;
      }
    } else {
      // User left games tab - start idle timer if games socket is connected
      if (gamesSocketRef.current && gamesSocketRef.current.connected && !gamesIdleTimerRef.current) {
        gamesIdleTimerRef.current = setTimeout(function() {
          if (gamesSocketRef.current && gamesSocketRef.current.connected && activeTabRef.current !== 'games') {
            gamesSocketRef.current.disconnect();
            gamesSocketRef.current = null;
            setGamesSocket(null);
          }
          gamesIdleTimerRef.current = null;
        }, IDLE_DISCONNECT_MS);
      }
    }

    // Market socket idle logic
    if (activeTab === 'games') {
      // Market is used within the games hub, so keep it alive on games tab too
      if (marketIdleTimerRef.current) {
        clearTimeout(marketIdleTimerRef.current);
        marketIdleTimerRef.current = null;
      }
    } else {
      if (marketSocketRef.current && marketSocketRef.current.connected && !marketIdleTimerRef.current) {
        marketIdleTimerRef.current = setTimeout(function() {
          if (marketSocketRef.current && marketSocketRef.current.connected && activeTabRef.current !== 'games') {
            marketSocketRef.current.disconnect();
            marketSocketRef.current = null;
            setMarketSocket(null);
          }
          marketIdleTimerRef.current = null;
        }, IDLE_DISCONNECT_MS);
      }
    }

    return function() {
      // Cleanup timers only on unmount, not on every tab change
    };
  }, [activeTab, gamesSocket, marketSocket]);

  // Cleanup idle timers on full unmount
  useEffect(function() {
    return function() {
      if (gamesIdleTimerRef.current) clearTimeout(gamesIdleTimerRef.current);
      if (marketIdleTimerRef.current) clearTimeout(marketIdleTimerRef.current);
    };
  }, []);

  const voiceManagerRef = useRef(_globalVoiceManager);
  const socketIdRef = useRef(null);

  const typingTimers = useRef({});
  const errorTimer = useRef(null);

  const currentRoom = useMemo(() => {
    if (!currentRoomCode) return null;
    return rooms.find(r => r.code === currentRoomCode) || null;
  }, [rooms, currentRoomCode]);

  const currentChannel = useMemo(() => {
    if (!currentRoom || !currentChannelId) return null;
    return (currentRoom.channels || []).find(c => c.id === currentChannelId) || null;
  }, [currentRoom, currentChannelId]);

  const connectSocket = useCallback(async (userName, keyOverride, pinOverride) => {
    // Reset auth/error state so stale flags don't persist across reconnection attempts
    setPinRequired(false);
    setPinSetupRequired(false);
    setErrorMessage(null);
    if (socket) { socket.disconnect(); }
    var savedKey = keyOverride || localStorage.getItem('bosscord_key') || undefined;
    // Validate saved key format — clear invalid keys from localStorage
    if (savedKey && (savedKey.length < 12 || !/^[a-zA-Z0-9]+$/.test(savedKey))) {
      localStorage.removeItem('bosscord_key');
      savedKey = undefined;
    }
    if (savedKey) { setAccountKey(savedKey); }
    // Solve proof-of-work challenge before connecting
    setPowStatus('solving');
    try {
      var powSolution = await fetchAndSolvePoW('connect');
    } catch (err) {
      setPowStatus(null);
      setErrorMessage('Connection challenge failed. Please try again.');
      return;
    }
    setPowStatus(null);
    var authObj = { name: userName, powChallenge: powSolution.challenge, powNonce: powSolution.nonce };
    if (savedKey) { authObj.accountKey = savedKey; }
    // Include PIN if explicitly provided by the user (never auto-fill from cache)
    var pinToUse = pinOverride || undefined;
    if (pinToUse && savedKey) { authObj.pin = pinToUse; }
    const s = io(window.location.origin, {
      auth: authObj,
      transports: ['websocket', 'polling'],
      reconnection: false
    });
    s.on('connect', function() { socketIdRef.current = s.id; });
    // Register auth-critical listeners IMMEDIATELY to avoid race with useEffect
    s.on('pin_required', function(data) {
      setPinRequired(true);
      setErrorMessage(data && data.message ? data.message : 'PIN required for this account');
    });
    s.on('pin_setup_required', function(data) {
      setPinSetupRequired(true);
      setErrorMessage(data && data.message ? data.message : 'This account needs a PIN. Enter a 4-character PIN to secure it.');
    });
    s.on('pin_set_success', function() {
      setPinSetupRequired(false);
    });
    s.on('identity', function(data) {
      // Store session token for namespace auth
      if (data && data.sessionToken) {
        sessionTokenRef.current = data.sessionToken;
      }
      // Load public rooms immediately to avoid empty room list on login
      if (data && data.publicRooms && Array.isArray(data.publicRooms)) {
        setPublicRooms(data.publicRooms);
      }
    });
    setSocket(s);
  }, [socket]);

  const disconnectSocket = useCallback(() => {
    voiceManagerRef.current.cleanup();
    sessionTokenRef.current = null;
    if (socket) { socket.disconnect(); }
    setSocket(null);
    setUser(null);
    setRooms([]);
    setPublicRooms([]);
    setCurrentRoomCode(null);
    setCurrentChannelId(null);
    setMessages([]);
    setTypingUsers([]);
    setVoiceUsers([]);
    setConnected(false);
    setCurrentVoiceChannel(null);
    setIsMuted(false);
    setIsDeafened(false);
    setAccount(null);
    setPinnedMessages([]);
  }, [socket]);

  const createAccount = useCallback(async (pin) => {
    if (!socket) return;
    if (!pin || pin.length !== 4) {
      setErrorMessage('A 4-digit PIN is required to claim your key');
      return;
    }
    // Solve harder proof-of-work challenge for account creation
    setPowStatus('solving_account');
    try {
      var powSolution = await fetchAndSolvePoW('account');
      setPowStatus(null);
      socket.emit('account_create', { powChallenge: powSolution.challenge, powNonce: powSolution.nonce, pin: pin });
    } catch (err) {
      setPowStatus(null);
      setErrorMessage('Account challenge failed. Please try again.');
    }
  }, [socket]);

  const deleteAccount = useCallback(() => {
    if (socket) { socket.emit('account_delete'); }
  }, [socket]);

  const toggleSlurFilter = useCallback(() => {
    if (socket) { socket.emit('toggle_slur_filter'); }
  }, [socket]);

  const censorText = useCallback(function(text) {
    if (!slurFilterEnabled || !slurFilterRegex.current || !text) return text;
    slurFilterRegex.current.lastIndex = 0;
    return text.replace(slurFilterRegex.current, '***');
  }, [slurFilterEnabled]);

  // Lazy-connect to /games namespace
  const connectGames = useCallback(function() {
    if (gamesSocketRef.current && gamesSocketRef.current.connected) return gamesSocketRef.current;
    // Clean up stale socket if it exists but is disconnected
    if (gamesSocketRef.current) {
      gamesSocketRef.current.disconnect();
      gamesSocketRef.current = null;
    }
    var token = sessionTokenRef.current;
    if (!token) return null;
    var gs = io('/games', {
      auth: { sessionToken: token },
      transports: ['websocket']
    });
    // Forward chips_updated from /games to local account state
    gs.on('chips_updated', function(data) {
      if (!data || typeof data.chips !== 'number') return;
      setAccount(function(prev) {
        if (!prev) return prev;
        return Object.assign({}, prev, { chips: data.chips });
      });
    });
    gamesSocketRef.current = gs;
    setGamesSocket(gs);
    return gs;
  }, []);

  // Lazy-connect to /market namespace
  const connectMarket = useCallback(function() {
    if (marketSocketRef.current && marketSocketRef.current.connected) return marketSocketRef.current;
    if (marketSocketRef.current) {
      marketSocketRef.current.disconnect();
      marketSocketRef.current = null;
    }
    var token = sessionTokenRef.current;
    if (!token) return null;
    var ms = io('/market', {
      auth: { sessionToken: token },
      transports: ['websocket']
    });
    // Forward chips_updated from /market to local account state
    ms.on('chips_updated', function(data) {
      if (!data || typeof data.chips !== 'number') return;
      setAccount(function(prev) {
        if (!prev) return prev;
        return Object.assign({}, prev, { chips: data.chips });
      });
    });
    marketSocketRef.current = ms;
    setMarketSocket(ms);
    return ms;
  }, []);

  // Disconnect namespace sockets when main socket disconnects
  useEffect(function() {
    if (!connected) {
      if (gamesSocketRef.current) {
        gamesSocketRef.current.disconnect();
        gamesSocketRef.current = null;
        setGamesSocket(null);
      }
      if (marketSocketRef.current) {
        marketSocketRef.current.disconnect();
        marketSocketRef.current = null;
        setMarketSocket(null);
      }
    }
  }, [connected]);

  useEffect(() => {
    if (!socket) return;
    function onConnect() { setConnected(true); }
    function onDisconnect() {
      // Guard: if a newer socket has been created, this disconnect is stale — skip state wipe
      if (socketIdRef.current && socket.id !== socketIdRef.current) return;
      voiceManagerRef.current.cleanup();
      setConnected(false);
      setUser(null);
      setRooms([]);
      setPublicRooms([]);
      setCurrentRoomCode(null);
      setCurrentChannelId(null);
      setMessages([]);
      setTypingUsers([]);
      setVoiceUsers([]);
      setCurrentVoiceChannel(null);
      setIsMuted(false);
      setIsDeafened(false);
      setAccount(null);
      setPinnedMessages([]);
    }
    function onIdentity(data) {
      setUser(data);
      if (data && data.account) {
        setAccount(data.account);
        // Sync TOS acceptance
        if (data.account.tosAccepted) {
          localStorage.setItem('bosscord_tos_accepted', '2026-02-13');
        }
        if (data.account.slurFilter) {
          setSlurFilterEnabled(true);
        }
      } else {
        // Server didn't link an account — clear any stale key from localStorage
        if (localStorage.getItem('bosscord_key')) {
          localStorage.removeItem('bosscord_key');
          setAccountKey(null);
        }
      }
      // Also clear if we got a temp account but had a saved key
      if (data && data.account && data.account.temp && localStorage.getItem('bosscord_key')) {
        localStorage.removeItem('bosscord_key');
        setAccountKey(null);
      }
      setPinRequired(false);
      // Use embedded public rooms if available (eliminates round-trip delay)
      if (data.publicRooms && Array.isArray(data.publicRooms)) {
        setPublicRooms(data.publicRooms);
      }
      // Also request fresh list as fallback/update
      socket.emit('browse_public_rooms');
    }
    function onAccountCreated(data) {
      if (data && data.key) {
        localStorage.setItem('bosscord_key', data.key);
        setAccountKey(data.key);
        setAccount({ key: data.key, chips: data.chips, stats: data.stats, createdAt: data.createdAt });
      }
    }
    function onAccountDeleted() {
      localStorage.removeItem('bosscord_key');
      setAccountKey(null);
      setAccount(null);
    }
    function onChipsUpdated(data) {
      if (!data || typeof data.chips !== 'number') return;
      setAccount(function(prev) {
        if (!prev) return prev;
        return Object.assign({}, prev, { chips: data.chips });
      });
    }
    function onSlurFilterUpdated(data) {
      if (!data) return;
      setSlurFilterEnabled(!!data.enabled);
      if (data.enabled && data.pattern) {
        try { slurFilterRegex.current = new RegExp(data.pattern, 'gi'); } catch(e) { slurFilterRegex.current = null; }
      } else {
        slurFilterRegex.current = null;
      }
    }
    function onPublicRooms(data) {
      if (data && Array.isArray(data.rooms)) {
        setPublicRooms(data.rooms);
      }
    }
    function onPublicRoomsUpdated(data) {
      if (data && Array.isArray(data.rooms)) {
        setPublicRooms(data.rooms);
      }
    }
    function onRoomCreated(room) {
      setRooms(prev => {
        const exists = prev.find(r => r.code === room.code);
        if (exists) return prev.map(r => r.code === room.code ? room : r);
        return [...prev, room];
      });
      setCurrentRoomCode(room.code);
      // If we just created an encrypted room, store the secret
      if (room.encrypted && window._pendingRoomSecret) {
        if (typeof BossCordCrypto !== 'undefined') {
          BossCordCrypto.storeRoomSecret(room.code, window._pendingRoomSecret);
        }
        window._pendingRoomSecret = null;
      }
      const firstText = (room.channels || []).find(c => c.type === 'text');
      if (firstText) {
        socket.emit('join_channel', { roomCode: room.code, channelId: firstText.id });
        setCurrentChannelId(firstText.id);
      }
    }
    function onRoomJoined(room) {
      setRooms(prev => {
        const exists = prev.find(r => r.code === room.code);
        if (exists) return prev.map(r => r.code === room.code ? room : r);
        return [...prev, room];
      });
      setCurrentRoomCode(room.code);
      // If we joined with an encrypted room secret, store it
      if (room.encrypted && window._pendingJoinRoomSecret && window._pendingJoinRoomCode === room.code) {
        if (typeof BossCordCrypto !== 'undefined') {
          BossCordCrypto.storeRoomSecret(room.code, window._pendingJoinRoomSecret);
        }
        window._pendingJoinRoomSecret = null;
        window._pendingJoinRoomCode = null;
      }
      const firstText = (room.channels || []).find(c => c.type === 'text');
      if (firstText) {
        socket.emit('join_channel', { roomCode: room.code, channelId: firstText.id });
        setCurrentChannelId(firstText.id);
      }
    }
    function onRoomLeft(data) {
      var code = (typeof data === 'string') ? data : (data && data.code ? data.code : data && data.roomCode ? data.roomCode : null);
      setRooms(prev => prev.filter(r => r.code !== code));
      setCurrentRoomCode(prev => {
        if (prev === code) return null;
        return prev;
      });
    }
    function onUserJoined(data) {
      if (!data || !data.roomCode || !data.user) return;
      setRooms(prev => prev.map(r => {
        if (r.code !== data.roomCode) return r;
        const members = r.members || [];
        if (members.find(m => m.id === data.user.id)) return r;
        return { ...r, members: [...members, data.user] };
      }));
    }
    function onUserLeft(data) {
      if (!data || !data.roomCode || !data.user) return;
      var userId = data.user.id;
      setRooms(prev => prev.map(r => {
        if (r.code !== data.roomCode) return r;
        return { ...r, members: (r.members || []).filter(m => m.id !== userId) };
      }));
    }
    function onChannelJoined(data) {
      if (!data || !data.channel) return;
      var msgs = data.channel.messages || [];
      setPinnedMessages(data.channel.pinnedMessages || []);
      // Check if the current room is encrypted and we have the key.
      // Use the setter function pattern to access the latest rooms state,
      // since onRoomJoined may have fired in the same event batch.
      setRooms(function(currentRooms) {
        var channelId = data.channel.id || data.channelId;
        var roomObj = null;
        // Find which room owns this channel
        for (var ri = 0; ri < currentRooms.length; ri++) {
          var chans = currentRooms[ri].channels || [];
          for (var ci = 0; ci < chans.length; ci++) {
            if (chans[ci].id === channelId) { roomObj = currentRooms[ri]; break; }
          }
          if (roomObj) break;
        }
        if (roomObj && roomObj.encrypted && typeof BossCordCrypto !== 'undefined') {
          var secret = BossCordCrypto.getRoomSecret(roomObj.code);
          if (secret) {
            var rCode = roomObj.code;
            var decryptPromises = msgs.map(function(msg) {
              var content = msg.content;
              if (content && content.length > 5 && content.charAt(0) === '{') {
                try {
                  var parsed = JSON.parse(content);
                  if (parsed.e2e && parsed.c && parsed.n) {
                    return BossCordCrypto.decryptRoomMessage(parsed.c, parsed.n, secret, rCode).then(function(plain) {
                      return Object.assign({}, msg, { content: plain, _decrypted: true });
                    }).catch(function() {
                      return Object.assign({}, msg, { content: '\uD83D\uDD12 [encrypted message - unable to decrypt]', _decrypted: false });
                    });
                  }
                } catch (e) { /* not JSON */ }
              }
              return Promise.resolve(msg);
            });
            Promise.all(decryptPromises).then(function(decryptedMsgs) {
              setMessages(decryptedMsgs);
            });
            return currentRooms; // return unchanged
          }
        }
        setMessages(msgs);
        return currentRooms; // return unchanged
      });
    }
    function onNewMessage(data) {
      if (!data || !data.message) return;
      var msg = data.message;
      // Check if the message is E2E encrypted room content
      var content = msg.content;
      if (content && content.length > 5 && content.charAt(0) === '{') {
        try {
          var parsed = JSON.parse(content);
          if (parsed.e2e && parsed.c && parsed.n) {
            // Use setter pattern to access latest rooms state
            setRooms(function(currentRooms) {
              var roomForChannel = null;
              for (var ri = 0; ri < currentRooms.length; ri++) {
                var chans = currentRooms[ri].channels || [];
                for (var ci = 0; ci < chans.length; ci++) {
                  if (chans[ci].id === data.channelId) { roomForChannel = currentRooms[ri]; break; }
                }
                if (roomForChannel) break;
              }
              if (roomForChannel && roomForChannel.encrypted && typeof BossCordCrypto !== 'undefined') {
                var secret = BossCordCrypto.getRoomSecret(roomForChannel.code);
                if (secret) {
                  BossCordCrypto.decryptRoomMessage(parsed.c, parsed.n, secret, roomForChannel.code).then(function(plaintext) {
                    var decryptedMsg = Object.assign({}, msg, { content: plaintext, _decrypted: true });
                    setCurrentChannelId(function(curChId) {
                      if (data.channelId === curChId) {
                        setMessages(function(prev) { return appendMessage(prev, decryptedMsg); });
                      }
                      return curChId;
                    });
                  }).catch(function() {
                    var failedMsg = Object.assign({}, msg, { content: '\uD83D\uDD12 [encrypted message - unable to decrypt]', _decrypted: false });
                    setCurrentChannelId(function(curChId) {
                      if (data.channelId === curChId) {
                        setMessages(function(prev) { return appendMessage(prev, failedMsg); });
                      }
                      return curChId;
                    });
                  });
                  // Send notification (without plaintext for privacy)
                  if (msg.authorId !== socket.id && typeof BossCordNotifs !== 'undefined') {
                    BossCordNotifs.notify(msg.authorName || 'Encrypted Message', '(encrypted)', 'msg-' + data.channelId);
                  }
                  return currentRooms; // handled async, return unchanged
                }
              }
              // Not encrypted or no key — fall through to normal handling below
              // But we're inside setRooms, so we need to add the message here
              setCurrentChannelId(function(curChId) {
                if (data.channelId === curChId) {
                  setMessages(function(prev) { return appendMessage(prev, msg); });
                }
                return curChId;
              });
              if (msg.authorId !== socket.id && typeof BossCordNotifs !== 'undefined') {
                BossCordNotifs.notify(msg.authorName || 'New Message', msg.content || '', 'msg-' + data.channelId);
              }
              return currentRooms; // unchanged
            });
            return; // handled inside setRooms callback
          }
        } catch (e) { /* not JSON, treat as normal */ }
      }
      setCurrentChannelId(curChId => {
        if (data.channelId === curChId) {
          setMessages(function(prev) { return appendMessage(prev, data.message); });
        }
        return curChId;
      });
      // Browser notification for messages from other users
      if (data.message && data.message.authorId !== socket.id && typeof BossCordNotifs !== 'undefined') {
        BossCordNotifs.notify(data.message.authorName || 'New Message', data.message.content || '', 'msg-' + data.channelId);
      }
    }
    function onUserTyping(data) {
      if (!data) return;
      setCurrentChannelId(curChId => {
        if (data.channelId === curChId) {
          setTypingUsers(prev => {
            const filtered = prev.filter(t => t.userId !== data.userId);
            return [...filtered, { userId: data.userId, userName: data.userName }];
          });
          if (typingTimers.current[data.userId]) clearTimeout(typingTimers.current[data.userId]);
          typingTimers.current[data.userId] = setTimeout(() => {
            setTypingUsers(prev => prev.filter(t => t.userId !== data.userId));
            delete typingTimers.current[data.userId];
          }, 3000);
        }
        return curChId;
      });
    }
    function onChannelCreated(data) {
      if (!data || !data.roomCode || !data.channel) return;
      setRooms(prev => prev.map(r => {
        if (r.code !== data.roomCode) return r;
        const channels = r.channels || [];
        if (channels.find(c => c.id === data.channel.id)) return r;
        return { ...r, channels: [...channels, data.channel] };
      }));
    }
    function onVoiceUserJoined(data) {
      if (!data) return;
      var userId = data.user ? data.user.id : data.userId;
      var userName = data.user ? data.user.name : data.userName;
      var color = data.user ? data.user.color : data.color;
      var tag = data.user ? data.user.tag : data.tag;
      var channelId = data.channelId;
      setVoiceUsers(prev => {
        if (prev.find(v => v.userId === userId && v.channelId === channelId)) return prev;
        return [...prev, { userId: userId, userName: userName, color: color, tag: tag, channelId: channelId }];
      });
      if (voiceManagerRef.current.localStream && voiceManagerRef.current.channelId === channelId) {
        voiceManagerRef.current.handleUserJoined(userId, userName);
      } else if (userName) {
        voiceManagerRef.current.peerNames.set(userId, userName);
      }
    }
    function onVoiceUserLeft(data) {
      if (!data) return;
      var userId = data.user ? data.user.id : data.userId;
      var channelId = data.channelId;
      setVoiceUsers(prev => prev.filter(v => !(v.userId === userId && v.channelId === channelId)));
      voiceManagerRef.current.handleUserLeft(userId);
    }
    function onVoiceUsers(data) {
      if (!data || !Array.isArray(data.users)) return;
      var channelId = data.channelId;
      var usersWithChannel = data.users.map(function(u) {
        return { userId: u.id || u.userId, userName: u.name || u.userName, color: u.color, tag: u.tag, channelId: channelId || u.channelId };
      });
      setVoiceUsers(function(prev) {
        var filtered = channelId ? prev.filter(function(v) { return v.channelId !== channelId; }) : prev;
        return filtered.concat(usersWithChannel);
      });
      voiceManagerRef.current.handleExistingUsers(data.users);
    }
    function onError(data) {
      var msg = (typeof data === 'string') ? data : (data && data.message ? data.message : 'Unknown error');
      setErrorMessage(msg);
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(() => setErrorMessage(null), 5000);
    }
    function onWipeWarning(data) {
      setWipeWarning(data && data.message ? data.message : 'Server wipe incoming!');
    }
    function onServerWipe() {
      setWipeWarning('Server has been wiped. All rooms and messages are gone. You will be disconnected.');
    }
    function onUpdateWarning(data) {
      if (data && data.clear) { setUpdateWarning(null); }
      else { setUpdateWarning(data && data.message ? data.message : 'Server update incoming.'); }
    }
    function onMessageDeleted(data) {
      if (!data || !data.messageId) return;
      setCurrentChannelId(function(curChId) {
        if (data.channelId === curChId) {
          setMessages(function(prev) {
            return prev.filter(function(m) { return m.id !== data.messageId; });
          });
        }
        return curChId;
      });
    }
    function onKickedFromRoom(data) {
      var reason = (data && data.reason) ? data.reason : 'You have been kicked from the room.';
      var code = (data && data.roomCode) ? data.roomCode : null;
      setErrorMessage(reason);
      if (errorTimer.current) clearTimeout(errorTimer.current);
      errorTimer.current = setTimeout(function() { setErrorMessage(null); }, 7000);
      if (code) {
        setRooms(function(prev) { return prev.filter(function(r) { return r.code !== code; }); });
        setCurrentRoomCode(function(prev) {
          if (prev === code) return null;
          return prev;
        });
      }
    }
    function onRoomSettingsUpdated(room) {
      if (!room || !room.code) return;
      setRooms(function(prev) {
        return prev.map(function(r) {
          if (r.code !== room.code) return r;
          return room;
        });
      });
    }
    function onMessagePinned(data) {
      if (!data || !data.message) return;
      setCurrentChannelId(function(curChId) {
        if (data.channelId === curChId) {
          setPinnedMessages(function(prev) {
            if (prev.find(function(m) { return m.id === data.message.id; })) return prev;
            return prev.concat([data.message]);
          });
        }
        return curChId;
      });
    }
    function onMessageUnpinned(data) {
      if (!data || !data.messageId) return;
      setCurrentChannelId(function(curChId) {
        if (data.channelId === curChId) {
          setPinnedMessages(function(prev) {
            return prev.filter(function(m) { return m.id !== data.messageId; });
          });
        }
        return curChId;
      });
    }
    function onPinnedMessages(data) {
      if (!data || !Array.isArray(data.messages)) return;
      setPinnedMessages(data.messages);
    }
    function onMessageReacted(data) {
      if (!data || !data.messageId) return;
      var reactions = data.reactions || {};
      setCurrentChannelId(function(curChId) {
        if (data.channelId === curChId) {
          setMessages(function(prev) {
            return prev.map(function(m) {
              if (m.id === data.messageId) {
                return Object.assign({}, m, { reactions: reactions });
              }
              return m;
            });
          });
        }
        return curChId;
      });
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('identity', onIdentity);
    socket.on('public_rooms', onPublicRooms);
    socket.on('public_rooms_updated', onPublicRoomsUpdated);
    socket.on('room_created', onRoomCreated);
    socket.on('room_joined', onRoomJoined);
    socket.on('room_left', onRoomLeft);
    socket.on('user_joined', onUserJoined);
    socket.on('user_left', onUserLeft);
    socket.on('channel_joined', onChannelJoined);
    socket.on('new_message', onNewMessage);
    socket.on('user_typing', onUserTyping);
    socket.on('channel_created', onChannelCreated);
    socket.on('voice_user_joined', onVoiceUserJoined);
    socket.on('voice_user_left', onVoiceUserLeft);
    socket.on('voice_users', onVoiceUsers);
    socket.on('error', onError);
    socket.on('wipe_warning', onWipeWarning);
    socket.on('update_warning', onUpdateWarning);
    socket.on('server_wipe', onServerWipe);
    socket.on('account_created', onAccountCreated);
    socket.on('account_deleted', onAccountDeleted);
    socket.on('chips_updated', onChipsUpdated);
    socket.on('slur_filter_updated', onSlurFilterUpdated);
    socket.on('message_deleted', onMessageDeleted);
    socket.on('kicked_from_room', onKickedFromRoom);
    socket.on('room_settings_updated', onRoomSettingsUpdated);
    socket.on('message_pinned', onMessagePinned);
    socket.on('message_unpinned', onMessageUnpinned);
    socket.on('pinned_messages', onPinnedMessages);
    socket.on('message_reacted', onMessageReacted);
    function onAvatarUpdated(data) {
      if (data && data.avatar) {
        setUser(function(prev) {
          if (!prev) return prev;
          return Object.assign({}, prev, { avatar: data.avatar });
        });
      }
    }
    function onServerStats(data) {
      if (data) setServerStats(data);
    }
    socket.on('avatar_updated', onAvatarUpdated);
    socket.on('server_stats', onServerStats);
    // Notification badge tracking: increment unread counts when not on respective tab
    function onBadgeDmReceived() {
      if (activeTabRef.current !== 'dms') {
        setUnreadDMs(function(prev) { return prev + 1; });
      }
    }
    function onBadgeFriendRequest() {
      if (activeTabRef.current !== 'friends') {
        setUnreadFriendRequests(function(prev) { return prev + 1; });
      }
    }
    socket.on('dm_received', onBadgeDmReceived);
    socket.on('friend_request_received', onBadgeFriendRequest);
    // pin_required, pin_setup_required, pin_set_success are registered
    // immediately in connectSocket to avoid race conditions

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('identity', onIdentity);
      socket.off('public_rooms', onPublicRooms);
      socket.off('public_rooms_updated', onPublicRoomsUpdated);
      socket.off('room_created', onRoomCreated);
      socket.off('room_joined', onRoomJoined);
      socket.off('room_left', onRoomLeft);
      socket.off('user_joined', onUserJoined);
      socket.off('user_left', onUserLeft);
      socket.off('channel_joined', onChannelJoined);
      socket.off('new_message', onNewMessage);
      socket.off('user_typing', onUserTyping);
      socket.off('channel_created', onChannelCreated);
      socket.off('voice_user_joined', onVoiceUserJoined);
      socket.off('voice_user_left', onVoiceUserLeft);
      socket.off('voice_users', onVoiceUsers);
      socket.off('error', onError);
      socket.off('wipe_warning', onWipeWarning);
      socket.off('update_warning', onUpdateWarning);
      socket.off('server_wipe', onServerWipe);
      socket.off('account_created', onAccountCreated);
      socket.off('account_deleted', onAccountDeleted);
      socket.off('chips_updated', onChipsUpdated);
      socket.off('slur_filter_updated', onSlurFilterUpdated);
      socket.off('message_deleted', onMessageDeleted);
      socket.off('kicked_from_room', onKickedFromRoom);
      socket.off('room_settings_updated', onRoomSettingsUpdated);
      socket.off('message_pinned', onMessagePinned);
      socket.off('message_unpinned', onMessageUnpinned);
      socket.off('pinned_messages', onPinnedMessages);
      socket.off('message_reacted', onMessageReacted);
      socket.off('avatar_updated', onAvatarUpdated);
      socket.off('server_stats', onServerStats);
      socket.off('dm_received', onBadgeDmReceived);
      socket.off('friend_request_received', onBadgeFriendRequest);
      // pin_required, pin_setup_required, pin_set_success cleanup happens on socket disconnect
      Object.values(typingTimers.current).forEach(t => clearTimeout(t));
      typingTimers.current = {};
    };
  }, [socket]);

  useEffect(() => {
    if (!currentRoomCode) {
      setCurrentChannelId(null);
      setMessages([]);
      setTypingUsers([]);
      setPinnedMessages([]);
    }
  }, [currentRoomCode]);

  useEffect(() => {
    var vm = voiceManagerRef.current;
    vm.onMuteChange = function(muted) { setIsMuted(muted); };
    vm.onDeafenChange = function(deafened) { setIsDeafened(deafened); };
    vm.onError = function(msg) {
      setVoiceError(msg);
      setTimeout(function() { setVoiceError(null); }, 5000);
    };

    function handleBeforeUnload() {
      vm.cleanup();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);

    return function() {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      vm.onMuteChange = null;
      vm.onDeafenChange = null;
      vm.onError = null;
    };
  }, []);

  const value = useMemo(() => ({
    socket, user, rooms, publicRooms, currentRoom, currentChannel,
    currentRoomCode, setCurrentRoomCode,
    currentChannelId, setCurrentChannelId,
    messages, setMessages, typingUsers, voiceUsers, setVoiceUsers,
    errorMessage, wipeWarning, updateWarning, connected,
    connectSocket, disconnectSocket,
    currentVoiceChannel, setCurrentVoiceChannel,
    voiceManager: voiceManagerRef.current,
    isMuted, setIsMuted, isDeafened, setIsDeafened, voiceError,
    account, accountKey, createAccount, deleteAccount,
    slurFilterEnabled, toggleSlurFilter, censorText,
    powStatus, pinRequired, pinSetupRequired,
    pinnedMessages, setPinnedMessages,
    gamesSocket, marketSocket, connectGames, connectMarket,
    serverStats,
    unreadDMs, setUnreadDMs, unreadFriendRequests, setUnreadFriendRequests,
    activeTab, setActiveTab
  }), [socket, user, rooms, publicRooms, currentRoom, currentChannel,
    currentRoomCode, currentChannelId, messages, typingUsers,
    voiceUsers, errorMessage, wipeWarning, updateWarning, connected,
    connectSocket, disconnectSocket, currentVoiceChannel,
    isMuted, isDeafened, voiceError, account, accountKey, createAccount, deleteAccount,
    slurFilterEnabled, toggleSlurFilter, censorText, powStatus, pinRequired, pinSetupRequired,
    pinnedMessages,
    gamesSocket, marketSocket, connectGames, connectMarket,
    serverStats,
    unreadDMs, unreadFriendRequests, activeTab]);

  return React.createElement(SocketContext.Provider, { value }, children);
}

function useSocket() { return useContext(SocketContext); }

// ===================== UTILITY =====================
function formatTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var now = new Date();
  var hh = d.getHours();
  var mm = d.getMinutes();
  var ampm = hh >= 12 ? 'PM' : 'AM';
  hh = hh % 12; if (hh === 0) hh = 12;
  var mmStr = mm < 10 ? '0' + mm : '' + mm;
  var timeStr = hh + ':' + mmStr + ' ' + ampm;
  var isToday = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  var yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  var isYesterday = d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
  if (isToday) return 'Today at ' + timeStr;
  if (isYesterday) return 'Yesterday at ' + timeStr;
  return (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear() + ' ' + timeStr;
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = 0;
  var size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return size.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function formatTimeAgo(ts) {
  if (!ts) return '';
  var now = Date.now();
  var diff = now - new Date(ts).getTime();
  var secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  var mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  return days + 'd ago';
}

function formatTimeUntil(ts) {
  if (!ts) return '';
  var now = Date.now();
  var diff = new Date(ts).getTime() - now;
  if (diff <= 0) return 'expired';
  var secs = Math.floor(diff / 1000);
  var mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm';
  var hrs = Math.floor(mins / 60);
  var remainMins = mins % 60;
  if (hrs < 24) return hrs + 'h ' + remainMins + 'm';
  var days = Math.floor(hrs / 24);
  return days + 'd ' + (hrs % 24) + 'h';
}

var MAX_CLIENT_MESSAGES = 200;
function appendMessage(prev, msg) {
  var next = prev.concat(Array.isArray(msg) ? msg : [msg]);
  if (next.length > MAX_CLIENT_MESSAGES) next = next.slice(next.length - MAX_CLIENT_MESSAGES);
  return next;
}

function isGifUrl(text) {
  if (!text) return false;
  var trimmed = text.trim();
  return trimmed.startsWith('https://media.tenor.com/') || trimmed.startsWith('https://media1.tenor.com/');
}

function blockPaste(e) { e.preventDefault(); }
function blockDrop(e) { e.preventDefault(); }
