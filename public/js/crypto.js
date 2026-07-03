// crypto.js — BossCord E2E encryption module
// Uses Web Crypto API with ECDH P-256 + HKDF + AES-256-GCM
// Features: AAD binding, per-message HKDF-derived keys, IndexedDB key storage
// Loaded before dms.js. Exposes global BossCordCrypto object.

var BossCordCrypto = (function() {
  'use strict';

  var STORAGE_KEY = 'bosscord_e2e_keys';
  var IDB_NAME = 'bosscord_crypto';
  var IDB_STORE = 'keys';
  var IDB_KEY_ID = 'current_keypair'; // single record ID in the object store
  var CURVE = { name: 'ECDH', namedCurve: 'P-256' };
  var AES_ALGO = 'AES-GCM';
  var AES_KEY_BITS = 256;
  var IV_BYTES = 12;   // 96-bit nonce for AES-GCM
  var SALT_BYTES = 16; // 128-bit per-message salt for HKDF
  var HKDF_INFO = 'bosscord-dm-msg'; // HKDF info string for per-message key derivation

  // Shared secret cache: Map of otherAccountKey -> HKDF base CryptoKey (for deriveBits)
  // This is the ECDH raw shared secret imported as HKDF key material, NOT a per-message key.
  var secretCache = {};

  // In-memory reference to the loaded private CryptoKey (non-extractable)
  var _privateKey = null;
  var _publicKeyBase64 = null;
  var _keyVersion = 0;
  var _previousPrivateKey = null;

  // Track whether IndexedDB is available (determined once at first use)
  var _idbAvailable = null; // null = untested, true/false after first attempt

  // ─── Utility: ArrayBuffer <-> Base64 ───

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64ToArrayBuffer(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // ─── Utility: Encode string to UTF-8 Uint8Array ───

  var _encoder = new TextEncoder();
  var _decoder = new TextDecoder();

  function encodeUTF8(str) {
    return _encoder.encode(str);
  }

  // ─── AAD Construction ───
  // AAD binds ciphertext to the sender-recipient pair, preventing replay across conversations.

  function buildAAD(senderKey, recipientKey) {
    return encodeUTF8('bosscord-dm:' + senderKey + ':' + recipientKey);
  }

  // ─── IndexedDB helpers ───

  function _openDB() {
    return new Promise(function(resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB not available'));
        return;
      }
      var request;
      try {
        request = indexedDB.open(IDB_NAME, 1);
      } catch (e) {
        reject(e);
        return;
      }
      request.onerror = function() {
        reject(request.error || new Error('IndexedDB open failed'));
      };
      request.onupgradeneeded = function(event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = function() {
        resolve(request.result);
      };
    });
  }

  // Read a value from IndexedDB by key
  function _idbGet(key) {
    return _openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readonly');
        var store = tx.objectStore(IDB_STORE);
        var req = store.get(key);
        req.onsuccess = function() { resolve(req.result); };
        req.onerror = function() { reject(req.error); };
        tx.oncomplete = function() { db.close(); };
        tx.onerror = function() { db.close(); reject(tx.error); };
      });
    });
  }

  // Write a value to IndexedDB by key
  function _idbPut(key, value) {
    return _openDB().then(function(db) {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        var store = tx.objectStore(IDB_STORE);
        var req = store.put(value, key);
        req.onsuccess = function() { resolve(); };
        req.onerror = function() { reject(req.error); };
        tx.oncomplete = function() { db.close(); };
        tx.onerror = function() { db.close(); reject(tx.error); };
      });
    });
  }

  // Test if IndexedDB is usable (some browsers/incognito block it)
  async function _checkIDB() {
    if (_idbAvailable !== null) return _idbAvailable;
    try {
      var db = await _openDB();
      db.close();
      _idbAvailable = true;
    } catch (e) {
      console.warn('[BossCordCrypto] IndexedDB not available, falling back to localStorage:', e.message);
      _idbAvailable = false;
    }
    return _idbAvailable;
  }

  // ─── Key Generation ───

  async function generateKeyPair() {
    // Generate as extractable so we can export the raw public key bytes
    var keyPair = await crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
    // Export public key as raw bytes then base64
    var rawPub = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    _publicKeyBase64 = arrayBufferToBase64(rawPub);
    _keyVersion = 1;
    _previousPrivateKey = null;

    // Re-import private key as NON-extractable for runtime and storage
    var privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    _privateKey = await crypto.subtle.importKey(
      'jwk', privateJwk, CURVE, false, ['deriveBits']
    );

    // Save to storage (IndexedDB primary, localStorage fallback)
    await _saveKeysToStorage(_publicKeyBase64, _privateKey, privateJwk, _keyVersion, null);

    // Clear secret cache since keys changed
    secretCache = {};
    return { publicKey: _publicKeyBase64, privateKey: _privateKey, version: _keyVersion };
  }

  async function rotateKeyPair() {
    // Build previousData from current in-memory state
    var previousData = null;
    if (_privateKey && _publicKeyBase64) {
      previousData = {
        publicKeyBase64: _publicKeyBase64,
        privateKey: _privateKey, // CryptoKey object (non-extractable)
        version: _keyVersion,
        created: Date.now()
      };
    } else {
      // Try to recover previous data from storage
      try {
        var stored = await _loadFromIDB();
        if (stored && stored.current) {
          previousData = {
            publicKeyBase64: stored.current.publicKeyBase64,
            privateKey: stored.current.privateKey,
            version: stored.current.version,
            created: stored.current.created
          };
        }
      } catch (e) {
        console.error('[BossCordCrypto] Error reading current keys for rotation:', e);
      }
    }

    // Preserve current private key as _previousPrivateKey before overwriting
    _previousPrivateKey = _privateKey;

    var newVersion = _keyVersion + 1;

    // Generate new key pair (extractable for export, then re-import as non-extractable)
    var keyPair = await crypto.subtle.generateKey(CURVE, true, ['deriveBits']);
    var rawPub = await crypto.subtle.exportKey('raw', keyPair.publicKey);
    _publicKeyBase64 = arrayBufferToBase64(rawPub);
    var privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
    _keyVersion = newVersion;

    // Re-import as non-extractable
    _privateKey = await crypto.subtle.importKey(
      'jwk', privateJwk, CURVE, false, ['deriveBits']
    );

    // Save to storage
    await _saveKeysToStorage(_publicKeyBase64, _privateKey, privateJwk, _keyVersion, previousData);

    // Clear secret cache since our keys changed — all secrets must be re-derived
    secretCache = {};

    return { publicKey: _publicKeyBase64, version: _keyVersion };
  }

  // ─── Key Persistence ───

  // Internal: load data from IndexedDB. Returns the stored record or undefined.
  async function _loadFromIDB() {
    var idbOk = await _checkIDB();
    if (!idbOk) return undefined;
    try {
      return await _idbGet(IDB_KEY_ID);
    } catch (e) {
      console.error('[BossCordCrypto] IndexedDB read failed:', e);
      return undefined;
    }
  }

  // Save keys. Prefers IndexedDB (stores CryptoKey objects directly).
  // Falls back to localStorage with JWK if IndexedDB is unavailable.
  // privateKeyCK is the non-extractable CryptoKey. privateKeyJwk is the extractable JWK
  // (only used for the localStorage fallback path).
  async function _saveKeysToStorage(publicKeyBase64, privateKeyCK, privateKeyJwk, version, previousData) {
    var idbOk = await _checkIDB();
    if (idbOk) {
      try {
        // Store CryptoKey objects directly — IndexedDB supports structured clone of CryptoKey
        var record = {
          current: {
            publicKeyBase64: publicKeyBase64,
            privateKey: privateKeyCK, // non-extractable CryptoKey
            version: typeof version === 'number' ? version : _keyVersion,
            created: Date.now()
          },
          previous: previousData ? {
            publicKeyBase64: previousData.publicKeyBase64,
            privateKey: previousData.privateKey, // non-extractable CryptoKey
            version: previousData.version,
            created: previousData.created
          } : null
        };
        await _idbPut(IDB_KEY_ID, record);
        // Clear localStorage since IndexedDB is authoritative now
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        return;
      } catch (e) {
        console.error('[BossCordCrypto] IndexedDB write failed, falling back to localStorage:', e);
        // Fall through to localStorage
      }
    }

    // Fallback: localStorage with JWK (extractable format)
    try {
      var payload = {
        current: {
          publicKey: publicKeyBase64,
          privateKey: privateKeyJwk,
          version: typeof version === 'number' ? version : _keyVersion,
          created: Date.now()
        },
        previous: null
      };
      // For previous data in localStorage fallback, we cannot store CryptoKey objects.
      // We skip previous key storage in localStorage — it is a degraded fallback.
      // Previous keys only matter for key rotation decryption fallback, which is a
      // best-effort feature. In localStorage-only mode, rotation history is lost.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('[BossCordCrypto] Failed to save keys to localStorage:', e);
    }
  }

  // Check if keys exist. Returns a Promise<boolean>.
  async function hasKeys() {
    // Check IndexedDB first
    try {
      var idbOk = await _checkIDB();
      if (idbOk) {
        var record = await _idbGet(IDB_KEY_ID);
        if (record && record.current && record.current.publicKeyBase64 && record.current.privateKey) {
          return true;
        }
      }
    } catch (e) {
      // IndexedDB failed, fall through to localStorage
    }

    // Check localStorage
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return false;
      var parsed = JSON.parse(stored);
      if (!parsed) return false;
      // New format
      if (parsed.current && parsed.current.publicKey && parsed.current.privateKey) return true;
      // Legacy flat format
      if (parsed.publicKey && parsed.privateKey) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  async function loadKeys() {
    // ── Try IndexedDB first ──
    try {
      var idbOk = await _checkIDB();
      if (idbOk) {
        var record = await _idbGet(IDB_KEY_ID);
        if (record && record.current && record.current.publicKeyBase64 && record.current.privateKey) {
          // CryptoKey objects are stored directly — no import needed
          _privateKey = record.current.privateKey;
          _publicKeyBase64 = record.current.publicKeyBase64;
          _keyVersion = typeof record.current.version === 'number' ? record.current.version : 1;

          // Load previous key
          _previousPrivateKey = null;
          if (record.previous && record.previous.privateKey) {
            _previousPrivateKey = record.previous.privateKey;
          }

          return { publicKey: _publicKeyBase64, privateKey: _privateKey, version: _keyVersion };
        }
      }
    } catch (e) {
      console.error('[BossCordCrypto] IndexedDB load failed:', e);
    }

    // ── Fallback: localStorage ──
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      var parsed = JSON.parse(stored);
      if (!parsed) return null;

      var currentPub, currentPrivJwk, currentVersion;
      var prevPrivJwk = null;

      if (parsed.current && parsed.current.publicKey && parsed.current.privateKey) {
        // New format: { current: { publicKey, privateKey (JWK), version, created }, previous: ... }
        currentPub = parsed.current.publicKey;
        currentPrivJwk = parsed.current.privateKey;
        currentVersion = typeof parsed.current.version === 'number' ? parsed.current.version : 1;

        if (parsed.previous && parsed.previous.privateKey) {
          prevPrivJwk = parsed.previous.privateKey;
        }
      } else if (parsed.publicKey && parsed.privateKey) {
        // Legacy flat format: { publicKey, privateKey }
        currentPub = parsed.publicKey;
        currentPrivJwk = parsed.privateKey;
        currentVersion = 0;
      } else {
        return null;
      }

      // Import current private key as non-extractable
      var privKey = await crypto.subtle.importKey(
        'jwk', currentPrivJwk,
        CURVE, false, ['deriveBits']
      );
      _privateKey = privKey;
      _publicKeyBase64 = currentPub;
      _keyVersion = currentVersion;

      // Import previous private key if present
      _previousPrivateKey = null;
      if (prevPrivJwk) {
        try {
          _previousPrivateKey = await crypto.subtle.importKey(
            'jwk', prevPrivJwk,
            CURVE, false, ['deriveBits']
          );
        } catch (prevErr) {
          console.error('[BossCordCrypto] Failed to load previous key:', prevErr);
        }
      }

      // Migrate to IndexedDB if available
      var idbOk2 = await _checkIDB();
      if (idbOk2) {
        try {
          var migrationRecord = {
            current: {
              publicKeyBase64: _publicKeyBase64,
              privateKey: _privateKey,
              version: _keyVersion,
              created: Date.now()
            },
            previous: _previousPrivateKey ? {
              publicKeyBase64: (parsed.previous && parsed.previous.publicKey) ? parsed.previous.publicKey : null,
              privateKey: _previousPrivateKey,
              version: (parsed.previous && typeof parsed.previous.version === 'number') ? parsed.previous.version : 0,
              created: (parsed.previous && parsed.previous.created) ? parsed.previous.created : Date.now()
            } : null
          };
          await _idbPut(IDB_KEY_ID, migrationRecord);
          // Migration successful — clear localStorage entry
          try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
          console.log('[BossCordCrypto] Migrated keys from localStorage to IndexedDB');
        } catch (migErr) {
          console.warn('[BossCordCrypto] Migration to IndexedDB failed, keys remain in localStorage:', migErr);
        }
      }

      return { publicKey: _publicKeyBase64, privateKey: _privateKey, version: _keyVersion };
    } catch (e) {
      console.error('[BossCordCrypto] Failed to load keys:', e);
      return null;
    }
  }

  function exportPublicKey() {
    return _publicKeyBase64;
  }

  function getKeyVersion() {
    return _keyVersion;
  }

  function getPreviousPrivateKey() {
    return _previousPrivateKey;
  }

  function getPrivateKey() {
    return _privateKey;
  }

  // ─── Shared Secret Derivation ───
  // Returns an HKDF base key derived from the ECDH shared secret.
  // This base key is cached and used with per-message salts to derive unique AES keys.

  async function deriveSharedSecret(privateKey, publicKeyBase64) {
    // Import the other party's public key from base64 raw format
    var rawPub = base64ToArrayBuffer(publicKeyBase64);
    var otherPubKey = await crypto.subtle.importKey(
      'raw', rawPub,
      CURVE, false, []
    );
    // Derive raw ECDH shared bits (P-256 yields 256 bits)
    var sharedBits = await crypto.subtle.deriveBits(
      { name: 'ECDH', public: otherPubKey },
      privateKey,
      256
    );
    // Import the raw shared bits as HKDF key material
    var hkdfBaseKey = await crypto.subtle.importKey(
      'raw', sharedBits,
      { name: 'HKDF' },
      false,
      ['deriveKey', 'deriveBits']
    );
    return hkdfBaseKey;
  }

  async function getOrDeriveSecret(privateKey, otherPublicKeyBase64, otherAccountKey) {
    if (secretCache[otherAccountKey]) {
      return secretCache[otherAccountKey];
    }
    var secret = await deriveSharedSecret(privateKey, otherPublicKeyBase64);
    secretCache[otherAccountKey] = secret;
    return secret;
  }

  // Invalidate a specific cached secret (e.g., when the other user rotates keys)
  function invalidateSecret(otherAccountKey) {
    delete secretCache[otherAccountKey];
  }

  function clearAllSecrets() {
    secretCache = {};
  }

  // ─── Per-message Key Derivation via HKDF ───
  // Given the HKDF base key (from ECDH) and a per-message salt, derive a unique AES-256-GCM key.

  async function _deriveMessageKey(hkdfBaseKey, salt) {
    var infoBytes = encodeUTF8(HKDF_INFO);
    var aesKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: salt,
        info: infoBytes
      },
      hkdfBaseKey,
      { name: AES_ALGO, length: AES_KEY_BITS },
      false,
      ['encrypt', 'decrypt']
    );
    return aesKey;
  }

  // ─── Encrypt / Decrypt ───

  // encrypt(plaintext, sharedSecret, senderKey, recipientKey)
  //   sharedSecret: HKDF base CryptoKey from deriveSharedSecret
  //   senderKey: base64 account key of the sender (for AAD binding)
  //   recipientKey: base64 account key of the recipient (for AAD binding)
  // Returns: { ciphertext: base64, nonce: base64, salt: base64 }
  async function encrypt(plaintext, sharedSecret, senderKey, recipientKey) {
    var data = encodeUTF8(plaintext);

    // Generate random per-message salt for HKDF key derivation
    var salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));

    // Derive per-message AES key from HKDF base key + salt
    var messageKey = await _deriveMessageKey(sharedSecret, salt);

    // Generate random 96-bit IV
    var iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

    // Build AES-GCM parameters with AAD if sender/recipient keys are provided
    var aesParams = { name: AES_ALGO, iv: iv };
    if (senderKey && recipientKey) {
      aesParams.additionalData = buildAAD(senderKey, recipientKey);
    }

    var ciphertextBuf = await crypto.subtle.encrypt(aesParams, messageKey, data);

    return {
      ciphertext: arrayBufferToBase64(ciphertextBuf),
      nonce: arrayBufferToBase64(iv.buffer),
      salt: arrayBufferToBase64(salt.buffer),
    };
  }

  // decrypt(ciphertextBase64, nonceBase64, sharedSecret, senderKey, recipientKey, saltBase64)
  //   sharedSecret: HKDF base CryptoKey from deriveSharedSecret
  //   senderKey: base64 account key of the message sender (for AAD)
  //   recipientKey: base64 account key of the recipient (for AAD)
  //   saltBase64: per-message salt (may be undefined for legacy messages)
  // Handles backward compatibility: if salt is missing, falls back to legacy direct-key decryption.
  // If AAD decryption fails, retries without AAD for old messages.
  async function decrypt(ciphertextBase64, nonceBase64, sharedSecret, senderKey, recipientKey, saltBase64) {
    var ciphertextBuf = base64ToArrayBuffer(ciphertextBase64);
    var iv = new Uint8Array(base64ToArrayBuffer(nonceBase64));

    // ── New format: per-message salt is present ──
    if (saltBase64) {
      var salt = new Uint8Array(base64ToArrayBuffer(saltBase64));
      var messageKey = await _deriveMessageKey(sharedSecret, salt);

      // Attempt 1: decrypt with AAD
      if (senderKey && recipientKey) {
        try {
          var plaintextBuf = await crypto.subtle.decrypt(
            { name: AES_ALGO, iv: iv, additionalData: buildAAD(senderKey, recipientKey) },
            messageKey,
            ciphertextBuf
          );
          return _decoder.decode(plaintextBuf);
        } catch (e) {
          // AAD mismatch — try without AAD (should not happen for new messages,
          // but handles edge cases during rollout)
        }
      }

      // Attempt 2: decrypt without AAD (salt present but AAD was not used or mismatched)
      try {
        var plaintextBuf2 = await crypto.subtle.decrypt(
          { name: AES_ALGO, iv: iv },
          messageKey,
          ciphertextBuf
        );
        return _decoder.decode(plaintextBuf2);
      } catch (e2) {
        // Both attempts with salt-derived key failed — the message might be genuinely
        // undecryptable with this key pair. Re-throw the error for the caller to handle
        // with fallback key combinations.
        throw e2;
      }
    }

    // ── Legacy format: no salt (old messages before HKDF per-message keys) ──
    // The sharedSecret here is an HKDF base key, which cannot decrypt legacy messages
    // that used a direct ECDH-derived AES key. Signal the caller to use
    // deriveSharedSecretLegacy() + decryptLegacy() for these old messages.
    throw new Error('LEGACY_NO_SALT');
  }

  // ─── Legacy Shared Secret Derivation (backward compat) ───
  // Returns a direct AES-GCM key from ECDH, matching the old deriveSharedSecret behavior.
  // Used only for decrypting old messages that were encrypted before the HKDF upgrade.
  async function deriveSharedSecretLegacy(privateKey, publicKeyBase64) {
    var rawPub = base64ToArrayBuffer(publicKeyBase64);
    var otherPubKey = await crypto.subtle.importKey(
      'raw', rawPub,
      CURVE, false, []
    );
    var sharedKey = await crypto.subtle.deriveKey(
      { name: 'ECDH', public: otherPubKey },
      privateKey,
      { name: AES_ALGO, length: AES_KEY_BITS },
      false,
      ['encrypt', 'decrypt']
    );
    return sharedKey;
  }

  // Legacy decrypt: uses a direct AES-GCM key (no HKDF, no salt, no AAD).
  // Matches the old encrypt/decrypt behavior exactly.
  async function decryptLegacy(ciphertextBase64, nonceBase64, sharedSecret) {
    var ciphertextBuf = base64ToArrayBuffer(ciphertextBase64);
    var iv = new Uint8Array(base64ToArrayBuffer(nonceBase64));
    var plaintextBuf = await crypto.subtle.decrypt(
      { name: AES_ALGO, iv: iv },
      sharedSecret,
      ciphertextBuf
    );
    return _decoder.decode(plaintextBuf);
  }

  // ─── Safety Number Generation ───
  // Generates a human-readable 40-digit verification code from two public keys.
  // Both parties get the same result regardless of who initiates, because the
  // keys are sorted alphabetically before hashing.

  async function generateSafetyNumber(myPublicKeyBase64, theirPublicKeyBase64) {
    // Sort deterministically so both sides produce the same number
    var keys = [myPublicKeyBase64, theirPublicKeyBase64].sort();
    var combined = keys[0] + ':' + keys[1];
    // SHA-256 hash of the concatenated, sorted keys
    var hashBuffer = await crypto.subtle.digest('SHA-256', _encoder.encode(combined));
    var hashBytes = new Uint8Array(hashBuffer);
    // Convert to 8 groups of 5 digits (40 digits total), similar to Signal safety numbers
    var numbers = [];
    for (var i = 0; i < 8; i++) {
      var num = ((hashBytes[i * 4] << 24) | (hashBytes[i * 4 + 1] << 16) | (hashBytes[i * 4 + 2] << 8) | hashBytes[i * 4 + 3]) >>> 0;
      numbers.push(String(num % 100000).padStart(5, '0'));
    }
    return numbers.join(' ');
  }

  // ─── Key Pinning ───
  // Stores pinned peer public keys in localStorage and detects unexpected changes.

  var PIN_STORAGE_KEY = 'bosscord_pinned_keys';

  function getPinnedKeys() {
    try {
      var stored = localStorage.getItem(PIN_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch (e) {
      return {};
    }
  }

  // Pin a peer's public key. Returns { pinned: true } if this is a new or unchanged pin,
  // or { changed: true, oldKey: ... } if the key differs from what was previously pinned.
  function pinPeerKey(accountKey, publicKeyBase64) {
    var pinned = getPinnedKeys();
    if (pinned[accountKey] && pinned[accountKey] !== publicKeyBase64) {
      var oldKey = pinned[accountKey];
      pinned[accountKey] = publicKeyBase64;
      try { localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinned)); } catch (e) { /* ignore */ }
      return { changed: true, oldKey: oldKey };
    }
    pinned[accountKey] = publicKeyBase64;
    try { localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinned)); } catch (e) { /* ignore */ }
    return { pinned: true };
  }

  function isPeerKeyPinned(accountKey) {
    var pinned = getPinnedKeys();
    return !!pinned[accountKey];
  }

  function getPinnedKey(accountKey) {
    var pinned = getPinnedKeys();
    return pinned[accountKey] || null;
  }

  // ─── Room E2E Encryption ───
  // Symmetric AES-256-GCM encryption for private rooms using a shared secret.
  // The secret is part of the extended room code (CODE.SECRET) and never sent to the server.

  var ROOM_KEYS_STORAGE = 'bosscord_room_keys';

  function _getRoomKeys() {
    try {
      var stored = localStorage.getItem(ROOM_KEYS_STORAGE);
      return stored ? JSON.parse(stored) : {};
    } catch (e) { return {}; }
  }

  function _saveRoomKeys(keys) {
    try { localStorage.setItem(ROOM_KEYS_STORAGE, JSON.stringify(keys)); } catch (e) {}
  }

  function storeRoomSecret(roomCode, secret) {
    var keys = _getRoomKeys();
    keys[roomCode] = secret;
    _saveRoomKeys(keys);
  }

  function getRoomSecret(roomCode) {
    var keys = _getRoomKeys();
    return keys[roomCode] || null;
  }

  function removeRoomSecret(roomCode) {
    var keys = _getRoomKeys();
    delete keys[roomCode];
    _saveRoomKeys(keys);
  }

  function generateRoomSecret() {
    var bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  async function deriveRoomKey(roomSecret, roomCode) {
    var keyMaterial = await crypto.subtle.importKey(
      'raw', _encoder.encode(roomSecret), { name: 'HKDF' }, false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: _encoder.encode('bosscord-room-' + roomCode), info: _encoder.encode('room-e2e') },
      keyMaterial,
      { name: AES_ALGO, length: AES_KEY_BITS },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptRoomMessage(text, roomSecret, roomCode) {
    var key = await deriveRoomKey(roomSecret, roomCode);
    var iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    var ciphertext = await crypto.subtle.encrypt(
      { name: AES_ALGO, iv: iv },
      key,
      _encoder.encode(text)
    );
    return {
      ciphertext: arrayBufferToBase64(ciphertext),
      nonce: arrayBufferToBase64(iv.buffer)
    };
  }

  async function decryptRoomMessage(ciphertextB64, nonceB64, roomSecret, roomCode) {
    var key = await deriveRoomKey(roomSecret, roomCode);
    var ciphertext = new Uint8Array(base64ToArrayBuffer(ciphertextB64));
    var iv = new Uint8Array(base64ToArrayBuffer(nonceB64));
    var plainBuf = await crypto.subtle.decrypt(
      { name: AES_ALGO, iv: iv },
      key,
      ciphertext
    );
    return _decoder.decode(plainBuf);
  }

  // ─── Public API ───

  return {
    generateKeyPair: generateKeyPair,
    rotateKeyPair: rotateKeyPair,
    deriveSharedSecret: deriveSharedSecret,
    deriveSharedSecretLegacy: deriveSharedSecretLegacy,
    encrypt: encrypt,
    decrypt: decrypt,
    decryptLegacy: decryptLegacy,
    hasKeys: hasKeys,
    loadKeys: loadKeys,
    exportPublicKey: exportPublicKey,
    getPrivateKey: getPrivateKey,
    getPreviousPrivateKey: getPreviousPrivateKey,
    getKeyVersion: getKeyVersion,
    getOrDeriveSecret: getOrDeriveSecret,
    invalidateSecret: invalidateSecret,
    clearAllSecrets: clearAllSecrets,
    generateSafetyNumber: generateSafetyNumber,
    pinPeerKey: pinPeerKey,
    isPeerKeyPinned: isPeerKeyPinned,
    getPinnedKey: getPinnedKey,
    storeRoomSecret: storeRoomSecret,
    getRoomSecret: getRoomSecret,
    removeRoomSecret: removeRoomSecret,
    generateRoomSecret: generateRoomSecret,
    encryptRoomMessage: encryptRoomMessage,
    decryptRoomMessage: decryptRoomMessage,
  };
})();
