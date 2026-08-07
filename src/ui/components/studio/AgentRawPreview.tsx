// SPDX-License-Identifier: MPL-2.0

/**
 * Agent Raw Preview — rebuild an Agent's original visuals inside an isolated iframe.
 *
 * Input:  the compact DOM tree captured by CDP plus the native root CSS variables for
 *         a given light / dark scheme.
 * Output: an iframe whose srcDoc renders every node with its captured inline style and
 *         a synthesized stylesheet (:root { --native-vars } + captured inline <style>
 *         blocks). The result is a pixel-identical soft-reconstruction of the Agent's
 *         original UI that the user can switch between light / dark at the click of a tab.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

// ===========================================================================
// Types (mirror agents-profiles/*-profile.json > dom.samples.*)
// ===========================================================================

export interface CompactDomNode {
  t: string; // tag
  d: number; // depth
  c?: string; // class string (truncated <= 120 by extractor)
  i?: string; // id
  r?: string; // aria role
  m?: string; // theme / data-theme
  x?: string; // leaf text
  s?: Record<string, string>; // captured computed-style subset
  ch?: CompactDomNode[]; // children
}

export interface AgentRawPreviewProps {
  /** Compacted DOM tree as returned by the CDP full-extract runtime. */
  domTree: CompactDomNode | null;
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
// Captured computed-style key -> CSS property mapping
// ===========================================================================

const STYLE_KEY_MAP: Record<string, string> = {
  bg: 'background-color',
  fg: 'color',
  bc: 'border-color',
  br: 'border-radius',
  bs: 'box-shadow',
  ff: 'font-family',
  fs: 'font-size',
  fw: 'font-weight',
  p: 'padding',
  mg: 'margin',
  gap: 'gap',
  dp: 'display',
  pos: 'position',
  op: 'opacity',
  flt: 'filter',
  bdf: 'backdrop-filter',
  tr: 'transition',
};

// ===========================================================================
// Recursive DOM reconstruction → raw HTML string
// ===========================================================================

function buildInlineStyle(s?: Record<string, string>): string {
  if (!s) return '';
  const parts: string[] = [];
  for (const [k, v] of Object.entries(s)) {
    const prop = STYLE_KEY_MAP[k];
    if (!prop) continue;
    // Treat `background-color: transparent` from the extractor as "no opacity override" —
    // we still emit it because the Agent's original was transparent.
    parts.push(`${prop}: ${v}`);
  }
  return parts.join('; ');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderNode(node: CompactDomNode): string {
  const tag = escapeHtml(node.t || 'div');
  const cls = node.c ? ` class="${escapeHtml(node.c)}"` : '';
  const id = node.i ? ` id="${escapeHtml(node.i)}"` : '';
  const role = node.r ? ` role="${escapeHtml(node.r)}"` : '';
  const dataTheme = node.m ? ` data-theme="${escapeHtml(node.m)}"` : '';
  const style =
    node.s && Object.keys(node.s).length > 0 ? ` style="${buildInlineStyle(node.s)}"` : '';

  // Self-closing tags
  const voidTags = new Set([
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
  if (voidTags.has(tag)) {
    return `<${tag}${id}${cls}${role}${dataTheme}${style}>`;
  }

  let children = '';
  if (node.ch && node.ch.length > 0) {
    children = node.ch.map(renderNode).join('');
  } else if (node.x) {
    children = escapeHtml(node.x);
  }

  return `<${tag}${id}${cls}${role}${dataTheme}${style}>${children}</${tag}>`;
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
    bodyHtml = `${renderNode(domTree)}`;
  }

  // 3. Stylesheet assembly order:
  //    a) native :root vars
  //    b) external <link> resolved stylesheets (so var() and class rules resolve)
  //    c) inline <style> blocks captured from the live DOM
  const blocks: string[] = [];
  if (rootVarCss) blocks.push(`<style data-origin="native-vars">\n${rootVarCss}\n</style>`);
  for (const [href, text] of Object.entries(externalSheets)) {
    blocks.push(`<style data-origin="${escapeHtml(href)}">\n${text}\n</style>`);
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
  const { domTree, rootVars, scale = 1 } = props;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);

  const srcDoc = useMemo(() => {
    try {
      return buildSrcDoc(props);
    } catch (e) {
      console.error('[AgentRawPreview] build failed:', e);
      return '<html><body>Failed to render preview</body></html>';
    }
  }, [props.inlineStyleBlocks, props.externalSheets, props.themeMode, props]);

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
  domLight: CompactDomNode | null;
  domDark: CompactDomNode | null;
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

// Convenience helper — given a raw-extract-style rootVars object, strip out
// entries whose value is clearly non-color (line-heights, durations, numbers).
export function filterColorVars(vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (!v) continue;
    // Skip pure numbers, dimensions, calculations
    if (/^[\d.]+(px|rem|em|%|s|ms|vh|vw)?$/.test(v)) continue;
    if (
      /^(inherit|initial|unset|none|auto|normal|transparent|currentColor|visible|hidden)$/i.test(v)
    )
      continue;
    if (/^calc\(/.test(v)) continue;
    // Skip box-shadow values that look like "none var(...)"
    if (/^none\s+var\(/.test(v)) continue;
    // Keep anything that looks like it has color info
    if (/#|rgb|hsl|oklch|color-mix|--/.test(v)) {
      out[k] = v;
    }
  }
  return out;
}
