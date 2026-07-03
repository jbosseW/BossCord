// handlers/game-liero.js
// Socket handlers for BossBrawl (Liero-style combat game)
// Handles: lobby CRUD, game input, bot management
// Game logic runs in a Worker thread; this handler sends messages via proxy.

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, lieroManager, checkEventRate } = deps;
    if (!lieroManager) return;

    // ------------------------------------------------------------------
    // List active lobbies (for lobby browser)
    // ------------------------------------------------------------------
    socket.on('liero_list_lobbies', () => {
      try {
        if (!checkEventRate(socket, 'liero_list_lobbies', 30, 60000)) return;
        lieroManager.getLobbies(function(result) {
          socket.emit('liero_lobbies', { lobbies: result.lobbies });
        });
      } catch (err) {
        console.error('[liero_list_lobbies] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Create a new lobby
    // ------------------------------------------------------------------
    socket.on('liero_create_lobby', (data) => {
      try {
        if (!checkEventRate(socket, 'liero_create_lobby', 5, 60000)) {
          socket.emit('error', { message: 'Creating lobbies too fast' });
          return;
        }
        var mapType = (data && typeof data.mapType === 'string') ? data.mapType : 'caves';
        if (!['caves', 'tunnels', 'open'].includes(mapType)) mapType = 'caves';
        var scoreLimit = (data && typeof data.scoreLimit === 'number') ? data.scoreLimit : 50;
        if (![25, 50, 100].includes(scoreLimit)) scoreLimit = 50;

        // Load equipped weapons/spell from account inventory
        var loadout = getPlayerLoadout(socket.id);

        lieroManager.createLobby(socket.id, user.name, user.color, {
          mapType: mapType,
          scoreLimit: scoreLimit
        }, loadout.weapons, loadout.spell, function(result) {
          if (!result.lobbyId) {
            socket.emit('error', { message: result.error || 'Already in a lobby or server full' });
            return;
          }
          socket.join('liero_' + result.lobbyId);
          socket.emit('liero_lobby_joined', { lobby: result.lobby });
          io.emit('liero_lobbies_updated', { lobbies: result.lobbies });
          console.log('[bossbrawl] ' + user.name + ' created lobby ' + result.lobbyId);
        });
      } catch (err) {
        console.error('[liero_create_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Join an existing lobby
    // ------------------------------------------------------------------
    socket.on('liero_join_lobby', (data) => {
      try {
        if (!checkEventRate(socket, 'liero_join_lobby', 10, 60000)) return;
        if (!data || typeof data.lobbyId !== 'string') return;

        var loadout = getPlayerLoadout(socket.id);

        lieroManager.joinLobby(socket.id, data.lobbyId, user.name, user.color, loadout.weapons, loadout.spell, function(result) {
          if (!result.success) {
            socket.emit('error', { message: 'Lobby full, not found, or already in a lobby' });
            return;
          }

          socket.join('liero_' + result.lobbyId);
          socket.emit('liero_lobby_joined', { lobby: result.lobby });
          socket.to('liero_' + result.lobbyId).emit('liero_lobby_update', { lobby: result.lobby });
          io.emit('liero_lobbies_updated', { lobbies: result.lobbies });

          // If joining mid-game, send current game state so client can render
          if (result.lobbyState === 'playing' && result.gameStartData) {
            socket.emit('liero_game_start', result.gameStartData);
          }
          console.log('[bossbrawl] ' + user.name + ' joined lobby ' + result.lobbyId + (result.lobbyState === 'playing' ? ' (mid-game)' : ''));
        });
      } catch (err) {
        console.error('[liero_join_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Leave current lobby
    // ------------------------------------------------------------------
    socket.on('liero_leave_lobby', () => {
      try {
        if (!checkEventRate(socket, 'liero_leave_lobby', 10, 60000)) return;

        lieroManager.leaveLobby(socket.id, function(result) {
          if (!result.lobbyId) return;

          socket.leave('liero_' + result.lobbyId);
          socket.emit('liero_lobby_left');

          if (!result.destroyed && result.lobbyState) {
            io.to('liero_' + result.lobbyId).emit('liero_lobby_update', {
              lobby: result.lobbyState
            });
          }
          io.emit('liero_lobbies_updated', { lobbies: result.lobbies });
          console.log('[bossbrawl] ' + user.name + ' left lobby ' + result.lobbyId);
        });
      } catch (err) {
        console.error('[liero_leave_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Add bot to lobby (host only)
    // ------------------------------------------------------------------
    socket.on('liero_add_bot', () => {
      try {
        if (!checkEventRate(socket, 'liero_add_bot', 10, 60000)) return;
        var lobbyId = lieroManager.getPlayerLobbyId(socket.id);
        if (!lobbyId) return;

        lieroManager.addBot(lobbyId, socket.id, function(result) {
          if (!result.success) {
            socket.emit('error', { message: 'Cannot add bot (not host, lobby full, or game started)' });
            return;
          }
          io.to('liero_' + lobbyId).emit('liero_lobby_update', {
            lobby: result.lobby
          });
          io.emit('liero_lobbies_updated', { lobbies: result.lobbies });
        });
      } catch (err) {
        console.error('[liero_add_bot] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Remove bot from lobby (host only)
    // ------------------------------------------------------------------
    socket.on('liero_remove_bot', (data) => {
      try {
        if (!checkEventRate(socket, 'liero_remove_bot', 10, 60000)) return;
        if (!data || typeof data.botId !== 'string') return;
        var lobbyId = lieroManager.getPlayerLobbyId(socket.id);
        if (!lobbyId) return;

        lieroManager.removeBot(lobbyId, data.botId, socket.id, function(result) {
          if (!result.success) return;
          io.to('liero_' + lobbyId).emit('liero_lobby_update', {
            lobby: result.lobby
          });
          io.emit('liero_lobbies_updated', { lobbies: result.lobbies });
        });
      } catch (err) {
        console.error('[liero_remove_bot] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Start game (host only)
    // ------------------------------------------------------------------
    socket.on('liero_start_game', () => {
      try {
        if (!checkEventRate(socket, 'liero_start_game', 3, 60000)) return;
        var lobbyId = lieroManager.getPlayerLobbyId(socket.id);
        if (!lobbyId) return;

        lieroManager.startGame(lobbyId, socket.id, function(result) {
          if (!result.success) {
            socket.emit('error', { message: 'Cannot start (not host or need 2+ players)' });
            return;
          }

          if (result.gameStartData) {
            io.to('liero_' + lobbyId).emit('liero_game_start', result.gameStartData);
          }

          io.emit('liero_lobbies_updated', { lobbies: result.lobbies });
          console.log('[bossbrawl] Game started in lobby ' + lobbyId);
        });
      } catch (err) {
        console.error('[liero_start_game] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Player input (fire-and-forget to Worker)
    // ------------------------------------------------------------------
    socket._lastLieroInput = 0;
    socket.on('liero_input', (data) => {
      try {
        // Throttle: max one input per 40ms (~25/sec). Uses timestamp instead of
        // ratelimit.check() to avoid triggering violation cascade + IP auto-ban.
        var now = Date.now();
        if (now - socket._lastLieroInput < 40) return;
        socket._lastLieroInput = now;
        if (!data || typeof data !== 'object') return;

        lieroManager.handleInput(socket.id, {
          left: !!data.left,
          right: !!data.right,
          jump: !!data.jump,
          fire: !!data.fire,
          spell: !!data.spell,
          aimAngle: typeof data.aimAngle === 'number' && isFinite(data.aimAngle) ? data.aimAngle : 0,
          switchWeapon: data.switchWeapon === 1 ? 1 : (data.switchWeapon === -1 ? -1 : 0)
        });
      } catch (err) { /* high frequency, swallow */ }
    });

    // ------------------------------------------------------------------
    // Helper: get player's equipped weapons/spell from account
    // ------------------------------------------------------------------
    function getPlayerLoadout(socketId) {
      var result = { weapons: null, spell: null };
      try {
        var key = socketAccountMap.get(socketId);
        if (!key) return result;
        var acc = accounts.loadAccount(key);
        if (!acc || !acc.equipped) return result;
        // equipped.weapon and equipped.spellbook are item IDs from loot system
        // Map them to liero weapon IDs if they match
        // For now, the liero game handles defaults internally
        if (acc.equipped.weapon) result.weapons = [acc.equipped.weapon];
        if (acc.equipped.spellbook) result.spell = acc.equipped.spellbook;
      } catch (e) { /* ignore */ }
      return result;
    }
  }
};
