// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment happy-dom
 */

/**
 * # CenterTabGenerator — snapshot-to-override rendering tests
 *
 * Verifies that the Generator tab renders correctly:
 * - Empty snapshot shows the "no snapshot" empty state.
 * - Extracted values display with proper formatting.
 * - Missing values show '—' placeholder.
 * - Apply button is disabled when nothing was extracted.
 * - Apply button triggers applyOverrideFromSnapshot.
 * - Hex colors / px values / font names are formatted correctly.
 *
 * Pattern follows CenterTabInspect.test.tsx: mock `@/stores/studioStore`
 * with mutable module-level fixtures, render via `renderToStaticMarkup`.
 */

import { fireEvent, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock shellStore (locale source used by i18n) -----------------------

vi.mock('@/stores/shellStore', () => ({
  useShellStore: vi.fn(() => ({ locale: 'zh-CN' as const })),
}));

import { uiMessages } from '@shared/i18n';
import type { ThemeVisualSnapshot } from '@shared/types';
import { CenterTabGenerator } from './CenterTabGenerator';

// --- Mutable store state (simulates useStudioStore.getState()) ----------

let mockSnapshot: ThemeVisualSnapshot | null = null;
const mockApplyOverrideFromSnapshot = vi.fn();

vi.mock('@/stores/studioStore', () => ({
  useStudioStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      snapshot: mockSnapshot,
      applyOverrideFromSnapshot: mockApplyOverrideFromSnapshot,
    }),
}));

// --- Fixtures --------------------------------------------------------------

/** Snapshot with body/:root styles — all extractable fields present. */
const fullSnapshot: ThemeVisualSnapshot = {
  themeId: 'theme-full',
  themeName: 'Full Theme',
  agentId: 'traework',
  timestamp: '2025-01-01T00:00:00.000Z',
  landmarks: [
    {
      selector: 'body',
      tag: 'body',
      styles: [
        { property: 'background-color', value: '#1e1e1e' },
        { property: 'color', value: '#e0e0e0' },
        { property: 'border-radius', value: '8px' },
        { property: 'font-size', value: '13px' },
        { property: 'font-family', value: "'Inter', sans-serif" },
      ],
      matchedRules: [],
      platformFonts: [],
      boxModel: null,
      visible: true,
    },
    {
      selector: '.chat-input-box',
      tag: 'div',
      styles: [{ property: 'border-color', value: '#5b5b5b' }],
      matchedRules: [],
      platformFonts: [],
      boxModel: null,
      visible: true,
    },
    {
      selector: '.agent-card',
      tag: 'div',
      styles: [
        { property: 'border-radius', value: '8px' },
        { property: 'font-size', value: '15px' },
        { property: 'font-family', value: "'Inter', sans-serif" },
      ],
      matchedRules: [],
      platformFonts: [],
      boxModel: null,
      visible: true,
    },
  ],
  summary: {
    totalLandmarks: 3,
    visibleLandmarks: 3,
    selectorsTried: 3,
    boxModelAvailable: false,
    cascadeAvailable: false,
  },
  rootVars: {},
};

/** Snapshot with only background and color extractable — accent/fontFam missing. */
const partialSnapshot: ThemeVisualSnapshot = {
  themeId: 'theme-partial',
  themeName: 'Partial Theme',
  agentId: 'traework',
  timestamp: '2025-01-01T00:00:00.000Z',
  landmarks: [
    {
      selector: 'body',
      tag: 'body',
      styles: [
        { property: 'background-color', value: '#2a2a2a' },
        { property: 'color', value: '#cccccc' },
      ],
      matchedRules: [],
      platformFonts: [],
      boxModel: null,
      visible: true,
    },
  ],
  summary: {
    totalLandmarks: 1,
    visibleLandmarks: 1,
    selectorsTried: 1,
    boxModelAvailable: false,
    cascadeAvailable: false,
  },
  rootVars: {},
};

/** Snapshot with minimal/no extractable styles. */
const emptyStyleSnapshot: ThemeVisualSnapshot = {
  themeId: 'theme-empty',
  themeName: 'Empty Theme',
  agentId: 'traework',
  timestamp: '2025-01-01T00:00:00.000Z',
  landmarks: [
    {
      selector: '#main',
      tag: 'main',
      styles: [],
      matchedRules: [],
      platformFonts: [],
      boxModel: null,
      visible: true,
    },
  ],
  summary: {
    totalLandmarks: 1,
    visibleLandmarks: 1,
    selectorsTried: 1,
    boxModelAvailable: false,
    cascadeAvailable: false,
  },
  rootVars: {},
};

