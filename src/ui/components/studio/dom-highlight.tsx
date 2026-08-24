// SPDX-License-Identifier: MPL-2.0

/**
 * # DomHighlight
 *
 * Renders overlay rectangles on top of a scaled iframe to visually indicate
 * the currently hovered and picked elements. Reads bounding rects from the
 * iframe's contentDocument, multiplies by scale, and positions absolute divs.
 *
 * The overlays are `pointer-events: none` so they do not intercept mouse
 * events — those are captured by the parent's transparent overlay div which
 * feeds useElementPicker.
 */

import { useEffect, useRef, useState } from 'react';

interface DomHighlightProps {
  /** Ref to the iframe element. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Selector path of the hovered element, or null. */
  hoveredPath: string | null;
  /** Selector path of the picked element, or null. */
  pickedPath: string | null;
  /** Scale of the iframe preview (from win.scale). */
  scale: number;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Read the bounding rect of an element inside the iframe, converted to
 * parent-container coordinates (i.e. multiplied by scale and offset by the
 * iframe's position).
 */
function getElementRect(
  iframe: HTMLIFrameElement,
  selectorPath: string,
  scale: number,
): Rect | null {
  const doc = iframe.contentDocument;
  if (!doc) return null;

  const el = doc.querySelector(selectorPath);
  if (!el) return null;

  const rect = el.getBoundingClientRect();
  const iframeRect = iframe.getBoundingClientRect();

  return {
    top: iframeRect.top + rect.top * scale,
    left: iframeRect.left + rect.left * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

export function DomHighlight({ iframeRef, hoveredPath, pickedPath, scale }: DomHighlightProps) {
  const [hoverRect, setHoverRect] = useState<Rect | null>(null);
  const [pickRect, setPickRect] = useState<Rect | null>(null);
  const rafRef = useRef<number | null>(null);

  // Recompute rects when inputs change, with rAF throttle for scroll events
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    // Schedule a recompute on the next frame (coalesces rapid changes)
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;

      const hRect = hoveredPath ? getElementRect(iframe, hoveredPath, scale) : null;
      const pRect = pickedPath ? getElementRect(iframe, pickedPath, scale) : null;

      setHoverRect(hRect);
      setPickRect(pRect);
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [iframeRef, hoveredPath, pickedPath, scale]);

  return (
    <>
      {/* Hover overlay — translucent blue fill + thin border */}
      {hoverRect && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            top: hoverRect.top,
            left: hoverRect.left,
            width: hoverRect.width,
            height: hoverRect.height,
            backgroundColor: 'rgba(59,130,246,0.12)',
            border: '1px solid rgba(59,130,246,0.6)',
          }}
        />
      )}

      {/* Picked overlay — orange border + corner handles */}
      {pickRect && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute"
          style={{
            top: pickRect.top,
            left: pickRect.left,
            width: pickRect.width,
            height: pickRect.height,
            border: '2px solid rgba(234,88,12,0.8)',
          }}
        >
          {/* Corner handles */}
          <span
            className="absolute size-1 rounded-full bg-[rgba(234,88,12,0.8)]"
            style={{ top: -4, left: -4 }}
          />
          <span
            className="absolute size-1 rounded-full bg-[rgba(234,88,12,0.8)]"
            style={{ top: -4, right: -4 }}
          />
          <span
            className="absolute size-1 rounded-full bg-[rgba(234,88,12,0.8)]"
            style={{ bottom: -4, left: -4 }}
          />
          <span
            className="absolute size-1 rounded-full bg-[rgba(234,88,12,0.8)]"
            style={{ bottom: -4, right: -4 }}
          />
        </div>
      )}
    </>
  );
}
