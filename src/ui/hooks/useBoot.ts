// SPDX-License-Identifier: MPL-2.0

/**
 * # useBoot
 *
 * Extracted from useAppController. Owns the one-time boot sequence:
 *   1. Fetch bootstrap data (locale + app version) with a 15s timeout
 *   2. Subscribe to runtime-log events from the main process
 *   3. Kick off status refresh, then poll every 3s (paused while hidden)
 *
 * Separated so useAppController remains a pure composition layer and the
 * boot lifecycle is testable in isolation.
 */

import { type Dispatch, type SetStateAction, useEffect, useRef } from 'react';
import { api } from '@/api/agentSkinClient';

import type { AppLocale } from '@shared/i18n';

interface UseBootDeps {
  fail: (error: unknown) => void;
  setLocaleState: (locale: AppLocale) => void;
  setAppVersion: (version: string) => void;
  setBooting: (booting: boolean) => void;
  setLogs: Dispatch<SetStateAction<string[]>>;
  refreshStatus: () => Promise<void>;
}

export function useBoot(deps: UseBootDeps): void {
  const { fail, setLocaleState, setAppVersion, setBooting, setLogs, refreshStatus } = deps;
  // P1 audit #12: in-flight guard for the 3s status poll. Lives outside the
  // effect so it survives effect re-runs (and so we don't call useRef inside
  // the effect, which would violate the rules of hooks).
  const isPollingRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let bootTimeout: ReturnType<typeof setTimeout> | undefined;
    const bootTimeoutPromise = new Promise<never>((_, reject) => {
      bootTimeout = setTimeout(() => reject(new Error('Bootstrap timeout after 15s')), 15000);
    });
    // The whole IIFE is deferred via setTimeout(0) to a macrotask. React 19's
    // useSyncExternalStore tears if the store changes between render-time
    // snapshot and passive-commit. An async/await continuation from
    // `await api.getBootstrap()` runs in a MICROTASK inside the same task as
    // passive effects, so the synchronous setLocaleState/setAppVersion/setBooting
    // would land inside the tearing window → forceStoreRerender → error #185.
    // setTimeout(0) pushes the entire IIFE into a separate macrotask that runs
    // AFTER passive-commit + tearing-check, making store updates safe.
    void (async () => {
      try {
        const boot = await Promise.race([api.getBootstrap(), bootTimeoutPromise]);
        if (disposed) return;
        // Extra microtask hop inside the macrotask: ensures the snapshot check
        // fires before these sync sets, so they land as normal re-renders.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (disposed) return;
        setLocaleState(boot.locale);
        setAppVersion(boot.appVersion);
      } catch (error) {
        if (!disposed) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      } finally {
        if (bootTimeout !== undefined) clearTimeout(bootTimeout);
        setTimeout(() => {
          if (!disposed) setBooting(false);
        }, 0);
      }
    })();
    const offLog = api.onRuntimeLog((line) => {
      setLogs((cur) => [
        ...cur.slice(-399),
        `[${new Date().toLocaleTimeString(undefined, { hour12: false })}] [Renderer] [INFO] ${line}`,
      ]);
    });
    // Push-based status refresh: the main process emits STATUS_CHANGED after
    // apply/restore/delete/tray operations, so the UI refreshes immediately
    // instead of waiting up to 3s for the next poll tick. The isPollingRef
    // guard prevents overlap if a push arrives while a poll is in flight.
    const offStatusChanged = api.onStatusChanged(() => {
      if (disposed || isPollingRef.current) return;
      isPollingRef.current = true;
      void refreshStatus().finally(() => {
        isPollingRef.current = false;
      });
    });
    // Immediately execute status refresh, then poll every 3s. The poll is
    // gated on document visibility so a backgrounded window doesn't burn
    // CPU on CDP round-trips; on returning to focus we refresh immediately
    // to avoid showing stale status for up to 3s. The 3s cadence balances
    // real-time feel against the cost of probing 4 agents × 5 IO operations
    // per cycle.
    //
    // P1 audit #12: an isPolling ref guards against interval overlap. If a
    // single poll takes longer than 3s (wmic blocking, slow CDP round-trip),
    // the next setInterval tick would otherwise fire while the previous
    // refreshStatus() is still in flight, stacking concurrent IPC calls and
    // amplifying the main-process block. The ref ensures at most one poll is
    // in flight at a time; a slow poll simply delays the next one.
    const triggerPoll = () => {
      if (disposed || isPollingRef.current) return;
      isPollingRef.current = true;
      void refreshStatus().finally(() => {
        isPollingRef.current = false;
      });
    };
    // Defer the initial passive-mount poll to a rAF (macrotask), NOT a
    // microtask. React 19's useSyncExternalStore tearing check runs during the
    // passive-commit phase. A microtask queued from useEffect runs BEFORE that
    // check completes, so the synchronous `set({ isRefreshing: true })` in
    // refreshStatus is detected as tearing → forceStoreRerender → excessive
    // re-render loop → error #185. A macrotask (rAF) runs at the start of the
    // next frame, AFTER all passive-commit and tearing-check work finishes,
    // letting the store update land as a normal scheduled re-render.
    const initRafId = requestAnimationFrame(() => {
      if (!disposed) triggerPoll();
    });
    const poll = window.setInterval(() => {
      if (document.hidden) return;
      triggerPoll();
    }, 3000);
    const onFocus = () => {
      if (!disposed) triggerPoll();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      disposed = true;
      cancelAnimationFrame(initRafId);
      if (bootTimeout !== undefined) clearTimeout(bootTimeout);
      offLog();
      offStatusChanged();
      window.clearInterval(poll);
      window.removeEventListener('focus', onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setLocaleState, refreshStatus, setLogs, setBooting, setAppVersion, fail]);
}
