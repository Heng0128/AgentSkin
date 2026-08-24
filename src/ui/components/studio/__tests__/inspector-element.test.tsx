// SPDX-License-Identifier: MPL-2.0

/**
 * # InspectorElement — component tests
 *
 * Covers:
 *   1. pickedPath is null → renders null
 *   2. iframeRef.current is null → shows "Loading…"
 *   3. pickedPath points to non-existent element → shows "Loading…"
 *   4. Normal flow: element exists, all sections render correctly
 *   5. CSS variables filtering (only --as-* shown)
 *   6. Close button triggers onClose
 *   7. Breadcrumb with deep ancestor chain
 */

// @vitest-environment happy-dom

import { createRef } from 'react';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectorElement } from '../inspector-element';

// ---------------------------------------------------------------------------
// Mock lucide-react X icon
// ---------------------------------------------------------------------------
vi.mock('lucide-react', () => {
  const Stub = () => null;
  return { X: Stub };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFakeElement(overrides: {
  tagName?: string;
  id?: string;
  classList?: string[];
  styleProps?: Record<string, string>;
  rect?: { x: number; y: number; width: number; height: number };
  parentChain?: Array<{ tagName: string }>;
}) {
  const {
    tagName = 'BUTTON',
    id = 'send-btn',
    classList = ['primary', 'large'],
    styleProps = { '--as-accent': '#3b82f6' },
    rect = { x: 10, y: 20, width: 120, height: 36 },
    parentChain = [{ tagName: 'DIV' }, { tagName: 'MAIN' }, { tagName: 'BODY' }],
  } = overrides;

  // Use a real HTMLElement so `el instanceof HTMLElement` is true
  const el = document.createElement(tagName.toLowerCase());
  if (id) el.id = id;
  for (const c of classList) el.classList.add(c);

  // Override getBoundingClientRect
  el.getBoundingClientRect = () =>
    ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => '',
    }) as DOMRect;

  // Set CSS custom properties on the element's style
  for (const [prop, val] of Object.entries(styleProps)) {
    el.style.setProperty(prop, val);
  }

  // Build parent chain by wrapping in real elements
  let wrapper: HTMLElement = el;
  for (let i = parentChain.length - 1; i >= 0; i--) {
    const parent = document.createElement(parentChain[i].tagName.toLowerCase());
    parent.appendChild(wrapper);
    wrapper = parent;
  }

  return el;
}

function createFakeDoc(element: HTMLElement | null) {
  return {
    querySelector: () => element,
    documentElement: document.documentElement,
    defaultView: {
      getComputedStyle: () => ({
        getPropertyValue: (prop: string) => {
          const map: Record<string, string> = {
            'font-size': '14px',
            color: 'rgb(255, 255, 255)',
            'background-color': 'rgb(59, 130, 246)',
            margin: '8px',
            padding: '12px',
            'border-radius': '6px',
            'box-shadow': 'none',
            display: 'inline-block',
          };
          return map[prop] ?? '';
        },
      }),
    },
  } as unknown as Document;
}

