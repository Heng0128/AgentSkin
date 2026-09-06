// SPDX-License-Identifier: MPL-2.0

/**
 * # baseline-capture — native baseline CSS capture / replay / validation / apply cache
 *
 * Provides four co-located capabilities that form the production baseline pipeline:
 *
 *   captureBaselineCss ──▶ replayBaseline ──▶ probeNativeBaseline
 *         │                                        │
 *         ▼                                        ▼
 *   capture BaselineSnapshot ◀── probeThemeLive ◀──┘
 *         │
 *         ▼
 *   ApplyBaselineCache (LRU + TTL)
 *
 * ## Sub-module map
 *
 * | Section                   | Symbols                                                                 |
 * |---------------------------|-------------------------------------------------------------------------|
 * | baseline-css-capture      | `CapturedStyleSheet`, `BaselineCssCapture`, `BaselineCssOptions`,         |
 * |                           | `extractVarDependencies`, `definesVar`, `findStylesheetDefiningVar`,      |
 * |                           | `captureBaselineCss`, `captureBaselineCssOnPort`                         |
 * | baseline-css-replay       | `buildReplayCss`, `replayableComponents`, `replayBaseline`,               |
 * |                           | `stopReplay`, `captureReplayScreenshot`                                  |
 * | baseline-validator        | `BaselineProbe`, `FidelityDimension`, `FidelityVerdict`,                  |
 * |                           | `ValidateOptions`, `hexToRgb`, `normalizedColorDistance`,                 |
 * |                           | `assessFidelity`, `probeNativeBaseline`, `validateBaselineCss`            |
 * | apply-baseline            | `BaselineSnapshot`, `ApplyBaselineCache`, `APPLY_BASELINE_TTL_MS`,        |
 * |                           | `APPLY_BASELINE_LRU_CAPACITY`, `captureBaseline`, `probeThemeLive`,       |
 * |                           | `captureBaselineOnPort`, `probeThemeLiveOnPort`                           |
 *
 * > NOTE: Gate-only functions (`evaluateReplicationGate`, `isBaselineFresh`,
 * > `assessBaselineGate`, `GateVerdict`, `BaselineTruthMeta`) were test-only
 * > and have been inlined into `baseline-gate.test.ts`.
 */

import { toMessage } from '../../shared/errors';
import { SHEET_OWNED_FLAG } from '../../shared/injection-constants';
import { buildClearEngineInjectionExpression } from '../../shared/injection-runtime';
import type { AgentId } from '../../shared/types';
import { mainWarn } from '../logger';
import { type CdpSession, connectCdp } from './cdp-client';
import { findDomTargets } from './cdp-targets';
import { injectCssAdopted } from './injection/css-inject';
import { verifyTheme } from './injection/shared';
import {
  acquireSession,
  type CdpSessionPool,
  releaseSession,
  type SessionHandle,
  targetKeyFor,
} from './session-pool';

// ===========================================================================
// § baseline-css-capture — CSS rule-level native baseline capture (RFC §6/§8)
// ===========================================================================

/** CDP `CSS.getStyleSheetText` stylesheet original-text entry. */
export interface CapturedStyleSheet {
  /** styleSheetId (CDP CSS domain handle, session-scoped). */
  styleSheetId: string;
  /** Which controlled component this stylesheet was captured for (first match). */
  firstMatchedFor: string;
  /** Original CSS text. */
  cssText: string;
  /** Selectors matched in this sheet (deduped, for traceability). */
  matchedSelectors: string[];
}

/** Result of a full baseline CSS capture. */
export interface BaselineCssCapture {
  appId: AgentId;
  /** Page URL at capture time. */
  url: string;
  /** Deduplicated stylesheet originals by styleSheetId. */
  stylesheets: CapturedStyleSheet[];
  /** Detected var(--x) dependency names (even if unsuccessfully re-captured). */
  varDependencies: string[];
  /**
   * Whether `Debugger.setJavaScriptEnabled(false)` succeeded — determines if
   * this capture is a "trusted baseline" (true = page was frozen, no JS tampering;
   * false = degraded capture).
   */
  jsFrozen: boolean;
  /** Whether the capture completed fully (false = degraded / partial failure). */
  complete: boolean;
  capturedAt: number;
}

