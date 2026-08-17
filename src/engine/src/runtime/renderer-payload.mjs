import { getSelectors, getSemantic, isNativeThemeControlled, listSemanticNames } from "./selectivity-registry.mjs";
import { NON_CONTROLLED_CLASS, collectNonControlledSelectors } from "./semantic-filter.mjs";
import { STYLE_RUNTIME_SOURCE, resolveStyleSamplingOpts } from "./verify-style.mjs";
import { compileBridge, wrapBridgeRule } from "./css-var-bridge.mjs";
import { isDiagnosticsEnabled } from "./diagnostics-kill-switch.mjs";

function safeHostClass(appId) {
  return `agentskin-host-${String(appId).replace(/[^a-z0-9_-]/gi, "-")}`;
}

/**
 * sessionStorage 停用标记键（与主进程 `engine-strategy.ts` 的
 * `SESSION_DISABLED_KEY` 语义一致）。
 *
 * - `applyTheme` / `watchTheme` 注册持久化脚本前会清除该标记，使脚本在下次导航生效；
 * - `removeTheme` 设置该标记作为兜底：任何未能被显式移除的持久化脚本
 *   （如来自旧进程、标识符未追踪）都会在新 document 直接跳过，保证「remove 后不重注入」。
 */
export const SESSION_DISABLED_KEY = "__agentskin_disabled__";

function resolveRendererProfile(adapter, targetTheme) {
  const profileId = targetTheme?.options?.rendererProfile;
  if (profileId === undefined) return null;
  if (typeof profileId !== "string" || !profileId.trim()) {
    throw new Error(`Theme renderer profile for '${adapter.id}' must be a non-empty string.`);
  }
  const profile = adapter.rendererProfiles?.[profileId];
  if (!profile || typeof profile.runtime !== "function") {
    throw new Error(`Adapter '${adapter.id}' does not support renderer profile '${profileId}'.`);
  }
  return profile;
}

function fallbackCleanupSource(adapter) {
  return Object.values(adapter.rendererProfiles ?? {})
    .filter((profile) => typeof profile.cleanup === "function")
    .map((profile) => `try { (${profile.cleanup.toString()})(); } catch {}`)
    .join("\n");
}

function buildCompatibilityProfile(adapter, themeVerification = null) {
  const adapterProfile = adapter.verification ?? { rootAny: ["body"], required: [] };
  const checks = (verification, scope, context = null) => [
    ...(verification?.required ?? []).map((item) => ({ ...item, scope, context, severity: "required" })),
    ...(verification?.recommended ?? []).map((item) => ({ ...item, scope, context, severity: "recommended" })),
  ];
  const contexts = (verification, scope) => (verification?.contexts ?? []).map((context) => ({
    name: context.name,
    scope,
    whenAny: context.when.any,
    checks: checks(context, scope, context.name),
  }));

  /**
   * Supplement the adapter's rootAny with registry root selectors not already
   * present. This gives CDP preflight an extra fallback chain when the agent
   * app's primary hash class names change after a major update. (See
   * selectivity-registry.mjs for the full per-platform semantic selector map.)
   */
  const registryRootSelectors = getSelectors(adapter.id, "root");
  let enrichedRootAny = adapterProfile.rootAny ?? ["body"];
  if (registryRootSelectors) {
    const existing = new Set(enrichedRootAny);
    const supplements = registryRootSelectors.filter((sel) => !existing.has(sel));
    if (supplements.length) enrichedRootAny = [...enrichedRootAny, ...supplements];
  }

  return {
    rootAny: enrichedRootAny,
    checks: [
      ...checks(adapterProfile, "adapter"),
      ...checks(themeVerification, "theme"),
    ],
    contexts: [
      ...contexts(adapterProfile, "adapter"),
      ...contexts(themeVerification, "theme"),
    ],
  };
}

