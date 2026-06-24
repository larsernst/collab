import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(root, 'public', 'ocr-assets');

const assets = [
  [
    join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
    join(publicDir, 'worker.min.js'),
  ],
  [
    join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core-lstm.wasm.js'),
    join(publicDir, 'tesseract-core-lstm.wasm.js'),
  ],
  [
    // The .wasm.js glue fetches this binary at runtime; without it the WASM
    // engine fails to initialize and OCR falls back to the native CLI (which
    // returns plain text only, with no word bounding boxes for the overlay).
    join(root, 'node_modules', 'tesseract.js-core', 'tesseract-core-lstm.wasm'),
    join(publicDir, 'tesseract-core-lstm.wasm'),
  ],
  [
    join(root, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0', 'eng.traineddata.gz'),
    join(publicDir, 'eng.traineddata.gz'),
  ],
];

await mkdir(publicDir, { recursive: true });
await Promise.all(assets.map(([from, to]) => copyFile(from, to)));
