// handlers/game-orbs.js
// Socket handlers: game_join, game_move, game_leave, game_list_instances
// Game logic runs in a Worker thread; this handler sends messages via proxy.

module.exports = {
  init(io, socket, deps) {
    var { user, game, checkEventRate } = deps;
    // game is the GameProxy object (has findBestInstance marker)
    var isProxy = game && typeof game.findBestInstance === 'function';

    // ------------------------------------------------------------------
    // Game: list available instances (for lobby browser)
    // ------------------------------------------------------------------
    socket.on('game_list_instances', () => {
      try {
        if (!checkEventRate(socket, 'game_list_instances', 30, 60000)) return;
        if (!game) return;
        if (isProxy && typeof game.getInstanceList === 'function') {
          game.getInstanceList(function(result) {
            socket.emit('game_instances', result.instances);
          });
        }
      } catch (err) {
        console.error('[game_list_instances] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Game: join (optionally specify instance)
    // ------------------------------------------------------------------
    socket.on('game_join', (data) => {
      try {
        if (!checkEventRate(socket, 'game_join', 10, 60000)) return;
        if (!game) return;

        if (isProxy) {
          var requestedInstanceId = (data && data.instanceId) || null;
          game.joinBestInstance(socket.id, user.name, user.color, requestedInstanceId, function(result) {
            if (result.type === 'orbs_join_failed') {
              socket.emit('error', { message: 'Game server full. Try again shortly.' });
              return;
            }
            var roomName = 'game_' + result.instanceId;
            socket.join(roomName);
            socket.emit('game_state', result.fullState);
            io.to(roomName).emit('game_player_joined', result.player);
            console.log('[game] ' + user.name + ' joined instance ' + result.instanceId);
          });
        }
      } catch (err) {
        console.error('[game_join] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Game: move input (fire-and-forget to Worker)
    // ------------------------------------------------------------------
    socket._lastGameMove = 0;
    socket.on('game_move', (data) => {
      try {
        // Throttle: max one move per 40ms (~25/sec). Uses timestamp instead of
        // ratelimit.check() to avoid triggering violation cascade + IP auto-ban.
        var now = Date.now();
        if (now - socket._lastGameMove < 40) return;
        socket._lastGameMove = now;
        if (!game || !data) return;
        game.updateInput(socket.id, Number(data.x) || 0, Number(data.y) || 0, !!data.boost);
      } catch (err) { /* high frequency, swallow */ }
    });

    // ------------------------------------------------------------------
    // Game: leave
    // ------------------------------------------------------------------
    socket.on('game_leave', () => {
      try {
        if (!checkEventRate(socket, 'game_leave', 10, 60000)) return;
        if (!game) return;
        if (isProxy) {
          var instanceId = game.getPlayerInstance(socket.id);
          if (instanceId) {
            socket.leave('game_' + instanceId);
            io.to('game_' + instanceId).emit('game_player_left', { id: socket.id });
          }
          game.removePlayer(socket.id);
        }
        console.log('[game] ' + user.name + ' left the game');
      } catch (err) {
        console.error('[game_leave] Error:', err.message);
      }
    });
  }
};
