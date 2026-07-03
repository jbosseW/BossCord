// handlers/auction.js
// Socket handlers: auction_get_listings, auction_create_listing,
//                  auction_cancel_listing, auction_buy

const crypto = require('crypto');

// Per-account purchase lock to prevent TOCTOU race conditions
const purchaseLocks = new Set();
// Per-listing lock to prevent double-purchase race conditions
const listingLocks = new Set();

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, loot, tcg, auctionHouse, checkEventRate } = deps;

    // ------------------------------------------------------------------
    // Auction House: get listings
    // ------------------------------------------------------------------
    socket.on('auction_get_listings', (data) => {
      try {
        const key = socketAccountMap.get(socket.id);
        const filters = data || {};
        filters.viewerKey = key || null;
        socket.emit('auction_listings', { listings: auctionHouse.getListings(filters) });
      } catch (err) {
        console.error('[auction_get_listings] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Auction House: create listing (sell item or card)
    // ------------------------------------------------------------------
    socket.on('auction_create_listing', (data) => {
      try {
        if (!data || typeof data.instanceId !== 'string' || typeof data.price !== 'number' || typeof data.itemType !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to sell' }); return; }
        if (!checkEventRate(socket, 'auction_list', 10, 60000)) {
          socket.emit('error', { message: 'Listing too fast' }); return;
        }
        var price = Math.floor(data.price);
        if (!isFinite(price) || price < 1 || price > 100000) { socket.emit('error', { message: 'Invalid price (1 - 100,000)' }); return; }
        const acc = accounts.loadAccount(key);
        if (!acc) return;

        let itemInfo = null;
        let removed = null;

        if (data.itemType === 'item') {
          const inv = accounts.getInventory(key);
          const invItem = inv.inventory.find(i => i.id === data.instanceId);
          if (!invItem) { socket.emit('error', { message: 'Item not found in inventory' }); return; }
          const info = loot.getItemInfo(invItem.itemId);
          if (!info) { socket.emit('error', { message: 'Unknown item' }); return; }
          // Remove from inventory before listing
          removed = accounts.removeInventoryItem(key, data.instanceId);
          if (!removed) { socket.emit('error', { message: 'Failed to remove item' }); return; }
          itemInfo = { id: info.id, name: info.name, rarity: info.rarity, type: info.type, img: info.img || null, icon: info.icon || null, text: info.text || null, rarityColor: loot.RARITIES[info.rarity].color, sellValue: loot.getSellValue(invItem.itemId, invItem.modifier), modifier: invItem.modifier || null, modifierInfo: invItem.modifier ? loot.getModifierInfo(invItem.modifier) : null, serial: invItem.serial || null };
        } else if (data.itemType === 'card') {
          const cards = accounts.getCards(key);
          const cardInst = cards.find(c => c.id === data.instanceId);
          if (!cardInst) { socket.emit('error', { message: 'Card not found' }); return; }
          const info = tcg.getCardInfo(cardInst.cardId);
          if (!info) { socket.emit('error', { message: 'Unknown card' }); return; }
          removed = accounts.removeCard(key, data.instanceId);
          if (!removed) { socket.emit('error', { message: 'Failed to remove card' }); return; }
          var cardStats = cardInst.rolledStats || { atk: info.atk, def: info.def, hp: info.hp };
          itemInfo = { id: info.id, name: info.name, rarity: info.rarity, type: info.type, img: info.img, atk: cardStats.atk, def: cardStats.def, hp: cardStats.hp, rarityColor: tcg.RARITIES[info.rarity].color, coinValue: tcg.getCardValue(cardInst.cardId, cardInst.shiny), shiny: cardInst.shiny || false, rolledStats: cardInst.rolledStats || null };
        } else {
          socket.emit('error', { message: 'Invalid item type' }); return;
        }

        const listing = auctionHouse.createListing(key, user.name, user.color, data.itemType, data.instanceId, itemInfo, price);
        if (listing.error) {
          // Re-add item on failure
          if (data.itemType === 'item') {
            accounts.addInventoryItem(key, { instanceId: data.instanceId, itemId: removed.itemId, modifier: removed.modifier, serial: removed.serial, obtainedAt: removed.obtainedAt, source: removed.source });
          } else {
            accounts.addCard(key, { instanceId: data.instanceId, cardId: removed.cardId, rolledStats: removed.rolledStats, shiny: removed.shiny, obtainedAt: removed.obtainedAt, source: removed.source });
          }
          socket.emit('error', { message: listing.error }); return;
        }

        socket.emit('auction_listing_created', listing);
        io.emit('auction_listings_updated');
        console.log(`[auction] ${user.name} listed ${itemInfo.name} for ${price} chips`);
      } catch (err) {
        console.error('[auction_create_listing] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Auction House: cancel listing
    // ------------------------------------------------------------------
    socket.on('auction_cancel_listing', (data) => {
      try {
        if (!data || typeof data.listingId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        const result = auctionHouse.cancelListing(data.listingId, key);
        if (result.error) { socket.emit('error', { message: result.error }); return; }
        // Return item to seller (preserve modifier/serial/rolledStats/shiny)
        const listing = result.listing;
        if (listing.itemType === 'item') {
          accounts.addInventoryItem(key, { instanceId: crypto.randomBytes(6).toString('hex'), itemId: listing.itemInfo.id, modifier: listing.itemInfo.modifier || null, serial: listing.itemInfo.serial || null, obtainedAt: Date.now(), source: 'auction_return' });
        } else if (listing.itemType === 'card') {
          accounts.addCard(key, { instanceId: crypto.randomBytes(6).toString('hex'), cardId: listing.itemInfo.id, rolledStats: listing.itemInfo.rolledStats || null, shiny: listing.itemInfo.shiny || false, obtainedAt: Date.now(), source: 'auction_return' });
        }
        socket.emit('auction_listing_cancelled', { listingId: data.listingId });
        io.emit('auction_listings_updated');
      } catch (err) {
        console.error('[auction_cancel_listing] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Auction House: buy listing
    // ------------------------------------------------------------------
    socket.on('auction_buy', (data) => {
      try {
        if (!data || typeof data.listingId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to buy' }); return; }
        if (!checkEventRate(socket, 'auction_buy', 10, 60000)) return; // max 10 buys/min

        // Per-account lock prevents double-spend race condition
        if (purchaseLocks.has(key)) {
          socket.emit('error', { message: 'Transaction in progress' }); return;
        }

        // Per-listing lock prevents two users purchasing the same listing simultaneously
        if (listingLocks.has(data.listingId)) {
          socket.emit('auction_error', { message: 'This listing is being purchased by another user' });
          return;
        }

        purchaseLocks.add(key);
        listingLocks.add(data.listingId);

        try {
        const acc = accounts.loadAccount(key);
        if (!acc) { purchaseLocks.delete(key); listingLocks.delete(data.listingId); return; }

        // Pre-check price before buying
        const listings = auctionHouse.getListings({ viewerKey: key });
        const targetListing = listings.find(l => l.id === data.listingId);
        if (!targetListing) { purchaseLocks.delete(key); listingLocks.delete(data.listingId); socket.emit('error', { message: 'Listing not found' }); return; }
        if (acc.chips < targetListing.price) { purchaseLocks.delete(key); listingLocks.delete(data.listingId); socket.emit('error', { message: 'Not enough chips' }); return; }

        const result = auctionHouse.buyListing(data.listingId, key, acc.chips);
        if (result.error) { purchaseLocks.delete(key); listingLocks.delete(data.listingId); socket.emit('error', { message: result.error }); return; }

        // Deduct from buyer
        accounts.updateChips(key, -result.price);
        // Pay seller (minus fee)
        accounts.updateChips(result.listing.sellerKey, result.sellerProceeds);

        // Give item to buyer (preserve modifier/serial/rolledStats/shiny from listing)
        if (result.listing.itemType === 'item') {
          accounts.addInventoryItem(key, { instanceId: crypto.randomBytes(6).toString('hex'), itemId: result.listing.itemInfo.id, modifier: result.listing.itemInfo.modifier || null, serial: result.listing.itemInfo.serial || null, obtainedAt: Date.now(), source: 'auction_buy' });
        } else if (result.listing.itemType === 'card') {
          accounts.addCard(key, { instanceId: crypto.randomBytes(6).toString('hex'), cardId: result.listing.itemInfo.id, rolledStats: result.listing.itemInfo.rolledStats || null, shiny: result.listing.itemInfo.shiny || false, obtainedAt: Date.now(), source: 'auction_buy' });
        }

        const accAfterBuy = accounts.loadAccount(key);
        const newChips = accAfterBuy ? accAfterBuy.chips : 0;
        socket.emit('auction_buy_success', { listingId: data.listingId, itemInfo: result.listing.itemInfo, price: result.price });
        socket.emit('chips_updated', { chips: newChips, reason: 'Bought ' + result.listing.itemInfo.name + ' -' + result.price });

        // Notify seller if online
        for (const [sid, skey] of socketAccountMap) {
          if (skey === result.listing.sellerKey) {
            const sellerSocket = io.sockets ? (typeof io.sockets.get === 'function' ? io.sockets.get(sid) : (io.sockets.sockets ? io.sockets.sockets.get(sid) : null)) : null;
            if (sellerSocket) {
              const sellerAcc = accounts.loadAccount(result.listing.sellerKey);
              const sellerChips = sellerAcc ? sellerAcc.chips : 0;
              sellerSocket.emit('auction_item_sold', { listingId: data.listingId, buyerName: user.name, price: result.price, proceeds: result.sellerProceeds });
              sellerSocket.emit('chips_updated', { chips: sellerChips, reason: result.listing.itemInfo.name + ' sold! +' + result.sellerProceeds });
            }
            break;
          }
        }

        io.emit('auction_listings_updated');
        console.log(`[auction] ${user.name} bought ${result.listing.itemInfo.name} for ${result.price} chips`);

        } finally {
          purchaseLocks.delete(key);
          listingLocks.delete(data.listingId);
        }
      } catch (err) {
        console.error('[auction_buy] Error:', err.message);
      }
    });
  }
};
