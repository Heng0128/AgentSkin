// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import path from 'node:path';
import type { InstallHints } from '../../../../adapters/base';
import type { ScannedApp } from '../../../../shared/types/agent';
import { detectInstallation } from '../../../install-detection';
import { mainWarnFromCatch } from '../../../logger';
import { readExeInfo } from '../infra/ps';
import { matchAgainstHints } from '../pipeline/match';
import { AGENT_PROBES } from '../probes';
import { hashPath } from '../util';

/**
 * Scan using the existing `detectInstallation` path. Each agent's exe is
 * individually probed; the result is tagged `adapterMatch: agentId`.
 */
export async function scanKnownAgents(
  collect: (app: ScannedApp) => void,
  isTimedOut: () => boolean,
): Promise<void> {
  // Run all known-agent probes in parallel. Each probe spawns its own
  // PowerShell subprocesses (registry sweep + PE version reads), so doing them
  // serially could eat the entire SCAN_TIMEOUT_MS budget before L2 even starts.
  // The probes are independent (no shared mutable state); `collect` dedupes via
  // the `seen` Map so concurrent completion order is harmless.
  await Promise.all(
    AGENT_PROBES.map(async (probe) => {
      try {
        const detection = await detectInstallation({
          platform: process.platform,
          hints: probe.hints,
          displayName: probe.displayName,
        });
        if (isTimedOut()) return;
        if (!detection.installed || !detection.path) return;

        const exePath = await findExeForAgent(detection.path, probe.hints);
        if (!exePath) return;

        const hash = hashPath(exePath);
        const info = await readExeInfo(exePath).catch(() => null);

        collect({
          id: hash,
          exePath,
          productName: info?.productName || probe.displayName,
          companyName: info?.companyName ?? '',
          version: info?.version ?? detection.version ?? undefined,
          adapterMatch: probe.id,
          source: 'agent',
        });
      } catch (error) {
        mainWarnFromCatch('ElectronScanner', error, `L1 agent ${probe.id}`);
      }
    }),
  );
}

/**
 * Locate the executable inside a detected install directory by checking exact
 * names from the adapter and falling back to any `.exe` in the directory or
 * its parent (Electron apps typically ship `ProductName.exe` alongside
 * `resources/app.asar`). Identity is confirmed via PE version info match.
 */
async function findExeForAgent(installDir: string, hints: InstallHints): Promise<string | null> {
  const searchDirs = [installDir, path.dirname(installDir)];
  for (const dir of searchDirs) {
    for (const exeName of hints.exeNames) {
      const candidate = path.join(dir, exeName);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) return candidate;
      } catch {
        // Not present — try the next name.
      }
    }
    let probed = 0;
    let entries: string[] = [];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (probed >= 10) break;
      if (!entry.toLowerCase().endsWith('.exe')) continue;
      const candidate = path.join(dir, entry);
      try {
        const stat = await fs.stat(candidate);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }
      probed++;
      const info = await readExeInfo(candidate).catch(() => null);
      if (info && matchAgainstHints(info)) {
        return candidate;
      }
    }
  }
  return null;
}
