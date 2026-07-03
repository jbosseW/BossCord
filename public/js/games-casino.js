
// ---------- Plinko View ----------
function PlinkoView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectGames(); }, []);
  var sock = ctx.gamesSocket || ctx.socket;
  var [bet, setBet] = useState(10);
  var [dropping, setDropping] = useState(false);
  var [result, setResult] = useState(null);
  var [config, setConfig] = useState({ rows: 12, multipliers: [10,5,3,1.5,1,0.5,0.3,0.5,1,1.5,3,5,10], minBet: 10, maxBet: 500 });
  var [ballPath, setBallPath] = useState(null);
  var [ballStep, setBallStep] = useState(-1);
  var canvasRef = useRef(null);
  var [autoPlay, setAutoPlay] = useState(false);
  var [autoPlayCount, setAutoPlayCount] = useState(0);
  var autoPlayRef = useRef(null);
  var [autoStats, setAutoStats] = useState({ wins: 0, losses: 0, profit: 0 });
  var pegFlashesRef = useRef({}); // tracks { "row-col": fadeAlpha } for peg flash effect
  var pegHitCountRef = useRef(0); // counts peg hits to throttle sound (every 3rd)
  var ballTrailRef = useRef([]); // stores recent ball positions for trail effect

  useEffect(function() {
    if (!sock) return;
    sock.emit('plinko_config');
    function onConfig(data) { setConfig(data); }
    function onResult(data) {
      setResult(data);
      setBallPath(data.path);
      setBallStep(0);
      pegHitCountRef.current = 0;
      ballTrailRef.current = [];
      pegFlashesRef.current = {};
    }
    sock.on('plinko_config', onConfig);
    sock.on('plinko_result', onResult);
    return function() {
      sock.off('plinko_config', onConfig);
      sock.off('plinko_result', onResult);
    };
  }, [sock]);

  // Animate ball dropping
  useEffect(function() {
    if (ballPath === null || ballStep < 0) return;
    if (ballStep >= ballPath.length) {
      // Ball landed -- play landing sound and canvas shake for high multipliers
      setTimeout(function() {
        setDropping(false);
        if (result) {
          var mult = result.multiplier || 0;
          if (mult >= 3) {
            if (window.BossSounds) window.BossSounds.play('win_big');
            if (window.BossEffects) window.BossEffects.startCanvasShake('plinko', 3, 150);
          } else {
            if (window.BossSounds) window.BossSounds.play('win_small');
          }
        }
      }, 500);
      return;
    }
    // Each step represents the ball passing a peg row -- record hit and play peg sound
    if (ballStep > 0) {
      pegHitCountRef.current++;
      // Flash the peg the ball just passed
      var flashKey = (ballStep - 1) + '-' + ballPath[ballStep - 1];
      pegFlashesRef.current[flashKey] = 1.0;
      // Play peg plink sound every 3rd hit to avoid spam
      if (pegHitCountRef.current % 3 === 0) {
        if (window.BossSounds) window.BossSounds.play('peg_plink');
      }
    }
    var timer = setTimeout(function() {
      setBallStep(function(s) { return s + 1; });
    }, 120);
    return function() { clearTimeout(timer); };
  }, [ballStep, ballPath]);

  // Draw plinko board on canvas
  useEffect(function() {
    var canvas = canvasRef.current;
    if (!canvas) return;
    var c = canvas.getContext('2d');
    var W = canvas.width;
    var H = canvas.height;
    var rows = config.rows;
    var mults = config.multipliers;
    var slotCount = mults.length;
    var rowH = (H - 50) / (rows + 1);
    var pegR = 4;

    // Apply canvas shake offset if active
    var shakeOff = { x: 0, y: 0 };
    if (window.BossEffects) {
      var so = window.BossEffects.getCanvasShakeOffset('plinko');
      if (so) shakeOff = so;
    }

    c.save();
    c.clearRect(0, 0, W, H);
    c.translate(shakeOff.x, shakeOff.y);

    // Compute ball position for proximity flash detection
    var ballX = -1000, ballY = -1000;
    if (ballPath && ballStep >= 0) {
      ballX = W / 2;
      ballY = 10;
      for (var bi = 0; bi < Math.min(ballStep, ballPath.length); bi++) {
        if (ballPath[bi] === 'R') {
          ballX += (W / slotCount) / 2;
        } else {
          ballX -= (W / slotCount) / 2;
        }
        ballY = 20 + bi * rowH;
      }
      if (ballStep >= ballPath.length) {
        ballY = H - 45;
      }
    }

    // Decay peg flashes
    var flashes = pegFlashesRef.current;
    var flashKeys = Object.keys(flashes);
    for (var fi = 0; fi < flashKeys.length; fi++) {
      flashes[flashKeys[fi]] -= 0.08;
      if (flashes[flashKeys[fi]] <= 0) {
        delete flashes[flashKeys[fi]];
      }
    }

    // Draw pegs with flash effect
    for (var row = 0; row < rows; row++) {
      var pegsInRow = row + 2;
      var totalW = (pegsInRow - 1) * (W / (slotCount));
      var startX = (W - totalW) / 2;
      for (var col = 0; col < pegsInRow; col++) {
        var px = startX + col * (W / slotCount);
        var py = 20 + row * rowH;

        // Check if this peg should flash (ball near or recently hit)
        var dist = Math.sqrt((px - ballX) * (px - ballX) + (py - ballY) * (py - ballY));
        var flashAlpha = 0;

        // Check stored flash state for this peg position
        // Match by row and direction. The flash key format is "stepIdx-direction"
        // We iterate all active flashes and check proximity to this peg
        for (var fk in flashes) {
          if (flashes.hasOwnProperty(fk)) {
            var parts = fk.split('-');
            var fRow = parseInt(parts[0]);
            if (fRow === row) {
              flashAlpha = Math.max(flashAlpha, flashes[fk]);
            }
          }
        }

        // Also flash if ball is very close (within 20px)
        if (dist < 20 && ballPath && ballStep >= 0) {
          flashAlpha = Math.max(flashAlpha, 0.7);
        }

        if (flashAlpha > 0) {
          // Draw glow behind peg
          c.beginPath();
          c.arc(px, py, pegR + 4, 0, Math.PI * 2);
          c.fillStyle = 'rgba(255,255,255,' + (flashAlpha * 0.4) + ')';
          c.fill();
        }

        c.beginPath();
        c.arc(px, py, pegR, 0, Math.PI * 2);
        if (flashAlpha > 0) {
          // Interpolate from default #4e5058 toward white
          var r = Math.round(78 + (255 - 78) * flashAlpha);
          var g = Math.round(80 + (255 - 80) * flashAlpha);
          var b = Math.round(88 + (255 - 88) * flashAlpha);
          c.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
        } else {
          c.fillStyle = '#4e5058';
        }
        c.fill();
      }
    }

    // Draw multiplier slots at bottom
    var slotW = W / slotCount;
    for (var s = 0; s < slotCount; s++) {
      var m = mults[s];
      var sx = s * slotW;
      var sy = H - 30;
      var isHighlight = result && result.slotIndex === s && ballStep >= rows;
      c.fillStyle = isHighlight ? '#f0b232' : (m >= 3 ? '#2d5a2d' : m >= 1 ? '#3a3a10' : '#3a1010');
      c.fillRect(sx + 1, sy, slotW - 2, 28);
      c.fillStyle = isHighlight ? '#1c1c1e' : (m >= 3 ? '#57f287' : m >= 1 ? '#f0b232' : '#ed4245');
      c.font = 'bold 11px sans-serif';
      c.textAlign = 'center';
      c.fillText(m + 'x', sx + slotW / 2, sy + 18);
    }

    // Draw ball trail (fading dots behind the ball)
    if (ballPath && ballStep >= 0) {
      var trail = ballTrailRef.current;
      // Add current position to trail
      trail.push({ x: ballX, y: ballY });
      // Keep trail to 6 positions max
      if (trail.length > 6) trail.shift();
      // Draw trail dots with fading opacity
      for (var ti = 0; ti < trail.length - 1; ti++) {
        var trailAlpha = (ti + 1) / trail.length * 0.5;
        var trailSize = 3 + (ti / trail.length) * 3;
        c.beginPath();
        c.arc(trail[ti].x, trail[ti].y, trailSize, 0, Math.PI * 2);
        c.fillStyle = 'rgba(240,178,50,' + trailAlpha + ')';
        c.fill();
      }
    }

    // Draw ball if animating
    if (ballPath && ballStep >= 0) {
      // Outer glow
      c.beginPath();
      c.arc(ballX, ballY, 12, 0, Math.PI * 2);
      c.fillStyle = 'rgba(240,178,50,0.2)';
      c.fill();
      // Main ball
      c.beginPath();
      c.arc(ballX, ballY, 7, 0, Math.PI * 2);
      c.fillStyle = '#f0b232';
      c.fill();
      c.strokeStyle = '#d4941a';
      c.lineWidth = 2;
      c.stroke();
    }

    c.restore();
  }, [config, ballStep, ballPath, result]);

  // Auto-play: trigger next drop after current finishes
  useEffect(function() {
    if (!autoPlay || dropping) return;
    var chips = (ctx.account && ctx.account.chips) || 0;
    if (chips < bet) { setAutoPlay(false); return; }
    if (autoPlayCount === 1) { setAutoPlay(false); return; }
    var timer = setTimeout(function() {
      if (autoPlayCount > 0) setAutoPlayCount(function(c) { return c - 1; });
      doDrop();
    }, 2000);
    autoPlayRef.current = timer;
    return function() { clearTimeout(timer); };
  }, [autoPlay, dropping]);

  // Track auto-play stats from results
  useEffect(function() {
    if (!result || !autoPlay) return;
    setAutoStats(function(s) {
      return {
        wins: s.wins + (result.profit >= 0 ? 1 : 0),
        losses: s.losses + (result.profit < 0 ? 1 : 0),
        profit: s.profit + (result.profit || 0)
      };
    });
  }, [result]);

  function doDrop() {
    if (dropping || !sock || !ctx.account) return;
    if (window.BossSounds) window.BossSounds.play('click');
    setDropping(true);
    setResult(null);
    setBallPath(null);
    setBallStep(-1);
    sock.emit('plinko_drop', { bet: bet });
  }

  function toggleAutoPlay(count) {
    if (autoPlay && autoPlayCount === count) { setAutoPlay(false); clearTimeout(autoPlayRef.current); return; }
    if (!autoPlay) setAutoStats({ wins: 0, losses: 0, profit: 0 });
    setAutoPlayCount(count);
    setAutoPlay(true);
  }

  return React.createElement('div', {
    style: { flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e', alignItems: 'center', padding: '16px', overflow: 'auto' }
  },
    React.createElement('h3', {
      style: { color: '#f0b232', fontSize: '20px', fontWeight: 700, marginBottom: '8px' }
    }, 'Plinko'),

    null,

    // Canvas
    React.createElement('canvas', {
      ref: canvasRef,
      width: 360, height: 400,
      style: {
        background: '#18181b', borderRadius: '12px',
        border: '1px solid #4e5058', marginBottom: '16px', maxWidth: '100%'
      }
    }),

    // Result display
    result && !dropping ? React.createElement('div', {
      style: {
        textAlign: 'center', marginBottom: '12px', padding: '10px 20px',
        background: result.profit >= 0 ? 'rgba(87,242,135,0.1)' : 'rgba(237,66,69,0.1)',
        borderRadius: '8px', border: '1px solid ' + (result.profit >= 0 ? '#57f287' : '#ed4245')
      }
    },
      React.createElement('div', {
        style: { fontSize: '24px', fontWeight: 800, color: result.profit >= 0 ? '#57f287' : '#ed4245' }
      }, result.multiplier + 'x'),
      React.createElement('div', {
        style: { fontSize: '14px', color: '#dcddde', marginTop: '4px' }
      }, 'Bet ' + result.bet + ' \u2192 Won ' + result.winnings + (result.profit >= 0 ? ' (+' + result.profit + ')' : ' (' + result.profit + ')'))
    ) : null,

    // Bet controls
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }
    },
      React.createElement('span', { style: { color: '#b5bac1', fontSize: '13px', fontWeight: 600 } }, 'Bet:'),
      [10, 25, 50, 100, 250, 500].map(function(v) {
        return React.createElement('button', {
          key: v,
          style: {
            padding: '4px 10px', border: '1px solid ' + (bet === v ? '#f0b232' : '#4e5058'),
            borderRadius: '4px', background: bet === v ? 'rgba(240,178,50,0.15)' : '#252528',
            color: bet === v ? '#f0b232' : '#dcddde',
            fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { setBet(v); }
        }, v);
      })
    ),

    React.createElement('button', {
      style: {
        padding: '12px 40px', background: dropping ? '#4e5058' : '#f0b232',
        border: 'none', borderRadius: '8px', color: '#1c1c1e',
        fontSize: '16px', fontWeight: 700, cursor: dropping ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', opacity: dropping ? 0.6 : 1
      },
      onClick: doDrop,
      disabled: dropping
    }, dropping ? 'Dropping...' : 'Drop Ball (' + bet + ' chips)'),

    // Auto-play controls
    React.createElement('div', {
      style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', flexWrap: 'wrap', justifyContent: 'center' }
    },
      React.createElement('span', { style: { color: '#949ba4', fontSize: '12px', fontWeight: 600 } }, 'Auto:'),
      [5, 10, 25, 0].map(function(c) {
        var label = c === 0 ? '\u221E' : c;
        var isActive = autoPlay && autoPlayCount === c;
        return React.createElement('button', {
          key: c,
          style: {
            padding: '4px 10px', border: '1px solid ' + (isActive ? '#f0b232' : '#4e5058'),
            borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            background: isActive ? 'rgba(240,178,50,0.15)' : '#252528',
            color: isActive ? '#f0b232' : '#dcddde'
          },
          onClick: function() { toggleAutoPlay(c); }
        }, label);
      }),
      autoPlay ? React.createElement('button', {
        style: {
          padding: '4px 12px', border: 'none', borderRadius: '4px', fontSize: '12px',
          fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          background: '#ed4245', color: '#fff'
        },
        onClick: function() { setAutoPlay(false); clearTimeout(autoPlayRef.current); }
      }, 'STOP') : null
    ),
    autoPlay ? React.createElement('div', {
      style: { marginTop: '6px', fontSize: '12px', color: autoStats.profit >= 0 ? '#57f287' : '#ed4245', textAlign: 'center' }
    }, 'Session: ' + (autoStats.profit >= 0 ? '+' : '') + autoStats.profit + ' chips (' + autoStats.wins + 'W / ' + autoStats.losses + 'L)'
      + (autoPlayCount > 0 ? ' \u2022 ' + autoPlayCount + ' left' : '')) : null,

    // Multipliers legend
    React.createElement('div', {
      style: { marginTop: '16px', display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'center' }
    },
      config.multipliers.map(function(m, i) {
        return React.createElement('span', {
          key: i,
          style: {
            padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
            background: m >= 3 ? '#2d5a2d' : m >= 1 ? '#3a3a10' : '#3a1010',
            color: m >= 3 ? '#57f287' : m >= 1 ? '#f0b232' : '#ed4245'
          }
        }, m + 'x');
      })
    )
  );
}

