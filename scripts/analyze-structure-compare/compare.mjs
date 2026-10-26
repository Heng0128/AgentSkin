// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — 对拍逻辑
 *
 * 对比运行时结构与静态包结构，输出结构漂移结论。
 */

import { listAdapters } from '../../src/engine/src/adapters/index.mjs';
import { DIFF_LIST_CAP } from './constants.mjs';

// ---------------------------------------------------------------------------
// 噪声过滤
// ---------------------------------------------------------------------------

const IGNORE_UTILITY_RE =
  /^(hover|focus|active|disabled|checked|selected|visited|link|first|last|odd|even):/;
const IGNORE_CLASS_RE =
  /^(flex|block|inline|grid|table|hidden|visible|relative|absolute|fixed|sticky|rounded|border|shadow|text-|bg-|p-|m-|w-|h-|gap-|items-|justify-|self-|overflow-|cursor-|select-|pointer-events-|object-|aspect-|break-|list-|font-|leading-|tracking-|whitespace-|uppercase|lowercase|capitalize|not-italic|underline|overline|line-through|antialiased|subpixel-antialiased|truncate|ellipsis|break-|line-clamp-|placeholder|caret-|accent-|appearance-|outline-|ring-|decoration-|fill-|stroke-|scroll-|snap-|columns-|backdrop-|transition|duration|ease|delay|animate|transform|origin|translate-|scale-|rotate-|skew-|origin-)/;
const IGNORE_HASH_RE = /_[A-Za-z0-9]{6,}/; // CSS Modules 哈希

function isCssModuleNoise(token) {
  return IGNORE_UTILITY_RE.test(token) || IGNORE_CLASS_RE.test(token) || IGNORE_HASH_RE.test(token);
}

// ---------------------------------------------------------------------------
// 对拍核心
// ---------------------------------------------------------------------------

/**
 * 构建对拍结果。
 * @param adapter  Agent 适配器配置
 * @param runtime  运行时探测结果
 * @param statik   静态解包结果
 * @param ignore   黑白名单
 */
export function buildCompare(adapter, runtime, statik, ignore) {
  const runtimeClasses = new Map(runtime.classInventory?.top ?? []);
  const staticClasses = new Set(statik.classTokens?.tokens ?? []);
  const runtimeVars = new Set(runtime.rootVars?.names ?? []);
  const staticVars = new Set(statik.cssVars?.names ?? []);

  // 类名对比
  const classes = { shared: [], onlyStatic: [], onlyRuntime: [] };
  for (const [name, count] of runtimeClasses) {
    if (staticClasses.has(name)) classes.shared.push({ name, count });
    else if (!ignore.classTokens.has(name)) classes.onlyRuntime.push({ name, count });
  }
  for (const name of staticClasses) {
    if (!runtimeClasses.has(name) && !ignore.classTokens.has(name)) classes.onlyStatic.push(name);
  }
  classes.onlyRuntime.sort((a, b) => b.count - a.count);

  // 变量对比
  const vars = { shared: [], onlyStatic: [], onlyRuntime: [] };
  for (const name of runtimeVars) {
    if (staticVars.has(name)) vars.shared.push(name);
    else if (!ignore.cssVars.has(name)) vars.onlyRuntime.push(name);
  }
  for (const name of staticVars) {
    if (!runtimeVars.has(name) && !ignore.cssVars.has(name)) vars.onlyStatic.push(name);
  }

  // 覆盖率
  const classCoverage = runtimeClasses.size
    ? `${Math.round((classes.shared.length / runtimeClasses.size) * 100)}%`
    : '—';
  const varCoverage = runtimeVars.size
    ? `${Math.round((vars.shared.length / runtimeVars.size) * 100)}%`
    : '—';

  // bridge 变量对比
  const bridge = [];
  const bridgeMissing = [];
  for (const entry of adapter.bridge ?? []) {
    const declaredInStatic = staticVars.has(entry.var);
    const runtimeRoot = runtime.bridgeReach?.root ?? {};
    const runtimeBody = runtime.bridgeReach?.body ?? {};
    const reachableRoot = entry.var in runtimeRoot;
    const reachableBody = entry.var in runtimeBody;
    const reachable = reachableRoot || reachableBody;
    const status = reachable ? 'ok' : declaredInStatic ? 'component-scoped' : 'missing';
    bridge.push({ ...entry, declaredInStatic, reachable, status });
    if (!reachable) bridgeMissing.push({ ...entry, declaredInStatic });
  }

  // verification 选择器漂移
  const verificationDrift = runtime.landmarkChecks ?? [];

  // Tailwind @theme-inline 组件级主题模式识别
  const themeHint = [];
  const brRootKeys = Object.keys(runtime.bridgeReach?.root ?? {});
  const brBodyKeys = Object.keys(runtime.bridgeReach?.body ?? {});
  const bridgeReachEmpty = brRootKeys.length === 0 && brBodyKeys.length === 0;
  if (statik.cssVars?.unique > 0 && (runtime.rootVars?.unique ?? 0) === 0 && bridgeReachEmpty) {
    themeHint.push(
      `检测疑似 Tailwind @theme-inline 模式：静态声明 ${statik.cssVars.unique} 个 CSS 变量，但运行时 :root 读取不到（变量仅组件作用域），当前 :root 桥接策略会失效，需改为组件级注入`,
    );
  }

  const onlyStaticCssModules = classes.onlyStatic.filter(isCssModuleNoise);
  const verdicts = [];
  if (classes.onlyStatic.length) {
    const cssModules = onlyStaticCssModules.length;
    verdicts.push(
      `静态声明但运行时未出现 ${classes.onlyStatic.length} 个类名${cssModules ? `（其中疑似 CSS Modules 哈希 ${cssModules} 个，属正常）` : ''}`,
    );
  }
  if (classes.onlyRuntime.length) {
    verdicts.push(
      `运行时出现 ${classes.onlyRuntime.length} 个静态抓不到的类名（动态生成 / CSS Modules）`,
    );
  }
  if (bridgeMissing.filter((b) => !b.declaredInStatic).length) {
    verdicts.push(
      `bridge 变量 ${bridgeMissing.filter((b) => !b.declaredInStatic).length} 个在静态 CSS 与运行时 :root 均未声明（疑似失效 entry）: ${bridgeMissing
        .filter((b) => !b.declaredInStatic)
        .map((b) => b.var)
        .join(', ')}`,
    );
  }
  const componentScoped = bridgeMissing.filter((b) => b.declaredInStatic);
  if (componentScoped.length) {
    verdicts.push(
      `bridge 变量 ${componentScoped.length} 个仅存在于组件作用域（不在 :root），JS getComputedStyle 读不到: ${componentScoped.map((b) => b.var).join(', ')}`,
    );
  }
  const deadLandmarks = verificationDrift.filter((c) => c.visible === 0);
  if (deadLandmarks.length) {
    verdicts.push(
      `适配器 verification 选择器失效 ${deadLandmarks.length} 个: ${deadLandmarks.map((c) => c.selector).join(', ')}`,
    );
  }
  for (const hint of themeHint) verdicts.push(hint);
  if (!verdicts.length) verdicts.push('结构与 bridge entries 均与运行时一致');

  const drift = bridgeMissing.length > 0 || deadLandmarks.length > 0;

  // 高频运行时独有类名（Top-N）
  const onlyRuntimeSorted = classes.onlyRuntime.filter((c) => !isCssModuleNoise(c.name));
  const topRuntimeDiffs = onlyRuntimeSorted.slice(0, DIFF_LIST_CAP);

  return {
    drift,
    classes: {
      sharedCount: classes.shared.length,
      onlyStaticCount: classes.onlyStatic.length,
      onlyRuntimeCount: classes.onlyRuntime.length,
      coverage: classCoverage,
      onlyStaticTop: classes.onlyStatic.slice(0, DIFF_LIST_CAP),
      onlyRuntimeTop: onlyRuntimeSorted.slice(0, DIFF_LIST_CAP),
    },
    vars: {
      sharedCount: vars.shared.length,
      onlyStaticCount: vars.onlyStatic.length,
      onlyRuntimeCount: vars.onlyRuntime.length,
      coverage: varCoverage,
      onlyStaticTop: vars.onlyStatic.slice(0, DIFF_LIST_CAP),
      onlyRuntimeTop: vars.onlyRuntime.slice(0, DIFF_LIST_CAP),
    },
    bridge,
    bridgeMissing,
    verificationDrift,
    themeHint,
    topRuntimeDiffs,
    verdicts,
  };
}

