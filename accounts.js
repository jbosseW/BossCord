// accounts.js — Optional persistent account system for BossCord
// File-per-account storage in data/accounts/{key}.json
// Accounts survive daily wipes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ACCOUNTS_DIR = path.join(__dirname, 'data', 'accounts');
const KEY_LENGTH = 12;
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; // no ambiguous chars

// ─── Multi-key encryption with rotation support ───
// Supports versioned encryption keys via /etc/bosscord/account_secrets.json
// Falls back to single ACCOUNT_SECRET env var for backward compatibility.
var ENCRYPTION_KEYS = []; // Array of { version: number, key: Buffer(32) }
var CURRENT_VERSION = 0;
var KEYS_FILE = process.env.BOSSCORD_KEYS_FILE || '/etc/bosscord/account_secrets.json';

try {
  if (fs.existsSync(KEYS_FILE)) {
    var _keysConfig = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    if (_keysConfig.keys && Array.isArray(_keysConfig.keys) && _keysConfig.keys.length > 0) {
      CURRENT_VERSION = typeof _keysConfig.current === 'number' ? _keysConfig.current : 0;
      for (var _ki = 0; _ki < _keysConfig.keys.length; _ki++) {
        var _entry = _keysConfig.keys[_ki];
        if (typeof _entry.version === 'number' && typeof _entry.secret === 'string') {
          ENCRYPTION_KEYS.push({
            version: _entry.version,
            key: crypto.createHash('sha256').update(_entry.secret).digest()
          });
        }
      }
      console.log('[accounts] Loaded ' + ENCRYPTION_KEYS.length + ' encryption keys, current version: ' + CURRENT_VERSION);
    }
  }
} catch (_keysErr) {
  console.error('[accounts] Failed to load ' + KEYS_FILE + ':', _keysErr.message);
}

// Fallback: single ACCOUNT_SECRET env var (version 0)
if (ENCRYPTION_KEYS.length === 0) {
  var _ACCOUNT_SECRET = process.env.ACCOUNT_SECRET || null;
  if (!_ACCOUNT_SECRET) {
    console.error('[accounts] FATAL: No ACCOUNT_SECRET environment variable set and no keys file found at ' + KEYS_FILE + '.');
    console.error('[accounts] Set the ACCOUNT_SECRET env var before starting the server.');
    console.error('[accounts] Example: ACCOUNT_SECRET=your-random-secret-here node server.js');
    process.exit(1);
  }
  ENCRYPTION_KEYS.push({
    version: 0,
    key: crypto.createHash('sha256').update(_ACCOUNT_SECRET).digest()
  });
  CURRENT_VERSION = 0;
}

function _getCurrentKey() {
  for (var i = 0; i < ENCRYPTION_KEYS.length; i++) {
    if (ENCRYPTION_KEYS[i].version === CURRENT_VERSION) return ENCRYPTION_KEYS[i];
  }
  return ENCRYPTION_KEYS[ENCRYPTION_KEYS.length - 1]; // fallback to last
}

function _getKeyByVersion(version) {
  for (var i = 0; i < ENCRYPTION_KEYS.length; i++) {
    if (ENCRYPTION_KEYS[i].version === version) return ENCRYPTION_KEYS[i];
  }
  return null;
}

// ─── Zero-knowledge key storage ───
// Runtime map: keyHash -> rawKey (populated when users log in, cleared on disconnect)
const keyHashMap = new Map();

function _keyHash(key) {
  return crypto.createHash('sha256').update(key.replace(/[^a-zA-Z0-9]/g, '')).digest('hex');
}

// ─── PIN hashing (scrypt, Node built-in) ───
const PIN_SALT_LEN = 16;
const PIN_KEY_LEN = 32;

function hashPin(pin) {
  return new Promise(function(resolve, reject) {
    var salt = crypto.randomBytes(PIN_SALT_LEN);
    crypto.scrypt(pin, salt, PIN_KEY_LEN, { N: 16384, r: 8, p: 1 }, function(err, hash) {
      if (err) return reject(err);
      resolve(salt.toString('hex') + ':' + hash.toString('hex'));
    });
  });
}

function verifyPin(pin, stored) {
  if (!pin || !stored || typeof stored !== 'string') return Promise.resolve(false);
  var parts = stored.split(':');
  if (parts.length !== 2) return Promise.resolve(false);
  try {
    var salt = Buffer.from(parts[0], 'hex');
    var expected = Buffer.from(parts[1], 'hex');
    if (salt.length !== PIN_SALT_LEN || expected.length !== PIN_KEY_LEN) return Promise.resolve(false);
    // Try multiple scrypt param sets to handle hashes from before param changes
    var paramSets = [
      { N: 16384, r: 8, p: 1 },  // current
      { N: 16384, r: 8, p: 2 },  // intermediate legacy
    ];
    return new Promise(function(resolve) {
      var idx = 0;
      function tryNext() {
        if (idx >= paramSets.length) return resolve(false);
        var params = paramSets[idx++];
        try {
          crypto.scrypt(pin, salt, PIN_KEY_LEN, params, function(err, hash) {
            if (!err && crypto.timingSafeEqual(hash, expected)) return resolve(true);
            tryNext();
          });
        } catch (_) { tryNext(); }
      }
      tryNext();
    });
  } catch (_) {
    return Promise.resolve(false);
  }
}

async function setPinForAccount(key, pin) {
  if (!pin || typeof pin !== 'string' || pin.length < 4 || pin.length > 8 || !/^[a-zA-Z0-9]+$/.test(pin)) return false;
  var acc = loadAccount(key);
  if (!acc) return false;
  acc.pinHash = await hashPin(pin);
  saveAccount(acc);
  return true;
}

// ─── AES-256-GCM encryption helpers ───

function _encryptData(plaintext) {
  var currentKey = _getCurrentKey();
  var iv = crypto.randomBytes(12); // 96-bit IV for GCM
  var cipher = crypto.createCipheriv('aes-256-gcm', currentKey.key, iv);
  var encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  var authTag = cipher.getAuthTag();
  if (CURRENT_VERSION === 0) {
    // Legacy format (no version prefix) for backward compatibility
    return Buffer.concat([iv, authTag, encrypted]);
  }
  // Versioned format: version(1) + iv(12) + authTag(16) + ciphertext
  var vByte = Buffer.alloc(1);
  vByte[0] = currentKey.version;
  return Buffer.concat([vByte, iv, authTag, encrypted]);
}

function _decryptData(buffer) {
  if (buffer.length < 29) return null; // 12 + 16 + 1 minimum

  // Strategy 1: Try versioned format (first byte = known version > 0)
  var firstByte = buffer[0];
  if (firstByte > 0 && buffer.length >= 30) {
    var vKey = _getKeyByVersion(firstByte);
    if (vKey) {
      try {
        var vIv = buffer.slice(1, 13);
        var vTag = buffer.slice(13, 29);
        var vCipher = buffer.slice(29);
        var vDecipher = crypto.createDecipheriv('aes-256-gcm', vKey.key, vIv);
        vDecipher.setAuthTag(vTag);
        var vDec = Buffer.concat([vDecipher.update(vCipher), vDecipher.final()]);
        return vDec.toString('utf8');
      } catch (_) { /* fall through to legacy */ }
    }
  }

  // Strategy 2: Legacy format (no version prefix) — try all keys newest-first
  for (var i = ENCRYPTION_KEYS.length - 1; i >= 0; i--) {
    try {
      var iv = buffer.slice(0, 12);
      var authTag = buffer.slice(12, 28);
      var ciphertext = buffer.slice(28);
      var decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEYS[i].key, iv);
      decipher.setAuthTag(authTag);
      var decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString('utf8');
    } catch (_) { continue; }
  }
  return null;
}

// In-memory store for temporary accounts (never written to disk)
const tempAccounts = new Map();

// ─── Tag index for O(1) friend lookups (Finding #9) ───
// Map<"username_lower:TAG", accountKey>
const tagIndex = new Map();

// ─── Write-behind cache for async I/O ───
const accountCache = new Map();
const CACHE_MAX = 5000;
const pendingWrites = new Map(); // key -> timeout handle

function _queueWrite(account) {
  const key = account.key;
  if (account.temp) return; // temps never hit disk
  // Update cache immediately
  accountCache.set(key, account);
  _evictCache();
  // Debounce disk write — at most once per 500ms per account
  if (pendingWrites.has(key)) clearTimeout(pendingWrites.get(key));
  pendingWrites.set(key, setTimeout(() => {
    pendingWrites.delete(key);
    const fp = accountPath(key);
    if (!fp) return;
    var scrubbed = _scrubForDisk(account);
    var jsonStr = JSON.stringify(scrubbed);
    var encrypted = _encryptData(jsonStr);
    fs.promises.writeFile(fp, encrypted)
      .catch(err => console.error('[accounts] Async write error:', err.message));
  }, 500));
}

