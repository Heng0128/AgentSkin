// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment happy-dom
 */

/**
 * # CenterTabDesignLanguage — Design Language panel rendering and interaction tests
 *
 * Verifies that the Design Language panel:
 * - Renders title and description.
 * - Displays all 4 section labels (spacing, radius, shadow, motion).
 * - Reflects current design language values from the themeStore.
 * - Calls setDesignLanguage when any segmented control option is clicked.
 * - Shows the CSS variable preview section.
 * - Applies `border-[var(--accent)]` to the currently selected option.
 */

import type { ThemeState } from '@/stores/themeStore';
import { useThemeStore } from '@/stores/themeStore';

import type { UiMessages } from '@shared/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CenterTabDesignLanguage } from './CenterTabDesignLanguage';

// --- Mock store -----------------------------------------------------------

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: vi.fn(),
}));

// --- Mock data ------------------------------------------------------------

const mockSetDL = vi.fn();

const mockT = {
  studioTabDesignLanguage: 'Design Language',
  studioDLSpacing: 'Spacing Density',
  studioDLRadius: 'Radius Scale',
  studioDLShadow: 'Shadow Elevation',
  studioDLMotion: 'Motion Speed',
  studioDLPreview: 'CSS Preview',
} as unknown as UiMessages;

beforeEach(() => {
  vi.mocked(useThemeStore).mockImplementation((selector) =>
    selector({
      designLanguage: {
        spacing: { density: 'comfortable' },
        radius: { scale: '2' },
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

describe('CenterTabDesignLanguage', () => {
  it('renders title and subtitle', () => {
    const { container } = render(<CenterTabDesignLanguage t={mockT} />);
    // Title
    expect(container.textContent).toContain('Design Language');
    // Subtitle (fallback since mock does not include studioTabDesignLanguageDesc)
    expect(container.textContent).toContain(
      'Adjust spacing, radius, shadow, and motion parameters for the active theme.',
    );
  });

  it('renders all 4 section labels (Spacing Density, Radius Scale, Shadow Elevation, Motion Speed)', () => {
    const { container } = render(<CenterTabDesignLanguage t={mockT} />);
    expect(container.textContent).toContain('Spacing Density');
    expect(container.textContent).toContain('Radius Scale');
    expect(container.textContent).toContain('Shadow Elevation');
    expect(container.textContent).toContain('Motion Speed');
  });

  it('displays current density value from store', () => {
    const { container } = render(<CenterTabDesignLanguage t={mockT} />);
    // density: 'comfortable' → SPACING_BASE[2]=16 × 1 = 16px
    // Must match designLanguageBlock() output exactly (P0-1 fix).
    const matches = container.querySelectorAll('span');
    const found = Array.from(matches).some((el) => el.textContent === '--agentskin-space-3: 16px');
    expect(found).toBe(true);
  });

  it('displays current radius value from store', () => {
    const { container } = render(<CenterTabDesignLanguage t={mockT} />);
    // scale: '2' → radiusPx('2') = '2px'
    const matches = container.querySelectorAll('span');
    const found = Array.from(matches).some((el) => el.textContent === '--agentskin-radius-md: 2px');
    expect(found).toBe(true);
  });

  it('clicking a spacing option calls setDesignLanguage', () => {
    render(<CenterTabDesignLanguage t={mockT} />);
    // Compact is not currently selected (comfortable is); click compact
    const buttons = screen.getAllByText('compact (0.75x)');
    fireEvent.click(buttons[0]);
    expect(mockSetDL).toHaveBeenCalledWith({ spacing: { density: 'compact' } });
  });

  it('clicking a radius option calls setDesignLanguage', () => {
    render(<CenterTabDesignLanguage t={mockT} />);
    // Radius '4' is currently not selected (scale is '2')
    const buttons = screen.getAllByText('4');
    fireEvent.click(buttons[0]);
    expect(mockSetDL).toHaveBeenCalledWith({ radius: { scale: '4' } });
  });

  it('clicking a shadow option calls setDesignLanguage', () => {
    render(<CenterTabDesignLanguage t={mockT} />);
    // Mock state has no shadow set; click "subtle"
    const buttons = screen.getAllByText('subtle');
    fireEvent.click(buttons[0]);
    expect(mockSetDL).toHaveBeenCalledWith({ shadow: { elevation: 'subtle' } });
  });

  it('clicking a motion option calls setDesignLanguage', () => {
    render(<CenterTabDesignLanguage t={mockT} />);
    // Mock state has no motion set; click "smooth (200ms)"
    const buttons = screen.getAllByText('smooth (200ms)');
    fireEvent.click(buttons[0]);
    expect(mockSetDL).toHaveBeenCalledWith({ motion: { speed: 'smooth' } });
  });

  it('shows CSS variable preview section', () => {
    const { container } = render(<CenterTabDesignLanguage t={mockT} />);
    // Component uses t.studioDLCssPreview; mock provides studioDLPreview (different key)
    // so the fallback 'CSS Variables' renders
    expect(container.textContent).toContain('CSS Variables');
  });

  it('selected option has the selected CSS class (border-[var(--accent)])', () => {
    render(<CenterTabDesignLanguage t={mockT} />);
    // density: 'comfortable' → 'comfortable (1x)' is the selected option
    const buttons = screen.getAllByText('comfortable (1x)');
    const selectedBtn = buttons.find((btn) => btn.className.includes('border-[var(--accent)]'));
    expect(selectedBtn).toBeTruthy();
  });
});
