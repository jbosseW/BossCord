function ProfileView(props) {
  var onTabChange = props && props.onTabChange;
  var ctx = useSocket();
  var [profile, setProfile] = useState(null);
  var [filter, setFilter] = useState('all');
  var [selling, setSelling] = useState(null);
  var [showAvatarPicker, setShowAvatarPicker] = useState(false);
  var [portraits, setPortraits] = useState([]);
  var [profileTab, setProfileTab] = useState('overview');
  var [profileCards, setProfileCards] = useState([]);
  var [cardRarityFilter, setCardRarityFilter] = useState('all');
  var [cardTypeFilter, setCardTypeFilter] = useState('all');
  var [showcase, setShowcase] = useState([]);
  var [showcaseEditing, setShowcaseEditing] = useState(false);
  var [, forceRender] = useState(0);
  var [dailyChallenges, setDailyChallenges] = useState([]);
  var [challengeResetIn, setChallengeResetIn] = useState(0);
  var [achievements, setAchievements] = useState([]);
  var challengeTimerRef = useRef(null);
  var isMobile = useIsMobile();

  useEffect(function() {
    if (!ctx.socket) return;
    ctx.socket.emit('profile_get', {});
    ctx.socket.emit('tcg_cards_get');
    function onProfile(data) {
      setProfile(data);
      if (data.showcase) setShowcase(data.showcase);
    }
    function onPortraits(data) { setPortraits(data.portraits || []); }
    function onEquipped(data) {
      setProfile(function(prev) { return prev ? Object.assign({}, prev, { equipped: data }) : prev; });
    }
    function onAvatarUpdated(data) {
      setProfile(function(prev) { return prev ? Object.assign({}, prev, { avatar: data.avatar, avatarId: data.avatarId }) : prev; });
      setShowAvatarPicker(false);
    }
    function onSold(data) {
      setSelling(null);
    }
    function onInventory(data) {
      setProfile(function(prev) {
        if (!prev) return prev;
        var enriched = (data.inventory || []).map(function(invItem) {
          return invItem;
        });
        return Object.assign({}, prev, { inventory: enriched, equipped: data.equipped || prev.equipped });
      });
    }
    function onCards(data) { setProfileCards(data.cards || []); }
    function onCardSold(data) {
      setProfileCards(function(prev) {
        return prev.filter(function(c) { return c.id !== data.instanceId; });
      });
    }
    function onDailyChallenges(data) {
      setDailyChallenges(data.challenges || []);
      setChallengeResetIn(data.resetIn || 0);
    }
    function onAchievements(data) {
      setAchievements(data.achievements || []);
    }
    ctx.socket.on('profile_data', onProfile);
    ctx.socket.on('equipped_updated', onEquipped);
    ctx.socket.on('item_sold', onSold);
    ctx.socket.on('inventory_data', onInventory);
    ctx.socket.on('portraits_list', onPortraits);
    ctx.socket.on('avatar_updated', onAvatarUpdated);
    ctx.socket.on('tcg_cards_data', onCards);
    ctx.socket.on('tcg_card_sold', onCardSold);
    ctx.socket.on('daily_challenges', onDailyChallenges);
    ctx.socket.on('achievements', onAchievements);
    return function() {
      ctx.socket.off('profile_data', onProfile);
      ctx.socket.off('equipped_updated', onEquipped);
      ctx.socket.off('item_sold', onSold);
      ctx.socket.off('inventory_data', onInventory);
      ctx.socket.off('portraits_list', onPortraits);
      ctx.socket.off('avatar_updated', onAvatarUpdated);
      ctx.socket.off('tcg_cards_data', onCards);
      ctx.socket.off('tcg_card_sold', onCardSold);
      ctx.socket.off('daily_challenges', onDailyChallenges);
      ctx.socket.off('achievements', onAchievements);
    };
  }, [ctx.socket]);

  function equipItem(instanceId) {
    if (ctx.socket) ctx.socket.emit('item_equip', { instanceId: instanceId });
  }
  function unequipItem(type) {
    if (ctx.socket) ctx.socket.emit('item_unequip', { type: type });
  }
  function sellItem(instanceId) {
    if (ctx.socket) {
      setSelling(instanceId);
      ctx.socket.emit('item_sell', { instanceId: instanceId });
    }
  }
  function toggleShowcaseItem(itemType, itemId) {
    setShowcase(function(prev) {
      var exists = prev.find(function(s) { return s.type === itemType && s.id === itemId; });
      if (exists) return prev.filter(function(s) { return !(s.type === itemType && s.id === itemId); });
      if (prev.length >= 6) return prev;
      return prev.concat([{ type: itemType, id: itemId }]);
    });
  }
  function saveShowcase() {
    if (ctx.socket) {
      ctx.socket.emit('profile_set_showcase', { showcase: showcase });
      setShowcaseEditing(false);
    }
  }

  var panelStyle = { flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e', overflow: 'auto', padding: '24px' };

  if (!profile) {
    return React.createElement('div', { style: panelStyle },
      React.createElement('p', { style: { color: '#949ba4', textAlign: 'center', marginTop: '40px' } },
        ctx.account ? 'Loading profile...' : 'Connecting...')
    );
  }

  var inventory = profile.inventory || [];
  var equipped = profile.equipped || { badge: null, title: null };
  var rarityOrder = { legendary: 0, epic: 1, rare: 2, uncommon: 3, common: 4 };

  // Items tab filtering
  var filtered = filter === 'all' ? inventory : inventory.filter(function(i) {
    return i.info && i.info.type === filter;
  });
  filtered.sort(function(a, b) {
    var ra = a.info ? (rarityOrder[a.info.rarity] || 5) : 5;
    var rb = b.info ? (rarityOrder[b.info.rarity] || 5) : 5;
    return ra - rb;
  });

  // Cards tab filtering
  var cardRarities = [];
  var cardTypes = [];
  var crSet = {};
  var ctSet = {};
  profileCards.forEach(function(c) {
    var card = c.card || {};
    if (card.rarity && !crSet[card.rarity]) { crSet[card.rarity] = true; cardRarities.push(card.rarity); }
    if (card.type && !ctSet[card.type]) { ctSet[card.type] = true; cardTypes.push(card.type); }
  });
  cardRarities.sort(function(a, b) { return (rarityOrder[a] || 5) - (rarityOrder[b] || 5); });
  cardTypes.sort();

  var filteredCards = profileCards.filter(function(c) {
    var card = c.card || {};
    if (cardRarityFilter !== 'all' && card.rarity !== cardRarityFilter) return false;
    if (cardTypeFilter !== 'all' && card.type !== cardTypeFilter) return false;
    return true;
  });
  filteredCards.sort(function(a, b) {
    var ra = a.card ? (rarityOrder[a.card.rarity] || 5) : 5;
    var rb = b.card ? (rarityOrder[b.card.rarity] || 5) : 5;
    return ra - rb;
  });

  // Showcase data resolution
  function resolveShowcaseItem(entry) {
    if (entry.type === 'card') {
      var found = profileCards.find(function(c) { return c.id === entry.id; });
      if (found && found.card) return { kind: 'card', data: found };
    } else {
      var found2 = inventory.find(function(i) { return i.id === entry.id; });
      if (found2 && found2.info) return { kind: 'item', data: found2 };
    }
    return null;
  }

  var profileTabBtnStyle = function(tab) {
    return {
      padding: '8px 20px', border: 'none', borderRadius: '8px 8px 0 0',
      background: profileTab === tab ? '#252528' : 'transparent',
      color: profileTab === tab ? '#f0b232' : '#949ba4',
      fontSize: '13px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
      borderBottom: profileTab === tab ? '2px solid #f0b232' : '2px solid transparent',
      transition: 'all 0.2s'
    };
  };

  var filterBtnSmall = function(active) {
    return {
      padding: '4px 10px', border: 'none', borderRadius: '6px',
      background: active ? '#f0b232' : '#4e5058',
      color: active ? '#1c1c1e' : '#dcddde',
      fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
      textTransform: 'capitalize'
    };
  };

  // Build the tab content
  var tabContent = null;

  if (profileTab === 'overview') {
    var quickLinks = [
      { icon: '\uD83D\uDC65', label: 'Friends', desc: 'Manage friends, requests, and blocked users', tab: 'friends', color: '#2ecc71' },
      { icon: '\uD83D\uDD12', label: 'Direct Messages', desc: 'Encrypted private messages', tab: 'dms', color: '#5865f2' },
      { icon: '\uD83C\uDFAE', label: 'Games', desc: 'Play BossOrbs, TCG, Casino, and more', tab: 'games', color: '#f0b232' },
      { icon: '\uD83C\uDFC6', label: 'Leaderboard', desc: 'See top players by chips', tab: 'leaderboard', color: '#ff9800' },
      { icon: '\u26A0\uFE0F', label: 'Report User', desc: 'Report abuse or violations', tab: 'report', color: '#ed4245' },
      { icon: '\uD83D\uDC1B', label: 'Report Bug', desc: 'Report bugs, glitches, or issues', tab: 'bugreport', color: '#5865f2' },
      { icon: '\uD83D\uDCA1', label: 'Feature Request', desc: 'Suggest a new feature or improvement', tab: 'featurerequest', color: '#57f287' },
    ];
    tabContent = React.createElement('div', null,
      // Stats overview
      profile ? React.createElement('div', {
        style: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }
      },
        [
          { label: 'Chips', value: (profile.chips || 0).toLocaleString(), color: '#f0b232' },
          { label: 'Games', value: profile.stats ? profile.stats.gamesPlayed || 0 : 0, color: '#3498db' },
          { label: 'Wins', value: profile.stats ? profile.stats.wins || 0 : 0, color: '#57f287' },
          { label: 'Items', value: profile.inventory ? profile.inventory.length : 0, color: '#9b59b6' },
          { label: 'Cards', value: profileCards.length, color: '#ff69b4' },
        ].map(function(s) {
          return React.createElement('div', {
            key: s.label,
            style: {
              background: '#1a1a2e', borderRadius: '10px', padding: '14px 18px',
              flex: '1 1 100px', minWidth: '100px', textAlign: 'center',
              border: '1px solid rgba(255,255,255,0.06)'
            }
          },
            React.createElement('div', { style: { fontSize: '22px', fontWeight: 800, color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' } },
              s.label === 'Chips' ? React.createElement('img', { src: '/icons/loot/LootCoin_06.PNG', style: { width: '20px', height: '20px', objectFit: 'contain' } }) : null,
              s.value
            ),
            React.createElement('div', { style: { fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '4px' } }, s.label)
          );
        })
      ) : null,
      // Quick links
      React.createElement('div', {
        style: { display: 'flex', flexWrap: 'wrap', gap: '10px' }
      },
        quickLinks.map(function(link) {
          return React.createElement('button', {
            key: link.tab,
            style: {
              flex: '1 1 200px', minWidth: isMobile ? '100%' : '200px',
              background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '10px', padding: '16px',
              cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: '12px',
              transition: 'border-color 0.2s'
            },
            onClick: function() { if (onTabChange) onTabChange(link.tab); }
          },
            React.createElement('span', { style: { fontSize: '28px' } }, link.icon),
            React.createElement('div', null,
              React.createElement('div', { style: { fontWeight: 700, color: link.color, fontSize: '14px' } }, link.label),
              React.createElement('div', { style: { fontSize: '12px', color: '#888', marginTop: '2px' } }, link.desc)
            )
          );
        })
      ),
      // Notification toggle
      React.createElement('div', {
        style: { marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: '#1a1a2e', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }
      },
        React.createElement('span', { style: { fontSize: '24px' } }, '\uD83D\uDD14'),
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', { style: { fontWeight: 700, color: '#eee', fontSize: '14px' } }, 'Browser Notifications'),
          React.createElement('div', { style: { fontSize: '12px', color: '#888', marginTop: '2px' } }, 'Get notified of new messages, DMs, and friend requests')
        ),
        React.createElement('button', {
          style: {
            padding: '6px 16px', borderRadius: '20px', border: 'none',
            background: (typeof BossCordNotifs !== 'undefined' && BossCordNotifs.isEnabled()) ? 'rgba(87,242,135,0.15)' : '#333',
            color: (typeof BossCordNotifs !== 'undefined' && BossCordNotifs.isEnabled()) ? '#57f287' : '#949ba4',
            fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() {
            if (typeof BossCordNotifs !== 'undefined') {
              BossCordNotifs.toggle();
              forceRender(function(n) { return n + 1; });
            }
          }
        }, (typeof BossCordNotifs !== 'undefined' && BossCordNotifs.isEnabled()) ? 'ON' : 'OFF')
      ),
      null
    );
  } else if (profileTab === 'items') {
    tabContent = React.createElement(React.Fragment, null,
      // Filter tabs
      React.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' } },
        ['all', 'badge', 'title', 'weapon'].map(function(f) {
          return React.createElement('button', {
            key: f,
            style: {
              padding: '6px 14px', border: 'none', borderRadius: '6px',
              background: filter === f ? '#f0b232' : '#4e5058',
              color: filter === f ? '#1c1c1e' : '#dcddde',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              textTransform: 'capitalize'
            },
            onClick: function() { setFilter(f); }
          }, f === 'all' ? 'All' : f + 's');
        })
      ),

      // Inventory grid
      filtered.length === 0
        ? React.createElement('p', { style: { color: '#72767d', textAlign: 'center', marginTop: '20px' } },
            'No items. Open lootboxes or buy scrolls to collect!')
        : React.createElement('div', {
            style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px' }
          },
            filtered.map(function(item) {
              if (!item.info) return null;
              var isEquipped = (item.info.type === 'badge' && equipped.badge === item.itemId)
                || (item.info.type === 'title' && equipped.title === item.itemId);
              return React.createElement('div', {
                key: item.id,
                style: {
                  background: '#252528', borderRadius: '10px', padding: '14px',
                  border: '2px solid ' + (isEquipped ? '#f0b232' : item.info.rarityColor || '#4e5058'),
                  textAlign: 'center', position: 'relative',
                  boxShadow: isEquipped ? '0 0 12px rgba(240,178,50,0.3)' : 'none'
                }
              },
                isEquipped ? React.createElement('div', {
                  style: { position: 'absolute', top: '4px', right: '6px', color: '#f0b232', fontSize: '10px', fontWeight: 700 }
                }, 'EQUIPPED') : null,
                item.info.img
                  ? React.createElement('img', { src: item.info.img, style: { width: '48px', height: '48px', objectFit: 'contain', marginBottom: '6px' } })
                  : React.createElement('div', { style: { fontSize: '28px', marginBottom: '6px' } },
                      item.info.icon || (item.info.type === 'title' ? '\u{1F3F7}\uFE0F' : '\u{1F4E6}')),
                React.createElement('div', { style: { color: '#dcddde', fontSize: '13px', fontWeight: 600, marginBottom: '2px' } },
                  item.modifierInfo ? React.createElement('span', { style: { color: item.modifierInfo.color || '#dcddde' } }, item.modifierInfo.name + ' ') : null,
                  item.info.name),
                item.serial ? React.createElement('div', {
                  style: { color: '#6b6f76', fontSize: '9px', fontFamily: 'monospace', marginBottom: '2px' }
                }, item.serial) : null,
                React.createElement('div', {
                  style: { color: item.info.rarityColor, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' }
                }, item.info.rarity),
                React.createElement('div', { style: { display: 'flex', gap: '4px', justifyContent: 'center' } },
                  (item.info.type === 'badge' || item.info.type === 'title') && !isEquipped
                    ? React.createElement('button', {
                        style: { padding: '4px 10px', background: '#57f287', border: 'none', borderRadius: '4px', color: '#1c1c1e', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
                        onClick: function() { equipItem(item.id); }
                      }, 'Equip') : null,
                  React.createElement('button', {
                    style: { padding: '4px 10px', background: '#ed4245', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', opacity: selling === item.id ? 0.5 : 1 },
                    onClick: function() { sellItem(item.id); },
                    disabled: selling === item.id
                  }, 'Sell ' + (item.info.sellValue || 0))
                )
              );
            })
          )
    );
  } else if (profileTab === 'cards') {
    tabContent = React.createElement(React.Fragment, null,
      React.createElement('div', { style: { color: '#949ba4', fontSize: '13px', marginBottom: '12px' } },
        profileCards.length + ' cards in collection'),
      // Rarity filter
      React.createElement('div', { style: { display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' } },
        React.createElement('span', { style: { color: '#b5bac1', fontSize: '11px', fontWeight: 700, marginRight: '4px' } }, 'RARITY:'),
        React.createElement('button', {
          style: filterBtnSmall(cardRarityFilter === 'all'),
          onClick: function() { setCardRarityFilter('all'); }
        }, 'All'),
        cardRarities.map(function(r) {
          return React.createElement('button', {
            key: r, style: filterBtnSmall(cardRarityFilter === r),
            onClick: function() { setCardRarityFilter(r); }
          }, r);
        })
      ),
      // Type filter
      React.createElement('div', { style: { display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' } },
        React.createElement('span', { style: { color: '#b5bac1', fontSize: '11px', fontWeight: 700, marginRight: '4px' } }, 'TYPE:'),
        React.createElement('button', {
          style: filterBtnSmall(cardTypeFilter === 'all'),
          onClick: function() { setCardTypeFilter('all'); }
        }, 'All'),
        cardTypes.map(function(t) {
          return React.createElement('button', {
            key: t, style: filterBtnSmall(cardTypeFilter === t),
            onClick: function() { setCardTypeFilter(t); }
          }, t);
        })
      ),
      // Card grid
      filteredCards.length === 0
        ? React.createElement('p', { style: { color: '#72767d', textAlign: 'center', marginTop: '20px' } },
            'No cards match the current filters.')
        : React.createElement('div', {
            style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }
          },
            filteredCards.map(function(cardData) {
              var card = cardData.card || {};
              var rarityColor = card.rarityColor || '#9e9e9e';
              return React.createElement('div', {
                key: cardData.id,
                style: {
                  background: '#252528', borderRadius: '10px',
                  border: '2px solid ' + rarityColor,
                  textAlign: 'center', overflow: 'hidden'
                }
              },
                card.img
                  ? React.createElement('div', {
                      style: { width: '100%', height: '90px', background: '#18181b', overflow: 'hidden' }
                    }, React.createElement('img', { src: card.img, style: { width: '100%', height: '100%', objectFit: 'cover' } }))
                  : React.createElement('div', {
                      style: { width: '100%', height: '90px', background: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '36px' }
                    }, '\u{1F409}'),
                React.createElement('div', { style: { padding: '8px' } },
                  React.createElement('div', { style: { color: '#dcddde', fontSize: '12px', fontWeight: 700, marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, card.name || 'Unknown'),
                  React.createElement('div', { style: { color: rarityColor, fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '3px' } }, card.rarity || ''),
                  React.createElement('div', { style: { color: '#949ba4', fontSize: '9px', fontStyle: 'italic', marginBottom: '4px' } }, card.type || ''),
                  React.createElement('div', { style: { display: 'flex', justifyContent: 'center', gap: '5px', fontSize: '10px' } },
                    React.createElement('span', { style: { color: '#ed4245', fontWeight: 700 } }, '\u2694' + (card.atk || 0)),
                    React.createElement('span', { style: { color: '#5865f2', fontWeight: 700 } }, '\u{1F6E1}' + (card.def || 0)),
                    React.createElement('span', { style: { color: '#57f287', fontWeight: 700 } }, '\u2764' + (card.hp || 0))
                  )
                )
              );
            })
          )
    );
  } else if (profileTab === 'challenges') {
    // Format time remaining until challenge reset
    function formatResetTime(ms) {
      if (ms <= 0) return 'Resetting...';
      var hours = Math.floor(ms / 3600000);
      var minutes = Math.floor((ms % 3600000) / 60000);
      return hours + 'h ' + minutes + 'm';
    }

    function claimChallenge(challengeId) {
      if (ctx.socket) ctx.socket.emit('claim_challenge_reward', { challengeId: challengeId });
    }

    var unlockedCount = achievements.filter(function(a) { return a.unlockedAt; }).length;

    tabContent = React.createElement(React.Fragment, null,
      // Daily Challenges section
      React.createElement('div', { style: { marginBottom: '28px' } },
        React.createElement('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }
        },
          React.createElement('div', { style: { fontSize: '16px', fontWeight: 700, color: '#f0b232' } }, 'Daily Challenges'),
          React.createElement('div', { style: { fontSize: '12px', color: '#949ba4' } },
            'Resets in ' + formatResetTime(challengeResetIn))
        ),
        dailyChallenges.length === 0
          ? React.createElement('div', {
              style: { textAlign: 'center', color: '#72767d', padding: '24px', background: '#252528', borderRadius: '10px' }
            }, ctx.account && !ctx.account.temp ? 'Loading challenges...' : 'Create an account to unlock daily challenges!')
          : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
              dailyChallenges.map(function(ch) {
                var pct = ch.target > 0 ? Math.min(100, Math.round((ch.progress / ch.target) * 100)) : 0;
                var barColor = ch.claimed ? '#57f287' : ch.completed ? '#f0b232' : '#5865f2';
                return React.createElement('div', {
                  key: ch.id,
                  style: {
                    background: '#252528', borderRadius: '10px', padding: '16px',
                    border: '1px solid ' + (ch.completed ? (ch.claimed ? '#57f287' : '#f0b232') : '#3a3a3e'),
                    opacity: ch.claimed ? 0.7 : 1
                  }
                },
                  React.createElement('div', {
                    style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }
                  },
                    React.createElement('div', null,
                      React.createElement('div', { style: { fontWeight: 700, color: '#dcddde', fontSize: '14px' } }, ch.title),
                      React.createElement('div', { style: { color: '#949ba4', fontSize: '12px', marginTop: '2px' } }, ch.description)
                    ),
                    React.createElement('div', { style: { textAlign: 'right', flexShrink: 0, marginLeft: '12px' } },
                      React.createElement('div', {
                        style: { color: '#f0b232', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }
                      },
                        React.createElement('span', { style: { display: 'flex', alignItems: 'center', gap: '3px' } },
                          React.createElement('img', { src: '/icons/loot/LootCoin_06.PNG', style: { width: '14px', height: '14px', objectFit: 'contain' } }),
                          ch.reward
                        ),
                        React.createElement('span', {
                          style: { display: 'flex', alignItems: 'center', gap: '2px', color: '#00d4ff', fontSize: '11px' },
                          title: 'Guaranteed key drop'
                        },
                          React.createElement('img', { src: '/icons/loot/Loot_54_key.PNG', style: { width: '14px', height: '14px', objectFit: 'contain' } }),
                          '+Key'
                        )
                      ),
                      ch.completed && !ch.claimed ? React.createElement('button', {
                        style: {
                          marginTop: '4px', padding: '4px 12px', background: '#f0b232', border: 'none',
                          borderRadius: '6px', color: '#1c1c1e', fontSize: '11px', fontWeight: 700,
                          cursor: 'pointer', fontFamily: 'inherit'
                        },
                        onClick: function() { claimChallenge(ch.id); }
                      }, 'Claim') : ch.claimed ? React.createElement('div', {
                        style: { color: '#57f287', fontSize: '11px', fontWeight: 700, marginTop: '4px' }
                      }, 'Claimed!') : null
                    )
                  ),
                  // Progress bar
                  React.createElement('div', {
                    style: { background: '#1c1c1e', borderRadius: '4px', height: '8px', overflow: 'hidden' }
                  },
                    React.createElement('div', {
                      style: {
                        width: pct + '%', height: '100%', background: barColor,
                        borderRadius: '4px', transition: 'width 0.3s ease'
                      }
                    })
                  ),
                  React.createElement('div', {
                    style: { color: '#72767d', fontSize: '11px', marginTop: '4px', textAlign: 'right' }
                  }, ch.progress + ' / ' + ch.target)
                );
              })
            )
      ),

      // Achievements section
      React.createElement('div', null,
        React.createElement('div', {
          style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }
        },
          React.createElement('div', { style: { fontSize: '16px', fontWeight: 700, color: '#f0b232' } }, 'Achievements'),
          React.createElement('div', { style: { fontSize: '12px', color: '#949ba4' } },
            unlockedCount + ' / ' + achievements.length + ' unlocked')
        ),
        achievements.length === 0
          ? React.createElement('div', {
              style: { textAlign: 'center', color: '#72767d', padding: '24px', background: '#252528', borderRadius: '10px' }
            }, 'Loading achievements...')
          : React.createElement('div', {
              style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }
            },
              achievements.map(function(ach) {
                var isUnlocked = !!ach.unlockedAt;
                return React.createElement('div', {
                  key: ach.id,
                  style: {
                    background: '#252528', borderRadius: '10px', padding: '14px',
                    border: '1px solid ' + (isUnlocked ? '#f0b232' : '#3a3a3e'),
                    opacity: isUnlocked ? 1 : 0.5,
                    display: 'flex', alignItems: 'center', gap: '12px'
                  }
                },
                  React.createElement('div', {
                    style: {
                      width: '40px', height: '40px', borderRadius: '50%',
                      background: isUnlocked ? 'rgba(240,178,50,0.15)' : '#1c1c1e',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '20px', flexShrink: 0,
                      border: '2px solid ' + (isUnlocked ? '#f0b232' : '#3a3a3e')
                    }
                  }, isUnlocked ? ach.icon : '\uD83D\uDD12'),
                  React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                    React.createElement('div', {
                      style: { fontWeight: 700, color: isUnlocked ? '#dcddde' : '#72767d', fontSize: '13px' }
                    }, ach.title),
                    React.createElement('div', {
                      style: { color: '#949ba4', fontSize: '11px', marginTop: '2px' }
                    }, ach.description),
                    isUnlocked ? React.createElement('div', {
                      style: { color: '#57f287', fontSize: '10px', marginTop: '3px' }
                    }, 'Unlocked ' + new Date(ach.unlockedAt).toLocaleDateString()) : null
                  )
                );
              })
            )
      )
    );
  } else if (profileTab === 'showcase') {
    var showcaseItems = showcase.map(function(entry) { return resolveShowcaseItem(entry); }).filter(function(x) { return x !== null; });

    tabContent = React.createElement(React.Fragment, null,
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' } },
        React.createElement('div', { style: { color: '#949ba4', fontSize: '13px' } },
          'Display up to 6 favorite items or cards on your profile. (' + showcase.length + '/6)'),
        React.createElement('button', {
          style: {
            padding: '6px 16px', background: showcaseEditing ? '#57f287' : '#5865f2',
            border: 'none', borderRadius: '6px', color: showcaseEditing ? '#1c1c1e' : '#fff',
            fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() {
            if (showcaseEditing) { saveShowcase(); }
            else { setShowcaseEditing(true); }
          }
        }, showcaseEditing ? 'Save Showcase' : 'Edit Showcase')
      ),

      // Current showcase display
      React.createElement('div', {
        style: {
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px',
          marginBottom: '24px', minHeight: '80px', background: '#252528', borderRadius: '10px',
          padding: '16px', border: '1px solid #4e5058'
        }
      },
        showcaseItems.length === 0
          ? React.createElement('div', { style: { gridColumn: '1 / -1', textAlign: 'center', color: '#72767d', fontSize: '13px', padding: '20px' } },
              'No showcase items yet. Click "Edit Showcase" to add favorites!')
          : showcaseItems.map(function(resolved, idx) {
              if (resolved.kind === 'card') {
                var card = resolved.data.card || {};
                var rarityColor = card.rarityColor || '#9e9e9e';
                return React.createElement('div', {
                  key: 'sc-' + idx,
                  style: {
                    background: '#1c1c1e', borderRadius: '8px', border: '2px solid ' + rarityColor,
                    textAlign: 'center', overflow: 'hidden', position: 'relative'
                  }
                },
                  showcaseEditing ? React.createElement('button', {
                    style: {
                      position: 'absolute', top: '2px', right: '2px', width: '20px', height: '20px',
                      background: '#ed4245', border: 'none', borderRadius: '50%', color: '#fff',
                      fontSize: '10px', cursor: 'pointer', fontFamily: 'inherit', zIndex: 1, lineHeight: '20px', padding: 0
                    },
                    onClick: function() { toggleShowcaseItem('card', resolved.data.id); }
                  }, 'X') : null,
                  card.img
                    ? React.createElement('img', { src: card.img, style: { width: '100%', height: '70px', objectFit: 'cover' } })
                    : React.createElement('div', { style: { height: '70px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', background: '#18181b' } }, '\u{1F409}'),
                  React.createElement('div', { style: { padding: '6px' } },
                    React.createElement('div', { style: { color: '#dcddde', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, card.name || '?'),
                    React.createElement('div', { style: { color: rarityColor, fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' } }, card.rarity || '')
                  )
                );
              } else {
                var info = resolved.data.info || {};
                return React.createElement('div', {
                  key: 'sc-' + idx,
                  style: {
                    background: '#1c1c1e', borderRadius: '8px', border: '2px solid ' + (info.rarityColor || '#4e5058'),
                    textAlign: 'center', padding: '10px', position: 'relative'
                  }
                },
                  showcaseEditing ? React.createElement('button', {
                    style: {
                      position: 'absolute', top: '2px', right: '2px', width: '20px', height: '20px',
                      background: '#ed4245', border: 'none', borderRadius: '50%', color: '#fff',
                      fontSize: '10px', cursor: 'pointer', fontFamily: 'inherit', zIndex: 1, lineHeight: '20px', padding: 0
                    },
                    onClick: function() { toggleShowcaseItem('item', resolved.data.id); }
                  }, 'X') : null,
                  info.img
                    ? React.createElement('img', { src: info.img, style: { width: '40px', height: '40px', objectFit: 'contain', marginBottom: '4px' } })
                    : React.createElement('div', { style: { fontSize: '24px', marginBottom: '4px' } }, info.icon || '\u{1F4E6}'),
                  React.createElement('div', { style: { color: '#dcddde', fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, info.name || '?'),
                  React.createElement('div', { style: { color: info.rarityColor || '#9e9e9e', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase' } }, info.rarity || '')
                );
              }
            })
      ),

      // Add to showcase section (only when editing)
      showcaseEditing ? React.createElement(React.Fragment, null,
        React.createElement('div', { style: { color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' } }, 'Add Items'),
        React.createElement('div', {
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px', marginBottom: '16px' }
        },
          inventory.map(function(item) {
            if (!item.info) return null;
            var alreadyIn = !!showcase.find(function(s) { return s.type === 'item' && s.id === item.id; });
            return React.createElement('div', {
              key: 'si-' + item.id,
              style: {
                background: alreadyIn ? '#2a3a2a' : '#252528', borderRadius: '8px', padding: '8px',
                border: '1px solid ' + (alreadyIn ? '#57f287' : '#4e5058'),
                textAlign: 'center', cursor: showcase.length >= 6 && !alreadyIn ? 'default' : 'pointer',
                opacity: showcase.length >= 6 && !alreadyIn ? 0.4 : 1
              },
              onClick: function() { toggleShowcaseItem('item', item.id); }
            },
              item.info.img
                ? React.createElement('img', { src: item.info.img, style: { width: '32px', height: '32px', objectFit: 'contain' } })
                : React.createElement('div', { style: { fontSize: '20px' } }, item.info.icon || '\u{1F4E6}'),
              React.createElement('div', { style: { color: '#dcddde', fontSize: '10px', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, item.info.name || '?'),
              alreadyIn ? React.createElement('div', { style: { color: '#57f287', fontSize: '9px', fontWeight: 700 } }, 'ADDED') : null
            );
          })
        ),
        React.createElement('div', { style: { color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' } }, 'Add Cards'),
        React.createElement('div', {
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '8px' }
        },
          profileCards.map(function(cardData) {
            var card = cardData.card || {};
            var alreadyIn = !!showcase.find(function(s) { return s.type === 'card' && s.id === cardData.id; });
            return React.createElement('div', {
              key: 'sc-' + cardData.id,
              style: {
                background: alreadyIn ? '#2a3a2a' : '#252528', borderRadius: '8px',
                border: '1px solid ' + (alreadyIn ? '#57f287' : card.rarityColor || '#4e5058'),
                textAlign: 'center', overflow: 'hidden',
                cursor: showcase.length >= 6 && !alreadyIn ? 'default' : 'pointer',
                opacity: showcase.length >= 6 && !alreadyIn ? 0.4 : 1
              },
              onClick: function() { toggleShowcaseItem('card', cardData.id); }
            },
              card.img
                ? React.createElement('img', { src: card.img, style: { width: '100%', height: '50px', objectFit: 'cover' } })
                : React.createElement('div', { style: { height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', background: '#18181b' } }, '\u{1F409}'),
              React.createElement('div', { style: { padding: '4px' } },
                React.createElement('div', { style: { color: '#dcddde', fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, card.name || '?'),
                alreadyIn ? React.createElement('div', { style: { color: '#57f287', fontSize: '9px', fontWeight: 700 } }, 'ADDED') : null
              )
            );
          })
        )
      ) : null
    );
  }

  return React.createElement('div', { style: panelStyle },
    // Avatar picker overlay
    showAvatarPicker ? React.createElement('div', {
      style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' },
      onClick: function() { setShowAvatarPicker(false); }
    },
      React.createElement('div', {
        style: { background: '#252528', borderRadius: '12px', padding: '24px', maxWidth: '500px', maxHeight: '70vh', overflow: 'auto', border: '1px solid #4e5058' },
        onClick: function(e) { e.stopPropagation(); }
      },
        React.createElement('h3', { style: { color: '#f0b232', marginBottom: '16px', fontSize: '18px', fontWeight: 700 } }, 'Choose Avatar'),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 72px)', gap: '8px', justifyContent: 'center' } },
          portraits.map(function(p) {
            return React.createElement('div', {
              key: p.id,
              style: {
                width: '72px', height: '72px', borderRadius: '10px', overflow: 'hidden', cursor: 'pointer',
                border: profile.avatarId === p.id ? '3px solid #f0b232' : '2px solid #4e5058',
                transition: 'border-color 0.2s'
              },
              title: p.name,
              onClick: function() { if (ctx.socket) ctx.socket.emit('avatar_set', { portraitId: p.id }); }
            },
              React.createElement('img', { src: p.img, style: { width: '100%', height: '100%', objectFit: 'cover' } })
            );
          })
        )
      )
    ) : null,

    // Profile header
    React.createElement('div', { style: { textAlign: 'center', marginBottom: '24px' } },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '8px' }
      },
        React.createElement('div', {
          style: {
            width: '64px', height: '64px', borderRadius: '50%', overflow: 'hidden',
            border: '3px solid #f0b232', cursor: profile.isOwn ? 'pointer' : 'default',
            background: '#18181b', display: 'flex', alignItems: 'center', justifyContent: 'center'
          },
          onClick: function() {
            if (profile.isOwn) {
              if (ctx.socket) ctx.socket.emit('portraits_get');
              setShowAvatarPicker(true);
            }
          },
          title: profile.isOwn ? 'Click to change avatar' : ''
        },
          profile.avatar
            ? React.createElement('img', { src: profile.avatar, style: { width: '100%', height: '100%', objectFit: 'cover' } })
            : React.createElement('div', { style: { fontSize: '28px', color: '#949ba4' } }, '\u{1F464}')
        )
      ),
      React.createElement('div', {
        style: { fontSize: '20px', fontWeight: 700, color: profile.color || '#dcddde', marginBottom: '4px' }
      },
        (equipped.badge ? (function() {
          var bi = inventory.find(function(x) { return x.itemId === equipped.badge; });
          return bi && bi.info ? bi.info.icon + ' ' : '';
        })() : '') + profile.username
      ),
      equipped.title ? React.createElement('div', {
        style: { color: '#f0b232', fontSize: '13px', fontWeight: 600, fontStyle: 'italic' }
      }, (function() {
        var ti = inventory.find(function(x) { return x.itemId === equipped.title; });
        return ti && ti.info ? ti.info.text || ti.info.name : equipped.title;
      })()) : null,
      React.createElement('div', { style: { color: '#f0b232', fontSize: '16px', fontWeight: 700, marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' } },
        React.createElement('img', { src: '/icons/loot/LootCoin_06.PNG', style: { width: '16px', height: '16px', objectFit: 'contain' } }),
        (profile.chips || 0) + ' chips'),
      React.createElement('div', { style: { color: '#949ba4', fontSize: '12px', marginTop: '4px' } },
        inventory.length + ' items \u2022 ' + profileCards.length + ' cards')
    ),

    // Equipped section
    React.createElement('div', { style: { marginBottom: '20px' } },
      React.createElement('div', { style: { color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' } }, 'Equipped'),
      React.createElement('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap' } },
        React.createElement('div', {
          style: { background: '#252528', borderRadius: '8px', padding: '10px 16px', border: '1px solid #4e5058', minWidth: '120px' }
        },
          React.createElement('div', { style: { color: '#949ba4', fontSize: '10px', textTransform: 'uppercase', marginBottom: '4px' } }, 'Badge'),
          equipped.badge ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
            React.createElement('span', { style: { fontSize: '18px' } }, (function() {
              var bi = inventory.find(function(x) { return x.itemId === equipped.badge; });
              return bi && bi.info ? bi.info.icon : '';
            })()),
            React.createElement('span', { style: { color: '#dcddde', fontSize: '13px' } }, (function() {
              var bi = inventory.find(function(x) { return x.itemId === equipped.badge; });
              return bi && bi.info ? bi.info.name : equipped.badge;
            })()),
            React.createElement('button', {
              style: { padding: '2px 6px', background: '#ed4245', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '10px', cursor: 'pointer', fontFamily: 'inherit', marginLeft: '4px' },
              onClick: function() { unequipItem('badge'); }
            }, 'X')
          ) : React.createElement('span', { style: { color: '#72767d', fontSize: '13px' } }, 'None')
        ),
        React.createElement('div', {
          style: { background: '#252528', borderRadius: '8px', padding: '10px 16px', border: '1px solid #4e5058', minWidth: '120px' }
        },
          React.createElement('div', { style: { color: '#949ba4', fontSize: '10px', textTransform: 'uppercase', marginBottom: '4px' } }, 'Title'),
          equipped.title ? React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
            React.createElement('span', { style: { color: '#f0b232', fontSize: '13px', fontStyle: 'italic' } }, (function() {
              var ti = inventory.find(function(x) { return x.itemId === equipped.title; });
              return ti && ti.info ? (ti.info.text || ti.info.name) : equipped.title;
            })()),
            React.createElement('button', {
              style: { padding: '2px 6px', background: '#ed4245', border: 'none', borderRadius: '4px', color: '#fff', fontSize: '10px', cursor: 'pointer', fontFamily: 'inherit', marginLeft: '4px' },
              onClick: function() { unequipItem('title'); }
            }, 'X')
          ) : React.createElement('span', { style: { color: '#72767d', fontSize: '13px' } }, 'None')
        )
      )
    ),

    // Profile tab bar
    React.createElement('div', {
      style: { display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #4e5058' }
    },
      React.createElement('button', { style: profileTabBtnStyle('overview'), onClick: function() { setProfileTab('overview'); } }, 'Overview'),
      React.createElement('button', { style: profileTabBtnStyle('challenges'), onClick: function() {
        setProfileTab('challenges');
        if (ctx.socket) { ctx.socket.emit('get_daily_challenges'); ctx.socket.emit('get_achievements'); }
      } }, 'Quests'),
      React.createElement('button', { style: profileTabBtnStyle('items'), onClick: function() { setProfileTab('items'); } }, 'Items'),
      React.createElement('button', { style: profileTabBtnStyle('cards'), onClick: function() { setProfileTab('cards'); } }, 'Cards'),
      React.createElement('button', { style: profileTabBtnStyle('showcase'), onClick: function() { setProfileTab('showcase'); } }, 'Showcase')
    ),

    // Tab content
    tabContent
  );
}
