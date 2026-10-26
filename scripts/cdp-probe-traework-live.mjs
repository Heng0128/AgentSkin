// SPDX-License-Identifier: MPL-2.0
// Live CDP probe for TRAE SOLO CN — comprehensive data extraction
import { writeFileSync } from 'node:fs';

const PORTS = [9222, 50063, 65222, 9223, 9224, 9225];
const OUTPUT =
  'C:\\Users\\snowb\\Desktop\\work\\desktop-main\\test-output\\traework-live-probe.json';

function log(...args) {
  console.log('[probe]', ...args);
}

async function tryConnect(port) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json`, {
      signal: AbortSignal.timeout(3000),
    });
    const targets = await resp.json();
    return { port, ok: true, targets };
  } catch (e) {
    return { port, ok: false, error: e.message };
  }
}

async function tryVersion(port) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(3000),
    });
    const ver = await resp.json();
    return { port, ok: true, version: ver };
  } catch (e) {
    return { port, ok: false, error: e.message };
  }
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
  }
  static async connect(url) {
    const c = new CDP(new WebSocket(url));
    await new Promise((res, rej) => {
      c.ws.addEventListener('open', res, { once: true });
      c.ws.addEventListener('error', () => rej(new Error('WS open failed')), { once: true });
      setTimeout(() => rej(new Error('WS timeout')), 8000);
    });
    c.ws.addEventListener('message', (e) => c.#onMsg(e.data));
    return c;
  }
  #onMsg(raw) {
    try {
      const m = JSON.parse(raw);
      if (m.id != null && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message || JSON.stringify(m.error))) : res(m.result);
      }
    } catch {}
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`timeout:${method}`));
        }
      }, 20000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function probePage(port, page) {
  const result = {
    port,
    targetInfo: { title: page.title, url: page.url, id: page.id, type: page.type },
    dom: null,
    cssText: null,
    dataTestIds: null,
    ids: null,
    styleSheets: null,
    bodyClass: null,
    htmlPreview: null,
    csp: null,
    matchTarget: null,
    errors: [],
  };

  let client;
  try {
    client = await CDP.connect(page.webSocketDebuggerUrl);
  } catch (e) {
    result.errors.push(`WS connect failed: ${e.message}`);
    return result;
  }

  try {
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Network.enable');
  } catch (e) {
    result.errors.push(`Enable domains failed: ${e.message}`);
  }

  // 1. HTML preview
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML.slice(0, 2000)',
      returnByValue: true,
    });
    result.htmlPreview = r.result?.value || null;
  } catch (e) {
    result.errors.push(`HTML preview: ${e.message}`);
  }

  // 2. Body class
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: 'document.body.className',
      returnByValue: true,
    });
    result.bodyClass = r.result?.value || null;
  } catch (e) {
    result.errors.push(`Body class: ${e.message}`);
  }

  // 3. CSS text (computed style on documentElement)
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: 'getComputedStyle(document.documentElement).cssText.slice(0, 3000)',
      returnByValue: true,
    });
    result.cssText = r.result?.value || null;
  } catch (e) {
    result.errors.push(`CSS text: ${e.message}`);
  }

  // 4. data-testid list
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `Array.from(new Set(Array.from(document.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid'))))`,
      returnByValue: true,
    });
    result.dataTestIds = r.result?.value || [];
  } catch (e) {
    result.errors.push(`data-testid: ${e.message}`);
  }

  // 5. id list
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `Array.from(document.querySelectorAll('[id]')).map(el => el.id).filter(Boolean).slice(0, 100)`,
      returnByValue: true,
    });
    result.ids = r.result?.value || [];
  } catch (e) {
    result.errors.push(`ids: ${e.message}`);
  }

  // 6. StyleSheets
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `JSON.stringify(Array.from(document.styleSheets).map(s => ({
        href: s.href || null,
        ownerNode: s.ownerNode ? (s.ownerNode.tagName + (s.ownerNode.id ? '#'+s.ownerNode.id : '') + (s.ownerNode.className ? '.'+s.ownerNode.className.split(' ').join('.') : '')) : null,
        ruleCount: s.cssRules ? s.cssRules.length : -1,
        disabled: s.disabled,
        media: s.media ? s.media.mediaText : null
      })).slice(0, 50))`,
      returnByValue: true,
    });
    result.styleSheets = JSON.parse(r.result?.value || '[]');
  } catch (e) {
    result.errors.push(`styleSheets: ${e.message}`);
  }

  // 7. CSS variables on :root
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const cs = getComputedStyle(document.documentElement);
        const all = [];
        const agentskin = [];
        const vscode = [];
        const icube = [];
        const other = [];
        for (let i = 0; i < cs.length; i++) {
          const name = cs[i];
          if (!name.startsWith('--')) continue;
          const val = cs.getPropertyValue(name).trim();
          const entry = { name, value: val.length > 200 ? val.slice(0, 200) + '...' : val };
          all.push(entry);
          if (name.startsWith('--agentskin-')) agentskin.push(entry);
          else if (name.startsWith('--vscode-')) vscode.push(entry);
          else if (name.startsWith('--icube-') || name.startsWith('--prop-')) icube.push(entry);
          else other.push(entry);
        }
        return JSON.stringify({ total: all.length, agentskin, vscode: vscode.slice(0,50), icube, other: other.slice(0,30), vscodeCount: vscode.length, otherCount: other.length });
      })()`,
      returnByValue: true,
    });
    result.cssVariables = JSON.parse(r.result?.value || '{}');
  } catch (e) {
    result.errors.push(`cssVariables: ${e.message}`);
  }

  // 8. matchTarget pattern verification
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const url = window.location.href;
        const bodyCls = document.body.className || '';
        const patterns = ['*/solo-lite.*', 'solo-lite', 'trae', 'traework'];
        return JSON.stringify({
          url,
          bodyCls,
          matches: patterns.filter(p => {
            if (p.startsWith('*/') && p.endsWith('.*')) {
              const mid = p.slice(2, -2);
              return url.includes(mid) || mid.split('.').some(s => url.includes(s));
            }
            return bodyCls.includes(p.toLowerCase()) || url.toLowerCase().includes(p.toLowerCase());
          })
        });
      })()`,
      returnByValue: true,
    });
    result.matchTarget = JSON.parse(r.result?.value || '{}');
  } catch (e) {
    result.errors.push(`matchTarget: ${e.message}`);
  }

  // 9. CSP headers
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || 'NO_CSP_META'`,
      returnByValue: true,
    });
    result.csp = r.result?.value || null;
  } catch (e) {
    result.errors.push(`CSP: ${e.message}`);
  }

  // 10. DOM structure snapshot
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const result = [];
        function walk(el, depth) {
          if (depth > 4 || result.length > 40) return;
          const cls = typeof el.className === 'string' ? el.className : '';
          const id = el.id || null;
          const tag = el.tagName?.toLowerCase();
          const role = el.getAttribute('role') || null;
          const testid = el.getAttribute('data-testid') || null;
          const traeRef = el.getAttribute('data-trae-ref') || null;
          result.push({ tag, id, cls: cls.slice(0,100), role, testid, traeRef, depth });
          for (const child of el.children) walk(child, depth+1);
        }
        walk(document.documentElement, 0);
        return JSON.stringify(result);
      })()`,
      returnByValue: true,
    });
    result.dom = JSON.parse(r.result?.value || '[]');
  } catch (e) {
    result.errors.push(`DOM walk: ${e.message}`);
  }

  client.close();
  return result;
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════
log('TRAE SOLO CN Live CDP Probe');
log('='.repeat(60));

