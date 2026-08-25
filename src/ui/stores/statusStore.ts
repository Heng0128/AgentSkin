// SPDX-License-Identifier: MPL-2.0

/**
 * # statusStore
 *
 * System status + status-refresh lifecycle.
 *
 * Extracted from `useAppController` (Phase A2). Owns the live status object,
 * the last-success timestamp, the in-flight refresh flag, and the refresh
 * action itself. Boot progress (parsed per-agent phases) is kept separately
 * (see bootProgressStore) because it is derived from the runtime-log stream.
 */

import { api } from '@/api/agentSkinClient';

import type { SystemStatus } from '@shared/types';
import { create } from 'zustand';

interface StatusState {
  status: SystemStatus | null;
  lastStatusAt: number | null;
  isRefreshing: boolean;
  /** Error message from the last failed refresh, null when last refresh succeeded. */
  error: string | null;

  setStatus: (status: SystemStatus | null) => void;
  refreshStatus: () => Promise<void>;
  /** Clear the error state (e.g., on user-initiated retry). */
  clearError: () => void;
}

export const useStatusStore = create<StatusState>((set, get) => {
  // Subscribe to coordinator runtime state changes (running/pid/port/debugReady).
  // This eliminates the 3s poll latency for runtime fields.
  api.onCoordinatorStatus(({ appId, state: runtime }) => {
    const current = get().status;
    if (!current) return;
    const mergedApps = current.apps.map((app) =>
      app.appId === appId
        ? { ...app, running: runtime.running, port: runtime.port, debugReady: runtime.debugReady }
        : app,
    );
    set({ status: { ...current, apps: mergedApps }, lastStatusAt: Date.now() });
  });

  return {
    status: null,
    lastStatusAt: null,
    isRefreshing: false,
    error: null,

    setStatus: (status) => set({ status }),
    clearError: () => set({ error: null }),
    refreshStatus: async () => {
      set({ isRefreshing: true, error: null });
      try {
        // 15s timeout guard: prevents isRefreshing from being stuck on true
        // when network/IPC hangs indefinitely
        const refreshPromise = (async () => {
          // 1. Slow path: get static/installed fields from main process
          const baseStatus = await api.refreshStatus();

          // 2. Fast path: overlay runtime fields from coordinator snapshot
          const coordinatorSnapshot = await api.getCoordinatorSnapshot();

          // 3. Merge per-app: coordinator runtime fields take priority
          const mergedApps = baseStatus.apps.map((app) => {
            const runtime = coordinatorSnapshot.get(app.appId);
            if (runtime) {
              return {
                ...app,
                running: runtime.running,
                port: runtime.port,
                debugReady: runtime.debugReady,
              };
            }
            return app;
          });

          return { ...baseStatus, apps: mergedApps } as SystemStatus;
        })();

        // Race between actual refresh and 15s timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Status refresh timed out after 15s')), 15000);
        });

        const mergedStatus = await Promise.race([refreshPromise, timeoutPromise]);

        set({
          status: mergedStatus,
          lastStatusAt: Date.now(),
          error: null,
        });
      } catch (err) {
        // Capture the error message so the UI can display a retry prompt.
        // Timeout errors and IPC errors are both handled here.
        const message = err instanceof Error ? err.message : String(err);
        set({ error: message });
      } finally {
        // Always reset isRefreshing, regardless of success/failure/timeout
        set({ isRefreshing: false });
      }
    },
  };
});
