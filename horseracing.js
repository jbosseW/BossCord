'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Horse Racing Manager — server-side race simulation for BossCord
// Automated race loop: pre_race (30s betting) -> racing (15s animation) -> results (15s)
// ---------------------------------------------------------------------------

var HORSE_NAMES = [
  'Thunderbolt', 'Midnight Star', 'Golden Arrow', 'Silver Storm',
  'Crimson Blaze', 'Shadow Dancer', 'Iron Will', 'Lucky Strike',
  'Desert Wind', 'Ocean Fury', 'Mountain King', 'Forest Spirit',
  'Lightning', 'Wildfire', 'Frost Bite', 'Eclipse',
  'Phoenix Rise', 'Dark Comet', 'Sapphire Wind', 'Storm Chaser',
  'Noble Fury', 'Velvet Thunder', 'Copper Dash', 'Arctic Fox',
  'Diamond Rush', 'Blaze Runner', 'Night Hawk', 'Royal Bolt'
];

var HORSE_COLORS = [
  '#ed4245', '#f0b232', '#57f287', '#5865f2',
  '#9b59b6', '#e67e22', '#e91e63', '#00bcd4'
];

var SKILL_POOL = [
  'mud_runner', 'sun_chaser', 'wind_rider', 'fog_walker', 'front_runner',
  'closer', 'steady', 'wild_card', 'resilient', 'sprinter',
  'night_runner', 'storm_rider', 'crowd_pleaser'
];

var WEATHER_TYPES = [
  { name: 'Sunny',  weights: { speed: 0.30, stamina: 0.20, acceleration: 0.30, luck: 0.20 } },
  { name: 'Rainy',  weights: { speed: 0.20, stamina: 0.35, acceleration: 0.20, luck: 0.25 } },
  { name: 'Muddy',  weights: { speed: 0.15, stamina: 0.40, acceleration: 0.15, luck: 0.30 } },
  { name: 'Windy',  weights: { speed: 0.35, stamina: 0.15, acceleration: 0.35, luck: 0.15 } },
  { name: 'Foggy',  weights: { speed: 0.20, stamina: 0.20, acceleration: 0.20, luck: 0.40 } },
  { name: 'Stormy', weights: { speed: 0.15, stamina: 0.30, acceleration: 0.25, luck: 0.30 } },
  { name: 'Hot',    weights: { speed: 0.25, stamina: 0.35, acceleration: 0.20, luck: 0.20 } }
];

var MOOD_TYPES = [
  { name: 'Energetic',  multiplier: 1.10, extraVariance: 0 },
  { name: 'Calm',       multiplier: 1.00, extraVariance: 0 },
  { name: 'Nervous',    multiplier: 0.90, extraVariance: 0 },
  { name: 'Aggressive', multiplier: 1.05, extraVariance: 0.15 },
  { name: 'Lazy',       multiplier: 0.85, extraVariance: 0 }
];

var MID_RACE_EVENTS = [
  { text: 'stumbles!', effect: -5 },
  { text: 'finds second wind!', effect: 7 },
  { text: 'surges ahead!', effect: 10 },
  { text: 'bumped by neighbor!', effect: -3 },
  { text: 'perfect stride!', effect: 5 },
  { text: 'clips the rail!', effect: -4 },
  { text: 'breaks free from the pack!', effect: 8 },
  { text: 'loses footing!', effect: -6 },
  { text: 'catches a tailwind!', effect: 6 },
  { text: 'drifts wide on the turn!', effect: -3 },
  { text: 'kicks into gear!', effect: 9 },
  { text: 'gets boxed in!', effect: -7 },
  { text: 'powers through the mud!', effect: 4 },
  { text: 'spooked by the crowd!', effect: -5 },
  { text: 'jockey calls for more!', effect: 6 },
  { text: 'shoulder to shoulder!', effect: 3 },
  { text: 'pulls away!', effect: 8 },
  { text: 'fading fast!', effect: -8 },
  { text: 'rallies from behind!', effect: 11 },
  { text: 'nearly trips!', effect: -4 }
];

