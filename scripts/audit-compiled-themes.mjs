import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const ROOT = 'C:/Users/snowb/Desktop/work/desktop-main';

// ============================================================
// 1. Deep structure check for 3 theme dirs + color-scheme subfolders
// ============================================================
const themeConfigs = [
  { name: 'amber-dusk', schemes: ['', 'ember', 'dune'] },
  { name: 'aurora-violet', schemes: ['', 'ember', 'ice'] },
  { name: 'ocean-tide', schemes: ['', 'coral', 'abyss'] },
];

const agents = ['codex', 'doubao', 'qoderwork', 'traework', 'workbuddy', 'zcode'];

console.log('=== 1. Deep Structure Check ===\n');
for (const cfg of themeConfigs) {
  console.log(`Theme: ${cfg.name}`);
  const baseDir = join(ROOT, 'themes', cfg.name, 'assets/css');
  for (const scheme of cfg.schemes) {
    const dir = scheme ? join(baseDir, scheme) : baseDir;
    let files = [];
    try { files = readdirSync(dir).filter(f => f.endsWith('.css')); } catch { files = []; }
    const expected = agents.filter(a => !['zcode'].includes(a) || true); // all 6
    const missing = expected.filter(a => !files.includes(`${a}.css`));
    const extra = files.filter(f => !expected.some(a => f === `${a}.css`));
    console.log(`  ${scheme || '(default)'}/ => ${files.length} files. Missing: [${missing.join(', ') || 'none'}]. Extra: [${extra.join(', ') || 'none'}]`);
  }
  console.log('');
}

// ============================================================
// 2. var(--agentskin-*, fallback) references
// ============================================================
console.log('\n=== 2. var(--agentskin-*, fallback) Scan ===\n');
const fallbackPattern = /var\(\s*--agentskin-[a-z0-9-]+,\s*([^)]+)\)/g;
const fallbackIssues = [];

function scanDir(dir, depth = 0) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory() && depth < 3) {
      scanDir(join(dir, entry.name), depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      const filePath = join(dir, entry.name);
      const content = readFileSync(filePath, 'utf-8');
      let match;
      const seen = new Set();
      while ((match = fallbackPattern.exec(content)) !== null) {
        const key = match[1].trim().substring(0, 60);
        if (!seen.has(key)) {
          seen.add(key);
          const lineNum = content.substring(0, match.index).split('\n').length;
          const relPath = relative(ROOT, filePath);
          fallbackIssues.push({ file: relPath, line: lineNum, fallback: match[0] });
        }
      }
    }
  }
}

for (const cfg of themeConfigs) {
  const baseDir = join(ROOT, 'themes', cfg.name, 'assets/css');
  scanDir(baseDir);
}

if (fallbackIssues.length === 0) {
  console.log('  No var(--agentskin-*, fallback) patterns found. PASS');
} else {
  console.log(`  FOUND ${fallbackIssues.length} fallback references:`);
  for (const issue of fallbackIssues.slice(0, 80)) {
    console.log(`    ${issue.file}:${issue.line} => ${issue.fallback}`);
  }
  if (fallbackIssues.length > 80) console.log(`    ... and ${fallbackIssues.length - 80} more`);
}

// ============================================================
// 3. color-scheme check
// ============================================================
console.log('\n=== 3. color-scheme Declarations ===\n');
const csPattern = /color-scheme:\s*([^\s;]+)/g;
const csIssues = [];

function scanColorScheme(dir, depth = 0) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.isDirectory() && depth < 3) {
      scanColorScheme(join(dir, entry.name), depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      const filePath = join(dir, entry.name);
      const content = readFileSync(filePath, 'utf-8');
      let match;
      while ((match = csPattern.exec(content)) !== null) {
        const value = match[1].trim();
        const lineNum = content.substring(0, match.index).split('\n').length;
        const relPath = relative(ROOT, filePath);
        csIssues.push({ file: relPath, line: lineNum, value });
      }
    }
  }
}

for (const cfg of themeConfigs) {
  const baseDir = join(ROOT, 'themes', cfg.name, 'assets/css');
  scanColorScheme(baseDir);
}

const validSchemes = ['dark', 'light', 'normal'];
const invalidCS = csIssues.filter(i => !validSchemes.includes(i.value));
const darkLightConflict = []; // look for themes that have both dark and light in same theme dir

if (invalidCS.length > 0) {
  console.log(`  INVALID color-scheme values (${invalidCS.length} found):`);
  for (const i of invalidCS) console.log(`    ${i.file}:${i.line} => color-scheme: ${i.value}`);
} else {
  console.log('  All color-scheme values are valid (dark/light/normal). PASS');
}

// Check for conflicting color-scheme within same theme
for (const cfg of themeConfigs) {
  const themeCS = csIssues.filter(i => i.file.startsWith(`themes/${cfg.name}/`));
  const values = new Set(themeCS.map(i => i.value));
  if (values.has('dark') && values.has('light')) {
    darkLightConflict.push(cfg.name);
    console.log(`  [WARNING] Theme "${cfg.name}" has BOTH color-scheme: dark AND light declarations across schemes`);
  }
}
if (darkLightConflict.length === 0) console.log('  No dark/light conflicts within themes. PASS');

// ============================================================
// 4. --agentskin-* variables in traework.css
// ============================================================
console.log('\n=== 4. --agentskin-* Variable Count in traework.css ===\n');
const agentVarPattern = /--agentskin-[a-z0-9-]+/g;
const requiredRequired = [
  '--agentskin-surface',
  '--agentskin-surface-alt',
  '--agentskin-primary',
  '--agentskin-primary-hover',
  '--agentskin-secondary',
  '--agentskin-accent',
  '--agentskin-text',
  '--agentskin-text-muted',
  '--agentskin-border',
  '--agentskin-danger',
  '--agentskin-success',
  '--agentskin-warning',
  '--agentskin-radius',
  '--agentskin-shadow',
];

