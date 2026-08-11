// SPDX-License-Identifier: MPL-2.0

/**
 * # dialog-events
 *
 * Event emitter for cross-store dialog signals. Used by dialogStore to
 * broadcast restart / delete / file-import prompts to subscribers.
 */

import { EventEmitter } from 'node:events';

export const dialogEvents = new EventEmitter();
