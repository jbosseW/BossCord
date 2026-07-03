// cardgames.js — Texas Hold'em + Blackjack lobby system for BossCord

const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'];
const RANK_NAMES = {2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A'};
const SUIT_SYM = { spades:'\u2660', hearts:'\u2665', diamonds:'\u2666', clubs:'\u2663' };
const STARTING_CHIPS = 1000;
const MAX_PLAYERS = 8;
const MAX_LOBBIES = 50;
const MAX_CHAT = 50;

function createDeck() {
  const d = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ suit: s, rank: r });
  return d;
}

const crypto = require('crypto');

function shuffle(d) {
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardStr(c) { return SUIT_SYM[c.suit] + RANK_NAMES[c.rank]; }

function cardValue(c) {
  if (c.rank >= 10 && c.rank <= 13) return 10;
  if (c.rank === 14) return 11;
  return c.rank;
}

function bjHandValue(hand) {
  let val = 0, aces = 0;
  for (const c of hand) {
    val += cardValue(c);
    if (c.rank === 14) aces++;
  }
  while (val > 21 && aces > 0) { val -= 10; aces--; }
  return val;
}

// ---------------------------------------------------------------------------
// Poker hand evaluation (5-card)
// ---------------------------------------------------------------------------
function evalFive(five) {
  const ranks = five.map(c => c.rank).sort((a, b) => b - a);
  const suits = five.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);

  let isStraight = false, straightHigh = 0;
  const uniq = [...new Set(ranks)];
  if (uniq.length === 5 && ranks[0] - ranks[4] === 4) { isStraight = true; straightHigh = ranks[0]; }
  if (ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2) {
    isStraight = true; straightHigh = 5;
  }

  const freq = {};
  for (const r of ranks) freq[r] = (freq[r] || 0) + 1;
  const counts = Object.entries(freq).map(([r, c]) => ({ rank: +r, count: c }));
  counts.sort((a, b) => b.count - a.count || b.rank - a.rank);

  if (isFlush && isStraight) return { hr: straightHigh === 14 ? 10 : 9, name: straightHigh === 14 ? 'Royal Flush' : 'Straight Flush', k: [straightHigh] };
  if (counts[0].count === 4) return { hr: 8, name: 'Four of a Kind', k: [counts[0].rank, counts[1].rank] };
  if (counts[0].count === 3 && counts[1].count === 2) return { hr: 7, name: 'Full House', k: [counts[0].rank, counts[1].rank] };
  if (isFlush) return { hr: 6, name: 'Flush', k: ranks };
  if (isStraight) return { hr: 5, name: 'Straight', k: [straightHigh] };
  if (counts[0].count === 3) return { hr: 4, name: 'Three of a Kind', k: [counts[0].rank, ...counts.slice(1).map(c => c.rank).sort((a, b) => b - a)] };
  if (counts[0].count === 2 && counts[1].count === 2) {
    const pairs = [counts[0].rank, counts[1].rank].sort((a, b) => b - a);
    return { hr: 3, name: 'Two Pair', k: [...pairs, counts[2].rank] };
  }
  if (counts[0].count === 2) return { hr: 2, name: 'One Pair', k: [counts[0].rank, ...counts.slice(1).map(c => c.rank).sort((a, b) => b - a)] };
  return { hr: 1, name: 'High Card', k: ranks };
}

function cmpEval(a, b) {
  if (a.hr !== b.hr) return a.hr - b.hr;
  for (let i = 0; i < Math.max(a.k.length, b.k.length); i++) {
    if ((a.k[i] || 0) !== (b.k[i] || 0)) return (a.k[i] || 0) - (b.k[i] || 0);
  }
  return 0;
}

