# Progress, todo and roadmap

Update this file whenever a major task is finished (see CLAUDE.md). Newest log entries go on top.

Last updated: 2026-11-10

## Branches

| Branch | Status |
|---|---|
| `main` | Working version: corner calibration, manual / cards / demo modes, asset labels, preview. Version label `manual v2`. |
| `scenario-import` | **In progress.** Illuminator scenarios in the diorama with a timeline panel. 1 commit ahead of main. |
| `detection` | Merged into main. Card detection is paused. |
| `settingup` | Merged into main. |

## In progress

- **Illuminator scenario import** (`scenario-import`, Ruiqi)
  - The diorama is built from an Illuminator/mosaik YAML and played from its output CSV
    (`scenario.js`, `timeline-panel.js`, `assets/illuminator-types.json`, `assets/scenarios/`).
  - New models: battery, grid pylon, house, transformer.
  - Contains the power-balance tutorials a and b.
  - Unit tests pass (54).
  - Next: test on the headset, then merge into main.

## Todo

Roughly in priority order. Put your name next to an item when you pick it up.

- [ ] Headset-test `scenario-import` and merge it into main.
- [ ] Decide where Illuminator runs and how the headset sends it a YAML (see the roadmap's open questions).
- [ ] Export the `EnergySystem` (`system.js`) as Illuminator YAML. This is pure logic, so test it in Node.
- [ ] Colour-card detection: fix the camera-to-view mapping. The ordered list is in
      DETECTION_NOTES.md: check the mapping in `?debug=1`, find cards with a homography,
      reject grey-only calibrations, report "no card here".
- [ ] Assign meta-assets (generators, storage, ...) to the other card colours (`assets/components.json`).
- [ ] Merge the two asset configs: `components.json` (manual/cards) and `library.json`
      (diorama) describe the same assets twice.
- [ ] Link power in manual/cards mode is a hard-coded placeholder (`links.js`). Replace it
      with Illuminator results once the export and run steps work.
- [ ] Stop tracking `xr-log.txt` in git (about 0.5 MB, changes on every headset run): add a `.gitignore`.
- [ ] Split `main.js` (about 3.7k lines) into smaller modules: calibration, input, modes, HUD/log.

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
| Detect cards and tell their colours apart | First version, not reliable yet (DETECTION_NOTES.md) |
| Map each colour to a meta-asset (`components.json`) | 2 of 12 colours mapped (red = house-pv, black = office-pv) |
| Build an energy system from the detected assets | Done for tap-to-add; links are made by hand (trigger on two assets) |
| Export the system as Illuminator YAML | Not started (shared with part 2) |
| Run it in Illuminator and show the results as flows | Not started (shared with part 2) |

### 2. Illuminator integration (all modes)

The energy system built interactively in the glasses (manual, cards, or a loaded
scenario that you edit) becomes a YAML file that Illuminator simulates. The results come
back and play on the table.

| Step | Status |
|---|---|
| YAML + CSV → diorama with a timeline (read a scenario) | In progress on `scenario-import` |
| Map Illuminator model types ↔ our assets, both ways (`illuminator-types.json`) | Read direction in progress on `scenario-import` |
| Energy system → YAML (write a scenario) | Not started |
| Send the YAML to Illuminator and get the output back | Not started; open question below |
| Edit the topology of a loaded scenario on the table, then re-run | Not started |

**Open questions**
- Where does Illuminator run (laptop, server), and how does the headset reach it? One
  option is an endpoint on the dev server that runs Illuminator and returns the CSV.
- How long does a run take? Is it fine to wait for it, or does it need a progress display?
- Which Illuminator models and parameters does each meta-asset map to?

## Done

- 2026-11-10: Preview follows the start-page menu, and the page shows the running version (`manual v2`).
- 2026-11-10: Start-page menu "What goes on the table": manual / cards / demo.
- 2026-11-10: Manual mode: palette along the nearest table edge, ghost placement, connect, finish.
- 2026-11-10: Energy system model (`system.js`) and animated link flows (`links.js`).
- 2026-11-10: Colour-card detection, first version ("slots v4"). Not reliable yet, see DETECTION_NOTES.md.
- 2026-11-10: Floating asset labels with drop-down details.
- 2026-11-10: Diorama with an asset library, new models, a default layout, backgrounds and figures.
- 2026-11-10: Corner calibration with undo, debug mode, crash logging over the dev server.

## Log

- **2026-11-10**: First full day. Built everything under Done. Started the Illuminator
  integration on `scenario-import`. Added CLAUDE.md and this file.
