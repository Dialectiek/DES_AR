// Illuminator ports and parameters on the table (manual and cards mode):
//   - small arrows on the floor around each asset, one per input (pointing in, on the
//     asset's left) and one per output (pointing out, on its right). An open port is bright
//     and pulses; a connected one goes faint.
//   - the asset info panel ("model menu"): the Illuminator model, its inputs and outputs
//     with what each is connected to, and its parameters with their values.
// The logic (layout, rows) is in schema.js; this file only draws.
// Bright colours only: the Magic Leap 2 display is additive.

import * as THREE from 'three';
import { portArrowLayout, modelRows } from './schema.js';

export const PORT_COLOURS = { in: 0x5dff8f, out: 0xffb13b };

const ARROW_L = 0.016;   // metres
const ARROW_W = 0.011;
const ARROW_GAP = 0.014; // from the ring to the arrow centre

// One flat arrow pointing +X, lying on the table.
const arrowGeo = (() => {
  const L = ARROW_L, W = ARROW_W, s = W * 0.36, neck = L * 0.1;
  const sh = new THREE.Shape();
  sh.moveTo(-L / 2, -s / 2);
  sh.lineTo(neck, -s / 2);
  sh.lineTo(neck, -W / 2);
  sh.lineTo(L / 2, 0);
  sh.lineTo(neck, W / 2);
  sh.lineTo(neck, s / 2);
  sh.lineTo(-L / 2, s / 2);
  sh.closePath();
  return new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2);
})();

// Adds the arrows of `ports` (portsOf() result, or null) to an asset object from
// makeAssetObject(). A dynamic model gets one arrow on each side it has ports on.
export function addPortArrows(obj, ports) {
  removePortArrows(obj);
  if (!ports) return;
  const nIn = ports.dynamic ? Math.min(1, ports.inputs.length || 1) : ports.inputs.length;
  const nOut = ports.dynamic ? Math.min(1, ports.outputs.length) : ports.outputs.length;
  const radius = (obj.userData.ringRadius ?? 0.035) + ARROW_GAP;
  const group = new THREE.Group();
  group.name = 'port arrows';
  const arrows = [];
  for (const p of portArrowLayout(nIn, nOut, radius)) {
    const mat = new THREE.MeshBasicMaterial({
      color: PORT_COLOURS[p.side], transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false,
    });
    const mesh = new THREE.Mesh(arrowGeo, mat);
    mesh.position.set(p.x, 0.004, p.z);
    mesh.rotation.y = p.angle;
    mesh.renderOrder = 5;
    mesh.userData = { side: p.side, index: p.index, name: (p.side === 'in' ? ports.inputs : ports.outputs)[p.index] ?? null, connected: false };
    group.add(mesh);
    arrows.push(mesh);
  }
  obj.add(group);
  obj.userData.portArrows = { group, arrows, dynamic: ports.dynamic };
}

export function removePortArrows(obj) {
  const pa = obj.userData.portArrows;
  if (!pa) return;
  obj.remove(pa.group);
  for (const a of pa.arrows) a.material.dispose();
  obj.userData.portArrows = null;
}

// status: EnergySystem.portStatus(node). Marks each arrow connected or open.
export function setPortStatus(obj, status) {
  const pa = obj.userData.portArrows;
  if (!pa || !status) return;
  for (const a of pa.arrows) {
    const { side, name } = a.userData;
    a.userData.connected = pa.dynamic
      ? (side === 'in' ? status.extraIn : status.extraOut).length > 0
      : !!(side === 'in' ? status.inputs : status.outputs).find((p) => p.name === name)?.link;
  }
}

// Every frame: open ports pulse, connected ones stay faint. A dynamic port never
// counts as open, so it stays steady.
export function animatePortArrows(objects, time) {
  const pulse = 0.5 + 0.5 * Math.sin(time * 0.006);
  for (const obj of objects) {
    const pa = obj.userData.portArrows;
    if (!pa) continue;
    for (const a of pa.arrows) {
      const c = a.userData.connected;
      a.material.opacity = c ? 0.28 : pa.dynamic ? 0.8 : 0.65 + 0.35 * pulse;
      a.scale.setScalar(c ? 0.8 : pa.dynamic ? 1 : 1 + 0.12 * pulse);
    }
  }
}

