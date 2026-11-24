// Draws the links of the energy system (manual and cards mode) on the table: cables for
// electricity, tubes for heat and gas, lying on the table at right angles, around the
// assets, with a small arch where two cross and dots moving producer → consumer.
// The routing and drawing are shared with the demo diorama (cables.js, router.js).

import { CableNetwork } from './cables.js';

const MIN_FOOTPRINT = 0.025; // metres: half-size of an asset that has no model size yet

export class LinkView {
  // parent: the table anchor group; config: components.json
  constructor(parent, config) {
    this.net = new CableNetwork(parent, { scale: 1, carriers: config.carriers });
  }

  // Rebuilds the drawing to match system.links. table: { length, width } (state.table);
  // footprints: Map(node id → half-size in metres) of the assets the cables go around.
  // Only re-routes when an asset or link changed.
  sync(system, { table, footprints } = {}) {
    if (!table || !system.links.length) {
      this.net.clear();
      return;
    }
    const nodes = system.nodes.map((n) => {
      const r = Math.max(MIN_FOOTPRINT, footprints?.get(n.id) ?? MIN_FOOTPRINT);
      return { id: n.id, x: n.x, z: n.z, hx: r, hz: r };
    });
    const links = system.links.map((l) => ({ id: l.id, from: l.from, to: l.to, carrier: l.carrier, power: l.power }));
    this.net.set({ area: { length: table.length, width: table.width }, baseY: 0, nodes, links });
  }

  clear() {
    this.net.clear();
  }

  update(dt) {
    this.net.update(dt);
  }
}
