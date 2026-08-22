// SPDX-License-Identifier: MPL-2.0

/**
 * InjectResultsPanel — 右侧详情侧栏：预览 + 元数据 + agent 注入按钮 + 渲染设置。
 * 所有状态与回调通过 props 注入，无业务逻辑。
 */

import { AppMark } from '@/components/app-mark';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Spinner } from '@/components/ui/spinner';
import { AgentStatusDot } from '@/components/workspace/AgentStatusDot';
import { cn } from '@/lib/utils';
import { formatSize } from '@/lib/wallpaperUtils';

import type { UiMessages } from '@shared/i18n';
import type { AgentId, AppStatus, WallpaperInfo, WallpaperRenderOptions } from '@shared/types';
import { AGENT_IDS, AGENT_META } from '@shared/types';
import { CheckCircle2, Image, Video } from 'lucide-react';
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
    <aside className="flex w-[280px] shrink-0 flex-col  bg-card2">
      {/* Header — type badge + title + close */}
      <div className="flex items-center gap-2  px-3 py-2">
        <span className="shrink-0 rounded-md bg-muted px-1 py-0 font-mono text-[10px]  text-muted-foreground">
          {selected.type === 'video'
            ? t.weFilterVideo
            : selected.type === 'image'
              ? t.weFilterImage
              : selected.type === 'web'
                ? t.weFilterWeb
                : t.weFilterScene}
        </span>
        <span className="min-w-0 flex-1 truncate font-display text-[13px] font-bold tracking-tight">
          {selected.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          ✕
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {/* Batch progress bar */}
        {batchProgress && (
          <div className="flex items-center gap-2">
            <div className="h-[4px] flex-1 overflow-hidden rounded-md bg-muted">
              <div
                className="h-full rounded-md bg-primary transition-all duration-slow"
                style={{ width: `${(batchProgress.done / batchProgress.total) * 100}%` }}
              />
            </div>
            <span className="font-mono text-[10px]  text-muted-foreground">
              {t.weApplyingAll(batchProgress.done, batchProgress.total)}
            </span>
          </div>
        )}

        {/* Preview */}
        <div className="aspect-video w-full shrink-0 overflow-hidden rounded-md bg-card2">
          <WallpaperPreview
            key={selected.id}
            playback={selected.playback}
            mediaUrl={selectedVideo.url}
            previewUrl={selected.previewUrl}
            loading={selectedVideo.loading}
            className="size-full object-cover"
            loadingNode={
              <div className="flex size-full items-center justify-center">
                <Spinner className="size-5 text-muted-foreground/50" />
              </div>
            }
            emptyNode={
              <div className="flex size-full items-center justify-center">
                {selected.type === 'video' ? (
                  <Video className="size-8 text-muted-foreground" />
                ) : (
                  <Image className="size-8 text-muted-foreground" />
                )}
              </div>
            }
          />
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2 font-mono text-[10px]  text-muted-foreground">
          <span className="font-semibold text-foreground/80">{formatSize(selected.sizeBytes)}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{selected.source === 'workshop' ? 'WORKSHOP' : t.weFilterLocal.toUpperCase()}</span>
          {selected.tags.length > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="truncate opacity-70">{selected.tags.slice(0, 3).join(' • ')}</span>
            </>
          )}
        </div>

        {/* Preview-only warning */}
        {selected.previewOnly && (
          <p className="rounded-md bg-cr-warning/10 px-2 py-1 font-mono text-[10px] leading-tight text-cr-warning">
            {t.wePreviewOnlyHint}
          </p>
        )}

        {/* Actions row */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSetUiBackground}
            className={cn(
              'rounded-md px-2 py-1 text-[10px] font-semibold  transition-colors',
              isUiBackground
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {isUiBackground ? t.wallpaperSelected : t.wallpaperEnable}
          </button>

          <div className="h-4 w-px bg-border" />

          {/* Per-agent apply buttons */}
          {AGENT_IDS.filter((agentId) => appStatusFor(agentId)?.installed).map((agentId) => {
            const agentSetting = agentWallpapers[agentId] ?? { enabled: false, id: null };
            const isApplied = agentSetting.enabled && agentSetting.id === selected.id;
            const isApplying = applyingTo === agentId;
            const status = appStatusFor(agentId);
            const isInstalled = status?.installed ?? false;
            const isRunning = status?.running ?? false;
            const isReady = status?.debugReady ?? false;
            const lastResult = injectResults[agentId];
            const isFail = lastResult?.status === 'fail';
            const stateLabel = isApplying
              ? t.weStatusInjecting
              : isApplied
                ? t.weStatusApplied
                : isFail
                  ? t.weStatusFailed
                  : !isInstalled
                    ? t.weStatusNotInstalled
                    : !isRunning
                      ? t.weStatusOffline
                      : isReady
                        ? t.weStatusReady
                        : t.weStatusRunning;
            const canInject = isRunning && !isApplying && !selected.previewOnly;
            const failDetail = isFail && lastResult?.detail ? `\n${lastResult.detail}` : '';
            return (
              <div key={agentId} className="flex flex-col items-center gap-1">
                <button
                  type="button"
                  onClick={() => (isApplied ? onRemove(agentId) : onApply(agentId))}
                  disabled={!canInject && !isApplied}
                  title={`${AGENT_META[agentId].displayName} · ${stateLabel}${status?.port ? ` · :${status.port}` : ''}${failDetail}`}
                  className={cn(
                    'relative flex size-8 items-center justify-center rounded-md border transition-all duration-slow',
                    isApplied
                      ? 'border-cr-success/60 bg-cr-success/10'
                      : isFail
                        ? 'border-destructive/50 bg-destructive/5'
                        : isReady
                          ? 'border-cr-info/50 bg-cr-info/5 hover:border-cr-info/70 hover:bg-cr-info/10'
                          : isRunning
                            ? 'bg-muted/30 hover:bg-muted'
                            : isInstalled
                              ? 'border-cr-warning/30 bg-cr-warning/5 opacity-60'
                              : 'bg-muted/20 opacity-35 cursor-not-allowed',
                    isApplying && 'opacity-60',
                  )}
                >
                  {isApplying ? (
                    <div className="size-4 animate-spin rounded-full border-[1.5px] border-muted-foreground/30 border-t-foreground" />
                  ) : isApplied ? (
                    <CheckCircle2 className="size-4.5 text-cr-success" />
                  ) : (
                    <AppMark appId={agentId} size={18} />
                  )}
                  {!isApplying && (
                    <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
                      {isReady && !isApplied && !isFail && (
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                      )}
                      <span
                        className={cn(
                          'relative inline-flex size-2.5 rounded-full ring-2 ring-background transition-colors duration-slower',
                          isApplied
                            ? 'bg-cr-success'
                            : isFail
                              ? 'bg-destructive'
                              : isReady
                                ? 'bg-cyan-400'
                                : isRunning
                                  ? 'bg-cr-info'
                                  : isInstalled
                                    ? 'bg-cr-warning/70'
                                    : 'bg-transparent',
                        )}
                      />
                    </span>
                  )}
                </button>
                <span
                  className={cn(
                    'max-w-[3.5rem] truncate text-center font-mono text-[10px]  leading-tight transition-colors duration-slower',
                    isApplied
                      ? 'text-cr-success'
                      : isFail
                        ? 'text-destructive'
                        : isReady
                          ? 'text-cr-info'
                          : isRunning
                            ? 'text-muted-foreground'
                            : 'text-muted-foreground/60',
                  )}
                >
                  {stateLabel}
                </span>
              </div>
            );
          })}

          {/* Apply to all running agents */}
          <button
            type="button"
            onClick={onApplyAll}
            disabled={
              !!batchProgress || !!applyingTo || runningAgentCount === 0 || selected.previewOnly
            }
            title={
              selected.previewOnly
                ? t.wePreviewOnlyHint
                : runningAgentCount > 0
                  ? t.weRunningAgents(runningAgentCount)
                  : t.weNoRunningAgents
            }
            className={cn(
              'flex items-center gap-1 rounded-md  px-2 py-1 text-[10px] font-semibold  transition-colors',
              batchProgress || applyingTo || selected.previewOnly
                ? 'cursor-not-allowed border-muted bg-muted text-muted-foreground opacity-60'
                : runningAgentCount > 0
                  ? 'border-primary/30 bg-primary/5 text-primary hover:bg-primary/10'
                  : 'bg-muted/20 text-muted-foreground opacity-40 cursor-not-allowed',
            )}
          >
            {batchProgress
              ? t.weApplyingAll(batchProgress.done, batchProgress.total)
              : t.weApplyAll}
          </button>
        </div>

        {/* Running agents hint */}
        <p className="flex items-center gap-1 font-mono text-[10px]  text-muted-foreground">
          <AgentStatusDot
            size="xs"
            variant={isRefreshing ? 'refreshing' : runningAgentCount > 0 ? 'active' : 'offline'}
          />
          {runningAgentCount > 0 ? t.weRunningAgents(runningAgentCount) : t.weNoRunningAgents}
          {readyAgentCount > 0 && readyAgentCount < runningAgentCount && (
            <span className="text-cr-info">{`(${readyAgentCount} ${t.weStatusReady})`}</span>
          )}
        </p>

        {/* Render settings */}
        <Accordion type="single" collapsible defaultValue="render">
          <AccordionItem value="render" className="border-b-0">
            <AccordionTrigger className="py-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground">
              RENDER_SETTINGS
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
