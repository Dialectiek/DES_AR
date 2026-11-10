import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  rgbToLab, hexToRgb, rgbToHex, buildColourTable, classifyPixel, planeProjector, worldToTable,
  detectCards, mergeScans, filterNew,
} from '../cards.js';

const config = JSON.parse(fs.readFileSync(new URL('../assets/components.json', import.meta.url), 'utf8'));
// Printed colours only (no "seen" values): the classifier must cope without tuning.
const printed = structuredClone(config);
for (const c of Object.values(printed.colours)) delete c.seen;
const table = buildColourTable(printed);
const tuned = buildColourTable(config);
const nameOf = (t, label) => (label ? t.colours[label - 1].name : null);
const classify = (rgb, t = table) => nameOf(t, classifyPixel(rgb[0], rgb[1], rgb[2], t).label);
const RGB = Object.fromEntries(Object.entries(config.colours).map(([k, c]) => [k, hexToRgb(c.rgb)]));

test('hex and Lab helpers', () => {
  assert.deepEqual(hexToRgb('#ff3131'), [255, 49, 49]);
  assert.equal(rgbToHex([255, 49, 49]), '#ff3131');
  const [L] = rgbToLab(255, 255, 255);
  assert.ok(Math.abs(L - 100) < 0.1);
});

test('classifyPixel: every reference colour is its own class', () => {
  assert.equal(table.colours.length, 12);
  for (const [name, rgb] of Object.entries(RGB)) assert.equal(classify(rgb), name);
});

test('classifyPixel: small print / camera deviations keep the colour', () => {
  for (const [name, rgb] of Object.entries(RGB)) {
    for (const d of [[8, -6, 5], [-8, 6, -5]]) {
      const v = rgb.map((c, i) => Math.max(0, Math.min(255, c + d[i])));
      assert.equal(classify(v), name, `${name} ${v}`);
    }
  }
});

test('classifyPixel: red as the headset camera really sees it is red, not brown', () => {
  // Measured (white-balanced) on the Magic Leap 2: the printed red card reads very dark.
  for (const hex of ['#470600', '#500a01', '#4c0901', '#490700', '#480801']) {
    assert.equal(classify(hexToRgb(hex), tuned), 'red', hex);
  }
  for (const hex of ['#470600', '#500a01', '#4c0901', '#490700', '#480801']) {
    assert.equal(classify(hexToRgb(hex), table), 'red', `${hex} (untuned)`);
  }
  for (const hex of ['#080706', '#121111', '#151313', '#1d0e0e']) {
    assert.equal(classify(hexToRgb(hex), tuned), 'black', hex);
  }
});

test('classifyPixel: table white, tinted white and light shade are not cards', () => {
  for (const rgb of [[240, 240, 240], [255, 255, 255], [222, 222, 220], [235, 238, 245], [242, 236, 222], [205, 205, 203]]) {
    assert.equal(classify(rgb), null, String(rgb));
  }
});

test('classifyPixel: colours far from every reference are not cards', () => {
  assert.equal(classify([255, 0, 255]), null); // magenta
});

test('worldToTable matches the three.js rotation.y convention', () => {
  const t = { cx: 1, cz: -2, yaw: 0.7 };
  const lx = 0.3, lz = -0.1;
  // three.js: world = R_y(yaw) · local + centre
  const wx = t.cx + Math.cos(t.yaw) * lx + Math.sin(t.yaw) * lz;
  const wz = t.cz - Math.sin(t.yaw) * lx + Math.cos(t.yaw) * lz;
  const back = worldToTable(wx, wz, t);
  assert.ok(Math.abs(back.x - lx) < 1e-9 && Math.abs(back.z - lz) < 1e-9);
});

// Camera 1 m above the table (y = 0.75), looking straight down; image up = world -z.
// Same image size as a real scan; one pixel ≈ 6 mm on the table.
const W = 320, H = 240;
const P = new Float32Array(16);
P[0] = 1; P[5] = W / H; P[10] = -1; P[11] = -1; P[14] = -0.02;
const M = new Float32Array([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 1.75, 0, 1]);
const TABLE = { cx: 0, cz: 0, y: 0.75, yaw: 0, length: 1.6, width: 1.2 };

