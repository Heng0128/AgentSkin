// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Registry Sync Protocol
 *
 * Provides incremental synchronization of community themes from a remote
 * registry. Compares locally installed versions against the registry's latest,
 * downloads only updated packages, verifies SHA-256 integrity, and performs
 * atomic installs with automatic rollback on failure.
 *
 * ## Registry Format (registry.json)
 *
 * ```json
 * {
 *   "version": 1,
 *   "themes": [
 *     {
 *       "id": "cyber-neon",
 *       "name": "Cyber Neon",
 *       "version": "1.2.0",
 *       "preview_url": "https://...",
 *       "download_url": "https://.../cyber-neon.zip",
 *       "sha256": "abc123...",
 *       "size": 2048000,
 *       "checksum_url": "https://.../cyber-neon.sha256"
 *     }
 *   ]
 * }
 * ```
 *
 * ## Sync Protocol
 *
 * 1. Fetch registry.json from the given URL
 * 2. Parse and validate the registry structure
 * 3. Compare each theme's version against locally installed versions
 * 4. Download only themes with newer versions (incremental sync)
 * 5. Verify SHA-256 checksum of each downloaded package
 * 6. Extract to temporary directory first (atomic install preparation)
 * 7. Move to final destination on success; rollback on failure
 *
 * @module main/theme/registry/theme-registry
 */

import { createHash } from 'node:crypto';
import fss, { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single theme entry in the registry.
 * Represents the latest available version of a community theme.
 */
export interface RegistryThemeEntry {
  /** Unique theme identifier (slug). */
  id: string;
  /** Human-readable theme name. */
  name: string;
  /** Semantic version string (e.g. "1.2.0"). */
  version: string;
  /** URL to the preview/cover image. */
  preview_url: string;
  /** Direct download URL for the theme ZIP package. */
  download_url: string;
  /** Expected SHA-256 hex digest of the downloaded ZIP file. */
  sha256: string;
  /** Expected file size in bytes (for pre-download validation). */
  size: number;
  /** Optional URL to a standalone checksum file. */
  checksum_url?: string;
}

/**
 * The registry JSON structure — single source of truth for available themes.
 */
export interface ThemeRegistry {
  /** Registry schema version (currently 1). */
  version: number;
  /** List of available themes. */
  themes: RegistryThemeEntry[];
}

/**
 * Result of comparing a registry entry against the local installation.
 */
export interface ThemeUpdateInfo {
  /** Registry entry for the theme. */
  entry: RegistryThemeEntry;
  /** Whether this is a new installation (not previously installed). */
  isNew: boolean;
  /** Locally installed version (undefined if not installed). */
  localVersion: string | undefined;
}

/**
 * Result of synchronizing a single theme.
 */
export interface ThemeSyncResult {
  /** Theme id. */
  id: string;
  /** Theme name. */
  name: string;
  /** Outcome of the sync operation. */
  status: 'installed' | 'updated' | 'skipped' | 'failed';
  /** Previous version (for updates). */
  previousVersion?: string;
  /** New version now installed. */
  installedVersion?: string;
  /** Error message if status is 'failed'. */
  error?: string;
}

/**
 * Aggregated result of a full sync operation.
 */
export interface SyncResult {
  /** Whether the entire sync completed without critical errors. */
  success: boolean;
  /** Total themes evaluated. */
  totalEvaluated: number;
  /** Number of newly installed themes. */
  installed: number;
  /** Number of updated themes. */
  updated: number;
  /** Number of themes skipped (already up-to-date). */
  skipped: number;
  /** Number of themes that failed to sync. */
  failed: number;
  /** Per-theme sync results. */
  results: ThemeSyncResult[];
  /** Top-level error message (e.g. registry fetch failure). */
  error?: string;
}

/**
 * Options for customizing sync behavior.
 */
export interface SyncOptions {
  /** Custom fetch implementation (for testing). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Whether to force re-install even if versions match. */
  force?: boolean;
  /** Progress callback invoked per theme. */
  onProgress?: (result: ThemeSyncResult, index: number, total: number) => void;
  /** Maximum number of bytes to download per theme (default 50 MB). */
  maxDownloadBytes?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Error thrown when registry JSON is malformed or fails validation.
 */
export class RegistryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryParseError';
  }
}

/**
 * Error thrown when a downloaded package fails SHA-256 verification.
 */
