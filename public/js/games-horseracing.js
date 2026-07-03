// games-horseracing.js
// Horse Racing: Live multiplayer horse racing with betting for BossCord
// Renders pre-race betting, animated canvas race, and results via React.createElement (no JSX)

// ========================= CONSTANTS =========================

var HR_COLORS = {
  bg: '#1c1c1e',
  panel: '#252528',
  gold: '#f0b232',
  green: '#57f287',
  red: '#ed4245',
  text: '#dcddde',
  muted: '#949ba4',
  border: '#4e5058',
  trackBg: '#18181b',
  laneA: '#1c1c1e',
  laneB: '#222226',
  laneLine: '#3a3a3e',
  statBarBg: '#3a3a3e',
  cardBg: '#2a2a2e',
  badgeBg: '#2a2a2e'
};

var HR_WEATHER_ICONS = {
  Sunny: '\u2600\uFE0F',
  Rainy: '\uD83C\uDF27\uFE0F',
  Muddy: '\uD83C\uDFD4\uFE0F',
  Windy: '\uD83D\uDCA8',
  Foggy: '\uD83C\uDF2B\uFE0F',
  Stormy: '\u26C8\uFE0F',
  Hot: '\uD83C\uDF21\uFE0F'
};

var HR_MOOD_COLORS = {
  Energetic: '#57f287',
  Calm: '#5865f2',
  Nervous: '#f0b232',
  Aggressive: '#ed4245',
  Lazy: '#949ba4'
};

var HR_BET_AMOUNTS = [10, 50, 100, 250, 500, 1000];

var HR_RACE_DURATION = 15000; // 15 seconds playback
var HR_DUST_FRAME_COUNTER = { count: 0 }; // Throttle dust particles
var HR_RACE_START_SOUND_PLAYED = false;
var HR_RACE_FINISH_SOUND_PLAYED = false;

// ========================= MAIN COMPONENT =========================

