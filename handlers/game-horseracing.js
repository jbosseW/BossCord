// handlers/game-horseracing.js
// Socket handlers: hr_join, hr_leave, hr_place_bet, hr_cancel_bet,
//                  hr_get_state, hr_chat

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, loot, filter, checkEventRate, sanitizeText, horseRacingManager } = deps;
    var crypto = require('crypto');

    if (!horseRacingManager) return;

    // ------------------------------------------------------------------
    // Ensure the race loop is running with proper broadcast/resolve fns
    // We use a flag on the manager to avoid re-starting on every socket.
    // ------------------------------------------------------------------
    if (!horseRacingManager._loopStarted) {
      horseRacingManager._loopStarted = true;

      var broadcastFn = function(event, data) {
        io.to('horsetrack').emit(event, data);
      };

      var resolveBetFn = function(bets, placements, odds, basePayload) {
        if (!placements || placements.length === 0) {
          // No placements -- just broadcast the base payload to room
          io.to('horsetrack').emit('hr_race_results', basePayload || {});
          return;
        }

        var winnerId = placements[0].id;

        // Build a lookup from horseId -> horseName using placements
        var horseNameMap = {};
        for (var pi = 0; pi < placements.length; pi++) {
          horseNameMap[placements[pi].id] = placements[pi].name;
        }

        // Build per-player result map
        var playerResults = {};
        bets.forEach(function(bet, socketId) {
          var accKey = socketAccountMap.get(socketId);
          var won = (bet.horseId === winnerId);
          var payout = 0;
          var horseName = horseNameMap[bet.horseId] || 'Unknown';

          if (won) {
            var horseOdds = odds[bet.horseId] || 1.1;
            payout = Math.floor(bet.amount * horseOdds);

            if (accKey) {
              var newChips = accounts.updateChips(accKey, payout);
              // io is the /games namespace — use io.sockets (the Map) directly
              var ws = io.sockets.get(socketId) || null;
              if (ws && newChips !== null) {
                ws.emit('chips_updated', { chips: newChips, reason: 'Horse race win! +' + payout });
              }
              // Key drop on win
              var keyDrop = loot.rollKeyDrop();
              if (keyDrop && ws) {
                var keyInstance = {
                  instanceId: crypto.randomBytes(6).toString('hex'),
                  itemId: keyDrop.id,
                  obtainedAt: Date.now(),
                  source: 'game_drop'
                };
                accounts.addInventoryItem(accKey, keyInstance);
                ws.emit('key_drop', {
                  key: { id: keyDrop.id, name: keyDrop.name, rarity: keyDrop.rarity, img: keyDrop.img },
                  instanceId: keyInstance.instanceId
                });
              }
            }
          }

          playerResults[socketId] = { won: won, horseName: horseName, amount: bet.amount, payout: payout };
        });

        // Send to each socket in the room with their specific result
        // io is the /games namespace — use fetchSockets or iterate sockets in room
        io.in('horsetrack').fetchSockets().then(function(sockets) {
          sockets.forEach(function(ws) {
            var sockId = ws.id;
            if (ws) {
              var payload = {};
              // Copy base payload fields
              if (basePayload) {
                payload.raceNumber = basePayload.raceNumber;
                payload.placements = basePayload.placements;
                payload.photoFinish = basePayload.photoFinish;
                payload.phaseEndsAt = basePayload.phaseEndsAt;
              }
              // Attach per-player result (null if they didn't bet)
              payload.myResult = playerResults[sockId] || null;
              ws.emit('hr_race_results', payload);
            }
          });
        }).catch(function() { /* room may not exist yet */ });
      };

      // Register broadcast/resolve fns — races start when first spectator joins
      horseRacingManager.startRaceLoop(broadcastFn, resolveBetFn);
    }

    // ------------------------------------------------------------------
    // hr_join — join the horsetrack room
    // ------------------------------------------------------------------
    socket.on('hr_join', function() {
      try {
        if (!checkEventRate(socket, 'hr_join', 10, 60000)) return;

        socket.join('horsetrack');
        horseRacingManager.addSpectator(socket.id, user.name, user.color);

        // Resume race loop if it was paused due to no spectators
        horseRacingManager.resumeIfIdle();

        // Send current state to the joining player
        socket.emit('hr_joined', horseRacingManager.getRaceState());

        // Broadcast updated spectator count
        io.to('horsetrack').emit('hr_spectator_update', {
          count: horseRacingManager.getSpectatorCount()
        });

        console.log('[horseracing] ' + user.name + ' joined the track');
      } catch (err) {
        console.error('[hr_join] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // hr_leave — leave the horsetrack room
    // ------------------------------------------------------------------
    socket.on('hr_leave', function() {
      try {
        if (!checkEventRate(socket, 'hr_leave', 10, 60000)) return;

        socket.leave('horsetrack');
        horseRacingManager.removeSpectator(socket.id);

        io.to('horsetrack').emit('hr_spectator_update', {
          count: horseRacingManager.getSpectatorCount()
        });
      } catch (err) {
        console.error('[hr_leave] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // hr_place_bet — place a bet on a horse
    // ------------------------------------------------------------------
    socket.on('hr_place_bet', function(data) {
      try {
        if (!data || typeof data.horseId !== 'string' || typeof data.amount !== 'number') return;
        if (!checkEventRate(socket, 'hr_place_bet', 10, 60000)) return;

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) {
          socket.emit('hr_error', { message: 'Need an account to bet' });
          return;
        }

        var betAmount = Math.max(0, Math.floor(data.amount));
        if (betAmount < 10 || betAmount > 1000) {
          socket.emit('hr_error', { message: 'Bet must be between 10 and 1000 chips' });
          return;
        }

        var acc = accounts.loadAccount(accKey);
        if (!acc || acc.chips < betAmount) {
          socket.emit('hr_error', { message: 'Not enough chips' });
          return;
        }

        // Deduct chips BEFORE placing the bet (escrow pattern)
        accounts.updateChips(accKey, -betAmount);

        // Place the bet in the manager (validates phase, horse, etc.)
        var result = horseRacingManager.placeBet(socket.id, data.horseId, betAmount, acc.chips);

        if (result.error) {
          // Refund the escrowed chips since bet placement failed
          accounts.updateChips(accKey, betAmount);
          socket.emit('hr_error', { message: result.error });
          return;
        }

        var accAfterBet = accounts.loadAccount(accKey);
        var newChips = accAfterBet ? accAfterBet.chips : 0;
        socket.emit('chips_updated', { chips: newChips, reason: 'Horse race bet: ' + betAmount });

        // Confirm to sender (flattened format for client)
        socket.emit('hr_bet_confirmed', {
          horseName: result.horse.name,
          horseId: result.horse.id,
          amount: betAmount,
          odds: result.odds,
          potentialWin: result.potentialWin,
          chips: newChips
        });

        // Broadcast to room that someone bet (anonymized)
        io.to('horsetrack').emit('hr_bet_placed', {
          playerName: user.name,
          playerColor: user.color,
          horseName: result.horse.name,
          horseColor: result.horse.color,
          amount: betAmount
        });

      } catch (err) {
        console.error('[hr_place_bet] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // hr_cancel_bet — cancel a pending bet (refund)
    // ------------------------------------------------------------------
    socket.on('hr_cancel_bet', function() {
      try {
        if (!checkEventRate(socket, 'hr_cancel_bet', 10, 60000)) return;

        var refundAmount = horseRacingManager.cancelBet(socket.id);
        if (refundAmount === null) {
          socket.emit('hr_error', { message: 'No bet to cancel' });
          return;
        }

        var accKey = socketAccountMap.get(socket.id);
        if (accKey) {
          var newChips = accounts.updateChips(accKey, refundAmount);
          if (newChips !== null) {
            socket.emit('chips_updated', { chips: newChips, reason: 'Horse race bet cancelled: +' + refundAmount });
          }
        }

        socket.emit('hr_bet_cancelled', { refunded: refundAmount });
      } catch (err) {
        console.error('[hr_cancel_bet] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // hr_get_state — request current race state
    // ------------------------------------------------------------------
    socket.on('hr_get_state', function() {
      try {
        if (!checkEventRate(socket, 'hr_get_state', 30, 60000)) return;
        socket.emit('hr_state', horseRacingManager.getRaceState());
      } catch (err) {
        console.error('[hr_get_state] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // hr_chat — send a chat message to the horsetrack room
    // ------------------------------------------------------------------
    socket.on('hr_chat', function(data) {
      try {
        if (!data || typeof data.message !== 'string') return;
        if (!checkEventRate(socket, 'hr_chat', 15, 60000)) return;

        var cleanMsg = sanitizeText(data.message).slice(0, 50);
        if (filter && filter.censor) cleanMsg = filter.censor(cleanMsg);
        if (!cleanMsg) return;

        var msg = horseRacingManager.addChat(socket.id, user.name, user.color, cleanMsg);
        if (!msg) return;

        io.to('horsetrack').emit('hr_chat_msg', msg);
      } catch (err) { /* swallow */ }
    });
  }
};
