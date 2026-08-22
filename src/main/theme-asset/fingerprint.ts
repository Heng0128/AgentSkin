// SPDX-License-Identifier: MPL-2.0
/**
 * Theme Self-Healing Loop — Fingerprint Module
 *
 * Implements apply-time fingerprint capture, atomic persistence,
 * multi-signal drift detection, and deferred regeneration.
 *
 * @module theme-asset/fingerprint
 * @see {@link docs/rfc/2026-08-20-theme-asset-engine-P3.md} for full RFC
 */

import { createHash } from 'node:crypto';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId } from '../../shared/types/agent';
import type { ThemeColors } from '../catalog/theme-manifest';
import type { FidelityVerdict } from '../cdp/baseline-validator';
import type { CdpSession } from '../cdp/cdp-client';
import { adaptAll } from './adapt/registry';
import { completeSurfaceLayering } from './enhance/layering';
import { InferenceError, ThemeAssetError } from './ir/errors';
import { COLOR_KEYS } from './ir/normalize';
import type { AdapterResult } from './ir/types';
import { contractCheck } from './verify/contract-check';
import { probeAgent } from './verify/probe';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fingerprint schema version (forward compatibility) */
export const FINGERPRINT_VERSION = 1;

/** Drift score threshold to trigger regen */
export const DRIFT_THRESHOLD = 0.3;

/** Consecutive drift detections required before triggering regen (debounce) */
export const REQUIRED_CONSECUTIVE_DRIFT = 2;

/** Max consecutive regen failures before stopping and reporting */
export const MAX_CONSECUTIVE_REGEN_FAILURES = 3;

/** Cooldown between two regen attempts (ms) */
export const REGEN_COOLDOWN_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Error Hierarchy (aligns with ir/errors.ts)
// ---------------------------------------------------------------------------

/**
 * Regen error — extends ThemeAssetError.
 * stage='regen' for regen failures, stage='verify' for verify failures.
 */
export class RegenError extends ThemeAssetError {
  constructor(message: string, stage: 'regen' | 'verify' = 'regen', recoverable = true) {
    super(message, stage, recoverable);
    this.name = 'RegenError';
  }
}

/**
 * Fingerprint capture failure — extends InferenceError (recoverable).
 * Thrown when CDP probe or version detection fails.
 */
export class FingerprintCaptureError extends InferenceError {
  constructor(message: string) {
    super(`Fingerprint capture failed: ${message}`);
    this.name = 'FingerprintCaptureError';
  }
}

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/** Single-agent fingerprint */
export interface ThemeFingerprint {
  version: 1;
  appId: AgentId;
  themeId: string;
  appVersion: string;
  url: string;
  accent: string;
  adoptedSheetCount: number;
  selectorHitMap: Record<string, boolean>;
  tokenHash: string;
  cssHash: string;
  confidence: 'low' | 'high';
  capturedAt: number;
}

/** Multi-agent fingerprint bundle (one per theme) */
export interface ThemeFingerprintBundle {
  themeId: string;
  appVersion: string;
  fingerprints: Record<AgentId, ThemeFingerprint>;
  createdAt: number;
  updatedAt: number;
}

/** Single drift signal */
export interface DriftSignal {
  type: 'selector_hit_drop' | 'accent_shift' | 'sheet_mount_failed' | 'app_version_change';
  weight: number;
  detail: string;
}

/** Drift computation result */
export interface DriftResult {
  score: number;
  signals: DriftSignal[];
}

/** Regen action verdict */
export type RegenAction = 'auto_regen' | 'degrade_report' | 'manual_required';