// Evict oldest cache entries when over limit (Map iterates in insertion order)
function _evictCache() {
  if (accountCache.size <= CACHE_MAX) return;
  const iter = accountCache.keys();
  while (accountCache.size > CACHE_MAX * 0.8) {
    const oldest = iter.next().value;
    if (oldest) accountCache.delete(oldest);
    else break;
  }
}

// ─── Zero-knowledge scrub/restore for disk persistence ───

function _scrubForDisk(account) {
  // Create a deep copy to avoid mutating the in-memory object
  var copy = JSON.parse(JSON.stringify(account));
  // Replace raw key with hash
  if (copy.key) {
    copy.keyHash = _keyHash(copy.key);
    copy.tag = keyToTag(copy.key);
    delete copy.key;
  }
  // Hash friend keys
  if (copy.friends && Array.isArray(copy.friends)) {
    copy.friends = copy.friends.map(function(f) {
      var hashed = Object.assign({}, f);
      if (hashed.key) { hashed.keyHash = _keyHash(hashed.key); delete hashed.key; }
      return hashed;
    });
  }
  // Hash blocked keys
  if (copy.blocked && Array.isArray(copy.blocked)) {
    copy.blocked = copy.blocked.map(function(k) { return typeof k === 'string' && k.length < 64 ? _keyHash(k) : k; });
  }
  // Hash friend request keys
  if (copy.friendRequests) {
    if (copy.friendRequests.incoming && Array.isArray(copy.friendRequests.incoming)) {
      copy.friendRequests.incoming = copy.friendRequests.incoming.map(function(r) {
        var hashed = Object.assign({}, r);
        if (hashed.fromKey) { hashed.fromKeyHash = _keyHash(hashed.fromKey); delete hashed.fromKey; }
        return hashed;
      });
    }
    if (copy.friendRequests.outgoing && Array.isArray(copy.friendRequests.outgoing)) {
      copy.friendRequests.outgoing = copy.friendRequests.outgoing.map(function(r) {
        var hashed = Object.assign({}, r);
        if (hashed.toKey) { hashed.toKeyHash = _keyHash(hashed.toKey); delete hashed.toKey; }
        return hashed;
      });
    }
  }
  // Hash DM conversation keys
  if (copy.dms && copy.dms.conversations) {
    var newConvos = {};
    for (var convKey in copy.dms.conversations) {
      var hashedConvKey = convKey.length < 64 ? _keyHash(convKey) : convKey;
      newConvos[hashedConvKey] = copy.dms.conversations[convKey];
    }
    copy.dms.conversations = newConvos;
  }
  return copy;
}

function _restoreFromDisk(diskAccount, rawKey) {
  var account = JSON.parse(JSON.stringify(diskAccount));
  // Restore raw key
  account.key = rawKey;
  delete account.keyHash;
  // Restore friend keys from runtime keyHashMap
  if (account.friends && Array.isArray(account.friends)) {
    account.friends = account.friends.map(function(f) {
      if (f.keyHash && keyHashMap.has(f.keyHash)) {
        f.key = keyHashMap.get(f.keyHash);
        delete f.keyHash;
      } else if (f.keyHash) {
        // Friend not online — keep hash as placeholder, resolve later
        f.key = f.keyHash;
      }
      return f;
    });
  }
  // Restore blocked keys from runtime map
  if (account.blocked && Array.isArray(account.blocked)) {
    account.blocked = account.blocked.map(function(h) {
      return keyHashMap.has(h) ? keyHashMap.get(h) : h;
    });
  }
  // Restore friend request keys from runtime map
  if (account.friendRequests) {
    if (account.friendRequests.incoming && Array.isArray(account.friendRequests.incoming)) {
      account.friendRequests.incoming = account.friendRequests.incoming.map(function(r) {
        if (r.fromKeyHash) {
          r.fromKey = keyHashMap.has(r.fromKeyHash) ? keyHashMap.get(r.fromKeyHash) : r.fromKeyHash;
          delete r.fromKeyHash;
        }
        return r;
      });
    }
    if (account.friendRequests.outgoing && Array.isArray(account.friendRequests.outgoing)) {
      account.friendRequests.outgoing = account.friendRequests.outgoing.map(function(r) {
        if (r.toKeyHash) {
          r.toKey = keyHashMap.has(r.toKeyHash) ? keyHashMap.get(r.toKeyHash) : r.toKeyHash;
          delete r.toKeyHash;
        }
        return r;
      });
    }
  }
  // Restore DM conversation keys
  if (account.dms && account.dms.conversations) {
    var newConvos = {};
    for (var convHash in account.dms.conversations) {
      var realKey = keyHashMap.has(convHash) ? keyHashMap.get(convHash) : convHash;
      newConvos[realKey] = account.dms.conversations[convHash];
    }
    account.dms.conversations = newConvos;
  }
  return account;
}

// Force-flush all pending writes to disk (call on shutdown)
function flushAll() {
  for (const [key, timer] of pendingWrites) {
    clearTimeout(timer);
    pendingWrites.delete(key);
    const account = accountCache.get(key);
    if (!account || account.temp) continue;
    const fp = accountPath(key);
    if (!fp) continue;
    // Synchronous write on shutdown — must complete before exit
    try {
      var scrubbed = _scrubForDisk(account);
      var jsonStr = JSON.stringify(scrubbed);
      var encrypted = _encryptData(jsonStr);
      fs.writeFileSync(fp, encrypted);
    } catch (err) {
      console.error('[accounts] Flush write error for', key, ':', err.message);
    }
  }
}

// Safe sync existence check (used only for rare key-collision detection on create)
function _fileExistsSync(fp) {
  if (!fp) return false;
  try { fs.accessSync(fp); return true; } catch (_) { return false; }
}

const ACCOUNT_EXPIRY_DAYS = 60;
const ACCOUNT_EXPIRY_MS = ACCOUNT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
const MAX_CHIPS = 999999999; // ~1 billion cap

// Sanitize usernames — only letters, digits, and spaces (no special chars)
function sanitizeName(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[^a-zA-Z0-9 ]/g, '').trim();
}

// Tag generation: must match state.js generateTag() exactly
// Uses HMAC-SHA256 for deterministic but non-reversible tags
var TAG_ALPHANUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function keyToTag(key) {
  if (!key || typeof key !== 'string') return '????';
  var hmac = crypto.createHmac('sha256', process.env.TAG_HMAC_SECRET || 'bosscord-tag-v2').update(key).digest();
  var tag = '';
  for (var i = 0; i < 4; i++) {
    tag += TAG_ALPHANUM[hmac[i] % TAG_ALPHANUM.length];
  }
  return tag;
}

// Get 4-char discriminator from account key (safe to share publicly)
function getDiscriminator(key) {
  return keyToTag(key);
}

// Get user's friend tag: "Username#ABCD"
function getUserTag(key) {
  var acc = loadAccount(key);
  if (!acc) return null;
  return acc.username + '#' + keyToTag(key);
}

// Update tag index for an account
function _updateTagIndex(acc, rawKey) {
  if (!acc || acc.temp || !acc.username) return;
  var tag = acc.tag || (rawKey ? keyToTag(rawKey) : null);
  if (!tag) return;
  var indexKey = acc.username.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() + ':' + tag.toUpperCase();
  tagIndex.set(indexKey, rawKey || (acc.keyHash && keyHashMap.has(acc.keyHash) ? keyHashMap.get(acc.keyHash) : null));
}

