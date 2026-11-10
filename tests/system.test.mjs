import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLink, EnergySystem, colourForType } from '../system.js';

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
