// SPDX-License-Identifier: MPL-2.0

import { execFileAsync } from '../../../../shared/exec-async';
import { withPsConcurrency } from './concurrency';

/**
 * Read PE version info from an exe. Mirrors the private `readExeInfo` in
 * install-detection.ts — duplicated here because the scanner needs standalone
 * access without modifying the existing detection module.
 *
 * Returns `null` on any failure (missing exe, blocked PowerShell, etc.).
 */
export async function readExeInfo(exePath: string): Promise<{
  version: string | null;
  productName: string;
  fileDescription: string;
  companyName: string;
} | null> {
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
