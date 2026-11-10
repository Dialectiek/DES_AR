// Routes the connections between assets as cables / tubes on the ground.
// Pure logic, no three.js, so it runs in Node tests too.
//
// Coordinates: x along the table's long side, z across, origin in the middle of `area`,
// in any unit (table metres for manual / cards, real metres in the diorama).
//
// Every path is axis-aligned: its segments run along x or z only (perpendicular to the
// table edges). Paths go around assets, keep apart from each other, and cross only when
// they have to. Where two cross, one gets a small bridge (arch) over the other:
//   - a cable goes over a tube,
//   - between two of the same style, the later link goes over the earlier one.

const COSTS = {
  step: 1,      // per grid step
  bend: 3,      // per corner
  overlap: 20,  // per step along a cell another path already runs along in the same direction
  cross: 2,     // per step across a cell another path runs along in the other direction
  blocked: 200, // per step through another asset (only when there is no other way)
};
const H = 0, V = 1;                 // axis of a step: along x or along z
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // +x, -x, +z, -z
const axisOf = (d) => (d < 2 ? H : V);
const START = 4;                    // "no direction yet"

// Binary min-heap of [priority, order, state]; `order` makes ties deterministic.
class Heap {
  constructor() { this.a = []; this.n = 0; }
  get size() { return this.a.length; }
  push(p, s) {
    const a = this.a;
    a.push([p, this.n++, s]);
    let i = a.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (less(a[j], a[i])) break;
      [a[i], a[j]] = [a[j], a[i]];
      i = j;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}
const less = (x, y) => x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);

const inRect = (n, x, z, eps = 1e-9) => Math.abs(x - n.x) <= n.hx + eps && Math.abs(z - n.z) <= n.hz + eps;

// Removes repeated points and merges straight runs into one segment.
export function simplify(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.z - p.z) < 1e-9) continue;
    out.push({ x: p.x, z: p.z });
    const n = out.length;
    if (n >= 3) {
      const a = out[n - 3], b = out[n - 2], c = out[n - 1];
      const sameX = Math.abs(a.x - b.x) < 1e-9 && Math.abs(b.x - c.x) < 1e-9;
      const sameZ = Math.abs(a.z - b.z) < 1e-9 && Math.abs(b.z - c.z) < 1e-9;
      if (sameX || sameZ) out.splice(n - 2, 1);
    }
  }
  return out;
}

export function pathLength(points) {
  let s = 0;
  for (let i = 1; i < points.length; i++) s += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].z - points[i - 1].z);
  return s;
}

// Arc length along an axis-aligned path to the point on it nearest to (x, z).
export function arcLengthAt(points, x, z) {
  let s = 0, best = Infinity, bestS = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    const t = len ? Math.max(0, Math.min(1, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / (len * len))) : 0;
    const px = a.x + (b.x - a.x) * t, pz = a.z + (b.z - a.z) * t;
    const d = Math.hypot(px - x, pz - z);
    if (d < best) { best = d; bestS = s + t * len; }
    s += len;
  }
  return bestS;
}

