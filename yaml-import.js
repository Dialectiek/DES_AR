// YAML mode: an Illuminator scenario YAML becomes an energy system on the table, built
// from the assets we already have. Pure logic (no three.js), so it runs in Node tests.
//
// Every model in the YAML's `models` list becomes a node whose asset is the first asset in
// components.json with that "illuminator" type (PV → PV-ground, Load → Load-Residential, …).
// The node keeps the YAML name (node.name) and its parameters: the schema defaults with the
// YAML's own values on top.
//
// Every `connections` entry ("from: A.out, to: B.in") becomes a link with exactly those
// ports (fromPort / toPort), so nothing is guessed: the carrier only decides how the link
// is drawn (electricity, hydrogen, … when the two assets share one in that direction,
// otherwise data). `time_shifted: True` is kept as link.timeShifted.
//
// A model whose type is a link carrier's model (Pipeline → the hydrogen tube) is not an
// asset: its incoming and outgoing connections join into one hydrogen link between the
// assets on either side, carrying the pipeline's name and parameters.
//
// Models with no asset (CSV data readers, controllers we have no model for yet) are left
// out, together with their connections; the result lists them so the app can say so.
//
// The result is in the save format of EnergySystem (system.js), so the app loads it with
// sys.load() and the user can then edit it as in manual mode.

import { load as parseYaml } from './vendor/js-yaml.mjs';
import { indexSchemas, defaultParameters } from './schema.js';
import { resolveLink, SAVE_FORMAT } from './system.js';

// Text → the parsed scenario. Throws when it is not YAML or has no `models` list.
export function parseScenario(text) {
  const doc = parseYaml(text);
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.models)) {
    throw new Error('not an Illuminator scenario (no "models" list)');
  }
  return doc;
}

// Illuminator model type → asset key: the first asset in components.json with that type.
export function assetForType(config) {
  const map = new Map();
  for (const [key, def] of Object.entries(config?.assets ?? {})) {
    if (def?.illuminator && !map.has(def.illuminator)) map.set(def.illuminator, key);
  }
  return map;
}

// "Model.port" → { model, port } (the port may itself contain dots), or null.
export function splitEnd(s) {
  if (typeof s !== 'string') return null;
  const i = s.indexOf('.');
  if (i <= 0 || i === s.length - 1) return null;
  return { model: s.slice(0, i).trim(), port: s.slice(i + 1).trim() };
}

const truthy = (v) => v === true || (typeof v === 'string' && /^true$/i.test(v));

