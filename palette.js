// Manual mode: the palette along the table edge, and the "ghost" of the asset you are
// about to place.
//
// The palette is one THREE.Group in table-local coordinates (child of tableAnchor):
//   - one tile per asset in components.json: a disc, a small copy of the model, a label,
//   - a "Done" button at the right end (text changes per phase),
//   - an "Add assets" button at the left end, only while connecting.
// Every tile has userData { kind, type, pickCentre, pickRadius }, the same fields as the
// asset objects in assets.js, so pickAsset() picks tiles too.
// Note: Magic Leap 2 is an additive display: dark = transparent, so everything is bright.

import * as THREE from 'three';
import { displayColour } from './assets.js';
import { colourForType } from './system.js';
import { paletteSlots } from './manual.js';

const MINI_MAX = 0.06;          // largest side of the small models on the tiles (m)
const DISC_MAX = 0.045;         // tile disc radius (m), smaller when the tiles are packed
const BUTTON_W = 0.12;          // Done / Add assets button (m)
const BUTTON_H = 0.0375;
const BUTTON_Y = 0.035;
const GHOST_OPACITY = 0.45;

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
function makeButton(colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(BUTTON_W, BUTTON_H, 1);
  sprite.position.y = BUTTON_Y;
  sprite.renderOrder = 11;
  let current = '';
  const draw = (text) => {
    if (text === current) return;
    current = text;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 40);
    else ctx.rect(8, 8, canvas.width - 16, canvas.height - 16);
    ctx.fillStyle = 'rgba(20, 60, 45, 0.75)';
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = colour;
    ctx.stroke();
    ctx.font = '700 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
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
// preloadModels. Tiles are in config.assets order.
export function createPalette(config, templates) {
  const group = new THREE.Group();
  group.name = 'palette';
  const types = Object.keys(config.assets);

  const tiles = types.map((type) => {
    const colour = displayColour(config, colourForType(config, type));
    const tile = new THREE.Group();
    tile.userData = { kind: 'asset', type, colour, label: config.assets[type].label ?? type };
    group.add(tile);
    return tile;
  });

  const done = makeButton('#5affc8');
  const doneTile = new THREE.Group();
  doneTile.add(done.sprite);
  doneTile.userData = { kind: 'done', pickCentre: new THREE.Vector3(0, BUTTON_Y, 0), pickRadius: 0.045 };
  group.add(doneTile);

  const back = makeButton('#5ac8ff');
  back.draw('◀ Add assets');
  const backTile = new THREE.Group();
  backTile.add(back.sprite);
  backTile.userData = { kind: 'back', pickCentre: new THREE.Vector3(0, BUTTON_Y, 0), pickRadius: 0.045 };
  group.add(backTile);

  let phase = 'place';
  let selected = types[0] ?? null;
  let hovered = null;

  // (Re)builds the tile contents for the spacing the table allows.
  function buildTiles(spacing) {
    const r = Math.min(DISC_MAX, spacing * 0.42);
    const mini = Math.min(MINI_MAX, r * 1.4);
    for (const tile of tiles) {
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

  // Puts the tiles along the table edge nearest to the user (head: table-local).
  function layout(length, width, head) {
    const { slots, spacing, yaw } = paletteSlots(tiles.length + 1, length, width, head);
    buildTiles(spacing);
    tiles.forEach((tile, i) => {
      tile.position.set(slots[i].x, 0, slots[i].z);
      tile.rotation.y = yaw;
    });
    const last = slots[slots.length - 1];
    doneTile.position.set(last.x, 0, last.z);
    backTile.position.set(slots[0].x, 0, slots[0].z);
  }

  function setPhase(p) {
    phase = p;
    group.visible = p !== 'done';
    for (const tile of tiles) tile.visible = p === 'place';
    backTile.visible = p === 'connect';
    done.draw(p === 'connect' ? 'Done connecting ✓' : 'Done placing ▶');
  }

  // Tiles the controller can point at right now.
  function pickables() {
    if (phase === 'place') return [...tiles, doneTile];
    if (phase === 'connect') return [backTile, doneTile];
    return [];
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
    for (const t of [doneTile, backTile]) t.children[0].scale.set(BUTTON_W, BUTTON_H, 1).multiplyScalar(t === hovered ? 1.15 : 1);
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

  setPhase('place');

  return {
    group,
    tiles,
    doneTile,
    backTile,
    layout,
    setPhase,
    pickables,
    update,
    showGhost,
    hideGhost,
    get selected() { return selected; },
    set selected(type) { if (config.assets[type]) selected = type; },
  };
}
