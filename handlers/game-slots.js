// handlers/game-slots.js
// Socket handlers: slot_spin, slot_load_upgrades, slot_upgrade

const crypto = require('crypto');

const BASE_MAX_BET = 10000;
const MAX_PAYOUT = 1000000; // hard cap: 1M chips per spin

// All slot symbols — some require symbolTier upgrades to unlock
const ALL_SLOT_SYMBOLS = [
  // tier 0 — always available
  { emoji: '\uD83C\uDF52', name: 'Cherry',    multi3: 5,    tier: 0 },
  { emoji: '\uD83C\uDF4B', name: 'Lemon',     multi3: 5,    tier: 0 },
  { emoji: '\uD83C\uDF4A', name: 'Orange',    multi3: 10,   tier: 0 },
  { emoji: '\uD83D\uDD14', name: 'Bell',      multi3: 15,   tier: 0 },
  { emoji: '\u2B50',       name: 'Star',      multi3: 20,   tier: 0 },
  { emoji: '\uD83D\uDC8E', name: 'Diamond',   multi3: 50,   tier: 0 },
  { emoji: '7\uFE0F\u20E3', name: 'Seven',    multi3: 100,  tier: 0 },
  // tier 1+
  { emoji: '\uD83D\uDC51', name: 'Crown',     multi3: 150,  tier: 1 },
  { emoji: '\uD83D\uDCB0', name: 'Gold Bag',  multi3: 200,  tier: 2 },
  { emoji: '\uD83C\uDFC6', name: 'Trophy',    multi3: 300,  tier: 3 },
  { emoji: '\uD83D\uDC09', name: 'Dragon',    multi3: 400,  tier: 3 },
  { emoji: '\uD83D\uDD25', name: 'Phoenix',   multi3: 500,  tier: 4 },
  { emoji: '\uD83D\uDC80', name: 'Boss',      multi3: 750,  tier: 4 },
  // wild — requires wildUnlock upgrade
  { emoji: '\uD83C\uDCCF', name: 'Wild',      multi3: 0,    tier: -1, isWild: true },
];

// Upgrade definitions
const SLOT_UPGRADES = [
  { id: 'symbolTier',  name: 'Symbol Tier',   desc: 'Unlock higher-value symbols',       baseCost: 500,   costMult: 3.0, maxLevel: 4 },
  { id: 'maxBet',      name: 'High Roller',   desc: 'Increase maximum bet (+5000/lv)',    baseCost: 1000,  costMult: 1.8, maxLevel: 10 },
  { id: 'pairBoost',   name: 'Pair Boost',    desc: 'Pair payout +1x per level',         baseCost: 300,   costMult: 2.0, maxLevel: 8 },
  { id: 'cherryBoost', name: 'Cherry Power',  desc: 'Cherry payout +0.5x per level',     baseCost: 200,   costMult: 1.8, maxLevel: 10 },
  { id: 'luckyCharm',  name: 'Lucky Charm',   desc: 'Weight reels toward rarer symbols',  baseCost: 2000,  costMult: 2.0, maxLevel: 5 },
  { id: 'miniBonus',   name: 'Bonus Round',   desc: '4% chance per lv for free re-spin',  baseCost: 1500,  costMult: 2.0, maxLevel: 5 },
  { id: 'wildUnlock',  name: 'Wild Card',     desc: 'Unlock wild symbol (matches any)',   baseCost: 5000,  costMult: 1.0, maxLevel: 1 },
  { id: 'jackpotBoost',name: 'Jackpot Boost', desc: '+10% jackpot multiplier per level',  baseCost: 3000,  costMult: 2.0, maxLevel: 5 },
];

const SLOT_UPGRADE_MAP = {};
for (var su = 0; su < SLOT_UPGRADES.length; su++) {
  SLOT_UPGRADE_MAP[SLOT_UPGRADES[su].id] = SLOT_UPGRADES[su];
}

function slotUpgradeCost(upgrade, level) {
  return Math.floor(upgrade.baseCost * Math.pow(upgrade.costMult, level));
}

function getActiveSymbols(upgrades) {
  var symbolTier = upgrades.symbolTier || 0;
  var hasWild = (upgrades.wildUnlock || 0) >= 1;
  return ALL_SLOT_SYMBOLS.filter(function(s) {
    if (s.isWild) return hasWild;
    return s.tier <= symbolTier;
  });
}

