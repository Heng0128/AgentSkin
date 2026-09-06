// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — 基线对比与 ignore 噪声建议
 */

import { existsSync, readFileSync } from 'node:fs';
import { IGNORE_CLASS_RE, IGNORE_HASH_RE, IGNORE_UTILITY_RE, IGNORE_VAR_RE } from './constants.mjs';
import { debugLog } from './utils.mjs';

/** 读取基线报告（兼容 full `{reports}` 与 light `{summary}` 两种格式），返回 agentId → 结构化快照。 */
export function loadBaseline(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    const list = Array.isArray(raw.summary)
      ? raw.summary
      : Array.isArray(raw.reports)
        ? raw.reports
        : null;
    if (!list) {
      debugLog(`baseline 文件缺少 reports/summary 数组，忽略: ${path}`);
      return null;
    }
    const map = new Map();
    for (const item of list) {
      if (!item?.id) continue;
      const cmp = item.compare ?? {};
      const deadLandmarks = Array.isArray(cmp.deadLandmarks)
        ? cmp.deadLandmarks
        : (cmp.verificationDrift ?? []).filter((x) => x.visible === 0).map((x) => x.selector);
      const bridgeMissing = (cmp.bridgeMissing ?? []).map((b) =>
        typeof b === 'string' ? b : b.var,
      );
      const drift = !!cmp.drift || deadLandmarks.length > 0 || (cmp.themeHint ?? []).length > 0;
      map.set(item.id, {
        status: item.status ?? (drift ? 'DRIFT' : 'OK'),
        drift,
        themeHintCount: (cmp.themeHint ?? []).length,
        deadLandmarks: new Set(deadLandmarks),
        bridgeMissing: new Set(bridgeMissing),
      });
    }
    return map;
  } catch (e) {
    debugLog(`baseline 解析失败（已忽略）: ${e.message}`);
    return null;
  }
}

/** 统一漂移信号：bridge 缺失 / verification 失效 / @theme-inline 提示任一存在即视为有漂移。 */
function hasDriftSignal(cmp) {
  return !!cmp?.drift || (cmp?.themeHint ?? []).length > 0;
}

/**
 * 基线对拍：对比当前结果与基线快照，把「新增漂移」与「恢复」独立出来。
 * isNewDrift = 基线 OK 但当前出现漂移（真正需要告警的新问题）；
 * isRecovered = 基线有漂移但当前已恢复（正向信号）；
 * 持续漂移 = 基线、当前均有（已知问题，不重复告警，避免告警疲劳）。
 */
export function computeBaselineDiff(reports, baseline) {
  const agents = [];
  let newDriftCount = 0;
  let recoveredCount = 0;
  let persistentCount = 0;
  for (const r of reports) {
    const b = baseline.get(r.id);
    const curDead = new Set(
      (r.compare?.verificationDrift ?? []).filter((x) => x.visible === 0).map((x) => x.selector),
    );
    const curBridge = new Set((r.compare?.bridgeMissing ?? []).map((x) => x.var));
    const curHasDrift = hasDriftSignal(r.compare);
    const entry = {
      id: r.id,
      displayName: r.displayName,
      baselineStatus: b ? (b.status ?? 'unknown') : 'absent',
      currentStatus: agentStatus(r),
    };
    if (!b) {
      entry.isNewDrift = curHasDrift;
      entry.note = '基线中无该 Agent 记录（新增 Agent 或首次建基线）';
      if (curHasDrift) newDriftCount++;
      agents.push(entry);
      continue;
    }
    entry.newDeadLandmarks = [...curDead].filter((s) => !b.deadLandmarks.has(s));
    entry.resolvedDeadLandmarks = [...b.deadLandmarks].filter((s) => !curDead.has(s));
    entry.newBridgeMissing = [...curBridge].filter((s) => !b.bridgeMissing.has(s));
    entry.resolvedBridgeMissing = [...b.bridgeMissing].filter((s) => !curBridge.has(s));
    entry.isNewDrift = !b.drift && curHasDrift;
    entry.isRecovered = b.drift && !curHasDrift;
    if (entry.isNewDrift) newDriftCount++;
    if (entry.isRecovered) recoveredCount++;
    if (b.drift && curHasDrift) persistentCount++;
    agents.push(entry);
  }
  return {
    generatedAt: new Date().toISOString(),
    agents,
    newDriftCount,
    recoveredCount,
    persistentCount,
  };
}

