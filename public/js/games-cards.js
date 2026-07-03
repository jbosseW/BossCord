// NOTE: icon art under public/icons/ is NOT in the repo — owner-licensed
// packs stripped from version control (see public/icons/ASSETS_PLACEHOLDER.md).
// Code referencing icons/ must tolerate missing files on fresh clones.
function CardGamesView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectGames(); }, []);
  var gameSock = ctx.gamesSocket || ctx.socket;
  var isMobile = useIsMobile();
  var [lobby, setLobby] = useState(null);
  var [lobbies, setLobbies] = useState([]);
  var [chatInput, setChatInput] = useState('');
  var [raiseAmount, setRaiseAmount] = useState(0);
  var [showResultsOverlay, setShowResultsOverlay] = useState(false);
  var chatEndRef = useRef(null);
  var prevPlayerCardCountsRef = useRef({});
  var prevCommunityCountRef = useRef(0);
  var prevDealerCountRef = useRef(0);
  var prevLobbyStateRef = useRef(null);
  var [cardDealTimestamp, setCardDealTimestamp] = useState(0);

  // Fetch lobbies and listen for updates
  useEffect(function() {
    if (!gameSock) return;
    var sock = gameSock;

    sock.emit('card_get_lobbies');

    function onLobbies(data) {
      setLobbies((data && data.lobbies) ? data.lobbies : []);
    }
    function onLobbiesUpdated(data) {
      setLobbies((data && data.lobbies) ? data.lobbies : []);
    }
    function onLobbyJoined(data) {
      setLobby(data);
      if (data && data.bigBlind) setRaiseAmount(data.bigBlind * 2);
    }
    function onLobbyUpdate(data) {
      // Detect new cards dealt or revealed for sound effects
      if (data && window.BossSounds) {
        var players = data.players || [];
        var prevCounts = prevPlayerCardCountsRef.current;
        var newCardDealt = false;
        var cardFlipped = false;

        players.forEach(function(pl) {
          var prevCount = prevCounts[pl.id] || 0;
          var hand = pl.hand || [];
          var curCount = hand.length;

          if (curCount > prevCount) {
            // New cards dealt
            newCardDealt = true;
            // Check if previously hidden cards are now revealed (flip)
            for (var ci = 0; ci < hand.length; ci++) {
              if (ci < prevCount) {
                // Existing card position - check if it was hidden and now revealed
                // We can't track exact previous card strings, so skip
              }
            }
          }
        });

        // Community cards (holdem)
        var commCards = data.communityCards || [];
        if (commCards.length > prevCommunityCountRef.current) {
          newCardDealt = true;
        }
        prevCommunityCountRef.current = commCards.length;

        // Dealer cards (blackjack)
        var dealerHand = data.dealerHand || [];
        if (dealerHand.length > prevDealerCountRef.current) {
          // Check if face-down card is being revealed
          if (prevDealerCountRef.current > 0) {
            var prevLastCard = null;  // We don't have previous card content
            // If dealer hand count increases and the game is in reveal phase, play flip
            cardFlipped = true;
          }
          newCardDealt = true;
        }
        prevDealerCountRef.current = dealerHand.length;

        // Update player card counts
        var newCounts = {};
        players.forEach(function(pl) {
          newCounts[pl.id] = (pl.hand || []).length;
        });
        prevPlayerCardCountsRef.current = newCounts;

        // Play sounds
        if (newCardDealt) {
          if (window.BossSounds) window.BossSounds.play('card_slide');
          setCardDealTimestamp(Date.now());
        }
        if (cardFlipped) {
          setTimeout(function() {
            if (window.BossSounds) window.BossSounds.play('card_flip');
          }, 150);
        }
      }

      // Detect state transition to 'waiting' from a playing state (round ended)
      if (data && prevLobbyStateRef.current && prevLobbyStateRef.current !== 'waiting' && data.state === 'waiting') {
        // Round ended, reset tracking
        prevPlayerCardCountsRef.current = {};
        prevCommunityCountRef.current = 0;
        prevDealerCountRef.current = 0;
      }
      prevLobbyStateRef.current = data ? data.state : null;

      setLobby(data);
    }
    function onLobbyLeft() {
      setLobby(null);
      sock.emit('card_get_lobbies');
    }
    function onChatMsg(data) {
      setLobby(function(prev) {
        if (!prev) return prev;
        var chat = (prev.chat || []).concat(data);
        return Object.assign({}, prev, { chat: chat });
      });
    }

    sock.on('card_lobbies', onLobbies);
    sock.on('card_lobbies_updated', onLobbiesUpdated);
    sock.on('card_lobby_joined', onLobbyJoined);
    sock.on('card_lobby_update', onLobbyUpdate);
    sock.on('card_lobby_left', onLobbyLeft);
    sock.on('card_chat_msg', onChatMsg);

    return function() {
      sock.off('card_lobbies', onLobbies);
      sock.off('card_lobbies_updated', onLobbiesUpdated);
      sock.off('card_lobby_joined', onLobbyJoined);
      sock.off('card_lobby_update', onLobbyUpdate);
      sock.off('card_lobby_left', onLobbyLeft);
      sock.off('card_chat_msg', onChatMsg);
      sock.emit('card_leave_lobby');
    };
  }, [gameSock]);

  // Auto-scroll chat
  useEffect(function() {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [lobby && lobby.chat && lobby.chat.length]);

  useEffect(function() {
    if (lobby && lobby.roundResults) {
      setShowResultsOverlay(false);
      var timer = setTimeout(function() { setShowResultsOverlay(true); }, 2500);

      // Play win/loss sounds based on round results
      var resultsTimer = setTimeout(function() {
        if (!window.BossSounds) return;
        var rr = lobby.roundResults;

        // Holdem: check winners
        if (rr.winners && rr.winners.length > 0) {
          var players = lobby.players || [];
          var me = players.find(function(p) { return p.isMe; });
          var iWon = me && rr.winners.some(function(w) { return w.id === me.id; });
          if (iWon) {
            var totalWin = 0;
            rr.winners.forEach(function(w) { if (w.id === me.id) totalWin += (w.amount || 0); });
            if (totalWin >= 500) {
              window.BossSounds.play('win_big');
            } else {
              window.BossSounds.play('win_small');
            }
            window.BossSounds.play('coin');
          } else {
            window.BossSounds.play('loss');
          }
        }

        // Blackjack: check results
        if (rr.results && rr.results.length > 0) {
          var players2 = lobby.players || [];
          var me2 = players2.find(function(p) { return p.isMe; });
          if (me2) {
            var myResult = rr.results.find(function(r) { return r.id === me2.id; });
            if (myResult) {
              if (myResult.result === 'win') {
                if ((myResult.payout || 0) >= 500) {
                  window.BossSounds.play('win_big');
                } else {
                  window.BossSounds.play('win_small');
                }
                window.BossSounds.play('coin');
              } else if (myResult.result === 'push') {
                window.BossSounds.play('coin');
              } else {
                window.BossSounds.play('loss');
              }
            }
          }
        }
      }, 2600);

      return function() { clearTimeout(timer); clearTimeout(resultsTimer); };
    } else {
      setShowResultsOverlay(false);
    }
  }, [lobby && lobby.roundResults]);

  function createTable(type) {
    if (!gameSock) return;
    gameSock.emit('card_create_lobby', { gameType: type });
  }

  function joinLobby(id) {
    if (!gameSock) return;
    gameSock.emit('card_join_lobby', { lobbyId: id });
  }

  function leaveLobby() {
    if (!gameSock) return;
    gameSock.emit('card_leave_lobby');
    setLobby(null);
    gameSock.emit('card_get_lobbies');
  }

  function sendReady() {
    if (!gameSock) return;
    if (window.BossSounds) window.BossSounds.play('click');
    gameSock.emit('card_ready');
  }

  function sendAction(action, amount) {
    if (!gameSock) return;
    var payload = { action: action };
    if (amount !== undefined) payload.amount = amount;
    // Play chip sounds for bet-related actions
    if (window.BossSounds) {
      if (action === 'call' || action === 'raise' || action === 'double') {
        window.BossSounds.play('chip_stack');
      } else if (action === 'hit') {
        window.BossSounds.play('card_slide');
      } else if (action === 'fold') {
        window.BossSounds.play('card_slide');
      }
    }
    gameSock.emit('card_action', payload);
  }

  function sendChat() {
    if (!gameSock || !chatInput.trim()) return;
    gameSock.emit('card_chat', { message: chatInput.trim() });
    setChatInput('');
  }

  // ── Suit symbol to file-name mapping ──
  var suitNameMap = {
    '\u2660': 'Spades',   // ♠
    '\u2665': 'Hearts',   // ♥
    '\u2666': 'Diamonds', // ♦
    '\u2663': 'Clubs'     // ♣
  };

  // Helper: parse card string like "♠A" into { suit, value, hidden }
  function parseCard(cardStr) {
    if (!cardStr || cardStr === '??' || cardStr === '?') return { suit: '', value: '', hidden: true };
    var suit = cardStr.charAt(0);
    var value = cardStr.substring(1);
    return { suit: suit, value: value, hidden: false };
  }

  // Build image path from parsed card data
  function cardImagePath(card) {
    if (card.hidden) return '/icons/cards/card_back.PNG';
    var suitName = suitNameMap[card.suit];
    if (!suitName) return '/icons/cards/card_back.PNG';
    return '/icons/cards/T_4ColorCards_Deck1_LowRes_' + suitName + card.value + '_Diffuse.PNG';
  }

  // ── Card sizes ──
  var cardW = isMobile ? 60 : 80;
  var cardH = isMobile ? 84 : 112;

  // Render a single playing card using real card images
  function renderCard(cardStr, idx, extraStyle) {
    var card = parseCard(cardStr);
    var imgSrc = cardImagePath(card);
    // Parse card index for staggered animation delay
    var cardIndex = 0;
    if (typeof idx === 'string') {
      var parts = idx.split('-');
      cardIndex = parseInt(parts[parts.length - 1]) || 0;
    } else if (typeof idx === 'number') {
      cardIndex = idx;
    }
    return React.createElement('img', {
      key: idx,
      src: imgSrc,
      alt: card.hidden ? 'Hidden card' : (card.suit + card.value),
      draggable: false,
      style: Object.assign({
        width: cardW + 'px',
        height: cardH + 'px',
        borderRadius: '6px',
        boxShadow: '0 3px 10px rgba(0,0,0,0.45)',
        flexShrink: 0,
        objectFit: 'cover',
        transition: 'transform 0.25s ease, box-shadow 0.25s ease',
        userSelect: 'none',
        animation: 'cardDeal 0.3s ease-out',
        animationDelay: (cardIndex * 100) + 'ms',
        animationFillMode: 'backwards'
      }, extraStyle || {})
    });
  }

  // Render an empty card slot (placeholder)
  function renderEmptySlot(idx) {
    return React.createElement('div', {
      key: 'empty-' + idx,
      style: {
        width: cardW + 'px',
        height: cardH + 'px',
        borderRadius: '6px',
        border: '2px dashed rgba(255,255,255,0.15)',
        background: 'rgba(0,0,0,0.18)',
        flexShrink: 0
      }
    });
  }

  // ── Player avatar helper ──
  // Shows a circular avatar image or colored-initial fallback
  function renderPlayerAvatar(pl, size) {
    var sz = size || (isMobile ? 32 : 40);
    if (pl.avatar) {
      return React.createElement('img', {
        src: pl.avatar,
        alt: pl.name,
        draggable: false,
        style: {
          width: sz + 'px',
          height: sz + 'px',
          borderRadius: '50%',
          objectFit: 'cover',
          border: '2px solid #4e5058',
          flexShrink: 0
        }
      });
    }
    // Fallback: colored circle with first initial
    var initial = (pl.name && pl.name.length > 0) ? pl.name.charAt(0).toUpperCase() : '?';
    var bgColor = pl.color || '#5865f2';
    return React.createElement('div', {
      style: {
        width: sz + 'px',
        height: sz + 'px',
        borderRadius: '50%',
        background: bgColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: Math.round(sz * 0.45) + 'px',
        fontWeight: 700,
        border: '2px solid #4e5058',
        flexShrink: 0,
        userSelect: 'none'
      }
    }, initial);
  }

  // ── If not in a lobby, show lobby browser ──
  if (!lobby) {
    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column',
        background: '#252528', padding: isMobile ? '12px' : '24px', overflow: 'auto'
      }
    },
      React.createElement('h2', {
        style: { color: '#dcddde', fontSize: '22px', fontWeight: 700, marginBottom: '16px' }
      }, 'Card Game Lobbies'),

      // Create buttons
      React.createElement('div', {
        style: { display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }
      },
        React.createElement('button', {
          style: {
            padding: '10px 20px', background: '#f0b232', border: 'none',
            borderRadius: '6px', color: '#1c1c1e', fontSize: '14px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { createTable('holdem'); }
        }, "Create Hold'em Table"),
        React.createElement('button', {
          style: {
            padding: '10px 20px', background: '#f0b232', border: 'none',
            borderRadius: '6px', color: '#1c1c1e', fontSize: '14px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { createTable('blackjack'); }
        }, 'Create Blackjack Table')
      ),

      // Lobby list
      lobbies.length === 0
        ? React.createElement('div', {
            style: { color: '#949ba4', fontSize: '15px', textAlign: 'center', padding: '40px 0' }
          }, 'No open tables. Create one to get started!')
        : React.createElement('div', {
            style: { display: 'flex', flexDirection: 'column', gap: '8px' }
          },
            lobbies.map(function(lb) {
              return React.createElement('div', {
                key: lb.id,
                style: {
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: '#18181b', borderRadius: '8px', padding: '14px 18px',
                  cursor: 'pointer', transition: 'background 0.15s'
                },
                onClick: function() { joinLobby(lb.id); },
                onMouseEnter: function(e) { e.currentTarget.style.background = '#1c1c1e'; },
                onMouseLeave: function(e) { e.currentTarget.style.background = '#18181b'; }
              },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
                  React.createElement('span', {
                    style: { fontSize: '24px' }
                  }, lb.gameType === 'holdem' ? '\u2660' : '\uD83C\uDCCF'),
                  React.createElement('div', null,
                    React.createElement('div', {
                      style: { color: '#dcddde', fontWeight: 600, fontSize: '15px' }
                    }, lb.gameType === 'holdem' ? "Texas Hold'em" : 'Blackjack'),
                    React.createElement('div', {
                      style: { color: '#949ba4', fontSize: '12px' }
                    }, (lb.playerCount || (lb.players ? lb.players.length : 0)) + '/4 players | ' + (lb.state || 'waiting'))
                  )
                ),
                React.createElement('div', {
                  style: {
                    background: '#f0b232', color: '#1c1c1e', padding: '6px 16px',
                    borderRadius: '4px', fontSize: '13px', fontWeight: 600
                  }
                }, 'Join')
              );
            })
          )
    );
  }

  // ── In a lobby - render game table ──
  var isWaiting = lobby.state === 'waiting';
  var players = lobby.players || [];
  var me = players.find(function(p) { return p.isMe; });
  var isMyTurn = me && lobby.currentTurn === me.id;
  var isHoldem = lobby.gameType === 'holdem';
  var isBlackjack = lobby.gameType === 'blackjack';
  var chat = lobby.chat || [];
  var communityCards = lobby.communityCards || [];
  var roundResults = lobby.roundResults || null;

  // Determine winners for glow effects
  var winnerIds = {};
  if (roundResults) {
    if (roundResults.winners) {
      roundResults.winners.forEach(function(w) { if (w.id) winnerIds[w.id] = true; });
    }
    if (roundResults.results) {
      roundResults.results.forEach(function(r) {
        if (r.result === 'win' && r.id) winnerIds[r.id] = true;
      });
    }
  }

  // ── Seat positions (up to 4) - bottom is me, then clockwise ──
  // Adjusted for larger table with more padding from edges
  var seatStyles = isMobile ? [
    { bottom: '4px', left: '50%', transform: 'translateX(-50%)' },
    { top: '50%', left: '4px', transform: 'translateY(-50%)' },
    { top: '4px', left: '50%', transform: 'translateX(-50%)' },
    { top: '50%', right: '4px', transform: 'translateY(-50%)' }
  ] : [
    { bottom: '14px', left: '50%', transform: 'translateX(-50%)' },
    { top: '50%', left: '18px', transform: 'translateY(-50%)' },
    { top: '14px', left: '50%', transform: 'translateX(-50%)' },
    { top: '50%', right: '18px', transform: 'translateY(-50%)' }
  ];

  // Reorder players so 'me' is first (seat 0 = bottom)
  var orderedPlayers = [];
  var meIdx = -1;
  for (var pi = 0; pi < players.length; pi++) {
    if (players[pi].isMe) { meIdx = pi; break; }
  }
  if (meIdx >= 0) {
    for (var oi = 0; oi < players.length; oi++) {
      orderedPlayers.push(players[(meIdx + oi) % players.length]);
    }
  } else {
    orderedPlayers = players.slice();
  }

  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column', background: '#18181b', overflow: 'hidden'
    }
  },
    // Top bar
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', background: '#252528', borderBottom: '1px solid #18181b',
        flexShrink: 0
      }
    },
      React.createElement('div', {
        style: { color: '#dcddde', fontWeight: 600, fontSize: '15px' }
      }, isHoldem ? "Texas Hold'em" : 'Blackjack'),
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '12px' }
      },
        me ? React.createElement('span', {
          style: { color: '#f0b232', fontSize: '13px', fontWeight: 600 }
        }, 'Chips: ' + me.chips) : null,
        React.createElement('button', {
          style: {
            padding: '5px 14px', background: '#ed4245', border: 'none',
            borderRadius: '4px', color: '#fff', fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: leaveLobby
        }, 'Leave')
      )
    ),

    // Game area -- expanded
    React.createElement('div', {
      style: {
        flex: 1, position: 'relative', display: 'flex', alignItems: 'center',
        justifyContent: 'center', minHeight: isMobile ? '320px' : '600px', overflow: 'hidden'
      }
    },
      // Table felt -- MUCH larger
      React.createElement('div', {
        style: {
          width: isMobile ? '98%' : '94%',
          maxWidth: isMobile ? '520px' : '1000px',
          height: '85%',
          minHeight: isMobile ? '300px' : '580px',
          maxHeight: isMobile ? '400px' : '640px',
          background: 'radial-gradient(ellipse at center, #2d5a2d 0%, #245024 40%, #1a3a1a 100%)',
          borderRadius: isMobile ? '70px' : '160px',
          border: isMobile ? '4px solid #5a3a1a' : '8px solid #5a3a1a',
          position: 'relative',
          boxShadow: 'inset 0 0 60px rgba(0,0,0,0.35), inset 0 0 120px rgba(0,0,0,0.15), 0 6px 32px rgba(0,0,0,0.7)',
          outline: isMobile ? '2px solid #3d2a10' : '3px solid #3d2a10',
          outlineOffset: isMobile ? '2px' : '3px'
        }
      },
        // Center area: pot info + community/dealer cards
        React.createElement('div', {
          style: {
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)', textAlign: 'center',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: isMobile ? '6px' : '10px', zIndex: 1, pointerEvents: 'none'
          }
        },
          // Waiting message
          isWaiting
            ? React.createElement('div', {
                style: {
                  color: '#f0e68c', fontSize: isMobile ? '14px' : '18px', fontWeight: 600,
                  textShadow: '0 1px 6px rgba(0,0,0,0.5)'
                }
              }, 'Waiting for players...')
            : null,

          // Pot + phase (holdem)
          !isWaiting && isHoldem
            ? React.createElement('div', {
                style: { textAlign: 'center', marginBottom: '6px' }
              },
                React.createElement('div', {
                  style: {
                    color: '#f0e68c', fontSize: isMobile ? '14px' : '16px', fontWeight: 700,
                    marginBottom: '2px', textShadow: '0 1px 4px rgba(0,0,0,0.5)'
                  }
                }, 'Pot: ' + (lobby.pot || 0)),
                lobby.phase ? React.createElement('div', {
                  style: {
                    color: '#b5bac1', fontSize: isMobile ? '11px' : '13px',
                    textTransform: 'uppercase', letterSpacing: '1px'
                  }
                }, lobby.phase) : null
              )
            : null,

          // Blackjack label
          !isWaiting && isBlackjack
            ? React.createElement('div', {
                style: {
                  color: '#f0e68c', fontSize: isMobile ? '15px' : '18px', fontWeight: 700,
                  marginBottom: '6px', textShadow: '0 1px 4px rgba(0,0,0,0.5)'
                }
              }, 'Blackjack')
            : null,

          // Community cards (holdem)
          !isWaiting && isHoldem
            ? React.createElement('div', {
                style: { display: 'flex', gap: isMobile ? '5px' : '10px' }
              },
              (function() {
                var slots = [];
                for (var ci = 0; ci < 5; ci++) {
                  if (ci < communityCards.length) {
                    slots.push(renderCard(communityCards[ci], ci));
                  } else {
                    slots.push(renderEmptySlot(ci));
                  }
                }
                return slots;
              })()
            )
            : null,

          // Dealer hand (blackjack)
          !isWaiting && isBlackjack
            ? React.createElement('div', {
                style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }
              },
              React.createElement('div', {
                style: {
                  color: '#f0e68c', fontSize: isMobile ? '12px' : '14px', fontWeight: 700,
                  whiteSpace: 'nowrap', textAlign: 'center',
                  textShadow: '0 1px 4px rgba(0,0,0,0.5)'
                }
              }, 'Dealer' + (lobby.dealerValue ? ' (' + lobby.dealerValue + ')' : '')),
              React.createElement('div', {
                style: { display: 'flex', gap: isMobile ? '5px' : '8px' }
              },
                (function() {
                  var dealerHand = lobby.dealerHand || [];
                  if (dealerHand.length === 0) return null;
                  var elems = [];
                  for (var di = 0; di < dealerHand.length; di++) {
                    elems.push(renderCard(dealerHand[di], 'dealer-' + di));
                  }
                  return elems;
                })()
              )
            )
            : null
        ),

        // Player seats
        orderedPlayers.map(function(pl, si) {
          if (si >= 4) return null;
          var seatPos = seatStyles[si];
          var isTurn = lobby.currentTurn === pl.id;
          var isWinner = winnerIds[pl.id] || false;

          // Glow style for winners
          var glowShadow = 'none';
          if (isWinner && showResultsOverlay) {
            glowShadow = '0 0 18px rgba(87,242,135,0.7), 0 0 36px rgba(87,242,135,0.35)';
          } else if (isTurn) {
            glowShadow = '0 0 14px rgba(88,101,242,0.55), 0 0 28px rgba(88,101,242,0.25)';
          }

          return React.createElement('div', {
            key: pl.id,
            style: Object.assign({}, {
              position: 'absolute', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: isMobile ? '3px' : '5px', zIndex: 2
            }, seatPos)
          },
            // Avatar
            renderPlayerAvatar(pl),

            // Player name plate -- wider, enhanced
            React.createElement('div', {
              style: {
                background: isTurn ? 'linear-gradient(135deg, #f0b232, #d4982a)' : 'linear-gradient(135deg, #2a2a2e, #222225)',
                border: isWinner && showResultsOverlay
                  ? '2px solid #57f287'
                  : isTurn
                    ? '2px solid #7289da'
                    : '2px solid #4e5058',
                borderRadius: isMobile ? '8px' : '10px',
                padding: isMobile ? '4px 8px' : '7px 14px',
                textAlign: 'center',
                minWidth: isMobile ? '80px' : '120px',
                maxWidth: isMobile ? '120px' : '160px',
                transition: 'all 0.3s ease',
                boxShadow: glowShadow
              }
            },
              React.createElement('div', {
                style: {
                  color: isTurn ? '#1c1c1e' : (pl.color || '#dcddde'),
                  fontSize: isMobile ? '11px' : '13px',
                  fontWeight: 700,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }
              }, pl.name + (pl.isMe ? ' (You)' : '')),
              React.createElement('div', {
                style: {
                  color: isTurn ? '#1c1c1e' : '#f0b232',
                  fontSize: isMobile ? '10px' : '12px',
                  opacity: isTurn ? 0.8 : 1
                }
              }, 'Chips: ' + pl.chips),
              pl.bet ? React.createElement('div', {
                style: { color: isTurn ? '#1c1c1e' : '#fee75c', fontSize: isMobile ? '9px' : '11px' }
              }, 'Bet: ' + pl.bet) : null,
              pl.folded ? React.createElement('div', {
                style: { color: '#ed4245', fontSize: isMobile ? '9px' : '11px', fontWeight: 600 }
              }, 'Folded') : null,
              pl.stood ? React.createElement('div', {
                style: { color: '#949ba4', fontSize: isMobile ? '9px' : '11px', fontWeight: 600 }
              }, 'Stand') : null,
              pl.busted ? React.createElement('div', {
                style: { color: '#ed4245', fontSize: isMobile ? '9px' : '11px', fontWeight: 600 }
              }, 'Busted') : null,
              isWaiting ? React.createElement('div', {
                style: { color: pl.ready ? '#57f287' : '#949ba4', fontSize: isMobile ? '9px' : '11px' }
              }, pl.ready ? 'Ready' : 'Not Ready') : null
            ),
            // Player cards
            pl.hand && pl.hand.length > 0 && !isWaiting ? React.createElement('div', {
              style: { display: 'flex', gap: isMobile ? '3px' : '5px' }
            },
              pl.hand.map(function(cd, ci) {
                return renderCard(cd, pl.id + '-' + ci);
              })
            ) : null,
            // Hand value (blackjack)
            isBlackjack && pl.handValue && !isWaiting ? React.createElement('div', {
              style: {
                color: '#f0e68c', fontSize: isMobile ? '11px' : '13px', fontWeight: 600,
                textShadow: '0 1px 3px rgba(0,0,0,0.5)'
              }
            }, 'Value: ' + pl.handValue) : null
          );
        })
      ),

      // Round results overlay
      roundResults && showResultsOverlay ? React.createElement('div', {
        style: {
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.75)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 10,
          animation: 'fadeIn 0.3s ease'
        }
      },
        React.createElement('div', {
          style: {
            background: 'linear-gradient(135deg, #2a2a2e, #1e1e22)',
            borderRadius: '14px',
            padding: isMobile ? '18px 18px' : '28px 36px',
            maxWidth: isMobile ? '320px' : '440px', width: '90%', textAlign: 'center',
            border: '2px solid #f0b232',
            boxShadow: '0 0 24px rgba(240,178,50,0.3), 0 6px 32px rgba(0,0,0,0.7)'
          }
        },
          React.createElement('div', {
            style: { fontSize: '28px', marginBottom: '10px' }
          }, '\uD83C\uDFC6'),
          React.createElement('h3', {
            style: { color: '#f0b232', fontSize: '22px', fontWeight: 700, marginBottom: '14px' }
          }, 'Round Results'),
          // Holdem results
          roundResults.winners ? roundResults.winners.map(function(w, wi) {
            return React.createElement('div', {
              key: wi,
              style: { color: '#57f287', fontSize: '16px', fontWeight: 600, marginBottom: '5px' }
            }, w.name + ' wins ' + w.amount + ' chips' + (w.hand ? ' (' + w.hand + ')' : ''));
          }) : null,
          // Blackjack results
          roundResults.results ? React.createElement('div', null,
            roundResults.dealerValue ? React.createElement('div', {
              style: { color: '#dcddde', fontSize: '15px', marginBottom: '10px' }
            }, 'Dealer: ' + roundResults.dealerValue) : null,
            roundResults.results.map(function(r, ri) {
              var rColor = r.result === 'win' ? '#57f287' : r.result === 'push' ? '#fee75c' : '#ed4245';
              return React.createElement('div', {
                key: ri,
                style: { color: rColor, fontSize: '15px', fontWeight: 600, marginBottom: '3px' }
              }, r.name + ': ' + r.result + (r.payout ? ' (+' + r.payout + ')' : '') + (r.handValue ? ' [' + r.handValue + ']' : ''));
            })
          ) : null
        )
      ) : null
    ),

    // Action bar
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: isMobile ? '4px' : '8px', padding: isMobile ? '6px 8px' : '10px 16px', background: '#252528',
        borderTop: '1px solid #18181b', flexShrink: 0, flexWrap: 'wrap'
      }
    },
      // Waiting state: ready button
      isWaiting && me && !me.ready ? React.createElement('button', {
        style: {
          padding: '8px 24px', background: '#57f287', border: 'none',
          borderRadius: '6px', color: '#18181b', fontSize: '14px',
          fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
        },
        onClick: sendReady
      }, 'Ready') : null,
      isWaiting && me && me.ready ? React.createElement('span', {
        style: { color: '#57f287', fontSize: '14px', fontWeight: 600 }
      }, 'Waiting for others...') : null,

      // Holdem actions
      !isWaiting && isHoldem && isMyTurn ? [
        React.createElement('button', {
          key: 'fold',
          style: {
            padding: isMobile ? '6px 10px' : '8px 16px', background: '#ed4245', border: 'none',
            borderRadius: '6px', color: '#fff', fontSize: isMobile ? '12px' : '13px',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { sendAction('fold'); }
        }, 'Fold'),
        lobby.currentBet && me && me.bet >= lobby.currentBet
          ? React.createElement('button', {
              key: 'check',
              style: {
                padding: isMobile ? '6px 10px' : '8px 16px', background: '#f0b232', border: 'none',
                borderRadius: '6px', color: '#1c1c1e', fontSize: isMobile ? '12px' : '13px',
                fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
              },
              onClick: function() { sendAction('check'); }
            }, 'Check')
          : React.createElement('button', {
              key: 'call',
              style: {
                padding: isMobile ? '6px 10px' : '8px 16px', background: '#f0b232', border: 'none',
                borderRadius: '6px', color: '#1c1c1e', fontSize: isMobile ? '12px' : '13px',
                fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
              },
              onClick: function() { sendAction('call'); }
            }, 'Call' + (lobby.currentBet ? ' (' + (lobby.currentBet - (me ? me.bet || 0 : 0)) + ')' : '')),
        React.createElement('div', {
          key: 'raise-group',
          style: { display: 'flex', alignItems: 'center', gap: '4px' }
        },
          React.createElement('input', {
            type: 'number',
            value: raiseAmount,
            onChange: function(e) { setRaiseAmount(parseInt(e.target.value) || 0); },
            style: {
              width: isMobile ? '54px' : '70px', padding: isMobile ? '4px 6px' : '6px 8px', background: '#18181b',
              border: '1px solid #4e5058', borderRadius: '4px', color: '#dcddde',
              fontSize: isMobile ? '12px' : '13px', fontFamily: 'inherit', textAlign: 'center'
            },
            min: lobby.bigBlind || 10
          }),
          React.createElement('button', {
            style: {
              padding: isMobile ? '6px 10px' : '8px 14px', background: '#f0b232', border: 'none',
              borderRadius: '6px', color: '#18181b', fontSize: isMobile ? '12px' : '13px',
              fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
            },
            onClick: function() { sendAction('raise', raiseAmount); }
          }, 'Raise')
        ),
        React.createElement('button', {
          key: 'allin',
          style: {
            padding: isMobile ? '6px 10px' : '8px 16px', background: '#ed4245', border: 'none',
            borderRadius: '6px', color: '#fff', fontSize: isMobile ? '12px' : '13px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { sendAction('raise', me ? me.chips : 0); }
        }, 'All In')
      ] : null,

      // Blackjack actions
      !isWaiting && isBlackjack && isMyTurn ? [
        React.createElement('button', {
          key: 'hit',
          style: {
            padding: isMobile ? '6px 14px' : '8px 20px', background: '#57f287', border: 'none',
            borderRadius: '6px', color: '#18181b', fontSize: isMobile ? '12px' : '14px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { sendAction('hit'); }
        }, 'Hit'),
        React.createElement('button', {
          key: 'stand',
          style: {
            padding: isMobile ? '6px 14px' : '8px 20px', background: '#f0b232', border: 'none',
            borderRadius: '6px', color: '#1c1c1e', fontSize: isMobile ? '12px' : '14px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { sendAction('stand'); }
        }, 'Stand'),
        me && !me.doubledDown ? React.createElement('button', {
          key: 'double',
          style: {
            padding: isMobile ? '6px 14px' : '8px 20px', background: '#f0b232', border: 'none',
            borderRadius: '6px', color: '#1c1c1e', fontSize: isMobile ? '12px' : '14px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { sendAction('double'); }
        }, 'Double') : null
      ] : null,

      // Not your turn indicator
      !isWaiting && !isMyTurn ? React.createElement('span', {
        style: { color: '#949ba4', fontSize: '13px', fontStyle: 'italic' }
      }, 'Waiting for other player...') : null
    ),

    // Chat panel
    React.createElement('div', {
      style: {
        height: isMobile ? '80px' : '120px', display: 'flex', flexDirection: 'column',
        background: '#18181b', borderTop: '1px solid #252528', flexShrink: 0
      }
    },
      React.createElement('div', {
        style: {
          flex: 1, overflowY: 'auto', padding: '6px 12px', fontSize: '12px',
          display: 'flex', flexDirection: 'column', gap: '2px'
        }
      },
        chat.map(function(msg, mi) {
          return React.createElement('div', { key: mi },
            React.createElement('span', {
              style: { color: msg.color || '#f0b232', fontWeight: 600 }
            }, msg.name + ': '),
            React.createElement('span', {
              style: { color: '#dcddde' }
            }, ctx.censorText(msg.text))
          );
        }),
        React.createElement('div', { ref: chatEndRef })
      ),
      React.createElement('div', {
        style: { display: 'flex', padding: '6px', gap: '6px', flexShrink: 0 }
      },
        React.createElement('input', {
          type: 'text',
          value: chatInput,
          onChange: function(e) { setChatInput(e.target.value); },
          onKeyDown: function(e) { if (e.key === 'Enter') sendChat(); },
          placeholder: 'Chat...',
          style: {
            flex: 1, padding: '6px 10px', background: '#252528',
            border: '1px solid #4e5058', borderRadius: '4px', color: '#dcddde',
            fontSize: '12px', fontFamily: 'inherit', outline: 'none'
          }
        }),
        React.createElement('button', {
          style: {
            padding: '6px 14px', background: '#f0b232', border: 'none',
            borderRadius: '4px', color: '#1c1c1e', fontSize: '12px',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: sendChat
        }, 'Send')
      )
    )
  );
}
