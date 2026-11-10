// Diorama loader: builds a scene from assets/scenes/<name>.json using the models listed in
// assets/library.json, and draws the energy flows between them.
//
// Everything is in real metres. main.js scales the whole group down to fit the table.
// Loaded with a dynamic import from main.js, so if anything here fails (CDN, a model),
// the AR app keeps running and shows a placeholder instead.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE_HEIGHT = 0.2; // lawn thickness; models stand on top of it

// Flow colours by kind. Bright: the additive display shows dark colours as see-through.
export const FLOW_KINDS = {
  solar: { color: 0xffd60a, text: 'solar' },
  ev: { color: 0x7cff6b, text: 'EV charging' },
  share: { color: 0xff5ad1, text: 'shared' },
  import: { color: 0xff6b6b, text: 'grid import' },
  export: { color: 0x5ac8ff, text: 'grid export' },
  battery: { color: 0xb38cff, text: 'battery' },
};

function stdMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 });
}

function buildGround(ground) {
  const g = new THREE.Group();
  g.name = 'ground';
  const lawn = new THREE.Mesh(new THREE.BoxGeometry(ground.length, BASE_HEIGHT, ground.width), stdMat(0x7be36f));
  lawn.position.y = BASE_HEIGHT / 2;
  g.add(lawn);
  const stripMat = stdMat(0xe6e2d6);
  for (const s of ground.strips || []) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s.length, 0.03, s.width), stripMat);
    m.position.set(s.x ?? 0, BASE_HEIGHT + 0.015, s.z ?? 0);
    m.name = s.name || 'strip';
    g.add(m);
  }
  return g;
}

// Rescale a model of unknown units to real metres ('fit'), centre it and stand it on y = 0.
function prepareModel(object, fit) {
  if (fit) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const current = fit.height ? size.y : Math.max(size.x, size.z);
    const target = fit.height ?? fit.length;
    if (current > 0 && target > 0) object.scale.multiplyScalar(target / current);
    box.setFromObject(object);
    const c = box.getCenter(new THREE.Vector3());
    object.position.x -= c.x;
    object.position.z -= c.z;
    object.position.y -= box.min.y;
  }
  const wrapper = new THREE.Group();
  wrapper.add(object);
  return wrapper;
}

function placeholderBox(size = [2, 2, 2]) {
  const [l, h, w] = size;
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(l, h, w),
    new THREE.MeshStandardMaterial({ color: 0xff5ad1, transparent: true, opacity: 0.6 })
  );
  m.position.y = h / 2;
  m.name = 'placeholder';
  return m;
}

// Text label as a sprite (always faces the viewer).
function makeLabel(line1, line2, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(10,14,20,0.55)';
  ctx.beginPath();
  ctx.roundRect(4, 4, 248, 104, 18);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.font = '700 46px system-ui, sans-serif';
  ctx.fillText(line1, 128, 42);
  ctx.fillStyle = '#ffffff';
  ctx.font = '500 26px system-ui, sans-serif';
  ctx.fillText(line2, 128, 84);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(2.8, 2.8 * (112 / 256), 1);
  return sprite;
}

// One energy flow: an arc from A to B with particles moving along it.
// Particle size and speed grow with the power, so bigger flows read as "more".
function buildFlow(def, endpoint, log) {
  const a = endpoint(def.from);
  const b = endpoint(def.to);
  if (!a || !b) {
    log.warn('Flow skipped: unknown end point', `${def.from} → ${def.to}`);
    return null;
  }
  const kind = FLOW_KINDS[def.kind] || { color: 0xffffff, text: def.kind || 'flow' };
  const kw = Math.max(0, Number(def.kw) || 0);
  const dist = a.distanceTo(b);
  const mid = a.clone().lerp(b, 0.5);
  mid.y = Math.max(a.y, b.y) + 1.2 + 0.3 * dist;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const length = curve.getLength();

  const g = new THREE.Group();
  g.name = `flow ${def.from} → ${def.to}`;

  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 48, 0.05, 6, false),
    new THREE.MeshBasicMaterial({ color: kind.color, transparent: true, opacity: 0.45, depthWrite: false })
  );
  g.add(tube);

  const radius = 0.12 + 0.045 * Math.sqrt(kw);               // 1 kW ≈ 0.17 m, 14 kW ≈ 0.29 m
  const speed = Math.min(9, 1.5 + 0.5 * kw);                 // metres per second (real scale)
  const count = Math.max(3, Math.round(length / 1.6));
  const dots = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 8),
    new THREE.MeshBasicMaterial({ color: kind.color }),
    kw > 0 ? count : 0
  );
  dots.frustumCulled = false;
  g.add(dots);

  const label = makeLabel(`${kw.toFixed(1)} kW`, def.label || kind.text, kind.color);
  label.position.copy(curve.getPoint(0.5)).add(new THREE.Vector3(0, 1.1, 0));
  g.add(label);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(radius, radius, radius);
  const p = new THREE.Vector3();
  let phase = Math.random();
  return {
    group: g,
    def,
    update(dt) {
      if (!dots.count) return;
      phase = (phase + (dt * speed) / length) % 1;
      for (let i = 0; i < dots.count; i++) {
        curve.getPointAt((i / dots.count + phase) % 1, p);
        dots.setMatrixAt(i, m.compose(p, q, s));
      }
      dots.instanceMatrix.needsUpdate = true;
    },
  };
}

