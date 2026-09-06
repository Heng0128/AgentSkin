// SPDX-License-Identifier: MPL-2.0

/**
 * Layer3 加权融合推理引擎（纯函数，无 CDP/DOM 副作用，可单测）
 *
 * 输入：静态规则（agent-rules/*.theme.rule.json，先验假设）+ 运行时探测（runtime-probe-full.json，观测事实）
 * 输出：agent-theme-meta.json（原生模式推理 + 置信度 + 切换能力）
 *
 * 置信度模型（指纹匹配分 fingerprintMatchScore）：
 *   ≥85   high    —— rule 指纹与运行时吻合，采信 rule 业务逻辑，用运行时修正当前 mode
 *   40-84 medium  —— 合并两者，标记风险点
 *   <40   low     —— rule 失效（版本升级/混淆打包），丢弃静态全部业务假设，以运行时为准 + 通用 fallback
 *
 * 关键原则：rule 只是先验假设，永远不能单独作为真相；必须与运行时观测交叉校验。
 */

const DATASET_THEME_KEY_RE = /theme|mode|scheme/i;

/**
 * 从 DOM 上下文推断当前原生模式：dark / light / unknown。
 * @param {object|null} dom —— runtime-probe 的 domContext 字段
 */
export function inferCurrentMode(dom) {
  if (!dom || dom.error) return 'unknown';
  if (dom.prefersDark === true && dom.prefersLight !== true) return 'dark';
  if (dom.prefersLight === true && dom.prefersDark !== true) return 'light';
  for (const k of Object.keys(dom.dataset ?? {})) {
    if (DATASET_THEME_KEY_RE.test(k)) {
      const v = String(dom.dataset[k]).toLowerCase();
      if (v.includes('dark')) return 'dark';
      if (v.includes('light')) return 'light';
    }
  }
  for (const item of dom.themeStorage ?? []) {
    const v = String(item.value ?? '').toLowerCase();
    if (v.includes('dark')) return 'dark';
    if (v.includes('light')) return 'light';
  }
  return 'unknown';
}

/**
 * 指纹相似度打分（0-100）。
 * 比对 rule 指纹（light/darkFingerprint）与运行时观测的 dataset + cssVars 命中率。
 * 指纹为空（如通用 fallback）→ 0，即不匹配任何先验，自然落入 low 置信度。
 *
 * @param {{dataset: object|null, cssVars: object} | null | undefined} ruleFp
 * @param {{dataset: object, cssVars: object}} runtimeObs —— 运行时观测（dataset + 样式 AST 变量 map）
 */
export function fingerprintSimilarity(ruleFp, runtimeObs) {
  const dKeys = Object.keys(ruleFp?.dataset ?? {});
  const vKeys = Object.keys(ruleFp?.cssVars ?? {});
  const total = dKeys.length + vKeys.length;
  if (total === 0) return 0;

  let hit = 0;
  for (const k of dKeys) {
    if (runtimeObs.dataset?.[k] === ruleFp.dataset[k]) hit += 1;
  }
  for (const k of vKeys) {
    if (runtimeObs.cssVars?.[k] === ruleFp.cssVars[k]) hit += 1;
  }
  return Math.round((hit / total) * 100);
}

/** 把样式 AST 的 rootVars + adoptedRootVars 拍平成 name→value map（root 优先，与指纹生成口径一致）。 */
function buildRuntimeVarMap(styleAst) {
  const map = {};
  for (const v of styleAst?.rootVars ?? []) map[v.name] = v.value;
  for (const v of styleAst?.adoptedRootVars ?? []) {
    if (map[v.name] === undefined) map[v.name] = v.value;
  }
  return map;
}

/**
 * 加权融合推理：静态规则 + 运行时观测 → agent-theme-meta。
 *
 * @param {object|null} rule —— agent-rules/*.theme.rule.json 的内容（可为 null，等价于无先验）
 * @param {object} runtimeProbe —— runtime-probe-full 的探测结果（含 domContext/styleAst/shadowDom）
 */
export function inferMeta(rule, runtimeProbe) {
  const dom = runtimeProbe?.domContext;
  const styleAst = runtimeProbe?.styleAst;
  const shadowDom = runtimeProbe?.shadowDom;

  const currentNativeMode = inferCurrentMode(dom);
  const runtimeObs = { dataset: dom?.dataset ?? {}, cssVars: buildRuntimeVarMap(styleAst) };

  const matchLightScore = fingerprintSimilarity(rule?.lightFingerprint, runtimeObs);
  const matchDarkScore = fingerprintSimilarity(rule?.darkFingerprint, runtimeObs);
  const fingerprintMatchScore = Math.max(matchLightScore, matchDarkScore);

  let confidence;
  let ruleValid;
  if (fingerprintMatchScore >= 85) {
    confidence = 'high';
    ruleValid = true;
  } else if (fingerprintMatchScore >= 40) {
    confidence = 'medium';
    ruleValid = true;
  } else {
    confidence = 'low';
    ruleValid = false;
  }

  // 切换路径优先级：API > dataset > localStorage（对齐方案"API 优先，其次 dataset/localStorage"）
  const canSilentSwitch = rule?.canSilentSwitch === true;
  const switchMethod = [];
  if (canSilentSwitch) {
    if (rule.globalApiCandidates?.length) switchMethod.push('globalApi');
    if (rule.themePersistCandidates?.some((c) => c.type === 'dataset')) switchMethod.push('dataset');
    if (rule.themePersistCandidates?.some((c) => c.type === 'localStorage')) switchMethod.push('localStorage');
  }

  return {
    agentId: rule?.agentId ?? null,
    confidence,
    fingerprintMatchScore,
    fingerprintDetail: { matchLightScore, matchDarkScore },
    ruleValid,
    currentNativeMode,
    modeSource: {
      prefersDark: dom?.prefersDark ?? null,
      prefersLight: dom?.prefersLight ?? null,
      datasetTheme: dom?.dataset?.theme ?? null,
      metaColorScheme: dom?.metaColorScheme ?? null,
    },
    canSilentSwitch,
    switchMethod,
    lazyComponentRisk: rule?.lazyRiskComponents ?? [],
    closedShadowRisk: shadowDom?.closedShadowRisk ?? [],
    adoptedStyleSheetDetected: !!(styleAst && !styleAst.error && styleAst.adoptedSheets > 0),
    baselineRefs: {
      light: rule?.lightFingerprint ?? null,
      dark: rule?.darkFingerprint ?? null,
    },
  };
}
