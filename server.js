// server.js — Main entry point for BossCord
// Optional accounts. No mandatory registration. Your key, your data.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load env vars from /etc/bosscord/app.env (secrets stay out of source code)
try {
  var _envFile = process.env.BOSSCORD_ENV_FILE || '/etc/bosscord/app.env';
  if (fs.existsSync(_envFile)) {
    var _envLines = fs.readFileSync(_envFile, 'utf8').split('\n');
    for (var _ei = 0; _ei < _envLines.length; _ei++) {
      var _line = _envLines[_ei].trim();
      if (!_line || _line[0] === '#') continue;
      var _eq = _line.indexOf('=');
      if (_eq > 0) {
        var _k = _line.slice(0, _eq).trim();
        var _v = _line.slice(_eq + 1).trim();
        if (!process.env[_k]) process.env[_k] = _v;
      }
    }
  }
} catch (_envErr) {
  console.error('[server] Warning: Could not load env file:', _envErr.message);
}

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { setupSocket, socketAccountMap, createDepsFactory, _stockMarket, _auctionHouse, sessionTokens } = require('./socket');
const nsGames = require('./handlers/namespace-games');
const nsMarket = require('./handlers/namespace-market');
const accounts = require('./accounts');
const state = require('./state');
const { Worker } = require('worker_threads');
const { LobbyManager } = require('./cardgames');
const { CoinFlipManager } = require('./coinflip');
let HorseRacingManager, ChessManager;
try { HorseRacingManager = require('./horseracing').HorseRacingManager; } catch(e) { console.warn('[server] horseracing module not found, horse racing disabled'); }
try { ChessManager = require('./chess').ChessManager; } catch(e) { console.warn('[server] chess module not found, chess disabled'); }
let PoolManager;
try { PoolManager = require('./pool').PoolManager; } catch(e) { console.warn('[server] pool module not found, pool disabled'); }
const cordsModule = require('./cords');
const loot = require('./loot');
const ratelimit = require('./ratelimit');
const pow = require('./pow');

const compression = require('compression');

const app = express();
app.disable('x-powered-by');
// Trust only the first proxy (nginx on localhost) for X-Forwarded-For / X-Real-IP
app.set('trust proxy', 'loopback');
const server = createServer(app);

app.use(compression());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // X-XSS-Protection removed — deprecated in modern browsers, CSP handles XSS prevention
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=self, microphone=self, display-capture=self, geolocation=(), payment=()');
  // Cross-origin isolation headers
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // HSTS handled by nginx — no duplicate header
  // CSP — no unsafe-eval (Babel removed), no unsafe-inline for scripts (all external)
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com https://cdn.socket.io https://cdn.jsdelivr.net https://cdn.babylonjs.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://i.imgur.com https://*.imgur.com https://media.tenor.com https://*.tenor.com https://media.giphy.com https://*.giphy.com https://*.googleusercontent.com",
    "media-src 'self' blob:",
    "connect-src 'self' wss://bosscord.com wss://www.bosscord.com https://tenor.googleapis.com",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; '));
  res.removeHeader('X-Powered-By');
  next();
});

// Request logging middleware — skip static assets, log slow/error responses
app.use((req, res, next) => {
  if (req.path.startsWith('/js/') || req.path.startsWith('/css/') || req.path.startsWith('/icons/') || req.path.startsWith('/styles')) {
    return next();
  }
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (res.statusCode >= 400 || ms > 2000) {
      console.log('[api] ' + req.method + ' ' + req.path + ' ' + res.statusCode + ' ' + ms + 'ms ip=' + (ratelimit.getIp(req) || '?'));
    }
  });
  next();
});

// Serve index.html with no-cache so the VERSION-busted module loader always loads fresh
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve static frontend from /public (JS/CSS cached for 1h, busted by ?v=VERSION)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true
}));


// Socket.IO — strict origin enforcement
const ALLOWED_ORIGINS = [
  'https://bosscord.com',
  'https://www.bosscord.com',
];
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000');
}
const io = new Server(server, {
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 500000,
  pingInterval: 25000,
  pingTimeout: 30000,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 1 },
    threshold: 1024,
    serverMaxWindowBits: 10,
  },
  cors: {
    origin: function(origin, cb) {
      // Reject requests with no Origin header (non-browser or cross-origin abuse)
      if (!origin) return cb(new Error('Origin required'), false);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
  // Additional handshake-level origin check + global connection limit
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      return cb('Origin not allowed', false);
    }
    if (ratelimit.getConnectionCount() >= ratelimit.MAX_GLOBAL_CONNECTIONS) {
      return cb('Server full', false);
    }
    cb(null, true);
  },
});

