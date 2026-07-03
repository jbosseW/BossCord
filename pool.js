'use strict';

// pool.js -- Complete 8-ball pool game engine for BossCord
// Server-side Node.js module: manages lobbies, physics simulation, and 8-ball rules.
// Follows the chess.js pattern from this project.

var crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
var TABLE_W = 900;
var TABLE_H = 450;
var BALL_RADIUS = 10;
var POCKET_RADIUS = 18;
var FRICTION = 0.985;
var MIN_VELOCITY = 0.1;
var MAX_SHOT_POWER = 25;
var PHYSICS_TICK_MS = 16;   // ~60Hz
var BROADCAST_EVERY = 3;    // broadcast every 3rd tick = 20Hz
var MAX_CHAT = 50;
var MAX_LOBBIES = 50;
var INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
var INACTIVITY_CHECK_INTERVAL_MS = 30 * 1000; // check every 30 seconds
var POOL_WIN_REWARD = 75;
var POOL_MIN_BET = 0;
var POOL_MAX_BET = 10000;

// Six pocket positions
var POCKETS = [
  { x: 0,             y: 0 },              // top-left
  { x: TABLE_W / 2,   y: -3 },             // top-center (slightly inset)
  { x: TABLE_W,       y: 0 },              // top-right
  { x: 0,             y: TABLE_H },         // bottom-left
  { x: TABLE_W / 2,   y: TABLE_H + 3 },    // bottom-center
  { x: TABLE_W,       y: TABLE_H },         // bottom-right
];

// Ball colors (exported for client rendering)
var BALL_COLORS = {
  0:  '#ffffff',   // cue
  1:  '#f4d03f',   // yellow (solid)
  2:  '#2e86c1',   // blue (solid)
  3:  '#e74c3c',   // red (solid)
  4:  '#7d3c98',   // purple (solid)
  5:  '#e67e22',   // orange (solid)
  6:  '#27ae60',   // green (solid)
  7:  '#922b21',   // maroon (solid)
  8:  '#1c1c1e',   // 8-ball
  9:  '#f4d03f',   // yellow stripe
  10: '#2e86c1',   // blue stripe
  11: '#e74c3c',   // red stripe
  12: '#7d3c98',   // purple stripe
  13: '#e67e22',   // orange stripe
  14: '#27ae60',   // green stripe
  15: '#922b21',   // maroon stripe
};

// Pre-computed constant
var WALL_BOUNCE_DAMPING = 0.8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function distSq(ax, ay, bx, by) {
  var dx = ax - bx;
  var dy = ay - by;
  return dx * dx + dy * dy;
}

function dist(ax, ay, bx, by) {
  return Math.sqrt(distSq(ax, ay, bx, by));
}

