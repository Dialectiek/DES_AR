// Procedural models for the asset library. Each builder returns a THREE.Group in real
// metres: origin = centre of the footprint on the ground, +Y up, front facade facing +Z.
//
// These are the *source* of the GLB files in assets/models/. To regenerate them:
//   node devserver.mjs 8001 --allow-save
//   open http://localhost:8001/tools/export-models.html
// (or ask Claude Code to run it headless). A builder may be async (the EWI tower loads
// its STL source from tools/sources/).
//
// Connection points for energy flows are empty nodes named "port_<name>", for example
// port_pv (middle of the PV array) and port_meter (where the building meets the grid).
// They survive the GLB export, so the app can find them with getObjectByName().
//
// Colours are bright on purpose: the Magic Leap 2 display is additive, so dark = see-through.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

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
// The office: the EWI tower of TU Delft, with rooftop PV (56 panels, 22.4 kWp).
//
// The building comes from tools/sources/ewi-tower.stl: a binary STL in metres, Z up,
// 52k triangles, with every window and the fins on the crown modelled. As it is, it would
// make a GLB of about 2.4 MB, so the builder simplifies it:
//   - the window relief (mullions, sills, reveals) and the crown fins are dropped, and
//     each facade becomes one flat quad with the window grid as a texture (the panes in
//     the texture are the STL's own glass faces);
//   - the antenna on the roof (7.6k triangles) becomes a few simple shapes;
//   - the faces under the building and the small entrance canopy (it would sit inside the
//     low wing) are dropped.
// STL has no colour, so the parts are coloured by where they are, after the real building
// but brighter for the additive display: blue glass in a fine light grid, a light-blue
// crown and ledges, a red end wall with a red crown above it, white "TU Delft" letters.
// The builder adds what the STL does not have: the low glass wing along the front, the
// rooftop PV, the meter cabinet and the ports.
//
// Real size: about 95 m long, 31 m deep with the wing, 101 m to the top of the crown and
// 108 m with the antenna. A scene that needs it smaller scales its item ("scale").
// Orientation: the entrance side faces +Z, the long side runs along X, and the red end is
// on the left when you face the front.
// ---------------------------------------------------------------------------
const EWI_STL = new URL('./sources/ewi-tower.stl', import.meta.url);

const EWI_COLOURS = {
  glass: '#6aa8f0',     // window panes (the real glass is dark blue-grey)
  frame: '#e4f1ff',     // the window grid between the panes
  crown: '#9fd6ff',     // crown box around the roof, ledges, wing roof
  red: '#ff4b2b',       // end wall and crown at the red end
  recess: '#5f97e0',    // the recessed band under the crown
  wall: '#d3e2f2',      // solid walls: the other end wall, the stair and lift cores
  roof: '#e8eef4',
  wingGlass: '#86c2f7', // the low wing (dark in reality)
  white: '#f6f9fc',
  logo: '#ffffff',
};

// Measured in the STL's own axes: X across the slab (-X = front), Y along it (+Y = the
// red end), Z up, metres.
const EWI = {
  crownBottom: 96.95, // the crown box runs from here ...
  crownTop: 103.45,   // ... to here; above it there is only the antenna and its platform
  roofWell: [101.5, 103.0], // z of the roof surfaces inside the crown
  facadeTop: 93.6,    // top of the window grid; up to the crown is a recessed band
  redFrom: 36.74,     // y where the red end section starts (its crown is red)
  redWall: 53.9,      // y beyond which everything is the red end wall
  front: -13.18,      // x of the front facade; the low wing stands in front of it
  wing: { depth: 10, height: 8.4, bay: 2.7, floors: 2 },
  pvCentre: [-7.17, 0, 101.86], // a free part of the roof, between the parapet and a raised strip
  antenna: { platform: [-10.94, 5.89, 18.77, 29.1], mast: [-3.9, 26.3], top: 110.6 },
};

