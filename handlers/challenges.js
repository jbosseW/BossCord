// handlers/challenges.js
// Daily Challenges & Achievement system
// Socket handlers: get_daily_challenges, claim_challenge_reward, get_achievements

// ─── Challenge Definitions ───
// 10 possible daily challenges. Each day, 3 are randomly selected per user.
const CHALLENGE_POOL = [
  { id: 'card_game_wins',      title: 'Card Shark',       description: 'Win 3 card games',              target: 3,  reward: 150, track: 'card_game_wins' },
  { id: 'messages_sent',       title: 'Chatterbox',       description: 'Send 20 messages',              target: 20, reward: 75,  track: 'messages_sent' },
  { id: 'chips_earned',        title: 'Money Maker',      description: 'Earn 500 chips from games',     target: 500,reward: 100, track: 'chips_earned' },
  { id: 'unique_games_played', title: 'Explorer',         description: 'Play 5 different games',        target: 5,  reward: 125, track: 'unique_games_played' },
  { id: 'reactions_given',     title: 'Reactor',          description: 'React to 10 messages',          target: 10, reward: 50,  track: 'reactions_given' },
  { id: 'coinflip_wins',       title: 'Heads or Tails',   description: 'Win a coin flip',               target: 1,  reward: 75,  track: 'coinflip_wins' },
  { id: 'lootboxes_opened',    title: 'Unboxer',          description: 'Open 2 loot boxes',             target: 2,  reward: 100, track: 'lootboxes_opened' },
  { id: 'orbs_time_played',    title: 'Orb Addict',       description: 'Play BossOrbs for 5 minutes',   target: 5,  reward: 100, track: 'orbs_time_played' },
  { id: 'tcg_wins',            title: 'Battle Master',    description: 'Win a TCG battle',              target: 1,  reward: 150, track: 'tcg_wins' },
  { id: 'rooms_visited',       title: 'Wanderer',         description: 'Visit 3 public rooms',          target: 3,  reward: 75,  track: 'rooms_visited' },
];

// Build a lookup map for fast access
const CHALLENGE_MAP = {};
for (var ci = 0; ci < CHALLENGE_POOL.length; ci++) {
  CHALLENGE_MAP[CHALLENGE_POOL[ci].id] = CHALLENGE_POOL[ci];
}

// ─── Achievement Definitions ───
const ACHIEVEMENTS = [
  { id: 'first_steps',      title: 'First Steps',      description: 'Send your first message',         icon: '\uD83D\uDC63' },
  { id: 'social_butterfly',  title: 'Social Butterfly',  description: 'Send 100 messages',               icon: '\uD83E\uDD8B' },
  { id: 'high_roller',      title: 'High Roller',       description: 'Earn 10,000 chips total',         icon: '\uD83D\uDCB0' },
  { id: 'card_shark',       title: 'Card Shark',        description: 'Win 10 card games',               icon: '\uD83C\uDCA0' },
  { id: 'collector',        title: 'Collector',         description: 'Own 50 TCG cards',                icon: '\uD83D\uDCDA' },
  { id: 'lucky_strike',     title: 'Lucky Strike',      description: 'Win 5 coin flips in a row',       icon: '\u2728' },
  { id: 'chess_master',     title: 'Chess Master',      description: 'Win 5 chess games',               icon: '\u265A' },
  { id: 'brawler',          title: 'Brawler',           description: 'Get 10 kills in BossBrawl',       icon: '\uD83E\uDD4A' },
  { id: 'growth_spurt',     title: 'Growth Spurt',      description: 'Reach size 100 in BossOrbs',      icon: '\uD83C\uDF1F' },
  { id: 'whale',            title: 'Whale',             description: 'Spend 50,000 chips total',        icon: '\uD83D\uDC33' },
  { id: 'jackpot',          title: 'Jackpot',           description: 'Win a slots jackpot',             icon: '\uD83C\uDFB0' },
  { id: 'trader',           title: 'Trader',            description: 'Complete 10 auction trades',      icon: '\uD83E\uDD1D' },
  { id: 'speed_demon',      title: 'Speed Demon',       description: 'Win a horse race with 3+ horse lead', icon: '\uD83C\uDFC7' },
  { id: 'pool_shark',       title: 'Pool Shark',        description: 'Win 5 pool games',                icon: '\uD83C\uDFB1' },
  { id: 'veteran',          title: 'Veteran',           description: 'Use BossCord for 7 days',         icon: '\uD83C\uDFC5' },
];

// Build achievement lookup map
const ACHIEVEMENT_MAP = {};
for (var ai = 0; ai < ACHIEVEMENTS.length; ai++) {
  ACHIEVEMENT_MAP[ACHIEVEMENTS[ai].id] = ACHIEVEMENTS[ai];
}

