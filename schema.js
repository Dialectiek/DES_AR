// Illuminator model schemas: what each asset is in Illuminator, with its inputs,
// outputs, parameters and states. Pure logic (no three.js), so it runs in Node tests.
//
// The data is assets/illuminator-schemas.json, made by tools/illuminator-schemas.cjs from
// the Illuminator docs (refresh it with
//   node tools/illuminator-schemas.cjs --fill-from-source --out assets/illuminator-schemas.json).
// An asset in components.json points to its model with "illuminator": "<model name>".
//
// Ports: every input and output of the model is a port. A connection on the table goes from
// one free output to one free input (mosaik's `connect(A.out, B.in)`), so a model takes at
// most as many connections as the schema has ports. Models whose ports are built at run
// time (the Collector, the CSV reader) are "dynamic": they take any number.

export const SCHEMAS_URL = 'assets/illuminator-schemas.json';

// Map(model name → schema entry). schemas: the parsed illuminator-schemas.json (or null).
export function indexSchemas(schemas) {
  const byName = new Map();
  for (const m of Object.values(schemas?.models ?? {})) {
    if (m?.name && !byName.has(m.name)) byName.set(m.name, m);
  }
  return byName;
}

// The schema entry an asset definition (components.json) stands for, or null.
export function modelOf(index, def) {
  return def?.illuminator ? index.get(def.illuminator) ?? null : null;
}

// Ports derived from a schema entry, or null when there is no entry.
// { model, category, inputs: [name], outputs: [name], dynamic }
export function portsOfModel(model) {
  if (!model) return null;
  const dynamic = (model.notes ?? []).some((n) => /built dynamically/i.test(n));
  return {
    model: model.name,
    category: model.categories?.[0] ?? '',
    inputs: Object.keys(model.inputs ?? {}),
    outputs: Object.keys(model.outputs ?? {}),
    dynamic,
  };
}

// The model's parameters as { name: default value }, copied so a node can change its own.
export function defaultParameters(model) {
  const out = {};
  for (const [k, v] of Object.entries(model?.parameters ?? {})) out[k] = clone(v.default);
  return out;
}

const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

// Port names that most likely carry a carrier, for when nothing else decides. The docs list
// ports alphabetically, so "the first free one" alone would wire PV.g_aoi instead of PV.pv_gen.
export const CARRIER_PORT_HINTS = {
  electricity: /gen|p_out|power|dump|load|dem|flow2b|consumption/i,
  hydrogen: /h2|h_gen|flow/i,
  heat: /heat|hp|load/i,
};

// Which output of `from` and which input of `to` a new connection uses.
// fromPorts / toPorts: portsOfModel() results, or null for an asset without a schema
// (no limit, no port names). usedOut / usedIn: port names already taken on each side.
// Prefers an output and an input with the same name (Illuminator's own convention, e.g.
// Controller.flow2b → Battery.flow2b); otherwise the first free one of each.
// Then a port whose name fits the carrier (CARRIER_PORT_HINTS), then the first free one.
// A dynamic side takes the other side's port name.
// Returns { ok: true, fromPort, toPort } or { ok: false, side: 'from' | 'to', reason }.
export function pickPorts(fromPorts, toPorts, usedOut = [], usedIn = [], carrier = null) {
  const freeOut = fromPorts && !fromPorts.dynamic ? fromPorts.outputs.filter((p) => !usedOut.includes(p)) : null;
  const freeIn = toPorts && !toPorts.dynamic ? toPorts.inputs.filter((p) => !usedIn.includes(p)) : null;
  if (freeOut && !freeOut.length) {
    const n = fromPorts.outputs.length;
    return { ok: false, side: 'from', reason: full(n, 'output') };
  }
  if (freeIn && !freeIn.length) {
    const n = toPorts.inputs.length;
    return { ok: false, side: 'to', reason: full(n, 'input') };
  }
  const hint = CARRIER_PORT_HINTS[carrier];
  const best = (free) => (free ? (hint && free.find((p) => hint.test(p))) ?? free[0] : null);
  let fromPort = best(freeOut);
  let toPort = best(freeIn);
  if (freeOut && freeIn) {
    const same = freeOut.find((p) => freeIn.includes(p));
    if (same) fromPort = toPort = same;
  }
  if (!freeOut && fromPorts?.dynamic) fromPort = toPort;
  if (!freeIn && toPorts?.dynamic) toPort = fromPort;
  return { ok: true, fromPort, toPort };
}

