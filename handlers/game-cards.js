// handlers/game-cards.js
// Socket handlers: card_get_lobbies, card_create_lobby, card_join_lobby,
//                  card_leave_lobby, card_ready, card_action, card_chat

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, lobbyManager, saveChipsForSocket, saveAllLobbyChips, processPokerBots, checkEventRate, sanitizeText } = deps;

    // Helper: resolve a socket by ID, compatible with both Server and Namespace.
    // On the Server instance: io.sockets is the default Namespace, io.sockets.sockets is the Map.
    // On a Namespace (e.g. /games): io.sockets IS already the Map (no nested .sockets).
    function getSocket(pid) {
      if (io.sockets && typeof io.sockets.get === 'function') {
        // io is a Namespace — io.sockets is the Map<SocketId, Socket>
        return io.sockets.get(pid);
      }
      // io is the Server — io.sockets is the default Namespace
      return io.sockets && io.sockets.sockets && io.sockets.sockets.get(pid);
    }

    // ------------------------------------------------------------------
    // Helper: auto-leave current lobby (with full side-effect cleanup)
    // Returns true if the player was in a lobby and was removed.
    // ------------------------------------------------------------------
    function autoLeaveCurrent() {
      const lobbyId = lobbyManager.getPlayerLobbyId(socket.id);
      if (!lobbyId) return false;
      // Save chips before leaving
      const lobby = lobbyManager.lobbies.get(lobbyId);
      if (lobby) {
        const p = lobby.players.get(socket.id);
        if (p) {
          try { saveChipsForSocket(socket.id, p.chips); } catch (e) {
            console.error('[cards] saveChipsForSocket error on auto-leave:', e.message);
          }
        }
      }
      const result = lobbyManager.leaveLobby(socket.id);
      if (!result) return false;
      socket.leave('cardlobby:' + result.lobbyId);
      if (!result.destroyed) {
        if (lobbyManager.getHumanCount(result.lobbyId) === 0) {
          lobbyManager.removeBots(result.lobbyId);
        }
        const freshLobby = lobbyManager.lobbies.get(result.lobbyId);
        if (freshLobby && freshLobby.state === 'waiting') {
          try { saveAllLobbyChips(freshLobby); } catch (e) {
            console.error('[cards] saveAllLobbyChips error on auto-leave:', e.message);
          }
          lobbyManager.rebuyBrokePlayers(freshLobby);
        }
        if (freshLobby) {
          for (const [pid] of freshLobby.players) {
            const s = getSocket(pid);
            if (s) s.emit('card_lobby_update', lobbyManager.getLobbyState(result.lobbyId, pid));
          }
        }
      }
      console.log(`[cards] ${user.name} auto-left lobby ${result.lobbyId}`);
      return true;
    }

    // ------------------------------------------------------------------
    // Card Games: get lobbies
    // ------------------------------------------------------------------
    socket.on('card_get_lobbies', () => {
      try {
        if (!lobbyManager) return;
        if (!checkEventRate(socket, 'card_get_lobbies', 30, 60000)) return;
        socket.emit('card_lobbies', { lobbies: lobbyManager.getLobbies() });
      } catch (err) {
        console.error('[card_get_lobbies] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Card Games: create lobby
    // ------------------------------------------------------------------
    socket.on('card_create_lobby', (data) => {
      try {
        if (!lobbyManager || !data) return;
        if (!checkEventRate(socket, 'card_create_lobby', 5, 60000)) {
          socket.emit('error', { message: 'Creating lobbies too fast' });
          return;
        }
        // Auto-leave any existing lobby before creating a new one
        const didAutoLeave = autoLeaveCurrent();
        const gameType = data.gameType === 'blackjack' ? 'blackjack' : 'holdem';
        const lobby = lobbyManager.createLobby(socket.id, gameType, user.name, user.color, user.avatar || null);
        if (!lobby) {
          socket.emit('error', { message: 'Already in a lobby or invalid game type' });
          if (didAutoLeave) io.emit('card_lobbies_updated', { lobbies: lobbyManager.getLobbies() });
          return;
        }
        // Use account chips if available
        const accKey = socketAccountMap.get(socket.id);
        if (accKey) {
          const acc = accounts.loadAccount(accKey);
          if (acc && acc.chips > 0) {
            const p = lobby.players.get(socket.id);
            if (p) p.chips = acc.chips;
          }
        }
        // Add AI bots if this is a poker lobby
        if (gameType === 'holdem') {
          lobbyManager.addBots(lobby.id);
        }
        socket.join('cardlobby:' + lobby.id);
        socket.emit('card_lobby_joined', lobbyManager.getLobbyState(lobby.id, socket.id));
        io.emit('card_lobbies_updated', { lobbies: lobbyManager.getLobbies() });
        console.log(`[cards] ${user.name} created ${gameType} lobby ${lobby.id}`);
      } catch (err) {
        console.error('[card_create_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Card Games: join lobby
    // ------------------------------------------------------------------
    socket.on('card_join_lobby', (data) => {
      try {
        if (!lobbyManager || !data || !data.lobbyId) return;
        if (!checkEventRate(socket, 'card_join_lobby', 10, 60000)) return;
        // Auto-leave any existing lobby before joining another
        const didAutoLeave = autoLeaveCurrent();
        const lobby = lobbyManager.joinLobby(socket.id, data.lobbyId, user.name, user.color, user.avatar || null);
        if (!lobby) {
          socket.emit('error', { message: 'Lobby full, already started, or you are already in a lobby' });
          socket.emit('card_lobbies', { lobbies: lobbyManager.getLobbies() });
          if (didAutoLeave) io.emit('card_lobbies_updated', { lobbies: lobbyManager.getLobbies() });
          return;
        }
        // Use account chips if available
        const accKey = socketAccountMap.get(socket.id);
        if (accKey) {
          const acc = accounts.loadAccount(accKey);
          if (acc && acc.chips > 0) {
            const p = lobby.players.get(socket.id);
            if (p) p.chips = acc.chips;
          }
        }
        socket.join('cardlobby:' + lobby.id);
        socket.emit('card_lobby_joined', lobbyManager.getLobbyState(lobby.id, socket.id));
        // Notify others in the lobby
        socket.to('cardlobby:' + lobby.id).emit('card_lobby_update', lobbyManager.getLobbyState(lobby.id, null));
        io.emit('card_lobbies_updated', { lobbies: lobbyManager.getLobbies() });
        console.log(`[cards] ${user.name} joined lobby ${lobby.id}`);
      } catch (err) {
        console.error('[card_join_lobby] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Card Games: leave lobby
    // ------------------------------------------------------------------
    socket.on('card_leave_lobby', () => {
      try {
        if (!lobbyManager) return;
        const didLeave = autoLeaveCurrent();
        socket.emit('card_lobby_left');
        if (didLeave) {
          io.emit('card_lobbies_updated', { lobbies: lobbyManager.getLobbies() });
        }
      } catch (err) {
        console.error('[card_leave_lobby] Error:', err.message);
        try { lobbyManager.leaveLobby(socket.id); } catch (_) {}
        socket.emit('card_lobby_left');
        socket.emit('card_lobbies', { lobbies: lobbyManager.getLobbies() });
      }
    });

    // ------------------------------------------------------------------
    // Card Games: ready up
    // ------------------------------------------------------------------
    socket.on('card_ready', () => {
      try {
        if (!lobbyManager) return;
        if (!checkEventRate(socket, 'card_ready', 10, 60000)) return;
        const lobbyId = lobbyManager.getPlayerLobbyId(socket.id);
        // Ready up bots before processing human ready (so all can start together)
        if (lobbyId) {
          lobbyManager.readyBots(lobbyId);
        }
        const lobby = lobbyManager.playerReady(socket.id);
        if (!lobby) return;
        // Send personalized state to each player
        for (const [pid] of lobby.players) {
          const s = getSocket(pid);
          if (s) s.emit('card_lobby_update', lobbyManager.getLobbyState(lobby.id, pid));
        }
        io.emit('card_lobbies_updated', { lobbies: lobbyManager.getLobbies() });
        // If the game just started and a bot is first to act, process bot turns
        if (lobby.state === 'playing' && lobby.gameType === 'holdem') {
          processPokerBots(io, lobbyManager, lobby.id);
        }
      } catch (err) {
        console.error('[card_ready] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Card Games: player action (fold/check/call/raise/hit/stand/double)
    // ------------------------------------------------------------------
    socket.on('card_action', (data) => {
      try {
        if (!lobbyManager || !data) return;
        if (!checkEventRate(socket, 'card_action', 60, 60000)) return;
        const lobby = lobbyManager.playerAction(socket.id, data.action, data.amount);
        if (!lobby) return;
        // Send personalized state to each player
        for (const [pid] of lobby.players) {
          const s = getSocket(pid);
          if (s) s.emit('card_lobby_update', lobbyManager.getLobbyState(lobby.id, pid));
        }
        // Save chips to accounts when round ends, THEN rebuy broke players
        if (lobby.state === 'waiting') {
          saveAllLobbyChips(lobby);
          lobbyManager.rebuyBrokePlayers(lobby);
          // Re-broadcast with updated (rebuyed) chip counts
          for (const [pid] of lobby.players) {
            const s = getSocket(pid);
            if (s) s.emit('card_lobby_update', lobbyManager.getLobbyState(lobby.id, pid));
          }
        }
        io.emit('card_lobbies_updated', { lobbies: lobbyManager.getLobbies() });
        // Process bot turns if next player is a bot
        if (lobby.state === 'playing' && lobby.gameType === 'holdem') {
          processPokerBots(io, lobbyManager, lobby.id);
        }
      } catch (err) {
        console.error('[card_action] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Card Games: lobby chat
    // ------------------------------------------------------------------
    socket.on('card_chat', (data) => {
      try {
        if (!lobbyManager || !data || typeof data.message !== 'string') return;
        if (!checkEventRate(socket, 'card_chat', 20, 60000)) return;
        const result = lobbyManager.addChat(socket.id, sanitizeText(data.message));
        if (!result) return;
        io.to('cardlobby:' + result.lobbyId).emit('card_chat_msg', result.msg);
      } catch (err) { /* swallow */ }
    });
  }
};
