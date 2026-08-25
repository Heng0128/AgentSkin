// SPDX-License-Identifier: MPL-2.0

/**
 * # useElementPicker — unit tests
 *
 * Tests the element picker hook that provides mouse-driven element selection
 * over a srcdoc iframe. Uses @testing-library/react's renderHook with a
 * happy-dom environment, and mocks iframe's contentDocument + requestAnimationFrame.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// happy-dom setup — must happen before importing @testing-library/react
// ---------------------------------------------------------------------------

import { Window } from 'happy-dom';

const window = new Window({ url: 'http://localhost' });

// Set up globals that @testing-library/react needs
globalThis.document = window.document as unknown as Document;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.window = window as any;
globalThis.requestAnimationFrame = (window.requestAnimationFrame.bind(window) as unknown) as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = (window.cancelAnimationFrame.bind(window) as unknown) as typeof cancelAnimationFrame;

// ---------------------------------------------------------------------------
// Fake DOM builder — creates a chainable fake DOM tree for iframe.contentDocument
// ---------------------------------------------------------------------------

interface FakeElement {
  tagName: string;
  parentElement: FakeElement | null;
  children: FakeElement[];
  classList: { contains: (c: string) => boolean; _cls: string[] };
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
  removeAttribute: (name: string) => void;
  getBoundingClientRect: () => DOMRect;
  _attrs: Record<string, string>;
}

function makeFakeElement(tag: string, cls = '', children: FakeElement[] = []): FakeElement {
  const el: FakeElement = {
    tagName: tag.toUpperCase(),
    parentElement: null,
    children,
    classList: {
      contains: (c: string) => el.classList._cls.includes(c),
      _cls: cls ? cls.split(' ').filter(Boolean) : [],
    },
    getAttribute: (name: string) => {
      if (name === 'class') return cls || null;
      return el._attrs[name] ?? null;
    },
    setAttribute: (name: string, value: string) => {
      el._attrs[name] = value;
      if (name === 'class') {
        el.classList._cls = value.split(' ').filter(Boolean);
        el.classList.contains = (c: string) => el.classList._cls.includes(c);
      }
    },
    removeAttribute: (name: string) => {
      delete el._attrs[name];
    },
    getBoundingClientRect: () =>
      ({
        x: 0,
        y: 0,
        width: 80,
        height: 24,
        top: 0,
        left: 0,
        right: 80,
        bottom: 24,
        toJSON: () => {},
      }) as DOMRect,
    _attrs: {},
  };
  children.forEach((c) => {
    c.parentElement = el;
  });
  return el;
}

/** Build a fake DOM tree and return references to key elements. */
function buildFakeDom() {
  const body = makeFakeElement('body');
  const div1 = makeFakeElement('div', 'btn');
  const div2 = makeFakeElement('div', 'btn');
  const main = makeFakeElement('main', '', [div1, div2]);
  body.children = [main];
  main.parentElement = body;
  div1.parentElement = main;
  div2.parentElement = main;
  return { body, main, div1, div2 };
}

/** Build a more complex DOM tree for nth-child testing. */
function buildComplexFakeDom() {
  const body = makeFakeElement('body');
  const chat1 = makeFakeElement('div', 'chat');
  const chat2 = makeFakeElement('div', 'chat');
  const send1 = makeFakeElement('button', 'send');
  const send2 = makeFakeElement('button', 'send');
  chat2.children = [send1, send2];
  send1.parentElement = chat2;
  send2.parentElement = chat2;
  const main = makeFakeElement('main', '', [chat1, chat2]);
  body.children = [main];
  main.parentElement = body;
  chat1.parentElement = main;
  chat2.parentElement = main;
  return { body, main, chat1, chat2, send1, send2 };
}

/** Build a DOM tree with no-class no-sibling elements. */
function buildSimpleFakeDom() {
  const body = makeFakeElement('body');
  const section = makeFakeElement('section');
  const main = makeFakeElement('main', '', [section]);
  body.children = [main];
  main.parentElement = body;
  section.parentElement = main;
  return { body, main, section };
}

// ---------------------------------------------------------------------------
// Mock iframe contentDocument
// ---------------------------------------------------------------------------

/**
 * Create a fake iframe element whose contentDocument returns a minimal
 * document stub with elementFromPoint and body.
 */