function buildCompatibilityPrelude(adapter, themeVerification = null) {
  const profile = JSON.stringify(buildCompatibilityProfile(adapter, themeVerification));
  const appId = JSON.stringify(adapter.id);
  return `
    const appId = ${appId};
    const compatibilityProfile = ${profile};
    const inspect = (selector) => {
      try { return { selector, nodes: Array.from(document.querySelectorAll(selector)), valid: true, error: null }; }
      catch (error) { return { selector, nodes: [], valid: false, error: error?.message ?? String(error) }; }
    };
    const visible = (node) => {
      if (!node) return false;
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    // A selector passes when ANY of its matches is visible: apps may keep
    // hidden duplicates (drawers, virtualized copies) ahead in DOM order.
    const evaluateSelectors = (selectors) => {
      const inspected = selectors.map(inspect);
      return {
        matches: inspected.filter((item) => item.valid && item.nodes.some(visible)).map((item) => item.selector),
        invalidSelectors: inspected.filter((item) => !item.valid).map((item) => ({ selector: item.selector, error: item.error })),
      };
    };
    const root = evaluateSelectors(compatibilityProfile.rootAny);
    const contexts = compatibilityProfile.contexts.map((context) => {
      const trigger = evaluateSelectors(context.whenAny);
      return {
        scope: context.scope,
        name: context.name,
        active: trigger.matches.length > 0,
        matches: trigger.matches,
        selectors: context.whenAny,
        invalidSelectors: trigger.invalidSelectors,
      };
    });
    const activeContexts = new Set(contexts.filter((context) => context.active).map((context) => context.scope + ':' + context.name));
    const checks = [
      ...compatibilityProfile.checks,
      ...compatibilityProfile.contexts.flatMap((context) => activeContexts.has(context.scope + ':' + context.name) ? context.checks : []),
    ];
    const requirements = checks.map((item) => {
      const evaluated = evaluateSelectors(item.any);
      return {
        scope: item.scope,
        context: item.context,
        severity: item.severity,
        name: item.name,
        pass: evaluated.matches.length > 0,
        matches: evaluated.matches,
        selectors: item.any,
        invalidSelectors: evaluated.invalidSelectors,
      };
    });
    const diagnostic = (item) => ({
      scope: item.scope,
      context: item.context,
      severity: item.severity,
      name: item.name,
      selectors: item.selectors,
      invalidSelectors: item.invalidSelectors,
    });
    const missing = [];
    const warnings = [];
    if (!root.matches.length) missing.push({
      scope: 'adapter', context: null, severity: 'required', name: 'root',
      selectors: compatibilityProfile.rootAny, invalidSelectors: root.invalidSelectors,
    });
    for (const item of requirements) {
      if (!item.pass && item.severity === 'required') missing.push(diagnostic(item));
      if (!item.pass && item.severity === 'recommended') warnings.push(diagnostic(item));
    }
    const compatibility = {
      appId,
      compatible: missing.length === 0,
      rootMatches: root.matches,
      rootInvalidSelectors: root.invalidSelectors,
      contexts,
      requirements,
      missing,
      warnings,
      viewport: { width: innerWidth, height: innerHeight },
    };`;
}

