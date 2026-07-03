// game.js — Server-side multiplayer orb game for BossCord

// ─── Spatial hash for O(n) collision detection ───
class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  clear() { this.cells.clear(); }

  _key(x, y) {
    return Math.floor(x / this.cellSize) + ',' + Math.floor(y / this.cellSize);
  }

  insert(entity) {
    const key = this._key(entity.x, entity.y);
    if (!this.cells.has(key)) this.cells.set(key, []);
    this.cells.get(key).push(entity);
  }

  getNearby(x, y, radius) {
    const results = [];
    const minCX = Math.floor((x - radius) / this.cellSize);
    const maxCX = Math.floor((x + radius) / this.cellSize);
    const minCY = Math.floor((y - radius) / this.cellSize);
    const maxCY = Math.floor((y + radius) / this.cellSize);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const cell = this.cells.get(cx + ',' + cy);
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            results.push(cell[i]);
          }
        }
      }
    }
    return results;
  }
}

const MAP_WIDTH = 6000;
const MAP_HEIGHT = 6000;
const ORB_COUNT = 400;
const ORB_MIN_RADIUS = 3;
const ORB_MAX_RADIUS = 12;
const PLAYER_START_RADIUS = 20;
const TICK_RATE = 10;
const BASE_SPEED = 8; // doubled from 4 to compensate for 10Hz tick (was 20Hz)
const BOOST_MULTIPLIER = 2.2;
const BOOST_MAX_FUEL = 100;
const BOOST_DRAIN_PER_TICK = 100 / (3 * TICK_RATE);   // 3 seconds of boost
const BOOST_REGEN_PER_TICK = 100 / (5 * TICK_RATE);   // 5 seconds to fully recharge

const ORB_COLORS = [
  '#ed4245', '#fee75c', '#57f287', '#5865f2',
  '#eb459e', '#f0b232', '#00bcd4', '#ff9800',
  '#e74c3c', '#1abc9c', '#9b59b6', '#2ecc71',
];

class Game {
  constructor() {
    this.players = new Map();
    this.orbs = new Map();
    this.nextOrbId = 0;
    this.bots = new Map(); // bot IDs
    this.botNames = ['Bot-Alpha', 'Bot-Bravo', 'Bot-Charlie'];
    this.botColors = ['#ed4245', '#57f287', '#5865f2'];
    // Spatial hashes for collision detection (cell size ~2x max player radius)
    this.orbHash = new SpatialHash(200);
    this.playerHash = new SpatialHash(200);

    for (let i = 0; i < ORB_COUNT; i++) {
      this._spawnOrb();
    }
  }

  _spawnOrb() {
    const id = 'o' + (this.nextOrbId++);
    // Weighted random: most orbs are small, few are large
    const roll = Math.random();
    let radius;
    if (roll < 0.6) {
      radius = ORB_MIN_RADIUS + Math.random() * 2;             // 3-5  (common)
    } else if (roll < 0.85) {
      radius = 5 + Math.random() * 3;                           // 5-8  (uncommon)
    } else if (roll < 0.95) {
      radius = 8 + Math.random() * 2.5;                         // 8-10.5 (rare)
    } else {
      radius = 10 + Math.random() * (ORB_MAX_RADIUS - 10);      // 10-12 (epic)
    }
    radius = Math.round(radius * 10) / 10;
    const value = Math.round(radius / ORB_MIN_RADIUS);           // 1-4 points
    const growAmount = radius * 0.25;                             // bigger orbs grow you more
    const orb = {
      id,
      x: Math.random() * MAP_WIDTH,
      y: Math.random() * MAP_HEIGHT,
      color: ORB_COLORS[Math.floor(Math.random() * ORB_COLORS.length)],
      radius,
      value,
      grow: Math.round(growAmount * 100) / 100,
    };
    this.orbs.set(id, orb);
    return orb;
  }

  addPlayer(socketId, name, color) {
    if (this.players.has(socketId)) return this.players.get(socketId);

    const x = 200 + Math.random() * (MAP_WIDTH - 400);
    const y = 200 + Math.random() * (MAP_HEIGHT - 400);
    const player = {
      id: socketId,
      name: (name || 'Anon').slice(0, 20),
      color: (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) ? color : '#5865f2',
      x, y,
      targetX: x,
      targetY: y,
      radius: PLAYER_START_RADIUS,
      score: 0,
      alive: true,
      boosting: false,
      boostFuel: BOOST_MAX_FUEL,
    };
    this.players.set(socketId, player);
    return player;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
  }

