// SPDX-License-Identifier: MPL-2.0
//
// # check-selector-provenance.mjs — C14 选择器溯源守卫（codex）
//
// 对标上游 Codex-Dream-Skin tools/check-selector-provenance.mjs。engines/codex
// 的每个 Codex DOM 锚点（类名 / [class*="..."] 子串 / [class~="..."] 词项 /
// data-* 属性名 / [data-testid="..."] 值）必须能溯源到
// engines/codex/selectors.contract.json 的某个条目。
//
// 方向一（主检查）：扫描文件中提取的锚点 ⊄ 合同锚点集 → FAIL，
//   提示把新锚点先登记进合同（附 tier 与证据）再用——防化石选择器混入
//   （上游正是靠该流程发现 suggestion-item 双端 22 状态命中 0 次的死锚点）。
// 方向二（反向）：合同条目的锚点在扫描文件中 0 命中 → FAIL（悬空合同条目），
//   保证合同不腐化。
//
// 豁免（不需入合同）：
//   - AgentSkin 自有命名空间：^agentskin- / ^data-agentskin- / ^dream- 类名与属性
//   - 通用语义属性：role / aria-* / contenteditable / tabindex（WAI-ARIA 标准语义）
//   - data-testid 的属性名本身（值仍需溯源：见 testid 值提取）
//   - 纯元素选择器 / 伪类伪元素（提取器只捕 .class 与 [attr] 形态）
//
// 扫描范围（codex 专属，文件清单显式声明）：
//   engines/codex/cosmetic.css           —— 直接扫 CSS 文本（先剥注释）
//   engines/codex/adapter-config.mjs     —— 只扫字符串字面量
//   engines/codex/adapter.mjs            —— 只扫字符串字面量
//   src/engine/src/runtime/profiles/codex-theme-v1.mjs —— 只扫字符串字面量
//
// 注：src/engine/src/adapters/codex.mjs（平台安装路径 / bundleId 等文件路径
// 字符串会误触 .app 等伪锚点）不纳入扫描；其选择器与 engines/codex 同源，
// 由 check-semantic-contract / selector-resolver.test 交叉覆盖。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_PATH = join(ROOT, 'engines/codex/selectors.contract.json');

/** 扫描文件清单：CSS 文件直接解析，mjs 只取字符串字面量（避免把 JS 标识符 / 文件路径误判为锚点）。 */
const SCAN_FILES = [
  { path: 'engines/codex/cosmetic.css', mode: 'css' },
  { path: 'engines/codex/adapter-config.mjs', mode: 'mjs-strings' },
  { path: 'engines/codex/adapter.mjs', mode: 'mjs-strings' },
  { path: 'src/engine/src/runtime/profiles/codex-theme-v1.mjs', mode: 'mjs-strings' },
];

/** 通用语义属性：WAI-ARIA / HTML 标准语义，不属于 Codex 专有 DOM，一律豁免。 */
const GENERIC_ATTRS = new Set(['role', 'contenteditable', 'tabindex']);

/**
 * 属性锚点合格条件：只有 data-* 属性与 http-equiv（CSP 探针）入锚。
 * aria-* / role / contenteditable / tabindex 为通用语义 → 豁免；
 * 方括号日志前缀（"[codex-adapter]"）不满足条件自动豁免。
 */
function isAnchorableAttr(name) {
  if (name === 'http-equiv') return true;
  return /^data-/.test(name) && !GENERIC_ATTRS.has(name);
}

/** AgentSkin 自有命名空间前缀（类名 / 属性名）：注入产物，非目标应用 DOM。 */
const OWNED_PREFIXES = [/^agentskin-/i, /^data-agentskin-/i, /^dream-/i, /^ag-/i];

/** 已知 URL 常量片段（类名正则会从域名点号后误捕）：非选择器，显式忽略。 */
const IGNORED_ANCHORS = new Set(['oaiusercontent', 'com', 'net', 'org']);

function isOwned(anchor) {
  return OWNED_PREFIXES.some((re) => re.test(anchor)) || IGNORED_ANCHORS.has(anchor);
}

// ---------------------------------------------------------------------------
// 锚点提取
// ---------------------------------------------------------------------------

/**
 * 从一段 CSS / 选择器字符串文本中提取锚点。
 * - `.class-name`（含 `\/` 转义复合名，如 group\/home-suggestions；跳过数字
 *   开头的伪锚点——那是 opacity: 0.78 / 0.01ms 一类数值的小数尾巴）
 * - `[class*="substr"]` / `[class~="word"]`
 * - `[data-foo]` / `[data-foo="v"]` / `[data-foo*=...]` → 锚点 = 属性名
 * - `[data-testid="v"]` → 额外产出值锚点 v
 */
