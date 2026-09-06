// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio Theme Templates IPC
 *
 * Exposes the curated starter templates from `studio-theme-templates.ts` to
 * the renderer via two INVOKE channels:
 *
 *   - `STUDIO_TEMPLATES_LIST` — lightweight metadata list (no palette bytes)
 *   - `STUDIO_TEMPLATES_GET` — full template by id (palette + overrides)
 *
 * Both handlers are synchronous lookups over the in-memory `STUDIO_THEME_TEMPLATES`
 * array, but wrapped with `withMonitoredTimeout` for consistency with the rest
 * of the IPC surface and to future-proof against any async refactoring.
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import { getTemplate, STUDIO_THEME_TEMPLATES } from '../profile/studio-theme-templates';
import { withMonitoredTimeout } from './with-monitored-timeout';

export function registerStudioTemplatesIpc(): void {
  ipcMain.handle(IpcChannel.STUDIO_TEMPLATES_LIST, () =>
    withMonitoredTimeout(
      IpcChannel.STUDIO_TEMPLATES_LIST,
      5000,
      Promise.resolve(
        STUDIO_THEME_TEMPLATES.map((t) => ({
          id: t.id,
          name: t.name,
          mode: t.mode,
          category: t.category,
          description: t.description,
        })),
      ),
    ),
  );

  ipcMain.handle(IpcChannel.STUDIO_TEMPLATES_GET, (_event, templateId: string) =>
    withMonitoredTimeout(IpcChannel.STUDIO_TEMPLATES_GET, 5000, Promise.resolve()).then(() => {
      const t = getTemplate(templateId);
      if (!t) return null;
      return {
        id: t.id,
        name: t.name,
        mode: t.mode,
        palette: t.palette,
        overrides: t.overrides as Record<string, number | string> | undefined,
      };
    }),
  );
}
