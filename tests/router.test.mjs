import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeLinks, findCrossings, assignBridges, heightAt, pathLength, arcLengthAt, simplify } from '../router.js';

const area = { length: 1.6, width: 0.8 };
const cell = 0.02;
const node = (id, x, z, r = 0.04) => ({ id, x, z, hx: r, hz: r });
const styles = { electricity: 'cable', heat: 'tube', gas: 'tube' };
const styleOf = (l) => styles[l.carrier] ?? 'cable';
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

// Points every `step` along a path (for "does it go through X" checks).
function samples(pts, step = 0.005) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.abs(b.x - a.x) + Math.abs(b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}
const inside = (nd, p, eps = 1e-9) => Math.abs(p.x - nd.x) < nd.hx - eps && Math.abs(p.z - nd.z) < nd.hz - eps;

test('paths are axis-aligned and run from centre to centre', () => {
  const nodes = [node(1, -0.513, -0.107), node(2, 0.386, 0.214)];
  const paths = routeLinks({ area, cell, nodes, links: [{ id: 10, from: 1, to: 2 }] });
  const p = paths.get(10);
  assert.deepEqual(p[0], { x: -0.513, z: -0.107 });
  assert.deepEqual(p.at(-1), { x: 0.386, z: 0.214 });
  for (let i = 1; i < p.length; i++) {
    const dx = Math.abs(p[i].x - p[i - 1].x), dz = Math.abs(p[i].z - p[i - 1].z);
    assert.ok(dx < 1e-9 || dz < 1e-9, `segment ${i} is diagonal`);
    assert.ok(dx > 1e-9 || dz > 1e-9, `segment ${i} has no length`);
  }
  assert.ok(p.length <= 6, `few corners (${p.length} points)`);
});

test('a path goes around an asset that stands in the way', () => {
  const nodes = [node(1, -0.5, 0), node(2, 0.5, 0), node(3, 0, 0, 0.1)];
  const p = routeLinks({ area, cell, nodes, links: [{ id: 10, from: 1, to: 2 }] }).get(10);
  for (const s of samples(p)) assert.ok(!inside(nodes[2], s), `goes through the obstacle at ${s.x}, ${s.z}`);
  assert.ok(pathLength(p) > 1.0); // a detour
});

test('two links between the same pair take separate lanes', () => {
  const nodes = [node(1, -0.4, -0.1), node(2, 0.4, 0.15)];
  const links = [{ id: 10, from: 1, to: 2, carrier: 'electricity' }, { id: 11, from: 1, to: 2, carrier: 'heat' }];
  const paths = routeLinks({ area, cell, nodes, links });
  const outside = (pts) => samples(pts).filter((s) => !nodes.some((nd) => inside(nd, s, -1e-6)));
  const b = outside(paths.get(11));
  for (const s of outside(paths.get(10))) {
    const d = Math.min(...b.map((t) => Math.hypot(t.x - s.x, t.z - s.z)));
    assert.ok(d > 0.015, `lanes too close (${d.toFixed(3)}) at ${s.x.toFixed(3)}, ${s.z.toFixed(3)}`);
  }
});

// L → R along z = 0, T → B along x = 0: one crossing in the middle.
const plus = [node('L', -0.5, 0), node('R', 0.5, 0), node('T', 0, -0.3), node('B', 0, 0.3)];

test('a "+" gives one crossing, and the cable goes over the tube', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const two = [{ id: 'e', from: 'L', to: 'R', carrier: 'electricity' }, { id: 'h', from: 'T', to: 'B', carrier: 'heat' }];
    const links = order.map((i) => two[i]);
    const paths = routeLinks({ area, cell, nodes: plus, links });
    const crossings = findCrossings(paths, plus, links);
    assert.equal(crossings.length, 1);
    close(crossings[0].x, 0);
    close(crossings[0].z, 0);
    const bridges = assignBridges(crossings, links, styleOf);
    assert.deepEqual([...bridges.keys()], ['e']); // whatever the order
  }
});