// Paints rectangles { x, z, side (or sx, sz), rot (radians), rgb } (world metres) on a
// white table. exposure: per-channel camera response, applied to everything.
function render(cards, exposure = [1, 1, 1], tableRgb = [240, 240, 240]) {
  const px = new Uint8Array(W * H * 4);
  for (let py = 0; py < H; py++) {
    for (let x = 0; x < W; x++) {
      const vx = (((x + 0.5) / W) * 2 - 1) / P[0];
      const vy = (((py + 0.5) / H) * 2 - 1) / P[5];
      const wx = vx, wz = -vy; // see M above
      // Off the table (1.6 x 1.2 m) is a dark floor.
      let rgb = Math.abs(wx) > 0.8 || Math.abs(wz) > 0.6 ? [70, 62, 55] : tableRgb;
      for (const c of cards) {
        const r = c.rot ?? 0;
        const dx = wx - c.x, dz = wz - c.z;
        const u = dx * Math.cos(r) + dz * Math.sin(r);
        const v = -dx * Math.sin(r) + dz * Math.cos(r);
        if (Math.abs(u) <= (c.sx ?? c.side) / 2 && Math.abs(v) <= (c.sz ?? c.side) / 2) rgb = c.rgb;
      }
      const j = (py * W + x) * 4;
      for (let k = 0; k < 3; k++) px[j + k] = Math.round(rgb[k] * exposure[k]);
      px[j + 3] = 255;
    }
  }
  return px;
}
const detect = (px, t = TABLE, colours = table) => detectCards(px, W, H, P, M, t, colours, config.card);

test('planeProjector: straight down maps pixels to the plane', () => {
  const project = planeProjector(P, M, W, H, 0.75);
  const out = {};
  assert.ok(project(W / 2, H / 2, out));
  assert.ok(Math.abs(out.x - 1 / W) < 1e-6); // half a pixel right of the centre
  let s = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { project(x, y, out); s += out.w; }
  assert.ok(Math.abs(s - 2 * (2 / P[5])) < 1e-6, 'pixel areas add up to the visible area');
});

test('detectCards finds a card, its position, size and area', () => {
  const { detections } = detect(render([{ x: 0.2, z: -0.1, side: 0.08, rgb: RGB.red }]));
  assert.equal(detections.length, 1);
  const d = detections[0];
  assert.equal(d.colour, 'red');
  assert.ok(Math.abs(d.x - 0.2) < 0.006, `x ${d.x}`);
  assert.ok(Math.abs(d.z + 0.1) < 0.006, `z ${d.z}`);
  assert.ok(Math.abs(d.area - 0.0064) / 0.0064 < 0.15, `area ${d.area}`);
  assert.ok(Math.abs(d.sides[0] - 0.08) < 0.01 && Math.abs(d.sides[1] - 0.08) < 0.01, `sides ${d.sides}`);
});

test('detectCards: a rotated card is still a square card at the right place', () => {
  const { detections } = detect(render([{ x: -0.1, z: 0.15, side: 0.1, rot: 0.6, rgb: RGB.blue }]));
  assert.equal(detections.length, 1);
  const d = detections[0];
  assert.ok(Math.hypot(d.x + 0.1, d.z - 0.15) < 0.008, `at ${d.x}, ${d.z}`);
  assert.ok(d.fill > 0.8, `fill ${d.fill}`);
});

test('detectCards: size, shape, and only whole cards on the table', () => {
  const px = render([
    { x: -0.4, z: 0.2, side: 0.08, rgb: RGB.blue },
    { x: 0.4, z: 0.2, side: 0.10, rgb: RGB['dark-green'] },
    { x: 0.0, z: 0.3, side: 0.02, rgb: RGB.red },               // too small
    { x: 0.0, z: -0.3, side: 0.35, rgb: RGB.yellow },           // too big
    { x: -0.3, z: -0.3, sx: 0.18, sz: 0.05, rgb: RGB.purple },  // a strip, not a card
    { x: 0.81, z: 0.0, side: 0.08, rgb: RGB.orange },           // mostly off the table
    { x: 0.95, z: 0.3, side: 0.08, rgb: RGB.orange },           // off the table
  ]);
  const { detections, rejected } = detect(px);
  assert.deepEqual(detections.map((d) => d.colour).sort(), ['blue', 'dark-green']);
  const why = Object.fromEntries(rejected.map((d) => [d.colour, d.reason]));
  assert.equal(why.red, 'too small');
  assert.equal(why.yellow, 'too big');
  assert.equal(why.purple, 'not square');
  assert.match(why.orange, /off the table|not surrounded/);
});

