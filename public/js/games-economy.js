function StockMarketView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectMarket(); }, []);
  var sock = ctx.marketSocket || ctx.socket;
  var [stocks, setStocks] = useState([]);
  var [events, setEvents] = useState([]);
  var [portfolio, setPortfolio] = useState(null);
  var [selectedStock, setSelectedStock] = useState(null);
  var [tradeShares, setTradeShares] = useState(1);
  var [tradeMsg, setTradeMsg] = useState(null);
  var [tradeMsgColor, setTradeMsgColor] = useState('#57f287');
  var [marketTab, setMarketTab] = useState('stocks');
  var isMobile = useIsMobile();

  // Chip counter roll animation refs
  var prevChipsRef = useRef((ctx.account && ctx.account.chips) || 0);
  var balanceElRef = useRef(null);
  useEffect(function() {
    var currentChips = (ctx.account && ctx.account.chips) || 0;
    var prevChips = prevChipsRef.current;
    if (currentChips !== prevChips && balanceElRef.current && window.BossEffects) {
      window.BossEffects.numberRoll(balanceElRef.current, prevChips, currentChips, 600, function(v) {
        return Math.floor(v).toLocaleString();
      });
      // Floating +/- text for chip changes
      var diff = currentChips - prevChips;
      var balanceContainer = balanceElRef.current.parentElement;
      if (balanceContainer && diff !== 0) {
        var sign = diff > 0 ? '+' : '';
        var clr = diff > 0 ? '#57f287' : '#ed4245';
        window.BossEffects.floatingText(balanceContainer, sign + diff.toLocaleString() + ' chips', { color: clr, fontSize: 14, duration: 1500 });
      }
    }
    prevChipsRef.current = currentChips;
  }, [ctx.account && ctx.account.chips]);

  // Crypto ticker IDs for event filtering
  var cryptoStockIds = useMemo(function() {
    var ids = {};
    stocks.forEach(function(s) { if (s.sector === 'Crypto') ids[s.id] = true; });
    return ids;
  }, [stocks]);

  var pennyStockIds = useMemo(function() {
    var ids = {};
    stocks.forEach(function(s) { if (s.sector === 'Penny') ids[s.id] = true; });
    return ids;
  }, [stocks]);

  useEffect(function() {
    if (!sock) return;
    sock.emit('stock_market_subscribe');
    sock.emit('stock_portfolio_get');

    function onMarketData(data) {
      setStocks(data.stocks || []);
      setEvents(function(prev) {
        var combined = (data.events || []).concat(prev);
        return combined.slice(0, 50);
      });
    }
    function onTick(data) {
      setStocks(data.stocks || []);
      if (data.events && data.events.length > 0) {
        setEvents(function(prev) {
          var combined = (data.events || []).concat(prev);
          return combined.slice(0, 50);
        });
      }
    }
    function onEvent(evt) {
      setEvents(function(prev) { return [evt].concat(prev).slice(0, 50); });
    }
    function onPortfolio(data) {
      setPortfolio(data);
    }
    function onTradeResult(data) {
      if (data.error) {
        setTradeMsg(data.error);
        setTradeMsgColor('#ed4245');
        if (window.BossSounds) window.BossSounds.play('loss');
      } else {
        setTradeMsg(data.message || 'Trade executed!');
        setTradeMsgColor('#57f287');
        sock.emit('stock_portfolio_get');
        // Determine buy vs sell from message text for sound/floating text
        var msg = (data.message || '').toLowerCase();
        var isBuy = msg.indexOf('bought') >= 0 || msg.indexOf('buy') >= 0;
        if (isBuy) {
          if (window.BossSounds) window.BossSounds.play('chip_stack');
          if (window.BossEffects) {
            var sharesMatch = (data.message || '').match(/(\d+)\s*shares?/i);
            var shareText = sharesMatch ? '+' + sharesMatch[1] + ' shares' : '+shares';
            var tradeContainer = document.querySelector('[data-stock-trade-area]');
            if (tradeContainer) {
              window.BossEffects.floatingText(tradeContainer, shareText, { color: '#57f287', fontSize: 18, duration: 1200 });
            }
          }
        } else {
          if (window.BossSounds) window.BossSounds.play('coin');
          if (window.BossEffects) {
            var profitMatch = (data.message || '').match(/profit[:\s]*([+-]?[\d,]+)/i);
            var plText = profitMatch ? profitMatch[1] + ' chips' : (data.message || 'Trade executed!');
            var tradeContainer2 = document.querySelector('[data-stock-trade-area]');
            if (tradeContainer2) {
              var plColor = plText.indexOf('-') === 0 ? '#ed4245' : '#57f287';
              window.BossEffects.floatingText(tradeContainer2, plText, { color: plColor, fontSize: 18, duration: 1200 });
            }
          }
        }
      }
      setTimeout(function() { setTradeMsg(null); }, 3000);
    }

    sock.on('stock_market_data', onMarketData);
    sock.on('stock_market_tick', onTick);
    sock.on('stock_market_event', onEvent);
    sock.on('stock_portfolio_data', onPortfolio);
    sock.on('stock_trade_result', onTradeResult);
    return function() {
      sock.emit('stock_market_unsubscribe');
      sock.off('stock_market_data', onMarketData);
      sock.off('stock_market_tick', onTick);
      sock.off('stock_market_event', onEvent);
      sock.off('stock_portfolio_data', onPortfolio);
      sock.off('stock_trade_result', onTradeResult);
    };
  }, [sock]);

  // Keep selectedStock in sync with latest tick data
  useEffect(function() {
    if (selectedStock) {
      var updated = stocks.find(function(s) { return s.id === selectedStock.id; });
      if (updated) setSelectedStock(updated);
    }
  }, [stocks]);

  function buyStock(stockId) {
    if (!sock || tradeShares < 1) return;
    sock.emit('stock_buy', { stockId: stockId, shares: tradeShares });
  }
  function sellStock(stockId) {
    if (!sock || tradeShares < 1) return;
    sock.emit('stock_sell', { stockId: stockId, shares: tradeShares });
  }

  function renderSparkline(history, width, height, color) {
    if (!history || history.length < 2) return null;
    var min = history[0], max = history[0];
    for (var i = 1; i < history.length; i++) {
      if (history[i] < min) min = history[i];
      if (history[i] > max) max = history[i];
    }
    var range = max - min || 1;
    var pts = history.map(function(p, idx) {
      var x = idx * (width / (history.length - 1));
      var y = height - ((p - min) / range) * (height - 4) - 2;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    return React.createElement('svg', { width: width, height: height, style: { display: 'block' } },
      React.createElement('polyline', { points: pts, fill: 'none', stroke: color, strokeWidth: '2', strokeLinejoin: 'round' })
    );
  }

  // ─── Filter stocks by active tab ───
  var filteredStocks = stocks.filter(function(s) {
    if (marketTab === 'crypto') return s.sector === 'Crypto';
    if (marketTab === 'penny') return s.sector === 'Penny';
    return s.sector !== 'Crypto' && s.sector !== 'Penny';
  });

  // ─── Filter events based on active tab ───
  var filteredEvents = events.filter(function(evt) {
    if (!evt.affectedStocks || evt.affectedStocks.length === 0) return true;
    if (marketTab === 'crypto') {
      // Show events that affect any crypto stock, or market-wide events
      var isMktWide = evt.type === 'market_boom' || evt.type === 'market_crash';
      if (isMktWide) return true;
      return evt.affectedStocks.some(function(id) { return cryptoStockIds[id]; });
    }
    if (marketTab === 'penny') {
      var isMktWide2 = evt.type === 'market_boom' || evt.type === 'market_crash';
      if (isMktWide2) return true;
      return evt.affectedStocks.some(function(id) { return pennyStockIds[id]; });
    }
    // Stocks tab: show everything (market-wide are relevant), but deprioritize crypto-only
    return true;
  });

  // ─── Helpers for crypto styling ───
  var isCrypto = marketTab === 'crypto';

  function getCryptoPriceColor(stock) {
    if (!stock || !stock.basePrice || stock.sector !== 'Crypto') return '#f0b232';
    var ratio = stock.price / stock.basePrice;
    if (ratio > 3.0) return '#ffd700';  // gold >300%
    if (ratio > 1.5) return '#57f287';  // green 150-300%
    if (ratio > 0.5) return '#f0b232';  // yellow 50-150%
    return '#ed4245';                    // red <50%
  }

  function getVolatilityLabel(vol) {
    if (vol >= 0.35) return { text: 'EXTREME', color: '#ed4245' };
    if (vol >= 0.25) return { text: 'VERY HIGH', color: '#f0b232' };
    if (vol >= 0.15) return { text: 'HIGH', color: '#f5c542' };
    return { text: 'MODERATE', color: '#949ba4' };
  }

  var panelStyle = { flex: 1, display: 'flex', flexDirection: 'column', background: isCrypto ? '#0d1117' : '#1c1c1e', overflow: 'hidden' };

  // Portfolio summary
  var totalValue = (portfolio && portfolio.totalValue) || 0;
  var totalProfit = (portfolio && portfolio.totalProfit) || 0;
  var totalProfitPct = (portfolio && portfolio.totalProfitPercent) || 0;
  var profitColor = totalProfit >= 0 ? '#57f287' : '#ed4245';
  var profitSign = totalProfit >= 0 ? '+' : '';

  // Tab count helpers
  var stockCount = stocks.filter(function(s) { return s.sector !== 'Crypto' && s.sector !== 'Penny'; }).length;
  var pennyCount = stocks.filter(function(s) { return s.sector === 'Penny'; }).length;
  var cryptoCount = stocks.filter(function(s) { return s.sector === 'Crypto'; }).length;

  // ─── Tab button builder ───
  function makeTabBtn(id, label, count, isActive, accentColor) {
    return React.createElement('button', {
      key: id,
      style: {
        padding: isMobile ? '8px 12px' : '6px 14px',
        background: isActive ? (accentColor || '#3a3a3e') : 'transparent',
        border: isActive ? '1px solid ' + (accentColor || '#4e5058') : '1px solid transparent',
        borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
        color: isActive ? '#ffffff' : '#949ba4',
        fontSize: isMobile ? '12px' : '12px', fontWeight: isActive ? 700 : 500,
        transition: 'all 0.15s',
        display: 'flex', alignItems: 'center', gap: '6px'
      },
      onClick: function() { setMarketTab(id); setSelectedStock(null); setTradeMsg(null); }
    },
      label,
      React.createElement('span', {
        style: {
          background: isActive ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
          padding: '1px 6px', borderRadius: '8px', fontSize: '10px',
          color: isActive ? '#ffffff' : '#6b6f76'
        }
      }, count)
    );
  }

  return React.createElement('div', { style: panelStyle },
    // Portfolio summary bar
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px',
        background: isCrypto ? '#0f1923' : '#252528',
        borderBottom: isCrypto ? '1px solid #1b2838' : '1px solid #18181b',
        flexShrink: 0, flexWrap: 'wrap', gap: '8px'
      }
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '16px' } },
        React.createElement('span', {
          style: { color: isCrypto ? '#00f0ff' : '#f0b232', fontSize: '16px', fontWeight: 700 }
        }, isCrypto ? '\u26A1 Crypto Market' : (marketTab === 'penny' ? '\uD83E\uDE99 Penny Stocks' : '\uD83D\uDCC8 Stock Market')),
        React.createElement('span', { style: { color: '#949ba4', fontSize: '12px' } }, filteredStocks.length + (isCrypto ? ' coins' : ' stocks'))
      ),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '16px', flexWrap: 'wrap' } },
        React.createElement('span', { style: { color: '#dcddde', fontSize: isMobile ? '11px' : '13px' } },
          'Portfolio: ', React.createElement('span', { style: { color: '#f0b232', fontWeight: 700 } }, totalValue.toLocaleString() + ' chips')
        ),
        React.createElement('span', { style: { color: profitColor, fontSize: isMobile ? '11px' : '13px', fontWeight: 600 } },
          profitSign + totalProfit.toLocaleString() + ' (' + profitSign + totalProfitPct.toFixed(1) + '%)'
        ),
        React.createElement('span', { style: { color: '#949ba4', fontSize: isMobile ? '10px' : '12px', position: 'relative' } },
          'Balance: ', React.createElement('span', { ref: balanceElRef, style: { color: '#f0b232', fontWeight: 600 } }, ((ctx.account && ctx.account.chips) || 0).toLocaleString())
        )
      )
    ),

    // ─── Tab bar ───
    React.createElement('div', {
      style: {
        display: 'flex', gap: '6px', padding: '8px 16px',
        background: isCrypto ? '#0f1923' : '#252528',
        borderBottom: isCrypto ? '1px solid #1b2838' : '1px solid #18181b',
        flexShrink: 0, flexWrap: 'wrap'
      }
    },
      makeTabBtn('stocks', '\uD83D\uDCC8 Stocks', stockCount, marketTab === 'stocks', '#4e5058'),
      makeTabBtn('penny', '\uD83E\uDE99 Penny', pennyCount, marketTab === 'penny', '#f5c542'),
      makeTabBtn('crypto', '\u26A1 Crypto', cryptoCount, marketTab === 'crypto', '#00b4d8')
    ),

    // Main content area: left stock list + detail, right news
    React.createElement('div', {
      style: { flex: 1, display: 'flex', overflow: 'hidden' }
    },
      // Left panel: stock list + detail
      React.createElement('div', {
        style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: isCrypto ? '1px solid #1b2838' : '1px solid #18181b' }
      },
        // Stock detail view
        selectedStock
          ? React.createElement('div', {
              style: {
                padding: '16px',
                background: (selectedStock.sector === 'Crypto') ? '#0f1923' : '#252528',
                borderBottom: (selectedStock.sector === 'Crypto') ? '1px solid #1b2838' : '1px solid #18181b',
                flexShrink: 0
              }
            },
              React.createElement('div', {
                style: { display: 'flex', alignItems: 'flex-start', gap: '16px', marginBottom: '12px' }
              },
                // Back button
                React.createElement('button', {
                  style: {
                    background: '#4e5058', border: 'none', borderRadius: '4px',
                    color: '#dcddde', padding: '4px 10px', cursor: 'pointer',
                    fontSize: '12px', fontFamily: 'inherit', flexShrink: 0
                  },
                  onClick: function() { setSelectedStock(null); setTradeMsg(null); }
                }, '\u2190 Back'),
                selectedStock.img
                  ? React.createElement('img', {
                      src: selectedStock.img,
                      style: {
                        width: '48px', height: '48px', objectFit: 'contain', borderRadius: '8px', flexShrink: 0,
                        filter: selectedStock.sector === 'Crypto' ? 'drop-shadow(0 0 6px rgba(0,240,255,0.4))' : 'none'
                      }
                    })
                  : React.createElement('div', {
                      style: {
                        width: '48px', height: '48px', borderRadius: '8px', background: '#3a3a3e',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '24px', flexShrink: 0
                      }
                    }, '\uD83D\uDCC8'),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', {
                    style: {
                      color: selectedStock.sector === 'Crypto' ? '#e0f7ff' : '#dcddde',
                      fontSize: '18px', fontWeight: 700
                    }
                  }, selectedStock.name),
                  React.createElement('div', {
                    style: { color: '#949ba4', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }
                  },
                    selectedStock.id + (selectedStock.sector ? ' \u2022 ' : ''),
                    selectedStock.sector === 'Crypto'
                      ? React.createElement('span', {
                          style: { color: '#00f0ff', fontWeight: 600 }
                        }, '\u26A1 Crypto')
                      : (selectedStock.sector || ''),
                    // Volatility badge for crypto
                    selectedStock.sector === 'Crypto' && selectedStock.volatility
                      ? React.createElement('span', {
                          style: {
                            padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700,
                            background: getVolatilityLabel(selectedStock.volatility).color + '22',
                            color: getVolatilityLabel(selectedStock.volatility).color,
                            border: '1px solid ' + getVolatilityLabel(selectedStock.volatility).color + '44'
                          }
                        }, 'Volatility: ' + getVolatilityLabel(selectedStock.volatility).text)
                      : null
                  ),
                  React.createElement('div', { style: { display: 'flex', gap: '16px', marginTop: '4px', flexWrap: 'wrap', alignItems: 'center' } },
                    React.createElement('span', {
                      style: {
                        color: selectedStock.sector === 'Crypto' ? getCryptoPriceColor(selectedStock) : '#f0b232',
                        fontSize: selectedStock.sector === 'Crypto' ? '22px' : '20px',
                        fontWeight: 800
                      }
                    },
                      (selectedStock.price || 0).toLocaleString() + ' chips'
                    ),
                    React.createElement('span', {
                      style: {
                        color: (selectedStock.change || 0) >= 0 ? '#57f287' : '#ed4245',
                        fontSize: selectedStock.sector === 'Crypto' ? '16px' : '14px',
                        fontWeight: selectedStock.sector === 'Crypto' ? 800 : 600,
                        alignSelf: 'center'
                      }
                    },
                      ((selectedStock.change || 0) >= 0 ? '+' : '') + (selectedStock.change || 0).toFixed(1) +
                      ' (' + ((selectedStock.changePercent || 0) >= 0 ? '+' : '') + (selectedStock.changePercent || 0).toFixed(1) + '%)'
                    ),
                    // High/Low indicator (all stocks)
                    selectedStock.high != null ? React.createElement('span', { style: { color: '#949ba4', fontSize: '12px', alignSelf: 'center' } },
                      'H: ' + (selectedStock.high || 0).toLocaleString() + ' / L: ' + (selectedStock.low || 0).toLocaleString()
                    ) : null,
                    // VOLATILE badge for crypto with high volatility
                    (selectedStock.sector === 'Crypto' && selectedStock.volatility > 0.25)
                      ? React.createElement('span', {
                          style: {
                            padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 800,
                            background: 'rgba(237,66,69,0.15)', color: '#ff6b6b',
                            border: '1px solid rgba(237,66,69,0.3)',
                            letterSpacing: '1px'
                          }
                        }, '\u26A0 VOLATILE')
                      : null
                  )
                )
              ),
              // Sparkline chart
              selectedStock.history && selectedStock.history.length > 1
                ? React.createElement('div', {
                    style: {
                      background: selectedStock.sector === 'Crypto' ? '#0d1117' : '#1c1c1e',
                      borderRadius: '8px', padding: '8px', marginBottom: '12px',
                      border: selectedStock.sector === 'Crypto' ? '1px solid #1b2838' : 'none'
                    }
                  },
                    renderSparkline(
                      selectedStock.history, isMobile ? 280 : 400, 80,
                      selectedStock.sector === 'Crypto'
                        ? ((selectedStock.change || 0) >= 0 ? '#00f0ff' : '#ff4d6a')
                        : ((selectedStock.change || 0) >= 0 ? '#57f287' : '#ed4245')
                    )
                  )
                : null,
              // Trade form
              React.createElement('div', {
                'data-stock-trade-area': 'true',
                style: { display: 'flex', alignItems: isMobile ? 'stretch' : 'center', gap: '8px', flexWrap: 'wrap', flexDirection: isMobile ? 'column' : 'row', position: 'relative' }
              },
                React.createElement('span', { style: { color: '#949ba4', fontSize: '13px' } }, 'Shares:'),
                React.createElement('input', {
                  type: 'number', min: 1, value: tradeShares,
                  onChange: function(e) { setTradeShares(Math.max(1, parseInt(e.target.value) || 1)); },
                  style: {
                    width: isMobile ? '100%' : '70px', padding: isMobile ? '10px 8px' : '6px 8px',
                    background: selectedStock.sector === 'Crypto' ? '#0d1117' : '#1c1c1e',
                    border: selectedStock.sector === 'Crypto' ? '1px solid #1b2838' : '1px solid #4e5058',
                    borderRadius: '6px',
                    color: '#dcddde', fontSize: isMobile ? '16px' : '13px', fontFamily: 'inherit', textAlign: 'center'
                  }
                }),
                React.createElement('span', { style: { color: '#949ba4', fontSize: '12px' } },
                  'Cost: ' + (tradeShares * (selectedStock.price || 0)).toLocaleString()
                ),
                React.createElement('button', {
                  style: {
                    padding: isMobile ? '12px 18px' : '6px 18px',
                    background: selectedStock.sector === 'Crypto' ? '#00b4d8' : '#57f287',
                    border: 'none', borderRadius: '6px',
                    color: selectedStock.sector === 'Crypto' ? '#ffffff' : '#1c1c1e',
                    fontSize: isMobile ? '16px' : '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    minHeight: isMobile ? '44px' : 'auto'
                  },
                  onClick: function() { buyStock(selectedStock.id); }
                }, 'Buy'),
                React.createElement('button', {
                  style: {
                    padding: isMobile ? '12px 18px' : '6px 18px',
                    background: selectedStock.sector === 'Crypto' ? '#ff4d6a' : '#ed4245',
                    border: 'none', borderRadius: '6px',
                    color: '#ffffff', fontSize: isMobile ? '16px' : '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                    minHeight: isMobile ? '44px' : 'auto'
                  },
                  onClick: function() { sellStock(selectedStock.id); }
                }, 'Sell'),
                tradeMsg ? React.createElement('span', {
                  style: { color: tradeMsgColor, fontSize: '12px', fontWeight: 600 }
                }, tradeMsg) : null
              )
            )
          : null,

        // Stock list
        React.createElement('div', {
          style: { flex: 1, overflow: 'auto', padding: '0' }
        },
          // Table header
          React.createElement('div', {
            style: {
              display: 'grid', gridTemplateColumns: isMobile ? '32px 1fr 70px 60px' : '32px 60px 1fr 90px 80px 60px',
              gap: '8px', padding: '8px 12px',
              background: isCrypto ? '#0f1923' : '#252528',
              borderBottom: isCrypto ? '1px solid #1b2838' : '1px solid #18181b',
              position: 'sticky', top: 0, zIndex: 1, alignItems: 'center'
            }
          },
            React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700 } }, ''),
            !isMobile ? React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700 } }, isCrypto ? 'COIN' : 'TICKER') : null,
            React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700 } }, 'NAME'),
            React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700, textAlign: 'right' } }, 'PRICE'),
            React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700, textAlign: 'right' } }, 'CHANGE'),
            !isMobile ? React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700, textAlign: 'right' } }, 'CHART') : null
          ),
          filteredStocks.map(function(stock) {
            var chgColor = (stock.change || 0) >= 0 ? (stock.sector === 'Crypto' ? '#00f0ff' : '#57f287') : (stock.sector === 'Crypto' ? '#ff4d6a' : '#ed4245');
            var isSelected = selectedStock && selectedStock.id === stock.id;
            var isCryptoRow = stock.sector === 'Crypto';
            var isVolatile = isCryptoRow && stock.volatility > 0.25;
            // Pulsing border color for crypto rows based on movement
            var cryptoBorderColor = isCryptoRow
              ? ((stock.change || 0) >= 0 ? 'rgba(0,240,255,0.25)' : 'rgba(255,77,106,0.25)')
              : 'transparent';
            var rowBg = isSelected
              ? (isCryptoRow ? '#162231' : '#3a3a3e')
              : (isCryptoRow ? '#0d1117' : 'transparent');
            var hoverBg = isCryptoRow ? '#131d2b' : '#2a2a2e';

            return React.createElement('div', {
              key: stock.id,
              style: {
                display: 'grid', gridTemplateColumns: isMobile ? '32px 1fr 70px 60px' : '32px 60px 1fr 90px 80px 60px',
                gap: '8px', padding: '8px 12px', cursor: 'pointer',
                background: rowBg,
                borderBottom: isCryptoRow ? '1px solid #1b2838' : '1px solid #2a2a2e',
                borderLeft: isCryptoRow ? '2px solid ' + cryptoBorderColor : '2px solid transparent',
                alignItems: 'center',
                transition: 'background 0.1s, border-color 0.3s'
              },
              onClick: function() { setSelectedStock(stock); setTradeShares(1); setTradeMsg(null); },
              onMouseEnter: function(e) { if (!isSelected) e.currentTarget.style.background = hoverBg; },
              onMouseLeave: function(e) { if (!isSelected) e.currentTarget.style.background = rowBg; }
            },
              stock.img
                ? React.createElement('img', {
                    src: stock.img,
                    style: {
                      width: '32px', height: '32px', objectFit: 'contain', borderRadius: '4px',
                      filter: isCryptoRow ? 'drop-shadow(0 0 4px rgba(0,240,255,0.3))' : 'none'
                    }
                  })
                : React.createElement('div', {
                    style: { width: '32px', height: '32px', borderRadius: '4px', background: '#3a3a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }
                  }, '\uD83D\uDCC8'),
              !isMobile ? React.createElement('span', {
                style: {
                  color: isCryptoRow ? '#00f0ff' : '#f0b232',
                  fontSize: '12px', fontWeight: 700, fontFamily: 'monospace'
                }
              }, stock.id) : null,
              React.createElement('div', {
                style: { display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden', minWidth: 0 }
              },
                React.createElement('span', {
                  style: {
                    color: isCryptoRow ? '#e0f7ff' : '#dcddde',
                    fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }
                }, stock.name),
                isVolatile
                  ? React.createElement('span', {
                      style: {
                        padding: '0px 4px', borderRadius: '3px', fontSize: '9px', fontWeight: 800,
                        background: 'rgba(237,66,69,0.15)', color: '#ff6b6b',
                        border: '1px solid rgba(237,66,69,0.25)',
                        flexShrink: 0, letterSpacing: '0.5px', lineHeight: '16px'
                      }
                    }, '\u26A0')
                  : null
              ),
              React.createElement('span', {
                style: {
                  color: isCryptoRow ? getCryptoPriceColor(stock) : '#dcddde',
                  fontSize: '13px', fontWeight: 600, textAlign: 'right', fontFamily: 'monospace'
                }
              },
                (stock.price || 0).toLocaleString()
              ),
              React.createElement('span', {
                style: {
                  color: chgColor,
                  fontSize: isCryptoRow ? '12px' : '12px',
                  fontWeight: isCryptoRow ? 800 : 600,
                  textAlign: 'right', fontFamily: 'monospace'
                }
              },
                ((stock.change || 0) >= 0 ? '+' : '') + (stock.change || 0).toFixed(1) +
                ' (' + ((stock.changePercent || 0) >= 0 ? '+' : '') + (stock.changePercent || 0).toFixed(1) + '%)'
              ),
              !isMobile ? React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
                renderSparkline(stock.history, 56, 24, chgColor)
              ) : null
            );
          })
        )
      ),

      // Right panel: News feed
      React.createElement('div', {
        style: {
          width: '280px', display: isMobile ? 'none' : 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
          background: isCrypto ? '#0d1117' : 'transparent'
        }
      },
        React.createElement('div', {
          style: {
            padding: '10px 12px',
            background: isCrypto ? '#0f1923' : '#252528',
            borderBottom: isCrypto ? '1px solid #1b2838' : '1px solid #18181b',
            flexShrink: 0
          }
        },
          React.createElement('span', {
            style: { color: isCrypto ? '#00f0ff' : '#f0b232', fontSize: '13px', fontWeight: 700 }
          }, isCrypto ? '\u26A1 Crypto Feed' : '\uD83D\uDCF0 Market News')
        ),
        React.createElement('div', {
          style: { flex: 1, overflow: 'auto', padding: '8px' }
        },
          filteredEvents.length === 0
            ? React.createElement('div', { style: { color: '#949ba4', fontSize: '12px', padding: '12px', textAlign: 'center' } },
                isCrypto ? 'No crypto news yet. Wild events will appear here.' : 'No news yet. Market events will appear here.'
              )
            : filteredEvents.slice(0, 20).map(function(evt, idx) {
                // Determine if this event is crypto-related
                var isCryptoEvt = evt.affectedStocks && evt.affectedStocks.some(function(id) { return cryptoStockIds[id]; });
                var evtColor = (evt.type === 'boom' || evt.type === 'sector_boom' || evt.type === 'market_boom')
                  ? (isCryptoEvt ? '#00f0ff' : '#57f287')
                  : (evt.type === 'crash' || evt.type === 'sector_crash' || evt.type === 'market_crash')
                    ? (isCryptoEvt ? '#ff4d6a' : '#ed4245')
                    : '#949ba4';
                var isRare = !!evt.rare;
                return React.createElement('div', {
                  key: evt.id || idx,
                  style: {
                    padding: '8px 10px', marginBottom: '6px', borderRadius: '6px',
                    background: isCryptoEvt ? '#0f1923' : '#252528',
                    borderLeft: '3px solid ' + evtColor,
                    border: isRare ? ('1px solid ' + evtColor + '44') : undefined,
                    borderLeftWidth: '3px', borderLeftStyle: 'solid', borderLeftColor: evtColor
                  }
                },
                  React.createElement('div', {
                    style: {
                      color: evtColor, fontSize: '12px', fontWeight: isRare ? 800 : 600, marginBottom: '2px',
                      textShadow: (isCryptoEvt && isRare) ? '0 0 8px ' + evtColor + '66' : 'none'
                    }
                  },
                    evt.text
                  ),
                  evt.affectedStocks && evt.affectedStocks.length > 0
                    ? React.createElement('div', { style: { color: isCryptoEvt ? '#5e8aa8' : '#949ba4', fontSize: '10px' } },
                        'Affects: ' + evt.affectedStocks.join(', ')
                      )
                    : null,
                  evt.timestamp
                    ? React.createElement('div', { style: { color: '#6b6f76', fontSize: '10px', marginTop: '2px' } },
                        new Date(evt.timestamp).toLocaleTimeString()
                      )
                    : null
                );
              })
        )
      )
    ),

    // Bottom: Holdings table
    React.createElement('div', {
      style: {
        flexShrink: 0, maxHeight: '200px', overflow: 'auto',
        borderTop: isCrypto ? '1px solid #1b2838' : '1px solid #18181b',
        background: isCrypto ? '#0f1923' : '#252528'
      }
    },
      React.createElement('div', {
        style: { padding: '8px 12px', borderBottom: isCrypto ? '1px solid #1b2838' : '1px solid #18181b' }
      },
        React.createElement('span', {
          style: { color: isCrypto ? '#00f0ff' : '#f0b232', fontSize: '13px', fontWeight: 700 }
        }, '\uD83D\uDCBC Holdings')
      ),
      portfolio && portfolio.holdings && portfolio.holdings.length > 0
        ? React.createElement('div', null,
            // Holdings header
            React.createElement('div', {
              style: {
                display: 'grid', gridTemplateColumns: isMobile ? '32px 1fr 50px 70px' : '32px 60px 1fr 70px 70px 80px 80px 80px',
                gap: '6px', padding: '6px 12px',
                borderBottom: isCrypto ? '1px solid #1b2838' : '1px solid #1c1c1e',
                alignItems: 'center'
              }
            },
              React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700 } }, ''),
              !isMobile ? React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700 } }, 'STOCK') : null,
              React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700 } }, 'NAME'),
              React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700, textAlign: 'right' } }, 'SHARES'),
              !isMobile ? React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700, textAlign: 'right' } }, 'AVG COST') : null,
              !isMobile ? React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700, textAlign: 'right' } }, 'VALUE') : null,
              !isMobile ? React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700, textAlign: 'right' } }, 'COST') : null,
              React.createElement('span', { style: { color: isCrypto ? '#5e8aa8' : '#949ba4', fontSize: '10px', fontWeight: 700, textAlign: 'right' } }, 'P/L')
            ),
            portfolio.holdings.map(function(h) {
              var plColor = (h.profit || 0) >= 0 ? '#57f287' : '#ed4245';
              var plSign = (h.profit || 0) >= 0 ? '+' : '';
              var isHoldingCrypto = h.sector === 'Crypto';
              return React.createElement('div', {
                key: h.stockId,
                style: {
                  display: 'grid', gridTemplateColumns: isMobile ? '32px 1fr 50px 70px' : '32px 60px 1fr 70px 70px 80px 80px 80px',
                  gap: '6px', padding: '6px 12px',
                  borderBottom: isCrypto ? '1px solid #1b2838' : '1px solid #1c1c1e',
                  alignItems: 'center', cursor: 'pointer',
                  borderLeft: isHoldingCrypto ? '2px solid rgba(0,240,255,0.2)' : '2px solid transparent'
                },
                onClick: function() {
                  var s = stocks.find(function(st) { return st.id === h.stockId; });
                  if (s) {
                    // Switch to appropriate tab when clicking a holding
                    if (s.sector === 'Crypto') setMarketTab('crypto');
                    else if (s.sector === 'Penny') setMarketTab('penny');
                    else setMarketTab('stocks');
                    setSelectedStock(s); setTradeShares(1); setTradeMsg(null);
                  }
                },
                onMouseEnter: function(e) { e.currentTarget.style.background = isCrypto ? '#131d2b' : '#2a2a2e'; },
                onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
              },
                h.img
                  ? React.createElement('img', {
                      src: h.img,
                      style: {
                        width: '24px', height: '24px', objectFit: 'contain', borderRadius: '4px',
                        filter: isHoldingCrypto ? 'drop-shadow(0 0 3px rgba(0,240,255,0.3))' : 'none'
                      }
                    })
                  : React.createElement('div', { style: { width: '24px', height: '24px', borderRadius: '4px', background: '#3a3a3e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' } }, '\uD83D\uDCC8'),
                !isMobile ? React.createElement('span', {
                  style: { color: isHoldingCrypto ? '#00f0ff' : '#f0b232', fontSize: '11px', fontWeight: 700, fontFamily: 'monospace' }
                }, h.stockId) : null,
                React.createElement('span', {
                  style: { color: isHoldingCrypto ? '#e0f7ff' : '#dcddde', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                }, h.name),
                React.createElement('span', { style: { color: '#dcddde', fontSize: '12px', textAlign: 'right', fontFamily: 'monospace' } }, h.shares),
                !isMobile ? React.createElement('span', { style: { color: '#949ba4', fontSize: '12px', textAlign: 'right', fontFamily: 'monospace' } }, (h.avgCost || 0).toLocaleString()) : null,
                !isMobile ? React.createElement('span', { style: { color: '#dcddde', fontSize: '12px', textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' } }, (h.currentValue || 0).toLocaleString()) : null,
                !isMobile ? React.createElement('span', { style: { color: '#949ba4', fontSize: '12px', textAlign: 'right', fontFamily: 'monospace' } }, (h.costBasis || 0).toLocaleString()) : null,
                React.createElement('span', { style: { color: plColor, fontSize: '12px', textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' } },
                  plSign + (h.profit || 0).toLocaleString() + ' (' + plSign + (h.profitPercent || 0).toFixed(1) + '%)'
                )
              );
            })
          )
        : React.createElement('div', { style: { color: '#949ba4', fontSize: '12px', padding: '12px', textAlign: 'center' } },
            isCrypto ? 'No crypto holdings yet. Buy coins to see them here!' : 'No holdings yet. Buy stocks to see them here!'
          )
    )
  );
}

// ---------- Auction House View ----------
function AuctionHouseView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectMarket(); }, []);
  var sock = ctx.marketSocket || ctx.socket;
  var [tab, setTab] = useState('browse');
  var [listings, setListings] = useState([]);
  var [filterType, setFilterType] = useState('');
  var [filterRarity, setFilterRarity] = useState('');
  var [filterSort, setFilterSort] = useState('newest');
  var [searchText, setSearchText] = useState('');
  var [myItems, setMyItems] = useState([]);
  var [myCards, setMyCards] = useState([]);
  var [sellItem, setSellItem] = useState(null);
  var [sellPrice, setSellPrice] = useState('');
  var [statusMsg, setStatusMsg] = useState(null);
  var [statusColor, setStatusColor] = useState('#57f287');
  var [buying, setBuying] = useState(null);

  function showStatus(msg, color) {
    setStatusMsg(msg);
    setStatusColor(color || '#57f287');
    setTimeout(function() { setStatusMsg(null); }, 3500);
  }

  function fetchListings() {
    if (!sock) return;
    var filters = { sortBy: filterSort };
    if (filterType) filters.itemType = filterType;
    if (filterRarity) filters.rarity = filterRarity;
    if (searchText) filters.search = searchText;
    sock.emit('auction_get_listings', filters);
  }

  useEffect(function() {
    if (!sock) return;
    fetchListings();

    function onListings(data) {
      setListings(data.listings || []);
    }
    function onListingsUpdated() {
      fetchListings();
    }
    function onListingCreated(data) {
      showStatus(data.message || 'Listing created!', '#57f287');
      if (window.BossSounds) window.BossSounds.play('notification');
      setSellItem(null);
      setSellPrice('');
      fetchListings();
      // Refresh inventory via default namespace
      if (ctx.socket) {
        ctx.socket.emit('inventory_get');
        ctx.socket.emit('tcg_cards_get');
      }
    }
    function onBuySuccess(data) {
      setBuying(null);
      showStatus(data.message || 'Purchase successful!', '#57f287');
      if (window.BossSounds) window.BossSounds.play('win_small');
      // Brief gold flash on the auction panel
      if (window.BossEffects) {
        var auctionPanel = document.querySelector('[data-auction-panel]');
        if (auctionPanel) window.BossEffects.flashOverlay(auctionPanel, 'rgba(240,178,50,0.15)', 400);
      }
      fetchListings();
    }
    function onItemSold(data) {
      showStatus(data.message || 'Your item was sold!', '#f0b232');
      if (window.BossSounds) window.BossSounds.play('coin');
      fetchListings();
    }
    function onCancelled(data) {
      showStatus(data.message || 'Listing cancelled.', '#949ba4');
      fetchListings();
      // Refresh inventory via default namespace
      if (ctx.socket) {
        ctx.socket.emit('inventory_get');
        ctx.socket.emit('tcg_cards_get');
      }
    }
    function onInventory(data) {
      setMyItems(data.inventory || []);
    }
    function onCards(data) {
      setMyCards(data.cards || []);
    }
    function onError(data) {
      setBuying(null);
      showStatus(data.error || 'Something went wrong.', '#ed4245');
      if (window.BossSounds) window.BossSounds.play('loss');
    }

    sock.on('auction_listings', onListings);
    sock.on('auction_listings_updated', onListingsUpdated);
    sock.on('auction_listing_created', onListingCreated);
    sock.on('auction_buy_success', onBuySuccess);
    sock.on('auction_item_sold', onItemSold);
    sock.on('auction_listing_cancelled', onCancelled);
    sock.on('auction_error', onError);
    // inventory_data and tcg_cards_data come from default namespace
    if (ctx.socket) {
      ctx.socket.on('inventory_data', onInventory);
      ctx.socket.on('tcg_cards_data', onCards);
    }
    return function() {
      sock.off('auction_listings', onListings);
      sock.off('auction_listings_updated', onListingsUpdated);
      sock.off('auction_listing_created', onListingCreated);
      sock.off('auction_buy_success', onBuySuccess);
      sock.off('auction_item_sold', onItemSold);
      sock.off('auction_listing_cancelled', onCancelled);
      sock.off('auction_error', onError);
      if (ctx.socket) {
        ctx.socket.off('inventory_data', onInventory);
        ctx.socket.off('tcg_cards_data', onCards);
      }
    };
  }, [sock, ctx.socket]);

  // Re-fetch when filters change
  useEffect(function() {
    fetchListings();
  }, [filterType, filterRarity, filterSort, searchText]);

  // Load inventory when switching to Sell tab (inventory is on default namespace)
  useEffect(function() {
    if (tab === 'sell' && ctx.socket) {
      ctx.socket.emit('inventory_get');
      ctx.socket.emit('tcg_cards_get');
    }
  }, [tab, ctx.socket]);

  function createListing() {
    if (!sock || !sellItem || !sellPrice) return;
    var price = parseInt(sellPrice);
    if (isNaN(price) || price < 1) { showStatus('Enter a valid price.', '#ed4245'); return; }
    sock.emit('auction_create_listing', {
      instanceId: sellItem.id,
      itemType: sellItem._auctionType,
      price: price
    });
  }

  function buyListing(listingId) {
    if (!sock || buying) return;
    setBuying(listingId);
    sock.emit('auction_buy', { listingId: listingId });
  }

  function cancelListing(listingId) {
    if (!sock) return;
    sock.emit('auction_cancel_listing', { listingId: listingId });
  }

  var panelStyle = { flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e', overflow: 'hidden' };

  var tabBtnStyle = function(active) {
    return {
      padding: '8px 20px', border: 'none', borderBottom: active ? '2px solid #f0b232' : '2px solid transparent',
      background: 'transparent', color: active ? '#f0b232' : '#949ba4',
      fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      transition: 'color 0.15s, border-color 0.15s'
    };
  };

  var rarityColor = function(r) {
    return r === 'legendary' ? '#f0b232' : r === 'epic' ? '#9b59b6' : r === 'rare' ? '#5865f2' : r === 'uncommon' ? '#57f287' : '#9e9e9e';
  };

  // Render a single listing card
  function renderListingCard(listing) {
    var info = listing.itemInfo || {};
    var rc = rarityColor(info.rarity);
    var isOwn = listing.isOwn;
    return React.createElement('div', {
      key: listing.id,
      style: {
        background: '#252528', borderRadius: '10px', border: '1px solid ' + rc,
        padding: '14px', display: 'flex', flexDirection: 'column', gap: '8px',
        minWidth: '180px', maxWidth: '220px', flex: '1 1 180px'
      }
    },
      // Item image
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '64px' }
      },
        info.img
          ? React.createElement('img', { src: info.img, style: { width: '56px', height: '56px', objectFit: 'contain' } })
          : React.createElement('div', { style: { fontSize: '36px' } }, info.icon || '\uD83D\uDCE6')
      ),
      // Name and rarity
      React.createElement('div', { style: { color: '#dcddde', fontSize: '14px', fontWeight: 700, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
        info.modifierInfo ? React.createElement('span', { style: { color: info.modifierInfo.color || '#dcddde' } }, info.modifierInfo.name + ' ') : null,
        info.name || 'Unknown'
      ),
      info.serial ? React.createElement('div', { style: { color: '#6b6f76', fontSize: '10px', fontFamily: 'monospace', textAlign: 'center' } }, info.serial) : null,
      React.createElement('div', { style: { color: rc, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', textAlign: 'center' } }, info.rarity || ''),
      // Type
      React.createElement('div', { style: { color: '#949ba4', fontSize: '11px', textAlign: 'center' } },
        listing.itemType === 'card' ? 'TCG Card' : (info.type || 'Item')
      ),
      // Stats for cards
      listing.itemType === 'card' && (info.atk != null || info.def != null || info.hp != null)
        ? React.createElement('div', { style: { display: 'flex', justifyContent: 'center', gap: '8px', fontSize: '11px' } },
            info.atk != null ? React.createElement('span', { style: { color: '#ed4245', fontWeight: 700 } }, 'ATK ' + info.atk) : null,
            info.def != null ? React.createElement('span', { style: { color: '#5865f2', fontWeight: 700 } }, 'DEF ' + info.def) : null,
            info.hp != null ? React.createElement('span', { style: { color: '#57f287', fontWeight: 700 } }, 'HP ' + info.hp) : null
          )
        : null,
      // Seller
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'center' } },
        React.createElement('span', { style: { color: '#949ba4', fontSize: '11px' } }, 'by'),
        React.createElement('span', { style: { color: listing.sellerColor || '#dcddde', fontSize: '11px', fontWeight: 600 } }, listing.sellerName || 'Unknown')
      ),
      // Price
      React.createElement('div', { style: { color: '#f0b232', fontSize: '16px', fontWeight: 800, textAlign: 'center' } },
        (listing.price || 0).toLocaleString() + ' chips'
      ),
      // Buy or own indicator
      isOwn
        ? React.createElement('div', { style: { color: '#949ba4', fontSize: '11px', textAlign: 'center', fontStyle: 'italic' } }, 'Your listing')
        : React.createElement('button', {
            style: {
              padding: '6px 16px', background: buying === listing.id ? '#3a6e3a' : '#57f287',
              border: 'none', borderRadius: '6px', color: '#1c1c1e', fontSize: '13px',
              fontWeight: 700, cursor: buying === listing.id ? 'default' : 'pointer',
              fontFamily: 'inherit', transition: 'background 0.15s', alignSelf: 'center'
            },
            onClick: function() { buyListing(listing.id); },
            disabled: buying === listing.id
          }, buying === listing.id ? 'Buying...' : 'Buy')
    );
  }

  // Browse tab
  function renderBrowse() {
    return React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      // Filter bar
      React.createElement('div', {
        style: {
          display: 'flex', gap: '8px', padding: '10px 14px', background: '#252528',
          borderBottom: '1px solid #18181b', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0
        }
      },
        React.createElement('select', {
          value: filterType,
          onChange: function(e) { setFilterType(e.target.value); },
          style: {
            padding: '5px 8px', background: '#1c1c1e', border: '1px solid #4e5058',
            borderRadius: '6px', color: '#dcddde', fontSize: '12px', fontFamily: 'inherit'
          }
        },
          React.createElement('option', { value: '' }, 'All Types'),
          React.createElement('option', { value: 'item' }, 'Items'),
          React.createElement('option', { value: 'card' }, 'Cards')
        ),
        React.createElement('select', {
          value: filterRarity,
          onChange: function(e) { setFilterRarity(e.target.value); },
          style: {
            padding: '5px 8px', background: '#1c1c1e', border: '1px solid #4e5058',
            borderRadius: '6px', color: '#dcddde', fontSize: '12px', fontFamily: 'inherit'
          }
        },
          React.createElement('option', { value: '' }, 'All Rarities'),
          React.createElement('option', { value: 'common' }, 'Common'),
          React.createElement('option', { value: 'uncommon' }, 'Uncommon'),
          React.createElement('option', { value: 'rare' }, 'Rare'),
          React.createElement('option', { value: 'epic' }, 'Epic'),
          React.createElement('option', { value: 'legendary' }, 'Legendary')
        ),
        React.createElement('select', {
          value: filterSort,
          onChange: function(e) { setFilterSort(e.target.value); },
          style: {
            padding: '5px 8px', background: '#1c1c1e', border: '1px solid #4e5058',
            borderRadius: '6px', color: '#dcddde', fontSize: '12px', fontFamily: 'inherit'
          }
        },
          React.createElement('option', { value: 'newest' }, 'Newest'),
          React.createElement('option', { value: 'price_low' }, 'Price: Low'),
          React.createElement('option', { value: 'price_high' }, 'Price: High'),
          React.createElement('option', { value: 'rarity' }, 'Rarity')
        ),
        React.createElement('input', {
          type: 'text', placeholder: 'Search...',
          value: searchText,
          onChange: function(e) { setSearchText(e.target.value); },
          style: {
            padding: '5px 10px', background: '#1c1c1e', border: '1px solid #4e5058',
            borderRadius: '6px', color: '#dcddde', fontSize: '12px', fontFamily: 'inherit',
            flex: '1 1 120px', minWidth: '100px'
          }
        })
      ),
      // Listings grid
      React.createElement('div', {
        style: { flex: 1, overflow: 'auto', padding: '14px' }
      },
        listings.length === 0
          ? React.createElement('div', { style: { color: '#949ba4', fontSize: '14px', textAlign: 'center', marginTop: '40px' } },
              'No listings found. Be the first to list something!'
            )
          : React.createElement('div', {
              style: { display: 'flex', flexWrap: 'wrap', gap: '14px', justifyContent: 'center' }
            },
              listings.map(function(listing) { return renderListingCard(listing); })
            )
      )
    );
  }

  // Sell tab
  function renderSell() {
    // Combine items and cards into sellable list
    var sellableItems = myItems.map(function(item) {
      return {
        id: item.instanceId || item.id,
        name: (item.info && item.info.name) || item.name || 'Unknown',
        rarity: (item.info && item.info.rarity) || item.rarity || 'common',
        type: (item.info && item.info.type) || item.type || 'item',
        img: (item.info && item.info.img) || item.img || null,
        icon: (item.info && item.info.icon) || item.icon || '\uD83D\uDCE6',
        coinValue: (item.info && item.info.coinValue) || item.coinValue || 0,
        modifier: item.modifier || null,
        modifierInfo: item.modifierInfo || null,
        serial: item.serial || null,
        _auctionType: 'item'
      };
    });
    var sellableCards = myCards.map(function(c) {
      var card = c.card || c;
      return {
        id: c.id || c.instanceId,
        name: card.name || 'Unknown Card',
        rarity: card.rarity || 'common',
        type: 'TCG Card - ' + (card.type || '?'),
        img: card.img || null,
        icon: card.icon || '\uD83D\uDC32',
        atk: card.atk, def: card.def, hp: card.hp,
        coinValue: card.coinValue || 0,
        _auctionType: 'card'
      };
    });
    var allSellable = sellableItems.concat(sellableCards);

    return React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      // Sell form if item selected
      sellItem
        ? React.createElement('div', {
            style: {
              padding: '16px', background: '#252528', borderBottom: '1px solid #18181b',
              display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', flexShrink: 0
            }
          },
            sellItem.img
              ? React.createElement('img', { src: sellItem.img, style: { width: '48px', height: '48px', objectFit: 'contain', borderRadius: '8px' } })
              : React.createElement('div', { style: { fontSize: '32px' } }, sellItem.icon || '\uD83D\uDCE6'),
            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
              React.createElement('div', { style: { color: '#dcddde', fontSize: '15px', fontWeight: 700 } },
                sellItem.modifierInfo ? React.createElement('span', { style: { color: sellItem.modifierInfo.color || '#dcddde' } }, sellItem.modifierInfo.name + ' ') : null,
                sellItem.name
              ),
              sellItem.serial ? React.createElement('div', { style: { color: '#6b6f76', fontSize: '10px', fontFamily: 'monospace' } }, sellItem.serial) : null,
              React.createElement('div', { style: { color: rarityColor(sellItem.rarity), fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' } }, sellItem.rarity),
              sellItem.coinValue ? React.createElement('div', { style: { color: '#949ba4', fontSize: '11px' } }, 'Auto-sell value: ' + sellItem.coinValue + ' chips') : null
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
              React.createElement('span', { style: { color: '#949ba4', fontSize: '13px' } }, 'Price:'),
              React.createElement('input', {
                type: 'number', min: 1, placeholder: 'chips',
                value: sellPrice,
                onChange: function(e) { setSellPrice(e.target.value); },
                style: {
                  width: '100px', padding: '6px 8px', background: '#1c1c1e',
                  border: '1px solid #4e5058', borderRadius: '6px',
                  color: '#dcddde', fontSize: '13px', fontFamily: 'inherit', textAlign: 'center'
                }
              }),
              React.createElement('button', {
                style: {
                  padding: '6px 18px', background: '#f0b232', border: 'none', borderRadius: '6px',
                  color: '#1c1c1e', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
                },
                onClick: function() { createListing(); }
              }, 'List for Sale'),
              React.createElement('button', {
                style: {
                  padding: '6px 12px', background: '#4e5058', border: 'none', borderRadius: '6px',
                  color: '#dcddde', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit'
                },
                onClick: function() { setSellItem(null); setSellPrice(''); }
              }, 'Cancel')
            )
          )
        : null,

      // Inventory grid
      React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: '14px' } },
        React.createElement('div', {
          style: { color: '#949ba4', fontSize: '12px', marginBottom: '10px' }
        }, 'Click an item to list it for sale (' + allSellable.length + ' items available)'),
        allSellable.length === 0
          ? React.createElement('div', { style: { color: '#949ba4', fontSize: '14px', textAlign: 'center', marginTop: '30px' } },
              'No items to sell. Open loot boxes or card packs first!'
            )
          : React.createElement('div', {
              style: { display: 'flex', flexWrap: 'wrap', gap: '10px' }
            },
              allSellable.map(function(item) {
                var rc = rarityColor(item.rarity);
                var isActive = sellItem && sellItem.id === item.id;
                return React.createElement('div', {
                  key: item._auctionType + '-' + item.id,
                  style: {
                    background: isActive ? '#3a3a3e' : '#252528', borderRadius: '8px',
                    border: '1px solid ' + (isActive ? '#f0b232' : rc),
                    padding: '10px', width: '120px', textAlign: 'center',
                    cursor: 'pointer', transition: 'border-color 0.15s, transform 0.15s'
                  },
                  onClick: function() { setSellItem(item); setSellPrice(String(item.coinValue || 10)); },
                  onMouseEnter: function(e) { e.currentTarget.style.transform = 'translateY(-2px)'; },
                  onMouseLeave: function(e) { e.currentTarget.style.transform = 'translateY(0)'; }
                },
                  item.img
                    ? React.createElement('img', { src: item.img, style: { width: '40px', height: '40px', objectFit: 'contain', marginBottom: '4px' } })
                    : React.createElement('div', { style: { fontSize: '28px', marginBottom: '4px' } }, item.icon || '\uD83D\uDCE6'),
                  React.createElement('div', { style: { color: '#dcddde', fontSize: '11px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                    item.modifierInfo ? React.createElement('span', { style: { color: item.modifierInfo.color || '#dcddde' } }, item.modifierInfo.name + ' ') : null,
                    item.name
                  ),
                  item.serial ? React.createElement('div', { style: { color: '#6b6f76', fontSize: '8px', fontFamily: 'monospace' } }, item.serial) : null,
                  React.createElement('div', { style: { color: rc, fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' } }, item.rarity),
                  React.createElement('div', { style: { color: '#949ba4', fontSize: '9px' } }, item._auctionType === 'card' ? 'Card' : item.type)
                );
              })
            )
      )
    );
  }

  // My Listings tab
  function renderMyListings() {
    var mine = listings.filter(function(l) { return l.isOwn; });
    return React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: '14px' } },
      mine.length === 0
        ? React.createElement('div', { style: { color: '#949ba4', fontSize: '14px', textAlign: 'center', marginTop: '40px' } },
            'You have no active listings.'
          )
        : React.createElement('div', {
            style: { display: 'flex', flexDirection: 'column', gap: '8px' }
          },
            mine.map(function(listing) {
              var info = listing.itemInfo || {};
              var rc = rarityColor(info.rarity);
              return React.createElement('div', {
                key: listing.id,
                style: {
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
                  background: '#252528', borderRadius: '8px', border: '1px solid ' + rc
                }
              },
                info.img
                  ? React.createElement('img', { src: info.img, style: { width: '40px', height: '40px', objectFit: 'contain', borderRadius: '6px', flexShrink: 0 } })
                  : React.createElement('div', { style: { fontSize: '28px', flexShrink: 0 } }, info.icon || '\uD83D\uDCE6'),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', { style: { color: '#dcddde', fontSize: '14px', fontWeight: 700 } },
                    info.modifierInfo ? React.createElement('span', { style: { color: info.modifierInfo.color || '#dcddde' } }, info.modifierInfo.name + ' ') : null,
                    info.name || 'Unknown'
                  ),
                  info.serial ? React.createElement('div', { style: { color: '#6b6f76', fontSize: '10px', fontFamily: 'monospace' } }, info.serial) : null,
                  React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                    React.createElement('span', { style: { color: rc, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' } }, info.rarity || ''),
                    React.createElement('span', { style: { color: '#949ba4', fontSize: '10px' } }, listing.itemType === 'card' ? 'TCG Card' : (info.type || 'Item'))
                  )
                ),
                React.createElement('div', { style: { color: '#f0b232', fontSize: '16px', fontWeight: 800, flexShrink: 0 } },
                  (listing.price || 0).toLocaleString() + ' chips'
                ),
                listing.listedAt
                  ? React.createElement('div', { style: { color: '#6b6f76', fontSize: '10px', flexShrink: 0 } },
                      new Date(listing.listedAt).toLocaleString()
                    )
                  : null,
                React.createElement('button', {
                  style: {
                    padding: '6px 14px', background: '#ed4245', border: 'none', borderRadius: '6px',
                    color: '#ffffff', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'inherit', flexShrink: 0
                  },
                  onClick: function() { cancelListing(listing.id); }
                }, 'Cancel')
              );
            })
          )
    );
  }

  return React.createElement('div', { 'data-auction-panel': 'true', style: panelStyle },
    // Tab bar
    React.createElement('div', {
      style: {
        display: 'flex', background: '#252528', borderBottom: '1px solid #18181b', flexShrink: 0
      }
    },
      React.createElement('button', { style: tabBtnStyle(tab === 'browse'), onClick: function() { setTab('browse'); } }, 'Browse'),
      React.createElement('button', { style: tabBtnStyle(tab === 'sell'), onClick: function() { setTab('sell'); } }, 'Sell'),
      React.createElement('button', { style: tabBtnStyle(tab === 'my'), onClick: function() { setTab('my'); fetchListings(); } }, 'My Listings'),
      // Status message
      statusMsg ? React.createElement('div', {
        style: { marginLeft: 'auto', padding: '8px 14px', color: statusColor, fontSize: '12px', fontWeight: 600, alignSelf: 'center' }
      }, statusMsg) : null
    ),

    // Tab content
    tab === 'browse' ? renderBrowse()
      : tab === 'sell' ? renderSell()
      : renderMyListings()
  );
}

