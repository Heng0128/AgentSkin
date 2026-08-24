// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio Store — re-export facade
 *
 * This file now re-exports from the decomposed studio sub-stores
 * (src/ui/studio/) via the useStudioStore facade. All existing consumers
 * continue to work without modification.
 *
 * See src/ui/studio/ for the individual sub-stores.
 */

export type { StudioBundle } from '@/studio/bundle-store';
export type { ExportState } from '@/studio/capture-store';
export type { CombinedStudioStore } from '@/studio/useStudioStore';
export { useActiveProject, useStudioStore } from '@/studio/useStudioStore';

// Backward-compatible re-export of the original interface name.
// Consumers importing StudioStoreState will get the combined type.
import type { CombinedStudioStore } from '@/studio/useStudioStore';
export type StudioStoreState = CombinedStudioStore;
