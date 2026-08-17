// SPDX-License-Identifier: MPL-2.0

/**
 * # regression-runner — 统一回归编排（审计 A-20 / R-22 / Q16）
 *
 * 单命令对全部（或指定）Agent 跑一批**确定性离线引擎不变量**，逐 Agent 超时 + 失败隔离，
 * 产出聚合报告与三态退出码。设计对齐 analyze-structure-compare.mjs 的 CLI/退出码约定。
 *
 * 用法：
 *   node scripts/regression-runner.mjs                     # 全部 6 Agent
 *   node scripts/regression-runner.mjs --agent doubao      # 仅指定 Agent
 *   node scripts/regression-runner.mjs --json out.json     # 写聚合报告
 *   node scripts/regression-runner.mjs --ci                # 精简表格输出
 *   node scripts/regression-runner.mjs --dry-run           # 仅枚举 Agent×Phase，不执行
 *
 * 退出码：0=全通过；2=任一 Agent 出现失败阶段（fail fast 止损）。
 *
 * ## 阶段扩展
 * 本脚本默认运行**离线、确定性**的引擎不变量（不触达真实 DOM/CDP，故可在 CI 复跑）。
 * 需要串接 CDP 探针（extract/verify/rebuild）等重流程时，在 `PHASES` 中追加可串行/可注入的
 * 阶段实现即可；重流程因耗时长、依赖在线宿主，属手动回归（AGENTSKIN_MANUAL 语义，不进
 * `npm run check`）。
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAdapter, listAdapters } from '../src/engine/src/adapters/index.mjs';
import { isDiagnosticsEnabled } from '../src/engine/src/runtime/diagnostics-kill-switch.mjs';
import { resolveStyleSamplingOpts } from '../src/engine/src/runtime/verify-style.mjs';
import {
  buildSemanticSnapshot,
  validateSnapshotCompatibility,
} from '../src/engine/src/semantic-quant/semantic-snapshot.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 每 Agent 每阶段墙钟超时（ms）。-1 表示不限时。 */
const DEFAULT_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// 阶段：离线确定性引擎不变量
// ---------------------------------------------------------------------------

/** 阶段 1：adapter 契约——adapter 存在、id 自洽、具备阻断型 landmark。 */
async function adapterContract(agentName) {
  const adapter = getAdapter(agentName);
  if (!adapter) throw new Error(`getAdapter 返回空——adapter 未注册`);
  if (adapter.id !== agentName)
    throw new Error(`adapter.id "${adapter.id}" !== 请求 "${agentName}"`);
  const verification = adapter.verification;
  if (!verification) throw new Error(`adapter.verification 缺失`);
  // rootAny 是唯一的阻断型 checkpoint（供 doubao 等只声明 rootAny、不声明 recommended
  // 的适配器通过）；recommended 为可选增强，非硬性要求。
  if (!Array.isArray(verification.rootAny) || verification.rootAny.length === 0) {
    throw new Error(`adapter.verification.rootAny 缺失或为空`);
  }
  if (verification.recommended !== undefined && !Array.isArray(verification.recommended)) {
    throw new Error(`adapter.verification.recommended 非数组`);
  }
}

/** 阶段 2：语义快照——可构建、schema 兼容。 */
async function semanticSnapshot(agentName) {
  const snapshot = buildSemanticSnapshot(agentName);
  if (!snapshot) throw new Error(`buildSemanticSnapshot 返回空`);
  if (!Array.isArray(snapshot.components) || snapshot.components.length === 0) {
    throw new Error(`快照 components 为空`);
  }
  validateSnapshotCompatibility(snapshot);
}

/** 阶段 3：样式采样预算——resolveStyleSamplingOpts 返回合法数值。 */
async function styleVerify(agentName) {
  const opts = resolveStyleSamplingOpts(agentName);
  if (!opts || typeof opts.tolerance !== 'number' || typeof opts.minRatio !== 'number') {
    throw new Error(`resolveStyleSamplingOpts 未返回合法 {tolerance, minRatio}`);
  }
}

/** 阶段 4：诊断开关可解析——kill-switch 查询不抛错且返回布尔。 */
async function killSwitch(agentName) {
  const enabled = isDiagnosticsEnabled(agentName, 'styleSampling');
  if (typeof enabled !== 'boolean') throw new Error(`isDiagnosticsEnabled 未返回布尔`);
}

/** 阶段注册表（新增阶段在此追加，key 即最终报告的 phase 名）。 */
const PHASES = [
  { name: 'adapter-contract', fn: adapterContract },
  { name: 'semantic-snapshot', fn: semanticSnapshot },
  { name: 'style-verify', fn: styleVerify },
  { name: 'kill-switch', fn: killSwitch },
];

// ---------------------------------------------------------------------------
// 编排原语
// ---------------------------------------------------------------------------

