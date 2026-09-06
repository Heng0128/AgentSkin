// SPDX-License-Identifier: MPL-2.0

import { execFileAsync } from '@shared/exec-async';
import { withPsConcurrency } from './concurrency';

/** PE version metadata extracted from an executable. */
export interface ExeInfo {
  version: string | null;
  productName: string;
  fileDescription: string;
  companyName: string;
}

/**
 * Read PE version info from an exe. Mirrors the private `readExeInfo` in
 * install-detection.ts — duplicated here because the scanner needs standalone
 * access without modifying the existing detection module.
 *
 * Returns `null` on any failure (missing exe, blocked PowerShell, etc.).
 */
export async function readExeInfo(exePath: string): Promise<ExeInfo | null> {
  const literal = exePath.replace(/'/g, "''");
  const script = [
    // PowerShell 5.1 writes stdout in the OEM code page (GBK on zh-CN systems)
    // while Node decodes the pipe as UTF-8 — force UTF-8 so Chinese product
    // names / descriptions survive the round-trip un-mangled.
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    `$v = (Get-Item -LiteralPath '${literal}').VersionInfo`,
    '"$($v.FileVersion)|$($v.ProductVersion)|$($v.ProductName)|$($v.FileDescription)|$($v.CompanyName)"',
  ].join('\n');
  const res = await withPsConcurrency(() =>
    execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 8000, {
      includeStderr: true,
    }),
  );
  const line = res.stdout.trim();
  if (!line) return null;
  const [fileVersion, productVersion, productName, fileDescription, companyName] = line.split('|');
  const version = (fileVersion || productVersion || '').trim() || null;
  return {
    version,
    productName: (productName || '').trim(),
    fileDescription: (fileDescription || '').trim(),
    companyName: (companyName || '').trim(),
  };
}

/** Number of exes probed per single PowerShell subprocess. */
const PE_BATCH_SIZE = 30;

/**
 * Read PE version info for many exes with one PowerShell process per chunk of
 * `PE_BATCH_SIZE` paths (instead of one process per exe, which was the L2
 * bottleneck when the registry lists many apps).
 *
 * Returns a Map keyed by the exact input path. A value of `null` means the read
 * failed for that path (missing exe, blocked PowerShell, etc.).
 */
export async function readExeInfosBatch(exePaths: string[]): Promise<Map<string, ExeInfo | null>> {
  const result = new Map<string, ExeInfo | null>();
  for (const exePath of exePaths) result.set(exePath, null);

  for (let i = 0; i < exePaths.length; i += PE_BATCH_SIZE) {
    const chunk = exePaths.slice(i, i + PE_BATCH_SIZE);
    // Windows paths cannot contain `|` or newlines, so `|` is a safe delimiter
    // and the first field is the exact path key. Single quotes are escaped by
    // doubling for the PowerShell single-quoted literal.
    const pathsLiteral = chunk.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      `$paths = @(${pathsLiteral})`,
      'foreach ($p in $paths) {',
      '  try {',
      '    $v = (Get-Item -LiteralPath $p).VersionInfo',
      '    "$p|$($v.FileVersion)|$($v.ProductVersion)|$($v.ProductName)|$($v.FileDescription)|$($v.CompanyName)"',
      '  } catch { "$p|" }',
      '}',
    ].join('\n');

    const res = await withPsConcurrency(() =>
      execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 20000, {
        includeStderr: true,
      }),
    );

    for (const rawLine of res.stdout.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const sep = line.indexOf('|');
      if (sep === -1) continue;
      const path = line.slice(0, sep);
      const rest = line.slice(sep + 1);
      const fields = rest.split('|');
      // A successful read emits 5 metadata fields; the per-path error line is
      // just `path|` (no metadata). Treat a short tail as a failed read.
      if (fields.length < 5) {
        result.set(path, null);
        continue;
      }
      const [fileVersion, productVersion, productName, fileDescription, companyName] = fields;
      const version = (fileVersion || productVersion || '').trim() || null;
      result.set(path, {
        version,
        productName: (productName || '').trim(),
        fileDescription: (fileDescription || '').trim(),
        companyName: (companyName || '').trim(),
      });
    }
  }

  return result;
}
