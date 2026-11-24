import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLink, EnergySystem, colourForType, quarterTurn, snapToQuarter } from '../system.js';

const assets = {
  turbine: { label: 'Turbine', produces: ['electricity'], consumes: [], power_kW: 5 },
  car: { label: 'Car', produces: [], consumes: ['electricity'], power_kW: 7 },
  chp: { label: 'CHP', produces: ['electricity', 'heat'], consumes: [], power_kW: 10 },
  house: { label: 'House', produces: [], consumes: ['electricity', 'heat'], power_kW: 3 },
  battery: { label: 'Battery', produces: ['electricity'], consumes: ['electricity'], power_kW: 2 },
};
const config = {
  cards: { red: 'turbine', orange: 'car', yellow: 'chp', green: 'house', blue: null },
  assets,
};

test('resolveLink: producer → consumer, either click order', () => {
  assert.deepEqual(resolveLink(assets.turbine, assets.car), [{ carrier: 'electricity', forward: true }]);
  assert.deepEqual(resolveLink(assets.car, assets.turbine), [{ carrier: 'electricity', forward: false }]);
});

test('resolveLink: no shared carrier', () => {
  assert.deepEqual(resolveLink(assets.turbine, assets.chp), []);
  assert.deepEqual(resolveLink(assets.car, assets.house), []);
  assert.deepEqual(resolveLink(assets.car, null), []);
});

test('resolveLink: two carriers give two links', () => {
  assert.deepEqual(resolveLink(assets.chp, assets.house), [
    { carrier: 'electricity', forward: true },
    { carrier: 'heat', forward: true },
  ]);
});

test('resolveLink: both directions possible → first clicked is the source', () => {
  assert.deepEqual(resolveLink(assets.battery, assets.battery), [{ carrier: 'electricity', forward: true }]);
});

function build() {
  const sys = new EnergySystem(config);
  const [t, c, k, h, b] = sys.addCards([
    { colour: 'red', x: 0, z: 0 },
    { colour: 'orange', x: 0.2, z: 0 },
    { colour: 'yellow', x: 0.4, z: 0 },
    { colour: 'green', x: 0.6, z: 0 },
    { colour: 'blue', x: 0.8, z: 0 },
  ]);
  return { sys, t, c, k, h, b };
}

test('addCards maps colours to asset types', () => {
  const { sys, t, b } = build();
  assert.equal(t.type, 'turbine');
  assert.equal(b.type, null);
  assert.equal(sys.labelOf(b), 'blue card');
});

