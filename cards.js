// Colour-card detection. Pure functions, no three.js, so they run in Node tests too.
//
// A scan works on one small RGBA camera image (row 0 = bottom of the image):
//   1. Project every pixel onto the table plane and keep only the ones inside the
//      calibrated table rectangle (minus a margin). Everything else is ignored.
//   2. White balance on the table: the median colour of those pixels is the table, and
//      every pixel is scaled so the table becomes tableWhite. This removes the camera
//      exposure and the colour of the room light.
//   3. Each pixel is "table" or "card". Card colours are matched by HUE first (hue stays
//      put under room light and exposure, lightness does not: printed colours look much
//      darker to the camera than their hex code), then lightness and chroma. Black and
//      grey are told apart by lightness only. Light shade on the table stays "table".
//   4. Card pixels of ALL colours are grouped into blobs together, so a card whose edges
//      read as a slightly different colour stays one card. A blob is a card only when it
//      is card-sized, square-ish, filled like a rectangle, and lies fully on the table
//      (not touching the table edge or the edge of the camera image).
//   5. The card's colour comes from its inner pixels (median), not from single pixels.
// A scan runs this on several frames, keeps cards seen in most of them (mergeScans: one
// card per place, colour by vote) and drops cards that already have an asset (filterNew).

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

const hueOf = (lab) => (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;

// Lightness L, chroma C and hue h (degrees) of an sRGB colour: handy in the log.
export function describeColour(rgb) {
  const lab = rgbToLab(...rgb);
  return { L: Math.round(lab[0]), C: Math.round(Math.hypot(lab[1], lab[2])), h: Math.round((hueOf(lab) + 360) % 360) };
}

// components.json → the lookup used for classifying. Label of colours[i] = i + 1.
// Per colour the reference is, in this order: session.seen[name] (sampled from the card
// at the start of this session, white-balanced), config "seen", the printed "rgb".
// session.only: use only these colours (the ones calibrated this session).
export function buildColourTable(config, session = {}) {
  const white = hexToRgb(config.tableWhite ?? '#f0f0f0');
  const m = config.matching ?? {};
  return {
    white,
    whiteLab: rgbToLab(...white),
    hueTol: m.hueTolerance_deg ?? 16,
    lightTol: m.lightnessTolerance ?? 45,
    chromaTol: m.chromaTolerance ?? 80,
    greyTol: m.greyLightnessTolerance ?? 15,
    colourless: m.colourlessChroma ?? 10,
    shade: m.tableShade ?? 10,
    maxScore: m.maxScore ?? 1.2,
    colours: Object.entries(config.colours)
      .filter(([name]) => !session.only || session.only.includes(name))
      .map(([name, c]) => {
        const sampled = session.seen?.[name];
        const rgb = sampled ? sampled.map((v) => Math.round(v)) : hexToRgb(c.seen ?? c.rgb);
        const lab = rgbToLab(...rgb);
        const chroma = Math.hypot(lab[1], lab[2]);
        return {
          name, rgb, lab, chroma, hue: hueOf(lab), grey: chroma < 12,
          source: sampled ? 'session' : c.seen ? 'seen' : 'printed',
        };
      }),
  };
}

// L, A, B: a white-balanced pixel in Lab. Returns { label, dist }: label 0 = table / no
// card, otherwise index into table.colours + 1; dist = match score (0 = perfect, the
// colour is accepted up to table.maxScore; roughly "how many tolerances away").
export function classifyLab(L, A, B, t) {
  const C = Math.hypot(A, B);
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  // Table: light and colourless. Up to 'shade' darker than the table is free (soft shadow).
  let best = 0;
  let bestScore = Math.max(0, t.whiteLab[0] - t.shade - L) / 20 + Math.max(0, C - t.colourless) / 10;
  const cs = t.colours;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    let s;
    if (c.grey) {
      if (C > t.colourless * 1.6) continue;
      s = Math.abs(L - c.lab[0]) / t.greyTol + C / (t.colourless * 2);
    } else {
      // A colour needs some colourfulness, or its hue is just noise.
      if (C < Math.max(t.colourless * 0.8, 0.3 * c.chroma)) continue;
      let dh = Math.abs(h - c.hue) % 360;
      if (dh > 180) dh = 360 - dh;
      // The camera makes printed colours darker and duller, never lighter: going that way
      // costs less.
      const dL = L - c.lab[0], dC = C - c.chroma;
      s = Math.hypot(
        dh / t.hueTol,
        dL / (dL < 0 ? 1.5 * t.lightTol : t.lightTol),
        dC / (dC < 0 ? 1.5 * t.chromaTol : t.chromaTol)
      );
    }
    if (s < bestScore) { best = i + 1; bestScore = s; }
  }
  if (best && bestScore > t.maxScore) best = 0;
  return { label: best, dist: bestScore };
}