// Find a permanent account by friend tag (Username#discriminator)
// Uses in-memory index for O(1) lookup; falls back to disk scan if index miss
function findAccountByTag(username, discriminator) {
  var normalized = (username || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  if (!normalized || !discriminator || discriminator.length < 4) return null;
  var disc = discriminator.toUpperCase();

  // O(1) index lookup
  var indexKey = normalized + ':' + disc;
  if (tagIndex.has(indexKey)) {
    var cachedKey = tagIndex.get(indexKey);
    if (cachedKey) return cachedKey;
  }

  // Fallback: full scan (populates index as it goes)
  var files;
  try { files = fs.readdirSync(ACCOUNTS_DIR); } catch (e) { return null; }

  var scanned = 0;
  var MAX_SCAN = 500;
  for (var i = 0; i < files.length; i++) {
    if (++scanned > MAX_SCAN) break;
    if (!files[i].endsWith('.json')) continue;
    var fp = path.join(ACCOUNTS_DIR, files[i]);
    try {
      var buf = fs.readFileSync(fp);
      var acc;
      try {
        var decrypted = _decryptData(buf);
        if (decrypted) acc = JSON.parse(decrypted);
      } catch (_) {}
      if (!acc) {
        try { acc = JSON.parse(buf.toString('utf8')); } catch (_) {}
      }
      if (!acc || acc.temp) continue;
      var tag = acc.tag || (acc.key ? keyToTag(acc.key) : null);
      // Populate index for future lookups
      if (acc.username && tag) {
        var ik = acc.username.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() + ':' + tag.toUpperCase();
        var resolvedKey = acc.key || (acc.keyHash && keyHashMap.has(acc.keyHash) ? keyHashMap.get(acc.keyHash) : null);
        tagIndex.set(ik, resolvedKey);
      }
      if (tag !== disc) continue;
      if (acc.username && acc.username.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim() === normalized) {
        if (acc.key) return acc.key;
        if (acc.keyHash && keyHashMap.has(acc.keyHash)) return keyHashMap.get(acc.keyHash);
        return null;
      }
    } catch (_) { continue; }
  }
  return null;
}

// Ensure directory exists
fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
if (ENCRYPTION_KEYS.length > 0) {
  console.log('[accounts] Encryption enabled (' + ENCRYPTION_KEYS.length + ' key(s), current version: ' + CURRENT_VERSION + ')');
}

// ─── Startup: pre-populate keyHashMap from all account files ───
// This allows friend key resolution to work immediately after restart
// without waiting for each user to log in.
(function _preloadKeyIndex() {
  try {
    var files = fs.readdirSync(ACCOUNTS_DIR).filter(function(f) { return f.endsWith('.json'); });
    var loaded = 0;
    for (var i = 0; i < files.length; i++) {
      var fp = path.join(ACCOUNTS_DIR, files[i]);
      try {
        var buf = fs.readFileSync(fp);
        var decrypted = _decryptData(buf);
        if (!decrypted) continue;
        var acc = JSON.parse(decrypted);
        // For hash-named files, we need some way to recover the raw key.
        // The raw key is NOT stored on disk (keyHash is stored instead).
        // But we CAN pre-populate the keyHash -> file mapping for future resolution.
        // Log pinHash status for debugging
        if (acc.keyHash) {
          console.log('[accounts-preload] file=' + files[i].slice(0, 8) + '... username=' + (acc.username || '?') + ' pinHash=' + (acc.pinHash ? 'SET' : 'NOT_SET'));
        }
        loaded++;
      } catch (e) { /* skip corrupt files */ }
    }
    if (loaded > 0) console.log('[accounts] Pre-loaded ' + loaded + ' account file(s) for diagnostics');
  } catch (e) {
    // data dir might not exist yet
  }
})();

function generateKey() {
  let key = '';
  // Rejection sampling to eliminate modulo bias
  const maxValid = 256 - (256 % KEY_CHARS.length);
  while (key.length < KEY_LENGTH) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < maxValid) {
      key += KEY_CHARS[byte % KEY_CHARS.length];
    }
  }
  return key;
}

function accountPath(key) {
  // Sanitize key to prevent directory traversal
  var safeKey = key.replace(/[^a-zA-Z0-9]/g, '');
  if (safeKey.length < 12) return null;
  var hash = crypto.createHash('sha256').update(safeKey).digest('hex');
  return path.join(ACCOUNTS_DIR, hash + '.json');
}

function _legacyAccountPath(key) {
  var safeKey = key.replace(/[^a-zA-Z0-9]/g, '');
  if (safeKey.length !== KEY_LENGTH) return null;
  return path.join(ACCOUNTS_DIR, safeKey + '.json');
}

function createAccount(username, color) {
  let key;
  let attempts = 0;
  do {
    key = generateKey();
    attempts++;
    if (attempts > 100) return null; // safety
  } while (accountCache.has(key) || _fileExistsSync(accountPath(key)));

  const account = {
    key,
    username: sanitizeName(username || 'Anon').slice(0, 20) || 'Anon',
    color: color || '#f0b232',
    chips: 1000,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    stats: {
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      highScore: 0,
      cordsPosted: 0,
    },
    slurFilter: false,
    favoriteGifs: [],
    uploads: [],
    metadata: {},
  };

  saveAccount(account);
  return account;
}

function createTempAccount(username, color) {
  let key;
  let attempts = 0;
  do {
    key = 'tmp_' + generateKey().slice(0, 9);
    attempts++;
    if (attempts > 100) return null;
  } while (tempAccounts.has(key));

  const account = {
    key,
    temp: true,
    username: sanitizeName(username || 'Anon').slice(0, 20) || 'Anon',
    color: color || '#f0b232',
    chips: 1000,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    stats: { gamesPlayed: 0, wins: 0, losses: 0, highScore: 0, cordsPosted: 0 },
    slurFilter: false,
    favoriteGifs: [],
    uploads: [],
    metadata: {},
  };
  tempAccounts.set(key, account);
  return account;
}

function promoteTempAccount(tempKey) {
  const temp = tempAccounts.get(tempKey);
  if (!temp) return null;

  // Generate a real permanent key
  let newKey;
  let attempts = 0;
  do {
    newKey = generateKey();
    attempts++;
    if (attempts > 100) return null;
  } while (accountCache.has(newKey) || _fileExistsSync(accountPath(newKey)));

  // Transfer all data to permanent account
  const permanent = Object.assign({}, temp, { key: newKey });
  delete permanent.temp;

  permanent.lastSeen = Date.now();
  // Cache immediately and queue async write
  accountCache.set(newKey, permanent);
  _queueWrite(permanent);

  // Remove from temp store
  tempAccounts.delete(tempKey);
  return permanent;
}

function isTempAccount(key) {
  return tempAccounts.has(key);
}

function isAccountExpired(account) {
  if (!account) return false;
  const lastActive = account.lastSeen || account.createdAt || 0;
  return (Date.now() - lastActive) > ACCOUNT_EXPIRY_MS;
}

function loadAccount(key) {
  if (!key || typeof key !== 'string') return null;
  // Check in-memory temp accounts first
  if (tempAccounts.has(key)) return tempAccounts.get(key);

  // Check write-behind cache
  if (accountCache.has(key)) {
    const cached = accountCache.get(key);
    if (isAccountExpired(cached)) {
      accountCache.delete(key);
      // Queue async deletion from disk
      const fp = accountPath(key);
      if (fp) fs.promises.unlink(fp).catch(() => {});
      return null;
    }
    return cached;
  }

  // Fall back to disk read
  const fp = accountPath(key);
  if (!fp) return null;

  try {
    var raw, account;
    if (fs.existsSync(fp)) {
      // New encrypted format
      var encBuf = fs.readFileSync(fp);
      var decrypted = _decryptData(encBuf);
      if (!decrypted) return null;
      account = JSON.parse(decrypted);
    } else {
      // Try legacy plaintext format for migration
      var legacyFp = _legacyAccountPath(key);
      if (!legacyFp || !fs.existsSync(legacyFp)) return null;
      raw = fs.readFileSync(legacyFp, 'utf8');
      account = JSON.parse(raw);
      // Migrate: scrub and write encrypted to new path, delete old file
      var scrubbed = _scrubForDisk(account);
      var jsonStr = JSON.stringify(scrubbed);
      var encrypted = _encryptData(jsonStr);
      fs.writeFileSync(fp, encrypted);
      fs.promises.unlink(legacyFp).catch(() => {});
      console.log('[accounts] Migrated account to encrypted storage: ' + key.slice(0, 3) + '...');
    }
    // Validate: either legacy format (raw key) or new format (keyHash)
    if (!account) return null;
    if (account.keyHash) {
      // New format: validate hash matches
      if (account.keyHash !== _keyHash(key)) return null;
      // Restore full account from disk format
      account = _restoreFromDisk(account, key);
    } else if (account.key !== key) {
      return null;
    }
    if (isAccountExpired(account)) {
      fs.promises.unlink(fp).catch(() => {});
      return null;
    }
    accountCache.set(key, account);
    keyHashMap.set(_keyHash(key), key);
    _updateTagIndex(account, key);
    _evictCache();
    return account;
  } catch (_) {
    return null;
  }
}