// ---------------------------------------------------------------------------
// Game Worker thread — BossOrbs + BossBrawl physics run off the main thread
// ---------------------------------------------------------------------------

let gameWorker = new Worker(path.join(__dirname, 'game-worker.js'));

// Proxy objects: same interface as GameManager / LieroManager for handlers,
// but forward calls to the Worker thread via postMessage.
const gameProxy = createGameProxy(gameWorker);
const lieroProxy = createLieroProxy(gameWorker);

const lobbyManager = new LobbyManager();
const coinFlipManager = new CoinFlipManager();
const horseRacingManager = HorseRacingManager ? new HorseRacingManager() : null;
const chessManager = ChessManager ? new ChessManager() : null;
const poolManager = PoolManager ? new PoolManager() : null;
setupSocket(io, gameProxy, lobbyManager, {}, coinFlipManager, lieroProxy, horseRacingManager);

// Set up /games and /market namespaces
const depsFactory = createDepsFactory(io, gameProxy, lobbyManager, coinFlipManager, lieroProxy, horseRacingManager, chessManager, poolManager);
const gamesNs = nsGames.setup(io, depsFactory, sessionTokens);
const marketNs = nsMarket.setup(io, depsFactory, sessionTokens);

// ---------------------------------------------------------------------------
// Game Proxy — stands in for GameManager on the main thread
// ---------------------------------------------------------------------------
function createGameProxy(worker) {
  const _callbacks = new Map();
  let _nextId = 0;
  // Lightweight cache of player -> instanceId for sync disconnect lookups
  const _playerInstances = new Map();

  function _send(msg, callback) {
    if (callback) {
      msg.reqId = _nextId++;
      _callbacks.set(msg.reqId, callback);
    }
    // Use _worker if set (supports hot-swap on respawn), else original worker
    try {
      (proxy._worker || worker).postMessage(msg);
    } catch (err) {
      console.error('[game-proxy] postMessage failed (worker may be terminated):', err.message);
      if (msg.reqId !== undefined) _callbacks.delete(msg.reqId);
    }
  }

  var proxy = {
    _callbacks: _callbacks,
    _playerInstances: _playerInstances,
    _worker: null, // set on respawn

    // ---- Marker so handlers know this is a GameManager-like object ----
    findBestInstance: function() { return 'main'; }, // not called directly; proxy uses joinBestInstance

    // Sync cache lookup for disconnect cleanup
    getPlayerInstance: function(socketId) {
      return _playerInstances.get(socketId) || null;
    },

    // Called by handlers to get instance list
    getInstanceList: function(callback) {
      _send({ type: 'orbs_get_instances' }, callback);
    },

    // Fire-and-forget: update input
    updateInput: function(socketId, x, y, boost) {
      try { (proxy._worker || worker).postMessage({ type: 'orbs_move', socketId: socketId, x: x, y: y, boost: boost }); } catch (_) {}
    },

    // Join best available instance (async, callback receives result)
    joinBestInstance: function(socketId, name, color, instanceId, callback) {
      _send({ type: 'orbs_join', socketId: socketId, name: name, color: color, instanceId: instanceId || null }, callback);
    },

    // Remove player (fire-and-forget, but updates cache)
    removePlayer: function(socketId) {
      _playerInstances.delete(socketId);
      try { (proxy._worker || worker).postMessage({ type: 'orbs_leave', socketId: socketId }); } catch (_) {}
    },

    // For disconnect handler: send cleanup to Worker, Worker posts back events
    disconnectCleanup: function(socketId) {
      _playerInstances.delete(socketId);
      try { (proxy._worker || worker).postMessage({ type: 'disconnect', socketId: socketId }); } catch (_) {}
    },

    // Handler for messages from worker
    handleMessage: function(msg) {
      if (msg.reqId !== undefined && _callbacks.has(msg.reqId)) {
        _callbacks.get(msg.reqId)(msg);
        _callbacks.delete(msg.reqId);
      }
      // Update cache on join/leave
      if (msg.type === 'orbs_joined' && msg.instanceId) {
        _playerInstances.set(msg.socketId, msg.instanceId);
      }
      if (msg.type === 'orbs_left') {
        _playerInstances.delete(msg.socketId);
      }
    },
  };
  return proxy;
}

