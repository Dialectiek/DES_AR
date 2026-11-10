// Procedural models for the asset library. Each builder returns a THREE.Group in real
// metres: origin = centre of the footprint on the ground, +Y up, front facade facing +Z.
//
// These are the *source* of the GLB files in assets/models/. To regenerate them:
//   node devserver.mjs 8001 --allow-save
//   open http://localhost:8001/tools/export-models.html
// (or ask Claude Code to run it headless).
//
// Connection points for energy flows are empty nodes named "port_<name>", for example
// port_pv (middle of the PV array) and port_meter (where the building meets the grid).
// They survive the GLB export, so the app can find them with getObjectByName().
//
// Colours are bright on purpose: the Magic Leap 2 display is additive, so dark = see-through.

import * as THREE from 'three';

function stdMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
}

function boxAt(w, h, d, material, x, y, z, name) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  if (name) m.name = name;
  return m;
}

function port(name, x, y, z) {
  const p = new THREE.Object3D();
  p.name = 'port_' + name;
  p.position.set(x, y, z);
  return p;
}

// One PV panel of 1.0 x 1.65 m with white frame lines (stay visible at any scale).
const PANEL = { w: 1.0, d: 1.65, t: 0.05, kwp: 0.4 };
function makePanelKit() {
  const geo = new THREE.BoxGeometry(PANEL.w, PANEL.t, PANEL.d);
  const mat = stdMat(0x3d7bff, { roughness: 0.35, metalness: 0.2, emissive: 0x0b2a80, emissiveIntensity: 0.6 });
  mat.name = 'pv_panel';
  const edges = new THREE.EdgesGeometry(geo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
  edgeMat.name = 'pv_frame';
  return () => {
    const p = new THREE.Mesh(geo, mat);
    p.name = 'pv_panel';
    p.add(new THREE.LineSegments(edges, edgeMat));
    return p;
  };
}

// ---------------------------------------------------------------------------
// House with PV: two storeys, 9 x 7 m, 40° gable roof, 14 panels (5.6 kWp) on the front slope.
// ---------------------------------------------------------------------------
export function buildHousePV() {
  const W = 9, D = 7, H = 5.6;
  const pitch = THREE.MathUtils.degToRad(40);
  const over = 0.35;
  const rise = (D / 2) * Math.tan(pitch);
  const wallMat = stdMat(0xfff1d6);
  wallMat.name = 'wall';
  const house = new THREE.Group();
  house.name = 'house-pv';

  house.add(boxAt(W, H, D, wallMat, 0, H / 2, 0, 'walls'));

  const tri = new THREE.Shape();
  tri.moveTo(-D / 2, 0);
  tri.lineTo(D / 2, 0);
  tri.lineTo(0, rise);
  tri.closePath();
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: W, bevelEnabled: false }), wallMat);
  gable.name = 'gable';
  gable.rotation.y = Math.PI / 2;
  gable.position.set(-W / 2, H, 0);
  house.add(gable);

  // Roof slabs. Local axes of a slab: X along the ridge, Z down the slope, Y = roof normal.
  const roofMat = stdMat(0xff7a59);
  roofMat.name = 'roof';
  const slope = (D / 2 + over) / Math.cos(pitch);
  const thick = 0.22;
  const slabs = [];
  for (const side of [1, -1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W + 2 * over, thick, slope), roofMat);
    slab.name = side > 0 ? 'roof_front' : 'roof_back';
    slab.rotation.x = side * pitch;
    const cz = side * (D / 2 + over) / 2;
    const cy = H + rise - ((D / 2 + over) / 2) * Math.tan(pitch);
    slab.position.set(0, cy + (thick / 2) * Math.cos(pitch), cz + side * (thick / 2) * Math.sin(pitch));
    house.add(slab);
    slabs.push(slab);
  }

  // PV array on the front slope: 2 rows x 7 panels.
  const panel = makePanelKit();
  const cols = 7, rows = 2, gap = 0.08;
  const pv = new THREE.Group();
  pv.name = 'pv_array';
  pv.position.set(0, thick / 2 + 0.06, -0.2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = panel();
      p.position.set((c - (cols - 1) / 2) * (PANEL.w + gap), 0, (r - (rows - 1) / 2) * (PANEL.d + gap));
      pv.add(p);
    }
  }
  pv.add(port('pv', 0, 0.3, 0));
  slabs[0].add(pv);

  // Front facade (+Z): door and windows; side windows on +X.
  const glassMat = stdMat(0xa8dcff, { emissive: 0x1d4f73, emissiveIntensity: 0.4 });
  glassMat.name = 'glass';
  const doorMat = stdMat(0xffc061);
  doorMat.name = 'door';
  const zf = D / 2 + 0.04;
  house.add(boxAt(1.1, 2.2, 0.08, doorMat, 0, 1.1, zf, 'door'));
  for (const x of [-3, 3]) house.add(boxAt(1.3, 1.4, 0.08, glassMat, x, 1.6, zf, 'window'));
  for (const x of [-3, 0, 3]) house.add(boxAt(1.3, 1.3, 0.08, glassMat, x, 4.2, zf, 'window'));
  for (const z of [-1.5, 1.5]) {
    house.add(boxAt(0.08, 1.3, 1.2, glassMat, W / 2 + 0.04, 1.6, z, 'window'));
    house.add(boxAt(0.08, 1.3, 1.2, glassMat, W / 2 + 0.04, 4.2, z, 'window'));
  }
  house.add(boxAt(0.7, 2.2, 0.7, stdMat(0xffb08a), 2.6, H + rise - 0.4, -1.4, 'chimney'));

  // Meter box on the side wall, where the house connects to the grid / the car charger.
  house.add(boxAt(0.12, 0.6, 0.45, stdMat(0xe8e8e8), W / 2 + 0.06, 1.2, 2.4, 'meter_box'));
  house.add(port('meter', W / 2 + 0.2, 1.2, 2.4));
  house.userData = { pvPeakKw: rows * cols * PANEL.kwp };
  return house;
}