function saveAccount(account) {
  if (!account || !account.key) return false;
  account.lastSeen = Date.now();
  // Temp accounts stay in memory only
  if (account.temp) {
    tempAccounts.set(account.key, account);
    return true;
  }

  // Write-behind: update cache immediately, queue async disk write
  _queueWrite(account);
  keyHashMap.set(_keyHash(account.key), account.key);
  return true;
}

// ─── In-process chip lock to prevent TOCTOU race conditions ───
// Serializes chip operations per account key so concurrent async callers
// cannot interleave load-modify-save across await boundaries.
// The synchronous updateChips/setChips acquire the lock, perform the mutation
// synchronously (safe in single-threaded Node.js), and return the result.
// The lock also prevents interleaving if callers yield between operations.
const _chipLocks = new Map(); // key -> { queue: Promise, depth: number }

// Acquire a per-key lock. Returns a release function.
// In synchronous code, lock acquisition is non-blocking because Node.js is single-threaded.
function _acquireChipLock(key) {
  var entry = _chipLocks.get(key);
  if (!entry) {
    entry = { queue: Promise.resolve(), depth: 0 };
    _chipLocks.set(key, entry);
  }
  entry.depth++;
  return function release() {
    entry.depth--;
    if (entry.depth <= 0) {
      _chipLocks.delete(key);
    }
  };
}

function updateChips(key, amount) {
  if (typeof amount !== 'number' || !isFinite(amount) || isNaN(amount)) return null;
  var release = _acquireChipLock(key);
  try {
    const account = loadAccount(key);
    if (!account) return null;
    account.chips = Math.min(MAX_CHIPS, Math.max(0, (account.chips || 0) + amount));
    saveAccount(account);
    return account.chips;
  } finally {
    release();
  }
}

function setChips(key, amount) {
  var release = _acquireChipLock(key);
  try {
    const account = loadAccount(key);
    if (!account) return null;
    account.chips = Math.min(MAX_CHIPS, Math.max(0, amount));
    saveAccount(account);
    return account.chips;
  } finally {
    release();
  }
}

var ALLOWED_STAT_KEYS = new Set([
  'gamesPlayed', 'wins', 'losses', 'highScore', 'cordsPosted', 'cordsLiked',
  'messagesPosted', 'chipsWon', 'chipsLost', 'itemsCollected', 'tradesCompleted',
  'battlesWon', 'battlesLost', 'clickerClicks', 'giftsGiven', 'giftsReceived',
  'slotsPlayed', 'plinkoPlayed', 'scratchPlayed', 'lootboxOpened', 'coinFlipsPlayed',
  'pokerPlayed', 'blackjackPlayed', 'lieroPlayed', 'lieroWins', 'lieroKills',
]);

function updateStats(key, statUpdates) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.stats) account.stats = {};
  for (const [k, v] of Object.entries(statUpdates)) {
    if (!ALLOWED_STAT_KEYS.has(k)) continue;
    if (typeof v === 'number') {
      account.stats[k] = (account.stats[k] || 0) + v;
    } else {
      account.stats[k] = v;
    }
  }
  saveAccount(account);
  return account.stats;
}

function deleteAccount(key) {
  // Check temp accounts first
  if (tempAccounts.has(key)) {
    tempAccounts.delete(key);
    return true;
  }
  // Clear from cache and cancel pending writes
  accountCache.delete(key);
  if (pendingWrites.has(key)) {
    clearTimeout(pendingWrites.get(key));
    pendingWrites.delete(key);
  }
  const fp = accountPath(key);
  if (!fp) return false;
  // Async delete from disk
  fs.promises.unlink(fp).catch(() => {});
  // Also try deleting legacy path for migrated accounts
  var legacyFp = _legacyAccountPath(key);
  if (legacyFp) fs.promises.unlink(legacyFp).catch(() => {});
  return true;
}

function getPublicProfile(key) {
  const account = loadAccount(key);
  if (!account) return null;
  return {
    username: account.username,
    color: account.color,
    chips: account.chips,
    createdAt: account.createdAt,
    stats: account.stats || {},
  };
}

const MAX_FAVORITE_GIFS = 50;

function addFavoriteGif(key, gifUrl, previewUrl) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.favoriteGifs) account.favoriteGifs = [];
  // Don't duplicate
  if (account.favoriteGifs.some(g => g.url === gifUrl)) return account.favoriteGifs;
  account.favoriteGifs.unshift({ url: gifUrl, preview: previewUrl || gifUrl, addedAt: Date.now() });
  if (account.favoriteGifs.length > MAX_FAVORITE_GIFS) account.favoriteGifs.pop();
  saveAccount(account);
  return account.favoriteGifs;
}

function removeFavoriteGif(key, gifUrl) {
  const account = loadAccount(key);
  if (!account || !account.favoriteGifs) return null;
  account.favoriteGifs = account.favoriteGifs.filter(g => g.url !== gifUrl);
  saveAccount(account);
  return account.favoriteGifs;
}

function getFavoriteGifs(key) {
  const account = loadAccount(key);
  if (!account) return [];
  return account.favoriteGifs || [];
}

// Cache leaderboard to avoid scanning disk every request
let _leaderboardCache = null;
let _leaderboardCacheTime = 0;
const LEADERBOARD_CACHE_MS = 30 * 1000; // refresh every 30 seconds
let _leaderboardRefreshing = false;

// Non-blocking async leaderboard refresh
function _refreshLeaderboardAsync() {
  if (_leaderboardRefreshing) return;
  _leaderboardRefreshing = true;
  fs.promises.readdir(ACCOUNTS_DIR).then(files => {
    files = files.filter(f => f.endsWith('.json'));
    return Promise.all(files.map(f => {
      var fp = path.join(ACCOUNTS_DIR, f);
      return fs.promises.readFile(fp).then(buf => {
        var acc;
        // Try encrypted format first
        try {
          var decrypted = _decryptData(buf);
          if (decrypted) acc = JSON.parse(decrypted);
        } catch (_) {}
        // Fallback: plaintext JSON
        if (!acc) {
          try { acc = JSON.parse(buf.toString('utf8')); } catch (_) {}
        }
        if (!acc) return null;
        return { data: acc, key: acc.key || null, tag: acc.tag || (acc.key ? keyToTag(acc.key) : null) };
      }).catch(() => null);
    }));
  }).then(results => {
    const entries = results.filter(Boolean).map(r => ({
      username: r.data.username || 'Anon',
      color: r.data.color || '#f0b232',
      avatar: r.data.avatar || null,
      chips: r.data.chips || 0,
      stats: r.data.stats || {},
      tag: r.tag || (r.key ? keyToTag(r.key) : '????'),
      createdAt: r.data.createdAt,
      lastSeen: r.data.lastSeen,
    }));
    entries.sort((a, b) => b.chips - a.chips);
    _leaderboardCache = entries;
    _leaderboardCacheTime = Date.now();
  }).catch(err => {
    console.error('[accounts] Leaderboard refresh error:', err.message);
  }).finally(() => {
    _leaderboardRefreshing = false;
  });
}

function getLeaderboard(limit) {
  limit = limit || 50;
  const now = Date.now();
  if (_leaderboardCache && now - _leaderboardCacheTime < LEADERBOARD_CACHE_MS) {
    return _leaderboardCache.slice(0, limit);
  }
  // Trigger non-blocking refresh in the background
  _refreshLeaderboardAsync();
  // Return stale data if available, otherwise empty
  return _leaderboardCache ? _leaderboardCache.slice(0, limit) : [];
}

// ─── Inventory management ───

const MAX_INVENTORY = 200;

function addInventoryItem(key, instanceItem) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.inventory) account.inventory = [];
  if (account.inventory.length >= MAX_INVENTORY) return { error: 'Inventory full' };
  account.inventory.push({
    id: instanceItem.instanceId,
    itemId: instanceItem.itemId,
    modifier: instanceItem.modifier || null,
    serial: instanceItem.serial || null,
    obtainedAt: instanceItem.obtainedAt || Date.now(),
    source: instanceItem.source || 'unknown',
  });
  saveAccount(account);
  return account.inventory;
}

function removeInventoryItem(key, instanceId) {
  const account = loadAccount(key);
  if (!account || !account.inventory) return null;
  const idx = account.inventory.findIndex(i => i.id === instanceId);
  if (idx === -1) return null;
  const removed = account.inventory.splice(idx, 1)[0];
  // Unequip if this item was equipped
  if (account.equipped) {
    if (account.equipped.badge === removed.itemId) account.equipped.badge = null;
    if (account.equipped.title === removed.itemId) account.equipped.title = null;
  }
  saveAccount(account);
  return removed;
}

