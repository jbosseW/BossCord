// handlers/tcg.js
// Socket handlers: all tcg_* events (pack open, cards get, card sell, catalog,
//                  challenge, accept/decline challenge, set deck, attack, switch,
//                  surrender, trade propose/accept/decline/cancel,
//                  table create/join/leave/ready/list/invite)

const crypto = require('crypto');

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, tcg, tcgBattleManager, tcgTradeManager, tcgTableManager, loot, checkEventRate } = deps;

    // ------------------------------------------------------------------
    // TCG: open card pack
    // ------------------------------------------------------------------
    socket.on('tcg_open_pack', (data) => {
      try {
        if (!data || typeof data.tier !== 'string') return;
        if (data.tier.length > 20) return; // sanity check
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to open packs' }); return; }
        if (!checkEventRate(socket, 'tcg_open_pack', 20, 60000)) return; // max 20/min
        const packTier = tcg.PACK_TIERS[data.tier];
        if (!packTier) { socket.emit('error', { message: 'Invalid pack tier' }); return; }
        const acc = accounts.loadAccount(key);
        if (!acc || acc.chips < packTier.cost) { socket.emit('error', { message: 'Not enough chips' }); return; }
        accounts.updateChips(key, -packTier.cost);
        const result = tcg.openPack(data.tier);
        if (!result) { accounts.updateChips(key, packTier.cost); socket.emit('error', { message: 'Failed to open pack' }); return; }
        for (const card of result.cards) {
          const addResult = accounts.addCard(key, card);
          if (addResult && addResult.error) {
            socket.emit('error', { message: addResult.error });
            break;
          }
        }
        const accAfterPack = accounts.loadAccount(key);
        const newChips = accAfterPack ? accAfterPack.chips : 0;
        socket.emit('tcg_pack_result', result);
        socket.emit('chips_updated', { chips: newChips, reason: 'Opened ' + packTier.name });
      } catch (err) {
        console.error('[tcg_open_pack] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Special Pack: open a key-gated card pack (uses key from inventory)
    // ------------------------------------------------------------------
    socket.on('special_pack_open', (data) => {
      try {
        if (!data || typeof data.tier !== 'string') return;
        if (data.tier.length > 30) return;
        if (!checkEventRate(socket, 'special_pack_open', 10, 60000)) return;

        var packDef = loot.SPECIAL_PACKS[data.tier];
        if (!packDef) {
          socket.emit('error', { message: 'Invalid special pack tier' });
          return;
        }

        var accKey = socketAccountMap.get(socket.id);
        if (!accKey) {
          socket.emit('error', { message: 'Need an account to open packs' });
          return;
        }

        // Find matching key in inventory
        var inv = accounts.getInventory(accKey);
        if (!inv || !inv.inventory) {
          socket.emit('error', { message: 'Inventory not found' });
          return;
        }

        var keyInstance = null;
        for (var i = 0; i < inv.inventory.length; i++) {
          if (inv.inventory[i].itemId === packDef.keyRequired) {
            keyInstance = inv.inventory[i];
            break;
          }
        }

        if (!keyInstance) {
          var keyInfo = loot.KEY_ITEM_MAP[packDef.keyRequired];
          var keyName = keyInfo ? keyInfo.name : packDef.keyRequired;
          socket.emit('error', { message: 'You need a ' + keyName + ' to open this pack' });
          return;
        }

        // Remove the key from inventory
        var removed = accounts.removeInventoryItem(accKey, keyInstance.id);
        if (!removed) {
          socket.emit('error', { message: 'Failed to consume key' });
          return;
        }

        // Generate the card pack
        var result = tcg.openSpecialPack(data.tier, loot.SPECIAL_PACKS);
        if (!result) {
          // Refund key on failure
          accounts.addInventoryItem(accKey, {
            instanceId: keyInstance.id,
            itemId: keyInstance.itemId,
            modifier: keyInstance.modifier,
            serial: keyInstance.serial,
            obtainedAt: keyInstance.obtainedAt,
            source: keyInstance.source,
          });
          socket.emit('error', { message: 'Failed to open pack' });
          return;
        }

        // Add cards to collection
        for (var j = 0; j < result.cards.length; j++) {
          var addResult = accounts.addCard(accKey, result.cards[j]);
          if (addResult && addResult.error) {
            socket.emit('error', { message: addResult.error });
            break;
          }
        }

        socket.emit('special_pack_result', result);
        // Refresh inventory (key consumed)
        socket.emit('inventory_data', accounts.getInventory(accKey));
      } catch (err) {
        console.error('[special_pack_open] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG: get card collection
    // ------------------------------------------------------------------
    socket.on('tcg_cards_get', () => {
      try {
        if (!checkEventRate(socket, 'tcg_cards_get', 30, 60000)) return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('tcg_cards_data', { cards: [] }); return; }
        const cards = accounts.getCards(key);
        const enriched = cards.map(c => {
          const info = tcg.getCardInfo(c.cardId);
          var stats = c.rolledStats || (info ? { atk: info.atk, def: info.def, hp: info.hp } : {});
          return {
            id: c.id, cardId: c.cardId, obtainedAt: c.obtainedAt, source: c.source,
            shiny: c.shiny || false,
            rolledStats: c.rolledStats || null,
            card: info ? { id: info.id, name: info.name, rarity: info.rarity, type: info.type, atk: stats.atk, def: stats.def, hp: stats.hp, baseAtk: info.atk, baseDef: info.def, baseHp: info.hp, img: info.img, coinValue: tcg.getCardValue(c.cardId, c.shiny), rarityColor: tcg.RARITIES[info.rarity].color } : null,
          };
        });
        socket.emit('tcg_cards_data', { cards: enriched });
      } catch (err) {
        console.error('[tcg_cards_get] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG: sell card
    // ------------------------------------------------------------------
    socket.on('tcg_card_sell', (data) => {
      try {
        if (!data || typeof data.instanceId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        if (!checkEventRate(socket, 'tcg_card_sell', 60, 60000)) return; // max 60/min
        const cards = accounts.getCards(key);
        const cardInst = cards.find(c => c.id === data.instanceId);
        if (!cardInst) { socket.emit('error', { message: 'Card not found' }); return; }
        const sellValue = tcg.getCardValue(cardInst.cardId, cardInst.shiny);
        const removed = accounts.removeCard(key, data.instanceId);
        if (!removed) { socket.emit('error', { message: 'Failed to sell card' }); return; }
        const newChips = accounts.updateChips(key, sellValue);
        if (newChips === null) { socket.emit('error', { message: 'Account error' }); return; }
        const info = tcg.getCardInfo(cardInst.cardId);
        const shinyLabel = cardInst.shiny ? 'Shiny ' : '';
        socket.emit('tcg_card_sold', { instanceId: data.instanceId, sellValue, cardName: shinyLabel + (info ? info.name : 'Card') });
        socket.emit('chips_updated', { chips: newChips, reason: 'Sold ' + shinyLabel + (info ? info.name : 'card') + ' +' + sellValue });
      } catch (err) {
        console.error('[tcg_card_sell] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG: get catalog and type chart
    // ------------------------------------------------------------------
    socket.on('tcg_catalog', () => {
      try {
        if (!checkEventRate(socket, 'tcg_catalog', 10, 60000)) return;
        socket.emit('tcg_catalog_data', {
          cards: tcg.getFullCatalog(),
          packTiers: tcg.PACK_TIERS,
          rarities: tcg.RARITIES,
          typeChart: tcg.TYPE_CHART,
        });
      } catch (err) {
        console.error('[tcg_catalog] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Battle: challenge another player
    // ------------------------------------------------------------------
    socket.on('tcg_challenge', (data) => {
      try {
        if (!data || typeof data.targetId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to battle' }); return; }
        const cards = accounts.getCards(key);
        if (!cards || cards.length < 10) { socket.emit('error', { message: 'Need at least 10 cards to battle' }); return; }
        const result = tcgBattleManager.challenge(socket.id, data.targetId, user.name, user.color);
        if (result.error) { socket.emit('error', { message: result.error }); return; }
        socket.emit('tcg_challenge_sent', { battleId: result.battleId, targetId: data.targetId });
        const targetSocket = io.sockets.sockets.get(data.targetId);
        if (targetSocket) {
          targetSocket.emit('tcg_challenge_received', {
            battleId: result.battleId,
            from: socket.id,
            fromName: user.name,
            fromColor: user.color,
          });
        }
      } catch (err) {
        console.error('[tcg_challenge] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Battle: accept challenge
    // ------------------------------------------------------------------
    socket.on('tcg_accept_challenge', () => {
      try {
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account' }); return; }
        const battle = tcgBattleManager.acceptChallenge(socket.id, user.name, user.color);
        if (!battle) { socket.emit('error', { message: 'Challenge expired or invalid' }); return; }
        for (const [pid] of battle.players) {
          const s = io.sockets.sockets.get(pid);
          if (s) {
            s.join('tcgbattle:' + battle.id);
            s.emit('tcg_battle_started', tcgBattleManager.getBattleState(battle.id, pid));
          }
        }
      } catch (err) {
        console.error('[tcg_accept_challenge] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Battle: decline challenge
    // ------------------------------------------------------------------
    socket.on('tcg_decline_challenge', () => {
      try {
        const challenge = tcgBattleManager.declineChallenge(socket.id);
        if (challenge) {
          const fromSocket = io.sockets.sockets.get(challenge.from);
          if (fromSocket) fromSocket.emit('tcg_challenge_declined', { by: user.name });
        }
      } catch (err) {
        console.error('[tcg_decline_challenge] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Battle: set deck (select cards for battle)
    // ------------------------------------------------------------------
    socket.on('tcg_set_deck', (data) => {
      try {
        if (!data || !Array.isArray(data.deck)) return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        const myCards = accounts.getCards(key);
        // Validate that all selected cards are owned
        const deckCards = [];
        for (const sel of data.deck.slice(0, tcg.MAX_DECK_SIZE)) {
          const owned = myCards.find(c => c.id === sel.instanceId);
          if (!owned) continue;
          const info = tcg.getCardInfo(owned.cardId);
          if (!info) continue;
          var stats = owned.rolledStats || { atk: info.atk, def: info.def, hp: info.hp };
          deckCards.push({
            instanceId: owned.id,
            cardId: owned.cardId,
            card: { id: info.id, name: info.name, rarity: info.rarity, type: info.type, atk: stats.atk, def: stats.def, hp: stats.hp, img: info.img },
          });
        }
        if (deckCards.length < 5) { socket.emit('error', { message: 'Select at least 5 cards' }); return; }
        const battle = tcgBattleManager.setDeck(socket.id, deckCards);
        if (!battle) { socket.emit('error', { message: 'Cannot set deck' }); return; }
        for (const [pid] of battle.players) {
          const s = io.sockets.sockets.get(pid);
          if (s) s.emit('tcg_battle_update', tcgBattleManager.getBattleState(battle.id, pid));
        }
      } catch (err) {
        console.error('[tcg_set_deck] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Battle: attack
    // ------------------------------------------------------------------
    socket.on('tcg_attack', (data) => {
      try {
        var targetSlot = (data && typeof data.targetSlot === 'number') ? data.targetSlot : 0;
        const result = tcgBattleManager.attack(socket.id, targetSlot);
        if (!result) return;
        const battleId = tcgBattleManager.getPlayerBattleId(socket.id) || result.battle.id;
        for (const [pid] of result.battle.players) {
          const s = io.sockets.sockets.get(pid);
          if (s) s.emit('tcg_battle_update', tcgBattleManager.getBattleState(result.battle.id, pid));
        }
        if (result.finished) {
          // Award chips to winner
          const winnerKey = socketAccountMap.get(result.winner);
          if (winnerKey) {
            accounts.updateChips(winnerKey, 100);
            const ws = io.sockets.sockets.get(result.winner);
            if (ws) {
              const accAfterWin = accounts.loadAccount(winnerKey);
              const newChips = accAfterWin ? accAfterWin.chips : 0;
              ws.emit('chips_updated', { chips: newChips, reason: 'TCG Battle Victory! +100' });
            }
          }
        }
      } catch (err) {
        console.error('[tcg_attack] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Battle: switch card
    // ------------------------------------------------------------------
    socket.on('tcg_switch', (data) => {
      try {
        if (!data || typeof data.deckIndex !== 'number') return;
        var activeSlotIndex = (typeof data.activeSlotIndex === 'number') ? data.activeSlotIndex : 0;
        const result = tcgBattleManager.switchCard(socket.id, activeSlotIndex, data.deckIndex);
        if (!result) return;
        for (const [pid] of result.battle.players) {
          const s = io.sockets.sockets.get(pid);
          if (s) s.emit('tcg_battle_update', tcgBattleManager.getBattleState(result.battle.id, pid));
        }
      } catch (err) {
        console.error('[tcg_switch] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Battle: surrender
    // ------------------------------------------------------------------
    socket.on('tcg_surrender', () => {
      try {
        const result = tcgBattleManager.surrender(socket.id);
        if (!result) return;
        for (const [pid] of result.battle.players) {
          const s = io.sockets.sockets.get(pid);
          if (s) s.emit('tcg_battle_update', tcgBattleManager.getBattleState(result.battle.id, pid));
        }
      } catch (err) {
        console.error('[tcg_surrender] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Table: create a table
    // ------------------------------------------------------------------
    socket.on('tcg_create_table', (data) => {
      try {
        if (!tcgTableManager) return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to create a table' }); return; }
        if (!checkEventRate(socket, 'tcg_create_table', 10, 60000)) return;
        const cards = accounts.getCards(key);
        if (!cards || cards.length < 5) { socket.emit('error', { message: 'Need at least 5 cards to battle' }); return; }
        const isPrivate = data && data.isPrivate ? true : false;
        const result = tcgTableManager.createTable(socket.id, user.name, user.color, cards.length, isPrivate);
        if (result.error) { socket.emit('error', { message: result.error }); return; }
        socket.emit('tcg_table_created', tcgTableManager.getTableForPlayer(socket.id));
        // Broadcast updated table list to all connected sockets in this namespace
        io.emit('tcg_table_list', { tables: tcgTableManager.getOpenTables() });
      } catch (err) {
        console.error('[tcg_create_table] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Table: join a table
    // ------------------------------------------------------------------
    socket.on('tcg_join_table', (data) => {
      try {
        if (!tcgTableManager) return;
        if (!data || typeof data.tableId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to join a table' }); return; }
        if (!checkEventRate(socket, 'tcg_join_table', 20, 60000)) return;
        const cards = accounts.getCards(key);
        if (!cards || cards.length < 5) { socket.emit('error', { message: 'Need at least 5 cards to battle' }); return; }
        const result = tcgTableManager.joinTable(socket.id, data.tableId, user.name, user.color, cards.length);
        if (result.error) { socket.emit('error', { message: result.error }); return; }
        var table = result.table;
        var serialized = tcgTableManager.getTable(data.tableId);
        socket.emit('tcg_table_joined', serialized);
        // Notify the host
        if (table.host) {
          var hostSocket = io.sockets ? io.sockets.get(table.host.socketId) : null;
          if (hostSocket) hostSocket.emit('tcg_table_updated', serialized);
        }
        io.emit('tcg_table_list', { tables: tcgTableManager.getOpenTables() });
      } catch (err) {
        console.error('[tcg_join_table] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Table: leave a table
    // ------------------------------------------------------------------
    socket.on('tcg_leave_table', () => {
      try {
        if (!tcgTableManager) return;
        const result = tcgTableManager.leaveTable(socket.id);
        if (!result) return;
        socket.emit('tcg_table_left');
        var table = result.table;
        if (result.removed) {
          // Table was destroyed (host left). Notify guest if any.
          if (result.guestSocketId) {
            var guestSock = io.sockets ? io.sockets.get(result.guestSocketId) : null;
            if (guestSock) guestSock.emit('tcg_table_closed', { reason: 'Host left the table' });
          }
        } else {
          // Guest left, notify host
          if (table.host) {
            var hostSock = io.sockets ? io.sockets.get(table.host.socketId) : null;
            if (hostSock) hostSock.emit('tcg_table_updated', tcgTableManager.getTable(table.id));
          }
        }
        io.emit('tcg_table_list', { tables: tcgTableManager.getOpenTables() });
      } catch (err) {
        console.error('[tcg_leave_table] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Table: toggle ready status
    // ------------------------------------------------------------------
    socket.on('tcg_ready', () => {
      try {
        if (!tcgTableManager) return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        if (!checkEventRate(socket, 'tcg_ready', 20, 60000)) return;
        const result = tcgTableManager.setReady(socket.id);
        if (!result) { socket.emit('error', { message: 'Cannot ready up' }); return; }
        var table = result.table;
        var serialized = tcgTableManager.getTable(table.id);

        if (result.bothReady) {
          // Both players ready — start battle via existing TCGBattleManager flow
          var hostId = table.host.socketId;
          var guestId = table.guest.socketId;

          // Create the challenge and immediately accept it
          var challengeResult = tcgBattleManager.challenge(hostId, guestId, table.host.name, table.host.color);
          if (challengeResult.error) {
            socket.emit('error', { message: challengeResult.error });
            // Reset readiness
            table.host.ready = false;
            table.guest.ready = false;
            table.state = 'waiting';
            var resetSerialized = tcgTableManager.getTable(table.id);
            var hs = io.sockets ? io.sockets.get(hostId) : null;
            var gs = io.sockets ? io.sockets.get(guestId) : null;
            if (hs) hs.emit('tcg_table_updated', resetSerialized);
            if (gs) gs.emit('tcg_table_updated', resetSerialized);
            return;
          }

          var battle = tcgBattleManager.acceptChallenge(guestId, table.guest.name, table.guest.color);
          if (!battle) {
            socket.emit('error', { message: 'Failed to start battle' });
            table.host.ready = false;
            table.guest.ready = false;
            table.state = 'waiting';
            tcgBattleManager.declineChallenge(guestId);
            var resetSerialized2 = tcgTableManager.getTable(table.id);
            var hs2 = io.sockets ? io.sockets.get(hostId) : null;
            var gs2 = io.sockets ? io.sockets.get(guestId) : null;
            if (hs2) hs2.emit('tcg_table_updated', resetSerialized2);
            if (gs2) gs2.emit('tcg_table_updated', resetSerialized2);
            return;
          }

          // Send battle started to both players
          for (var [pid] of battle.players) {
            var s = io.sockets ? io.sockets.get(pid) : null;
            if (s) {
              s.emit('tcg_battle_started', tcgBattleManager.getBattleState(battle.id, pid));
            }
          }

          // Update table state for UI (table now shows as battling)
          serialized = tcgTableManager.getTable(table.id);
          var hs3 = io.sockets ? io.sockets.get(hostId) : null;
          var gs3 = io.sockets ? io.sockets.get(guestId) : null;
          if (hs3) hs3.emit('tcg_table_updated', serialized);
          if (gs3) gs3.emit('tcg_table_updated', serialized);
          io.emit('tcg_table_list', { tables: tcgTableManager.getOpenTables() });
        } else {
          // Notify both players of updated readiness
          if (table.host) {
            var hsock = io.sockets ? io.sockets.get(table.host.socketId) : null;
            if (hsock) hsock.emit('tcg_table_updated', serialized);
          }
          if (table.guest) {
            var gsock = io.sockets ? io.sockets.get(table.guest.socketId) : null;
            if (gsock) gsock.emit('tcg_table_updated', serialized);
          }
        }
      } catch (err) {
        console.error('[tcg_ready] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Table: list open tables
    // ------------------------------------------------------------------
    socket.on('tcg_list_tables', () => {
      try {
        if (!tcgTableManager) return;
        if (!checkEventRate(socket, 'tcg_list_tables', 30, 60000)) return;
        socket.emit('tcg_table_list', { tables: tcgTableManager.getOpenTables() });
        // Also send current table if player is at one
        var myTable = tcgTableManager.getTableForPlayer(socket.id);
        if (myTable) {
          socket.emit('tcg_table_updated', myTable);
        }
      } catch (err) {
        console.error('[tcg_list_tables] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Table: invite a friend to the current table
    // ------------------------------------------------------------------
    socket.on('tcg_invite_to_table', (data) => {
      try {
        if (!tcgTableManager) return;
        if (!data || typeof data.targetKey !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) return;
        if (!checkEventRate(socket, 'tcg_invite_to_table', 10, 60000)) return;

        var myTable = tcgTableManager.getTableForPlayer(socket.id);
        if (!myTable) { socket.emit('error', { message: 'Not at a table' }); return; }
        if (myTable.guest) { socket.emit('error', { message: 'Table is full' }); return; }

        // Find target socket by account key
        for (var [sid, skey] of socketAccountMap) {
          if (skey === data.targetKey && sid !== socket.id) {
            var targetSocket = io.sockets ? io.sockets.get(sid) : null;
            if (targetSocket) {
              targetSocket.emit('tcg_table_invite', {
                tableId: myTable.id,
                fromName: user.name,
                fromColor: user.color,
                tableName: myTable.name,
              });
              socket.emit('tcg_invite_sent', { targetKey: data.targetKey });
            }
            break;
          }
        }
      } catch (err) {
        console.error('[tcg_invite_to_table] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Trade: propose trade to another player
    // ------------------------------------------------------------------
    socket.on('tcg_trade_propose', (data) => {
      try {
        if (!data || typeof data.targetId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to trade' }); return; }
        const trade = tcgTradeManager.propose(
          socket.id, data.targetId, user.name,
          data.offeredCards || [], data.requestedCards || [],
          data.offeredChips || 0, data.requestedChips || 0
        );
        if (trade.error) { socket.emit('error', { message: trade.error }); return; }
        socket.emit('tcg_trade_proposed', trade);
        const targetSocket = io.sockets.sockets.get(data.targetId);
        if (targetSocket) {
          targetSocket.emit('tcg_trade_received', trade);
        }
      } catch (err) {
        console.error('[tcg_trade_propose] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Trade: accept
    // ------------------------------------------------------------------
    socket.on('tcg_trade_accept', () => {
      try {
        const trade = tcgTradeManager.accept(socket.id);
        if (!trade) { socket.emit('error', { message: 'No pending trade' }); return; }
        // Execute the trade: swap cards and chips
        const fromKey = socketAccountMap.get(trade.from);
        const toKey = socketAccountMap.get(trade.to);
        if (!fromKey || !toKey) { tcgTradeManager.cancel(socket.id); socket.emit('error', { message: 'Trade partner disconnected' }); return; }
        // Validate chip balances BEFORE transferring any cards
        if (trade.offeredChips > 0) {
          var fromAcc = accounts.loadAccount(fromKey);
          if (!fromAcc || fromAcc.chips < trade.offeredChips) {
            tcgTradeManager.cancel(trade.from);
            socket.emit('error', { message: 'Trade failed: proposer lacks chips' });
            const fromSocket = io.sockets.sockets.get(trade.from);
            if (fromSocket) fromSocket.emit('tcg_trade_cancelled');
            socket.emit('tcg_trade_cancelled');
            return;
          }
        }
        if (trade.requestedChips > 0) {
          var toAcc = accounts.loadAccount(toKey);
          if (!toAcc || toAcc.chips < trade.requestedChips) {
            tcgTradeManager.cancel(trade.from);
            socket.emit('error', { message: 'Trade failed: you lack chips' });
            const fromSocket2 = io.sockets.sockets.get(trade.from);
            if (fromSocket2) fromSocket2.emit('tcg_trade_cancelled');
            socket.emit('tcg_trade_cancelled');
            return;
          }
        }
        // Validate card ownership BEFORE transferring anything
        for (const card of trade.offeredCards) {
          const fromCards = accounts.getCards(fromKey);
          if (!fromCards || !fromCards.find(c => c.id === card.instanceId)) {
            tcgTradeManager.cancel(trade.from);
            socket.emit('error', { message: 'Trade failed: proposer no longer owns offered card' });
            const fromSocket3 = io.sockets.sockets.get(trade.from);
            if (fromSocket3) fromSocket3.emit('tcg_trade_cancelled');
            socket.emit('tcg_trade_cancelled');
            return;
          }
        }
        for (const card of trade.requestedCards) {
          const toCards = accounts.getCards(toKey);
          if (!toCards || !toCards.find(c => c.id === card.instanceId)) {
            tcgTradeManager.cancel(trade.from);
            socket.emit('error', { message: 'Trade failed: you no longer own requested card' });
            const fromSocket4 = io.sockets.sockets.get(trade.from);
            if (fromSocket4) fromSocket4.emit('tcg_trade_cancelled');
            socket.emit('tcg_trade_cancelled');
            return;
          }
        }
        // Transfer offered cards from -> to (preserve rolledStats and shiny)
        for (const card of trade.offeredCards) {
          const removed = accounts.removeCard(fromKey, card.instanceId);
          if (removed) {
            accounts.addCard(toKey, { instanceId: crypto.randomBytes(6).toString('hex'), cardId: removed.cardId, rolledStats: removed.rolledStats || null, shiny: removed.shiny || false, obtainedAt: Date.now(), source: 'trade' });
          }
        }
        // Transfer requested cards to -> from (preserve rolledStats and shiny)
        for (const card of trade.requestedCards) {
          const removed = accounts.removeCard(toKey, card.instanceId);
          if (removed) {
            accounts.addCard(fromKey, { instanceId: crypto.randomBytes(6).toString('hex'), cardId: removed.cardId, rolledStats: removed.rolledStats || null, shiny: removed.shiny || false, obtainedAt: Date.now(), source: 'trade' });
          }
        }
        // Transfer chips
        if (trade.offeredChips > 0) {
          accounts.updateChips(fromKey, -trade.offeredChips);
          accounts.updateChips(toKey, trade.offeredChips);
        }
        if (trade.requestedChips > 0) {
          accounts.updateChips(toKey, -trade.requestedChips);
          accounts.updateChips(fromKey, trade.requestedChips);
        }
        tcgTradeManager.completeTrade(trade.id);
        // Notify both
        const fromSocket = io.sockets.sockets.get(trade.from);
        if (fromSocket) {
          fromSocket.emit('tcg_trade_completed', { tradeId: trade.id });
          const fromAcc2 = accounts.loadAccount(fromKey);
          const fromChips = fromAcc2 ? fromAcc2.chips : 0;
          fromSocket.emit('chips_updated', { chips: fromChips, reason: 'Trade completed' });
        }
        socket.emit('tcg_trade_completed', { tradeId: trade.id });
        const toAcc2 = accounts.loadAccount(toKey);
        const toChips = toAcc2 ? toAcc2.chips : 0;
        socket.emit('chips_updated', { chips: toChips, reason: 'Trade completed' });
      } catch (err) {
        console.error('[tcg_trade_accept] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Trade: decline
    // ------------------------------------------------------------------
    socket.on('tcg_trade_decline', () => {
      try {
        const trade = tcgTradeManager.decline(socket.id);
        if (trade) {
          const fromSocket = io.sockets.sockets.get(trade.from);
          if (fromSocket) fromSocket.emit('tcg_trade_declined', { by: user.name });
        }
        socket.emit('tcg_trade_cancelled');
      } catch (err) {
        console.error('[tcg_trade_decline] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // TCG Trade: cancel (by proposer)
    // ------------------------------------------------------------------
    socket.on('tcg_trade_cancel', () => {
      try {
        const trade = tcgTradeManager.cancel(socket.id);
        if (trade) {
          const toSocket = io.sockets.sockets.get(trade.to);
          if (toSocket) toSocket.emit('tcg_trade_cancelled');
        }
        socket.emit('tcg_trade_cancelled');
      } catch (err) {
        console.error('[tcg_trade_cancel] Error:', err.message);
      }
    });
  }
};
