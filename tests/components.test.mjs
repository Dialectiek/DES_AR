// Checks assets/components.json: models on disk, palette pages, carriers, and that the
// Illuminator components connect the way their carriers say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveLink } from '../system.js';
import { paletteGroups } from '../manual.js';

const root = new URL('../', import.meta.url);
const config = JSON.parse(fs.readFileSync(new URL('assets/components.json', root), 'utf8'));
const { assets, carriers } = config;

// Pipeline is left out on purpose: a hydrogen connection is drawn as a tube (cables.js),
// not placed as an asset.
const ILLUMINATOR_TYPES = [
  'Collector', 'GridConnection', 'PV', 'Wind', 'Load', 'LoadEV', 'LoadHeatpump', 'EV', 'Battery',
  'H2Buffer', 'Electrolyzer', 'ZZE', 'Thermolyzer', 'Compressor', 'H2demand',
  'H2Storage', 'H2Valve', 'H2Joint', 'H2Controller', 'H2PSA',
];

test('every asset model file exists', () => {
  for (const [key, def] of Object.entries(assets)) {
    assert.ok(def.model, `${key} has a model`);
    assert.ok(fs.existsSync(new URL(def.model, root)), `${key}: ${def.model} is missing`);
  }
});

test('asset groups and carriers are known', () => {
  const groups = new Set(config.paletteGroups.map((g) => g.key));
  for (const [key, def] of Object.entries(assets)) {
    if (def.group !== undefined) assert.ok(groups.has(def.group), `${key}: unknown group "${def.group}"`);
    for (const c of [...(def.produces ?? []), ...(def.consumes ?? [])]) {
      assert.ok(carriers[c], `${key}: unknown carrier "${c}"`);
    }
  }
});

test('every Illuminator component type has at least one asset', () => {
  const covered = new Set(Object.values(assets).map((d) => d.illuminator).filter(Boolean));
  for (const t of ILLUMINATOR_TYPES) assert.ok(covered.has(t), `no asset for ${t}`);
});

test('palette pages: in order, none too long for one table edge', () => {
  const pages = paletteGroups(config);
  assert.deepEqual(pages.map((p) => p.key), ['electricity', 'loads', 'hydrogen', 'pipes', 'controllers', 'other']);
  // Every asset is on one page, except those marked "palette": false.
  const onPalette = Object.keys(assets).filter((k) => assets[k].palette !== false);
  assert.equal(pages.reduce((n, p) => n + p.types.length, 0), onPalette.length);
  assert.deepEqual(pages.at(-1).types, ['office-pv', 'banana-car']);
  for (const p of pages) assert.ok(p.types.length <= 12, `${p.key} has ${p.types.length} assets`);
  // Every Illuminator controller is on the Controllers page.
  const controllers = pages.find((p) => p.key === 'controllers').types;
  assert.ok(controllers.includes('Controller_T1') && controllers.includes('ControllerEV') && controllers.includes('H2Controller'));
});

test('Illuminator components connect through their carriers', () => {
  const link = (a, b) => resolveLink(assets[a], assets[b]);
  assert.deepEqual(link('PV-ground', 'Load-Residential'), [{ carrier: 'electricity', forward: true }]);
  assert.deepEqual(link('Wind-small', 'Electrolyzer'), [{ carrier: 'electricity', forward: true }]);
  assert.deepEqual(link('Electrolyzer', 'Compressor'), [{ carrier: 'hydrogen', forward: true }]);
  assert.deepEqual(link('Compressor', 'H2Storage'), [{ carrier: 'hydrogen', forward: true }]);
  assert.deepEqual(link('H2Valve', 'H2Joint'), [{ carrier: 'hydrogen', forward: true }]);
  assert.deepEqual(link('H2Storage', 'H2demand-station'), [{ carrier: 'hydrogen', forward: true }]);
  // Data goes to the collector and the controller.
  assert.deepEqual(link('Collector', 'Battery-home'), [{ carrier: 'data', forward: false }]);
  assert.deepEqual(link('H2Storage', 'H2Controller'), [{ carrier: 'data', forward: true }]);
  // Nothing to connect between two consumers of different carriers.
  assert.deepEqual(link('Load-Office', 'H2demand-industry'), []);
});