function equipItem(key, instanceId) {
  const account = loadAccount(key);
  if (!account || !account.inventory) return null;
  const invItem = account.inventory.find(i => i.id === instanceId);
  if (!invItem) return null;
  if (!account.equipped) account.equipped = { badge: null, title: null };
  // Determine type from itemId prefix
  if (invItem.itemId.startsWith('badge_')) {
    account.equipped.badge = invItem.itemId;
  } else if (invItem.itemId.startsWith('title_')) {
    account.equipped.title = invItem.itemId;
  } else {
    return null; // collectibles can't be equipped
  }
  saveAccount(account);
  return account.equipped;
}

function unequipItem(key, type) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.equipped) account.equipped = { badge: null, title: null };
  if (type === 'badge') account.equipped.badge = null;
  else if (type === 'title') account.equipped.title = null;
  else return null;
  saveAccount(account);
  return account.equipped;
}

function getInventory(key) {
  const account = loadAccount(key);
  if (!account) return { inventory: [], equipped: { badge: null, title: null } };
  return {
    inventory: account.inventory || [],
    equipped: account.equipped || { badge: null, title: null },
  };
}

// ─── TCG Card collection ───

const MAX_CARDS = 500;

function addCard(key, cardInstance) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!account.cards) account.cards = [];
  if (account.cards.length >= MAX_CARDS) return { error: 'Card collection full (' + MAX_CARDS + ' max)' };
  account.cards.push({
    id: cardInstance.instanceId,
    cardId: cardInstance.cardId,
    rolledStats: cardInstance.rolledStats || null,
    shiny: cardInstance.shiny || false,
    obtainedAt: cardInstance.obtainedAt || Date.now(),
    source: cardInstance.source || 'unknown',
  });
  saveAccount(account);
  return account.cards;
}

function removeCard(key, instanceId) {
  const account = loadAccount(key);
  if (!account || !account.cards) return null;
  const idx = account.cards.findIndex(c => c.id === instanceId);
  if (idx === -1) return null;
  const removed = account.cards.splice(idx, 1)[0];
  saveAccount(account);
  return removed;
}

function getCards(key) {
  const account = loadAccount(key);
  if (!account) return [];
  return account.cards || [];
}

// ─── Showcase favorites (items user wants to show off) ───

const MAX_SHOWCASE = 6;

function setShowcase(key, showcaseItems) {
  const account = loadAccount(key);
  if (!account) return null;
  // Validate: only allow strings or numbers in showcase array
  var safe = [];
  var items = (showcaseItems || []).slice(0, MAX_SHOWCASE);
  for (var i = 0; i < items.length; i++) {
    if (typeof items[i] === 'string' || typeof items[i] === 'number') {
      safe.push(items[i]);
    }
  }
  account.showcase = safe;
  saveAccount(account);
  return account.showcase;
}

function getShowcase(key) {
  const account = loadAccount(key);
  if (!account) return [];
  return account.showcase || [];
}

// ─── Clicker idle game state ───

function _safeNum(val, fallback) {
  if (typeof val !== 'number' || !isFinite(val) || isNaN(val)) return fallback;
  return val;
}

function updateClickerState(key, state) {
  const account = loadAccount(key);
  if (!account) return null;
  // Sanitize: only allow known fields, reject non-plain objects
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  if (Object.getPrototypeOf(state) !== Object.prototype && Object.getPrototypeOf(state) !== null) return null;
  // Sanitize levels: only allow safe keys with finite numeric values, cap at 50 entries
  var safeLevels = Object.create(null);
  if (state.levels && typeof state.levels === 'object' && !Array.isArray(state.levels)) {
    var levelKeys = Object.keys(state.levels);
    for (var i = 0; i < Math.min(levelKeys.length, 50); i++) {
      var lk = levelKeys[i];
      if (typeof lk === 'string' && /^[a-zA-Z0-9_]+$/.test(lk) && typeof state.levels[lk] === 'number' && isFinite(state.levels[lk])) {
        safeLevels[lk] = Math.max(0, Math.floor(state.levels[lk]));
      }
    }
  }
  account.clickerState = {
    chips: _safeNum(state.chips, 0),
    levels: safeLevels,
    totalClicks: _safeNum(state.totalClicks, 0),
    totalEarned: _safeNum(state.totalEarned, 0),
    lastSaveTime: Date.now(),
    _collectDay: typeof state._collectDay === 'string' ? state._collectDay.slice(0, 10) : null,
    _collectTotal: _safeNum(state._collectTotal, 0),
    lastInterestDate: typeof state.lastInterestDate === 'string' ? state.lastInterestDate.slice(0, 10) : null,
  };
  saveAccount(account);
  return account.clickerState;
}

function getClickerState(key) {
  const account = loadAccount(key);
  if (!account) return null;
  return account.clickerState || null;
}

// ─── Slot Upgrades ───

function getSlotUpgrades(key) {
  const account = loadAccount(key);
  return account ? (account.slotUpgrades || {}) : {};
}

function updateSlotUpgrades(key, upgrades) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!upgrades || typeof upgrades !== 'object' || Array.isArray(upgrades)) return null;
  var safe = {};
  var keys = Object.keys(upgrades);
  for (var i = 0; i < Math.min(keys.length, 50); i++) {
    var k = keys[i];
    if (typeof k === 'string' && /^[a-zA-Z0-9_]+$/.test(k) && typeof upgrades[k] === 'number') {
      safe[k] = Math.max(0, Math.floor(upgrades[k]));
    }
  }
  account.slotUpgrades = safe;
  saveAccount(account);
  return safe;
}

// ─── Scratch Upgrades ───

function getScratchUpgrades(key) {
  const account = loadAccount(key);
  return account ? (account.scratchUpgrades || {}) : {};
}

function updateScratchUpgrades(key, upgrades) {
  const account = loadAccount(key);
  if (!account) return null;
  if (!upgrades || typeof upgrades !== 'object' || Array.isArray(upgrades)) return null;
  var safe = {};
  var keys = Object.keys(upgrades);
  for (var i = 0; i < Math.min(keys.length, 50); i++) {
    var k = keys[i];
    if (typeof k === 'string' && /^[a-zA-Z0-9_]+$/.test(k) && typeof upgrades[k] === 'number') {
      safe[k] = Math.max(0, Math.floor(upgrades[k]));
    }
  }
  account.scratchUpgrades = safe;
  saveAccount(account);
  return safe;
}

// ─── Friends system ───

const MAX_FRIENDS = 100;
const MAX_FRIEND_REQUESTS = 50;
const MAX_BLOCKED = 200;

function _ensureFriendsData(account) {
  if (!account.friends) account.friends = [];
  if (!account.friendRequests) account.friendRequests = { incoming: [], outgoing: [] };
  if (!account.blocked) account.blocked = [];
}

// Compare a stored key (which may be a SHA-256 hash placeholder after restart)
// against a real key. Returns true if they match directly or via hash.
function _keyMatches(storedKey, realKey) {
  if (storedKey === realKey) return true;
  // If storedKey is a 64-char hex hash, compare against hash of realKey
  if (storedKey && storedKey.length === 64 && /^[a-f0-9]{64}$/.test(storedKey)) {
    return storedKey === _keyHash(realKey);
  }
  return false;
}

// Clean up stale hash entries: replace hash placeholders with real keys in friend data.
// Called after acceptFriendRequest/sendFriendRequest to fix hash-based entries.
function _resolveHashEntries(account, realKey) {
  var hash = _keyHash(realKey);
  if (account.friends) {
    for (var i = 0; i < account.friends.length; i++) {
      if (account.friends[i].key === hash) account.friends[i].key = realKey;
    }
  }
  if (account.friendRequests) {
    if (account.friendRequests.incoming) {
      for (var j = 0; j < account.friendRequests.incoming.length; j++) {
        if (account.friendRequests.incoming[j].fromKey === hash) account.friendRequests.incoming[j].fromKey = realKey;
      }
    }
    if (account.friendRequests.outgoing) {
      for (var k = 0; k < account.friendRequests.outgoing.length; k++) {
        if (account.friendRequests.outgoing[k].toKey === hash) account.friendRequests.outgoing[k].toKey = realKey;
      }
    }
  }
  if (account.blocked) {
    for (var b = 0; b < account.blocked.length; b++) {
      if (account.blocked[b] === hash) account.blocked[b] = realKey;
    }
  }
}