var MIN_BET = 10;
var MAX_BET = 1000;
var RACE_COUNT = 8; // horses per race
var TOTAL_FRAMES = 20;
var MAX_POSITION = 100;
var MAX_CHAT = 50;

// Phase durations in ms
var PRE_RACE_DURATION = 30000;
var RACING_DURATION = 15000;
var RESULTS_DURATION = 15000;


// ---------------------------------------------------------------------------
// Seeded PRNG for daily-deterministic horse generation
// ---------------------------------------------------------------------------

function _seedFromString(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash >>> 0;
}

function _mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function _getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Horse generation (daily-seeded deterministic stats)
// ---------------------------------------------------------------------------

function _generateHorses() {
  var dateStr = _getTodayDateString();
  var seed = _seedFromString(dateStr);
  var rng = _mulberry32(seed);

  var horses = [];
  for (var i = 0; i < HORSE_NAMES.length; i++) {
    var skillCount = 1 + Math.floor(rng() * 2); // 1 or 2 skills
    var shuffled = SKILL_POOL.slice();
    // Fisher-Yates partial shuffle using seeded RNG for skill selection
    for (var s = shuffled.length - 1; s > 0; s--) {
      var j = Math.floor(rng() * (s + 1));
      var tmp = shuffled[s];
      shuffled[s] = shuffled[j];
      shuffled[j] = tmp;
    }
    var skills = shuffled.slice(0, skillCount);

    horses.push({
      id: 'horse_' + i,
      name: HORSE_NAMES[i],
      color: HORSE_COLORS[i % HORSE_COLORS.length],
      stats: {
        speed: 40 + Math.floor(rng() * 51),        // 40-90
        stamina: 40 + Math.floor(rng() * 51),       // 40-90
        acceleration: 40 + Math.floor(rng() * 51),  // 40-90
        luck: 40 + Math.floor(rng() * 51)           // 40-90
      },
      skills: skills
    });
  }
  return horses;
}


// ---------------------------------------------------------------------------
// Effective stats computation (base + skill bonuses for weather)
// ---------------------------------------------------------------------------

function _getEffectiveStats(horse, weatherName) {
  var base = {
    speed: horse.stats.speed,
    stamina: horse.stats.stamina,
    acceleration: horse.stats.acceleration,
    luck: horse.stats.luck
  };

  var skills = horse.skills;
  for (var i = 0; i < skills.length; i++) {
    var sk = skills[i];
    switch (sk) {
      case 'mud_runner':
        if (weatherName === 'Muddy') base.speed += 15;
        break;
      case 'sun_chaser':
        if (weatherName === 'Sunny') base.speed += 15;
        break;
      case 'wind_rider':
        if (weatherName === 'Windy') { base.speed += 10; base.acceleration += 10; }
        break;
      case 'fog_walker':
        if (weatherName === 'Foggy') base.luck += 20;
        break;
      case 'front_runner':
        base.acceleration += 20;
        break;
      case 'closer':
        // Handled per-frame in simulation
        break;
      case 'steady':
        base.stamina += 20;
        break;
      case 'wild_card':
        base.luck += 30;
        break;
      case 'resilient':
        // Handled in mood application
        break;
      case 'sprinter':
        base.speed += 15;
        base.stamina -= 10;
        break;
      case 'night_runner':
        base.luck += 10;
        break;
      case 'storm_rider':
        if (weatherName === 'Stormy') { base.speed += 15; base.stamina += 10; }
        break;
      case 'crowd_pleaser':
        base.acceleration += 10;
        base.luck += 5;
        break;
    }
  }

  return base;
}


// ---------------------------------------------------------------------------
// HorseRacingManager class
// ---------------------------------------------------------------------------