function createIframeWithElement(element: HTMLElement | null) {
  const iframe = document.createElement('iframe');
  const doc = createFakeDoc(element);
  Object.defineProperty(iframe, 'contentDocument', { value: doc, configurable: true });
  return iframe;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InspectorElement', () => {
  let onCloseMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onCloseMock = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // 1. pickedPath is null → renders null
  // -----------------------------------------------------------------------
  it('renders nothing when pickedPath is null', () => {
    const iframeRef = createRef<HTMLIFrameElement>();
    const { container } = render(
      <InspectorElement iframeRef={iframeRef} pickedPath={null} onClose={onCloseMock} />,
    );
    expect(container.innerHTML).toBe('');
  });

  // -----------------------------------------------------------------------
  // 2. iframeRef.current is null → shows "Loading…"
  // -----------------------------------------------------------------------
  it('shows Loading when iframeRef.current is null', () => {
    const iframeRef = createRef<HTMLIFrameElement>();
    render(<InspectorElement iframeRef={iframeRef} pickedPath="#some-el" onClose={onCloseMock} />);
    expect(screen.getByText('Loading…')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 3. pickedPath points to non-existent element → shows "Loading…"
  // -----------------------------------------------------------------------
  it('shows Loading when querySelector returns null', () => {
    const iframe = createIframeWithElement(null);
    const iframeRef = { current: iframe } as React.RefObject<HTMLIFrameElement | null>;
    render(
      <InspectorElement iframeRef={iframeRef} pickedPath="#nonexistent" onClose={onCloseMock} />,
    );
    expect(screen.getByText('Loading…')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 4. Normal flow: element exists, all sections render
  // -----------------------------------------------------------------------
  it('renders full element details when element exists', () => {
    const fakeEl = createFakeElement({});
    const iframe = createIframeWithElement(fakeEl);
    const iframeRef = { current: iframe } as React.RefObject<HTMLIFrameElement | null>;

    render(<InspectorElement iframeRef={iframeRef} pickedPath="#send-btn" onClose={onCloseMock} />);

    // Flush the requestAnimationFrame
    vi.runAllTimers();

    // Tag header: <button>
    expect(screen.getByText(/<button>/)).toBeDefined();
    // ID
    expect(screen.getByText('#send-btn')).toBeDefined();
    // Classes
    expect(screen.getByText('.primary.large')).toBeDefined();

    // Box Model section
    expect(screen.getByText('Box Model')).toBeDefined();
    // Dimensions (120 × 36)
    expect(screen.getByText(/120/)).toBeDefined();
    expect(screen.getByText(/36/)).toBeDefined();

    // Computed Styles section
    expect(screen.getByText('Computed Styles')).toBeDefined();

    // DOM Path section
    expect(screen.getByText('DOM Path')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 5. CSS variables filtering (only --as-* shown)
  // -----------------------------------------------------------------------
  it('only shows --as-* variables in CSS Variables section', () => {
    const fakeEl = createFakeElement({
      styleProps: {
        '--as-accent': '#3b82f6',
        'font-size': '14px',
        '--as-surface': '#1e1e1e',
      },
    });
    const iframe = createIframeWithElement(fakeEl);
    const iframeRef = { current: iframe } as React.RefObject<HTMLIFrameElement | null>;

    render(<InspectorElement iframeRef={iframeRef} pickedPath="#send-btn" onClose={onCloseMock} />);

    vi.runAllTimers();

    // CSS Variables section should be present with --as-* vars
    expect(screen.getByText('CSS Variables')).toBeDefined();
    expect(screen.getByText('--as-accent: #3b82f6')).toBeDefined();
    expect(screen.getByText('--as-surface: #1e1e1e')).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 6. Close button triggers onClose
  // -----------------------------------------------------------------------
  it('calls onClose when close button is clicked', () => {
    const iframeRef = createRef<HTMLIFrameElement>();
    render(<InspectorElement iframeRef={iframeRef} pickedPath="#el" onClose={onCloseMock} />);

    const closeButton = screen.getByRole('button', { name: 'Close' });
    closeButton.click();

    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 7. Breadcrumb with deep ancestor chain (>5 levels)
  // -----------------------------------------------------------------------
  it('renders full breadcrumb path for deeply nested elements', () => {
    const fakeEl = createFakeElement({
      tagName: 'SPAN',
      id: '',
      classList: [],
      styleProps: {},
      parentChain: [
        { tagName: 'A' },
        { tagName: 'LI' },
        { tagName: 'UL' },
        { tagName: 'NAV' },
        { tagName: 'HEADER' },
        { tagName: 'DIV' },
        { tagName: 'BODY' },
      ],
    });
    const iframe = createIframeWithElement(fakeEl);
    const iframeRef = { current: iframe } as React.RefObject<HTMLIFrameElement | null>;

    render(<InspectorElement iframeRef={iframeRef} pickedPath="span" onClose={onCloseMock} />);

    vi.runAllTimers();

    // The breadcrumb should contain all ancestor tags
    const domPathTitle = screen.getByText('DOM Path');
    const breadcrumbEl = domPathTitle.nextElementSibling as HTMLElement;
    const breadcrumbText = breadcrumbEl?.textContent ?? '';
    expect(breadcrumbText).toContain('span');
    expect(breadcrumbText).toContain('a');
    expect(breadcrumbText).toContain('li');
    expect(breadcrumbText).toContain('ul');
    expect(breadcrumbText).toContain('nav');
    expect(breadcrumbText).toContain('header');
    expect(breadcrumbText).toContain('div');
  });
});
