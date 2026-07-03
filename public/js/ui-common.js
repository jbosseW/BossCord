// ===================== WIPE WARNING BANNER =====================
function WipeWarningBanner() {
  var ctx = useSocket();
  var [dismissed, setDismissed] = useState(false);
  // Reset dismissed when wipe message changes (e.g. warning -> wipe)
  var prevMsg = useRef(null);
  useEffect(function() {
    if (ctx.wipeWarning && ctx.wipeWarning !== prevMsg.current) {
      setDismissed(false);
      prevMsg.current = ctx.wipeWarning;
    }
  }, [ctx.wipeWarning]);
  if (!ctx.wipeWarning || dismissed) return null;
  return React.createElement('div', {
    style: {
      position: 'fixed', top: 0, left: 0, right: 0,
      background: '#ed4245', color: '#fff', padding: '10px 16px',
      textAlign: 'center', zIndex: 9999, fontSize: '14px', fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px'
    }
  },
    React.createElement('span', { style: { flex: 1 } }, ctx.wipeWarning),
    React.createElement('button', {
      style: {
        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
        color: '#fff', cursor: 'pointer', fontSize: '18px', fontWeight: 700,
        width: '32px', height: '32px', borderRadius: '6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, touchAction: 'manipulation'
      },
      onClick: function() { setDismissed(true); },
      onTouchEnd: function(e) { e.preventDefault(); setDismissed(true); }
    }, '\u2715')
  );
}

// ===================== UPDATE WARNING BANNER =====================
function UpdateWarningBanner() {
  var ctx = useSocket();
  var [dismissed, setDismissed] = useState(false);
  var prevMsg = useRef(null);
  useEffect(function() {
    if (ctx.updateWarning && ctx.updateWarning !== prevMsg.current) {
      setDismissed(false);
      prevMsg.current = ctx.updateWarning;
    }
  }, [ctx.updateWarning]);
  if (!ctx.updateWarning || dismissed) return null;
  return React.createElement('div', {
    style: {
      position: 'fixed', top: 0, left: 0, right: 0,
      background: 'linear-gradient(135deg, #1a6fc4 0%, #0e9aa7 100%)',
      color: '#fff', padding: '10px 16px',
      textAlign: 'center', zIndex: 9998, fontSize: '14px', fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
    }
  },
    React.createElement('span', { style: { flex: 1 } }, ctx.updateWarning),
    React.createElement('button', {
      style: {
        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
        color: '#fff', cursor: 'pointer', fontSize: '18px', fontWeight: 700,
        width: '32px', height: '32px', borderRadius: '6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, touchAction: 'manipulation'
      },
      onClick: function() { setDismissed(true); },
      onTouchEnd: function(e) { e.preventDefault(); setDismissed(true); }
    }, '\u2715')
  );
}

