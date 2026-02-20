// LivePuzzle - app.js
console.log("LivePuzzle loaded")

document.addEventListener('DOMContentLoaded', () => {
  const gameContainer = document.getElementById('game-container');

  let appState = 'capture'; // 'capture' or 'solve'

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

  // --- Placeholder: puzzle phase ---
  function startPuzzle() {
    console.log("Puzzle starting");
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