// doc: parseScenario() result. config: components.json, schemas: illuminator-schemas.json.
// table: { length, width } in metres (the layout fits inside it).
// Returns { save, name, placed: [{ name, type, asset }], skipped: [{ name, type, reason }],
//           droppedConnections: [{ from, to, reason }] }.
export function importScenario(doc, config, schemas, table) {
  const index = indexSchemas(schemas);
  const byType = assetForType(config);
  const linkCarrier = new Map(); // model type → carrier drawn for it (Pipeline → hydrogen)
  for (const [carrier, def] of Object.entries(config?.carriers ?? {})) {
    if (def?.illuminator) linkCarrier.set(def.illuminator, carrier);
  }

  const nodes = [], skipped = [], placed = [];
  const nodeByName = new Map();
  const pipes = new Map(); // name → { type, carrier, params }
  let nextId = 1;
  for (const m of doc.models ?? []) {
    const name = m?.name != null ? String(m.name) : null;
    const type = m?.type != null ? String(m.type) : null;
    if (!name || !type) {
      skipped.push({ name: name ?? '?', type: type ?? '?', reason: 'no name or type' });
      continue;
    }
    if (nodeByName.has(name) || pipes.has(name)) {
      skipped.push({ name, type, reason: 'the name is used twice' });
      continue;
    }
    const yamlParams = m.parameters && typeof m.parameters === 'object' ? m.parameters : {};
    if (linkCarrier.has(type)) {
      pipes.set(name, { type, carrier: linkCarrier.get(type), params: { ...defaultParameters(index.get(type)), ...yamlParams } });
      continue;
    }
    const asset = byType.get(type);
    if (!asset) {
      skipped.push({ name, type, reason: type === 'CSV' ? 'data file (not drawn)' : 'no asset for this type yet' });
      continue;
    }
    const node = { id: nextId++, colour: null, type: asset, x: 0, z: 0, name };
    node.params = { ...defaultParameters(index.get(type)), ...yamlParams };
    nodes.push(node);
    nodeByName.set(name, node);
    placed.push({ name, type, asset });
  }

  // Connections, with pipelines joined into one link.
  const dropped = [];
  const direct = [];
  const pipeIn = new Map(), pipeOut = new Map(); // pipe name → [{ node, port, from, to }]
  for (const c of doc.connections ?? []) {
    const from = splitEnd(c?.from), to = splitEnd(c?.to);
    const label = { from: c?.from ?? '?', to: c?.to ?? '?' };
    if (!from || !to) {
      dropped.push({ ...label, reason: 'not "model.port"' });
      continue;
    }
    const a = nodeByName.get(from.model), b = nodeByName.get(to.model);
    const timeShifted = truthy(c.time_shifted);
    if (pipes.has(to.model) && a) {
      if (!pipeIn.has(to.model)) pipeIn.set(to.model, []);
      pipeIn.get(to.model).push({ node: a, port: from.port, pipePort: to.port, timeShifted, ...label });
    } else if (pipes.has(from.model) && b) {
      if (!pipeOut.has(from.model)) pipeOut.set(from.model, []);
      pipeOut.get(from.model).push({ node: b, port: to.port, pipePort: from.port, timeShifted, ...label });
    } else if (a && b) {
      direct.push({ a, b, fromPort: from.port, toPort: to.port, timeShifted });
    } else {
      const missing = !a ? from.model : to.model;
      const why = skipped.find((s) => s.name === missing);
      dropped.push({ ...label, reason: why ? `${missing} is left out (${why.reason})` : `no model "${missing}"` });
    }
  }

  const links = [];
  const carrierFor = (a, b) => {
    const defA = config.assets[a.type], defB = config.assets[b.type];
    const options = resolveLink(defA, defB).filter((o) => o.forward && o.carrier !== 'data');
    return options[0]?.carrier ?? 'data';
  };
  for (const d of direct) {
    const link = {
      id: 0, carrier: carrierFor(d.a, d.b), from: d.a.id, to: d.b.id,
      power: config.assets[d.a.type]?.power_kW ?? 1, fromPort: d.fromPort, toPort: d.toPort,
    };
    if (d.timeShifted) link.timeShifted = true;
    links.push(link);
  }
  for (const [name, pipe] of pipes) {
    const ins = pipeIn.get(name) ?? [], outs = pipeOut.get(name) ?? [];
    if (!ins.length || !outs.length) {
      for (const e of [...ins, ...outs]) dropped.push({ from: e.from, to: e.to, reason: `${name} has no asset on its other end` });
      if (!ins.length && !outs.length) skipped.push({ name, type: pipe.type, reason: 'not connected to any asset' });
      continue;
    }
    // One link per (incoming, outgoing) pair; normally a pipe has one of each.
    const n = Math.max(ins.length, outs.length);
    for (let i = 0; i < n; i++) {
      const src = ins[Math.min(i, ins.length - 1)], dst = outs[Math.min(i, outs.length - 1)];
      const link = {
        id: 0, carrier: pipe.carrier, from: src.node.id, to: dst.node.id,
        power: config.assets[src.node.type]?.power_kW ?? 1, fromPort: src.port, toPort: dst.port,
        model: pipe.type, params: pipe.params, name,
      };
      if (src.timeShifted || dst.timeShifted) link.timeShifted = true;
      links.push(link);
    }
  }
  for (const l of links) l.id = nextId++;

  layoutNodes(nodes, links, table);
  return {
    save: { format: SAVE_FORMAT, version: 1, nodes, links },
    name: doc.scenario?.name != null ? String(doc.scenario.name) : null,
    placed,
    skipped,
    droppedConnections: dropped,
  };
}

// Places the nodes in columns along the table's length, in the direction of the flows:
// a node's column is the longest chain of (not time-shifted) links leading to it, so
// sources sit on the left (-X) and what they feed on the right. Within a column, nodes are
// spread across the width in YAML order. A column with too many nodes for the width wraps
// into extra columns. Sets node.x / node.z (table-local metres) in place.
export function layoutNodes(nodes, links, table, { margin = 0.12, minRow = 0.11 } = {}) {
  if (!nodes.length) return nodes;
  const L = Math.max(0.2, (table?.length ?? 1.6) - 2 * margin);
  const W = Math.max(0.1, (table?.width ?? 0.8) - 2 * margin);
  const level = new Map(nodes.map((n) => [n.id, 0]));
  const edges = links.filter((l) => !l.timeShifted && l.from !== l.to);
  // Longest path, at most nodes.length rounds (stops on cycles).
  for (let round = 0; round < nodes.length; round++) {
    let changed = false;
    for (const e of edges) {
      const want = level.get(e.from) + 1;
      if (want > level.get(e.to) && want < nodes.length) {
        level.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const perColumn = Math.max(1, Math.floor(W / minRow) + 1);
  const columns = [];
  const levels = [...new Set(level.values())].sort((a, b) => a - b);
  for (const lv of levels) {
    const members = nodes.filter((n) => level.get(n.id) === lv);
    for (let i = 0; i < members.length; i += perColumn) columns.push(members.slice(i, i + perColumn));
  }
  const nc = columns.length;
  columns.forEach((col, ci) => {
    const x = nc > 1 ? -L / 2 + (L * ci) / (nc - 1) : 0;
    col.forEach((n, ri) => {
      n.x = round3(x);
      n.z = round3(col.length > 1 ? -W / 2 + (W * ri) / (col.length - 1) : 0);
    });
  });
  return nodes;
}

const round3 = (v) => Math.round(v * 1000) / 1000 + 0; // + 0 turns -0 into 0
