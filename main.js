// Table Cube — WebXR AR demo for Magic Leap 2 (works on other WebXR AR devices too).
//
// How it works:
//   1. Every few frames we grab the headset's RGB camera image (WebXR Raw Camera Access).
//   2. We shrink it to 160x120, mark bright + low-saturation pixels as "white",
//      and keep the biggest, most rectangle-like white blob: the table.
//   3. We shoot a ray from the camera through the blob's centre and find where it
//      meets the table surface. Table height comes from (in order of preference):
//      WebXR hit-test along that ray → detected horizontal planes → a fixed guess.
//   4. The cube follows the detection (smoothed) and locks once it is stable.
//
// If the camera feed is not available, it falls back to "gaze mode":
// look at the table and press the trigger to place the cube.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);

const CONFIG = {
  cubeSize: 0.10,            // metres
  analysisWidth: 160,        // camera image is downscaled to this for detection
  analysisHeight: 120,
  analyseEveryNFrames: 6,    // roughly 10 detections per second at 60 fps
  minWhiteLuma: 110,         // nothing darker than this (0–255) counts as white
  maxSaturation: 45,         // white = low colour: max(r,g,b) - min(r,g,b)
  minAreaFraction: 0.02,     // blob must cover at least 2% of the camera image
  minFillRatio: 0.55,        // how rectangle-like the blob must be (1 = perfect)
  smoothing: 0.25,           // 0..1, higher follows new detections faster
  lockTolerance: 0.02,       // metres; detections this close count as stable
  lockFrames: 8,             // stable detections in a row before the cube locks
  tableHeight: parseFloat(params.get('table') ?? '0.75'), // fallback, metres above floor
  minTableHeight: 0.3,       // ignore surfaces lower than this (the floor)
  hitTestIntervalMs: 400,    // how often to refresh the camera-ray hit-test
  cameraTimeoutMs: 4000,     // switch to gaze mode if no camera image by then
  flipCameraY: params.get('flipy') === '1',
  debug: params.get('debug') === '1',
};

// ---------------------------------------------------------------------------
// Page UI
// ---------------------------------------------------------------------------
const startBtn = document.getElementById('start');
const statusEl = document.getElementById('status');
const featuresEl = document.getElementById('features');

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
  if (!window.isSecureContext) {
    startBtn.textContent = 'Needs HTTPS or localhost';
    setPageStatus('WebXR only runs on https:// or http://localhost. Use GitHub Pages or adb reverse.');
    return;
  }
  if (!('xr' in navigator)) {
    startBtn.textContent = 'WebXR not available';
    setPageStatus('This browser has no WebXR. Open the page in the Magic Leap 2 browser.');
    return;
  }
  let supported = false;
  try {
    supported = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (err) {
    console.warn(err);
  }
  if (!supported) {
    startBtn.textContent = 'AR not supported here';
    setPageStatus('This device or browser cannot start an immersive AR session.');
    return;
  }
  startBtn.disabled = false;
  startBtn.textContent = 'Start AR';
  setPageStatus('Ready. Stand so the table is in front of you.');
}

// ---------------------------------------------------------------------------
// three.js scene
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 50);
scene.add(camera); // so we can attach head-locked HUD panels to it

scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);

// The cube sits on a group whose origin is the point on the table surface.
// Note: Magic Leap 2 is an additive display, so dark colours look transparent.
// Keep everything bright.
const cubeAnchor = new THREE.Group();
cubeAnchor.visible = false;
scene.add(cubeAnchor);

const cubeGeo = new THREE.BoxGeometry(CONFIG.cubeSize, CONFIG.cubeSize, CONFIG.cubeSize);
const cube = new THREE.Mesh(
  cubeGeo,
  new THREE.MeshStandardMaterial({ color: 0x33ccff, roughness: 0.4 })
);
cube.position.y = CONFIG.cubeSize / 2;
cube.add(new THREE.LineSegments(
  new THREE.EdgesGeometry(cubeGeo),
  new THREE.LineBasicMaterial({ color: 0xffffff })
));
cubeAnchor.add(cube);

const surfaceRing = new THREE.Mesh(
  new THREE.RingGeometry(0.075, 0.09, 48).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
);
cubeAnchor.add(surfaceRing);

