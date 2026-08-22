// SPDX-License-Identifier: MPL-2.0

/**
 * # Semantic Quant Contract Assertion (RFC 2026-08-17-semantic-quant-layer §4.6)
 *
 * Run via: `node scripts/check-semantic-contract.mjs`
 * Exits non-zero on violation so it can gate `npm run check`.
 *
 * 校验规则（全部静态、确定性、无 DOM 依赖）：
 *  1. 语义名对齐：adapter.verification.recommended 的 name 必须存在于
 *     SELECTOR_REGISTRIES（registry ⊇ verification，不校验选择器字符串——避免虚假告警）。
 *  2. 双向一致性：registry 全部 (agentId, semanticName) 必须被规范语义名字典覆盖；
 *     字典的每个语义名必须至少在一个 agent 的 registry 中存在（防悬空/孤儿）。
 *  3. registry key 白名单：每条 entry 仅允许 {selectors, required, description, semantic}
 *     （防 God Object 从字段层面复活）。
 *  4. bindings 防误用：Phase 1 禁止非空 bindings（N:M 例外未出现前不得手写）。
 *  5. 弃用 ID 检查：bindings 引用已弃用 componentId → error；源码字面量引用已弃用
 *     componentId → error（P2-4：不止查 bindings，全局扫源码）。
 *  6. schema 版本：TAXONOMY_SCHEMA_VERSION 必须为正整数。
 *  7. 未来枚举守卫（P1-1 修正版）：成员名从 taxonomy 数据派生（单一数据源），
 *     扫描 src/engine/src/**（排除 semantic-quant/ 自身与测试）禁止引用 Phase2 预留枚举。
 *  8. 依赖方向（门禁 2/3 引擎内部版）：src/engine/src 内仅 runtime/verify-style.mjs
 *     允许 import semantic-quant/*（注入执行层其余模块禁止）。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listAdapters } from '../src/engine/src/adapters/index.mjs';
import { SELECTOR_REGISTRIES } from '../src/engine/src/runtime/selectivity-registry.mjs';
import {
  COMPONENT_ID_TO_SEMANTIC_NAME,
  COMPONENT_INDEX,
  COMPONENT_KIND,
  COMPONENT_LAYER,
  DEPRECATED_ALIASES,
  FUTURE_RESERVED_COMPONENT_KIND,
  FUTURE_RESERVED_COMPONENT_LAYER,
  FUTURE_RESERVED_UI_AREA,
  SEMANTIC_NAME_TO_COMPONENT_ID,
  TAXONOMY_SCHEMA_VERSION,
  UI_AREA,
} from '../src/engine/src/semantic-quant/taxonomy.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

// ---------------------------------------------------------------------------
// 1. 语义名对齐：verification.recommended ⊆ registry
// ---------------------------------------------------------------------------

function checkSemanticNameAlignment() {
  const registryAgents = new Set(Object.keys(SELECTOR_REGISTRIES));
  const adapterAgents = new Set(listAdapters().map((a) => a.id));

  for (const adapter of listAdapters()) {
    const registry = SELECTOR_REGISTRIES[adapter.id];
    if (!registry) {
      fail(`[1] adapter "${adapter.id}" 在 SELECTOR_REGISTRIES 中不存在`);
      continue;
    }
    const verification = adapter.verification ?? {};
    for (const item of verification.recommended ?? []) {
      if (!registry[item.name]) {
        fail(`[1] ${adapter.id}.verification.recommended.${item.name} 在 registry 中不存在`);
      }
    }
  }

  for (const agentId of registryAgents) {
    if (!adapterAgents.has(agentId)) {
      warn(
        `[1] registry 含 "${agentId}"，但 adapters/ 无对应 adapter 文件（若为即将下线的 agent 可忽略）`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 2. 双向一致性：registry 语义名 ↔ 规范语义名字典
// ---------------------------------------------------------------------------

function checkBidirectionalConsistency() {
  // 正向：registry 每个 (agentId, semanticName) 必须被字典覆盖
  for (const [agentId, registry] of Object.entries(SELECTOR_REGISTRIES)) {
    for (const semanticName of Object.keys(registry)) {
      if (semanticName === 'root') continue; // root 为强制基准，字典必须含（见下）
      if (!(semanticName in SEMANTIC_NAME_TO_COMPONENT_ID)) {
        fail(
          `[2] ${agentId}.registry.${semanticName} 未被规范语义名字典覆盖（需在 COMPONENT_ID_TO_SEMANTIC_NAME 登记）`,
        );
      }
    }
  }
  if (!('root' in COMPONENT_ID_TO_SEMANTIC_NAME)) {
    fail(`[2] 字典缺少 root 映射（root 为强制基准）`);
  }

  // 反向：字典每个语义名必须至少在 1 个 agent 的 registry 中存在（防悬空）
  const allSemanticNames = new Set(
    Object.values(SELECTOR_REGISTRIES).flatMap((registry) => Object.keys(registry)),
  );
  for (const semanticName of Object.values(COMPONENT_ID_TO_SEMANTIC_NAME)) {
    if (!allSemanticNames.has(semanticName)) {
      fail(`[2] 字典语义名 "${semanticName}" 在 6 个 agent 的 registry 中均不存在（悬空引用）`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. registry key 白名单（防字段级 God Object）
// ---------------------------------------------------------------------------

const REGISTRY_ENTRY_ALLOWED_KEYS = new Set(['selectors', 'required', 'description', 'semantic']);

function checkRegistryKeyWhitelist() {
  for (const [agentId, registry] of Object.entries(SELECTOR_REGISTRIES)) {
    for (const [semanticName, entry] of Object.entries(registry)) {
      for (const key of Object.keys(entry)) {
        if (!REGISTRY_ENTRY_ALLOWED_KEYS.has(key)) {
          fail(
            `[3] ${agentId}.registry.${semanticName} 出现白名单外字段 "${key}"——语义元数据请放 semantic-quant/taxonomy.mjs，不要扩充 registry`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. bindings 防误用 + 5. 弃用 ID 检查
// ---------------------------------------------------------------------------

function checkBindingsAndDeprecatedIds() {
  const deprecatedIds = Object.keys(DEPRECATED_ALIASES);

  for (const [componentId, meta] of Object.entries(COMPONENT_INDEX)) {
    const bindings = meta.bindings ?? [];
    if (bindings.length > 0) {
      fail(
        `[4] ${componentId}.bindings 非空——Phase 1 禁止手动填写 bindings（仅真实 N:M 例外场景使用）`,
      );
    }
    for (const binding of bindings) {
      if (binding.targetId && deprecatedIds.includes(binding.targetId)) {
        fail(`[5] ${componentId}.bindings 引用了已弃用 componentId: ${binding.targetId}`);
      }
    }
  }
}

// 源码字面量扫描（P2-4）：src/engine/src/**/*.mjs 中出现已弃用 componentId 字符串
function scanSourceForDeprecatedIds() {
  const deprecatedIds = Object.keys(DEPRECATED_ALIASES);
  if (deprecatedIds.length === 0) return;

  const pattern = new RegExp(`["'\`](${deprecatedIds.map(escapeRegExp).join('|')})["'\`]`, 'g');

  for (const file of walkEngineSources()) {
    const src = readFileSync(file, 'utf8');
    pattern.lastIndex = 0;
    for (let m = pattern.exec(src); m !== null; m = pattern.exec(src)) {
      const lineNum = src.substring(0, m.index).split('\n').length;
      fail(
        `[5] ${relative(root, file)}:${lineNum} 源码字面量引用了已弃用 componentId "${m[1]}"（用 resolveComponentId 走别名解析）`,
      );
    }
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// 6. schema 版本检查
// ---------------------------------------------------------------------------

function checkSchemaVersion() {
  if (
    typeof TAXONOMY_SCHEMA_VERSION !== 'number' ||
    !Number.isInteger(TAXONOMY_SCHEMA_VERSION) ||
    TAXONOMY_SCHEMA_VERSION < 1
  ) {
    fail(`[6] TAXONOMY_SCHEMA_VERSION 必须为正整数，当前值: ${TAXONOMY_SCHEMA_VERSION}`);
  }
}

// ---------------------------------------------------------------------------
// 7. 未来枚举守卫（成员名从 taxonomy 数据派生，单一数据源）
// ---------------------------------------------------------------------------

function futureMemberPatterns() {
  const patterns = [];
  const tables = [
    ['UI_AREA', UI_AREA, FUTURE_RESERVED_UI_AREA],
    ['COMPONENT_KIND', COMPONENT_KIND, FUTURE_RESERVED_COMPONENT_KIND],
    ['COMPONENT_LAYER', COMPONENT_LAYER, FUTURE_RESERVED_COMPONENT_LAYER],
  ];
  for (const [tableName, table, reserved] of tables) {
    for (const [memberName, value] of Object.entries(table)) {
      if (reserved.includes(value)) {
        patterns.push(`${tableName}.${memberName}`);
      }
    }
  }
  return patterns;
}

const FUTURE_MEMBER_PATTERNS = futureMemberPatterns();

function scanEngineSourcesForFutureEnums() {
  const pattern = new RegExp(`\\b(${FUTURE_MEMBER_PATTERNS.map(escapeRegExp).join('|')})\\b`, 'g');

  for (const file of walkEngineSources()) {
    const src = readFileSync(file, 'utf8');
    pattern.lastIndex = 0;
    for (let m = pattern.exec(src); m !== null; m = pattern.exec(src)) {
      const lineNum = src.substring(0, m.index).split('\n').length;
      fail(
        `[7] ${relative(root, file)}:${lineNum} 引用了 Phase2 预留枚举 "${m[1]}"——Phase 1 业务代码禁止使用（仅 Theme-Studio 消费）`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 8. 依赖方向（引擎内部）：仅 runtime/verify-style.mjs 允许 import semantic-quant
// ---------------------------------------------------------------------------

const SEMANTIC_QUANT_IMPORT_RE = /(?:from\s+)?["']((?:\.{1,2}\/)+semantic-quant(?:\/[^"']*)?)["']/g;

function scanEngineImportDirection() {
  for (const file of walkEngineSources()) {
    const rel = relative(root, file).replace(/\\/g, '/');
    if (rel.startsWith('src/engine/src/semantic-quant/')) continue; // 模块内部互引

    const src = readFileSync(file, 'utf8');
    SEMANTIC_QUANT_IMPORT_RE.lastIndex = 0;
    for (
      let m = SEMANTIC_QUANT_IMPORT_RE.exec(src);
      m !== null;
      m = SEMANTIC_QUANT_IMPORT_RE.exec(src)
    ) {
      if (rel === 'src/engine/src/runtime/verify-style.mjs') continue; // 白名单
      const lineNum = src.substring(0, m.index).split('\n').length;
      fail(
        `[8] ${rel}:${lineNum} import "${m[1]}"——注入执行层禁止依赖 semantic-quant（仅 verify-style 白名单）`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 引擎源码遍历（排除 semantic-quant/ 自身与测试文件，供守卫 5/7/8 共用）
// ---------------------------------------------------------------------------

function walkEngineSources() {
  const results = [];
  const engineSrc = join(root, 'src/engine/src');

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // semantic-quant/ 是语义层自身（枚举定义处），排除在守卫扫描之外
        if (entry.name === 'semantic-quant') continue;
        walk(full);
        continue;
      }
      const name = entry.name;
      if (!name.endsWith('.mjs')) continue;
      if (name.includes('.test.')) continue;
      results.push(full);
    }
  }

  walk(engineSrc);
  return results;
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

checkSemanticNameAlignment();
checkBidirectionalConsistency();
checkRegistryKeyWhitelist();
checkBindingsAndDeprecatedIds();
scanSourceForDeprecatedIds();
checkSchemaVersion();
scanEngineSourcesForFutureEnums();
scanEngineImportDirection();

if (warnings.length > 0) {
  console.warn('⚠️  Warnings:');
  for (const w of warnings) console.warn(`  - ${w}`);
}

if (errors.length > 0) {
  console.error('❌ Errors:');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('✅ semantic-quant contract check passed');
