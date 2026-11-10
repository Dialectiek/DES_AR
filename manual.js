// Manual mode: pure logic (no three.js, so it runs in Node tests too).
//
// Table-local coordinates, as everywhere on the table: origin = table centre on its
// surface, +X = the table's long side (length), +Z = across (width), metres.
//
// Phases:
//   place   — pick an asset on the palette, trigger on the table places it
//   connect — trigger on two assets connects them
//   done    — finished: nothing changes, the flows keep running

export const PHASES = ['place', 'connect', 'done'];

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

// What a short bumper press does, given the phase and the kind of the last undoable
// step (EnergySystem.lastStepKind(): 'add' | 'link' | 'unlink' | null).
//   place:   undo the last step (usually the last asset placed)
//   connect: undo the last connection; when the last step was placing an asset, go back
//            to placing instead (nothing is removed)
//   done:    back to connecting
// Returns 'undo' | 'to-place' | 'to-connect' | 'nothing'.
export function backAction(phase, lastStepKind) {
  if (phase === 'done') return 'to-connect';
  if (phase === 'connect') return lastStepKind === 'link' || lastStepKind === 'unlink' ? 'undo' : 'to-place';
  return lastStepKind ? 'undo' : 'nothing';
}
