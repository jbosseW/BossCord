// game-worker.js — Worker thread for BossOrbs and BossBrawl (Liero) physics
// Runs game tick loops off the main thread so Socket.IO is never blocked.
// Communicates with main thread exclusively via postMessage / parentPort.

const { parentPort } = require('worker_threads');

const { GameManager } = require('./game');
const { LieroManager } = require('./liero');

// ---------------------------------------------------------------------------
// Game instances — fully owned by this Worker thread
// ---------------------------------------------------------------------------

const MAX_LIERO_LOBBIES = 15;
const TICK_INTERVAL_MS = 100; // 10 Hz

const gameManager = new GameManager();

// LieroManager constructor expects (io, socketAccountMap, accounts) but never
// uses them beyond storing references.  Pass nulls; pure computation only.
const lieroManager = new LieroManager(null, null, null);

// ---------------------------------------------------------------------------
// Tick loops — 10 Hz for both games
// ---------------------------------------------------------------------------

setInterval(function orbsTick() {
  try {
    var tickResults = gameManager.tickAll();
    if (tickResults.size === 0) return;

    var ticks = [];
    for (var entry of tickResults) {
      var instanceId = entry[0];
      var result = entry[1];
      var instance = gameManager.getInstance(instanceId);
      if (!instance) continue;

      // Build full player list for viewport culling on main thread
      var allPlayers = [];
      for (var p of instance.players.values()) {
        if (!p.alive) continue;
        allPlayers.push({
          id: p.id, name: p.name, color: p.color,
          x: Math.round(p.x * 10) / 10,
          y: Math.round(p.y * 10) / 10,
          radius: Math.round(p.radius * 10) / 10,
          score: p.score,
          boost: Math.round(p.boostFuel),
        });
      }

      var leaderboard = instance._leaderboard();

      ticks.push({
        instanceId: instanceId,
        eatenOrbs: result.eatenOrbs,
        spawnedOrbs: result.spawnedOrbs,
        eatenPlayers: result.eatenPlayers,
        playerCount: instance.players.size,
        allPlayers: allPlayers,
        leaderboard: leaderboard,
      });
    }

    if (ticks.length > 0) {
      parentPort.postMessage({ type: 'orbs_tick', ticks: ticks });
    }
  } catch (err) {
    console.error('[game-worker] orbsTick error:', err.message);
  }
}, TICK_INTERVAL_MS);