function extractAnchors(text, sink, origin) {
  // 类名（转义斜杠复合名按原文捕获，与合同 JSON 的转义写法一致）
  for (const m of text.matchAll(/\.((?:[\w-]|\\\/)+)/g)) {
    const anchor = m[1];
    if (/^[0-9]/.test(anchor)) continue; // 小数尾巴（0.78 → "78"）非类名
    if (!isOwned(anchor)) sink.set(anchor, origin);
  }
  // [class*="..."] 子串锚点
  for (const m of text.matchAll(/\[class\*="([^"]+)"\]/g)) {
    sink.set(m[1], origin);
  }
  // [class~="..."] 词项锚点
  for (const m of text.matchAll(/\[class~="([^"]+)"\]/g)) {
    sink.set(m[1], origin);
  }
  // 属性选择器 → 属性名（class 已由上面两条处理；只有 data-*/aria-*/通用表
  // 属性名入锚——方括号日志前缀（"[codex-adapter]"）不满足前缀条件自动豁免）
  for (const m of text.matchAll(/\[([a-zA-Z-]+)(?:[*^$~|]?=\s*"[^"]*"(?:\s+i)?)?\]/g)) {
    const name = m[1].toLowerCase();
    if (name === 'class' || name === 'data-testid') continue;
    if (!isAnchorableAttr(name)) continue;
    if (isOwned(name)) continue;
    sink.set(name, origin);
  }
  // [data-testid="v"] 值锚点
  for (const m of text.matchAll(/\[data-testid="([^"]+)"\]/g)) {
    sink.set(m[1], origin);
  }
}

/** 提取 JS 文件里的字符串字面量（'...' / "..." / `...`），再从中提锚点。 */
function extractFromMjs(source, sink, origin) {
  // 剥注释——必须单遍扫描、行注释优先：先出现的注释开头获胜。
  // 若分两遍先剥块注释，行注释里的 "/*"（如 `// codex-sandbox://*.web-…`）
  // 会被误认成块注释开头，非贪婪吞到几千字符外的下一个 "*/"，
  // 整段代码（含合法选择器字符串）被误删（2026-09-08 实测踩坑）。
  // 行注释用 [^:] 前瞻保护 URL 里的 "://"。
  const noComments = source.replace(
    /(^|[^:])\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, linePrefix) => (linePrefix !== undefined ? linePrefix : ''),
  );
  for (const m of noComments.matchAll(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|`([^`\\]*(?:\\.[^`\\]*)*)`/g)) {
    let literal = m[1] ?? m[2] ?? m[3];
    if (!literal) continue;
    // 模板字符串先剥 ${...} 插值——里面的 Math.round(x.left) 一类成员访问
    // 会被类名正则误捕为 .round/.left 锚点。
    literal = literal.replace(/\$\{[^}]*\}/g, '');
    // 反转义为运行时字面文本：\\→\，\/→/（JS 语义），\' \" \` → 原字符。
    // 用逐字符回溯（\\(.)→$1）保证 '\\/' 还原为 '\/'（CSS 转义形态保留）。
    const unescaped = literal.replace(/\\(.)/g, '$1');
    extractAnchors(unescaped, sink, origin);
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8'));
  const contractAnchors = new Map(); // anchor -> key（tier 查询用）
  for (const entry of contract.selectors) {
    for (const anchor of entry.anchors) contractAnchors.set(anchor, entry.key);
  }

  // 锚点 -> 首次出现位置（file:line 便于修错）
  const found = new Map();
  for (const file of SCAN_FILES) {
    const source = readFileSync(join(ROOT, file.path), 'utf8');
    if (file.mode === 'css') {
      const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
      extractAnchors(noComments, found, file.path);
    } else {
      extractFromMjs(source, found, file.path);
    }
  }

  const failures = [];

  // 方向一：扫描到的锚点必须在合同中
  const unknown = [...found.keys()].filter((a) => !contractAnchors.has(a)).sort();
  if (unknown.length) {
    failures.push(
      `[C14] 以下 ${unknown.length} 个锚点未在 engines/codex/selectors.contract.json 登记：\n` +
        unknown
          .map((a) => `    - ${a}  (首见: ${found.get(a)})`)
          .join('\n') +
        `\n    -> 新锚点须先在合同登记（附 tier 与证据）再进入 CSS/JS；若为误捕请调整提取器豁免。`,
    );
  }

  // 方向二：合同条目必须在扫描文件中至少命中一个锚点（悬空条目）
  const usedAnchors = new Set(found.keys());
  const deadEntries = contract.selectors.filter((entry) =>
    entry.anchors.length > 0 && !entry.anchors.some((a) => usedAnchors.has(a)),
  );
  if (deadEntries.length) {
    failures.push(
      `[C14] 以下合同条目的锚点在扫描文件中 0 命中（悬空条目）：\n` +
        deadEntries.map((e) => `    - ${e.key} (${e.anchors.join(' | ')})`).join('\n') +
        `\n    -> 条目已不被任何引擎文件消费，请删除或标注消费者后更新扫描清单。`,
    );
  }

  if (failures.length) {
    console.error(`[check-selector-provenance] FAIL\n\n${failures.join('\n\n')}\n`);
    process.exit(1);
  }
  console.log(
    `[check-selector-provenance] ok (${contract.selectors.length} contract entries, ${found.size} anchors verified across ${SCAN_FILES.length} files)`,
  );
}

try {
  main();
} catch (err) {
  console.error(`[check-selector-provenance] ERROR: ${err.message}`);
  process.exit(1);
}
