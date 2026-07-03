// games-liero.js
// BossBrawl: Liero-style 2D destructible-terrain combat game for BossCord
// Renders lobby browser + in-game canvas via React.createElement (no JSX)

// ========================= CONSTANTS =========================

var LIERO_MAP_W = 1200;
var LIERO_MAP_H = 800;
var LIERO_TICK_RATE = 50; // 20Hz input send interval (ms)
var LIERO_TERRAIN_COLORS = {
  0: null,             // air = transparent
  1: '#6B4226',        // dirt
  2: '#808080',        // rock
  3: '#404040'         // indestructible
};
var LIERO_PLAYER_W = 12;
var LIERO_PLAYER_H = 16;
var LIERO_AIM_LEN = 30;
var LIERO_HP_BAR_W = 24;
var LIERO_HP_BAR_H = 4;
var LIERO_KILL_FEED_MAX = 5;
var LIERO_KILL_FEED_DURATION = 4000;

// Weapon type colors for projectiles
var LIERO_PROJECTILE_COLORS = [
  '#f0b232', '#ed4245', '#57f287', '#5865f2', '#9b59b6',
  '#e91e63', '#00bcd4', '#ff9800', '#cddc39', '#ffffff'
];

// ========================= STYLES =========================

var LIERO_STYLES = {
  bg: '#1c1c1e',
  card: '#252528',
  border: '#4e5058',
  accent: '#f0b232',
  text: '#dcddde',
  muted: '#949ba4',
  error: '#ed4245',
  success: '#57f287',
  btnBg: '#4e5058',
  btnHover: '#f0b232',
  btnHoverText: '#1c1c1e',
  radius: '8px',
  radiusBtn: '6px'
};

// ========================= HELPER: Styled Button =========================

function LieroButton(props) {
  var baseStyle = {
    padding: props.padding || '8px 20px',
    background: props.variant === 'accent' ? LIERO_STYLES.accent :
                props.variant === 'error' ? LIERO_STYLES.error :
                props.variant === 'success' ? LIERO_STYLES.success :
                LIERO_STYLES.btnBg,
    color: (props.variant === 'accent' || props.variant === 'success') ? LIERO_STYLES.bg :
           props.variant === 'error' ? '#fff' : LIERO_STYLES.text,
    border: 'none',
    borderRadius: LIERO_STYLES.radiusBtn,
    fontSize: props.fontSize || '14px',
    fontWeight: 600,
    cursor: props.disabled ? 'default' : 'pointer',
    fontFamily: 'inherit',
    opacity: props.disabled ? 0.5 : 1,
    transition: 'background 0.15s, transform 0.1s'
  };
  if (props.style) {
    baseStyle = Object.assign({}, baseStyle, props.style);
  }

  return React.createElement('button', {
    style: baseStyle,
    onClick: props.disabled ? undefined : props.onClick,
    onMouseEnter: function(e) {
      if (!props.disabled) {
        e.currentTarget.style.background = LIERO_STYLES.btnHover;
        e.currentTarget.style.color = LIERO_STYLES.btnHoverText;
      }
    },
    onMouseLeave: function(e) {
      if (!props.disabled) {
        var bg = props.variant === 'accent' ? LIERO_STYLES.accent :
                 props.variant === 'error' ? LIERO_STYLES.error :
                 props.variant === 'success' ? LIERO_STYLES.success :
                 LIERO_STYLES.btnBg;
        var fg = (props.variant === 'accent' || props.variant === 'success') ? LIERO_STYLES.bg :
                 props.variant === 'error' ? '#fff' : LIERO_STYLES.text;
        e.currentTarget.style.background = bg;
        e.currentTarget.style.color = fg;
      }
    }
  }, props.children);
}

// ========================= MAIN COMPONENT =========================

