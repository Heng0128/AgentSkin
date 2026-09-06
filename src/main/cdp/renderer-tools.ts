// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp/renderer-tools
 *
 * Merged CDP renderer utility module — combines the former `renderer-fingerprint`,
 * `renderer-guardian`, and `rank` modules into a single cohesive namespace.
 *
 * ## Sub-modules
 *
 * ### Fingerprint (from renderer-fingerprint)
 * Multi-renderer fingerprinting for AgentSkin's six adapters. Each adapter declares
 * `primaryHints` (main window) and `secondaryHints` (auxiliary surfaces).
 * `identifyRenderers` classifies CDP targets into primary / secondary / ignored
 * using three-tier matching (exact > substring > regex). Pure functions only.
 *
 * ### Rank (from renderer-rank)
 * Primary renderer semantic anchor determination (RFC 2026-08-18). When an app
 * exposes multiple compatible page targets, "which is the visible main window"
 * should not rely on `/json/list` return order but on adapter hint-based ranking.
 * Pure functions: rank / pickPrimary / partition.
 *
 * ### Guardian (from renderer-guardian)
 * CDP renderer stable detection and auto-reinjection: stable polling, rebuild
 * listener (targetDestroyed/Created with debounce), health check with failure
 * threshold. Side effects injected via constructor deps; core algorithm testable.
 */

import type { AgentId } from '../../shared/types/agent';
import { connectEventCdp, type EventCdpSession } from './cdp-client';
import { type CdpTarget, listTargets } from './cdp-targets';

// ===========================================================================
// Shared types
// ===========================================================================

/** Minimal CDP target metadata shape (used by both fingerprint and rank). */
export interface CdpTargetInfo {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
  [key: string]: unknown;
}

// ===========================================================================
// Fingerprint — multi-renderer classification for six adapters
// ===========================================================================

export type RendererClass = 'primary' | 'secondary' | 'ignored';

export interface ClassifiedTarget {
  target: CdpTargetInfo;
  classification: RendererClass;
  matchedHint?: string;
  matchTier?: 'exact' | 'substring' | 'regex';
}

export interface IdentificationResult {
  primary: ClassifiedTarget[];
  secondary: ClassifiedTarget[];
  ignored: ClassifiedTarget[];
}

export interface InjectionStep {
  target: CdpTargetInfo;
  classification: RendererClass;
  delayMs: number;
  order: number;
}

export interface InjectionPlan {
  steps: InjectionStep[];
  primaryCount: number;
  secondaryCount: number;
  ignoredCount: number;
}

export interface RendererHintsConfig {
  primary: string[];
  secondary: string[];
}

export const RENDERER_HINTS: Readonly<Record<AgentId, RendererHintsConfig>> = Object.freeze({
  traework: Object.freeze({
    primary: ['solo/solo-lite.html', 'solo-lite.html', 'index.html'],
    secondary: ['launcher.html', 'settings.html'],
  }),
  qoderwork: Object.freeze({
    primary: ['out/renderer/index.html', 'renderer/index.html'],
    secondary: ['welcome.html', 'onboarding.html'],
  }),
  workbuddy: Object.freeze({
    primary: ['app.asar/renderer/index.html', 'renderer/index.html'],
    secondary: ['sidebar.html', 'settings.html'],
  }),
  doubao: Object.freeze({
    primary: ['doubao://doubao-chat/chat', 'doubao-chat/chat'],
    secondary: ['doubao://doubao-home', 'launcher.html'],
  }),
  codex: Object.freeze({
    primary: ['index.html', 'renderer/index.html'],
    secondary: ['sidebar.html', 'prompt-library.html'],
  }),
  zcode: Object.freeze({
    primary: ['out/renderer/index.html', 'renderer/index.html'],
    secondary: ['welcome.html', 'authentication.html'],
  }),
});

/** Match a URL against a hint: exact > substring > regex. */
export function matchHint(url: string, hint: string): 'exact' | 'substring' | 'regex' | null {
  if (url === hint) return 'exact';
  if (url.includes(hint)) return 'substring';
  try {
    if (new RegExp(hint, 'i').test(url)) return 'regex';
  } catch {
    // Invalid regex — no match.
  }
  return null;
}

