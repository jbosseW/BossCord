var BOSSCORD_TOS = 'TERMS OF SERVICE - BOSSCORD\n\nLast Updated: February 13, 2026\n\nWelcome to Bosscord ("Service," "Platform," "we," "us," or "our"). By accessing or using Bosscord, you agree to be bound by these Terms of Service ("Terms"). If you do not agree, do not use the Service.\n\n1. Eligibility\n\nYou must be at least 18 years old (or the age of majority in your jurisdiction) to use the Service. By using Bosscord, you represent and warrant that you meet this requirement.\n\n2. Nature of the Service\n\nBosscord provides a communications and data relay platform that enables users to exchange information directly with one another.\n\nBosscord does not create, initiate, edit, store, or endorse user content.\n\nUsers are solely responsible for any content they transmit, receive, or access.\n\n3. User Responsibility\n\nYou agree that you are solely responsible for:\n\nAll activity conducted through your use of the Service\n\nCompliance with all applicable local, state, federal, and international laws\n\nAny content you transmit, share, or access\n\nBosscord does not control and is not responsible for user content.\n\n4. Prohibited Activities\n\nYou may not use Bosscord to:\n\nViolate any law or regulation\n\nInfringe intellectual property rights\n\nDistribute malware, exploits, or harmful code\n\nHarass, threaten, stalk, or abuse others\n\nDistribute or facilitate child sexual abuse material (CSAM)\n\nEngage in fraud, extortion, or deceptive practices\n\nFacilitate terrorism, human trafficking, or violent wrongdoing\n\nAttempt to bypass, probe, or exploit Bosscord\'s systems\n\nAttempting to circumvent safeguards or abuse infrastructure is strictly prohibited.\n\n5. Enforcement & Termination\n\nBosscord reserves the right, at its sole discretion, to:\n\nSuspend or terminate access\n\nBlock identifiers, IP ranges, or devices\n\nRemove access to the Service without notice\n\nBosscord is under no obligation to provide advance notice or justification.\n\n6. Reporting & Cooperation\n\nBosscord may investigate suspected violations.\n\nWhere required or deemed appropriate, Bosscord may:\n\nPreserve relevant records\n\nReport activity to law enforcement or regulatory authorities\n\nComply with subpoenas, court orders, and lawful requests\n\n7. No Monitoring Obligation\n\nBosscord does not actively monitor user content. However, Bosscord reserves the right to investigate reports of abuse or illegal activity.\n\nNothing in these Terms creates an obligation for Bosscord to monitor, screen, or review content.\n\n8. Intellectual Property\n\nBosscord does not claim ownership over user content.\n\nUsers retain all rights to content they create, subject to these Terms.\n\nYou grant Bosscord a limited, non-exclusive license solely to operate and maintain the Service.\n\n9. Disclaimer of Warranties\n\nThe Service is provided "AS IS" and "AS AVAILABLE."\n\nBosscord makes no warranties, express or implied, including but not limited to:\n\nMerchantability\n\nFitness for a particular purpose\n\nNon-infringement\n\nBosscord does not guarantee uninterrupted or error-free operation.\n\n10. Limitation of Liability\n\nTo the maximum extent permitted by law:\n\nBosscord shall not be liable for indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or goodwill.\n\nBosscord\'s total liability shall not exceed $100 USD or the amount you paid Bosscord in the past 12 months, whichever is greater.\n\n11. Indemnification\n\nYou agree to indemnify and hold harmless Bosscord, its owners, officers, directors, employees, and agents from any claims arising out of:\n\nYour use of the Service\n\nYour violation of these Terms\n\nYour violation of any law or third-party rights\n\n12. DMCA / Copyright Policy\n\nBosscord complies with the Digital Millennium Copyright Act.\n\nTakedown notices should be sent to:\nmidwestmysterymeatstudios@gmail.com\n\nRepeat infringers may have their access terminated.\n\n13. Privacy\n\nUse of the Service is subject to Bosscord\'s Privacy Policy.\n\n14. Changes to Terms\n\nBosscord may update these Terms at any time. Continued use of the Service constitutes acceptance of the updated Terms.\n\n15. Governing Law\n\nThese Terms shall be governed by the laws of the United States, without regard to conflict-of-law principles.';

