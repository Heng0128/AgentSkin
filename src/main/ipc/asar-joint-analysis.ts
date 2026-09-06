// SPDX-License-Identifier: MPL-2.0

/**
 * # ASAR Joint Analysis
 *
 * Combines ASAR static analysis with CDP real-time validation to produce
 * a unified health score and inject-readiness assessment.
 *
 * Three-phase pipeline:
 *   Phase 1 (ASAR-only): Scan the extracted package for fragility seeds,
 *            tokens, security posture, surfaces — plus the structural
 *            {@link ArchitectureProfile} (entries, dependency graph, CDP
 *            surfaces, CSP grade, recommended inject mechanism).
 *   Phase 2 (CDP-optional): If the Agent is running, open a session to its
 *            primary renderer and run landmark preflight + anchor probing.
 *   Phase 3 (Joint): Combine into a health score, an inject-readiness verdict,
 *            and a per-surface coverage report.
 *
 * Graceful degradation: Agent not running → static score only (0-40), no CDP
 * data, and `health.noCdpReason` says which link in the chain was missing.
 *
 * ## The defect this file exists to fix
 *
 * The previous implementation acquired its session with
 * `pool.acquire(agentId, 'main', async () => null)`. Two things are wrong
 * there, and together they meant the CDP half never ran at all:
 *
 *   1. `'main'` is not a target key. The pool is keyed by
 *      `targetKeyFor(target.id, target.webSocketDebuggerUrl)`, so a literal
 *      `'main'` never hits a real entry and always opens a fresh one.
 *   2. The `open` factory returned `null` unconditionally, so every fresh
 *      acquire produced `null` → `session` was `null` → the code silently fell
 *      through to the static-only path.
 *
 * Net effect: `dynamicScore` was permanently 0 and every report read
 * "agent not running" even with the app wide open. Sessions are now acquired
 * through the shared {@link acquireSession} helper with a real target key and
 * a real connect factory, and released through {@link releaseSession}.
 */

import { ipcMain } from 'electron';
import type { EntryRole, InjectMechanism } from '../../shared/asar-architecture';
import { type ScanFamily, scanFamilyForAgent } from '../../shared/asar-architecture';
import { IpcChannel } from '../../shared/ipc-channels';
import type { AgentId } from '../../shared/types/agent';
import type { CdpSession } from '../cdp/cdp-client';
import { getDefaultLandmarks, runLandmarkPreflight } from '../cdp/preflight';
import { pickPrimaryRenderer, RENDERER_HINTS } from '../cdp/renderer-tools';
import { validateSelectors } from '../cdp/selector-utils';
import {
  acquireSession,
  type CdpSessionPool,
  releaseSession,
  targetKeyFor,
} from '../cdp/session-pool';
import { type ScanResult, scanExtractedAsar } from './asar-ipc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JointAnalysisRequest {
  agentId: AgentId;
  extractDir: string;
  cachedScanResult?: ScanResult;
}

export interface JointHealthScore {
  total: number; // 0-100
  staticScore: number; // 0-40 (from ASAR static analysis)
  dynamicScore: number; // 0-60 (from CDP real-time validation)
  hitRate: number; // anchor hit rate 0-1
  landmarkPassed: boolean;
  /** Which link in the CDP chain was missing — set only when CDP is absent. */
  noCdpReason?: string;
}

export interface InjectReadinessAssessment {
  canInject: boolean;
  blocks: string[];
  warnings: string[];
  recommendations: string[];
}

/** Minimal CDP target metadata — structural, so any target source satisfies it. */
export interface JointTargetInfo {
  id?: string | null;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string | null;
}

/** One multi-page surface from the ASAR profile, checked against live targets. */
export interface SurfaceCheck {
  role: EntryRole;
  /** Entry HTML, relative to the extracted root. */
  entry: string;
  /** Whether a live CDP target appears to serve this entry. */
  matched: boolean;
  title?: string;
  url?: string;
}

