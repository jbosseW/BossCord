// handlers/rooms.js
// Socket handlers: browse_public_rooms, create_room, join_room, leave_room, room_update_settings, delete_room

const VALID_CATEGORIES = ['General', 'Gaming', 'Social', 'Trading', 'Music', 'Other'];

module.exports = {
  init(io, socket, deps) {
    var { user, state, checkEventRate, sanitizeText, isModerator, enrichRoom, findChannelByName } = deps;

    // ------------------------------------------------------------------
    // browse_public_rooms — list all public rooms
    // ------------------------------------------------------------------
    socket.on('browse_public_rooms', () => {
      try {
        if (!checkEventRate(socket, 'browse_public_rooms', 30, 60000)) return;
        const publicRooms = state.getPublicRooms();
        socket.emit('public_rooms', { rooms: publicRooms });
      } catch (err) {
        console.error('[browse_public_rooms] Error:', err.message);
        socket.emit('error', { message: 'Failed to fetch public rooms' });
      }
    });

    // ------------------------------------------------------------------
    // create_room — now supports isPublic and description
    // ------------------------------------------------------------------
    socket.on('create_room', (data) => {
      try {
        // Rate limit: max 3 room creations per hour per IP
        if (!checkEventRate(socket, 'create_room', 3, 3600000)) {
          socket.emit('error', { message: 'Too many rooms created. Try again later.' });
          return;
        }
        const roomName = (data && typeof data.name === 'string') ? sanitizeText(data.name) : 'Unnamed Room';
        const isPublic = !!(data && data.isPublic);
        const encrypted = !isPublic && !!(data && data.encrypted);
        const description = (data && typeof data.description === 'string') ? sanitizeText(data.description).slice(0, 200) : '';
        const category = (data && typeof data.category === 'string' && VALID_CATEGORIES.indexOf(data.category) !== -1) ? data.category : 'General';

        const room = state.createRoom(socket.id, roomName, {
          isPublic: isPublic,
          encrypted: encrypted,
          description: description,
          category: category,
        });

        if (!room) {
          socket.emit('error', { message: 'Failed to create room' });
          return;
        }

        // Join the Socket.IO room for broadcasts
        socket.join(room.code);

        // Join the default general text channel
        const generalChannel = findChannelByName(room, 'general');
        if (generalChannel) {
          socket.join(generalChannel.id);
        }

        const serialized = enrichRoom(state.getRoomByCode(room.code));
        socket.emit('room_created', serialized);

        // Broadcast to the room that a user joined
        io.to(room.code).emit('user_joined', {
          roomCode: room.code,
          user: { id: user.id, name: user.name, color: user.color, tag: user.tag, avatar: user.avatar || null, isMod: isModerator(socket.id) },
        });

        // If public, broadcast updated public rooms list to everyone
        if (isPublic) {
          io.emit('public_rooms_updated', { rooms: state.getPublicRooms() });
        }

        console.log(`[room] ${user.name} created "${room.name}" (${room.code}) [${isPublic ? 'PUBLIC' : 'PRIVATE'}]`);
      } catch (err) {
        console.error('[create_room] Error:', err.message);
        socket.emit('error', { message: 'Internal error creating room' });
      }
    });

    // ------------------------------------------------------------------
    // join_room — works for both public and private rooms by code
    // ------------------------------------------------------------------
    socket.on('join_room', (data) => {
      try {
        if (!checkEventRate(socket, 'join_room', 10, 60000)) {
          socket.emit('error', { message: 'Joining rooms too fast' });
          return;
        }
        if (!data || typeof data.code !== 'string') {
          socket.emit('error', { message: 'Invalid room code' });
          return;
        }

        const code = data.code.trim().toUpperCase();
        const room = state.joinRoom(socket.id, code);

        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Join Socket.IO room
        socket.join(room.code);

        // Auto-join the general text channel
        const generalChannel = findChannelByName(room, 'general');
        if (generalChannel) {
          socket.join(generalChannel.id);
        }

        const serialized = enrichRoom(state.getRoomByCode(room.code));
        socket.emit('room_joined', serialized);

        // Broadcast to others in the room
        socket.to(room.code).emit('user_joined', {
          roomCode: room.code,
          user: { id: user.id, name: user.name, color: user.color, tag: user.tag, avatar: user.avatar || null, isMod: isModerator(socket.id) },
        });

        // Update public rooms list if this is a public room (member count changed)
        if (room.isPublic) {
          io.emit('public_rooms_updated', { rooms: state.getPublicRooms() });
        }

        console.log(`[room] ${user.name} joined "${room.name}" (${room.code})`);
      } catch (err) {
        console.error('[join_room] Error:', err.message);
        socket.emit('error', { message: 'Internal error joining room' });
      }
    });

    // ------------------------------------------------------------------
    // leave_room
    // ------------------------------------------------------------------
    socket.on('leave_room', (data) => {
      try {
        if (!data || typeof data.code !== 'string') return;

        const code = data.code.trim().toUpperCase();
        const room = state.rooms.get(code);
        const wasPublic = room ? room.isPublic : false;

        // Broadcast before leaving so others see the event
        if (room) {
          socket.to(code).emit('user_left', {
            roomCode: code,
            user: { id: user.id, name: user.name, color: user.color, tag: user.tag, avatar: user.avatar || null, isMod: isModerator(socket.id) },
          });

          // Leave all channel Socket.IO rooms for this room
          for (const [, channel] of room.channels) {
            socket.leave(channel.id);
          }
        }

        state.leaveRoom(socket.id, code);
        socket.leave(code);

        socket.emit('room_left', { code: code });

        // Update public rooms list if applicable
        if (wasPublic) {
          io.emit('public_rooms_updated', { rooms: state.getPublicRooms() });
        }

        console.log(`[room] ${user.name} left room ${code}`);
      } catch (err) {
        console.error('[leave_room] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // room_update_settings — owner can update room name, description, etc.
    // ------------------------------------------------------------------
    socket.on('room_update_settings', (data) => {
      try {
        if (!checkEventRate(socket, 'room_update_settings', 10, 60000)) {
          socket.emit('error', { message: 'Updating settings too fast' });
          return;
        }
        if (!data || typeof data.roomCode !== 'string') {
          socket.emit('error', { message: 'Invalid room code' });
          return;
        }

        const code = data.roomCode.trim().toUpperCase();
        const room = state.rooms.get(code);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Only the room owner can update settings (persistent/system rooms have null owner)
        if (room.ownerId !== socket.id) {
          socket.emit('error', { message: 'Only the room owner can update settings' });
          return;
        }

        // Validate name — required, non-empty after sanitization
        if (typeof data.name !== 'string' || sanitizeText(data.name).length === 0) {
          socket.emit('error', { message: 'Room name is required' });
          return;
        }

        const newName = sanitizeText(data.name).slice(0, 64);
        const newDescription = (typeof data.description === 'string') ? sanitizeText(data.description).slice(0, 200) : room.description;
        const newIsPublic = (typeof data.isPublic === 'boolean') ? data.isPublic : room.isPublic;
        const newCategory = (typeof data.category === 'string' && VALID_CATEGORIES.indexOf(data.category) !== -1) ? data.category : room.category;

        const wasPublic = room.isPublic;

        // Apply updates
        room.name = newName;
        room.description = newDescription;
        room.isPublic = newIsPublic;
        room.category = newCategory;

        // If room toggled from public to private, disable encryption flag automatically
        // (encrypted rooms are always private, but we don't force-encrypt on going private)

        // Serialize the updated room and broadcast to all members
        const serialized = enrichRoom(state.getRoomByCode(code));
        io.to(code).emit('room_settings_updated', serialized);

        // Update public rooms list if visibility changed or room is public (name/desc may have changed)
        if (wasPublic || newIsPublic) {
          io.emit('public_rooms_updated', { rooms: state.getPublicRooms() });
        }

        console.log(`[room] ${user.name} updated settings for "${newName}" (${code}) [${newIsPublic ? 'PUBLIC' : 'PRIVATE'}]`);
      } catch (err) {
        console.error('[room_update_settings] Error:', err.message);
        socket.emit('error', { message: 'Internal error updating room settings' });
      }
    });

    // ------------------------------------------------------------------
    // delete_room — owner permanently deletes the room
    // ------------------------------------------------------------------
    socket.on('delete_room', (data) => {
      try {
        if (!checkEventRate(socket, 'delete_room', 3, 60000)) {
          socket.emit('error', { message: 'Too fast. Slow down.' });
          return;
        }
        if (!data || typeof data.roomCode !== 'string') {
          socket.emit('error', { message: 'Invalid room code' });
          return;
        }

        const code = data.roomCode.trim().toUpperCase();
        const room = state.rooms.get(code);
        if (!room) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // Only the room owner can delete
        if (room.ownerId !== socket.id) {
          socket.emit('error', { message: 'Only the room owner can delete this room' });
          return;
        }

        // Cannot delete persistent/system rooms
        if (room.isPersistent) {
          socket.emit('error', { message: 'System rooms cannot be deleted' });
          return;
        }

        const wasPublic = room.isPublic;
        const roomName = room.name;

        // Kick all members (except the deleting owner) via kicked_from_room
        for (const memberId of room.members) {
          if (memberId === socket.id) continue;
          const memberSocket = io.sockets.sockets.get(memberId);
          if (memberSocket) {
            memberSocket.emit('kicked_from_room', {
              roomCode: code,
              reason: 'This room has been deleted by the owner.'
            });
            // Leave Socket.IO rooms for channels
            for (const [, channel] of room.channels) {
              memberSocket.leave(channel.id);
            }
            memberSocket.leave(code);
          }
        }

        // Leave own Socket.IO rooms for channels
        for (const [, channel] of room.channels) {
          socket.leave(channel.id);
        }
        socket.leave(code);

        // Delete the room from state (also cleans up user.roomIds)
        state.deleteRoom(code);

        // Notify the owner that the room was deleted (treated as room_left)
        socket.emit('room_left', { code: code });

        // Update public rooms list if it was public
        if (wasPublic) {
          io.emit('public_rooms_updated', { rooms: state.getPublicRooms() });
        }

        console.log(`[room] ${user.name} deleted room "${roomName}" (${code})`);
      } catch (err) {
        console.error('[delete_room] Error:', err.message);
        socket.emit('error', { message: 'Internal error deleting room' });
      }
    });
  }
};