// r, g, b: a white-balanced pixel (0..255). Same result as classifyLab.
export function classifyPixel(r, g, b, table) {
  const [L, A, B] = rgbToLab(r, g, b);
  return classifyLab(L, A, B, table);
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
      inside: new Uint8Array(n),   // pixel lies in the search area (table + band)
      white: new Uint8Array(n),    // pixel is white table
      labelMap: new Uint8Array(n), // colour label per pixel (0 = table)
      blobMap: new Uint8Array(n),  // 1 = pixel of an accepted card, 2 = of a rejected blob
      mask: new Uint8Array(n),
      tmp: new Uint8Array(n),
      closed: new Uint8Array(n),
      comp: new Int32Array(n),     // blob number per pixel (0 = none)
      ring: new Int32Array(n),     // blob whose surroundings include this pixel
      queue: new Int32Array(n),
      lx: new Float32Array(n),
      lz: new Float32Array(n),
      wt: new Float32Array(n),
    };
    buffers.set(key, b);
  }
  return b;
}

function median(values, count) {
  const a = values.subarray(0, count).sort();
  return count ? a[count >> 1] : 0;
}

// Table white = the brightest quarter of the given pixels (75th–97th percentile of
// brightness). Unlike the median this still works when the area also covers floor,
// hands or cards, as long as some white table is in view. Returns [r, g, b] or null.
// pick(i) → true for the pixels to use.
function estimateWhite(pixels, n, pick) {
  const hist = new Uint32Array(256);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (!pick(i)) continue;
    const j = i * 4;
    hist[(pixels[j] * 77 + pixels[j + 1] * 150 + pixels[j + 2] * 29) >> 8]++;
    total++;
  }
  if (total < 30) return null;
  let acc = 0, lo = -1, hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (lo < 0 && acc >= total * 0.75) lo = v;
    if (acc >= total * 0.97) { hi = v; break; }
  }
  let r = 0, g = 0, b = 0, k = 0;
  for (let i = 0; i < n; i++) {
    if (!pick(i)) continue;
    const j = i * 4;
    const y = (pixels[j] * 77 + pixels[j + 1] * 150 + pixels[j + 2] * 29) >> 8;
    if (y < lo || y > hi) continue;
    r += pixels[j]; g += pixels[j + 1]; b += pixels[j + 2]; k++;
  }
  return k ? [r / k, g / k, b / k] : null;
}

