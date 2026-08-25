// SPDX-License-Identifier: MPL-2.0

import { APP_META } from '@/components/AppMark';
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

import { AGENT_IDS, type AgentId, type RestartReason } from '@shared/types';

/**
 * Whether a "restart/launch & apply" action button is shown for a restart
 * reason. Shared by the theme and wallpaper dialogs so both surfaces behave
 * identically.
 *
 * The button is HIDDEN when the action cannot help:
 *   - `not-installed` — the app must be installed first.
 *   - `spawn-failed` / `singleton-lock` — AgentSkin's own launch failed; the
 *     user should close the conflicting instance or start the app manually.
 *
 * It is SHOWN (and, for `not-running`, labeled "启动并应用") when the action
 * CAN fix the situation: `no-cdp` (restart to enable the debug port),
 * `cdp-timeout` (retry), `not-running` (launch from install path), or when no
 * reason was provided (older main process — fall back to the button).
 */
export function shouldShowActionButton(reason: RestartReason | undefined): boolean {
  if (!reason) return true;
  return reason === 'no-cdp' || reason === 'cdp-timeout' || reason === 'not-running';
}

export function DialogsHost({ controller }: { controller: AppController }) {
  const {
    t,
    restartPrompt,
    wallpaperRestartPrompt,
    launchRestartPrompt,
    deletePrompt,
    fileImportPrompt,
  } = controller;
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
      case 'kill-denied':
        return t.restartReasonKillDenied;
      case 'cdp-timeout':
        return t.restartDescription(name);
      default:
        return t.restartDescription(name);
    }
  })();

  /** Wallpaper dialog description — same reason mapping as the theme dialog. */
  const wallpaperRestartDescription = (() => {
    if (!wallpaperRestartPrompt) return null;
    const name = appName(wallpaperRestartPrompt.appId);
    switch (wallpaperRestartPrompt.restartReason) {
      case 'not-installed':
        return t.restartReasonNotInstalled;
      case 'not-running':
        return t.restartReasonNotRunning;
      case 'spawn-failed':
        return t.restartReasonSpawnFailed;
      case 'singleton-lock':
        return t.restartReasonSingletonLock;
      case 'kill-denied':
        return t.restartReasonKillDenied;
      case 'no-cdp':
        return t.restartReasonNoCdp;
      case 'cdp-timeout':
        return t.restartDescription(name);
      default:
        return t.restartDescription(name);
    }
  })();

  return (
    <>
      {/* Restart dialog (theme apply) */}
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
            {shouldShowActionButton(restartPrompt?.restartReason) ? (
              <Button
                disabled={controller.busy !== null}
                onClick={() => {
                  const prompt = restartPrompt;
                  controller.setRestartPrompt(null);
                  if (prompt) {
                    void controller.applyToApp(prompt.themeId, prompt.themeName, prompt.appId, {
                      restartExisting: true,
                      schemeId: prompt.schemeId,
                    });
                  }
                }}
              >
                {controller.busy?.startsWith('apply:') ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                {restartPrompt?.restartReason === 'not-running'
                  ? t.launchAndApply
                  : t.restartAndApply}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Launch restart dialog — shown when launching a scanned Electron app
          returns `needs-restart` (P0-5, RFC 2026-08-19 R5). The app needs a
          restart to enable its debug port; the action re-launches it with
          forceRestart. */}
      <Dialog
        open={launchRestartPrompt !== null}
        onOpenChange={(open) => {
          if (!open) controller.setLaunchRestartPrompt(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.launchRestartTitle}</DialogTitle>
            <DialogDescription>
              {launchRestartPrompt
                ? t.launchRestartDescription(launchRestartPrompt.name)
                : t.restartDescription('')}
            </DialogDescription>
            {launchRestartPrompt?.message ? (
              <p className="text-[13px] text-muted-foreground/80">{launchRestartPrompt.message}</p>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => controller.setLaunchRestartPrompt(null)}>
              {t.restartLater}
            </Button>
            <Button
              disabled={controller.busy !== null}
              onClick={() => {
                const prompt = launchRestartPrompt;
                if (prompt) void controller.forceRestartLaunch(prompt.appId);
              }}
            >
              {t.forceRestart}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wallpaper restart dialog — shown when wallpaper apply returns
          `requires-restart`. The user must explicitly click "Restart &
          apply" (or "Launch & apply" when the agent is not running) before
          the agent is killed + relaunched with CDP. */}
      <Dialog
        open={wallpaperRestartPrompt !== null}
        onOpenChange={(open) => {
          if (!open) controller.setWallpaperRestartPrompt(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t.restartTitle}</DialogTitle>
            <DialogDescription>{wallpaperRestartDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => controller.setWallpaperRestartPrompt(null)}>
              {t.restartLater}
            </Button>
            {shouldShowActionButton(wallpaperRestartPrompt?.restartReason) ? (
              <Button
                disabled={controller.busy !== null}
                onClick={() => {
                  const prompt = wallpaperRestartPrompt;
                  controller.setWallpaperRestartPrompt(null);
                  if (prompt) {
                    void controller.wallpaper.setAndApplyAgentWallpaper(
                      prompt.appId,
                      true,
                      prompt.wallpaperId ?? null,
                      { restartExisting: true },
                    );
                  }
                }}
              >
                {controller.busy?.startsWith('apply:') ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                {wallpaperRestartPrompt?.restartReason === 'not-running'
                  ? t.launchAndApply
                  : t.restartAndApply}
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
              className="max-h-40 w-full rounded-md border object-cover"
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