function bestHand(cards) {
  let best = null;
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const hand = cards.filter((_, idx) => idx !== i && idx !== j);
      if (hand.length !== 5) continue;
      const ev = evalFive(hand);
      if (!best || cmpEval(ev, best) > 0) best = ev;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Lobby Manager
// ---------------------------------------------------------------------------
class LobbyManager {
  constructor() {
    this.lobbies = new Map();
    this.playerLobby = new Map();
    this.nextId = 1;
  }

  createLobby(socketId, gameType, name, color, avatar) {
    if (this.playerLobby.has(socketId)) return null;
    if (gameType !== 'holdem' && gameType !== 'blackjack') return null;
    if (this.lobbies.size >= MAX_LOBBIES) return null;

    const id = 'L' + (this.nextId++);
    const lobby = {
      id, gameType,
      players: new Map(),
      state: 'waiting',
      deck: [], communityCards: [], dealerHand: [],
      pot: 0, currentTurn: null, phase: null,
      turnOrder: [], dealerIdx: 0,
      smallBlind: 10, bigBlind: 20,
      currentBet: 0, minRaise: 0,
      lastRaiser: null, actedThisRound: new Set(),
      chat: [], createdAt: Date.now(),
      roundResults: null,
    };
    this._addPlayer(lobby, socketId, name, color, avatar);
    this.lobbies.set(id, lobby);
    this.playerLobby.set(socketId, id);
    return lobby;
  }

  joinLobby(socketId, lobbyId, name, color, avatar) {
    if (this.playerLobby.has(socketId)) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.players.size >= MAX_PLAYERS || lobby.state !== 'waiting') return null;
    this._addPlayer(lobby, socketId, name, color, avatar);
    this.playerLobby.set(socketId, lobbyId);
    return lobby;
  }

  _addPlayer(lobby, socketId, name, color, avatar) {
    lobby.players.set(socketId, {
      id: socketId, name: (name || 'Anon').slice(0, 20), color: color || '#5865f2',
      avatar: avatar || null,
      chips: STARTING_CHIPS, hand: [], bet: 0, totalBet: 0,
      folded: false, ready: false, stood: false, busted: false,
      doubledDown: false,
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
      this.lobbies.delete(lobbyId);
      return { lobbyId, destroyed: true };
    }

    if (lobby.state === 'playing') {
      if (lobby.gameType === 'holdem') this._holdemHandleLeave(lobby, socketId);
      else this._bjHandleLeave(lobby, socketId);
    }
    return { lobbyId, destroyed: false, lobby };
  }

  playerReady(socketId) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'waiting') return null;
    const p = lobby.players.get(socketId);
    if (!p) return null;
    p.ready = !p.ready;

    // Check if enough players ready to start
    const readyCount = [...lobby.players.values()].filter(p => p.ready).length;
    if (readyCount >= 2 || (lobby.gameType === 'blackjack' && readyCount >= 1)) {
      if (readyCount === lobby.players.size && lobby.players.size >= (lobby.gameType === 'holdem' ? 2 : 1)) {
        this._startGame(lobby);
      }
    }
    return lobby;
  }

  playerAction(socketId, action, amount) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.state !== 'playing') return null;
    if (lobby.currentTurn !== socketId) return null;

    if (lobby.gameType === 'holdem') return this._holdemAction(lobby, socketId, action, amount);
    return this._bjAction(lobby, socketId, action);
  }

  addChat(socketId, message) {
    const lobbyId = this.playerLobby.get(socketId);
    if (!lobbyId) return null;
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;
    const p = lobby.players.get(socketId);
    if (!p) return null;
    const msg = { name: p.name, color: p.color, text: message.slice(0, 200), ts: Date.now() };
    lobby.chat.push(msg);
    if (lobby.chat.length > MAX_CHAT) lobby.chat = lobby.chat.slice(-MAX_CHAT);
    return { lobbyId, msg };
  }

  _startGame(lobby) {
    lobby.state = 'playing';
    lobby.roundResults = null;
    for (const [, p] of lobby.players) {
      p.hand = []; p.bet = 0; p.totalBet = 0;
      p.folded = false; p.ready = false;
      p.stood = false; p.busted = false; p.doubledDown = false;
    }
    lobby.communityCards = [];
    lobby.dealerHand = [];
    lobby.pot = 0;
    lobby.deck = shuffle(createDeck());

    if (lobby.gameType === 'holdem') this._holdemStart(lobby);
    else this._bjStart(lobby);
  }

  // -----------------------------------------------------------------------
  // TEXAS HOLD'EM
  // -----------------------------------------------------------------------
  _holdemStart(lobby) {
    const order = [...lobby.players.keys()];
    lobby.turnOrder = order;
    lobby.dealerIdx = lobby.dealerIdx % order.length;

    // Deal 2 cards to each
    for (const id of order) {
      const p = lobby.players.get(id);
      p.hand = [lobby.deck.pop(), lobby.deck.pop()];
    }

    // Post blinds
    const sbIdx = (lobby.dealerIdx + 1) % order.length;
    const bbIdx = (lobby.dealerIdx + 2) % order.length;
    const sbPlayer = lobby.players.get(order[sbIdx]);
    const bbPlayer = lobby.players.get(order[bbIdx]);

    const sbAmt = Math.min(lobby.smallBlind, sbPlayer.chips);
    sbPlayer.chips -= sbAmt; sbPlayer.bet = sbAmt; sbPlayer.totalBet = sbAmt;
    const bbAmt = Math.min(lobby.bigBlind, bbPlayer.chips);
    bbPlayer.chips -= bbAmt; bbPlayer.bet = bbAmt; bbPlayer.totalBet = bbAmt;
    lobby.pot = sbAmt + bbAmt;
    lobby.currentBet = bbAmt;
    lobby.minRaise = lobby.bigBlind;

    // First to act is left of big blind
    lobby.phase = 'preflop';
    lobby.actedThisRound = new Set();
    lobby.lastRaiser = order[bbIdx];
    const firstIdx = (bbIdx + 1) % order.length;
    lobby.currentTurn = this._nextActive(lobby, firstIdx);
  }

  _holdemAction(lobby, socketId, action, amount) {
    const p = lobby.players.get(socketId);
    if (!p || p.folded) return lobby;

    if (action === 'fold') {
      p.folded = true;
      // Check if only one player left
      const active = [...lobby.players.values()].filter(x => !x.folded);
      if (active.length === 1) {
        active[0].chips += lobby.pot;
        lobby.roundResults = { winners: [{ name: active[0].name, amount: lobby.pot, hand: 'Last player standing' }] };
        this._holdemEndRound(lobby);
        return lobby;
      }
    } else if (action === 'check') {
      if (p.bet < lobby.currentBet) return lobby; // can't check
    } else if (action === 'call') {
      const toCall = Math.min(lobby.currentBet - p.bet, p.chips);
      p.chips -= toCall; p.bet += toCall; p.totalBet += toCall;
      lobby.pot += toCall;
    } else if (action === 'raise') {
      if (!isFinite(amount) || amount < 0) amount = lobby.minRaise;
      const raiseAmt = Math.max(amount || lobby.minRaise, lobby.minRaise);
      const totalNeeded = lobby.currentBet - p.bet + raiseAmt;
      const actual = Math.min(totalNeeded, p.chips);
      p.chips -= actual; p.bet += actual; p.totalBet += actual;
      lobby.pot += actual;
      if (p.bet > lobby.currentBet) {
        lobby.minRaise = p.bet - lobby.currentBet;
        lobby.currentBet = p.bet;
        lobby.lastRaiser = socketId;
        lobby.actedThisRound = new Set([socketId]);
        return this._advanceHoldemTurn(lobby);
      }
    } else if (action === 'allin') {
      const allIn = p.chips;
      p.chips = 0; p.bet += allIn; p.totalBet += allIn;
      lobby.pot += allIn;
      if (p.bet > lobby.currentBet) {
        lobby.minRaise = Math.max(p.bet - lobby.currentBet, lobby.bigBlind);
        lobby.currentBet = p.bet;
        lobby.lastRaiser = socketId;
        lobby.actedThisRound = new Set([socketId]);
        return this._advanceHoldemTurn(lobby);
      }
    }

    lobby.actedThisRound.add(socketId);
    return this._advanceHoldemTurn(lobby);
  }

  _advanceHoldemTurn(lobby) {
    const order = lobby.turnOrder;
    const curIdx = order.indexOf(lobby.currentTurn);
    const nextIdx = (curIdx + 1) % order.length;
    const next = this._nextActive(lobby, nextIdx);

    // Check if betting round is over
    const active = order.filter(id => {
      const p = lobby.players.get(id);
      return p && !p.folded && p.chips > 0;
    });
    const allActed = active.every(id => lobby.actedThisRound.has(id));
    const allEqualBet = active.every(id => {
      const p = lobby.players.get(id);
      return p.bet >= lobby.currentBet || p.chips === 0;
    });

    if ((allActed && allEqualBet) || active.length <= 1) {
      return this._advanceHoldemPhase(lobby);
    }

    lobby.currentTurn = next;
    return lobby;
  }

  _advanceHoldemPhase(lobby) {
    // Reset bets for next round
    for (const [, p] of lobby.players) p.bet = 0;
    lobby.currentBet = 0;
    lobby.actedThisRound = new Set();
    lobby.lastRaiser = null;

    const active = [...lobby.players.entries()].filter(([, p]) => !p.folded);

    if (lobby.phase === 'preflop') {
      lobby.phase = 'flop';
      lobby.deck.pop(); // burn
      lobby.communityCards.push(lobby.deck.pop(), lobby.deck.pop(), lobby.deck.pop());
    } else if (lobby.phase === 'flop') {
      lobby.phase = 'turn';
      lobby.deck.pop();
      lobby.communityCards.push(lobby.deck.pop());
    } else if (lobby.phase === 'turn') {
      lobby.phase = 'river';
      lobby.deck.pop();
      lobby.communityCards.push(lobby.deck.pop());
    } else if (lobby.phase === 'river') {
      return this._holdemShowdown(lobby);
    }

    // Check if only 1 active player with chips (others all-in or folded)
    const canAct = active.filter(([, p]) => p.chips > 0);
    if (canAct.length <= 1) {
      // Run out remaining community cards
      while (lobby.communityCards.length < 5) {
        lobby.deck.pop();
        lobby.communityCards.push(lobby.deck.pop());
      }
      return this._holdemShowdown(lobby);
    }

    // First to act post-flop: left of dealer
    const firstIdx = (lobby.dealerIdx + 1) % lobby.turnOrder.length;
    lobby.currentTurn = this._nextActive(lobby, firstIdx);
    return lobby;
  }

  _holdemShowdown(lobby) {
    lobby.phase = 'showdown';
    lobby.currentTurn = null;

    const active = [...lobby.players.entries()].filter(([, p]) => !p.folded);
    const results = active.map(([id, p]) => {
      const all7 = [...p.hand, ...lobby.communityCards];
      const best = bestHand(all7);
      return { id, player: p, eval: best };
    });

    results.sort((a, b) => cmpEval(b.eval, a.eval));
    const winnerEval = results[0].eval;
    const winners = results.filter(r => cmpEval(r.eval, winnerEval) === 0);
    const share = Math.floor(lobby.pot / winners.length);

    for (const w of winners) w.player.chips += share;
    const leftover = lobby.pot - share * winners.length;
    if (leftover > 0) winners[0].player.chips += leftover;

    lobby.roundResults = {
      winners: winners.map(w => ({ name: w.player.name, amount: share, hand: w.eval.name })),
      hands: results.map(r => ({
        name: r.player.name, cards: r.player.hand.map(cardStr), eval: r.eval.name,
      })),
    };

    this._holdemEndRound(lobby);
    return lobby;
  }

  _holdemEndRound(lobby) {
    lobby.phase = 'showdown';
    lobby.currentTurn = null;
    lobby.state = 'waiting';
    lobby.dealerIdx = (lobby.dealerIdx + 1) % Math.max(1, lobby.players.size);

    // Mark not ready; rebuy is handled AFTER account chips are saved (in socket.js)
    for (const [id, p] of lobby.players) {
      p.ready = false;
    }
  }

  rebuyBrokePlayers(lobby) {
    if (!lobby) return;
    for (const [id, p] of lobby.players) {
      if (p.chips <= 0) p.chips = STARTING_CHIPS;
    }
  }

  _holdemHandleLeave(lobby, socketId) {
    const active = [...lobby.players.values()].filter(p => !p.folded);
    if (active.length <= 1 && lobby.state === 'playing') {
      if (active.length === 1) {
        active[0].chips += lobby.pot;
        lobby.roundResults = { winners: [{ name: active[0].name, amount: lobby.pot, hand: 'Last player standing' }] };
      }
      this._holdemEndRound(lobby);
    }
  }

  _nextActive(lobby, startIdx) {
    const order = lobby.turnOrder.filter(id => lobby.players.has(id));
    if (order.length === 0) return null;
    let idx = startIdx % order.length;
    for (let i = 0; i < order.length; i++) {
      const id = order[idx];
      const p = lobby.players.get(id);
      if (p && !p.folded && p.chips > 0) return id;
      idx = (idx + 1) % order.length;
    }
    return order[0];
  }

  // -----------------------------------------------------------------------
  // BLACKJACK
  // -----------------------------------------------------------------------
  _bjStart(lobby) {
    const order = [...lobby.players.keys()];
    lobby.turnOrder = order;
    lobby.phase = 'betting';

    // Auto-bet the blind for each player
    for (const id of order) {
      const p = lobby.players.get(id);
      const bet = Math.min(lobby.bigBlind, p.chips);
      p.bet = bet; p.chips -= bet;
      lobby.pot += bet;
    }

    // Deal
    for (const id of order) {
      const p = lobby.players.get(id);
      p.hand = [lobby.deck.pop(), lobby.deck.pop()];
    }
    lobby.dealerHand = [lobby.deck.pop(), lobby.deck.pop()];

    // Check for dealer natural 21
    lobby.phase = 'playing';
    lobby.currentTurn = order[0];

    // Check for player blackjack (auto-stand)
    for (const id of order) {
      const p = lobby.players.get(id);
      if (bjHandValue(p.hand) === 21) { p.stood = true; }
    }
    if (lobby.players.get(order[0]).stood) {
      this._bjAdvanceTurn(lobby);
    }
    return lobby;
  }

  _bjAction(lobby, socketId, action) {
    const p = lobby.players.get(socketId);
    if (!p || p.stood || p.busted) return lobby;

    if (action === 'hit') {
      p.hand.push(lobby.deck.pop());
      const val = bjHandValue(p.hand);
      if (val > 21) { p.busted = true; }
      else if (val === 21) { p.stood = true; }

      if (p.busted || p.stood) {
        return this._bjAdvanceTurn(lobby);
      }
    } else if (action === 'stand') {
      p.stood = true;
      return this._bjAdvanceTurn(lobby);
    } else if (action === 'double') {
      if (p.doubledDown) return lobby; // prevent double-doubling
      const extraBet = Math.min(p.bet, p.chips);
      p.chips -= extraBet; p.bet += extraBet; lobby.pot += extraBet;
      p.hand.push(lobby.deck.pop());
      p.doubledDown = true;
      if (bjHandValue(p.hand) > 21) p.busted = true;
      p.stood = true;
      return this._bjAdvanceTurn(lobby);
    }
    return lobby;
  }

  _bjAdvanceTurn(lobby) {
    const order = lobby.turnOrder.filter(id => lobby.players.has(id));
    const curIdx = order.indexOf(lobby.currentTurn);

    // Find next player who hasn't stood or busted
    for (let i = 1; i <= order.length; i++) {
      const nextIdx = (curIdx + i) % order.length;
      const next = lobby.players.get(order[nextIdx]);
      if (next && !next.stood && !next.busted) {
        lobby.currentTurn = order[nextIdx];
        return lobby;
      }
    }

    // All players done — dealer plays
    return this._bjDealerPlay(lobby);
  }

  _bjDealerPlay(lobby) {
    lobby.phase = 'dealer';
    lobby.currentTurn = null;

    // Dealer hits until 17+
    while (bjHandValue(lobby.dealerHand) < 17) {
      lobby.dealerHand.push(lobby.deck.pop());
    }

    const dealerVal = bjHandValue(lobby.dealerHand);
    const dealerBust = dealerVal > 21;

    // First pass: calculate ideal payouts per player
    const payoutEntries = []; // internal: { playerId, payout }
    const results = [];       // client-facing: { name, result, payout, handValue }
    let totalPayouts = 0;
    for (const [id, p] of lobby.players) {
      const pVal = bjHandValue(p.hand);
      let result, payout = 0;

      if (p.busted) {
        result = 'bust';
      } else if (dealerBust) {
        result = 'win'; payout = p.bet * 2;
      } else if (pVal > dealerVal) {
        result = 'win'; payout = p.bet * 2;
      } else if (pVal === dealerVal) {
        result = 'push'; payout = p.bet;
      } else {
        result = 'lose';
      }
      totalPayouts += payout;
      payoutEntries.push({ playerId: id, payout });
      results.push({ name: p.name, result, payout, handValue: pVal });
    }

    // Cap total payouts to the pot to prevent chip inflation
    if (totalPayouts > lobby.pot && totalPayouts > 0) {
      const scale = lobby.pot / totalPayouts;
      totalPayouts = 0;
      for (let i = 0; i < payoutEntries.length; i++) {
        const capped = Math.floor(payoutEntries[i].payout * scale);
        payoutEntries[i].payout = capped;
        results[i].payout = capped;
        totalPayouts += capped;
      }
    }

    // Second pass: apply capped payouts to player chip counts
    for (const entry of payoutEntries) {
      const p = lobby.players.get(entry.playerId);
      if (p) p.chips += entry.payout;
    }

    lobby.roundResults = {
      dealerValue: dealerVal,
      dealerBust,
      dealerCards: lobby.dealerHand.map(cardStr),
      results,
    };

    lobby.phase = 'result';
    lobby.state = 'waiting';
    for (const [, p] of lobby.players) {
      p.ready = false;
    }
    return lobby;
  }

  _bjHandleLeave(lobby, socketId) {
    const remaining = [...lobby.players.values()];
    const allDone = remaining.every(p => p.stood || p.busted);
    if (allDone && lobby.state === 'playing') {
      this._bjDealerPlay(lobby);
    } else if (lobby.currentTurn === socketId) {
      this._bjAdvanceTurn(lobby);
    }
  }

  // -----------------------------------------------------------------------
  // Poker AI Bots
  // -----------------------------------------------------------------------
  addBots(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || lobby.gameType !== 'holdem') return; // Only for poker

    const botNames = ['Bot-Ace', 'Bot-King', 'Bot-Queen'];
    const botColors = ['#ed4245', '#57f287', '#5865f2'];

    for (let i = 0; i < 3; i++) {
      const botId = 'cardbot_' + lobbyId + '_' + i;
      if (lobby.players.has(botId)) continue;
      lobby.players.set(botId, {
        id: botId,
        name: botNames[i],
        color: botColors[i],
        chips: STARTING_CHIPS,
        hand: [],
        bet: 0,
        totalBet: 0,
        folded: false,
        ready: false,
        stood: false,
        busted: false,
        doubledDown: false,
        isBot: true,
      });
      this.playerLobby.set(botId, lobbyId);
    }
  }

  removeBots(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return;
    const toRemove = [];
    for (const [pid] of lobby.players) {
      if (pid.startsWith('cardbot_')) toRemove.push(pid);
    }
    for (const id of toRemove) {
      lobby.players.delete(id);
      this.playerLobby.delete(id);
    }
    // Clean up empty lobby
    if (lobby.players.size === 0) {
      this.lobbies.delete(lobbyId);
    }
  }

  getHumanCount(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return 0;
    let count = 0;
    for (const [pid] of lobby.players) {
      if (!pid.startsWith('cardbot_')) count++;
    }
    return count;
  }

  readyBots(lobbyId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return;
    for (const [pid, p] of lobby.players) {
      if (pid.startsWith('cardbot_') && !p.ready) {
        p.ready = true;
      }
    }
  }

  getBotAction(lobbyId, botId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby || !lobby.players.has(botId)) return null;

    const bot = lobby.players.get(botId);
    if (!bot || bot.folded || bot.chips === 0) return null;

    const hand = bot.hand || [];
    const communityCards = lobby.communityCards || [];
    const currentBet = lobby.currentBet || 0;
    const botBet = bot.bet || 0;
    const toCall = currentBet - botBet;

    // Simple AI: evaluate hand strength loosely
    const allCards = hand.concat(communityCards);
    const ranks = allCards.map(c => c.rank);
    const hasPair = ranks.some((v, i) => ranks.indexOf(v) !== i);
    const hasHighCard = ranks.some(v => v >= 11); // J, Q, K, A

    // Pre-flop logic
    if (communityCards.length === 0) {
      if (hasPair || (hand.length === 2 && hand[0].rank >= 10 && hand[1].rank >= 10)) {
        // Strong hand: raise
        if (crypto.randomInt(100) < 60) return { action: 'raise', amount: currentBet + lobby.bigBlind * 2 };
        return { action: 'call' };
      }
      if (hasHighCard) {
        // Decent hand: call
        if (toCall > bot.chips * 0.3) return { action: 'fold' };
        return { action: 'call' };
      }
      // Weak hand
      if (toCall === 0) return { action: 'check' };
      if (toCall <= lobby.bigBlind && crypto.randomInt(100) < 50) return { action: 'call' };
      return { action: 'fold' };
    }

    // Post-flop: more aggressive with pairs
    if (hasPair) {
      if (crypto.randomInt(100) < 40) return { action: 'raise', amount: currentBet + lobby.bigBlind * 2 };
      return { action: 'call' };
    }

    if (hasHighCard && toCall <= bot.chips * 0.2) {
      return { action: 'call' };
    }

    if (toCall === 0) return { action: 'check' };
    if (toCall <= lobby.bigBlind * 2 && crypto.randomInt(100) < 30) return { action: 'call' };
    return { action: 'fold' };
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------
  getLobbies() {
    const out = [];
    for (const [, lobby] of this.lobbies) {
      out.push({
        id: lobby.id, gameType: lobby.gameType,
        playerCount: lobby.players.size, maxPlayers: MAX_PLAYERS,
        state: lobby.state,
        players: [...lobby.players.values()].map(p => ({ name: p.name, color: p.color })),
      });
    }
    return out;
  }

  getLobbyState(lobbyId, forSocketId) {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) return null;

    const players = [];
    for (const [id, p] of lobby.players) {
      const isMe = id === forSocketId;
      players.push({
        id: p.id, name: p.name, color: p.color, avatar: p.avatar || null,
        chips: p.chips, bet: p.bet, totalBet: p.totalBet,
        folded: p.folded, ready: p.ready,
        stood: p.stood, busted: p.busted, doubledDown: p.doubledDown,
        hand: isMe || lobby.gameType === 'blackjack' || lobby.phase === 'showdown' || lobby.phase === 'result'
          ? p.hand.map(cardStr) : p.hand.map(() => '??'),
        handValue: (lobby.gameType === 'blackjack')
          ? bjHandValue(p.hand) : null,
        isMe,
      });
    }

    const showDealerFull = lobby.phase === 'dealer' || lobby.phase === 'result' || lobby.phase === 'showdown';

    return {
      id: lobby.id, gameType: lobby.gameType,
      state: lobby.state, phase: lobby.phase,
      pot: lobby.pot, currentTurn: lobby.currentTurn,
      currentBet: lobby.currentBet || 0,
      players,
      communityCards: lobby.communityCards.map(cardStr),
      dealerHand: lobby.gameType === 'blackjack'
        ? (showDealerFull
          ? lobby.dealerHand.map(cardStr)
          : lobby.dealerHand.map((c, i) => i === 0 ? cardStr(c) : '??'))
        : [],
      dealerValue: showDealerFull && lobby.gameType === 'blackjack'
        ? bjHandValue(lobby.dealerHand) : null,
      chat: lobby.chat,
      roundResults: lobby.roundResults,
      bigBlind: lobby.bigBlind,
    };
  }

  getPlayerLobbyId(socketId) {
    return this.playerLobby.get(socketId) || null;
  }

  reset() {
    this.lobbies.clear();
    this.playerLobby.clear();
  }
}

module.exports = { LobbyManager, cardStr, SUIT_SYM, RANK_NAMES };