export function buildApplyExpression({ adapter, targetTheme }) {
  const profile = resolveRendererProfile(adapter, targetTheme);
  const host = JSON.stringify({ id: adapter.id, className: safeHostClass(adapter.id) });
  const theme = JSON.stringify(targetTheme.theme);
  // Bridge (S3): compile the adapter's native-var → AgentSkin-role entries into
  // CSS declarations on the same host + :root rule that carries the theme tokens.
  // Appending to the theme <style> means cleanup() removes bridge + theme together.
  const bridgeCss = wrapBridgeRule(
    `html.${safeHostClass(adapter.id)}:root`,
    compileBridge(adapter.bridge).css,
  );
  const css = JSON.stringify(targetTheme.css + (bridgeCss ? `\n${bridgeCss}` : ""));
  const nonControlledSelectors = collectNonControlledSelectors(adapter.id);
  const nonControlledJson = JSON.stringify(nonControlledSelectors);
  const nonControlledClass = JSON.stringify(NON_CONTROLLED_CLASS);
  const images = JSON.stringify({
    ...(targetTheme.imageDataUrls ?? {}),
    ...(!targetTheme.imageDataUrls?.hero && targetTheme.artDataUrl ? { hero: targetTheme.artDataUrl } : {}),
  });
  const profileId = JSON.stringify(profile?.id ?? null);
  const profileFactory = profile ? `(${profile.runtime.toString()})` : "null";
  return `(() => {
    const host = ${host};
    const theme = ${theme};
    const cssText = ${css};
    const imageDataUrls = ${images};
    const profileId = ${profileId};
    const profileFactory = ${profileFactory};
    const rootState = window.__AGENTSKIN__ ||= { hosts: {} };
    rootState.hosts ||= {};
    rootState.hosts[host.id]?.cleanup?.();
    // AdaptiveMutationObserver — three-layer throttle to prevent observer storms
    class AdaptiveMutationObserver{constructor(e,o={}){this.callback=e;this.throttleWindow=o.throttleWindow??10000;this.throttleMaxAttempts=o.throttleMaxAttempts??50;this.retryTimeout=o.retryTimeout??2000;this.loopThreshold=o.loopThreshold??1000;this.loopMaxCycles=o.loopMaxCycles??10;this.attemptCount=0;this.windowStart=Date.now();this.isThrottled=!1;this.elementChanges=new WeakMap;this._throttleTimer=null;this.observer=new MutationObserver((o=>{this._handleMutations(o)}))}observe(e,o){this.observer.observe(e,o)}disconnect(){this.observer.disconnect();this._throttleTimer&&(clearTimeout(this._throttleTimer),this._throttleTimer=null)}takeRecords(){return this.observer.takeRecords()}_handleMutations(e){const o=e.filter((e=>!this._isLooping(e.target)));if(0===o.length)return;if(this.isThrottled)return;const t=Date.now();t-this.windowStart>this.throttleWindow&&(this.windowStart=t,this.attemptCount=0);this.attemptCount++;this.attemptCount>this.throttleMaxAttempts?this._enterCooldown():this.callback(o)}_isLooping(e){const o=this.elementChanges.get(e),t=Date.now();return o&&!(t-o.time>this.loopThreshold)?(o.count++,o.time=t,o.count>this.loopMaxCycles):(this.elementChanges.set(e,{count:1,time:t}),!1)}_enterCooldown(){this.isThrottled=!0;console.warn('[AgentSkin] MutationObserver throttled for '+this.retryTimeout+'ms'),this._throttleTimer=setTimeout((()=>{this.isThrottled=!1,this.attemptCount=0,this.windowStart=Date.now(),this._throttleTimer=null}),this.retryTimeout)}}
    const imageUrls = {};
    const ownedImageUrls = new Set();
    const resolveImageUrl = (dataUrl) => {
      if (!dataUrl?.startsWith('data:')) return null;
      try {
        const comma = dataUrl.indexOf(',');
        const mimeType = /^data:([^;,]+)/.exec(dataUrl)?.[1] || 'application/octet-stream';
        const binary = globalThis.atob(dataUrl.slice(comma + 1));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const objectUrl = globalThis.URL.createObjectURL(new Blob([bytes], { type: mimeType }));
        ownedImageUrls.add(objectUrl);
        return objectUrl;
      } catch { /* Small data URLs remain a safe fallback when object URLs are unavailable. */ }
      return dataUrl;
    };
    for (const [name, dataUrl] of Object.entries(imageDataUrls)) {
      const imageUrl = resolveImageUrl(dataUrl);
      if (imageUrl && /^[a-z0-9][a-z0-9_-]*$/i.test(name)) imageUrls[name] = imageUrl;
    }
    const artDataUrl = imageDataUrls.hero ?? null;
    const artUrl = imageUrls.hero ?? null;
    let profileRuntime;
    try {
      profileRuntime = profileFactory ? profileFactory({
        theme, imageDataUrls, imageUrls, artDataUrl, artUrl,
      }) : null;
    } catch (error) {
      for (const objectUrl of ownedImageUrls) globalThis.URL?.revokeObjectURL?.(objectUrl);
      throw error;
    }
    const styleId = 'agentskin-theme-style-' + host.id;

    // sessionStorage disable flag (same key as engine-strategy's persistence
    // script). Set by restore/teardown so a user-initiated undo is not fought
    // by the self-heal loop: once disabled we tear the loop down for good.
    const DISABLED_KEY = ${JSON.stringify(SESSION_DISABLED_KEY)};
    const disabled = () => {
      try { return sessionStorage.getItem(DISABLED_KEY) === '1'; } catch { return false; }
    };

    // Semantic filtering (§8 序 A / CV-04): nodes matching these selectors are
    // non-theme-controlled (isNativeThemeControlled=false) and get marked so
    // injected CSS can exclude them via :not(.agentskin-non-controlled).
    const nonControlledSelectors = ${nonControlledJson};
    const nonControlledClass = ${nonControlledClass};
    const markNonControlled = () => {
      let marked = 0;
      if (!nonControlledSelectors.length) return 0;
      for (const selector of nonControlledSelectors) {
        let nodes;
        try { nodes = document.querySelectorAll(selector); } catch { nodes = []; }
        for (const node of nodes) {
          const element = node;
          if (!element?.classList || element.classList.contains(nonControlledClass)) continue;
          element.classList.add(nonControlledClass);
          marked += 1;
        }
      }
      return marked;
    };
    // Self-heal loop ignores mutations whose target sits inside the injected
    // chrome/layer, baseline-marked, non-controlled, punched-through, or
    // hidden regions (aria-hidden) to avoid thrashing on our own DOM / the
    // agent's decorative full-bleed layers and to cut unnecessary re-applies.
    // (RFC §2.6 / CV-03 — observer exclusion set.)
    const exclusionSelectors = [
      '[data-agentskin-baseline]',
      '#agentskin-' + host.id + '-skin-chrome',
      '.' + nonControlledClass,
      '[data-agentskin-punched]',
      '[aria-hidden="true"]',
    ];
    const isExcludedNode = (node) => {
      const element = typeof node?.closest === 'function' ? node : null;
      if (!element) return false;
      for (const selector of exclusionSelectors) {
        try { if (element.closest(selector) != null) return true; } catch { /* 无效选择器 → 跳过 */ }
      }
      return false;
    };

    const ensure = () => {
      if (disabled()) return false;
      const root = document.documentElement;
      if (!root) return false;
      root.classList.add('agentskin-theme', host.className);
      root.dataset.agentskinHost = host.id;
      root.dataset.agentskinTheme = theme.id;
      root.dataset.agentskinThemeVersion = theme.version;
      for (const [name, imageUrl] of Object.entries(imageUrls)) {
        root.style.setProperty('--agentskin-image-' + name, 'url("' + imageUrl + '")');
      }
      if (artUrl) root.style.setProperty('--agentskin-art', 'url("' + artUrl + '")');
      else root.style.removeProperty('--agentskin-art');
      let style = document.getElementById(styleId);
      if (!style) {
        style = document.createElement('style');
        style.id = styleId;
        (document.head || root).appendChild(style);
      }
      if (style.dataset.themeVersion !== theme.id + '@' + theme.version) {
        style.textContent = cssText;
        style.dataset.themeVersion = theme.id + '@' + theme.version;
      }
      markNonControlled();
      profileRuntime?.ensure?.();
      return true;
    };

    let timer;
    const observer = new AdaptiveMutationObserver((records) => {
      if (disabled()) { cleanup(); return; }
      // Skip self-triggered mutations (our chrome/layer/non-controlled nodes).
      const relevant = records.filter((record) => !isExcludedNode(record.target));
      if (relevant.length === 0) return;
      clearTimeout(timer);
      timer = setTimeout(ensure, 120);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const interval = setInterval(() => {
      if (disabled()) { cleanup(); return; }
      // Conditionally re-apply only when the theme <style> is missing; skip the
      // unconditional re-apply when the skin is already mounted.
      if (!document.getElementById(styleId)) ensure();
    }, 5000);
    const cleanup = () => {
      observer.disconnect();
      clearTimeout(timer);
      clearInterval(interval);
      profileRuntime?.cleanup?.();
      for (const objectUrl of ownedImageUrls) globalThis.URL?.revokeObjectURL?.(objectUrl);
      ownedImageUrls.clear();
      document.getElementById(styleId)?.remove();
      const root = document.documentElement;
      root?.classList.remove(host.className);
      root?.style.removeProperty('--agentskin-art');
      for (const name of Object.keys(imageUrls)) root?.style.removeProperty('--agentskin-image-' + name);
      if (nonControlledSelectors.length) {
        // 还原本次标记的非受控节点，避免清理后残留 agentskin-non-controlled。
        document.querySelectorAll('.' + nonControlledClass).forEach((element) => {
          element.classList.remove(nonControlledClass);
        });
      }
      if (root?.dataset.agentskinHost === host.id) {
        delete root.dataset.agentskinHost;
        delete root.dataset.agentskinTheme;
        delete root.dataset.agentskinThemeVersion;
      }
      delete rootState.hosts[host.id];
      if (!Object.keys(rootState.hosts).length) root?.classList.remove('agentskin-theme');
      return true;
    };
    rootState.hosts[host.id] = {
      cleanup, ensure, observer, interval,
      themeId: theme.id, version: theme.version,
      imageNames: Object.keys(imageUrls),
      profileId, verifyProfile: profileRuntime?.verify ?? null,
    };
    ensure();
    return { installed: true, appId: host.id, themeId: theme.id, version: theme.version };
  })()`;
}

