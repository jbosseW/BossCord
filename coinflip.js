// coinflip.js — Multiplayer coin flip game for BossCord
// Any number of players join, pick heads/tails, flip happens, winners get chips.

const crypto = require('crypto');

const CHIP_REWARD = 50; // default reward when no bet
const MIN_BET = 0;  // 0 = free play (wins flat 50)
const MAX_BET = 10000; // 10K max bet (reasonable cap)
const MAX_LOBBIES = 50;
const COUNTDOWN_MS = 3000; // 3-second countdown before flip
const RESULT_DISPLAY_MS = 4000; // Show result for 4 seconds before next round
const MAX_CHAT = 30;

class CoinFlipManager {
  constructor() {
    this.lobbies = new Map();   // Map<lobbyId, lobby>
    this.playerLobby = new Map(); // Map<socketId, lobbyId>
    this.nextId = 1;
  }

  createLobby(socketId, name, color) {
    if (this.playerLobby.has(socketId)) return null;
    if (this.lobbies.size >= MAX_LOBBIES) return null;
    const id = 'CF' + (this.nextId++);
    const lobby = {
      id,
      players: new Map(),
      state: 'waiting', // waiting, countdown, flipping, result
      result: null,      // 'heads' or 'tails'
      roundNumber: 0,
      countdownTimer: null,
      resultTimer: null,
      chat: [],
      createdAt: Date.now(),
    };
    this._addPlayer(lobby, socketId, name, color);
    this.lobbies.set(id, lobby);
    this.playerLobby.set(socketId, id);
    return lobby;
  }

  joinLobby(socketId, lobbyId, name, color) {
    if (this.playerLobby.has(socketId)) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    // Can join during waiting or even between rounds
    if (lobby.state !== 'waiting' && lobby.state !== 'result') return null;
    this._addPlayer(lobby, socketId, name, color);
    this.playerLobby.set(socketId, lobbyId);
    return lobby;
  }

  _addPlayer(lobby, socketId, name, color) {
    lobby.players.set(socketId, {
      id: socketId,
      name: name || 'Anon',
      color: color || '#5865f2',
      choice: null,    // 'heads' or 'tails'
      bet: 0,          // chip wager (0 = free play, wins flat 50)
      wins: 0,
      losses: 0,
      ready: false,
    });
  }

  leaveLobby(socketId) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    this.playerLobby.delete(socketId);
    if (!lobby) return { lobbyId, destroyed: true };

    lobby.players.delete(socketId);
    if (lobby.players.size === 0) {
      if (lobby.countdownTimer) clearTimeout(lobby.countdownTimer);
      if (lobby.resultTimer) clearTimeout(lobby.resultTimer);
      this.lobbies.delete(lobbyId);
      return { lobbyId, destroyed: true };
    }

    // If everyone left during countdown and less than 2 players, cancel
    if (lobby.state === 'countdown' && lobby.players.size < 2) {
      if (lobby.countdownTimer) clearTimeout(lobby.countdownTimer);
      lobby.countdownTimer = null;
      lobby.state = 'waiting';
      for (const [, p] of lobby.players) { p.ready = false; p.choice = null; }
    }

    return { lobbyId, destroyed: false, lobby };
  }

  /**
   * Player picks heads or tails and readies up.
   * Returns lobby if successful, null otherwise.
   */
  makeChoice(socketId, choice, bet) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    if (lobby.state !== 'waiting') return null;
    if (choice !== 'heads' && choice !== 'tails') return null;

    const player = lobby.players.get(socketId);
    if (!player) return null;
    player.choice = choice;
    player.bet = Math.max(0, Math.min(MAX_BET, Math.floor(bet || 0)));
    player.ready = true;
    return lobby;
  }

  /**
   * Check if enough players are ready to start countdown.
   * Returns true if countdown should begin.
   */
  shouldStartCountdown(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'waiting') return false;
    let readyCount = 0;
    for (const [, p] of lobby.players) {
      if (p.ready) readyCount++;
    }
    // Solo play (1 player vs house) or multiplayer (2+)
    return readyCount >= 1;
  }

  /**
   * Start the countdown. Returns the lobby.
   * The caller is responsible for setting up the timeout callback.
   */
  startCountdown(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'waiting') return null;
    lobby.state = 'countdown';
    return lobby;
  }

  /**
   * Execute the flip. Returns { lobby, result, winners, losers }.
   */
  doFlip(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;

    lobby.state = 'flipping';
    lobby.roundNumber++;
    const result = crypto.randomInt(2) === 0 ? 'heads' : 'tails';
    lobby.result = result;

    const winners = [];
    const losers = [];

    for (const [id, p] of lobby.players) {
      if (!p.ready || !p.choice) {
        // Players who didn't choose are spectating this round
        continue;
      }
      if (p.choice === result) {
        p.wins++;
        // Winnings: bet > 0 = 2x bet, bet = 0 = flat CHIP_REWARD
        const winAmount = p.bet > 0 ? p.bet * 2 : CHIP_REWARD;
        winners.push({ id, name: p.name, color: p.color, choice: p.choice, bet: p.bet, winAmount });
      } else {
        p.losses++;
        losers.push({ id, name: p.name, color: p.color, choice: p.choice, bet: p.bet, lostAmount: p.bet });
      }
    }

    lobby.state = 'result';
    return { lobby, result, winners, losers };
  }

  /**
   * Reset lobby for next round.
   */
  resetRound(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    lobby.state = 'waiting';
    lobby.result = null;
    lobby.countdownTimer = null;
    lobby.resultTimer = null;
    for (const [, p] of lobby.players) {
      p.choice = null;
      p.bet = 0;
      p.ready = false;
    }
    return lobby;
  }

  addChat(socketId, message) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    const player = lobby.players.get(socketId);
    if (!player) return null;
    const msg = {
      id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
      name: player.name,
      color: player.color,
      text: (typeof message === 'string' ? message : '').slice(0, 200),
      ts: Date.now(),
    };
    lobby.chat.push(msg);
    if (lobby.chat.length > MAX_CHAT) lobby.chat.shift();
    return { lobbyId, msg };
  }

  getLobbies() {
    const out = [];
    for (const [, lobby] of this.lobbies) {
      out.push({
        id: lobby.id,
        playerCount: lobby.players.size,
        state: lobby.state,
        roundNumber: lobby.roundNumber,
        players: [...lobby.players.values()].map(p => ({
          name: p.name, color: p.color, wins: p.wins,
        })),
      });
    }
    return out;
  }

  getLobbyState(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;

    const players = [];
    for (const [, p] of lobby.players) {
      players.push({
        id: p.id, name: p.name, color: p.color,
        choice: p.choice, bet: p.bet, ready: p.ready,
        wins: p.wins, losses: p.losses,
      });
    }

    return {
      id: lobby.id,
      state: lobby.state,
      result: lobby.result,
      roundNumber: lobby.roundNumber,
      players,
      chat: lobby.chat,
    };
  }

  getPlayerLobbyId(socketId) {
    return this.playerLobby.get(socketId) || null;
  }

  reset() {
    for (const [, lobby] of this.lobbies) {
      if (lobby.countdownTimer) clearTimeout(lobby.countdownTimer);
      if (lobby.resultTimer) clearTimeout(lobby.resultTimer);
    }
    this.lobbies.clear();
    this.playerLobby.clear();
  }
}

module.exports = { CoinFlipManager, CHIP_REWARD, MIN_BET, MAX_BET, COUNTDOWN_MS, RESULT_DISPLAY_MS };
