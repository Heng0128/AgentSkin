// SPDX-License-Identifier: MPL-2.0

/**
 * # appsStore
 *
 * Application quick-launcher state: the scanned Electron app list, which apps
 * are currently launching, running-app tracking (pid + CDP port), and the
 * user's hidden-app set.
 *
 * ## Data flow
 *
 *   1. `scan()` invokes `api.scanElectronApps()` (IPC to main's
 *      `electron-scanner.ts`) and stores the result.
 *   2. `launch(app)` invokes `api.launchElectronApp(request)` (IPC to main's
 *      `electron-launcher.ts`), tracks the app as "launching" until the
 *      promise settles, then updates `runningApps` from the result.
 *   3. The main process pushes `ELECTRON_STATUS` events when running apps
 *      change (launched / exited); the subscription inside `create()` updates
 *      `runningApps` in real time.
 *
 * ## Concurrency
 *
 * A module-level `launchingGuard` Set prevents double-launching the same app
 * while a previous launch IPC is in flight. The guard is keyed by `appId`.
 */

import { api } from '@/api/agentSkinClient';
import { applyScanEvent, dedupeByProductName } from '@/lib/app-dedupe';
import { sha256Hex16 } from '@/lib/hash';
import { useDialogStore } from '@/stores/dialogStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useSettingsStore } from '@/stores/settingsStore';

import { identityKey } from '@shared/app-identity';
import type {
  AgentId,
  ElectronScanResult,
  LaunchResult,
  ScannedApp,
  ScanProgressEvent,
} from '@shared/types';
import { create } from 'zustand';

/** Shape of the launcher-specific API surface (extends AgentSkinApi). */
interface AppsApiExtension {
  scanElectronApps(force?: boolean): Promise<ElectronScanResult>;
  launchElectronApp(request: {
    appId: string;
    exePath: string;
    adapted: boolean;
    preferredPort?: number | null;
    forceRestart?: boolean;
    adapterId?: string;
  }): Promise<LaunchResult>;
  onElectronStatus(
    listener: (status: Map<string, { pid: number; port: number | null }>) => void,
  ): () => void;
  onElectronScanProgress(listener: (event: ScanProgressEvent) => void): () => void;
}

/**
 * The shared `api` singleton already exposes the launcher-specific methods
 * (they are part of `AgentSkinApi`), so no cast is needed — this explicit
 * type annotation lets the compiler verify the structural match.
 */
const appsApi: AppsApiExtension = api;

/** Running-app record. */
export interface RunningAppInfo {
  pid: number;
  port: number | null;
}

/** Concurrency guard — prevents double-launching the same app. */
const launchingGuard = new Set<string>();

/** Module-level Set tracking custom exe paths added via manual-add. */
const customExePaths = new Set<string>();

/** Shallow-compare the fields that affect tile rendering — used to skip
 *  no-op updates when the final result replays what was already streamed. */
function shallowEqualApp(a: ScannedApp, b: ScannedApp): boolean {
  return (
    a.id === b.id &&
    a.productName === b.productName &&
    a.companyName === b.companyName &&
    a.exePath === b.exePath &&
    a.iconPath === b.iconPath &&
    a.adapterMatch === b.adapterMatch &&
    a.source === b.source
  );
}

/**
 * Merge the final scan result into the existing list with minimal mutations:
 *   - new identity → add
 *   - changed identity → update
 *   - missing identity → drop (uninstalled / deduped away)
 * Reuses `applyScanEvent` for add/update so the renderer's tile transitions
 * stay consistent with the streaming phase.
 */
function mergeFinalResult(
  prev: ElectronScanResult | null,
  result: ElectronScanResult,
): ElectronScanResult {
  let next = prev ?? { adapted: [], other: [] };
  const seen = new Set<string>();

  for (const app of [...result.adapted, ...result.other]) {
    const key = identityKey(app);
    seen.add(key);
    const bucket: 'adapted' | 'other' = app.adapterMatch ? 'adapted' : 'other';
    const existing = next[bucket].find((e) => identityKey(e) === key);
    if (!existing) {
      next = applyScanEvent(next, { op: 'add', app });
    } else if (!shallowEqualApp(existing, app)) {
      next = applyScanEvent(next, { op: 'update', app });
    }
  }

  // Drop entries that no longer appear in the final result.
  next = {
    adapted: next.adapted.filter((a) => seen.has(identityKey(a))),
    other: next.other.filter((a) => seen.has(identityKey(a))),
  };
  return next;
}

