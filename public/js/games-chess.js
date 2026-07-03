// games-chess.js
// Chess: Full multiplayer chess game with lobby system for BossCord
// Renders lobby browser + interactive board via React.createElement (no JSX)

// ========================= CONSTANTS =========================

var CHESS_COLORS = {
  bg: '#1c1c1e',
  panel: '#252528',
  panelAlt: '#2a2a2e',
  gold: '#f0b232',
  green: '#57f287',
  red: '#ed4245',
  blue: '#5865f2',
  orange: '#e67e22',
  text: '#dcddde',
  muted: '#949ba4',
  border: '#4e5058',
  lightSquare: '#f0d9b5',
  darkSquare: '#b58863',
  selectedOverlay: 'rgba(255, 255, 0, 0.5)',
  legalMoveDot: 'rgba(0, 0, 0, 0.25)',
  legalMoveCapture: 'rgba(0, 0, 0, 0.25)',
  lastMoveHighlight: 'rgba(255, 255, 0, 0.3)',
  checkHighlight: 'rgba(237, 66, 69, 0.7)'
};

var CHESS_PIECE_UNICODE = {
  w: { k: '\u2654', q: '\u2655', r: '\u2656', b: '\u2657', n: '\u2658', p: '\u2659' },
  b: { k: '\u265A', q: '\u265B', r: '\u265C', b: '\u265D', n: '\u265E', p: '\u265F' }
};

var CHESS_PIECE_NAMES = {
  k: 'King', q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight', p: 'Pawn'
};

var CHESS_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
var CHESS_RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

var CHESS_TIME_CONTROLS = [
  { key: 'none', label: 'None', color: null },
  { key: 'bullet', label: 'Bullet 1m', color: CHESS_COLORS.red },
  { key: 'blitz', label: 'Blitz 3m', color: CHESS_COLORS.orange },
  { key: 'rapid', label: 'Rapid 10m', color: CHESS_COLORS.blue },
  { key: 'classical', label: 'Classical 30m', color: CHESS_COLORS.green }
];

// ========================= HELPER: Format Time =========================

function chessFormatTime(ms) {
  if (ms <= 0) return '0:00';
  var totalSec = Math.ceil(ms / 1000);
  var min = Math.floor(totalSec / 60);
  var sec = totalSec % 60;
  return min + ':' + (sec < 10 ? '0' : '') + sec;
}

// ========================= HELPER: Time Control Badge Info =========================

function chessTimeControlInfo(tc) {
  for (var i = 0; i < CHESS_TIME_CONTROLS.length; i++) {
    if (CHESS_TIME_CONTROLS[i].key === tc) return CHESS_TIME_CONTROLS[i];
  }
  return null;
}

// ========================= HELPER: Styled Button =========================

function ChessButton(props) {
  var baseStyle = {
    padding: props.padding || '8px 18px',
    background: props.variant === 'accent' ? CHESS_COLORS.gold :
                props.variant === 'danger' ? CHESS_COLORS.red :
                props.variant === 'success' ? CHESS_COLORS.green :
                CHESS_COLORS.border,
    color: (props.variant === 'accent' || props.variant === 'success') ? CHESS_COLORS.bg :
           props.variant === 'danger' ? '#fff' : CHESS_COLORS.text,
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
        e.currentTarget.style.background = CHESS_COLORS.gold;
        e.currentTarget.style.color = CHESS_COLORS.bg;
      }
    },
    onMouseLeave: function(e) {
      if (!props.disabled) {
        var bg = props.variant === 'accent' ? CHESS_COLORS.gold :
                 props.variant === 'danger' ? CHESS_COLORS.red :
                 props.variant === 'success' ? CHESS_COLORS.green :
                 CHESS_COLORS.border;
        var fg = (props.variant === 'accent' || props.variant === 'success') ? CHESS_COLORS.bg :
                 props.variant === 'danger' ? '#fff' : CHESS_COLORS.text;
        e.currentTarget.style.background = bg;
        e.currentTarget.style.color = fg;
      }
    }
  }, props.children);
}

// ========================= HELPER: Algebraic Notation =========================

function chessSquareName(row, col) {
  return CHESS_FILES[col] + CHESS_RANKS[row];
}

// ========================= MAIN COMPONENT =========================

