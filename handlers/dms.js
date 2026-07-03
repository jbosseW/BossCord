// handlers/dms.js
// Socket handlers: dm_set_public_key, dm_get_public_key, dm_send, dm_history, dm_conversations
// End-to-end encrypted direct messaging — server stores only encrypted blobs.

const crypto = require('crypto');

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate } = deps;

    // ── dm_set_public_key ──────────────────────────────────────────
    // Client registers their ECDH P-256 public key (base64 string)
    // Optionally accepts data.version for key rotation tracking
    socket.on('dm_set_public_key', (data) => {
      try {
        if (!data || typeof data.publicKey !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) {
          socket.emit('error', { message: 'Permanent account required for DMs' });
          return;
        }
        if (!checkEventRate(socket, 'dm_set_public_key', 10, 60000)) return;

        // Validate base64 and reasonable length (P-256 public key exported as raw is 65 bytes = ~88 chars base64)
        var pk = data.publicKey.trim();
        if (pk.length < 20 || pk.length > 500) {
          socket.emit('error', { message: 'Invalid public key format' });
          return;
        }

        var version = (typeof data.version === 'number' && data.version > 0) ? data.version : undefined;
        var result = accounts.setPublicKey(key, pk, version);
        if (result && result.error) {
          socket.emit('error', { message: result.error });
          return;
        }
        socket.emit('dm_public_key_set', { success: true, version: result.version });

        // Broadcast dm_key_rotated to all online friends so they can invalidate cached secrets
        var senderAcc = accounts.loadAccount(key);
        if (senderAcc && senderAcc.friends && Array.isArray(senderAcc.friends)) {
          for (var fi = 0; fi < senderAcc.friends.length; fi++) {
            var friendKey = senderAcc.friends[fi].key;
            // Find their socket(s) in socketAccountMap
            for (var [sid, skey] of socketAccountMap) {
              if (skey === friendKey) {
                var friendSocket = io.sockets.sockets.get(sid);
                if (friendSocket) {
                  friendSocket.emit('dm_key_rotated', {
                    accountKey: key,
                    version: result.version,
                  });
                }
              }
            }
          }
        }
      } catch (err) {
        console.error('[dm_set_public_key] Error:', err.message);
      }
    });

    // ── dm_get_public_key ──────────────────────────────────────────
    // Client requests another user's ECDH public key by account key
    socket.on('dm_get_public_key', (data) => {
      try {
        if (!data || typeof data.accountKey !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) {
          socket.emit('error', { message: 'Permanent account required for DMs' });
          return;
        }
        if (!checkEventRate(socket, 'dm_get_public_key', 60, 60000)) return;

        var keyData = accounts.getPublicKey(data.accountKey.trim());
        if (keyData && typeof keyData === 'object') {
          socket.emit('dm_public_key', {
            accountKey: data.accountKey,
            publicKey: keyData.key || null,
            keyVersion: typeof keyData.version === 'number' ? keyData.version : 0,
            previousKey: keyData.previousKey || null,
            previousVersion: typeof keyData.previousVersion === 'number' ? keyData.previousVersion : null,
          });
        } else {
          // null or legacy string fallback (should not happen with updated getPublicKeyE2E)
          socket.emit('dm_public_key', {
            accountKey: data.accountKey,
            publicKey: null,
            keyVersion: null,
            previousKey: null,
            previousVersion: null,
          });
        }
      } catch (err) {
        console.error('[dm_get_public_key] Error:', err.message);
      }
    });

    // ── dm_send ────────────────────────────────────────────────────
    // Client sends an encrypted DM blob
    socket.on('dm_send', (data) => {
      try {
        if (!data || typeof data.toKey !== 'string' || typeof data.ciphertext !== 'string' || typeof data.nonce !== 'string') {
          socket.emit('error', { message: 'Invalid DM data' });
          return;
        }
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) {
          socket.emit('error', { message: 'Permanent account required for DMs' });
          return;
        }
        if (!checkEventRate(socket, 'dm_send', 30, 60000)) {
          socket.emit('error', { message: 'Sending DMs too fast. Slow down.' });
          return;
        }

        var toKey = data.toKey.trim();
        if (toKey === key) {
          socket.emit('error', { message: 'Cannot DM yourself' });
          return;
        }

        // Verify recipient exists and is a permanent account
        var recipientAcc = accounts.loadAccount(toKey);
        if (!recipientAcc || recipientAcc.temp) {
          socket.emit('error', { message: 'Recipient not found' });
          return;
        }

        // Check friendship — DMs only allowed between friends
        var senderAcc = accounts.loadAccount(key);
        if (!senderAcc) { socket.emit('error', { message: 'Account error' }); return; }
        var isFriend = (senderAcc.friends || []).some(function(f) { return f.key === toKey; });
        if (!isFriend) {
          socket.emit('error', { message: 'You can only DM friends. Add them first!' });
          return;
        }

        // Check if sender is blocked by recipient
        if (recipientAcc.blocked && recipientAcc.blocked.includes(key)) {
          socket.emit('error', { message: 'Cannot send DM to this user' });
          return;
        }

        // Validate blob sizes (ciphertext max 16KB base64, nonce max 100 chars)
        if (data.ciphertext.length > 16384) {
          socket.emit('error', { message: 'Message too large' });
          return;
        }
        if (data.nonce.length > 100) {
          socket.emit('error', { message: 'Invalid nonce' });
          return;
        }
        // Validate optional salt for per-message key derivation (base64, max 100 chars)
        if (data.salt && (typeof data.salt !== 'string' || data.salt.length > 100)) {
          socket.emit('error', { message: 'Invalid salt' });
          return;
        }

        var timestamp = Date.now();
        var messageObj = {
          id: crypto.randomBytes(8).toString('hex'),
          fromKey: key,
          ciphertext: data.ciphertext,
          nonce: data.nonce,
          timestamp: timestamp,
        };
        if (data.salt) messageObj.salt = data.salt;

        var result = accounts.storeDM(key, toKey, messageObj);
        if (result && result.error) {
          socket.emit('error', { message: result.error });
          return;
        }

        // Confirm to sender
        socket.emit('dm_sent', {
          id: messageObj.id,
          toKey: toKey,
          timestamp: messageObj.timestamp,
        });

        // Real-time delivery: if recipient is online, push to their socket
        for (var [sid, skey] of socketAccountMap) {
          if (skey === toKey) {
            var recipientSocket = io.sockets.sockets.get(sid);
            if (recipientSocket) {
              var senderAcc = accounts.loadAccount(key);
              var dmPayload = {
                id: messageObj.id,
                fromKey: key,
                fromUsername: senderAcc ? senderAcc.username : 'Unknown',
                fromColor: senderAcc ? senderAcc.color : '#999',
                ciphertext: messageObj.ciphertext,
                nonce: messageObj.nonce,
                timestamp: messageObj.timestamp,
              };
              if (messageObj.salt) dmPayload.salt = messageObj.salt;
              recipientSocket.emit('dm_received', dmPayload);
            }
            break;
          }
        }
      } catch (err) {
        console.error('[dm_send] Error:', err.message);
      }
    });

    // ── dm_delete_message ──────────────────────────────────────────
    // Client requests deletion of a specific message from a conversation
    socket.on('dm_delete_message', (data) => {
      try {
        if (!data || typeof data.otherKey !== 'string' || typeof data.messageId !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) return;
        if (!checkEventRate(socket, 'dm_delete_message', 60, 60000)) return;
        accounts.deleteDMMessage(key, data.otherKey, data.messageId);
      } catch (err) {
        console.error('[dm_delete_message] Error:', err.message);
      }
    });

    // ── dm_history ─────────────────────────────────────────────────
    // Client requests DM history with a specific user
    socket.on('dm_history', (data) => {
      try {
        if (!data || typeof data.otherKey !== 'string') return;
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) {
          socket.emit('dm_history_result', { otherKey: data.otherKey, messages: [] });
          return;
        }
        if (!checkEventRate(socket, 'dm_history', 20, 60000)) return;

        // Verify friendship and block status before revealing history
        var otherKey = data.otherKey.trim();
        var senderAcc = accounts.loadAccount(key);
        if (!senderAcc) {
          socket.emit('dm_history_result', { otherKey: data.otherKey, messages: [] });
          return;
        }
        var isFriend = (senderAcc.friends || []).some(function(f) { return f.key === otherKey; });
        var isBlocked = (senderAcc.blocked || []).includes(otherKey);
        var otherAcc = accounts.loadAccount(otherKey);
        var blockedBySender = otherAcc && otherAcc.blocked && otherAcc.blocked.includes(key);
        if (!isFriend || isBlocked || blockedBySender) {
          socket.emit('dm_history_result', { otherKey: data.otherKey, messages: [] });
          return;
        }

        var limit = (typeof data.limit === 'number' && data.limit > 0 && data.limit <= 100) ? data.limit : 50;
        var messages = accounts.getDMHistory(key, otherKey, limit);
        socket.emit('dm_history_result', {
          otherKey: data.otherKey,
          messages: messages,
        });
      } catch (err) {
        console.error('[dm_history] Error:', err.message);
      }
    });

    // ── dm_conversations ───────────────────────────────────────────
    // Client requests list of all DM conversations
    socket.on('dm_conversations', () => {
      try {
        var key = socketAccountMap.get(socket.id);
        if (!key || accounts.isTempAccount(key)) {
          socket.emit('dm_conversations_list', { conversations: [] });
          return;
        }
        if (!checkEventRate(socket, 'dm_conversations', 20, 60000)) return;

        var conversations = accounts.getDMConversations(key);

        // Enrich with online status and public profile info
        var onlineKeys = new Set();
        for (var [, skey] of socketAccountMap) {
          if (!accounts.isTempAccount(skey)) onlineKeys.add(skey);
        }
        for (var i = 0; i < conversations.length; i++) {
          var profile = accounts.getPublicProfile(conversations[i].key);
          conversations[i].username = profile ? profile.username : 'Unknown';
          conversations[i].color = profile ? profile.color : '#999';
          conversations[i].online = onlineKeys.has(conversations[i].key);
        }

        socket.emit('dm_conversations_list', { conversations: conversations });
      } catch (err) {
        console.error('[dm_conversations] Error:', err.message);
      }
    });
  }
};