test('detectCards: a ragged dark shadow-like blob is not a card', () => {
  const blob = [];
  for (let k = 0; k < 7; k++) blob.push({ x: 0.1 + k * 0.012, z: 0.1 + (k % 3) * 0.02, side: 0.03, rot: k, rgb: RGB.black });
  blob.push({ x: 0.1, z: 0.16, side: 0.03, rgb: RGB.black });
  const { detections } = detect(render(blob));
  assert.equal(detections.length, 0);
});

test('detectCards: a card whose edge reads as another colour is ONE card', () => {
  // Dark red card with a lighter, orange-ish rim (mixed with the white table).
  const px = render([
    { x: 0.1, z: 0.0, side: 0.10, rgb: [210, 110, 70] },
    { x: 0.1, z: 0.0, side: 0.085, rgb: hexToRgb('#4c0901') },
  ]);
  const { detections } = detect(px, TABLE, tuned);
  assert.equal(detections.length, 1);
  assert.equal(detections[0].colour, 'red');
  assert.ok(Math.abs(detections[0].sides[0] - 0.1) < 0.012, `sides ${detections[0].sides}`);
});

test('detectCards: all 12 colours under dim, warm light (white balance on the table)', () => {
  const names = Object.keys(RGB);
  const cards = names.map((name, i) => ({
    x: -0.6 + (i % 6) * 0.24, z: i < 6 ? -0.2 : 0.2, side: 0.08, rgb: RGB[name], name,
  }));
  const { detections, gain } = detect(render(cards, [0.45, 0.4, 0.33]));
  assert.ok(Math.abs(gain[0] - 1 / 0.45) < 0.05 && Math.abs(gain[2] - 1 / 0.33) < 0.1, `gain ${gain}`);
  for (const c of cards) {
    const d = detections.find((e) => Math.hypot(e.x - c.x, e.z - c.z) < 0.01);
    assert.ok(d, `${c.name} not found`);
    assert.equal(d.colour, c.name);
  }
  assert.equal(detections.length, 12);
});

test('detectCards: the logged headset scene (dark red + black card, warm table)', () => {
  // Raw camera values: table #d2cdb8, red and black as measured, before white balance.
  const g = [0xd2 / 240, 0xcd / 240, 0xb8 / 240];
  const px = render([
    { x: -0.3, z: 0.2, side: 0.1, rgb: hexToRgb('#4c0901').map((v, k) => v * 240 / [0xd2, 0xcd, 0xb8][k]) },
    { x: 0.25, z: 0.1, side: 0.15, rgb: [18, 17, 17] },
  ], g);
  const { detections } = detect(px, TABLE, tuned);
  const byColour = Object.fromEntries(detections.map((d) => [d.colour, d]));
  assert.deepEqual(Object.keys(byColour).sort(), ['black', 'red']);
  assert.ok(Math.hypot(byColour.red.x + 0.3, byColour.red.z - 0.2) < 0.008);
  assert.ok(Math.hypot(byColour.black.x - 0.25, byColour.black.z - 0.1) < 0.008);
});

test('detectCards: positions are table-local when the table is rotated', () => {
  const t = { ...TABLE, yaw: 0.5, cx: 0.05, cz: 0.02 };
  const [d] = detect(render([{ x: 0.25, z: 0.1, side: 0.08, rgb: RGB.red }]), t).detections;
  const expect = worldToTable(0.25, 0.1, t);
  assert.ok(Math.hypot(d.x - expect.x, d.z - expect.z) < 0.008);
});

test('mergeScans: cards seen in most frames, averaged, colour by vote', () => {
  const det = (colour, x, z) => ({ colour, x, z, area: 0.006, sides: [0.08, 0.08], angle: 0, rgb: [250, 50, 50], dist: 0.2 });
  const frames = [
    [det('red', 0.20, 0.10), det('blue', -0.3, 0)],
    [det('brown', 0.21, 0.10)],
    [det('red', 0.20, 0.11)],
    [det('red', 0.19, 0.10), det('red', 0.5, 0.5)],
  ];
  const cards = mergeScans(frames, { radius: 0.06, minFrames: 3 });
  assert.equal(cards.length, 1, 'one card, even though one frame called it brown');
  assert.equal(cards[0].colour, 'red');
  assert.deepEqual(cards[0].votes, { red: 3, brown: 1 });
  assert.ok(Math.abs(cards[0].x - 0.2) < 0.005 && Math.abs(cards[0].z - 0.1025) < 0.005);
  assert.equal(cards[0].frames, 4);
});

