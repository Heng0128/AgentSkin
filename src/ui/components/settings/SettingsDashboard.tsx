// SPDX-License-Identifier: MPL-2.0

/**
 * # SettingsDashboard
 *
 * Dashboard-first UX for the Settings page — displays an overview of all
 * 6 adapter injection statuses (online / offline / retry-needed), the current
 * theme applied to each agent, and a relative-timestamp visualization
 * ("last successful apply: X minutes ago").
 *
 * Design reference: Antigravity-Manager's dashboard-first pattern.
 * Shows the most important information at a glance before diving into details.
 */

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useStatusStore } from '@/stores/statusStore';
import { useThemeStore } from '@/stores/themeStore';

import { AGENT_META, type AgentId } from '@shared/types';
import { AlertTriangle, CheckCircle2, Clock, Monitor, Palette, RefreshCw } from 'lucide-react';

/** Injection status of a single adapter — derived from runtime state. */
type AdapterStatus = 'online' | 'offline' | 'retry-needed';

/** Per-agent dashboard row data. */
interface AgentDashboardRow {
  appId: AgentId;
  displayName: string;
  status: AdapterStatus;
  activeThemeName: string | null;
  lastAppliedAt: number | null;
  installed: boolean;
  debugReady: boolean;
}

/** Derive adapter status from runtime fields. */
function deriveStatus(running: boolean, debugReady: boolean, installed: boolean): AdapterStatus {
  if (!installed) return 'offline';
  if (running && debugReady) return 'online';
  if (running && !debugReady) return 'retry-needed';
  return 'offline';
}

/** Format a timestamp as a relative-time string (e.g. "5 分钟前"). */
function formatRelativeTime(
  timestamp: number | null,
  t: {
    settingsDashboardJustNow: string;
    settingsDashboardMinutesAgo: (n: number) => string;
    settingsDashboardHoursAgo: (n: number) => string;
    settingsDashboardDaysAgo: (n: number) => string;
    settingsDashboardNeverApplied: string;
  },
): string {
  if (timestamp === null) return t.settingsDashboardNeverApplied;

  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);

  if (minutes < 1) return t.settingsDashboardJustNow;
  if (minutes < 60) return t.settingsDashboardMinutesAgo(minutes);

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t.settingsDashboardHoursAgo(hours);

  const days = Math.floor(hours / 24);
  return t.settingsDashboardDaysAgo(days);
}

/** Status badge — colored dot + label for a single adapter. */
function StatusBadge({ status, label }: { status: AdapterStatus; label: string }) {
  const colorMap: Record<AdapterStatus, string> = {
    online: 'bg-cr-success',
    offline: 'bg-muted-foreground/40',
    'retry-needed': 'bg-cr-warning',
  };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block size-1.5 rounded-full', colorMap[status])} />
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </span>
  );
}

/** Single agent row in the dashboard grid. */
function AgentStatusCard({
  row,
  t,
}: {
  row: AgentDashboardRow;
  t: {
    settingsDashboardOnline: string;
    settingsDashboardOffline: string;
    settingsDashboardRetry: string;
    settingsDashboardCurrentTheme: string;
    settingsDashboardNoTheme: string;
    settingsDashboardLastApplied: string;
    settingsDashboardNeverApplied: string;
    settingsDashboardJustNow: string;
    settingsDashboardMinutesAgo: (n: number) => string;
    settingsDashboardHoursAgo: (n: number) => string;
    settingsDashboardDaysAgo: (n: number) => string;
  };
}) {
  const statusLabel: Record<AdapterStatus, string> = {
    online: t.settingsDashboardOnline,
    offline: t.settingsDashboardOffline,
    'retry-needed': t.settingsDashboardRetry,
  };

  const relativeTime = formatRelativeTime(row.lastAppliedAt, t);

  return (
    <div className="as-panel flex flex-col gap-3 p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor className="size-4 text-muted-foreground/70" />
          <span className="text-[12px] font-medium text-foreground">{row.displayName}</span>
        </div>
        <StatusBadge status={row.status} label={statusLabel[row.status]} />
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Palette className="size-3" />
            {t.settingsDashboardCurrentTheme}
          </span>
          <span className="text-[11px] font-medium text-foreground">
            {row.activeThemeName ?? t.settingsDashboardNoTheme}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="size-3" />
            {t.settingsDashboardLastApplied}
          </span>
          <span className="text-[11px] text-muted-foreground">{relativeTime}</span>
        </div>
      </div>
    </div>
  );
}