function ChessGameView() {
  var ctx = useSocket();
  var isMobile = useIsMobile();

  useEffect(function() { ctx.connectGames(); }, []);
  var gameSock = ctx.gamesSocket || ctx.socket;

  // ---- State ----
  var [lobbies, setLobbies] = useState([]);
  var [lobby, setLobby] = useState(null);
  var [selectedSquare, setSelectedSquare] = useState(null);
  var [legalMoves, setLegalMoves] = useState([]);
  var [chatInput, setChatInput] = useState('');
  var [chatMessages, setChatMessages] = useState([]);
  var [chatOpen, setChatOpen] = useState(false);
  var [promotionPending, setPromotionPending] = useState(null);
  var [toasts, setToasts] = useState([]);
  var [drawOffered, setDrawOffered] = useState(false);
  var [drawOfferFrom, setDrawOfferFrom] = useState(null);
  var [timeControl, setTimeControl] = useState('none');
  var [times, setTimes] = useState(null);

  var chatEndRef = useRef(null);
  var toastIdRef = useRef(0);
  var boardContainerRef = useRef(null);
  var [boardSize, setBoardSize] = useState(480);
  var clockIntervalRef = useRef(null);
  var [clockTick, setClockTick] = useState(0);
  var [slideAnim, setSlideAnim] = useState(null); // { piece, fromRow, fromCol, toRow, toCol, startTime }
  var prevMoveCountRef = useRef(0);

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

  // ---- Responsive board size ----
  useEffect(function() {
    function calcSize() {
      if (boardContainerRef.current) {
        var rect = boardContainerRef.current.getBoundingClientRect();
        var maxW = rect.width - 16;
        var maxH = rect.height - 16;
        var s = Math.min(maxW, maxH, 560);
        s = Math.max(s, 240);
        s = Math.floor(s / 8) * 8;
        setBoardSize(s);
      } else {
        var w = window.innerWidth;
        if (w < 768) {
          var s2 = Math.min(w - 32, 480);
          s2 = Math.floor(s2 / 8) * 8;
          setBoardSize(s2);
        } else {
          setBoardSize(480);
        }
      }
    }
    calcSize();
    window.addEventListener('resize', calcSize);
    return function() { window.removeEventListener('resize', calcSize); };
  }, [lobby]);

  // ---- Socket listeners ----
  useEffect(function() {
    if (!gameSock) return;
    var sock = gameSock;

    sock.emit('chess_get_lobbies');

    function onLobbies(data) {
      setLobbies((data && data.lobbies) ? data.lobbies : []);
    }
    function onLobbiesUpdated(data) {
      setLobbies((data && data.lobbies) ? data.lobbies : []);
    }
    function onLobbyJoined(data) {
      setLobby(data);
      setChatMessages((data && data.chat) ? data.chat : []);
      setSelectedSquare(null);
      setLegalMoves([]);
      setPromotionPending(null);
      setDrawOffered(false);
      setDrawOfferFrom(null);
      if (data && data.times) setTimes(data.times);
      else setTimes(null);
    }
    function onLobbyUpdate(data) {
      setLobby(data);
      if (data && data.chat) {
        setChatMessages(data.chat);
      }
      if (data && data.times) setTimes(data.times);

      // Sound + animation: detect new moves
      if (data && data.moveHistory) {
        var newMoveCount = data.moveHistory.length;
        if (newMoveCount > prevMoveCountRef.current && prevMoveCountRef.current > 0) {
          // A new move was made
          var isCapture = data.lastMoveCapture || (data.lastMove && data.lastMove.captured);
          var isCheck = data.inCheck;
          var isCheckmate = data.result && data.result.type === 'checkmate';

          if (isCheckmate) {
            if (window.BossSounds) BossSounds.play('win_big');
            // Celebration on checkmate
            if (window.BossEffects) {
              var boardEl = boardContainerRef.current;
              if (boardEl) BossEffects.celebrateBig(boardEl, null);
            }
          } else if (isCheck) {
            if (window.BossSounds) BossSounds.play('check');
          } else if (isCapture) {
            if (window.BossSounds) BossSounds.play('capture');
          } else {
            if (window.BossSounds) BossSounds.play('piece_move');
          }

          // Slide animation: animate piece from source to destination
          if (data.lastMove && data.lastMove.from && data.lastMove.to && data.board) {
            var lmFrom = data.lastMove.from;
            var lmTo = data.lastMove.to;
            var movedPiece = data.board[lmTo[0]] ? data.board[lmTo[0]][lmTo[1]] : null;
            if (movedPiece) {
              setSlideAnim({
                piece: movedPiece,
                fromRow: lmFrom[0], fromCol: lmFrom[1],
                toRow: lmTo[0], toCol: lmTo[1],
                startTime: Date.now()
              });
              // Clear slide animation after 200ms
              setTimeout(function() { setSlideAnim(null); }, 200);
            }
          }
        }
        prevMoveCountRef.current = newMoveCount;
      }

      // Clear selection when it's no longer our turn or game ended
      if (data && data.result) {
        setSelectedSquare(null);
        setLegalMoves([]);
        setPromotionPending(null);
      }
      // Track draw offers
      if (data && data.drawOfferedBy) {
        setDrawOfferFrom(data.drawOfferedBy);
      } else {
        setDrawOfferFrom(null);
        setDrawOffered(false);
      }
    }
    function onLobbyLeft() {
      setLobby(null);
      setChatMessages([]);
      setSelectedSquare(null);
      setLegalMoves([]);
      setPromotionPending(null);
      setDrawOffered(false);
      setDrawOfferFrom(null);
      setTimes(null);
    }
    function onChatMsg(data) {
      setChatMessages(function(prev) { return prev.concat(data); });
    }
    function onError(data) {
      var msg = (data && data.message) ? data.message : (typeof data === 'string' ? data : 'Error');
      addToast(msg, 'error');
    }
    function onTimeUpdate(data) {
      if (data && data.times) setTimes(data.times);
    }

    sock.on('chess_lobbies', onLobbies);
    sock.on('chess_lobbies_updated', onLobbiesUpdated);
    sock.on('chess_lobby_joined', onLobbyJoined);
    sock.on('chess_lobby_update', onLobbyUpdate);
    sock.on('chess_lobby_left', onLobbyLeft);
    sock.on('chess_chat_msg', onChatMsg);
    sock.on('chess_error', onError);
    sock.on('chess_time_update', onTimeUpdate);

    return function() {
      sock.off('chess_lobbies', onLobbies);
      sock.off('chess_lobbies_updated', onLobbiesUpdated);
      sock.off('chess_lobby_joined', onLobbyJoined);
      sock.off('chess_lobby_update', onLobbyUpdate);
      sock.off('chess_lobby_left', onLobbyLeft);
      sock.off('chess_chat_msg', onChatMsg);
      sock.off('chess_error', onError);
      sock.off('chess_time_update', onTimeUpdate);
    };
  }, [gameSock]);

  // ---- Clock tick interval for visual countdown ----
  useEffect(function() {
    if (clockIntervalRef.current) {
      clearInterval(clockIntervalRef.current);
      clockIntervalRef.current = null;
    }
    var lobbyTC = lobby && lobby.timeControl ? lobby.timeControl : 'none';
    var lobbyState = lobby ? lobby.state : null;
    if (times && lobbyTC !== 'none' && lobbyState === 'playing') {
      clockIntervalRef.current = setInterval(function() {
        setClockTick(function(prev) { return prev + 1; });
      }, 100);
    }
    return function() {
      if (clockIntervalRef.current) {
        clearInterval(clockIntervalRef.current);
        clockIntervalRef.current = null;
      }
    };
  }, [times, lobby && lobby.timeControl, lobby && lobby.state]);

  // ---- Auto-scroll chat ----
  useEffect(function() {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length]);

  // ---- Actions ----
  function createLobby() {
    if (!gameSock) return;
    gameSock.emit('chess_create_lobby', { timeControl: timeControl });
  }

  function joinLobby(id) {
    if (!gameSock) return;
    gameSock.emit('chess_join_lobby', { lobbyId: id });
  }

  function spectateLobby(id) {
    if (!gameSock) return;
    gameSock.emit('chess_spectate', { lobbyId: id });
  }

  function joinQueue() {
    if (!gameSock) return;
    gameSock.emit('chess_join_queue');
  }

  function leaveQueue() {
    if (!gameSock) return;
    gameSock.emit('chess_leave_queue');
  }

  function leaveLobby() {
    if (!gameSock) return;
    gameSock.emit('chess_leave_lobby');
    setLobby(null);
    setChatMessages([]);
    setSelectedSquare(null);
    setLegalMoves([]);
    setTimes(null);
  }

  function sendReady() {
    if (!gameSock) return;
    gameSock.emit('chess_ready');
  }

  function sendMove(from, to, promotion) {
    if (!gameSock) return;
    var payload = { from: from, to: to };
    if (promotion) payload.promotion = promotion;
    gameSock.emit('chess_move', payload);
    setSelectedSquare(null);
    setLegalMoves([]);
    // Sound: immediate feedback on our own move
    if (window.BossSounds) BossSounds.play('piece_move');
  }

  function sendResign() {
    if (!gameSock) return;
    gameSock.emit('chess_resign');
  }

  function sendOfferDraw() {
    if (!gameSock) return;
    gameSock.emit('chess_offer_draw');
    setDrawOffered(true);
  }

  function sendAcceptDraw() {
    if (!gameSock) return;
    gameSock.emit('chess_accept_draw');
  }

  function sendChat() {
    if (!gameSock || !chatInput.trim()) return;
    gameSock.emit('chess_chat', { message: chatInput.trim() });
    setChatInput('');
  }

  // ---- Derived game state ----
  var board = (lobby && lobby.board) ? lobby.board : null;
  var players = (lobby && lobby.players) ? lobby.players : [];
  var me = null;
  var opponent = null;
  for (var pi = 0; pi < players.length; pi++) {
    if (players[pi].isMe) me = players[pi];
    else opponent = players[pi];
  }
  var myColor = me ? me.color : null;
  var isSpectator = lobby && lobby.role === 'spectator';
  var isFlipped = isSpectator ? false : (myColor === 'b');
  var isMyTurn = !isSpectator && lobby && lobby.turn === myColor && !lobby.result;
  var isWaiting = lobby && lobby.state === 'waiting';
  var isPlaying = lobby && lobby.state === 'playing';
  var isFinished = lobby && (lobby.state === 'finished' || lobby.result);
  var lastMove = (lobby && lobby.lastMove) ? lobby.lastMove : null;
  var inCheck = (lobby && lobby.inCheck) ? lobby.inCheck : null;
  var result = (lobby && lobby.result) ? lobby.result : null;
  var moveHistory = (lobby && lobby.moveHistory) ? lobby.moveHistory : [];
  var capturedPieces = (lobby && lobby.capturedPieces) ? lobby.capturedPieces : { w: [], b: [] };
  var serverLegalMoves = (lobby && lobby.legalMoves) ? lobby.legalMoves : null;
  var queuePosition = (lobby && lobby.queuePosition) || 0;
  var inQueue = queuePosition > 0;
  var lobbyTimeControl = (lobby && lobby.timeControl) ? lobby.timeControl : 'none';
  var hasClock = lobbyTimeControl !== 'none' && times !== null;

  // Determine if the draw was offered by the OTHER player (so we can show accept)
  var canAcceptDraw = !isSpectator && drawOfferFrom && me && drawOfferFrom !== me.id;

  // For spectators, find both players by color
  var whitePlayer = null;
  var blackPlayer = null;
  for (var pj = 0; pj < players.length; pj++) {
    if (players[pj].color === 'w') whitePlayer = players[pj];
    if (players[pj].color === 'b') blackPlayer = players[pj];
  }

  // ---- Board click handler ----
  function handleSquareClick(row, col) {
    // Spectators cannot interact with the board
    if (isSpectator) return;
    if (!isMyTurn || !board || isFinished) return;

    // If promotion dialog is open, ignore board clicks
    if (promotionPending) return;

    var piece = board[row] ? board[row][col] : null;

    // If we have a selected square, try to move
    if (selectedSquare) {
      var fromRow = selectedSquare[0];
      var fromCol = selectedSquare[1];

      // Check if clicking the same square - deselect
      if (fromRow === row && fromCol === col) {
        setSelectedSquare(null);
        setLegalMoves([]);
        return;
      }

      // Check if clicking another piece of our color - reselect
      if (piece && piece.color === myColor) {
        setSelectedSquare([row, col]);
        computeLegalMovesForSquare(row, col);
        return;
      }

      // Check if this is a legal move
      var isLegal = false;
      for (var li = 0; li < legalMoves.length; li++) {
        if (legalMoves[li][0] === row && legalMoves[li][1] === col) {
          isLegal = true;
          break;
        }
      }

      if (isLegal) {
        // Check for pawn promotion
        var fromPiece = board[fromRow] ? board[fromRow][fromCol] : null;
        if (fromPiece && fromPiece.type === 'p') {
          var promotionRank = myColor === 'w' ? 0 : 7;
          if (row === promotionRank) {
            setPromotionPending({ from: [fromRow, fromCol], to: [row, col] });
            return;
          }
        }
        sendMove([fromRow, fromCol], [row, col]);
      } else {
        // Click on a non-legal square: deselect
        setSelectedSquare(null);
        setLegalMoves([]);
      }
      return;
    }

    // No selection yet - select a piece of our color
    if (piece && piece.color === myColor) {
      setSelectedSquare([row, col]);
      computeLegalMovesForSquare(row, col);
    }
  }

  function computeLegalMovesForSquare(row, col) {
    // Use server-provided legal moves if available
    if (serverLegalMoves) {
      var key = row + ',' + col;
      var fromKey = chessSquareName(row, col);
      var moves = [];
      // Try both coordinate key and algebraic key formats
      if (serverLegalMoves[key]) {
        moves = serverLegalMoves[key];
      } else if (serverLegalMoves[fromKey]) {
        moves = serverLegalMoves[fromKey];
      } else {
        // Iterate looking for matching source
        var allKeys = Object.keys(serverLegalMoves);
        for (var ki = 0; ki < allKeys.length; ki++) {
          var k = allKeys[ki];
          if (k === key || k === fromKey) {
            moves = serverLegalMoves[k];
            break;
          }
        }
      }
      setLegalMoves(moves || []);
    } else {
      // No server legal moves - let user click anywhere, server validates
      setLegalMoves([]);
    }
  }

  function handlePromotion(pieceType) {
    if (!promotionPending) return;
    sendMove(promotionPending.from, promotionPending.to, pieceType);
    setPromotionPending(null);
  }

  function cancelPromotion() {
    setPromotionPending(null);
  }

  // ================================================================
  // LOBBY BROWSER
  // ================================================================

  if (!lobby) {
    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column',
        background: CHESS_COLORS.bg, overflow: 'auto'
      }
    },
      // Header
      React.createElement('div', {
        style: {
          padding: isMobile ? '20px 16px 12px' : '28px 24px 16px',
          borderBottom: '1px solid ' + CHESS_COLORS.border
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
          }, '\u265A'),
          React.createElement('h2', {
            style: {
              color: CHESS_COLORS.text, fontSize: isMobile ? '20px' : '24px',
              fontWeight: 700, margin: 0
            }
          }, 'Chess')
        ),
        // Time control selector row
        React.createElement('div', {
          style: {
            display: 'flex', gap: '8px', flexWrap: 'wrap',
            alignItems: 'center', marginBottom: '12px'
          }
        },
          React.createElement('span', {
            style: {
              color: CHESS_COLORS.muted, fontSize: '12px', fontWeight: 600,
              marginRight: '4px'
            }
          }, 'Time:'),
          CHESS_TIME_CONTROLS.map(function(tc) {
            var isSelected = timeControl === tc.key;
            return React.createElement('button', {
              key: tc.key,
              style: {
                padding: '5px 12px',
                background: isSelected ? CHESS_COLORS.gold : CHESS_COLORS.panel,
                color: isSelected ? CHESS_COLORS.bg : CHESS_COLORS.text,
                border: '1px solid ' + (isSelected ? CHESS_COLORS.gold : CHESS_COLORS.border),
                borderRadius: '14px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'background 0.15s, border-color 0.15s'
              },
              onClick: function() { setTimeControl(tc.key); },
              onMouseEnter: function(e) {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = CHESS_COLORS.gold;
                }
              },
              onMouseLeave: function(e) {
                if (!isSelected) {
                  e.currentTarget.style.borderColor = CHESS_COLORS.border;
                }
              }
            }, tc.key === 'none' ? 'None' : tc.label);
          })
        ),
        // Create Game button
        React.createElement('div', {
          style: { display: 'flex', gap: '10px', flexWrap: 'wrap' }
        },
          React.createElement(ChessButton, {
            variant: 'accent',
            onClick: createLobby,
            padding: '10px 22px',
            fontSize: '14px'
          }, 'Create Game')
        )
      ),

      // Lobby list
      React.createElement('div', {
        style: { flex: 1, padding: isMobile ? '12px 16px' : '16px 24px' }
      },
        React.createElement('h3', {
          style: {
            color: CHESS_COLORS.muted, fontSize: '12px', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            marginBottom: '12px'
          }
        }, 'Open Games'),

        lobbies.length === 0
          ? React.createElement('div', {
              style: {
                color: CHESS_COLORS.muted, fontSize: '14px',
                textAlign: 'center', padding: '48px 0'
              }
            }, 'No open games. Create one!')
          : React.createElement('div', {
              style: {
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '10px'
              }
            },
              lobbies.map(function(lb) {
                var playerCount = lb.playerCount || (lb.players ? lb.players.length : 0);
                var hostName = lb.hostName || 'Unknown';
                var opponentName = lb.opponentName || null;
                var stateText = lb.state === 'playing' ? 'In Progress' :
                               lb.state === 'finished' ? 'Finished' : 'Waiting...';
                var stateColor = lb.state === 'playing' ? CHESS_COLORS.gold :
                                lb.state === 'finished' ? CHESS_COLORS.muted : CHESS_COLORS.green;
                var canJoin = lb.state === 'waiting' && playerCount < 2;
                var canSpectate = !canJoin && (lb.state === 'playing' || playerCount >= 2);
                var tcInfo = chessTimeControlInfo(lb.timeControl);
                var spectatorCount = lb.spectatorCount || 0;
                var queueCount = lb.queueCount || 0;

                // Build info line parts
                var infoLineParts = [stateText + ' \u2022 ' + playerCount + '/2'];
                if (spectatorCount > 0) {
                  infoLineParts.push(spectatorCount + ' watching');
                }
                if (queueCount > 0) {
                  infoLineParts.push(queueCount + ' in queue');
                }
                var infoLine = infoLineParts.join(' \u2022 ');

                return React.createElement('div', {
                  key: lb.id,
                  style: {
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: CHESS_COLORS.panel, borderRadius: '8px',
                    padding: '14px 16px', border: '1px solid ' + CHESS_COLORS.border,
                    cursor: canJoin ? 'pointer' : 'default',
                    transition: 'border-color 0.15s'
                  },
                  onClick: canJoin ? function() { joinLobby(lb.id); } : undefined,
                  onMouseEnter: canJoin ? function(e) { e.currentTarget.style.borderColor = CHESS_COLORS.gold; } : undefined,
                  onMouseLeave: canJoin ? function(e) { e.currentTarget.style.borderColor = CHESS_COLORS.border; } : undefined
                },
                  React.createElement('div', {
                    style: { display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }
                  },
                    React.createElement('span', {
                      style: { fontSize: '24px', flexShrink: 0 }
                    }, '\u265A'),
                    React.createElement('div', {
                      style: { minWidth: 0 }
                    },
                      React.createElement('div', {
                        style: {
                          display: 'flex', alignItems: 'center', gap: '6px'
                        }
                      },
                        React.createElement('span', {
                          style: {
                            color: CHESS_COLORS.text, fontWeight: 600, fontSize: '14px',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                          }
                        }, hostName + (opponentName ? ' vs ' + opponentName : '')),
                        // Time control badge
                        tcInfo && tcInfo.color ? React.createElement('span', {
                          style: {
                            display: 'inline-block',
                            padding: '1px 7px',
                            background: tcInfo.color,
                            color: '#fff',
                            borderRadius: '8px',
                            fontSize: '10px',
                            fontWeight: 700,
                            flexShrink: 0,
                            lineHeight: '16px'
                          }
                        }, tcInfo.label) : null
                      ),
                      React.createElement('div', {
                        style: { color: stateColor, fontSize: '12px', marginTop: '2px' }
                      }, infoLine)
                    )
                  ),
                  // Action buttons area
                  React.createElement('div', {
                    style: { display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center' }
                  },
                    canJoin ? React.createElement('div', {
                      style: {
                        background: CHESS_COLORS.gold, color: CHESS_COLORS.bg,
                        padding: '6px 16px', borderRadius: '4px', fontSize: '13px',
                        fontWeight: 600
                      }
                    }, 'Join') : null,
                    canSpectate ? React.createElement('button', {
                      style: {
                        background: CHESS_COLORS.blue, color: '#fff',
                        padding: '6px 14px', borderRadius: '4px', fontSize: '12px',
                        fontWeight: 600, border: 'none', cursor: 'pointer',
                        fontFamily: 'inherit', transition: 'background 0.15s'
                      },
                      onClick: function(e) {
                        e.stopPropagation();
                        spectateLobby(lb.id);
                      },
                      onMouseEnter: function(e) {
                        e.currentTarget.style.background = CHESS_COLORS.gold;
                        e.currentTarget.style.color = CHESS_COLORS.bg;
                      },
                      onMouseLeave: function(e) {
                        e.currentTarget.style.background = CHESS_COLORS.blue;
                        e.currentTarget.style.color = '#fff';
                      }
                    }, 'Spectate') : null
                  )
                );
              })
            )
      ),

      // Toasts
      renderToasts()
    );
  }

  // ================================================================
  // GAME VIEW
  // ================================================================

  var sqSize = Math.floor(boardSize / 8);

  // Render functions

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
            background: t.type === 'error' ? CHESS_COLORS.red :
                       t.type === 'success' ? CHESS_COLORS.green : CHESS_COLORS.panel,
            color: t.type === 'error' || t.type === 'success' ? '#fff' : CHESS_COLORS.text,
            fontSize: '13px', fontWeight: 600,
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            border: '1px solid ' + (t.type === 'error' ? CHESS_COLORS.red : t.type === 'success' ? CHESS_COLORS.green : CHESS_COLORS.border),
            pointerEvents: 'auto'
          }
        }, t.message);
      })
    );
  }

  function renderClock(color) {
    if (!hasClock || !times) return null;
    var ms = (color === 'w') ? (times.w || 0) : (times.b || 0);
    var isActive = lobby && lobby.turn === color && isPlaying && !isFinished;
    var isLow = ms < 30000;
    var isCritical = ms < 10000;
    // Use clockTick to force re-render for visual update; the actual ms comes from server
    var _tick = clockTick;

    var clockBg = isActive ? 'rgba(240,178,50,0.12)' : 'rgba(255,255,255,0.04)';
    var clockBorder = isActive ? CHESS_COLORS.gold : CHESS_COLORS.border;
    var clockColor = isCritical ? CHESS_COLORS.red : isLow ? CHESS_COLORS.red : CHESS_COLORS.text;
    var clockShadow = isCritical ? '0 0 10px rgba(237,66,69,0.5)' :
                      isActive ? '0 0 6px rgba(240,178,50,0.3)' : 'none';
    // Flash effect for low time - use clockTick to alternate
    var flashOpacity = 1;
    if (isLow && isActive) {
      flashOpacity = (_tick % 10 < 5) ? 1 : 0.6;
    }

    return React.createElement('div', {
      style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        padding: '4px 10px',
        background: clockBg,
        border: '2px solid ' + clockBorder,
        borderRadius: '6px',
        minWidth: '60px',
        boxShadow: clockShadow,
        opacity: flashOpacity,
        transition: 'border-color 0.2s, box-shadow 0.2s, opacity 0.1s'
      }
    },
      React.createElement('span', {
        style: {
          fontFamily: 'monospace', fontSize: '14px', fontWeight: 700,
          color: clockColor
        }
      }, chessFormatTime(ms))
    );
  }

  function renderSquare(row, col) {
    var displayRow = isFlipped ? (7 - row) : row;
    var displayCol = isFlipped ? (7 - col) : col;
    var actualRow = displayRow;
    var actualCol = displayCol;

    // Board data is in actual coordinates
    var piece = board && board[actualRow] ? board[actualRow][actualCol] : null;
    var isLight = (actualRow + actualCol) % 2 === 0;
    var baseBg = isLight ? CHESS_COLORS.lightSquare : CHESS_COLORS.darkSquare;

    // Determine highlights
    var isSelected = selectedSquare && selectedSquare[0] === actualRow && selectedSquare[1] === actualCol;
    var isLastMoveFrom = lastMove && lastMove.from && lastMove.from[0] === actualRow && lastMove.from[1] === actualCol;
    var isLastMoveTo = lastMove && lastMove.to && lastMove.to[0] === actualRow && lastMove.to[1] === actualCol;
    var isCheckSquare = inCheck && piece && piece.type === 'k' && piece.color === inCheck;

    var isLegalTarget = false;
    for (var li = 0; li < legalMoves.length; li++) {
      if (legalMoves[li][0] === actualRow && legalMoves[li][1] === actualCol) {
        isLegalTarget = true;
        break;
      }
    }

    var overlays = [];

    // Last move highlight
    if (isLastMoveFrom || isLastMoveTo) {
      overlays.push(React.createElement('div', {
        key: 'lastmove',
        style: {
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: CHESS_COLORS.lastMoveHighlight,
          pointerEvents: 'none'
        }
      }));
    }

    // Check highlight
    if (isCheckSquare) {
      overlays.push(React.createElement('div', {
        key: 'check',
        style: {
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: CHESS_COLORS.checkHighlight,
          pointerEvents: 'none'
        }
      }));
    }

    // Selection highlight
    if (isSelected) {
      overlays.push(React.createElement('div', {
        key: 'selected',
        style: {
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: CHESS_COLORS.selectedOverlay,
          pointerEvents: 'none'
        }
      }));
    }

    // Legal move indicator
    if (isLegalTarget) {
      var hasPiece = piece !== null && piece !== undefined;
      if (hasPiece) {
        // Capture ring
        overlays.push(React.createElement('div', {
          key: 'legal',
          style: {
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            borderRadius: '50%',
            border: (Math.floor(sqSize * 0.12)) + 'px solid ' + CHESS_COLORS.legalMoveCapture,
            boxSizing: 'border-box',
            pointerEvents: 'none'
          }
        }));
      } else {
        // Empty square dot
        var dotSize = Math.max(Math.floor(sqSize * 0.3), 8);
        overlays.push(React.createElement('div', {
          key: 'legal',
          style: {
            position: 'absolute',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: dotSize + 'px', height: dotSize + 'px',
            borderRadius: '50%',
            background: CHESS_COLORS.legalMoveDot,
            pointerEvents: 'none'
          }
        }));
      }
    }

    // Piece
    var pieceElement = null;
    if (piece) {
      var pieceChar = CHESS_PIECE_UNICODE[piece.color] ? CHESS_PIECE_UNICODE[piece.color][piece.type] : '?';
      var pieceFontSize = Math.floor(sqSize * 0.75);
      pieceElement = React.createElement('div', {
        style: {
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: pieceFontSize + 'px',
          lineHeight: 1,
          pointerEvents: 'none',
          userSelect: 'none',
          textShadow: piece.color === 'w'
            ? '0 1px 3px rgba(0,0,0,0.3)'
            : '0 1px 2px rgba(0,0,0,0.2)'
        }
      }, pieceChar);
    }

    // Coordinate labels on edge squares
    var coordLabels = [];
    // File letter on bottom row
    if (row === 7) {
      var fileChar = CHESS_FILES[isFlipped ? (7 - col) : col];
      coordLabels.push(React.createElement('div', {
        key: 'file',
        style: {
          position: 'absolute', bottom: '1px', right: '3px',
          fontSize: Math.max(Math.floor(sqSize * 0.18), 9) + 'px',
          fontWeight: 700,
          color: isLight ? CHESS_COLORS.darkSquare : CHESS_COLORS.lightSquare,
          opacity: 0.8, pointerEvents: 'none', userSelect: 'none',
          lineHeight: 1
        }
      }, fileChar));
    }
    // Rank number on left column
    if (col === 0) {
      var rankChar = CHESS_RANKS[isFlipped ? (7 - row) : row];
      coordLabels.push(React.createElement('div', {
        key: 'rank',
        style: {
          position: 'absolute', top: '2px', left: '3px',
          fontSize: Math.max(Math.floor(sqSize * 0.18), 9) + 'px',
          fontWeight: 700,
          color: isLight ? CHESS_COLORS.darkSquare : CHESS_COLORS.lightSquare,
          opacity: 0.8, pointerEvents: 'none', userSelect: 'none',
          lineHeight: 1
        }
      }, rankChar));
    }

    // Cursor: spectators get default, players get pointer only on their turn
    var squareCursor = isSpectator ? 'default' : (isMyTurn ? 'pointer' : 'default');

    return React.createElement('div', {
      key: row + '-' + col,
      style: {
        width: sqSize + 'px', height: sqSize + 'px',
        background: baseBg,
        position: 'relative',
        cursor: squareCursor
      },
      onClick: function() { handleSquareClick(actualRow, actualCol); }
    }, overlays.concat(pieceElement ? [pieceElement] : []).concat(coordLabels));
  }

  function renderBoard() {
    var rows = [];
    for (var r = 0; r < 8; r++) {
      var cols = [];
      for (var c = 0; c < 8; c++) {
        cols.push(renderSquare(r, c));
      }
      rows.push(React.createElement('div', {
        key: 'row-' + r,
        style: { display: 'flex' }
      }, cols));
    }

    // Slide animation overlay
    var slideOverlay = null;
    if (slideAnim) {
      var animAge = Date.now() - slideAnim.startTime;
      var animDuration = 200;
      var animProgress = Math.min(1, animAge / animDuration);
      // Ease-out
      var easedProgress = 1 - Math.pow(1 - animProgress, 2);

      // Calculate display positions (accounting for board flip)
      var slideFromRow = isFlipped ? (7 - slideAnim.fromRow) : slideAnim.fromRow;
      var slideFromCol = isFlipped ? (7 - slideAnim.fromCol) : slideAnim.fromCol;
      var slideToRow = isFlipped ? (7 - slideAnim.toRow) : slideAnim.toRow;
      var slideToCol = isFlipped ? (7 - slideAnim.toCol) : slideAnim.toCol;

      var currentX = slideFromCol * sqSize + (slideToCol - slideFromCol) * sqSize * easedProgress;
      var currentY = slideFromRow * sqSize + (slideToRow - slideFromRow) * sqSize * easedProgress;

      var slidePieceChar = CHESS_PIECE_UNICODE[slideAnim.piece.color] ? CHESS_PIECE_UNICODE[slideAnim.piece.color][slideAnim.piece.type] : '?';
      var slideFontSize = Math.floor(sqSize * 0.75);

      if (animProgress < 1) {
        slideOverlay = React.createElement('div', {
          style: {
            position: 'absolute',
            left: currentX + 'px',
            top: currentY + 'px',
            width: sqSize + 'px',
            height: sqSize + 'px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: slideFontSize + 'px',
            lineHeight: 1,
            pointerEvents: 'none',
            zIndex: 20,
            textShadow: slideAnim.piece.color === 'w'
              ? '0 1px 3px rgba(0,0,0,0.3)'
              : '0 1px 2px rgba(0,0,0,0.2)'
          }
        }, slidePieceChar);
      }
    }

    return React.createElement('div', {
      style: {
        border: '2px solid ' + CHESS_COLORS.border,
        borderRadius: '4px',
        overflow: 'hidden',
        lineHeight: 0,
        flexShrink: 0,
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
        position: 'relative'
      }
    }, rows.concat(slideOverlay ? [slideOverlay] : []));
  }

  function renderPromotionDialog() {
    if (!promotionPending || isSpectator) return null;
    var pieces = ['q', 'r', 'b', 'n'];
    var color = myColor || 'w';

    return React.createElement('div', {
      style: {
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100
      },
      onClick: function(e) {
        if (e.target === e.currentTarget) cancelPromotion();
      }
    },
      React.createElement('div', {
        style: {
          background: CHESS_COLORS.panel, borderRadius: '12px',
          padding: '20px', border: '2px solid ' + CHESS_COLORS.gold,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)'
        }
      },
        React.createElement('div', {
          style: {
            color: CHESS_COLORS.text, fontSize: '15px', fontWeight: 600
          }
        }, 'Promote Pawn'),
        React.createElement('div', {
          style: { display: 'flex', gap: '8px' }
        },
          pieces.map(function(pt) {
            var ch = CHESS_PIECE_UNICODE[color][pt];
            return React.createElement('button', {
              key: pt,
              style: {
                width: '56px', height: '56px',
                background: CHESS_COLORS.lightSquare,
                border: '2px solid ' + CHESS_COLORS.border,
                borderRadius: '8px',
                fontSize: '36px', lineHeight: 1,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'border-color 0.15s, transform 0.1s'
              },
              onClick: function() { handlePromotion(pt); },
              onMouseEnter: function(e) {
                e.currentTarget.style.borderColor = CHESS_COLORS.gold;
                e.currentTarget.style.transform = 'scale(1.1)';
              },
              onMouseLeave: function(e) {
                e.currentTarget.style.borderColor = CHESS_COLORS.border;
                e.currentTarget.style.transform = 'scale(1)';
              },
              title: CHESS_PIECE_NAMES[pt]
            }, ch);
          })
        )
      )
    );
  }

  function renderPlayerInfo(player, captured, isTop) {
    // Determine which color this panel represents for clock display
    var panelColor = null;
    if (player) {
      panelColor = player.color || null;
    }

    if (!player) {
      return React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '8px 12px', minHeight: '42px'
        }
      },
        React.createElement('div', {
          style: {
            width: '28px', height: '28px', borderRadius: '50%',
            background: CHESS_COLORS.border,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '14px', color: CHESS_COLORS.muted
          }
        }, '?'),
        React.createElement('span', {
          style: { color: CHESS_COLORS.muted, fontSize: '13px', fontStyle: 'italic' }
        }, 'Waiting for opponent...')
      );
    }

    var playerColor = player.color || 'w';
    var colorLabel = playerColor === 'w' ? 'White' : 'Black';
    var pieceSample = playerColor === 'w' ? '\u2654' : '\u265A';
    var isTurn = lobby && lobby.turn === playerColor && isPlaying;
    var capturedStr = '';
    if (captured && captured.length > 0) {
      var sorted = captured.slice().sort(function(a, b) {
        var order = { q: 0, r: 1, b: 2, n: 3, p: 4 };
        return (order[a] || 5) - (order[b] || 5);
      });
      var capColor = playerColor === 'w' ? 'b' : 'w';
      for (var ci = 0; ci < sorted.length; ci++) {
        capturedStr += CHESS_PIECE_UNICODE[capColor][sorted[ci]] || '';
      }
    }

    return React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 12px', minHeight: '42px',
        background: isTurn ? 'rgba(240,178,50,0.1)' : 'transparent',
        borderRadius: '6px',
        transition: 'background 0.2s'
      }
    },
      // Color indicator
      React.createElement('div', {
        style: {
          width: '28px', height: '28px', borderRadius: '50%',
          background: playerColor === 'w' ? '#f0f0f0' : '#2a2a2a',
          border: '2px solid ' + (isTurn ? CHESS_COLORS.gold : CHESS_COLORS.border),
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '16px', lineHeight: 1,
          boxShadow: isTurn ? '0 0 8px rgba(240,178,50,0.4)' : 'none',
          transition: 'border-color 0.2s, box-shadow 0.2s'
        }
      }, pieceSample),

      // Name and info
      React.createElement('div', {
        style: { flex: 1, minWidth: 0 }
      },
        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '6px'
          }
        },
          React.createElement('span', {
            style: {
              color: player.isMe ? CHESS_COLORS.gold : CHESS_COLORS.text,
              fontSize: '13px', fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }
          }, player.name + (player.isMe ? ' (You)' : '')),
          React.createElement('span', {
            style: {
              color: CHESS_COLORS.muted, fontSize: '11px'
            }
          }, colorLabel)
        ),
        capturedStr ? React.createElement('div', {
          style: {
            fontSize: '14px', lineHeight: 1.2, marginTop: '2px',
            letterSpacing: '1px', opacity: 0.8
          }
        }, capturedStr) : null
      ),

      // Clock display (right side of player info)
      panelColor ? renderClock(panelColor) : null,

      // Turn indicator
      isTurn ? React.createElement('div', {
        style: {
          width: '8px', height: '8px', borderRadius: '50%',
          background: CHESS_COLORS.gold,
          boxShadow: '0 0 6px rgba(240,178,50,0.6)',
          flexShrink: 0
        }
      }) : null
    );
  }

  function renderMoveHistory() {
    if (!moveHistory || moveHistory.length === 0) {
      return React.createElement('div', {
        style: {
          color: CHESS_COLORS.muted, fontSize: '12px', fontStyle: 'italic',
          textAlign: 'center', padding: '16px 8px'
        }
      }, 'No moves yet');
    }

    var rows = [];
    for (var i = 0; i < moveHistory.length; i += 2) {
      var moveNum = Math.floor(i / 2) + 1;
      var whiteMove = moveHistory[i] || '';
      var blackMove = (i + 1 < moveHistory.length) ? moveHistory[i + 1] : '';

      rows.push(React.createElement('div', {
        key: 'move-' + moveNum,
        style: {
          display: 'flex', alignItems: 'center',
          fontSize: '12px', padding: '2px 8px',
          background: moveNum % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'
        }
      },
        React.createElement('span', {
          style: {
            color: CHESS_COLORS.muted, width: '28px', flexShrink: 0,
            textAlign: 'right', marginRight: '8px', fontSize: '11px'
          }
        }, moveNum + '.'),
        React.createElement('span', {
          style: {
            color: CHESS_COLORS.text, width: '56px', flexShrink: 0,
            fontFamily: 'monospace', fontWeight: 500
          }
        }, whiteMove),
        React.createElement('span', {
          style: {
            color: CHESS_COLORS.text, width: '56px', flexShrink: 0,
            fontFamily: 'monospace', fontWeight: 500
          }
        }, blackMove)
      ));
    }

    return React.createElement('div', {
      style: {
        display: 'flex', flexDirection: 'column'
      }
    }, rows);
  }

  function renderChatPanel() {
    return React.createElement('div', {
      style: {
        display: 'flex', flexDirection: 'column',
        height: chatOpen ? '180px' : '36px',
        background: CHESS_COLORS.panelAlt,
        borderTop: '1px solid ' + CHESS_COLORS.border,
        transition: 'height 0.2s',
        flexShrink: 0
      }
    },
      // Chat toggle header
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 12px', cursor: 'pointer',
          flexShrink: 0
        },
        onClick: function() { setChatOpen(function(p) { return !p; }); }
      },
        React.createElement('span', {
          style: { color: CHESS_COLORS.muted, fontSize: '12px', fontWeight: 600 }
        }, 'Chat'),
        React.createElement('span', {
          style: { color: CHESS_COLORS.muted, fontSize: '14px', transform: chatOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }
        }, '\u25B2')
      ),

      // Chat messages
      chatOpen ? React.createElement('div', {
        style: {
          flex: 1, overflowY: 'auto', padding: '4px 12px',
          fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '2px'
        }
      },
        chatMessages.map(function(msg, mi) {
          return React.createElement('div', { key: mi },
            React.createElement('span', {
              style: { color: msg.color || CHESS_COLORS.gold, fontWeight: 600 }
            }, msg.name + ': '),
            React.createElement('span', {
              style: { color: CHESS_COLORS.text }
            }, ctx.censorText ? ctx.censorText(msg.text) : msg.text)
          );
        }),
        React.createElement('div', { ref: chatEndRef })
      ) : null,

      // Chat input
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
            flex: 1, padding: '6px 10px', background: CHESS_COLORS.bg,
            border: '1px solid ' + CHESS_COLORS.border, borderRadius: '4px',
            color: CHESS_COLORS.text, fontSize: '12px', fontFamily: 'inherit',
            outline: 'none'
          }
        }),
        React.createElement('button', {
          style: {
            padding: '6px 14px', background: CHESS_COLORS.gold, border: 'none',
            borderRadius: '4px', color: CHESS_COLORS.bg, fontSize: '12px',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: sendChat
        }, 'Send')
      ) : null
    );
  }

  function renderResultOverlay() {
    if (!result) return null;

    var title = '';
    var subtitle = '';
    var titleColor = CHESS_COLORS.gold;

    if (result.type === 'checkmate') {
      title = 'Checkmate!';
      subtitle = (result.winner || 'Unknown') + ' wins!';
      titleColor = CHESS_COLORS.gold;
    } else if (result.type === 'stalemate') {
      title = 'Stalemate';
      subtitle = 'Draw - no legal moves';
      titleColor = CHESS_COLORS.muted;
    } else if (result.type === 'resignation') {
      title = 'Resignation';
      subtitle = (result.resigned || 'A player') + ' resigned. ' + (result.winner || 'Opponent') + ' wins!';
      titleColor = CHESS_COLORS.text;
    } else if (result.type === 'draw') {
      title = 'Draw';
      subtitle = result.reason || 'By agreement';
      titleColor = CHESS_COLORS.muted;
    } else if (result.type === 'timeout') {
      title = 'Time Out';
      subtitle = (result.winner || 'Unknown') + ' wins on time!';
      titleColor = CHESS_COLORS.gold;
    } else {
      title = 'Game Over';
      subtitle = result.message || '';
    }

    return React.createElement('div', {
      style: {
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 50
      }
    },
      React.createElement('div', {
        style: {
          background: CHESS_COLORS.panel, borderRadius: '16px',
          padding: '32px 40px', textAlign: 'center',
          border: '2px solid ' + CHESS_COLORS.gold,
          boxShadow: '0 8px 48px rgba(0,0,0,0.6)',
          maxWidth: '360px', width: '90%'
        }
      },
        React.createElement('div', {
          style: { fontSize: '48px', marginBottom: '8px' }
        }, result.type === 'checkmate' ? '\u{1F3C6}' :
           result.type === 'stalemate' || result.type === 'draw' ? '\u{1F91D}' : '\u{1F3F3}\uFE0F'),
        React.createElement('h2', {
          style: {
            color: titleColor, fontSize: '24px', fontWeight: 700,
            margin: '0 0 8px 0'
          }
        }, title),
        React.createElement('p', {
          style: {
            color: CHESS_COLORS.text, fontSize: '15px', margin: '0 0 20px 0'
          }
        }, subtitle),
        React.createElement(ChessButton, {
          variant: 'accent',
          onClick: leaveLobby,
          padding: '10px 28px',
          fontSize: '14px'
        }, 'Back to Lobby')
      )
    );
  }

  function renderStatusText() {
    if (isSpectator) {
      return 'Spectating';
    }
    if (isFinished) {
      return 'Game Over';
    }
    if (isWaiting) {
      var readyCount = 0;
      for (var ri = 0; ri < players.length; ri++) {
        if (players[ri].ready) readyCount++;
      }
      return 'Waiting' + (players.length < 2 ? ' for opponent' : ' (' + readyCount + '/' + players.length + ' ready)');
    }
    if (isPlaying) {
      if (isMyTurn) return 'Your turn';
      return 'Opponent\'s turn';
    }
    return '';
  }

  // Helper to build spectator/queue controls for the top bar
  function renderSpectatorControls() {
    if (!isSpectator) return null;
    var elements = [];

    // Spectating label
    elements.push(React.createElement('span', {
      key: 'spec-label',
      style: {
        color: CHESS_COLORS.blue, fontSize: '12px', fontWeight: 600,
        padding: '2px 10px', borderRadius: '10px',
        background: 'rgba(88,101,242,0.15)',
        border: '1px solid ' + CHESS_COLORS.blue
      }
    }, 'Spectating'));

    // Queue controls
    if (inQueue) {
      elements.push(React.createElement('span', {
        key: 'queue-pos',
        style: {
          color: CHESS_COLORS.gold, fontSize: '12px', fontWeight: 600,
          padding: '2px 10px', borderRadius: '10px',
          background: 'rgba(240,178,50,0.15)'
        }
      }, 'In Queue (#' + queuePosition + ')'));
      elements.push(React.createElement(ChessButton, {
        key: 'queue-leave',
        variant: 'danger',
        onClick: leaveQueue,
        padding: '4px 10px',
        fontSize: '11px'
      }, 'Leave Queue'));
    } else {
      elements.push(React.createElement(ChessButton, {
        key: 'queue-join',
        variant: 'success',
        onClick: joinQueue,
        padding: '4px 12px',
        fontSize: '11px'
      }, 'Join Queue'));
    }

    return elements;
  }

  // ---- Desktop layout ----
  if (!isMobile) {
    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column',
        background: CHESS_COLORS.bg, overflow: 'hidden'
      }
    },
      // Top bar
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px', background: CHESS_COLORS.panel,
          borderBottom: '1px solid ' + CHESS_COLORS.border,
          flexShrink: 0
        }
      },
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '12px' }
        },
          React.createElement(ChessButton, {
            onClick: leaveLobby,
            fontSize: '12px',
            padding: '5px 14px'
          },
            React.createElement('span', { style: { marginRight: '4px' } }, '\u2190'),
            'Back'
          ),
          React.createElement('span', {
            style: { color: CHESS_COLORS.text, fontSize: '15px', fontWeight: 600 }
          }, '\u265A Chess'),
          React.createElement('span', {
            style: {
              color: isSpectator ? CHESS_COLORS.blue : (isMyTurn ? CHESS_COLORS.gold : CHESS_COLORS.muted),
              fontSize: '13px', fontWeight: 500,
              padding: '2px 10px', borderRadius: '10px',
              background: isSpectator ? 'rgba(88,101,242,0.15)' : (isMyTurn ? 'rgba(240,178,50,0.15)' : 'transparent')
            }
          }, renderStatusText())
        ),
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px' }
        },
          // Spectator controls (queue join/leave)
          renderSpectatorControls(),
          // Draw offer incoming (only for players)
          !isSpectator && canAcceptDraw ? React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '4px 10px', background: 'rgba(88,101,242,0.15)',
              borderRadius: '6px', border: '1px solid ' + CHESS_COLORS.blue
            }
          },
            React.createElement('span', {
              style: { color: CHESS_COLORS.text, fontSize: '12px' }
            }, 'Draw offered'),
            React.createElement(ChessButton, {
              variant: 'success',
              onClick: sendAcceptDraw,
              padding: '3px 10px',
              fontSize: '11px'
            }, 'Accept'),
            React.createElement(ChessButton, {
              variant: 'danger',
              onClick: function() { setDrawOfferFrom(null); },
              padding: '3px 10px',
              fontSize: '11px'
            }, 'Decline')
          ) : null,
          // Action buttons (only for players, not spectators)
          !isSpectator && isPlaying && !isFinished ? React.createElement(ChessButton, {
            onClick: sendOfferDraw,
            disabled: drawOffered,
            padding: '5px 12px',
            fontSize: '12px'
          }, drawOffered ? 'Draw Offered' : 'Offer Draw') : null,
          !isSpectator && isPlaying && !isFinished ? React.createElement(ChessButton, {
            variant: 'danger',
            onClick: sendResign,
            padding: '5px 12px',
            fontSize: '12px'
          }, 'Resign') : null,
          // Waiting ready button (only for players)
          !isSpectator && isWaiting && me && !me.ready ? React.createElement(ChessButton, {
            variant: 'success',
            onClick: sendReady,
            padding: '5px 14px',
            fontSize: '12px'
          }, 'Ready') : null,
          !isSpectator && isWaiting && me && me.ready ? React.createElement('span', {
            style: { color: CHESS_COLORS.green, fontSize: '12px', fontWeight: 600 }
          }, 'Ready!') : null
        )
      ),

      // Main game area
      React.createElement('div', {
        style: {
          flex: 1, display: 'flex', overflow: 'hidden', position: 'relative'
        }
      },
        // Left side: board + player info
        React.createElement('div', {
          ref: boardContainerRef,
          style: {
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '12px', position: 'relative', overflow: 'hidden'
          }
        },
          // Top player info (opponent for players, black for spectators)
          renderPlayerInfo(
            isSpectator ? (blackPlayer || null) : (isFlipped ? (me || null) : (opponent || null)),
            isSpectator ? (capturedPieces['b'] || []) : (isFlipped ? (capturedPieces[myColor] || []) : (capturedPieces[opponent ? opponent.color : 'b'] || [])),
            true
          ),
          // Board
          React.createElement('div', {
            style: { position: 'relative', margin: '8px 0' }
          },
            renderBoard(),
            renderPromotionDialog(),
            renderResultOverlay()
          ),
          // Bottom player info (me for players, white for spectators)
          renderPlayerInfo(
            isSpectator ? (whitePlayer || null) : (isFlipped ? (opponent || null) : (me || null)),
            isSpectator ? (capturedPieces['w'] || []) : (isFlipped ? (capturedPieces[opponent ? opponent.color : 'b'] || []) : (capturedPieces[myColor] || [])),
            false
          )
        ),

        // Right side: move history + chat
        React.createElement('div', {
          style: {
            width: '220px', display: 'flex', flexDirection: 'column',
            background: CHESS_COLORS.panel,
            borderLeft: '1px solid ' + CHESS_COLORS.border,
            flexShrink: 0
          }
        },
          // Move history header
          React.createElement('div', {
            style: {
              padding: '10px 12px',
              borderBottom: '1px solid ' + CHESS_COLORS.border,
              flexShrink: 0
            }
          },
            React.createElement('span', {
              style: {
                color: CHESS_COLORS.muted, fontSize: '11px', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.5px'
              }
            }, 'Moves')
          ),

          // Column headers
          React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'center',
              fontSize: '10px', padding: '4px 8px',
              color: CHESS_COLORS.muted, fontWeight: 600,
              borderBottom: '1px solid rgba(78,80,88,0.4)',
              flexShrink: 0
            }
          },
            React.createElement('span', { style: { width: '28px', textAlign: 'right', marginRight: '8px' } }, '#'),
            React.createElement('span', { style: { width: '56px' } }, 'White'),
            React.createElement('span', { style: { width: '56px' } }, 'Black')
          ),

          // Scrollable move list
          React.createElement('div', {
            style: { flex: 1, overflowY: 'auto' }
          }, renderMoveHistory()),

          // Chat
          renderChatPanel()
        )
      ),

      // Toasts
      renderToasts()
    );
  }

  // ---- Mobile layout ----
  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      background: CHESS_COLORS.bg, overflow: 'hidden'
    }
  },
    // Top bar (compact)
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '6px 10px', background: CHESS_COLORS.panel,
        borderBottom: '1px solid ' + CHESS_COLORS.border,
        flexShrink: 0
      }
    },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px' }
      },
        React.createElement(ChessButton, {
          onClick: leaveLobby,
          fontSize: '11px',
          padding: '4px 10px'
        }, '\u2190'),
        React.createElement('span', {
          style: {
            color: isSpectator ? CHESS_COLORS.blue : (isMyTurn ? CHESS_COLORS.gold : CHESS_COLORS.muted),
            fontSize: '12px', fontWeight: 600
          }
        }, renderStatusText())
      ),
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '6px' }
      },
        // Spectator queue controls (mobile)
        isSpectator && !inQueue ? React.createElement(ChessButton, {
          variant: 'success',
          onClick: joinQueue,
          padding: '3px 8px',
          fontSize: '10px'
        }, 'Queue') : null,
        isSpectator && inQueue ? React.createElement('span', {
          style: {
            color: CHESS_COLORS.gold, fontSize: '10px', fontWeight: 600
          }
        }, '#' + queuePosition) : null,
        isSpectator && inQueue ? React.createElement(ChessButton, {
          variant: 'danger',
          onClick: leaveQueue,
          padding: '3px 8px',
          fontSize: '10px'
        }, 'Leave') : null,
        // Draw offer incoming (mobile, only for players)
        !isSpectator && canAcceptDraw ? React.createElement(ChessButton, {
          variant: 'success',
          onClick: sendAcceptDraw,
          padding: '3px 8px',
          fontSize: '10px'
        }, 'Accept Draw') : null,
        // Waiting ready button (only for players)
        !isSpectator && isWaiting && me && !me.ready ? React.createElement(ChessButton, {
          variant: 'success',
          onClick: sendReady,
          padding: '4px 10px',
          fontSize: '11px'
        }, 'Ready') : null,
        !isSpectator && isWaiting && me && me.ready ? React.createElement('span', {
          style: { color: CHESS_COLORS.green, fontSize: '11px', fontWeight: 600 }
        }, 'Ready!') : null,
        !isSpectator && isPlaying && !isFinished ? React.createElement(ChessButton, {
          onClick: sendOfferDraw,
          disabled: drawOffered,
          padding: '4px 8px',
          fontSize: '10px'
        }, '\u00BD') : null,
        !isSpectator && isPlaying && !isFinished ? React.createElement(ChessButton, {
          variant: 'danger',
          onClick: sendResign,
          padding: '4px 8px',
          fontSize: '10px'
        }, '\u{1F3F3}\uFE0F') : null
      )
    ),

    // Scrollable content
    React.createElement('div', {
      style: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }
    },
      // Top player info
      React.createElement('div', {
        style: { width: '100%', maxWidth: (boardSize + 4) + 'px', padding: '4px 4px 0' }
      },
        renderPlayerInfo(
          isSpectator ? (blackPlayer || null) : (isFlipped ? (me || null) : (opponent || null)),
          isSpectator ? (capturedPieces['b'] || []) : (isFlipped ? (capturedPieces[myColor] || []) : (capturedPieces[opponent ? opponent.color : 'b'] || [])),
          true
        )
      ),

      // Board
      React.createElement('div', {
        ref: boardContainerRef,
        style: {
          position: 'relative', padding: '4px'
        }
      },
        renderBoard(),
        renderPromotionDialog(),
        renderResultOverlay()
      ),

      // Bottom player info
      React.createElement('div', {
        style: { width: '100%', maxWidth: (boardSize + 4) + 'px', padding: '0 4px' }
      },
        renderPlayerInfo(
          isSpectator ? (whitePlayer || null) : (isFlipped ? (opponent || null) : (me || null)),
          isSpectator ? (capturedPieces['w'] || []) : (isFlipped ? (capturedPieces[opponent ? opponent.color : 'b'] || []) : (capturedPieces[myColor] || [])),
          false
        )
      ),

      // Move history (mobile: below board, compact)
      React.createElement('div', {
        style: {
          width: '100%', maxWidth: (boardSize + 4) + 'px',
          margin: '8px 0', padding: '0 4px'
        }
      },
        React.createElement('div', {
          style: {
            background: CHESS_COLORS.panel, borderRadius: '8px',
            border: '1px solid ' + CHESS_COLORS.border,
            overflow: 'hidden'
          }
        },
          React.createElement('div', {
            style: {
              padding: '8px 12px',
              borderBottom: '1px solid ' + CHESS_COLORS.border
            }
          },
            React.createElement('span', {
              style: {
                color: CHESS_COLORS.muted, fontSize: '11px', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.5px'
              }
            }, 'Moves')
          ),
          React.createElement('div', {
            style: { maxHeight: '120px', overflowY: 'auto' }
          }, renderMoveHistory())
        )
      )
    ),

    // Chat (mobile)
    renderChatPanel(),

    // Toasts
    renderToasts()
  );
}
