// handlers/stocks.js
// Socket handlers: stock_market_get, stock_market_subscribe,
//                  stock_market_unsubscribe, stock_buy, stock_sell,
//                  stock_portfolio_get

module.exports = {
  init(io, socket, deps) {
    var { socketAccountMap, accounts, stockMarket, checkEventRate } = deps;

    // ------------------------------------------------------------------
    // Stock Market: get market state
    // ------------------------------------------------------------------
    socket.on('stock_market_get', () => {
      try {
        if (!checkEventRate(socket, 'stock_market_get', 30, 60000)) return;
        socket.emit('stock_market_data', stockMarket.getMarketState());
      } catch (err) {
        console.error('[stock_market_get] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Stock Market: subscribe to live updates
    // ------------------------------------------------------------------
    socket.on('stock_market_subscribe', () => {
      if (!checkEventRate(socket, 'stock_market_subscribe', 30, 60000)) return;
      socket.join('stock_market');
      socket.emit('stock_market_data', stockMarket.getMarketState());
    });

    socket.on('stock_market_unsubscribe', () => {
      if (!checkEventRate(socket, 'stock_unsub', 10, 60000)) return;
      socket.leave('stock_market');
    });

    // ------------------------------------------------------------------
    // Stock Market: buy stock
    // ------------------------------------------------------------------
    socket.on('stock_buy', (data) => {
      try {
        if (!data || typeof data.stockId !== 'string' || typeof data.shares !== 'number') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('stock_trade_result', { error: 'Need an account to trade stocks' }); return; }
        if (!checkEventRate(socket, 'stock_trade', 30, 60000)) return; // max 30 trades/min
        var shares = Math.floor(data.shares);
        if (!isFinite(shares) || shares < 1) return;
        const acc = accounts.loadAccount(key);
        if (!acc) return;
        const stock = stockMarket.getStockInfo(data.stockId);
        if (!stock) { socket.emit('stock_trade_result', { error: 'Stock not found' }); return; }
        const totalCost = Math.ceil(stock.price * shares);
        if (acc.chips < totalCost) { socket.emit('stock_trade_result', { error: 'Not enough chips. Need ' + totalCost.toLocaleString() }); return; }
        // Deduct chips BEFORE adding shares (validate-then-execute pattern)
        var postDeductBalance = accounts.updateChips(key, -totalCost);
        if (postDeductBalance === null) { socket.emit('stock_trade_result', { error: 'Account error' }); return; }
        const result = stockMarket.buyStock(key, data.stockId, shares, postDeductBalance);
        if (result.error) {
          // Refund chips since share purchase failed
          accounts.updateChips(key, totalCost);
          socket.emit('stock_trade_result', { error: result.error });
          return;
        }
        // Adjust if actual cost differs from estimated cost (price moved)
        const costDiff = result.totalCost - totalCost;
        var newChips;
        if (costDiff > 0) {
          // Price went up -- verify balance can cover difference before deducting
          const accCheck = accounts.loadAccount(key);
          if (!accCheck || accCheck.chips < costDiff) {
            // Refund original deduction and reverse stock purchase
            accounts.updateChips(key, totalCost);
            stockMarket.sellStock(key, data.stockId, result.shares);
            socket.emit('stock_trade_result', { error: 'Price moved, not enough chips' });
            return;
          }
          newChips = accounts.updateChips(key, -costDiff);
        } else if (costDiff < 0) {
          // Price went down -- refund the difference
          newChips = accounts.updateChips(key, -costDiff);
        } else {
          const accAfter = accounts.loadAccount(key);
          newChips = accAfter ? accAfter.chips : 0;
        }
        if (newChips === null) newChips = 0;
        socket.emit('stock_trade_result', { action: 'buy', ...result, chips: newChips });
        socket.emit('chips_updated', { chips: newChips, reason: 'Bought ' + result.shares + ' ' + data.stockId + ' @ ' + Math.round(result.pricePerShare) });
        socket.emit('stock_portfolio_data', stockMarket.getPortfolio(key));
      } catch (err) {
        console.error('[stock_buy] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Stock Market: sell stock
    // ------------------------------------------------------------------
    socket.on('stock_sell', (data) => {
      try {
        if (!data || typeof data.stockId !== 'string' || typeof data.shares !== 'number') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('stock_trade_result', { error: 'Need an account to trade stocks' }); return; }
        if (!checkEventRate(socket, 'stock_trade', 30, 60000)) return; // shared bucket with buy
        var shares = Math.floor(data.shares);
        if (!isFinite(shares) || shares < 1) return;
        const result = stockMarket.sellStock(key, data.stockId, shares);
        if (result.error) { socket.emit('stock_trade_result', { error: result.error }); return; }
        const newChips = accounts.updateChips(key, result.totalProceeds);
        const safeChips = newChips !== null ? newChips : 0;
        socket.emit('stock_trade_result', { action: 'sell', ...result, chips: safeChips });
        socket.emit('chips_updated', { chips: safeChips, reason: 'Sold ' + result.shares + ' ' + data.stockId + (result.profit >= 0 ? ' +' + result.profit : ' ' + result.profit) });
        socket.emit('stock_portfolio_data', stockMarket.getPortfolio(key));
      } catch (err) {
        console.error('[stock_sell] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Stock Market: get portfolio
    // ------------------------------------------------------------------
    socket.on('stock_portfolio_get', () => {
      try {
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('stock_portfolio_data', { holdings: [], totalValue: 0, totalCost: 0, totalProfit: 0 }); return; }
        socket.emit('stock_portfolio_data', stockMarket.getPortfolio(key));
      } catch (err) {
        console.error('[stock_portfolio_get] Error:', err.message);
      }
    });
  }
};
