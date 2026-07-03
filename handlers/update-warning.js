// handlers/update-warning.js
// Socket handlers: mod_update_warning, mod_clear_update_warning

module.exports = {
  init(io, socket, deps) {
    var { user, isModerator, checkEventRate } = deps;

    socket.on('mod_update_warning', (data) => {
      try {
        if (!isModerator(socket.id)) { socket.emit('error', { message: 'Not authorized' }); return; }
        if (!checkEventRate(socket, 'mod_action', 60, 60000)) return;
        var message = (data && typeof data.message === 'string')
          ? data.message.slice(0, 200)
          : 'Server update incoming. May be briefly unavailable.';
        var minutesLeft = (data && typeof data.minutesLeft === 'number') ? data.minutesLeft : null;
        io.emit('update_warning', { message: message, minutesLeft: minutesLeft });
        console.log('[mod] ' + (user.name || socket.id) + ' triggered update warning: ' + message);
      } catch (err) {
        console.error('[mod_update_warning] Error:', err.message);
      }
    });

    socket.on('mod_clear_update_warning', () => {
      try {
        if (!isModerator(socket.id)) { socket.emit('error', { message: 'Not authorized' }); return; }
        io.emit('update_warning', { message: null, clear: true });
        console.log('[mod] ' + (user.name || socket.id) + ' cleared update warning');
      } catch (err) {
        console.error('[mod_clear_update_warning] Error:', err.message);
      }
    });
  }
};
