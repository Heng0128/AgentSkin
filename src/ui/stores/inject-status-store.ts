// SPDX-License-Identifier: MPL-2.0

/**
 * # injectStatusStore (Skeleton)
 *
 * Unified injection-status store — progressive replacement for the scattered
 * injection-state fields currently split across 9+ stores:
 *
 *   `statusStore`    → system status + refresh lifecycle (activeThemeId, running, port)
 *   `themeStore`     → per-agent busy keys (apply/restore)
 *   `appsStore`      → launching + running-app tracking (launchingApps, runningApps)
 *   `wallpaperStore` → per-agent wallpaper apply/restore
 *   `installFlowStore` → install step sequence
 *   `secondaryInjectStore` → webview/iframe injection progress
 *   `environmentStore` → switching state
 *   `agentStore`     → agent catalog (sync seed from AGENT_META)
 *   `diagnosticsStore` → drift + CDP performance (injection observability)
 *
 * ## Scope (Phase 1 — Skeleton)
 *
 * This version provides:
 *   - The unified `InjectStatusState` interface (all fields typed).
 *   - Flattened per-agent inject status (`Record<AgentId, InjectStatus>`).
 *   - Delegated `applyTheme` / `restoreTheme` actions that call `api.applyTheme`
 *     and `api.restoreApp` respectively.
 *   - A coordinator-push subscription (same pattern as statusStore/appsStore).
 *   - Module-level reset for test isolation.
 *
 * This version does NOT:
 *   - Replace any existing store (no consumer wiring — zero UI impact).
 *   - Subscribe to secondary-inject or install-flow IPC (future phases).
 *   - Persist state across restarts.
 *
 * ## Future phases
 *
 *   Phase 2: Migrate consumers (InjectDock, AgentStatusBar, SettingsDashboard)
 *            to read from this store.
 *   Phase 3: Port `installFlowStore` and `secondaryInjectStore` state.
 *   Phase 4: Port `wallpaperStore` per-agent inject status.
 *   Phase 5: Deprecate and remove the replaced stores.
 */

import { api } from '@/api/agentSkinClient';

import type { AgentId, ApplyRequest, ApplyResponse, AppStatus, SystemStatus } from '@shared/types';
import { AGENT_IDS } from '@shared/types';
import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Flattened inject lifecycle status per agent.  Derived from the combination
 * of `activeThemeId`, busy keys, and running/debugReady via `deriveStatus()`.
 *
 *   idle        — no theme applied, no operation in flight
 *   detecting   — CDP probe in progress (transitionary; rare in UI)
 *   injecting   — apply or install step is actively running
 *   applied     — activeThemeId is non-null (theme is live)
 *   failed      — last apply/restore returned a failure
 *   restoring   — restore-to-native in flight
 */
export type InjectStatus = 'idle' | 'detecting' | 'injecting' | 'applied' | 'failed' | 'restoring';

/**
 * Busy-key discriminant.  Mirrors the union in themeStore but narrowed to
 * the operations that produce a per-agent "injecting" / "restoring" state.
 */