/**
 * 持久化脚本（P1 —— `Page.addScriptToEvaluateOnNewDocument` 注入体）。
 *
 * 与 {@link buildApplyExpression} **共用同一注入体**：直接把其输出作为内嵌字符串，
 * 当前 document 注入与 new-document 重注入只有一份逻辑，杜绝两份实现漂移。
 *
 * 脚本自包含、幂等：
 *   1. sessionStorage 停用标记为 '1' → 直接跳过（`removeTheme` 兜底，跨导航存活）；
 *   2. 等待 `document.documentElement` 出现（new document 早期可能尚无 `<html>`）；
 *   3. `(0, eval)` 执行注入体 —— 注入体自身幂等（style 已存在时 `ensure()` 只更新不叠加，
 *      并复用 `window.__AGENTSKIN__` 主机状态，重复执行不会堆积）。
 *
 * `(0, eval)` 与主进程 `engine-strategy.ts` 的持久化脚本一致：CDP new-document 注入
 * 通道天然绕过页面 CSP，且注入体是编译期构建的受信字符串，不存在用户输入注入面。
 */
export function buildPersistenceScript({ adapter, targetTheme }) {
  const applyBody = buildApplyExpression({ adapter, targetTheme });
  const disabledKey = JSON.stringify(SESSION_DISABLED_KEY);
  return `(() => {
    'use strict';
    try {
      if (sessionStorage.getItem(${disabledKey}) === '1') return;
    } catch (e) { /* sessionStorage 在部分上下文不可用 */ }
    try { window.__AGENTSKIN_PERSIST_RAN__ = true; } catch (e) {}
    const APPLY_BODY = ${JSON.stringify(applyBody)};
    const applyAll = () => {
      if (!document.documentElement) return;
      try { (0, eval)(APPLY_BODY); }
      catch (e) { try { window.__AGENTSKIN_PERSIST_ERR__ = (e && e.stack) || String(e); } catch (e2) {} }
    };
    if (document.documentElement) {
      applyAll();
    } else {
      const obs = new MutationObserver(() => {
        if (document.documentElement) { obs.disconnect(); applyAll(); }
      });
      obs.observe(document, { childList: true, subtree: false });
    }
  })()`;
}

