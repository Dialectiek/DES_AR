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
  wind: { color: 0x6bffe0, text: 'wind' },
  load: { color: 0xffa94d, text: 'demand' },
  flow: { color: 0xe6f4ff, text: 'flow' },
};

// "0.27 kW", "14.0 kW" (absolute value: the direction shows in the particles).
export function fmtKw(kw) {
  const a = Math.abs(kw);
  return `${a < 10 ? a.toFixed(2) : a.toFixed(1)} kW`;
}

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

// Text label as a sprite (always faces the viewer). draw() repaints it, only when the
// text or colour changed.
function makeLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 112;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(2.8, 2.8 * (112 / 256), 1);
  let last = '';
  return {
    sprite,
    draw(line1, line2, color) {
      const key = `${line1}|${line2}|${color}`;
      if (key === last) return;
      last = key;
      ctx.clearRect(0, 0, 256, 112);
      ctx.fillStyle = 'rgba(10,14,20,0.55)';
      ctx.beginPath();
      ctx.roundRect(4, 4, 248, 104, 18);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.font = '700 46px system-ui, sans-serif';
      ctx.fillText(line1, 128, 42, 236);
      ctx.fillStyle = '#ffffff';
      ctx.font = '500 26px system-ui, sans-serif';
      ctx.fillText(line2, 128, 84, 236);
      tex.needsUpdate = true;
    },
  };
}

const kindOf = (name) => FLOW_KINDS[name] || { color: 0xffffff, text: name || 'flow' };

// State-of-charge bar: a white frame with a fill that grows from the bottom.
// Placed on the model's "level_anchor" node if it has one, otherwise beside the model.
function buildLevelBar(holder, root) {
  const box = new THREE.Box3().setFromObject(holder);
  const inv = holder.matrixWorld.clone().invert();
  const height = Math.max(0.5, 0.7 * (box.max.y - box.min.y));
  const width = Math.max(0.3, height * 0.28);
  const anchor = holder.getObjectByName('level_anchor');
  const base = new THREE.Vector3();
  if (anchor) {
    anchor.getWorldPosition(base);
  } else {
    base.set(box.max.x + width, box.min.y, (box.min.z + box.max.z) / 2);
    root.localToWorld(base);
  }
  base.applyMatrix4(inv); // into the holder's frame (it is scaled 1:1 in diorama metres)
  const g = new THREE.Group();
  g.name = 'level bar';
  g.position.copy(base);
  const frameGeo = new THREE.BoxGeometry(width, height, width * 0.3).translate(0, height / 2, 0);
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(frameGeo), new THREE.LineBasicMaterial({ color: 0xffffff })));
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x7cff6b });
  const fill = new THREE.Mesh(new THREE.BoxGeometry(width * 0.8, height, width * 0.24).translate(0, height / 2, 0), fillMat);
  fill.scale.y = 0.001;
  g.add(fill);
  holder.add(g);
  return {
    set(frac) {
      const f = Number.isFinite(frac) ? Math.min(1, Math.max(0, frac)) : 0;
      fill.scale.y = Math.max(0.001, f);
      fillMat.color.setHex(f < 0.2 ? 0xff6b6b : f < 0.5 ? 0xffd60a : 0x7cff6b);
    },
  };
}

