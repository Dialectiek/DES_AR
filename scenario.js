// Illuminator scenarios in the diorama: pure logic (no three.js, so it runs in Node tests too).
//
// An Illuminator scenario (a mosaik-style YAML, parsed to an object) lists models and the
// connections between their outputs and inputs. The monitor CSV it produces has one row per
// time step and one column per monitored output ("Model.output").
//
// scenarioToScene() turns the scenario into a diorama scene (the format of
// assets/scenes/*.json, see diorama.js) using assets/illuminator-types.json:
//   - every model whose type is not hidden becomes an item (or several, see 'repeat'),
//   - a connection from a power output becomes an energy flow bound to its CSV column,
//   - a hub with 'grid' gets a grid item whose flow closes the hub's power balance,
//   - positions come from a deterministic street layout, or from an optional per-model
//     'ar: { x, z, rotation }' (metres, degrees) in the YAML.
// createPlayer() runs the timeline; valueAt() reads a column at a fractional step.

// ---------------------------------------------------------------------------
// Monitor CSV
// ---------------------------------------------------------------------------

// "2012-06-01" and "2012-06-01 00:15:00" → "2012-06-01 00:15:00".
function normaliseTime(s) {
  const t = String(s).trim().replace('T', ' ');
  if (/^\d{4}-\d\d-\d\d$/.test(t)) return t + ' 00:00:00';
  if (/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(t)) return t + ':00';
  return t;
}

// Seconds since the epoch, treating the time as UTC (only differences matter here).
function timeSeconds(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 : NaN;
}

// text: the monitor CSV (first column = time, header = "date,Model.output,...").
// Returns { times: ['YYYY-MM-DD HH:mm:ss'], columns: Map(name → Float64Array), stepSeconds }.
// Empty or unreadable cells become NaN.
export function parseMonitorCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) throw new Error('the CSV is empty');
  const header = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((l) => l.split(','));
  const times = rows.map((r) => normaliseTime(r[0]));
  const columns = new Map();
  header.slice(1).forEach((name, j) => {
    const col = new Float64Array(rows.length);
    rows.forEach((r, i) => {
      const v = parseFloat(r[j + 1]);
      col[i] = Number.isFinite(v) ? v : NaN;
    });
    columns.set(name, col);
  });
  const dt = times.length > 1 ? timeSeconds(times[1]) - timeSeconds(times[0]) : NaN;
  return { times, columns, stepSeconds: dt > 0 ? dt : null };
}