// ---------------------------------------------------------------------------
// Liero Proxy — stands in for LieroManager on the main thread
// ---------------------------------------------------------------------------
function createLieroProxy(worker) {
  const _callbacks = new Map();
  let _nextId = 0;
  // Cache player -> lobbyId for sync disconnect lookups
  const _playerLobbies = new Map();

  function _send(msg, callback) {
    if (callback) {
      msg.reqId = _nextId++;
      _callbacks.set(msg.reqId, callback);
    }
    (proxy._worker || worker).postMessage(msg);
  }

  var proxy = {
    _callbacks: _callbacks,
    _playerLobbies: _playerLobbies,
    _worker: null, // set on respawn

    // Sync cache lookups for disconnect
    getPlayerLobbyId: function(socketId) {
      return _playerLobbies.get(socketId) || null;
    },

    // Async commands with callbacks
    getLobbies: function(callback) {
      _send({ type: 'liero_get_lobbies' }, callback);
    },

    getLobbyState: function(lobbyId, callback) {
      _send({ type: 'liero_get_lobby_state', lobbyId: lobbyId }, callback);
    },

    createLobby: function(socketId, name, color, settings, weapons, spell, callback) {
      _send({ type: 'liero_create', socketId: socketId, name: name, color: color, settings: settings, weapons: weapons, spell: spell }, callback);
    },

    joinLobby: function(socketId, lobbyId, name, color, weapons, spell, callback) {
      _send({ type: 'liero_join', socketId: socketId, lobbyId: lobbyId, name: name, color: color, weapons: weapons, spell: spell }, callback);
    },

    leaveLobby: function(socketId, callback) {
      _playerLobbies.delete(socketId);
      _send({ type: 'liero_leave', socketId: socketId }, callback);
    },

    startGame: function(lobbyId, socketId, callback) {
      _send({ type: 'liero_start', lobbyId: lobbyId, socketId: socketId }, callback);
    },

    handleInput: function(socketId, input) {
      (proxy._worker || worker).postMessage({ type: 'liero_input', socketId: socketId, input: input });
    },

    addBot: function(lobbyId, requesterId, callback) {
      _send({ type: 'liero_add_bot', lobbyId: lobbyId, requesterId: requesterId }, callback);
    },

    removeBot: function(lobbyId, botId, requesterId, callback) {
      _send({ type: 'liero_remove_bot', lobbyId: lobbyId, botId: botId, requesterId: requesterId }, callback);
    },

    // For disconnect handler
    disconnectCleanup: function(socketId) {
      _playerLobbies.delete(socketId);
      (proxy._worker || worker).postMessage({ type: 'disconnect', socketId: socketId });
    },

    // Handler for messages from worker
    handleMessage: function(msg) {
      if (msg.reqId !== undefined && _callbacks.has(msg.reqId)) {
        _callbacks.get(msg.reqId)(msg);
        _callbacks.delete(msg.reqId);
      }
      // Update cache on join/leave/create
      if (msg.type === 'liero_created' && msg.lobbyId) {
        _playerLobbies.set(msg.socketId, msg.lobbyId);
      }
      if (msg.type === 'liero_joined' && msg.success && msg.lobbyId) {
        _playerLobbies.set(msg.socketId, msg.lobbyId);
      }
      if (msg.type === 'liero_left') {
        _playerLobbies.delete(msg.socketId);
      }
    },
  };
  return proxy;
}

// ---------------------------------------------------------------------------
// Worker message handler — broadcasts game state via Socket.IO
// ---------------------------------------------------------------------------