beforeEach(() => {
  mockSnapshot = null;
  mockApplyOverrideFromSnapshot.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests -------------------------------------------------------------------

describe('CenterTabGenerator — rendering', () => {
  it('renders empty state when snapshot is null', () => {
    mockSnapshot = null;

    const html = renderToStaticMarkup(<CenterTabGenerator t={uiMessages['zh-CN']} />);

    // Empty-state title appears
    expect(html).toContain('暂无快照数据');
    expect(html).toContain('抓取快照后可使用生成器提取覆盖属性');
    // Extracted values section should NOT appear
    expect(html).not.toContain('提取结果');
  });

  it('renders 6 extracted field labels when snapshot has styles', () => {
    mockSnapshot = fullSnapshot;

    const html = renderToStaticMarkup(<CenterTabGenerator t={uiMessages['zh-CN']} />);

    // The 6 field keys should be present
    expect(html).toContain('background');
    expect(html).toContain('foreground');
    expect(html).toContain('accent');
    expect(html).toContain('radius');
    expect(html).toContain('fontFam');
    expect(html).toContain('fontSize');
  });

  it('shows "—" placeholder for fields that could not be extracted', () => {
    mockSnapshot = emptyStyleSnapshot;

    const html = renderToStaticMarkup(<CenterTabGenerator t={uiMessages['zh-CN']} />);

    // With no styles extracted, all 6 values should be '—'
    // The dash character (U+2014 em-dash) is used by fmtValue
    expect(html).toContain('—');
    // Should still show all keys
    expect(html).toContain('background');
    expect(html).toContain('fontSize');
  });

  it('disables the Apply button when no values were extracted', () => {
    mockSnapshot = emptyStyleSnapshot;

    const html = renderToStaticMarkup(<CenterTabGenerator t={uiMessages['zh-CN']} />);

    // disabled attribute should be present on the button
    expect(html).toContain('disabled');
  });

  it('enables the Apply button when extraction has values', () => {
    mockSnapshot = fullSnapshot;

    const html = renderToStaticMarkup(<CenterTabGenerator t={uiMessages['zh-CN']} />);

    // Button should NOT be disabled when there are extracted values
    expect(html).not.toContain('disabled');
    // Button label
    expect(html).toContain('应用到 Tweak');
  });

  it('calls applyOverrideFromSnapshot when the Apply button is clicked', () => {
    mockSnapshot = fullSnapshot;

    const { getByText } = render(<CenterTabGenerator t={uiMessages['zh-CN']} />);

    const button = getByText('应用到 Tweak');
    fireEvent.click(button);

    expect(mockApplyOverrideFromSnapshot).toHaveBeenCalledTimes(1);
  });

  it('formats hex colors, px radius, integer fontSize correctly', () => {
    mockSnapshot = fullSnapshot;

    const html = renderToStaticMarkup(<CenterTabGenerator t={uiMessages['zh-CN']} />);

    // Hex values displayed as-is
    expect(html).toContain('#1e1e1e');
    expect(html).toContain('#e0e0e0');
    // Radius extracted as mode border-radius "8px"
    expect(html).toContain('8px');
    // Font size averaged: (13+15)/2 = 14 → rounded to nearest 2 = 14
    expect(html).toContain('14');
  });

  it('renders the English locale labels when t is en-US', () => {
    mockSnapshot = fullSnapshot;

    const html = renderToStaticMarkup(<CenterTabGenerator t={uiMessages.en} />);

    // English labels
    expect(html).toContain('Generator');
    expect(html).toContain('Extracted');
    expect(html).toContain('Apply to Tweak');
  });

  it('renders empty state in English when snapshot is null', () => {
    mockSnapshot = null;

    const html = renderToStaticMarkup(<CenterTabGenerator t={uiMessages.en} />);

    expect(html).toContain('No Snapshot Data');
    expect(html).toContain('Capture a snapshot to extract override properties');
  });

  it('handles partial extraction — shows values for extracted fields and dash for missing', () => {
    mockSnapshot = partialSnapshot;

    const html = renderToStaticMarkup(<CenterTabGenerator t={uiMessages['zh-CN']} />);

    // Extracted values displayed
    expect(html).toContain('#2a2a2a');
    expect(html).toContain('#cccccc');
    // Missing fields show dash
    expect(html).toContain('—');
    // Button should enable because hasExtracted === true
    expect(html).not.toContain('disabled');
  });

  it('transitions from empty state to extracted values when snapshot changes', () => {
    // Initially null — shows empty state
    mockSnapshot = null;
    const { rerender } = render(<CenterTabGenerator t={uiMessages['zh-CN']} />);

    // Now snapshot arrives with extractable data
    mockSnapshot = fullSnapshot;
    rerender(<CenterTabGenerator t={uiMessages['zh-CN']} />);

    const html = renderToStaticMarkup(<CenterTabGenerator t={uiMessages['zh-CN']} />);
    expect(html).toContain('提取结果');
    expect(html).toContain('#1e1e1e');
    expect(html).not.toContain('暂无快照数据');
  });
});
