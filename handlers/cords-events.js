// handlers/cords-events.js
// Socket handlers: cord_feed, cord_post, cord_like, cord_reply, cord_delete, cord_view

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, cords, checkEventRate, sanitizeText, validateUrl, isModerator, cordViewDedup, CORD_VIEW_DEDUP_MS } = deps;

    // Helper: validate and sanitize an image URL (http/https only, bounded length)
    function _sanitizeImageUrl(url) {
      if (!url || typeof url !== 'string') return null;
      var trimmedUrl = url.trim();
      // Only allow http/https URLs, with a reasonable length cap
      if (/^https?:\/\/.+/i.test(trimmedUrl) && trimmedUrl.length < 500) {
        return trimmedUrl;
      }
      return null;
    }

    // ------------------------------------------------------------------
    // Cords: get feed
    // ------------------------------------------------------------------
    socket.on('cord_feed', (data) => {
      try {
        if (!checkEventRate(socket, 'cord_feed', 30, 60000)) return;
        const page = (data && data.page) || 0;
        const feed = cords.getFeed(page, 20);
        socket.emit('cord_feed_data', feed);
      } catch (err) {
        console.error('[cord_feed] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Cords: post new cord
    // ------------------------------------------------------------------
    socket.on('cord_post', (data) => {
      try {
        if (!data || typeof data.content !== 'string') return;
        // Rate limit: max 10 cords per hour per socket
        if (!checkEventRate(socket, 'cord_post', 10, 3600000)) {
          socket.emit('error', { message: 'Posting too fast. Try again later.' });
          return;
        }
        const key = socketAccountMap.get(socket.id);
        var imageUrl = _sanitizeImageUrl(data.imageUrl);
        // If content is a validated image URL (e.g. Tenor GIF), preserve it as-is;
        // sanitizeText HTML-encodes '&' which corrupts URL query parameters.
        var validatedCordUrl = validateUrl(data.content.trim());
        var cordContent = validatedCordUrl ? validatedCordUrl : sanitizeText(data.content);
        const cord = cords.createCord(socket.id, user.name, user.color, cordContent, key, user.tag, imageUrl, user.avatar || null);
        if (!cord) {
          socket.emit('error', { message: 'Failed to post cord' });
          return;
        }
        if (cord.error) {
          socket.emit('error', { message: cord.error });
          return;
        }
        // Update account stats
        if (key) accounts.updateStats(key, { cordsPosted: 1 });
        // Tag mod cords
        if (isModerator(socket.id)) cord.isMod = true;
        // Broadcast to all connected users (public shape only — never leak accountKey/authorId)
        io.emit('cord_new', cords.publicCordShape(cord));
        console.log(`[cords] ${user.name} posted a cord`);
      } catch (err) {
        console.error('[cord_post] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Cords: like/unlike
    // ------------------------------------------------------------------
    socket.on('cord_like', (data) => {
      try {
        if (!data || !data.cordId) return;
        if (!checkEventRate(socket, 'cord_like', 30, 60000)) return; // max 30 likes/min
        const key = socketAccountMap.get(socket.id);
        const identifier = key || socket.id;
        const result = cords.likeCord(data.cordId, identifier);
        if (!result) return;
        io.emit('cord_liked', { cordId: data.cordId, likes: result.likes });
      } catch (err) {
        console.error('[cord_like] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Cords: reply
    // ------------------------------------------------------------------
    socket.on('cord_reply', (data) => {
      try {
        if (!data || !data.cordId || typeof data.content !== 'string') return;
        if (!checkEventRate(socket, 'cord_reply', 15, 60000)) return; // max 15 replies/min
        const key = socketAccountMap.get(socket.id);
        var replyImageUrl = _sanitizeImageUrl(data.imageUrl);
        // Preserve validated image URLs from HTML encoding (same fix as cord_post)
        var validatedReplyUrl = validateUrl(data.content.trim());
        var replyContent = validatedReplyUrl ? validatedReplyUrl : sanitizeText(data.content);
        const reply = cords.addReply(data.cordId, socket.id, user.name, user.color, replyContent, key, user.tag, replyImageUrl);
        if (!reply) return;
        if (reply.error) {
          socket.emit('error', { message: reply.error });
          return;
        }
        // Emit public reply shape only — strip authorId (account key or socket ID)
        io.emit('cord_reply_added', { cordId: data.cordId, reply: {
          id: reply.id,
          authorName: reply.authorName,
          authorColor: reply.authorColor,
          authorTag: reply.authorTag || '????',
          content: reply.content,
          imageUrl: reply.imageUrl || null,
          createdAt: reply.createdAt,
        }});
      } catch (err) {
        console.error('[cord_reply] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Cords: delete own cord
    // ------------------------------------------------------------------
    socket.on('cord_delete', (data) => {
      try {
        if (!data || !data.cordId) return;
        if (!checkEventRate(socket, 'cord_delete', 20, 60000)) return;
        const key = socketAccountMap.get(socket.id);
        const identifier = key || socket.id;
        const mod = isModerator(socket.id);
        if (cords.deleteCord(data.cordId, identifier, mod)) {
          io.emit('cord_deleted', { cordId: data.cordId });
          if (mod) console.log('[mod] ' + (user.name || socket.id) + ' deleted cord ' + data.cordId);
        }
      } catch (err) {
        console.error('[cord_delete] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Cords: view tracking
    // ------------------------------------------------------------------
    socket.on('cord_view', (data) => {
      try {
        if (!data || !data.cordId) return;
        if (!checkEventRate(socket, 'cord_view', 60, 60000)) return; // max 60 views/min
        const dedupKey = data.cordId + ':' + socket.id;
        const now = Date.now();
        const lastView = cordViewDedup.get(dedupKey);
        if (lastView && now - lastView < CORD_VIEW_DEDUP_MS) return; // deduped
        if (cordViewDedup.size > 50000) return; // Cap to prevent memory exhaustion
        cordViewDedup.set(dedupKey, now);
        cords.viewCord(data.cordId);
      } catch (err) {
        // View tracking is non-critical, swallow errors
      }
    });
  }
};
