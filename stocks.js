// stocks.js — Fantasy Stock Market for BossCord
// Fictional stocks with character icons, price fluctuation, events, player portfolios

const crypto = require('crypto');

// Cryptographic random helpers
function _crand() { return crypto.randomBytes(4).readUInt32BE(0) / 0x100000000; } // [0,1)
function _crandInt(max) { return crypto.randomInt(max); }

const TICK_INTERVAL_MS = 15000; // Price update every 15 seconds
const EVENT_INTERVAL_MS = 120000; // Random event every 2 minutes
const HISTORY_LENGTH = 100; // Keep last 100 price points per stock

// ─── Stock definitions ───
const STOCKS = [
  { id: 'ZEUS', name: 'Zeus Corp', sector: 'Divine', img: '/icons/characters/God_Zeus.PNG', basePrice: 500, volatility: 0.04 },
  { id: 'HADES', name: 'Hades Industries', sector: 'Divine', img: '/icons/characters/God_Hades.PNG', basePrice: 420, volatility: 0.05 },
  { id: 'ATHNA', name: 'Athena Strategies', sector: 'Divine', img: '/icons/characters/God_Athena.PNG', basePrice: 380, volatility: 0.03 },
  { id: 'POSDN', name: 'Poseidon Maritime', sector: 'Divine', img: '/icons/characters/God_Poseidon.PNG', basePrice: 350, volatility: 0.04 },
  { id: 'ARES', name: 'Ares Armaments', sector: 'Divine', img: '/icons/characters/God_Ares.PNG', basePrice: 300, volatility: 0.06 },
  { id: 'ARTMS', name: 'Artemis Wilds', sector: 'Divine', img: '/icons/characters/God_Artemis.PNG', basePrice: 280, volatility: 0.04 },
  { id: 'HRMZ', name: 'Hermes Express', sector: 'Divine', img: '/icons/characters/God_Hermes.PNG', basePrice: 250, volatility: 0.05 },
  { id: 'DRGN', name: 'Dragon Holdings', sector: 'Beast', img: '/icons/characters/Monsters/Creatures_11_Dragon.PNG', basePrice: 600, volatility: 0.07 },
  { id: 'PHNX', name: 'Phoenix Rising', sector: 'Beast', img: '/icons/characters/Monsters/Creatures_07_phoenix.PNG', basePrice: 450, volatility: 0.06 },
  { id: 'MNTR', name: 'Minotaur Mining', sector: 'Beast', img: '/icons/characters/Monsters/Gigant_08_minotaur.PNG', basePrice: 200, volatility: 0.05 },
  { id: 'GRFN', name: 'Griffin Airways', sector: 'Beast', img: '/icons/characters/Monsters/Creatures_03_griffin.PNG', basePrice: 320, volatility: 0.05 },
  { id: 'TITAN', name: 'Titan Forge', sector: 'Giant', img: '/icons/characters/Gigant_02_old_titan.PNG', basePrice: 400, volatility: 0.04 },
  { id: 'CYCL', name: 'Cyclops Optics', sector: 'Giant', img: '/icons/characters/Gigant_01_cyclope.PNG', basePrice: 180, volatility: 0.06 },
  { id: 'GOLEM', name: 'Golem Defense', sector: 'Giant', img: '/icons/characters/Giant_StoneGolem.PNG', basePrice: 220, volatility: 0.03 },
  { id: 'LICH', name: 'Lich Biotech', sector: 'Undead', img: '/icons/characters/Monsters/Undead/LICH.PNG', basePrice: 350, volatility: 0.08 },
  { id: 'VAMP', name: 'Vampire Nightlife', sector: 'Undead', img: '/icons/characters/Monsters/Vampires/Male Vampire/Monster_VoraciousVampire.PNG', basePrice: 270, volatility: 0.06 },
  { id: 'APHR', name: 'Aphrodite Beauty', sector: 'Divine', img: '/icons/characters/God_Aphrodite.PNG', basePrice: 310, volatility: 0.03 },
  { id: 'WOLF', name: 'Wolf Pack Logistics', sector: 'Beast', img: '/icons/characters/Animals/Wolf_animal.PNG', basePrice: 150, volatility: 0.05 },
  { id: 'YETI', name: 'Yeti Cryogenics', sector: 'Giant', img: '/icons/characters/Gigant_03_yeti.PNG', basePrice: 190, volatility: 0.07 },
  { id: 'SUCCB', name: 'Succubus Entertainment', sector: 'Demon', img: '/icons/characters/Monsters/Demon_04_succubus.PNG', basePrice: 260, volatility: 0.08 },
  // ─── Penny Stocks (high risk, low entry) ───
  { id: 'SLIME', name: 'Slime Ventures', sector: 'Penny', img: '/icons/characters/Monsters/Monster_Slime.PNG', basePrice: 8, volatility: 0.14 },
  { id: 'WORM', name: 'Worm Works', sector: 'Penny', img: '/icons/characters/Monsters/Monster_Worm.PNG', basePrice: 3, volatility: 0.20 },
  { id: 'BUGB', name: 'Bug Byte Inc', sector: 'Penny', img: '/icons/characters/Animals/Animal_Bug.PNG', basePrice: 5, volatility: 0.18 },
  { id: 'MUSH', name: 'Mushroom Markets', sector: 'Penny', img: '/icons/resourcesandfood/Res_126_mushroom.PNG', basePrice: 6, volatility: 0.15 },
  { id: 'DUST', name: 'Pixie Dust Co', sector: 'Penny', img: '/icons/loot/Loot_21_dust.PNG', basePrice: 4, volatility: 0.22 },
  { id: 'RUNE', name: 'Rune Traders', sector: 'Penny', img: '/icons/loot/Loot_31_rune.PNG', basePrice: 12, volatility: 0.12 },
  { id: 'POTN', name: 'Potion Labs', sector: 'Penny', img: '/icons/items/Potion_02.PNG', basePrice: 10, volatility: 0.13 },
  { id: 'CLAY', name: 'Dried Clay Ltd', sector: 'Penny', img: '/icons/professions/ProfessionAndCraftIcons/Mining/Mining_02_dried_clay.PNG', basePrice: 2, volatility: 0.25 },
  // ─── Crypto Coins (extremely volatile) ───
  { id: 'MCRYS', name: 'MagicCrystal Coin', sector: 'Crypto', img: '/icons/items/Mining_33_magic_crystal.PNG', basePrice: 100, volatility: 0.20 },
  { id: 'BLOOD', name: 'BloodStone Token', sector: 'Crypto', img: '/icons/items/Mining_34_red_crystal.PNG', basePrice: 50, volatility: 0.25 },
  { id: 'VOID', name: 'VoidShard', sector: 'Crypto', img: '/icons/items/Mining_36_purple_crystal.PNG', basePrice: 200, volatility: 0.22 },
  { id: 'FROST', name: 'FrostByte', sector: 'Crypto', img: '/icons/items/Mining_37_blue_crystal.PNG', basePrice: 75, volatility: 0.28 },
  { id: 'MOON', name: 'MoonStone', sector: 'Crypto', img: '/icons/items/Mining_50_great_white_crystal.PNG', basePrice: 300, volatility: 0.18 },
  { id: 'SPACE', name: 'SpaceOre', sector: 'Crypto', img: '/icons/items/Mining_58_space_ingot.PNG', basePrice: 150, volatility: 0.30 },
  { id: 'INFR', name: 'InfernoCoin', sector: 'Crypto', img: '/icons/items/Mining_59_fire_ingot.PNG', basePrice: 25, volatility: 0.35 },
  { id: 'GHOST', name: 'GhostChain', sector: 'Crypto', img: '/icons/items/Mining_60_ghost_ingot.PNG', basePrice: 10, volatility: 0.40 },
  { id: 'RUNE1', name: 'RuneCrypto', sector: 'Crypto', img: '/icons/items/Enchantment_56_runecrystal.PNG', basePrice: 500, volatility: 0.15 },
  { id: 'ETHER', name: 'EtherCrystal', sector: 'Crypto', img: '/icons/items/Enchantment_57_runecrystal.PNG', basePrice: 1000, volatility: 0.12 },
  { id: 'SHADOW', name: 'ShadowCoin', sector: 'Crypto', img: '/icons/items/Enchantment_58_runecrystal.PNG', basePrice: 80, volatility: 0.32 },
  { id: 'ARCN', name: 'ArcaneBit', sector: 'Crypto', img: '/icons/items/Enchantment_59_runecrystal.PNG', basePrice: 45, volatility: 0.35 },
];

