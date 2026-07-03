// handlers/report.js
// Socket handler: user_report
// Logs reports to reports/reports.jsonl — user never sees backend data

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var reportForward = require('./report-forward');

var REPORTS_DIR = path.join(__dirname, '..', 'reports');
var REPORTS_FILE = path.join(REPORTS_DIR, 'reports.jsonl');

function ensureReportsDir() {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
  } catch (e) {
    console.error('[report] Cannot create reports dir:', e.message);
  }
}

// Create on load
ensureReportsDir();

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate, sanitizeText } = deps;
    var state = deps.state;

    // Search users by partial name (online + offline accounts)
    socket.on('search_users', function(data) {
      try {
        if (!checkEventRate(socket, 'search_users', 30, 60000)) return;
        if (!data || typeof data.query !== 'string' || !data.query.trim()) {
          socket.emit('search_users_result', { users: [] });
          return;
        }
        var query = data.query.trim().toLowerCase().slice(0, 20);
        if (query.length < 1) {
          socket.emit('search_users_result', { users: [] });
          return;
        }
        var results = [];
        var seen = new Set();
        // 1) Online users first (marked as online)
        for (var [, u] of state.users) {
          if (u.name && u.name.toLowerCase().indexOf(query) !== -1 && u.name !== user.name) {
            var key = u.name.toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              results.push({ name: u.name, color: u.color, online: true });
            }
          }
        }
        // 2) Offline permanent accounts
        if (accounts.searchUsernames) {
          var offlineResults = accounts.searchUsernames(query, 10);
          for (var i = 0; i < offlineResults.length; i++) {
            var r = offlineResults[i];
            var k = r.name.toLowerCase();
            if (!seen.has(k) && r.name !== user.name) {
              seen.add(k);
              results.push({ name: r.name, color: r.color, online: false });
            }
          }
        }
        // Cap at 10
        socket.emit('search_users_result', { users: results.slice(0, 10) });
      } catch (err) { /* swallow */ }
    });

    socket.on('user_report', function(data) {
      try {
        // Rate limit: 5 reports per 60 seconds
        if (!checkEventRate(socket, 'user_report', 5, 60000)) {
          socket.emit('report_result', { success: false, message: 'Too many reports. Please wait.' });
          return;
        }

        // Must have a permanent account
        var reporterKey = socketAccountMap.get(socket.id);
        if (!reporterKey) {
          socket.emit('report_result', { success: false, message: 'You must be logged in to report.' });
          return;
        }
        var reporterAcc = accounts.loadAccount(reporterKey);
        if (!reporterAcc || reporterAcc.temp) {
          socket.emit('report_result', { success: false, message: 'Only permanent account holders can submit reports.' });
          return;
        }

        // Validate input
        if (!data || typeof data.username !== 'string' || !data.username.trim()) {
          socket.emit('report_result', { success: false, message: 'Please provide a username to report.' });
          return;
        }
        if (!data.reason || typeof data.reason !== 'string') {
          socket.emit('report_result', { success: false, message: 'Please select a reason.' });
          return;
        }

        var reportedUsername = sanitizeText(data.username.trim()).slice(0, 20);
        var reason = sanitizeText(data.reason).slice(0, 50);
        var details = data.details ? sanitizeText(String(data.details).trim()).slice(0, 200) : '';

        // Find the reported user — search active sockets by username
        var reportedKey = null;
        var reportedIp = null;
        var reportedName = reportedUsername;

        for (var [sid, key] of socketAccountMap) {
          try {
            var acc = accounts.loadAccount(key);
            if (acc && acc.username && acc.username.toLowerCase() === reportedUsername.toLowerCase()) {
              reportedKey = key;
              reportedName = acc.username;
              var targetSocket = io.sockets && io.sockets.sockets ? io.sockets.sockets.get(sid) : null;
              if (targetSocket && targetSocket._clientIp) {
                reportedIp = targetSocket._clientIp;
              }
              break;
            }
          } catch (lookupErr) {
            // Skip this entry, continue searching
          }
        }

        // Build report record
        var report = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          timestamp: new Date().toISOString(),
          reporterName: user.name,
          reporterKeyHash: crypto.createHash('sha256').update(reporterKey).digest('hex').slice(0, 16),
          reporterIp: socket._clientIp || 'unknown',
          reportedName: reportedName,
          reportedKeyHash: reportedKey ? crypto.createHash('sha256').update(reportedKey).digest('hex').slice(0, 16) : 'not_found',
          reportedIp: reportedIp || 'offline_or_unknown',
          reason: reason,
          details: details
        };

        // Ensure dir exists before writing
        ensureReportsDir();

        // Append to JSONL file
        try {
          fs.appendFileSync(REPORTS_FILE, JSON.stringify(report) + '\n', 'utf8');
        } catch (writeErr) {
          console.error('[report] Failed to write report:', writeErr.message);
          socket.emit('report_result', { success: false, message: 'Failed to submit report. Try again.' });
          return;
        }

        console.log('[report] ' + user.name + ' reported ' + reportedName + ' for: ' + reason);
        // Forward to KVM1 and wipe from local disk
        reportForward.forwardAndWipe('reports', report, REPORTS_FILE);
        socket.emit('report_result', { success: true, message: 'Report submitted. Thank you.' });
      } catch (err) {
        console.error('[user_report] Error:', err.message);
        try {
          socket.emit('report_result', { success: false, message: 'An error occurred.' });
        } catch (e) { /* socket gone */ }
      }
    });
  }
};
