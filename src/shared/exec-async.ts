// SPDX-License-Identifier: MPL-2.0

import { execFile } from 'node:child_process';

/**
 * Promisified `execFile` with Windows-friendly defaults (hidden window,
 * bounded timeout). On error resolves to an empty string so callers can
 * treat missing-tool output uniformly without try/catch noise.
 *
 * Used by CDP port discovery (src/shared/cdp-discovery.ts) and install
 * detection (src/main/install-detection.ts).
 */
export function execFileAsync(
  command: string,
  args: string[],
  timeoutMs = 8000,
): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? '' : (stdout ?? '').toString());
    });
  });
}