// ─── Market Events ───
const EVENTS = [
  // ─── Individual stock — Positive ───
  { text: '{stock} announces record profits! Stock surges!', effect: 0.15, type: 'boom' },
  { text: '{stock} wins a massive government contract!', effect: 0.12, type: 'boom' },
  { text: '{stock} discovers a new resource vein!', effect: 0.10, type: 'boom' },
  { text: 'Analysts upgrade {stock} to Strong Buy!', effect: 0.08, type: 'boom' },
  { text: '{stock} CEO inspires confidence in keynote speech!', effect: 0.06, type: 'boom' },
  { text: '{stock} launches groundbreaking product! Investors thrilled!', effect: 0.13, type: 'boom' },
  { text: '{stock} patent approved — exclusive market advantage secured!', effect: 0.09, type: 'boom' },
  { text: 'Famous adventurer endorses {stock}! Hype builds!', effect: 0.07, type: 'boom' },
  { text: '{stock} merger talks spark optimism!', effect: 0.11, type: 'boom' },
  { text: '{stock} expands into foreign markets — revenue expected to double!', effect: 0.10, type: 'boom' },
  // ─── Individual stock — Negative ───
  { text: '{stock} hit by scandal! Stock plummets!', effect: -0.15, type: 'crash' },
  { text: '{stock} factory destroyed in mysterious fire!', effect: -0.12, type: 'crash' },
  { text: '{stock} loses key leadership — chaos ensues!', effect: -0.10, type: 'crash' },
  { text: 'Regulators investigate {stock} for fraud!', effect: -0.08, type: 'crash' },
  { text: '{stock} CEO caught in scandal! Board calls emergency meeting!', effect: -0.14, type: 'crash' },
  { text: 'Workers at {stock} go on strike! Production halted!', effect: -0.09, type: 'crash' },
  { text: '{stock} issues massive product recall! Costs mount!', effect: -0.11, type: 'crash' },
  { text: '{stock} supply chain disrupted by monsters! Deliveries delayed!', effect: -0.08, type: 'crash' },
  { text: '{stock} loses major lawsuit — damages awarded to plaintiff!', effect: -0.10, type: 'crash' },
  { text: 'Whistleblower exposes unsafe practices at {stock}!', effect: -0.07, type: 'crash' },
  // ─── Sector — Positive ───
  { text: '{sector} sector sees surge in demand!', effect: 0.08, type: 'sector_boom', sector: true },
  { text: 'New trade agreements boost the {sector} market!', effect: 0.06, type: 'sector_boom', sector: true },
  { text: 'Royal decree grants {sector} sector tax breaks! Profits soar!', effect: 0.09, type: 'sector_boom', sector: true },
  { text: 'Tourism boom drives demand for {sector} goods and services!', effect: 0.07, type: 'sector_boom', sector: true },
  { text: 'Guild alliance strengthens {sector} supply lines!', effect: 0.06, type: 'sector_boom', sector: true },
  // ─── Sector — Negative ───
  { text: '{sector} sector faces new regulations!', effect: -0.08, type: 'sector_crash', sector: true },
  { text: 'Consumer confidence in {sector} stocks drops!', effect: -0.06, type: 'sector_crash', sector: true },
  { text: 'Natural disaster impacts {sector} supply chains!', effect: -0.09, type: 'sector_crash', sector: true },
  { text: 'Tariffs imposed on {sector} imports! Margins squeezed!', effect: -0.07, type: 'sector_crash', sector: true },
  { text: 'Key {sector} trade route overrun by bandits! Costs skyrocket!', effect: -0.08, type: 'sector_crash', sector: true },
  // ─── Penny stock events ───
  { text: 'Penny stock frenzy! Speculators pile into {sector} stocks!', effect: 0.20, type: 'sector_boom', sector: true },
  { text: '{stock} goes viral on social media — massive buying spree!', effect: 0.25, type: 'boom' },
  { text: '{stock} rumored to be acquired by a mega-corp!', effect: 0.18, type: 'boom' },
  { text: '{stock} fails health inspection — investors flee!', effect: -0.25, type: 'crash' },
  { text: 'Penny stock bubble bursts! {sector} sector in freefall!', effect: -0.20, type: 'sector_crash', sector: true },
  // ─── Market-wide (fewer, milder) ───
  { text: 'Quarterly earnings season — mixed results across the market.', effect: 0.02, type: 'market_boom' },
  { text: 'Central bank lowers interest rates. Markets drift upward.', effect: 0.03, type: 'market_boom' },
  { text: 'Peace treaty signed! Markets celebrate!', effect: 0.05, type: 'market_boom' },
  { text: 'Market jitters: traders take profits across the board.', effect: -0.03, type: 'market_crash' },
  { text: 'Central bank raises interest rates. Mild selloff ensues.', effect: -0.03, type: 'market_crash' },
  // ─── Crypto Events (wild swings) ───
  { text: '{stock} listed on major exchange! Price moons!', effect: 0.30, type: 'boom' },
  { text: '{stock} whale dumps millions! Price crashes!', effect: -0.35, type: 'crash' },
  { text: 'Celebrity tweets about {stock}! FOMO kicks in!', effect: 0.25, type: 'boom' },
  { text: '{stock} smart contract hacked! Investors panic!', effect: -0.40, type: 'crash' },
  { text: '{stock} airdrop announced! Community goes wild!', effect: 0.20, type: 'boom' },
  { text: '{stock} rug pull suspected \u2014 mass selloff!', effect: -0.30, type: 'crash' },
  { text: 'Crypto winter hits {sector} sector! Prices tumble!', effect: -0.25, type: 'sector_crash', sector: true },
  { text: 'DeFi summer for {sector}! Yields skyrocket!', effect: 0.30, type: 'sector_boom', sector: true },
  { text: '{stock} partners with dragon traders guild! Massive adoption!', effect: 0.35, type: 'boom' },
  { text: 'Regulation FUD hits {sector} market! Bearish sentiment!', effect: -0.20, type: 'sector_crash', sector: true },
];

