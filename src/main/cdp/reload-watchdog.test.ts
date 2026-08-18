// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventCdpSession } from './cdp-client';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test.
// ---------------------------------------------------------------------------

vi.mock('./cdp-client', () => ({
  connectEventCdp: vi.fn(),
}));

vi.mock('./injection/shared', () => ({
  verifyTheme: vi.fn(),
}));

// Import mocked modules AFTER mock declarations.
const { connectEventCdp } = await import('./cdp-client');
const { verifyTheme } = await import('./injection/shared');
const {
  attachReloadWatchdog,
  detachReloadWatchdog,
  disposeReloadWatchdogs,
  getReloadWatchdogKeys,
} = await import('./reload-watchdog');

// ---------------------------------------------------------------------------
// Factories / helpers
// ---------------------------------------------------------------------------

/** A controllable event session: lets the test fire events through `handlers`. */
function makeEventSession() {
  const handlers = new Map<string, (params: unknown) => void>();
  const send = vi.fn().mockResolvedValue({});
  const evaluate = vi.fn().mockResolvedValue('{}');
  const close = vi.fn();
  const session = {
    send,
    evaluate,
    close,
    on: vi.fn((method: string, handler: (params: unknown) => void) => {
      handlers.set(method, handler);
    }),
    off: vi.fn((method: string, handler: (params: unknown) => void) => {
      if (handlers.get(method) === handler) handlers.delete(method);
    }),
  } as unknown as EventCdpSession;
  return { session, handlers };
}

function makeDeps(overrides: Partial<Parameters<typeof attachReloadWatchdog>[0]['deps']> = {}) {
  return {
    isEpochCurrent: vi.fn().mockReturnValue(true),
    tryEngineInjection: vi.fn().mockResolvedValue({
      layersInjected: 4,
      adapterApplied: true,
      heroInjected: true,
    }),
    log: vi.fn(),
    ...overrides,
  } as Parameters<typeof attachReloadWatchdog>[0]['deps'];
}

function makeOptions(overrides: Partial<Parameters<typeof attachReloadWatchdog>[0]> = {}) {
  const deps = makeDeps(overrides.deps);
  return {
    appId: 'doubao' as const,
    pageTargetUrl: 'ws://127.0.0.1:9222/devtools/page/1',
    bundle: { format: 'agentskin-theme' } as never,
    targetTheme: { css: ':root{}' } as never,
    imageDataUrls: null,
    epoch: 1,
    deps,
    ...overrides,
  };
}

const flushTimers = () => new Promise((r) => setTimeout(r, 0));
// The nav re-verify is debounced (RELOAD_DEBOUNCE_MS = 600ms) — wait past it.
const settleAfterNav = () => new Promise((r) => setTimeout(r, 700));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(connectEventCdp).mockResolvedValue(makeEventSession().session);
});

afterEach(() => {
  disposeReloadWatchdogs();
});

describe('attachReloadWatchdog', () => {
  it('is a no-op when no pageTargetUrl is provided', () => {
    attachReloadWatchdog(makeOptions({ pageTargetUrl: undefined }));
    expect(connectEventCdp).not.toHaveBeenCalled();
    expect(getReloadWatchdogKeys()).toEqual([]);
  });

  it('opens a long-lived event session and subscribes to Page.loadEventFired', async () => {
    const { session } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const opts = makeOptions();
    const deps = opts.deps;

    attachReloadWatchdog(opts);

    await flushTimers();
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('armed'));
    expect(session.on).toHaveBeenCalledWith('Page.loadEventFired', expect.any(Function));
    expect(session.send).toHaveBeenCalledWith('Page.enable');
  });

  it('is idempotent within the same epoch — refreshes payload, does not reopen', async () => {
    const { session } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);

    attachReloadWatchdog(makeOptions());
    await flushTimers();
    attachReloadWatchdog(makeOptions({ targetTheme: { css: ':root{new}' } as never }));

    expect(connectEventCdp).toHaveBeenCalledTimes(1);
    expect(session.close).not.toHaveBeenCalled();
  });
});

