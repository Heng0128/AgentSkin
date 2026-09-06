// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioDrawer.ProjectsSection
 *
 * Projects CRUD section for the StudioDrawer — new / import / active project
 * list with inline creation form and template picker launch.
 *
 * Extracted from StudioDrawer (RC-12) to reduce the parent to a thin
 * orchestration layer. This module owns the project list rendering and
 * creation form state; the parent owns drawer-level collapsed/expanded state
 * and section-level open/close state (lifted to avoid duplicate useState).
 */

import { AppMark } from '@/components/AppMark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { appStatusFor } from '@/stores/agentStore';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { AGENT_IDS, AGENT_META, type AgentId } from '@shared/types';
import { AgentProfileSummary } from './AgentProfileSummary';
import { TemplatePicker } from './TemplatePicker';

export interface ProjectsSectionProps {
  t: UiMessages;
  projectsOpen: boolean;
  showTemplatePicker: boolean;
  onToggleProjects: () => void;
  onCloseTemplatePicker: () => void;
}

export function ProjectsSection({
  t,
  projectsOpen,
  showTemplatePicker,
  onToggleProjects,
  onCloseTemplatePicker,
}: ProjectsSectionProps) {
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
  } = useStudioStore();

  return (
    <div className="ws-drawer__section">
      <button type="button" className="ws-drawer__section-header" onClick={onToggleProjects}>
        <span className="flex items-center gap-1">
          <span className="dot" />
          {t.studioProjectTitle}
        </span>
        <span>{projectsOpen ? '▾' : '▸'}</span>
      </button>

      {projectsOpen && (
        <div className="flex flex-col gap-1 mt-1">
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="default"
              className="flex-1"
              onClick={() => setCreatingProject(true)}
            >
              <span className="text-muted-foreground">+</span> {t.studioProjectNew}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => onCloseTemplatePicker()}
            >
              {t.studioTemplatePickButton}
            </Button>
          </div>

          {creatingProject && (
            <div className="flex flex-col gap-1 p-2 rounded-md border border-border bg-surface">
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
              className={cn(
                'flex items-center gap-1 w-full p-1 rounded-md hover:bg-muted',
                activeProjectId === p.id
                  ? 'border border-primary bg-primary text-primary-foreground'
                  : 'border border-transparent',
              )}
            >
              <AppMark appId={p.agentId} size={12} />
              <span className="text-micro text-foreground truncate flex-1 text-left">{p.name}</span>
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

      {/* Template picker overlay */}
      {showTemplatePicker && <TemplatePicker onClose={onCloseTemplatePicker} />}
    </div>
  );
}
