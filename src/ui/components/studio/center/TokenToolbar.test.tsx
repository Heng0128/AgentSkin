// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment happy-dom
 */

/**
 * # TokenToolbar — Lock + shuffle workflow bar tests
 *
 * Verifies that TokenToolbar:
 * - Renders all token swatches.
 * - Shows lock icon for each token.
 * - Clicking lock icon calls onToggleLock.
 * - Clicking shuffle button calls onShuffle.
 * - Displays locked count correctly.
 * - Space key triggers onShuffle.
 */

import type { UiMessages } from '@shared/i18n';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TokenToolbar } from './TokenToolbar';

// --- Mock data ------------------------------------------------------------

const mockTokens = [
  { name: 'primary', hex: '#6366f1', locked: true },
  { name: 'surface', hex: '#1e1e2e', locked: false },
  { name: 'text', hex: '#e4e4e7', locked: false },
];

const mockOnToggleLock = vi.fn();
const mockOnShuffle = vi.fn();
const mockOnColorChange = vi.fn();

const mockT = {
  shuffle: 'Shuffle',
  tokenLocked: 'Locked',
  tokenUnlocked: 'Unlocked',
  tokenLockedCount: (l: number, t: number) => `${l}/${t} locked`,
} as unknown as UiMessages;

// --- Helpers --------------------------------------------------------------

function renderToolbar() {
  return render(
    <TokenToolbar
      tokens={mockTokens}
      onToggleLock={mockOnToggleLock}
      onShuffle={mockOnShuffle}
      onColorChange={mockOnColorChange}
      t={mockT}
    />,
  );
}

// --- Tests ----------------------------------------------------------------

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TokenToolbar', () => {
  it('renders all token swatches', () => {
    const { container } = renderToolbar();
    // Each token renders a colour swatch button with backgroundColor style.
    const swatches = container.querySelectorAll('button[style^="background-color"]');
    expect(swatches).toHaveLength(3);
  });

  it('shows lock icon for each token', () => {
    const { container } = renderToolbar();
    // Each token has a lock toggle button (Lock or Unlock icon from lucide-react).
    // The lock buttons are absolutely positioned at top-left of each swatch.
    const lockButtons = container.querySelectorAll('button[aria-label]');
    // 3 lock buttons + 1 shuffle button = 4 total, but shuffle has no aria-label.
    // Lock buttons have aria-label = "Locked" or "Unlocked".
    const lockAriaLabels = Array.from(lockButtons).map((btn) => btn.getAttribute('aria-label'));
    expect(lockAriaLabels).toContain('Locked');
    expect(lockAriaLabels).toContain('Unlocked');
  });

  it('clicking lock icon calls onToggleLock', () => {
    const { container } = renderToolbar();
    // Find the lock button for the first token (primary, which is locked).
    const lockButtons = container.querySelectorAll('button[aria-label]');
    const primaryLockBtn = Array.from(lockButtons).find(
      (btn) => btn.getAttribute('aria-label') === 'Locked',
    );
    expect(primaryLockBtn).toBeTruthy();
    fireEvent.click(primaryLockBtn!);
    expect(mockOnToggleLock).toHaveBeenCalledWith('primary');
  });

  it('clicking shuffle button calls onShuffle', () => {
    renderToolbar();
    const shuffleBtn = screen.getByRole('button', { name: 'Shuffle' });
    fireEvent.click(shuffleBtn);
    expect(mockOnShuffle).toHaveBeenCalledTimes(1);
  });

  it('displays locked count correctly (e.g., "1/3 locked")', () => {
    const { container } = renderToolbar();
    // 1 out of 3 tokens are locked (primary).
    expect(container.textContent).toContain('1/3 locked');
  });

  it('Space key triggers onShuffle', () => {
    renderToolbar();
    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    expect(mockOnShuffle).toHaveBeenCalledTimes(1);
  });
});
