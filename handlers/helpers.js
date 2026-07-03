// handlers/helpers.js
// Shared helper functions for socket event handlers.
// These are stateless utilities that don't reference module-level state.

const ratelimit = require('../ratelimit');

/**
 * Check event rate using ephemeral IP-based limiter (6h TTL).
 * Falls back to socket.id if IP is unavailable.
 */
function checkEventRate(socket, event, maxPerWindow, windowMs) {
  const ip = socket._clientIp || socket.id;
  var effectiveMax = maxPerWindow;
  return ratelimit.check(ip, event, effectiveMax, windowMs);
}

/**
 * Stricter rate check: checks BOTH per-IP AND per-socket limits.
 * This prevents shared IP addresses from being unfairly limited while
 * still preventing single-socket abuse. Both checks must pass.
 *
 * The per-IP limit uses the original max (shared budget across all sockets on that IP).
 * The per-socket limit uses a per-socket fraction (max / 2, minimum 1) to prevent
 * a single socket from consuming the entire IP budget.
 *
 * @param {object} socket - Socket.IO socket
 * @param {string} event - Event/action name
 * @param {number} maxPerWindow - Max allowed per IP in window
 * @param {number} windowMs - Time window in ms
 * @returns {boolean} true if allowed (both checks pass)
 */
function checkEventRateStrict(socket, event, maxPerWindow, windowMs) {
  const ip = socket._clientIp || socket.id;
  const socketId = socket.id;

  // Check 1: per-IP limit (shared across all sockets from this IP)
  const ipAllowed = ratelimit.check(ip, event, maxPerWindow, windowMs);
  if (!ipAllowed) return false;

  // Check 2: per-socket limit (prevents a single socket from hogging the IP budget)
  // Use a per-socket key to differentiate from the IP-level check
  const socketEvent = 'sock:' + event;
  const perSocketMax = Math.max(1, Math.floor(maxPerWindow / 2));
  const socketAllowed = ratelimit.check(socketId, socketEvent, perSocketMax, windowMs);
  if (!socketAllowed) return false;

  return true;
}

/**
 * Sanitize user-provided text.
 * 1. Strip control chars (except \n), zero-width chars
 * 2. Trim whitespace
 *
 * NOTE: No HTML entity encoding. All client rendering uses React text nodes
 * which auto-escape content. HTML encoding here caused double-encoding
 * (e.g. '&' → '&amp;' on server, React renders literal '&amp;' on screen).
 */
function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  // Remove control chars except \n, remove zero-width chars
  let cleaned = str.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F\u200B-\u200F\u2028-\u202F\uFEFF]/g, '');
  // Strip HTML tags to prevent injection in any rendering path
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  // Strip non-standard characters — allow alphanumeric, common punctuation, newlines
  cleaned = cleaned.replace(/[^a-zA-Z0-9 _\-!?,.'":;\n@#&()\/<>+=$/\\]/g, '');
  return cleaned.trim();
}

// --- URL validation for image URLs ---

const ALLOWED_IMAGE_DOMAINS = new Set([
  'i.imgur.com',
  'imgur.com',
  'media.tenor.com',
  'media1.tenor.com',
  'media.giphy.com',
  'giphy.com',
]);

/**
 * Validate an image URL against the allowlist.
 * Only HTTPS URLs from approved domains are accepted.
 * @param {string} url - The URL to validate
 * @returns {string|null} The cleaned URL if valid, null otherwise
 */
function validateUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return null;

  // Trim whitespace
  let cleaned = url.trim();

  // Must start with https://
  if (!cleaned.startsWith('https://')) return null;

  // Parse the URL safely
  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch (_) {
    return null;
  }

  // Protocol must be https (double-check after parsing)
  if (parsed.protocol !== 'https:') return null;

  // Hostname must be in the allowlist
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_IMAGE_DOMAINS.has(hostname)) return null;

  // Reject URLs with credentials (user:pass@host)
  if (parsed.username || parsed.password) return null;

  // Return the cleaned (re-serialized) URL to normalize it
  return parsed.href;
}

// Helper: save chips to account for a socket
function saveChipsForSocket(socketAccountMap, accounts, socketId, chips) {
  const key = socketAccountMap.get(socketId);
  if (!key) return;
  accounts.setChips(key, chips);
}

