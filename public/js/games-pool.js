// games-pool.js
// 8-Ball Pool: Full multiplayer pool game with lobby system for BossCord
// Renders lobby browser + interactive canvas via React.createElement (no JSX)

// ========================= CONSTANTS =========================

var POOL_TABLE_W = 900;
var POOL_TABLE_H = 450;
var POOL_BALL_RADIUS = 10;
var POOL_MAX_SHOT_POWER = 25;
var POOL_MAX_PULL_PIXELS = 150;
var POOL_RAIL_THICKNESS = 40;
var POOL_POCKET_RADIUS = 18;

var POOL_COLORS = {
  bg: '#1c1c1e',
  panel: '#252528',
  panelAlt: '#2a2a2e',
  border: '#4e5058',
  text: '#dcddde',
  textMuted: '#949ba4',
  accent: '#f0b232',
  accentHover: '#d49a28',
  green: '#57f287',
  red: '#ed4245',
  blue: '#5865f2',
  felt: '#0d7a3d',
  feltDark: '#0a6030',
  rail: '#5a3a1a',
  railLight: '#7a5a3a',
  railDark: '#3a2210',
  pocket: '#111111'
};

var POOL_BALL_COLORS = {
  0: '#ffffff',
  1: '#f4d03f',
  2: '#2e86c1',
  3: '#e74c3c',
  4: '#7d3c98',
  5: '#e67e22',
  6: '#27ae60',
  7: '#922b21',
  8: '#1c1c1e',
  9: '#f4d03f',
  10: '#2e86c1',
  11: '#e74c3c',
  12: '#7d3c98',
  13: '#e67e22',
  14: '#27ae60',
  15: '#922b21'
};

// Pocket positions (relative to table playing area)
var POOL_POCKETS = [
  { x: 0, y: 0 },                                    // top-left
  { x: POOL_TABLE_W / 2, y: -4 },                    // top-center
  { x: POOL_TABLE_W, y: 0 },                          // top-right
  { x: 0, y: POOL_TABLE_H },                          // bottom-left
  { x: POOL_TABLE_W / 2, y: POOL_TABLE_H + 4 },      // bottom-center
  { x: POOL_TABLE_W, y: POOL_TABLE_H }                // bottom-right
];

// ========================= HELPER: Styled Button =========================

function PoolButton(props) {
  var baseStyle = {
    padding: props.padding || '8px 18px',
    background: props.variant === 'accent' ? POOL_COLORS.accent :
                props.variant === 'danger' ? POOL_COLORS.red :
                props.variant === 'success' ? POOL_COLORS.green :
                POOL_COLORS.border,
    color: (props.variant === 'accent' || props.variant === 'success') ? POOL_COLORS.bg :
           props.variant === 'danger' ? '#fff' : POOL_COLORS.text,
    border: 'none',
    borderRadius: '6px',
    fontSize: props.fontSize || '13px',
    fontWeight: 600,
    cursor: props.disabled ? 'default' : 'pointer',
    fontFamily: 'inherit',
    opacity: props.disabled ? 0.5 : 1,
    transition: 'background 0.15s'
  };
  if (props.style) {
    baseStyle = Object.assign({}, baseStyle, props.style);
  }

  return React.createElement('button', {
    style: baseStyle,
    onClick: props.disabled ? undefined : props.onClick,
    onMouseEnter: function(e) {
      if (!props.disabled) {
        e.currentTarget.style.background = POOL_COLORS.accent;
        e.currentTarget.style.color = POOL_COLORS.bg;
      }
    },
    onMouseLeave: function(e) {
      if (!props.disabled) {
        var bg = props.variant === 'accent' ? POOL_COLORS.accent :
                 props.variant === 'danger' ? POOL_COLORS.red :
                 props.variant === 'success' ? POOL_COLORS.green :
                 POOL_COLORS.border;
        var fg = (props.variant === 'accent' || props.variant === 'success') ? POOL_COLORS.bg :
                 props.variant === 'danger' ? '#fff' : POOL_COLORS.text;
        e.currentTarget.style.background = bg;
        e.currentTarget.style.color = fg;
      }
    }
  }, props.children);
}

// ========================= MAIN COMPONENT =========================

