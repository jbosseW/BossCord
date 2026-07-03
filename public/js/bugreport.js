// ===================== BUG REPORT VIEW =====================
function BugReportView() {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var [title, setTitle] = useState('');
  var [category, setCategory] = useState('');
  var [severity, setSeverity] = useState('Medium');
  var [description, setDescription] = useState('');
  var [steps, setSteps] = useState('');
  var [submitting, setSubmitting] = useState(false);
  var [result, setResult] = useState(null);

  useEffect(function() {
    if (!ctx.socket) return;
    function onResult(data) {
      if (submitTimeout.current) clearTimeout(submitTimeout.current);
      setSubmitting(false);
      setResult(data);
      if (data && data.success) {
        setTitle('');
        setCategory('');
        setSeverity('Medium');
        setDescription('');
        setSteps('');
      }
      setTimeout(function() { setResult(null); }, 5000);
    }
    ctx.socket.on('bug_report_result', onResult);
    return function() { ctx.socket.off('bug_report_result', onResult); };
  }, [ctx.socket]);

  var submitTimeout = useRef(null);

  function handleSubmit() {
    if (!ctx.socket || !title.trim() || !category || submitting) return;
    setSubmitting(true);
    setResult(null);
    ctx.socket.emit('bug_report', {
      title: title.trim(),
      category: category,
      severity: severity,
      description: description.trim(),
      steps: steps.trim(),
      userAgent: navigator.userAgent
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
    maxWidth: '650px', margin: '0 auto', width: '100%'
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

  var categories = [
    'Chat / Messaging',
    'Games - Casino',
    'Games - TCG',
    'Games - BossOrbs',
    'Games - Other',
    'Friends / DMs',
    'Stock Market',
    'Auction House',
    'Rooms / Channels',
    'Profile / Account',
    'Audio / Voice',
    'Video Roulette',
    'UI / Display',
    'Performance',
    'Other'
  ];

  var severities = [
    { value: 'Low', label: 'Low', desc: 'Minor issue, cosmetic', color: '#57f287' },
    { value: 'Medium', label: 'Medium', desc: 'Affects functionality', color: '#f0b232' },
    { value: 'High', label: 'High', desc: 'Major feature broken', color: '#ff9800' },
    { value: 'Critical', label: 'Critical', desc: 'Crash or data loss', color: '#ed4245' }
  ];

  if (!isKeyed) {
    return React.createElement('div', { style: containerStyle },
      React.createElement('div', { style: Object.assign({}, cardStyle, { textAlign: 'center', padding: '40px' }) },
        React.createElement('div', { style: { fontSize: '48px', marginBottom: '16px' } }, '\uD83D\uDC1B'),
        React.createElement('h3', { style: { color: '#f0b232', fontSize: '18px', marginBottom: '8px' } }, 'Permanent Account Required'),
        React.createElement('p', { style: { color: '#949ba4', fontSize: '14px' } }, 'You need a permanent account to submit bug reports. Claim your key from the landing page.')
      )
    );
  }

  return React.createElement('div', { style: containerStyle },
    React.createElement('div', { style: cardStyle },
      React.createElement('h2', {
        style: { color: '#f0b232', fontSize: isMobile ? '18px' : '22px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '10px' }
      }, '\uD83D\uDC1B Report a Bug'),
      React.createElement('p', {
        style: { color: '#949ba4', fontSize: '13px', marginBottom: '20px' }
      }, 'Found a bug or glitch? Let us know so we can fix it. Be as detailed as possible.'),

      // Title input
      React.createElement('label', { style: labelStyle }, 'Bug Title *'),
      React.createElement('input', {
        type: 'text', style: inputStyle,
        placeholder: 'Short description of the issue...',
        value: title,
        onChange: function(e) { setTitle(e.target.value.slice(0, 80)); },
        maxLength: 80
      }),
      React.createElement('div', {
        style: { textAlign: 'right', fontSize: '11px', color: '#555', marginTop: '2px' }
      }, title.length + '/80'),

      // Category dropdown
      React.createElement('label', { style: Object.assign({}, labelStyle, { marginTop: '14px' }) }, 'Category *'),
      React.createElement('select', {
        style: Object.assign({}, inputStyle, { cursor: 'pointer', appearance: 'auto' }),
        value: category,
        onChange: function(e) { setCategory(e.target.value); }
      },
        React.createElement('option', { value: '', disabled: true }, 'Select a category...'),
        categories.map(function(c) {
          return React.createElement('option', { key: c, value: c }, c);
        })
      ),

      // Severity picker
      React.createElement('label', { style: Object.assign({}, labelStyle, { marginTop: '14px' }) }, 'Severity'),
      React.createElement('div', {
        style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }
      },
        severities.map(function(s) {
          var isSelected = severity === s.value;
          return React.createElement('button', {
            key: s.value,
            style: {
              padding: '6px 14px', borderRadius: '20px', border: '1px solid ' + (isSelected ? s.color : '#333'),
              background: isSelected ? s.color + '20' : 'transparent',
              color: isSelected ? s.color : '#888', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s'
            },
            onClick: function() { setSeverity(s.value); },
            title: s.desc
          }, s.label);
        })
      ),

      // Description textarea
      React.createElement('label', { style: Object.assign({}, labelStyle, { marginTop: '14px' }) }, 'Description'),
      React.createElement('textarea', {
        style: Object.assign({}, inputStyle, { minHeight: '100px', resize: 'vertical' }),
        placeholder: 'What happened? What did you expect to happen instead?',
        value: description,
        onChange: function(e) { setDescription(e.target.value.slice(0, 1000)); },
        maxLength: 1000
      }),
      React.createElement('div', {
        style: { textAlign: 'right', fontSize: '11px', color: '#555', marginTop: '2px' }
      }, description.length + '/1000'),

      // Steps to reproduce
      React.createElement('label', { style: Object.assign({}, labelStyle, { marginTop: '14px' }) }, 'Steps to Reproduce (Optional)'),
      React.createElement('textarea', {
        style: Object.assign({}, inputStyle, { minHeight: '70px', resize: 'vertical' }),
        placeholder: '1. Go to...\n2. Click on...\n3. See error...',
        value: steps,
        onChange: function(e) { setSteps(e.target.value.slice(0, 500)); },
        maxLength: 500
      }),
      React.createElement('div', {
        style: { textAlign: 'right', fontSize: '11px', color: '#555', marginTop: '2px' }
      }, steps.length + '/500'),

      // Browser info (auto-detected)
      React.createElement('div', {
        style: { marginTop: '14px', padding: '8px 12px', background: '#18181b', borderRadius: '4px', fontSize: '11px', color: '#555' }
      }, 'Browser info will be attached automatically'),

      // Submit button
      React.createElement('button', {
        style: {
          width: '100%', padding: '12px', marginTop: '16px',
          background: !title.trim() || !category || submitting ? '#555' : '#5865f2',
          border: 'none', borderRadius: '4px', color: '#fff',
          fontSize: '14px', fontWeight: 600,
          cursor: !title.trim() || !category || submitting ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', transition: 'background 0.15s'
        },
        disabled: !title.trim() || !category || submitting,
        onClick: handleSubmit
      }, submitting ? 'Submitting...' : 'Submit Bug Report'),

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
