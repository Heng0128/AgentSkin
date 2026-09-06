// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — 主入口
 *
 * 一键对比 6 个 Agent 的「运行时结构」与「打包声明结构」。
 * 原 scripts/analyze-structure-compare.mjs 已拆分为模块化结构。
 *
 * 用法：
 *   node scripts/analyze-structure-compare/main.mjs                       # 全部 6 个 Agent
 *   node scripts/analyze-structure-compare/main.mjs --agent codex         # 只对比单个
 *   node scripts/analyze-structure-compare/main.mjs --out agents-raw-data # 指定报告输出目录
 *   node scripts/analyze-structure-compare/main.mjs --debug               # 调试日志
 *   node scripts/analyze-structure-compare/main.mjs --markdown            # 额外输出 Markdown 修订清单
 *   node scripts/analyze-structure-compare/main.mjs --ci                  # CI 极简输出 + 语义化退出码
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listAdapters } from '../../src/engine/src/adapters/index.mjs';
import { inferMeta, validateMeta } from '../../src/engine/src/runtime/meta-inference.mjs';
import { buildIgnoreSuggestions, computeBaselineDiff, loadBaseline } from './baseline.mjs';
import { buildCompare, buildPatchActions } from './compare.mjs';
import { applyPatchActions } from './patch-writer.mjs';
import { resolveLivePort } from './port-discovery.mjs';
import {
  buildLightReport,
  printAgentReport,
  printSummaryTable,
  renderMarkdown,
} from './report-renderer.mjs';
import { buildRuleTemplate, FALLBACK_RULE } from './rule-template.mjs';
import { probeRuntime } from './runtime-probe.mjs';
import { probeStatic } from './static-probe.mjs';
import { debugLog, loadIgnoreList, loadShadowSeed, OPTIONS } from './utils.mjs';

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };

  OPTIONS.debug = flag('--debug');
  OPTIONS.markdown = flag('--markdown');
  OPTIONS.ci = flag('--ci');
  OPTIONS.skipCefSubapp = flag('--skip-cef-subapp');
  OPTIONS.ignorePath = value('--ignore');
  OPTIONS.suggestIgnore = flag('--suggest-ignore');
  OPTIONS.rules = flag('--rules');
  OPTIONS.meta = flag('--meta');
  OPTIONS.writePatches = flag('--write-patches');
  OPTIONS.dryRun = flag('--dry-run');
  OPTIONS.shadowSeed = loadShadowSeed(value('--shadow-seed'));

  const requested = value('--agent');
  const outputDir = resolve(value('--out') ?? 'agents-raw-data');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const ignore = loadIgnoreList(OPTIONS.ignorePath);

  const adapters = listAdapters().filter((a) => (requested ? a.id === requested : true));
  if (!adapters.length) {
    console.error(
      `未知 agent: ${requested}（可选: ${listAdapters()
        .map((a) => a.id)
        .join(', ')}）`,
    );
    process.exit(2);
  }

  if (!OPTIONS.ci) {
    console.log(`=== 结构对拍（CDP × 静态解包）===`);
    console.log(
      `目标: ${adapters.map((a) => a.id).join(', ')}${OPTIONS.skipCefSubapp ? ' [--skip-cef-subapp]' : ''}`,
    );
  }

  const reports = [];
  for (const adapter of adapters) {
    let report;
    try {
      const live = await resolveLivePort(adapter);
      let runtime = { ok: false, error: '未检测到运行中的 CDP 端点' };
      if (live) {
        try {
          const target = live.targets.find((t) => t.webSocketDebuggerUrl) ?? live.targets[0];
          runtime = await probeRuntime(adapter, { ...target, port: live.port });
        } catch (e) {
          runtime = { ok: false, error: `CDP 探测异常: ${e.message}` };
        }
      }
      const statik = await probeStatic(adapter);
      report = {
        id: adapter.id,
        displayName: adapter.displayName,
        runtime,
        static: statik,
        compare: runtime.ok && statik.ok ? buildCompare(adapter, runtime, statik, ignore) : null,
      };
    } catch (e) {
      report = {
        id: adapter.id,
        displayName: adapter.displayName,
        runtime: { ok: false, error: `运行时异常: ${e.message}` },
        static: { ok: false, error: '未执行（上游异常）' },
        compare: null,
      };
    }
    reports.push(report);
    if (!OPTIONS.ci) printAgentReport(adapter, report);
  }

  // 补丁自动写回
  let patchResults = null;
  if (OPTIONS.writePatches) {
    const actions = [];
    for (const r of reports) if (r.compare) actions.push(...buildPatchActions(r.id, r.compare));
    patchResults = applyPatchActions(actions, { dryRun: OPTIONS.dryRun });
    const appliedTotal = patchResults.reduce((n, p) => n + p.appliedCount, 0);
    const missedTotal = patchResults.reduce((n, p) => n + p.missedCount, 0);
    if (!OPTIONS.ci) {
      console.log(
        `\n补丁写回: ${OPTIONS.dryRun ? 'dry-run（仅预览，不写文件）' : '已写入适配器源码'} ｜ 确定删除 ${appliedTotal} 条 / 未命中 ${missedTotal} 条`,
      );
      for (const p of patchResults) {
        const verb = p.error
          ? `错误 ${p.error}`
          : p.wrote
            ? '已写入'
            : p.dryRun
              ? '将写入'
              : '无改动';
        console.log(
          `          ${verb} ${p.file}（应用 ${p.appliedCount} / 未命中 ${p.missedCount}）`,
        );
        if (p.dryRun) {
          for (const a of p.applied)
            console.log(
              `            - 将移除 ${a.type}「${a.target}」@${a.location} -> ${a.element}`,
            );
        }
        for (const m of p.missed)
          console.log(
            `            ! 未命中 ${m.type}「${m.target ?? ''}」@${m.location ?? '?'}：${m.reason}`,
          );
      }
    }
    const pp = join(outputDir, '_structure-patches-applied.json');
    writeFileSync(
      pp,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), dryRun: OPTIONS.dryRun, results: patchResults },
        null,
        2,
      ),
    );
    if (!OPTIONS.ci) console.log(`补丁明细: ${pp}`);
  }

  // 基线对比
  let baselineDiff = null;
  const rawBaseline = value('--baseline');
  const baselinePath =
    rawBaseline && !rawBaseline.startsWith('--')
      ? rawBaseline
      : join(outputDir, '_structure-compare.json');
  if (existsSync(baselinePath)) {
    const baseline = loadBaseline(baselinePath);
    if (baseline) {
      baselineDiff = computeBaselineDiff(reports, baseline);
      const bdPath = join(outputDir, '_structure-baseline-diff.json');
      writeFileSync(bdPath, JSON.stringify(baselineDiff, null, 2));
      if (!OPTIONS.ci) {
        console.log(`\n基线对比: ${bdPath}`);
        console.log(
          `          新增漂移 ${baselineDiff.newDriftCount} / 恢复 ${baselineDiff.recoveredCount} / 持续 ${baselineDiff.persistentCount}`,
        );
        for (const a of baselineDiff.agents) {
          if (a.isNewDrift) {
            const extra = [
              a.newDeadLandmarks?.length ? `失效选择器: ${a.newDeadLandmarks.join(', ')}` : null,
              a.newBridgeMissing?.length ? `bridge 缺失: ${a.newBridgeMissing.join(', ')}` : null,
            ]
              .filter(Boolean)
              .join(' ');
            console.log(
              `          [新增] ${a.displayName}（${a.id}）${a.note ?? ''}${extra ? ` ${extra}` : ''}`,
            );
          }
          if (a.isRecovered) console.log(`          [恢复] ${a.displayName}（${a.id}）`);
        }
      }
    }
  }

  // 产物 1：全量原始 JSON
  const fullPath = join(outputDir, '_structure-compare.json');
  writeFileSync(
    fullPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2),
  );
  // 产物 2：轻量结构化摘要
  const lightPath = join(outputDir, '_structure-compare-light.json');
  writeFileSync(lightPath, JSON.stringify(buildLightReport(reports, baselineDiff), null, 2));
  // 产物 3：Markdown 修订清单
  let mdPath = null;
  if (OPTIONS.markdown) {
    mdPath = join(outputDir, '_structure-compare-report.md');
    writeFileSync(mdPath, renderMarkdown(reports, baselineDiff), 'utf-8');
  }

  // 产物 4：ignore 噪声候选
  if (OPTIONS.suggestIgnore) {
    const suggest = buildIgnoreSuggestions(reports, ignore);
    if (suggest) {
      const sp = join(outputDir, '_ignore.suggest.json');
      writeFileSync(sp, JSON.stringify(suggest, null, 2));
      if (!OPTIONS.ci)
        console.log(
          `\nignore 建议: ${sp}（类名 ${suggest.classTokens.length} / 变量 ${suggest.cssVars.length}）`,
        );
    }
  }

  // 产物 5：规则库初始模板
  if (OPTIONS.rules) {
    const rulesDir = resolve('agent-rules');
    if (!existsSync(rulesDir)) mkdirSync(rulesDir, { recursive: true });
    for (const adapter of adapters) {
      const report = reports.find((r) => r.id === adapter.id);
      if (!report) continue;
      const rule = buildRuleTemplate(adapter, report);
      const rp = join(rulesDir, `${adapter.id}.theme.rule.json`);
      writeFileSync(rp, JSON.stringify(rule, null, 2));
      if (!OPTIONS.ci)
        console.log(
          `\n规则模板: ${rp}（themeImplMode=${rule.themeImplMode}，persist候选 ${rule.themePersistCandidates.length}）`,
        );
    }
    const fp = join(rulesDir, 'fallback.generic.theme.rule.json');
    writeFileSync(fp, JSON.stringify(FALLBACK_RULE, null, 2));
    if (!OPTIONS.ci) console.log(`规则模板: ${fp}（通用兜底）`);
  }

  // 产物 6：元模型推理 + 自校验
  if (OPTIONS.meta) {
    const rulesDir = resolve('agent-rules');
    const metaOutDir = join(outputDir, 'meta');
    if (!existsSync(metaOutDir)) mkdirSync(metaOutDir, { recursive: true });
    for (const adapter of adapters) {
      const report = reports.find((r) => r.id === adapter.id);
      if (!report) continue;
      if (!report.runtime.ok) {
        if (!OPTIONS.ci)
          console.log(`\n元模型: ${adapter.id} 运行时探测失败，跳过（${report.runtime.error}）`);
        continue;
      }
      let rule = null;
      const rulePath = join(rulesDir, `${adapter.id}.theme.rule.json`);
      if (existsSync(rulePath)) {
        try {
          rule = JSON.parse(readFileSync(rulePath, 'utf-8'));
        } catch {
          rule = null;
        }
      }
      const meta = inferMeta(rule, report.runtime);
      const validation = validateMeta(meta, report.runtime);
      const mp = join(metaOutDir, `${adapter.id}.theme.meta.json`);
      const vp = join(metaOutDir, `${adapter.id}.meta-validation.json`);
      writeFileSync(mp, JSON.stringify(meta, null, 2));
      writeFileSync(vp, JSON.stringify(validation, null, 2));
      if (!OPTIONS.ci) {
        console.log(
          `\n元模型: ${mp}（confidence=${meta.confidence} mode=${meta.currentNativeMode} match=${meta.fingerprintMatchScore}）`,
        );
        console.log(`自校验: ${vp}（${validation.status}: ${validation.summary}）`);
      }
    }
  }

  printSummaryTable(reports, baselineDiff);
  if (!OPTIONS.ci) {
    console.log(`\n完整报告: ${fullPath}`);
    console.log(`轻量摘要: ${lightPath}`);
    if (mdPath) console.log(`修订清单: ${mdPath}`);
  }

  // 语义化退出码
  const hasFailure = reports.some((r) => !r.runtime.ok || !r.static.ok);
  let hasDrift = reports.some((r) => r.compare?.drift || (r.compare?.themeHint?.length ?? 0) > 0);
  if (baselineDiff) hasDrift = baselineDiff.newDriftCount > 0;
  process.exitCode = hasFailure ? 2 : hasDrift ? 1 : 0;
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