// Reticle for gaze (fallback) mode.
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.04, 0.055, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffd60a })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// ---------------------------------------------------------------------------
// Head-locked HUD (DOM isn't visible inside the headset, so we draw text in 3D)
// ---------------------------------------------------------------------------
function makeHud() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.0977),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false })
  );
  mesh.renderOrder = 999;
  mesh.position.set(0, -0.22, -1.0); // 1 m ahead, a bit below eye level
  camera.add(mesh);

  let lastText = '';
  return {
    set(line1, line2 = '') {
      const text = line1 + '\n' + line2;
      if (text === lastText) return;
      lastText = text;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font = '600 46px system-ui, sans-serif';
      ctx.fillText(line1, canvas.width / 2, 62);
      ctx.fillStyle = 'rgba(170,230,255,0.95)';
      ctx.font = '400 34px system-ui, sans-serif';
      ctx.fillText(line2, canvas.width / 2, 142);
      texture.needsUpdate = true;
    },
  };
}
const hud = makeHud();

// Debug panel: shows what the detector sees.
//   dimmed camera image, yellow = white pixels, cyan = chosen table blob, magenta = centre
function makeDebugPanel(w, h) {
  const data = new Uint8Array(w * h * 4);
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.32, 0.24),
    new THREE.MeshBasicMaterial({ map: texture, depthTest: false })
  );
  mesh.renderOrder = 998;
  mesh.position.set(0.28, 0.02, -1.0);
  mesh.visible = CONFIG.debug;
  camera.add(mesh);

  return {
    get visible() { return mesh.visible; },
    toggle() { mesh.visible = !mesh.visible; },
    update(pixels, mask, labels, best) {
      const n = w * h;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        if (best && labels[i] === best.label) {
          data[j] = 0; data[j + 1] = 230; data[j + 2] = 255;
        } else if (mask[i]) {
          data[j] = 255; data[j + 1] = 214; data[j + 2] = 10;
        } else {
          data[j] = pixels[j] * 0.6; data[j + 1] = pixels[j + 1] * 0.6; data[j + 2] = pixels[j + 2] * 0.6;
        }
        data[j + 3] = 255;
      }
      if (best) {
        const cx = Math.round(best.cx), cy = Math.round(best.cy);
        for (let d = -4; d <= 4; d++) {
          for (const [x, y] of [[cx + d, cy], [cx, cy + d]]) {
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
// Camera image → small RGBA buffer (raw WebGL, then three.js state is restored)
// ---------------------------------------------------------------------------
class CameraReader {
  constructor(gl, width, height) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);

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
    this.uTex = gl.getUniformLocation(this.program, 'uTex');
    this.uFlipY = gl.getUniformLocation(this.program, 'uFlipY');
    this.uStep = gl.getUniformLocation(this.program, 'uStep');
    const aPos = gl.getAttribLocation(this.program, 'aPos');

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.target = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  #link(vsSource, fsSource) {
    const gl = this.gl;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }

  // cameraTexture: from XRWebGLBinding.getCameraImage(). Only valid during this XR frame.
  read(cameraTexture) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    gl.uniform1i(this.uTex, 0);
    gl.uniform1i(this.uFlipY, CONFIG.flipCameraY ? 1 : 0);
    // sample a quarter of the way towards the neighbouring output pixel
    gl.uniform2f(this.uStep, 0.25 / this.width, 0.25 / this.height);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    gl.bindVertexArray(null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.pixels; // row 0 = bottom of the image
  }
}

// ---------------------------------------------------------------------------
// White-rectangle detection on the small image
// ---------------------------------------------------------------------------
const W = CONFIG.analysisWidth;
const H = CONFIG.analysisHeight;
const scratch = {
  luma: new Uint8Array(W * H),
  mask: new Uint8Array(W * H),
  labels: new Int32Array(W * H),
  stack: new Int32Array(W * H),
  hist: new Uint32Array(256),
};

function detectWhiteRectangle(px, w, h) {
  const n = w * h;
  const { luma, mask, labels, stack, hist } = scratch;
  hist.fill(0);
  labels.fill(0);

  // Brightness per pixel + histogram, so the threshold adapts to camera exposure.
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const l = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
    luma[i] = l;
    hist[l]++;
  }
  let acc = 0, p90 = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= n * 0.9) { p90 = v; break; }
  }
  const threshold = Math.max(CONFIG.minWhiteLuma, p90 * 0.8);

  // White = bright enough and not colourful.
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = px[j], g = px[j + 1], b = px[j + 2];
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    mask[i] = luma[i] >= threshold && sat <= CONFIG.maxSaturation ? 1 : 0;
  }

  // Connected blobs (4-neighbour flood fill), keep the best rectangle-like one.
  let best = null;
  let label = 0;
  const minCount = CONFIG.minAreaFraction * n;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start]) continue;
    label++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    let count = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      count++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = label; stack[sp++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = label; stack[sp++] = i + 1; }
      if (y > 0 && mask[i - w] && !labels[i - w]) { labels[i - w] = label; stack[sp++] = i - w; }
      if (y < h - 1 && mask[i + w] && !labels[i + w]) { labels[i + w] = label; stack[sp++] = i + w; }
    }
    if (count < minCount) continue;

    // Shape from second moments: a filled rectangle has area = 12 * sqrt(l1 * l2).
    const cx = sx / count, cy = sy / count;
    const cxx = sxx / count - cx * cx;
    const cyy = syy / count - cy * cy;
    const cxy = sxy / count - cx * cy;
    const tr = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(tr / 2 - disc, 1e-6);
    const fill = count / (12 * Math.sqrt(l1 * l2));
    if (fill < CONFIG.minFillRatio) continue;

    const score = count * Math.min(fill, 1);
    if (!best || score > best.score) {
      best = {
        label, count, cx, cy, fill, score,
        angle: 0.5 * Math.atan2(2 * cxy, cxx - cyy), // long axis, image coords (y up)
        areaFraction: count / n,
      };
    }
  }
  return { best, threshold, mask, labels };
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

