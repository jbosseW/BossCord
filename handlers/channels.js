// handlers/channels.js
// Socket handlers: create_channel

module.exports = {
  init(io, socket, deps) {
    var { user, state, checkEventRate } = deps;

    // ------------------------------------------------------------------
    // create_channel
    // ------------------------------------------------------------------
    socket.on('create_channel', (data) => {
      try {
        if (!checkEventRate(socket, 'create_channel', 5, 3600000)) {
          socket.emit('error', { message: 'Too fast. Slow down.' });
          return;
        }
        if (!data || typeof data.roomCode !== 'string' || typeof data.name !== 'string') {
          socket.emit('error', { message: 'Invalid channel data' });
          return;
        }

        const room = state.rooms.get(data.roomCode);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Only the room owner can create channels
        if (room.ownerId !== socket.id) {
          socket.emit('error', { message: 'Only the room owner can create channels' });
          return;
        }

        // Video channels are available in all rooms

        // Sanitize channel name: strip dangerous characters, trim, and limit length
        var channelName = typeof data.name === 'string' ? data.name.replace(/[<>&"']/g, '').trim().slice(0, 32) : 'general';
        if (!channelName) channelName = 'general';

        const type = (data.type === 'voice') ? 'voice' : (data.type === 'video') ? 'video' : 'text';
        const channel = state.createChannel(data.roomCode, channelName, type);

        if (!channel) {
          socket.emit('error', { message: 'Failed to create channel' });
          return;
        }

        io.to(data.roomCode).emit('channel_created', {
          roomCode: data.roomCode,
          channel: {
            id: channel.id,
            name: channel.name,
            type: channel.type,
          },
        });

        console.log(`[channel] ${user.name} created #${channel.name} (${channel.type}) in ${data.roomCode}`);
      } catch (err) {
        console.error('[create_channel] Error:', err.message);
        socket.emit('error', { message: 'Internal error creating channel' });
      }
    });
  }
};
