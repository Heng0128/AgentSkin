// SPDX-License-Identifier: MPL-2.0

/**
 * Agent Raw Preview — rebuild an Agent's original visuals inside an isolated iframe.
 *
 * Input:  the real DOM subtree captured by CDP (`DomTreeNode`, see `dom-tree.ts`)
 *         plus the native root CSS variables for a given light / dark scheme.
 * Output: an iframe whose srcDoc renders every node with its captured inline style
 *         and a synthesized stylesheet (:root { --native-vars } + captured inline
 *         <style> blocks). The result is a pixel-identical soft-reconstruction of
 *         the Agent's original UI that the user can switch between light / dark at
 *         the click of a tab.
 *
 * Unlike the theme-editing preview (`RealDomPreview`), this preview renders the
 * agent's NATIVE appearance: no toolbox overrides, no role-based color rebinding.
 * The captured styles are emitted verbatim so the user can compare "before theme"
 * (baseline) against "after theme" (current snapshot).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { DomTreeNode } from '@shared/types';

export interface AgentRawPreviewProps {
  /** Real DOM subtree as returned by the CDP capture (`DomTreeNode`). */
  domTree: DomTreeNode | null;
  /** Native CSS custom properties keyed by name (e.g. "--color-background"). */
  rootVars: Record<string, string>;
  /** Native <style> blocks (textContent) captured from inline <style> tags. */
  inlineStyleBlocks?: string[];
  /** Optional CSS URL map: href -> resolved text (external stylesheets). */
  externalSheets?: Record<string, string>;
  themeMode: 'light' | 'dark';
  /** Scale factor for the preview (1 = actual size). */
  scale?: number;
}

// ===========================================================================
// Safe attribute replay (same policy as RealDomPreview)
// ===========================================================================

const ALLOWED_ATTRS = new Set([
  'class',
  'id',
  'title',
  'alt',
  'width',
  'height',
  'cols',
  'rows',
  'placeholder',
  'type',
  'value',
  'name',
  'for',
  'href',
  'src',
  'srcset',
  'target',
  'rel',
  'aria-label',
  'aria-hidden',
  'role',
  'data-*',
]);

