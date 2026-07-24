// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import type { UiMessages } from '@shared/i18n';

/**
 * # useRelativeTime
 *
 * Returns a localized "updated Ns ago" string that ticks every second.
 * Eliminates the duplicated 1s `setInterval` + relative-time logic that was
 * previously copy-pasted in AgentStatusBar and WallpaperEnginePage.
 *
 * @param lastStatusAt  Epoch ms of the last successful status refresh, or null.
 * @param isRefreshing  Whether a refresh is currently in flight.
 * @param t             UiMessages for localized strings.
 */
export function useRelativeTime(
  lastStatusAt: number | null,
  isRefreshing: boolean,
  t: UiMessages,
): string {
  // 1s ticker so the relative-time label updates continuously.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (isRefreshing) return t.statusRefreshing;
  if (lastStatusAt == null) return t.statusDetecting;
  const seconds = Math.max(0, Math.floor((Date.now() - lastStatusAt) / 1000));
  return seconds < 1
    ? t.statusUpdatedJustNow
    : t.statusUpdatedSecondsAgo(seconds);
}
