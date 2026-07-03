function LeaderboardTab() {
  var ctx = useSocket();
  var [leaderboard, setLeaderboard] = useState([]);
  var [loading, setLoading] = useState(true);
  var [userMenu, setUserMenu] = useState(null);

  function openUserMenu(e, username, tag, color) {
    e.stopPropagation();
    setUserMenu({ username: username, tag: tag, color: color, x: e.clientX, y: e.clientY });
  }

  useEffect(function() {
    if (!ctx.socket) return;
    setLoading(true);
    ctx.socket.emit('leaderboard_get');
    function onData(data) {
      setLeaderboard(data.leaderboard || []);
      setLoading(false);
    }
    ctx.socket.on('leaderboard_data', onData);
    return function() { ctx.socket.off('leaderboard_data', onData); };
  }, [ctx.socket]);

  function refresh() {
    if (!ctx.socket) return;
    setLoading(true);
    ctx.socket.emit('leaderboard_get');
  }

  function medalColor(i) {
    if (i === 0) return '#f0b232'; // gold
    if (i === 1) return '#c0c0c0'; // silver
    if (i === 2) return '#cd7f32'; // bronze
    return '#949ba4';
  }

  function medalIcon(i) {
    if (i === 0) return '\uD83E\uDD47';
    if (i === 1) return '\uD83E\uDD48';
    if (i === 2) return '\uD83E\uDD49';
    return '#' + (i + 1);
  }

  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      background: '#1c1c1e', overflow: 'hidden'
    }
  },
    // Header
    React.createElement('div', {
      style: {
        padding: '20px 24px 12px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }
    },
      React.createElement('div', null,
        React.createElement('h2', {
          style: { color: '#dcddde', fontSize: '22px', fontWeight: 700, marginBottom: '4px' }
        },
          React.createElement('span', { style: { color: '#f0b232' } }, '\uD83C\uDFC6 '),
          'Leaderboard'
        ),
        React.createElement('p', {
          style: { color: '#949ba4', fontSize: '13px' }
        }, 'Top players by chips')
      ),
      React.createElement('button', {
        style: {
          padding: '6px 16px', background: '#252528', border: '1px solid #4e5058',
          borderRadius: '6px', color: '#dcddde', fontSize: '12px',
          fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit'
        },
        onClick: refresh
      }, 'Refresh')
    ),

    // List
    React.createElement('div', {
      style: { flex: 1, overflow: 'auto', padding: '0 24px 24px' }
    },
      loading ? React.createElement('div', {
        style: { textAlign: 'center', color: '#949ba4', padding: '40px', fontSize: '14px' }
      }, 'Loading...') :
      leaderboard.length === 0 ? React.createElement('div', {
        style: { textAlign: 'center', color: '#72767d', padding: '40px', fontSize: '14px' }
      }, 'No accounts yet. Be the first to claim a key!') :
      leaderboard.map(function(entry, i) {
        var isTop3 = i < 3;
        return React.createElement('div', {
          key: i,
          style: {
            display: 'flex', alignItems: 'center', gap: '12px',
            padding: isTop3 ? '12px 16px' : '10px 16px',
            background: isTop3 ? 'rgba(240,178,50,' + (0.08 - i * 0.02) + ')' : (i % 2 === 0 ? '#252528' : '#1c1c1e'),
            borderRadius: '8px', marginBottom: '4px',
            border: isTop3 ? '1px solid ' + medalColor(i) : '1px solid transparent',
            transition: 'background 0.15s'
          }
        },
          // Rank
          React.createElement('div', {
            style: {
              width: '36px', textAlign: 'center', fontSize: isTop3 ? '20px' : '14px',
              fontWeight: 700, color: medalColor(i), flexShrink: 0
            }
          }, medalIcon(i)),

          // Avatar circle
          entry.avatar
            ? React.createElement('img', {
                src: entry.avatar,
                style: {
                  width: '32px', height: '32px', borderRadius: '50%',
                  objectFit: 'cover', flexShrink: 0
                }
              })
            : React.createElement('div', {
                style: {
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: entry.color || '#4e5058', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '14px', fontWeight: 700, color: '#1c1c1e'
                }
              }, (entry.username || '?')[0].toUpperCase()),

          // Name
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: '4px'
              }
            },
              React.createElement('span', {
                style: {
                  color: isTop3 ? medalColor(i) : '#dcddde',
                  fontSize: isTop3 ? '15px' : '14px',
                  fontWeight: isTop3 ? 700 : 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  cursor: 'pointer'
                },
                onClick: function(e) { openUserMenu(e, entry.username || 'Anonymous', entry.tag || '????', entry.color || '#dcddde'); }
              }, entry.username || 'Anonymous'),
              entry.tag ? React.createElement('span', {
                style: { fontSize: '10px', color: '#666', fontFamily: 'monospace' }
              }, '#' + entry.tag) : null
            ),
            React.createElement('div', {
              style: { color: '#72767d', fontSize: '11px' }
            }, 'W: ' + ((entry.stats && entry.stats.wins) || 0) + ' / L: ' + ((entry.stats && entry.stats.losses) || 0))
          ),

          // Chips
          React.createElement('div', {
            style: {
              color: '#f0b232', fontSize: isTop3 ? '18px' : '15px',
              fontWeight: 800, flexShrink: 0, fontFamily: 'monospace'
            }
          }, (entry.chips || 0).toLocaleString()),

          React.createElement('span', {
            style: { color: '#949ba4', fontSize: '11px', flexShrink: 0 }
          }, 'chips')
        );
      }),

      // User action menu popup
      userMenu ? React.createElement(UserActionMenu, {
        username: userMenu.username,
        tag: userMenu.tag,
        color: userMenu.color,
        position: { x: userMenu.x, y: userMenu.y },
        onClose: function() { setUserMenu(null); }
      }) : null
    )
  );
}
