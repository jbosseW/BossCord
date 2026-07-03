// cords.js — "Cords" posting/feed system for BossCord
// Short posts that auto-expire, with likes and replies.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashIdentifier(id) {
  if (!id || typeof id !== 'string') return null;
  return crypto.createHmac('sha256', process.env.TAG_HMAC_SECRET || 'bosscord-tag-v2')
    .update(id).digest('hex').slice(0, 16);
}

const DATA_DIR = path.join(__dirname, 'data');
const CORDS_FILE = path.join(DATA_DIR, 'cords.json');
const CORD_MAX_LENGTH = 1500;
const REPLY_MAX_LENGTH = 200;
const CORD_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours
const MAX_CORDS_PER_DAY = 30; // per user (by account key or socket id)
const MAX_REPLIES_PER_CORD = 100;
const PRUNE_INTERVAL_MS = 10 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(CORDS_FILE)) {
  fs.writeFileSync(CORDS_FILE, '[]', 'utf8');
}

// In-memory cache — eliminates blocking I/O on every operation
let _cordsCache = null;
let _cordsDirty = false;

function readCords() {
  if (_cordsCache !== null) return _cordsCache;
  try {
    const raw = fs.readFileSync(CORDS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    _cordsCache = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    _cordsCache = [];
  }
  return _cordsCache;
}

function writeCords(cords) {
  _cordsCache = cords;
  _cordsDirty = true;
}

function flushCords() {
  if (!_cordsDirty || !_cordsCache) return;
  _cordsDirty = false;
  fs.writeFile(CORDS_FILE, JSON.stringify(_cordsCache), 'utf8', function(err) {
    if (err) console.error('[cords] Flush error:', err.message);
  });
}

// Flush to disk every 5 seconds
setInterval(flushCords, 5000);

// One-time migration: convert raw account keys / socket IDs to hashed identifiers.
// Hashed IDs are exactly 16 hex chars; anything longer is a legacy raw value.
function migrateCordsIdentifiers() {
  var cords = readCords();
  var changed = false;
  for (var i = 0; i < cords.length; i++) {
    var c = cords[i];
    // Migrate authorId if it looks like a raw key (longer than 16 chars)
    if (c.authorId && c.authorId.length > 16) {
      c.authorId = hashIdentifier(c.authorId);
      changed = true;
    }
    // Migrate likedBy entries
    if (Array.isArray(c.likedBy)) {
      for (var j = 0; j < c.likedBy.length; j++) {
        if (c.likedBy[j] && c.likedBy[j].length > 16) {
          c.likedBy[j] = hashIdentifier(c.likedBy[j]);
          changed = true;
        }
      }
    }
    // Migrate reply authorIds
    if (Array.isArray(c.replies)) {
      for (var k = 0; k < c.replies.length; k++) {
        if (c.replies[k].authorId && c.replies[k].authorId.length > 16) {
          c.replies[k].authorId = hashIdentifier(c.replies[k].authorId);
          changed = true;
        }
      }
    }
    // Remove raw accountKey if present (legacy field)
    if (c.accountKey) {
      if (!c.accountKeyHash) {
        c.accountKeyHash = crypto.createHash('sha256').update(c.accountKey).digest('hex').slice(0, 16);
      }
      delete c.accountKey;
      changed = true;
    }
  }
  if (changed) {
    writeCords(cords);
    flushCords();
    console.log('[cords] Migrated legacy identifiers to hashed form');
  }
}
migrateCordsIdentifiers();

function pruneExpired() {
  const now = Date.now();
  const cords = readCords();
  const before = cords.length;
  const remaining = cords.filter(c => c && c.expiresAt > now);
  if (remaining.length !== before) {
    writeCords(remaining);
  }
  return remaining;
}

function getCordCount24h(authorId) {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const cords = readCords();
  var hashedAuthorId = hashIdentifier(authorId);
  return cords.filter(c => c.authorId === hashedAuthorId && c.createdAt > dayAgo).length;
}

function isValidImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    // Allow imgur
    if (/^(i\.)?imgur\.com$/.test(parsed.hostname) && /\.(jpg|jpeg|png|gif|gifv|webp|mp4)$/i.test(parsed.pathname)) return true;
    // Allow Tenor GIFs
    if (/^media\.tenor\.com$/.test(parsed.hostname)) return true;
    // Allow Giphy GIFs
    if (/^(media[0-9]*\.giphy\.com|i\.giphy\.com)$/.test(parsed.hostname)) return true;
    return false;
  } catch (e) { return false; }
}

