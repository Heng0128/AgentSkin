// SPDX-License-Identifier: MPL-2.0

import type { StudioColorSets, ToolOverride } from '@/types/override';

import type { DomTreeNode } from '@shared/types';

const VOID_TAGS = new Set([
  'img',
  'input',
  'br',
  'hr',
  'area',
  'base',
  'col',
  'embed',
  'source',
  'track',
  'wbr',
]);

/**
 * Tags allowed to be replayed into the srcdoc iframe. The DOM snapshot comes
 * from a live agent page and may contain script-carrying tags (script, iframe,
 * object, embed…). Combined with the iframe's `allow-same-origin
 * allow-scripts` sandbox, replaying those would let untrusted markup escape the
 * sandbox and reach the parent context. We allow only inert content tags.
 */
const SAFE_TAGS = new Set([
  'a',
  'abbr',
  'address',
  'article',
  'aside',
  'b',
  'bdi',
  'bdo',
  'blockquote',
  'br',
  'button',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'data',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'label',
  'legend',
  'li',
  'main',
  'mark',
  'meter',
  'nav',
  'ol',
  'optgroup',
  'option',
  'output',
  'p',
  'picture',
  'pre',
  'progress',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'section',
  'select',
  'small',
  'source',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'textarea',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'track',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
]);

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

// Attributes safe to replay into the srcdoc iframe. The DOM snapshot comes from
// a live agent page that may contain untrusted event handlers; anything else
// (on*, js: URLs, style already handled separately) is dropped so the sandboxed
// preview can't execute unexpected scripts.
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

function safeAttrs(n: DomTreeNode): string {
  if (!n.attrs) return '';
  return Object.entries(n.attrs)
    .filter(([k, v]) => isSafeAttr(k, v))
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('');
}

/** Computed-style props the toolbox can override → emitted as var(--as-*, real). */
const OVERRIDE_PROPS: Record<string, string> = {
  'border-radius': '--as-radius',
  'box-shadow': '--as-shadow',
  'backdrop-filter': '--as-blur',
  'font-size': '--as-fontsize',
  'font-family': '--as-fontfam',
  'transition-duration': '--as-duration',
  'transition-timing-function': '--as-timing',
};

function nodeStyleToCss(
  n: DomTreeNode,
  colorSets?: StudioColorSets,
  gradientAccent = false,
): string {
  const out: string[] = [];
  const pad: Record<string, string> = {};
  for (const [k, v] of Object.entries(n.style)) {
    if (k.startsWith('padding-')) {
      pad[k] = v;
      continue;
    }
    // --- role-based color rebinding (re-theme by original role) ---
    if (k === 'background-color') {
      if (colorSets?.primaryBg && v === colorSets.primaryBg) {
        out.push(`background-color: var(--as-bg, ${v})`);
        if (gradientAccent) out.push('background-image: var(--as-grad, none)');
      } else if (colorSets?.surfaceBgs.includes(v))
        out.push(`background-color: var(--as-surface, ${v})`);
      else if (colorSets?.accents.includes(v)) out.push(`background-color: var(--as-accent, ${v})`);
      else out.push(`background-color: ${v}`);
      continue;
    }
    if (k === 'color') {
      if (colorSets?.texts.includes(v)) out.push(`color: var(--as-fg, ${v})`);
      else if (colorSets?.accents.includes(v)) out.push(`color: var(--as-accent, ${v})`);
      else out.push(`color: ${v}`);
      continue;
    }
    if (k.endsWith('-color') && k !== 'color') {
      // border / outline colors: accent rebinds to --as-accent, others to
      // --as-sep (so the "显示分隔线" toggle can hide neutral dividers).
      if (colorSets?.accents.includes(v)) out.push(`${k}: var(--as-accent, ${v})`);
      else out.push(`${k}: var(--as-sep, ${v})`);
      continue;
    }
    if (k.includes('border') && k.endsWith('-width')) {
      if (parseFloat(v) > 0) out.push(`${k}: var(--as-border, ${v})`);
      else out.push(`${k}: ${v}`);
      continue;
    }
    if (k === 'line-height') {
      out.push(`line-height: var(--as-lh, ${v})`);
      continue;
    }
    const ov = OVERRIDE_PROPS[k];
    out.push(ov ? `${k}: var(${ov}, ${v})` : `${k}: ${v}`);
  }
  // spacing override collapses all padding sides into one var-aware shorthand
  if (pad['padding-top'] || pad['padding-right'] || pad['padding-bottom'] || pad['padding-left']) {
    const t = pad['padding-top'] || '0px';
    const r = pad['padding-right'] || '0px';
    const b = pad['padding-bottom'] || '0px';
    const l = pad['padding-left'] || '0px';
    out.push(`padding: var(--as-spacing, ${t} ${r} ${b} ${l})`);
  }
  return out.join('; ');
}

