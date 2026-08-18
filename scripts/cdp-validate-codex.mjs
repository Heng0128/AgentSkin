// SPDX-License-Identifier: MPL-2.0
/**
 * cdp-validate-codex — §16 跨版本复核项动态验证（Codex v26.814）
 *
 * 对运行中的 Codex CDP 端口评估 5 个待复核项，不写回任何文件、不改原应用：
 *   [1] usesOwlAppShell() / getBuildFlavor() 返回值(决定 Electron vs Owl 分支)
 *   [2] --remote-debugging-port 是否仍被解析(能用 CDP 连上即判为仍生效)
 *   [3] Tier A portal 锚点是否存在(data-above-composer-* 等)
 *   [4] --color-token-* 设计 token 家族是否在 :root 上存在
 *   [5] app: scheme 在 ?initialRoute=avatar-overlay 次 renderer 上是否隔离
 *
 * 用法：node scripts/cdp-validate-codex.mjs --port 9333 [--json]
 * 依赖：全局 WebSocket(Node 22+)；需先以 --remote-debugging-port=<port> 启动 Codex。
 */

const port = (() => {
  const i = process.argv.indexOf('--port');
  return i >= 0 ? Number(process.argv[i + 1]) : 9333;
})();
const wantJson = process.argv.includes('--json');

const TIER_A = {
  aboveComposer: '[data-above-composer-portal]',
  aboveComposerQueue: '[data-above-composer-queue-portal]',
  mcpAppPortal: "[data-mcp-app-portal-target='true']",
  threadFooter: "[data-thread-scroll-footer='true']",
  browserSidebarBanner: "[data-testid='browser-sidebar-top-banner-portal']",
  homeAmbient: '[data-home-ambient-suggestions]',
  composerOverlay: '[data-composer-overlay-floating-ui]',
};

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
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`timeout:${method}`));
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

async function evalIn(client, expression) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    return {
      error: exceptionDetails.exception?.description || exceptionDetails.text || 'exception',
    };
  }
  if (result && result.type === 'object' && result.subtype === 'error') {
    return { error: result.description || 'js-error' };
  }
  return result?.value;
}

const buildEval = () => `(() => {
  const out = { hasBridge: typeof window.electronBridge !== 'undefined', isolated: true };
  try { out.usesOwlAppShell = typeof window.electronBridge?.usesOwlAppShell === 'function' ? window.electronBridge.usesOwlAppShell() : null; } catch(e){ out.usesOwlAppShell='ERR:'+e.message; }
  try { out.getBuildFlavor = typeof window.electronBridge?.getBuildFlavor === 'function' ? window.electronBridge.getBuildFlavor() : null; } catch(e){ out.getBuildFlavor='ERR:'+e.message; }
  try { out.codexWindowType = window.codexWindowType ?? null; } catch(e){ out.codexWindowType='ERR:'+e.message; }
  // [3] Tier A portal anchors
  const sel = ${JSON.stringify(Object.entries(TIER_A).map(([k, v]) => ({ k, v })))};
  out.portalAnchors = {};
  for (const { k, v } of sel) out.portalAnchors[k] = document.querySelectorAll(v).length;
  // [4] --color-token-* on :root
  const rootStyle = getComputedStyle(document.documentElement);
  const tokenKeys = [];
  for (let i = 0; i < rootStyle.length; i++) { const p = rootStyle[i]; if (p.indexOf('--color-token') === 0) tokenKeys.push(p); }
  out.colorTokenVars = { count: tokenKeys.length, sample: tokenKeys.slice(0, 5) };
  // current location/scheme
  out.location = { href: location.href.slice(0, 160), origin: location.origin };
  return out;
})()`;

async function main() {
  const result = { port, items: {}, targets: [] };
  try {
    const versionUrl = `http://127.0.0.1:${port}/json/version`;
    const v = await (await fetch(versionUrl)).json();
    result.browser = v.Browser;
    const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const pages = targets.filter(
      (t) =>
        t.type === 'page' &&
        !/^(devtools|chrome|about:)/i.test(t.url || '') &&
        t.webSocketDebuggerUrl,
    );
    result.targets = pages.map((t) => ({
      id: t.id,
      url: (t.url || '').slice(0, 180),
      title: (t.title || '').slice(0, 60),
    }));

    // [5] 隔离判定：app: scheme 的 avatar-overlay 是否独立 target
    // (URL 中的 initialRoute 值经 percent-encoding，如 %2Favatar-overlay，须解码后判定)
    const appTargets = pages.filter((t) => /^app:\/\//i.test(t.url || ''));
    const overlay = appTargets.find((t) =>
      /initialRoute=([^&]+)/i.exec(t.url || '')?.[1]
        ? decodeURIComponent(/initialRoute=([^&]+)/i.exec(t.url)[1]).includes('avatar-overlay')
        : false,
    );
    const primary = appTargets.find((t) => t !== overlay);
    result.items[5] = {
      appTargetCount: appTargets.length,
      hasPrimary: !!primary,
      primaryLabel: primary ? primary.title : null,
      hasAvatarOverlay: !!overlay,
      overlayIsSeparateTarget: !!overlay,
      overlayId: overlay ? overlay.id : null,
      scheme: overlay && /^app:\/\//i.test(overlay.url) ? 'app:' : overlay ? 'OTHER' : null,
    };

    // 主界面(electronBridge 预期在主页)评估 [1][3][4]
    const target = primary || pages[0];
    if (target) {
      const c = await CDP.connect(target.webSocketDebuggerUrl);
      await c.send('Runtime.enable');
      const evalResult = await evalIn(c, buildEval());
      c.close();
      result.items[1] = {
        hasBridge: evalResult?.hasBridge,
        usesOwlAppShell: evalResult?.usesOwlAppShell,
        getBuildFlavor: evalResult?.getBuildFlavor,
        codexWindowType: evalResult?.codexWindowType,
        onTarget: target.url.slice(0, 120),
      };
      result.items[3] = evalResult?.portalAnchors;
      result.items[4] = evalResult?.colorTokenVars;
    }

    // [2] 用 --remote-debugging-port 连上即判为仍被解析
    result.items[2] = {
      worked: !!appTargets.length,
      note: appTargets.length
        ? '--remote-debugging-port 仍可解析：成功以该参数启动并连上 CDP'
        : '未命中 app:// target，无法确认',
    };
    result.ok = true;
  } catch (e) {
    result.ok = false;
    result.error = e.message;
  }
  if (wantJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