/** Capture configuration. */
export interface BaselineCssOptions {
  /** Semantic component selectors (anchor nodes). Defaults to `:root`. */
  componentSelectors?: string[];
  /**
   * Allowed CSS origins. Defaults to `['regular']` (author styles only),
   * excluding `user-agent`/`user` to filter third-party/extension styles.
   */
  allowedOrigins?: string[];
  /** Whether to freeze page JS. Default true (anti-tamper guard). */
  freezeJs?: boolean;
}

// ---------------------------------------------------------------------------
// Pure logic helpers (unit-testable)
// ---------------------------------------------------------------------------

/** Extract `var(--name)` custom-property names from CSS text. */
export function extractVarDependencies(cssText: string): string[] {
  const names = new Set<string>();
  const re = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
  let m: RegExpExecArray | null = re.exec(cssText);
  while (m !== null) {
    if (m[1]) names.add(m[1]);
    m = re.exec(cssText);
  }
  return [...names];
}

/** Check whether CSS text already defines a given custom property (`--x:`). */
export function definesVar(cssText: string, varName: string): boolean {
  const re = new RegExp(`(^|[;{\\n])\\s*${escapeVar(varName)}\\s*:`, 'm');
  return re.test(cssText);
}

/** Find the stylesheet (among captured ones) that defines a given var. */
export function findStylesheetDefiningVar(
  stylesheets: CapturedStyleSheet[],
  varName: string,
): CapturedStyleSheet | null {
  return stylesheets.find((s) => definesVar(s.cssText, varName)) ?? null;
}