function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runPhase(phase, agentName, timeoutMs) {
  const start = Date.now();
  try {
    await withTimeout(phase.fn(agentName), timeoutMs);
    return { name: phase.name, status: 'pass', durationMs: Date.now() - start };
  } catch (error) {
    return {
      name: phase.name,
      status: 'fail',
      error: String(error?.message ?? error),
      durationMs: Date.now() - start,
    };
  }
}

async function runAgent(agentName, timeoutMs) {
  const start = Date.now();
  const phases = await Promise.all(PHASES.map((phase) => runPhase(phase, agentName, timeoutMs)));
  const failed = phases.filter((p) => p.status === 'fail');
  return {
    agentId: agentName,
    status: failed.length ? 'fail' : 'pass',
    durationMs: Date.now() - start,
    phases,
  };
}

// ---------------------------------------------------------------------------
// 聚合（纯函数，便于单测）
// ---------------------------------------------------------------------------

/**
 * 收敛各 Agent 结果 → 摘要 + 退出码。
 * exitCode：0=全通过；2=存在失败 Agent。
 */
export function aggregateRegression(results) {
  const agents = Object.values(results);
  const failedAgents = agents.filter((a) => a.status === 'fail').map((a) => a.agentId);
  return {
    summary: {
      total: agents.length,
      passed: agents.length - failedAgents.length,
      failed: failedAgents.length,
    },
    failedAgents,
    exitCode: failedAgents.length ? 2 : 0,
  };
}

// ---------------------------------------------------------------------------
// 输出 / CLI
// ---------------------------------------------------------------------------

function printReport(results, aggregate, opts) {
  const { summary, failedAgents } = aggregate;
  const rows = Object.values(results).map((r) => LabelsFor(r));
  if (!opts.ci) {
    console.log('\n=== 引擎回归（离线确定性）===');
    console.log(`Agent            ├adapter ├snapshot ├style ├kill`);
    for (const row of rows) console.log(row);
    console.log(`\n摘要: ${summary.total} Agent, pass=${summary.passed}, fail=${summary.failed}`);
  } else {
    for (const r of Object.values(results)) {
      console.log(`${r.agentId}\t${r.status}\t${r.durationMs}ms`);
    }
  }
  if (failedAgents.length > 0) {
    console.error(`✗ 失败: ${failedAgents.join(', ')}`);
  }
}

function LabelsFor(r) {
  const m = new Map(r.phases.map((p) => [p.name, p.status]));
  const cell = (name) => {
    const s = m.get(name);
    return s === 'pass' ? '✅' : s === 'fail' ? '❌' : '·';
  };
  return `${r.agentId.padEnd(12)} ${cell('adapter-contract')}        ${cell('semantic-snapshot')}        ${cell('style-verify')}        ${cell('kill-switch')}`;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };

  const opts = {
    ci: flag('--ci'),
    dryRun: flag('--dry-run'),
    json: value('--json'),
    timeoutMs: (() => {
      const raw = value('--timeout');
      const n = raw === null ? DEFAULT_TIMEOUT_MS : Number(raw);
      return Number.isFinite(n) && n >= 0 ? n : DEFAULT_TIMEOUT_MS;
    })(),
  };

  const requested = value('--agent');
  const adapters = listAdapters().filter((a) => (requested ? a.id === requested : true));
  if (!adapters.length) {
    console.error(
      `未知 agent: ${requested}（可选: ${listAdapters()
        .map((a) => a.id)
        .join(', ')}）`,
    );
    process.exit(2);
  }
  const agentIds = adapters.map((a) => a.id);

  if (opts.dryRun) {
    console.log('DRY-RUN — 将执行的 Agent × Phase:');
    for (const id of agentIds) {
      console.log(`  ${id}: ${PHASES.map((p) => p.name).join(', ')}`);
    }
    return;
  }

  // 逐 Agent 串行（隔离 + 输出确定性），失败不阻断其余。
  const results = {};
  for (const id of agentIds) {
    results[id] = await runAgent(id, opts.timeoutMs);
  }

  const aggregate = aggregateRegression(results);
  printReport(results, aggregate, opts);

  if (opts.json) {
    const outPath = join(root, opts.json);
    writeFileSync(
      outPath,
      JSON.stringify({ results, aggregate, generatedAt: new Date().toISOString() }, null, 2),
    );
    console.log(`\n报告已写入: ${opts.json}`);
  }

  process.exitCode = aggregate.exitCode;
}

// 仅作为 CLI 直接执行时运行（import 本模块用于单测/复用时不产生副作用）。
if (import.meta.main) {
  main().catch((error) => {
    console.error(`regression-runner 崩溃: ${error?.stack ?? error}`);
    process.exit(2);
  });
}