// pixels: RGBA Uint8Array (w*h*4). table: { cx, cz, y, yaw, length, width } in metres.
// colourTable: from buildColourTable. cardCfg: the "card" section of components.json.
// Returns { detections, rejected, labelMap, blobMap, inside, gain, tableColour }.
//   detections / rejected: [{ colour, x, z, area, sides: [long, short], angle, fill,
//   count, rgb, dist, whiteAround, reason? }]. x, z = card centre, table-local metres;
//   angle = card direction (radians, table-local); rgb = median white-balanced colour of
//   the card; dist = match score; whiteAround = share of white table right around the
//   blob; reason = why a blob was rejected.
//
// The search area is the table rectangle plus a band around it (searchMargin_m), in case
// the camera image and the head pose don't line up exactly. What makes a blob a card on
// the table is that it is surrounded by white table and its centre lies on the table.
export function detectCards(pixels, w, h, projection, pose, table, colourTable, cardCfg = {}, opts = {}) {
  const n = w * h;
  const S = scratchFor(w, h);
  const { inside, labelMap, blobMap, white, mask, tmp, closed, comp, ring, queue, lx, lz, wt } = S;
  inside.fill(0);
  labelMap.fill(0);
  blobMap.fill(0);
  white.fill(0);
  comp.fill(0);
  ring.fill(0);
  const search = cardCfg.searchMargin_m ?? 0.08;
  const project = planeProjector(projection, pose, w, h, table.y, opts.maxDistance ?? 6);
  const hit = { x: 0, z: 0, w: 0 };
  const empty = { detections: [], rejected: [], labelMap, blobMap, inside, gain: null, tableColour: null };

  // 1) Pixels in the search area (table + band), with their table-local position.
  let onTable = 0;
  for (let py = 0, i = 0; py < h; py++) {
    for (let px = 0; px < w; px++, i++) {
      if (!project(px, py, hit)) continue;
      const local = worldToTable(hit.x, hit.z, table);
      if (Math.abs(local.x) > table.length / 2 + search || Math.abs(local.z) > table.width / 2 + search) continue;
      inside[i] = 1;
      lx[i] = local.x;
      lz[i] = local.z;
      wt[i] = hit.w;
      onTable++;
    }
  }
  if (onTable < 50) return empty;

  // 2) White balance against the table white (opts.white: measured elsewhere, e.g. at
  //    the colour calibration; otherwise from this image).
  const tableColour = estimateWhite(pixels, n, (i) => inside[i]) ?? opts.white;
  if (!tableColour) return empty;
  const gain = tableColour.map((v, c) => Math.min(8, Math.max(0.5, colourTable.white[c] / Math.max(v, 1))));
  const bal = (i, c) => Math.min(255, pixels[i * 4 + c] * gain[c]);

  // 3) Classify: card colour, white table, or neither (shade, floor, ...).
  const whiteL = colourTable.whiteLab[0] - 22;
  const whiteC = colourTable.colourless * 1.5;
  for (let i = 0; i < n; i++) {
    mask[i] = 0;
    if (!inside[i]) continue;
    const [L, A, B] = rgbToLab(bal(i, 0), bal(i, 1), bal(i, 2));
    const { label } = classifyLab(L, A, B, colourTable);
    labelMap[i] = label;
    mask[i] = label ? 1 : 0;
    if (!label && L >= whiteL && Math.hypot(A, B) <= whiteC) white[i] = 1;
  }

  // 4) Blobs of card pixels (all colours together). Closing fills 1-pixel gaps (glare,
  //    print texture) without joining cards that lie a few centimetres apart.
  dilate(mask, tmp, w, h);
  erode(tmp, closed, w, h);
  for (let i = 0; i < n; i++) if (!inside[i]) closed[i] = 0;

  const minSide = cardCfg.minSide_m ?? 0.04;
  const maxSide = cardCfg.maxSide_m ?? 0.22;
  const maxAspect = cardCfg.maxAspect ?? 1.7;
  const minFill = cardCfg.minFill ?? 0.65;
  const minWhite = cardCfg.minWhiteAround ?? 0.5;
  const onTableTol = cardCfg.centreTolerance_m ?? 0.03;
  const nColours = colourTable.colours.length;
  const detections = [];
  const rejected = [];
  const rs = new Float32Array(n), gs = new Float32Array(n), bs = new Float32Array(n);
  const votes = new Float64Array(nColours + 1);
  const RING = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [2, -2], [-2, 2], [-2, -2], [3, 0], [-3, 0], [0, 3], [0, -3]];
  let compId = 0;

  for (let start = 0; start < n; start++) {
    if (!closed[start] || comp[start]) continue;
    compId++;
    // Flood fill; the queue ends up holding every pixel of the blob.
    let head = 0, tail = 0;
    queue[tail++] = start;
    comp[start] = compId;
    let atImageEdge = false;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) atImageEdge = true;
      if (x > 0 && closed[i - 1] && !comp[i - 1]) { comp[i - 1] = compId; queue[tail++] = i - 1; }
      if (x < w - 1 && closed[i + 1] && !comp[i + 1]) { comp[i + 1] = compId; queue[tail++] = i + 1; }
      if (y > 0 && closed[i - w] && !comp[i - w]) { comp[i - w] = compId; queue[tail++] = i - w; }
      if (y < h - 1 && closed[i + w] && !comp[i + w]) { comp[i + w] = compId; queue[tail++] = i + w; }
    }

    // Area and centre of mass (only real card pixels, not the closed-in gaps).
    let area = 0, sx = 0, sz = 0, count = 0, sw = 0;
    for (let k = 0; k < tail; k++) {
      const i = queue[k];
      if (!labelMap[i]) continue;
      const wi = wt[i];
      area += wi; sx += wi * lx[i]; sz += wi * lz[i]; count++;
      sw += Math.sqrt(wi);
    }
    if (count < 6 || area <= 0) continue; // specks: not worth reporting
    const mx = sx / area, mz = sz / area;

    // What surrounds the blob, 2–3 pixels out: a card on the table is ringed by white.
    let ringAll = 0, ringWhite = 0;
    for (let k = 0; k < tail; k++) {
      const i = queue[k];
      const x = i % w;
      const y = (i - x) / w;
      for (const [ox, oy] of RING) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const r = yy * w + xx;
        if (comp[r] === compId || ring[r] === compId) continue;
        ring[r] = compId;
        ringAll++;
        if (white[r]) ringWhite++;
      }
    }
    const whiteAround = ringAll ? ringWhite / ringAll : 0;

    // Card direction = the rotation with the smallest bounding box (moments can't tell
    // the direction of a square), searched in 3° steps over 0..90°.
    let angle = 0, u0 = 0, u1 = 0, v0 = 0, v1 = 0, bestBox = Infinity;
    for (let step = 0; step < 30; step++) {
      const a = (step * Math.PI) / 60;
      const ca = Math.cos(a), sa = Math.sin(a);
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let k = 0; k < tail; k++) {
        const i = queue[k];
        if (!labelMap[i]) continue;
        const u = (lx[i] - mx) * ca + (lz[i] - mz) * sa;
        const v = -(lx[i] - mx) * sa + (lz[i] - mz) * ca;
        if (u < a0) a0 = u; if (u > a1) a1 = u;
        if (v < b0) b0 = v; if (v > b1) b1 = v;
      }
      const box = (a1 - a0) * (b1 - b0);
      if (box < bestBox) { bestBox = box; angle = a; u0 = a0; u1 = a1; v0 = b0; v1 = b1; }
    }
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const pixelSide = sw / count; // each pixel centre stands for a cell this wide
    const eu = u1 - u0 + pixelSide, ev = v1 - v0 + pixelSide;
    const long = Math.max(eu, ev), short = Math.min(eu, ev);
    const fill = area / (eu * ev);
    // Card centre = centre of its box (steadier than the centre of mass when a corner
    // reads badly).
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    const x = mx + cu * ca - cv * sa;
    const z = mz + cu * sa + cv * ca;

    // Colour from the inner pixels (edges mix with the table), median per channel.
    let m = 0;
    votes.fill(0);
    for (let k = 0; k < tail; k++) {
      const i = queue[k];
      const label = labelMap[i];
      if (!label) continue;
      votes[label] += wt[i];
      if (comp[i - 1] !== compId || comp[i + 1] !== compId || comp[i - w] !== compId || comp[i + w] !== compId) continue;
      rs[m] = bal(i, 0); gs[m] = bal(i, 1); bs[m] = bal(i, 2); m++;
    }
    if (m < 4) { // thin blob: use every card pixel
      m = 0;
      for (let k = 0; k < tail; k++) {
        const i = queue[k];
        if (!labelMap[i]) continue;
        rs[m] = bal(i, 0); gs[m] = bal(i, 1); bs[m] = bal(i, 2); m++;
      }
    }
    const rgb = [median(rs, m), median(gs, m), median(bs, m)];
    let { label, dist } = classifyPixel(rgb[0], rgb[1], rgb[2], colourTable);
    if (!label) { // the median is ambiguous: fall back to the pixel majority
      for (let c = 1; c <= nColours; c++) if (votes[c] > (votes[label] || 0)) label = c;
    }

    const d = {
      colour: label ? colourTable.colours[label - 1].name : null,
      x, z, area,
      sides: [long, short],
      angle,
      fill,
      whiteAround,
      count,
      rgb,
      dist,
    };
    if (atImageEdge) d.reason = 'cut off by the camera view';
    else if (short < minSide || area < minSide * minSide) d.reason = 'too small';
    else if (long > maxSide) d.reason = 'too big';
    else if (long / short > maxAspect) d.reason = 'not square';
    else if (fill < minFill) d.reason = 'not a filled rectangle';
    else if (whiteAround < minWhite) d.reason = 'not surrounded by white table';
    else if (Math.abs(x) > table.length / 2 + onTableTol || Math.abs(z) > table.width / 2 + onTableTol) d.reason = 'off the table';
    else if (!d.colour) d.reason = 'unknown colour';

    const mark = d.reason ? 2 : 1;
    for (let k = 0; k < tail; k++) if (labelMap[queue[k]]) blobMap[queue[k]] = mark;
    (d.reason ? rejected : detections).push(d);
  }
  return { detections, rejected, labelMap, blobMap, inside, gain, tableColour };
}

