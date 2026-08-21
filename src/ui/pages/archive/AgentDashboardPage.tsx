// SPDX-License-Identifier: MPL-2.0

/**
 * @deprecated Merged into UnifiedWorkspacePage. Retained for reference only.
 *
 * # AgentDashboardPage → Overview
 *
 * 概览页面 — 替代原来的 Dashboard 仪表盘。
 *
 * 职责：
 *   - 最近活动时间线（已通过 api.getPerformanceHistory 接入真实事件流）
 *   - 统计卡（主题数 / Agent 支持数 / 已安装 Agent 数）
 *   - 快捷入口跳转到各功能页面
 *
 * 原「Connected Agents」区块已迁移至独立的 Agents 视图。
 */

import { useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { APP_META } from '@/components/app-mark';
import type { AppController } from '@/hooks/useAppController';
import { useEnvironmentStore } from '@/stores/environmentStore';

import type { ThemeCatalogItem } from '@shared/types';
import { AGENT_IDS } from '@shared/types';

// --- Local types (mirror AgentSkinApi.getPerformanceHistory response) -----

/** One theme-apply trace — mirrors IPC response inline type. */
interface ThemeApplyTrace {
  id: string;
  agentId: string;
  themeId?: string;
  finishedAt: string;
  duration: number;
  success: boolean;
  steps: Array<{ name: string; duration: number; success: boolean; error?: string }>;
  error?: string;
}

// --- Constants -----------------------------------------------------------

const POLL_MS = 10_000;
const HISTORY_COUNT = 5;

// --- Helper: relative time (e.g. "3 分钟前") ----------------------------

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  // Compute difference in whole seconds using UTC to avoid DST drift.
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 0) return '刚刚';
  if (diffSec < 60) return `${diffSec} 秒前`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;

  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} 天前`;

  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth} 个月前`;
}

// --- Component -----------------------------------------------------------

export default function AgentDashboardPage({ controller }: { controller: AppController }) {
  const { status, installed, setRoute, t } = controller;
  const supportedCount = AGENT_IDS.length;
  const runningCount = status?.apps.filter((a) => a.running).length ?? 0;
  const presets = useEnvironmentStore((s) => s.presets);

  // Most recently updated environments (top 3) for the quick-entry section.
  const recentEnvs = [...presets]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 3);

  const [traces, setTraces] = useState<ThemeApplyTrace[]>([]);

  // Poll apply-trace history on mount and every 10 s.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchTraces = async () => {
      try {
        const res = await api.getPerformanceHistory(HISTORY_COUNT);
        if (!cancelled) setTraces(res.recent);
      } catch {
        // Partial errors from one poll should not stop the dashboard surface.
        // traces retain their previous value on failure.
      }
      if (!cancelled) {
        timer = setTimeout(fetchTraces, POLL_MS);
      }
    };

    void fetchTraces();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-8 py-6 pb-[70px]">
          {/* Page header */}
          <header className="mb-5">
            <h1 className="font-display text-[22px] font-bold tracking-tight text-foreground">
              {t.navOverview}
            </h1>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {new Date().toLocaleDateString()} · {new Date().toLocaleTimeString()}
            </p>
          </header>

          {/* Stats row — 可点击跳转 */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <StatTile
              label={t.installedTitle}
              value={installed.length}
              onClick={() => setRoute('themes')}
            />
            <StatTile
              label={t.dashboardAgents}
              value={`${runningCount}/${supportedCount}`}
              onClick={() => setRoute('apps')}
            />
            <StatTile label={t.yourEnvironments} value="—" onClick={() => setRoute('workspace')} />
          </div>

          {/* 最近的环境 — 快捷入口 */}
          <section className="mb-5 rounded-[var(--dl-radius,2px)] border border-border bg-card p-4">
            <h2 className="mb-3 font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
              {t.recentEnvironments}
            </h2>
            {recentEnvs.length === 0 ? (
              <button
                type="button"
                onClick={() => setRoute('workspace')}
                className="cursor-pointer font-mono text-[11px] text-muted-foreground/70 transition-colors duration-fast hover:text-foreground"
              >
                {t.noEnvironments}
              </button>
            ) : (
              <ul className="grid grid-cols-3 gap-2">
                {recentEnvs.map((env) => (
                  <li key={env.id}>
                    <button
                      type="button"
                      onClick={() => setRoute('workspace')}
                      className="group flex w-full items-center gap-2 rounded-[var(--dl-radius,2px)] border border-border/60 bg-background px-3 py-2 text-left transition-colors duration-fast hover:border-border-strong hover:bg-card2"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-[var(--dl-radius,2px)] bg-card2 text-[12px] font-semibold text-muted-foreground">
                        {(env.name || env.agentId).charAt(0).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-semibold text-foreground">
                          {env.name}
                        </span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">
                          {APP_META[env.agentId as keyof typeof APP_META]?.name ?? env.agentId}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 最近活动 — 已接入真实 apply trace 数据 */}
          <section className="rounded-[var(--dl-radius,2px)] border border-border bg-card p-4">
            <h2 className="mb-3 font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
              {t.recentActivity}
            </h2>

            {traces.length === 0 ? (
              <p className="font-mono text-[11px] text-muted-foreground/70">{t.noActivity}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {traces.map((trace) => (
                  <ActivityRow key={trace.id} trace={trace} installed={installed} t={t} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ActivityRow — 单条活动记录                                          */
/* ------------------------------------------------------------------ */

function ActivityRow({
  trace,
  installed,
  t,
}: {
  trace: ThemeApplyTrace;
  installed: ThemeCatalogItem[];
  t: AppController['t'];
}) {
  const agentName = APP_META[trace.agentId as keyof typeof APP_META]?.name ?? trace.agentId;

  // Build the activity description string.
  let description: string;
  if (trace.themeId) {
    const themeName =
      installed.find((th) => th.id === trace.themeId)?.name ??
      (trace.themeId.length > 15 ? `${trace.themeId.slice(0, 15)}…` : trace.themeId);
    description = t.activityApplied.replace('{agent}', agentName).replace('{theme}', themeName);
  } else {
    description = t.activityRestored.replace('{agent}', agentName);
  }

  const relativeTime = formatRelativeTime(trace.finishedAt);

  return (
    <li className="flex items-center gap-2 rounded-[var(--dl-radius,2px)] px-1.5 py-1">
      <span className="font-mono text-[11px] text-foreground leading-tight">{description}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground/60 font-mono">
          {relativeTime}
        </span>
        {!trace.success && (
          <span
            className="font-mono text-[10px] text-destructive"
            title={trace.error ?? 'apply failed'}
          >
            ⚠
          </span>
        )}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* StatTile — 可点击统计卡                                             */
/* ------------------------------------------------------------------ */

function StatTile({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string | number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-[var(--dl-radius,2px)] border border-border bg-card p-4 text-left transition-colors duration-fast hover:border-border-strong hover:bg-card2"
    >
      <div className="mb-2">
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
          {label}
        </span>
      </div>
      <span className="font-display text-3xl font-bold tracking-tight text-foreground">
        {value}
      </span>
    </button>
  );
}
