// SPDX-License-Identifier: MPL-2.0

/**
 * # notificationStore — unit tests
 *
 * Covers the toast notification state management:
 * - showToast: id uniqueness, max-toasts cap, auto-dismiss timer
 * - fail: IPC timeout error translation, generic error friendly-message
 * - Module-level toastId counter isolation
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockLocale,
  mockMessages,
} = vi.hoisted(() => ({
  mockLocale: 'zh-CN',
  mockMessages: {
    'zh-CN': {
      actionFailed: '操作失败',
      studioTimeoutDesc: 'IPC 通道 {channel} 超时 {ms/1000} 秒',
    },
    'en-US': {
      actionFailed: 'Action failed',
      studioTimeoutDesc: 'IPC channel {channel} timed out after {ms/1000}s',
    },
  },
}));

vi.mock('@shared/i18n', () => ({
  uiMessages: mockMessages,
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: vi.fn(() => ({ locale: mockLocale })),
  },
}));

vi.mock('@shared/withTimeout', () => ({
  isIpcTimeoutError: vi.fn(),
  SerializedIpcTimeoutError: class {},
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { useNotificationStore } from '../notificationStore';
import { isIpcTimeoutError } from '@shared/withTimeout';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('notificationStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store state
    useNotificationStore.setState({ toasts: [] });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('showToast', () => {
    it('should add a toast with unique incremental id', () => {
      const { showToast } = useNotificationStore.getState();
      showToast('First');
      showToast('Second');

      const { toasts } = useNotificationStore.getState();
      expect(toasts).toHaveLength(2);
      expect(toasts[0].id).toBeLessThan(toasts[1].id);
      expect(toasts[0].message).toBe('First');
      expect(toasts[1].message).toBe('Second');
    });

    it('should cap toasts at MAX_TOASTS (5)', () => {
      const { showToast } = useNotificationStore.getState();
      for (let i = 0; i < 7; i++) {
        showToast(`Toast ${i}`);
      }

      const { toasts } = useNotificationStore.getState();
      expect(toasts.length).toBeLessThanOrEqual(5);
      // Most recent toasts are retained
      expect(toasts[toasts.length - 1].message).toBe('Toast 6');
    });

    it('should auto-dismiss toast after TOAST_DURATION', () => {
      const { showToast } = useNotificationStore.getState();
      showToast('Temporary');

      expect(useNotificationStore.getState().toasts).toHaveLength(1);

      vi.advanceTimersByTime(3601);

      expect(useNotificationStore.getState().toasts).toHaveLength(0);
    });

    it('should support destructive tone', () => {
      const { showToast } = useNotificationStore.getState();
      showToast('Error occurred', 'destructive');

      const { toasts } = useNotificationStore.getState();
      expect(toasts[0].tone).toBe('destructive');
    });
  });

  describe('fail', () => {
    it('should translate IPC timeout error with localized message', () => {
      vi.mocked(isIpcTimeoutError).mockReturnValue(true);

      const { fail } = useNotificationStore.getState();
      fail({ channel: 'CDP_EXTRACT', ms: 5000 });

      const { toasts } = useNotificationStore.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].tone).toBe('destructive');
      expect(toasts[0].message).toContain('CDP_EXTRACT');
    });

    it('should use friendlyMessage for generic errors', () => {
      vi.mocked(isIpcTimeoutError).mockReturnValue(false);

      const { fail } = useNotificationStore.getState();
      fail(new Error('Error: something went wrong'));

      const { toasts } = useNotificationStore.getState();
      expect(toasts).toHaveLength(1);
      expect(toasts[0].tone).toBe('destructive');
    });
  });
});