// ---------------------------------------------------------------------------
// Colour calibration: sample one card the user points at
// ---------------------------------------------------------------------------

// World point → image pixel (px, py with row 0 = bottom) and depth, or null when the
// point is behind the camera. projection / pose as for planeProjector.
export function worldToPixel(projection, pose, w, h, point) {
  const M = pose, P = projection;
  const dx = point.x - M[12], dy = point.y - M[13], dz = point.z - M[14];
  // View space = inverse rotation (transpose) of the pose.
  const vx = M[0] * dx + M[1] * dy + M[2] * dz;
  const vy = M[4] * dx + M[5] * dy + M[6] * dz;
  const vz = M[8] * dx + M[9] * dy + M[10] * dz;
  if (vz >= -1e-3) return null;
  const depth = -vz;
  const ndcX = (P[0] * vx) / depth - P[8];
  const ndcY = (P[5] * vy) / depth - P[9];
  return { px: ((ndcX + 1) / 2) * w - 0.5, py: ((ndcY + 1) / 2) * h - 0.5, depth, ndcX, ndcY };
}

// Pixel shift (image pixels) → the same shift in NDC units, for alignProjection.
export function pixelShiftToNdc(dxPx, dyPx, w, h) {
  return { x: (2 * dxPx) / w, y: (2 * dyPx) / h };
}

