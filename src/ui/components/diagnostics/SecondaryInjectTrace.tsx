// SPDX-License-Identifier: MPL-2.0

/**
 * # SecondaryInjectTrace
 *
 * Diagnostics panel — per-agent secondary (webview/iframe) CSS injection
 * trace. Subscribes to `useSecondaryInjectStore` which is fed by the main
 * process via `theme:secondary-inject-progress` and
 * `theme:secondary-inject-summary` IPC channels emitted from cdp-fanout.
 *
 * Shows a per-agent card with step timeline + summary badge. Empty state
 * when no secondary injection has been recorded yet.
 *
 * International design: mono font, tabular-nums, 10px sizing,
 * single accent color, no scale/slide animations.
 */

import { AppMark } from '@/components/AppMark';
import { EmptyState } from '@/components/ui/empty-state';
import {
  type SecondaryInjectAgentState,
  useSecondaryInjectStore,
} from '@/stores/secondaryInjectStore';

import type { UiMessages } from '@shared/i18n';
import { AGENT_META } from '@shared/types';
import { ArrowRight } from 'lucide-react';

export function SecondaryInjectTrace({ t }: { t: UiMessages }) {
  const byAgent = useSecondaryInjectStore((s) => s.byAgent);

  const agentEntries = Object.entries(byAgent);

  if (agentEntries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <EmptyState icon={<ArrowRight />} title={t.settingsSecondaryInjectEmpty} iconSize="md" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {agentEntries.map(([agentId, state]) => (
        <AgentTraceCard key={agentId} agentId={agentId} state={state} t={t} />
      ))}
    </div>
  );
}

function AgentTraceCard({
  agentId,
  state,
  t,
}: {
  agentId: string;
  state: SecondaryInjectAgentState;
  t: UiMessages;
}) {
  const agentMeta = AGENT_META[agentId as keyof typeof AGENT_META];
  const { steps, summary } = state;

  return (
    <div className="rounded-md  overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between  bg-card2 px-3 py-2">
        <div className="flex items-center gap-2">
          <AppMark appId={agentId as never} size={10} />
          <span className="font-mono text-[11px] font-normal  text-foreground">
            {agentMeta?.displayName ?? agentId}
          </span>
          <span className="text-[11px] text-muted-foreground/50">{steps.length} targets</span>
        </div>
        {summary && (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
            {t.settingsSecondaryInjectSummary(summary.injected, summary.failed, summary.total)}
          </span>
        )}
      </div>

      {/* Target timeline */}
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className=" bg-muted/20">
              <TH>{t.settingsSecondaryInjectColTarget}</TH>
              <TH>{t.settingsSecondaryInjectColType}</TH>
              <TH className="text-right">{t.settingsSecondaryInjectColElapsed}</TH>
              <TH className="text-center">{t.settingsSecondaryInjectColStatus}</TH>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={`${step.targetId}-${step.timestamp}`} className=" last:border-b-0">
                <TD>
                  <span className="font-mono text-[10px] text-foreground truncate max-w-[160px]">
                    {step.title || step.targetId}
                  </span>
                </TD>
                <TD>
                  <span className="inline-flex rounded-sm  px-1 py-0 font-mono text-[10px] text-muted-foreground">
                    {step.targetType}
                  </span>
                </TD>
                <TD className="text-right">
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {step.elapsed}ms
                  </span>
                </TD>
                <TD className="text-center">
                  {step.success ? (
                    <span className="inline-flex size-4 items-center justify-center rounded-md bg-cr-success/15 font-mono text-[10px] text-cr-success">
                      ✓
                    </span>
                  ) : (
                    <span
                      className="inline-flex size-4 items-center justify-center rounded-md bg-destructive/15 font-mono text-[10px] text-destructive"
                      title={step.error ?? 'Injection failed'}
                    >
                      ✗
                    </span>
                  )}
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TH({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={['px-3 py-2 text-left text-[10px] text-muted-foreground', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </th>
  );
}

function TD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={['px-2 py-1', className].filter(Boolean).join(' ')}>{children}</td>;
}
