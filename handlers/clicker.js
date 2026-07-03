// handlers/clicker.js
// Socket handlers: clicker_load, clicker_save, clicker_collect, clicker_use_account_chips

// ── Server-side clicker upgrade definitions (must mirror client) ──
var CLICKER_UPGRADES = [
  { id: 'clickPower', baseValue: 1, valueMult: 1 },
  { id: 'autoClick', baseValue: 0, valueMult: 0.5 },
  { id: 'idleIncome', baseValue: 0, valueMult: 0.2 },
  { id: 'clickMulti', baseValue: 1, valueMult: 0.25 },
  { id: 'autoMulti', baseValue: 1, valueMult: 0.2 },
  { id: 'critChance', baseValue: 0, valueMult: 0.06 },
  { id: 'clickFrenzy', baseValue: 0, valueMult: 1 },
  { id: 'goldRush', baseValue: 0, valueMult: 0.10 },
  { id: 'offlineCap', baseValue: 24, valueMult: 12 },
  { id: 'megaClick', baseValue: 0, valueMult: 0.04 },
  { id: 'diamondTouch', baseValue: 0, valueMult: 5 },
  { id: 'turboAuto', baseValue: 0, valueMult: 2 },
  { id: 'comboStrike', baseValue: 0, valueMult: 0.06 },
  { id: 'passiveGain', baseValue: 0, valueMult: 0.15 },
  { id: 'clickStorm', baseValue: 0, valueMult: 1 },
  { id: 'treasureHunt', baseValue: 0, valueMult: 0.02 },
  { id: 'overcharge', baseValue: 1, valueMult: 0.15 },
  { id: 'infiniteLoop', baseValue: 1, valueMult: 0.5 },
];

function _upgradeVal(index, levels) {
  var u = CLICKER_UPGRADES[index];
  var lvl = (levels && levels[u.id]) || 0;
  return u.baseValue + u.valueMult * lvl;
}

// Calculate max legitimate chips/sec from upgrades (idle + auto + click combined)
function _calcMaxChipsPerSec(levels) {
  if (!levels) return 0;
  var cpVal = _upgradeVal(0, levels);    // clickPower
  var acVal = _upgradeVal(1, levels);    // autoClick
  var idleVal = _upgradeVal(2, levels);  // idleIncome
  var cmVal = _upgradeVal(3, levels);    // clickMulti
  var amVal = _upgradeVal(4, levels);    // autoMulti
  var critChance = Math.min(_upgradeVal(5, levels), 0.80);   // critChance (capped)
  var frenzyClicks = _upgradeVal(6, levels);  // clickFrenzy
  var goldRushBonus = _upgradeVal(7, levels); // goldRush
  var megaChance = Math.min(_upgradeVal(9, levels), 0.15);   // megaClick (capped)
  var diamondFlat = _upgradeVal(10, levels);  // diamondTouch
  var turboFlat = _upgradeVal(11, levels);    // turboAuto
  var comboChance = Math.min(_upgradeVal(12, levels), 0.50); // comboStrike (capped)
  var passiveBonus = _upgradeVal(13, levels); // passiveGain
  var stormClicks = _upgradeVal(14, levels);  // clickStorm
  var jackpotChance = Math.min(_upgradeVal(15, levels), 0.10); // treasureHunt (capped)
  var overchargeMult = _upgradeVal(16, levels); // overcharge
  var loopMult = _upgradeVal(17, levels); // infiniteLoop
  var globalMult = (1 + goldRushBonus) * overchargeMult;
  var autoPerSec = (acVal * amVal + turboFlat) * loopMult * globalMult;
  var idlePerSec = idleVal * amVal * (1 + passiveBonus) * globalMult;
  // Estimate click income: assume ~10 clicks/sec max with all frenzy/storm clicks
  // Each click can proc crits (5x), combos (10x), mega (25x), jackpots (50x)
  var chipsPerClick = (cpVal * cmVal + diamondFlat) * globalMult;
  var totalClicksPerTap = 1 + Math.floor(frenzyClicks + stormClicks);
  // Weighted average multiplier from crit/combo/mega/jackpot chances
  var avgMultiplier = 1
    + critChance * (5 - 1)
    + comboChance * (10 - 1)
    + megaChance * (25 - 1)
    + jackpotChance * (50 - 1);
  var maxClicksPerSec = 10; // generous upper bound for human clicking
  var clickPerSec = chipsPerClick * totalClicksPerTap * avgMultiplier * maxClicksPerSec;
  return autoPerSec + idlePerSec + clickPerSec;
}