class HorseRacingManager {
  constructor() {
    this.horses = _generateHorses();
    this._lastGeneratedDate = _getTodayDateString();
    this.spectators = new Map(); // socketId -> { name, color }
    this.bets = new Map();       // socketId -> { horseId, amount, playerName }
    this.phase = 'idle';         // idle, pre_race, racing, results
    this.currentRace = null;     // { horses, weather, moods, odds }
    this.raceResult = null;      // simulation result
    this.loopTimer = null;
    this.chat = [];
    this.raceNumber = 0;
    this.phaseEndsAt = null;
    this._broadcastFn = null;
    this._resolveBetFn = null;
  }

  _regenerateHorsesIfNewDay() {
    var today = _getTodayDateString();
    if (today !== this._lastGeneratedDate) {
      this.horses = _generateHorses();
      this._lastGeneratedDate = today;
    }
  }

  // -----------------------------------------------------------------------
  // Spectator management
  // -----------------------------------------------------------------------

  addSpectator(socketId, name, color) {
    this.spectators.set(socketId, {
      name: name || 'Anon',
      color: color || '#dcddde'
    });
  }

  removeSpectator(socketId) {
    this.spectators.delete(socketId);
    // Also clean up any bet they placed
    this.bets.delete(socketId);
  }

  getSpectatorCount() {
    return this.spectators.size;
  }

  // -----------------------------------------------------------------------
  // Betting
  // -----------------------------------------------------------------------

  placeBet(socketId, horseId, amount, balance) {
    if (this.phase !== 'pre_race') {
      return { error: 'Betting is not open right now' };
    }

    // Validate horse is in current race
    if (!this.currentRace) {
      return { error: 'No race in progress' };
    }

    var validHorse = null;
    for (var i = 0; i < this.currentRace.horses.length; i++) {
      if (this.currentRace.horses[i].id === horseId) {
        validHorse = this.currentRace.horses[i];
        break;
      }
    }
    if (!validHorse) {
      return { error: 'Invalid horse selection' };
    }

    // Validate amount
    if (typeof amount !== 'number' || !isFinite(amount)) {
      return { error: 'Invalid bet amount' };
    }
    var betAmount = Math.floor(amount);
    if (betAmount < MIN_BET || betAmount > MAX_BET) {
      return { error: 'Bet must be between ' + MIN_BET + ' and ' + MAX_BET + ' chips' };
    }

    // Balance check
    if (typeof balance === 'number' && betAmount > balance) {
      return { error: 'Insufficient chips' };
    }

    // Check no existing bet
    if (this.bets.has(socketId)) {
      return { error: 'You already placed a bet this race' };
    }

    var spectator = this.spectators.get(socketId);
    var playerName = spectator ? spectator.name : 'Anon';

    // Look up odds for this horse
    var odds = 1.1;
    if (this.currentRace.odds && this.currentRace.odds[horseId]) {
      odds = this.currentRace.odds[horseId];
    }

    this.bets.set(socketId, {
      horseId: horseId,
      amount: betAmount,
      playerName: playerName
    });

    var potentialWin = Math.floor(betAmount * odds);

    return {
      success: true,
      horse: { id: validHorse.id, name: validHorse.name, color: validHorse.color },
      odds: odds,
      potentialWin: potentialWin
    };
  }

  cancelBet(socketId) {
    if (this.phase !== 'pre_race') {
      return null;
    }
    var bet = this.bets.get(socketId);
    if (!bet) return null;
    this.bets.delete(socketId);
    return bet.amount;
  }

  // -----------------------------------------------------------------------
  // Race state (sanitized for clients)
  // -----------------------------------------------------------------------