interface AppsState {
  /** Last scan result (null = never scanned). */
  scanResult: ElectronScanResult | null;
  /** True while a scan IPC is in flight. */
  scanning: boolean;
  /** Non-null when the last scan failed (drives the error banner + retry). */
  scanError: string | null;
  /** AppIds currently being launched (IPC in flight). */
  launchingApps: Set<string>;
  /** Running apps: appId → { pid, port }. */
  runningApps: Map<string, RunningAppInfo>;
  /** User-hidden appIds. */
  hiddenApps: Set<string>;

  // --- Actions ---
  /** Scan locally installed Electron applications. `force=true` bypasses the
   *  main-process cache (used by the manual "scan" button). */
  scan: (force?: boolean) => Promise<void>;
  /** Launch a scanned application. `forceRestart` re-launches a running app
   *  with the debug port enabled (used by the needs-restart dialog action). */
  launch: (app: ScannedApp, options?: { forceRestart?: boolean }) => Promise<void>;
  /** Force-restart a scanned app from the needs-restart dialog (P0-5):
   *  resolves the app by scanned id, closes the prompt, re-launches with
   *  forceRestart. */
  forceRestartLaunch: (appId: string) => Promise<void>;
  /** Toggle an app's hidden state. */
  toggleHidden: (appId: string) => void;
  /** Manually refresh running-status from the main process. */
  refreshStatus: () => void;
  /**
   * Add a user-specified exe to the launch list. Marks it as un-adapted
   * (`adapterMatch: null`) and appends it to `scanResult.other`.
   */
  addCustomApp: (exePath: string, _preferredPort?: number | null) => Promise<ScannedApp | null>;
}

