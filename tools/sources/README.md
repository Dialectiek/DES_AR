# Source geometry for the model builders

Files that `tools/model-builders.js` reads when it exports the GLBs. The app never loads them.

| File | What | Used by |
|---|---|---|
| `ewi-tower.stl` | The EWI tower of TU Delft: binary STL, metres, Z up, 52k triangles, no colour. Provided by the team (`EWI(1).stl`). | `buildEwiTower()` → `assets/models/ewi-tower.glb` (the `office-pv` asset) |
