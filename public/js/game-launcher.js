// game-launcher.js
// GameLauncher component: grid of external-engine games (Phaser, Babylon.js, LOVE2D)
// that open in iframe modals and communicate via postMessage bridge.

var EXTERNAL_GAMES = [
  {
    id: 'phaser-demo',
    title: 'Coin Rush',
    engine: 'Phaser',
    description: 'Collect coins with arrow keys. 60-second rounds! Each coin earns chips.',
    url: '/games/phaser-demo/index.html',
    color: '#4CAF50',
    iconBg: '#1a3a1a',
    iconBorder: '#4CAF50',
    icon: 'P'
  },
  {
    id: 'babylon-demo',
    title: 'Obstacle Runner 3D',
    engine: 'Babylon.js',
    description: '3D obstacle dodging! Roll forward and dodge with A/D. Score = distance.',
    url: '/games/babylon-demo/index.html',
    color: '#3498DB',
    iconBg: '#1a2a3a',
    iconBorder: '#3498DB',
    icon: '3D'
  },
  {
    id: 'love-demo',
    title: 'Paddle Ball',
    engine: 'LOVE2D',
    description: 'Classic brick breaker built with LOVE2D. Coming soon!',
    url: '/games/love-demo/index.html',
    color: '#E74C3C',
    iconBg: '#3a1a1a',
    iconBorder: '#E74C3C',
    icon: 'L',
    comingSoon: true
  }
];

