// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Signature Verifier
 *
 * Verifies theme package integrity and authenticity.
 * Two verification modes:
 * 1. Content whitelist — ensure package contains only allowed file types
 * 2. Signature verification — validate signature against trusted public key
 *
 * ## Architecture
 *
 *   PackageBuffer → PackageProvider.extractEntries() → FileEntry[]
 *                                                        ↓
 *                                              Content Whitelist Check
 *                                                        ↓
 *                                              Signature Verification
 *                                                        ↓
 *                                        SignatureVerificationResult
 *
 * The `Provider` abstraction decouples verification logic from ZIP parsing,
 * enabling unit tests to inject mock file lists without real ZIP I/O.
 */

import { createHash, webcrypto } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single file entry extracted from a theme package.
 *
 * This is the abstraction boundary between the verifier and the
 * underlying package parser. Production code provides a real ZIP-backed
 * implementation; tests inject mock providers.
 */
export interface PackageEntry {
  /** Relative path inside the package (forward-slash normalized). */
  readonly path: string;
  /** Raw file content bytes. */
  readonly data: Uint8Array;
  /** Uncompressed size in bytes. */
  readonly size: number;
}

/**
 * Abstraction for extracting entries from a package buffer.
 *
 * Production implementations parse real ZIP files; tests inject mocks.
 */
export interface PackageProvider {
  /** Extract all file entries from the package buffer. */
  extractEntries(packageBuffer: Uint8Array): Promise<PackageEntry[]>;
}

/**
 * Result of verifying a theme package.
 */
export interface SignatureVerificationResult {
  /** Overall validity — true only when all enabled checks pass. */
  readonly valid: boolean;
  /** ZIP content whitelist check passed. */
  readonly contentSafe: boolean;
  /** Signature verification passed (false if no signature present). */
  readonly signatureValid: boolean;
  /** Failure reasons (empty when valid). */
  readonly errors: readonly string[];
  /** Non-blocking concerns. */
  readonly warnings: readonly string[];
}

/**
 * Options for package verification.
 */
export interface VerificationOptions {
  /** Require signature for this theme. Default: false (signature optional). */
  readonly requireSignature?: boolean;
  /** Allowed file extensions (lowercase, without dot). */
  readonly allowedExtensions?: readonly string[];
  /** Maximum package size in bytes. Default: 50 MB. */
  readonly maxPackageBytes?: number;
  /** Maximum number of files in the package. Default: 200. */
  readonly maxFileCount?: number;
}

/**
 * Supported signature algorithm identifiers.
 */
export type SignatureAlgorithm = 'Ed25519';

/**
 * Signature metadata embedded in a theme manifest.
 */
export interface ThemeSignature {
  /** Key identifier for the signing key. */
  readonly keyId: string;
  /** Signature algorithm. */
  readonly algorithm: SignatureAlgorithm;
  /** Base64-encoded signature value. */
  readonly value: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default allowed file extensions for theme packages. */
export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
  'json',
  'css',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'svg',
  'txt',
  'md',
  'license',
  'woff2',
];

/** Default maximum package size: 50 MB. */
export const DEFAULT_MAX_PACKAGE_BYTES = 50 * 1024 * 1024;

/** Default maximum file count. */
export const DEFAULT_MAX_FILE_COUNT = 200;

/** Name of the signature file inside the package. */
export const SIGNATURE_FILENAME = 'theme.sig';

/** Name of the manifest file inside the package. */
export const MANIFEST_FILENAME = 'manifest.json';

// ---------------------------------------------------------------------------
// ThemeSignatureVerifier
// ---------------------------------------------------------------------------

/**
 * Verifies theme package integrity and authenticity.
 *
 * Performs two levels of verification:
 * 1. **Content whitelist** — ensures the package contains only allowed
 *    file types and no path traversal attacks.
 * 2. **Signature verification** — if the package includes a `theme.sig`
 *    file, validates its Ed25519 signature against a registered public key.
 */
export class ThemeSignatureVerifier {
  /** Registry of trusted public keys (keyId → SPKI PEM). */
  private readonly trustedKeys = new Map<string, string>();

