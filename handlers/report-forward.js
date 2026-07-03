// handlers/report-forward.js
// Forwards report entries to KVM1 over mTLS, then wipes local copy.
// Used by report.js, bugreport.js, featurerequest.js.

var https = require('https');
var fs = require('fs');
var path = require('path');

// Report-forwarding target. Set BOSSCORD_REPORT_HOST to your ingest server's
// host/IP to enable; if unset, forwarding is disabled and reports stay local.
var KVM1_IP = process.env.BOSSCORD_REPORT_HOST || '';
var KVM1_PORT = parseInt(process.env.BOSSCORD_REPORT_PORT, 10) || 8443;
var TLS_DIR = process.env.BOSSCORD_TLS_DIR || '/etc/bosscord/tls';

// Load TLS certs once at startup (KVM2 client certs for talking to KVM1)
var tlsOpts = null;
try {
  tlsOpts = {
    key:  fs.readFileSync(path.join(TLS_DIR, 'kvm2-client.key')),
    cert: fs.readFileSync(path.join(TLS_DIR, 'kvm2-client.crt')),
    ca:   fs.readFileSync(path.join(TLS_DIR, 'ca.crt')),
    minVersion: 'TLSv1.3'
  };
} catch (err) {
  // Not fatal — forwarding will just be skipped if certs aren't available
  // (e.g. running locally in dev mode)
  console.warn('[report-forward] TLS certs not available, report forwarding disabled:', err.message);
}

/**
 * Forward a report entry to KVM1 and wipe it from the local JSONL file.
 * @param {string} type - 'reports', 'bugs', or 'features'
 * @param {object} entry - The report object to forward
 * @param {string} localFile - Path to the local JSONL file
 */
function forwardAndWipe(type, entry, localFile) {
  if (!tlsOpts || !KVM1_IP) return; // no certs or no target host = keep locally

  var payload = JSON.stringify({ type: type, entry: entry });

  var opts = {
    hostname: KVM1_IP,
    port: KVM1_PORT,
    path: '/report-ingest',
    method: 'POST',
    key: tlsOpts.key,
    cert: tlsOpts.cert,
    ca: tlsOpts.ca,
    minVersion: tlsOpts.minVersion,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    },
    timeout: 10000
  };

  var req = https.request(opts, function(res) {
    var chunks = [];
    res.on('data', function(c) { chunks.push(c); });
    res.on('end', function() {
      var body = Buffer.concat(chunks).toString('utf8');
      if (res.statusCode === 200) {
        // Successfully forwarded — wipe the entry from local file
        try {
          if (fs.existsSync(localFile)) {
            var lines = fs.readFileSync(localFile, 'utf8').trim().split('\n');
            var entryId = entry.id;
            var remaining = lines.filter(function(line) {
              if (!line.trim()) return false;
              try { return JSON.parse(line.trim()).id !== entryId; } catch(_) { return true; }
            });
            fs.writeFileSync(localFile, remaining.length > 0 ? remaining.join('\n') + '\n' : '', 'utf8');
          }
        } catch (wipeErr) {
          console.error('[report-forward] Wipe failed for ' + type + ':', wipeErr.message);
        }
      } else {
        console.error('[report-forward] KVM1 rejected ' + type + ' (HTTP ' + res.statusCode + '): ' + body.substring(0, 200));
      }
    });
  });

  req.on('error', function(err) {
    console.error('[report-forward] Failed to forward ' + type + ' to KVM1:', err.message);
    // Report stays in local file as fallback — daily wipe will archive it
  });

  req.on('timeout', function() {
    req.destroy(new Error('Timeout'));
  });

  req.write(payload);
  req.end();
}

module.exports = { forwardAndWipe };