// Helper: save all players' chips in a card game lobby to their accounts
function saveAllLobbyChips(socketAccountMap, accounts, lobby) {
  if (!lobby) return;
  for (const [pid, p] of lobby.players) {
    saveChipsForSocket(socketAccountMap, accounts, pid, p.chips);
  }
}

/**
 * Enrich inventory with item info from loot module.
 */
function enrichInventory(accounts, loot, key) {
  var inv = accounts.getInventory(key);
  if (!inv) return { inventory: [], equipped: {} };
  var enriched = (inv.inventory || []).map(function(invItem) {
    var info = loot.getItemInfo(invItem.itemId);
    var rarityData = info && loot.RARITIES ? loot.RARITIES[info.rarity] : null;
    return {
      id: invItem.id,
      itemId: invItem.itemId,
      obtainedAt: invItem.obtainedAt,
      source: invItem.source,
      modifier: invItem.modifier || null,
      modifierInfo: invItem.modifier ? (loot.getModifierInfo ? loot.getModifierInfo(invItem.modifier) : null) : null,
      serial: invItem.serial || null,
      info: info ? { name: info.name, type: info.type, rarity: info.rarity, icon: info.icon || null, text: info.text || null, img: info.img || null, sellValue: loot.getSellValue(invItem.itemId, invItem.modifier), rarityColor: rarityData ? rarityData.color : '#888' } : null,
    };
  });
  return { inventory: enriched, equipped: inv.equipped };
}

/**
 * Process poker bot turns: if the current player is a bot, auto-play their action.
 * Recurses with a delay if the next player is also a bot.
 */
function processPokerBots(io, lobbyMgr, lobbyId, socketAccountMap, accounts) {
  const lobby = lobbyMgr.lobbies.get(lobbyId);
  if (!lobby || lobby.state !== 'playing') return;

  const currentPlayerId = lobby.currentTurn;
  if (!currentPlayerId || !currentPlayerId.startsWith('cardbot_')) return;

  // Helper: resolve socket by ID, compatible with both Server and Namespace.
  // On the Server: io.sockets is the default Namespace, io.sockets.sockets is the Map.
  // On a Namespace (e.g. /games): io.sockets IS already the Map.
  function getSocket(pid) {
    if (io.sockets && typeof io.sockets.get === 'function') {
      return io.sockets.get(pid);
    }
    return io.sockets && io.sockets.sockets && io.sockets.sockets.get(pid);
  }

  // Delay bot action slightly for realism
  setTimeout(() => {
    // Re-fetch lobby state in case it changed during the delay
    const freshLobby = lobbyMgr.lobbies.get(lobbyId);
    if (!freshLobby || freshLobby.state !== 'playing') return;
    if (freshLobby.currentTurn !== currentPlayerId) return;

    const action = lobbyMgr.getBotAction(lobbyId, currentPlayerId);
    if (!action) return;

    const result = lobbyMgr.playerAction(currentPlayerId, action.action, action.amount);
    if (!result) return;

    // Broadcast update to all human players in lobby
    for (const [pid] of freshLobby.players) {
      if (!pid.startsWith('cardbot_')) {
        const s = getSocket(pid);
        if (s) s.emit('card_lobby_update', lobbyMgr.getLobbyState(lobbyId, pid));
      }
    }

    // Save chips to accounts when round ends, THEN rebuy broke players
    if (freshLobby.state === 'waiting') {
      saveAllLobbyChips(socketAccountMap, accounts, freshLobby);
      lobbyMgr.rebuyBrokePlayers(freshLobby);
      // Re-broadcast with updated (rebuyed) chip counts
      for (const [pid] of freshLobby.players) {
        if (!pid.startsWith('cardbot_')) {
          const s = getSocket(pid);
          if (s) s.emit('card_lobby_update', lobbyMgr.getLobbyState(lobbyId, pid));
        }
      }
    }

    io.emit('card_lobbies_updated', { lobbies: lobbyMgr.getLobbies() });

    // If it's still a bot's turn (next player is also a bot), recurse
    processPokerBots(io, lobbyMgr, lobbyId, socketAccountMap, accounts);
  }, 800 + Math.random() * 1200); // 0.8-2 second delay
}

module.exports = {
  checkEventRate,
  checkEventRateStrict,
  sanitizeText,
  saveChipsForSocket,
  saveAllLobbyChips,
  enrichInventory,
  processPokerBots,
  validateUrl,
};
