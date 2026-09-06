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
 *
 * Sub-components (RC-12):
 *   · ProjectsSection — project CRUD + creation form + template picker
 *   · HeaderButton    — collapse toggle handle
 */

import { useState } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import { LayoutGrid } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { AgentsSection } from './AgentsSection';
import { ExternalThemeImportPanel } from './ExternalThemeImportPanel';
import { ResourcesSection } from './ResourcesSection';
import { HeaderButton } from './StudioDrawer.HeaderButton';
import { ProjectsSection } from './StudioDrawer.ProjectsSection';

export function StudioDrawer({ t }: { t: UiMessages }) {
  const { drawer, setDrawerCollapsed } = useWorkspaceStore(
    useShallow((s) => ({
      drawer: s.drawer,
      setDrawerCollapsed: s.setDrawerCollapsed,
    })),
  );

  const [projectsOpen, setProjectsOpen] = useState(true);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

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
        <ProjectsSection
          t={t}
          projectsOpen={projectsOpen}
          showTemplatePicker={showTemplatePicker}
          onToggleProjects={() => setProjectsOpen((v) => !v)}
          onCloseTemplatePicker={() => setShowTemplatePicker(false)}
        />

        {/* Resources section */}
        <ResourcesSection t={t} />

        {/* External theme import section */}
        <div className="ws-drawer__section">
          <div className="ws-drawer__section-header">
            <span className="flex items-center gap-1">
              <span className="dot" />
              {t.studioExternalThemePanelTitle}
            </span>
          </div>
          <div className="mt-1">
            <ExternalThemeImportPanel t={t} />
          </div>
        </div>

        {/* Agents section */}
        <AgentsSection t={t} />
      </div>

      {/* Collapse handle */}
      <HeaderButton t={t} />
    </aside>
  );
}
