// SPDX-License-Identifier: MPL-2.0

/**
 * # PreviewWindow
 *
 * A single preview window in the Stage — status bar (live CDP state),
 * header (identity + actions), body (iframe with srcDoc), footer
 * (dimensions + scale + motion).
 *
 * Rendering protocol:
 *   · DOM data is sourced via the `useLiveDom` hook (real-time CDP +
 *     degraded cache), replacing the legacy manual-snapshot props.
 *   · When a domTree is available, the iframe is built via buildSrcDoc
 *     with sanitized DOM replay, role-aware CSS variable binding, and
 *     tool-override cascade injection.
 *   · During loading / idle with no cached tree, a loading placeholder
 *     is shown.
 *   · On error with no cached tree, an error placeholder with a retry
 *     button (calling `refresh()`) is shown.
 *
 * Live override updates are pushed via direct DOM write to `#ov` style
 * element — the same protocol consumed by RealDomPreview's runtime bridge.
 * This keeps style edits 60 fps without rebuilding the srcDoc.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppMark } from '@/components/AppMark';
import { useElementPicker } from '@/hooks/use-element-picker';
import { usePseudoForce } from '@/hooks/use-pseudo-force';
import { useLiveDom } from '@/hooks/useLiveDom';
import { buildSrcDoc, overridesToCss } from '@/lib/dom-export';
import { useSettingsStore } from '@/stores/settingsStore';
import { useStudioStore } from '@/stores/studioStore';
import type { PreviewWindowState } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';
import { sanitizeCSS } from '@shared/safe-css';
import { AGENT_META } from '@shared/types';
import { Maximize, X } from 'lucide-react';
import { DomHighlight } from './dom-highlight';

interface PreviewWindowProps {
  win: PreviewWindowState;
  active: boolean;
  onSelect: () => void;
  onScaleChange: (scale: number) => void;
  onClose?: () => void;
  t: UiMessages;
  /** Callback when the iframe ref is ready (onLoad). */
  onIframeReady?: (iframe: HTMLIFrameElement) => void;
  /** Whether element picking is active (driven by parent inspector). */
  pickEnabled?: boolean;
  /** Callback when an element is picked. */
  onPick?: (selectorPath: string) => void;
  /** External picked path to highlight (from inspector). */
  externalPickedPath?: string | null;
}

const SCALE_PRESETS = [0.25, 0.38, 0.45, 0.55, 0.75, 1.0];
const PREVIEW_DEFAULT_SIZE = '800×600';

const STATUS_BAR_HEIGHT = 'h-[2px]';

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-cr-success',
  degraded: 'bg-cr-warning',
  error: 'bg-destructive',
  loading: 'bg-info',
  idle: 'bg-muted-foreground',
};

