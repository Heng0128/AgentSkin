// SPDX-License-Identifier: MPL-2.0

/**
 * compare-and-report.mjs — 探测结果对比 + 报告生成
 *
 * 对比维度：
 * 1. probe result（本次探测）vs manifest（已有主题包）
 * 2. token 覆盖分析
 * 3. 选择器一致性
 * 4. 跨 Agent 差异
 *
 * 输出 MD 报告到 tests/probe-suite/output/comparison-report.md
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const OUTPUT_DIR = join(PROJECT_ROOT, 'tests', 'probe-suite', 'output');
const THEMES_DIR = join(PROJECT_ROOT, 'themes');

function loadJsonSafe(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function loadAllThemeManifests() {
  const themes = {};
  const entries = readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const name of entries) {
    const manifestPath = join(THEMES_DIR, name, `${name}.agentskin-theme`, 'manifest.json`);
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      themes[name] = manifest;
    }
  }
  return themes;
}

function loadAllAgentResults() {
  const results = {};
  const agents = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];
  for (const agent of agents) {
    const path = join(OUTPUT_DIR, `${agent}-result.json`);
    results[agent] = loadJsonSafe(path);
  }
  return results;
}

function extractThemeTokens(manifest) {
  return manifest?.colors || {};
}

function extractThemeProbeNamespaces(manifest) {
  return manifest?.probe?.tokenNamespaces || [];
}

function extractTargetAgents(manifest) {
  if (manifest?.supportedAgents) return manifest.supportedAgents;
  if (manifest?.targets) return Object.keys(manifest.targets);
  return [];
}

function generateComparisonReport(themes, agentResults) {
  const lines = [];
  lines.push('# AgentSkin 探针 vs 解包 对比报告');
  lines.push('');
  lines.push(`> 生成时间: ${new Date().toISOString()}`);
  lines.push(`> 主题包数: ${Object.keys(themes).length}`);
  lines.push(`> Agent 数: 6 (traework / qoderwork / workbuddy / doubao / codex / zcode)`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // 执行状态总览
  lines.push('## 一、执行状态总览');
  lines.push('');
  lines.push('| Agent | CDP 状态 | 主题 CSS 数 | 状态说明 |');
  lines.push('|-------|---------|------------|---------|');

  const agents = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];
  for (const agent of agents) {
    const result = agentResults[agent];
    const cdpStatus = result?.probe?.status || 'NOT_RUN';
    const themeCount = result?.unpack?.themes?.length || 0;
    const note = cdpStatus === 'CDP_TARGET_UNAVAILABLE'
      ? '目标应用未运行'
      : cdpStatus === 'CDP_AVAILABLE_EVAL_PENDING'
        ? 'CDP 可达但 Eval 待执行'
        : cdpStatus;
    const statusIcon = cdpStatus === 'CDP_TARGET_UNAVAILABLE' ? '🔴' : cdpStatus === 'CDP_AVAILABLE_EVAL_PENDING' ? '🟡' : '🟢';
    lines.push(`| ${agent} | ${statusIcon} ${cdpStatus} | ${themeCount} | ${note} |`);
  }
  lines.push('');

  // 主题包清单
  lines.push('## 二、现有主题包清单');
  lines.push('');
  lines.push('| 主题 ID | 名称 | 模式 | 支持 Agent | Token 数 | 探测命名空间 |');
  lines.push('|---------|------|------|-----------|---------|------------|');

  const sortedThemes = Object.entries(themes).sort(([a], [b]) => a.localeCompare(b));
  for (const [id, manifest] of sortedThemes) {
    const agents = extractTargetAgents(manifest);
    const tokenCount = Object.keys(extractThemeTokens(manifest)).length;
    const namespaces = extractThemeProbeNamespaces(manifest);
    lines.push(
      `| ${id} | ${manifest.displayName || manifest.name || id} | ${manifest.mode || 'unset'} | ${agents.join(', ')} | ${tokenCount} | ${namespaces.length} 项 |`
    );
  }
  lines.push('');

  // 每个 Agent 的解包详情
  lines.push('## 三、各 Agent 解包详情');
  lines.push('');

  for (const agent of agents) {
    const result = agentResults[agent];
    if (!result) {
      lines.push(`### ${agent}`);
      lines.push('');
      lines.push('_无解包数据_');
      lines.push('');
      continue;
    }

    const unpack = result.unpack;
    lines.push(`### ${agent}`);
    lines.push('');
    lines.push(`- **匹配主题数**: ${unpack?.themes?.length || 0}`);
    lines.push(`- **CDP 状态**: ${result?.probe?.status || 'NOT_RUN'}`);
    lines.push('');

    if (unpack?.themes?.length > 0) {
      lines.push('| 主题 | CSS 大小 | Token 数 | 选择器数 | 含 value() | 含 Agent Remap | 目标验证 |');
      lines.push('|------|---------|---------|---------|-----------|---------------|---------|');

      for (const theme of unpack.themes) {
        const verification = theme.manifestAgentTarget
          ? `${theme.manifestAgentTarget.verificationRequired} 项`
          : '无';
        lines.push(
          `| ${theme.themeName} | ${theme.cssSize} B | ${theme.tokenCount} | ${theme.selectorCount} | ${theme.hasInlineValueVar ? '✅' : '—'} | ${theme.hasAgentRemap ? '✅' : '—'} | ${verification} |`
        );
      }
      lines.push('');
    }

    if (unpack?.errors?.length > 0) {
      lines.push('**错误**:');
      for (const err of unpack.errors) {
        lines.push(`- ${err}`);
      }
      lines.push('');
    }
  }

  // 跨主题 token 一致性
  lines.push('## 四、跨主题 Token 一致性分析');
  lines.push('');

  // 选取 traework 为主要 agent 分析
  const traeworkResult = agentResults.traework];
  if (traeworkResult?.unpack?.themes?.length > 0) {
    lines.push('### traework Agent Token 分布');
    lines.push('');
    lines.push('| 主题 | --agentskin-accent | --agentskin-bg | --agentskin-surface | --agentskin-text | --agentskin-muted |');
    lines.push('|------|------------------|---------------|-------------------|---------------|-----------------|');

    for (const theme of traeworkResult.unpack.themes) {
      const tokens = theme.tokens || {};
      const get = (k) => tokens[k] || '—';
      lines.push(
        `| ${theme.themeName} | ${get('--agentskin-accent')} | ${get('--agentskin-bg')} | ${get('--agentskin-surface')} | ${get('--agentskin-text')} | ${get('--agentskin-muted')} |`
      );
    }
    lines.push('');
  }

  // 探测命名空间覆盖
  lines.push('## 五、探测命名空间覆盖分析');
  lines.push('');

  const namespaceCoverage = {};
  for (const [id, manifest] of sortedThemes) {
    const ns = extractThemeProbeNamespaces(manifest);
    const agents = extractTargetAgents(manifest);
    for (const agent of agents) {
      if (!namespaceCoverage[agent]) namespaceCoverage[agent] = new Set();
      for (const n of ns) namespaceCoverage[agent].add(n);
    }
  }

  lines.push('| Agent | manifest 中声明的命名空间 | 主题覆盖率 |');
  lines.push('|-------|------------------------|-----------|');
  for (const agent of agents) {
    const ns = namespaceCoverage[agent] ? Array.from(namespaceCoverage[agent]) : [];
    const themeCount = Object.values(themes).filter((m) => extractTargetAgents(m).includes(agent)).length;
    lines.push(`| ${agent} | ${ns.join(', ') || '_未声明_'} | ${themeCount}/${Object.keys(themes).length} |`);
  }
  lines.push('');

  // CSS 注入技术分析
  lines.push('## 六、注入技术分析（来自解包）');
  lines.push('');

  for (const agent of agents) {
    const result = agentResults[agent];
    if (!result?.unpack?.themes?.length) continue;

    const themesWithVar = result.unpack.themes.filter((t) => t.hasInlineValueVar);
    const themesWithRemap = result.unpack.themes.filter((t) => t.hasAgentRemap);

    lines.push(`### ${agent}`);
    lines.push('');
    lines.push(`- **使用 value() 动态取值的主题**: ${themesWithVar.length}/${result.unpack.thethemes?.length || 0}`);
    lines.push(`- **使用 AGENT_REMAP 的主题**: ${themesWithRemap.length}/${result.unpack.themes?.length || 0}`);
    lines.push('');

    // 最大的 CSS 文件
    const sorted = [...result.unpack.themes].sort((a, b) => b.cssSize - a.cssSize);
    if (sorted.length > 0) {
      lines.push('**CSS 体积排序**:');
      for (const t of sorted.slice(0, 5)) {
        lines.push(`- ${t.themeName}: ${t.cssSize} bytes, ${t.tokenCount} tokens, ${t.selectorCount} selectors`);
      }
      lines.push('');
    }
  }

  // 诊断建议
  lines.push('## 七、诊断与建议');
  lines.push('');

  // 检查是否有 Agent 的 CSS 完全缺失
  lines.push('### Agent CSS 覆盖缺口');
  lines.push('');
  for (const agent of agents) {
    const result = agentResults[agent];
    const themeCount = result?.unpack?.themes?.length || 0;
    if (themeCount === 0) {
      lines.push(`- 🔴 **${agent}**: 无任何主题 CSS（严重缺失）`);
    } else if (themeCount < 5) {
      lines.push(`- 🟡 **${agent}**: 仅 ${themeCount} 个主题 CSS（覆盖不足）`);
    } else {
      lines.push(`- 🟢 **${agent}**: ${themeCount} 个主题 CSS`);
    }
  }
  lines.push('');

  // 命名空间声明缺失
  lines.push('### manifest probe.tokenNamespaces 缺失');
  lines.push('');
  for (const [id, manifest] of sortedThemes) {
    if (!manifest.probe?.tokenNamespaces || manifest.probe.tokenNamespaces.length === 0) {
      const agents = extractTargetAgents(manifest);
      lines.push(`- ⚠️ **${id}**: targets ${agents.join(', ')}，未声明 probe.tokenNamespaces`);
    }
  }
  lines.push('');

  // CSS 注入缺口
  lines.push('### CSS value() / AGENT_REMAP 注入缺口');
  lines.push('');
  for (const agent of agents) {
    const result = agentResults[agent];
    if (!result?.unpack?.themes?.length) continue;

    const noValue = result.unpack.themes.filter((t) => !t.hasInlineValueVar && !t.hasAgentRemap);
    if (noValue.length > 0) {
      lines.push(`- **${agent}**: ${noValue.length} 个主题无动态取值（${noValue.map((t) => t.themeName).join(', ')}）`);
    }
  }
  lines.push('');

  // 总结
  lines.push('## 八、总结');
  lines.push('');
  const totalThemes = Object.keys(themes).length;
  const availableProbes = Object.values(agentResults).filter((r) => r?.probe?.status !== 'CDP_TARGET_UNAVAILABLE').length;
  const availableUnpacks = Object.values(agentResults).filter((r) => r?.unpack?.themes?.length > 0).length;

  lines.push(`| 指标 | 数值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 主题包总数 | ${totalThemes} |`);
  lines.push(`| CDP 探测可达 | ${availableProbes}/6 |`);
  lines.push(`| 解包成功 | ${availableUnpacks}/6 |`);
  lines.push(`| 跨主题 token 一致性 | 待探针实测（当前为静态分析） |`);
  lines.push('');
  lines.push('> **结论**: CDP 目标应用未运行，无法执行实时探针。当前报告基于静态解包分析。');
  lines.push('> 如需完整对比，请先启动 6 个 Agent 应用并开启 remote debugging 端口。');
  lines.push('');

  return lines.join('\n');
}

async function main() {
  console.log('[compare] Loading theme manifests...');
  const themes = loadAllThemeManifests();
  console.log(`[compare] Loaded ${Object.keys(themes).length} theme manifests`);

  console.log('[compare] Loading agent results...');
  const agentResults = loadAllAgentResults();

  console.log('[compare] Generating comparison report...');
  const report = generateComparisonReport(themes, agentResults);

  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  const reportPath = join(OUTPUT_DIR, 'comparison-report.md');
  writeFileSync(reportPath, report, 'utf-8');
  console.log(`[compare] Report written to ${reportPath}`);
}

main().catch(console.error);