// area: { length, width } (centred on the origin); cell: grid size in the same units.
// nodes: [{ id, x, z, hx, hz }] asset centres and footprint half-extents.
// links: [{ id, from, to }] routed in this order: earlier links keep their paths when
// later ones are added. Returns Map(link id → [{ x, z }]) from the `from` asset's
// centre to the `to` asset's centre.
export function routeLinks({ area, cell, nodes, links, costs = {} }) {
  const C = { ...COSTS, ...costs };
  const nx = Math.max(2, Math.floor(area.length / cell) + 1);
  const nz = Math.max(2, Math.floor(area.width / cell) + 1);
  const x0 = -((nx - 1) * cell) / 2;
  const z0 = -((nz - 1) * cell) / 2;
  const n = nx * nz;
  const px = (i) => x0 + i * cell;
  const pz = (k) => z0 + k * cell;
  const clampI = (x) => Math.max(0, Math.min(nx - 1, Math.round((x - x0) / cell)));
  const clampK = (z) => Math.max(0, Math.min(nz - 1, Math.round((z - z0) / cell)));

  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  // Which assets cover each grid point.
  const covers = new Array(n);
  for (const nd of nodes) {
    for (let k = clampK(nd.z - nd.hz); k <= clampK(nd.z + nd.hz); k++) {
      for (let i = clampI(nd.x - nd.hx); i <= clampI(nd.x + nd.hx); i++) {
        if (!inRect(nd, px(i), pz(k))) continue;
        (covers[k * nx + i] ??= []).push(nd.id);
      }
    }
  }
  // How often earlier paths run through each grid point, per axis.
  const used = [new Uint16Array(n), new Uint16Array(n)];

  const paths = new Map();
  for (const link of links) {
    const a = byId.get(link.from), b = byId.get(link.to);
    if (!a || !b) continue;
    const start = clampK(a.z) * nx + clampI(a.x);
    const goal = clampK(b.z) * nx + clampI(b.x);
    const ends = new Set([a.id, b.id]);
    const own = (p) => covers[p] && covers[p].every((id) => ends.has(id)); // inside the end assets only
    const blocked = (p) => covers[p] && !covers[p].every((id) => ends.has(id));

    const S = 5;
    const g = new Float64Array(n * S).fill(Infinity);
    const came = new Int32Array(n * S).fill(-1);
    const heap = new Heap();
    const gi = goal % nx, gk = (goal / nx) | 0;
    const h = (p) => (Math.abs((p % nx) - gi) + Math.abs(((p / nx) | 0) - gk)) * C.step;
    g[start * S + START] = 0;
    heap.push(h(start), start * S + START);
    let found = -1;
    while (heap.size) {
      const [f, , state] = heap.pop();
      const p = (state / S) | 0, d = state % S;
      if (f - h(p) > g[state] + 1e-9) continue; // stale entry
      if (p === goal) { found = state; break; }
      const i = p % nx, k = (p / nx) | 0;
      for (let nd = 0; nd < 4; nd++) {
        if (d !== START && ((d ^ 1) === nd)) continue; // no U-turns
        const ni = i + DIRS[nd][0], nk = k + DIRS[nd][1];
        if (ni < 0 || nk < 0 || ni >= nx || nk >= nz) continue;
        const q = nk * nx + ni;
        let cost = C.step;
        if (d !== START && d !== nd) cost += C.bend;
        if (blocked(q)) cost += C.blocked;
        else if (!own(q)) {
          const ax = axisOf(nd);
          if (used[ax][q]) cost += C.overlap;
          else if (used[1 - ax][q]) cost += C.cross;
        }
        const ns = q * S + nd;
        const ng = g[state] + cost;
        if (ng < g[ns] - 1e-9) {
          g[ns] = ng;
          came[ns] = state;
          heap.push(ng + h(q), ns);
        }
      }
    }

    // Grid points from start to goal.
    const grid = [];
    for (let s = found; s >= 0; s = came[s]) grid.push((s / S) | 0);
    grid.reverse();
    if (!grid.length) grid.push(start);
    for (let j = 1; j < grid.length; j++) {
      const ax = Math.abs(grid[j] - grid[j - 1]) === 1 ? H : V;
      used[ax][grid[j]]++;
      used[ax][grid[j - 1]]++;
    }

    // Asset centre → grid → asset centre, every step axis-aligned. The short jogs between
    // a centre and its grid point stay inside the asset's footprint.
    const pts = grid.map((p) => ({ x: px(p % nx), z: pz((p / nx) | 0) }));
    const first = pts[0], last = pts[pts.length - 1];
    const firstAlongX = pts.length > 1 ? Math.abs(pts[1].z - first.z) < 1e-9 : true;
    const lastAlongX = pts.length > 1 ? Math.abs(pts[pts.length - 2].z - last.z) < 1e-9 : false;
    const out = [{ x: a.x, z: a.z }];
    // Leave the asset across the first segment's direction, so the jog merges into it.
    out.push(firstAlongX ? { x: a.x, z: first.z } : { x: first.x, z: a.z });
    out.push(...pts);
    out.push(lastAlongX ? { x: b.x, z: last.z } : { x: last.x, z: b.z });
    out.push({ x: b.x, z: b.z });
    paths.set(link.id, simplify(out));
  }
  return paths;
}

// Where two paths cross at right angles, away from both paths' own end assets.
// Returns [{ a, b, x, z }] with a, b link ids.
export function findCrossings(paths, nodes, links) {
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));
  const linkById = new Map(links.map((l) => [l.id, l]));
  const segs = (pts) => {
    const out = [];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (Math.abs(p.z - q.z) < 1e-9 && Math.abs(p.x - q.x) > 1e-9) out.push({ h: true, c: p.z, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) });
      else if (Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.z - q.z) > 1e-9) out.push({ h: false, c: p.x, lo: Math.min(p.z, q.z), hi: Math.max(p.z, q.z) });
    }
    return out;
  };
  const ids = [...paths.keys()];
  const all = new Map(ids.map((id) => [id, segs(paths.get(id))]));
  const result = [];
  const eps = 1e-6;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const la = linkById.get(ids[i]), lb = linkById.get(ids[j]);
      const ends = [la.from, la.to, lb.from, lb.to].map((id) => byId.get(id)).filter(Boolean);
      const seen = new Set();
      for (const sa of all.get(ids[i])) {
        for (const sb of all.get(ids[j])) {
          if (sa.h === sb.h) continue;
          const hs = sa.h ? sa : sb, vs = sa.h ? sb : sa;
          const x = vs.c, z = hs.c;
          if (x <= hs.lo + eps || x >= hs.hi - eps || z <= vs.lo + eps || z >= vs.hi - eps) continue;
          if (ends.some((nd) => inRect(nd, x, z))) continue; // hidden under an asset
          const key = `${x.toFixed(6)},${z.toFixed(6)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({ a: ids[i], b: ids[j], x, z });
        }
      }
    }
  }
  return result;
}

// Which path arches over the other at each crossing. links: in routing order;
// styleOf(link) → 'cable' | 'tube'. Returns Map(link id → [{ x, z }]) of bridge points.
export function assignBridges(crossings, links, styleOf) {
  const order = new Map(links.map((l, i) => [l.id, i]));
  const linkById = new Map(links.map((l) => [l.id, l]));
  const rank = (id) => (styleOf(linkById.get(id)) === 'tube' ? 0 : 1); // cables go over tubes
  const bridges = new Map();
  for (const c of crossings) {
    const ra = rank(c.a), rb = rank(c.b);
    const over = ra !== rb ? (ra > rb ? c.a : c.b) : (order.get(c.a) > order.get(c.b) ? c.a : c.b);
    if (!bridges.has(over)) bridges.set(over, []);
    bridges.get(over).push({ x: c.x, z: c.z });
  }
  return bridges;
}

// Height of a path above its normal level at arc length s: a smooth hump of height h and
// length w centred on every bridge position (arc lengths in `centres`).
export function heightAt(s, centres, h, w) {
  let y = 0;
  for (const c of centres) {
    const d = Math.abs(s - c);
    if (d < w / 2) y = Math.max(y, h * (0.5 + 0.5 * Math.cos((2 * Math.PI * d) / w)));
  }
  return y;
}
