// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment happy-dom
 */

/**
 * # CenterTabThemeEditor — Visual theme editor rendering and interaction tests
 *
 * Verifies that the Theme Editor panel:
 * - Renders title and CSS preview section.
 * - Displays all 4 SegmentedControl labels (Spacing/Radius/Shadow/Motion).
 * - Reflects current design language values from the themeStore.
 * - Calls setDesignLanguage when any segmented control option is clicked.
 * - Renders the 14-token color grid when a theme is selected.
 * - Shows "no selection" message when theme is null.
 */

import type { ThemeState } from '@/stores/themeStore';
import { useThemeStore } from '@/stores/themeStore';

import type { UiMessages } from '@shared/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CenterTabThemeEditor } from './CenterTabThemeEditor';

// --- Mock store -----------------------------------------------------------

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: vi.fn(),
}));

// --- Mock data ------------------------------------------------------------

const mockSetDL = vi.fn();

const mockT = {
  studioTabTheme: 'Theme Editor',
  studioTabThemeDesc: 'Design your theme',
  studioDLSpacing: 'Spacing',
  studioDLRadius: 'Radius',
  studioDLShadow: 'Shadow',
  studioDLMotion: 'Motion',
  studioDLCssPreview: 'CSS Preview',
  studioThemeColors: 'Theme Colors',
  studioThemeNoSelection: 'Select a theme',
} as unknown as UiMessages;

beforeEach(() => {
  vi.mocked(useThemeStore).mockImplementation((selector) =>
    selector({
      designLanguage: {
        spacing: { density: 'comfortable' },
        radius: { scale: '2' },
      },
      selection: {
        kind: 'installed',
        theme: {
          id: 'test',
          name: 'Test',
          colors: {
            background: '#0f0f14',
            foreground: '#e4e4e7',
            accent: '#6366f1',
          },
        },
      },
      setDesignLanguage: mockSetDL,
    } as unknown as ThemeState),
  );
  mockSetDL.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------

describe('CenterTabThemeEditor', () => {
  it('renders title and CSS preview section', () => {
    const { container } = render(<CenterTabThemeEditor t={mockT} />);
    expect(container.textContent).toContain('Theme Editor');
    expect(container.textContent).toContain('CSS Preview');
  });

  it('renders all 4 SegmentedControl labels (Spacing/Radius/Shadow/Motion)', () => {
    const { container } = render(<CenterTabThemeEditor t={mockT} />);
    expect(container.textContent).toContain('Spacing');
    expect(container.textContent).toContain('Radius');
    expect(container.textContent).toContain('Shadow');
    expect(container.textContent).toContain('Motion');
  });

  it('displays current density value from store', () => {
    const { container } = render(<CenterTabThemeEditor t={mockT} />);
    // density: 'comfortable' → SPACING_BASE[2]=16 × 1 = 16px
    expect(
      Array.from(container.querySelectorAll('span')).some(
        (el) => el.textContent === '--agentskin-space-3: 16px',
      ),
    ).toBe(true);
  });

  it('clicking a spacing option calls setDesignLanguage', () => {
    render(<CenterTabThemeEditor t={mockT} />);
    const buttons = screen.getAllByText('compact (0.75x)');
    fireEvent.click(buttons[0]);
    expect(mockSetDL).toHaveBeenCalledWith({ spacing: { density: 'compact' } });
  });

  it('clicking a radius option calls setDesignLanguage', () => {
    render(<CenterTabThemeEditor t={mockT} />);
    // Radius '4' is currently not selected (scale is '2')
    const buttons = screen.getAllByText('4');
    fireEvent.click(buttons[0]);
    expect(mockSetDL).toHaveBeenCalledWith({ radius: { scale: '4' } });
  });

  it('clicking a shadow option calls setDesignLanguage', () => {
    render(<CenterTabThemeEditor t={mockT} />);
    // Mock state has no shadow set; click "subtle"
    const buttons = screen.getAllByText('subtle');
    fireEvent.click(buttons[0]);
    expect(mockSetDL).toHaveBeenCalledWith({ shadow: { elevation: 'subtle' } });
  });

  it('clicking a motion option calls setDesignLanguage', () => {
    render(<CenterTabThemeEditor t={mockT} />);
    // Mock state has no motion set; click "smooth (200ms)"
    const buttons = screen.getAllByText('smooth (200ms)');
    fireEvent.click(buttons[0]);
    expect(mockSetDL).toHaveBeenCalledWith({ motion: { speed: 'smooth' } });
  });

  it('renders color token grid when theme is selected', () => {
    const { container } = render(<CenterTabThemeEditor t={mockT} />);
    // With kind: 'installed' and colors present, token buttons render
    expect(container.textContent).toContain('Theme Colors');
    // At least one token key should be rendered (e.g. 'background', 'foreground', 'accent')
    const hasToken =
      container.textContent?.includes('background') ||
      container.textContent?.includes('foreground') ||
      container.textContent?.includes('accent');
    expect(hasToken).toBe(true);
  });

  it('shows "no selection" message when theme is null', () => {
    vi.mocked(useThemeStore).mockImplementation((selector) =>
      selector({
        designLanguage: {
          spacing: { density: 'comfortable' },
          radius: { scale: '2' },
        },
        selection: null,
        setDesignLanguage: mockSetDL,
      } as Partial<ThemeState> as ThemeState),
    );

    const { container } = render(<CenterTabThemeEditor t={mockT} />);
    expect(container.textContent).toContain('Select a theme');
  });
});
