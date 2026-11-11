# Plate OCR: current status

**What runs today:** a plate finder that looks for plate paint around text (D-072), checked by
reading each box (D-076); and a small CNN trained on synthetic plate lines (D-074) that reads
the number line. Tesseract reads only the province line, and is the fallback when the trained
path finds nothing. Everything runs in the browser, so photos never leave the device.

## Pipeline

1. **Find plates in a photo** (`findPlates` in `lib/client/ocr.ts`, `lib/ocr/layout.ts`):
   - Dark text on bright paint seeds a flood fill over that plate's paint colour (text can be
     crossed, Canny edges cannot), which gives the plate outline. A region counts when it is
     plate-shaped, mostly paint, and has text below the number line (D-072). The fill also
     continues across a shadow edge or a light gradient over the same paint (D-083).
   - The detector runs at 1000 px and at 450 px for close-ups. Where boxes overlap it keeps
     the bigger one (D-079). If neither finds anything in a big photo, one more pass runs at up
     to 2000 px for small plates (D-083).
   - **Each box is checked by reading it** (D-076): its number line is cut out and read by the
     recognizer under the plate grammar. The box is kept only if the reading has at least 3
     characters and the mean character probability is at least 0.6. This drops windows, signs
     and lights. Without the model file, every box is kept.
   - Only if all of that finds nothing: Tesseract text spotting over the photo (1280 px).
2. **The user confirms every crop** (D-070): found plates are only suggested as boxes. The user
   moves or resizes a box, or draws one by hand, and nothing is cut until they confirm.
3. **Read each crop** (`readPlate`):
   - Clean-up (D-083): tilted crops are levelled (projection-profile skew estimate), and crops
     narrower than 400 px are upscaled (up to 4×). Lighting is flattened by estimating the
     background with a grey closing and dividing it out.
   - Line finding (`plateTextLines`, D-073): the number line and the province line come from
     dark-text rows. Plate borders, and wide dark shapes touching the crop edge, are ignored.
   - **The number line goes to the trained recognizer** (D-074): a CNN with CTC, 851k
     parameters, run in plain TypeScript (`lib/ocr/recognizer.ts`, no ML runtime). Decoding is
     held to the plate grammar: an optional digit, 1–2 consonants, then 1–4 digits. The line is
     read from three slightly different cuts, and the most confident reading is kept. The
     recognizer gets grey levels, not a binary image, because it was trained on grey.
   - The province line is binarized (Otsu), read by Tesseract as a single line and snapped to
     the province list. A province classifier was tried (`ml/recognizer/province.py`) but not
     shipped: it did worse on real plates.
   - Fallbacks, used when the trained path gives nothing: Tesseract line by line, with the
     plate-character whitelist at two sizes (D-073), then whole-crop OCR. Motorcycle plates
     (three lines) always take the Tesseract path.
4. **Interpretation** (`lib/ocr/interpret.ts`): picks the plate line and the province line,
   trims border noise read as extra digits, and turns characters below 35% confidence into `?`.
   The reading **prefills** the plate card with a note asking the user to check it, and a
   stronger warning when confidence is low. The user can always edit it.

## Assets and size

- Recognizer: `public/models/plate-rec.bin`, float16 weights, 1.7 MB. It is trained by
  `ml/recognizer/train.py` on about 150k synthetic lines and exported by `export.py` (see
  `ml/recognizer/README.md`).
- Tesseract: tesseract.js 7.0.0 (Apache-2.0), self-hosted under `/tesseract`. The browser
  downloads one WASM core (~3.9 MB as `.wasm.js`, served compressed) and a 111 KB worker.
- Thai model: `tha.traineddata` from `tessdata_fast` (Apache-2.0), 905 KB gzipped, cached in
  IndexedDB after the first load.
- Everything loads only in the found flow, when the first photo is added. Progress is shown.

## Verified

- Unit tests: `interpret.test.ts` (16), `layout.test.ts` (14), and `recognizer.test.ts` (7).
  The recognizer tests include a test vector exported from the PyTorch model, so the
  TypeScript forward pass matches training.
- E2E (`e2e/ocr.spec.ts`, at 390 and 360 px): a drawn photo with two plates is scanned. Both
  are suggested, both numbers read exactly and both provinces are selected. Manual cropping
  and a small plate in a large photo are covered too.

## Benchmarks

Two private sets, never committed, scored end to end in the browser with local-only harnesses
(`e2e/zz-*`, git-ignored):

- **Floor**: the user's photo of 22 plates laid out on a patterned floor (worn, dirty, framed,
  yellow, green, one old "34-1974" plate).
- **Commons**: 11 standard car-plate close-ups from the 131 freely licensed Thai plate photos on
  Wikimedia Commons (licences and authors recorded locally; transcribed by hand).

Measured 2026-09-28, with each step added in turn:

| Step                                                       | Floor: found | Floor: exact / chars / province | Commons: exact / chars / province |
| ---------------------------------------------------------- | ------------ | ------------------------------- | --------------------------------- |
| Tesseract text spotting + whole-crop OCR                   | 0/22         | 3/22 · 45% · 12/22              | —                                 |
| Layout detector (D-072) + line-by-line OCR (D-073)         | 15–16/22     | 5/22 · 65% · 15/22              | 6/11 · 78% · 6/10                 |
| + trained recognizer, grammar decoding, 3-cut vote (D-074) | 15–16/22     | **16/22 · 90%** · 14/22         | **9/11 · 93%** · 6/10             |

Later changes were measured on their own:

- Checking suggestions by reading them (D-076): on 16 whole-car Commons photos, most false boxes
  were dropped (for example 4→1 and 3→1), and the plate was kept in every photo where it had
  been found. On the floor photo, 15/22 plates are still found.
- Image clean-up (D-083), on a 33-case synthetic set (clean, small, tiny, tilted 5°/9°, blur,
  light gradient, hard shadow, faint, noisy, combined): exact reads 24 → 32, provinces
  23 → 32, plates found 30 → 33.

Remaining errors on the floor photo: the line finder cutting off the last digit (2), similar
letters (ห/ท, จ/ซ), a faded plate, a vanity plate background (6000 → 9999) and the unsupported
old "NN-NNNN" format. Provinces are the weakest part (about 65%).

## Known gaps

- **Small real-photo sets.** 22 + 11 plates is not enough to trust the numbers far; mud, water,
  night and motion blur are barely covered.
- Motorcycle plates (three lines) are read by Tesseract only, and not found automatically.
- No plate-on-vehicle check.
- Not yet measured: latency on a throttled mid-range Android device. Checking suggestions adds
  about 0.25 s per box (D-076).

## Next

- Provinces: a text recognizer for the province line, trained on text closer to the plate
  font, or on real labelled lines.
- The line finder: keep the last digit when a stain touches it.
- Old and commercial "NN-NNNN" plates (yellow, green), and motorcycle plates.
- More real photos to test with, especially mud, water and night.