export function buildRemoveExpression(adapter) {
  const appId = JSON.stringify(adapter.id);
  const hostClass = JSON.stringify(safeHostClass(adapter.id));
  const fallbackCleanup = fallbackCleanupSource(adapter);
  return `(() => {
    const appId = ${appId};
    const state = window.__AGENTSKIN__?.hosts?.[appId];
    if (state?.cleanup) return state.cleanup();
    ${fallbackCleanup}
    document.getElementById('agentskin-theme-style-' + appId)?.remove();
    const root = document.documentElement;
    root?.classList.remove(${hostClass});
    root?.style.removeProperty('--agentskin-art');
    if (root?.style) {
      for (let index = root.style.length - 1; index >= 0; index -= 1) {
        const name = root.style.item(index);
        if (name.startsWith('--agentskin-image-')) root.style.removeProperty(name);
      }
    }
    if (root?.dataset.agentskinHost === appId) {
      delete root.dataset.agentskinHost;
      delete root.dataset.agentskinTheme;
      delete root.dataset.agentskinThemeVersion;
    }
    if (root && ![...root.classList].some((name) => name.startsWith('agentskin-host-'))) {
      root.classList.remove('agentskin-theme');
    }
    return true;
  })()`;
}

export function buildProbeExpression(adapter, themeVerification = null) {
  return `(() => {
    ${buildCompatibilityPrelude(adapter, themeVerification)}
    return compatibility;
  })()`;
}