/** Classify a single target against an adapter's hints. */
export function classifyTarget(
  target: CdpTargetInfo,
  hints: RendererHintsConfig,
): ClassifiedTarget {
  const url = String(target.url ?? '');
  for (const hint of hints.primary) {
    const tier = matchHint(url, hint);
    if (tier) return { target, classification: 'primary', matchedHint: hint, matchTier: tier };
  }
  for (const hint of hints.secondary) {
    const tier = matchHint(url, hint);
    if (tier) return { target, classification: 'secondary', matchedHint: hint, matchTier: tier };
  }
  return { target, classification: 'ignored' };
}

/** Identify and classify all targets for a given adapter. */
export function identifyRenderers(
  targets: readonly CdpTargetInfo[],
  agentId: AgentId,
): IdentificationResult {
  const hints = RENDERER_HINTS[agentId];
  const result: IdentificationResult = { primary: [], secondary: [], ignored: [] };
  for (const target of targets) {
    const c = classifyTarget(target, hints);
    result[c.classification].push(c);
  }
  return result;
}

export interface InjectionPlanOptions {
  secondaryDelayMs?: number;
}

/** Produce an ordered injection plan from an identification result. */
export function planInjectionOrder(
  identification: IdentificationResult,
  options: InjectionPlanOptions = {},
): InjectionPlan {
  const { secondaryDelayMs = 500 } = options;
  const steps: InjectionStep[] = [];
  let order = 0;
  for (const e of identification.primary) {
    steps.push({ target: e.target, classification: 'primary', delayMs: 0, order: order++ });
  }
  for (const e of identification.secondary) {
    steps.push({
      target: e.target,
      classification: 'secondary',
      delayMs: secondaryDelayMs,
      order: order++,
    });
  }
  return {
    steps,
    primaryCount: identification.primary.length,
    secondaryCount: identification.secondary.length,
    ignoredCount: identification.ignored.length,
  };
}

/** Convenience: identify + plan in one call. */
export function buildInjectionPlan(
  targets: readonly CdpTargetInfo[],
  agentId: AgentId,
  options?: InjectionPlanOptions,
): InjectionPlan {
  return planInjectionOrder(identifyRenderers(targets, agentId), options);
}

// ===========================================================================
// Rank — primary renderer semantic anchor determination
// ===========================================================================

export interface RendererHints {
  /** Ordered URL patterns (regex). First matching target is the primary renderer. */
  preferredUrlPatterns?: string[];
  /** Scoring callback: higher value = higher priority primary renderer. */
  score?: (target: CdpTargetInfo) => number;
  /** URL patterns explicitly classified as secondary (background/boot/overlay). */
  secondaryPatterns?: string[];
}

export interface RendereredRankResult<T extends CdpTargetInfo = CdpTargetInfo> {
  /** Primary renderer; undefined when no candidate exists. */
  primary: T | undefined;
  /** Candidate primary renderers (excluding secondary, hint-ordered, non-primary). */
  candidates: T[];
  /** Targets explicitly excluded by secondaryPatterns (background/boot/overlay). */
  secondaries: T[];
  /** Matched preferred pattern (for diagnostics). */
  matchedPreferredPattern?: string;
}