// ===================== CONNECTION BANNER =====================
function ConnectionBanner() {
  var ctx = useSocket();
  var [attempts, setAttempts] = useState(0);
  var [reconnecting, setReconnecting] = useState(false);
  var [exhausted, setExhausted] = useState(false);
  var lastUserName = useRef(null);
  var wasConnected = useRef(false);
  var timerRef = useRef(null);
  var connectRef = useRef(null);
  var MAX_ATTEMPTS = 5;

  // Keep connectSocket ref current so interval closure never goes stale
  connectRef.current = ctx.connectSocket;

  // Track the last known username while connected
  useEffect(function() {
    if (ctx.user && ctx.user.name) {
      lastUserName.current = ctx.user.name;
    }
  }, [ctx.user]);

  // Track connection state transitions
  useEffect(function() {
    if (ctx.connected) {
      wasConnected.current = true;
      setAttempts(0);
      setReconnecting(false);
      setExhausted(false);
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [ctx.connected]);

  // Start auto-reconnect when disconnected after having been connected
  useEffect(function() {
    if (!ctx.connected && wasConnected.current && !exhausted && lastUserName.current) {
      setReconnecting(true);
      var attemptCount = 0;
      var reconnectInFlight = false;
      timerRef.current = setInterval(function() {
        if (reconnectInFlight) return; // prevent overlapping async reconnect calls
        attemptCount++;
        if (attemptCount > MAX_ATTEMPTS) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          setExhausted(true);
          setReconnecting(false);
          return;
        }
        setAttempts(attemptCount);
        if (lastUserName.current && connectRef.current) {
          reconnectInFlight = true;
          var result = connectRef.current(lastUserName.current);
          if (result && typeof result.then === 'function') {
            result.then(function() { reconnectInFlight = false; }).catch(function() { reconnectInFlight = false; });
          } else {
            reconnectInFlight = false;
          }
        }
      }, 5000);
    }
    return function() {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [ctx.connected, exhausted]);

  // Don't show if never connected or currently connected
  if (ctx.connected || !wasConnected.current) return null;
  // Don't show if we have no stored username to reconnect with
  if (!lastUserName.current) return null;

  var handleReconnectNow = function() {
    if (exhausted) return;
    setAttempts(function(prev) { return prev + 1; });
    if (lastUserName.current && connectRef.current) {
      connectRef.current(lastUserName.current);
    }
  };

  var bannerText = exhausted
    ? 'Connection lost. Please refresh.'
    : reconnecting
      ? 'Disconnected - Reconnecting (' + attempts + '/' + MAX_ATTEMPTS + ')...'
      : 'Disconnected - Reconnecting...';

  return React.createElement('div', {
    style: {
      position: 'fixed', top: 0, left: 0, right: 0,
      background: 'linear-gradient(135deg, #e0930b 0%, #d48806 100%)',
      color: '#fff', padding: '10px 16px',
      textAlign: 'center', zIndex: 9997, fontSize: '14px', fontWeight: 600,
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
    }
  },
    React.createElement('span', { style: { flex: 1 } }, bannerText),
    !exhausted ? React.createElement('button', {
      style: {
        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
        color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
        padding: '4px 12px', borderRadius: '6px',
        flexShrink: 0, touchAction: 'manipulation'
      },
      onClick: handleReconnectNow,
      onTouchEnd: function(e) { e.preventDefault(); handleReconnectNow(); }
    }, 'Reconnect Now') : React.createElement('button', {
      style: {
        background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.3)',
        color: '#fff', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
        padding: '4px 12px', borderRadius: '6px',
        flexShrink: 0, touchAction: 'manipulation'
      },
      onClick: function() { window.location.reload(); },
      onTouchEnd: function(e) { e.preventDefault(); window.location.reload(); }
    }, 'Refresh')
  );
}

// ===================== TOP TAB BAR =====================
function _renderBadge(count, size) {
  if (!count || count <= 0) return null;
  var badgeSize = size || 14;
  var displayCount = count > 99 ? '99+' : '' + count;
  return React.createElement('span', {
    style: {
      position: 'absolute', top: '-4px', right: '-6px',
      minWidth: badgeSize + 'px', height: badgeSize + 'px',
      borderRadius: badgeSize + 'px',
      background: '#ed4245', color: '#fff',
      fontSize: (badgeSize - 4) + 'px', fontWeight: 700,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 3px', lineHeight: '1', pointerEvents: 'none',
      boxShadow: '0 0 0 2px #18181b'
    }
  }, displayCount);
}

function TopTabBar({ activeTab, onTabChange, compact }) {
  var ctx = useSocket();
  var tabs = [
    { id: 'chat', label: 'Chat', icon: '#' },
    { id: 'cords', label: 'Cords', icon: '\uD83D\uDCAC' },
    { id: 'games', label: 'Game', icon: '\uD83C\uDFAE' },
    { id: 'friends', label: 'Friends', icon: '\uD83D\uDC65' },
    { id: 'dms', label: 'DMs', icon: '\uD83D\uDD12' },
    { id: 'roulette', label: 'Roulette', icon: '\uD83C\uDFB2' },
    { id: 'leaderboard', label: 'Top', icon: '\uD83C\uDFC6' },
    { id: 'profile', label: 'Profile', icon: '\uD83D\uDC64' },
    { id: 'about', label: 'About', icon: '\u2139\uFE0F' }
  ];
  var barHeight = compact ? '36px' : '46px';
  return React.createElement('div', {
    style: {
      height: barHeight, minHeight: barHeight, background: '#18181b',
      display: 'flex', alignItems: 'center',
      borderTop: 'none', borderLeft: 'none', borderRight: 'none',
      borderBottomWidth: '2px', borderBottomStyle: 'solid', borderBottomColor: '#f0b232',
      borderImage: 'linear-gradient(90deg, #f0b232 0%, rgba(240,178,50,0.15) 50%, #f0b232 100%) 1',
      padding: '0 12px', gap: '6px', flexShrink: 0, zIndex: 50,
      overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none',
      msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch', flexWrap: 'nowrap'
    }
  },
    !compact ? React.createElement('span', {
      style: { fontWeight: 700, fontSize: '18px', marginRight: '14px', marginLeft: '4px', textShadow: '0 0 12px rgba(240,178,50,0.3)' }
    },
      React.createElement('span', { style: { color: '#f0b232' } }, 'Boss'),
      React.createElement('span', { style: { color: '#e8e6e3' } }, 'Cord')
    ) : null,
    tabs.map(function(tab) {
      var isActive = activeTab === tab.id;
      var badgeCount = 0;
      if (tab.id === 'dms') badgeCount = ctx.unreadDMs || 0;
      if (tab.id === 'friends') badgeCount = ctx.unreadFriendRequests || 0;
      return React.createElement('button', {
        key: tab.id,
        style: {
          position: 'relative',
          padding: compact ? '4px 14px' : '6px 18px',
          background: isActive ? '#f0b232' : 'transparent',
          border: 'none', borderRadius: '20px',
          color: isActive ? '#1c1c1e' : '#949ba4',
          fontSize: compact ? '13px' : '14px', fontWeight: 600,
          cursor: 'pointer', fontFamily: 'inherit',
          transition: 'all 0.15s', display: 'flex',
          alignItems: 'center', gap: '6px',
          minHeight: '32px', flexShrink: 0
        },
        onClick: function() { onTabChange(tab.id); }
      },
        React.createElement('span', { style: { fontSize: compact ? '12px' : '14px', position: 'relative' } },
          tab.icon,
          _renderBadge(badgeCount, 14)
        ),
        tab.label
      );
    })
  );
}

    function BottomTabBar(_ref) {
      var activeTab = _ref.activeTab, onTabChange = _ref.onTabChange;
      var ctx = useSocket();
      var tabs = [
        { id: 'chat', label: 'Chat', icon: '#' },
        { id: 'cords', label: 'Cords', icon: '\uD83D\uDCAC' },
        { id: 'games', label: 'Game', icon: '\uD83C\uDFAE' },
        { id: 'friends', label: 'Friends', icon: '\uD83D\uDC65' },
        { id: 'dms', label: 'DMs', icon: '\uD83D\uDD12' },
        { id: 'roulette', label: 'Roulette', icon: '\uD83C\uDFB2' },
        { id: 'leaderboard', label: 'Top', icon: '\uD83C\uDFC6' },
        { id: 'profile', label: 'Profile', icon: '\uD83D\uDC64' },
        { id: 'about', label: 'About', icon: '\u2139\uFE0F' }
      ];
      return React.createElement('div', {
        style: {
          position: 'fixed', bottom: 0, left: 0, right: 0,
          height: 'calc(56px + env(safe-area-inset-bottom, 0px))',
          background: '#18181b',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-around',
          borderTop: '1px solid #2a2a2e',
          zIndex: 1000, flexShrink: 0,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          overflowX: 'auto', scrollbarWidth: 'none', flexWrap: 'nowrap'
        }
      },
        tabs.map(function(tab) {
          var isActive = activeTab === tab.id;
          var badgeCount = 0;
          if (tab.id === 'dms') badgeCount = ctx.unreadDMs || 0;
          if (tab.id === 'friends') badgeCount = ctx.unreadFriendRequests || 0;
          return React.createElement('button', {
            key: tab.id,
            style: {
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              background: 'none', border: 'none',
              color: isActive ? '#f0b232' : '#949ba4',
              fontSize: '10px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              padding: '6px 0', gap: '2px',
              minHeight: '48px', transition: 'color 0.15s',
              flexShrink: 0, minWidth: '56px',
              position: 'relative'
            },
            onClick: function() { onTabChange(tab.id); }
          },
            React.createElement('span', { style: { fontSize: '20px', lineHeight: '1', position: 'relative' } },
              tab.icon,
              _renderBadge(badgeCount, 14)
            ),
            React.createElement('span', { style: { fontSize: '10px' } }, tab.label)
          );
        })
      );
    }

// ===================== GIF PICKER =====================
function GifPicker({ onSelect, onClose }) {
  var ctx = useSocket();
  var [query, setQuery] = useState('');
  var [gifs, setGifs] = useState([]);
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState(null);
  var [tab, setTab] = useState('search'); // 'search' or 'favorites'
  var [favoriteGifs, setFavoriteGifs] = useState([]);
  var debounceRef = useRef(null);
  var containerRef = useRef(null);
  var mountedRef = useRef(true);
  var onCloseRef = useRef(onClose);
  var isMobile = useIsMobile();
  var hasAccount = !!(ctx && ctx.account);

  // Keep onCloseRef in sync so the effect does not depend on onClose identity
  onCloseRef.current = onClose;

  // Track unmount to prevent state updates after unmount
  useEffect(function() {
    mountedRef.current = true;
    return function() { mountedRef.current = false; };
  }, []);

  function fetchGifs(searchQuery) {
    setLoading(true);
    setError(null);
    var url;
    if (searchQuery && searchQuery.trim()) {
      url = '/api/tenor/search?q=' + encodeURIComponent(searchQuery.trim());
    } else {
      url = '/api/tenor/featured';
    }
    fetch(url).then(function(res) {
      if (!res.ok) {
        throw new Error('Tenor request failed (' + res.status + ')');
      }
      return res.json();
    }).then(function(data) {
      if (!mountedRef.current) return;
      if (data && data.error) {
        setGifs([]);
        setError('GIF search unavailable');
        setLoading(false);
        return;
      }
      var results = (data.results || []).map(function(r) {
        return {
          preview: r.media_formats && r.media_formats.tinygif ? r.media_formats.tinygif.url : '',
          full: r.media_formats && r.media_formats.gif ? r.media_formats.gif.url : ''
        };
      }).filter(function(g) { return g.preview && g.full; });
      setGifs(results);
      setLoading(false);
    }).catch(function() {
      if (!mountedRef.current) return;
      setGifs([]);
      setError('Could not load GIFs');
      setLoading(false);
    });
  }

  // Fetch featured GIFs on mount (only once)
  useEffect(function() { fetchGifs(''); }, []);

  // Load favorites on mount if keyed user
  useEffect(function() {
    if (!ctx || !ctx.socket || !hasAccount) return;
    ctx.socket.emit('gif_favorites_get');
    function onFavs(data) {
      if (!mountedRef.current) return;
      setFavoriteGifs(data && data.gifs ? data.gifs : []);
    }
    ctx.socket.on('gif_favorites', onFavs);
    return function() { ctx.socket.off('gif_favorites', onFavs); };
  }, [ctx && ctx.socket, hasAccount]);

  // Debounced search when query changes (skip initial mount -- the above effect handles it)
  var initialMountRef = useRef(true);
  useEffect(function() {
    if (tab !== 'search') return;
    if (initialMountRef.current) { initialMountRef.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(function() {
      fetchGifs(query);
    }, 400);
    return function() {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, tab]);

  // Click-outside and Escape to close (stable -- no onClose in deps)
  useEffect(function() {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        if (onCloseRef.current) onCloseRef.current();
      }
    }
    function handleEsc(e) {
      if (e.key === 'Escape' && onCloseRef.current) onCloseRef.current();
    }
    // Use pointerdown which fires on both mouse and touch (mousedown misses taps on mobile)
    var evtName = window.PointerEvent ? 'pointerdown' : 'mousedown';
    var t = setTimeout(function() {
      document.addEventListener(evtName, handleClickOutside);
    }, 50);
    document.addEventListener('keydown', handleEsc);
    return function() {
      clearTimeout(t);
      document.removeEventListener(evtName, handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []); // stable -- no deps needed, uses refs

  function isFavorited(fullUrl) {
    return favoriteGifs.some(function(g) { return g.url === fullUrl; });
  }

  function toggleFavorite(fullUrl, previewUrl) {
    if (!ctx || !ctx.socket || !hasAccount) return;
    if (isFavorited(fullUrl)) {
      ctx.socket.emit('gif_favorite_remove', { url: fullUrl });
      setFavoriteGifs(function(prev) { return prev.filter(function(g) { return g.url !== fullUrl; }); });
    } else {
      ctx.socket.emit('gif_favorite_add', { url: fullUrl, preview: previewUrl });
      setFavoriteGifs(function(prev) { return [{ url: fullUrl, preview: previewUrl, addedAt: Date.now() }].concat(prev); });
    }
  }

  var displayGifs = tab === 'favorites'
    ? favoriteGifs.map(function(g) { return { preview: g.preview || '', full: g.url || '' }; })
    : gifs;

  // Fixed positioning to avoid overflow clipping from parent containers
  var pickerHeight = isMobile ? 320 : 400;

  return React.createElement('div', {
    ref: containerRef,
    style: {
      position: 'fixed',
      bottom: isMobile ? '120px' : '90px',
      left: isMobile ? '4px' : '50%',
      transform: isMobile ? 'none' : 'translateX(-50%)',
      width: isMobile ? 'calc(100% - 8px)' : '420px',
      height: pickerHeight + 'px', background: '#252528',
      borderRadius: '12px',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', boxShadow: '0 -4px 30px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)',
      zIndex: 9999
    }
  },
    // Tab bar + search
    React.createElement('div', { style: { padding: '8px 12px 0', flexShrink: 0 } },
      // Tabs (only show if user has account)
      hasAccount ? React.createElement('div', {
        style: { display: 'flex', gap: '4px', marginBottom: '8px' }
      },
        React.createElement('button', {
          style: {
            flex: 1, padding: '6px', border: 'none', borderRadius: '4px',
            background: tab === 'search' ? '#f0b232' : '#18181b',
            color: tab === 'search' ? '#1c1c1e' : '#949ba4',
            fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { setTab('search'); }
        }, 'Search'),
        React.createElement('button', {
          style: {
            flex: 1, padding: '6px', border: 'none', borderRadius: '4px',
            background: tab === 'favorites' ? '#f0b232' : '#18181b',
            color: tab === 'favorites' ? '#1c1c1e' : '#949ba4',
            fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() { setTab('favorites'); }
        }, 'Favorites (' + favoriteGifs.length + ')')
      ) : null,
      tab === 'search' ? React.createElement('input', {
        type: 'text', value: query,
        onChange: function(e) { setQuery(e.target.value); },
        onPaste: blockPaste, onDrop: blockDrop,
        placeholder: 'Search Tenor',
        autoFocus: !isMobile,
        style: {
          width: '100%', padding: '8px 10px', background: '#18181b',
          border: 'none', borderRadius: '4px', color: '#dcddde',
          fontSize: '14px', outline: 'none', fontFamily: 'inherit',
          minHeight: '44px', marginBottom: '4px'
        }
      }) : null
    ),
    React.createElement('div', {
      style: {
        flex: 1, overflowY: 'auto', padding: '0 12px',
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: '8px', alignContent: 'start',
        WebkitOverflowScrolling: 'touch'
      }
    },
      loading && tab === 'search' ? React.createElement('div', {
        style: { gridColumn: '1 / -1', textAlign: 'center', color: '#949ba4', padding: '20px', fontSize: '14px' }
      }, 'Loading...') : error && displayGifs.length === 0 ? React.createElement('div', {
        style: { gridColumn: '1 / -1', textAlign: 'center', color: '#ed4245', padding: '20px', fontSize: '14px' }
      }, error) : displayGifs.length === 0 ? React.createElement('div', {
        style: { gridColumn: '1 / -1', textAlign: 'center', color: '#949ba4', padding: '20px', fontSize: '14px' }
      }, tab === 'favorites' ? 'No favorite GIFs yet' : 'No GIFs found') : displayGifs.map(function(g, i) {
        return React.createElement('div', {
          key: (g.full || '') + i,
          style: { position: 'relative' }
        },
          React.createElement('img', {
            src: g.preview, alt: 'GIF',
            loading: 'lazy',
            style: {
              width: '100%', height: '120px', objectFit: 'cover',
              borderRadius: '4px', cursor: 'pointer',
              background: '#18181b', display: 'block'
            },
            onClick: function() { onSelect(g.full); onClose(); },
            onError: function(e) { e.target.style.display = 'none'; },
            draggable: false
          }),
          // Favorite star button (only for keyed users)
          hasAccount ? React.createElement('button', {
            style: {
              position: 'absolute', top: '4px', right: '4px',
              width: '28px', height: '28px', borderRadius: '50%',
              background: 'rgba(0,0,0,0.6)', border: 'none',
              cursor: 'pointer', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: '16px', padding: 0, lineHeight: 1
            },
            onClick: function(e) { e.stopPropagation(); toggleFavorite(g.full, g.preview); },
            title: isFavorited(g.full) ? 'Remove from favorites' : 'Add to favorites'
          }, isFavorited(g.full) ? '\u2605' : '\u2606') : null
        );
      })
    ),
    React.createElement('div', {
      style: {
        padding: '8px 12px', fontSize: '11px', color: '#949ba4',
        textAlign: 'right', flexShrink: 0, borderTop: '1px solid #18181b'
      }
    }, 'Powered by Tenor')
  );
}

// ===================== USER ACTION MENU =====================
// Enhanced profile card popup -- shows when clicking a username
// Fetches full profile via get_user_profile socket event
// Usage: UserActionMenu({ username, tag, color, onClose, position, onViewProfile })
// `tag` is the 4-char discriminator (e.g. 'ABCD'), combined with username to form 'Username#ABCD'
// `onViewProfile` is an optional callback; if provided, a "View Profile" button appears
//   that calls onViewProfile(friendTag) and closes the menu.
//   If not provided, the button uses window._bosscordViewProfile as a fallback.
function UserActionMenu(props) {
  var username = props.username || 'Unknown';
  var tag = props.tag || '????';
  var color = props.color || '#dcddde';
  var onClose = props.onClose;
  var position = props.position || { x: 0, y: 0 };
  var onViewProfile = props.onViewProfile || null;
  var ctx = useSocket();
  var socket = ctx.socket;
  var [status, setStatus] = useState(null);
  var [profile, setProfile] = useState(null);
  var [loading, setLoading] = useState(true);
  var menuRef = useRef(null);
  var mountedRef = useRef(true);

  var friendTag = username + '#' + tag;
  var isTemp = ctx.account && ctx.account.temp;
  var isSelf = ctx.account && ctx.account.username === username && ctx.user && ctx.user.tag === tag;

  // Track unmount to prevent stale state updates
  useEffect(function() {
    mountedRef.current = true;
    return function() { mountedRef.current = false; };
  }, []);

  // Fetch user profile on mount
  useEffect(function() {
    if (!socket) {
      setLoading(false);
      return;
    }
    socket.emit('get_user_profile', { tag: friendTag });
    function onProfile(data) {
      if (!mountedRef.current) return;
      if (data && data.tag === friendTag) {
        setProfile(data);
        setLoading(false);
      }
    }
    socket.on('user_profile', onProfile);
    // Timeout fallback: stop loading after 3 seconds even if no response
    var timeout = setTimeout(function() {
      if (!mountedRef.current) return;
      setLoading(false);
    }, 3000);
    return function() {
      socket.off('user_profile', onProfile);
      clearTimeout(timeout);
    };
  }, [socket, friendTag]);

  // Close on click outside
  useEffect(function() {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    }
    function handleEsc(e) { if (e.key === 'Escape') onClose(); }
    var evtName = window.PointerEvent ? 'pointerdown' : 'mousedown';
    var t = setTimeout(function() { document.addEventListener(evtName, handleClick); }, 50);
    document.addEventListener('keydown', handleEsc);
    return function() {
      clearTimeout(t);
      document.removeEventListener(evtName, handleClick);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  function addFriend() {
    if (!socket || isTemp || isSelf) return;
    socket.emit('friend_request_send', { tag: friendTag });
    setStatus('Request sent!');
    setTimeout(function() { if (onClose) onClose(); }, 1200);
  }

  function blockUser() {
    if (!socket || isTemp || isSelf) return;
    socket.emit('friend_block_by_tag', { tag: friendTag });
    setStatus('Blocked');
    setTimeout(function() { if (onClose) onClose(); }, 1200);
  }

  function handleViewProfile() {
    if (onViewProfile) {
      onViewProfile(friendTag);
    } else if (window._bosscordViewProfile) {
      window._bosscordViewProfile(friendTag);
    }
    if (onClose) onClose();
  }

  // Use profile data if loaded, otherwise fall back to props
  var displayColor = (profile && profile.color) || color;
  var displayUsername = (profile && profile.username) || username;
  var firstLetter = displayUsername.charAt(0).toUpperCase();

  // Compute menu width and position to avoid viewport overflow
  var menuWidth = 300;
  var menuMinHeight = 360;
  var posX = Math.min(position.x, window.innerWidth - menuWidth - 12);
  var posY = Math.min(position.y, window.innerHeight - menuMinHeight - 12);
  if (posX < 8) posX = 8;
  if (posY < 8) posY = 8;

  // Glassmorphism card style matching .glass-panel pattern
  var menuStyle = {
    position: 'fixed',
    left: posX + 'px',
    top: posY + 'px',
    zIndex: 10000,
    background: 'rgba(28,28,30,0.85)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '12px',
    padding: '0',
    width: menuWidth + 'px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
    overflow: 'hidden',
  };

  var btnStyle = function() {
    return {
      display: 'flex', alignItems: 'center', gap: '8px',
      width: '100%', padding: '8px 16px', border: 'none',
      background: 'transparent', color: '#dcddde', fontSize: '13px',
      cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
      transition: 'background 0.1s',
    };
  };

  // Skeleton loading placeholders
  function renderSkeleton() {
    var skeletonBar = function(w, h) {
      return React.createElement('div', {
        style: {
          width: w, height: h || '12px', background: 'rgba(255,255,255,0.06)',
          borderRadius: '4px',
        }
      });
    };
    return React.createElement('div', null,
      // Banner skeleton
      React.createElement('div', {
        style: {
          height: '6px', background: 'rgba(255,255,255,0.06)',
        }
      }),
      React.createElement('div', { style: { padding: '16px' } },
        // Avatar skeleton
        React.createElement('div', {
          style: {
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginBottom: '14px'
          }
        },
          React.createElement('div', {
            style: {
              width: '48px', height: '48px', borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)', flexShrink: 0,
            }
          }),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' } },
            skeletonBar('120px', '14px'),
            skeletonBar('80px', '10px')
          )
        ),
        // Stat bars skeleton
        skeletonBar('100%', '10px'),
        React.createElement('div', { style: { height: '8px' } }),
        React.createElement('div', { style: { display: 'flex', gap: '8px' } },
          skeletonBar('30%', '32px'),
          skeletonBar('30%', '32px'),
          skeletonBar('30%', '32px')
        )
      )
    );
  }

  // Profile card header section with accent banner and centered avatar
  function renderProfileHeader() {
    var accountAge = (profile && profile.accountAge) || 'Guest';
    var chips = profile ? profile.chips : null;

    return React.createElement('div', null,
      // Accent banner bar at top of card
      React.createElement('div', {
        style: {
          height: '6px',
          background: 'linear-gradient(90deg, ' + displayColor + ', ' + displayColor + 'aa)',
        }
      }),
      // Card body
      React.createElement('div', {
        style: { padding: '16px 16px 12px' }
      },
        // Avatar circle centered
        React.createElement('div', {
          style: {
            display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '12px'
          }
        },
          // Large colored circle with first letter
          React.createElement('div', {
            style: {
              width: '48px', height: '48px', borderRadius: '50%',
              background: displayColor, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: '22px', fontWeight: 700, color: '#fff',
              flexShrink: 0, textShadow: '0 1px 3px rgba(0,0,0,0.3)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.3), 0 0 0 3px rgba(28,28,30,0.85)',
              marginBottom: '10px',
            }
          }, firstLetter),
          // Name
          React.createElement('div', {
            style: {
              fontWeight: 700, fontSize: '16px', color: displayColor,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              maxWidth: '100%', textAlign: 'center',
            }
          }, displayUsername),
          // Tag
          React.createElement('div', {
            style: { fontSize: '11px', color: '#72767d', fontFamily: 'monospace', marginTop: '2px' }
          }, '#' + tag)
        ),
        // Info rows
        React.createElement('div', {
          style: {
            display: 'flex', flexDirection: 'column', gap: '6px',
          }
        },
          // Account age
          React.createElement('div', {
            style: {
              fontSize: '12px', color: '#949ba4',
              display: 'flex', alignItems: 'center', gap: '6px',
            }
          },
            React.createElement('span', {
              style: { fontSize: '11px', opacity: 0.7, width: '16px', textAlign: 'center' }
            }, '\u23F0'),
            accountAge
          ),
          // Chips balance (only show if available)
          chips !== null && chips !== undefined ? React.createElement('div', {
            style: {
              fontSize: '13px', color: '#f0b232', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '6px',
            }
          },
            React.createElement('span', { style: { fontSize: '14px', width: '16px', textAlign: 'center' } }, '\u2B50'),
            chips.toLocaleString() + ' chips'
          ) : null
        )
      )
    );
  }

  // Stats row section
  function renderStats() {
    if (!profile) return null;
    var gamesPlayed = profile.gamesPlayed || 0;
    var gamesWon = profile.gamesWon || 0;
    var totalMessages = profile.totalMessages || 0;
    var tcgCards = profile.tcgCardsOwned || 0;

    var statBoxStyle = {
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', padding: '8px 4px',
      background: 'rgba(0,0,0,0.25)', borderRadius: '6px',
    };
    var statValueStyle = {
      fontSize: '15px', fontWeight: 700, color: '#e8e6e3',
      lineHeight: '1.2',
    };
    var statLabelStyle = {
      fontSize: '10px', color: '#72767d', marginTop: '2px',
      textTransform: 'uppercase', letterSpacing: '0.3px',
    };

    return React.createElement('div', {
      style: { padding: '0 16px 12px' }
    },
      // Stats grid
      React.createElement('div', {
        style: { display: 'flex', gap: '6px', marginBottom: '8px' }
      },
        React.createElement('div', { style: statBoxStyle },
          React.createElement('div', { style: statValueStyle }, gamesPlayed.toLocaleString()),
          React.createElement('div', { style: statLabelStyle }, 'Played')
        ),
        React.createElement('div', { style: statBoxStyle },
          React.createElement('div', { style: statValueStyle }, gamesWon.toLocaleString()),
          React.createElement('div', { style: statLabelStyle }, 'Won')
        ),
        React.createElement('div', { style: statBoxStyle },
          React.createElement('div', { style: statValueStyle }, totalMessages.toLocaleString()),
          React.createElement('div', { style: statLabelStyle }, 'Msgs')
        )
      ),
      // TCG cards count row
      tcgCards > 0 ? React.createElement('div', {
        style: {
          fontSize: '12px', color: '#949ba4',
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '4px 0',
        }
      },
        React.createElement('span', { style: { fontSize: '13px' } }, '\uD83C\uDCCF'),
        tcgCards + ' TCG card' + (tcgCards !== 1 ? 's' : '') + ' owned'
      ) : null
    );
  }

  return React.createElement('div', { ref: menuRef, style: menuStyle },
    // Loading skeleton or profile content
    loading ? renderSkeleton() : React.createElement(React.Fragment, null,
      // Profile header with accent banner and avatar
      renderProfileHeader(),
      // Stats section
      renderStats(),
      // Separator between profile section and action buttons
      React.createElement('div', {
        style: {
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
          margin: '0 16px',
        }
      })
    ),
    // Status message
    status ? React.createElement('div', {
      style: { padding: '6px 16px', color: '#57f287', fontSize: '12px' }
    }, status) : null,
    // Action buttons
    React.createElement('div', { style: { padding: '4px 0' } },
      // View Profile button
      React.createElement('button', {
        style: btnStyle(),
        onClick: handleViewProfile,
        onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; },
        onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
      },
        React.createElement('span', { style: { fontSize: '14px', width: '20px', textAlign: 'center' } }, '\uD83D\uDC64'),
        'View Profile'
      ),
      // Add Friend (only for non-temp, non-self)
      !isTemp && !isSelf ? React.createElement('button', {
        style: btnStyle(),
        onClick: addFriend,
        onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; },
        onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
      },
        React.createElement('span', { style: { fontSize: '14px', width: '20px', textAlign: 'center' } }, '\uD83D\uDC65'),
        'Add Friend'
      ) : null,
      // Send DM (only for non-temp, non-self)
      !isTemp && !isSelf ? React.createElement('button', {
        style: btnStyle(),
        onClick: function() {
          if (!socket || isTemp || isSelf) return;
          // Navigate to DMs tab -- the app can listen via window._bosscordOpenDM
          if (window._bosscordOpenDM) {
            window._bosscordOpenDM(friendTag);
          }
          if (onClose) onClose();
        },
        onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; },
        onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
      },
        React.createElement('span', { style: { fontSize: '14px', width: '20px', textAlign: 'center' } }, '\uD83D\uDCE9'),
        'Send Message'
      ) : null,
      // Block (only for non-temp, non-self)
      !isTemp && !isSelf ? React.createElement('button', {
        style: Object.assign({}, btnStyle(), { color: '#ed4245' }),
        onClick: blockUser,
        onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; },
        onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
      },
        React.createElement('span', { style: { fontSize: '14px', width: '20px', textAlign: 'center' } }, '\u26D4'),
        'Block'
      ) : null,
      // Close
      React.createElement('div', {
        style: { borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: '2px', paddingTop: '2px' }
      },
        React.createElement('button', {
          style: btnStyle(),
          onClick: onClose,
          onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; },
          onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
        },
          React.createElement('span', { style: { fontSize: '14px', width: '20px', textAlign: 'center' } }, '\u2715'),
          'Close'
        )
      )
    )
  );
}

// ===================== QUICK SWITCHER =====================
// Modal overlay with a search input that filters rooms by name.
// Open via Ctrl+K / Cmd+K. Close on Escape or click-outside.
function QuickSwitcher(props) {
  var onClose = props.onClose;
  var onSwitchRoom = props.onSwitchRoom;
  var onSwitchTab = props.onSwitchTab;
  var ctx = useSocket();
  var [query, setQuery] = useState('');
  var [selectedIndex, setSelectedIndex] = useState(0);
  var inputRef = useRef(null);
  var containerRef = useRef(null);
  var onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Build the list of items to search: rooms + tabs
  var allItems = useMemo(function() {
    var items = [];
    // Rooms
    var rooms = ctx.rooms || [];
    for (var i = 0; i < rooms.length; i++) {
      items.push({ type: 'room', code: rooms[i].code, name: rooms[i].name || rooms[i].code, icon: '#' });
    }
    // Tabs
    var tabList = [
      { id: 'chat', label: 'Chat', icon: '#' },
      { id: 'cords', label: 'Cords', icon: '\uD83D\uDCAC' },
      { id: 'games', label: 'Games', icon: '\uD83C\uDFAE' },
      { id: 'friends', label: 'Friends', icon: '\uD83D\uDC65' },
      { id: 'dms', label: 'DMs', icon: '\uD83D\uDD12' },
      { id: 'roulette', label: 'Roulette', icon: '\uD83C\uDFB2' },
      { id: 'leaderboard', label: 'Leaderboard', icon: '\uD83C\uDFC6' },
      { id: 'profile', label: 'Profile', icon: '\uD83D\uDC64' },
      { id: 'about', label: 'About', icon: '\u2139\uFE0F' }
    ];
    for (var t = 0; t < tabList.length; t++) {
      items.push({ type: 'tab', id: tabList[t].id, name: tabList[t].label, icon: tabList[t].icon });
    }
    return items;
  }, [ctx.rooms]);

  var filtered = useMemo(function() {
    var q = query.toLowerCase().trim();
    if (!q) return allItems;
    return allItems.filter(function(item) {
      return item.name.toLowerCase().indexOf(q) !== -1;
    });
  }, [query, allItems]);

  // Reset selected index when filtered list changes
  useEffect(function() {
    setSelectedIndex(0);
  }, [filtered.length]);

  // Focus input on mount
  useEffect(function() {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // Click outside to close
  useEffect(function() {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        if (onCloseRef.current) onCloseRef.current();
      }
    }
    var evtName = window.PointerEvent ? 'pointerdown' : 'mousedown';
    var t = setTimeout(function() { document.addEventListener(evtName, handleClickOutside); }, 50);
    return function() {
      clearTimeout(t);
      document.removeEventListener(evtName, handleClickOutside);
    };
  }, []);

  function selectItem(item) {
    if (!item) return;
    if (item.type === 'room' && onSwitchRoom) {
      onSwitchRoom(item.code);
    } else if (item.type === 'tab' && onSwitchTab) {
      onSwitchTab(item.id);
    }
    if (onCloseRef.current) onCloseRef.current();
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (onCloseRef.current) onCloseRef.current();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(function(prev) {
        return prev < filtered.length - 1 ? prev + 1 : 0;
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(function(prev) {
        return prev > 0 ? prev - 1 : filtered.length - 1;
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0 && selectedIndex >= 0 && selectedIndex < filtered.length) {
        selectItem(filtered[selectedIndex]);
      }
      return;
    }
  }

  return React.createElement('div', {
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.6)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '80px',
      zIndex: 10001
    }
  },
    React.createElement('div', {
      ref: containerRef,
      style: {
        width: '100%', maxWidth: '480px',
        background: '#2a2a2e', borderRadius: '10px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        overflow: 'hidden'
      }
    },
      // Search input
      React.createElement('div', {
        style: { padding: '16px 16px 0' }
      },
        React.createElement('input', {
          ref: inputRef,
          type: 'text',
          value: query,
          onChange: function(e) { setQuery(e.target.value); },
          onKeyDown: handleKeyDown,
          placeholder: 'Search rooms and tabs...',
          style: {
            width: '100%', padding: '12px 14px',
            background: '#1c1c1e', border: '1px solid #3a3a3e',
            borderRadius: '6px', color: '#dcddde',
            fontSize: '15px', outline: 'none', fontFamily: 'inherit',
            boxSizing: 'border-box'
          }
        })
      ),
      // Results list
      React.createElement('div', {
        style: {
          maxHeight: '320px', overflowY: 'auto',
          padding: '8px'
        }
      },
        filtered.length === 0
          ? React.createElement('div', {
              style: { padding: '20px', textAlign: 'center', color: '#72767d', fontSize: '13px' }
            }, 'No results found')
          : filtered.map(function(item, idx) {
              var isSelected = idx === selectedIndex;
              var key = item.type === 'room' ? 'room-' + item.code : 'tab-' + item.id;
              return React.createElement('div', {
                key: key,
                style: {
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 12px', borderRadius: '6px', cursor: 'pointer',
                  background: isSelected ? '#3a3a3e' : 'transparent',
                  transition: 'background 0.1s'
                },
                onClick: function() { selectItem(item); },
                onMouseEnter: function() { setSelectedIndex(idx); }
              },
                React.createElement('span', {
                  style: { fontSize: '16px', width: '24px', textAlign: 'center', flexShrink: 0 }
                }, item.icon),
                React.createElement('span', {
                  style: { color: '#dcddde', fontSize: '14px', fontWeight: 500, flex: 1 }
                }, item.name),
                React.createElement('span', {
                  style: { color: '#72767d', fontSize: '11px', textTransform: 'uppercase', fontWeight: 600 }
                }, item.type === 'room' ? 'Room' : 'Tab')
              );
            })
      ),
      // Footer hint
      React.createElement('div', {
        style: {
          padding: '8px 16px', borderTop: '1px solid #1c1c1e',
          display: 'flex', gap: '16px', fontSize: '11px', color: '#72767d'
        }
      },
        React.createElement('span', null, '\u2191\u2193 navigate'),
        React.createElement('span', null, '\u23CE select'),
        React.createElement('span', null, 'esc close')
      )
    )
  );
}

// ===================== SKELETON ROW =====================
// Reusable loading skeleton row: circular avatar placeholder + text bar.
// count: number of skeleton rows to render (default 5).
// Returns an array of React elements.
function SkeletonRow(count) {
  var n = (typeof count === 'number' && count > 0) ? count : 5;
  var rows = [];
  for (var i = 0; i < n; i++) {
    rows.push(
      React.createElement('div', {
        key: 'skeleton-row-' + i,
        style: {
          display: 'flex', alignItems: 'center', gap: '12px',
          padding: '10px 16px',
        }
      },
        // Circular avatar placeholder
        React.createElement('div', {
          className: 'skeleton',
          style: {
            width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
          }
        }),
        // Text bar placeholder
        React.createElement('div', {
          style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }
        },
          React.createElement('div', {
            className: 'skeleton',
            style: { width: (60 + (i * 7) % 30) + '%', height: '12px' }
          }),
          React.createElement('div', {
            className: 'skeleton',
            style: { width: (35 + (i * 11) % 25) + '%', height: '10px' }
          })
        )
      )
    );
  }
  return rows;
}