// ---------------------------------------------------------------------------
// Office with PV: three storeys, 18 x 10 m, flat roof with 4 tilted rows of 14 panels
// (56 panels, 22.4 kWp) facing +Z.
// ---------------------------------------------------------------------------
export function buildOfficePV() {
  const W = 18, D = 10, floorH = 3.5, floors = 3;
  const H = floors * floorH;
  const office = new THREE.Group();
  office.name = 'office-pv';

  const coreMat = stdMat(0xf2f5f7);
  coreMat.name = 'facade';
  office.add(boxAt(W, H, D, coreMat, 0, H / 2, 0, 'core'));

  // A glass band around each floor; the white core shows between them as spandrels.
  const glassMat = stdMat(0x8fe3ff, { roughness: 0.25, metalness: 0.1, emissive: 0x1c5a73, emissiveIntensity: 0.5 });
  glassMat.name = 'glass';
  for (let f = 0; f < floors; f++) {
    office.add(boxAt(W + 0.12, 2.1, D + 0.12, glassMat, 0, f * floorH + 1.75, 0, 'glass_band_' + f));
  }
  // Vertical mullions on the front so it reads as an office facade.
  const mullionMat = stdMat(0xffffff);
  mullionMat.name = 'mullion';
  for (let i = -4; i <= 4; i++) {
    office.add(boxAt(0.15, H - 0.4, 0.2, mullionMat, i * 2, H / 2, D / 2 + 0.1, 'mullion'));
  }

  // Roof slab and parapet.
  const roofMat = stdMat(0xd9dee3);
  roofMat.name = 'roof';
  office.add(boxAt(W + 0.4, 0.3, D + 0.4, roofMat, 0, H + 0.15, 0, 'roof'));
  const par = 0.6, pt = 0.25;
  office.add(boxAt(W + 0.4, par, pt, roofMat, 0, H + 0.3 + par / 2, D / 2 + 0.2 - pt / 2, 'parapet'));
  office.add(boxAt(W + 0.4, par, pt, roofMat, 0, H + 0.3 + par / 2, -D / 2 - 0.2 + pt / 2, 'parapet'));
  office.add(boxAt(pt, par, D + 0.4, roofMat, W / 2 + 0.2 - pt / 2, H + 0.3 + par / 2, 0, 'parapet'));
  office.add(boxAt(pt, par, D + 0.4, roofMat, -W / 2 - 0.2 + pt / 2, H + 0.3 + par / 2, 0, 'parapet'));

  // Entrance: glass doors and a canopy, front centre.
  office.add(boxAt(3.2, 2.6, 0.1, glassMat, 0, 1.3, D / 2 + 0.2, 'entrance'));
  office.add(boxAt(4.5, 0.2, 2.2, stdMat(0xffffff), 0, 3.0, D / 2 + 1.1, 'canopy'));

  // Rooftop PV: rows tilted 15° towards +Z, raised on a frame.
  const panel = makePanelKit();
  const tilt = THREE.MathUtils.degToRad(15);
  const cols = 14, rows = 4, gap = 0.06, rowPitch = 2.2;
  const pv = new THREE.Group();
  pv.name = 'pv_array';
  pv.position.set(0, H + 0.3, 0.3);
  for (let r = 0; r < rows; r++) {
    const row = new THREE.Group();
    row.name = 'pv_row';
    row.position.set(0, 0.55, (r - (rows - 1) / 2) * rowPitch);
    row.rotation.x = tilt; // +Z edge lower: the panels face +Z
    for (let c = 0; c < cols; c++) {
      const p = panel();
      p.position.set((c - (cols - 1) / 2) * (PANEL.w + gap), 0, 0);
      row.add(p);
    }
    pv.add(row);
  }
  pv.add(port('pv', 0, 1.6, 0));
  office.add(pv);

  // Rooftop installation box (inverters / HVAC) behind the panels.
  office.add(boxAt(2.4, 1.3, 1.4, stdMat(0xe8e8e8), -W / 2 + 2, H + 0.95, -D / 2 + 1.2, 'rooftop_unit'));

  // Grid connection cabinet on the side.
  office.add(boxAt(0.5, 1.6, 1.0, stdMat(0xe8e8e8), W / 2 + 0.3, 0.8, 3.0, 'meter_cabinet'));
  office.add(port('meter', W / 2 + 0.6, 1.2, 3.0));
  office.userData = { pvPeakKw: rows * cols * PANEL.kwp };
  return office;
}

