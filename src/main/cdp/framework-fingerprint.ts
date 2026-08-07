// SPDX-License-Identifier: MPL-2.0

/**
 * # framework-fingerprint — UI 框架指纹库
 *
 * 为 AgentSkin 的 CDP 探测层提供第三方 Agent 应用 UI 框架识别能力。
 *
 * ## 与现有架构的配合
 *
 * 当前 adapter 的 matchTarget 流程基于 URL + window title + processMarkers，
 * 不包含 UI 框架维度的判断。本模块作为 **后 matchTarget 补充层** 运行：
 *
 * 1. `matchTarget(target)` 先完成粗筛（确定"这是某个 Agent 的 renderer"）
 * 2. 通过 CDP 注入 sampling 脚本，提取 DOM 类名 + CSS 变量 + data-* 属性
 * 3. 调用 `fingerprintCombined()` 对采样数据进行框架识别
 * 4. 识别结果（framework + confidence）写入诊断日志，并可在未来用于：
 *    - 自动选择最佳注入策略（不同框架的 CSS 作用域机制不同）
    - 在 selectivity-registry 中选择器失效时推断备用选择器
 *    - 主题市场按框架分类筛选主题包
 *
 * ## 识别策略
 *
 * 每个框架有 classPatterns / cssVariables / dataAttributes / domIndicators
 * 四类信号。对每类信号分别计算命中率，再加权合并为置信度：
 *
 *   - classPatterns 权重最高（最稳定），cssVariables 次之，
 *     dataAttributes/domIndicators 作为辅助（命中即大幅加分）。
 *
 * 支持多框架混用场景（如 styled-components + Tailwind 共存），取置信度
 * 最高的作为主框架，其余通过 detectedSignals 暴露证据。
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

export type FrameworkId =
  | 'tailwind'
  | 'mui'
  | 'ant-design'
  | 'element-ui'
  | 'chakra'
  | 'styled-components'
  | 'css-modules'
  | 'vant'
  | 'naive-ui';

export interface FingerprintResult {
  framework: FrameworkId | 'unknown';
  confidence: number;
  version?: string;
  detectedSignals: string[];
}

interface FrameworkSignature {
  classPatterns: RegExp[];
  cssVariables: RegExp[];
  dataAttributes: string[];
  domIndicators: string[];
}

// ---------------------------------------------------------------------------
// 框架特征签名库
// ---------------------------------------------------------------------------

const SIGNATURES: Record<Exclude<FrameworkId, 'unknown'>, FrameworkSignature> = {
  tailwind: {
    classPatterns: [
      // 工具类颜色/尺寸前缀 (bg-blue-500, text-gray-900, ring-blue-500/50)
      /(^|\s)(bg|text|border|ring|shadow|outline|divide|placeholder|accent|caret|fill|stroke|from|via|to)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(-\d{2,3})?(\s|$|\/)/,
      // 布局工具类 (flex, grid-cols-3, justify-center, items-start)
      /(^|\s)(flex|grid|block|inline|hidden|grid-cols-|grid-rows-|flex-|justify-|items-|content-|place-|self-)[a-z-]*/,
      // 通用工具类前缀 (p-4, m-2, w-full, gap-3, rounded-lg, shadow-md, text-sm)
      /(^|\s)(p|m|w|h|gap|rounded|shadow|text|font|leading|tracking|opacity|cursor)-\w+/,
    ],
    cssVariables: [],
    dataAttributes: [],
    domIndicators: [],
  },
  mui: {
    classPatterns: [/\bMui[A-Z][a-zA-Z]*(-\w+)?\b/, /\bcss-[a-z0-9]{5,}\b/],
    cssVariables: [/^--[Mm]ui-/],
    dataAttributes: ['data-mui'],
    domIndicators: [],
  },
  'ant-design': {
    classPatterns: [/\bant-[a-z]+([_-]\w+)*\b/, /\bant-/],
    cssVariables: [/^--ant-/],
    dataAttributes: [],
    domIndicators: ['#app.ant-app', '.ant-layout'],
  },
  'element-ui': {
    classPatterns: [/\bel-[a-z]+([__-]\w+)*\b/],
    cssVariables: [/^--el-/],
    dataAttributes: [],
    domIndicators: [],
  },
  'styled-components': {
    classPatterns: [/\bcss-[a-z0-9]{5,}\b/, /\bsc-[a-zA-Z0-9]+-[a-z0-9]+\b/],
    cssVariables: [],
    dataAttributes: [],
    domIndicators: [],
  },
  'css-modules': {
    classPatterns: [/\b[a-z]+_[a-zA-Z0-9]{5,}_[a-zA-Z0-9]+\b/],
    cssVariables: [],
    dataAttributes: [],
    domIndicators: [],
  },
  chakra: {
    classPatterns: [/\bcss-[a-z0-9]{5,}\b/],
    cssVariables: [/^--chakra-/],
    dataAttributes: [],
    domIndicators: ['[data-theme]'],
  },
  'naive-ui': {
    classPatterns: [
      // naive-ui 组件类：n- 前缀 + 小写组件名 (n-button, n-card, n-space)
      // 使用组件名白名单避免与 Tailwind 的 n-* 数值工具类冲突
      /\bn-(button|card|space|input|select|table|form|menu|modal|drawer|tabs|tab|list|tree|layout|header|footer|aside|main|row|col|grid|grid-item|breadcrumb|dropdown|pagination|date-picker|time-picker|color-picker|slider|slider__button-group|switch|checkbox|radio|rate|progress|tag|badge|avatar|divider|collapse|collapse-item|popover|tooltip|popconfirm|popselect|steps|step|anchor|link|typography|h\d|p|text|ul|ol|li)(--[a-z]+)?(_{2}[a-z]+)?\b/,
    ],
    cssVariables: [/^--n-/],
    dataAttributes: [],
    domIndicators: [],
  },
  vant: {
    classPatterns: [/\bvan-[a-z]+([-_]\w+)*\b/],
    cssVariables: [/^--van-/],
    dataAttributes: [],
    domIndicators: [],
  },
};

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 对单个值匹配所有正则，返回命中数 */
function matchPatterns(value: string, patterns: RegExp[]): number {
  let count = 0;
  for (const re of patterns) {
    if (re.test(value)) count++;
  }
  return count;
}

