# Source geometry for the model builders

Files that `tools/model-builders.js` (and `tools/controller-avatars.mjs`) read when they export the GLBs. The app never loads them.

| File | What | Used by |
|---|---|---|
| `ewi-tower.stl` | The EWI tower of TU Delft: binary STL, metres, Z up, 52k triangles, no colour. Provided by the team (`EWI(1).stl`). | `buildEwiTower()` → `assets/models/ewi-tower.glb` (the `office-pv` asset) |
| `avatar-cyan.glb` | A rigged avatar with a cyan shirt (GLB from three.js GLTFExporter, 4 skins, 18 hand / blink animations). Provided by the team (`avatar-cyan(2).glb`). | `tools/controller-avatars.mjs` → `assets/models/illuminator/<controller type>.glb`, one shirt colour each |
