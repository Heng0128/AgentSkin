// SPDX-License-Identifier: MPL-2.0

/**
 * # selector-validator
 *
 * CDP-based selector validation service.
 * Probes CSS selectors against a live agent session via Runtime.evaluate.
 *
 * ## Probe strategy
 *
 *   1. Syntax check — `document.createElement('div').querySelector(sel)` in a
 *      detached element. If it throws, the selector is 'invalid'.
 *   2. Match count — `document.querySelectorAll(sel).length` in the live page.
 *      0 → 'miss', >0 → 'hit'.
 *   3. Bounding box — on hit, `el.getBoundingClientRect()` for the first match.
 *
 * All three steps run inside a single IIFE per `probeSelector` call so we
 * minimize round-trips. The IIFE returns JSON; the service parses and shapes
 * the structured result.
 *
 * ## Concurrency
 *
 * `validateSelectors` runs probes with a configurable concurrency cap
 * (default 4) to avoid overwhelming the CDP socket with parallel
 * Runtime.evaluate calls.
 */

import type { SelectorProbeResult, SelectorValidationReport } from '@shared/types/selector-probe';
import type { CdpSession } from './cdp-client';

/** Default concurrency cap for batch validation. */
const DEFAULT_MAX_CONCURRENT = 4;

/** Hard upper bound for concurrent CDP probes to prevent socket flooding. */
const MAX_CONCURRENT_HARD_LIMIT = 16;

// ---------------------------------------------------------------------------
// Single-selector probe
// ---------------------------------------------------------------------------

/**
 * Validate a single selector against the target session.
 *
 * Uses one Runtime.evaluate call that:
 *   1. Checks selector syntax on a detached element.
 *   2. Counts matches in the live document.
 *   3. Captures the bounding box of the first match (if any).
 *
 * The IIFE never throws for valid probe outcomes — it always returns a
 * JSON-serializable result. Only CDP-level errors (timeout, socket close)
 * cause this function to reject.
 */
export async function probeSelector(
  session: CdpSession,
  selector: string,
): Promise<SelectorProbeResult> {
  const raw = await session.evaluate(`(() => {
    const sel = ${JSON.stringify(selector)};
    // 1. Syntax check on a detached element.
    try {
      document.createElement('div').querySelector(sel);
    } catch (e) {
      return JSON.stringify({
        kind: 'invalid',
        count: 0,
        error: String(e instanceof Error ? e.message : e),
      });
    }
    // 2. Match count in the live document.
    let count = 0;
    try {
      count = document.querySelectorAll(sel).length;
    } catch {
      // Should not happen after the detached check, but be defensive.
      return JSON.stringify({
        kind: 'invalid',
        count: 0,
        error: 'querySelectorAll threw after detached check passed',
      });
    }
    if (count === 0) {
      return JSON.stringify({ kind: 'miss', count: 0 });
    }
    // 3. Bounding box of the first match.
    let boundingBox: { x: number; y: number; width: number; height: number } | undefined;
    try {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        boundingBox = {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }
    } catch {
      // Bounding box is best-effort; omit on failure.
    }
    return JSON.stringify({ kind: 'hit', count, boundingBox });
  })()`);

  let parsed: {
    kind: 'hit' | 'miss' | 'invalid';
    count: number;
    boundingBox?: { x: number; y: number; width: number; height: number };
    error?: string;
  };

  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    // CDP returned malformed JSON — treat as miss with context.
    return {
      selector,
      kind: 'miss',
      count: 0,
      error: 'failed to parse CDP evaluate result',
    };
  }

  return {
    selector,
    kind: parsed.kind,
    count: parsed.count,
    boundingBox: parsed.boundingBox,
    error: parsed.error,
  };
}

// ---------------------------------------------------------------------------
// Batch validation
// ---------------------------------------------------------------------------

/**
 * Validate multiple selectors for an agent with bounded concurrency.
 *
 * Probes run with a module-level semaphore (maxConcurrent) to avoid
 * overwhelming the CDP socket. Results preserve input order regardless
 * of completion order.
 *
 * Individual probe failures (CDP timeout, socket error) are captured as
 * `timeout` results rather than rejecting the entire batch — callers get
 * a complete report with per-selector status.
 */
export async function validateSelectors(
  session: CdpSession,
  agentId: string,
  selectors: string[],
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
): Promise<SelectorValidationReport> {
  // Clamp concurrency to hard limit to prevent socket flooding.
  const concurrency = Math.min(Math.max(1, maxConcurrent), MAX_CONCURRENT_HARD_LIMIT);
  const results: SelectorProbeResult[] = new Array(selectors.length);

  // Semaphore-based concurrency limiter.
  let active = 0;
  let cursor = 0;

  return new Promise<SelectorValidationReport>((resolve) => {
    const next = (): void => {
      // All slots dispatched and nothing active → done.
      if (cursor >= selectors.length && active === 0) {
        resolve(buildReport(agentId, results));
        return;
      }
      // Dispatch up to concurrency probes.
      while (active < concurrency && cursor < selectors.length) {
        const index = cursor++;
        active++;
        probeSelector(session, selectors[index])
          .then((result) => {
            results[index] = result;
          })
          .catch((err: unknown) => {
            // CDP-level failure → mark as timeout with error context.
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[selector-validator] probe failed for "${selectors[index]}": ${message}`);
            results[index] = {
              selector: selectors[index],
              kind: 'timeout',
              count: 0,
              error: message,
            };
          })
          .finally(() => {
            active--;
            next();
          });
      }
    };

    next();
  });
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

function buildReport(agentId: string, results: SelectorProbeResult[]): SelectorValidationReport {
  let hit = 0;
  let miss = 0;
  let invalid = 0;
  let timeout = 0;

  for (const r of results) {
    switch (r.kind) {
      case 'hit':
        hit++;
        break;
      case 'miss':
        miss++;
        break;
      case 'invalid':
        invalid++;
        break;
      case 'timeout':
        timeout++;
        break;
    }
  }

  return {
    agentId,
    results,
    summary: { total: results.length, hit, miss, invalid, timeout },
    timestamp: Date.now(),
  };
}
