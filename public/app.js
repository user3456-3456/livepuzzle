// LivePuzzle - app.js
console.log("LivePuzzle loaded")

document.addEventListener('DOMContentLoaded', () => {
  const gameContainer = document.getElementById('game-container');

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
