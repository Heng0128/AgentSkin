// Probe TraeWork CN live DOM via CDP for the 3 unresolved theme zones:
// (1) sidebar divider shadow, (2) conversation round thumbnail icons' bg/shadow,
// (3) dialog / quick-input that still uses native host theme colors.
// Usage: node scripts/probe-traework-live.mjs <port>
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '56211';

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const c = new CDP(new WebSocket(url));
    await new Promise((res, rej) => {
      c.ws.addEventListener('open', res, { once: true });
      c.ws.addEventListener('error', () => rej(new Error('WS open failed')), { once: true });
    });
    c.ws.addEventListener('message', (e) => c.#onMsg(e.data));
    return c;
  }
  #onMsg(raw) {
    const m = JSON.parse(raw);
    if (m.id != null && this.pending.has(m.id)) {
      const { res, rej } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? rej(new Error(m.error.message || JSON.stringify(m.error))) : res(m.result);
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout:' + method)); } }, 15000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

// Host JS to run inside the page.
const INSPECT_JS = `(() => {
  const out = { htmlClasses: [], sidebar: [], thumbnails: [], dialogs: [], quickInput: [], overlay: [] };
  out.url = location.href;
  document.documentElement.classList.forEach(c => out.htmlClasses.push(c));

  const fmt = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className && typeof el.className === 'string') ? el.className.split(/\\s+/).filter(Boolean).slice(0, 12) : [],
      clsAll: (el.className && typeof el.className === 'string') ? el.className : '',
      id: el.id || '',
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      bg: cs.backgroundColor, bgImg: cs.backgroundImage,
      radius: cs.borderRadius,
      boxShadow: cs.boxShadow,
      zIndex: cs.zIndex, position: cs.position,
    };
  };

  function vis(el) {
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 400) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    return true;
  }

  // (1) Candidate sidebar containers / elements carrying a visible divider box-shadow
  const byClass = (path, selectors) => {
    let arr = [];
    try { arr = Array.from(document.querySelectorAll(selectors)); } catch {}
    return arr;
  };

  // Sidebar-ish selectors known from the shell
  for (const sel of [
    '.task-list-base', '.task-list-panel', '[class*="task-list"]',
    '.sidebar', '[class*="sidebar"]', '[class*="sideBar"]',
    '.activitybar', '[class*="activity-bar"]', '.tree-container',
  ]) {
    for (const el of byClass('.', sel)) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      const item = fmt(el);
      item.bearerOfShadow = (cs.boxShadow && cs.boxShadow !== 'none');
      item.borderRightColor = cs.borderRightColor;
      item.borderRightWidth = cs.borderRightWidth;
      out.sidebar.push(item);
      try {
        const kids = Array.from(el.querySelectorAll('*')).filter(vis).slice(0, 6);
        item.vizKids = kids.map(k => ({ cls: (k.className && typeof k.className === 'string') ? k.className.split(/\\s+/).filter(Boolean).slice(0,6) : [], bg: getComputedStyle(k).backgroundColor, shadow: getComputedStyle(k).boxShadow }));
      } catch {}
    }
  }

  // (2) Round thumbnails: any visible element whose border-radius >= 50% of min(w,h)
  for (const el of Array.from(document.querySelectorAll('button, [role="button"], [class*="avatar"], [class*="thumb"], [class*="icon"], [class*="dot"], [class*="circle"], li, [class*="item"]')).filter(vis)) {
    const r = el.getBoundingClientRect();
    const minDim = Math.min(r.width, r.height);
    if (minDim < 10) continue;
    const cs = getComputedStyle(el);
    const radiusNum = parseFloat(cs.borderRadius) || 0;
    let item = null;
    const roundThresholdShow = Math.round(minDim / 2) >= 8;
    if (radiusNum >= minDim / 2) {
      item = fmt(el);
      item.round = true;
    } else if (roundThresholdShow && /(avatar|thumb|circle|dot)/.test(el.className)) {
      item = fmt(el);
      item.round = false;
    }
    if (item) {
      item.bgGradients = cs.backgroundImage;
      out.thumbnails.push(item);
    }
    if (out.thumbnails.length >= 25) break;
  }

  // (3) Dialogs / quick-input / modal overlays (VS Code native widgets)
  for (const sel of [
    '.monaco-workbench .quick-input-widget', '.quick-input-widget', '[class*="quickInput"]',
    '.modal', '[class*="modal"]', '[role="dialog"]', '.dialog-message',
    '[class*="dialog"], [class*="Dialog"]', '.monaco-dialog-box',
    '.notifications-toasts', '[class*="toast"]', '.context-view',
    '[class*="picker"], [class*="SettingsPanel"], [class*="command-dialog"]',
  ]) {
    for (const el of byClass('.', sel)) {
      if (!vis(el)) continue;
      const f = fmt(el);
      out.dialogs.push(f);
      const kids = Array.from(el.querySelectorAll('input, button, textarea, [class*="bg"], [class*="surface"]')).slice(0, 8);
      f.children = kids.map(k => {
        const ks = getComputedStyle(k);
        return { tag: k.tagName.toLowerCase(), cls: (k.className && typeof k.className === 'string') ? k.className.split(/\\s+/).filter(Boolean).slice(0,8) : [], bg: ks.backgroundColor, bgImg: ks.backgroundImage, color: ks.color, shadow: ks.boxShadow, border: ks.border };
      });
    }
  }

  // (4) Any full-screen translucent overlay / veil
  for (const el of Array.from(document.querySelectorAll('div, section, aside')).filter(vis)) {
    const cs = getComputedStyle(el);
    const insets = /0px/.test([cs.top, cs.right, cs.bottom, cs.left].join(' '));
    const r = el.getBoundingClientRect();
    const isFull = r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9;
    const rgba = (cs.backgroundColor || '').match(/rgba?\\([^)]+\\)/g) || [];
    const translucent = rgba.map(rg => { const m = rg.match(/[\\d.]+/g); if (!m || m.length < 4) return null; return parseFloat(m[3]); }).filter(v => v != null && v > 0 && v < 0.9);
    if ((isFull || (insets && translucent.length)) && translucent.length && !/^portal|flux|agent-motion/.test(el.id || '')) {
      out.overlay.push({ cls: (el.className && typeof el.className === 'string') ? el.className.split(/\\s+/).filter(Boolean).slice(0,8) : [], bg: cs.backgroundColor, bgImg: cs.backgroundImage, shadow: cs.boxShadow });
    }
    if (out.overlay.length >= 12) break;
  }

  const UNIQ = {};
  const collapse = (arr) => arr && arr.slice(0, 40);
  return out;
})()`;

async function run() {
  const vResp = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await vResp.json();
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''));
  console.log('Page targets:', pages.length);
  pages.forEach(p => console.log('  -', p.title?.slice(0, 60), '|', (p.url || '').slice(0, 80)));

  // Pick the main workbench page (largest / first non-blank)
  let page = pages.find(p => /workbench|index/i.test(p.url || '') && p.title) || pages[0];
  if (!page) { console.log('No page target'); return; }
  console.log('\nUsing page:', page.title);

  const client = await CDP.connect(page.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  const res = await client.send('Runtime.evaluate', {
    expression: INSPECT_JS,
    returnByValue: true,
    awaitPromise: true,
  });
  const value = res.result?.value;
  if (res.exceptionDetails) {
    console.log('JS error:', JSON.stringify(res.exceptionDetails, null, 2));
  }
  console.log(JSON.stringify(value, null, 2));
  client.close();
}

run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });