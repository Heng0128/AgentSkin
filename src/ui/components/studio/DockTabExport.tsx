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
import { Kicker } from '@/components/studio/kicker';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { Download, FolderOpen } from 'lucide-react';

export function DockTabExport({ t }: { t: UiMessages }) {
  const snapshot = useStudioStore((s) => s.snapshot);
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
      <div className="flex-shrink-0 w-[320px] space-y-[var(--space-2)]">
        <Kicker>
          {t.studioLandmark} · {t.studioExport}
        </Kicker>

        {!snapshot ? (
          <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioInspectorEmpty}</p>
        ) : (
          <>
            <p className="font-mono text-[10px] text-[var(--fg-2)] leading-relaxed">
              {t.studioExportDesc('.agentskin-theme')}
            </p>
            <div className="space-y-[var(--space-1)]">
              <input
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                placeholder={t.studioExportNamePlaceholder}
                className="ws-input h-7 text-[length:11px]"
              />
              <input
                value={exportAuthor}
                onChange={(e) => setExportAuthor(e.target.value)}
                placeholder={t.studioExportAuthorPlaceholder}
                className="ws-input h-7 text-[length:11px]"
              />
            </div>
            <Button
              size="sm"
              disabled={exportState.loading || !activeAgentId}
              onClick={() => void exportTheme()}
              className="ws-btn--primary"
            >
              {exportState.loading ? (
                <Spinner data-icon="inline-start" className="size-3" />
              ) : (
                <Download className="size-3" />
              )}
              {exportState.loading ? t.studioExporting : t.studioExportButton}
            </Button>

            {exportState.dir && (
              <div
                className="border border-[var(--border-subtle)] bg-[var(--bg-3)] p-2"
                style={{ borderRadius: 'var(--r-xs)' }}
              >
                <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioExportedTo}</p>
                <p className="break-all font-mono text-[10px] text-[var(--fg-0)]">
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
              <p className="font-mono text-[10px] text-[var(--accent)]">
                {t.studioExportError(exportState.error)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
