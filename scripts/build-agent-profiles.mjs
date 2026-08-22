/**
 * Build Agent Profile - 构建 Theme Studio 可用的 Agent Profile
 *
 * 从爬取数据中提取结构化信息，生成 agents-profiles/ 下的 agent-profile.json
 *
 * 用法：
 *   node scripts/build-agent-profiles.mjs --input agents-raw-data --output agents-profiles
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ============== 颜色处理 ==============

function hexToRgb(hex) {
  if (!hex) return null;
  let h = hex.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length < 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return { r, g, b };
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('')}`;
}

function parseRgba(str) {
  if (!str) return null;
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return {
    r: parts[0] || 0,
    g: parts[1] || 0,
    b: parts[2] || 0,
    a: parts[3] !== undefined ? parts[3] : 1,
  };
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h,
    s,
    l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function _hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

function normalizedHex(val) {
  if (!val) return null;
  // 过滤明显非颜色的值
  if (
    /calc\(|var\(|oklch\(|color-mix|linear-gradient|rgba?\([^)]*\d\s*\)/.test(val) &&
    !/^#[0-9a-fA-F]{3,8}$/.test(val) &&
    !/^rgba?\(\d+,\s*\d+,\s*\d+/.test(val)
  ) {
    // 仍尝试从 rgb() 提取
    if (val.startsWith('rgb')) {
      const rgba = parseRgba(val);
      if (rgba && !Number.isNaN(rgba.r)) return rgbToHex(rgba.r, rgba.g, rgba.b);
    }
    return null;
  }
  // 过滤纯数字、非颜色关键字
  if (/^\d+(\.\d+)?(px|rem|em|%|s|ms)?$/.test(val)) return null;
  if (
    /^(inherit|initial|unset|none|auto|normal|transparent|currentColor|visible|hidden|block|flex|grid|inline|absolute|relative|fixed|sticky)$/i.test(
      val,
    )
  )
    return null;
  if (/^["']/.test(val)) return null; // 字符串值
  if (/^calc\(/.test(val)) return null;
  // 处理 hex
  if (val.startsWith('#')) {
    let h = val.slice(1);
    if (h.length === 3)
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    if (h.length >= 6) return h.slice(0, 6).toUpperCase();
    return null;
  }
  // 处理 rgb/rgba
  if (val.startsWith('rgb')) {
    const rgba = parseRgba(val);
    if (rgba && !Number.isNaN(rgba.r)) return rgbToHex(rgba.r, rgba.g, rgba.b);
  }
  return null;
}

// ============== 变量分类规则 ==============

const RULES = {
  // 背景色类
  backgrounds: [
    /background/i,
    /surface/i,
    /bg-/i,
    /fill(?!-)/i,
    /canvas/i,
    /base(?!-)/i,
    /layer/i,
    /panel(?!-)/i,
    /card/i,
    /popover/i,
    /modal|dialog/i,
    /overlay/i,
    /backdrop/i,
    /container(?!-)/i,
    /layout/i,
    /main-surface/i,
    /editor-/i,
    /sidebar/i,
    /header/i,
    /menubar/i,
    /titlebar/i,
    /tab(?!le)/i,
    /toolbar/i,
    /notification|toast/i,
    /tooltip/i,
  ],
  // 文本色类
  text: [
    /text/i,
    /foreground/i,
    /fg(?!-)/i,
    /label/i,
    /title(?!-)/i,
    /heading/i,
    /paragraph/i,
    /placeholder/i,
    /muted/i,
    /description/i,
    /primary.*text/i,
    /secondary.*text/i,
  ],
  // 边框类
  borders: [/border/i, /divider/i, /separator/i, /outline/i, /stroke(?!-)/i],
  // 主题强调色
  accent: [
    /accent/i,
    /primary/i,
    /brand/i,
    /theme/i,
    /highlight/i,
    /selection/i,
    /focus/i,
    /link/i,
    /caret/i,
    /cursor(?!-)/i,
    /active/i,
    /pressed/i,
    /hover(?!board)/i,
    /checked/i,
    /selected(?!-)/i,
    /current/i,
    /step/i,
    /progress/i,
  ],
  // 语义状态色
  semantic: [
    /error/i,
    /danger/i,
    /danger/i,
    /warning/i,
    /warn/i,
    /success/i,
    /correct/i,
    /passed/i,
    /info/i,
    /notice/i,
    /disabled/i,
    /readonly/i,
    /inactive/i,
    /new/i,
    /modified/i,
    /added/i,
    /deleted/i,
    /removed/i,
    /conflict/i,
    /merged/i,
  ],
  // 阴影
  shadows: [/shadow/i, /elevation/i, /glow/i, /halo/i, /ring(?!er)/i],
  // 字体
  typography: [/font/i, /family/i],
  // 间距
  spacing: [/spacing/i, /gap/i, /margin/i, /padding/i, /size/i, /width(?!-)/i, /height(?!-)/i],
  // 圆角
  radius: [/radius/i, /rounded/i, /corner/i],
  // 按钮
  buttons: [/button/i, /btn/i],
  // 输入框
  inputs: [/input/i, /field/i, /editor/i, /textarea/i, /search/i],
  // 滚动条
  scrollbar: [/scroll/i, /scrollbar/i, /thumb/i, /track(?!ing)/i],
  // 代码块
  code: [
    /code/i,
    /mono/i,
    /syntax/i,
    /keyword/i,
    /string(?!-)/i,
    /comment/i,
    /function/i,
    /variable/i,
    /number/i,
    /type/i,
    /operator/i,
    /punctuation/i,
    /tag-attr/i,
  ],
  // 图标
  icon: [/icon/i, /svg/i, /fill-/i],
  // 渐变
  gradient: [/gradient/i, /from-/i, /to-/i, /via-/i, /stops/i, /position/i],
};

function classifyVariable(name) {
  const lower = name.toLowerCase();
  for (const [category, patterns] of Object.entries(RULES)) {
    for (const pattern of patterns) {
      if (pattern.test(lower)) return category;
    }
  }
  return 'other';
}

// ============== 构建 Token Tree ==============

function buildTokenTree(variables) {
  const tree = {};

  for (const [name, data] of Object.entries(variables)) {
    const hex = normalizedHex(data.value);
    const category = classifyVariable(name);
    const entry = {
      name,
      value: data.value,
      normalized: hex,
      category,
      scheme: data.scheme || 'neutral',
    };

    if (!tree[category]) tree[category] = {};
    if (!tree[category][data.scheme || 'neutral']) tree[category][data.scheme || 'neutral'] = [];
    tree[category][data.scheme || 'neutral'].push(entry);
  }

  return tree;
}

// ============== 提取设计 Token ==============

function extractDesignTokens(_rootVars, lightVars, darkVars) {
  const result = {
    light: {},
    dark: {},
  };

  // 常用的设计 token 查找
  const tokenSearchPaths = {
    background: [
      '--color-background',
      '--bg',
      '--background',
      '--color-bg',
      '--surface',
      '--color-surface',
      '--background-color',
      '--color-canvas',
      '--vscode-editor-background',
      '--color-token-main-surface-primary',
    ],
    foreground: [
      '--color-foreground',
      '--foreground',
      '--text',
      '--color-text',
      '--color-fg',
      '--color',
      '--vscode-foreground',
      '--color-token-primary',
    ],
    surface: [
      '--color-surface',
      '--surface',
      '--color-bg-elevated',
      '--color-card',
      '--color-panel',
      '--panel',
      '--card',
      '--color-container',
      '--color-token-secondary',
    ],
    border: [
      '--color-border',
      '--border',
      '--color-border-primary',
      '--border-color',
      '--color-divider',
      '--color-separator',
      '--vscode-panel-border',
    ],
    accent: [
      '--color-accent',
      '--accent',
      '--primary',
      '--color-primary',
      '--color-brand',
      '--brand',
      '--color-theme',
      '--vscode-focusBorder',
      '--color-token-accent',
    ],
    muted: [
      '--muted',
      '--color-muted',
      '--fg-muted',
      '--text-muted',
      '--color-text-secondary',
      '--vscode-descriptionForeground',
    ],
    error: [
      '--color-error',
      '--error',
      '--color-danger',
      '--danger',
      '--color-red',
      '--vscode-errorForeground',
    ],
    warning: [
      '--color-warning',
      '--warning',
      '--color-warn',
      '--color-yellow',
      '--color-orange',
      '--vscode-warningForeground',
    ],
    success: [
      '--color-success',
      '--success',
      '--color-correct',
      '--color-green',
      '--vscode-testing-iconPassed',
    ],
    info: ['--color-info', '--info', '--color-notice', '--color-blue', '--vscode-infoForeground'],
  };

  function findVar(nameList, vars) {
    for (const name of nameList) {
      // 精确匹配
      if (vars[name]) return vars[name];
      // 模糊匹配
      for (const [k, v] of Object.entries(vars)) {
        if (k.toLowerCase().includes(name.toLowerCase().replace(/^--/, ''))) return v;
        if (name.toLowerCase().includes(k.toLowerCase().replace(/^--/, ''))) return v;
      }
    }
    return null;
  }

  for (const [token, searchPaths] of Object.entries(tokenSearchPaths)) {
    result.light[token] = findVar(searchPaths, lightVars);
    result.dark[token] = findVar(searchPaths, darkVars);
  }

  return result;
}

// ============== 分析 DOM 结构 ==============

function analyzeDomStructure(domTree) {
  if (!domTree) return null;

  const tagCounts = {};
  const classPatterns = {};
  const componentHints = [];

  function walk(node) {
    if (!node) return;
    const tag = node.t || node.tag || node.nodeName?.toLowerCase() || 'unknown';
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;

    // 收集类名模式
    const cls = node.c || node.attrs?.class || node.className;
    if (typeof cls === 'string' && cls) {
      const parts = cls.split(/\s+/).filter(Boolean);
      for (const part of parts) {
        // 简化 Tailwind 类名
        const simplified = part.replace(/[._][a-z0-9]+_[a-z0-9]+/g, '[*]');
        classPatterns[simplified] = (classPatterns[simplified] || 0) + 1;
      }
    }

    // 根据结构推断组件
    if (tag === 'input' || tag === 'textarea' || node.c?.includes('editor')) {
      componentHints.push('input');
    }
    if (tag === 'button' || node.r === 'button') {
      componentHints.push('button');
    }
    if (node.r === 'navigation' || tag === 'nav') {
      componentHints.push('sidebar');
    }
    if (node.c && /header|titlebar|menubar/i.test(node.c)) {
      componentHints.push('header');
    }
    if (node.c && /message|chat|conversation/i.test(node.c)) {
      componentHints.push('chat');
    }

    const children = node.ch || node.children || [];
    for (const child of children) walk(child);
  }

  walk(domTree);

  // 去重组件
  const components = [...new Set(componentHints)];

  // 排序 top tags
  const topTags = Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag, count]) => ({ tag, count }));

  return {
    components,
    topTags,
    totalTags: Object.keys(tagCounts).length,
    samples: topTags.slice(0, 5).map((t) => t.tag),
  };
}

// ============== 主构建流程 ==============

function buildAgentProfile(agentName, rawData) {
  const {
    rootVariables,
    variables,
    categories: _categories,
    colorPalette,
    dom,
    computedSample,
    stats,
    meta,
    stylesheets,
  } = rawData;

  // 1. 变量分类
  const tokenTree = buildTokenTree(variables.neutral.flat);

  // 2. 提取核心设计 token（light vs dark）
  const designTokens = extractDesignTokens(
    rootVariables.default,
    rootVariables.light,
    rootVariables.dark,
  );

  // 3. DOM 结构分析
  const domStructure = analyzeDomStructure(dom.default);
  const domStructureLight = analyzeDomStructure(dom.light);
  const domStructureDark = analyzeDomStructure(dom.dark);

  // 4. 计算样式摘要
  const computedStyleSummary = {};
  for (const [scheme, samples] of Object.entries(computedSample)) {
    if (!samples || !Array.isArray(samples)) continue;
    const bgColors = {};
    const textColors = {};
    const fonts = {};
    const radii = {};

    for (const s of samples) {
      if (!s.style) continue;
      if (s.style.bg) bgColors[s.style.bg] = (bgColors[s.style.bg] || 0) + 1;
      if (s.style.fg) textColors[s.style.fg] = (textColors[s.style.fg] || 0) + 1;
      if (s.style.ff) fonts[s.style.ff] = (fonts[s.style.ff] || 0) + 1;
      if (s.style.br) radii[s.style.br] = (radii[s.style.br] || 0) + 1;
    }

    computedStyleSummary[scheme] = {
      sampleCount: samples.length,
      topBgColors: Object.entries(bgColors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([c, n]) => ({ color: c, count: n })),
      topTextColors: Object.entries(textColors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([c, n]) => ({ color: c, count: n })),
      topFonts: Object.entries(fonts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([f, n]) => ({ font: f, count: n })),
      topRadii: Object.entries(radii)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([r, n]) => ({ radius: r, count: n })),
    };
  }

  // 5. 生成 Profile
  const profile = {
    meta: {
      agent: agentName,
      extractedAt: meta.extractedAt,
      version: '1.0.0',
      source: 'cdp-full-extract',
    },

    // 设计 Token 体系
    tokens: {
      core: designTokens,
      light: {
        rootVars: rootVariables.light,
        varCount: Object.keys(variables.light.flat).length,
        palette: colorPalette.light,
      },
      dark: {
        rootVars: rootVariables.dark,
        varCount: Object.keys(variables.dark.flat).length,
        palette: colorPalette.dark,
      },
    },

    // 分类变量
    tokenTree,

    // DOM 结构地图
    dom: {
      structure: domStructure,
      structureLight: domStructureLight,
      structureDark: domStructureDark,
      samples: {
        default: dom.default,
        light: dom.light,
        dark: dom.dark,
      },
    },

    // 计算样式摘要
    computedSummary: computedStyleSummary,

    // All CSS blocks captured for raw preview reconstruction
    styleBlocks: stylesheets?.styleBlocks ?? [],

    // 统计
    stats,
  };

  return profile;
}

// ============== 入口 ==============

async function main() {
  const args = process.argv.slice(2);
  const inIdx = args.indexOf('--input');
  const outIdx = args.indexOf('--output');
  const inputDir = inIdx >= 0 ? args[inIdx + 1] : 'agents-raw-data';
  const outputDir = outIdx >= 0 ? args[outIdx + 1] : 'agents-profiles';

  const resolvedIn = resolve(inputDir);
  const resolvedOut = resolve(outputDir);

  if (!existsSync(resolvedOut)) {
    mkdirSync(resolvedOut, { recursive: true });
  }

  console.log('=== Build Agent Profiles ===');
  console.log(`输入: ${resolvedIn}`);
  console.log(`输出: ${resolvedOut}`);
  console.log('');

  // 读取所有爬取文件
  const files = readdirSync(resolvedIn).filter((f) => f.endsWith('-full-extract.json'));

  const profiles = {};

  for (const file of files) {
    const agentName = file.replace('-full-extract.json', '');
    console.log(`处理 ${agentName}...`);

    try {
      const rawData = JSON.parse(readFileSync(join(resolvedIn, file), 'utf-8'));
      const profile = buildAgentProfile(agentName, rawData);
      profiles[agentName] = profile;

      // 保存单独的 profile
      const outPath = join(resolvedOut, `${agentName}-profile.json`);
      writeFileSync(outPath, JSON.stringify(profile, null, 2));
      console.log(
        `  ✓ ${agentName}: tokens=${Object.keys(profile.tokens.core.light).length}, categories=${Object.keys(profile.tokenTree).length}, DOM components=${profile.dom.structure?.components?.length || 0}`,
      );
    } catch (e) {
      console.error(`  ✗ ${agentName}: ${e.message}`);
    }
  }

  // 保存汇总
  const summary = {
    generatedAt: new Date().toISOString(),
    profiles: Object.fromEntries(
      Object.entries(profiles).map(([name, p]) => [
        name,
        {
          tokensLight: Object.keys(p.tokens.core.light).filter((k) => p.tokens.core.light[k])
            .length,
          tokensDark: Object.keys(p.tokens.core.dark).filter((k) => p.tokens.core.dark[k]).length,
          categories: Object.keys(p.tokenTree),
          stats: p.stats,
        },
      ]),
    ),
  };

  writeFileSync(join(resolvedOut, '_profiles-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n✓ 完成! ${Object.keys(profiles).length} 个 profile 生成`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