function sendFriendRequest(fromKey, toKey) {
  if (fromKey === toKey) return { error: 'Cannot friend yourself' };

  const fromAcc = loadAccount(fromKey);
  const toAcc = loadAccount(toKey);
  if (!fromAcc || !toAcc) return { error: 'Account not found' };
  if (fromAcc.temp || toAcc.temp) return { error: 'Permanent account required' };

  _ensureFriendsData(fromAcc);
  _ensureFriendsData(toAcc);

  // Resolve any hash placeholders now that we have both real keys
  _resolveHashEntries(fromAcc, toKey);
  _resolveHashEntries(toAcc, fromKey);

  // Check blocks (bidirectional)
  if (fromAcc.blocked.some(function(b) { return _keyMatches(b, toKey); })) return { error: 'User is blocked' };
  if (toAcc.blocked.some(function(b) { return _keyMatches(b, fromKey); })) return { error: 'Cannot send request' };

  // Already friends?
  if (fromAcc.friends.some(function(f) { return _keyMatches(f.key, toKey); })) return { error: 'Already friends' };

  // Already pending?
  if (fromAcc.friendRequests.outgoing.some(function(r) { return _keyMatches(r.toKey, toKey); })) return { error: 'Request already sent' };

  // Check limits
  if (fromAcc.friends.length >= MAX_FRIENDS) return { error: 'Your friend list is full' };
  if (fromAcc.friendRequests.outgoing.length >= MAX_FRIEND_REQUESTS) return { error: 'Too many pending requests' };

  // If target already sent us a request, auto-accept
  if (toAcc.friendRequests.outgoing.some(function(r) { return _keyMatches(r.toKey, fromKey); })) {
    return acceptFriendRequest(fromKey, toKey);
  }

  // Add to sender's outgoing
  fromAcc.friendRequests.outgoing.push({ toKey: toKey, sentAt: Date.now() });
  saveAccount(fromAcc);

  // Add to receiver's incoming
  toAcc.friendRequests.incoming.push({ fromKey: fromKey, fromUsername: fromAcc.username, sentAt: Date.now() });
  saveAccount(toAcc);

  return { success: true };
}

function acceptFriendRequest(accepterKey, requesterKey) {
  var accepter = loadAccount(accepterKey);
  var requester = loadAccount(requesterKey);
  if (!accepter || !requester) return { error: 'Account not found' };

  _ensureFriendsData(accepter);
  _ensureFriendsData(requester);

  // Resolve hash placeholders now that we have both real keys
  _resolveHashEntries(accepter, requesterKey);
  _resolveHashEntries(requester, accepterKey);

  // Verify request exists (incoming on accepter or outgoing on requester)
  var hasIncoming = accepter.friendRequests.incoming.some(function(r) { return r.fromKey === requesterKey; });
  var hasOutgoing = requester.friendRequests.outgoing.some(function(r) { return r.toKey === accepterKey; });
  if (!hasIncoming && !hasOutgoing) return { error: 'No pending request' };

  // Check limits
  if (accepter.friends.length >= MAX_FRIENDS) return { error: 'Your friend list is full' };
  if (requester.friends.length >= MAX_FRIENDS) return { error: 'Their friend list is full' };

  var now = Date.now();
  // Add to both friends lists (prevent duplicates)
  if (!accepter.friends.some(function(f) { return f.key === requesterKey; })) {
    accepter.friends.push({ key: requesterKey, addedAt: now });
  }
  if (!requester.friends.some(function(f) { return f.key === accepterKey; })) {
    requester.friends.push({ key: accepterKey, addedAt: now });
  }

  // Remove from all pending requests (both directions)
  accepter.friendRequests.incoming = accepter.friendRequests.incoming.filter(function(r) { return r.fromKey !== requesterKey; });
  accepter.friendRequests.outgoing = accepter.friendRequests.outgoing.filter(function(r) { return r.toKey !== requesterKey; });
  requester.friendRequests.outgoing = requester.friendRequests.outgoing.filter(function(r) { return r.toKey !== accepterKey; });
  requester.friendRequests.incoming = requester.friendRequests.incoming.filter(function(r) { return r.fromKey !== accepterKey; });

  saveAccount(accepter);
  saveAccount(requester);

  return { success: true, accepterName: accepter.username, requesterName: requester.username };
}

function rejectFriendRequest(rejecterKey, requesterKey) {
  var rejecter = loadAccount(rejecterKey);
  if (!rejecter) return { error: 'Account not found' };

  _ensureFriendsData(rejecter);
  _resolveHashEntries(rejecter, requesterKey);
  rejecter.friendRequests.incoming = rejecter.friendRequests.incoming.filter(function(r) { return r.fromKey !== requesterKey; });
  saveAccount(rejecter);

  var requester = loadAccount(requesterKey);
  if (requester) {
    _ensureFriendsData(requester);
    _resolveHashEntries(requester, rejecterKey);
    requester.friendRequests.outgoing = requester.friendRequests.outgoing.filter(function(r) { return r.toKey !== rejecterKey; });
    saveAccount(requester);
  }

  return { success: true };
}

function removeFriend(removerKey, friendKey) {
  var remover = loadAccount(removerKey);
  if (!remover) return { error: 'Account not found' };

  _ensureFriendsData(remover);
  _resolveHashEntries(remover, friendKey);
  remover.friends = remover.friends.filter(function(f) { return f.key !== friendKey; });
  saveAccount(remover);

  var friend = loadAccount(friendKey);
  if (friend) {
    _ensureFriendsData(friend);
    _resolveHashEntries(friend, removerKey);
    friend.friends = friend.friends.filter(function(f) { return f.key !== removerKey; });
    saveAccount(friend);
  }

  return { success: true };
}

function blockUser(blockerKey, targetKey) {
  if (blockerKey === targetKey) return { error: 'Cannot block yourself' };
  var blocker = loadAccount(blockerKey);
  if (!blocker) return { error: 'Account not found' };

  _ensureFriendsData(blocker);
  _resolveHashEntries(blocker, targetKey);

  if (blocker.blocked.includes(targetKey)) return { error: 'Already blocked' };
  if (blocker.blocked.length >= MAX_BLOCKED) return { error: 'Block list full' };

  blocker.blocked.push(targetKey);

  // Remove from friends if they were friends
  blocker.friends = blocker.friends.filter(function(f) { return f.key !== targetKey; });
  // Cancel any pending requests
  blocker.friendRequests.incoming = blocker.friendRequests.incoming.filter(function(r) { return r.fromKey !== targetKey; });
  blocker.friendRequests.outgoing = blocker.friendRequests.outgoing.filter(function(r) { return r.toKey !== targetKey; });
  saveAccount(blocker);

  // Remove from the other side too
  var target = loadAccount(targetKey);
  if (target) {
    _ensureFriendsData(target);
    _resolveHashEntries(target, blockerKey);
    target.friends = target.friends.filter(function(f) { return f.key !== blockerKey; });
    target.friendRequests.incoming = target.friendRequests.incoming.filter(function(r) { return r.fromKey !== blockerKey; });
    target.friendRequests.outgoing = target.friendRequests.outgoing.filter(function(r) { return r.toKey !== blockerKey; });
    saveAccount(target);
  }

  return { success: true };
}

function unblockUser(blockerKey, targetKey) {
  var blocker = loadAccount(blockerKey);
  if (!blocker) return { error: 'Account not found' };

  _ensureFriendsData(blocker);
  blocker.blocked = blocker.blocked.filter(function(k) { return k !== targetKey; });
  saveAccount(blocker);

  return { success: true };
}

// Try to resolve a key that might be a hash placeholder back to a real key
function _tryResolveKey(keyOrHash) {
  if (!keyOrHash) return keyOrHash;
  // If it's a 64-char hex string, it's likely a hash — try keyHashMap
  if (keyOrHash.length === 64 && /^[a-f0-9]{64}$/.test(keyOrHash)) {
    return keyHashMap.has(keyOrHash) ? keyHashMap.get(keyOrHash) : keyOrHash;
  }
  return keyOrHash;
}

