// Draws connections as cables and tubes lying on the ground, routed by router.js.
//
//   electricity → a bright yellow cable
//   heat, gas   → a translucent tube with rings, in the carrier colour
//
// Paths run at right angles along the table axes, around the assets. Where two cross,
// one arches over the other (a cable over a tube; otherwise the later link over the
// earlier one). Dots move along each connection from producer to consumer, faster for
// more power.
//
// Used in two places with different units:
//   - manual / cards mode (links.js): under the table anchor, units = table metres, scale 1
//   - demo diorama (diorama.js): inside the diorama, units = real metres, scale = the
//     diorama's scale on the table (e.g. 1/25)
// All sizes below are in table metres and divided by `scale`, so a cable looks the same
// in every mode.
// Note: Magic Leap 2 is an additive display: dark = transparent, so everything is bright.

import * as THREE from 'three';
import { routeLinks, findCrossings, assignBridges, heightAt } from './router.js';

// Default look per carrier; components.json "carriers" can override color and style.
export const CARRIER_STYLES = {
  electricity: { color: '#ffe14d', style: 'cable' },
  heat: { color: '#ff7a2e', style: 'tube' },
  gas: { color: '#7ad7ff', style: 'tube' },
};

const T = {                 // sizes in table metres
  cell: 0.02,               // routing grid
  corner: 0.01,             // corner rounding radius
  step: 0.004,              // path sampling
  bridgeHeight: 0.02,       // clears a tube (1.2 cm across)
  bridgeLength: 0.07,
  dotGap: 0.06,             // one dot per this much path
  labelLift: 0.04,          // labels float this high above the middle of the path
  cable: { radius: 0.0025, glow: 0.005, glowOpacity: 0.25, dot: 0.0034 },
  tube: { radius: 0.006, opacity: 0.45, ring: 0.0072, ringThickness: 0.0012, ringGap: 0.1, dot: 0.0034 },
};

const Z = new THREE.Vector3(0, 0, 1);
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();

// A path given as dense points, parametrised by arc length (t = 0..1).
class SampledCurve extends THREE.Curve {
  constructor(points) {
    super();
    this.points = points;
    this.cum = [0];
    for (let i = 1; i < points.length; i++) this.cum.push(this.cum[i - 1] + points[i].distanceTo(points[i - 1]));
    this.total = this.cum[this.cum.length - 1] || 1e-9;
  }
  getPoint(t, target = new THREE.Vector3()) {
    const s = Math.max(0, Math.min(1, t)) * this.total;
    const cum = this.cum;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const span = cum[hi] - cum[lo] || 1;
    return target.copy(this.points[lo]).lerp(this.points[hi], (s - cum[lo]) / span);
  }
  getPointAt(u, target) { return this.getPoint(u, target); } // already by arc length
  getTangentAt(u, target) { return this.getTangent(u, target); }
  getLength() { return this.total; }
}

// Axis-aligned polyline (x, z) → dense 2D points with rounded corners.
function roundCorners(pts, radius) {
  const out = [{ x: pts[0].x, z: pts[0].z }];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    const l2 = Math.abs(c.x - b.x) + Math.abs(c.z - b.z);
    const r = Math.min(radius, l1 / 2, l2 / 2);
    const d1 = { x: Math.sign(b.x - a.x), z: Math.sign(b.z - a.z) };
    const d2 = { x: Math.sign(c.x - b.x), z: Math.sign(c.z - b.z) };
    const p0 = { x: b.x - d1.x * r, z: b.z - d1.z * r };
    const p2 = { x: b.x + d2.x * r, z: b.z + d2.z * r };
    for (let k = 0; k <= 6; k++) { // quadratic Bézier p0 → b → p2
      const t = k / 6, u = 1 - t;
      out.push({ x: u * u * p0.x + 2 * u * t * b.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * b.z + t * t * p2.z });
    }
  }
  out.push({ x: pts[pts.length - 1].x, z: pts[pts.length - 1].z });
  return out;
}

// Dense 2D points → evenly spaced points every `step`, each with its arc length.
function resample(pts, step) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(total / step) + 1);
  const out = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const s = (total * k) / (n - 1);
    while (j < pts.length - 1 && cum[j] < s) j++;
    const span = cum[j] - cum[j - 1] || 1;
    const f = Math.max(0, Math.min(1, (s - cum[j - 1]) / span));
    out.push({ x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * f, z: pts[j - 1].z + (pts[j].z - pts[j - 1].z) * f, s });
  }
  return out;
}

export class CableNetwork {
  // parent: where the cables hang (table anchor, or the diorama's flows group).
  // scale: table metres per local unit. carriers: components.json "carriers" (optional).
  constructor(parent, { scale = 1, carriers = {} } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'cables';
    parent.add(this.group);
    this.scale = scale;
    this.carriers = {};
    for (const key of new Set([...Object.keys(CARRIER_STYLES), ...Object.keys(carriers)])) {
      this.carriers[key] = { ...CARRIER_STYLES.electricity, ...CARRIER_STYLES[key], ...carriers[key] };
    }
    this.items = [];
    this.signature = '';
    this.last = null;
  }

  styleOf(link) {
    return this.carriers[link.carrier]?.style === 'tube' ? 'tube' : 'cable';
  }