// Find a live port
let connected = null;
for (const port of PORTS) {
  log(`Trying port ${port}...`);
  const r = await tryConnect(port);
  if (r.ok) {
    log(`  → Connected! Found ${r.targets.length} targets`);
    connected = r;
    break;
  } else {
    log(`  → ${r.error}`);
  }
}

if (!connected) {
  // Try scanning ports 9220-9230
  for (let p = 9220; p <= 9230; p++) {
    if (PORTS.includes(p)) continue;
    const r = await tryConnect(p);
    if (r.ok) {
      log(`  → Found CDP on port ${p}! (${r.targets.length} targets)`);
      connected = r;
      break;
    }
  }
}

const report = {
  timestamp: new Date().toISOString(),
  agent: 'traework',
  agentName: 'TRAE SOLO CN',
  connection: null,
  version: null,
  allTargets: null,
  pageProbe: null,
};

if (!connected) {
  report.connection = { status: 'offline', error: 'No CDP endpoint found on any scanned port' };
  log('\n✗ TRAE SOLO CN is not running. No CDP endpoint found.');
} else {
  report.connection = { status: 'connected', port: connected.port };

  // Get version
  const ver = await tryVersion(connected.port);
  if (ver.ok) report.version = ver.version;

  // All targets
  report.allTargets = connected.targets.map((t) => ({
    type: t.type,
    title: t.title,
    url: t.url.slice(0, 200),
    id: t.id,
  }));

  // Find main solo-lite page
  const soloPage = connected.targets.find(
    (t) =>
      t.type === 'page' &&
      (t.url.includes('solo-lite') || t.url.includes('solo')) &&
      !t.url.includes('devtools') &&
      !t.url.includes('chrome'),
  );

  const anyPage =
    soloPage || connected.targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);

  if (anyPage) {
    log(`\nProbing page: ${anyPage.title} (${anyPage.url.slice(0, 100)})`);
    report.pageProbe = await probePage(connected.port, anyPage);
    log(`  DOM elements: ${report.pageProbe.dom?.length || 0}`);
    log(`  data-testids: ${report.pageProbe.dataTestIds?.length || 0}`);
    log(`  ids: ${report.pageProbe.ids?.length || 0}`);
    log(`  styleSheets: ${report.pageProbe.styleSheets?.length || 0}`);
    log(`  CSS variables total: ${report.pageProbe.cssVariables?.total || 0}`);
    log(`  CSS variables agentskin: ${report.pageProbe.cssVariables?.agentskin?.length || 0}`);
  } else {
    log('No suitable page target found');
  }
}

// Write output
writeFileSync(OUTPUT, JSON.stringify(report, null, 2));
log(`\n✓ Report written to: ${OUTPUT}`);
