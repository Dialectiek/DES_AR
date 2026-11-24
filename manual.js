// Manual mode: pure logic (no three.js, so it runs in Node tests too).
//
// Table-local coordinates, as everywhere on the table: origin = table centre on its
// surface, +X = the table's long side (length), +Z = across (width), metres.
//
// Phases:
//   edit — everything at once: trigger on a palette tile picks an asset, trigger on the
//          table places it, trigger on an asset and then another connects them
//   done — a check: the palette is hidden and the open Illuminator ports are listed.
//          Nothing is locked: assets can still be connected, and the bumper (or Done
//          on a screen) brings the palette back.

export const PHASES = ['edit', 'done'];

// Is (x, z) on the table, at least `margin` metres from its edges?
export function insideTable(x, z, length, width, margin = 0.03) {
  return Math.abs(x) <= length / 2 - margin && Math.abs(z) <= width / 2 - margin;
}

// The table edge closest to the user's head (table-local {x, z}).
// axis 'z' = a long edge (at z = ±width/2), axis 'x' = a short edge (at x = ±length/2).
// sign = which of the two.
export function nearestEdge(head, length, width) {
  const outZ = Math.abs(head.z) - width / 2;
  const outX = Math.abs(head.x) - length / 2;
  if (outZ >= outX) return { axis: 'z', sign: head.z >= 0 ? 1 : -1 };
  return { axis: 'x', sign: head.x >= 0 ? 1 : -1 };
}

// Positions for `count` palette tiles in a row just outside the table edge nearest to
// the user, left to right as the user sees it. The last slot (the Done button) gets a
// little extra gap. Returns { slots: [{x, z}], spacing, yaw, edge }; yaw turns a tile's
// front (+Z) towards the user.
export function paletteSlots(count, length, width, head, { offset = 0.07, maxSpacing = 0.13, lastGap = 0.04 } = {}) {
  const edge = nearestEdge(head, length, width);
  const edgeLength = edge.axis === 'z' ? length : width;
  const extra = count > 1 ? lastGap : 0;
  const spacing = count > 1 ? Math.min(maxSpacing, Math.max(0, 0.95 * edgeLength - extra) / (count - 1)) : 0;
  const span = (count - 1) * spacing + extra;
  const out = (edge.axis === 'z' ? width : length) / 2 + offset;
  const yaw = edge.axis === 'z' ? (edge.sign > 0 ? 0 : Math.PI) : (edge.sign * Math.PI) / 2;
  const slots = [];
  for (let i = 0; i < count; i++) {
    const t = -span / 2 + i * spacing + (i === count - 1 ? extra : 0);
    // Seen from outside the edge, "right" is +X from the +Z side, -Z from the +X side.
    if (edge.axis === 'z') slots.push({ x: t * edge.sign, z: out * edge.sign });
    else slots.push({ x: out * edge.sign, z: -t * edge.sign });
  }
  return { slots, spacing, yaw, edge };
}

// Palette pages: the asset types grouped by their "group" field, in the order of
// config.paletteGroups ([{ key, label, colour }]); within a page, config.assets order.
// A type without a known group goes to the last page. Empty pages are left out.
// Returns [{ key, label, colour, types }]. Without paletteGroups: one page with everything.
export function paletteGroups(config) {
  const defs = Array.isArray(config?.paletteGroups) && config.paletteGroups.length
    ? config.paletteGroups
    : [{ key: 'all', label: 'Assets' }];
  const pages = defs.map((d) => ({ key: d.key, label: d.label ?? d.key, colour: d.colour ?? '#ffffff', types: [] }));
  const byKey = new Map(pages.map((p) => [p.key, p]));
  const last = pages[pages.length - 1];
  for (const [type, def] of Object.entries(config?.assets ?? {})) {
    (byKey.get(def?.group) ?? last).types.push(type);
  }
  return pages.filter((p) => p.types.length);
}

// What a short bumper press does.
//   a connection half made (first asset selected): cancel it
//   done: back to editing (the palette comes back, nothing is removed)
//   edit: undo the last step (EnergySystem.undo()), if there is one
// lastStepKind: EnergySystem.lastStepKind() ('add' | 'link' | 'unlink' | null).
// Returns 'clear-selection' | 'to-edit' | 'undo' | 'nothing'.
export function bumperAction(phase, hasSelection, lastStepKind) {
  if (hasSelection) return 'clear-selection';
  if (phase === 'done') return 'to-edit';
  return lastStepKind ? 'undo' : 'nothing';
}
