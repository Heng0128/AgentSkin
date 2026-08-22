// SPDX-License-Identifier: MPL-2.0

/**
 * # drift-status (UI alias)
 *
 * UI-side re-export of the shared drift-status contract. Components import
 * from this path (`@/types/drift-status`) to preserve the UI-layer import
 * convention, but the actual type definition lives in `shared/types/drift-status.ts`
 * so it can be consumed by both the IPC contract and the UI without crossing
 * architecture boundaries.
 */

export type { DriftSignal, DriftStatus, RegenResult } from '@shared/types/drift-status';