setInterval(function lieroTick() {
  try {
    var broadcasts = lieroManager.tickAll();
    if (!broadcasts || broadcasts.length === 0) return;
    // If any broadcast has gameOver, include the updated lobbies list
    var hasGameOver = false;
    for (var bi = 0; bi < broadcasts.length; bi++) {
      if (broadcasts[bi].gameOver) { hasGameOver = true; break; }
    }
    var payload = { type: 'liero_tick', broadcasts: broadcasts };
    if (hasGameOver) {
      payload.lobbies = lieroManager.getLobbies();
    }
    parentPort.postMessage(payload);
  } catch (err) {
    console.error('[game-worker] lieroTick error:', err.message);
  }
}, TICK_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Message handler — dispatch commands from main thread
// ---------------------------------------------------------------------------

parentPort.on('message', function(msg) {
  try {
    switch (msg.type) {

      // =====================================================================
      // BossOrbs commands
      // =====================================================================

      case 'orbs_join': {
        var instanceId = msg.instanceId || gameManager.findBestInstance();
        var instance = gameManager.getOrCreateInstance(instanceId);
        if (!instance) {
          parentPort.postMessage({ type: 'orbs_join_failed', socketId: msg.socketId, reqId: msg.reqId });
          return;
        }
        var player = gameManager.addPlayer(msg.socketId, instanceId, msg.name, msg.color);
        var fullState = instance.getFullState();
        fullState.instanceId = instanceId;
        parentPort.postMessage({
          type: 'orbs_joined',
          socketId: msg.socketId,
          instanceId: instanceId,
          fullState: fullState,
          player: {
            id: player.id, name: player.name, color: player.color,
            x: player.x, y: player.y, radius: player.radius, score: player.score,
          },
          reqId: msg.reqId,
        });
        break;
      }

      case 'orbs_move': {
        var orbInstId = gameManager.getPlayerInstance(msg.socketId);
        if (!orbInstId) return;
        var orbInst = gameManager.getInstance(orbInstId);
        if (orbInst) orbInst.updateInput(msg.socketId, msg.x, msg.y, msg.boost);
        break;
      }

      case 'orbs_leave': {
        var leaveInstId = gameManager.getPlayerInstance(msg.socketId);
        gameManager.removePlayer(msg.socketId);
        // Check if the instance was cleaned up (no humans left on non-main)
        var wasLastHuman = false;
        if (leaveInstId && leaveInstId !== 'main') {
          var leftInst = gameManager.getInstance(leaveInstId);
          wasLastHuman = !leftInst; // instance deleted means no humans were left
        }
        parentPort.postMessage({
          type: 'orbs_left',
          socketId: msg.socketId,
          instanceId: leaveInstId || null,
          wasLastHuman: wasLastHuman,
          reqId: msg.reqId,
        });
        break;
      }

      case 'orbs_get_instances': {
        parentPort.postMessage({
          type: 'orbs_instances',
          instances: gameManager.getInstanceList(),
          reqId: msg.reqId,
        });
        break;
      }

      case 'orbs_get_player_instance': {
        parentPort.postMessage({
          type: 'orbs_player_instance',
          socketId: msg.socketId,
          instanceId: gameManager.getPlayerInstance(msg.socketId),
          reqId: msg.reqId,
        });
        break;
      }

      // =====================================================================
      // BossBrawl (Liero) commands
      // =====================================================================

      case 'liero_create': {
        // Enforce lobby limit
        if (lieroManager.lobbies.size >= MAX_LIERO_LOBBIES) {
          parentPort.postMessage({
            type: 'liero_created',
            socketId: msg.socketId,
            lobbyId: null,
            lobby: null,
            error: 'Server lobby limit reached',
            reqId: msg.reqId,
          });
          return;
        }
        var lobby = lieroManager.createLobby(
          msg.socketId, msg.name, msg.color, msg.settings,
          msg.weapons, msg.spell
        );
        if (!lobby) {
          parentPort.postMessage({
            type: 'liero_created',
            socketId: msg.socketId,
            lobbyId: null,
            lobby: null,
            error: 'Already in a lobby',
            reqId: msg.reqId,
          });
          return;
        }
        parentPort.postMessage({
          type: 'liero_created',
          socketId: msg.socketId,
          lobbyId: lobby.id,
          lobby: lieroManager.getLobbyState(lobby.id),
          lobbies: lieroManager.getLobbies(),
          reqId: msg.reqId,
        });
        break;
      }

      case 'liero_join': {
        var jLobby = lieroManager.joinLobby(
          msg.socketId, msg.lobbyId, msg.name, msg.color,
          msg.weapons, msg.spell
        );
        if (!jLobby) {
          parentPort.postMessage({
            type: 'liero_joined',
            socketId: msg.socketId,
            lobbyId: msg.lobbyId,
            lobby: null,
            success: false,
            reqId: msg.reqId,
          });
          return;
        }
        // If joining mid-game, include terrain + game state
        var gameStartData = null;
        if (jLobby.state === 'playing' && jLobby.game) {
          gameStartData = {
            terrain: jLobby.game.terrain.serialize(),
            mapWidth: jLobby.game.terrain.width,
            mapHeight: jLobby.game.terrain.height,
            players: jLobby.game.getPlayersState(),
            weapons: jLobby.game.getWeaponDefs(),
            spells: jLobby.game.getSpellDefs(),
            scoreLimit: jLobby.settings.scoreLimit,
          };
        }
        parentPort.postMessage({
          type: 'liero_joined',
          socketId: msg.socketId,
          lobbyId: jLobby.id,
          lobby: lieroManager.getLobbyState(jLobby.id),
          lobbyState: jLobby.state,
          gameStartData: gameStartData,
          lobbies: lieroManager.getLobbies(),
          success: true,
          reqId: msg.reqId,
        });
        break;
      }

      case 'liero_leave': {
        var lResult = lieroManager.leaveLobby(msg.socketId);
        var lLobbyState = null;
        var lLobbies = lieroManager.getLobbies();
        if (lResult && !lResult.destroyed) {
          lLobbyState = lieroManager.getLobbyState(lResult.lobbyId);
        }
        parentPort.postMessage({
          type: 'liero_left',
          socketId: msg.socketId,
          lobbyId: lResult ? lResult.lobbyId : null,
          destroyed: lResult ? lResult.destroyed : true,
          lobbyState: lLobbyState,
          lobbies: lLobbies,
          reqId: msg.reqId,
        });
        break;
      }

      case 'liero_start': {
        var sResult = lieroManager.startGame(msg.lobbyId, msg.socketId);
        if (!sResult) {
          parentPort.postMessage({
            type: 'liero_started',
            lobbyId: msg.lobbyId,
            socketId: msg.socketId,
            success: false,
            reqId: msg.reqId,
          });
          return;
        }
        var sLobby = lieroManager.lobbies.get(msg.lobbyId);
        var startData = null;
        if (sLobby && sLobby.game) {
          startData = {
            terrain: sLobby.game.terrain.serialize(),
            mapWidth: sLobby.game.terrain.width,
            mapHeight: sLobby.game.terrain.height,
            players: sLobby.game.getPlayersState(),
            weapons: sLobby.game.getWeaponDefs(),
            spells: sLobby.game.getSpellDefs(),
            scoreLimit: sLobby.settings.scoreLimit,
          };
        }
        parentPort.postMessage({
          type: 'liero_started',
          lobbyId: msg.lobbyId,
          socketId: msg.socketId,
          success: true,
          gameStartData: startData,
          lobbies: lieroManager.getLobbies(),
          reqId: msg.reqId,
        });
        break;
      }

      case 'liero_input': {
        lieroManager.handleInput(msg.socketId, msg.input);
        break;
      }

      case 'liero_add_bot': {
        var abResult = lieroManager.addBot(msg.lobbyId, msg.requesterId);
        var abLobbyState = abResult ? lieroManager.getLobbyState(msg.lobbyId) : null;
        parentPort.postMessage({
          type: 'liero_bot_added',
          lobbyId: msg.lobbyId,
          success: !!abResult,
          lobby: abLobbyState,
          lobbies: lieroManager.getLobbies(),
          reqId: msg.reqId,
        });
        break;
      }

      case 'liero_remove_bot': {
        var rbResult = lieroManager.removeBot(msg.lobbyId, msg.botId, msg.requesterId);
        var rbLobbyState = rbResult ? lieroManager.getLobbyState(msg.lobbyId) : null;
        parentPort.postMessage({
          type: 'liero_bot_removed',
          lobbyId: msg.lobbyId,
          success: !!rbResult,
          lobby: rbLobbyState,
          lobbies: lieroManager.getLobbies(),
          reqId: msg.reqId,
        });
        break;
      }

      case 'liero_get_lobbies': {
        parentPort.postMessage({
          type: 'liero_lobbies',
          lobbies: lieroManager.getLobbies(),
          reqId: msg.reqId,
        });
        break;
      }

      case 'liero_get_lobby_state': {
        parentPort.postMessage({
          type: 'liero_lobby_state',
          lobbyId: msg.lobbyId,
          state: lieroManager.getLobbyState(msg.lobbyId),
          reqId: msg.reqId,
        });
        break;
      }

      case 'liero_get_player_lobby': {
        parentPort.postMessage({
          type: 'liero_player_lobby',
          socketId: msg.socketId,
          lobbyId: lieroManager.getPlayerLobbyId(msg.socketId),
          reqId: msg.reqId,
        });
        break;
      }

      // =====================================================================
      // Disconnect cleanup — handles both games in one message
      // =====================================================================

      case 'disconnect': {
        // BossOrbs cleanup
        var dOrbsInstId = gameManager.getPlayerInstance(msg.socketId);
        if (dOrbsInstId) {
          gameManager.removePlayer(msg.socketId);
          parentPort.postMessage({
            type: 'orbs_disconnect_cleanup',
            socketId: msg.socketId,
            instanceId: dOrbsInstId,
          });
        }

        // Liero cleanup
        var dLieroResult = lieroManager.leaveLobby(msg.socketId);
        if (dLieroResult) {
          var dLieroLobbyState = null;
          if (!dLieroResult.destroyed) {
            dLieroLobbyState = lieroManager.getLobbyState(dLieroResult.lobbyId);
          }
          parentPort.postMessage({
            type: 'liero_disconnect_cleanup',
            socketId: msg.socketId,
            lobbyId: dLieroResult.lobbyId,
            destroyed: dLieroResult.destroyed,
            lobbyState: dLieroLobbyState,
            lobbies: lieroManager.getLobbies(),
          });
        }
        break;
      }

      // =====================================================================
      // Reset — daily wipe
      // =====================================================================
      case 'reset': {
        gameManager.reset();
        lieroManager.reset();
        console.log('[game-worker] Game state reset');
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('[game-worker] Message handler error (' + msg.type + '):', err.message, err.stack);
  }
});

// Notify main thread that the worker is ready
parentPort.postMessage({ type: 'ready' });
console.log('[game-worker] Game worker started (10 Hz tick, max 15 Liero lobbies)');