function HorseRacingView() {
  var ctx = useSocket();
  var isMobile = useIsMobile();

  useEffect(function() { ctx.connectGames(); }, []);
  var sock = ctx.gamesSocket || ctx.socket;

  // ---- State ----
  var [phase, setPhase] = useState('connecting');
  var [raceId, setRaceId] = useState(null);
  var [weather, setWeather] = useState(null);
  var [horses, setHorses] = useState([]);
  var [timeRemaining, setTimeRemaining] = useState(0);
  var [simulation, setSimulation] = useState(null);
  var [events, setEvents] = useState([]);
  var [placements, setPlacements] = useState([]);
  var [myResult, setMyResult] = useState(null);
  var [betAmount, setBetAmount] = useState(100);
  var [selectedHorseId, setSelectedHorseId] = useState(null);
  var [myBet, setMyBet] = useState(null);
  var [spectatorCount, setSpectatorCount] = useState(0);
  var [chatMessages, setChatMessages] = useState([]);
  var [chatInput, setChatInput] = useState('');
  var [chatOpen, setChatOpen] = useState(false);
  var [toasts, setToasts] = useState([]);
  var [localChips, setLocalChips] = useState(null);
  var [photoFinish, setPhotoFinish] = useState(false);
  var [phaseEndsAt, setPhaseEndsAt] = useState(null);

  var chips = localChips !== null ? localChips : ((ctx.account && ctx.account.chips) || 0);

  // Sync local chips override with account updates
  useEffect(function() { setLocalChips(null); }, [ctx.account && ctx.account.chips]);

  // Keep horsesRef in sync for animation loop (avoids stale closure)
  useEffect(function() { horsesRef.current = horses; }, [horses]);

  // ---- Refs ----
  var canvasRef = useRef(null);
  var animRef = useRef(null);
  var raceStartTimeRef = useRef(null);
  var simulationRef = useRef(null);
  var interpolatedRef = useRef([]);
  var eventsRef = useRef([]);
  var photoFinishRef = useRef(false);
  var horsesRef = useRef([]);
  var weatherRef = useRef(null);
  var chatBottomRef = useRef(null);
  var weatherParticlesRef = useRef([]);
  var toastIdRef = useRef(0);
  var trackContainerRef = useRef(null);

  // Keep weatherRef in sync for animation loop (avoids stale closure)
  useEffect(function() { weatherRef.current = weather; }, [weather]);

  // ---- Canvas sizing state (responsive for mobile) ----
  var [containerWidth, setContainerWidth] = useState(function() {
    return typeof window !== 'undefined' ? window.innerWidth : 800;
  });

  useEffect(function() {
    function measureWidth() {
      if (trackContainerRef.current) {
        setContainerWidth(trackContainerRef.current.clientWidth);
      } else {
        setContainerWidth(window.innerWidth);
      }
    }
    function onOrientationChange() {
      // Delay measurement to allow layout to settle after rotation
      setTimeout(measureWidth, 150);
    }
    measureWidth();
    window.addEventListener('resize', measureWidth);
    window.addEventListener('orientationchange', onOrientationChange);
    return function() {
      window.removeEventListener('resize', measureWidth);
      window.removeEventListener('orientationchange', onOrientationChange);
    };
  }, []);

  var canvasWidth = isMobile ? Math.min(containerWidth - 16, 2400) : 2400;
  var canvasHeight = isMobile ? 280 : 400;
  // Device pixel ratio for crisp rendering on mobile retina screens
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
  // Cap DPR at 3 to avoid excessive canvas buffer sizes on ultra-high-DPI devices
  if (dpr > 3) dpr = 3;

  // ---- Toast system ----
  function addToast(message, type) {
    var id = ++toastIdRef.current;
    setToasts(function(prev) {
      var next = prev.concat([{ id: id, message: message, type: type || 'info', time: Date.now() }]);
      if (next.length > 5) next = next.slice(next.length - 5);
      return next;
    });
    setTimeout(function() {
      setToasts(function(prev) { return prev.filter(function(t) { return t.id !== id; }); });
    }, 3500);
  }

  // ---- Socket event listeners ----
  // Transform server race events to client rendering format.
  // Server sends: { frame, horseId, horseName, text, effect }
  // Client rendering expects: { atProgress, horseIndex, text, positive }
  function _transformEvents(rawEvents, raceHorses) {
    if (!rawEvents || !rawEvents.length) return [];
    var totalFrames = 20;
    return rawEvents.map(function(ev) {
      var atProgress = typeof ev.atProgress === 'number' ? ev.atProgress
        : (typeof ev.frame === 'number' ? ev.frame / totalFrames : 0);
      var horseIndex = 0;
      if (typeof ev.horseIndex === 'number') {
        horseIndex = ev.horseIndex;
      } else if (ev.horseId && raceHorses) {
        for (var i = 0; i < raceHorses.length; i++) {
          if (raceHorses[i].id === ev.horseId) {
            horseIndex = i;
            break;
          }
        }
      }
      var positive = typeof ev.positive === 'boolean' ? ev.positive
        : (typeof ev.effect === 'number' ? ev.effect > 0 : true);
      return {
        atProgress: atProgress,
        horseIndex: horseIndex,
        text: ev.text || '',
        positive: positive
      };
    });
  }

  useEffect(function() {
    if (!sock) return;

    sock.emit('hr_join');

    function onJoined(data) {
      if (!data) return;
      setPhase(data.phase || 'pre_race');
      setRaceId(data.raceNumber || null);
      setWeather(data.weather || null);
      setHorses(data.horses || []);
      setSpectatorCount(data.spectatorCount || 0);
      setPhaseEndsAt(data.phaseEndsAt || null);
      setMyBet(data.myBet || null);
      setPlacements(data.placements || []);
      setMyResult(data.myResult || null);
      setSelectedHorseId(null);
      if (data.raceData && data.raceData.frames) {
        simulationRef.current = data.raceData.frames;
        setSimulation(data.raceData.frames);
      }
      if (data.raceData && data.raceData.events) {
        var transformedJoinEvents = _transformEvents(data.raceData.events, data.horses || []);
        eventsRef.current = transformedJoinEvents;
        setEvents(transformedJoinEvents);
      }
      if (data.raceData && data.raceData.placements) {
        setPlacements(data.raceData.placements);
      }
      if (data.raceData && data.raceData.photoFinish) {
        photoFinishRef.current = true;
        setPhotoFinish(true);
      }
    }

    function onPreRace(data) {
      if (!data) return;
      setPhase('pre_race');
      setRaceId(data.raceNumber || null);
      setWeather(data.weather || null);
      setHorses(data.horses || []);
      setPhaseEndsAt(data.phaseEndsAt || null);
      setPlacements([]);
      setMyResult(null);
      setMyBet(null);
      setSelectedHorseId(null);
      setSimulation(null);
      setEvents([]);
      setPhotoFinish(false);
      simulationRef.current = null;
      eventsRef.current = [];
      photoFinishRef.current = false;
      interpolatedRef.current = [];
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    }

    function onBetConfirmed(data) {
      if (!data) return;
      setMyBet(data);
      if (data.chips !== undefined) setLocalChips(data.chips);
      addToast('Bet placed: ' + data.amount + ' chips on ' + (data.horseName || 'horse'), 'success');
    }

    function onBetPlaced(data) {
      if (!data) return;
      addToast((data.playerName || 'Someone') + ' bet on ' + (data.horseName || 'a horse'), 'info');
    }

    function onRaceStart(data) {
      if (!data) return;
      setPhase('racing');
      simulationRef.current = data.frames || [];
      setSimulation(data.frames || []);
      if (data.events) {
        var transformedStartEvents = _transformEvents(data.events, horsesRef.current);
        eventsRef.current = transformedStartEvents;
        setEvents(transformedStartEvents);
      }
      if (data.photoFinish) {
        photoFinishRef.current = true;
        setPhotoFinish(true);
      } else {
        photoFinishRef.current = false;
        setPhotoFinish(false);
      }
      raceStartTimeRef.current = Date.now();
      HR_RACE_START_SOUND_PLAYED = false;
      HR_RACE_FINISH_SOUND_PLAYED = false;
      HR_DUST_FRAME_COUNTER.count = 0;
      // Play race start sound
      if (window.BossSounds) BossSounds.play('race_start');
      startRaceAnimation();
    }

    function onRaceResults(data) {
      if (!data) return;
      setPhase('results');
      setPlacements(data.placements || []);
      setMyResult(data.myResult || null);
      setPhaseEndsAt(data.phaseEndsAt || null);
      if (data.chips !== undefined) setLocalChips(data.chips);
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
      // VFX: Win sound (no confetti)
      if (data.myResult && data.myResult.won) {
        if (window.BossSounds) BossSounds.play('win_medium');
      }
    }

    function onSpectatorUpdate(data) {
      if (data && data.count !== undefined) setSpectatorCount(data.count);
    }

    function onChatMsg(data) {
      if (!data) return;
      setChatMessages(function(prev) {
        var next = prev.concat([data]);
        if (next.length > 100) next = next.slice(next.length - 100);
        return next;
      });
    }

    function onError(data) {
      addToast((data && data.message) || 'An error occurred', 'error');
    }

    function onChipsUpdated(data) {
      if (data && data.chips !== undefined) setLocalChips(data.chips);
    }

    sock.on('hr_joined', onJoined);
    sock.on('hr_pre_race', onPreRace);
    sock.on('hr_bet_confirmed', onBetConfirmed);
    sock.on('hr_bet_placed', onBetPlaced);
    sock.on('hr_race_start', onRaceStart);
    sock.on('hr_race_results', onRaceResults);
    sock.on('hr_spectator_update', onSpectatorUpdate);
    sock.on('hr_chat_msg', onChatMsg);
    sock.on('hr_error', onError);
    sock.on('chips_updated', onChipsUpdated);

    return function() {
      sock.emit('hr_leave');
      sock.off('hr_joined', onJoined);
      sock.off('hr_pre_race', onPreRace);
      sock.off('hr_bet_confirmed', onBetConfirmed);
      sock.off('hr_bet_placed', onBetPlaced);
      sock.off('hr_race_start', onRaceStart);
      sock.off('hr_race_results', onRaceResults);
      sock.off('hr_spectator_update', onSpectatorUpdate);
      sock.off('hr_chat_msg', onChatMsg);
      sock.off('hr_error', onError);
      sock.off('chips_updated', onChipsUpdated);
      if (animRef.current) {
        cancelAnimationFrame(animRef.current);
        animRef.current = null;
      }
    };
  }, [sock]);

  // ---- Countdown timer ----
  useEffect(function() {
    if (phase !== 'pre_race' && phase !== 'results') {
      setTimeRemaining(0);
      return;
    }
    if (!phaseEndsAt) return;

    function tick() {
      var now = Date.now();
      var remaining = Math.max(0, Math.ceil((phaseEndsAt - now) / 1000));
      setTimeRemaining(remaining);
    }
    tick();
    var interval = setInterval(tick, 1000);
    return function() { clearInterval(interval); };
  }, [phase, phaseEndsAt]);

  // ---- Auto-scroll chat ----
  useEffect(function() {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // ========================= RACE ANIMATION =========================

  function startRaceAnimation() {
    if (animRef.current) {
      cancelAnimationFrame(animRef.current);
    }
    raceStartTimeRef.current = Date.now();

    function loop() {
      var canvas = canvasRef.current;
      if (!canvas) {
        animRef.current = requestAnimationFrame(loop);
        return;
      }

      var sim = simulationRef.current;
      if (!sim || sim.length === 0) {
        animRef.current = requestAnimationFrame(loop);
        return;
      }

      var elapsed = Date.now() - raceStartTimeRef.current;
      var rawProgress = Math.min(1, elapsed / HR_RACE_DURATION);

      // Photo finish slowdown
      var progress = rawProgress;
      if (photoFinishRef.current && rawProgress > 0.9) {
        var excess = rawProgress - 0.9;
        progress = 0.9 + excess * 0.5;
        progress = Math.min(1, progress);
      }

      var totalFrames = sim.length; // should be 20
      var maxIdx = totalFrames - 1;
      var frameFloat = progress * maxIdx;
      var frameIndex = Math.min(maxIdx - 1, Math.floor(frameFloat));
      if (frameIndex < 0) frameIndex = 0;
      var frameFraction = frameFloat - frameIndex;
      var nextIndex = Math.min(maxIdx, frameIndex + 1);

      // Interpolate horse positions
      var currentFrame = sim[frameIndex];
      var nextFrame = sim[nextIndex];
      var interpolated = [];

      if (currentFrame && nextFrame) {
        for (var h = 0; h < currentFrame.length; h++) {
          var curPos = currentFrame[h].position || 0;
          var nxtPos = nextFrame[h].position || 0;
          var lerpPos = curPos + (nxtPos - curPos) * frameFraction;
          // Frames only contain { id, position }, look up name/color from horses ref
          var horseId = currentFrame[h].id;
          var horseName = '?';
          var horseColor = '#f0b232';
          var horsesArr = horsesRef.current;
          for (var hi2 = 0; hi2 < horsesArr.length; hi2++) {
            if (horsesArr[hi2].id === horseId) {
              horseName = horsesArr[hi2].name;
              horseColor = horsesArr[hi2].color;
              break;
            }
          }
          interpolated.push({
            id: horseId,
            name: horseName,
            color: horseColor,
            position: Math.min(100, lerpPos)
          });
        }
      }

      interpolatedRef.current = interpolated;

      // Auto-scroll track container to follow the leading horse
      if (trackContainerRef.current && interpolated.length > 0) {
        var maxPos = 0;
        for (var mi = 0; mi < interpolated.length; mi++) {
          if (interpolated[mi].position > maxPos) maxPos = interpolated[mi].position;
        }
        var container = trackContainerRef.current;
        var scrollTarget = (maxPos / 100) * (canvas.width / (window.devicePixelRatio || 1)) - container.clientWidth * 0.6;
        container.scrollLeft = Math.max(0, scrollTarget);
      }

      var c = canvas.getContext('2d');
      // Compute DPR and logical size from the canvas buffer and CSS display size
      var curDpr = window.devicePixelRatio || 1;
      if (curDpr > 3) curDpr = 3;
      var W = Math.round(canvas.width / curDpr);
      var H = Math.round(canvas.height / curDpr);
      c.save();
      c.setTransform(curDpr, 0, 0, curDpr, 0, 0);
      drawTrack(c, W, H, interpolated, progress, weatherRef.current, eventsRef.current);
      c.restore();

      // VFX removed (dust particles, screen shake, confetti all disabled)

      // Sound: crowd cheer on race finish
      if (rawProgress >= 1 && !HR_RACE_FINISH_SOUND_PLAYED) {
        HR_RACE_FINISH_SOUND_PLAYED = true;
        if (window.BossSounds) BossSounds.play('crowd_cheer');
      }

      if (rawProgress < 1) {
        animRef.current = requestAnimationFrame(loop);
      } else {
        animRef.current = null;
      }
    }

    animRef.current = requestAnimationFrame(loop);
  }

  // ========================= TRACK DRAWING =========================

  function drawTrack(c, W, H, horsePositions, progress, weatherData, raceEvents) {
    // Clear
    c.clearRect(0, 0, W, H);
    c.fillStyle = HR_COLORS.trackBg;
    c.fillRect(0, 0, W, H);

    var numLanes = 8;
    var laneH = (H - 32) / numLanes; // reserve 16px top/bottom
    var trackTop = 16;
    var startX = 60;
    var finishX = W - 40;
    var trackWidth = finishX - startX;

    // Draw lanes
    for (var i = 0; i < numLanes; i++) {
      var laneY = trackTop + i * laneH;
      c.fillStyle = i % 2 === 0 ? HR_COLORS.laneA : HR_COLORS.laneB;
      c.fillRect(0, laneY, W, laneH);

      // Lane divider
      if (i > 0) {
        c.save();
        c.setLineDash([6, 4]);
        c.strokeStyle = HR_COLORS.laneLine;
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, laneY);
        c.lineTo(W, laneY);
        c.stroke();
        c.restore();
      }
    }

    // Bottom lane divider
    c.save();
    c.setLineDash([6, 4]);
    c.strokeStyle = HR_COLORS.laneLine;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, trackTop + numLanes * laneH);
    c.lineTo(W, trackTop + numLanes * laneH);
    c.stroke();
    c.restore();

    // Terrain color sections (light opacity overlay)
    var terrainHeight = numLanes * laneH;
    var terrainSections = [
      { start: 0,    end: 0.18, color: 'rgba(34,139,34,0.12)' },   // Green grass (start)
      { start: 0.18, end: 0.38, color: 'rgba(139,90,43,0.12)' },   // Brown dirt
      { start: 0.38, end: 0.55, color: 'rgba(34,139,34,0.10)' },   // Green grass (mid)
      { start: 0.55, end: 0.75, color: 'rgba(160,82,45,0.12)' },   // Sienna clay
      { start: 0.75, end: 0.88, color: 'rgba(139,90,43,0.10)' },   // Brown dirt
      { start: 0.88, end: 1.0,  color: 'rgba(34,139,34,0.12)' }    // Green grass (finish)
    ];
    for (var ti = 0; ti < terrainSections.length; ti++) {
      var sect = terrainSections[ti];
      var sx = startX + sect.start * trackWidth;
      var sw = (sect.end - sect.start) * trackWidth;
      c.fillStyle = sect.color;
      c.fillRect(sx, trackTop, sw, terrainHeight);
    }

    // Start line
    c.strokeStyle = '#dcddde';
    c.lineWidth = 2;
    c.setLineDash([]);
    c.beginPath();
    c.moveTo(startX, trackTop);
    c.lineTo(startX, trackTop + numLanes * laneH);
    c.stroke();

    // Finish line (checkered pattern)
    var checkSize = 8;
    var finishWidth = 16;
    for (var cy = 0; cy < numLanes * laneH; cy += checkSize) {
      for (var cx = 0; cx < finishWidth; cx += checkSize) {
        var isWhite = ((Math.floor(cy / checkSize) + Math.floor(cx / checkSize)) % 2 === 0);
        c.fillStyle = isWhite ? '#ffffff' : '#1c1c1e';
        c.fillRect(finishX - finishWidth / 2 + cx, trackTop + cy, checkSize, Math.min(checkSize, numLanes * laneH - cy));
      }
    }

    // Sorted horses by position for ranking
    var sorted = [];
    for (var s = 0; s < horsePositions.length; s++) {
      sorted.push({ idx: s, pos: horsePositions[s].position });
    }
    sorted.sort(function(a, b) { return b.pos - a.pos; });

    var rankMap = {};
    for (var r = 0; r < sorted.length; r++) {
      rankMap[sorted[r].idx] = r + 1;
    }

    // Draw horses
    for (var h = 0; h < horsePositions.length && h < numLanes; h++) {
      var horse = horsePositions[h];
      var laneCenter = trackTop + h * laneH + laneH / 2;
      var hx = startX + (horse.position / 100) * trackWidth;
      var hy = laneCenter;
      var radius = 14;
      var horseColor = horse.color || '#f0b232';

      // Flash when crossing finish
      if (horse.position >= 100) {
        var flashAlpha = 0.15 + 0.1 * Math.sin(Date.now() / 100);
        c.fillStyle = 'rgba(255,255,255,' + flashAlpha + ')';
        c.fillRect(0, trackTop + h * laneH, W, laneH);
      }

      // Trailing dots
      var trailOpacities = [0.5, 0.3, 0.15];
      var trailSizes = [6, 5, 4];
      for (var t = 0; t < 3; t++) {
        var tx = hx - (t + 1) * 14;
        if (tx > startX - 10) {
          c.beginPath();
          c.arc(tx, hy, trailSizes[t], 0, Math.PI * 2);
          c.fillStyle = horseColor;
          c.globalAlpha = trailOpacities[t];
          c.fill();
          c.globalAlpha = 1;
        }
      }

      // Horse circle
      c.beginPath();
      c.arc(hx, hy, radius, 0, Math.PI * 2);
      c.fillStyle = horseColor;
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 2;
      c.stroke();

      // First letter
      c.fillStyle = '#ffffff';
      c.font = 'bold 12px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText((horse.name || '?').charAt(0), hx, hy);

      // Horse name at left edge
      c.fillStyle = horseColor;
      c.font = '11px sans-serif';
      c.textAlign = 'right';
      c.textBaseline = 'middle';
      var safeHorseName = (window.BossEffects && BossEffects.safeCanvasText) ? BossEffects.safeCanvasText(horse.name || '?', 20) : (horse.name || '?');
      c.fillText(safeHorseName, startX - 6, hy);

      // Rank number at right edge
      var rank = rankMap[h] || (h + 1);
      c.fillStyle = rank === 1 ? HR_COLORS.gold : rank <= 3 ? HR_COLORS.green : HR_COLORS.muted;
      c.font = 'bold 12px sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText('#' + rank, finishX + 10, hy);
    }

    // Weather overlay disabled

    // Race events floating text
    if (raceEvents && raceEvents.length > 0) {
      var now = Date.now();
      for (var e = 0; e < raceEvents.length; e++) {
        var ev = raceEvents[e];
        var evProgress = ev.atProgress || 0;
        if (progress >= evProgress && progress < evProgress + 0.15) {
          var evAlpha = 1 - ((progress - evProgress) / 0.15);
          var evLane = ev.horseIndex != null ? ev.horseIndex : 0;
          if (evLane >= 0 && evLane < numLanes) {
            var evY = trackTop + evLane * laneH + 8;
            var evX = startX + (evProgress * trackWidth);
            c.globalAlpha = Math.max(0, evAlpha);
            c.fillStyle = ev.positive ? HR_COLORS.gold : HR_COLORS.red;
            c.font = 'bold 11px sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'bottom';
            c.fillText(ev.text || '', Math.min(evX, finishX - 40), evY - (1 - evAlpha) * 12);
            c.globalAlpha = 1;
          }
        }
      }
    }

    // Photo finish text
    if (photoFinishRef.current && progress > 0.9) {
      var pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200);
      c.globalAlpha = pulse;
      c.fillStyle = HR_COLORS.gold;
      c.font = 'bold 24px sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.shadowColor = HR_COLORS.gold;
      c.shadowBlur = 16;
      c.fillText('PHOTO FINISH!', W / 2, H / 2);
      c.shadowBlur = 0;
      c.globalAlpha = 1;
    }
  }

  // ========================= WEATHER OVERLAY =========================

  function drawWeatherOverlay(c, W, H, weatherData, progress) {
    if (!weatherData) return;
    var name = typeof weatherData === 'string' ? weatherData : (weatherData.name || '');

    if (name === 'Rainy') {
      // Animated rain particles
      c.fillStyle = 'rgba(100,150,255,0.4)';
      var seed = Math.floor(Date.now() / 60);
      for (var p = 0; p < 15; p++) {
        var px = ((seed * 37 + p * 131) % 1000) / 1000 * W;
        var py = ((seed * 53 + p * 97 + Date.now() / 30) % H);
        c.fillRect(px, py, 1.5, 8);
      }
    } else if (name === 'Muddy') {
      // Brown tint at bottom 20%
      var mudGrad = c.createLinearGradient(0, H * 0.8, 0, H);
      mudGrad.addColorStop(0, 'rgba(101,67,33,0)');
      mudGrad.addColorStop(1, 'rgba(101,67,33,0.2)');
      c.fillStyle = mudGrad;
      c.fillRect(0, H * 0.8, W, H * 0.2);
    } else if (name === 'Windy') {
      // Horizontal streaks
      c.strokeStyle = 'rgba(200,200,200,0.08)';
      c.lineWidth = 1;
      var windSeed = Math.floor(Date.now() / 80);
      for (var w = 0; w < 12; w++) {
        var wy = ((windSeed * 47 + w * 89) % 1000) / 1000 * H;
        var wx = ((windSeed * 23 + w * 67 + Date.now() / 20) % (W + 100)) - 50;
        c.beginPath();
        c.moveTo(wx, wy);
        c.lineTo(wx + 40 + (w % 3) * 20, wy);
        c.stroke();
      }
    } else if (name === 'Foggy') {
      // Semi-transparent white gradient overlay
      var fogGrad = c.createLinearGradient(0, 0, W, H);
      fogGrad.addColorStop(0, 'rgba(255,255,255,0.08)');
      fogGrad.addColorStop(0.5, 'rgba(255,255,255,0.04)');
      fogGrad.addColorStop(1, 'rgba(255,255,255,0.08)');
      c.fillStyle = fogGrad;
      c.fillRect(0, 0, W, H);
    } else if (name === 'Sunny') {
      // Yellow glow top-left
      var sunGrad = c.createRadialGradient(40, 20, 0, 40, 20, 120);
      sunGrad.addColorStop(0, 'rgba(240,178,50,0.12)');
      sunGrad.addColorStop(1, 'rgba(240,178,50,0)');
      c.fillStyle = sunGrad;
      c.fillRect(0, 0, 200, 160);
    }
  }

  // ========================= STATIC TRACK DRAWING (pre_race / results) =========================

  useEffect(function() {
    if (phase === 'racing') return; // animation loop handles this
    var canvas = canvasRef.current;
    if (!canvas) return;
    var c = canvas.getContext('2d');
    // DPR-aware: compute logical dimensions from buffer
    var curDpr = window.devicePixelRatio || 1;
    if (curDpr > 3) curDpr = 3;
    var W = Math.round(canvas.width / curDpr);
    var H = Math.round(canvas.height / curDpr);

    // Build static horse positions
    var staticHorses = [];
    if (phase === 'results' && placements.length > 0) {
      // Show final positions
      for (var i = 0; i < horses.length; i++) {
        var placement = null;
        for (var p = 0; p < placements.length; p++) {
          if (placements[p].id === horses[i].id) {
            placement = placements[p];
            break;
          }
        }
        staticHorses.push({
          id: horses[i].id,
          name: horses[i].name,
          color: horses[i].color,
          position: 100
        });
      }
    } else {
      // Pre-race: all at start
      for (var j = 0; j < horses.length; j++) {
        staticHorses.push({
          id: horses[j].id,
          name: horses[j].name,
          color: horses[j].color,
          position: 0
        });
      }
    }

    c.save();
    c.setTransform(curDpr, 0, 0, curDpr, 0, 0);
    drawTrack(c, W, H, staticHorses, phase === 'results' ? 1 : 0, weather, []);
    c.restore();
  }, [phase, horses, placements, weather, canvasWidth, canvasHeight]);

  // ========================= ACTIONS =========================

  function selectHorse(horseId) {
    if (phase !== 'pre_race' || myBet) return;
    setSelectedHorseId(function(prev) { return prev === horseId ? null : horseId; });
  }

  function placeBet() {
    if (!sock || phase !== 'pre_race' || myBet || !selectedHorseId) return;
    if (betAmount < 10 || betAmount > 1000) {
      addToast('Bet must be between 10 and 1,000 chips', 'error');
      return;
    }
    if (chips < betAmount) {
      addToast('Not enough chips', 'error');
      return;
    }
    sock.emit('hr_place_bet', { horseId: selectedHorseId, amount: betAmount });
  }

  function sendChat() {
    if (!sock || !chatInput.trim()) return;
    sock.emit('hr_chat', { message: chatInput.trim() });
    setChatInput('');
  }

  // ========================= HELPERS =========================

  function getOddsInfo(odds) {
    if (odds <= 2) return { label: 'Favorite', color: HR_COLORS.gold };
    if (odds <= 5) return { label: 'Contender', color: HR_COLORS.text };
    if (odds <= 10) return { label: 'Longshot', color: HR_COLORS.green };
    return { label: 'Dark Horse', color: HR_COLORS.red };
  }

  function getStatColor(val) {
    if (val > 70) return HR_COLORS.green;
    if (val > 50) return HR_COLORS.gold;
    return HR_COLORS.red;
  }

  function getWeatherName() {
    if (!weather) return '';
    return typeof weather === 'string' ? weather : (weather.name || '');
  }

  function getWeatherIcon() {
    var name = getWeatherName();
    return HR_WEATHER_ICONS[name] || '';
  }

  // Get live ranking of horses during racing phase
  function getLiveRanking() {
    var interp = interpolatedRef.current;
    if (!interp || interp.length === 0) return horses.map(function(h) { return h.id; });
    var sorted = interp.slice().sort(function(a, b) { return b.position - a.position; });
    return sorted.map(function(h) { return h.id; });
  }

  // ========================= CANVAS SIZE =========================
  // (canvas width/height are computed above from containerWidth state and isMobile)

  // ========================= RENDER =========================

  return React.createElement('div', {
    style: {
      flex: 1, display: 'flex', flexDirection: 'column', background: HR_COLORS.bg,
      overflow: 'auto', position: 'relative', fontFamily: 'inherit'
    }
  },
    // Toast notifications
    React.createElement('div', {
      style: {
        position: 'fixed', top: 60, right: 16, zIndex: 10000,
        display: 'flex', flexDirection: 'column', gap: '6px', pointerEvents: 'none'
      }
    },
      toasts.map(function(toast) {
        var bg = toast.type === 'error' ? 'rgba(237,66,69,0.95)'
               : toast.type === 'success' ? 'rgba(87,242,135,0.95)'
               : 'rgba(37,37,40,0.95)';
        var fg = toast.type === 'error' ? '#ffffff'
               : toast.type === 'success' ? '#1c1c1e'
               : HR_COLORS.text;
        return React.createElement('div', {
          key: toast.id,
          style: {
            padding: '8px 16px', borderRadius: '8px', background: bg,
            color: fg, fontSize: '13px', fontWeight: 600,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)', pointerEvents: 'auto',
            border: '1px solid rgba(255,255,255,0.1)'
          }
        }, toast.message);
      })
    ),

    // 1. Header Bar
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', background: HR_COLORS.panel,
        borderBottom: '2px solid ' + HR_COLORS.gold, flexShrink: 0
      }
    },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '10px' }
      },
        React.createElement('span', {
          style: {
            fontSize: '20px', fontWeight: 800, color: HR_COLORS.gold,
            textShadow: '0 0 12px rgba(240,178,50,0.3)', letterSpacing: '1px'
          }
        }, '\uD83C\uDFC7 HORSE RACING'),
        React.createElement('span', {
          style: {
            fontSize: '12px', color: HR_COLORS.muted, background: HR_COLORS.bg,
            padding: '2px 8px', borderRadius: '10px'
          }
        }, chips.toLocaleString() + ' chips')
      ),
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '12px' }
      },
        raceId ? React.createElement('span', {
          style: { fontSize: '13px', fontWeight: 600, color: HR_COLORS.text }
        }, 'Race #' + raceId) : null,
        React.createElement('span', {
          style: {
            fontSize: '12px', color: HR_COLORS.muted, background: 'rgba(255,255,255,0.05)',
            padding: '3px 10px', borderRadius: '12px'
          }
        }, '\uD83D\uDC41 ' + spectatorCount)
      )
    ),

    // 2. Info Strip
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 20px', background: 'rgba(37,37,40,0.6)',
        borderBottom: '1px solid ' + HR_COLORS.border, flexShrink: 0,
        flexWrap: 'wrap', gap: '8px'
      }
    },
      // Weather
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }
      },
        React.createElement('span', { style: { fontSize: '18px' } }, getWeatherIcon()),
        React.createElement('span', { style: { color: HR_COLORS.text, fontWeight: 600 } }, getWeatherName() || 'Loading...')
      ),
      // Status / countdown
      React.createElement('div', {
        style: { textAlign: 'center' }
      },
        phase === 'pre_race' ? React.createElement('span', {
          style: {
            fontSize: '14px', fontWeight: 700,
            color: timeRemaining <= 5 ? HR_COLORS.red : HR_COLORS.gold
          }
        }, 'Betting closes in ' + timeRemaining + 's')
        : phase === 'racing' ? React.createElement('span', {
          style: { fontSize: '14px', fontWeight: 700, color: HR_COLORS.green }
        }, 'RACE IN PROGRESS')
        : phase === 'results' ? React.createElement('span', {
          style: { fontSize: '14px', fontWeight: 700, color: HR_COLORS.gold }
        }, 'Results - Next race in ' + timeRemaining + 's')
        : React.createElement('span', {
          style: { fontSize: '13px', color: HR_COLORS.muted }
        }, 'Connecting...')
      ),
      // Bet summary
      React.createElement('div', {
        style: { fontSize: '12px', color: HR_COLORS.muted, textAlign: 'right' }
      },
        myBet ? React.createElement('span', {
          style: { color: HR_COLORS.green, fontWeight: 600 }
        }, myBet.amount + ' on ' + (myBet.horseName || 'Horse') + ' @ ' + (myBet.odds || '?') + 'x')
        : phase === 'pre_race' ? 'No bet placed' : null
      )
    ),

    // Scrollable content area
    React.createElement('div', {
      style: { flex: 1, overflow: 'auto', padding: isMobile ? '8px' : '16px 20px' }
    },

      // 3. Race Track (Canvas)
      React.createElement('div', {
        ref: trackContainerRef,
        style: {
          display: 'flex', justifyContent: 'flex-start', marginBottom: '16px',
          width: '100%', overflowX: 'auto', overflowY: 'hidden',
          borderRadius: '12px', border: '1px solid ' + HR_COLORS.border,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
        }
      },
        React.createElement('canvas', {
          ref: canvasRef,
          width: Math.round(canvasWidth * dpr),
          height: Math.round(canvasHeight * dpr),
          style: {
            background: HR_COLORS.trackBg,
            width: canvasWidth + 'px', minWidth: canvasWidth + 'px',
            height: 'auto',
            touchAction: 'pan-x pan-y'
          }
        })
      ),

      // 4. Horse Cards Grid
      React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)',
          gap: '10px', marginBottom: '16px'
        }
      },
        horses.map(function(horse) {
          var isSelected = selectedHorseId === horse.id;
          var isBetHorse = myBet && myBet.horseId === horse.id;
          var hasBetOnOther = myBet && myBet.horseId !== horse.id;
          var oddsInfo = getOddsInfo(horse.odds || 1);
          var moodColor = HR_MOOD_COLORS[horse.mood] || HR_COLORS.muted;
          var stats = horse.stats || {};

          // Live ranking badge during racing
          var liveRank = null;
          if (phase === 'racing') {
            var ranking = getLiveRanking();
            for (var ri = 0; ri < ranking.length; ri++) {
              if (ranking[ri] === horse.id) {
                liveRank = ri + 1;
                break;
              }
            }
          }

          return React.createElement('div', {
            key: horse.id,
            style: {
              background: isSelected ? 'rgba(240,178,50,0.08)' : HR_COLORS.panel,
              borderRadius: '10px', padding: '12px',
              border: '2px solid ' + (isBetHorse ? HR_COLORS.green : isSelected ? HR_COLORS.gold : HR_COLORS.border),
              cursor: (phase === 'pre_race' && !myBet) ? 'pointer' : 'default',
              transition: 'all 0.2s', position: 'relative',
              boxShadow: isSelected ? '0 0 12px rgba(240,178,50,0.15)' : 'none'
            },
            onClick: function() { selectHorse(horse.id); },
            onMouseEnter: isMobile ? undefined : function(e) {
              if (phase === 'pre_race' && !myBet) {
                e.currentTarget.style.borderColor = HR_COLORS.gold;
              }
            },
            onMouseLeave: isMobile ? undefined : function(e) {
              if (!isSelected && !isBetHorse) {
                e.currentTarget.style.borderColor = HR_COLORS.border;
              }
            }
          },
            // Live rank badge
            liveRank ? React.createElement('div', {
              style: {
                position: 'absolute', top: '-8px', right: '-8px',
                width: '24px', height: '24px', borderRadius: '50%',
                background: liveRank === 1 ? HR_COLORS.gold : liveRank <= 3 ? HR_COLORS.green : HR_COLORS.border,
                color: liveRank <= 3 ? '#1c1c1e' : '#ffffff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 800,
                boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
              }
            }, '#' + liveRank) : null,

            // Header row: color dot + name + mood
            React.createElement('div', {
              style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }
            },
              React.createElement('div', {
                style: {
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: horse.color || HR_COLORS.gold, flexShrink: 0
                }
              }),
              React.createElement('span', {
                style: { fontSize: '14px', fontWeight: 700, color: horse.color || HR_COLORS.gold, flex: 1 }
              }, horse.name || 'Unknown'),
              horse.mood ? React.createElement('span', {
                style: {
                  fontSize: '10px', fontWeight: 600, color: moodColor,
                  background: 'rgba(' + (horse.mood === 'Energetic' ? '87,242,135' : horse.mood === 'Calm' ? '88,101,242' : horse.mood === 'Nervous' ? '240,178,50' : horse.mood === 'Aggressive' ? '237,66,69' : '148,155,164') + ',0.15)',
                  padding: '2px 8px', borderRadius: '10px'
                }
              }, horse.mood) : null
            ),

            // Stat bars
            React.createElement('div', {
              style: { marginBottom: '8px' }
            },
              ['Speed', 'Stamina', 'Acceleration', 'Luck'].map(function(stat, si) {
                var abbr = stat === 'Acceleration' ? 'Acc' : stat === 'Stamina' ? 'Sta' : stat === 'Luck' ? 'Lck' : stat;
                var key = stat.toLowerCase();
                var val = stats[key] || stats[abbr.toLowerCase()] || stats[stat.charAt(0).toLowerCase() + stat.slice(1)] || 50;
                return React.createElement('div', {
                  key: stat,
                  style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }
                },
                  React.createElement('span', {
                    style: { fontSize: '10px', color: HR_COLORS.muted, width: '28px', textAlign: 'right' }
                  }, abbr),
                  React.createElement('div', {
                    style: {
                      flex: 1, height: '6px', background: HR_COLORS.statBarBg,
                      borderRadius: '3px', overflow: 'hidden'
                    }
                  },
                    React.createElement('div', {
                      style: {
                        width: Math.min(100, val) + '%', height: '100%',
                        background: getStatColor(val), borderRadius: '3px',
                        transition: 'width 0.3s'
                      }
                    })
                  ),
                  React.createElement('span', {
                    style: { fontSize: '10px', color: getStatColor(val), width: '22px', textAlign: 'left', fontWeight: 600 }
                  }, val)
                );
              })
            ),

            // Skills
            horse.skills && horse.skills.length > 0 ? React.createElement('div', {
              style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }
            },
              horse.skills.map(function(skill, si) {
                return React.createElement('span', {
                  key: si,
                  style: {
                    fontSize: '10px', color: HR_COLORS.muted, background: HR_COLORS.badgeBg,
                    padding: '2px 6px', borderRadius: '8px'
                  }
                }, skill);
              })
            ) : null,

            // Odds + bet button row
            React.createElement('div', {
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderTop: '1px solid ' + HR_COLORS.border, paddingTop: '8px'
              }
            },
              // Odds display
              React.createElement('div', {
                style: { textAlign: 'left' }
              },
                React.createElement('div', {
                  style: { fontSize: '18px', fontWeight: 800, color: oddsInfo.color }
                }, (horse.odds || 1).toFixed(1) + 'x'),
                React.createElement('div', {
                  style: { fontSize: '10px', color: oddsInfo.color, fontWeight: 600 }
                }, oddsInfo.label)
              ),

              // Bet button
              phase === 'pre_race' ? (
                isBetHorse ? React.createElement('div', {
                  style: {
                    fontSize: '12px', fontWeight: 700, color: HR_COLORS.green,
                    background: 'rgba(87,242,135,0.12)', padding: '6px 12px',
                    borderRadius: '6px', border: '1px solid ' + HR_COLORS.green
                  }
                }, 'YOUR BET \u2713')
                : hasBetOnOther ? React.createElement('div', {
                  style: {
                    fontSize: '11px', color: HR_COLORS.muted, padding: '6px 10px',
                    opacity: 0.4
                  }
                }, 'Bet placed')
                : React.createElement('button', {
                  style: {
                    padding: '6px 14px', border: 'none', borderRadius: '6px',
                    background: isSelected ? HR_COLORS.gold : HR_COLORS.border,
                    color: isSelected ? '#1c1c1e' : HR_COLORS.text,
                    fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'inherit', transition: 'all 0.15s'
                  },
                  onClick: function(e) {
                    e.stopPropagation();
                    selectHorse(horse.id);
                  },
                  onMouseEnter: isMobile ? undefined : function(e) {
                    e.currentTarget.style.background = HR_COLORS.gold;
                    e.currentTarget.style.color = '#1c1c1e';
                  },
                  onMouseLeave: isMobile ? undefined : function(e) {
                    if (!isSelected) {
                      e.currentTarget.style.background = HR_COLORS.border;
                      e.currentTarget.style.color = HR_COLORS.text;
                    }
                  }
                }, 'SELECT')
              ) : null
            )
          );
        })
      ),

      // 5. Bet Controls Strip
      phase === 'pre_race' ? React.createElement('div', {
        style: {
          background: HR_COLORS.panel, borderRadius: '10px', padding: '12px 16px',
          marginBottom: '16px', border: '1px solid ' + HR_COLORS.border
        }
      },
        myBet ? React.createElement('div', {
          style: {
            textAlign: 'center', padding: '8px 0',
            color: HR_COLORS.green, fontSize: '14px', fontWeight: 600
          }
        },
          'Bet: ' + myBet.amount.toLocaleString() + ' on ' + (myBet.horseName || 'Horse') + ' | Potential win: ' + (myBet.potentialWin || (myBet.amount * (myBet.odds || 1))).toLocaleString()
        )
        : React.createElement('div', {
          style: { display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }
        },
          // Quick bet amounts
          React.createElement('div', {
            style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }
          },
            React.createElement('span', {
              style: { fontSize: '12px', color: HR_COLORS.muted, fontWeight: 600, alignSelf: 'center', marginRight: '4px' }
            }, 'Amount:'),
            HR_BET_AMOUNTS.map(function(amt) {
              var isActive = betAmount === amt;
              return React.createElement('button', {
                key: amt,
                style: {
                  padding: '5px 12px', border: '1px solid ' + (isActive ? HR_COLORS.gold : HR_COLORS.border),
                  borderRadius: '6px', background: isActive ? 'rgba(240,178,50,0.15)' : HR_COLORS.bg,
                  color: isActive ? HR_COLORS.gold : HR_COLORS.text,
                  fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s'
                },
                onClick: function() { setBetAmount(amt); }
              }, amt.toLocaleString());
            })
          ),

          // Place bet button
          React.createElement('button', {
            style: {
              padding: '10px 32px', border: 'none', borderRadius: '8px',
              background: (!selectedHorseId || chips < betAmount) ? HR_COLORS.border : HR_COLORS.gold,
              color: (!selectedHorseId || chips < betAmount) ? HR_COLORS.muted : '#1c1c1e',
              fontSize: '15px', fontWeight: 700, cursor: (!selectedHorseId || chips < betAmount) ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', transition: 'all 0.2s',
              opacity: (!selectedHorseId || chips < betAmount) ? 0.5 : 1,
              boxShadow: selectedHorseId && chips >= betAmount ? '0 0 16px rgba(240,178,50,0.25)' : 'none'
            },
            onClick: placeBet,
            disabled: !selectedHorseId || chips < betAmount
          },
            !selectedHorseId ? 'Select a horse to bet'
            : chips < betAmount ? 'Not enough chips'
            : 'Place Bet (' + betAmount.toLocaleString() + ' chips)'
          ),

          selectedHorseId ? React.createElement('div', {
            style: { fontSize: '11px', color: HR_COLORS.muted, textAlign: 'center' }
          }, (function() {
            var sel = null;
            for (var i = 0; i < horses.length; i++) {
              if (horses[i].id === selectedHorseId) { sel = horses[i]; break; }
            }
            if (!sel) return '';
            var potWin = Math.floor(betAmount * (sel.odds || 1));
            return 'Betting ' + betAmount.toLocaleString() + ' on ' + sel.name + ' @ ' + (sel.odds || 1).toFixed(1) + 'x = ' + potWin.toLocaleString() + ' potential win';
          })()) : null
        )
      ) : null,

      // 6. Results Overlay
      phase === 'results' && placements.length > 0 ? React.createElement('div', {
        style: {
          background: 'linear-gradient(135deg, rgba(37,37,40,0.95), rgba(28,28,30,0.98))',
          borderRadius: '14px', padding: '24px', marginBottom: '16px',
          border: '2px solid ' + HR_COLORS.gold,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
        }
      },
        // Podium title
        React.createElement('div', {
          style: { textAlign: 'center', marginBottom: '20px' }
        },
          React.createElement('div', {
            style: {
              fontSize: '22px', fontWeight: 800, color: HR_COLORS.gold,
              textShadow: '0 0 16px rgba(240,178,50,0.3)',
              marginBottom: '4px'
            }
          }, 'RACE RESULTS'),
          React.createElement('div', {
            style: { fontSize: '12px', color: HR_COLORS.muted }
          }, 'Race #' + (raceId || '?'))
        ),

        // Top 3 podium
        React.createElement('div', {
          style: {
            display: 'flex', justifyContent: 'center', gap: '16px',
            marginBottom: '20px', flexWrap: 'wrap'
          }
        },
          placements.slice(0, 3).map(function(place, idx) {
            var medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];
            var podiumColors = [HR_COLORS.gold, '#c0c0c0', '#cd7f32'];
            return React.createElement('div', {
              key: place.id || idx,
              style: {
                textAlign: 'center', padding: '16px 20px',
                background: 'rgba(' + (idx === 0 ? '240,178,50' : idx === 1 ? '192,192,192' : '205,127,50') + ',0.08)',
                borderRadius: '12px', minWidth: '100px',
                border: '1px solid ' + podiumColors[idx],
                transform: idx === 0 ? 'scale(1.05)' : 'none'
              }
            },
              React.createElement('div', {
                style: { fontSize: '32px', marginBottom: '4px' }
              }, medals[idx]),
              React.createElement('div', {
                style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '4px' }
              },
                React.createElement('div', {
                  style: {
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: place.color || HR_COLORS.gold
                  }
                }),
                React.createElement('span', {
                  style: { fontSize: '15px', fontWeight: 700, color: place.color || HR_COLORS.text }
                }, place.name || 'Horse')
              ),
              React.createElement('div', {
                style: { fontSize: '11px', color: HR_COLORS.muted }
              }, '#' + (idx + 1) + ' Place')
            );
          })
        ),

        // Remaining placements
        placements.length > 3 ? React.createElement('div', {
          style: {
            display: 'flex', flexWrap: 'wrap', gap: '6px',
            justifyContent: 'center', marginBottom: '16px'
          }
        },
          placements.slice(3).map(function(place, idx) {
            return React.createElement('span', {
              key: place.id || (idx + 3),
              style: {
                fontSize: '11px', color: HR_COLORS.muted, background: HR_COLORS.bg,
                padding: '3px 10px', borderRadius: '10px'
              }
            }, '#' + (idx + 4) + ' ' + (place.name || 'Horse'));
          })
        ) : null,

        // Your result
        myResult ? React.createElement('div', {
          style: {
            textAlign: 'center', padding: '16px',
            background: myResult.won ? 'rgba(87,242,135,0.1)' : 'rgba(237,66,69,0.05)',
            borderRadius: '10px', border: '1px solid ' + (myResult.won ? HR_COLORS.green : HR_COLORS.border)
          }
        },
          myResult.won ? React.createElement('div', null,
            React.createElement('div', {
              style: {
                fontSize: '24px', fontWeight: 800, color: HR_COLORS.green,
                textShadow: '0 0 20px rgba(87,242,135,0.4)',
                marginBottom: '4px'
              }
            }, 'YOU WON ' + (myResult.payout || 0).toLocaleString() + ' CHIPS!'),
            React.createElement('div', {
              style: { fontSize: '12px', color: HR_COLORS.green }
            }, 'Bet ' + (myResult.amount || 0).toLocaleString() + ' @ ' + (myResult.odds || '?') + 'x on ' + (myResult.horseName || 'Horse'))
          )
          : React.createElement('div', null,
            React.createElement('div', {
              style: { fontSize: '16px', fontWeight: 600, color: HR_COLORS.red, marginBottom: '4px' }
            }, 'Better luck next time'),
            React.createElement('div', {
              style: { fontSize: '12px', color: HR_COLORS.muted }
            }, 'Lost ' + (myResult.amount || 0).toLocaleString() + ' chips')
          )
        ) : (myBet && phase === 'results') ? React.createElement('div', {
          style: {
            textAlign: 'center', padding: '12px',
            background: 'rgba(237,66,69,0.05)', borderRadius: '10px',
            border: '1px solid ' + HR_COLORS.border
          }
        },
          React.createElement('div', {
            style: { fontSize: '16px', fontWeight: 600, color: HR_COLORS.red }
          }, 'Better luck next time'),
          React.createElement('div', {
            style: { fontSize: '12px', color: HR_COLORS.muted, marginTop: '4px' }
          }, 'Lost ' + (myBet.amount || 0).toLocaleString() + ' chips')
        ) : null,

        // Next race countdown
        timeRemaining > 0 ? React.createElement('div', {
          style: {
            textAlign: 'center', marginTop: '16px',
            fontSize: '13px', color: HR_COLORS.muted
          }
        }, 'Next race in ' + timeRemaining + 's...') : null
      ) : null
    ),

    // 7. Chat Strip (bottom, collapsible)
    React.createElement('div', {
      style: {
        flexShrink: 0, background: HR_COLORS.panel,
        borderTop: '1px solid ' + HR_COLORS.border
      }
    },
      // Toggle bar
      React.createElement('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 16px', cursor: 'pointer'
        },
        onClick: function() { setChatOpen(function(v) { return !v; }); }
      },
        React.createElement('span', {
          style: { fontSize: '12px', fontWeight: 600, color: HR_COLORS.muted }
        }, 'Race Chat (' + chatMessages.length + ')'),
        React.createElement('span', {
          style: { fontSize: '14px', color: HR_COLORS.muted, transform: chatOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }
        }, '\u25B2')
      ),

      // Chat body
      chatOpen ? React.createElement('div', {
        style: { padding: '0 16px 8px 16px' }
      },
        // Messages
        React.createElement('div', {
          style: {
            maxHeight: '120px', overflowY: 'auto', marginBottom: '8px',
            fontSize: '12px', lineHeight: '1.6'
          }
        },
          chatMessages.length === 0 ? React.createElement('div', {
            style: { color: HR_COLORS.muted, textAlign: 'center', padding: '8px 0' }
          }, 'No messages yet')
          : chatMessages.map(function(msg, idx) {
            return React.createElement('div', { key: idx },
              React.createElement('span', {
                style: { color: msg.color || HR_COLORS.gold, fontWeight: 600 }
              }, (msg.name || 'Anon') + ': '),
              React.createElement('span', {
                style: { color: HR_COLORS.text }
              }, ctx.censorText ? ctx.censorText(msg.text || '') : (msg.text || ''))
            );
          }),
          React.createElement('div', { ref: chatBottomRef })
        ),

        // Input
        React.createElement('div', {
          style: { display: 'flex', gap: '6px' }
        },
          React.createElement('input', {
            type: 'text',
            value: chatInput,
            placeholder: 'Say something...',
            maxLength: 200,
            style: {
              flex: 1, padding: '6px 10px', background: HR_COLORS.bg,
              border: '1px solid ' + HR_COLORS.border, borderRadius: '6px',
              color: HR_COLORS.text, fontSize: '12px', fontFamily: 'inherit',
              outline: 'none'
            },
            onChange: function(e) { setChatInput(e.target.value); },
            onKeyDown: function(e) { if (e.key === 'Enter') sendChat(); }
          }),
          React.createElement('button', {
            style: {
              padding: '6px 14px', background: HR_COLORS.gold, border: 'none',
              borderRadius: '6px', color: '#1c1c1e', fontSize: '12px',
              fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
            },
            onClick: sendChat
          }, 'Send')
        )
      ) : null
    )
  );
}
