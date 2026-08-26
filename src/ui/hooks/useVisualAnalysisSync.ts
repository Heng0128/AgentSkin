// SPDX-License-Identifier: MPL-2.0

/**
 * # useVisualAnalysisSync
 *
 * Subscribes to real-time visual analysis progress events from the main
 * process and pushes them into `useVisualAnalysisStore`.
 *
 * Mounted when the Visual Analysis panel is visible — the subscription
 * lives for the component's lifetime and cleans up on unmount.
 */

import { useEffect } from 'react';
import { api } from '@/api/agentSkinClient';
import { useVisualAnalysisStore } from '@/stores/visualAnalysisStore';

export function useVisualAnalysisSync(): void {
  useEffect(() => {
    const unsub = api.onVisualAnalysisProgress((progress) => {
      useVisualAnalysisStore.getState().setProgress(progress);
    });
    return () => unsub();
  }, []);
}
