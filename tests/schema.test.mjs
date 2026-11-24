import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexSchemas, modelOf, portsOfModel, defaultParameters, pickPorts, portArrowLayout, formatValue, modelRows } from '../schema.js';
import { EnergySystem } from '../system.js';

const schemas = JSON.parse(readFileSync(new URL('../assets/illuminator-schemas.json', import.meta.url)));
const components = JSON.parse(readFileSync(new URL('../assets/components.json', import.meta.url)));
const index = indexSchemas(schemas);

test('every asset with an "illuminator" type has a schema entry', () => {
  for (const [key, def] of Object.entries(components.assets)) {
    if (!def.illuminator) continue;
    assert.ok(modelOf(index, def), `${key}: no schema for Illuminator model "${def.illuminator}"`);
  }
});

test('portsOfModel: inputs and outputs in schema order; Collector is dynamic', () => {
  const pv = portsOfModel(index.get('PV'));
  assert.deepEqual(pv.outputs, Object.keys(index.get('PV').outputs));
  assert.ok(pv.outputs.includes('pv_gen'));
  assert.equal(pv.inputs.length, Object.keys(index.get('PV').inputs).length);
  assert.equal(pv.dynamic, false);
  assert.equal(portsOfModel(index.get('Collector')).dynamic, true);
  assert.equal(portsOfModel(null), null);
});

test('defaultParameters: a copy of the defaults', () => {
  const p = defaultParameters(index.get('Battery'));
  assert.deepEqual(Object.keys(p), Object.keys(index.get('Battery').parameters));
  const first = Object.keys(p)[0];
  p[first] = 'changed';
  assert.notEqual(defaultParameters(index.get('Battery'))[first], 'changed');
});

test('pickPorts: same-name pair first, otherwise the first free ones', () => {
  const ctrl = { inputs: ['soc'], outputs: ['dump', 'flow2b'], dynamic: false };
  const bat = { inputs: ['flow2b'], outputs: ['p_out', 'soc'], dynamic: false };
  assert.deepEqual(pickPorts(ctrl, bat), { ok: true, fromPort: 'flow2b', toPort: 'flow2b' });
  assert.deepEqual(pickPorts(bat, ctrl), { ok: true, fromPort: 'soc', toPort: 'soc' });
  const load = { inputs: ['load'], outputs: ['load_dem'], dynamic: false };
  assert.deepEqual(pickPorts(bat, load), { ok: true, fromPort: 'p_out', toPort: 'load' });
  assert.deepEqual(pickPorts(bat, load, ['p_out']), { ok: true, fromPort: 'soc', toPort: 'load' });
});

test('pickPorts: a port name that fits the carrier beats the first free one', () => {
  const pv = { inputs: [], outputs: ['g_aoi', 'pv_gen', 'total_irr'], dynamic: false };
  const el = { inputs: [], outputs: ['h_gen', 'power_consumption'], dynamic: false };
  const pipe = { inputs: ['flow_in', 'pressure_in'], outputs: ['flow_out'], dynamic: false };
  assert.equal(pickPorts(pv, null, [], [], 'electricity').fromPort, 'pv_gen');
  assert.equal(pickPorts(pv, null).fromPort, 'g_aoi');
  assert.deepEqual(pickPorts(el, pipe, [], [], 'hydrogen'), { ok: true, fromPort: 'h_gen', toPort: 'flow_in' });
});

test('pickPorts: refuses when one side is full or has no ports of that kind', () => {
  const grid = { inputs: ['dump'], outputs: [], dynamic: false };
  const load = { inputs: ['load'], outputs: ['load_dem'], dynamic: false };
  assert.deepEqual(pickPorts(grid, load), { ok: false, side: 'from', reason: 'it has no outputs' });
  assert.deepEqual(pickPorts(load, grid, [], ['dump']), { ok: false, side: 'to', reason: 'its only input is connected already' });
});

test('pickPorts: dynamic models and assets without a schema take anything', () => {
  const coll = { inputs: ['file_index'], outputs: [], dynamic: true };
  const pv = { inputs: [], outputs: ['pv_gen'], dynamic: false };
  assert.deepEqual(pickPorts(pv, coll, [], ['pv_gen', 'x']), { ok: true, fromPort: 'pv_gen', toPort: 'pv_gen' });
  assert.deepEqual(pickPorts(null, null), { ok: true, fromPort: null, toPort: null });
  assert.deepEqual(pickPorts(pv, null), { ok: true, fromPort: 'pv_gen', toPort: null });
});

test('portArrowLayout: inputs on the left pointing in, outputs on the right pointing out', () => {
  const l = portArrowLayout(3, 2, 0.05);
  assert.equal(l.filter((p) => p.side === 'in').length, 3);
  assert.equal(l.filter((p) => p.side === 'out').length, 2);
  for (const p of l) {
    assert.ok(Math.abs(Math.hypot(p.x, p.z) - 0.05) < 1e-9);
    const dir = [Math.cos(p.angle), -Math.sin(p.angle)];
    const radial = (dir[0] * p.x + dir[1] * p.z) / 0.05;
    if (p.side === 'in') { assert.ok(p.x < 0); assert.ok(radial < -0.99); }
    else { assert.ok(p.x > 0); assert.ok(radial > 0.99); }
  }
  assert.deepEqual(portArrowLayout(0, 0, 0.05), []);
});

