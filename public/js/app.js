// ===================== APP ROOT =====================
function App() {
  var ctx = useSocket();
  var hasRoom = ctx.currentRoomCode && ctx.currentRoom;
  var [activeTab, setActiveTabLocal] = useState('chat');
  var [showQuickSwitcher, setShowQuickSwitcher] = useState(false);
  var [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Unified tab change handler: updates local state, syncs to SocketProvider,
  // and resets unread badge counts for the target tab
  var handleTabChange = useCallback(function(tabId) {
    setActiveTabLocal(tabId);
    if (ctx.setActiveTab) ctx.setActiveTab(tabId);
    // Reset unread counts when switching to the relevant tab
    if (tabId === 'dms' && ctx.setUnreadDMs) ctx.setUnreadDMs(0);
    if (tabId === 'friends' && ctx.setUnreadFriendRequests) ctx.setUnreadFriendRequests(0);
  }, [ctx.setActiveTab, ctx.setUnreadDMs, ctx.setUnreadFriendRequests]);

  // Sync initial tab to SocketProvider on mount
  useEffect(function() {
    if (ctx.setActiveTab) ctx.setActiveTab(activeTab);
  }, []);

  // Expose global hook for UserActionMenu "View Profile" button
  // When called, switches to the profile tab
  useEffect(function() {
    window._bosscordViewProfile = function() {
      handleTabChange('profile');
    };
    return function() {
      delete window._bosscordViewProfile;
    };
  }, [handleTabChange]);

  // Room switcher helper: switch to a room by code
  var switchToRoom = useCallback(function(roomCode) {
    if (!ctx.socket || !roomCode) return;
    if (roomCode === ctx.currentRoomCode) return;
    if (ctx.currentChannelId) {
      ctx.socket.emit('leave_channel', { channelId: ctx.currentChannelId });
    }
    ctx.setCurrentRoomCode(roomCode);
    var room = (ctx.rooms || []).find(function(r) { return r.code === roomCode; });
    if (room) {
      var firstText = (room.channels || []).find(function(c) { return c.type === 'text'; });
      if (firstText) {
        ctx.socket.emit('join_channel', { roomCode: roomCode, channelId: firstText.id });
        ctx.setCurrentChannelId(firstText.id);
      }
    }
    // Also ensure we are on the chat tab when switching rooms
    handleTabChange('chat');
  }, [ctx.socket, ctx.currentRoomCode, ctx.currentChannelId, ctx.rooms, ctx.setCurrentRoomCode, ctx.setCurrentChannelId, handleTabChange]);

  // Alt+Up / Alt+Down: switch between rooms (previous/next)
  var switchRoomByOffset = useCallback(function(offset) {
    var rooms = ctx.rooms || [];
    if (rooms.length === 0) return;
    var currentIndex = -1;
    for (var i = 0; i < rooms.length; i++) {
      if (rooms[i].code === ctx.currentRoomCode) {
        currentIndex = i;
        break;
      }
    }
    var nextIndex;
    if (currentIndex === -1) {
      nextIndex = 0;
    } else {
      nextIndex = currentIndex + offset;
      if (nextIndex < 0) nextIndex = rooms.length - 1;
      if (nextIndex >= rooms.length) nextIndex = 0;
    }
    switchToRoom(rooms[nextIndex].code);
  }, [ctx.rooms, ctx.currentRoomCode, switchToRoom]);

  // Global keyboard shortcuts
  useEffect(function() {
    function handleKeyDown(e) {
      var isMod = e.metaKey || e.ctrlKey;

      // Ctrl+K / Cmd+K: Open quick switcher
      if (isMod && e.key === 'k') {
        e.preventDefault();
        setShowQuickSwitcher(function(prev) { return !prev; });
        setShowShortcutsHelp(false);
        return;
      }

      // Ctrl+Shift+M / Cmd+Shift+M: Toggle voice mute
      if (isMod && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
        e.preventDefault();
        if (ctx.voiceManager && ctx.voiceManager.localStream) {
          ctx.voiceManager.toggleMute();
        }
        return;
      }

      // Ctrl+/ or Cmd+/: Show shortcuts help
      if (isMod && e.key === '/') {
        e.preventDefault();
        setShowShortcutsHelp(function(prev) { return !prev; });
        setShowQuickSwitcher(false);
        return;
      }

      // Escape: Close any open modal/picker
      if (e.key === 'Escape') {
        if (showQuickSwitcher) {
          setShowQuickSwitcher(false);
          e.preventDefault();
          return;
        }
        if (showShortcutsHelp) {
          setShowShortcutsHelp(false);
          e.preventDefault();
          return;
        }
        // Allow Escape to propagate to other handlers (GIF picker, etc.)
        return;
      }

      // Alt+Up / Alt+Down: Switch between rooms
      if (e.altKey && !isMod && !e.shiftKey) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          switchRoomByOffset(-1);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          switchRoomByOffset(1);
          return;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return function() {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [ctx.voiceManager, showQuickSwitcher, showShortcutsHelp, switchRoomByOffset]);

  return React.createElement('div', {
    style: { height: '100%', width: '100%', overflow: 'hidden' }
  },
    React.createElement(WipeWarningBanner),
    React.createElement(UpdateWarningBanner),
    React.createElement(ConnectionBanner),
    hasRoom ?
      React.createElement(ChatLayout, { activeTab: activeTab, onTabChange: handleTabChange }) :
      React.createElement(LandingPage),
    // Quick Switcher overlay
    showQuickSwitcher ? React.createElement(QuickSwitcher, {
      onClose: function() { setShowQuickSwitcher(false); },
      onSwitchRoom: switchToRoom,
      onSwitchTab: handleTabChange
    }) : null,
    // Keyboard Shortcuts Help overlay
    showShortcutsHelp ? React.createElement(KeyboardShortcutsHelp, {
      onClose: function() { setShowShortcutsHelp(false); }
    }) : null
  );
}

// ===================== MOUNT =====================
var root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(SocketProvider, null, React.createElement(App)));