// ---------- Lucky Scrolls View ----------
function ScratchCardView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectGames(); }, []);
  var sock = ctx.gamesSocket || ctx.socket;
  var [card, setCard] = useState(null);
  var [scratched, setScratched] = useState({});
  var [allRevealed, setAllRevealed] = useState(false);
  var [buying, setBuying] = useState(false);
  var [scratchTab, setScratchTab] = useState('buy'); // 'buy' or 'upgrades'
  var [scratchUpgradeLevels, setScratchUpgradeLevels] = useState({});
  var [scratchUpgradeDefs, setScratchUpgradeDefs] = useState([]);
  var chips = (ctx.account && ctx.account.chips) || 0;
  var [autoPlay, setAutoPlay] = useState(false);
  var [autoPlayCount, setAutoPlayCount] = useState(0);
  var [autoPlayTier, setAutoPlayTier] = useState('cheap');
  var autoPlayRef = useRef(null);
  var [autoStats, setAutoStats] = useState({ wins: 0, losses: 0, profit: 0 });

  function buyCard(tier) {
    if (!sock || buying) return;
    if (window.BossSounds) window.BossSounds.play('click');
    setBuying(true);
    setCard(null);
    setScratched({});
    setAllRevealed(false);
    sock.emit('scratch_buy', { tier: tier });
  }

  useEffect(function() {
    if (!sock) return;
    function onCard(data) {
      setCard(data);
      setBuying(false);
      // Auto-reveal on win if upgrade purchased
      if (data && data.autoReveal) {
        var all = {};
        for (var i = 0; i < 9; i++) all[i] = true;
        setScratched(all);
        setAllRevealed(true);
      }
    }
    sock.on('scratch_card', onCard);
    return function() { sock.off('scratch_card', onCard); };
  }, [sock]);

  // Load scroll upgrades on mount
  useEffect(function() {
    if (!sock) return;
    sock.emit('scratch_load_upgrades');
    function onScratchUpgrades(data) {
      if (data && data.levels) setScratchUpgradeLevels(data.levels);
      if (data && data.definitions) setScratchUpgradeDefs(data.definitions);
    }
    sock.on('scratch_upgrades', onScratchUpgrades);
    return function() { sock.off('scratch_upgrades', onScratchUpgrades); };
  }, [sock]);

  function buyScratchUpgrade(upgradeId) {
    if (!sock) return;
    sock.emit('scratch_upgrade', { upgradeId: upgradeId });
  }

  function scratchUpgradeCostCalc(upgrade, level) {
    return Math.floor(upgrade.baseCost * Math.pow(upgrade.costMult, level));
  }

  function scratchCell(idx) {
    if (!card || scratched[idx] || allRevealed) return;
    if (window.BossSounds) window.BossSounds.play('scratch');
    var next = Object.assign({}, scratched);
    next[idx] = true;
    setScratched(next);
    var count = Object.keys(next).length;
    if (count >= 9) {
      setAllRevealed(true);
      // Play appropriate win/loss sound on full reveal
      setTimeout(function() {
        if (card.isWin) {
          var winAmount = card.winnings || 0;
          if (window.BossSounds) window.BossSounds.play(winAmount >= 500 ? 'win_big' : winAmount >= 100 ? 'win_medium' : 'win_small');
        } else {
          if (window.BossSounds) window.BossSounds.play('loss');
        }
      }, 300);
    }
  }

  function revealAll() {
    if (!card) return;
    if (window.BossSounds) window.BossSounds.play('scratch');
    var all = {};
    for (var i = 0; i < 9; i++) all[i] = true;
    setScratched(all);
    setAllRevealed(true);
    // Play appropriate win/loss sound on full reveal
    setTimeout(function() {
      if (card.isWin) {
        var winAmount = card.winnings || 0;
        if (window.BossSounds) window.BossSounds.play(winAmount >= 500 ? 'win_big' : winAmount >= 100 ? 'win_medium' : 'win_small');
      } else {
        if (window.BossSounds) window.BossSounds.play('loss');
      }
    }, 300);
  }

  // Auto-play: auto-reveal then auto-buy next scroll
  useEffect(function() {
    if (!autoPlay || !card || buying) return;
    // Auto-reveal all cells after short delay
    if (!allRevealed) {
      var revealTimer = setTimeout(function() { revealAll(); }, 800);
      return function() { clearTimeout(revealTimer); };
    }
    // After revealed, track stats and buy next
    var tierCosts = { cheap: 25, standard: 100, premium: 250, mystic: 500, fire: 750, shadow: 1000, death: 2000, demon: 3500, celestial: 5000 };
    var cost = tierCosts[autoPlayTier] || 25;
    if (chips < cost) { setAutoPlay(false); return; }
    if (autoPlayCount === 1) { setAutoPlay(false); return; }
    var timer = setTimeout(function() {
      setAutoStats(function(s) {
        var profit = card.isWin ? (card.winnings - card.cost) : -card.cost;
        return { wins: s.wins + (card.isWin ? 1 : 0), losses: s.losses + (card.isWin ? 0 : 1), profit: s.profit + profit };
      });
      if (autoPlayCount > 0) setAutoPlayCount(function(c) { return c - 1; });
      setCard(null); setScratched({}); setAllRevealed(false);
      buyCard(autoPlayTier);
    }, 1500);
    autoPlayRef.current = timer;
    return function() { clearTimeout(timer); };
  }, [autoPlay, card, allRevealed, buying]);

  function scratchToggleAutoPlay(tier, count) {
    if (autoPlay && autoPlayTier === tier && autoPlayCount === count) { setAutoPlay(false); clearTimeout(autoPlayRef.current); return; }
    if (!autoPlay) setAutoStats({ wins: 0, losses: 0, profit: 0 });
    setAutoPlayTier(tier);
    setAutoPlayCount(count);
    setAutoPlay(true);
    if (!card) buyCard(tier);
  }

  var panelStyle = { flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e', overflow: 'auto', alignItems: 'center', padding: '24px' };

  if (!card) {
    var discountMult = 1 - Math.min(0.30, (scratchUpgradeLevels.scratchDiscount || 0) * 0.03);
    var tiers = [
      { id: 'cheap', name: 'Lucky Scroll', cost: 25, color: '#57f287', img: '/icons/items/Enchantment_22_scroll.PNG' },
      { id: 'standard', name: 'Gold Scroll', cost: 100, color: '#f0b232', img: '/icons/items/Enchantment_23_greenscroll.PNG' },
      { id: 'premium', name: 'Diamond Scroll', cost: 250, color: '#5865f2', img: '/icons/items/Enchantment_25_bluescroll.PNG' },
      { id: 'mystic', name: 'Mystic Scroll', cost: 500, color: '#9b59b6', img: '/icons/items/Scroll_enchant.PNG' },
      { id: 'fire', name: 'Fire Scroll', cost: 750, color: '#ff4500', img: '/icons/items/Scroll_fire.PNG' },
      { id: 'shadow', name: 'Shadow Scroll', cost: 1000, color: '#4b0082', img: '/icons/items/Enchantment_38_shadow_scroll.PNG' },
      { id: 'death', name: 'Death Scroll', cost: 2000, color: '#1a0033', img: '/icons/items/Enchantment_32_deathscroll.PNG' },
      { id: 'demon', name: 'Demon Scroll', cost: 3500, color: '#ff0000', img: '/icons/items/Enchantment_37_demon_scroll.PNG' },
      { id: 'celestial', name: 'Celestial Scroll', cost: 5000, color: '#87ceeb', img: '/icons/items/Enchantment_39_mana_scroll.PNG' },
    ];
    return React.createElement('div', { style: panelStyle },
      React.createElement('h3', { style: { color: '#f0b232', fontSize: '22px', fontWeight: 700, marginBottom: '8px' } }, 'Lucky Scrolls'),
      React.createElement('p', { style: { color: '#949ba4', fontSize: '13px', marginBottom: '16px', textAlign: 'center' } },
        'Unroll to reveal! Match 3 symbols to win.'),

      // Tab toggle
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '20px' }
      },
        React.createElement('button', {
          style: {
            padding: '6px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', border: 'none',
            background: scratchTab === 'buy' ? '#f0b232' : '#4e5058',
            color: scratchTab === 'buy' ? '#18181b' : '#dcddde'
          },
          onClick: function() { setScratchTab('buy'); }
        }, 'Buy Scrolls'),
        React.createElement('button', {
          style: {
            padding: '6px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', border: 'none',
            background: scratchTab === 'upgrades' ? '#f0b232' : '#4e5058',
            color: scratchTab === 'upgrades' ? '#18181b' : '#dcddde'
          },
          onClick: function() { setScratchTab('upgrades'); }
        }, 'Upgrades')
      ),

      // Upgrades panel
      scratchTab === 'upgrades' ? React.createElement('div', {
        style: { width: '100%', maxWidth: '400px' }
      },
        React.createElement('div', {
          style: { textAlign: 'center', color: '#f0b232', fontSize: '16px', fontWeight: 700, marginBottom: '12px' }
        }, 'Chips: ' + chips),
        scratchUpgradeDefs.map(function(upg) {
          var lvl = scratchUpgradeLevels[upg.id] || 0;
          var maxed = lvl >= upg.maxLevel;
          var cost = maxed ? 0 : scratchUpgradeCostCalc(upg, lvl);
          var canBuy = !maxed && chips >= cost;
          return React.createElement('div', {
            key: upg.id,
            style: {
              background: '#252528', borderRadius: '8px', padding: '10px 12px',
              marginBottom: '8px', border: '1px solid ' + (maxed ? '#57f287' : '#4e5058'),
              display: 'flex', alignItems: 'center', gap: '10px'
            }
          },
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', {
                style: { color: '#dcddde', fontSize: '14px', fontWeight: 700 }
              }, upg.name + ' ' + (maxed ? '(MAX)' : 'Lv ' + lvl)),
              React.createElement('div', {
                style: { color: '#949ba4', fontSize: '11px', marginTop: '2px' }
              }, upg.desc)
            ),
            !maxed ? React.createElement('button', {
              style: {
                padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                cursor: canBuy ? 'pointer' : 'not-allowed', fontFamily: 'inherit', border: 'none',
                background: canBuy ? '#f0b232' : '#3a3c41',
                color: canBuy ? '#18181b' : '#6b6f76',
                whiteSpace: 'nowrap'
              },
              onClick: function() { if (canBuy) buyScratchUpgrade(upg.id); },
              disabled: !canBuy
            }, cost.toLocaleString()) : React.createElement('span', {
              style: { color: '#57f287', fontSize: '12px', fontWeight: 700 }
            }, 'MAX')
          );
        })
      ) : null,

      // Buy scrolls tab
      scratchTab === 'buy' ? React.createElement('div', {
        style: { display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }
      },
        tiers.map(function(t) {
          var effectiveCost = Math.max(1, Math.floor(t.cost * discountMult));
          var hasDiscount = effectiveCost < t.cost;
          return React.createElement('div', {
            key: t.id,
            style: {
              background: '#252528', borderRadius: '12px', border: '2px solid ' + t.color,
              padding: '24px', width: '180px', textAlign: 'center', cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s'
            },
            onClick: function() { buyCard(t.id); },
            onMouseEnter: function(e) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)'; },
            onMouseLeave: function(e) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }
          },
            t.img
              ? React.createElement('img', { src: t.img, style: { width: '48px', height: '48px', objectFit: 'contain', marginBottom: '8px' } })
              : React.createElement('div', { style: { fontSize: '36px', marginBottom: '8px' } }, '\u{1F3AB}'),
            React.createElement('div', { style: { color: t.color, fontSize: '16px', fontWeight: 700, marginBottom: '4px' } }, t.name),
            hasDiscount ? React.createElement('div', null,
              React.createElement('span', { style: { color: '#6b6f76', fontSize: '14px', textDecoration: 'line-through', marginRight: '6px' } }, t.cost),
              React.createElement('span', { style: { color: '#57f287', fontSize: '18px', fontWeight: 800 } }, effectiveCost + ' chips')
            ) : React.createElement('div', { style: { color: '#f0b232', fontSize: '18px', fontWeight: 800 } }, t.cost + ' chips')
          );
        })
      ) : null,
      buying ? React.createElement('div', { style: { color: '#f0b232', marginTop: '20px', fontSize: '14px' } }, 'Generating scroll...') : null,

      // Auto-play controls per tier
      scratchTab === 'buy' ? React.createElement('div', {
        style: { marginTop: '24px', textAlign: 'center', width: '100%', maxWidth: '500px' }
      },
        React.createElement('div', { style: { color: '#949ba4', fontSize: '12px', fontWeight: 600, marginBottom: '8px' } }, 'AUTO-SCROLL'),
        tiers.map(function(t) {
          return React.createElement('div', {
            key: t.id,
            style: { display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', marginBottom: '6px' }
          },
            React.createElement('span', { style: { color: t.color, fontSize: '12px', fontWeight: 600, width: '80px', textAlign: 'right' } }, t.name + ':'),
            [5, 10, 25].map(function(c) {
              var isActive = autoPlay && autoPlayTier === t.id && autoPlayCount === c;
              return React.createElement('button', {
                key: c,
                style: {
                  padding: '3px 8px', border: '1px solid ' + (isActive ? '#f0b232' : '#4e5058'),
                  borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  background: isActive ? 'rgba(240,178,50,0.15)' : '#252528',
                  color: isActive ? '#f0b232' : '#dcddde'
                },
                onClick: function() { scratchToggleAutoPlay(t.id, c); }
              }, c);
            }),
            React.createElement('button', {
              style: {
                padding: '3px 8px', border: '1px solid ' + (autoPlay && autoPlayTier === t.id && autoPlayCount === 0 ? '#f0b232' : '#4e5058'),
                borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: autoPlay && autoPlayTier === t.id && autoPlayCount === 0 ? 'rgba(240,178,50,0.15)' : '#252528',
                color: autoPlay && autoPlayTier === t.id && autoPlayCount === 0 ? '#f0b232' : '#dcddde'
              },
              onClick: function() { scratchToggleAutoPlay(t.id, 0); }
            }, '\u221E')
          );
        }),
        autoPlay ? React.createElement('div', {
          style: { marginTop: '8px' }
        },
          React.createElement('button', {
            style: {
              padding: '4px 16px', border: 'none', borderRadius: '4px', fontSize: '12px',
              fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              background: '#ed4245', color: '#fff'
            },
            onClick: function() { setAutoPlay(false); clearTimeout(autoPlayRef.current); }
          }, 'STOP'),
          React.createElement('div', {
            style: { marginTop: '6px', fontSize: '12px', color: autoStats.profit >= 0 ? '#57f287' : '#ed4245' }
          }, 'Session: ' + (autoStats.profit >= 0 ? '+' : '') + autoStats.profit + ' chips (' + autoStats.wins + 'W / ' + autoStats.losses + 'L)'
            + (autoPlayCount > 0 ? ' \u2022 ' + autoPlayCount + ' left' : ''))
        ) : null
      ) : null
    );
  }

  // Show the scroll card
  var matchInfo = '';
  if (allRevealed) {
    if (card.isWin) {
      matchInfo = 'You matched 3x ' + card.winSymbol.icon + ' (' + card.winSymbol.multiplier + 'x) \u2014 Won ' + card.winnings + ' chips!';
    } else {
      matchInfo = 'No match. Better luck next time!';
    }
  }

  return React.createElement('div', { style: panelStyle },
    React.createElement('h3', { style: { color: '#f0b232', fontSize: '20px', fontWeight: 700, marginBottom: '16px' } },
      ({ cheap: 'Lucky Scroll', standard: 'Gold Scroll', premium: 'Diamond Scroll', mystic: 'Mystic Scroll', fire: 'Fire Scroll', shadow: 'Shadow Scroll', death: 'Death Scroll', demon: 'Demon Scroll', celestial: 'Celestial Scroll' }[card.tier] || card.tier) + ' \u2014 ' + card.cost + ' chips'),
    // 3x3 grid
    React.createElement('div', {
      style: {
        display: 'grid', gridTemplateColumns: 'repeat(3, 80px)', gap: '6px',
        marginBottom: '16px', userSelect: 'none'
      }
    },
      card.cells.map(function(cell, idx) {
        var isScratched = !!scratched[idx];
        return React.createElement('div', {
          key: idx,
          style: {
            width: '80px', height: '80px', borderRadius: '10px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: isScratched ? '36px' : '20px', fontWeight: 700,
            background: isScratched
              ? (allRevealed && card.isWin && card.winSymbol && cell.id === card.winSymbol.id
                ? 'linear-gradient(135deg, rgba(240,178,50,0.3), rgba(240,178,50,0.1))'
                : '#2a2a2e')
              : 'linear-gradient(135deg, #b0b0b0, #808080)',
            color: isScratched ? '#fff' : '#555',
            cursor: isScratched ? 'default' : 'pointer',
            border: allRevealed && card.isWin && card.winSymbol && cell.id === card.winSymbol.id
              ? '2px solid #f0b232' : '2px solid #4e5058',
            transition: 'all 0.3s',
            boxShadow: isScratched
              ? 'inset 0 2px 6px rgba(0,0,0,0.3)'
              : '0 2px 8px rgba(0,0,0,0.3), 0 0 12px rgba(240,178,50,0.25), inset 0 0 8px rgba(240,178,50,0.15)'
          },
          onClick: function() { scratchCell(idx); }
        }, isScratched
          ? (cell.img
            ? React.createElement('img', { src: cell.img, style: { width: '40px', height: '40px', objectFit: 'contain' }, alt: cell.id })
            : cell.icon)
          : '?');
      })
    ),
    // Reveal all button
    !allRevealed ? React.createElement('button', {
      style: {
        padding: '8px 20px', background: '#4e5058', border: 'none', borderRadius: '6px',
        color: '#dcddde', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
        fontFamily: 'inherit', marginBottom: '12px'
      },
      onClick: revealAll
    }, 'Reveal All') : null,
    // Result
    allRevealed ? React.createElement('div', {
      style: {
        textAlign: 'center', padding: '16px', borderRadius: '10px',
        background: card.isWin ? 'rgba(87,242,135,0.1)' : 'rgba(237,66,69,0.1)',
        border: '1px solid ' + (card.isWin ? '#57f287' : '#ed4245'),
        marginBottom: '12px', maxWidth: '300px'
      }
    },
      React.createElement('div', {
        style: { color: card.isWin ? '#57f287' : '#ed4245', fontSize: '16px', fontWeight: 700, marginBottom: '4px' }
      }, matchInfo),
      card.lootItem ? React.createElement('div', {
        style: { color: '#f0b232', fontSize: '14px', fontWeight: 600, marginTop: '8px' }
      }, 'BONUS LOOT: ' + (card.lootItem.item.icon || '') + ' ' + card.lootItem.item.name + ' (' + card.lootItem.item.rarity + ')') : null
    ) : null,
    // Buy another
    allRevealed ? React.createElement('button', {
      style: {
        padding: '10px 24px', background: '#f0b232', border: 'none', borderRadius: '8px',
        color: '#1c1c1e', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
      },
      onClick: function() { setCard(null); setScratched({}); setAllRevealed(false); }
    }, 'Buy Another') : null
  );
}

