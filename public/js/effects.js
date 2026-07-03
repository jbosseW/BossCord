// effects.js — Shared visual effects utilities for BossCord
// Screen shake, win celebrations, number rolls, flash overlays
// Security: No eval, no innerHTML, all styles via DOM API
// Performance: CSS transforms only, respects prefers-reduced-motion

(function() {
  'use strict';

  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Screen Shake ---
  // Applies CSS transform jitter to an element
  function screenShake(el, intensity, duration) {
    if (!el || prefersReduced) return;
    intensity = intensity || 5;
    duration = duration || 250;
    var start = performance.now();
    var origTransform = el.style.transform || '';

    function shake(now) {
      var elapsed = now - start;
      if (elapsed >= duration) {
        el.style.transform = origTransform;
        return;
      }
      var decay = 1 - elapsed / duration;
      var dx = (Math.random() - 0.5) * 2 * intensity * decay;
      var dy = (Math.random() - 0.5) * 2 * intensity * decay;
      el.style.transform = origTransform + ' translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      requestAnimationFrame(shake);
    }

    requestAnimationFrame(shake);
  }

  // --- Canvas Shake ---
  // Returns offset {x, y} to apply to canvas translate
  var canvasShakes = new Map();

  function startCanvasShake(canvasId, intensity, duration) {
    if (prefersReduced) return;
    canvasShakes.set(canvasId, {
      intensity: intensity || 4,
      duration: duration || 200,
      start: performance.now()
    });
  }

  function getCanvasShakeOffset(canvasId) {
    var shake = canvasShakes.get(canvasId);
    if (!shake) return { x: 0, y: 0 };
    var elapsed = performance.now() - shake.start;
    if (elapsed >= shake.duration) {
      canvasShakes.delete(canvasId);
      return { x: 0, y: 0 };
    }
    var decay = 1 - elapsed / shake.duration;
    return {
      x: (Math.random() - 0.5) * 2 * shake.intensity * decay,
      y: (Math.random() - 0.5) * 2 * shake.intensity * decay
    };
  }

  // --- Flash Overlay ---
  // Brief color flash over an element
  function flashOverlay(el, color, duration) {
    if (!el || prefersReduced) return;
    color = color || 'rgba(240,178,50,0.3)';
    duration = duration || 300;
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:9999;background:' + color + ';transition:opacity ' + duration + 'ms ease;opacity:1;';
    el.style.position = el.style.position || 'relative';
    el.appendChild(overlay);
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        overlay.style.opacity = '0';
        setTimeout(function() {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, duration + 50);
      });
    });
  }

  // --- Win Celebrations ---

  function celebrateSmall(el) {
    if (!el) return;
    // Gold border glow pulse
    var orig = el.style.boxShadow;
    el.style.boxShadow = '0 0 20px rgba(240,178,50,0.5), 0 0 40px rgba(240,178,50,0.2)';
    el.style.transition = 'box-shadow 0.3s ease';
    if (window.BossSounds) window.BossSounds.play('win_small');
    setTimeout(function() {
      el.style.boxShadow = orig || '';
      el.style.transition = '';
    }, 1500);
  }

  function celebrateMedium(el, canvas) {
    if (!el) return;
    // Screen pulse
    flashOverlay(el, 'rgba(240,178,50,0.15)', 400);
    // Sound
    if (window.BossSounds) window.BossSounds.play('win_medium');
    // Coin rain if canvas provided
    if (canvas && window.BossParticles) {
      window.BossParticles.coinRain(canvas, { count: 20 });
    }
    // Glow
    var orig = el.style.boxShadow;
    el.style.boxShadow = '0 0 30px rgba(240,178,50,0.5), 0 0 60px rgba(240,178,50,0.2)';
    el.style.transition = 'box-shadow 0.4s ease';
    setTimeout(function() {
      el.style.boxShadow = orig || '';
      el.style.transition = '';
    }, 2000);
  }

  function celebrateBig(el, canvas) {
    if (!el) return;
    // Full gold flash
    flashOverlay(el, 'rgba(240,178,50,0.25)', 500);
    // Screen shake
    screenShake(el, 8, 400);
    // Sound
    if (window.BossSounds) window.BossSounds.play('win_big');
    // Confetti if canvas provided
    if (canvas && window.BossParticles) {
      window.BossParticles.confetti(canvas, { count: 50 });
    }
    // Intense glow
    var orig = el.style.boxShadow;
    el.style.boxShadow = '0 0 40px rgba(240,178,50,0.6), 0 0 80px rgba(240,178,50,0.3)';
    el.style.transition = 'box-shadow 0.5s ease';
    setTimeout(function() {
      el.style.boxShadow = orig || '';
      el.style.transition = '';
    }, 3000);
  }

  // --- Number Roll ---
  // Animates a number element from current value to target
  function numberRoll(el, from, to, duration, formatter) {
    if (!el || prefersReduced) {
      if (el) el.textContent = formatter ? formatter(to) : to.toLocaleString();
      return;
    }
    duration = duration || 600;
    var start = performance.now();
    var diff = to - from;

    function tick(now) {
      var elapsed = now - start;
      var progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      var ease = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(from + diff * ease);
      el.textContent = formatter ? formatter(current) : current.toLocaleString();
      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  }

  // --- Floating Text ---
  // Spawns a floating "+500" text that rises and fades
  function floatingText(container, text, opts) {
    if (!container || prefersReduced) return;
    opts = opts || {};
    var div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = 'position:absolute;left:' + (opts.x || '50%') + ';top:' + (opts.y || '50%') + ';transform:translate(-50%,-50%);color:' + (opts.color || '#f0b232') + ';font-size:' + (opts.fontSize || '18px') + ';font-weight:700;pointer-events:none;z-index:9999;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,0.5);';
    container.style.position = container.style.position || 'relative';
    container.appendChild(div);

    var start = performance.now();
    var dur = opts.duration || 1000;

    function animate(now) {
      var elapsed = now - start;
      var progress = Math.min(elapsed / dur, 1);
      div.style.transform = 'translate(-50%,' + (-50 - progress * 40) + '%) scale(' + (1 + progress * 0.2) + ')';
      div.style.opacity = String(1 - progress);
      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        if (div.parentNode) div.parentNode.removeChild(div);
      }
    }

    requestAnimationFrame(animate);
  }

  // --- Pulse Glow ---
  // Adds a temporary pulsing glow to an element
  function pulseGlow(el, color, duration) {
    if (!el || prefersReduced) return;
    color = color || 'rgba(240,178,50,0.5)';
    duration = duration || 1000;
    var orig = el.style.boxShadow;
    var start = performance.now();

    function pulse(now) {
      var elapsed = now - start;
      if (elapsed >= duration) {
        el.style.boxShadow = orig || '';
        return;
      }
      var progress = elapsed / duration;
      var intensity = Math.sin(progress * Math.PI) * 0.6;
      el.style.boxShadow = '0 0 ' + Math.round(20 * intensity) + 'px ' + color;
      requestAnimationFrame(pulse);
    }

    requestAnimationFrame(pulse);
  }

  // --- Safe Canvas Text ---
  // Sanitizes text for canvas rendering (strips control chars, truncates)
  function safeCanvasText(text, maxLen) {
    if (!text || typeof text !== 'string') return '???';
    return text.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u00AD\u0000-\u001F]/g, '').slice(0, maxLen || 20);
  }

  // --- Public API ---

  window.BossEffects = {
    screenShake: screenShake,
    startCanvasShake: startCanvasShake,
    getCanvasShakeOffset: getCanvasShakeOffset,
    flashOverlay: flashOverlay,
    celebrateSmall: celebrateSmall,
    celebrateMedium: celebrateMedium,
    celebrateBig: celebrateBig,
    numberRoll: numberRoll,
    floatingText: floatingText,
    pulseGlow: pulseGlow,
    safeCanvasText: safeCanvasText,
    prefersReduced: prefersReduced
  };

})();
