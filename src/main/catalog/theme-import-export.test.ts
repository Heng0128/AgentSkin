// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ThemeBundle } from '../services/theme-bundle';
import {
  createZip,
  exportBundleToZip,
  exportTheme,
  generateManifestSignature,
  isZipBuffer,
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
      accent: '#00ffff',
      secondary: '#7c83ff',
      background: '#050816',
      foreground: '#e0e8ff',
      muted: '#6c7086',
      surface: '#0a0a12',
      surfaceElevated: '#141828',
      border: '#1e2235',
      codeBackground: '#050816',
      codeForeground: '#e0e8ff',
      inputBackground: '#0a0a12',
      buttonBackground: '#141828',
      focusRing: '#00ffff',
      selection: '#00ffff52',
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

describe('14-token color contract validation', () => {
  it('rejects manifest missing required color tokens', async () => {
    const manifest = JSON.stringify({
      id: 'incomplete-theme',
      name: 'Incomplete',
      version: '1.0.0',
      icon: 'icon.png',
      preview: 'preview.png',
      colors: {
        background: '#000000',
        foreground: '#ffffff',
        // missing 12 of 14 tokens
      },
    });
    const zip = createZip([
      { name: 'manifest.json', data: Buffer.from(manifest) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
    ]);
    const result = await validateThemeZip(zip);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('14-token contract violation'))).toBe(true);
    expect(result.errors.some((e) => e.includes('missing'))).toBe(true);
  });

  it('rejects manifest with invalid color values', async () => {
    const manifest = JSON.stringify({
      id: 'bad-colors',
      name: 'Bad Colors',
      version: '1.0.0',
      icon: 'icon.png',
      preview: 'preview.png',
      colors: {
        accent: 'not-a-color',
        secondary: '#7c83ff',
        background: '#050816',
        foreground: '#e0e8ff',
        muted: '#6c7086',
        surface: '#0a0a12',
        surfaceElevated: '#141828',
        border: '#1e2235',
        codeBackground: '#050816',
        codeForeground: '#e0e8ff',
        inputBackground: '#0a0a12',
        buttonBackground: '#141828',
        buttonForeground: '#e0e8ff',
        focusRing: '#00ffff',
      },
    });
    const zip = createZip([
      { name: 'manifest.json', data: Buffer.from(manifest) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
    ]);
    const result = await validateThemeZip(zip);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid color values'))).toBe(true);
  });

  it('accepts manifest with all 14 tokens valid', async () => {
    const manifest = JSON.stringify({
      id: 'complete-theme',
      name: 'Complete',
      version: '1.0.0',
      icon: 'icon.png',
      preview: 'preview.png',
      colors: {
        accent: '#00ffff',
        secondary: '#7c83ff',
        background: '#050816',
        foreground: '#e0e8ff',
        muted: '#6c7086',
        surface: '#0a0a12',
        surfaceElevated: '#141828',
        border: '#1e2235',
        codeBackground: '#050816',
        codeForeground: '#e0e8ff',
        inputBackground: '#0a0a12',
        buttonBackground: '#141828',
        focusRing: '#00ffff',
        selection: '#00ffff52',
      },
    });
    const zip = createZip([
      { name: 'manifest.json', data: Buffer.from(manifest) },
      { name: 'icon.png', data: PNG_1X1 },
      { name: 'preview.png', data: PNG_1X1 },
    ]);
    const result = await validateThemeZip(zip);
    expect(result.ok).toBe(true);
    const tokenErrors = result.errors.filter((e) => e.includes('14-token'));
    expect(tokenErrors).toHaveLength(0);
  });
});

describe('isZipBuffer', () => {
  it('detects ZIP magic bytes', () => {
    expect(isZipBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isZipBuffer(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(true);
  });

  it('rejects non-ZIP buffers', () => {
    expect(isZipBuffer(Buffer.from('{"format":"agentskin-theme"}'))).toBe(false);
    expect(isZipBuffer(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(false);
    expect(isZipBuffer(Buffer.alloc(0))).toBe(false);
    expect(isZipBuffer(Buffer.from([0x50, 0x4b]))).toBe(false);
  });
});

describe('exportBundleToZip', () => {
  it('exports a ThemeBundle as a valid ZIP', async () => {
    const bundle: ThemeBundle = {
      format: 'agentskin-theme',
      schemaVersion: 1,
      theme: {
        id: 'bundle-theme',
        displayName: 'Bundle Theme',
        version: '1.2.0',
        copy: {
          colors: {
            background: '#1e1e2e',
            foreground: '#cdd6f4',
            accent: '#89b4fa',
          },
        },
      },
      targets: {
        traework: { css: ':root { --agentskin-accent: #89b4fa; }' },
        qoderwork: { css: ':root { --agentskin-bg: #1e1e2e; }' },
      },
      assets: {
        images: {
          icon: { filename: 'icon.png', mimeType: 'image/png', base64: PNG_1X1.toString('base64') },
          preview: {
            filename: 'preview.png',
            mimeType: 'image/png',
            base64: PNG_1X1.toString('base64'),
          },
        },
      },
    };

    const zipPath = path.join(tmpDir, 'bundle-export.zip');
    const result = await exportBundleToZip(bundle, zipPath);

    expect(result.outputPath).toBe(zipPath);
    expect(result.fileCount).toBeGreaterThan(0);
    expect(result.signature).toBeTruthy();

    // Verify the ZIP is valid and passes re-import validation.
    const validation = await validateThemeZip(zipPath);
    expect(validation.ok).toBe(true);
    expect(validation.manifest?.id).toBe('bundle-theme');
    expect(validation.manifest?.name).toBe('Bundle Theme');
    expect(validation.files.has('manifest.json')).toBe(true);
    expect(validation.files.has('assets/css/traework.css')).toBe(true);
    expect(validation.files.has('assets/css/qoderwork.css')).toBe(true);
    expect(validation.files.has('icon.png')).toBe(true);
    expect(validation.files.has('preview.png')).toBe(true);
  });

  it('produces a signature that passes verification', async () => {
    const bundle: ThemeBundle = {
      format: 'agentskin-theme',
      schemaVersion: 1,
      theme: {
        id: 'sig-test',
        displayName: 'Sig Test',
        version: '1.0.0',
      },
      targets: {
        traework: { css: ':root { color: red; }' },
      },
    };

    const zipPath = path.join(tmpDir, 'sig-test.zip');
    const _result = await exportBundleToZip(bundle, zipPath);
    const validation = await validateThemeZip(zipPath);
    expect(validation.ok).toBe(true);
    expect(validation.warnings.some((w) => w.includes('No .signature'))).toBe(false);
  });
});
