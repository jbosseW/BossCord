function FriendsPanel() {
  var ctx = useSocket();
  var [friendsData, setFriendsData] = useState({ friends: [], incoming: [], outgoing: [], blocked: [], myTag: null });
  var [friendsLoaded, setFriendsLoaded] = useState(false);
  var [tab, setTab] = useState('friends'); // 'friends' | 'requests' | 'add' | 'blocked'
  var [addTagInput, setAddTagInput] = useState('');
  var [status, setStatus] = useState(null);
  var [tagCopied, setTagCopied] = useState(false);
  var [tcgInvite, setTcgInvite] = useState(null);
  var statusTimerRef = useRef(null);
  var tagCopiedTimerRef = useRef(null);

  // Clean up timers on unmount
  useEffect(function() {
    return function() {
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      if (tagCopiedTimerRef.current) clearTimeout(tagCopiedTimerRef.current);
    };
  }, []);

  useEffect(function() {
    if (!ctx.socket) return;
    ctx.socket.emit('friends_list_get');

    function onFriendsList(data) { setFriendsData(data); setFriendsLoaded(true); }
    function onRequestReceived(data) {
      setStatus(data.fromUsername + ' sent you a friend request!');
      if (typeof BossCordNotifs !== 'undefined') BossCordNotifs.notify('Friend Request', data.fromUsername + ' sent you a friend request!', 'freq');
      ctx.socket.emit('friends_list_get');
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(function() { setStatus(null); }, 4000);
    }
    function onRequestAccepted(data) {
      setStatus(data.by + ' accepted your friend request!');
      if (typeof BossCordNotifs !== 'undefined') BossCordNotifs.notify('Friend Accepted', data.by + ' accepted your friend request!', 'facc');
      ctx.socket.emit('friends_list_get');
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(function() { setStatus(null); }, 4000);
    }
    function onStatusChanged(data) {
      setFriendsData(function(prev) {
        return Object.assign({}, prev, {
          friends: prev.friends.map(function(f) {
            return f.key === data.key ? Object.assign({}, f, { online: data.online }) : f;
          })
        });
      });
    }
    function onInvite(data) {
      setStatus(data.fromUsername + ' invited you to play ' + data.gameType + '!');
      if (typeof BossCordNotifs !== 'undefined') BossCordNotifs.notify('Game Invite', data.fromUsername + ' invited you to ' + data.gameType + '!', 'ginv');
      // If this is a TCG invite with a lobbyId, also trigger the tcg_table_invite handler
      if (data.gameType === 'tcg' && data.lobbyId) {
        setTcgInvite({ tableId: data.lobbyId, fromName: data.fromUsername });
      }
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(function() { setStatus(null); }, 5000);
    }
    function onTcgTableInvite(data) {
      setTcgInvite({ tableId: data.tableId, fromName: data.fromName || 'Someone', fromColor: data.fromColor || '#dcddde' });
      setStatus((data.fromName || 'Someone') + ' invited you to a card battle table!');
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(function() { setStatus(null); }, 6000);
    }

    ctx.socket.on('friends_list', onFriendsList);
    ctx.socket.on('friend_request_received', onRequestReceived);
    ctx.socket.on('friend_request_accepted', onRequestAccepted);
    ctx.socket.on('friend_status_changed', onStatusChanged);
    ctx.socket.on('game_invite', onInvite);
    ctx.socket.on('tcg_table_invite', onTcgTableInvite);

    return function() {
      ctx.socket.off('friends_list', onFriendsList);
      ctx.socket.off('friend_request_received', onRequestReceived);
      ctx.socket.off('friend_request_accepted', onRequestAccepted);
      ctx.socket.off('friend_status_changed', onStatusChanged);
      ctx.socket.off('game_invite', onInvite);
      ctx.socket.off('tcg_table_invite', onTcgTableInvite);
    };
  }, [ctx.socket]);

  var isTemp = ctx.account && ctx.account.temp;

  if (!ctx.account || isTemp) {
    return React.createElement('div', {
      style: { padding: '40px 20px', textAlign: 'center', color: '#72767d' }
    }, 'Claim a key to use the friends system');
  }

  function sendRequest() {
    var tag = addTagInput.trim();
    if (!tag || !tag.includes('#')) return;
    ctx.socket.emit('friend_request_send', { tag: tag });
    setAddTagInput('');
  }

  function acceptRequest(requesterKey) {
    ctx.socket.emit('friend_request_accept', { requesterKey: requesterKey });
  }
  function rejectRequest(requesterKey) {
    ctx.socket.emit('friend_request_reject', { requesterKey: requesterKey });
  }
  function removeFriend(friendKey) {
    ctx.socket.emit('friend_remove', { friendKey: friendKey });
  }
  function blockUser(targetKey) {
    ctx.socket.emit('friend_block', { targetKey: targetKey });
  }
  function unblockUser(targetKey) {
    ctx.socket.emit('friend_unblock', { targetKey: targetKey });
  }
  function inviteToGame(friendKey, gameType) {
    ctx.socket.emit('friend_invite_game', { targetKey: friendKey, gameType: gameType });
    setStatus('Invite sent!');
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    statusTimerRef.current = setTimeout(function() { setStatus(null); }, 2000);
  }

  var tabBtnStyle = function(t) {
    return {
      flex: 1, padding: '8px 4px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
      background: tab === t ? '#2a2a2e' : 'transparent', color: tab === t ? '#f0b232' : '#72767d',
      borderBottom: tab === t ? '2px solid #f0b232' : '2px solid transparent', transition: 'all 0.2s',
    };
  };

  var pendingCount = friendsData.incoming.length;

  var content = null;

  if (tab === 'friends') {
    content = !friendsLoaded
      ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px' } },
          SkeletonRow(4)
        )
      : friendsData.friends.length === 0
      ? React.createElement('div', { style: { padding: '30px', textAlign: 'center', color: '#72767d' } }, 'No friends yet. Add someone!')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          friendsData.friends.map(function(f) {
            return React.createElement('div', {
              key: f.key,
              style: {
                display: 'flex', alignItems: 'center', padding: '10px 16px', gap: '12px',
                background: '#2a2a2e', borderRadius: '6px',
              }
            },
              // Online indicator
              React.createElement('div', {
                style: {
                  width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                  background: f.online ? '#57f287' : '#72767d',
                }
              }),
              // Username
              React.createElement('span', {
                style: { color: f.color || '#dcddde', fontWeight: 600, flex: 1 }
              }, f.username),
              // Chips
              React.createElement('span', {
                style: { color: '#f0b232', fontSize: '12px', marginRight: '8px' }
              }, (f.chips || 0).toLocaleString() + ' chips'),
              // Invite button (only if online)
              f.online ? React.createElement('button', {
                onClick: function() { inviteToGame(f.key, 'cards'); },
                title: 'Invite to play a game',
                style: {
                  padding: '4px 8px', border: 'none', borderRadius: '4px', cursor: 'pointer',
                  background: '#5865f2', color: '#fff', fontSize: '11px',
                }
              }, 'Play') : null,
              // Remove button
              React.createElement('button', {
                onClick: function() { removeFriend(f.key); },
                style: {
                  padding: '4px 8px', border: 'none', borderRadius: '4px', cursor: 'pointer',
                  background: '#ed4245', color: '#fff', fontSize: '11px',
                }
              }, 'Remove')
            );
          })
        );
  } else if (tab === 'requests') {
    var incomingSection = friendsData.incoming.length > 0
      ? React.createElement('div', null,
          React.createElement('div', { style: { padding: '8px 16px', fontSize: '12px', color: '#72767d', fontWeight: 600 } }, 'INCOMING'),
          friendsData.incoming.map(function(r) {
            return React.createElement('div', {
              key: r.key,
              style: { display: 'flex', alignItems: 'center', padding: '10px 16px', gap: '12px', background: '#2a2a2e', borderRadius: '6px' }
            },
              React.createElement('span', { style: { color: r.color || '#dcddde', fontWeight: 600, flex: 1 } }, r.username),
              React.createElement('button', {
                onClick: function() { acceptRequest(r.key); },
                style: { padding: '4px 10px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: '#57f287', color: '#000', fontSize: '12px', fontWeight: 600 }
              }, 'Accept'),
              React.createElement('button', {
                onClick: function() { rejectRequest(r.key); },
                style: { padding: '4px 10px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: '#ed4245', color: '#fff', fontSize: '12px' }
              }, 'Reject')
            );
          })
        )
      : null;

    var outgoingSection = friendsData.outgoing.length > 0
      ? React.createElement('div', null,
          React.createElement('div', { style: { padding: '8px 16px', fontSize: '12px', color: '#72767d', fontWeight: 600 } }, 'SENT'),
          friendsData.outgoing.map(function(r) {
            return React.createElement('div', {
              key: r.key,
              style: { display: 'flex', alignItems: 'center', padding: '10px 16px', gap: '12px', background: '#2a2a2e', borderRadius: '6px' }
            },
              React.createElement('span', { style: { color: r.color || '#dcddde', fontWeight: 600, flex: 1 } }, r.username),
              React.createElement('span', { style: { color: '#72767d', fontSize: '12px' } }, 'Pending...')
            );
          })
        )
      : null;

    content = (!incomingSection && !outgoingSection)
      ? React.createElement('div', { style: { padding: '30px', textAlign: 'center', color: '#72767d' } }, 'No pending requests')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, incomingSection, outgoingSection);

  } else if (tab === 'add') {
    var myTag = friendsData.myTag || '';
    content = React.createElement('div', { style: { padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' } },
      // Your tag display
      myTag ? React.createElement('div', {
        style: {
          background: '#1a1a2e', borderRadius: '10px', padding: '16px',
          border: '1px solid rgba(240,178,50,0.2)', textAlign: 'center'
        }
      },
        React.createElement('div', { style: { color: '#949ba4', fontSize: '11px', textTransform: 'uppercase', fontWeight: 700, marginBottom: '6px', letterSpacing: '0.5px' } }, 'Your Friend Tag'),
        React.createElement('div', {
          style: {
            fontSize: '20px', fontWeight: 700, color: '#f0b232',
            fontFamily: 'monospace', letterSpacing: '0.5px', cursor: 'pointer',
            userSelect: 'text', WebkitUserSelect: 'text'
          },
          onClick: function() {
            if (navigator.clipboard) navigator.clipboard.writeText(myTag).catch(function() {});
            setTagCopied(true);
            if (tagCopiedTimerRef.current) clearTimeout(tagCopiedTimerRef.current);
            tagCopiedTimerRef.current = setTimeout(function() { setTagCopied(false); }, 2000);
          },
          title: 'Click to copy'
        }, myTag),
        React.createElement('div', { style: { color: '#72767d', fontSize: '11px', marginTop: '6px' } },
          tagCopied ? 'Copied!' : 'Share this tag with friends so they can add you')
      ) : null,
      // Add friend input
      React.createElement('div', { style: { color: '#b5bac1', fontSize: '14px' } }, 'Add a friend by their tag:'),
      React.createElement('div', { style: { display: 'flex', gap: '8px' } },
        React.createElement('input', {
          value: addTagInput,
          onChange: function(e) { setAddTagInput(e.target.value.replace(/[^a-zA-Z0-9 #]/g, '')); },
          onKeyDown: function(e) { if (e.key === 'Enter') sendRequest(); },
          placeholder: 'Username#ABCD',
          maxLength: 30,
          style: {
            flex: 1, padding: '10px 12px', background: '#1e1f22', border: '1px solid #3a3a3e',
            borderRadius: '6px', color: '#dcddde', fontSize: '14px', outline: 'none',
            fontFamily: 'inherit'
          }
        }),
        React.createElement('button', {
          onClick: sendRequest,
          disabled: !addTagInput.includes('#') || addTagInput.trim().length < 6,
          style: {
            padding: '10px 16px', border: 'none', borderRadius: '6px', cursor: 'pointer',
            background: '#5865f2', color: '#fff', fontSize: '14px', fontWeight: 600,
            fontFamily: 'inherit', opacity: (!addTagInput.includes('#') || addTagInput.trim().length < 6) ? 0.5 : 1
          }
        }, 'Send')
      ),
      React.createElement('div', { style: { color: '#72767d', fontSize: '12px' } },
        'The tag looks like: Username#ABCD. Ask your friend for their tag from this page.')
    );

  } else if (tab === 'blocked') {
    content = friendsData.blocked.length === 0
      ? React.createElement('div', { style: { padding: '30px', textAlign: 'center', color: '#72767d' } }, 'No blocked users')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          friendsData.blocked.map(function(bKey) {
            return React.createElement('div', {
              key: bKey,
              style: { display: 'flex', alignItems: 'center', padding: '10px 16px', gap: '12px', background: '#2a2a2e', borderRadius: '6px' }
            },
              React.createElement('span', { style: { color: '#72767d', flex: 1, fontFamily: 'monospace', fontSize: '13px' } }, bKey),
              React.createElement('button', {
                onClick: function() { unblockUser(bKey); },
                style: { padding: '4px 10px', border: 'none', borderRadius: '4px', cursor: 'pointer', background: '#57f287', color: '#000', fontSize: '12px' }
              }, 'Unblock')
            );
          })
        );
  }

  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', height: '100%', background: '#1c1c1e' }
  },
    // Header
    React.createElement('div', {
      style: { padding: '16px 20px', borderBottom: '1px solid #2a2a2e', display: 'flex', alignItems: 'center', gap: '8px' }
    },
      React.createElement('span', { style: { fontSize: '18px', fontWeight: 700, color: '#f0b232' } }, 'Friends'),
      React.createElement('span', { style: { fontSize: '13px', color: '#72767d' } },
        friendsData.friends.filter(function(f) { return f.online; }).length + '/' + friendsData.friends.length + ' online'
      )
    ),
    // Status message
    status ? React.createElement('div', {
      style: { padding: '8px 20px', background: '#2d2d30', color: '#57f287', fontSize: '13px', textAlign: 'center' }
    }, status) : null,
    // TCG table invite banner
    tcgInvite ? React.createElement('div', {
      style: {
        padding: '10px 20px', background: '#2a2a1a', borderBottom: '1px solid #f0b232',
        display: 'flex', alignItems: 'center', gap: '10px'
      }
    },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('span', { style: { color: '#f0b232', fontWeight: 700, fontSize: '13px' } },
          '\u2694 ' + (tcgInvite.fromName || 'Someone') + ' invited you to a card battle!')
      ),
      React.createElement('button', {
        style: {
          padding: '5px 14px', background: '#57f287', border: 'none', borderRadius: '5px',
          color: '#1c1c1e', fontSize: '12px', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
        },
        onClick: function() {
          if (ctx.marketSocket) {
            ctx.marketSocket.emit('tcg_join_table', { tableId: tcgInvite.tableId });
          } else if (ctx.socket) {
            ctx.connectMarket();
            // Small delay to let market socket connect, then join
            setTimeout(function() {
              var ms = ctx.marketSocket;
              if (ms) ms.emit('tcg_join_table', { tableId: tcgInvite.tableId });
            }, 1000);
          }
          setTcgInvite(null);
        }
      }, 'Join Table'),
      React.createElement('button', {
        style: {
          padding: '5px 10px', background: 'none', border: '1px solid #4e5058', borderRadius: '5px',
          color: '#949ba4', fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit'
        },
        onClick: function() { setTcgInvite(null); }
      }, '\u2715')
    ) : null,
    // Tab bar
    React.createElement('div', {
      style: { display: 'flex', borderBottom: '1px solid #2a2a2e' }
    },
      React.createElement('button', { onClick: function() { setTab('friends'); }, style: tabBtnStyle('friends') }, 'Friends'),
      React.createElement('button', { onClick: function() { setTab('requests'); }, style: tabBtnStyle('requests') },
        'Requests' + (pendingCount > 0 ? ' (' + pendingCount + ')' : '')
      ),
      React.createElement('button', { onClick: function() { setTab('add'); }, style: tabBtnStyle('add') }, 'Add'),
      React.createElement('button', { onClick: function() { setTab('blocked'); }, style: tabBtnStyle('blocked') }, 'Blocked')
    ),
    // Content
    React.createElement('div', {
      style: { flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }
    }, content)
  );
}
