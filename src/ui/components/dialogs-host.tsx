// SPDX-License-Identifier: MPL-2.0

import { APP_META } from '@/components/app-mark';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import type { AppController } from '@/hooks/useAppController';

import { AGENT_IDS, type AgentId } from '@shared/types';

export function DialogsHost({ controller }: { controller: AppController }) {
  const { t, restartPrompt, deletePrompt, fileImportPrompt } = controller;
  const appName = (appId: string) =>
    AGENT_IDS.includes(appId as AgentId) ? APP_META[appId as AgentId].name : appId;

  /** Resolve a structured restart reason to a user-facing guidance string.
   *  Falls back to the generic restart description when no reason is provided
   *  (e.g. older main process without the restartReason field). */
  const restartDescription = (() => {
    if (!restartPrompt) return null;
    const name = appName(restartPrompt.appId);
    switch (restartPrompt.restartReason) {
      case 'not-installed':
        return t.restartReasonNotInstalled;
      case 'not-running':
        return t.restartReasonNotRunning;
      case 'spawn-failed':
        return t.restartReasonSpawnFailed;
      case 'singleton-lock':
        return t.restartReasonSingletonLock;
      case 'cdp-timeout':
        return t.restartDescription(name);
      case 'no-cdp':
      default:
        return t.restartDescription(name);
    }
  })();

  // When the app is not installed or already running fine, the "Restart &
  // apply" button is misleading — hide it for reasons where a restart won't
  // help. The user needs to install / start / close the app manually first.
  const showRestartButton =
    !restartPrompt?.restartReason ||
    restartPrompt.restartReason === 'no-cdp' ||
    restartPrompt.restartReason === 'cdp-timeout';

  return (
    <>
      {/* Restart dialog */}
      <Dialog
        open={restartPrompt !== null}
        onOpenChange={(open) => {
          if (!open) controller.setRestartPrompt(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.restartTitle}</DialogTitle>
            <DialogDescription>{restartDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => controller.setRestartPrompt(null)}>
              {t.restartLater}
            </Button>
            {showRestartButton ? (
              <Button
                disabled={controller.busy !== null}
                onClick={() => {
                  const prompt = restartPrompt;
                  controller.setRestartPrompt(null);
                  if (prompt) {
                    void controller.applyToApp(prompt.themeId, prompt.themeName, prompt.appId, {
                      restartExisting: true,
                    });
                  }
                }}
              >
                {controller.busy?.startsWith('apply:') ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                {t.restartAndApply}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete theme dialog */}
      <Dialog
        open={deletePrompt !== null}
        onOpenChange={(open) => {
          if (!open) controller.setDeletePrompt(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.deleteTitle}</DialogTitle>
            <DialogDescription>
              {deletePrompt ? t.deleteDescription(deletePrompt.name) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => controller.setDeletePrompt(null)}>
              {t.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={controller.busy !== null}
              onClick={() => void controller.confirmDelete()}
            >
              {controller.busy?.startsWith('delete:') ? <Spinner data-icon="inline-start" /> : null}
              {t.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* File import dialog */}
      <Dialog
        open={fileImportPrompt !== null}
        onOpenChange={(open) => {
          if (!open) controller.setFileImportPrompt(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.fileImportReplaceTitle}</DialogTitle>
            <DialogDescription>
              {fileImportPrompt
                ? t.fileImportReplaceDescription(
                    fileImportPrompt.existing.displayName,
                    fileImportPrompt.existing.version,
                    fileImportPrompt.incoming.version,
                  )
                : null}
            </DialogDescription>
          </DialogHeader>
          {fileImportPrompt?.incoming.coverDataUrl && (
            <img
              src={fileImportPrompt.incoming.coverDataUrl}
              alt=""
              className="max-h-40 w-full rounded-lg border object-cover"
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => controller.setFileImportPrompt(null)}>
              {t.cancel}
            </Button>
            <Button
              disabled={controller.busy !== null}
              onClick={() => void controller.confirmFileImport()}
            >
              {controller.busy === 'import' ? <Spinner data-icon="inline-start" /> : null}
              {t.fileImportReplace}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
