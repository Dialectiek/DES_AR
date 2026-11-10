import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insideTable, nearestEdge, paletteSlots, backAction } from '../manual.js';

const L = 1.6, W = 0.8; // table length (x) and width (z), metres
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('insideTable keeps a margin from the edges', () => {
  assert.ok(insideTable(0, 0, L, W));
  assert.ok(insideTable(0.76, 0.36, L, W));
  assert.ok(!insideTable(0.78, 0, L, W));      // within 3 cm of the short edge
  assert.ok(!insideTable(0, -0.38, L, W));     // within 3 cm of a long edge
  assert.ok(!insideTable(1, 0, L, W));         // off the table
  assert.ok(insideTable(0.79, 0, L, W, 0));    // no margin
});

test('nearestEdge: the edge the user stands at', () => {
  assert.deepEqual(nearestEdge({ x: 0.2, z: 0.9 }, L, W), { axis: 'z', sign: 1 });
  assert.deepEqual(nearestEdge({ x: -0.5, z: -0.7 }, L, W), { axis: 'z', sign: -1 });
  assert.deepEqual(nearestEdge({ x: 1.3, z: 0.1 }, L, W), { axis: 'x', sign: 1 });
  assert.deepEqual(nearestEdge({ x: -1.2, z: -0.2 }, L, W), { axis: 'x', sign: -1 });
  // At a corner, the side you are further out of wins.
  assert.deepEqual(nearestEdge({ x: 0.9, z: 0.8 }, L, W), { axis: 'z', sign: 1 });
});

test('paletteSlots: a row just outside the near long edge, left to right', () => {
  const { slots, spacing, yaw } = paletteSlots(9, L, W, { x: 0, z: 1 });
  assert.equal(slots.length, 9);
  close(spacing, 0.13);
  close(yaw, 0);
  for (const s of slots) close(s.z, W / 2 + 0.07);
  // Seen from +z, left to right = increasing x; extra gap before the last (Done) slot.
  for (let i = 1; i < 8; i++) close(slots[i].x - slots[i - 1].x, spacing);
  close(slots[8].x - slots[7].x, spacing + 0.04);
  close(slots[0].x + slots[8].x, 0); // centred
});

test('paletteSlots: the far side mirrors the row and faces the other way', () => {
  const { slots, yaw } = paletteSlots(3, L, W, { x: 0, z: -1 });
  close(yaw, Math.PI);
  for (const s of slots) close(s.z, -(W / 2 + 0.07));
  assert.ok(slots[0].x > slots[2].x); // left to right as seen from -z
});

test('paletteSlots: on a short edge the row runs along z', () => {
  const { slots, yaw } = paletteSlots(3, L, W, { x: 1.4, z: 0 });
  close(yaw, Math.PI / 2);
  for (const s of slots) close(s.x, L / 2 + 0.07);
  assert.ok(slots[0].z > slots[2].z); // seen from +x, right = -z
});

test('paletteSlots: packs the tiles closer on a short table and stays within the edge', () => {
  const { slots, spacing } = paletteSlots(9, 0.6, 0.5, { x: 0, z: 1 });
  assert.ok(spacing < 0.13);
  const span = slots[8].x - slots[0].x;
  assert.ok(span <= 0.95 * 0.6 + 1e-9);
  close(span, 0.95 * 0.6);
});

test('paletteSlots: a single tile sits in the middle', () => {
  const { slots } = paletteSlots(1, L, W, { x: 0, z: 1 });
  assert.deepEqual(slots, [{ x: 0, z: W / 2 + 0.07 }]);
});

test('backAction per phase', () => {
  assert.equal(backAction('place', 'add'), 'undo');
  assert.equal(backAction('place', 'link'), 'undo');
  assert.equal(backAction('place', null), 'nothing');
  assert.equal(backAction('connect', 'link'), 'undo');
  assert.equal(backAction('connect', 'unlink'), 'undo');
  assert.equal(backAction('connect', 'add'), 'to-place'); // never removes assets while connecting
  assert.equal(backAction('connect', null), 'to-place');
  assert.equal(backAction('done', 'link'), 'to-connect');
  assert.equal(backAction('done', null), 'to-connect');
});