/** 计算"命中数 / 总量"的安全除法，总量为 0 时返回 0 */
function _ratio(hits: number, total: number): number {
  if (total <= 0) return 0;
  return hits / total;
}

// ---------------------------------------------------------------------------
// 各维度识别函数
// ---------------------------------------------------------------------------

/**
 * 从类名数组中识别 UI 框架。
 * 遍历所有框架签名，对每个框架的 classPatterns 逐一匹配每个类名，
 * 计算命中率 = 命中框架的正则数 / 类名总数，取命中率最高的框架。
 */
export function fingerprintClassnames(classnames: string[]): FingerprintResult {
  if (!classnames || classnames.length === 0) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  const valid = classnames.filter((c) => c && typeof c === 'string');
  if (valid.length === 0) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  let bestId: FrameworkId | 'unknown' = 'unknown';
  let bestScore = 0;
  let bestSignals: string[] = [];

  for (const [fw, sig] of Object.entries(SIGNATURES) as [FrameworkId, FrameworkSignature][]) {
    if (sig.classPatterns.length === 0) continue;

    const matchedClasses = new Set<string>();
    for (const cn of valid) {
      if (matchPatterns(cn, sig.classPatterns) > 0) {
        matchedClasses.add(cn);
      }
    }

    // 置信度：有命中类名 / 总类名，乘以模式覆盖度系数
    const hitRatio = matchedClasses.size / valid.length;
    const patternCoverage =
      sig.classPatterns.length > 0
        ? Math.min(
            1,
            [...matchedClasses].reduce((acc, cn) => {
              return acc + (matchPatterns(cn, sig.classPatterns) > 0 ? 1 : 0);
            }, 0) / Math.max(1, sig.classPatterns.length),
          )
        : 0;
    const score = hitRatio * 0.7 + patternCoverage * 0.3;

    if (score > bestScore) {
      bestScore = score;
      bestId = fw;
      bestSignals = [...matchedClasses].slice(0, 5).map((c) => `class:${c}`);
    }
  }

  // 最低置信度阈值：至少 10% 的类名命中
  if (bestScore < 0.1) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  return {
    framework: bestId,
    confidence: Math.round(bestScore * 100) / 100,
    detectedSignals: bestSignals,
  };
}