test('between two of the same style, the later link goes over', () => {
  const links = [{ id: 'first', from: 'L', to: 'R', carrier: 'electricity' }, { id: 'second', from: 'T', to: 'B', carrier: 'electricity' }];
  const paths = routeLinks({ area, cell, nodes: plus, links });
  const bridges = assignBridges(findCrossings(paths, plus, links), links, styleOf);
  assert.deepEqual([...bridges.keys()], ['second']);
  const tubes = links.map((l) => ({ ...l, carrier: 'heat' }));
  const tb = assignBridges(findCrossings(routeLinks({ area, cell, nodes: plus, links: tubes }), plus, tubes), tubes, styleOf);
  assert.deepEqual([...tb.keys()], ['second']);
});

test('crossings under an end asset do not count', () => {
  // Both links leave the same asset in the middle; their crossing (if any) is hidden under it.
  const nodes = [node('M', 0, 0, 0.08), node('W', -0.5, 0.05), node('N', 0.05, -0.35)];
  const links = [{ id: 1, from: 'M', to: 'W' }, { id: 2, from: 'M', to: 'N' }];
  const paths = routeLinks({ area, cell, nodes, links });
  for (const c of findCrossings(paths, nodes, links)) assert.ok(!inside(nodes[0], c, -1e-9));
});

test('heightAt: a smooth hump at each bridge', () => {
  const h = 0.02, w = 0.07;
  assert.equal(heightAt(0.5, [0.2], h, w), 0);
  close(heightAt(0.2, [0.2], h, w), h);
  close(heightAt(0.2 + w / 2 - 1e-9, [0.2], h, w), 0, 1e-9);
  assert.ok(heightAt(0.21, [0.2], h, w) < h && heightAt(0.21, [0.2], h, w) > h / 2);
  // Two bridges close together: the higher one counts, no double height.
  assert.ok(heightAt(0.22, [0.2, 0.24], h, w) <= h);
  // Smooth: no jumps between neighbouring samples.
  let prev = heightAt(0.1, [0.2], h, w);
  for (let s = 0.1; s < 0.3; s += 0.001) {
    const y = heightAt(s, [0.2], h, w);
    assert.ok(Math.abs(y - prev) < 0.002);
    prev = y;
  }
});

test('adding a link keeps the earlier paths; routing is repeatable', () => {
  const nodes = [node(1, -0.5, -0.2), node(2, 0.45, 0.2), node(3, -0.1, 0.25), node(4, 0.2, -0.25)];
  const l1 = { id: 1, from: 1, to: 2 }, l2 = { id: 2, from: 3, to: 4 };
  const alone = routeLinks({ area, cell, nodes, links: [l1] }).get(1);
  const both = routeLinks({ area, cell, nodes, links: [l1, l2] });
  assert.deepEqual(both.get(1), alone);
  assert.deepEqual(routeLinks({ area, cell, nodes, links: [l1, l2] }).get(2), both.get(2));
});

test('works in any unit: a 25x bigger layout gives the same shape', () => {
  const k = 25;
  const nodes = [node(1, -0.5, -0.1), node(2, 0.4, 0.2), node(3, 0, 0, 0.08)];
  const big = nodes.map((n) => ({ id: n.id, x: n.x * k, z: n.z * k, hx: n.hx * k, hz: n.hz * k }));
  const links = [{ id: 1, from: 1, to: 2 }];
  const small = routeLinks({ area, cell, nodes, links }).get(1);
  const large = routeLinks({ area: { length: area.length * k, width: area.width * k }, cell: cell * k, nodes: big, links }).get(1);
  assert.equal(large.length, small.length);
  large.forEach((p, i) => { close(p.x, small[i].x * k, 1e-6); close(p.z, small[i].z * k, 1e-6); });
});

test('arcLengthAt and simplify', () => {
  const pts = [{ x: 0, z: 0 }, { x: 0.3, z: 0 }, { x: 0.3, z: 0.2 }];
  close(arcLengthAt(pts, 0.1, 0.01), 0.1);
  close(arcLengthAt(pts, 0.31, 0.15), 0.45);
  close(pathLength(pts), 0.5);
  assert.deepEqual(simplify([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0.1, z: 0 }, { x: 0.2, z: 0 }, { x: 0.2, z: 0.1 }]),
    [{ x: 0, z: 0 }, { x: 0.2, z: 0 }, { x: 0.2, z: 0.1 }]);
});