  updateInput(socketId, targetX, targetY, boost) {
    const p = this.players.get(socketId);
    if (!p || !p.alive) return;
    if (!isFinite(targetX) || !isFinite(targetY)) return;
    p.targetX = Math.max(0, Math.min(MAP_WIDTH, targetX));
    p.targetY = Math.max(0, Math.min(MAP_HEIGHT, targetY));
    p.boosting = !!boost;
  }

  addBots() {
    var maxBots = Math.max(0, 3 - this.getHumanCount());
    if (this.bots.size >= maxBots) return;
    for (let i = 0; i < 3 && this.bots.size < maxBots; i++) {
      const botId = 'bot_' + i;
      if (this.players.has(botId)) continue;
      const p = this.addPlayer(botId, this.botNames[i], this.botColors[i]);
      this.bots.set(botId, true);
    }
  }

  /** Remove one bot to make room for a human player */
  removeOneBot() {
    for (const botId of this.bots.keys()) {
      this.players.delete(botId);
      this.bots.delete(botId);
      return true;
    }
    return false;
  }

  removeBots() {
    for (const botId of this.bots.keys()) {
      this.players.delete(botId);
    }
    this.bots.clear();
  }

  getHumanCount() {
    let count = 0;
    for (const [id] of this.players) {
      if (!this.bots.has(id)) count++;
    }
    return count;
  }

  tick() {
    const eatenOrbs = [];
    const spawnedOrbs = [];
    const eatenPlayers = [];

    // Bot AI: update targets
    for (const [botId] of this.bots) {
      const bot = this.players.get(botId);
      if (!bot || !bot.alive) continue;

      // Find nearest orb
      let bestTarget = null;
      let bestDist = Infinity;

      // Check for nearby smaller players to chase
      for (const [, other] of this.players) {
        if (other.id === botId || !other.alive) continue;
        if (other.radius < bot.radius * 0.9) {
          const dx = other.x - bot.x;
          const dy = other.y - bot.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < bot.radius * 8 && dist < bestDist) {
            bestTarget = { x: other.x, y: other.y };
            bestDist = dist;
          }
        }
      }

      // Check for nearby larger players to flee from
      for (const [, other] of this.players) {
        if (other.id === botId || !other.alive) continue;
        if (other.radius > bot.radius * 1.1) {
          const dx = other.x - bot.x;
          const dy = other.y - bot.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < other.radius * 5) {
            // Flee: move away from the threat
            bestTarget = {
              x: bot.x - (dx / dist) * 200,
              y: bot.y - (dy / dist) * 200
            };
            bestDist = 0; // prioritize fleeing
            bot.boosting = bot.boostFuel > 30;
            break;
          }
        }
      }

