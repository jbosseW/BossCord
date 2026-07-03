// ===================== BROWSER NOTIFICATIONS =====================
var BossCordNotifs = (function() {
  var _enabled = localStorage.getItem('bosscord_notifs') === 'true';
  var _tabHidden = false;

  // Track tab visibility
  document.addEventListener('visibilitychange', function() {
    _tabHidden = document.hidden;
  });

  return {
    isEnabled: function() { return _enabled; },

    toggle: function() {
      if (!_enabled) {
        // Turning on — request permission first
        if (!('Notification' in window)) return false;
        if (Notification.permission === 'granted') {
          _enabled = true;
          localStorage.setItem('bosscord_notifs', 'true');
          return true;
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(function(perm) {
            if (perm === 'granted') {
              _enabled = true;
              localStorage.setItem('bosscord_notifs', 'true');
            }
          });
          return false; // async — will be enabled after permission granted
        }
        return false; // denied
      } else {
        // Turning off
        _enabled = false;
        localStorage.setItem('bosscord_notifs', 'false');
        return true;
      }
    },

    notify: function(title, body, tag) {
      if (!_enabled || !_tabHidden) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        var n = new Notification(title || 'BossCord', {
          body: (body || '').slice(0, 100),
          tag: tag || 'bosscord',
          icon: '/icons/bosscord/icon-192.png',
          silent: false
        });
        // Auto-close after 5 seconds
        setTimeout(function() { try { n.close(); } catch(e) {} }, 5000);
        // Click to focus window
        n.onclick = function() {
          window.focus();
          n.close();
        };
      } catch (e) {
        // Notification constructor can fail on some mobile browsers
      }
    }
  };
})();
