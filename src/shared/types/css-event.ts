// SPDX-License-Identifier: MPL-2.0

/**
 * # css-event
 *
 * Types for CDP CSS domain events pushed to the renderer.
 */

export type CssEventType = 'changed' | 'added' | 'removed';

export interface CssStyleSheetEvent {
  type: CssEventType;
  styleSheetId: string;
  /** Agent ID this event originated from. */
  agentId: string;
  /** Timestamp when the event was received. */
  timestamp: number;
}

export type CssEventHandler = (event: CssStyleSheetEvent) => void;
