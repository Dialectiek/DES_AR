# Progress, todo and roadmap

Update this file whenever a major task is finished (see CLAUDE.md). Newest log entries go on top.

Last updated: 2026-11-24

## Branches

| Branch | Status |
|---|---|
| `main` | Working version: corner calibration, manual / cards / demo modes, connections as routed cables and tubes, asset labels, full screen version (`?preview=1`). Version label `screen v1`. |
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
keeps its id when it moves to Done. **Next free id: AR-12.**

- [ ] **AR-1** Bring main into `scenario-import` (it conflicts since the connections merge),
      headset-test it and merge it into main.
- [ ] **AR-2** Decide where Illuminator runs and how the headset sends it a YAML (see the roadmap's open questions).
- [ ] **AR-3** Export the `EnergySystem` (`system.js`) as Illuminator YAML. This is pure logic, so test it in Node.
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
| Energy system → YAML (write a scenario) | Not started (AR-3) |
| Send the YAML to Illuminator and get the output back | Not started; open question below (AR-2) |
| Edit the topology of a loaded scenario on the table, then re-run | Not started |

**Open questions**
- Where does Illuminator run (laptop, server), and how does the headset reach it? One
  option is an endpoint on the dev server that runs Illuminator and returns the CSV.
- How long does a run take? Is it fine to wait for it, or does it need a progress display?
- Which Illuminator models and parameters does each meta-asset map to?

## Done

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

- **2026-11-24**: AR-11: replaced the office model with the EWI tower (branch
  `ar-11-ewi-office`). Unit tests pass (53). Headset check still to do: the window grid
  is fine (2-4 mm per floor on the table), watch for shimmer on the ML2.
- **2026-11-24**: Gave every todo item an `AR-<number>` id (AR-1 to AR-9) and added AR-10
  (in-game menu). Merged `connections` (PR #2): routed cables and tubes, full screen
  version. `scenario-import` now conflicts with main. Unit tests on main pass (53).
- **2026-11-10**: First full day. Built everything under Done. Started the Illuminator
  integration on `scenario-import`. Added CLAUDE.md and this file.
