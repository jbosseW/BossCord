// liero.js — BossBrawl server engine
// Destructible terrain, physics, weapons, spells, bots, lobby management

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

// Physics tick scale: all physics values were authored for 20Hz.
// At 10Hz each tick covers 2x the real time, so velocities and
// accelerations are multiplied by TICK_SCALE, while tick-count
// durations (cooldowns, intervals, respawn) are halved.
var TICK_SCALE = 2;  // = oldTickRate / newTickRate = 20 / 10

var GRAVITY = 0.15 * TICK_SCALE;
var MOVE_SPEED = 2.5 * TICK_SCALE;
var JUMP_SPEED = -4.5 * TICK_SCALE;
var MAX_FALL = 6 * TICK_SCALE;
var PLAYER_W = 12;
var PLAYER_H = 16;
var MAP_W = 1200;
var MAP_H = 800;
var PICKUP_INTERVAL = 100;   // ticks between weapon pickup spawns (was 200 at 20Hz)
var SPELL_PICKUP_INTERVAL = 300; // was 600 at 20Hz
var RESPAWN_TICKS = 30;      // 3 seconds at 10Hz
var MAX_LIERO_LOBBIES = 15;

var BOT_NAMES = ['Grunt', 'Slayer', 'Wraith', 'Viper', 'Shadow', 'Blaze', 'Storm', 'Reaper'];
var BOT_COLORS = ['#ed4245', '#57f287', '#5865f2', '#f0b232', '#9b59b6', '#00d4ff', '#ff69b4', '#ff4500'];

// ═══════════════════════════════════════════════════════════════════════════
// Noise helpers
// ═══════════════════════════════════════════════════════════════════════════

