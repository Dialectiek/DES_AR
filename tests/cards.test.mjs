import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  rgbToLab, hexToRgb, rgbToHex, buildColourTable, classifyPixel, planeProjector, worldToTable,
  detectCards, mergeScans, filterNew,
} from '../cards.js';

const config = JSON.parse(fs.readFileSync(new URL('../assets/components.json', import.meta.url), 'utf8'));
const table = buildColourTable(config);
const nameOf = (label) => (label ? table.colours[label - 1].name : null);
const classify = (rgb) => nameOf(classifyPixel(rgb[0], rgb[1], rgb[2], table).label);
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

test('classifyPixel: table white and light shadow are not cards', () => {
  for (const rgb of [[240, 240, 240], [255, 255, 255], [222, 222, 220], [235, 238, 245]]) {
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
const W = 160, H = 120;
const P = new Float32Array(16);
P[0] = 1; P[5] = W / H; P[10] = -1; P[11] = -1; P[14] = -0.02;
const M = new Float32Array([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 1.75, 0, 1]);
const TABLE = { cx: 0, cz: 0, y: 0.75, yaw: 0, length: 1.6, width: 1.2 };

// Paints axis-aligned squares { x, z, side, rgb } (world metres) on a white table.
// exposure: per-channel camera response (dim, tinted light), applied to everything.
function render(cards, exposure = [1, 1, 1]) {
  const px = new Uint8Array(W * H * 4);
  for (let py = 0; py < H; py++) {
    for (let x = 0; x < W; x++) {
      const vx = (((x + 0.5) / W) * 2 - 1) / P[0];
      const vy = (((py + 0.5) / H) * 2 - 1) / P[5];
      const wx = vx, wz = -vy; // see M above
      let rgb = [240, 240, 240];
      for (const c of cards) {
        if (Math.abs(wx - c.x) <= c.side / 2 && Math.abs(wz - c.z) <= c.side / 2) rgb = c.rgb;
      }
      const j = (py * W + x) * 4;
      for (let k = 0; k < 3; k++) px[j + k] = Math.round(rgb[k] * exposure[k]);
      px[j + 3] = 255;
    }
  }
  return px;
}

test('planeProjector: straight down maps pixels to the plane', () => {
  const project = planeProjector(P, M, W, H, 0.75);
  const out = {};
  assert.ok(project(W / 2, H / 2, out));
  assert.ok(Math.abs(out.x - 0.00625) < 1e-6); // half a pixel right of the centre
  const total = (() => {
    let s = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { project(x, y, out); s += out.w; }
    return s;
  })();
  assert.ok(Math.abs(total - 2 * (2 / P[5])) < 1e-6, 'pixel areas add up to the visible area');
});

test('detectCards finds a card, its position and area', () => {
  const px = render([{ x: 0.2, z: -0.1, side: 0.08, rgb: RGB.red }]);
  const { detections } = detectCards(px, W, H, P, M, TABLE, table, config.card);
  assert.equal(detections.length, 1);
  const d = detections[0];
  assert.equal(d.colour, 'red');
  assert.ok(Math.abs(d.x - 0.2) < 0.01, `x ${d.x}`);
  assert.ok(Math.abs(d.z + 0.1) < 0.01, `z ${d.z}`);
  assert.ok(Math.abs(d.area - 0.0064) / 0.0064 < 0.25, `area ${d.area}`);
  assert.ok(d.dist < 3, `dist ${d.dist}`);
});

test('detectCards: several colours, size filter, outside the table', () => {
  const px = render([
    { x: -0.4, z: 0.2, side: 0.08, rgb: RGB.blue },
    { x: 0.4, z: 0.2, side: 0.10, rgb: RGB['dark-green'] },
    { x: 0.0, z: 0.3, side: 0.02, rgb: RGB.red },     // too small
    { x: 0.0, z: -0.3, side: 0.35, rgb: RGB.yellow }, // too big
    { x: 0.95, z: 0.0, side: 0.08, rgb: RGB.orange }, // off the table (half-length 0.8)
  ]);
  const { detections, rejected } = detectCards(px, W, H, P, M, TABLE, table, config.card);
  assert.deepEqual(detections.map((d) => d.colour).sort(), ['blue', 'dark-green']);
  assert.deepEqual(rejected.map((d) => d.colour).sort(), ['red', 'yellow']);
});

test('detectCards: all 12 colours under dim, warm light (white balance on the table)', () => {
  const names = Object.keys(RGB);
  const cards = names.map((name, i) => ({
    x: -0.6 + (i % 6) * 0.24, z: i < 6 ? -0.2 : 0.2, side: 0.08, rgb: RGB[name], name,
  }));
  const px = render(cards, [0.45, 0.4, 0.33]);
  const { detections, gain } = detectCards(px, W, H, P, M, TABLE, table, config.card);
  assert.ok(Math.abs(gain[0] - 1 / 0.45) < 0.05 && Math.abs(gain[2] - 1 / 0.33) < 0.1, `gain ${gain}`);
  for (const c of cards) {
    const d = detections.find((e) => Math.hypot(e.x - c.x, e.z - c.z) < 0.02);
    assert.ok(d, `${c.name} not found`);
    assert.equal(d.colour, c.name);
  }
  assert.equal(detections.length, 12);
});

test('detectCards: positions are table-local when the table is rotated', () => {
  const yaw = 0.5;
  const t = { ...TABLE, yaw, cx: 0.05, cz: 0.02 };
  const px = render([{ x: 0.25, z: 0.1, side: 0.08, rgb: RGB.red }]);
  const [d] = detectCards(px, W, H, P, M, t, table, config.card).detections;
  const expect = worldToTable(0.25, 0.1, t);
  assert.ok(Math.hypot(d.x - expect.x, d.z - expect.z) < 0.01);
});

test('mergeScans keeps cards seen in most frames and averages them', () => {
  const red = (x, z) => ({ colour: 'red', x, z, area: 0.006, rgb: [250, 50, 50], dist: 4 });
  const blue = { colour: 'blue', x: -0.3, z: 0, area: 0.006, rgb: [50, 170, 240], dist: 3 };
  const frames = [
    [red(0.20, 0.10), blue],
    [red(0.21, 0.10)],
    [red(0.20, 0.11)],
    [red(0.19, 0.10), { ...red(0.5, 0.5) }],
  ];
  const cards = mergeScans(frames, { radius: 0.04, minFrames: 3 });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].colour, 'red');
  assert.ok(Math.abs(cards[0].x - 0.2) < 0.005 && Math.abs(cards[0].z - 0.1025) < 0.005);
  assert.equal(cards[0].frames, 4);
});

test('filterNew drops cards that already have an asset of that colour', () => {
  const cards = [{ colour: 'red', x: 0, z: 0 }, { colour: 'red', x: 0.3, z: 0 }, { colour: 'blue', x: 0.01, z: 0 }];
  const existing = [{ colour: 'red', x: 0.02, z: 0.01 }];
  assert.deepEqual(filterNew(cards, existing, 0.06), [cards[1], cards[2]]);
});