function intersectHeight(ray, y) {
  if (Math.abs(ray.dir.y) < 1e-4) return null;
  const t = (y - ray.origin.y) / ray.dir.y;
  if (t <= 0 || t > 10) return null;
  return ray.origin.clone().addScaledVector(ray.dir, t);
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
  if (!planes || planes.size === 0) return null;
  let best = null;
  for (const plane of planes) {
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

// Cubes look the same every 90°, so keep yaw differences within ±45°.
function wrapQuarter(a) {
  const q = Math.PI / 2;
  return a - q * Math.round(a / q);
}

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------
const state = {
  session: null,
  mode: 'camera',          // 'camera' or 'gaze'
  usingFloor: true,
  features: {},
  glBinding: null,
  reader: null,
  frameCount: 0,
  cameraWaitStart: 0,
  // camera-ray hit-test
  rayHitSource: null,
  rayHitPending: false,
  lastRayRequest: 0,
  // gaze fallback hit-test
  viewerHitSource: null,
  // tracking
  pos: null,
  yaw: 0,
  stable: 0,
  locked: false,
  measuredY: null,
  heightSource: '',
  lastSeen: 0,
};

function floorY() {
  // local-floor: floor is y = 0. local: origin is the head at start, floor ~1.6 m below.
  return state.usingFloor ? 0 : -1.6;
}

function resetTracking() {
  state.pos = null;
  state.stable = 0;
  state.locked = false;
  state.measuredY = null;
  state.heightSource = '';
  cubeAnchor.visible = false;
}

function featureLine() {
  const f = state.features;
  const mark = (ok) => (ok ? '✓' : '✗');
  return `camera ${mark(f['camera-access'])}   hit-test ${mark(f['hit-test'])}   planes ${mark(f['plane-detection'])}   floor ${mark(f['local-floor'])}`;
}

async function requestRayHitTest(session, refSpace, ray) {
  if (state.rayHitPending || !state.features['hit-test']) return;
  state.rayHitPending = true;
  try {
    const source = await session.requestHitTestSource({
      space: refSpace,
      offsetRay: new XRRay(
        { x: ray.origin.x, y: ray.origin.y, z: ray.origin.z, w: 1 },
        { x: ray.dir.x, y: ray.dir.y, z: ray.dir.z, w: 0 }
      ),
    });
    if (state.rayHitSource) state.rayHitSource.cancel();
    state.rayHitSource = source;
  } catch (err) {
    console.warn('Camera-ray hit-test not available:', err);
    state.features['hit-test'] = false;
  } finally {
    state.rayHitPending = false;
  }
}

function switchToGaze(reason) {
  console.warn('Switching to gaze mode:', reason);
  state.mode = 'gaze';
  resetTracking();
  if (state.features['hit-test'] && !state.viewerHitSource) {
    state.session.requestReferenceSpace('viewer')
      .then((viewerSpace) => state.session.requestHitTestSource({ space: viewerSpace }))
      .then((source) => { state.viewerHitSource = source; })
      .catch((err) => console.warn('Gaze hit-test failed:', err));
  }
}

// ---------------------------------------------------------------------------
// Per-frame logic
// ---------------------------------------------------------------------------
function cameraStep(time, frame, pose, refSpace) {
  if (state.locked) {
    hud.set('Cube locked on the table', 'Trigger = detect again   ·   ' + featureLine());
    return;
  }

  state.frameCount++;
  if (state.frameCount % CONFIG.analyseEveryNFrames !== 0) return;

  const view = pose.views.find((v) => v.camera);
  if (!view) {
    if (!state.cameraWaitStart) state.cameraWaitStart = time;
    if (time - state.cameraWaitStart > CONFIG.cameraTimeoutMs) switchToGaze('no camera image');
    hud.set('Waiting for the camera image…', featureLine());
    return;
  }

  let cameraTexture = null;
  try {
    cameraTexture = state.glBinding.getCameraImage(view.camera);
  } catch (err) {
    console.warn(err);
  }
  if (!cameraTexture) return;
  state.cameraWaitStart = 0;

  // Our own GL work, then hand the GL state back to three.js exactly as it was.
  const xrTarget = renderer.getRenderTarget();
  const pixels = state.reader.read(cameraTexture);
  renderer.resetState();
  renderer.setRenderTarget(xrTarget);

  const det = detectWhiteRectangle(pixels, W, H);
  if (debugPanel.visible) debugPanel.update(pixels, det.mask, det.labels, det.best);

  if (!det.best) {
    hud.set(
      state.pos ? 'Lost the table, hold on…' : 'Looking for the white table…',
      `threshold ${det.threshold.toFixed(0)}   ·   ` + featureLine()
    );
    return;
  }

  const b = det.best;
  const ray = rayFromView(view, (b.cx + 0.5) / W, (b.cy + 0.5) / H);

  // 1) Refresh the hit-test ray now and then (results arrive in later frames).
  if (state.features['hit-test'] && time - state.lastRayRequest > CONFIG.hitTestIntervalMs) {
    state.lastRayRequest = time;
    requestRayHitTest(frame.session, refSpace, ray);
  }

  // 2) Work out the table height.
  let tableY = null;
  let source = '';
  if (state.rayHitSource) {
    const results = frame.getHitTestResults(state.rayHitSource);
    if (results.length) {
      const hitPose = results[0].getPose(refSpace);
      const y = hitPose?.transform.position.y;
      if (y !== undefined && y > floorY() + CONFIG.minTableHeight) { tableY = y; source = 'hit-test'; }
    }
  }
  if (tableY === null && state.features['plane-detection']) {
    const y = heightFromPlanes(frame, refSpace, ray);
    if (y !== null) { tableY = y; source = 'plane'; }
  }
  if (tableY !== null) {
    state.measuredY = state.measuredY === null ? tableY : THREE.MathUtils.lerp(state.measuredY, tableY, 0.3);
    state.heightSource = source;
  } else if (state.measuredY === null) {
    state.heightSource = 'assumed height';
  }
  const y = state.measuredY ?? floorY() + CONFIG.tableHeight;

  // 3) Where the centre ray meets the table, and which way the table's long side runs.
  const point = intersectHeight(ray, y);
  if (!point) return;

  let yaw = state.yaw;
  const k = 12; // pixels along the long axis
  const ax = Math.cos(b.angle) * k, ay = Math.sin(b.angle) * k;
  const pA = intersectHeight(rayFromView(view, (b.cx - ax + 0.5) / W, (b.cy - ay + 0.5) / H), y);
  const pB = intersectHeight(rayFromView(view, (b.cx + ax + 0.5) / W, (b.cy + ay + 0.5) / H), y);
  if (pA && pB) yaw = Math.atan2(-(pB.z - pA.z), pB.x - pA.x);

  // 4) Smooth, and lock once stable.
  if (!state.pos) {
    state.pos = point.clone();
    state.yaw = wrapQuarter(yaw);
  }
  const jump = state.pos.distanceTo(point);
  state.pos.lerp(point, CONFIG.smoothing);
  state.yaw += wrapQuarter(yaw - state.yaw) * CONFIG.smoothing;
  state.stable = jump < CONFIG.lockTolerance ? state.stable + 1 : 0;
  if (state.stable >= CONFIG.lockFrames) state.locked = true;

  cubeAnchor.position.copy(state.pos);
  cubeAnchor.rotation.set(0, state.yaw, 0);
  cubeAnchor.visible = true;

  hud.set(
    state.locked ? 'Cube locked on the table' : 'Table found, hold still…',
    `${Math.round(b.areaFraction * 100)}% of view · height from ${state.heightSource}   ·   ` + featureLine()
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
  hud.set(line1, 'gaze mode (no camera feed)   ·   ' + featureLine());
}

function onSelect() {
  if (state.mode === 'camera') {
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
  cubeAnchor.position.copy(target);
  cubeAnchor.rotation.set(0, Math.atan2(head.x - target.x, head.z - target.z), 0);
  cubeAnchor.visible = true;
  state.locked = true;
}

// ---------------------------------------------------------------------------
// Start / end AR
// ---------------------------------------------------------------------------
async function startAR() {
  startBtn.disabled = true;
  setPageStatus('Starting AR…');

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      optionalFeatures: ['local-floor', 'camera-access', 'hit-test', 'plane-detection', 'hand-tracking'],
    });
  } catch (err) {
    console.error(err);
    setPageStatus('Could not start AR: ' + err.message);
    startBtn.disabled = false;
    return;
  }

  // Older browsers don't report enabledFeatures; then we just try everything.
  const enabled = session.enabledFeatures ? new Set(session.enabledFeatures) : null;
  const has = (name) => (enabled ? enabled.has(name) : true);
  state.features = {
    'local-floor': has('local-floor'),
    'camera-access': has('camera-access') && typeof XRWebGLBinding !== 'undefined'
      && 'getCameraImage' in XRWebGLBinding.prototype,
    'hit-test': has('hit-test') && typeof session.requestHitTestSource === 'function',
    'plane-detection': has('plane-detection'),
  };

  state.session = session;
  state.usingFloor = state.features['local-floor'];
  renderer.xr.setReferenceSpaceType(state.usingFloor ? 'local-floor' : 'local');

  try {
    await renderer.xr.setSession(session);
  } catch (err) {
    // local-floor was reported but failed: retry with plain local.
    console.warn(err);
    state.usingFloor = false;
    state.features['local-floor'] = false;
    renderer.xr.setReferenceSpaceType('local');
    await renderer.xr.setSession(session);
  }

  resetTracking();
  state.frameCount = 0;
  state.cameraWaitStart = 0;

  if (state.features['camera-access']) {
    try {
      const gl = renderer.getContext();
      state.glBinding = new XRWebGLBinding(session, gl);
      state.reader = new CameraReader(gl, W, H);
      renderer.resetState();
      state.mode = 'camera';
    } catch (err) {
      console.warn(err);
      switchToGaze('camera setup failed');
    }
  } else {
    switchToGaze('camera-access not granted');
  }

  session.addEventListener('select', onSelect);
  session.addEventListener('squeeze', () => debugPanel.toggle());
  session.addEventListener('end', onSessionEnd);

  renderer.setAnimationLoop((time, frame) => {
    if (frame) {
      const refSpace = renderer.xr.getReferenceSpace();
      const pose = frame.getViewerPose(refSpace);
      if (!pose) {
        hud.set('Tracking lost — look around slowly', featureLine());
      } else if (state.mode === 'camera') {
        cameraStep(time, frame, pose, refSpace);
      } else {
        gazeStep(frame, refSpace);
      }
    }
    renderer.render(scene, camera);
  });

  setPageStatus('AR running. Press the menu button to exit.');
}

function onSessionEnd() {
  renderer.setAnimationLoop(null);
  state.rayHitSource?.cancel();
  state.viewerHitSource?.cancel();
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
  resetTracking();
  reticle.visible = false;
  startBtn.disabled = false;
  startBtn.textContent = 'Start AR again';
  setPageStatus('Session ended. Below: which features the headset granted.');
}

startBtn.addEventListener('click', startAR);
window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

checkSupport();

// Exposed for quick tests in the browser console.
export { detectWhiteRectangle };