// Shifts the camera image relative to the view by (shiftX, shiftY) NDC: corrects a
// camera image that doesn't line up exactly with the eye view it comes with.
export function alignProjection(projection, a) {
  const Q = Float32Array.from(projection);
  if (!a) return Q;
  Q[8] -= a.shiftX ?? 0;
  Q[9] -= a.shiftY ?? 0;
  return Q;
}

// Finds the card around pixel (cx, cy): the biggest non-white blob near that point
// within 'radius' pixels. Returns { rgb (raw camera colour, median of the inner pixels),
// white (raw table white nearby), px, py (blob centre), count, offset (pixels from the
// aimed point) } or null.
export function sampleCard(pixels, w, h, cx, cy, radius, opts = {}) {
  const R = Math.max(4, Math.round(radius));
  const x0 = Math.max(0, Math.round(cx) - 2 * R), x1 = Math.min(w - 1, Math.round(cx) + 2 * R);
  const y0 = Math.max(0, Math.round(cy) - 2 * R), y1 = Math.min(h - 1, Math.round(cy) + 2 * R);
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const inWide = (i) => { const x = i % w, y = (i - x) / w; return x >= x0 && x <= x1 && y >= y0 && y <= y1; };
  const white = estimateWhite(pixels, w * h, inWide);
  if (!white) return null;
  const wLab = rgbToLab(...white);

  // Non-white pixels in the search window (radius R around the aimed point).
  const n = w * h;
  const S = scratchFor(w, h);
  const { mask, tmp, closed, comp, queue } = S;
  mask.fill(0);
  comp.fill(0);
  const minDiff = opts.minDiff ?? 18;
  for (let y = Math.max(0, Math.round(cy) - R); y <= Math.min(h - 1, Math.round(cy) + R); y++) {
    for (let x = Math.max(0, Math.round(cx) - R); x <= Math.min(w - 1, Math.round(cx) + R); x++) {
      const i = y * w + x, j = i * 4;
      const lab = rgbToLab(pixels[j], pixels[j + 1], pixels[j + 2]);
      if (Math.hypot(lab[0] - wLab[0], lab[1] - wLab[1], lab[2] - wLab[2]) > minDiff) mask[i] = 1;
    }
  }
  dilate(mask, tmp, w, h);
  erode(tmp, closed, w, h);

  // The blob closest to the aimed point; bigger wins when about equally close.
  let best = null, compId = 0;
  for (let start = 0; start < n; start++) {
    if (!closed[start] || comp[start]) continue;
    compId++;
    let head = 0, tail = 0, sx = 0, sy = 0, near = Infinity;
    queue[tail++] = start;
    comp[start] = compId;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i - x) / w;
      sx += x; sy += y;
      near = Math.min(near, Math.hypot(x - cx, y - cy));
      if (x > 0 && closed[i - 1] && !comp[i - 1]) { comp[i - 1] = compId; queue[tail++] = i - 1; }
      if (x < w - 1 && closed[i + 1] && !comp[i + 1]) { comp[i + 1] = compId; queue[tail++] = i + 1; }
      if (y > 0 && closed[i - w] && !comp[i - w]) { comp[i - w] = compId; queue[tail++] = i - w; }
      if (y < h - 1 && closed[i + w] && !comp[i + w]) { comp[i + w] = compId; queue[tail++] = i + w; }
    }
    if (tail < (opts.minPixels ?? 12)) continue;
    const score = near / R - Math.min(1, tail / (R * R));
    if (!best || score < best.score) best = { id: compId, count: tail, px: sx / tail, py: sy / tail, score };
  }
  if (!best) return null;

  // Median colour of the blob's inner pixels.
  const rs = [], gs = [], bs = [];
  for (let i = 0; i < n; i++) {
    if (comp[i] !== best.id) continue;
    if (comp[i - 1] !== best.id || comp[i + 1] !== best.id || comp[i - w] !== best.id || comp[i + w] !== best.id) continue;
    rs.push(pixels[i * 4]); gs.push(pixels[i * 4 + 1]); bs.push(pixels[i * 4 + 2]);
  }
  if (rs.length < 4) {
    for (let i = 0; i < n; i++) {
      if (comp[i] !== best.id) continue;
      rs.push(pixels[i * 4]); gs.push(pixels[i * 4 + 1]); bs.push(pixels[i * 4 + 2]);
    }
  }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  return {
    rgb: [med(rs), med(gs), med(bs)],
    white,
    px: best.px, py: best.py,
    count: best.count,
    offset: { x: best.px - cx, y: best.py - cy },
  };
}

