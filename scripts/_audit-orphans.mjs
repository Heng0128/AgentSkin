// --- TEMP orphan scanner ---
import fs from 'node:fs';
import path from 'node:path';
const THEMES_DIR = 'themes';

function walk(dir, cb) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_')) walk(full, cb);
    else if (e.isFile()) cb(full, e.name);
  }
}

const dirs = fs.readdirSync(THEMES_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name);

console.log('=== ORPHANED CSS / RESOURCE FILES ===\n');

for (const dir of dirs) {
  const themeDir = path.join(THEMES_DIR, dir);
  const manifestPath = path.join(themeDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const targets = manifest.targets || {};
  const schemes = ['default', ...(manifest.colorSchemes || [])];

  // Build set of all referenced CSS paths (absolute)
  const referencedCss = new Set();
  for (const [agentId, cfg] of Object.entries(targets)) {
    if (!cfg?.css) continue;
    for (const sid of schemes) {
      const p = sid === 'default'
        ? path.join(themeDir, cfg.css)
        : path.join(themeDir, 'assets', 'css', sid, path.basename(cfg.css));
      referencedCss.add(path.resolve(p));
    }
  }

  // Build set of referenced assets from manifest
  const referencedAssets = new Set();
  for (const f of [manifest.icon, manifest.preview, manifest.hero]) {
    if (f) referencedAssets.add(path.resolve(path.join(themeDir, f)));
  }

  const issues = [];

  // Walk all CSS files
  const cssDir = path.join(themeDir, 'assets', 'css');
  walk(cssDir, (full) => {
    if (!full.endsWith('.css')) return;
    const resolved = path.resolve(full);
    // Skip palette files
    const base = path.basename(full);
    if (base.startsWith('palette')) return;
    if (!referencedCss.has(resolved)) {
      issues.push(`  ORPHAN CSS: ${path.relative(THEMES_DIR, full)}`);
    }
  });

  // Check for missing referenced CSS
  for (const agentId of Object.keys(targets)) {
    const cfg = targets[agentId];
    if (!cfg?.css) continue;
    for (const sid of schemes) {
      const p = sid === 'default'
        ? path.join(themeDir, cfg.css)
        : path.join(themeDir, 'assets', 'css', sid, path.basename(cfg.css));
      if (!fs.existsSync(p)) {
        issues.push(`  MISSING CSS: ${path.relative(THEMES_DIR, p)}`);
      }
    }
  }

  // Check for palette files referenced but missing
  for (const sid of schemes) {
    const paletteName = sid === 'default' ? 'palette.css' : `palette.${sid}.css`;
    const palettePath = path.join(themeDir, paletteName);
    if (!fs.existsSync(palettePath)) {
      // check if css dir references scheme
      const schemeCssDir = path.join(themeDir, 'assets', 'css', sid);
      if (fs.existsSync(schemeCssDir)) {
        issues.push(`  MISSING PALETTE: ${paletteName} (color-schemes/${sid}.json exists but no ${paletteName})`);
      }
    }
  }

  if (issues.length > 0) {
    console.log(`[${dir}]`);
    console.log(issues.join('\n'));
    console.log();
  }
}

console.log('=== MISSING CSS IN agenskin-theme PACKAGES ===\n');

// Check compiled .agentskin-theme packages
for (const dir of dirs) {
  const pkgDir = path.join(THEMES_DIR, dir, `${dir}.agentskin-theme`);
  if (!fs.existsSync(pkgDir)) continue;
  const pkgManifestPath = path.join(pkgDir, 'manifest.json');
  if (!fs.existsSync(pkgManifestPath)) continue;
  const pkgManifest = JSON.parse(fs.readFileSync(pkgManifestPath, 'utf8'));
  const targets = pkgManifest.targets || {};
  const issues = [];
  for (const [agentId, cfg] of Object.entries(targets)) {
    if (!cfg?.css) continue;
    const cssPath = path.join(pkgDir, cfg.css);
    if (!fs.existsSync(cssPath)) {
      issues.push(`  PKG MISSING: ${path.relative(THEMES_DIR, cssPath)}`);
    } else {
      // Read CSS and check for agentskin-* values
      const css = fs.readFileSync(cssPath, 'utf8');
      const requiredTokens = ['--agentskin-accent','--agentskin-bg','--agentskin-surface','--agentskin-text','--agentskin-border'];
      for (const t of requiredTokens) {
        if (!css.includes(t)) {
          issues.push(`  PKG TOKEN MISSING: ${path.relative(THEMES_DIR, cssPath)} lacks ${t}`);
        }
      }
    }
  }
  if (issues.length > 0) {
    console.log(`[${dir}.agentskin-theme]`);
    console.log(issues.join('\n'));
    console.log();
  }
}

console.log('=== DONE ===');
