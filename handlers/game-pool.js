// handlers/game-pool.js
// Socket handlers: pool_get_lobbies, pool_create_lobby, pool_join_lobby,
//                  pool_spectate, pool_leave_lobby, pool_ready, pool_shoot,
//                  pool_place_cue, pool_join_queue, pool_leave_queue, pool_chat

'use strict';

var POOL_WIN_REWARD = 75;

module.exports = {
  init(io, socket, deps) {
    var user = deps.user;
    var checkEventRate = deps.checkEventRate;
    var poolManager = deps.poolManager;
    var socketAccountMap = deps.socketAccountMap;
    var accounts = deps.accounts;
    if (!poolManager) return;

    // Wire broadcast function so physics ticks reach the room
    if (!poolManager._broadcastFn) {
      poolManager.setBroadcastFn(function(lobbyId, eventName, data) {
        var room = 'pool:' + lobbyId;
        io.to(room).emit(eventName, data);
      });
    }

    // Helper: find a socket on the /games namespace
    function _getSock(pid) {
      var s = io.sockets ? io.sockets.get(pid) : null;
      if (!s && io.sockets && io.sockets.sockets) {
        s = io.sockets.sockets.get(pid);
      }
      return s;
    }

    // Helper: broadcast lobby state to all players + spectators
    function _broadcastLobbyState(lobby) {
      for (var pid of lobby.players.keys()) {
        var s = _getSock(pid);
        if (s) s.emit('pool_lobby_update', poolManager.getLobbyState(lobby.id, pid));
      }
      for (var sid of lobby.spectators.keys()) {
        var s2 = _getSock(sid);
        if (s2) s2.emit('pool_lobby_update', poolManager.getLobbyState(lobby.id, sid));
      }
    }

    // Helper: award chips on game end
    function _awardChips(lobby) {
      if (!lobby.result || !lobby.result.winner) return;
      var winnerId = lobby.result.winner;
      var loserId = lobby.result.loser;
      var reward = POOL_WIN_REWARD + (lobby.bet || 0) * 2;

      // If there was a bet, loser already had chips deducted on lobby create/join
      // Winner gets base reward + pot
      var accKey = socketAccountMap.get(winnerId);
      if (accKey) {
        var newChips = accounts.updateChips(accKey, reward);
        var ws = _getSock(winnerId);
        if (ws && newChips !== null) {
          ws.emit('chips_updated', { chips: newChips, reason: 'Pool win! +' + reward });
        }
      }
    }

    // ------------------------------------------------------------------
    // Pool: get lobbies
    // ------------------------------------------------------------------
    socket.on('pool_get_lobbies', function() {
      try {
        if (!checkEventRate(socket, 'pool_get_lobbies', 30, 60000)) return;
        socket.emit('pool_lobbies', { lobbies: poolManager.getLobbies() });
      } catch (err) {
        console.error('[pool_get_lobbies] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Pool: create lobby
    // ------------------------------------------------------------------
    socket.on('pool_create_lobby', function(data) {
      try {
        if (!checkEventRate(socket, 'pool_create_lobby', 5, 60000)) return;
        var bet = (data && typeof data.bet === 'number') ? Math.floor(data.bet) : 0;
        if (bet < 0) bet = 0;
        if (bet > 10000) bet = 10000;

        // Validate chips if betting
        if (bet > 0) {
          var accKey = socketAccountMap.get(socket.id);
          if (!accKey) {
            socket.emit('pool_error', { message: 'Need an account to bet chips' });
            return;
          }
          var acc = accounts.loadAccount(accKey);
          if (!acc || acc.chips < bet) {
            socket.emit('pool_error', { message: 'Not enough chips' });
            return;
          }
          accounts.updateChips(accKey, -bet);
        }

        var lobby;
        try {
          lobby = poolManager.createLobby(socket.id, user.name, user.color, bet);
          if (!lobby) {
            socket.emit('pool_error', { message: 'Already in a pool lobby' });
            // Refund bet if lobby creation failed
            if (bet > 0) {
              var ak = socketAccountMap.get(socket.id);
              if (ak) accounts.updateChips(ak, bet);
            }
            return;
          }
        } catch (err) {
          // Refund bet on exception
          if (bet > 0) {
            var ak2 = socketAccountMap.get(socket.id);
            if (ak2) accounts.updateChips(ak2, bet);
          }
          throw err;
        }

        socket.join('pool:' + lobby.id);
        socket.emit('pool_lobby_joined', poolManager.getLobbyState(lobby.id, socket.id));
        io.emit('pool_lobbies_updated', { lobbies: poolManager.getLobbies() });
        console.log('[pool] ' + user.name + ' created lobby ' + lobby.id + (bet > 0 ? ' (bet: ' + bet + ')' : ''));
      } catch (err) {
        console.error('[pool_create_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Pool: join lobby
    // ------------------------------------------------------------------
    socket.on('pool_join_lobby', function(data) {
      try {
        if (!checkEventRate(socket, 'pool_join_lobby', 10, 60000)) return;
        if (!data || !data.lobbyId) return;

        var targetLobby = poolManager.lobbies.get(data.lobbyId);
        if (!targetLobby) {
          socket.emit('pool_error', { message: 'Lobby not found' });
          return;
        }

        // Validate chips if lobby has a bet
        if (targetLobby.bet > 0) {
          var accKey = socketAccountMap.get(socket.id);
          if (!accKey) {
            socket.emit('pool_error', { message: 'Need an account to join a bet lobby' });
            return;
          }
          var acc = accounts.loadAccount(accKey);
          if (!acc || acc.chips < targetLobby.bet) {
            socket.emit('pool_error', { message: 'Not enough chips (need ' + targetLobby.bet + ')' });
            return;
          }
          accounts.updateChips(accKey, -targetLobby.bet);
        }

        var lobby;
        try {
          lobby = poolManager.joinLobby(socket.id, data.lobbyId, user.name, user.color);
          if (!lobby) {
            socket.emit('pool_error', { message: 'Cannot join this lobby' });
            // Refund bet
            if (targetLobby.bet > 0) {
              var ak = socketAccountMap.get(socket.id);
              if (ak) accounts.updateChips(ak, targetLobby.bet);
            }
            return;
          }
        } catch (err) {
          // Refund bet on exception
          if (targetLobby.bet > 0) {
            var ak2 = socketAccountMap.get(socket.id);
            if (ak2) accounts.updateChips(ak2, targetLobby.bet);
          }
          throw err;
        }

        socket.join('pool:' + lobby.id);
        socket.emit('pool_lobby_joined', poolManager.getLobbyState(lobby.id, socket.id));

        // Notify other players
        for (var pid of lobby.players.keys()) {
          if (pid === socket.id) continue;
          var s = _getSock(pid);
          if (s) s.emit('pool_lobby_update', poolManager.getLobbyState(lobby.id, pid));
        }

        io.emit('pool_lobbies_updated', { lobbies: poolManager.getLobbies() });
        console.log('[pool] ' + user.name + ' joined lobby ' + lobby.id);
      } catch (err) {
        console.error('[pool_join_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Pool: spectate lobby
    // ------------------------------------------------------------------
    socket.on('pool_spectate', function(data) {
      try {
        if (!checkEventRate(socket, 'pool_spectate', 10, 60000)) return;
        if (!data || !data.lobbyId) return;
        var lobby = poolManager.spectate(socket.id, data.lobbyId, user.name, user.color);
        if (!lobby) {
          socket.emit('pool_error', { message: 'Cannot spectate this lobby' });
          return;
        }
        socket.join('pool:' + lobby.id);
        socket.emit('pool_lobby_joined', poolManager.getLobbyState(lobby.id, socket.id));
        // Notify players of spectator count update
        _broadcastLobbyState(lobby);
        io.emit('pool_lobbies_updated', { lobbies: poolManager.getLobbies() });
        console.log('[pool] ' + user.name + ' spectating lobby ' + lobby.id);
      } catch (err) {
        console.error('[pool_spectate] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Pool: leave lobby
    // ------------------------------------------------------------------
    socket.on('pool_leave_lobby', function() {
      try {
        if (!checkEventRate(socket, 'pool_leave_lobby', 10, 60000)) return;

        // Check if player
        var result = poolManager.leaveLobby(socket.id);
        if (result) {
          socket.leave('pool:' + result.lobbyId);
          socket.emit('pool_lobby_left');

          if (!result.destroyed) {
            var lobby = poolManager.lobbies.get(result.lobbyId);
            if (lobby) {
              // If opponent wins by abandonment, award chips
              if (lobby.state === 'finished' && lobby.result) {
                _awardChips(lobby);
              }
              _broadcastLobbyState(lobby);
            }
          }
          io.emit('pool_lobbies_updated', { lobbies: poolManager.getLobbies() });
          return;
        }

        // Check if spectator
        var specResult = poolManager.leaveSpectator(socket.id);
        if (specResult) {
          socket.leave('pool:' + specResult.lobbyId);
          socket.emit('pool_lobby_left');
          var lobby2 = poolManager.lobbies.get(specResult.lobbyId);
          if (lobby2) _broadcastLobbyState(lobby2);
          io.emit('pool_lobbies_updated', { lobbies: poolManager.getLobbies() });
        }
      } catch (err) {
        console.error('[pool_leave_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Pool: ready up
    // ------------------------------------------------------------------
    socket.on('pool_ready', function() {
      try {
        if (!checkEventRate(socket, 'pool_ready', 10, 60000)) return;
        var lobby = poolManager.playerReady(socket.id);
        if (!lobby) return;

        _broadcastLobbyState(lobby);
        io.emit('pool_lobbies_updated', { lobbies: poolManager.getLobbies() });
      } catch (err) {
        console.error('[pool_ready] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Pool: shoot
    // ------------------------------------------------------------------
    socket.on('pool_shoot', function(data) {
      try {
        if (!checkEventRate(socket, 'pool_shoot', 30, 60000)) return;
        if (!data || typeof data.angle !== 'number' || typeof data.power !== 'number') {
          socket.emit('pool_error', { message: 'Invalid shot data' });
          return;
        }
        var result = poolManager.shoot(socket.id, data.angle, data.power);
        if (result && result.error) {
          socket.emit('pool_error', { message: result.error });
        }
        // Physics loop handles broadcasting from here
      } catch (err) {
        console.error('[pool_shoot] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Pool: place cue ball (ball-in-hand)
    // ------------------------------------------------------------------
    socket.on('pool_place_cue', function(data) {
      try {
        if (!checkEventRate(socket, 'pool_place_cue', 20, 60000)) return;
        if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') {
          socket.emit('pool_error', { message: 'Invalid placement' });
          return;
        }
        var result = poolManager.placeCueBall(socket.id, data.x, data.y);
        if (result && result.error) {
          socket.emit('pool_error', { message: result.error });
          return;
        }
        // Broadcast updated state
        var lobbyId = poolManager.getPlayerLobbyId(socket.id);
        if (lobbyId) {
          var lobby = poolManager.lobbies.get(lobbyId);
          if (lobby) {
            // Send physics tick with new cue ball position
            var ballData = [];
            for (var i = 0; i < lobby.balls.length; i++) {
              var b = lobby.balls[i];
              ballData.push({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, pocketed: b.pocketed });
            }
            io.to('pool:' + lobbyId).emit('pool_physics_tick', { balls: ballData });
            io.to('pool:' + lobbyId).emit('pool_turn_change', {
              turnPlayerId: lobby.turnPlayerId,
              phase: lobby.phase,
              ballInHand: lobby.phase === 'ball_in_hand'
            });
          }
        }
      } catch (err) {
        console.error('[pool_place_cue] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Pool: join queue (spectator queues to play winner)
    // ------------------------------------------------------------------
    socket.on('pool_join_queue', function() {
      try {
        if (!checkEventRate(socket, 'pool_join_queue', 10, 60000)) return;
        var lobby = poolManager.joinQueue(socket.id);
        if (!lobby) {
          socket.emit('pool_error', { message: 'Cannot join queue' });
          return;
        }
        _broadcastLobbyState(lobby);
      } catch (err) {
        console.error('[pool_join_queue] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Pool: leave queue
    // ------------------------------------------------------------------
    socket.on('pool_leave_queue', function() {
      try {
        if (!checkEventRate(socket, 'pool_leave_queue', 10, 60000)) return;
        var lobby = poolManager.leaveQueue(socket.id);
        if (lobby) _broadcastLobbyState(lobby);
      } catch (err) {
        console.error('[pool_leave_queue] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Pool: chat
    // ------------------------------------------------------------------
    socket.on('pool_chat', function(data) {
      try {
        if (!checkEventRate(socket, 'pool_chat', 15, 60000)) return;
        if (!data || typeof data.message !== 'string') return;
        var sanitizeText = deps.sanitizeText;
        var result = poolManager.addChat(socket.id, sanitizeText(data.message));
        if (!result) return;
        io.to('pool:' + result.lobbyId).emit('pool_chat_msg', result.msg);
      } catch (err) { /* swallow */ }
    });
  }
};