function getFriendsData(key) {
  var acc = loadAccount(key);
  if (!acc) return { friends: [], incoming: [], outgoing: [], blocked: [] };

  _ensureFriendsData(acc);

  // Resolve hash placeholders to real keys where possible (fixes "Unknown" after restart)
  var dirty = false;
  for (var fi = 0; fi < acc.friends.length; fi++) {
    var resolved = _tryResolveKey(acc.friends[fi].key);
    if (resolved !== acc.friends[fi].key) { acc.friends[fi].key = resolved; dirty = true; }
  }
  if (acc.friendRequests.incoming) {
    for (var ii = 0; ii < acc.friendRequests.incoming.length; ii++) {
      var rIn = _tryResolveKey(acc.friendRequests.incoming[ii].fromKey);
      if (rIn !== acc.friendRequests.incoming[ii].fromKey) { acc.friendRequests.incoming[ii].fromKey = rIn; dirty = true; }
    }
  }
  if (acc.friendRequests.outgoing) {
    for (var oi = 0; oi < acc.friendRequests.outgoing.length; oi++) {
      var rOut = _tryResolveKey(acc.friendRequests.outgoing[oi].toKey);
      if (rOut !== acc.friendRequests.outgoing[oi].toKey) { acc.friendRequests.outgoing[oi].toKey = rOut; dirty = true; }
    }
  }
  if (dirty) saveAccount(acc);

  var friends = acc.friends.map(function(f) {
    var profile = getPublicProfile(f.key);
    return {
      key: f.key,
      username: profile ? profile.username : 'Unknown',
      color: profile ? profile.color : '#999',
      chips: profile ? profile.chips : 0,
      addedAt: f.addedAt,
      online: false, // caller fills this in via socketAccountMap
    };
  });

  var incoming = acc.friendRequests.incoming.map(function(r) {
    var profile = getPublicProfile(r.fromKey);
    return {
      key: r.fromKey,
      username: profile ? profile.username : r.fromUsername || 'Unknown',
      color: profile ? profile.color : '#999',
      sentAt: r.sentAt,
    };
  });

  var outgoing = acc.friendRequests.outgoing.map(function(r) {
    var profile = getPublicProfile(r.toKey);
    return {
      key: r.toKey,
      username: profile ? profile.username : 'Unknown',
      color: profile ? profile.color : '#999',
      sentAt: r.sentAt,
    };
  });

  return { friends: friends, incoming: incoming, outgoing: outgoing, blocked: acc.blocked || [] };
}

// ─── E2E Encrypted Direct Messages ───

const MAX_DM_CONVERSATIONS = 50;
const MAX_DM_MESSAGES = 100;

function _ensureDMData(account) {
  if (!account.dms) account.dms = { conversations: {} };
  if (!account.dms.conversations) account.dms.conversations = {};
}

function setPublicKey(key, publicKeyBase64, version) {
  var account = loadAccount(key);
  if (!account) return { error: 'Account not found' };
  if (account.temp) return { error: 'Permanent account required' };
  if (typeof publicKeyBase64 !== 'string' || publicKeyBase64.length < 20 || publicKeyBase64.length > 500) {
    return { error: 'Invalid public key' };
  }

  // Migrate legacy e2ePublicKey to new e2eKeys format if needed
  if (!account.e2eKeys && account.e2ePublicKey) {
    account.e2eKeys = {
      current: {
        key: account.e2ePublicKey,
        version: 0,
        created: account.lastSeen || Date.now()
      },
      previous: null
    };
    delete account.e2ePublicKey;
  }

  // Initialize e2eKeys if this is the first key ever set
  if (!account.e2eKeys) {
    var newVersion = (typeof version === 'number' && version > 0) ? version : 1;
    account.e2eKeys = {
      current: {
        key: publicKeyBase64,
        version: newVersion,
        created: Date.now()
      },
      previous: null
    };
    saveAccount(account);
    return { success: true, version: newVersion };
  }

  // Rotate: current becomes previous, new key becomes current
  var nextVersion = (typeof version === 'number' && version > 0)
    ? version
    : (account.e2eKeys.current ? account.e2eKeys.current.version + 1 : 1);

  // Don't rotate if the key is identical to the current one (re-registration on reconnect)
  if (account.e2eKeys.current && account.e2eKeys.current.key === publicKeyBase64) {
    saveAccount(account);
    return { success: true, version: account.e2eKeys.current.version };
  }

  account.e2eKeys.previous = account.e2eKeys.current ? {
    key: account.e2eKeys.current.key,
    version: account.e2eKeys.current.version,
    created: account.e2eKeys.current.created
  } : null;

  account.e2eKeys.current = {
    key: publicKeyBase64,
    version: nextVersion,
    created: Date.now()
  };

  // Clean up legacy field if it still exists
  if (account.e2ePublicKey) delete account.e2ePublicKey;

  saveAccount(account);
  return { success: true, version: nextVersion };
}

function getPublicKeyE2E(key) {
  var account = loadAccount(key);
  if (!account) return null;

  // New versioned format
  if (account.e2eKeys && account.e2eKeys.current) {
    var result = {
      key: account.e2eKeys.current.key,
      version: account.e2eKeys.current.version,
      previousKey: null,
      previousVersion: null
    };
    if (account.e2eKeys.previous) {
      result.previousKey = account.e2eKeys.previous.key;
      result.previousVersion = account.e2eKeys.previous.version;
    }
    return result;
  }

  // Legacy fallback: old e2ePublicKey field
  if (account.e2ePublicKey) {
    return {
      key: account.e2ePublicKey,
      version: 0,
      previousKey: null,
      previousVersion: null
    };
  }

  return null;
}

function storeDM(fromKey, toKey, messageObj) {
  var fromAcc = loadAccount(fromKey);
  var toAcc = loadAccount(toKey);
  if (!fromAcc || !toAcc) return { error: 'Account not found' };
  if (fromAcc.temp || toAcc.temp) return { error: 'Permanent account required' };

  _ensureDMData(fromAcc);
  _ensureDMData(toAcc);

  // Store on sender's account
  var fromConvos = fromAcc.dms.conversations;
  if (!fromConvos[toKey]) {
    var fromConvoKeys = Object.keys(fromConvos);
    if (fromConvoKeys.length >= MAX_DM_CONVERSATIONS) {
      var oldest = null;
      var oldestTime = Infinity;
      for (var i = 0; i < fromConvoKeys.length; i++) {
        var la = fromConvos[fromConvoKeys[i]].lastActivity || 0;
        if (la < oldestTime) { oldestTime = la; oldest = fromConvoKeys[i]; }
      }
      if (oldest) delete fromConvos[oldest];
    }
    fromConvos[toKey] = { messages: [], lastActivity: 0 };
  }
  fromConvos[toKey].messages.push(messageObj);
  if (fromConvos[toKey].messages.length > MAX_DM_MESSAGES) {
    fromConvos[toKey].messages = fromConvos[toKey].messages.slice(-MAX_DM_MESSAGES);
  }
  fromConvos[toKey].lastActivity = messageObj.timestamp || Date.now();
  saveAccount(fromAcc);

  // Store on recipient's account
  var toConvos = toAcc.dms.conversations;
  if (!toConvos[fromKey]) {
    var toConvoKeys = Object.keys(toConvos);
    if (toConvoKeys.length >= MAX_DM_CONVERSATIONS) {
      var oldestTo = null;
      var oldestTimeTo = Infinity;
      for (var j = 0; j < toConvoKeys.length; j++) {
        var laTo = toConvos[toConvoKeys[j]].lastActivity || 0;
        if (laTo < oldestTimeTo) { oldestTimeTo = laTo; oldestTo = toConvoKeys[j]; }
      }
      if (oldestTo) delete toConvos[oldestTo];
    }
    toConvos[fromKey] = { messages: [], lastActivity: 0 };
  }
  toConvos[fromKey].messages.push(messageObj);
  if (toConvos[fromKey].messages.length > MAX_DM_MESSAGES) {
    toConvos[fromKey].messages = toConvos[fromKey].messages.slice(-MAX_DM_MESSAGES);
  }
  toConvos[fromKey].lastActivity = messageObj.timestamp || Date.now();
  saveAccount(toAcc);

  return { success: true };
}

function getDMHistory(key, otherKey, limit) {
  var account = loadAccount(key);
  if (!account) return [];
  _ensureDMData(account);
  var convo = account.dms.conversations[otherKey];
  if (!convo || !convo.messages) return [];
  var lim = (typeof limit === 'number' && limit > 0) ? Math.min(limit, MAX_DM_MESSAGES) : 50;
  return convo.messages.slice(-lim);
}

function getDMConversations(key) {
  var account = loadAccount(key);
  if (!account) return [];
  _ensureDMData(account);
  var convos = account.dms.conversations;
  var keys = Object.keys(convos);
  var result = [];
  for (var i = 0; i < keys.length; i++) {
    var otherKey = keys[i];
    var convo = convos[otherKey];
    result.push({
      key: otherKey,
      lastActivity: convo.lastActivity || 0,
      messageCount: convo.messages ? convo.messages.length : 0,
    });
  }
  result.sort(function(a, b) { return b.lastActivity - a.lastActivity; });
  return result;
}

