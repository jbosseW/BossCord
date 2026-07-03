// script-loader.js
// Lazy script loader for BossCord game modules.
// Dynamically loads game JS files on demand instead of upfront.
// Tracks loaded scripts, shows loading state, handles errors, caches results.

var BossScriptLoader = (function() {
  // Track which script URLs have been loaded successfully
  var _loaded = {};
  // Track in-flight loads so we don't double-load the same script
  var _pending = {};

  // Version string appended to script URLs for cache busting
  var _version = '2.6.0';

  // Game ID -> script file(s) mapping
  // Each game ID maps to an array of script paths (relative to /js/)
  // and the global function name that must exist after loading.
  var _manifest = {
    bossorbs:       { scripts: ['games-orbs.js'],        check: 'BossOrbsGame' },
    cards:          { scripts: ['games-cards.js'],       check: 'CardGamesView' },
    slots:          { scripts: ['games-casino.js'],      check: 'SlotMachineView' },
    coinflip:       { scripts: ['games-casino.js'],      check: 'CoinFlipView' },
    plinko:         { scripts: ['games-casino.js'],      check: 'PlinkoView' },
    scratch:        { scripts: ['games-casino.js'],      check: 'ScratchCardView' },
    lootbox:        { scripts: ['games-casino.js'],      check: 'LootboxView' },
    tcg_packs:      { scripts: ['games-tcg.js'],         check: 'TCGPackView' },
    tcg_collection: { scripts: ['games-tcg.js'],         check: 'TCGCollectionView' },
    tcg_battle:     { scripts: ['games-tcg.js'],         check: 'TCGBattleView' },
    stocks:         { scripts: ['games-economy.js'],     check: 'StockMarketView' },
    auction:        { scripts: ['games-economy.js'],     check: 'AuctionHouseView' },
    clicker:        { scripts: ['games-economy.js'],     check: 'ClickerIdleView' },
    bossbrawl:      { scripts: ['games-liero.js'],       check: 'BossBrawlGame' },
    horseracing:    { scripts: ['games-horseracing.js'], check: 'HorseRacingView' },
    chess:          { scripts: ['games-chess.js'],        check: 'ChessGameView' },
    pool:           { scripts: ['games-pool.js'],         check: 'PoolGameView' }
  };

  // Map game ID -> the component function name on window
  var _componentMap = {
    bossorbs:       'BossOrbsGame',
    cards:          'CardGamesView',
    slots:          'SlotMachineView',
    coinflip:       'CoinFlipView',
    plinko:         'PlinkoView',
    scratch:        'ScratchCardView',
    lootbox:        'LootboxView',
    tcg_packs:      'TCGPackView',
    tcg_collection: 'TCGCollectionView',
    tcg_battle:     'TCGBattleView',
    stocks:         'StockMarketView',
    auction:        'AuctionHouseView',
    clicker:        'ClickerIdleView',
    bossbrawl:      'BossBrawlGame',
    horseracing:    'HorseRacingView',
    chess:          'ChessGameView',
    pool:           'PoolGameView'
  };

  /**
   * Load a single script by URL. Returns a Promise.
   * If already loaded, resolves immediately.
   * If currently loading, returns the existing promise.
   */
  function loadScript(url) {
    if (_loaded[url]) {
      return Promise.resolve();
    }
    if (_pending[url]) {
      return _pending[url];
    }
    var promise = new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.onload = function() {
        _loaded[url] = true;
        delete _pending[url];
        resolve();
      };
      script.onerror = function() {
        delete _pending[url];
        reject(new Error('Failed to load script: ' + url));
      };
      document.head.appendChild(script);
    });
    _pending[url] = promise;
    return promise;
  }

  /**
   * Load all scripts required for a given game ID.
   * Returns a Promise that resolves when all scripts are loaded.
   * Rejects with an error message if the game ID is unknown or a script fails.
   */
  function loadGame(gameId) {
    var entry = _manifest[gameId];
    if (!entry) {
      return Promise.reject(new Error('Unknown game: ' + gameId));
    }

    // If the component function already exists on window, scripts are loaded
    if (typeof window[entry.check] === 'function') {
      // Mark scripts as loaded in our tracking
      for (var i = 0; i < entry.scripts.length; i++) {
        var url = '/js/' + entry.scripts[i] + '?v=' + _version;
        _loaded[url] = true;
      }
      return Promise.resolve();
    }

    var promises = [];
    for (var i = 0; i < entry.scripts.length; i++) {
      var url = '/js/' + entry.scripts[i] + '?v=' + _version;
      promises.push(loadScript(url));
    }

    return Promise.all(promises).then(function() {
      // Verify the expected global function now exists
      if (typeof window[entry.check] !== 'function') {
        throw new Error('Script loaded but ' + entry.check + ' not found. The game file may be corrupted.');
      }
    });
  }

  /**
   * Check if a game's scripts are already loaded.
   */
  function isGameLoaded(gameId) {
    var entry = _manifest[gameId];
    if (!entry) return false;
    return typeof window[entry.check] === 'function';
  }

  /**
   * Get the React component function for a game ID.
   * Returns null if the game is not loaded yet.
   */
  function getComponent(gameId) {
    var name = _componentMap[gameId];
    if (!name) return null;
    var fn = window[name];
    return typeof fn === 'function' ? fn : null;
  }

  /**
   * Preload game scripts without mounting the component.
   * Useful for prefetching on hover.
   */
  function preload(gameId) {
    loadGame(gameId).catch(function() {
      // Silently ignore preload failures
    });
  }

  return {
    loadScript: loadScript,
    loadGame: loadGame,
    isGameLoaded: isGameLoaded,
    getComponent: getComponent,
    preload: preload,
    _manifest: _manifest,
    _componentMap: _componentMap
  };
})();