/** What the live CDP side contributed to the report. */
export interface JointCdpInfo {
  port: number;
  targetId: string;
  title?: string;
  url?: string;
  /** Multi-page entries and whether each was found among the live targets. */
  surfaces: SurfaceCheck[];
  /** Delivery mechanism recommended from the CSP grade + architecture family. */
  mechanism?: InjectMechanism;
}

export interface JointAnalysisResult {
  scanResult: ScanResult;
  health: JointHealthScore;
  readiness: InjectReadinessAssessment;
  /** Present only when a live CDP session was established. */
  cdp?: JointCdpInfo;
}

/**
 * Why a live session could not be established.
 *
 * Surfaced verbatim in `health.noCdpReason` — an operator who sees
 * "no live CDP port" knows to launch the app with `--remote-debugging-port`,
 * whereas a generic "agent not running" sends them looking for a crash.
 */
export type AcquireFailureReason =
  | 'no-live-cdp-port'
  | 'no-dom-target'
  | 'connect-failed'
  | 'not-attempted';

/** Outcome of attempting to reach the agent over CDP. */
export type JointAcquireResult =
  | {
      ok: true;
      session: CdpSession;
      /** MUST be called exactly once when `ok` — releases the pooled session. */
      release: () => void;
      port: number;
      target: JointTargetInfo;
      /** All live targets on the port, for surface-coverage matching. */
      targets: readonly JointTargetInfo[];
    }
  | { ok: false; reason: AcquireFailureReason | string };

/**
 * Live connection plumbing, injected so the orchestration stays testable.
 *
 * See `asar-cdp-bridge.ts` for the real implementation.
 */
export interface JointCdpBridge {
  /** Port serving CDP for this agent, or null when the app isn't reachable. */
  resolvePort(agentId: AgentId): Promise<number | null>;
  /** Targets on a port. */
  listTargets(port: number): Promise<readonly JointTargetInfo[]>;
  /** Open a session to a target's WebSocket URL. */
  connect(wsUrl: string): Promise<CdpSession | null>;
}

export interface JointAnalysisDeps {
  acquire: (agentId: AgentId) => Promise<JointAcquireResult>;
}

// ---------------------------------------------------------------------------
// Session acquisition
// ---------------------------------------------------------------------------

/** Target types that can carry our CSS. */
const DOM_TARGET_TYPES = new Set(['page', 'webview', 'iframe']);

/**
 * Acquire a session to the agent's primary renderer.
 *
 * Picks the target with `pickPrimaryRenderer` using the per-agent
 * `RENDERER_HINTS` (the same ranking the injection fan-out uses, so the
 * analysis probes the target that an apply would actually theme), then hands
 * off to the shared pool helper so the session is reused and ref-counted like
 * every other consumer's.
 */
export async function acquireJointSession(
  bridge: JointCdpBridge,
  pool: CdpSessionPool | undefined,
  agentId: AgentId,
): Promise<JointAcquireResult> {
  const port = await bridge.resolvePort(agentId);
  if (port == null) return { ok: false, reason: 'no-live-cdp-port' };

  const targets = await bridge.listTargets(port);
  const domTargets = targets.filter((t) => DOM_TARGET_TYPES.has(t.type ?? 'page'));
  if (domTargets.length === 0) return { ok: false, reason: 'no-dom-target' };

  const hints = RENDERER_HINTS[agentId];
  // Normalize to renderer-rank's CdpTargetInfo: it requires a non-null `id`
  // and treats `webSocketDebuggerUrl` as optional-but-present (never null).
  const ranked = domTargets.map((t) => ({
    ...t,
    id: t.id ?? t.url ?? '',
    webSocketDebuggerUrl: t.webSocketDebuggerUrl ?? undefined,
  }));
  const primary = pickPrimaryRenderer(
    hints
      ? { preferredUrlPatterns: [...hints.primary], secondaryPatterns: [...hints.secondary] }
      : undefined,
    ranked,
  );
  const wsUrl = primary?.webSocketDebuggerUrl;
  if (!primary || !wsUrl) return { ok: false, reason: 'no-dom-target' };

  const key = targetKeyFor(primary.id, wsUrl);
  let session: CdpSession | null = null;
  let pooled = false;
  try {
    const handle = await acquireSession(pool, agentId, key, () => bridge.connect(wsUrl));
    session = handle.session;
    pooled = handle.pooled;
  } catch {
    session = null;
  }
  if (!session) return { ok: false, reason: 'connect-failed' };

  let released = false;
  return {
    ok: true,
    session,
    release: () => {
      // Guard against double release — the pool would decrement another
      // holder's refCount and close a session still in use.
      if (released) return;
      released = true;
      if (pooled) releaseSession(pool, agentId, key);
      else session?.close();
    },
    port,
    target: primary,
    targets,
  };
}

