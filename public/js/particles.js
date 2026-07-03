// particles.js — Shared particle system for BossCord
// Pure Canvas 2D, no dependencies, hard-capped particle counts
// Security: No eval, no innerHTML, no user-controlled CSS injection
// Performance: requestAnimationFrame, visibility pause, prefers-reduced-motion

(function() {
  'use strict';

  var MAX_PARTICLES = 200;
  var isMobile = navigator.maxTouchPoints > 0;
  var prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Particle base ---

  function ParticleEmitter(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.running = false;
    this.animId = null;
    this.maxCount = Math.min(opts.maxCount || 100, MAX_PARTICLES);
    if (isMobile) this.maxCount = Math.floor(this.maxCount * 0.5);
  }

  ParticleEmitter.prototype.add = function(p) {
    if (this.particles.length >= this.maxCount) return;
    this.particles.push(p);
  };

  ParticleEmitter.prototype.start = function(updateFn, drawFn, onDone) {
    if (prefersReduced) { if (onDone) onDone(); return; }
    var self = this;
    this.running = true;
    var lastTime = performance.now();

    function loop(now) {
      if (!self.running) return;
      var dt = Math.min((now - lastTime) / 1000, 0.05); // cap dt to avoid spiral
      lastTime = now;

      // Update
      for (var i = self.particles.length - 1; i >= 0; i--) {
        if (!updateFn(self.particles[i], dt)) {
          self.particles.splice(i, 1);
        }
      }

      // Draw
      self.ctx.save();
      for (var j = 0; j < self.particles.length; j++) {
        drawFn(self.ctx, self.particles[j]);
      }
      self.ctx.restore();

      if (self.particles.length === 0) {
        self.running = false;
        if (onDone) onDone();
        return;
      }

      self.animId = requestAnimationFrame(loop);
    }

    this.animId = requestAnimationFrame(loop);
  };

  ParticleEmitter.prototype.stop = function() {
    this.running = false;
    if (this.animId) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
    this.particles = [];
  };

  // --- Preset: Confetti ---

  function confetti(canvas, opts) {
    opts = opts || {};
    var count = Math.min(opts.count || 40, isMobile ? 25 : 60);
    var cx = opts.x !== undefined ? opts.x : canvas.width / 2;
    var cy = opts.y !== undefined ? opts.y : canvas.height * 0.3;
    var colors = opts.colors || ['#f0b232', '#57f287', '#5865f2', '#ed4245', '#fee75c', '#eb459e'];
    var gravity = opts.gravity || 400;
    var spread = opts.spread || 360;

    var emitter = new ParticleEmitter(canvas, { maxCount: count });

    for (var i = 0; i < count; i++) {
      var angle = (spread === 360)
        ? Math.random() * Math.PI * 2
        : (-Math.PI / 2) + (Math.random() - 0.5) * (spread * Math.PI / 180);
      var speed = 150 + Math.random() * 300;
      emitter.add({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 10,
        life: 1.5 + Math.random() * 1,
        age: 0,
        shape: Math.random() > 0.5 ? 'rect' : 'circle'
      });
    }

    emitter.start(
      function update(p, dt) {
        p.age += dt;
        if (p.age >= p.life) return false;
        p.vy += gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.rotSpeed * dt;
        p.vx *= 0.99;
        return true;
      },
      function draw(ctx, p) {
        var alpha = Math.max(0, 1 - p.age / p.life);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      },
      opts.onDone
    );

    return emitter;
  }

  // --- Preset: Coin Rain ---

  function coinRain(canvas, opts) {
    opts = opts || {};
    var count = Math.min(opts.count || 25, isMobile ? 15 : 35);
    var emitter = new ParticleEmitter(canvas, { maxCount: count });
    var w = canvas.width;

    for (var i = 0; i < count; i++) {
      emitter.add({
        x: Math.random() * w,
        y: -10 - Math.random() * 60,
        vx: (Math.random() - 0.5) * 40,
        vy: 80 + Math.random() * 120,
        size: 6 + Math.random() * 6,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 5,
        life: 2 + Math.random() * 1,
        age: Math.random() * 0.3, // stagger
        shimmer: Math.random() * Math.PI * 2
      });
    }

    emitter.start(
      function update(p, dt) {
        p.age += dt;
        if (p.age >= p.life || p.y > canvas.height + 20) return false;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.rotSpeed * dt;
        p.shimmer += dt * 6;
        return true;
      },
      function draw(ctx, p) {
        var alpha = Math.max(0, 1 - p.age / p.life);
        var shimVal = 0.7 + 0.3 * Math.sin(p.shimmer);
        ctx.globalAlpha = alpha * shimVal;
        ctx.fillStyle = '#f0b232';
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.beginPath();
        ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#c8941e';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      },
      opts.onDone
    );

    return emitter;
  }

  // --- Preset: Sparks ---

  function sparks(canvas, x, y, opts) {
    opts = opts || {};
    var count = Math.min(opts.count || 12, isMobile ? 8 : 20);
    var color = opts.color || '#f0b232';
    var emitter = new ParticleEmitter(canvas, { maxCount: count });

    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 60 + Math.random() * 150;
      emitter.add({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 1.5 + Math.random() * 2,
        life: 0.3 + Math.random() * 0.4,
        age: 0,
        color: color
      });
    }

    emitter.start(
      function update(p, dt) {
        p.age += dt;
        if (p.age >= p.life) return false;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 0.95;
        p.vy *= 0.95;
        return true;
      },
      function draw(ctx, p) {
        var alpha = Math.max(0, 1 - p.age / p.life);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      },
      opts.onDone
    );

    return emitter;
  }

  // --- Preset: Dust/Debris ---

  function dust(canvas, x, y, opts) {
    opts = opts || {};
    var count = Math.min(opts.count || 8, isMobile ? 5 : 12);
    var color = opts.color || '#8B7355';
    var emitter = new ParticleEmitter(canvas, { maxCount: count });

    for (var i = 0; i < count; i++) {
      var angle = opts.angle !== undefined
        ? opts.angle + (Math.random() - 0.5) * 1.2
        : Math.random() * Math.PI * 2;
      var speed = 30 + Math.random() * 80;
      emitter.add({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 20,
        size: 2 + Math.random() * 3,
        life: 0.5 + Math.random() * 0.5,
        age: 0,
        color: color,
        gravity: 120
      });
    }

    emitter.start(
      function update(p, dt) {
        p.age += dt;
        if (p.age >= p.life) return false;
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.size *= 0.98;
        return true;
      },
      function draw(ctx, p) {
        var alpha = Math.max(0, 1 - p.age / p.life) * 0.6;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      },
      opts.onDone
    );

    return emitter;
  }

  // --- Preset: Glow Orbs ---

  function glowOrbs(canvas, x, y, opts) {
    opts = opts || {};
    var count = Math.min(opts.count || 8, isMobile ? 5 : 12);
    var color = opts.color || '#5865f2';
    var emitter = new ParticleEmitter(canvas, { maxCount: count });

    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = 20 + Math.random() * 60;
      emitter.add({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 30,
        size: 3 + Math.random() * 5,
        life: 0.8 + Math.random() * 0.6,
        age: 0,
        color: color,
        pulse: Math.random() * Math.PI * 2
      });
    }

    emitter.start(
      function update(p, dt) {
        p.age += dt;
        if (p.age >= p.life) return false;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy -= 15 * dt; // float up
        p.vx *= 0.98;
        p.pulse += dt * 4;
        return true;
      },
      function draw(ctx, p) {
        var alpha = Math.max(0, 1 - p.age / p.life);
        var pulseSize = p.size * (0.8 + 0.2 * Math.sin(p.pulse));
        ctx.globalAlpha = alpha * 0.4;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulseSize * 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha * 0.8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, pulseSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      },
      opts.onDone
    );

    return emitter;
  }

  // --- Preset: Trail (for moving objects) ---

  function trail(canvas, opts) {
    opts = opts || {};
    var color = opts.color || '#f0b232';
    var emitter = new ParticleEmitter(canvas, { maxCount: opts.maxCount || 30 });

    emitter.addPoint = function(x, y) {
      if (this.particles.length >= this.maxCount) {
        this.particles.shift();
      }
      this.particles.push({
        x: x, y: y,
        size: opts.size || 3,
        life: opts.life || 0.4,
        age: 0,
        color: color
      });
    };

    emitter.startTrail = function() {
      var self = this;
      this.running = true;
      var lastTime = performance.now();

      function loop(now) {
        if (!self.running) return;
        var dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;

        for (var i = self.particles.length - 1; i >= 0; i--) {
          self.particles[i].age += dt;
          if (self.particles[i].age >= self.particles[i].life) {
            self.particles.splice(i, 1);
          }
        }

        self.animId = requestAnimationFrame(loop);
      }

      this.animId = requestAnimationFrame(loop);
    };

    emitter.drawTrail = function(ctx) {
      for (var j = 0; j < this.particles.length; j++) {
        var p = this.particles[j];
        var alpha = Math.max(0, 1 - p.age / p.life) * 0.6;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - p.age / p.life), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    return emitter;
  }

  // --- Public API ---

  window.BossParticles = {
    confetti: confetti,
    coinRain: coinRain,
    sparks: sparks,
    dust: dust,
    glowOrbs: glowOrbs,
    trail: trail,
    Emitter: ParticleEmitter,
    isMobile: isMobile,
    prefersReduced: prefersReduced
  };

})();