// ─── Utility: get today's date string in UTC ───
function getUTCDateString() {
  var now = new Date();
  return now.getUTCFullYear() + '-' +
    String(now.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(now.getUTCDate()).padStart(2, '0');
}

// ─── Utility: seeded random for deterministic daily challenge selection ───
// Uses a simple hash to generate a seed from accountKey + date
function seedFromString(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// Deterministic selection of 3 challenges for a given key + date
function selectDailyChallenges(accountKey, dateStr) {
  var seed = seedFromString(accountKey + ':' + dateStr);
  // Fisher-Yates shuffle with seeded RNG
  var indices = [];
  for (var i = 0; i < CHALLENGE_POOL.length; i++) indices.push(i);

  // Simple LCG seeded random
  var s = seed;
  function nextRand() {
    s = (s * 1664525 + 1013904223) & 0x7FFFFFFF;
    return s / 0x7FFFFFFF;
  }

  for (var j = indices.length - 1; j > 0; j--) {
    var k = Math.floor(nextRand() * (j + 1));
    var tmp = indices[j];
    indices[j] = indices[k];
    indices[k] = tmp;
  }

  return [
    CHALLENGE_POOL[indices[0]],
    CHALLENGE_POOL[indices[1]],
    CHALLENGE_POOL[indices[2]]
  ];
}

// ─── Ensure challenge data exists on account ───
function ensureChallengeData(account, accountKey) {
  var today = getUTCDateString();
  if (!account.dailyChallenges || account.dailyChallenges.date !== today) {
    // Generate new challenges for today
    var selected = selectDailyChallenges(accountKey, today);
    account.dailyChallenges = {
      date: today,
      challenges: selected.map(function(c) {
        return {
          id: c.id,
          progress: 0,
          completed: false,
          claimed: false
        };
      })
    };
  }
  return account.dailyChallenges;
}

// ─── Track challenge progress ───
// Called from other handlers when tracked events happen.
// type: the tracking key (e.g. 'messages_sent', 'card_game_wins')
// amount: how much to increment (default 1)
function trackChallengeProgress(accounts, accountKey, type, amount) {
  if (!accountKey || !type) return;
  amount = amount || 1;
  var acc = accounts.loadAccount(accountKey);
  if (!acc) return;
  var data = ensureChallengeData(acc, accountKey);
  var changed = false;

  for (var i = 0; i < data.challenges.length; i++) {
    var ch = data.challenges[i];
    var def = CHALLENGE_MAP[ch.id];
    if (!def) continue;
    if (def.track === type && !ch.completed) {
      ch.progress = Math.min(ch.progress + amount, def.target);
      if (ch.progress >= def.target) {
        ch.completed = true;
      }
      changed = true;
    }
  }

  if (changed) {
    accounts.saveAccount(acc);
  }
  return changed;
}

// ─── Check and award an achievement ───
// Returns true if newly unlocked, false otherwise.
function checkAchievement(accounts, accountKey, achievementId) {
  if (!accountKey || !achievementId) return false;
  if (!ACHIEVEMENT_MAP[achievementId]) return false;
  var acc = accounts.loadAccount(accountKey);
  if (!acc) return false;
  if (!acc.achievements) acc.achievements = {};
  // Already unlocked
  if (acc.achievements[achievementId]) return false;
  // Unlock it
  acc.achievements[achievementId] = Date.now();
  accounts.saveAccount(acc);
  return true;
}

// ─── Get achievement list with unlock status ───
function getAchievements(accounts, accountKey) {
  var acc = accountKey ? accounts.loadAccount(accountKey) : null;
  var unlocked = (acc && acc.achievements) ? acc.achievements : {};
  return ACHIEVEMENTS.map(function(a) {
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      icon: a.icon,
      unlockedAt: unlocked[a.id] || null
    };
  });
}

// ─── Milliseconds until midnight UTC ───
function msUntilMidnightUTC() {
  var now = new Date();
  var midnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
  ));
  return midnight.getTime() - now.getTime();
}