// ---------------------------------------------------------------------------
// House without PV: the same house, panels left off. A household load in scenarios.
// ---------------------------------------------------------------------------
export function buildHouse() {
  const house = buildHousePV();
  house.name = 'house';
  house.getObjectByName('pv_array')?.removeFromParent();
  house.userData = {};
  return house;
}

// A beam (thin box) from a to b, both THREE.Vector3.
function beam(a, b, t, material, name = 'beam') {
  const dir = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.BoxGeometry(t, dir.length(), t), material);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  m.name = name;
  return m;
}

// Flat lightning bolt in the XY plane, about 1 x 1.6 m, facing +Z.
function boltMesh(material, scale = 1) {
  const s = new THREE.Shape();
  const pts = [[0.15, 0.8], [-0.45, -0.05], [-0.05, -0.05], [-0.2, -0.8], [0.45, 0.1], [0.05, 0.1], [0.15, 0.8]];
  s.moveTo(pts[0][0] * scale, pts[0][1] * scale);
  for (const [x, y] of pts.slice(1)) s.lineTo(x * scale, y * scale);
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false }), material);
  m.name = 'bolt';
  return m;
}

// ---------------------------------------------------------------------------
// Neighbourhood battery: a 2.4 x 1.2 m cabinet, 2 m high, with module doors on the front.
// The app hangs its state-of-charge bar on the empty node "level_anchor" (front, bottom of
// the bar); the bar is 70% of the cabinet height.
// ---------------------------------------------------------------------------
export function buildBattery() {
  const L = 2.4, H = 2.0, W = 1.2;
  const g = new THREE.Group();
  g.name = 'battery';
  const body = stdMat(0xf2f5f7);
  body.name = 'cabinet';
  g.add(boxAt(L, H, W, body, 0, H / 2 + 0.15, 0, 'cabinet'));
  g.add(boxAt(L + 0.2, 0.15, W + 0.2, stdMat(0xc9d1d9), 0, 0.075, 0, 'plinth'));
  g.add(boxAt(L + 0.1, 0.12, W + 0.1, stdMat(0x7cff6b), 0, H + 0.21, 0, 'lid'));
  const door = stdMat(0xdfe6ee);
  door.name = 'door';
  for (const x of [-0.8, 0.8]) g.add(boxAt(0.7, H - 0.3, 0.05, door, x, H / 2 + 0.15, W / 2 + 0.025, 'module_door'));
  // Terminals on the lid: + (red) and − (dark grey reads as see-through, so white).
  g.add(boxAt(0.18, 0.2, 0.18, stdMat(0xff6b6b), -0.7, H + 0.37, 0, 'terminal_plus'));
  g.add(boxAt(0.18, 0.2, 0.18, stdMat(0xffffff), 0.7, H + 0.37, 0, 'terminal_minus'));
  const anchor = new THREE.Object3D();
  anchor.name = 'level_anchor';
  anchor.position.set(0, 0.45, W / 2 + 0.08);
  g.add(anchor);
  g.add(port('main', 0, H + 0.3, 0));
  return g;
}

