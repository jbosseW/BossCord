// Sound toggle button for game hub
function SoundToggle() {
  var [muted, setMuted] = useState(function() {
    return window.BossSounds ? window.BossSounds.isMuted() : false;
  });
  return React.createElement('button', {
    style: {
      padding: '4px 10px', background: muted ? '#4e5058' : '#2d5a2d', border: '1px solid ' + (muted ? '#6d6f78' : '#57f287'),
      borderRadius: '6px', color: muted ? '#949ba4' : '#57f287', fontSize: '11px',
      fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      transition: 'all 0.15s', marginLeft: 'auto', whiteSpace: 'nowrap'
    },
    onClick: function() {
      if (window.BossSounds) {
        var nowMuted = window.BossSounds.toggleMute();
        setMuted(nowMuted);
      }
    },
    title: muted ? 'Unmute sounds' : 'Mute sounds'
  }, muted ? 'Sound OFF' : 'Sound ON');
}

// Loading spinner shown while game scripts are being fetched
function GameLoadingSpinner(props) {
  var gameName = props.gameName || 'game';
  var error = props.error;
  var onRetry = props.onRetry;
  var onBack = props.onBack;

  if (error) {
    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: '#1c1c1e', gap: '16px', padding: '32px'
      }
    },
      React.createElement('div', {
        style: { fontSize: '48px', marginBottom: '8px' }
      }, '\u26A0'),
      React.createElement('div', {
        style: { color: '#ed4245', fontSize: '16px', fontWeight: 600, textAlign: 'center' }
      }, 'Failed to load ' + gameName),
      React.createElement('div', {
        style: { color: '#949ba4', fontSize: '13px', textAlign: 'center', maxWidth: '400px' }
      }, error),
      React.createElement('div', {
        style: { display: 'flex', gap: '12px', marginTop: '8px' }
      },
        React.createElement('button', {
          style: {
            padding: '8px 24px', background: '#f0b232', border: 'none',
            borderRadius: '6px', color: '#1c1c1e', fontSize: '14px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: onRetry
        }, 'Retry'),
        React.createElement('button', {
          style: {
            padding: '8px 24px', background: '#4e5058', border: 'none',
            borderRadius: '6px', color: '#dcddde', fontSize: '14px',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: onBack
        }, 'Back to Games')
      )
    );
  }

  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: '#1c1c1e', gap: '20px'
    }
  },
    // CSS spinner
    React.createElement('div', {
      style: {
        width: '48px', height: '48px', border: '4px solid #4e5058',
        borderTopColor: '#f0b232', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite'
      }
    }),
    React.createElement('div', {
      style: { color: '#949ba4', fontSize: '14px', fontWeight: 500 }
    }, 'Loading ' + gameName + '...')
  );
}

// Wrapper component that handles lazy-loading a game's scripts
// then mounts the actual game component once loaded.
function LazyGameWrapper(props) {
  var gameId = props.gameId;
  var onBack = props.onBack;
  var gameName = props.gameName || gameId;

  var [loadState, setLoadState] = useState(function() {
    // If already loaded (cached from a previous visit), skip loading
    if (BossScriptLoader.isGameLoaded(gameId)) {
      return 'ready';
    }
    return 'loading';
  });
  var [error, setError] = useState(null);

  useEffect(function() {
    if (loadState !== 'loading') return;

    var cancelled = false;
    BossScriptLoader.loadGame(gameId).then(function() {
      if (!cancelled) {
        setLoadState('ready');
        setError(null);
      }
    }).catch(function(err) {
      if (!cancelled) {
        setLoadState('error');
        setError(err.message || 'Unknown error');
      }
    });

    return function() { cancelled = true; };
  }, [gameId, loadState]);

  function handleRetry() {
    setError(null);
    setLoadState('loading');
  }

  if (loadState === 'loading') {
    return React.createElement(GameLoadingSpinner, { gameName: gameName });
  }

  if (loadState === 'error') {
    return React.createElement(GameLoadingSpinner, {
      gameName: gameName,
      error: error,
      onRetry: handleRetry,
      onBack: onBack
    });
  }

  // loadState === 'ready'
  var Component = BossScriptLoader.getComponent(gameId);
  if (!Component) {
    return React.createElement(GameLoadingSpinner, {
      gameName: gameName,
      error: 'Game component not found after loading scripts.',
      onRetry: handleRetry,
      onBack: onBack
    });
  }

  return React.createElement(Component);
}

