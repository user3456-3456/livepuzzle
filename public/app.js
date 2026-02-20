// LivePuzzle - app.js
console.log("LivePuzzle loaded")

document.addEventListener('DOMContentLoaded', () => {
  const gameContainer = document.getElementById('game-container');

  let appState = 'capture'; // 'capture' or 'solve'

  // --- Puzzle state ---
  let tiles = []; // {correct, current, canvas}
  let gridX, gridY, gridW, gridH, tileW, tileH;
  let dragTile = null; // {tileIndex, offsetX, offsetY, currentX, currentY}
  let puzzleStartTime = null;
  let puzzleElapsed = 0;

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

  // --- Hidden video element ---
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;

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
      appState = 'complete';
      puzzleElapsed = Math.floor((Date.now() - puzzleStartTime) / 1000);
      showCompleteScreen();
    }
  }

  // --- Placeholder: complete screen ---
  function showCompleteScreen() {
    document.getElementById('mode-panel').textContent = 'MODE: COMPLETE';

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
      gap: 12px;
      padding: 32px 48px;
    `;

    // Trophy emoji
    const trophy = document.createElement('div');
    trophy.textContent = '🏆';
    trophy.style.cssText = 'font-size: 2.5rem; filter: drop-shadow(0 0 8px #00FF00);';

    // COMPLETE! label
    const completeText = document.createElement('div');
    completeText.textContent = 'COMPLETE!';
    completeText.style.cssText = `
      color: #00FF00;
      font-size: 1.1rem;
      letter-spacing: 0.3em;
      font-weight: 700;
    `;

    // Time display
    const mins = String(Math.floor(puzzleElapsed / 60)).padStart(2, '0');
    const secs = String(puzzleElapsed % 60).padStart(2, '0');
    const timeDisplay = document.createElement('div');
    timeDisplay.textContent = `⏱ ${mins}:${secs}`;
    timeDisplay.style.cssText = `
      color: #00FF00;
      font-size: 0.75rem;
      letter-spacing: 0.2em;
    `;

    // Play Again button
    const playAgainBtn = document.createElement('button');
    playAgainBtn.textContent = 'PLAY AGAIN';
    playAgainBtn.style.cssText = `
      margin-top: 8px;
      background: transparent;
      border: 1px solid #00FF00;
      color: #00FF00;
      font-family: 'Space Mono', monospace;
      font-size: 0.65rem;
      letter-spacing: 0.2em;
      padding: 10px 24px;
      cursor: pointer;
      min-height: 44px;
      white-space: nowrap;
    `;
    playAgainBtn.addEventListener('click', () => {
      overlay.remove();
      tiles = [];
      dragTile = null;
      puzzleStartTime = null;
      puzzleElapsed = 0;
      window.capturedImage = null;
      window._retakeShown = false;
      const retakeBtn = document.getElementById('retake-btn');
      if (retakeBtn) retakeBtn.remove();
      appState = 'capture';
      document.getElementById('mode-panel').textContent = 'MODE: CAPTURE';
    });

    card.appendChild(trophy);
    card.appendChild(completeText);
    card.appendChild(timeDisplay);
    card.appendChild(playAgainBtn);
    overlay.appendChild(card);
    document.getElementById('app').appendChild(overlay);
  }

  // --- MediaPipe Hands ---
  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.85,
    minTrackingConfidence: 0.85,
  });

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

      if (results.multiHandLandmarks) {
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
          const pinchDist = Math.sqrt(dx * dx + dy * dy);
          const midX = (indexX + thumbX) / 2;
          const midY = (indexY + thumbY) / 2;
          const isPinching = pinchDist < 30;

          if (isPinching) {
            if (dragTile === null) {
              // PINCH START — only pick up if no tile is being dragged
              const tileIdx = getTileAtPosition(midX, midY);
              if (tileIdx !== null && tileIdx !== -1) {
                dragTile = { tileArrayIndex: tileIdx, currentX: midX, currentY: midY, handIndex };
                playTone(600, 0.08, 0.2);
              }
            } else if (dragTile.handIndex === handIndex) {
              // DRAGGING — update position for the hand that started the drag
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

  // --- MediaPipe Camera ---
  const camera = new Camera(video, {
    onFrame: async () => {
      await hands.send({ image: video });
    },
    width: 640,
    height: 480,
    frameRate: 30,
  });

  camera.start();
});
