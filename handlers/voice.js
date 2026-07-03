// handlers/voice.js
// Socket handlers: voice_join, voice_signal, voice_leave, media_start, media_stop

module.exports = {
  init(io, socket, deps) {
    var { user, state, isModerator, checkEventRate } = deps;

    // ------------------------------------------------------------------
    // Voice: join
    // ------------------------------------------------------------------
    socket.on('voice_join', (data) => {
      try {
        if (!checkEventRate(socket, 'voice_join', 10, 60000)) return;
        if (!data || typeof data.roomCode !== 'string' || typeof data.channelId !== 'string') return;

        const room = state.rooms.get(data.roomCode);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Verify socket is a member of this room
        const userData = state.users.get(socket.id);
        if (!userData || !userData.roomIds || !userData.roomIds.has(data.roomCode)) {
          socket.emit('error', { message: 'You must join the room first' });
          return;
        }

        const channel = room.channels.get(data.channelId);
        if (!channel || (channel.type !== 'voice' && channel.type !== 'video')) {
          socket.emit('error', { message: 'Voice channel not found' });
          return;
        }

        const voiceRoomName = 'voice:' + data.channelId;
        const currentSockets = io.sockets.adapter.rooms.get(voiceRoomName);
        const currentVoiceUsers = [];

        if (currentSockets) {
          for (const sid of currentSockets) {
            const u = state.users.get(sid);
            if (u) {
              currentVoiceUsers.push({
                id: u.id,
                name: u.name,
                color: u.color,
                tag: u.tag,
              });
            }
          }
        }

        socket.join(voiceRoomName);

        // Include the joining user in their own voice_users list
        currentVoiceUsers.push({
          id: user.id,
          name: user.name,
          color: user.color,
          tag: user.tag,
        });

        socket.emit('voice_users', {
          roomCode: data.roomCode,
          channelId: data.channelId,
          users: currentVoiceUsers,
        });

        socket.to(voiceRoomName).emit('voice_user_joined', {
          roomCode: data.roomCode,
          channelId: data.channelId,
          user: { id: user.id, name: user.name, color: user.color, tag: user.tag, isMod: isModerator(socket.id) },
        });

        console.log(`[voice] ${user.name} joined voice in ${data.roomCode}/${channel.name}`);
      } catch (err) {
        console.error('[voice_join] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Voice: WebRTC signaling relay
    // ------------------------------------------------------------------
    socket.on('voice_signal', (data) => {
      try {
        if (!checkEventRate(socket, 'voice_signal', 200, 60000)) return;
        if (!data || typeof data.to !== 'string' || !data.signal) return;

        // Validate signal payload structure (must be a WebRTC signaling object)
        var sig = data.signal;
        if (typeof sig !== 'object' || sig === null) return;
        // Only allow recognized WebRTC signal types
        if (sig.type && typeof sig.type !== 'string') return;
        if (sig.type && ['offer', 'answer', 'pranswer', 'rollback'].indexOf(sig.type) === -1 && !sig.candidate) return;
        // Reject oversized signals (SDP is typically < 10KB)
        var sigStr = JSON.stringify(sig);
        if (sigStr.length > 32768) return;

        // Verify target socket exists and shares a voice room with sender
        var targetSocket = io.sockets.sockets.get(data.to);
        if (!targetSocket) return;
        var senderRooms = socket.rooms;
        var sharedVoice = false;
        for (var roomName of senderRooms) {
          if (roomName.startsWith('voice:') && targetSocket.rooms.has(roomName)) {
            sharedVoice = true;
            break;
          }
        }
        if (!sharedVoice) return;

        targetSocket.emit('voice_signal', {
          from: socket.id,
          signal: data.signal,
        });
      } catch (err) {
        // Signaling is high-frequency; swallow errors
      }
    });

    // ------------------------------------------------------------------
    // Voice: leave
    // ------------------------------------------------------------------
    socket.on('voice_leave', (data) => {
      try {
        if (!checkEventRate(socket, 'voice_leave', 10, 60000)) return;
        if (!data || typeof data.channelId !== 'string') return;

        const voiceRoomName = 'voice:' + data.channelId;

        // Verify sender is actually in this voice room before processing
        if (!socket.rooms.has(voiceRoomName)) return;

        socket.leave(voiceRoomName);

        socket.to(voiceRoomName).emit('voice_user_left', {
          channelId: data.channelId,
          user: { id: user.id, name: user.name, color: user.color, tag: user.tag, isMod: isModerator(socket.id) },
        });

        console.log(`[voice] ${user.name} left voice channel ${data.channelId}`);
      } catch (err) {
        console.error('[voice_leave] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Video/Screen share: start (private rooms only)
    // ------------------------------------------------------------------
    socket.on('media_start', (data) => {
      try {
        if (!checkEventRate(socket, 'media_start', 10, 60000)) return;
        if (!data || !data.roomCode || !data.channelId || !data.type) return;
        const room = state.rooms.get(data.roomCode);
        if (!room) return;
        if (room.isPublic) {
          socket.emit('error', { message: 'Camera and screen share are only available in private servers' });
          return;
        }
        // Notify others in the voice channel
        const voiceRoom = 'voice:' + data.channelId;
        socket.to(voiceRoom).emit('media_started', {
          userId: socket.id,
          userName: user.name,
          type: data.type, // 'camera' or 'screen'
        });
      } catch (err) {
        console.error('[media_start] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Video/Screen share: stop
    // ------------------------------------------------------------------
    socket.on('media_stop', (data) => {
      try {
        if (!checkEventRate(socket, 'media_stop', 10, 60000)) return;
        if (!data || !data.channelId || !data.type) return;
        const voiceRoom = 'voice:' + data.channelId;
        socket.to(voiceRoom).emit('media_stopped', {
          userId: socket.id,
          type: data.type,
        });
      } catch (err) {
        console.error('[media_stop] Error:', err.message);
      }
    });
  }
};
