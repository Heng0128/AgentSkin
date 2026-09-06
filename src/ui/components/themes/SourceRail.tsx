// SPDX-License-Identifier: MPL-2.0

/**
 * SourceRail - 社区来源列表
 *
 * 展示接入的社区来源（DreamSkin、CodeDrobe），每个来源显示：
 * - 名称
 * - 主题数（total）
 * - 在线状态徽标（online=绿点 / degraded=黄点 / offline=灰点）
 * - offline 来源额外显示"即将接入"徽标
 *
 * 单source时视觉弱化为顶部标签；>=2 sources时展开为完整左侧栏。
 */

import { AlertCircle, BadgeCheck, Globe, WifiOff } from 'lucide-react';
import { useCommunityStore } from '@/stores/communityStore';
import { useShellStore } from '@/stores/shellStore';
import { cn } from '@/lib/utils';

import { uiMessages } from '@shared/i18n';
import type { CommunitySourceId, SourceStatus } from '@shared/types/community';
import { useShallow } from 'zustand/react/shallow';

const SOURCE_META: Record<CommunitySourceId, { name: string; description: string }> = {
  dreamskin: { name: 'DreamSkin', description: '400+ 原创AI主题' },
  codedrobe: { name: 'CodeDrobe', description: '多应用统一主题引擎（即将接入）' },
};

function SourceStatusDot({ status }: { status: SourceStatus }) {
  const colorMap: Record<SourceStatus, string> = {
    online: 'bg-success',
    degraded: 'bg-warning',
    offline: 'bg-muted',
  };
  return <span className={cn('size-2 rounded-full', colorMap[status] ?? 'bg-muted')} />;
}

export function SourceRail() {
  const { activeSourceId, sources, setActiveSource, getSourceStatus } = useCommunityStore(
    useShallow((s) => ({
      activeSourceId: s.activeSourceId,
      sources: s.sources,
      setActiveSource: s.setActiveSource,
      getSourceStatus: s.getSourceStatus,
    })),
  );

  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  const sourceIds = Object.keys(sources) as CommunitySourceId[];
  if (sourceIds.length === 0) return null;

  const activeStatus = getSourceStatus(activeSourceId);

  return (
    <aside className="flex h-full w-full flex-col gap-1 border-r border-border bg-surface/50 p-2">
      <h3 className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted">
        <Globe className="size-3" />
        {t.communitySourceTitle}
      </h3>
      {sourceIds.map((sourceId) => {
        const meta = SOURCE_META[sourceId];
        const isActive = sourceId === activeSourceId;
        const status = getSourceStatus(sourceId);
        const isOffline = status === 'offline';
        const total = sources[sourceId]?.total ?? 0;
        return (
          <button
            key={sourceId}
            type="button"
            onClick={() => setActiveSource(sourceId)}
            disabled={isOffline}
            className={cn(
              'flex items-center gap-2 rounded-md px-2 py-2 text-left transition-colors',
              isOffline && 'cursor-not-allowed opacity-50',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted hover:bg-surface hover:text-foreground',
            )}
          >
            <SourceStatusDot status={status} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{meta.name}</div>
              <div className="text-xs text-muted">
                {isOffline ? t.communitySourceComingSoon : t.communityThemeCount(total)}
              </div>
            </div>
            {isOffline && (
              <BadgeCheck className="size-3.5 shrink-0 text-muted" />
            )}
          </button>
        );
      })}
      {activeStatus === 'degraded' && (
        <div className="flex items-center gap-2 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning">
          <AlertCircle className="size-3" />
          {t.communityStatusDegraded}
        </div>
      )}
      {activeStatus === 'offline' && (
        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted">
          <WifiOff className="size-3" />
          {t.communityStatusOffline}
        </div>
      )}
    </aside>
  );
}