const runtimeInjection = ['--agentskin-art', '--agentskin-text-shadow', '--agentskin-font', '--agentskin-brand'];

const varIssues = [];

for (const cfg of themeConfigs) {
  // Default traework
  const twPath = join(ROOT, 'themes', cfg.name, 'assets/css/traework.css');
  if (existsSync(twPath)) {
    const content = readFileSync(twPath, 'utf-8');
    const vars = new Set();
    let m;
    while ((m = agentVarPattern.exec(content)) !== null) vars.add(m[0]);
    const varsArr = Array.from(vars).sort();
    const missing = requiredRequired.filter(v => !varsArr.includes(v));
    const runtime = runtimeInjection.filter(v => varsArr.includes(v));
    console.log(`  ${cfg.name}/traework.css: ${vars} defined`);
    console.log(`    Total: ${varsArr.length}. Missing required: [${missing.join(', ') || 'none'}]. Runtime tokens: [${runtime.join(', ') || 'none'}]`);
    varIssues.push({ file: `themes/${cfg.name}/assets/css/traework.css`, total: varsArr.length, missing, runtime, all: varsArr });
  }

  // color-scheme traework files
  const schemes = cfg.name === 'amber-dusk' ? ['ember', 'dune'] :
                  cfg.name === 'aurora-violet' ? ['ember', 'ice'] :
                  ['coral', 'abyss'];
  for (const scheme of schemes) {
    const twSchemePath = join(ROOT, 'themes', cfg.name, 'assets/css', scheme, 'traework.css');
    if (existsSync(twSchemePath)) {
      const content = readFileSync(twSchemePath, 'utf-8');
      const vars = new Set();
      let m;
      while ((m = agentVarPattern.exec(content)) !== null) vars.add(m[0]);
      const varsArr = Array.from(vars).sort();
      const missing = requiredRequired.filter(v => !varsArr.includes(v));
      const runtime = runtimeInjection.filter(v => varsArr.includes(v));
      console.log(`  ${cfg.name}/${scheme}/traework.css: ${varsArr.length} vars. Missing required: [${missing.join(', ') || 'none'}]`);
      varIssues.push({ file: `themes/${cfg.name}/assets/css/${scheme}/traework.css`, total: varsArr.length, missing, runtime, all: varsArr });
    }
  }
}

// ============================================================
// 5. amber-dusk.agentskin-theme/ package check
// ============================================================
console.log('\n=== 5. amber-dusk.agentskin-theme/ Package Structure ===\n');
const pkgDir = join(ROOT, 'themes/amber-dusk/amber-dusk.agentskin-theme');
if (existsSync(pkgDir)) {
  function listRecursive(dir, indent = '') {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const relPath = relative(ROOT, path);
      if (entry.isDirectory()) {
        console.log(`${indent}[DIR]  ${entry.name}/`);
        listRecursive(path, indent + '  ');
      } else {
        const size = statSync(path).size;
        console.log(`${indent}${entry.name} (${size} bytes)`);
      }
    }
  }
  console.log(`  Path: ${pkgDir}`);
  listRecursive(pkgDir, '  ');

  // Check manifest
  const manifestPath = join(pkgDir, 'manifest.json');
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    console.log(`\n  manifest.json keys: ${Object.keys(manifest).join(', ')}`);
    console.log(`  id: ${manifest.id}, version: ${manifest.version}, name: ${manifest.name}`);
  }

  // Check traework.css in package
  const twPkg = join(pkgDir, 'assets/css/traework.css');
  if (existsSync(twPkg)) {
    const twContent = readFileSync(twPkg, 'utf-8');
    const agentVarsInPkg = new Set();
    let m2;
    while ((m2 = agentVarPattern.exec(twContent)) !== null) agentVarsInPkg.add(m2[0]);
    console.log(`\n  Package traework.css --agentskin-* vars: ${agentVarsInPkg.size}`);
    console.log(`  Vars: ${Array.from(agentVarsInPkg).sort().join(', ')}`);

    // Compare with source traework
    const srcTw = join(ROOT, 'themes/amber-dusk/assets/css/traework.css');
    if (existsSync(srcTw)) {
      const srcContent = readFileSync(srcTw, 'utf-8');
      const srcVars = new Set();
      let m3;
      while ((m3 = agentVarPattern.exec(srcContent)) !== null) srcVars.add(m3[0]);
      const missingInPkg = Array.from(srcVars).filter(v => !agentVarsInPkg.has(v));
      const extraInPkg = Array.from(agentVarsInPkg).filter(v => !srcVars.has(v));
      console.log(`\n  Package vs Source comparison:`);
      console.log(`    Source vars: ${srcVars.size}, Package vars: ${agentVarsInPkg.size}`);
      console.log(`    Missing in package: [${missingInPkg.join(', ') || 'none'}]`);
      console.log(`    Extra in package: [${extraInPkg.join(', ') || 'none'}]`);
    }
  }
} else {
  console.log('  Directory does not exist.');
}

// ============================================================
// Summary
// ============================================================
console.log('\n=== SUMMARY ===');
console.log(`  Fallback refs: ${fallbackIssues.length}`);
console.log(`  Invalid color-scheme: ${invalidCS.length}`);
console.log(`  Dark/Light conflicts: ${darkLightConflict.length}`);
console.log(`  traework.css files checked: ${varIssues.length}`);