const toPattern = (p: string): RegExp => {
  try {
    return new RegExp(p, 'i');
  } catch {
    // Invalid regex degrades to literal match (never throw to avoid polluting injection).
    return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
};

/** Determine whether a target is explicitly declared as a secondary renderer. */
export function isSecondaryRenderer(
  hints: RendererHints | undefined,
  target: CdpTargetInfo,
): boolean {
  if (!hints?.secondaryPatterns || hints.secondaryPatterns.length === 0) return false;
  const url = String(target.url ?? '');
  const title = String(target.title ?? '');
  if (!url && !title) return false;
  return hints.secondaryPatterns.some((p) => toPattern(p).test(url) || toPattern(p).test(title));
}

/**
 * Rank compatible page-target set for primary renderer. Returns primary/candidate/secondary triage.
 *
 * Should only be applied to **page-type targets already filtered by matchTarget**. Non-page
 * targets (webview/iframe) are out of scope — callers handle them separately.
 */
export function partitionRenderers<T extends CdpTargetInfo>(
  hints: RendererHints | undefined,
  targets: readonly T[],
): RendereredRankResult<T> {
  const secondaries: T[] = [];
  const candidates: T[] = [];

  for (const target of targets) {
    if (isSecondaryRenderer(hints, target)) {
      secondaries.push(target);
      continue;
    }
    candidates.push(target);
  }

  if (candidates.length === 0) {
    return { primary: undefined, candidates, secondaries };
  }

  const orderedPreferred = hints?.preferredUrlPatterns ?? [];
  if (orderedPreferred.length > 0) {
    for (const pattern of orderedPreferred) {
      const re = toPattern(pattern);
      const hit = candidates.find((t) => {
        const url = String(t.url ?? '');
        const title = String(t.title ?? '');
        return re.test(url) || re.test(title);
      });
      if (hit) {
        return {
          primary: hit,
          candidates: candidates.filter((t) => t.id !== hit.id),
          secondaries,
          matchedPreferredPattern: pattern,
        };
      }
    }
  }

  if (typeof hints?.score === 'function') {
    let best = candidates[0];
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const target of candidates) {
      const s = hints.score(target);
      if (s > bestScore) {
        bestScore = s;
        best = target;
      }
    }
    return {
      primary: best,
      candidates: candidates.filter((t) => t.id !== best.id),
      secondaries,
    };
  }

  // Degrade: first page target is primary.
  const primary = candidates[0];
  return { primary, candidates: candidates.slice(1), secondaries };
}

/** Convenience: returns only the primary renderer. */
export function pickPrimaryRenderer<T extends CdpTargetInfo>(
  hints: RendererHints | undefined,
  targets: readonly T[],
): T | undefined {
  return partitionRenderers(hints, targets).primary;
}

// ===========================================================================
// Guardian — renderer stable detection & auto-reinjection
// ===========================================================================

export interface RendererGuardianOptions {
  port: number;
  rendererHint: string;
  stableMs?: number;
  pollMs?: number;
  maxFailures?: number;
  timeoutMs?: number;
  onRendererStable?: (targetId: string) => Promise<void>;
  onRendererRecreated?: (oldId: string, newId: string) => Promise<void>;
  onInjectionLost?: () => Promise<void>;
}

export type RendererResolver = (targets: readonly CdpTarget[], hint: string) => string | undefined;
export type SleepFn = (ms: number) => Promise<void>;
export type InjectionChecker = (session: EventCdpSession | null) => Promise<boolean>;

const DEF_STABLE_MS = 1000;
const DEF_POLL_MS = 250;
const DEF_MAX_FAILURES = 5;
const DEF_TIMEOUT_MS = 30_000;
const RECREATE_DEBOUNCE_MS = 500;
const HEALTH_INTERVAL_MS = 5000;

export function defaultRendererResolver(
  targets: readonly CdpTarget[],
  hint: string,
): string | undefined {
  const h = hint.toLowerCase();
  return targets.find(
    (t) =>
      t.type === 'page' && (t.url?.toLowerCase().includes(h) || t.title?.toLowerCase().includes(h)),
  )?.id;
}

