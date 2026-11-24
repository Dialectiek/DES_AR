// Manual mode: the palette along the table edge, and the "ghost" of the asset you are
// about to place.
//
// The palette is one THREE.Group in table-local coordinates (child of tableAnchor):
//   - one tile per asset in components.json: a disc, a small copy of the model, a label.
//     The assets are split into pages (components.json "paletteGroups", manual.js
//     paletteGroups); only the current page's tiles are shown,
//   - a row of group tabs just in front of the tiles (closer to the user), one per page,
//   - a "Done" button at the right end. The whole palette hides in the 'done' phase.
//   - "Save" and "Load" buttons at the end of the tab row. Load shows a list of saves in
//     place of the tiles (showList), with a "Cancel" button at the end.
// Every tile has userData { kind, type, pickCentre, pickRadius }, the same fields as the
// asset objects in assets.js, so pickAsset() picks tiles too. Tabs have kind 'group'.
// Note: Magic Leap 2 is an additive display: dark = transparent, so everything is bright.

import * as THREE from 'three';
import { displayColour } from './assets.js';
import { colourForType } from './system.js';
import { paletteSlots, paletteGroups } from './manual.js';

const MINI_MAX = 0.06;          // largest side of the small models on the tiles (m)
const DISC_MAX = 0.045;         // tile disc radius (m), smaller when the tiles are packed
const BUTTON_W = 0.12;          // Done button (m)
const BUTTON_H = 0.0375;
const BUTTON_Y = 0.035;
const TAB_W = 0.1;              // group tabs (m)
const TAB_H = 0.03;
const TAB_OFFSET = 0.15;        // tab row distance outside the table edge (tiles: 0.07)
const GHOST_OPACITY = 0.45;

function rgba(hex, alpha) {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
}

function textSprite(text, colour, widthM) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, 192, 50, 372);
  ctx.fillStyle = colour;
  ctx.fillText(text, 192, 50, 372);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(widthM, widthM / 4, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// A flat button facing the viewer: bright outline and text (dark would be invisible).
// draw(text, look): look 'normal' (Done / Add assets), 'on' (the current tab, filled in
// its colour) or 'off' (another tab, dimmer).
function makeButton(colour, w = BUTTON_W, h = BUTTON_H, y = BUTTON_Y) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round((512 * h) / w);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(w, h, 1);
  sprite.userData.size = [w, h];
  sprite.position.y = y;
  sprite.renderOrder = 11;
  let current = '';
  const draw = (text, look = 'normal') => {
    if (text + look === current) return;
    current = text + look;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 40);
    else ctx.rect(8, 8, canvas.width - 16, canvas.height - 16);
    ctx.fillStyle = look === 'on' ? rgba(colour, 0.5) : look === 'off' ? 'rgba(20, 40, 60, 0.55)' : 'rgba(20, 60, 45, 0.75)';
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = look === 'off' ? rgba(colour, 0.5) : colour;
    ctx.stroke();
    ctx.font = '700 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = look === 'off' ? 'rgba(255, 255, 255, 0.7)' : '#ffffff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4, canvas.width - 60);
    texture.needsUpdate = true;
  };
  return { sprite, draw };
}

function disc(radius, colour) {
  const mat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 40).rotateX(-Math.PI / 2), mat);
  mesh.position.y = 0.002;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + 0.004, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: colour, side: THREE.DoubleSide })
  );
  ring.position.y = 0.0025;
  const g = new THREE.Group();
  g.add(mesh, ring);
  return { group: g, mat };
}

function placeholderCube(size, colour) {
  const geo = new THREE.BoxGeometry(size, size, size).translate(0, size / 2, 0);
  const cube = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.4 }));
  cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff })));
  return cube;
}

// Small copy of an asset's model (shares geometry and materials with the template).
function miniModel(template, size, colour) {
  if (!template) return { object: placeholderCube(size * 0.7, colour), height: size * 0.7 };
  const s = size / Math.max(template.height, template.footprint, 1e-6);
  const object = template.object.clone(true);
  object.scale.setScalar(s);
  return { object, height: template.height * s };
}

