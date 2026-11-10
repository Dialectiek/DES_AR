import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { load as loadYaml } from '../vendor/js-yaml.mjs';
import {
  parseMonitorCsv, scenarioToScene, addDerivedColumns, valueAt, createPlayer, typeAssetKey, timeLabel,
} from '../scenario.js';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const types = JSON.parse(read('assets/illuminator-types.json'));
const library = JSON.parse(read('assets/library.json'));

function load(part) {
  const scenario = loadYaml(read(`assets/scenarios/power-balance-${part}/Tutorial_Power_Balance_${part}.yaml`));
  const csv = parseMonitorCsv(read(`assets/scenarios/power-balance-${part}/out_Tutorial_Power_Balance_${part}.csv`));
  const result = scenarioToScene(scenario, types, library, { columns: csv.columns });
  addDerivedColumns(result.derived, csv.columns);
  return { scenario, csv, result };
}

const ids = (result) => result.scene.items.map((i) => i.id).sort();
const flowKey = (f) => `${f.from}>${f.to}:${f.kind}`;

test('parseMonitorCsv: 95 rows of 15 minutes, date-only first row normalised', () => {
  const { csv } = load('a');
  assert.equal(csv.times.length, 95);
  assert.equal(csv.times[0], '2012-06-01 00:00:00');
  assert.equal(timeLabel(csv.times[1]), '2012-06-01 00:15');
  assert.equal(csv.stepSeconds, 900);
  assert.ok(Math.abs(csv.columns.get('PV1.pv_gen')[52] - 0.274) < 0.001);
});

test('scenario a: the drawn items, CSV readers hidden', () => {
  const { result } = load('a');
  assert.deepEqual(ids(result), [
    'Controller1', 'Load1#1', 'Load1#2', 'Load1#3', 'Load1#4', 'Load1#5', 'PV1', 'Wind1', 'grid',
  ].sort());
  assert.deepEqual(result.hiddenModels.sort(), ['CSV_pv', 'CSV_wind', 'CSVload']);
  assert.deepEqual(result.unknownTypes, []);
  assert.deepEqual(result.warnings, []);
});

test('scenario b: adds the battery with a level bound to its SOC', () => {
  const { result } = load('b');
  const bat = result.scene.items.find((i) => i.id === 'Battery1');
  assert.ok(bat);
  assert.equal(bat.asset, 'battery');
  assert.deepEqual(bat.level, { column: 'Battery1.soc', min: 0, max: 100 });
  assert.deepEqual(result.warnings, []);
});

test('flows follow the power connections, demand reversed, one per house', () => {
  const { result } = load('b');
  const keys = result.scene.flows.map(flowKey).sort();
  assert.deepEqual(keys, [
    'Controller1>Battery1:battery',
    'Controller1>Load1#1:meter:load', 'Controller1>Load1#2:meter:load', 'Controller1>Load1#3:meter:load',
    'Controller1>Load1#4:meter:load', 'Controller1>Load1#5:meter:load',
    'PV1>Controller1:solar',
    'Wind1>Controller1:wind',
    'grid>Controller1:import',
  ].sort());
  const houses = result.scene.flows.filter((f) => f.kind === 'load');
  assert.ok(houses.every((f) => f.series.column === 'Load1.load_dem' && Math.abs(f.series.scale - 0.2) < 1e-12));
  assert.equal(houses.filter((f) => f.showLabel).length, 1);
  assert.equal(houses.find((f) => f.showLabel).labelFactor, 5);
  assert.equal(result.scene.flows.find((f) => f.kind === 'battery').series.signed, true);
  // The soc → controller signal and the weather data are not energy flows.
  assert.ok(!result.scene.flows.some((f) => f.series.column === 'Battery1.soc'));
});

test('grid flow closes the balance: equals res_load (a) and -dump (b) on every row', () => {
  for (const [part, expected] of [['a', (c, i) => c.get('Controller1.res_load')[i]], ['b', (c, i) => -c.get('Controller1.dump')[i]]]) {
    const { csv } = load(part);
    const grid = csv.columns.get('Controller1.grid_import');
    assert.ok(grid, `derived grid column for ${part}`);
    for (let i = 0; i < grid.length; i++) {
      assert.ok(Math.abs(grid[i] - expected(csv.columns, i)) < 1e-9, `${part} row ${i}: ${grid[i]} vs ${expected(csv.columns, i)}`);
    }
  }
});