// One energy flow: an arc from A to B with particles moving along it.
// Particle size and speed grow with the power, so bigger flows read as "more".
// setPower(kw) changes it while it runs (timeline): a negative value sends the particles
// the other way (and uses def.kindReverse's colour if given), about 0 hides them, NaN
// means "no data". def.showLabel = false leaves the kW label out; the label shows
// kw × def.labelFactor (e.g. the total of a group of houses).
function buildFlow(def, endpoint, log) {
  const a = endpoint(def.from);
  const b = endpoint(def.to);
  if (!a || !b) {
    log.warn('Flow skipped: unknown end point', `${def.from} → ${def.to}`);
    return null;
  }
  const kind = kindOf(def.kind);
  const back = def.kindReverse ? kindOf(def.kindReverse) : kind;
  const dist = a.distanceTo(b);
  const mid = a.clone().lerp(b, 0.5);
  mid.y = Math.max(a.y, b.y) + 1.2 + 0.3 * dist;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const length = curve.getLength();

  const g = new THREE.Group();
  g.name = `flow ${def.from} → ${def.to}`;

  const tubeMat = new THREE.MeshBasicMaterial({ color: kind.color, transparent: true, opacity: 0.45, depthWrite: false });
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.05, 6, false), tubeMat));

  const count = Math.max(3, Math.round(length / 1.6));
  const dotMat = new THREE.MeshBasicMaterial({ color: kind.color });
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), dotMat, count);
  dots.frustumCulled = false;
  dots.count = 0;
  g.add(dots);

  const label = def.showLabel === false ? null : makeLabel();
  if (label) {
    label.sprite.position.copy(curve.getPoint(0.5)).add(new THREE.Vector3(0, 1.1, 0));
    g.add(label.sprite);
  }

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let phase = Math.random();
  let kw = 0, dir = 1, speed = 1.5, noData = false, reversed = false;
  let labelDue = true, labelWait = 0;

  function drawLabel() {
    const k = reversed ? back : kind;
    const text = def.series ? (def.label ? `${k.text}, ${def.label}` : k.text) : def.label || k.text;
    label.draw(noData ? 'no data' : fmtKw(kw * (def.labelFactor ?? 1)), text, k.color);
  }

  const flow = {
    group: g,
    def,
    get kw() { return kw; },
    setPower(value) {
      noData = !Number.isFinite(value);
      kw = noData ? 0 : value;
      def.kw = kw;
      const a = Math.abs(kw);
      const rev = kw < 0;
      if (rev !== reversed) {
        reversed = rev;
        const c = (rev ? back : kind).color;
        tubeMat.color.setHex(c);
        dotMat.color.setHex(c);
      }
      tubeMat.opacity = noData ? 0.15 : 0.45;
      dir = rev ? -1 : 1;
      dots.count = a < 0.005 ? 0 : count;
      const radius = 0.12 + 0.045 * Math.sqrt(a); // 1 kW ≈ 0.17 m, 14 kW ≈ 0.29 m
      s.setScalar(radius);
      speed = Math.min(9, 1.5 + 0.5 * a);         // metres per second (real scale)
      labelDue = true;
    },
    update(dt) {
      if (label && labelDue && (labelWait -= dt) <= 0) {
        drawLabel();
        labelDue = false;
        labelWait = 0.2; // at most 5 repaints per second
      }
      if (!dots.count) return;
      phase = (((phase + (dir * dt * speed) / length) % 1) + 1) % 1;
      for (let i = 0; i < dots.count; i++) {
        curve.getPointAt((i / dots.count + phase) % 1, p);
        dots.setMatrixAt(i, m.compose(p, q, s));
      }
      dots.instanceMatrix.needsUpdate = true;
    },
  };
  flow.setPower(def.series?.missing ? NaN : Number(def.kw) || 0);
  return flow;
}

// sceneSource: URL of a scene JSON, or a scene object. library: the parsed library.json
// (otherwise fetched from libraryUrl or the scene's "library"). Returns
// { group, ground: { length, width }, items, flows, levels, update(dt) }.
// An item with "level" gets a fill bar: levels = [{ id, def, set(fraction) }].
export async function buildDiorama({ sceneSource, libraryUrl, library: libraryIn, log }) {
  const sceneUrl = typeof sceneSource === 'string' ? new URL(sceneSource, location.href) : null;
  const sceneDef = sceneUrl ? await fetchJson(sceneUrl) : sceneSource;
  const libUrl = libraryUrl
    ? new URL(libraryUrl, location.href)
    : new URL(sceneDef.library || '../library.json', sceneUrl || location.href);
  const library = libraryIn ?? await fetchJson(libUrl);

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
    // No port given: the model's "port_main" if it has one, otherwise its top.
    const node = item.object.getObjectByName('port_' + (portName || 'main'));
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

  const levels = [];
  for (const [id, item] of items) {
    if (!item.def.level) continue;
    const bar = buildLevelBar(item.object, group);
    levels.push({
      id,
      def: item.def,
      set(fraction) {
        item.def.levelValue = fraction;
        bar.set(fraction);
      },
    });
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
    levels,
    update(dt) { for (const f of flows) f.update(dt); },
  };
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${url.pathname}: HTTP ${r.status}`);
  return r.json();
}
