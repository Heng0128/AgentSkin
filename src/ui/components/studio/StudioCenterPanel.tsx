// SPDX-License-Identifier: MPL-2.0

import { useMemo } from 'react';
import { AgentRawDualPreview } from '@/components/studio/AgentRawPreview';
import { BundleStudioTab } from '@/components/studio/BundleStudioTab';
import { FitGeneratorPanel } from '@/components/studio/FitGeneratorPanel';
import { InspectStudioTab } from '@/components/studio/InspectStudioTab';
import { RealDomPreview } from '@/components/studio/RealDomPreview';
import {
  computeSignature,
  fingerprintFromSnapshot,
  type StudioColorSets,
} from '@/components/studio/Toolbox';
import { WallpaperStudioPanel } from '@/components/studio/WallpaperStudioPanel';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useStudioStore } from '@/stores/studioStore';

import { BeakerIcon, EyeIcon, RefreshIcon, Search01Icon } from '@hugeicons/core-free-icons';
import type { UiMessages } from '@shared/i18n';

export type PreviewView = 'theme' | 'wallpaper' | 'bundle' | 'inspect' | 'generator' | 'raw';

/**
 * Studio center panel — tab bar + canvas (theme preview / wallpaper / bundle /
 * inspect) + fingerprint bar. Reads shared studio state directly from
 * {@link useStudioStore}; derived values (baseline / colorSets) are computed
 * here from the stored primitives.
 */
export function StudioCenterPanel({ t }: { t: UiMessages }) {
  const previewView = useStudioStore((s) => s.previewView);
  const setPreviewView = useStudioStore((s) => s.setPreviewView);
  const snapshot = useStudioStore((s) => s.snapshot);
  const snapshotLoading = useStudioStore((s) => s.snapshotLoading);
  const activeProject = useStudioStore((s) => s.getActiveProject());
  const activeAgent = activeProject?.agentId ?? null;
  const baselines = useStudioStore((s) => s.baselines);
  const baselineLoadingMap = useStudioStore((s) => s.baselineLoadingMap);
  const searchQuery = useStudioStore((s) => s.searchQuery);
  const setSearchQuery = useStudioStore((s) => s.setSearchQuery);
  const inspectMode = useStudioStore((s) => s.inspectMode);
  const toolOverrides = useStudioStore((s) => s.toolOverrides);
  const toggleInspect = useStudioStore((s) => s.toggleInspect);
  const captureSnapshot = useStudioStore((s) => s.captureSnapshot);
  const baselineSnapshot = useStudioStore((s) => s.baselineSnapshot);
  const applyPalette = useStudioStore((s) => s.applyPalette);

  const baseline = activeAgent ? (baselines[activeAgent] ?? null) : null;
  const baselineLoading = activeAgent ? Boolean(baselineLoadingMap[activeAgent]) : false;

  const studioColorSets = useMemo<StudioColorSets | undefined>(() => {
    if (!snapshot) return undefined;
    const sig = computeSignature(snapshot);
    const primaryBg = sig.color.rootBackground || sig.color.backgrounds[0] || null;
    return {
      primaryBg,
      surfaceBgs: sig.color.backgrounds.filter((b) => b !== primaryBg),
      texts: sig.color.texts,
      accents: sig.color.accents,
    };
  }, [snapshot]);

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
                ['theme', '主题', !snapshot],
                ['wallpaper', '壁纸', false],
                ['bundle', '打包', false],
                ['inspect', '检查', false],
                ['generator', '搭配', false],
                ['raw', '原貌', !(baseline || snapshot)],
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
            onClick={() => void toggleInspect()}
            className="h-6 gap-1 px-2 font-mono text-[9.5px] uppercase"
            style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
          >
            <HugeIcon icon={Search01Icon} className="size-2.5" />
            {inspectMode ? '停止' : '检查'}
          </Button>
          <Button
            size="sm"
            disabled={!activeAgent || snapshotLoading}
            onClick={() => void captureSnapshot()}
            className="h-6 gap-1 px-2 font-mono text-[9.5px] uppercase"
            style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
          >
            {snapshotLoading ? (
              <Spinner data-icon="inline-start" className="size-2.5" />
            ) : (
              <HugeIcon icon={EyeIcon} className="size-2.5" />
            )}
            {snapshotLoading ? t.studioSnapshooting : t.studioSnapshotButton}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!activeAgent || baselineLoading}
            onClick={() => void baselineSnapshot()}
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
        {!snapshot && !baseline && !snapshotLoading && !baselineLoading && (
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
        {previewView === 'theme' && snapshot && (
          <RealDomPreview
            domTree={snapshot.domTree}
            overrides={toolOverrides}
            colorSets={studioColorSets}
          />
        )}
        {previewView === 'theme' && !snapshot && (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2">
            <p className="font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
              点击「SNAP」抓取主题快照后在此编辑
            </p>
          </div>
        )}
        {/* WALLPAPER */}
        {previewView === 'wallpaper' && <WallpaperStudioPanel />}
        {/* BUNDLE */}
        {previewView === 'bundle' && <BundleStudioTab />}
        {/* INSPECT */}
        {previewView === 'inspect' && <InspectStudioTab />}
        {/* GENERATOR */}
        {previewView === 'generator' && activeProject && (
          <FitGeneratorPanel
            embedded
            onPreviewPalette={(_agentId, palette) => applyPalette({ ...palette }, 'preview')}
            onPaletteApply={(_agentId, palette) => applyPalette({ ...palette }, 'apply')}
          />
        )}
        {previewView === 'generator' && !activeProject && (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-2">
            <p className="font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
              新建或导入工程后可使用生成器
            </p>
          </div>
        )}
        {/* RAW: baseline vs current side-by-side */}
        {previewView === 'raw' && (
          <AgentRawDualPreview
            domDark={baseline?.domTree ?? null}
            domLight={snapshot?.domTree ?? null}
            rootVarsDark={baseline?.rootVars ?? {}}
            rootVarsLight={snapshot?.rootVars ?? {}}
            scale={0.55}
          />
        )}
      </div>

      {/* Fingerprint bar */}
      {snapshot && (
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
          <span style={{ color: 'var(--foreground)' }}>{fingerprintFromSnapshot(snapshot)}</span>
        </div>
      )}
    </div>
  );
}
