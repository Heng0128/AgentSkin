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
/**
 * References to the listeners installed by {@link registerWallpaperLifecycle}.
 * Kept so `_resetWallpaperLifecycleForTest()` can remove them (tests and
 * hot-reload need a way to register → reset → re-register).
 *
 * Keys are the electron event name used with on()/off().
 */
const installedListeners: Partial<Record<string, (...args: unknown[]) => void>> = {};

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

  const onSuspend = () => void broadcast(true);
  const onBattery = () => void broadcast(true);
  const onResume = () => void broadcast(false);
  const onAc = () => void broadcast(false);
  const onWillQuit = () => void broadcast(true);

  // Suspend decoding when the machine sleeps or drops to battery power.
  powerMonitor.on('suspend', onSuspend);
  installedListeners.suspend = onSuspend;
  powerMonitor.on('on-battery', onBattery);
  installedListeners['on-battery'] = onBattery;
  // Resume when back on AC or awake.
  powerMonitor.on('resume', onResume);
  installedListeners.resume = onResume;
  powerMonitor.on('on-ac', onAc);
  installedListeners['on-ac'] = onAc;

  // Be a good citizen on quit: stop decoding agent wallpapers.
  // Use `will-quit` (not `before-quit`) so that if the user cancels the
  // quit (e.g., "are you sure?" dialog calls event.preventDefault() in a
  // before-quit handler), the wallpapers are NOT paused and keep playing.
  // `will-quit` only fires after `before-quit` has run without being
  // prevented, so it reliably indicates the app is actually shutting down.
  app.on('will-quit', onWillQuit);
  installedListeners['will-quit'] = onWillQuit;
}

/**
 * Drop all registered lifecycle listeners and reset the `registered` flag.
 *
 * Production code never calls this; it exists so unit tests can exercise
 * `registerWallpaperLifecycle()` cleanly across test cases, and so
 * hot-reload can tear down + re-register without layering listeners.
 *
 * MUST NOT be called after electron starts dispatching power events in
 * real usage — the name explicitly flags it as a test-only helper.
 */
export function _resetWallpaperLifecycleForTest(): void {
  const suspend = installedListeners.suspend;
  if (suspend) powerMonitor.off('suspend', suspend);
  const onBattery = installedListeners['on-battery'];
  if (onBattery) powerMonitor.off('on-battery', onBattery);
  const resume = installedListeners.resume;
  if (resume) powerMonitor.off('resume', resume);
  const onAc = installedListeners['on-ac'];
  if (onAc) powerMonitor.off('on-ac', onAc);
  const willQuit = installedListeners['will-quit'];
  if (willQuit) app.off('will-quit', willQuit);

  for (const k of Object.keys(installedListeners)) {
    delete installedListeners[k as keyof typeof installedListeners];
  }
  registered = false;
}
