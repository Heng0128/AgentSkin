// Reset ALL agentskin injection on Codex, then replay ONE clean tokyo-night
// theme through the ENGINE's single injection body (buildApplyExpression),
// then verify the selected sidebar row carries an accent-tinted active
// background (distinct from the frosted sidebar base).
//
// Why the ENGINE path (root-cause fix):
// The previous version injected a hand-written <style id="agentskin-codex-base">
// and manually evaluated engines/codex/adapter.mjs. The engine's real
// persistence layer (renderer-payload.mjs) manages its own
// #agentskin-theme-style-codex <style> and self-heals it via MutationObserver +
// 5s interval, so it fought and overwrote the manual injection — a two-source
// conflict (especially the --agentskin-accent resolution). Pushing the theme
// through buildApplyExpression keeps a SINGLE source: the engine compiles theme
// CSS + bridge into one <style> and owns the self-heal loop.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import codex from '../src/engine/src/adapters/codex.mjs';
import { buildApplyExpression } from '../src/engine/src/runtime/renderer-payload.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '58554';
const THEME_CSS_PATH = join(ROOT, 'themes', 'tokyo-night', 'assets', 'css', 'codex.css');

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
      c.ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
    });
    c.ws.addEventListener('message', (e) => c.#msg(e.data));
    return c;
  }
  #msg(raw) {
    const m = JSON.parse(raw);
    if (m.id != null && this.pending.has(m.id)) {
      const { r } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? r(new Error(m.error.message)) : r(m.result);
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { r: res });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('timeout ' + method));
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

// Teardown every prior AgentSkin injection surface:
//  - engine-owned <style id="agentskin-theme-style-*"> and host class
//  - manual <style id="agentskin-*"> blobs
//  - adoptedStyleSheets carrying agentskin rules
//  - any live engine host runtime so its self-heal loop stops fighting us
const RESET = `(() => {
  for (const s of Array.from(document.querySelectorAll('style'))) {
    const txt = s.textContent || '';
    if ((s.id && /^agentskin-/i.test(s.id)) || /--agentskin|agentskin-host|agentskin-theme-style/i.test(txt)) { s.remove(); }
  }
  const keep = [];
  for (const s of document.adoptedStyleSheets) {
    let spicy = false;
    try { for (const r of s.cssRules) { if (r.cssText && /agentskin/i.test(r.cssText)) { spicy = true; break; } } } catch { spicy = /agentskin/i.test(String(s)); }
    if (!spicy) keep.push(s);
  }
  document.adoptedStyleSheets = keep;
  try { Object.values(window.__AGENTSKIN__?.hosts ?? {}).forEach((h) => h?.cleanup?.()); } catch {}
  for (const c of Array.from(document.documentElement.classList)) { if (/^agentskin-/.test(c)) document.documentElement.classList.remove(c); }
  document.documentElement.removeAttribute('data-agentskin-host');
  document.documentElement.removeAttribute('data-agentskin-theme');
  document.documentElement.removeAttribute('data-agentskin-theme-version');
  document.documentElement.removeAttribute('data-agentskin-skip');
  for (const p of Array.from(document.documentElement.style)) { if (p.startsWith('--agentskin-')) document.documentElement.style.removeProperty(p); }
  return true;
})()`;

const VERIFY = `(() => {
  const sel = document.querySelector('[data-app-action-sidebar-thread-selected]');
  const sidebar = document.querySelector('nav') || document.querySelector('aside');
  const ro = sel ? getComputedStyle(sel) : null;
  const so = sidebar ? getComputedStyle(sidebar) : null;
  const mk = (cs) => cs ? { bg: cs.backgroundColor, boxS: cs.boxShadow.slice(0, 40) } : null;
  return {
    hostClass: document.documentElement.classList.contains('agentskin-host-codex'),
    themeId: document.documentElement.dataset.agentskinTheme ?? null,
    accentRoot: getComputedStyle(document.documentElement).getPropertyValue('--agentskin-accent').trim(),
    activeStyles: Array.from(document.querySelectorAll('style')).filter(s => /^agentskin-theme-style/i.test(s.id || '')).map(s => s.id),
    baseBgActive: getComputedStyle(document.documentElement).getPropertyValue('--bg-active').trim(),
    baseBgHover: getComputedStyle(document.documentElement).getPropertyValue('--bg-hover').trim(),
    sidebar: mk(so),
    selectedRow: sel ? { tag: sel.tagName, bg: ro?.backgroundColor, boxS: ro?.boxShadow.slice(0, 40) } : null,
    hasSelected: !!sel,
  };
})()`;