// ---------- Lootbox View ----------
function LootboxView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectGames(); }, []);
  var sock = ctx.gamesSocket || ctx.socket;
  var [result, setResult] = useState(null);
  var [opening, setOpening] = useState(false);
  var [showIdx, setShowIdx] = useState(-1);
  var [autoPlay, setAutoPlay] = useState(false);
  var [autoPlayCount, setAutoPlayCount] = useState(0);
  var [autoPlayTier, setAutoPlayTier] = useState('bronze');
  var autoPlayRef = useRef(null);
  var [autoStats, setAutoStats] = useState({ opened: 0, items: 0 });
  var [inventory, setInventory] = useState([]);
  var [keyDropToast, setKeyDropToast] = useState(null);

  var keyCrates = [
    { id: 'wooden_crate', name: 'Wooden Crate', keyRequired: 'wooden_key', keyName: 'Wooden Key', items: 2, color: '#8B4513', img: '/icons/loot/Loot_101_chest.PNG', keyImg: '/icons/loot/Loot_54_key.PNG' },
    { id: 'iron_strongbox', name: 'Iron Strongbox', keyRequired: 'iron_key', keyName: 'Iron Key', items: 3, color: '#71797E', img: '/icons/loot/Loot_102_chest.PNG', keyImg: '/icons/loot/Loot_56_key.PNG' },
    { id: 'gold_vault', name: 'Gold Vault', keyRequired: 'gold_key', keyName: 'Gold Key', items: 3, color: '#f0b232', img: '/icons/loot/Loot_103_chest.PNG', keyImg: '/icons/loot/Loot_58_key.PNG' },
    { id: 'crystal_chest', name: 'Crystal Chest', keyRequired: 'crystal_key', keyName: 'Crystal Key', items: 4, color: '#00d4ff', img: '/icons/loot/Loot_104_chest.PNG', keyImg: '/icons/loot/Loot_60_key.PNG' },
    { id: 'shadow_coffer', name: 'Shadow Coffer', keyRequired: 'shadow_key', keyName: 'Shadow Key', items: 5, color: '#9b59b6', img: '/icons/loot/Loot_106_chest.PNG', keyImg: '/icons/loot/Loot_70_key.PNG' },
    { id: 'void_reliquary', name: 'Void Reliquary', keyRequired: 'void_key', keyName: 'Void Key', items: 6, color: '#ff4444', img: '/icons/loot/Loot_107_chest.PNG', keyImg: '/icons/loot/Loot_72_key.PNG' },
  ];

  function countKeys(keyId) {
    return inventory.filter(function(item) { return item.itemId === keyId; }).length;
  }

  // Fetch inventory on mount and listen for updates
  useEffect(function() {
    if (!ctx.socket) return;
    ctx.socket.emit('inventory_get');
    function onInventory(data) {
      setInventory(data.inventory || []);
    }
    ctx.socket.on('inventory_data', onInventory);
    return function() { ctx.socket.off('inventory_data', onInventory); };
  }, [ctx.socket]);

  useEffect(function() {
    if (!sock) return;
    function onResult(data) {
      setResult(data);
      setOpening(false);
      setShowIdx(0);
    }
    function onCrateResult(data) {
      setResult(data);
      setOpening(false);
      setShowIdx(0);
      // Refresh inventory after opening a crate (key consumed)
      if (ctx.socket) ctx.socket.emit('inventory_get');
    }
    function onKeyDrop(data) {
      setKeyDropToast(data);
      // Refresh inventory when a key drops
      if (ctx.socket) ctx.socket.emit('inventory_get');
      setTimeout(function() { setKeyDropToast(null); }, 4000);
    }
    sock.on('lootbox_result', onResult);
    sock.on('special_crate_result', onCrateResult);
    sock.on('key_drop', onKeyDrop);
    return function() {
      sock.off('lootbox_result', onResult);
      sock.off('special_crate_result', onCrateResult);
      sock.off('key_drop', onKeyDrop);
    };
  }, [sock]);

  // Animate item reveals with rarity-based sounds
  useEffect(function() {
    if (!result || showIdx < 0) return;
    if (showIdx >= result.items.length) return;
    // Play sound for the item that just became visible (showIdx - 1 was the last revealed)
    if (showIdx > 0 && window.BossSounds) {
      var revealedItem = result.items[showIdx - 1];
      if (revealedItem && revealedItem.item) {
        var rarity = revealedItem.item.rarity;
        if (rarity === 'legendary' || rarity === 'mythic') {
          window.BossSounds.play('win_big');
        } else if (rarity === 'epic' || rarity === 'rare') {
          window.BossSounds.play('win_medium');
        } else {
          window.BossSounds.play('pop');
        }
      }
    }
    var timer = setTimeout(function() { setShowIdx(showIdx + 1); }, 800);
    return function() { clearTimeout(timer); };
  }, [showIdx, result]);

  // Play sound when all items are revealed
  useEffect(function() {
    if (!result || showIdx < result.items.length) return;
    if (showIdx === result.items.length && window.BossSounds) {
      var lastItem = result.items[result.items.length - 1];
      if (lastItem && lastItem.item) {
        var rarity = lastItem.item.rarity;
        if (rarity === 'legendary' || rarity === 'mythic') {
          window.BossSounds.play('win_big');
        } else if (rarity === 'epic' || rarity === 'rare') {
          window.BossSounds.play('win_medium');
        } else {
          window.BossSounds.play('pop');
        }
      }
    }
  }, [showIdx, result]);

  function buyBox(tier) {
    if (!sock || opening) return;
    if (window.BossSounds) window.BossSounds.play('whoosh');
    setResult(null);
    setShowIdx(-1);
    setOpening(true);
    sock.emit('lootbox_buy', { tier: tier });
  }

  // Auto-play: after all items shown, buy next box
  useEffect(function() {
    if (!autoPlay || !result) return;
    var allShown = showIdx >= result.items.length;
    if (!allShown) return;
    var tierCosts = { bronze: 50, rustic: 75, silver: 150, wooden: 200, red: 350, gold: 500, iron: 800, platinum: 1500, royal: 2000, diamond: 3000, arcane: 5000, mythic: 7500 };
    var cost = tierCosts[autoPlayTier] || 50;
    var chips = (ctx.account && ctx.account.chips) || 0;
    if (chips < cost) { setAutoPlay(false); return; }
    if (autoPlayCount === 1) { setAutoPlay(false); return; }
    var timer = setTimeout(function() {
      setAutoStats(function(s) { return { opened: s.opened + 1, items: s.items + result.items.length }; });
      if (autoPlayCount > 0) setAutoPlayCount(function(c) { return c - 1; });
      buyBox(autoPlayTier);
    }, 2000);
    autoPlayRef.current = timer;
    return function() { clearTimeout(timer); };
  }, [autoPlay, showIdx, result]);

  function lootToggleAutoPlay(tier, count) {
    if (autoPlay && autoPlayTier === tier && autoPlayCount === count) { setAutoPlay(false); clearTimeout(autoPlayRef.current); return; }
    if (!autoPlay) setAutoStats({ opened: 0, items: 0 });
    setAutoPlayTier(tier);
    setAutoPlayCount(count);
    setAutoPlay(true);
    if (!result) buyBox(tier);
  }

  var panelStyle = { flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e', overflow: 'auto', alignItems: 'center', padding: '24px' };

  var boxes = [
    { id: 'bronze', name: 'Bronze Box', cost: 50, items: 1, color: '#cd7f32', desc: '1 item', img: '/icons/loot/Loot_101_chest.PNG' },
    { id: 'rustic', name: 'Rustic Box', cost: 75, items: 1, color: '#a0522d', desc: '1 item, slight boost', img: '/icons/loot/Blacksmith_51_wooden_chest.PNG' },
    { id: 'silver', name: 'Silver Box', cost: 150, items: 2, color: '#c0c0c0', desc: '2 items, better odds', img: '/icons/loot/Loot_102_chest.PNG' },
    { id: 'wooden', name: 'Wooden Box', cost: 200, items: 2, color: '#8B4513', desc: '2 items, good odds', img: '/icons/loot/Blacksmith_52_wooden_chest.PNG' },
    { id: 'red', name: 'Red Box', cost: 350, items: 2, color: '#dc143c', desc: '2 items, strong boost', img: '/icons/loot/Blacksmith_53_red_chest.PNG' },
    { id: 'gold', name: 'Gold Box', cost: 500, items: 3, color: '#f0b232', desc: '3 items, best odds', img: '/icons/loot/Loot_103_chest.PNG' },
    { id: 'iron', name: 'Iron Box', cost: 800, items: 3, color: '#71797E', desc: '3 items, solid boost', img: '/icons/loot/Blacksmith_54_iron_chest.PNG' },
    { id: 'platinum', name: 'Platinum Box', cost: 1500, items: 4, color: '#e5e4e2', desc: '4 items, great odds', img: '/icons/loot/Loot_104_chest.PNG' },
    { id: 'royal', name: 'Royal Casket', cost: 2000, items: 4, color: '#9b59b6', desc: '4 items, royal boost', img: '/icons/loot/Blacksmith_56_royal_casket.PNG' },
    { id: 'diamond', name: 'Diamond Box', cost: 3000, items: 5, color: '#b9f2ff', desc: '5 items, premium odds', img: '/icons/loot/Loot_106_chest.PNG' },
    { id: 'arcane', name: 'Arcane Chest', cost: 5000, items: 5, color: '#00bfff', desc: '5 items, arcane power', img: '/icons/loot/Blacksmith_60_magic_chest.PNG' },
    { id: 'mythic', name: 'Mythic Box', cost: 7500, items: 6, color: '#ff4444', desc: '6 items, guaranteed legendary+', img: '/icons/loot/Loot_107_chest.PNG' },
  ];

  // Show result
  if (result) {
    var allShown = showIdx >= result.items.length;
    return React.createElement('div', { style: panelStyle },
      React.createElement('h3', { style: { color: result.box.color, fontSize: '22px', fontWeight: 700, marginBottom: '20px' } },
        result.box.name + ' Opened!'),
      React.createElement('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center', marginBottom: '24px' } },
        result.items.map(function(item, idx) {
          var visible = idx < showIdx;
          var rarityColor = item.item.rarity === 'legendary' ? '#f0b232'
            : item.item.rarity === 'epic' ? '#9b59b6'
            : item.item.rarity === 'rare' ? '#5865f2'
            : item.item.rarity === 'uncommon' ? '#57f287' : '#9e9e9e';
          return React.createElement('div', {
            key: idx,
            style: {
              width: '140px', padding: '20px', borderRadius: '12px',
              background: visible ? '#252528' : '#1a1a1c',
              border: '2px solid ' + (visible ? rarityColor : '#3a3a3e'),
              textAlign: 'center', transition: 'all 0.5s',
              opacity: visible ? 1 : 0.3,
              transform: visible ? 'scale(1)' : 'scale(0.8)',
              boxShadow: visible ? '0 0 20px ' + rarityColor + '40' : 'none'
            }
          },
            visible ? React.createElement(React.Fragment, null,
              item.item.img
                ? React.createElement('img', { src: item.item.img, style: { width: '56px', height: '56px', objectFit: 'contain', marginBottom: '8px' } })
                : React.createElement('div', { style: { fontSize: '40px', marginBottom: '8px' } }, item.item.icon || '\u{1F4E6}'),
              React.createElement('div', { style: { color: '#dcddde', fontSize: '14px', fontWeight: 700, marginBottom: '4px' } },
                item.modifierInfo ? React.createElement('span', { style: { color: item.modifierInfo.color || '#dcddde' } }, item.modifierInfo.name + ' ') : null,
                item.item.name
              ),
              React.createElement('div', {
                style: { color: rarityColor, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }
              }, item.item.rarity),
              item.serial ? React.createElement('div', {
                style: { color: '#6b6f76', fontSize: '10px', fontFamily: 'monospace', marginTop: '4px' }
              }, item.serial) : null
            ) : React.createElement('div', { style: { fontSize: '40px' } }, '?')
          );
        })
      ),
      allShown ? React.createElement('button', {
        style: {
          padding: '10px 24px', background: '#f0b232', border: 'none', borderRadius: '8px',
          color: '#1c1c1e', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
        },
        onClick: function() { setResult(null); setShowIdx(-1); }
      }, 'Open Another') : null
    );
  }

  // Box selection
  return React.createElement('div', { style: panelStyle },
    React.createElement('h3', { style: { color: '#f0b232', fontSize: '22px', fontWeight: 700, marginBottom: '8px' } }, 'Loot Boxes'),
    React.createElement('p', { style: { color: '#949ba4', fontSize: '13px', marginBottom: '24px', textAlign: 'center' } },
      'Open boxes to collect badges, titles, and rare collectibles!'),
    React.createElement('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' } },
      boxes.map(function(b) {
        return React.createElement('div', {
          key: b.id,
          style: {
            background: '#252528', borderRadius: '12px', border: '2px solid ' + b.color,
            padding: '24px', width: '180px', textAlign: 'center', cursor: 'pointer',
            transition: 'transform 0.2s, box-shadow 0.2s'
          },
          onClick: function() { if (window.BossSounds) window.BossSounds.play('click'); buyBox(b.id); },
          onMouseEnter: function(e) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)'; },
          onMouseLeave: function(e) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }
        },
          b.img
            ? React.createElement('img', { src: b.img, style: { width: '64px', height: '64px', objectFit: 'contain', marginBottom: '8px' } })
            : React.createElement('div', { style: { fontSize: '40px', marginBottom: '8px' } }, '\u{1F4E6}'),
          React.createElement('div', { style: { color: b.color, fontSize: '16px', fontWeight: 700, marginBottom: '4px' } }, b.name),
          React.createElement('div', { style: { color: '#949ba4', fontSize: '12px', marginBottom: '8px' } }, b.desc),
          React.createElement('div', { style: { color: '#f0b232', fontSize: '18px', fontWeight: 800 } }, b.cost + ' chips')
        );
      })
    ),
    opening ? React.createElement('div', { style: { color: '#f0b232', marginTop: '20px', fontSize: '16px', fontWeight: 700 } },
      'Opening...') : null,

    // Auto-open controls
    React.createElement('div', {
      style: { marginTop: '24px', textAlign: 'center', width: '100%', maxWidth: '500px' }
    },
      React.createElement('div', { style: { color: '#949ba4', fontSize: '12px', fontWeight: 600, marginBottom: '8px' } }, 'AUTO-OPEN'),
      boxes.slice(0, 6).map(function(b) {
        return React.createElement('div', {
          key: b.id,
          style: { display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', marginBottom: '6px' }
        },
          React.createElement('span', { style: { color: b.color, fontSize: '12px', fontWeight: 600, width: '80px', textAlign: 'right' } }, b.name.replace(' Box', '').replace(' Chest', '') + ':'),
          [5, 10, 25].map(function(c) {
            var isActive = autoPlay && autoPlayTier === b.id && autoPlayCount === c;
            return React.createElement('button', {
              key: c,
              style: {
                padding: '3px 8px', border: '1px solid ' + (isActive ? '#f0b232' : '#4e5058'),
                borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: isActive ? 'rgba(240,178,50,0.15)' : '#252528',
                color: isActive ? '#f0b232' : '#dcddde'
              },
              onClick: function() { lootToggleAutoPlay(b.id, c); }
            }, c);
          })
        );
      }),
      autoPlay ? React.createElement('div', { style: { marginTop: '8px' } },
        React.createElement('button', {
          style: {
            padding: '4px 16px', border: 'none', borderRadius: '4px', fontSize: '12px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            background: '#ed4245', color: '#fff'
          },
          onClick: function() { setAutoPlay(false); clearTimeout(autoPlayRef.current); }
        }, 'STOP'),
        React.createElement('div', {
          style: { marginTop: '6px', fontSize: '12px', color: '#f0b232' }
        }, 'Opened: ' + autoStats.opened + ' boxes (' + autoStats.items + ' items)'
          + (autoPlayCount > 0 ? ' \u2022 ' + autoPlayCount + ' left' : ''))
      ) : null
    ),

    // Key Drop Toast
    keyDropToast ? React.createElement('div', {
      style: {
        position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
        background: '#252528', border: '2px solid #f0b232',
        borderRadius: '12px', padding: '16px 24px',
        boxShadow: '0 0 24px rgba(240,178,50,0.5), 0 8px 32px rgba(0,0,0,0.6)',
        animation: 'fadeIn 0.3s ease', display: 'flex', alignItems: 'center', gap: '12px'
      }
    },
      keyDropToast.keyImg ? React.createElement('img', { src: keyDropToast.keyImg, style: { width: '32px', height: '32px', objectFit: 'contain' } }) : null,
      React.createElement('div', null,
        React.createElement('div', { style: { color: '#f0b232', fontSize: '14px', fontWeight: 800 } }, 'Key Drop!'),
        React.createElement('div', { style: { color: keyDropToast.color || '#dcddde', fontSize: '13px', fontWeight: 600 } }, keyDropToast.keyName || 'Unknown Key')
      )
    ) : null,

    // --- Key Crates Section ---
    React.createElement('div', {
      style: { width: '100%', maxWidth: '900px', marginTop: '32px', borderTop: '2px solid #4e5058', paddingTop: '24px' }
    },
      React.createElement('div', { style: { textAlign: 'center', marginBottom: '20px' } },
        React.createElement('h3', { style: { color: '#f0b232', fontSize: '20px', fontWeight: 700, marginBottom: '4px' } }, 'Key Crates'),
        React.createElement('p', { style: { color: '#949ba4', fontSize: '13px' } }, 'Win keys from games to unlock special crates')
      ),
      React.createElement('div', {
        style: { display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }
      },
        keyCrates.map(function(crate) {
          var keyCount = countKeys(crate.keyRequired);
          var canOpen = keyCount > 0;
          return React.createElement('div', {
            key: crate.id,
            style: {
              background: '#252528', borderRadius: '12px', border: '2px solid ' + crate.color,
              padding: '20px', width: '170px', textAlign: 'center',
              opacity: canOpen ? 1 : 0.55,
              transition: 'transform 0.2s, box-shadow 0.2s'
            },
            onMouseEnter: function(e) { if (canOpen) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)'; } },
            onMouseLeave: function(e) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }
          },
            React.createElement('img', { src: crate.img, style: { width: '64px', height: '64px', objectFit: 'contain', marginBottom: '8px' } }),
            React.createElement('div', { style: { color: crate.color, fontSize: '15px', fontWeight: 700, marginBottom: '6px' } }, crate.name),
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginBottom: '4px' }
            },
              React.createElement('img', { src: crate.keyImg, style: { width: '16px', height: '16px', objectFit: 'contain' } }),
              React.createElement('span', { style: { color: '#949ba4', fontSize: '11px' } }, 'Requires: ' + crate.keyName)
            ),
            React.createElement('div', { style: { color: '#949ba4', fontSize: '11px', marginBottom: '6px' } }, crate.items + ' items'),
            React.createElement('div', {
              style: { color: keyCount > 0 ? '#57f287' : '#ed4245', fontSize: '12px', fontWeight: 600, marginBottom: '10px' }
            }, 'You have: ' + keyCount + ' key' + (keyCount !== 1 ? 's' : '')),
            React.createElement('button', {
              style: {
                padding: '8px 18px', border: 'none', borderRadius: '8px',
                background: canOpen ? crate.color : '#3a3c41',
                color: canOpen ? '#fff' : '#6b6f76',
                fontSize: '13px', fontWeight: 700, cursor: canOpen ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', width: '100%',
                boxShadow: canOpen ? '0 2px 8px rgba(0,0,0,0.3)' : 'none'
              },
              onClick: function() {
                if (canOpen && sock && !opening) {
                  if (window.BossSounds) window.BossSounds.play('whoosh');
                  setResult(null);
                  setShowIdx(-1);
                  setOpening(true);
                  sock.emit('special_crate_open', { tier: crate.id });
                }
              },
              disabled: !canOpen || opening
            }, canOpen ? 'Open' : 'No Keys')
          );
        })
      )
    )
  );
}