// Offline-only earnings rate (auto + idle, no clicks — player isn't clicking while offline)
function _calcOfflineChipsPerSec(levels) {
  if (!levels) return 0;
  var acVal = _upgradeVal(1, levels);    // autoClick
  var idleVal = _upgradeVal(2, levels);  // idleIncome
  var amVal = _upgradeVal(4, levels);    // autoMulti
  var goldRushBonus = _upgradeVal(7, levels); // goldRush
  var turboFlat = _upgradeVal(11, levels);    // turboAuto
  var passiveBonus = _upgradeVal(13, levels); // passiveGain
  var overchargeMult = _upgradeVal(16, levels); // overcharge
  var loopMult = _upgradeVal(17, levels); // infiniteLoop
  var globalMult = (1 + goldRushBonus) * overchargeMult;
  var autoPerSec = (acVal * amVal + turboFlat) * loopMult * globalMult;
  var idlePerSec = idleVal * amVal * (1 + passiveBonus) * globalMult;
  return autoPerSec + idlePerSec;
}

function _calcOfflineCapHrs(levels) {
  return _upgradeVal(8, levels) || 24;
}

module.exports = {
  init(io, socket, deps) {
    var { socketAccountMap, accounts, checkEventRate } = deps;

    // ------------------------------------------------------------------
    // Clicker Idle: load saved state
    // ------------------------------------------------------------------
    socket.on('clicker_load', () => {
      try {
        if (!checkEventRate(socket, 'clicker_load', 60, 60000)) return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('clicker_state', null); return; }
        const state = accounts.getClickerState(key) || {};
        // Daily interest: 2% per day on banked clicker chips, compounded
        // Guard: only grant interest once per calendar day using lastInterestDate
        var interestEarned = 0;
        var bankedChips = state.chips || 0;
        var lastInterestDate = state.lastInterestDate || '';
        var todayStr = new Date().toISOString().slice(0, 10);
        if (lastInterestDate !== todayStr && bankedChips > 0 && state.lastSaveTime && typeof state.lastSaveTime === 'number') {
          var daysSinceLastSave = Math.max(0, (Date.now() - state.lastSaveTime) / (24 * 60 * 60 * 1000));
          if (daysSinceLastSave >= 0.01) { // at least ~15 minutes
            var DAILY_RATE = 0.02; // 2% per day
            var MAX_INTEREST_DAYS = 7; // cap at 7 days of compounding
            var cappedDays = Math.min(daysSinceLastSave, MAX_INTEREST_DAYS);
            var multiplier = Math.pow(1 + DAILY_RATE, cappedDays);
            interestEarned = Math.floor(bankedChips * (multiplier - 1));
            var MAX_INTEREST = 5000000; // 5M interest cap
            interestEarned = Math.min(interestEarned, MAX_INTEREST);
            if (interestEarned > 0) {
              state.chips = bankedChips + interestEarned;
              state.lastInterestDate = todayStr;
              accounts.updateClickerState(key, state);
            }
          }
        }
        state._interestEarned = interestEarned;
        socket.emit('clicker_state', state);
      } catch (err) {
        console.error('[clicker_load] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Clicker Idle: save state
    // ------------------------------------------------------------------
    socket.on('clicker_save', (data) => {
      try {
        if (!data || typeof data !== 'object') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        if (!checkEventRate(socket, 'clicker_save', 30, 60000)) return;
        // Validate clicker state: prevent inflated chip injection
        // Use the saved upgrade levels to calculate max legitimate earnings
        const prevState = accounts.getClickerState(key) || {};
        if (typeof data.chips === 'number') {
          var prevChips = prevState.chips || 0;
          var gain = data.chips - prevChips;
          if (gain > 0) {
            // Calculate max legitimate gain based on elapsed time + upgrade levels
            // Always use SERVER-STORED levels to prevent client-side spoofing
            var useLevels = prevState.levels || {};
            var maxPerSec = _calcMaxChipsPerSec(useLevels);
            var elapsedSec = 60; // default: assume 1 min between saves
            if (prevState.lastSaveTime && typeof prevState.lastSaveTime === 'number') {
              elapsedSec = Math.max(1, (Date.now() - prevState.lastSaveTime) / 1000);
            }
            // Cap elapsed time to offline vault cap
            var capHrs = _calcOfflineCapHrs(useLevels);
            elapsedSec = Math.min(elapsedSec, capHrs * 3600);
            // Max legitimate gain = (auto + idle + click estimate) * elapsed time * safety margin
            // Use 3x safety margin for lucky crit/jackpot streaks
            var maxLegitGain = Math.max(50000, Math.floor(maxPerSec * elapsedSec * 3));
            if (gain > maxLegitGain) {
              data.chips = prevChips + maxLegitGain;
            }
          }
        }
        // Validate level upgrades - only accept small increments per save
        var validatedLevels = {};
        var storedLevels = prevState.levels || {};
        if (data.levels && typeof data.levels === 'object') {
          for (var k in data.levels) {
            if (data.levels.hasOwnProperty(k)) {
              var newLvl = parseInt(data.levels[k]) || 0;
              var oldLvl = parseInt(storedLevels[k]) || 0;
              validatedLevels[k] = Math.min(newLvl, oldLvl + 5);
            }
          }
          for (var k2 in storedLevels) {
            if (storedLevels.hasOwnProperty(k2) && !(k2 in validatedLevels)) {
              validatedLevels[k2] = storedLevels[k2];
            }
          }
        } else {
          validatedLevels = storedLevels;
        }
        data.levels = validatedLevels;
        // Strip server-managed fields so clients cannot inject them
        delete data._collectDay;
        delete data._collectTotal;
        delete data.lastInterestTime;
        delete data.lastInterestDate;
        accounts.updateClickerState(key, data);
      } catch (err) {
        console.error('[clicker_save] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Clicker Idle: collect chips into account balance
    // ------------------------------------------------------------------
    socket.on('clicker_collect', (data) => {
      try {
        if (!data || typeof data.amount !== 'number' || !isFinite(data.amount) || data.amount <= 0) return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to collect' }); return; }
        if (!checkEventRate(socket, 'clicker_collect', 10, 60000)) {
          socket.emit('error', { message: 'Collecting too fast' }); return;
        }
        // Load clicker state to validate the amount
        const state = accounts.getClickerState(key);
        if (!state) { socket.emit('error', { message: 'No clicker data found' }); return; }

        // Calculate offline earnings server-side so we don't depend on the
        // save that may have been clamped by the anti-cheat above.
        var serverChips = state.chips || 0;
        if (state.lastSaveTime && typeof state.lastSaveTime === 'number') {
          var elapsed = Math.max(0, (Date.now() - state.lastSaveTime) / 1000);
          var useLevels = state.levels || {};
          var maxPerSec = _calcOfflineChipsPerSec(useLevels);
          var capHrs = _calcOfflineCapHrs(useLevels);
          var cappedElapsed = Math.min(elapsed, capHrs * 3600);
          // Only add offline earnings if significant time passed (>5 sec)
          if (cappedElapsed > 5 && maxPerSec > 0) {
            var offlineEarnings = Math.floor(maxPerSec * cappedElapsed);
            serverChips += offlineEarnings;
          }
        }

        var collectAmount = Math.floor(Math.min(data.amount, serverChips));
        if (collectAmount <= 0) { socket.emit('error', { message: 'Nothing to collect' }); return; }

        // Daily collection cap: 50M per day
        var DAILY_COLLECT_CAP = 50000000;
        var now = Date.now();
        var dayKey = new Date(now).toISOString().slice(0, 10);
        if (!state._collectDay || state._collectDay !== dayKey) {
          state._collectDay = dayKey;
          state._collectTotal = 0;
        }
        var remainingDaily = DAILY_COLLECT_CAP - (state._collectTotal || 0);
        if (remainingDaily <= 0) {
          socket.emit('clicker_collect_result', { success: false, reason: 'Daily collection limit reached' });
          return;
        }
        collectAmount = Math.min(collectAmount, remainingDaily);

        // Deduct from clicker state and track daily total
        state.chips = Math.max(0, serverChips - collectAmount);
        state._collectTotal = (state._collectTotal || 0) + collectAmount;
        accounts.updateClickerState(key, state);
        // Add to account chips
        const newChips = accounts.updateChips(key, collectAmount);
        socket.emit('clicker_collected', { collected: collectAmount, clickerChips: state.chips });
        socket.emit('chips_updated', { chips: newChips, reason: 'Clicker: collected ' + collectAmount + ' chips' });
      } catch (err) {
        console.error('[clicker_collect] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Clicker Idle: use account chips for upgrades
    // ------------------------------------------------------------------
    socket.on('clicker_use_account_chips', (data) => {
      try {
        if (!data || typeof data.amount !== 'number' || !isFinite(data.amount) || data.amount <= 0) return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        if (!checkEventRate(socket, 'clicker_use_account', 60, 60000)) return;
        var amount = Math.floor(data.amount);
        if (amount <= 0) return;
        var acc = accounts.loadAccount(key);
        if (!acc || acc.chips < amount) {
          socket.emit('error', { message: 'Not enough account chips' }); return;
        }
        var newChips = accounts.updateChips(key, -amount);
        socket.emit('chips_updated', { chips: newChips, reason: 'Clicker upgrade -' + amount });
      } catch (err) {
        console.error('[clicker_use_account_chips] Error:', err.message);
      }
    });
  }
};