export function PreviewWindow({
  win,
  active,
  onSelect,
  onScaleChange,
  onClose,
  t,
  onIframeReady,
  pickEnabled = false,
  onPick,
  externalPickedPath,
}: PreviewWindowProps) {
  const toolOverrides = useStudioStore((s) => s.toolOverrides);
  const meta = AGENT_META[win.agentId];
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Read the live DOM auto-refresh interval from settings (0 = disabled).
  const liveDomRefreshInterval = useSettingsStore((s) => s.settings?.liveDomRefreshInterval ?? 0);

  // Live DOM data — real-time CDP with degraded-cache fallback.
  const { domTree, status, error, refresh } = useLiveDom(win.agentId, {
    cacheTTL: 30_000,
    refreshInterval: liveDomRefreshInterval,
  });

  // Element picker hook — drives hover/pick over the iframe.
  const picker = useElementPicker({
    scale: win.scale,
    enabled: pickEnabled,
    iframeRef,
    onPick: (path) => onPick?.(path),
  });

  // Pseudo-force hook — simulates :hover inside the iframe on picked elements.
  const pseudo = usePseudoForce({ iframeRef });

  // Sync hovered element to pseudo-force :hover inside the iframe.
  useEffect(() => {
    if (picker.hoveredPath) {
      pseudo.forceHover(picker.hoveredPath);
    } else {
      pseudo.clear();
    }
  }, [picker.hoveredPath, pseudo]);

  // local zoom select (does not persist — per-window session state)
  const [zoomOpen, setZoomOpen] = useState(false);

  // Build the iframe srcDoc from the domTree when available.
  const srcDoc = useMemo(() => {
    if (domTree) {
      return buildSrcDoc(domTree, undefined, false, FALLBACK_HTML);
    }
    return null;
  }, [domTree]);

  // Convert tool overrides to CSS (same pipeline as RealDomPreview).
  const overrideCss = useMemo(
    () => sanitizeCSS(overridesToCss(toolOverrides)).clean,
    [toolOverrides],
  );

  // Push override CSS whenever it changes or the iframe reloads.
  // Writes override CSS directly into the iframe's #ov style element so
  // edits apply without rebuilding the srcDoc.
  const pushOverrides = useCallback(() => {
    // Direct DOM write — the iframe has allow-same-origin, so contentDocument
    // is accessible. This avoids the postMessage + inline-script pattern that
    // violated the parent page's CSP (script-src 'self').
    const doc = iframeRef.current?.contentDocument;
    if (doc) {
      try {
        const ov = doc.getElementById('ov');
        if (ov) ov.textContent = overrideCss;
      } catch {
        /* ignore rare access races during iframe teardown */
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

  // Status bar title for accessibility / tooltip.
  const statusTitle = error ? `${status} — ${error}` : status;

  return (
    <div className="pw" data-active={active}>
      {/* Status bar — 2px tall, color-coded by live CDP state */}
      <div
        className={`${STATUS_BAR_HEIGHT} w-full ${STATUS_COLORS[status] ?? STATUS_COLORS.idle}`}
        title={statusTitle}
        role="status"
        aria-label={statusTitle}
      />

      {/* Header — 28px mono */}
      <div className="pw__header">
        <button type="button" className="pw__title-btn" onClick={handleHeaderClick}>
          <span className="pw__app-mark">
            <AppMark appId={win.agentId} size={12} />
          </span>
          <span className="pw__title">{meta.displayName}</span>
        </button>
        <span className="pw__spacer" />
        <button type="button" className="pw__icon-btn" title={t.studioFullscreen}>
          <Maximize className="size-3" />
        </button>
        {onClose && (
          <button type="button" className="pw__icon-btn" onClick={onClose} title={t.close}>
            <X className="size-3" />
          </button>
        )}
      </div>

      {/* Body — iframe real DOM, loading, or error state */}
      <div className="pw__body">
        {srcDoc ? (
          <div className="relative" style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
            <iframe
              key={win.id + (domTree ? ':dom' : ':vars')}
              ref={iframeRef}
              srcDoc={srcDoc}
              sandbox="allow-scripts allow-same-origin"
              onLoad={() => {
                pushOverrides();
                onIframeReady?.(iframeRef.current!);
              }}
              className="pw__iframe"
              style={{ transform: `scale(${win.scale})`, transformOrigin: 'top left' }}
              title={`${meta.displayName} · ${t.studioPreviewStatus}`}
              tabIndex={-1}
            />
            {/* Transparent overlay for element picking */}
            {pickEnabled && (
              <button
                type="button"
                className="absolute inset-0 cursor-crosshair"
                style={{ zIndex: 10, background: 'transparent', border: 'none', padding: 0 }}
                onMouseMove={(e) => {
                  picker.handleMouseMove(e.clientX, e.clientY);
                }}
                onClick={(e) => {
                  picker.handleClick(e.clientX, e.clientY);
                }}
                onMouseLeave={picker.handleMouseLeave}
              />
            )}
            {/* Highlight overlays for hovered / picked elements */}
            <DomHighlight
              iframeRef={iframeRef}
              hoveredPath={picker.hoveredPath}
              pickedPath={picker.pickedPath ?? externalPickedPath ?? null}
              scale={win.scale}
            />
          </div>
        ) : status === 'loading' || status === 'idle' ? (
          <div className="flex h-full w-full items-center justify-center bg-background">
            <span className="text-micro text-muted-foreground">
              {t.studioPreviewLoading}
            </span>
          </div>
        ) : status === 'error' ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background">
            <span className="text-micro text-muted-foreground">
              {error ?? t.studioPreviewError}
            </span>
            <button
              type="button"
              onClick={refresh}
              className="rounded-sm border border-border px-2 py-0 text-micro text-muted-foreground hover:bg-muted"
            >
              {t.studioPreviewRetry}
            </button>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-background">
            <span className="text-micro text-muted-foreground">{t.studioNoSnapshot}</span>
          </div>
        )}
      </div>

      {/* Footer — 22px mono */}
      <div className="pw__footer">
        <span className="font-mono">{PREVIEW_DEFAULT_SIZE}</span>
        <span className="pw__footer-sep">·</span>
        <span className="font-mono">{t.studioPreviewScale(win.scale)}</span>
        <span className="pw__footer-sep">·</span>
        <div className="relative">
          <button
            type="button"
            className="text-micro text-muted-foreground hover:text-foreground"
            onClick={() => setZoomOpen((v) => !v)}
          >
            {t.studioZoomTrigger} ▾
          </button>
          {zoomOpen && (
            <div className="absolute bottom-full right-0 z-[var(--z-content)] mb-1 flex flex-col gap-0 rounded-sm border border-border bg-surface p-0 shadow-md">
              {SCALE_PRESETS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    onScaleChange(s);
                    setZoomOpen(false);
                  }}
                  className="whitespace-nowrap rounded-sm px-2 py-0 text-left text-micro hover:bg-muted"
                  style={{
                    background: win.scale === s ? 'var(--primary)' : 'transparent',
                    color: win.scale === s ? 'var(--accent-foreground)' : 'var(--foreground)',
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
