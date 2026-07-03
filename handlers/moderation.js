// handlers/moderation.js
// Socket handlers: mod_delete_message, mod_kick_user

module.exports = {
  init(io, socket, deps) {
    var { user, state, isModerator, checkEventRate } = deps;

    // ------------------------------------------------------------------
    // Moderator: delete a chat message
    // ------------------------------------------------------------------
    socket.on('mod_delete_message', (data) => {
      try {
        if (!data || typeof data.roomCode !== 'string' || typeof data.channelId !== 'string' || typeof data.messageId !== 'string') return;
        if (!isModerator(socket.id)) { socket.emit('error', { message: 'Not authorized' }); return; }
        if (!checkEventRate(socket, 'mod_action', 60, 60000)) return;
        const removed = state.deleteMessage(data.roomCode, data.channelId, data.messageId);
        if (removed) {
          io.to(data.channelId).emit('message_deleted', { roomCode: data.roomCode, channelId: data.channelId, messageId: data.messageId });
          console.log('[mod] ' + (user.name || socket.id) + ' deleted message ' + data.messageId + ' in ' + data.roomCode + '/' + data.channelId);
        }
      } catch (err) {
        console.error('[mod_delete_message] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Moderator: kick a user from a room
    // ------------------------------------------------------------------
    socket.on('mod_kick_user', (data) => {
      try {
        if (!data || typeof data.targetSocketId !== 'string' || typeof data.roomCode !== 'string') return;
        if (!isModerator(socket.id)) { socket.emit('error', { message: 'Not authorized' }); return; }
        if (!checkEventRate(socket, 'mod_action', 60, 60000)) return;
        const targetSocket = io.sockets.sockets.get(data.targetSocketId);
        if (!targetSocket) { socket.emit('error', { message: 'User not found' }); return; }
        // Remove from room state
        var didLeave = state.leaveRoom(data.targetSocketId, data.roomCode);
        // Force-leave room and all its channel Socket.IO rooms
        targetSocket.leave(data.roomCode);
        var room = state.rooms.get(data.roomCode);
        if (room && room.channels) {
          for (var [chId] of room.channels) {
            targetSocket.leave(chId);
          }
        }
        targetSocket.emit('kicked_from_room', { roomCode: data.roomCode, reason: data.reason || 'Removed by moderator' });
        io.to(data.roomCode).emit('user_left', { roomCode: data.roomCode, userId: data.targetSocketId });
        socket.emit('mod_action', { action: 'user_kicked', targetId: data.targetSocketId, roomCode: data.roomCode });
        console.log('[mod] ' + (user.name || socket.id) + ' kicked ' + data.targetSocketId + ' from ' + data.roomCode);
      } catch (err) {
        console.error('[mod_kick_user] Error:', err.message);
      }
    });
  }
};
