// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-full-extract — 主题切换
 *
 * 切换 prefers-color-scheme 捕获双色主题数据。
 */

// ============== 工具函数 ==============

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============== 根变量提取 ==============

/**
 * 获取根主题变量。策略为「聚合」而非单一宿主：
 *
 * 1. `documentElement` 的计算变量（覆盖 `:root` 规则 / html inline / 继承）。
 * 2. 若为 0，聚合三路来源（inline style / stylesheet :root|body 规则）。
 */
export async function getRootComputedVariables(client, fallback = true) {
  const expr = `
    (() => {
      const cap = (s) => (s && s.trim()) ? s.trim().slice(0, 200) : null;
      const vars = {};
      const put = (k, v) => { if (v != null && vars[k] == null) vars[k] = v; };
      const collectComputed = (el) => { const cs = getComputedStyle(el); for (let i = 0; i < cs.length; i++) { const p = cs[i]; if (p.startsWith('--')) put(p.trim(), cap(cs.getPropertyValue(p))); } };
      collectComputed(document.documentElement);
      const rootCount = Object.keys(vars).length;
      if (rootCount && ${String(fallback)}) return JSON.stringify(vars);
      
      const inlineRe = /(--[a-zA-Z0-9_-]+)\\s*:\\s*([^;]*)/g;
      for (const el of document.querySelectorAll('*')) {
        const st = (el.getAttribute && el.getAttribute('style')) || '';
        if (!st.includes('--')) continue;
        let m; inlineRe.lastIndex = 0;
        while ((m = inlineRe.exec(st)) !== null) { put(m[1].trim(), cap(m[2])); }
      }
      const tryRules = (sheets) => {
        for (const sheet of sheets) {
          let rules; try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
          if (!rules) continue;
          for (const r of rules) {
            if (r.type) { try { const er = r.cssRules || r.rules; if (er) tryRules([{ cssRules: er }]); } catch {} }
            try {
              if (!r.selectorText) continue;
              if (!/:root|^body|^html/i.test(r.selectorText)) continue;
              const hr = /(--[a-zA-Z0-9_-]+)\\s*:\\s*([^;{}]*)/g;
              let m; while ((m = hr.exec(r.style.cssText)) !== null) put(m[1].trim(), cap(m[2]));
            } catch {}
          }
        }
      };
      tryRules(document.styleSheets);
      const totalCount = Object.keys(vars).length;
      const hostKind = totalCount === 0
        ? 'none'
        : (rootCount === 0 ? 'aggregated-inline-or-rules' : 'merged-root-plus-distributed');
      const out = { ...vars };
      out['__host'] = JSON.stringify({ kind: hostKind, n: Object.keys(vars).length });
      return JSON.stringify(out);
    })()
  `;

  const { result } = await client.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
  });

  try {
    return JSON.parse(result.value);
  } catch {
    return {};
  }
}

/** 排除诊断键 `__host` 后的 CSS 变量条目数。 */
export function rootVarsCount(vars) {
  let n = 0;
  for (const k of Object.keys(vars)) {
    if (k !== '__host') n++;
  }
  return n;
}

/** 排除诊断键 `__host` 后的 entries（供 allVars 归一化）。 */
export function rootVarsEntries(vars) {
  return Object.entries(vars).filter(([k]) => k !== '__host');
}

// ============== MutationObserver 驱动的主题切换 ==============

const INSTALL_ROOT_OBSERVER = `(() => {
  try {
    window.__agentskinRootDirty = false;
    const root = document.documentElement;
    if (window.__agentskinRootObserver) window.__agentskinRootObserver.disconnect();
    window.__agentskinRootObserver = new MutationObserver(() => {
      window.__agentskinRootDirty = true;
    });
    window.__agentskinRootObserver.observe(root, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme', 'data-mode'],
      subtree: false,
      childList: false,
    });
    return true;
  } catch { return false; }
})()`;

export async function installRootObserver(client) {
  try {
    const res = await client.send('Runtime.evaluate', {
      expression: INSTALL_ROOT_OBSERVER,
      returnByValue: true,
    });
    return res?.result?.value === true;
  } catch {
    return false;
  }
}

export async function waitRootMutation(client, waitMs) {
  const expr = `(() => {
    const deadline = Date.now() + ${waitMs};
    return new Promise((resolve) => {
      const tick = () => {
        if (window.__agentskinRootDirty === true) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tick, 40);
      };
      tick();
    });
  })()`;
  try {
    const res = await client.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.value === true;
  } catch {
    return null;
  }
}

export async function setColorScheme(client, scheme, waitMs = 600) {
  try {
    await client.send('Emulation.enable');
  } catch {}

  try {
    await installRootObserver(client);
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    });
    const mutated = await waitRootMutation(client, waitMs);
    if (mutated !== true) await sleep(waitMs);
    return true;
  } catch {
    return false;
  }
}

export async function resetEmulatedMedia(client) {
  try {
    await client.send('Emulation.setEmulatedMedia', { features: [] });
  } catch {}
}
