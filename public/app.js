// LivePuzzle - app.js
console.log("LivePuzzle loaded")

document.addEventListener('DOMContentLoaded', () => {

  // --- Hidden video element (shared between overlay and game) ---
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;

  // --- MediaPipe Hands (shared instance) ---
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.85,
    minTrackingConfidence: 0.85,
  });

  // --- MediaPipe Camera (shared instance — started once, never recreated) ---
  const camera = new Camera(video, {
    onFrame: async () => {
      await hands.send({ image: video });
    },
    width: 640,
    height: 480,
    frameRate: 30,
  });

  camera.start();

  // --- Check for existing username ---
  const storedUsername = localStorage.getItem('livepuzzle_username');

  if (storedUsername !== null) {
    // Username key exists (even empty string = previously skipped) — go straight to game
    initGame();
  } else {
    // First ever visit — show registration overlay
    showRegistrationOverlay();
  }

  // ==========================================================================
  //  REGISTRATION OVERLAY
  // ==========================================================================
  function showRegistrationOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'reg-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      z-index: 9999; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
    `;

    // Live blurred camera canvas
    const blurCanvas = document.createElement('canvas');
    blurCanvas.id = 'reg-blur-canvas';
    blurCanvas.width = 640;
    blurCanvas.height = 480;
    blurCanvas.style.cssText = `
      position: absolute; top: 0; left: 0;
      width: 100%; height: 100%;
      filter: blur(14px); transform: scale(1.05);
    `;
    const blurCtx = blurCanvas.getContext('2d');
    overlay.appendChild(blurCanvas);

    // Draw mirrored camera frames to blur canvas during registration
    hands.onResults((results) => {
      blurCtx.save();
      blurCtx.scale(-1, 1);
      blurCtx.drawImage(results.image, -640, 0, 640, 480);
      blurCtx.restore();
    });

    // Card
    const card = document.createElement('div');
    card.style.cssText = `
      position: relative; z-index: 1;
      background: rgba(0,0,0,0.75); border: 1px solid #00FF00;
      padding: 40px 52px; display: flex; flex-direction: column;
      align-items: center; gap: 16px;
    `;

    // Title
    const title = document.createElement('div');
    title.textContent = 'LIVE PUZZLE';
    title.style.cssText = `
      color: #00FF00; font-size: 1.4rem; letter-spacing: 0.3em;
      font-weight: 700; font-family: 'Space Mono', monospace;
    `;

    // Subtitle
    const subtitle = document.createElement('div');
    subtitle.textContent = 'ENTER YOUR CALLSIGN';
    subtitle.style.cssText = `
      color: rgba(255,255,255,0.5); font-size: 0.55rem;
      letter-spacing: 0.2em; font-family: 'Space Mono', monospace;
    `;

    // Input
    const nameInput = document.createElement('input');
    nameInput.maxLength = 12;
    nameInput.style.cssText = `
      background: transparent; border: none;
      border-bottom: 1px solid #00FF00; color: #00FF00;
      font-family: 'Space Mono', monospace; font-size: 0.7rem;
      letter-spacing: 0.15em; padding: 8px; outline: none;
      text-align: center; width: 200px; text-transform: uppercase;
    `;

    // START button
    const startBtn = document.createElement('button');
    startBtn.textContent = 'START';
    startBtn.style.cssText = `
      background: transparent; border: 1px solid #00FF00;
      color: #00FF00; font-family: 'Space Mono', monospace;
      font-size: 0.65rem; letter-spacing: 0.2em;
      padding: 10px 24px; cursor: pointer;
      min-height: 44px; white-space: nowrap;
    `;

    startBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim().toUpperCase();
      if (!name) {
        nameInput.style.borderBottomColor = '#FF0000';
        setTimeout(() => { nameInput.style.borderBottomColor = '#00FF00'; }, 400);
        return;
      }
      localStorage.setItem('livepuzzle_username', name);
      try {
        await db.collection('users').add({
          name: name,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } catch (e) {
        console.error('Firestore user save error:', e);
      }
      overlay.remove();
      initGame();
    });

    // SKIP link
    const skipLink = document.createElement('button');
    skipLink.textContent = 'SKIP →';
    skipLink.style.cssText = `
      color: rgba(0,255,0,0.4); font-size: 0.5rem; cursor: pointer;
      letter-spacing: 0.15em; margin-top: 4px; background: none;
      border: none; font-family: 'Space Mono', monospace;
    `;

    skipLink.addEventListener('click', () => {
      localStorage.setItem('livepuzzle_username', '');
      overlay.remove();
      initGame();
    });

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(nameInput);
    card.appendChild(startBtn);
    card.appendChild(skipLink);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // ==========================================================================
  //  MAIN GAME INITIALISATION
  // ==========================================================================
  function initGame() {
    const gameContainer = document.getElementById('game-container');
    renderLeaderboardPanel();

    let appState = 'capture'; // 'capture' or 'solve'

    // --- Puzzle state ---
    let tiles = []; // {correct, current, canvas}
    let gridX, gridY, gridW, gridH, tileW, tileH;
    let dragTile = null; // {tileIndex, offsetX, offsetY, currentX, currentY}
    let puzzleStartTime = null;
    let puzzleElapsed = 0;
    let solveDragEnabled = false;

    // --- Canvas setup ---
    const videoCanvas = document.createElement('canvas');
    videoCanvas.id = 'video-canvas';
    videoCanvas.width = 640;
    videoCanvas.height = 480;

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'overlay-canvas';
    overlayCanvas.width = 640;
    overlayCanvas.height = 480;
    overlayCanvas.style.position = 'absolute';
    overlayCanvas.style.top = '0';
    overlayCanvas.style.left = '0';

    gameContainer.appendChild(videoCanvas);
    gameContainer.appendChild(overlayCanvas);

    const videoCtx = videoCanvas.getContext('2d');
    const overlayCtx = overlayCanvas.getContext('2d');

    // --- Helper: convert normalised landmark to canvas pixels ---
    function getLandmarkPoint(landmark, canvasWidth, canvasHeight) {
      return {
        x: landmark.x * canvasWidth,
        y: landmark.y * canvasHeight,
      };
    }

    // --- Helper: pixel distance between index tip (8) and thumb tip (4) ---
    function getPinchDistance(landmarks, canvasWidth, canvasHeight) {
      const indexTip = getLandmarkPoint(landmarks[8], canvasWidth, canvasHeight);
      const thumbTip = getLandmarkPoint(landmarks[4], canvasWidth, canvasHeight);
      const dx = indexTip.x - thumbTip.x;
      const dy = indexTip.y - thumbTip.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    // --- Capture image from videoCanvas region and transition to solve mode ---
    function captureImage(rect) {
      const offscreen = document.createElement('canvas');
      offscreen.width = rect.width;
      offscreen.height = rect.height;
      const offCtx = offscreen.getContext('2d');
      offCtx.drawImage(
        videoCanvas,
        rect.x, rect.y, rect.width, rect.height,  // source crop
        0, 0, rect.width, rect.height              // destination
      );

      const capturedImageDataURL = offscreen.toDataURL('image/png');
      window.capturedImage = capturedImageDataURL;

      appState = 'solve';
      document.getElementById('mode-panel').textContent = 'MODE: SOLVE';

      // Retake button (only injected once per session)
      if (!window._retakeShown) {
        window._retakeShown = true;
        const retakeBtn = document.createElement('button');
        retakeBtn.id = 'retake-btn';
        retakeBtn.textContent = 'RETAKE';
        retakeBtn.style.cssText = `
          position: absolute;
          bottom: 16px;
          left: 50%;
          transform: translateX(-50%);
          background: transparent;
          border: 1px solid #00FF00;
          color: #00FF00;
          font-family: 'Space Mono', monospace;
          font-size: 0.6rem;
          letter-spacing: 0.2em;
          padding: 8px 20px;
          cursor: pointer;
          min-height: 44px;
          white-space: nowrap;
          z-index: 50;
        `;
        retakeBtn.addEventListener('click', () => {
          tiles = [];
          dragTile = null;
          puzzleStartTime = null;
          puzzleElapsed = 0;
          solveDragEnabled = false;
          window.capturedImage = null;
          window._retakeShown = false;
          retakeBtn.remove();
          appState = 'capture';
          document.getElementById('mode-panel').textContent = 'MODE: CAPTURE';
        });
        document.getElementById('app').appendChild(retakeBtn);
      }

      // Short 800 Hz beep via Web Audio API
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1);
      } catch (e) {
        console.warn('Audio capture beep failed:', e);
      }

      startPuzzle();
      solveDragEnabled = false;
      setTimeout(() => { solveDragEnabled = true; }, 1000);
    }

    // --- Puzzle phase ---
    function startPuzzle() {
      const img = new Image();
      img.src = window.capturedImage;
      img.onload = () => {
        // Grid: 480x480, centred on the 640x480 canvas
        gridW = 480;
        gridH = 480;
        gridX = (640 - gridW) / 2; // 80
        gridY = 0;
        tileW = gridW / 3;
        tileH = gridH / 3;

        // Slice captured image into 9 tiles
        tiles = [];
        for (let i = 0; i < 9; i++) {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const offscreen = document.createElement('canvas');
          offscreen.width = tileW;
          offscreen.height = tileH;
          const ctx = offscreen.getContext('2d');
          ctx.drawImage(
            img,
            col * (img.width / 3), row * (img.height / 3),
            img.width / 3, img.height / 3,
            0, 0, tileW, tileH
          );
          tiles.push({ correct: i, current: i, canvas: offscreen });
        }

        // Shuffle: 200 random swaps (always solvable)
        for (let s = 0; s < 200; s++) {
          const a = Math.floor(Math.random() * 9);
          const b = Math.floor(Math.random() * 9);
          const temp = tiles[a].current;
          tiles[a].current = tiles[b].current;
          tiles[b].current = temp;
        }

        puzzleStartTime = Date.now();
        requestAnimationFrame(drawPuzzleFrame);
      };
    }

    // --- Puzzle render loop (camera + timing only) ---
    function drawPuzzleFrame() {
      if (appState !== 'solve') return;

      const w = videoCanvas.width;
      const h = videoCanvas.height;

      // Update elapsed timer
      puzzleElapsed = Math.floor((Date.now() - puzzleStartTime) / 1000);

      // Clear and redraw mirrored camera feed on video canvas
      videoCtx.clearRect(0, 0, w, h);
      if (window._lastHandsImage) {
        videoCtx.save();
        videoCtx.scale(-1, 1);
        videoCtx.drawImage(window._lastHandsImage, -w, 0, w, h);
        videoCtx.restore();
      }

      requestAnimationFrame(drawPuzzleFrame);
    }

    // --- Helper: find which tile occupies a canvas point ---
    function getTileAtPosition(canvasX, canvasY) {
      const col = Math.floor((canvasX - gridX) / tileW);
      const row = Math.floor((canvasY - gridY) / tileH);
      if (col < 0 || col > 2 || row < 0 || row > 2) return null;
      const gridPos = row * 3 + col;
      return tiles.findIndex(tile => tile.current === gridPos);
    }

    // --- Helper: play a short sine tone ---
    function playTone(freq, duration, gain) {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        g.gain.setValueAtTime(gain, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
      } catch (e) {
        console.warn('Audio failed:', e);
      }
    }

    // --- Check if puzzle is solved after every swap ---
    function checkPuzzleSolved() {
      const solved = tiles.every(tile => tile.correct === tile.current);
      if (solved) {
        // Increment games played
        const gamesPlayed = parseInt(localStorage.getItem('livepuzzle_games_played') || '0', 10) + 1;
        localStorage.setItem('livepuzzle_games_played', gamesPlayed.toString());

        appState = 'complete';
        puzzleElapsed = Math.floor((Date.now() - puzzleStartTime) / 1000);
        showCompleteScreen();
      }
    }

    // --- Complete screen ---
    function showCompleteScreen() {
      document.getElementById('mode-panel').textContent = 'MODE: COMPLETE';

      // Save personal best
      savePersonalBest(puzzleElapsed);
      renderLeaderboardPanel();

      // Ascending completion tones
      playTone(400, 0.1, 0.2);
      setTimeout(() => playTone(600, 0.1, 0.2), 120);
      setTimeout(() => playTone(800, 0.2, 0.3), 240);

      // Outer overlay
      const overlay = document.createElement('div');
      overlay.id = 'complete-overlay';
      overlay.style.cssText = `
        position: absolute;
        top: 0; left: 0; width: 100%; height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.0);
        z-index: 100;
        font-family: 'Space Mono', monospace;
      `;

      // Blurred camera snapshot as background
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = 640;
      bgCanvas.height = 480;
      bgCanvas.style.cssText = `
        position: absolute;
        top: 50%; left: 50%;
        transform: translate(-50%, -50%);
        filter: blur(8px);
        z-index: 0;
      `;
      const bgCtx = bgCanvas.getContext('2d');
      bgCtx.drawImage(videoCanvas, 0, 0);
      overlay.appendChild(bgCanvas);

      // Card
      const card = document.createElement('div');
      card.style.cssText = `
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 40px 60px;
        background: rgba(0,0,0,0.82);
        border: 1px solid #00FF00;
        box-shadow: 0 0 40px rgba(0,255,0,0.15);
      `;

      // Trophy emoji
      const trophy = document.createElement('div');
      trophy.textContent = '🏆';
      trophy.style.cssText = 'font-size: 3.5rem; filter: drop-shadow(0 0 12px #00FF00);';

      // COMPLETE! label
      const completeText = document.createElement('div');
      completeText.textContent = 'COMPLETE!';
      completeText.style.cssText = `
        color: #00FF00;
        font-size: 1.8rem;
        letter-spacing: 0.4em;
        font-weight: 700;
        text-shadow: 0 0 20px rgba(0,255,0,0.6);
      `;

      // MM:SS formatted time
      const mins = String(Math.floor(puzzleElapsed / 60)).padStart(2, '0');
      const secs = String(puzzleElapsed % 60).padStart(2, '0');
      const finalTime = `${mins}:${secs}`;

      // Time display
      const timeDisplay = document.createElement('div');
      timeDisplay.textContent = `⏱ ${finalTime}`;
      timeDisplay.style.cssText = `
        color: #00FF00;
        font-size: 1.3rem;
        letter-spacing: 0.25em;
        font-weight: 700;
      `;

      // Score status message (filled by auto-submit)
      const statusMsg = document.createElement('div');
      statusMsg.style.cssText = `
        color: rgba(0,255,0,0.8);
        font-size: 0.65rem;
        letter-spacing: 0.2em;
        min-height: 1em;
      `;

      // Auto-submit score for registered users
      const username = localStorage.getItem('livepuzzle_username');
      if (username && username.length > 0) {
        (async () => {
          try {
            const existing = await db.collection('leaderboard')
              .where('name', '==', username)
              .get();

            if (existing.empty) {
              await db.collection('leaderboard').add({
                name: username,
                seconds: puzzleElapsed,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
              });
              statusMsg.textContent = 'SCORE SAVED';
            } else {
              const doc = existing.docs[0];
              if (doc.data().seconds > puzzleElapsed) {
                await doc.ref.update({
                  seconds: puzzleElapsed,
                  timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
                statusMsg.textContent = 'NEW BEST SAVED';
              } else {
                statusMsg.textContent = 'SCORE SAVED';
              }
            }
            renderLeaderboardPanel();
          } catch (e) {
            console.error('Firestore auto-submit error:', e);
          }
        })();
      }

      // Play Again button
      const playAgainBtn = document.createElement('button');
      playAgainBtn.textContent = 'PLAY AGAIN';
      playAgainBtn.style.cssText = `
        margin-top: 8px;
        background: transparent;
        border: 1px solid #00FF00;
        color: #00FF00;
        font-family: 'Space Mono', monospace;
        font-size: 0.85rem;
        letter-spacing: 0.25em;
        padding: 14px 32px;
        cursor: pointer;
        min-height: 50px;
        white-space: nowrap;
      `;
      playAgainBtn.addEventListener('click', () => {
        overlay.remove();
        tiles = [];
        dragTile = null;
        puzzleStartTime = null;
        puzzleElapsed = 0;
        solveDragEnabled = false;
        window.capturedImage = null;
        window._retakeShown = false;
        const retakeBtn = document.getElementById('retake-btn');
        if (retakeBtn) retakeBtn.remove();
        appState = 'capture';
        document.getElementById('mode-panel').textContent = 'MODE: CAPTURE';
        renderLeaderboardPanel();
      });

      card.appendChild(trophy);
      card.appendChild(completeText);
      card.appendChild(timeDisplay);
      card.appendChild(statusMsg);
      card.appendChild(playAgainBtn);
      overlay.appendChild(card);
      document.getElementById('app').appendChild(overlay);
    }

    // --- Personal Best Helpers ---
    function getPersonalBest() {
      const val = localStorage.getItem('livepuzzle_best');
      return val ? parseInt(val, 10) : null;
    }

    function savePersonalBest(seconds) {
      const currentBest = getPersonalBest();
      if (currentBest === null || seconds < currentBest) {
        localStorage.setItem('livepuzzle_best', seconds);
      }
    }

    // --- Leaderboard Panel ---
    async function renderLeaderboardPanel() {
      // --- LEFT PANEL: Global Top 5 ---
      let panel = document.getElementById('leaderboard-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'leaderboard-panel';
        panel.style.cssText = `
          position: absolute;
          left: 12px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 50;
          background: rgba(0,0,0,0.6);
          border: 1px solid #00FF00;
          padding: 14px 16px;
          min-width: 180px;
          font-family: 'Space Mono', monospace;
        `;
        document.getElementById('app').appendChild(panel);
      }

      panel.innerHTML = `
        <div style="color: #00FF00; font-size: 0.7rem; letter-spacing: 0.2em; margin-bottom: 10px; font-weight: 700;">TOP 5</div>
        <div id="leaderboard-entries"></div>
      `;

      const entriesDiv = document.getElementById('leaderboard-entries');

      // MM:SS formatter
      const formatTime = (s) => {
        const mins = String(Math.floor(s / 60)).padStart(2, '0');
        const secs = String(s % 60).padStart(2, '0');
        return `${mins}:${secs}`;
      };

      const currentUsername = localStorage.getItem('livepuzzle_username');
      const personalBest = getPersonalBest();

      // Fetch and Render Global Top 5
      try {
        const snapshot = await db.collection('leaderboard')
          .orderBy('seconds', 'asc')
          .limit(5)
          .get();

        let html = '';
        let userInTop5 = false;

        snapshot.docs.forEach((doc, idx) => {
          const data = doc.data();
          const isUser = currentUsername && currentUsername.length > 0 && data.name === currentUsername;
          if (isUser) userInTop5 = true;

          const rowStyle = isUser
            ? 'background: rgba(0,255,0,0.08); font-weight: 700; color: #00FF00;'
            : 'color: rgba(0,255,0,0.8);';

          html += `
            <div style="${rowStyle} font-size: 0.65rem; line-height: 2.2; display: flex; justify-content: space-between; padding: 0 4px;">
              <span>${idx + 1}. ${data.name}</span>
              <span>${formatTime(data.seconds)}</span>
            </div>
          `;
        });

        entriesDiv.innerHTML = html || '<div style="color: rgba(0,255,0,0.4); font-size: 0.45rem;">NO SUBMISSIONS</div>';

        // Show user's rank if not in top 5
        if (currentUsername && currentUsername.length > 0 && !userInTop5 && personalBest !== null) {
          try {
            const rankSnapshot = await db.collection('leaderboard')
              .where('seconds', '<', personalBest)
              .get();
            const rank = rankSnapshot.size + 1;

            const separator = document.createElement('div');
            separator.style.cssText = 'color: rgba(0,255,0,0.3); font-size: 0.55rem; text-align: center; padding: 2px 0;';
            separator.textContent = '···';
            entriesDiv.appendChild(separator);

            const userRow = document.createElement('div');
            userRow.style.cssText = `
              background: rgba(0,255,0,0.08); font-weight: 700; color: #00FF00;
              font-size: 0.65rem; line-height: 2.2; display: flex;
              justify-content: space-between; padding: 0 4px;
            `;
            userRow.innerHTML = `
              <span>${rank}. ${currentUsername}</span>
              <span>${formatTime(personalBest)}</span>
            `;
            entriesDiv.appendChild(userRow);
          } catch (e) {
            console.error('Firestore rank query error:', e);
          }
        }
      } catch (e) {
        console.error('Firestore load error:', e);
        entriesDiv.innerHTML = '<div style="color: #FF0000; font-size: 0.45rem;">LOAD ERROR</div>';
      }

      // --- RIGHT PANEL: Personal Stats ---
      let personalPanel = document.getElementById('personal-panel');
      if (!personalPanel) {
        personalPanel = document.createElement('div');
        personalPanel.id = 'personal-panel';
        personalPanel.style.cssText = `
          position: absolute;
          right: 12px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 50;
          background: rgba(0,0,0,0.6);
          border: 1px solid #00FF00;
          padding: 14px 16px;
          min-width: 180px;
          font-family: 'Space Mono', monospace;
        `;
        document.getElementById('app').appendChild(personalPanel);
      }

      const displayName = (currentUsername && currentUsername.length > 0) ? currentUsername : 'GUEST';
      const bestDisplay = personalBest !== null ? formatTime(personalBest) : '--:--';
      const gamesPlayed = localStorage.getItem('livepuzzle_games_played') || '0';

      personalPanel.innerHTML = `
        <div style="color: #00FF00; font-size: 0.7rem; letter-spacing: 0.2em; margin-bottom: 10px; font-weight: 700;">YOUR STATS</div>
        <div style="color: rgba(0,255,0,0.6); font-size: 0.55rem; letter-spacing: 0.1em; margin-bottom: 2px;">CALLSIGN</div>
        <div style="color: #00FF00; font-size: 0.65rem; margin-bottom: 8px;">${displayName}</div>
        <div style="color: rgba(0,255,0,0.6); font-size: 0.55rem; letter-spacing: 0.1em; margin-bottom: 2px;">BEST TIME</div>
        <div style="color: #00FF00; font-size: 0.65rem; margin-bottom: 8px;">${bestDisplay}</div>
        <div style="color: rgba(0,255,0,0.6); font-size: 0.55rem; letter-spacing: 0.1em; margin-bottom: 2px;">GAMES PLAYED</div>
        <div style="color: #00FF00; font-size: 0.65rem;">${gamesPlayed}</div>
      `;
    }

    // --- Per-hand pinch state for smoothing, hysteresis, and debounce ---
    const PINCH_GRAB_THRESHOLD = 30;
    const PINCH_RELEASE_THRESHOLD = 50;
    const SMOOTHING_ALPHA = 0.35;
    const CONFIRM_FRAMES = 5;

    const smoothedPinchDist = new Map();   // handIndex → smoothed distance
    const pinchState = new Map();          // handIndex → boolean (currently pinching?)
    const pinchConfirmCounter = new Map(); // handIndex → frames towards state change

    // Override hands.onResults with full game callback
    hands.onResults((results) => {
      const w = videoCanvas.width;
      const h = videoCanvas.height;

      // Always cache the latest camera frame for drawPuzzleFrame
      window._lastHandsImage = results.image;

      // In solve mode: clear overlay, draw tiles, draw landmarks on top, run drag logic
      if (appState === 'solve') {
        // 1. Clear overlay every frame to prevent ghosting
        overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

        // 2. Draw the 9 tiles in their shuffled grid positions
        for (let i = 0; i < tiles.length; i++) {
          if (dragTile && dragTile.tileArrayIndex === i) continue; // dragged tile drawn last
          const col = tiles[i].current % 3;
          const row = Math.floor(tiles[i].current / 3);
          const tx = gridX + col * tileW;
          const ty = gridY + row * tileH;
          overlayCtx.drawImage(tiles[i].canvas, tx, ty, tileW, tileH);
          overlayCtx.strokeStyle = '#ffffff';
          overlayCtx.lineWidth = 1;
          overlayCtx.strokeRect(tx, ty, tileW, tileH);
        }

        // 3. Draw dragged tile on top with glow, then reset shadow
        if (dragTile !== null) {
          const t = tiles[dragTile.tileArrayIndex];
          const scale = 1.1;
          const dw = tileW * scale;
          const dh = tileH * scale;
          const dx = dragTile.currentX - dw / 2;
          const dy = dragTile.currentY - dh / 2;
          overlayCtx.save();
          overlayCtx.shadowBlur = 20;
          overlayCtx.shadowColor = '#00FF00';
          overlayCtx.drawImage(t.canvas, dx, dy, dw, dh);
          overlayCtx.restore();
          overlayCtx.shadowBlur = 0;
          overlayCtx.shadowColor = 'transparent';
        }

        // 4. Draw MM:SS timer top-left
        const mins = String(Math.floor(puzzleElapsed / 60)).padStart(2, '0');
        const secs = String(puzzleElapsed % 60).padStart(2, '0');
        overlayCtx.fillStyle = '#00FF00';
        overlayCtx.font = '14px Space Mono';
        overlayCtx.fillText(`${mins}:${secs}`, 8, 22);

        // Safety: no hands detected — snap floating tile back
        if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
          if (dragTile !== null) dragTile = null;
        }

        if (results.multiHandLandmarks) {
          // Safety: owning hand dropped out — snap tile back
          if (dragTile !== null && results.multiHandLandmarks.length <= dragTile.handIndex) {
            dragTile = null;
          }

          // 5. Draw hand skeletons in mirrored space (on top of tiles)
          overlayCtx.save();
          overlayCtx.scale(-1, 1);
          overlayCtx.translate(-overlayCanvas.width, 0);
          for (const landmarks of results.multiHandLandmarks) {
            drawConnectors(overlayCtx, landmarks, HAND_CONNECTIONS, {
              color: '#00FF00',
              lineWidth: 2,
            });
            drawLandmarks(overlayCtx, landmarks, {
              color: '#FFFFFF',
              fillColor: '#00FF00',
              radius: 4,
            });
          }
          overlayCtx.restore();

          // --- Pinch-drag logic ---
          for (let handIndex = 0; handIndex < results.multiHandLandmarks.length; handIndex++) {
            const landmarks = results.multiHandLandmarks[handIndex];

            // Mirrored canvas coordinates for index tip and thumb tip
            const rawIndex = getLandmarkPoint(landmarks[8], w, h);
            const rawThumb = getLandmarkPoint(landmarks[4], w, h);
            const indexX = w - rawIndex.x;
            const indexY = rawIndex.y;
            const thumbX = w - rawThumb.x;
            const thumbY = rawThumb.y;

            const dx = indexX - thumbX;
            const dy = indexY - thumbY;
            const rawPinchDist = Math.sqrt(dx * dx + dy * dy);
            const midX = (indexX + thumbX) / 2;
            const midY = (indexY + thumbY) / 2;

            // --- Exponential smoothing ---
            const prevSmoothed = smoothedPinchDist.get(handIndex) ?? rawPinchDist;
            const smoothed = (1 - SMOOTHING_ALPHA) * prevSmoothed + SMOOTHING_ALPHA * rawPinchDist;
            smoothedPinchDist.set(handIndex, smoothed);

            // --- Hysteresis: determine raw signal based on current state ---
            const wasPinching = pinchState.get(handIndex) ?? false;
            let rawSignal;
            if (wasPinching) {
              rawSignal = smoothed < PINCH_RELEASE_THRESHOLD; // stay pinching unless exceeds release
            } else {
              rawSignal = smoothed < PINCH_GRAB_THRESHOLD;    // must come below grab to start
            }

            // --- Frame-count debounce on state CHANGES ---
            let confirmedPinching = wasPinching;
            if (rawSignal !== wasPinching) {
              const count = (pinchConfirmCounter.get(handIndex) ?? 0) + 1;
              if (count >= CONFIRM_FRAMES) {
                confirmedPinching = rawSignal;
                pinchState.set(handIndex, rawSignal);
                pinchConfirmCounter.set(handIndex, 0);
              } else {
                pinchConfirmCounter.set(handIndex, count);
              }
            } else {
              pinchConfirmCounter.set(handIndex, 0);
            }

            // --- Drag logic (gated by grace period) ---
            if (solveDragEnabled) {
              if (confirmedPinching) {
                if (dragTile === null) {
                  // PINCH START — only pick up if no tile is being dragged
                  const tileIdx = getTileAtPosition(midX, midY);
                  if (tileIdx !== null && tileIdx !== -1) {
                    dragTile = { tileArrayIndex: tileIdx, currentX: midX, currentY: midY, handIndex };
                    playTone(600, 0.08, 0.2);
                  }
                } else if (dragTile.handIndex === handIndex) {
                  // DRAGGING — update position with latest midpoint (no debounce on position)
                  dragTile.currentX = midX;
                  dragTile.currentY = midY;
                }
              } else {
                // RELEASE — only if this hand owns the drag
                if (dragTile !== null && dragTile.handIndex === handIndex) {
                  const targetIdx = getTileAtPosition(dragTile.currentX, dragTile.currentY);
                  if (targetIdx !== null && targetIdx !== -1 && targetIdx !== dragTile.tileArrayIndex) {
                    // Swap .current values
                    const temp = tiles[dragTile.tileArrayIndex].current;
                    tiles[dragTile.tileArrayIndex].current = tiles[targetIdx].current;
                    tiles[targetIdx].current = temp;
                    playTone(400, 0.06, 0.15);
                    checkPuzzleSolved();
                  }
                  dragTile = null;
                }
              }
            }
          }
        }
        return;
      }

      // Draw mirrored camera feed
      videoCtx.save();
      videoCtx.scale(-1, 1);
      videoCtx.drawImage(results.image, -w, 0, w, h);
      videoCtx.restore();

      // Clear overlay
      overlayCtx.clearRect(0, 0, w, h);

      if (results.multiHandLandmarks) {
        // Draw skeleton in mirrored space
        overlayCtx.save();
        overlayCtx.scale(-1, 1);
        overlayCtx.translate(-overlayCanvas.width, 0);
        for (const landmarks of results.multiHandLandmarks) {
          drawConnectors(overlayCtx, landmarks, HAND_CONNECTIONS, {
            color: '#00FF00',
            lineWidth: 2,
          });
          drawLandmarks(overlayCtx, landmarks, {
            color: '#FFFFFF',
            fillColor: '#00FF00',
            radius: 4,
          });
        }
        overlayCtx.restore();

        // --- Capture logic (normal/mirrored screen space) ---
        if (appState === 'capture' && results.multiHandLandmarks.length === 2) {
          const landmarks0 = results.multiHandLandmarks[0];
          const landmarks1 = results.multiHandLandmarks[1];

          // Pinch distances (in raw MediaPipe canvas space)
          const pinch0 = getPinchDistance(landmarks0, w, h);
          const pinch1 = getPinchDistance(landmarks1, w, h);

          // Index fingertip positions, converted to mirrored screen x
          const raw0 = getLandmarkPoint(landmarks0[8], w, h);
          const raw1 = getLandmarkPoint(landmarks1[8], w, h);
          const hand0X = w - raw0.x;   // mirror
          const hand0Y = raw0.y;
          const hand1X = w - raw1.x;   // mirror
          const hand1Y = raw1.y;

          // Build capture rectangle in screen space
          const rectX = Math.min(hand0X, hand1X);
          const rectY = Math.min(hand0Y, hand1Y);
          const rectW = Math.abs(hand0X - hand1X);
          const rectH = Math.abs(hand0Y - hand1Y);

          // Draw green preview rectangle (normal coordinate space)
          overlayCtx.strokeStyle = '#00FF00';
          overlayCtx.lineWidth = 2;
          overlayCtx.strokeRect(rectX, rectY, rectW, rectH);

          // Label above rectangle
          overlayCtx.fillStyle = '#00FF00';
          overlayCtx.font = '10px Space Mono';
          overlayCtx.fillText('PINCH TO CAPTURE', rectX, Math.max(rectY - 6, 10));

          // Both hands pinching → capture
          if (pinch0 < 30 && pinch1 < 30) {
            captureImage({ x: rectX, y: rectY, width: rectW, height: rectH });
          }
        }
      }
    });

    // Camera is already running — do not create or start another instance
  }
});