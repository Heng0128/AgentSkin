import { getSelectors, isNativeThemeControlled, listSemanticNames } from "./selectivity-registry.mjs";
import { NON_CONTROLLED_CLASS, collectNonControlledSelectors } from "./semantic-filter.mjs";
import { STYLE_RUNTIME_SOURCE } from "./verify-style.mjs";

function safeHostClass(appId) {
  return `agentskin-host-${String(appId).replace(/[^a-z0-9_-]/gi, "-")}`;
}

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
  const css = JSON.stringify(targetTheme.css);
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
    const DISABLED_KEY = '__agentskin_disabled__';
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
  const probes = listSemanticNames(adapter.id)
    .filter((name) => {
      const selectors = getSelectors(adapter.id, name);
      return selectors && isNativeThemeControlled(adapter.id, name);
    })
    .map((name) => ({ name, selectors: getSelectors(adapter.id, name) }));
  const probesJson = JSON.stringify(probes);
  const runtime = STYLE_RUNTIME_SOURCE;
  return `
    // Style sampling (RFC §2.7 序5 / CV-05) — detect "selector present but the
    // theme is not actually taking effect" drift by comparing the computed
    // styles of key controlled nodes against the resolved theme tokens.
    const __styleRuntime = ${runtime};
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
      const visibleSample = (selectors) => {
        for (const sel of selectors) {
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
        const cs = visibleSample(probe.selectors);
        if (!cs) continue;
        samples.push({ key: probe.name, color: cs.color, bg: cs.backgroundColor, border: cs.borderColor });
      }
      return __styleRuntime.assessStyleCompliance(samples, tokens, { tolerance: 0.08, minRatio: 1 });
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