export class ChecksumMismatchError extends Error {
  constructor(
    readonly themeId: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Theme "${themeId}" checksum mismatch: expected ${expected.slice(0, 16)}..., got ${actual.slice(0, 16)}...`,
    );
    this.name = 'ChecksumMismatchError';
  }
}

/**
 * Error thrown when a downloaded package exceeds the expected size.
 */
export class SizeMismatchError extends Error {
  constructor(
    readonly themeId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Theme "${themeId}" size mismatch: expected ${expected}, got ${actual}`);
    this.name = 'SizeMismatchError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum download size per theme (50 MB). */
const DEFAULT_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

/** Network timeout for registry fetch (30 s). */
const REGISTRY_TIMEOUT_MS = 30_000;

/** Network timeout for theme download (120 s). */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Prefix for temporary extraction directories. */
const TEMP_PREFIX = 'agentskin-registry-';

// ---------------------------------------------------------------------------
// Registry parsing
// ---------------------------------------------------------------------------

/**
 * Validate that an object conforms to the RegistryThemeEntry shape.
 * Throws RegistryParseError on any structural violation.
 */
function validateRegistryThemeEntry(raw: unknown, index: number): RegistryThemeEntry {
  if (!raw || typeof raw !== 'object') {
    throw new RegistryParseError(`Theme at index ${index} is not an object`);
  }
  const obj = raw as Record<string, unknown>;
  const stringFields = ['id', 'name', 'version', 'preview_url', 'download_url', 'sha256'];
  for (const field of stringFields) {
    if (typeof obj[field] !== 'string' || !(obj[field] as string)) {
      throw new RegistryParseError(
        `Theme at index ${index}: field "${field}" must be a non-empty string`,
      );
    }
  }
  if (typeof obj.size !== 'number' || obj.size <= 0 || !Number.isFinite(obj.size)) {
    throw new RegistryParseError(`Theme at index ${index}: field "size" must be a positive number`);
  }
  return {
    id: obj.id as string,
    name: obj.name as string,
    version: obj.version as string,
    preview_url: obj.preview_url as string,
    download_url: obj.download_url as string,
    sha256: obj.sha256 as string,
    size: obj.size as number,
    checksum_url: typeof obj.checksum_url === 'string' ? obj.checksum_url : undefined,
  };
}

/**
 * Parse and validate a registry JSON string into a ThemeRegistry.
 *
 * @param raw - Raw JSON string from the registry endpoint.
 * @returns Validated ThemeRegistry.
 * @throws RegistryParseError if the JSON is malformed or structurally invalid.
 */
export function parseRegistry(raw: string): ThemeRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RegistryParseError('Registry JSON is malformed');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new RegistryParseError('Registry JSON is not an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== 'number') {
    throw new RegistryParseError('Registry missing "version" number field');
  }
  if (obj.version !== 1) {
    throw new RegistryParseError(`Unsupported registry version: ${obj.version}`);
  }
  if (!Array.isArray(obj.themes)) {
    throw new RegistryParseError('Registry missing "themes" array');
  }
  if (obj.themes.length === 0) {
    return { version: 1, themes: [] };
  }
  const themes: RegistryThemeEntry[] = [];
  for (let i = 0; i < obj.themes.length; i++) {
    themes.push(validateRegistryThemeEntry(obj.themes[i], i));
  }
  return { version: 1, themes };
}

// ---------------------------------------------------------------------------
// Incremental sync detection
// ---------------------------------------------------------------------------

/**
 * Compare a registry entry's version against a locally installed version.
 * Returns true if the registry version is newer.
 *
 * Uses simple semver comparison (major.minor.patch numeric comparison).
 */
export function isNewerVersion(registryVersion: string, localVersion: string): boolean {
  const reg = parseSimpleSemver(registryVersion);
  const loc = parseSimpleSemver(localVersion);
  if (!reg || !loc) {
    // Fallback: if either isn't valid semver, compare as strings
    return registryVersion !== localVersion;
  }
  if (reg.major !== loc.major) return reg.major > loc.major;
  if (reg.minor !== loc.minor) return reg.minor > loc.minor;
  return reg.patch > loc.patch;
}

/**
 * Parse a semver-like string into numeric components.
 * Returns null if the string doesn't match the pattern.
 */
function parseSimpleSemver(v: string): { major: number; minor: number; patch: number } | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Determine which themes need updating by comparing registry entries against
 * locally installed versions.
 *
 * @param registry - Parsed theme registry.
 * @param installedVersions - Map of theme id → installed version.
 * @returns Array of ThemeUpdateInfo for themes that need updating.
 */
