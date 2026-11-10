# Colour-card detection: status and open issues

Branch: `detection`. Paused on 2026-11-10 to work on other things. The last version tested on the Magic Leap 2 was **"slots v4"** (`APP_VERSION` in `main.js`).

## What the app does now

1. **Table corners.** Point at the 4 corners of the table.
2. **Colour squares.** Four 10 × 10 cm squares appear on the table: red, black, blue and yellow. You lay one card in each square and press the trigger once. The app then samples the middle of each square in the headset camera image (3 frames). It also searches up to 10 cm around each square for a camera-image shift.
3. **Play.** Point at a card and press the trigger. The app samples a 1.5 cm patch and matches it to the nearest of the 4 calibrated colours. Red adds `house-pv` and black adds `office-pv`. Blue and yellow are placeholders. These links are set in `assets/components.json`.

The code is in:
- `cards.js`: pure functions, tested in `tests/cards.test.mjs`. Run `node --test tests/*.mjs`.
- `main.js`: the colour-calibration block, `samplePoint`, `startTap` and `tapStep`.

## The main issue: the camera image does not line up with where we sample

These findings come from `xr-log.txt`, sessions 14:17–14:27:

- **No sample ever hit a card.**
  - Colour-square samples read either table (L ≈ 90) or near-black (L ≈ 0–10). The near-black is probably the floor past the table edge, a gap, or the controller.
  - Every calibrated colour therefore came out grey, and the app warned "colours look very alike" each time.
  - The sampled values were never saturated. Yet an older session (13:15, old automatic scan) did measure real colours from the cards: red `#4c0901`, yellow `#fff40f`, blue `#80b6ff`. So the camera can deliver colour. We are just sampling the wrong pixels.
- **The measured "camera shift" isn't stable.** Consecutive triggers gave anywhere from −10 to +10 cm in both directions, often at the edge of the 10 cm search range. A fixed offset would repeat. This looks like a mapping error that is more than a shift: scale (FOV), mirroring, rotation, or an offset larger than 10 cm.
- **"Look at the table so all 4 squares are in view"** was shown 31 times, so the squares often fell outside the projected camera frame.
- **Earlier tests showed the same problem.**
  - Pointing-based calibration sampled the table for blue and yellow.
  - In automatic scans, the region the app took as "table" in the image included floor: the table colour jumped between white and dark grey.
- **Background:** the camera image is 640×480 (landscape) and is attached to the left-eye view, which is 1440×1760 (portrait). We project with `view.projectionMatrix` and `view.transform`. The WebXR spec says the camera image is aligned with that view, but on the ML2 it apparently isn't, or not exactly.

## Results of that issue

- **All cards, and even the white table, come out as one colour** (for example all yellow or all blue).
  - The references are all grey, because calibration sampled the table and dark areas instead of the cards.
  - `nearestColour` always picks one of the 4, so the table itself also gets a colour.
- **Assets don't land on the cards.** We saw this in earlier sessions.

## TODO, in order

1. **Check the camera-to-view mapping on the headset first.**
   - In the debug panel (`?debug=1`), draw the projected table corners and squares on top of the raw camera image.
   - Look for mirroring (X), flipping (Y; there's already a `?flipy=1` switch, never tested), a scale mismatch from the different FOV or aspect ratio, and a large offset.
   - An ML2 screenshot of the debug panel would settle it.
2. **Find the cards in the image without relying on the projection.**
   - In the colour-squares step, look for the 4 coloured blobs across the whole camera image.
   - Match them to the 4 known squares and compute a homography from image to table.
   - This removes shift, scale, rotation and mirroring errors in one go. Use the homography for taps afterwards.
3. **Don't accept a calibration that only contains grey.** Red, blue and yellow must be colourful (chroma above a threshold), and black must be dark. If not, ask the user to recalibrate.
4. **Don't force table pixels into a colour on a tap.** If the patch looks like table white, say "no card here" instead of picking the nearest colour.
5. **WebGL error `0x506`** (invalid framebuffer operation) after every camera read. It seems harmless so far, but it's worth checking in `CameraReader`.
6. **Card-to-asset links:** red = house-pv and black = office-pv are set. Blue and yellow have no asset yet.

## Useful facts

- **Reloading:** leaving and re-entering AR does not load new code. Reload the page. The version label in the log and in the HUD shows which code is running.
- **Table colour:** the table used for testing is beige (`#d0c1a2`), not white. White balance uses the brightest quarter of the table area, not the median.
- **Printed colours:** printed colours look much darker to the camera than their hex codes (red ≈ `#4c0901` after white balance). Matching therefore uses hue first.
- **Old automatic scan:** the automatic scan with shape checks (`detectCards`, `mergeScans`, `filterNew`) is still in `cards.js` and still tested, but it is no longer called from the trigger.
- **Debugging setup:** `node devserver.mjs` on port 8000, plus a devtunnel. The headset sends its log through the tunnel (no cable needed) to `xr-log.txt`.
