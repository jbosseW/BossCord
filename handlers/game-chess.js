// handlers/game-chess.js
// Socket handlers: chess_get_lobbies, chess_create_lobby, chess_join_lobby,
//                  chess_leave_lobby, chess_ready, chess_move, chess_resign,
//                  chess_offer_draw, chess_accept_draw, chess_play_ai, chess_chat

const CHESS_WIN_REWARD = 50;

module.exports = {
  init(io, socket, deps) {
    var { user, checkEventRate, chessManager, socketAccountMap, accounts, loot } = deps;
    var crypto = require('crypto');
    if (!chessManager) return;

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
      for (var [pid] of lobby.players) {
        var s = _getSock(pid);
        if (s) s.emit('chess_lobby_update', chessManager.getLobbyState(lobby.id, pid));
      }
      if (lobby.spectators) {
        for (var [sid] of lobby.spectators) {
          var s2 = _getSock(sid);
          if (s2) s2.emit('chess_lobby_update', chessManager.getLobbyState(lobby.id, sid));
        }
      }
    }

    // Wire broadcast function for AI moves and timer updates
    if (!chessManager._broadcastFn) {
      chessManager.setBroadcastFn(function(lobbyId, lobby, eventType, data) {
        if (eventType === 'time_update') {
          // Broadcast time update to the chess room
          io.to('chess:' + lobbyId).emit('chess_time_update', { lobbyId: lobbyId, times: data });
        } else {
          // Regular lobby state broadcast (AI moves, timeout endings, etc.)
          _broadcastLobbyState(lobby);

          // If game finished, award chips and update lobby list
          if (lobby.state === 'finished' && lobby.result) {
            _awardChips(lobby);
            io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
          }
        }
      });
    }

    // Helper: award chips on game end (idempotent -- only awards once)
    function _awardChips(lobby) {
      if (!lobby.result) return;
      if (lobby.result.winner === 'draw') return; // No chips on draw
      if (lobby._chipsAwarded) return; // Prevent double/triple payout
      lobby._chipsAwarded = true;

      for (var [pid, p] of lobby.players) {
        if (p.isAI) continue;
        if (p.side === lobby.result.winner) {
          var accKey = socketAccountMap.get(pid);
          if (accKey) {
            var newChips = accounts.updateChips(accKey, CHESS_WIN_REWARD);
            var ws = io.sockets ? io.sockets.get(pid) : null;
            if (!ws && io.sockets && io.sockets.sockets) {
              ws = io.sockets.sockets.get(pid);
            }
            if (ws && newChips !== null) {
              ws.emit('chips_updated', { chips: newChips, reason: 'Chess win! +' + CHESS_WIN_REWARD });
            }
            // Key drop on chess win
            var keyDrop = loot.rollKeyDrop();
            if (keyDrop) {
              var keyInstance = {
                instanceId: crypto.randomBytes(6).toString('hex'),
                itemId: keyDrop.id,
                obtainedAt: Date.now(),
                source: 'game_drop'
              };
              accounts.addInventoryItem(accKey, keyInstance);
              var kws = ws || (io.sockets ? io.sockets.get(pid) : null);
              if (kws) {
                kws.emit('key_drop', {
                  key: { id: keyDrop.id, name: keyDrop.name, rarity: keyDrop.rarity, img: keyDrop.img },
                  instanceId: keyInstance.instanceId
                });
              }
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Chess: get lobbies
    // ------------------------------------------------------------------
    socket.on('chess_get_lobbies', function() {
      try {
        if (!checkEventRate(socket, 'chess_get_lobbies', 30, 60000)) return;
        socket.emit('chess_lobbies', { lobbies: chessManager.getLobbies() });
      } catch (err) {
        console.error('[chess_get_lobbies] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: create lobby
    // ------------------------------------------------------------------
    socket.on('chess_create_lobby', function(data) {
      try {
        if (!checkEventRate(socket, 'chess_create_lobby', 10, 60000)) return;
        var preferredSide = (data && data.side === 'b') ? 'b' : 'w';
        var validTimeControls = ['none', 'bullet', 'blitz', 'rapid', 'classical'];
        var timeControl = 'none';
        if (data && data.timeControl && validTimeControls.indexOf(data.timeControl) !== -1) {
          timeControl = data.timeControl;
        }
        var lobby = chessManager.createLobby(socket.id, user.name, user.color, preferredSide, timeControl);
        if (!lobby) {
          socket.emit('chess_error', { message: 'Already in a chess lobby' });
          return;
        }
        socket.join('chess:' + lobby.id);
        socket.emit('chess_lobby_joined', chessManager.getLobbyState(lobby.id, socket.id));
        io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
        console.log('[chess] ' + user.name + ' created lobby ' + lobby.id);
      } catch (err) {
        console.error('[chess_create_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: join lobby
    // ------------------------------------------------------------------
    socket.on('chess_join_lobby', function(data) {
      try {
        if (!checkEventRate(socket, 'chess_join_lobby', 10, 60000)) return;
        if (!data || !data.lobbyId) return;
        var lobby = chessManager.joinLobby(socket.id, data.lobbyId, user.name, user.color);
        if (!lobby) {
          socket.emit('chess_error', { message: 'Cannot join this lobby' });
          return;
        }
        socket.join('chess:' + lobby.id);
        socket.emit('chess_lobby_joined', chessManager.getLobbyState(lobby.id, socket.id));
        _broadcastLobbyState(lobby);
        io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
        console.log('[chess] ' + user.name + ' joined lobby ' + lobby.id);
      } catch (err) {
        console.error('[chess_join_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: spectate lobby
    // ------------------------------------------------------------------
    socket.on('chess_spectate', function(data) {
      try {
        if (!checkEventRate(socket, 'chess_spectate', 10, 60000)) return;
        if (!data || !data.lobbyId) return;
        var lobby = chessManager.spectate(socket.id, data.lobbyId, user.name, user.color);
        if (!lobby) {
          socket.emit('chess_error', { message: 'Cannot spectate this lobby' });
          return;
        }
        socket.join('chess:' + lobby.id);
        socket.emit('chess_lobby_joined', chessManager.getLobbyState(lobby.id, socket.id));
        _broadcastLobbyState(lobby);
        io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
        console.log('[chess] ' + user.name + ' spectating lobby ' + lobby.id);
      } catch (err) {
        console.error('[chess_spectate] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: join queue to play winner
    // ------------------------------------------------------------------
    socket.on('chess_join_queue', function() {
      try {
        if (!checkEventRate(socket, 'chess_join_queue', 10, 60000)) return;
        var lobbyId = chessManager.getSpectatorLobbyId(socket.id);
        if (!lobbyId) {
          socket.emit('chess_error', { message: 'Must be spectating to queue' });
          return;
        }
        var lobby = chessManager.joinQueue(socket.id, lobbyId);
        if (!lobby) {
          socket.emit('chess_error', { message: 'Cannot join queue' });
          return;
        }
        _broadcastLobbyState(lobby);
      } catch (err) {
        console.error('[chess_join_queue] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: leave queue
    // ------------------------------------------------------------------
    socket.on('chess_leave_queue', function() {
      try {
        if (!checkEventRate(socket, 'chess_leave_queue', 10, 60000)) return;
        var lobby = chessManager.leaveQueue(socket.id);
        if (lobby) _broadcastLobbyState(lobby);
      } catch (err) {
        console.error('[chess_leave_queue] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: leave lobby
    // ------------------------------------------------------------------
    socket.on('chess_leave_lobby', function() {
      try {
        if (!checkEventRate(socket, 'chess_leave_lobby', 10, 60000)) return;

        // Check if player
        var result = chessManager.leaveLobby(socket.id);
        if (result) {
          socket.leave('chess:' + result.lobbyId);
          socket.emit('chess_lobby_left');

          if (!result.destroyed) {
            var lobby = chessManager.lobbies.get(result.lobbyId);
            if (lobby) {
              if (lobby.state === 'finished' && lobby.result) {
                _awardChips(lobby);
              }
              _broadcastLobbyState(lobby);
            }
          }
          io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
          return;
        }

        // Check if spectator
        var specResult = chessManager.leaveSpectator(socket.id);
        if (specResult) {
          socket.leave('chess:' + specResult.lobbyId);
          socket.emit('chess_lobby_left');
          var lobby2 = chessManager.lobbies.get(specResult.lobbyId);
          if (lobby2) _broadcastLobbyState(lobby2);
          io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
        }
      } catch (err) {
        console.error('[chess_leave_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: ready up
    // ------------------------------------------------------------------
    socket.on('chess_ready', function() {
      try {
        if (!checkEventRate(socket, 'chess_ready', 10, 60000)) return;
        var lobby = chessManager.playerReady(socket.id);
        if (!lobby) return;
        _broadcastLobbyState(lobby);
        io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
      } catch (err) {
        console.error('[chess_ready] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: make a move
    // ------------------------------------------------------------------
    socket.on('chess_move', function(data) {
      try {
        if (!checkEventRate(socket, 'chess_move', 60, 60000)) return;
        if (!data || !data.from || !data.to) {
          socket.emit('chess_error', { message: 'Invalid move data' });
          return;
        }

        var result = chessManager.makeMove(socket.id, {
          from: data.from,
          to: data.to,
          promotion: data.promotion || undefined,
        });

        if (result.error) {
          socket.emit('chess_error', { message: result.error });
          return;
        }

        var lobby = result.lobby;
        _broadcastLobbyState(lobby);

        // If game finished, award chips
        if (lobby.state === 'finished' && lobby.result) {
          _awardChips(lobby);
          io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
        }
      } catch (err) {
        console.error('[chess_move] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: resign
    // ------------------------------------------------------------------
    socket.on('chess_resign', function() {
      try {
        if (!checkEventRate(socket, 'chess_resign', 5, 60000)) return;
        var lobby = chessManager.resign(socket.id);
        if (!lobby) return;
        _awardChips(lobby);
        _broadcastLobbyState(lobby);
        io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
      } catch (err) {
        console.error('[chess_resign] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: offer draw
    // ------------------------------------------------------------------
    socket.on('chess_offer_draw', function() {
      try {
        if (!checkEventRate(socket, 'chess_offer_draw', 5, 60000)) return;
        var lobby = chessManager.offerDraw(socket.id);
        if (!lobby) return;
        _broadcastLobbyState(lobby);
      } catch (err) {
        console.error('[chess_offer_draw] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: accept draw
    // ------------------------------------------------------------------
    socket.on('chess_accept_draw', function() {
      try {
        if (!checkEventRate(socket, 'chess_accept_draw', 5, 60000)) return;
        var lobby = chessManager.acceptDraw(socket.id);
        if (!lobby) return;
        _broadcastLobbyState(lobby);
        io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
      } catch (err) {
        console.error('[chess_accept_draw] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: play vs AI
    // ------------------------------------------------------------------
    socket.on('chess_play_ai', function() {
      try {
        if (!checkEventRate(socket, 'chess_play_ai', 5, 60000)) return;

        var lobbyId = chessManager.getPlayerLobbyId(socket.id);
        if (!lobbyId) {
          socket.emit('chess_error', { message: 'Create a lobby first' });
          return;
        }

        var lobby = chessManager.addAI(lobbyId);
        if (!lobby) {
          socket.emit('chess_error', { message: 'Cannot add AI to this lobby' });
          return;
        }

        // Join room and send state
        socket.emit('chess_lobby_update', chessManager.getLobbyState(lobby.id, socket.id));
        io.emit('chess_lobbies_updated', { lobbies: chessManager.getLobbies() });
        console.log('[chess] ' + user.name + ' started game vs AI in ' + lobby.id);
      } catch (err) {
        console.error('[chess_play_ai] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Chess: chat
    // ------------------------------------------------------------------
    socket.on('chess_chat', function(data) {
      try {
        if (!checkEventRate(socket, 'chess_chat', 15, 60000)) return;
        if (!data || typeof data.message !== 'string') return;
        var sanitizeText = deps.sanitizeText;
        var result = chessManager.addChat(socket.id, sanitizeText(data.message));
        if (!result) return;
        io.to('chess:' + result.lobbyId).emit('chess_chat_msg', result.msg);
      } catch (err) { /* swallow */ }
    });
  }
};