/** 适配器源文件绝对路径（补丁建议的落地目标）。 */
function adapterSourceFile(adapterId) {
  return resolve(`src/engine/src/adapters/${adapterId}.mjs`);
}

/**
 * 自动生成适配器修订建议（源码可落地、机器可读，供 CI / 源码修订消费）。
 * action.type ∈ { remove_verification_selector, remove_bridge_entry, switch_to_component_injection }。
 */
export function buildPatchActions(adapterId, compare) {
  const actions = [];
  const sourceFile = adapterSourceFile(adapterId);
  const adapter = listAdapters().find((a) => a.id === adapterId);
  const recommendedIndex = new Map(
    (adapter?.verification?.recommended ?? []).map((s, i) => [s.name, i]),
  );
  const dead = (compare?.verificationDrift ?? []).filter((c) => c.visible === 0);
  for (const d of dead) {
    const location =
      d.scope === 'root'
        ? 'verification.rootAny'
        : recommendedIndex.has(d.scope)
          ? `verification.recommended[${recommendedIndex.get(d.scope)}].any`
          : `verification.recommended[${d.scope}].any`;
    actions.push({
      type: 'remove_verification_selector',
      target: d.selector,
      scope: d.scope,
      sourceFile,
      patch: { location, current: d.selector, change: 'remove' },
      severity: 'high',
      note: `选择器运行时已无可见命中（matches=${d.matches}），建议从 ${location} 中移除或替换`,
    });
  }
  for (const b of compare?.bridgeMissing ?? []) {
    if (!b.declaredInStatic) {
      actions.push({
        type: 'remove_bridge_entry',
        var: b.var,
        role: b.role,
        sourceFile,
        patch: { location: 'bridge', current: { var: b.var, role: b.role }, change: 'remove' },
        severity: 'high',
        note: '静态 CSS 与运行时 :root 均未声明，疑似失效 entry，建议从 bridge 数组移除',
      });
    } else {
      actions.push({
        type: 'switch_to_component_injection',
        var: b.var,
        role: b.role,
        sourceFile,
        patch: {
          location: 'bridge',
          current: { var: b.var, role: b.role },
          change: 'remove-or-component-inject',
        },
        severity: 'medium',
        note: '变量仅存在于组件作用域（不在 :root），建议改为组件级注入而非 :root 桥接',
      });
    }
  }
  for (const h of compare?.themeHint ?? []) {
    actions.push({
      type: 'switch_to_component_injection',
      target: 'agent-wide',
      sourceFile,
      severity: 'medium',
      note: h,
    });
  }
  return actions;
}