function rollWeightedSymbol(symbols, luckyCharmLevel) {
  // Base equal weight, with luckyCharm adding bonus weight to rarer symbols
  if (!luckyCharmLevel || luckyCharmLevel <= 0) {
    return symbols[crypto.randomInt(symbols.length)];
  }
  // Build weighted pool: base weight 10 for each, +luckyCharmLevel for top half by multi3
  var sorted = symbols.slice().sort(function(a, b) { return b.multi3 - a.multi3; });
  var topCount = Math.max(1, Math.floor(sorted.length / 2));
  var topSet = new Set(sorted.slice(0, topCount).map(function(s) { return s.name; }));

  var weights = symbols.map(function(s) {
    return { value: s, weight: topSet.has(s.name) ? 10 + luckyCharmLevel : 10 };
  });
  var total = weights.reduce(function(sum, w) { return sum + w.weight; }, 0);
  var r = (crypto.randomBytes(4).readUInt32BE(0) / 0x100000000) * total;
  for (var i = 0; i < weights.length; i++) {
    r -= weights[i].weight;
    if (r <= 0) return weights[i].value;
  }
  return weights[weights.length - 1].value;
}

function rollSlotReel(symbols, luckyCharmLevel) {
  return [
    rollWeightedSymbol(symbols, luckyCharmLevel),
    rollWeightedSymbol(symbols, luckyCharmLevel),
    rollWeightedSymbol(symbols, luckyCharmLevel)
  ];
}

// Wild matching: treat Wild as matching any other symbol
function symbolsMatch(a, b) {
  if (a.isWild || b.isWild) return true;
  return a.name === b.name;
}

function allThreeMatch(mid) {
  return symbolsMatch(mid[0], mid[1]) && symbolsMatch(mid[1], mid[2]);
}

function anyPairMatch(mid) {
  return symbolsMatch(mid[0], mid[1]) || symbolsMatch(mid[1], mid[2]) || symbolsMatch(mid[0], mid[2]);
}

// For jackpot, determine which non-wild symbol to use for multiplier
function getJackpotSymbol(mid) {
  for (var i = 0; i < 3; i++) {
    if (!mid[i].isWild) return mid[i];
  }
  return mid[0]; // all wilds (extremely rare)
}

// Evaluate a single payline (array of 3 symbols) and return win info or null
function evaluatePayline(line, pairMulti, cherryMulti, jackpotBoostMult) {
  if (allThreeMatch(line)) {
    var jackSymbol = getJackpotSymbol(line);
    var jackpotMulti = Math.floor(jackSymbol.multi3 * jackpotBoostMult);
    if (jackSymbol.isWild) jackpotMulti = Math.floor(50 * jackpotBoostMult);
    return { type: 'jackpot', multiplier: jackpotMulti, symbol: jackSymbol };
  } else if (anyPairMatch(line)) {
    return { type: 'small', multiplier: pairMulti, symbol: null };
  } else if (line[0].name === 'Cherry' || line[1].name === 'Cherry' || line[2].name === 'Cherry') {
    return { type: 'cherry', multiplier: cherryMulti, symbol: null };
  }
  return null;
}