  getRaceState() {
    var state = {
      phase: this.phase,
      raceNumber: this.raceNumber,
      spectatorCount: this.spectators.size,
      betCount: this.bets.size,
      chat: this.chat,
      phaseEndsAt: this.phaseEndsAt || null
    };

    if (this.currentRace) {
      state.horses = this.currentRace.horses.map(function(h) {
        return {
          id: h.id,
          name: h.name,
          color: h.color,
          stats: h.stats,
          skills: h.skills,
          mood: h.mood || null,
          odds: h.odds || null
        };
      });
      state.weather = this.currentRace.weather;
      state.odds = this.currentRace.odds || {};
    }

    if (this.raceResult && (this.phase === 'racing' || this.phase === 'results')) {
      state.raceData = {
        frames: this.raceResult.frames,
        events: this.raceResult.events,
        placements: this.raceResult.placements,
        photoFinish: this.raceResult.photoFinish
      };
    }

    return state;
  }

  // -----------------------------------------------------------------------
  // Odds computation
  // -----------------------------------------------------------------------

  _computeOdds(horses, weather) {
    var weatherWeights = weather.weights;
    var scores = [];
    var totalScore = 0;

    for (var i = 0; i < horses.length; i++) {
      var h = horses[i];
      var eff = _getEffectiveStats(h, weather.name);
      var moodMult = 1.0;
      if (h.mood) {
        for (var m = 0; m < MOOD_TYPES.length; m++) {
          if (MOOD_TYPES[m].name === h.mood) {
            moodMult = MOOD_TYPES[m].multiplier;
            break;
          }
        }
      }

      // Compute expected score (similar to sim but without variance)
      var weightedBase = eff.speed * weatherWeights.speed +
                         eff.stamina * weatherWeights.stamina +
                         eff.acceleration * weatherWeights.acceleration +
                         eff.luck * weatherWeights.luck;

      var score = weightedBase * moodMult;
      scores.push({ id: h.id, score: score });
      totalScore += score;
    }

    var odds = {};
    for (var j = 0; j < scores.length; j++) {
      var winProb = scores[j].score / totalScore;
      var rawOdds = (1 / winProb) * 0.90; // 10% house edge
      var clampedOdds = Math.min(20, Math.max(1.1, rawOdds));
      odds[scores[j].id] = Math.round(clampedOdds * 10) / 10;
    }

    return odds;
  }

  // -----------------------------------------------------------------------
  // Race simulation
  // -----------------------------------------------------------------------

