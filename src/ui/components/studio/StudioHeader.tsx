// SPDX-License-Identifier: MPL-2.0

import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AppController } from '@/hooks/useAppController';
import { appStatusFor } from '@/stores/agentStore';
import { useStudioStore } from '@/stores/studioStore';

import { Download01Icon, RefreshIcon } from '@hugeicons/core-free-icons';
import type { AgentId } from '@shared/types';
import { AGENT_IDS, AGENT_META } from '@shared/types';

/**
 * Studio top toolbar — brand cluster + agent selector + restore/export actions.
 * Reads shared studio state directly from {@link useStudioStore}.
 */
export function StudioHeader({ t }: { t: AppController['t'] }) {
  const activeProject = useStudioStore((s) => s.getActiveProject());
  const snapshot = useStudioStore((s) => s.snapshot);
  const exportState = useStudioStore((s) => s.exportState);
  const changeAgent = useStudioStore((s) => s.changeAgent);
  const restoreAgent = useStudioStore((s) => s.restoreAgent);
  const exportTheme = useStudioStore((s) => s.exportTheme);

  const activeAgent = activeProject?.agentId ?? null;

  return (
    <div
      className="flex h-[44px] shrink-0 items-center border-b border-border px-4"
      style={{ background: 'var(--surface)' }}
    >
      {/* Left: brand cluster */}
      <div className="flex items-center gap-2.5">
        <span
          className="font-display text-sm font-bold"
          style={{ color: 'var(--primary)', lineHeight: 1 }}
        >
          ✦
        </span>
        <span
          className="font-mono text-[11px] font-semibold uppercase"
          style={{ color: 'var(--foreground)', letterSpacing: '0.08em' }}
        >
          Theme Studio
        </span>
        <span
          className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase"
          style={{
            background: 'var(--primary)',
            color: 'var(--primary-foreground)',
            letterSpacing: '0.1em',
          }}
        >
          BETA
        </span>
        {activeProject && (
          <span className="ml-1 font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
            / {activeProject.name}
          </span>
        )}
      </div>

      {/* Center: agent selector */}
      {activeProject && (
        <div className="ml-6 flex items-center gap-1.5">
          <span
            className="font-mono text-[9px] uppercase"
            style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
          >
            代理
          </span>
          <Select
            value={activeAgent ?? undefined}
            onValueChange={(v) => void changeAgent(v as AgentId)}
          >
            <SelectTrigger
              id="studio-agent-select"
              className="h-6 w-auto rounded-[2px] border-border bg-muted px-2 font-mono text-[10px] focus:border-primary/60"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-[2px] border-border bg-card">
              {AGENT_IDS.filter((agentId) => Boolean(appStatusFor(agentId)?.installed)).map(
                (agentId) => (
                  <SelectItem key={agentId} value={agentId} className="font-mono text-[10px]">
                    {AGENT_META[agentId].displayName}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Right: action buttons */}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          disabled
          className="flex h-7 items-center gap-1 border border-border px-2 font-mono text-[9.5px] uppercase transition-colors hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
          title="撤销"
        >
          ↶ 撤销
        </button>
        <button
          type="button"
          disabled
          className="flex h-7 items-center gap-1 border border-border px-2 font-mono text-[9.5px] uppercase transition-colors hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
          title="灵感"
        >
          ✦ 灵感
        </button>
        {snapshot && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void restoreAgent()}
            className="h-7 gap-1 px-2 font-mono text-[9.5px] uppercase"
            style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
          >
            <HugeIcon icon={RefreshIcon} className="size-3" />
            {t.studioRestoreDefault}
          </Button>
        )}
        <button
          type="button"
          className="flex h-7 items-center gap-1 border border-border bg-primary px-3 font-mono text-[9.5px] font-bold uppercase text-primary-foreground transition-opacity hover:opacity-90"
          style={{ letterSpacing: '0.08em', borderRadius: 'var(--radius)' }}
          onClick={() => void exportTheme()}
          disabled={!snapshot || exportState.loading}
        >
          <HugeIcon icon={Download01Icon} className="size-3" />
          导出
        </button>
      </div>
    </div>
  );
}
