// SPDX-License-Identifier: MPL-2.0

/**
 * # PreviewWindow
 *
 * A single preview window in the Stage — header (identity + actions),
 * body (iframe with srcDoc), footer (dimensions + scale + motion).
 *
 * Rendering protocol:
 *   · When a domTree is provided (from studioStore.snapshot.domTree),
 *     the iframe is built via buildSrcDoc with sanitized DOM replay, role-
 *     aware CSS variable binding, and tool-override cascade injection.
 *   · When only rootVars exist (legacy snapshot), a minimal var-stub page
 *     is rendered so the preview still shows the agent's native look.
 *   · Without either, an empty-state placeholder is shown.
 *
 * Live override updates are pushed via postMessage `{ type: 'as-ov', css }`
 * — the same protocol consumed by RealDomPreview's runtime bridge. This
 * keeps style edits 60 fps without rebuilding the srcDoc.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppMark } from '@/components/app-mark';
import { buildSrcDoc, overridesToCss } from '@/components/studio/RealDomPreview';
import { useStudioStore } from '@/stores/studioStore';
import type { PreviewWindowState } from '@/types/workspace';

import type { DomTreeNode } from '@shared/types';
import { AGENT_META } from '@shared/types';
import { Copy, Maximize, X } from 'lucide-react';
import { sanitizeCSS } from '../../../main/profile/safe-css';

interface PreviewWindowProps {
  win: PreviewWindowState;
  active: boolean;
  onSelect: () => void;
  onScaleChange: (scale: number) => void;
  onClose?: () => void;
  /** Real DOM tree captured from the agent (optional). */
  domTree?: DomTreeNode;
  /** Native :root CSS custom properties captured at snapshot time (optional). */
  rootVars?: Record<string, string>;
}

const SCALE_PRESETS = [0.25, 0.38, 0.45, 0.55, 0.75, 1.0];

export function PreviewWindow({
  win,
  active,
  onSelect,
  onScaleChange,
  onClose,
  domTree,
  rootVars,
}: PreviewWindowProps) {
  const toolOverrides = useStudioStore((s) => s.toolOverrides);
  const meta = AGENT_META[win.agentId];
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // local zoom select (does not persist — per-window session state)
  const [zoomOpen, setZoomOpen] = useState(false);

  // Build the iframe srcDoc from the domTree + rootVars when available.
  // Falls back to a minimal rootVars-only stub for legacy snapshots.
  const srcDoc = useMemo(() => {
    if (domTree) {
      return buildSrcDoc(domTree, undefined, false, FALLBACK_HTML);
    }
    if (rootVars && Object.keys(rootVars).length > 0) {
      const styleEntries = Object.entries(rootVars)
        .map(([k, v]) => `${k}: ${v};`)
        .join('');
      return (
        '<!doctype html><html><head>' +
        `<style>:root{${styleEntries}}</style>` +
        '<style id="ov"></style>' +
        '<script>(function(){window.addEventListener("message",function(e){' +
        'if(e.data&&e.data.type==="as-ov"){var s=document.getElementById("ov");' +
        'if(s)s.textContent=e.data.css;}});})();</script>' +
        `</head><body><div style="padding:32px;font-family:system-ui;color:var(--fg,#e8e2ff);background:var(--bg,#1a1a2e);">` +
        `<h3 style="font-family:monospace;font-size:12px;opacity:.5">${meta.displayName} · Preview</h3>` +
        `</div></body></html>`
      );
    }
    return null;
  }, [domTree, rootVars, meta.displayName]);

  // Convert tool overrides to CSS (same pipeline as RealDomPreview).
  const overrideCss = useMemo(
    () => sanitizeCSS(overridesToCss(toolOverrides)).clean,
    [toolOverrides],
  );

  // Push override CSS whenever it changes or the iframe reloads.
  // Uses the `as-ov` protocol (RealDomPreview runtime bridge) so edits
  // apply without rebuilding the srcDoc.
  const pushOverrides = useCallback(() => {
    const w = iframeRef.current?.contentWindow;
    if (w) {
      try {
        w.postMessage({ type: 'as-ov', css: overrideCss }, '*');
      } catch {
        /* ignore cross-origin postMessage races */
      }
    }
  }, [overrideCss]);

  useEffect(() => {
    pushOverrides();
  }, [pushOverrides]);

  const handleHeaderClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't trigger select when clicking a button
      if ((e.target as HTMLElement).closest('button')) return;
      onSelect();
    },
    [onSelect],
  );

  return (
    <div className="pw" data-active={active}>
      {/* Header — 28px mono */}
      <div className="pw__header">
        <button type="button" className="pw__title-btn" onClick={handleHeaderClick}>
          <span className="pw__app-mark">
            <AppMark appId={win.agentId} size={12} />
          </span>
          <span className="pw__title">{meta.displayName}</span>
        </button>
        <span className="pw__spacer" />
        <button type="button" className="pw__icon-btn" title="Duplicate window">
          <Copy className="size-3" />
        </button>
        <button type="button" className="pw__icon-btn" title="Fullscreen">
          <Maximize className="size-3" />
        </button>
        {onClose && (
          <button type="button" className="pw__icon-btn" onClick={onClose} title="Close">
            <X className="size-3" />
          </button>
        )}
      </div>

      {/* Body — iframe real DOM or empty state */}
      <div className="pw__body">
        {srcDoc ? (
          <iframe
            key={win.id + (domTree ? ':dom' : ':vars')}
            ref={iframeRef}
            srcDoc={srcDoc}
            sandbox="allow-scripts allow-same-origin"
            onLoad={pushOverrides}
            className="pw__iframe"
            style={{ transform: `scale(${win.scale})`, transformOrigin: 'top left' }}
            title={meta.displayName}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[var(--bg-0)]">
            <span className="font-mono text-[length:10px] text-[var(--fg-3)]">No snapshot</span>
          </div>
        )}
      </div>

      {/* Footer — 22px mono */}
      <div className="pw__footer">
        <span className="font-mono">800×600</span>
        <span className="pw__footer-sep">·</span>
        <span className="font-mono">scale {win.scale}×</span>
        <span className="pw__footer-sep">·</span>
        <div className="relative">
          <button
            type="button"
            className="font-mono text-[length:10px] text-[var(--fg-2)] hover:text-[var(--fg-0)]"
            onClick={() => setZoomOpen((v) => !v)}
          >
            zoom ▾
          </button>
          {zoomOpen && (
            <div className="absolute bottom-full right-0 z-10 mb-[2px] flex flex-col gap-0 rounded-[var(--r-xs)] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-0 shadow-[var(--shadow-float)]">
              {SCALE_PRESETS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    onScaleChange(s);
                    setZoomOpen(false);
                  }}
                  className="whitespace-nowrap rounded-[var(--r-micro)] px-[var(--space-2)] py-0 text-left font-mono text-[length:10px] hover:bg-[var(--bg-3)]"
                  style={{
                    background: win.scale === s ? 'var(--accent-ghost)' : 'transparent',
                    color: win.scale === s ? 'var(--accent)' : 'var(--fg-0)',
                  }}
                >
                  {s}×
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Shared fallback for when domTree is empty inside buildSrcDoc.
const FALLBACK_HTML = '<p style="padding:24px;color:#888;font-family:sans-serif">No DOM data</p>';
