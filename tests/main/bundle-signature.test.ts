// SPDX-License-Identifier: MIT

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BundleSignatureService,
  extractManifest,
  generateKeyPair,
  signBundle,
  verifyBundle,
} from '../../scripts/lib/bundle-signature.mjs';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary bundle directory with a manifest.json and optional
 * additional files.
 */
function createTmpBundle(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-sig-test-'));
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ name: 'test-bundle', version: '1.0.0' }, null, 2),
  );
  for (const [name, content] of Object.entries(files)) {
    const fullPath = join(dir, name);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

// ---------------------------------------------------------------------------
// generateKeyPair
// ---------------------------------------------------------------------------

describe('generateKeyPair', () => {
  it('returns an object with publicKey and privateKey PEM strings', () => {
    const pair = generateKeyPair();
    expect(pair).toHaveProperty('publicKey');
    expect(pair).toHaveProperty('privateKey');
    expect(pair.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    expect(pair.publicKey).toContain('-----END PUBLIC KEY-----');
    expect(pair.privateKey).toContain('-----BEGIN PRIVATE KEY-----');
    expect(pair.privateKey).toContain('-----END PRIVATE KEY-----');
  });

  it('produces a unique key pair on each call', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});

// ---------------------------------------------------------------------------
// signBundle
// ---------------------------------------------------------------------------

describe('signBundle', () => {
  let bundleDir: string;
  let keyPair: ReturnType<typeof generateKeyPair>;

  beforeEach(() => {
    bundleDir = createTmpBundle({ 'theme.css': 'body { color: red; }' });
    keyPair = generateKeyPair();
  });

  afterEach(() => {
    rmSync(bundleDir, { recursive: true, force: true });
  });

  it('returns a BundleSignature with the expected fields', async () => {
    const sig = await signBundle(bundleDir, keyPair.privateKey);
    expect(sig.algorithm).toBe('SHA256withRSA');
    expect(typeof sig.signature).toBe('string');
    expect(sig.signature.length).toBeGreaterThan(0);
    expect(typeof sig.bundleHash).toBe('string');
    expect(sig.bundleHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof sig.timestamp).toBe('number');
    expect(sig.timestamp).toBeGreaterThan(0);
  });

  it('throws when the bundle path does not exist', async () => {
    await expect(signBundle('/nonexistent/path/bundle', keyPair.privateKey)).rejects.toThrow(
      /does not exist/,
    );
  });

  it('throws when the path is not a directory', async () => {
    const filePath = join(bundleDir, 'manifest.json');
    await expect(signBundle(filePath, keyPair.privateKey)).rejects.toThrow(/not a directory/);
  });
});

// ---------------------------------------------------------------------------
// verifyBundle — happy path
// ---------------------------------------------------------------------------

describe('verifyBundle — valid bundles', () => {
  let bundleDir: string;
  let keyPair: ReturnType<typeof generateKeyPair>;
  let sig: Awaited<ReturnType<typeof signBundle>>;

  beforeEach(async () => {
    bundleDir = createTmpBundle({ 'theme.css': 'body { color: blue; }' });
    keyPair = generateKeyPair();
    sig = await signBundle(bundleDir, keyPair.privateKey);
  });

  afterEach(() => {
    rmSync(bundleDir, { recursive: true, force: true });
  });

  it('returns valid=true for an unmodified bundle', async () => {
    const result = await verifyBundle(bundleDir, sig, keyPair.publicKey);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns valid=true when using the service class', async () => {
    const service = new BundleSignatureService();
    service.generateKeyPair();
    const serviceSig = await service.signBundle(bundleDir);
    const result = await service.verifyBundle(bundleDir, serviceSig);
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyBundle — tamper detection
// ---------------------------------------------------------------------------

describe('verifyBundle — tamper detection', () => {
  let bundleDir: string;
  let keyPair: ReturnType<typeof generateKeyPair>;
  let sig: Awaited<ReturnType<typeof signBundle>>;

  beforeEach(async () => {
    bundleDir = createTmpBundle({ 'theme.css': 'body { color: green; }' });
    keyPair = generateKeyPair();
    sig = await signBundle(bundleDir, keyPair.privateKey);
  });

  afterEach(() => {
    rmSync(bundleDir, { recursive: true, force: true });
  });

  it('detects modification of an existing file', async () => {
    writeFileSync(join(bundleDir, 'theme.css'), 'body { color: Tampered; }');
    const result = await verifyBundle(bundleDir, sig, keyPair.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/hash mismatch/);
  });

  it('detects addition of a new file', async () => {
    writeFileSync(join(bundleDir, 'extra.css'), 'new file');
    const result = await verifyBundle(bundleDir, sig, keyPair.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/hash mismatch/);
  });

  it('detects removal of a file', async () => {
    rmSync(join(bundleDir, 'theme.css'));
    const result = await verifyBundle(bundleDir, sig, keyPair.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/hash mismatch/);
  });

  it('rejects a signature from a different key pair', async () => {
    const otherKeyPair = generateKeyPair();
    const result = await verifyBundle(bundleDir, sig, otherKeyPair.publicKey);
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyBundle — malformed input
// ---------------------------------------------------------------------------

describe('verifyBundle — malformed input', () => {
  let bundleDir: string;

  beforeEach(() => {
    bundleDir = createTmpBundle();
  });

  afterEach(() => {
    rmSync(bundleDir, { recursive: true, force: true });
  });

  it('returns invalid when signature data is empty', async () => {
    const result = await verifyBundle(bundleDir, {
      algorithm: 'SHA256withRSA',
      publicKey: '',
      signature: '',
      timestamp: Date.now(),
      bundleHash: 'abc123',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing signature/);
  });

  it('returns invalid when bundleHash is empty', async () => {
    const result = await verifyBundle(bundleDir, {
      algorithm: 'SHA256withRSA',
      publicKey: '',
      signature: 'abc',
      timestamp: Date.now(),
      bundleHash: '',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/missing bundle hash/);
  });

  it('returns invalid when no public key is available', async () => {
    const keyPair = generateKeyPair();
    const sig = await signBundle(bundleDir, keyPair.privateKey);
    // Signature has no public key embedded and none passed as argument
    const result = await verifyBundle(bundleDir, sig, '');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/no public key/);
  });

  it('throws when the bundle path does not exist', async () => {
    const keyPair = generateKeyPair();
    const sig = await signBundle(bundleDir, keyPair.privateKey);
    await expect(verifyBundle('/nonexistent/bundle', sig, keyPair.publicKey)).rejects.toThrow(
      /does not exist/,
    );
  });
});

// ---------------------------------------------------------------------------
// extractManifest
// ---------------------------------------------------------------------------

describe('extractManifest', () => {
  it('returns the parsed manifest.json content', async () => {
    const bundleDir = createTmpBundle();
    const manifest = await extractManifest(bundleDir);
    expect(manifest).toEqual({ name: 'test-bundle', version: '1.0.0' });
    rmSync(bundleDir, { recursive: true, force: true });
  });

  it('throws when manifest.json does not exist', async () => {
    const bundleDir = createTmpBundle({ 'only.css': 'body {}' });
    rmSync(join(bundleDir, 'manifest.json'));
    await expect(extractManifest(bundleDir)).rejects.toThrow(/manifest\.json not found/);
    rmSync(bundleDir, { recursive: true, force: true });
  });

  it('throws when manifest.json has invalid JSON', async () => {
    const bundleDir = mkdtempSync(join(tmpdir(), 'bundle-sig-test-'));
    writeFileSync(join(bundleDir, 'manifest.json'), '{ invalid json }');
    await expect(extractManifest(bundleDir)).rejects.toThrow(/invalid JSON/);
    rmSync(bundleDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// BundleSignatureService class
// ---------------------------------------------------------------------------

describe('BundleSignatureService', () => {
  let service: BundleSignatureService;
  let bundleDir: string;

  beforeEach(() => {
    service = new BundleSignatureService();
    bundleDir = createTmpBundle({ 'data.json': '{"key":"value"}' });
  });

  afterEach(() => {
    rmSync(bundleDir, { recursive: true, force: true });
  });

  it('generateKeyPair stores keys internally and they are retrievable', () => {
    expect(service.getPublicKey()).toBeNull();
    expect(service.getPrivateKey()).toBeNull();

    service.generateKeyPair();

    expect(service.getPublicKey()).toContain('-----BEGIN PUBLIC KEY-----');
    expect(service.getPrivateKey()).toContain('-----BEGIN PRIVATE KEY-----');
  });

  it('signBundle throws if no private key is available', async () => {
    await expect(service.signBundle(bundleDir)).rejects.toThrow(/no private key available/);
  });

  it('can be initialized with an existing key pair', async () => {
    const pair = generateKeyPair();
    const svc = new BundleSignatureService({
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    });
    const sig = await svc.signBundle(bundleDir);
    const result = await svc.verifyBundle(bundleDir, sig);
    expect(result.valid).toBe(true);
  });

  it('sign and verify round-trip with embedded public key', async () => {
    service.generateKeyPair();
    const sig = await service.signBundle(bundleDir);
    // The service populates sig.publicKey from its internal public key.
    expect(sig.publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    const result = await verifyBundle(bundleDir, sig);
    expect(result.valid).toBe(true);
  });
});