function hashNoise(x, y, seed) {
  var n = Math.sin(x * 12.9898 + y * 78.233 + seed * 43.12) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x, y, seed) {
  var ix = Math.floor(x), iy = Math.floor(y);
  var fx = x - ix, fy = y - iy;
  var a = hashNoise(ix, iy, seed);
  var b = hashNoise(ix + 1, iy, seed);
  var c = hashNoise(ix, iy + 1, seed);
  var d = hashNoise(ix + 1, iy + 1, seed);
  var ux = fx * fx * (3 - 2 * fx);
  var uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fractalNoise(x, y, seed, octaves) {
  var val = 0, amp = 1, freq = 1, maxVal = 0;
  for (var i = 0; i < octaves; i++) {
    val += smoothNoise(x * freq, y * freq, seed + i * 17) * amp;
    maxVal += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / maxVal;
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ═══════════════════════════════════════════════════════════════════════════
// Weapon definitions
// ═══════════════════════════════════════════════════════════════════════════

var WEAPONS = [
  // Defaults (always available)
  { id: 'default_dagger', name: 'Rusty Dagger', category: 'melee', damage: 15, cooldown: 6, range: 18, arc: Math.PI / 2, explosionRadius: 4 },
  { id: 'default_bow', name: 'Hunting Bow', category: 'ranged', damage: 15, cooldown: 12, projectileSpeed: 8, gravity: 0.1, explosionRadius: 5 },
  // Swords
  { id: 'wpn_sword1', name: 'Short Sword', category: 'melee', damage: 20, cooldown: 8, range: 20, arc: Math.PI / 2, explosionRadius: 0 },
  { id: 'wpn_sword3', name: 'Iron Sword', category: 'melee', damage: 22, cooldown: 9, range: 20, arc: Math.PI / 2, explosionRadius: 0 },
  { id: 'wpn_sword8', name: 'Steel Longsword', category: 'melee', damage: 28, cooldown: 10, range: 22, arc: Math.PI / 2, explosionRadius: 0 },
  { id: 'wpn_sword15', name: 'Flameblade', category: 'melee', damage: 35, cooldown: 11, range: 22, arc: Math.PI / 2, explosionRadius: 6 },
  { id: 'wpn_sword20', name: 'Voidblade', category: 'melee', damage: 42, cooldown: 12, range: 24, arc: Math.PI / 2, explosionRadius: 8 },
  { id: 'wpn_sword25', name: 'Excalibur', category: 'melee', damage: 48, cooldown: 11, range: 26, arc: Math.PI / 2, explosionRadius: 10 },
  { id: 'wpn_sword12', name: 'Runeblade', category: 'melee', damage: 38, cooldown: 10, range: 22, arc: Math.PI / 2, explosionRadius: 4 },
  { id: 'wpn_sword30', name: 'Worldender', category: 'melee', damage: 55, cooldown: 12, range: 28, arc: Math.PI * 0.6, explosionRadius: 12 },
  // Daggers
  { id: 'wpn_dagger1', name: 'Rusty Dagger', category: 'melee', damage: 16, cooldown: 4, range: 15, arc: Math.PI / 3, explosionRadius: 0 },
  { id: 'wpn_dagger3', name: 'Bronze Dagger', category: 'melee', damage: 20, cooldown: 5, range: 16, arc: Math.PI / 3, explosionRadius: 0 },
  // Axes
  { id: 'wpn_axe3', name: 'Battle Axe', category: 'melee', damage: 30, cooldown: 12, range: 18, arc: Math.PI / 2, explosionRadius: 8 },
  { id: 'wpn_axe7', name: 'War Axe', category: 'melee', damage: 35, cooldown: 13, range: 18, arc: Math.PI / 2, explosionRadius: 10 },
  { id: 'wpn_axe12', name: 'Berserker Axe', category: 'melee', damage: 45, cooldown: 14, range: 20, arc: Math.PI / 2, explosionRadius: 12 },
  // Hammers
  { id: 'wpn_hammer3', name: 'War Hammer', category: 'melee', damage: 40, cooldown: 16, range: 18, arc: Math.PI / 2, explosionRadius: 14 },
  { id: 'wpn_hammer_big', name: 'Thunderhammer', category: 'melee', damage: 55, cooldown: 18, range: 20, arc: Math.PI / 2, explosionRadius: 18 },
  // Scythes
  { id: 'wpn_scythe3', name: 'Death Scythe', category: 'melee', damage: 38, cooldown: 14, range: 22, arc: Math.PI * 2 / 3, explosionRadius: 0 },
  { id: 'wpn_scythe5', name: 'Soul Reaper', category: 'melee', damage: 45, cooldown: 16, range: 24, arc: Math.PI * 2 / 3, explosionRadius: 0 },
  // Bows
  { id: 'wpn_bow1', name: 'Hunting Bow', category: 'ranged', damage: 18, cooldown: 10, projectileSpeed: 9, gravity: 0.1, explosionRadius: 0 },
  { id: 'wpn_bow5', name: 'Composite Bow', category: 'ranged', damage: 25, cooldown: 10, projectileSpeed: 11, gravity: 0.08, explosionRadius: 0 },
  { id: 'wpn_bow_war', name: 'War Bow', category: 'ranged', damage: 30, cooldown: 12, projectileSpeed: 12, gravity: 0.06, explosionRadius: 0 },
  // Crossbows
  { id: 'wpn_crossbow3', name: 'Heavy Crossbow', category: 'ranged', damage: 28, cooldown: 14, projectileSpeed: 15, gravity: 0.02, explosionRadius: 0 },
  { id: 'wpn_crossbow_auto', name: 'Repeating Crossbow', category: 'ranged', damage: 20, cooldown: 8, projectileSpeed: 14, gravity: 0.02, explosionRadius: 0 },
  // Spears
  { id: 'wpn_spear1', name: 'Wooden Spear', category: 'ranged', damage: 22, cooldown: 12, projectileSpeed: 7, gravity: 0.12, explosionRadius: 6 },
  { id: 'wpn_spear_iron', name: 'Iron Javelin', category: 'ranged', damage: 28, cooldown: 14, projectileSpeed: 8, gravity: 0.1, explosionRadius: 8 },
  { id: 'wpn_spear_explosive', name: 'Explosive Spear', category: 'ranged', damage: 35, cooldown: 16, projectileSpeed: 7, gravity: 0.12, explosionRadius: 14 },
  // Bolts
  { id: 'wpn_bolt_heavy', name: 'Heavy Bolt', category: 'ranged', damage: 30, cooldown: 18, projectileSpeed: 6, gravity: 0.15, explosionRadius: 12 },
  { id: 'wpn_bolt_fire', name: 'Fire Bolt', category: 'ranged', damage: 40, cooldown: 20, projectileSpeed: 5, gravity: 0.15, explosionRadius: 16 },
  // Shields
  { id: 'wpn_shield3', name: 'Iron Shield', category: 'shield', damage: 0, cooldown: 20, blockPercent: 0.6, blockDuration: 20 },
  { id: 'wpn_shield8', name: 'Tower Shield', category: 'shield', damage: 0, cooldown: 24, blockPercent: 0.8, blockDuration: 25 },
  { id: 'wpn_shield_magic', name: 'Arcane Barrier', category: 'shield', damage: 0, cooldown: 30, blockPercent: 1.0, blockDuration: 15 },
  // Staves
  { id: 'wpn_staff5', name: 'Arcane Staff', category: 'staff', damage: 10, cooldown: 8, projectileSpeed: 6, gravity: 0, explosionRadius: 4, spellCooldownReduction: 0.2 },
  { id: 'wpn_staff10', name: 'Elder Staff', category: 'staff', damage: 12, cooldown: 8, projectileSpeed: 7, gravity: 0, explosionRadius: 6, spellCooldownReduction: 0.2 },
  { id: 'wpn_staff15', name: 'Staff of Eternity', category: 'staff', damage: 15, cooldown: 8, projectileSpeed: 8, gravity: 0, explosionRadius: 8, spellCooldownReduction: 0.2 },
  { id: 'wpn_wand3', name: 'Mystic Wand', category: 'staff', damage: 14, cooldown: 6, projectileSpeed: 10, gravity: 0, explosionRadius: 0, spellCooldownReduction: 0.15 },
  { id: 'wpn_hook3', name: 'Chain Hook', category: 'ranged', damage: 20, cooldown: 16, projectileSpeed: 10, gravity: 0, explosionRadius: 0 },
  // Throwing Knives
  { id: 'wpn_throwing_knives', name: 'Throwing Knives', category: 'ranged', damage: 12, cooldown: 4, projectileSpeed: 14, gravity: 0.05, explosionRadius: 0, projectileCount: 3, spread: 0.15 },
  // Flail
  { id: 'wpn_flail', name: 'Flail', category: 'melee', damage: 38, cooldown: 16, range: 26, arc: Math.PI * 0.8, explosionRadius: 10 },
  // Poison Dagger
  { id: 'wpn_poison_dagger', name: 'Poison Dagger', category: 'melee', damage: 8, cooldown: 5, range: 16, arc: Math.PI / 3, explosionRadius: 0, poisonDamage: 3, poisonDuration: 20 },
  // Ice Bow
  { id: 'wpn_ice_bow', name: 'Ice Bow', category: 'ranged', damage: 22, cooldown: 12, projectileSpeed: 10, gravity: 0.08, explosionRadius: 0, slowEffect: 0.5, slowDuration: 30 },
  // Lightning Rod
  { id: 'wpn_lightning_rod', name: 'Lightning Rod', category: 'staff', damage: 18, cooldown: 10, projectileSpeed: 8, gravity: 0, explosionRadius: 0, chainDamage: 10, chainRange: 80, spellCooldownReduction: 0.15 },
  // Explosive Shield
  { id: 'wpn_explosive_shield', name: 'Explosive Shield', category: 'shield', damage: 0, cooldown: 24, blockPercent: 0.7, blockDuration: 20, explosionDamage: 15, explosionRadius: 20 },
];

var WEAPON_MAP = new Map();
for (var wi = 0; wi < WEAPONS.length; wi++) WEAPON_MAP.set(WEAPONS[wi].id, WEAPONS[wi]);

var RANGED_WEAPON_IDS = WEAPONS.filter(function(w) { return w.category === 'ranged' || w.category === 'staff'; }).map(function(w) { return w.id; });
var MELEE_WEAPON_IDS = WEAPONS.filter(function(w) { return w.category === 'melee'; }).map(function(w) { return w.id; });
var ALL_WEAPON_IDS = WEAPONS.map(function(w) { return w.id; });

// ═══════════════════════════════════════════════════════════════════════════
// Spell definitions
// ═══════════════════════════════════════════════════════════════════════════

var SPELLS = [
  { id: 'fireball', name: 'Fireball', cooldown: 100, type: 'projectile', damage: 40, radius: 40, projectileSpeed: 7, gravity: 0.05 },
  { id: 'healing_light', name: 'Healing Light', cooldown: 120, type: 'instant', healAmount: 40 },
  { id: 'blink', name: 'Blink', cooldown: 80, type: 'instant', teleportDist: 100 },
  { id: 'ice_wall', name: 'Ice Wall', cooldown: 140, type: 'terrain', createRadius: 15, terrainVal: 2 },
  { id: 'meteor_strike', name: 'Meteor Strike', cooldown: 200, type: 'multi_projectile', count: 3, damage: 30, radius: 30, projectileSpeed: 6, gravity: 0.2 },
  { id: 'chain_lightning', name: 'Chain Lightning', cooldown: 100, type: 'instant', damage: 30, range: 200, chains: 1 },
  { id: 'arcane_shield', name: 'Arcane Shield', cooldown: 160, type: 'buff', buffId: 'arcane_shield', duration: 40 },
  { id: 'toxic_cloud', name: 'Toxic Cloud', cooldown: 120, type: 'aoe', damage: 5, radius: 40, duration: 60 },
  { id: 'haste', name: 'Haste', cooldown: 100, type: 'buff', buffId: 'haste', duration: 60, speedMultiplier: 2 },
  { id: 'gravity_well', name: 'Gravity Well', cooldown: 140, type: 'aoe', radius: 60, duration: 40, pullForce: 1.5 },
  { id: 'mine_layer', name: 'Mine Layer', cooldown: 120, type: 'mine', count: 3, damage: 30, radius: 20 },
  { id: 'arcane_cleave', name: 'Arcane Cleave', cooldown: 80, type: 'instant', damage: 35, range: 30, arc: Math.PI },
  { id: 'true_shot', name: 'True Shot', cooldown: 100, type: 'instant', damage: 50, range: 500 },
  { id: 'scatter_shot', name: 'Scatter Shot', cooldown: 80, type: 'multi_projectile', count: 5, damage: 10, radius: 0, projectileSpeed: 8, gravity: 0.08, spread: 0.4 },
  { id: 'tunnel', name: 'Tunnel', cooldown: 60, type: 'terrain_destroy', radius: 30 },
  { id: 'summon_turret', name: 'Summon Turret', cooldown: 200, type: 'summon', duration: 100, damage: 8, fireRate: 10, range: 180 },
  { id: 'soul_swap', name: 'Soul Swap', cooldown: 160, type: 'instant', range: 300 },
  { id: 'regeneration', name: 'Regeneration', cooldown: 140, type: 'buff', buffId: 'regen', duration: 60, healPerTick: 2 },
  { id: 'earthquake', name: 'Earthquake', cooldown: 180, type: 'terrain_destroy', radius: 100, damage: 20 },
  { id: 'boomerang', name: 'Boomerang', cooldown: 80, type: 'projectile', damage: 20, radius: 0, projectileSpeed: 6, gravity: 0, boomerang: true },
  { id: 'bear_trap', name: 'Bear Trap', cooldown: 100, type: 'mine', count: 1, damage: 10, radius: 8, immobilize: 40 },
  { id: 'battle_rage', name: 'Battle Rage', cooldown: 160, type: 'buff', buffId: 'battle_rage', duration: 60, damageMultiplier: 2 },
  { id: 'invisibility', name: 'Invisibility', cooldown: 140, type: 'buff', buffId: 'invisibility', duration: 60 },
  { id: 'arrow_volley', name: 'Arrow Volley', cooldown: 120, type: 'multi_projectile', count: 8, damage: 15, radius: 6, projectileSpeed: 4, gravity: 0.3, spread: 0.8, rain: true },
  { id: 'annihilation', name: 'Annihilation', cooldown: 300, type: 'projectile', damage: 60, radius: 80, projectileSpeed: 5, gravity: 0.03 },
  // New spells
  { id: 'frost_nova', name: 'Frost Nova', cooldown: 120, type: 'aoe_slow', damage: 15, radius: 60, slowEffect: 0.4, slowDuration: 40 },
  { id: 'poison_cloud', name: 'Poison Cloud', cooldown: 130, type: 'aoe_dot', damage: 8, radius: 50, duration: 50, tickDamage: 3 },
  { id: 'mirror_image', name: 'Mirror Image', cooldown: 140, type: 'decoy', duration: 80 },
  { id: 'grapple', name: 'Grapple', cooldown: 100, type: 'pull', range: 150, damage: 10 },
  { id: 'stone_skin', name: 'Stone Skin', cooldown: 150, type: 'buff', buffId: 'stone_skin', duration: 40, damageReduction: 0.5 },
  { id: 'phoenix_rebirth', name: 'Phoenix Rebirth', cooldown: 300, type: 'buff', buffId: 'phoenix_rebirth', duration: 200, reviveHp: 50 },
];

var SPELL_MAP = new Map();
for (var si = 0; si < SPELLS.length; si++) SPELL_MAP.set(SPELLS[si].id, SPELLS[si]);

// ═══════════════════════════════════════════════════════════════════════════
// Terrain
// ═══════════════════════════════════════════════════════════════════════════

class Terrain {
  constructor(width, height, mapType) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);
    this.generate(mapType || 'caves');
  }

  get(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 3;
    return this.data[y * this.width + x];
  }

  set(x, y, val) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this.data[y * this.width + x] = val;
  }

  isSolid(x, y) {
    return this.get(Math.floor(x), Math.floor(y)) > 0;
  }

  generate(mapType) {
    var seed = Math.random() * 10000;
    var w = this.width, h = this.height;

    // Fill everything with dirt
    this.data.fill(1);

    // Sky (top portion)
    var skyHeight = mapType === 'open' ? Math.floor(h * 0.5) : Math.floor(h * 0.15);
    for (var y = 0; y < skyHeight; y++) {
      for (var x = 0; x < w; x++) {
        this.data[y * w + x] = 0;
      }
    }

    // Carve caves/tunnels using noise
    if (mapType === 'caves') {
      for (var y = skyHeight; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var n = fractalNoise(x / 40, y / 40, seed, 4);
          if (n < 0.42) this.data[y * w + x] = 0;
        }
      }
    } else if (mapType === 'tunnels') {
      // Horizontal tunnels
      for (var t = 0; t < 5; t++) {
        var ty = skyHeight + Math.floor((h - skyHeight) * (t + 1) / 6);
        var tunnelH = 20 + Math.floor(Math.random() * 15);
        for (var y = ty - tunnelH / 2; y < ty + tunnelH / 2; y++) {
          for (var x = 0; x < w; x++) {
            var yi = Math.floor(y);
            if (yi >= 0 && yi < h) {
              var warp = Math.sin(x / 60 + seed + t) * 8;
              var yy = Math.floor(y + warp);
              if (yy >= 0 && yy < h) this.data[yy * w + x] = 0;
            }
          }
        }
      }
      // Vertical connectors
      for (var c = 0; c < 8; c++) {
        var cx = 50 + Math.floor(Math.random() * (w - 100));
        var connW = 8 + Math.floor(Math.random() * 10);
        for (var y = skyHeight; y < h - 3; y++) {
          for (var dx = 0; dx < connW; dx++) {
            var xx = cx + dx;
            if (xx >= 0 && xx < w) this.data[y * w + xx] = 0;
          }
        }
      }
    } else if (mapType === 'open') {
      // Mostly open with some platforms
      for (var y = skyHeight; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var n = fractalNoise(x / 80, y / 80, seed, 3);
          if (n < 0.55) this.data[y * w + x] = 0;
        }
      }
      // Ensure a floor
      for (var x = 0; x < w; x++) {
        for (var y = h - 30; y < h; y++) {
          if (this.data[y * w + x] === 0) {
            var n2 = fractalNoise(x / 20, y / 20, seed + 100, 2);
            if (n2 > 0.35) this.data[y * w + x] = 1;
          }
        }
      }
    }

    // Scatter rock (val 2)
    for (var y = skyHeight; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (this.data[y * w + x] === 1) {
          var rn = hashNoise(x, y, seed + 500);
          if (rn < 0.08) this.data[y * w + x] = 2;
        }
      }
    }

    // Indestructible border (val 3), 2px thick
    for (var x = 0; x < w; x++) {
      this.data[0 * w + x] = 3; this.data[1 * w + x] = 3;
      this.data[(h - 1) * w + x] = 3; this.data[(h - 2) * w + x] = 3;
    }
    for (var y = 0; y < h; y++) {
      this.data[y * w + 0] = 3; this.data[y * w + 1] = 3;
      this.data[y * w + w - 1] = 3; this.data[y * w + w - 2] = 3;
    }
  }

  destroyCircle(cx, cy, radius) {
    var deltas = [];
    var r2 = radius * radius;
    var x0 = Math.max(2, Math.floor(cx - radius));
    var x1 = Math.min(this.width - 3, Math.ceil(cx + radius));
    var y0 = Math.max(2, Math.floor(cy - radius));
    var y1 = Math.min(this.height - 3, Math.ceil(cy + radius));
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          var val = this.data[y * this.width + x];
          if (val === 1 || val === 2) {
            this.data[y * this.width + x] = 0;
            deltas.push({ x: x, y: y, val: 0 });
          }
        }
      }
    }
    return deltas;
  }

  createCircle(cx, cy, radius, val) {
    var deltas = [];
    var r2 = radius * radius;
    var x0 = Math.max(2, Math.floor(cx - radius));
    var x1 = Math.min(this.width - 3, Math.ceil(cx + radius));
    var y0 = Math.max(2, Math.floor(cy - radius));
    var y1 = Math.min(this.height - 3, Math.ceil(cy + radius));
    for (var y = y0; y <= y1; y++) {
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2 && this.data[y * this.width + x] === 0) {
          this.data[y * this.width + x] = val;
          deltas.push({ x: x, y: y, val: val });
        }
      }
    }
    return deltas;
  }

  findSafeSpawn() {
    for (var attempt = 0; attempt < 200; attempt++) {
      var x = 20 + Math.floor(Math.random() * (this.width - 40));
      var y = 10 + Math.floor(Math.random() * (this.height - 40));
      // Need air at head and feet, solid below feet
      if (!this.isSolid(x, y) && !this.isSolid(x, y + PLAYER_H - 1) && this.isSolid(x, y + PLAYER_H)) {
        return { x: x, y: y };
      }
    }
    // Fallback: top center
    return { x: Math.floor(this.width / 2), y: 20 };
  }

  serialize() {
    return Buffer.from(this.data.buffer, this.data.byteOffset, this.data.byteLength);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Collision helpers
// ═══════════════════════════════════════════════════════════════════════════

function collidesWithTerrain(x, y, w, h, terrain) {
  var x1 = Math.floor(x), y1 = Math.floor(y);
  var x2 = Math.floor(x + w - 1), y2 = Math.floor(y + h - 1);
  // Check corners + midpoints
  if (terrain.isSolid(x1, y1)) return true;
  if (terrain.isSolid(x2, y1)) return true;
  if (terrain.isSolid(x1, y2)) return true;
  if (terrain.isSolid(x2, y2)) return true;
  if (terrain.isSolid(Math.floor(x + w / 2), y2)) return true;
  if (terrain.isSolid(Math.floor(x + w / 2), y1)) return true;
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// Game class
// ═══════════════════════════════════════════════════════════════════════════

class LieroGame {
  constructor(settings) {
    this.terrain = new Terrain(MAP_W, MAP_H, settings.mapType || 'caves');
    this.players = new Map();
    this.projectiles = [];
    this.pickups = [];
    this.turrets = [];
    this.mines = [];
    this.toxicClouds = [];
    this.gravityWells = [];
    this.decoys = [];
    this.scoreLimit = settings.scoreLimit || 50;
    this.tickCount = 0;
    this.gameOver = false;
    this.winner = null;
    this.lastPickupTick = 0;
    this.lastSpellPickupTick = 0;
    this.pendingEvents = this._freshEvents();
  }

  _freshEvents() {
    return { kills: [], respawns: [], terrainDeltas: [], pickupSpawns: [], pickupCollections: [], spellCasts: [] };
  }

  addPlayer(id, name, color, weapons, spell, isBot) {
    var pos = this.terrain.findSafeSpawn();
    this.players.set(id, {
      id: id, name: name, color: color,
      x: pos.x, y: pos.y, vx: 0, vy: 0, grounded: false,
      hp: 100, maxHp: 100, alive: true, respawnTimer: 0,
      aimAngle: 0,
      weapons: weapons || ['default_dagger', 'default_bow'],
      currentWeaponIdx: 0, weaponCooldown: 0,
      spellbook: spell || null, spellCooldown: 0,
      score: 0, isBot: !!isBot,
      input: { left: false, right: false, jump: false, fire: false, spell: false, aimAngle: 0, switchWeapon: 0 },
      botState: 'wander', botTarget: null, botStateTimer: 0,
      buffs: {}, blocking: false, blockTimer: 0, blockPercent: 0,
      blockExplosionDamage: 0, blockExplosionRadius: 0,
      invisible: false, damageMultiplier: 1, speedMultiplier: 1,
      immobilized: false, immobileTimer: 0,
    });
  }

  removePlayer(id) {
    this.players.delete(id);
  }

  tick() {
    if (this.gameOver) return;
    this.tickCount++;
    this.pendingEvents = this._freshEvents();

    // Process bots
    for (var [pid, p] of this.players) {
      if (p.isBot && p.alive) updateBotAI(p, this);
    }

    // Process each player
    for (var [pid, p] of this.players) {
      if (!p.alive) {
        p.respawnTimer -= TICK_SCALE;
        if (p.respawnTimer <= 0) {
          var pos = this.terrain.findSafeSpawn();
          p.x = pos.x; p.y = pos.y; p.vx = 0; p.vy = 0;
          p.hp = p.maxHp; p.alive = true;
          p.buffs = {}; p.invisible = false; p.damageMultiplier = 1; p.speedMultiplier = 1;
          p.immobilized = false; p.immobileTimer = 0; p.blocking = false;
          this.pendingEvents.respawns.push({ playerId: p.id, x: p.x, y: p.y });
        }
        continue;
      }

      // Movement
      movePlayer(p, this.terrain);

      // Weapon cooldown (scale for tick rate)
      if (p.weaponCooldown > 0) p.weaponCooldown -= TICK_SCALE;

      // Spell cooldown (scale for tick rate)
      if (p.spellCooldown > 0) p.spellCooldown -= TICK_SCALE;

      // Block timer (scale for tick rate)
      if (p.blocking) {
        p.blockTimer -= TICK_SCALE;
        if (p.blockTimer <= 0) {
          p.blocking = false;
          // Explosive Shield detonation
          if (p.blockExplosionDamage && p.blockExplosionDamage > 0) {
            var beCx = p.x + PLAYER_W / 2;
            var beCy = p.y + PLAYER_H / 2;
            var beDeltas = game.terrain.destroyCircle(beCx, beCy, p.blockExplosionRadius || 20);
            for (var bed = 0; bed < beDeltas.length; bed++) game.pendingEvents.terrainDeltas.push(beDeltas[bed]);
            for (var [bePid, beP] of game.players) {
              if (bePid === p.id || !beP.alive) continue;
              var beDx = (beP.x + PLAYER_W / 2) - beCx;
              var beDy = (beP.y + PLAYER_H / 2) - beCy;
              if (Math.sqrt(beDx * beDx + beDy * beDy) < (p.blockExplosionRadius || 20) + PLAYER_W) {
                damagePlayer(beP, p.blockExplosionDamage, p, 'explosive_shield', game);
              }
            }
            p.blockExplosionDamage = 0;
            p.blockExplosionRadius = 0;
          }
        }
      }

      // Immobile timer (scale for tick rate)
      if (p.immobilized) {
        p.immobileTimer -= TICK_SCALE;
        if (p.immobileTimer <= 0) p.immobilized = false;
      }

      // Process buffs (scale for tick rate)
      for (var buffId in p.buffs) {
        var buff = p.buffs[buffId];
        buff.remaining -= TICK_SCALE;
        if (buffId === 'regen' && buff.remaining > 0) {
          p.hp = Math.min(p.maxHp, p.hp + (buff.healPerTick || 2));
        }
        if (buffId === 'poison' && buff.remaining > 0 && buff.remaining % 3 === 0) {
          var poisonAttacker = game.players.get(buff.ownerId);
          damagePlayer(p, buff.poisonDamage || 3, poisonAttacker || null, 'poison', game);
        }
        if (buff.remaining <= 0) {
          delete p.buffs[buffId];
          // Remove buff effects
          if (buffId === 'haste') p.speedMultiplier = 1;
          if (buffId === 'battle_rage') p.damageMultiplier = 1;
          if (buffId === 'invisibility') p.invisible = false;
          if (buffId === 'slow' && buff.speedRestore) p.speedMultiplier = 1;
          if (buffId === 'stone_skin') { /* damageReduction handled in damagePlayer */ }
        }
      }

      // Fire weapon
      if (p.input.fire && p.weaponCooldown <= 0 && !p.blocking) {
        fireWeapon(p, this);
      }

      // Cast spell
      if (p.input.spell && p.spellCooldown <= 0 && p.spellbook) {
        castSpell(p, this);
      }

      // Weapon switch from input
      if (p.input.switchWeapon !== 0 && p.weapons.length > 1) {
        p.currentWeaponIdx = ((p.currentWeaponIdx + p.input.switchWeapon) % p.weapons.length + p.weapons.length) % p.weapons.length;
        p.input.switchWeapon = 0;
      }
    }

    // Move projectiles
    this._processProjectiles();

    // Process turrets
    this._processTurrets();

    // Process mines
    this._processMines();

    // Process toxic clouds
    this._processToxicClouds();

    // Process gravity wells
    this._processGravityWells();

    // Process decoys
    this._processDecoys();

    // Spawn pickups
    if (this.tickCount - this.lastPickupTick >= PICKUP_INTERVAL) {
      this.lastPickupTick = this.tickCount;
      spawnPickup(this, 'weapon');
    }
    if (this.tickCount - this.lastSpellPickupTick >= SPELL_PICKUP_INTERVAL) {
      this.lastSpellPickupTick = this.tickCount;
      spawnPickup(this, 'spell');
    }

    // Check pickup collisions
    this._checkPickupCollisions();
  }

  _processProjectiles() {
    for (var i = this.projectiles.length - 1; i >= 0; i--) {
      var proj = this.projectiles[i];
      proj.vy += (proj.gravity || 0) * TICK_SCALE;
      proj.x += proj.vx * TICK_SCALE;
      proj.y += proj.vy * TICK_SCALE;
      proj.life -= TICK_SCALE;

      // Boomerang: reverse after half life
      if (proj.boomerang && proj.life === Math.floor(proj.maxLife / 2)) {
        proj.vx = -proj.vx;
        proj.vy = -proj.vy;
      }

      if (proj.life <= 0 || proj.x < 0 || proj.x >= this.terrain.width || proj.y < 0 || proj.y >= this.terrain.height) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Terrain collision
      if (this.terrain.isSolid(Math.floor(proj.x), Math.floor(proj.y))) {
        if (proj.explosionRadius > 0) {
          var deltas = this.terrain.destroyCircle(proj.x, proj.y, proj.explosionRadius);
          for (var d = 0; d < deltas.length; d++) this.pendingEvents.terrainDeltas.push(deltas[d]);
          // Explosion damage
          for (var [pid2, p2] of this.players) {
            if (pid2 === proj.ownerId) continue;
            if (!p2.alive) continue;
            var edx = (p2.x + PLAYER_W / 2) - proj.x;
            var edy = (p2.y + PLAYER_H / 2) - proj.y;
            if (Math.sqrt(edx * edx + edy * edy) < proj.explosionRadius + PLAYER_W / 2) {
              damagePlayer(p2, proj.damage, this.players.get(proj.ownerId), proj.weaponId || 'explosion', this);
            }
          }
        }
        this.projectiles.splice(i, 1);
        continue;
      }

      // Player collision
      var hit = false;
      for (var [pid3, p3] of this.players) {
        if (pid3 === proj.ownerId || !p3.alive || p3.invisible) continue;
        var pdx = (p3.x + PLAYER_W / 2) - proj.x;
        var pdy = (p3.y + PLAYER_H / 2) - proj.y;
        if (Math.abs(pdx) < PLAYER_W / 2 + 4 && Math.abs(pdy) < PLAYER_H / 2 + 4) {
          damagePlayer(p3, proj.damage, this.players.get(proj.ownerId), proj.weaponId || 'projectile', this);
          if (proj.explosionRadius > 0) {
            var deltas2 = this.terrain.destroyCircle(proj.x, proj.y, proj.explosionRadius);
            for (var d2 = 0; d2 < deltas2.length; d2++) this.pendingEvents.terrainDeltas.push(deltas2[d2]);
          }
          // Apply slow effect (Ice Bow)
          if (proj.slowEffect && proj.slowDuration && p3.alive) {
            p3.speedMultiplier = proj.slowEffect;
            p3.buffs.slow = { remaining: proj.slowDuration, speedRestore: true };
          }
          // Apply poison DOT (Poison Dagger)
          if (proj.poisonDamage && proj.poisonDuration && p3.alive) {
            p3.buffs.poison = { remaining: proj.poisonDuration, poisonDamage: proj.poisonDamage, ownerId: proj.ownerId };
          }
          // Chain lightning effect (Lightning Rod)
          if (proj.chainDamage && proj.chainRange) {
            var chainSrc = p3;
            var chainOwner = this.players.get(proj.ownerId);
            for (var [cpid, cp] of this.players) {
              if (cpid === proj.ownerId || cpid === p3.id || !cp.alive || cp.invisible) continue;
              var cdx = (cp.x + PLAYER_W / 2) - (chainSrc.x + PLAYER_W / 2);
              var cdy = (cp.y + PLAYER_H / 2) - (chainSrc.y + PLAYER_H / 2);
              if (Math.sqrt(cdx * cdx + cdy * cdy) < proj.chainRange) {
                damagePlayer(cp, proj.chainDamage, chainOwner, proj.weaponId || 'chain', this);
                break; // chain once
              }
            }
          }
          this.projectiles.splice(i, 1);
          hit = true;
          break;
        }
      }
    }
  }

  _processTurrets() {
    for (var i = this.turrets.length - 1; i >= 0; i--) {
      var turret = this.turrets[i];
      turret.life -= TICK_SCALE;
      if (turret.life <= 0) { this.turrets.splice(i, 1); continue; }
      turret.fireCooldown -= TICK_SCALE;
      if (turret.fireCooldown > 0) continue;

      // Find nearest enemy
      var nearest = null, nearDist = Infinity;
      for (var [pid, p] of this.players) {
        if (pid === turret.ownerId || !p.alive || p.invisible) continue;
        var dx = (p.x + PLAYER_W / 2) - turret.x;
        var dy = (p.y + PLAYER_H / 2) - turret.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < turret.range && dist < nearDist) { nearest = p; nearDist = dist; }
      }
      if (nearest) {
        turret.fireCooldown = turret.fireRate;
        var angle = Math.atan2((nearest.y + PLAYER_H / 2) - turret.y, (nearest.x + PLAYER_W / 2) - turret.x);
        this.projectiles.push({
          id: 'tproj_' + this.tickCount + '_' + i,
          ownerId: turret.ownerId, weaponId: 'turret',
          x: turret.x, y: turret.y,
          vx: Math.cos(angle) * 8, vy: Math.sin(angle) * 8,
          gravity: 0, damage: turret.damage, explosionRadius: 0,
          life: 60, maxLife: 60, boomerang: false,
        });
      }
    }
  }

  _processMines() {
    for (var i = this.mines.length - 1; i >= 0; i--) {
      var mine = this.mines[i];
      mine.armTimer -= TICK_SCALE;
      if (mine.armTimer > 0) continue; // Not yet armed

      for (var [pid, p] of this.players) {
        if (pid === mine.ownerId || !p.alive) continue;
        var dx = (p.x + PLAYER_W / 2) - mine.x;
        var dy = (p.y + PLAYER_H / 2) - mine.y;
        if (Math.sqrt(dx * dx + dy * dy) < mine.radius + PLAYER_W) {
          damagePlayer(p, mine.damage, this.players.get(mine.ownerId), 'mine', this);
          if (mine.immobilize) {
            p.immobilized = true;
            p.immobileTimer = mine.immobilize;
          }
          if (mine.radius > 10) {
            var deltas = this.terrain.destroyCircle(mine.x, mine.y, mine.radius);
            for (var d = 0; d < deltas.length; d++) this.pendingEvents.terrainDeltas.push(deltas[d]);
          }
          this.mines.splice(i, 1);
          break;
        }
      }
    }
  }

  _processToxicClouds() {
    for (var i = this.toxicClouds.length - 1; i >= 0; i--) {
      var cloud = this.toxicClouds[i];
      cloud.life -= TICK_SCALE;
      if (cloud.life <= 0) { this.toxicClouds.splice(i, 1); continue; }
      // Damage players in range every ~3 ticks (was every 5 at 20Hz)
      if (cloud.life % 3 === 0) {
        for (var [pid, p] of this.players) {
          if (pid === cloud.ownerId) continue;
          if (!p.alive) continue;
          var dx = (p.x + PLAYER_W / 2) - cloud.x;
          var dy = (p.y + PLAYER_H / 2) - cloud.y;
          if (Math.sqrt(dx * dx + dy * dy) < cloud.radius + PLAYER_W / 2) {
            damagePlayer(p, cloud.damage, this.players.get(cloud.ownerId), 'toxic', this);
          }
        }
      }
    }
  }

  _processGravityWells() {
    for (var i = this.gravityWells.length - 1; i >= 0; i--) {
      var well = this.gravityWells[i];
      well.life -= TICK_SCALE;
      if (well.life <= 0) { this.gravityWells.splice(i, 1); continue; }
      // Pull players and projectiles (scale force for tick rate)
      for (var [pid, p] of this.players) {
        if (pid === well.ownerId) continue;
        if (!p.alive) continue;
        var dx = well.x - (p.x + PLAYER_W / 2);
        var dy = well.y - (p.y + PLAYER_H / 2);
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < well.radius && dist > 3) {
          var force = well.pullForce / dist;
          p.vx += dx * force * 0.1 * TICK_SCALE;
          p.vy += dy * force * 0.1 * TICK_SCALE;
        }
      }
      for (var j = 0; j < this.projectiles.length; j++) {
        var proj = this.projectiles[j];
        var pdx = well.x - proj.x;
        var pdy = well.y - proj.y;
        var pdist = Math.sqrt(pdx * pdx + pdy * pdy);
        if (pdist < well.radius && pdist > 3) {
          var pforce = well.pullForce / pdist;
          proj.vx += pdx * pforce * 0.05 * TICK_SCALE;
          proj.vy += pdy * pforce * 0.05 * TICK_SCALE;
        }
      }
    }
  }

  _processDecoys() {
    for (var i = this.decoys.length - 1; i >= 0; i--) {
      var decoy = this.decoys[i];
      decoy.life -= TICK_SCALE;
      if (decoy.life <= 0) { this.decoys.splice(i, 1); continue; }
      // Simple movement: drift and apply gravity
      decoy.vy = (decoy.vy || 0) + GRAVITY;
      if (decoy.vy > MAX_FALL) decoy.vy = MAX_FALL;
      var newDX = decoy.x + (decoy.vx || 0);
      var newDY = decoy.y + decoy.vy;
      if (!this.terrain.isSolid(Math.floor(newDX), Math.floor(decoy.y))) {
        decoy.x = newDX;
      }
      if (!this.terrain.isSolid(Math.floor(decoy.x), Math.floor(newDY))) {
        decoy.y = newDY;
      } else {
        decoy.vy = 0;
      }
    }
  }

  _checkPickupCollisions() {
    for (var i = this.pickups.length - 1; i >= 0; i--) {
      var pickup = this.pickups[i];
      for (var [pid, p] of this.players) {
        if (!p.alive) continue;
        var dx = (p.x + PLAYER_W / 2) - pickup.x;
        var dy = (p.y + PLAYER_H / 2) - pickup.y;
        if (Math.abs(dx) < PLAYER_W + 6 && Math.abs(dy) < PLAYER_H + 6) {
          // Collect
          if (pickup.type === 'weapon') {
            if (p.weapons.length >= 5) {
              p.weapons[p.weapons.length - 1] = pickup.itemId; // Replace last
            } else {
              p.weapons.push(pickup.itemId);
            }
          } else if (pickup.type === 'spell') {
            p.spellbook = pickup.itemId;
          }
          this.pendingEvents.pickupCollections.push({ pickupId: pickup.id, playerId: p.id, itemId: pickup.itemId });
          this.pickups.splice(i, 1);
          break;
        }
      }
    }
  }

  getPlayersState() {
    var result = [];
    for (var [pid, p] of this.players) {
      result.push({
        id: p.id, name: p.name, color: p.color,
        x: Math.round(p.x), y: Math.round(p.y),
        vx: Math.round(p.vx * 10) / 10, vy: Math.round(p.vy * 10) / 10,
        hp: p.hp, alive: p.alive, aimAngle: Math.round(p.aimAngle * 100) / 100,
        currentWeaponIdx: p.currentWeaponIdx, score: p.score,
        isBot: p.isBot, invisible: p.invisible, blocking: p.blocking,
        weapons: p.weapons, spellbook: p.spellbook,
      });
    }
    return result;
  }

  getWeaponDefs() {
    // Return all weapon definitions used by players
    var ids = new Set();
    for (var [, p] of this.players) {
      for (var w = 0; w < p.weapons.length; w++) ids.add(p.weapons[w]);
    }
    var defs = {};
    for (var id of ids) {
      var wpn = WEAPON_MAP.get(id);
      if (wpn) defs[id] = { name: wpn.name, category: wpn.category, damage: wpn.damage };
    }
    return defs;
  }

  getSpellDefs() {
    var defs = {};
    for (var [, p] of this.players) {
      if (p.spellbook && SPELL_MAP.has(p.spellbook)) {
        var sp = SPELL_MAP.get(p.spellbook);
        defs[p.spellbook] = { name: sp.name, cooldown: sp.cooldown };
      }
    }
    return defs;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Movement
// ═══════════════════════════════════════════════════════════════════════════

function movePlayer(player, terrain) {
  var speed = MOVE_SPEED * player.speedMultiplier;

  if (!player.immobilized) {
    if (player.input.left) player.vx = -speed;
    else if (player.input.right) player.vx = speed;
    else player.vx = 0;

    if (player.input.jump && player.grounded) {
      player.vy = JUMP_SPEED;
      player.grounded = false;
    }
  } else {
    player.vx = 0;
  }

  player.vy += GRAVITY;
  if (player.vy > MAX_FALL) player.vy = MAX_FALL;

  // Horizontal
  var newX = player.x + player.vx;
  if (!collidesWithTerrain(newX, player.y, PLAYER_W, PLAYER_H, terrain)) {
    player.x = newX;
  }

  // Vertical
  var newY = player.y + player.vy;
  if (!collidesWithTerrain(player.x, newY, PLAYER_W, PLAYER_H, terrain)) {
    player.y = newY;
    player.grounded = false;
  } else {
    if (player.vy > 0) player.grounded = true;
    player.vy = 0;
  }

  // Bounds
  player.x = Math.max(3, Math.min(terrain.width - PLAYER_W - 3, player.x));
  player.y = Math.max(3, Math.min(terrain.height - PLAYER_H - 3, player.y));

  player.aimAngle = player.input.aimAngle;
}

// ═══════════════════════════════════════════════════════════════════════════
// Damage
// ═══════════════════════════════════════════════════════════════════════════

function damagePlayer(target, damage, attacker, weaponId, game) {
  if (!target.alive) return;
  if (target.buffs.arcane_shield) return; // Absorb all

  if (target.blocking) {
    damage = Math.floor(damage * (1 - (target.blockPercent || 0.5)));
  }

  // Stone Skin damage reduction
  if (target.buffs.stone_skin) {
    damage = Math.floor(damage * (1 - (target.buffs.stone_skin.damageReduction || 0.5)));
  }

  target.hp -= damage;
  if (target.hp <= 0) {
    // Phoenix Rebirth auto-revive
    if (target.buffs.phoenix_rebirth) {
      target.hp = target.buffs.phoenix_rebirth.reviveHp || 50;
      delete target.buffs.phoenix_rebirth;
      return;
    }
    target.hp = 0;
    target.alive = false;
    target.respawnTimer = RESPAWN_TICKS;
    if (attacker && attacker.id !== target.id) {
      attacker.score++;
    }
    game.pendingEvents.kills.push({
      killedId: target.id, killedName: target.name,
      killerId: attacker ? attacker.id : null,
      killerName: attacker ? attacker.name : null,
      weaponId: weaponId,
    });
    if (attacker && attacker.score >= game.scoreLimit) {
      game.gameOver = true;
      game.winner = attacker;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Weapon firing
// ═══════════════════════════════════════════════════════════════════════════

function fireWeapon(player, game) {
  var wpnId = player.weapons[player.currentWeaponIdx];
  var weapon = WEAPON_MAP.get(wpnId);
  if (!weapon) weapon = WEAPON_MAP.get('default_dagger');
  if (!weapon) return;

  player.weaponCooldown = weapon.cooldown;
  var cx = player.x + PLAYER_W / 2;
  var cy = player.y + PLAYER_H / 2;

  if (weapon.category === 'melee') {
    // Instant melee hit
    var halfArc = (weapon.arc || Math.PI / 2) / 2;
    for (var [pid, target] of game.players) {
      if (pid === player.id || !target.alive || target.invisible) continue;
      var dx = (target.x + PLAYER_W / 2) - cx;
      var dy = (target.y + PLAYER_H / 2) - cy;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > weapon.range + PLAYER_W) continue;
      var angle = Math.atan2(dy, dx);
      var diff = Math.abs(normalizeAngle(angle - player.aimAngle));
      if (diff <= halfArc) {
        damagePlayer(target, Math.floor(weapon.damage * player.damageMultiplier), player, wpnId, game);
        // Apply poison (Poison Dagger melee hit)
        if (weapon.poisonDamage && weapon.poisonDuration && target.alive) {
          target.buffs.poison = { remaining: weapon.poisonDuration, poisonDamage: weapon.poisonDamage, ownerId: player.id };
        }
        // Apply slow (melee slow if any)
        if (weapon.slowEffect && weapon.slowDuration && target.alive) {
          target.speedMultiplier = weapon.slowEffect;
          target.buffs.slow = { remaining: weapon.slowDuration, speedRestore: true };
        }
      }
    }
    if (weapon.explosionRadius > 0) {
      var hitX = cx + Math.cos(player.aimAngle) * weapon.range;
      var hitY = cy + Math.sin(player.aimAngle) * weapon.range;
      var deltas = game.terrain.destroyCircle(hitX, hitY, weapon.explosionRadius);
      for (var d = 0; d < deltas.length; d++) game.pendingEvents.terrainDeltas.push(deltas[d]);
    }
  } else if (weapon.category === 'ranged' || weapon.category === 'staff') {
    var projCount = weapon.projectileCount || 1;
    for (var pi = 0; pi < projCount; pi++) {
      var fireAngle = player.aimAngle;
      if (projCount > 1 && weapon.spread) {
        fireAngle += (pi - (projCount - 1) / 2) * weapon.spread / (projCount - 1);
      }
      game.projectiles.push({
        id: 'proj_' + game.tickCount + '_' + pi + '_' + Math.random().toString(36).slice(2, 6),
        ownerId: player.id, weaponId: wpnId,
        x: cx, y: cy,
        vx: Math.cos(fireAngle) * (weapon.projectileSpeed || 8),
        vy: Math.sin(fireAngle) * (weapon.projectileSpeed || 8),
        gravity: weapon.gravity || 0,
        damage: Math.floor(weapon.damage * player.damageMultiplier),
        explosionRadius: weapon.explosionRadius || 0,
        life: 200, maxLife: 200, boomerang: false,
        slowEffect: weapon.slowEffect || 0,
        slowDuration: weapon.slowDuration || 0,
        poisonDamage: weapon.poisonDamage || 0,
        poisonDuration: weapon.poisonDuration || 0,
        chainDamage: weapon.chainDamage || 0,
        chainRange: weapon.chainRange || 0,
      });
    }
  } else if (weapon.category === 'shield') {
    player.blocking = true;
    player.blockTimer = weapon.blockDuration || 20;
    player.blockPercent = weapon.blockPercent || 0.5;
    player.weaponCooldown = (weapon.blockDuration || 20) + weapon.cooldown;
    // Explosive Shield: store explosion data on player for when block ends
    if (weapon.explosionDamage) {
      player.blockExplosionDamage = weapon.explosionDamage;
      player.blockExplosionRadius = weapon.explosionRadius || 20;
    } else {
      player.blockExplosionDamage = 0;
      player.blockExplosionRadius = 0;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Spell casting
// ═══════════════════════════════════════════════════════════════════════════

function castSpell(player, game) {
  var spell = SPELL_MAP.get(player.spellbook);
  if (!spell) return;

  // Apply staff cooldown reduction
  var cdReduction = 1;
  var curWpn = WEAPON_MAP.get(player.weapons[player.currentWeaponIdx]);
  if (curWpn && curWpn.spellCooldownReduction) cdReduction = 1 - curWpn.spellCooldownReduction;
  player.spellCooldown = Math.floor(spell.cooldown * cdReduction);

  var cx = player.x + PLAYER_W / 2;
  var cy = player.y + PLAYER_H / 2;
  var aimX = cx + Math.cos(player.aimAngle) * 50;
  var aimY = cy + Math.sin(player.aimAngle) * 50;

  game.pendingEvents.spellCasts.push({ playerId: player.id, spellId: spell.id, x: cx, y: cy });

  switch (spell.type) {
    case 'projectile':
      var projLife = spell.boomerang ? 120 : 200;
      game.projectiles.push({
        id: 'spell_' + game.tickCount + '_' + Math.random().toString(36).slice(2, 6),
        ownerId: player.id, weaponId: spell.id,
        x: cx, y: cy,
        vx: Math.cos(player.aimAngle) * (spell.projectileSpeed || 7),
        vy: Math.sin(player.aimAngle) * (spell.projectileSpeed || 7),
        gravity: spell.gravity || 0,
        damage: spell.damage || 0,
        explosionRadius: spell.radius || 0,
        life: projLife, maxLife: projLife,
        boomerang: !!spell.boomerang,
      });
      break;

    case 'multi_projectile':
      for (var mi = 0; mi < spell.count; mi++) {
        var angle = player.aimAngle;
        if (spell.spread) angle += (mi - (spell.count - 1) / 2) * spell.spread / spell.count;
        var spd = spell.projectileSpeed || 7;
        var startX = cx, startY = cy;
        if (spell.rain) {
          // Rain from above near aim point
          startX = aimX + (Math.random() - 0.5) * 80;
          startY = Math.max(10, aimY - 200 + Math.random() * 50);
          angle = Math.PI / 2 + (Math.random() - 0.5) * 0.3;
        }
        game.projectiles.push({
          id: 'spell_' + game.tickCount + '_' + mi + '_' + Math.random().toString(36).slice(2, 4),
          ownerId: player.id, weaponId: spell.id,
          x: startX, y: startY,
          vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
          gravity: spell.gravity || 0, damage: spell.damage || 0,
          explosionRadius: spell.radius || 0,
          life: 150, maxLife: 150, boomerang: false,
        });
      }
      break;

    case 'instant':
      if (spell.id === 'healing_light') {
        player.hp = Math.min(player.maxHp, player.hp + spell.healAmount);
      } else if (spell.id === 'blink') {
        var bx = player.x + Math.cos(player.aimAngle) * spell.teleportDist;
        var by = player.y + Math.sin(player.aimAngle) * spell.teleportDist;
        bx = Math.max(3, Math.min(game.terrain.width - PLAYER_W - 3, bx));
        by = Math.max(3, Math.min(game.terrain.height - PLAYER_H - 3, by));
        player.x = bx; player.y = by; player.vy = 0;
      } else if (spell.id === 'chain_lightning') {
        // Hit nearest in range, chain once
        var targets = [];
        for (var [pid, p] of game.players) {
          if (pid === player.id || !p.alive || p.invisible) continue;
          var dx = (p.x + PLAYER_W / 2) - cx;
          var dy = (p.y + PLAYER_H / 2) - cy;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < spell.range) targets.push({ player: p, dist: dist });
        }
        targets.sort(function(a, b) { return a.dist - b.dist; });
        var chainCount = 1 + (spell.chains || 0);
        for (var ci = 0; ci < Math.min(chainCount, targets.length); ci++) {
          damagePlayer(targets[ci].player, spell.damage, player, spell.id, game);
        }
      } else if (spell.id === 'arcane_cleave') {
        var halfArc2 = (spell.arc || Math.PI) / 2;
        for (var [pid2, p2] of game.players) {
          if (pid2 === player.id || !p2.alive || p2.invisible) continue;
          var dx2 = (p2.x + PLAYER_W / 2) - cx;
          var dy2 = (p2.y + PLAYER_H / 2) - cy;
          var dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
          if (dist2 > spell.range + PLAYER_W) continue;
          var ang2 = Math.atan2(dy2, dx2);
          if (Math.abs(normalizeAngle(ang2 - player.aimAngle)) <= halfArc2) {
            damagePlayer(p2, spell.damage, player, spell.id, game);
          }
        }
      } else if (spell.id === 'true_shot') {
        // Hitscan: first player in line of sight
        var bestHit = null, bestDist = Infinity;
        for (var [pid3, p3] of game.players) {
          if (pid3 === player.id || !p3.alive || p3.invisible) continue;
          var dx3 = (p3.x + PLAYER_W / 2) - cx;
          var dy3 = (p3.y + PLAYER_H / 2) - cy;
          var dist3 = Math.sqrt(dx3 * dx3 + dy3 * dy3);
          if (dist3 > spell.range) continue;
          var ang3 = Math.atan2(dy3, dx3);
          if (Math.abs(normalizeAngle(ang3 - player.aimAngle)) < 0.15 && dist3 < bestDist) {
            bestHit = p3; bestDist = dist3;
          }
        }
        if (bestHit) damagePlayer(bestHit, spell.damage, player, spell.id, game);
      } else if (spell.id === 'soul_swap') {
        var nearest = null, nearDist = Infinity;
        for (var [pid4, p4] of game.players) {
          if (pid4 === player.id || !p4.alive) continue;
          var dx4 = p4.x - player.x, dy4 = p4.y - player.y;
          var dist4 = Math.sqrt(dx4 * dx4 + dy4 * dy4);
          if (dist4 < spell.range && dist4 < nearDist) { nearest = p4; nearDist = dist4; }
        }
        if (nearest) {
          var tmpX = player.x, tmpY = player.y;
          player.x = nearest.x; player.y = nearest.y;
          nearest.x = tmpX; nearest.y = tmpY;
        }
      }
      break;

    case 'buff':
      player.buffs[spell.buffId] = {
        remaining: spell.duration,
        healPerTick: spell.healPerTick || 0,
        damageReduction: spell.damageReduction || 0,
        reviveHp: spell.reviveHp || 0,
      };
      if (spell.buffId === 'haste') player.speedMultiplier = spell.speedMultiplier || 2;
      if (spell.buffId === 'battle_rage') player.damageMultiplier = spell.damageMultiplier || 2;
      if (spell.buffId === 'invisibility') player.invisible = true;
      break;

    case 'aoe':
      if (spell.id === 'toxic_cloud') {
        game.toxicClouds.push({
          x: aimX, y: aimY, radius: spell.radius, damage: spell.damage,
          life: spell.duration, ownerId: player.id,
        });
      } else if (spell.id === 'gravity_well') {
        game.gravityWells.push({
          x: aimX, y: aimY, radius: spell.radius,
          life: spell.duration, pullForce: spell.pullForce || 1.5,
          ownerId: player.id,
        });
      }
      break;

    case 'aoe_slow':
      // Frost Nova: damage and slow all nearby enemies
      for (var [fnPid, fnP] of game.players) {
        if (fnPid === player.id || !fnP.alive) continue;
        var fnDx = (fnP.x + PLAYER_W / 2) - cx;
        var fnDy = (fnP.y + PLAYER_H / 2) - cy;
        if (Math.sqrt(fnDx * fnDx + fnDy * fnDy) < spell.radius + PLAYER_W) {
          damagePlayer(fnP, spell.damage, player, spell.id, game);
          if (fnP.alive) {
            fnP.speedMultiplier = spell.slowEffect || 0.4;
            fnP.buffs.slow = { remaining: spell.slowDuration || 40, speedRestore: true };
          }
        }
      }
      break;

    case 'aoe_dot':
      // Poison Cloud: creates a toxic cloud that deals tick damage
      game.toxicClouds.push({
        x: aimX, y: aimY, radius: spell.radius || 50,
        damage: spell.tickDamage || 3,
        life: spell.duration || 50, ownerId: player.id,
      });
      // Initial burst damage
      for (var [pcPid, pcP] of game.players) {
        if (pcPid === player.id || !pcP.alive) continue;
        var pcDx = (pcP.x + PLAYER_W / 2) - aimX;
        var pcDy = (pcP.y + PLAYER_H / 2) - aimY;
        if (Math.sqrt(pcDx * pcDx + pcDy * pcDy) < spell.radius + PLAYER_W) {
          damagePlayer(pcP, spell.damage, player, spell.id, game);
        }
      }
      break;

    case 'decoy':
      // Mirror Image: add a fake decoy player marker to the game
      // Decoys are stored as a turret-like entity with no damage, just a visual marker
      // They appear as a player ghost at the aim position
      if (!game.decoys) game.decoys = [];
      game.decoys.push({
        x: aimX, y: aimY, ownerId: player.id,
        name: player.name, color: player.color,
        life: spell.duration || 80,
        vx: (Math.random() - 0.5) * 2, vy: 0,
      });
      break;

    case 'pull':
      // Grapple: pull nearest enemy in range toward caster
      var gpNearest = null, gpNearDist = Infinity;
      for (var [gpPid, gpP] of game.players) {
        if (gpPid === player.id || !gpP.alive || gpP.invisible) continue;
        var gpDx = (gpP.x + PLAYER_W / 2) - cx;
        var gpDy = (gpP.y + PLAYER_H / 2) - cy;
        var gpDist = Math.sqrt(gpDx * gpDx + gpDy * gpDy);
        // Check if target is roughly in the aim direction (within 45 degrees)
        var gpAng = Math.atan2(gpDy, gpDx);
        var gpAngDiff = Math.abs(normalizeAngle(gpAng - player.aimAngle));
        if (gpDist < spell.range && gpDist < gpNearDist && gpAngDiff < Math.PI / 4) {
          gpNearest = gpP; gpNearDist = gpDist;
        }
      }
      if (gpNearest) {
        damagePlayer(gpNearest, spell.damage, player, spell.id, game);
        if (gpNearest.alive) {
          // Pull target toward caster
          var pullDx = cx - (gpNearest.x + PLAYER_W / 2);
          var pullDy = cy - (gpNearest.y + PLAYER_H / 2);
          var pullDist = Math.sqrt(pullDx * pullDx + pullDy * pullDy);
          if (pullDist > 1) {
            // Move target 70% of the way to the caster
            gpNearest.x += pullDx * 0.7;
            gpNearest.y += pullDy * 0.7;
            gpNearest.vx = 0;
            gpNearest.vy = 0;
          }
        }
      }
      break;

    case 'terrain':
      // Ice wall: create terrain at aim point
      var deltas3 = game.terrain.createCircle(aimX, aimY, spell.createRadius || 15, spell.terrainVal || 2);
      for (var d3 = 0; d3 < deltas3.length; d3++) game.pendingEvents.terrainDeltas.push(deltas3[d3]);
      break;

    case 'terrain_destroy':
      var deltas4 = game.terrain.destroyCircle(cx, cy, spell.radius);
      for (var d4 = 0; d4 < deltas4.length; d4++) game.pendingEvents.terrainDeltas.push(deltas4[d4]);
      // Earthquake also damages
      if (spell.damage) {
        for (var [pid5, p5] of game.players) {
          if (pid5 === player.id || !p5.alive) continue;
          var dx5 = (p5.x + PLAYER_W / 2) - cx;
          var dy5 = (p5.y + PLAYER_H / 2) - cy;
          if (Math.sqrt(dx5 * dx5 + dy5 * dy5) < spell.radius + PLAYER_W) {
            damagePlayer(p5, spell.damage, player, spell.id, game);
          }
        }
      }
      break;

    case 'mine':
      for (var mi2 = 0; mi2 < spell.count; mi2++) {
        var mineX = cx + (Math.random() - 0.5) * 40 * mi2;
        var mineY = cy + (Math.random() - 0.5) * 20;
        game.mines.push({
          x: mineX, y: mineY, radius: spell.radius || 20,
          damage: spell.damage || 30, ownerId: player.id,
          armTimer: 20, immobilize: spell.immobilize || 0,
        });
      }
      break;

    case 'summon':
      game.turrets.push({
        x: aimX, y: aimY, ownerId: player.id,
        life: spell.duration || 100, damage: spell.damage || 8,
        fireRate: spell.fireRate || 10, range: spell.range || 180,
        fireCooldown: 0,
      });
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Pickups
// ═══════════════════════════════════════════════════════════════════════════

function randomWeaponId() {
  var pool = WEAPONS.filter(function(w) { return w.id !== 'default_dagger' && w.id !== 'default_bow'; });
  return pool[Math.floor(Math.random() * pool.length)].id;
}

function randomSpellId() {
  return SPELLS[Math.floor(Math.random() * SPELLS.length)].id;
}

function spawnPickup(game, type) {
  var pos = game.terrain.findSafeSpawn();
  var pickup = {
    id: 'pk_' + game.tickCount + '_' + Math.random().toString(36).slice(2, 6),
    type: type,
    x: pos.x, y: pos.y,
    itemId: type === 'spell' ? randomSpellId() : randomWeaponId(),
  };
  game.pickups.push(pickup);
  game.pendingEvents.pickupSpawns.push(pickup);
}

// ═══════════════════════════════════════════════════════════════════════════
// Bot AI
// ═══════════════════════════════════════════════════════════════════════════

function updateBotAI(bot, game) {
  // Find nearest enemy
  var nearest = null, nearestDist = Infinity;
  for (var [pid, p] of game.players) {
    if (pid === bot.id || !p.alive) continue;
    var dx = p.x - bot.x, dy = p.y - bot.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < nearestDist) { nearest = p; nearestDist = dist; }
  }

  bot.botStateTimer--;

  // State transitions
  if (bot.hp < 30 && nearest && nearestDist < 150) {
    bot.botState = 'flee';
    bot.botStateTimer = 40;
  } else if (nearest && nearestDist < 60) {
    bot.botState = 'attack';
    bot.botStateTimer = 20;
  } else if (nearest && nearestDist < 800) {
    bot.botState = 'chase';
    bot.botStateTimer = 30;
  } else if (bot.botStateTimer <= 0) {
    bot.botState = 'wander';
    bot.botStateTimer = 40 + Math.floor(Math.random() * 40);
  }

  // Reset input each tick
  bot.input.left = false;
  bot.input.right = false;
  bot.input.jump = false;
  bot.input.fire = false;
  bot.input.spell = false;
  bot.input.switchWeapon = 0;

  if (bot.botState === 'chase' && nearest) {
    if (nearest.x < bot.x - 10) bot.input.left = true;
    else if (nearest.x > bot.x + 10) bot.input.right = true;
    // Jump if blocked
    var aheadX = bot.x + (bot.input.right ? 20 : (bot.input.left ? -20 : 0));
    var blocked = game.terrain.isSolid(Math.floor(aheadX), Math.floor(bot.y + PLAYER_H / 2));
    if (blocked) {
      bot.input.jump = true;
      // Fire toward terrain to dig through it
      bot.input.fire = true;
    }
    var tdx = (nearest.x + PLAYER_W / 2) - (bot.x + PLAYER_W / 2);
    var tdy = (nearest.y + PLAYER_H / 2) - (bot.y + PLAYER_H / 2);
    bot.input.aimAngle = Math.atan2(tdy, tdx) + (Math.random() - 0.5) * 0.3;
    if (nearestDist < 300) bot.input.fire = true;
    if (bot.spellbook && bot.spellCooldown <= 0 && Math.random() < 0.3 && nearestDist < 250) {
      bot.input.spell = true;
    }
  } else if (bot.botState === 'attack' && nearest) {
    var adx = (nearest.x + PLAYER_W / 2) - (bot.x + PLAYER_W / 2);
    var ady = (nearest.y + PLAYER_H / 2) - (bot.y + PLAYER_H / 2);
    bot.input.aimAngle = Math.atan2(ady, adx) + (Math.random() - 0.5) * 0.15;
    bot.input.fire = true;
    if (bot.spellbook && bot.spellCooldown <= 0 && Math.random() < 0.5) {
      bot.input.spell = true;
    }
  } else if (bot.botState === 'flee' && nearest) {
    if (nearest.x < bot.x) bot.input.right = true;
    else bot.input.left = true;
    if (Math.random() < 0.3) bot.input.jump = true;
    var fdx = (nearest.x + PLAYER_W / 2) - (bot.x + PLAYER_W / 2);
    var fdy = (nearest.y + PLAYER_H / 2) - (bot.y + PLAYER_H / 2);
    bot.input.aimAngle = Math.atan2(fdy, fdx);
    if (Math.random() < 0.2) bot.input.fire = true;
  } else if (bot.botState === 'wander') {
    if (Math.random() < 0.3) bot.input.left = true;
    else if (Math.random() < 0.3) bot.input.right = true;
    if (Math.random() < 0.1) bot.input.jump = true;
    bot.input.aimAngle += (Math.random() - 0.5) * 0.3;
    // Occasionally fire to dig through terrain
    if (Math.random() < 0.05) bot.input.fire = true;
  }

  // Weapon switching: prefer melee close, ranged far
  if (nearest && bot.weapons.length > 1 && Math.random() < 0.05) {
    var curWpn = WEAPON_MAP.get(bot.weapons[bot.currentWeaponIdx]);
    if (nearestDist < 40 && curWpn && curWpn.category !== 'melee') {
      for (var bi = 0; bi < bot.weapons.length; bi++) {
        var bw = WEAPON_MAP.get(bot.weapons[bi]);
        if (bw && bw.category === 'melee') { bot.input.switchWeapon = bi > bot.currentWeaponIdx ? 1 : -1; break; }
      }
    } else if (nearestDist > 80 && curWpn && curWpn.category === 'melee') {
      for (var bi2 = 0; bi2 < bot.weapons.length; bi2++) {
        var bw2 = WEAPON_MAP.get(bot.weapons[bi2]);
        if (bw2 && (bw2.category === 'ranged' || bw2.category === 'staff')) { bot.input.switchWeapon = bi2 > bot.currentWeaponIdx ? 1 : -1; break; }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Lobby Manager
// ═══════════════════════════════════════════════════════════════════════════

class LieroManager {
  constructor(io, socketAccountMap, accounts) {
    this.io = io;
    this.socketAccountMap = socketAccountMap;
    this.accounts = accounts;
    this.lobbies = new Map();
    this.playerLobbyMap = new Map();
    this.nextLobbyId = 1;
  }

  createLobby(hostId, hostName, hostColor, settings, weapons, spell) {
    if (this.playerLobbyMap.has(hostId)) return null;
    if (this.lobbies.size >= MAX_LIERO_LOBBIES) return null;
    var lobbyId = 'lb_' + (this.nextLobbyId++);
    var lobby = {
      id: lobbyId,
      host: hostId,
      players: new Map(),
      settings: { mapType: (settings && settings.mapType) || 'caves', scoreLimit: Math.max(1, Math.min(50, parseInt(settings && settings.scoreLimit) || 10)) },
      state: 'waiting',
      game: null,
      maxPlayers: 8,
    };
    lobby.players.set(hostId, { id: hostId, name: hostName, color: hostColor, isBot: false, weapons: weapons, spell: spell });
    this.lobbies.set(lobbyId, lobby);
    this.playerLobbyMap.set(hostId, lobbyId);
    return lobby;
  }

  joinLobby(socketId, lobbyId, name, color, weapons, spell) {
    if (this.playerLobbyMap.has(socketId)) return null;
    var lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state === 'finished' || lobby.players.size >= lobby.maxPlayers) return null;
    lobby.players.set(socketId, { id: socketId, name: name, color: color, isBot: false, weapons: weapons, spell: spell });
    this.playerLobbyMap.set(socketId, lobbyId);

    // If game is in progress, add player to the live game
    if (lobby.state === 'playing' && lobby.game) {
      var wpns = weapons;
      if (!Array.isArray(wpns) || wpns.length === 0) wpns = ['default_dagger', 'default_bow'];
      wpns = wpns.filter(function(id) { return WEAPON_MAP.has(id); }).slice(0, 5);
      if (wpns.length === 0) wpns = ['default_dagger', 'default_bow'];
      var validSpell = (spell && SPELL_MAP.has(spell)) ? spell : 'tunnel';
      lobby.game.addPlayer(socketId, name, color, wpns, validSpell, false);
    }
    return lobby;
  }

  leaveLobby(socketId) {
    var lobbyId = this.playerLobbyMap.get(socketId);
    if (!lobbyId) return null;
    var lobby = this.lobbies.get(lobbyId);
    if (!lobby) { this.playerLobbyMap.delete(socketId); return null; }

    lobby.players.delete(socketId);
    this.playerLobbyMap.delete(socketId);
    if (lobby.game) lobby.game.removePlayer(socketId);

    if (lobby.host === socketId) {
      var remaining = [];
      for (var [pid, pInfo] of lobby.players) {
        if (!pInfo.isBot) remaining.push(pid);
      }
      if (remaining.length > 0) {
        lobby.host = remaining[0];
      } else {
        // No humans left — destroy
        for (var [pid2] of lobby.players) this.playerLobbyMap.delete(pid2);
        this.lobbies.delete(lobbyId);
        return { lobbyId: lobbyId, destroyed: true };
      }
    }

    // Check if any humans remain
    var humanCount = 0;
    for (var [, pInfo2] of lobby.players) {
      if (!pInfo2.isBot) humanCount++;
    }
    if (humanCount === 0) {
      for (var [pid3] of lobby.players) this.playerLobbyMap.delete(pid3);
      this.lobbies.delete(lobbyId);
      return { lobbyId: lobbyId, destroyed: true };
    }

    return { lobbyId: lobbyId, destroyed: false };
  }

  addBot(lobbyId, requesterId) {
    var lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.host !== requesterId || lobby.state !== 'waiting') return null;
    if (lobby.players.size >= lobby.maxPlayers) return null;

    var botCount = 0;
    for (var [, p] of lobby.players) { if (p.isBot) botCount++; }
    var botId = 'bot_' + lobbyId + '_' + botCount;
    var botName = BOT_NAMES[botCount % BOT_NAMES.length];
    var botColor = BOT_COLORS[botCount % BOT_COLORS.length];

    // Give bots random weapons
    var botWeapons = ['default_dagger', 'default_bow'];
    if (Math.random() < 0.6) botWeapons.push(RANGED_WEAPON_IDS[Math.floor(Math.random() * RANGED_WEAPON_IDS.length)]);
    if (Math.random() < 0.4) botWeapons.push(MELEE_WEAPON_IDS[Math.floor(Math.random() * MELEE_WEAPON_IDS.length)]);
    var botSpell = Math.random() < 0.5 ? SPELLS[Math.floor(Math.random() * SPELLS.length)].id : null;

    lobby.players.set(botId, { id: botId, name: botName, color: botColor, isBot: true, weapons: botWeapons, spell: botSpell });
    return true;
  }

  removeBot(lobbyId, botId, requesterId) {
    var lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.host !== requesterId || lobby.state !== 'waiting') return null;
    var p = lobby.players.get(botId);
    if (!p || !p.isBot) return null;
    lobby.players.delete(botId);
    return true;
  }

  startGame(lobbyId, requesterId) {
    var lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.host !== requesterId || lobby.state !== 'waiting') return null;
    if (lobby.players.size < 2) return null;

    lobby.state = 'playing';
    lobby.game = new LieroGame(lobby.settings);

    for (var [pid, pInfo] of lobby.players) {
      var wpns = pInfo.weapons;
      if (!Array.isArray(wpns) || wpns.length === 0) wpns = ['default_dagger', 'default_bow'];
      // Validate and cap at 5
      wpns = wpns.filter(function(id) { return WEAPON_MAP.has(id); }).slice(0, 5);
      if (wpns.length === 0) wpns = ['default_dagger', 'default_bow'];

      var spell = (pInfo.spell && SPELL_MAP.has(pInfo.spell)) ? pInfo.spell : 'tunnel';
      lobby.game.addPlayer(pid, pInfo.name, pInfo.color, wpns, spell, pInfo.isBot);
    }

    return true;
  }

  handleInput(socketId, input) {
    var lobbyId = this.playerLobbyMap.get(socketId);
    if (!lobbyId) return;
    var lobby = this.lobbies.get(lobbyId);
    if (!lobby || !lobby.game) return;
    var player = lobby.game.players.get(socketId);
    if (!player || !player.alive) return;
    // Sanitize input values
    if (input) {
      if (input.aimAngle !== undefined) {
        input.aimAngle = parseFloat(input.aimAngle);
        if (!isFinite(input.aimAngle)) input.aimAngle = 0;
        input.aimAngle = Math.max(-Math.PI, Math.min(Math.PI, input.aimAngle));
      }
      if (input.switchWeapon !== undefined) {
        input.switchWeapon = parseInt(input.switchWeapon) || 0;
        if (input.switchWeapon !== -1 && input.switchWeapon !== 0 && input.switchWeapon !== 1) input.switchWeapon = 0;
      }
      input.left = !!input.left;
      input.right = !!input.right;
      input.jump = !!input.jump;
      input.fire = !!input.fire;
      input.spell = !!input.spell;
    }
    player.input = input;
  }

  getPlayerLobbyId(socketId) {
    return this.playerLobbyMap.get(socketId) || null;
  }

  getLobbies() {
    var result = [];
    for (var [id, lobby] of this.lobbies) {
      var hostInfo = lobby.players.get(lobby.host);
      result.push({
        id: id, host: lobby.host, hostName: hostInfo ? hostInfo.name : 'Unknown',
        players: lobby.players.size,
        maxPlayers: lobby.maxPlayers, state: lobby.state,
        mapType: lobby.settings.mapType, scoreLimit: lobby.settings.scoreLimit,
      });
    }
    return result;
  }

  getLobbyState(lobbyId) {
    var lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    var players = [];
    for (var [pid, p] of lobby.players) {
      players.push({ id: pid, name: p.name, color: p.color, isBot: p.isBot });
    }
    var hostInfo = lobby.players.get(lobby.host);
    return { id: lobby.id, host: lobby.host, hostName: hostInfo ? hostInfo.name : 'Unknown', players: players, settings: lobby.settings, state: lobby.state };
  }

  tickAll() {
    var broadcasts = [];
    for (var [lobbyId, lobby] of this.lobbies) {
      if (lobby.state !== 'playing' || !lobby.game) continue;

      lobby.game.tick();

      var broadcast = {
        lobbyId: lobbyId,
        players: lobby.game.getPlayersState(),
        projectiles: lobby.game.projectiles.map(function(p) { return { id: p.id, type: p.weaponId, x: Math.round(p.x), y: Math.round(p.y), vx: p.vx, vy: p.vy }; }),
        pickups: lobby.game.pickups.map(function(p) { return { id: p.id, type: p.type, x: p.x, y: p.y, itemId: p.itemId }; }),
        weapons: lobby.game.getWeaponDefs(),
        terrainDeltas: lobby.game.pendingEvents.terrainDeltas,
        kills: lobby.game.pendingEvents.kills,
        respawns: lobby.game.pendingEvents.respawns,
        pickupSpawns: lobby.game.pendingEvents.pickupSpawns,
        pickupCollections: lobby.game.pendingEvents.pickupCollections,
        spellCasts: lobby.game.pendingEvents.spellCasts,
        decoys: lobby.game.decoys.map(function(d) { return { x: Math.round(d.x), y: Math.round(d.y), name: d.name, color: d.color, ownerId: d.ownerId }; }),
      };

      if (lobby.game.gameOver) {
        lobby.state = 'finished';
        var scores = [];
        var chipRewards = {};
        for (var [pid, p] of lobby.game.players) {
          scores.push({ id: pid, name: p.name, score: p.score });
          var isWinner = lobby.game.winner && pid === lobby.game.winner.id;
          chipRewards[pid] = Math.min(1000, (isWinner ? 200 : 25) + p.score * 10);
        }
        broadcast.gameOver = {
          winnerId: lobby.game.winner ? lobby.game.winner.id : null,
          winnerName: lobby.game.winner ? lobby.game.winner.name : null,
          scores: scores, chipRewards: chipRewards,
        };

        // Reset lobby after delay
        var self = this;
        var capturedLobbyId = lobbyId;
        setTimeout(function() {
          var lb = self.lobbies.get(capturedLobbyId);
          if (!lb) return;
          lb.state = 'waiting';
          lb.game = null;
          // Remove bots
          var toRemove = [];
          for (var [pid2, pInfo] of lb.players) {
            if (pInfo.isBot) toRemove.push(pid2);
          }
          for (var r = 0; r < toRemove.length; r++) {
            lb.players.delete(toRemove[r]);
            self.playerLobbyMap.delete(toRemove[r]);
          }
        }, 10000);
      }

      broadcasts.push(broadcast);
    }
    return broadcasts;
  }

  reset() {
    this.lobbies.clear();
    this.playerLobbyMap.clear();
  }
}

module.exports = { LieroManager };
