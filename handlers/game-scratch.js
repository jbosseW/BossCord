// handlers/game-scratch.js (Lucky Scrolls)
// Socket handlers: scratch_buy, scratch_load_upgrades, scratch_upgrade (Lucky Scrolls)

const SCRATCH_UPGRADES = [
  { id: 'scratchSymbolTier', name: 'Rare Symbols',     desc: 'Unlock rarer scroll symbols',    baseCost: 500,   costMult: 3.0, maxLevel: 3 },
  { id: 'scratchWinChance',  name: 'Lucky Scroll',    desc: '+2% win chance per level',         baseCost: 400,   costMult: 2.0, maxLevel: 10 },
  { id: 'scratchLootChance', name: 'Treasure Scroll',  desc: '+1.5% loot chance per level',    baseCost: 600,   costMult: 2.0, maxLevel: 10 },
  { id: 'scratchDiscount',   name: 'Bulk Buyer',       desc: '-3% scroll cost per level',          baseCost: 300,   costMult: 1.8, maxLevel: 10 },
  { id: 'scratchMultiBoost', name: 'Big Wins',         desc: '+5% to all symbol multipliers',    baseCost: 1000,  costMult: 2.5, maxLevel: 5 },
  { id: 'scratchAutoReveal', name: 'X-Ray Vision',     desc: 'Auto-reveal all cells on win',     baseCost: 2000,  costMult: 1.0, maxLevel: 1 },
];

const SCRATCH_UPGRADE_MAP = {};
for (var su = 0; su < SCRATCH_UPGRADES.length; su++) {
  SCRATCH_UPGRADE_MAP[SCRATCH_UPGRADES[su].id] = SCRATCH_UPGRADES[su];
}

function scratchUpgradeCost(upgrade, level) {
  return Math.floor(upgrade.baseCost * Math.pow(upgrade.costMult, level));
}

module.exports = {
  SCRATCH_UPGRADES: SCRATCH_UPGRADES,

  init(io, socket, deps) {
    var { socketAccountMap, accounts, loot, checkEventRate } = deps;
    var crypto = require('crypto');

    // ------------------------------------------------------------------
    // Load upgrade levels
    // ------------------------------------------------------------------
    socket.on('scratch_load_upgrades', () => {
      try {
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('scratch_upgrades', { levels: {}, definitions: SCRATCH_UPGRADES }); return; }
        var levels = accounts.getScratchUpgrades(key);
        socket.emit('scratch_upgrades', { levels: levels, definitions: SCRATCH_UPGRADES });
      } catch (err) {
        console.error('[scratch_load_upgrades] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Buy an upgrade
    // ------------------------------------------------------------------
    socket.on('scratch_upgrade', (data) => {
      try {
        if (!data || typeof data.upgradeId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to upgrade' }); return; }
        if (!checkEventRate(socket, 'scratch_upgrade', 20, 60000)) return;

        var upgrade = SCRATCH_UPGRADE_MAP[data.upgradeId];
        if (!upgrade) { socket.emit('error', { message: 'Unknown upgrade' }); return; }

        var levels = accounts.getScratchUpgrades(key);
        var currentLevel = levels[upgrade.id] || 0;
        if (currentLevel >= upgrade.maxLevel) {
          socket.emit('error', { message: upgrade.name + ' is already max level' }); return;
        }

        var cost = scratchUpgradeCost(upgrade, currentLevel);
        var acc = accounts.loadAccount(key);
        if (!acc || acc.chips < cost) {
          socket.emit('error', { message: 'Not enough chips (need ' + cost + ')' }); return;
        }

        var newChips = accounts.updateChips(key, -cost);
        if (newChips === null) { socket.emit('error', { message: 'Account error' }); return; }
        levels[upgrade.id] = currentLevel + 1;
        accounts.updateScratchUpgrades(key, levels);
        socket.emit('scratch_upgrades', { levels: levels, definitions: SCRATCH_UPGRADES });
        socket.emit('chips_updated', { chips: newChips, reason: 'Scroll upgrade: ' + upgrade.name + ' Lv' + levels[upgrade.id] });
      } catch (err) {
        console.error('[scratch_upgrade] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Lucky Scroll: buy and generate (with upgrades applied)
    // ------------------------------------------------------------------
    socket.on('scratch_buy', (data) => {
      try {
        if (!data || typeof data.tier !== 'string') return;
        if (data.tier.length > 20) return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to play Lucky Scrolls' }); return; }
        if (!checkEventRate(socket, 'scratch_buy', 30, 60000)) return;
        const tier = loot.SCRATCH_TIERS[data.tier];
        if (!tier) { socket.emit('error', { message: 'Invalid scroll tier' }); return; }

        // Load upgrades and calculate effective cost
        var upgrades = accounts.getScratchUpgrades(key);
        var discountMult = 1 - Math.min(0.30, (upgrades.scratchDiscount || 0) * 0.03);
        var effectiveCost = Math.max(1, Math.floor(tier.cost * discountMult));

        const acc = accounts.loadAccount(key);
        if (!acc || acc.chips < effectiveCost) { socket.emit('error', { message: 'Not enough chips' }); return; }

        // Deduct effective cost
        accounts.updateChips(key, -effectiveCost);

        // Generate card with upgrades
        const card = loot.generateScratchCard(data.tier, upgrades);
        if (!card) { accounts.updateChips(key, effectiveCost); socket.emit('error', { message: 'Failed to generate card' }); return; }

        // Add loot item to inventory if present
        if (card.lootItem) {
          accounts.addInventoryItem(key, card.lootItem);
        }
        // Add winnings
        if (card.winnings > 0) accounts.updateChips(key, card.winnings);
        // Key drop on scroll win
        if (card.isWin) {
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
        const accAfterScratch = accounts.loadAccount(key);
        const newChips = accAfterScratch ? accAfterScratch.chips : 0;
        socket.emit('scratch_card', card);
        socket.emit('chips_updated', { chips: newChips, reason: card.isWin && card.winSymbol ? 'Scroll ' + card.winSymbol.multiplier + 'x! +' + card.profit : 'Scroll' });
      } catch (err) {
        console.error('[scratch_buy] Error:', err.message);
      }
    });
  }
};
