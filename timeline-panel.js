// Timeline panel for scenario playback: a small tilted screen just outside the table edge
// nearest to the user (like the manual-mode palette). Left: a play / pause button. Right:
// the scenario name, the simulated clock, a mini chart of the main power series and a
// cursor at the current time. Trigger (or mouse click in ?preview=1) on the button toggles
// play; on the chart it jumps to that time.
//
// Table-local coordinates (child of the table anchor). Colours are bright on purpose: the
// Magic Leap 2 display is additive, so dark = see-through.

import * as THREE from 'three';
import { paletteSlots } from './manual.js';
import { timeLabel } from './scenario.js';

const CW = 1024, CH = 240;          // canvas pixels
const BTN = { x: 20, w: 190 };      // play button area
const CHART = { x0: 240, x1: 1004, y0: 92, y1: 196 };
const TILT = THREE.MathUtils.degToRad(35); // leans back from vertical
const ACCENT = '#5ac8ff';

const hex = (c) => '#' + c.toString(16).padStart(6, '0');

// series: [{ values: Float64Array, color: 0xrrggbb, name }] for the mini chart.
// times: the CSV times. name: the scenario name.
export function createTimelinePanel({ name, times, series, speedText = '' }) {
  const canvas = document.createElement('canvas');
  canvas.width = CW;
  canvas.height = CH;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // Static chart background, drawn once.
  const chart = document.createElement('canvas');
  chart.width = CW;
  chart.height = CH;
  drawChart(chart.getContext('2d'), times, series);

  const group = new THREE.Group();
  group.name = 'timeline panel';
  const tilt = new THREE.Group();
  tilt.rotation.x = -TILT;
  group.add(tilt);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, CH / CW),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
  );
  mesh.name = 'timeline';
  mesh.renderOrder = 5;
  tilt.add(mesh);

  const steps = times.length;
  const state = { index: -1, playing: null, hover: null, wait: 0 };

  function paint(player) {
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(12,16,22,0.82)';
    ctx.beginPath();
    ctx.roundRect(3, 3, CW - 6, CH - 6, 26);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = ACCENT;
    ctx.stroke();

    // Play / pause button.
    const cx = BTN.x + BTN.w / 2, cy = CH / 2, r = 72;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = state.hover === 'play' ? 'rgba(90,200,255,0.45)' : 'rgba(90,200,255,0.2)';
    ctx.fill();
    ctx.lineWidth = state.hover === 'play' ? 8 : 5;
    ctx.strokeStyle = state.hover === 'play' ? '#ffffff' : ACCENT;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    if (player.playing) {
      ctx.fillRect(cx - 26, cy - 32, 18, 64);
      ctx.fillRect(cx + 8, cy - 32, 18, 64);
    } else {
      ctx.beginPath();
      ctx.moveTo(cx - 20, cy - 36);
      ctx.lineTo(cx + 34, cy);
      ctx.lineTo(cx - 20, cy + 36);
      ctx.closePath();
      ctx.fill();
    }

    // Name, clock, speed.
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = '600 30px system-ui, sans-serif';
    ctx.fillStyle = '#aebccb';
    ctx.fillText(name, CHART.x0, 34, 420);
    ctx.textAlign = 'right';
    ctx.font = '700 44px system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(timeLabel(times[player.index]), CHART.x1, 40);
    if (speedText) {
      ctx.font = '500 24px system-ui, sans-serif';
      ctx.fillStyle = '#aebccb';
      ctx.fillText(speedText, CHART.x1, 74);
    }

    // Chart and cursor.
    ctx.drawImage(chart, 0, 0);
    if (state.hover?.seek !== undefined) {
      const hx = CHART.x0 + state.hover.seek * (CHART.x1 - CHART.x0);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(hx, CHART.y0 - 6);
      ctx.lineTo(hx, CHART.y1 + 6);
      ctx.stroke();
    }
    const x = CHART.x0 + player.fraction * (CHART.x1 - CHART.x0);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, CHART.y0 - 8);
    ctx.lineTo(x, CHART.y1 + 8);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, CHART.y1 + 14, 9, 0, Math.PI * 2);
    ctx.fill();
    texture.needsUpdate = true;
  }

  const raycaster = new THREE.Raycaster();

  return {
    group,
    mesh,

    // Along the table edge nearest to the user (head: table-local position).
    layout(length, width, head) {
      const { slots, yaw, edge } = paletteSlots(1, length, width, head, { offset: 0.05 });
      const edgeLength = edge.axis === 'z' ? length : width;
      const w = Math.min(0.5, 0.8 * edgeLength);
      mesh.scale.setScalar(w);
      mesh.position.set(0, (w * CH) / CW / 2, 0);
      group.position.set(slots[0].x, 0, slots[0].z);
      group.rotation.y = yaw;
      state.index = -1; // repaint
      return { edge, width: w };
    },

    // ray: { origin, dir } in world space (THREE.Vector3). Returns { action: 'play' } or
    // { action: 'seek', fraction }, with the hit point, or null.
    pick(ray) {
      if (!group.visible) return null;
      raycaster.set(ray.origin, ray.dir);
      const hit = raycaster.intersectObject(mesh, false)[0];
      if (!hit?.uv) return null;
      const px = hit.uv.x * CW;
      if (px >= BTN.x - 10 && px <= BTN.x + BTN.w + 10) return { action: 'play', point: hit.point };
      const f = (px - CHART.x0) / (CHART.x1 - CHART.x0);
      if (f >= -0.03 && f <= 1.03) return { action: 'seek', fraction: Math.min(1, Math.max(0, f)), point: hit.point };
      return { action: 'none', point: hit.point };
    },

    setHover(hit) {
      const h = hit?.action === 'play' ? 'play' : hit?.action === 'seek' ? { seek: hit.fraction } : null;
      const same = h === state.hover || (h?.seek !== undefined && state.hover?.seek !== undefined && Math.abs(h.seek - state.hover.seek) < 0.004);
      if (same) return;
      state.hover = h;
      state.index = -1;
    },

    // Every frame: repaints when the shown step, play state or hover changed (≤ 10 per s).
    update(player, dt) {
      state.wait -= dt;
      const changed = player.index !== state.index || player.playing !== state.playing;
      if (!changed || (state.wait > 0 && player.playing === state.playing)) return;
      state.index = player.index;
      state.playing = player.playing;
      state.wait = 0.1;
      paint(player);
    },

    dispose() {
      texture.dispose();
      mesh.geometry.dispose();
      mesh.material.dispose();
    },

    steps,
  };
}