function GameLauncher(props) {
  var ctx = useSocket();
  var activeGameState = useState(null);
  var activeGame = activeGameState[0];
  var setActiveGame = activeGameState[1];
  var iframeRef = useRef(null);
  var isMobile = useIsMobile();

  // Handle postMessage from game iframe
  useEffect(function() {
    if (!activeGame) return;

    function handleMessage(e) {
      if (e.origin !== window.location.origin) return;
      var msg = e.data;
      if (!msg || typeof msg !== 'object' || !msg.type) return;

      // Bridge ready or game loaded: send init data
      if (msg.type === 'bosscord_bridge_ready' || msg.type === 'bosscord_game_loaded') {
        if (iframeRef.current && iframeRef.current.contentWindow) {
          iframeRef.current.contentWindow.postMessage({
            type: 'bosscord_init',
            accountKey: null, // never expose raw key to iframes
            chips: ctx.account ? ctx.account.chips : 0,
            username: ctx.user ? ctx.user.name : 'Anon'
          }, window.location.origin);
        }
      }

      // Game requests (chips, score, state)
      if (msg.type === 'bosscord_game_request') {
        if (msg.action === 'update_chips' && ctx.socket) {
          ctx.socket.emit('game_bridge_bet', {
            amount: Math.abs(msg.amount || 0),
            gameId: activeGame
          });
        }
        if (msg.action === 'report_score' && ctx.socket) {
          ctx.socket.emit('game_bridge_score', {
            score: msg.score,
            gameId: activeGame,
            metadata: msg.metadata
          });
        }
        if (msg.action === 'save_state' && ctx.socket) {
          ctx.socket.emit('game_bridge_save', {
            gameId: msg.gameId,
            state: msg.state
          });
        }
        if (msg.action === 'load_state' && ctx.socket) {
          ctx.socket.emit('game_bridge_load', { gameId: msg.gameId });
          // Listen for response once
          var responseHandler = function(data) {
            if (iframeRef.current && iframeRef.current.contentWindow) {
              iframeRef.current.contentWindow.postMessage({
                type: 'bosscord_response',
                requestId: msg.requestId,
                data: data ? data.state : null
              }, window.location.origin);
            }
            ctx.socket.off('game_bridge_loaded', responseHandler);
          };
          ctx.socket.on('game_bridge_loaded', responseHandler);
        }
      }

      // Game requests close
      if (msg.type === 'bosscord_game_close') {
        setActiveGame(null);
      }
    }

    window.addEventListener('message', handleMessage);
    return function() { window.removeEventListener('message', handleMessage); };
  }, [activeGame, ctx.socket, ctx.account, ctx.user]);

  // Forward chip updates from server to iframe
  useEffect(function() {
    if (!activeGame || !ctx.socket) return;

    function onChipsForwarded(data) {
      if (iframeRef.current && iframeRef.current.contentWindow && data && typeof data.chips === 'number') {
        iframeRef.current.contentWindow.postMessage({
          type: 'bosscord_chips_updated',
          chips: data.chips
        }, window.location.origin);
      }
    }

    ctx.socket.on('game_bridge_bet_ack', onChipsForwarded);
    return function() { ctx.socket.off('game_bridge_bet_ack', onChipsForwarded); };
  }, [activeGame, ctx.socket]);

  // If a game is active, show iframe modal overlay
  if (activeGame) {
    var gameInfo = null;
    for (var gi = 0; gi < EXTERNAL_GAMES.length; gi++) {
      if (EXTERNAL_GAMES[gi].id === activeGame) { gameInfo = EXTERNAL_GAMES[gi]; break; }
    }
    if (!gameInfo) { setActiveGame(null); return null; }

    return React.createElement('div', {
      style: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.85)', zIndex: 9000,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
      }
    },
      // Top bar with game title and close button
      React.createElement('div', {
        style: {
          position: 'absolute', top: 0, left: 0, right: 0, height: '48px',
          background: '#18181b', display: 'flex', alignItems: 'center',
          padding: '0 16px', borderBottom: '1px solid #4e5058', zIndex: 9001
        }
      },
        // Engine badge
        React.createElement('span', {
          style: {
            padding: '3px 10px', borderRadius: '12px', fontSize: '11px',
            fontWeight: 700, color: '#fff', marginRight: '10px',
            background: gameInfo.color
          }
        }, gameInfo.engine),
        // Title
        React.createElement('span', {
          style: { color: '#dcddde', fontSize: '15px', fontWeight: 600, flex: 1 }
        }, gameInfo.title),
        // Close button
        React.createElement('button', {
          style: {
            width: '32px', height: '32px', borderRadius: '6px',
            background: '#4e5058', border: 'none', color: '#dcddde',
            fontSize: '18px', fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit', transition: 'background 0.15s'
          },
          onClick: function() { setActiveGame(null); },
          onMouseEnter: function(e) { e.currentTarget.style.background = '#ed4245'; },
          onMouseLeave: function(e) { e.currentTarget.style.background = '#4e5058'; }
        }, '\u2715')
      ),
      // Iframe
      React.createElement('iframe', {
        ref: iframeRef,
        src: gameInfo.url,
        style: {
          width: isMobile ? '100%' : 'min(90vw, 900px)',
          height: isMobile ? 'calc(100% - 48px)' : 'min(80vh, 680px)',
          marginTop: '48px',
          border: 'none', borderRadius: isMobile ? '0' : '0 0 12px 12px',
          background: '#0a0a1a'
        },
        allow: 'autoplay; fullscreen',
        sandbox: 'allow-scripts',
        title: gameInfo.title
      })
    );
  }

  // Render game cards grid
  return React.createElement('div', {
    style: { width: '100%', marginTop: '32px' }
  },
    // Section header
    React.createElement('div', {
      style: { textAlign: 'center', marginBottom: '20px' }
    },
      React.createElement('h3', {
        style: { color: '#dcddde', fontSize: '20px', fontWeight: 700, marginBottom: '6px' }
      },
        React.createElement('span', { style: { color: '#f0b232' } }, 'More'),
        ' Games'
      ),
      React.createElement('p', {
        style: { color: '#949ba4', fontSize: '13px' }
      }, 'External engine games running in sandboxed iframes')
    ),
    // Game cards
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '14px', width: '100%', maxWidth: '900px', margin: '0 auto'
      }
    },
      EXTERNAL_GAMES.map(function(game) {
        return React.createElement('div', {
          key: game.id,
          style: {
            background: '#252528', borderRadius: '12px',
            border: '1px solid #4e5058', padding: '20px',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '10px', transition: 'border-color 0.2s, transform 0.2s',
            cursor: game.comingSoon ? 'default' : 'pointer',
            opacity: game.comingSoon ? 0.65 : 1
          },
          onClick: function() {
            if (!game.comingSoon) setActiveGame(game.id);
          },
          onMouseEnter: function(e) {
            if (!game.comingSoon) {
              e.currentTarget.style.borderColor = game.iconBorder;
              e.currentTarget.style.transform = 'translateY(-2px)';
            }
          },
          onMouseLeave: function(e) {
            e.currentTarget.style.borderColor = '#4e5058';
            e.currentTarget.style.transform = 'translateY(0)';
          }
        },
          // Icon circle
          React.createElement('div', {
            style: {
              width: '64px', height: '64px', borderRadius: '50%',
              background: game.iconBg, border: '3px solid ' + game.iconBorder,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              fontSize: '20px', fontWeight: 800, color: game.iconBorder,
              fontFamily: 'Inter, sans-serif'
            }
          }, game.icon),
          // Engine badge
          React.createElement('span', {
            style: {
              display: 'inline-block', padding: '2px 10px', borderRadius: '10px',
              fontSize: '11px', fontWeight: 700, color: '#fff',
              background: game.color
            }
          }, game.engine + (game.comingSoon ? ' - Coming Soon' : '')),
          // Title
          React.createElement('h4', {
            style: { color: '#dcddde', fontSize: '16px', fontWeight: 700, margin: 0 }
          }, game.title),
          // Description
          React.createElement('p', {
            style: {
              color: '#949ba4', fontSize: '13px', textAlign: 'center',
              lineHeight: '1.4', margin: 0
            }
          }, game.description),
          // Play button
          React.createElement('button', {
            style: {
              padding: '8px 28px',
              background: game.comingSoon ? '#4e5058' : '#f0b232',
              border: 'none', borderRadius: '8px',
              color: game.comingSoon ? '#949ba4' : '#1c1c1e',
              fontSize: '13px', fontWeight: 700,
              cursor: game.comingSoon ? 'default' : 'pointer',
              fontFamily: 'inherit', marginTop: '4px',
              transition: 'background 0.15s'
            },
            onClick: function(e) {
              e.stopPropagation();
              if (!game.comingSoon) setActiveGame(game.id);
            },
            onMouseEnter: function(e) {
              if (!game.comingSoon) { e.currentTarget.style.background = '#d49a28'; }
            },
            onMouseLeave: function(e) {
              if (!game.comingSoon) { e.currentTarget.style.background = '#f0b232'; }
            }
          }, game.comingSoon ? 'Coming Soon' : 'Play')
        );
      })
    )
  );
}
