// SPDX-License-Identifier: MPL-2.0

/**
 * # AbFlip
 *
 * A/B flip comparison component — overlays a baseline (un-themed) DOM snapshot
 * and the current themed view, with three display modes:
 *
 *   - `baseline` — shows only the un-themed snapshot
 *   - `current`  — shows only the themed snapshot
 *   - `split`    — side-by-side with a vertical divider
 *
 * A "Show Diff" toggle injects dashed orange outlines on nodes whose computed
 * `style` changed between baseline and current (depth-first index aligned).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildSrcDoc } from '@/lib/dom-export';

import type { UiMessages } from '@shared/i18n';
import { sanitizeCSS } from '@shared/safe-css';
import type { DomTreeNode } from '@shared/types';
import type { AgentId } from '@shared/types/agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AbFlipProps {
  /** Baseline domTree (un-themed). */
  baselineDomTree: DomTreeNode | null;
  /** Current domTree (themed). */
  currentDomTree: DomTreeNode | null;
  /** Current theme override CSS. */
  overrideCss: string;
  /** Themed agent id. */
  agentId: AgentId;
  /** Scale for both iframes. */
  scale: number;
  /** Container width/height. */
  width: number;
  height: number;
  /** i18n messages. */
  t: UiMessages;
}

type ViewMode = 'baseline' | 'current' | 'split';

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

/**
 * Walk two DomTreeNode trees in depth-first order, comparing the `style`
 * record of each pair of nodes that share the same depth-first index.
 * Returns a flat list of indices (in DFS order) for nodes whose style
 * changed between baseline and current.
 */
function computeDiffIndices(baseline: DomTreeNode, current: DomTreeNode): number[] {
  const changed: number[] = [];
  let index = 0;

  function walk(b: DomTreeNode | undefined, c: DomTreeNode | undefined, _depth: number): void {
    if (!b || !c) return;
    if (!shallowEqual(b.style, c.style)) {
      changed.push(index);
    }
    index++;
    const max = Math.max(b.children.length, c.children.length);
    for (let i = 0; i < max; i++) {
      walk(b.children[i], c.children[i], _depth + 1);
    }
  }

  walk(baseline, current, 0);
  return changed;
}

