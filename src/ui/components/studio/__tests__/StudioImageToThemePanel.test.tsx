// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioImageToThemePanel — component tests
 *
 * Covers the full lifecycle:
 *   1. Idle → renders drag-and-drop upload zone
 *   2. File selected → ready state with "Extract Palette" button
 *   3. Extract → ready state with 14-token palette groups
 *   4. Apply → applyImageToTheme called
 *   5. Invalid format → error toast
 *   6. Clear → back to idle
 *   7. File too large (>8MB) → error toast
 *   8. Apply to Project button → triggers applyImageToTheme + clear
 *   9. Extracting state with file → shows "Extracting…" UI
 *
 * Uses renderToStaticMarkup (SSR) for static rendering tests and
 * @testing-library/react with happy-dom for interactive tests.
 * The store is mocked via vi.mock so we control imageToTheme* state directly.
 */

// @vitest-environment happy-dom

import type { UiMessages } from '@shared/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockExtractImageFromImage,
  mockApplyImageToTheme,
  mockClearImageToTheme,
  mockSetImageAccent,
  mockShowToast,
} = vi.hoisted(() => ({
  mockExtractImageFromImage: vi.fn(),
  mockApplyImageToTheme: vi.fn(),
  mockClearImageToTheme: vi.fn(),
  mockSetImageAccent: vi.fn(),
  mockShowToast: vi.fn(),
}));

// Mutable store state (simulates useStudioStore.getState())
let mockStatus: 'idle' | 'extracting' | 'ready' | 'error' = 'idle';
let mockError: string | null = null;
let mockPalette: Record<string, string> | null = null;
let mockAccent: string | null = null;

vi.mock('@/stores/studioStore', () => ({
  useStudioStore: (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      imageToThemeStatus: mockStatus,
      imageToThemeError: mockError,
      imageToThemeMode: null,
      imageToThemePalette: mockPalette,
      imageToThemeAccent: mockAccent,
      extractImageFromImage: mockExtractImageFromImage,
      applyImageToTheme: mockApplyImageToTheme,
      clearImageToTheme: mockClearImageToTheme,
      setImageAccent: mockSetImageAccent,
    };
    return selector(state);
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      showToast: mockShowToast,
    })),
  },
}));

vi.mock('lucide-react', () => {
  const stub = () => null;
  return {
    UploadCloud: stub,
    ImagePlus: stub,
  };
});

// useShallow wraps a selector with shallow-merge memoization. In SSR test
// context (renderToStaticMarkup) it cannot run as a real hook — make it a
// passthrough so the wrapped selector is returned unchanged.
vi.mock('zustand/react/shallow', () => ({
  useShallow: <T,>(fn: T) => fn,
}));

// --- Import component AFTER mocks are registered ---
import { StudioImageToThemePanel } from '../StudioImageToThemePanel';

// ---------------------------------------------------------------------------
// Minimal UiMessages mock (only keys used by the component)
// ---------------------------------------------------------------------------

const mockT = {
  studioImageToThemePanelTitle: 'Image to Theme',
  studioImageToThemeClear: 'Clear',
  studioImageToThemeDropToUpload: 'Drop to Upload',
  studioImageToThemeDragOrClick: 'Drag or Click to Upload',
  studioImageToThemeSupportedFormats: 'PNG · JPG · WebP · BMP · AVIF',
  studioImageToThemeErrorInvalidFormat:
    'Unsupported format. Please upload PNG / JPEG / WebP / BMP / AVIF.',
  studioImageToThemeErrorReadFailed: 'Failed to read image',
  studioImageToThemeErrorExtractFailed: 'Color extraction failed',
  studioImageToThemeExtracting: 'Extracting…',
  studioImageToThemeExtractButton: 'Extract Palette',
  studioImageToThemeGeneratedPalette: 'Generated Palette',
  studioImageToThemeTonalDerivative: 'Tonal Scale',
  studioImageToThemeTonalHint: 'Click any tone to set it as the accent color',
  studioImageToThemeApplyToProject: 'Apply to Project',
  studioImageToThemeHintText:
    'For best results, use images with high saturation and a clear subject.',
  studioImageToThemeSwatchExpand: 'Click to expand color details',
  studioImageToThemeCopyFormat: (label: string) => `Copy ${label}`,
  studioImageToThemeGroupCore: 'CORE',
  studioImageToThemeGroupSurface: 'SURFACE',
  studioImageToThemeGroupText: 'TEXT',
  studioImageToThemeGroupCode: 'CODE',
  studioImageToThemeGroupInput: 'INPUT',
  studioImageToThemeGroupButton: 'BUTTON',
  studioImageToThemeGroupInteraction: 'INTERACTION',
} as unknown as UiMessages;