/**
 * 从 CSS 变量名数组中识别 UI 框架。
 * 主要看 --framework-* 前缀变量（如 --mui-palette-primary、--ant-primary-color）。
 */
export function fingerprintCssVars(vars: string[]): FingerprintResult {
  if (!vars || vars.length === 0) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  const valid = vars.filter((v) => v && typeof v === 'string');
  if (valid.length === 0) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  let bestId: FrameworkId | 'unknown' = 'unknown';
  let bestScore = 0;
  let bestSignals: string[] = [];

  for (const [fw, sig] of Object.entries(SIGNATURES) as [FrameworkId, FrameworkSignature][]) {
    if (sig.cssVariables.length === 0) continue;

    const matched = valid.filter((v) => matchPatterns(v, sig.cssVariables) > 0);
    const score = matched.length / valid.length;

    if (score > bestScore) {
      bestScore = score;
      bestId = fw;
      bestSignals = matched.slice(0, 5).map((v) => `cssVar:${v}`);
    }
  }

  if (bestScore < 0.1) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  return {
    framework: bestId,
    confidence: Math.round(bestScore * 100) / 100,
    detectedSignals: bestSignals,
  };
}

// ---------------------------------------------------------------------------
// 组合识别（主入口）
// ---------------------------------------------------------------------------

/**
 * 联合类名、CSS 变量、data-* 属性和 DOM 片段进行综合框架识别。
 *
 * 加权策略：
 *   - classPatterns  权重 0.50（最丰富、最稳定）
 *   - cssVariables   权重 0.25（明确的前缀标识）
 *   - dataAttributes 权重 0.15（框架专属属性，命中率低但特异性极高）
 *   - domIndicators  权重 0.10（结构选择器命中）
 *
 * 各维度独立评分后线性加权。若多个框架竞争，每个维度给各自最佳框架加该维度分，
 * 最终总分最高的胜出。
 */
