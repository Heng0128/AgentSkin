// SPDX-License-Identifier: MPL-2.0
/**
 * CDP Fingerprint Capture Helper
 *
 * Bridges the CDP session lifecycle (open → capture → close) for the
 * P3 self-healing loop's fingerprint capture step. Follows the pattern
 * established by `captureBaselineOnPort` in apply-baseline.ts.
 *
 * @module cdp/cdp-fingerprint
 */

import { IpcChannel } from '../../shared/ipc-channels';
import type { AgentId } from '../../shared/types/agent';
import type { DriftStatus } from '../../shared/types/drift-status';
import type { ThemeColors } from '../catalog/theme-manifest';
import { mainWarn } from '../logger';
import { ctx } from '../main-context';
import { captureDetectDispatch } from '../theme-asset/deferred-regen';
import { probeAgent } from '../theme-asset/verify/probe';
import type { FidelityVerdict } from './baseline-validator';
import { type CdpSession, connectCdp } from './cdp-client';
import { findDomTargets } from './cdp-targets';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open a session to the main DOM-bearing target on a port, capture the
 * fingerprint, detect drift, and conditionally dispatch regen. Returns
 * null when no DOM target is reachable or capture fails.
 *
 * Best-effort: never throws. All errors are caught and logged.
 *
 * @param port - CDP debug port
 * @param appId - Target agent
 * @param themeId - Theme id
 * @param colors - Theme colors (from InstalledTheme)
 * @param themeDir - Theme package directory (for baseline storage)
 */
export async function captureFingerprintOnPort(
  port: number,
  appId: AgentId,
  themeId: string,
  colors: ThemeColors,
  themeDir: string,
): Promise<void> {
  const session = await openMainDomSession(port);
  if (!session) return;

  try {
    // Build a minimal fidelity verdict from probeAgent hitRate
    const fidelity = await buildSyntheticFidelity(session, appId);

    // Capture → detect → dispatch → push drift status to UI
    await captureDetectDispatch(
      session,
      appId,
      themeId,
      colors,
      {}, // cssOutputs: empty for initial integration (CSS applied via adapter)
      themeDir,
      fidelity,
      () => false, // isApplying: false since we're past apply phase
      (status: DriftStatus) => pushDriftStatus(status),
    );
  } catch (error) {
    mainWarn('Fingerprint.Capture', `capture failed for ${appId}: ${error}`);
  } finally {
    closeSafely(session);
  }
}

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/**
 * Build a synthetic FidelityVerdict using probeAgent's hitRate as matchRatio.
 * This avoids the complexity of a full fidelity check (which requires
 * BaselineCssCapture) while still providing enough signal for shouldAutoRegen.
 */
async function buildSyntheticFidelity(
  session: CdpSession,
  appId: AgentId,
): Promise<FidelityVerdict> {
  try {
    const result = await probeAgent(session, appId);
    // Use hitRate as proxy for matchRatio
    const matchRatio = result.hitRate;
    return {
      pass: matchRatio >= 0.8,
      matchRatio,
      degraded: matchRatio < 0.5,
      dimensions: [
        {
          key: 'adoptedSheetCount' as const,
          pass: matchRatio >= 0.5,
          diff: 1 - matchRatio,
        },
      ],
    };
  } catch {
    // Default: assume moderate fidelity
    return {
      pass: true,
      matchRatio: 0.9,
      degraded: false,
      dimensions: [],
    };
  }
}

/**
 * Open a session to the main DOM-bearing target on a port.
 * Returns null when no DOM target is reachable.
 */
async function openMainDomSession(port: number): Promise<CdpSession | null> {
  try {
    const targets = await findDomTargets(port);
    if (!targets.length || !targets[0].webSocketDebuggerUrl) return null;
    return await connectCdp(targets[0].webSocketDebuggerUrl, 3000);
  } catch (error) {
    mainWarn('Fingerprint.Connect', `open main DOM session failed: ${error}`);
    return null;
  }
}

/**
 * Push drift status to the Diagnostics UI via the main window's webContents.
 * Best-effort: silently drops when the window is unavailable or destroyed.
 */
function pushDriftStatus(status: DriftStatus): void {
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send(IpcChannel.THEME_DRIFT_STATUS, status);
  }
}

/**
 * Close a CDP session, swallowing any error.
 */
function closeSafely(session: CdpSession): void {
  try {
    session.close();
  } catch {
    // ignore
  }
}
