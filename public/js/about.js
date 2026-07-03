// ===================== ABOUT TAB =====================
// Showcases all BossCord features

function AboutTab() {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var [showTos, setShowTos] = useState(false);

  var sectionStyle = {
    background: '#16213e', borderRadius: '12px', padding: isMobile ? '16px' : '24px',
    marginBottom: '16px', border: '1px solid rgba(240,178,50,0.1)'
  };
  var headingStyle = {
    fontSize: isMobile ? '18px' : '22px', fontWeight: 700, color: '#f0b232',
    marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px'
  };
  var subheadStyle = {
    fontSize: isMobile ? '14px' : '16px', fontWeight: 600, color: '#eee',
    marginBottom: '8px', marginTop: '16px'
  };
  var textStyle = { fontSize: '14px', color: '#b0b0b0', lineHeight: '1.6', marginBottom: '8px' };
  var badgeStyle = function(color) {
    return {
      display: 'inline-block', padding: '3px 10px', borderRadius: '12px',
      fontSize: '11px', fontWeight: 700, color: '#fff',
      background: color || '#f0b232', marginRight: '6px', marginBottom: '4px'
    };
  };
  var featureCardStyle = {
    background: '#1a1a2e', borderRadius: '10px', padding: '14px',
    border: '1px solid rgba(255,255,255,0.06)', flex: '1 1 220px', minWidth: isMobile ? '100%' : '220px'
  };
  var gridStyle = {
    display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '12px'
  };

  var features = [
    {
      icon: '\uD83D\uDCA3', title: 'Daily Server Wipes',
      desc: 'Every midnight UTC, all rooms, messages, and ephemeral data are wiped clean. Fresh start every day. No archives, no history, no traces. Your conversations are truly temporary.',
      badge: 'Privacy', badgeColor: '#ed4245'
    },
    {
      icon: '\uD83D\uDC7B', title: 'Anonymous by Default',
      desc: 'No email, no phone number, no registration required. Get a random name and start chatting instantly. Want persistence? Claim an account key — a 12-character secret that is your entire identity.',
      badge: 'Anonymous', badgeColor: '#9b59b6'
    },
    {
      icon: '\uD83C\uDFAE', title: '13+ Built-in Games',
      desc: 'BossOrbs (real-time multiplayer), Texas Hold\'em, Blackjack, Slots, Plinko, Coinflip, Lucky Scrolls, Loot Boxes, TCG Battles, Stock Market, Auction House, Clicker Idle, and more.',
      badge: 'Games', badgeColor: '#f0b232'
    },
    {
      icon: '\uD83C\uDCCF', title: 'Trading Card Game',
      desc: '80+ unique cards across 10 rarity tiers from Common to Godly. 8 elemental types with strengths and weaknesses. Open packs, build decks, battle other players in real-time TCG combat.',
      badge: 'TCG', badgeColor: '#ff69b4'
    },
    {
      icon: '\uD83D\uDCC8', title: 'Stock Market Simulator',
      desc: '39 simulated stocks with real-time price ticks every 15 seconds. Random market events cause crashes and booms. Build a portfolio and compete on the leaderboard.',
      badge: 'Economy', badgeColor: '#00bcd4'
    },
    {
      icon: '\uD83C\uDFAA', title: 'Loot & Inventory System',
      desc: 'Earn chips across all games. Buy loot boxes for badges, titles, and collectibles with modifiers like Shiny, Ancient, and Cursed. Equip items to customize your profile.',
      badge: 'Loot', badgeColor: '#ff9800'
    },
    {
      icon: '\uD83D\uDC65', title: 'Friends System',
      desc: 'Click any username in chat, cords, or the leaderboard to add them as a friend. Share your friend tag (Username#ABCD) for others to add you. See who is online, send game invites, and DM friends with end-to-end encryption.',
      badge: 'Social', badgeColor: '#2ecc71'
    },
    {
      icon: '\uD83D\uDCAC', title: 'Cords (Social Feed)',
      desc: 'Post short messages to the public feed. Like, reply, and engage. Moderators keep it clean. All cords wipe at midnight with everything else.',
      badge: 'Feed', badgeColor: '#5865f2'
    },
    {
      icon: '\uD83C\uDFD7\uFE0F', title: 'Create Private Rooms',
      desc: 'Create your own chat rooms with custom names and channels. Share the 6-character room code with friends. Text and voice channels available.',
      badge: 'Rooms', badgeColor: '#e67e22'
    },
  ];

  var ss = ctx.serverStats || {};
  var stats = [
    { label: 'Online', value: ss.online || '—', color: '#57f287' },
    { label: 'Members', value: ss.members || '—', color: '#f0b232' },
  ];

  return React.createElement('div', {
    style: {
      flex: 1, overflowY: 'auto', padding: isMobile ? '12px' : '24px',
      maxWidth: '900px', margin: '0 auto', width: '100%'
    }
  },
    // Hero
    React.createElement('div', {
      style: Object.assign({}, sectionStyle, {
        textAlign: 'center', background: 'linear-gradient(135deg, #16213e 0%, #1a1a2e 100%)',
        border: '1px solid rgba(240,178,50,0.2)'
      })
    },
      React.createElement('div', {
        style: { fontSize: isMobile ? '28px' : '38px', fontWeight: 800, marginBottom: '8px' }
      },
        React.createElement('span', { style: { color: '#f0b232' } }, 'Boss'),
        React.createElement('span', { style: { color: '#e8e6e3' } }, 'Cord')
      ),
      React.createElement('p', {
        style: { fontSize: isMobile ? '14px' : '16px', color: '#b0b0b0', maxWidth: '600px', margin: '0 auto 16px', lineHeight: '1.5' }
      }, 'Anonymous chat with games, trading cards, a stock market, and encrypted DMs. No sign-up needed. All messages wipe at midnight UTC.'),
      React.createElement('div', {
        style: { display: 'flex', justifyContent: 'center', gap: '24px', flexWrap: 'wrap' }
      },
        stats.map(function(s) {
          return React.createElement('div', { key: s.label, style: { textAlign: 'center' } },
            React.createElement('div', { style: { fontSize: '24px', fontWeight: 800, color: s.color } }, s.value),
            React.createElement('div', { style: { fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '1px' } }, s.label)
          );
        })
      )
    ),

    // Security & Privacy
    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: headingStyle },
        React.createElement('span', null, '\uD83D\uDEE1\uFE0F'),
        'Security & Privacy'
      ),
      React.createElement('p', { style: textStyle },
        'We don\'t ask for your email, phone number, or any personal info. No tracking, no cookies, no third-party logins.'
      ),
      React.createElement('div', { style: gridStyle },
        React.createElement('div', { style: featureCardStyle },
          React.createElement('div', { style: subheadStyle }, '\uD83D\uDD12 Private Messages'),
          React.createElement('p', { style: textStyle },
            'Your DMs are encrypted on your device before they\'re sent. The server can\'t read them. Only you and the person you\'re talking to can.'
          )
        ),
        React.createElement('div', { style: featureCardStyle },
          React.createElement('div', { style: subheadStyle }, '\uD83D\uDEE1\uFE0F Encrypted Data'),
          React.createElement('p', { style: textStyle },
            'Your account data is scrambled and locked on the server. Your key is never stored as-is. Even if someone broke into the server, they couldn\'t read anything.'
          )
        ),
        React.createElement('div', { style: featureCardStyle },
          React.createElement('div', { style: subheadStyle }, '\uD83D\uDD10 PIN Lock'),
          React.createElement('p', { style: textStyle },
            'You set a PIN when you create your account. Even if someone gets your key, they can\'t log in without it. Too many wrong guesses and you get locked out.'
          )
        ),
        React.createElement('div', { style: featureCardStyle },
          React.createElement('div', { style: subheadStyle }, '\uD83D\uDD04 Daily Wipe'),
          React.createElement('p', { style: textStyle },
            'Every night at midnight, all messages, rooms, and game data are deleted. Your account and chips stay, but conversations are gone for good.'
          )
        ),
      )
    ),

    // All Features Grid
    React.createElement('div', { style: sectionStyle },
      React.createElement('div', { style: headingStyle },
        React.createElement('span', null, '\u2728'),
        'All Features'
      ),
      React.createElement('div', { style: gridStyle },
        features.map(function(f, i) {
          return React.createElement('div', { key: i, style: featureCardStyle },
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }
            },
              React.createElement('span', { style: { fontSize: '20px' } }, f.icon),
              React.createElement('span', { style: { fontWeight: 700, fontSize: '14px', color: '#eee' } }, f.title),
              React.createElement('span', { style: badgeStyle(f.badgeColor) }, f.badge)
            ),
            React.createElement('p', { style: Object.assign({}, textStyle, { marginBottom: 0, fontSize: '13px' }) }, f.desc)
          );
        })
      )
    ),

    // TOS Modal (read-only)
    showTos ? React.createElement('div', {
      style: {
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.8)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 9999
      },
      onClick: function(e) { if (e.target === e.currentTarget) setShowTos(false); }
    },
      React.createElement('div', {
        style: {
          background: '#252528', borderRadius: isMobile ? '0' : '10px',
          borderTop: '3px solid #f0b232', padding: isMobile ? '16px' : '28px',
          width: isMobile ? '100%' : '600px', maxWidth: '95vw',
          maxHeight: isMobile ? '100%' : '80vh', height: isMobile ? '100%' : 'auto',
          display: 'flex', flexDirection: 'column'
        }
      },
        React.createElement('h3', {
          style: { color: '#f0b232', textAlign: 'center', fontSize: '18px', fontWeight: 700, marginBottom: '12px', flexShrink: 0 }
        }, 'Terms of Service'),
        React.createElement('div', {
          style: {
            flex: 1, overflow: 'auto', background: '#18181b', borderRadius: '6px',
            padding: '16px', marginBottom: '12px', color: '#b0b0b0',
            fontSize: '13px', lineHeight: '1.7', whiteSpace: 'pre-wrap',
            fontFamily: 'inherit', minHeight: '200px'
          }
        }, typeof BOSSCORD_TOS !== 'undefined' ? BOSSCORD_TOS : 'Terms of Service content loading...'),
        React.createElement('button', {
          style: {
            width: '100%', padding: '10px', background: 'transparent',
            border: '1px solid #949ba4', borderRadius: '4px', color: '#949ba4',
            fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0
          },
          onClick: function() { setShowTos(false); }
        }, 'Close')
      )
    ) : null,

    // Footer
    React.createElement('div', {
      style: { textAlign: 'center', padding: '24px 0 40px', color: '#555', fontSize: '13px' }
    },
      React.createElement('p', null, 'BossCord \u2014 No IDs. No emails. No passwords. No tracking.'),
      React.createElement('p', { style: { marginTop: '4px' } }, 'Daily wipe at midnight UTC. Minimal data, maximum privacy.'),
      React.createElement('p', { style: { marginTop: '12px' } },
        React.createElement('span', {
          style: { color: '#f0b232', cursor: 'pointer', textDecoration: 'underline', fontSize: '12px' },
          onClick: function() { setShowTos(true); }
        }, 'Terms of Service')
      )
    )
  );
}
