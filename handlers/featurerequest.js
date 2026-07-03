// handlers/featurerequest.js
// Socket handler: feature_request
// Logs feature requests to reports/features.jsonl — daily archive

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var reportForward = require('./report-forward');

var REPORTS_DIR = path.join(__dirname, '..', 'reports');
var FEATURES_FILE = path.join(REPORTS_DIR, 'features.jsonl');

function ensureDir() {
  try {
    if (!fs.existsSync(REPORTS_DIR)) {
      fs.mkdirSync(REPORTS_DIR, { recursive: true });
    }
  } catch (e) {
    console.error('[featurerequest] Cannot create reports dir:', e.message);
  }
}

ensureDir();

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate, sanitizeText } = deps;

    socket.on('feature_request', function(data) {
      try {
        // Rate limit: 3 feature requests per 5 minutes
        if (!checkEventRate(socket, 'feature_request', 3, 300000)) {
          socket.emit('feature_request_result', { success: false, message: 'Too many requests. Please wait a few minutes.' });
          return;
        }

        // Must have a permanent account
        var reporterKey = socketAccountMap.get(socket.id);
        if (!reporterKey) {
          socket.emit('feature_request_result', { success: false, message: 'You must be logged in to submit feature requests.' });
          return;
        }
        var reporterAcc = accounts.loadAccount(reporterKey);
        if (!reporterAcc || reporterAcc.temp) {
          socket.emit('feature_request_result', { success: false, message: 'Only permanent account holders can submit feature requests.' });
          return;
        }

        // Validate input
        if (!data || typeof data.title !== 'string' || !data.title.trim()) {
          socket.emit('feature_request_result', { success: false, message: 'Please provide a title for your request.' });
          return;
        }
        if (!data.category || typeof data.category !== 'string') {
          socket.emit('feature_request_result', { success: false, message: 'Please select a category.' });
          return;
        }

        var title = sanitizeText(data.title.trim()).slice(0, 80);
        var category = sanitizeText(data.category).slice(0, 30);
        var description = data.description ? sanitizeText(String(data.description).trim()).slice(0, 1000) : '';
        var useCase = data.useCase ? sanitizeText(String(data.useCase).trim()).slice(0, 500) : '';

        // Build record
        var record = {
          id: 'FEAT-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          timestamp: new Date().toISOString(),
          reporterName: user.name,
          reporterKeyHash: crypto.createHash('sha256').update(reporterKey).digest('hex').slice(0, 16),
          title: title,
          category: category,
          description: description,
          useCase: useCase
        };

        ensureDir();

        try {
          fs.appendFileSync(FEATURES_FILE, JSON.stringify(record) + '\n', 'utf8');
        } catch (writeErr) {
          console.error('[featurerequest] Failed to write:', writeErr.message);
          socket.emit('feature_request_result', { success: false, message: 'Failed to submit. Try again.' });
          return;
        }

        console.log('[featurerequest] ' + user.name + ' requested: ' + title);
        reportForward.forwardAndWipe('features', record, FEATURES_FILE);
        socket.emit('feature_request_result', { success: true, message: 'Feature request submitted. Thank you for your feedback!' });
      } catch (err) {
        console.error('[feature_request] Error:', err.message);
        try {
          socket.emit('feature_request_result', { success: false, message: 'An error occurred.' });
        } catch (e) { /* socket gone */ }
      }
    });
  }
};