function BossBrawlGame() {
  var ctx = useSocket();
  var isMobile = useIsMobile();

  // Connect to /games namespace on mount
  useEffect(function() { ctx.connectGames(); }, []);
  var sock = ctx.gamesSocket || ctx.socket;

  // ---- State ----
  var [mode, setMode] = useState('browser'); // 'browser' | 'lobby' | 'game' | 'gameover'
  var [lobbies, setLobbies] = useState([]);
  var [lobby, setLobby] = useState(null);
  var [createMapType, setCreateMapType] = useState('caves');
  var [createScoreLimit, setCreateScoreLimit] = useState(50);
  var [gameOver, setGameOver] = useState(null);

  // In-game refs (mutable, no re-render)
  var canvasRef = useRef(null);
  var terrainCanvasRef = useRef(null);
  var terrainDataRef = useRef(null); // Uint8Array
  var playersRef = useRef([]);
  var projectilesRef = useRef([]);
  var pickupsRef = useRef([]);
  var weaponsRef = useRef([]);
  var spellsRef = useRef([]);
  var mapSizeRef = useRef({ w: LIERO_MAP_W, h: LIERO_MAP_H });
  var scoreLimitRef = useRef(50);
  var localIdRef = useRef(null);
  var animRef = useRef(null);
  var inputIntervalRef = useRef(null);
  var killFeedRef = useRef([]); // [{text, time}]
  var keysRef = useRef({});
  var mouseRef = useRef({ x: 0, y: 0, down: false });
  var aimAngleRef = useRef(0);
  var currentWeaponRef = useRef(0);
  var switchWeaponDirRef = useRef(0); // +1 or -1 on scroll
  var spellPressedRef = useRef(false);
  var decoysRef = useRef([]);
  var vfxRef = useRef([]); // [{type, x, y, time, ...}]
  var touchAimRef = useRef({ active: false, x: 0, y: 0 });
  var touchMoveRef = useRef({ active: false, dx: 0, dy: 0, startX: 0, startY: 0, id: null });
  var lastGunfireSoundRef = useRef(0); // Throttle gunfire sound

  // Store sock.id as localId
  useEffect(function() {
    if (sock && sock.id) {
      localIdRef.current = sock.id;
    }
  }, [sock]);

  // ========================= LOBBY BROWSER =========================

  // Poll lobbies when in browser mode
  useEffect(function() {
    if (!sock || mode !== 'browser') return;

    sock.emit('liero_list_lobbies');
    var interval = setInterval(function() {
      sock.emit('liero_list_lobbies');
    }, 3000);

    function onLobbies(data) {
      if (data && data.lobbies) setLobbies(data.lobbies);
    }
    function onLobbiesUpdated(data) {
      if (data && data.lobbies) setLobbies(data.lobbies);
    }

    sock.on('liero_lobbies', onLobbies);
    sock.on('liero_lobbies_updated', onLobbiesUpdated);

    return function() {
      clearInterval(interval);
      sock.off('liero_lobbies', onLobbies);
      sock.off('liero_lobbies_updated', onLobbiesUpdated);
    };
  }, [sock, mode]);

  // ========================= LOBBY EVENTS =========================

  useEffect(function() {
    if (!sock) return;

    function onLobbyJoined(data) {
      if (data && data.lobby) {
        setLobby(data.lobby);
        setMode('lobby');
      }
    }
    function onLobbyUpdate(data) {
      if (data && data.lobby) {
        setLobby(data.lobby);
      }
    }
    function onLobbyLeft() {
      setLobby(null);
      setMode('browser');
    }

    sock.on('liero_lobby_joined', onLobbyJoined);
    sock.on('liero_lobby_update', onLobbyUpdate);
    sock.on('liero_lobby_left', onLobbyLeft);

    return function() {
      sock.off('liero_lobby_joined', onLobbyJoined);
      sock.off('liero_lobby_update', onLobbyUpdate);
      sock.off('liero_lobby_left', onLobbyLeft);
    };
  }, [sock]);

  // ========================= GAME EVENTS =========================

  useEffect(function() {
    if (!sock) return;

    function onGameStart(data) {
      if (!data) return;
      // Decode terrain
      var terrainBytes = null;
      if (data.terrain instanceof ArrayBuffer) {
        terrainBytes = new Uint8Array(data.terrain);
      } else if (typeof data.terrain === 'string') {
        // base64 decode
        var binary = atob(data.terrain);
        terrainBytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) {
          terrainBytes[i] = binary.charCodeAt(i);
        }
      } else if (data.terrain && data.terrain.length !== undefined) {
        terrainBytes = new Uint8Array(data.terrain);
      }

      var mw = data.mapWidth || LIERO_MAP_W;
      var mh = data.mapHeight || LIERO_MAP_H;
      mapSizeRef.current = { w: mw, h: mh };
      terrainDataRef.current = terrainBytes;
      playersRef.current = data.players || [];
      weaponsRef.current = data.weapons || [];
      spellsRef.current = data.spells || [];
      projectilesRef.current = [];
      pickupsRef.current = [];
      killFeedRef.current = [];
      vfxRef.current = [];
      scoreLimitRef.current = data.scoreLimit || 50;
      currentWeaponRef.current = 0;

      // Store local ID from socket
      if (sock.id) localIdRef.current = sock.id;

      // Build offscreen terrain canvas
      buildTerrainCanvas(terrainBytes, mw, mh);

      setGameOver(null);
      setMode('game');
    }

    function onTick(data) {
      if (!data) return;
      if (data.players) playersRef.current = data.players;
      if (data.projectiles) projectilesRef.current = data.projectiles;
      if (data.pickups !== undefined) pickupsRef.current = data.pickups;
      if (data.weapons) weaponsRef.current = data.weapons;
      if (data.decoys) decoysRef.current = data.decoys;
    }

    function onTerrainDelta(data) {
      if (!data || !data.changes) return;
      applyTerrainDelta(data.changes);
    }

    function onPlayerKilled(data) {
      if (!data) return;
      var text = (data.killerName || '???') + ' killed ' + (data.killedName || '???');
      killFeedRef.current.push({ text: text, time: Date.now() });
      if (killFeedRef.current.length > LIERO_KILL_FEED_MAX + 2) {
        killFeedRef.current = killFeedRef.current.slice(-LIERO_KILL_FEED_MAX);
      }
      // VFX: Hit particles at killed player's position + sound
      if (data.x !== undefined && data.y !== undefined) {
        vfxRef.current.push({ type: 'explosion', x: data.x, y: data.y, time: Date.now() });
        if (window.BossParticles && canvasRef.current) {
          BossParticles.sparks(canvasRef.current, data.x, data.y, { count: 6, color: '#ff6b35' });
          BossParticles.dust(canvasRef.current, data.x, data.y, { count: 10, color: '#ff4444' });
        }
        if (window.BossEffects) BossEffects.startCanvasShake('liero', 5, 200);
      }
      if (window.BossSounds) BossSounds.play('explosion');
    }

    function onPlayerRespawn(data) {
      if (!data) return;
      vfxRef.current.push({ type: 'respawn', x: data.x, y: data.y, time: Date.now(), playerId: data.playerId });
      if (window.BossSounds) BossSounds.play('hit');
    }

    function onPickupSpawned(data) {
      if (data && data.pickup) {
        pickupsRef.current.push(data.pickup);
      }
    }

    function onPickupCollected(data) {
      if (!data) return;
      pickupsRef.current = pickupsRef.current.filter(function(p) { return p.id !== data.pickupId; });
      if (data.playerId) {
        var px = 0, py = 0;
        for (var i = 0; i < pickupsRef.current.length; i++) {
          if (pickupsRef.current[i].id === data.pickupId) {
            px = pickupsRef.current[i].x;
            py = pickupsRef.current[i].y;
          }
        }
        vfxRef.current.push({ type: 'collect', x: data.x || px, y: data.y || py, time: Date.now() });
      }
    }

    function onSpellCast(data) {
      if (!data) return;
      vfxRef.current.push({ type: 'spell', x: data.x, y: data.y, time: Date.now(), spellId: data.spellId, playerId: data.playerId });
    }

    function onGameOver(data) {
      if (!data) return;
      setGameOver(data);
      setMode('gameover');
    }

    sock.on('liero_game_start', onGameStart);
    sock.on('liero_tick', onTick);
    sock.on('liero_terrain_delta', onTerrainDelta);
    sock.on('liero_player_killed', onPlayerKilled);
    sock.on('liero_player_respawn', onPlayerRespawn);
    sock.on('liero_pickup_spawned', onPickupSpawned);
    sock.on('liero_pickup_collected', onPickupCollected);
    sock.on('liero_spell_cast', onSpellCast);
    sock.on('liero_game_over', onGameOver);

    return function() {
      sock.off('liero_game_start', onGameStart);
      sock.off('liero_tick', onTick);
      sock.off('liero_terrain_delta', onTerrainDelta);
      sock.off('liero_player_killed', onPlayerKilled);
      sock.off('liero_player_respawn', onPlayerRespawn);
      sock.off('liero_pickup_spawned', onPickupSpawned);
      sock.off('liero_pickup_collected', onPickupCollected);
      sock.off('liero_spell_cast', onSpellCast);
      sock.off('liero_game_over', onGameOver);
    };
  }, [sock]);

  // ========================= TERRAIN HELPERS =========================

  function buildTerrainCanvas(terrainBytes, w, h) {
    var offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    terrainCanvasRef.current = offscreen;

    if (!terrainBytes) return;
    var octx = offscreen.getContext('2d');
    var imgData = octx.createImageData(w, h);
    var pixels = imgData.data;

    for (var i = 0; i < terrainBytes.length; i++) {
      var val = terrainBytes[i];
      var pi = i * 4;
      if (val === 0) {
        // air = transparent
        pixels[pi] = 0; pixels[pi + 1] = 0; pixels[pi + 2] = 0; pixels[pi + 3] = 0;
      } else if (val === 1) {
        // dirt
        pixels[pi] = 107; pixels[pi + 1] = 66; pixels[pi + 2] = 38; pixels[pi + 3] = 255;
      } else if (val === 2) {
        // rock
        pixels[pi] = 128; pixels[pi + 1] = 128; pixels[pi + 2] = 128; pixels[pi + 3] = 255;
      } else if (val === 3) {
        // indestructible
        pixels[pi] = 64; pixels[pi + 1] = 64; pixels[pi + 2] = 64; pixels[pi + 3] = 255;
      } else {
        pixels[pi] = 0; pixels[pi + 1] = 0; pixels[pi + 2] = 0; pixels[pi + 3] = 0;
      }
    }
    octx.putImageData(imgData, 0, 0);
  }

  function applyTerrainDelta(changes) {
    var offscreen = terrainCanvasRef.current;
    var terrain = terrainDataRef.current;
    if (!offscreen || !terrain) return;
    var w = mapSizeRef.current.w;
    var octx = offscreen.getContext('2d');

    for (var i = 0; i < changes.length; i++) {
      var ch = changes[i];
      var idx = ch.y * w + ch.x;
      if (idx >= 0 && idx < terrain.length) {
        terrain[idx] = ch.val;
      }
      // Update pixel
      var imgData = octx.createImageData(1, 1);
      var p = imgData.data;
      if (ch.val === 0) {
        p[0] = 0; p[1] = 0; p[2] = 0; p[3] = 0;
      } else if (ch.val === 1) {
        p[0] = 107; p[1] = 66; p[2] = 38; p[3] = 255;
      } else if (ch.val === 2) {
        p[0] = 128; p[1] = 128; p[2] = 128; p[3] = 255;
      } else if (ch.val === 3) {
        p[0] = 64; p[1] = 64; p[2] = 64; p[3] = 255;
      } else {
        p[0] = 0; p[1] = 0; p[2] = 0; p[3] = 0;
      }
      octx.putImageData(imgData, ch.x, ch.y);
    }
  }

  // ========================= RENDER LOOP =========================

  useEffect(function() {
    if (mode !== 'game' && mode !== 'gameover') {
      if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
      return;
    }
    var canvas = canvasRef.current;
    if (!canvas) return;
    var c = canvas.getContext('2d');

    function resize() {
      var parent = canvas.parentElement;
      if (parent) {
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
      }
    }
    resize();
    window.addEventListener('resize', resize);

    function render() {
      var w = canvas.width;
      var h = canvas.height;
      var mw = mapSizeRef.current.w;
      var mh = mapSizeRef.current.h;
      var players = playersRef.current;
      var projectiles = projectilesRef.current;
      var pkps = pickupsRef.current;
      var now = Date.now();

      // Find local player
      var me = null;
      var myId = localIdRef.current;
      for (var pi = 0; pi < players.length; pi++) {
        if (players[pi].id === myId) { me = players[pi]; break; }
      }

      // Camera: center on local player
      var camX = me ? me.x : mw / 2;
      var camY = me ? me.y : mh / 2;

      // Clamp camera so we don't show beyond map edges
      var halfW = w / 2;
      var halfH = h / 2;
      if (camX < halfW) camX = halfW;
      if (camY < halfH) camY = halfH;
      if (camX > mw - halfW) camX = mw - halfW;
      if (camY > mh - halfH) camY = mh - halfH;
      // If canvas is bigger than map, center it
      if (w >= mw) camX = mw / 2;
      if (h >= mh) camY = mh / 2;

      // Clear to dark background
      c.fillStyle = '#0d0d0f';
      c.fillRect(0, 0, w, h);

      c.save();
      c.translate(Math.floor(w / 2 - camX), Math.floor(h / 2 - camY));

      // 1. Terrain
      if (terrainCanvasRef.current) {
        c.drawImage(terrainCanvasRef.current, 0, 0);
      }

      // Map border
      c.strokeStyle = '#4e5058';
      c.lineWidth = 2;
      c.strokeRect(0, 0, mw, mh);

      // 2. Pickups
      for (var ki = 0; ki < pkps.length; ki++) {
        var pk = pkps[ki];
        if (pk.type === 'weapon') {
          // Weapon crate: gold box
          c.fillStyle = LIERO_STYLES.accent;
          c.fillRect(pk.x - 6, pk.y - 6, 12, 12);
          c.strokeStyle = '#d49a28';
          c.lineWidth = 1;
          c.strokeRect(pk.x - 6, pk.y - 6, 12, 12);
        } else {
          // Spell pickup: purple circle
          c.beginPath();
          c.arc(pk.x, pk.y, 6, 0, Math.PI * 2);
          c.fillStyle = '#9b59b6';
          c.fill();
          c.strokeStyle = '#7d3c98';
          c.lineWidth = 1;
          c.stroke();
        }
      }

      // 3. Projectiles
      for (var bi = 0; bi < projectiles.length; bi++) {
        var proj = projectiles[bi];
        var pColor = LIERO_PROJECTILE_COLORS[proj.type % LIERO_PROJECTILE_COLORS.length];
        c.beginPath();
        c.arc(proj.x, proj.y, 2.5, 0, Math.PI * 2);
        c.fillStyle = pColor;
        c.fill();
      }

      // 4. Players
      for (var pli = 0; pli < players.length; pli++) {
        var pl = players[pli];
        var px = pl.x;
        var py = pl.y;
        var playerColor = pl.color || '#dcddde';
        var isDead = pl.alive === false;
        var alpha = isDead ? 0.35 : 1.0;

        c.globalAlpha = alpha;

        // Body rectangle
        c.fillStyle = playerColor;
        c.fillRect(px - LIERO_PLAYER_W / 2, py - LIERO_PLAYER_H / 2, LIERO_PLAYER_W, LIERO_PLAYER_H);

        // Outline
        c.strokeStyle = isDead ? '#666' : '#000';
        c.lineWidth = 1;
        c.strokeRect(px - LIERO_PLAYER_W / 2, py - LIERO_PLAYER_H / 2, LIERO_PLAYER_W, LIERO_PLAYER_H);

        // Aim line
        if (!isDead && pl.aimAngle !== undefined) {
          var ax = Math.cos(pl.aimAngle) * LIERO_AIM_LEN;
          var ay = Math.sin(pl.aimAngle) * LIERO_AIM_LEN;
          c.beginPath();
          c.moveTo(px, py);
          c.lineTo(px + ax, py + ay);
          c.strokeStyle = 'rgba(255,255,255,0.7)';
          c.lineWidth = 1.5;
          c.stroke();
          // Small dot at end
          c.beginPath();
          c.arc(px + ax, py + ay, 2, 0, Math.PI * 2);
          c.fillStyle = '#fff';
          c.fill();
        }

        // HP bar above player
        if (!isDead) {
          var hpPct = Math.max(0, Math.min(1, (pl.hp || 0) / 100));
          var hpY = py - LIERO_PLAYER_H / 2 - 8;
          // Background
          c.fillStyle = 'rgba(0,0,0,0.5)';
          c.fillRect(px - LIERO_HP_BAR_W / 2, hpY, LIERO_HP_BAR_W, LIERO_HP_BAR_H);
          // Fill: green to red
          var hpR = Math.floor((1 - hpPct) * 237);
          var hpG = Math.floor(hpPct * 180);
          c.fillStyle = 'rgb(' + hpR + ',' + hpG + ',40)';
          c.fillRect(px - LIERO_HP_BAR_W / 2, hpY, LIERO_HP_BAR_W * hpPct, LIERO_HP_BAR_H);
        }

        // Name above HP bar
        c.font = 'bold 9px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        c.fillStyle = '#fff';
        c.strokeStyle = 'rgba(0,0,0,0.7)';
        c.lineWidth = 2;
        var nameY = py - LIERO_PLAYER_H / 2 - (isDead ? 6 : 13);
        var safePlName = (window.BossEffects && BossEffects.safeCanvasText) ? BossEffects.safeCanvasText(pl.name || '???', 16) : (pl.name || '???');
        c.strokeText(safePlName, px, nameY);
        c.fillText(safePlName, px, nameY);

        c.globalAlpha = 1.0;
      }

      // 4b. Decoys (Mirror Image ghost players)
      var decoys = decoysRef.current;
      for (var di = 0; di < decoys.length; di++) {
        var dc = decoys[di];
        c.globalAlpha = 0.4;
        c.fillStyle = dc.color || '#aaa';
        c.fillRect(dc.x - LIERO_PLAYER_W / 2, dc.y - LIERO_PLAYER_H / 2, LIERO_PLAYER_W, LIERO_PLAYER_H);
        c.strokeStyle = '#fff';
        c.lineWidth = 1;
        c.strokeRect(dc.x - LIERO_PLAYER_W / 2, dc.y - LIERO_PLAYER_H / 2, LIERO_PLAYER_W, LIERO_PLAYER_H);
        c.font = 'bold 9px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        c.fillStyle = 'rgba(255,255,255,0.5)';
        var safeDcName = (window.BossEffects && BossEffects.safeCanvasText) ? BossEffects.safeCanvasText(dc.name || '???', 16) : (dc.name || '???');
        c.fillText(safeDcName, dc.x, dc.y - LIERO_PLAYER_H / 2 - 4);
        c.globalAlpha = 1.0;
      }

      // 5. VFX (respawn flashes, spell casts, collection effects)
      var vfx = vfxRef.current;
      var activeVfx = [];
      for (var vi = 0; vi < vfx.length; vi++) {
        var v = vfx[vi];
        var age = now - v.time;
        if (v.type === 'respawn' && age < 800) {
          var ra = 1.0 - age / 800;
          var rr = 20 + age * 0.05;
          c.beginPath();
          c.arc(v.x, v.y, rr, 0, Math.PI * 2);
          c.strokeStyle = 'rgba(87,242,135,' + (ra * 0.8) + ')';
          c.lineWidth = 3;
          c.stroke();
          activeVfx.push(v);
        } else if (v.type === 'spell' && age < 600) {
          var sa = 1.0 - age / 600;
          var sr = 10 + age * 0.06;
          c.beginPath();
          c.arc(v.x, v.y, sr, 0, Math.PI * 2);
          c.fillStyle = 'rgba(155,89,182,' + (sa * 0.5) + ')';
          c.fill();
          c.strokeStyle = 'rgba(155,89,182,' + (sa * 0.9) + ')';
          c.lineWidth = 2;
          c.stroke();
          activeVfx.push(v);
        } else if (v.type === 'muzzle_flash' && age < 80) {
          var mfa = 1.0 - age / 80;
          var mfr = 5 + age * 0.06;
          c.beginPath();
          c.arc(v.x, v.y, mfr, 0, Math.PI * 2);
          c.fillStyle = 'rgba(255,255,200,' + (mfa * 0.9) + ')';
          c.fill();
          activeVfx.push(v);
        } else if (v.type === 'explosion' && age < 500) {
          var ea = 1.0 - age / 500;
          var er = 12 + age * 0.08;
          c.beginPath();
          c.arc(v.x, v.y, er, 0, Math.PI * 2);
          c.fillStyle = 'rgba(255,100,50,' + (ea * 0.4) + ')';
          c.fill();
          c.strokeStyle = 'rgba(255,200,50,' + (ea * 0.7) + ')';
          c.lineWidth = 2;
          c.stroke();
          activeVfx.push(v);
        } else if (v.type === 'collect' && age < 500) {
          var ca = 1.0 - age / 500;
          c.beginPath();
          c.arc(v.x, v.y, 8 + age * 0.03, 0, Math.PI * 2);
          c.strokeStyle = 'rgba(240,178,50,' + ca + ')';
          c.lineWidth = 2;
          c.stroke();
          activeVfx.push(v);
        } else if (age < 1000) {
          // Keep briefly so we don't miss any
          activeVfx.push(v);
        }
        // else: expired, drop it
      }
      vfxRef.current = activeVfx;

      c.restore();

      // ---- HUD drawn directly on canvas (scores, kill feed) ----

      // Kill feed (top right)
      var feed = killFeedRef.current;
      var visibleFeed = [];
      for (var fi = 0; fi < feed.length; fi++) {
        if (now - feed[fi].time < LIERO_KILL_FEED_DURATION) {
          visibleFeed.push(feed[fi]);
        }
      }
      // Keep only recent
      visibleFeed = visibleFeed.slice(-LIERO_KILL_FEED_MAX);

      c.font = 'bold 12px sans-serif';
      c.textAlign = 'right';
      c.textBaseline = 'top';
      for (var fj = 0; fj < visibleFeed.length; fj++) {
        var fEntry = visibleFeed[fj];
        var fAge = now - fEntry.time;
        var fAlpha = fAge > 3000 ? 1.0 - (fAge - 3000) / 1000 : 1.0;
        if (fAlpha <= 0) continue;
        c.globalAlpha = fAlpha;
        c.fillStyle = 'rgba(0,0,0,0.5)';
        var fText = fEntry.text;
        var fTw = c.measureText(fText).width;
        c.fillRect(w - fTw - 22, 10 + fj * 20, fTw + 12, 17);
        c.fillStyle = LIERO_STYLES.text;
        c.fillText(fText, w - 16, 12 + fj * 20);
      }
      c.globalAlpha = 1.0;

      // Scoreboard (top center) - compact
      c.font = 'bold 11px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'top';
      var scoreText = 'First to ' + scoreLimitRef.current;
      c.fillStyle = 'rgba(0,0,0,0.5)';
      var stw = c.measureText(scoreText).width;
      c.fillRect(w / 2 - stw / 2 - 10, 6, stw + 20, 18);
      c.fillStyle = LIERO_STYLES.accent;
      c.fillText(scoreText, w / 2, 9);

      // Player scores row
      var sortedPlayers = players.slice().sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
      var scoreY = 28;
      c.font = '10px sans-serif';
      var totalScoreW = 0;
      var scoreEntries = [];
      for (var si = 0; si < sortedPlayers.length && si < 8; si++) {
        var sp = sortedPlayers[si];
        var sText = (sp.name || '???') + ': ' + (sp.score || 0);
        var sw = c.measureText(sText).width + 16;
        scoreEntries.push({ text: sText, color: sp.color || '#dcddde', width: sw, isMe: sp.id === myId });
        totalScoreW += sw;
      }
      var scoreStartX = w / 2 - totalScoreW / 2;
      for (var se = 0; se < scoreEntries.length; se++) {
        var entry = scoreEntries[se];
        c.fillStyle = entry.isMe ? 'rgba(240,178,50,0.3)' : 'rgba(0,0,0,0.4)';
        c.fillRect(scoreStartX, scoreY, entry.width, 16);
        c.fillStyle = entry.color;
        c.textAlign = 'center';
        c.fillText(entry.text, scoreStartX + entry.width / 2, scoreY + 3);
        scoreStartX += entry.width;
      }

      // HP bar (top left)
      if (me && me.alive !== false) {
        var myHp = Math.max(0, Math.min(100, me.hp || 0));
        c.fillStyle = 'rgba(0,0,0,0.5)';
        c.fillRect(10, 10, 154, 20);
        var hpFrac = myHp / 100;
        var hrVal = Math.floor((1 - hpFrac) * 237);
        var hgVal = Math.floor(hpFrac * 180);
        c.fillStyle = 'rgb(' + hrVal + ',' + hgVal + ',40)';
        c.fillRect(12, 12, 150 * hpFrac, 16);
        c.font = 'bold 11px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = '#fff';
        c.fillText('HP: ' + myHp, 87, 22);
      }

      animRef.current = requestAnimationFrame(render);
    }

    animRef.current = requestAnimationFrame(render);

    return function() {
      window.removeEventListener('resize', resize);
      if (animRef.current) { cancelAnimationFrame(animRef.current); animRef.current = null; }
    };
  }, [mode]);

  // ========================= INPUT HANDLING =========================

  useEffect(function() {
    if (mode !== 'game' || !sock) return;
    var canvas = canvasRef.current;
    if (!canvas) return;

    // Keyboard
    function onKeyDown(e) {
      var key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') { keysRef.current.up = true; e.preventDefault(); }
      if (key === 'a' || key === 'arrowleft') { keysRef.current.left = true; e.preventDefault(); }
      if (key === 's' || key === 'arrowdown') { keysRef.current.down = true; e.preventDefault(); }
      if (key === 'd' || key === 'arrowright') { keysRef.current.right = true; e.preventDefault(); }
      if (key === ' ') { keysRef.current.jump = true; e.preventDefault(); }
      if (key === 'q') { spellPressedRef.current = true; }
      // Number keys 1-5 for weapon switching
      if (key >= '1' && key <= '5') {
        var weaponIdx = parseInt(key) - 1;
        currentWeaponRef.current = weaponIdx;
      }
    }

    function onKeyUp(e) {
      var key = e.key.toLowerCase();
      if (key === 'w' || key === 'arrowup') keysRef.current.up = false;
      if (key === 'a' || key === 'arrowleft') keysRef.current.left = false;
      if (key === 's' || key === 'arrowdown') keysRef.current.down = false;
      if (key === 'd' || key === 'arrowright') keysRef.current.right = false;
      if (key === ' ') keysRef.current.jump = false;
      if (key === 'q') spellPressedRef.current = false;
    }

    // Mouse
    function onMouseMove(e) {
      var rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    }

    function onMouseDown(e) {
      if (e.button === 0) mouseRef.current.down = true;
    }

    function onMouseUp(e) {
      if (e.button === 0) mouseRef.current.down = false;
    }

    // Scroll wheel for weapon switching
    function onWheel(e) {
      e.preventDefault();
      if (e.deltaY > 0) {
        switchWeaponDirRef.current = 1;
      } else if (e.deltaY < 0) {
        switchWeaponDirRef.current = -1;
      }
    }

    // Touch controls for mobile
    function onTouchStart(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var rect = canvas.getBoundingClientRect();
        var tx = t.clientX - rect.left;
        var ty = t.clientY - rect.top;

        // Left half: movement joystick
        if (tx < canvas.width / 2 && !touchMoveRef.current.active) {
          touchMoveRef.current = { active: true, dx: 0, dy: 0, startX: tx, startY: ty, id: t.identifier };
          e.preventDefault();
        }
        // Right half: aim + fire
        else if (tx >= canvas.width / 2) {
          touchAimRef.current = { active: true, x: tx, y: ty, id: t.identifier };
          mouseRef.current.down = true;
          e.preventDefault();
        }
      }
    }

    function onTouchMove(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        var rect = canvas.getBoundingClientRect();
        var tx = t.clientX - rect.left;
        var ty = t.clientY - rect.top;

        if (touchMoveRef.current.active && t.identifier === touchMoveRef.current.id) {
          touchMoveRef.current.dx = tx - touchMoveRef.current.startX;
          touchMoveRef.current.dy = ty - touchMoveRef.current.startY;
          e.preventDefault();
        }
        if (touchAimRef.current.active && t.identifier === touchAimRef.current.id) {
          touchAimRef.current.x = tx;
          touchAimRef.current.y = ty;
          e.preventDefault();
        }
      }
    }

    function onTouchEnd(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (touchMoveRef.current.active && t.identifier === touchMoveRef.current.id) {
          touchMoveRef.current = { active: false, dx: 0, dy: 0, startX: 0, startY: 0, id: null };
        }
        if (touchAimRef.current.active && t.identifier === touchAimRef.current.id) {
          touchAimRef.current = { active: false, x: 0, y: 0, id: null };
          mouseRef.current.down = false;
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);

    // Prevent right-click context menu on canvas
    function onContextMenu(e) { e.preventDefault(); }
    canvas.addEventListener('contextmenu', onContextMenu);

    // Send input at 20Hz
    inputIntervalRef.current = setInterval(function() {
      var k = keysRef.current;
      var m = mouseRef.current;
      var me = null;
      var myId = localIdRef.current;
      var players = playersRef.current;
      for (var i = 0; i < players.length; i++) {
        if (players[i].id === myId) { me = players[i]; break; }
      }

      // Compute aim angle
      if (me) {
        if (isMobile && touchAimRef.current.active) {
          // Aim from center of screen to touch point
          var cw = canvas.width;
          var ch = canvas.height;
          aimAngleRef.current = Math.atan2(
            touchAimRef.current.y - ch / 2,
            touchAimRef.current.x - cw / 2
          );
        } else if (!isMobile) {
          // Aim from player screen position to mouse
          var mw = mapSizeRef.current.w;
          var mh = mapSizeRef.current.h;
          var camX = me.x;
          var camY = me.y;
          var halfW = canvas.width / 2;
          var halfH = canvas.height / 2;
          if (camX < halfW) camX = halfW;
          if (camY < halfH) camY = halfH;
          if (camX > mw - halfW) camX = mw - halfW;
          if (camY > mh - halfH) camY = mh - halfH;
          if (canvas.width >= mw) camX = mw / 2;
          if (canvas.height >= mh) camY = mh / 2;

          var playerScreenX = me.x - camX + halfW;
          var playerScreenY = me.y - camY + halfH;
          aimAngleRef.current = Math.atan2(m.y - playerScreenY, m.x - playerScreenX);
        }
      }

      // Mobile: derive movement from touch joystick
      var moveLeft = k.left || false;
      var moveRight = k.right || false;
      var moveJump = k.jump || k.up || false;

      if (isMobile && touchMoveRef.current.active) {
        var deadzone = 15;
        if (touchMoveRef.current.dx < -deadzone) moveLeft = true;
        if (touchMoveRef.current.dx > deadzone) moveRight = true;
        if (touchMoveRef.current.dy < -deadzone) moveJump = true;
      }

      // Build switch weapon value
      var sw = switchWeaponDirRef.current;
      switchWeaponDirRef.current = 0;

      sock.emit('liero_input', {
        left: moveLeft,
        right: moveRight,
        jump: moveJump,
        fire: m.down,
        spell: spellPressedRef.current,
        aimAngle: aimAngleRef.current,
        switchWeapon: sw
      });

      // VFX: Muzzle flash when firing + gunfire sound (throttled)
      if (m.down && me && me.alive !== false) {
        var now = Date.now();
        var angle = aimAngleRef.current;
        var barrelX = me.x + Math.cos(angle) * LIERO_AIM_LEN;
        var barrelY = me.y + Math.sin(angle) * LIERO_AIM_LEN;
        vfxRef.current.push({ type: 'muzzle_flash', x: barrelX, y: barrelY, time: now });
        if (now - lastGunfireSoundRef.current > 200) {
          lastGunfireSoundRef.current = now;
          if (window.BossSounds) BossSounds.play('gunfire');
        }
      }

      // Track current weapon locally for display
      if (sw !== 0 && me) {
        var wCount = weaponsRef.current.length || 5;
        currentWeaponRef.current = ((currentWeaponRef.current + sw) % wCount + wCount) % wCount;
      }
    }, LIERO_TICK_RATE);

    return function() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
      canvas.removeEventListener('contextmenu', onContextMenu);
      if (inputIntervalRef.current) {
        clearInterval(inputIntervalRef.current);
        inputIntervalRef.current = null;
      }
      keysRef.current = {};
      mouseRef.current = { x: 0, y: 0, down: false };
      spellPressedRef.current = false;
    };
  }, [mode, sock, isMobile]);

  // ========================= CLEANUP ON UNMOUNT =========================

  useEffect(function() {
    return function() {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      if (inputIntervalRef.current) clearInterval(inputIntervalRef.current);
      var s = ctx.gamesSocket || ctx.socket;
      if (s) s.emit('liero_leave_lobby');
    };
  }, []);

  // ========================= LOBBY ACTIONS =========================

  function createLobby() {
    if (!sock) return;
    sock.emit('liero_create_lobby', { mapType: createMapType, scoreLimit: createScoreLimit });
  }

  function joinLobby(id) {
    if (!sock) return;
    sock.emit('liero_join_lobby', { lobbyId: id });
  }

  function leaveLobby() {
    if (!sock) return;
    sock.emit('liero_leave_lobby');
    setLobby(null);
    setMode('browser');
  }

  function addBot() {
    if (!sock) return;
    sock.emit('liero_add_bot');
  }

  function removeBot(botId) {
    if (!sock) return;
    sock.emit('liero_remove_bot', { botId: botId });
  }

  function startGame() {
    if (!sock) return;
    sock.emit('liero_start_game');
  }

  function backToLobby() {
    setGameOver(null);
    setMode('browser');
    setLobby(null);
    playersRef.current = [];
    projectilesRef.current = [];
    pickupsRef.current = [];
    decoysRef.current = [];
    terrainDataRef.current = null;
    terrainCanvasRef.current = null;
  }

  // ========================= RENDER: LOBBY BROWSER =========================

  if (mode === 'browser') {
    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: LIERO_STYLES.bg, padding: '24px', overflowY: 'auto', gap: '16px'
      }
    },
      // Header
      React.createElement('div', {
        style: { textAlign: 'center', marginBottom: '8px' }
      },
        React.createElement('div', {
          style: { fontSize: '48px', marginBottom: '8px' }
        }, '\u2694\uFE0F'),
        React.createElement('h2', {
          style: { color: LIERO_STYLES.text, fontSize: '28px', fontWeight: 700, margin: 0 }
        },
          React.createElement('span', { style: { color: LIERO_STYLES.accent } }, 'Boss'),
          'Brawl'
        ),
        React.createElement('p', {
          style: { color: LIERO_STYLES.muted, fontSize: '15px', marginTop: '6px', maxWidth: '420px', lineHeight: '1.5' }
        }, 'Destructible terrain combat. Dig, shoot, and fight to the score limit!')
      ),

      // Create Lobby panel
      React.createElement('div', {
        style: {
          background: LIERO_STYLES.card, border: '1px solid ' + LIERO_STYLES.border,
          borderRadius: LIERO_STYLES.radius, padding: '20px', width: '100%', maxWidth: '480px'
        }
      },
        React.createElement('div', {
          style: { color: LIERO_STYLES.text, fontSize: '16px', fontWeight: 700, marginBottom: '14px' }
        }, 'Create Lobby'),

        // Map type selector
        React.createElement('div', {
          style: { marginBottom: '12px' }
        },
          React.createElement('div', {
            style: { color: LIERO_STYLES.muted, fontSize: '12px', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase' }
          }, 'Map Type'),
          React.createElement('div', {
            style: { display: 'flex', gap: '8px' }
          },
            ['caves', 'tunnels', 'open'].map(function(mt) {
              var isActive = createMapType === mt;
              return React.createElement('button', {
                key: mt,
                style: {
                  flex: 1, padding: '8px 0', border: '1px solid ' + (isActive ? LIERO_STYLES.accent : LIERO_STYLES.border),
                  borderRadius: LIERO_STYLES.radiusBtn, cursor: 'pointer', fontFamily: 'inherit',
                  background: isActive ? LIERO_STYLES.accent : 'transparent',
                  color: isActive ? LIERO_STYLES.bg : LIERO_STYLES.text,
                  fontSize: '13px', fontWeight: 600, transition: 'all 0.15s',
                  textTransform: 'capitalize'
                },
                onClick: function() { setCreateMapType(mt); }
              }, mt);
            })
          )
        ),

        // Score limit selector
        React.createElement('div', {
          style: { marginBottom: '16px' }
        },
          React.createElement('div', {
            style: { color: LIERO_STYLES.muted, fontSize: '12px', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase' }
          }, 'Score Limit'),
          React.createElement('div', {
            style: { display: 'flex', gap: '8px' }
          },
            [25, 50, 100].map(function(sl) {
              var isActive = createScoreLimit === sl;
              return React.createElement('button', {
                key: sl,
                style: {
                  flex: 1, padding: '8px 0', border: '1px solid ' + (isActive ? LIERO_STYLES.accent : LIERO_STYLES.border),
                  borderRadius: LIERO_STYLES.radiusBtn, cursor: 'pointer', fontFamily: 'inherit',
                  background: isActive ? LIERO_STYLES.accent : 'transparent',
                  color: isActive ? LIERO_STYLES.bg : LIERO_STYLES.text,
                  fontSize: '13px', fontWeight: 600, transition: 'all 0.15s'
                },
                onClick: function() { setCreateScoreLimit(sl); }
              }, sl + ' kills');
            })
          )
        ),

        React.createElement(LieroButton, {
          variant: 'accent', onClick: createLobby,
          padding: '10px 0',
          style: { width: '100%' }
        }, 'Create Lobby')
      ),

      // Lobby list
      React.createElement('div', {
        style: { width: '100%', maxWidth: '480px' }
      },
        React.createElement('div', {
          style: { color: LIERO_STYLES.text, fontSize: '16px', fontWeight: 700, marginBottom: '10px' }
        }, 'Open Lobbies'),

        lobbies.length === 0 ?
          React.createElement('div', {
            style: {
              background: LIERO_STYLES.card, border: '1px solid ' + LIERO_STYLES.border,
              borderRadius: LIERO_STYLES.radius, padding: '24px', textAlign: 'center',
              color: LIERO_STYLES.muted, fontSize: '14px'
            }
          }, 'No open lobbies. Create one!') :
          lobbies.map(function(lb) {
            var isFull = lb.players >= lb.maxPlayers;
            var isInProgress = lb.state === 'playing';
            return React.createElement('div', {
              key: lb.id,
              style: {
                background: LIERO_STYLES.card, border: '1px solid ' + LIERO_STYLES.border,
                borderRadius: LIERO_STYLES.radius, padding: '14px 16px', marginBottom: '8px',
                display: 'flex', alignItems: 'center', gap: '12px'
              }
            },
              // Info
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('div', {
                  style: { color: LIERO_STYLES.text, fontSize: '14px', fontWeight: 600 }
                }, (lb.hostName || 'Unknown') + "'s Lobby"),
                React.createElement('div', {
                  style: { color: LIERO_STYLES.muted, fontSize: '12px', marginTop: '3px', display: 'flex', gap: '12px' }
                },
                  React.createElement('span', null, lb.mapType || 'caves'),
                  React.createElement('span', null, (lb.scoreLimit || 50) + ' kills'),
                  React.createElement('span', null, lb.players + '/' + (lb.maxPlayers || 8) + ' players')
                )
              ),
              // Status badge
              isInProgress ? React.createElement('span', {
                style: {
                  padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700,
                  background: 'rgba(237,66,69,0.2)', color: LIERO_STYLES.error
                }
              }, 'In Game') : null,
              // Join button
              React.createElement(LieroButton, {
                variant: 'accent',
                disabled: isFull,
                onClick: function() { joinLobby(lb.id); },
                padding: '6px 20px',
                fontSize: '13px'
              }, isFull ? 'Full' : (isInProgress ? 'Join Game' : 'Join'))
            );
          })
      )
    );
  }

  // ========================= RENDER: IN LOBBY =========================

  if (mode === 'lobby' && lobby) {
    var isHost = lobby.host === (sock ? sock.id : null);
    var playerCount = lobby.players ? lobby.players.length : 0;
    var canStart = isHost && playerCount >= 2;
    var settings = lobby.settings || {};

    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: LIERO_STYLES.bg, padding: '24px', overflowY: 'auto', gap: '16px'
      }
    },
      // Header
      React.createElement('h2', {
        style: { color: LIERO_STYLES.text, fontSize: '24px', fontWeight: 700, margin: 0 }
      },
        React.createElement('span', { style: { color: LIERO_STYLES.accent } }, 'Boss'),
        'Brawl Lobby'
      ),

      // Settings display
      React.createElement('div', {
        style: {
          display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center'
        }
      },
        React.createElement('div', {
          style: {
            padding: '6px 16px', background: LIERO_STYLES.card,
            border: '1px solid ' + LIERO_STYLES.border, borderRadius: '16px',
            color: LIERO_STYLES.muted, fontSize: '13px'
          }
        }, 'Map: ' + (settings.mapType || 'caves')),
        React.createElement('div', {
          style: {
            padding: '6px 16px', background: LIERO_STYLES.card,
            border: '1px solid ' + LIERO_STYLES.border, borderRadius: '16px',
            color: LIERO_STYLES.muted, fontSize: '13px'
          }
        }, 'Score: ' + (settings.scoreLimit || 50) + ' kills')
      ),

      // Player list
      React.createElement('div', {
        style: {
          background: LIERO_STYLES.card, border: '1px solid ' + LIERO_STYLES.border,
          borderRadius: LIERO_STYLES.radius, padding: '16px', width: '100%', maxWidth: '400px'
        }
      },
        React.createElement('div', {
          style: { color: LIERO_STYLES.text, fontSize: '14px', fontWeight: 700, marginBottom: '12px' }
        }, 'Players (' + playerCount + '/8)'),

        (lobby.players || []).map(function(p) {
          return React.createElement('div', {
            key: p.id,
            style: {
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px', borderRadius: '6px',
              background: p.id === (sock ? sock.id : null) ? 'rgba(240,178,50,0.1)' : 'transparent',
              marginBottom: '4px'
            }
          },
            // Color dot
            React.createElement('div', {
              style: {
                width: '14px', height: '14px', borderRadius: '50%',
                background: p.color || '#888', flexShrink: 0
              }
            }),
            // Name
            React.createElement('div', {
              style: { flex: 1, color: LIERO_STYLES.text, fontSize: '14px', fontWeight: 500 }
            },
              p.name || '???',
              p.isBot ? React.createElement('span', {
                style: { color: LIERO_STYLES.muted, fontSize: '11px', marginLeft: '6px' }
              }, '(BOT)') : null,
              p.id === lobby.host ? React.createElement('span', {
                style: { color: LIERO_STYLES.accent, fontSize: '11px', marginLeft: '6px' }
              }, '(HOST)') : null
            ),
            // Remove bot button (host only)
            isHost && p.isBot ? React.createElement(LieroButton, {
              variant: 'error', padding: '3px 10px', fontSize: '11px',
              onClick: function() { removeBot(p.id); }
            }, 'Remove') : null
          );
        })
      ),

      // Actions
      React.createElement('div', {
        style: { display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }
      },
        isHost ? React.createElement(LieroButton, {
          onClick: addBot, padding: '10px 20px'
        }, 'Add Bot') : null,

        isHost ? React.createElement(LieroButton, {
          variant: 'success',
          onClick: startGame,
          disabled: !canStart,
          padding: '10px 28px',
          fontSize: '15px'
        }, canStart ? 'Start Game' : 'Need 2+ Players') : null,

        !isHost ? React.createElement('div', {
          style: { color: LIERO_STYLES.muted, fontSize: '14px', padding: '10px' }
        }, 'Waiting for host to start...') : null,

        React.createElement(LieroButton, {
          variant: 'error', onClick: leaveLobby, padding: '10px 20px'
        }, 'Leave Lobby')
      )
    );
  }

  // ========================= RENDER: IN GAME / GAME OVER =========================

  if (mode === 'game' || mode === 'gameover') {
    // Find local player for HUD
    var me = null;
    var myId = localIdRef.current;
    var players = playersRef.current;
    for (var i = 0; i < players.length; i++) {
      if (players[i].id === myId) { me = players[i]; break; }
    }
    var curWeaponIdx = me ? (me.currentWeaponIdx !== undefined ? me.currentWeaponIdx : currentWeaponRef.current) : currentWeaponRef.current;
    var weaponDefs = weaponsRef.current;
    var myWeapons = me ? (me.weapons || []) : [];
    var spellList = spellsRef.current;

    return React.createElement('div', {
      style: {
        flex: 1, position: 'relative', overflow: 'hidden', background: '#0d0d0f',
        display: 'flex', flexDirection: 'column'
      }
    },
      // Canvas
      React.createElement('canvas', {
        ref: canvasRef,
        style: { flex: 1, display: 'block', cursor: 'crosshair' }
      }),

      // ---- HTML Overlays ----

      // Weapon bar (bottom center)
      React.createElement('div', {
        style: {
          position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: '4px', pointerEvents: 'none', zIndex: 5
        }
      },
        Array.apply(null, Array(5)).map(function(_, wi) {
          var isSelected = wi === curWeaponIdx;
          var wpnId = myWeapons[wi];
          var wpnDef = wpnId && weaponDefs ? weaponDefs[wpnId] : null;
          var wName = wpnDef ? wpnDef.name : (wi < myWeapons.length ? 'Weapon ' + (wi + 1) : 'Empty');
          var isEmpty = wi >= myWeapons.length;
          var catColor = 'rgba(78,80,88,0.5)';
          var catIcon = '';
          var wDamage = '';
          if (wpnDef) {
            var cat = wpnDef.category || '';
            if (cat === 'melee') { catColor = '#ed4245'; catIcon = 'M'; }
            else if (cat === 'ranged') { catColor = '#57f287'; catIcon = 'R'; }
            else if (cat === 'staff') { catColor = '#9b59b6'; catIcon = 'S'; }
            else if (cat === 'shield') { catColor = '#3498db'; catIcon = 'D'; }
            wDamage = wpnDef.damage !== undefined ? (wpnDef.damage + '') : '';
          }
          var borderColor = isEmpty ? 'rgba(78,80,88,0.3)' : (isSelected ? catColor : 'rgba(78,80,88,0.5)');
          var boxShadow = isSelected && !isEmpty ? '0 0 8px ' + catColor + ', inset 0 0 6px rgba(255,255,255,0.1)' : 'none';
          return React.createElement('div', {
            key: wi,
            style: {
              width: isSelected ? '76px' : '44px', height: '44px',
              background: isEmpty ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.65)',
              border: '2px solid ' + borderColor,
              borderRadius: '6px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              transition: 'width 0.15s, border-color 0.15s, box-shadow 0.15s',
              overflow: 'hidden', position: 'relative',
              boxShadow: boxShadow
            }
          },
            // Category icon (top-left corner)
            catIcon ? React.createElement('div', {
              style: {
                position: 'absolute', top: '1px', left: '3px',
                color: catColor, fontSize: '8px', fontWeight: 800, opacity: 0.9
              }
            }, catIcon) : null,
            // Damage number (top-right corner)
            wDamage && !isEmpty ? React.createElement('div', {
              style: {
                position: 'absolute', top: '1px', right: '3px',
                color: '#fff', fontSize: '7px', fontWeight: 700, opacity: 0.8
              }
            }, wDamage) : null,
            // Slot number
            React.createElement('div', {
              style: {
                color: isSelected ? (isEmpty ? LIERO_STYLES.muted : catColor) : LIERO_STYLES.muted,
                fontSize: isEmpty ? '10px' : '11px', fontWeight: 700,
                marginTop: isEmpty ? '0' : '4px'
              }
            }, (wi + 1) + ''),
            // Weapon name (only when selected and not empty)
            isSelected && !isEmpty ? React.createElement('div', {
              style: {
                color: LIERO_STYLES.text, fontSize: '8px', fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                maxWidth: '72px', textAlign: 'center'
              }
            }, wName) : null
          );
        }),
        // Spell slot
        React.createElement('div', {
          style: {
            width: '44px', height: '44px', marginLeft: '8px',
            background: 'rgba(0,0,0,0.65)', border: '2px solid #9b59b6',
            borderRadius: '6px', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', position: 'relative',
            overflow: 'hidden'
          }
        },
          React.createElement('div', {
            style: { color: '#9b59b6', fontSize: '10px', fontWeight: 700 }
          }, 'Q'),
          React.createElement('div', {
            style: { color: LIERO_STYLES.muted, fontSize: '7px', fontWeight: 600 }
          }, me && me.spellbook ? (me.spellbook.replace(/_/g, ' ')) : 'Spell')
        )
      ),

      // Mobile controls overlay
      isMobile ? React.createElement('div', {
        style: {
          position: 'absolute', bottom: '70px', right: '16px',
          display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 6
        }
      },
        // Spell button
        React.createElement('button', {
          style: {
            width: '56px', height: '56px', borderRadius: '50%',
            background: 'rgba(155,89,182,0.3)', border: '2px solid #9b59b6',
            color: '#9b59b6', fontSize: '13px', fontWeight: 800,
            cursor: 'pointer', fontFamily: 'inherit', touchAction: 'manipulation'
          },
          onTouchStart: function(e) { e.preventDefault(); spellPressedRef.current = true; },
          onTouchEnd: function(e) { e.preventDefault(); spellPressedRef.current = false; }
        }, 'SPELL'),
        // Jump button
        React.createElement('button', {
          style: {
            width: '56px', height: '56px', borderRadius: '50%',
            background: 'rgba(87,242,135,0.3)', border: '2px solid #57f287',
            color: '#57f287', fontSize: '13px', fontWeight: 800,
            cursor: 'pointer', fontFamily: 'inherit', touchAction: 'manipulation'
          },
          onTouchStart: function(e) { e.preventDefault(); keysRef.current.jump = true; },
          onTouchEnd: function(e) { e.preventDefault(); keysRef.current.jump = false; }
        }, 'JUMP')
      ) : null,

      // Mobile joystick visual hint (left side)
      isMobile && touchMoveRef.current.active ? React.createElement('div', {
        style: {
          position: 'absolute',
          left: (touchMoveRef.current.startX - 40) + 'px',
          top: (touchMoveRef.current.startY - 40) + 'px',
          width: '80px', height: '80px', borderRadius: '50%',
          border: '2px solid rgba(220,221,222,0.3)',
          pointerEvents: 'none', zIndex: 4
        }
      },
        React.createElement('div', {
          style: {
            position: 'absolute',
            left: (40 + Math.max(-30, Math.min(30, touchMoveRef.current.dx)) - 10) + 'px',
            top: (40 + Math.max(-30, Math.min(30, touchMoveRef.current.dy)) - 10) + 'px',
            width: '20px', height: '20px', borderRadius: '50%',
            background: 'rgba(220,221,222,0.5)'
          }
        })
      ) : null,

      // Controls hint (bottom left, desktop only)
      !isMobile ? React.createElement('div', {
        style: {
          position: 'absolute', bottom: '12px', left: '12px',
          color: LIERO_STYLES.muted, fontSize: '10px', lineHeight: '1.6',
          pointerEvents: 'none', zIndex: 5
        }
      },
        React.createElement('div', null, 'WASD / Arrows: Move'),
        React.createElement('div', null, 'Space: Jump'),
        React.createElement('div', null, 'Mouse: Aim'),
        React.createElement('div', null, 'Click: Fire'),
        React.createElement('div', null, 'Q: Spell'),
        React.createElement('div', null, 'Scroll / 1-5: Switch Weapon')
      ) : null,

      // Leave button (top right)
      React.createElement('div', {
        style: {
          position: 'absolute', top: '8px', right: '8px', zIndex: 6,
          display: 'flex', gap: '8px'
        }
      },
        React.createElement(LieroButton, {
          variant: 'error',
          onClick: function() { leaveLobby(); backToLobby(); },
          padding: '5px 14px', fontSize: '12px'
        }, 'Leave')
      ),

      // ---- GAME OVER OVERLAY ----
      mode === 'gameover' && gameOver ? React.createElement('div', {
        style: {
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', zIndex: 10
        }
      },
        React.createElement('div', {
          style: {
            background: LIERO_STYLES.card, border: '1px solid ' + LIERO_STYLES.border,
            borderRadius: '12px', padding: '32px', maxWidth: '420px', width: '90%',
            textAlign: 'center'
          }
        },
          React.createElement('div', {
            style: { fontSize: '36px', marginBottom: '8px' }
          }, '\u{1F3C6}'),
          React.createElement('h2', {
            style: { color: LIERO_STYLES.accent, fontSize: '24px', fontWeight: 700, margin: '0 0 4px 0' }
          }, (gameOver.winnerName || 'Unknown') + ' Wins!'),
          React.createElement('p', {
            style: { color: LIERO_STYLES.muted, fontSize: '13px', margin: '0 0 20px 0' }
          }, 'Game Over'),

          // Scoreboard
          React.createElement('div', {
            style: { textAlign: 'left', marginBottom: '20px' }
          },
            React.createElement('div', {
              style: { color: LIERO_STYLES.text, fontSize: '13px', fontWeight: 700, marginBottom: '8px' }
            }, 'Final Scores'),
            (gameOver.scores || []).map(function(sc, idx) {
              var isWinner = sc.id === gameOver.winnerId;
              var chipReward = gameOver.chipRewards ? gameOver.chipRewards[sc.id] : 0;
              return React.createElement('div', {
                key: sc.id || idx,
                style: {
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '6px 10px', borderRadius: '4px',
                  background: isWinner ? 'rgba(240,178,50,0.15)' : 'transparent',
                  marginBottom: '3px'
                }
              },
                React.createElement('div', {
                  style: { display: 'flex', alignItems: 'center', gap: '8px' }
                },
                  React.createElement('span', {
                    style: { color: LIERO_STYLES.muted, fontSize: '12px', fontWeight: 700, width: '20px' }
                  }, '#' + (idx + 1)),
                  React.createElement('span', {
                    style: { color: isWinner ? LIERO_STYLES.accent : LIERO_STYLES.text, fontSize: '14px', fontWeight: 600 }
                  }, sc.name || '???')
                ),
                React.createElement('div', {
                  style: { display: 'flex', alignItems: 'center', gap: '12px' }
                },
                  React.createElement('span', {
                    style: { color: LIERO_STYLES.text, fontSize: '13px' }
                  }, (sc.score || 0) + ' kills'),
                  chipReward ? React.createElement('span', {
                    style: { color: LIERO_STYLES.accent, fontSize: '12px', fontWeight: 600 }
                  }, '+' + chipReward + ' chips') : null
                )
              );
            })
          ),

          // Back button
          React.createElement(LieroButton, {
            variant: 'accent', onClick: backToLobby,
            padding: '10px 32px', fontSize: '15px',
            style: { width: '100%' }
          }, 'Back to Lobby')
        )
      ) : null
    );
  }

  // Fallback: loading state
  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: LIERO_STYLES.bg, color: LIERO_STYLES.muted, fontSize: '16px'
    }
  }, 'Connecting...');
}
