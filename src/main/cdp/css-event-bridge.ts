// SPDX-License-Identifier: MPL-2.0

/**
 * # css-event-bridge
 *
 * Subscribes to CDP CSS domain events and forwards them to the renderer
 * via IPC. Uses a long-lived EventCdpSession per agent.
 *
 * ## Lifecycle
 *
 * - Created when an agent theme is applied
 * - Subscribes to CSS.styleSheetChanged / styleSheetAdded / styleSheetRemoved
 * - Forwards events to renderer via IpcChannel.CSS_EVENTS
 * - Disposed when the agent session ends or theme is removed
 */

import { IpcChannel } from '../../shared/ipc-channels';
import type { CssEventHandler, CssStyleSheetEvent } from '../../shared/types/css-event';
import { ctx } from '../main-context';
import type { EventCdpSession } from './cdp-client';
import { connectEventCdp } from './cdp-client';
import { findPageTarget } from './cdp-targets';

interface CssEventState {
  session: EventCdpSession;
  onChanged: (params: unknown) => void;
  onAdded: (params: unknown) => void;
  onRemoved: (params: unknown) => void;
  closed: boolean;
}

// EventCdpSession per agent
const sessions = new Map<string, CssEventState>();
const handlers = new Map<string, CssEventHandler>();

/** Extract styleSheetId from CSS.styleSheetChanged / CSS.styleSheetRemoved params. */
function extractStyleSheetId(params: unknown): string | undefined {
  if (params && typeof params === 'object' && 'styleSheetId' in params) {
    const id = (params as { styleSheetId: unknown }).styleSheetId;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

/** Extract styleSheetId from CSS.styleSheetAdded params (nested under header). */
function extractAddedStyleSheetId(params: unknown): string | undefined {
  if (params && typeof params === 'object' && 'header' in params) {
    const header = (params as { header: unknown }).header;
    if (header && typeof header === 'object' && 'styleSheetId' in header) {
      const id = (header as { styleSheetId: unknown }).styleSheetId;
      if (typeof id === 'string') return id;
    }
  }
  return undefined;
}

/** Forward a CSS event to the renderer via IPC and to any registered test handler. */
function forwardToRenderer(
  agentId: string,
  type: CssStyleSheetEvent['type'],
  styleSheetId: string,
): void {
  const event: CssStyleSheetEvent = {
    type,
    styleSheetId,
    agentId,
    timestamp: Date.now(),
  };
  // Test handler (registered via onCssEvent).
  const handler = handlers.get(agentId);
  if (handler) handler(event);
  // Forward to renderer.
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send(IpcChannel.CSS_EVENTS, event);
  }
}

/**
 * Start listening for CSS events on the given agent session.
 */
export async function startCssEventSession(agentId: string, port: number): Promise<void> {
  // 1. Check if already started
  if (sessions.has(agentId)) return;

  // 2. Resolve page target URL from port
  const target = await findPageTarget(port);
  if (!target?.webSocketDebuggerUrl) {
    throw new Error(`CSS event bridge: no page target for agent ${agentId} on port ${port}`);
  }

  // 3. Connect EventCdpSession via connectEventCdp
  const session = await connectEventCdp(target.webSocketDebuggerUrl);

  // Double-check after async — another call may have started the session.
  if (sessions.has(agentId)) {
    session.close();
    return;
  }

  // 4. Build state (handlers check closed flag to prevent post-stop delivery)
  const state: CssEventState = {
    session,
    onChanged: () => {},
    onAdded: () => {},
    onRemoved: () => {},
    closed: false,
  };

  state.onChanged = (params: unknown) => {
    if (state.closed) return;
    const id = extractStyleSheetId(params);
    if (id) forwardToRenderer(agentId, 'changed', id);
  };
  state.onAdded = (params: unknown) => {
    if (state.closed) return;
    const id = extractAddedStyleSheetId(params);
    if (id) forwardToRenderer(agentId, 'added', id);
  };
  state.onRemoved = (params: unknown) => {
    if (state.closed) return;
    const id = extractStyleSheetId(params);
    if (id) forwardToRenderer(agentId, 'removed', id);
  };

  // 5. Subscribe to CSS events
  session.on('CSS.styleSheetChanged', state.onChanged);
  session.on('CSS.styleSheetAdded', state.onAdded);
  session.on('CSS.styleSheetRemoved', state.onRemoved);

  // 6. Enable CSS domain (best-effort)
  try {
    await session.send('CSS.enable');
  } catch {
    // Some targets may not support CSS domain — events simply won't fire.
  }

  // 7. Store state + log
  sessions.set(agentId, state);
  console.log(`[css-event-bridge] started session for ${agentId}`);
}

/**
 * Stop listening and cleanup.
 */
export async function stopCssEventSession(agentId: string): Promise<void> {
  const state = sessions.get(agentId);
  if (!state) return;
  sessions.delete(agentId);
  handlers.delete(agentId);
  state.closed = true;
  // 1. Unsubscribe events
  state.session.off('CSS.styleSheetChanged', state.onChanged);
  state.session.off('CSS.styleSheetAdded', state.onAdded);
  state.session.off('CSS.styleSheetRemoved', state.onRemoved);
  // 2. Close session
  try {
    state.session.close();
  } catch {
    // Already closed.
  }
  console.log(`[css-event-bridge] stopped session for ${agentId}`);
}

/**
 * Register a handler for CSS events (for testing).
 */
export function onCssEvent(agentId: string, handler: CssEventHandler): void {
  handlers.set(agentId, handler);
}

/** Test-only: get the set of active agent ids. */
export function getCssEventSessionKeys(): string[] {
  return Array.from(sessions.keys());
}

/** Test-only: clear all sessions and handlers. */
export function disposeCssEventSessions(): void {
  for (const agentId of Array.from(sessions.keys())) {
    void stopCssEventSession(agentId);
  }
  handlers.clear();
}