  // area: { length, width } centred on the origin; baseY: ground level;
  // nodes: [{ id, x, z, hx, hz }]; links: [{ id, from, to, carrier, power, label? }] in
  // creation order. Re-routes and rebuilds only when something changed.
  set({ area, baseY = 0, nodes, links }) {
    this.last = { area, baseY, nodes, links };
    const r = (v) => Math.round(v * 1e4);
    const signature = JSON.stringify([
      this.scale, r(area.length), r(area.width), r(baseY),
      nodes.map((n) => [n.id, r(n.x), r(n.z), r(n.hx), r(n.hz)]),
      links.map((l) => [l.id, l.from, l.to, l.carrier, l.power]),
    ]);
    if (signature === this.signature) return;
    this.#clearItems();
    this.signature = signature;
    if (!links.length) return;
    const k = 1 / this.scale; // table metres → local units
    const styleOf = (l) => this.styleOf(l);
    const paths = routeLinks({ area, cell: T.cell * k, nodes, links });
    const bridges = assignBridges(findCrossings(paths, nodes, links), links, styleOf);
    for (const link of links) {
      const pts = paths.get(link.id);
      if (pts && pts.length >= 2) this.items.push(this.#build(link, pts, bridges.get(link.id) ?? [], baseY, k));
    }
  }

  // The diorama's scale on the table changed: rebuild with table-sized cables.
  setScale(scale) {
    if (!(scale > 0) || scale === this.scale) return;
    this.scale = scale;
    if (this.last) this.set(this.last);
  }

  clear() {
    this.#clearItems();
    this.signature = '';
    this.last = null;
  }

  update(dt) {
    for (const item of this.items) {
      const { curve, dots, speed } = item;
      if (!dots) continue;
      item.phase = (item.phase + (dt * speed) / curve.total) % 1;
      _s.setScalar(item.dotRadius);
      for (let i = 0; i < dots.count; i++) {
        curve.getPoint((item.phase + i / dots.count) % 1, _p);
        dots.setMatrixAt(i, _m.compose(_p, _q.identity(), _s));
      }
      dots.instanceMatrix.needsUpdate = true;
    }
  }

  #build(link, pts, bridgePoints, baseY, k) {
    const style = this.styleOf(link);
    const look = T[style];
    const colour = new THREE.Color(this.carriers[link.carrier]?.color ?? '#ffffff');
    const radius = look.radius * k;

    // Path on the ground, corners rounded, lifted over the bridges.
    const flat = resample(roundCorners(pts, T.corner * k), T.step * k);
    const centres = bridgePoints.map((b) => {
      let best = Infinity, s = 0;
      for (const p of flat) {
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d < best) { best = d; s = p.s; }
      }
      return s;
    });
    const points = flat.map((p) => new THREE.Vector3(
      p.x, baseY + radius + heightAt(p.s, centres, T.bridgeHeight * k, T.bridgeLength * k), p.z));
    const path = new SampledCurve(points);
    const segments = Math.max(8, points.length - 1);

    const group = new THREE.Group();
    group.name = `${link.carrier} ${link.from} → ${link.to}`;
    const disposables = [];
    const add = (mesh) => { group.add(mesh); disposables.push(mesh.geometry, mesh.material); return mesh; };

    if (style === 'cable') {
      add(new THREE.Mesh(new THREE.TubeGeometry(path, segments, radius, 8, false), new THREE.MeshBasicMaterial({ color: colour })));
      add(new THREE.Mesh(
        new THREE.TubeGeometry(path, segments, look.glow * k, 8, false),
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: look.glowOpacity, depthWrite: false })
      ));
    } else {
      add(new THREE.Mesh(
        new THREE.TubeGeometry(path, segments, radius, 12, false),
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: look.opacity, depthWrite: false, side: THREE.DoubleSide })
      ));
      // Rings every so often, so it reads as a pipe.
      const count = Math.max(1, Math.floor(path.total / (look.ringGap * k)));
      const rings = add(new THREE.InstancedMesh(
        new THREE.TorusGeometry(look.ring * k, look.ringThickness * k, 6, 20),
        new THREE.MeshBasicMaterial({ color: colour }),
        count
      ));
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        path.getPoint(t, _p);
        path.getTangent(t, _t).normalize();
        rings.setMatrixAt(i, _m.compose(_p, _q.setFromUnitVectors(Z, _t), _s.setScalar(1)));
      }
      rings.instanceMatrix.needsUpdate = true;
    }

    // Flow dots, producer → consumer. Cable: beads on the cable; tube: inside it.
    let dots = null;
    if ((link.power ?? 1) > 0) {
      const dotColour = colour.clone().lerp(new THREE.Color('#ffffff'), style === 'cable' ? 0.7 : 0.35);
      dots = add(new THREE.InstancedMesh(
        sphereGeo.clone(),
        new THREE.MeshBasicMaterial({ color: dotColour }),
        Math.max(2, Math.round(path.total / (T.dotGap * k)))
      ));
      dots.frustumCulled = false;
    }

    // Label (owned by the caller, e.g. the diorama's kW sprite) above the middle.
    if (link.label) {
      path.getPoint(0.5, link.label.position);
      link.label.position.y += T.labelLift * k;
      group.add(link.label);
    }

    this.group.add(group);
    const power = Math.max(0, link.power ?? 1);
    return {
      group, disposables, label: link.label ?? null, curve: path, dots,
      dotRadius: look.dot * k,
      speed: (0.08 + 0.04 * Math.sqrt(power)) * k,
      phase: Math.random(),
    };
  }

  #clearItems() {
    for (const item of this.items) {
      if (item.label) item.group.remove(item.label); // the caller's: keep it
      this.group.remove(item.group);
      for (const d of item.disposables) d.dispose();
    }
    this.items = [];
  }
}
