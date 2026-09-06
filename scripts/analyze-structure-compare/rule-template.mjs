// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — 规则库模板生成
 *
 * Layer1 静态规则库的初始模板，asar 静态解包 + CDP 运行时探测自动推导「可推导」部分，
 * 人工字段（globalApi / globalStorePath / canSilentSwitch / switchSideEffects）留空待人工补全。
 */

import { inferCurrentMode, inferMeta } from '../../src/engine/src/runtime/meta-inference.mjs';
import { validateMeta } from '../../src/engine/src/runtime/meta-validator.mjs';
import {
  FALLBACK_RULE,
  RULE_DIMENSION_VALUE_RE,
  RULE_FINGERPRINT_VAR_RE,
  RULE_THEME_KEY_RE,
} from './constants.mjs';
import { resolveShadowRiskSelectors } from './runtime-probe.mjs';

/** 从运行时 dataset + storage 推导 theme 持久化候选（仅 key 名，供人工确认）。 */
function deriveThemePersistCandidates(dom) {
  const candidates = [];
  if (!dom || dom.error) return candidates;
  for (const k of Object.keys(dom.dataset ?? {})) {
    if (RULE_THEME_KEY_RE.test(k))
      candidates.push({ type: 'dataset', key: k, sampleValue: dom.dataset[k] });
  }
  const seen = new Set();
  for (const item of dom.themeStorage ?? []) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const type = (dom.localStorageKeys ?? []).includes(item.key)
      ? 'localStorage'
      : (dom.sessionStorageKeys ?? []).includes(item.key)
        ? 'sessionStorage'
        : 'storage';
    candidates.push({ type, key: item.key, sampleValue: item.value });
  }
  return candidates;
}

/** 从 adoptedStyleSheets 检测 + @theme-inline 诊断推导 themeImplMode。 */
function deriveThemeImplMode(report) {
  const sa = report.runtime?.styleAst;
  const hints = report.compare?.themeHint ?? [];
  const adopted = sa && !sa.error && sa.adoptedSheets > 0;
  const inline = hints.some(
    (h) => typeof h === 'string' && (/@theme-inline/.test(h) || /组件作用域/.test(h)),
  );
  if (adopted && inline) return 'mixed';
  if (inline) return 'inline';
  if (adopted) return 'adopted';
  return 'classic';
}

/**
 * 推导单模式指纹。关键约束：单次探测只能拿到「当前模式」的观测值，
 * 因此仅当前模式 == 目标模式时才填充 cssVars，另一模式留空（需切换后二次探测或人工补）。
 */
function deriveFingerprint(dom, styleAst, mode) {
  const current = inferCurrentMode(dom);
  const cssVars = {};
  if (current === mode || current === 'unknown') {
    const allVars = [...(styleAst?.rootVars ?? []), ...(styleAst?.adoptedRootVars ?? [])];
    for (const v of allVars) {
      if (
        RULE_FINGERPRINT_VAR_RE.test(v.name) &&
        !RULE_DIMENSION_VALUE_RE.test(v.value) &&
        cssVars[v.name] === undefined
      ) {
        cssVars[v.name] = v.value;
        if (Object.keys(cssVars).length >= 24) break;
      }
    }
  }
  const dataset = {};
  if (current === mode || current === 'unknown') {
    for (const k of Object.keys(dom?.dataset ?? {})) {
      if (RULE_THEME_KEY_RE.test(k)) dataset[k] = dom.dataset[k];
    }
  }
  const fp = { dataset: Object.keys(dataset).length ? dataset : null, cssVars };
  if (current === 'unknown') fp._note = '当前模式未确定，指纹为当前观测值';
  return fp;
}

/**
 * 生成单个 Agent 的规则初始模板。asar 静态解包 + CDP 运行时探测自动推导「可推导」部分，
 * 人工字段（globalApiCandidates/globalStorePathCandidates/canSilentSwitch/switchSideEffects）留空待人工补全。
 */
export function buildRuleTemplate(adapter, report) {
  const { runtime, static: statik } = report;
  const dom = runtime?.domContext;
  const styleAst = runtime?.styleAst;
  const shadowDom = runtime?.shadowDom;
  return {
    agentId: adapter.id,
    displayName: adapter.displayName,
    schemaVer: '1.3',
    _generated: {
      at: new Date().toISOString(),
      from: statik?.asarPath ?? null,
      note: 'asar 静态解包 + CDP 运行时探测自动生成的初始模板；globalApiCandidates/globalStorePathCandidates/canSilentSwitch/switchSideEffects 需人工补全后生效',
    },
    themePersistCandidates: deriveThemePersistCandidates(dom),
    globalApiCandidates: [],
    globalStorePathCandidates: [],
    lazyRiskComponents: ['Modal', 'Dropdown', 'Popover', 'Select', 'Tooltip', 'Dialog'],
    shadowDomRiskSelectors: (() => {
      const observed =
        shadowDom && !shadowDom.error && shadowDom.openHosts?.length
          ? shadowDom.openHosts
              .slice(0, 10)
              .map((h) => `${h.tag}${h.cls?.length ? `.${h.cls.join('.')}` : ''}`)
          : [];
      const seeds = resolveShadowRiskSelectors(adapter.id);
      const merged = [...observed];
      for (const s of seeds) if (!merged.includes(s)) merged.push(s);
      return merged;
    })(),
    themeImplMode: deriveThemeImplMode(report),
    canSilentSwitch: false,
    switchSideEffects: [],
    lightFingerprint: deriveFingerprint(dom, styleAst, 'light'),
    darkFingerprint: deriveFingerprint(dom, styleAst, 'dark'),
  };
}

export { FALLBACK_RULE, inferMeta, validateMeta };