// ─── Socket handler registration ───
module.exports = {
  // Exported for use by other handlers
  trackChallengeProgress: trackChallengeProgress,
  checkAchievement: checkAchievement,
  getAchievements: getAchievements,
  ACHIEVEMENTS: ACHIEVEMENTS,
  ACHIEVEMENT_MAP: ACHIEVEMENT_MAP,
  CHALLENGE_POOL: CHALLENGE_POOL,

  init(io, socket, deps) {
    var { socketAccountMap, accounts, checkEventRate, loot } = deps;
    var crypto = require('crypto');

    // ------------------------------------------------------------------
    // Get daily challenges
    // ------------------------------------------------------------------
    socket.on('get_daily_challenges', function() {
      try {
        if (!checkEventRate(socket, 'get_daily_challenges', 30, 60000)) return;
        var key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('daily_challenges', { challenges: [], resetIn: msUntilMidnightUTC() });
          return;
        }
        var acc = accounts.loadAccount(key);
        if (!acc) {
          socket.emit('daily_challenges', { challenges: [], resetIn: msUntilMidnightUTC() });
          return;
        }
        var data = ensureChallengeData(acc, key);
        accounts.saveAccount(acc);

        // Enrich challenge data with definitions
        var enriched = data.challenges.map(function(ch) {
          var def = CHALLENGE_MAP[ch.id];
          if (!def) return null;
          return {
            id: ch.id,
            title: def.title,
            description: def.description,
            target: def.target,
            progress: ch.progress,
            reward: def.reward,
            completed: ch.completed,
            claimed: ch.claimed
          };
        }).filter(function(x) { return x !== null; });

        socket.emit('daily_challenges', {
          challenges: enriched,
          resetIn: msUntilMidnightUTC()
        });
      } catch (err) {
        console.error('[get_daily_challenges] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Claim challenge reward
    // ------------------------------------------------------------------
    socket.on('claim_challenge_reward', function(data) {
      try {
        if (!data || typeof data.challengeId !== 'string') return;
        if (!checkEventRate(socket, 'claim_challenge_reward', 10, 60000)) return;
        var key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('error', { message: 'Need an account to claim rewards' });
          return;
        }
        var acc = accounts.loadAccount(key);
        if (!acc) {
          socket.emit('error', { message: 'Account not found' });
          return;
        }
        var challengeData = ensureChallengeData(acc, key);

        // Find the challenge
        var found = null;
        for (var i = 0; i < challengeData.challenges.length; i++) {
          if (challengeData.challenges[i].id === data.challengeId) {
            found = challengeData.challenges[i];
            break;
          }
        }

        if (!found) {
          socket.emit('error', { message: 'Challenge not found' });
          return;
        }
        if (!found.completed) {
          socket.emit('error', { message: 'Challenge not completed yet' });
          return;
        }
        if (found.claimed) {
          socket.emit('error', { message: 'Reward already claimed' });
          return;
        }

        // Award chips
        var def = CHALLENGE_MAP[found.id];
        if (!def) {
          socket.emit('error', { message: 'Invalid challenge' });
          return;
        }

        found.claimed = true;
        accounts.saveAccount(acc);

        var newChips = accounts.updateChips(key, def.reward);
        if (newChips !== null) {
          socket.emit('chips_updated', { chips: newChips, reason: 'Challenge complete: ' + def.title + ' +' + def.reward });
        }

        // Award a guaranteed randomized key item for opening packs/lootboxes
        if (loot && loot.rollGuaranteedKey) {
          var keyDrop = loot.rollGuaranteedKey();
          if (keyDrop) {
            var keyInstance = {
              instanceId: crypto.randomBytes(6).toString('hex'),
              itemId: keyDrop.id,
              obtainedAt: Date.now(),
              source: 'challenge_reward'
            };
            accounts.addInventoryItem(key, keyInstance);
            socket.emit('key_drop', {
              key: { id: keyDrop.id, name: keyDrop.name, rarity: keyDrop.rarity, img: keyDrop.img },
              instanceId: keyInstance.instanceId
            });
          }
        }

        // Send updated challenges
        var enriched = challengeData.challenges.map(function(ch) {
          var d = CHALLENGE_MAP[ch.id];
          if (!d) return null;
          return {
            id: ch.id,
            title: d.title,
            description: d.description,
            target: d.target,
            progress: ch.progress,
            reward: d.reward,
            completed: ch.completed,
            claimed: ch.claimed
          };
        }).filter(function(x) { return x !== null; });

        socket.emit('daily_challenges', {
          challenges: enriched,
          resetIn: msUntilMidnightUTC()
        });

        socket.emit('challenge_claimed', { challengeId: found.id, reward: def.reward });
      } catch (err) {
        console.error('[claim_challenge_reward] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Get achievements
    // ------------------------------------------------------------------
    socket.on('get_achievements', function() {
      try {
        if (!checkEventRate(socket, 'get_achievements', 30, 60000)) return;
        var key = socketAccountMap.get(socket.id);
        var achievements = getAchievements(accounts, key);
        socket.emit('achievements', { achievements: achievements });
      } catch (err) {
        console.error('[get_achievements] Error:', err.message);
      }
    });
  }
};
