# Bundled libraries (1.15 build 18)

Copied in unchanged (source-map comments removed) so scanning works with no internet and
nothing is loaded from a CDN. They are only downloaded when first used, and the service
worker keeps them in their own cache (`inventory-vendor-1` in sw.js) that app updates don't
clear. If you replace any file here, bump `VENDOR` in sw.js.

| File | From | License |
|------|------|---------|
| `zxing.min.js` | `@zxing/library` 0.21.3, `umd/index.min.js` | Apache-2.0 (`LICENSE-zxing.txt`) |
| `ocr/tesseract.min.js`, `ocr/worker.min.js` | `tesseract.js` 6.0.1, `dist/` | Apache-2.0 (`ocr/LICENSE-tesseract.js.md`) |
| `ocr/tesseract-core-simd-lstm.wasm.js`, `ocr/tesseract-core-lstm.wasm.js` | `tesseract.js-core` 6.0.0 (the worker picks SIMD when the phone supports it) | Apache-2.0 (`ocr/LICENSE-tesseract-core.txt`) |
| `ocr/eng.traineddata.gz` | `@tesseract.js-data/eng` 1.0.0, `4.0.0_best_int` | Apache-2.0 |

`zxing.min.js` is only used where the browser has no built-in `BarcodeDetector`
(Android Chrome has one).