function createCord(authorId, authorName, authorColor, content, accountKey, authorTag, imageUrl, authorAvatar) {
  if (!content || typeof content !== 'string') return null;
  content = content.trim().slice(0, CORD_MAX_LENGTH);
  if (content.length === 0 && !imageUrl) return null;

  // Validate image URL if provided (imgur, Tenor, Giphy)
  if (imageUrl && !isValidImageUrl(imageUrl)) {
    imageUrl = null;
  }

  // Rate limit
  const identifier = accountKey || authorId;
  if (getCordCount24h(identifier) >= MAX_CORDS_PER_DAY) {
    return { error: 'Daily cord limit reached (' + MAX_CORDS_PER_DAY + ' per day)' };
  }

  var keyHash = accountKey ? crypto.createHash('sha256').update(accountKey).digest('hex').slice(0, 16) : null;
  const cord = {
    id: crypto.randomUUID(),
    authorId: hashIdentifier(identifier),
    authorName: (authorName || 'Anon').slice(0, 20),
    authorColor: authorColor || '#f0b232',
    authorAvatar: authorAvatar || null,
    authorTag: authorTag || '????',
    accountKeyHash: keyHash,
    content,
    imageUrl: imageUrl || null,
    likes: 0,
    views: 0,
    likedBy: [],
    replies: [],
    createdAt: Date.now(),
    expiresAt: Date.now() + CORD_TTL_MS,
  };

  const cords = readCords();
  cords.push(cord);
  writeCords(cords);
  return cord;
}

function getFeed(page, limit) {
  page = Math.max(0, page || 0);
  limit = Math.min(50, Math.max(1, limit || 20));

  const cords = pruneExpired();
  // Sort newest first
  cords.sort((a, b) => b.createdAt - a.createdAt);

  const start = page * limit;
  const slice = cords.slice(start, start + limit);

  return {
    cords: slice.map(publicCordShape),
    total: cords.length,
    page,
    hasMore: start + limit < cords.length,
  };
}

function getCord(cordId) {
  const cords = readCords();
  const cord = cords.find(c => c.id === cordId);
  if (!cord) return null;
  if (cord.expiresAt <= Date.now()) return null;
  return publicCordShape(cord);
}

function likeCord(cordId, oderId) {
  const cords = readCords();
  const cord = cords.find(c => c.id === cordId);
  if (!cord || cord.expiresAt <= Date.now()) return null;

  if (!cord.likedBy) cord.likedBy = [];

  // Toggle like
  const hashedId = hashIdentifier(oderId);
  const idx = cord.likedBy.indexOf(hashedId);
  if (idx >= 0) {
    cord.likedBy.splice(idx, 1);
    cord.likes = Math.max(0, (cord.likes || 0) - 1);
  } else {
    cord.likedBy.push(hashedId);
    cord.likes = (cord.likes || 0) + 1;
  }

  writeCords(cords);
  return { likes: cord.likes, liked: idx < 0 };
}