      // Otherwise find nearest orb
      if (!bestTarget || bestDist > bot.radius * 8) {
        for (const [, orb] of this.orbs) {
          const dx = orb.x - bot.x;
          const dy = orb.y - bot.y;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist * bestDist || !bestTarget) {
            bestTarget = { x: orb.x, y: orb.y };
            bestDist = Math.sqrt(dist);
          }
        }
      }

      if (bestTarget) {
        bot.targetX = Math.max(0, Math.min(MAP_WIDTH, bestTarget.x));
        bot.targetY = Math.max(0, Math.min(MAP_HEIGHT, bestTarget.y));
      }
    }

    // Move players toward their target
    for (const [, p] of this.players) {
      if (!p.alive) continue;

      // Boost fuel management
      let speedMult = 1;
      if (p.boosting && p.boostFuel > 0) {
        p.boostFuel = Math.max(0, p.boostFuel - BOOST_DRAIN_PER_TICK);
        speedMult = BOOST_MULTIPLIER;
      } else {
        p.boosting = false;
        p.boostFuel = Math.min(BOOST_MAX_FUEL, p.boostFuel + BOOST_REGEN_PER_TICK);
      }

      const dx = p.targetX - p.x;
      const dy = p.targetY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 2) {
        const speed = (BASE_SPEED / Math.sqrt(p.radius / PLAYER_START_RADIUS)) * speedMult;
        const move = Math.min(speed, dist);
        p.x += (dx / dist) * move;
        p.y += (dy / dist) * move;
      }

      p.x = Math.max(p.radius, Math.min(MAP_WIDTH - p.radius, p.x));
      p.y = Math.max(p.radius, Math.min(MAP_HEIGHT - p.radius, p.y));
    }

    // Rebuild spatial hashes for this tick
    this.orbHash.clear();
    for (const [, orb] of this.orbs) {
      this.orbHash.insert(orb);
    }
    this.playerHash.clear();
    for (const [, p] of this.players) {
      if (p.alive) this.playerHash.insert(p);
    }

    // Check orb collisions using spatial hash
    for (const [, p] of this.players) {
      if (!p.alive) continue;
      const nearbyOrbs = this.orbHash.getNearby(p.x, p.y, p.radius);
      for (let i = 0; i < nearbyOrbs.length; i++) {
        const orb = nearbyOrbs[i];
        if (!this.orbs.has(orb.id)) continue; // already eaten this tick
        const dx = p.x - orb.x;
        const dy = p.y - orb.y;
        if (dx * dx + dy * dy < p.radius * p.radius) {
          p.radius += orb.grow || 0.5;
          p.score += orb.value || 1;
          eatenOrbs.push(orb.id);
          this.orbs.delete(orb.id);
          const newOrb = this._spawnOrb();
          spawnedOrbs.push(newOrb);
        }
      }
    }

    // Check player-player collisions using spatial hash
    const checked = new Set(); // avoid checking pair twice
    for (const [, a] of this.players) {
      if (!a.alive) continue;
      // Search radius: the larger of the two players could be up to ~2x this one
      const searchRadius = a.radius * 3;
      const nearby = this.playerHash.getNearby(a.x, a.y, searchRadius);
      for (let i = 0; i < nearby.length; i++) {
        const b = nearby[i];
        if (b.id === a.id || !b.alive) continue;
        // Deduplicate: use ordered pair key
        const pairKey = a.id < b.id ? a.id + '|' + b.id : b.id + '|' + a.id;
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (a.radius > b.radius * 1.05 && dist < a.radius - b.radius * 0.3) {
          a.radius = Math.sqrt(a.radius * a.radius + b.radius * b.radius);
          a.score += b.score + 10;
          b.alive = false;
          eatenPlayers.push({ eaten: b.id, eatenName: b.name, by: a.id, byName: a.name });
        } else if (b.radius > a.radius * 1.05 && dist < b.radius - a.radius * 0.3) {
          b.radius = Math.sqrt(b.radius * b.radius + a.radius * a.radius);
          b.score += a.score + 10;
          a.alive = false;
          eatenPlayers.push({ eaten: a.id, eatenName: a.name, by: b.id, byName: b.name });
        }
      }
    }

    // Remove dead players
    for (const ep of eatenPlayers) {
      this.players.delete(ep.eaten);
    }

    // Respawn dead bots
    for (const [botId] of this.bots) {
      if (!this.players.has(botId)) {
        const idx = parseInt(botId.split('_')[1]);
        const p = this.addPlayer(botId, this.botNames[idx] || 'Bot', this.botColors[idx] || '#ed4245');
        // Start smaller after death
        p.radius = PLAYER_START_RADIUS;
        p.score = 0;
      }
    }

    return { eatenOrbs, spawnedOrbs, eatenPlayers };
  }

  getFullState() {
    return {
      players: this._serializePlayers(),
      orbs: Array.from(this.orbs.values()),
      mapWidth: MAP_WIDTH,
      mapHeight: MAP_HEIGHT,
      leaderboard: this._leaderboard(),
    };
  }

  getPlayersState() {
    return {
      players: this._serializePlayers(),
      leaderboard: this._leaderboard(),
    };
  }

  /**
   * Get viewport-culled state for a specific player.
   * Only returns entities within the player's visible area.
   * Reduces bandwidth from O(all) to O(nearby) per client.
   */
  getViewportState(socketId, viewW, viewH) {
    const p = this.players.get(socketId);
    if (!p || !p.alive) return this.getPlayersState(); // fallback for spectators
    viewW = viewW || 1600;
    viewH = viewH || 1200;
    const halfW = viewW * 0.6; // slight buffer beyond visible edge
    const halfH = viewH * 0.6;

    const players = [];
    for (const [, other] of this.players) {
      if (!other.alive) continue;
      if (Math.abs(other.x - p.x) < halfW && Math.abs(other.y - p.y) < halfH) {
        players.push({
          id: other.id, name: other.name, color: other.color,
          x: Math.round(other.x * 10) / 10,
          y: Math.round(other.y * 10) / 10,
          radius: Math.round(other.radius * 10) / 10,
          score: other.score,
          boost: Math.round(other.boostFuel),
        });
      }
    }

    return { players, leaderboard: this._leaderboard() };
  }

  _serializePlayers() {
    const out = [];
    for (const [, p] of this.players) {
      if (!p.alive) continue;
      out.push({
        id: p.id, name: p.name, color: p.color,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        radius: Math.round(p.radius * 10) / 10,
        score: p.score,
        boost: Math.round(p.boostFuel),
      });
    }
    return out;
  }

  _leaderboard() {
    return Array.from(this.players.values())
      .filter(p => p.alive)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(p => ({ name: p.name, score: p.score }));
  }

  reset() {
    this.players.clear();
    this.orbs.clear();
    this.bots.clear();
    this.nextOrbId = 0;
    for (let i = 0; i < ORB_COUNT; i++) {
      this._spawnOrb();
    }
  }
}

