// SPDX-License-Identifier: MPL-2.0
/**
 * Resize and deploy generated theme assets to their theme directories.
 * Runs after AIGC generation to place images at correct sizes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const THEMES_DIR = path.join(ROOT, 'themes');

// Map: source artifact → destination theme directory + filename
const DEPLOYMENTS = [
  // Cyber Neon
  {
    src: path.join(
      ROOT,
      '.agnes',
      'artifacts',
      'images',
      'agnes-image-20260721-084247-019f83d78641727193be7e4873fc0691.png',
    ),
    dst: path.join(THEMES_DIR, 'cyber-neon', 'assets', 'background.png'),
    size: { width: 1920, height: 1080 },
  },
  {
    src: path.join(
      ROOT,
      '.agnes',
      'artifacts',
      'images',
      'agnes-image-20260721-084333-019f83d838987520a5f908b5a762d320.png',
    ),
    dst: path.join(THEMES_DIR, 'cyber-neon', 'preview.png'),
    size: { width: 1200, height: 630 },
  },
  // Arctic White
  {
    src: path.join(
      ROOT,
      '.agnes',
      'artifacts',
      'images',
      'agnes-image-20260721-084452-019f83d96e6177d0a1987d4a17ab131a.png',
    ),
    dst: path.join(THEMES_DIR, 'arctic-white', 'assets', 'background.png'),
    size: { width: 1920, height: 1080 },
  },
  {
    src: path.join(
      ROOT,
      '.agnes',
      'artifacts',
      'images',
      'agnes-image-20260721-084524-019f83d9ea217040b113d1ef9c6c07a9.png',
    ),
    dst: path.join(THEMES_DIR, 'arctic-white', 'preview.png'),
    size: { width: 1200, height: 630 },
  },
  // Sakura
  {
    src: path.join(
      ROOT,
      '.agnes',
      'artifacts',
      'images',
      'agnes-image-20260721-084555-019f83da64937b13a45cd01a0355f5c5.png',
    ),
    dst: path.join(THEMES_DIR, 'sakura', 'assets', 'background.png'),
    size: { width: 1920, height: 1080 },
  },
  {
    src: path.join(
      ROOT,
      '.agnes',
      'artifacts',
      'images',
      'agnes-image-20260721-084629-019f83dae7fc7a90bbb7593d4a4094af.png',
    ),
    dst: path.join(THEMES_DIR, 'sakura', 'preview.png'),
    size: { width: 1200, height: 630 },
  },
];

async function main() {
  // Try sharp first
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('[deploy-themes] sharp not available, skipping resize');
    process.exit(1);
  }

  for (const dep of DEPLOYMENTS) {
    if (!fs.existsSync(dep.src)) {
      console.warn(`[deploy-themes] Source not found: ${dep.src}`);
      continue;
    }

    console.log(
      `[deploy-themes] Resizing ${path.basename(dep.src)} → ${dep.size.width}x${dep.size.height}`,
    );

    const resized = await sharp(dep.src)
      .resize(dep.size.width, dep.size.height, { fit: 'cover', position: 'center' })
      .png({ quality: 90 })
      .toBuffer();

    // Ensure destination directory exists
    fs.mkdirSync(path.dirname(dep.dst), { recursive: true });
    fs.writeFileSync(dep.dst, resized);
    console.log(`[deploy-themes] Written ${dep.dst} (${(resized.length / 1024).toFixed(0)}KB)`);
  }

  console.log('[deploy-themes] Done.');
}

main().catch((err) => {
  console.error('[deploy-themes] Failed:', err.message);
  process.exit(1);
});
