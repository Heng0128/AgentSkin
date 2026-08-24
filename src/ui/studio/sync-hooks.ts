// SPDX-License-Identifier: MPL-2.0

/**
 * # sync-hooks
 *
 * Cross-store synchronization hooks for the decomposed studio stores.
 *
 * When boundaries between sub-stores need to react to each other (e.g. resetting
 * capture state when the active project changes), the coordination lives here —
 * not in the stores themselves.
 *
 * Extracted from the monolithic `studioStore.ts` as part of the
 * 5-store decomposition (P1-4 weight reduction).
 */

import { useCaptureStore } from '@/studio/capture-store';
import { useProjectStore } from '@/studio/project-store';

/**
 * When the active project changes, reset capture-related transient state
 * (undo/redo stacks, tool overrides) so that overrides from one project
 * don't leak into another.
 *
 * In the old monolithic store this was inlined within `selectProject` and
 * `changeAgent`. Here we use a subscription to keep the stores decoupled.
 */
let _prevActiveProjectId: string | null = useProjectStore.getState().activeProjectId;

export function initStudioCrossSync(): () => void {
  const unsubProject = useProjectStore.subscribe((s) => {
    if (s.activeProjectId !== _prevActiveProjectId) {
      _prevActiveProjectId = s.activeProjectId;
      const capture = useCaptureStore.getState();
      capture.resetOverrides();
      useCaptureStore.setState({
        undoStack: [],
        redoStack: [],
        pinnedSelectors: [],
        pseudoStates: [],
        customSelectorInput: '',
        pseudoView: null,
        schemeView: null,
        inspectingIdx: null,
      });
    }
  });

  return () => {
    unsubProject();
  };
}