function createFakeIframe(body: FakeElement, targetEl: FakeElement): HTMLIFrameElement {
  const doc = {
    documentElement: makeFakeElement('html'),
    body: body as unknown as HTMLBodyElement,
    elementFromPoint: (_x: number, _y: number) => {
      return targetEl as unknown as Element;
    },
  };

  const iframe = {
    contentDocument: doc,
    getBoundingClientRect: () =>
      ({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        toJSON: () => {},
      }) as DOMRect,
  };

  return iframe as unknown as HTMLIFrameElement;
}

// ---------------------------------------------------------------------------
// Import after DOM setup
// ---------------------------------------------------------------------------

import { act, renderHook } from '@testing-library/react';
import { useElementPicker } from '../use-element-picker';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useElementPicker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. Initialization state ────────────────────────────────────────────

  describe('initialization', () => {
    it('returns null hoveredPath and null pickedPath, isPicking equals enabled', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };
      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef }),
      );

      expect(result.current.hoveredPath).toBeNull();
      expect(result.current.pickedPath).toBeNull();
      expect(result.current.isPicking).toBe(true);
    });

    it('isPicking is false when enabled is false', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };
      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: false, iframeRef }),
      );

      expect(result.current.isPicking).toBe(false);
    });
  });

  // ── 2. buildStableSelector (indirect via handleMouseMove) ─────────────

  describe('buildStableSelector (indirect)', () => {
    it('produces path without nth-child when no same-tag siblings exist', () => {
      // section is the only child of main with tag "section" — no nth-child needed
      const { body, section } = buildSimpleFakeDom();
      const iframeRef = { current: createFakeIframe(body, section) };
      const onHover = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef, onHover }),
      );

      result.current.handleMouseMove(10, 10);
      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(result.current.hoveredPath).toBe('body > main > section');
      expect(onHover).toHaveBeenCalledWith('body > main > section', section);
    });

    it('produces correct nth-child for elements with same-tag siblings', () => {
      // chat2 is the 2nd div.chat child of main; send1 is the 1st button.send child of chat2
      const { body, send1 } = buildComplexFakeDom();
      const iframeRef = { current: createFakeIframe(body, send1) };
      const onHover = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef, onHover }),
      );

      result.current.handleMouseMove(10, 10);
      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(result.current.hoveredPath).toBe(
        'body > main > div.chat:nth-child(2) > button.send:nth-child(1)',
      );
      expect(onHover).toHaveBeenCalledWith(
        'body > main > div.chat:nth-child(2) > button.send:nth-child(1)',
        send1,
      );
    });

    it('produces path for element without class and without same-tag siblings', () => {
      const { body, section } = buildSimpleFakeDom();
      const iframeRef = { current: createFakeIframe(body, section) };
      const onHover = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef, onHover }),
      );

      result.current.handleMouseMove(10, 10);
      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(result.current.hoveredPath).toBe('body > main > section');
    });

    it('computes nth-child index 1 for first same-tag sibling', () => {
      // chat1 is the first div.chat child of main
      const { body, chat1 } = buildComplexFakeDom();
      const iframeRef = { current: createFakeIframe(body, chat1) };
      const onHover = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef, onHover }),
      );

      result.current.handleMouseMove(10, 10);
      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(result.current.hoveredPath).toBe('body > main > div.chat:nth-child(1)');
    });
  });

  // ── 3. handleMouseMove ────────────────────────────────────────────────

  describe('handleMouseMove', () => {
    it('does not update state when disabled', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };
      const onHover = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: false, iframeRef, onHover }),
      );

      result.current.handleMouseMove(10, 10);
      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(result.current.hoveredPath).toBeNull();
      expect(onHover).not.toHaveBeenCalled();
    });

    it('computes hoveredPath after rAF when enabled', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };
      const onHover = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef, onHover }),
      );

      result.current.handleMouseMove(10, 10);
      // Before rAF fires, state should still be null
      expect(result.current.hoveredPath).toBeNull();
      expect(onHover).not.toHaveBeenCalled();

      // Advance timers to fire the rAF callback
      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(result.current.hoveredPath).not.toBeNull();
      expect(onHover).toHaveBeenCalledTimes(1);
    });

    it('calls onHover with correct path and element', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };
      const onHover = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef, onHover }),
      );

      result.current.handleMouseMove(10, 10);
      act(() => {
        vi.advanceTimersByTime(16);
      });

      expect(onHover).toHaveBeenCalledWith(expect.stringContaining('div.btn'), div1);
    });
  });

  // ── 4. handleClick ────────────────────────────────────────────────────

  describe('handleClick', () => {
    it('sets pickedPath after click', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };
      const onPick = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef, onPick }),
      );

      act(() => {
        result.current.handleClick(10, 10);
      });

      expect(result.current.pickedPath).not.toBeNull();
      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith(expect.stringContaining('div.btn'), div1);
    });

    it('does not set pickedPath when disabled', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };
      const onPick = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: false, iframeRef, onPick }),
      );

      act(() => {
        result.current.handleClick(10, 10);
      });

      expect(result.current.pickedPath).toBeNull();
      expect(onPick).not.toHaveBeenCalled();
    });
  });

  // ── 5. handleMouseLeave ───────────────────────────────────────────────

  describe('handleMouseLeave', () => {
    it('resets hoveredPath to null', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };
      const onHover = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef, onHover }),
      );

      // First hover
      result.current.handleMouseMove(10, 10);
      act(() => {
        vi.advanceTimersByTime(16);
      });
      expect(result.current.hoveredPath).not.toBeNull();

      // Then leave
      act(() => {
        result.current.handleMouseLeave();
      });
      expect(result.current.hoveredPath).toBeNull();
      expect(onHover).toHaveBeenLastCalledWith(null, null);
    });
  });

  // ── 6. clearPicked ────────────────────────────────────────────────────

  describe('clearPicked', () => {
    it('resets pickedPath to null', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };
      const onPick = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef, onPick }),
      );

      act(() => {
        result.current.handleClick(10, 10);
      });
      expect(result.current.pickedPath).not.toBeNull();

      act(() => {
        result.current.clearPicked();
      });
      expect(result.current.pickedPath).toBeNull();
    });
  });

  // ── 7. enabled toggle ─────────────────────────────────────────────────

  describe('enabled toggle', () => {
    it('resets hoveredPath and pickedPath when enabled goes from true to false', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };
      const onHover = vi.fn();
      const onPick = vi.fn();

      const { result, rerender } = renderHook(
        ({ enabled }) => useElementPicker({ scale: 1, enabled, iframeRef, onHover, onPick }),
        { initialProps: { enabled: true } },
      );

      // Set some state
      result.current.handleMouseMove(10, 10);
      act(() => {
        vi.advanceTimersByTime(16);
        result.current.handleClick(10, 10);
      });
      expect(result.current.hoveredPath).not.toBeNull();
      expect(result.current.pickedPath).not.toBeNull();

      // Toggle enabled to false
      rerender({ enabled: false });

      expect(result.current.hoveredPath).toBeNull();
      expect(result.current.pickedPath).toBeNull();
      expect(result.current.isPicking).toBe(false);
    });
  });

  // ── 8. rAF cleanup on unmount ─────────────────────────────────────────

  describe('rAF cleanup', () => {
    it('does not throw on unmount', () => {
      const { body, div1 } = buildFakeDom();
      const iframeRef = { current: createFakeIframe(body, div1) };

      const { result, unmount } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef }),
      );

      // Schedule a rAF
      result.current.handleMouseMove(10, 10);

      // Unmount should not throw
      expect(() => unmount()).not.toThrow();
    });
  });

  // ── 9. iframeRef.current is null (safe degradation) ───────────────────

  describe('iframeRef.current is null', () => {
    it('all handle methods do not throw when iframeRef.current is null', () => {
      const iframeRef = { current: null };

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef }),
      );

      expect(() => {
        result.current.handleMouseMove(10, 10);
        result.current.handleClick(10, 10);
        result.current.handleMouseLeave();
      }).not.toThrow();

      expect(result.current.hoveredPath).toBeNull();
      expect(result.current.pickedPath).toBeNull();
    });

    it('returns null path when iframeRef.current is null', () => {
      const iframeRef = { current: null };
      const onHover = vi.fn();
      const onPick = vi.fn();

      const { result } = renderHook(() =>
        useElementPicker({ scale: 1, enabled: true, iframeRef, onHover, onPick }),
      );

      result.current.handleMouseMove(10, 10);
      act(() => {
        vi.advanceTimersByTime(16);
      });
      result.current.handleClick(10, 10);

      expect(result.current.hoveredPath).toBeNull();
      expect(result.current.pickedPath).toBeNull();
      expect(onHover).not.toHaveBeenCalled();
      expect(onPick).not.toHaveBeenCalled();
    });
  });
});