function CoinFlipView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectGames(); }, []);
  var sock = ctx.gamesSocket || ctx.socket;
  var [lobby, setLobby] = useState(null);
  var [lobbies, setLobbies] = useState([]);
  var [chatInput, setChatInput] = useState('');
  var [flipResult, setFlipResult] = useState(null);
  var [countdown, setCountdown] = useState(null);
  var [coinAnimating, setCoinAnimating] = useState(false);
  var [betAmount, setBetAmount] = useState(0);
  var chatEndRef = useRef(null);
  var [autoPlay, setAutoPlay] = useState(false);
  var [autoPlaySide, setAutoPlaySide] = useState('heads');
  var [autoChoosePending, setAutoChoosePending] = useState(false);
  var [autoStats, setAutoStats] = useState({ wins: 0, losses: 0, profit: 0 });
  var [showResultBanner, setShowResultBanner] = useState(false);
  var pendingFlipRef = useRef(null);

  // Inject coin flip CSS keyframe animations once on mount
  useEffect(function() {
    if (document.getElementById('coinflip-animations')) return;
    var style = document.createElement('style');
    style.id = 'coinflip-animations';
    style.textContent = [
      '@keyframes coinFlipHeads { 0% { transform: translateY(0) rotateY(0deg) scale(1); } 15% { transform: translateY(-80px) rotateY(360deg) scale(0.85); } 30% { transform: translateY(-140px) rotateY(720deg) scale(0.78); } 50% { transform: translateY(-160px) rotateY(1080deg) scale(0.75); } 65% { transform: translateY(-100px) rotateY(1440deg) scale(0.82); } 80% { transform: translateY(-30px) rotateY(1620deg) scale(0.92); } 90% { transform: translateY(8px) rotateY(1750deg) scale(1.02); } 100% { transform: translateY(0) rotateY(1800deg) scale(1); } }',
      '@keyframes coinFlipTails { 0% { transform: translateY(0) rotateY(0deg) scale(1); } 15% { transform: translateY(-80px) rotateY(360deg) scale(0.85); } 30% { transform: translateY(-140px) rotateY(720deg) scale(0.78); } 50% { transform: translateY(-160px) rotateY(1080deg) scale(0.75); } 65% { transform: translateY(-100px) rotateY(1440deg) scale(0.82); } 80% { transform: translateY(-30px) rotateY(1620deg) scale(0.92); } 90% { transform: translateY(8px) rotateY(1930deg) scale(1.02); } 100% { transform: translateY(0) rotateY(1980deg) scale(1); } }',
      '@keyframes coinBounce { 0% { transform: translateY(0) scale(1); } 20% { transform: translateY(-12px) scale(1.03); } 40% { transform: translateY(0) scale(0.98); } 60% { transform: translateY(-5px) scale(1.01); } 80% { transform: translateY(0) scale(0.99); } 100% { transform: translateY(0) scale(1); } }',
      '@keyframes coinShine { 0% { box-shadow: 0 0 10px rgba(240,178,50,0.3), inset 0 0 20px rgba(0,0,0,0.2); } 50% { box-shadow: 0 0 30px rgba(240,178,50,0.6), 0 0 60px rgba(240,178,50,0.15), inset 0 0 20px rgba(0,0,0,0.2); } 100% { box-shadow: 0 0 10px rgba(240,178,50,0.3), inset 0 0 20px rgba(0,0,0,0.2); } }',
      '@keyframes coinWinGlow { 0% { box-shadow: 0 0 20px rgba(87,242,135,0.5), inset 0 0 15px rgba(255,255,255,0.1); } 50% { box-shadow: 0 0 45px rgba(87,242,135,0.9), 0 0 90px rgba(87,242,135,0.25), inset 0 0 15px rgba(255,255,255,0.1); } 100% { box-shadow: 0 0 20px rgba(87,242,135,0.5), inset 0 0 15px rgba(255,255,255,0.1); } }',
      '@keyframes coinLoseGlow { 0% { box-shadow: 0 0 15px rgba(237,66,69,0.4), inset 0 0 15px rgba(0,0,0,0.3); } 50% { box-shadow: 0 0 35px rgba(237,66,69,0.7), inset 0 0 15px rgba(0,0,0,0.3); } 100% { box-shadow: 0 0 15px rgba(237,66,69,0.4), inset 0 0 15px rgba(0,0,0,0.3); } }',
      '@keyframes sparkleFloat { 0% { opacity: 1; transform: translateY(0) scale(1); } 50% { opacity: 0.8; } 100% { opacity: 0; transform: translateY(-70px) scale(0.2); } }',
      '@keyframes resultPopIn { 0% { transform: scale(0.2) translateY(10px); opacity: 0; } 50% { transform: scale(1.2) translateY(-4px); opacity: 1; } 70% { transform: scale(0.95) translateY(1px); } 100% { transform: scale(1) translateY(0); opacity: 1; } }',
      '@keyframes resultShake { 0%, 100% { transform: translateX(0); } 10% { transform: translateX(-4px); } 20% { transform: translateX(4px); } 30% { transform: translateX(-3px); } 40% { transform: translateX(3px); } 50% { transform: translateX(-2px); } 60% { transform: translateX(2px); } 70% { transform: translateX(-1px); } 80% { transform: translateX(1px); } }',
      '@keyframes confettiFall { 0% { transform: translateY(-10px) rotate(0deg) scale(1); opacity: 1; } 100% { transform: translateY(80px) rotate(420deg) scale(0.4); opacity: 0; } }',
      '@keyframes coinShadowPulse { 0% { width: 100px; opacity: 0.3; } 15% { width: 50px; opacity: 0.12; } 30% { width: 35px; opacity: 0.07; } 50% { width: 28px; opacity: 0.05; } 65% { width: 45px; opacity: 0.1; } 80% { width: 80px; opacity: 0.25; } 90% { width: 110px; opacity: 0.35; } 100% { width: 100px; opacity: 0.3; } }',
      '@keyframes countdownPulse { 0% { transform: scale(1); } 50% { transform: scale(1.08); } 100% { transform: scale(1); } }',
      '@keyframes coinIdleBob { 0% { transform: translateY(0); } 50% { transform: translateY(-4px); } 100% { transform: translateY(0); } }',
      '@keyframes countdownVibrate { 0% { transform: translateX(0); } 25% { transform: translateX(-2px); } 50% { transform: translateX(2px); } 75% { transform: translateX(-1px); } 100% { transform: translateX(0); } }',
      '@keyframes winChipsBounce { 0% { transform: translateY(10px) scale(0.5); opacity: 0; } 50% { transform: translateY(-6px) scale(1.1); opacity: 1; } 100% { transform: translateY(0) scale(1); opacity: 1; } }'
    ].join('\n');
    document.head.appendChild(style);
  }, []);

  useEffect(function() {
    if (!sock) return;
    sock.emit('cf_get_lobbies');

    function onLobbies(data) { setLobbies(data.lobbies || []); }
    function onLobbiesUpdated(data) { setLobbies(data.lobbies || []); }
    function onLobbyJoined(data) { setLobby(data); setFlipResult(null); setCountdown(null); setShowResultBanner(false); }
    function onLobbyUpdate(data) { setLobby(data); }
    function onLobbyLeft() { setLobby(null); setFlipResult(null); setCountdown(null); setShowResultBanner(false); }
    function onCountdown(data) {
      setCountdown(data.seconds);
      var sec = data.seconds;
      var iv = setInterval(function() {
        sec--;
        if (sec <= 0) { clearInterval(iv); setCountdown(null); }
        else setCountdown(sec);
      }, 1000);
    }
    function onFlipResult(data) {
      if (window.BossSounds) window.BossSounds.play('coin');
      setCoinAnimating(true);
      setShowResultBanner(false);
      pendingFlipRef.current = data;
      setTimeout(function() {
        setCoinAnimating(false);
        setFlipResult(data);
        setShowResultBanner(true);
        pendingFlipRef.current = null;
        // Determine win/loss for sound
        if (data && ctx.user) {
          var myId = ctx.user.id;
          var didWin = data.winners && data.winners.some(function(w) { return w.id === myId; });
          if (didWin) {
            if (window.BossSounds) window.BossSounds.play('win_small');
          } else {
            var didLose = data.losers && data.losers.some(function(l) { return l.id === myId; });
            if (didLose) {
              if (window.BossSounds) window.BossSounds.play('loss');
            }
          }
        }
      }, 2000);
    }
    function onRoundReset() { setFlipResult(null); setCountdown(null); setShowResultBanner(false); setAutoChoosePending(true); }
    function onChatMsg(msg) {
      setLobby(function(prev) {
        if (!prev) return prev;
        var newChat = (prev.chat || []).concat([msg]);
        if (newChat.length > 30) newChat = newChat.slice(-30);
        return Object.assign({}, prev, { chat: newChat });
      });
    }

    sock.on('cf_lobbies', onLobbies);
    sock.on('cf_lobbies_updated', onLobbiesUpdated);
    sock.on('cf_lobby_joined', onLobbyJoined);
    sock.on('cf_lobby_update', onLobbyUpdate);
    sock.on('cf_lobby_left', onLobbyLeft);
    sock.on('cf_countdown', onCountdown);
    sock.on('cf_flip_result', onFlipResult);
    sock.on('cf_round_reset', onRoundReset);
    sock.on('cf_chat_msg', onChatMsg);

    return function() {
      sock.off('cf_lobbies', onLobbies);
      sock.off('cf_lobbies_updated', onLobbiesUpdated);
      sock.off('cf_lobby_joined', onLobbyJoined);
      sock.off('cf_lobby_update', onLobbyUpdate);
      sock.off('cf_lobby_left', onLobbyLeft);
      sock.off('cf_countdown', onCountdown);
      sock.off('cf_flip_result', onFlipResult);
      sock.off('cf_round_reset', onRoundReset);
      sock.off('cf_chat_msg', onChatMsg);
    };
  }, [sock]);

  useEffect(function() {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [lobby && lobby.chat && lobby.chat.length]);

  function createLobby() { if (sock) sock.emit('cf_create_lobby'); }
  function joinLobby(id) { if (sock) sock.emit('cf_join_lobby', { lobbyId: id }); }
  function leaveLobby() { if (sock) sock.emit('cf_leave_lobby'); }
  function choose(side) { if (sock) { if (window.BossSounds) window.BossSounds.play('click'); sock.emit('cf_choose', { choice: side, bet: betAmount }); } }
  function sendChat() {
    if (!chatInput.trim() || !sock) return;
    sock.emit('cf_chat', { message: chatInput.trim() });
    setChatInput('');
  }

  // Auto-play: auto-choose side when round resets
  useEffect(function() {
    if (!autoPlay || !autoChoosePending || !lobby) return;
    var timer = setTimeout(function() {
      choose(autoPlaySide);
      setAutoChoosePending(false);
    }, 1500);
    return function() { clearTimeout(timer); };
  }, [autoPlay, autoChoosePending, lobby]);

  // Track auto-play stats from flip results
  useEffect(function() {
    if (!flipResult || !autoPlay) return;
    var won = flipResult.result === autoPlaySide;
    setAutoStats(function(s) {
      return {
        wins: s.wins + (won ? 1 : 0),
        losses: s.losses + (won ? 0 : 1),
        profit: s.profit + (won ? 50 : (betAmount > 0 ? -betAmount : 0))
      };
    });
  }, [flipResult]);

  function cfToggleAutoPlay(side) {
    if (autoPlay && autoPlaySide === side) { setAutoPlay(false); return; }
    if (!autoPlay) setAutoStats({ wins: 0, losses: 0, profit: 0 });
    setAutoPlaySide(side);
    setAutoPlay(true);
    // Immediately choose if we're in waiting state
    if (lobby && lobby.state === 'waiting') choose(side);
  }

  // Determine win/loss state for the local player
  var isWin = false;
  var isLose = false;
  if (flipResult && lobby) {
    var myPlayer_ = lobby.players.find(function(p) { return p.id === (ctx.user && ctx.user.id); });
    if (myPlayer_ && myPlayer_.choice) {
      isWin = flipResult.result === myPlayer_.choice;
      isLose = flipResult.result !== myPlayer_.choice;
    }
  }

  var panelStyle = {
    flex: 1, display: 'flex', flexDirection: 'column',
    background: '#1c1c1e', overflow: 'hidden'
  };

  // Not in a lobby -- show lobby list
  if (!lobby) {
    return React.createElement('div', { style: panelStyle },
      React.createElement('div', {
        style: { padding: '24px', flex: 1, overflow: 'auto' }
      },
        React.createElement('h3', {
          style: { color: '#f0b232', fontSize: '20px', fontWeight: 700, marginBottom: '16px', textAlign: 'center' }
        }, 'Coin Flip'),
        React.createElement('p', {
          style: { color: '#949ba4', fontSize: '13px', textAlign: 'center', marginBottom: '20px' }
        }, 'Pick heads or tails. Winners get 50 chips!'),

        React.createElement('button', {
          style: {
            display: 'block', margin: '0 auto 24px', padding: '10px 28px',
            background: '#f0b232', border: 'none', borderRadius: '8px',
            color: '#1c1c1e', fontSize: '14px', fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: createLobby
        }, '+ Create Lobby'),

        lobbies.length === 0
          ? React.createElement('p', {
              style: { color: '#72767d', fontSize: '13px', textAlign: 'center' }
            }, 'No active lobbies. Create one!')
          : lobbies.map(function(lb) {
              return React.createElement('div', {
                key: lb.id,
                style: {
                  background: '#252528', borderRadius: '8px', padding: '14px 18px',
                  marginBottom: '8px', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', border: '1px solid #4e5058'
                }
              },
                React.createElement('div', null,
                  React.createElement('div', {
                    style: { color: '#dcddde', fontSize: '14px', fontWeight: 600 }
                  }, 'Lobby ' + lb.id),
                  React.createElement('div', {
                    style: { color: '#949ba4', fontSize: '12px', marginTop: '2px' }
                  }, lb.playerCount + ' player' + (lb.playerCount !== 1 ? 's' : '') + ' \u2022 Round ' + lb.roundNumber)
                ),
                React.createElement('button', {
                  style: {
                    padding: '6px 18px', background: '#f0b232', border: 'none',
                    borderRadius: '6px', color: '#1c1c1e', fontSize: '13px',
                    fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                  },
                  onClick: function() { joinLobby(lb.id); }
                }, 'Join')
              );
            })
      )
    );
  }

  // In a lobby -- show the flip game
  var myPlayer = lobby.players.find(function(p) { return p.id === (ctx.user && ctx.user.id); });
  var isWaiting = lobby.state === 'waiting';
  var isCountdown = lobby.state === 'countdown';
  var isResult = lobby.state === 'result';

  // Determine coin face display
  var coinText = coinAnimating ? '' : (flipResult ? (flipResult.result === 'heads' ? 'H' : 'T') : '?');

  // Coin gradients (radial for metallic look)
  var headsGradient = 'radial-gradient(ellipse at 35% 30%, #fce38a, #f0b232 40%, #d4941a 75%, #b8780e)';
  var tailsGradient = 'radial-gradient(ellipse at 35% 30%, #e8e8e8, #c0c0c0 40%, #8a8a8a 75%, #6e6e6e)';
  var neutralGradient = 'radial-gradient(ellipse at 35% 30%, #5a5a5e, #4e5058 40%, #3a3a3e 75%, #2a2a2e)';
  var animatingGradient = 'radial-gradient(ellipse at 35% 30%, #fce38a, #f0b232 40%, #d4941a 75%, #b8780e)';

  var coinBackground;
  if (coinAnimating) {
    coinBackground = animatingGradient;
  } else if (flipResult) {
    coinBackground = flipResult.result === 'heads' ? headsGradient : tailsGradient;
  } else {
    coinBackground = neutralGradient;
  }

  // Coin border color based on state
  var coinBorderColor;
  if (coinAnimating) {
    coinBorderColor = '#f0b232';
  } else if (flipResult) {
    if (isWin) coinBorderColor = '#57f287';
    else if (isLose) coinBorderColor = '#ed4245';
    else coinBorderColor = flipResult.result === 'heads' ? '#f0b232' : '#c0c0c0';
  } else {
    coinBorderColor = '#5a5a5e';
  }

  // Coin animation selection based on visual state
  var coinAnimation;
  if (coinAnimating) {
    // Choose animation based on pending result so the coin lands on the correct face
    var pendingResult = pendingFlipRef.current;
    var flipAnimName = (pendingResult && pendingResult.result === 'tails') ? 'coinFlipTails' : 'coinFlipHeads';
    coinAnimation = flipAnimName + ' 2s cubic-bezier(0.22, 0.61, 0.36, 1) forwards';
  } else if (flipResult && showResultBanner) {
    // Glow effects are now on the individual face divs, outer container just bounces
    coinAnimation = 'coinBounce 0.5s ease-out';
  } else if (countdown !== null) {
    coinAnimation = 'countdownVibrate 0.15s linear infinite';
  } else {
    coinAnimation = 'coinIdleBob 3s ease-in-out infinite';
  }

  // Determine final coin transform when not animating, to show correct face
  var coinFinalTransform = 'none';
  if (!coinAnimating && flipResult) {
    coinFinalTransform = flipResult.result === 'tails' ? 'rotateY(180deg)' : 'rotateY(0deg)';
  }

  // Coin text color
  var coinTextColor;
  if (coinAnimating) {
    coinTextColor = 'transparent';
  } else if (flipResult) {
    coinTextColor = '#1c1c1e';
  } else {
    coinTextColor = '#949ba4';
  }

  // Build sparkle elements for win state
  var sparkleElements = [];
  if (flipResult && showResultBanner && isWin) {
    var sparkleColors = ['#f0b232', '#57f287', '#5865f2', '#ff69b4', '#00d4ff', '#fce38a', '#f5a623', '#43b581', '#7289da', '#ff6b6b', '#a8e6cf', '#ffd93d'];
    for (var si = 0; si < 12; si++) {
      var angle = (si / 12) * Math.PI * 2;
      var radius = 85 + (si % 3) * 12;
      sparkleElements.push(
        React.createElement('div', {
          key: 'sparkle-' + si,
          style: {
            position: 'absolute',
            width: (4 + (si % 3) * 2) + 'px',
            height: (4 + (si % 3) * 2) + 'px',
            borderRadius: '50%',
            background: sparkleColors[si % sparkleColors.length],
            left: (70 + Math.cos(angle) * radius) + 'px',
            top: (80 + Math.sin(angle) * radius) + 'px',
            animation: 'sparkleFloat 1.8s ease-out ' + (si * 0.08) + 's forwards',
            pointerEvents: 'none',
            zIndex: 5
          }
        })
      );
    }
  }

  // Build confetti elements for win state
  var confettiElements = [];
  if (flipResult && showResultBanner && isWin) {
    var confettiColors = ['#f0b232', '#57f287', '#5865f2', '#ed4245', '#ff69b4', '#00d4ff', '#fce38a', '#43b581'];
    for (var ci = 0; ci < 16; ci++) {
      confettiElements.push(
        React.createElement('div', {
          key: 'confetti-' + ci,
          style: {
            position: 'absolute',
            width: (3 + (ci % 4)) + 'px',
            height: (6 + (ci % 3) * 2) + 'px',
            borderRadius: '1px',
            background: confettiColors[ci % confettiColors.length],
            left: (20 + (ci / 16) * 120) + 'px',
            top: '10px',
            animation: 'confettiFall ' + (1.2 + (ci % 5) * 0.2) + 's ease-in ' + (ci * 0.06) + 's forwards',
            pointerEvents: 'none',
            opacity: 0.9,
            zIndex: 4
          }
        })
      );
    }
  }

  return React.createElement('div', { style: Object.assign({}, panelStyle, { display: 'flex', flexDirection: 'column' }) },
    // Top bar
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: '#252528', borderBottom: '1px solid #18181b', flexShrink: 0
      }
    },
      React.createElement('span', {
        style: { color: '#f0b232', fontWeight: 700, fontSize: '15px' }
      }, 'Coin Flip \u2022 Round ' + lobby.roundNumber),
      React.createElement('button', {
        style: {
          padding: '4px 14px', background: '#ed4245', border: 'none',
          borderRadius: '6px', color: '#fff', fontSize: '12px',
          fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
        },
        onClick: leaveLobby
      }, 'Leave')
    ),

    // Main game area
    React.createElement('div', {
      style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', overflow: 'auto' }
    },

      // Coin container with 3D perspective
      React.createElement('div', {
        style: {
          perspective: '800px',
          marginBottom: '24px',
          position: 'relative',
          height: '200px',
          width: '180px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }
      },
        // Ground shadow beneath the coin
        React.createElement('div', {
          style: {
            position: 'absolute',
            bottom: '6px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: coinAnimating ? '40px' : '100px',
            height: '10px',
            borderRadius: '50%',
            background: 'rgba(0,0,0,0.35)',
            filter: 'blur(4px)',
            transition: 'all 0.3s ease',
            animation: coinAnimating ? 'coinShadowPulse 2s cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none',
            pointerEvents: 'none',
            zIndex: 1
          }
        }),

        // Sparkle particles (win state)
        sparkleElements,

        // Confetti particles (win state)
        confettiElements,

        // The coin itself -- 3D container with front and back faces
        React.createElement('div', {
          style: {
            width: '140px',
            height: '140px',
            position: 'relative',
            zIndex: 3,
            transformStyle: 'preserve-3d',
            animation: coinAnimation,
            transform: coinFinalTransform,
            transition: coinAnimating ? 'none' : 'transform 0.4s',
            cursor: 'default',
            userSelect: 'none'
          }
        },
          // FRONT FACE (Heads -- gold with 'H')
          React.createElement('div', {
            style: {
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '56px',
              fontWeight: 900,
              letterSpacing: '-2px',
              fontFamily: 'Georgia, "Times New Roman", serif',
              background: (!flipResult && !coinAnimating) ? neutralGradient : headsGradient,
              color: (coinAnimating || !flipResult) ? (coinAnimating ? 'transparent' : '#949ba4') : '#1c1c1e',
              border: '4px solid ' + (flipResult && flipResult.result === 'heads' ? coinBorderColor : (coinAnimating ? '#f0b232' : (!flipResult ? '#5a5a5e' : '#d4941a'))),
              boxShadow: (flipResult && showResultBanner && flipResult.result === 'heads' && isWin)
                ? '0 0 30px rgba(87,242,135,0.7), 0 0 60px rgba(87,242,135,0.3), inset 0 0 15px rgba(255,255,255,0.1)'
                : (flipResult && showResultBanner && flipResult.result === 'heads' && isLose)
                  ? '0 0 25px rgba(237,66,69,0.6), inset 0 0 15px rgba(0,0,0,0.3)'
                  : 'inset 0 0 20px rgba(0,0,0,0.2), inset 0 2px 4px rgba(255,255,255,0.15), 0 4px 15px rgba(0,0,0,0.4)',
              animation: (flipResult && showResultBanner && flipResult.result === 'heads')
                ? (isWin ? 'coinWinGlow 1.5s ease-in-out infinite' : (isLose ? 'coinLoseGlow 1.5s ease-in-out infinite' : 'none'))
                : 'none',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              textShadow: '0 1px 2px rgba(0,0,0,0.3)'
            }
          },
            // Inner ring
            React.createElement('div', {
              style: {
                position: 'absolute',
                top: '8px', left: '8px', right: '8px', bottom: '8px',
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.2)',
                pointerEvents: 'none'
              }
            }),
            // Metallic sheen
            React.createElement('div', {
              style: {
                position: 'absolute',
                top: '12%', left: '20%',
                width: '35%', height: '20%',
                borderRadius: '50%',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 100%)',
                pointerEvents: 'none',
                transform: 'rotate(-20deg)'
              }
            }),
            !coinAnimating ? (flipResult ? 'H' : '?') : ''
          ),
          // BACK FACE (Tails -- silver with 'T')
          React.createElement('div', {
            style: {
              position: 'absolute',
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '56px',
              fontWeight: 900,
              letterSpacing: '-2px',
              fontFamily: 'Georgia, "Times New Roman", serif',
              background: tailsGradient,
              color: (coinAnimating || !flipResult) ? (coinAnimating ? 'transparent' : '#949ba4') : '#1c1c1e',
              border: '4px solid ' + (flipResult && flipResult.result === 'tails' ? coinBorderColor : (coinAnimating ? '#c0c0c0' : '#8a8a8a')),
              boxShadow: (flipResult && showResultBanner && flipResult.result === 'tails' && isWin)
                ? '0 0 30px rgba(87,242,135,0.7), 0 0 60px rgba(87,242,135,0.3), inset 0 0 15px rgba(255,255,255,0.1)'
                : (flipResult && showResultBanner && flipResult.result === 'tails' && isLose)
                  ? '0 0 25px rgba(237,66,69,0.6), inset 0 0 15px rgba(0,0,0,0.3)'
                  : 'inset 0 0 20px rgba(0,0,0,0.2), inset 0 2px 4px rgba(255,255,255,0.15), 0 4px 15px rgba(0,0,0,0.4)',
              animation: (flipResult && showResultBanner && flipResult.result === 'tails')
                ? (isWin ? 'coinWinGlow 1.5s ease-in-out infinite' : (isLose ? 'coinLoseGlow 1.5s ease-in-out infinite' : 'none'))
                : 'none',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              textShadow: '0 1px 2px rgba(0,0,0,0.4)'
            }
          },
            // Inner ring
            React.createElement('div', {
              style: {
                position: 'absolute',
                top: '8px', left: '8px', right: '8px', bottom: '8px',
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.15)',
                pointerEvents: 'none'
              }
            }),
            // Metallic sheen
            React.createElement('div', {
              style: {
                position: 'absolute',
                top: '12%', left: '20%',
                width: '35%', height: '20%',
                borderRadius: '50%',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0) 100%)',
                pointerEvents: 'none',
                transform: 'rotate(-20deg)'
              }
            }),
            !coinAnimating ? 'T' : ''
          )
        )
      ),

      // Status text area
      countdown !== null
        ? React.createElement('div', {
            style: {
              color: '#f0b232', fontSize: '26px', fontWeight: 800, marginBottom: '16px',
              textShadow: '0 0 20px rgba(240,178,50,0.4)',
              animation: 'countdownPulse 1s ease-in-out infinite'
            }
          }, 'Flipping in ' + countdown + '...')
        : coinAnimating
          ? React.createElement('div', {
              style: {
                color: '#f0b232', fontSize: '22px', fontWeight: 700, marginBottom: '16px',
                textShadow: '0 0 15px rgba(240,178,50,0.3)',
                letterSpacing: '2px'
              }
            }, 'FLIPPING...')
          : flipResult && showResultBanner
            ? React.createElement('div', {
                style: {
                  textAlign: 'center', marginBottom: '16px',
                  animation: 'resultPopIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
                }
              },
                // Result title (HEADS! or TAILS!)
                React.createElement('div', {
                  style: {
                    color: flipResult.result === 'heads' ? '#f0b232' : '#c0c0c0',
                    fontSize: '32px', fontWeight: 900,
                    marginBottom: '8px', textTransform: 'uppercase',
                    letterSpacing: '3px',
                    textShadow: flipResult.result === 'heads'
                      ? '0 0 20px rgba(240,178,50,0.5), 0 2px 4px rgba(0,0,0,0.3)'
                      : '0 0 20px rgba(192,192,192,0.5), 0 2px 4px rgba(0,0,0,0.3)'
                  }
                }, flipResult.result + '!'),

                // Win banner
                flipResult.winners && flipResult.winners.length > 0
                  ? React.createElement('div', {
                      style: {
                        color: '#57f287', fontSize: '15px', fontWeight: 700,
                        animation: isWin ? 'winChipsBounce 0.6s ease-out 0.3s both' : 'none'
                      }
                    },
                    isWin ? 'YOU WIN! +' + (flipResult.winners.find(function(w) { return w.id === (ctx.user && ctx.user.id); }) || { winAmount: 50 }).winAmount + ' chips!' :
                    'Winners: ' + flipResult.winners.map(function(w) { return w.name + ' (+' + w.winAmount + ')'; }).join(', ')
                  )
                  : null,

                // Lose banner
                flipResult.losers && flipResult.losers.length > 0
                  ? React.createElement('div', {
                      style: {
                        color: '#ed4245', fontSize: '13px', marginTop: '6px',
                        animation: isLose ? 'resultShake 0.5s ease-out 0.2s' : 'none'
                      }
                    },
                    isLose ? 'You lost' + (betAmount > 0 ? ' -' + betAmount + ' chips' : '') + '...' :
                    'Lost: ' + flipResult.losers.map(function(l) { return l.name + (l.bet > 0 ? ' (-' + l.lostAmount + ')' : ''); }).join(', ')
                  )
                  : null,

                React.createElement('div', {
                  style: { color: '#72767d', fontSize: '12px', marginTop: '10px', fontStyle: 'italic' }
                }, 'Next round starting...')
              )
            : flipResult
              ? null
              : React.createElement('div', {
                  style: { color: '#949ba4', fontSize: '14px', marginBottom: '16px', textAlign: 'center' }
                }, lobby.players.length < 2
                  ? 'Solo Flip \u2014 Pick heads or tails!'
                  : 'Pick heads or tails!'),

      // Bet input + Choice buttons (only during waiting)
      isWaiting ? React.createElement('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '20px' }
      },
        // Bet input
        ctx.account ? React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px' }
        },
          React.createElement('span', { style: { color: '#b5bac1', fontSize: '13px', fontWeight: 600 } }, 'Bet:'),
          React.createElement('input', {
            type: 'number', value: betAmount, min: 0, max: 500, step: 10,
            style: {
              width: '80px', padding: '6px 8px', background: '#18181b',
              border: '1px solid #4e5058', borderRadius: '6px', color: '#f0b232',
              fontSize: '14px', fontWeight: 700, textAlign: 'center',
              fontFamily: 'inherit', outline: 'none'
            },
            onChange: function(e) { setBetAmount(Math.max(0, Math.min(500, parseInt(e.target.value) || 0))); }
          }),
          React.createElement('span', { style: { color: '#949ba4', fontSize: '11px' } }, '0 = free (win 50)')
        ) : null,
        React.createElement('div', {
          style: { display: 'flex', gap: '16px' }
        },
          React.createElement('button', {
            style: {
              padding: '14px 32px', border: '2px solid ' + (myPlayer && myPlayer.choice === 'heads' ? '#f0b232' : '#4e5058'),
              borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit',
              background: myPlayer && myPlayer.choice === 'heads' ? 'rgba(240,178,50,0.15)' : '#252528',
              color: myPlayer && myPlayer.choice === 'heads' ? '#f0b232' : '#dcddde',
              fontSize: '16px', fontWeight: 700, transition: 'all 0.2s'
            },
            onClick: function() { choose('heads'); }
          }, 'HEADS'),
          React.createElement('button', {
            style: {
              padding: '14px 32px', border: '2px solid ' + (myPlayer && myPlayer.choice === 'tails' ? '#c0c0c0' : '#4e5058'),
              borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit',
              background: myPlayer && myPlayer.choice === 'tails' ? 'rgba(192,192,192,0.15)' : '#252528',
              color: myPlayer && myPlayer.choice === 'tails' ? '#c0c0c0' : '#dcddde',
              fontSize: '16px', fontWeight: 700, transition: 'all 0.2s'
            },
            onClick: function() { choose('tails'); }
          }, 'TAILS')
        ),
        // Auto-play toggle
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }
        },
          React.createElement('span', { style: { color: '#949ba4', fontSize: '12px', fontWeight: 600 } }, 'Auto:'),
          React.createElement('button', {
            style: {
              padding: '4px 12px', border: '1px solid ' + (autoPlay && autoPlaySide === 'heads' ? '#f0b232' : '#4e5058'),
              borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: autoPlay && autoPlaySide === 'heads' ? 'rgba(240,178,50,0.15)' : '#252528',
              color: autoPlay && autoPlaySide === 'heads' ? '#f0b232' : '#dcddde'
            },
            onClick: function() { cfToggleAutoPlay('heads'); }
          }, 'Heads'),
          React.createElement('button', {
            style: {
              padding: '4px 12px', border: '1px solid ' + (autoPlay && autoPlaySide === 'tails' ? '#c0c0c0' : '#4e5058'),
              borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: autoPlay && autoPlaySide === 'tails' ? 'rgba(192,192,192,0.15)' : '#252528',
              color: autoPlay && autoPlaySide === 'tails' ? '#c0c0c0' : '#dcddde'
            },
            onClick: function() { cfToggleAutoPlay('tails'); }
          }, 'Tails'),
          autoPlay ? React.createElement('button', {
            style: {
              padding: '4px 12px', border: 'none', borderRadius: '4px', fontSize: '11px',
              fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              background: '#ed4245', color: '#fff'
            },
            onClick: function() { setAutoPlay(false); }
          }, 'STOP') : null
        ),
        autoPlay ? React.createElement('div', {
          style: { fontSize: '11px', color: autoStats.profit >= 0 ? '#57f287' : '#ed4245', marginTop: '4px' }
        }, (autoStats.profit >= 0 ? '+' : '') + autoStats.profit + ' chips (' + autoStats.wins + 'W / ' + autoStats.losses + 'L)') : null
      ) : null,

      // Players list
      React.createElement('div', {
        style: { width: '100%', maxWidth: '400px', marginTop: '8px' }
      },
        React.createElement('div', {
          style: { color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }
        }, 'Players'),
        lobby.players.map(function(p) {
          return React.createElement('div', {
            key: p.id,
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 12px', background: '#252528', borderRadius: '6px',
              marginBottom: '4px', border: '1px solid #3a3a3e'
            }
          },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              React.createElement('div', {
                style: { width: '8px', height: '8px', borderRadius: '50%', background: p.color }
              }),
              React.createElement('span', {
                style: { color: p.color, fontSize: '13px', fontWeight: 600 }
              }, p.name),
              p.ready ? React.createElement('span', {
                style: { color: '#57f287', fontSize: '11px' }
              }, p.choice === 'heads' ? 'HEADS' : 'TAILS') : React.createElement('span', {
                style: { color: '#72767d', fontSize: '11px' }
              }, 'choosing...')
            ),
            React.createElement('span', {
              style: { color: '#57f287', fontSize: '12px', fontWeight: 600 }
            }, p.wins + 'W / ' + p.losses + 'L')
          );
        })
      )
    ),

    // Chat area
    React.createElement('div', {
      style: {
        borderTop: '1px solid #18181b', background: '#252528',
        display: 'flex', flexDirection: 'column', maxHeight: '180px', flexShrink: 0
      }
    },
      React.createElement('div', {
        style: { flex: 1, overflow: 'auto', padding: '8px 12px', minHeight: '60px', maxHeight: '120px' }
      },
        (lobby.chat || []).map(function(msg) {
          return React.createElement('div', { key: msg.id, style: { fontSize: '12px', marginBottom: '2px' } },
            React.createElement('span', { style: { color: msg.color, fontWeight: 600 } }, msg.name + ': '),
            React.createElement('span', { style: { color: '#dcddde' } }, ctx.censorText ? ctx.censorText(msg.text) : msg.text)
          );
        }),
        React.createElement('div', { ref: chatEndRef })
      ),
      React.createElement('div', {
        style: { display: 'flex', padding: '6px 8px', gap: '6px' }
      },
        React.createElement('input', {
          type: 'text', value: chatInput,
          style: {
            flex: 1, background: '#1c1c1e', border: '1px solid #4e5058',
            borderRadius: '6px', padding: '6px 10px', color: '#dcddde',
            fontSize: '13px', fontFamily: 'inherit', outline: 'none'
          },
          placeholder: 'Chat...',
          onChange: function(e) { setChatInput(e.target.value); },
          onKeyDown: function(e) { if (e.key === 'Enter') sendChat(); },
          maxLength: 200
        }),
        React.createElement('button', {
          style: {
            padding: '6px 14px', background: '#f0b232', border: 'none',
            borderRadius: '6px', color: '#1c1c1e', fontSize: '12px',
            fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: sendChat
        }, 'Send')
      )
    )
  );
}

