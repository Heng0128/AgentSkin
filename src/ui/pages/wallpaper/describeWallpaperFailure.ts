// SPDX-License-Identifier: MPL-2.0

import type { UiMessages } from '@shared/i18n';

/**
 * Map a wallpaper injection `detail` verdict to a human-readable, localized
 * failure message. The engine emits raw verdicts like
 * `stream:loadfail:src-not-supported`, `image:loadfail:csp-or-unsupported`,
 * `cdp-connect-failed:CDP request timed out`, which are meaningless to users.
 *
 * Classification priority (a detail string may carry multiple per-target
 * verdicts joined by `, ` or `|`):
 * 1. Codec unsupported — `src-not-supported` (video.error.code === 4). The
 *    stream→blob fallback cannot fix this (same codec), so the only remedy is
 *    transcoding. Surfaced with an actionable "transcode to H.264" hint.
 * 2. CDP connect / timeout — `cdp-connect-failed` or `CDP request timed out`
 *    or `WebSocket closed`. Usually transient; retry after confirming the app
 *    is running.
 * 3. CSP / media load failure — `loadfail:csp-or-unsupported`, `loadfail`
 *    without a codec code, `blob:loadfail`. Indicates the app's CSP blocked
 *    the media source or the media failed to decode.
 * 4. Other / unknown — fallback.
 *
 * Returns the localized message; never returns the raw verdict.
 */
export function describeWallpaperFailure(detail: string | undefined, t: UiMessages): string {
  if (!detail) return t.wpFailUnknown;
  const lower = detail.toLowerCase();
  // Codec not supported (MEDIA_ERR_SRC_NOT_SUPPORTED). Highest priority: the
  // fallback path can't help, so the user MUST transcode.
  if (lower.includes('src-not-supported')) return t.wpFailCodec;
  // CDP transport failures: connect refused, command timeout, socket closed.
  if (
    lower.includes('cdp-connect-failed') ||
    lower.includes('timed out') ||
    lower.includes('websocket closed') ||
    lower.includes('cdp request')
  ) {
    return t.wpFailCdp;
  }
  // Visibility probe failure: media loaded but wallpaper is not visible
  // (punch-through failed, element removed by React, or clipped). Retry
  // usually fixes this because the punch-through is timing-sensitive.
  if (lower.includes('invisible')) {
    return t.wpFailInvisible;
  }
  // CSP block or generic media load failure (not codec-specific).
  if (
    lower.includes('csp-or-unsupported') ||
    lower.includes('loadfail') ||
    lower.includes('blob:loadfail') ||
    lower.includes('stream:loadfail')
  ) {
    return t.wpFailCsp;
  }
  return t.wpFailOther;
}