// ===================== CLICKER IDLE GAME =====================

var CLICKER_UPGRADES = [
  { id: 'clickPower', name: 'Click Power', desc: 'Chips earned per click', baseCost: 10, costMult: 1.5, baseValue: 1, valueMult: 1 },
  { id: 'autoClick', name: 'Auto Clicker', desc: 'Chips earned per second', baseCost: 50, costMult: 1.6, baseValue: 0, valueMult: 0.5 },
  { id: 'idleIncome', name: 'Idle Income', desc: 'Chips per second while offline', baseCost: 200, costMult: 1.8, baseValue: 0, valueMult: 0.2 },
  { id: 'clickMulti', name: 'Click Multiplier', desc: 'Multiply all click income', baseCost: 500, costMult: 2.0, baseValue: 1, valueMult: 0.25 },
  { id: 'autoMulti', name: 'Auto Multiplier', desc: 'Multiply all auto income', baseCost: 1000, costMult: 2.2, baseValue: 1, valueMult: 0.2 },
  { id: 'critChance', name: 'Lucky Strike', desc: 'Chance for 5x critical click', baseCost: 300, costMult: 1.9, baseValue: 0, valueMult: 0.06 },
  { id: 'clickFrenzy', name: 'Click Frenzy', desc: 'Bonus clicks per click', baseCost: 750, costMult: 2.0, baseValue: 0, valueMult: 1 },
  { id: 'goldRush', name: 'Gold Rush', desc: 'Bonus % on all income', baseCost: 2000, costMult: 2.5, baseValue: 0, valueMult: 0.10 },
  { id: 'offlineCap', name: 'Offline Vault', desc: 'Max offline hours (base 24)', baseCost: 5000, costMult: 3.0, baseValue: 24, valueMult: 12 },
  { id: 'megaClick', name: 'Mega Click', desc: 'Chance for 25x mega click', baseCost: 10000, costMult: 3.0, baseValue: 0, valueMult: 0.04 },
  { id: 'diamondTouch', name: 'Diamond Touch', desc: 'Flat bonus chips per click', baseCost: 3000, costMult: 1.7, baseValue: 0, valueMult: 5 },
  { id: 'turboAuto', name: 'Turbo Engine', desc: 'Flat bonus chips per second', baseCost: 4000, costMult: 1.8, baseValue: 0, valueMult: 2 },
  { id: 'comboStrike', name: 'Combo Strike', desc: 'Chance for 10x combo click', baseCost: 6000, costMult: 2.2, baseValue: 0, valueMult: 0.06 },
  { id: 'passiveGain', name: 'Passive Fortune', desc: 'Bonus % to idle income', baseCost: 8000, costMult: 2.0, baseValue: 0, valueMult: 0.15 },
  { id: 'clickStorm', name: 'Click Storm', desc: 'Extra burst clicks per tap', baseCost: 15000, costMult: 2.5, baseValue: 0, valueMult: 1 },
  { id: 'treasureHunt', name: 'Treasure Hunter', desc: 'Chance for 50x jackpot click', baseCost: 25000, costMult: 3.2, baseValue: 0, valueMult: 0.02 },
  { id: 'overcharge', name: 'Overcharge', desc: 'Multiply ALL income sources', baseCost: 50000, costMult: 3.5, baseValue: 1, valueMult: 0.15 },
  { id: 'infiniteLoop', name: 'Infinite Loop', desc: 'Auto-clicker speed multiplier', baseCost: 100000, costMult: 4.0, baseValue: 1, valueMult: 0.5 },
];