/** Summary stats row — online count, offline count, retry count. */
function DashboardSummary({ rows, t }: { rows: AgentDashboardRow[]; t: Record<string, string> }) {
  const online = rows.filter((r) => r.status === 'online').length;
  const offline = rows.filter((r) => r.status === 'offline').length;
  const retry = rows.filter((r) => r.status === 'retry-needed').length;
  const total = rows.length;

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className="size-3.5 text-cr-success" />
        <span className="text-[11px] font-medium text-foreground">{online}</span>
        <span className="text-[11px] text-muted-foreground">{t.settingsDashboardOnline}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="size-3.5 text-cr-warning" />
        <span className="text-[11px] font-medium text-foreground">{retry}</span>
        <span className="text-[11px] text-muted-foreground">{t.settingsDashboardRetry}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <Monitor className="size-3.5 text-muted-foreground/40" />
        <span className="text-[11px] font-medium text-foreground">{offline}</span>
        <span className="text-[11px] text-muted-foreground">{t.settingsDashboardOffline}</span>
      </div>
      <span className="ml-auto text-[11px] text-muted-foreground/60">
        {online}/{total}
      </span>
    </div>
  );
}

/** Dashboard translation subset — avoids passing the whole `t` object. */
export interface DashboardT {
  settingsDashboardTitle: string;
  settingsDashboardDesc: string;
  settingsDashboardOnline: string;
  settingsDashboardOffline: string;
  settingsDashboardRetry: string;
  settingsDashboardCurrentTheme: string;
  settingsDashboardNoTheme: string;
  settingsDashboardLastApplied: string;
  settingsDashboardNeverApplied: string;
  settingsDashboardJustNow: string;
  settingsDashboardMinutesAgo: (n: number) => string;
  settingsDashboardHoursAgo: (n: number) => string;
  settingsDashboardDaysAgo: (n: number) => string;
  settingsDashboardRefresh: string;
}

/** Props for the SettingsDashboard component. */
export interface SettingsDashboardProps {
  t: DashboardT;
}

/**
 * # SettingsDashboard
 *
 * Displays the 6 adapters' injection status overview, current theme per
 * agent, and last-applied timestamps. Designed as the default view when
 * the user navigates to Settings (dashboard-first UX).
 */
export function SettingsDashboard({ t }: SettingsDashboardProps) {
  const status = useStatusStore((s) => s.status);
  const lastStatusAt = useStatusStore((s) => s.lastStatusAt);
  const isRefreshing = useStatusStore((s) => s.isRefreshing);
  const refreshStatus = useStatusStore((s) => s.refreshStatus);
  const installedThemes = useThemeStore((s) => s.installed);

  /** Build per-agent dashboard rows from status + theme catalog. */
  const rows: AgentDashboardRow[] = useMemo(() => {
    const apps = status?.apps ?? [];
    return apps.map((app) => {
      const meta = AGENT_META[app.appId];
      const activeTheme = app.activeThemeId
        ? installedThemes.find((th) => th.id === app.activeThemeId)
        : null;
      return {
        appId: app.appId,
        displayName: meta?.displayName ?? app.displayName,
        status: deriveStatus(app.running, app.debugReady, app.installed),
        activeThemeName: activeTheme?.displayName ?? null,
        // lastStatusAt is updated after every apply/restore — best proxy for
        // "last successful apply" at the global level.
        lastAppliedAt: app.activeThemeId ? lastStatusAt : null,
        installed: app.installed,
        debugReady: app.debugReady,
      };
    });
  }, [status, installedThemes, lastStatusAt]);

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar */}
      <div className="as-panel flex items-center justify-between px-3.5 py-2.5">
        <DashboardSummary rows={rows} t={t} />
        <button
          type="button"
          onClick={() => void refreshStatus()}
          disabled={isRefreshing}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3', isRefreshing && 'animate-spin')} />
          {t.settingsDashboardRefresh}
        </button>
      </div>

      {/* Agent status grid — 6 adapters in a responsive grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((row) => (
          <AgentStatusCard key={row.appId} row={row} t={t} />
        ))}
      </div>
    </div>
  );
}
