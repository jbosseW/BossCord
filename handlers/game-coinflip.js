// handlers/game-coinflip.js
// Socket handlers: cf_get_lobbies, cf_create_lobby, cf_join_lobby,
//                  cf_leave_lobby, cf_choose, cf_chat

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, loot, coinFlipManager, CoinFlipConstants, checkEventRate, sanitizeText, challengesHandler } = deps;
    var crypto = require('crypto');
    var { CF_MAX_BET, COUNTDOWN_MS, RESULT_DISPLAY_MS } = CoinFlipConstants;

    // Helper: resolve socket by ID, compatible with both Server and Namespace.
    function getSocket(pid) {
      if (io.sockets && typeof io.sockets.get === 'function') {
        return io.sockets.get(pid);
      }
      return io.sockets && io.sockets.sockets && io.sockets.sockets.get(pid);
    }

    // ------------------------------------------------------------------
    // Coin Flip: get lobbies
    // ------------------------------------------------------------------
    socket.on('cf_get_lobbies', () => {
      try {
        if (!checkEventRate(socket, 'cf_get_lobbies', 30, 60000)) return;
        if (!coinFlipManager) return;
        socket.emit('cf_lobbies', { lobbies: coinFlipManager.getLobbies() });
      } catch (err) {
        console.error('[cf_get_lobbies] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Coin Flip: create lobby
    // ------------------------------------------------------------------
    socket.on('cf_create_lobby', () => {
      try {
        if (!checkEventRate(socket, 'cf_create_lobby', 30, 60000)) return;
        if (!coinFlipManager) return;
        const lobby = coinFlipManager.createLobby(socket.id, user.name, user.color);
        if (!lobby) {
          socket.emit('error', { message: 'Already in a coin flip lobby' });
          return;
        }
        socket.join('cflobby:' + lobby.id);
        socket.emit('cf_lobby_joined', coinFlipManager.getLobbyState(lobby.id));
        io.emit('cf_lobbies_updated', { lobbies: coinFlipManager.getLobbies() });
        console.log(`[coinflip] ${user.name} created lobby ${lobby.id}`);
      } catch (err) {
        console.error('[cf_create_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Coin Flip: join lobby
    // ------------------------------------------------------------------
    socket.on('cf_join_lobby', (data) => {
      try {
        if (!checkEventRate(socket, 'cf_join_lobby', 30, 60000)) return;
        if (!coinFlipManager || !data || !data.lobbyId) return;
        const lobby = coinFlipManager.joinLobby(socket.id, data.lobbyId, user.name, user.color);
        if (!lobby) {
          socket.emit('error', { message: 'Cannot join this lobby' });
          return;
        }
        socket.join('cflobby:' + lobby.id);
        socket.emit('cf_lobby_joined', coinFlipManager.getLobbyState(lobby.id));
        io.to('cflobby:' + lobby.id).emit('cf_lobby_update', coinFlipManager.getLobbyState(lobby.id));
        io.emit('cf_lobbies_updated', { lobbies: coinFlipManager.getLobbies() });
        console.log(`[coinflip] ${user.name} joined lobby ${lobby.id}`);
      } catch (err) {
        console.error('[cf_join_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Coin Flip: leave lobby
    // ------------------------------------------------------------------
    socket.on('cf_leave_lobby', () => {
      try {
        if (!checkEventRate(socket, 'cf_leave_lobby', 30, 60000)) return;
        if (!coinFlipManager) return;
        const result = coinFlipManager.leaveLobby(socket.id);
        if (!result) return;
        socket.leave('cflobby:' + result.lobbyId);
        socket.emit('cf_lobby_left');
        if (!result.destroyed) {
          io.to('cflobby:' + result.lobbyId).emit('cf_lobby_update', coinFlipManager.getLobbyState(result.lobbyId));
        }
        io.emit('cf_lobbies_updated', { lobbies: coinFlipManager.getLobbies() });
      } catch (err) {
        console.error('[cf_leave_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Coin Flip: make choice (heads/tails) and ready up
    // ------------------------------------------------------------------
    socket.on('cf_choose', (data) => {
      try {
        if (!checkEventRate(socket, 'cf_choose', 30, 60000)) return;
        if (!coinFlipManager || !data) return;
        // Validate and deduct bet if placing one
        var MAX_CF_BET = 10000;
        const betAmount = Math.min(Math.max(0, Math.floor(data.bet || 0)), MAX_CF_BET);

        // Pre-validate that makeChoice will succeed BEFORE deducting chips.
        // makeChoice fails if: not in a lobby, lobby state != 'waiting',
        // invalid choice, or player not found in lobby.
        const cfLobbyId = coinFlipManager.getPlayerLobbyId(socket.id);
        if (!cfLobbyId) return;
        const cfPreLobby = coinFlipManager.lobbies.get(cfLobbyId);
        if (!cfPreLobby || cfPreLobby.state !== 'waiting') return;
        if (data.choice !== 'heads' && data.choice !== 'tails') return;
        if (!cfPreLobby.players.has(socket.id)) return;

        if (betAmount > 0) {
          const accKey = socketAccountMap.get(socket.id);
          if (!accKey) {
            socket.emit('error', { message: 'Need an account to bet chips' });
            return;
          }
          const acc = accounts.loadAccount(accKey);
          if (!acc || acc.chips < betAmount) {
            socket.emit('error', { message: 'Not enough chips' });
            return;
          }
          // Deduct bet -- safe because we already validated makeChoice will succeed
          const newChips = accounts.updateChips(accKey, -betAmount);
          if (newChips === null) {
            socket.emit('error', { message: 'Account error' });
            return;
          }
          socket.emit('chips_updated', { chips: newChips, reason: 'Coin flip bet: ' + betAmount });
        }

        const lobby = coinFlipManager.makeChoice(socket.id, data.choice, betAmount);
        if (!lobby) {
          // Should not happen due to pre-validation, but refund defensively
          if (betAmount > 0) {
            const refundKey = socketAccountMap.get(socket.id);
            if (refundKey) {
              const refundedChips = accounts.updateChips(refundKey, betAmount);
              if (refundedChips !== null) {
                socket.emit('chips_updated', { chips: refundedChips, reason: 'Coin flip bet refunded' });
              }
            }
          }
          return;
        }
        const lobbyId = lobby.id;

        // Broadcast updated state
        io.to('cflobby:' + lobbyId).emit('cf_lobby_update', coinFlipManager.getLobbyState(lobbyId));

        // Check if we should start countdown
        if (coinFlipManager.shouldStartCountdown(lobbyId)) {
          const countdownLobby = coinFlipManager.startCountdown(lobbyId);
          if (countdownLobby) {
            io.to('cflobby:' + lobbyId).emit('cf_countdown', { seconds: Math.floor(COUNTDOWN_MS / 1000) });
            io.to('cflobby:' + lobbyId).emit('cf_lobby_update', coinFlipManager.getLobbyState(lobbyId));

            // Schedule the actual flip
            countdownLobby.countdownTimer = setTimeout(() => {
              const flipResult = coinFlipManager.doFlip(lobbyId);
              if (!flipResult) return;

              // Award chips to winners
              for (const winner of flipResult.winners) {
                const accKey = socketAccountMap.get(winner.id);
                if (accKey) {
                  const newChips = accounts.updateChips(accKey, winner.winAmount);
                  const ws = getSocket(winner.id);
                  if (ws && newChips !== null) {
                    ws.emit('chips_updated', { chips: newChips, reason: 'Coin flip win! +' + winner.winAmount });
                  }
                  // Key drop on win
                  var keyDrop = loot.rollKeyDrop();
                  if (keyDrop) {
                    var keyInstance = {
                      instanceId: crypto.randomBytes(6).toString('hex'),
                      itemId: keyDrop.id,
                      obtainedAt: Date.now(),
                      source: 'game_drop'
                    };
                    accounts.addInventoryItem(accKey, keyInstance);
                    var kws = getSocket(winner.id);
                    if (kws) {
                      kws.emit('key_drop', {
                        key: { id: keyDrop.id, name: keyDrop.name, rarity: keyDrop.rarity, img: keyDrop.img },
                        instanceId: keyInstance.instanceId
                      });
                    }
                  }
                }
              }

              // Track challenge progress for coinflip wins
              if (challengesHandler) {
                for (var cwi = 0; cwi < flipResult.winners.length; cwi++) {
                  var winnerAccKey = socketAccountMap.get(flipResult.winners[cwi].id);
                  if (winnerAccKey) {
                    challengesHandler.trackChallengeProgress(accounts, winnerAccKey, 'coinflip_wins', 1);
                    if (flipResult.winners[cwi].winAmount > 0) {
                      challengesHandler.trackChallengeProgress(accounts, winnerAccKey, 'chips_earned', flipResult.winners[cwi].winAmount);
                    }
                  }
                }
              }

              io.to('cflobby:' + lobbyId).emit('cf_flip_result', {
                result: flipResult.result,
                winners: flipResult.winners,
                losers: flipResult.losers,
              });
              io.to('cflobby:' + lobbyId).emit('cf_lobby_update', coinFlipManager.getLobbyState(lobbyId));

              // Auto-reset after result display
              const freshLobby = coinFlipManager.lobbies.get(lobbyId);
              if (freshLobby) {
                freshLobby.resultTimer = setTimeout(() => {
                  coinFlipManager.resetRound(lobbyId);
                  const resetState = coinFlipManager.getLobbyState(lobbyId);
                  if (resetState) {
                    io.to('cflobby:' + lobbyId).emit('cf_lobby_update', resetState);
                    io.to('cflobby:' + lobbyId).emit('cf_round_reset');
                  }
                }, RESULT_DISPLAY_MS);
              }
            }, COUNTDOWN_MS);
          }
        }
      } catch (err) {
        console.error('[cf_choose] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Coin Flip: chat
    // ------------------------------------------------------------------
    socket.on('cf_chat', (data) => {
      try {
        if (!checkEventRate(socket, 'cf_chat', 30, 60000)) return;
        if (!coinFlipManager || !data || typeof data.message !== 'string') return;
        const result = coinFlipManager.addChat(socket.id, sanitizeText(data.message));
        if (!result) return;
        io.to('cflobby:' + result.lobbyId).emit('cf_chat_msg', result.msg);
      } catch (err) { /* swallow */ }
    });
  }
};