// "2012-06-01 13:45:00" → "2012-06-01 13:45".
export function timeLabel(t) {
  return String(t ?? '').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Scenario → scene
// ---------------------------------------------------------------------------

// Library key expected for a model type that is not in illuminator-types.json yet:
// "Heat_Pump" → "heat-pump". Until the library has that asset, the diorama shows a
// placeholder box (add a model to tools/model-builders.js and a library entry).
export function typeAssetKey(type) {
  const slug = String(type)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'model';
}

function splitRef(ref) {
  const s = String(ref ?? '');
  const i = s.indexOf('.');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

// Pairs the copies of the two ends of a connection: one-to-many fans out, equal counts zip.
function pairUp(a, b) {
  if (a.length === b.length) return a.map((x, i) => [x, b[i]]);
  if (a.length === 1) return b.map((y) => [a[0], y]);
  if (b.length === 1) return a.map((x) => [x, b[0]]);
  const n = Math.min(a.length, b.length);
  return a.slice(0, n).map((x, i) => [x, b[i]]);
}

const itemOf = (end) => String(end).split(':')[0]; // "Load1#1:meter" → "Load1#1"
const basename = (p) => String(p).split(/[\\/]/).pop();

// Parameters worth showing in an asset's details (not file settings).
function paramInfo(params) {
  const out = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (/path|format|delimiter|file/i.test(k)) continue;
    if (v === null || v === undefined || typeof v === 'object') continue;
    if (typeof v === 'string' && /^none$/i.test(v)) continue;
    out[k] = v;
    if (Object.keys(out).length >= 8) break;
  }
  return out;
}

// Layout constants, in real metres.
const STREET = 6;        // street width
const SETBACK = 1.5;     // between the street and the items along it
const GAP = 3;           // between neighbours along the street
const MARGIN = 3;        // ground around everything
const DEFAULT_SIZE = [3, 3, 3];

// scenario: the parsed YAML. typesConfig: assets/illuminator-types.json. library:
// assets/library.json (for model sizes and to see which assets exist).
// columns (optional): the monitor CSV columns (Map or Set of names), to warn about missing
// data and to find flows of unknown model types.
// Returns { name, stepSeconds, monitorFile, scene: { ground, items, flows }, derived,
//           hiddenModels, unknownTypes, missingAssets, warnings }.
export function scenarioToScene(scenario, typesConfig, library, { columns = null } = {}) {
  const types = typesConfig?.types ?? typesConfig ?? {};
  const assets = library?.assets ?? library ?? {};
  const has = (col) => (columns ? columns.has(col) : false);
  const warnings = [];
  const hiddenModels = [];
  const unknownTypes = new Map();
  const missingAssets = new Map();
  const models = Array.isArray(scenario?.models) ? scenario.models : [];
  const connections = Array.isArray(scenario?.connections) ? scenario.connections : [];

  const hiddenNames = new Set(models.filter((m) => types[m?.type]?.hidden).map((m) => m.name));

  // Models → items.
  const drawn = new Map(); // model name → { model, cfg, ids }
  const items = [];
  const needAsset = (key, type, role) => {
    if (!assets[key] && !missingAssets.has(key)) missingAssets.set(key, { key, type, role: role ?? 'unknown' });
  };
  for (const m of models) {
    if (!m?.name) continue;
    let cfg = types[m.type];
    if (cfg?.hidden) { hiddenModels.push(m.name); continue; }
    if (!cfg) {
      cfg = { asset: typeAssetKey(m.type), role: 'unknown' };
      if (!unknownTypes.has(m.type)) unknownTypes.set(m.type, { type: m.type, asset: cfg.asset, models: [] });
      unknownTypes.get(m.type).models.push(m.name);
    }
    needAsset(cfg.asset, m.type, cfg.role);
    const n = cfg.repeat ? Math.max(1, Math.round(Number(m.parameters?.[cfg.repeat]) || 1)) : 1;
    const ids = n === 1 ? [m.name] : Array.from({ length: n }, (_, i) => `${m.name}#${i + 1}`);
    drawn.set(m.name, { model: m, cfg, ids });

    // Data files feeding this model (from hidden models, e.g. CSV readers).
    const data = new Set();
    for (const c of connections) {
      const [a] = splitRef(c?.from);
      const [b] = splitRef(c?.to);
      if (b !== m.name || !hiddenNames.has(a)) continue;
      const src = models.find((x) => x.name === a);
      data.add(src?.parameters?.file_path ? basename(src.parameters.file_path) : a);
    }
    const info = { Model: `${m.name} (${m.type})`, ...paramInfo(m.parameters) };
    if (data.size) info.Data = [...data].join(', ');

    const ar = Array.isArray(m.ar) ? m.ar : m.ar ? [m.ar] : [];
    ids.forEach((id, i) => {
      const item = {
        id,
        asset: cfg.asset,
        name: n === 1 ? m.name : `${m.name} (${i + 1}/${n})`,
        info,
        role: cfg.role ?? 'unknown',
        model: m.name,
      };
      const fixed = ar[i];
      if (fixed && Number.isFinite(Number(fixed.x)) && Number.isFinite(Number(fixed.z))) {
        item.x = Number(fixed.x);
        item.z = Number(fixed.z);
        item.rotation = Number(fixed.rotation) || 0;
        item.fixed = true;
      }
      if (cfg.level) {
        const column = `${m.name}.${cfg.level}`;
        item.level = { column, min: 0, max: 100 };
        if (columns && !has(column)) warnings.push(`No data for ${column} (battery level)`);
      }
      items.push(item);
    });
  }

  // Connections → flows.
  const flows = [];
  for (const c of connections) {
    const [aName, aOut] = splitRef(c?.from);
    const [bName] = splitRef(c?.to);
    const A = drawn.get(aName), B = drawn.get(bName);
    if (!A || !B || aName === bName) continue;
    const column = `${aName}.${aOut}`;
    let spec = null;
    if (A.cfg.power) spec = A.cfg.power[aOut] ?? null;
    else if (has(column)) spec = { kind: 'flow', dir: 'out' }; // unknown type: any monitored output
    if (!spec) continue;
    const missing = !!columns && !has(column);
    if (missing) warnings.push(`No data for ${column}: the flow ${aName} → ${bName} stays empty`);
    const pairs = pairUp(A.ids, B.ids);
    // "id:port" when the type says where flows attach (e.g. a house's meter).
    const endA = (id) => (A.cfg.port ? `${id}:${A.cfg.port}` : id);
    const endB = (id) => (B.cfg.port ? `${id}:${B.cfg.port}` : id);
    pairs.forEach(([ia, ib], k) => {
      const [from, to] = spec.dir === 'in' ? [endB(ib), endA(ia)] : [endA(ia), endB(ib)];
      const flow = {
        from,
        to,
        kind: spec.kind ?? 'flow',
        kw: 0,
        series: { column, scale: 1 / pairs.length, signed: !!spec.signed, missing },
        showLabel: k === 0,
        labelFactor: pairs.length,
      };
      if (spec.label) flow.label = spec.label;
      else if (pairs.length > 1) flow.label = `total of ${pairs.length}`;
      flows.push(flow);
    });
  }

  // Grid connection of each hub: closes the hub's power balance.
  //   import = Σ out of the hub − Σ into the hub (over all its flows), positive = from the grid.
  const derived = [];
  const hubs = [...drawn.values()].filter((d) => d.cfg.role === 'hub' && d.cfg.grid);
  for (const hub of hubs) {
    const hubId = hub.ids[0];
    const gridId = hubs.length > 1 ? `${hub.model.name}.grid` : 'grid';
    const column = `${hub.model.name}.grid_import`;
    const terms = [];
    let missing = false;
    for (const f of flows) {
      const sign = itemOf(f.from) === hubId ? 1 : itemOf(f.to) === hubId ? -1 : 0;
      if (!sign) continue;
      if (f.series.missing) missing = true;
      terms.push({ column: f.series.column, coef: sign * f.series.scale });
    }
    const gridAsset = hub.cfg.grid.asset ?? 'grid-pylon';
    needAsset(gridAsset, 'grid', 'grid');
    items.push({
      id: gridId,
      asset: gridAsset,
      name: 'Grid',
      info: { 'Power balance of': hub.model.name },
      role: 'grid',
    });
    derived.push({ column, terms });
    flows.push({
      from: gridId,
      to: hub.cfg.port ? `${hubId}:${hub.cfg.port}` : hubId,
      kind: 'import',
      kindReverse: 'export',
      kw: 0,
      series: { column, scale: 1, signed: true, missing },
      showLabel: true,
      labelFactor: 1,
    });
  }

  const sizeOf = (asset) => assets[asset]?.size ?? DEFAULT_SIZE;
  const ground = layoutItems(items, sizeOf);

  return {
    name: scenario?.scenario?.name ?? 'Scenario',
    stepSeconds: Number(scenario?.scenario?.time_resolution) || null,
    monitorFile: scenario?.monitor?.file ?? null,
    scene: { ground, items, flows },
    derived,
    hiddenModels,
    unknownTypes: [...unknownTypes.values()],
    missingAssets: [...missingAssets.values()],
    warnings,
  };
}

// Footprint of an item on the ground: [along x, along z], after its rotation.
function footprint(size, rotation) {
  const quarter = Math.round(((rotation ?? 0) % 180) / 90) !== 0;
  return quarter ? [size[2], size[0]] : [size[0], size[2]];
}

// Street layout, like the Illuminator tutorial pictures: a street along +X with houses and
// generators on both sides (generators spread between the houses), the hub at the east end
// of the street with storage beside it, and the grid further east. Items with 'fixed'
// positions keep them. Everything is then centred on the origin. Sets x, z, rotation on
// the items; returns the ground { length, width, strips }.
export function layoutItems(items, sizeOf) {
  const free = items.filter((it) => !it.fixed);
  const hub = free.find((it) => it.role === 'hub');
  const consumers = free.filter((it) => it.role === 'consumer');
  const producers = free.filter((it) => it.role === 'producer');
  const storage = free.filter((it) => it.role === 'storage');
  const grid = free.filter((it) => it.role === 'grid');
  const others = free.filter((it) => !['hub', 'consumer', 'producer', 'storage', 'grid'].includes(it.role) || (it.role === 'hub' && it !== hub));

  // Spread the producers evenly between the consumers.
  const keyed = consumers.map((it, i) => ({ it, key: i + 0.5 }));
  producers.forEach((it, k) => keyed.push({ it, key: ((k + 1) * consumers.length) / (producers.length + 1) }));
  keyed.sort((a, b) => a.key - b.key);
  const street = [...keyed.map((k) => k.it), ...others, ...(hub ? [] : storage)];

  // Fill both sides of the street, always the shorter side first (north on a tie).
  const cursor = { north: 0, south: 0 };
  for (const it of street) {
    const [len, , depth] = sizeOf(it.asset);
    const side = cursor.north <= cursor.south ? 'north' : 'south';
    it.x = cursor[side] + len / 2;
    it.z = (side === 'north' ? -1 : 1) * (STREET / 2 + SETBACK + depth / 2);
    it.rotation = side === 'north' ? 0 : 180; // the front (+Z) faces the street
    cursor[side] += len + GAP;
  }
  const streetEnd = Math.max(cursor.north, cursor.south, GAP) - GAP;

  let east = streetEnd;
  if (hub) {
    const [len, , depth] = sizeOf(hub.asset);
    // Turned to face west, down the street: its length now runs along z.
    hub.x = streetEnd + SETBACK + depth / 2;
    hub.z = 0;
    hub.rotation = -90;
    east = hub.x + depth / 2;
    let z = len / 2 + SETBACK;
    for (const it of storage) {
      const [sLen, , sDepth] = sizeOf(it.asset);
      it.x = hub.x;
      it.z = z + sDepth / 2;
      it.rotation = 0;
      z += sDepth + GAP;
      east = Math.max(east, hub.x + sLen / 2);
    }
  }
  for (const it of grid) {
    const [len] = sizeOf(it.asset);
    it.x = east + 2 * GAP + len / 2;
    it.z = 0;
    it.rotation = 0;
    east = it.x + len / 2;
  }

  // Bounding box of everything, then centre it on the origin.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const it of items) {
    const [fx, fz] = footprint(sizeOf(it.asset), it.rotation);
    minX = Math.min(minX, it.x - fx / 2); maxX = Math.max(maxX, it.x + fx / 2);
    minZ = Math.min(minZ, it.z - fz / 2); maxZ = Math.max(maxZ, it.z + fz / 2);
  }
  if (!items.length) { minX = maxX = minZ = maxZ = 0; }
  const strips = [];
  if (street.length || hub) {
    minX = Math.min(minX, 0); maxX = Math.max(maxX, streetEnd);
    minZ = Math.min(minZ, -STREET / 2); maxZ = Math.max(maxZ, STREET / 2);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  for (const it of items) {
    it.x = +(it.x - cx).toFixed(3);
    it.z = +(it.z - cz).toFixed(3);
  }
  if (street.length || hub) {
    const x0 = -GAP / 2, x1 = streetEnd + (hub ? SETBACK : GAP / 2);
    strips.push({ name: 'street', x: +((x0 + x1) / 2 - cx).toFixed(3), z: +(-cz).toFixed(3), length: +(x1 - x0).toFixed(3), width: STREET });
  }
  return {
    length: +(maxX - minX + 2 * MARGIN).toFixed(1),
    width: +(maxZ - minZ + 2 * MARGIN).toFixed(1),
    strips,
  };
}

// Adds the derived columns (e.g. the grid import of a hub) to the CSV columns, in place.
// A derived column is left out when one of its terms has no data.
export function addDerivedColumns(derived, columns) {
  for (const d of derived) {
    if (!d.terms.every((t) => columns.has(t.column))) continue;
    const n = columns.get(d.terms[0]?.column)?.length ?? 0;
    const out = new Float64Array(n);
    for (const t of d.terms) {
      const col = columns.get(t.column);
      for (let i = 0; i < n; i++) out[i] += t.coef * col[i];
    }
    columns.set(d.column, out);
  }
  return columns;
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

// Value of a column at fractional step t (linear between steps). NaN when there is no data.
export function valueAt(col, t) {
  if (!col || !col.length) return NaN;
  const last = col.length - 1;
  const tc = Math.min(Math.max(t, 0), last);
  const i = Math.floor(tc);
  const f = tc - i;
  const a = col[i];
  const b = col[Math.min(i + 1, last)];
  if (!Number.isFinite(a)) return Number.isFinite(b) && f > 0.5 ? b : NaN;
  if (!Number.isFinite(b)) return a;
  return a + (b - a) * f;
}

// steps: number of rows; stepSeconds: simulated seconds per row; speed: simulated hours per
// real second. t is the fractional row index; it loops back to 0 after the last row.
export function createPlayer({ steps, stepSeconds = 900, speed = 0.67, playing = true }) {
  const last = Math.max(0, steps - 1);
  return {
    steps,
    stepSeconds: stepSeconds || 900,
    speed,
    playing: playing && last > 0,
    t: 0,
    get fraction() { return last ? this.t / last : 0; },
    get index() { return Math.min(last, Math.round(this.t)); },
    update(dt) {
      if (!this.playing || last === 0) return;
      this.t += (dt * this.speed * 3600) / this.stepSeconds;
      if (this.t > last) this.t %= last;
    },
    play() { this.playing = last > 0; },
    pause() { this.playing = false; },
    toggle() { if (this.playing) this.pause(); else this.play(); return this.playing; },
    seek(fraction) { this.t = Math.min(Math.max(fraction, 0), 1) * last; },
    step(n) { this.t = Math.min(Math.max(Math.round(this.t) + n, 0), last); },
  };
}
