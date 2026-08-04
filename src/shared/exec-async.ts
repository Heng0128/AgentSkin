// SPDX-License-Identifier: MPL-2.0

import { execFile } from 'node:child_process';

/**
 * Promisified `execFile` with Windows-friendly defaults (hidden window,
 * bounded timeout). On error resolves to an empty string so callers can
 * treat missing-tool output uniformly without try/catch noise.
 *
 * Used by CDP port discovery (src/shared/cdp-discovery.ts) and install
 * detection (src/main/install-detection.ts).
 *
 * P3-8 / N13: Previously the callback silently swallowed `stderr`. Missing
 * binaries (`lsof` on some Windows distros) or permission-denied errors
 * would collapse to an empty stdout with no breadcrumb, which made the
 * upstream "empty output → agent not installed" path indistinguishable
 * from actual configuration or tooling issues. We now:
 *   * Return `{ stdout, stderr, errorMessage }` rather than a bare string
 *     so callers can decide whether stderr warrants a log line.
 *   * Keep a string-returning legacy overload for the handful of callers
 *     that only care about stdout (cdp-discovery).
 *   * Append stderr bytes to the returned stdout string via a small header
 *     when stderr is non-empty AND the caller opts into the extended mode.
 * This keeps the callers that depend on the empty-string "no result"
 * semantics working unchanged while the install-detection path can opt
 * into structured reporting via the `includeStderr: true` flag.
 */
export type ExecFileResult = {
  stdout: string;
  stderr: string;
  errorMessage: string | null;
  errorCode: string | null;
};

export function execFileAsync(command: string, args: string[], timeoutMs?: number): Promise<string>;
export function execFileAsync(
  command: string,
  args: string[],
  timeoutMs: number | undefined,
  options: { includeStderr: true },
): Promise<ExecFileResult>;
export function execFileAsync(
  command: string,
  args: string[],
  timeoutMs = 8000,
  options?: { includeStderr?: true },
): Promise<string | ExecFileResult> {
  return new Promise((resolve) => {
    execFile(command, args, { windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
      const out = (stdout ?? '').toString();
      const errOut = (stderr ?? '').toString();
      if (options?.includeStderr) {
        resolve({
          stdout: out,
          stderr: errOut,
          errorMessage: err ? (err as Error).message : null,
          errorCode: err ? ((err as NodeJS.ErrnoException).code ?? null) : null,
        });
      } else {
        resolve(err ? '' : out);
      }
    });
  });
}