// Facade relief: the slab between a facade's outer plane (mullion fronts, crown fins) and
// its inner plane (glass, crown wall). Every triangle inside one is dropped and one quad on
// the inner plane covers the same area. axis/dir: the outward normal (axis 0 = x, 1 = y);
// along: range on the other horizontal axis; z: height range. windows: the quad gets the
// window texture (else a flat colour); logo: STL y of the middle of the "TU Delft" letters.
const EWI_RELIEF = [
  { name: 'facade_back', axis: 0, dir: 1, inner: 7.22, outer: 7.64, along: [-26.3, 54.4], z: [2.4, 93.7], windows: true, logo: -10 },
  { name: 'facade_back_plain_end', axis: 0, dir: 1, inner: -1.47, outer: -0.92, along: [-40, -26.2], z: [2.4, 93.7], windows: true },
  { name: 'facade_front', axis: 0, dir: -1, inner: -12.71, outer: -13.18, along: [-40, 36.8], z: [2.4, 93.7], windows: true, logo: -10 },
  { name: 'facade_front_red_end', axis: 0, dir: -1, inner: -4.18, outer: -4.62, along: [36.7, 54.4], z: [2.4, 93.7], windows: true },
  { name: 'crown_back', axis: 0, dir: 1, inner: 7.28, outer: 7.64, along: [-26.3, 54.4], z: [96.95, 103.45] },
  { name: 'crown_back_plain_end', axis: 0, dir: 1, inner: -1.31, outer: -0.92, along: [-40, -26.2], z: [96.95, 103.45] },
  { name: 'crown_front', axis: 0, dir: -1, inner: -12.82, outer: -13.18, along: [-40, 36.8], z: [96.95, 103.45] },
  { name: 'crown_front_red_end', axis: 0, dir: -1, inner: -4.31, outer: -4.62, along: [36.7, 54.4], z: [96.95, 103.45] },
  { name: 'crown_plain_end', axis: 1, dir: -1, inner: -39.52, outer: -39.89, along: [-13.2, -0.9], z: [96.95, 103.45] },
  { name: 'crown_red_end', axis: 1, dir: 1, inner: 54.08, outer: 54.37, along: [-4.65, 7.65], z: [96.95, 103.45] },
];
const EWI_PX_PER_M = 10; // facade texture resolution: a mullion is 3-5 px

// Triangles of a binary STL as a flat Float32Array (9 numbers per triangle).
function parseBinaryStl(buffer) {
  const view = new DataView(buffer);
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  if (count === 0 || 84 + count * 50 !== buffer.byteLength) throw new Error('expected a binary STL');
  const out = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) {
    const o = 84 + i * 50 + 12; // skip the stored normal: it is recomputed from the winding
    for (let k = 0; k < 9; k++) out[i * 9 + k] = view.getFloat32(o + k * 4, true);
  }
  return out;
}

function inRelief(zone, min, max) {
  const t = 0.05;
  const a = zone.axis, o = 1 - zone.axis;
  return min[a] >= Math.min(zone.inner, zone.outer) - t && max[a] <= Math.max(zone.inner, zone.outer) + t
    && min[o] >= zone.along[0] - t && max[o] <= zone.along[1] + t
    && min[2] >= zone.z[0] - t && max[2] <= zone.z[1] + t;
}

// Colour group of a kept STL triangle (normal n, bounding box min/max, centre c).
function ewiPart(n, min, max, c) {
  const up = n[2] > 0.99;
  if (up && min[2] >= EWI.roofWell[0] && max[2] <= EWI.roofWell[1]) return 'roof';
  if (min[2] >= EWI.crownBottom - 0.05) return c[1] >= EWI.redFrom ? 'red' : 'crown';
  if (min[1] >= EWI.redWall) return 'red';
  if (up) return 'crown'; // ledges: the light-blue edge under the recessed band
  if (min[2] >= EWI.facadeTop) return 'recess';
  return 'wall';
}

// A vertical quad in STL coordinates on the plane `axis` = `at`, facing `dir`, spanning
// `along` and `z`. u runs left to right as seen from outside (right = up × normal).
// Calls tri(a, b, c, uvA, uvB, uvC) twice, counter-clockwise from outside.
function stlQuad({ axis, dir }, at, along, z, tri) {
  const rs = axis === 0 ? dir : -dir; // the right vector's sign along the other axis
  const u0 = Math.min(rs * along[0], rs * along[1]), u1 = Math.max(rs * along[0], rs * along[1]);
  const P = (u, h) => { const p = [0, 0, h]; p[axis] = at; p[1 - axis] = rs * u; return p; };
  const bl = P(u0, z[0]), br = P(u1, z[0]), tr = P(u1, z[1]), tl = P(u0, z[1]);
  tri(bl, br, tr, [0, 0], [1, 0], [1, 1]);
  tri(bl, tr, tl, [0, 0], [1, 1], [0, 1]);
  return { rs, u0, u1 };
}