  _simulateRace() {
    var horses = this.currentRace.horses;
    var weather = this.currentRace.weather;
    var weatherWeights = weather.weights;

    // Pre-compute effective stats and mood data for all horses
    var horseData = [];
    for (var h = 0; h < horses.length; h++) {
      var horse = horses[h];
      var eff = _getEffectiveStats(horse, weather.name);

      var moodMult = 1.0;
      var isAggressive = false;
      var isResilient = false;
      if (horse.mood) {
        for (var m = 0; m < MOOD_TYPES.length; m++) {
          if (MOOD_TYPES[m].name === horse.mood) {
            moodMult = MOOD_TYPES[m].multiplier;
            isAggressive = (horse.mood === 'Aggressive');
            break;
          }
        }
      }

      // Check for resilient skill — halve mood penalty
      for (var sk = 0; sk < horse.skills.length; sk++) {
        if (horse.skills[sk] === 'resilient') {
          isResilient = true;
          break;
        }
      }
      if (isResilient && moodMult < 1.0) {
        // Halve the penalty: e.g. 0.90 becomes 0.95, 0.85 becomes 0.925
        moodMult = 1.0 - (1.0 - moodMult) * 0.5;
      }

      var hasCloser = false;
      for (var sc = 0; sc < horse.skills.length; sc++) {
        if (horse.skills[sc] === 'closer') {
          hasCloser = true;
          break;
        }
      }

      horseData.push({
        id: horse.id,
        name: horse.name,
        color: horse.color,
        eff: eff,
        moodMult: moodMult,
        isAggressive: isAggressive,
        hasCloser: hasCloser,
        position: 0
      });
    }

    var frames = [];
    var events = [];

    for (var frame = 0; frame < TOTAL_FRAMES; frame++) {
      for (var hi = 0; hi < horseData.length; hi++) {
        var hd = horseData[hi];
        if (hd.position >= MAX_POSITION) continue; // already finished

        var effSpeed = hd.eff.speed;
        var effStamina = hd.eff.stamina;
        var effAccel = hd.eff.acceleration;
        var effLuck = hd.eff.luck;

        // Phase bonus (normalized: divide raw stat contribution by 100 to keep
        // bonus proportional to the 0-5 per-frame range)
        var phaseBonus = 0;
        if (frame <= 4) {
          phaseBonus = (effAccel * 0.3) / 100;
        } else if (frame <= 14) {
          phaseBonus = (effSpeed * 0.2) / 100;
        } else {
          phaseBonus = (effSpeed * 0.15 + (hd.hasCloser ? 20 : 0)) / 100;
        }

        // Fatigue
        var fatigue = 0;
        if (frame > 10) {
          fatigue = (100 - effStamina) * 0.002 * (frame - 10);
        }

        // Weighted base
        var weightedBase = effSpeed * weatherWeights.speed +
                           effStamina * weatherWeights.stamina +
                           effAccel * weatherWeights.acceleration +
                           effLuck * weatherWeights.luck;

        // Normalize to 0-5 range per frame
        // Max possible weighted base: ~120 (90 base + 30 skill bonus max per stat)
        // Using 120 as generous max for normalization
        var normalizedBase = (weightedBase / 120) * 5;

        // Apply mood multiplier to the normalized base
        normalizedBase = normalizedBase * hd.moodMult;

        // Variance
        var varianceRange = 0.3 * (1 + effLuck / 200) + (hd.isAggressive ? 0.15 : 0);
        var randomFactor = crypto.randomInt(1000) / 1000;
        var variance = 1 + (randomFactor - 0.5) * varianceRange;

        // Frame progress
        var frameProgress = (normalizedBase + phaseBonus) * (1 - fatigue) * variance;
        if (frameProgress < 0) frameProgress = 0;

        hd.position += frameProgress;
        if (hd.position > MAX_POSITION) hd.position = MAX_POSITION;
      }

      // Mid-race events: frames 5-17, 20% chance per frame
      if (frame >= 5 && frame <= 17) {
        if (crypto.randomInt(100) < 20) {
          // Pick a random mid-pack horse (not first, not last by current position)
          var sorted = horseData.slice().sort(function(a, b) { return b.position - a.position; });
          // Mid-pack: indices 2 through 5 (0-indexed)
          var midStart = Math.min(2, sorted.length - 1);
          var midEnd = Math.min(5, sorted.length - 1);
          var midIdx = midStart + crypto.randomInt(midEnd - midStart + 1);
          var targetHorse = sorted[midIdx];

          var eventTemplate = MID_RACE_EVENTS[crypto.randomInt(MID_RACE_EVENTS.length)];
          var event = {
            frame: frame,
            horseId: targetHorse.id,
            horseName: targetHorse.name,
            text: eventTemplate.text,
            effect: eventTemplate.effect
          };
          events.push(event);

          // Apply event effect
          // "surges ahead!" gives +10 for 2 frames — we apply +10 now and trust
          // the next frame to naturally add more. Simplify to instant position change.
          targetHorse.position += eventTemplate.effect;
          if (targetHorse.position < 0) targetHorse.position = 0;
          if (targetHorse.position > MAX_POSITION) targetHorse.position = MAX_POSITION;
        }
      }

      // Record frame state as flat array
      var frameState = [];
      for (var fi = 0; fi < horseData.length; fi++) {
        frameState.push({
          id: horseData[fi].id,
          position: Math.round(horseData[fi].position * 100) / 100
        });
      }
      frames.push(frameState);
    }

    // Normalize positions so the winner reaches exactly 100
    var maxPos = 0;
    for (var ni = 0; ni < horseData.length; ni++) {
      if (horseData[ni].position > maxPos) maxPos = horseData[ni].position;
    }
    if (maxPos > 0 && maxPos < MAX_POSITION) {
      var scale = MAX_POSITION / maxPos;
      // Scale all frame positions
      for (var fi2 = 0; fi2 < frames.length; fi2++) {
        for (var fh = 0; fh < frames[fi2].length; fh++) {
          frames[fi2][fh].position = Math.round(frames[fi2][fh].position * scale * 100) / 100;
        }
      }
      // Scale final positions
      for (var si = 0; si < horseData.length; si++) {
        horseData[si].position = horseData[si].position * scale;
        if (horseData[si].position > MAX_POSITION) horseData[si].position = MAX_POSITION;
      }
    }

    // Compute placements from final positions
    var finalSorted = horseData.slice().sort(function(a, b) { return b.position - a.position; });
    var placements = [];
    for (var pi = 0; pi < finalSorted.length; pi++) {
      placements.push({
        id: finalSorted[pi].id,
        name: finalSorted[pi].name,
        color: finalSorted[pi].color,
        finalPosition: Math.round(finalSorted[pi].position * 100) / 100,
        finishPosition: pi + 1
      });
    }

    // Photo finish detection: top 2 within 1.5 points at frame 18+
    var photoFinish = false;
    if (placements.length >= 2) {
      var diff = Math.abs(placements[0].finalPosition - placements[1].finalPosition);
      if (diff <= 1.5) {
        // Check if they were within 2 at frame 18 or 19
        var lastFrames = frames.slice(18);
        for (var lf = 0; lf < lastFrames.length; lf++) {
          var fHorses = lastFrames[lf];
          var topTwoPositions = [];
          for (var th = 0; th < fHorses.length; th++) {
            if (fHorses[th].id === placements[0].id || fHorses[th].id === placements[1].id) {
              topTwoPositions.push(fHorses[th].position);
            }
          }
          if (topTwoPositions.length === 2 && Math.abs(topTwoPositions[0] - topTwoPositions[1]) <= 2) {
            photoFinish = true;
            break;
          }
        }
      }
    }

    return {
      frames: frames,
      events: events,
      placements: placements,
      photoFinish: photoFinish
    };
  }