/**
 * 样式值对比采样片段（RFC §2.7 序5 / CV-05）。
 *
 * 收集注册表中 `isNativeThemeControlled=true` 的语义节点与根节点的计算样式，
 * 与生效主题 token（--agentskin-text/surface/border）比对，输出 `styleSampling`
 * 判定（`pass`）。内嵌片段只在主题 `<style>` 已挂载时取样，否则返回中性 pass。
 */
export function buildStyleSamplingSnippet(adapter) {
  // A-18 kill-switch：该 Agent 的样式漂移诊断被关闭时，产出中性 pass（不误报、
  // 不拖拽回归）。注入主流程不受影响，仅在 build 阶段（Node 侧）分流。
  if (!isDiagnosticsEnabled(adapter.id, 'styleSampling')) {
    return `
    // Diagnostics kill-switch (A-18): style drift sampling disabled for "${adapter.id}".
    const styleSampling = { pass: true, matchRatio: 1, judged: 0, misses: [], reason: 'diagnostics-kill-switched' };
  `;
  }
  // per-Agent 预算（A-02）：默认 minRatio=0.85，可从 STYLE_SAMPLING_POLICY 收紧。
  const samplingOpts = resolveStyleSamplingOpts(adapter.id);
  const probes = listSemanticNames(adapter.id)
    .filter((name) => {
      const selectors = getSelectors(adapter.id, name);
      return selectors && isNativeThemeControlled(adapter.id, name);
    })
    .map((name) => {
      const selectors = getSelectors(adapter.id, name);
      const semantic = getSemantic(adapter.id, name);
      // 优先采样真正承载主题样式的受控壳体（区别于 fallback 链首项即输入框的情形）。
      return { name, selectors, controllingSelector: semantic?.controllingSelector ?? null };
    })
    // A-03：当受控组件没有独立的「受控壳体」（controllingSelector，如 composer 的
    // 可编辑输入框本身就是锚点）且其锚点选择器落在 nonControlled 中时，采样会把这些
    // 非受控节点计入漂移判定、制造误报 —— 剔除此类 probe；有 controllingSelector 的
    // 一律保留（始终采样真正承载主题的壳体）。
    .filter((probe) => {
      if (probe.controllingSelector) return true;
      const semantic = getSemantic(adapter.id, probe.name);
      const nonControlled = semantic?.nonControlled ?? [];
      if (!Array.isArray(nonControlled) || nonControlled.length === 0) return true;
      return !nonControlled.some((nc) => probe.selectors.includes(nc));
    });
  const probesJson = JSON.stringify(probes);
  const optsJson = JSON.stringify(samplingOpts);
  const runtime = STYLE_RUNTIME_SOURCE;
  return `
    // Style sampling (RFC §2.7 序5 / CV-05) — detect "selector present but the
    // theme is not actually taking effect" drift by comparing the computed
    // styles of key controlled nodes against the resolved theme tokens.
    const __styleRuntime = ${runtime};
    const __styleOpts = ${optsJson};
    const __styleProbes = ${probesJson};
    const styleSampling = (() => {
      if (!document.getElementById('agentskin-theme-style-' + appId)) {
        return { pass: true, matchRatio: 1, judged: 0, misses: [], reason: 'style-not-present' };
      }
      const rootCs = getComputedStyle(document.documentElement);
      const token = (name) => (rootCs.getPropertyValue(name) || '').trim() || null;
      const tokens = {
        text: token('--agentskin-text'),
        surface: token('--agentskin-surface'),
        border: token('--agentskin-border'),
      };
      // 优先取受控壳体（controllingSelector），再按 fallback 链依次兜底。
      const visibleSample = (probe) => {
        const chain = probe.controllingSelector
          ? [probe.controllingSelector, ...probe.selectors]
          : probe.selectors;
        for (const sel of chain) {
          let node;
          try { node = document.querySelector(sel); } catch { node = null; }
          if (!node) continue;
          const cs = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden') {
            return cs;
          }
        }
        return null;
      };
      const samples = [{ key: 'root', color: rootCs.color, bg: rootCs.backgroundColor, border: rootCs.borderColor }];
      for (const probe of __styleProbes) {
        const cs = visibleSample(probe);
        if (!cs) continue;
        samples.push({ key: probe.name, color: cs.color, bg: cs.backgroundColor, border: cs.borderColor });
      }
      return __styleRuntime.assessStyleCompliance(samples, tokens, __styleOpts);
    })();
  `;
}

