// SPDX-License-Identifier: MPL-2.0

import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ALLOWED_EXTENSIONS,
  DEFAULT_MAX_FILE_COUNT,
  DEFAULT_MAX_PACKAGE_BYTES,
  type PackageEntry,
  type PackageProvider,
  ThemeSignatureVerifier,
} from './theme-signature-verifier';

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

function createMockProvider(entries: PackageEntry[]): PackageProvider {
  return {
    extractEntries: vi.fn().mockResolvedValue(entries),
  };
}

function createEntry(path: string, data = new Uint8Array([0x42])): PackageEntry {
  return { path, data, size: data.length };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThemeSignatureVerifier', () => {
  let verifier: ThemeSignatureVerifier;

  beforeEach(() => {
    verifier = new ThemeSignatureVerifier();
  });

  // ── Content whitelist ───────────────────────────────────────────────

  describe('content whitelist', () => {
    it('passes for a package with only allowed file types', async () => {
      const entries = [
        createEntry('manifest.json'),
        createEntry('palette.css'),
        createEntry('icon.png'),
        createEntry('preview.jpg'),
        createEntry('background.webp'),
        createEntry('logo.svg'),
        createEntry('README.md'),
        createEntry('LICENSE.txt'),
      ];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.contentSafe).toBe(true);
      expect(result.valid).toBe(true);
    });

    it('fails for a package containing .exe file', async () => {
      const entries = [createEntry('manifest.json'), createEntry('malware.exe')];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.contentSafe).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('extension');
    });

    it('fails for a package containing .js file', async () => {
      const entries = [createEntry('manifest.json'), createEntry('script.js')];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.contentSafe).toBe(false);
    });

    it('fails for a package containing .mjs file', async () => {
      const entries = [createEntry('manifest.json'), createEntry('module.mjs')];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.contentSafe).toBe(false);
    });
  });

  // ── Path traversal ──────────────────────────────────────────────────

  describe('path traversal detection', () => {
    it('rejects paths with .. sequence', async () => {
      const entries = [createEntry('../../../etc/passwd')];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.contentSafe).toBe(false);
      expect(result.errors[0]).toContain('Unsafe path');
    });

    it('rejects absolute paths', async () => {
      const entries = [createEntry('/etc/passwd')];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.contentSafe).toBe(false);
    });

    it('rejects paths with backslashes', async () => {
      const entries = [createEntry('..\\windows\\system32\\config')];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.contentSafe).toBe(false);
    });
  });

  // ── Package size limit ─────────────────────────────────────────────

  describe('package size limit', () => {
    it('fails when package exceeds maxPackageBytes', async () => {
      const oversizedBuffer = new Uint8Array(DEFAULT_MAX_PACKAGE_BYTES + 1);
      const provider = createMockProvider([createEntry('manifest.json')]);

      const result = await verifier.verifyPackage(oversizedBuffer, provider);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('exceeds maximum');
    });

    it('respects custom maxPackageBytes', async () => {
      const buffer = new Uint8Array(100);
      const provider = createMockProvider([createEntry('manifest.json')]);

      const result = await verifier.verifyPackage(buffer, provider, {
        maxPackageBytes: 50,
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('maximum');
    });
  });

  // ── File count limit ───────────────────────────────────────────────

  describe('file count limit', () => {
    it('fails when package exceeds maxFileCount', async () => {
      const entries = Array.from({ length: DEFAULT_MAX_FILE_COUNT + 1 }, (_, i) =>
        createEntry(`file${i}.txt`),
      );
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('maximum is');
    });

    it('respects custom maxFileCount', async () => {
      const entries = [createEntry('a.txt'), createEntry('b.txt'), createEntry('c.txt')];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider, {
        maxFileCount: 2,
      });

      expect(result.valid).toBe(false);
    });
  });

  // ── Custom extension whitelist ─────────────────────────────────────

  describe('custom extension whitelist', () => {
    it('allows custom extensions when configured', async () => {
      const entries = [createEntry('data.custom')];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider, {
        allowedExtensions: ['custom'],
      });

      expect(result.contentSafe).toBe(true);
    });
  });

  // ── Signature verification ─────────────────────────────────────────

  describe('signature verification', () => {
    it('returns valid when signature is optional and not present', async () => {
      const entries = [createEntry('manifest.json')];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.valid).toBe(true);
      expect(result.signatureValid).toBe(false);
    });

    it('fails when signature is required but not present', async () => {
      const entries = [createEntry('manifest.json')];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider, {
        requireSignature: true,
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('theme.sig missing');
    });

    it('fails when manifest is missing but signature file exists', async () => {
      const entries = [createEntry('theme.sig', new Uint8Array([0x01, 0x02]))];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('manifest.json not found');
    });

    it('fails for unknown keyId', async () => {
      const manifest = { signature: { keyId: 'unknown-key', algorithm: 'Ed25519', value: 'AAAA' } };
      const entries = [
        createEntry('theme.sig', new Uint8Array([0x01])),
        createEntry('manifest.json', new TextEncoder().encode(JSON.stringify(manifest))),
      ];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unknown keyId');
    });
  });

  // ── Trusted key registry ───────────────────────────────────────────

  describe('trusted key registry', () => {
    it('registers and lists trusted keys', () => {
      verifier.registerTrustedKey(
        'key-1',
        '-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----',
      );
      verifier.registerTrustedKey(
        'key-2',
        '-----BEGIN PUBLIC KEY-----\nBBBB\n-----END PUBLIC KEY-----',
      );

      const ids = verifier.getTrustedKeyIds();
      expect(ids).toContain('key-1');
      expect(ids).toContain('key-2');
      expect(ids).toHaveLength(2);
    });
  });

  // ── Provider error handling ────────────────────────────────────────

  describe('provider error handling', () => {
    it('captures provider extraction errors', async () => {
      const provider: PackageProvider = {
        extractEntries: vi.fn().mockRejectedValue(new Error('Corrupt ZIP')),
      };

      const result = await verifier.verifyPackage(new Uint8Array(100), provider);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Failed to extract');
    });
  });

  // ── Ed25519 roundtrip (real crypto) ────────────────────────────────

  describe('Ed25519 signature roundtrip', () => {
    it('verifies a valid Ed25519 signature', async () => {
      // Generate real Ed25519 key pair
      const keyPair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, [
        'sign',
        'verify',
      ])) as unknown as CryptoKeyPair;

      // Export public key as SPKI PEM
      const spki = await webcrypto.subtle.exportKey('spki', keyPair.publicKey);
      const pem = `-----BEGIN PUBLIC KEY-----${btoa(String.fromCharCode(...new Uint8Array(spki)))}-----END PUBLIC KEY-----`;

      // Register trusted key
      verifier.registerTrustedKey('test-key', pem);

      // Sign the package buffer
      const packageBuffer = new Uint8Array([0x42, 0x43, 0x44]);
      const hash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', packageBuffer.buffer));
      const sig = await webcrypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, hash.buffer);
      const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

      // Create manifest with signature metadata
      const manifest = {
        signature: { keyId: 'test-key', algorithm: 'Ed25519', value: sigBase64 },
      };
      const entries = [
        createEntry('theme.sig', new Uint8Array(sig)),
        createEntry('manifest.json', new TextEncoder().encode(JSON.stringify(manifest))),
      ];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(packageBuffer, provider);

      expect(result.valid).toBe(true);
      expect(result.signatureValid).toBe(true);
    });

    it('rejects an invalid Ed25519 signature', async () => {
      const keyPair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, [
        'sign',
        'verify',
      ])) as unknown as CryptoKeyPair;

      const spki = await webcrypto.subtle.exportKey('spki', keyPair.publicKey);
      const pem = `-----BEGIN PUBLIC KEY-----${btoa(String.fromCharCode(...new Uint8Array(spki)))}-----END PUBLIC KEY-----`;

      verifier.registerTrustedKey('test-key', pem);

      // Sign different data from what's in the package
      const differentData = new Uint8Array([0x00, 0x00]);
      const hash = new Uint8Array(await webcrypto.subtle.digest('SHA-256', differentData.buffer));
      const sig = await webcrypto.subtle.sign({ name: 'Ed25519' }, keyPair.privateKey, hash.buffer);
      const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

      const manifest = {
        signature: { keyId: 'test-key', algorithm: 'Ed25519', value: sigBase64 },
      };
      const packageBuffer = new Uint8Array([0x42, 0x43, 0x44]); // Different from signed data
      const entries = [
        createEntry('theme.sig', new Uint8Array(sig)),
        createEntry('manifest.json', new TextEncoder().encode(JSON.stringify(manifest))),
      ];
      const provider = createMockProvider(entries);

      const result = await verifier.verifyPackage(packageBuffer, provider);

      expect(result.valid).toBe(false);
      expect(result.signatureValid).toBe(false);
    });
  });

  // ── Constants ───────────────────────────────────────────────────────

  describe('default constants', () => {
    it('has 12 default allowed extensions', () => {
      expect(DEFAULT_ALLOWED_EXTENSIONS).toHaveLength(12);
      expect(DEFAULT_ALLOWED_EXTENSIONS).toContain('json');
      expect(DEFAULT_ALLOWED_EXTENSIONS).toContain('css');
      expect(DEFAULT_ALLOWED_EXTENSIONS).toContain('png');
    });

    it('has 50 MB default package size limit', () => {
      expect(DEFAULT_MAX_PACKAGE_BYTES).toBe(50 * 1024 * 1024);
    });

    it('has 200 default max file count', () => {
      expect(DEFAULT_MAX_FILE_COUNT).toBe(200);
    });
  });
});