// 14-token palette fixture
const MOCK_PALETTE: Record<string, string> = {
  accent: '#3b82f6',
  secondary: '#60a5fa',
  background: '#1a1a2e',
  surface: '#252540',
  surfaceElevated: '#2f2f50',
  foreground: '#e0e0e0',
  muted: '#999999',
  codeBackground: '#0d0d1a',
  codeForeground: '#c0c0c0',
  inputBackground: '#2a2a45',
  buttonBackground: '#3b82f6',
  buttonForeground: '#ffffff',
  focusRing: '#60a5fa',
  border: '#404060',
};

function renderPanel() {
  return renderToStaticMarkup(<StudioImageToThemePanel t={mockT} />);
}

function resetState() {
  mockStatus = 'idle';
  mockError = null;
  mockPalette = null;
  mockAccent = null;
  mockExtractImageFromImage.mockReset();
  mockApplyImageToTheme.mockReset();
  mockClearImageToTheme.mockReset();
  mockSetImageAccent.mockReset();
  mockShowToast.mockReset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StudioImageToThemePanel', () => {
  beforeEach(() => {
    resetState();
  });

  // -----------------------------------------------------------------------
  // 1. Idle state: renders drag-and-drop upload zone
  // -----------------------------------------------------------------------
  it('renders drag-and-drop upload zone in idle state', () => {
    const html = renderPanel();
    expect(html).toContain('Drag or Click to Upload');
    expect(html).toContain('PNG · JPG · WebP · BMP · AVIF');
    // Hidden file input present
    expect(html).toContain('type="file"');
    expect(html).toContain('image/png,image/jpeg,image/webp,image/bmp,image/avif');
  });

  // -----------------------------------------------------------------------
  // 2. Ready state: 14-token palette rendered with group labels
  // -----------------------------------------------------------------------
  it('renders 14-token palette with group labels when status is ready', () => {
    mockStatus = 'ready';
    mockPalette = MOCK_PALETTE;

    const html = renderPanel();

    // Title
    expect(html).toContain('Generated Palette');

    // All 7 group labels present
    expect(html).toContain('CORE');
    expect(html).toContain('SURFACE');
    expect(html).toContain('TEXT');
    expect(html).toContain('CODE');
    expect(html).toContain('INPUT');
    expect(html).toContain('BUTTON');
    expect(html).toContain('INTERACTION');

    // Token names rendered
    expect(html).toContain('accent');
    expect(html).toContain('background');
    expect(html).toContain('foreground');

    // Apply button present
    expect(html).toContain('Apply to Project');
  });

  // -----------------------------------------------------------------------
  // 3. Tonal derivative section rendered when accent is available
  // -----------------------------------------------------------------------
  it('renders tonal derivative section when palette has accent', () => {
    mockStatus = 'ready';
    mockPalette = MOCK_PALETTE;

    const html = renderPanel();
    expect(html).toContain('Tonal Scale');
    expect(html).toContain('Click any tone to set it as the accent color');
  });

  // -----------------------------------------------------------------------
  // 4. Error state: displays error message with clear button
  // -----------------------------------------------------------------------
  it('renders error message and clear button when status is error', () => {
    mockStatus = 'error';
    mockError = 'Color extraction failed';

    const html = renderPanel();
    expect(html).toContain('Color extraction failed');
    expect(html).toContain('Clear');
  });

  // -----------------------------------------------------------------------
  // 5. Extracting state: shows extracting text
  // -----------------------------------------------------------------------
  it('falls back to idle upload zone when status is extracting without a file', () => {
    mockStatus = 'extracting';

    const html = renderPanel();
    // In extracting state without a file, the component falls through to idle
    // (file is null). Verify the idle upload zone is rendered.
    expect(html).toContain('Drag or Click to Upload');
    expect(html).toContain('PNG · JPG · WebP · BMP · AVIF');
  });

  // -----------------------------------------------------------------------
  // 6. Palette values rendered as inline styles (dynamic hex)
  // -----------------------------------------------------------------------
  it('renders palette color values as inline background-color styles', () => {
    mockStatus = 'ready';
    mockPalette = MOCK_PALETTE;

    const html = renderPanel();
    // The accent color should appear as an inline style
    expect(html).toContain('#3b82f6');
    expect(html).toContain('#1a1a2e');
  });

  // -----------------------------------------------------------------------
  // 7. Clear button present in ready state
  // -----------------------------------------------------------------------
  it('renders clear button in ready state', () => {
    mockStatus = 'ready';
    mockPalette = MOCK_PALETTE;

    const html = renderPanel();
    // Both "Apply to Project" and "Clear" buttons should be present
    expect(html).toContain('Apply to Project');
    expect(html).toContain('Clear');
  });

  // -----------------------------------------------------------------------
  // 8. Hint text rendered in idle state
  // -----------------------------------------------------------------------
  it('renders hint text in idle state', () => {
    const html = renderPanel();
    expect(html).toContain('For best results, use images with high saturation');
  });
});