function ballGroup(ballId) {
  // 0 = cue, 1-7 = solids, 8 = 8-ball, 9-15 = stripes
  if (ballId === 0) return 'cue';
  if (ballId === 8) return '8ball';
  if (ballId >= 1 && ballId <= 7) return 'solids';
  if (ballId >= 9 && ballId <= 15) return 'stripes';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Ball initialization -- standard 8-ball rack
// ---------------------------------------------------------------------------
function initBalls() {
  var balls = [];

  // Ball 0: cue ball
  balls.push({
    id: 0,
    x: TABLE_W * 0.25,
    y: TABLE_H / 2,
    vx: 0,
    vy: 0,
    pocketed: false,
  });

  // Triangle rack at the foot spot (TABLE_W * 0.75, TABLE_H / 2)
  // 5 rows: 1, 2, 3, 4, 5 balls
  // Constraints:
  //   - Row 2 middle = 8-ball
  //   - Row 4 corners = one solid, one stripe
  //   - Mix the rest so solids and stripes are distributed
  var spacing = BALL_RADIUS * 2.05;
  var rowOffsetX = spacing * Math.sqrt(3) / 2;
  var footX = TABLE_W * 0.75;
  var footY = TABLE_H / 2;

  // We define the rack layout by ball id.
  // Row 0 (1 ball):  apex -- one solid (1)
  // Row 1 (2 balls): one stripe, one solid
  // Row 2 (3 balls): solid, 8-ball, stripe
  // Row 3 (4 balls): stripe, solid, stripe, solid
  // Row 4 (5 balls): solid(corner), stripe, solid, stripe, stripe(corner)
  //
  // This gives a good mix with 8 in center of row 2 and mixed corners on row 4.
  var rackIds = [
    [1],                  // row 0: apex
    [9, 2],               // row 1
    [3, 8, 10],           // row 2: 8-ball in center
    [11, 4, 12, 5],       // row 3
    [6, 13, 7, 14, 15],   // row 4: corners are 6 (solid) and 15 (stripe)
  ];

  for (var row = 0; row < rackIds.length; row++) {
    var rowBalls = rackIds[row];
    var numInRow = rowBalls.length;
    // The x position increases along the rack direction (towards the right)
    var rx = footX + row * rowOffsetX;
    // Center the row vertically
    var startY = footY - (numInRow - 1) * spacing / 2;

    for (var col = 0; col < numInRow; col++) {
      balls.push({
        id: rowBalls[col],
        x: rx,
        y: startY + col * spacing,
        vx: 0,
        vy: 0,
        pocketed: false,
      });
    }
  }

  return balls;
}

// ---------------------------------------------------------------------------
// PoolManager
// ---------------------------------------------------------------------------
function PoolManager() {
  this.lobbies = new Map();        // lobbyId -> lobby
  this.playerLobby = new Map();    // socketId -> lobbyId
  this.spectatorLobby = new Map(); // socketId -> lobbyId
  this.nextId = 1;
  this._broadcastFn = null;
  this._inactivityTimer = null;    // setInterval handle for inactivity checks
}

// Store the function used to broadcast state to a lobby room
PoolManager.prototype.setBroadcastFn = function setBroadcastFn(fn) {
  this._broadcastFn = fn;
  // Start inactivity check timer when broadcast function is available
  this._startInactivityCheck();
};

// Start periodic inactivity check for abandoned lobbies
PoolManager.prototype._startInactivityCheck = function _startInactivityCheck() {
  if (this._inactivityTimer) return;
  var self = this;
  this._inactivityTimer = setInterval(function () {
    self._checkInactiveLobbies();
  }, INACTIVITY_CHECK_INTERVAL_MS);
};

// Stop the inactivity check timer
PoolManager.prototype._stopInactivityCheck = function _stopInactivityCheck() {
  if (this._inactivityTimer) {
    clearInterval(this._inactivityTimer);
    this._inactivityTimer = null;
  }
};

// Check all lobbies for inactivity and destroy abandoned ones
PoolManager.prototype._checkInactiveLobbies = function _checkInactiveLobbies() {
  var now = Date.now();
  var toDestroy = [];

  for (var entry of this.lobbies) {
    var lobbyId = entry[0];
    var lobby = entry[1];
    var lastAction = lobby.lastActionTime || lobby.createdAt || 0;
    if (now - lastAction >= INACTIVITY_TIMEOUT_MS) {
      toDestroy.push(lobbyId);
    }
  }

  for (var i = 0; i < toDestroy.length; i++) {
    var id = toDestroy[i];
    var lobby = this.lobbies.get(id);
    if (!lobby) continue;

    console.log('[pool] Destroying inactive lobby ' + id + ' (no activity for 5 minutes)');

    // Stop physics loop
    this._stopPhysicsLoop(lobby);

    // Clean up all players
    for (var pid of lobby.players.keys()) {
      this.playerLobby.delete(pid);
    }

    // Clean up all spectators
    for (var sid of lobby.spectators.keys()) {
      this.spectatorLobby.delete(sid);
    }

    // Broadcast lobby destruction before removing
    if (this._broadcastFn) {
      this._broadcastFn(id, 'pool_lobby_destroyed', { reason: 'inactivity' });
    }

    this.lobbies.delete(id);
  }

  // Broadcast updated lobby list if any were destroyed
  if (toDestroy.length > 0 && this._broadcastFn) {
    this._broadcastFn(null, 'pool_lobbies_updated_global', { lobbies: this.getLobbies() });
  }
};

// -----------------------------------------------------------------------
// Lobby lifecycle
// -----------------------------------------------------------------------

PoolManager.prototype.createLobby = function createLobby(socketId, name, color, bet) {
  if (this.playerLobby.has(socketId)) return null;
  if (this.lobbies.size >= MAX_LOBBIES) return null;

  var parsedBet = parseInt(bet, 10) || 0;
  if (parsedBet < POOL_MIN_BET) parsedBet = POOL_MIN_BET;
  if (parsedBet > POOL_MAX_BET) parsedBet = POOL_MAX_BET;

  var id = 'pool_' + (this.nextId++);

  var lobby = {
    id: id,
    players: new Map(),
    spectators: new Map(),
    queue: [],                 // array of { id, name, color } waiting to play winner
    state: 'waiting',
    bet: parsedBet,
    balls: [],
    turnIndex: 0,
    turnPlayerId: null,
    playerOrder: [],
    phase: 'aiming',
    assignment: {},           // socketId -> 'solids'|'stripes'
    breakShot: true,
    foulOnShot: false,
    pocketedThisTurn: [],
    firstHitThisTurn: null,
    cueBallPocketed: false,
    turnMessage: '',
    result: null,
    physicsTimer: null,
    tickCount: 0,
    chat: [],
    createdAt: Date.now(),
    lastActionTime: Date.now(),
  };

  lobby.players.set(socketId, {
    id: socketId,
    name: name || 'Anon',
    color: color || '#5865f2',
    side: null,
    ready: false,
    isBreaker: false,
  });

  this.lobbies.set(id, lobby);
  this.playerLobby.set(socketId, id);
  return lobby;
};

PoolManager.prototype.joinLobby = function joinLobby(socketId, lobbyId, name, color) {
  if (this.playerLobby.has(socketId)) return null;

  var lobby = this.lobbies.get(lobbyId);
  if (!lobby) return null;
  if (lobby.state !== 'waiting') return null;
  if (lobby.players.size >= 2) return null;

  lobby.players.set(socketId, {
    id: socketId,
    name: name || 'Anon',
    color: color || '#5865f2',
    side: null,
    ready: false,
    isBreaker: false,
  });

  this.playerLobby.set(socketId, lobbyId);
  lobby.lastActionTime = Date.now();
  return lobby;
};

PoolManager.prototype.spectate = function spectate(socketId, lobbyId, name, color) {
  if (this.spectatorLobby.has(socketId)) return null;
  if (this.playerLobby.has(socketId)) return null;

  var lobby = this.lobbies.get(lobbyId);
  if (!lobby) return null;

  lobby.spectators.set(socketId, {
    id: socketId,
    name: name || 'Anon',
    color: color || '#5865f2',
  });

  this.spectatorLobby.set(socketId, lobbyId);
  return lobby;
};

PoolManager.prototype.leaveLobby = function leaveLobby(socketId) {
  var lobbyId = this.playerLobby.get(socketId);
  if (!lobbyId) return null;

  var lobby = this.lobbies.get(lobbyId);
  this.playerLobby.delete(socketId);

  if (!lobby) return { lobbyId: lobbyId, destroyed: true };

  lobby.players.delete(socketId);

  // If the game was in progress, the remaining player wins by abandonment
  if (lobby.state === 'playing' && lobby.players.size > 0) {
    var remaining = lobby.players.values().next().value;
    if (remaining) {
      this._endGame(lobby, remaining.id, socketId, 'abandon');
    }
  }

  if (lobby.players.size === 0) {
    this._stopPhysicsLoop(lobby);
    // Also clean up any spectators
    for (var specId of lobby.spectators.keys()) {
      this.spectatorLobby.delete(specId);
    }
    this.lobbies.delete(lobbyId);
    return { lobbyId: lobbyId, destroyed: true };
  }

  return { lobbyId: lobbyId, destroyed: false };
};

PoolManager.prototype.leaveSpectator = function leaveSpectator(socketId) {
  var lobbyId = this.spectatorLobby.get(socketId);
  if (!lobbyId) return null;

  var lobby = this.lobbies.get(lobbyId);
  this.spectatorLobby.delete(socketId);

  if (lobby) {
    lobby.spectators.delete(socketId);
    // Also remove from queue
    if (lobby.queue) {
      lobby.queue = lobby.queue.filter(function(q) { return q.id !== socketId; });
    }
  }

  return { lobbyId: lobbyId };
};

PoolManager.prototype.joinQueue = function joinQueue(socketId, lobbyId) {
  var lobby = this.lobbies.get(lobbyId);
  if (!lobby) return null;
  if (!this.spectatorLobby.has(socketId)) return null;
  for (var i = 0; i < lobby.queue.length; i++) {
    if (lobby.queue[i].id === socketId) return null;
  }
  var spec = lobby.spectators.get(socketId);
  if (!spec) return null;
  lobby.queue.push({ id: socketId, name: spec.name, color: spec.color });
  return lobby;
};

PoolManager.prototype.leaveQueue = function leaveQueue(socketId) {
  var lobbyId = this.spectatorLobby.get(socketId);
  if (!lobbyId) return null;
  var lobby = this.lobbies.get(lobbyId);
  if (!lobby) return null;
  lobby.queue = lobby.queue.filter(function(q) { return q.id !== socketId; });
  return lobby;
};

PoolManager.prototype.promoteFromQueue = function promoteFromQueue(lobby) {
  if (!lobby || !lobby.result || !lobby.queue || lobby.queue.length === 0) return null;

  var winnerId = lobby.result.winner;
  if (!winnerId) return null;
  var winner = lobby.players.get(winnerId);
  if (!winner) return null;

  var next = lobby.queue.shift();
  if (!next) return null;

  // Find the loser
  var loserId = lobby.result.loser;
  if (loserId) {
    var loser = lobby.players.get(loserId);
    lobby.players.delete(loserId);
    this.playerLobby.delete(loserId);
    // Move loser to spectators
    lobby.spectators.set(loserId, { id: loserId, name: loser ? loser.name : 'Player', color: loser ? loser.color : '#dcddde' });
    this.spectatorLobby.set(loserId, lobby.id);
  }

  // Remove next from spectators
  lobby.spectators.delete(next.id);
  this.spectatorLobby.delete(next.id);

  // Add next as player
  lobby.players.set(next.id, {
    id: next.id,
    name: next.name,
    color: next.color,
    side: null,
    ready: false,
    isBreaker: false,
  });
  this.playerLobby.set(next.id, lobby.id);

  // Reset game state
  winner.ready = false;
  winner.side = null;
  winner.isBreaker = true;
  lobby.state = 'waiting';
  lobby.balls = [];
  lobby.phase = 'aiming';
  lobby.assignment = {};
  lobby.breakShot = true;
  lobby.result = null;
  lobby.turnIndex = 0;
  lobby.turnPlayerId = null;
  lobby.playerOrder = [];

  return { lobby: lobby, loserId: loserId, nextPlayerId: next.id };
};

PoolManager.prototype.playerReady = function playerReady(socketId) {
  var lobbyId = this.playerLobby.get(socketId);
  if (!lobbyId) return null;

  var lobby = this.lobbies.get(lobbyId);
  if (!lobby || lobby.state !== 'waiting') return null;

  var p = lobby.players.get(socketId);
  if (!p) return null;

  p.ready = !p.ready;
  lobby.lastActionTime = Date.now();

  // Check if both players are ready
  if (lobby.players.size === 2) {
    var allReady = true;
    for (var entry of lobby.players.values()) {
      if (!entry.ready) { allReady = false; break; }
    }
    if (allReady) {
      this._startGame(lobby);
    }
  }

  return lobby;
};

// -----------------------------------------------------------------------
// Game start
// -----------------------------------------------------------------------

PoolManager.prototype._startGame = function _startGame(lobby) {
  lobby.state = 'playing';
  lobby.breakShot = true;
  lobby.balls = initBalls();
  lobby.assignment = {};
  lobby.result = null;
  lobby.foulOnShot = false;
  lobby.pocketedThisTurn = [];
  lobby.firstHitThisTurn = null;
  lobby.cueBallPocketed = false;
  lobby.turnMessage = '';
  lobby.tickCount = 0;

  // Build player order from the map keys
  lobby.playerOrder = [];
  for (var pid of lobby.players.keys()) {
    lobby.playerOrder.push(pid);
  }

  // Player 0 (first to create/join) is breaker
  lobby.turnIndex = 0;
  lobby.turnPlayerId = lobby.playerOrder[0];

  // Mark the breaker
  var breakerData = lobby.players.get(lobby.playerOrder[0]);
  if (breakerData) breakerData.isBreaker = true;

  lobby.phase = 'aiming';
};

// -----------------------------------------------------------------------
// Shooting
// -----------------------------------------------------------------------

PoolManager.prototype.shoot = function shoot(socketId, angle, power) {
  var lobbyId = this.playerLobby.get(socketId);
  if (!lobbyId) return { error: 'Not in a lobby' };

  var lobby = this.lobbies.get(lobbyId);
  if (!lobby || lobby.state !== 'playing') return { error: 'Game not in progress' };
  if (lobby.turnPlayerId !== socketId) return { error: 'Not your turn' };
  if (lobby.phase !== 'aiming') return { error: 'Cannot shoot right now' };

  // Validate angle and power
  var a = parseFloat(angle);
  var p = parseFloat(power);
  if (isNaN(a) || isNaN(p)) return { error: 'Invalid shot parameters' };
  if (p <= 0) return { error: 'Power must be positive' };
  if (p > MAX_SHOT_POWER) p = MAX_SHOT_POWER;

  // Find the cue ball
  var cueBall = null;
  for (var i = 0; i < lobby.balls.length; i++) {
    if (lobby.balls[i].id === 0) {
      cueBall = lobby.balls[i];
      break;
    }
  }
  if (!cueBall || cueBall.pocketed) return { error: 'Cue ball not on table' };

  // Apply velocity
  cueBall.vx = Math.cos(a) * p;
  cueBall.vy = Math.sin(a) * p;

  // Update last action time for inactivity tracking
  lobby.lastActionTime = Date.now();

  // Reset per-shot tracking
  lobby.phase = 'simulating';
  lobby.pocketedThisTurn = [];
  lobby.foulOnShot = false;
  lobby.firstHitThisTurn = null;
  lobby.cueBallPocketed = false;
  lobby.turnMessage = '';

  // Start the physics loop
  this._startPhysicsLoop(lobby);

  return { success: true };
};

// -----------------------------------------------------------------------
// Ball-in-hand placement
// -----------------------------------------------------------------------

PoolManager.prototype.placeCueBall = function placeCueBall(socketId, x, y) {
  var lobbyId = this.playerLobby.get(socketId);
  if (!lobbyId) return { error: 'Not in a lobby' };

  var lobby = this.lobbies.get(lobbyId);
  if (!lobby || lobby.state !== 'playing') return { error: 'Game not in progress' };
  if (lobby.turnPlayerId !== socketId) return { error: 'Not your turn' };
  if (lobby.phase !== 'ball_in_hand') return { error: 'Not in ball-in-hand phase' };

  var px = parseFloat(x);
  var py = parseFloat(y);
  if (isNaN(px) || isNaN(py)) return { error: 'Invalid position' };

  // Must be within table bounds with BALL_RADIUS margin
  if (px < BALL_RADIUS || px > TABLE_W - BALL_RADIUS ||
      py < BALL_RADIUS || py > TABLE_H - BALL_RADIUS) {
    return { error: 'Position out of bounds' };
  }

  // Must not overlap any other non-pocketed ball
  for (var i = 0; i < lobby.balls.length; i++) {
    var b = lobby.balls[i];
    if (b.id === 0 || b.pocketed) continue;
    var d = dist(px, py, b.x, b.y);
    if (d < BALL_RADIUS * 2) {
      return { error: 'Overlaps another ball' };
    }
  }

  // Place the cue ball
  var cueBall = null;
  for (var j = 0; j < lobby.balls.length; j++) {
    if (lobby.balls[j].id === 0) {
      cueBall = lobby.balls[j];
      break;
    }
  }
  if (!cueBall) return { error: 'Cue ball not found' };

  cueBall.x = px;
  cueBall.y = py;
  cueBall.vx = 0;
  cueBall.vy = 0;
  cueBall.pocketed = false;

  lobby.phase = 'aiming';
  lobby.lastActionTime = Date.now();

  return { success: true };
};

// -----------------------------------------------------------------------
// Physics loop management
// -----------------------------------------------------------------------

PoolManager.prototype._startPhysicsLoop = function _startPhysicsLoop(lobby) {
  this._stopPhysicsLoop(lobby);

  var self = this;
  lobby.tickCount = 0;

  lobby.physicsTimer = setInterval(function () {
    self._physicsTick(lobby);
  }, PHYSICS_TICK_MS);
};

PoolManager.prototype._stopPhysicsLoop = function _stopPhysicsLoop(lobby) {
  if (lobby.physicsTimer !== null) {
    clearInterval(lobby.physicsTimer);
    lobby.physicsTimer = null;
  }
};

// -----------------------------------------------------------------------
// Physics tick -- the main simulation step
// -----------------------------------------------------------------------

PoolManager.prototype._physicsTick = function _physicsTick(lobby) {
  this._moveBalls(lobby);
  this._checkBallCollisions(lobby);
  this._checkWallCollisions(lobby);
  this._checkPockets(lobby);
  this._applyFriction(lobby);

  lobby.tickCount++;

  // Broadcast at reduced rate for network efficiency
  if (lobby.tickCount % BROADCAST_EVERY === 0 && this._broadcastFn) {
    this._broadcastFn(lobby.id, 'pool_physics_update', this._serializeBalls(lobby));
  }

  // Check if all balls have stopped
  if (this._allBallsStopped(lobby)) {
    this._stopPhysicsLoop(lobby);
    this._onSimulationEnd(lobby);
  }
};

// -----------------------------------------------------------------------
// Physics sub-steps
// -----------------------------------------------------------------------

PoolManager.prototype._moveBalls = function _moveBalls(lobby) {
  var balls = lobby.balls;
  for (var i = 0; i < balls.length; i++) {
    var b = balls[i];
    if (b.pocketed) continue;
    b.x += b.vx;
    b.y += b.vy;
  }
};

PoolManager.prototype._checkBallCollisions = function _checkBallCollisions(lobby) {
  var balls = lobby.balls;
  var twoR = BALL_RADIUS * 2;

  for (var i = 0; i < balls.length; i++) {
    if (balls[i].pocketed) continue;

    for (var j = i + 1; j < balls.length; j++) {
      if (balls[j].pocketed) continue;

      var a = balls[i];
      var b = balls[j];

      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var dSq = dx * dx + dy * dy;

      if (dSq >= twoR * twoR || dSq === 0) continue;

      var d = Math.sqrt(dSq);

      // Normal vector from a to b
      var nx = dx / d;
      var ny = dy / d;

      // Relative velocity along normal
      var dvx = a.vx - b.vx;
      var dvy = a.vy - b.vy;
      var dvn = dvx * nx + dvy * ny;

      // Skip if balls are moving apart
      if (dvn <= 0) continue;

      // Equal mass elastic collision: exchange velocity components along normal
      a.vx -= dvn * nx;
      a.vy -= dvn * ny;
      b.vx += dvn * nx;
      b.vy += dvn * ny;

      // Separate overlapping balls -- push each half the overlap distance
      var overlap = twoR - d;
      var sepX = (overlap / 2) * nx;
      var sepY = (overlap / 2) * ny;
      a.x -= sepX;
      a.y -= sepY;
      b.x += sepX;
      b.y += sepY;

      // Track first ball the cue ball contacts
      if (lobby.firstHitThisTurn === null) {
        if (a.id === 0) {
          lobby.firstHitThisTurn = b.id;
        } else if (b.id === 0) {
          lobby.firstHitThisTurn = a.id;
        }
      }
    }
  }
};

PoolManager.prototype._checkWallCollisions = function _checkWallCollisions(lobby) {
  var balls = lobby.balls;
  var r = BALL_RADIUS;
  var pocketZone = POCKET_RADIUS * 1.5;

  for (var i = 0; i < balls.length; i++) {
    var b = balls[i];
    if (b.pocketed) continue;

    // Check if this ball is near any pocket -- if so, skip wall bouncing
    // to allow the ball to travel into the pocket
    var nearPocket = false;
    for (var p = 0; p < POCKETS.length; p++) {
      var d = dist(b.x, b.y, POCKETS[p].x, POCKETS[p].y);
      if (d < pocketZone) {
        nearPocket = true;
        break;
      }
    }

    if (nearPocket) continue;

    // Left wall
    if (b.x < r) {
      b.x = r;
      b.vx = -b.vx * WALL_BOUNCE_DAMPING;
    }
    // Right wall
    if (b.x > TABLE_W - r) {
      b.x = TABLE_W - r;
      b.vx = -b.vx * WALL_BOUNCE_DAMPING;
    }
    // Top wall
    if (b.y < r) {
      b.y = r;
      b.vy = -b.vy * WALL_BOUNCE_DAMPING;
    }
    // Bottom wall
    if (b.y > TABLE_H - r) {
      b.y = TABLE_H - r;
      b.vy = -b.vy * WALL_BOUNCE_DAMPING;
    }
  }
};

PoolManager.prototype._checkPockets = function _checkPockets(lobby) {
  var balls = lobby.balls;

  for (var i = 0; i < balls.length; i++) {
    var b = balls[i];
    if (b.pocketed) continue;

    for (var p = 0; p < POCKETS.length; p++) {
      // Side pockets (indices 1 and 4) have a slightly smaller effective radius
      var effectiveRadius = (p === 1 || p === 4)
        ? POCKET_RADIUS * 0.9
        : POCKET_RADIUS;

      var d = dist(b.x, b.y, POCKETS[p].x, POCKETS[p].y);
      if (d < effectiveRadius) {
        b.pocketed = true;
        b.vx = 0;
        b.vy = 0;
        lobby.pocketedThisTurn.push(b.id);

        if (b.id === 0) {
          lobby.cueBallPocketed = true;
        }
        break; // ball can only go in one pocket
      }
    }
  }
};

PoolManager.prototype._applyFriction = function _applyFriction(lobby) {
  var balls = lobby.balls;

  for (var i = 0; i < balls.length; i++) {
    var b = balls[i];
    if (b.pocketed) continue;

    b.vx *= FRICTION;
    b.vy *= FRICTION;

    // If speed is below minimum, stop the ball
    var speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (speed < MIN_VELOCITY) {
      b.vx = 0;
      b.vy = 0;
    }
  }
};

PoolManager.prototype._allBallsStopped = function _allBallsStopped(lobby) {
  var balls = lobby.balls;
  for (var i = 0; i < balls.length; i++) {
    var b = balls[i];
    if (b.pocketed) continue;
    if (b.vx !== 0 || b.vy !== 0) return false;
  }
  return true;
};

// -----------------------------------------------------------------------
// Simulation end -- 8-ball rules evaluation
// -----------------------------------------------------------------------

PoolManager.prototype._onSimulationEnd = function _onSimulationEnd(lobby) {
  var shooterId = lobby.turnPlayerId;
  var shooterIdx = lobby.turnIndex;
  var opponentIdx = shooterIdx === 0 ? 1 : 0;
  var opponentId = lobby.playerOrder[opponentIdx];
  var pocketed = lobby.pocketedThisTurn;
  var isBreak = lobby.breakShot;
  var foul = false;
  var message = '';

  // --- (a) Cue ball scratch ---
  if (lobby.cueBallPocketed) {
    foul = true;
    message = 'Scratch! Cue ball pocketed.';

    // Un-pocket the cue ball (it will be placed via ball_in_hand)
    for (var i = 0; i < lobby.balls.length; i++) {
      if (lobby.balls[i].id === 0) {
        lobby.balls[i].pocketed = false;
        // Move it off-table temporarily; it gets repositioned during ball_in_hand
        lobby.balls[i].x = -100;
        lobby.balls[i].y = -100;
        break;
      }
    }
  }

  // --- (b) Check if 8-ball was pocketed ---
  var eightBallPocketed = false;
  for (var ei = 0; ei < pocketed.length; ei++) {
    if (pocketed[ei] === 8) {
      eightBallPocketed = true;
      break;
    }
  }

  if (eightBallPocketed) {
    // Determine if this is a legal 8-ball pocket
    var shooterGroup = lobby.assignment[shooterId];
    var allGroupCleared = false;

    if (shooterGroup) {
      allGroupCleared = this._isGroupCleared(lobby, shooterId);
    }

    if (allGroupCleared && !foul) {
      // Legal win: shooter cleared all their balls and then pocketed the 8
      this._endGame(lobby, shooterId, opponentId, '8-ball pocketed legally');
      this._broadcastShotResult(lobby, pocketed, false, 'Wins! 8-ball pocketed after clearing group.');
      this._broadcastGameOver(lobby);
      return;
    } else {
      // Loss: pocketed 8-ball too early, or with a foul, or without assignment
      var lossReason = foul
        ? '8-ball pocketed on a foul'
        : '8-ball pocketed before clearing group';
      this._endGame(lobby, opponentId, shooterId, lossReason);
      this._broadcastShotResult(lobby, pocketed, true, 'Loss! ' + lossReason + '.');
      this._broadcastGameOver(lobby);
      return;
    }
  }

  // --- (c) Group assignment ---
  // Only assign groups if not yet assigned and this is not the break shot or we allow break assignment
  // Standard rule: groups can be assigned on break if a ball is pocketed
  if (!lobby.assignment[shooterId]) {
    // Find the first non-cue, non-8 ball pocketed this turn
    var assignBallId = null;
    for (var ai = 0; ai < pocketed.length; ai++) {
      var pid = pocketed[ai];
      if (pid !== 0 && pid !== 8) {
        assignBallId = pid;
        break;
      }
    }

    if (assignBallId !== null) {
      if (assignBallId >= 1 && assignBallId <= 7) {
        lobby.assignment[shooterId] = 'solids';
        lobby.assignment[opponentId] = 'stripes';
        message += (message ? ' ' : '') + 'Groups assigned: shooter gets solids.';
      } else if (assignBallId >= 9 && assignBallId <= 15) {
        lobby.assignment[shooterId] = 'stripes';
        lobby.assignment[opponentId] = 'solids';
        message += (message ? ' ' : '') + 'Groups assigned: shooter gets stripes.';
      }

      // Update player side info
      var shooterPlayer = lobby.players.get(shooterId);
      var opponentPlayer = lobby.players.get(opponentId);
      if (shooterPlayer) shooterPlayer.side = lobby.assignment[shooterId];
      if (opponentPlayer) opponentPlayer.side = lobby.assignment[opponentId];
    }
  }

  // --- (d) First-hit foul check ---
  if (!isBreak && !foul) {
    if (lobby.firstHitThisTurn === null) {
      // Cue ball didn't hit anything
      foul = true;
      message += (message ? ' ' : '') + 'Foul: cue ball did not contact any ball.';
    } else if (lobby.assignment[shooterId]) {
      // Groups are assigned -- check if first ball hit belongs to opponent or is 8-ball when not allowed
      var firstHitGroup = ballGroup(lobby.firstHitThisTurn);
      var shooterAssign = lobby.assignment[shooterId];

      if (lobby.firstHitThisTurn === 8) {
        // Hitting the 8-ball first is only legal if shooter has cleared their group
        if (!this._isGroupCleared(lobby, shooterId)) {
          foul = true;
          message += (message ? ' ' : '') + 'Foul: hit 8-ball first with group not cleared.';
        }
      } else if (firstHitGroup !== shooterAssign) {
        // Hit opponent's ball first
        foul = true;
        message += (message ? ' ' : '') + 'Foul: hit opponent\'s ball first.';
      }
    }
    // If groups are unassigned, any first hit (except scratch) is legal
  }

  // On break, the only foul is a cue ball scratch (already handled above).
  // We do NOT apply the first-hit foul on break.

  // --- (e) Determine turn ---
  var shooterPocketedOwn = false;
  if (lobby.assignment[shooterId]) {
    for (var pi = 0; pi < pocketed.length; pi++) {
      var pId = pocketed[pi];
      if (pId === 0 || pId === 8) continue;
      var bg = ballGroup(pId);
      if (bg === lobby.assignment[shooterId]) {
        shooterPocketedOwn = true;
        break;
      }
    }
  } else if (!isBreak) {
    // No assignment yet; any non-cue, non-8 pocketed ball counts (the assignment just happened above)
    // Re-check with the newly assigned group
    if (lobby.assignment[shooterId]) {
      for (var qi = 0; qi < pocketed.length; qi++) {
        var qId = pocketed[qi];
        if (qId === 0 || qId === 8) continue;
        if (ballGroup(qId) === lobby.assignment[shooterId]) {
          shooterPocketedOwn = true;
          break;
        }
      }
    }
  }

  // On break shot: if any ball was pocketed (and no foul), shooter keeps turn
  if (isBreak && !foul && pocketed.length > 0) {
    // Check if any non-cue ball was pocketed
    var nonCuePocketed = false;
    for (var bi = 0; bi < pocketed.length; bi++) {
      if (pocketed[bi] !== 0) { nonCuePocketed = true; break; }
    }
    if (nonCuePocketed) shooterPocketedOwn = true;
  }

  lobby.foulOnShot = foul;

  if (foul) {
    // Switch turn, ball in hand for opponent
    this._switchTurn(lobby);
    lobby.phase = 'ball_in_hand';
    if (!message) message = 'Foul!';
  } else if (shooterPocketedOwn) {
    // Shooter pocketed one of their own: keep turn
    lobby.phase = 'aiming';
    if (!message) message = 'Good shot! Shoot again.';
  } else {
    // No own ball pocketed, no foul: switch turn
    this._switchTurn(lobby);
    lobby.phase = 'aiming';
    if (!message) message = 'Turn over.';
  }

  // --- (f) Clear break flag ---
  if (isBreak) {
    lobby.breakShot = false;
  }

  lobby.turnMessage = message;

  // --- (g,h) Broadcast results ---
  this._broadcastShotResult(lobby, pocketed, foul, message);
  this._broadcastTurnChange(lobby);
};

// -----------------------------------------------------------------------
// Turn management helpers
// -----------------------------------------------------------------------

PoolManager.prototype._switchTurn = function _switchTurn(lobby) {
  lobby.turnIndex = lobby.turnIndex === 0 ? 1 : 0;
  lobby.turnPlayerId = lobby.playerOrder[lobby.turnIndex];
};

PoolManager.prototype._isGroupCleared = function _isGroupCleared(lobby, playerId) {
  var group = lobby.assignment[playerId];
  if (!group) return false;

  var balls = lobby.balls;
  for (var i = 0; i < balls.length; i++) {
    var b = balls[i];
    if (b.id === 0 || b.id === 8) continue;
    var bg = ballGroup(b.id);
    if (bg === group && !b.pocketed) return false;
  }
  return true;
};

// -----------------------------------------------------------------------
// Game end
// -----------------------------------------------------------------------

PoolManager.prototype._endGame = function _endGame(lobby, winnerId, loserId, reason) {
  lobby.state = 'finished';
  lobby.phase = 'game_over';
  lobby.result = {
    winner: winnerId,
    loser: loserId,
    reason: reason,
  };
  this._stopPhysicsLoop(lobby);
};

// -----------------------------------------------------------------------
// Broadcast helpers
// -----------------------------------------------------------------------

PoolManager.prototype._broadcastShotResult = function _broadcastShotResult(lobby, pocketed, foul, message) {
  if (!this._broadcastFn) return;
  this._broadcastFn(lobby.id, 'pool_shot_result', {
    pocketed: pocketed,
    foul: foul,
    message: message,
    assignment: lobby.assignment,
  });
};

PoolManager.prototype._broadcastTurnChange = function _broadcastTurnChange(lobby) {
  if (!this._broadcastFn) return;
  this._broadcastFn(lobby.id, 'pool_turn_change', {
    turnPlayerId: lobby.turnPlayerId,
    turnIndex: lobby.turnIndex,
    phase: lobby.phase,
    assignment: lobby.assignment,
  });
};

PoolManager.prototype._broadcastGameOver = function _broadcastGameOver(lobby) {
  if (!this._broadcastFn) return;
  this._broadcastFn(lobby.id, 'pool_game_over', {
    result: lobby.result,
  });
};

PoolManager.prototype._serializeBalls = function _serializeBalls(lobby) {
  var out = [];
  var balls = lobby.balls;
  for (var i = 0; i < balls.length; i++) {
    var b = balls[i];
    out.push({
      id: b.id,
      x: Math.round(b.x * 100) / 100,
      y: Math.round(b.y * 100) / 100,
      pocketed: b.pocketed,
    });
  }
  return out;
};

// -----------------------------------------------------------------------
// Chat
// -----------------------------------------------------------------------

PoolManager.prototype.addChat = function addChat(socketId, message) {
  // Check both players and spectators
  var lobbyId = this.playerLobby.get(socketId) || this.spectatorLobby.get(socketId);
  if (!lobbyId) return null;

  var lobby = this.lobbies.get(lobbyId);
  if (!lobby) return null;

  // Get the sender info from players or spectators
  var sender = lobby.players.get(socketId) || lobby.spectators.get(socketId);
  if (!sender) return null;

  var msg = {
    id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
    name: sender.name,
    color: sender.color,
    text: (typeof message === 'string' ? message : '').slice(0, 200),
    ts: Date.now(),
  };

  lobby.chat.push(msg);
  if (lobby.chat.length > MAX_CHAT) lobby.chat.shift();

  return { lobbyId: lobbyId, msg: msg };
};

// -----------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------

PoolManager.prototype.getLobbies = function getLobbies() {
  var out = [];
  for (var entry of this.lobbies) {
    var lobby = entry[1];
    var hostName = 'Unknown';
    // The first player in the map is the host
    var firstPlayer = lobby.players.values().next().value;
    if (firstPlayer) hostName = firstPlayer.name;

    out.push({
      id: lobby.id,
      playerCount: lobby.players.size,
      spectatorCount: lobby.spectators.size,
      queueCount: lobby.queue ? lobby.queue.length : 0,
      state: lobby.state,
      bet: lobby.bet,
      hostName: hostName,
    });
  }
  return out;
};

PoolManager.prototype.getLobbyState = function getLobbyState(lobbyId, forSocketId) {
  var lobby = this.lobbies.get(lobbyId);
  if (!lobby) return null;

  // Serialize players
  var players = [];
  for (var pEntry of lobby.players) {
    var pid = pEntry[0];
    var p = pEntry[1];
    players.push({
      id: pid,
      name: p.name,
      color: p.color,
      side: p.side,
      ready: p.ready,
      isBreaker: p.isBreaker,
      isMe: pid === forSocketId,
    });
  }

  // Serialize spectators
  var spectators = [];
  for (var sEntry of lobby.spectators) {
    var sid = sEntry[0];
    var s = sEntry[1];
    spectators.push({
      id: sid,
      name: s.name,
      color: s.color,
      isMe: sid === forSocketId,
    });
  }

  // Serialize balls
  var balls = [];
  for (var bi = 0; bi < lobby.balls.length; bi++) {
    var b = lobby.balls[bi];
    balls.push({
      id: b.id,
      x: Math.round(b.x * 100) / 100,
      y: Math.round(b.y * 100) / 100,
      pocketed: b.pocketed,
    });
  }

  // Compute pocketed balls per player (for HUD tray)
  var pocketedByPlayer = {};
  for (var pok of lobby.playerOrder) {
    pocketedByPlayer[pok] = [];
  }
  for (var ti = 0; ti < lobby.balls.length; ti++) {
    var tb = lobby.balls[ti];
    if (!tb.pocketed || tb.id === 0) continue;

    var tbGroup = ballGroup(tb.id);
    if (tbGroup === '8ball') continue;

    // Assign pocketed ball to the player whose group matches
    for (var pk = 0; pk < lobby.playerOrder.length; pk++) {
      var playId = lobby.playerOrder[pk];
      if (lobby.assignment[playId] === tbGroup) {
        pocketedByPlayer[playId].push(tb.id);
        break;
      }
    }
  }

  // Determine if forSocketId is a player or spectator
  var role = 'none';
  if (lobby.players.has(forSocketId)) role = 'player';
  else if (lobby.spectators.has(forSocketId)) role = 'spectator';

  return {
    id: lobby.id,
    state: lobby.state,
    bet: lobby.bet,
    balls: balls,
    players: players,
    spectators: spectators,
    turnIndex: lobby.turnIndex,
    turnPlayerId: lobby.turnPlayerId,
    playerOrder: lobby.playerOrder,
    phase: lobby.phase,
    assignment: lobby.assignment,
    breakShot: lobby.breakShot,
    turnMessage: lobby.turnMessage,
    result: lobby.result,
    role: role,
    queue: lobby.queue ? lobby.queue.map(function(q) { return { name: q.name, isMe: q.id === forSocketId }; }) : [],
    queuePosition: (function() { if (!lobby.queue) return -1; for (var qi = 0; qi < lobby.queue.length; qi++) { if (lobby.queue[qi].id === forSocketId) return qi; } return -1; })(),
    pocketedByPlayer: pocketedByPlayer,
    chat: lobby.chat,
  };
};

PoolManager.prototype.getPlayerLobbyId = function getPlayerLobbyId(socketId) {
  return this.playerLobby.get(socketId) || null;
};

PoolManager.prototype.getSpectatorLobbyId = function getSpectatorLobbyId(socketId) {
  return this.spectatorLobby.get(socketId) || null;
};

// -----------------------------------------------------------------------
// Reset -- clean shutdown of all lobbies and physics loops
// -----------------------------------------------------------------------

PoolManager.prototype.reset = function reset() {
  // Stop all physics loops
  for (var entry of this.lobbies) {
    var lobby = entry[1];
    this._stopPhysicsLoop(lobby);
  }

  // Stop the inactivity check timer
  this._stopInactivityCheck();

  this.lobbies.clear();
  this.playerLobby.clear();
  this.spectatorLobby.clear();
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
module.exports = {
  PoolManager: PoolManager,
  TABLE_W: TABLE_W,
  TABLE_H: TABLE_H,
  BALL_RADIUS: BALL_RADIUS,
  POCKET_RADIUS: POCKET_RADIUS,
  BALL_COLORS: BALL_COLORS,
  POCKETS: POCKETS,
  POOL_WIN_REWARD: POOL_WIN_REWARD,
  POOL_MIN_BET: POOL_MIN_BET,
  POOL_MAX_BET: POOL_MAX_BET,
};