// config: components.json; templates: Map(type → { object, height, footprint }) from
// preloadModels. Tiles are in page order (paletteGroups), config.assets order within a page.
export function createPalette(config, templates) {
  const group = new THREE.Group();
  group.name = 'palette';
  const pages = paletteGroups(config);
  const pageOf = new Map();
  pages.forEach((p, i) => p.types.forEach((t) => pageOf.set(t, i)));
  const types = pages.flatMap((p) => p.types);

  const tiles = types.map((type) => {
    const colour = displayColour(config, colourForType(config, type));
    const tile = new THREE.Group();
    tile.userData = { kind: 'asset', type, page: pageOf.get(type), colour, label: config.assets[type].label ?? type };
    group.add(tile);
    return tile;
  });

  // One tab per page, only when there is more than one page.
  const tabs = pages.length > 1 ? pages.map((p, i) => {
    const button = makeButton(p.colour, TAB_W, TAB_H, TAB_H / 2 + 0.006);
    const tab = new THREE.Group();
    tab.add(button.sprite);
    tab.userData = {
      kind: 'group', page: i, label: p.label, draw: button.draw,
      pickCentre: new THREE.Vector3(0, button.sprite.position.y, 0), pickRadius: 0.035,
    };
    group.add(tab);
    return tab;
  }) : [];

  const done = makeButton('#5affc8');
  const doneTile = new THREE.Group();
  doneTile.add(done.sprite);
  doneTile.userData = { kind: 'done', pickCentre: new THREE.Vector3(0, BUTTON_Y, 0), pickRadius: 0.045 };
  group.add(doneTile);

  done.draw('Done ✓');

  // Save / Load, at the end of the tab row.
  const tools = [['save', '💾 Save'], ['load', '📂 Load']].map(([kind, text]) => {
    const button = makeButton('#ffd27a', TAB_W, TAB_H, TAB_H / 2 + 0.006);
    button.draw(text);
    const t = new THREE.Group();
    t.add(button.sprite);
    t.userData = { kind, pickCentre: new THREE.Vector3(0, button.sprite.position.y, 0), pickRadius: 0.035 };
    group.add(t);
    return t;
  });

  // The list of saves (showList): one button per item, then Cancel.
  let list = null; // [button group] while shown

  let phase = 'edit';
  let page = 0;
  let selected = pages[0]?.types[0] ?? null;
  let hovered = null;
  let lastLayout = null; // [length, width, head] of the last layout(), to lay out a new page

  // (Re)builds the contents of the given tiles for the spacing the table allows.
  function buildTiles(list, spacing) {
    const r = Math.min(DISC_MAX, spacing * 0.42);
    const mini = Math.min(MINI_MAX, r * 1.4);
    for (const tile of list) {
      for (const c of [...tile.children]) {
        tile.remove(c);
        c.traverse((o) => {
          if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
        });
      }
      const { type, colour, label } = tile.userData;
      const base = disc(r, colour);
      const model = miniModel(templates.get(type), mini, colour);
      const text = textSprite(label, colour, Math.max(0.06, spacing * 0.95));
      text.position.y = model.height + 0.02;
      tile.add(base.group, model.object, text);
      Object.assign(tile.userData, {
        base: base.group,
        baseMat: base.mat,
        pickCentre: new THREE.Vector3(0, Math.max(model.height, 0.02) / 2, 0),
        pickRadius: Math.max(r, model.height / 2) * 1.05,
      });
    }
  }

  const pageTiles = () => tiles.filter((t) => t.userData.page === page);

  // Puts the current page's tiles along the table edge nearest to the user (head:
  // table-local), and the tabs in a row just in front of them.
  function layout(length, width, head) {
    lastLayout = [length, width, head];
    const shown = pageTiles();
    const { slots, spacing, yaw } = paletteSlots(shown.length + 1, length, width, head);
    buildTiles(shown, spacing);
    shown.forEach((tile, i) => {
      tile.position.set(slots[i].x, 0, slots[i].z);
      tile.rotation.y = yaw;
    });
    const last = slots[slots.length - 1];
    doneTile.position.set(last.x, 0, last.z);
    const rowItems = [...tabs, ...tools];
    const row = paletteSlots(rowItems.length, length, width, head, { offset: TAB_OFFSET, maxSpacing: TAB_W + 0.02, lastGap: 0.03 });
    rowItems.forEach((t, i) => t.position.set(row.slots[i].x, 0, row.slots[i].z));
    if (list) layoutList();
    showPhase();
  }

  function showPhase() {
    group.visible = phase !== 'done';
    for (const tile of tiles) tile.visible = !list && tile.userData.page === page;
    for (const tab of tabs) {
      tab.visible = !list;
      tab.userData.draw(tab.userData.label, tab.userData.page === page ? 'on' : 'off');
    }
    for (const t of tools) t.visible = !list;
    doneTile.visible = !list;
  }

  function disposeList() {
    for (const b of list ?? []) {
      group.remove(b);
      b.children[0].material.map?.dispose();
      b.children[0].material.dispose();
    }
    list = null;
  }

  function layoutList() {
    if (!lastLayout) return;
    const { slots, spacing } = paletteSlots(list.length, ...lastLayout);
    const w = Math.min(BUTTON_W, Math.max(0.05, spacing * 0.92));
    list.forEach((b, i) => {
      b.position.set(slots[i].x, 0, slots[i].z);
      const sprite = b.children[0];
      sprite.userData.size = [w, BUTTON_H];
      sprite.scale.set(w, BUTTON_H, 1);
    });
  }

  // Shows the given items (strings) in place of the tiles; the last button is "Cancel".
  // Picking one gives a tile with kind 'list-item' and its index, or kind 'list-cancel'.
  function showList(labels) {
    disposeList();
    list = [...labels.map((label, index) => ({ label, kind: 'list-item', index })), { label: '✕ Cancel', kind: 'list-cancel' }]
      .map(({ label, kind, index }) => {
        const button = makeButton(kind === 'list-cancel' ? '#ff9a7a' : '#ffd27a');
        button.draw(label);
        const b = new THREE.Group();
        b.add(button.sprite);
        b.userData = { kind, index, label, pickCentre: new THREE.Vector3(0, BUTTON_Y, 0), pickRadius: 0.045 };
        group.add(b);
        return b;
      });
    layoutList();
    showPhase();
  }

  function hideList() {
    disposeList();
    showPhase();
  }

  function setPhase(p) {
    phase = p;
    showPhase();
  }

  // Shows another page. The selection moves to the page's first asset unless it is on
  // that page already. Returns the page ({ key, label, colour, types }).
  function setPage(i) {
    if (!pages[i]) return pages[page];
    if (i !== page) {
      page = i;
      if (!pages[i].types.includes(selected)) selected = pages[i].types[0];
      if (lastLayout) layout(...lastLayout);
      else showPhase();
    }
    return pages[page];
  }

  // Tiles the controller can point at right now.
  function pickables() {
    if (phase === 'done') return [];
    if (list) return list;
    return [...pageTiles(), doneTile, ...tabs, ...tools];
  }

  // Every frame: hover / selection highlights. hoverTile: a tile group or null.
  function update(time, hoverTile) {
    hovered = hoverTile;
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.008);
    for (const tile of tiles) {
      const { base, baseMat, type } = tile.userData;
      if (!base) continue;
      const sel = type === selected, hov = tile === hovered;
      baseMat.opacity = sel ? 0.45 + 0.35 * pulse : hov ? 0.6 : 0.2;
      base.scale.setScalar(hov ? 1.15 : sel ? 1.08 : 1);
    }
    for (const t of [doneTile, ...tabs, ...tools, ...(list ?? [])]) {
      const sprite = t.children[0];
      const [w, h] = sprite.userData.size;
      sprite.scale.set(w, h, 1).multiplyScalar(t === hovered ? 1.15 : 1);
    }
  }

  // Ghost: see-through copy of the selected asset at the cursor (table-local), cached per type.
  const ghosts = new Map();
  let ghostShown = null;
  function ghostFor(type) {
    if (ghosts.has(type)) return ghosts.get(type);
    const template = templates.get(type);
    const colour = displayColour(config, colourForType(config, type));
    let object;
    if (template) {
      object = template.object.clone(true);
      object.traverse((o) => {
        if (!o.isMesh) return;
        const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
          const c = m.clone();
          c.transparent = true;
          c.opacity = GHOST_OPACITY;
          c.depthWrite = false;
          return c;
        });
        o.material = Array.isArray(o.material) ? mats : mats[0];
      });
    } else {
      object = placeholderCube(0.05, colour);
      object.material.transparent = true;
      object.material.opacity = GHOST_OPACITY;
    }
    const footprint = template ? template.footprint : 0.05;
    const r = Math.max(0.035, footprint * 0.6);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r, r + 0.006, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
    );
    ring.position.y = 0.003;
    const g = new THREE.Group();
    g.add(object, ring);
    g.visible = false;
    g.userData.ringMat = ring.material;
    group.add(g);
    ghosts.set(type, g);
    return g;
  }

  // Shows the selected asset's ghost at (x, z), turned towards head; ok = false: only a
  // dim grey ring (not red: red is also a card colour).
  function showGhost(x, z, head, ok = true) {
    const g = selected ? ghostFor(selected) : null;
    if (ghostShown && ghostShown !== g) ghostShown.visible = false;
    ghostShown = g;
    if (!g) return;
    g.visible = true;
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(head.x - x, head.z - z);
    g.children[0].visible = ok;
    g.userData.ringMat.color.set(ok ? displayColour(config, colourForType(config, selected)) : '#8a9099');
    g.userData.ringMat.opacity = ok ? 0.8 : 0.5;
  }

  function hideGhost() {
    if (ghostShown) ghostShown.visible = false;
    ghostShown = null;
  }

  setPhase('edit');

  return {
    group,
    tiles,
    tabs,
    pages,
    doneTile,
    layout,
    setPhase,
    showList,
    hideList,
    get listShown() { return !!list; },
    setPage,
    pickables,
    update,
    showGhost,
    hideGhost,
    get page() { return pages[page]; },
    get selected() { return selected; },
    set selected(type) {
      if (!config.assets[type]) return;
      if (pageOf.get(type) !== page) setPage(pageOf.get(type));
      selected = type;
    },
  };
}
