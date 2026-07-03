// Coin Rush - Phaser 3 Demo for BossCord
// Collect coins to earn chips. 60-second rounds.
(function() {
  'use strict';

  var GAME_WIDTH = 800;
  var GAME_HEIGHT = 600;
  var ROUND_DURATION = 60; // seconds
  var MAX_COINS = 8;
  var COIN_SPAWN_INTERVAL = 1500; // ms
  var PLAYER_SPEED = 250;
  var COIN_RADIUS = 12;
  var PLAYER_RADIUS = 18;
  var CHIPS_PER_COIN = 2;

  // Game state
  var score = 0;
  var timeLeft = ROUND_DURATION;
  var roundActive = false;
  var bridgeReady = false;

  // Scene: Main gameplay
  var GameScene = new Phaser.Class({
    Extends: Phaser.Scene,
    initialize: function GameScene() {
      Phaser.Scene.call(this, { key: 'GameScene' });
      this.player = null;
      this.coins = null;
      this.cursors = null;
      this.wasd = null;
      this.scoreText = null;
      this.timerText = null;
      this.chipsText = null;
      this.coinTimer = null;
      this.roundTimer = null;
    },

    create: function() {
      var self = this;

      // Background
      this.cameras.main.setBackgroundColor('#1a1a2e');

      // Draw a border
      var border = this.add.graphics();
      border.lineStyle(2, 0xf0b232, 0.6);
      border.strokeRect(4, 4, GAME_WIDTH - 8, GAME_HEIGHT - 8);

      // Grid lines for visual depth
      var grid = this.add.graphics();
      grid.lineStyle(1, 0x333355, 0.3);
      for (var gx = 0; gx < GAME_WIDTH; gx += 40) {
        grid.lineBetween(gx, 0, gx, GAME_HEIGHT);
      }
      for (var gy = 0; gy < GAME_HEIGHT; gy += 40) {
        grid.lineBetween(0, gy, GAME_WIDTH, gy);
      }

      // Player (circle graphic used as texture)
      var playerGfx = this.add.graphics();
      playerGfx.fillStyle(0xf0b232, 1);
      playerGfx.fillCircle(PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_RADIUS);
      playerGfx.lineStyle(2, 0xffffff, 0.6);
      playerGfx.strokeCircle(PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_RADIUS);
      playerGfx.generateTexture('player_tex', PLAYER_RADIUS * 2, PLAYER_RADIUS * 2);
      playerGfx.destroy();

      this.player = this.physics.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'player_tex');
      this.player.setCollideWorldBounds(true);
      this.player.setCircle(PLAYER_RADIUS);
      this.player.setDamping(true);
      this.player.setDrag(0.9);

      // Coin texture
      var coinGfx = this.add.graphics();
      coinGfx.fillStyle(0xffd700, 1);
      coinGfx.fillCircle(COIN_RADIUS, COIN_RADIUS, COIN_RADIUS);
      coinGfx.lineStyle(2, 0xffa500, 0.8);
      coinGfx.strokeCircle(COIN_RADIUS, COIN_RADIUS, COIN_RADIUS);
      // Dollar sign
      coinGfx.fillStyle(0x8B6914, 1);
      coinGfx.fillRect(COIN_RADIUS - 1, COIN_RADIUS - 6, 2, 12);
      coinGfx.generateTexture('coin_tex', COIN_RADIUS * 2, COIN_RADIUS * 2);
      coinGfx.destroy();

      // Coins group
      this.coins = this.physics.add.group();

      // Overlap detection
      this.physics.add.overlap(this.player, this.coins, function(player, coin) {
        self.collectCoin(coin);
      });

      // Input
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys({
        up: Phaser.Input.Keyboard.KeyCodes.W,
        down: Phaser.Input.Keyboard.KeyCodes.S,
        left: Phaser.Input.Keyboard.KeyCodes.A,
        right: Phaser.Input.Keyboard.KeyCodes.D
      });

      // HUD - Top bar background
      var hudBg = this.add.graphics();
      hudBg.fillStyle(0x000000, 0.5);
      hudBg.fillRect(0, 0, GAME_WIDTH, 40);
      hudBg.setDepth(10);

      this.scoreText = this.add.text(16, 10, 'Score: 0', {
        fontSize: '18px', fill: '#f0b232', fontFamily: 'Inter, sans-serif', fontStyle: 'bold'
      }).setDepth(11);

      this.timerText = this.add.text(GAME_WIDTH / 2, 10, 'Time: ' + ROUND_DURATION, {
        fontSize: '18px', fill: '#ffffff', fontFamily: 'Inter, sans-serif', fontStyle: 'bold'
      }).setOrigin(0.5, 0).setDepth(11);

      this.chipsText = this.add.text(GAME_WIDTH - 16, 10, 'Chips: 0', {
        fontSize: '18px', fill: '#57f287', fontFamily: 'Inter, sans-serif', fontStyle: 'bold'
      }).setOrigin(1, 0).setDepth(11);

      // Username display
      var username = window.BossCordBridge ? window.BossCordBridge.getUsername() : 'Player';
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 16, username, {
        fontSize: '13px', fill: '#949ba4', fontFamily: 'Inter, sans-serif'
      }).setOrigin(0.5, 1).setDepth(11);

      // Start instructions
      this.startText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Press SPACE to Start', {
        fontSize: '28px', fill: '#f0b232', fontFamily: 'Inter, sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4
      }).setOrigin(0.5).setDepth(20);

      this.subtitleText = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 40, 'Collect coins with Arrow Keys or WASD', {
        fontSize: '15px', fill: '#949ba4', fontFamily: 'Inter, sans-serif'
      }).setOrigin(0.5).setDepth(20);

      this.input.keyboard.on('keydown-SPACE', function() {
        if (!roundActive) {
          self.startRound();
        }
      });

      // Notify bridge that game is loaded
      if (window.BossCordBridge) {
        window.BossCordBridge.notifyLoaded();
      }
    },

    startRound: function() {
      var self = this;
      score = 0;
      timeLeft = ROUND_DURATION;
      roundActive = true;

      // Clear old coins
      this.coins.clear(true, true);

      // Hide start text
      if (this.startText) this.startText.setVisible(false);
      if (this.subtitleText) this.subtitleText.setVisible(false);

      // Reset player position
      this.player.setPosition(GAME_WIDTH / 2, GAME_HEIGHT / 2);
      this.player.setVelocity(0, 0);

      // Update HUD
      this.scoreText.setText('Score: 0');
      this.timerText.setText('Time: ' + ROUND_DURATION);
      this.chipsText.setText('Chips: +0');

      // Spawn initial coins
      for (var i = 0; i < 4; i++) {
        this.spawnCoin();
      }

      // Coin spawn timer
      if (this.coinTimer) this.coinTimer.remove();
      this.coinTimer = this.time.addEvent({
        delay: COIN_SPAWN_INTERVAL,
        callback: function() {
          if (self.coins.countActive() < MAX_COINS) {
            self.spawnCoin();
          }
        },
        loop: true
      });

      // Round countdown timer
      if (this.roundTimer) this.roundTimer.remove();
      this.roundTimer = this.time.addEvent({
        delay: 1000,
        callback: function() {
          timeLeft--;
          self.timerText.setText('Time: ' + Math.max(0, timeLeft));

          // Flash timer red when low
          if (timeLeft <= 10) {
            self.timerText.setFill(timeLeft % 2 === 0 ? '#ed4245' : '#ffffff');
          }

          if (timeLeft <= 0) {
            self.endRound();
          }
        },
        repeat: ROUND_DURATION - 1
      });
    },

    spawnCoin: function() {
      var margin = 60;
      var x = Phaser.Math.Between(margin, GAME_WIDTH - margin);
      var y = Phaser.Math.Between(margin, GAME_HEIGHT - margin);

      var coin = this.coins.create(x, y, 'coin_tex');
      coin.setCircle(COIN_RADIUS);
      coin.setBounce(0);
      coin.setImmovable(true);

      // Spawn animation: scale up from 0
      coin.setScale(0);
      this.tweens.add({
        targets: coin,
        scaleX: 1,
        scaleY: 1,
        duration: 300,
        ease: 'Back.easeOut'
      });
    },

    collectCoin: function(coin) {
      if (!roundActive) return;

      // Collect effect: flash and scale down
      this.tweens.add({
        targets: coin,
        scaleX: 0,
        scaleY: 0,
        alpha: 0,
        duration: 150,
        onComplete: function() {
          coin.destroy();
        }
      });

      // Floating +text
      var plusText = this.add.text(coin.x, coin.y, '+' + CHIPS_PER_COIN, {
        fontSize: '20px', fill: '#ffd700', fontFamily: 'Inter, sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 3
      }).setOrigin(0.5).setDepth(15);

      this.tweens.add({
        targets: plusText,
        y: coin.y - 40,
        alpha: 0,
        duration: 600,
        onComplete: function() { plusText.destroy(); }
      });

      score += CHIPS_PER_COIN;
      this.scoreText.setText('Score: ' + score);
      this.chipsText.setText('Chips: +' + score);
    },

    endRound: function() {
      roundActive = false;

      // Stop timers
      if (this.coinTimer) { this.coinTimer.remove(); this.coinTimer = null; }
      if (this.roundTimer) { this.roundTimer.remove(); this.roundTimer = null; }

      // Clear coins
      this.coins.clear(true, true);

      // Stop player
      this.player.setVelocity(0, 0);

      // Request chip payout via bridge
      if (score > 0 && window.BossCordBridge) {
        window.BossCordBridge.requestChipsUpdate(score, 'coin_rush_score');
        window.BossCordBridge.reportScore(score, { game: 'coin_rush' });
      }

      // Show end screen
      var endBg = this.add.graphics();
      endBg.fillStyle(0x000000, 0.7);
      endBg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      endBg.setDepth(20);

      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 50, 'Round Over!', {
        fontSize: '36px', fill: '#f0b232', fontFamily: 'Inter, sans-serif', fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4
      }).setOrigin(0.5).setDepth(21);

      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'You earned ' + score + ' chips!', {
        fontSize: '22px', fill: '#57f287', fontFamily: 'Inter, sans-serif', fontStyle: 'bold'
      }).setOrigin(0.5).setDepth(21);

      var restartHint = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 50, 'Press SPACE to play again', {
        fontSize: '16px', fill: '#949ba4', fontFamily: 'Inter, sans-serif'
      }).setOrigin(0.5).setDepth(21);

      // Blink restart text
      this.tweens.add({
        targets: restartHint,
        alpha: 0.3,
        duration: 800,
        yoyo: true,
        repeat: -1
      });

      // Allow restart after 1.5s
      var self = this;
      this.time.delayedCall(1500, function() {
        self.input.keyboard.once('keydown-SPACE', function() {
          // Clean up end screen by restarting scene
          self.scene.restart();
        });
      });
    },

    update: function() {
      if (!roundActive) {
        this.player.setVelocity(0, 0);
        return;
      }

      var vx = 0;
      var vy = 0;

      if (this.cursors.left.isDown || this.wasd.left.isDown) vx = -PLAYER_SPEED;
      else if (this.cursors.right.isDown || this.wasd.right.isDown) vx = PLAYER_SPEED;

      if (this.cursors.up.isDown || this.wasd.up.isDown) vy = -PLAYER_SPEED;
      else if (this.cursors.down.isDown || this.wasd.down.isDown) vy = PLAYER_SPEED;

      // Normalize diagonal movement
      if (vx !== 0 && vy !== 0) {
        var diag = PLAYER_SPEED * 0.7071; // 1/sqrt(2)
        vx = vx > 0 ? diag : -diag;
        vy = vy > 0 ? diag : -diag;
      }

      this.player.setVelocity(vx, vy);
    }
  });

  // Phaser game config
  var config = {
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: document.body,
    backgroundColor: '#1a1a2e',
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { y: 0 },
        debug: false
      }
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    scene: [GameScene],
    banner: false,
    audio: { noAudio: true }
  };

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { new Phaser.Game(config); });
  } else {
    new Phaser.Game(config);
  }
})();