async function run() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(
    (x) => x.type === 'page' && x.webSocketDebuggerUrl && !/about:/.test(x.url || ''),
  );
  const main = list.find((p) => !/avatar-overlay/.test(p.url || '')) || list[0];
  const c = await CDP.connect(main.webSocketDebuggerUrl);
  await c.send('Runtime.enable');

  await c.send('Runtime.evaluate', { expression: RESET, returnByValue: true });

  // ROOT-CAUSE fix: a stale sessionStorage disable flag (left by an earlier
  // removeTheme/restore) makes the engine's ensure() bail BEFORE injecting —
  // `apply` still reports {installed:true} (hard-coded return), which is why
  // the old manual "insert a raw <style>" injection looked like a two-source
  // conflict. Clear the flag exactly like injector.mjs clearDisabledFlag does
  // before the engine apply, otherwise ensure() skips and the observer tears
  // the host runtime back down.
  const CLEAR_DISABLED = `(() => { try { sessionStorage.removeItem(${JSON.stringify('__agentskin_disabled__')}); return 'cleared'; } catch (e) { return 'no-sessionstorage'; } })()`;
  const cl = await c.send('Runtime.evaluate', { expression: CLEAR_DISABLED, returnByValue: true });
  console.log('clearDisabled=', JSON.stringify(cl.result?.value ?? cl.exceptionDetails));

  // Build the engine's single injection body: theme CSS + bridge one <style>,
  // engine-owned self-heal. No renderer profile (clean theme replay) — we only
  // want to confirm the sidebar selection accent reads through.
  const targetTheme = {
    theme: {
      id: 'codex-clean-probe',
      name: 'Tokyo Night',
      version: '1',
      displayName: 'Tokyo Night',
    },
    css: readFileSync(THEME_CSS_PATH, 'utf8'),
    options: {},
    verification: {
      rootAny: ["main[class*='MainContentSurface']", 'main'],
      required: [],
      recommended: [],
    },
    imageDataUrls: {},
  };
  const expr = buildApplyExpression({ adapter: codex, targetTheme });

  const r1 = await c.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  const applied = r1.exceptionDetails
    ? { error: r1.exceptionDetails.exception?.description ?? r1.exceptionDetails.text }
    : r1.result?.value;
  console.log('apply=', JSON.stringify(applied));

  // engine's ensure() writes its own self-heal loop; give it a beat to settle
  const v1 = await c.send('Runtime.evaluate', { expression: VERIFY, returnByValue: true });
  console.log(
    'verify@100ms=',
    JSON.stringify(
      v1.result?.value ?? (v1.exceptionDetails ? JSON.stringify(v1.exceptionDetails) : null),
    ),
  );
  await new Promise((res) => setTimeout(res, 1200));
  const v2 = await c.send('Runtime.evaluate', { expression: VERIFY, returnByValue: true });
  console.log(
    'verify@1300ms=',
    JSON.stringify(
      v2.result?.value ?? (v2.exceptionDetails ? JSON.stringify(v2.exceptionDetails) : null),
    ),
  );
  // snapshot live style/class state at the moment of absence
  const d = await c.send('Runtime.evaluate', {
    expression: `(() => ({ styles: Array.from(document.querySelectorAll('style')).map(s=>s.id||'(anon)'), htmlClass: document.documentElement.className.slice(0,120), disabled: (()=>{try{return sessionStorage.getItem('__agentskin_disabled__')}catch{return null}})() }))()`,
    returnByValue: true,
  });
  console.log('live=', JSON.stringify(d.result?.value ?? d.exceptionDetails));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
