// handlers/game-bridge.js
// Socket handlers for external iframe game bridge communication.
// Handles: game_bridge_bet, game_bridge_result, game_bridge_save, game_bridge_load
//
// SECURITY: Chips are server-authoritative.
// - Clients can only DEDUCT chips via game_bridge_bet (placing a bet).
// - Wins determined SERVER-SIDE: client reports game completion, server decides win/loss.
// - Each bet creates a pending wager; result resolves with server-determined outcome.

const crypto = require('crypto');

// Track pending bets per socket: Map<socketId, Map<gameId, { amount, timestamp, accountKey }>>
const pendingBets = new Map();

// Periodic cleanup of expired/orphaned pending bets (every 5 minutes)
setInterval(function() {
  var now = Date.now();
  for (var [socketId, bets] of pendingBets) {
    for (var [gameId, bet] of bets) {
      if (now - bet.timestamp > 10 * 60 * 1000) { // 10 min expiry for cleanup
        bets.delete(gameId);
      }
    }
    if (bets.size === 0) pendingBets.delete(socketId);
  }
}, 5 * 60 * 1000);

// Max bet per event, max multiplier for wins, bet expiry
var MAX_BET = 500;
var MAX_WIN_MULTIPLIER = 5; // reduced from 10
var BET_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
// Server-determined win chance: ~40% base win rate, max 3x payout on average
var BASE_WIN_CHANCE = 0.40;