// Extracted worker message handler for reuse on respawn
function _handleWorkerMessage(msg) {
    switch (msg.type) {

      // =====================================================================
      // BossOrbs tick broadcast
      // =====================================================================
      case 'orbs_tick': {
        var ticks = msg.ticks;
        for (var ti = 0; ti < ticks.length; ti++) {
          var t = ticks[ti];
          var roomName = 'game_' + t.instanceId;

          // Broadcast player positions — viewport culling for 20+ players
          if (t.playerCount > 20) {
            // Per-player viewport-culled state using main-thread culling
            for (var nsi = 0; nsi < 2; nsi++) {
              var ns = nsi === 0 ? io.sockets : gamesNs;
              var room = ns.adapter.rooms.get(roomName);
              if (!room) continue;
              for (var sid of room) {
                var s = ns.sockets ? ns.sockets.get(sid) : null;
                if (!s) continue;
                // Find this player's position in allPlayers
                var myPlayer = null;
                for (var pi = 0; pi < t.allPlayers.length; pi++) {
                  if (t.allPlayers[pi].id === sid) { myPlayer = t.allPlayers[pi]; break; }
                }
                if (!myPlayer) {
                  // Spectator or dead: send all
                  s.emit('game_players', { players: t.allPlayers, leaderboard: t.leaderboard });
                  continue;
                }
                // Viewport cull: 1600x1200 with 60% buffer
                var halfW = 1600 * 0.6;
                var halfH = 1200 * 0.6;
                var visible = [];
                for (var vi = 0; vi < t.allPlayers.length; vi++) {
                  var other = t.allPlayers[vi];
                  if (Math.abs(other.x - myPlayer.x) < halfW && Math.abs(other.y - myPlayer.y) < halfH) {
                    visible.push(other);
                  }
                }
                s.emit('game_players', { players: visible, leaderboard: t.leaderboard });
              }
            }
          } else {
            var playersState = { players: t.allPlayers, leaderboard: t.leaderboard };
            io.to(roomName).emit('game_players', playersState);
            gamesNs.to(roomName).emit('game_players', playersState);
          }

          // Broadcast eaten orbs
          for (var oi = 0; oi < t.eatenOrbs.length; oi++) {
            io.to(roomName).emit('game_orb_eaten', { orbId: t.eatenOrbs[oi] });
            gamesNs.to(roomName).emit('game_orb_eaten', { orbId: t.eatenOrbs[oi] });
          }
          // Broadcast spawned orbs
          for (var si2 = 0; si2 < t.spawnedOrbs.length; si2++) {
            io.to(roomName).emit('game_orb_spawned', { orb: t.spawnedOrbs[si2] });
            gamesNs.to(roomName).emit('game_orb_spawned', { orb: t.spawnedOrbs[si2] });
          }
          // Broadcast eaten players and award chips
          for (var ei = 0; ei < t.eatenPlayers.length; ei++) {
            var ep = t.eatenPlayers[ei];
            io.to(roomName).emit('game_player_eaten', ep);
            gamesNs.to(roomName).emit('game_player_eaten', ep);
            var killerAccKey = socketAccountMap.get(ep.by);
            if (killerAccKey) {
              var chipReward = 50;
              var newChips = accounts.updateChips(killerAccKey, chipReward);
              var killerSocket = io.sockets.sockets.get(ep.by) || gamesNs.sockets.get(ep.by);
              if (killerSocket && newChips !== null) {
                killerSocket.emit('chips_updated', { chips: newChips, reason: 'Ate ' + ep.eatenName + '! +' + chipReward });
              }
            }
          }
        }
        break;
      }

      // =====================================================================
      // BossBrawl tick broadcast
      // =====================================================================
      case 'liero_tick': {
        var broadcasts = msg.broadcasts;
        for (var bi = 0; bi < broadcasts.length; bi++) {
          var b = broadcasts[bi];
          var lRoomName = 'liero_' + b.lobbyId;

          io.to(lRoomName).emit('liero_tick', { players: b.players, projectiles: b.projectiles, pickups: b.pickups });
          gamesNs.to(lRoomName).emit('liero_tick', { players: b.players, projectiles: b.projectiles, pickups: b.pickups });

          if (b.terrainDeltas && b.terrainDeltas.length > 0) {
            io.to(lRoomName).emit('liero_terrain_delta', { changes: b.terrainDeltas });
            gamesNs.to(lRoomName).emit('liero_terrain_delta', { changes: b.terrainDeltas });
          }

          if (b.kills) {
            for (var ki = 0; ki < b.kills.length; ki++) {
              io.to(lRoomName).emit('liero_player_killed', b.kills[ki]);
              gamesNs.to(lRoomName).emit('liero_player_killed', b.kills[ki]);
            }
          }

          if (b.respawns) {
            for (var ri = 0; ri < b.respawns.length; ri++) {
              io.to(lRoomName).emit('liero_player_respawn', b.respawns[ri]);
              gamesNs.to(lRoomName).emit('liero_player_respawn', b.respawns[ri]);
            }
          }

          if (b.pickupSpawns) {
            for (var psi = 0; psi < b.pickupSpawns.length; psi++) {
              io.to(lRoomName).emit('liero_pickup_spawned', { pickup: b.pickupSpawns[psi] });
              gamesNs.to(lRoomName).emit('liero_pickup_spawned', { pickup: b.pickupSpawns[psi] });
            }
          }
          if (b.pickupCollections) {
            for (var pci = 0; pci < b.pickupCollections.length; pci++) {
              io.to(lRoomName).emit('liero_pickup_collected', b.pickupCollections[pci]);
              gamesNs.to(lRoomName).emit('liero_pickup_collected', b.pickupCollections[pci]);
            }
          }

          if (b.spellCasts) {
            for (var sci = 0; sci < b.spellCasts.length; sci++) {
              io.to(lRoomName).emit('liero_spell_cast', b.spellCasts[sci]);
              gamesNs.to(lRoomName).emit('liero_spell_cast', b.spellCasts[sci]);
            }
          }

          if (b.gameOver) {
            io.to(lRoomName).emit('liero_game_over', b.gameOver);
            gamesNs.to(lRoomName).emit('liero_game_over', b.gameOver);
            if (b.gameOver.chipRewards) {
              for (var pid of Object.keys(b.gameOver.chipRewards || {})) {
                var accKey = socketAccountMap.get(pid);
                if (accKey) {
                  var reward = b.gameOver.chipRewards[pid];
                  var newC = accounts.updateChips(accKey, reward);
                  var sock = io.sockets.sockets.get(pid) || gamesNs.sockets.get(pid);
                  if (sock && newC !== null) {
                    sock.emit('chips_updated', { chips: newC, reason: 'BossBrawl: +' + reward + ' chips' });
                  }
                }
              }
            }
            var lLobbies = msg.lobbies || [];
            io.emit('liero_lobbies_updated', { lobbies: lLobbies });
            gamesNs.emit('liero_lobbies_updated', { lobbies: lLobbies });
          }
        }
        break;
      }

      // =====================================================================
      // Disconnect cleanup broadcasts (from Worker)
      // =====================================================================
      case 'orbs_disconnect_cleanup': {
        var dRoomName = 'game_' + msg.instanceId;
        io.to(dRoomName).emit('game_player_left', { id: msg.socketId });
        gamesNs.to(dRoomName).emit('game_player_left', { id: msg.socketId });
        break;
      }

      case 'liero_disconnect_cleanup': {
        if (!msg.destroyed && msg.lobbyState) {
          io.to('liero_' + msg.lobbyId).emit('liero_lobby_update', { lobby: msg.lobbyState });
          gamesNs.to('liero_' + msg.lobbyId).emit('liero_lobby_update', { lobby: msg.lobbyState });
        }
        io.emit('liero_lobbies_updated', { lobbies: msg.lobbies });
        gamesNs.emit('liero_lobbies_updated', { lobbies: msg.lobbies });
        break;
      }

      // Worker ready notification
      case 'ready':
        console.log('[server] Game worker thread is ready');
        break;

      default:
        break;
    }
}

