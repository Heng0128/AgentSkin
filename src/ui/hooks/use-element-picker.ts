// SPDX-License-Identifier: MPL-2.0

/**
 * # useElementPicker
 *
 * Provides element-picking capability over a srcdoc iframe.
 * A transparent overlay div (rendered by the parent) captures mouse events;
 * the hook computes coordinates divided by `scale` and uses
 * `elementFromPoint()` on the iframe's contentDocument to locate the
 * underlying element.
 *
 * Outputs a stable CSS selector path (tag + :nth-child chain) for the hovered
 * and picked elements. Callers use these paths to drive pseudo-force
 * highlighting and the inspector details panel.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ElementPickerOptions {
  /** Scale of the iframe preview (from win.scale). */
  scale: number;
  /** Whether picking is active (inspector mode). */
  enabled: boolean;
  /** Ref to the iframe element. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Callback fired when an element is clicked. */
  onPick?: (selectorPath: string, el: Element) => void;
  /** Callback fired on hover change. */
  onHover?: (selectorPath: string | null, el: Element | null) => void;
}

export interface ElementPickerResult {
  /** Selector path of the currently hovered element, or null. */
  hoveredPath: string | null;
  /** Selector path of the picked element, or null. */
  pickedPath: string | null;
  /** Whether picker mode is active. */
  isPicking: boolean;
  /** Clear the picked selection. */
  clearPicked: () => void;
  /** Wire onto the overlay div's onMouseMove — receives clientX/clientY. */
  handleMouseMove: (clientX: number, clientY: number) => void;
  /** Wire onto the overlay div's onClick — receives clientX/clientY. */
  handleClick: (clientX: number, clientY: number) => void;
  /** Wire onto the overlay div's onMouseLeave. */
  handleMouseLeave: () => void;
}

/**
 * Build a stable selector path from the element up to (and including) `<body>`.
 *
 * Example: `body > main > div.chat:nth-child(2) > button.send:nth-child(1)`
 */
function buildStableSelector(el: Element, body: Element): string {
  const segments: string[] = [];
  let current: Element | null = el;

  while (current && current !== body) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) break;

    // Determine if there are siblings with the same tag name to decide
    // whether :nth-child is needed for a stable path.
    const children = Array.from(parent.children);
    const hasSameTagSiblings = children.some(
      (sibling) => sibling !== current && sibling.tagName.toLowerCase() === tag,
    );

    let index = 1;
    if (hasSameTagSiblings) {
      for (const sibling of children) {
        if (sibling === current) break;
        if (sibling.tagName.toLowerCase() === tag) {
          index++;
        }
      }
    }

    const cls = current.getAttribute('class');
    if (cls) {
      const safeClasses = cls.trim().split(/\s+/).filter(Boolean).join('.');
      segments.unshift(`${tag}.${safeClasses}${hasSameTagSiblings ? `:nth-child(${index})` : ''}`);
    } else {
      segments.unshift(`${tag}${hasSameTagSiblings ? `:nth-child(${index})` : ''}`);
    }

    current = parent;
  }

  if (current === body) {
    segments.unshift('body');
  }

  return segments.join(' > ');
}

export function useElementPicker(opts: ElementPickerOptions): ElementPickerResult {
  const { scale, enabled, iframeRef, onPick, onHover } = opts;

  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [pickedPath, setPickedPath] = useState<string | null>(null);

  const hoveredPathRef = useRef<string | null>(null);
  const pickedPathRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastEventRef = useRef<{ x: number; y: number } | null>(null);

  // Keep refs in sync so the rAF callback reads latest values
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const resolveElement = useCallback(
    (clientX: number, clientY: number): { path: string | null; el: Element | null } => {
      const iframe = iframeRef.current;
      if (!iframe?.contentDocument) return { path: null, el: null };

      const rect = iframe.getBoundingClientRect();
      // Convert overlay coords → iframe element coords → scaled document coords
      const xInIframe = clientX - rect.left;
      const yInIframe = clientY - rect.top;
      const docX = xInIframe / scaleRef.current;
      const docY = yInIframe / scaleRef.current;

      const el = iframe.contentDocument.elementFromPoint(docX, docY);
      if (!el || el === iframe.contentDocument.documentElement) {
        return { path: null, el: null };
      }

      const body = iframe.contentDocument.body;
      const path = buildStableSelector(el, body);
      return { path, el };
    },
    [iframeRef],
  );

  const handleMouseMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!enabledRef.current) return;
      lastEventRef.current = { x: clientX, y: clientY };

      if (rafRef.current !== null) return; // throttle: rAF already scheduled

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const ev = lastEventRef.current;
        if (!ev) return;
        const { path, el } = resolveElement(ev.x, ev.y);

        if (path !== hoveredPathRef.current) {
          hoveredPathRef.current = path;
          setHoveredPath(path);
          onHover?.(path, el);
        }
      });
    },
    [resolveElement, onHover],
  );

  const handleClick = useCallback(
    (clientX: number, clientY: number) => {
      if (!enabledRef.current) return;
      const { path, el } = resolveElement(clientX, clientY);
      if (path && el) {
        pickedPathRef.current = path;
        setPickedPath(path);
        onPick?.(path, el);
      }
    },
    [resolveElement, onPick],
  );

  const handleMouseLeave = useCallback(() => {
    hoveredPathRef.current = null;
    setHoveredPath(null);
    onHover?.(null, null);
  }, [onHover]);

  const clearPicked = useCallback(() => {
    pickedPathRef.current = null;
    setPickedPath(null);
  }, []);

  // Clean up rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  // Reset state when disabled
  useEffect(() => {
    if (!enabled) {
      hoveredPathRef.current = null;
      pickedPathRef.current = null;
      setHoveredPath(null);
      setPickedPath(null);
    }
  }, [enabled]);

  return {
    hoveredPath,
    pickedPath,
    isPicking: enabled,
    clearPicked,
    handleMouseMove,
    handleClick,
    handleMouseLeave,
  };
}
