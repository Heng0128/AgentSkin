// SPDX-License-Identifier: MPL-2.0

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommunityTheme } from '../../src/shared/types/community';
import { ThemeDetailPanel } from '../../src/ui/components/themes/ThemeDetailPanel';

// happy-dom does not auto-cleanup between tests; ensure each test starts fresh
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createTheme(overrides: Partial<CommunityTheme> = {}): CommunityTheme {
  return {
    themeId: 'theme-001',
    name: 'Solarized Dark',
    author: {
      id: 'author-001',
      displayName: 'Alice Chen',
    },
    description: 'A warm dark theme optimized for long coding sessions.',
    tags: ['dark', 'warm', 'popular'],
    downloads: 12800,
    rating: 4.7,
    updatedAt: '2026-08-10T08:00:00Z',
    packageSize: 204800,
    version: '2.1.0',
    displayMeta: {
      colors: {
        accent: '#ff9800',
        background: '#1a1a2e',
        text: '#eaeaea',
        panel: '#16213e',
        secondary: '#0f3460',
      },
    },
    screenshots: [],
    targetAgents: ['traework'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ThemeDetailPanel', () => {
  // --- 1. Basic rendering ---

  it('renders theme name, author, and version', () => {
    const theme = createTheme();
    render(<ThemeDetailPanel theme={theme} onClose={() => {}} />);

    expect(screen.getByText('Solarized Dark')).toBeTruthy();
    expect(screen.getByText('by Alice Chen')).toBeTruthy();
    // versionLabel prepends "v" -> "v2.1.0"
    expect(screen.getByText('v2.1.0')).toBeTruthy();
  });

  // --- 2. Color preview ---

  it('renders color swatches from displayMeta.colors', () => {
    const theme = createTheme();
    render(<ThemeDetailPanel theme={theme} onClose={() => {}} />);

    // Each color key should appear as a label in the swatch pills
    expect(screen.getByText('accent')).toBeTruthy();
    expect(screen.getByText('background')).toBeTruthy();
    expect(screen.getByText('text')).toBeTruthy();
    expect(screen.getByText('panel')).toBeTruthy();
    expect(screen.getByText('secondary')).toBeTruthy();

    // The accent swatch should have the correct background color
    // happy-dom may or may not parse inline style.backgroundColor, so check
    // the raw style attribute which preserves the original hex value
    const swatches = document.querySelectorAll('[style*="background-color"]');
    expect(swatches.length).toBeGreaterThan(0);
    const found = Array.from(swatches).find((el) =>
      (el.getAttribute('style') ?? '').includes('#ff9800'),
    );
    expect(found).not.toBeUndefined();
  });

  it('does not crash when displayMeta.colors is empty', () => {
    const theme = createTheme({ displayMeta: { colors: {} } });
    render(<ThemeDetailPanel theme={theme} onClose={() => {}} />);
    // Color section should not be rendered
    expect(screen.queryByText('accent')).toBeNull();
  });

  // --- 3. Description display ---

  it('displays the theme description', () => {
    const theme = createTheme();
    render(<ThemeDetailPanel theme={theme} onClose={() => {}} />);
    expect(screen.getByText('A warm dark theme optimized for long coding sessions.')).toBeTruthy();
  });

  // --- 4. Stats display ---

  it('displays downloads, rating, and package size', () => {
    const theme = createTheme();
    render(<ThemeDetailPanel theme={theme} onClose={() => {}} />);

    // Downloads: "12800"
    expect(screen.getByText('12800')).toBeTruthy();
    // Rating: "4.7"
    expect(screen.getByText('4.7')).toBeTruthy();
    // Package size: 204800 bytes = 200.0 KB
    expect(screen.getByText('200.0 KB')).toBeTruthy();
    // Updated date
    expect(screen.getByText((content) => content.includes('2026'))).toBeTruthy();
  });

  // --- 5. Tags display ---

  it('renders tag pills', () => {
    const theme = createTheme();
    render(<ThemeDetailPanel theme={theme} onClose={() => {}} />);
    expect(screen.getByText('dark')).toBeTruthy();
    expect(screen.getByText('warm')).toBeTruthy();
    expect(screen.getByText('popular')).toBeTruthy();
  });

  // --- 6. Close button ---

  it('calls onClose when the header close button is clicked', () => {
    const onClose = vi.fn();
    const theme = createTheme();
    render(<ThemeDetailPanel theme={theme} onClose={onClose} />);

    // Backdrop (aria-label), header (aria-label), and footer (text) all close
    const closeButtons = screen.getAllByRole('button', { name: '关闭' });
    expect(closeButtons.length).toBe(3);
    fireEvent.click(closeButtons[1]); // header close button
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the footer cancel button is clicked', () => {
    const onClose = vi.fn();
    const theme = createTheme();
    render(<ThemeDetailPanel theme={theme} onClose={onClose} />);

    // Footer has a "关闭" button as well
    const buttons = screen.getAllByRole('button', { name: '关闭' });
    expect(buttons.length).toBe(3); // backdrop + header + footer
    fireEvent.click(buttons[2]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // --- 7. Install button ---

  it('calls onInstall when the install button is clicked', () => {
    const onInstall = vi.fn();
    const theme = createTheme();
    render(<ThemeDetailPanel theme={theme} onClose={() => {}} onInstall={onInstall} />);

    const installButton = screen.getByRole('button', { name: '安装' });
    fireEvent.click(installButton);
    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('does not render install button when onInstall is not provided', () => {
    const theme = createTheme();
    render(<ThemeDetailPanel theme={theme} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: '安装' })).toBeNull();
  });

  // --- 8. Installing state ---

  it('shows installing text and disables the button when isInstalling is true', () => {
    const onInstall = vi.fn();
    const theme = createTheme();
    render(
      <ThemeDetailPanel theme={theme} onClose={() => {}} onInstall={onInstall} isInstalling />,
    );

    const installButton = screen.getByRole('button', {
      name: '正在下载并校验…',
    });
    expect(installButton).toBeTruthy();
    expect(installButton.hasAttribute('disabled')).toBe(true);

    // Clicking should not trigger onInstall while disabled
    fireEvent.click(installButton);
    expect(onInstall).not.toHaveBeenCalled();
  });

  // --- 9. Null/optional field safety ---

  it('renders without crashing when optional fields are missing', () => {
    const theme = createTheme({
      description: undefined,
      displayMeta: undefined,
      tags: [],
      author: { id: 'author-002', displayName: undefined },
      downloads: undefined,
      rating: undefined,
      packageSize: undefined,
      updatedAt: undefined,
    });
    render(<ThemeDetailPanel theme={theme} onClose={() => {}} />);

    // Name still renders
    expect(screen.getByText('Solarized Dark')).toBeTruthy();
    // Author section should show "Unknown" when displayName is missing
    expect(screen.getByText('by Unknown')).toBeTruthy();
    // No description rendered
    expect(screen.queryByText('A warm dark theme optimized for long coding sessions.')).toBeNull();
    // Rating falls back to "0.0"
    expect(screen.getByText('0.0')).toBeTruthy();
    // Downloads falls back to 0
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('handles null color values gracefully in swatches', () => {
    const theme = createTheme({
      displayMeta: {
        colors: {
          accent: '#ff9800',
          background: undefined,
          text: null as unknown as string,
        },
      },
    });
    render(<ThemeDetailPanel theme={theme} onClose={() => {}} />);

    // Only the defined color should render
    expect(screen.getByText('accent')).toBeTruthy();
    // undefined/null colors should be filtered out
    expect(screen.queryByText('background')).toBeNull();
    expect(screen.queryByText('text')).toBeNull();
  });
});