gameWorker.on('message', function(msg) {
  try {
    gameProxy.handleMessage(msg);
    lieroProxy.handleMessage(msg);
    _handleWorkerMessage(msg);
  } catch (err) {
    console.error('[server] Worker message handler error:', err.message);
  }
});

gameWorker.on('error', function(err) {
  console.error('[server] Game worker error:', err.message);
});

gameWorker.on('exit', function(code) {
  console.error('[server] Game worker exited with code', code, '-- respawning...');
  _respawnGameWorker();
});

// Respawn a crashed Worker without restarting the whole process
var _workerRespawnCount = 0;
function _respawnGameWorker() {
  _workerRespawnCount++;
  if (_workerRespawnCount > 10) {
    console.error('[server] Game worker respawn limit exceeded (10). Giving up.');
    return;
  }
  // Back-off: wait longer on repeated crashes (500ms, 1s, 2s, ...)
  var delay = Math.min(5000, 500 * _workerRespawnCount);
  setTimeout(function() {
    try {
      var newWorker = new Worker(path.join(__dirname, 'game-worker.js'));
      // Re-wire the proxies to use the new worker
      gameProxy._worker = newWorker;
      lieroProxy._worker = newWorker;
      // Clear stale callbacks (they'll never be resolved from the dead worker)
      gameProxy._callbacks.clear();
      lieroProxy._callbacks.clear();
      gameProxy._playerInstances.clear();
      lieroProxy._playerLobbies.clear();
      // Attach same event handlers to new worker
      newWorker.on('message', function(msg) {
        try {
          gameProxy.handleMessage(msg);
          lieroProxy.handleMessage(msg);
          _handleWorkerMessage(msg);
        } catch (err) {
          console.error('[server] Worker message handler error:', err.message);
        }
      });
      newWorker.on('error', function(err) {
        console.error('[server] Game worker error:', err.message);
      });
      newWorker.on('exit', function(c) {
        console.error('[server] Game worker exited with code', c, '-- respawning...');
        _respawnGameWorker();
      });
      gameWorker = newWorker;
      console.log('[server] Game worker respawned successfully (attempt #' + _workerRespawnCount + ')');
      // Reset respawn counter after 5 minutes of stable uptime
      setTimeout(function() {
        if (newWorker === gameWorker) {
          _workerRespawnCount = 0;
        }
      }, 5 * 60 * 1000);
    } catch (err) {
      console.error('[server] Failed to respawn game worker:', err.message);
    }
  }, delay);
}