  // -----------------------------------------------------------------------
  // Race loop
  // -----------------------------------------------------------------------

  startRaceLoop(broadcastFn, resolveBetFn) {
    this._broadcastFn = broadcastFn || function() {};
    this._resolveBetFn = resolveBetFn || function() {};

    // Don't auto-start — wait for spectators (resumeIfIdle called from hr_join)
  }

  stopRaceLoop() {
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    this.phase = 'idle';
  }

  _startPreRace() {
    var self = this;
    this._regenerateHorsesIfNewDay();
    this.raceNumber++;
    this.phase = 'pre_race';
    this.phaseEndsAt = Date.now() + PRE_RACE_DURATION;
    this.bets.clear();
    this.raceResult = null;

    // Pick 8 random horses from pool
    var shuffled = this.horses.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = crypto.randomInt(i + 1);
      var tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }
    var raceHorses = [];
    for (var h = 0; h < RACE_COUNT && h < shuffled.length; h++) {
      // Deep copy horse data so we can attach mood
      var src = shuffled[h];
      raceHorses.push({
        id: src.id,
        name: src.name,
        color: src.color,
        stats: {
          speed: src.stats.speed,
          stamina: src.stats.stamina,
          acceleration: src.stats.acceleration,
          luck: src.stats.luck
        },
        skills: src.skills.slice()
      });
    }

    // Assign moods
    for (var mi = 0; mi < raceHorses.length; mi++) {
      var moodIdx = crypto.randomInt(MOOD_TYPES.length);
      raceHorses[mi].mood = MOOD_TYPES[moodIdx].name;
    }

    // Pick weather
    var weatherIdx = crypto.randomInt(WEATHER_TYPES.length);
    var weather = WEATHER_TYPES[weatherIdx];