// Raw camera colour + the raw table white next to it → the white-balanced colour the
// classifier compares against (same balancing as detectCards does).
export function balanceColour(rgb, white, colourTable) {
  return rgb.map((v, c) => Math.min(255, v * Math.min(8, Math.max(0.5, colourTable.white[c] / Math.max(white[c], 1)))));
}

// ---------------------------------------------------------------------------
// Several frames → stable cards
// ---------------------------------------------------------------------------

// frames: array of detection arrays (one per frame). Detections closer than 'radius'
// are the same card, whatever colour each frame saw: the colour is decided by vote.
// Cards seen in fewer than minFrames frames are dropped.
export function mergeScans(frames, { radius = 0.06, minFrames = 3 } = {}) {
  const clusters = [];
  frames.forEach((dets, f) => {
    for (const d of dets) {
      let best = null, bestDist = radius;
      for (const c of clusters) {
        const dist = Math.hypot(c.x - d.x, c.z - d.z);
        if (dist < bestDist) { best = c; bestDist = dist; }
      }
      if (!best) {
        best = { x: d.x, z: d.z, items: [], frames: new Set() };
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
      const votes = {};
      for (const d of c.items) votes[d.colour] = (votes[d.colour] || 0) + 1;
      const colour = Object.keys(votes).reduce((a, b) => (votes[b] > votes[a] ? b : a));
      const same = c.items.filter((d) => d.colour === colour);
      const avg = (fn) => same.reduce((s, d) => s + fn(d), 0) / same.length;
      return {
        colour, x: c.x, z: c.z,
        area: avg((d) => d.area),
        sides: [avg((d) => d.sides?.[0] ?? 0), avg((d) => d.sides?.[1] ?? 0)],
        angle: same[same.length >> 1].angle ?? 0,
        rgb: [0, 1, 2].map((ch) => avg((d) => d.rgb[ch])),
        dist: avg((d) => d.dist),
        frames: c.frames.size,
        votes,
      };
    });
}

// Drops cards that lie where an asset already is (any colour: the same card read as
// another colour is still the same card). existing: [{ x, z }] in table-local metres.
export function filterNew(cards, existing, distance = 0.08) {
  return cards.filter((c) => !existing.some((e) => Math.hypot(e.x - c.x, e.z - c.z) < distance));
}

// ---------------------------------------------------------------------------
// Tap sampling: the colour right where the user points
// ---------------------------------------------------------------------------

// Median colour of the pixels within 'radius' of (cx, cy), and the table white from the
// brightest quarter of a wider square (±whiteRadius) for white balance.
// Returns { rgb, white, count } (raw camera colours) or null.
export function samplePatch(pixels, w, h, cx, cy, radius, whiteRadius) {
  const r = Math.max(1, radius);
  const rs = [], gs = [], bs = [];
  for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
    for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
      if (Math.hypot(x - cx, y - cy) > r) continue;
      const j = (y * w + x) * 4;
      rs.push(pixels[j]); gs.push(pixels[j + 1]); bs.push(pixels[j + 2]);
    }
  }
  if (rs.length < 3) return null;
  const R = Math.max(r * 2, whiteRadius);
  const x0 = cx - R, x1 = cx + R, y0 = cy - R, y1 = cy + R;
  const white = estimateWhite(pixels, w * h, (i) => {
    const x = i % w, y = (i - x) / w;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1;
  });
  if (!white) return null;
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  return { rgb: [med(rs), med(gs), med(bs)], white, count: rs.length };
}

