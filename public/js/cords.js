// ===================== VIDEOS TAB (removed) =====================

// ===================== CORDS TAB (social feed) =====================

function cordTimeAgo(ts) {
  var diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function cordTimeUntilExpiry(expiresAt) {
  if (!expiresAt) return '';
  var diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return 'expired';
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm';
  var hrs = Math.floor(mins / 60);
  var remainMins = mins % 60;
  if (hrs < 24) return hrs + 'h ' + remainMins + 'm';
  var days = Math.floor(hrs / 24);
  return days + 'd ' + (hrs % 24) + 'h';
}

function renderCordContent(content, censorFn) {
  if (!content) return null;
  // Match image URLs (imgur, giphy, tenor, direct image links)
  var imageUrlRegex = /(https?:\/\/(?:i\.)?imgur\.com\/[a-zA-Z0-9]+(?:\.[a-zA-Z]{3,4})?|https?:\/\/media[0-9]?\.tenor\.com\/[^\s]+|https?:\/\/media[0-9]?\.giphy\.com\/[^\s]+|https?:\/\/[^\s]+\.(?:gif|png|jpg|jpeg|webp)(?:\?[^\s]*)?)/gi;
  var parts = [];
  var lastIndex = 0;
  var match;
  var keyIdx = 0;
  var _censor = typeof censorFn === 'function' ? censorFn : function(t) { return t; };

  while ((match = imageUrlRegex.exec(content)) !== null) {
    // Add text before the URL (censored)
    if (match.index > lastIndex) {
      parts.push(_censor(content.slice(lastIndex, match.index)));
    }
    var url = match[0];
    // Convert imgur page URLs to direct image links
    if (url.match(/imgur\.com\/[a-zA-Z0-9]+$/) && !url.match(/\.[a-zA-Z]{3,4}$/)) {
      url = url.replace('imgur.com/', 'i.imgur.com/') + '.png';
    }
    parts.push(React.createElement('img', {
      key: 'img-' + keyIdx++,
      src: url,
      style: {
        maxWidth: '100%', maxHeight: '300px', borderRadius: '8px',
        display: 'block', marginTop: '6px', marginBottom: '4px',
        cursor: 'pointer'
      },
      alt: 'Image',
      loading: 'lazy',
      onClick: function() { window.open(url, '_blank'); },
      onError: function(e) { e.target.style.display = 'none'; }
    }));
    lastIndex = match.index + match[0].length;
  }
  // Add remaining text (censored)
  if (lastIndex < content.length) {
    parts.push(_censor(content.slice(lastIndex)));
  }
  // If no images found, just return censored plain text
  if (parts.length === 0) return _censor(content);
  return parts;
}

function CordsTab() {
  var ctx = useSocket();
  var isMobile = useIsMobile();
  var [cords, setCords] = useState([]);
  var [newCordText, setNewCordText] = useState('');
  var [imageUrl, setImageUrl] = useState('');
  var [expandedCord, setExpandedCord] = useState(null);
  var [replyText, setReplyText] = useState('');
  var [replyImageUrl, setReplyImageUrl] = useState('');
  var [posting, setPosting] = useState(false);
  var [showCordGifPicker, setShowCordGifPicker] = useState(false);
  var [showReplyGifPicker, setShowReplyGifPicker] = useState(false);
  var viewedCordsRef = useRef(new Set());
  var [userMenu, setUserMenu] = useState(null);

  function openUserMenu(e, username, tag, color) {
    e.stopPropagation();
    setUserMenu({ username: username, tag: tag, color: color, x: e.clientX, y: e.clientY });
  }

  function trackView(cordId) {
    if (!ctx.socket || viewedCordsRef.current.has(cordId)) return;
    viewedCordsRef.current.add(cordId);
    ctx.socket.emit('cord_view', { cordId: cordId });
  }

  useEffect(function() {
    if (!ctx.socket) return;

    function onFeedData(data) {
      if (data && Array.isArray(data.cords)) {
        setCords(data.cords);
      }
    }
    function onNewCord(cord) {
      if (cord) {
        setCords(function(prev) { return [cord].concat(prev); });
      }
    }
    function onCordLiked(data) {
      if (!data || !data.cordId) return;
      setCords(function(prev) {
        return prev.map(function(c) {
          if (c.id === data.cordId) return Object.assign({}, c, { likes: data.likes });
          return c;
        });
      });
    }
    function onReplyAdded(data) {
      if (!data || !data.cordId || !data.reply) return;
      setCords(function(prev) {
        return prev.map(function(c) {
          if (c.id === data.cordId) {
            var newReplies = (c.replies || []).concat([data.reply]);
            return Object.assign({}, c, { replies: newReplies });
          }
          return c;
        });
      });
    }
    function onCordDeleted(data) {
      if (!data || !data.cordId) return;
      setCords(function(prev) {
        return prev.filter(function(c) { return c.id !== data.cordId; });
      });
    }

    ctx.socket.on('cord_feed_data', onFeedData);
    ctx.socket.on('cord_new', onNewCord);
    ctx.socket.on('cord_liked', onCordLiked);
    ctx.socket.on('cord_reply_added', onReplyAdded);
    ctx.socket.on('cord_deleted', onCordDeleted);

    ctx.socket.emit('cord_feed', { page: 0 });

    return function() {
      ctx.socket.off('cord_feed_data', onFeedData);
      ctx.socket.off('cord_new', onNewCord);
      ctx.socket.off('cord_liked', onCordLiked);
      ctx.socket.off('cord_reply_added', onReplyAdded);
      ctx.socket.off('cord_deleted', onCordDeleted);
    };
  }, [ctx.socket]);

  function handlePost() {
    var text = newCordText.trim();
    var img = imageUrl.trim();
    if ((!text && !img) || !ctx.socket || posting) return;
    setPosting(true);
    ctx.socket.emit('cord_post', { content: text || ' ', imageUrl: img || null });
    setNewCordText('');
    setImageUrl('');
    setTimeout(function() { setPosting(false); }, 500);
  }

  function handleLike(cordId) {
    if (!ctx.socket) return;
    ctx.socket.emit('cord_like', { cordId: cordId });
  }

  function handleReply(cordId) {
    var text = replyText.trim();
    var rImg = replyImageUrl.trim();
    if ((!text && !rImg) || !ctx.socket) return;
    ctx.socket.emit('cord_reply', { cordId: cordId, content: text || ' ', imageUrl: rImg || null });
    setReplyText('');
    setReplyImageUrl('');
    setShowReplyGifPicker(false);
  }

  function handleDelete(cordId) {
    if (!ctx.socket) return;
    ctx.socket.emit('cord_delete', { cordId: cordId });
  }

  function toggleExpand(cordId) {
    if (expandedCord === cordId) {
      setExpandedCord(null);
      setReplyText('');
      setReplyImageUrl('');
      setShowReplyGifPicker(false);
    } else {
      setExpandedCord(cordId);
      setReplyText('');
      setReplyImageUrl('');
      setShowReplyGifPicker(false);
    }
  }

  var userName = ctx.user ? ctx.user.name : '';
  var cordIsMod = ctx.user && ctx.user.isMod;
  var charsLeft = 1500 - newCordText.length;

  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e',
      overflow: 'hidden'
    }
  },
    // Composer box
    React.createElement('div', {
      style: {
        padding: isMobile ? '12px' : '16px 20px', background: '#252528',
        borderBottom: '1px solid #18181b', flexShrink: 0
      }
    },
      React.createElement('div', {
        style: { fontSize: '14px', fontWeight: 600, color: '#e8e6e3', marginBottom: '8px' }
      }, 'New Cord'),
      React.createElement('textarea', {
        style: {
          width: '100%', minHeight: '60px', maxHeight: '120px', padding: '10px 12px',
          background: '#18181b', border: 'none', borderRadius: '6px',
          color: '#dcddde', fontSize: '14px', fontFamily: 'inherit',
          outline: 'none', resize: 'vertical'
        },
        placeholder: 'What\'s happening?',
        value: newCordText,
        maxLength: 1500,
        onChange: function(e) { setNewCordText(e.target.value.replace(/[^a-zA-Z0-9 _\-!?,.'":;\n@#&()]/g, '')); },
        onKeyDown: function(e) {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); }
        }
      }),
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }
      },
        React.createElement('span', { style: { fontSize: '16px', flexShrink: 0 } }, '\uD83D\uDDBC\uFE0F'),
        React.createElement('input', {
          style: {
            flex: 1, padding: '6px 10px', background: '#18181b', border: '1px solid #333',
            borderRadius: '6px', color: '#dcddde', fontSize: '12px', fontFamily: 'inherit', outline: 'none'
          },
          placeholder: 'Image/GIF URL (imgur, tenor, giphy)',
          value: imageUrl,
          onChange: function(e) { setImageUrl(e.target.value.replace(/[^a-zA-Z0-9:\/._\-?&=%+~#]/g, '')); }
        }),
        React.createElement('button', {
          style: {
            background: 'none', border: 'none', color: showCordGifPicker ? '#f0b232' : '#b5bac1',
            cursor: 'pointer', fontSize: '18px', padding: '2px 6px', flexShrink: 0
          },
          title: 'Pick a GIF',
          onClick: function() { setShowCordGifPicker(!showCordGifPicker); }
        }, 'GIF'),
        imageUrl.trim() ? React.createElement('button', {
          style: {
            background: 'none', border: 'none', color: '#ed4245', cursor: 'pointer',
            fontSize: '14px', padding: '2px 6px'
          },
          onClick: function() { setImageUrl(''); }
        }, '\u2715') : null
      ),
      // GIF picker for cord composer
      showCordGifPicker ? React.createElement('div', {
        style: { position: 'relative', marginTop: '4px' }
      },
        React.createElement(GifPicker, {
          onSelect: function(gifUrl) {
            setImageUrl(gifUrl);
            setShowCordGifPicker(false);
          },
          onClose: function() { setShowCordGifPicker(false); }
        })
      ) : null,
      // Image preview
      imageUrl.trim()
        ? React.createElement('img', {
            src: imageUrl.trim().replace(/\.gifv$/i, '.gif'),
            style: { maxWidth: '200px', maxHeight: '120px', borderRadius: '6px', marginTop: '6px', objectFit: 'cover' },
            onError: function(e) { e.target.style.display = 'none'; }
          })
        : null,
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: '8px'
        }
      },
        React.createElement('span', {
          style: {
            fontSize: '12px',
            color: charsLeft < 20 ? (charsLeft < 0 ? '#ed4245' : '#f0b232') : '#949ba4'
          }
        }, charsLeft + ' characters left'),
        React.createElement('button', {
          style: {
            padding: '6px 20px', background: posting || (!newCordText.trim() && !imageUrl.trim()) ? '#5a4a1a' : '#f0b232',
            border: 'none', borderRadius: '20px', color: '#1c1c1e',
            fontSize: '13px', fontWeight: 600, cursor: posting || (!newCordText.trim() && !imageUrl.trim()) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', opacity: posting || (!newCordText.trim() && !imageUrl.trim()) ? 0.6 : 1
          },
          onClick: handlePost,
          disabled: posting || (!newCordText.trim() && !imageUrl.trim())
        }, posting ? 'Posting...' : 'Post')
      )
    ),

    // Feed
    React.createElement('div', {
      style: {
        flex: 1, overflowY: 'auto', padding: isMobile ? '8px' : '12px 20px',
        WebkitOverflowScrolling: 'touch'
      }
    },
      cords.length === 0 ? React.createElement('div', {
        style: { textAlign: 'center', color: '#949ba4', marginTop: '40px', fontSize: '14px' }
      }, 'No cords yet. Be the first to post!') : null,

      cords.map(function(cord) {
        var isExpanded = expandedCord === cord.id;
        var replies = cord.replies || [];
        var isOwn = cord.authorName === userName;
        var createdTs = typeof cord.createdAt === 'number' ? cord.createdAt : new Date(cord.createdAt).getTime();

        return React.createElement('div', {
          key: cord.id,
          ref: function(el) { if (el) trackView(cord.id); },
          style: {
            background: '#252528', borderRadius: '8px', marginBottom: '10px',
            borderLeft: '3px solid #f0b232', padding: '12px 14px',
            animation: 'fadeIn 0.2s ease'
          }
        },
          // Header: author + time
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }
          },
            cord.authorAvatar
              ? React.createElement('img', {
                  src: cord.authorAvatar,
                  style: {
                    width: '20px', height: '20px', borderRadius: '50%',
                    objectFit: 'cover', flexShrink: 0
                  }
                })
              : React.createElement('div', {
                  style: {
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: cord.authorColor || '#f0b232', flexShrink: 0
                  }
                }),
            React.createElement('span', {
              style: { fontWeight: 600, fontSize: '14px', color: '#e8e6e3', cursor: 'pointer' },
              onClick: function(e) { openUserMenu(e, cord.authorName || 'Anonymous', cord.authorTag || '????', cord.authorColor || '#e8e6e3'); }
            }, cord.authorName || 'Anonymous'),
            React.createElement('span', {
              style: { fontSize: '11px', color: '#666', marginLeft: '2px', fontFamily: 'monospace' }
            }, '#' + (cord.authorTag || '????')),
            cord.hasAccount ? React.createElement('span', {
              style: { fontSize: '12px', color: '#f0b232' },
              title: 'Verified account'
            }, '\uD83D\uDD11') : null,
            cord.isMod ? React.createElement('span', {
              style: {
                fontSize: '9px', fontWeight: 700, color: '#fff',
                background: '#e74c3c', borderRadius: '3px',
                padding: '1px 5px', marginLeft: '2px', letterSpacing: '0.5px',
                textTransform: 'uppercase'
              },
              title: 'Moderator'
            }, 'MOD') : null,
            React.createElement('span', {
              style: { fontSize: '11px', color: '#949ba4', marginLeft: 'auto' }
            }, cordTimeAgo(createdTs))
          ),

          // Content
          React.createElement('div', {
            style: {
              fontSize: '14px', color: '#dcddde', lineHeight: '1.5',
              marginBottom: '8px', wordBreak: 'break-word', whiteSpace: 'pre-wrap'
            }
          }, renderCordContent(cord.content, ctx.censorText)),

          // Image
          cord.imageUrl ? React.createElement('img', {
            src: cord.imageUrl.replace(/\.gifv$/i, '.gif'),
            style: {
              maxWidth: '100%', maxHeight: '400px', borderRadius: '8px',
              marginBottom: '8px', cursor: 'pointer', objectFit: 'contain'
            },
            onClick: function() { window.open(cord.imageUrl, '_blank'); },
            onError: function(e) { e.target.style.display = 'none'; }
          }) : null,

          // Expires indicator
          cord.expiresAt ? React.createElement('div', {
            style: { fontSize: '11px', color: '#949ba4', marginBottom: '6px', fontStyle: 'italic' }
          }, 'Expires in ' + cordTimeUntilExpiry(cord.expiresAt)) : null,

          // Action bar
          React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: '16px' }
          },
            // Views count
            React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: '4px',
                color: '#949ba4', fontSize: '13px'
              }
            },
              React.createElement('span', null, '\uD83D\uDC41'),
              React.createElement('span', null, cord.views || 0)
            ),
            // Like button
            React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: '4px',
                cursor: 'pointer', color: '#949ba4', fontSize: '13px',
                transition: 'color 0.15s'
              },
              onClick: function() { handleLike(cord.id); },
              onMouseEnter: function(e) { e.currentTarget.style.color = '#ed4245'; },
              onMouseLeave: function(e) { e.currentTarget.style.color = '#949ba4'; }
            },
              React.createElement('span', null, '\u2764'),
              React.createElement('span', null, cord.likes || 0)
            ),

            // Reply button
            React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: '4px',
                cursor: 'pointer', color: isExpanded ? '#f0b232' : '#949ba4', fontSize: '13px',
                transition: 'color 0.15s'
              },
              onClick: function() { toggleExpand(cord.id); },
              onMouseEnter: function(e) { if (expandedCord !== cord.id) e.currentTarget.style.color = '#f0b232'; },
              onMouseLeave: function(e) { if (expandedCord !== cord.id) e.currentTarget.style.color = '#949ba4'; }
            },
              React.createElement('span', null, '\uD83D\uDCAC'),
              React.createElement('span', null, replies.length)
            ),

            // Delete button (for own cords or moderators)
            (isOwn || cordIsMod) ? React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', gap: '4px',
                cursor: 'pointer', color: '#949ba4', fontSize: '13px',
                marginLeft: 'auto', transition: 'color 0.15s'
              },
              onClick: function() { handleDelete(cord.id); },
              onMouseEnter: function(e) { e.currentTarget.style.color = '#ed4245'; },
              onMouseLeave: function(e) { e.currentTarget.style.color = '#949ba4'; }
            },
              React.createElement('span', null, '\uD83D\uDDD1')
            ) : null
          ),

          // Expanded replies section
          isExpanded ? React.createElement('div', {
            style: {
              marginTop: '10px', borderTop: '1px solid #18181b', paddingTop: '10px'
            }
          },
            // Existing replies
            replies.length > 0 ? replies.map(function(reply, idx) {
              var replyTs = typeof reply.createdAt === 'number' ? reply.createdAt : new Date(reply.createdAt).getTime();
              return React.createElement('div', {
                key: reply.id || idx,
                style: {
                  padding: '6px 0', borderBottom: idx < replies.length - 1 ? '1px solid #1c1c1e' : 'none',
                  display: 'flex', flexDirection: 'column', gap: '2px'
                }
              },
                React.createElement('div', {
                  style: { display: 'flex', alignItems: 'center', gap: '6px' }
                },
                  React.createElement('span', {
                    style: { fontWeight: 600, fontSize: '12px', color: reply.authorColor || '#e8e6e3', cursor: 'pointer' },
                    onClick: function(e) { openUserMenu(e, reply.authorName || 'Anonymous', reply.authorTag || '????', reply.authorColor || '#e8e6e3'); }
                  }, reply.authorName || 'Anonymous'),
                  React.createElement('span', {
                    style: { fontSize: '10px', color: '#666', marginLeft: '2px', fontFamily: 'monospace' }
                  }, '#' + (reply.authorTag || '????')),
                  React.createElement('span', {
                    style: { fontSize: '11px', color: '#949ba4' }
                  }, cordTimeAgo(replyTs))
                ),
                React.createElement('div', {
                  style: { fontSize: '13px', color: '#dcddde', wordBreak: 'break-word' }
                }, ctx.censorText(reply.content)),
                reply.imageUrl ? React.createElement('img', {
                  src: reply.imageUrl,
                  style: {
                    maxWidth: '100%', maxHeight: '200px', borderRadius: '6px',
                    marginTop: '4px', objectFit: 'contain', cursor: 'pointer'
                  },
                  onClick: function() { window.open(reply.imageUrl, '_blank'); },
                  onError: function(e) { e.target.style.display = 'none'; }
                }) : null
              );
            }) : React.createElement('div', {
              style: { fontSize: '12px', color: '#949ba4', marginBottom: '8px' }
            }, 'No replies yet.'),

            // Reply GIF preview
            replyImageUrl.trim() ? React.createElement('div', {
              style: { marginTop: '6px', position: 'relative', display: 'inline-block' }
            },
              React.createElement('img', {
                src: replyImageUrl.trim(),
                style: { maxWidth: '150px', maxHeight: '100px', borderRadius: '6px', objectFit: 'cover' },
                onError: function(e) { e.target.style.display = 'none'; }
              }),
              React.createElement('button', {
                style: {
                  position: 'absolute', top: '-4px', right: '-4px', background: '#ed4245',
                  border: 'none', borderRadius: '50%', color: '#fff', width: '18px', height: '18px',
                  fontSize: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                },
                onClick: function() { setReplyImageUrl(''); }
              }, '\u2715')
            ) : null,

            // Reply input
            React.createElement('div', {
              style: { display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }
            },
              React.createElement('input', {
                type: 'text',
                style: {
                  flex: 1, padding: '6px 10px', background: '#18181b',
                  border: 'none', borderRadius: '4px', color: '#dcddde',
                  fontSize: '13px', fontFamily: 'inherit', outline: 'none',
                  minHeight: '32px'
                },
                placeholder: 'Write a reply...',
                value: replyText,
                maxLength: 280,
                onChange: function(e) { setReplyText(e.target.value.replace(/[^a-zA-Z0-9 _\-!?,.'":;\n@#&()]/g, '')); },
                onKeyDown: function(e) {
                  if (e.key === 'Enter') { handleReply(cord.id); }
                }
              }),
              React.createElement('button', {
                style: {
                  background: 'none', border: 'none', color: showReplyGifPicker ? '#f0b232' : '#b5bac1',
                  cursor: 'pointer', fontSize: '13px', fontWeight: 700, padding: '4px 6px', flexShrink: 0
                },
                title: 'Pick a GIF',
                onClick: function() { setShowReplyGifPicker(!showReplyGifPicker); }
              }, 'GIF'),
              React.createElement('button', {
                style: {
                  padding: '6px 14px', background: (replyText.trim() || replyImageUrl.trim()) ? '#f0b232' : '#5a4a1a',
                  border: 'none', borderRadius: '4px', color: '#1c1c1e',
                  fontSize: '12px', fontWeight: 600, cursor: (replyText.trim() || replyImageUrl.trim()) ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit', opacity: (replyText.trim() || replyImageUrl.trim()) ? 1 : 0.6
                },
                onClick: function() { handleReply(cord.id); },
                disabled: !(replyText.trim() || replyImageUrl.trim())
              }, 'Send')
            ),

            // Reply GIF picker
            showReplyGifPicker ? React.createElement('div', {
              style: { position: 'relative', marginTop: '4px' }
            },
              React.createElement(GifPicker, {
                onSelect: function(gifUrl) {
                  setReplyImageUrl(gifUrl);
                  setShowReplyGifPicker(false);
                },
                onClose: function() { setShowReplyGifPicker(false); }
              })
            ) : null
          ) : null
        );
      })
    ),

    // User action menu popup
    userMenu ? React.createElement(UserActionMenu, {
      username: userMenu.username,
      tag: userMenu.tag,
      color: userMenu.color,
      position: { x: userMenu.x, y: userMenu.y },
      onClose: function() { setUserMenu(null); }
    }) : null
  );
}