// Skeleton circle for room list sidebar (icon-only variant).
// count: number of circles (default 5).
// Returns an array of React elements.
function SkeletonCircle(count) {
  var n = (typeof count === 'number' && count > 0) ? count : 5;
  var circles = [];
  for (var i = 0; i < n; i++) {
    circles.push(
      React.createElement('div', {
        key: 'skeleton-circle-' + i,
        style: {
          width: '48px', height: '48px', position: 'relative',
        }
      },
        React.createElement('div', {
          className: 'skeleton',
          style: {
            width: '48px', height: '48px', borderRadius: '50%',
          }
        })
      )
    );
  }
  return circles;
}

// ===================== KEYBOARD SHORTCUTS HELP =====================
function KeyboardShortcutsHelp(props) {
  var onClose = props.onClose;
  var containerRef = useRef(null);
  var onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Click outside to close
  useEffect(function() {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        if (onCloseRef.current) onCloseRef.current();
      }
    }
    function handleEsc(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (onCloseRef.current) onCloseRef.current();
      }
    }
    var evtName = window.PointerEvent ? 'pointerdown' : 'mousedown';
    var t = setTimeout(function() { document.addEventListener(evtName, handleClickOutside); }, 50);
    document.addEventListener('keydown', handleEsc);
    return function() {
      clearTimeout(t);
      document.removeEventListener(evtName, handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  var isMac = navigator.platform && navigator.platform.indexOf('Mac') !== -1;
  var modKey = isMac ? 'Cmd' : 'Ctrl';

  var shortcuts = [
    { keys: modKey + ' + K', desc: 'Open quick switcher' },
    { keys: modKey + ' + Shift + M', desc: 'Toggle voice mute' },
    { keys: 'Escape', desc: 'Close any open modal/picker' },
    { keys: 'Alt + \u2191', desc: 'Switch to previous room' },
    { keys: 'Alt + \u2193', desc: 'Switch to next room' },
    { keys: modKey + ' + /', desc: 'Show keyboard shortcuts' }
  ];

  return React.createElement('div', {
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 10001
    }
  },
    React.createElement('div', {
      ref: containerRef,
      style: {
        width: '100%', maxWidth: '440px',
        background: '#2a2a2e', borderRadius: '12px',
        boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
        padding: '24px'
      }
    },
      // Title
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '20px'
        }
      },
        React.createElement('div', {
          style: { fontSize: '18px', fontWeight: 700, color: '#f0b232' }
        }, 'Keyboard Shortcuts'),
        React.createElement('button', {
          onClick: function() { if (onCloseRef.current) onCloseRef.current(); },
          style: {
            background: 'none', border: 'none', color: '#72767d',
            fontSize: '20px', cursor: 'pointer', padding: '4px',
            lineHeight: '1'
          }
        }, '\u2715')
      ),
      // Shortcuts list
      React.createElement('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '4px' }
      },
        shortcuts.map(function(s, i) {
          return React.createElement('div', {
            key: i,
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderRadius: '6px',
              background: i % 2 === 0 ? '#1c1c1e' : 'transparent'
            }
          },
            React.createElement('span', {
              style: { color: '#b5bac1', fontSize: '14px' }
            }, s.desc),
            React.createElement('span', {
              style: {
                fontFamily: 'monospace', fontSize: '12px', fontWeight: 600,
                color: '#dcddde', background: '#3a3a3e', padding: '3px 8px',
                borderRadius: '4px', whiteSpace: 'nowrap'
              }
            }, s.keys)
          );
        })
      )
    )
  );
}

