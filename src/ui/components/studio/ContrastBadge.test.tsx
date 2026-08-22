// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment happy-dom
 */

/**
 * # ContrastBadge — WCAG contrast traffic-light tests
 *
 * Verifies that ContrastBadge:
 * - Renders green check / red cross in compact mode based on AA compliance.
 * - Shows ratio number and AAA badge in full mode.
 * - Applies custom className.
 */

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContrastBadge } from './ContrastBadge';

// --- Tests ----------------------------------------------------------------

describe('ContrastBadge', () => {
  it('compact mode renders green check when contrast passes AA', () => {
    const { container } = render(<ContrastBadge fgHex="#000000" bgHex="#ffffff" mode="compact" />);
    // Black on white has a ratio of 21:1 — passes AA.
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot?.className).toContain('bg-green-500');
    expect(container.textContent).toContain('✓');
  });

  it('compact mode renders red X when contrast fails AA', () => {
    const { container } = render(<ContrastBadge fgHex="#ffffff" bgHex="#ffffff" mode="compact" />);
    // White on white has a ratio of 1:1 — fails AA.
    const dot = container.querySelector('span[aria-hidden="true"]');
    expect(dot?.className).toContain('bg-red-500');
    expect(container.textContent).toContain('✗');
  });

  it('full mode shows ratio number', () => {
    const { container } = render(<ContrastBadge fgHex="#000000" bgHex="#ffffff" mode="full" />);
    // Black on white → ratio 21.0 → "21.0:1"
    expect(container.textContent).toContain('21.0:1');
  });

  it('full mode shows AAA badge when contrast passes AAA', () => {
    const { container } = render(<ContrastBadge fgHex="#000000" bgHex="#ffffff" mode="full" />);
    // 21:1 passes AAA (>= 7.0).
    expect(container.textContent).toContain('AAA');
  });

  it('full mode shows red text when contrast fails', () => {
    const { container } = render(<ContrastBadge fgHex="#ffffff" bgHex="#ffffff" mode="full" />);
    // White on white → 1:1 → fails AA → red text.
    const outerSpan = container.firstChild as HTMLElement;
    expect(outerSpan.className).toContain('text-red-500');
  });

  it('applies custom className', () => {
    const { container } = render(
      <ContrastBadge fgHex="#000000" bgHex="#ffffff" mode="compact" className="custom-class" />,
    );
    const outerSpan = container.firstChild as HTMLElement;
    expect(outerSpan.className).toContain('custom-class');
  });
});