test('formatValue: Python-like short text', () => {
  assert.equal(formatValue(null), 'None');
  assert.equal(formatValue(true), 'True');
  assert.equal(formatValue(0.123456), '0.1235');
  assert.equal(formatValue(10), '10');
  assert.equal(formatValue([1, 2]), '[1,2]');
});

// The real catalogue: ports from the docs limit the connections.
function sys() {
  return new EnergySystem(components, schemas);
}

test('nodes get their own copy of the model parameters', () => {
  const s = sys();
  const a = s.addNode('Battery-home', 0, 0);
  const b = s.addNode('Battery-home', 0.2, 0);
  assert.deepEqual(Object.keys(a.params), Object.keys(index.get('Battery').parameters));
  assert.notEqual(a.params, b.params);
  assert.equal(s.addNode('house-pv', 0.4, 0).params, undefined); // no Illuminator model
});

test('links record their ports; a model takes no more links than it has ports', () => {
  const s = sys();
  const pv = s.addNode('PV-ground', 0, 0);
  const grid = s.addNode('GridConnection', 0.2, 0);
  const grid2 = s.addNode('GridConnection', 0.4, 0);
  const r = s.connect(pv.id, grid.id);
  assert.equal(r.action, 'added');
  assert.equal(r.links[0].fromPort, 'pv_gen'); // not g_aoi, which comes first alphabetically
  assert.equal(r.links[0].toPort, 'dump');
  // GridConnection has a single input: a second PV can't feed the same grid.
  const pv2 = s.addNode('PV-ground', 0, 0.2);
  const full = s.connect(pv2.id, grid.id);
  assert.equal(full.action, 'refused');
  assert.match(full.reason, /Grid connection: its only input is connected already/);
  // …but it can feed the other grid; disconnecting the first PV frees the port again.
  assert.equal(s.connect(pv2.id, grid2.id).action, 'added');
  s.undo();
  assert.equal(s.connect(pv.id, grid.id).action, 'removed');
  assert.equal(s.connect(pv2.id, grid.id).action, 'added');
});

test('GridConnection has no outputs, so it cannot supply a load', () => {
  const s = sys();
  const grid = s.addNode('GridConnection', 0, 0);
  const load = s.addNode('Load-Office', 0.2, 0);
  const r = s.connect(grid.id, load.id);
  assert.equal(r.action, 'refused');
  assert.match(r.reason, /no outputs/);
});

test('portStatus and openPorts follow the links', () => {
  const s = sys();
  const pv = s.addNode('PV-ground', 0, 0);
  const grid = s.addNode('GridConnection', 0.2, 0);
  const pvPorts = portsOfModel(index.get('PV'));
  assert.equal(s.portStatus(pv).open, pvPorts.inputs.length + pvPorts.outputs.length);
  const before = s.openPorts().length;
  s.connect(pv.id, grid.id);
  assert.equal(s.openPorts().length, before - 2);
  const st = s.portStatus(grid);
  assert.equal(st.inputs[0].link.from, pv.id);
  assert.equal(st.open, 0);
  assert.equal(s.portStatus(s.addNode('house-pv', 0.4, 0)), null);
});

test('a hydrogen link is an Illuminator Pipeline with its own parameters', () => {
  const s = sys();
  const el = s.addNode('Electrolyzer', 0, 0);
  const st = s.addNode('H2Storage', 0.2, 0);
  const st2 = s.addNode('H2Storage', 0.4, 0);
  const r = s.connect(el.id, st.id);
  assert.equal(r.action, 'added', r.reason);
  const h2 = r.links.find((l) => l.carrier === 'hydrogen');
  assert.equal(h2.model, 'Pipeline');
  assert.deepEqual(h2.params, defaultParameters(index.get('Pipeline')));
  const other = s.connect(el.id, st2.id).links?.find((l) => l.carrier === 'hydrogen');
  if (other) assert.notEqual(other.params, h2.params); // each pipe has its own copy
  // Other carriers stay plain links.
  const pv = s.addNode('PV-ground', 0, 0.2);
  const grid = s.addNode('GridConnection', 0.2, 0.2);
  const e = s.connect(pv.id, grid.id).links[0];
  assert.equal(e.model, undefined);
  // The info panel says the link is a pipeline.
  const rows = modelRows({ def: s.assetOf(st), model: s.modelOf(st), status: s.portStatus(st), nameOf: (id) => s.labelOf(s.node(id)) }).ports;
  assert.ok(rows.some((row) => /\(Pipeline\)$/.test(row.value ?? '')), JSON.stringify(rows));
});

test('the Collector takes any number of links', () => {
  const s = sys();
  const coll = s.addNode('Collector', 0, 0);
  for (let i = 0; i < 3; i++) {
    const pv = s.addNode('PV-ground', 0.1 * (i + 1), 0.2);
    const r = s.connect(pv.id, coll.id);
    assert.equal(r.action, 'added', r.reason);
    assert.equal(r.links[0].carrier, 'data');
  }
  assert.equal(s.portStatus(coll).extraIn.length, 3);
  assert.equal(s.portStatus(coll).open, 0);
});