// sceneSource: URL of a scene JSON, or a scene object. Returns
// { group, ground: { length, width }, items, flows, update(dt) }.
export async function buildDiorama({ sceneSource, libraryUrl, log }) {
  const sceneUrl = typeof sceneSource === 'string' ? new URL(sceneSource, location.href) : null;
  const sceneDef = sceneUrl ? await fetchJson(sceneUrl) : sceneSource;
  const libUrl = libraryUrl
    ? new URL(libraryUrl, location.href)
    : new URL(sceneDef.library || '../library.json', sceneUrl || location.href);
  const library = await fetchJson(libUrl);

  const group = new THREE.Group();
  group.name = 'diorama';
  const loader = new GLTFLoader();
  const items = new Map();

  await Promise.all((sceneDef.items || []).map(async (it) => {
    const entry = library.assets[it.asset];
    let model;
    try {
      if (!entry) throw new Error(`"${it.asset}" is not in the library`);
      const gltf = await loader.loadAsync(new URL(entry.file, libUrl).href);
      model = prepareModel(gltf.scene, entry.fit);
    } catch (err) {
      log.warn('Asset failed to load, showing a placeholder box', `${it.id}: ${err.message}`);
      model = placeholderBox(entry?.size);
    }
    const holder = new THREE.Group();
    holder.name = it.id;
    holder.add(model);
    holder.position.set(it.x ?? 0, BASE_HEIGHT + (it.y ?? 0), it.z ?? 0);
    holder.rotation.y = THREE.MathUtils.degToRad(it.rotation ?? 0);
    group.add(holder);
    items.set(it.id, { def: it, entry, object: holder });
  }));
  group.updateMatrixWorld(true);

  // Ground: given in the scene, or "auto" = around all items with a margin.
  let ground = sceneDef.ground;
  if (!ground || ground === 'auto') {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    for (const { object } of items.values()) { object.position.x -= c.x; object.position.z -= c.z; }
    group.updateMatrixWorld(true);
    ground = { length: Math.max(1, +(size.x + 2).toFixed(1)), width: Math.max(1, +(size.z + 2).toFixed(1)) };
  }
  group.add(buildGround(ground));

  // "item" or "item:port" → position in diorama coordinates.
  const endpoint = (ref) => {
    const [id, portName] = String(ref).split(':');
    const item = items.get(id);
    if (!item) return null;
    const node = portName ? item.object.getObjectByName('port_' + portName) : null;
    if (portName && !node) log.warn('Port not found, using the top of the model', ref);
    if (node) return node.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(item.object);
    return new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.2, (box.min.z + box.max.z) / 2);
  };

  const flowsGroup = new THREE.Group();
  flowsGroup.name = 'flows';
  group.add(flowsGroup);
  const flows = [];
  for (const def of sceneDef.flows || []) {
    const f = buildFlow(def, endpoint, log);
    if (f) { flows.push(f); flowsGroup.add(f.group); }
  }

  log.info('Diorama loaded', {
    items: [...items.keys()],
    flows: flows.length,
    ground: `${ground.length} x ${ground.width} m`,
  });
  return {
    group,
    flowsGroup,
    ground: { length: ground.length, width: ground.width },
    items,
    flows,
    update(dt) { for (const f of flows) f.update(dt); },
  };
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url.pathname}: HTTP ${r.status}`);
  return r.json();
}
