// SPDX-License-Identifier: MPL-2.0 OR MIT
//
// # bundle-signature.mjs — Bundle Signature Generation & Verification
//
// Provides tamper-detection for AgentSkin theme bundles using RSA-2048 +
// SHA-256. Flow:
//
//   generateKeyPair()            →  { publicKey, privateKey }
//        │
//        ▼
//   signBundle(bundlePath, priv)  →  BundleSignature  (stored alongside bundle)
//        │
//        ▼
//   verifyBundle(bundlePath, sig) →  SignatureResult  (tamper check)
//
// The bundle hash is a composite SHA-256 over every file in the bundle
// directory, sorted by relative path. This ensures any addition, removal,
// or modification of any file invalidates the signature.

import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Signature algorithm identifier stored in every BundleSignature. */
const ALGORITHM = 'SHA256withRSA';

/** RSA key size in bits. */
const RSA_MODULUS_LENGTH = 2048;

/** Hash algorithm used for bundle content digest. */
const HASH_ALGORITHM = 'sha256';

/** Name of the manifest file expected inside a bundle directory. */
const MANIFEST_FILENAME = 'manifest.json';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect all file paths under `dir`, sorted by relative path.
 * Directories are walked depth-first. The returned list is sorted
 * lexicographically by the relative path to ensure deterministic ordering.
 *
 * @param {string} dir - Absolute path to the directory to scan.
 * @param {string} [base] - Base path for relative path computation (internal).
 * @returns {string[]} Sorted array of absolute file paths.
 */
