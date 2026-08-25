// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { buildSrcDoc, overridesToCss } from '@/lib/dom-export';
import type { StudioColorSets, ToolOverride } from '@/types/override';

import type { UiMessages } from '@shared/i18n';
import { sanitizeCSS } from '@shared/safe-css';
import type { DomTreeNode } from '@shared/types';

function RealDomPreview({
  domTree,
  overrides,
  colorSets,
  t,
  onIframeMount,
}: {
  domTree?: DomTreeNode;
  overrides: ToolOverride | null;
  colorSets?: StudioColorSets;
  t: UiMessages;
  /**
   * Optional callback invoked with the iframe element once it mounts.
   * Used by AgentLivePreview for element-picking click-listener injection.
   */
  onIframeMount?: (iframe: HTMLIFrameElement) => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const grad = Boolean(overrides?.gradientAccent);
  const fallbackHtml = `<p style="padding:24px;color:#888;font-family:sans-serif">${t.studioRealDomNoData}</p>`;
  const srcDoc = useMemo(
    () => buildSrcDoc(domTree, colorSets, grad, fallbackHtml),
    [domTree, colorSets, grad, fallbackHtml],
  );
  const overrideCss = useMemo(() => sanitizeCSS(overridesToCss(overrides)).clean, [overrides]);

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

  // Push on mount + whenever the overrides change; onLoad re-pushes once the
  // iframe document is ready (covers the initial load race).
  useEffect(() => {
    pushOverrides();
  }, [pushOverrides]);

  // Notify parent of iframe element for element picking (M8).
  useEffect(() => {
    if (iframeRef.current && onIframeMount) {
      onIframeMount(iframeRef.current);
    }
  }, [onIframeMount]);

  // style: sharp corners, no shadow, mono label bar
  return (
    <div
      className="mx-auto mt-2 min-h-0 w-full max-w-[840px] overflow-hidden "
      style={{ background: 'var(--surface)' }}
    >
      {/* traffic-light status bar */}
      <div className="flex h-7 items-center gap-2  px-3" style={{ background: 'var(--card)' }}>
        <div className="flex gap-1">
          <span className="size-[7px] rounded-md bg-[var(--destructive)]" />
          <span className="size-[7px] rounded-md bg-[var(--cr-warning)]" />
          <span className="size-[7px] rounded-md bg-[var(--cr-success)]" />
        </div>
        <span
          className="ml-2 truncate text-[10px]"
          style={{ letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}
        >
          {t.studioPreviewStatus}
        </span>
        {domTree && (
          <span
            className="ml-auto text-[10px]"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {t.studioLiveIndicator}
          </span>
        )}
      </div>
      <iframe
        ref={iframeRef}
        title={t.studioRealDomPreviewTitle}
        sandbox="allow-scripts allow-same-origin"
        srcDoc={srcDoc}
        onLoad={pushOverrides}
        className="block h-[var(--preview-h)] w-full"
      />
    </div>
  );
}

export { RealDomPreview };
