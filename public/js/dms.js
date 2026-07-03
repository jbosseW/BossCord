// dms.js — End-to-end encrypted Direct Messages UI
// Depends on: BossCordCrypto (crypto.js), useSocket (core.js)
// Renders DMView component for the DMs tab.

function DMView() {
  var ctx = useSocket();
  var socket = ctx.socket;
  var account = ctx.account;
  var isTemp = account && account.temp;

  var [keysReady, setKeysReady] = useState(false);
  var [keysLoading, setKeysLoading] = useState(true);
  var [conversations, setConversations] = useState([]);
  var [convoLoaded, setConvoLoaded] = useState(false);
  var [activeConvo, setActiveConvo] = useState(null); // accountKey of active conversation
  var [messages, setMessages] = useState([]); // decrypted messages for active convo
  var [inputText, setInputText] = useState('');
  var [status, setStatus] = useState(null);
  var [recipientKeyInput, setRecipientKeyInput] = useState('');
  var [showNewDM, setShowNewDM] = useState(false);
  var [sendingKey, setSendingKey] = useState(false);
  var [otherPublicKeys, setOtherPublicKeys] = useState({}); // accountKey -> base64 pubkey
  var otherPublicKeysRef = useRef({});
  var messagesEndRef = useRef(null);
  var isMobile = useIsMobile();
  var [showSafetyNumber, setShowSafetyNumber] = useState(false);
  var [safetyNumber, setSafetyNumber] = useState('');
  var [keyWarnings, setKeyWarnings] = useState({}); // accountKey -> warning message string
  var expectedRotationsRef = useRef({}); // accountKey -> true (peers that recently sent dm_key_rotated)

  // ─── Disappearing messages state ───
  var DISAPPEAR_OPTIONS = [0, 300, 1800, 3600]; // Off, 5m, 30m, 1h (in seconds)
  var DISAPPEAR_LABELS = ['Off', '5m', '30m', '1h'];
  var [disappearTimer, setDisappearTimer] = useState(0); // 0 = off, seconds otherwise
  var disappearTimersRef = useRef(new Map()); // messageId -> { timeoutId, expiresAt }
  var disappearIntervalRef = useRef(null); // for countdown re-render ticks
  var [, setDisappearTick] = useState(0); // force re-render for countdown display

  // Keep ref in sync with state so socket callbacks always see latest keys
  otherPublicKeysRef.current = otherPublicKeys;

  // ─── Initialize crypto keys on mount ───
  // Loads existing keys from storage. Does NOT auto-rotate — manual rotation
  // is available via the "Rotate Keys" button. Auto-rotation was removed because
  // it caused "Unable to decrypt" errors after navigating away and back.
  useEffect(function() {
    if (!account || isTemp) { setKeysLoading(false); return; }
    (async function() {
      try {
        var has = await BossCordCrypto.hasKeys();
        if (has) {
          var loaded = await BossCordCrypto.loadKeys();
          if (loaded) {
            // Re-register our public key with the server (in case server restarted)
            var pubKey = BossCordCrypto.getPublicKey();
            var version = BossCordCrypto.getKeyVersion();
            if (socket && pubKey) {
              socket.emit('dm_set_public_key', { publicKey: pubKey, version: version });
            }
            setKeysReady(true);
          }
        }
      } catch (e) {
        console.error('[DMs] Key load error:', e);
      }
      setKeysLoading(false);
    })();
  }, [account, socket]);

  // ─── Socket event listeners ───
  useEffect(function() {
    if (!socket) return;

    function onConversations(data) {
      setConversations(data.conversations || []);
      setConvoLoaded(true);
    }

    function onHistoryResult(data) {
      if (!data || !data.otherKey) return;
      // Only process if this is for the active conversation
      decryptMessages(data.messages || [], data.otherKey).then(function(decrypted) {
        setMessages(decrypted);
      }).catch(function(err) {
        console.error('[DMs] Decrypt history error:', err);
        setMessages([]);
      });
    }

    function onDMReceived(data) {
      if (!data) return;
      // If this message is for the active conversation, decrypt and add it
      if (activeConvo && data.fromKey === activeConvo) {
        decryptSingleMessage(data, data.fromKey).then(function(decrypted) {
          if (decrypted) {
            setMessages(function(prev) { return prev.concat([decrypted]); });
          }
        }).catch(function() {});
      }
      // Refresh conversations list
      socket.emit('dm_conversations');
      // Browser notification for incoming DM
      if (typeof BossCordNotifs !== 'undefined') {
        BossCordNotifs.notify('New DM', 'You received an encrypted message', 'dm-' + data.fromKey);
      }
    }

    function onDMSent(data) {
      if (!data) return;
      // Refresh conversations
      socket.emit('dm_conversations');
    }

    function onPublicKey(data) {
      if (!data || !data.accountKey) return;
      if (data.publicKey) {
        // Key pinning: check if this peer's key has changed unexpectedly
        var pinResult = BossCordCrypto.pinPeerKey(data.accountKey, data.publicKey);
        if (pinResult.changed) {
          // Check if this was an expected rotation
          if (expectedRotationsRef.current[data.accountKey]) {
            // Expected rotation — clear the flag, no warning
            delete expectedRotationsRef.current[data.accountKey];
          } else {
            // Unexpected key change — show warning
            setKeyWarnings(function(prev) {
              var next = Object.assign({}, prev);
              next[data.accountKey] = 'Warning: This user\'s encryption key has changed. This could mean they regenerated their keys, or someone may be intercepting this conversation.';
              return next;
            });
          }
        }
        setOtherPublicKeys(function(prev) {
          var next = Object.assign({}, prev);
          next[data.accountKey] = {
            key: data.publicKey,
            version: typeof data.keyVersion === 'number' ? data.keyVersion : 0,
            previousKey: data.previousKey || null,
            previousVersion: typeof data.previousVersion === 'number' ? data.previousVersion : null,
          };
          return next;
        });
      }
    }

    function onKeyRotated(data) {
      if (!data || !data.accountKey) return;
      // Mark this peer as having an expected rotation so the next key change
      // from onPublicKey does not trigger a warning banner
      expectedRotationsRef.current[data.accountKey] = true;
      // Invalidate cached secret for this peer since they have a new key
      BossCordCrypto.invalidateSecret(data.accountKey);
      // Re-fetch their public key to get the new one
      if (socket) {
        socket.emit('dm_get_public_key', { accountKey: data.accountKey });
      }
    }

    function onKeySet() {
      setKeysReady(true);
    }

    socket.on('dm_conversations_list', onConversations);
    socket.on('dm_history_result', onHistoryResult);
    socket.on('dm_received', onDMReceived);
    socket.on('dm_sent', onDMSent);
    socket.on('dm_public_key', onPublicKey);
    socket.on('dm_public_key_set', onKeySet);
    socket.on('dm_key_rotated', onKeyRotated);

    return function() {
      socket.off('dm_conversations_list', onConversations);
      socket.off('dm_history_result', onHistoryResult);
      socket.off('dm_received', onDMReceived);
      socket.off('dm_sent', onDMSent);
      socket.off('dm_public_key', onPublicKey);
      socket.off('dm_public_key_set', onKeySet);
      socket.off('dm_key_rotated', onKeyRotated);
    };
  }, [socket, activeConvo]);

  // ─── Fetch conversations when keys are ready ───
  useEffect(function() {
    if (!socket || !keysReady) return;
    socket.emit('dm_conversations');
  }, [socket, keysReady]);

  // ─── Load history when active conversation changes ───
  useEffect(function() {
    if (!socket || !activeConvo || !keysReady) return;
    setMessages([]);
    socket.emit('dm_history', { otherKey: activeConvo, limit: 100 });
    // Fetch other user's public key if we don't have it
    var existingKeyInfo = otherPublicKeys[activeConvo];
    var hasKey = existingKeyInfo && ((typeof existingKeyInfo === 'string') ? existingKeyInfo : existingKeyInfo.key);
    if (!hasKey) {
      socket.emit('dm_get_public_key', { accountKey: activeConvo });
    }
  }, [activeConvo, socket, keysReady]);

  // ─── Scroll to bottom on new messages ───
  useEffect(function() {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // ─── Decryption helpers ───
  var myKey = account && !isTemp ? account.key : null;

  // Attempt to decrypt a single message with a given secret (HKDF base key) and key pair.
  // Handles new format (with salt + AAD) and legacy format (no salt).
  // senderAccountKey/recipientAccountKey are for AAD.
  // otherKey is the conversation partner's account key (for legacy secret derivation).
  // pubKey is the peer's current ECDH public key base64.
  // previousPeerKey is the peer's previous ECDH public key base64 (for rotation fallback).
  async function _tryDecrypt(msg, secret, senderAccountKey, recipientAccountKey, privKey, pubKey, previousPeerKey, otherKey) {
    // Determine the "other account key in conversation" for AAD:
    // If I sent it: senderAccountKey = myKey, recipientAccountKey = otherKey
    // If they sent it: senderAccountKey = msg.fromKey, recipientAccountKey = myKey
    var aadSender = senderAccountKey;
    var aadRecipient = recipientAccountKey;

    // ── Attempt 1: New format with salt + AAD using current secret ──
    if (msg.salt) {
      try {
        var pt = await BossCordCrypto.decrypt(msg.ciphertext, msg.nonce, secret, aadSender, aadRecipient, msg.salt);
        return pt;
      } catch (e) {
        // Fall through to fallback key combinations
      }
    } else {
      // ── Legacy format: no salt, use legacy derivation ──
      // The secret we have is an HKDF base key and can't decrypt legacy messages directly.
      // We need the legacy AES key derived directly from ECDH.
      try {
        var legacySecret = await BossCordCrypto.deriveSharedSecretLegacy(privKey, pubKey);
        var pt2 = await BossCordCrypto.decryptLegacy(msg.ciphertext, msg.nonce, legacySecret);
        return pt2;
      } catch (e) {
        // Fall through to fallback key combinations
      }
    }

    // ── Fallback: try previous key combinations (covers key rotation) ──
    var prevPriv = BossCordCrypto.getPreviousPrivateKey();

    // Fallback A: our previous private key + peer's current public key
    if (prevPriv && pubKey) {
      try {
        if (msg.salt) {
          var fbSecret1 = await BossCordCrypto.deriveSharedSecret(prevPriv, pubKey);
          var fbPt1 = await BossCordCrypto.decrypt(msg.ciphertext, msg.nonce, fbSecret1, aadSender, aadRecipient, msg.salt);
          return fbPt1;
        } else {
          var fbLegacy1 = await BossCordCrypto.deriveSharedSecretLegacy(prevPriv, pubKey);
          var fbPt1L = await BossCordCrypto.decryptLegacy(msg.ciphertext, msg.nonce, fbLegacy1);
          return fbPt1L;
        }
      } catch (_) {}
    }

    // Fallback B: our current private key + peer's previous public key
    if (previousPeerKey) {
      try {
        if (msg.salt) {
          var fbSecret2 = await BossCordCrypto.deriveSharedSecret(privKey, previousPeerKey);
          var fbPt2 = await BossCordCrypto.decrypt(msg.ciphertext, msg.nonce, fbSecret2, aadSender, aadRecipient, msg.salt);
          return fbPt2;
        } else {
          var fbLegacy2 = await BossCordCrypto.deriveSharedSecretLegacy(privKey, previousPeerKey);
          var fbPt2L = await BossCordCrypto.decryptLegacy(msg.ciphertext, msg.nonce, fbLegacy2);
          return fbPt2L;
        }
      } catch (_) {}
    }

    // Fallback C: our previous private key + peer's previous public key
    if (prevPriv && previousPeerKey) {
      try {
        if (msg.salt) {
          var fbSecret3 = await BossCordCrypto.deriveSharedSecret(prevPriv, previousPeerKey);
          var fbPt3 = await BossCordCrypto.decrypt(msg.ciphertext, msg.nonce, fbSecret3, aadSender, aadRecipient, msg.salt);
          return fbPt3;
        } else {
          var fbLegacy3 = await BossCordCrypto.deriveSharedSecretLegacy(prevPriv, previousPeerKey);
          var fbPt3L = await BossCordCrypto.decryptLegacy(msg.ciphertext, msg.nonce, fbLegacy3);
          return fbPt3L;
        }
      } catch (_) {}
    }

    // All attempts failed
    return null;
  }

  async function decryptMessages(encryptedMessages, otherKey) {
    if (!encryptedMessages || encryptedMessages.length === 0) return [];
    var privKey = BossCordCrypto.getPrivateKey();
    if (!privKey) return [];
    var pubKeyInfo = otherPublicKeysRef.current[otherKey];
    // If we don't have the public key yet, request it and return empty
    if (!pubKeyInfo) {
      if (socket) socket.emit('dm_get_public_key', { accountKey: otherKey });
      return [];
    }
    // Support both old string format and new object format
    var pubKey = (typeof pubKeyInfo === 'string') ? pubKeyInfo : pubKeyInfo.key;
    var previousPeerKey = (typeof pubKeyInfo === 'object' && pubKeyInfo.previousKey) ? pubKeyInfo.previousKey : null;
    if (!pubKey) {
      if (socket) socket.emit('dm_get_public_key', { accountKey: otherKey });
      return [];
    }
    var secret;
    try {
      secret = await BossCordCrypto.getOrDeriveSecret(privKey, pubKey, otherKey);
    } catch (e) {
      console.error('[DMs] Failed to derive secret for', otherKey, ':', e);
      return [];
    }
    var results = [];
    for (var i = 0; i < encryptedMessages.length; i++) {
      var msg = encryptedMessages[i];
      // Determine AAD sender/recipient:
      // The sender encrypted with AAD = "bosscord-dm:<sender>:<recipient>"
      // If msg.fromKey === myKey: sender=myKey, recipient=otherKey
      // If msg.fromKey !== myKey: sender=msg.fromKey, recipient=myKey
      var aadSender = msg.fromKey;
      var aadRecipient = (msg.fromKey === myKey) ? otherKey : myKey;

      var plaintext = await _tryDecrypt(msg, secret, aadSender, aadRecipient, privKey, pubKey, previousPeerKey, otherKey);
      if (plaintext !== null) {
        results.push({
          id: msg.id,
          fromKey: msg.fromKey,
          text: plaintext,
          timestamp: msg.timestamp,
          mine: msg.fromKey === myKey,
        });
      } else {
        results.push({
          id: msg.id,
          fromKey: msg.fromKey,
          text: '[Unable to decrypt]',
          timestamp: msg.timestamp,
          mine: msg.fromKey === myKey,
          error: true,
        });
      }
    }
    return results;
  }

  async function decryptSingleMessage(msg, otherKey) {
    var privKey = BossCordCrypto.getPrivateKey();
    if (!privKey) return null;
    var pubKeyInfo = otherPublicKeysRef.current[otherKey];
    if (!pubKeyInfo) {
      if (socket) socket.emit('dm_get_public_key', { accountKey: otherKey });
      return null;
    }
    var pubKey = (typeof pubKeyInfo === 'string') ? pubKeyInfo : pubKeyInfo.key;
    var previousPeerKey = (typeof pubKeyInfo === 'object' && pubKeyInfo.previousKey) ? pubKeyInfo.previousKey : null;
    if (!pubKey) {
      if (socket) socket.emit('dm_get_public_key', { accountKey: otherKey });
      return null;
    }
    var secret;
    try {
      secret = await BossCordCrypto.getOrDeriveSecret(privKey, pubKey, otherKey);
    } catch (e) {
      console.error('[DMs] Failed to derive secret for single message:', e);
      return null;
    }

    // Determine AAD sender/recipient
    var aadSender = msg.fromKey;
    var aadRecipient = (msg.fromKey === myKey) ? otherKey : myKey;

    var plaintext = await _tryDecrypt(msg, secret, aadSender, aadRecipient, privKey, pubKey, previousPeerKey, otherKey);
    if (plaintext !== null) {
      return {
        id: msg.id,
        fromKey: msg.fromKey,
        text: plaintext,
        timestamp: msg.timestamp,
        mine: msg.fromKey === myKey,
      };
    }
    return {
      id: msg.id,
      fromKey: msg.fromKey,
      text: '[Unable to decrypt]',
      timestamp: msg.timestamp,
      mine: msg.fromKey === myKey,
      error: true,
    };
  }

  // ─── Re-decrypt when we receive a public key we were waiting for ───
  useEffect(function() {
    if (!activeConvo || !otherPublicKeys[activeConvo] || !socket || !keysReady) return;
    // Re-fetch and decrypt history now that we have the key
    socket.emit('dm_history', { otherKey: activeConvo, limit: 100 });
  }, [otherPublicKeys[activeConvo]]);

  // ─── Actions ───

  async function generateKeys() {
    setSendingKey(true);
    try {
      var result = await BossCordCrypto.generateKeyPair();
      if (socket && result.publicKey) {
        socket.emit('dm_set_public_key', { publicKey: result.publicKey, version: result.version || 1 });
      }
      setKeysReady(true);
      setStatus('Encryption keys generated!');
      setTimeout(function() { setStatus(null); }, 3000);
    } catch (e) {
      console.error('[DMs] Key generation error:', e);
      setStatus('Failed to generate keys. Try again.');
      setTimeout(function() { setStatus(null); }, 3000);
    }
    setSendingKey(false);
  }

  var [rotating, setRotating] = useState(false);

  async function rotateKeys() {
    setRotating(true);
    try {
      var result = await BossCordCrypto.rotateKeyPair();
      if (socket && result.publicKey) {
        socket.emit('dm_set_public_key', { publicKey: result.publicKey, version: result.version });
      }
      setStatus('Keys rotated (v' + result.version + ')');
      setTimeout(function() { setStatus(null); }, 3000);
    } catch (e) {
      console.error('[DMs] Key rotation error:', e);
      setStatus('Key rotation failed. Try again.');
      setTimeout(function() { setStatus(null); }, 3000);
    }
    setRotating(false);
  }

  async function sendMessage() {
    var text = inputText.trim();
    if (!text || !activeConvo || !socket) return;
    if (text.length > 2000) {
      setStatus('Message too long (max 2000 characters)');
      setTimeout(function() { setStatus(null); }, 2000);
      return;
    }
    var privKey = BossCordCrypto.getPrivateKey();
    if (!privKey) return;
    var pubKeyInfo = otherPublicKeysRef.current[activeConvo];
    var pubKey = pubKeyInfo ? ((typeof pubKeyInfo === 'string') ? pubKeyInfo : pubKeyInfo.key) : null;
    if (!pubKey) {
      setStatus('Waiting for recipient public key...');
      socket.emit('dm_get_public_key', { accountKey: activeConvo });
      setTimeout(function() { setStatus(null); }, 2000);
      return;
    }
    try {
      var secret = await BossCordCrypto.getOrDeriveSecret(privKey, pubKey, activeConvo);
      // Encrypt with AAD: sender=myKey, recipient=activeConvo (the other user)
      var encrypted = await BossCordCrypto.encrypt(text, secret, myKey, activeConvo);
      var timestamp = Date.now();
      socket.emit('dm_send', {
        toKey: activeConvo,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        salt: encrypted.salt,
        timestamp: timestamp,
      });
      // Optimistically add to local messages
      setMessages(function(prev) {
        return prev.concat([{
          id: 'pending_' + timestamp,
          fromKey: myKey,
          text: text,
          timestamp: timestamp,
          mine: true,
        }]);
      });
      setInputText('');
    } catch (e) {
      console.error('[DMs] Send error:', e);
      setStatus('Failed to encrypt message');
      setTimeout(function() { setStatus(null); }, 2000);
    }
  }

  var [dmFriends, setDmFriends] = useState([]);

  // Fetch friends list when opening new DM picker
  useEffect(function() {
    if (!socket || !showNewDM) return;
    socket.emit('friends_list_get');
    function onFriendsList(data) {
      setDmFriends((data.friends || []).filter(function(f) { return f.online !== undefined; }));
    }
    socket.on('friends_list', onFriendsList);
    return function() { socket.off('friends_list', onFriendsList); };
  }, [socket, showNewDM]);

  function startNewDM(friendKey) {
    if (!friendKey) return;
    if (friendKey === myKey) {
      setStatus('Cannot DM yourself');
      setTimeout(function() { setStatus(null); }, 2000);
      return;
    }
    // Fetch their public key
    socket.emit('dm_get_public_key', { accountKey: friendKey });
    setActiveConvo(friendKey);
    setShowNewDM(false);
  }

  async function openSafetyNumber() {
    if (!activeConvo) return;
    var myPub = BossCordCrypto.exportPublicKey();
    if (!myPub) return;
    var peerInfo = otherPublicKeys[activeConvo];
    var peerPub = peerInfo ? ((typeof peerInfo === 'string') ? peerInfo : peerInfo.key) : null;
    if (!peerPub) return;
    try {
      var number = await BossCordCrypto.generateSafetyNumber(myPub, peerPub);
      setSafetyNumber(number);
      setShowSafetyNumber(true);
    } catch (e) {
      console.error('[DMs] Safety number generation error:', e);
    }
  }

  function dismissKeyWarning(accountKey) {
    setKeyWarnings(function(prev) {
      var next = Object.assign({}, prev);
      delete next[accountKey];
      return next;
    });
  }

  // ─── Disappearing messages: cycle timer setting ───
  function cycleDisappearTimer() {
    setDisappearTimer(function(prev) {
      var idx = DISAPPEAR_OPTIONS.indexOf(prev);
      var next = (idx === -1 || idx >= DISAPPEAR_OPTIONS.length - 1) ? 0 : idx + 1;
      return DISAPPEAR_OPTIONS[next];
    });
  }

  function getDisappearLabel(seconds) {
    var idx = DISAPPEAR_OPTIONS.indexOf(seconds);
    return idx >= 0 ? DISAPPEAR_LABELS[idx] : 'Off';
  }

  function formatCountdown(remainingMs) {
    if (remainingMs <= 0) return '0s';
    var totalSec = Math.ceil(remainingMs / 1000);
    if (totalSec < 60) return totalSec + 's';
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    if (min < 60) return min + 'm' + (sec > 0 ? ' ' + sec + 's' : '');
    var hr = Math.floor(min / 60);
    min = min % 60;
    return hr + 'h' + (min > 0 ? ' ' + min + 'm' : '');
  }

  // ─── Disappearing messages: schedule timers for displayed messages ───
  useEffect(function() {
    if (disappearTimer <= 0) {
      // Timer is off -- clear any existing disappear timers
      var timersMap = disappearTimersRef.current;
      timersMap.forEach(function(entry) {
        clearTimeout(entry.timeoutId);
      });
      timersMap.clear();
      return;
    }
    // For each message not already tracked, start a disappear timer
    var timersMap = disappearTimersRef.current;
    var now = Date.now();
    var disappearMs = disappearTimer * 1000;

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (!msg.id || timersMap.has(msg.id)) continue;
      // Timer starts from when the message was first displayed (now)
      var expiresAt = now + disappearMs;
      var msgId = msg.id;
      var timeoutId = setTimeout(function(capturedMsgId) {
        return function() {
          // Remove message from local state
          setMessages(function(prev) {
            return prev.filter(function(m) { return m.id !== capturedMsgId; });
          });
          // Tell server to delete it too
          if (socket && activeConvo) {
            socket.emit('dm_delete_message', { otherKey: activeConvo, messageId: capturedMsgId });
          }
          // Clean up timer ref
          disappearTimersRef.current.delete(capturedMsgId);
        };
      }(msgId), disappearMs);
      timersMap.set(msgId, { timeoutId: timeoutId, expiresAt: expiresAt });
    }
  }, [messages, disappearTimer, socket, activeConvo]);

  // ─── Disappearing messages: countdown tick for UI display ───
  useEffect(function() {
    if (disappearTimer <= 0 || disappearTimersRef.current.size === 0) {
      // No active timers -- stop ticking
      if (disappearIntervalRef.current) {
        clearInterval(disappearIntervalRef.current);
        disappearIntervalRef.current = null;
      }
      return;
    }
    // Start an interval that forces re-renders every second for countdown display
    if (!disappearIntervalRef.current) {
      disappearIntervalRef.current = setInterval(function() {
        setDisappearTick(function(t) { return t + 1; });
      }, 1000);
    }
    return function() {
      if (disappearIntervalRef.current) {
        clearInterval(disappearIntervalRef.current);
        disappearIntervalRef.current = null;
      }
    };
  }, [disappearTimer, messages]);

  // ─── Disappearing messages: cleanup all timers on unmount or conversation switch ───
  useEffect(function() {
    return function() {
      var timersMap = disappearTimersRef.current;
      timersMap.forEach(function(entry) {
        clearTimeout(entry.timeoutId);
      });
      timersMap.clear();
      if (disappearIntervalRef.current) {
        clearInterval(disappearIntervalRef.current);
        disappearIntervalRef.current = null;
      }
    };
  }, [activeConvo]);

  function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var now = new Date();
    var isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function formatRelativeTime(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  // ─── Render: Not logged in ───
  if (!account || isTemp) {
    return React.createElement('div', {
      style: { padding: '40px 20px', textAlign: 'center', color: '#72767d' }
    }, 'Claim a key to use encrypted DMs');
  }

  // ─── Render: Loading keys ───
  if (keysLoading) {
    return React.createElement('div', {
      style: { padding: '40px 20px', textAlign: 'center', color: '#72767d' }
    }, 'Loading encryption keys...');
  }

  // ─── Render: No keys yet ───
  if (!keysReady) {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', background: '#1c1c1e', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }
    },
      React.createElement('div', { style: { fontSize: '48px', marginBottom: '16px' } }, '\uD83D\uDD12'),
      React.createElement('div', { style: { fontSize: '18px', fontWeight: 700, color: '#f0b232', marginBottom: '8px' } }, 'End-to-End Encrypted DMs'),
      React.createElement('div', { style: { fontSize: '14px', color: '#b5bac1', marginBottom: '24px', textAlign: 'center', maxWidth: '400px', lineHeight: '1.5' } },
        'Generate encryption keys to start sending private messages. Your messages are encrypted on your device and can only be read by you and the recipient. The server never sees your messages.'
      ),
      React.createElement('button', {
        onClick: generateKeys,
        disabled: sendingKey,
        style: {
          padding: '12px 32px', border: 'none', borderRadius: '8px', cursor: sendingKey ? 'default' : 'pointer',
          background: sendingKey ? '#555' : '#f0b232', color: '#1c1c1e', fontSize: '16px', fontWeight: 700,
          fontFamily: 'inherit', transition: 'background 0.2s',
        }
      }, sendingKey ? 'Generating...' : 'Generate Encryption Keys'),
      status ? React.createElement('div', { style: { marginTop: '12px', color: '#57f287', fontSize: '13px' } }, status) : null
    );
  }

  // ─── Render: DMs layout ───

  // Find active conversation profile from the list
  var activeProfile = null;
  for (var ci = 0; ci < conversations.length; ci++) {
    if (conversations[ci].key === activeConvo) {
      activeProfile = conversations[ci];
      break;
    }
  }

  // Conversation list sidebar
  var sidebarContent = React.createElement('div', {
    style: {
      width: isMobile ? '100%' : '260px', minWidth: isMobile ? undefined : '260px',
      borderRight: isMobile ? 'none' : '1px solid #2a2a2e',
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#18181b',
    }
  },
    // Header
    React.createElement('div', {
      style: { padding: '12px 16px', borderBottom: '1px solid #2a2a2e', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
    },
      React.createElement('span', { style: { fontSize: '16px', fontWeight: 700, color: '#f0b232' } }, '\uD83D\uDD12 DMs'),
      React.createElement('button', {
        onClick: function() { setShowNewDM(!showNewDM); },
        style: {
          padding: '4px 10px', border: 'none', borderRadius: '4px', cursor: 'pointer',
          background: '#5865f2', color: '#fff', fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
        }
      }, '+ New')
    ),
    // Ephemeral notice
    React.createElement('div', {
      style: {
        padding: '6px 12px', background: 'rgba(237, 66, 69, 0.1)',
        borderBottom: '1px solid #2a2a2e', display: 'flex', alignItems: 'center', gap: '6px'
      }
    },
      React.createElement('span', { style: { fontSize: '11px', color: '#ed4245' } },
        'Messages are ephemeral \u2014 they wipe when you disconnect and during the daily server reset.'
      )
    ),
    // New DM — friends picker
    showNewDM ? React.createElement('div', {
      style: { padding: '8px 12px', borderBottom: '1px solid #2a2a2e', maxHeight: '200px', overflowY: 'auto' }
    },
      React.createElement('div', { style: { color: '#949ba4', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px' } }, 'Start DM with friend'),
      dmFriends.length === 0
        ? React.createElement('div', { style: { color: '#72767d', fontSize: '12px', padding: '8px 0' } }, 'No friends yet. Add friends first!')
        : dmFriends.map(function(f) {
            return React.createElement('div', {
              key: f.key,
              onClick: function() { startNewDM(f.key); },
              style: {
                display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
                borderRadius: '4px', cursor: 'pointer', transition: 'background 0.15s',
              },
              onMouseEnter: function(e) { e.currentTarget.style.background = '#2a2a2e'; },
              onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
            },
              React.createElement('div', {
                style: { width: '8px', height: '8px', borderRadius: '50%', background: f.online ? '#57f287' : '#72767d', flexShrink: 0 }
              }),
              React.createElement('span', { style: { color: f.color || '#dcddde', fontSize: '13px', fontWeight: 600 } }, f.username)
            );
          })
    ) : null,
    // Conversation list
    React.createElement('div', {
      style: { flex: 1, overflowY: 'auto', padding: '4px' }
    },
      !convoLoaded
        ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px' } },
            SkeletonRow(4)
          )
        : conversations.length === 0
        ? React.createElement('div', { style: { padding: '20px', textAlign: 'center', color: '#72767d', fontSize: '13px' } }, 'No conversations yet')
        : conversations.map(function(convo) {
            var isActive = activeConvo === convo.key;
            return React.createElement('div', {
              key: convo.key,
              onClick: function() { setActiveConvo(convo.key); },
              style: {
                display: 'flex', alignItems: 'center', padding: '10px 12px', gap: '10px',
                borderRadius: '6px', cursor: 'pointer', marginBottom: '2px',
                background: isActive ? '#2a2a2e' : 'transparent',
                transition: 'background 0.15s',
              }
            },
              // Online dot
              React.createElement('div', {
                style: {
                  width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                  background: convo.online ? '#57f287' : '#72767d',
                }
              }),
              // Name and time
              React.createElement('div', { style: { flex: 1, overflow: 'hidden' } },
                React.createElement('div', {
                  style: { color: convo.color || '#dcddde', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
                }, convo.username || convo.key.slice(0, 8) + '...'),
                React.createElement('div', {
                  style: { color: '#72767d', fontSize: '11px', marginTop: '2px' }
                }, formatRelativeTime(convo.lastActivity))
              ),
              // Lock icon
              React.createElement('span', { style: { fontSize: '12px', color: '#57f287', flexShrink: 0 } }, '\uD83D\uDD12')
            );
          })
    )
  );

  // Message area (or placeholder if no active conversation)
  var messageArea;
  if (!activeConvo) {
    if (isMobile) {
      // On mobile, show sidebar only when no active conversation
      messageArea = null;
    } else {
      messageArea = React.createElement('div', {
        style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#72767d' }
      },
        React.createElement('div', { style: { fontSize: '48px', marginBottom: '12px' } }, '\uD83D\uDD12'),
        React.createElement('div', { style: { fontSize: '16px', fontWeight: 600 } }, 'Select a conversation'),
        React.createElement('div', { style: { fontSize: '13px', marginTop: '4px' } }, 'or start a new one')
      );
    }
  } else {
    messageArea = React.createElement('div', {
      style: { flex: 1, display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }
    },
      // Chat header
      React.createElement('div', {
        style: {
          padding: '10px 16px', borderBottom: '1px solid #2a2a2e', display: 'flex', alignItems: 'center', gap: '10px',
          background: '#18181b', flexShrink: 0,
        }
      },
        isMobile ? React.createElement('button', {
          onClick: function() { setActiveConvo(null); },
          style: {
            padding: '4px 8px', border: 'none', borderRadius: '4px', cursor: 'pointer',
            background: '#2a2a2e', color: '#dcddde', fontSize: '16px', fontFamily: 'inherit',
          }
        }, '\u2190') : null,
        React.createElement('span', {
          style: { color: activeProfile ? activeProfile.color : '#dcddde', fontWeight: 700, fontSize: '15px' }
        }, activeProfile ? activeProfile.username : (activeConvo.slice(0, 8) + '...')),
        activeProfile && activeProfile.online ? React.createElement('span', {
          style: { fontSize: '10px', color: '#57f287', marginLeft: '-4px' }
        }, '\u25CF Online') : null,
        React.createElement('div', { style: { flex: 1 } }),
        React.createElement('button', {
          onClick: rotateKeys,
          disabled: rotating,
          title: 'Rotate your encryption keys',
          style: {
            padding: '3px 8px', border: '1px solid #3a3a3e', borderRadius: '4px',
            cursor: rotating ? 'default' : 'pointer', background: rotating ? '#333' : '#2a2a2e',
            color: '#b5bac1', fontSize: '11px', fontWeight: 600, fontFamily: 'inherit',
            marginRight: '8px', transition: 'background 0.15s',
          }
        }, rotating ? 'Rotating...' : 'Rotate Keys'),
        // Verify button — only visible when both keys are available
        (function() {
          var myPub = BossCordCrypto.exportPublicKey();
          var peerInfo = otherPublicKeys[activeConvo];
          var peerPub = peerInfo ? ((typeof peerInfo === 'string') ? peerInfo : peerInfo.key) : null;
          if (myPub && peerPub) {
            return React.createElement('button', {
              onClick: openSafetyNumber,
              title: 'Verify encryption with safety number',
              style: {
                padding: '3px 8px', border: '1px solid #3a3a3e', borderRadius: '4px',
                cursor: 'pointer', background: '#2a2a2e',
                color: '#f0b232', fontSize: '11px', fontWeight: 600, fontFamily: 'inherit',
                marginRight: '8px', transition: 'background 0.15s',
                display: 'flex', alignItems: 'center', gap: '4px',
              }
            }, '\uD83D\uDEE1\uFE0F', ' Verify');
          }
          return null;
        })(),
        // Disappearing messages timer toggle button
        React.createElement('button', {
          onClick: cycleDisappearTimer,
          title: disappearTimer > 0
            ? 'Messages disappear after ' + getDisappearLabel(disappearTimer) + ' (click to change)'
            : 'Enable disappearing messages (click to cycle: 5m / 30m / 1h / Off)',
          style: {
            padding: '3px 8px', border: '1px solid ' + (disappearTimer > 0 ? 'rgba(240, 178, 50, 0.5)' : '#3a3a3e'),
            borderRadius: '4px', cursor: 'pointer',
            background: disappearTimer > 0 ? 'rgba(240, 178, 50, 0.15)' : '#2a2a2e',
            color: disappearTimer > 0 ? '#f0b232' : '#72767d',
            fontSize: '11px', fontWeight: 600, fontFamily: 'inherit',
            marginRight: '8px', transition: 'all 0.15s',
            display: 'flex', alignItems: 'center', gap: '3px',
          }
        },
          '\u23F1',
          disappearTimer > 0 ? getDisappearLabel(disappearTimer) : 'Off'
        ),
        React.createElement('span', {
          style: { fontSize: '11px', color: '#57f287', display: 'flex', alignItems: 'center', gap: '4px' }
        },
          '\uD83D\uDD12',
          'E2E',
          disappearTimer > 0
            ? React.createElement('span', {
                style: { color: '#f0b232', marginLeft: '2px', fontSize: '10px' }
              }, '\u00B7 ' + getDisappearLabel(disappearTimer))
            : null
        )
      ),
      // Key change warning banner
      (activeConvo && keyWarnings[activeConvo]) ? React.createElement('div', {
        style: {
          padding: '10px 16px', background: 'rgba(240, 178, 50, 0.15)',
          borderBottom: '1px solid rgba(240, 178, 50, 0.3)',
          display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
        }
      },
        React.createElement('span', {
          style: { fontSize: '16px', flexShrink: 0 }
        }, '\u26A0\uFE0F'),
        React.createElement('span', {
          style: { flex: 1, color: '#f0b232', fontSize: '12px', lineHeight: '1.4' }
        }, keyWarnings[activeConvo]),
        React.createElement('button', {
          onClick: function() { dismissKeyWarning(activeConvo); },
          style: {
            padding: '2px 8px', border: '1px solid rgba(240, 178, 50, 0.4)', borderRadius: '4px',
            cursor: 'pointer', background: 'transparent', color: '#f0b232',
            fontSize: '11px', fontWeight: 600, fontFamily: 'inherit', flexShrink: 0,
          }
        }, 'Dismiss')
      ) : null,
      // Messages
      React.createElement('div', {
        style: { flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '4px' }
      },
        messages.length === 0
          ? React.createElement('div', { style: { textAlign: 'center', color: '#72767d', padding: '40px 0', fontSize: '13px' } },
              'No messages yet. Say hello!'
            )
          : messages.map(function(msg, idx) {
              // Compute disappear countdown for this message if timer is active
              var timerEntry = disappearTimersRef.current.get(msg.id);
              var remainingMs = timerEntry ? Math.max(0, timerEntry.expiresAt - Date.now()) : 0;
              var isDisappearing = disappearTimer > 0 && timerEntry;

              return React.createElement('div', {
                key: msg.id || idx,
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.mine ? 'flex-end' : 'flex-start',
                  marginBottom: '2px',
                }
              },
                React.createElement('div', {
                  style: {
                    maxWidth: '75%',
                    padding: '8px 12px',
                    borderRadius: msg.mine ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    background: msg.error ? '#3d1f1f' : (msg.mine ? '#5865f2' : '#2a2a2e'),
                    color: msg.error ? '#ed4245' : '#dcddde',
                    fontSize: '14px',
                    lineHeight: '1.4',
                    wordBreak: 'break-word',
                  }
                }, msg.text),
                React.createElement('div', {
                  style: {
                    fontSize: '10px', color: '#72767d', marginTop: '2px', padding: '0 4px',
                    display: 'flex', alignItems: 'center', gap: '6px',
                    flexDirection: msg.mine ? 'row-reverse' : 'row',
                  }
                },
                  React.createElement('span', null, formatTime(msg.timestamp)),
                  isDisappearing ? React.createElement('span', {
                    style: {
                      color: remainingMs < 30000 ? '#ed4245' : '#f0b232',
                      fontSize: '9px',
                      display: 'flex', alignItems: 'center', gap: '2px',
                      opacity: remainingMs < 10000 ? 0.6 + 0.4 * Math.abs(Math.sin(Date.now() / 500)) : 0.8,
                    },
                    title: 'Message disappears in ' + formatCountdown(remainingMs)
                  },
                    '\u23F1 ' + formatCountdown(remainingMs)
                  ) : null
                )
              );
            }),
        React.createElement('div', { ref: messagesEndRef })
      ),
      // Input area
      React.createElement('div', {
        style: {
          padding: '8px 12px', borderTop: '1px solid #2a2a2e', display: 'flex', gap: '8px',
          background: '#18181b', flexShrink: 0,
        }
      },
        React.createElement('input', {
          value: inputText,
          onChange: function(e) { setInputText(e.target.value); },
          onKeyDown: function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } },
          placeholder: 'Type an encrypted message...',
          maxLength: 2000,
          style: {
            flex: 1, padding: '10px 12px', background: '#1e1f22', border: '1px solid #3a3a3e',
            borderRadius: '8px', color: '#dcddde', fontSize: '14px', outline: 'none', fontFamily: 'inherit',
          }
        }),
        React.createElement('button', {
          onClick: sendMessage,
          disabled: !inputText.trim(),
          style: {
            padding: '10px 16px', border: 'none', borderRadius: '8px', cursor: inputText.trim() ? 'pointer' : 'default',
            background: inputText.trim() ? '#5865f2' : '#3a3a3e', color: '#fff', fontSize: '14px', fontWeight: 600,
            fontFamily: 'inherit', transition: 'background 0.2s', flexShrink: 0,
          }
        }, 'Send')
      )
    );
  }

  // Safety number verification modal
  var safetyNumberModal = showSafetyNumber ? React.createElement('div', {
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0, 0, 0, 0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 10000,
    },
    onClick: function(e) {
      // Close on backdrop click
      if (e.target === e.currentTarget) setShowSafetyNumber(false);
    }
  },
    React.createElement('div', {
      style: {
        background: '#2a2a2e', borderRadius: '12px', padding: '32px', maxWidth: '420px', width: '90%',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)', textAlign: 'center',
      }
    },
      React.createElement('div', {
        style: { fontSize: '32px', marginBottom: '12px' }
      }, '\uD83D\uDEE1\uFE0F'),
      React.createElement('div', {
        style: { fontSize: '16px', fontWeight: 700, color: '#f0b232', marginBottom: '16px' }
      }, 'Safety Number'),
      React.createElement('div', {
        style: {
          fontFamily: 'monospace', fontSize: '18px', color: '#dcddde', lineHeight: '2.2',
          letterSpacing: '2px', padding: '16px', background: '#1c1c1e', borderRadius: '8px',
          marginBottom: '16px', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '4px 12px',
        }
      }, safetyNumber.split(' ').map(function(group, i) {
        return React.createElement('span', {
          key: i,
          style: { whiteSpace: 'nowrap' }
        }, group);
      })),
      React.createElement('div', {
        style: { fontSize: '13px', color: '#b5bac1', lineHeight: '1.5', marginBottom: '20px' }
      }, 'Compare this number with your contact. If they match, your conversation is secure.'),
      React.createElement('button', {
        onClick: function() { setShowSafetyNumber(false); },
        style: {
          padding: '10px 32px', border: 'none', borderRadius: '8px', cursor: 'pointer',
          background: '#5865f2', color: '#fff', fontSize: '14px', fontWeight: 600,
          fontFamily: 'inherit', transition: 'background 0.2s',
        }
      }, 'Close')
    )
  ) : null;

  // Status bar
  var statusBar = status ? React.createElement('div', {
    style: { padding: '6px 16px', background: '#2d2d30', color: '#57f287', fontSize: '12px', textAlign: 'center', flexShrink: 0 }
  }, status) : null;

  // On mobile, show sidebar OR message area, not both
  if (isMobile) {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', background: '#1c1c1e' }
    },
      statusBar,
      activeConvo ? messageArea : sidebarContent,
      safetyNumberModal
    );
  }

  // Desktop: sidebar + message area side by side
  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', height: '100%', background: '#1c1c1e' }
  },
    statusBar,
    React.createElement('div', {
      style: { display: 'flex', flex: 1, overflow: 'hidden' }
    },
      sidebarContent,
      messageArea
    ),
    safetyNumberModal
  );
}