// ─── Daily Challenges Section ───
// Displays 3 daily challenges at the top of the Games Hub.
// Each challenge shows title, description, progress bar, reward, and claim button.
// Includes a countdown timer to the next UTC midnight reset.
function DailyChallengesSection() {
  var ctx = useSocket();
  var [challenges, setChallenges] = useState([]);
  var [resetIn, setResetIn] = useState(0);
  var [claiming, setClaiming] = useState(null);
  var [loaded, setLoaded] = useState(false);

  // Fetch challenges when the games socket connects
  useEffect(function() {
    var gs = ctx.gamesSocket;
    if (!gs) {
      // Try connecting
      if (ctx.connectGames) {
        gs = ctx.connectGames();
      }
    }
    if (!gs) return;

    function onChallenges(data) {
      if (!data) return;
      setChallenges(data.challenges || []);
      setResetIn(data.resetIn || 0);
      setLoaded(true);
    }
    function onClaimed(data) {
      setClaiming(null);
    }
    gs.on('daily_challenges', onChallenges);
    gs.on('challenge_claimed', onClaimed);
    gs.emit('get_daily_challenges');

    return function() {
      gs.off('daily_challenges', onChallenges);
      gs.off('challenge_claimed', onClaimed);
    };
  }, [ctx.gamesSocket]);

  // Also listen on default socket for challenges (non-games namespace)
  useEffect(function() {
    var s = ctx.socket;
    if (!s) return;

    function onChallenges(data) {
      if (!data) return;
      setChallenges(data.challenges || []);
      setResetIn(data.resetIn || 0);
      setLoaded(true);
    }
    function onClaimed(data) {
      setClaiming(null);
    }
    s.on('daily_challenges', onChallenges);
    s.on('challenge_claimed', onClaimed);
    // If no games socket, fetch from default namespace
    if (!ctx.gamesSocket) {
      s.emit('get_daily_challenges');
    }

    return function() {
      s.off('daily_challenges', onChallenges);
      s.off('challenge_claimed', onClaimed);
    };
  }, [ctx.socket, ctx.gamesSocket]);

  // Countdown timer that updates every second
  var [countdown, setCountdown] = useState('');
  useEffect(function() {
    function updateCountdown() {
      var now = new Date();
      var midnight = new Date(Date.UTC(
        now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
      ));
      var diff = midnight.getTime() - now.getTime();
      if (diff <= 0) {
        setCountdown('Refreshing...');
        // Refetch challenges
        var gs = ctx.gamesSocket;
        if (gs) gs.emit('get_daily_challenges');
        else if (ctx.socket) ctx.socket.emit('get_daily_challenges');
        return;
      }
      var hours = Math.floor(diff / 3600000);
      var mins = Math.floor((diff % 3600000) / 60000);
      var secs = Math.floor((diff % 60000) / 1000);
      setCountdown(
        (hours < 10 ? '0' : '') + hours + ':' +
        (mins < 10 ? '0' : '') + mins + ':' +
        (secs < 10 ? '0' : '') + secs
      );
    }
    updateCountdown();
    var timer = setInterval(updateCountdown, 1000);
    return function() { clearInterval(timer); };
  }, [ctx.gamesSocket, ctx.socket]);

  function claimReward(challengeId) {
    if (claiming) return;
    setClaiming(challengeId);
    var gs = ctx.gamesSocket;
    if (gs) {
      gs.emit('claim_challenge_reward', { challengeId: challengeId });
    } else if (ctx.socket) {
      ctx.socket.emit('claim_challenge_reward', { challengeId: challengeId });
    }
  }

  // Don't render if not logged in or no challenges loaded
  if (!ctx.account || !loaded || challenges.length === 0) return null;

  return React.createElement('div', {
    style: {
      width: '100%', maxWidth: '900px', marginBottom: '24px',
      background: '#252528', borderRadius: '12px',
      border: '1px solid #4e5058', padding: '20px',
      animation: 'slideInUp 0.3s ease-out'
    }
  },
    // Header row with title and countdown
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }
    },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px' }
      },
        React.createElement('span', { style: { fontSize: '20px' } }, '\uD83C\uDFAF'),
        React.createElement('span', {
          style: { color: '#f0b232', fontSize: '16px', fontWeight: 700 }
        }, 'Daily Challenges')
      ),
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '6px',
          background: '#1c1c1e', borderRadius: '8px', padding: '4px 12px'
        }
      },
        React.createElement('span', { style: { color: '#949ba4', fontSize: '11px' } }, 'Resets in'),
        React.createElement('span', {
          style: { color: '#dcddde', fontSize: '13px', fontWeight: 700, fontFamily: 'monospace' }
        }, countdown)
      )
    ),

    // Challenge cards
    React.createElement('div', {
      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }
    },
      challenges.map(function(ch) {
        var progressPct = ch.target > 0 ? Math.min(100, Math.floor((ch.progress / ch.target) * 100)) : 0;
        var isComplete = ch.completed;
        var isClaimed = ch.claimed;
        var barColor = isClaimed ? '#4e5058' : (isComplete ? '#57f287' : '#f0b232');
        var bgColor = isClaimed ? '#1a1a1c' : '#1c1c1e';

        return React.createElement('div', {
          key: ch.id,
          style: {
            background: bgColor, borderRadius: '10px', padding: '14px',
            border: '1px solid ' + (isComplete && !isClaimed ? '#57f287' : '#3a3a3d'),
            opacity: isClaimed ? 0.6 : 1,
            transition: 'border-color 0.3s'
          }
        },
          // Title row
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }
          },
            React.createElement('span', {
              style: { color: '#dcddde', fontSize: '13px', fontWeight: 700 }
            }, ch.title),
            React.createElement('span', {
              style: {
                color: '#f0b232', fontSize: '12px', fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: '6px'
              }
            },
              React.createElement('span', {
                style: { display: 'flex', alignItems: 'center', gap: '3px' }
              },
                React.createElement('img', {
                  src: '/icons/loot/LootCoin_06.PNG',
                  style: { width: '14px', height: '14px', objectFit: 'contain' }
                }),
                ch.reward
              ),
              React.createElement('span', {
                style: { display: 'flex', alignItems: 'center', gap: '2px', color: '#00d4ff', fontSize: '11px' },
                title: 'Guaranteed key drop'
              },
                React.createElement('img', {
                  src: '/icons/loot/Loot_54_key.PNG',
                  style: { width: '14px', height: '14px', objectFit: 'contain' }
                }),
                '+Key'
              )
            )
          ),
          // Description
          React.createElement('div', {
            style: { color: '#949ba4', fontSize: '11px', marginBottom: '10px' }
          }, ch.description),
          // Progress bar
          React.createElement('div', {
            style: {
              width: '100%', height: '8px', background: '#3a3a3d',
              borderRadius: '4px', overflow: 'hidden', marginBottom: '6px'
            }
          },
            React.createElement('div', {
              style: {
                width: progressPct + '%', height: '100%',
                background: barColor, borderRadius: '4px',
                transition: 'width 0.5s ease-out'
              }
            })
          ),
          // Progress text and claim button
          React.createElement('div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
          },
            React.createElement('span', {
              style: { color: '#949ba4', fontSize: '11px' }
            }, isClaimed ? 'Claimed!' : (ch.progress + ' / ' + ch.target)),
            (isComplete && !isClaimed) ? React.createElement('button', {
              style: {
                padding: '4px 14px', border: 'none', borderRadius: '6px',
                background: 'linear-gradient(135deg, #57f287, #2ecc71)',
                color: '#1c1c1e', fontSize: '11px', fontWeight: 700,
                cursor: claiming === ch.id ? 'wait' : 'pointer',
                fontFamily: 'inherit',
                boxShadow: '0 0 12px rgba(87,242,135,0.3)',
                opacity: claiming === ch.id ? 0.6 : 1
              },
              onClick: function() { claimReward(ch.id); },
              disabled: claiming === ch.id
            }, 'Claim') : null,
            isClaimed ? React.createElement('span', {
              style: { color: '#57f287', fontSize: '11px', fontWeight: 600 }
            }, 'Done') : null
          )
        );
      })
    )
  );
}

