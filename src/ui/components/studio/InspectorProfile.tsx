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

import { AppMark } from '@/components/AppMark';
import { EmptyState } from '@/components/ui/empty-state';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { AGENT_META, isAnyAgentId } from '@shared/types';
import { Search } from 'lucide-react';

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
      <EmptyState
        icon={<Search />}
        title={t.studioNoAnalysisRunning}
        iconSize="sm"
        className="py-6 px-2"
      />
    );
  }

  const { agent, step, progress } = analysisProgress;
  const agentMeta = isAnyAgentId(agent) ? AGENT_META[agent] : undefined;
  const currentStepIndex = ANALYSIS_STEPS.findIndex((s) => s.id === step);

  return (
    <div className="space-y-2">
      {/* Header: agent + step badge */}
      <div className="border border-border bg-muted p-2 rounded-md">
        <div className="flex items-center gap-1">
          <AppMark appId={agent as never} size={10} />
          <span className="text-micro font-normal   text-muted-foreground">
            {agentMeta?.displayName ?? agent}
          </span>
          <span className="ml-auto rounded-md bg-primary px-1 py-0 text-micro font-normal text-white">
            {step}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-micro   text-muted-foreground">{t.studioProgress}</span>
          <span className="text-micro font-normal tabular-nums text-muted-foreground">
            {progress}%
          </span>
        </div>
        <div
          className="h-[2px] w-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t.studioProgress}
        >
          <div
            className="h-full bg-primary transition-[width] duration-slow"
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
            <div key={s.id} className="flex items-center gap-1 py-1">
              {/* Status dot — shape differs by state so it is not colour-only */}
              <span
                className={[
                  'size-[3px]',
                  isComplete && 'rounded-[1px] bg-primary',
                  isCurrent && 'rounded-[2px] bg-primary',
                  isPending && 'rounded-[2px] bg-muted border border-border',
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
              <span
                className={[
                  'text-micro',
                  isCurrent && 'font-normal text-foreground',
                  isComplete && 'text-muted-foreground',
                  isPending && 'text-muted-foreground',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {t[s.labelKey] as string}
              </span>
              {isComplete && (
                <span className="ml-auto text-micro text-primary" aria-hidden="true">
                  ✓
                </span>
              )}
              {isCurrent && (
                <span className="ml-auto text-micro tabular-nums text-muted-foreground">
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
