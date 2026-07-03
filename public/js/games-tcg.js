function TCGPackView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectMarket(); }, []);
  var sock = ctx.marketSocket || ctx.socket;
  var [result, setResult] = useState(null);
  var [opening, setOpening] = useState(false);
  var [showIdx, setShowIdx] = useState(-1);
  var [inventory, setInventory] = useState([]);
  var [keyDropToast, setKeyDropToast] = useState(null);

  var keyPacks = [
    { id: 'wooden_pack', name: 'Wooden Pack', keyRequired: 'wooden_key', keyName: 'Wooden Key', cards: 3, color: '#8B4513', img: '/icons/loot/Loot_143_bag.PNG', keyImg: '/icons/loot/Loot_54_key.PNG', desc: 'Uncommon+ guaranteed' },
    { id: 'iron_pack', name: 'Iron Pack', keyRequired: 'iron_key', keyName: 'Iron Key', cards: 4, color: '#71797E', img: '/icons/loot/Loot_144_bag.PNG', keyImg: '/icons/loot/Loot_56_key.PNG', desc: 'Rare+ guaranteed' },
    { id: 'gold_pack', name: 'Gold Pack', keyRequired: 'gold_key', keyName: 'Gold Key', cards: 5, color: '#f0b232', img: '/icons/loot/Loot_145_bag.PNG', keyImg: '/icons/loot/Loot_58_key.PNG', desc: 'Rare+ weighted' },
    { id: 'crystal_pack', name: 'Crystal Pack', keyRequired: 'crystal_key', keyName: 'Crystal Key', cards: 5, color: '#00d4ff', img: '/icons/loot/Loot_143_bag.PNG', keyImg: '/icons/loot/Loot_60_key.PNG', desc: 'Epic+ guaranteed' },
    { id: 'shadow_pack', name: 'Shadow Deck', keyRequired: 'shadow_key', keyName: 'Shadow Key', cards: 5, color: '#9b59b6', img: '/icons/loot/Loot_144_bag.PNG', keyImg: '/icons/loot/Loot_70_key.PNG', desc: 'Epic+ weighted' },
    { id: 'void_pack', name: 'Void Deck', keyRequired: 'void_key', keyName: 'Void Key', cards: 7, color: '#ff4444', img: '/icons/loot/Loot_145_bag.PNG', keyImg: '/icons/loot/Loot_72_key.PNG', desc: 'Legendary+ guaranteed' },
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
      // Sound: whoosh on pack open
      if (window.BossSounds) window.BossSounds.play('whoosh');
      // Check if any card is legendary+ for big win sound
      if (data && data.cards && window.BossSounds) {
        var hasLegendaryPlus = data.cards.some(function(c) {
          var r = c.card && c.card.rarity;
          return r === 'legendary' || r === 'godly' || r === 'secret' || r === 'mythic' || r === 'holographic';
        });
        if (hasLegendaryPlus) {
          setTimeout(function() { if (window.BossSounds) window.BossSounds.play('win_big'); }, 400);
        }
      }
    }
    function onSpecialPackResult(data) {
      setResult(data);
      setOpening(false);
      setShowIdx(0);
      // Sound: whoosh on pack open
      if (window.BossSounds) window.BossSounds.play('whoosh');
      // Check if any card is legendary+ for big win sound
      if (data && data.cards && window.BossSounds) {
        var hasLegendaryPlus = data.cards.some(function(c) {
          var r = c.card && c.card.rarity;
          return r === 'legendary' || r === 'godly' || r === 'secret' || r === 'mythic' || r === 'holographic';
        });
        if (hasLegendaryPlus) {
          setTimeout(function() { if (window.BossSounds) window.BossSounds.play('win_big'); }, 400);
        }
      }
      // Refresh inventory after opening a key pack (key consumed)
      if (ctx.socket) ctx.socket.emit('inventory_get');
    }
    function onChips() {}
    function onKeyDrop(data) {
      setKeyDropToast(data);
      // Refresh inventory when a key drops
      if (ctx.socket) ctx.socket.emit('inventory_get');
      setTimeout(function() { setKeyDropToast(null); }, 4000);
    }
    sock.on('tcg_pack_result', onResult);
    sock.on('special_pack_result', onSpecialPackResult);
    sock.on('chips_updated', onChips);
    sock.on('key_drop', onKeyDrop);
    return function() {
      sock.off('tcg_pack_result', onResult);
      sock.off('special_pack_result', onSpecialPackResult);
      sock.off('chips_updated', onChips);
      sock.off('key_drop', onKeyDrop);
    };
  }, [sock]);

  // Staggered card reveal animation
  useEffect(function() {
    if (!result || showIdx < 0) return;
    if (showIdx >= result.cards.length) return;
    // Play card flip sound for each revealed card
    if (showIdx > 0 && window.BossSounds) {
      window.BossSounds.play('card_flip');
    }
    var timer = setTimeout(function() { setShowIdx(showIdx + 1); }, 600);
    return function() { clearTimeout(timer); };
  }, [showIdx, result]);

  function openPack(tier) {
    if (!sock || opening) return;
    setResult(null);
    setShowIdx(-1);
    setOpening(true);
    sock.emit('tcg_open_pack', { tier: tier });
  }

  var panelStyle = { flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e', overflow: 'auto', alignItems: 'center', padding: '24px' };

  var isMobile = useIsMobile();
  var packs = [
    { id: 'starter', name: 'Starter Pack', cost: 50, color: '#72767d', desc: '3 cards, budget friendly', img: '/icons/loot/Loot_61_bag.PNG' },
    { id: 'basic', name: 'Basic Pack', cost: 100, color: '#57f287', desc: '5 cards, common pool', img: '/icons/loot/Loot_62_bag.PNG' },
    { id: 'premium', name: 'Premium Pack', cost: 300, color: '#5865f2', desc: '5 cards, guaranteed rare+', img: '/icons/loot/Loot_63_bag.PNG' },
    { id: 'shadow', name: 'Shadow Pack', cost: 500, color: '#9b59b6', desc: 'Undead & Demon only!', img: '/icons/loot/Loot_66_bag.PNG' },
    { id: 'ultra', name: 'Ultra Pack', cost: 750, color: '#f0b232', desc: '5 cards, weighted epic+', img: '/icons/loot/Loot_67_bag.PNG' },
    { id: 'elite', name: 'Elite Pack', cost: 1500, color: '#ff69b4', desc: '5 cards, guaranteed epic+', img: '/icons/loot/Loot_68_bag.PNG' },
    { id: 'legendary', name: 'Legendary Pack', cost: 3000, color: '#ff4444', desc: 'Guaranteed legendary+', img: '/icons/loot/Loot_143_bag.PNG' },
    { id: 'void', name: 'Void Pack', cost: 7500, color: '#00ff88', desc: '7 cards, all rarities!', img: '/icons/loot/Loot_144_bag.PNG' },
    { id: 'ancient', name: 'Ancient Pack', cost: 10000, color: '#8B7355', desc: '7 cards, ancient weighted', img: '/icons/loot/Loot_145_bag.PNG' },
    { id: 'celestial', name: 'Celestial Pack', cost: 15000, color: '#87ceeb', desc: '8 cards, celestial odds', img: '/icons/loot/Loot_143_bag.PNG' },
    { id: 'infernal', name: 'Infernal Pack', cost: 20000, color: '#ff4500', desc: '10 cards, guaranteed mythic', img: '/icons/loot/Loot_144_bag.PNG' },
  ];

  // Show result - card reveal screen
  if (result) {
    var allShown = showIdx >= result.cards.length;
    return React.createElement('div', { style: panelStyle },
      React.createElement('h3', {
        style: { color: result.pack.color || '#f0b232', fontSize: '22px', fontWeight: 700, marginBottom: '8px' }
      }, result.pack.name + ' Opened!'),
      React.createElement('p', {
        style: { color: '#949ba4', fontSize: '13px', marginBottom: '20px' }
      }, 'Tier: ' + result.tier),

      // Cards display
      React.createElement('div', {
        style: {
          display: 'flex', gap: '14px', flexWrap: 'wrap', justifyContent: 'center',
          marginBottom: '24px', maxWidth: '800px'
        }
      },
        result.cards.map(function(cardData, idx) {
          var visible = idx < showIdx;
          var card = cardData.card || {};
          var rarityColor = card.rarityColor || '#9e9e9e';
          var isUltraRare = card.rarity === 'godly' || card.rarity === 'secret' || card.rarity === 'mythic' || card.rarity === 'holographic';
          var cardGlow = card.shiny ? '0 0 18px rgba(255,215,0,0.6), 0 0 40px rgba(255,215,0,0.2)' :
            (card.rarity === 'godly' ? '0 0 25px rgba(255,215,0,0.6), 0 0 50px rgba(255,215,0,0.3)' :
            card.rarity === 'secret' ? '0 0 20px rgba(0,255,136,0.5), 0 0 40px rgba(0,255,136,0.2)' :
            card.rarity === 'mythic' ? '0 0 20px rgba(255,68,68,0.5), 0 0 40px rgba(255,68,68,0.2)' :
            card.rarity === 'holographic' ? '0 0 18px rgba(255,105,180,0.4), 0 0 35px rgba(255,105,180,0.2)' :
            '0 0 20px ' + rarityColor + '40');
          var cardBorder = card.shiny ? '#ffd700' : (isUltraRare ? rarityColor : rarityColor);
          // Determine holo/foil className for overlay effects
          var cardClassName = '';
          if (visible && card.shiny) cardClassName = 'holo-card';
          if (visible && isUltraRare) cardClassName = 'foil-card';
          // Rarity-scaled glow spread for staggered entrance
          var rarityGlowScale = { common: 1, uncommon: 1.1, rare: 1.3, super_rare: 1.5, epic: 1.5, legendary: 1.8, holographic: 2, mythic: 2.2, secret: 2.2, godly: 2.5 };
          var glowMultiplier = (card.rarity && rarityGlowScale[card.rarity]) ? rarityGlowScale[card.rarity] : 1;
          var scaledGlow = visible ? cardGlow.replace(/(\d+)px/g, function(m, n) { return Math.round(parseInt(n) * glowMultiplier) + 'px'; }) : 'none';
          return React.createElement('div', {
            key: cardData.instanceId || idx,
            className: cardClassName,
            style: {
              width: '140px', borderRadius: '12px',
              background: visible ? (isUltraRare ? '#1a1a2a' : '#252528') : '#1a1a1c',
              border: visible ? '2px solid ' + cardBorder : '2px solid #3a3a3e',
              textAlign: 'center', transition: 'all 0.5s ease',
              opacity: visible ? 1 : 0,
              transform: visible ? 'scale(1) rotateY(0deg)' : 'scale(0.85) rotateY(90deg)',
              boxShadow: visible ? scaledGlow : 'none',
              overflow: 'hidden', position: 'relative',
              animation: visible ? 'cardDeal 0.4s ease-out' : 'none',
              animationDelay: (idx * 200) + 'ms',
              animationFillMode: 'backwards'
            }
          },
            visible ? React.createElement(React.Fragment, null,
              // Shiny badge
              card.shiny ? React.createElement('div', {
                style: {
                  position: 'absolute', top: '4px', right: '4px', background: '#ffd700',
                  color: '#1c1c1e', fontSize: '8px', fontWeight: 800, padding: '2px 5px',
                  borderRadius: '4px', zIndex: 2, letterSpacing: '0.5px'
                }
              }, 'SHINY') : null,
              // Ultra-rare rarity badge
              isUltraRare && !card.shiny ? React.createElement('div', {
                style: {
                  position: 'absolute', top: '4px', right: '4px', background: rarityColor,
                  color: '#1c1c1e', fontSize: '7px', fontWeight: 800, padding: '2px 5px',
                  borderRadius: '4px', zIndex: 2, letterSpacing: '0.5px', textTransform: 'uppercase'
                }
              }, card.rarity === 'godly' ? 'GODLY' : card.rarity === 'secret' ? 'SECRET' : card.rarity === 'mythic' ? 'MYTHIC' : 'HOLO') : null,
              // Card image
              card.img
                ? React.createElement('div', {
                    style: { width: '100%', height: '100px', background: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }
                  },
                    React.createElement('img', {
                      src: card.img,
                      style: { width: '100%', height: '100%', objectFit: 'cover' }
                    })
                  )
                : React.createElement('div', {
                    style: { width: '100%', height: '100px', background: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px' }
                  }, '\u{1F409}'),
              // Card info
              React.createElement('div', { style: { padding: '10px' } },
                React.createElement('div', {
                  style: { color: '#dcddde', fontSize: '13px', fontWeight: 700, marginBottom: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
                }, card.name || 'Unknown'),
                React.createElement('div', {
                  style: { color: rarityColor, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }
                }, card.rarity || 'common'),
                React.createElement('div', {
                  style: { color: '#949ba4', fontSize: '10px', marginBottom: '6px', fontStyle: 'italic' }
                }, card.type || ''),
                // Stats row with base comparison
                React.createElement('div', {
                  style: { display: 'flex', justifyContent: 'center', gap: '6px', fontSize: '11px' }
                },
                  React.createElement('span', { style: { color: card.baseAtk != null && card.atk != null ? (card.atk > card.baseAtk ? '#57f287' : card.atk < card.baseAtk ? '#ed4245' : '#ed4245') : '#ed4245', fontWeight: 700 } }, '\u2694' + (card.atk != null ? card.atk : '?')),
                  React.createElement('span', { style: { color: card.baseDef != null && card.def != null ? (card.def > card.baseDef ? '#57f287' : card.def < card.baseDef ? '#ed4245' : '#5865f2') : '#5865f2', fontWeight: 700 } }, '\u{1F6E1}' + (card.def != null ? card.def : '?')),
                  React.createElement('span', { style: { color: card.baseHp != null && card.hp != null ? (card.hp > card.baseHp ? '#57f287' : card.hp < card.baseHp ? '#ed4245' : '#57f287') : '#57f287', fontWeight: 700 } }, '\u2764' + (card.hp != null ? card.hp : '?'))
                )
              )
            ) : React.createElement('div', {
              style: { height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '48px', color: '#4e5058' }
            }, '?')
          );
        })
      ),

      // Open another button
      allShown ? React.createElement('button', {
        style: {
          padding: '10px 24px', background: '#f0b232', border: 'none', borderRadius: '8px',
          color: '#1c1c1e', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
        },
        onClick: function() { setResult(null); setShowIdx(-1); }
      }, 'Open Another Pack') : null
    );
  }

  // Pack selection screen
  var chipBalance = (ctx.account && ctx.account.chips) || 0;
  return React.createElement('div', { style: panelStyle },
    React.createElement('h3', { style: { color: '#f0b232', fontSize: '22px', fontWeight: 700, marginBottom: '8px' } }, 'TCG Card Packs'),
    React.createElement('p', { style: { color: '#949ba4', fontSize: '13px', marginBottom: '6px', textAlign: 'center' } },
      'Open packs to collect monster cards! 10 rarities from Common to Godly.'),
    React.createElement('div', { style: { color: '#f0b232', fontSize: '15px', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' } },
      React.createElement('img', { src: '/icons/loot/LootCoin_06.PNG', style: { width: '16px', height: '16px', verticalAlign: 'middle' } }),
      'Your chips: ' + chipBalance.toLocaleString()),
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: isMobile ? '10px' : '14px', maxWidth: '900px', width: '100%'
      }
    },
      packs.map(function(p) {
        var canAfford = chipBalance >= p.cost;
        return React.createElement('div', {
          key: p.id,
          style: {
            background: '#252528', borderRadius: '12px', border: '2px solid ' + p.color,
            padding: isMobile ? '14px 8px' : '18px 12px', textAlign: 'center',
            cursor: canAfford ? 'pointer' : 'not-allowed',
            transition: 'transform 0.2s, box-shadow 0.2s',
            opacity: canAfford ? 1 : 0.5
          },
          onClick: function() { if (canAfford) openPack(p.id); },
          onMouseEnter: function(e) { if (canAfford) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 6px 20px ' + p.color + '30'; } },
          onMouseLeave: function(e) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }
        },
          p.img
            ? React.createElement('img', { src: p.img, style: { width: isMobile ? '48px' : '56px', height: isMobile ? '48px' : '56px', objectFit: 'contain', marginBottom: '6px' } })
            : React.createElement('div', { style: { fontSize: isMobile ? '28px' : '32px', marginBottom: '6px' } }, p.icon || '\u{1F5C3}'),
          React.createElement('div', { style: { color: p.color, fontSize: isMobile ? '13px' : '14px', fontWeight: 700, marginBottom: '3px' } }, p.name),
          React.createElement('div', { style: { color: '#949ba4', fontSize: isMobile ? '10px' : '11px', marginBottom: '6px', lineHeight: 1.3 } }, p.desc),
          React.createElement('div', { style: { color: '#f0b232', fontSize: isMobile ? '15px' : '16px', fontWeight: 800 } }, p.cost.toLocaleString() + ' chips')
        );
      })
    ),
    opening ? React.createElement('div', { style: { color: '#f0b232', marginTop: '20px', fontSize: '16px', fontWeight: 700, animation: 'pulse 1s infinite' } },
      'Opening pack...') : null,

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

    // --- Key Packs Section ---
    React.createElement('div', {
      style: { width: '100%', maxWidth: '900px', marginTop: '32px', borderTop: '2px solid #4e5058', paddingTop: '24px' }
    },
      React.createElement('div', { style: { textAlign: 'center', marginBottom: '20px' } },
        React.createElement('h3', { style: { color: '#f0b232', fontSize: '20px', fontWeight: 700, marginBottom: '4px' } }, 'Key Packs'),
        React.createElement('p', { style: { color: '#949ba4', fontSize: '13px' } }, 'Win keys from games to unlock special card packs')
      ),
      React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: isMobile ? '10px' : '14px', maxWidth: '900px', width: '100%'
        }
      },
        keyPacks.map(function(pack) {
          var keyCount = countKeys(pack.keyRequired);
          var canOpen = keyCount > 0;
          return React.createElement('div', {
            key: pack.id,
            style: {
              background: '#252528', borderRadius: '12px', border: '2px solid ' + pack.color,
              padding: isMobile ? '14px 8px' : '18px 12px', textAlign: 'center',
              opacity: canOpen ? 1 : 0.55, cursor: canOpen ? 'pointer' : 'default',
              transition: 'transform 0.2s, box-shadow 0.2s'
            },
            onMouseEnter: function(e) { if (canOpen) { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 6px 20px ' + pack.color + '30'; } },
            onMouseLeave: function(e) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }
          },
            React.createElement('img', { src: pack.img, style: { width: isMobile ? '48px' : '56px', height: isMobile ? '48px' : '56px', objectFit: 'contain', marginBottom: '6px' } }),
            React.createElement('div', { style: { color: pack.color, fontSize: isMobile ? '13px' : '14px', fontWeight: 700, marginBottom: '3px' } }, pack.name),
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', marginBottom: '3px' }
            },
              React.createElement('img', { src: pack.keyImg, style: { width: '14px', height: '14px', objectFit: 'contain' } }),
              React.createElement('span', { style: { color: '#949ba4', fontSize: '10px' } }, pack.keyName)
            ),
            React.createElement('div', { style: { color: '#949ba4', fontSize: isMobile ? '10px' : '11px', marginBottom: '4px', lineHeight: 1.3 } },
              pack.cards + ' cards - ' + pack.desc),
            React.createElement('div', {
              style: { color: keyCount > 0 ? '#57f287' : '#ed4245', fontSize: '11px', fontWeight: 600, marginBottom: '8px' }
            }, 'You have: ' + keyCount + ' key' + (keyCount !== 1 ? 's' : '')),
            React.createElement('button', {
              style: {
                padding: '6px 14px', border: 'none', borderRadius: '6px',
                background: canOpen ? pack.color : '#3a3c41',
                color: canOpen ? '#fff' : '#6b6f76',
                fontSize: '12px', fontWeight: 700, cursor: canOpen ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit', width: '100%'
              },
              onClick: function() {
                if (canOpen && sock && !opening) {
                  setResult(null);
                  setShowIdx(-1);
                  setOpening(true);
                  sock.emit('special_pack_open', { tier: pack.id });
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

// ---------- TCG Collection View ----------
function TCGCollectionView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectMarket(); }, []);
  var sock = ctx.marketSocket || ctx.socket;
  var [cards, setCards] = useState([]);
  var [loading, setLoading] = useState(true);
  var [rarityFilter, setRarityFilter] = useState('all');
  var [typeFilter, setTypeFilter] = useState('all');
  var [selling, setSelling] = useState(null);

  useEffect(function() {
    if (!sock) return;
    sock.emit('tcg_cards_get');

    function onCards(data) {
      setCards(data.cards || []);
      setLoading(false);
    }
    function onCardSold(data) {
      setSelling(null);
      // Remove sold card from list
      setCards(function(prev) {
        return prev.filter(function(c) { return c.id !== data.instanceId; });
      });
    }
    sock.on('tcg_cards_data', onCards);
    sock.on('tcg_card_sold', onCardSold);
    return function() {
      sock.off('tcg_cards_data', onCards);
      sock.off('tcg_card_sold', onCardSold);
    };
  }, [sock]);

  function sellCard(instanceId) {
    if (!sock || selling) return;
    setSelling(instanceId);
    sock.emit('tcg_card_sell', { instanceId: instanceId });
  }

  var panelStyle = { flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e', overflow: 'auto', padding: '24px' };

  if (loading) {
    return React.createElement('div', { style: panelStyle },
      React.createElement('p', { style: { color: '#949ba4', textAlign: 'center', marginTop: '40px' } }, 'Loading collection...')
    );
  }

  // Collect unique rarities and types for filter options
  var rarities = [];
  var types = [];
  var raritySet = {};
  var typeSet = {};
  cards.forEach(function(c) {
    var card = c.card || {};
    if (card.rarity && !raritySet[card.rarity]) { raritySet[card.rarity] = true; rarities.push(card.rarity); }
    if (card.type && !typeSet[card.type]) { typeSet[card.type] = true; types.push(card.type); }
  });

  // Sort rarities by power
  var rarityOrder = { godly: 0, secret: 1, mythic: 2, holographic: 3, legendary: 4, epic: 5, super_rare: 6, rare: 7, uncommon: 8, common: 9 };
  rarities.sort(function(a, b) { return (rarityOrder[a] || 10) - (rarityOrder[b] || 10); });
  types.sort();

  // Filter cards
  var filtered = cards.filter(function(c) {
    var card = c.card || {};
    if (rarityFilter !== 'all' && card.rarity !== rarityFilter) return false;
    if (typeFilter !== 'all' && card.type !== typeFilter) return false;
    return true;
  });

  // Sort by rarity (best first)
  filtered.sort(function(a, b) {
    var ra = a.card ? (rarityOrder[a.card.rarity] || 5) : 5;
    var rb = b.card ? (rarityOrder[b.card.rarity] || 5) : 5;
    return ra - rb;
  });

  var filterBtnStyle = function(active) {
    return {
      padding: '5px 12px', border: 'none', borderRadius: '6px',
      background: active ? '#f0b232' : '#4e5058',
      color: active ? '#1c1c1e' : '#dcddde',
      fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      textTransform: 'capitalize'
    };
  };

  return React.createElement('div', { style: panelStyle },
    React.createElement('h3', { style: { color: '#00d4ff', fontSize: '22px', fontWeight: 700, marginBottom: '8px' } }, 'Card Collection'),
    React.createElement('p', { style: { color: '#949ba4', fontSize: '13px', marginBottom: '16px' } },
      cards.length + ' cards collected'),

    // Rarity filters
    React.createElement('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' } },
      React.createElement('span', { style: { color: '#b5bac1', fontSize: '11px', fontWeight: 700, marginRight: '4px' } }, 'RARITY:'),
      React.createElement('button', {
        style: filterBtnStyle(rarityFilter === 'all'),
        onClick: function() { setRarityFilter('all'); }
      }, 'All'),
      rarities.map(function(r) {
        return React.createElement('button', {
          key: r, style: filterBtnStyle(rarityFilter === r),
          onClick: function() { setRarityFilter(r); }
        }, r);
      })
    ),

    // Type filters
    React.createElement('div', { style: { display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' } },
      React.createElement('span', { style: { color: '#b5bac1', fontSize: '11px', fontWeight: 700, marginRight: '4px' } }, 'TYPE:'),
      React.createElement('button', {
        style: filterBtnStyle(typeFilter === 'all'),
        onClick: function() { setTypeFilter('all'); }
      }, 'All'),
      types.map(function(t) {
        return React.createElement('button', {
          key: t, style: filterBtnStyle(typeFilter === t),
          onClick: function() { setTypeFilter(t); }
        }, t);
      })
    ),

    // Card grid
    filtered.length === 0
      ? React.createElement('p', { style: { color: '#72767d', textAlign: 'center', marginTop: '20px' } },
          rarityFilter === 'all' && typeFilter === 'all' ? 'No cards yet. Open packs to start collecting!' : 'No cards match the current filters.')
      : React.createElement('div', {
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px' }
        },
          filtered.map(function(cardData) {
            var card = cardData.card || {};
            var rarityColor = card.rarityColor || '#9e9e9e';
            var isShiny = !!card.shiny;
            var isUltraRareCollection = card.rarity === 'godly' || card.rarity === 'secret' || card.rarity === 'mythic' || card.rarity === 'holographic';
            // Determine holo/foil className
            var collClassName = '';
            if (isShiny) collClassName = 'holo-card';
            if (isUltraRareCollection) collClassName = 'foil-card';
            // Rarity glow animation
            var rarityGlowAnim = 'none';
            if (card.rarity === 'rare') rarityGlowAnim = 'rarityGlowBlue 2s ease infinite';
            else if (card.rarity === 'epic' || card.rarity === 'super_rare') rarityGlowAnim = 'rarityGlowPurple 2s ease infinite';
            else if (card.rarity === 'legendary') rarityGlowAnim = 'rarityGlowGold 2s ease infinite';
            else if (card.rarity === 'godly' || card.rarity === 'mythic' || card.rarity === 'secret' || card.rarity === 'holographic') rarityGlowAnim = 'rarityGlowRed 2s ease infinite';
            return React.createElement('div', {
              key: cardData.id,
              className: collClassName,
              style: {
                background: '#252528', borderRadius: '10px',
                border: isShiny ? '2px solid #ffd700' : '2px solid ' + rarityColor,
                textAlign: 'center', overflow: 'hidden',
                boxShadow: isShiny ? '0 0 15px rgba(255,215,0,0.5)' : '0 2px 8px rgba(0,0,0,0.3)',
                transition: 'transform 0.2s', position: 'relative',
                animation: rarityGlowAnim
              },
              onMouseEnter: function(e) { e.currentTarget.style.transform = 'translateY(-2px)'; },
              onMouseLeave: function(e) { e.currentTarget.style.transform = 'none'; }
            },
              // Shiny badge
              isShiny ? React.createElement('div', {
                style: {
                  position: 'absolute', top: '4px', right: '4px', background: '#ffd700',
                  color: '#1c1c1e', fontSize: '8px', fontWeight: 800, padding: '2px 5px',
                  borderRadius: '4px', zIndex: 2, letterSpacing: '0.5px'
                }
              }, 'SHINY') : null,
              // Card image
              card.img
                ? React.createElement('div', {
                    style: { width: '100%', height: '100px', background: '#18181b', overflow: 'hidden' }
                  },
                    React.createElement('img', {
                      src: card.img,
                      style: { width: '100%', height: '100%', objectFit: 'cover' }
                    })
                  )
                : React.createElement('div', {
                    style: { width: '100%', height: '100px', background: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px' }
                  }, '\u{1F409}'),
              // Card info
              React.createElement('div', { style: { padding: '10px' } },
                React.createElement('div', {
                  style: { color: '#dcddde', fontSize: '13px', fontWeight: 700, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
                }, card.name || 'Unknown'),
                React.createElement('div', {
                  style: { color: rarityColor, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '3px' }
                }, card.rarity || 'common'),
                React.createElement('div', {
                  style: { color: '#949ba4', fontSize: '10px', marginBottom: '6px', fontStyle: 'italic' }
                }, card.type || ''),
                // Stats with base comparison
                React.createElement('div', {
                  style: { display: 'flex', justifyContent: 'center', gap: '6px', fontSize: '11px', marginBottom: '8px' }
                },
                  React.createElement('span', { style: { color: card.baseAtk != null && card.atk != null ? (card.atk > card.baseAtk ? '#57f287' : card.atk < card.baseAtk ? '#ed4245' : '#ed4245') : '#ed4245', fontWeight: 700 } }, '\u2694' + (card.atk != null ? card.atk : '?')),
                  React.createElement('span', { style: { color: card.baseDef != null && card.def != null ? (card.def > card.baseDef ? '#57f287' : card.def < card.baseDef ? '#ed4245' : '#5865f2') : '#5865f2', fontWeight: 700 } }, '\u{1F6E1}' + (card.def != null ? card.def : '?')),
                  React.createElement('span', { style: { color: card.baseHp != null && card.hp != null ? (card.hp > card.baseHp ? '#57f287' : card.hp < card.baseHp ? '#ed4245' : '#57f287') : '#57f287', fontWeight: 700 } }, '\u2764' + (card.hp != null ? card.hp : '?'))
                ),
                // Sell button
                React.createElement('button', {
                  style: {
                    padding: '4px 10px', background: '#ed4245', border: 'none', borderRadius: '4px',
                    color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    opacity: selling === cardData.id ? 0.5 : 1, width: '100%'
                  },
                  onClick: function() { sellCard(cardData.id); },
                  disabled: selling === cardData.id
                }, 'Sell ' + (card.coinValue || 0) + ' chips')
              )
            );
          })
        )
  );
}

// ---------- TCG Battle View ----------
function TCGBattleView() {
  var ctx = useSocket();
  useEffect(function() { ctx.connectMarket(); }, []);
  var sock = ctx.marketSocket || ctx.socket;
  var [battle, setBattle] = useState(null);
  var [myCards, setMyCards] = useState([]);
  var [selectedDeck, setSelectedDeck] = useState([]);
  var [statusMsg, setStatusMsg] = useState('');
  var [view, setView] = useState('menu');
  var logEndRef = useRef(null);
  var prevLogLenRef = useRef(0);
  var [attackingSlot, setAttackingSlot] = useState(null);
  var slotElRefs = useRef({});

  // Table system state
  var [tables, setTables] = useState([]);
  var [currentTable, setCurrentTable] = useState(null);
  var [isReady, setIsReady] = useState(false);
  var [invites, setInvites] = useState([]);
  var [showFriendPicker, setShowFriendPicker] = useState(false);
  var [friendsData, setFriendsData] = useState(null);

  useEffect(function() {
    if (!sock) return;
    sock.emit('tcg_cards_get');
    sock.emit('tcg_list_tables');

    function onCards(data) { setMyCards(data.cards || []); }
    function onBattleStarted(data) {
      setBattle(data);
      setView('battle');
      setStatusMsg('');
      prevLogLenRef.current = (data && data.log) ? data.log.length : 0;
      setAttackingSlot(null);
      slotElRefs.current = {};
    }
    function onBattleUpdate(data) {
      // Process new battle log entries for sound effects and animations
      if (data && data.log && window.BossSounds) {
        var oldLen = prevLogLenRef.current;
        var newEntries = data.log.slice(oldLen);
        prevLogLenRef.current = data.log.length;
        newEntries.forEach(function(entry, entryIdx) {
          var delay = entryIdx * 150;
          if (entry.type === 'attack') {
            setTimeout(function() {
              if (window.BossSounds) window.BossSounds.play('hit');
              // Trigger attack lunge animation
              setAttackingSlot('atk-' + entryIdx);
              setTimeout(function() { setAttackingSlot(null); }, 400);
              // Show floating damage text on target slot element
              if (entry.damage && window.BossEffects) {
                var targetKey = 'opp-' + (entry.targetSlot || 0);
                var el = slotElRefs.current[targetKey];
                if (el) {
                  window.BossEffects.floatingText(el, '-' + entry.damage, { color: '#ed4245', fontSize: '22px' });
                }
              }
            }, delay);
          } else if (entry.type === 'ko') {
            setTimeout(function() {
              if (window.BossSounds) window.BossSounds.play('pop');
            }, delay);
          }
        });
      }
      setBattle(data);
      // If battle finished, reset table readiness so player can return to table
      if (data && data.state === 'finished') {
        setIsReady(false);
        // Play win/loss sound
        if (data.winner && sock && window.BossSounds) {
          if (data.winner === sock.id) {
            window.BossSounds.play('win_big');
          } else {
            window.BossSounds.play('loss');
          }
        }
      }
    }
    // Table events
    function onTableList(data) { setTables(data.tables || []); }
    function onTableCreated(data) { setCurrentTable(data); setIsReady(false); }
    function onTableJoined(data) { setCurrentTable(data); setIsReady(false); }
    function onTableUpdated(data) {
      setCurrentTable(data);
      // Sync local ready state with server
      if (data && sock) {
        var myId = sock.id;
        if (data.host && data.host.socketId === myId) {
          setIsReady(data.host.ready);
        } else if (data.guest && data.guest.socketId === myId) {
          setIsReady(data.guest.ready);
        }
      }
    }
    function onTableLeft() { setCurrentTable(null); setIsReady(false); }
    function onTableClosed(data) {
      setCurrentTable(null);
      setIsReady(false);
      setStatusMsg(data && data.reason ? data.reason : 'Table was closed');
      setTimeout(function() { setStatusMsg(''); }, 4000);
    }
    function onTableInvite(data) {
      setInvites(function(prev) {
        // Deduplicate by tableId
        var exists = false;
        for (var i = 0; i < prev.length; i++) {
          if (prev[i].tableId === data.tableId) { exists = true; break; }
        }
        if (exists) return prev;
        return prev.concat([data]);
      });
    }
    function onInviteSent() {
      setStatusMsg('Invite sent!');
      setShowFriendPicker(false);
      setTimeout(function() { setStatusMsg(''); }, 3000);
    }

    sock.on('tcg_cards_data', onCards);
    sock.on('tcg_battle_started', onBattleStarted);
    sock.on('tcg_battle_update', onBattleUpdate);
    sock.on('tcg_table_list', onTableList);
    sock.on('tcg_table_created', onTableCreated);
    sock.on('tcg_table_joined', onTableJoined);
    sock.on('tcg_table_updated', onTableUpdated);
    sock.on('tcg_table_left', onTableLeft);
    sock.on('tcg_table_closed', onTableClosed);
    sock.on('tcg_table_invite', onTableInvite);
    sock.on('tcg_invite_sent', onInviteSent);
    return function() {
      sock.off('tcg_cards_data', onCards);
      sock.off('tcg_battle_started', onBattleStarted);
      sock.off('tcg_battle_update', onBattleUpdate);
      sock.off('tcg_table_list', onTableList);
      sock.off('tcg_table_created', onTableCreated);
      sock.off('tcg_table_joined', onTableJoined);
      sock.off('tcg_table_updated', onTableUpdated);
      sock.off('tcg_table_left', onTableLeft);
      sock.off('tcg_table_closed', onTableClosed);
      sock.off('tcg_table_invite', onTableInvite);
      sock.off('tcg_invite_sent', onInviteSent);
    };
  }, [sock]);

  // Scroll battle log
  useEffect(function() {
    if (logEndRef.current) logEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [battle]);

  // Periodically refresh table list when browsing
  useEffect(function() {
    if (!sock || currentTable || (battle && view === 'battle')) return;
    var interval = setInterval(function() {
      sock.emit('tcg_list_tables');
    }, 5000);
    return function() { clearInterval(interval); };
  }, [sock, currentTable, battle, view]);

  // Load friends when friend picker is opened
  useEffect(function() {
    if (!showFriendPicker || !ctx.socket) return;
    ctx.socket.emit('friends_list_get');
    function onFriendsList(data) { setFriendsData(data); }
    ctx.socket.on('friends_list', onFriendsList);
    return function() { ctx.socket.off('friends_list', onFriendsList); };
  }, [showFriendPicker, ctx.socket]);

  // --- Table actions ---
  function createTable() {
    if (!sock) return;
    sock.emit('tcg_create_table', { isPrivate: false });
  }

  function joinTable(tableId) {
    if (!sock) return;
    sock.emit('tcg_join_table', { tableId: tableId });
  }

  function leaveTable() {
    if (!sock) return;
    sock.emit('tcg_leave_table');
  }

  function toggleReady() {
    if (!sock) return;
    sock.emit('tcg_ready');
  }

  function inviteFriend(friendKey) {
    if (!sock || !currentTable) return;
    sock.emit('tcg_invite_to_table', { targetKey: friendKey });
  }

  function acceptInvite(tableId) {
    if (!sock) return;
    setInvites(function(prev) { return prev.filter(function(inv) { return inv.tableId !== tableId; }); });
    sock.emit('tcg_join_table', { tableId: tableId });
  }

  function dismissInvite(tableId) {
    setInvites(function(prev) { return prev.filter(function(inv) { return inv.tableId !== tableId; }); });
  }

  // --- Battle actions (unchanged) ---
  function toggleDeckCard(instanceId) {
    setSelectedDeck(function(prev) {
      var exists = prev.indexOf(instanceId) !== -1;
      if (exists) return prev.filter(function(id) { return id !== instanceId; });
      if (prev.length >= 10) return prev;
      return prev.concat([instanceId]);
    });
  }

  function submitDeck() {
    if (!sock || selectedDeck.length < 5) return;
    var deck = selectedDeck.map(function(id) { return { instanceId: id }; });
    sock.emit('tcg_set_deck', { deck: deck });
  }

  function doAttack(targetSlot) {
    if (!sock) return;
    // Play whoosh sound for attack initiation
    if (window.BossSounds) window.BossSounds.play('whoosh');
    sock.emit('tcg_attack', { targetSlot: targetSlot || 0 });
  }

  function doSwitch(activeSlotIndex, deckIndex) {
    if (!sock) return;
    sock.emit('tcg_switch', { activeSlotIndex: activeSlotIndex, deckIndex: deckIndex });
  }

  function doSurrender() {
    if (!sock) return;
    sock.emit('tcg_surrender', {});
  }

  function leaveBattle() {
    setBattle(null);
    setSelectedDeck([]);
    setView('menu');
    setStatusMsg('');
    // Return to table if we were at one; reset readiness and refresh state
    if (currentTable) {
      setIsReady(false);
      sock.emit('tcg_list_tables');
    }
  }

  var panelStyle = { flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e', overflow: 'auto', padding: '24px' };
  var isMobile = useIsMobile();

  // Helper: find which player is me and which is opponent
  function getPlayers() {
    if (!battle || !battle.players) return { me: null, opp: null };
    var me = null;
    var opp = null;
    for (var i = 0; i < battle.players.length; i++) {
      if (battle.players[i].id === (sock && sock.id)) { me = battle.players[i]; me._idx = i; }
      else { opp = battle.players[i]; opp._idx = i; }
    }
    return { me: me, opp: opp };
  }

  // ===================== ACTIVE BATTLE VIEW =====================
  if (battle && view === 'battle') {
    var players = getPlayers();
    var me = players.me;
    var opp = players.opp;
    var isMyTurn = battle.currentTurn === (me ? me.id : null);
    var isFinished = battle.state === 'finished';
    var isSelecting = battle.state === 'selecting';
    var isFighting = battle.state === 'fighting';

    // Deck selection phase
    if (isSelecting) {
      var meReady = me ? me.ready : false;
      var rarityOrder = { godly: 0, secret: 1, mythic: 2, holographic: 3, legendary: 4, epic: 5, super_rare: 6, rare: 7, uncommon: 8, common: 9 };
      var sortedCards = myCards.slice().sort(function(a, b) {
        var ra = a.card ? (rarityOrder[a.card.rarity] || 10) : 10;
        var rb = b.card ? (rarityOrder[b.card.rarity] || 10) : 10;
        return ra - rb;
      });

      return React.createElement('div', { style: panelStyle },
        React.createElement('h3', { style: { color: '#9b59b6', fontSize: '20px', fontWeight: 700, marginBottom: '8px', textAlign: 'center' } },
          'Select Your Deck'),
        React.createElement('p', { style: { color: '#949ba4', fontSize: '13px', textAlign: 'center', marginBottom: '4px' } },
          'Choose 5-10 cards for battle. (' + selectedDeck.length + '/10 selected)'),
        meReady
          ? React.createElement('div', { style: { color: '#57f287', fontSize: '15px', fontWeight: 700, textAlign: 'center', marginBottom: '16px' } },
              'Deck submitted! Waiting for opponent...')
          : React.createElement('div', { style: { textAlign: 'center', marginBottom: '16px' } },
              React.createElement('button', {
                style: {
                  padding: '8px 24px', background: selectedDeck.length >= 5 ? '#57f287' : '#4e5058',
                  border: 'none', borderRadius: '6px', color: '#1c1c1e', fontSize: '14px',
                  fontWeight: 700, cursor: selectedDeck.length >= 5 ? 'pointer' : 'default',
                  fontFamily: 'inherit', opacity: selectedDeck.length >= 5 ? 1 : 0.5
                },
                onClick: submitDeck,
                disabled: selectedDeck.length < 5
              }, 'Submit Deck (' + selectedDeck.length + ' cards)')
            ),

        // Card selection grid
        React.createElement('div', {
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px' }
        },
          sortedCards.map(function(cardData) {
            var card = cardData.card || {};
            var rarityColor = card.rarityColor || '#9e9e9e';
            var isSelected = selectedDeck.indexOf(cardData.id) !== -1;
            var isShinyDeck = !!card.shiny;
            var borderColorDeck = isSelected ? '#57f287' : (isShinyDeck ? '#ffd700' : rarityColor);
            // Holo/foil class for deck selection cards
            var deckCardClass = '';
            var isDeckUltraRare = card.rarity === 'godly' || card.rarity === 'secret' || card.rarity === 'mythic' || card.rarity === 'holographic';
            if (isShinyDeck) deckCardClass = 'holo-card';
            if (isDeckUltraRare) deckCardClass = 'foil-card';
            return React.createElement('div', {
              key: cardData.id,
              className: deckCardClass,
              style: {
                background: isSelected ? '#2a3a2a' : '#252528', borderRadius: '10px',
                border: '2px solid ' + borderColorDeck,
                textAlign: 'center', overflow: 'hidden', cursor: meReady ? 'default' : 'pointer',
                opacity: meReady ? 0.6 : 1,
                boxShadow: isSelected ? '0 0 12px rgba(87,242,135,0.3)' : (isShinyDeck ? '0 0 15px rgba(255,215,0,0.5)' : 'none'),
                transition: 'all 0.2s', position: 'relative'
              },
              onClick: function() { if (!meReady) toggleDeckCard(cardData.id); }
            },
              isShinyDeck ? React.createElement('div', {
                style: {
                  position: 'absolute', top: '4px', right: '4px', background: '#ffd700',
                  color: '#1c1c1e', fontSize: '8px', fontWeight: 800, padding: '2px 5px',
                  borderRadius: '4px', zIndex: 2, letterSpacing: '0.5px'
                }
              }, 'SHINY') : null,
              isSelected ? React.createElement('div', {
                style: { background: '#57f287', color: '#1c1c1e', fontSize: '10px', fontWeight: 700, padding: '2px' }
              }, 'SELECTED') : null,
              card.img
                ? React.createElement('div', {
                    style: { width: '100%', height: '80px', background: '#18181b', overflow: 'hidden' }
                  }, React.createElement('img', { src: card.img, style: { width: '100%', height: '100%', objectFit: 'cover' } }))
                : React.createElement('div', {
                    style: { width: '100%', height: '80px', background: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px' }
                  }, '\u{1F409}'),
              React.createElement('div', { style: { padding: '8px' } },
                React.createElement('div', { style: { color: '#dcddde', fontSize: '12px', fontWeight: 700, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, card.name || 'Unknown'),
                React.createElement('div', { style: { color: rarityColor, fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '3px' } }, card.rarity || ''),
                React.createElement('div', { style: { display: 'flex', justifyContent: 'center', gap: '4px', fontSize: '10px' } },
                  React.createElement('span', { style: { color: card.baseAtk != null && card.atk != null ? (card.atk > card.baseAtk ? '#57f287' : card.atk < card.baseAtk ? '#ed4245' : '#ed4245') : '#ed4245', fontWeight: 700 } }, '\u2694' + (card.atk || 0)),
                  React.createElement('span', { style: { color: card.baseDef != null && card.def != null ? (card.def > card.baseDef ? '#57f287' : card.def < card.baseDef ? '#ed4245' : '#5865f2') : '#5865f2', fontWeight: 700 } }, '\u{1F6E1}' + (card.def || 0)),
                  React.createElement('span', { style: { color: card.baseHp != null && card.hp != null ? (card.hp > card.baseHp ? '#57f287' : card.hp < card.baseHp ? '#ed4245' : '#57f287') : '#57f287', fontWeight: 700 } }, '\u2764' + (card.hp || 0))
                )
              )
            );
          })
        )
      );
    }

    // Fighting / Finished phase
    var hpBarStyle = function(current, max) {
      return {
        width: '100%', height: '10px', background: '#18181b', borderRadius: '5px',
        overflow: 'hidden', marginTop: '4px', position: 'relative'
      };
    };

    var hpFillStyle = function(current, max) {
      var pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
      return {
        width: pct + '%', height: '100%',
        background: pct > 50 ? '#57f287' : pct > 20 ? '#f0b232' : '#ed4245',
        borderRadius: '5px', transition: 'width 0.5s ease'
      };
    };

    function renderSlotCard(slotData, player, slotIdx, isMe) {
      if (!slotData || !slotData.alive) {
        return React.createElement('div', {
          key: 'empty-' + slotIdx,
          style: { width: '160px', height: '200px', background: '#18181b', borderRadius: '10px', border: '2px dashed #4e5058', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#72767d', fontSize: '12px' }
        }, 'Empty Slot');
      }
      var ac = slotData.card;
      var hp = slotData.currentHp != null ? slotData.currentHp : (ac ? ac.hp : 0);
      var maxHp = ac ? ac.hp : 1;
      var acShiny = ac && ac.shiny;
      var borderColor = (!isMe && isMyTurn && !isFinished) ? '#ed4245' : (acShiny ? '#ffd700' : '#4e5058');
      // Check if this slot is currently being attacked (lunge animation)
      var isLunging = attackingSlot !== null && isMe;
      // Determine holo/foil class for battle cards
      var battleCardClass = '';
      var acIsUltraRare = ac && (ac.rarity === 'godly' || ac.rarity === 'secret' || ac.rarity === 'mythic' || ac.rarity === 'holographic');
      if (acShiny) battleCardClass = 'holo-card';
      if (acIsUltraRare) battleCardClass = 'foil-card';
      return React.createElement('div', {
        key: 'slot-' + slotIdx,
        className: battleCardClass,
        ref: function(el) {
          // Store ref for floating damage text fired from onBattleUpdate
          if (!isMe) {
            slotElRefs.current['opp-' + slotIdx] = el;
          }
        },
        style: {
          background: '#252528', borderRadius: '10px', padding: '10px',
          border: '2px solid ' + borderColor, width: '160px', textAlign: 'center', position: 'relative',
          boxShadow: (!isMe && isMyTurn && !isFinished) ? '0 0 12px rgba(237,66,69,0.4)' : (acShiny ? '0 0 12px rgba(255,215,0,0.4)' : 'none'),
          cursor: (!isMe && isMyTurn && !isFinished) ? 'pointer' : 'default',
          animation: isLunging ? 'attackLunge 0.4s ease' : 'none'
        },
        onClick: function() { if (!isMe && isMyTurn && !isFinished) doAttack(slotIdx); }
      },
        acShiny ? React.createElement('div', {
          style: { position: 'absolute', top: '4px', right: '4px', background: '#ffd700', color: '#1c1c1e', fontSize: '8px', fontWeight: 800, padding: '1px 5px', borderRadius: '3px', zIndex: 2 }
        }, 'SHINY') : null,
        React.createElement('div', { style: { position: 'absolute', top: '4px', left: '4px', background: '#4e5058', color: '#dcddde', fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px' } },
          isMe ? 'Slot ' + (slotIdx + 1) : (isMyTurn ? 'Click to attack' : 'Slot ' + (slotIdx + 1))),
        ac && ac.img
          ? React.createElement('div', {
              style: { width: '80px', height: '80px', margin: '16px auto 6px', borderRadius: '6px', overflow: 'hidden', background: '#18181b' }
            }, React.createElement('img', { src: ac.img, style: { width: '100%', height: '100%', objectFit: 'cover' } }))
          : React.createElement('div', {
              style: { width: '80px', height: '80px', margin: '16px auto 6px', borderRadius: '6px', background: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px' }
            }, '\u{1F409}'),
        React.createElement('div', { style: { color: '#dcddde', fontSize: '12px', fontWeight: 700, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, ac ? ac.name : '?'),
        React.createElement('div', { style: { color: '#949ba4', fontSize: '10px', fontStyle: 'italic', marginBottom: '3px' } }, ac ? ac.type : ''),
        ac ? React.createElement('div', { style: { display: 'flex', justifyContent: 'center', gap: '6px', fontSize: '10px', marginBottom: '4px' } },
          React.createElement('span', { style: { color: '#ed4245', fontWeight: 700 } }, '\u2694' + (ac.atk || 0)),
          React.createElement('span', { style: { color: '#5865f2', fontWeight: 700 } }, '\u{1F6E1}' + (ac.def || 0))
        ) : null,
        React.createElement('div', { style: { fontSize: '10px', color: '#57f287', fontWeight: 700 } }, 'HP: ' + hp + '/' + maxHp),
        React.createElement('div', { style: hpBarStyle(hp, maxHp) },
          React.createElement('div', { style: hpFillStyle(hp, maxHp) })
        )
      );
    }

    function renderPlayerField(player, label, isMe) {
      if (!player) return null;
      var slots = player.activeSlots || [];
      var hasSynergy = player.hasSynergy;
      return React.createElement('div', {
        style: { textAlign: 'center', minWidth: '200px' }
      },
        React.createElement('div', { style: { color: player.color || '#dcddde', fontSize: '14px', fontWeight: 700, marginBottom: '6px' } },
          label + ': ' + (player.name || 'Player')),
        hasSynergy ? React.createElement('div', {
          style: { color: '#ffd700', fontSize: '11px', fontWeight: 700, marginBottom: '6px', padding: '2px 8px', background: 'rgba(255,215,0,0.1)', borderRadius: '4px', display: 'inline-block' }
        }, '\u2728 SYNERGY ACTIVE (+15% ATK)') : null,
        React.createElement('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
          slots.length > 0 ? slots.map(function(slot, si) {
            return renderSlotCard(slot, player, si, isMe);
          }) : React.createElement('div', { style: { color: '#72767d', padding: '20px' } }, 'No active cards')
        ),
        React.createElement('div', { style: { color: '#949ba4', fontSize: '11px', marginTop: '6px' } },
          'Cards alive: ' + (player.cardsAlive || 0) + '/' + (player.totalCards || 0) +
          (player.bench && player.bench.length > 0 ? ' (' + player.bench.length + ' on bench)' : ''))
      );
    }

    return React.createElement('div', { style: panelStyle },
      // Battle header
      React.createElement('div', { style: { textAlign: 'center', marginBottom: '16px' } },
        React.createElement('h3', { style: { color: '#9b59b6', fontSize: '20px', fontWeight: 700, marginBottom: '4px' } },
          isFinished ? 'Battle Complete!' : 'Round ' + (battle.round || 1)),
        !isFinished && isFighting ? React.createElement('div', {
          style: { color: isMyTurn ? '#57f287' : '#f0b232', fontSize: '14px', fontWeight: 600 }
        }, isMyTurn ? 'Your turn!' : 'Opponent\'s turn...') : null,
        isFinished ? React.createElement('div', {
          style: { color: battle.winner === (sock && sock.id) ? '#57f287' : '#ed4245', fontSize: '18px', fontWeight: 700, marginTop: '8px' }
        }, battle.winner === (sock && sock.id) ? 'You Won!' : 'You Lost!') : null
      ),

      // Active cards face-off
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'center', gap: '24px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }
      },
        renderPlayerField(me, 'You', true),
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', fontSize: '28px', color: '#f0b232', fontWeight: 800, alignSelf: 'center', padding: '0 8px' }
        }, 'VS'),
        renderPlayerField(opp, 'Opponent', false)
      ),

      // Target hint
      isFighting && isMyTurn && !isFinished ? React.createElement('div', {
        style: { textAlign: 'center', color: '#949ba4', fontSize: '12px', marginBottom: '8px' }
      }, 'Click an opponent\'s card to attack it, or use the buttons below') : null,

      // Action buttons
      isFighting && isMyTurn && !isFinished ? React.createElement('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'center', marginBottom: '16px' }
      },
        React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' } },
          opp && opp.activeSlots ? opp.activeSlots.map(function(slot, si) {
            if (!slot || !slot.alive) return null;
            return React.createElement('button', {
              key: 'atk-' + si,
              style: {
                padding: '10px 20px', background: '#ed4245', border: 'none', borderRadius: '8px',
                color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                boxShadow: '0 2px 8px rgba(237,66,69,0.3)'
              },
              onClick: function() { doAttack(si); }
            }, '\u2694 Attack ' + (slot.card ? slot.card.name : 'Slot ' + (si + 1)));
          }) : React.createElement('button', {
            style: {
              padding: '10px 28px', background: '#ed4245', border: 'none', borderRadius: '8px',
              color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 2px 8px rgba(237,66,69,0.3)'
            },
            onClick: function() { doAttack(0); }
          }, '\u2694 Attack')
        ),

        me && me.bench && me.bench.length > 0 ? React.createElement('div', {
          style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '4px' }
        },
          React.createElement('span', { style: { color: '#949ba4', fontSize: '11px', alignSelf: 'center', marginRight: '4px' } }, 'Swap into Slot:'),
          [0, 1].map(function(slotI) {
            return me.bench.map(function(benchCard) {
              var c = benchCard.card || {};
              return React.createElement('button', {
                key: 'sw-' + slotI + '-' + benchCard.deckIndex,
                style: {
                  padding: '6px 10px', background: '#5865f2', border: 'none', borderRadius: '6px',
                  color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
                },
                onClick: function() { doSwitch(slotI, benchCard.deckIndex); }
              }, '\u{1F504} ' + (c.name || '?') + ' \u2192 Slot ' + (slotI + 1));
            });
          })
        ) : null,

        React.createElement('button', {
          style: {
            padding: '8px 18px', background: '#4e5058', border: 'none', borderRadius: '8px',
            color: '#dcddde', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', marginTop: '4px'
          },
          onClick: doSurrender
        }, '\u{1F3F3} Surrender')
      ) : null,

      // Leave button when finished
      isFinished ? React.createElement('div', { style: { textAlign: 'center', marginBottom: '16px' } },
        React.createElement('button', {
          style: {
            padding: '10px 28px', background: '#f0b232', border: 'none', borderRadius: '8px',
            color: '#1c1c1e', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: leaveBattle
        }, 'Leave Battle')
      ) : null,

      // Battle log
      battle.log && battle.log.length > 0 ? React.createElement('div', {
        style: {
          background: '#252528', borderRadius: '10px', border: '1px solid #4e5058',
          padding: '12px', maxHeight: '200px', overflow: 'auto', marginTop: '8px'
        }
      },
        React.createElement('div', { style: { color: '#b5bac1', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' } }, 'Battle Log'),
        battle.log.map(function(entry, idx) {
          var logColor = '#949ba4';
          var logText = '';
          if (entry.type === 'attack') {
            var effText = '';
            if (entry.typeEffective === 'super_effective') { effText = ' (Super Effective! x' + (entry.typeMultiplier || 1.5) + ')'; logColor = '#57f287'; }
            else if (entry.typeEffective === 'not_effective') { effText = ' (Not Effective x' + (entry.typeMultiplier || 0.7) + ')'; logColor = '#ed4245'; }
            else { effText = ''; logColor = '#dcddde'; }
            var synergyText = entry.synergy ? ' [SYNERGY]' : '';
            var secondaryText = entry.secondaryCard ? ' + ' + entry.secondaryCard : '';
            logText = (entry.attacker || 'Attacker') + '\'s ' + (entry.attackerCard || '?') + secondaryText + synergyText + ' dealt ' + (entry.damage || 0) + ' damage to ' + (entry.defenderCard || '?') + effText;
          } else if (entry.type === 'ko') {
            logColor = '#ed4245';
            logText = (entry.card || 'A card') + ' (' + (entry.player || '') + ') was knocked out!';
          } else if (entry.type === 'deploy') {
            logColor = '#00d4ff';
            logText = (entry.player || 'Player') + ' deployed ' + (entry.card || 'a card') + ' to Slot ' + ((entry.slot || 0) + 1);
          } else if (entry.type === 'switch') {
            logColor = '#5865f2';
            logText = (entry.player || 'Player') + ' swapped ' + (entry.oldCard || 'a card') + ' for ' + (entry.card || 'a new card') + ' in Slot ' + ((entry.slot || 0) + 1);
          } else if (entry.type === 'victory') {
            logColor = '#f0b232';
            logText = (entry.winner || 'A player') + ' wins the battle!';
          } else if (entry.type === 'surrender') {
            logColor = '#f0b232';
            logText = (entry.player || 'A player') + ' surrendered!';
          } else if (entry.type === 'start') {
            logColor = '#9b59b6';
            logText = entry.msg || 'Battle begins!';
          } else {
            logText = entry.msg || entry.message || JSON.stringify(entry);
          }
          return React.createElement('div', {
            key: idx,
            style: { color: logColor, fontSize: '12px', marginBottom: '4px', padding: '2px 0', borderBottom: '1px solid #1c1c1e' }
          }, logText);
        }),
        React.createElement('div', { ref: logEndRef })
      ) : null
    );
  }

  // ===================== WAITING ROOM VIEW =====================
  // When sitting at a table but battle hasn't started
  if (currentTable && currentTable.state !== 'battling') {
    var amHost = currentTable.host && sock && currentTable.host.socketId === sock.id;
    var amGuest = currentTable.guest && sock && currentTable.guest.socketId === sock.id;
    var hasGuest = !!currentTable.guest;

    // Player seat renderer
    function renderSeat(playerData, label, isSelf) {
      if (!playerData) {
        return React.createElement('div', {
          style: {
            background: '#1c1c1e', borderRadius: '12px', border: '2px dashed #4e5058',
            padding: '24px', textAlign: 'center', flex: 1, minWidth: '180px'
          }
        },
          React.createElement('div', { style: { color: '#72767d', fontSize: '14px', fontWeight: 600 } }, label),
          React.createElement('div', { style: { color: '#4e5058', fontSize: '32px', margin: '12px 0' } }, '?'),
          React.createElement('div', { style: { color: '#72767d', fontSize: '12px' } }, 'Waiting for opponent...')
        );
      }
      var readyColor = playerData.ready ? '#57f287' : '#72767d';
      var readyText = playerData.ready ? 'Ready' : 'Not Ready';
      return React.createElement('div', {
        style: {
          background: '#252528', borderRadius: '12px', border: '2px solid ' + (playerData.ready ? '#57f287' : '#4e5058'),
          padding: '24px', textAlign: 'center', flex: 1, minWidth: '180px',
          boxShadow: playerData.ready ? '0 0 16px rgba(87,242,135,0.2)' : 'none',
          transition: 'all 0.3s ease'
        }
      },
        React.createElement('div', { style: { color: '#949ba4', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' } }, label),
        React.createElement('div', { style: { color: playerData.color || '#dcddde', fontSize: '18px', fontWeight: 700, marginBottom: '4px' } }, playerData.name || 'Player'),
        React.createElement('div', { style: { color: '#949ba4', fontSize: '12px', marginBottom: '8px' } }, playerData.cardCount + ' cards'),
        React.createElement('div', { style: { color: readyColor, fontSize: '13px', fontWeight: 700, padding: '4px 12px', background: playerData.ready ? 'rgba(87,242,135,0.1)' : 'rgba(114,118,125,0.1)', borderRadius: '6px', display: 'inline-block' } }, readyText)
      );
    }

    // Friend picker overlay
    var friendPickerOverlay = null;
    if (showFriendPicker) {
      var onlineFriends = [];
      if (friendsData && friendsData.friends) {
        for (var fi = 0; fi < friendsData.friends.length; fi++) {
          if (friendsData.friends[fi].online) onlineFriends.push(friendsData.friends[fi]);
        }
      }
      friendPickerOverlay = React.createElement('div', {
        style: {
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        },
        onClick: function(e) { if (e.target === e.currentTarget) setShowFriendPicker(false); }
      },
        React.createElement('div', {
          style: {
            background: '#1c1c1e', borderRadius: '12px', border: '1px solid #4e5058',
            padding: '24px', maxWidth: '400px', width: '90%', maxHeight: '60vh', overflow: 'auto'
          }
        },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' } },
            React.createElement('h4', { style: { color: '#f0b232', fontSize: '16px', fontWeight: 700, margin: 0 } }, 'Invite Friend'),
            React.createElement('button', {
              style: { background: 'none', border: 'none', color: '#949ba4', fontSize: '18px', cursor: 'pointer', padding: '4px' },
              onClick: function() { setShowFriendPicker(false); }
            }, '\u2715')
          ),
          onlineFriends.length === 0
            ? React.createElement('div', { style: { color: '#72767d', fontSize: '13px', textAlign: 'center', padding: '20px' } },
                'No friends online')
            : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                onlineFriends.map(function(f) {
                  return React.createElement('div', {
                    key: f.key,
                    style: {
                      display: 'flex', alignItems: 'center', padding: '10px 12px', gap: '10px',
                      background: '#252528', borderRadius: '8px', cursor: 'pointer', transition: 'background 0.2s'
                    },
                    onClick: function() { inviteFriend(f.key); },
                    onMouseEnter: function(e) { e.currentTarget.style.background = '#2a2a2e'; },
                    onMouseLeave: function(e) { e.currentTarget.style.background = '#252528'; }
                  },
                    React.createElement('div', {
                      style: { width: '8px', height: '8px', borderRadius: '50%', background: '#57f287', flexShrink: 0 }
                    }),
                    React.createElement('span', { style: { color: f.color || '#dcddde', fontWeight: 600, flex: 1, fontSize: '14px' } }, f.username),
                    React.createElement('span', { style: { color: '#f0b232', fontSize: '12px', fontWeight: 600 } }, 'Invite')
                  );
                })
              )
        )
      );
    }

    return React.createElement('div', { style: panelStyle },
      friendPickerOverlay,
      // Table header
      React.createElement('div', { style: { textAlign: 'center', marginBottom: '24px' } },
        React.createElement('h3', { style: { color: '#f0b232', fontSize: '22px', fontWeight: 700, marginBottom: '4px' } },
          currentTable.name || 'Battle Table'),
        React.createElement('div', { style: { color: '#949ba4', fontSize: '13px' } },
          currentTable.state === 'waiting' ? 'Waiting for players to ready up...' : 'Battle in progress')
      ),

      // Player seats
      React.createElement('div', {
        style: { display: 'flex', gap: '16px', justifyContent: 'center', marginBottom: '24px', flexWrap: 'wrap' }
      },
        renderSeat(currentTable.host, 'Host', amHost),
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', fontSize: '24px', color: '#f0b232', fontWeight: 800, padding: '0 4px' }
        }, 'VS'),
        renderSeat(currentTable.guest, 'Challenger', amGuest)
      ),

      // Status message
      statusMsg ? React.createElement('div', {
        style: { textAlign: 'center', color: '#57f287', fontSize: '13px', marginBottom: '12px', fontWeight: 600 }
      }, statusMsg) : null,

      // Action buttons
      React.createElement('div', {
        style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '16px' }
      },
        // Invite friend button (only when table has space)
        !hasGuest ? React.createElement('button', {
          style: {
            padding: '10px 20px', background: '#5865f2', border: 'none', borderRadius: '8px',
            color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { setShowFriendPicker(true); }
        }, 'Invite Friend') : null,

        // Ready button (only when both seats are filled)
        hasGuest ? React.createElement('button', {
          style: {
            padding: '10px 24px', background: isReady ? '#57f287' : '#f0b232', border: 'none', borderRadius: '8px',
            color: '#1c1c1e', fontSize: '14px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: isReady ? '0 0 12px rgba(87,242,135,0.3)' : '0 0 12px rgba(240,178,50,0.3)',
            transition: 'all 0.2s'
          },
          onClick: toggleReady
        }, isReady ? 'Cancel Ready' : 'Ready Up') : null,

        // Leave button
        React.createElement('button', {
          style: {
            padding: '10px 20px', background: '#4e5058', border: 'none', borderRadius: '8px',
            color: '#dcddde', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: leaveTable
        }, 'Leave Table')
      ),

      // Card count info
      React.createElement('div', {
        style: {
          background: '#252528', borderRadius: '10px', padding: '16px',
          border: '1px solid #4e5058', maxWidth: '400px', alignSelf: 'center', width: '100%', textAlign: 'center'
        }
      },
        React.createElement('div', { style: { color: '#949ba4', fontSize: '12px', marginBottom: '4px' } },
          'Your collection: ' + myCards.length + ' cards'),
        React.createElement('div', { style: { color: '#72767d', fontSize: '11px' } },
          'When both players are ready, you will select your battle deck.')
      )
    );
  }

  // ===================== TABLE BROWSER VIEW =====================
  // When not at a table and no active battle
  return React.createElement('div', { style: panelStyle },
    React.createElement('h3', { style: { color: '#f0b232', fontSize: '22px', fontWeight: 700, marginBottom: '4px', textAlign: 'center' } },
      'Card Battle - Tables'),
    React.createElement('p', { style: { color: '#949ba4', fontSize: '13px', textAlign: 'center', marginBottom: '20px' } },
      'Create or join a table for 1v1 card battles!'),

    // Status message
    statusMsg ? React.createElement('div', {
      style: { textAlign: 'center', color: '#f0b232', fontSize: '13px', marginBottom: '12px', fontWeight: 600,
        background: 'rgba(240,178,50,0.1)', padding: '8px 16px', borderRadius: '8px', alignSelf: 'center' }
    }, statusMsg) : null,

    // Create table button
    React.createElement('div', { style: { textAlign: 'center', marginBottom: '20px' } },
      React.createElement('button', {
        style: {
          padding: '12px 32px', background: '#f0b232', border: 'none', borderRadius: '10px',
          color: '#1c1c1e', fontSize: '15px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
          boxShadow: '0 4px 16px rgba(240,178,50,0.3)', transition: 'transform 0.2s'
        },
        onClick: createTable,
        onMouseEnter: function(e) { e.currentTarget.style.transform = 'translateY(-2px)'; },
        onMouseLeave: function(e) { e.currentTarget.style.transform = 'none'; }
      }, '+ Create Table')
    ),

    // Pending invites
    invites.length > 0 ? React.createElement('div', {
      style: { marginBottom: '20px', maxWidth: '600px', alignSelf: 'center', width: '100%' }
    },
      React.createElement('div', { style: { color: '#f0b232', fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' } },
        'Invitations (' + invites.length + ')'),
      invites.map(function(inv) {
        return React.createElement('div', {
          key: inv.tableId,
          style: {
            display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
            background: '#2a2a1a', borderRadius: '10px', border: '1px solid #f0b232',
            marginBottom: '6px'
          }
        },
          React.createElement('div', { style: { flex: 1 } },
            React.createElement('div', { style: { color: inv.fromColor || '#dcddde', fontSize: '14px', fontWeight: 700 } }, inv.fromName || 'Someone'),
            React.createElement('div', { style: { color: '#949ba4', fontSize: '11px' } }, 'Invited you to their table')
          ),
          React.createElement('button', {
            style: {
              padding: '6px 14px', background: '#57f287', border: 'none', borderRadius: '6px',
              color: '#1c1c1e', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
            },
            onClick: function() { acceptInvite(inv.tableId); }
          }, 'Join'),
          React.createElement('button', {
            style: {
              padding: '6px 14px', background: '#4e5058', border: 'none', borderRadius: '6px',
              color: '#dcddde', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
            },
            onClick: function() { dismissInvite(inv.tableId); }
          }, 'Dismiss')
        );
      })
    ) : null,

    // Table list
    tables.length === 0
      ? React.createElement('div', {
          style: {
            textAlign: 'center', padding: '40px 20px', color: '#72767d', fontSize: '14px',
            background: '#252528', borderRadius: '12px', maxWidth: '500px', alignSelf: 'center', width: '100%'
          }
        },
          React.createElement('div', { style: { fontSize: '36px', marginBottom: '12px' } }, '\u2694'),
          'No tables open. Create one and invite a friend!')
      : React.createElement('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '12px', maxWidth: '800px', alignSelf: 'center', width: '100%'
          }
        },
          tables.map(function(t) {
            var hostName = t.host ? t.host.name : 'Unknown';
            var hostColor = t.host ? t.host.color : '#dcddde';
            var hostCards = t.host ? t.host.cardCount : 0;
            var guestName = t.guest ? t.guest.name : null;
            var isFull = !!t.guest;
            return React.createElement('div', {
              key: t.id,
              style: {
                background: '#252528', borderRadius: '12px', border: '1px solid #4e5058',
                padding: '16px', transition: 'border-color 0.2s, box-shadow 0.2s',
                cursor: isFull ? 'default' : 'pointer'
              },
              onMouseEnter: function(e) { if (!isFull) { e.currentTarget.style.borderColor = '#f0b232'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(240,178,50,0.15)'; } },
              onMouseLeave: function(e) { e.currentTarget.style.borderColor = '#4e5058'; e.currentTarget.style.boxShadow = 'none'; }
            },
              // Host info
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
                React.createElement('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: '#57f287', flexShrink: 0 } }),
                React.createElement('span', { style: { color: hostColor, fontSize: '15px', fontWeight: 700, flex: 1 } }, hostName),
                React.createElement('span', { style: { color: '#949ba4', fontSize: '11px' } }, hostCards + ' cards')
              ),
              // Guest info
              React.createElement('div', { style: { color: '#72767d', fontSize: '12px', marginBottom: '12px', paddingLeft: '16px' } },
                guestName
                  ? React.createElement('span', { style: { color: '#dcddde' } }, 'vs ' + guestName)
                  : 'Waiting for opponent...'
              ),
              // Join button
              !isFull ? React.createElement('button', {
                style: {
                  padding: '8px 0', background: '#f0b232', border: 'none', borderRadius: '6px',
                  color: '#1c1c1e', fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  width: '100%'
                },
                onClick: function() { joinTable(t.id); }
              }, 'Join Table') : React.createElement('div', {
                style: {
                  padding: '8px 0', background: '#4e5058', borderRadius: '6px',
                  color: '#949ba4', fontSize: '13px', fontWeight: 600, textAlign: 'center'
                }
              }, 'Table Full')
            );
          })
        ),

    // My cards count
    React.createElement('div', {
      style: {
        marginTop: '24px', textAlign: 'center', padding: '12px',
        background: '#252528', borderRadius: '10px', border: '1px solid #4e5058',
        maxWidth: '400px', alignSelf: 'center', width: '100%'
      }
    },
      React.createElement('div', { style: { color: '#949ba4', fontSize: '12px' } },
        'Your collection: ' + myCards.length + ' cards' + (myCards.length < 5 ? ' (need 5+ to battle)' : ''))
    )
  );
}