// ─── Delete a specific DM message by ID ───
function deleteDMMessage(myKey, otherKey, messageId) {
  if (!myKey || !otherKey || !messageId) return false;
  var account = loadAccount(myKey);
  if (!account) return false;
  _ensureDMData(account);
  var convo = account.dms.conversations[otherKey];
  if (!convo || !convo.messages || convo.messages.length === 0) return false;
  var originalLen = convo.messages.length;
  convo.messages = convo.messages.filter(function(m) { return m.id !== messageId; });
  if (convo.messages.length === originalLen) return false; // message not found
  // If conversation is now empty, remove it entirely
  if (convo.messages.length === 0) {
    delete account.dms.conversations[otherKey];
  }
  saveAccount(account);
  return true;
}

// ─── Clear all DMs for an account ───
function clearDMs(key) {
  var account = loadAccount(key);
  if (!account) return;
  if (account.dms) {
    account.dms = { conversations: {} };
    saveAccount(account);
  }
}

// ─── Clear DMs for ALL accounts (used during daily wipe) ───
function clearAllDMs() {
  // Clear from cache
  for (var [key, account] of accountCache) {
    if (account && account.dms && !account.temp) {
      account.dms = { conversations: {} };
      _queueWrite(account);
    }
  }
  // Also scan disk for accounts not in cache
  try {
    var files = fs.readdirSync(ACCOUNTS_DIR);
    for (var i = 0; i < files.length; i++) {
      if (!files[i].endsWith('.json')) continue;
      var fp = path.join(ACCOUNTS_DIR, files[i]);
      try {
        var buf = fs.readFileSync(fp);
        var acc;
        try {
          var decrypted = _decryptData(buf);
          if (decrypted) acc = JSON.parse(decrypted);
        } catch (_) {}
        if (!acc) {
          try { acc = JSON.parse(buf.toString('utf8')); } catch (_) {}
        }
        if (acc && acc.dms && Object.keys(acc.dms.conversations || {}).length > 0) {
          acc.dms = { conversations: {} };
          // Write scrubbed version for accounts not in cache
          var accKey = acc.key || (acc.keyHash && keyHashMap.has(acc.keyHash) ? keyHashMap.get(acc.keyHash) : null);
          if (!accKey || !accountCache.has(accKey)) {
            var scrubbed = acc.key ? _scrubForDisk(acc) : acc; // already scrubbed if no raw key
            var jsonStr = JSON.stringify(scrubbed);
            var encrypted = _encryptData(jsonStr);
            fs.writeFileSync(fp, encrypted);
          }
        }
      } catch (_) { continue; }
    }
  } catch (_) {}
  console.log('[accounts] All DM conversations cleared');
}

// Cleanup expired accounts (async, non-blocking)
function cleanupExpiredAccounts() {
  fs.promises.readdir(ACCOUNTS_DIR).then(files => {
    files = files.filter(f => f.endsWith('.json'));
    let cleaned = 0;
    return Promise.all(files.map(file => {
      const fp = path.join(ACCOUNTS_DIR, file);
      return fs.promises.readFile(fp).then(buf => {
        var acc;
        try {
          var decrypted = _decryptData(buf);
          if (decrypted) acc = JSON.parse(decrypted);
        } catch (_) {}
        if (!acc) {
          try { acc = JSON.parse(buf.toString('utf8')); } catch (_) {}
        }
        if (acc && isAccountExpired(acc)) {
          // Handle both legacy (raw key) and new (keyHash) formats
          if (acc.key) accountCache.delete(acc.key);
          if (acc.keyHash) {
            var resolvedKey = keyHashMap.get(acc.keyHash);
            if (resolvedKey) accountCache.delete(resolvedKey);
            keyHashMap.delete(acc.keyHash);
          }
          cleaned++;
          return fs.promises.unlink(fp).catch(() => {});
        }
      }).catch(() => { /* skip corrupt files */ });
    })).then(() => {
      if (cleaned > 0) console.log('[accounts] Cleaned up ' + cleaned + ' expired accounts');
      return cleaned;
    });
  }).catch(err => {
    console.error('[accounts] Cleanup error:', err.message);
  });
  return 0;
}

// ─── Background re-encryption: migrate files from old key versions to current ───
var _reencryptRunning = false;
function reencryptAccounts() {
  if (_reencryptRunning) return;
  if (ENCRYPTION_KEYS.length <= 1 && CURRENT_VERSION === 0) return; // nothing to rotate
  _reencryptRunning = true;
  var migrated = 0;
  fs.promises.readdir(ACCOUNTS_DIR).then(function(files) {
    files = files.filter(function(f) { return f.endsWith('.json'); });
    return files.reduce(function(chain, file) {
      return chain.then(function() {
        var fp = path.join(ACCOUNTS_DIR, file);
        return fs.promises.readFile(fp).then(function(buf) {
          // If current version > 0, check if file already has current version prefix
          if (CURRENT_VERSION > 0 && buf.length >= 30 && buf[0] === CURRENT_VERSION) {
            return; // already current
          }
          var plaintext = _decryptData(buf);
          if (!plaintext) return; // corrupt or undecryptable — skip
          var reencrypted = _encryptData(plaintext);
          return fs.promises.writeFile(fp, reencrypted).then(function() { migrated++; });
        }).catch(function() { /* skip errors */ });
      });
    }, Promise.resolve());
  }).then(function() {
    if (migrated > 0) console.log('[accounts] Re-encrypted ' + migrated + ' account files to key version ' + CURRENT_VERSION);
  }).catch(function(err) {
    console.error('[accounts] Re-encryption error:', err.message);
  }).finally(function() {
    _reencryptRunning = false;
  });
}

module.exports = {
  createAccount,
  createTempAccount,
  promoteTempAccount,
  isTempAccount,
  loadAccount,
  saveAccount,
  updateChips,
  setChips,
  updateStats,
  deleteAccount,
  getPublicProfile,
  addFavoriteGif,
  removeFavoriteGif,
  getFavoriteGifs,
  getLeaderboard,
  addInventoryItem,
  removeInventoryItem,
  equipItem,
  unequipItem,
  getInventory,
  addCard,
  removeCard,
  getCards,
  setShowcase,
  getShowcase,
  updateClickerState,
  getClickerState,
  getSlotUpgrades,
  updateSlotUpgrades,
  getScratchUpgrades,
  updateScratchUpgrades,
  cleanupExpiredAccounts,
  isAccountExpired,
  getDiscriminator,
  getUserTag,
  findAccountByTag,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  blockUser,
  unblockUser,
  getFriendsData,
  flushAll,
  setPublicKey,
  getPublicKey: getPublicKeyE2E,
  storeDM,
  getDMHistory,
  getDMConversations,
  ACCOUNTS_DIR,
  MAX_INVENTORY,
  MAX_CARDS,
  MAX_SHOWCASE,
  MAX_FRIENDS,
  MAX_FRIEND_REQUESTS,
  MAX_BLOCKED,
  ACCOUNT_EXPIRY_DAYS,
  MAX_CHIPS,
  MAX_DM_CONVERSATIONS,
  MAX_DM_MESSAGES,
  hashPin,
  verifyPin,
  setPinForAccount,
  clearDMs,
  clearAllDMs,
  deleteDMMessage,
  reencryptAccounts,
  keyHashMap,
  _keyHash,
  searchUsernames,
  getMemberCount,
};

function getMemberCount() {
  return _leaderboardCache ? _leaderboardCache.length : 0;
}

// Search permanent accounts by partial username (uses leaderboard cache)
function searchUsernames(query, limit) {
  limit = limit || 10;
  if (!query || typeof query !== 'string') return [];
  var q = query.toLowerCase().trim();
  if (q.length < 1) return [];
  var results = [];
  var seen = new Set();
  // Search leaderboard cache first (already loaded in memory)
  if (_leaderboardCache) {
    for (var i = 0; i < _leaderboardCache.length; i++) {
      var entry = _leaderboardCache[i];
      if (entry.username && entry.username.toLowerCase().indexOf(q) !== -1) {
        var key = entry.username.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          results.push({ name: entry.username, color: entry.color || '#f0b232', tag: entry.tag || '' });
          if (results.length >= limit) return results;
        }
      }
    }
  }
  // Also scan accountCache for any not in leaderboard
  for (var [, acc] of accountCache) {
    if (acc && acc.username && !acc.temp && acc.username.toLowerCase().indexOf(q) !== -1) {
      var k = acc.username.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        results.push({ name: acc.username, color: acc.color || '#f0b232', tag: '' });
        if (results.length >= limit) return results;
      }
    }
  }
  return results;
}