export function nodeToHtml(
  n: DomTreeNode,
  colorSets?: StudioColorSets,
  gradientAccent = false,
): string {
  // Drop any tag not on the SAFE_TAGS allowlist (script, iframe, object,
  // embed, link, meta, style, …). These carry script/trust boundaries and
  // must never be replayed into the sandboxed srcdoc. The node's children
  // are still walked so a blocked wrapper doesn't silently hide nested nodes.
  if (!SAFE_TAGS.has(n.tag.toLowerCase())) {
    return n.children.map((c) => nodeToHtml(c, colorSets, gradientAccent)).join('');
  }
  const style = nodeStyleToCss(n, colorSets, gradientAccent);
  const cls = n.cls ? ` class="${escapeAttr(n.cls)}"` : '';
  const styleAttr = style ? ` style="${escapeAttr(style)}"` : '';
  const attrs = safeAttrs(n);
  const tag = n.tag.toLowerCase();
  if (VOID_TAGS.has(tag)) {
    const src =
      n.imgSrc && !/^\s*(javascript|vbscript|data:text\/html)/i.test(n.imgSrc)
        ? ` src="${escapeAttr(n.imgSrc)}"`
        : '';
    return `<${tag}${cls}${styleAttr}${attrs}${src}>`;
  }
  const text = n.text ? escapeHtml(n.text) : '';
  const children = n.children.map((c) => nodeToHtml(c, colorSets, gradientAccent)).join('');
  return `<${tag}${cls}${styleAttr}${attrs}>${text}${children}</${tag}>`;
}

function shadowCssFromLevel(level?: ToolOverride['shadowLevel']): string {
  switch (level) {
    case 'sm':
      return '0 1px 2px rgba(0,0,0,.18)';
    case 'md':
      return '0 4px 12px rgba(0,0,0,.22)';
    case 'lg':
      return '0 8px 24px rgba(0,0,0,.28)';
    case 'xl':
      return '0 16px 40px rgba(0,0,0,.34)';
    default:
      return 'none';
  }
}

export function overridesToCss(o: ToolOverride | null): string {
  if (!o) return '';
  const root: string[] = [];
  const extra: string[] = [];
  if (o.radius) root.push(`--as-radius: ${o.radius}`);
  if (typeof o.spacing === 'number') root.push(`--as-spacing: ${o.spacing}px`);
  if (o.shadowLevel) root.push(`--as-shadow: ${shadowCssFromLevel(o.shadowLevel)}`);
  if (typeof o.blurPx === 'number') root.push(`--as-blur: blur(${o.blurPx}px)`);
  if (typeof o.fontSize === 'number') root.push(`--as-fontsize: ${o.fontSize}px`);
  if (o.fontFam) root.push(`--as-fontfam: ${o.fontFam}`);
  if (o.duration) root.push(`--as-duration: ${o.duration}`);
  if (o.timing) root.push(`--as-timing: ${o.timing}`);
  // color (role-rebound in nodeStyleToCss)
  if (o.accent) root.push(`--as-accent: ${o.accent}`);
  if (o.background) root.push(`--as-bg: ${o.background}`);
  if (o.foreground) root.push(`--as-fg: ${o.foreground}`);
  if (o.surface) root.push(`--as-surface: ${o.surface}`);
  // gradient accent background (bakeable)
  if (o.gradientAccent) {
    root.push(
      '--as-grad: linear-gradient(135deg, var(--as-accent, #3b82f6) 0%, var(--as-bg, #ffffff) 72%)',
    );
    extra.push('html,body{background-image:var(--as-grad,none)}');
  }
  // structure
  if (typeof o.borderWidth === 'number') root.push(`--as-border: ${o.borderWidth}px`);
  if (typeof o.lineHeight === 'number') root.push(`--as-lh: ${o.lineHeight}`);
  if (o.separators === false) root.push(`--as-sep: transparent`);
  // layout / filter (preview-only)
  if (typeof o.scale === 'number' && o.scale !== 1)
    extra.push(`body{transform:scale(${o.scale});transform-origin:top left}`);
  const filters: string[] = [];
  if (o.invert) filters.push('invert(1) hue-rotate(180deg)');
  if (typeof o.contrast === 'number' && o.contrast !== 1) filters.push(`contrast(${o.contrast})`);
  if (typeof o.saturate === 'number' && o.saturate !== 1) filters.push(`saturate(${o.saturate})`);
  if (filters.length) extra.push(`html{filter:${filters.join(' ')}}`);
  // visual effects (P0-1): darkening overlay + body opacity
  if (typeof o.dim === 'number' && o.dim > 0) {
    extra.push(
      `body::before{content:"";position:fixed;inset:0;background:rgba(0,0,0,${o.dim});pointer-events:none;z-index:99999}`,
    );
  }
  if (typeof o.opacity === 'number' && o.opacity < 1) {
    extra.push(`body{opacity:${o.opacity}}`);
  }

  const blocks: string[] = [];
  if (root.length) blocks.push(`:root{${root.join(';')}}`);
  blocks.push(...extra);
  return blocks.join('');
}

export function buildSrcDoc(
  domTree: DomTreeNode | undefined,
  colorSets: StudioColorSets | undefined,
  gradientAccent: boolean,
  fallbackHtml: string,
): string {
  const body = domTree ? nodeToHtml(domTree, colorSets, gradientAccent) : fallbackHtml;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<style>html,body{margin:0}*{box-sizing:border-box}' +
    'img{max-width:100%}a{color:inherit;text-decoration:none}</style>' +
    '<style id="ov"></style>' +
    '<script>(function(){window.addEventListener("message",function(e){' +
    'if(e.data&&e.data.type==="as-ov"){var s=document.getElementById("ov");' +
    'if(s)s.textContent=e.data.css;}});})();</script>' +
    `</head><body>${body}</body></html>`
  );
}
