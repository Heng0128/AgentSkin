// SPDX-License-Identifier: MPL-2.0
//
// # probe-engine shared library (integrated, 2026-09-08)
//
// ONE home for live CDP verification, six DEEPLY-PER-ENGINE probes.
// Consolidates what used to be scattered across scripts/cdp-probe-*.mjs,
// scripts/analyze-structure-compare/runtime-probe.mjs, scripts/cdp-full-extract
// and this folder: every probe now verifies FOUR anchor sources per engine —
//
//   A. scripts/anchors/index.mjs   — precise role→selector registry (PROBE-DATE
//                                    2026-08-23 build numbers); drift detector:
//                                    registry-verified anchor now zero → DRIFT.
//   B. scripts/lib/landmarks/<id>  — required/recommended landmark selectors.
//   C. engines/<id>/selectors.contract.json — contract entries with status.
//   D. engines/<id>/*.{mjs,css}    — full extraction of every DOM anchor the
//                                    engine files actually reference.
//
// Plus per-engine (config): identity page classification, appearance reader,
// token-surface expectations, structural assertions, view-coverage hints, and
// a version fingerprint (UA/title/meta appVersion) so "app updated" is visible.
//
// Read-only: never clicks, never reads text content.
// Usage: node scripts/probe-engine/<engine>.mjs --port <cdpPort> [--json]

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCHORS } from '../anchors/index.mjs';
import { getLandmarksForAdapter } from '../lib/landmarks/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');

export function getArg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export async function listTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  if (!res.ok) throw new Error(`/json → HTTP ${res.status}`);
  return res.json();
}

export function cdpEval(wsUrl, expression, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('CDP timeout'));
    }, timeoutMs);
    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true },
        }),
      );
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) {
        clearTimeout(t);
        ws.close();
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result?.result?.value);
      }
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error('WebSocket error'));
    };
  });
}

/** Split a selector list on TOP-LEVEL commas only (never inside (), [], quotes). */
function splitSelectorList(sel) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of String(sel)) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// ── Source D: engine-file extraction (typed anchors) ──────────────────────
const NOISE = new Set([
  'mjs',
  'css',
  'js',
  'ts',
  'json',
  'dll',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'svg',
  'woff',
  'woff2',
  'html',
  'htm',
  'md',
  'txt',
  'xml',
  'yaml',
  'yml',
  'toml',
  'lock',
  'map',
  'set',
  'push',
  'join',
  'split',
  'slice',
  'round',
  'floor',
  'ceil',
  'abs',
  'min',
  'max',
  'key',
  'keys',
  'value',
  'values',
  'entries',
  'startswith',
  'endswith',
  'includes',
  'indexof',
  'tolowercase',
  'touppercase',
  'trim',
  'test',
  'exec',
  'replace',
  'match',
  'matchall',
  'filter',
  'find',
  'some',
  'every',
  'reduce',
  'foreach',
  'length',
  'size',
  'name',
  'type',
  'id',
  'class',
  'classname',
  'style',
  'href',
  'src',
  'title',
  'body',
  'main',
  'html',
  'document',
  'window',
  'element',
  'el',
  'node',
  'children',
  'parent',
  'parentelement',
  'firstchild',
  'lastchild',
  'nextsibling',
  'dataset',
  'prototype',
  'constructor',
  'call',
  'apply',
  'bind',
  'then',
  'catch',
  'finally',
  'resolve',
  'reject',
  'all',
  'race',
  'stringify',
  'parse',
  'queryselector',
  'queryselectorall',
  'getelementbyid',
  'getelementsbyclassname',
  'getcomputedstyle',
  'createelement',
  'appendchild',
  'removechild',
  'remove',
  'insertbefore',
  'setattribute',
  'getattribute',
  'removeattribute',
  'hasattribute',
  'addeventlistener',
  'removeeventlistener',
  'dispatchevent',
  'width',
  'height',
  'left',
  'right',
  'top',
  'bottom',
  'color',
  'background',
  'border',
  'radius',
  'padding',
  'margin',
  'gap',
  'display',
  'position',
  'opacity',
  'transform',
  'transition',
  'animation',
  'duration',
  'delay',
  'count',
  'index',
  'data',
  'item',
  'items',
  'list',
  'group',
  'groups',
  'user',
  'users',
  'app',
  'apps',
  'state',
  'props',
  'context',
  'config',
  'options',
  'params',
  'args',
  'result',
  'results',
  'response',
  'request',
  'error',
  'errors',
  'success',
  'warning',
  'info',
  'debug',
  'log',
  'warn',
  'trace',
  'time',
  'date',
  'now',
  'random',
  'math',
  'number',
  'string',
  'boolean',
  'object',
  'array',
  'null',
  'undefined',
  'true',
  'false',
  'nan',
  'message',
  'messages',
  'active',
  'selector',
  'sel',
  'propertyset',
  'getpropertyvalue',
  'prepend',
  'semantictextscope',
  'bg_layer_class',
  'starts',
  'ends',
]);
const OWNED = [/^agentskin-/i, /^data-agentskin-/i, /^dream-/i, /^ag-/i, /^--agentskin-/, /^--ag-/];
const GENERIC_ATTRS = new Set([
  'class',
  'data-testid',
  'role',
  'style',
  'href',
  'title',
  'type',
  'id',
  'hidden',
  'placeholder',
  'disabled',
  'checked',
  'value',
  'src',
  'alt',
  'target',
  'content',
  'http-equiv',
  'aria-label',
  'aria-hidden',
  'aria-selected',
  'aria-expanded',
  'aria-describedby',
  'aria-labelledby',
  'draggable',
  'tabindex',
]);
const isOwned = (a) => OWNED.some((re) => re.test(a));

