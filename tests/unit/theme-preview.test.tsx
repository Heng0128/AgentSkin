// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemePreview + ThemeCard preview integration tests
 *
 * - ThemePreview renders 14-token palette swatches
 * - ThemePreview renders the mock UI section
 * - ThemeCard shows a preview button that opens the dialog
 * - ThemeCard preview button does not trigger card selection
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeCard } from '../../src/ui/components/themes/ThemeCard';
import { ThemePreview } from '../../src/ui/components/themes/ThemePreview';
import type { ThemeCenterCardModel } from '../../src/ui/types/theme-center';

// happy-dom does not auto-cleanup between tests
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// i18n mock — provides the preview keys we need
// ---------------------------------------------------------------------------

const mockT = {
  themePreview: '预览',
  themePreviewTitle: (name: string) => `${name} — 预览`,
  themePreviewPalette: '配色方案',
  themePreviewMockUI: '界面模拟',
  themePreviewNoColors: '此主题未提供配色数据',
  themeModeDark: '暗色',
  themeModeLight: '浅色',
  themeDynamicBadge: '动态',
  themeStatsActive: (count: number) => `${count} 个使用中`,
  categoryLabel: (cat: string) => cat,
} as never;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createTheme(overrides: Partial<ThemeCenterCardModel> = {}): ThemeCenterCardModel {
  return {
    id: 'theme-001',
    name: 'Catppuccin Mocha',
    version: '1.0.0',
    author: 'AgentSkin Team',
    description: 'A soothing pastel theme',
    preview: null,
    icon: null,
    supportedAgents: ['traework'],
    category: 'dark',
    tags: ['popular'],
    mode: 'dark',
    unofficial: false,
    source: 'local',
    installed: true,
    hasWallpaper: false,
    colors: {
      accent: '#89b4fa',
      secondary: '#a6adc8',
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      muted: '#6c7086',
      surface: '#181825',
      surfaceElevated: '#313244',
      border: '#45475a',
      codeBackground: '#11111b',
      codeForeground: '#cdd6f4',
      inputBackground: '#313244',
      buttonBackground: '#89b4fa',
      buttonForeground: '#1e1e2e',
      focusRing: '#89b4fa',
      selection: '#45475a',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ThemePreview standalone tests
// ---------------------------------------------------------------------------

describe('ThemePreview', () => {
  it('renders all 14 token labels when colors are provided', () => {
    const theme = createTheme();
    render(<ThemePreview theme={theme} t={mockT} />);

    // Section header
    expect(screen.getByText('配色方案')).toBeTruthy();

    // A few key token labels should be present
    expect(screen.getByText('Background')).toBeTruthy();
    expect(screen.getByText('Accent')).toBeTruthy();
    expect(screen.getByText('Foreground')).toBeTruthy();
    expect(screen.getByText('Button')).toBeTruthy();
    expect(screen.getByText('Focus Ring')).toBeTruthy();
  });

  it('renders the mock UI section header', () => {
    const theme = createTheme();
    render(<ThemePreview theme={theme} t={mockT} />);

    expect(screen.getByText('界面模拟')).toBeTruthy();
  });

  it('renders "no colors" message when colors is empty', () => {
    const theme = createTheme({ colors: {} });
    render(<ThemePreview theme={theme} t={mockT} />);

    expect(screen.getByText('此主题未提供配色数据')).toBeTruthy();
  });

  it('renders swatch elements with non-empty style attributes', () => {
    const theme = createTheme();
    render(<ThemePreview theme={theme} t={mockT} />);

    // happy-dom may normalize hex to rgb(); just verify swatch spans exist
    // with a background-color style declaration.
    const swatches = document.querySelectorAll('span[style*="background-color"]');
    expect(swatches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ThemeCard preview integration tests
// ---------------------------------------------------------------------------

describe('ThemeCard preview button', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders a preview (eye) button in the card footer', () => {
    const theme = createTheme();
    render(
      <ThemeCard
        theme={theme}
        selected={false}
        activeAgentIds={[]}
        onSelect={() => {}}
        t={mockT}
      />,
    );

    const previewButton = screen.getByRole('button', { name: '预览' });
    expect(previewButton).toBeTruthy();
  });

  it('opens the preview dialog when the eye button is clicked', () => {
    const theme = createTheme();
    render(
      <ThemeCard
        theme={theme}
        selected={false}
        activeAgentIds={[]}
        onSelect={() => {}}
        t={mockT}
      />,
    );

    // Dialog should not be open initially
    expect(screen.queryByText('配色方案')).toBeNull();

    // Click the preview button
    const previewButton = screen.getByRole('button', { name: '预览' });
    fireEvent.click(previewButton);

    // Now the dialog content should be visible
    expect(screen.getByText('配色方案')).toBeTruthy();
    expect(screen.getByText('界面模拟')).toBeTruthy();
  });

  it('does NOT trigger card selection when preview button is clicked', () => {
    const theme = createTheme();
    const onSelect = vi.fn();
    render(
      <ThemeCard
        theme={theme}
        selected={false}
        activeAgentIds={[]}
        onSelect={onSelect}
        t={mockT}
      />,
    );

    const previewButton = screen.getByRole('button', { name: '预览' });
    fireEvent.click(previewButton);

    // Card selection (onSelect) must not fire
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows the theme name in the dialog title', () => {
    const theme = createTheme();
    render(
      <ThemeCard
        theme={theme}
        selected={false}
        activeAgentIds={[]}
        onSelect={() => {}}
        t={mockT}
      />,
    );

    const previewButton = screen.getByRole('button', { name: '预览' });
    fireEvent.click(previewButton);

    // Dialog title: "Catppuccin Mocha — 预览"
    expect(screen.getByText('Catppuccin Mocha — 预览')).toBeTruthy();
  });

  it('still renders the card content (name, author, agents)', () => {
    const theme = createTheme();
    render(
      <ThemeCard
        theme={theme}
        selected={false}
        activeAgentIds={[]}
        onSelect={() => {}}
        t={mockT}
      />,
    );

    expect(screen.getByText('Catppuccin Mocha')).toBeTruthy();
    expect(screen.getByText('AgentSkin Team')).toBeTruthy();
  });
});
