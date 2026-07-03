
// ===================== GAMES TAB — Game Hub with BossOrbs, Card Games, Slot Machine =====================

// ---------- BossOrbs (multiplayer orb game) ----------
function BossOrbsGame() {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var [inGame, setInGame] = useState(false);
  var [deathMsg, setDeathMsg] = useState(null);
  var [killMsg, setKillMsg] = useState(null);
  var [leaderboard, setLeaderboard] = useState([]);
  var [myScore, setMyScore] = useState(0);
  var [instances, setInstances] = useState([]);
  var [currentInstance, setCurrentInstance] = useState(null);
  var canvasRef = useRef(null);
  var playersRef = useRef([]);
  var orbsRef = useRef([]);
  var localRef = useRef(null);
  var mouseRef = useRef({ x: 0, y: 0 });
  var animRef = useRef(null);
  var moveThrottle = useRef(0);
  var lastSentIdle = useRef(false);
  var mapSizeRef = useRef({ w: 6000, h: 6000 });
  var orbsBoostActiveRef = useRef(false);
  var orbsGrowthPulseRef = useRef({ active: false, startTime: 0, lastRadius: 0 });
  var orbsFrameCounter = useRef(0);

  // Lazy-connect to /games namespace on mount
  useEffect(function() { ctx.connectGames(); }, []);
  var sock = ctx.gamesSocket || ctx.socket;

  // Fetch instance list periodically when in lobby
  useEffect(function() {
    if (!sock || inGame) return;
    function fetchInstances() {
      sock.emit('game_list_instances');
    }
    fetchInstances();
    var interval = setInterval(fetchInstances, 3000);

    function onInstances(data) {
      setInstances(data || []);
    }
    sock.on('game_instances', onInstances);

    return function() {
      clearInterval(interval);
      sock.off('game_instances', onInstances);
    };
  }, [sock, inGame]);

  function joinGame(instanceId) {
    if (!sock) return;
    sock.emit('game_join', instanceId ? { instanceId: instanceId } : {});
    setInGame(true);
    setDeathMsg(null);
    setMyScore(0);
  }

  function leaveGame() {
    if (sock) sock.emit('game_leave');
    setInGame(false);
    setCurrentInstance(null);
    localRef.current = null;
    playersRef.current = [];
    orbsRef.current = [];
  }

  // Socket listeners
  useEffect(function() {
    if (!sock) return;

    function onGameState(data) {
      playersRef.current = data.players || [];
      orbsRef.current = data.orbs || [];
      if (data.mapWidth) mapSizeRef.current = { w: data.mapWidth, h: data.mapHeight };
      setLeaderboard(data.leaderboard || []);
      if (data.instanceId) setCurrentInstance(data.instanceId);
      var me = (data.players || []).find(function(p) { return p.id === sock.id; });
      localRef.current = me || null;
      if (me) setMyScore(me.score);
    }

    function onGamePlayers(data) {
      playersRef.current = data.players || [];
      setLeaderboard(data.leaderboard || []);
      var me = (data.players || []).find(function(p) { return p.id === sock.id; });
      localRef.current = me || null;
      if (me) setMyScore(me.score);
    }

    function onOrbEaten(data) {
      // VFX: Pop particle on eat
      if (window.BossParticles && canvasRef.current && data.orbId) {
        // Find the orb before removing it to get its position and color
        var eatenOrb = null;
        for (var oi = 0; oi < orbsRef.current.length; oi++) {
          if (orbsRef.current[oi].id === data.orbId) {
            eatenOrb = orbsRef.current[oi];
            break;
          }
        }
        if (eatenOrb) {
          BossParticles.sparks(canvasRef.current, eatenOrb.x, eatenOrb.y, { count: 4, color: eatenOrb.color || '#57f287' });
        }
      }
      orbsRef.current = orbsRef.current.filter(function(o) { return o.id !== data.orbId; });
    }

    function onOrbSpawned(data) {
      if (data.orb) orbsRef.current.push(data.orb);
    }

    function onPlayerEaten(data) {
      if (data.eaten === sock.id || (ctx.user && data.eaten === ctx.user.id)) {
        setDeathMsg('Eaten by ' + data.byName + '!');
        localRef.current = null;
        setMyScore(0);
        // Instant respawn - rejoin same instance
        sock.emit('game_leave');
        sock.emit('game_join', currentInstance ? { instanceId: currentInstance } : {});
        // Clear death message after 3 seconds
        setTimeout(function() { setDeathMsg(null); }, 3000);
      } else if (data.by === sock.id) {
        // We ate someone — show kill reward + growth pulse + sound
        setKillMsg('Ate ' + data.eatenName + '! +50 chips');
        setTimeout(function() { setKillMsg(null); }, 2500);
        if (window.BossSounds) BossSounds.play('pop');
        orbsGrowthPulseRef.current = { active: true, startTime: Date.now(), lastRadius: localRef.current ? localRef.current.radius : 0 };
      }
    }

    function onPlayerLeft(data) {
      playersRef.current = playersRef.current.filter(function(p) { return p.id !== data.id; });
    }

    sock.on('game_state', onGameState);
    sock.on('game_players', onGamePlayers);
    sock.on('game_orb_eaten', onOrbEaten);
    sock.on('game_orb_spawned', onOrbSpawned);
    sock.on('game_player_eaten', onPlayerEaten);
    sock.on('game_player_left', onPlayerLeft);

    return function() {
      sock.off('game_state', onGameState);
      sock.off('game_players', onGamePlayers);
      sock.off('game_orb_eaten', onOrbEaten);
      sock.off('game_orb_spawned', onOrbSpawned);
      sock.off('game_player_eaten', onPlayerEaten);
      sock.off('game_player_left', onPlayerLeft);
    };
  }, [sock, currentInstance]);

  // Canvas render loop
  useEffect(function() {
    if (!inGame) {
      if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
      return;
    }
    var canvas = canvasRef.current;
    if (!canvas) return;
    var c = canvas.getContext('2d');

    function resize() {
      var parent = canvas.parentElement;
      if (parent) { canvas.width = parent.clientWidth; canvas.height = parent.clientHeight; }
    }
    resize();
    window.addEventListener('resize', resize);

    function render() {
      var w = canvas.width, h = canvas.height;
      var me = localRef.current;
      var camX = me ? me.x : mapSizeRef.current.w / 2;
      var camY = me ? me.y : mapSizeRef.current.h / 2;
      var zoom = me ? Math.max(0.4, 1 - (me.radius - 20) / 250) : 1;
      var MW = mapSizeRef.current.w, MH = mapSizeRef.current.h;

      // Clear
      c.fillStyle = '#1a1b1e';
      c.fillRect(0, 0, w, h);

      c.save();
      c.translate(w / 2, h / 2);
      c.scale(zoom, zoom);
      c.translate(-camX, -camY);

      // Grid
      c.strokeStyle = 'rgba(255,255,255,0.04)';
      c.lineWidth = 1;
      var gs = 50;
      var vw = w / zoom, vh = h / zoom;
      var sx = Math.floor((camX - vw / 2) / gs) * gs;
      var ex = Math.ceil((camX + vw / 2) / gs) * gs;
      var sy = Math.floor((camY - vh / 2) / gs) * gs;
      var ey = Math.ceil((camY + vh / 2) / gs) * gs;
      c.beginPath();
      for (var gx = sx; gx <= ex; gx += gs) { c.moveTo(gx, sy); c.lineTo(gx, ey); }
      for (var gy = sy; gy <= ey; gy += gs) { c.moveTo(sx, gy); c.lineTo(ex, gy); }
      c.stroke();

      // Map border
      c.strokeStyle = '#ed4245';
      c.lineWidth = 4;
      c.strokeRect(0, 0, MW, MH);

      // Orbs
      var orbs = orbsRef.current;
      for (var oi = 0; oi < orbs.length; oi++) {
        var ob = orbs[oi];
        c.beginPath();
        c.arc(ob.x, ob.y, ob.radius, 0, 6.2832);
        c.fillStyle = ob.color;
        c.fill();
      }

      // Players
      var pls = playersRef.current;
      orbsFrameCounter.current++;

      // VFX: Growth pulse handling
      var growthPulse = orbsGrowthPulseRef.current;
      var pulseScale = 1.0;
      if (growthPulse.active) {
        var pulseAge = Date.now() - growthPulse.startTime;
        if (pulseAge < 300) {
          pulseScale = 1.0 + 0.15 * Math.sin((pulseAge / 300) * Math.PI);
        } else {
          orbsGrowthPulseRef.current.active = false;
        }
      }

      for (var pi = 0; pi < pls.length; pi++) {
        var p = pls[pi];
        var isMe = me && p.id === me.id;
        var drawRadius = p.radius;

        // Apply growth pulse to local player
        if (isMe && growthPulse.active) {
          drawRadius = p.radius * pulseScale;
        }

        // Glow
        c.beginPath();
        c.arc(p.x, p.y, drawRadius + 4, 0, 6.2832);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fill();
        // Body
        c.beginPath();
        c.arc(p.x, p.y, drawRadius, 0, 6.2832);
        c.fillStyle = p.color;
        c.fill();
        // Outline for local player
        if (isMe) {
          c.strokeStyle = '#fff';
          c.lineWidth = 3;
          c.stroke();
        }
        // Name (security fix: safeCanvasText)
        var fs = Math.max(10, Math.min(p.radius * 0.45, 22));
        c.font = 'bold ' + fs + 'px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#fff';
        c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.lineWidth = 3;
        var safeOrbName = (window.BossEffects && BossEffects.safeCanvasText) ? BossEffects.safeCanvasText(p.name, 16) : p.name;
        c.strokeText(safeOrbName, p.x, p.y);
        c.fillText(safeOrbName, p.x, p.y);
        // Score below name
        if (p.radius > 25) {
          var sfs = Math.max(8, fs * 0.6);
          c.font = sfs + 'px sans-serif';
          c.strokeText(p.score + '', p.x, p.y + fs * 0.8);
          c.fillText(p.score + '', p.x, p.y + fs * 0.8);
        }
      }

      // VFX: Boost trail (throttled to every 3rd frame)
      if (me && keysRef.current.shift && orbsFrameCounter.current % 3 === 0) {
        if (window.BossParticles && canvas) {
          BossParticles.trail(canvas, { x: me.x, y: me.y, color: me.color || '#57f287', length: 8 });
        }
      }

      c.restore();

      animRef.current = requestAnimationFrame(render);
    }

    animRef.current = requestAnimationFrame(render);

    return function() {
      window.removeEventListener('resize', resize);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [inGame]);

  // WASD + shift boost + touch input
  var keysRef = useRef({ w: false, a: false, s: false, d: false, shift: false });
  var [boostFuel, setBoostFuel] = useState(100);
  useEffect(function() {
    if (!inGame || !sock) return;
    var canvas = canvasRef.current;
    if (!canvas) return;
    var moveSock = sock;
    var MOVE_DIST = 500;

    function sendMove() {
      var now = Date.now();
      if (now - moveThrottle.current < 50) return;
      moveThrottle.current = now;
      var me = localRef.current;
      if (!me) return;
      if (me.boost !== undefined) setBoostFuel(me.boost);

      var k = keysRef.current;
      var isBoosting = k.shift;
      var dx = 0, dy = 0;
      if (k.w) dy -= 1;
      if (k.s) dy += 1;
      if (k.a) dx -= 1;
      if (k.d) dx += 1;

      // Touch fallback
      if (mouseRef.current.active) {
        lastSentIdle.current = false;
        var w = canvas.width, h = canvas.height;
        var zoom = Math.max(0.4, 1 - (me.radius - 20) / 250);
        moveSock.emit('game_move', {
          x: me.x + (mouseRef.current.x - w / 2) / zoom,
          y: me.y + (mouseRef.current.y - h / 2) / zoom,
          boost: isBoosting
        });
        return;
      }

      if (dx === 0 && dy === 0) {
        // Only send idle stop once to prevent oscillation/wiggle
        if (!lastSentIdle.current) {
          moveSock.emit('game_move', { x: me.x, y: me.y, boost: false });
          lastSentIdle.current = true;
        }
        return;
      }

      lastSentIdle.current = false;
      var len = Math.sqrt(dx * dx + dy * dy);
      dx = dx / len * MOVE_DIST;
      dy = dy / len * MOVE_DIST;

      moveSock.emit('game_move', { x: me.x + dx, y: me.y + dy, boost: isBoosting });
    }

    function onKeyDown(e) {
      var key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') { keysRef.current.w = true; e.preventDefault(); }
      if (key === 'a' || key === 'arrowleft') { keysRef.current.a = true; e.preventDefault(); }
      if (key === 's' || key === 'arrowdown') { keysRef.current.s = true; e.preventDefault(); }
      if (key === 'd' || key === 'arrowright') { keysRef.current.d = true; e.preventDefault(); }
      if (key === 'shift') {
        if (!keysRef.current.shift) {
          // Boost just started
          if (window.BossSounds) BossSounds.play('boost');
        }
        keysRef.current.shift = true;
      }
    }

    function onKeyUp(e) {
      var key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') keysRef.current.w = false;
      if (key === 'a' || key === 'arrowleft') keysRef.current.a = false;
      if (key === 's' || key === 'arrowdown') keysRef.current.s = false;
      if (key === 'd' || key === 'arrowright') keysRef.current.d = false;
      if (key === 'shift') keysRef.current.shift = false;
    }

    function onTouch(e) {
      e.preventDefault();
      var t = e.touches[0];
      var r = canvas.getBoundingClientRect();
      mouseRef.current.x = t.clientX - r.left;
      mouseRef.current.y = t.clientY - r.top;
      mouseRef.current.active = true;
    }

    function onTouchEnd() {
      mouseRef.current.active = false;
    }

    var moveInterval = setInterval(function() {
      if (localRef.current) sendMove();
    }, 50);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('touchmove', onTouch, { passive: false });
    canvas.addEventListener('touchstart', onTouch, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    return function() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('touchmove', onTouch);
      canvas.removeEventListener('touchstart', onTouch);
      canvas.removeEventListener('touchend', onTouchEnd);
      clearInterval(moveInterval);
      keysRef.current = { w: false, a: false, s: false, d: false, shift: false };
    };
  }, [inGame, sock]);

  // Cleanup on unmount
  useEffect(function() {
    return function() {
      var s = ctx.gamesSocket || ctx.socket;
      if (s && inGame) s.emit('game_leave');
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, []);

  // --- Not in game: show lobby with instance browser ---
  if (!inGame) {
    var totalPlayers = 0;
    for (var ii = 0; ii < instances.length; ii++) totalPlayers += (instances[ii].playerCount || 0);

    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', background: '#1c1c1e', gap: '16px', padding: '24px',
        overflowY: 'auto'
      }
    },
      React.createElement('div', {
        style: { fontSize: '64px', marginBottom: '4px' }
      }, '\uD83D\uDFE2'),
      React.createElement('h2', {
        style: { fontSize: '28px', fontWeight: 700, margin: 0 }
      },
        React.createElement('span', { style: { color: '#57f287' } }, 'Boss'),
        'Orbs'
      ),
      React.createElement('p', {
        style: { color: '#949ba4', fontSize: '15px', textAlign: 'center', maxWidth: '400px', lineHeight: '1.5', margin: 0 }
      }, 'Eat orbs to grow. Eat players smaller than you. Avoid bigger players.'),

      // Quick Play button
      deathMsg ? React.createElement('div', {
        style: {
          background: '#ed4245', color: '#fff', padding: '10px 20px',
          borderRadius: '8px', fontSize: '16px', fontWeight: 600
        }
      }, deathMsg) : null,
      React.createElement('button', {
        style: {
          padding: '12px 48px', background: '#57f287', border: 'none',
          borderRadius: '8px', color: '#18181b', fontSize: '18px',
          fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          minHeight: '48px', transition: 'transform 0.1s'
        },
        onClick: function() { joinGame(); },
        onMouseEnter: function(e) { e.currentTarget.style.transform = 'scale(1.05)'; },
        onMouseLeave: function(e) { e.currentTarget.style.transform = 'scale(1)'; }
      }, deathMsg ? 'Quick Play Again' : 'Quick Play'),
      React.createElement('div', {
        style: { color: '#949ba4', fontSize: '13px' }
      }, isMobile ? 'Touch to move' : 'WASD to move | Shift to boost'),

      // Instance browser
      instances.length > 0 ? React.createElement('div', {
        style: {
          width: '100%', maxWidth: '500px', marginTop: '8px',
          background: '#2b2d31', borderRadius: '12px', padding: '16px'
        }
      },
        React.createElement('div', {
          style: {
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '12px'
          }
        },
          React.createElement('div', {
            style: { color: '#fff', fontSize: '15px', fontWeight: 700 }
          }, 'Game Lobbies'),
          React.createElement('div', {
            style: { color: '#949ba4', fontSize: '13px' }
          }, totalPlayers + ' playing')
        ),
        instances.map(function(inst) {
          var pct = inst.maxPlayers ? Math.round((inst.playerCount / inst.maxPlayers) * 100) : 0;
          var isFull = inst.playerCount >= inst.maxPlayers;
          var barColor = pct > 80 ? '#ed4245' : pct > 50 ? '#fee75c' : '#57f287';
          return React.createElement('div', {
            key: inst.id,
            style: {
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '10px 12px', background: '#1e1f22', borderRadius: '8px',
              marginBottom: '6px', cursor: isFull ? 'default' : 'pointer',
              opacity: isFull ? 0.5 : 1,
              transition: 'background 0.15s'
            },
            onClick: function() { if (!isFull) joinGame(inst.id); },
            onMouseEnter: function(e) { if (!isFull) e.currentTarget.style.background = '#2b2d31'; },
            onMouseLeave: function(e) { e.currentTarget.style.background = '#1e1f22'; }
          },
            // Instance icon
            React.createElement('div', {
              style: {
                width: '36px', height: '36px', borderRadius: '8px',
                background: '#57f287', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '18px', flexShrink: 0
              }
            }, '\uD83D\uDFE2'),
            // Info
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
              React.createElement('div', {
                style: { color: '#fff', fontSize: '14px', fontWeight: 600 }
              }, inst.id === 'main' ? 'Main Arena' : 'Arena ' + inst.id.replace('orbs_', '#')),
              // Player count + bar
              React.createElement('div', {
                style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }
              },
                React.createElement('div', {
                  style: {
                    flex: 1, height: '4px', background: '#404249',
                    borderRadius: '2px', overflow: 'hidden'
                  }
                },
                  React.createElement('div', {
                    style: {
                      height: '100%', width: pct + '%', background: barColor,
                      borderRadius: '2px', transition: 'width 0.3s'
                    }
                  })
                ),
                React.createElement('div', {
                  style: { color: '#949ba4', fontSize: '12px', whiteSpace: 'nowrap' }
                }, inst.humanCount + '/' + inst.maxPlayers)
              )
            ),
            // Join button
            React.createElement('button', {
              style: {
                padding: '6px 16px', background: isFull ? '#404249' : '#57f287',
                border: 'none', borderRadius: '6px', color: isFull ? '#949ba4' : '#18181b',
                fontSize: '13px', fontWeight: 600, cursor: isFull ? 'default' : 'pointer',
                fontFamily: 'inherit', flexShrink: 0
              },
              disabled: isFull,
              onClick: function(e) { e.stopPropagation(); if (!isFull) joinGame(inst.id); }
            }, isFull ? 'Full' : 'Join')
          );
        })
      ) : null
    );
  }

  // --- In game: canvas + HUD ---
  return React.createElement('div', {
    style: {
      flex: 1, position: 'relative', overflow: 'hidden', background: '#1a1b1e'
    }
  },
    React.createElement('canvas', {
      ref: canvasRef,
      style: { width: '100%', height: '100%', display: 'block' }
    }),

    // Death message overlay
    deathMsg ? React.createElement('div', {
      style: {
        position: 'absolute', top: '50px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(237,66,69,0.9)', borderRadius: '8px', padding: '8px 24px',
        color: '#fff', fontSize: '16px', fontWeight: 700, pointerEvents: 'none',
        animation: 'fadeIn 0.2s ease', zIndex: 10
      }
    }, deathMsg) : null,

    // Kill reward notification
    killMsg ? React.createElement('div', {
      style: {
        position: 'absolute', top: '50px', right: '20px',
        background: 'rgba(240,178,50,0.9)', borderRadius: '8px', padding: '8px 20px',
        color: '#1c1c1e', fontSize: '14px', fontWeight: 700, pointerEvents: 'none',
        animation: 'fadeIn 0.2s ease', zIndex: 10
      }
    }, killMsg) : null,

    // Instance label
    currentInstance ? React.createElement('div', {
      style: {
        position: 'absolute', top: '8px', left: '8px',
        background: 'rgba(0,0,0,0.6)', borderRadius: '6px', padding: '4px 12px',
        color: '#57f287', fontSize: '12px', fontWeight: 600, pointerEvents: 'none'
      }
    }, currentInstance === 'main' ? 'Main Arena' : 'Arena ' + currentInstance.replace('orbs_', '#')) : null,

    // Score HUD
    React.createElement('div', {
      style: {
        position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.6)', borderRadius: '8px', padding: '6px 20px',
        color: '#fff', fontSize: '16px', fontWeight: 700, pointerEvents: 'none'
      }
    }, 'Score: ' + myScore),

    // Boost bar + mobile boost button
    React.createElement('div', {
      style: {
        position: 'absolute', bottom: '52px', left: '50%', transform: 'translateX(-50%)',
        width: '200px', pointerEvents: isMobile ? 'auto' : 'none',
        display: 'flex', flexDirection: 'column', alignItems: 'center'
      }
    },
      // Mobile: tappable boost button
      isMobile ? React.createElement('button', {
        style: {
          width: '64px', height: '64px', borderRadius: '50%',
          background: keysRef.current.shift ? '#fee75c' : 'rgba(254,231,92,0.25)',
          border: '3px solid #fee75c', color: '#1c1c1e', fontSize: '11px', fontWeight: 800,
          marginBottom: '8px', cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.1s', touchAction: 'manipulation'
        },
        onTouchStart: function(e) { e.preventDefault(); keysRef.current.shift = true; },
        onTouchEnd: function(e) { e.preventDefault(); keysRef.current.shift = false; },
        onTouchCancel: function() { keysRef.current.shift = false; }
      }, 'BOOST') : null,
      // Label
      React.createElement('div', {
        style: {
          fontSize: '11px', color: boostFuel < 100 ? '#fee75c' : '#b5bac1',
          textAlign: 'center', marginBottom: '3px', fontWeight: 600, pointerEvents: 'none'
        }
      }, isMobile ? '' : 'BOOST [Shift]'),
      React.createElement('div', {
        style: {
          height: '8px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', overflow: 'hidden',
          width: '100%', pointerEvents: 'none'
        }
      },
        React.createElement('div', {
          style: {
            height: '100%', width: boostFuel + '%',
            background: boostFuel > 20 ? '#fee75c' : '#ed4245',
            borderRadius: '4px', transition: 'width 0.1s'
          }
        })
      )
    ),

    // Leaderboard
    React.createElement('div', {
      style: {
        position: 'absolute', top: '8px', right: '8px',
        background: 'rgba(0,0,0,0.6)', borderRadius: '8px', padding: '10px 14px',
        minWidth: '150px', pointerEvents: 'none'
      }
    },
      React.createElement('div', {
        style: { color: '#fff', fontSize: '13px', fontWeight: 700, marginBottom: '6px', textAlign: 'center' }
      }, 'Leaderboard'),
      leaderboard.map(function(entry, i) {
        return React.createElement('div', {
          key: i,
          style: {
            display: 'flex', justifyContent: 'space-between', gap: '12px',
            fontSize: '12px', color: i === 0 ? '#fee75c' : '#b5bac1',
            padding: '1px 0'
          }
        },
          React.createElement('span', null, (i + 1) + '. ' + entry.name),
          React.createElement('span', null, entry.score)
        );
      })
    ),

    // Leave button
    React.createElement('button', {
      style: {
        position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
        padding: '8px 24px', background: 'rgba(237,66,69,0.8)', border: 'none',
        borderRadius: '6px', color: '#fff', fontSize: '14px', fontWeight: 600,
        cursor: 'pointer', fontFamily: 'inherit'
      },
      onClick: leaveGame
    }, 'Leave Game')
  );
}
