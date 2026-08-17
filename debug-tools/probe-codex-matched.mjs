// Use CDP CSS.getMatchedStylesForNode to enumerate exactly which rules set the
// selected row's background and who wins (priority/specificity/order).
const PORT = process.argv[2] || '58554';
const SEL = '[data-app-action-sidebar-thread-selected]';
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
      }, 15000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}
async function run() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(
    (x) => x.type === 'page' && x.webSocketDebuggerUrl && !/about:/.test(x.url || ''),
  );
  const main = list.find((p) => !/avatar-overlay/.test(p.url || '')) || list[0];
  const c = await CDP.connect(main.webSocketDebuggerUrl);
  await c.send('DOM.enable');
  await c.send('CSS.enable');
  const doc = await c.send('DOM.getDocument', { depth: 0 });
  const q = await c.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: SEL });
  if (!q.nodeId) {
    console.log('selected row not found');
    c.close();
    return;
  }
  const m = await c.send('CSS.getMatchedStylesForNode', { nodeId: q.nodeId });
  const safeSel = (o) => {
    try {
      return o && o.rule && o.rule.selectorText ? String(o.rule.selectorText).slice(0, 130) : null;
    } catch {
      return null;
    }
  };
  const safeBg = (o) => {
    try {
      const s = o && o.rule && o.rule.style ? o.rule.style : null;
      if (!s) return null;
      return (
        s.background ||
        s.backgroundColor ||
        (s.getPropertyValue ? s.getPropertyValue('background-color') : null) ||
        null
      );
    } catch {
      return null;
    }
  };
  const out = {
    inlineStyle: (() => {
      try {
        return m.inlineStyle ? String(m.inlineStyle.cssText).slice(0, 200) : null;
      } catch {
        return null;
      }
    })(),
  };
  out.matchedCount = (m.matchedCSSRules || []).length;
  out.allMatchedSels = (m.matchedCSSRules || [])
    .map((o) => {
      try {
        return o.rule && o.rule.selectorText ? String(o.rule.selectorText) : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, 30);
  out.matched = (m.matchedCSSRules || [])
    .map((rm) => ({
      sel: safeSel(rm),
      matchingIdx: (rm && rm.matchingSelectors) || [],
      bg: safeBg(rm),
    }))
    .filter((o) => o.bg || /sidebar|agentskin|thread|item|row/i.test(o.sel || ''))
    .slice(0, 25);
  out.inherited = (m.inherited || [])
    .slice(0, 4)
    .map((i) => (i.matchedCSSRules || []).map(safeBg).filter(Boolean).slice(0, 3))
    .filter((a) => a.length);
  console.log(JSON.stringify(out, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