function collectFiles(dir, base) {
  const baseDir = base ?? dir;
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const st = statSync(fullPath);
    if (st.isDirectory()) {
      files.push(...collectFiles(fullPath, baseDir));
    } else {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => {
    const ra = relative(baseDir, a);
    const rb = relative(baseDir, b);
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
}

/**
 * Compute a composite SHA-256 hash over all files in a bundle directory.
 *
 * The hash covers each file's relative path and content, concatenated
 * with a newline separator. This ensures that any change to file content
 * or file structure produces a different composite hash.
 *
 * @param {string} bundlePath - Absolute path to the bundle directory.
 * @returns {string} Hex-encoded SHA-256 digest.
 */
function computeBundleHash(bundlePath) {
  const files = collectFiles(bundlePath);
  const hash = createHash(HASH_ALGORITHM);

  for (const filePath of files) {
    const relPath = relative(bundlePath, filePath).split(sep).join('/');
    const content = readFileSync(filePath);
    // Include both path and content so renames / swaps are detected.
    hash.update(relPath);
    hash.update('\n');
    hash.update(content);
    hash.update('\n');
  }

  return hash.digest('hex');
}

/**
 * Parse a PEM key string, normalizing line endings and whitespace.
 *
 * @param {string} pem - PEM-encoded key string.
 * @returns {string} Normalized PEM string.
 */
function normalizePem(pem) {
  if (typeof pem !== 'string') {
    throw new TypeError('PEM key must be a string');
  }
  const trimmed = pem.trim();
  if (!trimmed) {
    throw new Error('PEM key must not be empty');
  }
  return trimmed.replace(/\r\n/g, '\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate an RSA-2048 key pair for bundle signing.
 *
 * @returns {{ publicKey: string, privateKey: string }} PEM-encoded keys.
 */
export function generateKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: RSA_MODULUS_LENGTH,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return { publicKey, privateKey };
}

/**
 * Sign a bundle directory and return a BundleSignature object.
 *
 * The bundle hash is computed from all files in the directory, then
 * signed with the provided private key using RSA-SHA256.
 *
 * @param {string} bundlePath - Absolute path to the bundle directory.
 * @param {string} privateKey - PEM-encoded RSA private key.
 * @returns {Promise<BundleSignature>} The signature envelope.
 * @throws {Error} If the bundle path does not exist or is not a directory.
 * @throws {TypeError} If the private key is not a valid PEM string.
 */
export async function signBundle(bundlePath, privateKey) {
  if (!existsSync(bundlePath)) {
    throw new Error(`signBundle: bundle path "${bundlePath}" does not exist`);
  }
  if (!statSync(bundlePath).isDirectory()) {
    throw new Error(`signBundle: "${bundlePath}" is not a directory`);
  }

  const normalizedKey = normalizePem(privateKey);
  const bundleHash = computeBundleHash(bundlePath);
  const signature = sign(HASH_ALGORITHM, Buffer.from(bundleHash, 'utf8'), normalizedKey);

  return {
    algorithm: ALGORITHM,
    publicKey: '', // caller should populate from the key pair if needed
    signature: signature.toString('base64'),
    timestamp: Date.now(),
    bundleHash,
  };
}

/**
 * Verify a bundle against a previously-generated BundleSignature.
 *
 * Recomputes the bundle hash from the current directory contents and
 * verifies the RSA-SHA256 signature against the stored hash.
 *
 * @param {string} bundlePath - Absolute path to the bundle directory.
 * @param {BundleSignature} signature - The signature envelope to verify against.
 * @param {string} [publicKey] - PEM-encoded RSA public key. If omitted,
 *   the public key from the signature envelope is used (must be populated).
 * @returns {Promise<SignatureResult>} Verification result.
 * @throws {Error} If the bundle path does not exist or is not a directory.
 * @throws {TypeError} If the signature object is malformed.
 */
export async function verifyBundle(bundlePath, signature, publicKey) {
  if (!existsSync(bundlePath)) {
    throw new Error(`verifyBundle: bundle path "${bundlePath}" does not exist`);
  }
  if (!statSync(bundlePath).isDirectory()) {
    throw new Error(`verifyBundle: "${bundlePath}" is not a directory`);
  }
  if (!signature || typeof signature !== 'object') {
    throw new TypeError('verifyBundle: signature must be a non-null object');
  }
  if (!signature.signature) {
    return { valid: false, reason: 'missing signature data', timestamp: Date.now() };
  }
  if (!signature.bundleHash) {
    return { valid: false, reason: 'missing bundle hash', timestamp: Date.now() };
  }

  const resolvedKey = publicKey ?? signature.publicKey;
  if (!resolvedKey) {
    return {
      valid: false,
      reason: 'no public key available for verification',
      timestamp: Date.now(),
    };
  }

  const normalizedKey = normalizePem(resolvedKey);
  const currentHash = computeBundleHash(bundlePath);

  // First check: does the current content match the expected hash?
  if (currentHash !== signature.bundleHash) {
    return {
      valid: false,
      reason: 'bundle content hash mismatch — files have been modified',
      timestamp: Date.now(),
    };
  }

  // Second check: is the signature valid for the expected hash?
  try {
    const sigBuffer = Buffer.from(signature.signature, 'base64');
    const isValid = verify(
      HASH_ALGORITHM,
      Buffer.from(signature.bundleHash, 'utf8'),
      normalizedKey,
      sigBuffer,
    );

    if (!isValid) {
      return { valid: false, reason: 'signature verification failed', timestamp: Date.now() };
    }

    return { valid: true, timestamp: Date.now() };
  } catch (err) {
    return {
      valid: false,
      reason: `verification error: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: Date.now(),
    };
  }
}

/**
 * Extract the manifest.json from a bundle directory.
 *
 * @param {string} bundlePath - Absolute path to the bundle directory.
 * @returns {Promise<Record<string, unknown>>} Parsed manifest object.
 * @throws {Error} If the manifest file does not exist or contains invalid JSON.
 */
export async function extractManifest(bundlePath) {
  if (!existsSync(bundlePath)) {
    throw new Error(`extractManifest: bundle path "${bundlePath}" does not exist`);
  }
  if (!statSync(bundlePath).isDirectory()) {
    throw new Error(`extractManifest: "${bundlePath}" is not a directory`);
  }

  const manifestPath = join(bundlePath, MANIFEST_FILENAME);
  if (!existsSync(manifestPath)) {
    throw new Error(`extractManifest: manifest.json not found in "${bundlePath}"`);
  }

  const raw = readFileSync(manifestPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `extractManifest: invalid JSON in manifest.json — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// BundleSignatureService class
// ---------------------------------------------------------------------------

/**
 * High-level service for bundle signature operations.
 *
 * Wraps the standalone functions in an object-oriented API and
 * manages the public/private key pair internally.
 */
export class BundleSignatureService {
  /** @type {string|null} */
  #privateKey = null;

  /** @type {string|null} */
  #publicKey = null;

  /**
   * Create a new BundleSignatureService instance.
   *
   * @param {{ publicKey?: string, privateKey?: string }} [options]
   *   Optional initial key pair. If omitted, call `generateKeyPair()`.
   */
  constructor(options = {}) {
    if (options.privateKey) this.#privateKey = normalizePem(options.privateKey);
    if (options.publicKey) this.#publicKey = normalizePem(options.publicKey);
  }

  /**
   * Generate a new RSA-2048 key pair and store it in this instance.
   *
   * @returns {{ publicKey: string, privateKey: string }} PEM-encoded keys.
   */
  generateKeyPair() {
    const pair = generateKeyPairSync('rsa', {
      modulusLength: RSA_MODULUS_LENGTH,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    this.#publicKey = pair.publicKey;
    this.#privateKey = pair.privateKey;
    return { publicKey: pair.publicKey, privateKey: pair.privateKey };
  }

  /**
   * Sign a bundle directory.
   *
   * @param {string} bundlePath - Absolute path to the bundle directory.
   * @param {string} [privateKey] - Optional override private key. Uses the
   *   instance key if not provided.
   * @returns {Promise<BundleSignature>} The signature envelope.
   * @throws {Error} If no private key is available.
   */
  async signBundle(bundlePath, privateKey) {
    const key = privateKey ?? this.#privateKey;
    if (!key) {
      throw new Error(
        'signBundle: no private key available — provide one or call generateKeyPair()',
      );
    }

    const sig = await signBundle(bundlePath, key);
    // Populate the public key in the signature envelope.
    sig.publicKey = this.#publicKey ?? '';
    return sig;
  }

  /**
   * Verify a bundle against a signature.
   *
   * @param {string} bundlePath - Absolute path to the bundle directory.
   * @param {BundleSignature} signature - The signature envelope.
   * @param {string} [publicKey] - Optional override public key. Uses the
   *   instance key or the signature's embedded key if not provided.
   * @returns {Promise<SignatureResult>} Verification result.
   */
  async verifyBundle(bundlePath, signature, publicKey) {
    const key = publicKey ?? this.#publicKey;
    return verifyBundle(bundlePath, signature, key);
  }

  /**
   * Extract the manifest from a bundle directory.
   *
   * @param {string} bundlePath - Absolute path to the bundle directory.
   * @returns {Promise<Record<string, unknown>>} Parsed manifest.
   */
  async extractManifest(bundlePath) {
    return extractManifest(bundlePath);
  }

  /**
   * Get the current public key.
   * @returns {string|null} PEM-encoded public key, or null if not set.
   */
  getPublicKey() {
    return this.#publicKey;
  }

  /**
   * Get the current private key.
   * @returns {string|null} PEM-encoded private key, or null if not set.
   */
  getPrivateKey() {
    return this.#privateKey;
  }
}

// ---------------------------------------------------------------------------
// Type exports (JSDoc only — not runtime values)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} BundleSignature
 * @property {string} algorithm - Signature algorithm (e.g., "SHA256withRSA").
 * @property {string} publicKey - PEM-encoded public key for verification.
 * @property {string} signature - Base64-encoded RSA-SHA256 signature.
 * @property {number} timestamp - Unix epoch milliseconds when signed.
 * @property {string} bundleHash - Hex-encoded SHA-256 composite hash of bundle contents.
 */

/**
 * @typedef {Object} SignatureResult
 * @property {boolean} valid - Whether the signature is valid.
 * @property {string} [reason] - Reason for invalidity (when valid=false).
 * @property {number} timestamp - Unix epoch milliseconds when verified.
 */

export default BundleSignatureService;