// Evaluate all 3 paylines on a set of reels and return combined results
// paylineMultipliers: top=0.5x, middle=1x, bottom=0.5x
function evaluateAllLines(finalReels, pairMulti, cherryMulti, jackpotBoostMult) {
  var PAYLINE_NAMES = ['top', 'middle', 'bottom'];
  var PAYLINE_MULTS = [0.5, 1.0, 0.5];
  var lines = [
    [finalReels[0][0], finalReels[1][0], finalReels[2][0]], // top
    [finalReels[0][1], finalReels[1][1], finalReels[2][1]], // middle
    [finalReels[0][2], finalReels[1][2], finalReels[2][2]]  // bottom
  ];

  var winLines = [];
  var totalMultiplier = 0;
  var messages = [];
  var bestType = null; // track the best win type for display

  for (var i = 0; i < 3; i++) {
    var lineResult = evaluatePayline(lines[i], pairMulti, cherryMulti, jackpotBoostMult);
    if (lineResult) {
      var effectiveMult = lineResult.multiplier * PAYLINE_MULTS[i];
      totalMultiplier += effectiveMult;
      winLines.push(PAYLINE_NAMES[i]);

      var lineLabel = PAYLINE_NAMES[i].charAt(0).toUpperCase() + PAYLINE_NAMES[i].slice(1);
      if (lineResult.type === 'jackpot') {
        messages.push(lineLabel + ': 3x ' + lineResult.symbol.emoji + ' ' + effectiveMult + 'x!');
        if (!bestType || bestType !== 'jackpot') bestType = 'jackpot';
      } else if (lineResult.type === 'small') {
        messages.push(lineLabel + ': Pair ' + effectiveMult + 'x');
        if (!bestType) bestType = 'small';
      } else if (lineResult.type === 'cherry') {
        messages.push(lineLabel + ': \uD83C\uDF52 Cherry ' + effectiveMult + 'x');
        if (!bestType) bestType = 'cherry';
      }
    }
  }

  if (winLines.length === 0) return null;

  return {
    type: bestType,
    multiplier: totalMultiplier,
    message: messages.join(' | '),
    winLines: winLines
  };
}

