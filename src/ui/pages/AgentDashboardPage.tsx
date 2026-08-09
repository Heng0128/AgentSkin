// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentDashboardPage → Overview
 *
 * 概览页面 — 替代原来的 Dashboard 仪表盘。
 *
 * 职责：
 *   - 最近活动时间线（近期将接入真实事件流）
 *   - 统计卡（主题数 / Agent 支持数 / 已安装 Agent 数）
 *   - 快捷入口跳转到各功能页面
 *
 * 原「Connected Agents」区块已迁移至独立的 Agents 视图。
 */

import type { AppController } from '@/hooks/useAppController';

export default function AgentDashboardPage({ controller }: { controller: AppController }) {
  const { status, installed, setRoute, t } = controller;
  const supportedCount = 6; // AGENT_IDS.length — formal product agents
  const runningCount = status?.apps.filter((a) => a.running).length ?? 0;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-[30px] py-[22px] pb-[70px]">
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
          <div className="grid grid-cols-3 gap-3.5 mb-5">
            <StatTile
              label={t.installedTitle}
              value={installed.length}
              onClick={() => setRoute('themes')}
            />
            <StatTile
              label={t.dashboardAgents}
              value={`${runningCount}/${supportedCount}`}
              onClick={() => setRoute('agents')}
            />
            <StatTile label={t.yourEnvironments} value="—" onClick={() => setRoute('workspace')} />
          </div>

          {/* 最近活动 — 目前为占位状态，后续接入事件流 */}
          <section className="rounded-[2px] border border-border bg-card p-[14px]">
            <h2 className="mb-3 font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
              {t.recentActivity}
            </h2>
            <p className="font-mono text-[11px] text-muted-foreground/70">{t.noActivity}</p>
          </section>
        </div>
      </div>
    </div>
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
      className="cursor-pointer rounded-[2px] border border-border bg-card p-[14px] text-left transition-colors duration-fast hover:border-border-strong hover:bg-card2"
    >
      <div className="mb-2">
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
          {label}
        </span>
      </div>
      <span className="font-display text-[28px] font-bold tracking-tight text-foreground">
        {value}
      </span>
    </button>
  );
}
