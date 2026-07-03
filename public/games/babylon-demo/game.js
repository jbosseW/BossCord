// Obstacle Runner 3D - Babylon.js Demo for BossCord
// Sphere rolls forward on a track, dodge obstacles with A/D or arrow keys.
// Score based on distance traveled. Reports score via BossCord bridge.
(function() {
  'use strict';

  // --- Constants ---
  var LANE_COUNT = 3;
  var LANE_WIDTH = 2.5;
  var TRACK_WIDTH = LANE_COUNT * LANE_WIDTH;
  var INITIAL_SPEED = 8;
  var SPEED_INCREMENT = 0.3; // per 100 distance
  var MAX_SPEED = 25;
  var OBSTACLE_SPAWN_DISTANCE = 40;
  var OBSTACLE_POOL_SIZE = 30;
  var LANE_SWITCH_SPEED = 10;
  var GROUND_LENGTH = 200;
  var CHIPS_PER_100_DIST = 5;

  // --- DOM refs ---
  var canvas = document.getElementById('renderCanvas');
  var overlay = document.getElementById('overlay');
  var scoreDisplay = document.getElementById('scoreDisplay');
  var speedDisplay = document.getElementById('speedDisplay');
  var chipsDisplay = document.getElementById('chipsDisplay');

  // --- Game state ---
  var gameRunning = false;
  var gameOver = false;
  var distance = 0;
  var currentLane = 1; // 0=left, 1=center, 2=right
  var targetX = 0;
  var speed = INITIAL_SPEED;
  var lastObstacleZ = 0;
  var score = 0;
  var obstacleIndex = 0;

  // --- Input state ---
  var keys = { left: false, right: false };

  // --- Babylon setup ---
  var engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  var scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.06, 0.06, 0.12, 1);
  scene.ambientColor = new BABYLON.Color3(0.2, 0.2, 0.3);

  // Fog for depth
  scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.012;
  scene.fogColor = new BABYLON.Color3(0.06, 0.06, 0.12);

  // Camera - follows behind player
  var camera = new BABYLON.FollowCamera('followCam', new BABYLON.Vector3(0, 8, -12), scene);
  camera.radius = 12;
  camera.heightOffset = 6;
  camera.rotationOffset = 180;
  camera.cameraAcceleration = 0.05;
  camera.maxCameraSpeed = 20;
  camera.inputs.clear(); // Disable user camera control

  // Lighting
  var hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), scene);
  hemiLight.intensity = 0.7;
  hemiLight.diffuse = new BABYLON.Color3(0.9, 0.85, 0.7);
  hemiLight.groundColor = new BABYLON.Color3(0.15, 0.15, 0.25);

  var dirLight = new BABYLON.DirectionalLight('dirLight', new BABYLON.Vector3(-0.5, -1, 1), scene);
  dirLight.intensity = 0.5;
  dirLight.diffuse = new BABYLON.Color3(1, 0.95, 0.8);

  // --- Player sphere ---
  var player = BABYLON.MeshBuilder.CreateSphere('player', { diameter: 1.2, segments: 16 }, scene);
  var playerMat = new BABYLON.StandardMaterial('playerMat', scene);
  playerMat.diffuseColor = new BABYLON.Color3(0.94, 0.7, 0.2); // #f0b232
  playerMat.specularColor = new BABYLON.Color3(1, 1, 1);
  playerMat.specularPower = 32;
  playerMat.emissiveColor = new BABYLON.Color3(0.3, 0.22, 0.05);
  player.material = playerMat;
  player.position.y = 0.6;

  // Glow layer for player
  var glowLayer = new BABYLON.GlowLayer('glow', scene, { mainTextureSamples: 2 });
  glowLayer.intensity = 0.4;
  glowLayer.addIncludedOnlyMesh(player);

  camera.lockedTarget = player;

  // --- Ground track ---
  // We create a long ground plane that repositions as the player moves
  var ground = BABYLON.MeshBuilder.CreateGround('ground', { width: TRACK_WIDTH + 4, height: GROUND_LENGTH }, scene);
  var groundMat = new BABYLON.StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = new BABYLON.Color3(0.12, 0.12, 0.2);
  groundMat.specularColor = new BABYLON.Color3(0.05, 0.05, 0.1);
  ground.material = groundMat;

  // Lane divider lines
  var laneDividers = [];
  for (var ld = 0; ld < LANE_COUNT - 1; ld++) {
    var lx = (ld + 1) * LANE_WIDTH - TRACK_WIDTH / 2;
    var divider = BABYLON.MeshBuilder.CreateBox('divider_' + ld, { width: 0.05, height: 0.02, depth: GROUND_LENGTH }, scene);
    var divMat = new BABYLON.StandardMaterial('divMat_' + ld, scene);
    divMat.diffuseColor = new BABYLON.Color3(0.3, 0.3, 0.4);
    divMat.emissiveColor = new BABYLON.Color3(0.15, 0.15, 0.2);
    divider.material = divMat;
    divider.position.x = lx;
    divider.position.y = 0.02;
    laneDividers.push(divider);
  }

  // Track edge walls (visual only)
  var edgeLeft = BABYLON.MeshBuilder.CreateBox('edgeLeft', { width: 0.3, height: 0.5, depth: GROUND_LENGTH }, scene);
  var edgeMat = new BABYLON.StandardMaterial('edgeMat', scene);
  edgeMat.diffuseColor = new BABYLON.Color3(0.2, 0.15, 0.4);
  edgeMat.emissiveColor = new BABYLON.Color3(0.1, 0.07, 0.2);
  edgeLeft.material = edgeMat;
  edgeLeft.position.x = -(TRACK_WIDTH / 2) - 0.15;
  edgeLeft.position.y = 0.25;

  var edgeRight = edgeLeft.clone('edgeRight');
  edgeRight.position.x = (TRACK_WIDTH / 2) + 0.15;

  // --- Obstacle pool ---
  var obstacles = [];
  var obstacleMat = new BABYLON.StandardMaterial('obstacleMat', scene);
  obstacleMat.diffuseColor = new BABYLON.Color3(0.93, 0.26, 0.27); // #ed4245 reddish
  obstacleMat.emissiveColor = new BABYLON.Color3(0.3, 0.08, 0.08);
  obstacleMat.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);

  for (var oi = 0; oi < OBSTACLE_POOL_SIZE; oi++) {
    var obs = BABYLON.MeshBuilder.CreateBox('obs_' + oi, { width: LANE_WIDTH * 0.8, height: 1.2, depth: 0.8 }, scene);
    obs.material = obstacleMat;
    obs.position.y = 0.6;
    obs.position.z = -9999; // Off-screen
    obs.isVisible = false;
    obs._active = false;
    obs._lane = 0;
    obstacles.push(obs);
  }

  // --- Helper functions ---

  function getLaneX(lane) {
    // lane 0 = leftmost, lane (LANE_COUNT-1) = rightmost
    return (lane - (LANE_COUNT - 1) / 2) * LANE_WIDTH;
  }

  function resetGame() {
    distance = 0;
    score = 0;
    speed = INITIAL_SPEED;
    currentLane = 1;
    targetX = getLaneX(currentLane);
    player.position.x = targetX;
    player.position.z = 0;
    player.position.y = 0.6;
    lastObstacleZ = player.position.z + 20;
    obstacleIndex = 0;
    gameOver = false;

    // Hide all obstacles
    for (var i = 0; i < obstacles.length; i++) {
      obstacles[i].position.z = -9999;
      obstacles[i].isVisible = false;
      obstacles[i]._active = false;
    }

    updateHUD();
  }

  function updateHUD() {
    score = Math.floor(distance);
    var chipsEarned = Math.floor(score / 100) * CHIPS_PER_100_DIST;
    scoreDisplay.textContent = 'Score: ' + score;
    speedDisplay.textContent = 'Speed: ' + speed.toFixed(1) + 'x';
    chipsDisplay.textContent = 'Chips: +' + chipsEarned;
  }

  function spawnObstacle() {
    var obs = obstacles[obstacleIndex % OBSTACLE_POOL_SIZE];
    obstacleIndex++;

    // Pick 1 or 2 lanes to block (never block all 3)
    var blockedLanes = [];
    var numBlocked = Math.random() < 0.3 ? 2 : 1;

    while (blockedLanes.length < numBlocked) {
      var lane = Math.floor(Math.random() * LANE_COUNT);
      if (blockedLanes.indexOf(lane) === -1) {
        blockedLanes.push(lane);
      }
    }

    // For simplicity, spawn one obstacle per call. The system spawns multiple.
    var lane = blockedLanes[0];
    obs.position.x = getLaneX(lane);
    obs.position.z = lastObstacleZ;
    obs.position.y = 0.6;
    obs.isVisible = true;
    obs._active = true;
    obs._lane = lane;

    // If blocking 2 lanes, spawn a second
    if (numBlocked === 2) {
      var obs2 = obstacles[obstacleIndex % OBSTACLE_POOL_SIZE];
      obstacleIndex++;
      obs2.position.x = getLaneX(blockedLanes[1]);
      obs2.position.z = lastObstacleZ;
      obs2.position.y = 0.6;
      obs2.isVisible = true;
      obs2._active = true;
      obs2._lane = blockedLanes[1];
    }

    // Randomize spacing based on speed
    var spacing = OBSTACLE_SPAWN_DISTANCE - Math.min(speed * 0.5, 15);
    spacing = Math.max(spacing, 12);
    lastObstacleZ += spacing + Math.random() * 10;
  }

  function checkCollision() {
    var px = player.position.x;
    var pz = player.position.z;

    for (var i = 0; i < obstacles.length; i++) {
      var obs = obstacles[i];
      if (!obs._active) continue;

      var dx = Math.abs(px - obs.position.x);
      var dz = Math.abs(pz - obs.position.z);

      // Simple AABB-like check (player is a sphere, obstacle is a box)
      if (dx < (LANE_WIDTH * 0.4 + 0.4) && dz < 0.7) {
        return true;
      }
    }
    return false;
  }

  function endGame() {
    gameRunning = false;
    gameOver = true;

    score = Math.floor(distance);
    var chipsEarned = Math.floor(score / 100) * CHIPS_PER_100_DIST;

    // Report to bridge
    if (chipsEarned > 0 && window.BossCordBridge) {
      window.BossCordBridge.requestChipsUpdate(chipsEarned, 'obstacle_runner_score');
      window.BossCordBridge.reportScore(score, { game: 'obstacle_runner_3d' });
    }

    // Show overlay
    overlay.classList.remove('hidden');
    overlay.textContent = '';
    var h1 = document.createElement('h1'); h1.textContent = 'Game Over!'; overlay.appendChild(h1);
    var pScore = document.createElement('p'); pScore.className = 'final-score'; pScore.textContent = 'Distance: ' + score; overlay.appendChild(pScore);
    var pChips = document.createElement('p'); pChips.style.cssText = 'color:#57f287;font-size:18px;font-weight:700;'; pChips.textContent = 'Earned ' + chipsEarned + ' chips'; overlay.appendChild(pChips);
    var pHint = document.createElement('p'); pHint.className = 'hint'; pHint.textContent = 'Press SPACE to try again'; overlay.appendChild(pHint);
  }

  // --- Input ---
  window.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = true;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = true;

    if (e.key === ' ' || e.key === 'Space') {
      e.preventDefault();
      if (!gameRunning) {
        resetGame();
        gameRunning = true;
        overlay.classList.add('hidden');
      }
    }
  });

  window.addEventListener('keyup', function(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keys.left = false;
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keys.right = false;
  });

  // --- Main game loop ---
  scene.onBeforeRenderObservable.add(function() {
    if (!gameRunning) return;

    var dt = engine.getDeltaTime() / 1000;
    if (dt > 0.1) dt = 0.1; // Cap delta for tab-switch

    // Lane switching via input
    if (keys.left && !keys.right) {
      if (currentLane > 0) {
        currentLane--;
        keys.left = false; // One tap = one lane switch
      }
    }
    if (keys.right && !keys.left) {
      if (currentLane < LANE_COUNT - 1) {
        currentLane++;
        keys.right = false;
      }
    }

    targetX = getLaneX(currentLane);

    // Smooth lane movement
    var dx = targetX - player.position.x;
    if (Math.abs(dx) > 0.01) {
      player.position.x += dx * LANE_SWITCH_SPEED * dt;
    } else {
      player.position.x = targetX;
    }

    // Move forward
    player.position.z += speed * dt;
    distance += speed * dt;

    // Roll the sphere visually
    player.rotation.x += (speed * dt) / 0.6; // rotation proportional to distance

    // Increase speed over time
    speed = Math.min(MAX_SPEED, INITIAL_SPEED + Math.floor(distance / 100) * SPEED_INCREMENT);

    // Move ground with player
    ground.position.z = player.position.z;
    for (var li = 0; li < laneDividers.length; li++) {
      laneDividers[li].position.z = player.position.z;
    }
    edgeLeft.position.z = player.position.z;
    edgeRight.position.z = player.position.z;

    // Spawn obstacles ahead
    while (lastObstacleZ < player.position.z + GROUND_LENGTH * 0.4) {
      spawnObstacle();
    }

    // Deactivate obstacles far behind
    for (var i = 0; i < obstacles.length; i++) {
      if (obstacles[i]._active && obstacles[i].position.z < player.position.z - 20) {
        obstacles[i]._active = false;
        obstacles[i].isVisible = false;
        obstacles[i].position.z = -9999;
      }
    }

    // Collision check
    if (checkCollision()) {
      endGame();
      return;
    }

    updateHUD();
  });

  // Render loop
  engine.runRenderLoop(function() {
    scene.render();
  });

  // Handle resize
  window.addEventListener('resize', function() {
    engine.resize();
  });

  // Notify bridge
  if (window.BossCordBridge) {
    window.BossCordBridge.notifyLoaded();
  }
})();
