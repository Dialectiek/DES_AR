// Table Cube — WebXR AR demo for Magic Leap 2 (works on other WebXR AR devices too).
//
// How it works:
//   1. Every few frames we grab the headset's RGB camera image (WebXR raw camera access)
//      and shrink it to 160x120.
//   2. Bright + low-colour pixels are "white". Small gaps are closed and holes (things
//      lying on the table) are filled, then we keep the biggest rectangle-like blob.
//   3. Every pixel of that blob is projected onto the table plane, so we measure the
//      table in metres. We fit a rounded rectangle to it: centre, direction, size and
//      corner radius. This also removes the perspective error of using the image centre.
//      Table height comes from: hit-test along the camera ray → detected planes → a guess.
//   4. The outline and the diorama (house with PV panels + car) follow the table and lock.
//
// If the camera feed is not available it falls back to "gaze mode":
// look at the table and press the trigger to place the diorama.
// Default table setup is corner calibration: aim at the 4 corners and press the trigger.
//
// Everything that happens is logged: on the page (bottom right), inside the headset
// (bottom right of your view), in localStorage, and — when served by devserver.mjs —
// live to the laptop, which is the only log that survives the browser crashing.

import * as THREE from 'three';

window.__tableCubeLoaded = true;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);

const CONFIG = {
  analysisWidth: 160,        // camera image is downscaled to this for detection
  analysisHeight: 120,
  analyseEveryNFrames: 6,    // roughly 10 detections per second at 60 fps
  minWhiteLuma: 110,         // nothing darker than this (0–255) counts as white
  maxAutoThreshold: 215,     // the automatic threshold never goes above this
  whiteLuma: params.has('white') ? parseFloat(params.get('white')) : null, // fixed threshold
  maxSaturation: 45,         // white = low colour: max(r,g,b) - min(r,g,b)
  minAreaFraction: 0.02,     // blob must cover at least 2% of the camera image
  minImageFill: 0.45,        // loose shape check in the image (perspective distorts it)
  minMetricFill: 0.65,       // shape check in metres; a rounded rectangle is ~0.9–1.0
  minTableWidth: 0.35,       // metres, plausibility check
  maxTableLength: 4.0,       // metres, plausibility check
  maxDistance: 6.0,          // ignore table pixels further away than this (metres)
  cornerRadius: params.has('corner') ? parseFloat(params.get('corner')) : null, // null = estimate
  smoothing: 0.25,           // 0..1, higher follows new detections faster
  lockTolerance: 0.02,       // metres; detections this close count as stable
  lockFrames: 8,             // stable detections in a row before locking
  tableHeight: parseFloat(params.get('table') ?? '0.75'), // fallback, metres above floor
  minTableHeight: 0.3,       // ignore surfaces lower than this (the floor)
  hitTestIntervalMs: 400,    // how often to refresh the camera-ray hit-test
  cameraTimeoutMs: 6000,     // switch to gaze mode if no camera image by then
  heartbeatMs: 5000,         // "still running" log line, useful to see when a crash happened
  touchDistance: 0.04,       // corner calibration: controller tip this close to the table = touching
  flipCameraY: params.get('flipy') === '1',
  debug: params.get('debug') === '1',
};

// ---------------------------------------------------------------------------
// Logger: page panel, headset panel and localStorage (survives crashes)
// ---------------------------------------------------------------------------
const LOG_KEY = 'tablecube-log-v1';
const logLines = [];
// When the page is served by devserver.mjs, every log line is also sent to the laptop.
// That is the only log that survives the whole browser crashing.
const remote = { enabled: false, probing: true, queue: [], seq: 0 };
let previousLog = [];
const logListEl = document.getElementById('log-list');
const logState = { dirty: true };

function timeStamp() {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function renderLogLine(line, old = false) {
  if (!logListEl) return;
  const li = document.createElement('li');
  li.className = line.level + (old ? ' old' : '');
  li.textContent = `${line.t}  ${line.text}`;
  logListEl.appendChild(li);
  while (logListEl.children.length > 500) logListEl.firstElementChild.remove();
  logListEl.scrollTop = logListEl.scrollHeight;
}

function persistLog() {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(logLines.slice(-250)));
  } catch {
    // storage unavailable (private mode etc.) – the on-screen log still works
  }
}

function log(level, msg, data) {
  let text = String(msg);
  if (data !== undefined) {
    try {
      text += ' ' + (typeof data === 'string' ? data : JSON.stringify(data));
    } catch {
      text += ' [unprintable data]';
    }
  }
  const line = { t: timeStamp(), level, text };
  logLines.push(line);
  if (logLines.length > 400) logLines.shift();
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out('[TableCube]', text);
  renderLogLine(line);
  persistLog();
  remoteLog(line);
  logState.dirty = true;
}

function remoteSend(lines) {
  if (!lines.length) return;
  try {
    // sendBeacon is queued by the browser even if the page dies right after.
    const body = JSON.stringify(lines);
    if (navigator.sendBeacon && navigator.sendBeacon('/log', new Blob([body], { type: 'text/plain' }))) return;
    fetch('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lines),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignore: logging must never break the app
  }
}

function remoteLog(line) {
  const l = { ...line, n: ++remote.seq };
  if (remote.enabled) remoteSend([l]);
  else if (remote.probing) remote.queue.push(l);
}
const info = (m, d) => log('info', m, d);
const warn = (m, d) => log('warn', m, d);
const error = (m, d) => log('error', m, d);

const onceKeys = new Set();
function once(key, level, msg, data) {
  if (onceKeys.has(key)) return;
  onceKeys.add(key);
  log(level, msg, data);
}

function errText(err) {
  if (!err) return 'unknown error';
  const where = err.stack ? String(err.stack).split('\n').find((l) => l.includes('.js')) : '';
  return `${err.name || 'Error'}: ${err.message || err}${where ? ' @ ' + where.trim() : ''}`;
}

(function restorePreviousLog() {
  try {
    previousLog = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  } catch {
    previousLog = [];
  }
  if (previousLog.length) {
    renderLogLine({ t: '--------', level: 'info', text: 'Previous page load (kept in case the browser crashed):' }, true);
    for (const l of previousLog) renderLogLine(l, true);
    renderLogLine({ t: '--------', level: 'info', text: 'New page load' }, true);
  }
})();

document.getElementById('log-copy')?.addEventListener('click', async () => {
  const text = [...previousLog.map((l) => `(prev) ${l.t} [${l.level}] ${l.text}`),
    ...logLines.map((l) => `${l.t} [${l.level}] ${l.text}`)].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    info('Log copied to clipboard');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); info('Log copied to clipboard'); } catch { warn('Copy failed'); }
    ta.remove();
  }
});
document.getElementById('log-clear')?.addEventListener('click', () => {
  logLines.length = 0;
  previousLog = [];
  if (logListEl) logListEl.innerHTML = '';
  persistLog();
  logState.dirty = true;
});
document.getElementById('log-toggle')?.addEventListener('click', (e) => {
  const panel = document.getElementById('log-panel');
  const collapsed = panel.classList.toggle('collapsed');
  e.target.textContent = collapsed ? 'Show' : 'Hide';
});

(async function probeLogServer() {
  try {
    const r = await fetch('/log/ping', { cache: 'no-store' });
    remote.enabled = r.ok && (await r.text()).trim() === 'tablecube-log-server';
  } catch {
    remote.enabled = false;
  }
  remote.probing = false;
  if (remote.enabled) {
    remoteSend(remote.queue);
    info('Laptop log server found: every log line is also sent there');
  } else {
    info('No laptop log server (only available when served by devserver.mjs)');
  }
  remote.queue = [];
})();

