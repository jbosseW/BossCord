// handlers/chat.js
// Socket handlers: send_message, join_channel, leave_channel, typing, pin_message, unpin_message, get_pinned_messages, message_react

// Whitelisted reaction emojis
const ALLOWED_REACTIONS = [
  'thumbsup', 'thumbsdown', 'heart', 'fire', 'laugh',
  'cry', 'angry', 'clap', '100', 'skull',
  'eyes', 'thinking', 'rocket', 'check', 'x'
];

const ALLOWED_REACTIONS_SET = new Set(ALLOWED_REACTIONS);

module.exports = {
  init(io, socket, deps) {
    var { user, state, checkEventRate, sanitizeText, validateUrl, isModerator, socketAccountMap, accounts, challengesHandler } = deps;

    // ------------------------------------------------------------------
    // send_message (with optional replyTo support)
    // ------------------------------------------------------------------
    socket.on('send_message', (data) => {
      try {
        // Rate limit: max 30 messages per minute per socket
        if (!checkEventRate(socket, 'send_message', 30, 60000)) {
          socket.emit('error', { message: 'Sending too fast. Slow down.' });
          return;
        }
        if (!data || typeof data.roomCode !== 'string' || typeof data.channelId !== 'string') {
          socket.emit('error', { message: 'Invalid message data' });
          return;
        }

        if (typeof data.content !== 'string' || data.content.trim().length === 0) {
          socket.emit('error', { message: 'Message cannot be empty' });
          return;
        }

        // If the message is a validated image URL (e.g. Tenor GIF), preserve it
        // as-is. sanitizeText HTML-encodes '&' which corrupts query-string
        // parameters and breaks image loading.
        var validatedImageUrl = validateUrl(data.content.trim());
        // Allow larger content for E2E encrypted messages (encryption overhead ~1.5x)
        // Only apply extended limit if the room is actually encrypted
        var isEncryptedPayload = data.content.trim().indexOf('{"e2e":true') === 0;
        var targetRoom = state.rooms.get(data.roomCode);
        var maxLen = (isEncryptedPayload && targetRoom && targetRoom.encrypted) ? 4000 : 2000;
        const content = validatedImageUrl
          ? validatedImageUrl
          : sanitizeText(data.content).slice(0, maxLen);

        const currentUser = state.users.get(socket.id);
        if (!currentUser || !currentUser.roomIds.has(data.roomCode)) {
          socket.emit('error', { message: 'You are not in this room' });
          return;
        }

        const message = state.addMessage(data.roomCode, data.channelId, socket.id, content);

        if (!message) {
          socket.emit('error', { message: 'Failed to send message' });
          return;
        }

        // Tag mod messages
        if (isModerator(socket.id)) message.isMod = true;

        // Handle reply/quote: look up the referenced message
        if (data.replyTo && typeof data.replyTo === 'string') {
          const found = state.findMessage(data.roomCode, data.channelId, data.replyTo);
          if (found) {
            message.replyTo = {
              id: found.id,
              authorName: found.authorName || 'Unknown',
              content: (found.content || '').slice(0, 200),
            };
          } else {
            // Referenced message not found (deleted or in another channel)
            message.replyTo = {
              id: data.replyTo,
              authorName: 'Unknown',
              content: '[deleted]',
            };
          }
        }

        io.to(data.channelId).emit('new_message', {
          roomCode: data.roomCode,
          channelId: data.channelId,
          message: message,
        });

        // Track challenge progress and achievements for messages
        if (challengesHandler) {
          var accKey = socketAccountMap.get(socket.id);
          if (accKey) {
            challengesHandler.trackChallengeProgress(accounts, accKey, 'messages_sent', 1);
            // Achievement: First Steps (send first message)
            challengesHandler.checkAchievement(accounts, accKey, 'first_steps');
            // Achievement: Social Butterfly (100 messages) - check stats
            var msgAcc = accounts.loadAccount(accKey);
            if (msgAcc && msgAcc.stats && (msgAcc.stats.messagesPosted || 0) >= 100) {
              challengesHandler.checkAchievement(accounts, accKey, 'social_butterfly');
            }
          }
        }
      } catch (err) {
        console.error('[send_message] Error:', err.message);
        socket.emit('error', { message: 'Internal error sending message' });
      }
    });

    // ------------------------------------------------------------------
    // message_react
    // ------------------------------------------------------------------
    socket.on('message_react', (data) => {
      try {
        if (!data || typeof data.roomCode !== 'string' || typeof data.channelId !== 'string' ||
            typeof data.messageId !== 'string' || typeof data.emoji !== 'string') {
          socket.emit('error', { message: 'Invalid reaction data' });
          return;
        }

        // Rate limit: max 10 reactions per minute per user
        if (!checkEventRate(socket, 'message_react', 10, 60000)) {
          socket.emit('error', { message: 'Reacting too fast. Slow down.' });
          return;
        }

        // Validate emoji is whitelisted
        if (!ALLOWED_REACTIONS_SET.has(data.emoji)) {
          socket.emit('error', { message: 'Invalid reaction emoji' });
          return;
        }

        // Verify user is in this room
        const currentUser = state.users.get(socket.id);
        if (!currentUser || !currentUser.roomIds.has(data.roomCode)) {
          socket.emit('error', { message: 'You are not in this room' });
          return;
        }

        // Find the message
        const message = state.findMessage(data.roomCode, data.channelId, data.messageId);
        if (!message) {
          socket.emit('error', { message: 'Message not found' });
          return;
        }

        // Ensure reactions object exists (for older messages created before this feature)
        if (!message.reactions) {
          message.reactions = {};
        }

        const emoji = data.emoji;
        const userId = socket.id;

        // Toggle: if user already reacted with this emoji, remove; otherwise add
        if (!message.reactions[emoji]) {
          message.reactions[emoji] = [];
        }

        const idx = message.reactions[emoji].indexOf(userId);
        if (idx >= 0) {
          // Remove reaction
          message.reactions[emoji].splice(idx, 1);
          // Clean up empty arrays
          if (message.reactions[emoji].length === 0) {
            delete message.reactions[emoji];
          }
        } else {
          // Add reaction
          message.reactions[emoji].push(userId);
        }

        // Broadcast the full reactions object to the channel
        io.to(data.channelId).emit('message_reacted', {
          roomCode: data.roomCode,
          channelId: data.channelId,
          messageId: data.messageId,
          reactions: message.reactions,
        });

        // Track challenge progress for reactions (only on add, not remove)
        if (idx < 0 && challengesHandler) {
          var reactAccKey = socketAccountMap.get(socket.id);
          if (reactAccKey) {
            challengesHandler.trackChallengeProgress(accounts, reactAccKey, 'reactions_given', 1);
          }
        }
      } catch (err) {
        console.error('[message_react] Error:', err.message);
        socket.emit('error', { message: 'Internal error processing reaction' });
      }
    });

    // ------------------------------------------------------------------
    // join_channel
    // ------------------------------------------------------------------
    socket.on('join_channel', (data) => {
      try {
        if (!data || typeof data.roomCode !== 'string' || typeof data.channelId !== 'string') return;
        if (!checkEventRate(socket, 'join_channel', 30, 60000)) return;

        // Verify caller is a member of this room before exposing channel data
        const currentUser = state.users.get(socket.id);
        if (!currentUser || !currentUser.roomIds.has(data.roomCode)) {
          socket.emit('error', { message: 'You are not in this room' });
          return;
        }

        const room = state.rooms.get(data.roomCode);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const channel = room.channels.get(data.channelId);
        if (!channel) {
          socket.emit('error', { message: 'Channel not found' });
          return;
        }

        socket.join(data.channelId);

        socket.emit('channel_joined', {
          roomCode: data.roomCode,
          channel: {
            id: channel.id,
            name: channel.name,
            type: channel.type,
            messages: channel.messages,
            pinnedMessages: channel.pinnedMessages || [],
          },
        });
      } catch (err) {
        console.error('[join_channel] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // leave_channel
    // ------------------------------------------------------------------
    socket.on('leave_channel', (data) => {
      try {
        if (!data || typeof data.channelId !== 'string') return;
        if (!checkEventRate(socket, 'leave_channel', 30, 60000)) return;
        socket.leave(data.channelId);
      } catch (err) {
        console.error('[leave_channel] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // typing indicator
    // ------------------------------------------------------------------
    socket.on('typing', (data) => {
      try {
        if (!data || typeof data.channelId !== 'string') return;
        if (!checkEventRate(socket, 'typing', 10, 5000)) return;

        // Verify sender is in the channel room before broadcasting
        if (!socket.rooms.has(data.channelId)) {
          return;
        }

        socket.to(data.channelId).emit('user_typing', {
          roomCode: data.roomCode || null,
          channelId: data.channelId,
          userId: user.id,
          userName: user.name,
        });
      } catch (err) {
        // Typing is non-critical; swallow errors silently
      }
    });

    // ------------------------------------------------------------------
    // pin_message
    // ------------------------------------------------------------------
    socket.on('pin_message', (data) => {
      try {
        if (!data || typeof data.roomCode !== 'string' || typeof data.channelId !== 'string' || typeof data.messageId !== 'string') {
          socket.emit('error', { message: 'Invalid pin data' });
          return;
        }
        if (!checkEventRate(socket, 'mod_action', 60, 60000)) {
          socket.emit('error', { message: 'Too many actions. Slow down.' });
          return;
        }

        const currentUser = state.users.get(socket.id);
        if (!currentUser || !currentUser.roomIds.has(data.roomCode)) {
          socket.emit('error', { message: 'You are not in this room' });
          return;
        }

        const room = state.rooms.get(data.roomCode);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Permission: room owner or global moderator
        if (room.ownerId !== socket.id && !isModerator(socket.id)) {
          socket.emit('error', { message: 'Not authorized to pin messages' });
          return;
        }

        const pinned = state.pinMessage(data.roomCode, data.channelId, data.messageId);
        if (!pinned) {
          socket.emit('error', { message: 'Failed to pin message' });
          return;
        }

        io.to(data.channelId).emit('message_pinned', {
          roomCode: data.roomCode,
          channelId: data.channelId,
          message: pinned,
        });
      } catch (err) {
        console.error('[pin_message] Error:', err.message);
        socket.emit('error', { message: 'Internal error pinning message' });
      }
    });

    // ------------------------------------------------------------------
    // unpin_message
    // ------------------------------------------------------------------
    socket.on('unpin_message', (data) => {
      try {
        if (!data || typeof data.roomCode !== 'string' || typeof data.channelId !== 'string' || typeof data.messageId !== 'string') {
          socket.emit('error', { message: 'Invalid unpin data' });
          return;
        }
        if (!checkEventRate(socket, 'mod_action', 60, 60000)) {
          socket.emit('error', { message: 'Too many actions. Slow down.' });
          return;
        }

        const currentUser = state.users.get(socket.id);
        if (!currentUser || !currentUser.roomIds.has(data.roomCode)) {
          socket.emit('error', { message: 'You are not in this room' });
          return;
        }

        const room = state.rooms.get(data.roomCode);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Permission: room owner or global moderator
        if (room.ownerId !== socket.id && !isModerator(socket.id)) {
          socket.emit('error', { message: 'Not authorized to unpin messages' });
          return;
        }

        const removed = state.unpinMessage(data.roomCode, data.channelId, data.messageId);
        if (!removed) {
          socket.emit('error', { message: 'Message not pinned or not found' });
          return;
        }

        io.to(data.channelId).emit('message_unpinned', {
          roomCode: data.roomCode,
          channelId: data.channelId,
          messageId: data.messageId,
        });
      } catch (err) {
        console.error('[unpin_message] Error:', err.message);
        socket.emit('error', { message: 'Internal error unpinning message' });
      }
    });

    // ------------------------------------------------------------------
    // get_pinned_messages
    // ------------------------------------------------------------------
    socket.on('get_pinned_messages', (data) => {
      try {
        if (!data || typeof data.roomCode !== 'string' || typeof data.channelId !== 'string') {
          socket.emit('error', { message: 'Invalid request data' });
          return;
        }
        if (!checkEventRate(socket, 'get_pinned_messages', 30, 60000)) return;

        const currentUser = state.users.get(socket.id);
        if (!currentUser || !currentUser.roomIds.has(data.roomCode)) {
          socket.emit('error', { message: 'You are not in this room' });
          return;
        }

        const messages = state.getPinnedMessages(data.roomCode, data.channelId);

        socket.emit('pinned_messages', {
          roomCode: data.roomCode,
          channelId: data.channelId,
          messages: messages,
        });
      } catch (err) {
        console.error('[get_pinned_messages] Error:', err.message);
        socket.emit('error', { message: 'Internal error fetching pinned messages' });
      }
    });
  }
};
