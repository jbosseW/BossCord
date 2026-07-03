// ===================== MARKDOWN RENDERER =====================
// Converts markdown text to an array of React elements.
// Supports: **bold**, *italic*, `inline code`, ```code blocks```, URLs, newlines.
// Security: strips HTML tags, only allows http/https URLs, no innerHTML.
function renderMarkdown(text, searchTerm) {
  if (!text || typeof text !== 'string') return [text || ''];

  // Strip any HTML tags for security
  var stripped = text.replace(/<[^>]*>/g, '');

  var elements = [];
  var keyCounter = 0;

  function nextKey() {
    return 'md-' + (keyCounter++);
  }

  // Helper: highlight search matches inside a string, returning an array of elements
  function highlightText(str, tag) {
    if (!searchTerm || !str) {
      if (tag) {
        return [React.createElement(tag, { key: nextKey() }, str)];
      }
      return [str];
    }
    var lower = str.toLowerCase();
    var termLower = searchTerm.toLowerCase();
    var parts = [];
    var lastIdx = 0;
    var idx = lower.indexOf(termLower);
    while (idx !== -1) {
      if (idx > lastIdx) {
        parts.push(str.substring(lastIdx, idx));
      }
      parts.push(React.createElement('mark', {
        key: nextKey(),
        style: { background: '#faa61a', color: '#1c1c1e', borderRadius: '2px', padding: '0 1px' }
      }, str.substring(idx, idx + searchTerm.length)));
      lastIdx = idx + searchTerm.length;
      idx = lower.indexOf(termLower, lastIdx);
    }
    if (lastIdx < str.length) {
      parts.push(str.substring(lastIdx));
    }
    if (tag) {
      return [React.createElement(tag, { key: nextKey() }, parts)];
    }
    return parts;
  }

  // Split by code blocks first (``` ... ```)
  var codeBlockRegex = /```([\s\S]*?)```/g;
  var codeBlockParts = [];
  var lastIndex = 0;
  var cbMatch;
  while ((cbMatch = codeBlockRegex.exec(stripped)) !== null) {
    if (cbMatch.index > lastIndex) {
      codeBlockParts.push({ type: 'text', value: stripped.substring(lastIndex, cbMatch.index) });
    }
    codeBlockParts.push({ type: 'codeblock', value: cbMatch[1] });
    lastIndex = codeBlockRegex.lastIndex;
  }
  if (lastIndex < stripped.length) {
    codeBlockParts.push({ type: 'text', value: stripped.substring(lastIndex) });
  }
  if (codeBlockParts.length === 0) {
    codeBlockParts.push({ type: 'text', value: stripped });
  }

  // Process inline content (not inside code blocks)
  function processInline(str) {
    var result = [];
    // Regex for inline code, bold, italic, and URLs
    // Order matters: inline code first, then bold, then italic, then URLs
    var inlineRegex = /(`([^`]+?)`)|(\*\*(.+?)\*\*)|(\*(.+?)\*)|(https?:\/\/[^\s<>\"\')\]]+)/g;
    var last = 0;
    var m;
    while ((m = inlineRegex.exec(str)) !== null) {
      // Push text before this match
      if (m.index > last) {
        var beforeText = str.substring(last, m.index);
        result = result.concat(processPlainText(beforeText));
      }
      if (m[1]) {
        // Inline code: `code`
        var codeContent = m[2];
        result.push(React.createElement('code', {
          key: nextKey(),
          style: { background: '#2f3136', padding: '2px 6px', borderRadius: '3px', fontSize: '0.875em', fontFamily: 'monospace' }
        }, highlightText(codeContent, null)));
      } else if (m[3]) {
        // Bold: **text**
        var boldContent = m[4];
        result = result.concat(highlightText(boldContent, 'strong'));
      } else if (m[5]) {
        // Italic: *text*
        var italicContent = m[6];
        result = result.concat(highlightText(italicContent, 'em'));
      } else if (m[7]) {
        // URL
        var url = m[7];
        // Validate URL starts with http:// or https:// (already guaranteed by regex)
        // Remove trailing punctuation that is likely not part of the URL
        var cleanUrl = url.replace(/[.,;:!?)]+$/, '');
        var trailing = url.substring(cleanUrl.length);
        result.push(React.createElement('a', {
          key: nextKey(),
          href: cleanUrl,
          target: '_blank',
          rel: 'noopener noreferrer',
          style: { color: '#00aff4', textDecoration: 'none' }
        }, highlightText(cleanUrl, null)));
        if (trailing) {
          result = result.concat(processPlainText(trailing));
        }
      }
      last = m.index + m[0].length;
    }
    if (last < str.length) {
      result = result.concat(processPlainText(str.substring(last)));
    }
    return result;
  }

  // Process plain text: handle newlines and search highlighting
  function processPlainText(str) {
    var result = [];
    var lines = str.split('\n');
    for (var li = 0; li < lines.length; li++) {
      if (li > 0) {
        result.push(React.createElement('br', { key: nextKey() }));
      }
      if (lines[li].length > 0) {
        result = result.concat(highlightText(lines[li], null));
      }
    }
    return result;
  }

  // Build final elements array
  for (var p = 0; p < codeBlockParts.length; p++) {
    var part = codeBlockParts[p];
    if (part.type === 'codeblock') {
      elements.push(React.createElement('pre', {
        key: nextKey(),
        style: { background: '#2f3136', padding: '8px 12px', borderRadius: '4px', overflowX: 'auto', fontSize: '0.875em', fontFamily: 'monospace', margin: '4px 0' }
      }, highlightText(part.value, null)));
    } else {
      var inlineElements = processInline(part.value);
      elements = elements.concat(inlineElements);
    }
  }

  return elements;
}

// ===================== ROOM LIST =====================
function RoomList({ mobileShow, onToggle }) {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var [hoveredRoom, setHoveredRoom] = useState(null);
  var [hoveredPlus, setHoveredPlus] = useState(false);

  function selectRoom(code) {
    if (code === ctx.currentRoomCode) return;
    if (ctx.currentChannelId && ctx.socket) {
      ctx.socket.emit('leave_channel', { channelId: ctx.currentChannelId });
    }
    ctx.setCurrentRoomCode(code);
    var room = ctx.rooms.find(function(r) { return r.code === code; });
    if (room) {
      var firstText = (room.channels || []).find(function(c) { return c.type === 'text'; });
      if (firstText && ctx.socket) {
        ctx.socket.emit('join_channel', { roomCode: code, channelId: firstText.id });
        ctx.setCurrentChannelId(firstText.id);
      }
    }
    if (isMobile && onToggle) onToggle();
  }

  function goToLanding() {
    if (ctx.currentChannelId && ctx.socket) {
      ctx.socket.emit('leave_channel', { channelId: ctx.currentChannelId });
    }
    ctx.setCurrentRoomCode(null);
    ctx.setCurrentChannelId(null);
    ctx.setMessages([]);
    if (isMobile && onToggle) onToggle();
  }

  if (isMobile && !mobileShow) return null;

  var sidebarStyle = {
    width: isMobile ? '72px' : '72px', minWidth: '72px', background: '#18181b',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    paddingTop: '12px', gap: '8px', overflowY: 'auto', overflowX: 'hidden',
    position: isMobile ? 'absolute' : 'relative',
    left: 0, top: 0, bottom: 0, zIndex: isMobile ? 200 : 'auto',
    WebkitOverflowScrolling: 'touch'
  };

  return React.createElement('div', { style: sidebarStyle },
    ctx.connected && ctx.rooms.length === 0 ? SkeletonCircle(5) : null,
    ctx.rooms.map(function(room) {
      var isActive = room.code === ctx.currentRoomCode;
      var isHovered = hoveredRoom === room.code;
      var isPublic = room.isPublic;
      return React.createElement('div', {
        key: room.code,
        style: { position: 'relative', width: '48px', height: '48px', cursor: 'pointer' },
        onClick: function() { selectRoom(room.code); },
        onMouseEnter: function() { setHoveredRoom(room.code); },
        onMouseLeave: function() { setHoveredRoom(null); },
        title: room.name + ' (' + room.code + ')' + (isPublic ? ' [Public]' : '')
      },
        isActive ? React.createElement('div', {
          style: {
            position: 'absolute', left: '-12px', top: '50%', transform: 'translateY(-50%)',
            width: '4px', height: '40px', background: '#fff', borderRadius: '0 4px 4px 0'
          }
        }) : (isHovered ? React.createElement('div', {
          style: {
            position: 'absolute', left: '-12px', top: '50%', transform: 'translateY(-50%)',
            width: '4px', height: '20px', background: '#fff', borderRadius: '0 4px 4px 0'
          }
        }) : null),
        React.createElement('div', {
          style: {
            width: '48px', height: '48px',
            borderRadius: isActive ? '33%' : (isHovered ? '33%' : '50%'),
            background: isActive ? '#f0b232' : (isHovered ? '#f0b232' : '#1c1c1e'),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '20px', fontWeight: 700, color: '#dcddde',
            transition: 'border-radius 0.2s ease, background 0.2s ease',
            position: 'relative'
          }
        },
          (room.name || '?')[0].toUpperCase(),
          isPublic ? React.createElement('div', {
            style: {
              position: 'absolute', bottom: '-2px', right: '-2px',
              width: '14px', height: '14px', borderRadius: '50%',
              background: '#57f287', border: '3px solid #18181b'
            }
          }) : null
        )
      );
    }),
    React.createElement('div', {
      style: { width: '32px', height: '2px', background: '#35363c', borderRadius: '1px' }
    }),
    React.createElement('div', {
      style: {
        width: '48px', height: '48px',
        borderRadius: hoveredPlus ? '33%' : '50%',
        background: hoveredPlus ? '#57f287' : '#1c1c1e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '24px', fontWeight: 400,
        color: hoveredPlus ? '#18181b' : '#57f287',
        cursor: 'pointer',
        transition: 'border-radius 0.2s ease, background 0.2s ease, color 0.2s ease'
      },
      onClick: goToLanding,
      onMouseEnter: function() { setHoveredPlus(true); },
      onMouseLeave: function() { setHoveredPlus(false); },
      title: 'Browse Rooms'
    }, '+')
  );
}

// ===================== CHANNEL SIDEBAR =====================
function ChannelSidebar({ mobileShow, onToggle }) {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var room = ctx.currentRoom;
  var [copied, setCopied] = useState(false);
  var [showCreateModal, setShowCreateModal] = useState(false);
  var [showSettingsModal, setShowSettingsModal] = useState(false);
  var copyTimer = useRef(null);
  var [isCameraOn, setIsCameraOn] = useState(false);
  var [isScreenSharing, setIsScreenSharing] = useState(false);

  useEffect(function() {
    var vm = ctx.voiceManager;
    vm.onCameraChange = function(on) { setIsCameraOn(on); };
    vm.onScreenShareChange = function(on) { setIsScreenSharing(on); };
    return function() {
      vm.onCameraChange = null;
      vm.onScreenShareChange = null;
    };
  }, []);

  if (!room) return null;
  if (isMobile && !mobileShow) return null;

  var textChannels = (room.channels || []).filter(function(c) { return c.type === 'text'; });
  var voiceChannels = (room.channels || []).filter(function(c) { return c.type === 'voice'; });
  var videoChannels = (room.channels || []).filter(function(c) { return c.type === 'video'; });
  var isOwner = ctx.user && room.ownerId === ctx.user.id;
  var isPrivateRoom = !room.isPublic;

  function copyCode() {
    var codeToCopy = room.code;
    // For encrypted rooms, append the secret so the recipient gets the full extended code
    if (room.encrypted && typeof BossCordCrypto !== 'undefined') {
      var secret = BossCordCrypto.getRoomSecret(room.code);
      if (secret) {
        codeToCopy = room.code + '.' + secret;
      }
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(codeToCopy).catch(function() {});
    }
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(function() { setCopied(false); }, 2000);
  }

  function selectChannel(ch) {
    if (ch.id === ctx.currentChannelId) return;
    if (ch.type === 'text') {
      if (ctx.currentChannelId && ctx.socket) {
        ctx.socket.emit('leave_channel', { channelId: ctx.currentChannelId });
      }
      if (ctx.socket) {
        ctx.socket.emit('join_channel', { roomCode: room.code, channelId: ch.id });
      }
      ctx.setCurrentChannelId(ch.id);
    }
    if (isMobile && onToggle) onToggle();
  }

  function leaveRoom() {
    if (ctx.currentVoiceChannel) {
      var leavingChannelId = ctx.currentVoiceChannel;
      ctx.voiceManager.leave();
      ctx.setCurrentVoiceChannel(null);
      ctx.setVoiceUsers(function(prev) { return prev.filter(function(v) { return v.channelId !== leavingChannelId; }); });
      ctx.setIsMuted(false);
      ctx.setIsDeafened(false);
    }
    if (ctx.currentChannelId && ctx.socket) {
      ctx.socket.emit('leave_channel', { channelId: ctx.currentChannelId });
    }
    // Remove stored room secret on leave
    if (room && room.encrypted && typeof BossCordCrypto !== 'undefined') {
      BossCordCrypto.removeRoomSecret(room.code);
    }
    if (ctx.socket) {
      ctx.socket.emit('leave_room', { code: room.code });
    }
    ctx.setCurrentRoomCode(null);
    ctx.setCurrentChannelId(null);
    ctx.setMessages([]);
  }

  function joinVoice(ch) {
    if (!ctx.socket) return;
    if (ctx.currentVoiceChannel === ch.id) {
      ctx.voiceManager.leave();
      ctx.setCurrentVoiceChannel(null);
      ctx.setVoiceUsers(function(prev) { return prev.filter(function(v) { return v.channelId !== ch.id; }); });
      ctx.setIsMuted(false);
      ctx.setIsDeafened(false);
    } else {
      if (ctx.currentVoiceChannel) {
        var oldChannelId = ctx.currentVoiceChannel;
        ctx.voiceManager.leave();
        ctx.setVoiceUsers(function(prev) { return prev.filter(function(v) { return v.channelId !== oldChannelId; }); });
      }
      ctx.voiceManager.join(ctx.socket, room.code, ch.id)
        .then(function() {
          ctx.setCurrentVoiceChannel(ch.id);
          ctx.setIsMuted(false);
          ctx.setIsDeafened(false);
        })
        .catch(function(err) {
          console.error('[ChannelSidebar] Failed to join voice:', err.message);
          ctx.setCurrentVoiceChannel(null);
          ctx.setIsMuted(false);
          ctx.setIsDeafened(false);
        });
    }
  }

  function disconnectVoice() {
    if (ctx.currentVoiceChannel) {
      var dcChannelId = ctx.currentVoiceChannel;
      ctx.voiceManager.leave();
      ctx.setCurrentVoiceChannel(null);
      ctx.setVoiceUsers(function(prev) { return prev.filter(function(v) { return v.channelId !== dcChannelId; }); });
      ctx.setIsMuted(false);
      ctx.setIsDeafened(false);
    }
  }

  function toggleMute() {
    ctx.voiceManager.toggleMute();
  }

  function toggleDeafen() {
    ctx.voiceManager.toggleDeafen();
  }

  function toggleCamera() {
    if (ctx.voiceManager.isCameraOn) {
      ctx.voiceManager.stopCamera();
    } else {
      ctx.voiceManager.startCamera();
    }
  }

  function toggleScreenShare() {
    if (ctx.voiceManager.isScreenSharing) {
      ctx.voiceManager.stopScreenShare();
    } else {
      ctx.voiceManager.startScreenShare();
    }
  }

  var currentVoiceChannelName = null;
  var voiceIsInThisRoom = false;
  if (ctx.currentVoiceChannel) {
    var vch = voiceChannels.find(function(c) { return c.id === ctx.currentVoiceChannel; });
    if (!vch) {
      vch = videoChannels.find(function(c) { return c.id === ctx.currentVoiceChannel; });
    }
    if (vch) {
      currentVoiceChannelName = vch.name;
      voiceIsInThisRoom = true;
    }
  }

  var sidebarStyle = {
    width: '240px', minWidth: '240px', background: '#252528',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    position: isMobile ? 'absolute' : 'relative',
    left: isMobile ? '0' : 'auto', top: 0, bottom: 0,
    zIndex: isMobile ? 190 : 'auto'
  };

  return React.createElement('div', { style: sidebarStyle },
    // Header
    React.createElement('div', {
      style: {
        height: '48px', padding: '0 16px', display: 'flex',
        alignItems: 'center', borderBottom: '2px solid #18181b',
        flexShrink: 0, gap: '8px'
      }
    },
      React.createElement('div', {
        style: { fontWeight: 600, fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }
      }, room.name),
      room.isPublic ? React.createElement('div', {
        style: {
          background: '#57f287', borderRadius: '4px', padding: '2px 6px',
          fontSize: '10px', color: '#18181b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em'
        }
      }, 'Public') : null,
      room.encrypted ? React.createElement('div', {
        style: {
          background: '#5865f2', borderRadius: '4px', padding: '2px 6px',
          fontSize: '10px', color: '#fff', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
          display: 'flex', alignItems: 'center', gap: '3px'
        },
        title: 'End-to-end encrypted'
      }, '\uD83D\uDD12 E2E') : null,
      React.createElement('div', {
        style: {
          background: '#18181b', borderRadius: '4px', padding: '2px 6px',
          fontSize: '11px', color: copied ? '#57f287' : '#949ba4',
          cursor: 'pointer', fontWeight: 600, letterSpacing: '0.05em',
          transition: 'color 0.2s'
        },
        onClick: copyCode, title: room.encrypted ? 'Click to copy encrypted invite code (includes secret)' : 'Click to copy invite code',
        'data-allow-paste': 'true'
      }, copied ? 'Copied!' : room.code),
      isOwner ? React.createElement('div', {
        style: {
          cursor: 'pointer', color: '#949ba4', fontSize: '16px', lineHeight: '1',
          padding: '2px 4px', borderRadius: '4px', transition: 'color 0.15s',
          display: 'flex', alignItems: 'center'
        },
        onClick: function() { setShowSettingsModal(true); },
        onMouseEnter: function(e) { e.currentTarget.style.color = '#f0b232'; },
        onMouseLeave: function(e) { e.currentTarget.style.color = '#949ba4'; },
        title: 'Room Settings'
      },
        React.createElement('svg', {
          width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none',
          stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round'
        },
          React.createElement('circle', { cx: '12', cy: '12', r: '3' }),
          React.createElement('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' })
        )
      ) : null
    ),

    // Channel list
    React.createElement('div', {
      style: { flex: 1, overflowY: 'auto', padding: '12px 0', WebkitOverflowScrolling: 'touch' }
    },
      // Text channels section
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', padding: '0 8px 0 16px',
          marginBottom: '4px'
        }
      },
        React.createElement('span', {
          style: { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#949ba4', letterSpacing: '0.02em', flex: 1 }
        }, 'Text Channels'),
        isOwner ? React.createElement('span', {
          style: { color: '#949ba4', cursor: 'pointer', fontSize: '18px', lineHeight: '1', padding: '0 4px' },
          onClick: function() { setShowCreateModal(true); },
          title: 'Create Channel'
        }, '+') : null
      ),
      textChannels.map(function(ch) {
        var isActive = ch.id === ctx.currentChannelId;
        return React.createElement('div', {
          key: ch.id,
          style: {
            display: 'flex', alignItems: 'center', padding: '6px 8px 6px 16px',
            margin: '1px 8px', borderRadius: '4px', cursor: 'pointer',
            background: isActive ? '#393c43' : 'transparent',
            color: isActive ? '#fff' : '#949ba4',
            minHeight: '36px'
          },
          onClick: function() { selectChannel(ch); }
        },
          React.createElement('span', {
            style: { fontSize: '20px', marginRight: '6px', opacity: 0.6, fontWeight: 300 }
          }, '#'),
          React.createElement('span', {
            style: { fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
          }, ch.name)
        );
      }),

      // Voice channels section
      voiceChannels.length > 0 || isOwner ? React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', padding: '0 8px 0 16px',
          marginTop: '16px', marginBottom: '4px'
        }
      },
        React.createElement('span', {
          style: { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#949ba4', letterSpacing: '0.02em', flex: 1 }
        }, 'Voice Channels')
      ) : null,
      voiceChannels.map(function(ch) {
        var voiceUsersInChannel = ctx.voiceUsers.filter(function(v) { return v.channelId === ch.id; });
        var isActiveVoice = ctx.currentVoiceChannel === ch.id;
        return React.createElement('div', { key: ch.id },
          React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', padding: '6px 8px 6px 16px',
              margin: '1px 8px', borderRadius: '4px', cursor: 'pointer',
              background: isActiveVoice ? '#393c43' : 'transparent',
              color: isActiveVoice ? '#fff' : '#949ba4',
              minHeight: '36px'
            },
            onClick: function() { joinVoice(ch); }
          },
            React.createElement('span', {
              style: { fontSize: '18px', marginRight: '6px', opacity: 0.6 }
            }, '\uD83D\uDD0A'),
            React.createElement('span', {
              style: { fontSize: '15px' }
            }, ch.name)
          ),
          voiceUsersInChannel.map(function(vu) {
            return React.createElement('div', {
              key: vu.userId,
              style: {
                display: 'flex', alignItems: 'center', padding: '2px 8px 2px 40px',
                fontSize: '13px', color: '#949ba4'
              }
            },
              React.createElement('div', {
                style: {
                  width: '20px', height: '20px', borderRadius: '50%',
                  background: vu.color || '#f0b232', marginRight: '6px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '10px', color: '#fff', fontWeight: 700
                }
              }, (vu.userName || '?')[0].toUpperCase()),
              vu.userName || 'Unknown',
              React.createElement('span', {
                style: { fontSize: '10px', color: '#666', marginLeft: '3px', fontFamily: 'monospace' }
              }, '#' + (vu.tag || '????'))
            );
          })
        );
      }),

    // Video channels section
    (videoChannels.length > 0 || isOwner) ? React.createElement('div', null,
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', padding: '0 8px 0 16px',
          marginTop: '16px', marginBottom: '4px'
        }
      },
        React.createElement('span', {
          style: { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#949ba4', letterSpacing: '0.02em', flex: 1 }
        }, 'Video Channels')
      ),
      videoChannels.map(function(ch) {
        var voiceUsersInChannel = ctx.voiceUsers.filter(function(v) { return v.channelId === ch.id; });
        var isActiveVoice = ctx.currentVoiceChannel === ch.id;
        return React.createElement('div', { key: ch.id },
          React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', padding: '6px 8px 6px 16px',
              margin: '1px 8px', borderRadius: '4px', cursor: 'pointer',
              background: isActiveVoice ? '#393c43' : 'transparent',
              color: isActiveVoice ? '#fff' : '#949ba4',
              minHeight: '36px'
            },
            onClick: function() { joinVoice(ch); }
          },
            React.createElement('span', {
              style: { fontSize: '18px', marginRight: '6px', opacity: 0.6 }
            }, '\uD83D\uDCF9'),
            React.createElement('span', {
              style: { fontSize: '15px' }
            }, ch.name)
          ),
          voiceUsersInChannel.map(function(vu) {
            return React.createElement('div', {
              key: vu.userId,
              style: {
                display: 'flex', alignItems: 'center', padding: '2px 8px 2px 40px',
                fontSize: '13px', color: '#949ba4'
              }
            },
              React.createElement('div', {
                style: {
                  width: '20px', height: '20px', borderRadius: '50%',
                  background: vu.color || '#f0b232', marginRight: '6px', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '10px', color: '#fff', fontWeight: 700
                }
              }, (vu.userName || '?')[0].toUpperCase()),
              vu.userName || 'Unknown',
              React.createElement('span', {
                style: { fontSize: '10px', color: '#666', marginLeft: '3px', fontFamily: 'monospace' }
              }, '#' + (vu.tag || '????'))
            );
          })
        );
      })
    ) : null
    ),

    // Create channel modal
    showCreateModal ? React.createElement(CreateChannelModal, {
      roomCode: room.code, onClose: function() { setShowCreateModal(false); }
    }) : null,

    // Room settings modal
    showSettingsModal ? React.createElement(RoomSettingsModal, {
      room: room, onClose: function() { setShowSettingsModal(false); }
    }) : null,

    // Voice error banner
    ctx.voiceError ? React.createElement('div', {
      style: {
        padding: '10px 12px', background: '#ed4245', color: '#fff',
        fontSize: '12px', flexShrink: 0, textAlign: 'center', lineHeight: '1.4'
      }
    }, ctx.voiceError) : null,

    // Voice status bar — only show in the room where voice is active
    voiceIsInThisRoom ? React.createElement('div', {
      style: {
        background: '#232428', borderTop: '1px solid #1a1b1e',
        padding: '8px', flexShrink: 0
      }
    },
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '4px'
        }
      },
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px' }
        },
          React.createElement('div', {
            style: {
              width: '8px', height: '8px', borderRadius: '50%',
              background: '#57f287', flexShrink: 0
            }
          }),
          React.createElement('span', {
            style: { color: '#57f287', fontSize: '13px', fontWeight: 600 }
          }, 'Voice Connected')
        ),
        React.createElement('div', {
          style: {
            width: '28px', height: '28px', borderRadius: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#b5bac1'
          },
          onClick: disconnectVoice,
          title: 'Disconnect from Voice'
        },
          React.createElement('svg', {
            width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none',
            stroke: '#ed4245', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round'
          },
            React.createElement('path', { d: 'M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91' }),
            React.createElement('line', { x1: '23', y1: '1', x2: '1', y2: '23' })
          )
        )
      ),
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }
      },
        React.createElement('span', {
          style: { color: '#949ba4', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }
        }, currentVoiceChannelName ? currentVoiceChannelName : 'Voice Channel'),
        React.createElement('div', {
          style: { display: 'flex', gap: '4px' }
        },
          // Mute button
          React.createElement('div', {
            style: {
              width: '28px', height: '28px', borderRadius: '4px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', background: ctx.isMuted ? '#ed4245' : 'transparent',
              color: ctx.isMuted ? '#fff' : '#b5bac1',
              transition: 'background 0.15s'
            },
            onClick: toggleMute,
            title: ctx.isMuted ? 'Unmute' : 'Mute'
          },
            React.createElement('svg', {
              width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none',
              stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round'
            },
              ctx.isMuted ? [
                React.createElement('line', { key: 'm1', x1: '1', y1: '1', x2: '23', y2: '23' }),
                React.createElement('path', { key: 'm2', d: 'M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6' }),
                React.createElement('path', { key: 'm3', d: 'M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.12 1.5-.35 2.18' }),
                React.createElement('line', { key: 'm4', x1: '12', y1: '19', x2: '12', y2: '23' }),
                React.createElement('line', { key: 'm5', x1: '8', y1: '23', x2: '16', y2: '23' })
              ] : [
                React.createElement('path', { key: 'u1', d: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z' }),
                React.createElement('path', { key: 'u2', d: 'M19 10v2a7 7 0 0 1-14 0v-2' }),
                React.createElement('line', { key: 'u3', x1: '12', y1: '19', x2: '12', y2: '23' }),
                React.createElement('line', { key: 'u4', x1: '8', y1: '23', x2: '16', y2: '23' })
              ]
            )
          ),
          // Deafen button
          React.createElement('div', {
            style: {
              width: '28px', height: '28px', borderRadius: '4px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', background: ctx.isDeafened ? '#ed4245' : 'transparent',
              color: ctx.isDeafened ? '#fff' : '#b5bac1',
              transition: 'background 0.15s'
            },
            onClick: toggleDeafen,
            title: ctx.isDeafened ? 'Undeafen' : 'Deafen'
          },
            React.createElement('svg', {
              width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none',
              stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round'
            },
              ctx.isDeafened ? [
                React.createElement('line', { key: 'd1', x1: '1', y1: '1', x2: '23', y2: '23' }),
                React.createElement('path', { key: 'd2', d: 'M17 18.5A6.98 6.98 0 0 1 5 12V9' }),
                React.createElement('path', { key: 'd3', d: 'M9 9H5a2 2 0 0 0-2 2v1a7 7 0 0 0 1.78 4.66' }),
                React.createElement('path', { key: 'd4', d: 'M19 12v-1a2 2 0 0 0-2-2h-1.5' }),
                React.createElement('path', { key: 'd5', d: 'M21 15v-3a2 2 0 0 0-2-2h-4a7 7 0 0 0 3 5.74' })
              ] : [
                React.createElement('path', { key: 'h1', d: 'M3 18v-6a9 9 0 0 1 18 0v6' }),
                React.createElement('path', { key: 'h2', d: 'M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z' })
              ]
            )
          ),
          // Camera button (only for private rooms)
          isPrivateRoom ? React.createElement('div', {
            style: {
              width: '28px', height: '28px', borderRadius: '4px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', background: isCameraOn ? '#f0b232' : 'transparent',
              color: isCameraOn ? '#1c1c1e' : '#b5bac1',
              transition: 'background 0.15s'
            },
            onClick: toggleCamera,
            title: isCameraOn ? 'Turn off camera' : 'Turn on camera'
          },
            React.createElement('svg', {
              width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none',
              stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round'
            },
              isCameraOn ? [
                React.createElement('path', { key: 'cv1', d: 'M23 7l-7 5 7 5V7z' }),
                React.createElement('rect', { key: 'cv2', x: '1', y: '5', width: '15', height: '14', rx: '2', ry: '2' })
              ] : [
                React.createElement('path', { key: 'co1', d: 'M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10' }),
                React.createElement('line', { key: 'co2', x1: '1', y1: '1', x2: '23', y2: '23' })
              ]
            )
          ) : null,
          // Screen share button (only for private rooms)
          isPrivateRoom ? React.createElement('div', {
            style: {
              width: '28px', height: '28px', borderRadius: '4px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', background: isScreenSharing ? '#f0b232' : 'transparent',
              color: isScreenSharing ? '#1c1c1e' : '#b5bac1',
              transition: 'background 0.15s'
            },
            onClick: toggleScreenShare,
            title: isScreenSharing ? 'Stop screen share' : 'Share screen'
          },
            React.createElement('svg', {
              width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none',
              stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round'
            },
              React.createElement('rect', { x: '2', y: '3', width: '20', height: '14', rx: '2', ry: '2' }),
              React.createElement('line', { x1: '8', y1: '21', x2: '16', y2: '21' }),
              React.createElement('line', { x1: '12', y1: '17', x2: '12', y2: '21' })
            )
          ) : null
        )
      )
    ) : null,

    // Bottom user panel
    React.createElement('div', {
      style: {
        height: '52px', background: '#232428', display: 'flex',
        alignItems: 'center', padding: '0 8px', flexShrink: 0, gap: '8px'
      }
    },
      ctx.user && ctx.user.avatar
        ? React.createElement('img', {
            src: ctx.user.avatar,
            style: {
              width: '32px', height: '32px', borderRadius: '50%',
              objectFit: 'cover', flexShrink: 0
            }
          })
        : React.createElement('div', {
            style: {
              width: '32px', height: '32px', borderRadius: '50%',
              background: ctx.user ? ctx.user.color || '#f0b232' : '#f0b232',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '14px', color: '#fff', flexShrink: 0
            }
          }, ctx.user ? (ctx.user.name || '?')[0].toUpperCase() : '?'),
      React.createElement('div', { style: { flex: 1, overflow: 'hidden' } },
        React.createElement('div', {
          style: { fontSize: '14px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
        }, ctx.user ? ctx.user.name : '...'),
        React.createElement('div', {
          style: { fontSize: '11px', color: '#949ba4' }
        }, 'Anonymous')
      ),
      React.createElement('div', {
        style: {
          width: '32px', height: '32px', borderRadius: '4px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: '#b5bac1', fontSize: '14px'
        },
        onClick: leaveRoom,
        title: 'Leave Room'
      },
        React.createElement('svg', {
          width: '20', height: '20', viewBox: '0 0 24 24', fill: 'none',
          stroke: '#ed4245', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round'
        },
          React.createElement('path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }),
          React.createElement('polyline', { points: '16 17 21 12 16 7' }),
          React.createElement('line', { x1: '21', y1: '12', x2: '9', y2: '12' })
        )
      )
    )
  );
}

// ===================== ROOM SETTINGS MODAL =====================
var ROOM_CATEGORIES = ['General', 'Gaming', 'Social', 'Trading', 'Music', 'Other'];

function RoomSettingsModal({ room, onClose }) {
  var ctx = useSocket();
  var [settingsName, setSettingsName] = useState(room.name || '');
  var [settingsDescription, setSettingsDescription] = useState(room.description || '');
  var [settingsIsPublic, setSettingsIsPublic] = useState(!!room.isPublic);
  var [settingsCategory, setSettingsCategory] = useState(room.category || 'General');
  var [saving, setSaving] = useState(false);
  var [codeCopied, setCodeCopied] = useState(false);
  var codeCopyTimer = useRef(null);
  var [newChannelName, setNewChannelName] = useState('');
  var [newChannelType, setNewChannelType] = useState('text');
  var [creatingChannel, setCreatingChannel] = useState(false);
  var [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  var [deleting, setDeleting] = useState(false);
  var [activeTab, setActiveTab] = useState('general');
  var overlayRef = useRef(null);

  useEffect(function() {
    function handleKey(e) {
      if (e.key === 'Escape') {
        if (showDeleteConfirm) { setShowDeleteConfirm(false); }
        else { onClose(); }
      }
    }
    window.addEventListener('keydown', handleKey);
    return function() {
      window.removeEventListener('keydown', handleKey);
      if (codeCopyTimer.current) clearTimeout(codeCopyTimer.current);
    };
  }, [onClose, showDeleteConfirm]);

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose();
  }

  function handleSave() {
    var name = settingsName.trim();
    if (!name || !ctx.socket) return;
    setSaving(true);
    ctx.socket.emit('room_update_settings', {
      roomCode: room.code,
      name: name,
      description: settingsDescription.trim(),
      isPublic: settingsIsPublic,
      category: settingsCategory
    });
    setTimeout(function() {
      setSaving(false);
      onClose();
    }, 300);
  }

  function handleCopyCode() {
    var codeToCopy = room.code;
    if (room.encrypted && typeof BossCordCrypto !== 'undefined') {
      var secret = BossCordCrypto.getRoomSecret(room.code);
      if (secret) {
        codeToCopy = room.code + '.' + secret;
      }
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(codeToCopy).catch(function() {});
    }
    setCodeCopied(true);
    if (codeCopyTimer.current) clearTimeout(codeCopyTimer.current);
    codeCopyTimer.current = setTimeout(function() { setCodeCopied(false); }, 2000);
  }

  function formatChannelName(val) {
    return val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
  }

  function handleCreateChannel() {
    var name = newChannelName.trim();
    if (!name || !ctx.socket) return;
    setCreatingChannel(true);
    ctx.socket.emit('create_channel', { roomCode: room.code, name: name, type: newChannelType });
    setTimeout(function() {
      setCreatingChannel(false);
      setNewChannelName('');
    }, 300);
  }

  function handleDeleteRoom() {
    if (!ctx.socket) return;
    setDeleting(true);
    ctx.socket.emit('delete_room', { roomCode: room.code });
    // The server will emit room_left to us and kicked_from_room to others.
    // Give a brief moment for the socket event to process before closing.
    setTimeout(function() {
      setDeleting(false);
      onClose();
    }, 500);
  }

  var inputStyle = {
    width: '100%', padding: '10px 12px', background: '#18181b',
    border: 'none', borderRadius: '4px', color: '#dcddde',
    fontSize: '14px', outline: 'none', fontFamily: 'inherit',
    boxSizing: 'border-box'
  };

  var labelStyle = {
    display: 'block', color: '#b5bac1', fontSize: '12px',
    fontWeight: 700, textTransform: 'uppercase', marginBottom: '6px'
  };

  var sectionDivider = React.createElement('div', {
    style: { height: '1px', background: '#393c43', margin: '16px 0' }
  });

  // Tab button helper
  function tabBtn(id, label) {
    var isActive = activeTab === id;
    return React.createElement('button', {
      key: id,
      style: {
        flex: 1, padding: '8px 4px', background: 'transparent',
        border: 'none', borderBottom: isActive ? '2px solid #f0b232' : '2px solid transparent',
        color: isActive ? '#f0b232' : '#949ba4', fontSize: '13px',
        fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
        transition: 'color 0.15s, border-color 0.15s'
      },
      onClick: function() { setActiveTab(id); }
    }, label);
  }

  // ----- Tab: General (name, description, category, visibility) -----
  function renderGeneralTab() {
    return React.createElement('div', { style: { animation: 'fadeIn 0.15s ease' } },

      // Room Code section
      React.createElement('label', { style: labelStyle }, 'Room Code'),
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px'
        }
      },
        React.createElement('div', {
          style: {
            flex: 1, padding: '10px 12px', background: '#18181b',
            borderRadius: '4px', color: '#949ba4', fontSize: '14px',
            fontFamily: 'monospace', letterSpacing: '0.05em',
            userSelect: 'all'
          }
        }, room.code),
        React.createElement('button', {
          style: {
            padding: '10px 14px', background: codeCopied ? '#57f287' : '#393c43',
            border: 'none', borderRadius: '4px',
            color: codeCopied ? '#18181b' : '#dcddde',
            fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', transition: 'background 0.15s, color 0.15s',
            whiteSpace: 'nowrap'
          },
          onClick: handleCopyCode
        }, codeCopied ? 'Copied!' : 'Copy')
      ),

      // Room Name
      React.createElement('label', { style: labelStyle }, 'Room Name'),
      React.createElement('input', {
        type: 'text', style: inputStyle, value: settingsName,
        onChange: function(e) { setSettingsName(e.target.value); },
        maxLength: 64, autoFocus: true
      }),

      // Description
      React.createElement('label', {
        style: Object.assign({}, labelStyle, { marginTop: '16px' })
      }, 'Description'),
      React.createElement('input', {
        type: 'text', style: inputStyle, value: settingsDescription,
        onChange: function(e) { setSettingsDescription(e.target.value); },
        placeholder: 'What is this room about?',
        maxLength: 200
      }),

      // Category
      React.createElement('label', {
        style: Object.assign({}, labelStyle, { marginTop: '16px' })
      }, 'Category'),
      React.createElement('select', {
        style: {
          width: '100%', padding: '10px 12px', background: '#18181b',
          border: 'none', borderRadius: '4px', color: '#dcddde',
          fontSize: '14px', outline: 'none', fontFamily: 'inherit',
          cursor: 'pointer', appearance: 'auto', boxSizing: 'border-box'
        },
        value: settingsCategory,
        onChange: function(e) { setSettingsCategory(e.target.value); }
      },
        ROOM_CATEGORIES.map(function(cat) {
          return React.createElement('option', { key: cat, value: cat }, cat);
        })
      ),

      // Public toggle
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '12px',
          marginTop: '16px', padding: '12px 16px',
          background: '#18181b', borderRadius: '8px'
        }
      },
        React.createElement('div', { style: { flex: 1 } },
          React.createElement('div', {
            style: { fontWeight: 600, fontSize: '14px', marginBottom: '2px' }
          }, 'Public Room'),
          React.createElement('div', {
            style: { color: '#949ba4', fontSize: '12px' }
          }, settingsIsPublic ? 'Anyone can find and join this room' : 'Only people with the invite code can join')
        ),
        React.createElement('div', {
          style: {
            width: '44px', height: '24px', borderRadius: '12px',
            background: settingsIsPublic ? '#57f287' : '#72767d',
            cursor: 'pointer', position: 'relative',
            transition: 'background 0.2s'
          },
          onClick: function() { setSettingsIsPublic(!settingsIsPublic); }
        },
          React.createElement('div', {
            style: {
              width: '20px', height: '20px', borderRadius: '50%',
              background: '#fff', position: 'absolute',
              top: '2px', left: settingsIsPublic ? '22px' : '2px',
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
            }
          })
        )
      ),

      // Save / Cancel buttons
      React.createElement('div', {
        style: { display: 'flex', gap: '8px', marginTop: '20px' }
      },
        React.createElement('button', {
          style: {
            flex: 1, padding: '10px', background: saving ? '#a07820' : '#f0b232',
            border: 'none', borderRadius: '4px', color: '#1c1c1e',
            fontSize: '14px', fontWeight: 600, cursor: settingsName.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', opacity: settingsName.trim() ? 1 : 0.5,
            transition: 'background 0.15s'
          },
          onClick: handleSave,
          disabled: !settingsName.trim() || saving
        }, saving ? 'Saving...' : 'Save Changes'),
        React.createElement('button', {
          style: {
            padding: '10px 16px', background: 'transparent',
            border: '1px solid #949ba4', borderRadius: '4px',
            color: '#949ba4', fontSize: '14px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: onClose
        }, 'Cancel')
      )
    );
  }

  // ----- Tab: Channels -----
  function renderChannelsTab() {
    var textChannels = (room.channels || []).filter(function(c) { return c.type === 'text'; });
    var voiceChannels = (room.channels || []).filter(function(c) { return c.type === 'voice'; });
    var videoChannels = (room.channels || []).filter(function(c) { return c.type === 'video'; });

    function channelRow(ch, icon) {
      return React.createElement('div', {
        key: ch.id,
        style: {
          display: 'flex', alignItems: 'center', padding: '8px 12px',
          background: '#18181b', borderRadius: '4px', marginBottom: '4px'
        }
      },
        React.createElement('span', {
          style: { marginRight: '8px', opacity: 0.6, fontSize: '16px' }
        }, icon),
        React.createElement('span', {
          style: { fontSize: '14px', color: '#dcddde', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
        }, ch.name)
      );
    }

    return React.createElement('div', { style: { animation: 'fadeIn 0.15s ease' } },

      // Existing channels list
      React.createElement('label', { style: labelStyle }, 'Existing Channels'),
      React.createElement('div', {
        style: { maxHeight: '160px', overflowY: 'auto', marginBottom: '16px' }
      },
        textChannels.length === 0 && voiceChannels.length === 0 && videoChannels.length === 0
          ? React.createElement('div', {
              style: { color: '#949ba4', fontSize: '13px', padding: '8px 0' }
            }, 'No channels yet.')
          : [].concat(
              textChannels.map(function(ch) { return channelRow(ch, '#'); }),
              voiceChannels.map(function(ch) { return channelRow(ch, '\uD83D\uDD0A'); }),
              videoChannels.map(function(ch) { return channelRow(ch, '\uD83D\uDCF9'); })
            )
      ),

      sectionDivider,

      // Create new channel
      React.createElement('label', { style: labelStyle }, 'Create New Channel'),

      // Channel type selector
      React.createElement('div', {
        style: { display: 'flex', gap: '6px', marginBottom: '10px' }
      },
        React.createElement('button', {
          style: {
            flex: 1, padding: '8px', background: newChannelType === 'text' ? '#f0b232' : '#18181b',
            border: 'none', borderRadius: '4px',
            color: newChannelType === 'text' ? '#1c1c1e' : '#dcddde',
            cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
            transition: 'background 0.15s'
          },
          onClick: function() { setNewChannelType('text'); }
        }, '# Text'),
        React.createElement('button', {
          style: {
            flex: 1, padding: '8px', background: newChannelType === 'voice' ? '#f0b232' : '#18181b',
            border: 'none', borderRadius: '4px',
            color: newChannelType === 'voice' ? '#1c1c1e' : '#dcddde',
            cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
            transition: 'background 0.15s'
          },
          onClick: function() { setNewChannelType('voice'); }
        }, '\uD83D\uDD0A Voice'),
        React.createElement('button', {
          style: {
            flex: 1, padding: '8px', background: newChannelType === 'video' ? '#f0b232' : '#18181b',
            border: 'none', borderRadius: '4px',
            color: newChannelType === 'video' ? '#1c1c1e' : '#dcddde',
            cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
            transition: 'background 0.15s'
          },
          onClick: function() { setNewChannelType('video'); }
        }, '\uD83D\uDCF9 Video')
      ),

      // Channel name input + create button
      React.createElement('div', {
        style: { display: 'flex', gap: '8px' }
      },
        React.createElement('input', {
          type: 'text', value: newChannelName,
          onChange: function(e) { setNewChannelName(formatChannelName(e.target.value)); },
          onKeyDown: function(e) { if (e.key === 'Enter') handleCreateChannel(); },
          placeholder: newChannelType === 'text' ? 'new-text-channel' : (newChannelType === 'video' ? 'video-lounge' : 'General'),
          maxLength: 32,
          style: Object.assign({}, inputStyle, { flex: 1 })
        }),
        React.createElement('button', {
          style: {
            padding: '10px 16px', background: (newChannelName.trim() && !creatingChannel) ? '#f0b232' : '#393c43',
            border: 'none', borderRadius: '4px',
            color: (newChannelName.trim() && !creatingChannel) ? '#1c1c1e' : '#949ba4',
            fontSize: '13px', fontWeight: 600, cursor: newChannelName.trim() ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', transition: 'background 0.15s',
            whiteSpace: 'nowrap'
          },
          onClick: handleCreateChannel,
          disabled: !newChannelName.trim() || creatingChannel
        }, creatingChannel ? 'Creating...' : 'Create')
      )
    );
  }

  // ----- Tab: Danger Zone -----
  function renderDangerTab() {
    return React.createElement('div', { style: { animation: 'fadeIn 0.15s ease' } },
      React.createElement('div', {
        style: {
          padding: '16px', background: 'rgba(237,66,69,0.1)',
          border: '1px solid rgba(237,66,69,0.3)', borderRadius: '8px'
        }
      },
        React.createElement('div', {
          style: { fontWeight: 700, fontSize: '16px', color: '#ed4245', marginBottom: '8px' }
        }, 'Delete Room'),
        React.createElement('div', {
          style: { color: '#949ba4', fontSize: '13px', lineHeight: '1.5', marginBottom: '16px' }
        }, 'Permanently delete "' + room.name + '" and all its channels and messages. All members will be removed. This action cannot be undone.'),

        !showDeleteConfirm
          ? React.createElement('button', {
              style: {
                padding: '10px 20px', background: '#ed4245',
                border: 'none', borderRadius: '4px', color: '#fff',
                fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'background 0.15s'
              },
              onMouseEnter: function(e) { e.currentTarget.style.background = '#c93a3d'; },
              onMouseLeave: function(e) { e.currentTarget.style.background = '#ed4245'; },
              onClick: function() { setShowDeleteConfirm(true); }
            }, 'Delete This Room')
          : React.createElement('div', {
              style: { animation: 'fadeIn 0.15s ease' }
            },
              React.createElement('div', {
                style: {
                  color: '#ed4245', fontSize: '14px', fontWeight: 600,
                  marginBottom: '12px'
                }
              }, 'Are you sure? This is permanent.'),
              React.createElement('div', {
                style: { display: 'flex', gap: '8px' }
              },
                React.createElement('button', {
                  style: {
                    flex: 1, padding: '10px', background: deleting ? '#8b2a2d' : '#ed4245',
                    border: 'none', borderRadius: '4px', color: '#fff',
                    fontSize: '14px', fontWeight: 600,
                    cursor: deleting ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', transition: 'background 0.15s'
                  },
                  onClick: handleDeleteRoom,
                  disabled: deleting
                }, deleting ? 'Deleting...' : 'Yes, Delete Permanently'),
                React.createElement('button', {
                  style: {
                    flex: 1, padding: '10px', background: 'transparent',
                    border: '1px solid #949ba4', borderRadius: '4px',
                    color: '#949ba4', fontSize: '14px', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit'
                  },
                  onClick: function() { setShowDeleteConfirm(false); }
                }, 'Cancel')
              )
            )
      )
    );
  }

  return React.createElement('div', {
    ref: overlayRef,
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 10000
    },
    onClick: handleOverlayClick
  },
    React.createElement('div', {
      style: {
        background: '#1e1f22', borderRadius: '8px',
        width: '480px', maxWidth: '92vw', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        animation: 'slideInUp 0.2s ease', overflow: 'hidden'
      }
    },
      // Modal header
      React.createElement('div', {
        style: {
          padding: '20px 24px 0 24px', flexShrink: 0
        }
      },
        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '16px'
          }
        },
          React.createElement('h3', {
            style: { fontSize: '20px', fontWeight: 700, color: '#f0b232', margin: 0 }
          }, 'Room Settings'),
          React.createElement('div', {
            style: {
              width: '28px', height: '28px', borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#949ba4', fontSize: '18px',
              transition: 'color 0.15s'
            },
            onClick: onClose,
            onMouseEnter: function(e) { e.currentTarget.style.color = '#dcddde'; },
            onMouseLeave: function(e) { e.currentTarget.style.color = '#949ba4'; },
            title: 'Close'
          },
            React.createElement('svg', {
              width: '18', height: '18', viewBox: '0 0 24 24', fill: 'none',
              stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round'
            },
              React.createElement('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
              React.createElement('line', { x1: '6', y1: '6', x2: '18', y2: '18' })
            )
          )
        ),

        // Tab bar
        React.createElement('div', {
          style: {
            display: 'flex', gap: '0', borderBottom: '1px solid #393c43'
          }
        },
          tabBtn('general', 'General'),
          tabBtn('channels', 'Channels'),
          tabBtn('danger', 'Danger Zone')
        )
      ),

      // Tab content (scrollable)
      React.createElement('div', {
        style: {
          padding: '16px 24px 24px 24px', overflowY: 'auto',
          flex: 1
        }
      },
        activeTab === 'general' ? renderGeneralTab() : null,
        activeTab === 'channels' ? renderChannelsTab() : null,
        activeTab === 'danger' ? renderDangerTab() : null
      )
    )
  );
}

// ===================== CREATE CHANNEL MODAL =====================
function CreateChannelModal({ roomCode, onClose }) {
  var ctx = useSocket();
  var [channelType, setChannelType] = useState('text');
  var [channelName, setChannelName] = useState('');
  var overlayRef = useRef(null);
  var isPrivateRoom = ctx.currentRoom && !ctx.currentRoom.isPublic;

  function formatName(val) {
    return val.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '');
  }

  function handleCreate() {
    var name = channelName.trim();
    if (!name || !ctx.socket) return;
    ctx.socket.emit('create_channel', { roomCode: roomCode, name: name, type: channelType });
    onClose();
  }

  useEffect(function() {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return function() { window.removeEventListener('keydown', handleKey); };
  }, [onClose]);

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose();
  }

  return React.createElement('div', {
    ref: overlayRef,
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 10000
    },
    onClick: handleOverlayClick
  },
    React.createElement('div', {
      style: {
        background: '#252528', borderRadius: '8px', padding: '24px',
        width: '440px', maxWidth: '90vw', animation: 'fadeIn 0.2s ease'
      }
    },
      React.createElement('h3', {
        style: { fontSize: '20px', fontWeight: 700, marginBottom: '16px' }
      }, 'Create Channel'),

      React.createElement('div', {
        style: { display: 'flex', gap: '8px', marginBottom: '16px' }
      },
        React.createElement('button', {
          style: {
            flex: 1, padding: '10px', background: channelType === 'text' ? '#f0b232' : '#18181b',
            border: 'none', borderRadius: '4px', color: '#dcddde',
            cursor: 'pointer', fontSize: '14px', fontWeight: 600, fontFamily: 'inherit',
            minHeight: '44px'
          },
          onClick: function() { setChannelType('text'); }
        }, '# Text'),
        React.createElement('button', {
          style: {
            flex: 1, padding: '10px', background: channelType === 'voice' ? '#f0b232' : '#18181b',
            border: 'none', borderRadius: '4px', color: '#dcddde',
            cursor: 'pointer', fontSize: '14px', fontWeight: 600, fontFamily: 'inherit',
            minHeight: '44px'
          },
          onClick: function() { setChannelType('voice'); }
        }, '\uD83D\uDD0A Voice'),
        React.createElement('button', {
          style: {
            flex: 1, padding: '10px', background: channelType === 'video' ? '#f0b232' : '#18181b',
            border: 'none', borderRadius: '4px', color: '#dcddde',
            cursor: 'pointer', fontSize: '14px', fontWeight: 600, fontFamily: 'inherit',
            minHeight: '44px'
          },
          onClick: function() { setChannelType('video'); }
        }, '\uD83D\uDCF9 Video')
      ),

      React.createElement('label', {
        style: { display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', marginBottom: '8px' }
      }, 'Channel Name'),
      React.createElement('input', {
        type: 'text', value: channelName,
        onChange: function(e) { setChannelName(formatName(e.target.value)); },
        onPaste: blockPaste, onDrop: blockDrop,
        onKeyDown: function(e) { if (e.key === 'Enter') handleCreate(); },
        placeholder: channelType === 'text' ? 'new-text-channel' : (channelType === 'video' ? 'video-lounge' : 'General'),
        maxLength: 64, autoFocus: true,
        style: {
          width: '100%', padding: '10px 12px', background: '#18181b',
          border: 'none', borderRadius: '4px', color: '#dcddde',
          fontSize: '16px', outline: 'none', fontFamily: 'inherit',
          minHeight: '44px'
        }
      }),

      React.createElement('div', {
        style: { display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }
      },
        React.createElement('button', {
          style: {
            padding: '10px 24px', background: 'transparent', border: 'none',
            color: '#949ba4', cursor: 'pointer', fontSize: '14px', fontFamily: 'inherit',
            minHeight: '44px'
          },
          onClick: onClose
        }, 'Cancel'),
        React.createElement('button', {
          style: {
            padding: '10px 24px', background: '#f0b232', border: 'none',
            borderRadius: '4px', color: '#1c1c1e', cursor: 'pointer',
            fontSize: '14px', fontWeight: 600, fontFamily: 'inherit',
            minHeight: '44px'
          },
          onClick: handleCreate, disabled: !channelName.trim()
        }, 'Create Channel')
      )
    )
  );
}


// ===================== EMOJI PICKER =====================
var EMOJI_CATEGORIES = [
  { name: 'Smileys', icon: '\uD83D\uDE00', emojis: ['\uD83D\uDE00','\uD83D\uDE03','\uD83D\uDE04','\uD83D\uDE01','\uD83D\uDE06','\uD83D\uDE05','\uD83E\uDD23','\uD83D\uDE02','\uD83D\uDE42','\uD83D\uDE43','\uD83D\uDE09','\uD83D\uDE0A','\uD83D\uDE07','\uD83E\uDD70','\uD83D\uDE0D','\uD83E\uDD29','\uD83D\uDE18','\uD83D\uDE17','\uD83D\uDE1A','\uD83D\uDE19','\uD83E\uDD72','\uD83D\uDE0B','\uD83D\uDE1B','\uD83D\uDE1C','\uD83E\uDD2A','\uD83D\uDE1D','\uD83E\uDD11','\uD83E\uDD17','\uD83E\uDD2D','\uD83E\uDD2B','\uD83E\uDD14','\uD83E\uDD10','\uD83E\uDD28','\uD83D\uDE10','\uD83D\uDE11','\uD83D\uDE36','\uD83D\uDE0F','\uD83D\uDE12','\uD83D\uDE44','\uD83D\uDE2C','\uD83E\uDD25','\uD83D\uDE0C','\uD83D\uDE14','\uD83D\uDE2A','\uD83E\uDD24','\uD83D\uDE34','\uD83D\uDE37','\uD83E\uDD12','\uD83E\uDD15','\uD83E\uDD22','\uD83E\uDD2E','\uD83E\uDD27','\uD83E\uDD75','\uD83E\uDD76','\uD83E\uDD74','\uD83D\uDE35','\uD83E\uDD2F','\uD83E\uDD20','\uD83E\uDD73','\uD83E\uDD78','\uD83D\uDE0E','\uD83E\uDD13','\uD83E\uDDD0','\uD83D\uDE15','\uD83D\uDE1F','\uD83D\uDE41','\uD83D\uDE2E','\uD83D\uDE2F','\uD83D\uDE32','\uD83D\uDE33','\uD83E\uDD7A','\uD83D\uDE26','\uD83D\uDE27','\uD83D\uDE28','\uD83D\uDE30','\uD83D\uDE25','\uD83D\uDE22','\uD83D\uDE2D','\uD83D\uDE31','\uD83D\uDE16','\uD83D\uDE23','\uD83D\uDE1E','\uD83D\uDE13','\uD83D\uDE29','\uD83D\uDE24','\uD83D\uDE20','\uD83D\uDE21','\uD83E\uDD2C','\uD83E\uDD2F','\uD83D\uDE08','\uD83D\uDC7F','\uD83D\uDC80','\uD83D\uDCA9','\uD83E\uDD21','\uD83D\uDC7B','\uD83D\uDC7D','\uD83E\uDD16','\uD83D\uDE3A','\uD83D\uDE38'] },
  { name: 'Gestures', icon: '\uD83D\uDC4D', emojis: ['\uD83D\uDC4D','\uD83D\uDC4E','\uD83D\uDC4A','\u270A','\uD83E\uDD1B','\uD83E\uDD1C','\uD83D\uDC4F','\uD83D\uDE4C','\uD83D\uDC4B','\uD83E\uDD1A','\uD83D\uDC4C','\u270C\uFE0F','\uD83E\uDD1E','\uD83E\uDD1F','\uD83E\uDD18','\uD83D\uDC48','\uD83D\uDC49','\uD83D\uDC46','\uD83D\uDC47','\u261D\uFE0F','\u270B','\uD83E\uDD1A','\uD83D\uDD90\uFE0F','\uD83D\uDD96','\uD83D\uDE4F','\uD83D\uDCAA','\uD83E\uDDB5','\uD83E\uDDB6','\uD83D\uDC42','\uD83D\uDC40','\uD83D\uDC41\uFE0F','\uD83D\uDC45','\uD83D\uDC44','\uD83E\uDDE0','\u2764\uFE0F','\uD83E\uDDE1','\uD83D\uDC9B','\uD83D\uDC9A','\uD83D\uDC99','\uD83D\uDC9C','\uD83D\uDDA4','\uD83D\uDC94','\u2763\uFE0F','\uD83D\uDC95','\uD83D\uDC9E','\uD83D\uDC93','\uD83D\uDC97','\uD83D\uDC96','\uD83D\uDC98','\uD83D\uDC9D','\uD83D\uDC8C'] },
  { name: 'People', icon: '\uD83D\uDC68', emojis: ['\uD83D\uDC76','\uD83D\uDC67','\uD83E\uDDD2','\uD83D\uDC66','\uD83D\uDC69','\uD83E\uDDD1','\uD83D\uDC68','\uD83D\uDC71','\uD83D\uDC74','\uD83D\uDC75','\uD83D\uDE4D','\uD83D\uDE4E','\uD83D\uDE45','\uD83D\uDE46','\uD83D\uDC81','\uD83D\uDE4B','\uD83E\uDDCF','\uD83D\uDE47','\uD83E\uDD26','\uD83E\uDD37','\uD83D\uDC6E','\uD83D\uDD75\uFE0F','\uD83D\uDC82','\uD83E\uDD77','\uD83D\uDC77','\uD83E\uDD34','\uD83D\uDC78','\uD83E\uDD35','\uD83D\uDC70','\uD83E\uDD30','\uD83E\uDD31','\uD83D\uDC7C','\uD83C\uDF85','\uD83E\uDD36','\uD83E\uDDB8','\uD83E\uDDB9','\uD83E\uDDDA','\uD83E\uDDDD','\uD83E\uDDDE','\uD83E\uDDDF','\uD83E\uDDDB','\uD83E\uDDDC','\uD83E\uDDE7','\uD83E\uDDE3','\uD83E\uDDE4','\uD83D\uDC83','\uD83D\uDD7A'] },
  { name: 'Nature', icon: '\uD83D\uDC36', emojis: ['\uD83D\uDC36','\uD83D\uDC31','\uD83D\uDC2D','\uD83D\uDC39','\uD83D\uDC30','\uD83E\uDD8A','\uD83D\uDC3B','\uD83D\uDC3C','\uD83D\uDC28','\uD83D\uDC2F','\uD83E\uDD81','\uD83D\uDC2E','\uD83D\uDC37','\uD83D\uDC38','\uD83D\uDC35','\uD83D\uDE48','\uD83D\uDE49','\uD83D\uDE4A','\uD83D\uDC12','\uD83D\uDC14','\uD83D\uDC27','\uD83D\uDC26','\uD83D\uDC24','\uD83E\uDD86','\uD83E\uDD85','\uD83E\uDD89','\uD83E\uDD87','\uD83D\uDC3A','\uD83D\uDC17','\uD83D\uDC34','\uD83E\uDD84','\uD83D\uDC1D','\uD83D\uDC1B','\uD83E\uDD8B','\uD83D\uDC0C','\uD83D\uDC1A','\uD83D\uDC1E','\uD83D\uDC1C','\uD83E\uDD97','\uD83E\uDD82','\uD83E\uDD80','\uD83D\uDC0D','\uD83E\uDD8E','\uD83D\uDC22','\uD83D\uDC19','\uD83E\uDD91','\uD83E\uDD90','\uD83D\uDC20','\uD83D\uDC1F','\uD83D\uDC21','\uD83D\uDC2C','\uD83D\uDC33','\uD83E\uDD88','\uD83D\uDC0A','\uD83D\uDC05','\uD83D\uDC06','\uD83E\uDD93','\uD83E\uDD8D','\uD83D\uDC18','\uD83E\uDD9B','\uD83D\uDC2A','\uD83E\uDD92','\uD83E\uDD98','\uD83E\uDD9A','\uD83C\uDF3B','\uD83C\uDF39','\uD83C\uDF37','\uD83C\uDF3A','\uD83C\uDF38','\uD83C\uDF3C','\uD83C\uDF35','\uD83C\uDF32','\uD83C\uDF33','\uD83C\uDF34','\uD83C\uDF31','\uD83C\uDF3F','\u2618\uFE0F','\uD83C\uDF40','\uD83C\uDF41','\uD83C\uDF42','\uD83C\uDF43'] },
  { name: 'Food', icon: '\uD83C\uDF54', emojis: ['\uD83C\uDF4E','\uD83C\uDF4F','\uD83C\uDF4A','\uD83C\uDF4B','\uD83C\uDF4C','\uD83C\uDF49','\uD83C\uDF47','\uD83C\uDF53','\uD83E\uDED0','\uD83C\uDF48','\uD83C\uDF50','\uD83C\uDF51','\uD83C\uDF52','\uD83C\uDF45','\uD83E\uDD65','\uD83E\uDD51','\uD83C\uDF46','\uD83E\uDD54','\uD83E\uDD55','\uD83C\uDF3D','\uD83C\uDF36\uFE0F','\uD83E\uDD52','\uD83E\uDD66','\uD83E\uDDC4','\uD83E\uDDC5','\uD83E\uDD5C','\uD83C\uDF5E','\uD83E\uDD50','\uD83E\uDD56','\uD83E\uDDC0','\uD83C\uDF56','\uD83C\uDF57','\uD83E\uDD69','\uD83C\uDF54','\uD83C\uDF5F','\uD83C\uDF55','\uD83C\uDF2D','\uD83E\uDD6A','\uD83C\uDF2E','\uD83C\uDF2F','\uD83E\uDD59','\uD83E\uDD5A','\uD83C\uDF73','\uD83E\uDD58','\uD83C\uDF72','\uD83E\uDD63','\uD83E\uDD57','\uD83C\uDF5D','\uD83C\uDF5C','\uD83C\uDF63','\uD83C\uDF71','\uD83C\uDF5B','\uD83C\uDF5A','\uD83C\uDF59','\uD83C\uDF58','\uD83C\uDF65','\uD83E\uDD60','\uD83C\uDF62','\uD83C\uDF61','\uD83C\uDF67','\uD83C\uDF68','\uD83C\uDF66','\uD83C\uDF70','\uD83C\uDF82','\uD83C\uDF6E','\uD83C\uDF6D','\uD83C\uDF6C','\uD83C\uDF6B','\uD83C\uDF7F','\uD83C\uDF69','\uD83C\uDF6A','\u2615','\uD83C\uDF75','\uD83E\uDD64','\uD83C\uDF76','\uD83C\uDF7A','\uD83C\uDF7B','\uD83E\uDD42','\uD83C\uDF77','\uD83E\uDD43','\uD83C\uDF78','\uD83C\uDF79','\uD83E\uDDC3','\uD83E\uDD5B'] },
  { name: 'Activities', icon: '\u26BD', emojis: ['\u26BD','\uD83C\uDFC0','\uD83C\uDFC8','\u26BE','\uD83E\uDD4E','\uD83C\uDFBE','\uD83C\uDFD0','\uD83C\uDFC9','\uD83E\uDD4F','\uD83C\uDFB1','\uD83C\uDFD3','\uD83C\uDFF8','\uD83C\uDFD2','\uD83E\uDD4D','\uD83C\uDFAF','\u26F3','\uD83E\uDD4A','\uD83E\uDD4B','\u26F8\uFE0F','\uD83C\uDFA3','\uD83E\uDD3F','\uD83C\uDFC7','\u26F7\uFE0F','\uD83C\uDFC2','\uD83C\uDFCB\uFE0F','\uD83E\uDD3C','\uD83E\uDD38','\u26F9\uFE0F','\uD83E\uDD3A','\uD83E\uDD3E','\uD83C\uDFCC\uFE0F','\uD83C\uDFC4','\uD83C\uDFCA','\uD83D\uDEB4','\uD83D\uDEB5','\uD83C\uDFA0','\uD83C\uDFA1','\uD83C\uDFA2','\uD83C\uDFAA','\uD83C\uDFAD','\uD83C\uDFA8','\uD83C\uDFAE','\uD83D\uDD79\uFE0F','\uD83C\uDFB0','\uD83C\uDFB2','\uD83E\uDDE9','\uD83C\uDFAF','\uD83C\uDFB3','\uD83C\uDFB5','\uD83C\uDFB6','\uD83C\uDFA4','\uD83C\uDFB9','\uD83E\uDD41','\uD83C\uDFB7','\uD83C\uDFBA','\uD83C\uDFB8','\uD83C\uDFBB','\uD83C\uDFAC','\uD83C\uDFAF'] },
  { name: 'Objects', icon: '\uD83D\uDCA1', emojis: ['\uD83D\uDCF1','\uD83D\uDCBB','\u2328\uFE0F','\uD83D\uDDA5\uFE0F','\uD83D\uDCBE','\uD83D\uDCBF','\uD83D\uDCC0','\uD83C\uDFA5','\uD83D\uDCF7','\uD83D\uDCF9','\uD83D\uDCFA','\uD83D\uDCFB','\uD83D\uDD14','\uD83C\uDFB5','\uD83C\uDFB6','\uD83C\uDFA4','\uD83D\uDD0B','\uD83D\uDD0C','\uD83D\uDCA1','\uD83D\uDD26','\uD83D\uDCB0','\uD83D\uDCB3','\uD83D\uDC8E','\uD83D\uDD27','\uD83D\uDD28','\u2699\uFE0F','\uD83D\uDD17','\uD83D\uDCCE','\u2702\uFE0F','\uD83D\uDCDD','\u270F\uFE0F','\uD83D\uDD12','\uD83D\uDD13','\uD83D\uDEA8','\uD83D\uDD25','\uD83D\uDCA3','\uD83D\uDCA5','\uD83D\uDCAF','\uD83D\uDC4B','\u2B50','\uD83C\uDF1F','\u2728','\uD83C\uDF88','\uD83C\uDF89','\uD83C\uDF8A','\uD83C\uDF8B','\uD83C\uDF8E','\uD83C\uDF8F','\uD83C\uDF90','\uD83C\uDF80','\uD83C\uDF81','\uD83C\uDF96\uFE0F','\uD83C\uDFC6','\uD83C\uDFC5','\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49'] },
  { name: 'Symbols', icon: '\u2764\uFE0F', emojis: ['\u2764\uFE0F','\uD83D\uDC9B','\uD83D\uDC9A','\uD83D\uDC99','\uD83D\uDC9C','\uD83D\uDDA4','\u2757','\u2753','\u203C\uFE0F','\u2049\uFE0F','\uD83D\uDCAF','\uD83D\uDD1E','\uD83D\uDEAB','\u274C','\u2B55','\uD83D\uDCA2','\u267B\uFE0F','\u2705','\uD83D\uDFE2','\uD83D\uDFE1','\uD83D\uDFE0','\uD83D\uDD34','\uD83D\uDFE3','\uD83D\uDFE4','\u26AA','\u26AB','\uD83D\uDFE5','\uD83D\uDFE7','\uD83D\uDFE8','\uD83D\uDFE9','\uD83D\uDFE6','\uD83D\uDFEA','\uD83D\uDFEB','\u2B1C','\u2B1B','\u25FC\uFE0F','\u25FB\uFE0F','\u25FE','\u25FD','\u2934\uFE0F','\u2935\uFE0F','\u27A1\uFE0F','\u2B05\uFE0F','\u2B06\uFE0F','\u2B07\uFE0F','\u2196\uFE0F','\u2197\uFE0F','\u2198\uFE0F','\u2199\uFE0F','\uD83D\uDD04','\u267E\uFE0F','\uD83C\uDD99','\uD83C\uDD95','\uD83C\uDD97','\uD83C\uDD92','\uD83C\uDD98'] },
];

function EmojiPicker({ onSelect, onClose }) {
  var [activeCategory, setActiveCategory] = useState(0);
  var [searchQuery, setSearchQuery] = useState('');
  var containerRef = useRef(null);
  var isMobile = useIsMobile();

  useEffect(function() {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        onClose();
      }
    }
    function handleEsc(e) {
      if (e.key === 'Escape') onClose();
    }
    var t = setTimeout(function() {
      document.addEventListener('mousedown', handleClickOutside);
    }, 50);
    document.addEventListener('keydown', handleEsc);
    return function() {
      clearTimeout(t);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [onClose]);

  var displayEmojis = EMOJI_CATEGORIES[activeCategory].emojis;
  if (searchQuery.trim()) {
    // Flatten all emojis for search (search by category name)
    var q = searchQuery.toLowerCase();
    displayEmojis = [];
    EMOJI_CATEGORIES.forEach(function(cat) {
      if (cat.name.toLowerCase().includes(q)) {
        displayEmojis = displayEmojis.concat(cat.emojis);
      }
    });
    if (displayEmojis.length === 0) {
      // Show all emojis as fallback during search
      EMOJI_CATEGORIES.forEach(function(cat) {
        displayEmojis = displayEmojis.concat(cat.emojis);
      });
    }
  }

  return React.createElement('div', {
    ref: containerRef,
    style: {
      position: 'absolute', bottom: '100%',
      right: isMobile ? '0' : '16px',
      left: isMobile ? '0' : 'auto',
      marginBottom: '8px',
      width: isMobile ? 'auto' : '352px',
      height: '380px', background: '#252528',
      borderRadius: '8px', display: 'flex', flexDirection: 'column',
      overflow: 'hidden', boxShadow: '0 8px 16px rgba(0,0,0,0.4)',
      zIndex: 100
    }
  },
    // Category tabs
    React.createElement('div', {
      style: {
        display: 'flex', borderBottom: '1px solid #18181b',
        padding: '0 4px', flexShrink: 0
      }
    },
      EMOJI_CATEGORIES.map(function(cat, i) {
        return React.createElement('div', {
          key: i,
          style: {
            flex: 1, padding: '8px 0', textAlign: 'center',
            cursor: 'pointer', fontSize: '18px',
            borderBottom: i === activeCategory ? '2px solid #f0b232' : '2px solid transparent',
            opacity: i === activeCategory ? 1 : 0.5,
            transition: 'opacity 0.15s'
          },
          onClick: function() { setActiveCategory(i); setSearchQuery(''); },
          title: cat.name
        }, cat.icon);
      })
    ),
    // Emoji grid
    React.createElement('div', {
      style: {
        flex: 1, overflowY: 'auto', padding: '8px',
        display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)',
        gap: '2px', alignContent: 'start',
        WebkitOverflowScrolling: 'touch'
      }
    },
      displayEmojis.map(function(emoji, i) {
        return React.createElement('div', {
          key: i,
          style: {
            width: '36px', height: '36px', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', borderRadius: '4px',
            fontSize: '22px', transition: 'background 0.1s'
          },
          onClick: function() { onSelect(emoji); },
          onMouseEnter: function(e) { e.currentTarget.style.background = '#393c43'; },
          onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
        }, emoji);
      })
    )
  );
}

// ===================== CHAT AREA =====================
function VideoGrid({ voiceManager }) {
  var videoContainerRef = useRef(null);
  var [videoCount, setVideoCount] = useState(0);
  var [expanded, setExpanded] = useState(false);
  var [focusedKey, setFocusedKey] = useState(null);
  var mountedRef = useRef(true);

  useEffect(function() {
    mountedRef.current = true;

    function createVideoTile(stream, labelText, isMuted, tileKey, totalCount) {
      var vid = document.createElement('video');
      vid.autoplay = true;
      vid.playsInline = true;
      vid.muted = !!isMuted;
      vid.srcObject = stream;
      vid.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:8px;background:#1a1a1d;display:block;';

      // Calculate tile sizing based on grid
      var maxW = totalCount <= 1 ? '100%' : totalCount <= 4 ? '49%' : '32%';
      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:relative;flex:1 1 ' + maxW + ';max-width:' + maxW + ';min-width:140px;aspect-ratio:16/9;background:#1a1a1d;border-radius:8px;overflow:hidden;cursor:pointer;border:2px solid transparent;transition:border-color 0.15s;';
      wrapper.setAttribute('data-tile-key', tileKey);

      var label = document.createElement('div');
      label.textContent = labelText;
      label.style.cssText = 'position:absolute;bottom:6px;left:8px;color:#e8e6e3;font-size:12px;background:rgba(0,0,0,0.7);padding:3px 8px;border-radius:4px;font-weight:500;pointer-events:none;z-index:2;';

      // Fullscreen button on hover
      var fsBtn = document.createElement('div');
      fsBtn.textContent = '\u26F6';
      fsBtn.style.cssText = 'position:absolute;top:6px;right:8px;color:#e8e6e3;font-size:16px;background:rgba(0,0,0,0.7);padding:2px 6px;border-radius:4px;cursor:pointer;opacity:0;transition:opacity 0.15s;z-index:2;';
      wrapper.onmouseenter = function() { fsBtn.style.opacity = '1'; wrapper.style.borderColor = '#f0b232'; };
      wrapper.onmouseleave = function() { fsBtn.style.opacity = '0'; wrapper.style.borderColor = 'transparent'; };

      fsBtn.onclick = function(e) {
        e.stopPropagation();
        if (vid.requestFullscreen) vid.requestFullscreen();
        else if (vid.webkitRequestFullscreen) vid.webkitRequestFullscreen();
      };

      wrapper.appendChild(vid);
      wrapper.appendChild(label);
      wrapper.appendChild(fsBtn);
      return wrapper;
    }

    // Track existing tile keys to avoid full rebuilds that cause flickering
    var currentTileKeys = [];

    function updateVideos() {
      if (!mountedRef.current || !videoContainerRef.current) return;
      var container = videoContainerRef.current;

      // Collect all video tiles first to know total count
      var tiles = [];

      if (voiceManager.cameraStream) {
        tiles.push({ stream: voiceManager.cameraStream, label: 'You (Camera)', muted: true, key: 'local-camera' });
      }
      if (voiceManager.screenStream) {
        tiles.push({ stream: voiceManager.screenStream, label: 'You (Screen)', muted: true, key: 'local-screen' });
      }
      for (var entry of voiceManager.remoteVideoStreams) {
        var streamKey = entry[0];
        var info = entry[1];
        var peerId = info.peerId || streamKey;
        var peerName = voiceManager.getPeerName(peerId);
        var isScreen = info.track && info.track.label && info.track.label.toLowerCase().indexOf('screen') !== -1;
        var labelText = peerName + (isScreen ? ' (Screen)' : ' (Camera)');
        tiles.push({ stream: info.stream, label: labelText, muted: false, key: streamKey });
      }

      var newKeys = tiles.map(function(t) { return t.key; });
      var count = tiles.length;

      // Only do a full rebuild if the set of tile keys changed
      var keysChanged = newKeys.length !== currentTileKeys.length ||
        newKeys.some(function(k, i) { return k !== currentTileKeys[i]; });

      if (keysChanged) {
        while (container.firstChild) { container.removeChild(container.firstChild); }
        for (var i = 0; i < tiles.length; i++) {
          var tile = createVideoTile(tiles[i].stream, tiles[i].label, tiles[i].muted, tiles[i].key, count);
          container.appendChild(tile);
        }
        currentTileKeys = newKeys;
      }

      setVideoCount(count);
    }

    voiceManager.onRemoteVideoChange = updateVideos;
    var interval = setInterval(updateVideos, 2000);
    updateVideos();

    return function() {
      mountedRef.current = false;
      clearInterval(interval);
      if (voiceManager.onRemoteVideoChange === updateVideos) {
        voiceManager.onRemoteVideoChange = null;
      }
    };
  }, [voiceManager]);

  if (videoCount === 0 && !expanded) return null;

  var gridHeight = expanded ? '70vh' : (videoCount <= 2 ? '200px' : '360px');

  return React.createElement('div', {
    style: {
      background: '#111113', borderBottom: '1px solid #252528',
      flexShrink: 0, position: 'relative',
      transition: 'max-height 0.3s ease',
      maxHeight: expanded ? '80vh' : gridHeight,
      overflow: 'hidden'
    }
  },
    // Header bar with expand/collapse toggle
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 12px', background: '#18181b', borderBottom: '1px solid #252528',
        flexShrink: 0
      }
    },
      React.createElement('span', {
        style: { color: '#b5bac1', fontSize: '12px', fontWeight: 600 }
      }, videoCount + ' video stream' + (videoCount !== 1 ? 's' : '')),
      React.createElement('div', {
        style: { display: 'flex', gap: '8px', alignItems: 'center' }
      },
        // Expand/collapse button
        React.createElement('div', {
          style: {
            cursor: 'pointer', color: expanded ? '#f0b232' : '#b5bac1',
            fontSize: '14px', padding: '2px 6px', borderRadius: '4px',
            background: expanded ? 'rgba(240,178,50,0.15)' : 'transparent',
            transition: 'all 0.15s', userSelect: 'none'
          },
          onClick: function() { setExpanded(function(v) { return !v; }); },
          title: expanded ? 'Collapse video' : 'Expand video'
        }, expanded ? '\u25B2 Collapse' : '\u25BC Expand')
      )
    ),
    // Video container
    React.createElement('div', {
      ref: videoContainerRef,
      style: {
        display: 'flex', gap: '6px', flexWrap: 'wrap',
        justifyContent: 'center', alignItems: 'center', alignContent: 'center',
        padding: '6px',
        height: expanded ? 'calc(80vh - 32px)' : 'calc(' + gridHeight + ' - 32px)',
        overflow: 'auto', transition: 'height 0.3s ease'
      }
    })
  );
}

// ===================== VIDEO CALL VIEW =====================
function VideoCallView({ onLeave }) {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var videoContainerRef = useRef(null);
  var _vc = useState(0); var videoCount = _vc[0]; var setVideoCount = _vc[1];
  var _sc = useState(false); var showChat = _sc[0]; var setShowChat = _sc[1];
  var _cm = useState([]); var chatMessages = _cm[0]; var setChatMessages = _cm[1];
  var _ci = useState(''); var chatInput = _ci[0]; var setChatInput = _ci[1];
  var _co = useState(false); var isCameraOn = _co[0]; var setIsCameraOn = _co[1];
  var _ss = useState(false); var isScreenSharing = _ss[0]; var setIsScreenSharing = _ss[1];
  var mountedRef = useRef(true);
  var vm = ctx.voiceManager;
  var channel = ctx.currentChannel;
  var room = ctx.currentRoom;

  // Auto-start camera on mount
  useEffect(function() {
    if (vm && !vm.isCameraOn) {
      vm.startCamera().then(function() {
        if (mountedRef.current) setIsCameraOn(true);
      }).catch(function() {});
    }
    return function() { mountedRef.current = false; };
  }, []);

  // Camera/screen state sync
  useEffect(function() {
    if (!vm) return;
    var prevCamCb = vm.onCameraChange;
    var prevScreenCb = vm.onScreenShareChange;
    vm.onCameraChange = function(on) {
      setIsCameraOn(on);
      if (prevCamCb) prevCamCb(on);
    };
    vm.onScreenShareChange = function(on) {
      setIsScreenSharing(on);
      if (prevScreenCb) prevScreenCb(on);
    };
    return function() {
      if (vm.onCameraChange) vm.onCameraChange = prevCamCb || null;
      if (vm.onScreenShareChange) vm.onScreenShareChange = prevScreenCb || null;
    };
  }, [vm]);

  // Build video grid via DOM
  useEffect(function() {
    mountedRef.current = true;

    // Track tile keys to avoid unnecessary full rebuilds that cause flicker
    var currentTileKeys = [];

    function buildTiles() {
      var tiles = [];
      if (vm && vm.cameraStream) {
        tiles.push({ stream: vm.cameraStream, label: 'You', muted: true, key: 'local-cam' });
      }
      if (vm && vm.screenStream) {
        tiles.push({ stream: vm.screenStream, label: 'You (Screen)', muted: true, key: 'local-screen' });
      }
      if (vm && vm.remoteVideoStreams) {
        for (var entry of vm.remoteVideoStreams) {
          var info = entry[1];
          var peerId = info.peerId || entry[0];
          var peerName = vm.getPeerName ? vm.getPeerName(peerId) : 'Peer';
          tiles.push({ stream: info.stream, label: peerName, muted: false, key: entry[0] });
        }
      }
      return tiles;
    }

    function renderFullGrid(container, tiles) {
      while (container.firstChild) { container.removeChild(container.firstChild); }
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        var vid = document.createElement('video');
        vid.autoplay = true;
        vid.playsInline = true;
        vid.muted = !!t.muted;
        vid.srcObject = t.stream;
        vid.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';

        var wrapper = document.createElement('div');
        wrapper.style.cssText = 'position:relative;background:#1a1a1d;border-radius:12px;overflow:hidden;aspect-ratio:16/9;min-height:120px;';
        wrapper.setAttribute('data-tile-key', t.key);

        var label = document.createElement('div');
        label.textContent = t.label;
        label.style.cssText = 'position:absolute;bottom:8px;left:10px;color:#fff;font-size:13px;font-weight:600;background:rgba(0,0,0,0.6);padding:3px 10px;border-radius:6px;z-index:2;';

        if (t.key === 'local-cam' && ctx.isMuted) {
          var muteIcon = document.createElement('div');
          muteIcon.textContent = '\uD83D\uDD07';
          muteIcon.style.cssText = 'position:absolute;bottom:8px;right:10px;font-size:16px;background:rgba(237,66,69,0.8);padding:2px 6px;border-radius:6px;z-index:2;';
          wrapper.appendChild(muteIcon);
        }

        wrapper.appendChild(vid);
        wrapper.appendChild(label);
        container.appendChild(wrapper);
      }

      // Add placeholder tiles for voice users without video
      var voiceUsersInChannel = ctx.voiceUsers.filter(function(v) { return v.channelId === ctx.currentVoiceChannel; });
      var currentUserId = ctx.user ? ctx.user.id : null;
      for (var vi = 0; vi < voiceUsersInChannel.length; vi++) {
        var vu = voiceUsersInChannel[vi];
        var vuId = vu.userId;
        var hasVideo = false;
        for (var ti = 0; ti < tiles.length; ti++) {
          var tKey = tiles[ti].key;
          if (tKey.indexOf(vuId) !== -1 || (tKey === 'local-cam' && vuId === currentUserId)) {
            hasVideo = true;
            break;
          }
        }
        if (hasVideo) continue;

        var placeholder = document.createElement('div');
        placeholder.style.cssText = 'position:relative;background:#2b2d31;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-direction:column;aspect-ratio:16/9;min-height:120px;';

        var avatar = document.createElement('div');
        avatar.style.cssText = 'width:64px;height:64px;border-radius:50%;background:' + (vu.color || '#f0b232') + ';display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;font-weight:700;';
        avatar.textContent = (vu.userName || '?')[0].toUpperCase();

        var nameLabel = document.createElement('div');
        nameLabel.textContent = vu.userName || 'User';
        nameLabel.style.cssText = 'color:#dcddde;font-size:14px;font-weight:600;margin-top:8px;';

        placeholder.appendChild(avatar);
        placeholder.appendChild(nameLabel);
        container.appendChild(placeholder);
      }

      var totalRendered = container.children.length;
      var gridCols = totalRendered <= 1 ? 1 : totalRendered <= 4 ? 2 : totalRendered <= 9 ? 3 : 4;
      container.style.gridTemplateColumns = 'repeat(' + gridCols + ', 1fr)';
    }

    function updateVideos() {
      if (!mountedRef.current || !videoContainerRef.current) return;
      var container = videoContainerRef.current;
      var tiles = buildTiles();
      var newKeys = tiles.map(function(t) { return t.key; });

      // Only rebuild DOM if the set of tile keys changed
      var keysChanged = newKeys.length !== currentTileKeys.length ||
        newKeys.some(function(k, i) { return k !== currentTileKeys[i]; });

      if (keysChanged) {
        renderFullGrid(container, tiles);
        currentTileKeys = newKeys;
      } else {
        // Just update stream sources if needed — no DOM rebuild
        var children = container.children;
        for (var j = 0; j < tiles.length && j < children.length; j++) {
          var vid = children[j].querySelector('video');
          if (vid && vid.srcObject !== tiles[j].stream) {
            vid.srcObject = tiles[j].stream;
          }
        }
      }

      setVideoCount(container.children.length);
    }

    if (vm) vm.onRemoteVideoChange = updateVideos;
    var interval = setInterval(updateVideos, 2000);
    updateVideos();

    return function() {
      mountedRef.current = false;
      clearInterval(interval);
      if (vm && vm.onRemoteVideoChange === updateVideos) {
        vm.onRemoteVideoChange = null;
      }
    };
  }, [vm, ctx.voiceUsers, ctx.currentVoiceChannel, ctx.isMuted]);

  function toggleMic() { if (vm) vm.toggleMute(); }
  function toggleCamera() {
    if (!vm) return;
    if (vm.isCameraOn) { vm.stopCamera(); }
    else { vm.startCamera().catch(function() {}); }
  }
  function toggleScreenShare() {
    if (!vm) return;
    if (vm.isScreenSharing) { vm.stopScreenShare(); }
    else { vm.startScreenShare().catch(function() {}); }
  }
  function handleLeave() {
    if (vm) { vm.stopCamera(); vm.stopScreenShare(); vm.leave(); }
    if (onLeave) onLeave();
  }

  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column',
      background: '#111113', position: 'relative', overflow: 'hidden'
    }
  },
    // Header
    React.createElement('div', {
      style: {
        height: '48px', minHeight: '48px', display: 'flex', alignItems: 'center',
        padding: '0 16px', background: '#1e1f22', borderBottom: '1px solid #252528',
        gap: '8px'
      }
    },
      React.createElement('span', { style: { fontSize: '18px' } }, '\uD83D\uDCF9'),
      React.createElement('span', {
        style: { fontWeight: 700, fontSize: '16px', color: '#dcddde' }
      }, channel ? channel.name : 'Video Call'),
      React.createElement('span', {
        style: { color: '#949ba4', fontSize: '13px', marginLeft: '8px' }
      }, videoCount + ' participant' + (videoCount !== 1 ? 's' : ''))
    ),

    // Video grid area
    React.createElement('div', {
      style: { flex: 1, display: 'flex', overflow: 'hidden' }
    },
      // Main video grid
      React.createElement('div', {
        ref: videoContainerRef,
        style: {
          flex: 1, display: 'grid', gap: '6px', padding: '8px',
          alignContent: 'center', overflow: 'auto'
        }
      }),

      // Chat sidebar (toggle)
      showChat ? React.createElement('div', {
        style: {
          width: isMobile ? '100%' : '320px', background: '#1e1f22',
          borderLeft: '1px solid #252528', display: 'flex',
          flexDirection: 'column', flexShrink: 0,
          position: isMobile ? 'absolute' : 'relative',
          top: isMobile ? '48px' : 0, right: 0, bottom: isMobile ? '64px' : 0,
          zIndex: isMobile ? 100 : 1
        }
      },
        React.createElement('div', {
          style: { padding: '12px', borderBottom: '1px solid #252528', fontWeight: 600, color: '#dcddde', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
        },
          'Chat',
          React.createElement('span', {
            style: { cursor: 'pointer', color: '#949ba4', fontSize: '18px' },
            onClick: function() { setShowChat(false); }
          }, '\u2715')
        ),
        React.createElement('div', {
          style: { flex: 1, overflowY: 'auto', padding: '8px' }
        },
          chatMessages.map(function(msg, i) {
            return React.createElement('div', { key: i, style: { marginBottom: '8px' } },
              React.createElement('span', { style: { color: msg.color || '#f0b232', fontWeight: 600, fontSize: '13px' } }, msg.name + ': '),
              React.createElement('span', { style: { color: '#dcddde', fontSize: '13px' } }, msg.text)
            );
          })
        ),
        React.createElement('div', {
          style: { padding: '8px', borderTop: '1px solid #252528' }
        },
          React.createElement('input', {
            type: 'text', value: chatInput,
            onChange: function(e) { setChatInput(e.target.value); },
            onKeyDown: function(e) {
              if (e.key === 'Enter' && chatInput.trim()) {
                setChatMessages(function(prev) {
                  return prev.concat([{ name: ctx.user ? ctx.user.name : 'You', color: ctx.user ? ctx.user.color : '#f0b232', text: chatInput.trim() }]);
                });
                setChatInput('');
              }
            },
            placeholder: 'Send a message...',
            style: {
              width: '100%', background: '#383a40', border: 'none',
              borderRadius: '8px', color: '#dcddde', padding: '10px 12px',
              fontSize: '14px', outline: 'none', fontFamily: 'inherit',
              boxSizing: 'border-box'
            }
          })
        )
      ) : null
    ),

    // Bottom toolbar
    React.createElement('div', {
      style: {
        height: '64px', minHeight: '64px', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: '#1e1f22', borderTop: '1px solid #252528',
        gap: isMobile ? '12px' : '16px', padding: '0 16px',
        flexShrink: 0
      }
    },
      // Microphone
      React.createElement('button', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 16px', borderRadius: '24px',
          background: ctx.isMuted ? '#ed4245' : '#2b2d31',
          border: 'none', color: '#dcddde', cursor: 'pointer',
          fontSize: '14px', fontWeight: 600, fontFamily: 'inherit',
          transition: 'background 0.15s', minHeight: '44px'
        },
        onClick: toggleMic,
        title: ctx.isMuted ? 'Unmute' : 'Mute'
      },
        React.createElement('span', { style: { fontSize: '16px' } }, ctx.isMuted ? '\uD83D\uDD07' : '\uD83C\uDF99\uFE0F'),
        isMobile ? null : (ctx.isMuted ? 'Unmute' : 'Mute')
      ),

      // Camera
      React.createElement('button', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 16px', borderRadius: '24px',
          background: isCameraOn ? '#f0b232' : '#2b2d31',
          border: 'none', color: isCameraOn ? '#1c1c1e' : '#dcddde',
          cursor: 'pointer', fontSize: '14px', fontWeight: 600,
          fontFamily: 'inherit', transition: 'background 0.15s',
          minHeight: '44px'
        },
        onClick: toggleCamera,
        title: isCameraOn ? 'Turn off camera' : 'Turn on camera'
      },
        React.createElement('span', { style: { fontSize: '16px' } }, '\uD83D\uDCF9'),
        isMobile ? null : (isCameraOn ? 'Camera On' : 'Camera Off')
      ),

      // Screen share
      React.createElement('button', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 16px', borderRadius: '24px',
          background: isScreenSharing ? '#f0b232' : '#2b2d31',
          border: 'none', color: isScreenSharing ? '#1c1c1e' : '#dcddde',
          cursor: 'pointer', fontSize: '14px', fontWeight: 600,
          fontFamily: 'inherit', transition: 'background 0.15s',
          minHeight: '44px'
        },
        onClick: toggleScreenShare,
        title: isScreenSharing ? 'Stop sharing' : 'Share screen'
      },
        React.createElement('span', { style: { fontSize: '16px' } }, '\uD83D\uDDA5\uFE0F'),
        isMobile ? null : (isScreenSharing ? 'Stop Share' : 'Share Screen')
      ),

      // Chat toggle
      React.createElement('button', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 16px', borderRadius: '24px',
          background: showChat ? '#5865f2' : '#2b2d31',
          border: 'none', color: '#dcddde', cursor: 'pointer',
          fontSize: '14px', fontWeight: 600, fontFamily: 'inherit',
          transition: 'background 0.15s', minHeight: '44px'
        },
        onClick: function() { setShowChat(function(v) { return !v; }); }
      },
        React.createElement('span', { style: { fontSize: '16px' } }, '\uD83D\uDCAC'),
        isMobile ? null : 'Chat'
      ),

      // Leave
      React.createElement('button', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 16px', borderRadius: '24px',
          background: '#ed4245', border: 'none', color: '#fff',
          cursor: 'pointer', fontSize: '14px', fontWeight: 600,
          fontFamily: 'inherit', transition: 'background 0.15s',
          minHeight: '44px'
        },
        onClick: handleLeave,
        title: 'Leave call'
      },
        React.createElement('span', { style: { fontSize: '16px' } }, '\uD83D\uDEAA'),
        isMobile ? null : 'Leave'
      )
    )
  );
}

// Reaction emoji whitelist: name -> unicode
var REACTION_EMOJI_MAP = {
  thumbsup: '\uD83D\uDC4D',
  thumbsdown: '\uD83D\uDC4E',
  heart: '\u2764\uFE0F',
  fire: '\uD83D\uDD25',
  laugh: '\uD83D\uDE02',
  cry: '\uD83D\uDE22',
  angry: '\uD83D\uDE21',
  clap: '\uD83D\uDC4F',
  '100': '\uD83D\uDCAF',
  skull: '\uD83D\uDC80',
  eyes: '\uD83D\uDC40',
  thinking: '\uD83E\uDD14',
  rocket: '\uD83D\uDE80',
  check: '\u2705',
  x: '\u274C'
};
var REACTION_EMOJI_LIST = Object.keys(REACTION_EMOJI_MAP);

function ChatArea({ onToggleChannels }) {
  var ctx = useSocket();
  var channel = ctx.currentChannel;
  var room = ctx.currentRoom;
  var isMobile = useIsMobile();
  var [inputValue, setInputValue] = useState('');
  var [showGifPicker, setShowGifPicker] = useState(false);
  var [showEmojiPicker, setShowEmojiPicker] = useState(false);
  var handleGifClose = useCallback(function() { setShowGifPicker(false); }, []);
  var [showMembers, setShowMembers] = useState(false);
  var messagesEndRef = useRef(null);
  var messagesContainerRef = useRef(null);
  var typingThrottle = useRef(0);
  var textareaRef = useRef(null);
  var isMod = ctx.user && ctx.user.isMod;
  var canPin = (isMod || (ctx.user && room && room.ownerId === ctx.user.id));
  var [showPinned, setShowPinned] = useState(false);
  var [userMenu, setUserMenu] = useState(null); // { username, tag, color, x, y }
  var [showSearch, setShowSearch] = useState(false);
  var [searchTerm, setSearchTerm] = useState('');
  var searchInputRef = useRef(null);
  var [replyTo, setReplyTo] = useState(null); // { id, authorName, content }
  var [reactionPickerMsgId, setReactionPickerMsgId] = useState(null);

  function closeSearch() {
    setShowSearch(false);
    setSearchTerm('');
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Escape') {
      closeSearch();
    }
  }

  useEffect(function() {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  // Reset search and reply when channel changes
  useEffect(function() {
    closeSearch();
    setReplyTo(null);
    setReactionPickerMsgId(null);
  }, [ctx.currentChannelId]);

  // Close reaction picker on click outside
  useEffect(function() {
    if (!reactionPickerMsgId) return;
    function handleDocClick() { setReactionPickerMsgId(null); }
    document.addEventListener('click', handleDocClick);
    return function() { document.removeEventListener('click', handleDocClick); };
  }, [reactionPickerMsgId]);

  function openUserMenu(e, username, tag, color) {
    e.stopPropagation();
    setUserMenu({ username: username, tag: tag, color: color, x: e.clientX, y: e.clientY });
  }

  function handleDeleteMessage(messageId) {
    if (!ctx.socket || !room || !channel) return;
    ctx.socket.emit('mod_delete_message', {
      roomCode: room.code,
      channelId: channel.id,
      messageId: messageId
    });
  }

  function scrollToBottom(force) {
    var container = messagesContainerRef.current;
    if (!container) return;
    if (force) {
      container.scrollTop = container.scrollHeight;
      return;
    }
    var threshold = 150;
    var isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    if (isNearBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }

  useEffect(function() {
    var t = setTimeout(function() { scrollToBottom(false); }, 50);
    return function() { clearTimeout(t); };
  }, [ctx.messages]);

  useEffect(function() {
    var t = setTimeout(function() { scrollToBottom(true); }, 100);
    return function() { clearTimeout(t); };
  }, [ctx.currentChannelId]);

  // Close pickers when channel changes to avoid stale picker state
  useEffect(function() {
    setShowGifPicker(false);
    setShowEmojiPicker(false);
  }, [ctx.currentChannelId]);

  function sendMessage(content) {
    if (!content || !content.trim() || !ctx.socket || !room || !channel) return;
    if (content.length > 2000) return;
    var trimmed = content.trim();
    var replyId = replyTo ? replyTo.id : null;
    // If room is encrypted and we have the key, encrypt before sending
    if (room.encrypted && typeof BossCordCrypto !== 'undefined') {
      var secret = BossCordCrypto.getRoomSecret(room.code);
      if (secret) {
        BossCordCrypto.encryptRoomMessage(trimmed, secret, room.code).then(function(encrypted) {
          var emitData = {
            roomCode: room.code, channelId: channel.id,
            content: JSON.stringify({ e2e: true, c: encrypted.ciphertext, n: encrypted.nonce })
          };
          if (replyId) emitData.replyTo = replyId;
          ctx.socket.emit('send_message', emitData);
        }).catch(function(err) {
          console.error('[ChatArea] Encryption failed:', err);
        });
        setReplyTo(null);
        return;
      }
    }
    var emitData = {
      roomCode: room.code, channelId: channel.id, content: trimmed
    };
    if (replyId) emitData.replyTo = replyId;
    ctx.socket.emit('send_message', emitData);
    setReplyTo(null);
  }

  function handleSend() {
    if (!inputValue.trim()) return;
    sendMessage(inputValue);
    setInputValue('');
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
    }
    setTimeout(function() { scrollToBottom(true); }, 100);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInputChange(e) {
    setInputValue(e.target.value.replace(/[^a-zA-Z0-9 _\-!?,.'":;\n@#&()\/<>+=$]/g, ''));
    if (textareaRef.current) {
      textareaRef.current.style.height = '44px';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px';
    }
    if (ctx.socket && room && channel) {
      var now = Date.now();
      if (now - typingThrottle.current > 2000) {
        typingThrottle.current = now;
        ctx.socket.emit('typing', { roomCode: room.code, channelId: channel.id });
      }
    }
  }

  function handleGifSelect(gifUrl) {
    sendMessage(gifUrl);
    setTimeout(function() { scrollToBottom(true); }, 100);
  }

  function handleReact(messageId, emoji) {
    if (!ctx.socket || !room || !channel) return;
    ctx.socket.emit('message_react', {
      roomCode: room.code,
      channelId: channel.id,
      messageId: messageId,
      emoji: emoji
    });
    setReactionPickerMsgId(null);
  }

  function handleReply(msg) {
    var preview = (msg.content || '').slice(0, 100);
    setReplyTo({ id: msg.id, authorName: msg.authorName || 'Unknown', content: preview });
    if (textareaRef.current) textareaRef.current.focus();
  }

  function scrollToMessage(messageId) {
    var container = messagesContainerRef.current;
    if (!container) return;
    var el = container.querySelector('[data-msg-id="' + messageId + '"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.background = 'rgba(240,178,50,0.15)';
      setTimeout(function() { el.style.background = ''; }, 2000);
    }
  }

  function groupMessages(msgs) {
    var groups = [];
    for (var i = 0; i < msgs.length; i++) {
      var msg = msgs[i];
      var prevGroup = groups.length > 0 ? groups[groups.length - 1] : null;
      var sameAuthor = prevGroup && prevGroup.authorId === msg.authorId;
      var withinTime = prevGroup && msg.timestamp && prevGroup.lastTimestamp &&
        (new Date(msg.timestamp).getTime() - new Date(prevGroup.lastTimestamp).getTime()) < 7 * 60 * 1000;
      var hasReply = msg.replyTo && msg.replyTo.id;
      if (sameAuthor && withinTime && !hasReply) {
        prevGroup.messages.push(msg);
        prevGroup.lastTimestamp = msg.timestamp;
      } else {
        groups.push({
          authorId: msg.authorId,
          authorName: msg.authorName,
          authorColor: msg.authorColor,
          authorAvatar: msg.authorAvatar,
          authorTag: msg.authorTag,
          isMod: msg.isMod || false,
          firstTimestamp: msg.timestamp,
          lastTimestamp: msg.timestamp,
          messages: [msg]
        });
      }
    }
    return groups;
  }

  if (!channel || !room) {
    return React.createElement('div', {
      style: {
        flex: 1, background: '#1c1c1e', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        color: '#949ba4', fontSize: '16px'
      }
    }, 'Select a channel to start chatting');
  }

  var charCount = inputValue.length;
  var charWarning = charCount > 1800;
  var charDanger = charCount > 1950;
  // Filter messages by search term if active
  var displayMessages = ctx.messages;
  if (showSearch && searchTerm) {
    var searchLower = searchTerm.toLowerCase();
    displayMessages = ctx.messages.filter(function(msg) {
      return msg.content && msg.content.toLowerCase().indexOf(searchLower) !== -1;
    });
  }
  var groups = groupMessages(displayMessages);
  var activeSearchTerm = (showSearch && searchTerm) ? searchTerm : null;
  var members = room.members || [];
  var typingDisplay = ctx.typingUsers.filter(function(t) {
    return !ctx.user || t.userId !== ctx.user.id;
  });

  return React.createElement('div', {
    style: { flex: 1, display: 'flex', overflow: 'hidden' }
  },
    // Main chat column
    React.createElement('div', {
      style: { flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e', minWidth: 0 }
    },
      // Header
      React.createElement('div', {
        style: {
          height: '48px', padding: '0 16px', display: 'flex',
          alignItems: 'center', borderBottom: '2px solid #18181b',
          flexShrink: 0, gap: '8px'
        }
      },
        isMobile && onToggleChannels ? React.createElement('button', {
          style: {
            background: 'transparent', border: 'none', color: '#b5bac1',
            cursor: 'pointer', fontSize: '20px', padding: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minWidth: '32px', minHeight: '32px'
          },
          onClick: onToggleChannels
        }, '\u2630') : null,
        isMobile && onToggleChannels ? React.createElement('button', {
          style: {
            background: ctx.currentVoiceChannel ? '#57f287' : 'transparent', border: 'none',
            color: ctx.currentVoiceChannel ? '#1c1c1e' : '#949ba4',
            cursor: 'pointer', fontSize: '16px', padding: '4px 6px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minWidth: '32px', minHeight: '32px', borderRadius: '6px',
            gap: '2px'
          },
          onClick: onToggleChannels,
          title: 'Voice Channels'
        },
          '\uD83D\uDD0A',
          ctx.voiceUsers && ctx.voiceUsers.length > 0 ? React.createElement('span', {
            style: { fontSize: '10px', fontWeight: 700 }
          }, ctx.voiceUsers.length) : null
        ) : null,
        React.createElement('span', {
          style: { fontSize: '20px', marginRight: '4px', opacity: 0.4, fontWeight: 300 }
        }, '#'),
        React.createElement('span', {
          style: { fontWeight: 600, fontSize: '15px', flex: 1 }
        }, channel.name),
        React.createElement('div', {
          style: {
            width: '36px', height: '36px', borderRadius: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: showPinned ? '#f0b232' : '#949ba4',
            background: showPinned ? '#393c43' : 'transparent',
            position: 'relative'
          },
          onClick: function() {
            var next = !showPinned;
            setShowPinned(next);
            if (next && ctx.socket && room && channel) {
              ctx.socket.emit('get_pinned_messages', { roomCode: room.code, channelId: channel.id });
            }
          },
          title: 'Pinned Messages'
        },
          React.createElement('svg', {
            width: '20', height: '20', viewBox: '0 0 24 24', fill: 'currentColor'
          },
            React.createElement('path', { d: 'M16.5 2.25a.75.75 0 0 1 .75.75v1.5h.75a2.25 2.25 0 0 1 2.25 2.25v1.5a2.25 2.25 0 0 1-1.5 2.122V13.5a3.75 3.75 0 0 1-2.735 3.613L12.75 18v2.25a.75.75 0 0 1-1.5 0V18l-3.265-.887A3.75 3.75 0 0 1 5.25 13.5v-3.128A2.25 2.25 0 0 1 3.75 8.25v-1.5A2.25 2.25 0 0 1 6 4.5h.75V3A.75.75 0 0 1 7.5 2.25h9ZM18 6.75a.75.75 0 0 0-.75-.75h-10.5a.75.75 0 0 0-.75.75v1.5c0 .414.336.75.75.75h10.5a.75.75 0 0 0 .75-.75v-1.5Zm-1.5 4.5h-9v2.25a2.25 2.25 0 0 0 1.641 2.167L12 16.397l2.859-.73A2.25 2.25 0 0 0 16.5 13.5v-2.25Z' })
          ),
          ctx.pinnedMessages && ctx.pinnedMessages.length > 0 ? React.createElement('div', {
            style: {
              position: 'absolute', top: '4px', right: '4px',
              width: '8px', height: '8px', borderRadius: '50%',
              background: '#f0b232'
            }
          }) : null
        ),
        React.createElement('div', {
          style: {
            width: '36px', height: '36px', borderRadius: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: showSearch ? '#dcddde' : '#949ba4',
            background: showSearch ? '#393c43' : 'transparent'
          },
          onClick: function() {
            var next = !showSearch;
            setShowSearch(next);
            if (!next) setSearchTerm('');
          },
          title: 'Search Messages'
        },
          React.createElement('svg', {
            width: '20', height: '20', viewBox: '0 0 24 24', fill: 'currentColor'
          },
            React.createElement('path', { d: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z' })
          )
        ),
        React.createElement('div', {
          style: {
            width: '36px', height: '36px', borderRadius: '4px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: showMembers ? '#dcddde' : '#949ba4',
            background: showMembers ? '#393c43' : 'transparent'
          },
          onClick: function() { setShowMembers(!showMembers); },
          title: 'Toggle Member List'
        },
          React.createElement('svg', {
            width: '20', height: '20', viewBox: '0 0 24 24', fill: 'currentColor'
          },
            React.createElement('path', { d: 'M14 8.00598C14 10.211 12.206 12.006 10 12.006C7.795 12.006 6 10.211 6 8.00598C6 5.80098 7.795 4.00598 10 4.00598C12.206 4.00598 14 5.80098 14 8.00598ZM2 19.006C2 15.473 5.29 13.006 10 13.006C14.711 13.006 18 15.473 18 19.006V20.006H2V19.006Z' }),
            React.createElement('path', { d: 'M14 8.00598C14 10.211 12.206 12.006 10 12.006C7.795 12.006 6 10.211 6 8.00598C6 5.80098 7.795 4.00598 10 4.00598C12.206 4.00598 14 5.80098 14 8.00598ZM18 17.006V20.006H22V17.006C22 14.796 20.206 13.006 18 13.006C17.545 13.006 17.105 13.082 16.69 13.222C17.509 14.456 18 15.856 18 17.006Z', opacity: 0.6 }),
            React.createElement('path', { d: 'M20 8.00598C20 9.65898 18.657 11.006 17 11.006C15.344 11.006 14 9.65898 14 8.00598C14 6.35298 15.344 5.00598 17 5.00598C18.657 5.00598 20 6.35298 20 8.00598Z', opacity: 0.6 })
          )
        )
      ),

      // Search bar
      showSearch ? React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 16px', background: '#2b2d31',
          borderBottom: '1px solid #252528', flexShrink: 0
        }
      },
        React.createElement('svg', {
          width: '16', height: '16', viewBox: '0 0 24 24', fill: '#949ba4', style: { flexShrink: 0 }
        },
          React.createElement('path', { d: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z' })
        ),
        React.createElement('input', {
          ref: searchInputRef,
          type: 'text',
          value: searchTerm,
          onChange: function(e) { setSearchTerm(e.target.value); },
          onKeyDown: handleSearchKeyDown,
          placeholder: 'Search messages...',
          style: {
            flex: 1, background: '#1e1f22', border: '1px solid #3f4147',
            borderRadius: '4px', padding: '6px 10px', color: '#dcddde',
            fontSize: '14px', outline: 'none', fontFamily: 'inherit'
          }
        }),
        searchTerm ? React.createElement('span', {
          style: { fontSize: '12px', color: '#949ba4', whiteSpace: 'nowrap', flexShrink: 0 }
        }, (function() {
          var count = 0;
          var termLower = searchTerm.toLowerCase();
          for (var si = 0; si < ctx.messages.length; si++) {
            if (ctx.messages[si].content && ctx.messages[si].content.toLowerCase().indexOf(termLower) !== -1) {
              count++;
            }
          }
          return count + ' result' + (count !== 1 ? 's' : '') + ' found';
        })()) : null,
        React.createElement('button', {
          style: {
            background: 'transparent', border: 'none', color: '#949ba4',
            cursor: 'pointer', fontSize: '18px', padding: '2px 6px',
            lineHeight: 1, fontFamily: 'inherit', flexShrink: 0
          },
          onClick: closeSearch,
          title: 'Close search'
        }, '\u2715')
      ) : null,

      // Pinned messages panel
      showPinned ? React.createElement('div', {
        style: {
          background: '#2b2d31', maxHeight: '400px', overflowY: 'auto',
          borderBottom: '1px solid #252528', flexShrink: 0
        }
      },
        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderBottom: '1px solid #3f4147'
          }
        },
          React.createElement('span', {
            style: { fontWeight: 700, fontSize: '14px', color: '#dcddde' }
          }, 'Pinned Messages'),
          React.createElement('button', {
            style: {
              background: 'transparent', border: 'none', color: '#949ba4',
              cursor: 'pointer', fontSize: '18px', padding: '2px 6px',
              lineHeight: 1, fontFamily: 'inherit'
            },
            onClick: function() { setShowPinned(false); }
          }, '\u2715')
        ),
        ctx.pinnedMessages && ctx.pinnedMessages.length > 0
          ? ctx.pinnedMessages.map(function(pin) {
              return React.createElement('div', {
                key: pin.id,
                style: {
                  padding: '10px 16px', borderBottom: '1px solid #3f4147',
                  display: 'flex', alignItems: 'flex-start', gap: '10px'
                }
              },
                React.createElement('div', {
                  style: { flex: 1, minWidth: 0 }
                },
                  React.createElement('div', {
                    style: { display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '2px' }
                  },
                    React.createElement('span', {
                      style: {
                        fontWeight: 600, fontSize: '13px',
                        color: pin.authorColor || '#dcddde'
                      }
                    }, pin.authorName || 'Unknown'),
                    React.createElement('span', {
                      style: { fontSize: '11px', color: '#666' }
                    }, formatTime(pin.timestamp))
                  ),
                  React.createElement('div', {
                    style: {
                      fontSize: '13px', color: '#b5bac1', lineHeight: '1.375',
                      wordWrap: 'break-word', whiteSpace: 'pre-wrap',
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 3,
                      WebkitBoxOrient: 'vertical'
                    }
                  }, renderMarkdown(ctx.censorText(pin.content), null))
                ),
                canPin ? React.createElement('button', {
                  style: {
                    background: 'transparent', border: '1px solid #4f545c',
                    color: '#ed4245', cursor: 'pointer', fontSize: '11px',
                    padding: '3px 8px', borderRadius: '3px', flexShrink: 0,
                    fontFamily: 'inherit', fontWeight: 600, marginTop: '2px',
                    transition: 'background 0.15s'
                  },
                  onClick: function() {
                    if (ctx.socket && room && channel) {
                      ctx.socket.emit('unpin_message', {
                        roomCode: room.code, channelId: channel.id, messageId: pin.id
                      });
                    }
                  },
                  onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(237,66,69,0.15)'; },
                  onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; },
                  title: 'Unpin message'
                }, 'Unpin') : null
              );
            })
          : React.createElement('div', {
              style: {
                padding: '32px 16px', textAlign: 'center', color: '#949ba4',
                fontSize: '14px'
              }
            }, 'No pinned messages in this channel.')
      ) : null,

      // Video grid (shows when camera/screen share is active)
      ctx.currentVoiceChannel && room ? React.createElement(VideoGrid, { voiceManager: ctx.voiceManager }) : null,

      // Messages
      React.createElement('div', {
        ref: messagesContainerRef,
        style: { flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '0', WebkitOverflowScrolling: 'touch' }
      },
        // Welcome banner
        React.createElement('div', {
          style: { padding: '16px 16px 0 16px', marginBottom: '16px' }
        },
          React.createElement('div', {
            style: {
              width: '68px', height: '68px', borderRadius: '50%',
              background: '#f0b232', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: '36px', color: '#fff', marginBottom: '8px', fontWeight: 300
            }
          }, '#'),
          React.createElement('h2', {
            style: { fontSize: isMobile ? '24px' : '32px', fontWeight: 700, marginBottom: '8px' }
          }, 'Welcome to #' + channel.name + '!'),
          React.createElement('p', {
            style: { color: '#949ba4', fontSize: '14px' }
          }, 'This is the start of this channel. Everything is ephemeral.'),
          room && room.encrypted ? React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: '8px',
              marginTop: '8px', padding: '8px 12px',
              background: 'rgba(88,101,242,0.1)', borderRadius: '6px',
              border: '1px solid rgba(88,101,242,0.3)'
            }
          },
            React.createElement('span', { style: { fontSize: '16px' } }, '\uD83D\uDD12'),
            React.createElement('span', {
              style: { color: '#8b9bff', fontSize: '13px' }
            }, 'Messages in this room are end-to-end encrypted. Only members with the full invite code can read them.')
          ) : null
        ),

        // Message groups
        groups.map(function(group, gi) {
          return React.createElement('div', { key: gi, style: { marginTop: gi > 0 ? '17px' : '0' } },
            group.messages.map(function(msg, mi) {
              var isFirst = mi === 0;
              var isGif = isGifUrl(msg.content);
              var msgReactions = msg.reactions || {};
              var reactionKeys = Object.keys(msgReactions);
              var hasReactions = reactionKeys.length > 0;
              var currentUserId = ctx.user ? ctx.user.id : null;

              // Reply quote block
              var replyQuoteEl = null;
              if (msg.replyTo && msg.replyTo.id) {
                var _rc = msg.replyTo.content || '[deleted]';
                if (_rc.length > 100) _rc = _rc.slice(0, 100) + '...';
                replyQuoteEl = React.createElement('div', {
                  style: {
                    borderLeft: '2px solid #949ba4', paddingLeft: '8px', marginBottom: '4px',
                    fontSize: '12px', color: '#949ba4', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '4px',
                    maxWidth: '100%', overflow: 'hidden'
                  },
                  onClick: function() { scrollToMessage(msg.replyTo.id); },
                  title: 'Click to jump to original message'
                },
                  React.createElement('span', {
                    style: { fontWeight: 600, color: '#b5bac1', flexShrink: 0 }
                  }, msg.replyTo.authorName),
                  React.createElement('span', {
                    style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
                  }, _rc)
                );
              }

              // Reaction bar
              var reactionBarEl = null;
              if (hasReactions || msg.id) {
                var _pills = reactionKeys.map(function(ek) {
                  var _users = msgReactions[ek] || [];
                  if (_users.length === 0) return null;
                  var _ur = currentUserId && _users.indexOf(currentUserId) !== -1;
                  return React.createElement('div', {
                    key: ek,
                    style: {
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      padding: '2px 6px', borderRadius: '4px', cursor: 'pointer',
                      background: _ur ? 'rgba(88,101,242,0.3)' : 'rgba(255,255,255,0.06)',
                      border: _ur ? '1px solid rgba(88,101,242,0.6)' : '1px solid transparent',
                      fontSize: '13px', lineHeight: '1', userSelect: 'none',
                      transition: 'background 0.15s'
                    },
                    onClick: function() { handleReact(msg.id, ek); },
                    title: ek + ' (' + _users.length + ')'
                  },
                    React.createElement('span', { style: { fontSize: '14px' } }, REACTION_EMOJI_MAP[ek] || ek),
                    React.createElement('span', {
                      style: { fontSize: '12px', fontWeight: 600, color: _ur ? '#8b9bff' : '#b5bac1' }
                    }, _users.length)
                  );
                }).filter(Boolean);

                var _addBtn = React.createElement('div', {
                  key: '_add',
                  className: 'react-add-btn',
                  style: {
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: '26px', height: '24px', borderRadius: '4px', cursor: 'pointer',
                    background: 'rgba(255,255,255,0.06)', fontSize: '14px', color: '#949ba4',
                    opacity: hasReactions ? 1 : 0, transition: 'opacity 0.15s',
                    position: 'relative', userSelect: 'none', border: '1px solid transparent'
                  },
                  onClick: function(e) {
                    e.stopPropagation();
                    setReactionPickerMsgId(function(prev) { return prev === msg.id ? null : msg.id; });
                  },
                  title: 'Add Reaction'
                },
                  '+',
                  reactionPickerMsgId === msg.id ? React.createElement('div', {
                    style: {
                      position: 'absolute', bottom: '100%', left: '0', marginBottom: '4px',
                      background: '#2b2d31', border: '1px solid #3f4147', borderRadius: '8px',
                      padding: '6px', display: 'flex', flexWrap: 'wrap', gap: '2px',
                      width: '210px', zIndex: 50, boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    },
                    onClick: function(e) { e.stopPropagation(); }
                  },
                    REACTION_EMOJI_LIST.map(function(rk) {
                      return React.createElement('div', {
                        key: rk,
                        style: {
                          width: '32px', height: '32px', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          borderRadius: '4px', cursor: 'pointer', fontSize: '18px',
                          transition: 'background 0.1s'
                        },
                        onClick: function(e) { e.stopPropagation(); handleReact(msg.id, rk); },
                        onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; },
                        onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; },
                        title: rk
                      }, REACTION_EMOJI_MAP[rk]);
                    })
                  ) : null
                );

                if (hasReactions || msg.id) {
                  reactionBarEl = React.createElement('div', {
                    style: {
                      display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px',
                      alignItems: 'center'
                    }
                  }, _pills.concat([_addBtn]));
                }
              }

              // Button position offsets
              var _btnCount = 0;
              if (isMod && msg.id) _btnCount++;
              if (canPin && msg.id) _btnCount++;
              var _replyRight = (_btnCount * 28) + 16;

              if (isFirst) {
                return React.createElement('div', {
                  key: msg.id || (gi + '-' + mi),
                  'data-msg-id': msg.id || '',
                  className: 'msg-row-hover',
                  style: {
                    display: 'flex', padding: '2px 16px 2px 16px',
                    marginTop: '17px', position: 'relative'
                  }
                },
                  group.authorAvatar
                    ? React.createElement('img', {
                        src: group.authorAvatar,
                        style: {
                          width: '40px', height: '40px', borderRadius: '50%',
                          objectFit: 'cover', flexShrink: 0, marginRight: '16px', marginTop: '2px'
                        }
                      })
                    : React.createElement('div', {
                        style: {
                          width: '40px', height: '40px', borderRadius: '50%',
                          background: group.authorColor || '#f0b232',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: '18px', color: '#fff',
                          flexShrink: 0, marginRight: '16px', marginTop: '2px'
                        }
                      }, (group.authorName || '?')[0].toUpperCase()),
                  React.createElement('div', { style: { minWidth: 0, flex: 1 } },
                    replyQuoteEl,
                    React.createElement('div', {
                      style: { display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px', flexWrap: 'wrap' }
                    },
                      React.createElement('span', {
                        style: {
                          fontWeight: 600, fontSize: '15px',
                          color: group.authorColor || '#dcddde',
                          cursor: 'pointer'
                        },
                        onClick: function(e) { openUserMenu(e, group.authorName || 'Anonymous', group.authorTag || '????', group.authorColor || '#dcddde'); }
                      }, group.authorName || 'Anonymous'),
                      group.isMod ? React.createElement('span', {
                        style: {
                          fontSize: '9px', fontWeight: 700, color: '#fff',
                          background: '#e74c3c', borderRadius: '3px',
                          padding: '1px 5px', marginLeft: '4px', letterSpacing: '0.5px',
                          textTransform: 'uppercase', verticalAlign: 'middle'
                        },
                        title: 'Moderator'
                      }, 'MOD') : null,
                      React.createElement('span', {
                        style: { fontSize: '11px', color: '#666', marginLeft: '-4px', fontFamily: 'monospace' }
                      }, '#' + (group.authorTag || '????'))
                    ),
                    isGif ? React.createElement('img', {
                      src: msg.content.trim(),
                      alt: 'GIF',
                      loading: 'lazy',
                      style: {
                        maxWidth: isMobile ? '200px' : '300px', maxHeight: '250px',
                        borderRadius: '4px', display: 'block', marginTop: '2px'
                      },
                      onError: function(e) { e.target.style.display = 'none'; },
                      draggable: false
                    }) : React.createElement('div', {
                      style: { fontSize: '15px', lineHeight: '1.375', wordWrap: 'break-word' }
                    }, renderMarkdown(ctx.censorText(msg.content), activeSearchTerm)),
                    reactionBarEl
                  ),
                  msg.id ? React.createElement('button', {
                    className: 'reply-msg-btn',
                    style: {
                      position: 'absolute', top: '4px', right: _replyRight + 'px',
                      background: 'transparent', border: 'none',
                      color: '#949ba4', cursor: 'pointer', fontSize: '13px',
                      fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                      opacity: 0, transition: 'opacity 0.15s, background 0.15s',
                      fontFamily: 'inherit', lineHeight: 1
                    },
                    title: 'Reply',
                    onClick: function(e) { e.stopPropagation(); handleReply(msg); },
                    onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(88,101,242,0.15)'; },
                    onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
                  }, '\u21A9') : null,
                  canPin && msg.id ? (function() {
                    var isPinned = ctx.pinnedMessages && ctx.pinnedMessages.some(function(p) { return p.id === msg.id; });
                    return React.createElement('button', {
                      className: 'pin-msg-btn',
                      style: {
                        position: 'absolute', top: '4px', right: isMod ? '44px' : '16px',
                        background: 'transparent', border: 'none',
                        color: isPinned ? '#f0b232' : '#949ba4', cursor: 'pointer', fontSize: '14px',
                        fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                        opacity: 0, transition: 'opacity 0.15s, background 0.15s',
                        fontFamily: 'inherit', lineHeight: 1
                      },
                      title: isPinned ? 'Unpin message' : 'Pin message',
                      onClick: function(e) {
                        e.stopPropagation();
                        if (!ctx.socket || !room || !channel) return;
                        if (isPinned) {
                          ctx.socket.emit('unpin_message', { roomCode: room.code, channelId: channel.id, messageId: msg.id });
                        } else {
                          ctx.socket.emit('pin_message', { roomCode: room.code, channelId: channel.id, messageId: msg.id });
                        }
                      },
                      onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(240,178,50,0.15)'; },
                      onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
                    }, isPinned ? '\uD83D\uDCCC' : '\uD83D\uDCCC');
                  })() : null,
                  isMod && msg.id ? React.createElement('button', {
                    className: 'mod-delete-btn',
                    style: {
                      position: 'absolute', top: '4px', right: '16px',
                      background: 'transparent', border: 'none',
                      color: '#ed4245', cursor: 'pointer', fontSize: '14px',
                      fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                      opacity: 0, transition: 'opacity 0.15s, background 0.15s',
                      fontFamily: 'inherit', lineHeight: 1
                    },
                    title: 'Delete message (mod)',
                    onClick: function(e) { e.stopPropagation(); handleDeleteMessage(msg.id); },
                    onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(237,66,69,0.15)'; },
                    onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
                  }, '\u2715') : null
                );
              }
              return React.createElement('div', {
                key: msg.id || (gi + '-' + mi),
                'data-msg-id': msg.id || '',
                className: 'msg-continuation msg-row-hover',
                style: {
                  padding: '2px 16px 2px 72px', position: 'relative'
                }
              },
                replyQuoteEl,
                isGif ? React.createElement('img', {
                  src: msg.content.trim(),
                  alt: 'GIF',
                  loading: 'lazy',
                  style: {
                    maxWidth: isMobile ? '200px' : '300px', maxHeight: '250px',
                    borderRadius: '4px', display: 'block'
                  },
                  onError: function(e) { e.target.style.display = 'none'; },
                  draggable: false
                }) : React.createElement('div', {
                  style: { fontSize: '15px', lineHeight: '1.375', wordWrap: 'break-word' }
                }, renderMarkdown(ctx.censorText(msg.content), activeSearchTerm)),
                reactionBarEl,
                msg.id ? React.createElement('button', {
                  className: 'reply-msg-btn',
                  style: {
                    position: 'absolute', top: '4px', right: _replyRight + 'px',
                    background: 'transparent', border: 'none',
                    color: '#949ba4', cursor: 'pointer', fontSize: '13px',
                    fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                    opacity: 0, transition: 'opacity 0.15s, background 0.15s',
                    fontFamily: 'inherit', lineHeight: 1
                  },
                  title: 'Reply',
                  onClick: function(e) { e.stopPropagation(); handleReply(msg); },
                  onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(88,101,242,0.15)'; },
                  onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
                }, '\u21A9') : null,
                canPin && msg.id ? (function() {
                  var isPinned = ctx.pinnedMessages && ctx.pinnedMessages.some(function(p) { return p.id === msg.id; });
                  return React.createElement('button', {
                    className: 'pin-msg-btn',
                    style: {
                      position: 'absolute', top: '4px', right: isMod ? '44px' : '16px',
                      background: 'transparent', border: 'none',
                      color: isPinned ? '#f0b232' : '#949ba4', cursor: 'pointer', fontSize: '14px',
                      fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                      opacity: 0, transition: 'opacity 0.15s, background 0.15s',
                      fontFamily: 'inherit', lineHeight: 1
                    },
                    title: isPinned ? 'Unpin message' : 'Pin message',
                    onClick: function(e) {
                      e.stopPropagation();
                      if (!ctx.socket || !room || !channel) return;
                      if (isPinned) {
                        ctx.socket.emit('unpin_message', { roomCode: room.code, channelId: channel.id, messageId: msg.id });
                      } else {
                        ctx.socket.emit('pin_message', { roomCode: room.code, channelId: channel.id, messageId: msg.id });
                      }
                    },
                    onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(240,178,50,0.15)'; },
                    onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
                  }, isPinned ? '\uD83D\uDCCC' : '\uD83D\uDCCC');
                })() : null,
                isMod && msg.id ? React.createElement('button', {
                  className: 'mod-delete-btn',
                  style: {
                    position: 'absolute', top: '4px', right: '16px',
                    background: 'transparent', border: 'none',
                    color: '#ed4245', cursor: 'pointer', fontSize: '14px',
                    fontWeight: 700, padding: '2px 6px', borderRadius: '3px',
                    opacity: 0, transition: 'opacity 0.15s, background 0.15s',
                    fontFamily: 'inherit', lineHeight: 1
                  },
                  title: 'Delete message (mod)',
                  onClick: function(e) { e.stopPropagation(); handleDeleteMessage(msg.id); },
                  onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(237,66,69,0.15)'; },
                  onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
                }, '\u2715') : null
              );
            })
          );
        }),

        React.createElement('div', { ref: messagesEndRef, style: { height: '16px' } })
      ),

      // Typing indicator
      typingDisplay.length > 0 ? React.createElement('div', {
        style: {
          padding: '0 16px', height: '24px', display: 'flex',
          alignItems: 'center', fontSize: '13px', color: '#949ba4', flexShrink: 0
        }
      },
        React.createElement('span', null,
          typingDisplay.length === 1 ?
            React.createElement('span', null,
              React.createElement('strong', null, typingDisplay[0].userName),
              ' is typing'
            ) :
          typingDisplay.length === 2 ?
            React.createElement('span', null,
              React.createElement('strong', null, typingDisplay[0].userName),
              ' and ',
              React.createElement('strong', null, typingDisplay[1].userName),
              ' are typing'
            ) :
            React.createElement('span', null, 'Several people are typing')
        ),
        React.createElement('span', {
          style: { display: 'inline-flex', gap: '2px', marginLeft: '4px', alignItems: 'center' }
        },
          React.createElement('span', {
            style: {
              width: '4px', height: '4px', borderRadius: '50%', background: '#949ba4',
              display: 'inline-block', animation: 'dotBounce 1.4s infinite', animationDelay: '0s'
            }
          }),
          React.createElement('span', {
            style: {
              width: '4px', height: '4px', borderRadius: '50%', background: '#949ba4',
              display: 'inline-block', animation: 'dotBounce 1.4s infinite', animationDelay: '0.15s'
            }
          }),
          React.createElement('span', {
            style: {
              width: '4px', height: '4px', borderRadius: '50%', background: '#949ba4',
              display: 'inline-block', animation: 'dotBounce 1.4s infinite', animationDelay: '0.3s'
            }
          })
        )
      ) : React.createElement('div', { style: { height: '24px', flexShrink: 0 } }),

      // Input area
      React.createElement('div', {
        style: {
          padding: isMobile ? '0 8px 12px 8px' : '0 16px 24px 16px',
          flexShrink: 0, position: 'relative'
        }
      },
        showGifPicker ? React.createElement(GifPicker, {
          onSelect: handleGifSelect,
          onClose: handleGifClose
        }) : null,

        showEmojiPicker ? React.createElement(EmojiPicker, {
          onSelect: function(emoji) {
            setInputValue(function(prev) { return prev + emoji; });
          },
          onClose: function() { setShowEmojiPicker(false); }
        }) : null,

        // Reply preview bar
        replyTo ? React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 12px', marginBottom: '4px',
            background: '#2b2d31', borderRadius: '8px 8px 0 0',
            borderLeft: '3px solid #5865f2', fontSize: '13px', color: '#b5bac1'
          }
        },
          React.createElement('span', { style: { flexShrink: 0, color: '#949ba4' } }, 'Replying to'),
          React.createElement('span', {
            style: { fontWeight: 600, color: '#dcddde', flexShrink: 0 }
          }, replyTo.authorName),
          React.createElement('span', {
            style: {
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', color: '#949ba4'
            }
          }, replyTo.content),
          React.createElement('button', {
            style: {
              background: 'transparent', border: 'none', color: '#949ba4',
              cursor: 'pointer', fontSize: '16px', padding: '0 4px',
              lineHeight: 1, fontFamily: 'inherit', flexShrink: 0
            },
            onClick: function() { setReplyTo(null); },
            title: 'Cancel reply'
          }, '\u2715')
        ) : null,

        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'flex-end',
            background: '#383a40', borderRadius: '8px',
            padding: '0', overflow: 'hidden'
          }
        },
          React.createElement('button', {
            style: {
              padding: '10px 12px', background: 'transparent', border: 'none',
              color: showGifPicker ? '#f0b232' : '#b5bac1',
              cursor: 'pointer', fontSize: '14px', fontWeight: 700,
              fontFamily: 'inherit', flexShrink: 0, minHeight: '44px'
            },
            onClick: function() { setShowGifPicker(!showGifPicker); setShowEmojiPicker(false); }
          }, 'GIF'),

          React.createElement('textarea', {
            ref: textareaRef,
            value: inputValue,
            onChange: handleInputChange,
            onKeyDown: handleKeyDown,
            onDrop: blockDrop,
            placeholder: (room && room.encrypted ? '\uD83D\uDD12 ' : '') + 'Message #' + channel.name,
            rows: 1,
            maxLength: 2000,
            style: {
              flex: 1, background: 'transparent', border: 'none',
              color: '#dcddde', fontSize: '15px', padding: '12px 0',
              outline: 'none', fontFamily: 'inherit', resize: 'none',
              lineHeight: '1.375', height: '44px', maxHeight: '200px',
              overflow: 'auto'
            }
          }),

          charWarning ? React.createElement('div', {
            style: {
              padding: '10px 12px', fontSize: '12px', flexShrink: 0,
              color: charDanger ? '#ed4245' : '#fee75c',
              fontWeight: 600
            }
          }, charCount + '/2000') : null,

          React.createElement('button', {
            style: {
              padding: '10px 8px', background: 'transparent', border: 'none',
              color: showEmojiPicker ? '#f0b232' : '#b5bac1',
              cursor: 'pointer', fontSize: '20px',
              fontFamily: 'inherit', flexShrink: 0, minHeight: '44px',
              transition: 'color 0.15s'
            },
            onClick: function() { setShowEmojiPicker(!showEmojiPicker); setShowGifPicker(false); },
            title: 'Emoji'
          }, '\uD83D\uDE42')
        )
      )
    ),

    // Member list (hidden on mobile unless toggled via chat header button)
    showMembers && !isMobile ? React.createElement(MemberList, { members: members, room: room, onUserClick: openUserMenu }) : null,
    showMembers && isMobile ? React.createElement('div', {
      style: {
        position: 'absolute', right: 0, top: 0, bottom: 0,
        zIndex: 180
      }
    }, React.createElement(MemberList, { members: members, room: room, onUserClick: openUserMenu })) : null,

    // User action menu popup
    userMenu ? React.createElement(UserActionMenu, {
      username: userMenu.username,
      tag: userMenu.tag,
      color: userMenu.color,
      position: { x: userMenu.x, y: userMenu.y },
      onClose: function() { setUserMenu(null); }
    }) : null
  );
}

// ===================== MEMBER LIST =====================
function MemberList({ members, room, onUserClick }) {
  var ctx = useSocket();
  if (!members) members = [];
  var ownerId = room ? room.ownerId : null;

  var sorted = members.slice().sort(function(a, b) {
    if (a.id === ownerId && b.id !== ownerId) return -1;
    if (b.id === ownerId && a.id !== ownerId) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  return React.createElement('div', {
    style: {
      width: '240px', minWidth: '240px', background: '#252528',
      borderLeft: '1px solid #18181b', overflowY: 'auto',
      padding: '16px 8px', WebkitOverflowScrolling: 'touch'
    }
  },
    React.createElement('div', {
      style: {
        fontSize: '12px', fontWeight: 700, textTransform: 'uppercase',
        color: '#949ba4', letterSpacing: '0.02em', padding: '0 8px',
        marginBottom: '8px'
      }
    }, 'Members \u2014 ' + members.length),
    sorted.map(function(member) {
      var isOwner = member.id === ownerId;
      return React.createElement('div', {
        key: member.id,
        className: 'member-row',
        style: {
          display: 'flex', alignItems: 'center', padding: '6px 8px',
          borderRadius: '4px', cursor: 'default', gap: '8px',
          minHeight: '44px'
        }
      },
        React.createElement('div', {
          style: {
            width: '32px', height: '32px', borderRadius: '50%',
            background: member.color || '#f0b232',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '14px', color: '#fff', flexShrink: 0,
            position: 'relative', overflow: 'hidden'
          }
        },
          member.avatar
            ? React.createElement('img', {
                src: member.avatar,
                style: { width: '100%', height: '100%', objectFit: 'cover' }
              })
            : (member.name || '?')[0].toUpperCase(),
          isOwner ? React.createElement('div', {
            style: {
              position: 'absolute', bottom: '-2px', right: '-2px',
              fontSize: '10px', lineHeight: '1'
            },
            title: 'Room Owner'
          }, '\uD83D\uDC51') : null
        ),
        React.createElement('span', {
          style: {
            fontSize: '14px', fontWeight: isOwner ? 600 : 400,
            color: member.color || '#dcddde',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            cursor: 'pointer'
          },
          onClick: function(e) {
            if (onUserClick) onUserClick(e, member.name || 'Anonymous', member.tag || '????', member.color || '#dcddde');
          }
        }, member.name || 'Anonymous'),
        member.isMod ? React.createElement('span', {
          style: {
            fontSize: '8px', fontWeight: 700, color: '#fff',
            background: '#e74c3c', borderRadius: '2px',
            padding: '0px 4px', marginLeft: '4px', letterSpacing: '0.5px',
            textTransform: 'uppercase'
          },
          title: 'Moderator'
        }, 'MOD') : null,
        React.createElement('span', {
          style: { fontSize: '10px', color: '#666', fontFamily: 'monospace', marginLeft: '-4px' }
        }, '#' + (member.tag || '????'))
      );
    })
  );
}

// ===================== CHAT LAYOUT =====================
function ChatLayout({ activeTab, onTabChange }) {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var [showRoomList, setShowRoomList] = useState(false);
  var [showChannels, setShowChannels] = useState(false);

  function toggleRoomList() { setShowRoomList(!showRoomList); setShowChannels(false); }
  function toggleChannels() { setShowChannels(!showChannels); setShowRoomList(false); }

  // Check if current voice channel is a video channel
  var currentVideoChannel = null;
  if (ctx.currentVoiceChannel && ctx.currentRoom) {
    var allChannels = ctx.currentRoom.channels || [];
    for (var ci = 0; ci < allChannels.length; ci++) {
      if (allChannels[ci].id === ctx.currentVoiceChannel && allChannels[ci].type === 'video') {
        currentVideoChannel = allChannels[ci];
        break;
      }
    }
  }

  // If viewing Cords or Games tab inside a room
  if (activeTab === 'cords') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(CordsTab),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  if (activeTab === 'games') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(GamesTab),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  if (activeTab === 'friends') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(FriendsPanel),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  if (activeTab === 'dms') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(DMView),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  if (activeTab === 'roulette') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(RouletteView),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  if (activeTab === 'leaderboard') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(LeaderboardTab),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  if (activeTab === 'profile') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(ProfileView, { onTabChange: onTabChange }),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  if (activeTab === 'report') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(ReportView),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  if (activeTab === 'bugreport') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(BugReportView),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  if (activeTab === 'featurerequest') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(FeatureRequestView),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  if (activeTab === 'about') {
    return React.createElement('div', {
      style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
    },
      isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
      React.createElement(AboutTab),
      isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
    );
  }

  // Chat tab
  return React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', paddingBottom: isMobile ? 'calc(56px + env(safe-area-inset-bottom, 0px))' : '0' }
  },
    isMobile ? null : React.createElement(TopTabBar, { activeTab: activeTab, onTabChange: onTabChange, compact: true }),
    React.createElement('div', {
      style: { display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }
    },
      // Room list - on mobile, overlay; on desktop, always visible
      React.createElement(RoomList, {
        mobileShow: isMobile ? showRoomList : true,
        onToggle: function() { setShowRoomList(false); }
      }),
      // Channel sidebar - on mobile, overlay; on desktop, always visible
      React.createElement(ChannelSidebar, {
        mobileShow: isMobile ? showChannels : true,
        onToggle: function() { setShowChannels(false); }
      }),
      // Chat area or Video call view
      currentVideoChannel ? React.createElement(VideoCallView, {
        onLeave: function() {
          ctx.setCurrentVoiceChannel(null);
          ctx.setVoiceUsers(function(prev) { return prev.filter(function(v) { return v.channelId !== currentVideoChannel.id; }); });
          ctx.setIsMuted(false);
          ctx.setIsDeafened(false);
        }
      }) : React.createElement(ChatArea, {
        onToggleChannels: isMobile ? function() {
          setShowChannels(!showChannels);
          setShowRoomList(false);
        } : null
      }),
      // Mobile overlay backdrop when sidebars are open
      isMobile && (showRoomList || showChannels) ? React.createElement('div', {
        style: {
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.5)', zIndex: 150
        },
        onClick: function() { setShowRoomList(false); setShowChannels(false); }
      }) : null
    ),
    isMobile ? React.createElement(BottomTabBar, { activeTab: activeTab, onTabChange: onTabChange }) : null
  );
}