var SLOT_SYMBOLS = [
  // tier 0 -- always available
  { emoji: '\uD83C\uDF52', name: 'Cherry',     multi3: 5,    tier: 0, img: '/icons/items/Cherry.PNG' },
  { emoji: '\uD83C\uDF4B', name: 'Lemon',      multi3: 5,    tier: 0, img: '/icons/items/Alchemy_24_energy_potion.PNG' },
  { emoji: '\uD83C\uDF4A', name: 'Orange',     multi3: 10,   tier: 0, img: '/icons/items/Alchemy_13_heal_potion.PNG' },
  { emoji: '\uD83D\uDD14', name: 'Bell',       multi3: 15,   tier: 0, img: '/icons/items/GoldCoin.PNG' },
  { emoji: '\u2B50',       name: 'Star',       multi3: 20,   tier: 0, img: '/icons/items/Jewelry_12_goldcrystal.PNG' },
  { emoji: '\uD83D\uDC8E', name: 'Diamond',    multi3: 50,   tier: 0, img: '/icons/items/Jewelry_13_diamond.PNG' },
  { emoji: '7\uFE0F\u20E3', name: 'Seven',     multi3: 100,  tier: 0, img: '/icons/items/Jewelry_17_brilliant.PNG' },
  // tier 1+
  { emoji: '\uD83D\uDC51', name: 'Crown',      multi3: 150,  tier: 1, img: '/icons/items/Crown.PNG' },
  { emoji: '\uD83D\uDCB0', name: 'Gold Bag',   multi3: 200,  tier: 2, img: '/icons/items/BagOfGold.PNG' },
  { emoji: '\uD83C\uDFC6', name: 'Trophy',     multi3: 300,  tier: 3, img: '/icons/items/GoldStatue.PNG' },
  { emoji: '\uD83D\uDC09', name: 'Dragon',     multi3: 400,  tier: 3, img: '/icons/loot/Claws.PNG' },
  { emoji: '\uD83D\uDD25', name: 'Phoenix',    multi3: 500,  tier: 4, img: '/icons/items/Alchemy_06_blood.PNG' },
  { emoji: '\uD83D\uDC80', name: 'Boss',       multi3: 750,  tier: 4, img: '/icons/items/Mining_56_demonic_ingot.PNG' },
  // wild -- requires wildUnlock upgrade
  { emoji: '\uD83C\uDCCF', name: 'Wild',       multi3: 0,    tier: -1, isWild: true, img: '/icons/items/Mining_57_magic_ingot.PNG' }
];

