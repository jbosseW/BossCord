// handlers/bugreport.js
// Socket handler: bug_report
// Logs bug reports to reports/bugs.jsonl — daily archive to KVM1

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var reportForward = require('./report-forward');

var REPORTS_DIR = path.join(__dirname, '..', 'reports');
var BUGS_FILE = path.join(REPORTS_DIR, 'bugs.jsonl');

function ensureBugsDir() {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
  } catch (e) {
    console.error('[bugreport] Cannot create reports dir:', e.message);
  }
}

ensureBugsDir();

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate, sanitizeText } = deps;

    socket.on('bug_report', function(data) {
      try {
        // Rate limit: 3 bug reports per 5 minutes
        if (!checkEventRate(socket, 'bug_report', 3, 300000)) {
          socket.emit('bug_report_result', { success: false, message: 'Too many bug reports. Please wait a few minutes.' });
          return;
        }

        // Must have a permanent account
        var reporterKey = socketAccountMap.get(socket.id);
        if (!reporterKey) {
          socket.emit('bug_report_result', { success: false, message: 'You must be logged in to submit bug reports.' });
          return;
        }
        var reporterAcc = accounts.loadAccount(reporterKey);
        if (!reporterAcc || reporterAcc.temp) {
          socket.emit('bug_report_result', { success: false, message: 'Only permanent account holders can submit bug reports.' });
          return;
        }

        // Validate input
        if (!data || typeof data.title !== 'string' || !data.title.trim()) {
          socket.emit('bug_report_result', { success: false, message: 'Please provide a title for the bug.' });
          return;
        }
        if (!data.category || typeof data.category !== 'string') {
          socket.emit('bug_report_result', { success: false, message: 'Please select a category.' });
          return;
        }

        var title = sanitizeText(data.title.trim()).slice(0, 80);
        var category = sanitizeText(data.category).slice(0, 30);
        var description = data.description ? sanitizeText(String(data.description).trim()).slice(0, 1000) : '';
        var steps = data.steps ? sanitizeText(String(data.steps).trim()).slice(0, 500) : '';
        var severity = ['Low', 'Medium', 'High', 'Critical'].indexOf(data.severity) !== -1 ? data.severity : 'Medium';

        // Build bug report record
        var report = {
          id: 'BUG-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          timestamp: new Date().toISOString(),
          reporterName: user.name,
          reporterKeyHash: crypto.createHash('sha256').update(reporterKey).digest('hex').slice(0, 16),
          title: title,
          category: category,
          severity: severity,
          description: description,
          steps: steps,
          userAgent: data.userAgent ? sanitizeText(String(data.userAgent)).slice(0, 200) : 'unknown'
        };

        // Ensure dir exists before writing
        ensureBugsDir();

        // Append to JSONL file
        try {
          fs.appendFileSync(BUGS_FILE, JSON.stringify(report) + '\n', 'utf8');
        } catch (writeErr) {
          console.error('[bugreport] Failed to write bug report:', writeErr.message);
          socket.emit('bug_report_result', { success: false, message: 'Failed to submit bug report. Try again.' });
          return;
        }

        console.log('[bugreport] ' + user.name + ' submitted: ' + title + ' [' + severity + ']');
        reportForward.forwardAndWipe('bugs', report, BUGS_FILE);
        socket.emit('bug_report_result', { success: true, message: 'Bug report submitted. Thank you for helping improve BossCord!' });
      } catch (err) {
        console.error('[bug_report] Error:', err.message);
        try {
          socket.emit('bug_report_result', { success: false, message: 'An error occurred.' });
        } catch (e) { /* socket gone */ }
      }
    });
  }
};
