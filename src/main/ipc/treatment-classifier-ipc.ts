// SPDX-License-Identifier: MPL-2.0

/**
 * # treatment-classifier-ipc
 *
 * IPC handlers bridging the renderer to the treatment-classifier module.
 * The renderer sends simplified profiles/verdicts (matching the preload
 * contract); this handler translates them to/from the full internal types
 * expected by `treatment-classifier.ts`.
 *
 * The classify result is cached so that `TREATMENT_CSS` can reconstruct the
 * full `TreatmentVerdict[]` (with frost params, surface color, etc.) needed
 * by `buildTreatmentCss()` — the preload only carries a lightweight verdict
 * shape across the bridge.
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { ComponentProfile } from '../profile/native-profile';
import {
  buildTreatmentCss,
  classifyAll,
  type TreatmentVerdict,
} from '../profile/treatment-classifier';
import { withMonitoredTimeout } from './with-monitored-timeout';

/** Simplified profile shape received from the renderer via preload. */
interface RendererProfile {
  role: string;
  ref: string;
  areaRatio: number;
  hasText: boolean;
  zIndex: number;
}

/** Simplified verdict shape received from the renderer for CSS generation. */
interface RendererCssVerdict {
  ref: string;
  action: string;
  params?: Record<string, number>;
}

/** Full TreatmentVerdict cache — refreshed on each classify call. */
let cachedVerdicts: TreatmentVerdict[] = [];

/** Convert a renderer profile into a minimal ComponentProfile. */
function toComponentProfile(p: RendererProfile): ComponentProfile {
  return {
    role: (p.role as ComponentProfile['role']) ?? 'other',
    path: p.ref,
    ref: p.ref,
    boxModel: null,
    depth: 0,
    area: p.areaRatio * 1_000_000,
    areaRatio: p.areaRatio,
    quantified: {},
    hasText: p.hasText,
    hasInteractiveDescendant: false,
    descendantCount: 0,
    zIndex: p.zIndex,
  };
}

/** Convert a TreatmentVerdict to the lightweight preload shape. */
function toRendererVerdict(v: TreatmentVerdict) {
  return {
    ref: v.ref,
    action: v.treatment,
    confidence: v.confidence,
    evidence: [
      `rule: ${v.evidence.rule}`,
      `area: ${(v.evidence.areaRatio * 100).toFixed(1)}%`,
      `bg: ${v.evidence.hasBg ? 'yes' : 'no'}`,
      `text: ${v.evidence.hasText ? 'yes' : 'no'}`,
      `interactive: ${v.evidence.hasInteractive ? 'yes' : 'no'}`,
      `depth: ${v.evidence.depth}`,
      ...(v.evidence.frost
        ? [
            `frost: opacity=${v.evidence.frost.opacity.toFixed(2)} blur=${v.evidence.frost.blurPx}px`,
          ]
        : []),
      ...(v.evidence.contrastRatio !== undefined
        ? [
            `contrast: ${v.evidence.contrastRatio.toFixed(2)} (${v.evidence.contrastPass ? 'pass' : 'fail'})`,
          ]
        : []),
    ],
  };
}

export function registerTreatmentClassifierIpc(): void {
  ipcMain.handle(IpcChannel.TREATMENT_CLASSIFY, async (_event, profiles: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.TREATMENT_CLASSIFY,
      15000,
      (async () => {
        if (!Array.isArray(profiles)) {
          throw new Error('profiles must be an array');
        }
        const componentProfiles = profiles.map(toComponentProfile);
        const result = classifyAll(componentProfiles);

        // Cache full verdicts for CSS generation
        cachedVerdicts = result.verdicts;

        return {
          verdicts: result.verdicts.map(toRendererVerdict),
          summary: result.summary,
        };
      })(),
    );
  });

  ipcMain.handle(IpcChannel.TREATMENT_CSS, async (_event, rendererVerdicts: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.TREATMENT_CSS,
      10000,
      (async () => {
        if (!Array.isArray(rendererVerdicts)) {
          throw new Error('verdicts must be an array');
        }
        if (cachedVerdicts.length === 0) {
          throw new Error('no classify result available — call classify first');
        }
        // Reconstruct full verdicts from cache by ref
        const byRef = new Map(cachedVerdicts.map((v) => [v.ref, v]));
        const fullVerdicts: TreatmentVerdict[] = [];
        for (const rv of rendererVerdicts as RendererCssVerdict[]) {
          const full = byRef.get(rv.ref);
          if (full) {
            fullVerdicts.push(full);
          }
        }
        return buildTreatmentCss(fullVerdicts);
      })(),
    );
  });
}
