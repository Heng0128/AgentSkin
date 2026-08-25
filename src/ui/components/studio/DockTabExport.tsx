// SPDX-License-Identifier: MPL-2.0

/**
 * # DockTabExport
 *
 * Bottom dock "Export" tab — theme package export form.
 *
 * Captures name / author, triggers export, shows result with
 * "Show in folder" action. Reads/writes through studioStore.
 */

import { useEffect } from 'react';
import { api } from '@/api/agentSkinClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionLabel } from '@/components/ui/section-label';
import { Spinner } from '@/components/ui/spinner';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { Download, FolderOpen } from 'lucide-react';

export function DockTabExport({ t }: { t: UiMessages }) {
  const toolOverrides = useStudioStore((s) => s.toolOverrides);
  const exportName = useStudioStore((s) => s.exportName);
  const exportAuthor = useStudioStore((s) => s.exportAuthor);
  const exportState = useStudioStore((s) => s.exportState);
  const activeProject = useStudioStore((s) => s.getActiveProject());

  const setExportName = useStudioStore((s) => s.setExportName);
  const setExportAuthor = useStudioStore((s) => s.setExportAuthor);
  const exportTheme = useStudioStore((s) => s.exportTheme);

  // Sync export name when active project changes.
  useEffect(() => {
    if (activeProject) {
      useStudioStore.getState().setExportName(activeProject.name);
      useStudioStore.getState().setExportAuthor(activeProject.author || '');
    }
  }, [activeProject]);

  const activeAgentId = activeProject?.agentId ?? null;

  return (
    <div className="ws-dock__content">
      <div className="flex-shrink-0 w-[320px] space-y-2">
        <SectionLabel label={`${t.studioLandmark} · ${t.studioExport}`} />

        {!toolOverrides ? (
          <p className="text-[10px] text-muted-foreground">{t.studioInspectorEmpty}</p>
        ) : (
          <>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {t.studioExportDesc('.agentskin-theme')}
            </p>
            <div className="space-y-1">
              <Input
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                placeholder={t.studioExportNamePlaceholder}
                className="h-7 text-[11px]"
              />
              <Input
                value={exportAuthor}
                onChange={(e) => setExportAuthor(e.target.value)}
                placeholder={t.studioExportAuthorPlaceholder}
                className="h-7 text-[11px]"
              />
            </div>
            <Button
              size="sm"
              variant="primary"
              disabled={exportState.loading || !activeAgentId}
              onClick={() => void exportTheme()}
            >
              {exportState.loading ? (
                <Spinner data-icon="inline-start" className="size-3" />
              ) : (
                <Download className="size-3" />
              )}
              {exportState.loading ? t.studioExporting : t.studioExportButton}
            </Button>

            {exportState.dir && (
              <div className="rounded-sm border border-border bg-card2 p-2">
                <p className="text-[10px] text-muted-foreground">{t.studioExportedTo}</p>
                <p className="break-all text-[10px] text-foreground">
                  {exportState.dir}
                </p>
                <Button
                  size="sm"
                  onClick={() => api.showInFolder(exportState.dir!)}
                  className="mt-1"
                >
                  <FolderOpen className="size-2.5" />
                  {t.studioReveal}
                </Button>
              </div>
            )}

            {exportState.error && (
              <p className="text-[10px] text-primary">
                {t.studioExportError(exportState.error)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
