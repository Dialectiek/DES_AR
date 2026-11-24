// Makes the controller assets: one GLB per Illuminator controller type, all the same
// avatar (tools/sources/avatar-cyan.glb) with a different shirt colour.
//
//   node tools/controller-avatars.mjs
//
// writes assets/models/illuminator/<type>.glb for every entry in CONTROLLERS. No
// dependencies: the GLB and its PNG textures are read and written here.
//
// The shirt colour is in two places: the torso is a cyan block in the base-colour texture
// (an atlas of flat colours), the sleeves are the "Sleeve" / "SleeveCuff" materials. Both
// get the new hue; lightness and saturation stay, so the logo on the chest still shows.
// The 2048² textures are shrunk to TEXTURE_SIZE: the atlas is flat colour, so nothing is
// lost, and each file shrinks by about 0.7 MB. The rig and its hand animations are kept.
//
// Bright colours only: the ML2 display is additive.

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const SOURCE = new URL('./sources/avatar-cyan.glb', import.meta.url);
const OUT_DIR = new URL('../assets/models/illuminator/', import.meta.url);
const TEXTURE_SIZE = 512;

// Illuminator controller type → shirt hue in degrees (the source shirt is cyan, ~186°).
export const CONTROLLERS = {
  Controller_T1: 186,          // cyan: the source as it is
  ControllerT3Congestion: 28,  // orange
  ControllerEV: 105,           // green
  H2Controller: 300,           // magenta
  H2Controller2: 265,          // violet
  H2ControllerExample: 55,     // yellow
};

// ---- GLB -------------------------------------------------------------------------
function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const bin = buf.subarray(binStart, binStart + binLen);
  const views = json.bufferViews.map((v) => bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength));
  return { json, views };
}

// Packs the buffer views again (each 4-byte aligned) and writes the GLB.
function writeGlb(json, views) {
  const parts = [];
  let offset = 0;
  views.forEach((data, i) => {
    json.bufferViews[i].byteOffset = offset;
    json.bufferViews[i].byteLength = data.length;
    parts.push(data);
    const pad = (4 - (data.length % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
    offset += data.length + pad;
  });
  json.buffers = [{ byteLength: offset }];
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const bin = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const chunk = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return [h, data];
  };
  return Buffer.concat([header, ...chunk(0x4e4f534a, jsonBuf), ...chunk(0x004e4942, bin)]);
}

// ---- PNG (8-bit RGB / RGBA, not interlaced) ---------------------------------------
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, colourType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit, non-interlaced PNGs');
      colourType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 2: 3, 6: 4 }[colourType];
  if (!channels) throw new Error(`PNG colour type ${colourType} not handled`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0, b = prev[i], c = i >= channels ? prev[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + add) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 4; k++) out[(y * width + x) * 4 + k] = k < channels ? line[x * channels + k] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng({ width, height, data }) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Box-filter shrink by a whole factor.
function shrink(img, size) {
  const f = img.width / size;
  if (f <= 1 || !Number.isInteger(f) || img.height / f !== size) return img;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < f; dy++) {
        for (let dx = 0; dx < f; dx++) {
          const i = ((y * f + dy) * img.width + x * f + dx) * 4;
          for (let k = 0; k < 4; k++) sum[k] += img.data[i + k];
        }
      }
      for (let k = 0; k < 4; k++) out[(y * size + x) * 4 + k] = Math.round(sum[k] / (f * f));
    }
  }
  return { width: size, height: size, data: out };
}

// ---- colour ------------------------------------------------------------------------
function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}
function hsvToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
const isShirt = (h, s, v) => h > 165 && h < 205 && s > 0.35 && v > 0.3; // the cyan of the source
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

// sRGB 0..1 → same saturation and brightness at the new hue.
function rehue([r, g, b], hue) {
  const [h, s, v] = rgbToHsv(r, g, b);
  return isShirt(h, s, v) ? hsvToRgb(hue, s, v) : [r, g, b];
}

function recolourTexture(img, hue) {
  const data = Buffer.from(img.data);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = rehue([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255], hue);
    data[i] = Math.round(r * 255);
    data[i + 1] = Math.round(g * 255);
    data[i + 2] = Math.round(b * 255);
  }
  return { ...img, data };
}

// ---- build -------------------------------------------------------------------------
function build() {
  const { json, views } = readGlb(readFileSync(SOURCE));
  const imageView = new Map(json.images.map((im, i) => [i, im.bufferView]));
  const baseTex = json.materials.find((m) => m.pbrMetallicRoughness?.baseColorTexture)?.pbrMetallicRoughness.baseColorTexture.index;
  const baseImage = json.textures[baseTex].source;
  const images = json.images.map((_, i) => shrink(decodePng(views[imageView.get(i)]), TEXTURE_SIZE));
  for (const [type, hue] of Object.entries(CONTROLLERS)) {
    const j = JSON.parse(JSON.stringify(json));
    const v = views.slice();
    images.forEach((img, i) => {
      v[imageView.get(i)] = encodePng(i === baseImage ? recolourTexture(img, hue) : img);
    });
    for (const m of j.materials) {
      const f = m.pbrMetallicRoughness?.baseColorFactor;
      if (!f || !/^Sleeve/.test(m.name ?? '')) continue;
      const srgb = rehue(f.slice(0, 3).map(toSrgb), hue);
      m.pbrMetallicRoughness.baseColorFactor = [...srgb.map(toLinear), f[3]];
    }
    j.asset.generator = 'tools/controller-avatars.mjs from tools/sources/avatar-cyan.glb';
    j.scenes[j.scene ?? 0].name = `${type} avatar`;
    const out = writeGlb(j, v);
    writeFileSync(new URL(`${type}.glb`, OUT_DIR), out);
    console.log(`${type}.glb  hue ${hue}°  ${(out.length / 1024).toFixed(0)} KB`);
  }
}

build();
