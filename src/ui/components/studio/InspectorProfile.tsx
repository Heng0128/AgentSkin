// SPDX-License-Identifier: MPL-2.0

/**
 * # InspectorProfile
 *
 * Right inspector "Profile" tab — live visual-analysis progress pipeline.
 * Subscribes to `analysisProgress` from studioStore (pushed by main process
 * via `visual-analysis:status` IPC) and renders a step timeline + progress bar.
 *
 * Empty state when no analysis is running. International design:
 * mono font, tabular-nums, 10px sizing, single accent color.
 */

import { AppMark } from '@/components/app-mark';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { AGENT_META, isAnyAgentId } from '@shared/types';

/** Ordered analysis steps for the timeline display. */
const ANALYSIS_STEPS: { id: string; labelKey: keyof UiMessages }[] = [
  { id: 'cdp-connect', labelKey: 'studioAnalysisStepCdpConnect' },
  { id: 'dom-capture', labelKey: 'studioAnalysisStepDomCapture' },
  { id: 'color-quantize', labelKey: 'studioAnalysisStepQuantize' },
  { id: 'color-extract', labelKey: 'studioAnalysisStepExtract' },
  { id: 'profile-build', labelKey: 'studioAnalysisStepBuild' },
];

export function InspectorProfile({ t }: { t: UiMessages }) {
  const analysisProgress = useStudioStore((s) => s.analysisProgress);

  if (!analysisProgress) {
    return (
      <div className="flex flex-col items-center justify-center py-6 px-2 text-center">
        <div
          className="border border-dashed border-[var(--border-subtle)] p-3"
          style={{ borderRadius: 'var(--r-xs)' }}
        >
          <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioNoAnalysisRunning}</p>
        </div>
      </div>
    );
  }

  const { agent, step, progress } = analysisProgress;
  const agentMeta = isAnyAgentId(agent) ? AGENT_META[agent] : undefined;
  const currentStepIndex = ANALYSIS_STEPS.findIndex((s) => s.id === step);

  return (
    <div className="space-y-[var(--space-2)]">
      {/* Header: agent + step badge */}
      <div
        className="border border-[var(--border-subtle)] bg-[var(--bg-3)] p-2"
        style={{ borderRadius: 'var(--r-xs)' }}
      >
        <div className="flex items-center gap-[var(--space-1)]">
          <AppMark appId={agent as never} size={10} />
          <span className="font-mono text-[10px] font-semibold   text-[var(--fg-2)]">
            {agentMeta?.displayName ?? agent}
          </span>
          <span className="ml-auto rounded-[var(--r-micro)] bg-[var(--accent)] px-1 py-0 font-mono text-[10px] font-bold text-white">
            {step}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-mono text-[10px]   text-[var(--fg-2)]">{t.studioProgress}</span>
          <span className="font-mono text-[10px] font-bold tabular-nums text-[var(--fg-1)]">
            {progress}%
          </span>
        </div>
        <div className="h-[2px] w-full bg-[var(--bg-4)]">
          <div
            className="h-full bg-[var(--accent)] transition-[width] duration-300"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      </div>

      {/* Step timeline */}
      <div className="space-y-0">
        {ANALYSIS_STEPS.map((s, i) => {
          const isComplete = i < currentStepIndex || progress >= 100;
          const isCurrent = i === currentStepIndex;
          const isPending = i > currentStepIndex;
          return (
            <div key={s.id} className="flex items-center gap-[var(--space-1)] py-[3px]">
              {/* Status dot */}
              <span
                className={[
                  'size-[3px] rounded-full',
                  isComplete && 'bg-[var(--accent)]',
                  isCurrent && 'bg-[var(--accent)] animate-pulse',
                  isPending && 'bg-[var(--bg-4)] border border-[var(--border-subtle)]',
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
              <span
                className={[
                  'font-mono text-[10px]',
                  isCurrent && 'font-semibold text-[var(--fg-1)]',
                  isComplete && 'text-[var(--fg-2)]',
                  isPending && 'text-[var(--fg-3)]',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {t[s.labelKey] as string}
              </span>
              {isCurrent && (
                <span className="ml-auto font-mono text-[10px] tabular-nums text-[var(--fg-3)]">
                  {t.studioActiveStatus}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