function escapeVar(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// CDP capture internals
// ---------------------------------------------------------------------------

interface CdpMatchedRule {
  rule: { styleSheetId?: string; origin?: string };
}

interface GetMatchedStylesResult {
  matchedCSSRules?: CdpMatchedRule[];
}

interface GetStyleSheetTextResult {
  text: string;
}

interface GetDocumentResult {
  root?: { nodeId?: number };
}

interface QuerySelectorResult {
  nodeId?: number;
}

/** Open a session to the main DOM-bearing target (capture path). */
async function openCaptureDomSession(port: number): Promise<CdpSession | null> {
  try {
    const targets = await findDomTargets(port);
    if (!targets.length || !targets[0].webSocketDebuggerUrl) return null;
    return await connectCdp(targets[0].webSocketDebuggerUrl, 3000);
  } catch (error) {
    mainWarn('BaselineCss.Connect', `open main DOM session failed: ${toMessage(error)}`);
    return null;
  }
}

function closeSafely(session: CdpSession): void {
  try {
    session.close();
  } catch {
    // already closed
  }
}

// ---------------------------------------------------------------------------
// Capture function
// ---------------------------------------------------------------------------

/**
 * Execute baseline CSS capture on an already-open session. Never throws —
 * returns a partial result with `complete=false` on any step failure.
 */
export async function captureBaselineCss(
  session: CdpSession,
  appId: AgentId,
  opts: BaselineCssOptions = {},
): Promise<BaselineCssCapture> {
  const selectors = opts.componentSelectors?.length ? opts.componentSelectors : [':root'];
  const allowedOrigins = new Set(opts.allowedOrigins ?? ['regular']);
  const freezeJs = opts.freezeJs !== false;

  const stylesheets = new Map<string, CapturedStyleSheet>();
  const matchedSelectors = new Map<string, string[]>();
  let varDependencies = new Set<string>();
  let jsFrozen = false;
  let complete = true;

  if (freezeJs) {
    try {
      await session.send('Debugger.setJavaScriptEnabled', { value: false });
      jsFrozen = true;
    } catch (error) {
      mainWarn(
        'BaselineCss.Freeze',
        `Debugger freeze failed (degraded capture): ${toMessage(error)}`,
      );
      jsFrozen = false;
    }
  }

  try {
    try {
      await session.send('DOM.enable');
    } catch {
      /* best-effort */
    }
    await session.send('CSS.enable');
    const doc = await session.send<GetDocumentResult>('DOM.getDocument', {
      depth: 1,
      pierce: false,
    });
    const rootNodeId = doc.root?.nodeId ?? 0;
    if (typeof rootNodeId !== 'number' || rootNodeId <= 0) {
      return buildCaptureResult(appId, jsFrozen, varDependencies, stylesheets, false);
    }

    for (const selector of selectors) {
      const nodeId = await resolveNodeId(session, rootNodeId, selector);
      if (nodeId == null) continue;
      const matched = await collectMatchedStyles(session, nodeId);
      for (const rule of matched) {
        const sheetId = rule.rule?.styleSheetId;
        const origin = rule.rule?.origin ?? 'regular';
        if (!sheetId) continue;
        if (!allowedOrigins.has(origin)) continue;
        const list = matchedSelectors.get(sheetId) ?? [];
        if (!list.includes(selector)) list.push(selector);
        matchedSelectors.set(sheetId, list);
      }
    }

    for (const [sheetId, selectorsHit] of matchedSelectors) {
      const text = await fetchStylesheetText(session, sheetId);
      if (text == null) {
        complete = false;
        continue;
      }
      stylesheets.set(sheetId, {
        styleSheetId: sheetId,
        firstMatchedFor: selectorsHit[0] ?? 'unknown',
        cssText: text,
        matchedSelectors: selectorsHit,
      });
      varDependencies = new Set([...varDependencies, ...extractVarDependencies(text)]);
    }

    const orphanVars = [...varDependencies].filter(
      (v) => !findStylesheetDefiningVar([...stylesheets.values()], v),
    );
    if (orphanVars.length) {
      const rootNodeId2 = await resolveNodeId(session, rootNodeId, ':root');
      if (rootNodeId2 != null) {
        const rootMatched = await collectMatchedStyles(session, rootNodeId2);
        for (const rule of rootMatched) {
          const sheetId = rule.rule?.styleSheetId;
          const origin = rule.rule?.origin ?? 'regular';
          if (!sheetId || stylesheets.has(sheetId) || !allowedOrigins.has(origin)) continue;
          const text = await fetchStylesheetText(session, sheetId);
          if (text == null) continue;
          const sheet: CapturedStyleSheet = {
            styleSheetId: sheetId,
            firstMatchedFor: ':root (var dep)',
            cssText: text,
            matchedSelectors: [':root'],
          };
          stylesheets.set(sheetId, sheet);
          for (const dep of extractVarDependencies(text)) varDependencies.add(dep);
        }
      }
    }
  } catch (error) {
    mainWarn('BaselineCss.Capture', `capture degraded: ${toMessage(error)}`);
    complete = false;
  } finally {
    if (freezeJs) {
      try {
        await session.send('Debugger.setJavaScriptEnabled', { value: true });
      } catch {
        /* best-effort */
      }
    }
  }

  const result = buildCaptureResult(appId, jsFrozen, varDependencies, stylesheets, complete);
  return result;
}

function buildCaptureResult(
  appId: AgentId,
  jsFrozen: boolean,
  varDependencies: Set<string>,
  stylesheets: Map<string, CapturedStyleSheet>,
  complete: boolean,
): BaselineCssCapture {
  return {
    appId,
    url: '',
    stylesheets: [...stylesheets.values()],
    varDependencies: [...varDependencies],
    jsFrozen,
    complete,
    capturedAt: Date.now(),
  };
}

async function resolveNodeId(
  session: CdpSession,
  rootNodeId: number,
  selector: string,
): Promise<number | null> {
  try {
    const res = await session.send<QuerySelectorResult>('DOM.querySelector', {
      nodeId: rootNodeId,
      selector,
    });
    return typeof res.nodeId === 'number' && res.nodeId > 0 ? res.nodeId : null;
  } catch (error) {
    mainWarn('BaselineCss.Query', `querySelector(${selector}) failed: ${toMessage(error)}`);
    return null;
  }
}

async function collectMatchedStyles(
  session: CdpSession,
  nodeId: number,
): Promise<CdpMatchedRule[]> {
  try {
    const res = await session.send<GetMatchedStylesResult>('CSS.getMatchedStylesForNode', {
      nodeId,
    });
    return res.matchedCSSRules ?? [];
  } catch (error) {
    mainWarn('BaselineCss.Match', `getMatchedStylesForNode failed: ${toMessage(error)}`);
    return [];
  }
}

async function fetchStylesheetText(session: CdpSession, sheetId: string): Promise<string | null> {
  try {
    const res = await session.send<GetStyleSheetTextResult>('CSS.getStyleSheetText', {
      styleSheetId: sheetId,
    });
    return typeof res.text === 'string' ? res.text : null;
  } catch (error) {
    mainWarn('BaselineCss.Text', `getStyleSheetText(${sheetId}) failed: ${toMessage(error)}`);
    return null;
  }
}

/**
 * Convenience entry: open the main DOM session on a port and capture baseline CSS.
 * Returns null when no session / all steps fail.
 */
export async function captureBaselineCssOnPort(
  port: number,
  appId: AgentId,
  opts: BaselineCssOptions = {},
): Promise<BaselineCssCapture | null> {
  const session = await openCaptureDomSession(port);
  if (!session) return null;
  try {
    const capture = await captureBaselineCss(session, appId, opts);
    try {
      const raw = await session.evaluate('location.href');
      if (raw && raw !== 'null') capture.url = raw;
    } catch {
      /* best-effort */
    }
    return capture;
  } finally {
    closeSafely(session);
  }
}

// ===========================================================================
// § baseline-css-replay — exact CSS replay for native baseline (RFC §6/§8)
// ===========================================================================

/**
 * Concatenate captured stylesheets in original order into a replayable CSS string.
 */
export function buildReplayCss(
  capture: Pick<BaselineCssCapture, 'stylesheets'>,
  opts: { onlyFor?: string } = {},
): string {
  const blocks = capture.stylesheets
    .filter((s) => typeof s.cssText === 'string' && s.cssText.length > 0)
    .filter((s) => {
      if (!opts.onlyFor) return true;
      return s.firstMatchedFor === opts.onlyFor || s.matchedSelectors.includes(opts.onlyFor);
    })
    .map((s) => s.cssText);
  return blocks.join('\n');
}

/** Compute the set of semantic components a replay can cover. */
export function replayableComponents(capture: Pick<BaselineCssCapture, 'stylesheets'>): string[] {
  const set = new Set<string>();
  for (const s of capture.stylesheets) {
    if (s.firstMatchedFor && s.firstMatchedFor !== 'unknown') set.add(s.firstMatchedFor);
    for (const sel of s.matchedSelectors) set.add(sel);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// CDP replay
// ---------------------------------------------------------------------------

/**
 * Replay baseline CSS: clear engine injection first, then inject captured native
 * rules. Returns false when clear or injection fails (best-effort, never throws).
 */
export async function replayBaseline(
  session: CdpSession,
  capture: Pick<BaselineCssCapture, 'stylesheets'> | BaselineCssCapture,
  opts: { onlyFor?: string } = {},
): Promise<boolean> {
  const css = buildReplayCss(capture, opts);
  if (!css) {
    mainWarn('BaselineCss.Replay', 'replay aborted: empty replay CSS (no captured stylesheets)');
    return false;
  }
  try {
    await session.evaluate(buildClearEngineInjectionExpression());
  } catch (error) {
    mainWarn('BaselineCss.Replay', `clear engine injection failed: ${toMessage(error)}`);
  }
  return injectCssAdopted(session, css);
}

/** Undo replay: clear all AgentSkin-owned stylesheets, restore original state. */
export async function stopReplay(session: CdpSession): Promise<void> {
  try {
    await session.evaluate(buildClearEngineInjectionExpression());
  } catch (error) {
    mainWarn('BaselineCss.Stop', `stop replay failed: ${toMessage(error)}`);
  }
}

/**
 * Capture a screenshot of the main DOM target and write it to disk.
 * Returns the file URL (for manual / automated visual comparison).
 */
export async function captureReplayScreenshot(port: number, output: string): Promise<string> {
  const targets = await findDomTargets(port);
  if (!targets.length || !targets[0].webSocketDebuggerUrl) {
    throw new Error(`baseline replay screenshot: no DOM target on port ${port}`);
  }
  const session = await connectCdp(targets[0].webSocketDebuggerUrl, 3000);
  try {
    const { pathToFileURL } = await import('node:url');
    const fsp = await import('node:fs/promises').then((m) => m.default ?? m);
    const path = await import('node:path').then((m) => m.default ?? m);

    const result = await session.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const absolute = path.resolve(output);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, Buffer.from(result.data, 'base64'));
    return pathToFileURL(absolute).href;
  } finally {
    try {
      session.close();
    } catch {
      /* already closed */
    }
  }
}

// ===========================================================================
// § baseline-validator — native baseline replication validator (RFC §6/§8)
// ===========================================================================

/**
 * A lightweight snapshot of key computed styles captured via CDP `Runtime.evaluate`.
 */
export interface BaselineProbe {
  /** Root element computed background-color ('rgb(...)' or ''). */
  rootBg: string;
  /** Root element computed color. */
  rootColor: string;
  /** Root element computed overflow-x/y — sidebar layout invariant. */
  rootOverflowHidden: boolean;
  /** Number of AgentSkin-owned adopted stylesheets. */
  adoptedSheetCount: number;
  /** Whether the semantic carrier anchor node is present. */
  carrierPresent: boolean;
}

/** A single fidelity dimension difference. */
export interface FidelityDimension {
  key: keyof BaselineProbe;
  /** Whether this dimension passed within tolerance. */
  pass: boolean;
  /** Normalized difference (0..1, 0=identical). Non-color dims use 0/1. */
  diff: number;
}

/** Fidelity verdict. */
export interface FidelityVerdict {
  /** Replication succeeded overall. */
  pass: boolean;
  /** Weighted match ratio (pass dims / total dims). */
  matchRatio: number;
  /** Degradation triggered (replication failed). */
  degraded: boolean;
  /** Per-dimension breakdown. */
  dimensions: FidelityDimension[];
  /** Probe/replay error message (diagnostic only). */
  gateError?: string;
}

/** Tunable thresholds for validation. */
export interface ValidateOptions {
  /** Match ratio threshold for pass (default 0.8). */
  minMatchRatio?: number;
  /** Color-dimension normalized distance tolerance (default ~0.05). */
  colorTolerance?: number;
  /** Severe color drift threshold — hard gate (default ~0.5). */
  severeColorTolerance?: number;
}

// ---------------------------------------------------------------------------
// Pure color-distance logic
// ---------------------------------------------------------------------------

/** Parse '#rgb' / '#rrggbb' hex into RGB; returns null on parse failure. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().toLowerCase();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => `${c}${c}`)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return {
    r: parseInt(`${h[0]}${h[1]}`, 16),
    g: parseInt(`${h[2]}${h[3]}`, 16),
    b: parseInt(`${h[4]}${h[5]}`, 16),
  };
}

/**
 * Normalized RGB distance: Euclidean distance in the 0..1 cube (0=same, 1=extreme).
 * Unparseable inputs return 1 (maximally conservative).
 */
export function normalizedColorDistance(a: string, b: string): number {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return 1;
  const dr = pa.r - pb.r;
  const dg = pa.g - pb.g;
  const db = pa.b - pb.b;
  return Math.sqrt((dr * dr + dg * dg + db * db) / (3 * 255 * 255));
}

function parseColor(input: string): { r: number; g: number; b: number } | null {
  const s = (input ?? '').trim();
  const hex = hexToRgb(s);
  if (hex) return hex;
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  if (!m) return null;
  const clamp = (v: number): number => Math.max(0, Math.min(255, v));
  return { r: clamp(Number(m[1])), g: clamp(Number(m[2])), b: clamp(Number(m[3])) };
}

// ---------------------------------------------------------------------------
// Pure fidelity assessment
// ---------------------------------------------------------------------------

/**
 * Assess "replayed probe" fidelity against "baseline truth" (pure function).
 */
export function assessFidelity(
  baseline: BaselineProbe,
  replayed: BaselineProbe,
  opts: ValidateOptions = {},
): FidelityVerdict {
  const colorTolerance = opts.colorTolerance ?? 0.05;
  const minMatchRatio = opts.minMatchRatio ?? 0.8;
  const severeColorTolerance = opts.severeColorTolerance ?? 0.5;

  const bgDiff = normalizedColorDistance(baseline.rootBg, replayed.rootBg);
  const colorDiff = normalizedColorDistance(baseline.rootColor, replayed.rootColor);
  const flushOverflow = baseline.rootOverflowHidden === replayed.rootOverflowHidden;
  const flushCarrier = baseline.carrierPresent === replayed.carrierPresent;
  const sheetMounted = replayed.adoptedSheetCount >= 1;
  const severeColor = bgDiff > severeColorTolerance || colorDiff > severeColorTolerance;

  const dimensions: FidelityDimension[] = [
    { key: 'rootBg', pass: bgDiff <= colorTolerance, diff: bgDiff },
    { key: 'rootColor', pass: colorDiff <= colorTolerance, diff: colorDiff },
    { key: 'rootOverflowHidden', pass: flushOverflow, diff: flushOverflow ? 0 : 1 },
  ];

  const fatal: FidelityDimension[] = [
    { key: 'carrierPresent', pass: flushCarrier, diff: flushCarrier ? 0 : 1 },
    { key: 'adoptedSheetCount', pass: sheetMounted, diff: sheetMounted ? 0 : 1 },
  ];
  dimensions.push(...fatal);

  const passCount = dimensions.filter((d) => d.pass).length;
  const matchRatio = dimensions.length ? passCount / dimensions.length : 0;

  if (!flushCarrier || !sheetMounted || severeColor) {
    return { pass: false, matchRatio, degraded: true, dimensions };
  }

  const ok = matchRatio >= minMatchRatio;
  return { pass: ok, matchRatio, degraded: !ok, dimensions };
}

// ---------------------------------------------------------------------------
// CDP probe expression
// ---------------------------------------------------------------------------

/** Execute a lightweight probe in the page; throws on failure (caught by orchestrator). */
export async function probeNativeBaseline(session: CdpSession): Promise<BaselineProbe> {
  const raw = await session.evaluate(`(() => {
    if (!document || !document.documentElement) throw new Error('page not ready');
    const root = getComputedStyle(document.documentElement);
    const carrier = {
      any: ['.panel-container','.agents-layout-root','.teams-container','#root','main.main-surface','body']
        .map(s => { try { return !!document.querySelector(s); } catch { return false; } }),
    }['any'].some(Boolean);
    return JSON.stringify({
      rootBg: root.backgroundColor,
      rootColor: root.color,
      rootOverflowHidden: root.overflowX === 'hidden' || root.overflowY === 'hidden',
      adoptedSheetCount: (document.adoptedStyleSheets || []).filter(s => s.__agentskin_owned === true).length,
      carrierPresent: carrier,
    });
  })()`);
  return JSON.parse(raw) as BaselineProbe;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Validate "can we replicate the native baseline":
 *   1. Probe current (native) state.
 *   2. Replay captured native rules.
 *   3. Probe replayed state.
 *   4. assessFidelity.
 *   5. finally: stopReplay rollback.
 *
 * Returns a verdict; any step failure yields `degraded=true` (conservative).
 */
export async function validateBaselineCss(
  session: CdpSession,
  capture: BaselineCssCapture,
  opts: ValidateOptions = {},
): Promise<FidelityVerdict> {
  let baseline: BaselineProbe | null = null;
  let replayed: BaselineProbe | null = null;
  try {
    baseline = await probeNativeBaseline(session);
  } catch (error) {
    mainWarn('BaselineCss.Validate', `baseline probe failed, degrading: ${toMessage(error)}`);
    return { pass: false, matchRatio: 0, degraded: true, dimensions: [] };
  }

  try {
    const replayedOk = await replayBaseline(session, capture);
    if (!replayedOk) {
      mainWarn('BaselineCss.Validate', 'replay failed (no CSS adopted), degrading');
      return { pass: false, matchRatio: 0, degraded: true, dimensions: [] };
    }
    replayed = await probeNativeBaseline(session);
  } catch (error) {
    mainWarn('BaselineCss.Validate', `replay/probe failed, degrading: ${toMessage(error)}`);
    return {
      pass: false,
      matchRatio: 0,
      degraded: true,
      dimensions: [],
    };
  } finally {
    try {
      await stopReplay(session);
    } catch (error) {
      mainWarn('BaselineCss.Validate', `stopReplay failed: ${toMessage(error)}`);
    }
  }

  return assessFidelity(baseline, replayed, opts);
}

// ===========================================================================
// § apply-baseline — BaselineSnapshot + semanticNodes memory cache (RFC §4.5/§4.6)
// ===========================================================================

/**
 * Lightweight fingerprint of an applied theme on one agent+page.
 */
export interface BaselineSnapshot {
  appId: AgentId;
  themeId: string;
  /** Page URL at capture time (invalidation key component). */
  url: string;
  accent: string;
  adoptedSheetCount: number;
  heroBlobActive: boolean;
  semanticNodeCount: number;
  capturedAt: number;
}

export const APPLY_BASELINE_TTL_MS = 60_000;
export const APPLY_BASELINE_LRU_CAPACITY = 3;

// ---------------------------------------------------------------------------
// ApplyBaselineCache
// ---------------------------------------------------------------------------

/**
 * Per-agent LRU cache for `BaselineSnapshot`.
 */
export class ApplyBaselineCache {
  private readonly byAgent = new Map<AgentId, Map<string, BaselineSnapshot>>();
  /** LRU order per agent (most-recently-used at the end). */
  private readonly recency = new Map<AgentId, string[]>();

  private key(appId: AgentId, url: string, themeId: string): string {
    return `${appId}|${url}|${themeId}`;
  }

  /** Read + LRU touch + TTL check. Returns null on miss/expiry. */
  get(appId: AgentId, url: string, themeId: string): BaselineSnapshot | null {
    const agentCache = this.byAgent.get(appId);
    if (!agentCache) return null;
    const key = this.key(appId, url, themeId);
    const snap = agentCache.get(key);
    if (!snap) return null;
    if (Date.now() - snap.capturedAt > APPLY_BASELINE_TTL_MS) {
      this.removeKey(appId, key);
      return null;
    }
    this.touch(appId, key);
    return snap;
  }

  /** Insert (or refresh) a snapshot, applying LRU eviction if over capacity. */
  put(snap: BaselineSnapshot): void {
    let agentCache = this.byAgent.get(snap.appId);
    if (!agentCache) {
      agentCache = new Map();
      this.byAgent.set(snap.appId, agentCache);
      this.recency.set(snap.appId, []);
    }
    const key = this.key(snap.appId, snap.url, snap.themeId);
    agentCache.set(key, snap);
    this.touch(snap.appId, key);
    this.evict(snap.appId);
  }

  /**
   * Invalidate entries for an agent. When `themeId`/`url` are given, only matching
   * entries are removed; with neither, the whole agent's cache is cleared.
   */
  invalidate(appId: AgentId, themeId?: string, url?: string): void {
    const agentCache = this.byAgent.get(appId);
    if (!agentCache) return;
    if (themeId === undefined && url === undefined) {
      this.removeAll(appId);
      return;
    }
    for (const [key, snap] of agentCache) {
      if (themeId !== undefined && snap.themeId !== themeId) continue;
      if (url !== undefined && snap.url !== url) continue;
      this.removeKey(appId, key);
    }
  }

  clearAgent(appId: AgentId): void {
    this.removeAll(appId);
  }

  size(appId: AgentId): number {
    return this.byAgent.get(appId)?.size ?? 0;
  }

  private touch(appId: AgentId, key: string): void {
    const list = this.recency.get(appId) ?? [];
    const idx = list.indexOf(key);
    if (idx >= 0) list.splice(idx, 1);
    list.push(key);
    this.recency.set(appId, list);
  }

  private removeKey(appId: AgentId, key: string): void {
    this.byAgent.get(appId)?.delete(key);
    const list = this.recency.get(appId);
    if (list) {
      const idx = list.indexOf(key);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  private evict(appId: AgentId): void {
    const list = this.recency.get(appId);
    const agentCache = this.byAgent.get(appId);
    if (!list || !agentCache) return;
    while (list.length > APPLY_BASELINE_LRU_CAPACITY) {
      const oldest = list.shift();
      if (oldest === undefined) break;
      agentCache.delete(oldest);
    }
  }

  private removeAll(appId: AgentId): void {
    this.byAgent.delete(appId);
    this.recency.delete(appId);
  }
}

// ---------------------------------------------------------------------------
// Capture + probe
// ---------------------------------------------------------------------------

function buildBaselineProbeExpr(): string {
  return `(() => {
    if (!document || !document.documentElement) return JSON.stringify(null);
    const cs = getComputedStyle(document.documentElement);
    const root = document.getElementById('root') || document.body;
    const rootBg = getComputedStyle(root).backgroundImage || '';
    const bodyBg = getComputedStyle(document.body).backgroundImage || '';
    const adopted = (document.adoptedStyleSheets || []).filter(s => s.${SHEET_OWNED_FLAG}).length;
    return JSON.stringify({
      url: location.href,
      accent: cs.getPropertyValue('--agentskin-accent').trim(),
      adoptedSheetCount: adopted,
      heroBlobActive: rootBg.includes('blob:') || bodyBg.includes('blob:'),
      semanticNodeCount: document.querySelectorAll('*').length,
    });
  })()`;
}

/**
 * Runtime type-guard for a parsed baseline object from CDP evaluate.
 */
function isBaselineProbeResult(
  value: unknown,
): value is Omit<BaselineSnapshot, 'appId' | 'themeId' | 'capturedAt'> {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.url === 'string' &&
    typeof v.accent === 'string' &&
    typeof v.adoptedSheetCount === 'number' &&
    Number.isFinite(v.adoptedSheetCount) &&
    typeof v.heroBlobActive === 'boolean' &&
    typeof v.semanticNodeCount === 'number' &&
    Number.isFinite(v.semanticNodeCount)
  );
}

/**
 * Capture a `BaselineSnapshot` from an already-open session. Returns null on
 * any CDP/eval failure (best-effort — never throws).
 */
export async function captureBaseline(
  session: CdpSession,
  appId: AgentId,
  themeId: string,
): Promise<BaselineSnapshot | null> {
  try {
    const raw = await session.evaluate(buildBaselineProbeExpr());
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null) return null; // page not ready — clean degraded, no cache seed
    if (!isBaselineProbeResult(parsed)) {
      mainWarn('Baseline.Capture', 'baseline probe result failed type-guard — returning null');
      return null;
    }
    return { ...parsed, appId, themeId, capturedAt: Date.now() };
  } catch (error) {
    mainWarn('Baseline.Capture', `baseline capture failed: ${toMessage(error)}`);
    return null;
  }
}

/**
 * §4.6 light probe: verify the theme is actually live on an open session.
 */
export async function probeThemeLive(session: CdpSession): Promise<boolean> {
  try {
    const verification = await verifyTheme(session);
    return verification !== null && verification.adoptedSheetCount > 0;
  } catch (error) {
    mainWarn('Baseline.Probe', `theme-live probe failed: ${toMessage(error)}`);
    return false;
  }
}

/**
 * Acquire (or one-shot-connect) a session to the main DOM-bearing target.
 */
async function openApplyDomSession(
  port: number,
  appId: AgentId,
  pool?: CdpSessionPool,
): Promise<{ session: CdpSession | null; targetKey: string; pooled: boolean }> {
  try {
    const targets = await findDomTargets(port);
    if (!targets.length || !targets[0].webSocketDebuggerUrl) {
      return { session: null, targetKey: '', pooled: false };
    }
    const target = targets[0];
    const targetKey = targetKeyFor(target.id, target.webSocketDebuggerUrl);
    const handle: SessionHandle = await acquireSession(pool, appId, targetKey, () =>
      connectCdp(target.webSocketDebuggerUrl!, 3000),
    );
    return { session: handle.session, targetKey, pooled: handle.pooled };
  } catch (error) {
    mainWarn('Baseline.Connect', `open main DOM session failed: ${toMessage(error)}`);
    return { session: null, targetKey: '', pooled: false };
  }
}

/**
 * Open a session, capture a baseline, and release. Returns null when no DOM
 * target is reachable or capture fails.
 */
export async function captureBaselineOnPort(
  port: number,
  appId: AgentId,
  themeId: string,
  pool?: CdpSessionPool,
): Promise<BaselineSnapshot | null> {
  const { session, targetKey, pooled } = await openApplyDomSession(port, appId, pool);
  if (!session) return null;
  try {
    return await captureBaseline(session, appId, themeId);
  } finally {
    if (pooled) {
      releaseSession(pool, appId, targetKey);
    } else {
      closeSafely(session);
    }
  }
}

/**
 * Open a session on a port and probe whether the theme is live.
 */
export async function probeThemeLiveOnPort(
  port: number,
  appId: AgentId,
  pool?: CdpSessionPool,
): Promise<boolean> {
  const { session, targetKey, pooled } = await openApplyDomSession(port, appId, pool);
  if (!session) return false;
  try {
    return await probeThemeLive(session);
  } finally {
    if (pooled) {
      releaseSession(pool, appId, targetKey);
    } else {
      closeSafely(session);
    }
  }
}
