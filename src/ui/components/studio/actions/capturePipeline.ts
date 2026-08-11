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

export type CaptureTarget = 'current' | 'baseline';

export interface CaptureOptions {
  /** Switch to preview view after capture completes (default: true). */
  switchToPreview?: boolean;
  /** Show a landmark count in the success toast (default: true). */
  showLandmarkCount?: boolean;
}

/**
 * Capture an agent snapshot (current or baseline) and surface a toast
 * with the result. Re-throws after notifying so callers can chain
 * additional error handling.
 */
export async function captureAgentSnapshot(
  _agentId: string,
  target: CaptureTarget,
  opts: CaptureOptions = {},
): Promise<void> {
  const { showToast } = useNotificationStore.getState();
  const studio = useStudioStore.getState();

  opts = { switchToPreview: true, showLandmarkCount: true, ...opts };

  try {
    if (target === 'baseline') {
      showToast('Capturing baseline…');
      await studio.baselineSnapshot();
    } else {
      showToast('Capturing…');
      await studio.captureSnapshot();
    }

    const snap = useStudioStore.getState().snapshot;
    if (opts.showLandmarkCount && snap?.landmarks?.length) {
      showToast(`Captured · ${snap.landmarks.length} landmarks`);
    }
  } catch (err) {
    showToast(
      `Capture failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      'destructive',
    );
    throw err;
  }
}