// Always picks one of the colours in the table: the nearest in Lab.
// rgb: white-balanced. Returns { label, name, dist, all: { name: distance } }.
export function nearestColour(rgb, t) {
  const [L, A, B] = rgbToLab(...rgb);
  let best = 0, bestDist = Infinity;
  const all = {};
  t.colours.forEach((c, i) => {
    const d = Math.hypot(L - c.lab[0], A - c.lab[1], B - c.lab[2]);
    all[c.name] = Math.round(d);
    if (d < bestDist) { best = i + 1; bestDist = d; }
  });
  return { label: best, name: best ? t.colours[best - 1].name : null, dist: bestDist, all };
}

// ---------------------------------------------------------------------------
// Slot calibration: cards lying in known squares on the table
// ---------------------------------------------------------------------------

// slots: [{ px, py, pxPerM }] = where each slot centre should be in the image. The camera
// image may be shifted against the head pose, so this searches the shift (up to 'search'
// metres) that puts all slot centres on uniform, non-table colour: per slot the score is
// (distance from table white) − 1.5 × (colour spread) over a disc of 'inner' metres.
// Only the centre of each card is used, so a misaligned edge doesn't matter.
// Returns { shift: { x, y } (pixels), samples: [{ rgb, count, contrast }], white,
// score, scoreNoShift } or null. rgb = raw median colour at the best shift.
export function sampleSlots(pixels, w, h, slots, opts = {}) {
  const inner = opts.inner ?? 0.025;
  const search = opts.search ?? 0.1;
  const ppm = slots.reduce((s, sl) => s + sl.pxPerM, 0) / slots.length;
  const R = Math.max(2, Math.round(search * ppm));
  const step = Math.max(1, Math.round(R / 12));

  // Table white from a box around all slots (+15 cm).
  const pad = 0.15 * ppm;
  const bx0 = Math.min(...slots.map((s) => s.px)) - pad, bx1 = Math.max(...slots.map((s) => s.px)) + pad;
  const by0 = Math.min(...slots.map((s) => s.py)) - pad, by1 = Math.max(...slots.map((s) => s.py)) + pad;
  const white = estimateWhite(pixels, w * h, (i) => {
    const x = i % w, y = (i - x) / w;
    return x >= bx0 && x <= bx1 && y >= by0 && y <= by1;
  });
  if (!white) return null;
  const wLab = rgbToLab(...white);

  const lab = new Float32Array(w * h * 3);
  const have = new Uint8Array(w * h);
  const labAt = (i) => {
    if (!have[i]) {
      const j = i * 4;
      const v = rgbToLab(pixels[j], pixels[j + 1], pixels[j + 2]);
      lab[i * 3] = v[0]; lab[i * 3 + 1] = v[1]; lab[i * 3 + 2] = v[2];
      have[i] = 1;
    }
    return i * 3;
  };
  const disc = (cx, cy, r, fn) => {
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) fn(y * w + x);
      }
    }
  };
  const slotScore = (s, dx, dy) => {
    let n = 0, sL = 0, sA = 0, sB = 0, qL = 0, qA = 0, qB = 0;
    disc(s.px + dx, s.py + dy, Math.max(1.5, inner * s.pxPerM), (i) => {
      const k = labAt(i);
      const L = lab[k], A = lab[k + 1], B = lab[k + 2];
      n++; sL += L; sA += A; sB += B; qL += L * L; qA += A * A; qB += B * B;
    });
    if (n < 4) return -50;
    const mL = sL / n, mA = sA / n, mB = sB / n;
    const spread = Math.sqrt(Math.max(0, qL / n - mL * mL + qA / n - mA * mA + qB / n - mB * mB));
    return Math.hypot(mL - wLab[0], mA - wLab[1], mB - wLab[2]) - 1.5 * spread;
  };
  const total = (dx, dy) => slots.reduce((s, sl) => s + slotScore(sl, dx, dy), 0);

  const scoreNoShift = total(0, 0);
  let best = { dx: 0, dy: 0, score: scoreNoShift };
  for (let dy = -R; dy <= R; dy += step) {
    for (let dx = -R; dx <= R; dx += step) {
      const sc = total(dx, dy);
      if (sc > best.score) best = { dx, dy, score: sc };
    }
  }
  const c = { ...best };
  for (let dy = c.dy - step; dy <= c.dy + step; dy++) {
    for (let dx = c.dx - step; dx <= c.dx + step; dx++) {
      const sc = total(dx, dy);
      if (sc > best.score) best = { dx, dy, score: sc };
    }
  }

  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const samples = slots.map((s) => {
    const rs = [], gs = [], bs = [];
    disc(s.px + best.dx, s.py + best.dy, Math.max(1.5, inner * s.pxPerM), (i) => {
      rs.push(pixels[i * 4]); gs.push(pixels[i * 4 + 1]); bs.push(pixels[i * 4 + 2]);
    });
    if (rs.length < 3) return null;
    const rgb = [med(rs), med(gs), med(bs)];
    const l = rgbToLab(...rgb);
    return { rgb, count: rs.length, contrast: Math.round(Math.hypot(l[0] - wLab[0], l[1] - wLab[1], l[2] - wLab[2])) };
  });
  return { shift: { x: best.dx, y: best.dy }, samples, white, score: best.score, scoreNoShift };
}