/** Shallow equality for Record<string, string>. */
function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AbFlip({
  baselineDomTree,
  currentDomTree,
  overrideCss,
  agentId,
  scale,
  width,
  height,
  t,
}: AbFlipProps) {
  const [view, setView] = useState<ViewMode>('current');
  const [showDiff, setShowDiff] = useState(false);
  const baselineIframeRef = useRef<HTMLIFrameElement>(null);
  const currentIframeRef = useRef<HTMLIFrameElement>(null);

  // Build srcDoc for baseline (no override CSS).
  const baselineSrcDoc = useMemo(() => {
    if (!baselineDomTree) return null;
    return buildSrcDoc(baselineDomTree, undefined, false, FALLBACK_HTML);
  }, [baselineDomTree]);

  // Build srcDoc for current (themed, no override — override pushed via #ov).
  const currentSrcDoc = useMemo(() => {
    if (!currentDomTree) return null;
    return buildSrcDoc(currentDomTree, undefined, false, FALLBACK_HTML);
  }, [currentDomTree]);

  // Compute diff selectors (DFS index → nth-child selector path).
  const diffCss = useMemo(() => {
    if (!showDiff || !baselineDomTree || !currentDomTree) return '';
    const indices = computeDiffIndices(baselineDomTree, currentDomTree);
    if (indices.length === 0) return '';
    // Build CSS that targets the changed nodes by their nth-of-type position
    // in a depth-first traversal. We use a data-attribute approach: inject a
    // small script that walks the DOM in DFS order and marks changed indices
    // with `data-diff="1"`, then style via attribute selector.
    const idxList = JSON.stringify(indices);
    return `<style id="ab-diff">${indices.map((i) => `[data-ab-idx="${i}"]{outline:2px dashed rgba(234,88,12,0.7)!important;outline-offset:-2px}`).join('')}</style><script>(function(){var idx=${idxList};var counter=0;function walk(el){if(!el||el.nodeType!==1)return;if(idx.indexOf(counter)!==-1)el.setAttribute("data-ab-idx",counter);counter++;for(var i=0;i<el.children.length;i++)walk(el.children[i]);}walk(document.body);})()</script>`;
  }, [showDiff, baselineDomTree, currentDomTree]);

  // Sanitize override CSS before injection.
  const safeOverrideCss = useMemo(() => sanitizeCSS(overrideCss).clean, [overrideCss]);

  // Push override CSS into the current iframe's #ov element.
  const pushOverride = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      const doc = iframe?.contentDocument;
      if (!doc) return;
      try {
        const ov = doc.getElementById('ov');
        if (ov) ov.textContent = safeOverrideCss;
      } catch {
        /* ignore access races during iframe teardown */
      }
    },
    [safeOverrideCss],
  );

  // Push diff markup into the current iframe after load.
  const pushDiff = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      if (!diffCss) return;
      const doc = iframe?.contentDocument;
      if (!doc) return;
      try {
        // Remove any previous diff injection.
        const prevStyle = doc.getElementById('ab-diff');
        if (prevStyle) prevStyle.remove();
        const prevScript = doc.querySelector('script[data-ab-diff]');
        if (prevScript) prevScript.remove();
        // Inject diff CSS + DFS walker script at end of body.
        const tmp = doc.createElement('div');
        tmp.innerHTML = diffCss;
        while (tmp.firstChild) {
          const child = tmp.firstChild;
          if (child.nodeType === 1) {
            (child as Element).setAttribute('data-ab-diff', '1');
          }
          doc.body.appendChild(child);
          if (child.nodeType === 1 && (child as Element).tagName === 'SCRIPT') {
            // Scripts inserted via innerHTML don't execute; clone & replace.
            const s = child as HTMLScriptElement;
            const clone = doc.createElement('script');
            clone.setAttribute('data-ab-diff', '1');
            clone.textContent = s.textContent;
            child.parentNode?.replaceChild(clone, child);
          }
        }
      } catch {
        /* ignore */
      }
    },
    [diffCss],
  );

  // Re-push diff when toggled or when current iframe reloads.
  useEffect(() => {
    if (showDiff) {
      pushDiff(currentIframeRef.current);
    } else {
      // Clean up diff markers.
      const doc = currentIframeRef.current?.contentDocument;
      if (doc) {
        doc.querySelectorAll('[data-ab-diff]').forEach((el) => {
          el.remove();
        });
        doc.querySelectorAll('[data-ab-idx]').forEach((el) => {
          el.removeAttribute('data-ab-idx');
        });
      }
    }
  }, [showDiff, pushDiff]);

  // Compute clip-paths for split view.
  const splitClipBaseline = 'inset(0 50% 0 0)';
  const splitClipCurrent = 'inset(0 0 0 50%)';

  const iframeStyle: React.CSSProperties = {
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    width: `${width}px`,
    height: `${height}px`,
    border: 'none',
  };

  return (
    <div className="flex flex-col gap-2" data-agent={agentId}>
      {/* Control bar */}
      <div className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1">
        <div className="flex gap-0 rounded-sm border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setView('baseline')}
            className={`px-2 py-0 font-mono text-micro transition-colors ${view === 'baseline' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Baseline
          </button>
          <button
            type="button"
            onClick={() => setView('current')}
            className={`px-2 py-0 font-mono text-micro transition-colors ${view === 'current' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Current
          </button>
          <button
            type="button"
            onClick={() => setView('split')}
            className={`px-2 py-0 font-mono text-micro transition-colors ${view === 'split' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Split
          </button>
        </div>

        <span className="mx-1 h-3 w-px bg-border" />

        <button
          type="button"
          onClick={() => setShowDiff((v) => !v)}
          className={`rounded-sm border px-2 py-0 font-mono text-micro transition-colors ${showDiff ? 'border-cr-warning bg-cr-warning/10 text-cr-warning' : 'border-border text-muted-foreground hover:bg-muted'}`}
        >
          {showDiff ? 'Diff ●' : 'Diff ○'}
        </button>

        <span className="flex-1" />

        <span className="font-mono text-micro text-muted-foreground">
          {view === 'baseline' && 'Un-themed'}
          {view === 'current' && 'Themed'}
          {view === 'split' && 'A|B Compare'}
        </span>
      </div>

      {/* Dual iframe container */}
      <div
        className="relative overflow-hidden rounded-sm border border-border bg-background"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {/* Baseline iframe */}
        {baselineSrcDoc && (
          <iframe
            ref={baselineIframeRef}
            srcDoc={baselineSrcDoc}
            sandbox="allow-scripts allow-same-origin"
            className="absolute left-0 top-0 transition-opacity duration-300"
            style={{
              ...iframeStyle,
              opacity: view === 'baseline' || view === 'split' ? 1 : 0,
              clipPath: view === 'split' ? splitClipBaseline : undefined,
              pointerEvents: view === 'baseline' ? 'auto' : 'none',
            }}
            title={`Baseline · ${agentId}`}
            tabIndex={-1}
          />
        )}

        {/* Current iframe */}
        {currentSrcDoc && (
          <iframe
            ref={currentIframeRef}
            srcDoc={currentSrcDoc}
            sandbox="allow-scripts allow-same-origin"
            className="absolute left-0 top-0 transition-opacity duration-300"
            style={{
              ...iframeStyle,
              opacity: view === 'current' || view === 'split' ? 1 : 0,
              clipPath: view === 'split' ? splitClipCurrent : undefined,
              pointerEvents: view === 'current' ? 'auto' : 'none',
            }}
            title={`Current · ${agentId}`}
            tabIndex={-1}
            onLoad={() => {
              pushOverride(currentIframeRef.current);
              if (showDiff) pushDiff(currentIframeRef.current);
            }}
          />
        )}

        {/* Split divider */}
        {view === 'split' && (
          <div
            className="absolute top-0 z-[var(--z-content)] h-full w-px bg-cr-warning"
            style={{ left: `${width / 2}px` }}
          />
        )}

        {/* Empty state */}
        {!baselineSrcDoc && !currentSrcDoc && (
          <div className="flex h-full w-full items-center justify-center">
            <span className="font-mono text-micro text-muted-foreground">{t.studioNoSnapshot}</span>
          </div>
        )}
      </div>
    </div>
  );
}

const FALLBACK_HTML = '<p style="padding:24px;color:#888;font-family:sans-serif">No DOM data</p>';