function PoolGameView() {
  var ctx = useSocket();
  var isMobile = useIsMobile();

  useEffect(function() { ctx.connectGames(); }, []);
  var sock = ctx.gamesSocket || ctx.socket;

  // ---- State ----
  var _mode = useState('browser');
  var mode = _mode[0]; var setMode = _mode[1];

  var _lobbies = useState([]);
  var lobbies = _lobbies[0]; var setLobbies = _lobbies[1];

  var _lobby = useState(null);
  var lobby = _lobby[0]; var setLobby = _lobby[1];

  var _chatMessages = useState([]);
  var chatMessages = _chatMessages[0]; var setChatMessages = _chatMessages[1];

  var _chatInput = useState('');
  var chatInput = _chatInput[0]; var setChatInput = _chatInput[1];

  var _chatOpen = useState(false);
  var chatOpen = _chatOpen[0]; var setChatOpen = _chatOpen[1];

  var _createBet = useState(0);
  var createBet = _createBet[0]; var setCreateBet = _createBet[1];

  var _gameOver = useState(null);
  var gameOver = _gameOver[0]; var setGameOver = _gameOver[1];

  var _turnMessage = useState('');
  var turnMessage = _turnMessage[0]; var setTurnMessage = _turnMessage[1];

  var _showCreate = useState(false);
  var showCreate = _showCreate[0]; var setShowCreate = _showCreate[1];

  var _toasts = useState([]);
  var toasts = _toasts[0]; var setToasts = _toasts[1];

  // ---- Refs (mutable, no re-render) ----
  var canvasRef = useRef(null);
  var animRef = useRef(null);
  var ballsRef = useRef([]);
  var phaseRef = useRef('aiming');
  var turnPlayerRef = useRef(null);
  var myIdRef = useRef(null);
  var isMyTurnRef = useRef(false);
  var ballInHandRef = useRef(false);
  var assignmentRef = useRef({});
  var playersRef = useRef([]);
  var spectatingRef = useRef(false);
  var pocketedRef = useRef({ solids: [], stripes: [] });
  var chatEndRef = useRef(null);
  var toastIdRef = useRef(0);

  // Aiming state (refs to avoid re-renders during mouse movement)
  var aimAngleRef = useRef(0);
  var aimPowerRef = useRef(0);
  var isDraggingRef = useRef(false);
  var mouseRef = useRef({ x: 0, y: 0 });
  var dragStartRef = useRef(null);
  var placingCueRef = useRef({ x: POOL_TABLE_W * 0.25, y: POOL_TABLE_H / 2 });

  // Canvas layout cache
  var layoutRef = useRef({ scale: 1, offsetX: 0, offsetY: 0, canvasW: 0, canvasH: 0 });
  var poolLastCollisionSound = useRef(0);
  var poolLastBounceSound = useRef(0);

  // ---- Toast system ----
  function addToast(message, type) {
    var id = ++toastIdRef.current;
    setToasts(function(prev) {
      var next = prev.concat({ id: id, message: message, type: type || 'info' });
      if (next.length > 3) next = next.slice(next.length - 3);
      return next;
    });
    setTimeout(function() {
      setToasts(function(prev) { return prev.filter(function(t) { return t.id !== id; }); });
    }, 4000);
  }

  // ---- Store sock.id ----
  useEffect(function() {
    if (sock && sock.id) {
      myIdRef.current = sock.id;
    }
  }, [sock]);

  // ---- Auto-scroll chat ----
  useEffect(function() {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  // ========================= SOCKET LISTENERS =========================

  // Browser-mode lobby polling
  useEffect(function() {
    if (!sock || mode !== 'browser') return;

    sock.emit('pool_get_lobbies');
    var interval = setInterval(function() {
      sock.emit('pool_get_lobbies');
    }, 3000);

    function onLobbies(data) {
      if (data && data.lobbies) setLobbies(data.lobbies);
      else if (Array.isArray(data)) setLobbies(data);
    }
    function onLobbiesUpdated(data) {
      if (data && data.lobbies) setLobbies(data.lobbies);
    }

    sock.on('pool_lobbies', onLobbies);
    sock.on('pool_lobbies_updated', onLobbiesUpdated);

    return function() {
      clearInterval(interval);
      sock.off('pool_lobbies', onLobbies);
      sock.off('pool_lobbies_updated', onLobbiesUpdated);
    };
  }, [sock, mode]);

  // Lobby + game events
  useEffect(function() {
    if (!sock) return;

    function onLobbyJoined(data) {
      if (!data) return;
      setLobby(data);
      setChatMessages((data && data.chat) ? data.chat : []);
      setGameOver(null);
      setTurnMessage('');
      spectatingRef.current = false;
      if (data.myId) myIdRef.current = data.myId;
      else if (sock.id) myIdRef.current = sock.id;
      if (data.players) playersRef.current = data.players;
      if (data.state === 'playing') {
        setMode('game');
        if (data.balls) ballsRef.current = data.balls;
        if (data.assignment) assignmentRef.current = data.assignment;
        if (data.turnPlayer) {
          turnPlayerRef.current = data.turnPlayer;
          isMyTurnRef.current = data.turnPlayer === myIdRef.current;
        }
        phaseRef.current = data.phase || 'aiming';
        ballInHandRef.current = !!data.ballInHand;
      } else {
        setMode('lobby');
      }
    }

    function onLobbyUpdate(data) {
      if (!data) return;
      setLobby(data);
      if (data.players) playersRef.current = data.players;
      if (data.chat) setChatMessages(data.chat);
      // Transition from lobby to game
      if (data.state === 'playing' && mode !== 'game') {
        setMode('game');
        if (data.balls) ballsRef.current = data.balls;
        if (data.assignment) assignmentRef.current = data.assignment;
        phaseRef.current = data.phase || 'aiming';
        ballInHandRef.current = !!data.ballInHand;
        if (data.turnPlayer) {
          turnPlayerRef.current = data.turnPlayer;
          isMyTurnRef.current = data.turnPlayer === myIdRef.current;
        }
      }
    }

    function onSpectateUpdate(data) {
      if (!data) return;
      spectatingRef.current = true;
      setLobby(data);
      if (data.players) playersRef.current = data.players;
      if (data.balls) ballsRef.current = data.balls;
      if (data.assignment) assignmentRef.current = data.assignment;
      if (data.turnPlayer) {
        turnPlayerRef.current = data.turnPlayer;
        isMyTurnRef.current = false;
      }
      phaseRef.current = data.phase || 'aiming';
      ballInHandRef.current = !!data.ballInHand;
      if (data.state === 'playing') {
        setMode('game');
      }
    }

    function onPhysicsTick(data) {
      if (!data) return;
      if (data.balls) ballsRef.current = data.balls;
      if (data.phase) phaseRef.current = data.phase;
      if (data.pocketed) pocketedRef.current = data.pocketed;

      // VFX: Ball-ball collisions
      if (data.collisions && data.collisions.length > 0 && canvasRef.current) {
        var now = Date.now();
        var layout = layoutRef.current;
        var cFeltX = layout.offsetX + POOL_RAIL_THICKNESS * layout.scale;
        var cFeltY = layout.offsetY + POOL_RAIL_THICKNESS * layout.scale;
        for (var ci = 0; ci < data.collisions.length; ci++) {
          var col = data.collisions[ci];
          if (col.type === 'ball' && col.x !== undefined) {
            if (window.BossParticles) {
              BossParticles.sparks(canvasRef.current,
                cFeltX + col.x * layout.scale,
                cFeltY + col.y * layout.scale,
                { count: 3, color: '#ffffff' });
            }
            if (now - poolLastCollisionSound.current > 100) {
              poolLastCollisionSound.current = now;
              if (window.BossSounds) BossSounds.play('hit');
            }
          } else if (col.type === 'cushion') {
            if (now - poolLastBounceSound.current > 100) {
              poolLastBounceSound.current = now;
              if (window.BossSounds) BossSounds.play('bounce');
            }
          }
        }
      }

      // VFX: Ball pocketed
      if (data.justPocketed && data.justPocketed.length > 0 && canvasRef.current) {
        var pLayout = layoutRef.current;
        var pFeltX = pLayout.offsetX + POOL_RAIL_THICKNESS * pLayout.scale;
        var pFeltY = pLayout.offsetY + POOL_RAIL_THICKNESS * pLayout.scale;
        for (var pki = 0; pki < data.justPocketed.length; pki++) {
          var pocketedBall = data.justPocketed[pki];
          // Find nearest pocket to the ball's last known position
          if (pocketedBall.pocketX !== undefined) {
            var pkScreenX = pFeltX + pocketedBall.pocketX * pLayout.scale;
            var pkScreenY = pFeltY + pocketedBall.pocketY * pLayout.scale;
            if (window.BossParticles) {
              BossParticles.sparks(canvasRef.current, pkScreenX, pkScreenY, { count: 8, color: '#f0b232' });
            }
          }
          if (window.BossSounds) BossSounds.play('pocket');
        }
      }
    }

    function onShotResult(data) {
      if (!data) return;
      if (data.message) {
        setTurnMessage(data.message);
        addToast(data.message, 'info');
        // Clear after a few seconds
        setTimeout(function() { setTurnMessage(''); }, 3500);
      }
      if (data.assignment) assignmentRef.current = data.assignment;
      if (data.pocketed) pocketedRef.current = data.pocketed;
      if (data.balls) ballsRef.current = data.balls;
    }

    function onTurnChange(data) {
      if (!data) return;
      turnPlayerRef.current = data.turnPlayer;
      isMyTurnRef.current = !spectatingRef.current && data.turnPlayer === myIdRef.current;
      phaseRef.current = data.phase || 'aiming';
      ballInHandRef.current = !!data.ballInHand;
      aimPowerRef.current = 0;
      isDraggingRef.current = false;
      dragStartRef.current = null;
      if (data.balls) ballsRef.current = data.balls;
      // Set cue placement default
      if (data.ballInHand) {
        placingCueRef.current = { x: POOL_TABLE_W * 0.25, y: POOL_TABLE_H / 2 };
      }
    }

    function onGameOverEvt(data) {
      if (!data) return;
      setGameOver(data);
      phaseRef.current = 'game_over';
      isMyTurnRef.current = false;
      // VFX: Win sound
      if (data.winner === myIdRef.current && !spectatingRef.current) {
        if (window.BossSounds) BossSounds.play('win_medium');
      }
    }

    function onChatMsg(data) {
      if (!data) return;
      setChatMessages(function(prev) { return prev.concat(data); });
    }

    function onError(data) {
      var msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : 'Error');
      addToast(msg, 'error');
    }

    function onLobbyLeft() {
      setLobby(null);
      setMode('browser');
      setChatMessages([]);
      setGameOver(null);
      setTurnMessage('');
      ballsRef.current = [];
      phaseRef.current = 'aiming';
      turnPlayerRef.current = null;
      isMyTurnRef.current = false;
      assignmentRef.current = {};
      playersRef.current = [];
      spectatingRef.current = false;
      pocketedRef.current = { solids: [], stripes: [] };
    }

    sock.on('pool_lobby_joined', onLobbyJoined);
    sock.on('pool_lobby_update', onLobbyUpdate);
    sock.on('pool_spectate_update', onSpectateUpdate);
    sock.on('pool_physics_tick', onPhysicsTick);
    sock.on('pool_shot_result', onShotResult);
    sock.on('pool_turn_change', onTurnChange);
    sock.on('pool_game_over', onGameOverEvt);
    sock.on('pool_chat_msg', onChatMsg);
    sock.on('pool_error', onError);
    sock.on('pool_lobby_left', onLobbyLeft);

    return function() {
      sock.off('pool_lobby_joined', onLobbyJoined);
      sock.off('pool_lobby_update', onLobbyUpdate);
      sock.off('pool_spectate_update', onSpectateUpdate);
      sock.off('pool_physics_tick', onPhysicsTick);
      sock.off('pool_shot_result', onShotResult);
      sock.off('pool_turn_change', onTurnChange);
      sock.off('pool_game_over', onGameOverEvt);
      sock.off('pool_chat_msg', onChatMsg);
      sock.off('pool_error', onError);
      sock.off('pool_lobby_left', onLobbyLeft);
    };
  }, [sock, mode]);

  // ========================= CLEANUP ON UNMOUNT =========================

  useEffect(function() {
    return function() {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      var s = ctx.gamesSocket || ctx.socket;
      if (s) s.emit('pool_leave_lobby');
    };
  }, []);

  // ========================= ACTIONS =========================

  function createLobby() {
    if (!sock) return;
    sock.emit('pool_create_lobby', { bet: createBet });
    setShowCreate(false);
  }

  function joinLobby(lobbyId) {
    if (!sock) return;
    sock.emit('pool_join_lobby', { lobbyId: lobbyId });
  }

  function spectateLobby(lobbyId) {
    if (!sock) return;
    sock.emit('pool_spectate', { lobbyId: lobbyId });
  }

  function readyUp() {
    if (!sock) return;
    sock.emit('pool_ready');
  }

  function leaveLobby() {
    if (!sock) return;
    sock.emit('pool_leave_lobby');
    setLobby(null);
    setMode('browser');
    setChatMessages([]);
    setGameOver(null);
    ballsRef.current = [];
    playersRef.current = [];
    assignmentRef.current = {};
    spectatingRef.current = false;
    pocketedRef.current = { solids: [], stripes: [] };
  }

  function sendChat() {
    if (!sock || !chatInput.trim()) return;
    sock.emit('pool_chat', { message: chatInput.trim() });
    setChatInput('');
  }

  function joinQueue() {
    if (!sock) return;
    sock.emit('pool_join_queue');
  }

  function leaveQueue() {
    if (!sock) return;
    sock.emit('pool_leave_queue');
  }

  // ========================= CANVAS RENDER LOOP =========================

  useEffect(function() {
    if (mode !== 'game') {
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
      // Recalculate layout
      var totalW = POOL_TABLE_W + POOL_RAIL_THICKNESS * 2;
      var totalH = POOL_TABLE_H + POOL_RAIL_THICKNESS * 2;
      var scaleX = (canvas.width - 40) / totalW;
      var scaleY = (canvas.height - 40) / totalH;
      var scale = Math.min(scaleX, scaleY, 1.5);
      if (scale < 0.2) scale = 0.2;
      var offsetX = (canvas.width - totalW * scale) / 2;
      var offsetY = (canvas.height - totalH * scale) / 2;
      layoutRef.current = {
        scale: scale,
        offsetX: offsetX,
        offsetY: offsetY,
        canvasW: canvas.width,
        canvasH: canvas.height
      };
    }
    resize();
    window.addEventListener('resize', resize);

    function render() {
      var w = canvas.width;
      var h = canvas.height;
      var layout = layoutRef.current;
      var scale = layout.scale;
      var oX = layout.offsetX;
      var oY = layout.offsetY;
      var balls = ballsRef.current;
      var phase = phaseRef.current;
      var myTurn = isMyTurnRef.current;
      var bih = ballInHandRef.current;

      // The rail-to-felt offset in canvas coords
      var railPx = POOL_RAIL_THICKNESS * scale;
      // Playing area origin on canvas
      var feltX = oX + railPx;
      var feltY = oY + railPx;
      var feltW = POOL_TABLE_W * scale;
      var feltH = POOL_TABLE_H * scale;

      // 1. Clear canvas
      c.fillStyle = POOL_COLORS.bg;
      c.fillRect(0, 0, w, h);

      // 2. Outer table shadow
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.6)';
      c.shadowBlur = 24 * scale;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 4 * scale;
      c.fillStyle = POOL_COLORS.rail;
      drawRoundedRect(c, oX, oY,
        (POOL_TABLE_W + POOL_RAIL_THICKNESS * 2) * scale,
        (POOL_TABLE_H + POOL_RAIL_THICKNESS * 2) * scale,
        16 * scale);
      c.fill();
      c.restore();

      // 3. Rail wood texture (outer border)
      var railGrad = c.createLinearGradient(oX, oY, oX, oY + (POOL_TABLE_H + POOL_RAIL_THICKNESS * 2) * scale);
      railGrad.addColorStop(0, POOL_COLORS.railLight);
      railGrad.addColorStop(0.3, POOL_COLORS.rail);
      railGrad.addColorStop(0.7, POOL_COLORS.railDark);
      railGrad.addColorStop(1, POOL_COLORS.railLight);
      c.fillStyle = railGrad;
      drawRoundedRect(c, oX, oY,
        (POOL_TABLE_W + POOL_RAIL_THICKNESS * 2) * scale,
        (POOL_TABLE_H + POOL_RAIL_THICKNESS * 2) * scale,
        16 * scale);
      c.fill();

      // Rail inner edge highlight
      c.strokeStyle = 'rgba(255,255,255,0.08)';
      c.lineWidth = 2 * scale;
      drawRoundedRect(c, oX + 3 * scale, oY + 3 * scale,
        (POOL_TABLE_W + POOL_RAIL_THICKNESS * 2 - 6) * scale,
        (POOL_TABLE_H + POOL_RAIL_THICKNESS * 2 - 6) * scale,
        14 * scale);
      c.stroke();

      // Rail diamond markers (top and bottom)
      var diamondPositions = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
      c.fillStyle = '#d4a855';
      for (var di = 0; di < diamondPositions.length; di++) {
        var dx = feltX + feltW * diamondPositions[di];
        // Top rail diamond
        drawDiamond(c, dx, oY + railPx * 0.45, 4 * scale, 5 * scale);
        c.fill();
        // Bottom rail diamond
        drawDiamond(c, dx, feltY + feltH + railPx * 0.55, 4 * scale, 5 * scale);
        c.fill();
      }
      // Side rail diamonds
      var sideDiamondPos = [0.25, 0.5, 0.75];
      for (var si = 0; si < sideDiamondPos.length; si++) {
        var dy = feltY + feltH * sideDiamondPos[si];
        // Left
        drawDiamond(c, oX + railPx * 0.45, dy, 4 * scale, 5 * scale);
        c.fill();
        // Right
        drawDiamond(c, feltX + feltW + railPx * 0.55, dy, 4 * scale, 5 * scale);
        c.fill();
      }

      // 4. Inner cushion border (darker edge between rail and felt)
      c.strokeStyle = POOL_COLORS.feltDark;
      c.lineWidth = 3 * scale;
      c.strokeRect(feltX - 2 * scale, feltY - 2 * scale, feltW + 4 * scale, feltH + 4 * scale);

      // 5. Felt surface
      var feltGrad = c.createRadialGradient(
        feltX + feltW / 2, feltY + feltH / 2, feltW * 0.1,
        feltX + feltW / 2, feltY + feltH / 2, feltW * 0.7
      );
      feltGrad.addColorStop(0, '#0e8540');
      feltGrad.addColorStop(1, POOL_COLORS.felt);
      c.fillStyle = feltGrad;
      c.fillRect(feltX, feltY, feltW, feltH);

      // Subtle felt noise texture (dotted pattern)
      c.fillStyle = 'rgba(0,0,0,0.03)';
      var noiseStep = Math.max(6, Math.floor(8 * scale));
      for (var ny = feltY; ny < feltY + feltH; ny += noiseStep) {
        for (var nx = feltX; nx < feltX + feltW; nx += noiseStep) {
          if (((nx + ny) * 7) % 13 < 4) {
            c.fillRect(nx, ny, 1 * scale, 1 * scale);
          }
        }
      }

      // 6. Pockets
      for (var pi = 0; pi < POOL_POCKETS.length; pi++) {
        var pocket = POOL_POCKETS[pi];
        var px = feltX + pocket.x * scale;
        var py = feltY + pocket.y * scale;
        var pr = POOL_POCKET_RADIUS * scale;

        // Pocket glow
        c.save();
        c.beginPath();
        c.arc(px, py, pr + 4 * scale, 0, Math.PI * 2);
        c.fillStyle = 'rgba(0,0,0,0.4)';
        c.fill();
        c.restore();

        // Pocket hole
        var pocketGrad = c.createRadialGradient(px, py, 0, px, py, pr);
        pocketGrad.addColorStop(0, '#000000');
        pocketGrad.addColorStop(0.7, '#0a0a0a');
        pocketGrad.addColorStop(1, '#1a1a1a');
        c.beginPath();
        c.arc(px, py, pr, 0, Math.PI * 2);
        c.fillStyle = pocketGrad;
        c.fill();

        // Pocket rim
        c.beginPath();
        c.arc(px, py, pr, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(100,70,40,0.6)';
        c.lineWidth = 2 * scale;
        c.stroke();
      }

      // 7. Table markings
      // Head string line (dotted)
      var headX = feltX + POOL_TABLE_W * 0.25 * scale;
      c.setLineDash([4 * scale, 6 * scale]);
      c.beginPath();
      c.moveTo(headX, feltY + 6 * scale);
      c.lineTo(headX, feltY + feltH - 6 * scale);
      c.strokeStyle = 'rgba(255,255,255,0.08)';
      c.lineWidth = 1 * scale;
      c.stroke();
      c.setLineDash([]);

      // Foot spot
      var footSpotX = feltX + POOL_TABLE_W * 0.75 * scale;
      var footSpotY = feltY + feltH / 2;
      c.beginPath();
      c.arc(footSpotX, footSpotY, 3 * scale, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,0.15)';
      c.fill();

      // Center spot
      c.beginPath();
      c.arc(feltX + feltW / 2, feltY + feltH / 2, 2 * scale, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,0.1)';
      c.fill();

      // 8. Ball shadows
      for (var bsi = 0; bsi < balls.length; bsi++) {
        var bs = balls[bsi];
        if (bs.pocketed) continue;
        var bsx = feltX + bs.x * scale;
        var bsy = feltY + bs.y * scale;
        var bsr = POOL_BALL_RADIUS * scale;
        c.beginPath();
        c.arc(bsx + 2 * scale, bsy + 3 * scale, bsr + 1 * scale, 0, Math.PI * 2);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        c.fill();
      }

      // 9. Balls
      for (var bi = 0; bi < balls.length; bi++) {
        var ball = balls[bi];
        if (ball.pocketed) continue;
        var bx = feltX + ball.x * scale;
        var by = feltY + ball.y * scale;
        var br = POOL_BALL_RADIUS * scale;
        var bNum = ball.id !== undefined ? ball.id : bi;
        var bColor = POOL_BALL_COLORS[bNum] || '#888888';

        if (bNum === 0) {
          // Cue ball: white with gradient
          drawCueBall(c, bx, by, br);
        } else if (bNum >= 9 && bNum <= 15) {
          // Stripes: white base + color band
          drawStripeBall(c, bx, by, br, bColor, bNum);
        } else {
          // Solids (1-8): full color
          drawSolidBall(c, bx, by, br, bColor, bNum);
        }
      }

      // 10. Ball-in-hand indicator
      if (bih && myTurn && !spectatingRef.current && phase === 'ball_in_hand') {
        var cuePlace = placingCueRef.current;
        var cpx = feltX + cuePlace.x * scale;
        var cpy = feltY + cuePlace.y * scale;
        var cpr = POOL_BALL_RADIUS * scale;

        // Ghost cue ball
        c.globalAlpha = 0.5 + 0.15 * Math.sin(Date.now() * 0.005);
        drawCueBall(c, cpx, cpy, cpr);
        c.globalAlpha = 1.0;

        // Pulsing ring
        var pulseR = cpr + 4 * scale + 3 * scale * Math.sin(Date.now() * 0.004);
        c.beginPath();
        c.arc(cpx, cpy, pulseR, 0, Math.PI * 2);
        c.strokeStyle = 'rgba(255,255,255,0.5)';
        c.lineWidth = 1.5 * scale;
        c.stroke();
      }

      // 11. Cue stick (only when it's my turn, aiming phase, not spectating)
      if (myTurn && !spectatingRef.current && (phase === 'aiming') && !gameOver) {
        var cueBall = findCueBall(balls);
        if (cueBall && !cueBall.pocketed) {
          var cbx = feltX + cueBall.x * scale;
          var cby = feltY + cueBall.y * scale;
          var angle = aimAngleRef.current;
          var power = aimPowerRef.current;
          var dragging = isDraggingRef.current;

          // Aim line (dotted, from cue ball forward in shot direction)
          var aimDirX = Math.cos(angle);
          var aimDirY = Math.sin(angle);
          c.save();
          c.setLineDash([4 * scale, 6 * scale]);
          c.beginPath();
          c.moveTo(cbx, cby);
          c.lineTo(cbx + aimDirX * 300 * scale, cby + aimDirY * 300 * scale);
          c.strokeStyle = 'rgba(255,255,255,0.25)';
          c.lineWidth = 1 * scale;
          c.stroke();
          c.setLineDash([]);

          // Aim circle at end of line
          c.beginPath();
          c.arc(cbx + aimDirX * 300 * scale, cby + aimDirY * 300 * scale, 3 * scale, 0, Math.PI * 2);
          c.fillStyle = 'rgba(255,255,255,0.15)';
          c.fill();
          c.restore();

          // Cue stick itself (extends away from aim direction)
          var pullBack = dragging ? power * 60 * scale : 8 * scale;
          var stickLen = 220 * scale;
          var stickStartDist = POOL_BALL_RADIUS * scale + 4 * scale + pullBack;

          // Stick direction (opposite of aim direction)
          var stickDirX = -aimDirX;
          var stickDirY = -aimDirY;

          var stickTipX = cbx + stickDirX * stickStartDist;
          var stickTipY = cby + stickDirY * stickStartDist;
          var stickEndX = stickTipX + stickDirX * stickLen;
          var stickEndY = stickTipY + stickDirY * stickLen;

          // Stick shadow
          c.save();
          c.beginPath();
          c.moveTo(stickTipX + 2 * scale, stickTipY + 3 * scale);
          c.lineTo(stickEndX + 2 * scale, stickEndY + 3 * scale);
          c.strokeStyle = 'rgba(0,0,0,0.2)';
          c.lineWidth = 8 * scale;
          c.lineCap = 'round';
          c.stroke();
          c.restore();

          // Shaft (wood gradient)
          var shaftGrad = c.createLinearGradient(stickTipX, stickTipY, stickEndX, stickEndY);
          shaftGrad.addColorStop(0, '#c4a35a');
          shaftGrad.addColorStop(0.02, '#f5e6c8');
          shaftGrad.addColorStop(0.08, '#c4a35a');
          shaftGrad.addColorStop(0.5, '#a67c3e');
          shaftGrad.addColorStop(1, '#7a5a2e');
          c.beginPath();
          c.moveTo(stickTipX, stickTipY);
          c.lineTo(stickEndX, stickEndY);
          c.strokeStyle = shaftGrad;
          c.lineWidth = 6 * scale;
          c.lineCap = 'round';
          c.stroke();

          // Ferrule (white tip, smaller section near ball)
          var ferruleLen = 16 * scale;
          var ferruleEndX = stickTipX + stickDirX * ferruleLen;
          var ferruleEndY = stickTipY + stickDirY * ferruleLen;
          c.beginPath();
          c.moveTo(stickTipX, stickTipY);
          c.lineTo(ferruleEndX, ferruleEndY);
          c.strokeStyle = '#f0ece0';
          c.lineWidth = 5 * scale;
          c.lineCap = 'round';
          c.stroke();

          // Blue chalk dot at very tip
          c.beginPath();
          c.arc(stickTipX, stickTipY, 2.5 * scale, 0, Math.PI * 2);
          c.fillStyle = '#4a7ab5';
          c.fill();
        }
      }

      // 12. Power meter (when dragging)
      if (isDraggingRef.current && isMyTurnRef.current && !spectatingRef.current) {
        var meterX = 20;
        var meterY = h * 0.15;
        var meterW = 18;
        var meterH = h * 0.5;
        var power = aimPowerRef.current; // 0..1

        // Background
        c.fillStyle = 'rgba(0,0,0,0.6)';
        drawRoundedRect(c, meterX - 4, meterY - 20, meterW + 8, meterH + 40, 6);
        c.fill();

        // Label
        c.font = 'bold ' + Math.floor(10 * Math.max(scale, 0.7)) + 'px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'bottom';
        c.fillStyle = POOL_COLORS.text;
        c.fillText('POWER', meterX + meterW / 2, meterY - 6);

        // Meter background
        c.fillStyle = 'rgba(255,255,255,0.1)';
        drawRoundedRect(c, meterX, meterY, meterW, meterH, 4);
        c.fill();

        // Power fill (gradient from bottom: green -> yellow -> red)
        var fillH = meterH * power;
        if (fillH > 0) {
          var powerGrad = c.createLinearGradient(meterX, meterY + meterH, meterX, meterY);
          powerGrad.addColorStop(0, '#57f287');
          powerGrad.addColorStop(0.4, '#f0b232');
          powerGrad.addColorStop(0.75, '#ed4245');
          powerGrad.addColorStop(1, '#ff0000');
          c.fillStyle = powerGrad;
          drawRoundedRect(c, meterX, meterY + meterH - fillH, meterW, fillH, 4);
          c.fill();

          // Power percentage text
          c.font = 'bold ' + Math.floor(11 * Math.max(scale, 0.7)) + 'px sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'top';
          c.fillStyle = '#fff';
          c.fillText(Math.round(power * 100) + '%', meterX + meterW / 2, meterY + meterH + 6);
        }
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

    function getTableCoords(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var mx = clientX - rect.left;
      var my = clientY - rect.top;
      var layout = layoutRef.current;
      var feltX = layout.offsetX + POOL_RAIL_THICKNESS * layout.scale;
      var feltY = layout.offsetY + POOL_RAIL_THICKNESS * layout.scale;
      var tableX = (mx - feltX) / layout.scale;
      var tableY = (my - feltY) / layout.scale;
      return { screenX: mx, screenY: my, tableX: tableX, tableY: tableY };
    }

    function onMouseMove(e) {
      var coords = getTableCoords(e.clientX, e.clientY);
      mouseRef.current = { x: coords.screenX, y: coords.screenY };

      if (spectatingRef.current) return;

      var phase = phaseRef.current;

      // Ball-in-hand: move ghost cue ball
      if (phase === 'ball_in_hand' && isMyTurnRef.current && ballInHandRef.current) {
        var cx = Math.max(POOL_BALL_RADIUS, Math.min(POOL_TABLE_W - POOL_BALL_RADIUS, coords.tableX));
        var cy = Math.max(POOL_BALL_RADIUS, Math.min(POOL_TABLE_H - POOL_BALL_RADIUS, coords.tableY));
        placingCueRef.current = { x: cx, y: cy };
        return;
      }

      // Aiming: update angle or power
      if (phase === 'aiming' && isMyTurnRef.current) {
        var cueBall = findCueBall(ballsRef.current);
        if (!cueBall || cueBall.pocketed) return;

        var layout = layoutRef.current;
        var feltX = layout.offsetX + POOL_RAIL_THICKNESS * layout.scale;
        var feltY = layout.offsetY + POOL_RAIL_THICKNESS * layout.scale;
        var cbScreenX = feltX + cueBall.x * layout.scale;
        var cbScreenY = feltY + cueBall.y * layout.scale;

        if (isDraggingRef.current) {
          // Calculate power from drag distance
          var ds = dragStartRef.current;
          if (ds) {
            var dragDist = Math.sqrt(
              Math.pow(coords.screenX - ds.x, 2) + Math.pow(coords.screenY - ds.y, 2)
            );
            aimPowerRef.current = Math.min(1, dragDist / POOL_MAX_PULL_PIXELS);
          }
          // Angle: from mouse to cue ball (pull back to shoot forward)
          aimAngleRef.current = Math.atan2(cbScreenY - coords.screenY, cbScreenX - coords.screenX);
        } else {
          // Not dragging: update aim direction (from cue ball to mouse)
          aimAngleRef.current = Math.atan2(coords.screenY - cbScreenY, coords.screenX - cbScreenX);
        }
      }
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      if (spectatingRef.current) return;
      var coords = getTableCoords(e.clientX, e.clientY);
      var phase = phaseRef.current;

      // Ball-in-hand: place cue ball
      if (phase === 'ball_in_hand' && isMyTurnRef.current && ballInHandRef.current) {
        var cx = Math.max(POOL_BALL_RADIUS, Math.min(POOL_TABLE_W - POOL_BALL_RADIUS, coords.tableX));
        var cy = Math.max(POOL_BALL_RADIUS, Math.min(POOL_TABLE_H - POOL_BALL_RADIUS, coords.tableY));
        sock.emit('pool_place_cue', { x: cx, y: cy });
        return;
      }

      // Aiming: start drag
      if (phase === 'aiming' && isMyTurnRef.current) {
        isDraggingRef.current = true;
        dragStartRef.current = { x: coords.screenX, y: coords.screenY };
        aimPowerRef.current = 0;
      }
    }

    function onMouseUp(e) {
      if (e.button !== 0) return;
      if (spectatingRef.current) return;

      if (isDraggingRef.current && phaseRef.current === 'aiming' && isMyTurnRef.current) {
        var power = aimPowerRef.current;
        if (power > 0.02) {
          // Fire the shot
          sock.emit('pool_shoot', {
            angle: aimAngleRef.current,
            power: power * POOL_MAX_SHOT_POWER
          });
          phaseRef.current = 'simulating';

          // VFX: Chalk dust at cue ball position on shot
          var cueBallShot = findCueBall(ballsRef.current);
          if (cueBallShot && !cueBallShot.pocketed && window.BossParticles && canvasRef.current) {
            var shotLayout = layoutRef.current;
            var shotFeltX = shotLayout.offsetX + POOL_RAIL_THICKNESS * shotLayout.scale;
            var shotFeltY = shotLayout.offsetY + POOL_RAIL_THICKNESS * shotLayout.scale;
            BossParticles.dust(canvasRef.current,
              shotFeltX + cueBallShot.x * shotLayout.scale,
              shotFeltY + cueBallShot.y * shotLayout.scale,
              { count: 5, color: '#5b8a72' });
          }
          if (window.BossSounds) BossSounds.play('hit');
        }
        isDraggingRef.current = false;
        dragStartRef.current = null;
        aimPowerRef.current = 0;
      }
    }

    // Touch support
    function onTouchStart(e) {
      if (e.touches.length === 0) return;
      var t = e.touches[0];
      onMouseDown({ button: 0, clientX: t.clientX, clientY: t.clientY });
      e.preventDefault();
    }

    function onTouchMove(e) {
      if (e.touches.length === 0) return;
      var t = e.touches[0];
      onMouseMove({ clientX: t.clientX, clientY: t.clientY });
      e.preventDefault();
    }

    function onTouchEnd(e) {
      onMouseUp({ button: 0 });
      e.preventDefault();
    }

    // Prevent context menu on canvas
    function onContextMenu(e) { e.preventDefault(); }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd);
    canvas.addEventListener('contextmenu', onContextMenu);

    return function() {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [mode, sock]);

  // ========================= DRAWING HELPERS =========================

  function findCueBall(balls) {
    for (var i = 0; i < balls.length; i++) {
      if ((balls[i].id !== undefined ? balls[i].id : i) === 0) return balls[i];
    }
    return null;
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function drawDiamond(ctx, cx, cy, hw, hh) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy);
    ctx.lineTo(cx, cy + hh);
    ctx.lineTo(cx - hw, cy);
    ctx.closePath();
  }

  function drawCueBall(ctx, x, y, r) {
    // Base
    var grad = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.5, '#f0f0f0');
    grad.addColorStop(1, '#c8c8c8');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Gloss highlight
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();

    // Subtle edge
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  function drawSolidBall(ctx, x, y, r, color, num) {
    // Main fill with gradient
    var grad = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.05, x, y, r);
    grad.addColorStop(0, lightenColor(color, 40));
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, darkenColor(color, 40));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Number circle (white)
    if (num >= 1 && num <= 15) {
      var numR = r * 0.48;
      ctx.beginPath();
      ctx.arc(x, y, numR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Number text
      ctx.font = 'bold ' + Math.max(Math.floor(r * 0.85), 6) + 'px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1c1c1e';
      ctx.fillText(num + '', x, y + 0.5);
    }

    // Gloss
    ctx.beginPath();
    ctx.arc(x - r * 0.2, y - r * 0.25, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();

    // Edge
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  function drawStripeBall(ctx, x, y, r, stripeColor, num) {
    // White base
    var baseGrad = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.05, x, y, r);
    baseGrad.addColorStop(0, '#ffffff');
    baseGrad.addColorStop(0.5, '#f5f5f5');
    baseGrad.addColorStop(1, '#d0d0d0');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = baseGrad;
    ctx.fill();

    // Color stripe band (horizontal band across the middle)
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();

    var bandH = r * 1.0;
    var bandGrad = ctx.createRadialGradient(x - r * 0.2, y - bandH * 0.2, 0, x, y, r * 1.2);
    bandGrad.addColorStop(0, lightenColor(stripeColor, 30));
    bandGrad.addColorStop(0.5, stripeColor);
    bandGrad.addColorStop(1, darkenColor(stripeColor, 30));
    ctx.fillStyle = bandGrad;
    ctx.fillRect(x - r, y - bandH / 2, r * 2, bandH);

    ctx.restore();

    // Number circle (white)
    if (num >= 1 && num <= 15) {
      var numR = r * 0.48;
      ctx.beginPath();
      ctx.arc(x, y, numR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Number text
      ctx.font = 'bold ' + Math.max(Math.floor(r * 0.85), 6) + 'px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#1c1c1e';
      ctx.fillText(num + '', x, y + 0.5);
    }

    // Gloss
    ctx.beginPath();
    ctx.arc(x - r * 0.2, y - r * 0.25, r * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();

    // Edge
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  function lightenColor(hex, amount) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    r = Math.min(255, r + amount);
    g = Math.min(255, g + amount);
    b = Math.min(255, b + amount);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function darkenColor(hex, amount) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    r = Math.max(0, r - amount);
    g = Math.max(0, g - amount);
    b = Math.max(0, b - amount);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // ========================= DERIVED STATE =========================

  var players = playersRef.current;
  var isWaiting = lobby && lobby.state === 'waiting';
  var isPlaying = lobby && lobby.state === 'playing';
  var myId = myIdRef.current;

  // Find me and opponent from lobby players
  var mePlayer = null;
  var opponentPlayer = null;
  var lobbyPlayers = (lobby && lobby.players) ? lobby.players : [];
  for (var lpi = 0; lpi < lobbyPlayers.length; lpi++) {
    if (lobbyPlayers[lpi].id === myId || lobbyPlayers[lpi].isMe) {
      mePlayer = lobbyPlayers[lpi];
    } else {
      opponentPlayer = lobbyPlayers[lpi];
    }
  }

  // ========================= RENDER: TOASTS =========================

  function renderToasts() {
    if (toasts.length === 0) return null;
    return React.createElement('div', {
      style: {
        position: 'fixed', top: '16px', right: '16px', zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: '8px',
        pointerEvents: 'none'
      }
    },
      toasts.map(function(t) {
        return React.createElement('div', {
          key: t.id,
          style: {
            padding: '10px 18px', borderRadius: '8px',
            background: t.type === 'error' ? POOL_COLORS.red :
                       t.type === 'success' ? POOL_COLORS.green : POOL_COLORS.panel,
            color: t.type === 'error' || t.type === 'success' ? '#fff' : POOL_COLORS.text,
            fontSize: '13px', fontWeight: 600,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            border: '1px solid ' + (t.type === 'error' ? POOL_COLORS.red : t.type === 'success' ? POOL_COLORS.green : POOL_COLORS.border),
            pointerEvents: 'auto'
          }
        }, t.message);
      })
    );
  }

  // ========================= RENDER: CHAT PANEL =========================

  function renderChatPanel() {
    return React.createElement('div', {
      style: {
        display: 'flex', flexDirection: 'column',
        height: chatOpen ? '180px' : '36px',
        background: POOL_COLORS.panelAlt,
        borderTop: '1px solid ' + POOL_COLORS.border,
        transition: 'height 0.2s',
        flexShrink: 0
      }
    },
      // Toggle header
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 12px', cursor: 'pointer', flexShrink: 0
        },
        onClick: function() { setChatOpen(function(p) { return !p; }); }
      },
        React.createElement('span', {
          style: { color: POOL_COLORS.textMuted, fontSize: '12px', fontWeight: 600 }
        }, 'Chat' + (chatMessages.length > 0 ? ' (' + chatMessages.length + ')' : '')),
        React.createElement('span', {
          style: {
            color: POOL_COLORS.textMuted, fontSize: '14px',
            transform: chatOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s'
          }
        }, '\u25B2')
      ),

      // Messages
      chatOpen ? React.createElement('div', {
        style: {
          flex: 1, overflowY: 'auto', padding: '4px 12px',
          fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '2px'
        }
      },
        chatMessages.map(function(msg, mi) {
          return React.createElement('div', { key: mi },
            React.createElement('span', {
              style: { color: msg.color || POOL_COLORS.accent, fontWeight: 600 }
            }, (msg.name || 'System') + ': '),
            React.createElement('span', {
              style: { color: POOL_COLORS.text }
            }, ctx.censorText ? ctx.censorText(msg.text || msg.message || '') : (msg.text || msg.message || ''))
          );
        }),
        React.createElement('div', { ref: chatEndRef })
      ) : null,

      // Input
      chatOpen ? React.createElement('div', {
        style: {
          display: 'flex', padding: '6px', gap: '6px', flexShrink: 0
        }
      },
        React.createElement('input', {
          type: 'text',
          value: chatInput,
          onChange: function(e) { setChatInput(e.target.value); },
          onKeyDown: function(e) { if (e.key === 'Enter') sendChat(); },
          placeholder: 'Type a message...',
          style: {
            flex: 1, padding: '6px 10px', background: POOL_COLORS.bg,
            border: '1px solid ' + POOL_COLORS.border, borderRadius: '4px',
            color: POOL_COLORS.text, fontSize: '12px', fontFamily: 'inherit',
            outline: 'none'
          }
        }),
        React.createElement('button', {
          style: {
            padding: '6px 14px', background: POOL_COLORS.accent, border: 'none',
            borderRadius: '4px', color: POOL_COLORS.bg, fontSize: '12px',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: sendChat
        }, 'Send')
      ) : null
    );
  }

  // ========================= RENDER: POCKETED BALLS TRAY =========================

  function renderPocketedTray(type, label) {
    var assignment = assignmentRef.current;
    var pocketed = pocketedRef.current;
    var ballList = (type === 'solids') ? (pocketed.solids || []) : (pocketed.stripes || []);

    var maxBalls = 7;
    var dots = [];
    for (var i = 0; i < maxBalls; i++) {
      var ballNum = ballList[i];
      var filled = ballNum !== undefined && ballNum !== null;
      var color = filled ? (POOL_BALL_COLORS[ballNum] || '#888') : 'rgba(255,255,255,0.1)';
      var isStripe = filled && ballNum >= 9;

      dots.push(React.createElement('div', {
        key: i,
        style: {
          width: '16px', height: '16px', borderRadius: '50%',
          background: filled ? color : 'transparent',
          border: filled ? '1px solid rgba(0,0,0,0.3)' : '1px dashed rgba(255,255,255,0.15)',
          position: 'relative', overflow: 'hidden'
        }
      },
        // Stripe band indicator
        isStripe ? React.createElement('div', {
          style: {
            position: 'absolute', top: '3px', left: 0, right: 0, height: '10px',
            background: 'rgba(255,255,255,0.4)'
          }
        }) : null
      ));
    }

    return React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '6px'
      }
    },
      React.createElement('span', {
        style: { color: POOL_COLORS.textMuted, fontSize: '10px', fontWeight: 600, textTransform: 'uppercase' }
      }, label),
      React.createElement('div', {
        style: { display: 'flex', gap: '3px' }
      }, dots)
    );
  }

  // ========================= RENDER: LOBBY BROWSER =========================

  if (mode === 'browser') {
    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column',
        background: POOL_COLORS.bg, overflow: 'auto'
      }
    },
      // Header
      React.createElement('div', {
        style: {
          padding: isMobile ? '20px 16px 12px' : '28px 24px 16px',
          borderBottom: '1px solid ' + POOL_COLORS.border
        }
      },
        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '12px',
            marginBottom: '16px'
          }
        },
          React.createElement('span', {
            style: { fontSize: '32px', lineHeight: 1 }
          }, '\u{1F3B1}'),
          React.createElement('h2', {
            style: {
              color: POOL_COLORS.text, fontSize: isMobile ? '20px' : '24px',
              fontWeight: 700, margin: 0
            }
          }, '8-Ball Pool')
        ),
        React.createElement('div', {
          style: { display: 'flex', gap: '10px', flexWrap: 'wrap' }
        },
          React.createElement(PoolButton, {
            variant: 'accent',
            onClick: function() { setShowCreate(function(p) { return !p; }); },
            padding: '10px 22px',
            fontSize: '14px'
          }, 'Create Game')
        )
      ),

      // Create dialog
      showCreate ? React.createElement('div', {
        style: {
          margin: isMobile ? '12px 16px' : '16px 24px',
          background: POOL_COLORS.panel, borderRadius: '10px',
          border: '1px solid ' + POOL_COLORS.border, padding: '20px'
        }
      },
        React.createElement('div', {
          style: { color: POOL_COLORS.text, fontSize: '15px', fontWeight: 700, marginBottom: '14px' }
        }, 'Create Pool Game'),

        // Bet input
        React.createElement('div', {
          style: { marginBottom: '16px' }
        },
          React.createElement('div', {
            style: { color: POOL_COLORS.textMuted, fontSize: '12px', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase' }
          }, 'Bet Amount (0 for free play)'),
          React.createElement('div', {
            style: { display: 'flex', gap: '8px', alignItems: 'center' }
          },
            React.createElement('input', {
              type: 'number',
              min: 0,
              step: 10,
              value: createBet,
              onChange: function(e) { setCreateBet(Math.max(0, parseInt(e.target.value) || 0)); },
              style: {
                width: '120px', padding: '8px 12px', background: POOL_COLORS.bg,
                border: '1px solid ' + POOL_COLORS.border, borderRadius: '6px',
                color: POOL_COLORS.text, fontSize: '14px', fontFamily: 'inherit',
                outline: 'none'
              }
            }),
            React.createElement('span', {
              style: { color: POOL_COLORS.textMuted, fontSize: '13px' }
            }, 'chips'),
            // Quick-select buttons
            [0, 50, 100, 500].map(function(amt) {
              return React.createElement('button', {
                key: amt,
                style: {
                  padding: '6px 12px', borderRadius: '4px', border: '1px solid ' + (createBet === amt ? POOL_COLORS.accent : POOL_COLORS.border),
                  background: createBet === amt ? POOL_COLORS.accent : 'transparent',
                  color: createBet === amt ? POOL_COLORS.bg : POOL_COLORS.text,
                  fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s'
                },
                onClick: function() { setCreateBet(amt); }
              }, amt === 0 ? 'Free' : amt + '');
            })
          )
        ),

        React.createElement(PoolButton, {
          variant: 'accent',
          onClick: createLobby,
          padding: '10px 28px',
          fontSize: '14px'
        }, 'Create Lobby')
      ) : null,

      // Lobby list
      React.createElement('div', {
        style: { flex: 1, padding: isMobile ? '12px 16px' : '16px 24px' }
      },
        React.createElement('h3', {
          style: {
            color: POOL_COLORS.textMuted, fontSize: '12px', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            marginBottom: '12px'
          }
        }, 'Open Games'),

        lobbies.length === 0
          ? React.createElement('div', {
              style: {
                color: POOL_COLORS.textMuted, fontSize: '14px',
                textAlign: 'center', padding: '48px 0'
              }
            }, 'No open games. Create one!')
          : React.createElement('div', {
              style: {
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '10px'
              }
            },
              lobbies.map(function(lb) {
                var playerCount = lb.playerCount || (lb.players ? lb.players.length : 0);
                var hostName = lb.hostName || 'Unknown';
                var stateText = lb.state === 'playing' ? 'In Progress' :
                               lb.state === 'finished' ? 'Finished' : 'Waiting...';
                var stateColor = lb.state === 'playing' ? POOL_COLORS.accent :
                                lb.state === 'finished' ? POOL_COLORS.textMuted : POOL_COLORS.green;
                var canJoin = lb.state === 'waiting' && playerCount < 2;
                var betAmount = lb.bet || 0;
                var spectatorCount = lb.spectators || 0;

                return React.createElement('div', {
                  key: lb.id,
                  style: {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: POOL_COLORS.panel, borderRadius: '8px',
                    padding: '14px 16px', border: '1px solid ' + POOL_COLORS.border,
                    transition: 'border-color 0.15s'
                  },
                  onMouseEnter: function(e) { e.currentTarget.style.borderColor = POOL_COLORS.accent; },
                  onMouseLeave: function(e) { e.currentTarget.style.borderColor = POOL_COLORS.border; }
                },
                  React.createElement('div', {
                    style: { display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }
                  },
                    React.createElement('span', {
                      style: { fontSize: '24px', flexShrink: 0 }
                    }, '\u{1F3B1}'),
                    React.createElement('div', {
                      style: { minWidth: 0 }
                    },
                      React.createElement('div', {
                        style: {
                          color: POOL_COLORS.text, fontWeight: 600, fontSize: '14px',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                        }
                      }, hostName + "'s Game"),
                      React.createElement('div', {
                        style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }
                      },
                        React.createElement('span', {
                          style: { color: stateColor, fontSize: '12px' }
                        }, stateText),
                        React.createElement('span', {
                          style: { color: POOL_COLORS.textMuted, fontSize: '12px' }
                        }, playerCount + '/2'),
                        betAmount > 0 ? React.createElement('span', {
                          style: { color: POOL_COLORS.accent, fontSize: '12px', fontWeight: 600 }
                        }, betAmount + ' chips') : React.createElement('span', {
                          style: { color: POOL_COLORS.textMuted, fontSize: '12px' }
                        }, 'Free'),
                        spectatorCount > 0 ? React.createElement('span', {
                          style: { color: POOL_COLORS.textMuted, fontSize: '11px' }
                        }, spectatorCount + ' watching') : null,
                        lb.queueCount > 0 ? React.createElement('span', {
                          style: { color: POOL_COLORS.blue, fontSize: '11px', fontWeight: 600 }
                        }, lb.queueCount + ' in queue') : null
                      )
                    )
                  ),
                  React.createElement('div', {
                    style: { display: 'flex', gap: '6px', flexShrink: 0 }
                  },
                    canJoin ? React.createElement(PoolButton, {
                      variant: 'accent',
                      onClick: function() { joinLobby(lb.id); },
                      padding: '6px 16px',
                      fontSize: '13px'
                    }, 'Join') : null,
                    React.createElement(PoolButton, {
                      onClick: function() { spectateLobby(lb.id); },
                      padding: '6px 12px',
                      fontSize: '12px'
                    }, 'Watch')
                  )
                );
              })
            )
      ),

      renderToasts()
    );
  }

  // ========================= RENDER: LOBBY =========================

  if (mode === 'lobby' && lobby) {
    var lobbyBet = lobby.bet || 0;
    var spectatorCount = lobby.spectators || 0;
    var p1 = lobbyPlayers[0] || null;
    var p2 = lobbyPlayers[1] || null;

    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column',
        background: POOL_COLORS.bg, overflow: 'hidden'
      }
    },
      // Header bar
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px', background: POOL_COLORS.panel,
          borderBottom: '1px solid ' + POOL_COLORS.border, flexShrink: 0
        }
      },
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '12px' }
        },
          React.createElement(PoolButton, {
            onClick: leaveLobby, fontSize: '12px', padding: '5px 14px'
          }, '\u2190 Back'),
          React.createElement('span', {
            style: { color: POOL_COLORS.text, fontSize: '15px', fontWeight: 600 }
          }, '\u{1F3B1} 8-Ball Pool Lobby')
        ),
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '10px' }
        },
          lobbyBet > 0 ? React.createElement('span', {
            style: {
              color: POOL_COLORS.accent, fontSize: '13px', fontWeight: 700,
              padding: '4px 12px', background: 'rgba(240,178,50,0.15)',
              borderRadius: '12px'
            }
          }, 'Bet: ' + lobbyBet + ' chips') : React.createElement('span', {
            style: {
              color: POOL_COLORS.green, fontSize: '13px', fontWeight: 600,
              padding: '4px 12px', background: 'rgba(87,242,135,0.1)',
              borderRadius: '12px'
            }
          }, 'Free Play'),
          spectatorCount > 0 ? React.createElement('span', {
            style: { color: POOL_COLORS.textMuted, fontSize: '12px' }
          }, spectatorCount + ' spectator' + (spectatorCount !== 1 ? 's' : '')) : null,
          (lobby && lobby.queueCount > 0) ? React.createElement('span', {
            style: { color: POOL_COLORS.blue, fontSize: '12px', fontWeight: 600 }
          }, lobby.queueCount + ' in queue') : null
        )
      ),

      // Main content: two player panels
      React.createElement('div', {
        style: {
          flex: 1, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '24px', gap: '24px'
        }
      },
        // VS panel
        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: isMobile ? '16px' : '32px',
            flexWrap: 'wrap', justifyContent: 'center'
          }
        },
          // Player 1 panel
          renderLobbyPlayerPanel(p1, true),
          // VS divider
          React.createElement('div', {
            style: {
              color: POOL_COLORS.accent, fontSize: '28px', fontWeight: 800,
              textShadow: '0 0 12px rgba(240,178,50,0.3)'
            }
          }, 'VS'),
          // Player 2 panel
          renderLobbyPlayerPanel(p2, false)
        ),

        // Ready button
        !spectatingRef.current ? React.createElement('div', {
          style: { display: 'flex', gap: '12px', marginTop: '8px' }
        },
          mePlayer && !mePlayer.ready ? React.createElement(PoolButton, {
            variant: 'success',
            onClick: readyUp,
            padding: '12px 32px',
            fontSize: '15px'
          }, 'Ready Up') : null,
          mePlayer && mePlayer.ready ? React.createElement('span', {
            style: {
              color: POOL_COLORS.green, fontSize: '14px', fontWeight: 700,
              padding: '12px 24px', background: 'rgba(87,242,135,0.1)',
              borderRadius: '8px'
            }
          }, 'Waiting for opponent...') : null
        ) : React.createElement('span', {
          style: { color: POOL_COLORS.textMuted, fontSize: '14px', fontStyle: 'italic' }
        }, 'Spectating')
      ),

      // Chat at bottom
      renderChatPanel(),
      renderToasts()
    );
  }

  // ========================= RENDER: GAME =========================

  if (mode === 'game') {
    var turnPlayer = turnPlayerRef.current;
    var myTurn = isMyTurnRef.current;
    var phase = phaseRef.current;
    var spectating = spectatingRef.current;
    var assignment = assignmentRef.current;

    // Determine player info for HUD
    var p1Info = lobbyPlayers[0] || null;
    var p2Info = lobbyPlayers[1] || null;

    // Find assignment labels
    var p1Type = '';
    var p2Type = '';
    if (assignment && p1Info) {
      p1Type = assignment[p1Info.id] || '';
    }
    if (assignment && p2Info) {
      p2Type = assignment[p2Info.id] || '';
    }

    // Remaining ball counts
    var allBalls = ballsRef.current;
    var solidsRemaining = 0;
    var stripesRemaining = 0;
    var eightBallPocketed = false;
    for (var bci = 0; bci < allBalls.length; bci++) {
      var bcBall = allBalls[bci];
      var bcNum = bcBall.id !== undefined ? bcBall.id : bci;
      if (bcBall.pocketed) {
        if (bcNum === 8) eightBallPocketed = true;
        continue;
      }
      if (bcNum >= 1 && bcNum <= 7) solidsRemaining++;
      if (bcNum >= 9 && bcNum <= 15) stripesRemaining++;
    }

    // Turn status text
    var turnStatusText = '';
    if (phase === 'game_over') {
      turnStatusText = 'Game Over';
    } else if (spectating) {
      turnStatusText = 'Spectating';
    } else if (phase === 'simulating') {
      turnStatusText = 'Balls rolling...';
    } else if (phase === 'ball_in_hand' && myTurn) {
      turnStatusText = 'Click to place cue ball';
    } else if (myTurn) {
      turnStatusText = 'Your Turn - Drag to shoot';
    } else {
      turnStatusText = "Opponent's Turn";
    }

    var turnStatusColor = myTurn ? POOL_COLORS.accent : POOL_COLORS.textMuted;
    if (phase === 'ball_in_hand' && myTurn) turnStatusColor = POOL_COLORS.green;
    if (phase === 'simulating') turnStatusColor = POOL_COLORS.blue;

    return React.createElement('div', {
      style: {
        flex: 1, position: 'relative', overflow: 'hidden', background: POOL_COLORS.bg,
        display: 'flex', flexDirection: 'column'
      }
    },
      // Canvas
      React.createElement('div', {
        style: { flex: 1, position: 'relative', overflow: 'hidden' }
      },
        React.createElement('canvas', {
          ref: canvasRef,
          style: {
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
            display: 'block', cursor: (myTurn && phase === 'aiming') ? 'crosshair' :
                                      (myTurn && phase === 'ball_in_hand') ? 'pointer' : 'default'
          }
        }),

        // ---- HUD Overlays (DOM, positioned over canvas) ----

        // Top bar: player info + turn indicator
        React.createElement('div', {
          style: {
            position: 'absolute', top: 0, left: 0, right: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 12px', pointerEvents: 'none', zIndex: 5,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.5), transparent)'
          }
        },
          // Player 1 info (left)
          React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '6px 12px', borderRadius: '8px',
              background: (turnPlayer === (p1Info ? p1Info.id : '')) ? 'rgba(240,178,50,0.2)' : 'rgba(0,0,0,0.3)',
              border: (turnPlayer === (p1Info ? p1Info.id : '')) ? '1px solid rgba(240,178,50,0.4)' : '1px solid transparent',
              pointerEvents: 'auto', transition: 'all 0.3s'
            }
          },
            // Indicator dot
            React.createElement('div', {
              style: {
                width: '10px', height: '10px', borderRadius: '50%',
                background: p1Type === 'solids' ? '#f4d03f' : p1Type === 'stripes' ? '#2e86c1' : POOL_COLORS.textMuted,
                border: '1px solid rgba(255,255,255,0.3)',
                boxShadow: (turnPlayer === (p1Info ? p1Info.id : '')) ? '0 0 6px rgba(240,178,50,0.6)' : 'none'
              }
            }),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
              React.createElement('span', {
                style: {
                  color: POOL_COLORS.text, fontSize: '13px', fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px'
                }
              }, p1Info ? (p1Info.name || 'Player 1') : 'Player 1'),
              React.createElement('span', {
                style: { color: POOL_COLORS.textMuted, fontSize: '10px' }
              }, (p1Type || 'unassigned') + (p1Type === 'solids' ? (' (' + solidsRemaining + ')') : p1Type === 'stripes' ? (' (' + stripesRemaining + ')') : ''))
            )
          ),

          // Turn indicator (center)
          React.createElement('div', {
            style: {
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              pointerEvents: 'auto'
            }
          },
            React.createElement('span', {
              style: {
                color: turnStatusColor, fontSize: '13px', fontWeight: 700,
                padding: '4px 14px', borderRadius: '14px',
                background: 'rgba(0,0,0,0.5)',
                textShadow: myTurn ? '0 0 8px rgba(240,178,50,0.4)' : 'none'
              }
            }, turnStatusText),
            turnMessage ? React.createElement('span', {
              style: {
                color: POOL_COLORS.text, fontSize: '11px', marginTop: '2px',
                padding: '2px 10px', borderRadius: '8px', background: 'rgba(0,0,0,0.4)'
              }
            }, turnMessage) : null
          ),

          // Player 2 info (right)
          React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '6px 12px', borderRadius: '8px',
              background: (turnPlayer === (p2Info ? p2Info.id : '')) ? 'rgba(240,178,50,0.2)' : 'rgba(0,0,0,0.3)',
              border: (turnPlayer === (p2Info ? p2Info.id : '')) ? '1px solid rgba(240,178,50,0.4)' : '1px solid transparent',
              pointerEvents: 'auto', transition: 'all 0.3s'
            }
          },
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end' } },
              React.createElement('span', {
                style: {
                  color: POOL_COLORS.text, fontSize: '13px', fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px'
                }
              }, p2Info ? (p2Info.name || 'Player 2') : 'Waiting...'),
              React.createElement('span', {
                style: { color: POOL_COLORS.textMuted, fontSize: '10px' }
              }, p2Info ? ((p2Type || 'unassigned') + (p2Type === 'solids' ? (' (' + solidsRemaining + ')') : p2Type === 'stripes' ? (' (' + stripesRemaining + ')') : '')) : '')
            ),
            React.createElement('div', {
              style: {
                width: '10px', height: '10px', borderRadius: '50%',
                background: p2Type === 'solids' ? '#f4d03f' : p2Type === 'stripes' ? '#2e86c1' : POOL_COLORS.textMuted,
                border: '1px solid rgba(255,255,255,0.3)',
                boxShadow: (turnPlayer === (p2Info ? p2Info.id : '')) ? '0 0 6px rgba(240,178,50,0.6)' : 'none'
              }
            })
          )
        ),

        // Bottom tray: pocketed balls
        React.createElement('div', {
          style: {
            position: 'absolute', bottom: 0, left: 0, right: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '24px', padding: '8px 16px', pointerEvents: 'none', zIndex: 5,
            background: 'linear-gradient(to top, rgba(0,0,0,0.4), transparent)'
          }
        },
          renderPocketedTray('solids', 'Solids'),
          // 8-ball indicator
          React.createElement('div', {
            style: {
              width: '20px', height: '20px', borderRadius: '50%',
              background: eightBallPocketed ? '#1c1c1e' : POOL_COLORS.felt,
              border: eightBallPocketed ? '2px solid #ed4245' : '2px solid rgba(255,255,255,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '9px', fontWeight: 800, color: '#fff'
            }
          }, '8'),
          renderPocketedTray('stripes', 'Stripes')
        ),

        // Leave / spectator count (top-right corner)
        React.createElement('div', {
          style: {
            position: 'absolute', top: '52px', right: '12px',
            display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end',
            zIndex: 6
          }
        },
          React.createElement(PoolButton, {
            variant: 'danger',
            onClick: leaveLobby,
            padding: '5px 14px', fontSize: '12px'
          }, 'Leave'),
          // Queue controls (spectators only)
          (spectating && lobby && lobby.queuePosition > 0) ? React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px' }
          },
            React.createElement('span', {
              style: {
                color: POOL_COLORS.blue, fontSize: '11px', fontWeight: 700,
                padding: '3px 8px', background: 'rgba(88,101,242,0.2)',
                borderRadius: '8px', border: '1px solid rgba(88,101,242,0.3)'
              }
            }, 'In Queue (#' + lobby.queuePosition + ')'),
            React.createElement(PoolButton, {
              onClick: leaveQueue,
              padding: '3px 10px', fontSize: '11px'
            }, 'Leave Queue')
          ) : (spectating && !gameOver) ? React.createElement(PoolButton, {
            variant: 'accent',
            onClick: joinQueue,
            padding: '5px 14px', fontSize: '12px'
          }, 'Play Winner') : null,
          (lobby && lobby.spectators > 0) ? React.createElement('span', {
            style: {
              color: POOL_COLORS.textMuted, fontSize: '11px',
              padding: '3px 8px', background: 'rgba(0,0,0,0.4)',
              borderRadius: '8px'
            }
          }, lobby.spectators + ' watching') : null,
          (lobby && lobby.queueCount > 0) ? React.createElement('span', {
            style: {
              color: POOL_COLORS.blue, fontSize: '11px',
              padding: '3px 8px', background: 'rgba(0,0,0,0.4)',
              borderRadius: '8px'
            }
          }, 'Queue: ' + lobby.queueCount) : null
        ),

        // ---- GAME OVER OVERLAY ----
        gameOver ? React.createElement('div', {
          style: {
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 50
          }
        },
          React.createElement('div', {
            style: {
              background: POOL_COLORS.panel, borderRadius: '16px',
              padding: '32px 40px', textAlign: 'center',
              border: '2px solid ' + POOL_COLORS.accent,
              boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
              maxWidth: '380px', width: '90%'
            }
          },
            React.createElement('div', {
              style: { fontSize: '48px', marginBottom: '8px' }
            }, '\u{1F3B1}'),
            React.createElement('h2', {
              style: {
                color: (gameOver.winner === myId && !spectating) ? POOL_COLORS.green :
                       (gameOver.loser === myId && !spectating) ? POOL_COLORS.red : POOL_COLORS.accent,
                fontSize: '24px', fontWeight: 700,
                margin: '0 0 8px 0'
              }
            }, gameOver.winnerName ? (gameOver.winnerName + ' Wins!') : 'Game Over'),
            gameOver.reason ? React.createElement('p', {
              style: {
                color: POOL_COLORS.text, fontSize: '14px', margin: '0 0 8px 0'
              }
            }, gameOver.reason) : null,
            // Show bet winnings
            gameOver.reward ? React.createElement('p', {
              style: {
                color: POOL_COLORS.accent, fontSize: '15px', fontWeight: 700,
                margin: '0 0 20px 0'
              }
            }, '+' + gameOver.reward + ' chips') : React.createElement('div', { style: { marginBottom: '20px' } }),
            React.createElement('div', {
              style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }
            },
              React.createElement(PoolButton, {
                variant: 'accent',
                onClick: leaveLobby,
                padding: '10px 28px',
                fontSize: '14px'
              }, 'Back to Lobby'),
              // Show "Play Winner" if spectating, or if the player lost
              (spectating || (gameOver.loser === myId)) ? (
                (lobby && lobby.queuePosition > 0) ? React.createElement(PoolButton, {
                  variant: 'success',
                  onClick: leaveQueue,
                  padding: '10px 28px',
                  fontSize: '14px',
                  style: { opacity: 1 }
                }, 'In Queue (#' + lobby.queuePosition + ') - Leave') : React.createElement(PoolButton, {
                  variant: 'success',
                  onClick: joinQueue,
                  padding: '10px 28px',
                  fontSize: '14px'
                }, 'Play Winner')
              ) : null
            )
          )
        ) : null
      ),

      // Chat panel at bottom
      renderChatPanel(),
      renderToasts()
    );
  }

  // ========================= HELPER: LOBBY PLAYER PANEL =========================

  function renderLobbyPlayerPanel(player, isBreaker) {
    var panelWidth = isMobile ? '140px' : '200px';
    if (!player) {
      return React.createElement('div', {
        style: {
          width: panelWidth, padding: '24px 16px', borderRadius: '12px',
          background: POOL_COLORS.panel, border: '2px dashed ' + POOL_COLORS.border,
          textAlign: 'center'
        }
      },
        React.createElement('div', {
          style: {
            width: '48px', height: '48px', borderRadius: '50%',
            background: POOL_COLORS.bg, margin: '0 auto 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid ' + POOL_COLORS.border
          }
        },
          React.createElement('span', { style: { color: POOL_COLORS.textMuted, fontSize: '24px' } }, '?')
        ),
        React.createElement('div', {
          style: { color: POOL_COLORS.textMuted, fontSize: '14px', fontStyle: 'italic' }
        }, 'Waiting...')
      );
    }

    var isMe = player.id === myId || player.isMe;
    var ready = player.ready;

    return React.createElement('div', {
      style: {
        width: panelWidth, padding: '24px 16px', borderRadius: '12px',
        background: POOL_COLORS.panel,
        border: '2px solid ' + (ready ? POOL_COLORS.green : POOL_COLORS.border),
        textAlign: 'center',
        boxShadow: ready ? '0 0 16px rgba(87,242,135,0.15)' : 'none',
        transition: 'all 0.3s'
      }
    },
      // Avatar circle
      React.createElement('div', {
        style: {
          width: '48px', height: '48px', borderRadius: '50%',
          background: isMe ? 'rgba(240,178,50,0.2)' : 'rgba(88,101,242,0.2)',
          margin: '0 auto 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid ' + (isMe ? POOL_COLORS.accent : POOL_COLORS.blue),
          fontSize: '24px'
        }
      }, '\u{1F3B1}'),

      // Name
      React.createElement('div', {
        style: {
          color: isMe ? POOL_COLORS.accent : POOL_COLORS.text,
          fontSize: '14px', fontWeight: 600, marginBottom: '4px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }
      }, (player.name || 'Player') + (isMe ? ' (You)' : '')),

      // Breaker label
      isBreaker ? React.createElement('div', {
        style: {
          color: POOL_COLORS.textMuted, fontSize: '11px',
          padding: '2px 8px', display: 'inline-block', borderRadius: '8px',
          background: 'rgba(255,255,255,0.05)', marginBottom: '8px'
        }
      }, '(Breaker)') : React.createElement('div', { style: { height: '20px' } }),

      // Ready status
      React.createElement('div', {
        style: {
          color: ready ? POOL_COLORS.green : POOL_COLORS.textMuted,
          fontSize: '12px', fontWeight: 600
        }
      }, ready ? 'Ready!' : 'Not Ready')
    );
  }

  // ========================= FALLBACK =========================

  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: POOL_COLORS.bg, color: POOL_COLORS.textMuted, fontSize: '16px'
    }
  }, 'Connecting...');
}