/** Regen result */
export interface RegenResult {
  status: 'success' | 'failed' | 'skipped';
  reason: string;
  cssOutputs?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Hash Utilities (Node native — avoids cross-layer dependency to UI hash.ts)
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256/16 hash of 14 core tokens.
 * Uses canonical COLOR_KEYS ordering for deterministic output.
 */
export function computeTokenHash(colors: ThemeColors): string {
  const core = COLOR_KEYS.reduce(
    (acc, k) => {
      acc[k] = colors[k] ?? '';
      return acc;
    },
    {} as Record<string, string>,
  );
  return createHash('sha256').update(JSON.stringify(core)).digest('hex').slice(0, 16);
}

/**
 * Compute SHA-256/16 hash of 6-agent CSS outputs.
 * Used to detect user manual modifications.
 */
export function computeCssHash(cssOutputs: Record<string, string>): string {
  const combined = Object.entries(cssOutputs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('\n');
  return createHash('sha256').update(combined).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Storage Layer (atomic write)
// ---------------------------------------------------------------------------

/**
 * Get fingerprint.json path for a theme directory.
 */
export function getFingerprintPath(themeDir: string): string {
  return join(themeDir, 'fingerprint.json');
}

/**
 * Load baseline fingerprint bundle from disk.
 * Returns null if file doesn't exist or is corrupted.
 */
export async function loadBaseline(themeDir: string): Promise<ThemeFingerprintBundle | null> {
  const path = getFingerprintPath(themeDir);
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    // Basic validation
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('themeId' in parsed) ||
      !('fingerprints' in parsed)
    ) {
      return null;
    }
    // Schema migration (forward compatibility)
    return migrateBundle(parsed);
  } catch (error) {
    // Distinguish file-not-found from IO/permission errors
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null; // File doesn't exist — expected for first capture
    }
    // Log unexpected errors but don't crash the apply flow
    console.warn(`[fingerprint] Failed to load baseline: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Save fingerprint bundle to disk using atomic write (tmp → rename).
 * Prevents JSON corruption on write interruption.
 */
export async function saveBaseline(themeDir: string, data: ThemeFingerprintBundle): Promise<void> {
  const path = getFingerprintPath(themeDir);
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmp, path);
  } catch (error) {
    // Clean up tmp file on failure
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(tmp);
    } catch {
      // tmp doesn't exist — ignore
    }
    throw new RegenError(`Failed to save fingerprint: ${(error as Error).message}`, 'regen', true);
  }
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

/**
 * Capture current fingerprint from a live CDP session.
 * Best-effort: returns null on any failure (never throws).
 */
export async function captureFingerprint(
  session: CdpSession,
  agentId: AgentId,
  themeId: string,
  colors: ThemeColors,
  cssOutputs: Record<string, string>,
): Promise<ThemeFingerprint | null> {
  try {
    // Selector hit map (from probeAgent)
    const hitMap = await probeAgent(session, agentId)
      .then((result) =>
        result.details.reduce(
          (acc, d) => {
            acc[d.selector] = d.hit;
            return acc;
          },
          {} as Record<string, boolean>,
        ),
      )
      .catch(() => ({}));

    // App version from user agent
    const appVersion = await getAppVersion(session);

    // Current URL
    const url = await getUrl(session);

    // Adopted sheet count
    const adoptedSheetCount = await getAdoptedSheetCount(session);

    const tokenHash = computeTokenHash(colors);
    const cssHash = computeCssHash(cssOutputs);

    return {
      version: FINGERPRINT_VERSION,
      appId: agentId,
      themeId,
      appVersion,
      url,
      accent: colors.accent ?? '#4a90d9',
      adoptedSheetCount,
      selectorHitMap: hitMap,
      tokenHash,
      cssHash,
      confidence: 'low',
      capturedAt: Date.now(),
    };
  } catch {
    // Capture failure → return null, don't block apply flow
    return null;
  }
}

/**
 * Get app version from CDP Runtime.evaluate('navigator.userAgent').
 * Returns 'unknown' on failure.
 */
async function getAppVersion(session: CdpSession): Promise<string> {
  try {
    const ua = await session.evaluate('navigator.userAgent');
    // Match known Agent app patterns first (e.g., "TRAE/1.2.3", "QoderWork/2.0.0")
    const knownApps = ua.match(/(?:TRAE|QoderWork|WorkBuddy|Doubao|Codex|ZCode)\/(\d+\.\d+\.\d+)/i);
    if (knownApps) return knownApps[0];
    // Fallback: match any "Name/SemVer" pattern (skip common browser tokens)
    const fallback = ua.match(
      /(?!Mozilla|AppleWebKit|Chrome|Safari|Edge|Firefox)([A-Za-z][A-Za-z0-9]*)\/(\d+\.\d+\.\d+)/,
    );
    return fallback ? `${fallback[1]}/${fallback[2]}` : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Get current page URL from CDP.
 */
async function getUrl(session: CdpSession): Promise<string> {
  try {
    return await session.evaluate('window.location.href');
  } catch {
    return '';
  }
}

/**
 * Get adopted sheet count from CDP.
 */
async function getAdoptedSheetCount(session: CdpSession): Promise<number> {
  try {
    const count = await session.evaluate(
      'document.adoptedStyleSheets.filter(s => s.href && s.href.includes("agentskin")).length',
    );
    return Number.parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Drift Detection
// ---------------------------------------------------------------------------

/**
 * Normalized color distance between two hex colors.
 * Returns 0-1 value (0 = identical, 1 = opposite).
 */
export function normalizedColorDistance(colorA: string, colorB: string): number {
  const parse = (c: string): [number, number, number] | null => {
    const hex = c.replace('#', '');
    if (hex.length !== 6) return null;
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  };

  const a = parse(colorA);
  const b = parse(colorB);
  if (!a || !b) return 0;

  // Normalized Euclidean distance in RGB space
  const dr = (a[0] - b[0]) / 255;
  const dg = (a[1] - b[1]) / 255;
  const db = (a[2] - b[2]) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db) / Math.sqrt(3);
}

/**
 * Compute drift score between baseline and current fingerprints.
 * Multi-signal fusion: selectorHitDrop(0.4) + accentShift(0.2) + sheetMount(0.2) + versionChange(0.2).
 */
export function computeDriftScore(
  baseline: ThemeFingerprint,
  current: ThemeFingerprint,
): DriftResult {
  const signals: DriftSignal[] = [];

  // Signal 1: selector hit count drop (weight 0.4)
  const baselineHits = Object.values(baseline.selectorHitMap).filter(Boolean).length;
  const currentHits = Object.values(current.selectorHitMap).filter(Boolean).length;
  if (baselineHits > 0 && currentHits < baselineHits) {
    signals.push({
      type: 'selector_hit_drop',
      weight: 0.4,
      detail: `${baselineHits} → ${currentHits}`,
    });
  }

  // Signal 2: accent color shift (weight 0.2)
  const accentDist = normalizedColorDistance(baseline.accent, current.accent);
  if (accentDist > 0.1) {
    signals.push({
      type: 'accent_shift',
      weight: 0.2,
      detail: `distance=${accentDist.toFixed(3)}`,
    });
  }

  // Signal 3: adopted sheet count drop (weight 0.2)
  if (current.adoptedSheetCount < 1) {
    signals.push({
      type: 'sheet_mount_failed',
      weight: 0.2,
      detail: `count=${current.adoptedSheetCount}`,
    });
  }

  // Signal 4: app version change (weight 0.2)
  if (baseline.appVersion !== current.appVersion) {
    signals.push({
      type: 'app_version_change',
      weight: 0.2,
      detail: `${baseline.appVersion} → ${current.appVersion}`,
    });
  }

  const score = signals.reduce((sum, s) => sum + s.weight, 0);
  return { score, signals };
}

// ---------------------------------------------------------------------------
// Manual Intervention Gate
// ---------------------------------------------------------------------------

/**
 * Determine regen action based on fidelity verdict and drift score.
 * - matchRatio < 0.5 → manual_required (severe degradation)
 * - carrierPresent miss → manual_required (carrier node missing)
 * - driftScore > 0.3 → auto_regen
 * - otherwise → degrade_report (minor drift, no regen)
 */
export function shouldAutoRegen(
  fidelity: FidelityVerdict,
  driftScore: number,
): { action: RegenAction; reason: string } {
  // Severe degradation → must require manual confirmation
  if (fidelity.matchRatio < 0.5) {
    return { action: 'manual_required', reason: 'Severe degradation (matchRatio < 0.5)' };
  }

  // Carrier missing → must require manual confirmation
  const carrierDim = fidelity.dimensions.find((d) => d.key === 'carrierPresent');
  if (carrierDim && !carrierDim.pass) {
    return { action: 'manual_required', reason: 'Carrier node missing' };
  }

  // Moderate drift → auto regen
  if (driftScore > DRIFT_THRESHOLD) {
    return {
      action: 'auto_regen',
      reason: `Drift score ${driftScore.toFixed(2)} > ${DRIFT_THRESHOLD}`,
    };
  }

  // Minor drift → degrade report but no regen
  return { action: 'degrade_report', reason: `Minor drift ${driftScore.toFixed(2)}` };
}

// ---------------------------------------------------------------------------
// Regeneration (Deferred Thunk + Concurrency Guards)
// ---------------------------------------------------------------------------

/** Module-level: prevents same-agent reentrant regen */
const regeneratingAgents = new Set<AgentId>();

/** Module-level: cooldown tracker */
const lastRegenTime = new Map<AgentId, number>();

/** Module-level: consecutive failure counter */
const consecutiveRegenFailures = new Map<AgentId, number>();

/**
 * Partial re-run: adapt → enhance → verify.
 *
 * Re-generates CSS outputs from existing ThemeColors (skipping detect/parse/
 * infer since catalog already has full data). This is the core regen logic
 * called by `regenerateTheme` thunk.
 *
 * Pipeline:
 *   1. adaptAll(colors) → initial CSS outputs
 *   2. completeSurfaceLayering(colors) → enhanced colors with surfaceL1
 *   3. adaptAll(enhancedColors) → final CSS with enhanced surface tokens
 *   4. contractCheck(enhancedColors) → verify 14-token coverage
 *
 * @param colors - Current theme colors (from catalog)
 * @param themeId - Theme id (for CSS selector generation)
 * @returns RegenResult with CSS outputs on success
 */
export function partialRerun(colors: ThemeColors, themeId: string): RegenResult {
  try {
    // Stage 1: Generate initial CSS from current colors
    const adapterResult: AdapterResult = {
      colors,
      meta: { sourceFormat: 'catalog-regen' },
      confidence: 1.0,
    };
    const initialCss = adaptAll(adapterResult, themeId);

    // Stage 2: Enhance surface layering
    const enhancedColors = completeSurfaceLayering(colors);

    // Stage 3: Re-generate CSS with enhanced colors
    const enhancedResult: AdapterResult = {
      colors: enhancedColors,
      meta: { sourceFormat: 'catalog-regen-enhanced' },
      confidence: 1.0,
    };
    const finalCss = adaptAll(enhancedResult, themeId);

    // Stage 4: Verify token coverage
    const verifyReport = contractCheck(enhancedColors);

    if (!verifyReport.passed) {
      return {
        status: 'failed',
        reason: `Verify failed: ${verifyReport.warnings.join(', ')}`,
        cssOutputs: initialCss,
      };
    }

    return {
      status: 'success',
      reason: 'partial re-run completed',
      cssOutputs: finalCss,
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: `Partial re-run error: ${(error as Error).message}`,
    };
  }
}

/**
 * Regenerate theme via partial re-run (adapt → enhance → verify).
 * Uses deferred thunk pattern — returns a function that executes the regen.
 *
 * Caller (agent-engine-service) is responsible for serialization.
 *
 * @param agentId - Target agent
 * @param themeId - Theme id
 * @param colors - Theme colors (captured at apply time, passed via closure)
 */
export function regenerateTheme(
  agentId: AgentId,
  themeId: string,
  colors?: ThemeColors,
): () => Promise<RegenResult> {
  return async (): Promise<RegenResult> => {
    // Concurrency guard
    if (regeneratingAgents.has(agentId)) {
      return { status: 'skipped', reason: 'already regenerating' };
    }

    // Cooldown guard
    const lastTime = lastRegenTime.get(agentId) ?? 0;
    if (Date.now() - lastTime < REGEN_COOLDOWN_MS) {
      return { status: 'skipped', reason: 'cooldown active' };
    }

    // Atomic claim (sync — no await between check and claim)
    regeneratingAgents.add(agentId);
    lastRegenTime.set(agentId, Date.now());

    try {
      // If no colors provided, cannot regen
      if (!colors) {
        return { status: 'failed', reason: 'no colors available for regen' };
      }

      // Execute partial re-run
      const result = partialRerun(colors, themeId);

      // Reset failure counter on success
      if (result.status === 'success') {
        consecutiveRegenFailures.set(agentId, 0);
      } else {
        const failures = (consecutiveRegenFailures.get(agentId) ?? 0) + 1;
        consecutiveRegenFailures.set(agentId, failures);

        if (failures >= MAX_CONSECUTIVE_REGEN_FAILURES) {
          return {
            status: 'failed',
            reason: `Consecutive failures (${failures}) exceeded limit`,
          };
        }
      }

      return result;
    } catch (error) {
      // Increment failure counter
      const failures = (consecutiveRegenFailures.get(agentId) ?? 0) + 1;
      consecutiveRegenFailures.set(agentId, failures);

      if (failures >= MAX_CONSECUTIVE_REGEN_FAILURES) {
        return {
          status: 'failed',
          reason: `Consecutive failures (${failures}) exceeded limit`,
        };
      }

      return { status: 'failed', reason: (error as Error).message };
    } finally {
      regeneratingAgents.delete(agentId);
    }
  };
}

/**
 * Migrate a single fingerprint from older schema versions.
 * Currently only v1 exists; reserved for future v1→v2 migration.
 */
export function migrateFingerprint(data: unknown): ThemeFingerprint {
  if (data && typeof data === 'object' && 'version' in data) {
    const fp = data as ThemeFingerprint;
    if (fp.version === FINGERPRINT_VERSION) {
      return fp;
    }
  }
  // Fallback: return a minimal valid fingerprint
  throw new FingerprintCaptureError('Unsupported fingerprint version');
}

/**
 * Migrate a fingerprint bundle from older schema versions.
 * Handles per-fingerprint migration and bundle-level defaults.
 */
function migrateBundle(data: unknown): ThemeFingerprintBundle {
  if (!data || typeof data !== 'object') {
    throw new FingerprintCaptureError('Invalid bundle data');
  }
  const raw = data as Record<string, unknown>;
  const fingerprints: Record<AgentId, ThemeFingerprint> = {} as Record<AgentId, ThemeFingerprint>;
  // Migrate each fingerprint in the bundle
  if (raw.fingerprints && typeof raw.fingerprints === 'object') {
    for (const [key, value] of Object.entries(raw.fingerprints)) {
      fingerprints[key as AgentId] = migrateFingerprint(value);
    }
  }
  return {
    themeId: String(raw.themeId ?? ''),
    appVersion: String(raw.appVersion ?? 'unknown'),
    fingerprints,
    createdAt: Number(raw.createdAt ?? Date.now()),
    updatedAt: Number(raw.updatedAt ?? Date.now()),
  };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { FINGERPRINT_VERSION as CURRENT_FINGERPRINT_VERSION };
