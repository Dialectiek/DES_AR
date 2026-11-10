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

// id → builder. The id is also the file name: assets/models/<id>.glb
export const BUILDERS = {
  'house-pv': buildHousePV,
  'office-pv': buildOfficePV,
};
