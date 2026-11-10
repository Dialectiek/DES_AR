// The energy system built on the table: nodes (one per scanned card) and links
// between them. Pure logic, no three.js, so it runs in Node tests too.
//
// Link types follow from the assets: a link carries 'electricity' (or 'heat') when one
// side produces it and the other consumes it; the producer is the source of the flow.

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
  // config: the parsed components.json
  constructor(config) {
    this.config = config;
    this.nodes = [];   // { id, colour, type (asset key or null), x, z }
    this.links = [];   // { id, carrier, from, to, power }
    this.history = []; // undo stack
    this.nextId = 1;
  }

  assetOf(node) {
    return node.type ? this.config.assets[node.type] ?? null : null;
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
    if (!added.length) return added;
    this.nodes.push(...added);
    this.history.push({ kind: 'add', nodeIds: added.map((n) => n.id) });
    return added;
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
    const added = options.map(({ carrier, forward }) => {
      const from = forward ? a : b;
      const to = forward ? b : a;
      return { id: this.nextId++, carrier, from: from.id, to: to.id, power: this.assetOf(from).power_kW ?? 1 };
    });
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
