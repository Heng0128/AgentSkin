// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentDashboardPage
 *
 * Compact overview page for AgentSkin — shows connected agents, theme
 * count, injection engine state, and the total number of supported agents.
 *
 * Reads live data from the AppController (status poll every 3s).
 * No charts, no mock generators, no setInterval.
 *
 * Swiss/International styling: rounded-[2px] corners, CSS-variable colors,
 * font-mono labels, max-w-[1240px] container.
 */

import type { AppController } from '@/hooks/useAppController';

import type { AgentId } from '@shared/types';
import { AGENT_META } from '@shared/types';

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function AgentDashboardPage({ controller }: { controller: AppController }) {
  const { status, installed, booting } = controller;
  const supportedCount = 6; // AGENT_IDS.length — formal product agents

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-[30px] py-[22px] pb-[70px]">
          {/* Page header */}
          <header className="mb-5">
            <h1 className="font-display text-[22px] font-bold tracking-tight text-foreground">
              AgentSkin Overview
            </h1>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              System status · {new Date().toLocaleTimeString()}
            </p>
          </header>

          {/* Connected Agents */}
          <section className="mb-5 rounded-[2px] border border-border bg-card p-[14px]">
            <h2 className="mb-3 font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
              Connected Agents
            </h2>
            <ul className="space-y-1.5">
              {status?.apps.map((app) => {
                const meta = AGENT_META[app.appId as AgentId];
                const displayName = meta?.displayName ?? app.displayName;
                return (
                  <li key={app.appId} className="flex items-center gap-2">
                    <span
                      className={
                        app.running
                          ? 'inline-block size-[7px] rounded-full bg-[var(--grn)]'
                          : 'inline-block size-[7px] rounded-full bg-[var(--muted-foreground)] opacity-25'
                      }
                    />
                    <span className="font-mono text-[11px] text-foreground">{displayName}</span>
                    <span className="ml-auto font-mono text-[9.5px] text-muted-foreground">
                      {app.running ? 'Running' : 'Offline'}
                    </span>
                  </li>
                );
              }) ?? (
                <li className="font-mono text-[10px] text-muted-foreground">
                  {booting ? 'Loading...' : 'No status available'}
                </li>
              )}
            </ul>
          </section>

          {/* Quick stats row */}
          <div className="grid grid-cols-3 gap-3.5">
            <StatTile label="Themes" value={installed.length} />
            <StatTile
              label="Engine"
              value={booting ? 'Booting' : 'Ready'}
              indicator={
                <span
                  className={
                    booting
                      ? 'inline-block size-[7px] rounded-full bg-[var(--amb)] animate-pulse'
                      : 'inline-block size-[7px] rounded-full bg-[var(--grn)]'
                  }
                />
              }
            />
            <StatTile label="Supported Agents" value={supportedCount} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StatTile                                                            */
/* ------------------------------------------------------------------ */

function StatTile({
  label,
  value,
  indicator,
}: {
  label: string;
  value: string | number;
  indicator?: React.ReactNode;
}) {
  return (
    <div className="cursor-default rounded-[2px] border border-border bg-card p-[14px] transition-colors duration-fast hover:border-border-strong hover:bg-card2">
      <div className="mb-2 flex items-center gap-1.5">
        {indicator}
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
          {label}
        </span>
      </div>
      <span className="font-display text-[28px] font-bold tracking-tight text-foreground">
        {value}
      </span>
    </div>
  );
}