// ─── Rare Events (5% chance per event tick) ───
const RARE_EVENTS = [
  // FIRE SALES — massive crashes, buying opportunities
  { text: '\uD83D\uDD25 FIRE SALE! Market-wide panic — everything must go! Prices slashed!', effect: -0.35, type: 'market_crash', rare: 'firesale' },
  { text: '\uD83D\uDD25 FIRE SALE! {sector} sector collapses — blood in the streets!', effect: -0.40, type: 'sector_crash', sector: true, rare: 'firesale' },
  { text: '\uD83D\uDD25 FIRE SALE! {stock} implodes after CEO caught embezzling! Stock in freefall!', effect: -0.50, type: 'crash', rare: 'firesale' },
  // SWAN SONG — a stock's final legendary surge before correction
  { text: '\uD83E\uDEBD SWAN SONG! {stock} makes one last legendary run — investors pile in!', effect: 0.50, type: 'boom', rare: 'swansong' },
  { text: '\uD83E\uDEBD SWAN SONG! {sector} sector enters a golden age! Unprecedented gains!', effect: 0.35, type: 'sector_boom', sector: true, rare: 'swansong' },
  // MARKET CRASH — everything tanks
  { text: '\uD83D\uDCC9 MARKET CRASH! Black Monday — the entire market is in freefall!', effect: -0.30, type: 'market_crash', rare: 'crash' },
  { text: '\uD83D\uDCC9 MARKET CRASH! Ancient dragon destroys the central bank! Economic chaos!', effect: -0.25, type: 'market_crash', rare: 'crash' },
  { text: '\uD83D\uDCC9 MARKET CRASH! Plague sweeps the realm — trade routes collapse!', effect: -0.28, type: 'market_crash', rare: 'crash' },
  // MARKET RALLY — everything moons
  { text: '\uD83D\uDE80 MARKET RALLY! Golden age declared — all stocks soar!', effect: 0.30, type: 'market_boom', rare: 'rally' },
  { text: '\uD83D\uDE80 MARKET RALLY! Royal treasury opens the vaults — unlimited stimulus!', effect: 0.25, type: 'market_boom', rare: 'rally' },
  { text: '\uD83D\uDE80 MARKET RALLY! Discovery of new continent — trade boom across all sectors!', effect: 0.28, type: 'market_boom', rare: 'rally' },
  // DIAMOND HANDS — a random stock goes parabolic
  { text: '\uD83D\uDC8E DIAMOND HANDS! {stock} short squeeze — stock goes parabolic!', effect: 0.60, type: 'boom', rare: 'diamondhands' },
  // RUG PULL — a stock drops to near zero
  { text: '\u26A0\uFE0F RUG PULL! {stock} was a fraud all along \u2014 stock obliterated!', effect: -0.70, type: 'crash', rare: 'rugpull' },
  // ─── Crypto Rare Events ───
  { text: '\uD83D\uDE80 CRYPTO MOONSHOT! {stock} goes 10x after surprise partnership!', effect: 0.80, type: 'boom', rare: 'moonshot' },
  { text: '\uD83D\uDCA5 CRYPTO CRASH! Exchange collapses \u2014 {sector} sector in panic!', effect: -0.60, type: 'sector_crash', sector: true, rare: 'cryptocrash' },
  { text: '\uD83C\uDF19 TO THE MOON! Entire crypto market enters euphoria!', effect: 0.50, type: 'market_boom', rare: 'cryptomoon' },
  { text: '\u2744\uFE0F CRYPTO WINTER! Bear market declared \u2014 all crypto plummets!', effect: -0.45, type: 'market_crash', rare: 'cryptowinter' },
  { text: '\uD83D\uDC33 WHALE ALERT! Mystery buyer accumulates {stock} \u2014 price explodes!', effect: 0.65, type: 'boom', rare: 'whalealert' },
];