  /**
   * Register a trusted public key for signature verification.
   *
   * @param keyId        Unique key identifier.
   * @param publicKeyPem Public key in SPKI PEM format.
   */
  registerTrustedKey(keyId: string, publicKeyPem: string): void {
    this.trustedKeys.set(keyId, publicKeyPem);
  }

  /**
   * Get all registered trusted key IDs.
   *
   * @returns Array of key identifiers.
   */
  getTrustedKeyIds(): string[] {
    return Array.from(this.trustedKeys.keys());
  }

  /**
   * Verify a theme package.
   *
   * @param packageBuffer  Raw package bytes.
   * @param provider       Package provider for extracting entries.
   * @param options        Verification options.
   * @returns Verification result.
   */
  async verifyPackage(
    packageBuffer: Uint8Array,
    provider: PackageProvider,
    options: VerificationOptions = {},
  ): Promise<SignatureVerificationResult> {
    const allowedExtensions = options.allowedExtensions ?? DEFAULT_ALLOWED_EXTENSIONS;
    const maxBytes = options.maxPackageBytes ?? DEFAULT_MAX_PACKAGE_BYTES;
    const maxFiles = options.maxFileCount ?? DEFAULT_MAX_FILE_COUNT;
    const requireSignature = options.requireSignature ?? false;

    const errors: string[] = [];
    const warnings: string[] = [];

    // ── Package size check ──────────────────────────────────────────
    if (packageBuffer.length > maxBytes) {
      errors.push(`Package size ${packageBuffer.length} bytes exceeds maximum ${maxBytes} bytes`);
      return { valid: false, contentSafe: false, signatureValid: false, errors, warnings };
    }

    // ── Extract entries ─────────────────────────────────────────────
    let entries: PackageEntry[];
    try {
      entries = await provider.extractEntries(packageBuffer);
    } catch (e) {
      errors.push(
        `Failed to extract package entries: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { valid: false, contentSafe: false, signatureValid: false, errors, warnings };
    }

    // ── File count check ────────────────────────────────────────────
    if (entries.length > maxFiles) {
      errors.push(`Package contains ${entries.length} files, maximum is ${maxFiles}`);
      return { valid: false, contentSafe: false, signatureValid: false, errors, warnings };
    }

    // ── Content whitelist check ─────────────────────────────────────
    // Exclude the signature file (theme.sig) from whitelist enforcement —
    // it is not user content and its extension is intentionally not in
    // DEFAULT_ALLOWED_EXTENSIONS. Signature integrity is enforced separately
    // by the Ed25519 verification step below.
    const contentEntries = entries.filter((e) => e.path !== SIGNATURE_FILENAME);
    const contentResult = this.checkContentWhitelist(contentEntries, allowedExtensions);

    if (!contentResult.safe) {
      errors.push(...contentResult.errors);
      return { valid: false, contentSafe: false, signatureValid: false, errors, warnings };
    }
    warnings.push(...contentResult.warnings);

    // ── Signature verification ──────────────────────────────────────
    const sigEntry = entries.find((e) => e.path === SIGNATURE_FILENAME);
    const manifestEntry = entries.find((e) => e.path === MANIFEST_FILENAME);

    if (!sigEntry) {
      if (requireSignature) {
        errors.push('Signature required but not found (theme.sig missing)');
        return { valid: false, contentSafe: true, signatureValid: false, errors, warnings };
      }
      // Signature optional and not present.
      return { valid: true, contentSafe: true, signatureValid: false, errors, warnings };
    }

    // Parse manifest to get signature metadata
    if (!manifestEntry) {
      errors.push('Signature file present but manifest.json not found');
      return { valid: false, contentSafe: true, signatureValid: false, errors, warnings };
    }

    let signature: ThemeSignature;
    try {
      const manifestJson = new TextDecoder().decode(manifestEntry.data);
      const manifest = JSON.parse(manifestJson) as { signature?: ThemeSignature };
      if (!manifest.signature) {
        errors.push('Signature file present but manifest has no signature metadata');
        return { valid: false, contentSafe: true, signatureValid: false, errors, warnings };
      }
      signature = manifest.signature;
    } catch (e) {
      errors.push(`Failed to parse manifest: ${e instanceof Error ? e.message : String(e)}`);
      return { valid: false, contentSafe: true, signatureValid: false, errors, warnings };
    }

    // Verify signature
    const sigResult = await this.verifySignature(packageBuffer, sigEntry.data, signature);
    if (!sigResult.valid) {
      errors.push(sigResult.error);
      return { valid: false, contentSafe: true, signatureValid: false, errors, warnings };
    }

    return { valid: true, contentSafe: true, signatureValid: true, errors, warnings };
  }

  // ── Content whitelist ────────────────────────────────────────────────

  /**
   * Check that all files in the package pass the content whitelist.
   *
   * Validates:
   * 1. File extension is in the allowed list.
   * 2. Path is relative and contains no traversal sequences.
   */
  private checkContentWhitelist(
    entries: PackageEntry[],
    allowedExtensions: readonly string[],
  ): { safe: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const allowedSet = new Set(allowedExtensions.map((ext) => ext.toLowerCase()));

    for (const entry of entries) {
      // Path traversal check
      if (!this.isSafePath(entry.path)) {
        errors.push(`Unsafe path detected: '${entry.path}'`);
        continue;
      }

      // Extension check
      const ext = this.getExtension(entry.path);
      if (!ext || !allowedSet.has(ext.toLowerCase())) {
        errors.push(`File extension '.${ext}' not allowed: '${entry.path}'`);
      }
    }

    return { safe: errors.length === 0, errors, warnings };
  }

  /**
   * Check if a path is safe (relative, no traversal).
   *
   * Rejects:
   * - Absolute paths (starting with `/` or `C:\`)
   * - Paths containing `..` segments
   * - Paths containing `..\` or `../`
   */
  private isSafePath(path: string): boolean {
    // Reject absolute paths
    if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) {
      return false;
    }
    // Reject path traversal
    if (path.includes('..') || path.includes('\\') || path.includes('\0')) {
      return false;
    }
    // Must not be empty
    if (path.trim().length === 0) {
      return false;
    }
    return true;
  }

  /**
   * Get file extension (lowercase, without dot).
   */
  private getExtension(path: string): string {
    const lastDot = path.lastIndexOf('.');
    if (lastDot < 0 || lastDot === path.length - 1) return '';
    return path.slice(lastDot + 1).toLowerCase();
  }

  // ── Signature verification ───────────────────────────────────────────

  /**
   * Verify a theme signature.
   *
   * Uses Node.js built-in Web Crypto API for Ed25519 verification.
   * No third-party dependencies required.
   */
  private async verifySignature(
    packageBuffer: Uint8Array,
    _signatureData: Uint8Array,
    signature: ThemeSignature,
  ): Promise<{ valid: boolean; error: string }> {
    const publicKeyPem = this.trustedKeys.get(signature.keyId);
    if (!publicKeyPem) {
      return { valid: false, error: `Unknown keyId '${signature.keyId}'` };
    }

    try {
      // Parse PEM to get raw SPKI bytes
      const pemBody = publicKeyPem
        .replace('-----BEGIN PUBLIC KEY-----', '')
        .replace('-----END PUBLIC KEY-----', '')
        .replace(/\s+/g, '');
      const spkiBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

      // Import public key
      const cryptoKey = await webcrypto.subtle.importKey(
        'spki',
        spkiBytes.buffer,
        { name: 'Ed25519' },
        false,
        ['verify'],
      );

      // Decode signature value
      const sigBytes = Uint8Array.from(atob(signature.value), (c) => c.charCodeAt(0));

      // Compute SHA-256 hash of package buffer (signs the hash, not raw)
      const hash = createHash('sha256').update(packageBuffer).digest();
      const hashBuffer = new Uint8Array(hash.length);
      hashBuffer.set(hash);

      // Verify
      const valid = await webcrypto.subtle.verify(
        { name: 'Ed25519' },
        cryptoKey,
        sigBytes.buffer,
        hashBuffer.buffer,
      );

      return { valid, error: valid ? '' : 'Signature verification failed' };
    } catch (e) {
      return {
        valid: false,
        error: `Signature verification error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * Theme Signature Verifier singleton.
 */
export const themeSignatureVerifier = new ThemeSignatureVerifier();
