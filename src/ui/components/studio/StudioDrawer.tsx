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
import { AppMark } from '@/components/AppMark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { appStatusFor } from '@/stores/agentStore';
import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import { AGENT_IDS, AGENT_META, type AgentId } from '@shared/types';
import { LayoutGrid } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { AgentProfileSummary } from './AgentProfileSummary';
import { AgentsSection } from './AgentsSection';
import { ResourcesSection } from './ResourcesSection';

export function StudioDrawer({ t }: { t: UiMessages }) {
  const { drawer, setDrawerCollapsed } = useWorkspaceStore();

  // RC2-A fix: Replace full-store subscription with precise selector + useShallow.
  const {
    projects,
    activeProjectId,
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
  } = useStudioStore(
    useShallow((s) => ({
      projects: s.projects,
      activeProjectId: s.activeProjectId,
      creatingProject: s.creatingProject,
      createProject: s.createProject,
      selectProject: s.selectProject,
      setCreatingProject: s.setCreatingProject,
      newName: s.newName,
      setNewName: s.setNewName,
      newAuthor: s.newAuthor,
      setNewAuthor: s.setNewAuthor,
      newAgent: s.newAgent,
      setNewAgent: s.setNewAgent,
    })),
  );

  const [projectsOpen, setProjectsOpen] = useState(true);

  if (!drawer.open) {
    return (
      <aside className="ws-drawer" data-collapsed="true">
        <div className="ws-drawer-rail">
          <button
            type="button"
            className="ws-drawer-rail__btn"
            onClick={() => setDrawerCollapsed(false)}
            title={t.expandSidebar}
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
            <span className="flex items-center gap-1">
              <span className="dot" />
              {t.studioProjectTitle}
            </span>
            <span>{projectsOpen ? '▾' : '▸'}</span>
          </button>

          {projectsOpen && (
            <div className="flex flex-col gap-1 mt-1">
              <Button
                size="sm"
                variant="default"
                className="w-full"
                onClick={() => setCreatingProject(true)}
              >
                <span className="text-muted-foreground">+</span> {t.studioProjectNew}
              </Button>

              {creatingProject && (
                <div className="flex flex-col gap-1 p-2 rounded-sm border border-border bg-surface">
                  <Input
                    type="text"
                    placeholder={t.studioProjectPlaceholder}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="h-6 text-[11px]"
                  />
                  <Input
                    type="text"
                    placeholder={t.studioProjectAuthorPlaceholder}
                    value={newAuthor}
                    onChange={(e) => setNewAuthor(e.target.value)}
                    className="h-6 text-[11px]"
                  />
                  <div className="flex flex-wrap gap-1">
                    {AGENT_IDS.map((id) => {
                      const meta = AGENT_META[id as AgentId];
                      const installed = Boolean(appStatusFor(id)?.installed);
                      if (!installed) return null;
                      return (
                        <Button
                          key={id}
                          size="xs"
                          variant={newAgent === id ? 'primary' : 'default'}
                          onClick={() => setNewAgent(id)}
                          className="gap-1"
                        >
                          <AppMark appId={id} size={10} />
                          {meta.displayName}
                        </Button>
                      );
                    })}
                  </div>

                  {/* Agent profile summary — visible when an agent is selected */}
                  <AgentProfileSummary t={t} newAgent={newAgent} />

                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="primary"
                      className="flex-1"
                      onClick={() => void createProject()}
                    >
                      {t.studioProjectCreate}
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      className="flex-1"
                      onClick={() => setCreatingProject(false)}
                    >
                      {t.cancel}
                    </Button>
                  </div>
                </div>
              )}

              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProject(p.id)}
                  className="flex items-center gap-1 w-full p-1 rounded-sm hover:bg-muted"
                  style={{
                    borderColor: activeProjectId === p.id ? 'var(--primary)' : 'transparent',
                    background: activeProjectId === p.id ? 'var(--primary)' : 'transparent',
                    border: '1px solid',
                  }}
                >
                  <AppMark appId={p.agentId} size={12} />
                  <span className="text-micro text-foreground truncate flex-1 text-left">
                    {p.name}
                  </span>
                  {p.hasSnapshot && (
                    <Badge
                      variant="outline"
                      className="text-[var(--cr-success)] border-[var(--cr-success)]/40"
                    >
                      snap
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Resources section */}
        <ResourcesSection t={t} />

        {/* Agents section */}
        <AgentsSection t={t} />
      </div>

      {/* Collapse handle */}
      <button
        type="button"
        className="flex items-center justify-center h-6 w-full border-t border-border cursor-pointer shrink-0 bg-transparent"
        onClick={() => setDrawerCollapsed(true)}
        title={t.collapseSidebar}
      >
        <span className="text-micro text-muted-foreground">◀</span>
      </button>
    </aside>
  );
}
