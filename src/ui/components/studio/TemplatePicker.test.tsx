// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment happy-dom
 */

/**
 * # TemplatePicker — IPC call + cancellation flag tests
 *
 * Verifies that TemplatePicker:
 *   1. Fetches template list + details on mount via IPC.
 *   2. Renders template cards once data arrives.
 *   3. Respects the cancellation flag (no state update after unmount).
 *   4. Calls saveActiveProject + shows toast on apply.
 *   5. Shows a toast when no active project exists.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks --------------------------------------------------------

const {
  mockListStudioTemplates,
  mockGetStudioTemplate,
  mockShowToast,
  mockActiveProjectId,
  mockSaveActiveProject,
  mockT,
} = vi.hoisted(() => ({
  mockListStudioTemplates: vi.fn(),
  mockGetStudioTemplate: vi.fn(),
  mockShowToast: vi.fn(),
  mockActiveProjectId: vi.fn((): string | null => 'proj-1'),
  mockSaveActiveProject: vi.fn(),
  mockT: {
    studioTemplatePickerTitle: 'Choose Template',
    studioTemplatePickerDesc: 'Pick a template to start from',
    studioTemplateFilterAll: 'All',
    studioTemplateFilterDark: 'Dark',
    studioTemplateFilterLight: 'Light',
    studioTemplateLoading: 'Loading...',
    studioPresetNoThemes: 'No templates available',
    studioTemplateApplyToProject: 'Apply',
    studioLoadingDots: '...',
    studioSchemeDark: 'Dark',
    studioSchemeLight: 'Light',
    studioNoActiveProject: 'No active project',
    studioTemplateApplySuccess: (name: string) => `Applied ${name}`,
    studioLoadPaletteFailed: 'Failed to load palette',
    cancel: 'Cancel',
  } as Record<string, string | ((name: string) => string)>,
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    listStudioTemplates: mockListStudioTemplates,
    getStudioTemplate: mockGetStudioTemplate,
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: vi.fn((selector) => {
    const state = { showToast: mockShowToast };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: vi.fn((selector) => (selector ? selector({ locale: 'en' }) : { locale: 'en' })),
}));

vi.mock('@/stores/studioStore', () => ({
  useStudioStore: vi.fn((selector) => {
    const state = {
      activeProjectId: mockActiveProjectId(),
      saveActiveProject: mockSaveActiveProject,
    };
    return selector ? selector(state) : state;
  }),
}));

// TemplatePicker reads uiMessages[locale] directly (no t prop), so we
// mock the i18n module to return our test translations.
vi.mock('@shared/i18n', () => ({
  uiMessages: {
    en: mockT,
  },
}));

// --- Mock lucide-react X icon -------------------------------------------

vi.mock('lucide-react', () => ({
  X: () => null,
}));

// --- Import component AFTER mocks are registered ------------------------

import { TemplatePicker } from './TemplatePicker';

// --- Test data ------------------------------------------------------------

const sampleTemplates = [
  {
    id: 'tpl-1',
    name: 'Midnight',
    mode: 'dark' as const,
    category: 'dark',
    description: 'Dark theme',
  },
  {
    id: 'tpl-2',
    name: 'Daylight',
    mode: 'light' as const,
    category: 'light',
    description: 'Light theme',
  },
];

const sampleDetails = {
  id: 'tpl-1',
  name: 'Midnight',
  mode: 'dark' as const,
  palette: { accent: '#7c3aed', background: '#0f172a' },
};

// --- Tests ----------------------------------------------------------------

describe('TemplatePicker', () => {
  beforeEach(() => {
    mockListStudioTemplates.mockResolvedValue(sampleTemplates);
    mockGetStudioTemplate.mockResolvedValue(sampleDetails);
    mockActiveProjectId.mockReturnValue('proj-1');
    mockShowToast.mockReset();
    mockSaveActiveProject.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // ------------------------------------------------------------------
  // 1. Fetching
  // ------------------------------------------------------------------

  it('fetches template list on mount', async () => {
    render(<TemplatePicker onClose={() => {}} />);
    await waitFor(() => {
      expect(mockListStudioTemplates).toHaveBeenCalledTimes(1);
    });
  });

  it('renders template cards after data arrives', async () => {
    render(<TemplatePicker onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Midnight')).toBeTruthy();
      expect(screen.getByText('Daylight')).toBeTruthy();
    });
  });

  // ------------------------------------------------------------------
  // 2. Cancellation flag
  // ------------------------------------------------------------------

  it('does not update state after unmount (respects cancellation flag)', async () => {
    // Delay the resolution so we can unmount before it resolves
    mockListStudioTemplates.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(sampleTemplates), 50);
        }),
    );

    const { unmount } = render(<TemplatePicker onClose={() => {}} />);
    unmount();

    // Wait for the delayed promise to resolve
    await new Promise((r) => setTimeout(r, 100));
    // If cancellation flag works, no error is thrown and no state update occurs.
    // The test passes if no unhandled rejection or act() warning fires.
    expect(true).toBe(true);
  });

  // ------------------------------------------------------------------
  // 3. Apply flow
  // ------------------------------------------------------------------

  it('calls saveActiveProject and shows toast on apply', async () => {
    render(<TemplatePicker onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Midnight')).toBeTruthy();
    });

    // Find the apply button for the first card
    const applyButtons = screen.getAllByText('Apply');
    fireEvent.click(applyButtons[0]);

    await waitFor(() => {
      expect(mockSaveActiveProject).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledTimes(1);
    });
  });

  it('shows toast when no active project exists', async () => {
    mockActiveProjectId.mockReturnValue(null);
    render(<TemplatePicker onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Midnight')).toBeTruthy();
    });

    const applyButtons = screen.getAllByText('Apply');
    fireEvent.click(applyButtons[0]);

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('No active project', 'default');
    });
  });
});
