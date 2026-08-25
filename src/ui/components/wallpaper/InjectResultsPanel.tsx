// SPDX-License-Identifier: MPL-2.0

/**
 * InjectResultsPanel — 右侧详情侧栏：预览 + 元数据 + agent 注入列表 + 渲染设置。
 * 所有状态与回调通过 props 注入，无业务逻辑。
 */

import { AppMark } from '@/components/AppMark';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AgentStatusDot } from '@/components/workspace/AgentStatusDot';
import { cn } from '@/lib/utils';
import { formatSize } from '@/lib/wallpaperUtils';

import type { UiMessages } from '@shared/i18n';
import type { AgentId, AppStatus, WallpaperInfo, WallpaperRenderOptions } from '@shared/types';
import { AGENT_IDS, AGENT_META } from '@shared/types';
import { CheckCircle2, Image, Video, X } from 'lucide-react';
import { RenderSettingsPanel } from './RenderSettingsPanel';
import { WallpaperPreview } from './WallpaperCard';

export interface AgentInjectResult {
  status: 'ok' | 'fail';
  detail?: string;
}

export interface InjectResultsPanelProps {
  selected: WallpaperInfo;
  renderDraft: WallpaperRenderOptions | undefined;
  onRenderDraftChange: (d: WallpaperRenderOptions | undefined) => void;
  isUiBackground: boolean;
  enabled: boolean;
  onSetUiBackground: () => void;
  applyingTo: AgentId | null;
  batchProgress: { done: number; total: number } | null;
  injectResults: Partial<Record<AgentId, AgentInjectResult>>;
  runningAgentCount: number;
  readyAgentCount: number;
  appStatusFor: (id: AgentId) => AppStatus | null;
  agentWallpapers: Record<string, { enabled: boolean; id: string | null }>;
  isRefreshing: boolean;
  relativeTime: string;
  selectedVideo: { url: string | null; loading: boolean };
  onClose: () => void;
  onApply: (agentId: AgentId) => void;
  onRemove: (agentId: AgentId) => void;
  onApplyAll: () => void;
  t: UiMessages;
}

function typeIcon(type: WallpaperInfo['type']) {
  if (type === 'video') return <Video className="size-3.5" />;
  return <Image className="size-3.5" />;
}

function typeLabel(t: UiMessages, type: WallpaperInfo['type']) {
  switch (type) {
    case 'video':
      return t.weFilterVideo;
    case 'image':
      return t.weFilterImage;
    case 'web':
      return t.weFilterWeb;
    default:
      return t.weFilterScene;
  }
}

