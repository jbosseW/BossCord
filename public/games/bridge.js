// BossCord Game Bridge v1.0
// Loaded by game iframes to communicate with parent BossCord app.
// All game engines (Phaser, Babylon.js, LOVE2D/love.js) load this script
// and use window.BossCordBridge to interact with the parent window.
(function() {
  'use strict';

  var ORIGIN = window.location.origin;
  var callbacks = {};

  // Listen for messages from parent BossCord window
  window.addEventListener('message', function(e) {
    if (e.origin !== ORIGIN) return;
    var msg = e.data;
    if (!msg || typeof msg !== 'object' || !msg.type) return;

    switch (msg.type) {
      case 'bosscord_init':
        // Parent sends account info and chips on game load
        window.BossCordBridge._accountKey = msg.accountKey || null;
        window.BossCordBridge._chips = typeof msg.chips === 'number' ? msg.chips : 0;
        window.BossCordBridge._username = msg.username || 'Anon';
        window.BossCordBridge._initialized = true;
        if (callbacks.onReady) {
          try { callbacks.onReady(msg); } catch (err) { console.error('[BossCordBridge] onReady error:', err); }
        }
        break;

      case 'bosscord_chips_updated':
        // Parent notifies that chip balance has changed (e.g. from server response)
        window.BossCordBridge._chips = typeof msg.chips === 'number' ? msg.chips : window.BossCordBridge._chips;
        if (callbacks.onChipsUpdated) {
          try { callbacks.onChipsUpdated(msg.chips); } catch (err) { console.error('[BossCordBridge] onChipsUpdated error:', err); }
        }
        break;

      case 'bosscord_response':
        // Response to a named request (e.g. load_state)
        if (msg.requestId && callbacks['req_' + msg.requestId]) {
          try { callbacks['req_' + msg.requestId](msg.data); } catch (err) { console.error('[BossCordBridge] response handler error:', err); }
          delete callbacks['req_' + msg.requestId];
        }
        break;
    }
  });

  window.BossCordBridge = {
    _accountKey: null,
    _chips: 0,
    _username: '',
    _requestId: 0,
    _initialized: false,

    // --- Callback registration ---

    // Called when parent sends bosscord_init (account info available)
    onReady: function(fn) {
      if (typeof fn !== 'function') return;
      callbacks.onReady = fn;
      // If already initialized (race condition), fire immediately
      if (this._initialized) {
        try { fn({ accountKey: this._accountKey, chips: this._chips, username: this._username }); } catch (err) { console.error('[BossCordBridge] onReady error:', err); }
      }
    },

    // Called when chip balance changes from parent
    onChipsUpdated: function(fn) {
      if (typeof fn !== 'function') return;
      callbacks.onChipsUpdated = fn;
    },

    // --- Getters ---

    getChips: function() { return this._chips; },
    getUsername: function() { return this._username; },
    getAccountKey: function() { return this._accountKey; },
    isInitialized: function() { return this._initialized; },

    // --- Actions (send requests to parent) ---

    // Request a chip balance change. Parent validates via server.
    // amount: positive to add, negative to subtract
    // reason: short string describing the cause (e.g. 'coin_collected', 'round_lost')
    requestChipsUpdate: function(amount, reason) {
      if (typeof amount !== 'number' || isNaN(amount)) return;
      try {
        parent.postMessage({
          type: 'bosscord_game_request',
          action: 'update_chips',
          amount: amount,
          reason: typeof reason === 'string' ? reason : 'game'
        }, ORIGIN);
      } catch (err) { console.error('[BossCordBridge] requestChipsUpdate error:', err); }
    },

    // Request to persist game state (keyed by gameId)
    saveGameState: function(gameId, state) {
      if (!gameId || typeof gameId !== 'string') return;
      try {
        parent.postMessage({
          type: 'bosscord_game_request',
          action: 'save_state',
          gameId: gameId,
          state: state
        }, ORIGIN);
      } catch (err) { console.error('[BossCordBridge] saveGameState error:', err); }
    },

    // Request to load persisted game state. Callback receives the state object or null.
    loadGameState: function(gameId, callback) {
      if (!gameId || typeof gameId !== 'string' || typeof callback !== 'function') return;
      var reqId = ++this._requestId;
      callbacks['req_' + reqId] = callback;
      try {
        parent.postMessage({
          type: 'bosscord_game_request',
          action: 'load_state',
          gameId: gameId,
          requestId: reqId
        }, ORIGIN);
      } catch (err) {
        console.error('[BossCordBridge] loadGameState error:', err);
        delete callbacks['req_' + reqId];
      }
    },

    // Notify parent that game has finished loading and is ready to play
    notifyLoaded: function() {
      try {
        parent.postMessage({ type: 'bosscord_game_loaded' }, ORIGIN);
      } catch (err) { console.error('[BossCordBridge] notifyLoaded error:', err); }
    },

    // Request parent to close the game modal
    requestClose: function() {
      try {
        parent.postMessage({ type: 'bosscord_game_close' }, ORIGIN);
      } catch (err) { console.error('[BossCordBridge] requestClose error:', err); }
    },

    // Report a score/achievement to parent (for leaderboards)
    reportScore: function(score, metadata) {
      if (typeof score !== 'number' || isNaN(score)) return;
      try {
        parent.postMessage({
          type: 'bosscord_game_request',
          action: 'report_score',
          score: score,
          metadata: (metadata && typeof metadata === 'object') ? metadata : {}
        }, ORIGIN);
      } catch (err) { console.error('[BossCordBridge] reportScore error:', err); }
    }
  };

  // Signal to parent that the bridge script has loaded and is listening
  try {
    parent.postMessage({ type: 'bosscord_bridge_ready' }, ORIGIN);
  } catch (err) { /* top-level window, not in iframe */ }
})();