function LandingPage() {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var [tosAccepted, setTosAccepted] = useState(!!localStorage.getItem('bosscord_tos_accepted'));
  var [nameInput, setNameInput] = useState('');
  var [topTab, setTopTab] = useState('chat');
  var [tab, setTab] = useState('public'); // 'public' | 'create' | 'join'
  var [roomName, setRoomName] = useState('');
  var [roomDescription, setRoomDescription] = useState('');
  var [roomIsPublic, setRoomIsPublic] = useState(false);
  var [roomEncrypted, setRoomEncrypted] = useState(false);
  var [roomCategory, setRoomCategory] = useState('General');
  var [categoryFilter, setCategoryFilter] = useState('All');
  var [joinCode, setJoinCode] = useState('');
  var [hoveredRoom, setHoveredRoom] = useState(null);
  var CATEGORY_TABS = ['All', 'General', 'Gaming', 'Music', 'Art', 'Tech'];
  var ROOM_CATEGORY_OPTIONS = ['General', 'Gaming', 'Music', 'Art', 'Tech'];
  var [publicRoomsLoaded, setPublicRoomsLoaded] = useState(false);
  var [soundMuted, setSoundMuted] = useState(function() {
    return window.BossSounds ? window.BossSounds.isMuted() : false;
  });
  var [showKeyInput, setShowKeyInput] = useState(false);
  var [keyInput, setKeyInput] = useState('');
  var [keyUsername, setKeyUsername] = useState(null);
  var [keyLookupError, setKeyLookupError] = useState(null);
  var [showKeyModal, setShowKeyModal] = useState(false);
  var [keyCopied, setKeyCopied] = useState(false);
  var [pinInput, setPinInput] = useState('');
  var [pinConfirm, setPinConfirm] = useState('');
  var [showPinSetup, setShowPinSetup] = useState(false);
  var [pinSetupForClaim, setPinSetupForClaim] = useState(false);
  var savedKeyValue = localStorage.getItem('bosscord_key');
  var hasSavedKey = savedKeyValue && savedKeyValue.length >= 12;
  var [useSavedKey, setUseSavedKey] = useState(true);

  // Watch for account creation to show key modal (only on NEW account, not existing key login)
  var prevAccountKey = useRef(ctx.accountKey);
  var justCreatedAccount = useRef(false);
  useEffect(function() {
    if (ctx.accountKey && ctx.accountKey !== prevAccountKey.current && !prevAccountKey.current && justCreatedAccount.current) {
      setShowKeyModal(true);
      setKeyCopied(false);
      justCreatedAccount.current = false;
    }
    prevAccountKey.current = ctx.accountKey;
  }, [ctx.accountKey]);

  // Auto-lookup username when key is entered (12 chars)
  useEffect(function() {
    var key = keyInput.trim();
    if (key.length < 12) {
      setKeyUsername(null);
      setKeyLookupError(null);
      return;
    }
    var cancelled = false;
    fetch('/api/account/lookup/' + encodeURIComponent(key))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (cancelled) return;
        if (data.username) {
          setKeyUsername(data.username);
          setKeyLookupError(null);
          setNameInput(data.username);
        } else {
          setKeyUsername(null);
          setKeyLookupError('Key not found');
        }
      })
      .catch(function() {
        if (!cancelled) { setKeyUsername(null); setKeyLookupError('Key not found'); }
      });
    return function() { cancelled = true; };
  }, [keyInput]);

  // IntersectionObserver for staggered room card entrance animations
  var roomListRef = useRef(null);
  useEffect(function() {
    if (!roomListRef.current) return;
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          var idx = parseInt(entry.target.getAttribute('data-card-index') || '0', 10);
          var delay = idx * 100;
          entry.target.style.transition = 'opacity 0.5s ease-out ' + delay + 'ms, transform 0.5s ease-out ' + delay + 'ms';
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    var cards = roomListRef.current.querySelectorAll('[data-room-card]');
    cards.forEach(function(card) {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px)';
      observer.observe(card);
    });

    return function() { observer.disconnect(); };
  }, [ctx.publicRooms, tab, categoryFilter, publicRoomsLoaded]);

  // Track when public rooms data first arrives from server
  var publicRoomsReceivedRef = useRef(false);
  useEffect(function() {
    if (!ctx.user) {
      setPublicRoomsLoaded(false);
      publicRoomsReceivedRef.current = false;
      return;
    }
    if (publicRoomsReceivedRef.current) return;
    if (ctx.publicRooms && ctx.publicRooms.length > 0) {
      publicRoomsReceivedRef.current = true;
      setPublicRoomsLoaded(true);
      return;
    }
    // If user is connected but publicRooms is empty, wait a moment
    // then mark as loaded (server might genuinely have no public rooms)
    var timer = setTimeout(function() {
      if (!publicRoomsReceivedRef.current) {
        publicRoomsReceivedRef.current = true;
        setPublicRoomsLoaded(true);
      }
    }, 1500);
    return function() { clearTimeout(timer); };
  }, [ctx.publicRooms, ctx.user]);

  // Chips counter roll animation on landing hub
  var hubChipsRef = useRef(null);
  var prevHubChipsRef = useRef((ctx.account && ctx.account.chips) || 0);
  useEffect(function() {
    var currentChips = (ctx.account && ctx.account.chips) || 0;
    var prevChips = prevHubChipsRef.current;
    if (currentChips !== prevChips && hubChipsRef.current && window.BossEffects) {
      window.BossEffects.numberRoll(hubChipsRef.current, prevChips, currentChips, 600, function(v) {
        return Math.floor(v).toLocaleString() + ' chips';
      });
    }
    prevHubChipsRef.current = currentChips;
  }, [ctx.account && ctx.account.chips]);

  function handleConnect() {
    var keyToUse = showKeyInput && keyInput.trim() ? keyInput.trim() : undefined;
    // Validate key length
    if (keyToUse && (keyToUse.length < 12 || !/^[a-zA-Z0-9]+$/.test(keyToUse))) {
      setKeyLookupError('Key must be at least 12 alphanumeric characters');
      return;
    }
    // Allow empty name — server will generate a random character name
    var name = keyUsername || nameInput.trim() || undefined;
    // Don't save key to localStorage here — server will confirm validity
    var pinToUse = pinInput.trim() || undefined;
    ctx.connectSocket(name, keyToUse, pinToUse);
  }

  function handleCreateRoom() {
    var name = roomName.trim();
    if (!name || !ctx.socket) return;
    var isEncrypted = !roomIsPublic && roomEncrypted;
    var roomSecret = null;
    if (isEncrypted && typeof BossCordCrypto !== 'undefined') {
      roomSecret = BossCordCrypto.generateRoomSecret();
      window._pendingRoomSecret = roomSecret;
    }
    ctx.socket.emit('create_room', {
      name: name,
      isPublic: roomIsPublic,
      description: roomDescription.trim(),
      encrypted: isEncrypted,
      category: roomCategory
    });
    setRoomName('');
    setRoomDescription('');
    setRoomIsPublic(false);
    setRoomEncrypted(false);
    setRoomCategory('General');
  }

  function handleJoinRoom() {
    var rawCode = joinCode.trim();
    if (!rawCode || !ctx.socket) return;
    var parts = rawCode.split('.');
    var code = parts[0].toUpperCase();
    var secret = parts.length > 1 ? parts[1] : null;
    if (secret && typeof BossCordCrypto !== 'undefined') {
      window._pendingJoinRoomSecret = secret;
      window._pendingJoinRoomCode = code;
    }
    ctx.socket.emit('join_room', { code: code });
    setJoinCode('');
  }

  function handleJoinPublicRoom(code) {
    if (!ctx.socket) return;
    ctx.socket.emit('join_room', { code: code });
  }

  var containerStyle = {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', width: '100%',
    background: 'linear-gradient(135deg, #1c1c1e 0%, #2a1f0e 50%, #1c1c1e 100%)',
    backgroundSize: '200% 200%',
    animation: 'holoShift 8s ease infinite',
    position: 'relative'
  };

  var cardStyle = {
    background: '#252528', borderRadius: isMobile ? '0' : '10px',
    borderTop: isMobile ? 'none' : '3px solid #f0b232',
    padding: isMobile ? '8px 12px' : '32px',
    width: isMobile ? '100%' : '520px',
    maxWidth: isMobile ? '100%' : '90vw',
    animation: 'fadeIn 0.3s ease',
    maxHeight: isMobile ? '100%' : '85vh',
    height: isMobile ? '100%' : 'auto',
    display: 'flex', flexDirection: 'column'
  };

  var inputStyle = {
    width: '100%', padding: '10px 12px', background: '#18181b',
    border: 'none', borderRadius: '4px', color: '#dcddde',
    fontSize: '16px', outline: 'none', fontFamily: 'inherit',
    minHeight: '44px'
  };

  var btnPrimary = {
    width: '100%', padding: '10px', background: '#f0b232',
    border: 'none', borderRadius: '4px', color: '#1c1c1e',
    fontSize: '16px', fontWeight: 600, cursor: 'pointer',
    fontFamily: 'inherit', marginTop: '16px', minHeight: '44px'
  };

  var btnSecondary = {
    width: '100%', padding: '10px', background: 'transparent',
    border: '1px solid #f0b232', borderRadius: '4px', color: '#f0b232',
    fontSize: '16px', fontWeight: 600, cursor: 'pointer',
    fontFamily: 'inherit', marginTop: '8px', minHeight: '44px'
  };

  var tabStyle = function(active) {
    return {
      flex: 1, padding: isMobile ? '6px 8px' : '10px 16px', background: active ? '#f0b232' : '#18181b',
      border: 'none', borderRadius: isMobile ? '14px' : '20px', color: active ? '#1c1c1e' : '#949ba4',
      fontSize: isMobile ? '12px' : '14px', fontWeight: 600, cursor: 'pointer',
      fontFamily: 'inherit', transition: 'all 0.2s', minHeight: isMobile ? '32px' : '44px'
    };
  };

  // TOS gate - must accept before using the platform
  if (!tosAccepted) {
    return React.createElement('div', {
      style: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: '#1c1c1e', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', zIndex: 99999
      }
    },
      React.createElement('div', {
        style: {
          background: '#252528', borderRadius: isMobile ? '0' : '10px',
          borderTop: '3px solid #f0b232', padding: isMobile ? '16px' : '32px',
          width: isMobile ? '100%' : '600px', maxWidth: '95vw',
          maxHeight: isMobile ? '100%' : '85vh', height: isMobile ? '100%' : 'auto',
          display: 'flex', flexDirection: 'column'
        }
      },
        React.createElement('h2', {
          style: { color: '#f0b232', textAlign: 'center', fontSize: '20px', fontWeight: 700, marginBottom: '16px', flexShrink: 0 }
        }, 'Terms of Service'),
        React.createElement('div', {
          style: {
            flex: 1, overflow: 'auto', background: '#18181b', borderRadius: '6px',
            padding: '16px', marginBottom: '16px', color: '#b0b0b0',
            fontSize: '13px', lineHeight: '1.7', whiteSpace: 'pre-wrap',
            fontFamily: 'inherit', minHeight: '200px'
          }
        }, BOSSCORD_TOS),
        React.createElement('button', {
          style: {
            width: '100%', padding: '12px', background: '#f0b232',
            border: 'none', borderRadius: '4px', color: '#1c1c1e',
            fontSize: '16px', fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', flexShrink: 0
          },
          onClick: function() {
            localStorage.setItem('bosscord_tos_accepted', '2026-02-13');
            setTosAccepted(true);
            // Sync to server if connected
            if (ctx.socket) ctx.socket.emit('tos_accept');
          }
        }, 'I Agree')
      )
    );
  }

  // Not connected yet - login screen
  if (!ctx.user) {
    return React.createElement('div', { style: containerStyle },
      React.createElement(WipeWarningBanner),
      React.createElement('div', { style: cardStyle },
        React.createElement('h1', {
          style: { textAlign: 'center', marginBottom: '4px', fontSize: '28px', fontWeight: 700, textShadow: '0 0 12px rgba(240,178,50,0.3)' }
        },
          React.createElement('span', { style: { color: '#f0b232' } }, 'Boss'),
          React.createElement('span', { style: { color: '#e8e6e3' } }, 'Cord')
        ),
        React.createElement('p', {
          style: { textAlign: 'center', color: '#949ba4', fontSize: '14px', marginBottom: '24px' }
        }, 'No IDs, no emails, no forced accounts, no traces. Just chatting and gaming.'),
        // Saved key indicator
        hasSavedKey && !showKeyInput ? React.createElement('div', {
          style: {
            background: '#18181b', borderRadius: '8px', padding: '12px 16px',
            marginBottom: '16px', border: '1px solid #393c43'
          }
        },
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }
          },
            React.createElement('span', {
              style: { color: '#57f287', fontSize: '13px', fontWeight: 600 }
            }, 'Saved account key detected'),
            React.createElement('span', {
              style: { color: '#949ba4', fontSize: '12px', fontFamily: 'monospace' }
            }, savedKeyValue.slice(0, 3) + '...' + savedKeyValue.slice(-3))
          ),
          React.createElement('div', {
            style: { display: 'flex', gap: '8px' }
          },
            React.createElement('button', {
              style: {
                flex: 1, padding: '6px 12px', background: '#f0b232', border: 'none',
                borderRadius: '4px', color: '#1c1c1e', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit'
              },
              onClick: function() { setUseSavedKey(true); }
            }, 'Continue with saved key'),
            React.createElement('button', {
              style: {
                padding: '6px 12px', background: 'transparent', border: '1px solid #ed4245',
                borderRadius: '4px', color: '#ed4245', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit'
              },
              onClick: function() {
                localStorage.removeItem('bosscord_key');
                sessionStorage.removeItem('bosscord_pin');
                setUseSavedKey(false);
                setShowKeyInput(false);
                setKeyInput('');
                setKeyUsername(null);
              }
            }, 'Clear key')
          ),
          // PIN input for saved key
          React.createElement('div', { style: { marginTop: '12px' } },
            React.createElement('label', {
              style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.02em' }
            }, 'Account PIN'),
            React.createElement('input', {
              type: 'password', style: Object.assign({}, inputStyle, { fontSize: '16px', letterSpacing: '0.2em', textAlign: 'center' }),
              placeholder: '4-digit PIN',
              value: pinInput,
              onChange: function(e) { setPinInput(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)); },
              onKeyDown: function(e) { if (e.key === 'Enter') handleConnect(); },
              maxLength: 4
            })
          )
        ) : null,
        React.createElement('label', {
          style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.02em' }
        }, 'Display Name'),
        React.createElement('input', {
          type: 'text',
          style: Object.assign({}, inputStyle, keyUsername ? { opacity: 0.6, color: '#949ba4', cursor: 'not-allowed' } : {}),
          placeholder: 'Enter a name or leave blank for random...',
          value: nameInput,
          onChange: function(e) { if (!keyUsername) setNameInput(e.target.value.replace(/[^a-zA-Z0-9 ]/g, '')); },
          onPaste: blockPaste, onDrop: blockDrop,
          onKeyDown: function(e) { if (e.key === 'Enter') handleConnect(); },
          maxLength: 20, autoFocus: true,
          disabled: !!keyUsername,
          readOnly: !!keyUsername,
        }),
        keyUsername ? React.createElement('div', {
          style: { fontSize: '11px', color: '#57f287', marginTop: '4px' }
        }, 'Account found: ' + keyUsername) : null,
        keyLookupError ? React.createElement('div', {
          style: { fontSize: '11px', color: '#ed4245', marginTop: '4px' }
        }, keyLookupError) : null,
        // "I have a key" toggle
        React.createElement('div', {
          style: { marginTop: '12px' }
        },
          React.createElement('span', {
            style: {
              color: '#f0b232', fontSize: '12px', cursor: 'pointer',
              textDecoration: 'underline', userSelect: 'none'
            },
            onClick: function() {
              var next = !showKeyInput;
              setShowKeyInput(next);
              if (!next) { setKeyInput(''); setKeyUsername(null); setKeyLookupError(null); setNameInput(''); }
            }
          }, showKeyInput ? 'Hide key input' : 'I have a key'),
          showKeyInput ? React.createElement('div', {
            style: { marginTop: '8px' }
          },
            React.createElement('label', {
              style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.02em' }
            }, 'Account Key'),
            React.createElement('input', {
              type: 'text', style: Object.assign({}, inputStyle, { fontSize: '14px' }),
              placeholder: 'Paste your account key...',
              value: keyInput,
              onChange: function(e) { setKeyInput(e.target.value.replace(/[^a-zA-Z0-9]/g, '')); },
              onKeyDown: function(e) { if (e.key === 'Enter') handleConnect(); },
              maxLength: 64
            }),
            React.createElement('label', {
              style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px', marginTop: '12px', letterSpacing: '0.02em' }
            }, 'Account PIN'),
            React.createElement('input', {
              type: 'password', style: Object.assign({}, inputStyle, { fontSize: '16px', letterSpacing: '0.2em', textAlign: 'center' }),
              placeholder: '4-digit PIN',
              value: pinInput,
              onChange: function(e) { setPinInput(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)); },
              onKeyDown: function(e) { if (e.key === 'Enter') handleConnect(); },
              maxLength: 4
            })
          ) : null
        ),
        React.createElement('button', {
          style: Object.assign({}, btnPrimary, {
            background: 'linear-gradient(135deg, #f0b232, #f5c563)',
            transition: 'all 0.2s ease'
          }, ctx.powStatus === 'solving' ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
          onClick: handleConnect,
          disabled: ctx.powStatus === 'solving',
          onMouseEnter: function(e) {
            if (ctx.powStatus !== 'solving') {
              e.currentTarget.style.boxShadow = '0 0 16px rgba(240,178,50,0.3)';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }
          },
          onMouseLeave: function(e) {
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.transform = 'translateY(0)';
          }
        }, ctx.powStatus === 'solving' ? 'Solving challenge...' : 'Enter'),
        ctx.errorMessage ? React.createElement('p', {
          style: { color: '#ed4245', fontSize: '13px', marginTop: '12px', textAlign: 'center' }
        }, ctx.errorMessage) : null,
        React.createElement('p', {
          style: { textAlign: 'center', color: '#949ba4', fontSize: '12px', marginTop: '24px', fontStyle: 'italic' }
        }, 'Everything here is ephemeral. When you leave, it\'s gone.')
      )
    );
  }

  // Connected but no room - hub with top tabs
  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
  },
    React.createElement(WipeWarningBanner),
    isMobile ? null : React.createElement(TopTabBar, { activeTab: topTab, onTabChange: setTopTab, compact: false }),

    // Legacy account PIN setup prompt
    ctx.pinSetupRequired ? React.createElement('div', {
      style: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.75)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 9999
      }
    },
      React.createElement('div', {
        style: {
          background: '#252528', borderRadius: '10px', padding: '28px',
          width: '380px', maxWidth: '90vw', borderTop: '3px solid #f0b232'
        }
      },
        React.createElement('h3', {
          style: { color: '#f0b232', fontSize: '18px', fontWeight: 700, marginBottom: '8px', textAlign: 'center' }
        }, 'Secure Your Account'),
        React.createElement('p', {
          style: { color: '#949ba4', fontSize: '13px', marginBottom: '16px', textAlign: 'center' }
        }, 'Set a 4-character PIN to protect your account. You will need this PIN on every login.'),
        React.createElement('input', {
          type: 'password',
          style: {
            width: '100%', padding: '12px', background: '#18181b',
            border: 'none', borderRadius: '4px', color: '#dcddde',
            fontSize: '20px', outline: 'none', fontFamily: 'monospace',
            letterSpacing: '0.3em', textAlign: 'center', marginBottom: '8px'
          },
          placeholder: 'Set PIN',
          value: pinInput,
          onChange: function(e) { setPinInput(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)); },
          maxLength: 4, autoFocus: true
        }),
        React.createElement('input', {
          type: 'password',
          style: {
            width: '100%', padding: '12px', background: '#18181b',
            border: 'none', borderRadius: '4px', color: '#dcddde',
            fontSize: '20px', outline: 'none', fontFamily: 'monospace',
            letterSpacing: '0.3em', textAlign: 'center'
          },
          placeholder: 'Confirm PIN',
          value: pinConfirm,
          onChange: function(e) { setPinConfirm(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)); },
          maxLength: 4
        }),
        pinInput.length === 4 && pinConfirm.length === 4 && pinInput !== pinConfirm ?
          React.createElement('p', { style: { color: '#ed4245', fontSize: '12px', marginTop: '8px', textAlign: 'center' } }, 'PINs do not match') : null,
        React.createElement('button', {
          style: {
            width: '100%', padding: '10px', background: '#f0b232', border: 'none',
            borderRadius: '4px', color: '#1c1c1e', fontSize: '14px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit', marginTop: '12px',
            opacity: pinInput.length === 4 && pinInput === pinConfirm ? 1 : 0.5
          },
          disabled: pinInput.length !== 4 || pinInput !== pinConfirm,
          onClick: function() {
            if (pinInput.length === 4 && pinInput === pinConfirm && ctx.socket) {
              ctx.socket.emit('account_set_pin', { pin: pinInput });
              setPinInput('');
              setPinConfirm('');
            }
          }
        }, 'Set PIN')
      )
    ) : null,

    topTab === 'cords' ? React.createElement(CordsTab) :
    topTab === 'games' ? React.createElement(GamesTab) :
    topTab === 'leaderboard' ? React.createElement(LeaderboardTab) :
    topTab === 'friends' ? React.createElement(FriendsPanel) :
    topTab === 'dms' ? React.createElement(DMView) :
    topTab === 'roulette' ? React.createElement(RouletteView) :
    topTab === 'profile' ? React.createElement(ProfileView, { onTabChange: setTopTab }) :
    topTab === 'about' ? React.createElement(AboutTab) :
    topTab === 'report' ? React.createElement(ReportView) :
    topTab === 'bugreport' ? React.createElement(BugReportView) :
    topTab === 'featurerequest' ? React.createElement(FeatureRequestView) :

    // Chat tab - room browsing UI
    React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', overflow: 'auto', WebkitOverflowScrolling: 'touch' } },
      React.createElement('div', { style: cardStyle },
        // Mobile: compact header row
        isMobile ? React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '4px 0', marginBottom: '8px', flexShrink: 0
          }
        },
          // Small avatar
          ctx.user && ctx.user.avatar
            ? React.createElement('img', {
                src: ctx.user.avatar,
                style: { width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }
              })
            : React.createElement('div', {
                style: {
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: (ctx.user && ctx.user.color) || '#f0b232', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: '12px', color: '#fff', flexShrink: 0
                }
              }, ((ctx.user && ctx.user.name) || '?')[0].toUpperCase()),
          // Name + chips inline
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', {
              style: { fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }
            },
              ctx.user && ctx.user.name,
              ctx.account && !ctx.account.temp ? React.createElement('span', { style: { fontSize: '11px', color: '#f0b232' } }, '\uD83D\uDD11') : null,
              ctx.account ? React.createElement('span', {
                style: { fontSize: '11px', color: '#f0b232', fontWeight: 600, marginLeft: '2px' }
              }, (ctx.account.chips || 0).toLocaleString() + ' chips') : null
            )
          ),
          // Claim key button (compact) — show for temp accounts
          ctx.account && ctx.account.temp ? React.createElement('button', {
            style: {
              padding: '4px 10px', background: 'transparent',
              border: '1px solid #f0b232', borderRadius: '14px',
              color: '#f0b232', fontSize: '11px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap'
            },
            onClick: function() { setPinSetupForClaim(true); },
            disabled: ctx.powStatus === 'solving_account'
          }, '\uD83D\uDD11 Claim') : null,
          // Sound toggle button (mobile)
          React.createElement('button', {
            style: {
              padding: '3px 8px', background: soundMuted ? '#4e5058' : '#2d5a2d',
              border: '1px solid ' + (soundMuted ? '#6d6f78' : '#57f287'),
              borderRadius: '14px', color: soundMuted ? '#949ba4' : '#57f287',
              fontSize: '10px', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', flexShrink: 0, whiteSpace: 'nowrap',
              transition: 'all 0.15s'
            },
            onClick: function() {
              if (window.BossSounds) {
                var nowMuted = window.BossSounds.toggleMute();
                setSoundMuted(nowMuted);
              }
            },
            title: soundMuted ? 'Unmute sounds' : 'Mute sounds'
          }, soundMuted ? 'SFX OFF' : 'SFX ON'),
          // Disconnect X button
          React.createElement('button', {
            style: {
              width: '28px', height: '28px', borderRadius: '50%',
              background: 'transparent', border: '1px solid #ed4245',
              color: '#ed4245', fontSize: '14px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, fontFamily: 'inherit', padding: 0
            },
            onClick: ctx.disconnectSocket,
            title: 'Disconnect'
          }, '\u2715')
        ) : null,

        // User info header
        !isMobile && ctx.user ? React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '20px', gap: '12px', flexShrink: 0 }
        },
          ctx.user.avatar
            ? React.createElement('img', {
                src: ctx.user.avatar,
                style: {
                  width: '40px', height: '40px', borderRadius: '50%',
                  objectFit: 'cover', flexShrink: 0
                }
              })
            : React.createElement('div', {
                style: {
                  width: '40px', height: '40px', borderRadius: '50%',
                  background: ctx.user.color || '#f0b232', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontWeight: 700,
                  fontSize: '18px', color: '#fff', flexShrink: 0
                }
              }, (ctx.user.name || '?')[0].toUpperCase()),
          React.createElement('div', null,
            React.createElement('div', { style: { fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' } },
              ctx.user.name,
              ctx.account && !ctx.account.temp ? React.createElement('span', {
                style: { fontSize: '14px', color: '#f0b232' },
                title: 'Verified account'
              }, '\uD83D\uDD11') : null
            ),
            ctx.account ? React.createElement('div', {
              ref: hubChipsRef,
              style: { color: '#f0b232', fontSize: '12px', fontWeight: 600 }
            }, (ctx.account.chips != null ? ctx.account.chips : 0) + ' chips') :
            React.createElement('div', { style: { color: '#949ba4', fontSize: '12px' } }, 'Anonymous')
          ),
          // Sound toggle button (desktop)
          React.createElement('button', {
            style: {
              padding: '4px 10px', background: soundMuted ? '#4e5058' : '#2d5a2d',
              border: '1px solid ' + (soundMuted ? '#6d6f78' : '#57f287'),
              borderRadius: '6px', color: soundMuted ? '#949ba4' : '#57f287',
              fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit', transition: 'all 0.15s',
              marginLeft: '8px', whiteSpace: 'nowrap'
            },
            onClick: function() {
              if (window.BossSounds) {
                var nowMuted = window.BossSounds.toggleMute();
                setSoundMuted(nowMuted);
              }
            },
            title: soundMuted ? 'Unmute sounds' : 'Mute sounds'
          }, soundMuted ? 'Sound OFF' : 'Sound ON')
        ) : null,

        // Claim key or Delete account button
        !isMobile ? (
        ctx.account && ctx.account.temp ? React.createElement('div', {
          style: { textAlign: 'center', marginBottom: '12px', flexShrink: 0 }
        },
          React.createElement('button', {
            style: Object.assign({
              padding: '6px 16px', background: 'transparent',
              border: '1px solid #f0b232', borderRadius: '20px',
              color: '#f0b232', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit'
            }, ctx.powStatus === 'solving_account' ? { opacity: 0.6, cursor: 'not-allowed' } : {}),
            onClick: function() { setPinSetupForClaim(true); },
            disabled: ctx.powStatus === 'solving_account'
          }, ctx.powStatus === 'solving_account' ? 'Solving challenge...' : '\uD83D\uDD11 Claim Your Key'),
          React.createElement('div', {
            style: { color: '#72767d', fontSize: '10px', marginTop: '4px' }
          }, 'Accounts expire after 60 days of inactivity')
        ) : React.createElement('div', {
          style: { textAlign: 'center', marginBottom: '12px', flexShrink: 0 }
        },
          React.createElement('button', {
            style: {
              padding: '4px 12px', background: 'transparent',
              border: '1px solid #ed4245', borderRadius: '20px',
              color: '#ed4245', fontSize: '11px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s'
            },
            onClick: function() {
              if (confirm('Are you sure? This will permanently delete your account and all saved data. This cannot be undone.')) {
                ctx.deleteAccount();
              }
            },
            onMouseEnter: function(e) { e.currentTarget.style.background = '#ed4245'; e.currentTarget.style.color = '#fff'; },
            onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ed4245'; }
          }, 'Delete Account'),
          // Slur filter toggle
          React.createElement('button', {
            style: {
              padding: '4px 12px', background: ctx.slurFilterEnabled ? 'rgba(87,242,135,0.15)' : 'transparent',
              border: '1px solid ' + (ctx.slurFilterEnabled ? '#57f287' : '#555'),
              borderRadius: '20px', marginLeft: '8px',
              color: ctx.slurFilterEnabled ? '#57f287' : '#949ba4', fontSize: '11px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 0.15s'
            },
            onClick: function() { ctx.toggleSlurFilter(); },
            title: ctx.slurFilterEnabled ? 'Slur filter is ON — click to disable' : 'Enable slur filter to hide offensive words'
          }, ctx.slurFilterEnabled ? 'Filter: ON' : 'Filter: OFF')
        )
        ) : null,

        // Key created modal overlay
        showKeyModal && ctx.accountKey ? React.createElement('div', {
          style: {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.75)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 9999
          },
          onClick: function(e) { if (e.target === e.currentTarget) setShowKeyModal(false); }
        },
          React.createElement('div', {
            style: {
              background: '#252528', borderRadius: '10px', padding: '28px',
              width: '400px', maxWidth: '90vw', borderTop: '3px solid #f0b232',
              animation: 'fadeIn 0.2s ease'
            }
          },
            React.createElement('h3', {
              style: { color: '#f0b232', fontSize: '18px', fontWeight: 700, marginBottom: '12px', textAlign: 'center' }
            }, '\uD83D\uDD11 Your Account Key'),
            React.createElement('p', {
              style: { color: '#ed4245', fontSize: '13px', marginBottom: '8px', textAlign: 'center', fontWeight: 600 }
            }, 'Save this key! It won\'t be shown again.'),
            React.createElement('p', {
              style: { color: '#949ba4', fontSize: '11px', marginBottom: '12px', textAlign: 'center' }
            }, 'Accounts inactive for 60 days are automatically deleted.'),
            React.createElement('div', {
              style: {
                background: '#18181b', padding: '10px 12px', borderRadius: '6px',
                fontFamily: 'monospace', fontSize: '14px', color: '#e8e6e3',
                wordBreak: 'break-all', marginBottom: '12px', userSelect: 'text',
                WebkitUserSelect: 'text'
              }
            }, ctx.accountKey),
            React.createElement('div', {
              style: { display: 'flex', gap: '8px' }
            },
              React.createElement('button', {
                style: {
                  flex: 1, padding: '8px', background: '#f0b232',
                  border: 'none', borderRadius: '4px', color: '#1c1c1e',
                  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'inherit'
                },
                onClick: function() {
                  if (navigator.clipboard) {
                    navigator.clipboard.writeText(ctx.accountKey).catch(function() {});
                  }
                  setKeyCopied(true);
                  setTimeout(function() { setKeyCopied(false); }, 2000);
                }
              }, keyCopied ? 'Copied!' : 'Copy Key'),
              React.createElement('button', {
                style: {
                  flex: 1, padding: '8px', background: 'transparent',
                  border: '1px solid #949ba4', borderRadius: '4px', color: '#949ba4',
                  fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'inherit'
                },
                onClick: function() { setShowKeyModal(false); }
              }, 'Close')
            )
          )
        ) : null,

        // PIN setup modal for claiming key
        pinSetupForClaim ? React.createElement('div', {
          style: {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.75)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 9999
          },
          onClick: function(e) { if (e.target === e.currentTarget) setPinSetupForClaim(false); }
        },
          React.createElement('div', {
            style: {
              background: '#252528', borderRadius: '10px', padding: '28px',
              width: '380px', maxWidth: '90vw', borderTop: '3px solid #f0b232',
              animation: 'fadeIn 0.2s ease'
            }
          },
            React.createElement('h3', {
              style: { color: '#f0b232', fontSize: '18px', fontWeight: 700, marginBottom: '8px', textAlign: 'center' }
            }, 'Set Your Account PIN'),
            React.createElement('p', {
              style: { color: '#949ba4', fontSize: '13px', marginBottom: '16px', textAlign: 'center' }
            }, 'Choose a 4-character PIN (letters and numbers). You will need this PIN every time you log in.'),
            React.createElement('label', {
              style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px' }
            }, 'PIN'),
            React.createElement('input', {
              type: 'password',
              style: {
                width: '100%', padding: '12px', background: '#18181b',
                border: 'none', borderRadius: '4px', color: '#dcddde',
                fontSize: '20px', outline: 'none', fontFamily: 'monospace',
                letterSpacing: '0.3em', textAlign: 'center'
              },
              placeholder: '----',
              value: pinConfirm.length === 0 && pinInput.length < 4 ? pinInput : pinInput,
              onChange: function(e) { setPinInput(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)); },
              maxLength: 4, autoFocus: true
            }),
            React.createElement('label', {
              style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px', marginTop: '12px' }
            }, 'Confirm PIN'),
            React.createElement('input', {
              type: 'password',
              style: {
                width: '100%', padding: '12px', background: '#18181b',
                border: 'none', borderRadius: '4px', color: '#dcddde',
                fontSize: '20px', outline: 'none', fontFamily: 'monospace',
                letterSpacing: '0.3em', textAlign: 'center'
              },
              placeholder: '----',
              value: pinConfirm,
              onChange: function(e) { setPinConfirm(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)); },
              maxLength: 4
            }),
            pinInput.length === 4 && pinConfirm.length === 4 && pinInput !== pinConfirm ?
              React.createElement('p', { style: { color: '#ed4245', fontSize: '12px', marginTop: '8px', textAlign: 'center' } }, 'PINs do not match') : null,
            React.createElement('div', {
              style: { display: 'flex', gap: '8px', marginTop: '16px' }
            },
              React.createElement('button', {
                style: {
                  flex: 1, padding: '10px', background: '#f0b232', border: 'none',
                  borderRadius: '4px', color: '#1c1c1e', fontSize: '14px', fontWeight: 600,
                  cursor: pinInput.length === 4 && pinInput === pinConfirm ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit', opacity: pinInput.length === 4 && pinInput === pinConfirm ? 1 : 0.5
                },
                disabled: pinInput.length !== 4 || pinInput !== pinConfirm || ctx.powStatus === 'solving_account',
                onClick: function() {
                  if (pinInput.length === 4 && pinInput === pinConfirm) {
                    justCreatedAccount.current = true;
                    ctx.createAccount(pinInput);
                    setPinSetupForClaim(false);
                    setPinInput('');
                    setPinConfirm('');
                  }
                }
              }, ctx.powStatus === 'solving_account' ? 'Solving...' : 'Claim Key'),
              React.createElement('button', {
                style: {
                  padding: '10px 16px', background: 'transparent', border: '1px solid #949ba4',
                  borderRadius: '4px', color: '#949ba4', fontSize: '14px', fontWeight: 600,
                  cursor: 'pointer', fontFamily: 'inherit'
                },
                onClick: function() { setPinSetupForClaim(false); setPinInput(''); setPinConfirm(''); }
              }, 'Cancel')
            )
          )
        ) : null,

        // Title
        !isMobile ? React.createElement('h2', {
          style: { textAlign: 'center', fontSize: '22px', fontWeight: 700, marginBottom: '4px', flexShrink: 0, textShadow: '0 0 12px rgba(240,178,50,0.3)' }
        },
          React.createElement('span', { style: { color: '#f0b232' } }, 'Boss'),
          React.createElement('span', { style: { color: '#e8e6e3' } }, 'Cord')
        ) : null,
        !isMobile ? React.createElement('p', {
          style: { textAlign: 'center', color: '#949ba4', fontSize: '14px', marginBottom: '20px', flexShrink: 0 }
        }, 'Browse public rooms, create your own, or join by invite.') : null,

        // Room sub-tab bar
        React.createElement('div', {
          style: { display: 'flex', gap: '4px', marginBottom: '16px', flexShrink: 0 }
        },
          React.createElement('button', {
            style: tabStyle(tab === 'public'),
            onClick: function() { setTab('public'); }
          }, isMobile ? 'Public' : 'Public Rooms'),
          React.createElement('button', {
            style: tabStyle(tab === 'create'),
            onClick: function() { setTab('create'); }
          }, isMobile ? 'Create' : 'Create Room'),
          React.createElement('button', {
            style: tabStyle(tab === 'join'),
            onClick: function() { setTab('join'); }
          }, isMobile ? 'Join' : 'Join by Code')
        ),

        // Tab content
        React.createElement('div', { style: { flex: 1, overflow: 'auto', minHeight: 0, WebkitOverflowScrolling: 'touch' } },

          // PUBLIC ROOMS TAB
          tab === 'public' ? React.createElement('div', null,
            // Category filter pills
            React.createElement('div', {
              style: {
                display: 'flex', gap: '6px', marginBottom: '12px',
                overflowX: 'auto', overflowY: 'hidden',
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'none', msOverflowStyle: 'none',
                flexShrink: 0, paddingBottom: '2px'
              },
              className: 'hide-scrollbar'
            },
              CATEGORY_TABS.map(function(cat) {
                var isActive = categoryFilter === cat;
                return React.createElement('button', {
                  key: cat,
                  style: {
                    padding: isMobile ? '6px 14px' : '7px 18px',
                    background: isActive ? '#f0b232' : '#2a2a2e',
                    border: 'none',
                    borderRadius: '20px',
                    color: isActive ? '#1c1c1e' : '#949ba4',
                    fontSize: isMobile ? '12px' : '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'background 0.2s, color 0.2s',
                    whiteSpace: 'nowrap',
                    flexShrink: 0
                  },
                  onMouseEnter: function(e) {
                    if (!isActive) e.currentTarget.style.background = '#3a3a3e';
                  },
                  onMouseLeave: function(e) {
                    if (!isActive) e.currentTarget.style.background = '#2a2a2e';
                  },
                  onClick: function() { setCategoryFilter(cat); }
                }, cat);
              })
            ),
            // Loading skeletons
            !publicRoomsLoaded ? React.createElement('div', null,
              React.createElement('div', { className: 'skeleton', style: { height: isMobile ? '52px' : '72px', marginBottom: isMobile ? '4px' : '8px', borderRadius: '10px' } }),
              React.createElement('div', { className: 'skeleton', style: { height: isMobile ? '52px' : '72px', marginBottom: isMobile ? '4px' : '8px', borderRadius: '10px' } }),
              React.createElement('div', { className: 'skeleton', style: { height: isMobile ? '52px' : '72px', marginBottom: isMobile ? '4px' : '8px', borderRadius: '10px' } })
            ) :
            React.createElement('div', { ref: roomListRef },
            (function() {
              var filtered = categoryFilter === 'All' ? ctx.publicRooms : ctx.publicRooms.filter(function(pr) {
                return (pr.category || 'General') === categoryFilter;
              });
              if (filtered.length === 0) {
                return React.createElement('div', {
                  style: { textAlign: 'center', color: '#949ba4', padding: '32px 0', fontSize: '14px' }
                }, categoryFilter === 'All' ? 'No public rooms available right now.' : 'No rooms in the ' + categoryFilter + ' category.');
              }
              return filtered.map(function(pr, prIdx) {
              var isHovered = hoveredRoom === pr.code;
              var alreadyJoined = ctx.rooms.find(function(r) { return r.code === pr.code; });
              return React.createElement('div', {
                key: pr.code,
                'data-room-card': 'true',
                'data-card-index': String(prIdx),
                style: {
                  display: 'flex', alignItems: 'center', padding: isMobile ? '8px 10px' : '12px 16px',
                  background: isHovered ? '#393c43' : '#18181b',
                  borderRadius: '10px', marginBottom: isMobile ? '4px' : '8px', cursor: 'pointer',
                  transition: 'background 0.15s, opacity 0.5s ease-out, transform 0.5s ease-out',
                  gap: isMobile ? '8px' : '12px',
                  borderLeft: '3px solid #f0b232',
                  opacity: '0', transform: 'translateY(20px)'
                },
                onMouseEnter: function() { setHoveredRoom(pr.code); },
                onMouseLeave: function() { setHoveredRoom(null); },
                onClick: function() {
                  if (!alreadyJoined) handleJoinPublicRoom(pr.code);
                }
              },
                React.createElement('div', {
                  style: {
                    width: isMobile ? '36px' : '48px', height: isMobile ? '36px' : '48px', borderRadius: '12px',
                    background: '#f0b232', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: isMobile ? '16px' : '22px', fontWeight: 700, color: '#fff', flexShrink: 0
                  }
                }, (pr.name || '?')[0].toUpperCase()),
                React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                  React.createElement('div', {
                    style: { fontWeight: 600, fontSize: '15px', marginBottom: '2px' }
                  }, pr.name),
                  !isMobile && pr.description ? React.createElement('div', {
                    style: { color: '#949ba4', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                  }, pr.description) : null
                ),
                React.createElement('div', {
                  style: { display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }
                },
                  React.createElement('div', {
                    style: { display: 'flex', alignItems: 'center', gap: '4px', color: '#949ba4', fontSize: '13px' }
                  },
                    React.createElement('div', {
                      style: {
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: pr.memberCount > 0 ? '#57f287' : '#949ba4'
                      }
                    }),
                    pr.memberCount + ' online'
                  ),
                  alreadyJoined ?
                    React.createElement('div', {
                      style: {
                        padding: isMobile ? '4px 12px' : '6px 16px', background: '#393c43', borderRadius: '4px',
                        color: '#57f287', fontSize: isMobile ? '12px' : '13px', fontWeight: 600
                      }
                    }, 'Joined') :
                    React.createElement('div', {
                      style: {
                        padding: isMobile ? '4px 12px' : '6px 16px', background: isHovered ? '#57f287' : '#3ba55c',
                        borderRadius: '4px', color: '#fff', fontSize: isMobile ? '12px' : '13px', fontWeight: 600,
                        transition: 'background 0.15s'
                      }
                    }, 'Join')
                )
              );
              });
            })())
          ) : null,

          // CREATE ROOM TAB
          tab === 'create' ? React.createElement('div', null,
            React.createElement('label', {
              style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }
            }, 'Room Name'),
            React.createElement('input', {
              type: 'text', style: inputStyle, placeholder: 'My Awesome Room',
              value: roomName,
              onChange: function(e) { setRoomName(e.target.value.replace(/[^a-zA-Z0-9 _\-]/g, '')); },
              onPaste: blockPaste, onDrop: blockDrop,
              onKeyDown: function(e) { if (e.key === 'Enter' && roomName.trim()) handleCreateRoom(); },
              maxLength: 64, autoFocus: true
            }),

            React.createElement('label', {
              style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px', marginTop: '16px' }
            }, 'Description (Optional)'),
            React.createElement('input', {
              type: 'text', style: inputStyle, placeholder: 'What\'s this room about?',
              value: roomDescription,
              onChange: function(e) { setRoomDescription(e.target.value.replace(/[^a-zA-Z0-9 _\-!?,.']/g, '')); },
              onPaste: blockPaste, onDrop: blockDrop,
              maxLength: 200
            }),

            // Category dropdown
            React.createElement('label', {
              style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px', marginTop: '16px' }
            }, 'Category'),
            React.createElement('select', {
              style: {
                width: '100%', padding: '10px 12px', background: '#18181b',
                border: 'none', borderRadius: '4px', color: '#dcddde',
                fontSize: '16px', outline: 'none', fontFamily: 'inherit',
                cursor: 'pointer', appearance: 'auto', minHeight: '44px'
              },
              value: roomCategory,
              onChange: function(e) { setRoomCategory(e.target.value); }
            },
              ROOM_CATEGORY_OPTIONS.map(function(cat) {
                return React.createElement('option', { key: cat, value: cat }, cat);
              })
            ),

            // Public/Private toggle
            React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: '12px',
                marginTop: '16px', padding: '12px 16px',
                background: '#18181b', borderRadius: '8px'
              }
            },
              React.createElement('div', { style: { flex: 1 } },
                React.createElement('div', {
                  style: { fontWeight: 600, fontSize: '15px', marginBottom: '2px' }
                }, 'Public Room'),
                React.createElement('div', {
                  style: { color: '#949ba4', fontSize: '13px' }
                }, roomIsPublic ? 'Anyone can find and join this room' : 'Only people with the invite code can join')
              ),
              React.createElement('div', {
                style: {
                  width: '44px', height: '24px', borderRadius: '12px',
                  background: roomIsPublic ? '#57f287' : '#72767d',
                  cursor: 'pointer', position: 'relative',
                  transition: 'background 0.2s'
                },
                onClick: function() { setRoomIsPublic(!roomIsPublic); if (!roomIsPublic) setRoomEncrypted(false); }
              },
                React.createElement('div', {
                  style: {
                    width: '20px', height: '20px', borderRadius: '50%',
                    background: '#fff', position: 'absolute',
                    top: '2px', left: roomIsPublic ? '22px' : '2px',
                    transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                  }
                })
              )
            ),

            // E2E Encryption toggle (only for private rooms)
            !roomIsPublic ? React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: '12px',
                marginTop: '12px', padding: '12px 16px',
                background: '#18181b', borderRadius: '8px'
              }
            },
              React.createElement('div', { style: { flex: 1 } },
                React.createElement('div', {
                  style: { fontWeight: 600, fontSize: '15px', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }
                }, '\uD83D\uDD12 End-to-End Encryption'),
                React.createElement('div', {
                  style: { color: '#949ba4', fontSize: '13px' }
                }, roomEncrypted ? 'Messages encrypted \u2014 only members with the full code can read them' : 'Messages are not encrypted')
              ),
              React.createElement('div', {
                style: {
                  width: '44px', height: '24px', borderRadius: '12px',
                  background: roomEncrypted ? '#57f287' : '#72767d',
                  cursor: 'pointer', position: 'relative',
                  transition: 'background 0.2s'
                },
                onClick: function() { setRoomEncrypted(!roomEncrypted); }
              },
                React.createElement('div', {
                  style: {
                    width: '20px', height: '20px', borderRadius: '50%',
                    background: '#fff', position: 'absolute',
                    top: '2px', left: roomEncrypted ? '22px' : '2px',
                    transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                  }
                })
              )
            ) : null,

            React.createElement('button', {
              style: Object.assign({}, btnPrimary, {
                background: 'linear-gradient(135deg, #f0b232, #f5c563)',
                transition: 'all 0.2s ease'
              }),
              onClick: handleCreateRoom, disabled: !roomName.trim(),
              onMouseEnter: function(e) {
                if (roomName.trim()) {
                  e.currentTarget.style.boxShadow = '0 0 16px rgba(240,178,50,0.3)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              },
              onMouseLeave: function(e) {
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }, roomIsPublic ? 'Create Public Room' : (roomEncrypted ? 'Create Encrypted Room' : 'Create Private Room'))
          ) : null,

          // JOIN BY CODE TAB
          tab === 'join' ? React.createElement('div', null,
            React.createElement('label', {
              style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }
            }, 'Invite Code'),
            React.createElement('input', {
              type: 'text', style: { ...inputStyle, letterSpacing: '0.05em', fontSize: '18px', textAlign: 'center', padding: '14px 12px' },
              placeholder: 'e.g. ABCD12 or ABCD12.secret',
              value: joinCode,
              onChange: function(e) { setJoinCode(e.target.value.replace(/[^a-zA-Z0-9.]/g, '')); },
              onDrop: blockDrop,
              onKeyDown: function(e) { if (e.key === 'Enter') handleJoinRoom(); },
              maxLength: 24, autoFocus: true,
              'data-allow-paste': 'true'
            }),
            React.createElement('p', {
              style: { color: '#949ba4', fontSize: '13px', marginTop: '8px', textAlign: 'center' }
            }, 'Enter the invite code shared by the room creator. Encrypted rooms use an extended code with a dot.'),
            React.createElement('button', {
              style: Object.assign({}, btnPrimary, {
                background: 'linear-gradient(135deg, #57f287, #7dffa8)',
                color: '#18181b',
                transition: 'all 0.2s ease'
              }),
              onClick: handleJoinRoom, disabled: !joinCode.trim(),
              onMouseEnter: function(e) {
                if (joinCode.trim()) {
                  e.currentTarget.style.boxShadow = '0 0 16px rgba(87,242,135,0.3)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              },
              onMouseLeave: function(e) {
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }
            }, 'Join Room')
          ) : null
        ),

        // Disconnect button
        !isMobile ? React.createElement('button', {
          style: { ...btnSecondary, color: '#ed4245', borderColor: '#ed4245', marginTop: '16px', flexShrink: 0 },
          onClick: ctx.disconnectSocket
        }, 'Disconnect') : null,

        ctx.errorMessage ? React.createElement('p', {
          style: { color: '#ed4245', fontSize: '13px', marginTop: '12px', textAlign: 'center', flexShrink: 0 }
        }, ctx.errorMessage) : null
      ),
      React.createElement('p', {
        style: { color: '#949ba4', fontSize: '12px', fontStyle: 'italic', marginTop: '12px', display: isMobile ? 'none' : 'block' }
      }, 'Everything here is ephemeral. When you leave, it\'s gone.')
    ),
    isMobile ? React.createElement(BottomTabBar, { activeTab: topTab, onTabChange: setTopTab }) : null
  );
}