// ---------------------------------------------------------------------------
// Info panel
// ---------------------------------------------------------------------------
const PX_PER_M = 4000;
const PAD = 0.005, TITLE_H = 0.016, ROW_H = 0.0095, ROW_FONT = 0.0062, TITLE_FONT = 0.0092;
const COL_GAP = 0.006, COL_SPLIT = 0.008, MIN_COL = 0.05, MAX_COL = 0.11;
const TEXT = '#ffffff', MUTED = '#aebccb', BG = 'rgba(12,16,22,0.85)';
const STATE_COLOURS = { open: '#ffd27a', on: '#8dffb3', any: '#c8a0ff' };
const FONT = 'system-ui, sans-serif';
const px = (m) => Math.round(m * PX_PER_M);
const KEY_CSS = `500 ${px(ROW_FONT)}px ${FONT}`;
const VALUE_CSS = `600 ${px(ROW_FONT)}px ${FONT}`;
const HEAD_CSS = `700 ${px(ROW_FONT * 0.9)}px ${FONT}`;
const TITLE_CSS = `700 ${px(TITLE_FONT)}px ${FONT}`;

let measureCtx = null;
function textWidth(t, font) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(t).width;
}
function fit(t, font, maxPx) {
  if (textWidth(t, font) <= maxPx) return t;
  let s = t;
  while (s.length > 1 && textWidth(s + '…', font) > maxPx) s = s.slice(0, -1);
  return s + '…';
}
function colWidth(rows) {
  let w = px(MIN_COL);
  for (const r of rows) {
    w = Math.max(w, r.heading ? textWidth(r.heading.toUpperCase(), HEAD_CSS)
      : textWidth(r.key, KEY_CSS) + px(COL_GAP) + textWidth(r.value, VALUE_CSS));
  }
  return Math.min(w, px(MAX_COL));
}

// One sprite, reused for whichever asset or palette tile is shown.
// Returns { sprite, show({ title, accent, def, model, status, params, nameOf }, worldPos), hide(), shownKey }.
export function createModelPanel() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  }));
  sprite.center.set(0.5, 0); // stands on its bottom edge, above the asset
  sprite.renderOrder = 950;
  sprite.visible = false;
  sprite.name = 'model panel';
  let shownKey = null;

  function draw({ title, accent = '#e6f4ff', ...info }) {
    const { ports, params } = modelRows(info);
    const pad = px(PAD), split = px(COL_SPLIT), rowH = px(ROW_H), titleH = px(TITLE_H);
    const w1 = colWidth(ports), w2 = params.length ? colWidth(params) : 0;
    const w = Math.ceil(Math.max(2 * pad + w1 + (w2 ? split + w2 : 0), 2 * pad + textWidth(title, TITLE_CSS)));
    const h = Math.ceil(titleH + Math.max(ports.length, params.length) * rowH + pad);
    // Recreate the texture when the size changes (WebGL textures can't be resized in place).
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      texture.dispose();
    }
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.roundRect(1.5, 1.5, w - 3, h - 3, px(0.004));
    ctx.fillStyle = BG;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = accent;
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.font = TITLE_CSS;
    ctx.fillStyle = TEXT;
    ctx.textAlign = 'left';
    ctx.fillText(fit(title, TITLE_CSS, w - 2 * pad), pad, titleH / 2);
    const column = (rows, x0, cw) => {
      let y = titleH;
      for (const r of rows) {
        if (r.heading) {
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = MUTED;
          ctx.fillRect(x0, y + rowH * 0.12, cw, 2);
          ctx.restore();
          ctx.font = HEAD_CSS;
          ctx.fillStyle = MUTED;
          ctx.textAlign = 'left';
          ctx.fillText(fit(r.heading.toUpperCase(), HEAD_CSS, cw), x0, y + rowH * 0.6);
        } else {
          const vw = Math.min(textWidth(r.value, VALUE_CSS), cw * 0.6);
          ctx.font = KEY_CSS;
          ctx.fillStyle = MUTED;
          ctx.textAlign = 'left';
          ctx.fillText(fit(r.key, KEY_CSS, cw - vw - px(COL_GAP)), x0, y + rowH / 2);
          ctx.font = VALUE_CSS;
          ctx.fillStyle = STATE_COLOURS[r.state] ?? TEXT;
          ctx.textAlign = 'right';
          ctx.fillText(fit(r.value, VALUE_CSS, cw * 0.6), x0 + cw, y + rowH / 2);
        }
        y += rowH;
      }
    };
    column(ports, pad, w1);
    if (w2) column(params, pad + w1 + split, w2);
    texture.needsUpdate = true;
    sprite.scale.set(w / PX_PER_M, h / PX_PER_M, 1);
  }

  return {
    sprite,
    get shownKey() { return shownKey; },
    // key: anything that changes when the content changes (redraws only then).
    show(info, worldPos, key) {
      if (key !== shownKey) {
        draw(info);
        shownKey = key;
      }
      sprite.position.copy(worldPos);
      sprite.visible = true;
    },
    hide() {
      sprite.visible = false;
      shownKey = null;
    },
  };
}
