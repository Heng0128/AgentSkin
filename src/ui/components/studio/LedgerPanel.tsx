// SPDX-License-Identifier: MPL-2.0

/**
 * # LedgerPanel
 *
 * Transform Ledger browser for the Studio workspace. Lists all ledger entries
 * grouped by action (remove / transparentize / frost / keep), with per-entry
 * enable toggles and a "Get CSS" action that fetches the generated injection
 * CSS from the main process.
 *
 * The panel reads from `api.getLedgerState()` and writes via
 * `api.toggleLedgerEntry()` / `api.setLedgerActionEnabled()` — all mutations
 * flow through IPC to the main-process `TransformLedger` singleton.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';

import { Copy, RefreshCw } from 'lucide-react';

/** All possible ledger actions, in display order. */
const LEDGER_ACTIONS = ['remove', 'transparentize', 'frost', 'keep'] as const;
type LedgerAction = (typeof LEDGER_ACTIONS)[number];

/** CSS class + label per action kind, for color-coded grouping. */
const ACTION_STYLE: Record<LedgerAction, { label: string; chip: string; row: string }> = {
  remove: {
    label: 'Remove',
    chip: 'bg-red-500/20 text-red-300',
    row: 'border-l-red-500',
  },
  transparentize: {
    label: 'Transparentize',
    chip: 'bg-amber-500/20 text-amber-300',
    row: 'border-l-amber-500',
  },
  frost: {
    label: 'Frost',
    chip: 'bg-sky-500/20 text-sky-300',
    row: 'border-l-sky-500',
  },
  keep: {
    label: 'Keep',
    chip: 'bg-emerald-500/20 text-emerald-300',
    row: 'border-l-emerald-500',
  },
};

interface LedgerEntry {
  targetRef: string;
  action: string;
  enabled: boolean;
  source: string;
}

interface LedgerState {
  entries: LedgerEntry[];
  summary: Record<string, number>;
}

export function LedgerPanel() {
  const [state, setState] = useState<LedgerState | null>(null);
  const [css, setCss] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getLedgerState();
      setState(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleToggle = useCallback(
    async (targetRef: string) => {
      try {
        await api.toggleLedgerEntry(targetRef);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const handleActionToggle = useCallback(
    async (action: string, enabled: boolean) => {
      try {
        await api.setLedgerActionEnabled(action, enabled);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const handleGetCss = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getLedgerCss();
      setCss(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleCopyCss = useCallback(async () => {
    if (!css) return;
    try {
      await navigator.clipboard.writeText(css);
    } catch {
      // clipboard may be unavailable in some environments — silently ignore
    }
  }, [css]);

  // Group entries by action
  const grouped = new Map<LedgerAction, LedgerEntry[]>();
  for (const action of LEDGER_ACTIONS) {
    grouped.set(action, []);
  }
  for (const entry of state?.entries ?? []) {
    const key = (entry.action as LedgerAction) ?? 'keep';
    grouped.get(key)?.push(entry);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header with actions */}
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">Transform Ledger</h3>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => void handleGetCss()}
          disabled={loading}
          className="ml-auto rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground hover:bg-accent/80 disabled:opacity-50"
        >
          Get CSS
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Summary bar */}
      {state && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{state.entries.length} entries</span>
          <span>·</span>
          <span>{state.summary.enabled ?? 0} enabled</span>
        </div>
      )}

      {/* Grouped entries */}
      {state === null ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          {loading ? 'Loading…' : 'No ledger entries'}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {LEDGER_ACTIONS.map((action) => {
            const entries = grouped.get(action) ?? [];
            if (entries.length === 0) return null;
            const allEnabled = entries.every((e) => e.enabled);
            const style = ACTION_STYLE[action as LedgerAction];

            return (
              <div key={action} className="flex flex-col gap-1">
                {/* Group header */}
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${style.chip}`}
                  >
                    {style.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{entries.length}</span>
                  <label className="ml-auto flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={allEnabled}
                      onChange={() => void handleActionToggle(action, !allEnabled)}
                      className="size-3 accent-accent"
                    />
                    all
                  </label>
                </div>

                {/* Entries */}
                {entries.map((entry) => (
                  <div
                    key={`${entry.action}:${entry.targetRef}`}
                    className={`flex items-center gap-2 rounded-md border border-border border-l-2 bg-muted/30 px-2 py-1.5 ${style.row}`}
                  >
                    <label className="flex flex-1 cursor-pointer items-center gap-2 overflow-hidden">
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        onChange={() => void handleToggle(entry.targetRef)}
                        className="size-3 shrink-0 accent-accent"
                      />
                      <span className="truncate text-[11px] text-foreground">
                        {entry.targetRef}
                      </span>
                    </label>
                    <span className="shrink-0 rounded-md bg-background px-1 py-0.5 text-[10px] text-muted-foreground">
                      {entry.source}
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* CSS output */}
      {css !== null && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-muted-foreground">Generated CSS</span>
            <button
              type="button"
              onClick={() => void handleCopyCss()}
              className="rounded-md p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Copy CSS"
              title="Copy CSS"
            >
              <Copy className="size-3" />
            </button>
          </div>
          <pre
            className="max-h-40 overflow-auto rounded-md border border-border bg-background p-2 text-[10px] text-foreground"
            style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
          >
            {css || '/* no rules — all entries disabled or only keep actions */'}
          </pre>
        </div>
      )}
    </div>
  );
}