test('connect adds, toggles off, refuses', () => {
  const { sys, t, c, k, h, b } = build();
  let r = sys.connect(c.id, t.id);
  assert.equal(r.action, 'added');
  assert.deepEqual(r.links.map((l) => [l.carrier, l.from, l.to, l.power]), [['electricity', t.id, c.id, 5]]);

  r = sys.connect(t.id, c.id);
  assert.equal(r.action, 'removed');
  assert.equal(sys.links.length, 0);

  r = sys.connect(t.id, k.id);
  assert.equal(r.action, 'refused');
  assert.match(r.reason, /can't be connected/);

  r = sys.connect(t.id, b.id);
  assert.equal(r.action, 'refused');
  assert.match(r.reason, /blue card has no asset/);

  r = sys.connect(k.id, h.id);
  assert.equal(r.links.length, 2);
});

test('undo walks back links, unlinks and scans', () => {
  const { sys, t, c } = build();
  sys.connect(t.id, c.id);
  sys.connect(t.id, c.id); // removed again
  assert.equal(sys.undo(), 'restored the connection');
  assert.equal(sys.links.length, 1);
  assert.equal(sys.undo(), 'removed the last connection');
  assert.equal(sys.links.length, 0);
  assert.equal(sys.undo(), 'removed 5 assets');
  assert.equal(sys.nodes.length, 0);
  assert.equal(sys.undo(), null);
});

// Manual mode: assets added one by one by type, no cards.
test('addNode adds one asset of a type, undone one at a time', () => {
  const sys = new EnergySystem(config);
  const t = sys.addNode('turbine', 0.1, -0.2);
  const c = sys.addNode('car', -0.3, 0.1, 'orange');
  assert.deepEqual(t, { id: t.id, colour: null, type: 'turbine', x: 0.1, z: -0.2 });
  assert.equal(c.colour, 'orange');
  assert.equal(sys.labelOf(t), 'Turbine');
  assert.notEqual(t.id, c.id);
  assert.equal(sys.lastStepKind(), 'add');
  assert.equal(sys.undo(), 'removed 1 asset');
  assert.deepEqual(sys.nodes.map((n) => n.type), ['turbine']);
});

test('addNode refuses unknown asset types', () => {
  const sys = new EnergySystem(config);
  assert.throws(() => sys.addNode('rocket', 0, 0), /unknown asset "rocket"/);
  assert.equal(sys.nodes.length, 0);
  assert.equal(sys.lastStepKind(), null);
});

test('manual assets connect like scanned ones; lastStepKind follows the history', () => {
  const sys = new EnergySystem(config);
  const k = sys.addNode('chp', 0, 0);
  const h = sys.addNode('house', 0.3, 0);
  const c = sys.addNode('car', -0.3, 0);
  let r = sys.connect(h.id, k.id);
  assert.equal(r.action, 'added');
  assert.deepEqual(r.links.map((l) => [l.carrier, l.from, l.to]), [
    ['electricity', k.id, h.id],
    ['heat', k.id, h.id],
  ]);
  assert.equal(sys.lastStepKind(), 'link');
  r = sys.connect(c.id, h.id);
  assert.equal(r.action, 'refused');
  assert.match(r.reason, /Car and House can't be connected/);
  assert.equal(sys.lastStepKind(), 'link'); // a refusal is not a step
  sys.connect(k.id, h.id);
  assert.equal(sys.lastStepKind(), 'unlink');
  sys.undo();
  sys.undo();
  assert.equal(sys.lastStepKind(), 'add');
  assert.equal(sys.links.length, 0);
});

test('colourForType: the card colour mapped to an asset, or null', () => {
  assert.equal(colourForType(config, 'car'), 'orange');
  assert.equal(colourForType(config, 'battery'), null);
  assert.equal(colourForType({}, 'car'), null);
});

test('moveNode is one undoable step; dragNode moves without a step', () => {
  const sys = new EnergySystem(config);
  const t = sys.addNode('turbine', 0.1, -0.2);
  sys.dragNode(t.id, 0.15, -0.1);
  sys.dragNode(t.id, 0.2, 0.05);
  assert.equal(sys.lastStepKind(), 'add'); // dragging leaves no steps
  assert.equal(sys.moveNode(t.id, 0.25, 0.05, { x: 0.1, z: -0.2 }), true);
  assert.deepEqual([t.x, t.z], [0.25, 0.05]);
  assert.equal(sys.lastStepKind(), 'move');
  assert.equal(sys.undo(), 'moved the Turbine back');
  assert.deepEqual([t.x, t.z], [0.1, -0.2]);
  assert.equal(sys.lastStepKind(), 'add');
});

test('moveNode: no step when the asset ends where it started, or is missing', () => {
  const sys = new EnergySystem(config);
  const t = sys.addNode('turbine', 0.1, -0.2);
  sys.dragNode(t.id, 0.3, 0.3);
  assert.equal(sys.moveNode(t.id, 0.1, -0.2, { x: 0.1, z: -0.2 }), false);
  assert.deepEqual([t.x, t.z], [0.1, -0.2]);
  assert.equal(sys.lastStepKind(), 'add');
  assert.equal(sys.moveNode(999, 0, 0), false);
  assert.equal(sys.dragNode(999, 0, 0), null);
});

test('undo of a move whose asset was undone meanwhile is harmless', () => {
  const sys = new EnergySystem(config);
  const t = sys.addNode('turbine', 0, 0);
  sys.moveNode(t.id, 0.2, 0);
  sys.nodes = []; // as if removed by something else
  assert.equal(sys.undo(), 'nothing to move back');
});

test('quarterTurn: 90° steps, kept in (-π, π]', () => {
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
  close(quarterTurn(0), Math.PI / 2);
  close(quarterTurn(Math.PI / 2), Math.PI);
  close(quarterTurn(Math.PI), -Math.PI / 2);
  close(quarterTurn(0, -1), -Math.PI / 2);
  close(quarterTurn(-Math.PI / 2, -1), Math.PI);
  close(quarterTurn(undefined), Math.PI / 2);
  close(quarterTurn(0.3), 0.3 + Math.PI / 2); // a free angle keeps its offset
  let y = 0.3;
  for (let i = 0; i < 4; i++) y = quarterTurn(y);
  close(y, 0.3); // four turns = back where it was
});

test('moveNode with a yaw: a turn in place is one step, undone as a turn', () => {
  const sys = new EnergySystem(config);
  const t = sys.addNode('turbine', 0.1, -0.2);
  t.yaw = 0; // the scene sets it when the asset appears
  sys.dragNode(t.id, 0.1, -0.2, Math.PI / 2);
  assert.equal(t.yaw, Math.PI / 2);
  assert.equal(sys.moveNode(t.id, 0.1, -0.2, { x: 0.1, z: -0.2, yaw: 0 }, Math.PI / 2), true);
  assert.equal(sys.undo(), 'turned the Turbine back');
  assert.equal(t.yaw, 0);
  // moved and turned: undo restores both
  sys.moveNode(t.id, 0.3, 0, null, Math.PI);
  assert.equal(sys.undo(), 'moved the Turbine back');
  assert.deepEqual([t.x, t.z, t.yaw], [0.1, -0.2, 0]);
  // same place, same yaw: no step
  assert.equal(sys.moveNode(t.id, 0.1, -0.2, null, 0), false);
});

test('snapToQuarter: the nearest of 0, ±90°, 180°', () => {
  assert.equal(snapToQuarter(0.2), 0);
  assert.equal(snapToQuarter(1.2), Math.PI / 2);
  assert.equal(snapToQuarter(-1.2), -Math.PI / 2);
  assert.equal(snapToQuarter(3.0), Math.PI);
  assert.equal(snapToQuarter(-3.0), Math.PI);
  assert.equal(snapToQuarter(7.0), 0); // 7 rad ≈ 401° → 0
  assert.equal(snapToQuarter(), 0);
});

test('planConnect says what connect would do, and changes nothing', () => {
  const sys = new EnergySystem(config);
  const t = sys.addNode('turbine', 0, 0);
  const c = sys.addNode('car', 0.2, 0);
  const t2 = sys.addNode('turbine', 0.4, 0);
  const before = JSON.stringify([sys.links, sys.history, sys.nextId]);
  const plan = sys.planConnect(t.id, c.id);
  assert.equal(plan.action, 'add');
  assert.deepEqual(plan.links.map((l) => [l.carrier, l.from, l.to]), [['electricity', t.id, c.id]]);
  assert.equal(plan.links[0].id, undefined);
  assert.equal(sys.planConnect(t.id, t2.id).action, 'refused');
  assert.match(sys.planConnect(t.id, t2.id).reason, /can't be connected/);
  assert.equal(sys.planConnect(t.id, t.id).action, 'refused');
  assert.equal(JSON.stringify([sys.links, sys.history, sys.nextId]), before);
  sys.connect(t.id, c.id);
  assert.equal(sys.planConnect(c.id, t.id).action, 'remove');
});
