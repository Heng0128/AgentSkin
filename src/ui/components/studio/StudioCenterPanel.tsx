// SPDX-License-Identifier: MPL-2.0

import { BundleStudioTab } from '@/components/studio/BundleStudioTab';
import { InspectStudioTab } from '@/components/studio/InspectStudioTab';
import { RealDomPreview } from '@/components/studio/RealDomPreview';
import {
  fingerprintFromSnapshot,
  type StudioColorSets,
  type ToolOverride,
} from '@/components/studio/Toolbox';
import { WallpaperStudioPanel } from '@/components/studio/WallpaperStudioPanel';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { AppController } from '@/hooks/useAppController';

import { BeakerIcon, EyeIcon, RefreshIcon, Search01Icon } from '@hugeicons/core-free-icons';
import type { AgentId, ThemeVisualSnapshot } from '@shared/types';

export type PreviewView = 'theme' | 'wallpaper' | 'bundle' | 'inspect';

export type BaselineState = {
  baseline: ThemeVisualSnapshot | null;
  baselineLoading: boolean;
};

/**
 * Studio center panel — tab bar + canvas (theme preview / wallpaper / bundle /
 * inspect) + fingerprint bar. Controlled presentational component.
 */
export function StudioCenterPanel({
  t,
  previewView,
  setPreviewView,
  snapshotState,
  baseline,
  baselineLoading,
  searchQuery,
  setSearchQuery,
  inspectMode,
  toggleInspect,
  activeAgent,
  handleSnapshot,
  handleBaselineSnapshot,
  pinnedSelectors,
  setPinnedSelectors,
  toolOverrides,
  studioColorSets,
  activeProject,
  onToast,
}: {
  t: AppController['t'];
  previewView: PreviewView;
  setPreviewView: (v: PreviewView) => void;
  snapshotState: {
    snapshot: ThemeVisualSnapshot | null;
    loading: boolean;
    error: string | null;
    themeName: string;
  };
  baseline: ThemeVisualSnapshot | null;
  baselineLoading: boolean;
  activeProject: import('@shared/types').StudioProject | null;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  inspectMode: boolean;
  toggleInspect: () => void;
  activeAgent: AgentId | null;
  handleSnapshot: () => void;
  handleBaselineSnapshot: () => void;
  pinnedSelectors: string[];
  setPinnedSelectors: React.Dispatch<React.SetStateAction<string[]>>;
  toolOverrides: ToolOverride | null;
  studioColorSets: StudioColorSets | undefined;
  onToast: (msg: string, type?: 'default' | 'destructive') => void;
}) {
  return (
    <div className="flex min-h-0 flex-col" style={{ background: 'var(--bg, var(--background))' }}>
      {/* Tools tab bar */}
      <div
        className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border px-3"
        style={{ background: 'var(--surface)' }}
      >
        <Tabs
          value={previewView}
          onValueChange={(v) => setPreviewView(v as PreviewView)}
          className="w-auto"
        >
          <TabsList variant="line" className="h-7 gap-0.5 rounded-[2px] bg-transparent p-0">
            {(
              [
                ['theme', '主题', !snapshotState.snapshot],
                ['wallpaper', '壁纸', false],
                ['bundle', '打包', false],
                ['inspect', '检查', false],
              ] as const
            ).map(([view, label, disabled]) => (
              <TabsTrigger
                key={view}
                value={view}
                disabled={disabled}
                className="h-6 rounded-[2px] px-2.5 font-mono text-[9.5px] font-medium uppercase transition-colors duration-fast data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                style={{ letterSpacing: '0.06em' }}
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Search + Inspect + Snapshot buttons */}
        <div className="ml-auto flex items-center gap-1">
          <InputGroup className="h-6 w-40">
            <InputGroupInput
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="筛选节点…"
              aria-label="筛选节点"
              className="h-6 font-mono text-[10px]"
            />
            <InputGroupAddon align="inline-start">
              <HugeIcon
                icon={Search01Icon}
                className="size-2.5"
                style={{ color: 'var(--muted-foreground)' }}
              />
            </InputGroupAddon>
          </InputGroup>
          <Button
            size="sm"
            variant={inspectMode ? 'default' : 'outline'}
            disabled={!activeAgent}
            onClick={toggleInspect}
            className="h-6 gap-1 px-2 font-mono text-[9.5px] uppercase"
            style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
          >
            <HugeIcon icon={Search01Icon} className="size-2.5" />
            {inspectMode ? '停止' : '检查'}
          </Button>
          <Button
            size="sm"
            disabled={!activeAgent || snapshotState.loading}
            onClick={handleSnapshot}
            className="h-6 gap-1 px-2 font-mono text-[9.5px] uppercase"
            style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
          >
            {snapshotState.loading ? (
              <Spinner data-icon="inline-start" className="size-2.5" />
            ) : (
              <HugeIcon icon={EyeIcon} className="size-2.5" />
            )}
            {snapshotState.loading ? t.studioSnapshooting : t.studioSnapshotButton}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!activeAgent || baselineLoading}
            onClick={handleBaselineSnapshot}
            className="h-6 gap-1 px-2 font-mono text-[9.5px] uppercase"
            style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
            title="还原 agent 到无主题原生态后抓取，抓完自动重上原主题"
          >
            {baselineLoading ? (
              <Spinner data-icon="inline-start" className="size-2.5" />
            ) : (
              <HugeIcon icon={RefreshIcon} className="size-2.5" />
            )}
            BASELINE
          </Button>
        </div>
      </div>

      {/* Canvas area */}
      <div
        className="relative flex-1 overflow-auto p-4"
        style={{ background: 'var(--bg, var(--background))' }}
      >
        {/* Empty state overlay */}
        {!snapshotState.snapshot && !baseline && !snapshotState.loading && !baselineLoading && (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center">
            <div
              className="flex size-14 items-center justify-center border border-border"
              style={{ background: 'var(--card)', borderRadius: 'var(--radius)' }}
            >
              <HugeIcon icon={BeakerIcon} className="size-7 text-muted-foreground/40" />
            </div>
            {!activeProject ? (
              <>
                <p
                  className="font-mono text-[11px] font-medium"
                  style={{ color: 'var(--foreground)' }}
                >
                  请先新建或导入一个工程
                </p>
                <p
                  className="max-w-xs font-mono text-[10px] leading-relaxed"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  工作室不再依赖已安装主题。左侧「NEW」从零设计，或「IMPORT」载入一个
                  .agentskin-theme。
                </p>
              </>
            ) : (
              <>
                <p
                  className="font-mono text-[11px] font-medium"
                  style={{ color: 'var(--foreground)' }}
                >
                  点击「SNAP」复刻 {activeProject.name} 的真实界面
                </p>
                <p
                  className="max-w-xs font-mono text-[10px] leading-relaxed"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  可抓取「CURRENT」（带主题）或「RAW」（无主题）两种状态，切换上方标签对照查看。
                </p>
              </>
            )}
          </div>
        )}
        {/* THEME: RealDomPreview */}
        {previewView === 'theme' && snapshotState.snapshot && (
          <RealDomPreview
            domTree={snapshotState.snapshot.domTree}
            overrides={toolOverrides}
            colorSets={studioColorSets}
          />
        )}
        {previewView === 'theme' && !snapshotState.snapshot && (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2">
            <p className="font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
              点击「SNAP」抓取主题快照后在此编辑
            </p>
          </div>
        )}
        {/* WALLPAPER */}
        {previewView === 'wallpaper' && (
          <WallpaperStudioPanel
            activeAgent={activeAgent}
            activeWallpaperId={null}
            onToast={onToast}
          />
        )}
        {/* BUNDLE */}
        {previewView === 'bundle' && <BundleStudioTab onToast={onToast} />}
        {/* INSPECT */}
        {previewView === 'inspect' && (
          <InspectStudioTab
            activeAgent={activeAgent}
            pinnedSelectors={pinnedSelectors}
            onPinSelector={(sel) => setPinnedSelectors((prev) => [...prev, sel])}
            onToast={onToast}
          />
        )}
      </div>

      {/* Fingerprint bar */}
      {snapshotState.snapshot && (
        <div
          className="flex h-6 shrink-0 items-center border-t border-border px-3 font-mono text-[9px]"
          style={{
            background: 'var(--muted)',
            color: 'var(--muted-foreground)',
            letterSpacing: '0.1em',
          }}
        >
          <span>指纹</span>
          <span className="mx-2" style={{ color: 'var(--border)' }}>
            |
          </span>
          <span style={{ color: 'var(--foreground)' }}>
            {fingerprintFromSnapshot(snapshotState.snapshot)}
          </span>
        </div>
      )}
    </div>
  );
}
