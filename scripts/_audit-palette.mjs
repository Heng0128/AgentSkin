// --- TEMP audit tool, deleted after use ---
import fs from 'node:fs';
import path from 'node:path';

const THEMES_DIR = path.join('themes');

function toRgbTriple(input) {
  const raw = String(input ?? '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (m) {
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  m = /^#([0-9a-f]{3})$/i.exec(raw);
  if (m) {
    const full = m[1]
      .split('')
      .map((c) => c + c)
      .join('');
    const n = parseInt(full, 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,[\s\d.]+)?\)$/i.exec(raw);
  if (m) return `${m[1]}, ${m[2]}, ${m[3]}`;
  return null;
}

function parsePaletteCss(css) {
  const tokens = {};
  const re = /--agentskin-([\w-]+)\s*:\s*([^;]+);/g;
  let m = re.exec(css);
  while (m !== null) {
    tokens[m[1]] = m[2].trim();
    m = re.exec(css);
  }
  return tokens;
}

const mapping = {
  bg: 'background',
  surface: 'surface',
  'surface-elevated': 'surfaceElevated',
  text: 'foreground',
  muted: 'muted',
  accent: 'accent',
  secondary: 'secondary',
  border: 'border',
  'code-bg': 'codeBackground',
  'code-fg': 'codeForeground',
  'focus-ring': 'focusRing',
  selection: 'selection',
};

const dirs = fs
  .readdirSync(THEMES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

console.log('=== PALETTE-CSS vs MANIFEST COLORS ===\n');

for (const dir of dirs) {
  const manifestPath = path.join(THEMES_DIR, dir, 'manifest.json');
  const palettePath = path.join(THEMES_DIR, dir, 'palette.css');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(palettePath)) continue;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const paletteCss = fs.readFileSync(palettePath, 'utf8');
  const pt = parsePaletteCss(paletteCss);
  const mc = manifest.colors || {};
  const issues = [];

  for (const [pk, mk] of Object.entries(mapping)) {
    const pv = pt[pk],
      mv = mc[mk];
    if (pv === undefined && mv === undefined) continue;
    if (pv !== undefined && mv !== undefined) {
      const pvN = String(pv).trim();
      const mvN = String(mv).trim();
      if (pvN !== mvN) {
        if (mk === 'selection' && pvN.includes('color-mix')) continue; // derived
        if (mk === 'focus-ring' && pvN.includes('color-mix')) continue; // derived
        if (mk === 'border' && pvN.startsWith('rgba') && mvN.startsWith('rgba')) continue; // same value
        issues.push(`  DIFF --agentskin-${pk}: palette="${pvN}" manifest.${mk}="${mvN}"`);
      }
    } else if (pv === undefined) {
      issues.push(`  MISSING --agentskin-${pk} (manifest.${mk}="${mv}")`);
    } else {
      issues.push(`  EXTRA --agentskin-${pk}="${pv}" (no manifest.${mk})`);
    }
  }

  // Raw checks
  for (const rawKey of [
    'accent-raw',
    'text-raw',
    'muted-raw',
    'surface-raw',
    'surface-elevated-raw',
    'bg-raw',
    'border-raw',
  ]) {
    if (!pt[rawKey]) continue;
    const baseKey = rawKey.replace('-raw', '');
    const manField = mapping[baseKey];
    if (!manField || !mc[manField]) continue;
    const expected = toRgbTriple(mc[manField]);
    if (expected && pt[rawKey] !== expected) {
      issues.push(`  RAW --agentskin-${rawKey}: palette="${pt[rawKey]}" expected="${expected}"`);
    }
  }

  if (issues.length > 0) {
    console.log(`[${dir}]`);
    console.log(issues.join('\n'));
    console.log();
  }
}
console.log('=== DONE ===');
