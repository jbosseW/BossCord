// security-init.js — Client-side input guards (loaded before app)
(function() {
  // Disable right-click
  document.addEventListener('contextmenu', function(e) { e.preventDefault(); }, true);

  // Block DevTools keyboard shortcuts (F12, Ctrl+Shift+I/J/C, Ctrl+U)
  document.addEventListener('keydown', function(e) {
    // F12
    if (e.key === 'F12' || e.keyCode === 123) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+Shift+I (Inspector), Ctrl+Shift+J (Console), Ctrl+Shift+C (Element picker)
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (
      e.key === 'I' || e.key === 'i' ||
      e.key === 'J' || e.key === 'j' ||
      e.key === 'C' || e.key === 'c'
    )) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
    // Ctrl+U (View Source)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'U' || e.key === 'u') && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  // DevTools detection (desktop only) — disabled due to false positives
  // on Windows with display scaling, toolbars, extensions, etc.

  // Disable drag/drop (prevents file injection)
  document.addEventListener('dragover', function(e) { e.preventDefault(); }, true);
  document.addEventListener('drop', function(e) { e.preventDefault(); }, true);
  document.addEventListener('dragstart', function(e) { e.preventDefault(); }, true);

  // Paste: allow in inputs/textareas but limit to 500 characters
  document.addEventListener('paste', function(e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      var clip = (e.clipboardData || window.clipboardData).getData('text') || '';
      if (clip.length > 500) {
        e.preventDefault();
        var trimmed = clip.slice(0, 500);
        document.execCommand('insertText', false, trimmed);
      }
      return;
    }
    e.preventDefault();
  }, true);
})();