window.addEventListener('error', (e) => {
  error('Uncaught error', e.error ? errText(e.error) : `${e.message} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener('unhandledrejection', (e) => error('Unhandled promise rejection', errText(e.reason)));
document.addEventListener('visibilitychange', () => info('Page visibility', document.visibilityState));
window.addEventListener('pagehide', () => info('Page is being hidden or unloaded'));

// ---------------------------------------------------------------------------
// Page UI
// ---------------------------------------------------------------------------
const startBtn = document.getElementById('start');
const safeBtn = document.getElementById('start-safe');
const rawBtn = document.getElementById('start-raw');
const statusEl = document.getElementById('status');
const featuresEl = document.getElementById('features');
const FEATURE_KEY = 'tablecube-features-v1';
const pickerInputs = [...document.querySelectorAll('#feature-picker input[data-feature]')];

try {
  const saved = JSON.parse(localStorage.getItem(FEATURE_KEY) || 'null');
  if (Array.isArray(saved)) for (const inp of pickerInputs) inp.checked = saved.includes(inp.dataset.feature);
} catch { /* ignore */ }

function chosenFeatures() {
  return pickerInputs.filter((i) => i.checked).map((i) => i.dataset.feature);
}
for (const inp of pickerInputs) {
  inp.addEventListener('change', () => {
    try { localStorage.setItem(FEATURE_KEY, JSON.stringify(chosenFeatures())); } catch { /* ignore */ }
  });
}

// Table setup: 'corners' (point at the 4 corners) or 'detect' (camera). ?setup= overrides.
const SETUP_KEY = 'tablecube-setup-v1';
const setupInputs = [...document.querySelectorAll('#setup-picker input[name="setup"]')];
try {
  const saved = params.get('setup') || localStorage.getItem(SETUP_KEY);
  for (const inp of setupInputs) if (saved) inp.checked = inp.value === saved;
} catch { /* ignore */ }
function chosenSetup() {
  return setupInputs.find((i) => i.checked)?.value || 'corners';
}
for (const inp of setupInputs) {
  inp.addEventListener('change', () => {
    try { localStorage.setItem(SETUP_KEY, chosenSetup()); } catch { /* ignore */ }
  });
}

function setPageStatus(text) {
  statusEl.textContent = text;
}

function showFeatures(list) {
  featuresEl.innerHTML = '';
  for (const [name, ok] of list) {
    const li = document.createElement('li');
    li.className = ok ? 'ok' : 'no';
    li.textContent = name;
    featuresEl.appendChild(li);
  }
}

async function checkSupport() {
  info('Page loaded', {
    url: location.href,
    secure: window.isSecureContext,
    ua: navigator.userAgent,
  });
  if (!window.isSecureContext) {
    startBtn.textContent = 'Needs HTTPS or localhost';
    setPageStatus('WebXR only runs on https:// or http://localhost. Use GitHub Pages or adb reverse.');
    error('Not a secure context: WebXR is blocked. Use https:// or http://localhost');
    return;
  }
  if (!('xr' in navigator)) {
    startBtn.textContent = 'WebXR not available';
    setPageStatus('This browser has no WebXR. Open the page in the Magic Leap 2 browser.');
    error('navigator.xr is missing');
    return;
  }
  let ar = false, vr = false;
  try { ar = await navigator.xr.isSessionSupported('immersive-ar'); } catch (err) { warn('isSessionSupported(ar) threw', errText(err)); }
  try { vr = await navigator.xr.isSessionSupported('immersive-vr'); } catch { /* ignore */ }
  info('WebXR support', {
    'immersive-ar': ar,
    'immersive-vr': vr,
    XRWebGLBinding: typeof XRWebGLBinding !== 'undefined',
    getCameraImage: typeof XRWebGLBinding !== 'undefined' && 'getCameraImage' in XRWebGLBinding.prototype,
    XRRay: typeof XRRay !== 'undefined',
  });
  if (!ar) {
    startBtn.textContent = 'AR not supported here';
    setPageStatus('This device or browser cannot start an immersive AR session.');
    return;
  }
  startBtn.disabled = false;
  safeBtn.disabled = false;
  rawBtn.disabled = false;
  startBtn.textContent = 'Start AR';
  setPageStatus('Ready. Stand so the table is in front of you.');
}

// ---------------------------------------------------------------------------
// three.js scene
// ---------------------------------------------------------------------------
// We create the WebGL2 context ourselves with xrCompatible: true (like the raw test).
// Otherwise three.js calls gl.makeXRCompatible() inside setSession, which on Android
// Chromium can lose/recreate the GL context in the middle of starting the session.
// ?xrcompat=0 goes back to three.js's own context for comparison.
const glCanvas = document.createElement('canvas');
const glAttributes = {
  alpha: true,
  antialias: params.get('aa') !== '0',
  depth: true,
  stencil: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'default',
  xrCompatible: params.get('xrcompat') !== '0',
};
const glContext = glCanvas.getContext('webgl2', glAttributes);
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, context: glContext, ...glAttributes });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);
const gl = renderer.getContext();
info('WebGL context', {
  xrCompatible: gl.getContextAttributes()?.xrCompatible ?? 'not reported',
  antialias: gl.getContextAttributes()?.antialias,
  renderer: (() => {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  })(),
});

renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  error('WebGL context lost (GPU reset or out of memory)');
});
renderer.domElement.addEventListener('webglcontextrestored', () => info('WebGL context restored'));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
scene.add(camera); // so we can attach head-locked panels to it

scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

// Everything on the table hangs off this group: origin = table centre on its surface,
// local +X = the table's long side.
// Note: Magic Leap 2 is an additive display, so dark colours look transparent.
const tableAnchor = new THREE.Group();
tableAnchor.visible = false;
scene.add(tableAnchor);

// ---------------------------------------------------------------------------
// Diorama: the scene on the table, loaded from assets/scenes/<name>.json with the models
// from assets/library.json (see diorama.js). Built in real metres; this group is scaled
// down to fit the table, so all models keep true proportions.
// Diorama axes: +X = the table's long side, +Z = across the table, +Y = up.
//   ?scene=demo        which scene file (assets/scenes/demo.json)
//   ?asset=office-pv   show just one library asset (handy with ?preview=1)
//   ?scale=50          fixed 1:50 instead of "as big as fits"
//   ?flows=0           hide the energy flows
//   ?labels=0          hide the floating asset names (see asset-labels.js)
//   ?labelsize=1.5     make the asset names bigger (default 1, 1.8 in ?preview=1)
// ---------------------------------------------------------------------------
const DIORAMA = {
  fill: 0.85,               // use at most 85% of the table
  maxScale: 1 / 20,         // never bigger than 1:20, even on a huge table
  fixedScale: params.has('scale') ? 1 / parseFloat(params.get('scale')) : null,
  scene: params.get('scene') || 'demo',
  labels: params.get('labels') !== '0',
  // On a laptop screen the panels need to be bigger than in the headset to be readable.
  labelSize: params.has('labelsize') ? parseFloat(params.get('labelsize')) : params.get('preview') === '1' ? 1.8 : 1,
};

const diorama = new THREE.Group();
tableAnchor.add(diorama);
const dioramaState = { ground: { length: 15, width: 11 }, update: null, table: { length: 1.2, width: 0.8 } };
let assetLabels = null; // floating asset names, once asset-labels.js has loaded

(async function loadDiorama() {
  const asset = params.get('asset');
  try {
    info('Loading diorama…', asset ? { asset } : { scene: DIORAMA.scene });
    // Dynamic import: if the loader or a CDN file fails, the rest of the app keeps working.
    const { buildDiorama } = await import('./diorama.js');
    const d = await buildDiorama({
      sceneSource: asset
        ? { ground: 'auto', items: [{ id: asset, asset }] }
        : `assets/scenes/${encodeURIComponent(DIORAMA.scene)}.json`,
      libraryUrl: asset ? 'assets/library.json' : undefined,
      log: { info, warn },
    });
    d.flowsGroup.visible = params.get('flows') !== '0';
    if (DIORAMA.labels) await addAssetLabels(d);
    diorama.add(d.group);
    dioramaState.ground = d.ground;
    dioramaState.update = d.update;
    dioramaScale = 0; // force a log line with the real scale
    fitDiorama(dioramaState.table.length, dioramaState.table.width);
  } catch (err) {
    error('Diorama failed to load, showing a placeholder', errText(err));
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x33ccff }));
    box.position.y = 0.05;
    diorama.add(box);
    dioramaState.ground = { length: 0.1 / DIORAMA.maxScale, width: 0.1 / DIORAMA.maxScale };
  }
})();

// Scale the diorama to the table: true proportions, as big as fits.
let dioramaScale = 0;
function fitDiorama(tableLength, tableWidth) {
  dioramaState.table = { length: tableLength, width: tableWidth };
  const { length, width } = dioramaState.ground;
  let s = DIORAMA.fixedScale ?? Math.min(
    (DIORAMA.fill * tableLength) / length,
    (DIORAMA.fill * tableWidth) / width,
    DIORAMA.maxScale,
  );
  if (!(s > 0)) s = 1 / 100;
  diorama.scale.setScalar(s);
  if (Math.abs(s - dioramaScale) > 0.05 * s) {
    info('Diorama scaled', {
      scale: '1:' + Math.round(1 / s),
      footprint: `${(length * s * 100).toFixed(0)} x ${(width * s * 100).toFixed(0)} cm`,
    });
  }
  dioramaScale = s;
}

// Called every frame with the time since the last frame (seconds): animates the flows.
let lastDioramaTime = 0;
function animateDiorama(time) {
  const dt = lastDioramaTime ? Math.min(0.1, (time - lastDioramaTime) / 1000) : 0;
  lastDioramaTime = time;
  if (dioramaState.update && tableAnchor.visible) dioramaState.update(dt);
  if (assetLabels && tableAnchor.visible) assetLabels.update(diorama, dt);
}

// Floating name panels above the assets (asset-labels.js). Loaded separately: if it fails,
// the diorama still shows, just without names.
async function addAssetLabels(d) {
  try {
    const { createAssetLabels } = await import('./asset-labels.js');
    const labels = createAssetLabels({
      items: d.items, flows: d.flows, root: d.group, size: DIORAMA.labelSize, log: { info, warn },
    });
    tableAnchor.add(labels.group);
    assetLabels = labels;
    info('Asset labels ready', { count: labels.labels.length });
  } catch (err) {
    warn('Asset labels failed, showing the diorama without them', errText(err));
  }
}

// Rounded-rectangle outline of the detected table.
const outline = new THREE.LineLoop(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0x7cffb2 })
);
tableAnchor.add(outline);
let outlineDims = { length: 0, width: 0, radius: 0 };

function roundedRectPoints(length, width, radius) {
  const r = Math.max(0, Math.min(radius, length / 2, width / 2));
  const hx = length / 2 - r;
  const hz = width / 2 - r;
  const pts = [];
  const corners = [[hx, hz, 0], [-hx, hz, Math.PI / 2], [-hx, -hz, Math.PI], [hx, -hz, 1.5 * Math.PI]];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      pts.push(new THREE.Vector3(cx + r * Math.cos(a), 0.004, cz + r * Math.sin(a)));
    }
  }
  return pts;
}

function updateOutline(length, width, radius) {
  const d = outlineDims;
  if (Math.abs(d.length - length) < 0.005 && Math.abs(d.width - width) < 0.005 && Math.abs(d.radius - radius) < 0.005) return;
  outline.geometry.dispose();
  outline.geometry = new THREE.BufferGeometry().setFromPoints(roundedRectPoints(length, width, radius));
  outlineDims = { length, width, radius };
  fitDiorama(length, width);
}

// Reticle for gaze (fallback) mode.
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.04, 0.055, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffd60a })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// ---------------------------------------------------------------------------
// Head-locked panels (the web page is not visible inside the headset)
// Positions are in metres, 1 m in front of your eyes.
// ---------------------------------------------------------------------------
function makeCanvasPanel(cw, ch, mw, mh, x, y, order) {
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(mw, mh),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false })
  );
  mesh.renderOrder = order;
  mesh.position.set(x, y, -1.0);
  camera.add(mesh);
  return { canvas, ctx, texture, mesh };
}

// Status line, centre bottom.
const statusPanel = makeCanvasPanel(1024, 200, 0.46, 0.09, -0.02, -0.15, 999);
let lastStatus = '';
function setHud(line1, line2 = '') {
  const text = line1 + '\n' + line2;
  if (text === lastStatus) return;
  lastStatus = text;
  const { ctx, canvas, texture } = statusPanel;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = '600 46px system-ui, sans-serif';
  ctx.fillText(line1, canvas.width / 2, 62);
  ctx.fillStyle = 'rgba(170,230,255,0.95)';
  ctx.font = '400 32px system-ui, sans-serif';
  ctx.fillText(line2, canvas.width / 2, 142);
  texture.needsUpdate = true;
}

// Log, bottom right of the view.
const logPanel = makeCanvasPanel(1024, 512, 0.38, 0.19, 0.2, -0.33, 1000);
let lastLogDraw = 0;
function drawHeadsetLog(time) {
  if (!logState.dirty || time - lastLogDraw < 250) return; // max 4 redraws per second
  logState.dirty = false;
  lastLogDraw = time;
  const { ctx, canvas, texture } = logPanel;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
  ctx.font = '600 28px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lines = logLines.slice(-12);
  lines.forEach((l, i) => {
    ctx.fillStyle = l.level === 'error' ? '#ff8080' : l.level === 'warn' ? '#ffd860' : '#e6f4ff';
    let s = `${l.t.slice(3, 8)} ${l.text}`;
    if (s.length > 58) s = s.slice(0, 57) + '…';
    ctx.fillText(s, 16, 14 + i * 40);
  });
  texture.needsUpdate = true;
}

// Debug view of the detector, upper left of the view.
//   dimmed camera image, yellow = white pixels, cyan = chosen table blob, magenta = centre
function makeDebugPanel(w, h) {
  const data = new Uint8Array(w * h * 4);
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.28, 0.21),
    new THREE.MeshBasicMaterial({ map: texture, depthTest: false, depthWrite: false })
  );
  mesh.renderOrder = 998;
  mesh.position.set(-0.22, 0.05, -1.0);
  mesh.visible = CONFIG.debug;
  camera.add(mesh);

  return {
    get visible() { return mesh.visible; },
    toggle() {
      mesh.visible = !mesh.visible;
      info('Debug view ' + (mesh.visible ? 'on' : 'off'));
    },
    update(pixels, mask, labels, label, cx, cy) {
      const n = w * h;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        if (label && labels[i] === label) {
          data[j] = 0; data[j + 1] = 230; data[j + 2] = 255;
        } else if (mask[i]) {
          data[j] = 255; data[j + 1] = 214; data[j + 2] = 10;
        } else {
          data[j] = pixels[j] * 0.6; data[j + 1] = pixels[j + 1] * 0.6; data[j + 2] = pixels[j + 2] * 0.6;
        }
        data[j + 3] = 255;
      }
      if (label) {
        const x0 = Math.round(cx), y0 = Math.round(cy);
        for (let d = -4; d <= 4; d++) {
          for (const [x, y] of [[x0 + d, y0], [x0, y0 + d]]) {
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const j = (y * w + x) * 4;
            data[j] = 255; data[j + 1] = 0; data[j + 2] = 200;
          }
        }
      }
      texture.needsUpdate = true;
    },
  };
}
const debugPanel = makeDebugPanel(CONFIG.analysisWidth, CONFIG.analysisHeight);

// ---------------------------------------------------------------------------
// Camera image → small RGBA buffer (raw WebGL; three.js state is restored after)
// ---------------------------------------------------------------------------
class CameraReader {
  constructor(glContext, width, height) {
    this.gl = glContext;
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
    const g = this.gl;

    const vs = `#version 300 es
      in vec2 aPos;
      out vec2 vUv;
      void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
    // 4 taps per output pixel to reduce aliasing when shrinking the big camera image.
    const fs = `#version 300 es
      precision mediump float;
      in vec2 vUv;
      uniform sampler2D uTex;
      uniform bool uFlipY;
      uniform vec2 uStep;
      out vec4 outColor;
      void main() {
        vec2 uv = uFlipY ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
        vec4 c = texture(uTex, uv + vec2(-uStep.x, -uStep.y))
               + texture(uTex, uv + vec2( uStep.x, -uStep.y))
               + texture(uTex, uv + vec2(-uStep.x,  uStep.y))
               + texture(uTex, uv + vec2( uStep.x,  uStep.y));
        outColor = vec4(c.rgb * 0.25, 1.0);
      }`;

    this.program = this.#link(vs, fs);
    this.uTex = g.getUniformLocation(this.program, 'uTex');
    this.uFlipY = g.getUniformLocation(this.program, 'uFlipY');
    this.uStep = g.getUniformLocation(this.program, 'uStep');
    const aPos = g.getAttribLocation(this.program, 'aPos');

    this.vao = g.createVertexArray();
    g.bindVertexArray(this.vao);
    const buffer = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buffer);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
    g.enableVertexAttribArray(aPos);
    g.vertexAttribPointer(aPos, 2, g.FLOAT, false, 0, 0);
    g.bindVertexArray(null);

    this.target = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, this.target);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA8, width, height, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.bindTexture(g.TEXTURE_2D, null);

    this.fbo = g.createFramebuffer();
    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, this.target, 0);
    const status = g.checkFramebufferStatus(g.FRAMEBUFFER);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    if (status !== g.FRAMEBUFFER_COMPLETE) throw new Error('Camera framebuffer incomplete: 0x' + status.toString(16));
  }

  #link(vsSource, fsSource) {
    const g = this.gl;
    const compile = (type, src) => {
      const s = g.createShader(type);
      g.shaderSource(s, src);
      g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error('Shader: ' + g.getShaderInfoLog(s));
      return s;
    };
    const p = g.createProgram();
    g.attachShader(p, compile(g.VERTEX_SHADER, vsSource));
    g.attachShader(p, compile(g.FRAGMENT_SHADER, fsSource));
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error('Program: ' + g.getProgramInfoLog(p));
    return p;
  }

  // cameraTexture: from XRWebGLBinding.getCameraImage(). Only valid during this XR frame.
  read(cameraTexture) {
    const g = this.gl;
    g.bindFramebuffer(g.FRAMEBUFFER, this.fbo);
    g.viewport(0, 0, this.width, this.height);
    g.disable(g.DEPTH_TEST);
    g.disable(g.BLEND);
    g.disable(g.CULL_FACE);
    g.disable(g.SCISSOR_TEST);
    g.colorMask(true, true, true, true);
    g.useProgram(this.program);
    g.activeTexture(g.TEXTURE0);
    g.bindTexture(g.TEXTURE_2D, cameraTexture);
    g.uniform1i(this.uTex, 0);
    g.uniform1i(this.uFlipY, CONFIG.flipCameraY ? 1 : 0);
    g.uniform2f(this.uStep, 0.25 / this.width, 0.25 / this.height);
    g.bindVertexArray(this.vao);
    g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    g.readPixels(0, 0, this.width, this.height, g.RGBA, g.UNSIGNED_BYTE, this.pixels);
    g.bindVertexArray(null);
    g.bindTexture(g.TEXTURE_2D, null);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    return this.pixels; // row 0 = bottom of the image
  }
}

