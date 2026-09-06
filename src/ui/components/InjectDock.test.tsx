// SPDX-License-Identifier: MPL-2.0

/**
 * # InjectDock — restore-all loading state tests (REQ-D1)
 *
 * Covers the confirmed fix that restores full loading awareness to the dock:
 *   1. Restore button is disabled when `controller.busy` matches `restore:*`
 *   2. Restore button shows a spinner (not the normal icon) while restoring
 *
 * The 'ui' vitest project runs under `environment: 'node'`, so we assert
 * against `renderToStaticMarkup` output like the other component tests.
 */

import type { AppController } from '@/hooks/useAppController';
import type { BusyKey } from '@/stores/themeStore';

import type { UiMessages } from '@shared/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock components with distinguishable markers (hoisted so vi.mock can reference them) ---

const { SpinnerMock, RotateCcwMock, UploadMock } = vi.hoisted(() => ({
  SpinnerMock: () => '<span data-testid="spinner">spinner</span>',
  RotateCcwMock: () => '<svg data-icon="RotateCcw"></svg>',
  UploadMock: () => '<svg data-icon="Upload"></svg>',
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: SpinnerMock,
}));

// --- Mock CloseButton (uses Button + lucide X internally) -----------------

vi.mock('@/components/ui/close-button', () => ({
  CloseButton: () => null,
}));

// --- Mock lucide icons (SSR-safe) ----------------------------------------

vi.mock('lucide-react', () => ({
  RotateCcw: RotateCcwMock,
  Upload: UploadMock,
}));

// --- Mock cn utility -----------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// --- Import component AFTER mocks are registered ------------------------

import { InjectDock } from './InjectDock';

// --- Minimal UiMessages mock ---------------------------------------------

const mockT = {
  injectDockTitle: 'Inject Dock',
  injectDockActive: 'active',
  injectDockIdle: 'Idle',
  restoreAllAction: 'Restore All',
  close: 'Close',
} as unknown as UiMessages;

// --- Helpers -------------------------------------------------------------

function makeController(busy: BusyKey | null, activeApps = 1) {
  return {
    t: mockT,
    busy,
    status: {
      platform: 'win32',
      apps: Array.from({ length: activeApps }, (_, i) => ({
        appId: `agent-${i}`,
        displayName: `Agent ${i}`,
        installed: true,
        running: true,
        debugReady: true,
        port: 9222,
        activeThemeId: `theme-${i}`,
      })) as unknown as import('@shared/types').AppStatus[],
    },
    injectDockOpen: true,
    setInjectDockOpen: vi.fn(),
    setRestoreAllPrompt: vi.fn(),
  } satisfies Partial<AppController> as unknown as AppController;
}

function renderDock(busy: BusyKey | null, activeApps = 1) {
  return renderToStaticMarkup(<InjectDock controller={makeController(busy, activeApps)} />);
}

// --- Tests ----------------------------------------------------------------

describe('InjectDock — restore-all loading state (REQ-D1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Restore button disabled when busy matches restore:*
  // Note: renderToStaticMarkup serializes `disabled=""` and quotes as &quot;.
  // The Tailwind `disabled:` variant classes always appear in className, so we
  // assert on `disabled=""` specifically to distinguish real disabled state.
  it('D1.1: disables the restore button when busy matches "restore:*"', () => {
    const html = renderDock('restore:traework');
    expect(html).toContain('disabled=""');
  });

  it('D1.1b: does NOT disable the restore button when busy is null', () => {
    const html = renderDock(null, 1);
    expect(html).not.toContain('disabled=""');
  });

  it('D1.1c: does NOT disable for non-restore busy keys (e.g. "apply:")', () => {
    const html = renderDock('apply:traework', 1);
    expect(html).not.toContain('disabled=""');
  });

  // 2. Spinner shown while restoring
  // renderToStaticMarkup escapes quotes as &quot; inside attribute values.
  it('D1.2: shows a spinner instead of the normal icon when restoring', () => {
    const html = renderDock('restore:traework');
    expect(html).toContain('data-testid=&quot;spinner&quot;');
    // The normal RotateCcw icon must NOT be present inside the restore button.
    expect(html).not.toContain('data-icon=&quot;RotateCcw&quot;');
  });

  it('D1.2b: shows the normal RotateCcw icon when not restoring', () => {
    const html = renderDock(null);
    expect(html).toContain('data-icon=&quot;RotateCcw&quot;');
    expect(html).not.toContain('data-testid=&quot;spinner&quot;');
  });

  // Baseline: button is also disabled when there are no active apps
  it('D1.3: disables restore button when there are zero active injections', () => {
    const html = renderDock(null, 0);
    // activeApps.length === 0 disables the button regardless of busy state.
    expect(html).toContain('disabled=""');
  });
});