/**
 * Wire a {@link JointCdpBridge} + session pool into the deps the orchestration
 * needs. Exported so tests can build the real acquisition path against a stub
 * bridge without touching sockets.
 */
export function createJointAnalysisDeps(
  bridge: JointCdpBridge,
  getPool: () => CdpSessionPool | undefined,
): JointAnalysisDeps {
  return {
    acquire: (agentId) => acquireJointSession(bridge, getPool(), agentId),
  };
}

// ---------------------------------------------------------------------------
// IPC Registration
// ---------------------------------------------------------------------------

/**
 * Register the joint-analysis IPC handler.
 *
 * @param getSessionPool — resolves the live pool (absent until the engine is up).
 * @param bridge — live CDP plumbing; without it the analysis reports
 *   `not-attempted` and stays static-only, which is the honest answer when the
 *   caller has no way to reach the app.
 */
export function registerJointAnalysisIpc(
  getSessionPool: () => CdpSessionPool | undefined,
  bridge?: JointCdpBridge,
): void {
  ipcMain.handle(IpcChannel.ASAR_JOINT_ANALYSIS, async (_evt, req: JointAnalysisRequest) => {
    const deps: JointAnalysisDeps = bridge
      ? createJointAnalysisDeps(bridge, getSessionPool)
      : { acquire: async () => ({ ok: false, reason: 'not-attempted' as const }) };
    return runJointAnalysis(req, deps);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Human-readable explanation for each acquire failure reason. */
const REASON_TEXT: Readonly<Record<string, string>> = Object.freeze({
  'no-live-cdp-port':
    '未找到可用的 CDP 调试端口（应用未启动，或未带 --remote-debugging-port 启动）',
  'no-dom-target': 'CDP 端口可达但没有可注入的 page/webview/iframe target',
  'connect-failed': 'WebSocket 连接失败（端口存在但握手被拒绝）',
  'not-attempted': '未配置 CDP 桥接，跳过动态校验',
});

/**
 * Run joint analysis: ASAR static + CDP dynamic (if reachable).
 *
 * The scan family is derived from the shared per-agent table rather than
 * accepted as a parameter — the renderer used to pass its own guess, which is
 * how TRAE SOLO CN ended up scanned with two different strategies.
 */
export async function runJointAnalysis(
  req: JointAnalysisRequest,
  deps: JointAnalysisDeps,
): Promise<JointAnalysisResult> {
  const family: ScanFamily = scanFamilyForAgent(req.agentId);

  // Phase 1: ASAR scan (use cache when the caller already has one).
  const scanResult = req.cachedScanResult ?? scanExtractedAsar(req.extractDir, family, req.agentId);

  // Phase 2: CDP validation (only if the Agent is reachable).
  let acquired: JointAcquireResult;
  try {
    acquired = await deps.acquire(req.agentId);
  } catch (err) {
    acquired = { ok: false, reason: `acquire threw: ${toMessage(err)}` };
  }

  if (!acquired.ok) {
    const raw = String(acquired.reason);
    return {
      scanResult,
      health: computeStaticHealth(scanResult, REASON_TEXT[raw] ?? raw),
      readiness: assessReadinessFromAsar(scanResult),
    };
  }

  // Agent reachable → landmark preflight + anchor probing.
  try {
    const landmarks = getDefaultLandmarks(req.agentId);
    const preflight = await runLandmarkPreflight(acquired.session, landmarks);

    // Probe top fragility seeds (high stability only, max 25).
    const topSeeds = scanResult.fragilitySeeds
      .filter((s) => s.stability === 'high')
      .slice(0, 25)
      .map((s) => selectorForAnchor(s));
    const seedValidation = await validateSelectors(acquired.session, req.agentId, topSeeds);

    const hitRate =
      seedValidation.summary.total > 0
        ? seedValidation.summary.hit / seedValidation.summary.total
        : 0;

    const health = computeJointHealth(scanResult, {
      hitRate,
      landmarkPassed: preflight.passed,
    });

    const surfaces = matchSurfaces(scanResult, acquired.targets);
    const cdp: JointCdpInfo = {
      port: acquired.port,
      targetId: acquired.target.id ?? '',
      title: acquired.target.title,
      url: acquired.target.url,
      surfaces,
      mechanism: scanResult.architecture?.inject.mechanism,
    };

    const readiness = assessInjectReadiness(scanResult, health, preflight.passed, surfaces);

    return { scanResult, health, readiness, cdp };
  } catch (err) {
    // CDP failed mid-flight → fall back to static-only, but say why.
    return {
      scanResult,
      health: computeStaticHealth(scanResult, `CDP error: ${toMessage(err)}`),
      readiness: assessReadinessFromAsar(scanResult),
    };
  } finally {
    acquired.release();
  }
}

// ---------------------------------------------------------------------------
// Health score computation
// ---------------------------------------------------------------------------

/**
 * Static-only score.
 *
 * @param noCdpReason — human-readable explanation of which link in the CDP
 *   chain was missing. A bare "agent not running" is not actionable: the app
 *   may well be running with CDP disabled, and the operator needs to know
 *   which of those it is.
 */
function computeStaticHealth(asar: ScanResult, noCdpReason?: string): JointHealthScore {
  const highStabilityCount = asar.fragilitySeeds.filter((s) => s.stability === 'high').length;
  const namespaceCount = Object.keys(asar.tokens.namespaces).length;
  const contextIsolationBonus = asar.security.contextIsolation === true ? 10 : 0;

  const seedScore = Math.min(20, Math.round((highStabilityCount / 25) * 20));
  const namespaceScore = Math.min(10, namespaceCount);
  const staticScore = Math.min(40, seedScore + namespaceScore + contextIsolationBonus);

  return {
    total: staticScore,
    staticScore,
    dynamicScore: 0,
    hitRate: 0,
    landmarkPassed: false,
    noCdpReason: noCdpReason ?? REASON_TEXT['no-live-cdp-port'],
  };
}

function computeJointHealth(
  asar: ScanResult,
  cdp: { hitRate: number; landmarkPassed: boolean },
): JointHealthScore {
  // Static score (0-40)
  const highStabilityCount = asar.fragilitySeeds.filter((s) => s.stability === 'high').length;
  const namespaceCount = Object.keys(asar.tokens.namespaces).length;
  const contextIsolationBonus = asar.security.contextIsolation === true ? 10 : 0;
  const staticScore = Math.min(
    40,
    Math.min(20, Math.round((highStabilityCount / 25) * 20)) +
      Math.min(10, namespaceCount) +
      contextIsolationBonus,
  );

  // Dynamic score (0-60)
  const hitScore = Math.round(cdp.hitRate * 40); // up to 40 from hit rate
  const landmarkScore = cdp.landmarkPassed ? 20 : 10; // 20 if all pass, 10 if partial
  const dynamicScore = Math.min(60, hitScore + landmarkScore);

  return {
    total: staticScore + dynamicScore,
    staticScore,
    dynamicScore,
    hitRate: cdp.hitRate,
    landmarkPassed: cdp.landmarkPassed,
  };
}

// ---------------------------------------------------------------------------
// Surface coverage
// ---------------------------------------------------------------------------

/**
 * Match the ASAR profile's multi-page entries against the live target list.
 *
 * QoderWork opens `voice-overlay.html`, `mcp-app-preview.html`,
 * `artifact-preview.html` and `quickpick.html` as separate BrowserWindows, and
 * ZCode does the same for its permission/monitor panels. Each becomes its own
 * CDP target; an apply that only reaches the primary renderer leaves every one
 * of them unthemed. Matching is by entry basename against target URL/title —
 * cheap, and it turns a silent miss into a named warning.
 */
function matchSurfaces(scan: ScanResult, targets: readonly JointTargetInfo[]): SurfaceCheck[] {
  const architecture = scan.architecture;
  if (!architecture) return [];

  return architecture.surfaces
    .filter((s) => s.requiresSeparateTarget)
    .map((surface) => {
      const needle = surface.entry.slice(surface.entry.lastIndexOf('/') + 1).replace(/\.html$/, '');
      const hit = targets.find(
        (t) =>
          (t.url ?? '').toLowerCase().includes(needle) ||
          (t.title ?? '').toLowerCase().includes(needle),
      );
      return {
        role: surface.role,
        entry: surface.entry,
        matched: hit !== undefined,
        title: hit?.title,
        url: hit?.url,
      };
    });
}

// ---------------------------------------------------------------------------
// Inject readiness assessment
// ---------------------------------------------------------------------------

function assessReadinessFromAsar(asar: ScanResult): InjectReadinessAssessment {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Security checks
  if (asar.security.contextIsolation === false) {
    blocks.push('contextIsolation is false — preload injection may be blocked');
  } else if (asar.security.contextIsolation === null) {
    warnings.push('contextIsolation not detected — verify manually');
  }

  if (asar.security.sandbox === true) {
    recommendations.push('Sandbox is enabled — ensure preload path is allowed');
  }

  // Token coverage check
  if (Object.keys(asar.tokens.namespaces).length < 2) {
    warnings.push('Low CSS token coverage — theme may not apply cleanly');
  }

  // Fragility seed check
  const highSeeds = asar.fragilitySeeds.filter((s) => s.stability === 'high').length;
  if (highSeeds < 5) {
    warnings.push('Few high-stability anchors — injection may be fragile');
  }

  // CSP-derived delivery mechanism
  const inject = asar.architecture?.inject;
  if (inject) {
    if (inject.mechanism === 'adoptedStyleSheets') {
      recommendations.push(`使用 adoptedStyleSheets 注入：${inject.reasons.join('；')}`);
    } else {
      recommendations.push(`可使用内联 <style> 注入：${inject.reasons.join('；')}`);
    }
  }

  return {
    canInject: blocks.length === 0,
    blocks,
    warnings,
    recommendations,
  };
}

function assessInjectReadiness(
  asar: ScanResult,
  health: JointHealthScore,
  landmarkPassed: boolean,
  surfaces: readonly SurfaceCheck[],
): InjectReadinessAssessment {
  const base = assessReadinessFromAsar(asar);

  // Add dynamic warnings
  if (health.hitRate < 0.5) {
    base.warnings.push(
      `Low anchor hit rate (${Math.round(health.hitRate * 100)}%) — selectors may be stale`,
    );
  }

  if (!landmarkPassed) {
    base.warnings.push('Landmark preflight not fully passed — some DOM anchors missing');
  }

  // Uncovered multi-page surfaces: a theme that silently misses the voice
  // overlay looks like a partial failure to the user, so name them.
  const uncovered = surfaces.filter((s) => !s.matched);
  if (uncovered.length > 0) {
    base.warnings.push(
      `${uncovered.length} 个独立窗口页面未覆盖：${uncovered
        .map((s) => `${s.role}(${s.entry})`)
        .join('、')} — 需单独注入`,
    );
  }

  // Final inject decision
  base.canInject = base.blocks.length === 0;

  return base;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function selectorForAnchor(seed: { anchor: string; kind: string }): string {
  switch (seed.kind) {
    case 'data-testid':
      return `[data-testid="${seed.anchor}"]`;
    case 'id':
      return `#${seed.anchor}`;
    case 'data-attr':
      return `[${seed.anchor}]`;
    default:
      return `[data-*="${seed.anchor}"]`;
  }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