test('layout: items do not overlap and the ground holds them all', () => {
  const { result } = load('b');
  const size = (it) => library.assets[it.asset]?.size ?? [3, 3, 3];
  const boxes = result.scene.items.map((it) => {
    const [l, , w] = size(it);
    const q = Math.round(((it.rotation ?? 0) % 180) / 90) !== 0;
    const [fx, fz] = q ? [w, l] : [l, w];
    return { id: it.id, x0: it.x - fx / 2, x1: it.x + fx / 2, z0: it.z - fz / 2, z1: it.z + fz / 2 };
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.z0 < b.z1 - 1e-6 && b.z0 < a.z1 - 1e-6;
      assert.ok(!overlap, `${a.id} overlaps ${b.id}`);
    }
  }
  const { length, width } = result.scene.ground;
  for (const b of boxes) {
    assert.ok(b.x0 >= -length / 2 && b.x1 <= length / 2, `${b.id} inside the ground along x`);
    assert.ok(b.z0 >= -width / 2 && b.z1 <= width / 2, `${b.id} inside the ground along z`);
  }
  // Hub east of all houses, grid east of the hub.
  const x = (id) => result.scene.items.find((i) => i.id === id).x;
  assert.ok(result.scene.items.filter((i) => i.role === 'consumer').every((i) => i.x < x('Controller1')));
  assert.ok(x('grid') > x('Controller1'));
});

test('ar positions in the YAML override the layout', () => {
  const scenario = loadYaml(read('assets/scenarios/power-balance-a/Tutorial_Power_Balance_a.yaml'));
  scenario.models.find((m) => m.name === 'PV1').ar = { x: 1.5, z: -2, rotation: 90 };
  const result = scenarioToScene(scenario, types, library);
  const pv = result.scene.items.find((i) => i.id === 'PV1');
  assert.equal(pv.rotation, 90);
  assert.ok(pv.fixed);
});

test('unknown type: listed with its expected asset key, flows from its monitored outputs', () => {
  const scenario = {
    scenario: { name: 'x' },
    models: [
      { name: 'HP1', type: 'Heat_Pump', parameters: { cop: 3 } },
      { name: 'Controller1', type: 'Controller_T1' },
    ],
    connections: [{ from: 'HP1.p_el', to: 'Controller1.load_dem' }, { from: 'HP1.temp', to: 'Controller1.soc' }],
  };
  const columns = new Map([['HP1.p_el', new Float64Array([1, 2])]]);
  const result = scenarioToScene(scenario, types, library, { columns });
  assert.deepEqual(result.unknownTypes, [{ type: 'Heat_Pump', asset: 'heat-pump', models: ['HP1'] }]);
  assert.ok(result.missingAssets.some((a) => a.key === 'heat-pump'));
  assert.deepEqual(result.scene.flows.filter((f) => f.from === 'HP1').map((f) => f.series.column), ['HP1.p_el']);
  assert.equal(typeAssetKey('Controller_T1'), 'controller-t1');
});

test('missing CSV column: warning and the flow is marked missing', () => {
  const scenario = loadYaml(read('assets/scenarios/power-balance-a/Tutorial_Power_Balance_a.yaml'));
  const columns = new Map([['PV1.pv_gen', new Float64Array(3)], ['Load1.load_dem', new Float64Array(3)]]);
  const result = scenarioToScene(scenario, types, library, { columns });
  const wind = result.scene.flows.find((f) => f.kind === 'wind');
  assert.equal(wind.series.missing, true);
  assert.ok(result.warnings.some((w) => w.includes('Wind1.wind_gen')));
  assert.equal(result.scene.flows.find((f) => f.kind === 'import').series.missing, true);
});

test('valueAt interpolates and handles the ends', () => {
  const col = new Float64Array([0, 10, 20]);
  assert.equal(valueAt(col, 0.5), 5);
  assert.equal(valueAt(col, 2), 20);
  assert.equal(valueAt(col, 5), 20);
  assert.ok(Number.isNaN(valueAt(undefined, 1)));
});

test('player: speed, loop, seek, step, toggle', () => {
  const p = createPlayer({ steps: 5, stepSeconds: 900, speed: 1 }); // 1 h per s = 4 steps per s
  p.update(0.5);
  assert.equal(p.t, 2);
  p.update(0.75); // t = 5 → past the last row (4) → loops
  assert.equal(p.t, 1);
  p.seek(0.5);
  assert.equal(p.t, 2);
  p.step(-5);
  assert.equal(p.t, 0);
  assert.equal(p.toggle(), false);
  p.update(1);
  assert.equal(p.t, 0);
});