export type InjectBusyKey =
  | `apply:${AgentId}`
  | `restore:${AgentId}`
  | `install:${string}`
  | `import`
  | `export:${string}`
  | `delete:${string}`
  | `bundle:`;

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface InjectStatusState {
  // --- raw backing status (authoritative) ---
  /** Full system status from main-process `refreshStatus`.  Null until first load. */
  status: SystemStatus | null;
  /** True while `refreshStatus` is in flight. */
  isRefreshing: boolean;
  /** Wall-clock timestamp (ms) of the last successful status refresh. */
  lastStatusAt: number | null;
  /** Error message from the last failed refresh.  Null when last refresh succeeded. */
  error: string | null;

  // --- flattened per-agent inject status ---
  /**
   * Computed inject status per agent.  Re-derived on every `status` or `busy`
   * change.  This is the UI-consumable slice — components subscribe here
   * instead of reconstructing from status + busy + launching.
   */
  injectStatus: Record<AgentId, InjectStatus>;

  // --- busy tracking (which agents are mid-operation) ---
  /** Per-agent busy keys.  Non-null while an apply/install/restore for that
   *  agent is queued or running. */
  busy: Record<AgentId, InjectBusyKey | null>;
  /** Global busy key (import/export/delete/bundle — non-agent operations). */
  globalBusy: InjectBusyKey | null;

  // --- convenience flattened fields (derived) ---
  /** Set of agent ids currently mid-operation (apply/install/restore in flight). */
  installing: Set<AgentId>;
  /** activeThemeId per agent — mirrors `AppStatus.activeThemeId`. */
  currentTheme: Record<AgentId, string | null>;

  // --- lifecycle ---

  /**
   * Refresh the system status from the main process.
   *
   * Slow path: `api.refreshStatus()` → base static fields.
   * Fast path: `api.getCoordinatorSnapshot()` → runtime overlay (running/pid/port).
   * The two are merged so a single `set()` updates both.
   */
  refreshStatus: () => Promise<void>;
  /**
   * Apply a theme to an agent.
   *
   * Delegates to `api.applyTheme` (the single IPC entry point).  After a
   * successful apply the main process returns the authoritative SystemStatus
   * in `ApplyResponse.system` — we adopt it directly (Response-as-Truth).
   */
  applyTheme: (
    appId: AgentId,
    themeId: string,
    options?: { restartExisting?: boolean; schemeId?: string },
  ) => Promise<ApplyResponse | null>;
  /**
   * Restore an agent to its native theme.
   *
   * Delegates to `api.restoreApp`.  On success the returned SystemStatus is
   * adopted directly (same R3 contract as `applyTheme`).
   */
  restoreTheme: (appId: AgentId) => Promise<SystemStatus | null>;
  /** Replace the canonical status (used by coordinator push + tray apply). */
  setStatus: (status: SystemStatus | null) => void;
  /** Clear the error state (e.g., on user-initiated retry). */
  clearError: () => void;

  // --- internal setters (used by ChainController equivalents) ---
  _setAgentBusy: (appId: AgentId, key: InjectBusyKey | null) => void;
  _setGlobalBusy: (key: InjectBusyKey | null) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fresh record with all agents set to `null` / `idle`. */
function emptyAgentRecord<T>(fill: T): Record<AgentId, T> {
  const result = {} as Record<AgentId, T>;
  for (const id of AGENT_IDS) result[id] = fill;
  return result;
}

/** Derive the flattened `InjectStatus` for one agent. */
function deriveStatus(app: AppStatus | undefined, busy: InjectBusyKey | null): InjectStatus {
  if (!app) return 'idle';

  // Busy key takes precedence — it means an operation is in flight.
  if (busy !== null) {
    if (busy.startsWith('restore:')) return 'restoring';
    return 'injecting';
  }

  // No busy key — infer from the backing status.
  if (app.activeThemeId) return 'applied';
  if (app.running && !app.debugReady) return 'detecting';
  return 'idle';
}

/** Re-derive the full flattened per-agent maps.  Call inside every `set()`. */
function rederive(status: SystemStatus | null, busy: Record<AgentId, InjectBusyKey | null>) {
  const injectStatus = emptyAgentRecord<InjectStatus>('idle');
  const currentTheme = emptyAgentRecord<string | null>(null);
  const installing = new Set<AgentId>();

  if (status) {
    const byId = new Map(status.apps.map((a) => [a.appId, a]));
    for (const id of AGENT_IDS) {
      const app = byId.get(id);
      injectStatus[id] = deriveStatus(app, busy[id]);
      currentTheme[id] = app?.activeThemeId ?? null;
      const b = busy[id];
      if (
        b !== null &&
        (b.startsWith('apply:') || b.startsWith('restore:') || b.startsWith('install:'))
      ) {
        installing.add(id);
      }
    }
  }

  return { injectStatus, currentTheme, installing };
}

// ---------------------------------------------------------------------------
// Module-level subscription handles (HMR-safe)
// ---------------------------------------------------------------------------

let offCoordinatorStatus: (() => void) | null = null;

function detachAllListeners(): void {
  if (offCoordinatorStatus) {
    offCoordinatorStatus();
    offCoordinatorStatus = null;
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useInjectStatusStore = create<InjectStatusState>((set, get) => {
  // --- HMR safety: detach previous round before re-subscribing ---
  detachAllListeners();

  // Subscribe to coordinator push (runtime fields: running/pid/port/debugReady).
  // Same pattern as statusStore — eliminates 3s poll latency.
  offCoordinatorStatus = api.onCoordinatorStatus(({ appId, state: runtime }) => {
    const current = get().status;
    if (!current) return;

    // Shallow-compare — skip no-op updates when coordinator polls identical data.
    const targetApp = current.apps.find((app) => app.appId === appId);
    if (
      targetApp &&
      targetApp.running === runtime.running &&
      targetApp.port === runtime.port &&
      targetApp.debugReady === runtime.debugReady
    ) {
      return;
    }

    const mergedApps = current.apps.map((app) =>
      app.appId === appId
        ? { ...app, running: runtime.running, port: runtime.port, debugReady: runtime.debugReady }
        : app,
    );
    const nextStatus: SystemStatus = { ...current, apps: mergedApps };
    const { injectStatus, currentTheme, installing } = rederive(nextStatus, get().busy);
    set({
      status: nextStatus,
      injectStatus,
      currentTheme,
      installing,
      lastStatusAt: Date.now(),
    });
  });

  return {
    status: null,
    isRefreshing: false,
    lastStatusAt: null,
    error: null,
    injectStatus: emptyAgentRecord<InjectStatus>('idle'),
    busy: emptyAgentRecord<InjectBusyKey | null>(null),
    globalBusy: null,
    installing: new Set(),
    currentTheme: emptyAgentRecord<string | null>(null),

    // --- actions ---

    setStatus: (status) => {
      const { injectStatus, currentTheme, installing } = rederive(status, get().busy);
      set({ status, injectStatus, currentTheme, installing, lastStatusAt: Date.now() });
    },

    clearError: () => set({ error: null }),

    refreshStatus: async () => {
      set({ isRefreshing: true, error: null });
      try {
        const baseStatus = await api.refreshStatus();
        const coordinatorSnapshot = await api.getCoordinatorSnapshot();
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
        const nextStatus: SystemStatus = { ...baseStatus, apps: mergedApps };
        const { injectStatus, currentTheme, installing } = rederive(nextStatus, get().busy);
        set({
          status: nextStatus,
          injectStatus,
          currentTheme,
          installing,
          lastStatusAt: Date.now(),
          error: null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ error: message });
      } finally {
        set({ isRefreshing: false });
      }
    },

    applyTheme: async (appId, themeId, options = {}) => {
      const request: ApplyRequest = {
        themeId,
        appId,
        restartExisting: options.restartExisting,
        schemeId: options.schemeId,
      };
      try {
        const result = await api.applyTheme(request);
        // Response-as-Truth: adopt the authoritative snapshot.
        get().setStatus(result.system);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ error: message });
        return null;
      }
    },

    restoreTheme: async (appId) => {
      try {
        const result = await api.restoreApp(appId);
        get().setStatus(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ error: message });
        return null;
      }
    },

    _setAgentBusy: (appId, key) =>
      set((current) => {
        const nextBusy = { ...current.busy, [appId]: key };
        const { injectStatus, currentTheme, installing } = rederive(current.status, nextBusy);
        return { busy: nextBusy, injectStatus, currentTheme, installing };
      }),

    _setGlobalBusy: (key) => set({ globalBusy: key }),
  };
});

// ---------------------------------------------------------------------------
// Module-level reset (test isolation)
// ---------------------------------------------------------------------------

/** Reset module-level subscriptions and store state.  For test teardown. */
export function resetInjectStatusStore(): void {
  detachAllListeners();
  useInjectStatusStore.setState({
    status: null,
    isRefreshing: false,
    lastStatusAt: null,
    error: null,
    injectStatus: emptyAgentRecord<InjectStatus>('idle'),
    busy: emptyAgentRecord<InjectBusyKey | null>(null),
    globalBusy: null,
    installing: new Set(),
    currentTheme: emptyAgentRecord<string | null>(null),
  });
}