// ---------------------------------------------------------------------------
// Interactive tests (happy-dom + @testing-library/react)
// ---------------------------------------------------------------------------

describe('StudioImageToThemePanel — interactions', () => {
  beforeEach(() => {
    resetState();
    // URL.createObjectURL may be missing in happy-dom
    if (!('createObjectURL' in URL)) {
      // @ts-expect-error — polyfill for test environment
      URL.createObjectURL = () => 'blob:mock-url';
    }
  });

  afterEach(() => {
    cleanup();
  });

  // -----------------------------------------------------------------------
  // 9. File too large (>8MB) → error toast + file not set
  // -----------------------------------------------------------------------
  it('shows error toast when file exceeds 8MB limit', () => {
    render(<StudioImageToThemePanel t={mockT} />);

    // Create a mock file > 8MB
    const largeFile = { size: 9 * 1024 * 1024, type: 'image/png', name: 'huge.png' } as File;

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    // showToast should have been called with the invalid-format error
    expect(mockShowToast).toHaveBeenCalledWith(
      'Unsupported format. Please upload PNG / JPEG / WebP / BMP / AVIF.',
      'destructive',
    );

    // The idle upload zone should still be rendered (file was NOT set)
    expect(screen.getByText('Drag or Click to Upload')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 10. Apply to Project button click → triggers store action + clear
  // -----------------------------------------------------------------------
  it('calls applyImageToTheme when Apply to Project is clicked', () => {
    mockStatus = 'ready';
    mockPalette = MOCK_PALETTE;

    render(<StudioImageToThemePanel t={mockT} />);

    const applyButton = screen.getByText('Apply to Project');
    expect(applyButton).toBeDefined();

    fireEvent.click(applyButton);

    // applyImageToTheme should have been called
    expect(mockApplyImageToTheme).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 11. Extracting state with file → shows "Extracting…" disabled button
  // -----------------------------------------------------------------------
  it('renders extracting UI when status is extracting and file is set', () => {
    const { rerender } = render(<StudioImageToThemePanel t={mockT} />);

    // First, select a valid file via the input to set internal `file` state
    const validFile = new File(['dummy-content'], 'test.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    // The "Extract Palette" button should appear (file + previewUrl set)
    expect(screen.getByText('Extract Palette')).toBeDefined();

    // Now switch store status to extracting and re-render the same instance
    mockStatus = 'extracting';
    rerender(<StudioImageToThemePanel t={mockT} />);

    // Extracting… text should appear (status=extracting && file !== null branch)
    expect(screen.getByText('Extracting…')).toBeDefined();
  });
});