// Redirect stock market tick/event broadcasts to /market namespace
// (Keeps backward compat: default ns still gets them too via setupSocket)
_stockMarket.onTick = function(marketState) {
  // Broadcast to /market namespace subscribers
  const marketRoom = marketNs.adapter.rooms.get('stock_market');
  if (marketRoom && marketRoom.size > 0) {
    marketNs.to('stock_market').emit('stock_market_tick', marketState);
  }
  // Also broadcast to default namespace subscribers (backward compat)
  const defaultRoom = io.sockets.adapter.rooms.get('stock_market');
  if (defaultRoom && defaultRoom.size > 0) {
    io.to('stock_market').emit('stock_market_tick', marketState);
  }
};
_stockMarket.onEvent = function(event) {
  const marketRoom = marketNs.adapter.rooms.get('stock_market');
  if (marketRoom && marketRoom.size > 0) {
    marketNs.to('stock_market').emit('stock_market_event', event);
  }
  const defaultRoom = io.sockets.adapter.rooms.get('stock_market');
  if (defaultRoom && defaultRoom.size > 0) {
    io.to('stock_market').emit('stock_market_event', event);
  }
};

// CORS for REST API
app.use('/api', function(req, res, next) {
  var origin = req.headers.origin;
  var allowed = ['https://bosscord.com', 'https://www.bosscord.com'];
  if (origin && allowed.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// REST endpoints — Chat
// ---------------------------------------------------------------------------
app.get('/api/room/:code', (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const room = state.getRoomByCode(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ name: room.name, code: room.code, memberCount: room.members.length });
});

app.get('/api/account/lookup/:key', (req, res) => {
  // Reject invalid keys immediately
  if (!req.params.key || req.params.key.length < 12 || !/^[a-zA-Z0-9]+$/.test(req.params.key)) {
    return res.status(400).json({ error: 'Invalid key format' });
  }
  const clientIp = ratelimit.getIp(req);
  // Strict rate limit: 3 lookups per minute per IP to prevent enumeration
  if (clientIp && !ratelimit.check(clientIp, 'account_lookup', 3, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  const profile = accounts.getPublicProfile(req.params.key);
  // Constant-time response: same delay and same status code regardless of result
  // Prevents timing-based and status-code-based key enumeration
  setTimeout(() => {
    if (!profile) return res.json({ username: null, color: null });
    res.json({ username: profile.username, color: profile.color });
  }, 50 + Math.random() * 50);
});

app.get('/api/rooms/public', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_rooms_public', 20, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  res.json({ rooms: state.getPublicRooms() });
});

app.get('/api/health', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_health', 10, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    rooms: state.rooms.size,
    users: state.users.size,
  });
});

// ---------------------------------------------------------------------------
// REST endpoints — Cords
// ---------------------------------------------------------------------------
app.get('/api/cords', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_cords', 30, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  const page = parseInt(req.query.page) || 0;
  res.json(cordsModule.getFeed(page, 20));
});

app.get('/api/cords/config', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_cords_config', 10, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  res.json({
    maxLength: cordsModule.CORD_MAX_LENGTH,
    maxPerDay: cordsModule.MAX_CORDS_PER_DAY,
    ttlHours: Math.floor(cordsModule.CORD_TTL_MS / (60 * 60 * 1000)),
  });
});

// ---------------------------------------------------------------------------
// REST endpoints — Tenor GIF proxy (key stays server-side)
// ---------------------------------------------------------------------------
const TENOR_KEY = process.env.TENOR_KEY || '';

