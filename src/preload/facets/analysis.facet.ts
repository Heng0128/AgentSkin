// SPDX-License-Identifier: MPL-2.0

/**
 * Analysis facet — native profile builder, treatment classifier, transform ledger,
 * overrides store, selector probe, and ASAR scan.
 *
 * These are all "inspection and mutation" tools used by the visual analysis
 * pipeline. They share the common trait of reading DOM/structure data, computing
 * a derived model, and applying CSS mutations — but each is a distinct domain
 * that doesn't belong in the core injection facade.
 */

import { ipcRenderer } from 'electron';
import type { ArchitectureProfile } from '../../shared/asar-architecture';
import { IpcChannel } from '../../shared/ipc-channels';

function subscribeEvent<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

export const analysis = {
  // --- Native Profile Pipeline (native-profile.ts) ---
  buildNativeProfile: (
    domTree: import('../../shared/types').DomTreeNode,
    options: Record<string, unknown>,
  ) =>
    ipcRenderer.invoke(IpcChannel.NATIVE_PROFILE_BUILD, domTree, options) as Promise<{
      agentId: string;
      componentCount: number;
      roleDistribution: Record<string, number>;
      elevationLadder: string[];
    }>,
  onNativeProfileReady: (
    listener: (profile: {
      agentId: string;
      componentCount: number;
      roleDistribution: Record<string, number>;
    }) => void,
  ) => subscribeEvent(IpcChannel.NATIVE_PROFILE_READY, listener),

  // --- Treatment Classifier (treatment-classifier.ts) ---
  classifyComponents: (profiles: unknown) =>
    ipcRenderer.invoke(IpcChannel.TREATMENT_CLASSIFY, profiles) as Promise<{
      verdicts: Array<{ ref: string; action: string; confidence: number; evidence: string[] }>;
      summary: Record<string, number>;
    }>,
  generateTreatmentCss: (
    verdicts: Array<{ ref: string; action: string; confidence: number; evidence: string[] }>,
  ) => ipcRenderer.invoke(IpcChannel.TREATMENT_CSS, verdicts) as Promise<string>,

  // --- Transform Ledger (transform-ledger.ts) ---
  upsertLedgerEntry: (entry: { targetRef: string; action: string; source?: string }) =>
    ipcRenderer.invoke(IpcChannel.TRANSFORM_LEDGER_UPSERT, entry) as Promise<{ ok: boolean }>,
  toggleLedgerEntry: (targetRef: string) =>
    ipcRenderer.invoke(IpcChannel.TRANSFORM_LEDGER_TOGGLE, targetRef) as Promise<{
      ok: boolean;
      enabled: boolean;
    }>,
  setLedgerActionEnabled: (action: string, enabled: boolean) =>
    ipcRenderer.invoke(IpcChannel.TRANSFORM_LEDGER_SET_ACTION, action, enabled) as Promise<{
      ok: boolean;
    }>,
  getLedgerCss: () => ipcRenderer.invoke(IpcChannel.TRANSFORM_LEDGER_CSS) as Promise<string>,
  getLedgerState: () =>
    ipcRenderer.invoke(IpcChannel.TRANSFORM_LEDGER_GET) as Promise<{
      entries: Array<{ targetRef: string; action: string; enabled: boolean; source: string }>;
      summary: Record<string, number>;
    }>,

  // --- Human-in-the-loop Overrides (overrides-store.ts) ---
  addToWhitelist: (targetRef: string, treatment: string, note?: string) =>
    ipcRenderer.invoke(IpcChannel.OVERRIDES_WHITELIST, targetRef, treatment, note) as Promise<{
      ok: boolean;
    }>,
  addToBlacklist: (targetRef: string, treatment: string, note?: string) =>
    ipcRenderer.invoke(IpcChannel.OVERRIDES_BLACKLIST, targetRef, treatment, note) as Promise<{
      ok: boolean;
    }>,
  confirmTreatment: (targetRef: string, action: string) =>
    ipcRenderer.invoke(IpcChannel.OVERRIDES_CONFIRM, targetRef, action) as Promise<{ ok: boolean }>,
  getOverrideMetrics: () =>
    ipcRenderer.invoke(IpcChannel.OVERRIDES_METRICS) as Promise<{
      precision: number;
      recall: number;
      tp: number;
      fp: number;
      fn: number;
    } | null>,

  // --- Selector probe (selector-validator.ts) ---
  probeSelector: (port: number, selector: string) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.SELECTOR_PROBE, port, selector) as Promise<
      import('../../shared/types/selector-probe').SelectorProbeResult
    >,
  validateSelectors: (port: number, agentId: string, selectors: string[]) =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.SELECTOR_VALIDATE, port, agentId, selectors) as Promise<
      import('../../shared/types/selector-probe').SelectorValidationReport
    >,

  // --- ASAR extraction (engine update workflow) ---
  discoverAsar: (request: { appPath?: string; agentId?: string }) =>
    ipcRenderer.invoke(IpcChannel.ASAR_DISCOVER, request) as Promise<
      Array<{ path: string; size: number; role: 'root' | 'webview'; layout: 'asar' | 'loose' }>
    >,
  extractAsar: (asarPath: string, destDir: string) =>
    ipcRenderer.invoke(IpcChannel.ASAR_EXTRACT, asarPath, destDir) as Promise<{
      extractedTo: string;
      skipped: string[];
    }>,
  scanAsar: (extractDir: string, family: 'react' | 'vscode', agentId?: string) =>
    ipcRenderer.invoke(IpcChannel.ASAR_SCAN, extractDir, family, agentId) as Promise<{
      topology: {
        entries: Array<{ file: string; scripts: string[] }>;
        preloadScripts: string[];
        chunks: string[];
      };
      strings: {
        dataAttrs: Array<{ value: string; count: number }>;
        dataTestids: Array<{ value: string; count: number }>;
        ids: Array<{ value: string; count: number }>;
        ipcTypes: Array<{ value: string; count: number }>;
        i18nKeys: Array<{ value: string; count: number }>;
      };
      tokens: {
        namespaces: Record<
          string,
          { varCount: number; vars: Array<{ value: string; count: number }> }
        >;
        varCount: number;
        cssBytes: number;
        sheets: number;
      };
      fragilitySeeds: Array<{ anchor: string; kind: string; stability: string }>;
      security: {
        contextIsolation: boolean | null;
        webSecurity: boolean | null;
        sandbox: boolean | null;
        csp: { from: string; directives: Record<string, string[]> };
      };
      surfaces: {
        preloadExposed: Array<{ value: string; count: number }>;
        ipc: {
          handle: Array<{ value: string; count: number }>;
          invoke: Array<{ value: string; count: number }>;
          send: Array<{ value: string; count: number }>;
          on: Array<{ value: string; count: number }>;
        };
      };
      architecture?: ArchitectureProfile;
    }>,
  readAsarFile: (extractDir: string, filePath: string) =>
    ipcRenderer.invoke(IpcChannel.ASAR_READ_FILE, extractDir, filePath) as Promise<{
      content: string;
      size: number;
    } | null>,
  jointAnalysis: (req: { agentId: string; extractDir: string; cachedScanResult?: unknown }) =>
    ipcRenderer.invoke(IpcChannel.ASAR_JOINT_ANALYSIS, req) as Promise<{
      // biome-ignore lint/suspicious/noExplicitAny: scanResult type matches ASAR scan output
      scanResult: any;
      health: {
        total: number;
        staticScore: number;
        dynamicScore: number;
        hitRate: number;
        landmarkPassed: boolean;
        noCdpReason?: string;
      };
      readiness: {
        canInject: boolean;
        blocks: string[];
        warnings: string[];
        recommendations: string[];
      };
      /** Live CDP contribution — present only when a session was established. */
      cdp?: {
        port: number;
        targetId: string;
        title?: string;
        url?: string;
        surfaces: Array<{
          role: string;
          entry: string;
          matched: boolean;
          title?: string;
          url?: string;
        }>;
        mechanism?: 'adoptedStyleSheets' | 'inline-style';
      };
    }>,
};