test('filterNew drops cards where an asset already is, whatever its colour', () => {
  const cards = [{ colour: 'red', x: 0, z: 0 }, { colour: 'red', x: 0.3, z: 0 }, { colour: 'brown', x: 0.03, z: 0 }];
  const existing = [{ colour: 'red', x: 0.02, z: 0.01 }];
  assert.deepEqual(filterNew(cards, existing, 0.08), [cards[1]]);
});

// ---------------------------------------------------------------------------
// Colour calibration
// ---------------------------------------------------------------------------
import { worldToPixel, sampleCard, balanceColour, alignProjection, pixelShiftToNdc } from '../cards.js';

test('worldToPixel is the inverse of planeProjector', () => {
  const project = planeProjector(P, M, W, H, 0.75);
  const out = {};
  for (const [px, py] of [[10, 20], [160, 120], [300, 200]]) {
    project(px, py, out);
    const back = worldToPixel(P, M, W, H, { x: out.x, y: 0.75, z: out.z });
    assert.ok(Math.abs(back.px - px) < 1e-3 && Math.abs(back.py - py) < 1e-3, `${px},${py} → ${back.px},${back.py}`);
  }
});

// The camera image is shifted 'off' pixels against the view (a misaligned camera).
function shifted(px, off) {
  const out = new Uint8Array(px.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(W - 1, Math.max(0, x - off[0])), sy = Math.min(H - 1, Math.max(0, y - off[1]));
      for (let k = 0; k < 4; k++) out[(y * W + x) * 4 + k] = px[(sy * W + sx) * 4 + k];
    }
  }
  return out;
}

test('sampleCard finds the card near the aimed point, its colour and the image shift', () => {
  const warm = [0.8, 0.75, 0.6];
  const px = shifted(render([
    { x: 0.1, z: -0.05, side: 0.1, rgb: hexToRgb('#4c0901').map((v) => v / 0.8) },
    { x: -0.3, z: 0.2, side: 0.1, rgb: [20, 20, 20] },
  ], warm), [12, -7]);
  const at = worldToPixel(P, M, W, H, { x: 0.1, y: 0.75, z: -0.05 });
  const pxPerM = (P[0] * W) / 2 / at.depth;
  const s = sampleCard(px, W, H, at.px, at.py, 0.15 * pxPerM);
  assert.ok(s, 'card found');
  assert.ok(Math.abs(s.offset.x - 12) < 1.5 && Math.abs(s.offset.y + 7) < 1.5, `offset ${s.offset.x}, ${s.offset.y}`);
  const seen = balanceColour(s.rgb, s.white, table);
  assert.equal(classify(seen, tuned), 'red', rgbToHex(seen));
});

test('session colours: only the calibrated colours, matched against their sampled look', () => {
  const t = buildColourTable(config, {
    only: ['red', 'black', 'blue', 'orange'],
    seen: { red: [75, 8, 1], black: [18, 17, 17], blue: [40, 90, 160], orange: [170, 70, 30] },
  });
  assert.deepEqual(t.colours.map((c) => c.name).sort(), ['black', 'blue', 'orange', 'red']);
  assert.ok(t.colours.every((c) => c.source === 'session'));
  assert.equal(classify([78, 10, 3], t), 'red');
  assert.equal(classify([165, 75, 35], t), 'orange');
  assert.equal(classify([45, 95, 150], t), 'blue');
  assert.equal(classify([22, 20, 21], t), 'black');
  assert.equal(classify(RGB.yellow, t), null, 'yellow is not calibrated, so not detected');
});