app.get('/api/tenor/search', async (req, res) => {
  if (!TENOR_KEY) return res.status(503).json({ error: 'GIF search not configured' });
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_tenor_search', 10, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  const query = req.query.q;
  if (!query || typeof query !== 'string') return res.status(400).json({ error: 'Missing query' });
  try {
    const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query.trim())}&key=${TENOR_KEY}&client_key=bosscord&limit=20&media_filter=tinygif,gif`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return res.status(502).json({ error: 'Tenor returned ' + response.status });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Tenor search failed' });
  }
});

app.get('/api/tenor/featured', async (req, res) => {
  if (!TENOR_KEY) return res.status(503).json({ error: 'GIF search not configured' });
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_tenor_featured', 10, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  try {
    const url = `https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&client_key=bosscord&limit=20&media_filter=tinygif,gif`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return res.status(502).json({ error: 'Tenor returned ' + response.status });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Tenor featured failed' });
  }
});

// ---------------------------------------------------------------------------
// REST endpoints — Proof-of-Work challenge
// ---------------------------------------------------------------------------
app.get('/api/pow/challenge', (req, res) => {
  const type = req.query.type === 'account' ? 'account' : 'connect';
  // IP rate limit: max 30 challenge requests per hour per IP
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'pow_challenge', 60, 3600000, { skipViolation: true })) {
    return res.status(429).json({ error: 'Too many challenge requests. Try again later.' });
  }
  const challenge = pow.generateChallenge(type);
  res.json(challenge);
});

// ---------------------------------------------------------------------------
// REST endpoints — Admin (deploy tooling)
// ---------------------------------------------------------------------------

// Admin endpoint: trigger update warning for all connected clients (deploy use)
app.post('/api/admin/update-warning', (req, res) => {
  var adminSecret = process.env.ADMIN_DEPLOY_SECRET;
  if (!adminSecret) return res.status(503).json({ error: 'Not configured' });
  var auth = req.headers['authorization'] || '';
  var expected = 'Bearer ' + adminSecret;
  var authBuf = Buffer.from(auth, 'utf8');
  var expectedBuf = Buffer.from(expected, 'utf8');
  if (authBuf.length !== expectedBuf.length || !require('crypto').timingSafeEqual(authBuf, expectedBuf)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.body && req.body.clear) {
    io.emit('update_warning', { message: null, clear: true });
    console.log('[admin] Update warning cleared via API');
    return res.json({ success: true, action: 'cleared' });
  }
  var message = (req.body && typeof req.body.message === 'string')
    ? req.body.message.slice(0, 200)
    : 'Server update incoming. May be briefly unavailable.';
  var minutesLeft = (req.body && typeof req.body.minutesLeft === 'number')
    ? req.body.minutesLeft : null;
  io.emit('update_warning', { message: message, minutesLeft: minutesLeft });
  console.log('[admin] Update warning triggered via API: ' + message);
  res.json({ success: true, message: message });
});

// Block sensitive paths and common scanner probes
const BLOCKED_PATHS = [
  '/.env', '/.git/*', '/.htaccess', '/.htpasswd',
  '/wp-admin*', '/wp-login*', '/wp-content*', '/wp-includes*',
  // /.well-known/security.txt is now served as a static file
  '/server.js', '/package.json', '/package-lock.json', '/node_modules*',
  '/metrics', '/graphql', '/swagger', '/swagger-ui*', '/api-docs*',
  '/admin', '/admin/*', '/debug', '/debug/*',
  '/phpinfo*', '/phpmyadmin*', '/xmlrpc.php',
  '/actuator*', '/console', '/config*',
];
app.all(BLOCKED_PATHS, (req, res) => {
  console.log('[security] Blocked path probe: ' + req.path + ' ip=' + (ratelimit.getIp(req) || '?'));
  res.status(404).send('Not found');
});

// Catch-all for unmatched /api/* routes — return JSON 404, not SPA HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// SPA catch-all for valid page routes only
app.get('*', (req, res) => {
  // Only serve SPA for clean paths (no file extensions except .html)
  if (req.path.includes('.') && !req.path.endsWith('.html')) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Daily wipe — everything dies at midnight UTC
// ---------------------------------------------------------------------------
function scheduleNextWipe() {
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
  ));
  const msUntilMidnight = nextMidnight.getTime() - now.getTime();

  // 5-minute warning
  const ms5 = msUntilMidnight - 5 * 60 * 1000;
  if (ms5 > 0) {
    setTimeout(() => {
      io.emit('wipe_warning', { message: 'Server wipe in 5 minutes. All rooms and messages will be cleared.', minutesLeft: 5 });
    }, ms5);
  }

  // 1-minute warning
  const ms1 = msUntilMidnight - 60 * 1000;
  if (ms1 > 0) {
    setTimeout(() => {
      io.emit('wipe_warning', { message: 'Server wipe in 1 minute. Say your goodbyes.', minutesLeft: 1 });
    }, ms1);
  }

  // The wipe
  setTimeout(() => {
    // Archive reports before wipe
    try {
      var reportsFile = path.join(__dirname, 'reports', 'reports.jsonl');
      if (fs.existsSync(reportsFile)) {
        var content = fs.readFileSync(reportsFile, 'utf8').trim();
        if (content) {
          var dateStr = new Date().toISOString().split('T')[0];
          var archiveFile = path.join(__dirname, 'reports', 'reports-' + dateStr + '.jsonl');
          fs.writeFileSync(archiveFile, content + '\n', 'utf8');
          fs.writeFileSync(reportsFile, '', 'utf8');
          console.log('[wipe] Archived ' + content.split('\n').length + ' reports to ' + archiveFile);
        }
      }
    } catch (reportErr) {
      console.error('[wipe] Report archive error:', reportErr.message);
    }

    // Archive bug reports before wipe
    try {
      var bugsFile = path.join(__dirname, 'reports', 'bugs.jsonl');
      if (fs.existsSync(bugsFile)) {
        var bugContent = fs.readFileSync(bugsFile, 'utf8').trim();
        if (bugContent) {
          var bugDateStr = new Date().toISOString().split('T')[0];
          var bugArchiveFile = path.join(__dirname, 'reports', 'bugs-' + bugDateStr + '.jsonl');
          fs.writeFileSync(bugArchiveFile, bugContent + '\n', 'utf8');
          fs.writeFileSync(bugsFile, '', 'utf8');
          console.log('[wipe] Archived ' + bugContent.split('\n').length + ' bug reports to ' + bugArchiveFile);
        }
      }
    } catch (bugErr) {
      console.error('[wipe] Bug report archive error:', bugErr.message);
    }

    // Archive feature requests before wipe
    try {
      var featuresFile = path.join(__dirname, 'reports', 'features.jsonl');
      if (fs.existsSync(featuresFile)) {
        var featContent = fs.readFileSync(featuresFile, 'utf8').trim();
        if (featContent) {
          var featDateStr = new Date().toISOString().split('T')[0];
          var featArchiveFile = path.join(__dirname, 'reports', 'features-' + featDateStr + '.jsonl');
          fs.writeFileSync(featArchiveFile, featContent + '\n', 'utf8');
          fs.writeFileSync(featuresFile, '', 'utf8');
          console.log('[wipe] Archived ' + featContent.split('\n').length + ' feature requests to ' + featArchiveFile);
        }
      }
    } catch (featErr) {
      console.error('[wipe] Feature request archive error:', featErr.message);
    }

    for (const [, room] of state.rooms) {
      if (room.destroyTimer) clearTimeout(room.destroyTimer);
    }
    io.emit('server_wipe', { message: 'Daily wipe complete. All data erased.' });
    gamesNs.emit('server_wipe', { message: 'Daily wipe complete. All data erased.' });
    marketNs.emit('server_wipe', { message: 'Daily wipe complete. All data erased.' });
    state.users.clear();
    state.rooms.clear();
    io.disconnectSockets(true);
    gamesNs.disconnectSockets(true);
    marketNs.disconnectSockets(true);
    // Reset game state in Worker thread
    gameWorker.postMessage({ type: 'reset' });
    gameProxy._playerInstances.clear();
    lieroProxy._playerLobbies.clear();
    lobbyManager.reset();
    coinFlipManager.reset();
    if (horseRacingManager && horseRacingManager.reset) horseRacingManager.reset();
    if (chessManager && chessManager.reset) chessManager.reset();
    if (poolManager && poolManager.reset) poolManager.reset();
    if (_stockMarket && _stockMarket.reset) _stockMarket.reset();
    cordsModule.reset(); // Cords wipe, but accounts persist
    accounts.clearAllDMs(); // DMs wipe daily
    console.log('[wipe] Daily wipe executed.');

    // Re-create default public rooms after wipe
    state.initDefaultRooms();

    scheduleNextWipe();
  }, msUntilMidnight);

  const h = Math.floor(msUntilMidnight / 3600000);
  const m = Math.floor((msUntilMidnight % 3600000) / 60000);
  console.log(`[wipe] Next wipe in ${h}h ${m}m (midnight UTC)`);
}

// ---------------------------------------------------------------------------
// Graceful shutdown — flush pending account writes before exit
// ---------------------------------------------------------------------------
function gracefulShutdown(signal) {
  console.log('[server] ' + signal + ' received. Broadcasting update warning...');
  try {
    io.emit('update_warning', { message: 'Server restarting for an update. Back in a moment.', minutesLeft: 0 });
  } catch (e) { /* io may not be ready */ }
  setTimeout(function() {
    accounts.flushAll();
    try { loot.flushSerialCounter(); } catch (_) {}
    server.close(function() {
      console.log('[server] Shut down gracefully.');
      process.exit(0);
    });
    setTimeout(function() {
      console.log('[server] Forcing exit.');
      process.exit(0);
    }, 5000);
  }, 1000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled promise rejections — log and continue (don't crash)
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason instanceof Error ? reason.stack || reason.message : reason);
});

// Catch uncaught exceptions — log, flush accounts, then exit (state may be corrupt)
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err.stack || err.message);
  try { accounts.flushAll(); } catch (_) {}
  // Let PM2 restart us — exit after a short delay so logs flush
  setTimeout(() => process.exit(1), 500);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('');
  console.log('==============================================');
  console.log(`  BossCord running on port ${PORT}`);
  console.log('  No accounts. No databases. No traces.');
  console.log('  Daily wipe at midnight UTC.');
  console.log('==============================================');
  console.log('');

  // Create default public rooms on startup
  state.initDefaultRooms();

  scheduleNextWipe();
});
