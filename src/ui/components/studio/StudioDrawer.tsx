// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioDrawer
 *
 * Left-side workspace drawer — collapsible resources panel.
 *
 * Sections:
 *   · Projects  — new / import / active project list
 *   · Resources — theme library + wallpapers + bundles (P1)
 *   · Agents    — per-agent install status
 *
 * When `collapsed`, only the icon rail is shown (48px wide).
 */

import { useState } from 'react';
import { AppMark } from '@/components/app-mark';
import { Button } from '@/components/ui/button';
import { appStatusFor } from '@/stores/agentStore';
import { useStudioStore } from '@/stores/studioStore';
import { useWallpaperStore } from '@/stores/wallpaperStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { AGENT_IDS, AGENT_META, type AgentId } from '@shared/types';
import { Image, Layers, LayoutGrid, Package } from 'lucide-react';

export function StudioDrawer() {
  const { drawer, setDrawerCollapsed } = useWorkspaceStore();

  const {
    projects,
    activeProjectId,
    installedThemes,
    creatingProject,
    createProject,
    selectProject,
    setCreatingProject,
    newName,
    setNewName,
    newAuthor,
    setNewAuthor,
    newAgent,
    setNewAgent,
  } = useStudioStore();

  const [resourcesOpen, setResourcesOpen] = useState(true);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [agentsOpen, setAgentsOpen] = useState(false);

  // Wallpaper list — sourced from wallpaperStore (loaded once at app init).
  const wallpapers = useWallpaperStore((s) => s.wallpapers);

  if (!drawer.open) {
    return (
      <aside className="ws-drawer" data-collapsed="true">
        <div className="ws-drawer-rail">
          <button
            type="button"
            className="ws-drawer-rail__btn"
            onClick={() => setDrawerCollapsed(false)}
            title="Expand"
          >
            <LayoutGrid className="size-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="ws-drawer">
      <div className="ws-drawer__scroll">
        {/* Projects section */}
        <div className="ws-drawer__section">
          <button
            type="button"
            className="ws-drawer__section-header"
            onClick={() => setProjectsOpen((v) => !v)}
          >
            <span className="flex items-center gap-[var(--space-1)]">
              <span className="dot" />
              Projects
            </span>
            <span>{projectsOpen ? '▾' : '▸'}</span>
          </button>

          {projectsOpen && (
            <div className="flex flex-col gap-[var(--space-1)] mt-[var(--space-1)]">
              <button
                type="button"
                className="ws-btn ws-btn--sm w-full"
                onClick={() => setCreatingProject(true)}
              >
                <span className="text-[var(--fg-1)]">+</span> New
              </button>

              {creatingProject && (
                <div className="flex flex-col gap-[var(--space-1)] p-[var(--space-2)] rounded-[var(--r-xs)] border border-[var(--border-subtle)] bg-[var(--bg-1)]">
                  <input
                    type="text"
                    placeholder="Project name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="ws-input h-[var(--h-btn-sm)] text-[length:11px]"
                  />
                  <input
                    type="text"
                    placeholder="Author"
                    value={newAuthor}
                    onChange={(e) => setNewAuthor(e.target.value)}
                    className="ws-input h-[var(--h-btn-sm)] text-[length:11px]"
                  />
                  <div className="flex flex-wrap gap-[var(--space-1)]">
                    {AGENT_IDS.map((id) => {
                      const meta = AGENT_META[id as AgentId];
                      const installed = Boolean(appStatusFor(id)?.installed);
                      if (!installed) return null;
                      return (
                        <button
                          key={id}
                          type="button"
                          data-selected={newAgent === id}
                          onClick={() => setNewAgent(id)}
                          className="ws-agent-chip"
                        >
                          <AppMark appId={id} size={10} />
                          {meta.displayName}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex gap-[var(--space-1)]">
                    <button
                      type="button"
                      className="ws-btn ws-btn--sm flex-1 ws-btn--primary"
                      onClick={() => void createProject()}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      className="ws-btn ws-btn--sm flex-1"
                      onClick={() => setCreatingProject(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProject(p.id)}
                  className="flex items-center gap-[var(--space-1)] w-full p-[var(--space-1)] rounded-[var(--r-micro)] hover:bg-[var(--bg-3)]"
                  style={{
                    borderColor: activeProjectId === p.id ? 'var(--accent)' : 'transparent',
                    background: activeProjectId === p.id ? 'var(--accent-ghost)' : 'transparent',
                    border: '1px solid',
                  }}
                >
                  <AppMark appId={p.agentId} size={12} />
                  <span className="font-mono text-[length:10px] text-[var(--fg-0)] truncate flex-1 text-left">
                    {p.name}
                  </span>
                  {p.hasSnapshot && <span className="ws-badge ws-badge--success">snap</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Resources section */}
        <div className="ws-drawer__section">
          <button
            type="button"
            className="ws-drawer__section-header"
            onClick={() => setResourcesOpen((v) => !v)}
          >
            <span className="flex items-center gap-[var(--space-1)]">
              <span className="dot" />
              Resources
            </span>
            <span>{resourcesOpen ? '▾' : '▸'}</span>
          </button>

          {resourcesOpen && (
            <div className="flex flex-col gap-[var(--space-2)] mt-[var(--space-1)]">
              {/* Theme library */}
              <div>
                <div className="flex items-center gap-[var(--space-1)] mb-[var(--space-1)]">
                  <Layers className="size-3" style={{ color: 'var(--fg-2)' }} />
                  <span className="font-mono text-[length:10px] text-[var(--fg-2)]">
                    Theme Library
                  </span>
                </div>
                {installedThemes.length === 0 ? (
                  <p className="font-mono text-[length:10px] text-[var(--fg-3)] pl-[var(--space-4)]">
                    No themes installed
                  </p>
                ) : (
                  <div className="flex flex-col gap-0">
                    {installedThemes.map((theme) => (
                      <div
                        key={theme.id}
                        className="flex items-center gap-[var(--space-1)] p-0 rounded-[var(--r-micro)] hover:bg-[var(--bg-3)]"
                      >
                        <span
                          className="size-[10px] rounded-[var(--r-micro)] border border-[var(--border-subtle)]"
                          style={{ background: theme.colors?.accent || 'var(--bg-4)' }}
                        />
                        <span className="font-mono text-[length:10px] text-[var(--fg-0)] truncate flex-1">
                          {theme.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Wallpapers (P1 — IPC-backed list) */}
              <div>
                <div className="flex items-center gap-[var(--space-1)] mb-[var(--space-1)]">
                  <Image className="size-3" style={{ color: 'var(--fg-2)' }} />
                  <span className="font-mono text-[length:10px] text-[var(--fg-2)]">
                    Wallpapers
                  </span>
                </div>
                {wallpapers.length === 0 ? (
                  <p className="font-mono text-[length:10px] text-[var(--fg-3)] pl-[var(--space-4)]">
                    No wallpapers
                  </p>
                ) : (
                  <div className="flex flex-col gap-0">
                    {wallpapers.map((wp) => (
                      <div
                        key={wp.id}
                        className="flex items-center gap-[var(--space-1)] p-0 rounded-[var(--r-micro)] hover:bg-[var(--bg-3)]"
                      >
                        <Image className="size-2.5" style={{ color: 'var(--fg-3)' }} />
                        <span className="font-mono text-[length:10px] text-[var(--fg-0)] truncate flex-1">
                          {wp.title ?? wp.id}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bundles */}
              <div>
                <div className="flex items-center gap-[var(--space-1)] mb-[var(--space-1)]">
                  <Package className="size-3" style={{ color: 'var(--fg-2)' }} />
                  <span className="font-mono text-[length:10px] text-[var(--fg-2)]">Bundles</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-[var(--h-btn-sm)] text-[length:10px]"
                >
                  Import Bundle
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Agents section */}
        <div className="ws-drawer__section">
          <button
            type="button"
            className="ws-drawer__section-header"
            onClick={() => setAgentsOpen((v) => !v)}
          >
            <span className="flex items-center gap-[var(--space-1)]">
              <span className="dot" />
              Agents
            </span>
            <span>{agentsOpen ? '▾' : '▸'}</span>
          </button>

          {agentsOpen && (
            <div className="flex flex-col gap-[var(--space-1)] mt-[var(--space-1)]">
              {AGENT_IDS.map((id) => {
                const meta = AGENT_META[id as AgentId];
                const status = appStatusFor(id);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-[var(--space-1)] p-[var(--space-1)] rounded-[var(--r-micro)]"
                  >
                    <AppMark appId={id} size={14} />
                    <span className="font-mono text-[length:10px] text-[var(--fg-0)] truncate flex-1">
                      {meta.displayName}
                    </span>
                    <span
                      className="size-[5px] rounded-full"
                      style={{
                        background: status?.installed ? 'var(--cr-ok)' : 'var(--fg-3)',
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Collapse handle */}
      <button
        type="button"
        className="flex items-center justify-center h-6 w-full border-t border-[var(--border-subtle)] cursor-pointer shrink-0 bg-transparent"
        onClick={() => setDrawerCollapsed(true)}
        title="Collapse drawer"
      >
        <span className="font-mono text-[length:10px] text-[var(--fg-2)]">◀</span>
      </button>
    </aside>
  );
}
