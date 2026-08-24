// SPDX-License-Identifier: MPL-2.0

/**
 * # usePseudoForce
 *
 * Forces CSS pseudo-class-like states on elements inside a srcdoc iframe
 * using data attributes. Since the iframe content is a sanitized replay
 * (no real user interaction possible), we simulate :hover, :focus, :active
 * via `[data-studio-hover]`, `[data-studio-focus]`, `[data-studio-active]`
 * attributes that trigger visual outlines via an injected <style> element.
 *
 * The fallback stylesheet is written into a dedicated `<style id="studio-pseudo-fallback">`
 * element in the iframe head — separate from `#ov` (which carries tool overrides)
 * so that theme overrides and pseudo-state visuals remain independent.
 */

import { useCallback, useEffect, useRef } from 'react';

interface ForcedRefs {
  hover: Element | null;
  focus: Element | null;
  active: Element | null;
}

export interface PseudoForceOptions {
  /** Ref to the iframe element. */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

export interface PseudoForceResult {
  /** Force hover state on the element matching the selector path. */
  forceHover: (selectorPath: string) => void;
  /** Force focus state on the element matching the selector path. */
  forceFocus: (selectorPath: string) => void;
  /** Force active state on the element matching the selector path. */
  forceActive: (selectorPath: string) => void;
  /** Remove all data-studio-* attributes from all elements. */
  clear: () => void;
}

const PSEUDO_FALLBACK_STYLE_ID = 'studio-pseudo-fallback';

const FALLBACK_CSS = `
[data-studio-hover]{outline:2px dashed rgba(59,130,246,0.6)!important}
[data-studio-focus]{outline:2px dashed rgba(168,85,247,0.6)!important}
[data-studio-active]{outline:2px dashed rgba(234,88,12,0.6)!important}
`;

/**
 * Ensure the pseudo-fallback <style> element exists in the iframe head.
 * Creates it on first access if missing.
 */
function ensureFallbackStyle(doc: Document): HTMLStyleElement | null {
  let style = doc.getElementById(PSEUDO_FALLBACK_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = doc.createElement('style');
    style.id = PSEUDO_FALLBACK_STYLE_ID;
    style.textContent = FALLBACK_CSS;
    doc.head.appendChild(style);
  }
  return style;
}

export function usePseudoForce(opts: PseudoForceOptions): PseudoForceResult {
  const { iframeRef } = opts;

  // Track currently forced elements so we can clean them up
  const forcedRefs = useRef<ForcedRefs>({ hover: null, focus: null, active: null });

  const forceHover = useCallback(
    (selectorPath: string) => {
      // Clear previous hover
      forcedRefs.current.hover?.removeAttribute('data-studio-hover');
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      ensureFallbackStyle(doc);
      const el = doc.querySelector(selectorPath);
      if (el) {
        el.setAttribute('data-studio-hover', 'true');
        forcedRefs.current.hover = el;
      }
    },
    [iframeRef],
  );

  const forceFocus = useCallback(
    (selectorPath: string) => {
      forcedRefs.current.focus?.removeAttribute('data-studio-focus');
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      ensureFallbackStyle(doc);
      const el = doc.querySelector(selectorPath);
      if (el) {
        el.setAttribute('data-studio-focus', 'true');
        // Attempt real focus for elements that support it
        if (typeof (el as HTMLElement).focus === 'function') {
          (el as HTMLElement).focus({ preventScroll: true });
        }
        forcedRefs.current.focus = el;
      }
    },
    [iframeRef],
  );

  const forceActive = useCallback(
    (selectorPath: string) => {
      forcedRefs.current.active?.removeAttribute('data-studio-active');
      const doc = iframeRef.current?.contentDocument;
      if (!doc) return;
      ensureFallbackStyle(doc);
      const el = doc.querySelector(selectorPath);
      if (el) {
        el.setAttribute('data-studio-active', 'true');
        forcedRefs.current.active = el;
      }
    },
    [iframeRef],
  );

  const clear = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    // Remove all data-studio-* attributes from every element
    const all = doc.querySelectorAll(
      '[data-studio-hover],[data-studio-focus],[data-studio-active]',
    );
    for (const el of all) {
      el.removeAttribute('data-studio-hover');
      el.removeAttribute('data-studio-focus');
      el.removeAttribute('data-studio-active');
    }
    forcedRefs.current = { hover: null, focus: null, active: null };
  }, [iframeRef]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      // Best-effort cleanup — iframe may already be detached
      try {
        const doc = iframeRef.current?.contentDocument;
        if (doc) {
          const all = doc.querySelectorAll(
            '[data-studio-hover],[data-studio-focus],[data-studio-active]',
          );
          for (const el of all) {
            el.removeAttribute('data-studio-hover');
            el.removeAttribute('data-studio-focus');
            el.removeAttribute('data-studio-active');
          }
        }
      } catch {
        /* iframe torn down — ignore */
      }
    };
  }, [iframeRef]);

  return { forceHover, forceFocus, forceActive, clear };
}
