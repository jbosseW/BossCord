// handlers/namespace-market.js
// Sets up the /market Socket.IO namespace for market-related events:
//   Stocks, auction house, TCG (packs, cards, battles, trades)

const ratelimit = require('../ratelimit');

module.exports = {
  /**
   * @param {import('socket.io').Server} io
   * @param {Function} depsFactory - (socket, accountKey) => deps object or null
   * @param {Map} sessionTokens - Map<token, { accountKey, socketId, ip, createdAt }>
   * @returns {import('socket.io').Namespace}
   */
  setup(io, depsFactory, sessionTokens) {
    const marketNs = io.of('/market');

    marketNs.on('connection', (socket) => {
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
      if (!ratelimit.check(clientIp, 'ns_market_connect', 20, 3600000)) {
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

      console.log('[market-ns] Connected: ' + deps.user.name + ' (' + socket.id + ')');

      // Register market handler modules
      const tcgHandler = require('./tcg');
      const stocksHandler = require('./stocks');
      const auctionHandler = require('./auction');

      tcgHandler.init(marketNs, socket, deps);
      stocksHandler.init(marketNs, socket, deps);
      auctionHandler.init(marketNs, socket, deps);

      socket.on('disconnect', (reason) => {
        ratelimit.decrementConnections();
        console.log('[market-ns] Disconnected: ' + deps.user.name + ' (' + socket.id + ') -- ' + reason);
        // TCG table cleanup
        if (deps.tcgTableManager) {
          const tableResult = deps.tcgTableManager.leaveTable(socket.id);
          if (tableResult) {
            var table = tableResult.table;
            if (tableResult.removed && tableResult.guestSocketId) {
              var guestSock = marketNs.sockets.get(tableResult.guestSocketId) || io.sockets.sockets.get(tableResult.guestSocketId);
              if (guestSock) guestSock.emit('tcg_table_closed', { reason: 'Host disconnected' });
            } else if (!tableResult.removed && table && table.host) {
              var hostSock = marketNs.sockets.get(table.host.socketId) || io.sockets.sockets.get(table.host.socketId);
              if (hostSock) {
                var updatedTable = deps.tcgTableManager.getTable(table.id);
                if (updatedTable) hostSock.emit('tcg_table_updated', updatedTable);
              }
            }
            marketNs.emit('tcg_table_list', { tables: deps.tcgTableManager.getOpenTables() });
          }
        }
        // TCG battle cleanup
        if (deps.tcgBattleManager) {
          const tcgResult = deps.tcgBattleManager.leaveBattle(socket.id);
          if (tcgResult && tcgResult.battle) {
            for (const [pid] of tcgResult.battle.players) {
              if (pid !== socket.id) {
                const s = marketNs.sockets.get(pid) || io.sockets.sockets.get(pid);
                if (s) s.emit('tcg_battle_update', deps.tcgBattleManager.getBattleState(tcgResult.battle.id, pid));
              }
            }
          }
        }
        // TCG trade cleanup
        if (deps.tcgTradeManager) {
          deps.tcgTradeManager.cancel(socket.id);
        }
      });
    });

    return marketNs;
  }
};
