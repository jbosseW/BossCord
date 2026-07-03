// handlers/video-roulette.js
// Video roulette: random 1-on-1 video chat with strangers

module.exports = {
  init(io, socket, deps) {
    const { user, checkEventRate } = deps;

    // Shared queue (module-level via closure over io)
    if (!io._rouletteQueue) {
      io._rouletteQueue = []; // Array of { socketId, userName, color, tag }
      io._roulettePairs = new Map(); // socketId -> partnerSocketId
    }
    const queue = io._rouletteQueue;
    const pairs = io._roulettePairs;

    // Join queue
    socket.on('roulette_join', () => {
      try {
        if (!checkEventRate(socket, 'roulette_join', 10, 60000)) return;

        // Already paired? ignore
        if (pairs.has(socket.id)) return;
        // Already in queue? ignore
        if (queue.find(q => q.socketId === socket.id)) return;

        // Try to find a match
        let matchIdx = -1;
        for (let i = 0; i < queue.length; i++) {
          const candidate = queue[i];
          // Check candidate is still connected
          const candidateSocket = io.sockets.sockets.get(candidate.socketId);
          if (!candidateSocket || !candidateSocket.connected) {
            queue.splice(i, 1);
            i--;
            continue;
          }
          matchIdx = i;
          break;
        }

        if (matchIdx >= 0) {
          // Found a match
          const partner = queue.splice(matchIdx, 1)[0];
          const partnerSocket = io.sockets.sockets.get(partner.socketId);
          if (!partnerSocket || !partnerSocket.connected) {
            // Partner disconnected, add self to queue
            queue.push({ socketId: socket.id, userName: user.name, color: user.color, tag: user.tag });
            socket.emit('roulette_waiting', { position: queue.length });
            return;
          }

          // Pair them
          pairs.set(socket.id, partner.socketId);
          pairs.set(partner.socketId, socket.id);

          const roomName = 'roulette:' + socket.id + ':' + partner.socketId;
          socket.join(roomName);
          partnerSocket.join(roomName);

          // Tell both about the match -- initiator creates WebRTC offer
          socket.emit('roulette_matched', {
            partnerId: partner.socketId,
            partnerName: partner.userName,
            partnerColor: partner.color,
            partnerTag: partner.tag,
            isInitiator: true,
            roomName: roomName
          });
          partnerSocket.emit('roulette_matched', {
            partnerId: socket.id,
            partnerName: user.name,
            partnerColor: user.color,
            partnerTag: user.tag,
            isInitiator: false,
            roomName: roomName
          });

          console.log('[roulette] Matched: ' + user.name + ' <-> ' + partner.userName);
        } else {
          // No match found, add to queue
          queue.push({ socketId: socket.id, userName: user.name, color: user.color, tag: user.tag });
          socket.emit('roulette_waiting', { position: queue.length });
          console.log('[roulette] ' + user.name + ' waiting (queue: ' + queue.length + ')');
        }
      } catch (err) {
        console.error('[roulette_join] Error:', err.message);
      }
    });

    // WebRTC signaling between roulette partners
    socket.on('roulette_signal', (data) => {
      try {
        if (!checkEventRate(socket, 'roulette_signal', 200, 60000)) return;
        if (!data || !data.signal) return;

        const partnerId = pairs.get(socket.id);
        if (!partnerId) return;

        const partnerSocket = io.sockets.sockets.get(partnerId);
        if (!partnerSocket) return;

        // Validate signal
        const sig = data.signal;
        if (typeof sig !== 'object' || sig === null) return;
        // Only allow recognized WebRTC signal types
        if (sig.type && typeof sig.type !== 'string') return;
        if (sig.type && ['offer', 'answer', 'pranswer', 'rollback'].indexOf(sig.type) === -1 && !sig.candidate) return;
        const sigStr = JSON.stringify(sig);
        if (sigStr.length > 32768) return;

        partnerSocket.emit('roulette_signal', {
          from: socket.id,
          signal: sig
        });
      } catch (err) {
        // High-frequency, swallow
      }
    });

    // Skip to next person
    socket.on('roulette_next', () => {
      try {
        if (!checkEventRate(socket, 'roulette_next', 15, 60000)) return;
        cleanupPair(socket.id);
        // Notify self
        socket.emit('roulette_ended', { reason: 'skipped' });
        // Auto-rejoin queue
        if (!queue.find(q => q.socketId === socket.id)) {
          queue.push({ socketId: socket.id, userName: user.name, color: user.color, tag: user.tag });
          socket.emit('roulette_waiting', { position: queue.length });
        }
      } catch (err) {
        console.error('[roulette_next] Error:', err.message);
      }
    });

    // Leave roulette entirely
    socket.on('roulette_leave', () => {
      try {
        cleanupPair(socket.id);
        // Remove from queue
        const qi = queue.findIndex(q => q.socketId === socket.id);
        if (qi >= 0) queue.splice(qi, 1);
        socket.emit('roulette_ended', { reason: 'left' });
      } catch (err) {
        console.error('[roulette_leave] Error:', err.message);
      }
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      cleanupPair(socket.id);
      const qi = queue.findIndex(q => q.socketId === socket.id);
      if (qi >= 0) queue.splice(qi, 1);
    });

    function cleanupPair(socketId) {
      const partnerId = pairs.get(socketId);
      if (!partnerId) return;

      // Notify partner
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit('roulette_partner_left', {});
      }

      // Leave shared room
      const roomName1 = 'roulette:' + socketId + ':' + partnerId;
      const roomName2 = 'roulette:' + partnerId + ':' + socketId;
      const s = io.sockets.sockets.get(socketId);
      if (s) { s.leave(roomName1); s.leave(roomName2); }
      if (partnerSocket) { partnerSocket.leave(roomName1); partnerSocket.leave(roomName2); }

      pairs.delete(socketId);
      pairs.delete(partnerId);
    }
  }
};
