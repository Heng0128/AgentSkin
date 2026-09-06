// SPDX-License-Identifier: MPL-2.0

/**
 * # Transform Ledger + Overrides IPC
 *
 * Bridges the renderer to the two isolated profile-pipeline modules:
 *   - `TransformLedger` (transform-ledger.ts): per-element transform records
 *     (remove / transparentize / frost / keep) with individual enable toggles
 *     and CSS generation.
 *   - `OverridesStore` (overrides-store.ts): human-in-the-loop correction
 *     loop (whitelist / blacklist) plus precision/recall metrics.
 *
 * Both modules are pure in-memory containers; this file owns their lifecycle
 * as process-wide singletons (one ledger + one overrides store per agent).
 * Disk persistence is intentionally left to a future iteration — the stores
 * are constructed fresh on every main-process restart, matching the current
 * contract of "pure memory + serialization helpers".
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import { OverridesStore } from '../profile/overrides-store';
import { TransformLedger } from '../profile/transform-ledger';
import { assertNonEmptyString } from './ipc-validators';
import { withMonitoredTimeout } from './with-monitored-timeout';

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------

const ledger = new TransformLedger();
const overrides = new OverridesStore('global');

// ---------------------------------------------------------------------------
// Transform Ledger handlers
// ---------------------------------------------------------------------------

export function registerTransformLedgerIpc(): void {
  ipcMain.handle(
    IpcChannel.TRANSFORM_LEDGER_UPSERT,
    async (
      _event,
      entry: {
        targetRef: string;
        action: string;
        params?: Record<string, number>;
        source?: string;
        enabled?: boolean;
      },
    ) => {
      return withMonitoredTimeout(
        IpcChannel.TRANSFORM_LEDGER_UPSERT,
        15000,
        (async () => {
          assertNonEmptyString(entry?.targetRef, 'targetRef required');
          assertNonEmptyString(entry?.action, 'action required');
          ledger.upsert({
            targetRef: entry.targetRef,
            action: entry.action as import('../profile/transform-ledger').LedgerAction,
            params: entry.params,
            baseline: {},
            source:
              (entry.source as import('../profile/transform-ledger').LedgerSource) ?? 'manual-add',
            enabled: entry.enabled,
          });
          return { ok: true };
        })(),
      );
    },
  );

  ipcMain.handle(IpcChannel.TRANSFORM_LEDGER_TOGGLE, async (_event, targetRef: string) => {
    return withMonitoredTimeout(
      IpcChannel.TRANSFORM_LEDGER_TOGGLE,
      15000,
      (async () => {
        assertNonEmptyString(targetRef, 'targetRef required');
        const entry = ledger.findByRef(targetRef);
        if (!entry) {
          throw new Error(`No ledger entry for targetRef: ${targetRef}`);
        }
        const enabled = ledger.toggle(entry.id);
        return { ok: true, enabled };
      })(),
    );
  });

  ipcMain.handle(
    IpcChannel.TRANSFORM_LEDGER_SET_ACTION,
    async (_event, action: string, enabled: boolean) => {
      return withMonitoredTimeout(
        IpcChannel.TRANSFORM_LEDGER_SET_ACTION,
        15000,
        (async () => {
          assertNonEmptyString(action, 'action required');
          if (typeof enabled !== 'boolean') {
            throw new Error('enabled must be boolean');
          }
          ledger.setActionEnabled(
            action as import('../profile/transform-ledger').LedgerAction,
            enabled,
          );
          return { ok: true };
        })(),
      );
    },
  );

  ipcMain.handle(IpcChannel.TRANSFORM_LEDGER_CSS, () => {
    return withMonitoredTimeout(
      IpcChannel.TRANSFORM_LEDGER_CSS,
      15000,
      Promise.resolve(ledger.toCss()),
    );
  });

  ipcMain.handle(IpcChannel.TRANSFORM_LEDGER_GET, () => {
    return withMonitoredTimeout(
      IpcChannel.TRANSFORM_LEDGER_GET,
      15000,
      (() => {
        const entries = ledger.all().map((e) => ({
          targetRef: e.targetRef,
          action: e.action,
          enabled: e.enabled,
          source: e.source,
        }));
        return Promise.resolve({ entries, summary: ledger.summary() });
      })(),
    );
  });

  // ---------------------------------------------------------------------------
  // Overrides handlers
  // ---------------------------------------------------------------------------

  ipcMain.handle(
    IpcChannel.OVERRIDES_WHITELIST,
    async (_event, targetRef: string, treatment: string, note?: string) => {
      return withMonitoredTimeout(
        IpcChannel.OVERRIDES_WHITELIST,
        15000,
        (async () => {
          assertNonEmptyString(targetRef, 'targetRef required');
          assertNonEmptyString(treatment, 'treatment required');
          overrides.whitelist({
            targetRef,
            treatment: treatment as import('../profile/treatment-classifier').Treatment,
            note,
          });
          return { ok: true };
        })(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.OVERRIDES_BLACKLIST,
    async (_event, targetRef: string, treatment: string, note?: string) => {
      return withMonitoredTimeout(
        IpcChannel.OVERRIDES_BLACKLIST,
        15000,
        (async () => {
          assertNonEmptyString(targetRef, 'targetRef required');
          assertNonEmptyString(treatment, 'treatment required');
          overrides.blacklist(targetRef, note);
          return { ok: true };
        })(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.OVERRIDES_CONFIRM,
    async (_event, targetRef: string, action: string) => {
      return withMonitoredTimeout(
        IpcChannel.OVERRIDES_CONFIRM,
        15000,
        (async () => {
          assertNonEmptyString(targetRef, 'targetRef required');
          assertNonEmptyString(action, 'action required');
          const predicted =
            ledger.findByRef(targetRef)?.action ??
            ('keep' as import('../profile/treatment-classifier').Treatment);
          overrides.confirm(
            targetRef,
            predicted,
            action as import('../profile/treatment-classifier').Treatment,
          );
          return { ok: true };
        })(),
      );
    },
  );

  ipcMain.handle(IpcChannel.OVERRIDES_METRICS, () => {
    return withMonitoredTimeout(
      IpcChannel.OVERRIDES_METRICS,
      15000,
      (() => {
        const m = overrides.metrics();
        if (!m) return Promise.resolve(null);
        return Promise.resolve({
          precision: m.precision,
          recall: m.recall,
          tp: m.truePositive,
          fp: m.falsePositive,
          fn: m.falseNegative,
        });
      })(),
    );
  });
}
