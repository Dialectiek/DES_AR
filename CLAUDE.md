# DES_AR ("Table Cube")

WebXR AR app for the **Magic Leap 2** (works on other WebXR AR devices too). The user
calibrates a real table, then builds or views a small energy system on it: houses, PV,
offices, batteries and the grid, with animated energy flows between them.

**Architecture goal:** the glasses are the visualisation and topology editor, and
[Illuminator](https://github.com/illuminator-team) (mosaik-based) does all the simulation.
The **Illuminator scenario YAML is the bridge**: a system built on the table (by hand or
with colour cards) is exported as YAML, Illuminator runs it, and its output CSV plays
back on the table as energy flows. Never simulate inside the app; the flows only show
Illuminator's results (or placeholders until the integration is done).

Status, todo and roadmap: **[notes/PROGRESS.md](notes/PROGRESS.md)**. Colour-card detection details:
[notes/DETECTION_NOTES.md](notes/DETECTION_NOTES.md).

## Run

- `npm start` (= `node devserver.mjs`, port 8000): serves the folder and receives the
  headset log at `POST /log`, appended to `xr-log.txt`.
- Headset: `adb reverse tcp:8000 tcp:8000` and open `http://localhost:8000`, or use a
  devtunnel. Also deployed on GitHub Pages (it caches files for about 10 minutes).
- Laptop without headset: `?preview=1` (add `&build=manual` to drive manual mode with the mouse).
- `npm test`: Node built-in test runner on `tests/*.test.mjs`. No build step, no
  dependencies; three.js comes from a CDN through the import map in `index.html`.

## App flow

1. **Table setup**: aim at the 4 table corners (default), or camera table detection
   (experimental, `?setup=detect`).
2. **What goes on the table** (start-page menu, or `?build=`):
   - `manual`: pick assets from a palette along the table edge, place them, then connect them.
   - `cards`: calibrate colour squares, then tap a coloured card to add its asset. Not
     reliable yet, see notes/DETECTION_NOTES.md.
   - `demo`: the fixed diorama from `assets/scenes/demo.json`.
3. Controls: trigger = act, bumper = undo / step back, hold the bumper = recalibrate.

The full list of URL options is in `index.html` ("URL options") and in the comments in `main.js`.

## Code map

| File | Role |
|---|---|
| `main.js` | Everything WebXR: session, table calibration, input, modes, HUD, logging, preview. Large; grep for the `// ----` section headers. |
| `system.js` | Energy-system model (nodes, links, undo). Pure, tested. |
| `manual.js` / `palette.js` | Manual mode: pure layout logic (tested) / palette and ghost 3D. |
| `cards.js` | Colour-card detection. Pure, tested. |
| `assets.js` / `links.js` | 3D objects for nodes / animated link arcs (manual and cards modes). |
| `diorama.js` / `asset-labels.js` | Diorama scene loader and flows / floating asset info panels. |
| `tools/model-builders.js` | Procedural source of the GLBs in `assets/models/`; export with `tools/export-models.html` (`node devserver.mjs 8001 --allow-save`). |

Data in `assets/`:
- `components.json`: card colours → assets, plus the asset types for **manual and cards** modes.
- `library.json` + `scenes/*.json`: models and scenes for the **diorama**. Two separate
  configs for now; keep both in mind when adding an asset.

## Conventions

- **Pure logic goes in modules without three.js** (`system.js`, `manual.js`, `cards.js`)
  so it runs in Node tests. Add tests there for new logic.
- **Bright colours only**: the ML2 display is additive, so dark colours show as see-through.
- **Units**: metres. Table-local coordinates: origin = table centre on its surface,
  +X = long side, +Z = across, +Y = up. Diorama models are in real metres and the group
  is scaled down to fit the table.
- **Bump `APP_VERSION`** in `main.js` for every change you test on the headset. It shows in
  the HUD and the log, and is the only way to tell which code is running. Leaving and
  re-entering AR does not reload code; reload the page.
- **Log** through `info` / `warn` / `log` in `main.js`. It reaches the page, the headset
  view and `xr-log.txt`. When debugging on the headset, read `xr-log.txt` first.
- **Assets are hand-built**: a missing model gets a new builder in `tools/model-builders.js`
  plus an exported GLB and a library entry. No runtime auto-generation.
- **Language**: everything in the repo is in English.

## Git

- `main` is the working version the team demos. Do feature work on a branch and merge it
  when it works on the headset.
- Current branches are listed with their status in notes/PROGRESS.md.

## Keep notes/PROGRESS.md current

When a major task is finished (a feature merged, a headset test done, a direction
decided), update notes/PROGRESS.md in the same change: move items between Todo / In progress /
Done, add a dated line to the log, and adjust the roadmap. Keep this file (CLAUDE.md) for
things that stay true; put status in notes/PROGRESS.md.