// ---------------------------------------------------------------------------
// Detection (pure functions, no three.js)
// ---------------------------------------------------------------------------
const W = CONFIG.analysisWidth;
const H = CONFIG.analysisHeight;
const scratch = {
  luma: new Uint8Array(W * H),
  raw: new Uint8Array(W * H),
  tmp: new Uint8Array(W * H),
  mask: new Uint8Array(W * H),
  outside: new Uint8Array(W * H),
  labels: new Int32Array(W * H),
  stack: new Int32Array(W * H),
  hist: new Uint32Array(256),
  ptX: new Float32Array(W * H),
  ptZ: new Float32Array(W * H),
  ptW: new Float32Array(W * H),
  bins: new Float64Array(512),
};

// Weighted 'lo' and 'hi' quantiles of values[0..n) (histogram, no sorting).
function weightedRange(values, weights, n, lo, hi) {
  let min = Infinity, max = -Infinity, total = 0;
  for (let i = 0; i < n; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
    total += weights[i];
  }
  const bins = scratch.bins;
  const nb = bins.length;
  bins.fill(0);
  const span = max - min || 1e-6;
  for (let i = 0; i < n; i++) {
    bins[Math.min(nb - 1, Math.floor(((values[i] - min) / span) * nb))] += weights[i];
  }
  let acc = 0, a = min, b = max, gotA = false;
  for (let k = 0; k < nb; k++) {
    acc += bins[k];
    if (!gotA && acc >= lo * total) { a = min + (k / nb) * span; gotA = true; }
    if (acc >= hi * total) { b = min + ((k + 1) / nb) * span; break; }
  }
  return [a, b];
}

function dilate(src, dst, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      dst[i] = src[i] || (x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) ||
        (y > 0 && src[i - w]) || (y < h - 1 && src[i + w]) ? 1 : 0;
    }
  }
}

function erode(src, dst, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      dst[i] = src[i] && (x === 0 || src[i - 1]) && (x === w - 1 || src[i + 1]) &&
        (y === 0 || src[i - w]) && (y === h - 1 || src[i + w]) ? 1 : 0;
    }
  }
}

