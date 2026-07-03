// handlers/inventory.js
// Socket handlers: inventory_get, item_sell, item_equip, item_unequip,
//                  item_showcase, loot_catalog, portraits_get, avatar_set,
//                  profile_get, profile_set_showcase

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, loot, tcg, state, checkEventRate, enrichInventory, isModerator } = deps;

    // ------------------------------------------------------------------
    // Inventory: get
    // ------------------------------------------------------------------
    socket.on('inventory_get', () => {
      try {
        if (!checkEventRate(socket, 'inventory_get', 30, 60000)) return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('inventory_data', { inventory: [], equipped: { badge: null, title: null } }); return; }
        socket.emit('inventory_data', enrichInventory(key));
      } catch (err) {
        console.error('[inventory_get] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Item: sell
    // ------------------------------------------------------------------
    socket.on('item_sell', (data) => {
      try {
        if (!data || typeof data.instanceId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        if (!checkEventRate(socket, 'item_sell', 60, 60000)) return; // max 60/min
        const inv = accounts.getInventory(key);
        const invItem = inv.inventory.find(i => i.id === data.instanceId);
        if (!invItem) { socket.emit('error', { message: 'Item not found' }); return; }
        const sellValue = loot.getSellValue(invItem.itemId, invItem.modifier);
        const removed = accounts.removeInventoryItem(key, data.instanceId);
        if (!removed) { socket.emit('error', { message: 'Failed to sell item' }); return; }
        const newChips = accounts.updateChips(key, sellValue);
        if (newChips === null) { socket.emit('error', { message: 'Account error' }); return; }
        const info = loot.getItemInfo(invItem.itemId);
        const modName = invItem.modifier ? (loot.getModifierInfo(invItem.modifier) || {}).name : null;
        const displayName = (modName ? modName + ' ' : '') + (info ? info.name : 'Item');
        socket.emit('item_sold', { instanceId: data.instanceId, sellValue: sellValue, itemName: displayName });
        socket.emit('chips_updated', { chips: newChips, reason: 'Sold ' + displayName + ' +' + sellValue });
        // Send updated inventory (enriched)
        socket.emit('inventory_data', enrichInventory(key));
      } catch (err) {
        console.error('[item_sell] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Item: equip
    // ------------------------------------------------------------------
    socket.on('item_equip', (data) => {
      try {
        if (!checkEventRate(socket, 'item_equip', 30, 60000)) return;
        if (!data || typeof data.instanceId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        const equipped = accounts.equipItem(key, data.instanceId);
        if (!equipped) { socket.emit('error', { message: 'Cannot equip this item' }); return; }
        socket.emit('equipped_updated', equipped);
      } catch (err) {
        console.error('[item_equip] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Item: unequip
    // ------------------------------------------------------------------
    socket.on('item_unequip', (data) => {
      try {
        if (!checkEventRate(socket, 'item_unequip', 30, 60000)) return;
        if (!data || typeof data.type !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        const equipped = accounts.unequipItem(key, data.type);
        if (!equipped) return;
        socket.emit('equipped_updated', equipped);
      } catch (err) {
        console.error('[item_unequip] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Profile: get (own or another user's public profile)
    // ------------------------------------------------------------------
    socket.on('profile_get', (data) => {
      try {
        if (!checkEventRate(socket, 'profile_get', 30, 60000)) return;
        var myKey = socketAccountMap.get(socket.id);
        const targetKey = (data && data.key) || myKey;
        if (!targetKey) {
          // Anonymous user — return basic profile from in-memory user object
          socket.emit('profile_data', {
            username: user.name || 'Anonymous',
            color: user.color || '#dcddde',
            chips: 1000,
            stats: {},
            equipped: { badge: null, title: null },
            inventory: [],
            cards: [],
            showcase: [],
            avatar: user.avatar || null,
            avatarId: null,
            isOwn: !(data && data.key),
          });
          return;
        }
        const acc = accounts.loadAccount(targetKey);
        if (!acc) { socket.emit('profile_data', null); return; }

        var isOwnProfile = !data || !data.key || data.key === myKey;

        // For other users' profiles, return limited public data only
        if (!isOwnProfile) {
          socket.emit('profile_data', {
            username: acc.username,
            color: acc.color,
            name: acc.name || acc.username || 'Anonymous',
            tag: acc.tag,
            badges: acc.badges || [],
            title: acc.title || null,
            showcase: accounts.getShowcase(targetKey),
            stats: { gamesPlayed: (acc.stats || {}).gamesPlayed || 0 },
            avatar: acc.avatar || null,
            avatarId: acc.avatarId || null,
            isOwn: false,
          });
          return;
        }

        const inv = enrichInventory(targetKey);
        // Enrich cards
        const cards = accounts.getCards(targetKey);
        const enrichedCards = cards.map(function(c) {
          const cinfo = tcg.getCardInfo(c.cardId);
          var cstats = c.rolledStats || (cinfo ? { atk: cinfo.atk, def: cinfo.def, hp: cinfo.hp } : {});
          return {
            id: c.id, cardId: c.cardId, obtainedAt: c.obtainedAt, source: c.source,
            shiny: c.shiny || false,
            rolledStats: c.rolledStats || null,
            card: cinfo ? { id: cinfo.id, name: cinfo.name, rarity: cinfo.rarity, type: cinfo.type, atk: cstats.atk, def: cstats.def, hp: cstats.hp, baseAtk: cinfo.atk, baseDef: cinfo.def, baseHp: cinfo.hp, img: cinfo.img, coinValue: tcg.getCardValue(c.cardId, c.shiny), rarityColor: tcg.RARITIES[cinfo.rarity].color } : null,
          };
        });
        socket.emit('profile_data', {
          username: acc.username,
          color: acc.color,
          chips: acc.chips,
          stats: acc.stats || {},
          createdAt: acc.createdAt,
          equipped: inv.equipped,
          inventory: inv.inventory,
          cards: enrichedCards,
          showcase: accounts.getShowcase(targetKey),
          avatar: acc.avatar || null,
          avatarId: acc.avatarId || null,
          isOwn: true,
        });
      } catch (err) {
        console.error('[profile_get] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Loot: get catalog (for UI display)
    // ------------------------------------------------------------------
    socket.on('loot_catalog', () => {
      try {
        if (!checkEventRate(socket, 'loot_catalog', 10, 60000)) return;
        socket.emit('loot_catalog_data', {
          items: loot.getFullCatalog(),
          lootboxTiers: loot.LOOTBOX_TIERS,
          scratchTiers: loot.SCRATCH_TIERS,
          rarities: loot.RARITIES,
        });
      } catch (err) {
        console.error('[loot_catalog] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Profile portraits: get available list
    // ------------------------------------------------------------------
    socket.on('portraits_get', () => {
      try {
        if (!checkEventRate(socket, 'portraits_get', 10, 60000)) return;
        socket.emit('portraits_list', { portraits: loot.PROFILE_PORTRAITS });
      } catch (err) {
        console.error('[portraits_get] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Profile avatar: set
    // ------------------------------------------------------------------
    socket.on('avatar_set', (data) => {
      try {
        if (!data || typeof data.portraitId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to set avatar' }); return; }
        if (!checkEventRate(socket, 'avatar_set', 5, 60000)) return; // max 5/min
        const portrait = loot.PROFILE_PORTRAITS.find(p => p.id === data.portraitId);
        if (!portrait) { socket.emit('error', { message: 'Invalid portrait' }); return; }
        const acc = accounts.loadAccount(key);
        if (!acc) return;
        acc.avatar = portrait.img;
        acc.avatarId = portrait.id;
        accounts.saveAccount(acc);
        user.avatar = portrait.img;
        socket.emit('avatar_updated', { avatar: portrait.img, avatarId: portrait.id });
      } catch (err) {
        console.error('[avatar_set] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Item: showcase in chat (show off an item to a room)
    // ------------------------------------------------------------------
    socket.on('item_showcase', (data) => {
      try {
        if (!data || typeof data.instanceId !== 'string' || typeof data.roomCode !== 'string' || typeof data.channelId !== 'string') return;
        if (!checkEventRate(socket, 'item_showcase', 5, 60000)) {
          socket.emit('error', { message: 'Showcasing too fast' });
          return;
        }
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        // Verify room membership before broadcasting
        const currentUser = state.users.get(socket.id);
        if (!currentUser || !currentUser.roomIds.has(data.roomCode)) return;
        const inv = accounts.getInventory(key);
        const invItem = inv.inventory.find(i => i.id === data.instanceId);
        if (!invItem) return;
        const info = loot.getItemInfo(invItem.itemId);
        if (!info) return;
        // Send as a special system message to the channel
        const showcaseMsg = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          userId: socket.id,
          userName: user.name,
          userColor: user.color,
          userTag: user.tag,
          content: '',
          type: 'showcase',
          showcase: {
            itemId: info.id, name: info.name, type: info.type, rarity: info.rarity,
            icon: info.icon || null, text: info.text || null,
            rarityColor: loot.RARITIES[info.rarity].color,
            rarityName: loot.RARITIES[info.rarity].name,
          },
          timestamp: Date.now(),
        };
        io.to(data.channelId).emit('new_message', {
          roomCode: data.roomCode,
          channelId: data.channelId,
          message: showcaseMsg,
        });
      } catch (err) {
        console.error('[item_showcase] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Showcase: set favorite items to display on profile
    // ------------------------------------------------------------------
    socket.on('profile_set_showcase', (data) => {
      try {
        if (!data || !Array.isArray(data.showcase) || data.showcase.length > 8) return;
        // Validate each item is a string instanceId
        var validShowcase = data.showcase.filter(function(s) { return typeof s === 'string' && s.length < 50; }).slice(0, 8);
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account' }); return; }
        const showcase = accounts.setShowcase(key, validShowcase);
        socket.emit('showcase_updated', { showcase });
      } catch (err) {
        console.error('[profile_set_showcase] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Special Crate: open with a key item
    // ------------------------------------------------------------------
    socket.on('special_crate_open', (data) => {
      try {
        if (!data || typeof data.tier !== 'string') return;
        if (data.tier.length > 30) return;
        if (!checkEventRate(socket, 'special_crate_open', 10, 60000)) return;

        var crateInfo = loot.SPECIAL_CRATES[data.tier];
        if (!crateInfo) {
          socket.emit('error', { message: 'Invalid special crate tier' });
          return;
        }

        const key = socketAccountMap.get(socket.id);
        if (!key) {
          socket.emit('error', { message: 'Need an account to open special crates' });
          return;
        }

        // Find a matching key in inventory
        const inv = accounts.getInventory(key);
        if (!inv || !inv.inventory) {
          socket.emit('error', { message: 'Inventory not found' });
          return;
        }

        var keyInstance = null;
        for (var i = 0; i < inv.inventory.length; i++) {
          if (inv.inventory[i].itemId === crateInfo.keyRequired) {
            keyInstance = inv.inventory[i];
            break;
          }
        }

        if (!keyInstance) {
          var keyInfo = loot.KEY_ITEM_MAP[crateInfo.keyRequired];
          var keyName = keyInfo ? keyInfo.name : crateInfo.keyRequired;
          socket.emit('error', { message: 'You need a ' + keyName + ' to open this crate' });
          return;
        }

        // Remove the key from inventory
        var removed = accounts.removeInventoryItem(key, keyInstance.id);
        if (!removed) {
          socket.emit('error', { message: 'Failed to consume key' });
          return;
        }

        // Open the special crate
        var result = loot.openSpecialCrate(data.tier);
        if (!result) {
          // Refund key on failure — re-add the removed key item
          accounts.addInventoryItem(key, {
            instanceId: keyInstance.id,
            itemId: keyInstance.itemId,
            modifier: keyInstance.modifier,
            serial: keyInstance.serial,
            obtainedAt: keyInstance.obtainedAt,
            source: keyInstance.source,
          });
          socket.emit('error', { message: 'Failed to open crate' });
          return;
        }

        // Add all loot items to inventory
        for (var j = 0; j < result.items.length; j++) {
          var addResult = accounts.addInventoryItem(key, result.items[j]);
          if (addResult && addResult.error) {
            socket.emit('error', { message: addResult.error });
            break;
          }
        }

        socket.emit('special_crate_result', result);
        // Send updated inventory
        socket.emit('inventory_data', enrichInventory(key));
      } catch (err) {
        console.error('[special_crate_open] Error:', err.message);
      }
    });
  }
};
