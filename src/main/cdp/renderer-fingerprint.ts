// SPDX-License-Identifier: MPL-2.0

/**
 * Multi-renderer fingerprinting for AgentSkin's six adapters.
 *
 * Each adapter declares `primaryHints` (main window) and `secondaryHints`
 * (auxiliary surfaces). `identifyRenderers` classifies CDP targets into
 * primary / secondary / ignored using three-tier matching:
 *   1. exact  — url === hint
 *   2. substring — url.includes(hint)
 *   3. regex  — /hint/ test
 *
 * `planInjectionOrder` produces an ordered plan: primary first (delay 0),
 * secondary delayed (default 500ms). Pure functions only — no I/O.
 */

import type { AgentId } from '../../shared/types/agent';

export interface CdpTargetInfo {
  id: string;
  type?: string;
  title?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
  [key: string]: unknown;
}

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
