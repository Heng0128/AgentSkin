// 2a 多资产注入冒烟（RFC themes-asset-injection-2a 验收§4）
//
// 复用真实引擎 buildApplyExpression / buildRemoveExpression，对真实在线 agent
// 注入一个 ≥2 素材的 imageDataUrls 集，然后回读验证：
//   - 每个素材 → --agentskin-image-<id> 均为可用的 blob: URL
//   - hero 别名 → --agentskin-art 与 --agentskin-image-hero 一致
//   - 注入后 calc imageUrls 数量 / decorations 不依赖（2a 只铺变量）
// 最后 buildRemoveExpression 恢复，不残留 Blob / 主题 sheet / host class。
//
// 用法: node debug-tools/smoke-asset-inject.mjs [port] [host]
// 默认连 127.0.0.1:9336（workbuddy），可传其它在线 agent 端口。
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  buildApplyExpression,
  buildRemoveExpression,
} from '../src/engine/src/runtime/renderer-payload.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] ?? '9336';
const HOST = process.argv[3] ?? '127.0.0.1';
const AGENT_ID = process.argv[4] ?? 'workbuddy';

// 1x1 素材样本（验证多类型：png 背景 / webp 预览 / gif 动画小人）。
const ONE_PX_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const ONE_PX_WEBP =
  'UklGRkIAAABXRUJQVlA4IDYAAADwAQCdASoBAAEAAUAmJQBOgR9GEAP7igqAgAAEftZAAA==';
const TINY_GIF =
  'R0lGODlhAQABAPAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// 构造多资产 imageDataUrls —— 3 个素材，证明 2a 不再只传 hero。
const IMAGE_DATA_URLS = {
  hero: `data:image/png;base64,${ONE_PX_PNG}`,
  preview: `data:image/webp;base64,${ONE_PX_WEBP}`,
  mascot: `data:image/gif;base64,${TINY_GIF}`,
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
      c.ws.addEventListener('error', () => rej(new Error('ws connect')), { once: true });
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
    try { this.ws.close(); } catch {}
  }
}

async function findPageTarget(port, host) {
  const raw = await (await fetch(`http://${host}:${port}/json`)).json();
  const list = raw.filter(
    (x) => x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url || ''),
  );
  return list.find((p) => !/avatar-overlay/.test(p.url || '')) || list[0];
}

async function run() {
  console.log(`[2a-smoke] connecting ${HOST}:${PORT} (agent=${AGENT_ID})`);
  const target = await findPageTarget(PORT, HOST);
  if (!target) {
    console.log('NO_PAGE');
    return;
  }
  console.log(`[2a-smoke] page: ${target.url}`);

  const adapter = { id: AGENT_ID };
  const targetTheme = {
    theme: { id: '2a-smoke', version: '0.0.1' },
    css: '',
    imageDataUrls: IMAGE_DATA_URLS,
  };

  const applyExpr = buildApplyExpression({ adapter, targetTheme });
  const removeExpr = buildRemoveExpression(adapter);

  const c = await CDP.connect(target.webSocketDebuggerUrl);
  await c.send('Runtime.enable');

  // 1) 注入多资产
  const r1 = await c.send('Runtime.evaluate', {
    expression: applyExpr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r1.exceptionDetails) {
    console.log('[2a-smoke] APPLY_ERR', JSON.stringify(r1.exceptionDetails).slice(0, 800));
  }
  console.log('[2a-smoke] apply =', JSON.stringify(r1.result?.value ?? null));

  // 2) 回读 CSS 变量 —— 验收核心
  const readback = await c.send('Runtime.evaluate', {
    expression: `(() => {
      const root = document.documentElement;
      const pick = (name) => root.style.getPropertyValue(name);
      return {
        hero: pick('--agentskin-image-hero'),
        preview: pick('--agentskin-image-preview'),
        mascot: pick('--agentskin-image-mascot'),
        artAlias: pick('--agentskin-art'),
        hostClass: root.classList.contains('agentskin-host-${AGENT_ID}'),
        themeId: root.dataset.agentskinTheme ?? null,
      };
    })()`,
    returnByValue: true,
  });
  const vars = readback.result?.value;
  console.log('[2a-smoke] readback =', JSON.stringify(vars, null, 2));

  // 3) 断言
  const heroOk = typeof vars?.hero === 'string' && vars.hero.startsWith('url("blob:');
  const previewOk = typeof vars?.preview === 'string' && vars.preview.startsWith('url("blob:');
  const mascotOk = typeof vars?.mascot === 'string' && vars.mascot.startsWith('url("blob:');
  const blobUrls = new Set();
  for (const k of ['hero', 'preview', 'mascot']) {
    const m = /url\("(blob:[^"]+)"\)/.exec(vars?.[k] ?? '');
    if (m) blobUrls.add(m[1]);
  }
  const aliasOk = typeof vars?.artAlias === 'string' && vars.artAlias === vars?.hero;
  const distinct = blobUrls.size === 3;

  console.log('[2a-smoke] ----- 断言 -----');
  console.log('[2a-smoke] --agentskin-image-hero   =', heroOk);
  console.log('[2a-smoke] --agentskin-image-preview=', previewOk);
  console.log('[2a-smoke] --agentskin-image-mascot =', mascotOk);
  console.log('[2a-smoke] 3 素材 Blob URL 互不相同 =', distinct);
  console.log('[2a-smoke] --agentskin-art 别名=hero =', aliasOk);
  console.log('[2a-smoke] hostClass / themeId 落地 =', `${vars?.hostClass} / ${vars?.themeId}`);

  // 4) 恢复，不残留
  const r2 = await c.send('Runtime.evaluate', {
    expression: removeExpr,
    returnByValue: true,
    awaitPromise: true,
  });
  const cleanup = await c.send('Runtime.evaluate', {
    expression: `(() => {
      const root = document.documentElement;
      let leftover = 0;
      for (let i = root.style.length - 1; i >= 0; i--) {
        const n = root.style.item(i);
        if (n.startsWith('--agentskin-image-')) leftover++;
      }
      return {
        leftoverAssetVars: leftover,
        artGone: root.style.getPropertyValue('--agentskin-art') === '',
        hostGone: !root.classList.contains('agentskin-host-${AGENT_ID}'),
        decorLeftover: document.querySelectorAll('[data-agentskin-decor]').length,
      };
    })()`,
    returnByValue: true,
  });
  console.log('[2a-smoke] remove =', JSON.stringify(r2.result?.value ?? null));
  console.log('[2a-smoke] cleanup =', JSON.stringify(cleanup.result?.value ?? null));
  c.close();

  const pass =
    heroOk && previewOk && mascotOk && distinct && aliasOk && vars?.hostClass === true;
  console.log(pass ? '\n[2a-smoke] PASS' : '\n[2a-smoke] FAIL');
  process.exitCode = pass ? 0 : 1;
}

run().catch((e) => {
  console.error('2A_SMOKE_FAIL', e.message);
  process.exit(1);
});