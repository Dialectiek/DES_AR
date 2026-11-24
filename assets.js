// Loads components.json and the asset models, and builds the 3D object for a node.
//
// Every object is a THREE.Group placed in table-local coordinates (child of tableAnchor):
//   - the model (or a placeholder cube when the card colour has no asset yet),
//   - a ring on the table in the card colour (also the hover / selection highlight),
//   - a small label above it.
// Note: Magic Leap 2 is an additive display, so dark colours look transparent.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const COMPONENTS_URL = 'assets/components.json';

export async function loadComponents(url = COMPONENTS_URL) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const config = JSON.parse(await res.text());
  for (const key of ['cards', 'assets', 'carriers', 'colours']) {
    if (!config[key]) throw new Error(`${url}: missing "${key}"`);
  }
  for (const [colour, type] of Object.entries(config.cards)) {
    if (!config.colours[colour]) throw new Error(`${url}: card "${colour}" has no entry in "colours"`);
    if (type !== null && !config.assets[type]) {
      throw new Error(`${url}: card "${colour}" points to unknown asset "${type}"`);
    }
  }
  for (const [colour, c] of Object.entries(config.colours)) {
    if (!/^#[0-9a-f]{6}$/i.test(c.rgb ?? '')) throw new Error(`${url}: colour "${colour}" needs "rgb": "#rrggbb"`);
  }
  return config;
}

// Colour used to draw a card colour in the headset. Dark colours are invisible on the
// additive display, so "display" can override the card's real colour.
export function displayColour(config, colour) {
  const c = config.colours[colour];
  return c?.display ?? c?.rgb ?? '#ffffff';
}

// Brightens the model a bit: dark materials vanish on an additive display.
function liftMaterials(root, amount) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const lifted = mats.map((m) => {
      if (!m || !m.color || !('emissive' in m)) return m;
      const c = m.clone();
      c.emissive.copy(c.color).multiplyScalar(amount);
      if (c.map) c.emissiveMap = c.map;
      return c;
    });
    o.material = Array.isArray(o.material) ? lifted : lifted[0];
  });
}

// Scales the model so its largest side (any direction) is sizeM, puts its base at
// y = 0 and centres it. Returns { object, height, footprint }.
function normalise(scene, sizeM) {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = sizeM / Math.max(size.x, size.y, size.z, 1e-6);
  const centre = box.getCenter(new THREE.Vector3());
  scene.scale.setScalar(scale);
  scene.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  const wrapper = new THREE.Group();
  wrapper.add(scene);
  return { object: wrapper, height: size.y * scale, footprint: Math.max(size.x, size.z) * scale };
}

// Loads every model used by an asset in the config. Failed models are logged and
// replaced by the placeholder later. Returns Map(assetKey → { object, height }).
export async function preloadModels(config, log, { emissive = 0.35 } = {}) {
  const loader = new GLTFLoader();
  const templates = new Map();
  await Promise.all(Object.entries(config.assets).map(async ([key, def]) => {
    if (!def.model) return;
    try {
      const gltf = await loader.loadAsync(def.model);
      liftMaterials(gltf.scene, emissive);
      const t = normalise(gltf.scene, def.size_m ?? 0.12);
      templates.set(key, t);
      log.info(`Model loaded: ${key}`, { height_m: +t.height.toFixed(3) });
    } catch (err) {
      log.warn(`Model failed to load: ${key} (${def.model})`, String(err?.message ?? err));
    }
  }));
  return templates;
}

function makeLabel(text, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 52px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, 256, 50);
  ctx.fillStyle = colour;
  ctx.fillText(text, 256, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(0.12, 0.0225, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const PLACEHOLDER_SIZE = 0.05;
const placeholderGeo = new THREE.BoxGeometry(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, PLACEHOLDER_SIZE)
  .translate(0, PLACEHOLDER_SIZE / 2, 0);
const placeholderEdges = new THREE.EdgesGeometry(placeholderGeo);

// node: { id, colour, type, x, z } from EnergySystem. Returns a THREE.Group with
// userData { nodeId, ring, ringMat, pickCentre (local), pickRadius, footprintRadius }.
// footprintRadius = half the model's width: connections are routed around that square.
export function makeAssetObject(node, config, templates) {
  const def = node.type ? config.assets[node.type] : null;
  const colourHex = displayColour(config, node.colour);
  const group = new THREE.Group();
  group.position.set(node.x, 0, node.z);

  let height, footprint;
  const template = node.type ? templates.get(node.type) : null;
  if (template) {
    group.add(template.object.clone(true));
    height = template.height;
    footprint = template.footprint;
  } else {
    const cube = new THREE.Mesh(placeholderGeo, new THREE.MeshStandardMaterial({
      color: colourHex, emissive: colourHex, emissiveIntensity: 0.4, roughness: 0.5,
    }));
    cube.add(new THREE.LineSegments(placeholderEdges, new THREE.LineBasicMaterial({ color: 0xffffff })));
    group.add(cube);
    height = PLACEHOLDER_SIZE;
    footprint = PLACEHOLDER_SIZE;
  }

  const r = Math.max(0.035, footprint * 0.6);
  const ringMat = new THREE.MeshBasicMaterial({ color: colourHex, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.008, 48).rotateX(-Math.PI / 2), ringMat);
  ring.position.y = 0.003;
  group.add(ring);

  const label = makeLabel(def?.label ?? `${node.colour}: no asset yet`, colourHex);
  label.position.y = height + 0.03;
  group.add(label);

  group.userData = {
    nodeId: node.id,
    ring,
    ringMat,
    pickCentre: new THREE.Vector3(0, height / 2, 0),
    pickRadius: Math.max(r, height / 2) * 1.1,
    footprintRadius: footprint / 2,
  };
  return group;
}

export function disposeAssetObject(obj) {
  obj.traverse((o) => {
    if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
    if (o === obj.userData.ring) { o.geometry.dispose(); o.material.dispose(); }
  });
}

// Turns the object so its front (+Z) faces the given point (table-local).
export function faceTowards(obj, localPoint) {
  obj.rotation.y = Math.atan2(localPoint.x - obj.position.x, localPoint.z - obj.position.z);
}

const _ray = new THREE.Ray();
const _sphere = new THREE.Sphere();
const _hit = new THREE.Vector3();

// origin, dir: world-space ray (THREE.Vector3). Returns the closest object it hits, or null.
export function pickAsset(origin, dir, objects) {
  _ray.set(origin, dir);
  let best = null, bestDist = Infinity;
  for (const obj of objects) {
    _sphere.center.copy(obj.userData.pickCentre);
    obj.localToWorld(_sphere.center);
    _sphere.radius = obj.userData.pickRadius;
    if (!_ray.intersectSphere(_sphere, _hit)) continue;
    const d = _hit.distanceTo(origin);
    if (d < bestDist) { bestDist = d; best = obj; }
  }
  return best;
}
