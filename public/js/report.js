// ===================== REPORT VIEW =====================
function ReportView() {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var [username, setUsername] = useState('');
  var [reason, setReason] = useState('');
  var [details, setDetails] = useState('');
  var [submitting, setSubmitting] = useState(false);
  var [result, setResult] = useState(null);
  var [suggestions, setSuggestions] = useState([]);
  var [showSuggestions, setShowSuggestions] = useState(false);
  var searchTimeout = useRef(null);

  useEffect(function() {
    if (!ctx.socket) return;
    function onResult(data) {
      if (submitTimeout.current) clearTimeout(submitTimeout.current);
      setSubmitting(false);
      setResult(data);
      if (data && data.success) {
        setUsername('');
        setReason('');
        setDetails('');
        setSuggestions([]);
      }
      setTimeout(function() { setResult(null); }, 5000);
    }
    function onSearchResult(data) {
      if (data && data.users) {
        setSuggestions(data.users);
      }
    }
    ctx.socket.on('report_result', onResult);
    ctx.socket.on('search_users_result', onSearchResult);
    return function() {
      ctx.socket.off('report_result', onResult);
      ctx.socket.off('search_users_result', onSearchResult);
    };
  }, [ctx.socket]);

  var submitTimeout = useRef(null);

  function handleUsernameChange(e) {
    var val = e.target.value.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 20);
    setUsername(val);
    // Debounced search
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (val.trim().length >= 1 && ctx.socket) {
      searchTimeout.current = setTimeout(function() {
        ctx.socket.emit('search_users', { query: val.trim() });
        setShowSuggestions(true);
      }, 250);
    } else {
      setSuggestions([]);
      setShowSuggestions(false);
    }
  }

  function selectUser(name) {
    setUsername(name);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  function handleSubmit() {
    if (!ctx.socket || !username.trim() || !reason || submitting) return;
    setSubmitting(true);
    setResult(null);
    setShowSuggestions(false);
    ctx.socket.emit('user_report', {
      username: username.trim(),
      reason: reason,
      details: details.trim()
    });
    if (submitTimeout.current) clearTimeout(submitTimeout.current);
    submitTimeout.current = setTimeout(function() {
      setSubmitting(false);
      setResult({ success: false, message: 'No response from server. Try again.' });
    }, 8000);
  }

  var isKeyed = ctx.account && !ctx.account.temp;

  var containerStyle = {
    flex: 1, overflowY: 'auto', padding: isMobile ? '12px' : '24px',
    maxWidth: '600px', margin: '0 auto', width: '100%'
  };

  var cardStyle = {
    background: '#16213e', borderRadius: '12px', padding: isMobile ? '16px' : '24px',
    border: '1px solid rgba(240,178,50,0.1)'
  };

  var inputStyle = {
    width: '100%', padding: '10px 12px', background: '#18181b',
    border: 'none', borderRadius: '4px', color: '#dcddde',
    fontSize: '14px', outline: 'none', fontFamily: 'inherit'
  };

  var labelStyle = {
    display: 'block', color: '#b5bac1', fontSize: '12px', fontWeight: 700,
    textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.02em'
  };

  var reasons = ['Harassment', 'Spam', 'Illegal Content', 'Impersonation', 'Exploitation/Cheating', 'Other'];

  if (!isKeyed) {
    return React.createElement('div', { style: containerStyle },
      React.createElement('div', { style: Object.assign({}, cardStyle, { textAlign: 'center', padding: '40px' }) },
        React.createElement('div', { style: { fontSize: '48px', marginBottom: '16px' } }, '\u26A0\uFE0F'),
        React.createElement('h3', { style: { color: '#f0b232', fontSize: '18px', marginBottom: '8px' } }, 'Permanent Account Required'),
        React.createElement('p', { style: { color: '#949ba4', fontSize: '14px' } }, 'You need a permanent account to submit reports. Claim your key from the landing page.')
      )
    );
  }

  return React.createElement('div', { style: containerStyle },
    React.createElement('div', { style: cardStyle },
      React.createElement('h2', {
        style: { color: '#f0b232', fontSize: isMobile ? '18px' : '22px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '10px' }
      }, '\u26A0\uFE0F Report a User'),
      React.createElement('p', {
        style: { color: '#949ba4', fontSize: '13px', marginBottom: '20px' }
      }, 'Reports are reviewed by moderators. Abuse of the report system may result in your account being suspended.'),

      // Username input with autocomplete
      React.createElement('label', { style: labelStyle }, 'Username to Report'),
      React.createElement('div', { style: { position: 'relative' } },
        React.createElement('input', {
          type: 'text', style: inputStyle,
          placeholder: 'Start typing a username...',
          value: username,
          onChange: handleUsernameChange,
          onFocus: function() { if (suggestions.length > 0) setShowSuggestions(true); },
          onBlur: function() { setTimeout(function() { setShowSuggestions(false); }, 200); },
          maxLength: 20,
          autoComplete: 'off'
        }),

        // Suggestions dropdown
        showSuggestions && suggestions.length > 0 ? React.createElement('div', {
          style: {
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
            background: '#1a1a2e', border: '1px solid rgba(240,178,50,0.2)',
            borderRadius: '0 0 6px 6px', maxHeight: '200px', overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
          }
        },
          suggestions.map(function(u, i) {
            return React.createElement('div', {
              key: u.name + i,
              style: {
                padding: '8px 12px', cursor: 'pointer', display: 'flex',
                alignItems: 'center', gap: '8px', transition: 'background 0.1s',
                borderBottom: i < suggestions.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none'
              },
              onMouseDown: function(e) { e.preventDefault(); selectUser(u.name); },
              onMouseEnter: function(e) { e.currentTarget.style.background = 'rgba(240,178,50,0.1)'; },
              onMouseLeave: function(e) { e.currentTarget.style.background = 'transparent'; }
            },
              React.createElement('div', {
                style: {
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: u.color || '#f0b232', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: 700, color: '#fff', flexShrink: 0,
                  position: 'relative'
                }
              },
                u.name.charAt(0).toUpperCase(),
                React.createElement('div', {
                  style: {
                    position: 'absolute', bottom: '-1px', right: '-1px',
                    width: '10px', height: '10px', borderRadius: '50%',
                    background: u.online ? '#57f287' : '#72767d',
                    border: '2px solid #1a1a2e'
                  }
                })
              ),
              React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                React.createElement('span', {
                  style: { color: '#dcddde', fontSize: '14px', fontWeight: 500 }
                }, u.name),
                React.createElement('span', {
                  style: { color: u.online ? '#57f287' : '#72767d', fontSize: '11px', marginLeft: '6px' }
                }, u.online ? 'Online' : 'Offline')
              )
            );
          })
        ) : null,

        // "No users found" hint
        showSuggestions && suggestions.length === 0 && username.trim().length >= 2 ? React.createElement('div', {
          style: {
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
            background: '#1a1a2e', border: '1px solid rgba(240,178,50,0.2)',
            borderRadius: '0 0 6px 6px', padding: '10px 12px',
            color: '#666', fontSize: '13px', fontStyle: 'italic'
          }
        }, 'No users found. You can still type the name manually.') : null
      ),

      // Reason dropdown
      React.createElement('label', { style: Object.assign({}, labelStyle, { marginTop: '16px' }) }, 'Reason'),
      React.createElement('select', {
        style: Object.assign({}, inputStyle, { cursor: 'pointer', appearance: 'auto' }),
        value: reason,
        onChange: function(e) { setReason(e.target.value); }
      },
        React.createElement('option', { value: '', disabled: true }, 'Select a reason...'),
        reasons.map(function(r) {
          return React.createElement('option', { key: r, value: r }, r);
        })
      ),

      // Details textarea
      React.createElement('label', { style: Object.assign({}, labelStyle, { marginTop: '16px' }) }, 'Details (Optional)'),
      React.createElement('textarea', {
        style: Object.assign({}, inputStyle, { minHeight: '80px', resize: 'vertical' }),
        placeholder: 'Provide any additional context...',
        value: details,
        onChange: function(e) { setDetails(e.target.value.slice(0, 200)); },
        maxLength: 200
      }),
      React.createElement('div', {
        style: { textAlign: 'right', fontSize: '11px', color: '#555', marginTop: '4px' }
      }, details.length + '/200'),

      // Submit button
      React.createElement('button', {
        style: {
          width: '100%', padding: '12px', marginTop: '16px',
          background: !username.trim() || !reason || submitting ? '#555' : '#ed4245',
          border: 'none', borderRadius: '4px', color: '#fff',
          fontSize: '14px', fontWeight: 600,
          cursor: !username.trim() || !reason || submitting ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', transition: 'background 0.15s'
        },
        disabled: !username.trim() || !reason || submitting,
        onClick: handleSubmit
      }, submitting ? 'Submitting...' : 'Submit Report'),

      // Result message
      result ? React.createElement('div', {
        style: {
          marginTop: '12px', padding: '10px 14px', borderRadius: '6px',
          background: result.success ? 'rgba(87,242,135,0.1)' : 'rgba(237,66,69,0.1)',
          border: '1px solid ' + (result.success ? '#57f287' : '#ed4245'),
          color: result.success ? '#57f287' : '#ed4245',
          fontSize: '13px', textAlign: 'center'
        }
      }, result.message) : null
    )
  );
}