function SlotMachineView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectGames(); }, []);
  var sock = ctx.gamesSocket || ctx.socket;
  var initialReels = [
    [SLOT_SYMBOLS[0], SLOT_SYMBOLS[1], SLOT_SYMBOLS[2]],
    [SLOT_SYMBOLS[3], SLOT_SYMBOLS[4], SLOT_SYMBOLS[5]],
    [SLOT_SYMBOLS[1], SLOT_SYMBOLS[6], SLOT_SYMBOLS[0]]
  ];
  var [localChips, setLocalChips] = useState(null);
  var chips = localChips !== null ? localChips : ((ctx.account && ctx.account.chips) || 0);
  var [bet, setBet] = useState(10);
  var [reels, setReels] = useState(initialReels);
  var [spinning, setSpinning] = useState(false);
  var [result, setResult] = useState(null);
  var [showPaytable, setShowPaytable] = useState(false);
  var [winAnim, setWinAnim] = useState(false);
  var [slotTab, setSlotTab] = useState('play');
  var [slotUpgradeLevels, setSlotUpgradeLevels] = useState({});
  var [slotUpgradeDefs, setSlotUpgradeDefs] = useState([]);
  var spinTimers = useRef([]);
  var pendingResultRef = useRef(null);
  var [autoPlay, setAutoPlay] = useState(false);
  var [autoPlayCount, setAutoPlayCount] = useState(0);
  var autoPlayRef = useRef(null);
  var [autoStats, setAutoStats] = useState({ wins: 0, losses: 0, profit: 0 });
  var [winLines, setWinLines] = useState([]);
  var [winType, setWinType] = useState(null);
  var [showBonus, setShowBonus] = useState(false);
  var [reelSettled, setReelSettled] = useState([false, false, false]);
  var [floatingChips, setFloatingChips] = useState(null);

  // Inject CSS animations once
  useEffect(function() {
    if (document.getElementById('slot-animations')) return;
    var style = document.createElement('style');
    style.id = 'slot-animations';
    style.textContent = [
      '@keyframes slotSpin { 0% { transform: translateY(0); filter: blur(0); } 25% { filter: blur(2px); } 50% { transform: translateY(-10px); filter: blur(3px); } 75% { filter: blur(2px); } 100% { transform: translateY(0); filter: blur(0); } }',
      '@keyframes slotBounce { 0% { transform: translateY(-8px); } 50% { transform: translateY(4px); } 100% { transform: translateY(0); } }',
      '@keyframes slotWinPulse { 0% { box-shadow: 0 0 5px rgba(87,242,135,0.3); } 50% { box-shadow: 0 0 20px rgba(87,242,135,0.8), 0 0 40px rgba(240,178,50,0.4); } 100% { box-shadow: 0 0 5px rgba(87,242,135,0.3); } }',
      '@keyframes slotWinGlow { 0% { text-shadow: 0 0 5px rgba(240,178,50,0.5); } 50% { text-shadow: 0 0 20px rgba(240,178,50,1), 0 0 40px rgba(87,242,135,0.5); } 100% { text-shadow: 0 0 5px rgba(240,178,50,0.5); } }',
      '@keyframes slotJackpot { 0% { transform: scale(1); } 25% { transform: scale(1.03); } 50% { transform: scale(1); } 75% { transform: scale(1.03); } 100% { transform: scale(1); } }',
      '@keyframes sparkle { 0% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(-30px) scale(0.5); } }',
      '@keyframes bigWinBanner { 0% { transform: scale(0.5); opacity: 0; } 50% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }',
      '@keyframes floatUp { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-60px); } }',
      '@keyframes screenShake { 0% { transform: translate(0,0); } 20% { transform: translate(-2px,1px); } 40% { transform: translate(2px,-1px); } 60% { transform: translate(-1px,2px); } 80% { transform: translate(1px,-2px); } 100% { transform: translate(0,0); } }',
      '@keyframes borderGlow { 0% { border-color: #f0b232; box-shadow: 0 0 30px rgba(240,178,50,0.2), 0 8px 32px rgba(0,0,0,0.5); } 50% { border-color: #57f287; box-shadow: 0 0 40px rgba(87,242,135,0.5), 0 0 60px rgba(240,178,50,0.3), 0 8px 32px rgba(0,0,0,0.5); } 100% { border-color: #f0b232; box-shadow: 0 0 30px rgba(240,178,50,0.2), 0 8px 32px rgba(0,0,0,0.5); } }',
      '@keyframes paylineFlash { 0% { opacity: 0.4; } 50% { opacity: 1; } 100% { opacity: 0.4; } }',
      '@keyframes symbolPulse { 0% { transform: scale(1); filter: brightness(1); } 50% { transform: scale(1.12); filter: brightness(1.4); } 100% { transform: scale(1); filter: brightness(1); } }',
      '.slot-reel-spinning { animation: slotSpin 0.15s linear infinite; }',
      '.slot-reel-settled { animation: slotBounce 0.3s ease-out; }',
      '.slot-win-cell { animation: slotWinPulse 1s ease-in-out infinite; }',
      '.slot-jackpot-frame { animation: slotJackpot 0.5s ease-in-out infinite; }',
      '.slot-win-symbol { animation: symbolPulse 0.8s ease-in-out infinite; }',
      '.slot-border-glow { animation: borderGlow 1.5s ease-in-out infinite; }',
      '.slot-screen-shake { animation: screenShake 0.3s ease-in-out; }'
    ].join('\n');
    document.head.appendChild(style);
  }, []);

  // Sync local chips override with account updates
  useEffect(function() { setLocalChips(null); }, [ctx.account && ctx.account.chips]);

  // Load slot upgrades on mount
  useEffect(function() {
    if (!sock) return;
    sock.emit('slot_load_upgrades');
    function onSlotUpgrades(data) {
      if (data && data.levels) setSlotUpgradeLevels(data.levels);
      if (data && data.definitions) setSlotUpgradeDefs(data.definitions);
    }
    sock.on('slot_upgrades', onSlotUpgrades);
    return function() { sock.off('slot_upgrades', onSlotUpgrades); };
  }, [sock]);

  function getRandomSymbol() {
    return SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
  }

  function getRandomReel() {
    return [getRandomSymbol(), getRandomSymbol(), getRandomSymbol()];
  }

  // Map server symbol (by name) to client symbol (to ensure img field is present)
  function mapServerSymbol(serverSym) {
    if (!serverSym || !serverSym.name) return serverSym;
    for (var i = 0; i < SLOT_SYMBOLS.length; i++) {
      if (SLOT_SYMBOLS[i].name === serverSym.name) return SLOT_SYMBOLS[i];
    }
    return serverSym;
  }

  function mapServerReels(serverReels) {
    if (!serverReels) return serverReels;
    return serverReels.map(function(reel) {
      return reel.map(function(sym) { return mapServerSymbol(sym); });
    });
  }

  // Listen for server spin results
  useEffect(function() {
    if (!sock) return;
    function onSlotResult(data) {
      pendingResultRef.current = data;
    }
    sock.on('slot_result', onSlotResult);
    return function() { sock.off('slot_result', onSlotResult); };
  }, [sock]);

  // Cleanup timers on unmount
  useEffect(function() {
    return function() {
      for (var ti = 0; ti < spinTimers.current.length; ti++) {
        clearTimeout(spinTimers.current[ti]);
        clearInterval(spinTimers.current[ti]);
      }
    };
  }, []);

  function doSpin() {
    if (spinning || !sock || !ctx.account) return;
    if (chips < bet) return;

    var currentBet = Math.min(bet, chips);
    if (window.BossSounds) window.BossSounds.play('reel_spin');
    setSpinning(true);
    setResult(null);
    setWinAnim(false);
    setWinLines([]);
    setWinType(null);
    setShowBonus(false);
    setFloatingChips(null);
    setReelSettled([false, false, false]);
    pendingResultRef.current = null;

    sock.emit('slot_spin', { bet: currentBet });

    // Clear old timers
    for (var ti = 0; ti < spinTimers.current.length; ti++) {
      clearTimeout(spinTimers.current[ti]);
      clearInterval(spinTimers.current[ti]);
    }
    spinTimers.current = [];

    // Animate with rapid cycling while waiting for server result
    var settled = [false, false, false];
    var serverReels = null;
    var reelStopTimes = [800, 1300, 1800];

    var cycleInterval = setInterval(function() {
      if (pendingResultRef.current && !serverReels) {
        serverReels = mapServerReels(pendingResultRef.current.reels);
      }
      var newState = [null, null, null];
      for (var ri = 0; ri < 3; ri++) {
        if (settled[ri] && serverReels) {
          newState[ri] = serverReels[ri];
        } else {
          newState[ri] = getRandomReel();
        }
      }
      setReels(newState);
    }, 80);
    spinTimers.current.push(cycleInterval);

    // Stop each reel staggered
    for (var ri = 0; ri < 3; ri++) {
      (function(reelIdx) {
        var timer = setTimeout(function() {
          settled[reelIdx] = true;
          setReelSettled(function(prev) { var n = prev.slice(); n[reelIdx] = true; return n; });
          // Play reel stop sound for each reel
          if (window.BossSounds) window.BossSounds.play('reel_stop');
          if (settled[0] && settled[1] && settled[2]) {
            clearInterval(cycleInterval);
            var sr = pendingResultRef.current;
            if (sr && sr.reels) {
              var mappedReels = mapServerReels(sr.reels);
              setReels(mappedReels);
              var serverWinLines = sr.winLines || [];
              var serverWinType = sr.winType || null;
              setWinLines(serverWinLines);
              setWinType(serverWinType);
              if (sr.win) {
                setResult({ win: true, amount: sr.winAmount, message: sr.message });
                setWinAnim(true);
                setFloatingChips(sr.winAmount);
                // Play win sound based on win magnitude
                if (window.BossSounds) {
                  if (serverWinType === 'jackpot' || sr.winAmount >= currentBet * 50) {
                    window.BossSounds.play('win_big');
                  } else {
                    window.BossSounds.play('win_small');
                  }
                }
                // Screen shake on jackpot
                if (serverWinType === 'jackpot' || sr.winAmount >= currentBet * 50) {
                  if (window.BossEffects) {
                    // Find the slot machine container element for screen shake
                    var slotContainers = document.querySelectorAll('.slot-border-glow, .slot-screen-shake');
                    if (slotContainers.length > 0) {
                      window.BossEffects.screenShake(slotContainers[0], 5, 400);
                    }
                  }
                }
                if (sr.bonusReSpin) {
                  setShowBonus(true);
                  var bonusT = setTimeout(function() { setShowBonus(false); }, 3000);
                  spinTimers.current.push(bonusT);
                }
                var animTimer = setTimeout(function() { setWinAnim(false); setFloatingChips(null); }, 3000);
                spinTimers.current.push(animTimer);
              } else {
                setResult({ win: false, amount: 0, message: sr.message || 'No luck this time' });
                // Play loss sound
                if (window.BossSounds) window.BossSounds.play('loss');
                if (sr.bonusReSpin) {
                  setShowBonus(true);
                  var bonusT2 = setTimeout(function() { setShowBonus(false); }, 3000);
                  spinTimers.current.push(bonusT2);
                }
              }
            } else {
              setResult({ win: false, amount: 0, message: 'Spin failed - try again' });
            }
            if (sr && sr.chips !== undefined) setLocalChips(sr.chips);
            setSpinning(false);
          }
        }, reelStopTimes[reelIdx]);
        spinTimers.current.push(timer);
      })(ri);
    }
  }

  // Auto-play: trigger next spin after current finishes
  useEffect(function() {
    if (!autoPlay || spinning) return;
    if (chips < bet) { setAutoPlay(false); return; }
    if (autoPlayCount === 1) { setAutoPlay(false); return; }
    var timer = setTimeout(function() {
      if (autoPlayCount > 0) setAutoPlayCount(function(c) { return c - 1; });
      doSpin();
    }, 2500);
    autoPlayRef.current = timer;
    return function() { clearTimeout(timer); };
  }, [autoPlay, spinning]);

  // Track auto-play stats from slot results
  useEffect(function() {
    if (!result || !autoPlay) return;
    setAutoStats(function(s) {
      return {
        wins: s.wins + (result.win ? 1 : 0),
        losses: s.losses + (!result.win ? 1 : 0),
        profit: s.profit + (result.win ? result.amount - bet : -bet)
      };
    });
  }, [result]);

  function slotToggleAutoPlay(count) {
    if (autoPlay && autoPlayCount === count) { setAutoPlay(false); clearTimeout(autoPlayRef.current); return; }
    if (!autoPlay) setAutoStats({ wins: 0, losses: 0, profit: 0 });
    setAutoPlayCount(count);
    setAutoPlay(true);
  }

  var currentMaxBet = 10000 + (slotUpgradeLevels.maxBet || 0) * 5000;

  function adjustBet(delta) {
    setBet(function(prev) {
      var next = prev + delta;
      if (next < 1) return 1;
      if (next > currentMaxBet) return currentMaxBet;
      return next;
    });
  }

  function buySlotUpgrade(upgradeId) {
    if (!sock) return;
    sock.emit('slot_upgrade', { upgradeId: upgradeId });
  }

  function slotUpgradeCostCalc(upgrade, level) {
    return Math.floor(upgrade.baseCost * Math.pow(upgrade.costMult, level));
  }

  // Derived state for display
  var isBigWin = result && result.win && result.amount >= bet * 50;
  var isJackpot = winType === 'jackpot';
  var multiLineWin = winLines.length > 1;
  var paylineColors = { top: '#5865f2', middle: '#ed4245', bottom: '#57f287' };

  function isWinRow(rowIdx) {
    var names = ['top', 'middle', 'bottom'];
    return winAnim && winLines.indexOf(names[rowIdx]) !== -1;
  }

  function makeSparkles(count) {
    var sparkles = [];
    for (var i = 0; i < count; i++) {
      sparkles.push(React.createElement('div', {
        key: 'sparkle-' + i,
        style: {
          position: 'absolute',
          left: (Math.random() * 100) + '%',
          top: (Math.random() * 100) + '%',
          width: '6px', height: '6px',
          borderRadius: '50%',
          background: Math.random() > 0.5 ? '#f0b232' : '#57f287',
          animation: 'sparkle ' + (0.5 + Math.random() * 1) + 's ease-out ' + (Math.random() * 0.5) + 's infinite',
          pointerEvents: 'none'
        }
      }));
    }
    return sparkles;
  }

  // ---- RENDER ----
  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', background: '#18181b', padding: '20px', overflow: 'auto',
      position: 'relative'
    },
    className: isBigWin ? 'slot-screen-shake' : ''
  },
    // Machine frame
    React.createElement('div', {
      style: {
        background: 'linear-gradient(180deg, #2a2a30, #1e1e24, #252530)',
        borderRadius: '16px', padding: '24px',
        border: '3px solid #f0b232',
        boxShadow: winAnim
          ? '0 0 40px rgba(87,242,135,0.4), 0 0 80px rgba(240,178,50,0.3), 0 8px 32px rgba(0,0,0,0.5)'
          : '0 0 30px rgba(240,178,50,0.2), 0 8px 32px rgba(0,0,0,0.5)',
        maxWidth: '460px', width: '100%',
        position: 'relative', overflow: 'hidden'
      },
      className: winAnim ? 'slot-border-glow' : ''
    },
      // Sparkle particles on jackpot
      isJackpot && winAnim ? makeSparkles(16) : null,

      // Bonus round banner
      showBonus ? React.createElement('div', {
        style: {
          position: 'absolute', top: '0', left: '0', right: '0',
          zIndex: 20, textAlign: 'center', padding: '8px',
          background: 'linear-gradient(180deg, rgba(88,101,242,0.95), rgba(88,101,242,0.8))',
          animation: 'bigWinBanner 0.5s ease-out',
          borderBottom: '2px solid #7289da',
          fontSize: '18px', fontWeight: 900, color: '#fff',
          letterSpacing: '3px',
          textShadow: '0 0 10px rgba(255,255,255,0.5), 0 2px 4px rgba(0,0,0,0.4)'
        }
      }, 'BONUS ROUND!') : null,

      // Title
      React.createElement('div', {
        style: { textAlign: 'center', marginBottom: '8px' }
      },
        React.createElement('div', {
          style: {
            fontSize: '28px', fontWeight: 800, color: '#f0b232',
            textShadow: '0 2px 4px rgba(0,0,0,0.4), 0 0 20px rgba(240,178,50,0.2)',
            letterSpacing: '2px'
          }
        }, 'SLOT MACHINE'),
        React.createElement('div', {
          style: { color: '#949ba4', fontSize: '12px', marginTop: '4px' }
        }, '3 Paylines -- Top (0.5x) / Middle (1x) / Bottom (0.5x)')
      ),

      // Tab toggle
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'center', gap: '8px', marginBottom: '16px' }
      },
        React.createElement('button', {
          style: {
            padding: '6px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', border: 'none',
            background: slotTab === 'play' ? '#f0b232' : '#4e5058',
            color: slotTab === 'play' ? '#18181b' : '#dcddde'
          },
          onClick: function() { setSlotTab('play'); }
        }, 'Play'),
        React.createElement('button', {
          style: {
            padding: '6px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', border: 'none',
            background: slotTab === 'upgrades' ? '#f0b232' : '#4e5058',
            color: slotTab === 'upgrades' ? '#18181b' : '#dcddde'
          },
          onClick: function() { setSlotTab('upgrades'); }
        }, 'Upgrades')
      ),

      // Upgrades panel
      slotTab === 'upgrades' ? React.createElement('div', {
        style: { maxHeight: '400px', overflowY: 'auto' }
      },
        React.createElement('div', {
          style: { textAlign: 'center', color: '#f0b232', fontSize: '16px', fontWeight: 700, marginBottom: '12px' }
        }, 'Chips: ' + chips),
        slotUpgradeDefs.map(function(upg) {
          var lvl = slotUpgradeLevels[upg.id] || 0;
          var maxed = lvl >= upg.maxLevel;
          var cost = maxed ? 0 : slotUpgradeCostCalc(upg, lvl);
          var canBuy = !maxed && chips >= cost;
          return React.createElement('div', {
            key: upg.id,
            style: {
              background: '#18181b', borderRadius: '8px', padding: '10px 12px',
              marginBottom: '8px', border: '1px solid ' + (maxed ? '#57f287' : '#4e5058'),
              display: 'flex', alignItems: 'center', gap: '10px'
            }
          },
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', {
                style: { color: '#dcddde', fontSize: '14px', fontWeight: 700 }
              }, upg.name + ' ' + (maxed ? '(MAX)' : 'Lv ' + lvl)),
              React.createElement('div', {
                style: { color: '#949ba4', fontSize: '11px', marginTop: '2px' }
              }, upg.desc)
            ),
            !maxed ? React.createElement('button', {
              style: {
                padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                cursor: canBuy ? 'pointer' : 'not-allowed', fontFamily: 'inherit', border: 'none',
                background: canBuy ? '#f0b232' : '#3a3c41',
                color: canBuy ? '#18181b' : '#6b6f76',
                whiteSpace: 'nowrap'
              },
              onClick: function() { if (canBuy) buySlotUpgrade(upg.id); },
              disabled: !canBuy
            }, cost.toLocaleString()) : React.createElement('span', {
              style: { color: '#57f287', fontSize: '12px', fontWeight: 700 }
            }, 'MAX')
          );
        })
      ) : null,

      // Play tab content
      slotTab === 'play' ? React.createElement(React.Fragment, null,

      // Chips display
      React.createElement('div', {
        style: {
          textAlign: 'center', marginBottom: '16px',
          color: '#f0b232', fontSize: '18px', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
        }
      },
        React.createElement('img', { src: '/icons/loot/LootCoin_06.PNG', style: { width: '20px', height: '20px', objectFit: 'contain' } }),
        'Chips: ' + chips),

      // Reel display
      React.createElement('div', {
        style: {
          display: 'flex', justifyContent: 'center', gap: '0px',
          background: '#0d0d0f', borderRadius: '12px', padding: '12px 16px',
          border: '2px solid #3a3c41', marginBottom: '16px',
          position: 'relative',
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.5)'
        }
      },
        // Payline indicators LEFT
        React.createElement('div', {
          style: {
            position: 'absolute', left: '2px', top: '0', bottom: '0',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-around',
            padding: '14px 0', zIndex: 5
          }
        },
          ['top', 'middle', 'bottom'].map(function(lineName) {
            var isWin = winAnim && winLines.indexOf(lineName) !== -1;
            return React.createElement('div', {
              key: 'pl-l-' + lineName,
              style: {
                width: 0, height: 0,
                borderTop: '6px solid transparent',
                borderBottom: '6px solid transparent',
                borderLeft: '8px solid ' + paylineColors[lineName],
                opacity: isWin ? 1 : 0.5,
                filter: isWin ? 'drop-shadow(0 0 4px ' + paylineColors[lineName] + ')' : 'none',
                animation: isWin ? 'paylineFlash 0.6s ease-in-out infinite' : 'none',
                transition: 'opacity 0.3s'
              }
            });
          })
        ),
        // Payline indicators RIGHT
        React.createElement('div', {
          style: {
            position: 'absolute', right: '2px', top: '0', bottom: '0',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-around',
            padding: '14px 0', zIndex: 5
          }
        },
          ['top', 'middle', 'bottom'].map(function(lineName) {
            var isWin = winAnim && winLines.indexOf(lineName) !== -1;
            return React.createElement('div', {
              key: 'pl-r-' + lineName,
              style: {
                width: 0, height: 0,
                borderTop: '6px solid transparent',
                borderBottom: '6px solid transparent',
                borderRight: '8px solid ' + paylineColors[lineName],
                opacity: isWin ? 1 : 0.5,
                filter: isWin ? 'drop-shadow(0 0 4px ' + paylineColors[lineName] + ')' : 'none',
                animation: isWin ? 'paylineFlash 0.6s ease-in-out infinite' : 'none',
                transition: 'opacity 0.3s'
              }
            });
          })
        ),
        // Winning payline highlight overlays
        winAnim ? winLines.map(function(lineName) {
          var rowPositions = { top: '12px', middle: '50%', bottom: 'calc(100% - 12px)' };
          var transforms = { top: 'translateY(0)', middle: 'translateY(-50%)', bottom: 'translateY(-100%)' };
          return React.createElement('div', {
            key: 'payline-hl-' + lineName,
            style: {
              position: 'absolute', left: '14px', right: '14px',
              top: rowPositions[lineName],
              transform: transforms[lineName],
              height: '70px',
              border: '2px solid ' + paylineColors[lineName],
              borderRadius: '6px',
              background: paylineColors[lineName] + '10',
              animation: 'paylineFlash 0.8s ease-in-out infinite',
              pointerEvents: 'none', zIndex: 3
            }
          });
        }) : null,
        // Reels
        reels.map(function(reel, reelIdx) {
          var isSettled = reelSettled[reelIdx] && !spinning;
          var isStillSpinning = spinning && !reelSettled[reelIdx];
          return React.createElement(React.Fragment, { key: reelIdx },
            // Reel separator
            reelIdx > 0 ? React.createElement('div', {
              style: {
                width: '2px',
                background: 'linear-gradient(180deg, transparent, #4e5058, #4e5058, transparent)',
                alignSelf: 'stretch', margin: '4px 0'
              }
            }) : null,
            React.createElement('div', {
              style: {
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                width: '110px', background: 'linear-gradient(180deg, #131316, #0d0d0f, #131316)',
                borderRadius: '8px', overflow: 'hidden',
                border: '1px solid #2a2a2e'
              },
              className: isStillSpinning ? 'slot-reel-spinning' : (isSettled ? 'slot-reel-settled' : '')
            },
              reel.map(function(sym, symIdx) {
                var rowWin = isWinRow(symIdx);
                var lineNames = ['top', 'middle', 'bottom'];
                var winColor = rowWin ? paylineColors[lineNames[symIdx]] : 'transparent';
                return React.createElement('div', {
                  key: symIdx,
                  style: {
                    width: '100%', height: '70px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '36px',
                    background: rowWin ? winColor + '20' : (symIdx === 1 ? 'rgba(240,178,50,0.06)' : 'transparent'),
                    borderTop: symIdx > 0 ? '1px solid #2a2a2e' : 'none',
                    opacity: !spinning ? 1 : 0.8,
                    transition: spinning ? 'none' : 'opacity 0.3s',
                    position: 'relative'
                  },
                  className: rowWin ? 'slot-win-cell' : ''
                }, sym.img
                  ? React.createElement('img', {
                      src: sym.img,
                      style: {
                        width: '56px', height: '56px', objectFit: 'contain',
                        filter: isStillSpinning ? 'blur(1px)' : (rowWin ? 'brightness(1.3) drop-shadow(0 0 6px ' + winColor + ')' : 'none'),
                        transition: 'filter 0.3s'
                      },
                      className: rowWin ? 'slot-win-symbol' : '',
                      alt: sym.name
                    })
                  : React.createElement('span', {
                      style: { filter: isStillSpinning ? 'blur(1px)' : 'none' },
                      className: rowWin ? 'slot-win-symbol' : ''
                    }, sym.emoji)
                );
              })
            )
          );
        })
      ),

      // Jackpot banner
      isJackpot && winAnim ? React.createElement('div', {
        style: {
          textAlign: 'center', marginBottom: '4px',
          animation: 'bigWinBanner 0.5s ease-out',
          position: 'relative'
        }
      },
        React.createElement('div', {
          style: {
            fontSize: isBigWin ? '32px' : '26px', fontWeight: 900,
            color: '#f0b232',
            textShadow: '0 0 20px rgba(240,178,50,0.8), 0 0 40px rgba(240,178,50,0.4), 0 2px 4px rgba(0,0,0,0.6)',
            letterSpacing: '4px',
            animation: 'slotWinGlow 1s ease-in-out infinite'
          }
        }, isBigWin ? 'MEGA JACKPOT!' : 'JACKPOT!'),
        multiLineWin ? React.createElement('div', {
          style: {
            fontSize: '13px', color: '#57f287', fontWeight: 700, marginTop: '2px',
            textShadow: '0 0 8px rgba(87,242,135,0.5)'
          }
        }, winLines.length + ' LINES WIN!') : null
      ) : null,

      // Multi-line win indicator (non-jackpot)
      !isJackpot && multiLineWin && winAnim ? React.createElement('div', {
        style: {
          textAlign: 'center', marginBottom: '4px',
          animation: 'bigWinBanner 0.5s ease-out'
        }
      },
        React.createElement('div', {
          style: {
            fontSize: '20px', fontWeight: 800, color: '#57f287',
            textShadow: '0 0 10px rgba(87,242,135,0.5)',
            letterSpacing: '2px'
          }
        }, winLines.length + ' LINES WIN!')
      ) : null,

      // Win announcement
      result ? React.createElement('div', {
        style: {
          textAlign: 'center', marginBottom: '12px', padding: '10px',
          borderRadius: '8px',
          background: result.win
            ? (isJackpot ? 'linear-gradient(180deg, rgba(240,178,50,0.2), rgba(87,242,135,0.15))' : 'rgba(87,242,135,0.15)')
            : 'rgba(148,155,164,0.1)',
          border: result.win
            ? (isJackpot ? '1px solid #f0b232' : '1px solid #57f287')
            : '1px solid #4e5058',
          position: 'relative', overflow: 'hidden'
        }
      },
        React.createElement('div', {
          style: {
            color: result.win ? (isJackpot ? '#f0b232' : '#57f287') : '#949ba4',
            fontSize: '14px',
            fontWeight: result.win ? 700 : 400,
            textShadow: winAnim ? '0 0 10px rgba(87,242,135,0.6)' : 'none',
            lineHeight: '1.4'
          }
        }, result.message),
        result.win ? React.createElement('div', {
          style: {
            color: '#f0b232', fontSize: '24px', fontWeight: 900, marginTop: '6px',
            textShadow: winAnim ? '0 0 15px rgba(240,178,50,0.6)' : 'none'
          }
        }, '+' + result.amount.toLocaleString() + ' chips!') : null
      ) : null,

      // Floating chips animation
      floatingChips ? React.createElement('div', {
        style: {
          textAlign: 'center', color: '#f0b232', fontSize: '20px', fontWeight: 900,
          animation: 'floatUp 2s ease-out forwards',
          pointerEvents: 'none',
          textShadow: '0 0 10px rgba(240,178,50,0.6)'
        }
      }, '+' + floatingChips.toLocaleString()) : null,

      // Bet controls
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '8px', marginBottom: '16px'
        }
      },
        React.createElement('button', {
          style: {
            width: '36px', height: '36px', background: '#4e5058', border: 'none',
            borderRadius: '50%', color: '#dcddde', fontSize: '14px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          },
          onClick: function() { adjustBet(-100); },
          disabled: spinning
        }, '--'),
        React.createElement('button', {
          style: {
            width: '36px', height: '36px', background: '#4e5058', border: 'none',
            borderRadius: '50%', color: '#dcddde', fontSize: '20px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          },
          onClick: function() { adjustBet(-10); },
          disabled: spinning
        }, '-'),
        React.createElement('div', {
          style: {
            color: '#dcddde', fontSize: '16px', fontWeight: 700,
            minWidth: '100px', textAlign: 'center',
            background: '#0d0d0f', padding: '8px 16px', borderRadius: '8px',
            border: '1px solid #3a3c41'
          }
        }, 'Bet: ' + bet),
        React.createElement('button', {
          style: {
            width: '36px', height: '36px', background: '#4e5058', border: 'none',
            borderRadius: '50%', color: '#dcddde', fontSize: '20px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          },
          onClick: function() { adjustBet(10); },
          disabled: spinning
        }, '+'),
        React.createElement('button', {
          style: {
            width: '36px', height: '36px', background: '#4e5058', border: 'none',
            borderRadius: '50%', color: '#dcddde', fontSize: '14px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          },
          onClick: function() { adjustBet(100); },
          disabled: spinning
        }, '++')
      ),

      // Spin button
      React.createElement('button', {
        style: {
          width: '100%', padding: '14px', border: 'none',
          borderRadius: '10px', fontSize: '20px', fontWeight: 800,
          cursor: spinning ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          background: spinning
            ? 'linear-gradient(180deg, #4e5058, #3a3c41)'
            : 'linear-gradient(180deg, #f0b232, #d4982a)',
          color: spinning ? '#949ba4' : '#18181b',
          boxShadow: spinning ? 'none' : '0 4px 12px rgba(240,178,50,0.4)',
          transition: 'all 0.2s',
          letterSpacing: '2px'
        },
        onClick: doSpin,
        disabled: spinning || chips <= 0
      }, spinning ? 'SPINNING...' : 'SPIN'),

      // Auto-play controls
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', flexWrap: 'wrap', justifyContent: 'center' }
      },
        React.createElement('span', { style: { color: '#949ba4', fontSize: '12px', fontWeight: 600 } }, 'Auto:'),
        [5, 10, 25, 0].map(function(c) {
          var label = c === 0 ? '\u221E' : c;
          var isActive = autoPlay && autoPlayCount === c;
          return React.createElement('button', {
            key: c,
            style: {
              padding: '4px 10px', border: '1px solid ' + (isActive ? '#f0b232' : '#4e5058'),
              borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: isActive ? 'rgba(240,178,50,0.15)' : '#252528',
              color: isActive ? '#f0b232' : '#dcddde'
            },
            onClick: function() { slotToggleAutoPlay(c); }
          }, label);
        }),
        autoPlay ? React.createElement('button', {
          style: {
            padding: '4px 12px', border: 'none', borderRadius: '4px', fontSize: '12px',
            fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            background: '#ed4245', color: '#fff'
          },
          onClick: function() { setAutoPlay(false); clearTimeout(autoPlayRef.current); }
        }, 'STOP') : null
      ),
      autoPlay ? React.createElement('div', {
        style: { marginTop: '6px', fontSize: '12px', color: autoStats.profit >= 0 ? '#57f287' : '#ed4245', textAlign: 'center' }
      }, 'Session: ' + (autoStats.profit >= 0 ? '+' : '') + autoStats.profit + ' chips (' + autoStats.wins + 'W / ' + autoStats.losses + 'L)'
        + (autoPlayCount > 0 ? ' \u2022 ' + autoPlayCount + ' left' : '')) : null,

      // Paytable toggle
      React.createElement('div', {
        style: { textAlign: 'center', marginTop: '12px' }
      },
        React.createElement('button', {
          style: {
            background: 'none', border: 'none', color: '#f0b232',
            fontSize: '13px', cursor: 'pointer', fontFamily: 'inherit',
            textDecoration: 'underline'
          },
          onClick: function() { setShowPaytable(function(p) { return !p; }); }
        }, showPaytable ? 'Hide Paytable' : 'Show Paytable')
      ),

      // Paytable
      showPaytable ? React.createElement('div', {
        style: {
          marginTop: '12px', background: '#0d0d0f', borderRadius: '10px',
          padding: '14px', border: '1px solid #3a3c41'
        }
      },
        React.createElement('div', {
          style: { color: '#f0b232', fontSize: '16px', fontWeight: 800, marginBottom: '6px', textAlign: 'center',
            textShadow: '0 0 8px rgba(240,178,50,0.3)' }
        }, 'PAYTABLE'),
        // Payline explanation
        React.createElement('div', {
          style: {
            display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '10px',
            padding: '6px 0', borderBottom: '1px solid #2a2a2e'
          }
        },
          [
            { name: 'Top', color: paylineColors.top, mult: '0.5x' },
            { name: 'Mid', color: paylineColors.middle, mult: '1x' },
            { name: 'Bot', color: paylineColors.bottom, mult: '0.5x' }
          ].map(function(pl) {
            return React.createElement('div', {
              key: pl.name,
              style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px' }
            },
              React.createElement('div', {
                style: { width: '10px', height: '10px', borderRadius: '2px', background: pl.color }
              }),
              React.createElement('span', { style: { color: '#949ba4' } }, pl.name),
              React.createElement('span', { style: { color: pl.color, fontWeight: 700 } }, pl.mult)
            );
          })
        ),
        React.createElement('div', {
          style: { color: '#949ba4', fontSize: '11px', marginBottom: '8px', textAlign: 'center' }
        }, '3 matching symbols on a payline:'),
        // Symbol grid
        React.createElement('div', {
          style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 8px', alignItems: 'center' }
        },
          SLOT_SYMBOLS.filter(function(sym) {
            if (sym.isWild) return (slotUpgradeLevels.wildUnlock || 0) >= 1;
            return sym.tier <= (slotUpgradeLevels.symbolTier || 0);
          }).map(function(sym, si) {
            return React.createElement(React.Fragment, { key: si },
              React.createElement('div', {
                style: {
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '4px 6px', borderRadius: '4px',
                  background: si % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent'
                }
              },
                sym.img ? React.createElement('img', { src: sym.img, style: { width: '22px', height: '22px', objectFit: 'contain' } }) : null,
                sym.img ? React.createElement('img', { src: sym.img, style: { width: '22px', height: '22px', objectFit: 'contain' } }) : null,
                sym.img ? React.createElement('img', { src: sym.img, style: { width: '22px', height: '22px', objectFit: 'contain' } }) : null,
                React.createElement('span', {
                  style: { color: '#dcddde', fontSize: '12px', fontWeight: 600, marginLeft: '4px' }
                }, sym.name + (sym.isWild ? ' (wild)' : ''))
              ),
              React.createElement('div', {
                style: {
                  color: sym.multi3 >= 300 ? '#f0b232' : (sym.multi3 >= 100 ? '#f5c542' : '#949ba4'),
                  fontWeight: 700, fontSize: '13px', textAlign: 'right',
                  padding: '4px 6px', borderRadius: '4px',
                  background: si % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent'
                }
              }, sym.isWild ? 'WILD' : sym.multi3 + 'x')
            );
          })
        ),
        React.createElement('div', {
          style: { borderTop: '1px solid #2a2a2e', marginTop: '8px', paddingTop: '8px' }
        },
          React.createElement('div', {
            style: {
              display: 'flex', justifyContent: 'space-between',
              padding: '4px 8px', color: '#dcddde', fontSize: '13px',
              background: 'rgba(255,255,255,0.03)', borderRadius: '4px', marginBottom: '2px'
            }
          },
            React.createElement('span', null, 'Any 2 matching'),
            React.createElement('span', { style: { color: '#f0b232', fontWeight: 700 } }, (2 + (slotUpgradeLevels.pairBoost || 0)) + 'x')
          ),
          React.createElement('div', {
            style: {
              display: 'flex', justifyContent: 'space-between',
              padding: '4px 8px', color: '#dcddde', fontSize: '13px'
            }
          },
            React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
              React.createElement('img', { src: '/icons/items/Cherry.PNG', style: { width: '16px', height: '16px', objectFit: 'contain' } }),
              'Any cherry on payline'
            ),
            React.createElement('span', { style: { color: '#f0b232', fontWeight: 700 } }, (1 + (slotUpgradeLevels.cherryBoost || 0) * 0.5) + 'x')
          ),
          React.createElement('div', {
            style: {
              padding: '4px 8px', color: '#949ba4', fontSize: '11px', marginTop: '4px',
              fontStyle: 'italic'
            }
          }, 'Top/Bottom lines pay at 0.5x listed multiplier')
        )
      ) : null
      ) : null // end play tab
    )
  );
}