class StockMarket {
  constructor() {
    this.stocks = new Map(); // Map<stockId, stockState>
    this.portfolios = new Map(); // Map<accountKey, Map<stockId, { shares, avgCost }>>
    this.eventLog = [];
    this.tickTimer = null;
    this.eventTimer = null;
    this.onTick = null; // callback(marketState)
    this.onEvent = null; // callback(event)

    // Initialize stock prices
    for (const stock of STOCKS) {
      this.stocks.set(stock.id, {
        ...stock,
        price: stock.basePrice,
        prevPrice: stock.basePrice,
        change: 0,
        changePercent: 0,
        high: stock.basePrice,
        low: stock.basePrice,
        volume: 0,
        history: [stock.basePrice],
        trend: 0, // -1 to 1, slow-moving trend
      });
    }
  }

  start() {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this._tick(), TICK_INTERVAL_MS);
    this.eventTimer = setInterval(() => this._randomEvent(), EVENT_INTERVAL_MS);
  }

  stop() {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    if (this.eventTimer) { clearInterval(this.eventTimer); this.eventTimer = null; }
  }

  _tick() {
    for (const [id, stock] of this.stocks) {
      const prevPrice = stock.price;

      // Random walk with trend and mean reversion
      const randomComponent = (_crand() - 0.5) * 2 * stock.volatility;
      const meanReversion = (stock.basePrice - stock.price) / stock.basePrice * 0.02;
      const trendComponent = stock.trend * 0.01;

      const priceChange = stock.price * (randomComponent + meanReversion + trendComponent);
      stock.price = Math.max(stock.sector === 'Crypto' ? 0.01 : 1, Math.round((stock.price + priceChange) * 100) / 100);

      // Enhanced crypto volatility
      if (stock.sector === 'Crypto') {
        // Crypto has wilder random component (triple magnitude on top of base)
        const cryptoRandom = (_crand() - 0.5) * 2 * stock.volatility * 2;
        stock.price = Math.max(0.01, Math.round((stock.price * (1 + cryptoRandom)) * 100) / 100);

        // Flash crash/pump (2% chance per tick)
        if (_crand() < 0.02) {
          const flashMove = (_crand() - 0.4) * stock.volatility * 8; // slightly biased negative
          stock.price = Math.max(0.01, Math.round((stock.price * (1 + flashMove)) * 100) / 100);
        }
      }

      stock.prevPrice = prevPrice;
      stock.change = Math.round((stock.price - prevPrice) * 100) / 100;
      stock.changePercent = Math.round((stock.change / prevPrice) * 10000) / 100;
      stock.high = Math.max(stock.high, stock.price);
      stock.low = Math.min(stock.low, stock.price);

      // Decay trend slowly
      stock.trend *= 0.95;

      // Update history
      stock.history.push(stock.price);
      if (stock.history.length > HISTORY_LENGTH) stock.history.shift();

      // Reset daily volume periodically (simplified)
      stock.volume = Math.max(0, stock.volume - 1);
    }

    if (this.onTick) this.onTick(this.getMarketState());
  }

  _randomEvent() {
    // 5% chance of a rare event
    const isRare = _crand() < 0.05;
    const event = isRare
      ? RARE_EVENTS[_crandInt(RARE_EVENTS.length)]
      : EVENTS[_crandInt(EVENTS.length)];
    var text = event.text;
    var affectedStocks = [];
    var affectedNames = [];

    // Severity randomizer: multiply base effect by 0.7–1.3 for variance
    var severity = 0.7 + _crand() * 0.6;
    var scaledEffect = event.effect * severity;

    if (event.type === 'market_boom' || event.type === 'market_crash') {
      // Market-wide: only affect 40-70% of stocks randomly
      var allIds = [...this.stocks.keys()];
      var fraction = 0.4 + _crand() * 0.3; // 0.4 to 0.7
      var count = Math.max(1, Math.round(allIds.length * fraction));
      // Fisher-Yates shuffle then take subset
      for (var i = allIds.length - 1; i > 0; i--) {
        var j = _crandInt(i + 1);
        var tmp = allIds[i]; allIds[i] = allIds[j]; allIds[j] = tmp;
      }
      var chosen = allIds.slice(0, count);
      for (var k = 0; k < chosen.length; k++) {
        var stock = this.stocks.get(chosen[k]);
        stock.trend += scaledEffect * 5;
        stock.price = Math.max(1, Math.round(stock.price * (1 + scaledEffect) * 100) / 100);
        affectedStocks.push(stock.id);
        affectedNames.push(stock.name);
      }
    } else if (event.sector) {
      // Sector event: pick a random sector, affect 50-80% of stocks in it
      const sectors = [...new Set(STOCKS.map(s => s.sector))];
      const sector = sectors[_crandInt(sectors.length)];
      text = text.replace('{sector}', sector);
      // Also replace {stock} if present (some sector events might have it)
      if (text.indexOf('{stock}') !== -1) {
        var sectorStockArr = [];
        for (const [id, s] of this.stocks) {
          if (s.sector === sector) sectorStockArr.push(s);
        }
        if (sectorStockArr.length > 0) {
          var pick = sectorStockArr[_crandInt(sectorStockArr.length)];
          text = text.replace('{stock}', pick.name);
        }
      }
      // Gather all stocks in this sector then randomly pick a subset (50-80%)
      var sectorIds = [];
      for (const [id, s] of this.stocks) {
        if (s.sector === sector) sectorIds.push(id);
      }
      var sectorFraction = 0.5 + _crand() * 0.3; // 0.5 to 0.8
      var sectorCount = Math.max(1, Math.round(sectorIds.length * sectorFraction));
      // Shuffle
      for (var si = sectorIds.length - 1; si > 0; si--) {
        var sj = _crandInt(si + 1);
        var stmp = sectorIds[si]; sectorIds[si] = sectorIds[sj]; sectorIds[sj] = stmp;
      }
      var chosenSector = sectorIds.slice(0, sectorCount);
      for (var sk = 0; sk < chosenSector.length; sk++) {
        var sStock = this.stocks.get(chosenSector[sk]);
        sStock.trend += scaledEffect * 5;
        sStock.price = Math.max(1, Math.round(sStock.price * (1 + scaledEffect) * 100) / 100);
        affectedStocks.push(sStock.id);
        affectedNames.push(sStock.name);
      }
    } else {
      // Individual stock event
      const stockArr = [...this.stocks.values()];
      const targetStock = stockArr[_crandInt(stockArr.length)];
      text = text.replace('{stock}', targetStock.name);
      targetStock.trend += scaledEffect * 8;
      targetStock.price = Math.max(1, Math.round(targetStock.price * (1 + scaledEffect) * 100) / 100);
      affectedStocks.push(targetStock.id);
      affectedNames.push(targetStock.name);
    }

    const eventEntry = {
      id: Date.now().toString(36),
      text,
      type: event.type,
      effect: Math.round(scaledEffect * 1000) / 1000,
      rare: event.rare || null,
      affectedStocks,
      affectedNames,
      timestamp: Date.now(),
    };
    this.eventLog.unshift(eventEntry);
    if (this.eventLog.length > 20) this.eventLog.pop();

    if (this.onEvent) this.onEvent(eventEntry);
  }

  // ─── Trading ───

  buyStock(accountKey, stockId, shares, balance) {
    shares = Math.floor(shares);
    if (!isFinite(shares) || shares < 1 || shares > 10000) return { error: 'Invalid number of shares (1-10,000)' };
    const stock = this.stocks.get(stockId);
    if (!stock) return { error: 'Stock not found' };

    // Max holdings per stock per user: 100,000
    if (!this.portfolios.has(accountKey)) this.portfolios.set(accountKey, new Map());
    const portfolio = this.portfolios.get(accountKey);
    const existing = portfolio.get(stockId) || { shares: 0, avgCost: 0 };
    if (existing.shares + shares > 100000) return { error: 'Max 100,000 shares per stock. You hold ' + existing.shares };

    const totalCost = Math.ceil(stock.price * shares);

    // Balance check: reject if buyer can't afford it
    if (typeof balance === 'number' && totalCost > balance) {
      return { error: 'Insufficient chips (need ' + totalCost + ')' };
    }

    const newTotalShares = existing.shares + shares;
    const newAvgCost = Math.round(((existing.avgCost * existing.shares) + totalCost) / newTotalShares * 100) / 100;

    portfolio.set(stockId, { shares: newTotalShares, avgCost: newAvgCost });
    stock.volume += shares;

    // Buying pressure: diminishing impact for large trades (sqrt scaling)
    var impact = 0.001 * Math.sqrt(shares);
    stock.price = Math.round(stock.price * (1 + impact) * 100) / 100;

    return { success: true, stockId, shares, pricePerShare: stock.price, totalCost, newHolding: portfolio.get(stockId) };
  }

  sellStock(accountKey, stockId, shares) {
    shares = Math.floor(shares);
    if (!isFinite(shares)) return { error: 'Invalid number of shares' };
    if (shares < 1 || shares > 10000) return { error: 'Invalid number of shares (1-10000)' };
    const stock = this.stocks.get(stockId);
    if (!stock) return { error: 'Stock not found' };

    if (!this.portfolios.has(accountKey)) return { error: 'No portfolio' };
    const portfolio = this.portfolios.get(accountKey);
    const existing = portfolio.get(stockId);
    if (!existing || existing.shares < shares) return { error: 'Not enough shares' };

    const totalProceeds = Math.floor(stock.price * shares);
    const profit = Math.floor((stock.price - existing.avgCost) * shares);

    existing.shares -= shares;
    if (existing.shares <= 0) {
      portfolio.delete(stockId);
    }
    stock.volume += shares;

    // Selling pressure: diminishing impact for large trades (sqrt scaling)
    var impact = 0.001 * Math.sqrt(shares);
    stock.price = Math.max(1, Math.round(stock.price * (1 - impact) * 100) / 100);

    return { success: true, stockId, shares, pricePerShare: stock.price, totalProceeds, profit, newHolding: portfolio.get(stockId) || { shares: 0, avgCost: 0 } };
  }

  getPortfolio(accountKey) {
    const portfolio = this.portfolios.get(accountKey);
    if (!portfolio) return { holdings: [], totalValue: 0, totalCost: 0, totalProfit: 0 };

    const holdings = [];
    let totalValue = 0;
    let totalCost = 0;

    for (const [stockId, holding] of portfolio) {
      const stock = this.stocks.get(stockId);
      if (!stock || holding.shares <= 0) continue;
      const currentValue = Math.floor(stock.price * holding.shares);
      const costBasis = Math.floor(holding.avgCost * holding.shares);
      const profit = currentValue - costBasis;
      holdings.push({
        stockId,
        name: stock.name,
        sector: stock.sector,
        img: stock.img,
        shares: holding.shares,
        avgCost: holding.avgCost,
        currentPrice: stock.price,
        currentValue,
        costBasis,
        profit,
        profitPercent: Math.round((profit / costBasis) * 10000) / 100,
      });
      totalValue += currentValue;
      totalCost += costBasis;
    }

    holdings.sort((a, b) => b.currentValue - a.currentValue);

    return {
      holdings,
      totalValue,
      totalCost,
      totalProfit: totalValue - totalCost,
      totalProfitPercent: totalCost > 0 ? Math.round(((totalValue - totalCost) / totalCost) * 10000) / 100 : 0,
    };
  }

  getMarketState() {
    const stocks = [];
    for (const [id, stock] of this.stocks) {
      stocks.push({
        id: stock.id,
        name: stock.name,
        sector: stock.sector,
        img: stock.img,
        price: stock.price,
        basePrice: stock.basePrice,
        volatility: stock.volatility,
        change: stock.change,
        changePercent: stock.changePercent,
        high: stock.high,
        low: stock.low,
        volume: stock.volume,
        history: stock.history.slice(-50), // Last 50 points for charts
      });
    }
    return { stocks, events: this.eventLog.slice(0, 10) };
  }

  getStockInfo(stockId) {
    const stock = this.stocks.get(stockId);
    if (!stock) return null;
    return {
      id: stock.id,
      name: stock.name,
      sector: stock.sector,
      img: stock.img,
      price: stock.price,
      basePrice: stock.basePrice,
      volatility: stock.volatility,
      change: stock.change,
      changePercent: stock.changePercent,
      high: stock.high,
      low: stock.low,
      volume: stock.volume,
      history: stock.history,
    };
  }

  // Reset market state (called during daily wipe)
  reset() {
    this.portfolios.clear();
    this.eventLog = [];
    // Reset all stock prices back to base
    for (const [id, stock] of this.stocks) {
      stock.price = stock.basePrice;
      stock.prevPrice = stock.basePrice;
      stock.change = 0;
      stock.changePercent = 0;
      stock.high = stock.basePrice;
      stock.low = stock.basePrice;
      stock.volume = 0;
      stock.history = [stock.basePrice];
      stock.trend = 0;
    }
  }

  // Get leaderboard by portfolio value
  getLeaderboard(limit) {
    limit = limit || 20;
    const entries = [];
    for (const [accountKey, portfolio] of this.portfolios) {
      let totalValue = 0;
      for (const [stockId, holding] of portfolio) {
        const stock = this.stocks.get(stockId);
        if (stock && holding.shares > 0) {
          totalValue += Math.floor(stock.price * holding.shares);
        }
      }
      if (totalValue > 0) {
        entries.push({ accountKey, totalValue });
      }
    }
    entries.sort((a, b) => b.totalValue - a.totalValue);
    return entries.slice(0, limit);
  }
}

module.exports = { StockMarket, STOCKS, EVENTS, TICK_INTERVAL_MS };
