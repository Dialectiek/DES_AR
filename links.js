// Draws the links of the energy system on the table and animates the flows.
//
// Each link is a low arc (quadratic Bézier) from source to target, drawn as a thin tube
// in the carrier colour, with small particles moving along it in the flow direction.
// Particle speed and size grow with the link's power (hard-coded per asset for now).

import * as THREE from 'three';

const ARC_PEAK = 0.04;        // metres above the table at the middle of the arc
const END_HEIGHT = 0.012;     // where the arc starts and ends
const SIDE_OFFSET = 0.018;    // spacing between parallel links of the same pair
const PARTICLES = 7;          // per link
const sphereGeo = new THREE.SphereGeometry(1, 10, 8);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

function particleStyle(power) {
  const p = Math.max(0, power || 0);
  return {
    speed: Math.min(0.9, 0.18 + 0.1 * Math.sqrt(p)), // arc lengths per second
    radius: Math.min(0.009, 0.004 + 0.0012 * Math.sqrt(p)),
  };
}

export class LinkView {
  // parent: the table anchor group; config: components.json
  constructor(parent, config) {
    this.parent = parent;
    this.config = config;
    this.items = new Map(); // link id → { group, curve, particles, style, phase }
  }

  // Rebuilds the drawing to match system.links (cheap: only changed links are touched).
  sync(system) {
    const wanted = new Map(system.links.map((l) => [l.id, l]));
    for (const [id, item] of this.items) {
      if (!wanted.has(id)) this.#remove(id, item);
    }
    for (const link of system.links) {
      if (this.items.has(link.id)) continue;
      const from = system.node(link.from), to = system.node(link.to);
      if (!from || !to) continue;
      const siblings = system.linksBetween(link.from, link.to);
      const k = siblings.findIndex((l) => l.id === link.id);
      const offset = (k - (siblings.length - 1) / 2) * SIDE_OFFSET;
      this.items.set(link.id, this.#build(link, from, to, offset));
    }
  }

  #build(link, from, to, offset) {
    const colour = new THREE.Color(this.config.carriers[link.carrier]?.color ?? '#ffffff');
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    // Sideways offset, always to the same side of the pair (independent of direction).
    const sign = from.id < to.id ? 1 : -1;
    const ox = (-dz / len) * offset * sign, oz = (dx / len) * offset * sign;
    const a = new THREE.Vector3(from.x + ox, END_HEIGHT, from.z + oz);
    const b = new THREE.Vector3(to.x + ox, END_HEIGHT, to.z + oz);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y = 2 * ARC_PEAK - END_HEIGHT; // Bézier control point → the curve peaks at ARC_PEAK
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);

    const group = new THREE.Group();
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 40, 0.0018, 6, false),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55 })
    );
    group.add(tube);

    const particles = new THREE.InstancedMesh(sphereGeo, new THREE.MeshBasicMaterial({ color: colour }), PARTICLES);
    particles.frustumCulled = false;
    group.add(particles);
    this.parent.add(group);
    return { group, tube, curve, particles, style: particleStyle(link.power), phase: Math.random() };
  }

  #remove(id, item) {
    this.parent.remove(item.group);
    item.tube.geometry.dispose();
    item.tube.material.dispose();
    item.particles.material.dispose();
    item.particles.dispose();
    this.items.delete(id);
  }

  clear() {
    for (const [id, item] of this.items) this.#remove(id, item);
  }

  update(dt) {
    for (const item of this.items.values()) {
      const { curve, particles, style } = item;
      item.phase = (item.phase + style.speed * dt) % 1;
      _s.setScalar(style.radius);
      for (let k = 0; k < PARTICLES; k++) {
        const t = (item.phase + k / PARTICLES) % 1;
        curve.getPoint(t, _p);
        _m.compose(_p, _q, _s);
        particles.setMatrixAt(k, _m);
      }
      particles.instanceMatrix.needsUpdate = true;
    }
  }
}