function GamesTab() {
  var [activeGame, setActiveGame] = useState(null);

  // Games that are NOT lazy-loaded (their scripts are always present)
  var eagerGames = { profile: true };

  // If a sub-game is active, render it with a back button
  if (activeGame) {
    var gameContent = null;

    if (eagerGames[activeGame]) {
      // These components are always available (loaded eagerly in index.html)
      if (activeGame === 'profile') gameContent = React.createElement(ProfileView);
    } else {
      // Find the game title for the loading spinner
      var gameTitle = activeGame;
      var gamesList = GamesTab._gamesList;
      if (gamesList) {
        for (var i = 0; i < gamesList.length; i++) {
          if (gamesList[i].id === activeGame) {
            gameTitle = gamesList[i].title;
            break;
          }
        }
      }
      // Lazy-load the game
      gameContent = React.createElement(LazyGameWrapper, {
        key: activeGame,
        gameId: activeGame,
        gameName: gameTitle,
        onBack: function() { setActiveGame(null); }
      });
    }

    return React.createElement('div', {
      style: { flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e', overflow: 'hidden' }
    },
      // Back button bar
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', padding: '8px 16px',
          background: '#252528', borderBottom: '1px solid #18181b', flexShrink: 0
        }
      },
        React.createElement('button', {
          style: {
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 14px', background: '#4e5058', border: 'none',
            borderRadius: '6px', color: '#dcddde', fontSize: '13px',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            transition: 'background 0.15s'
          },
          onClick: function() { setActiveGame(null); },
          onMouseEnter: function(e) { e.currentTarget.style.background = '#f0b232'; },
          onMouseLeave: function(e) { e.currentTarget.style.background = '#4e5058'; }
        },
          React.createElement('span', { style: { fontSize: '16px' } }, '\u2190'),
          'Back to Games'
        ),
        React.createElement(SoundToggle)
      ),
      // Sub-game content
      gameContent
    );
  }

  // Game hub menu
  var games = [
    {
      id: 'bossorbs',
      title: 'BossOrbs',
      description: 'Eat orbs and grow bigger. Eat other players!',
      iconBg: '#2d5a2d',
      iconBorder: '#57f287',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 35%, #7dff7d, #57f287, #2d8a2d)',
          boxShadow: '0 0 16px rgba(87,242,135,0.4)'
        }
      })
    },
    {
      id: 'cards',
      title: 'Card Games',
      description: "Texas Hold'em & Blackjack lobbies",
      iconBg: '#252528',
      iconBorder: '#f0b232',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '32px', position: 'relative'
        }
      },
        React.createElement('span', {
          style: {
            position: 'absolute', left: '6px', top: '4px',
            fontSize: '28px', transform: 'rotate(-10deg)',
            textShadow: '1px 1px 2px rgba(0,0,0,0.3)'
          }
        }, '\u2660'),
        React.createElement('span', {
          style: {
            position: 'absolute', right: '6px', bottom: '4px',
            fontSize: '28px', color: '#ed4245', transform: 'rotate(10deg)',
            textShadow: '1px 1px 2px rgba(0,0,0,0.3)'
          }
        }, '\u2665')
      )
    },
    {
      id: 'slots',
      title: 'Slot Machine',
      description: 'Try your luck! Spin to win chips',
      iconBg: '#3a2a10',
      iconBorder: '#f0b232',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '14px', fontWeight: 800, color: '#f0b232',
          fontFamily: 'monospace', letterSpacing: '2px',
          textShadow: '0 0 8px rgba(240,178,50,0.6)'
        }
      }, '777')
    },
    {
      id: 'coinflip',
      title: 'Coin Flip',
      description: 'Multiplayer coin flip! Pick heads or tails, winner gets 50 chips',
      iconBg: '#2a2a10',
      iconBorder: '#f0b232',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #f0b232, #d4941a)',
          fontSize: '28px', fontWeight: 800, color: '#1c1c1e',
          boxShadow: '0 0 12px rgba(240,178,50,0.4)',
          border: '2px solid #f0b232'
        }
      }, 'H/T')
    },
    {
      id: 'plinko',
      title: 'Plinko',
      description: 'Drop a ball through pegs! Land on multipliers up to 10x',
      iconBg: '#1a2a3a',
      iconBorder: '#57f287',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', borderRadius: '8px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(180deg, #18181b, #252528)',
          fontSize: '12px', fontWeight: 800, color: '#57f287',
          fontFamily: 'monospace', lineHeight: 1.2, textAlign: 'center',
          border: '2px solid #57f287',
          boxShadow: '0 0 12px rgba(87,242,135,0.3)'
        }
      }, React.createElement('span', null, '\u25CF', React.createElement('br'), '\u25CF \u25CF', React.createElement('br'), '\u25CF \u25CF \u25CF'))
    },
    {
      id: 'scratch',
      title: 'Lucky Scrolls',
      description: 'Buy and unroll to reveal prizes! Match 3 symbols to win',
      iconBg: '#1a3a1a',
      iconBorder: '#57f287',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '28px'
        }
      }, '\u{1F3AB}')
    },
    {
      id: 'lootbox',
      title: 'Loot Boxes',
      description: 'Open boxes to collect badges, titles, and rare collectibles!',
      iconBg: '#2a1a3a',
      iconBorder: '#9b59b6',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '28px'
        }
      }, '\u{1F4E6}')
    },
    {
      id: 'tcg_packs',
      title: 'Card Packs',
      description: 'Open packs to collect monster cards! 8 pack types.',
      iconBg: '#2a1a1a',
      iconBorder: '#ff4444',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '28px'
        }
      }, '\u{1F5C3}\uFE0F')
    },
    {
      id: 'tcg_collection',
      title: 'Card Collection',
      description: 'Browse your monster cards. 10 rarity tiers!',
      iconBg: '#1a2a2a',
      iconBorder: '#00d4ff',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '28px'
        }
      }, '\u{1F4DA}')
    },
    {
      id: 'tcg_battle',
      title: 'Card Battle',
      description: '1v1 turn-based card battles with type advantages!',
      iconBg: '#2a1a2a',
      iconBorder: '#9b59b6',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '28px'
        }
      }, '\u2694\uFE0F')
    },
    {
      id: 'profile',
      title: 'Profile & Loot',
      description: 'View your collection, equip badges & titles, sell items',
      iconBg: '#1a2a3a',
      iconBorder: '#5865f2',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '28px'
        }
      }, '\u{1F464}')
    },
    {
      id: 'stocks',
      title: 'Stock Market',
      description: 'Buy and sell fantasy stocks! Watch prices and ride the market.',
      iconBg: '#1a2a1a',
      iconBorder: '#57f287',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '28px'
        }
      }, '\uD83D\uDCC8')
    },
    {
      id: 'auction',
      title: 'Auction House',
      description: 'Buy and sell items and cards from other players!',
      iconBg: '#2a2a1a',
      iconBorder: '#f0b232',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '28px'
        }
      }, '\uD83C\uDFEA')
    },
    {
      id: 'clicker',
      title: 'Idle Clicker',
      description: 'Click to earn chips! Buy upgrades for auto-income, even while offline!',
      iconBg: '#3a2a10',
      iconBorder: '#f0b232',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #f0b232, #d4941a)',
          fontSize: '28px', boxShadow: '0 0 12px rgba(240,178,50,0.4)',
          border: '2px solid #f0b232'
        }
      }, '\uD83D\uDCB0')
    },
    {
      id: 'bossbrawl',
      title: 'BossBrawl',
      description: '2D arena combat! Fight in destructible caves with weapons & spells',
      iconBg: '#2a1a10',
      iconBorder: '#ed4245',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '28px'
        }
      }, '\u2694\uFE0F')
    },
    {
      id: 'horseracing',
      title: 'Horse Racing',
      description: 'Bet on horses with unique stats, moods & weather! Autonomous races every 60s',
      iconBg: '#2a3a1a',
      iconBorder: '#57f287',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '28px'
        }
      }, '\uD83C\uDFC7')
    },
    {
      id: 'chess',
      title: 'Chess',
      description: 'Classic chess! Play against friends in 1v1 lobbies',
      iconBg: '#1a1a2a',
      iconBorder: '#5865f2',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '36px'
        }
      }, '\u265A')
    },
    {
      id: 'pool',
      title: '8-Ball Pool',
      description: '2-player pool! Pocket your balls and sink the 8 to win',
      iconBg: '#0d4a2d',
      iconBorder: '#57f287',
      icon: React.createElement('div', {
        style: {
          width: '56px', height: '56px', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: '32px'
        }
      }, '\uD83C\uDFB1')
    }
  ];

  // Store games list for title lookup in LazyGameWrapper
  GamesTab._gamesList = games;

  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', background: '#1c1c1e',
      padding: '32px 24px', overflow: 'auto'
    }
  },
    // Header
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'flex-start', marginBottom: '32px', width: '100%', maxWidth: '900px' }
    },
      React.createElement('div', {
        style: { flex: 1, textAlign: 'center' }
      },
        React.createElement('h2', {
          style: { color: '#dcddde', fontSize: '28px', fontWeight: 700, marginBottom: '8px' }
        },
          React.createElement('span', { style: { color: '#f0b232' } }, 'Game'),
          ' Hub'
        ),
        React.createElement('p', {
          style: { color: '#949ba4', fontSize: '15px' }
        }, 'Choose a game to play')
      ),
      React.createElement('div', { style: { flexShrink: 0, marginLeft: '12px', paddingTop: '4px' } },
        React.createElement(SoundToggle)
      )
    ),

    // Daily Challenges
    React.createElement(DailyChallengesSection),

    // Game cards grid
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '16px', width: '100%', maxWidth: '900px'
      }
    },
      games.map(function(game, idx) {
        return React.createElement('div', {
          key: game.id,
          style: {
            background: '#252528', borderRadius: '12px',
            border: '1px solid #4e5058', padding: '24px',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '12px', transition: 'border-color 0.2s, transform 0.2s, box-shadow 0.2s',
            cursor: 'pointer',
            animation: 'slideInUp 0.4s ease-out both',
            animationDelay: (idx * 50) + 'ms'
          },
          onClick: function() { setActiveGame(game.id); },
          onMouseEnter: function(e) {
            e.currentTarget.style.borderColor = game.iconBorder;
            e.currentTarget.style.transform = 'translateY(-3px)';
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3), 0 0 12px ' + game.iconBorder + '33';
            // Prefetch game scripts on hover
            if (BossScriptLoader && !BossScriptLoader.isGameLoaded(game.id)) {
              BossScriptLoader.preload(game.id);
            }
          },
          onMouseLeave: function(e) {
            e.currentTarget.style.borderColor = '#4e5058';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = 'none';
          }
        },
          // Icon container
          React.createElement('div', {
            style: {
              width: '80px', height: '80px', borderRadius: '50%',
              background: game.iconBg, border: '3px solid ' + game.iconBorder,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
            }
          }, game.icon),
          // Title
          React.createElement('h3', {
            style: { color: '#dcddde', fontSize: '18px', fontWeight: 700 }
          }, game.title),
          // Description
          React.createElement('p', {
            style: {
              color: '#949ba4', fontSize: '14px', textAlign: 'center',
              lineHeight: '1.4', margin: 0
            }
          }, game.description),
          // Play button
          React.createElement('button', {
            style: {
              padding: '10px 32px', background: 'linear-gradient(135deg, #f0b232, #f5c563)', border: 'none',
              borderRadius: '8px', color: '#1c1c1e', fontSize: '14px',
              fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              marginTop: '4px', transition: 'background 0.15s, box-shadow 0.15s'
            },
            onClick: function(e) {
              e.stopPropagation();
              if (window.BossSounds) window.BossSounds.play('click');
              setActiveGame(game.id);
            },
            onMouseEnter: function(e) { e.currentTarget.style.background = 'linear-gradient(135deg, #d49a28, #f0b232)'; e.currentTarget.style.boxShadow = '0 0 16px rgba(240,178,50,0.3)'; },
            onMouseLeave: function(e) { e.currentTarget.style.background = 'linear-gradient(135deg, #f0b232, #f5c563)'; e.currentTarget.style.boxShadow = 'none'; }
          }, 'Play')
        );
      })
    ),

    // External engine games (Phaser, Babylon.js, LOVE2D) — hidden until polished
    // React.createElement(GameLauncher, null)
  );
}