describe('detachReloadWatchdog', () => {
  it('closes the session and unsubscribes the nav handler', async () => {
    const { session } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    attachReloadWatchdog(makeOptions());
    await flushTimers();

    detachReloadWatchdog('doubao');
    await flushTimers();

    expect(session.close).toHaveBeenCalled();
    expect(getReloadWatchdogKeys()).toEqual([]);
  });
});

describe('reverifyAfterNavigation (Page.loadEventFired)', () => {
  it('does NOT re-inject when the engine sheets are already present', async () => {
    vi.mocked(verifyTheme).mockResolvedValue({
      accent: '#f00',
      agentskinArt: '',
      heroBlobActive: false,
      adoptedSheetCount: 3,
    });
    const { session, handlers } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const opts = makeOptions();
    const tryEngineInjection = opts.deps.tryEngineInjection;

    attachReloadWatchdog(opts);
    await flushTimers();

    handlers.get('Page.loadEventFired')!(undefined);
    await settleAfterNav();

    expect(tryEngineInjection).not.toHaveBeenCalled();
    // Stays armed for the next navigation.
    expect(getReloadWatchdogKeys()).toEqual(['doubao']);
  });

  it('re-injects exactly once when the engine sheets are missing', async () => {
    vi.mocked(verifyTheme).mockResolvedValue({
      accent: '',
      agentskinArt: '',
      heroBlobActive: false,
      adoptedSheetCount: 0,
    });
    const { session, handlers } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const opts = makeOptions();
    const tryEngineInjection = opts.deps.tryEngineInjection;

    attachReloadWatchdog(opts);
    await flushTimers();

    handlers.get('Page.loadEventFired')!(undefined);
    await settleAfterNav();

    expect(tryEngineInjection).toHaveBeenCalledTimes(1);
    expect(opts.deps.log).toHaveBeenCalledWith(expect.stringContaining('re-injected'));
  });

  it('disarms and does NOT re-inject when the epoch is no longer current', async () => {
    const { session, handlers } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const opts = makeOptions({
      deps: makeDeps({ isEpochCurrent: vi.fn().mockReturnValue(false) }),
    });
    const tryEngineInjection = opts.deps.tryEngineInjection;

    attachReloadWatchdog(opts);
    await flushTimers();

    handlers.get('Page.loadEventFired')!(undefined);
    await settleAfterNav();

    expect(tryEngineInjection).not.toHaveBeenCalled();
    expect(getReloadWatchdogKeys()).toEqual([]);
    expect(session.close).toHaveBeenCalled();
  });

  it('re-injects via a fresh verify after debounce and tolerates verify failures', async () => {
    // verifyTheme error-tolerant: returns null on evaluate failure → treat as
    // absent → re-inject. Assert the fallback branch logs the re-inject attempt.
    vi.mocked(verifyTheme).mockResolvedValue(null);
    const { session, handlers } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);
    const opts = makeOptions();

    attachReloadWatchdog(opts);
    await flushTimers();

    handlers.get('Page.loadEventFired')!(undefined);
    await settleAfterNav();

    expect(opts.deps.tryEngineInjection).toHaveBeenCalledTimes(1);
  });
});

describe('disposeReloadWatchdogs', () => {
  it('tears down every armed watchdog', async () => {
    const a = makeEventSession().session;
    const b = makeEventSession().session;
    vi.mocked(connectEventCdp).mockResolvedValueOnce(a).mockResolvedValueOnce(b);

    attachReloadWatchdog(makeOptions());
    attachReloadWatchdog(makeOptions({ appId: 'traework' }));
    await flushTimers();

    expect(getReloadWatchdogKeys()).toContain('doubao');
    expect(getReloadWatchdogKeys()).toContain('traework');

    disposeReloadWatchdogs();

    expect(a.close).toHaveBeenCalled();
    expect(b.close).toHaveBeenCalled();
    expect(getReloadWatchdogKeys()).toEqual([]);
  });
});
