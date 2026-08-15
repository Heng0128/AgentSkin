// SPDX-License-Identifier: MPL-2.0

/**
 * # capturePipeline
 *
 * Shared helper for agent snapshot capture — wraps studioStore's
 * captureSnapshot / baselineSnapshot with toast notifications and
 * consistent landmark-count feedback. Used by toolbars and keyboard
 * shortcuts so capture logic lives in one place.
 */

import { useNotificationStore } from '@/stores/notificationStore';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';

export type CaptureTarget = 'current' | 'baseline';

export interface CaptureOptions {
  /** Switch to preview view after capture completes (default: true). */
  switchToPreview?: boolean;
  /** Show a landmark count in the success toast (default: true). */
  showLandmarkCount?: boolean;
  /** i18n messages for localized toasts (required). */
  t: UiMessages;
}

/**
 * Capture an agent snapshot (current or baseline) and surface a toast
 * with the result. Re-throws after notifying so callers can chain
 * additional error handling.
 */
export async function captureAgentSnapshot(
  _agentId: string,
  target: CaptureTarget,
  opts: CaptureOptions,
): Promise<void> {
  const { showToast } = useNotificationStore.getState();
  const studio = useStudioStore.getState();
  const { t } = opts;

  opts = { switchToPreview: true, showLandmarkCount: true, ...opts };

  try {
    if (target === 'baseline') {
      showToast(t.studioToastCapturingBaseline);
      await studio.baselineSnapshot();
    } else {
      showToast(t.studioToastCapturing);
      await studio.captureSnapshot();
    }

    const snap = useStudioStore.getState().snapshot;
    if (opts.showLandmarkCount && snap?.landmarks?.length) {
      showToast(t.studioToastCapturedCount(snap.landmarks.length));
    }
  } catch (err) {
    showToast(
      t.studioToastCaptureFailed(err instanceof Error ? err.message : 'Unknown error'),
      'destructive',
    );
    throw err;
  }
}