function clickerUpgradeCost(upgrade, level) {
  return Math.floor(upgrade.baseCost * Math.pow(upgrade.costMult, level));
}

function clickerUpgradeValue(upgrade, level) {
  return upgrade.baseValue + upgrade.valueMult * level;
}

function clickerCalcStats(levels) {
  var cpVal = clickerUpgradeValue(CLICKER_UPGRADES[0], levels.clickPower || 0);
  var acVal = clickerUpgradeValue(CLICKER_UPGRADES[1], levels.autoClick || 0);
  var idleVal = clickerUpgradeValue(CLICKER_UPGRADES[2], levels.idleIncome || 0);
  var cmVal = clickerUpgradeValue(CLICKER_UPGRADES[3], levels.clickMulti || 0);
  var amVal = clickerUpgradeValue(CLICKER_UPGRADES[4], levels.autoMulti || 0);
  var critChance = clickerUpgradeValue(CLICKER_UPGRADES[5], levels.critChance || 0);
  var frenzyClicks = clickerUpgradeValue(CLICKER_UPGRADES[6], levels.clickFrenzy || 0);
  var goldRushBonus = clickerUpgradeValue(CLICKER_UPGRADES[7], levels.goldRush || 0);
  var offlineCapHrs = clickerUpgradeValue(CLICKER_UPGRADES[8], levels.offlineCap || 0);
  var megaChance = clickerUpgradeValue(CLICKER_UPGRADES[9], levels.megaClick || 0);
  // New upgrades (indices 10-17)
  var diamondFlat = clickerUpgradeValue(CLICKER_UPGRADES[10], levels.diamondTouch || 0);
  var turboFlat = clickerUpgradeValue(CLICKER_UPGRADES[11], levels.turboAuto || 0);
  var comboChance = clickerUpgradeValue(CLICKER_UPGRADES[12], levels.comboStrike || 0);
  var passiveBonus = clickerUpgradeValue(CLICKER_UPGRADES[13], levels.passiveGain || 0);
  var stormClicks = clickerUpgradeValue(CLICKER_UPGRADES[14], levels.clickStorm || 0);
  var jackpotChance = clickerUpgradeValue(CLICKER_UPGRADES[15], levels.treasureHunt || 0);
  var overchargeMult = clickerUpgradeValue(CLICKER_UPGRADES[16], levels.overcharge || 0);
  var loopMult = clickerUpgradeValue(CLICKER_UPGRADES[17], levels.infiniteLoop || 0);
  var globalMult = (1 + goldRushBonus) * overchargeMult;
  return {
    chipsPerClick: (cpVal * cmVal + diamondFlat) * globalMult,
    chipsPerSecond: (acVal * amVal + turboFlat) * loopMult * globalMult,
    idlePerSecond: idleVal * amVal * (1 + passiveBonus) * globalMult,
    critChance: Math.min(critChance, 0.80),
    comboChance: Math.min(comboChance, 0.50),
    jackpotChance: Math.min(jackpotChance, 0.10),
    frenzyClicks: Math.floor(frenzyClicks + stormClicks),
    megaChance: Math.min(megaChance, 0.15),
    offlineCapHrs: offlineCapHrs,
  };
}

