// sound-manager.js — Lightweight Web Audio API sound system for BossCord
// Synthesized sounds (no external audio files needed), zero dependencies
// Security: No eval, no innerHTML, no dynamic script loading
// Performance: Sounds created on-demand, AudioContext resumed on user gesture

(function() {
  'use strict';

  var ctx = null;
  var masterGain = null;
  var muted = false;
  var masterVolume = 0.5;
  var initialized = false;
  var MAX_CONCURRENT = 8;
  var activeSounds = 0;

  // Attempt to get/create AudioContext
  function getCtx() {
    if (ctx) return ctx;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = masterVolume;
      masterGain.connect(ctx.destination);
      initialized = true;
    } catch (e) {
      // Web Audio not supported
    }
    return ctx;
  }

  // Resume context on user gesture (Chrome autoplay policy)
  function ensureResumed() {
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(function() {});
    }
  }

  // One-time gesture listener to unlock audio
  var gestureAttached = false;
  function attachGestureListener() {
    if (gestureAttached) return;
    gestureAttached = true;
    var events = ['click', 'touchstart', 'keydown'];
    function onGesture() {
      getCtx();
      ensureResumed();
      events.forEach(function(e) { document.removeEventListener(e, onGesture, true); });
    }
    events.forEach(function(e) { document.addEventListener(e, onGesture, true); });
  }
  attachGestureListener();

  // --- Synth helpers ---

  function noise(duration, volume) {
    var ac = getCtx();
    if (!ac) return null;
    var len = Math.floor(ac.sampleRate * duration);
    var buf = ac.createBuffer(1, len, ac.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (volume || 0.3);
    }
    return buf;
  }

  function playBuffer(buf, vol, detune) {
    var ac = getCtx();
    if (!ac || !buf) return;
    var src = ac.createBufferSource();
    src.buffer = buf;
    if (detune) src.detune.value = detune;
    var g = ac.createGain();
    g.gain.value = vol || 0.5;
    src.connect(g);
    g.connect(masterGain);
    src.start(0);
    return src;
  }

  function osc(type, freq, duration, vol, rampTo) {
    var ac = getCtx();
    if (!ac) return;
    var o = ac.createOscillator();
    var g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.3, ac.currentTime);
    if (rampTo !== undefined) {
      g.gain.exponentialRampToValueAtTime(Math.max(rampTo, 0.001), ac.currentTime + duration);
    } else {
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
    }
    o.connect(g);
    g.connect(masterGain);
    o.start(ac.currentTime);
    o.stop(ac.currentTime + duration + 0.05);
  }

  // --- Sound definitions (all synthesized) ---

  var sounds = {
    click: function() {
      osc('sine', 800, 0.06, 0.15);
      osc('sine', 600, 0.04, 0.08);
    },

    coin: function() {
      osc('sine', 1200, 0.08, 0.2);
      setTimeout(function() { osc('sine', 1600, 0.06, 0.15); }, 40);
      setTimeout(function() { osc('sine', 2000, 0.05, 0.1); }, 80);
    },

    card_slide: function() {
      var ac = getCtx();
      if (!ac) return;
      var buf = noise(0.08, 0.15);
      playBuffer(buf, 0.2);
    },

    card_flip: function() {
      var ac = getCtx();
      if (!ac) return;
      var buf = noise(0.04, 0.2);
      playBuffer(buf, 0.15);
      osc('sine', 400, 0.05, 0.1);
    },

    chip_stack: function() {
      osc('sine', 500, 0.04, 0.12);
      setTimeout(function() { osc('sine', 600, 0.03, 0.1); }, 30);
      setTimeout(function() { osc('sine', 700, 0.03, 0.08); }, 55);
    },

    reel_spin: function() {
      osc('sawtooth', 200, 0.3, 0.08);
    },

    reel_stop: function() {
      osc('sine', 350, 0.08, 0.15);
      var ac = getCtx();
      if (!ac) return;
      var buf = noise(0.03, 0.2);
      playBuffer(buf, 0.1);
    },

    peg_plink: function() {
      var freq = 800 + Math.random() * 800;
      osc('sine', freq, 0.06, 0.1);
    },

    scratch: function() {
      var ac = getCtx();
      if (!ac) return;
      var buf = noise(0.15, 0.12);
      playBuffer(buf, 0.15);
    },

    win_small: function() {
      osc('sine', 523, 0.12, 0.2);
      setTimeout(function() { osc('sine', 659, 0.12, 0.2); }, 100);
      setTimeout(function() { osc('sine', 784, 0.15, 0.2); }, 200);
    },

    win_medium: function() {
      osc('sine', 523, 0.1, 0.25);
      setTimeout(function() { osc('sine', 659, 0.1, 0.25); }, 80);
      setTimeout(function() { osc('sine', 784, 0.1, 0.25); }, 160);
      setTimeout(function() { osc('sine', 1047, 0.2, 0.3); }, 240);
    },

    win_big: function() {
      osc('sine', 523, 0.08, 0.3);
      setTimeout(function() { osc('sine', 659, 0.08, 0.3); }, 60);
      setTimeout(function() { osc('sine', 784, 0.08, 0.3); }, 120);
      setTimeout(function() { osc('sine', 1047, 0.08, 0.35); }, 180);
      setTimeout(function() { osc('triangle', 1319, 0.15, 0.3); }, 240);
      setTimeout(function() { osc('triangle', 1568, 0.25, 0.35); }, 320);
    },

    loss: function() {
      osc('sine', 400, 0.15, 0.15);
      setTimeout(function() { osc('sine', 300, 0.2, 0.12); }, 120);
    },

    notification: function() {
      osc('sine', 880, 0.08, 0.15);
      setTimeout(function() { osc('sine', 1100, 0.1, 0.15); }, 80);
    },

    gunfire: function() {
      var ac = getCtx();
      if (!ac) return;
      var buf = noise(0.06, 0.5);
      playBuffer(buf, 0.25);
      osc('sawtooth', 150, 0.05, 0.15);
    },

    explosion: function() {
      var ac = getCtx();
      if (!ac) return;
      var buf = noise(0.25, 0.4);
      playBuffer(buf, 0.3);
      osc('sawtooth', 80, 0.2, 0.2);
    },

    hit: function() {
      var ac = getCtx();
      if (!ac) return;
      var buf = noise(0.04, 0.3);
      playBuffer(buf, 0.2);
      osc('sine', 200, 0.05, 0.15);
    },

    gallop: function() {
      osc('sine', 120, 0.04, 0.1);
      setTimeout(function() { osc('sine', 100, 0.04, 0.08); }, 60);
    },

    crowd_cheer: function() {
      var ac = getCtx();
      if (!ac) return;
      var buf = noise(0.4, 0.15);
      playBuffer(buf, 0.2);
      osc('sawtooth', 300, 0.3, 0.05);
    },

    pop: function() {
      osc('sine', 600, 0.05, 0.15);
      osc('sine', 900, 0.03, 0.1);
    },

    whoosh: function() {
      var ac = getCtx();
      if (!ac) return;
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(200, ac.currentTime);
      o.frequency.exponentialRampToValueAtTime(800, ac.currentTime + 0.1);
      g.gain.setValueAtTime(0.1, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
      o.connect(g);
      g.connect(masterGain);
      o.start(ac.currentTime);
      o.stop(ac.currentTime + 0.2);
    },

    pocket: function() {
      osc('sine', 300, 0.08, 0.15);
      setTimeout(function() { osc('sine', 200, 0.1, 0.1); }, 50);
    },

    bounce: function() {
      osc('sine', 500, 0.04, 0.1);
    },

    check: function() {
      osc('sine', 660, 0.06, 0.12);
      setTimeout(function() { osc('sine', 880, 0.08, 0.15); }, 60);
    },

    piece_move: function() {
      osc('sine', 440, 0.04, 0.08);
    },

    capture: function() {
      osc('sine', 600, 0.05, 0.15);
      var ac = getCtx();
      if (!ac) return;
      var buf = noise(0.03, 0.15);
      playBuffer(buf, 0.1);
    },

    countdown: function() {
      osc('sine', 440, 0.1, 0.2);
    },

    race_start: function() {
      osc('sine', 440, 0.15, 0.2);
      setTimeout(function() { osc('sine', 440, 0.15, 0.2); }, 200);
      setTimeout(function() { osc('sine', 880, 0.25, 0.3); }, 400);
    },

    boost: function() {
      var ac = getCtx();
      if (!ac) return;
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(400, ac.currentTime);
      o.frequency.exponentialRampToValueAtTime(1200, ac.currentTime + 0.15);
      g.gain.setValueAtTime(0.12, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.2);
      o.connect(g);
      g.connect(masterGain);
      o.start(ac.currentTime);
      o.stop(ac.currentTime + 0.25);
    }
  };

  // --- Public API ---

  window.BossSounds = {
    play: function(name) {
      if (muted || !sounds[name]) return;
      if (activeSounds >= MAX_CONCURRENT) return;
      ensureResumed();
      activeSounds++;
      try {
        sounds[name]();
      } catch (e) { /* swallow */ }
      setTimeout(function() { activeSounds = Math.max(0, activeSounds - 1); }, 200);
    },

    setMasterVolume: function(v) {
      masterVolume = Math.max(0, Math.min(1, v));
      if (masterGain) masterGain.gain.value = masterVolume;
    },

    getMasterVolume: function() { return masterVolume; },

    setMuted: function(m) {
      muted = !!m;
      if (masterGain) masterGain.gain.value = muted ? 0 : masterVolume;
    },

    isMuted: function() { return muted; },

    toggleMute: function() {
      this.setMuted(!muted);
      return muted;
    },

    isSupported: function() {
      return !!(window.AudioContext || window.webkitAudioContext);
    }
  };

  // Load mute preference from localStorage
  try {
    var savedMute = localStorage.getItem('bosscord_sound_muted');
    if (savedMute === 'true') muted = true;
    var savedVol = localStorage.getItem('bosscord_sound_volume');
    if (savedVol !== null) masterVolume = Math.max(0, Math.min(1, parseFloat(savedVol) || 0.5));
  } catch (e) { /* localStorage not available */ }

  // Save mute preference on change
  var origSetMuted = window.BossSounds.setMuted;
  window.BossSounds.setMuted = function(m) {
    origSetMuted.call(this, m);
    try { localStorage.setItem('bosscord_sound_muted', String(muted)); } catch (e) {}
  };
  var origSetVol = window.BossSounds.setMasterVolume;
  window.BossSounds.setMasterVolume = function(v) {
    origSetVol.call(this, v);
    try { localStorage.setItem('bosscord_sound_volume', String(masterVolume)); } catch (e) {}
  };

})();