    // Compute odds
    var odds = this._computeOdds(raceHorses, weather);

    this.currentRace = {
      horses: raceHorses,
      weather: weather,
      odds: odds
    };

    // Attach odds to each horse for client convenience
    for (var oi = 0; oi < raceHorses.length; oi++) {
      raceHorses[oi].odds = odds[raceHorses[oi].id] || 1.1;
    }

    // Broadcast pre-race state
    this._broadcastFn('hr_pre_race', {
      raceNumber: this.raceNumber,
      horses: raceHorses.map(function(h) {
        return {
          id: h.id,
          name: h.name,
          color: h.color,
          stats: h.stats,
          skills: h.skills,
          mood: h.mood,
          odds: h.odds
        };
      }),
      weather: { name: weather.name },
      odds: odds,
      phaseEndsAt: self.phaseEndsAt
    });

    // After 30s, start the race
    this.loopTimer = setTimeout(function() {
      self._startRacing();
    }, PRE_RACE_DURATION);
  }

  _startRacing() {
    var self = this;
    this.phase = 'racing';
    this.phaseEndsAt = Date.now() + RACING_DURATION;

    // Lock bets (no more changes)
    // Simulate the race
    this.raceResult = this._simulateRace();

    // Broadcast race start with simulation data
    this._broadcastFn('hr_race_start', {
      raceNumber: this.raceNumber,
      frames: this.raceResult.frames,
      events: this.raceResult.events,
      photoFinish: this.raceResult.photoFinish,
      duration: RACING_DURATION,
      phaseEndsAt: self.phaseEndsAt
    });

    // After 15s (animation plays on client), show results
    this.loopTimer = setTimeout(function() {
      self._showResults();
    }, RACING_DURATION);
  }

  _showResults() {
    var self = this;
    this.phase = 'results';
    this.phaseEndsAt = Date.now() + RESULTS_DURATION;

    var placements = this.raceResult.placements;
    var odds = this.currentRace.odds;

    // Build the base result payload (shared by all players)
    var basePayload = {
      raceNumber: this.raceNumber,
      placements: placements,
      photoFinish: this.raceResult.photoFinish,
      phaseEndsAt: this.phaseEndsAt
    };

    // Resolve bets and deliver per-player results (resolveBetFn handles emission)
    this._resolveBetFn(this.bets, placements, odds, basePayload);

    // After results, check if anyone is watching before starting next race
    this.loopTimer = setTimeout(function() {
      if (self.spectators.size === 0) {
        // No spectators — pause the race loop
        self.phase = 'idle';
        self.loopTimer = null;
        console.log('[horseracing] No spectators — pausing race loop');
      } else {
        self._startPreRace();
      }
    }, RESULTS_DURATION);
  }

  // Resume the race loop if idle (called when a spectator joins)
  resumeIfIdle() {
    if (this.phase === 'idle' && !this.loopTimer && this._broadcastFn) {
      console.log('[horseracing] Spectator joined — resuming race loop');
      this._startPreRace();
    }
  }

  // -----------------------------------------------------------------------
  // Chat
  // -----------------------------------------------------------------------

  addChat(socketId, name, color, message) {
    if (typeof message !== 'string') return null;
    var text = message.slice(0, 50);
    var msg = {
      id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
      name: name || 'Anon',
      color: color || '#dcddde',
      text: text,
      ts: Date.now()
    };
    this.chat.push(msg);
    if (this.chat.length > MAX_CHAT) this.chat.shift();
    return msg;
  }

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  reset() {
    this.stopRaceLoop();
    this.bets.clear();
    this.spectators.clear();
    this.currentRace = null;
    this.raceResult = null;
    this.chat = [];
    this.raceNumber = 0;
    this.horses = _generateHorses();
    this._lastGeneratedDate = _getTodayDateString();
  }
}

module.exports = { HorseRacingManager, MIN_BET, MAX_BET };
