# Plate-text recognizer

A small CNN (CTC) that reads the number line of a Thai car plate ("1กข1234"). It is trained
only on synthetic images and runs in the browser in plain TypeScript (`lib/ocr/recognizer.ts`),
with no ML runtime. See D-074 and `docs/ocr-eval.md`.

- `synth.py`: synthetic number lines. Bold Thai system fonts (Windows: Tahoma, Leelawadee,
  the UPC families, Angsana/Browallia/Cordia), plate paints, embossing, dirt, glare, blur,
  perspective, JPEG and loose crops. Fonts are only used to render training images; nothing
  from them ships.
- `train.py`: trains on the synthetic lines (about 150k) and reports accuracy on a folder of
  real number lines (`truth.json` with `{file, text}`) after each epoch.
- `export.py`: folds BatchNorm, writes float16 weights to `public/models/plate-rec.bin` and a
  test vector for `lib/ocr/recognizer.test.ts`.
- `province.py`: experimental province-line classifier. Not shipped: it was worse on real
  plates than OCR plus snapping.

```bash
python ml/recognizer/train.py --data <work dir> --real <real number lines dir>
python ml/recognizer/export.py <work dir>/model.pt public/models/plate-rec.bin lib/ocr/__fixtures__/recognizer-vector.json
```

Needs Python 3.11, PyTorch (CUDA recommended; one epoch takes about 45 s on an RTX 2080 Ti),
Pillow, NumPy. Real photos used for evaluation are private and never committed.