export const useAppsStore = create<AppsState>((set, get) => {
  // Subscribe to main→renderer status push events. The unsubscribe function
  // is captured but not exposed — the subscription lives for the lifetime of
  // the store (process-wide singleton in practice).
  appsApi.onElectronStatus((status) => {
    set({ runningApps: new Map(status) });
  });

  return {
    scanResult: null,
    scanning: false,
    scanError: null,
    launchingApps: new Set(),
    runningApps: new Map(),
    hiddenApps: new Set(),

    scan: async (force = false) => {
      // Guard against concurrent scans: the button is disabled while scanning,
      // but a fast double-click or an auto-scan racing a manual click can still
      // fire twice before React re-renders the disabled state.
      if (get().scanning) return;
      // Do NOT clear the existing list here — wiping it causes a visible flicker
      // (empty state flash) between the click and the first streamed app.
      set({ scanning: true, scanError: null });

      // Stream each identity-merged event into the list as the main process
      // scans: `add` appends a new product, `update` replaces a tile when a
      // better entry arrives, `icon` patches a tile in place once extraction
      // finishes. Tiles appear one-by-one (no empty-state flash — the old
      // list stays until the first event) and the final response only
      // enriches the same data, never replacing it wholesale.
      const unsubscribe = appsApi.onElectronScanProgress((event) => {
        set((s) => ({ scanResult: applyScanEvent(s.scanResult, event) }));
      });

      try {
        const result = await appsApi.scanElectronApps(force);
        // The main process already identity-merged the result (same data that
        // was streamed), so this is a defensive pass: diff against the current
        // (streamed) list and only mutate tiles that actually changed. New
        // identities are added, changed ones are updated via `applyScanEvent`
        // (same path as the streaming phase), and identities that vanished
        // (uninstalled or deduped away) are dropped — no wholesale replace.
        set((s) => ({
          scanResult: mergeFinalResult(s.scanResult, {
            adapted: dedupeByProductName(result.adapted),
            other: dedupeByProductName(result.other),
          }),
          scanning: false,
        }));
      } catch (error) {
        set({
          scanning: false,
          scanError: error instanceof Error ? error.message : String(error),
        });
      } finally {
        unsubscribe();
      }
    },

    launch: async (app: ScannedApp, options?: { forceRestart?: boolean }) => {
      const { launchingApps, runningApps } = get();

      // Guard: don't double-launch.
      if (launchingGuard.has(app.id)) return;
      launchingGuard.add(app.id);

      // Optimistic: add to launching set for immediate UI feedback.
      set({ launchingApps: new Set(launchingApps).add(app.id) });

      try {
        // P0-6 (RFC 2026-08-19 R5): surface the user's per-agent debug-port
        // override (settings → apps[appId].port) through the launch request.
        // The main-process launcher probes it and walks upward when occupied.
        const settings = useSettingsStore.getState().settings;
        const preferredPort = settings?.apps?.[app.id as AgentId]?.port ?? null;

        const result = await appsApi.launchElectronApp({
          appId: app.id,
          exePath: app.exePath,
          adapted: app.adapterMatch !== null,
          adapterId: app.adapterMatch ?? undefined,
          preferredPort,
          forceRestart: options?.forceRestart === true,
        });

        // Update running apps from the launch result.
        const next = new Map(runningApps);
        if (result.ok && result.pid) {
          next.set(app.id, { pid: result.pid, port: result.port ?? null });
        } else if (result.state === 'needs-restart') {
          // P0-5 (RFC 2026-08-19 R5): surface the needs-restart state instead
          // of silently swallowing it — the dialog offers a force restart.
          const name = app.productName || app.id;
          useDialogStore.getState().setLaunchRestartPrompt({
            appId: app.id,
            name,
            message: result.message,
          });
        } else if (!result.ok) {
          // Generic launch failure — surface it instead of failing silently.
          useNotificationStore.getState().fail(new Error(result.message));
        }
        set({ runningApps: next });
      } catch (error) {
        console.error(`[appsStore] launch(${app.id}) failed —`, error);
      } finally {
        launchingGuard.delete(app.id);
        const nextLaunching = new Set(get().launchingApps);
        nextLaunching.delete(app.id);
        set({ launchingApps: nextLaunching });
      }
    },

    toggleHidden: (appId: string) => {
      const { hiddenApps } = get();
      const next = new Set(hiddenApps);
      if (next.has(appId)) {
        next.delete(appId);
      } else {
        next.add(appId);
      }
      set({ hiddenApps: next });
    },

    forceRestartLaunch: async (appId: string) => {
      const scan = get().scanResult;
      const app = [...(scan?.adapted ?? []), ...(scan?.other ?? [])].find((a) => a.id === appId);
      useDialogStore.getState().setLaunchRestartPrompt(null);
      if (!app) return;
      await get().launch(app, { forceRestart: true });
    },

    refreshStatus: () => {
      // Trigger a re-scan which also refreshes running state via the
      // ELECTRON_STATUS subscription when the main process detects changes.
      void get().scan();
    },

    addCustomApp: async (exePath: string, _preferredPort?: number | null) => {
      // Dedupe: skip if already added by path.
      if (customExePaths.has(exePath)) {
        const existing = get().scanResult?.other.find((a) => a.exePath === exePath);
        return existing ?? null;
      }
      customExePaths.add(exePath);

      const id = await sha256Hex16(exePath);
      const basename = exePath.split(/[\\/]/).pop() ?? exePath;
      const productName = basename.replace(/\.exe$/i, '');
      const customApp: ScannedApp = {
        id,
        exePath,
        productName,
        companyName: '',
        adapterMatch: null,
      };

      // Merge into scanResult.other — preserve existing entries.
      set((s) => {
        const prev = s.scanResult ?? { adapted: [], other: [] };
        const next: ElectronScanResult = {
          adapted: prev.adapted,
          other: [...prev.other, customApp],
        };
        return { scanResult: next };
      });

      return customApp;
    },
  };
});
