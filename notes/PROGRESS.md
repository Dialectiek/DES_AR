# Progress, todo and roadmap

Update this file whenever a major task is finished (see CLAUDE.md). Newest log entries go on top.

Last updated: 2026-11-24

## Branches

| Branch | Status |
|---|---|
| `main` | Working version: corner calibration, manual / cards / demo modes, connections as routed cables and tubes, asset labels, full screen version (`?preview=1`). Version label `screen v1`. |
| `ar-47-illuminator-schema` | **Done, not merged.** AR-47: Illuminator model schemas (inputs, outputs, parameters) from the docs; ports limit the connections, floor arrows per port, info panel with ports and parameters. Built on `ar-12-illuminator-models`, so merge that first. Checked in the screen preview; needs a headset test. |
| `ar-12-illuminator-models` | **Done, not merged.** AR-12: a model for every Illuminator component, in manual mode with palette pages. Checked in the screen preview; needs a headset test before merging into main. |
| `ar-11-ewi-office` | **Done, not merged.** AR-11: the office is now the TU Delft EWI tower. Checked in the screen preview; needs a headset test before merging into main. |
| `scenario-import` | **In progress.** Illuminator scenarios in the diorama with a timeline panel. 1 commit ahead of its base, but main has moved on: merging it now conflicts in `diorama.js`, `main.js` and `style.css`. |
| `connections` | Merged into main (PR #2). |
| `claude/to-do-list-c6d6f5` | Merged into main (PR #1): AR task ids. |
| `detection` | Merged into main. Card detection is paused. |
| `settingup` | Merged into main. |

## In progress

- **Illuminator scenario import** (`scenario-import`, Ruiqi)
  - The diorama is built from an Illuminator/mosaik YAML and played from its output CSV
    (`scenario.js`, `timeline-panel.js`, `assets/illuminator-types.json`, `assets/scenarios/`).
  - New models: battery, grid pylon, house, transformer.
  - Contains the power-balance tutorials a and b.
  - Unit tests pass (54).
  - Next: bring in main and resolve the conflicts from the connections merge, so scenario
    flows are drawn as the new cables; then test on the headset and merge into main (AR-1).

## Todo

Roughly in priority order. Put your name next to an item when you pick it up.

Every task has an id `AR-<number>`. Use it in branch names, commit messages and
conversation (e.g. branch `ar-3-yaml-export`, commit "AR-3: export EnergySystem as YAML").
Ids are never reused or renumbered: a new task takes the next free id, and a finished task
keeps its id when it moves to Done. **Next free id: AR-13.** (AR-47 is taken already: it was
assigned directly to the schema task. Skip it when the count gets there.)

- [ ] **AR-1** Bring main into `scenario-import` (it conflicts since the connections merge),
      headset-test it and merge it into main.
- [ ] **AR-2** Decide where Illuminator runs and how the headset sends it a YAML (see the roadmap's open questions).
- [ ] **AR-3** Export the `EnergySystem` (`system.js`) as Illuminator YAML. This is pure logic, so test it in Node.
      Use the schema (AR-47): each node is a model with its `params`; each link connects
      `fromPort` → `toPort`. A link with `model` (every hydrogen tube = `Pipeline`) is a
      component of its own: `from.fromPort → Pipeline.flow_in`, `Pipeline.flow_out → to.toPort`.
- [ ] **AR-4** Colour-card detection: fix the camera-to-view mapping. The ordered list is in
      DETECTION_NOTES.md: check the mapping in `?debug=1`, find cards with a homography,
      reject grey-only calibrations, report "no card here".
- [ ] **AR-5** Assign meta-assets (generators, storage, ...) to the other card colours (`assets/components.json`).
- [ ] **AR-6** Merge the two asset configs: `components.json` (manual/cards) and `library.json`
      (diorama) describe the same assets twice.
- [ ] **AR-7** Link power in manual/cards mode is a placeholder: each link takes its source
      asset's `power_kW` (`system.js`), which sets the flow-dot speed in `cables.js`. Replace
      it with Illuminator results once the export and run steps work.
- [ ] **AR-8** Stop tracking `xr-log.txt` in git (about 0.5 MB, changes on every headset run): add a `.gitignore`.
- [ ] **AR-9** Split `main.js` (about 3.5k lines) into smaller modules: calibration, input, modes, HUD/log.
- [ ] **AR-10** In-game menu in AR with three actions:
      - *Exit*: end the AR session and go back to the start page. Today only the headset's
        own menu button exits (on a screen, the toolbar has "Start page").
      - *Restart*: clear the table and start the chosen mode again without reloading the
        page, keeping the table calibration (hold bumper = recalibrate stays as it is).
        The screen toolbar's "Start over" already does this (`resetBuild()`, then
        `enterManual()` in `main.js`); the headset has no way to reach it.
      - *Save*: store the current system (nodes, links, positions) so it can be loaded
        again. `EnergySystem` (`system.js`) has no serialisation yet: add it as pure,
        tested logic. Start with JSON (localStorage or a download); the Illuminator YAML
        export is AR-3.
      Open: how the menu is opened (a free controller input or an entry on the palette),
      and whether Save needs a matching Load in the same task.

## Roadmap

The plan has two parts. Both use the same pipeline:

```
build / edit on the table  →  Illuminator YAML  →  Illuminator runs the simulation
        ↑                                                    ↓
show the results (energy flows) on the table  ←  output CSV
```

The **YAML file is the bridge** between the glasses and Illuminator. All simulation runs
in Illuminator. The glasses only show the system and let you change its topology.

### 1. Colour-card detection

Lay coloured square cards on the table. The glasses detect them, tell them apart by
colour, and build a meta-asset on each card (generator, storage, consumer, grid, ...).
The detected assets form an energy system. That system is sent to Illuminator as a YAML
file, and the simulation results are shown on the table as energy flows.

| Step | Status |
|---|---|
| Detect cards and tell their colours apart | First version, not reliable yet (DETECTION_NOTES.md, AR-4) |
| Map each colour to a meta-asset (`components.json`) | 2 of 12 colours mapped (red = house-pv, black = office-pv) (AR-5) |
| Build an energy system from the detected assets | Done for tap-to-add; links are made by hand (trigger on two assets) |
| Export the system as Illuminator YAML | Not started (shared with part 2, AR-3) |
| Run it in Illuminator and show the results as flows | Not started (shared with part 2, AR-2, AR-7) |

### 2. Illuminator integration (all modes)

The energy system built interactively in the glasses (manual, cards, or a loaded
scenario that you edit) becomes a YAML file that Illuminator simulates. The results come
back and play on the table.

| Step | Status |
|---|---|
| YAML + CSV → diorama with a timeline (read a scenario) | In progress on `scenario-import` (AR-1) |
| Map Illuminator model types ↔ our assets, both ways (`illuminator-types.json`) | Read direction in progress on `scenario-import` (AR-1) |
| Know each model's inputs, outputs and parameters (`illuminator-schemas.json`) | Done on `ar-47-illuminator-schema` (AR-47): links record `fromPort` / `toPort`, nodes keep `params` |
| Energy system → YAML (write a scenario) | Not started (AR-3) |
| Send the YAML to Illuminator and get the output back | Not started; open question below (AR-2) |
| Edit the topology of a loaded scenario on the table, then re-run | Not started |

**Open questions**
- Where does Illuminator run (laptop, server), and how does the headset reach it? One
  option is an endpoint on the dev server that runs Illuminator and returns the CSV.
- How long does a run take? Is it fine to wait for it, or does it need a progress display?
- Which Illuminator models and parameters does each meta-asset map to? (Models: the
  `illuminator` field in `components.json`; parameters: the schema defaults, AR-47.)
- Illuminator wants every input connected, but many inputs (PV weather: `Az`, `G_Bn`, …)
  come from a CSV reader that has no asset on the table. Add a CSV/weather asset, or fill
  those inputs automatically in the YAML export (AR-3)?

## Done

- 2026-11-24: **AR-47** Illuminator model schemas in manual and cards mode.
  - `tools/illuminator-schemas.cjs` reads the Illuminator docs (`gh-pages` of
    illuminator-team/website, plus the Python source for the models whose page omits the
    keys) and writes `assets/illuminator-schemas.json` (29 models) and
    `notes/ILLUMINATOR_SCHEMAS.md`. Refresh: `node tools/illuminator-schemas.cjs --fill-from-source --out assets/illuminator-schemas.json --md notes/ILLUMINATOR_SCHEMAS.md`.
  - `schema.js` (pure, tested): ports per model, port choice for a new link (same name
    on both sides first, then a name that fits the carrier, then the first free one),
    floor-arrow layout, panel rows.
  - `system.js`: a model takes no more connections than it has inputs / outputs; each
    link records `fromPort` / `toPort`, each node its own `params` (schema defaults).
    Collector and CSV build their ports at run time, so they take any number.
  - `ports-view.js`: a green arrow per input (left of the asset, pointing in) and an
    orange arrow per output (right, pointing out); open ports pulse, connected ones go faint.
    The info panel (pointing at a palette tile or an asset) lists the model, its inputs and
    outputs with what they connect to, and the parameters with their values.
  - Finishing with open ports is allowed but the HUD and the log list them.
  - The four Pipeline assets (and their GLBs) are gone: a hydrogen connection is already
    drawn as a tube, so that is the pipe. The Pipes page keeps the valve and the joint.
    Decided: every hydrogen tube is an Illuminator `Pipeline`. The hydrogen carrier in
    `components.json` has `"illuminator": "Pipeline"`, so a hydrogen link gets `model` and
    its own `params` (the Pipeline defaults: `L` 100 m, `A` 2 m², …). The info panel marks
    it "(Pipeline)". APP_VERSION `ports v3`.
    Decided: the drawn tube and the Pipeline parameters are not linked. The tube's length
    on the table says nothing about `L`; the layout is a schematic.
  - The house (`Load-Residential`) is smaller on the table: `size_m` 0.14 → 0.10.
  - APP_VERSION `ports v2`. 74 unit tests pass. Checked with `?preview=1&build=manual`.
- 2026-11-24: **AR-12** Models for every Illuminator component type, in manual mode.
  - 34 GLBs in `assets/models/illuminator/`, named after the Illuminator types (e.g.
    `PV-ground`, `Load-Industrial`, `H2Storage-sphere`): 21 types, several with variants.
    One look: white equipment on grey plinths, a band and badge in the colour of what the
    asset makes or stores (bolt = electricity, hexagon = hydrogen cyan `#40e0ff`, flame =
    heat, leaf = biomass), buildings like `house-pv`. Real metres, front = +Z.
  - Every connection point (`port_*`) is at **1.0 m**, so links between assets line up.
    Pipeline tiles on a 6 m grid: `Pipeline` (12 m), `Pipeline-short` (6 m),
    `Pipeline-turn-left` / `-right` (90° bends); their ends sit on cell-edge midpoints, and
    a test route of 10 pieces joined with zero gaps. A bend's origin is its cell centre.
  - The builder source is **not in the repo** (the GLBs were the deliverable); a missing
    or changed model needs a new builder, as CLAUDE.md says.
  - Manual mode: `components.json` has the 34 assets with `group` (palette page) and
    `illuminator` (type, for the YAML export), new carriers `hydrogen` (cyan tube) and
    `data` (lavender cable, to the collector and controller). The palette shows one page at
    a time (Electricity, Loads, Hydrogen, Pipes, Other), switched with a row of tabs in
    front of it (`paletteGroups` in `manual.js`, tested; `palette.js`). Placed pipeline
    pieces are not snapped to each other yet.
  - Tests: `tests/components.test.mjs` checks models on disk, groups, carriers, Illuminator
    coverage and the main links (60 tests pass). Checked with `?preview=1&build=manual`
    (all 42 models load, tabs, cyan hydrogen tube); not yet on the headset. Version `models v1`.
- 2026-11-24: **AR-11** The office asset (`office-pv`) is now the TU Delft EWI tower, in
  colour: blue glass in a fine light grid, light-blue crown, red end wall and red crown,
  "TU Delft" letters, a low glass wing, rooftop PV. Built by `buildEwiTower()` in
  `tools/model-builders.js` from `tools/sources/ewi-tower.stl` (52k triangles, simplified
  to 2.3k triangles plus facade textures, 200 KB GLB). Real size (95 m long, 101 m to the
  crown); the demo scene shows it at `"scale": 0.2` (new per-item option in `diorama.js`).
  Checked with `?preview=1` and `?preview=1&build=manual`; not yet on the headset.
  Branch `ar-11-ewi-office`.
- 2026-11-24: Connections drawn the same way in every mode: electricity as a yellow cable,
  heat and gas as a tube, on the ground at right angles around the assets, arching over
  each other where they cross (`router.js` with tests, `cables.js`). Merged from `connections` (PR #2).
- 2026-11-24: Full screen version (`?preview=1`): orbit camera, toolbar (undo, add assets,
  done, start over, views), `?size=` for the table size. Version label `screen v1`. Merged with PR #2.
- 2026-11-24: Todo items numbered AR-1 to AR-9 (PR #1).
- 2026-11-10: Preview follows the start-page menu, and the page shows the running version (`manual v2`).
- 2026-11-10: Start-page menu "What goes on the table": manual / cards / demo.
- 2026-11-10: Manual mode: palette along the nearest table edge, ghost placement, connect, finish.
- 2026-11-10: Energy system model (`system.js`) and animated link flows (`links.js`).
- 2026-11-10: Colour-card detection, first version ("slots v4"). Not reliable yet, see DETECTION_NOTES.md.
- 2026-11-10: Floating asset labels with drop-down details.
- 2026-11-10: Diorama with an asset library, new models, a default layout, backgrounds and figures.
- 2026-11-10: Corner calibration with undo, debug mode, crash logging over the dev server.

## Log

- **2026-11-24**: AR-47: Illuminator schemas, port limits, floor arrows and the info
  panel (branch `ar-47-illuminator-schema`, on top of AR-12). Removed the Pipeline assets
  (the hydrogen tube is the pipe) and made the house smaller. Decided: every hydrogen tube
  is an Illuminator Pipeline with its own parameters. 75 unit tests pass.
  Headset check to do: the panel text size and the arrows on the ML2.
- **2026-11-24**: AR-12: models for every Illuminator component and palette pages in
  manual mode. Unit tests pass (60). Headset check still to do: thin parts (pipes, blades)
  at table scale, and reaching the tab row with the controller.
- **2026-11-24**: AR-11: replaced the office model with the EWI tower (branch
  `ar-11-ewi-office`). Unit tests pass (53). Headset check still to do: the window grid
  is fine (2-4 mm per floor on the table), watch for shimmer on the ML2.
- **2026-11-24**: Gave every todo item an `AR-<number>` id (AR-1 to AR-9) and added AR-10
  (in-game menu). Merged `connections` (PR #2): routed cables and tubes, full screen
  version. `scenario-import` now conflicts with main. Unit tests on main pass (53).
- **2026-11-10**: First full day. Built everything under Done. Started the Illuminator
  integration on `scenario-import`. Added CLAUDE.md and this file.