export function InjectResultsPanel({
  selected,
  renderDraft,
  onRenderDraftChange,
  isUiBackground,
  enabled: _enabled,
  onSetUiBackground,
  applyingTo,
  batchProgress,
  injectResults,
  runningAgentCount,
  readyAgentCount,
  appStatusFor,
  agentWallpapers,
  isRefreshing,
  relativeTime: _relativeTime,
  selectedVideo,
  onClose,
  onApply,
  onRemove,
  onApplyAll,
  t,
}: InjectResultsPanelProps) {
  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {typeIcon(selected.type)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-tight">{selected.title}</p>
          <p className="text-[10px] text-muted-foreground">
            {typeLabel(t, selected.type)}
            {selected.sizeBytes ? ` · ${formatSize(selected.sizeBytes)}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* Preview */}
        <div className="overflow-hidden rounded-lg border border-border">
          <WallpaperPreview
            playback={selected.playback}
            mediaUrl={selectedVideo.url}
            previewUrl={selected.previewUrl}
            loading={selectedVideo.loading}
            alt={selected.title}
            className="aspect-video w-full object-cover"
            loadingNode={
              <div className="flex aspect-video w-full items-center justify-center">
                <Spinner className="size-5 text-muted-foreground/50" />
              </div>
            }
            emptyNode={
              <div className="flex aspect-video w-full items-center justify-center bg-muted">
                <Image className="size-8 text-muted-foreground/40" />
              </div>
            }
          />
        </div>

        {/* Set as UI background */}
        <button
          type="button"
          onClick={onSetUiBackground}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors',
            isUiBackground
              ? 'border-cr-success/30 bg-cr-success/10 text-cr-success'
              : 'border-border bg-muted/30 text-foreground hover:bg-muted/60',
          )}
        >
          {isUiBackground ? (
            <CheckCircle2 className="size-4" />
          ) : (
            <Image className="size-4 text-muted-foreground" />
          )}
          {isUiBackground ? t.weUiBackgroundApplied : t.weSetAsUiBackground}
        </button>

        {/* Apply to agents */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              {t.weApplyToAgents}
            </span>
            {runningAgentCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <AgentStatusDot size="xs" variant={isRefreshing ? 'refreshing' : 'active'} />
                {t.weRunningAgents(runningAgentCount)}
                {readyAgentCount > 0 && readyAgentCount < runningAgentCount && (
                  <span className="text-cr-info">{`(${readyAgentCount} ${t.weStatusReady})`}</span>
                )}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1">
            {AGENT_IDS.map((agentId) => {
              const meta = AGENT_META[agentId];
              const appStatus = appStatusFor(agentId);
              const isRunning = Boolean(appStatus?.running);
              const isReady = Boolean(appStatus?.debugReady);
              const isApplying = applyingTo === agentId;
              const result = injectResults[agentId];
              const wpState = agentWallpapers[agentId];
              const isApplied = wpState?.enabled && wpState?.id === selected.id;

              return (
                <div
                  key={agentId}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                    isApplied
                      ? 'border-cr-success/30 bg-cr-success/[0.04]'
                      : 'border-border bg-muted/30',
                    !isRunning && 'opacity-50',
                  )}
                >
                  <AppMark appId={agentId} size={18} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium leading-tight">
                      {meta.displayName}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {isApplying
                        ? t.weApplying
                        : result?.status === 'ok'
                          ? t.weStatusApplied
                          : result?.status === 'fail'
                            ? t.weApplyFailed
                            : isReady
                              ? t.weStatusReady
                              : isRunning
                                ? t.weStatusRunning
                                : t.weStatusOffline}
                    </p>
                  </div>
                  {isApplied && !isApplying ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                      onClick={() => onRemove(agentId)}
                    >
                      {t.weRemove}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant={isRunning ? 'default' : 'outline'}
                      className="h-7 px-2.5 text-[11px]"
                      disabled={!isRunning || isApplying || batchProgress !== null}
                      onClick={() => onApply(agentId)}
                    >
                      {isApplying && <Spinner data-icon="inline-start" />}
                      {t.weApply}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Apply all */}
          <button
            type="button"
            onClick={onApplyAll}
            disabled={applyingTo !== null || batchProgress !== null || runningAgentCount === 0}
            className={cn(
              'mt-2 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors',
              applyingTo !== null || batchProgress !== null
                ? 'cursor-not-allowed border-muted bg-muted text-muted-foreground opacity-60'
                : runningAgentCount > 0
                  ? 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10'
                  : 'cursor-not-allowed bg-muted/20 text-muted-foreground opacity-40',
            )}
          >
            {batchProgress
              ? t.weApplyingAll(batchProgress.done, batchProgress.total)
              : t.weApplyAll}
          </button>

          {batchProgress && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-fast"
                style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
              />
            </div>
          )}
        </div>

        {/* Render settings */}
        <Accordion type="single" collapsible defaultValue="render">
          <AccordionItem value="render" className="border-b-0">
            <AccordionTrigger className="py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground">
              {t.weRenderSettings}
            </AccordionTrigger>
            <AccordionContent>
              <RenderSettingsPanel
                value={renderDraft}
                onChange={onRenderDraftChange}
                playback={selected.playback}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </aside>
  );
}