export function fingerprintCombined(input: {
  classnames: string[];
  cssVars: string[];
  dataAttrs: string[];
  domSnippets: string[];
}): FingerprintResult {
  const { classnames = [], cssVars = [], dataAttrs = [], domSnippets = [] } = input;

  // 若全部为空，直接返回 unknown
  if (
    classnames.length === 0 &&
    cssVars.length === 0 &&
    dataAttrs.length === 0 &&
    domSnippets.length === 0
  ) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  // 各框架累加分数
  const scores = new Map<FrameworkId, number>();
  const signals = new Map<FrameworkId, string[]>();

  for (const fw of Object.keys(SIGNATURES) as FrameworkId[]) {
    scores.set(fw, 0);
    signals.set(fw, []);
  }

  // --- 类名维度 (权重 0.50) ---
  if (classnames.length > 0) {
    const cls = classnames.filter((c) => c && typeof c === 'string');
    for (const [fw, sig] of Object.entries(SIGNATURES) as [FrameworkId, FrameworkSignature][]) {
      if (sig.classPatterns.length === 0) continue;
      const matchedClasses = new Set<string>();
      for (const cn of cls) {
        if (matchPatterns(cn, sig.classPatterns) > 0) {
          matchedClasses.add(cn);
        }
      }
      const hitRatio = cls.length > 0 ? matchedClasses.size / cls.length : 0;
      if (hitRatio > 0) {
        const prev = scores.get(fw) ?? 0;
        scores.set(fw, prev + hitRatio * 0.5);
        const sigs = signals.get(fw) ?? [];
        for (const c of [...matchedClasses].slice(0, 3)) {
          sigs.push(`class:${c}`);
        }
        signals.set(fw, sigs);
      }
    }
  }

  // --- CSS 变量维度 (权重 0.25) ---
  if (cssVars.length > 0) {
    const vars = cssVars.filter((v) => v && typeof v === 'string');
    for (const [fw, sig] of Object.entries(SIGNATURES) as [FrameworkId, FrameworkSignature][]) {
      if (sig.cssVariables.length === 0) continue;
      const matched = vars.filter((v) => matchPatterns(v, sig.cssVariables) > 0);
      if (matched.length > 0) {
        const score = vars.length > 0 ? matched.length / vars.length : 0;
        const prev = scores.get(fw) ?? 0;
        scores.set(fw, prev + score * 0.25);
        const sigs = signals.get(fw) ?? [];
        for (const v of matched.slice(0, 3)) {
          sigs.push(`cssVar:${v}`);
        }
        signals.set(fw, sigs);
      }
    }
  }

  // --- data-* 属性维度 (权重 0.15) ---
  if (dataAttrs.length > 0) {
    const attrs = dataAttrs.filter((a) => a && typeof a === 'string');
    for (const [fw, sig] of Object.entries(SIGNATURES) as [FrameworkId, FrameworkSignature][]) {
      if (sig.dataAttributes.length === 0) continue;
      const hit = sig.dataAttributes.some((ind) => attrs.includes(ind));
      if (hit) {
        const prev = scores.get(fw) ?? 0;
        scores.set(fw, prev + 0.15);
        const sigs = signals.get(fw) ?? [];
        sigs.push(`dataAttr:${sig.dataAttributes.find((a) => attrs.includes(a))}`);
        signals.set(fw, sigs);
      }
    }
  }

  // --- DOM 片段维度 (权重 0.10) ---
  if (domSnippets.length > 0) {
    const snippets = domSnippets.filter((s) => s && typeof s === 'string');
    const joined = snippets.join(' ');
    for (const [fw, sig] of Object.entries(SIGNATURES) as [FrameworkId, FrameworkSignature][]) {
      if (sig.domIndicators.length === 0) continue;
      const hit = sig.domIndicators.some((ind) => joined.includes(ind));
      if (hit) {
        const prev = scores.get(fw) ?? 0;
        scores.set(fw, prev + 0.1);
        const sigs = signals.get(fw) ?? [];
        sigs.push(`dom:${sig.domIndicators.find((d) => joined.includes(d))}`);
        signals.set(fw, sigs);
      }
    }
  }

  // 找到最高分框架
  let bestId: FrameworkId | 'unknown' = 'unknown';
  let bestScore = 0;
  for (const [fw, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestId = fw;
    }
  }

  if (bestScore < 0.05) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  return {
    framework: bestId,
    confidence: Math.round(Math.min(bestScore, 1) * 100) / 100,
    detectedSignals: signals.get(bestId as FrameworkId) ?? [],
  };
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 将 DOMTokenList 或空格分隔的类名字符串批量拆分为数组，然后指纹。
 *
 * 用法示例（CDP 注入脚本中）：
 *   const classList = Array.from(document.querySelectorAll('[class]'))
 *     .flatMap(el => Array.from(el.classList));
 *   const result = fingerprintFromClassList(classList);
 */
export function fingerprintFromClassList(classList: string[]): FingerprintResult {
  if (!classList || classList.length === 0) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  // 将类名展平（支持空格分隔的多类名字符串）
  const flat: string[] = [];
  for (const entry of classList) {
    if (!entry || typeof entry !== 'string') continue;
    const parts = entry.trim().split(/\s+/);
    for (const p of parts) {
      if (p) flat.push(p);
    }
  }

  // 去重
  const unique = [...new Set(flat)];
  return fingerprintClassnames(unique);
}

/**
 * 从多个指纹结果中取置信度最高的那个。
 * 当不同维度的识别结果不一致时（如 classPatterns 指向 Tailwind、
 * cssVars 指向 MUI），此函数做最终仲裁。
 *
 * 若全部为空或全为 unknown，返回 unknown 结果。
 */
export function pickBest(results: FingerprintResult[]): FingerprintResult {
  if (!results || results.length === 0) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  const valid = results.filter((r) => r && r.framework !== 'unknown' && r.confidence > 0);

  if (valid.length === 0) {
    return { framework: 'unknown', confidence: 0, detectedSignals: [] };
  }

  let best = valid[0];
  for (const r of valid) {
    if (r.confidence > best.confidence) {
      best = r;
    }
  }

  // 合并所有最佳框架（置信度相同）的信号
  const tied = valid.filter(
    (r) => r.confidence === best.confidence && r.framework === best.framework,
  );
  const allSignals = new Set<string>();
  for (const r of tied) {
    for (const s of r.detectedSignals) {
      allSignals.add(s);
    }
  }

  return {
    framework: best.framework,
    confidence: best.confidence,
    version: best.version,
    detectedSignals: [...allSignals],
  };
}
