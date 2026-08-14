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
import { sha256Hex16 } from '@/lib/hash';

import type { ElectronScanResult, LaunchResult, ScannedApp } from '@shared/types';
import { create } from 'zustand';

/** Shape of the launcher-specific API surface (extends AgentSkinApi). */
interface AppsApiExtension {
  scanElectronApps(): Promise<ElectronScanResult>;
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
}

/** Cast the shared `api` singleton to include the launcher-specific methods. */
const appsApi = api as unknown as AppsApiExtension;

/** Running-app record. */
export interface RunningAppInfo {
  pid: number;
  port: number | null;
}

/** Concurrency guard — prevents double-launching the same app. */
const launchingGuard = new Set<string>();

/** Module-level Set tracking custom exe paths added via manual-add. */
const customExePaths = new Set<string>();

interface AppsState {
  /** Last scan result (null = never scanned). */
  scanResult: ElectronScanResult | null;
  /** True while a scan IPC is in flight. */
  scanning: boolean;
  /** AppIds currently being launched (IPC in flight). */
  launchingApps: Set<string>;
  /** Running apps: appId → { pid, port }. */
  runningApps: Map<string, RunningAppInfo>;
  /** User-hidden appIds. */
  hiddenApps: Set<string>;

  // --- Actions ---
  /** Scan locally installed Electron applications. */
  scan: () => Promise<void>;
  /** Launch a scanned application. */
  launch: (app: ScannedApp) => Promise<void>;
  /** Toggle an app's hidden state. */
  toggleHidden: (appId: string) => void;
  /** Manually refresh running-status from the main process. */
  refreshStatus: () => void;
  /**
   * Add a user-specified exe to the launch list. Marks it as un-adapted
   * (`adapterMatch: null`) and appends it to `scanResult.other`.
   */
  addCustomApp: (exePath: string, preferredPort?: number | null) => Promise<ScannedApp | null>;
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
    launchingApps: new Set(),
    runningApps: new Map(),
    hiddenApps: new Set(),

    scan: async () => {
      set({ scanning: true });
      try {
        const result = await appsApi.scanElectronApps();
        set({ scanResult: result, scanning: false });
      } catch (error) {
        set({ scanning: false });
        console.error('[appsStore] scan failed —', error);
      }
    },

    launch: async (app: ScannedApp) => {
      const { launchingApps, runningApps } = get();

      // Guard: don't double-launch.
      if (launchingGuard.has(app.id)) return;
      launchingGuard.add(app.id);

      // Optimistic: add to launching set for immediate UI feedback.
      set({ launchingApps: new Set(launchingApps).add(app.id) });

      try {
        const result = await appsApi.launchElectronApp({
          appId: app.id,
          exePath: app.exePath,
          adapted: app.adapterMatch !== null,
          adapterId: app.adapterMatch ?? undefined,
        });

        // Update running apps from the launch result.
        const next = new Map(runningApps);
        if (result.ok && result.pid) {
          next.set(app.id, { pid: result.pid, port: result.port ?? null });
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

    refreshStatus: () => {
      // Trigger a re-scan which also refreshes running state via the
      // ELECTRON_STATUS subscription when the main process detects changes.
      void get().scan();
    },

    addCustomApp: async (exePath: string, preferredPort?: number | null) => {
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