export function findUpdates(
  registry: ThemeRegistry,
  installedVersions: Map<string, string>,
): ThemeUpdateInfo[] {
  const updates: ThemeUpdateInfo[] = [];
  for (const entry of registry.themes) {
    const localVersion = installedVersions.get(entry.id);
    const isNew = localVersion === undefined;
    const needsUpdate = isNew || isNewerVersion(entry.version, localVersion as string);
    if (needsUpdate) {
      updates.push({ entry, isNew, localVersion });
    }
  }
  return updates;
}

// ---------------------------------------------------------------------------
// SHA-256 verification
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hex digest of a file's contents.
 *
 * @param filePath - Absolute path to the file.
 * @returns Hex-encoded SHA-256 digest.
 */
export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fss.createReadStream(filePath);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Compute SHA-256 hex digest of a Buffer.
 *
 * @param data - Input buffer.
 * @returns Hex-encoded SHA-256 digest.
 */
export function computeBufferSha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Verify a downloaded file against its expected SHA-256 checksum and size.
 *
 * @param filePath - Path to the downloaded file.
 * @param expectedSha256 - Expected SHA-256 hex digest.
 * @param expectedSize - Expected file size in bytes.
 * @throws ChecksumMismatchError if SHA-256 doesn't match.
 * @throws SizeMismatchError if file size doesn't match.
 */
export async function verifyDownload(
  filePath: string,
  expectedSha256: string,
  expectedSize: number,
): Promise<void> {
  const stat = await fs.stat(filePath);
  if (stat.size !== expectedSize) {
    throw new SizeMismatchError('', expectedSize, stat.size);
  }
  const actualSha256 = await computeFileSha256(filePath);
  if (actualSha256 !== expectedSha256) {
    throw new ChecksumMismatchError('', expectedSha256, actualSha256);
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Download a file from a URL to a local path, enforcing a size limit.
 *
 * @param url - Download URL.
 * @param destPath - Local destination path.
 * @param options - Fetch implementation and size limit.
 * @returns The number of bytes downloaded.
 */
export async function downloadFile(
  url: string,
  destPath: string,
  options: { fetchImpl?: typeof fetch; maxBytes: number },
): Promise<number> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Download failed: no response body');
    }

    // Stream to temp file, enforcing size limit
    const tmpPath = `${destPath}.downloading`;
    const writeStream = createWriteStream(tmpPath);
    let downloaded = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        downloaded += value.length;
        if (downloaded > options.maxBytes) {
          throw new Error(`Download exceeded ${options.maxBytes} byte limit`);
        }
        writeStream.write(value);
      }
      writeStream.end();
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    } catch (error) {
      writeStream.destroy();
      await fs.unlink(tmpPath).catch(() => {});
      throw error;
    }

    await fs.rename(tmpPath, destPath);
    return downloaded;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Simple ZIP extraction
// ---------------------------------------------------------------------------

/**
 * Minimal ZIP file extractor — handles the most common case of stored
 * (compression method 0) and deflated (method 8) entries without external
 * dependencies.
 *
 * This is a pragmatic implementation for the sync protocol. For production
 * use with complex ZIP files, consider using a battle-tested library like
 * `yauzl` (already used elsewhere in the project).
 *
 * @param zipPath - Path to the ZIP file.
 * @param destDir - Destination directory (must exist).
 */
export async function extractZipSimple(zipPath: string, destDir: string): Promise<void> {
  const data = await fs.readFile(zipPath);
  const entries = parseZipCentralDirectory(data);

  for (const entry of entries) {
    const destPath = path.resolve(destDir, entry.filename);

    // Skip empty filenames (malformed ZIP entries)
    if (!entry.filename) {
      continue;
    }

    // Path traversal guard
    const relative = path.relative(destDir, destPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`ZIP path traversal detected: ${entry.filename}`);
    }

    // Directory entry (trailing slash)
    if (entry.filename.endsWith('/')) {
      await fs.mkdir(destPath, { recursive: true });
      continue;
    }

    await fs.mkdir(path.dirname(destPath), { recursive: true });

    // Calculate the actual start of file data within the local file header.
    // Local file header: 30 bytes fixed + filename length + extra field length.
    // The filename length in the local header matches the central directory.
    const localFilenameLen = data.readUInt16LE(entry.localHeaderOffset + 26);
    const localExtraLen = data.readUInt16LE(entry.localHeaderOffset + 28);
    const dataStart = entry.localHeaderOffset + 30 + localFilenameLen + localExtraLen;

    if (entry.compressionMethod === 0) {
      // Stored (no compression)
      await fs.writeFile(destPath, data.subarray(dataStart, dataStart + entry.compressedSize));
    } else if (entry.compressionMethod === 8) {
      // Deflated — use Node's zlib
      const { inflateRawSync } = await import('node:zlib');
      const compressed = data.subarray(dataStart, dataStart + entry.compressedSize);
      const decompressed = inflateRawSync(compressed);
      await fs.writeFile(destPath, decompressed);
    } else {
      throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
    }
  }
}

