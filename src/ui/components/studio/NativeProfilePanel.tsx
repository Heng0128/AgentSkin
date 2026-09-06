// SPDX-License-Identifier: MPL-2.0

/**
 * # NativeProfilePanel
 *
 * Displays a compact native profile summary built from a live DomTreeNode.
 * The user triggers the build via a button that calls
 * `window.agentSkin.buildNativeProfile()` — the main process runs the
 * heuristic role classifier and returns a trimmed digest (component count,
 * role distribution, elevation ladder).
 *
 * The full AgentNativeProfile (per-component geometry, palette, contrast
 * pairs) never leaves the main process; this panel only renders the summary.
 */

import { useState } from 'react';

import type { AgentId } from '@shared/types/agent';
import type { DomTreeNode } from '@shared/types/ipc';

interface NativeProfileSummary {
  agentId: string;
  componentCount: number;
  roleDistribution: Record<string, number>;
  elevationLadder: Array<{ level: number; color: string; deltaLuminance: number }>;
}

interface NativeProfilePanelProps {
  agentId: AgentId;
  /** Live DOM tree (from captureLiveDom). Null when no agent is connected. */
  domTree: DomTreeNode | null;
}

export function NativeProfilePanel({ agentId, domTree }: NativeProfilePanelProps) {
  const [result, setResult] = useState<NativeProfileSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBuild = async () => {
    setLoading(true);
    setError(null);
    try {
      const summary = (await window.agentSkin.buildNativeProfile(domTree as DomTreeNode, {
        agentId,
        appVersion: 'live',
      })) as unknown as NativeProfileSummary;
      setResult(summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const totalRoles = result ? Object.values(result.roleDistribution).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-2">
      {/* Trigger button */}
      <button
        type="button"
        onClick={handleBuild}
        disabled={loading}
        className="flex w-full items-center justify-center gap-1 rounded-md border border-border bg-muted px-2 py-1 text-micro text-foreground transition-colors hover:bg-primary/10 disabled:opacity-50"
      >
        {loading ? 'Building…' : 'Build Native Profile'}
      </button>

      {/* Error state */}
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-micro text-destructive">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-2">
          {/* Component count */}
          <div className="flex items-center justify-between">
            <span className="text-micro text-muted-foreground">Components</span>
            <span className="text-micro font-mono tabular-nums text-foreground">
              {result.componentCount}
            </span>
          </div>

          {/* Role distribution */}
          <div className="space-y-1">
            <span className="text-micro text-muted-foreground">Role Distribution</span>
            {Object.entries(result.roleDistribution).map(([role, count]) => {
              const pct = totalRoles > 0 ? (count / totalRoles) * 100 : 0;
              return (
                <div key={role} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-micro font-mono text-muted-foreground">
                    {role}
                  </span>
                  <div className="h-1 flex-1 rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-6 shrink-0 text-right text-micro font-mono tabular-nums text-foreground">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Elevation ladder */}
          {result.elevationLadder.length > 0 && (
            <div className="space-y-1">
              <span className="text-micro text-muted-foreground">Elevation Ladder</span>
              <div className="flex items-center gap-1">
                {result.elevationLadder.map((step) => (
                  <div
                    key={step.level}
                    className="flex flex-col items-center gap-0.5"
                    title={`L${step.level} ${step.color} Δ${step.deltaLuminance.toFixed(3)}`}
                  >
                    <span
                      className="size-3 rounded-[1px] border border-border"
                      style={{ background: step.color }}
                    />
                    <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
                      {step.level}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
