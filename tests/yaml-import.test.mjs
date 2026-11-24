import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseScenario, importScenario, assetForType, splitEnd, layoutNodes } from '../yaml-import.js';
import { EnergySystem } from '../system.js';
import { insideTable } from '../manual.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const config = JSON.parse(read('assets/components.json'));
const schemas = JSON.parse(read('assets/illuminator-schemas.json'));
const table = { length: 1.6, width: 0.8 };

test('splitEnd: model.port', () => {
  assert.deepEqual(splitEnd('PV1.pv_gen'), { model: 'PV1', port: 'pv_gen' });
  assert.deepEqual(splitEnd('A.b.c'), { model: 'A', port: 'b.c' });
  assert.equal(splitEnd('nodot'), null);
  assert.equal(splitEnd('.x'), null);
  assert.equal(splitEnd(null), null);
});

test('assetForType: first asset of each Illuminator type', () => {
  const map = assetForType(config);
  assert.equal(map.get('PV'), 'PV-ground');
  assert.equal(map.get('Load'), 'Load-Residential');
  assert.equal(map.get('CSV'), undefined);
});

test('parseScenario: refuses text without models', () => {
  assert.throws(() => parseScenario('foo: 1'), /no "models"/);
  assert.throws(() => parseScenario('models: [oops'));
});

test('CSV readers and models without an asset are left out, with their connections', () => {
  const doc = parseScenario(`
scenario: { name: "Power balance" }
models:
- { name: CSVload, type: CSV }
- { name: Load1, type: Load, parameters: { houses: 5 } }
- { name: PV1, type: PV, parameters: { peak_power: 600 } }
- { name: Controller1, type: MysteryController }
connections:
- { from: CSVload.load, to: Load1.load }
- { from: PV1.pv_gen, to: Controller1.pv_gen }
- { from: Load1.load_dem, to: Nowhere.x }
`);
  const r = importScenario(doc, config, schemas, table);
  assert.equal(r.name, 'Power balance');
  assert.deepEqual(r.placed.map((p) => p.name), ['Load1', 'PV1']);
  assert.deepEqual(r.skipped.map((s) => s.name), ['CSVload', 'Controller1']);
  assert.equal(r.save.links.length, 0);
  assert.equal(r.droppedConnections.length, 3);
  assert.match(r.droppedConnections[2].reason, /no model "Nowhere"/);
  // YAML parameters win over the schema defaults.
  const pv = r.save.nodes.find((n) => n.name === 'PV1');
  assert.equal(pv.params.peak_power, 600);
  assert.equal(pv.type, 'PV-ground');
  assert.equal(r.save.nodes.find((n) => n.name === 'Load1').params.houses, 5);
});

test('every case in cases/index.json parses and loads', () => {
  const index = JSON.parse(read('cases/index.json'));
  assert.ok(index.cases.length >= 1);
  for (const c of index.cases) {
    const r = importScenario(parseScenario(read('cases/' + c.file)), config, schemas, table);
    assert.ok(r.save.nodes.length, c.id);
    const sys = new EnergySystem(config, schemas);
    assert.equal(sys.load(r.save).skipped.length, 0, c.id);
  }
});

test('hydrogen example: links keep the YAML ports, the pipeline becomes a hydrogen tube', () => {
  const doc = parseScenario(read('cases/hydrogen-example.yaml'));
  const r = importScenario(doc, config, schemas, table);
  assert.deepEqual(r.skipped.map((s) => s.name), ['CSV_pv']);
  const byName = new Map(r.save.nodes.map((n) => [n.name, n]));
  const link = (a, b) => r.save.links.find((l) => l.from === byName.get(a).id && l.to === byName.get(b).id);
  const pv = link('PV1', 'Electrolyzer1');
  assert.equal(pv.carrier, 'electricity');
  assert.equal(pv.fromPort, 'pv_gen');
  assert.equal(pv.toPort, 'desired_out');
  const pipe = link('Electrolyzer1', 'Storage1');
  assert.equal(pipe.carrier, 'hydrogen');
  assert.equal(pipe.model, 'Pipeline');
  assert.equal(pipe.name, 'Pipe1');
  assert.equal(pipe.params.L, 250);
  assert.equal(pipe.fromPort, 'h_gen');
  assert.equal(pipe.toPort, 'flow2h2storage');
  assert.equal(link('Storage1', 'Demand1').carrier, 'hydrogen');
  assert.equal(r.save.links.length, 5);
  // ids are unique over nodes and links
  const ids = [...r.save.nodes, ...r.save.links].map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a connection without a matching asset port pair is drawn as data', () => {
  const doc = parseScenario(`
models:
- { name: B, type: Battery }
- { name: S, type: H2Storage }
connections:
- { from: B.soc, to: S.flow2h2storage, time_shifted: True }
`);
  const r = importScenario(doc, config, schemas, table);
  assert.equal(r.save.links[0].carrier, 'data');
  assert.equal(r.save.links[0].timeShifted, true);
});

test('the import loads into EnergySystem with names and positions on the table', () => {
  const doc = parseScenario(read('cases/hydrogen-example.yaml'));
  const r = importScenario(doc, config, schemas, table);
  const sys = new EnergySystem(config, schemas);
  const res = sys.load(r.save);
  assert.equal(res.skipped.length, 0);
  assert.equal(res.nodes, r.save.nodes.length);
  assert.equal(res.links, r.save.links.length);
  for (const n of sys.nodes) assert.ok(insideTable(n.x, n.z, table.length, table.width), `${n.name} on the table`);
  assert.match(sys.labelOf(sys.nodes.find((n) => n.name === 'PV1')), /^PV1 \(/);
  // The YAML ports count as connected.
  const st = sys.portStatus(sys.nodes.find((n) => n.name === 'Electrolyzer1'));
  assert.ok(st.inputs.find((p) => p.name === 'desired_out').link);
});

test('layoutNodes: sources left of what they feed, far enough apart', () => {
  const nodes = [1, 2, 3, 4].map((id) => ({ id, x: 0, z: 0 }));
  const links = [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 1, timeShifted: true }];
  layoutNodes(nodes, links, table);
  assert.ok(nodes[0].x < nodes[1].x && nodes[1].x < nodes[2].x);
  assert.equal(nodes[3].x, nodes[0].x); // unconnected: first column
  for (const a of nodes) for (const b of nodes) {
    if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.1);
  }
});

test('layoutNodes: a cycle does not hang, a crowded column wraps', () => {
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, x: 0, z: 0 }));
  layoutNodes(nodes, [{ from: 1, to: 2 }, { from: 2, to: 1 }], table);
  for (const n of nodes) assert.ok(insideTable(n.x, n.z, table.length, table.width));
  const xs = new Set(nodes.map((n) => n.x));
  assert.ok(xs.size >= 3);
});

test('EV case: the ControllerEV avatar is placed and wired with the YAML ports', () => {
  const r = importScenario(parseScenario(read('cases/EV_scenario1.yaml')), config, schemas, table);
  const ctrl = r.save.nodes.find((n) => n.name === 'Controller1');
  assert.equal(ctrl.type, 'ControllerEV');
  const into = r.save.links.filter((l) => l.to === ctrl.id);
  assert.ok(into.some((l) => l.toPort === 'load_EV'));
  assert.ok(r.skipped.every((s) => s.type === 'CSV'));
});
