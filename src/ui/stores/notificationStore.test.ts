// SPDX-License-Identifier: MPL-2.0

/**
 * # notificationStore Tests
 *
 * Tests for toast notification state and error handling:
 * - showToast: adds toast, respects MAX_TOASTS limit, auto-removes after duration
 * - fail: translates errors to user-friendly messages, handles IPC timeout errors
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: vi.fn(() => ({ locale: 'zh-CN' })),
    setState: vi.fn(),
  },
}));

vi.mock('@shared/i18n', () => ({
  uiMessages: {
    'zh-CN': {
      actionFailed: '操作失败',
      studioTimeoutDesc: '通道 {channel} 超时（{ms/1000} 秒）',
    },
    'en-US': {
      actionFailed: 'Action failed',
      studioTimeoutDesc: 'Channel {channel} timed out ({ms/1000}s)',
    },
  },
  type: {} as import('@shared/i18n').AppLocale,
}));

vi.mock('@shared/withTimeout', () => ({
  isIpcTimeoutError: vi.fn(() => false),
  type: {} as import('@shared/withTimeout').SerializedIpcTimeoutError,
}));

vi.mock('@shared/errors', () => ({
  toMessage: vi.fn((error: unknown) => {
    if (error instanceof Error) return error.message;
    return String(error);
  }),
}));

import { useNotificationStore } from './notificationStore';

// ---------------------------------------------------------------------------
// showToast tests
// ---------------------------------------------------------------------------

describe('notificationStore showToast', () => {
  beforeEach(() => {
    useNotificationStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds a toast to the list', () => {
    useNotificationStore.getState().showToast('Test message');
    const state = useNotificationStore.getState();
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].message).toBe('Test message');
    expect(state.toasts[0].tone).toBe('default');
  });

  it('adds a destructive toast when tone is specified', () => {
    useNotificationStore.getState().showToast('Error message', 'destructive');
    const state = useNotificationStore.getState();
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].tone).toBe('destructive');
  });

  it('auto-removes toast after duration', () => {
    useNotificationStore.getState().showToast('Temporary message');
    expect(useNotificationStore.getState().toasts).toHaveLength(1);

    // Advance timers past the toast duration (3600ms)
    vi.advanceTimersByTime(4000);

    expect(useNotificationStore.getState().toasts).toHaveLength(0);
  });

  it('respects MAX_TOASTS limit (5)', () => {
    // Add 7 toasts (exceeds MAX_TOASTS = 5)
    for (let i = 0; i < 7; i++) {
      useNotificationStore.getState().showToast(`Message ${i}`);
    }

    const state = useNotificationStore.getState();
    // Should only keep the last 5
    expect(state.toasts.length).toBeLessThanOrEqual(5);
    // The oldest messages should be evicted
    expect(state.toasts[0].message).toBe('Message 2');
  });

  it('assigns unique ids to each toast', () => {
    useNotificationStore.getState().showToast('Message 1');
    useNotificationStore.getState().showToast('Message 2');
    useNotificationStore.getState().showToast('Message 3');

    const state = useNotificationStore.getState();
    const ids = state.toasts.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ---------------------------------------------------------------------------
// fail tests
// ---------------------------------------------------------------------------

describe('notificationStore fail', () => {
  beforeEach(() => {
    useNotificationStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('translates Error objects to toast messages', () => {
    const error = new Error('Something went wrong');
    useNotificationStore.getState().fail(error);

    const state = useNotificationStore.getState();
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].tone).toBe('destructive');
  });

  it('handles string errors', () => {
    useNotificationStore.getState().fail('Plain string error');

    const state = useNotificationStore.getState();
    expect(state.toasts).toHaveLength(1);
    expect(state.toasts[0].tone).toBe('destructive');
  });

  it('handles null/undefined errors gracefully', () => {
    useNotificationStore.getState().fail(null);
    useNotificationStore.getState().fail(undefined);

    // Should not throw and should add toasts (null/undefined → actionFailed toast each)
    const state = useNotificationStore.getState();
    expect(state.toasts.length).toBe(2);
    expect(state.toasts.every((toast) => toast.tone === 'destructive')).toBe(true);
  });
});
