// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper Lifecycle
 *
 * Suspends decoding of agent-injected *video* wallpapers on system power
 * events (suspend / battery) and resumes on resume / AC. The AgentSkin-own
 * background is paused separately in the renderer (DynamicBackground), but
 * agent pages are separate processes whose `<video>` would otherwise keep
 * decoding in the background, burning GPU/CPU/battery.
 *
 * The pause/resume hook (`window.AGENTSKIN_WP_PAUSE`) is installed by the
 * injected mount script in `cdp-wallpaper-inject.ts`; this module only
 * broadcasts to the currently-registered agents tracked by
 * `wallpaper-injector.ts`.
 */

import { app, powerMonitor } from 'electron';
import type { AgentId } from '../shared/types';
import type { CdpSession } from './cdp/cdp-client';
import { getActiveWallpaperAgents, openAgentWallpaperSession } from './wallpaper-injector';

let registered = false;

/** Register system-level pause/resume for agent-injected video wallpapers. */
export function registerWallpaperLifecycle(): void {
  if (registered) return;
  registered = true;

  const broadcast = async (paused: boolean): Promise<void> => {
    const agents = getActiveWallpaperAgents();
    await Promise.all(
      agents.map(async ({ appId, port }: { appId: AgentId; port: number }) => {
        let session: CdpSession | null = null;
        try {
          session = await openAgentWallpaperSession(appId, port);
          if (!session) return;
          await session.evaluate(
            `(function(){try{if(window.AGENTSKIN_WP_PAUSE)window.AGENTSKIN_WP_PAUSE(${paused});}catch(e){}})()`,
          );
        } catch {
          // best-effort: agent may have restarted or closed the target.
        } finally {
          session?.close();
        }
      }),
    );
  };

  // Suspend decoding when the machine sleeps or drops to battery power.
  powerMonitor.on('suspend', () => void broadcast(true));
  powerMonitor.on('on-battery', () => void broadcast(true));
  // Resume when back on AC or awake.
  powerMonitor.on('resume', () => void broadcast(false));
  powerMonitor.on('on-ac', () => void broadcast(false));

  // Be a good citizen on quit: stop decoding agent wallpapers.
  // Use `will-quit` (not `before-quit`) so that if the user cancels the
  // quit (e.g., "are you sure?" dialog calls event.preventDefault() in a
  // before-quit handler), the wallpapers are NOT paused and keep playing.
  // `will-quit` only fires after `before-quit` has run without being
  // prevented, so it reliably indicates the app is actually shutting down.
  app.on('will-quit', () => void broadcast(true));
}
