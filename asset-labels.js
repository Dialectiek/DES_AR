// Asset labels: click an asset in the diorama (controller trigger, or the mouse in
// ?preview=1) and a small floating panel with its name appears above it; click the asset
// again to hide it. Click the name and the rest of its information drops down: what it is, its energy role and ratings, its size, where the
// model comes from and the energy flows it takes part in. Opening one closes the others.
//
// Panels are sprites, so they always face you, and they have a fixed real-world size, so
// they stay readable whatever scale the diorama gets on the table. Colours are bright on
// purpose: the Magic Leap 2 display is additive and shows dark colours as see-through.
//
// Extra rows: give a library asset or a scene item an "info" object, e.g.
//   "info": { "Owner": "Municipality", "Built": 1998 }
// A scene item's "name" replaces the library name on its panel.

import * as THREE from 'three';
import { FLOW_KINDS } from './diorama.js';

// Sizes in real metres on the table (not diorama metres), before the `size` multiplier.
const PX_PER_M = 4000;      // canvas resolution: 40 px per centimetre
const PAD = 0.005;          // inner padding
const HEADER_H = 0.021;     // the name row
const NAME_FONT = 0.0105;
const DOT_R = 0.002;        // category colour dot in front of the name
const CHEVRON = 0.006;      // width of the open/closed mark
const ROW_H = 0.012;        // one detail row
const ROW_FONT = 0.0075;
const COL_GAP = 0.008;      // between a row's key and its value
const MIN_W = 0.05;
const MAX_W = 0.16;
const GAP = 0.01;           // between the top of the model and the bottom of the name row
const DROP_SECONDS = 0.18;  // drop-down animation

const ACCENT = {
  building: 0x5ac8ff,
  vehicle: 0x7cff6b,
  grid: 0xff6b6b,
  generator: 0xffd60a,
  storage: 0xb38cff,
};
const DEFAULT_ACCENT = 0xe6f4ff;
const TEXT = '#ffffff';
const MUTED = '#aebccb';
const BG = 'rgba(12,16,22,0.82)';
const ENERGY_NAMES = { pvPeakKw: 'PV peak', chargeKw: 'Charging', batteryKwh: 'Battery', demandKw: 'Demand' };

const px = (m) => Math.round(m * PX_PER_M);
const css = (hex) => '#' + hex.toString(16).padStart(6, '0');
const fmt = (v) => (typeof v !== 'number' ? String(v) : Number.isInteger(v) ? String(v) : v.toFixed(1));
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '');
const portName = (p) => (p.length <= 2 ? p.toUpperCase() : cap(p));
const smooth = (p) => p * p * (3 - 2 * p);

const FONT = 'system-ui, sans-serif';
const NAME_CSS = `700 ${px(NAME_FONT)}px ${FONT}`;
const KEY_CSS = `500 ${px(ROW_FONT)}px ${FONT}`;
const VALUE_CSS = `600 ${px(ROW_FONT)}px ${FONT}`;
const HEADING_CSS = `700 ${px(ROW_FONT * 0.85)}px ${FONT}`;

const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, font) {
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}
function fitText(text, font, maxPx) {
  if (textWidth(text, font) <= maxPx) return text;
  let s = text;
  while (s.length > 1 && textWidth(s + '…', font) > maxPx) s = s.slice(0, -1);
  return s.trimEnd() + '…';
}

