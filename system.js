// The energy system built on the table: nodes (one per scanned card) and links
// between them. Pure logic, no three.js, so it runs in Node tests too.
//
// Link types follow from the assets: a link carries 'electricity' (or 'heat') when one
// side produces it and the other consumes it; the producer is the source of the flow.
//
// Illuminator ports (schema.js): an asset with an "illuminator" model takes at most as many
// connections as its model has inputs and outputs. Every link then records which output of
// its source (fromPort) and which input of its target (toPort) it uses; those names become
// the `connections` of the Illuminator scenario YAML. Each node also keeps its own copy of
// the model's parameters (node.params), starting from the schema's defaults.
//
// A link whose carrier has an "illuminator" model in components.json (hydrogen →
// Pipeline) is a component of its own in the scenario: it gets link.model and its own
// link.params. In the YAML the link becomes from.fromPort → <model>.<first input> and
// <model>.<first output> → to.toPort.
// The parameters are never derived from the drawing: a pipe's length `L` is its own
// value, not the length of the tube on the table (the table is a schematic, not to scale).

import { indexSchemas, modelOf, portsOfModel, defaultParameters, pickPorts } from './schema.js';

// a, b: asset definitions from components.json ({ produces, consumes }) or null.
// Returns [{ carrier, forward }]: forward = true means the flow goes a → b.
// When both directions work for a carrier (e.g. two batteries), a → b is used.
export function resolveLink(a, b) {
  if (!a || !b) return [];
  const result = [];
  const carriers = new Set([...(a.produces || []), ...(a.consumes || []), ...(b.produces || []), ...(b.consumes || [])]);
  for (const carrier of carriers) {
    const ab = (a.produces || []).includes(carrier) && (b.consumes || []).includes(carrier);
    const ba = (b.produces || []).includes(carrier) && (a.consumes || []).includes(carrier);
    if (ab) result.push({ carrier, forward: true });
    else if (ba) result.push({ carrier, forward: false });
  }
  return result;
}

export class EnergySystem {
  // config: the parsed components.json; schemas: the parsed illuminator-schemas.json
  // (optional: without it, assets have no ports and connect as before).
  constructor(config, schemas = null) {
    this.config = config;
    this.schemas = indexSchemas(schemas);
    this.nodes = [];   // { id, colour, type (asset key or null), x, z, params? }
    this.links = [];   // { id, carrier, from, to, power, fromPort, toPort, model?, params? }
    this.history = []; // undo stack
    this.nextId = 1;
  }

  assetOf(node) {
    return node.type ? this.config.assets[node.type] ?? null : null;
  }

  // The Illuminator schema entry of a node's asset, or null.
  modelOf(node) {
    return modelOf(this.schemas, this.assetOf(node));
  }

  // { model, category, inputs, outputs, dynamic } of a node, or null (no Illuminator model).
  portsOf(node) {
    return portsOfModel(this.modelOf(node));
  }

  // Which ports of a node are connected, and to what:
  //   { model, category, dynamic, inputs: [{ name, link }], outputs: [{ name, link }],
  //     open: number of unconnected ports, extraIn / extraOut: links on a dynamic model }
  // link = the link using that port, or null. null for a node without a model.
  portStatus(node) {
    const ports = this.portsOf(node);
    if (!ports) return null;
    const incoming = this.links.filter((l) => l.to === node.id);
    const outgoing = this.links.filter((l) => l.from === node.id);
    const inputs = ports.inputs.map((name) => ({ name, link: incoming.find((l) => l.toPort === name) ?? null }));
    const outputs = ports.outputs.map((name) => ({ name, link: outgoing.find((l) => l.fromPort === name) ?? null }));
    const open = ports.dynamic ? 0 : [...inputs, ...outputs].filter((p) => !p.link).length;
    return {
      model: ports.model, category: ports.category, dynamic: ports.dynamic, inputs, outputs, open,
      extraIn: ports.dynamic ? incoming : [], extraOut: ports.dynamic ? outgoing : [],
    };
  }

  // Unconnected ports over the whole system: [{ node, side: 'in' | 'out', name }].
  openPorts() {
    const out = [];
    for (const node of this.nodes) {
      const st = this.portStatus(node);
      if (!st || st.dynamic) continue;
      for (const p of st.inputs) if (!p.link) out.push({ node, side: 'in', name: p.name });
      for (const p of st.outputs) if (!p.link) out.push({ node, side: 'out', name: p.name });
    }
    return out;
  }

  // The Illuminator model a link of this carrier stands for (hydrogen → Pipeline), or null.
  linkModel(carrier) {
    const name = this.config.carriers?.[carrier]?.illuminator;
    return name ? this.schemas.get(name) ?? null : null;
  }

  // A new node's own copy of its model's parameters (none without a model).
  paramsFor(type) {
    const model = modelOf(this.schemas, this.config.assets?.[type]);
    return model ? defaultParameters(model) : null;
  }

  labelOf(node) {
    return this.assetOf(node)?.label ?? `${node.colour} card`;
  }

  node(id) {
    return this.nodes.find((n) => n.id === id) ?? null;
  }

  // cards: [{ colour, x, z }] in table-local metres. Returns the new nodes.
  addCards(cards) {
    const added = cards.map((c) => ({
      id: this.nextId++,
      colour: c.colour,
      type: this.config.cards?.[c.colour] ?? null,
      x: c.x,
      z: c.z,
    }));
    for (const n of added) {
      const params = n.type ? this.paramsFor(n.type) : null;
      if (params) n.params = params;
    }
    if (!added.length) return added;
    this.nodes.push(...added);
    this.history.push({ kind: 'add', nodeIds: added.map((n) => n.id) });
    return added;
  }

