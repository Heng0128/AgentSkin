// SPDX-License-Identifier: MPL-2.0

/**
 * # TreatmentSummary
 *
 * Displays the full treatment classification result: per-verdict confidence
 * and evidence, plus an "Apply CSS" action that generates treatment CSS and
 * pushes it to the running agent.
 *
 * The component owns the async classify→CSS pipeline via the `api` singleton.
 * It receives the component profiles from the parent (typically derived from
 * the live DOM tree) and renders the verdicts returned by the main process.
 */

import { useState } from 'react';
import { api } from '@/api/agentSkinClient';

type TreatmentAction = 'remove' | 'transparentize' | 'frost' | 'keep';

interface TreatmentVerdict {
  ref: string;
  action: TreatmentAction;
  confidence: number;
  evidence: string[];
}

interface TreatmentSummaryData {
  verdicts: TreatmentVerdict[];
  summary: {
    remove: number;
    transparentize: number;
    frost: number;
    keep: number;
  };
}

interface TreatmentSummaryProps {
  /** Component profiles derived from the live DOM tree. */
  profiles: Array<{
    role: string;
    ref: string;
    areaRatio: number;
    hasText: boolean;
    zIndex: number;
  }>;
  /** Callback when CSS is generated (parent can push it to the agent). */
  onCssGenerated?: (css: string) => void;
  /** Whether the parent wants this panel hidden. */
  hidden?: boolean;
}

const TREATMENT_STYLES: Record<string, string> = {
  remove: 'text-destructive',
  transparentize: 'text-warning',
  frost: 'text-info',
  keep: 'text-muted-foreground',
};

export function TreatmentSummary({
  profiles,
  onCssGenerated,
  hidden = false,
}: TreatmentSummaryProps) {
  const [result, setResult] = useState<TreatmentSummaryData | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [generatingCss, setGeneratingCss] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClassify() {
    setClassifying(true);
    setError(null);
    try {
      const data = await api.classifyComponents(profiles);
      // The API returns action as string and summary as Record; cast both.
      const typed: TreatmentSummaryData = {
        verdicts: data.verdicts.map((v) => ({
          ...v,
          action: v.action as TreatmentAction,
        })),
        summary: data.summary as TreatmentSummaryData['summary'],
      };
      setResult(typed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Classification failed');
    } finally {
      setClassifying(false);
    }
  }

  async function handleApplyCss() {
    if (!result) return;
    setGeneratingCss(true);
    setError(null);
    try {
      const css = await api.generateTreatmentCss(result.verdicts);
      onCssGenerated?.(css);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'CSS generation failed');
    } finally {
      setGeneratingCss(false);
    }
  }

  if (hidden) return null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-micro font-normal text-foreground">Treatment</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={classifying || profiles.length === 0}
            onClick={handleClassify}
            className="rounded-md border border-border px-2 py-0 text-micro text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {classifying ? 'Classifying…' : 'Classify'}
          </button>
          {result && (
            <button
              type="button"
              disabled={generatingCss}
              onClick={handleApplyCss}
              className="rounded-md border border-border px-2 py-0 text-micro text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              {generatingCss ? 'Generating…' : 'Apply CSS'}
            </button>
          )}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <span className="text-micro text-destructive" role="alert">
          {error}
        </span>
      )}

      {/* Summary counts */}
      {result && (
        <div className="flex gap-2 text-micro">
          <span className="text-muted-foreground">
            Remove: <span className="tabular-nums text-destructive">{result.summary.remove}</span>
          </span>
          <span className="text-muted-foreground">
            Transparent:{' '}
            <span className="tabular-nums text-warning">{result.summary.transparentize}</span>
          </span>
          <span className="text-muted-foreground">
            Frost: <span className="tabular-nums text-info">{result.summary.frost}</span>
          </span>
          <span className="text-muted-foreground">
            Keep: <span className="tabular-nums">{result.summary.keep}</span>
          </span>
        </div>
      )}

      {/* Verdict detail list */}
      {result && result.verdicts.length > 0 && (
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-md border border-border p-1">
          {result.verdicts.map((v) => (
            <div key={v.ref} className="flex flex-col gap-0 rounded-md px-1 py-0 hover:bg-muted">
              <div className="flex items-center justify-between">
                <span className="text-micro font-mono text-muted-foreground">{v.ref}</span>
                <span className={`text-micro font-normal ${TREATMENT_STYLES[v.action] ?? ''}`}>
                  {v.action}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-micro text-muted-foreground">
                  confidence:{' '}
                  <span className="tabular-nums">{(v.confidence * 100).toFixed(0)}%</span>
                </span>
              </div>
              {v.evidence.length > 0 && (
                <div className="flex flex-wrap gap-1 pb-1">
                  {v.evidence.map((e, i) => (
                    <span
                      key={`${v.ref}-ev-${i}`}
                      className="rounded-md bg-muted px-1 py-0 text-micro text-muted-foreground font-mono"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!result && !classifying && !error && (
        <span className="text-micro text-muted-foreground">
          No classification yet. Click "Classify" to analyze components.
        </span>
      )}
    </div>
  );
}