function stringsFromMjs(src) {
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const out = [];
  for (const m of noComments.matchAll(/'([^'\\\n]{2,})'|"([^"\\\n]{2,})"|`([^`\\]{2,})`/g))
    out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
function extractTyped(text, sink) {
  for (const m of text.matchAll(/\.((?:[\w-]|\\\/)+)/g)) {
    const a = m[1];
    if (/^[0-9]/.test(a) || NOISE.has(a.toLowerCase()) || isOwned(a)) continue;
    sink.add('class:' + a);
  }
  for (const m of text.matchAll(/\[class[*^$|~]?="([^"]+)"/g)) sink.add('sub:' + m[1]);
  for (const m of text.matchAll(/\[data-testid="([^"]+)"/g)) sink.add('testid:' + m[1]);
  for (const m of text.matchAll(/\[([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*"[^"]*")?\]/g)) {
    const n = m[1].toLowerCase();
    if (GENERIC_ATTRS.has(n) || (!n.startsWith('data-') && !n.startsWith('aria-')) || isOwned(n))
      continue;
    sink.add('attr:' + n);
  }
}
export function extractEngineAnchors(engine) {
  const files = [
    `engines/${engine}/adapter-config.mjs`,
    `engines/${engine}/adapter.mjs`,
    `engines/${engine}/cosmetic.css`,
  ];
  const sink = new Set();
  for (const f of files) {
    let src;
    try {
      src = readFileSync(path.join(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    if (f.endsWith('.css')) {
      const selectors = src
        .split('}')
        .map((c) => c.split('{')[0])
        .join('{');
      extractTyped(selectors, sink);
    } else for (const s of stringsFromMjs(src)) extractTyped(s, sink);
  }
  return [...sink].filter((a) => {
    const i = a.indexOf(':');
    const v = a.slice(i + 1);
    return v.length > 3 && !v.includes('(') && !v.includes(' ');
  });
}
function typedToSelector(anchor) {
  const i = anchor.indexOf(':');
  const kind = anchor.slice(0, i);
  const val = anchor.slice(i + 1);
  switch (kind) {
    case 'sub':
      return `[class*="${val}"]`;
    case 'class':
      return `.${val.replace(/\//g, '\\/')}`;
    case 'testid':
      return `[data-testid="${val}"]`;
    case 'attr':
      return `[${val}]`;
    default:
      return anchor;
  }
}

// ── probe program builder ──────────────────────────────────────────────────
function buildProgram(selectors, tokenNames, appearanceJs, assertionJs) {
  return `(function(){
    var out = { fingerprint: {
        ua: navigator.userAgent.slice(0,160),
        title: (document.title||'').slice(0,60),
        metaAppVersion: (document.querySelector('meta[name="appVersion"]')||{}).content || null
      }, hits: {}, tokens: {}, appearance: null, assertions: {} };
    var S = ${JSON.stringify(selectors)};
    for (var i = 0; i < S.length; i++) {
      try { out.hits[S[i][0]] = document.querySelectorAll(S[i][1]).length; }
      catch (e) { out.hits[S[i][0]] = 'ERR'; }
    }
    var declared = {};
    function scan(rules){ for (var r of rules) { try {
      if (r.style) for (var p of r.style) if (p.indexOf('--')===0) declared[p]=1;
      if (r.cssRules) scan(r.cssRules);
    } catch(e){} } }
    try { for (var s of document.styleSheets) if (s.cssRules) scan(s.cssRules); } catch(e){}
    try { for (var s of (document.adoptedStyleSheets||[])) if (s.cssRules) scan(s.cssRules); } catch(e){}
    for (var t of ${JSON.stringify(tokenNames)}) out.tokens[t] = !!declared[t];
    out.appearance = (${appearanceJs});
    var A = ${JSON.stringify(assertionJs)};
    for (var k in A) { try { out.assertions[k] = String(eval(A[k])); } catch(e) { out.assertions[k] = 'ERR:' + e.message; } }
    return out;
  })()`;
}

/**
 * @param {string} engine
 * @param {{
 *   classifyPage: (url:string)=>'main'|'secondary'|'shell'|'skip',
 *   appearanceJs: string,
 *   tokenExpect: Array<{name:string,expect:'present'|'absent',why?:string}>,
 *   assertions: Array<{name:string,js:string,expect:string,why?:string}>,
 *   viewHints: Array<{view:string,how:string,keys:string[]}>,
 * }} config
 */
export async function runProbe(engine, config) {
  const port = Number(getArg('port'));
  if (!port) {
    console.error(`usage: node scripts/probe-engine/${engine}.mjs --port <cdpPort> [--json]`);
    process.exit(2);
  }

  // ── assemble the four anchor sources ──
  const probes = []; // [label, selector]
  const srcOf = {}; // label → source tag
  const anchors = ANCHORS[engine] || {};
  for (const [role, sel] of Object.entries(anchors)) {
    const variants = splitSelectorList(sel);
    const label = `A:${role}`;
    probes.push([label, variants[0]]);
    srcOf[label] = 'anchors-registry';
    for (const alt of variants.slice(1)) {
      const l = `A:${role}:${alt}`;
      probes.push([l, alt]);
      srcOf[l] = 'anchors-registry';
    }
  }
  const lm = getLandmarksForAdapter(engine);
  for (const group of [...(lm?.required ?? []), ...(lm?.recommended ?? [])]) {
    for (const one of group.selectors) {
      const l = `B:${group.name}:${one}`;
      probes.push([l, one]);
      srcOf[l] = 'landmarks';
    }
  }
  const contractPath = path.join(ROOT, 'engines', engine, 'selectors.contract.json');
  let contract = { selectors: [] };
  try {
    contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  } catch {
    /* engine without contract yet */
  }
  const contractEntries = contract.selectors.filter((e) => e.status !== 'removed');
  for (const e of contractEntries) {
    for (const a of e.anchors) {
      let variants;
      if (a.startsWith('[') || a.startsWith('.') || a.startsWith(':')) variants = [[a, a]];
      else if (e.anchorType === 'testid') variants = [[`testid=${a}`, `[data-testid="${a}"]`]];
      else if (e.anchorType === 'attr' || a.startsWith('data-') || a.startsWith('aria-'))
        variants = [[`attr=${a}`, `[${a}]`]];
      else
        variants = [
          [`.${a}`, `.${a.replace(/\//g, '\\/')}`],
          [`*="${a}"`, `[class*="${a}"]`],
        ];
      for (const [lab, sel] of variants) {
        const l = `C:${e.key}:${lab}`;
        probes.push([l, sel]);
        srcOf[l] = 'contract';
      }
    }
  }
  const extracted = extractEngineAnchors(engine);
  for (const a of extracted) {
    const l = `D:${a}`;
    probes.push([l, typedToSelector(a)]);
    srcOf[l] = 'extraction';
  }

  const tokenNames = config.tokenExpect.map((t) => t.name);
  const assertionJs = Object.fromEntries(config.assertions.map((a) => [a.name, a.js]));
  const program = buildProgram(probes, tokenNames, config.appearanceJs, assertionJs);

  // ── page selection ──
  const targets = await listTargets(port);
  const pages = targets.filter(
    (t) => t.webSocketDebuggerUrl && ['page', 'iframe', 'webview'].includes(t.type),
  );
  const main = [];
  const secondary = [];
  const shells = [];
  for (const p of pages) {
    const kind = config.classifyPage(p.url || '');
    if (kind === 'main') main.push(p);
    else if (kind === 'secondary') secondary.push(p);
    else if (kind === 'shell') shells.push((p.url || '').slice(0, 80));
  }
  const probePages = [...main, ...secondary];
  if (!probePages.length) {
    console.error(
      `[${engine}] NO SAMPLEABLE PAGE on :${port}. targets:\n  ` +
        pages.map((p) => (p.url || '').slice(0, 90)).join('\n  '),
    );
    process.exit(2);
  }

  const unionHits = {};
  const unionTokens = {};
  const perPage = [];
  let assertionsResult = {};
  for (const [i, p] of probePages.entries()) {
    try {
      const r = await cdpEval(p.webSocketDebuggerUrl, program);
      perPage.push({
        url: (p.url || '').slice(0, 90),
        fingerprint: r.fingerprint,
        appearance: r.appearance,
      });
      for (const [k, v] of Object.entries(r.hits))
        if (!(k in unionHits) || (typeof v === 'number' && v > (unionHits[k] || 0)))
          unionHits[k] = v;
      for (const [k, v] of Object.entries(r.tokens)) unionTokens[k] = unionTokens[k] || v;
      if (i === 0) assertionsResult = r.assertions;
    } catch (e) {
      perPage.push({ url: (p.url || '').slice(0, 90), error: e.message });
    }
  }

  // ── verdicts + DRIFT detection ──
  const report = {
    engine,
    port,
    fingerprint: perPage[0]?.fingerprint,
    pages: perPage,
    shellsSkipped: shells,
    sources: {},
    drift: [],
    tokenVerdicts: [],
    assertionVerdicts: [],
    unsampledViews: [],
  };
  const bySource = {};
  for (const [label] of probes) {
    const src = srcOf[label];
    const hit = unionHits[label];
    const key = label.split(':')[0];
    bySource[key] ??= { alive: 0, zero: 0, items: [] };
    const alive = typeof hit === 'number' && hit > 0;
    bySource[key][alive ? 'alive' : 'zero']++;
    bySource[key].items.push({ label, hit: alive ? hit : 0 });
  }
  for (const k of Object.keys(bySource))
    bySource[k].items = bySource[k].items.filter((x) => x.hit === 0).map((x) => x.label);
  report.sources = bySource;
  for (const [role] of Object.entries(anchors)) {
    const anyAlive = Object.keys(unionHits).some(
      (l) =>
        (l === `A:${role}` || l.startsWith(`A:${role}:`)) &&
        typeof unionHits[l] === 'number' &&
        unionHits[l] > 0,
    );
    if (!anyAlive)
      report.drift.push(
        `anchors-registry role "${role}" (PROBE-DATE 2026-08-23) now ZERO — app updated? re-verify & update registry`,
      );
  }
  for (const e of contractEntries) {
    const anyAlive = Object.keys(unionHits).some(
      (l) => l.startsWith(`C:${e.key}:`) && typeof unionHits[l] === 'number' && unionHits[l] > 0,
    );
    if ((e.status === 'alive' || e.status === 'partial') && !anyAlive)
      report.drift.push(
        `contract "${e.key}" status=${e.status} now ZERO-in-sample — view-dependent or drift`,
      );
  }
  for (const t of config.tokenExpect) {
    const present = !!unionTokens[t.name];
    if ((t.expect === 'present') !== present)
      report.tokenVerdicts.push({ name: t.name, expect: t.expect, present, why: t.why || '' });
  }
  for (const a of config.assertions) {
    const got = assertionsResult[a.name];
    if (String(got) !== a.expect)
      report.assertionVerdicts.push({ name: a.name, expect: a.expect, got, why: a.why || '' });
  }
  const zeroKeys = new Set(
    contractEntries
      .filter(
        (e) =>
          !Object.keys(unionHits).some(
            (l) =>
              l.startsWith(`C:${e.key}:`) && typeof unionHits[l] === 'number' && unionHits[l] > 0,
          ),
      )
      .map((e) => e.key),
  );
  for (const vh of config.viewHints)
    if (vh.keys.some((k) => zeroKeys.has(k))) report.unsampledViews.push(vh);

  if (getArg('json')) {
    console.log(JSON.stringify(report, null, 1));
    return report;
  }
  console.log(
    `\n═══ probe ${engine} ═══ :${port} · pages=${probePages.length} · shells=${shells.length}`,
  );
  console.log(
    `  fingerprint: appVersion=${report.fingerprint?.metaAppVersion || 'n/a'} · ${report.fingerprint?.ua?.match(/Chrome\/[\d.]+/)?.[0] || ''} · "${report.fingerprint?.title || ''}"`,
  );
  for (const [key, name] of [
    ['A', 'anchors-registry'],
    ['B', 'landmarks'],
    ['C', 'contract'],
    ['D', 'extraction'],
  ]) {
    const s = report.sources[key];
    if (!s) continue;
    console.log(`  ${name}: ${s.alive}/${s.alive + s.zero} alive`);
    if (s.items.length)
      console.log(
        `    zero: ${s.items.slice(0, 14).join(', ')}${s.items.length > 14 ? ` …+${s.items.length - 14}` : ''}`,
      );
  }
  if (report.drift.length) {
    console.log(`  ⚠ DRIFT ${report.drift.length}:`);
    for (const d of report.drift) console.log('    ‼ ' + d);
  }
  if (report.tokenVerdicts.length) {
    console.log('  ✗ TOKENS unexpected:');
    for (const t of report.tokenVerdicts)
      console.log(`    ${t.name} expect=${t.expect} present=${t.present} — ${t.why}`);
  } else
    console.log(`  ✓ tokens ${config.tokenExpect.length}/${config.tokenExpect.length} as-expected`);
  if (report.assertionVerdicts.length) {
    console.log('  ✗ ASSERTIONS failed:');
    for (const a of report.assertionVerdicts)
      console.log(`    ${a.name}: expect ${a.expect}, got ${a.got} — ${a.why}`);
  } else console.log(`  ✓ assertions ${config.assertions.length}/${config.assertions.length} pass`);
  if (report.unsampledViews.length) {
    console.log('  ⚠ views to open for full coverage:');
    for (const v of report.unsampledViews) console.log(`    → ${v.view}: ${v.how}`);
  }
  return report;
}