module.exports = {
  init(io, socket, deps) {
    var { socketAccountMap, accounts, loot, checkEventRate, ratelimit } = deps;

    // Clean up pending bets on disconnect
    socket.on('disconnect', function() {
      pendingBets.delete(socket.id);
    });

    // ------------------------------------------------------------------
    // game_bridge_bet: Deduct chips as a wager (client-initiated)
    // Creates a pending bet that must be resolved by game_bridge_result.
    // ------------------------------------------------------------------
    socket.on('game_bridge_bet', (data) => {
      try {
        if (!data || typeof data !== 'object') return;
        if (typeof data.amount !== 'number' || isNaN(data.amount)) return;

        var gameId = (typeof data.gameId === 'string' && data.gameId.length > 0 && data.gameId.length <= 30)
          ? data.gameId
          : null;
        if (!gameId) return;

        var key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('error', { message: 'Need an account to play games' });
          return;
        }

        // Rate limit: max 30 bets per minute
        if (!checkEventRate(socket, 'game_bridge_bet', 30, 60000)) {
          socket.emit('error', { message: 'Too many bets. Slow down.' });
          return;
        }

        var amount = Math.floor(Math.abs(data.amount));
        if (amount <= 0 || amount > MAX_BET) {
          socket.emit('error', { message: 'Invalid bet amount (1-' + MAX_BET + ')' });
          return;
        }

        // Verify account has enough chips
        var acc = accounts.loadAccount(key);
        if (!acc || acc.chips < amount) {
          socket.emit('error', { message: 'Not enough chips' });
          return;
        }

        // Deduct chips (the bet)
        var newChips = accounts.updateChips(key, -amount);
        if (newChips === null) return;

        // Store pending bet with account key for validation on resolve
        if (!pendingBets.has(socket.id)) pendingBets.set(socket.id, new Map());
        var socketBets = pendingBets.get(socket.id);

        // Only one pending bet per game at a time
        socketBets.set(gameId, { amount: amount, timestamp: Date.now(), accountKey: key });

        socket.emit('chips_updated', {
          chips: newChips,
          reason: 'Game [' + gameId + ']: bet -' + amount
        });
        socket.emit('game_bridge_bet_ack', { chips: newChips, gameId: gameId, bet: amount });

      } catch (err) {
        console.error('[game_bridge_bet] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // game_bridge_result: Resolve a pending bet (win/lose)
    // Client sends { gameId, won: true/false, multiplier: number }
    // Server validates against the pending bet and caps the multiplier.
    // ------------------------------------------------------------------
    socket.on('game_bridge_result', (data) => {
      try {
        if (!data || typeof data !== 'object') return;

        var gameId = (typeof data.gameId === 'string' && data.gameId.length > 0 && data.gameId.length <= 30)
          ? data.gameId
          : null;
        if (!gameId) return;

        var key = socketAccountMap.get(socket.id);
        if (!key) return;

        // Rate limit: max 30 results per minute
        if (!checkEventRate(socket, 'game_bridge_result', 30, 60000)) return;

        // Look up pending bet
        var socketBets = pendingBets.get(socket.id);
        if (!socketBets || !socketBets.has(gameId)) {
          socket.emit('error', { message: 'No pending bet for this game' });
          return;
        }

        var bet = socketBets.get(gameId);
        socketBets.delete(gameId);

        // Verify the account key matches the one that placed the bet
        if (bet.accountKey !== key) {
          ratelimit.logSecurity('bet_account_mismatch', { socketId: socket.id, gameId: gameId });
          return;
        }

        // Check bet hasn't expired
        if (Date.now() - bet.timestamp > BET_EXPIRY_MS) {
          // Expired bet — chips already deducted, treat as loss
          ratelimit.logSecurity('bet_expired', { socketId: socket.id, gameId: gameId, amount: bet.amount });
          return;
        }

        // Server determines outcome — client win/loss reports are IGNORED
        // Use cryptographic randomness to decide win/loss
        var roll = crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; // [0,1)
        var won = roll < BASE_WIN_CHANCE;
        if (!won) {
          // Loss — chips already deducted, nothing to do
          socket.emit('game_bridge_result_ack', { gameId: gameId, won: false, payout: 0 });
          return;
        }

        // Win — server picks multiplier (1x to MAX_WIN_MULTIPLIER, weighted toward lower)
        var multRoll = crypto.randomBytes(4).readUInt32BE(0) / 0x100000000;
        var multiplier = Math.max(1, Math.floor(1 + multRoll * multRoll * MAX_WIN_MULTIPLIER)); // quadratic = lower multipliers more common
        var payout = Math.floor(bet.amount * multiplier);

        // Cap total payout
        payout = Math.min(payout, bet.amount * MAX_WIN_MULTIPLIER);

        var newChips = accounts.updateChips(key, payout);
        if (newChips === null) return;

        socket.emit('chips_updated', {
          chips: newChips,
          reason: 'Game [' + gameId + ']: won +' + payout
        });
        socket.emit('game_bridge_result_ack', { gameId: gameId, won: true, payout: payout, chips: newChips });

        // Key drop on bridge game win
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

      } catch (err) {
        console.error('[game_bridge_result] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // game_bridge_score: Record high scores from iframe games
    // ------------------------------------------------------------------
    socket.on('game_bridge_score', (data) => {
      try {
        if (!data || typeof data !== 'object') return;
        if (typeof data.score !== 'number' || isNaN(data.score)) return;

        const key = socketAccountMap.get(socket.id);
        if (!key) return;

        if (!checkEventRate(socket, 'game_bridge_score', 10, 60000)) return;

        var gameId = (typeof data.gameId === 'string' && data.gameId.length <= 30)
          ? data.gameId
          : 'unknown';
        var score = Math.floor(Math.max(0, data.score));

        console.log('[game_bridge_score] game=' + gameId + ' score=' + score);
        socket.emit('game_bridge_score_ack', { gameId: gameId, score: score });

      } catch (err) {
        console.error('[game_bridge_score] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // game_bridge_save: Save game state for a specific game ID
    // ------------------------------------------------------------------
    socket.on('game_bridge_save', (data) => {
      try {
        if (!data || typeof data !== 'object') return;
        if (typeof data.gameId !== 'string' || !data.gameId || data.gameId.length > 30 || !/^[a-zA-Z0-9_-]+$/.test(data.gameId)) return;

        const key = socketAccountMap.get(socket.id);
        if (!key) return;

        if (!checkEventRate(socket, 'game_bridge_save', 5, 60000)) return;

        var stateStr;
        try {
          stateStr = JSON.stringify(data.state);
        } catch (e) {
          return;
        }
        if (!stateStr || stateStr.length > 10240) {
          socket.emit('error', { message: 'Game state too large (max 10KB)' });
          return;
        }

        var acc = accounts.loadAccount(key);
        if (!acc) return;
        if (!acc.gameStates) acc.gameStates = {};
        if (!(data.gameId in acc.gameStates) && Object.keys(acc.gameStates).length >= 20) {
          socket.emit('error', { message: 'Too many saved game states (max 20). Delete some first.' });
          return;
        }
        acc.gameStates[data.gameId] = {
          state: data.state,
          savedAt: Date.now()
        };
        accounts.saveAccount(acc);

      } catch (err) {
        console.error('[game_bridge_save] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // game_bridge_load: Load saved game state for a specific game ID
    // ------------------------------------------------------------------
    socket.on('game_bridge_load', (data) => {
      try {
        if (!data || typeof data !== 'object') return;
        if (typeof data.gameId !== 'string' || !data.gameId || data.gameId.length > 30 || !/^[a-zA-Z0-9_-]+$/.test(data.gameId)) return;

        const key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('game_bridge_loaded', { state: null });
          return;
        }

        if (!checkEventRate(socket, 'game_bridge_load', 10, 60000)) {
          socket.emit('game_bridge_loaded', { state: null });
          return;
        }

        var acc = accounts.loadAccount(key);
        if (!acc || !acc.gameStates || !acc.gameStates[data.gameId]) {
          socket.emit('game_bridge_loaded', { state: null });
          return;
        }

        socket.emit('game_bridge_loaded', {
          gameId: data.gameId,
          state: acc.gameStates[data.gameId].state,
          savedAt: acc.gameStates[data.gameId].savedAt
        });

      } catch (err) {
        console.error('[game_bridge_load] Error:', err.message);
        socket.emit('game_bridge_loaded', { state: null });
      }
    });
  }
};