// Holes = background regions that do not touch the image border (a laptop or cup on the table).
function fillHoles(mask, w, h) {
  const { outside, stack } = scratch;
  outside.fill(0);
  let sp = 0;
  const push = (i) => { if (!mask[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  for (let i = 0; i < w * h; i++) if (!mask[i] && !outside[i]) mask[i] = 1;
}

// Otsu split of the histogram between brightness 'from' and 255.
function otsuSplit(hist, from) {
  let total = 0, sumAll = 0;
  for (let v = from; v < 256; v++) { total += hist[v]; sumAll += v * hist[v]; }
  if (total === 0) return null;
  let wB = 0, sumB = 0, best = -1, res = null;
  for (let v = from; v < 256; v++) {
    wB += hist[v];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += v * hist[v];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; res = { thr: v + 1, meanLow: mB, meanHigh: mF, countHigh: wF }; }
  }
  return res;
}

// Split dark from bright, then keep splitting the bright group while it still contains
// two clearly different brightness levels (light-grey surroundings vs the white table).
function otsuThreshold(hist, total) {
  const first = otsuSplit(hist, 0);
  if (!first) return 128;
  let thr = first.thr;
  for (let k = 0; k < 2; k++) {
    const next = otsuSplit(hist, thr);
    if (!next || next.meanHigh - next.meanLow < 45 || next.countHigh < CONFIG.minAreaFraction * total) break;
    thr = next.thr;
  }
  return thr;
}

function detectWhiteBlobs(px, w, h) {
  const n = w * h;
  const { luma, raw, tmp, mask, labels, stack, hist } = scratch;
  hist.fill(0);
  labels.fill(0);

  // Brightness per pixel + histogram, so the threshold adapts to camera exposure.
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const l = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
    luma[i] = l;
    hist[l]++;
  }
  // Otsu's method: the brightness that best splits the image into a darker group
  // (grey/colourful surroundings) and a brighter group (the white table).
  const threshold = CONFIG.whiteLuma ??
    Math.min(CONFIG.maxAutoThreshold, Math.max(CONFIG.minWhiteLuma, otsuThreshold(hist, n)));

  // White = bright enough and not colourful.
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = px[j], g = px[j + 1], b = px[j + 2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    raw[i] = luma[i] >= threshold && sat <= CONFIG.maxSaturation ? 1 : 0;
  }

  // Close 1-pixel gaps along edges, then fill holes from objects on the table.
  dilate(raw, tmp, w, h);
  erode(tmp, mask, w, h);
  fillHoles(mask, w, h);

  // Connected blobs (4-neighbour flood fill).
  const candidates = [];
  let label = 0;
  const minCount = CONFIG.minAreaFraction * n;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start]) continue;
    label++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let count = 0, border = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      count++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border++;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = label; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = label; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !labels[i - w]) { labels[i - w] = label; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !labels[i + w]) { labels[i + w] = label; stack[sp++] = i + w; }
    }
    if (count < minCount) continue;

    // Loose shape check in the image: a filled rectangle has area = 12 * sqrt(l1 * l2).
    const cx = sx / count, cy = sy / count;
    const cxx = sxx / count - cx * cx;
    const cyy = syy / count - cy * cy;
    const cxy = sxy / count - cx * cy;
    const tr = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(tr / 2 - disc, 1e-6);
    const imageFill = count / (12 * Math.sqrt(l1 * l2));
    if (imageFill < CONFIG.minImageFill) continue;

    candidates.push({
      label, count, cx, cy, imageFill,
      areaFraction: count / n,
      touchesBorder: border > 0,
      score: count * Math.min(imageFill, 1),
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return { candidates: candidates.slice(0, 3), threshold, mask, labels };
}

// Projects every pixel of one blob onto the horizontal plane y = planeY and fits a
// rounded rectangle in metres.
//   projection: view.projectionMatrix (column-major), pose: view.transform.matrix
// Each pixel is weighted by the floor area it covers, so near pixels don't dominate.
function fitTableOnPlane(projection, pose, labels, label, w, h, planeY) {
  const P = projection, M = pose;
  const ox = M[12], oy = M[13], oz = M[14];
  const pixelArea = (2 / (w * P[0])) * (2 / (h * P[5])); // pixel size at 1 m depth
  let sw = 0, sx = 0, sz = 0, sxx = 0, szz = 0, sxz = 0, used = 0;

  for (let py = 0; py < h; py++) {
    const vy = (((py + 0.5) / h) * 2 - 1 + P[9]) / P[5];
    for (let pxi = 0; pxi < w; pxi++) {
      if (labels[py * w + pxi] !== label) continue;
      const vx = (((pxi + 0.5) / w) * 2 - 1 + P[8]) / P[0];
      // View-space direction (vx, vy, -1) rotated into the reference space.
      const dx = M[0] * vx + M[4] * vy - M[8];
      const dy = M[1] * vx + M[5] * vy - M[9];
      const dz = M[2] * vx + M[6] * vy - M[10];
      if (Math.abs(dy) < 1e-5) continue;
      const s = (planeY - oy) / dy; // depth along the view axis
      if (!(s > 0)) continue;
      if (s * Math.hypot(dx, dy, dz) > CONFIG.maxDistance) continue;
      const x = ox + s * dx;
      const z = oz + s * dz;
      const wgt = ((s * s) / Math.abs(dy)) * pixelArea; // square metres this pixel covers
      sw += wgt; sx += wgt * x; sz += wgt * z;
      sxx += wgt * x * x; szz += wgt * z * z; sxz += wgt * x * z;
      scratch.ptX[used] = x;
      scratch.ptZ[used] = z;
      scratch.ptW[used] = wgt;
      used++;
    }
  }
  if (used < 30 || sw <= 0) return null;

  // Direction of the long side from the second moments.
  const mx = sx / sw, mz = sz / sw;
  const vxx = sxx / sw - mx * mx;
  const vzz = szz / sw - mz * mz;
  const vxz = sxz / sw - mx * mz;
  const angle = 0.5 * Math.atan2(2 * vxz, vxx - vzz); // long axis = (cos, sin) in (x, z)
  const ca = Math.cos(angle), sa = Math.sin(angle);

  // Real extents along both table axes (trimmed a little against stray pixels).
  // Using extents, not variance, keeps the size right when the corners are rounded.
  const { ptX, ptZ, ptW } = scratch;
  const along = new Float32Array(used), across = new Float32Array(used);
  for (let i = 0; i < used; i++) {
    const rx = ptX[i] - mx, rz = ptZ[i] - mz;
    along[i] = rx * ca + rz * sa;
    across[i] = -rx * sa + rz * ca;
  }
  const [a0, a1] = weightedRange(along, ptW, used, 0.002, 0.998);
  const [b0, b1] = weightedRange(across, ptW, used, 0.002, 0.998);
  let length = a1 - a0;
  let width = b1 - b0;
  const midA = (a0 + a1) / 2, midB = (b0 + b1) / 2;
  const cx = mx + midA * ca - midB * sa;
  const cz = mz + midA * sa + midB * ca;
  const fill = sw / (length * width);
  let axisAngle = angle;
  if (width > length) { // nearly square table: keep "length" the longer side
    [length, width] = [width, length];
    axisAngle += Math.PI / 2;
  }

  // A rounded rectangle misses (4 - π)·r² of its bounding box. Estimate r from that.
  const missing = Math.max(0, length * width - sw);
  const radius = Math.min(0.45 * width, Math.sqrt(missing / (4 - Math.PI)));

  return {
    cx, cz, y: planeY,
    yaw: -axisAngle, // three.js rotation.y that turns local +X onto the long axis
    length, width, radius, fill, area: sw, used,
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();

// Ray from the camera through image point (u, v), both 0..1 with v = 0 at the bottom.
function rayFromView(view, u, v) {
  _inv.fromArray(view.projectionMatrix).invert();
  const dir = new THREE.Vector3(u * 2 - 1, v * 2 - 1, 0.5).applyMatrix4(_inv).normalize();
  _m.fromArray(view.transform.matrix);
  const origin = new THREE.Vector3().setFromMatrixPosition(_m);
  dir.transformDirection(_m);
  return { origin, dir };
}

function pointInPolygonXZ(x, z, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// Height of the nearest detected horizontal plane that the ray passes through.
function heightFromPlanes(frame, refSpace, ray) {
  const planes = frame.detectedPlanes;
  if (!planes) {
    once('planes-undefined', 'warn', 'frame.detectedPlanes is not available');
    return null;
  }
  once('planes-first', 'info', 'Plane detection active', { planes: planes.size });
  let best = null;
  for (const plane of planes) {
    once('plane-orient-' + plane.orientation, 'info', 'Plane orientation seen', String(plane.orientation));
    if (String(plane.orientation).toLowerCase() !== 'horizontal') continue;
    const pose = frame.getPose(plane.planeSpace, refSpace);
    if (!pose) continue;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const p0 = new THREE.Vector3().setFromMatrixPosition(m);
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(m);
    const denom = normal.dot(ray.dir);
    if (Math.abs(denom) < 1e-4) continue;
    const t = normal.dot(p0.clone().sub(ray.origin)) / denom;
    if (t <= 0) continue;
    const hit = ray.origin.clone().addScaledVector(ray.dir, t);
    if (hit.y < floorY() + CONFIG.minTableHeight) continue;
    const local = hit.clone().applyMatrix4(m.clone().invert());
    if (!pointInPolygonXZ(local.x, local.z, plane.polygon)) continue;
    if (!best || t < best.t) best = { t, y: hit.y };
  }
  return best ? best.y : null;
}

// A rectangle looks the same after a half turn, so keep yaw differences within ±90°.
function wrapHalf(a) {
  return a - Math.PI * Math.round(a / Math.PI);
}

function meanLuma(px) {
  let s = 0;
  for (let j = 0; j < px.length; j += 4) s += (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
  return Math.round(s / (px.length / 4));
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------
const state = {
  session: null,
  startedAt: 0,
  mode: 'camera',          // 'camera' or 'gaze'
  usingFloor: true,
  features: {},
  glBinding: null,
  reader: null,
  frameCount: 0,
  renderedFrames: 0,
  cameraWaitStart: 0,
  cameraErrors: 0,
  frameErrors: 0,
  lastHeartbeat: 0,
  fpsFrames: 0,
  // camera-ray hit-test
  rayHitSource: null,
  rayHitPending: false,
  lastRayRequest: 0,
  // gaze fallback hit-test
  viewerHitSource: null,
  // tracking (smoothed table estimate)
  table: null,             // { pos: Vector3, yaw, length, width, radius }
  stable: 0,
  locked: false,
  measuredY: null,
  heightSource: '',
};

function floorY() {
  // local-floor: floor is y = 0. local: origin is the head at start, floor ~1.6 m below.
  return state.usingFloor ? 0 : -1.6;
}

function resetTracking() {
  state.table = null;
  state.stable = 0;
  state.locked = false;
  state.measuredY = null;
  state.heightSource = '';
  tableAnchor.visible = false;
}

function featureLine() {
  const f = state.features;
  const mark = (ok) => (ok ? '✓' : '✗');
  return `camera ${mark(f['camera-access'])}  hit-test ${mark(f['hit-test'])}  planes ${mark(f['plane-detection'])}  floor ${mark(f['local-floor'])}`;
}

async function requestRayHitTest(session, refSpace, ray) {
  if (state.rayHitPending || !state.features['hit-test']) return;
  state.rayHitPending = true;
  once('ray-hit-request', 'info', 'Requesting hit-test along the camera ray…');
  try {
    const source = await session.requestHitTestSource({
      space: refSpace,
      offsetRay: new XRRay(
        { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z, w: 1 },
        { x: ray.dir.x, y: ray.dir.y, z: ray.dir.z, w: 0 }
      ),
    });
    once('ray-hit-ok', 'info', 'Camera-ray hit-test source created');
    if (state.rayHitSource) state.rayHitSource.cancel();
    state.rayHitSource = source;
  } catch (err) {
    warn('Camera-ray hit-test failed, turning it off', errText(err));
    state.features['hit-test'] = false;
  } finally {
    state.rayHitPending = false;
  }
}

function switchToGaze(reason) {
  if (state.mode === 'gaze') return;
  warn('Switching to gaze mode', reason);
  state.mode = 'gaze';
  resetTracking();
  outline.visible = false;
  if (state.features['hit-test'] && !state.viewerHitSource && state.session) {
    const session = state.session;
    info('Requesting gaze hit-test…');
    session.requestReferenceSpace('viewer')
      .then((viewerSpace) => session.requestHitTestSource({ space: viewerSpace }))
      .then((source) => { state.viewerHitSource = source; info('Gaze hit-test ready'); })
      .catch((err) => warn('Gaze hit-test failed', errText(err)));
  }
}

// ---------------------------------------------------------------------------
// Corner calibration: aim the controller at the 4 table corners, press the trigger
// ---------------------------------------------------------------------------
// Corner 1: hit-test along the controller ray → detected planes → controller tip.
// Corners 2–4: the ray meets the horizontal plane at the height of the corners so far
// (or the controller tip, if it touches the table), so aiming at the very edge of the
// table can't slip onto the floor behind it.

// Fits a rectangle to 4 corners given in any order. Pure function: points are {x, y, z}.
// Returns centre, yaw (three.js rotation.y that turns local +X onto the long side),
// length, width and how far the corners are from a perfect rectangle.
function rectFromCorners(points) {
  const n = points.length;
  let cx = 0, cz = 0, y = 0, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    cx += p.x; cz += p.z; y += p.y;
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  cx /= n; cz /= n; y /= n;
  // Order around the centre, so the click order doesn't matter.
  const ps = [...points].sort((a, b) => Math.atan2(a.z - cz, a.x - cx) - Math.atan2(b.z - cz, b.x - cx));
  const edges = ps.map((p, i) => {
    const q = ps[(i + 1) % n];
    return { a: Math.atan2(q.z - p.z, q.x - p.x), len: Math.hypot(q.x - p.x, q.z - p.z) };
  });
  // Opposite edges (0/2 and 1/3) point in opposite directions; wrapHalf ignores that.
  const angA = edges[0].a + wrapHalf(edges[2].a - edges[0].a) / 2;
  const angB = edges[1].a + wrapHalf(edges[3].a - edges[1].a) / 2;
  const skew = wrapHalf(angB - angA - Math.PI / 2);
  let axis = angA + skew / 2; // best compromise between both edge pairs
  // Size: a rectangle's corners all lie at ±L/2 and ±W/2 along its own axes.
  const ca = Math.cos(axis), sa = Math.sin(axis);
  let su = 0, sv = 0;
  for (const p of ps) {
    const rx = p.x - cx, rz = p.z - cz;
    su += Math.abs(rx * ca + rz * sa);
    sv += Math.abs(-rx * sa + rz * ca);
  }
  let length = (2 * su) / n, width = (2 * sv) / n;
  if (width > length) {
    [length, width] = [width, length];
    axis += Math.PI / 2;
  }
  const mismatch = Math.max(
    Math.abs(edges[0].len - edges[2].len) / Math.max(edges[0].len, edges[2].len, 1e-6),
    Math.abs(edges[1].len - edges[3].len) / Math.max(edges[1].len, edges[3].len, 1e-6),
  );
  return {
    cx, cz, y, yaw: -axis, length, width,
    skewDeg: Math.abs(skew) * 180 / Math.PI,
    mismatch,                 // 0 = opposite edges equally long
    heightSpread: maxY - minY,
  };
}

const calib = {
  points: [],             // THREE.Vector3 per placed corner
  hows: [],               // how each corner was measured (for the log)
  sources: new Map(),     // XRInputSource → { hit: XRHitTestSource | null, aim }
  active: null,           // input source whose laser is shown
  done: false,
  lastPlace: 0,
  lastBumper: 0,
};

const calibGroup = new THREE.Group();
calibGroup.visible = false;
scene.add(calibGroup);
// Bright colours: the Magic Leap 2 display is additive, dark = invisible.
const CORNER_COLOURS = [0xff5ad1, 0xffd60a, 0x5affc8, 0x5ac8ff];

function makeDynamicLine(maxPoints, color, parent = calibGroup) {
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
  line.frustumCulled = false;
  parent.add(line);
  return {
    line,
    set(points) {
      const k = Math.min(points.length, maxPoints);
      for (let i = 0; i < k; i++) attr.setXYZ(i, points[i].x, points[i].y, points[i].z);
      attr.needsUpdate = true;
      geo.setDrawRange(0, k);
    },
  };
}
const laser = makeDynamicLine(2, 0xffffff);
const cornerEdges = makeDynamicLine(6, 0xffd60a);

const cursorMat = new THREE.MeshBasicMaterial({ color: CORNER_COLOURS[0], side: THREE.DoubleSide });
const aimCursor = new THREE.Group();
aimCursor.add(new THREE.Mesh(new THREE.RingGeometry(0.02, 0.03, 32).rotateX(-Math.PI / 2), cursorMat));
aimCursor.add(new THREE.Mesh(new THREE.SphereGeometry(0.006, 12, 8), cursorMat));
aimCursor.visible = false;
calibGroup.add(aimCursor);

const cornerGeo = new THREE.SphereGeometry(0.012, 16, 12);
const cornerMarkers = CORNER_COLOURS.map((c) => {
  const m = new THREE.Mesh(cornerGeo, new THREE.MeshBasicMaterial({ color: c }));
  m.visible = false;
  calibGroup.add(m);
  return m;
});

const _m2 = new THREE.Matrix4();

function trackInputSource(src) {
  if (src.targetRayMode !== 'tracked-pointer' || calib.sources.has(src)) return;
  const entry = { hit: null, aim: null };
  calib.sources.set(src, entry);
  if (!state.features['hit-test'] || !state.session) return;
  state.session.requestHitTestSource({ space: src.targetRaySpace })
    .then((hs) => {
      if (calib.sources.get(src) === entry) {
        entry.hit = hs;
        once('ctrl-hit-ok', 'info', 'Controller hit-test ready');
      } else {
        try { hs.cancel(); } catch { /* ignore */ }
      }
    })
    .catch((err) => once('ctrl-hit-fail', 'warn', 'Controller hit-test failed (using planes / controller tip)', errText(err)));
}

function untrackInputSource(src) {
  const entry = calib.sources.get(src);
  if (!entry) return;
  try { entry.hit?.cancel(); } catch { /* already gone */ }
  calib.sources.delete(src);
  if (calib.active === src) calib.active = null;
}

function hasController() {
  for (const s of calib.sources.keys()) if (s.gamepad) return true;
  return false;
}

function pickActiveSource() {
  if (calib.active && calib.sources.has(calib.active)) return calib.active;
  let best = null;
  for (const s of calib.sources.keys()) {
    if (s.gamepad) return s; // the Magic Leap controller wins over hands
    if (!best || s.handedness === 'right') best = s;
  }
  return best;
}

function cornerHeightSoFar() {
  if (!calib.points.length) return null;
  return calib.points.reduce((s, p) => s + p.y, 0) / calib.points.length;
}

// Where this input source is pointing at right now: { origin, dir, point, how }.
function aimPoint(frame, refSpace, src, entry) {
  const rp = frame.getPose(src.targetRaySpace, refSpace);
  if (!rp) return null;
  _m.fromArray(rp.transform.matrix);
  const origin = new THREE.Vector3().setFromMatrixPosition(_m);
  const dir = new THREE.Vector3(0, 0, -1).transformDirection(_m);
  const onPlane = (planeY) => {
    if (dir.y > -1e-3) return null; // pointing up or level: never reaches the table
    const t = (planeY - origin.y) / dir.y;
    if (t <= 0 || t > CONFIG.maxDistance) return null;
    return origin.clone().addScaledVector(dir, t);
  };

  const tableY = cornerHeightSoFar();
  if (tableY !== null) {
    if (Math.abs(origin.y - tableY) < CONFIG.touchDistance) {
      return { origin, dir, point: new THREE.Vector3(origin.x, tableY, origin.z), how: 'controller tip' };
    }
    return { origin, dir, point: onPlane(tableY), how: 'ray on table plane' };
  }

  // First corner: the table height is still unknown.
  if (entry.hit) {
    const minY = floorY() + CONFIG.minTableHeight;
    for (const r of frame.getHitTestResults(entry.hit)) {
      const p = r.getPose(refSpace);
      if (!p) continue;
      _m2.fromArray(p.transform.matrix);
      const normalY = _m2.elements[5]; // hit pose's Y axis = surface normal
      if (p.transform.position.y < minY || normalY < 0.8) continue; // floor or wall
      const q = p.transform.position;
      return { origin, dir, point: new THREE.Vector3(q.x, q.y, q.z), how: 'hit-test' };
    }
  }
  if (state.features['plane-detection']) {
    const y = heightFromPlanes(frame, refSpace, { origin, dir });
    const point = y !== null ? onPlane(y) : null;
    if (point) return { origin, dir, point, how: 'plane' };
  }
  return { origin, dir, point: origin.clone(), how: 'controller tip' };
}

function startCalibration(reason) {
  calib.points.length = 0;
  calib.hows.length = 0;
  calib.done = false;
  calib.lastPlace = 0;
  for (const m of cornerMarkers) m.visible = false;
  resetTracking();
  outline.visible = false;
  calibGroup.visible = true;
  info('Corner calibration started', reason);
}

// Ignore hand pinches/grabs while the controller is connected (they fire by accident).
function acceptInput(src, what) {
  if (src && !src.gamepad && hasController()) {
    once('ignore-hand-' + what, 'info', `Ignoring hand ${what} while the controller is connected`);
    return false;
  }
  return true;
}

function placeCorner(src) {
  if (calib.done) return; // use the bumper to calibrate again
  if (!acceptInput(src, 'pinch')) return;
  const now = performance.now();
  if (now - calib.lastPlace < 350) return; // double press
  if (src && calib.sources.has(src)) calib.active = src;
  const s = pickActiveSource();
  const aim = s ? calib.sources.get(s)?.aim : null;
  if (!aim?.point) {
    warn('Cannot place a corner: the controller is not pointing at the table');
    return;
  }
  if (calib.points.some((p) => p.distanceTo(aim.point) < 0.05)) {
    info('Ignored: less than 5 cm from a corner that is already placed');
    return;
  }
  calib.lastPlace = now;
  const i = calib.points.length;
  calib.points.push(aim.point.clone());
  calib.hows.push(aim.how);
  cornerMarkers[i].position.copy(aim.point);
  cornerMarkers[i].visible = true;
  info(`Corner ${i + 1} placed`, {
    at: [aim.point.x, aim.point.y, aim.point.z].map((v) => +v.toFixed(3)),
    how: aim.how,
    aboveFloor: +(aim.point.y - floorY()).toFixed(2),
  });
  if (calib.points.length === 4) finishCalibration();
}

function undoCorner() {
  if (!calib.points.length) return;
  calib.points.pop();
  calib.hows.pop();
  cornerMarkers[calib.points.length].visible = false;
  info(`Corner ${calib.points.length + 1} removed`);
}

function finishCalibration() {
  const r = rectFromCorners(calib.points);
  const radius = CONFIG.cornerRadius ?? 0;
  calib.done = true;
  state.locked = true;
  state.table = { pos: new THREE.Vector3(r.cx, r.y, r.cz), yaw: r.yaw, length: r.length, width: r.width, radius };
  tableAnchor.position.copy(state.table.pos);
  tableAnchor.rotation.set(0, r.yaw, 0);
  updateOutline(r.length, r.width, radius);
  outline.visible = true;
  tableAnchor.visible = true;
  laser.set([]);
  cornerEdges.set([]);
  aimCursor.visible = false;
  info('Table calibrated', {
    centre: [r.cx, r.y, r.cz].map((v) => +v.toFixed(3)),
    size: `${r.length.toFixed(2)} x ${r.width.toFixed(2)} m`,
    yawDeg: +(r.yaw * 180 / Math.PI).toFixed(1),
    aboveFloor: +(r.y - floorY()).toFixed(2),
    skewDeg: +r.skewDeg.toFixed(1),
    edgeMismatch: +r.mismatch.toFixed(2),
    heightSpread: +r.heightSpread.toFixed(3),
    how: calib.hows,
  });
  if (r.skewDeg > 10 || r.mismatch > 0.15) {
    warn('The 4 corners are far from a rectangle. Press the bumper to calibrate again if the outline looks wrong.');
  }
}

// Bumper (top button) = undo the last corner, or calibrate again once done.
// It can arrive as a 'squeeze' event and/or via polling the gamepad; one press = one action.
function bumperAction(src, via) {
  if (!acceptInput(src, 'grab')) return;
  const now = performance.now();
  if (now - calib.lastBumper < 400) return;
  calib.lastBumper = now;
  once('bumper-via-' + via, 'info', 'Bumper detected via ' + via);
  if (calib.done) startCalibration('bumper: calibrate again');
  else undoCorner();
}

function onSqueeze(e) {
  if (state.mode !== 'corners') {
    debugPanel.toggle();
    return;
  }
  bumperAction(e?.inputSource, 'squeeze event');
}

// The Magic Leap 2 browser doesn't fire 'squeeze' for the bumper, so we poll the gamepad.
// xr-standard: 0 = trigger, 1 = squeeze. The ML2 controller ('magicleap-one' profile)
// reports the bumper as button 5 (seen in the logs), so both count as the bumper.
const BUMPER_BUTTONS = [1, 5];
function pollControllerButtons() {
  for (const [src, entry] of calib.sources) {
    const buttons = src.gamepad?.buttons;
    if (!buttons) continue;
    // Hands have their own button layout (a grab shows up as button 4): skip them.
    if (src.profiles.some((p) => p.startsWith('generic-hand'))) continue;
    entry.prev ??= [];
    for (let i = 0; i < buttons.length; i++) {
      const down = buttons[i].pressed;
      if (down && !entry.prev[i]) {
        once('btn-' + i, 'info', `Controller button ${i} pressed (first time)`, { profiles: src.profiles });
        if (BUMPER_BUTTONS.includes(i)) bumperAction(src, 'gamepad button ' + i);
      }
      entry.prev[i] = down;
    }
  }
}

function cornersStep(frame, refSpace) {
  pollControllerButtons();
  for (const [src, entry] of calib.sources) entry.aim = aimPoint(frame, refSpace, src, entry);
  if (calib.done) {
    const t = state.table;
    setHud(
      `Table calibrated  ·  ${t.length.toFixed(2)} × ${t.width.toFixed(2)} m`,
      (assetLabels ? 'trigger on a name = details   ·   ' : '') + 'bumper = calibrate again'
    );
    return;
  }

  const n = calib.points.length;
  const src = pickActiveSource();
  const aim = src ? calib.sources.get(src).aim : null;
  if (aim?.point) {
    aimCursor.position.copy(aim.point);
    aimCursor.visible = true;
    cursorMat.color.setHex(CORNER_COLOURS[n]);
    laser.set(aim.how === 'controller tip' ? [] : [aim.origin, aim.point]);
  } else if (aim) {
    aimCursor.visible = false;
    laser.set([aim.origin, aim.origin.clone().addScaledVector(aim.dir, 2)]);
  } else {
    aimCursor.visible = false;
    laser.set([]);
  }
  const path = [...calib.points];
  if (aimCursor.visible) path.push(aimCursor.position);
  if (path.length === 4) path.push(path[0]); // preview the closed outline
  cornerEdges.set(path);

  let hint = 'bumper = undo';
  if (!src) hint = 'no controller or hand ray found';
  else if (!aim?.point) hint = 'point down at the table';
  else if (n === 0 && aim.how === 'controller tip') hint = 'no surface found: touch the corner with the controller tip';
  else hint = `${aim.how}   ·   ${n ? 'bumper = undo' : 'any order'}`;
  setHud(`Corner ${n + 1} of 4: aim at a table corner, press the trigger`, hint);
}

// ---------------------------------------------------------------------------
// Asset labels: a name panel floats above every asset on the table (asset-labels.js).
// Point the controller at one and press the trigger to drop down its details.
// ---------------------------------------------------------------------------
const labelRaycaster = new THREE.Raycaster();
labelRaycaster.camera = camera; // sprites are raycast as seen from the head
labelRaycaster.far = CONFIG.maxDistance;
// Controller ray: faint while it points at nothing, bright up to the panel it points at.
const labelPointer = makeDynamicLine(2, 0xffffff, scene);
labelPointer.line.material.transparent = true;

function labelsShown() {
  return assetLabels !== null && tableAnchor.visible && assetLabels.group.visible;
}

// Where an input source points, in the reference space: { origin, dir } or null.
function sourceRay(frame, refSpace, src) {
  const p = frame.getPose(src.targetRaySpace, refSpace);
  if (!p) return null;
  _m.fromArray(p.transform.matrix);
  return {
    origin: new THREE.Vector3().setFromMatrixPosition(_m),
    dir: new THREE.Vector3(0, 0, -1).transformDirection(_m),
  };
}

function pickLabel(ray) {
  labelRaycaster.set(ray.origin, ray.dir);
  return assetLabels.pick(labelRaycaster);
}

// Every XR frame: highlight the panel the controller points at.
function labelsStep(frame, refSpace) {
  const src = labelsShown() ? pickActiveSource() : null;
  const ray = src ? sourceRay(frame, refSpace, src) : null;
  const hit = ray ? pickLabel(ray) : null;
  assetLabels?.setHover(hit?.label ?? null);
  if (!ray) {
    labelPointer.set([]);
    return;
  }
  labelPointer.set([ray.origin, hit ? hit.point : ray.origin.clone().addScaledVector(ray.dir, 1.5)]);
  labelPointer.line.material.opacity = hit ? 0.9 : 0.3;
}

// Trigger: show or hide the details of the panel the input points at. True if it hit one.
function toggleLabelAt(e) {
  if (!labelsShown()) return false;
  const src = e?.inputSource;
  if (src && !src.gamepad && hasController()) return false; // stray hand pinch
  let hit = null;
  if (src && e.frame) {
    const ray = sourceRay(e.frame, renderer.xr.getReferenceSpace(), src);
    if (ray) hit = pickLabel(ray);
  }
  const label = hit?.label ?? assetLabels.hovered;
  if (!label) return false;
  assetLabels.toggle(label);
  return true;
}

// ---------------------------------------------------------------------------
// Per-frame logic
// ---------------------------------------------------------------------------
function readCameraPixels(frame, view) {
  const xrTarget = renderer.getRenderTarget();
  let pixels = null;
  try {
    if (!state.glBinding) {
      info('Creating camera binding (XRWebGLBinding)…');
      state.glBinding = new XRWebGLBinding(frame.session, gl);
      state.reader = new CameraReader(gl, W, H);
      info('Camera reader ready');
    }
    once('cam-call', 'info', 'Calling getCameraImage for the first time…');
    const texture = state.glBinding.getCameraImage(view.camera);
    if (!texture) {
      once('cam-null', 'warn', 'getCameraImage returned no texture (will keep trying)');
      return null;
    }
    once('cam-readpx', 'info', 'Reading camera pixels for the first time…');
    pixels = state.reader.read(texture);
    const glErr = gl.getError();
    if (glErr) once('gl-err-' + glErr, 'warn', 'WebGL error after camera read', '0x' + glErr.toString(16));
    once('cam-read-ok', 'info', 'First camera frame read', { meanBrightness: meanLuma(pixels) });
  } catch (err) {
    state.cameraErrors++;
    once('cam-err-' + (err && err.message), 'error', 'Camera read failed', errText(err));
    if (state.cameraErrors >= 3) switchToGaze('camera read keeps failing');
    pixels = null;
  } finally {
    renderer.resetState();          // three.js forgets its cached GL state…
    renderer.setRenderTarget(xrTarget); // …and draws into the headset again
  }
  return pixels;
}

function cameraStep(time, frame, pose, refSpace) {
  if (state.locked) {
    setHud('Table locked', 'Trigger = detect again   ·   ' + featureLine());
    return;
  }

  state.frameCount++;
  if (state.frameCount % CONFIG.analyseEveryNFrames !== 0) return;

  const viewIndex = pose.views.findIndex((v) => v.camera);
  if (viewIndex < 0) {
    if (!state.cameraWaitStart) {
      state.cameraWaitStart = time;
      info('Waiting for camera image: no view has a camera yet', { views: pose.views.length });
    }
    const waited = time - state.cameraWaitStart;
    if (waited > CONFIG.cameraTimeoutMs) switchToGaze(`no camera image after ${Math.round(waited / 1000)} s`);
    setHud('Waiting for the camera image…', featureLine());
    return;
  }
  const view = pose.views[viewIndex];
  if (state.cameraWaitStart) {
    info('Camera image arrived after ' + Math.round(time - state.cameraWaitStart) + ' ms');
    state.cameraWaitStart = 0;
  }
  once('cam-found', 'info', 'Camera view found', {
    view: viewIndex,
    eye: view.eye,
    size: `${view.camera.width}x${view.camera.height}`,
    views: pose.views.length,
  });

  const pixels = readCameraPixels(frame, view);
  if (!pixels) return;

  const det = detectWhiteBlobs(pixels, W, H);

  if (!det.candidates.length) {
    if (debugPanel.visible) debugPanel.update(pixels, det.mask, det.labels, 0, 0, 0);
    setHud(
      state.table ? 'Lost the table, hold on…' : 'Looking for the white table…',
      `brightness threshold ${det.threshold.toFixed(0)}   ·   ` + featureLine()
    );
    return;
  }

  // Ray through the biggest candidate, used for the height measurement.
  const lead = det.candidates[0];
  const ray = rayFromView(view, (lead.cx + 0.5) / W, (lead.cy + 0.5) / H);

  // 1) Refresh the hit-test ray now and then (results arrive in later frames).
  if (state.features['hit-test'] && time - state.lastRayRequest > CONFIG.hitTestIntervalMs) {
    state.lastRayRequest = time;
    requestRayHitTest(frame.session, refSpace, ray);
  }

  // 2) Table height.
  let tableY = null;
  let source = '';
  if (state.rayHitSource) {
    const results = frame.getHitTestResults(state.rayHitSource);
    if (results.length) {
      const y = results[0].getPose(refSpace)?.transform.position.y;
      if (y !== undefined && y > floorY() + CONFIG.minTableHeight) { tableY = y; source = 'hit-test'; }
      else if (y !== undefined) once('hit-too-low', 'info', 'Hit-test landed below table height (floor?)', { y: +y.toFixed(2) });
    }
  }
  if (tableY === null && state.features['plane-detection']) {
    const y = heightFromPlanes(frame, refSpace, ray);
    if (y !== null) { tableY = y; source = 'plane'; }
  }
  if (tableY !== null) {
    once('height-' + source, 'info', `Table height from ${source}`, { y: +tableY.toFixed(3) });
    state.measuredY = state.measuredY === null ? tableY : THREE.MathUtils.lerp(state.measuredY, tableY, 0.3);
    state.heightSource = source;
  } else if (state.measuredY === null) {
    state.heightSource = 'assumed height';
    once('height-assumed', 'warn', `No measured table height yet, assuming ${CONFIG.tableHeight} m above the floor`);
  }
  const y = state.measuredY ?? floorY() + CONFIG.tableHeight;

  // 3) Fit a rounded rectangle in metres; try the best candidates in order.
  let fit = null, chosen = null, reject = '';
  for (const c of det.candidates) {
    const f = fitTableOnPlane(view.projectionMatrix, view.transform.matrix, det.labels, c.label, W, H, y);
    if (!f) { reject = 'blob not below eye level'; continue; }
    if (f.fill < CONFIG.minMetricFill) { reject = `not rectangular (fill ${f.fill.toFixed(2)})`; continue; }
    if (f.width < CONFIG.minTableWidth) { reject = `too narrow (${f.width.toFixed(2)} m)`; continue; }
    if (f.length > CONFIG.maxTableLength) { reject = `too long (${f.length.toFixed(2)} m)`; continue; }
    fit = f;
    chosen = c;
    break;
  }

  if (debugPanel.visible) {
    const c = chosen || lead;
    debugPanel.update(pixels, det.mask, det.labels, c.label, c.cx, c.cy);
  }

  if (!fit) {
    once('reject-' + reject.split(' (')[0], 'info', 'White area rejected', reject);
    setHud('White area found, but not the table', reject + '   ·   ' + featureLine());
    return;
  }
  once('first-fit', 'info', 'Table fitted', {
    size: `${fit.length.toFixed(2)} x ${fit.width.toFixed(2)} m`,
    corner: +fit.radius.toFixed(2),
    fill: +fit.fill.toFixed(2),
    height: state.heightSource,
  });

  // 4) Smooth, and lock once stable.
  const centre = new THREE.Vector3(fit.cx, y, fit.cz);
  // When the table is cut off by the edge of the view, the cut makes the corner estimate
  // meaningless, so keep the previous radius then.
  const radius = CONFIG.cornerRadius
    ?? (chosen.touchesBorder ? (state.table?.radius ?? 0.05) : fit.radius);
  if (!state.table) {
    state.table = { pos: centre.clone(), yaw: fit.yaw, length: fit.length, width: fit.width, radius };
  }
  const t = state.table;
  const a = CONFIG.smoothing;
  const jump = t.pos.distanceTo(centre);
  t.pos.lerp(centre, a);
  t.yaw += wrapHalf(fit.yaw - t.yaw) * a;
  t.length += (fit.length - t.length) * a;
  t.width += (fit.width - t.width) * a;
  t.radius += (radius - t.radius) * a;
  state.stable = jump < CONFIG.lockTolerance ? state.stable + 1 : 0;
  if (state.stable >= CONFIG.lockFrames && !state.locked) {
    state.locked = true;
    info('Table locked', {
      centre: [t.pos.x, t.pos.y, t.pos.z].map((v) => +v.toFixed(2)),
      size: `${t.length.toFixed(2)} x ${t.width.toFixed(2)} m`,
      corner: +t.radius.toFixed(2),
    });
  }

  tableAnchor.position.copy(t.pos);
  tableAnchor.rotation.set(0, t.yaw, 0);
  updateOutline(t.length, t.width, t.radius);
  outline.visible = true;
  tableAnchor.visible = true;

  const partial = chosen.touchesBorder ? ' · partly out of view, step back' : '';
  setHud(
    state.locked ? 'Table locked' : 'Table found, hold still…',
    `${t.length.toFixed(2)} × ${t.width.toFixed(2)} m · height from ${state.heightSource}${partial}`
  );
}

function gazeStep(frame, refSpace) {
  reticle.visible = false;
  if (state.viewerHitSource) {
    const results = frame.getHitTestResults(state.viewerHitSource);
    if (results.length) {
      const p = results[0].getPose(refSpace);
      if (p) {
        reticle.matrix.fromArray(p.transform.matrix);
        reticle.visible = true;
      }
    }
  }
  const line1 = state.locked
    ? 'Cube placed · trigger to move it'
    : reticle.visible ? 'Look at the table, press trigger' : 'Look at the table…';
  setHud(line1, 'gaze mode (no camera feed)   ·   ' + featureLine());
}

function onSelect(e) {
  if (toggleLabelAt(e)) return; // pointing at an asset name: that wins over everything else
  if (state.mode === 'corners') {
    placeCorner(e?.inputSource);
    return;
  }
  if (state.mode === 'camera') {
    info('Trigger: detecting the table again');
    resetTracking();
    return;
  }
  // Gaze mode: place at the reticle, or 0.8 m ahead at the fallback height.
  const head = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  let target;
  if (reticle.visible) {
    target = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
  } else {
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    fwd.y = 0;
    fwd.normalize();
    target = head.clone().addScaledVector(fwd, 0.8);
    target.y = floorY() + CONFIG.tableHeight;
  }
  tableAnchor.position.copy(target);
  tableAnchor.rotation.set(0, Math.atan2(head.x - target.x, head.z - target.z), 0);
  outline.visible = false;
  tableAnchor.visible = true;
  state.locked = true;
  info('Cube placed (gaze mode)', { onSurface: reticle.visible });
}

function onXRFrame(time, frame) {
  state.renderedFrames++;
  state.fpsFrames++;
  if (state.renderedFrames === 1) {
    // The base layer only becomes visible in renderState from the first frame on.
    const base = frame.session.renderState.baseLayer;
    info('First XR frame', base
      ? {
        layer: 'classic XRWebGLLayer',
        framebuffer: `${base.framebufferWidth}x${base.framebufferHeight}`,
        antialias: base.antialias,
        fixedFoveation: base.fixedFoveation,
      }
      : { layer: 'WebXR Layers (projection layer)' });
  }

  if (time - state.lastHeartbeat > CONFIG.heartbeatMs) {
    if (state.lastHeartbeat) {
      const fps = Math.round((state.fpsFrames * 1000) / (time - state.lastHeartbeat));
      info('Running', { fps, mode: state.mode, locked: state.locked });
    }
    state.lastHeartbeat = time;
    state.fpsFrames = 0;
  }

  const refSpace = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(refSpace);
  if (!pose) {
    once('no-pose', 'warn', 'No viewer pose (tracking lost?)');
    setHud('Tracking lost — look around slowly', featureLine());
    return;
  }
  if (state.mode === 'corners') cornersStep(frame, refSpace);
  else if (state.mode === 'camera') cameraStep(time, frame, pose, refSpace);
  else gazeStep(frame, refSpace);
  labelsStep(frame, refSpace);
}

// ---------------------------------------------------------------------------
// Start / end AR
// ---------------------------------------------------------------------------

// three.js r170 uses the WebXR Layers path (projection layer + 4x multisampled target)
// whenever the browser supports layers, which the Magic Leap 2 browser does. That path
// is the most likely cause of the browser crash. By default we hide layer support from
// three.js during setup, so it uses the classic XRWebGLLayer instead.
async function attachRenderer(session, useLayers) {
  const hasLayers = session.renderState.layers !== undefined;
  const classic = !useLayers || !hasLayers;
  info('Attaching three.js renderer…', {
    path: classic ? 'classic XRWebGLLayer' : 'WebXR Layers (projection layer)',
    browserSupportsLayers: hasLayers,
    antialias: params.get('aa') !== '0',
  });
  if (!classic) {
    await renderer.xr.setSession(session);
    return;
  }
  const getter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(session), 'renderState')?.get
    ?? Object.getOwnPropertyDescriptor(XRSession.prototype, 'renderState')?.get;
  if (hasLayers && getter) {
    Object.defineProperty(session, 'renderState', {
      configurable: true,
      get() {
        const rs = getter.call(session);
        return new Proxy(rs, {
          get(target, key) {
            if (key === 'layers') return undefined;
            const v = Reflect.get(target, key, target);
            return typeof v === 'function' ? v.bind(target) : v;
          },
        });
      },
    });
  }
  try {
    await renderer.xr.setSession(session);
  } finally {
    delete session.renderState; // back to the browser's own property
  }
}

// Bare WebXR, no three.js: clears the view and draws a small cyan square in each eye.
// If this also crashes the browser, the problem is the headset/browser, not our code.
async function rawXRTest() {
  startBtn.disabled = true;
  safeBtn.disabled = true;
  rawBtn.disabled = true;
  info('RAW TEST: plain WebXR without three.js, no extra features');
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('webgl2', { xrCompatible: true, alpha: true, antialias: false });
  const done = () => { startBtn.disabled = false; safeBtn.disabled = false; rawBtn.disabled = false; };
  if (!g) { error('RAW TEST: no WebGL2 context'); done(); return; }

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar');
  } catch (err) {
    error('RAW TEST: requestSession failed', errText(err));
    done();
    return;
  }
  info('RAW TEST: session started', { blend: session.environmentBlendMode });
  let frames = 0;
  session.addEventListener('end', () => {
    info('RAW TEST: session ended', { frames });
    setPageStatus(`Raw test ended after ${frames} frames.`);
    done();
  });
  try {
    const layer = new XRWebGLLayer(session, g, { antialias: false, alpha: true });
    session.updateRenderState({ baseLayer: layer });
    info('RAW TEST: XRWebGLLayer', { size: `${layer.framebufferWidth}x${layer.framebufferHeight}` });
    const ref = await session.requestReferenceSpace('local');
    info('RAW TEST: reference space ready, starting frames');
    const t0 = performance.now();
    const onFrame = (time, frame) => {
      session.requestAnimationFrame(onFrame);
      frames++;
      if (frames === 1) info('RAW TEST: first frame');
      if (frames % 300 === 0) info('RAW TEST: still running', { frames });
      const pose = frame.getViewerPose(ref);
      g.bindFramebuffer(g.FRAMEBUFFER, layer.framebuffer);
      g.disable(g.SCISSOR_TEST);
      g.clearColor(0, 0, 0, 0);
      g.clear(g.COLOR_BUFFER_BIT | g.DEPTH_BUFFER_BIT);
      if (pose) {
        g.enable(g.SCISSOR_TEST);
        g.clearColor(0.2, 0.8, 1.0, 1.0);
        for (const view of pose.views) {
          const vp = layer.getViewport(view);
          const s = Math.round(Math.min(vp.width, vp.height) * 0.12);
          g.scissor(vp.x + Math.round(vp.width / 2 - s / 2), vp.y + Math.round(vp.height / 2 - s / 2), s, s);
          g.clear(g.COLOR_BUFFER_BIT);
        }
        g.disable(g.SCISSOR_TEST);
      }
      if (time && performance.now() - t0 > 15000) {
        info('RAW TEST: 15 s without a crash, ending the session');
        session.end().catch(() => {});
      }
    };
    session.requestAnimationFrame(onFrame);
  } catch (err) {
    error('RAW TEST: setup failed', errText(err));
    session.end().catch(() => {});
  }
}
async function startAR(requested) {
  startBtn.disabled = true;
  safeBtn.disabled = true;
  rawBtn.disabled = true;
  onceKeys.clear();
  const setup = chosenSetup();
  if (setup === 'corners' && requested.includes('camera-access')) {
    // Corner calibration doesn't use the camera, so don't ask for the permission.
    requested = requested.filter((f) => f !== 'camera-access');
    info('Corner calibration: not requesting camera-access');
  }
  setPageStatus('Starting AR…');
  info('Requesting immersive-ar session', { optionalFeatures: requested });

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures: requested });
  } catch (err) {
    error('requestSession failed', errText(err));
    setPageStatus('Could not start AR: ' + err.message);
    startBtn.disabled = false;
    safeBtn.disabled = false;
    rawBtn.disabled = false;
    return;
  }

  state.session = session;
  state.startedAt = performance.now();
  state.renderedFrames = 0;
  // Listen for the end straight away, so an early end is logged too.
  session.addEventListener('end', onSessionEnd);
  session.addEventListener('visibilitychange', () => info('Session visibility', session.visibilityState));
  session.addEventListener('inputsourceschange', (e) => {
    for (const s of e.added) {
      info('Input added', { hand: s.handedness, mode: s.targetRayMode, profiles: s.profiles });
      trackInputSource(s);
    }
    for (const s of e.removed) untrackInputSource(s);
  });

  // Older browsers don't report enabledFeatures; then we just try what was requested.
  const enabled = session.enabledFeatures ? new Set(session.enabledFeatures) : null;
  const has = (name) => requested.includes(name) && (enabled ? enabled.has(name) : true);
  state.features = {
    'local-floor': has('local-floor'),
    'camera-access': has('camera-access') && typeof XRWebGLBinding !== 'undefined'
      && 'getCameraImage' in XRWebGLBinding.prototype,
    'hit-test': has('hit-test') && typeof session.requestHitTestSource === 'function',
    'plane-detection': has('plane-detection'),
  };
  info('Session started', {
    enabledFeatures: session.enabledFeatures ? [...session.enabledFeatures] : 'not reported',
    blend: session.environmentBlendMode,
    visibility: session.visibilityState,
  });

  state.usingFloor = state.features['local-floor'];
  renderer.xr.setReferenceSpaceType(state.usingFloor ? 'local-floor' : 'local');
  const useLayers = document.getElementById('use-layers')?.checked === true;
  try {
    await attachRenderer(session, useLayers);
    info('Renderer attached', { referenceSpace: state.usingFloor ? 'local-floor' : 'local' });
  } catch (err) {
    warn('setSession failed, retrying with "local"', errText(err));
    state.usingFloor = false;
    state.features['local-floor'] = false;
    renderer.xr.setReferenceSpaceType('local');
    try {
      await attachRenderer(session, useLayers);
      info('Renderer attached', { referenceSpace: 'local' });
    } catch (err2) {
      error('setSession failed again, ending session', errText(err2));
      session.end().catch(() => {});
      return;
    }
  }

  resetTracking();
  Object.assign(state, {
    frameCount: 0, cameraWaitStart: 0, cameraErrors: 0, frameErrors: 0,
    lastHeartbeat: 0, fpsFrames: 0, lastRayRequest: 0,
    glBinding: null, reader: null, rayHitSource: null, viewerHitSource: null,
  });
  for (const s of session.inputSources) trackInputSource(s);
  if (setup === 'corners') {
    state.mode = 'corners';
    startCalibration('session start');
  } else {
    state.mode = 'camera';
    outline.visible = true;
    if (!state.features['camera-access']) switchToGaze('camera feed not requested or not granted');
    else info('Camera mode: the camera binding is created once the first camera image arrives');
  }

  session.addEventListener('select', onSelect);
  session.addEventListener('squeeze', onSqueeze);

  renderer.setAnimationLoop((time, frame) => {
    if (frame) {
      try {
        onXRFrame(time, frame);
      } catch (err) {
        state.frameErrors++;
        once('frame-err-' + (err && err.message), 'error', 'Error in frame', errText(err));
        if (state.frameErrors > 20 && state.mode === 'camera') switchToGaze('too many frame errors');
      }
      drawHeadsetLog(time);
      try { animateDiorama(time); } catch (err) { once('anim-err', 'error', 'Flow animation failed', errText(err)); }
    }
    // Milestones around the first renders: if the browser dies inside three.js's first
    // draw into the headset, the last laptop log line says "render #1 starting".
    const n = state.renderedFrames;
    const milestone = frame && (n <= 3 || n === 10 || n === 60 || n === 300);
    if (milestone) info(`XR render #${n} starting`);
    try {
      renderer.render(scene, camera);
    } catch (err) {
      once('render-err-' + (err && err.message), 'error', 'Render failed', errText(err));
    }
    if (milestone) {
      const glErr = gl.getError();
      info(`XR render #${n} done`, glErr ? { glError: '0x' + glErr.toString(16) } : undefined);
    }
  });

  setPageStatus('AR running. Press the menu button to exit.');
}

function onSessionEnd() {
  const seconds = (performance.now() - state.startedAt) / 1000;
  info('Session ended', { afterSeconds: +seconds.toFixed(1), frames: state.renderedFrames, mode: state.mode });
  if (seconds < 3 || state.renderedFrames < 10) {
    warn('The session ended almost immediately. Usually a permission prompt or a feature the headset ' +
      'could not start. Try "Safe start", then switch features on one at a time.');
  }
  renderer.setAnimationLoop(null);
  try { state.rayHitSource?.cancel(); } catch { /* already gone */ }
  try { state.viewerHitSource?.cancel(); } catch { /* already gone */ }
  showFeatures([
    ['Camera feed (camera-access)', state.features['camera-access']],
    ['Hit-test', state.features['hit-test']],
    ['Plane detection', state.features['plane-detection']],
    ['Floor reference (local-floor)', state.features['local-floor']],
  ]);
  Object.assign(state, {
    session: null, glBinding: null, reader: null,
    rayHitSource: null, viewerHitSource: null, rayHitPending: false,
  });
  for (const s of [...calib.sources.keys()]) untrackInputSource(s);
  calibGroup.visible = false;
  labelPointer.set([]);
  assetLabels?.setHover(null);
  resetTracking();
  reticle.visible = false;
  startBtn.disabled = false;
  safeBtn.disabled = false;
  rawBtn.disabled = false;
  startBtn.textContent = 'Start AR again';
  setPageStatus('Session ended. See the log for what happened.');
}

startBtn.addEventListener('click', () => startAR(chosenFeatures()));
safeBtn.addEventListener('click', () => startAR([]));
rawBtn.addEventListener('click', rawXRTest);
window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ?preview=1 — look at the diorama on a normal screen (no headset, no WebXR), on a
// virtual 1.6 x 0.8 m table. Handy for checking models and layout from the laptop.
function startPreview() {
  info('Preview mode: diorama on a virtual 1.6 x 0.8 m table');
  document.body.classList.add('preview');
  Object.assign(renderer.domElement.style, { display: 'block', position: 'fixed', inset: '0', zIndex: '0' });
  renderer.setClearColor(0x20252c, 1);
  tableAnchor.visible = true;
  outline.visible = true;
  updateOutline(1.6, 0.8, 0);
  const table = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.04, 0.8),
    new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.9 })
  );
  table.position.y = -0.02;
  tableAnchor.add(table);
  const angle = params.has('angle') ? parseFloat(params.get('angle')) : null; // fixed view, degrees
  const dist = parseFloat(params.get('dist') ?? '0.9');                       // camera distance, m
  const height = parseFloat(params.get('height') ?? '0.55');

  // Mouse: click an asset name to show or hide its details, click elsewhere to close.
  // Hovering a name pauses the turntable so it is easy to click.
  const canvas = renderer.domElement;
  const mouse = { ndc: new THREE.Vector2(), inside: false };
  const pickAt = (e) => {
    mouse.ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    labelRaycaster.setFromCamera(mouse.ndc, camera);
    return assetLabels?.pick(labelRaycaster) ?? null;
  };
  canvas.addEventListener('pointermove', (e) => { pickAt(e); mouse.inside = true; });
  canvas.addEventListener('pointerleave', () => { mouse.inside = false; });
  canvas.addEventListener('click', (e) => {
    const hit = pickAt(e);
    if (hit) assetLabels.toggle(hit.label);
    else assetLabels?.closeAll();
  });

  let turn = 0, lastTime = 0;
  renderer.setAnimationLoop((time) => {
    let hit = null;
    if (assetLabels && mouse.inside) {
      labelRaycaster.setFromCamera(mouse.ndc, camera);
      hit = assetLabels.pick(labelRaycaster);
    }
    assetLabels?.setHover(hit?.label ?? null);
    canvas.style.cursor = hit ? 'pointer' : '';
    if (!hit) turn += (time - (lastTime || time)) * 0.0002;
    lastTime = time;
    const a = angle !== null ? THREE.MathUtils.degToRad(angle) : turn;
    camera.position.set(Math.sin(a) * dist, height, Math.cos(a) * dist);
    camera.lookAt(0, 0.05, 0);
    animateDiorama(time);
    renderer.render(scene, camera);
  });
}

if (params.get('preview') === '1') startPreview();
else checkSupport();