export function buildVerifyExpression(adapter, expectedTheme = null, themeVerification = null, targetTheme = null) {
  const profile = resolveRendererProfile(adapter, targetTheme);
  const expected = JSON.stringify(expectedTheme);
  const expectedProfileId = JSON.stringify(profile?.id ?? null);
  const styleSamplingSnippet = buildStyleSamplingSnippet(adapter);
  return `(() => {
    ${buildCompatibilityPrelude(adapter, themeVerification)}
    ${styleSamplingSnippet}
    const expected = ${expected};
    const expectedProfileId = ${expectedProfileId};
    const state = window.__AGENTSKIN__?.hosts?.[appId];
    const profile = state?.verifyProfile?.() ?? null;
    const profileMissing = (profile?.missing ?? []).map((item) => ({
      scope: 'profile', context: profile.id ?? state?.profileId ?? null, severity: 'required',
      name: item.name, selectors: item.selectors ?? [], invalidSelectors: [],
    }));
    const result = {
      ...compatibility,
      installed: Boolean(state),
      themeId: state?.themeId ?? null,
      version: state?.version ?? null,
      stylePresent: Boolean(document.getElementById('agentskin-theme-style-' + appId)),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      images: state?.imageNames ?? [],
      profile,
      styleSampling,
      styleDrift: !styleSampling.pass,
    };
    result.missing = [...result.missing, ...profileMissing];
    const themeMatches = !expected || (result.themeId === expected.id && result.version === expected.version);
    const profileMatches = !expectedProfileId || (state?.profileId === expectedProfileId && profile?.pass === true);
    result.pass = result.compatible && result.installed && result.stylePresent && themeMatches &&
      profileMatches && (profile?.pass ?? true) && !result.horizontalOverflow;
    return result;
  })()`;
}
