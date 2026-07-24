// Validate all real theme packages in themes/ using the actual ThemePackageLoader.
import path from 'node:path';
import fs from 'node:fs';
import { ThemePackageLoader } from '../src/main/catalog/theme-package-loader';

const themesDir = path.resolve(process.cwd(), 'themes');
const loader = new ThemePackageLoader(themesDir);

const packages = await loader.scan();
console.log(`\nValid packages: ${packages.length}`);
for (const p of packages) {
  const m = p.manifest;
  console.log(`  OK  ${m.id} (${m.name}) v${m.version} mode=${m.mode} agents=${(m.supportedAgents ?? []).join(',')}`);
}

// Also attempt to load each dir individually to surface per-theme errors
const dirs = fs.readdirSync(themesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
console.log(`\nTotal theme dirs: ${dirs.length}`);
const failed: string[] = [];
for (const d of dirs) {
  try {
    await loader.load(d);
  } catch (e) {
    failed.push(`${d}: ${(e as Error).message}`);
  }
}
if (failed.length) {
  console.log('FAILED validation:');
  for (const f of failed) console.log('  ' + f);
} else {
  console.log('All theme dirs pass validation.');
}