export function targetExists(targets: readonly CdpTarget[], id: string): boolean {
  return targets.some((t) => t.id === id);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractTargetId(params: unknown): string | undefined {
  if (params && typeof params === 'object' && 'targetId' in params) {
    const id = (params as Record<string, unknown>).targetId;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

export class RendererGuardian {
  private readonly port: number;
  private readonly rendererHint: string;
  private readonly stableMs: number;
  private readonly pollMs: number;
  private readonly maxFailures: number;
  private readonly timeoutMs: number;
  private readonly onRendererStable?: (targetId: string) => Promise<void>;
  private readonly onRendererRecreated?: (oldId: string, newId: string) => Promise<void>;
  private readonly onInjectionLost?: () => Promise<void>;
  private readonly resolveRenderer: RendererResolver;
  private readonly sleepFn: SleepFn;
  private readonly checkInjection: InjectionChecker;

  private _failureCount = 0;
  private _isHealthy = true;
  private _watching = false;
  private session: EventCdpSession | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private stableTargetId: string | null = null;
  private destroyHandler: ((params: unknown) => void) | null = null;
  private createHandler: ((params: unknown) => void) | null = null;
  private recreateTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOldId: string | null = null;

  constructor(
    options: RendererGuardianOptions,
    deps: {
      resolveRenderer?: RendererResolver;
      sleepFn?: SleepFn;
      checkInjection?: InjectionChecker;
    } = {},
  ) {
    this.port = options.port;
    this.rendererHint = options.rendererHint;
    this.stableMs = options.stableMs ?? DEF_STABLE_MS;
    this.pollMs = options.pollMs ?? DEF_POLL_MS;
    this.maxFailures = options.maxFailures ?? DEF_MAX_FAILURES;
    this.timeoutMs = options.timeoutMs ?? DEF_TIMEOUT_MS;
    this.onRendererStable = options.onRendererStable;
    this.onRendererRecreated = options.onRendererRecreated;
    this.onInjectionLost = options.onInjectionLost;
    this.resolveRenderer = deps.resolveRenderer ?? defaultRendererResolver;
    this.sleepFn = deps.sleepFn ?? sleep;
    this.checkInjection = deps.checkInjection ?? (async () => true);
  }

  get isHealthy(): boolean {
    return this._isHealthy;
  }
  get failureCount(): number {
    return this._failureCount;
  }
  get isWatching(): boolean {
    return this._watching;
  }

  async waitForStableRenderer(): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    let lastId: string | undefined;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const targets = await listTargets(this.port);
      const currentId = this.resolveRenderer(targets, this.rendererHint);
      if (currentId && currentId === lastId) {
        if (Date.now() - stableSince >= this.stableMs) {
          this.stableTargetId = currentId;
          return currentId;
        }
      } else {
        lastId = currentId;
        stableSince = Date.now();
      }
      await this.sleepFn(this.pollMs);
    }
    throw new Error(`waitForStableRenderer timed out after ${this.timeoutMs}ms`);
  }

  async startWatching(): Promise<void> {
    if (this._watching) return;
    const wsUrl = await this.getRendererWsUrl();
    if (!wsUrl) return;

    try {
      this.session = await connectEventCdp(wsUrl);
    } catch {
      this._failureCount++;
      return;
    }
    this._watching = true;
    this.installHandlers();
    this.healthTimer = setInterval(() => {
      void this.runHealthCheck();
    }, HEALTH_INTERVAL_MS);
  }

  async stopWatching(): Promise<void> {
    if (!this._watching) return;
    this._watching = false;
    if (this.recreateTimer) clearTimeout(this.recreateTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.session) {
      if (this.destroyHandler) this.session.off('Target.targetDestroyed', this.destroyHandler);
      if (this.createHandler) this.session.off('Target.targetCreated', this.createHandler);
      try {
        this.session.close();
      } catch {
        /* already closed */
      }
      this.session = null;
    }
    this.destroyHandler = null;
    this.createHandler = null;
  }

  private async getRendererWsUrl(): Promise<string | undefined> {
    const targets = await listTargets(this.port);
    const id = this.resolveRenderer(targets, this.rendererHint);
    return id ? targets.find((t) => t.id === id)?.webSocketDebuggerUrl : undefined;
  }

  private installHandlers(): void {
    if (!this.session) return;
    this.destroyHandler = (p: unknown) => {
      const tid = extractTargetId(p);
      if (tid && tid === this.stableTargetId) this.pendingOldId = tid;
    };
    this.createHandler = (p: unknown) => {
      const tid = extractTargetId(p);
      if (!tid) return;
      if (this.recreateTimer) clearTimeout(this.recreateTimer);
      this.recreateTimer = setTimeout(() => {
        this.recreateTimer = null;
        const oldId = this.pendingOldId;
        this.pendingOldId = null;
        if (oldId) void this.onRendererRecreated?.(oldId, tid);
      }, RECREATE_DEBOUNCE_MS);
    };
    this.session.on('Target.targetDestroyed', this.destroyHandler);
    this.session.on('Target.targetCreated', this.createHandler);
  }

  private async runHealthCheck(): Promise<void> {
    if (!this.stableTargetId) return;
    const targets = await listTargets(this.port);
    if (!targetExists(targets, this.stableTargetId)) return;
    if (await this.checkInjection(this.session)) return;
    this._isHealthy = false;
    await this.onInjectionLost?.();
    this._failureCount++;
    if (this._failureCount >= this.maxFailures) void this.stopWatching();
  }
}