function drawChart(ctx, times, series) {
  const { x0, x1, y0, y1 } = CHART;
  let lo = 0, hi = 0;
  for (const s of series) for (const v of s.values) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi - lo < 1e-9) hi = lo + 1;
  const n = times.length;
  const X = (i) => x0 + (n > 1 ? i / (n - 1) : 0) * (x1 - x0);
  const Y = (v) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);

  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  // Zero line and hour ticks every 6 hours (by the time labels).
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, Y(0));
  ctx.lineTo(x1, Y(0));
  ctx.stroke();
  ctx.font = '500 20px system-ui, sans-serif';
  ctx.fillStyle = '#aebccb';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  times.forEach((t, i) => {
    const hm = String(t).slice(11, 16);
    if (!/^(00|06|12|18):00$/.test(hm)) return;
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.moveTo(X(i), y0);
    ctx.lineTo(X(i), y1);
    ctx.stroke();
    ctx.fillText(hm, Math.min(Math.max(X(i), x0 + 28), x1 - 28), y1 + 24);
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${hi.toFixed(1)} kW`, x0 + 6, y0 + 12);

  // Series and their legend.
  let lx = x0;
  for (const s of series) {
    ctx.strokeStyle = hex(s.color);
    ctx.lineWidth = 4;
    ctx.beginPath();
    let pen = false;
    s.values.forEach((v, i) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      if (pen) ctx.lineTo(X(i), Y(v));
      else ctx.moveTo(X(i), Y(v));
      pen = true;
    });
    ctx.stroke();
    ctx.fillStyle = hex(s.color);
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillText(s.name, lx, y0 - 14);
    lx += ctx.measureText(s.name).width + 28;
  }
}
