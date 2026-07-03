// handlers/disconnect.js
// Socket handler: disconnect (full cleanup including friend offline notifications)

module.exports = {
  init(io, socket, deps) {
    var { socketAccountMap, accounts, state, cords, game, lobbyManager, lieroManager, tcgBattleManager, tcgTradeManager, tcgTableManager, coinFlipManager, saveChipsForSocket, saveAllLobbyChips, _removeFromIpTracking, ratelimit, sessionTokens } = deps;

    // ------------------------------------------------------------------
    // Disconnect: full cleanup
    // ------------------------------------------------------------------
    socket.on('disconnect', (reason) => {
      try {
        // Decrement global connection counter
        ratelimit.decrementConnections();
        // Remove from concurrent connection tracking
        _removeFromIpTracking();

        const disconnectingUser = state.users.get(socket.id);
        if (!disconnectingUser) {
          console.log(`[disconnect] Unknown socket ${socket.id} (${reason})`);
          return;
        }

        // Save account data on disconnect
        const accKey = socketAccountMap.get(socket.id);
        const wasTemp = accKey ? accounts.isTempAccount(accKey) : true;

        // Notify friends this user went offline (before removing from map)
        if (accKey && !wasTemp) {
          try {
            var friendsData = accounts.getFriendsData(accKey);
            if (friendsData && friendsData.friends.length > 0) {
              for (var fi = 0; fi < friendsData.friends.length; fi++) {
                var fk = friendsData.friends[fi].key;
                for (var [sid, skey] of socketAccountMap) {
                  if (skey === fk && sid !== socket.id) {
                    var fSocket = io.sockets.sockets.get(sid);
                    if (fSocket) fSocket.emit('friend_status_changed', { key: accKey, online: false });
                  }
                }
              }
            }
          } catch (_) { /* don't let friend notify fail block disconnect */ }
        }

        if (accKey) {
          if (wasTemp) {
            // Temp account: delete entirely (progress lost)
            accounts.deleteAccount(accKey);
          } else {
            // Permanent account: save lastSeen and clear DMs
            const acc = accounts.loadAccount(accKey);
            if (acc) {
              acc.lastSeen = Date.now();
              // Wipe DMs on disconnect — messages are ephemeral
              if (acc.dms) {
                acc.dms = { conversations: {} };
              }
              accounts.saveAccount(acc);
            }
          }
          socketAccountMap.delete(socket.id);
        }

        // Clean up session tokens issued to this socket
        if (sessionTokens) {
          for (const [token, data] of sessionTokens) {
            if (data.socketId === socket.id) {
              sessionTokens.delete(token);
            }
          }
        }

        // Clean up cords and messages for anonymous/temp users
        if (wasTemp) {
          cords.deleteByAuthorId(socket.id);
          state.removeMessagesByAuthor(socket.id);
        }

        const userName = disconnectingUser.name;
        const roomCodes = new Set(disconnectingUser.roomIds);

        // Track which were public for updating room lists
        const hadPublicRooms = [];
        for (const code of roomCodes) {
          const room = state.rooms.get(code);
          if (room && room.isPublic) hadPublicRooms.push(code);

          socket.to(code).emit('user_left', {
            roomCode: code,
            user: { id: disconnectingUser.id, name: userName, color: disconnectingUser.color, tag: disconnectingUser.tag },
          });
        }

        // Clean up voice rooms: broadcast voice_user_left to any voice channels
        const allRooms = socket.rooms;
        for (const roomName of allRooms) {
          if (roomName.startsWith('voice:')) {
            const channelId = roomName.slice(6);
            socket.to(roomName).emit('voice_user_left', {
              channelId: channelId,
              user: { id: disconnectingUser.id, name: userName, color: disconnectingUser.color, tag: disconnectingUser.tag },
            });
          }
        }

        // Clean up game — send disconnect to Worker thread (handles both BossOrbs + Liero)
        // Worker posts back broadcast events which are handled by server.js message handler
        if (game && typeof game.disconnectCleanup === 'function') {
          game.disconnectCleanup(socket.id);
        }

        // Clean up card game lobby
        if (lobbyManager) {
          // Save chips before leaving
          const cardLobbyId = lobbyManager.getPlayerLobbyId(socket.id);
          if (cardLobbyId) {
            const cardLobby = lobbyManager.lobbies.get(cardLobbyId);
            if (cardLobby) {
              const p = cardLobby.players.get(socket.id);
              if (p) saveChipsForSocket(socket.id, p.chips);
            }
          }
          const cardResult = lobbyManager.leaveLobby(socket.id);
          if (cardResult && !cardResult.destroyed && cardResult.lobby) {
            // Remove bots if no humans left
            if (lobbyManager.getHumanCount(cardResult.lobbyId) === 0) {
              lobbyManager.removeBots(cardResult.lobbyId);
            }
            const freshLobby = lobbyManager.lobbies.get(cardResult.lobbyId);
            // If leaving ended the round, save remaining players' chips then rebuy
            if (freshLobby && freshLobby.state === 'waiting') {
              saveAllLobbyChips(freshLobby);
              lobbyManager.rebuyBrokePlayers(freshLobby);
            }
            if (freshLobby) {
              for (const [pid] of freshLobby.players) {
                const s = io.sockets.sockets.get(pid);
                if (s) s.emit('card_lobby_update', lobbyManager.getLobbyState(cardResult.lobbyId, pid));
              }
            }
            io.emit('card_lobbies_updated', { lobbies: lobbyManager.getLobbies() });
          } else if (cardResult) {
            io.emit('card_lobbies_updated', { lobbies: lobbyManager.getLobbies() });
          }
        }

        // Clean up TCG table
        if (tcgTableManager) {
          const tableResult = tcgTableManager.leaveTable(socket.id);
          if (tableResult) {
            if (tableResult.removed && tableResult.guestSocketId) {
              const guestSock = io.sockets.sockets.get(tableResult.guestSocketId);
              if (guestSock) guestSock.emit('tcg_table_closed', { reason: 'Host disconnected' });
            } else if (!tableResult.removed && tableResult.table && tableResult.table.host) {
              const hostSock = io.sockets.sockets.get(tableResult.table.host.socketId);
              if (hostSock) {
                const updatedTable = tcgTableManager.getTable(tableResult.table.id);
                if (updatedTable) hostSock.emit('tcg_table_updated', updatedTable);
              }
            }
          }
        }
        // Clean up TCG battle
        if (tcgBattleManager) {
          const tcgResult = tcgBattleManager.leaveBattle(socket.id);
          if (tcgResult && tcgResult.battle) {
            for (const [pid] of tcgResult.battle.players) {
              if (pid !== socket.id) {
                const s = io.sockets.sockets.get(pid);
                if (s) s.emit('tcg_battle_update', tcgBattleManager.getBattleState(tcgResult.battle.id, pid));
              }
            }
          }
        }
        // Clean up TCG trade
        if (tcgTradeManager) {
          tcgTradeManager.cancel(socket.id);
        }

        // Clean up coin flip lobby
        if (coinFlipManager) {
          const cfResult = coinFlipManager.leaveLobby(socket.id);
          if (cfResult && !cfResult.destroyed) {
            io.to('cflobby:' + cfResult.lobbyId).emit('cf_lobby_update', coinFlipManager.getLobbyState(cfResult.lobbyId));
          }
          if (cfResult) {
            io.emit('cf_lobbies_updated', { lobbies: coinFlipManager.getLobbies() });
          }
        }

        // BossBrawl (Liero) cleanup handled by Worker via game.disconnectCleanup() above
        // The Worker's disconnect handler covers both BossOrbs and Liero cleanup,
        // posting back broadcast events to the main thread's message handler in server.js.
        // Clear the proxy cache for liero as well.
        if (lieroManager && typeof lieroManager._playerLobbies === 'object') {
          lieroManager._playerLobbies.delete(socket.id);
        }

        state.removeUser(socket.id);

        // Update public rooms list if user was in any public rooms
        if (hadPublicRooms.length > 0) {
          io.emit('public_rooms_updated', { rooms: state.getPublicRooms() });
        }

        console.log(`[disconnect] ${userName} (${socket.id}) -- ${reason}`);
      } catch (err) {
        console.error('[disconnect] Error during cleanup:', err.message);
        try { state.removeUser(socket.id); } catch (_) { /* nothing left to do */ }
      }
    });
  }
};
