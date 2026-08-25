// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createZip,
  exportTheme,
  generateManifestSignature,
  validateThemeZip,
  verifyManifestSignature,
} from './theme-import-export';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

function createManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    icon: 'icon.png',
    preview: 'preview.png',
    mode: 'dark' as const,
    colors: {
      primary: '#00ffff',
      background: '#050816',
      foreground: '#e0e8ff',
      surface: '#0a0a12',
      text: '#e0e8ff',
    },
    ...overrides,
  });
}

async function createThemeDir(
  themeDir: string,
  opts: {
    manifestOverrides?: Record<string, unknown>;
    includeCss?: boolean;
    includeReadme?: boolean;
    includeHero?: boolean;
  } = {},
) {
  await fs.mkdir(themeDir, { recursive: true });
  await fs.mkdir(path.join(themeDir, 'assets', 'css'), { recursive: true });
  await fs.writeFile(path.join(themeDir, 'manifest.json'), createManifest(opts.manifestOverrides));
  await fs.writeFile(path.join(themeDir, 'icon.png'), PNG_1X1);
  await fs.writeFile(path.join(themeDir, 'preview.png'), PNG_1X1);
  if (opts.includeHero) await fs.writeFile(path.join(themeDir, 'hero.png'), PNG_1X1);
  if (opts.includeCss) {
    await fs.writeFile(
      path.join(themeDir, 'assets', 'css', 'traework.css'),
      ':root { --agentskin-accent: #00ffff; }',
    );
  }
  if (opts.includeReadme) await fs.writeFile(path.join(themeDir, 'README.md'), '# Test Theme');
}

let tmpDir: string;
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-ie-'));
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('validateThemeZip', () => {
  it('accepts a valid ZIP with hero, CSS, and README', async () => {
    const dir = path.join(tmpDir, 'valid');
    await createThemeDir(dir, {
      includeCss: true,
      includeReadme: true,
      includeHero: true,
      manifestOverrides: { hero: 'hero.png' },
    });
    const zipPath = path.join(tmpDir, 'valid.zip');
    await exportTheme('test-theme', dir, zipPath);

    const result = await validateThemeZip(zipPath);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.manifest?.id).toBe('test-theme');
    expect(result.files.has('hero.png')).toBe(true);
    expect(result.files.has('README.md')).toBe(true);
    expect(result.files.has('assets/css/traework.css')).toBe(true);
  });

  it('rejects ZIP without manifest.json', async () => {
    const buf = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06, ...Array(18).fill(0)])]);
    const result = await validateThemeZip(buf);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Missing manifest.json'))).toBe(true);
  });

  it('rejects path traversal in entry names', async () => {
    const zip = createZip([
      { name: 'manifest.json', data: Buffer.from(createManifest()) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
      { name: '../../etc/passwd', data: Buffer.from('evil') },
    ]);
    const result = await validateThemeZip(zip);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.includes('Path traversal') || e.includes('relative path') || e.includes('Invalid ZIP'),
      ),
    ).toBe(true);
  });

  it('rejects malicious CSS and oversized images', async () => {
    const dir = path.join(tmpDir, 'malicious');
    await createThemeDir(dir);
    await fs.writeFile(
      path.join(dir, 'assets', 'css', 'traework.css'),
      'body { background: url("https://evil.com/steal"); }',
    );
    const zipPath = path.join(tmpDir, 'malicious.zip');
    await exportTheme('test-theme', dir, zipPath);
    const result = await validateThemeZip(zipPath);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('CSS') || e.includes('blocked'))).toBe(true);

    const dir2 = path.join(tmpDir, 'big');
    await createThemeDir(dir2);
    await fs.writeFile(path.join(dir2, 'preview.png'), Buffer.alloc(11 * 1024 * 1024));
    const zipPath2 = path.join(tmpDir, 'big.zip');
    await exportTheme('test-theme', dir2, zipPath2);
    const result2 = await validateThemeZip(zipPath2);
    expect(result2.ok).toBe(false);
    expect(result2.errors.some((e) => e.includes('exceeds 10MB'))).toBe(true);
  });

  it('rejects ZIP with missing referenced file', async () => {
    const dir = path.join(tmpDir, 'missing');
    await createThemeDir(dir, { includeHero: true });
    const manifest = JSON.parse(
      await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    manifest.icon = 'nonexistent.png';
    await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    const zipPath = path.join(tmpDir, 'missing.zip');
    await exportTheme('test-theme', dir, zipPath);
    const result = await validateThemeZip(zipPath);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Referenced file missing'))).toBe(true);
  });
});

describe('exportTheme -> validateThemeZip round-trip', () => {
  it('produces a valid ZIP that passes re-import with content preservation', async () => {
    const dir = path.join(tmpDir, 'roundtrip');
    await createThemeDir(dir, {
      includeCss: true,
      includeReadme: true,
      includeHero: true,
      manifestOverrides: { hero: 'hero.png', name: 'My Theme', version: '2.5.0' },
    });
    const zipPath = path.join(tmpDir, 'roundtrip.zip');
    const exportResult = await exportTheme('test-theme', dir, zipPath);

    expect(exportResult.fileCount).toBeGreaterThan(0);
    expect(exportResult.signature).toBeTruthy();

    const result = await validateThemeZip(zipPath);
    expect(result.ok).toBe(true);
    expect(result.manifest?.name).toBe('My Theme');
    expect(result.manifest?.version).toBe('2.5.0');
    expect(result.warnings.some((w) => w.includes('No .signature'))).toBe(false);
  });
});

describe('SHA-256 signature', () => {
  it('generates deterministic signatures and detects tampering', () => {
    const files = new Map([
      ['a.txt', Buffer.from('hello')],
      ['b.txt', Buffer.from('world')],
    ]);
    const sig1 = generateManifestSignature(files);
    expect(sig1).toBe(generateManifestSignature(files));
    expect(sig1).toHaveLength(64);
    expect(verifyManifestSignature(files, sig1)).toBe(true);

    files.set('a.txt', Buffer.from('tampered'));
    expect(verifyManifestSignature(files, sig1)).toBe(false);
  });

  it('excludes .signature from hash and verifies exported ZIP', async () => {
    const files = new Map([
      ['manifest.json', Buffer.from('data')],
      ['.signature', Buffer.from('old')],
    ]);
    const sig = generateManifestSignature(files);
    files.set('.signature', Buffer.from('new'));
    expect(verifyManifestSignature(files, sig)).toBe(true);

    const dir = path.join(tmpDir, 'sig');
    await createThemeDir(dir);
    const zipPath = path.join(tmpDir, 'sig.zip');
    const exportResult = await exportTheme('test-theme', dir, zipPath);
    const result = await validateThemeZip(zipPath);
    expect(result.ok).toBe(true);
    expect(result.files.get('.signature')?.toString('utf8').trim()).toBe(exportResult.signature);
  });
});
