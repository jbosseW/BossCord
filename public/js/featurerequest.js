// ===================== FEATURE REQUEST VIEW =====================
function FeatureRequestView() {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var [title, setTitle] = useState('');
  var [category, setCategory] = useState('');
  var [description, setDescription] = useState('');
  var [useCase, setUseCase] = useState('');
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
        setDescription('');
        setUseCase('');
      }
      setTimeout(function() { setResult(null); }, 5000);
    }
    ctx.socket.on('feature_request_result', onResult);
    return function() { ctx.socket.off('feature_request_result', onResult); };
  }, [ctx.socket]);

  var submitTimeout = useRef(null);

  function handleSubmit() {
    if (!ctx.socket || !title.trim() || !category || submitting) return;
    setSubmitting(true);
    setResult(null);
    ctx.socket.emit('feature_request', {
      title: title.trim(),
      category: category,
      description: description.trim(),
      useCase: useCase.trim()
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
    'New Game / Minigame',
    'Chat / Messaging',
    'Friends / Social',
    'Profile / Customization',
    'UI / UX Improvement',
    'Audio / Voice',
    'Rooms / Channels',
    'Stock Market',
    'Auction House',
    'TCG / Cards',
    'Casino Games',
    'Moderation Tools',
    'Accessibility',
    'Mobile Experience',
    'Other'
  ];

  if (!isKeyed) {
    return React.createElement('div', { style: containerStyle },
      React.createElement('div', { style: Object.assign({}, cardStyle, { textAlign: 'center', padding: '40px' }) },
        React.createElement('div', { style: { fontSize: '48px', marginBottom: '16px' } }, '\uD83D\uDCA1'),
        React.createElement('h3', { style: { color: '#f0b232', fontSize: '18px', marginBottom: '8px' } }, 'Permanent Account Required'),
        React.createElement('p', { style: { color: '#949ba4', fontSize: '14px' } }, 'You need a permanent account to submit feature requests. Claim your key from the landing page.')
      )
    );
  }

  return React.createElement('div', { style: containerStyle },
    React.createElement('div', { style: cardStyle },
      React.createElement('h2', {
        style: { color: '#f0b232', fontSize: isMobile ? '18px' : '22px', fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '10px' }
      }, '\uD83D\uDCA1 Request a Feature'),
      React.createElement('p', {
        style: { color: '#949ba4', fontSize: '13px', marginBottom: '20px' }
      }, 'Have an idea to make BossCord better? We\'d love to hear it. Be specific about what you want and why.'),

      // Title input
      React.createElement('label', { style: labelStyle }, 'Feature Title *'),
      React.createElement('input', {
        type: 'text', style: inputStyle,
        placeholder: 'Short title for your feature idea...',
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

      // Description textarea
      React.createElement('label', { style: Object.assign({}, labelStyle, { marginTop: '14px' }) }, 'Description *'),
      React.createElement('textarea', {
        style: Object.assign({}, inputStyle, { minHeight: '100px', resize: 'vertical' }),
        placeholder: 'Describe the feature in detail. What should it do? How should it work?',
        value: description,
        onChange: function(e) { setDescription(e.target.value.slice(0, 1000)); },
        maxLength: 1000
      }),
      React.createElement('div', {
        style: { textAlign: 'right', fontSize: '11px', color: '#555', marginTop: '2px' }
      }, description.length + '/1000'),

      // Use case textarea
      React.createElement('label', { style: Object.assign({}, labelStyle, { marginTop: '14px' }) }, 'Use Case (Optional)'),
      React.createElement('textarea', {
        style: Object.assign({}, inputStyle, { minHeight: '70px', resize: 'vertical' }),
        placeholder: 'Why do you want this? How would it improve your experience?',
        value: useCase,
        onChange: function(e) { setUseCase(e.target.value.slice(0, 500)); },
        maxLength: 500
      }),
      React.createElement('div', {
        style: { textAlign: 'right', fontSize: '11px', color: '#555', marginTop: '2px' }
      }, useCase.length + '/500'),

      // Submit button
      React.createElement('button', {
        style: {
          width: '100%', padding: '12px', marginTop: '16px',
          background: !title.trim() || !category || submitting ? '#555' : '#57f287',
          border: 'none', borderRadius: '4px', color: !title.trim() || !category || submitting ? '#999' : '#000',
          fontSize: '14px', fontWeight: 600,
          cursor: !title.trim() || !category || submitting ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit', transition: 'background 0.15s'
        },
        disabled: !title.trim() || !category || submitting,
        onClick: handleSubmit
      }, submitting ? 'Submitting...' : 'Submit Feature Request'),

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