const full = (n, word) => (!n ? `it has no ${word}s` : n === 1 ? `its only ${word} is connected already`
  : `all ${n} ${word}s are connected already`);

// Positions of the small floor arrows around an asset, in the asset's own frame (its
// front is +Z, so after faceTowards() the user sees inputs on the left, outputs on the
// right). Inputs are spread over an arc centred on -X and point inwards; outputs over an
// arc centred on +X and point outwards. radius: distance from the asset centre (metres).
// Returns [{ side: 'in' | 'out', index, x, z, angle }]: angle = direction the arrow
// points, as rotation about +Y from +X (counter-clockwise seen from above).
export function portArrowLayout(nIn, nOut, radius, { arc = (150 * Math.PI) / 180, step = 0.45 } = {}) {
  const out = [];
  const place = (n, side, centre) => {
    const span = n > 1 ? Math.min(arc, step * (n - 1)) : 0;
    for (let i = 0; i < n; i++) {
      const a = centre + (n > 1 ? -span / 2 + (span * i) / (n - 1) : 0);
      // a is measured in the X-Z plane from +X towards -Z (counter-clockwise from above)
      const x = radius * Math.cos(a), z = -radius * Math.sin(a);
      out.push({ side, index: i, x, z, angle: side === 'out' ? a : a + Math.PI });
    }
  };
  place(nIn, 'in', Math.PI);
  place(nOut, 'out', 0);
  return out;
}

// Short text for a parameter value on a panel.
export function formatValue(v) {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(4));
  if (typeof v === 'string') return v === '' ? "''" : v;
  return JSON.stringify(v);
}

// Rows for an asset's info panel (the "model menu"), in two columns:
//   ports:  the Illuminator model, then its inputs and outputs with what each is connected to
//   params: the model's parameters and their values
// Each row is { heading } or { key, value, state? } with state 'open' | 'on' | 'any'.
// def: the asset definition (components.json); model: its schema entry (or null);
// status: EnergySystem.portStatus(node) for a placed asset, null for a palette tile;
// params: the node's parameters (defaults for a palette tile); nameOf(id): node label.
export function modelRows({ def, model, status = null, params = null, nameOf = String }) {
  const ports = [], par = [];
  if (!model) {
    ports.push({ key: 'Illuminator', value: def?.illuminator ? `${def.illuminator} (not in the docs)` : 'no model' });
    return { ports, params: par };
  }
  ports.push({ key: 'Illuminator', value: `${model.name} (${model.categories?.[0] ?? 'model'})` });
  const p = portsOfModel(model);
  const side = (title, names, entries, extra, arrow, other) => {
    const used = entries ? entries.filter((e) => e.link).length : 0;
    if (p.dynamic) {
      ports.push({ heading: `${title}: any number` });
      for (const l of extra ?? []) ports.push({ key: (arrow === '←' ? l.toPort : l.fromPort) ?? '·', value: `${arrow} ${nameOf(l[other])}`, state: 'on' });
      if (!extra?.length) ports.push({ key: 'built at run time', value: '', state: 'any' });
      return;
    }
    ports.push({ heading: entries ? `${title} ${used}/${names.length}` : `${title} (${names.length})` });
    if (!names.length) ports.push({ key: 'none', value: '' });
    for (const name of names) {
      const e = entries?.find((x) => x.name === name);
      const link = e?.link;
      if (link) {
        const there = arrow === '←' ? link.fromPort : link.toPort;
        ports.push({ key: name, value: `${arrow} ${nameOf(link[other])}${there ? '.' + there : ''}`, state: 'on' });
      } else {
        const unit = (title === 'Inputs' ? model.inputs : model.outputs)?.[name]?.type ?? '';
        ports.push({ key: name, value: entries ? 'open' : unit, state: entries ? 'open' : undefined });
      }
    }
  };
  side('Inputs', p.inputs, status?.inputs, status?.extraIn, '←', 'from');
  side('Outputs', p.outputs, status?.outputs, status?.extraOut, '→', 'to');
  const values = params ?? defaultParameters(model);
  par.push({ heading: `Parameters (${Object.keys(values).length})` });
  if (!Object.keys(values).length) par.push({ key: 'none', value: '' });
  for (const [k, v] of Object.entries(values)) par.push({ key: k, value: formatValue(v) });
  return { ports, params: par };
}