function agentStatus(r) {
  if (!r.runtime?.ok || !r.static?.ok) return 'partial';
  if (r.compare?.drift) return 'DRIFT';
  return 'OK';
}

/**
 * ignore 噪声候选提取：扫描各 Agent 的「运行时独有」结构，识别跨 Agent 稳定的
 * 工具类 / CSS Modules 哈希 / 通用变量，输出可直接喂给 `--ignore` 的候选 JSON。
 * 仅产出建议（含理由），不自动套用。
 */
export function buildIgnoreSuggestions(
  reports,
  ignore = { classTokens: new Set(), cssVars: new Set() },
) {
  const analyzed = reports.filter((r) => r.runtime?.ok && r.compare);
  if (!analyzed.length) return null;

  const runtimeTop = analyzed.map((r) => new Map(r.runtime.classInventory?.top ?? []));
  const staticTokens = analyzed.map((r) => new Set(r.static?.classTokens?.tokens ?? []));
  const staticVars = analyzed.map((r) => new Set(r.static?.cssVars?.names ?? []));

  const isNoiseClass = (t) =>
    IGNORE_UTILITY_RE.test(t) || IGNORE_CLASS_RE.test(t) || IGNORE_HASH_RE.test(t);
  const isNoiseVar = (v) => IGNORE_VAR_RE.test(v) || IGNORE_HASH_RE.test(v);

  const classCandidates = new Map();
  const varCandidates = new Map();
  for (let i = 0; i < analyzed.length; i++) {
    const top = runtimeTop[i];
    const statik = staticTokens[i];
    for (const [token, count] of top) {
      if (statik.has(token) || ignore.classTokens.has(token)) continue;
      if (!isNoiseClass(token)) continue;
      let rec = classCandidates.get(token);
      if (!rec) {
        rec = { agents: new Set(), totalFreq: 0 };
        classCandidates.set(token, rec);
      }
      rec.agents.add(i);
      rec.totalFreq += count;
    }
    for (const v of analyzed[i].runtime.rootVars?.names ?? []) {
      if (staticVars[i].has(v) || ignore.cssVars.has(v)) continue;
      if (!isNoiseVar(v)) continue;
      let rec = varCandidates.get(v);
      if (!rec) {
        rec = { agents: new Set() };
        varCandidates.set(v, rec);
      }
      rec.agents.add(i);
    }
  }

  const classTokens = [];
  const cssVars = [];
  const reasons = {};
  for (const [token, rec] of classCandidates) {
    if (rec.agents.size < 2 && rec.totalFreq < 15) continue;
    classTokens.push(token);
    reasons[token] =
      `跨 Agent=${rec.agents.size} 累计频次=${rec.totalFreq}，疑似 Tailwind 工具类 / CSS Modules 噪声`;
  }
  for (const [v, rec] of varCandidates) {
    if (rec.agents.size < 2) continue;
    cssVars.push(v);
    reasons[v] = `跨 Agent=${rec.agents.size} 声明，疑似通用变量噪声`;
  }
  classTokens.sort();
  cssVars.sort();

  return {
    generatedAt: new Date().toISOString(),
    note: '由 --suggest-ignore 自动生成。classTokens/cssVars 可直接作为 --ignore 的输入（建议人工复核后使用）。',
    classTokens,
    cssVars,
    reasons,
  };
}