module.exports = {
  SLOT_UPGRADES: SLOT_UPGRADES,
  ALL_SLOT_SYMBOLS: ALL_SLOT_SYMBOLS,

  init(io, socket, deps) {
    var { socketAccountMap, accounts, loot, checkEventRate, challengesHandler } = deps;
    var spinInProgress = false; // per-socket spin lock

    // ------------------------------------------------------------------
    // Load upgrade levels
    // ------------------------------------------------------------------
    socket.on('slot_load_upgrades', () => {
      try {
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('slot_upgrades', { levels: {}, definitions: SLOT_UPGRADES }); return; }
        var levels = accounts.getSlotUpgrades(key);
        socket.emit('slot_upgrades', { levels: levels, definitions: SLOT_UPGRADES });
      } catch (err) {
        console.error('[slot_load_upgrades] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Buy an upgrade
    // ------------------------------------------------------------------
    socket.on('slot_upgrade', (data) => {
      try {
        if (!data || typeof data.upgradeId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to upgrade' }); return; }
        if (!checkEventRate(socket, 'slot_upgrade', 20, 60000)) return;

        var upgrade = SLOT_UPGRADE_MAP[data.upgradeId];
        if (!upgrade) { socket.emit('error', { message: 'Unknown upgrade' }); return; }

        var levels = accounts.getSlotUpgrades(key);
        var currentLevel = levels[upgrade.id] || 0;
        if (currentLevel >= upgrade.maxLevel) {
          socket.emit('error', { message: upgrade.name + ' is already max level' }); return;
        }

        var cost = slotUpgradeCost(upgrade, currentLevel);
        var acc = accounts.loadAccount(key);
        if (!acc || acc.chips < cost) {
          socket.emit('error', { message: 'Not enough chips (need ' + cost + ')' }); return;
        }

        var newChips = accounts.updateChips(key, -cost);
        if (newChips === null) { socket.emit('error', { message: 'Account error' }); return; }
        levels[upgrade.id] = currentLevel + 1;
        accounts.updateSlotUpgrades(key, levels);
        socket.emit('slot_upgrades', { levels: levels, definitions: SLOT_UPGRADES });
        socket.emit('chips_updated', { chips: newChips, reason: 'Slot upgrade: ' + upgrade.name + ' Lv' + levels[upgrade.id] });
      } catch (err) {
        console.error('[slot_upgrade] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Spin
    // ------------------------------------------------------------------
    socket.on('slot_spin', (data) => {
      try {
        if (spinInProgress) { socket.emit('error', { message: 'Spin in progress' }); return; }
        spinInProgress = true;
        if (!data || typeof data.bet !== 'number') { spinInProgress = false; return; }
        const key = socketAccountMap.get(socket.id);
        if (!key) { spinInProgress = false; socket.emit('error', { message: 'Need an account to play slots' }); return; }
        if (!checkEventRate(socket, 'slot_spin', 60, 60000)) { spinInProgress = false; return; }
        if (!isFinite(data.bet) || data.bet < 1) { spinInProgress = false; return; }

        // Load upgrades
        var upgrades = accounts.getSlotUpgrades(key);
        var maxBet = BASE_MAX_BET + (upgrades.maxBet || 0) * 5000;
        var betAmount = Math.max(1, Math.min(maxBet, Math.floor(data.bet)));

        var acc = accounts.loadAccount(key);
        if (!acc || acc.chips < betAmount) { socket.emit('error', { message: 'Not enough chips' }); return; }

        // Deduct bet
        var deductResult = accounts.updateChips(key, -betAmount);
        if (deductResult === null) { socket.emit('error', { message: 'Account error' }); return; }

        // Get active symbol pool
        var symbols = getActiveSymbols(upgrades);
        var luckyCharm = upgrades.luckyCharm || 0;

        // Roll reels
        var finalReels = [rollSlotReel(symbols, luckyCharm), rollSlotReel(symbols, luckyCharm), rollSlotReel(symbols, luckyCharm)];

        var pairMulti = 2 + (upgrades.pairBoost || 0);
        var cherryMulti = 1 + (upgrades.cherryBoost || 0) * 0.5;
        var jackpotBoostMult = 1 + (upgrades.jackpotBoost || 0) * 0.10;

        // Evaluate all 3 paylines (top 0.5x, middle 1x, bottom 0.5x)
        var winResult = evaluateAllLines(finalReels, pairMulti, cherryMulti, jackpotBoostMult);

        // Bonus round: free re-spin on loss
        var bonusReSpin = false;
        if (!winResult && (upgrades.miniBonus || 0) > 0) {
          if (crypto.randomInt(100) < (upgrades.miniBonus) * 4) {
            bonusReSpin = true;
            // Re-roll
            finalReels = [rollSlotReel(symbols, luckyCharm), rollSlotReel(symbols, luckyCharm), rollSlotReel(symbols, luckyCharm)];

            winResult = evaluateAllLines(finalReels, pairMulti, cherryMulti, jackpotBoostMult);
            if (winResult) {
              winResult.message = 'BONUS! ' + winResult.message;
            }
          }
        }

        var winAmount = 0;
        var slotKeyDrop = null;
        if (winResult) {
          winAmount = Math.min(MAX_PAYOUT, Math.floor(betAmount * winResult.multiplier));
          accounts.updateChips(key, winAmount);
          // Key drop on win
          var keyDrop = loot.rollKeyDrop();
          if (keyDrop) {
            var keyInstance = {
              instanceId: crypto.randomBytes(6).toString('hex'),
              itemId: keyDrop.id,
              obtainedAt: Date.now(),
              source: 'game_drop'
            };
            accounts.addInventoryItem(key, keyInstance);
            slotKeyDrop = {
              key: { id: keyDrop.id, name: keyDrop.name, rarity: keyDrop.rarity, img: keyDrop.img },
              instanceId: keyInstance.instanceId
            };
            socket.emit('key_drop', slotKeyDrop);
          }
        }

        var accAfterSpin = accounts.loadAccount(key);
        var newChips = accAfterSpin ? accAfterSpin.chips : 0;
        socket.emit('slot_result', {
          reels: finalReels,
          win: !!winResult,
          winAmount: winAmount,
          message: winResult ? winResult.message : 'No luck this time',
          winLines: winResult ? winResult.winLines : [],
          winType: winResult ? winResult.type : null,
          chips: newChips,
          bonusReSpin: bonusReSpin,
        });
        socket.emit('chips_updated', { chips: newChips, reason: winResult ? 'Slots win! +' + winAmount : 'Slots spin' });

        // Track challenge progress and achievements for slots
        if (challengesHandler && winResult) {
          challengesHandler.trackChallengeProgress(accounts, key, 'chips_earned', winAmount);
          challengesHandler.trackChallengeProgress(accounts, key, 'unique_games_played', 0); // tracked separately
          // Jackpot achievement
          if (winResult.type === 'jackpot') {
            challengesHandler.checkAchievement(accounts, key, 'jackpot');
          }
        }
        spinInProgress = false;
      } catch (err) {
        spinInProgress = false;
        console.error('[slot_spin] Error:', err.message);
      }
    });
  }
};
