// handlers/game-lootbox.js
// Socket handlers: lootbox_buy

module.exports = {
  init(io, socket, deps) {
    var { socketAccountMap, accounts, loot, checkEventRate, challengesHandler } = deps;
    var buyInProgress = false; // per-socket lock to prevent concurrent purchases

    // ------------------------------------------------------------------
    // Lootbox: buy and open
    // ------------------------------------------------------------------
    socket.on('lootbox_buy', (data) => {
      try {
        if (buyInProgress) { socket.emit('error', { message: 'Purchase in progress' }); return; }
        buyInProgress = true;
        if (!data || typeof data.tier !== 'string') { buyInProgress = false; return; }
        if (data.tier.length > 20) { buyInProgress = false; return; }
        const key = socketAccountMap.get(socket.id);
        if (!key) { buyInProgress = false; socket.emit('error', { message: 'Need an account to buy lootboxes' }); return; }
        if (!checkEventRate(socket, 'lootbox_buy', 20, 60000)) { buyInProgress = false; return; }
        const boxTier = loot.LOOTBOX_TIERS[data.tier];
        if (!boxTier) { buyInProgress = false; socket.emit('error', { message: 'Invalid lootbox tier' }); return; }
        const acc = accounts.loadAccount(key);
        if (!acc || acc.chips < boxTier.cost) { buyInProgress = false; socket.emit('error', { message: 'Not enough chips' }); return; }
        // Deduct cost
        accounts.updateChips(key, -boxTier.cost);
        // Open box
        const result = loot.openLootbox(data.tier);
        if (!result) { accounts.updateChips(key, boxTier.cost); buyInProgress = false; socket.emit('error', { message: 'Failed to open lootbox' }); return; }
        // Add items to inventory
        for (const item of result.items) {
          const addResult = accounts.addInventoryItem(key, item);
          if (addResult && addResult.error) {
            socket.emit('error', { message: addResult.error });
            break;
          }
        }
        const accAfterLootbox = accounts.loadAccount(key);
        const newChips = accAfterLootbox ? accAfterLootbox.chips : 0;
        socket.emit('lootbox_result', result);
        socket.emit('chips_updated', { chips: newChips, reason: 'Opened ' + boxTier.name });

        // Track challenge progress for lootbox opens
        if (challengesHandler) {
          challengesHandler.trackChallengeProgress(accounts, key, 'lootboxes_opened', 1);
        }
        buyInProgress = false;
      } catch (err) {
        buyInProgress = false;
        console.error('[lootbox_buy] Error:', err.message);
      }
    });
  }
};
