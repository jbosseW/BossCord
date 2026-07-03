// handlers/game-plinko.js
// Socket handlers: plinko_drop, plinko_config

module.exports = {
  init(io, socket, deps) {
    var { socketAccountMap, accounts, plinko, loot, checkEventRate } = deps;
    var crypto = require('crypto');

    // ------------------------------------------------------------------
    // Plinko: drop ball
    // ------------------------------------------------------------------
    socket.on('plinko_drop', (data) => {
      try {
        if (!checkEventRate(socket, 'plinko_drop', 30, 60000)) return;
        if (!data || typeof data.bet !== 'number') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('error', { message: 'Need an account to play Plinko' });
          return;
        }
        const acc = accounts.loadAccount(key);
        if (!acc) return;
        const bet = Math.floor(data.bet);
        if (bet < plinko.MIN_BET || bet > plinko.MAX_BET) {
          socket.emit('error', { message: 'Bet must be between ' + plinko.MIN_BET + ' and ' + plinko.MAX_BET + ' chips' });
          return;
        }
        if (acc.chips < bet) {
          socket.emit('error', { message: 'Not enough chips' });
          return;
        }
        // Deduct bet
        var deductResult = accounts.updateChips(key, -bet);
        if (deductResult === null) { socket.emit('error', { message: 'Account error' }); return; }
        // Server-side drop
        const result = plinko.drop();
        const winnings = plinko.payout(bet, result.multiplier);
        // Add winnings
        if (winnings > 0) accounts.updateChips(key, winnings);
        // Key drop on decent win (multiplier >= 2)
        if (result.multiplier >= 2) {
          var keyDrop = loot.rollKeyDrop();
          if (keyDrop) {
            var keyInstance = {
              instanceId: crypto.randomBytes(6).toString('hex'),
              itemId: keyDrop.id,
              obtainedAt: Date.now(),
              source: 'game_drop'
            };
            accounts.addInventoryItem(key, keyInstance);
            socket.emit('key_drop', {
              key: { id: keyDrop.id, name: keyDrop.name, rarity: keyDrop.rarity, img: keyDrop.img },
              instanceId: keyInstance.instanceId
            });
          }
        }
        const accAfterPlinko = accounts.loadAccount(key);
        const newChips = accAfterPlinko ? accAfterPlinko.chips : 0;
        socket.emit('plinko_result', {
          path: result.path,
          slotIndex: result.slotIndex,
          multiplier: result.multiplier,
          bet: bet,
          winnings: winnings,
          profit: winnings - bet,
          chips: newChips,
        });
        socket.emit('chips_updated', { chips: newChips, reason: result.multiplier >= 1 ? 'Plinko ' + result.multiplier + 'x! +' + (winnings - bet) : 'Plinko ' + result.multiplier + 'x' });
      } catch (err) {
        console.error('[plinko_drop] Error:', err.message);
      }
    });

    // Plinko: get config
    socket.on('plinko_config', () => {
      if (!checkEventRate(socket, 'plinko_config', 30, 60000)) return;
      socket.emit('plinko_config', {
        rows: plinko.ROWS,
        multipliers: plinko.MULTIPLIERS,
        minBet: plinko.MIN_BET,
        maxBet: plinko.MAX_BET,
      });
    });
  }
};
