// Colour-card detection. Pure functions, no three.js, so they run in Node tests too.
//
// A scan works on one small RGBA camera image (row 0 = bottom of the image):
//   1. Project every pixel onto the table plane and keep the ones inside the calibrated
//      table rectangle (table-local metres).
//   2. White balance: the white table covers most of that region, so the median colour
//      there is "table white". Every pixel is scaled so table white becomes the
//      configured tableWhite. This removes camera exposure and light colour.
//   3. Each balanced pixel gets the nearest reference colour (CIELAB distance), or none
//      when table white is nearer or every card colour is too far away.
//   4. Per colour: close small gaps, find connected blobs, measure their area in m².
//      Blobs with a card-like area become detections.
// A full scan runs this on a few frames and keeps what shows up in most of them
// (mergeScans), then drops cards that already have an asset (filterNew).

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------
const LINEAR = new Float64Array(256); // sRGB byte → linear light
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function labF(t) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

// r, g, b in 0..255 (sRGB) → [L, a, b] (CIELAB, D65).
export function rgbToLab(r, g, b) {
  const R = LINEAR[Math.max(0, Math.min(255, Math.round(r)))];
  const G = LINEAR[Math.max(0, Math.min(255, Math.round(g)))];
  const B = LINEAR[Math.max(0, Math.min(255, Math.round(b)))];
  const fx = labF((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const fy = labF(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const fz = labF((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new Error(`not a colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

// components.json → the lookup used for classifying. Label of colours[i] = i + 1.
export function buildColourTable(config) {
  const white = hexToRgb(config.tableWhite ?? '#f0f0f0');
  return {
    white,
    whiteLab: rgbToLab(...white),
    maxDistance: config.maxColourDistance ?? 25,
    colours: Object.entries(config.colours).map(([name, c]) => ({
      name,
      rgb: hexToRgb(c.rgb),
      lab: rgbToLab(...hexToRgb(c.rgb)),
    })),
  };
}

// r, g, b: a white-balanced pixel. Returns { label, dist }: label 0 = table / no card,
// otherwise index into table.colours + 1; dist = Lab distance to that colour.
export function classifyPixel(r, g, b, table) {
  const [L, A, B] = rgbToLab(r, g, b);
  const w = table.whiteLab;
  let best = 0;
  let bestDist = Math.hypot(L - w[0], A - w[1], B - w[2]);
  const cs = table.colours;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i].lab;
    const d = Math.hypot(L - c[0], A - c[1], B - c[2]);
    if (d < bestDist) { best = i + 1; bestDist = d; }
  }
  if (best && bestDist > table.maxDistance) best = 0;
  return { label: best, dist: bestDist };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

// Projects image pixels onto the horizontal plane y = planeY.
//   projection: view.projectionMatrix (column-major), pose: view.transform.matrix.
// Returns project(px, py, out) → true when the pixel hits the plane in front of the
// camera within maxDistance; out gets x, z (world) and w (m² the pixel covers there).
export function planeProjector(projection, pose, w, h, planeY, maxDistance = Infinity) {
  const P = projection, M = pose;
  const ox = M[12], oy = M[13], oz = M[14];
  const pixelArea = (2 / (w * P[0])) * (2 / (h * P[5])); // pixel size at 1 m depth
  return function project(px, py, out) {
    const vx = (((px + 0.5) / w) * 2 - 1 + P[8]) / P[0];
    const vy = (((py + 0.5) / h) * 2 - 1 + P[9]) / P[5];
    // View-space direction (vx, vy, -1) rotated into the reference space.
    const dx = M[0] * vx + M[4] * vy - M[8];
    const dy = M[1] * vx + M[5] * vy - M[9];
    const dz = M[2] * vx + M[6] * vy - M[10];
    if (Math.abs(dy) < 1e-5) return false;
    const s = (planeY - oy) / dy; // depth along the view axis
    if (!(s > 0)) return false;
    if (s * Math.hypot(dx, dy, dz) > maxDistance) return false;
    out.x = ox + s * dx;
    out.z = oz + s * dz;
    out.w = ((s * s) / Math.abs(dy)) * pixelArea;
    return true;
  };
}

// World (x, z) → table-local (x, z). The table group has rotation.y = yaw.
export function worldToTable(x, z, table) {
  const dx = x - table.cx, dz = z - table.cz;
  const c = Math.cos(table.yaw), s = Math.sin(table.yaw);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

// ---------------------------------------------------------------------------
// Binary morphology (4-neighbour)
// ---------------------------------------------------------------------------
export function dilate(src, dst, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      dst[i] = src[i] || (x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) ||
        (y > 0 && src[i - w]) || (y < h - 1 && src[i + w]) ? 1 : 0;
    }
  }
}

export function erode(src, dst, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      dst[i] = src[i] && (x === 0 || src[i - 1]) && (x === w - 1 || src[i + 1]) &&
        (y === 0 || src[i - w]) && (y === h - 1 || src[i + w]) ? 1 : 0;
    }
  }
}

// ---------------------------------------------------------------------------
// One frame
// ---------------------------------------------------------------------------
const buffers = new Map(); // per image size, reused between calls

function scratchFor(w, h) {
  const key = w + 'x' + h;
  let b = buffers.get(key);
  if (!b) {
    const n = w * h;
    b = {
      inside: new Uint8Array(n),   // pixel lies on the table (inside the margin)
      labelMap: new Uint8Array(n), // colour label per pixel
      mask: new Uint8Array(n),
      tmp: new Uint8Array(n),
      closed: new Uint8Array(n),
      seen: new Uint8Array(n),
      stack: new Int32Array(n),
      lx: new Float32Array(n),
      lz: new Float32Array(n),
      wt: new Float32Array(n),
      hist: [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)],
    };
    buffers.set(key, b);
  }
  return b;
}

function histMedian(hist, total) {
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc * 2 >= total) return v;
  }
  return 255;
}

// pixels: RGBA Uint8Array (w*h*4). table: { cx, cz, y, yaw, length, width } in metres.
// colourTable: from buildColourTable. cardCfg: the "card" section of components.json.
// Returns { detections, rejected, labelMap, gain, tableColour }.
//   detections / rejected: [{ colour, x, z, area, count, rgb, dist }]; x, z table-local,
//   rgb = mean white-balanced colour (what to put in components.json to tune), dist =
//   mean Lab distance to the reference colour. rejected = colour blobs of the wrong size.
export function detectCards(pixels, w, h, projection, pose, table, colourTable, cardCfg = {}, opts = {}) {
  const n = w * h;
  const { inside, labelMap, mask, tmp, closed, seen, stack, lx, lz, wt, hist } = scratchFor(w, h);
  inside.fill(0);
  labelMap.fill(0);
  for (const hc of hist) hc.fill(0);
  const margin = cardCfg.tableMargin_m ?? 0.02;
  const halfL = table.length / 2 - margin;
  const halfW = table.width / 2 - margin;
  const project = planeProjector(projection, pose, w, h, table.y, opts.maxDistance ?? 6);
  const hit = { x: 0, z: 0, w: 0 };

  // 1) Which pixels lie on the table, and the table's colour (per-channel median).
  let onTable = 0;
  for (let py = 0, i = 0; py < h; py++) {
    for (let px = 0; px < w; px++, i++) {
      if (!project(px, py, hit)) continue;
      const local = worldToTable(hit.x, hit.z, table);
      if (Math.abs(local.x) > halfL || Math.abs(local.z) > halfW) continue;
      inside[i] = 1;
      lx[i] = local.x;
      lz[i] = local.z;
      wt[i] = hit.w;
      const j = i * 4;
      hist[0][pixels[j]]++; hist[1][pixels[j + 1]]++; hist[2][pixels[j + 2]]++;
      onTable++;
    }
  }
  if (onTable < 50) return { detections: [], rejected: [], labelMap, gain: null, tableColour: null };

  // 2) White balance against the table.
  const tableColour = hist.map((hc) => histMedian(hc, onTable));
  const gain = tableColour.map((v, c) => Math.min(8, Math.max(0.5, colourTable.white[c] / Math.max(v, 1))));
  const used = new Uint8Array(colourTable.colours.length + 1);

  // 3) Classify.
  for (let i = 0; i < n; i++) {
    if (!inside[i]) continue;
    const j = i * 4;
    const { label } = classifyPixel(
      Math.min(255, pixels[j] * gain[0]), Math.min(255, pixels[j + 1] * gain[1]), Math.min(255, pixels[j + 2] * gain[2]),
      colourTable
    );
    if (label) { labelMap[i] = label; used[label] = 1; }
  }

  // 4) Blobs per colour.
  const minSide = cardCfg.minSide_m ?? 0.04;
  const maxSide = cardCfg.maxSide_m ?? 0.2;
  const minArea = minSide * minSide;
  const maxArea = maxSide * maxSide;
  const detections = [];
  const rejected = [];

  for (let label = 1; label <= colourTable.colours.length; label++) {
    if (!used[label]) continue;
    for (let i = 0; i < n; i++) mask[i] = labelMap[i] === label ? 1 : 0;
    dilate(mask, tmp, w, h); // close 1-pixel gaps (glare, print texture)
    erode(tmp, closed, w, h);
    seen.fill(0);

    for (let start = 0; start < n; start++) {
      if (!closed[start] || seen[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let area = 0, sx = 0, sz = 0, count = 0, sr = 0, sg = 0, sb = 0;
      while (sp > 0) {
        const i = stack[--sp];
        if (labelMap[i] === label) { // closed-in gap pixels don't count
          const wi = wt[i];
          area += wi; sx += wi * lx[i]; sz += wi * lz[i]; count++;
          const j = i * 4;
          sr += Math.min(255, pixels[j] * gain[0]);
          sg += Math.min(255, pixels[j + 1] * gain[1]);
          sb += Math.min(255, pixels[j + 2] * gain[2]);
        }
        const x = i % w;
        const y = (i - x) / w;
        if (x > 0 && closed[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[sp++] = i - 1; }
        if (x < w - 1 && closed[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[sp++] = i + 1; }
        if (y > 0 && closed[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[sp++] = i - w; }
        if (y < h - 1 && closed[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[sp++] = i + w; }
      }
      if (count < 4 || area <= 0) continue;
      const rgb = [sr / count, sg / count, sb / count];
      const ref = colourTable.colours[label - 1].lab;
      const lab = rgbToLab(...rgb);
      const d = {
        colour: colourTable.colours[label - 1].name,
        x: sx / area,
        z: sz / area,
        area,
        count,
        rgb,
        dist: Math.hypot(lab[0] - ref[0], lab[1] - ref[1], lab[2] - ref[2]),
      };
      if (area < minArea || area > maxArea) rejected.push(d);
      else detections.push(d);
    }
  }
  return { detections, rejected, labelMap, gain, tableColour };
}

// ---------------------------------------------------------------------------
// Several frames → stable cards
// ---------------------------------------------------------------------------

// frames: array of detection arrays (one per frame). Detections of the same colour
// closer than 'radius' are one card. Cards seen in fewer than minFrames frames are dropped.
export function mergeScans(frames, { radius = 0.04, minFrames = 3 } = {}) {
  const clusters = [];
  frames.forEach((dets, f) => {
    for (const d of dets) {
      let best = null, bestDist = radius;
      for (const c of clusters) {
        if (c.colour !== d.colour) continue;
        const dist = Math.hypot(c.x - d.x, c.z - d.z);
        if (dist < bestDist) { best = c; bestDist = dist; }
      }
      if (!best) {
        best = { colour: d.colour, x: d.x, z: d.z, items: [], frames: new Set() };
        clusters.push(best);
      }
      best.items.push(d);
      best.frames.add(f);
      const k = best.items.length;
      best.x += (d.x - best.x) / k;
      best.z += (d.z - best.z) / k;
    }
  });
  return clusters
    .filter((c) => c.frames.size >= minFrames)
    .map((c) => {
      const k = c.items.length;
      const avg = (fn) => c.items.reduce((s, d) => s + fn(d), 0) / k;
      return {
        colour: c.colour, x: c.x, z: c.z,
        area: avg((d) => d.area),
        rgb: [0, 1, 2].map((ch) => avg((d) => d.rgb[ch])),
        dist: avg((d) => d.dist),
        frames: c.frames.size,
      };
    });
}

// Drops cards that already have an asset of the same colour within 'distance'.
// existing: [{ colour, x, z }] in table-local metres.
export function filterNew(cards, existing, distance = 0.06) {
  return cards.filter((c) => !existing.some(
    (e) => e.colour === c.colour && Math.hypot(e.x - c.x, e.z - c.z) < distance
  ));
}
