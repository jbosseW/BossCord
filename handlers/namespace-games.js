// handlers/namespace-games.js
// Sets up the /games Socket.IO namespace for all game-related events:
//   BossOrbs, card games, slots, plinko, coinflip, scratch, lootbox, clicker

const ratelimit = require('../ratelimit');

module.exports = {
  /**
   * @param {import('socket.io').Server} io
   * @param {Function} depsFactory - (socket, accountKey) => deps object or null
   * @param {Map} sessionTokens - Map<token, { accountKey, socketId, ip, createdAt }>
   * @returns {import('socket.io').Namespace}
   */
  setup(io, depsFactory, sessionTokens) {
    const gamesNs = io.of('/games');

    gamesNs.on('connection', (socket) => {
      // Authenticate via session token issued by the default namespace
      const token = socket.handshake.auth && socket.handshake.auth.sessionToken;
      if (!token || typeof token !== 'string') {
        socket.disconnect(true);
        return;
      }
      const session = sessionTokens.get(token);
      if (!session || !session.accountKey) {
        socket.disconnect(true);
        return;
      }
      const accountKey = session.accountKey;

      // Enforce IP-based security checks (ban, rate limit)
      socket._clientIp = ratelimit.getIp(socket);
      const clientIp = socket._clientIp || socket.id;

      // Verify session token was issued to this IP (prevent token replay from different IP)
      if (session.ip && clientIp !== session.ip) {
        socket.disconnect(true);
        return;
      }
      if (ratelimit.isBanned(clientIp)) {
        socket.disconnect(true);
        return;
      }
      if (!ratelimit.check(clientIp, 'ns_games_connect', 20, 3600000)) {
        socket.disconnect(true);
        return;
      }
      ratelimit.incrementConnections();

      // Build deps for this socket using the shared factory
      const deps = depsFactory(socket, accountKey);
      if (!deps) {
        ratelimit.decrementConnections();
        socket.disconnect(true);
        return;
      }

      console.log('[games-ns] Connected: ' + deps.user.name + ' (' + socket.id + ')');

      // Register game handler modules — each binds socket events
      const gameOrbsHandler = require('./game-orbs');
      const gameCardsHandler = require('./game-cards');
      const gameSlotsHandler = require('./game-slots');
      const gamePlinkoHandler = require('./game-plinko');
      const gameCoinflipHandler = require('./game-coinflip');
      const gameScratchHandler = require('./game-scratch');
      const gameLootboxHandler = require('./game-lootbox');
      const clickerHandler = require('./clicker');
      const gameLieroHandler = require('./game-liero');
      const gameHorseracingHandler = require('./game-horseracing');
      let gameChessHandler;
      try { gameChessHandler = require('./game-chess'); } catch(e) { gameChessHandler = { init() {} }; }
      let gamePoolHandler;
      try { gamePoolHandler = require('./game-pool'); } catch(e) { gamePoolHandler = { init() {} }; }
      const challengesNsHandler = require('./challenges');

      gameOrbsHandler.init(gamesNs, socket, deps);
      gameCardsHandler.init(gamesNs, socket, deps);
      gameSlotsHandler.init(gamesNs, socket, deps);
      gamePlinkoHandler.init(gamesNs, socket, deps);
      gameCoinflipHandler.init(gamesNs, socket, deps);
      gameScratchHandler.init(gamesNs, socket, deps);
      gameLootboxHandler.init(gamesNs, socket, deps);
      clickerHandler.init(gamesNs, socket, deps);
      gameLieroHandler.init(gamesNs, socket, deps);
      gameHorseracingHandler.init(gamesNs, socket, deps);
      gameChessHandler.init(gamesNs, socket, deps);
      gamePoolHandler.init(gamesNs, socket, deps);
      challengesNsHandler.init(gamesNs, socket, deps);

      socket.on('disconnect', (reason) => {
        ratelimit.decrementConnections();
        console.log('[games-ns] Disconnected: ' + deps.user.name + ' (' + socket.id + ') -- ' + reason);
        // Game-specific cleanup: send disconnect to Worker thread
        // Worker posts back broadcast events handled by server.js message handler
        if (deps.game && typeof deps.game.disconnectCleanup === 'function') {
          deps.game.disconnectCleanup(socket.id);
        }
        // Card game lobby cleanup
        if (deps.lobbyManager) {
          const cardLobbyId = deps.lobbyManager.getPlayerLobbyId(socket.id);
          if (cardLobbyId) {
            const cardLobby = deps.lobbyManager.lobbies.get(cardLobbyId);
            if (cardLobby) {
              const p = cardLobby.players.get(socket.id);
              if (p) deps.saveChipsForSocket(socket.id, p.chips);
            }
            const cardResult = deps.lobbyManager.leaveLobby(socket.id);
            if (cardResult && !cardResult.destroyed) {
              if (deps.lobbyManager.getHumanCount(cardResult.lobbyId) === 0) {
                deps.lobbyManager.removeBots(cardResult.lobbyId);
              }
              const freshLobby = deps.lobbyManager.lobbies.get(cardResult.lobbyId);
              if (freshLobby && freshLobby.state === 'waiting') {
                deps.saveAllLobbyChips(freshLobby);
                deps.lobbyManager.rebuyBrokePlayers(freshLobby);
              }
              if (freshLobby) {
                for (const [pid] of freshLobby.players) {
                  const s = gamesNs.sockets.get(pid) || io.sockets.sockets.get(pid);
                  if (s) s.emit('card_lobby_update', deps.lobbyManager.getLobbyState(cardResult.lobbyId, pid));
                }
              }
              gamesNs.emit('card_lobbies_updated', { lobbies: deps.lobbyManager.getLobbies() });
            } else if (cardResult) {
              gamesNs.emit('card_lobbies_updated', { lobbies: deps.lobbyManager.getLobbies() });
            }
          }
        }
        // Coin flip cleanup
        if (deps.coinFlipManager) {
          const cfResult = deps.coinFlipManager.leaveLobby(socket.id);
          if (cfResult && !cfResult.destroyed) {
            gamesNs.to('cflobby:' + cfResult.lobbyId).emit('cf_lobby_update', deps.coinFlipManager.getLobbyState(cfResult.lobbyId));
          }
          if (cfResult) {
            gamesNs.emit('cf_lobbies_updated', { lobbies: deps.coinFlipManager.getLobbies() });
          }
        }
        // Horse Racing cleanup
        if (deps.horseRacingManager) {
          deps.horseRacingManager.removeSpectator(socket.id);
          socket.leave('horsetrack');
        }
        // Chess cleanup
        if (deps.chessManager) {
          const chessResult = deps.chessManager.leaveLobby(socket.id);
          if (chessResult && !chessResult.destroyed) {
            const chessLobby = deps.chessManager.lobbies.get(chessResult.lobbyId);
            if (chessLobby) {
              for (const [cpid] of chessLobby.players) {
                const cs = gamesNs.sockets.get(cpid) || (io.sockets.sockets ? io.sockets.sockets.get(cpid) : null);
                if (cs) cs.emit('chess_lobby_update', deps.chessManager.getLobbyState(chessResult.lobbyId, cpid));
              }
              if (chessLobby.spectators) {
                for (const [sid] of chessLobby.spectators) {
                  const ss = gamesNs.sockets.get(sid) || (io.sockets.sockets ? io.sockets.sockets.get(sid) : null);
                  if (ss) ss.emit('chess_lobby_update', deps.chessManager.getLobbyState(chessResult.lobbyId, sid));
                }
              }
            }
          }
          // Also check if spectator (leaveSpectator returns non-null if they were one)
          deps.chessManager.leaveSpectator(socket.id);
          // Always emit lobbies update after any chess cleanup (player or spectator)
          gamesNs.emit('chess_lobbies_updated', { lobbies: deps.chessManager.getLobbies() });
        }
        // Pool cleanup
        if (deps.poolManager) {
          const poolResult = deps.poolManager.leaveLobby(socket.id);
          if (poolResult && !poolResult.destroyed) {
            const poolLobby = deps.poolManager.lobbies.get(poolResult.lobbyId);
            if (poolLobby) {
              if (poolLobby.state === 'finished' && poolLobby.result && poolLobby.result.winner) {
                // Award chips to winner on disconnect
                const winId = poolLobby.result.winner;
                const wAccKey = deps.socketAccountMap.get(winId);
                if (wAccKey) {
                  const reward = 75 + (poolLobby.bet || 0) * 2;
                  const nc = deps.accounts.updateChips(wAccKey, reward);
                  const ws = gamesNs.sockets.get(winId) || (io.sockets.sockets ? io.sockets.sockets.get(winId) : null);
                  if (ws && nc !== null) ws.emit('chips_updated', { chips: nc, reason: 'Pool win! +' + reward });
                }
              }
              for (const [pid] of poolLobby.players) {
                const ps = gamesNs.sockets.get(pid) || (io.sockets.sockets ? io.sockets.sockets.get(pid) : null);
                if (ps) ps.emit('pool_lobby_update', deps.poolManager.getLobbyState(poolResult.lobbyId, pid));
              }
              for (const [sid] of poolLobby.spectators) {
                const ss = gamesNs.sockets.get(sid) || (io.sockets.sockets ? io.sockets.sockets.get(sid) : null);
                if (ss) ss.emit('pool_lobby_update', deps.poolManager.getLobbyState(poolResult.lobbyId, sid));
              }
            }
          }
          // Also check if spectator
          deps.poolManager.leaveSpectator(socket.id);
          // Always emit lobbies update after any pool cleanup (player or spectator)
          gamesNs.emit('pool_lobbies_updated', { lobbies: deps.poolManager.getLobbies() });
        }
        // BossBrawl (Liero) cleanup handled by Worker via game.disconnectCleanup() above
        // Clear liero proxy cache
        if (deps.lieroManager && typeof deps.lieroManager._playerLobbies === 'object') {
          deps.lieroManager._playerLobbies.delete(socket.id);
        }
      });
    });

    return gamesNs;
  }
};