  // Manual mode: one asset of the given type (key in config.assets) at (x, z),
  // table-local metres. colour only sets the ring/label colour (null = white).
  // Undone like a scan. Returns the new node.
  addNode(type, x, z, colour = null) {
    if (!this.config.assets?.[type]) throw new Error(`unknown asset "${type}"`);
    const node = { id: this.nextId++, colour, type, x, z };
    const params = this.paramsFor(type);
    if (params) node.params = params;
    this.nodes.push(node);
    this.history.push({ kind: 'add', nodeIds: [node.id] });
    return node;
  }

  // Kind of the step undo() would undo next: 'add' | 'link' | 'unlink' | null.
  lastStepKind() {
    return this.history.at(-1)?.kind ?? null;
  }

  linksBetween(idA, idB) {
    return this.links.filter((l) => (l.from === idA && l.to === idB) || (l.from === idB && l.to === idA));
  }

  // Click on two nodes. Removes their links if they are connected already,
  // otherwise adds the links their assets allow.
  // Returns { action: 'added' | 'removed' | 'refused', links, reason? }.
  connect(idA, idB) {
    const a = this.node(idA), b = this.node(idB);
    if (!a || !b || idA === idB) return { action: 'refused', links: [], reason: 'pick two different assets' };
    const existing = this.linksBetween(idA, idB);
    if (existing.length) {
      this.links = this.links.filter((l) => !existing.includes(l));
      this.history.push({ kind: 'unlink', links: existing });
      return { action: 'removed', links: existing };
    }
    const assetA = this.assetOf(a), assetB = this.assetOf(b);
    if (!assetA || !assetB) {
      const missing = !assetA ? a : b;
      return { action: 'refused', links: [], reason: `the ${missing.colour} card has no asset in components.json` };
    }
    const options = resolveLink(assetA, assetB);
    if (!options.length) {
      return { action: 'refused', links: [], reason: `${assetA.label} and ${assetB.label} can't be connected` };
    }
    // Give every link a free output on its source and a free input on its target. When a
    // carrier can flow both ways (e.g. two batteries), the other way is tried as well.
    const usedOut = new Map(), usedIn = new Map(); // node id → port names taken (incl. this call)
    const taken = (map, id, key) => {
      if (!map.has(id)) map.set(id, this.links.filter((l) => l[key === 'out' ? 'from' : 'to'] === id).map((l) => (key === 'out' ? l.fromPort : l.toPort)));
      return map.get(id);
    };
    const added = [];
    let lastFail = null;
    for (const { carrier, forward } of options) {
      const both = [assetA, assetB].every((d) => (d.produces || []).includes(carrier) && (d.consumes || []).includes(carrier));
      const tries = both ? [forward, !forward] : [forward];
      let made = null;
      for (const fwd of tries) {
        const from = fwd ? a : b, to = fwd ? b : a;
        const pick = pickPorts(this.portsOf(from), this.portsOf(to), taken(usedOut, from.id, 'out'), taken(usedIn, to.id, 'in'), carrier);
        if (!pick.ok) {
          lastFail = `${this.labelOf(pick.side === 'from' ? from : to)}: ${pick.reason}`;
          continue;
        }
        if (pick.fromPort) taken(usedOut, from.id, 'out').push(pick.fromPort);
        if (pick.toPort) taken(usedIn, to.id, 'in').push(pick.toPort);
        made = {
          id: this.nextId++, carrier, from: from.id, to: to.id, power: this.assetOf(from).power_kW ?? 1,
          fromPort: pick.fromPort, toPort: pick.toPort,
        };
        const linkModel = this.linkModel(carrier);
        if (linkModel) {
          made.model = linkModel.name;
          made.params = defaultParameters(linkModel);
        }
        break;
      }
      if (made) added.push(made);
    }
    if (!added.length) return { action: 'refused', links: [], reason: lastFail };
    this.links.push(...added);
    this.history.push({ kind: 'link', linkIds: added.map((l) => l.id) });
    return { action: 'added', links: added };
  }

  // Undoes the last scan, link or unlink. Returns a short description, or null.
  undo() {
    const step = this.history.pop();
    if (!step) return null;
    if (step.kind === 'add') {
      const ids = new Set(step.nodeIds);
      this.nodes = this.nodes.filter((n) => !ids.has(n.id));
      this.links = this.links.filter((l) => !ids.has(l.from) && !ids.has(l.to));
      return `removed ${ids.size} asset${ids.size === 1 ? '' : 's'}`;
    }
    if (step.kind === 'link') {
      const ids = new Set(step.linkIds);
      this.links = this.links.filter((l) => !ids.has(l.id));
      return 'removed the last connection';
    }
    // unlink: put the links back (their nodes may be gone if they were undone meanwhile)
    const restore = step.links.filter((l) => this.node(l.from) && this.node(l.to));
    this.links.push(...restore);
    return 'restored the connection';
  }

  clear() {
    this.nodes = [];
    this.links = [];
    this.history = [];
  }
}

// The card colour that components.json maps to this asset type, or null. Manual assets
// use it for their ring and label, so an asset looks the same in both modes.
export function colourForType(config, type) {
  for (const [colour, t] of Object.entries(config?.cards ?? {})) if (t === type) return colour;
  return null;
}