function addReply(cordId, authorId, authorName, authorColor, content, accountKey, authorTag, imageUrl) {
  if (!content || typeof content !== 'string') return null;
  content = content.trim().slice(0, REPLY_MAX_LENGTH);
  if (content.length === 0 && !imageUrl) return null;

  // Validate image URL if provided
  if (imageUrl && !isValidImageUrl(imageUrl)) {
    imageUrl = null;
  }

  const cords = readCords();
  const cord = cords.find(c => c.id === cordId);
  if (!cord || cord.expiresAt <= Date.now()) return null;

  if (!cord.replies) cord.replies = [];
  if (cord.replies.length >= MAX_REPLIES_PER_CORD) {
    return { error: 'Max replies reached' };
  }

  const reply = {
    id: crypto.randomUUID(),
    authorId: hashIdentifier(accountKey || authorId),
    authorName: (authorName || 'Anon').slice(0, 20),
    authorColor: authorColor || '#f0b232',
    authorTag: authorTag || '????',
    content: content || '',
    imageUrl: imageUrl || null,
    createdAt: Date.now(),
  };

  cord.replies.push(reply);
  writeCords(cords);
  return reply;
}

function deleteCord(cordId, requesterId, force) {
  const cords = readCords();
  const idx = cords.findIndex(c => c.id === cordId);
  if (idx < 0) return false;
  // Only author can delete (unless moderator force)
  if (!force && cords[idx].authorId !== hashIdentifier(requesterId)) return false;
  cords.splice(idx, 1);
  writeCords(cords);
  return true;
}

// Optional moderator keys set — injected from socket.js
let _moderatorKeys = null;
function setModeratorKeys(keys) { _moderatorKeys = keys; }

function publicCordShape(cord) {
  return {
    id: cord.id,
    authorName: cord.authorName,
    authorColor: cord.authorColor,
    authorAvatar: cord.authorAvatar || null,
    authorTag: cord.authorTag || '????',
    hasAccount: !!cord.accountKeyHash,
    isMod: !!(cord.isMod),
    content: cord.content,
    imageUrl: cord.imageUrl || null,
    likes: cord.likes || 0,
    views: cord.views || 0,
    // NOTE: likedBy intentionally excluded — client only needs the count.
    replies: (cord.replies || []).map(r => ({
      id: r.id,
      authorName: r.authorName,
      authorColor: r.authorColor,
      authorTag: r.authorTag || '????',
      content: r.content,
      imageUrl: r.imageUrl || null,
      createdAt: r.createdAt,
    })),
    createdAt: cord.createdAt,
    expiresAt: cord.expiresAt,
  };
}

function viewCord(cordId) {
  const cords = readCords();
  const cord = cords.find(c => c.id === cordId);
  if (!cord || cord.expiresAt <= Date.now()) return null;
  cord.views = (cord.views || 0) + 1;
  writeCords(cords);
  return cord.views;
}

function deleteByAuthorId(authorId) {
  if (!authorId) return 0;
  var hashedId = hashIdentifier(authorId);
  const cords = readCords();
  const before = cords.length;
  const remaining = cords.filter(c => !(c.authorId === hashedId && !c.accountKeyHash));
  if (remaining.length !== before) {
    writeCords(remaining);
  }
  return before - remaining.length;
}

function deleteByAccount(accountKey) {
  if (!accountKey) return 0;
  var keyHash = crypto.createHash('sha256').update(accountKey).digest('hex').slice(0, 16);
  var hashedId = hashIdentifier(accountKey);
  const cords = readCords();
  const before = cords.length;
  const remaining = cords.filter(c => c.authorId !== hashedId && c.accountKeyHash !== keyHash);
  if (remaining.length !== before) {
    writeCords(remaining);
  }
  return before - remaining.length;
}

function reset() {
  _cordsCache = [];
  _cordsDirty = true;
  flushCords();
}

// Start periodic pruning
setInterval(pruneExpired, PRUNE_INTERVAL_MS);

module.exports = {
  createCord,
  getFeed,
  getCord,
  likeCord,
  viewCord,
  addReply,
  deleteCord,
  deleteByAuthorId,
  deleteByAccount,
  pruneExpired,
  reset,
  setModeratorKeys,
  publicCordShape,
  CORD_TTL_MS,
  MAX_CORDS_PER_DAY,
  CORD_MAX_LENGTH,
};
