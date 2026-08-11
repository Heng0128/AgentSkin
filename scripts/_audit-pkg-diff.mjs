// --- TEMP: compare source manifest colors vs .agentskin-theme manifest colors ---
import fs from 'node:fs';
import path from 'node:path';
const THEMES_DIR = 'themes';
const TARGETS = ['amber-dusk', 'cyber-rose', 'terminal-green'];

function extractTokens(css) {
  const re = /(color-scheme|--(?:agentskin-|vscode-)[a-z-]+)\s*:\s*([^;!]+)/gi;
  const out = {};
  let m;
  while ((m = re.exec(css)) !== null) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

function tokensEqualClass(css) {
  // Extract just the :root { ... } block agentskin tokens
  const block = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!block) return {};
  const re = /(--agentskin-[\w-]+)\s*:\s*([^;]+);/g;
  const out = {};
  let m;
  while ((m = re.exec(block[1])) !== null) out[m[1]] = m[2].trim();
  return out;
}

const dirs = TARGETS;

for (const dir of dirs) {
  console.log(`\n========== ${dir} ==========`);

  // Source manifest colors
  const sm = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, dir, 'manifest.json'), 'utf8'));
  // Compiled manifest colors
  const cm = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, dir, `${dir}.agentskin-theme/manifest.json`), 'utf8'));
  // Source palette.css tokens
  const srcPalette = fs.readFileSync(path.join(THEMES_DIR, dir, 'palette.css'), 'utf8');
  const srcPt = tokensEqualClass(srcPalette);
  // Compiled CSS tokens
  const compCss = fs.readFileSync(path.join(THEMES_DIR, dir, `${dir}.agentskin-theme/assets/css/traework.css`), 'utf8');
  const compPt = tokensEqualClass(compCss);

  console.log('\n--- manifest.colors comparison ---');
  const sc = sm.colors || {};
  const cc = cm.colors || {};
  const allKeys = new Set([...Object.keys(sc), ...Object.keys(cc)]).forEach((k) => {
    const sv = sc[k] ?? '<missing>';
    const cv = cc[k] ?? '<missing>';
    const match = String(sv) === String(cv);
    if (!match) console.log(`  MISMATCH ${k}: source="${sv}" pkg="${cv}"`);
  });

  console.log('\n--- CSS :root agentskin tokens comparison ---');
  const allTokenKeys = new Set([...Object.keys(srcPt), ...Object.keys(compPt)]);
  allTokenKeys.forEach((k) => {
    const sv = srcPt[k] ?? '<missing>';
    const cv = compPt[k] ?? '<missing>';
    if (sv !== cv) console.log(`  DIFF ${k}:\n    source="${sv}"\n    pkg   ="${cv}"`);
  });

  // Check compiled CSS for DEFAULT_TOKENS fallback leak
  const DEFAULT_SELECTION = 'rgba(157, 139, 255, 0.32)';
  const DEFAULT_ACCENT = '#9d8bff';
  const DEFAULT_BG = '#201a40';
  const DEFAULT_BLUE = 'rgba(157, 139, 255';

  if (compCss.includes(DEFAULT_SELECTION) && !srcPalette.includes(DEFAULT_SELECTION)) {
    console.log(`  \u26a0 DEFAULT LEAK: compiled CSS contains DEFAULT_TOKENS --agentskin-selection="${DEFAULT_SELECTION}" (not in source palette)`);
  }

  // Value mapping check: find lines where native tokens get mis-assigned
  const hostBlock = compCss.match(/html\.agentskin-host-traework[^{]*\{([\s\S]*?)\n\}/);
  if (hostBlock) {
    const lines = hostBlock[1].split('\n').filter(l => l.includes('!important'));
    const suspicious = lines.filter(l => {
      const t = l.trim();
      // sideBar-bg mapped to agentskin-bg instead of surface
      if (t.includes('sideBar-background') && t.includes('var(--agentskin-bg)')) return true;
      // dropdown mapped to bg
      if (t.includes('dropdown-background') && t.includes('var(--agentskin-bg)')) return true;
      // textLink mapped to text instead of accent
      if (t.includes('textLink-foreground') && t.includes('var(--agentskin-text)')) return true;
      // description mapped to text instead of muted
      if (t.includes('descriptionForeground') && t.includes('var(--agentskin-text)')) return true;
      return false;
    });
    if (suspicious.length > 0) {
      console.log('\n  \u26a0 valueForToken MISMAP in compiled CSS:');
      suspicious.forEach(s => console.log('   ', s.trim()));
    }
  }

  // Check that source has these tokens correctly
  const srcCss = fs.readFileSync(path.join(THEMES_DIR, dir, 'assets/css/traework.css'), 'utf8');
  const srcHostBlock = srcCss.match(/html\.agentskin-host-traework body\s*\{([\s\S]*?)\n\}/);
  if (srcHostBlock) {
    const srcLines = srcHostBlock[1].split('\n').filter(l => l.includes('!important'));
    const correctSideBar = srcLines.find(l => l.includes('sideBar-background'));
    const correctTextLink = srcLines.find(l => l.includes('textLink-foreground'));
    const correctDesc = srcLines.find(l => l.includes('descriptionForeground'));
    console.log('\n  Source (hand-authored) correct mappings:');
    if (correctSideBar) console.log('    sideBar-background:', correctSideBar.trim());
    if (correctTextLink) console.log('    textLink-foreground:', correctTextLink.trim());
    if (correctDesc) console.log('    descriptionForeground:', correctDesc.trim());
  }
}

console.log('\n=== DONE ===');