// ---------------------------------------------------------------------------
// Multi-instance game manager — allows multiple BossOrbs lobbies
// ---------------------------------------------------------------------------
const MAX_PLAYERS_PER_INSTANCE = 100; // soft cap per instance before suggesting new lobby
const MAX_GAME_INSTANCES = 10;

class GameManager {
  constructor() {
    this.instances = new Map(); // instanceId -> Game
    this.playerInstance = new Map(); // socketId -> instanceId
    // Create default "main" instance
    this.instances.set('main', new Game());
  }

  getOrCreateInstance(instanceId) {
    if (this.instances.has(instanceId)) return this.instances.get(instanceId);
    if (this.instances.size >= MAX_GAME_INSTANCES) return null;
    const game = new Game();
    this.instances.set(instanceId, game);
    return game;
  }

  /** Find the best instance for a player (smallest with room) or create one */
  findBestInstance() {
    let best = null;
    let bestCount = Infinity;
    for (const [id, game] of this.instances) {
      const count = game.getHumanCount();
      if (count < MAX_PLAYERS_PER_INSTANCE && count < bestCount) {
        best = id;
        bestCount = count;
      }
    }
    if (best) return best;
    // All full — create new instance
    if (this.instances.size >= MAX_GAME_INSTANCES) return 'main'; // fallback
    const newId = 'orbs_' + require('crypto').randomBytes(4).toString('hex');
    this.instances.set(newId, new Game());
    return newId;
  }

  addPlayer(socketId, instanceId, name, color) {
    const game = this.instances.get(instanceId);
    if (!game) return null;
    this.playerInstance.set(socketId, instanceId);
    return game.addPlayer(socketId, name, color);
  }

  removePlayer(socketId) {
    const instanceId = this.playerInstance.get(socketId);
    if (!instanceId) return;
    const game = this.instances.get(instanceId);
    if (game) game.removePlayer(socketId);
    this.playerInstance.delete(socketId);
    // Cleanup empty non-main instances
    if (instanceId !== 'main' && game && game.getHumanCount() === 0) {
      game.removeBots();
      this.instances.delete(instanceId);
    }
  }

  getPlayerInstance(socketId) {
    return this.playerInstance.get(socketId) || null;
  }

  getInstance(instanceId) {
    return this.instances.get(instanceId) || null;
  }

  /** Get list of all instances for lobby browser */
  getInstanceList() {
    const list = [];
    for (const [id, game] of this.instances) {
      list.push({
        id: id,
        playerCount: game.players.size,
        humanCount: game.getHumanCount(),
        maxPlayers: MAX_PLAYERS_PER_INSTANCE,
      });
    }
    return list;
  }

  /** Tick all active instances. Returns Map<instanceId, tickResult> */
  tickAll() {
    const results = new Map();
    for (const [id, game] of this.instances) {
      if (game.players.size === 0) continue;
      // Remove any remaining bots — bots are disabled
      if (game.bots.size > 0) game.removeBots();
      results.set(id, game.tick());
    }
    return results;
  }

  reset() {
    for (const [, game] of this.instances) {
      game.reset();
    }
    this.instances.clear();
    this.playerInstance.clear();
    this.instances.set('main', new Game());
  }
}

module.exports = { Game, GameManager, TICK_RATE, MAP_WIDTH, MAP_HEIGHT, MAX_PLAYERS_PER_INSTANCE };