function isSafeAttr(k: string, v: string): boolean {
  if (k.startsWith('on')) return false; // strip event handlers
  if (k.startsWith('data-')) return true; // data-* carries no code paths
  if (ALLOWED_ATTRS.has(k)) {
    if (k === 'href' || k === 'src' || k === 'srcset') {
      return !/^\s*(javascript|vbscript|data:text\/html)/i.test(v);
    }
    return true;
  }
  return false;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ===========================================================================
// Recursive DOM reconstruction → raw HTML string
// ===========================================================================

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

function renderDomNode(node: DomTreeNode): string {
  const tag = escapeHtml(node.tag || 'div');

  // Inline styles are emitted verbatim — `DomTreeNode.style` already carries
  // resolved CSS property names (e.g. "background-color"), unlike the old
  // abridged-key contract that dropped most captured properties.
  const styleEntries = Object.entries(node.style ?? {});
  const styleAttr =
    styleEntries.length > 0
      ? ` style="${escapeAttr(styleEntries.map(([k, v]) => `${k}: ${v}`).join('; '))}"`
      : '';

  const cls = node.cls ? ` class="${escapeAttr(node.cls)}"` : '';

  // Replay whitelisted attributes (SVG geometry, aria, img width/height…).
  let attrs = '';
  if (node.attrs) {
    attrs = Object.entries(node.attrs)
      .filter(([k, v]) => isSafeAttr(k, v))
      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
      .join('');
  }

  // Inlined image source (data URL) for <img> nodes, when available.
  const src =
    node.imgSrc && !/^\s*(javascript|vbscript|data:text\/html)/i.test(node.imgSrc)
      ? ` src="${escapeAttr(node.imgSrc)}"`
      : '';

  if (VOID_TAGS.has(node.tag)) {
    return `<${tag}${cls}${attrs}${src}${styleAttr}>`;
  }

  let children = '';
  if (node.children && node.children.length > 0) {
    children = node.children.map(renderDomNode).join('');
  } else if (node.text) {
    children = escapeHtml(node.text);
  }

  return `<${tag}${cls}${attrs}${styleAttr}>${children}</${tag}>`;
}

// ===========================================================================
// Synthesize an isolated srcDoc
// ===========================================================================

function buildSrcDoc(props: AgentRawPreviewProps): string {
  const { domTree, rootVars, inlineStyleBlocks = [], themeMode, externalSheets = {} } = props;

  // 1. Root native vars block
  const varEntries = Object.entries(rootVars);
  const rootVarCss =
    varEntries.length > 0
      ? `:root {\n${varEntries.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`
      : '';

  // 2. Agent theme marker (the original Agent uses data-theme="light|dark" or class)
  const htmlAttrs =
    themeMode === 'dark'
      ? ' class="agentskin-raw-dark" data-theme="dark"'
      : ' class="agentskin-raw-light" data-theme="light"';

  let bodyHtml = '';
  if (domTree) {
    bodyHtml = renderDomNode(domTree);
  }

  // 3. Stylesheet assembly order:
  //    a) native :root vars
  //    b) external <link> resolved stylesheets (so var() and class rules resolve)
  //    c) inline <style> blocks captured from the live DOM
  const blocks: string[] = [];
  if (rootVarCss) blocks.push(`<style data-origin="native-vars">\n${rootVarCss}\n</style>`);
  for (const [href, text] of Object.entries(externalSheets)) {
    blocks.push(`<style data-origin="${escapeAttr(href)}">\n${text}\n</style>`);
  }
  for (const idx in inlineStyleBlocks) {
    blocks.push(`<style data-origin="inline-${idx}">\n${inlineStyleBlocks[idx]}\n</style>`);
  }

  return `<!DOCTYPE html>
<html${htmlAttrs}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Raw Preview — ${themeMode}</title>
<style data-origin="resets">
 *, *::before, *::after { box-sizing: border-box; }
 html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
 body { background: var(--bg, var(--color-background, #fff)); }
</style>
${blocks.join('\n')}
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// ===========================================================================
// Public component
// ===========================================================================

export function AgentRawPreview(props: AgentRawPreviewProps) {
  const { domTree, scale = 1 } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  const srcDoc = useMemo(() => {
    try {
      return buildSrcDoc({
        domTree: props.domTree,
        rootVars: props.rootVars,
        inlineStyleBlocks: props.inlineStyleBlocks,
        externalSheets: props.externalSheets,
        themeMode: props.themeMode,
      });
    } catch (e) {
      console.error('[AgentRawPreview] build failed:', e);
      return '<html><body>Failed to render preview</body></html>';
    }
  }, [
    props.domTree,
    props.rootVars,
    props.inlineStyleBlocks,
    props.externalSheets,
    props.themeMode,
  ]);

  // srcDoc approach is synchronous and self-contained — no postMessage bridge needed.
  useEffect(() => {
    setReady(true);
  }, []);

  if (!domTree) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center text-white/50 font-mono text-xs">
        NO DOM DATA AVAILABLE — RUN CDP EXTRACT FIRST
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <iframe
        ref={iframeRef}
        title="agent-raw-preview"
        srcDoc={srcDoc}
        sandbox="allow-same-origin"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          borderRadius: '2px',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
        data-ready={ready}
      />
    </div>
  );
}

// ===========================================================================
// Dual-theme side-by-side component
// ===========================================================================

export interface AgentRawDualPreviewProps {
  domLight: DomTreeNode | null;
  domDark: DomTreeNode | null;
  rootVarsLight: Record<string, string>;
  rootVarsDark: Record<string, string>;
  inlineStyleBlocks?: string[];
  externalSheets?: Record<string, string>;
  scale?: number;
}

export function AgentRawDualPreview(props: AgentRawDualPreviewProps) {
  const {
    domLight,
    domDark,
    rootVarsLight,
    rootVarsDark,
    inlineStyleBlocks,
    externalSheets,
    scale = 0.6,
  } = props;
  const [mode, setMode] = useState<'light' | 'dark' | 'split'>('dark');

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {/* Mode toggle */}
      <div className="flex shrink-0 items-center gap-1.5 rounded-[2px] border border-white/[0.06] bg-[#0f0f14] p-1.5">
        {(['dark', 'light', 'split'] as const).map((m) => (
          <button
            type="button"
            key={m}
            onClick={() => setMode(m)}
            className={`h-5 rounded-[2px] px-2 font-mono text-[9px] uppercase transition-colors ${
              mode === m ? 'bg-[#FF453A] text-white' : 'text-white/60 hover:bg-white/[0.04]'
            }`}
          >
            {m}
          </button>
        ))}
        <span className="ml-auto font-mono text-[8.5px] text-white/30">
          raw native · {mode.toUpperCase()}
        </span>
      </div>

      {/* Previews */}
      <div className={`grid flex-1 gap-2 ${mode === 'split' ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {(mode === 'split' || mode === 'dark') && (
          <AgentRawPreview
            domTree={domDark}
            rootVars={rootVarsDark}
            inlineStyleBlocks={inlineStyleBlocks}
            externalSheets={externalSheets}
            themeMode="dark"
            scale={scale}
          />
        )}
        {(mode === 'split' || mode === 'light') && (
          <AgentRawPreview
            domTree={domLight}
            rootVars={rootVarsLight}
            inlineStyleBlocks={inlineStyleBlocks}
            externalSheets={externalSheets}
            themeMode="light"
            scale={scale}
          />
        )}
      </div>
    </div>
  );
}
