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
 *
 * Also provides a classify trigger + summary panel for the treatment
 * classifier pipeline. The actual IPC call is delegated to the parent via
 * callbacks; this component only renders the trigger button and result badge.
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
  /** Callback to trigger classification (parent owns the IPC call). */
  onClassify?: () => void;
  /** Whether a classification request is in flight. */
  classifying?: boolean;
  /** Classification result summary (remove/transparentize/frost/keep counts). */
  classifySummary?: {
    remove: number;
    transparentize: number;
    frost: number;
    keep: number;
  } | null;
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

type TreatmentKey = 'remove' | 'transparentize' | 'frost' | 'keep';

const TREATMENT_LABELS: Record<TreatmentKey, string> = {
  remove: 'Remove',
  transparentize: 'Transparent',
  frost: 'Frost',
  keep: 'Keep',
};

export function DomHighlight({
  iframeRef,
  hoveredPath,
  pickedPath,
  scale,
  onClassify,
  classifying = false,
  classifySummary,
}: DomHighlightProps) {
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

      {/* Classify trigger + summary badge */}
      {onClassify && (
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1">
          <button
            type="button"
            className="pointer-events-auto rounded-md border border-border bg-surface px-2 py-0 text-micro text-muted-foreground shadow-md hover:bg-muted disabled:opacity-50"
            disabled={classifying}
            onClick={() => onClassify()}
          >
            {classifying ? 'Classifying…' : 'Classify'}
          </button>
          {classifySummary && (
            <div className="pointer-events-auto flex gap-1 rounded-md border border-border bg-surface px-2 py-1 text-micro shadow-md">
              {(Object.keys(TREATMENT_LABELS) as TreatmentKey[]).map((key) => (
                <span key={key} className="flex items-center gap-0">
                  <span className="text-muted-foreground">{TREATMENT_LABELS[key]}:</span>
                  <span className="ml-1 tabular-nums text-foreground">{classifySummary[key]}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