function clickerFormatNum(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  if (n === Math.floor(n)) return n.toLocaleString();
  if (n > 0 && n < 0.1) return n.toFixed(2);
  return n.toFixed(1);
}

function ClickerIdleView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectGames(); }, []);
  var sock = ctx.gamesSocket || ctx.socket;
  var isMobile = useIsMobile();
  var [chips, setChips] = useState(0);
  var [levels, setLevels] = useState({});
  var [totalClicks, setTotalClicks] = useState(0);
  var [totalEarned, setTotalEarned] = useState(0);
  var [loaded, setLoaded] = useState(false);
  var [floatingTexts, setFloatingTexts] = useState([]);
  var [offlineMsg, setOfflineMsg] = useState(null);
  var [collectMsg, setCollectMsg] = useState(null);
  var [coinScale, setCoinScale] = useState(1);
  var [coinGlow, setCoinGlow] = useState(0);
  var floatIdRef = useRef(0);
  var saveTimerRef = useRef(null);
  var autoTickRef = useRef(null);
  var chipsRef = useRef(0);
  var levelsRef = useRef({});
  var totalClicksRef = useRef(0);
  var totalEarnedRef = useRef(0);
  var loadedRef = useRef(false);

  // Keep refs in sync
  chipsRef.current = chips;
  levelsRef.current = levels;
  totalClicksRef.current = totalClicks;
  totalEarnedRef.current = totalEarned;
  loadedRef.current = loaded;

  var stats = useMemo(function() { return clickerCalcStats(levels); }, [levels]);

  // Save function
  var doSave = useCallback(function() {
    if (!sock || !loadedRef.current) return;
    sock.emit('clicker_save', {
      chips: chipsRef.current,
      levels: levelsRef.current,
      totalClicks: totalClicksRef.current,
      totalEarned: totalEarnedRef.current,
    });
  }, [sock]);

  // Load on mount
  useEffect(function() {
    if (!sock) return;
    function onState(data) {
      if (data && typeof data === 'object') {
        var savedChips = typeof data.chips === 'number' ? data.chips : 0;
        var savedLevels = (data.levels && typeof data.levels === 'object') ? data.levels : {};
        setLevels(savedLevels);
        setTotalClicks(typeof data.totalClicks === 'number' ? data.totalClicks : 0);
        setTotalEarned(typeof data.totalEarned === 'number' ? data.totalEarned : 0);
        // Calculate offline earnings
        if (data.lastSaveTime && typeof data.lastSaveTime === 'number') {
          var elapsed = Math.max(0, (Date.now() - data.lastSaveTime) / 1000);
          var offlineStats = clickerCalcStats(savedLevels);
          if (elapsed > 5 && offlineStats.idlePerSecond > 0) {
            // Cap offline time based on Offline Vault upgrade
            var capHrs = offlineStats.offlineCapHrs || 24;
            var cappedElapsed = Math.min(elapsed, capHrs * 3600);
            var offlineEarnings = Math.floor(offlineStats.idlePerSecond * cappedElapsed);
            if (offlineEarnings > 0) {
              savedChips += offlineEarnings;
              var hours = Math.floor(cappedElapsed / 3600);
              var mins = Math.floor((cappedElapsed % 3600) / 60);
              var timeStr = hours > 0 ? hours + 'h ' + mins + 'm' : mins + 'm';
              setOfflineMsg('Welcome back! You earned ' + clickerFormatNum(offlineEarnings) + ' chips while offline (' + timeStr + ')');
              setTimeout(function() { setOfflineMsg(null); }, 8000);
            }
          }
        }
        // Show interest earned notification
        if (data._interestEarned && data._interestEarned > 0) {
          var interestMsg = 'Daily interest: +' + clickerFormatNum(data._interestEarned) + ' chips (2% on banked balance)';
          setCollectMsg(interestMsg);
          setTimeout(function() { setCollectMsg(null); }, 8000);
        }
        setChips(savedChips);
      }
      setLoaded(true);
    }
    sock.on('clicker_state', onState);
    sock.emit('clicker_load');
    return function() { sock.off('clicker_state', onState); };
  }, [sock]);

  // Auto-save every 30 seconds
  useEffect(function() {
    saveTimerRef.current = setInterval(function() { doSave(); }, 30000);
    return function() {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      doSave();
    };
  }, [doSave]);

  // Auto-clicker tick every second
  useEffect(function() {
    autoTickRef.current = setInterval(function() {
      var curStats = clickerCalcStats(levelsRef.current);
      if (curStats.chipsPerSecond > 0) {
        setChips(function(prev) { return prev + curStats.chipsPerSecond; });
        setTotalEarned(function(prev) { return prev + curStats.chipsPerSecond; });
      }
    }, 1000);
    return function() { if (autoTickRef.current) clearInterval(autoTickRef.current); };
  }, []);

  // Collect handler
  useEffect(function() {
    if (!sock) return;
    function onCollected(data) {
      if (data && typeof data.collected === 'number') {
        setChips(typeof data.clickerChips === 'number' ? data.clickerChips : 0);
        setCollectMsg('Collected ' + clickerFormatNum(data.collected) + ' chips to your account!');
        if (window.BossSounds) window.BossSounds.play('coin');
        setTimeout(function() { setCollectMsg(null); }, 5000);
        // Trigger a save after collection to sync the new chip total
        doSave();
      }
    }
    sock.on('clicker_collected', onCollected);
    return function() { sock.off('clicker_collected', onCollected); };
  }, [sock, doSave]);

  // Clean up expired floating texts
  useEffect(function() {
    if (floatingTexts.length === 0) return;
    var timer = setTimeout(function() {
      setFloatingTexts(function(prev) { return prev.filter(function(f) { return Date.now() - f.time < 900; }); });
    }, 950);
    return function() { clearTimeout(timer); };
  }, [floatingTexts]);

  var lastClickTime = useRef(0);
  var lastClickSoundTime = useRef(0);
  var clickerCoinBtnRef = useRef(null);
  var touchedRef = useRef(false);
  function handleClick(e) {
    if (!loaded) return;
    // Prevent double-fire from touch + click on mobile
    if (e.type === 'touchstart') {
      touchedRef.current = true;
      e.preventDefault();
    } else if (e.type === 'click' && touchedRef.current) {
      touchedRef.current = false;
      return; // Skip click event that follows touchstart
    }
    // Throttle rapid clicks to prevent lag buildup
    var now = Date.now();
    if (now - lastClickTime.current < 50) return;
    lastClickTime.current = now;

    var baseEarned = stats.chipsPerClick;
    var totalClicks = 1 + stats.frenzyClicks;
    var earned = 0;
    var label = '';
    for (var ci = 0; ci < totalClicks; ci++) {
      var roll = Math.random();
      if (stats.jackpotChance > 0 && roll < stats.jackpotChance) {
        earned += baseEarned * 50;
        label = 'JACKPOT x50!';
      } else if (stats.megaChance > 0 && roll < stats.megaChance + stats.jackpotChance) {
        earned += baseEarned * 25;
        if (!label) label = 'MEGA x25!';
      } else if (stats.comboChance > 0 && roll < stats.comboChance + stats.megaChance + stats.jackpotChance) {
        earned += baseEarned * 10;
        if (!label) label = 'COMBO x10!';
      } else if (stats.critChance > 0 && roll < stats.critChance + stats.comboChance + stats.megaChance + stats.jackpotChance) {
        earned += baseEarned * 5;
        if (!label) label = 'CRIT x5!';
      } else {
        earned += baseEarned;
      }
    }
    if (!label) label = '+' + clickerFormatNum(earned);
    else label = label + ' +' + clickerFormatNum(earned);
    setChips(function(prev) { return prev + earned; });
    setTotalClicks(function(prev) { return prev + 1; });
    setTotalEarned(function(prev) { return prev + earned; });
    // Coin press animation
    setCoinScale(0.9);
    setCoinGlow(1);
    setTimeout(function() { setCoinScale(1.05); }, 80);
    setTimeout(function() { setCoinScale(1); setCoinGlow(0); }, 200);
    // Floating text - support both mouse and touch coordinates
    var rect = e.currentTarget.getBoundingClientRect();
    var clientX = e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : rect.left + rect.width / 2);
    var clientY = e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : rect.top + rect.height / 2);
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    floatIdRef.current++;
    var textColor = label.indexOf('JACKPOT') >= 0 ? '#fee75c' : label.indexOf('MEGA') >= 0 ? '#ff4444' : label.indexOf('COMBO') >= 0 ? '#5865f2' : label.indexOf('CRIT') >= 0 ? '#f0b232' : '#57f287';
    setFloatingTexts(function(prev) {
      var next = prev.length > 8 ? prev.slice(-5) : prev.slice();
      next.push({ id: floatIdRef.current, text: label, x: x, y: y, time: Date.now(), color: textColor });
      return next;
    });
    // Click sound (throttled to max 10/sec = 100ms interval)
    if (window.BossSounds && now - lastClickSoundTime.current >= 100) {
      lastClickSoundTime.current = now;
      window.BossSounds.play('click');
    }
    // Pulse glow on coin button during combo/crit/mega/jackpot
    var isBigHit = label.indexOf('JACKPOT') >= 0 || label.indexOf('MEGA') >= 0 || label.indexOf('COMBO') >= 0 || label.indexOf('CRIT') >= 0;
    if (isBigHit && window.BossEffects && clickerCoinBtnRef.current) {
      var glowColor = label.indexOf('JACKPOT') >= 0 ? '#fee75c' : label.indexOf('MEGA') >= 0 ? '#ff4444' : label.indexOf('COMBO') >= 0 ? '#5865f2' : '#f0b232';
      window.BossEffects.pulseGlow(clickerCoinBtnRef.current, glowColor, 600);
    }
  }

  function buyUpgrade(upgradeIdx) {
    var upgrade = CLICKER_UPGRADES[upgradeIdx];
    var currentLevel = levels[upgrade.id] || 0;
    var cost = clickerUpgradeCost(upgrade, currentLevel);
    var accountChips = (ctx.account && ctx.account.chips) || 0;
    var totalAvailable = chips + accountChips;
    if (totalAvailable < cost) return;
    // Deduct from clicker chips first, then account chips for the remainder
    if (chips >= cost) {
      setChips(function(prev) { return prev - cost; });
    } else {
      var fromAccount = Math.ceil(cost - chips);
      setChips(0);
      if (sock) {
        sock.emit('clicker_use_account_chips', { amount: fromAccount });
      }
    }
    setLevels(function(prev) {
      var next = Object.assign({}, prev);
      next[upgrade.id] = (next[upgrade.id] || 0) + 1;
      return next;
    });
  }

  function collectToAccount() {
    if (!sock || chips < 1) return;
    var amount = Math.floor(chips);
    // Emit collect directly -- the server now calculates offline earnings
    // server-side, so we don't need to save first (which could get clamped
    // by the anti-cheat and then the collect would see fewer chips).
    sock.emit('clicker_collect', { amount: amount });
  }

  // ── Upgrade shop renderer (reused in both layouts) ──
  function renderUpgradeShop(maxH) {
    return React.createElement('div', {
      style: {
        width: '100%',
        background: '#252528', borderRadius: '12px',
        border: '1px solid #4e5058', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        maxHeight: maxH || 'none', flex: isMobile ? 'none' : 1
      }
    },
      React.createElement('div', {
        style: {
          padding: isMobile ? '8px 12px' : '10px 14px', background: '#2a2a2d',
          borderBottom: '1px solid #4e5058',
          color: '#f0b232', fontSize: isMobile ? '14px' : '15px', fontWeight: 700,
          flexShrink: 0
        }
      }, 'Upgrade Shop (' + CLICKER_UPGRADES.length + ')'),
      React.createElement('div', {
        style: { overflowY: 'auto', flex: 1 }
      },
      CLICKER_UPGRADES.map(function(upgrade, idx) {
        var currentLevel = levels[upgrade.id] || 0;
        var cost = clickerUpgradeCost(upgrade, currentLevel);
        var value = clickerUpgradeValue(upgrade, currentLevel);
        var nextValue = clickerUpgradeValue(upgrade, currentLevel + 1);
        var accountChips = (ctx.account && ctx.account.chips) || 0;
        var canAfford = (chips + accountChips) >= cost;
        var needsAccount = chips < cost && canAfford;
        var levelColors = ['#949ba4', '#57f287', '#f0b232', '#5865f2', '#ed4245'];
        var lvlColor = currentLevel === 0 ? levelColors[0] : levelColors[Math.min(Math.floor(currentLevel / 5) + 1, levelColors.length - 1)];

        return React.createElement('div', {
          key: upgrade.id,
          style: {
            display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '10px',
            padding: isMobile ? '8px 10px' : '8px 14px',
            borderBottom: idx < CLICKER_UPGRADES.length - 1 ? '1px solid #333' : 'none',
            transition: 'background 0.15s'
          },
          onMouseEnter: function(e) { e.currentTarget.style.background = '#2d2d30'; },
          onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
        },
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '1px' } },
              React.createElement('span', { style: { color: '#dcddde', fontSize: isMobile ? '12px' : '13px', fontWeight: 600 } }, upgrade.name),
              React.createElement('span', {
                style: {
                  color: lvlColor, fontSize: '10px', fontWeight: 700,
                  background: 'rgba(255,255,255,0.06)', borderRadius: '4px', padding: '1px 5px'
                }
              }, 'Lv.' + currentLevel)
            ),
            React.createElement('div', { style: { color: '#72767d', fontSize: isMobile ? '10px' : '11px' } },
              'Now: ' + clickerFormatNum(value) + ' > ' + clickerFormatNum(nextValue)
            )
          ),
          React.createElement('button', {
            style: {
              padding: isMobile ? '6px 10px' : '6px 12px', minWidth: isMobile ? '80px' : '90px',
              background: canAfford ? '#f0b232' : '#3a3a3d',
              border: 'none', borderRadius: '6px',
              color: canAfford ? '#1c1c1e' : '#72767d',
              fontSize: isMobile ? '11px' : '12px', fontWeight: 700,
              cursor: canAfford ? 'pointer' : 'default',
              fontFamily: 'inherit',
              transition: 'background 0.15s, transform 0.1s',
              opacity: canAfford ? 1 : 0.5,
              flexShrink: 0, touchAction: 'manipulation'
            },
            onClick: function() { buyUpgrade(idx); }
          }, clickerFormatNum(cost) + (needsAccount ? ' (acct)' : ''))
        );
      })
      )
    );
  }

  // ── Coin button renderer ──
  function renderCoinArea() {
    var coinSize = isMobile ? 100 : 140;
    var coinFontSize = isMobile ? 40 : 56;
    return React.createElement('div', {
      ref: clickerCoinBtnRef,
      style: { position: 'relative', userSelect: 'none', cursor: 'pointer', touchAction: 'manipulation' },
      onClick: handleClick,
      onTouchStart: handleClick
    },
      React.createElement('div', {
        style: {
          width: coinSize + 'px', height: coinSize + 'px', borderRadius: '50%',
          background: 'radial-gradient(circle at 40% 35%, #ffe082, #f0b232 50%, #c68a1a 80%, #8a5e0a)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: coinFontSize + 'px', fontWeight: 800, color: '#8a5e0a',
          boxShadow: '0 6px 30px rgba(240,178,50,' + (0.4 + coinGlow * 0.4) + '), inset 0 -4px 12px rgba(0,0,0,0.3), inset 0 4px 8px rgba(255,255,255,0.2)',
          border: '4px solid #d4941a',
          transform: 'scale(' + coinScale + ')',
          transition: 'transform 0.1s ease, box-shadow 0.2s ease',
          textShadow: '0 2px 4px rgba(0,0,0,0.3)',
          lineHeight: 1
        }
      }, '$'),
      floatingTexts.map(function(ft) {
        var age = Date.now() - ft.time;
        var progress = Math.min(age / 1200, 1);
        var opacity = progress < 0.7 ? 1 : 1 - ((progress - 0.7) / 0.3);
        var yOffset = -60 * progress;
        return React.createElement('div', {
          key: ft.id,
          style: {
            position: 'absolute',
            left: ft.x + 'px',
            top: (ft.y + yOffset) + 'px',
            color: ft.color || '#f0b232',
            fontSize: ft.text && (ft.text.indexOf('JACKPOT') >= 0 || ft.text.indexOf('MEGA') >= 0) ? '24px' : ft.text && (ft.text.indexOf('COMBO') >= 0 || ft.text.indexOf('CRIT') >= 0) ? '20px' : '18px',
            fontWeight: 800,
            pointerEvents: 'none',
            opacity: opacity,
            textShadow: '0 0 8px ' + (ft.color || 'rgba(240,178,50,0.6)') + ', 0 1px 2px rgba(0,0,0,0.8)',
            transform: 'translateX(-50%) scale(' + (1 + progress * 0.3) + ')',
            whiteSpace: 'nowrap',
            zIndex: 10
          }
        }, ft.text);
      })
    );
  }

  // ── Render ──
  var loadingStyle = {
    flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e',
    overflow: 'auto', alignItems: 'center', padding: '24px 16px', gap: '20px'
  };

  if (!loaded) {
    return React.createElement('div', { style: loadingStyle },
      React.createElement('div', { style: { color: '#949ba4', fontSize: '16px', marginTop: '60px' } }, 'Loading clicker data...')
    );
  }

  var statBoxStyle = {
    background: '#252528', borderRadius: '8px', padding: isMobile ? '6px 10px' : '6px 14px',
    textAlign: 'center', minWidth: isMobile ? '80px' : '100px'
  };

  // ── MOBILE LAYOUT: single column, compact ──
  if (isMobile) {
    return React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e',
        overflow: 'auto', padding: '8px 10px', gap: '10px', alignItems: 'center'
      }
    },
      // Offline/Collect messages
      offlineMsg ? React.createElement('div', {
        style: {
          background: 'rgba(87,242,135,0.15)', border: '1px solid #57f287',
          borderRadius: '6px', padding: '6px 12px', color: '#57f287',
          fontSize: '12px', fontWeight: 600, textAlign: 'center', width: '100%'
        }
      }, offlineMsg) : null,
      collectMsg ? React.createElement('div', {
        style: {
          background: 'rgba(240,178,50,0.15)', border: '1px solid #f0b232',
          borderRadius: '6px', padding: '6px 12px', color: '#f0b232',
          fontSize: '12px', fontWeight: 600, textAlign: 'center', width: '100%'
        }
      }, collectMsg) : null,

      // Chips + stats row inline
      React.createElement('div', {
        style: { textAlign: 'center' }
      },
        React.createElement('div', {
          style: { fontSize: '28px', fontWeight: 800, color: '#f0b232', textShadow: '0 0 15px rgba(240,178,50,0.3)' }
        }, clickerFormatNum(Math.floor(chips)) + ' chips'),
        React.createElement('div', {
          style: { display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '6px', flexWrap: 'wrap' }
        },
          React.createElement('div', { style: statBoxStyle },
            React.createElement('div', { style: { color: '#949ba4', fontSize: '9px', textTransform: 'uppercase' } }, 'Click'),
            React.createElement('div', { style: { color: '#f0b232', fontSize: '14px', fontWeight: 700 } }, clickerFormatNum(stats.chipsPerClick))
          ),
          React.createElement('div', { style: statBoxStyle },
            React.createElement('div', { style: { color: '#949ba4', fontSize: '9px', textTransform: 'uppercase' } }, '/Sec'),
            React.createElement('div', { style: { color: '#57f287', fontSize: '14px', fontWeight: 700 } }, clickerFormatNum(stats.chipsPerSecond))
          ),
          React.createElement('div', { style: statBoxStyle },
            React.createElement('div', { style: { color: '#949ba4', fontSize: '9px', textTransform: 'uppercase' } }, 'Idle'),
            React.createElement('div', { style: { color: '#5865f2', fontSize: '14px', fontWeight: 700 } }, clickerFormatNum(stats.idlePerSecond))
          )
        )
      ),

      // Coin + Collect row
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '16px' }
      },
        renderCoinArea(),
        React.createElement('button', {
          style: {
            padding: '8px 16px',
            background: Math.floor(chips) >= 1 ? '#57f287' : '#3a3a3d',
            border: 'none', borderRadius: '8px',
            color: Math.floor(chips) >= 1 ? '#1c1c1e' : '#949ba4',
            fontSize: '13px', fontWeight: 700,
            cursor: Math.floor(chips) >= 1 ? 'pointer' : 'default',
            fontFamily: 'inherit', touchAction: 'manipulation',
            opacity: Math.floor(chips) >= 1 ? 1 : 0.6
          },
          onClick: collectToAccount
        }, 'Collect'),
        React.createElement('div', {
          style: { color: '#949ba4', fontSize: '9px', textAlign: 'center' }
        }, '50M daily collection limit')
      ),

      // Upgrade shop (fills remaining space)
      renderUpgradeShop('none')
    );
  }

  // ── DESKTOP LAYOUT: upgrades left, clicker right ──
  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'row', background: '#1c1c1e',
      overflow: 'hidden', height: '100%'
    }
  },
    // LEFT: Upgrade shop panel
    React.createElement('div', {
      style: {
        width: '340px', minWidth: '300px', display: 'flex', flexDirection: 'column',
        borderRight: '1px solid #2a2a2e', overflow: 'hidden', flexShrink: 0
      }
    },
      renderUpgradeShop('none')
    ),

    // RIGHT: Clicker area
    React.createElement('div', {
      style: {
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', overflow: 'auto', padding: '24px 16px', gap: '16px'
      }
    },
      // Title
      React.createElement('div', { style: { textAlign: 'center' } },
        React.createElement('h3', { style: { color: '#f0b232', fontSize: '22px', fontWeight: 700, margin: '0 0 4px 0' } }, 'Idle Clicker'),
        React.createElement('p', { style: { color: '#949ba4', fontSize: '12px', margin: 0 } }, 'Click to earn, upgrade to automate, collect to your account!')
      ),

      // Offline/Collect messages
      offlineMsg ? React.createElement('div', {
        style: {
          background: 'rgba(87,242,135,0.15)', border: '1px solid #57f287',
          borderRadius: '8px', padding: '8px 16px', color: '#57f287',
          fontSize: '13px', fontWeight: 600, textAlign: 'center',
          animation: 'fadeIn 0.4s ease', maxWidth: '400px'
        }
      }, offlineMsg) : null,
      collectMsg ? React.createElement('div', {
        style: {
          background: 'rgba(240,178,50,0.15)', border: '1px solid #f0b232',
          borderRadius: '8px', padding: '8px 16px', color: '#f0b232',
          fontSize: '13px', fontWeight: 600, textAlign: 'center', maxWidth: '400px'
        }
      }, collectMsg) : null,

      // Chips display
      React.createElement('div', { style: { textAlign: 'center' } },
        React.createElement('div', {
          style: { fontSize: '36px', fontWeight: 800, color: '#f0b232', textShadow: '0 0 20px rgba(240,178,50,0.3)', letterSpacing: '-0.5px' }
        }, clickerFormatNum(Math.floor(chips)) + ' chips')
      ),

      // Stats row
      React.createElement('div', { style: { display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' } },
        React.createElement('div', { style: statBoxStyle },
          React.createElement('div', { style: { color: '#949ba4', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' } }, 'Per Click'),
          React.createElement('div', { style: { color: '#f0b232', fontSize: '18px', fontWeight: 700 } }, clickerFormatNum(stats.chipsPerClick))
        ),
        React.createElement('div', { style: statBoxStyle },
          React.createElement('div', { style: { color: '#949ba4', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' } }, 'Per Second'),
          React.createElement('div', { style: { color: '#57f287', fontSize: '18px', fontWeight: 700 } }, clickerFormatNum(stats.chipsPerSecond))
        ),
        React.createElement('div', { style: statBoxStyle },
          React.createElement('div', { style: { color: '#949ba4', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' } }, 'Idle / Sec'),
          React.createElement('div', { style: { color: '#5865f2', fontSize: '18px', fontWeight: 700 } }, clickerFormatNum(stats.idlePerSecond))
        )
      ),

      // Coin click area
      renderCoinArea(),

      // Collect button
      React.createElement('button', {
        style: {
          padding: '10px 28px',
          background: Math.floor(chips) >= 1 ? '#57f287' : '#3a3a3d',
          border: 'none', borderRadius: '8px',
          color: Math.floor(chips) >= 1 ? '#1c1c1e' : '#949ba4',
          fontSize: '14px', fontWeight: 700,
          cursor: Math.floor(chips) >= 1 ? 'pointer' : 'default',
          fontFamily: 'inherit',
          transition: 'background 0.15s, transform 0.1s',
          opacity: Math.floor(chips) >= 1 ? 1 : 0.6
        },
        onClick: collectToAccount,
        onMouseEnter: function(e) { if (Math.floor(chips) >= 1) e.currentTarget.style.background = '#3dd96e'; },
        onMouseLeave: function(e) { if (Math.floor(chips) >= 1) e.currentTarget.style.background = '#57f287'; }
      }, 'Collect ' + clickerFormatNum(Math.floor(chips)) + ' to Account'),
      React.createElement('div', {
        style: { color: '#949ba4', fontSize: '11px', marginTop: '2px' }
      }, '50M daily collection limit \u00B7 2% daily interest on banked chips'),

      // Total stats
      React.createElement('div', { style: { display: 'flex', gap: '16px', color: '#949ba4', fontSize: '12px' } },
        React.createElement('span', null, 'Total clicks: ' + totalClicks.toLocaleString()),
        React.createElement('span', null, 'Total earned: ' + clickerFormatNum(Math.floor(totalEarned)))
      )
    )
  );
}