test('a measured camera shift puts scanned cards back in the right place', () => {
  const px = shifted(render([{ x: 0.2, z: 0.1, side: 0.1, rgb: RGB.red }]), [15, 9]);
  const wrong = detect(px).detections[0];
  assert.ok(Math.hypot(wrong.x - 0.2, wrong.z - 0.1) > 0.05, 'without correction the card is misplaced');
  const shift = pixelShiftToNdc(15, 9, W, H);
  const fixed = detectCards(px, W, H, alignProjection(P, { shiftX: shift.x, shiftY: shift.y }), M, TABLE, table, config.card).detections[0];
  assert.ok(Math.hypot(fixed.x - 0.2, fixed.z - 0.1) < 0.008, `at ${fixed.x}, ${fixed.z}`);
});

import { samplePatch, nearestColour } from '../cards.js';

test('tap sampling: patch colour → nearest of the 4 calibrated colours, on a beige table', () => {
  const beige = [208, 193, 162];
  const px = render([
    { x: 0.1, z: 0.0, side: 0.06, rgb: [120, 30, 25] },  // red
    { x: -0.2, z: 0.1, side: 0.06, rgb: [40, 60, 110] }, // blue
    { x: 0.3, z: 0.2, side: 0.06, rgb: [200, 170, 40] }, // yellow
    { x: -0.3, z: -0.2, side: 0.06, rgb: [30, 28, 26] }, // black
  ], [1, 1, 1], beige);
  const pxPerM = (P[0] * W) / 2 / 1;
  const look = (x, z) => {
    const at = worldToPixel(P, M, W, H, { x, y: 0.75, z });
    const s = samplePatch(px, W, H, at.px, at.py, 0.015 * pxPerM, 0.2 * pxPerM);
    return balanceColour(s.rgb, s.white, table);
  };
  const seen = { red: look(0.1, 0), blue: look(-0.2, 0.1), yellow: look(0.3, 0.2), black: look(-0.3, -0.2) };
  const t = buildColourTable(config, { only: Object.keys(seen), seen });
  // Same cards, slightly different light at tap time.
  for (const [name, [x, z]] of Object.entries({ red: [0.11, 0.005], blue: [-0.19, 0.1], yellow: [0.3, 0.21], black: [-0.31, -0.2] })) {
    assert.equal(nearestColour(look(x, z).map((v) => v * 0.93), t).name, name);
  }
});

import { sampleSlots } from '../cards.js';

test('slot calibration: finds the camera shift and reads each card from its centre', () => {
  const beige = [208, 193, 162];
  const slotsWorld = [
    { name: 'red', x: -0.225, z: 0.2, rgb: [120, 30, 25] },
    { name: 'black', x: -0.075, z: 0.2, rgb: [30, 28, 26] },
    { name: 'blue', x: 0.075, z: 0.2, rgb: [40, 60, 110] },
    { name: 'yellow', x: 0.225, z: 0.2, rgb: [200, 170, 40] },
  ];
  // Cards lie a bit off in their squares (up to 2 cm), and the camera image is shifted.
  const cards = slotsWorld.map((s, i) => ({ x: s.x + (i % 2 ? 0.02 : -0.01), z: s.z + 0.01, side: 0.1, rgb: s.rgb }));
  const px = shifted(render(cards, [1, 1, 1], beige), [-11, 6]); // ~3.4 cm, ~1.9 cm
  const slots = slotsWorld.map((s) => {
    const at = worldToPixel(P, M, W, H, { x: s.x, y: 0.75, z: s.z });
    return { px: at.px, py: at.py, pxPerM: ((P[0] * W) / 2 + (P[5] * H) / 2) / 2 / at.depth };
  });
  const r = sampleSlots(px, W, H, slots, { inner: 0.025, search: 0.1 });
  assert.ok(Math.abs(r.shift.x + 11) <= 6 && Math.abs(r.shift.y - 6) <= 6, `shift ${r.shift.x}, ${r.shift.y}`);
  assert.ok(r.score > r.scoreNoShift);
  r.samples.forEach((s, i) => {
    const want = slotsWorld[i].rgb;
    assert.ok(s.rgb.every((v, c) => Math.abs(v - want[c]) < 4), `${slotsWorld[i].name}: ${s.rgb} vs ${want}`);
  });
  // The calibrated colours then separate the 4 cards.
  const seen = Object.fromEntries(slotsWorld.map((s, i) => [s.name, balanceColour(r.samples[i].rgb, r.white, table)]));
  const t = buildColourTable(config, { only: Object.keys(seen), seen });
  for (const s of slotsWorld) assert.equal(nearestColour(balanceColour(s.rgb, r.white, table), t).name, s.name);
});