// Window texture of one facade: the frame colour with the STL's glass panes on it.
function facadeTexture(name, { rs, u0, u1 }, z, panes, logoY, glass = EWI_COLOURS.glass) {
  const W = Math.max(4, Math.round((u1 - u0) * EWI_PX_PER_M));
  const H = Math.max(4, Math.round((z[1] - z[0]) * EWI_PX_PER_M));
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const sx = W / (u1 - u0), sy = H / (z[1] - z[0]);
  ctx.fillStyle = EWI_COLOURS.frame;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = glass;
  for (const [a0, a1, z0, z1] of panes) {
    const pu0 = Math.min(rs * a0, rs * a1), pu1 = Math.max(rs * a0, rs * a1);
    ctx.fillRect((pu0 - u0) * sx, (z[1] - z1) * sy, (pu1 - pu0) * sx, (z1 - z0) * sy);
  }
  if (logoY !== undefined) {
    // "TU Delft" on the top floors, letters about 3.4 m high.
    ctx.fillStyle = EWI_COLOURS.logo;
    ctx.font = `700 ${Math.round(3.4 * sy * 1.3)}px "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TU Delft', (rs * logoY - u0) * sx, (z[1] - 87.8) * sy);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.name = name;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function facadeMaterial(name, texture) {
  const m = stdMat(0xffffff, { map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.25, roughness: 0.55 });
  m.name = name;
  return m;
}

// Flat-shaded, indexed mesh from a list of triangle positions.
function flatMesh(positions, material, name, uvs) {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uvs) g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals(); // not indexed yet, so the normals are per face
  g = mergeVertices(g, 1e-4);
  const mesh = new THREE.Mesh(g, material);
  mesh.name = name;
  return mesh;
}

export async function buildEwiTower() {
  const res = await fetch(EWI_STL);
  if (!res.ok) throw new Error(`${EWI_STL.pathname}: HTTP ${res.status}`);
  const stl = parseBinaryStl(await res.arrayBuffer());

  // STL → model axes: model x = -STL y, y = STL z - ground, z = -STL x, with the
  // footprint (tower and wing) centred on the origin. This is a rotation, so the
  // triangles keep facing outwards.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < stl.length; i += 3) {
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], stl[i + k]); hi[k] = Math.max(hi[k], stl[i + k]); }
  }
  const ground = lo[2];
  const xFrom = EWI.front - EWI.wing.depth, xTo = hi[0];
  const cx = -(lo[1] + hi[1]) / 2, cz = -(xFrom + xTo) / 2;
  const toModel = (p) => [-p[1] - cx, p[2] - ground, -p[0] - cz];

  const parts = { wall: [], crown: [], red: [], recess: [], roof: [] };
  const zones = EWI_RELIEF.map((z) => ({ ...z, panes: [], min: [Infinity, Infinity], max: [-Infinity, -Infinity] }));
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], n = [0, 0, 0];
  const min = [0, 0, 0], max = [0, 0, 0], mid = [0, 0, 0];
  let dropped = 0;
  for (let i = 0; i < stl.length; i += 9) {
    for (let k = 0; k < 3; k++) { a[k] = stl[i + k]; b[k] = stl[i + 3 + k]; c[k] = stl[i + 6 + k]; }
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    n[0] = e1[1] * e2[2] - e1[2] * e2[1];
    n[1] = e1[2] * e2[0] - e1[0] * e2[2];
    n[2] = e1[0] * e2[1] - e1[1] * e2[0];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-6) { dropped++; continue; } // degenerate
    for (let k = 0; k < 3; k++) {
      n[k] /= len;
      min[k] = Math.min(a[k], b[k], c[k]);
      max[k] = Math.max(a[k], b[k], c[k]);
      mid[k] = (a[k] + b[k] + c[k]) / 3;
    }
    // Underneath the building, the antenna (rebuilt below), the entrance canopy.
    if ((n[2] < -0.99 && max[2] < ground + 0.2) || min[2] >= EWI.crownTop || max[0] < EWI.front - 0.1) { dropped++; continue; }
    const zone = zones.find((z) => inRelief(z, min, max));
    if (zone) {
      const o = 1 - zone.axis;
      zone.min[0] = Math.min(zone.min[0], min[o]); zone.max[0] = Math.max(zone.max[0], max[o]);
      zone.min[1] = Math.min(zone.min[1], min[2]); zone.max[1] = Math.max(zone.max[1], max[2]);
      const isGlass = n[zone.axis] * zone.dir > 0.99 && Math.abs(min[zone.axis] - zone.inner) < 0.03 && Math.abs(max[zone.axis] - zone.inner) < 0.03;
      if (zone.windows && isGlass) zone.panes.push([min[o], max[o], min[2], max[2]]);
      dropped++;
      continue;
    }
    parts[ewiPart(n, min, max, mid)].push(...toModel(a), ...toModel(b), ...toModel(c));
  }

  const tower = new THREE.Group();
  tower.name = 'ewi-tower';
  const mats = {};
  for (const key of Object.keys(parts)) {
    const colour = key === 'red' ? EWI_COLOURS.red : EWI_COLOURS[key];
    mats[key] = stdMat(colour, { emissive: colour, emissiveIntensity: key === 'recess' ? 0.3 : 0.12 });
    mats[key].name = 'ewi_' + key;
  }

  // One quad per relief zone: textured facades, flat-coloured crown sides (the part of
  // a crown side above the red end section is red).
  for (const zone of zones) {
    if (zone.panes.length === 0 && !Number.isFinite(zone.min[0])) continue;
    const along = [zone.min[0], zone.max[0]], z = [zone.min[1], zone.max[1]];
    if (zone.windows) {
      const pos = [], uv = [];
      const span = stlQuad(zone, zone.inner, along, z, (p, q, r, ua, ub, uc) => {
        pos.push(...toModel(p), ...toModel(q), ...toModel(r));
        uv.push(...ua, ...ub, ...uc);
      });
      const tex = facadeTexture(zone.name, span, z, zone.panes, zone.logo);
      tower.add(flatMesh(pos, facadeMaterial(zone.name, tex), zone.name, uv));
      continue;
    }
    const pieces = zone.axis === 0 && along[0] < EWI.redFrom && along[1] > EWI.redFrom
      ? [[[along[0], EWI.redFrom], 'crown'], [[EWI.redFrom, along[1]], 'red']]
      : [[along, zone.axis === 1 ? (zone.dir > 0 ? 'red' : 'crown') : (along[0] >= EWI.redFrom - 0.1 ? 'red' : 'crown')]];
    for (const [range, part] of pieces) {
      stlQuad(zone, zone.inner, range, z, (p, q, r) => parts[part].push(...toModel(p), ...toModel(q), ...toModel(r)));
    }
  }
  for (const [key, pos] of Object.entries(parts)) {
    if (pos.length) tower.add(flatMesh(pos, mats[key], 'ewi_' + key));
  }

  // Boxes given in STL coordinates.
  const stlBox = (x0, x1, y0, y1, z0, z1, material, name) => {
    const m = toModel([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]);
    return boxAt(y1 - y0, z1 - z0, x1 - x0, material, m[0], m[1], m[2], name);
  };

  // Low glass wing along the front (two storeys), also in front of the set-back red end.
  const wing = new THREE.Group();
  wing.name = 'low_wing';
  const W = EWI.wing, wingTop = ground + W.height;
  const wingGlass = stdMat(EWI_COLOURS.wingGlass, { emissive: EWI_COLOURS.wingGlass, emissiveIntensity: 0.25, roughness: 0.4 });
  wingGlass.name = 'ewi_wing_glass';
  const xf = EWI.front - W.depth, yEnd = 54.37, yStart = -39.89;
  wing.add(stlBox(xf, EWI.front + 0.4, yStart, yEnd, ground, wingTop, wingGlass, 'wing'));
  wing.add(stlBox(EWI.front + 0.4, -4.66, EWI.redFrom, yEnd, ground, wingTop, wingGlass, 'wing_red_end'));
  wing.add(stlBox(xf - 0.3, EWI.front + 0.4, yStart - 0.3, yEnd + 0.3, wingTop, wingTop + 0.5, mats.crown, 'wing_roof'));
  wing.add(stlBox(EWI.front + 0.4, -4.66, EWI.redFrom, yEnd + 0.3, wingTop, wingTop + 0.5, mats.crown, 'wing_roof_red_end'));
  // Its front: a window grid of two storeys in bays of 2.7 m.
  const wingFront = { axis: 0, dir: -1 };
  const wingZ = [ground, wingTop];
  const wpos = [], wuv = [];
  const wspan = stlQuad(wingFront, xf - 0.02, [yStart, yEnd], wingZ, (p, q, r, ua, ub, uc) => {
    wpos.push(...toModel(p), ...toModel(q), ...toModel(r));
    wuv.push(...ua, ...ub, ...uc);
  });
  const wingPanes = [];
  const floorH = W.height / W.floors;
  for (let y = yStart; y + W.bay <= yEnd + 0.01; y += W.bay) {
    for (let f = 0; f < W.floors; f++) {
      wingPanes.push([y + 0.2, y + W.bay - 0.2, ground + f * floorH + 0.6, ground + (f + 1) * floorH - 0.3]);
    }
  }
  wing.add(flatMesh(wpos, facadeMaterial('wing_front', facadeTexture('wing_front', wspan, wingZ, wingPanes, undefined, EWI_COLOURS.wingGlass)), 'wing_front', wuv));
  tower.add(wing);

  // Antenna on the roof: platform, mast and dish.
  const ant = EWI.antenna;
  const whiteMat = stdMat(EWI_COLOURS.white);
  whiteMat.name = 'ewi_white';
  const [px0, px1, py0, py1] = ant.platform;
  tower.add(stlBox(px0, px1, py0, py1, EWI.crownTop - 0.05, EWI.crownTop + 0.45, mats.roof, 'antenna_platform'));
  const mastBase = toModel([ant.mast[0], ant.mast[1], EWI.crownTop + 0.45]);
  const mastH = ant.top - EWI.crownTop - 0.45;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, mastH, 8), whiteMat);
  mast.name = 'antenna_mast';
  mast.position.set(mastBase[0], mastBase[1] + mastH / 2, mastBase[2]);
  tower.add(mast);
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 0.5, 1.1, 16), whiteMat);
  dish.name = 'antenna_dish';
  dish.position.set(mastBase[0], mastBase[1] + mastH * 0.55, mastBase[2] + 1.0);
  dish.rotation.x = THREE.MathUtils.degToRad(60); // opening towards +Z
  tower.add(dish);

  // Rooftop PV: 4 rows of 14 panels tilted 15° towards the front (+Z).
  const panel = makePanelKit();
  const tilt = THREE.MathUtils.degToRad(15);
  const cols = 14, rows = 4, gap = 0.06, rowPitch = 2.2;
  const pv = new THREE.Group();
  pv.name = 'pv_array';
  const pvAt = toModel([EWI.pvCentre[0], EWI.pvCentre[1], EWI.pvCentre[2] + 0.3]);
  pv.position.set(pvAt[0], pvAt[1], pvAt[2]);
  for (let r = 0; r < rows; r++) {
    const row = new THREE.Group();
    row.name = 'pv_row';
    row.position.set(0, 0.55, (r - (rows - 1) / 2) * rowPitch);
    row.rotation.x = tilt; // +Z edge lower: the panels face +Z
    for (let col = 0; col < cols; col++) {
      const p = panel();
      p.position.set((col - (cols - 1) / 2) * (PANEL.w + gap), 0, 0);
      row.add(p);
    }
    pv.add(row);
  }
  pv.add(port('pv', 0, 1.6, 0));
  tower.add(pv);

  // Grid connection cabinet against the plain end wall (+X in the model).
  const cabinetMat = stdMat(0xe8e8e8);
  cabinetMat.name = 'meter_cabinet';
  tower.add(stlBox(-7.5, -6.5, -40.5, -39.89, ground, ground + 1.6, cabinetMat, 'meter_cabinet'));
  const meter = toModel([-7, -40.8, ground + 1.2]);
  tower.add(port('meter', meter[0], meter[1], meter[2]));

  tower.userData = { pvPeakKw: rows * cols * PANEL.kwp };
  console.info(`ewi-tower: ${stl.length / 9} STL triangles, ${dropped} dropped or replaced`);
  return tower;
}

// id → builder (may be async). The id is also the file name: assets/models/<id>.glb
export const BUILDERS = {
  'house-pv': buildHousePV,
  'ewi-tower': buildEwiTower,
};