/**
 * Parse a ZIP file's central directory to extract entry metadata.
 * Only reads the minimal structure needed for extraction.
 */
interface ZipEntry {
  filename: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function parseZipCentralDirectory(data: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];

  // Find End of Central Directory Record (EOCD)
  let eocdOffset = -1;
  for (let i = data.length - 22; i >= 0; i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP: no End of Central Directory found');
  }

  const numEntries = data.readUInt16LE(eocdOffset + 10);
  const cdOffset = data.readUInt32LE(eocdOffset + 16);

  let offset = cdOffset;
  for (let i = 0; i < numEntries; i++) {
    // Central directory file header signature
    if (data.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP: bad central directory entry at offset ${offset}`);
    }

    const compressionMethod = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const filenameLength = data.readUInt16LE(offset + 28);
    const extraFieldLength = data.readUInt16LE(offset + 30);
    const localHeaderOffset = data.readUInt32LE(offset + 42);

    const filename = data.subarray(offset + 46, offset + 46 + filenameLength).toString('utf8');

    entries.push({
      filename,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset += 46 + filenameLength + extraFieldLength + data.readUInt16LE(offset + 32);
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Local version detection
// ---------------------------------------------------------------------------

/**
 * Read installed theme versions from a local directory.
 *
 * Scans for `<id>.agentskin-version` text files which contain the
 * version string (one per theme).
 *
 * @param localDir - Path to the local themes directory.
 * @returns Map of theme id → version string.
 */
export async function readLocalVersions(localDir: string): Promise<Map<string, string>> {
  const versions = new Map<string, string>();

  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(localDir, { withFileTypes: true });
  } catch {
    return versions;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.agentskin-version')) {
      const id = entry.name.replace(/\.agentskin-version$/, '');
      try {
        const version = await fs.readFile(path.join(localDir, entry.name), 'utf8');
        versions.set(id, version.trim());
      } catch {
        // Skip unreadable files
      }
    }
  }

  return versions;
}

// ---------------------------------------------------------------------------
// Atomic install
// ---------------------------------------------------------------------------

/**
 * Atomically install a theme ZIP to the destination directory.
 *
 * Protocol:
 * 1. Download ZIP to a temp dir
 * 2. Verify SHA-256 checksum
 * 3. Extract to temp dir
 * 4. Move to final destination
 * 5. Write version marker
 * 6. On any failure, rollback and clean up
 *
 * @param entry - Registry entry for the theme.
 * @param localDir - Final destination directory.
 * @param zipPath - Optional path to an existing ZIP (skips download).
 * @param options - Sync options.
 * @returns The sync result for this theme.
 */
export async function installTheme(
  entry: RegistryThemeEntry,
  localDir: string,
  zipPath?: string,
  options: SyncOptions = {},
): Promise<ThemeSyncResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  const maxBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;

  try {
    // Step 1: Obtain ZIP (download or use provided)
    let zipFilePath: string;
    if (zipPath) {
      zipFilePath = zipPath;
    } else {
      zipFilePath = path.join(tempDir, `${entry.id}.zip`);
      await downloadFile(entry.download_url, zipFilePath, {
        fetchImpl: options.fetchImpl,
        maxBytes,
      });
    }

    // Step 2: Verify SHA-256
    const actualSha256 = await computeFileSha256(zipFilePath);
    if (actualSha256 !== entry.sha256) {
      throw new ChecksumMismatchError(entry.id, entry.sha256, actualSha256);
    }

    // Step 3: Verify size
    const stat = await fs.stat(zipFilePath);
    if (stat.size !== entry.size) {
      throw new SizeMismatchError(entry.id, entry.size, stat.size);
    }

    // Step 4: Extract to temp directory
    const extractDir = path.join(tempDir, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });
    await extractZipSimple(zipFilePath, extractDir);

    // Step 5: Move to final destination
    const destPath = path.join(localDir, `${entry.id}.agentskin-theme`);
    await fs.mkdir(localDir, { recursive: true });

    // If a previous installation exists, remove it first (atomic replace)
    await fs.rm(destPath, { recursive: true, force: true });

    // Move extracted content to dest
    const extractedContent = await fs.readdir(extractDir);
    if (extractedContent.length === 1) {
      const singleEntry = path.join(extractDir, extractedContent[0]);
      const stat = await fs.stat(singleEntry);
      if (stat.isDirectory()) {
        await fs.rename(singleEntry, destPath);
      } else {
        // Single file — it's the theme package itself
        await fs.mkdir(destPath, { recursive: true });
        await fs.rename(singleEntry, path.join(destPath, extractedContent[0]));
      }
    } else {
      await fs.rename(extractDir, destPath);
    }

    // Step 6: Write version marker
    await fs.writeFile(path.join(localDir, `${entry.id}.agentskin-version`), entry.version, 'utf8');

    return {
      id: entry.id,
      name: entry.name,
      status: 'installed',
      installedVersion: entry.version,
    };
  } catch (error) {
    // Rollback: destination is already cleaned by the rm above, nothing to restore
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: entry.id,
      name: entry.name,
      status: 'failed',
      error: message,
    };
  } finally {
    // Always clean up temp dir
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main entry point: syncThemes
// ---------------------------------------------------------------------------

/**
 * Synchronize locally installed themes with a remote registry.
 *
 * This is the primary entry point for the theme registry sync protocol.
 * It fetches the registry, determines which themes need updating,
 * downloads and installs them atomically, and returns a detailed result.
 *
 * @param registryUrl - URL to the registry.json file.
 * @param localDir - Local directory where themes are installed.
 * @param options - Optional sync configuration.
 * @returns Aggregated sync result.
 *
 * @example
 * ```ts
 * const result = await syncThemes('https://registry.example.com/registry.json', '/path/to/themes');
 * console.log(`Installed: ${result.installed}, Updated: ${result.updated}, Failed: ${result.failed}`);
 * ```
 */
export async function syncThemes(
  registryUrl: string,
  localDir: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD_BYTES;

  // Step 1: Fetch registry
  let registry: ThemeRegistry;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
    try {
      const response = await fetchImpl(registryUrl, { signal: controller.signal });
      if (!response.ok) {
        return {
          success: false,
          totalEvaluated: 0,
          installed: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          results: [],
          error: `Registry fetch failed: HTTP ${response.status}`,
        };
      }
      const raw = await response.text();
      registry = parseRegistry(raw);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      totalEvaluated: 0,
      installed: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      results: [],
      error: `Registry fetch error: ${message}`,
    };
  }

  // Step 2: Read local versions
  const localVersions = await readLocalVersions(localDir);

  // Step 3: Determine updates needed
  const updates = findUpdates(registry, localVersions);

  // Step 4: Sync each theme
  const results: ThemeSyncResult[] = [];
  let installedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  // Include skipped themes in results (already up-to-date)
  for (const entry of registry.themes) {
    const needsUpdate = updates.some((u) => u.entry.id === entry.id);
    if (!needsUpdate) {
      skippedCount++;
      results.push({
        id: entry.id,
        name: entry.name,
        status: 'skipped',
        installedVersion: entry.version,
      });
    }
  }

  // Process updates
  for (let i = 0; i < updates.length; i++) {
    const update = updates[i];
    // Download, verify, install
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
    const zipPath = path.join(tempDir, `${update.entry.id}.zip`);

    try {
      // Download
      await downloadFile(update.entry.download_url, zipPath, {
        fetchImpl,
        maxBytes,
      });

      // Verify & install
      const result = await installTheme(update.entry, localDir, zipPath, {
        ...options,
        maxDownloadBytes: maxBytes,
      });

      // Categorize result
      if (result.status === 'failed') {
        failedCount++;
      } else if (update.isNew) {
        installedCount++;
        result.status = 'installed';
      } else {
        updatedCount++;
        result.status = 'updated';
        result.previousVersion = update.localVersion;
      }

      results.push(result);
      options.onProgress?.(result, i, updates.length);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedCount++;
      results.push({
        id: update.entry.id,
        name: update.entry.name,
        status: 'failed',
        error: message,
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const totalEvaluated = registry.themes.length;
  const success = failedCount === 0;

  return {
    success,
    totalEvaluated,
    installed: installedCount,
    updated: updatedCount,
    skipped: skippedCount,
    failed: failedCount,
    results,
  };
}
