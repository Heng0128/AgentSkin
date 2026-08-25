// SPDX-License-Identifier: MPL-2.0
/**
 * CLI: extract-theme-from-image.mjs
 *
 * Usage:
 *   node scripts/extract-theme-from-image.mjs <image.bmp> [--json] [--pretty]
 *
 * Reads a 24/32-bit uncompressed BMP, runs the OKLCH perceptual extraction
 * pipeline, and prints the 14-token manifest to stdout.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractTheme } from './lib/oklch-extract.mjs';

const args = process.argv.slice(2);
let imagePath = null;
let outputPath = null;
let pretty = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--json') {
    // default output is JSON; flag is a no-op but accepted for ergonomics
  } else if (a === '--pretty') {
    pretty = true;
  } else if (a === '--out' || a === '-o') {
    outputPath = args[++i];
  } else if (!a.startsWith('-')) {
    imagePath = a;
  }
}

if (!imagePath) {
  console.error('Usage: node scripts/extract-theme-from-image.mjs <image.bmp> [--pretty] [--out <file>]');
  console.error('');
  console.error('Options:');
  console.error('  --pretty   Pretty-print JSON output');
  console.error('  --out, -o  Write output to file instead of stdout');
  process.exit(1);
}

const fullPath = resolve(imagePath);
let buf;
try {
  buf = readFileSync(fullPath);
} catch (e) {
  console.error(`Error reading file: ${fullPath} — ${e.message}`);
  process.exit(2);
}

let result;
try {
  result = extractTheme(buf);
} catch (e) {
  console.error(`Extraction failed: ${e.message}`);
  process.exit(3);
}

const json = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result);

if (outputPath) {
  writeFileSync(resolve(outputPath), json + '\n', 'utf-8');
  console.error(`Theme written to ${resolve(outputPath)}`);
} else {
  console.log(json);
}
