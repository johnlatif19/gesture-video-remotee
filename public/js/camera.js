import { HandLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';
const $ = (id) => document.getElementById(id);
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
let code = '', camToken = '', landmarker, lastFire = 0, trail = [];

$('pair').addEventListener('submit', async (e) => {
  e.preventDefault(); $('err').textContent = '';
  const c = $('code').value.trim();
  const r = await post('/api/pair', { code: c });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { $('err').textContent = d.error || 'حصلت مشكلة'; return; }
  code = c; camToken = d.camToken;
  $('pair').hidden = true; $('live').hidden = false;
  start();
});

function disconnected() {
  $('state').textContent = 'الاتصال انقطع، اكتب الكود الجديد من الريموت'; $('state').className = 'err';
  code = ''; camToken = '';
  setTimeout(() => { $('live').hidden = true; $('pair').hidden = false; $('code').value = ''; }, 1500);
}
async function send(type) {
  if (!code) return;
  try {
    const r = await post('/api/command', { code, camToken, type });
    if (r.status === 410) disconnected();
  } catch (e) { /* network blip; ping retries */ }
}
setInterval(() => send('ping'), 4000);

const up = (l, tip, pip) => l[tip].y < l[pip].y - 0.02; // finger extended (hand upright)
function classify(l) {
  const idx = up(l, 8, 6), mid = up(l, 12, 10), ring = up(l, 16, 14), pky = up(l, 20, 18);
  const n = [idx, mid, ring, pky].filter(Boolean).length;
  if (n === 0) return 'fist';
  if (idx && !mid && !ring && !pky) return 'point';
  if (n === 4) return 'open';
  return '';
}
const ACTION = { fist: ['play', '✊'], point: ['back', '☝️'], open: ['pause', '🖐'] };
const STABLE_FRAMES = 4;      // a pose must be held this many frames before it counts
const REARM_MS = 400;         // pose must be gone (other pose or no hand) this long before the same action can fire again
const COOLDOWN_MS = 1200;     // minimum gap between any two actions
let stableG = '', stableN = 0, lastFiredPose = '', awaySince = 0, swipeLockUntil = 0;
const reverse = () => localStorage.getItem('reverseSwipe') === '1';
function fire(type, emoji) {
  const now = Date.now();
  if (now - lastFire < COOLDOWN_MS) return false;
  lastFire = now; send(type); $('badge').textContent = emoji;
  setTimeout(() => ($('badge').textContent = ''), 900);
  return true;
}
// A held pose fires ONCE. To repeat it (e.g. rewind again) drop the hand or change the pose for 0.4s, then repeat it.
function handlePose(g) {
  const now = Date.now();
  if (g === stableG) stableN++; else { stableG = g; stableN = 1; }
  if (g === lastFiredPose && g) awaySince = 0;
  else { if (!awaySince) awaySince = now; if (now - awaySince > REARM_MS) lastFiredPose = ''; }
  if (g && stableN >= STABLE_FRAMES && now >= swipeLockUntil && g !== lastFiredPose) {
    if (fire(ACTION[g][0], ACTION[g][1])) { lastFiredPose = g; awaySince = 0; }
  }
}
async function start() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
  const cam = $('cam'); cam.srcObject = stream; await cam.play();
  const fs = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
  landmarker = await HandLandmarker.createFromOptions(fs, {
    baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' },
    runningMode: 'VIDEO', numHands: 1 });
  const cv = $('cv'), ctx = cv.getContext('2d');
  let lastT = -1;
  (function frame() {
    if (!code) return; // stop when disconnected
    if (cam.currentTime !== lastT) {
      lastT = cam.currentTime;
      cv.width = cam.videoWidth; cv.height = cam.videoHeight; ctx.clearRect(0, 0, cv.width, cv.height);
      const res = landmarker.detectForVideo(cam, performance.now());
      const l = res.landmarks && res.landmarks[0];
      if (l) {
        ctx.fillStyle = '#6be59a'; l.forEach((p) => ctx.fillRect(p.x * cv.width - 3, p.y * cv.height - 3, 6, 6));
        const now = Date.now();
        trail.push({ t: now, x: l[0].x }); trail = trail.filter((p) => now - p.t < 500);
        // The preview is mirrored like a mirror: the user's right hand moving right makes raw x DECREASE.
        const dx = trail[trail.length - 1].x - trail[0].x;
        const right = reverse() ? dx > 0.25 : dx < -0.25;
        if (right && trail.length > 3 && fire('forward', '👉')) { trail = []; swipeLockUntil = now + 900; stableN = 0; }
        else handlePose(classify(l));
      } else { trail = []; handlePose(''); }
    }
    requestAnimationFrame(frame);
  })();
}

const rev = document.getElementById('rev'); rev.checked = localStorage.getItem('reverseSwipe') === '1'; rev.onchange = () => localStorage.setItem('reverseSwipe', rev.checked ? '1' : '0');