// The drop-down rows: { key, value, color? } or { heading }.
function detailRows(item, measured, flows, nameOf) {
  const { def, entry } = item;
  const rows = [];
  const add = (key, value, color) => {
    if (value === undefined || value === null || value === '') return;
    rows.push({ key: String(key), value: String(value), color });
  };
  if (!entry) add('Asset', `${def.asset} (not in the library)`);
  add('Type', cap(entry?.category));
  const { role, ...ratings } = entry?.energy || {};
  add('Role', cap(role));
  for (const [k, v] of Object.entries(ratings)) {
    const unit = /Kwh$/.test(k) ? 'kWh' : /Kw$/.test(k) ? 'kW' : '';
    const name = ENERGY_NAMES[k] ?? cap(k.replace(/Kwh$|Kw$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
    add(name, typeof v === 'number' && unit ? `${fmt(v)} ${unit}` : v);
  }
  const size = entry?.size ?? (measured && [measured.x, measured.y, measured.z]);
  if (size?.length === 3) add('Size', `${fmt(size[0])} × ${fmt(size[2])} m, ${fmt(size[1])} m high`);
  for (const [k, v] of Object.entries({ ...entry?.info, ...def.info })) add(k, fmt(v));
  if (entry?.source) add('Model', entry.source.startsWith('generated') ? 'generated' : entry.source);

  const flowRows = [];
  for (const { def: f } of flows) {
    const [fromId, fromPort] = String(f.from).split(':');
    const [toId, toPort] = String(f.to).split(':');
    if (fromId !== def.id && toId !== def.id) continue;
    let key;
    if (fromId === toId) key = `${portName(fromPort || 'out')} → ${portName(toPort || 'in')}`; // inside this asset
    else if (fromId === def.id) key = `→ ${nameOf(toId)}`;
    else key = `← ${nameOf(fromId)}`;
    const kind = FLOW_KINDS[f.kind];
    flowRows.push({ key, value: `${(Number(f.kw) || 0).toFixed(1)} kW`, color: kind ? css(kind.color) : TEXT });
  }
  if (flowRows.length) rows.push({ heading: 'Energy flows' }, ...flowRows);
  return rows;
}

// Canvas size in pixels of the closed (name only) or open (name + details) panel.
function faceSize(label, open) {
  const pad = px(PAD);
  const gap = px(COL_GAP);
  let need = pad + px(2 * DOT_R + 0.003) + textWidth(label.name, NAME_CSS) + gap + px(CHEVRON) + pad;
  let h = px(HEADER_H);
  if (open) {
    for (const row of label.rows) {
      const w = row.heading
        ? textWidth(row.heading.toUpperCase(), HEADING_CSS)
        : textWidth(row.key, KEY_CSS) + gap + textWidth(row.value, VALUE_CSS);
      need = Math.max(need, 2 * pad + w);
      h += px(ROW_H);
    }
    h += px(0.004); // bottom padding
  }
  return [Math.ceil(THREE.MathUtils.clamp(need, px(MIN_W), px(MAX_W))), Math.ceil(h)];
}

function makeFace([w, h]) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, ctx: canvas.getContext('2d'), texture, w, h };
}

function hLine(ctx, x0, x1, y, color, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.restore();
}

function draw(label, face) {
  const { ctx, w, h } = face;
  const pad = px(PAD);
  const head = px(HEADER_H);
  const edge = label.hovered ? '#ffffff' : label.accent;
  const lw = label.hovered ? 6 : 3;
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  ctx.roundRect(lw / 2, lw / 2, w - lw, h - lw, px(0.004));
  ctx.fillStyle = BG;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = edge;
  ctx.stroke();

  // Name row: colour dot, name, and a chevron that points down when closed, up when open.
  const cy = head / 2;
  const dotR = px(DOT_R);
  ctx.fillStyle = label.accent;
  ctx.beginPath();
  ctx.arc(pad + dotR, cy, dotR, 0, Math.PI * 2);
  ctx.fill();
  const nameX = pad + 2 * dotR + px(0.003);
  const chevW = px(CHEVRON);
  ctx.font = NAME_CSS;
  ctx.fillStyle = TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(label.name, NAME_CSS, w - nameX - px(COL_GAP) - chevW - pad), nameX, cy);
  const cx = w - pad - chevW / 2;
  const d = chevW / 2;
  const dir = label.open ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(cx - d, cy - (d / 2) * dir);
  ctx.lineTo(cx, cy + (d / 2) * dir);
  ctx.lineTo(cx + d, cy - (d / 2) * dir);
  ctx.lineWidth = px(0.0012);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = edge;
  ctx.stroke();

  if (face === label.faces.open) {
    hLine(ctx, pad, w - pad, head, label.accent, 0.6);
    const rowH = px(ROW_H);
    const avail = w - 2 * pad;
    const gap = px(COL_GAP);
    let y = head + px(0.0015);
    for (const row of label.rows) {
      if (row.heading) {
        hLine(ctx, pad, w - pad, y + rowH * 0.2, MUTED, 0.35);
        ctx.font = HEADING_CSS;
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'left';
        ctx.fillText(row.heading.toUpperCase(), pad, y + rowH * 0.62);
      } else {
        let { key, value } = row;
        const keyW = textWidth(key, KEY_CSS);
        if (keyW + gap + textWidth(value, VALUE_CSS) > avail) {
          value = fitText(value, VALUE_CSS, Math.max(avail * 0.4, avail - keyW - gap));
          key = fitText(key, KEY_CSS, avail - gap - textWidth(value, VALUE_CSS));
        }
        ctx.font = KEY_CSS;
        ctx.fillStyle = MUTED;
        ctx.textAlign = 'left';
        ctx.fillText(key, pad, y + rowH / 2);
        ctx.font = VALUE_CSS;
        ctx.fillStyle = row.color || TEXT;
        ctx.textAlign = 'right';
        ctx.fillText(value, w - pad, y + rowH / 2);
      }
      y += rowH;
    }
  }
  face.texture.needsUpdate = true;
}

