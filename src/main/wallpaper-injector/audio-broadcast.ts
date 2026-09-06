// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper Injector — Audio Broadcast
 *
 * System output level is sampled in the main process (audio-level.ts) and
 * pushed into every agent page that currently shows an audio-responsive web /
 * scene wallpaper. The page's signal bridge (buildWpSignalBridgeJs) forwards
 * it into the wallpaper iframe via postMessage. One poller is shared across
 * all agents; sessions unsubscribe on close / wallpaper removal.
 */

import { startAudioLevelPolling, stopAudioLevelPolling } from '../audio-level';
import type { CdpSession } from '../cdp/cdp-client';

/** CDP sessions currently showing an audio-responsive web/scene wallpaper. */
const audioBroadcastSessions = new Set<CdpSession>();

/** Start the shared sampler on first subscriber (idempotent). */
function ensureAudioPoller(): void {
  if (audioBroadcastSessions.size === 0) {
    startAudioLevelPolling((level) => {
      const v = level.toFixed(3);
      for (const session of audioBroadcastSessions) {
        // Fire-and-forget: a closed session just throws and is dropped.
        session.evaluate(`window.AGENTSKIN_WP_AUDIO&&window.AGENTSKIN_WP_AUDIO(${v})`).catch(() => {
          audioBroadcastSessions.delete(session);
        });
      }
    });
  }
}

/** Register a session for audio broadcast; unsubscribes on close. */
export function subscribeAudioSession(session: CdpSession): void {
  audioBroadcastSessions.add(session);
  ensureAudioPoller();
}

/** Unregister a session (called on injection failure / wallpaper removal). */
export function unsubscribeAudioSession(session: CdpSession): void {
  audioBroadcastSessions.delete(session);
  if (audioBroadcastSessions.size === 0) stopAudioLevelPolling();
}

/** Drop all audio subscribers + stop the sampler (app shutdown). */
export function disposeAudioBroadcast(): void {
  // Close every held session so the underlying WebSocket is released instead
  // of leaking until process exit (RC3: dispose only cleared the Set).
  for (const session of audioBroadcastSessions) {
    try {
      session.close();
    } catch {
      /* already closed */
    }
  }
  audioBroadcastSessions.clear();
  stopAudioLevelPolling();
}
