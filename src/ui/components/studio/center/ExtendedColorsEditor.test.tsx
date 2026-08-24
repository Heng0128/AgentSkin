// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment happy-dom
 */

/**
 * # ExtendedColorsEditor — extended colors panel rendering and interaction tests
 *
 * Verifies that the ExtendedColorsEditor component:
 * - Renders the title and preset buttons.
 * - Clicking a preset button calls onAdd with the correct hex.
 * - Displays the existing colors list.
 * - Clicking the delete button calls onDelete.
 * - Clicking a color swatch reveals the OKLCH adjustment panel.
 * - OKLCH sliders trigger onChange.
 */

import type { UiMessages } from '@shared/i18n';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExtendedColorsEditor } from './ExtendedColorsEditor';

// --- Mock data ------------------------------------------------------------

const mockColors = { error: '#dc2626', success: '#22c55e' };

const mockT = {
  studioExtColors: 'Extended Colors',
  studioExtAddColor: 'Add',
  studioExtPresets: 'Presets',
  studioExtCurrent: 'Current',
  studioExtDelete: 'Delete',
  studioExtOklch: 'OKLCH',
  studioExtLightness: 'Lightness',
  studioExtChroma: 'Chroma',
  studioExtHue: 'Hue',
} as unknown as UiMessages;

afterEach(cleanup);

// --- Test cases ------------------------------------------------------------

describe('ExtendedColorsEditor', () => {
  it('renders title and preset buttons', () => {
    render(
      <ExtendedColorsEditor
        colors={{}}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        t={mockT}
      />,
    );

    // Title
    expect(screen.getByText('Extended Colors')).toBeTruthy();

    // Preset label
    expect(screen.getByText('Presets')).toBeTruthy();

    // Preset buttons (unique: success/info/warning only appear in presets when no colors added)
    expect(screen.getByTitle('success — #22c55e')).toBeTruthy();
    expect(screen.getByTitle('warning — #f59e0b')).toBeTruthy();
    expect(screen.getByTitle('info — #3b82f6')).toBeTruthy();
  });

  it('clicking a preset button calls onAdd with correct hex', () => {
    const onAdd = vi.fn();

    render(
      <ExtendedColorsEditor
        colors={{}}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onAdd={onAdd}
        t={mockT}
      />,
    );

    // Click the "success" preset button via title
    fireEvent.click(screen.getByTitle('success — #22c55e'));

    expect(onAdd).toHaveBeenCalledWith('success', '#22c55e');
  });

  it('displays existing colors list', () => {
    render(
      <ExtendedColorsEditor
        colors={mockColors}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        t={mockT}
      />,
    );

    // Both hex values should be visible in the current colors list
    expect(screen.getByText('#dc2626')).toBeTruthy();
    expect(screen.getByText('#22c55e')).toBeTruthy();

    // Swatches for existing colors (unique titles: only appear in Current Colors section)
    expect(screen.getAllByTitle('error — #dc2626')).toBeTruthy();
    expect(screen.getAllByTitle('success — #22c55e')).toBeTruthy();
  });

  it('clicking delete button calls onDelete', () => {
    const onDelete = vi.fn();

    render(
      <ExtendedColorsEditor
        colors={mockColors}
        onChange={vi.fn()}
        onDelete={onDelete}
        onAdd={vi.fn()}
        t={mockT}
      />,
    );

    // Find the delete button for "error" via aria-label
    const deleteBtns = screen.getAllByLabelText('Delete error');
    fireEvent.click(deleteBtns[0]);

    expect(onDelete).toHaveBeenCalledWith('error');
  });

  it('clicking a color swatch shows OKLCH panel', () => {
    render(
      <ExtendedColorsEditor
        colors={mockColors}
        onChange={vi.fn()}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        t={mockT}
      />,
    );

    // OKLCH panel should not be visible yet (sliders only render inside it)
    expect(screen.queryByRole('slider')).toBeNull();

    // Click the "error" color swatch in the Current Colors list.
    // Index [0] is the disabled preset button — use [1] for the swatch.
    const swatches = screen.getAllByTitle('error — #dc2626');
    fireEvent.click(swatches[1]);

    // OKLCH panel should now be visible (evidenced by slider presence)
    expect(screen.getAllByRole('slider').length).toBe(3);
  });

  it('OKLCH sliders call onChange', () => {
    const onChange = vi.fn();

    render(
      <ExtendedColorsEditor
        colors={mockColors}
        onChange={onChange}
        onDelete={vi.fn()}
        onAdd={vi.fn()}
        t={mockT}
      />,
    );

    // Select the "error" color to reveal OKLCH panel.
    // Index [0] is the disabled preset button — use [1] for the swatch.
    const swatches = screen.getAllByTitle('error — #dc2626');
    fireEvent.click(swatches[1]);

    // Find slider elements (they have role="slider")
    const sliders = screen.getAllByRole('slider');
    expect(sliders.length).toBe(3);

    // Adjust the first slider (Lightness)
    fireEvent.change(sliders[0], { target: { value: '70' } });

    expect(onChange).toHaveBeenCalled();
  });
});