const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();
const _meshBox = new THREE.Box3();

// Bounding box of `object` in the coordinates of `root` (the diorama group).
function boxIn(object, root) {
  root.updateWorldMatrix(true, true);
  _inv.copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  object.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(_meshBox.copy(o.geometry.boundingBox).applyMatrix4(_rel.multiplyMatrices(_inv, o.matrixWorld)));
  });
  return box;
}

// items, flows, root: what buildDiorama() returned (items, flows and group).
// size: multiplier for the panel size (1 = name text about 1 cm high).
// Returns { group, labels, update, pick, setHover, hovered, toggle, closeAll }.
export function createAssetLabels({ items, flows = [], root, size = 1, log }) {
  const group = new THREE.Group();
  group.name = 'asset labels';
  const labels = [];
  const sprites = [];
  const assetMeshes = []; // the models' meshes: clicking one shows its label
  let hovered = null;     // { label, point, on: 'label' | 'asset' } under the pointer

  const nameOf = (id) => {
    const it = items.get(id);
    return it ? it.def.name || it.entry?.name || id : id;
  };

  // Shows the right face; while animating, only the top part (name + some rows) of the open one.
  function apply(l) {
    const open = l.p > 0;
    const face = open ? l.faces.open : l.faces.closed;
    const t = open ? l.headFrac + (1 - l.headFrac) * smooth(l.p) : 1;
    face.texture.repeat.set(1, t);
    face.texture.offset.set(0, 1 - t); // canvas textures are flipped: v = 1 is the top row
    l.sprite.material.map = face.texture;
    l.sprite.scale.set((face.w / PX_PER_M) * size, (face.h / PX_PER_M) * t * size, 1);
    l.sprite.renderOrder = open ? 902 : l.hovered ? 901 : 900;
  }

  function redraw(l) {
    draw(l, l.p > 0 ? l.faces.open : l.faces.closed);
    apply(l);
  }

  function setOpen(l, open) {
    if (l.open === open) return;
    l.open = open;
    if (open && !l.faces.open) {
      l.faces.open = makeFace(faceSize(l, true));
      l.headFrac = px(HEADER_H) / l.faces.open.h;
    }
    if (open && l.p === 0) l.p = 0.001; // switch to the open face straight away
    redraw(l);
  }

  for (const [id, item] of items) {
    const box = boxIn(item.object, root);
    const anchor = box.isEmpty()
      ? item.object.position.clone()
      : new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
    const label = {
      id,
      name: nameOf(id),
      accent: css(ACCENT[item.entry?.category] ?? DEFAULT_ACCENT),
      anchor,
      rows: null,
      open: false,
      hovered: false,
      p: 0,          // 0 = closed, 1 = fully dropped down
      headFrac: 1,   // name row height / open panel height
      faces: { closed: null, open: null },
    };
    label.rows = detailRows(item, box.isEmpty() ? null : box.getSize(new THREE.Vector3()), flows, nameOf);
    label.faces.closed = makeFace(faceSize(label, false));
    draw(label, label.faces.closed);
    label.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: label.faces.closed.texture,
      transparent: true,
      depthTest: false, // always readable, even behind a building
      depthWrite: false,
      toneMapped: false,
    }));
    label.sprite.center.set(0.5, 1); // hangs from its top edge, so the details drop down
    label.sprite.name = 'label ' + id;
    label.sprite.userData.assetLabel = label;
    label.sprite.visible = false; // appears once its asset is clicked
    label.model = item.object;
    item.object.traverse((o) => { if (o.isMesh) assetMeshes.push(o); o.userData.assetLabel = label; });
    apply(label);
    group.add(label.sprite);
    labels.push(label);
    sprites.push(label.sprite);
  }

  const _m = new THREE.Matrix4();
  return {
    group,
    labels,
    get hovered() { return hovered; },

    // Every frame. holder: the node the diorama group hangs from (scaled to fit the
    // table); it must have the same parent as `group`. dt: seconds since the last frame.
    update(holder, dt = 0) {
      holder.updateMatrix();
      root.updateMatrix();
      _m.multiplyMatrices(holder.matrix, root.matrix);
      for (const l of labels) {
        l.sprite.position.copy(l.anchor).applyMatrix4(_m);
        l.sprite.position.y += (GAP + HEADER_H) * size;
        const target = l.open ? 1 : 0;
        if (l.p === target) continue;
        const step = dt / DROP_SECONDS;
        l.p = l.open ? Math.min(1, l.p + step) : Math.max(0, l.p - step);
        if (l.p === 0) redraw(l); // rolled up: back to the small name panel
        else apply(l);
      }
    },

    // What the raycaster's ray points at: a visible name panel first (they are drawn on
    // top), otherwise the nearest asset model. { label, point, on: 'label' | 'asset' } or null.
    // Sprites are raycast as seen from raycaster.camera, so that must be set.
    pick(raycaster) {
      const shown = sprites.filter((s) => s.visible);
      const onLabel = shown.length ? raycaster.intersectObjects(shown, false)[0] : null;
      if (onLabel) return { label: onLabel.object.userData.assetLabel, point: onLabel.point, on: 'label' };
      const onAsset = raycaster.intersectObjects(assetMeshes, false)[0];
      return onAsset ? { label: onAsset.object.userData.assetLabel, point: onAsset.point, on: 'asset' } : null;
    },

    // hit: from pick(), or null. Only a name panel under the pointer gets highlighted.
    setHover(hit) {
      const label = hit?.on === 'label' ? hit.label : null;
      const old = hovered?.on === 'label' ? hovered.label : null;
      hovered = hit;
      if (label === old) return;
      if (old) { old.hovered = false; redraw(old); }
      if (label) { label.hovered = true; redraw(label); }
    },

    // Click / trigger on a pick() result: an asset shows or hides its name,
    // a name opens or closes its details.
    activate(hit) {
      if (hit.on === 'asset') this.setShown(hit.label, !hit.label.sprite.visible);
      else this.toggle(hit.label);
    },

    setShown(label, shown) {
      if (label.sprite.visible === shown) return;
      if (!shown) {
        label.open = false;
        label.p = 0;
        label.hovered = false;
        redraw(label);
      }
      label.sprite.visible = shown;
      log?.info(shown ? 'Asset name shown' : 'Asset name hidden', label.name);
    },

    hideAll() {
      for (const l of labels) this.setShown(l, false);
    },

    // Open or close one panel's details; opening one closes the others.
    toggle(label) {
      const open = !label.open;
      if (open) for (const l of labels) if (l !== label) setOpen(l, false);
      setOpen(label, open);
      log?.info(open ? 'Asset details shown' : 'Asset details hidden', label.name);
      return open;
    },

    closeAll() {
      for (const l of labels) setOpen(l, false);
    },
  };
}
