// handlers/friends.js
// Socket handlers: friends_list_get, friend_requests_get, friend_request_send,
//                  friend_request_accept, friend_request_reject, friend_remove,
//                  friend_block, friend_unblock, friend_invite_game

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate } = deps;

    socket.on('friends_list_get', () => {
      try {
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) {
          socket.emit('friends_list', { friends: [], incoming: [], outgoing: [], blocked: [], myTag: null });
          return;
        }
        if (!checkEventRate(socket, 'friends_list_get', 30, 60000)) return;
        var data = accounts.getFriendsData(key);
        // Enrich with online status and friend tags
        var onlineKeys = new Set();
        for (var [, skey] of socketAccountMap) {
          if (!accounts.isTempAccount(skey)) onlineKeys.add(skey);
        }
        for (var i = 0; i < data.friends.length; i++) {
          data.friends[i].online = onlineKeys.has(data.friends[i].key);
          data.friends[i].tag = accounts.getUserTag(data.friends[i].key) || '';
        }
        // Include user's own tag
        data.myTag = accounts.getUserTag(key);
        socket.emit('friends_list', data);
      } catch (err) {
        console.error('[friends_list_get] Error:', err.message);
      }
    });

    socket.on('friend_requests_get', () => {
      try {
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) {
          socket.emit('friend_requests_list', { incoming: [], outgoing: [] });
          return;
        }
        if (!checkEventRate(socket, 'friend_requests_get', 30, 60000)) return;
        var data = accounts.getFriendsData(key);
        socket.emit('friend_requests_list', { incoming: data.incoming, outgoing: data.outgoing });
      } catch (err) {
        console.error('[friend_requests_get] Error:', err.message);
      }
    });

    socket.on('friend_request_send', (data) => {
      try {
        if (!data) return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) {
          socket.emit('error', { message: 'Permanent account required to add friends' });
          return;
        }
        if (!checkEventRate(socket, 'friend_request', 10, 300000)) {
          socket.emit('error', { message: 'Too many friend requests. Slow down.' });
          return;
        }

        // Resolve target key from friend tag (Username#ABCD format)
        var targetKey = null;
        if (data.tag && typeof data.tag === 'string') {
          var hashIdx = data.tag.lastIndexOf('#');
          if (hashIdx > 0 && data.tag.length - hashIdx - 1 >= 4) {
            var tagName = data.tag.slice(0, hashIdx).trim();
            var tagDisc = data.tag.slice(hashIdx + 1).trim();
            targetKey = accounts.findAccountByTag(tagName, tagDisc);
            if (!targetKey) {
              socket.emit('error', { message: 'User not found. They may not have a permanent account.' });
              return;
            }
          } else {
            socket.emit('error', { message: 'Invalid tag format. Use Username#ABCD.' });
            return;
          }
        } else {
          socket.emit('error', { message: 'Please use friend tag format: Username#ABCD' });
          return;
        }

        var result = accounts.sendFriendRequest(key, targetKey);
        if (result.error) {
          socket.emit('error', { message: result.error });
          return;
        }
        socket.emit('friend_request_sent', { tag: data.tag });
        // Refresh sender's friends data
        var senderData = accounts.getFriendsData(key);
        socket.emit('friends_list', senderData);

        // Notify target if online
        for (var [sid, skey] of socketAccountMap) {
          if (skey === targetKey) {
            var targetSocket = io.sockets.sockets.get(sid);
            if (targetSocket) {
              var myAcc = accounts.loadAccount(key);
              targetSocket.emit('friend_request_received', {
                fromKey: key,
                fromUsername: myAcc ? myAcc.username : 'Unknown',
              });
              var targetData = accounts.getFriendsData(targetKey);
              targetSocket.emit('friends_list', targetData);
            }
            break;
          }
        }
      } catch (err) {
        console.error('[friend_request_send] Error:', err.message);
      }
    });

    socket.on('friend_request_accept', (data) => {
      try {
        if (!data || typeof data.requesterKey !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) return;
        if (!checkEventRate(socket, 'friend_accept', 20, 60000)) return;

        var result = accounts.acceptFriendRequest(key, data.requesterKey);
        if (result.error) {
          socket.emit('error', { message: result.error });
          return;
        }
        // Refresh accepter's data
        var onlineKeys = new Set();
        for (var [, skey] of socketAccountMap) {
          if (!accounts.isTempAccount(skey)) onlineKeys.add(skey);
        }
        var myData = accounts.getFriendsData(key);
        for (var i = 0; i < myData.friends.length; i++) myData.friends[i].online = onlineKeys.has(myData.friends[i].key);
        socket.emit('friends_list', myData);

        // Notify requester if online
        for (var [sid, skey] of socketAccountMap) {
          if (skey === data.requesterKey) {
            var reqSocket = io.sockets.sockets.get(sid);
            if (reqSocket) {
              reqSocket.emit('friend_request_accepted', { by: result.accepterName || 'Someone' });
              var reqData = accounts.getFriendsData(data.requesterKey);
              for (var j = 0; j < reqData.friends.length; j++) reqData.friends[j].online = onlineKeys.has(reqData.friends[j].key);
              reqSocket.emit('friends_list', reqData);
            }
            break;
          }
        }
      } catch (err) {
        console.error('[friend_request_accept] Error:', err.message);
      }
    });

    socket.on('friend_request_reject', (data) => {
      try {
        if (!data || typeof data.requesterKey !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) return;
        if (!checkEventRate(socket, 'friend_reject', 20, 60000)) return;

        var result = accounts.rejectFriendRequest(key, data.requesterKey);
        if (result.error) {
          socket.emit('error', { message: result.error });
          return;
        }
        var myData = accounts.getFriendsData(key);
        socket.emit('friends_list', myData);
      } catch (err) {
        console.error('[friend_request_reject] Error:', err.message);
      }
    });

    socket.on('friend_remove', (data) => {
      try {
        if (!data || typeof data.friendKey !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) return;
        if (!checkEventRate(socket, 'friend_remove', 20, 60000)) return;

        var result = accounts.removeFriend(key, data.friendKey);
        if (result.error) {
          socket.emit('error', { message: result.error });
          return;
        }
        var myData = accounts.getFriendsData(key);
        socket.emit('friends_list', myData);

        // Notify removed friend if online
        for (var [sid, skey] of socketAccountMap) {
          if (skey === data.friendKey) {
            var friendSocket = io.sockets.sockets.get(sid);
            if (friendSocket) {
              var friendData = accounts.getFriendsData(data.friendKey);
              friendSocket.emit('friends_list', friendData);
            }
            break;
          }
        }
      } catch (err) {
        console.error('[friend_remove] Error:', err.message);
      }
    });

    socket.on('friend_block', (data) => {
      try {
        if (!data || typeof data.targetKey !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) return;
        if (!checkEventRate(socket, 'friend_block', 20, 60000)) return;

        var result = accounts.blockUser(key, data.targetKey);
        if (result.error) {
          socket.emit('error', { message: result.error });
          return;
        }
        var myData = accounts.getFriendsData(key);
        socket.emit('friends_list', myData);
      } catch (err) {
        console.error('[friend_block] Error:', err.message);
      }
    });

    socket.on('friend_unblock', (data) => {
      try {
        if (!data || typeof data.targetKey !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) return;
        if (!checkEventRate(socket, 'friend_unblock', 20, 60000)) return;

        var result = accounts.unblockUser(key, data.targetKey);
        if (result.error) {
          socket.emit('error', { message: result.error });
          return;
        }
        var myData = accounts.getFriendsData(key);
        socket.emit('friends_list', myData);
      } catch (err) {
        console.error('[friend_unblock] Error:', err.message);
      }
    });

    // Block by tag (from UserActionMenu) — resolves tag to key then blocks
    socket.on('friend_block_by_tag', (data) => {
      try {
        if (!data || typeof data.tag !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) return;
        if (!checkEventRate(socket, 'friend_block', 20, 60000)) return;

        var hashIdx = data.tag.lastIndexOf('#');
        if (hashIdx <= 0) return;
        var tagName = data.tag.slice(0, hashIdx).trim();
        var tagDisc = data.tag.slice(hashIdx + 1).trim();
        var targetKey = accounts.findAccountByTag(tagName, tagDisc);
        if (!targetKey) {
          socket.emit('error', { message: 'User not found' });
          return;
        }

        var result = accounts.blockUser(key, targetKey);
        if (result && result.error) {
          socket.emit('error', { message: result.error });
          return;
        }
        var myData = accounts.getFriendsData(key);
        socket.emit('friends_list', myData);
      } catch (err) {
        console.error('[friend_block_by_tag] Error:', err.message);
      }
    });

    socket.on('friend_invite_game', (data) => {
      try {
        if (!data || typeof data.targetKey !== 'string' || typeof data.gameType !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) return;
        if (!checkEventRate(socket, 'friend_invite', 10, 60000)) return;

        // Verify friendship
        var myAcc = accounts.loadAccount(key);
        if (!myAcc) return;
        var isFriend = (myAcc.friends || []).some(function(f) { return f.key === data.targetKey; });
        if (!isFriend) {
          socket.emit('error', { message: 'Not on your friends list' });
          return;
        }

        // Find target socket
        for (var [sid, skey] of socketAccountMap) {
          if (skey === data.targetKey) {
            var targetSocket = io.sockets.sockets.get(sid);
            if (targetSocket) {
              // If this is a TCG table invite, also emit the tcg_table_invite event
              if (data.gameType === 'tcg' && data.lobbyId) {
                targetSocket.emit('tcg_table_invite', {
                  tableId: data.lobbyId,
                  fromName: myAcc.username,
                  fromColor: myAcc.color || '#dcddde',
                  tableName: (myAcc.username || 'Anon') + "'s Table",
                });
              }
              targetSocket.emit('game_invite', {
                fromKey: key,
                fromUsername: myAcc.username,
                gameType: data.gameType,
                lobbyId: data.lobbyId || null,
              });
              socket.emit('friend_invite_sent');
            }
            break;
          }
        }
      } catch (err) {
        console.error('[friend_invite_game] Error:', err.message);
      }
    });
  }
};