// ---------------------------------------------------------------------------
// Transformer / neighbourhood controller: the hub where the flows meet. A 3 x 2 m tank,
// three bushings on top, red bands and a lightning bolt on the front.
// ---------------------------------------------------------------------------
export function buildTransformer() {
  const L = 3.0, H = 2.2, W = 2.0;
  const g = new THREE.Group();
  g.name = 'transformer';
  g.add(boxAt(L, H, W, stdMat(0xb8f0c8), 0, H / 2 + 0.2, 0, 'tank'));
  g.add(boxAt(L + 0.3, 0.2, W + 0.3, stdMat(0xc9d1d9), 0, 0.1, 0, 'plinth'));
  const red = stdMat(0xff6b6b);
  red.name = 'band';
  for (const y of [0.45, H + 0.05]) g.add(boxAt(L + 0.06, 0.18, W + 0.06, red, 0, y, 0, 'band'));
  // Cooling fins on both sides.
  const fin = stdMat(0x9fe0b4);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) g.add(boxAt(0.25, H - 0.6, 0.06, fin, sx * (L / 2 + 0.12), H / 2 + 0.2, -0.6 + i * 0.3, 'fin'));
  }
  // Bushings: stacked discs on a white post.
  const white = stdMat(0xffffff);
  white.name = 'bushing';
  for (const x of [-0.9, 0, 0.9]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 10), white);
    post.position.set(x, H + 0.2 + 0.45, 0);
    post.name = 'bushing';
    g.add(post);
    for (let k = 0; k < 4; k++) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12), white);
      disc.position.set(x, H + 0.35 + k * 0.2, 0);
      disc.name = 'bushing_disc';
      g.add(disc);
    }
  }
  const bolt = boltMesh(stdMat(0xffd60a, { emissive: 0x806a00, emissiveIntensity: 0.5 }), 0.9);
  bolt.position.set(0, H / 2 + 0.2, W / 2 + 0.01);
  g.add(bolt);
  g.add(port('main', 0, H + 1.1, 0));
  return g;
}

// ---------------------------------------------------------------------------
// High-voltage lattice pylon, 18 m high: the public grid. Light grey on purpose (dark steel
// would be see-through on the additive display).
// ---------------------------------------------------------------------------
export function buildGridPylon() {
  const g = new THREE.Group();
  g.name = 'grid-pylon';
  const steel = stdMat(0xd0d6dc);
  steel.name = 'steel';
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const top = 16, base = 2.4, head = 0.6;
  const half = (y) => base + (head - base) * (y / top); // half-width of the tower at height y
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [sx, sz] of corners) g.add(beam(V(sx * base, 0, sz * base), V(sx * head, top, sz * head), 0.22, steel, 'leg'));
  // Bracing on every face between these levels.
  const levels = [0, 3.5, 7, 10, 12.5, 14.5, 16];
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = levels[i], y1 = levels[i + 1];
    const h0 = half(y0), h1 = half(y1);
    for (let f = 0; f < 4; f++) {
      const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
      g.add(beam(V(ax * h0, y0, az * h0), V(bx * h1, y1, bz * h1), 0.1, steel, 'brace'));
      g.add(beam(V(bx * h0, y0, bz * h0), V(ax * h1, y1, az * h1), 0.1, steel, 'brace'));
      g.add(beam(V(ax * h1, y1, az * h1), V(bx * h1, y1, bz * h1), 0.12, steel, 'ring'));
    }
  }
  // Peak and cross arms with hanging insulators.
  g.add(beam(V(0, top, 0), V(0, top + 2, 0), 0.18, steel, 'peak'));
  const insul = stdMat(0x9fd8ff, { emissive: 0x1d4f73, emissiveIntensity: 0.4 });
  insul.name = 'insulator';
  for (const [y, span] of [[12.5, 4], [15, 3]]) {
    g.add(boxAt(2 * span, 0.3, 0.3, steel, 0, y, 0, 'cross_arm'));
    for (const x of [-span + 0.2, span - 0.2]) {
      const ins = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 8), insul);
      ins.position.set(x, y - 0.75, 0);
      ins.name = 'insulator';
      g.add(ins);
    }
  }
  g.add(port('main', 0, 12.5, 0));
  return g;
}

// id → builder. The id is also the file name: assets/models/<id>.glb
export const BUILDERS = {
  'house-pv': buildHousePV,
  'office-pv': buildOfficePV,
  house: buildHouse,
  battery: buildBattery,
  transformer: buildTransformer,
  'grid-pylon': buildGridPylon,
};
