// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — 报告渲染
 *
 * 输出单 Agent 报告、汇总表格、Markdown 修订清单、轻量摘要。
 */

import { buildPatchActions } from './compare.mjs';

/** 单 Agent 报告输出。 */
export function printAgentReport(adapter, report) {
  const name = report.displayName;
  console.log(`\n=== ${name} (${report.id}) ===`);
  if (report.runtime.ok) {
    console.log(`  CDP   : ok @:${report.runtime.port} title=${report.runtime.title ?? ''}`);
    console.log(
      `          类名 ${report.runtime.classInventory.unique} | :root 变量 ${report.runtime.rootVars.unique}`,
    );
    const sa = report.runtime.styleAst;
    if (sa && !sa.error) {
      const adopted =
        sa.adoptedSheets > 0
          ? ` | adopted构造样式表=${sa.adoptedSheets}(${sa.adoptedCssRules}条)`
          : '';
      console.log(
        `          样式AST: styleSheets=${sa.styleSheets}(${sa.cssRules}条)${adopted} | :root声明=${sa.rootVars.length} 主题选择器=${sa.themeSelectors.length}`,
      );
    } else {
      console.log(`          样式AST: 不可用${sa?.error ? ` (${sa.error})` : ''}`);
    }
    const sd = report.runtime.shadowDom;
    if (sd && !sd.error) {
      const closed = sd.closedShadowRisk?.length
        ? ` | closed风险=${sd.closedShadowRisk.length}`
        : '';
      const adopted = sd.adoptedInShadow > 0 ? ` | shadow内构造样式表=${sd.adoptedInShadow}` : '';
      console.log(
        `          ShadowDOM: openHost=${sd.openHostCount} 内部元素=${sd.totalShadowEls}${adopted}${closed}`,
      );
    } else {
      console.log(`          ShadowDOM: 不可用${sd?.error ? ` (${sd.error})` : ''}`);
    }
    const te = report.runtime.targetEnumeration;
    if (te && !te.error) {
      const byType = Object.entries(te.byType)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      const fr = te.frames;
      const frameInfo =
        fr && !fr.error
          ? ` | frame=${fr.frameCount} oopif=${fr.oopifCount}${fr.oopifCount ? ' (跨进程边界)' : ''}`
          : '';
      console.log(
        `          Target: total=${te.total}（${byType}）| iframe=${te.iframes.length} worker=${te.workers.length}${frameInfo}`,
      );
    }
    const drift = report.compare?.verificationDrift ?? [];
    const dead = drift.filter((c) => c.visible === 0);
    console.log(
      `          适配器 landmark: 可见 ${drift.filter((c) => c.visible > 0).length}/${drift.length}${dead.length ? `, 失效 ${dead.map((c) => c.selector).join(' | ')}` : ''}`,
    );
  } else {
    console.log(`  CDP   : 不可用 (${report.runtime.error})`);
  }
  if (report.static.ok) {
    const s = report.static.scanned;
    console.log(`  静态  : ok asar=${report.static.asarPath}`);
    console.log(
      `          扫描 JS ${s.jsFiles} 个(${(s.jsBytes / 1024 / 1024).toFixed(1)}MB) / CSS ${s.cssFiles} 个(${(s.cssBytes / 1024 / 1024).toFixed(1)}MB)`,
    );
    console.log(
      `          类名 ${report.static.classTokens.unique} | CSS 变量 ${report.static.cssVars.unique}`,
    );
  } else {
    console.log(`  静态  : 不可用 (${report.static.error})`);
  }
  if (report.compare) {
    const c = report.compare;
    console.log('  对拍  :');
    console.log(
      `          类名 shared=${c.classes.sharedCount} onlyStatic=${c.classes.onlyStaticCount} onlyRuntime=${c.classes.onlyRuntimeCount} 覆盖率=${c.classes.coverage}`,
    );
    console.log(
      `          变量 shared=${c.vars.sharedCount} onlyStatic=${c.vars.onlyStaticCount} onlyRuntime=${c.vars.onlyRuntimeCount} 覆盖率=${c.vars.coverage}`,
    );
    if (c.bridgeMissing.length) {
      console.log(
        `          桥接缺失 ${c.bridgeMissing.map((b) => `${b.var}(${b.role})`).join(', ')}`,
      );
    }
    if (c.themeHint?.length) {
      console.log(`          主题: ${c.themeHint.join('; ')}`);
    }
    for (const v of c.verdicts) console.log(`          - ${v}`);
    const patches = buildPatchActions(adapter.id, report.compare);
    if (patches.length) {
      console.log(`  补丁建议 ${patches.length} 条（--markdown 输出完整修订清单）:`);
      for (const p of patches) {
        const at = p.patch?.location ? ` @${p.patch.location}` : '';
        console.log(`          [${p.severity}] ${p.type}${at} — ${p.note}`);
      }
    }
  }
}

function agentStatus(r) {
  if (!r.runtime?.ok || !r.static?.ok) return 'partial';
  if (r.compare?.drift) return 'DRIFT';
  return 'OK';
}

/** 汇总表格输出。 */
export function printSummaryTable(reports, baselineDiff) {
  console.log('\n\n=== 汇总 ===');
  const bd = baselineDiff ? new Map(baselineDiff.agents.map((a) => [a.id, a])) : null;
  const header = bd
    ? ['agent', 'cdp', 'static', 'clsCov', 'varCov', 'bridge缺', '主题', '基线', '结论']
    : ['agent', 'cdp', 'static', 'clsCov', 'varCov', 'bridge缺', '主题', '结论'];
  const rows = reports.map((r) => {
    const c = r.compare;
    const b = bd?.get(r.id);
    const baselineMark = !b
      ? '—'
      : b.isNewDrift
        ? '新增'
        : b.isRecovered
          ? '恢复'
          : b.baselineStatus === 'DRIFT'
            ? '持续'
            : b.baselineStatus === 'absent'
              ? '无基线'
              : 'OK';
    const row = [
      r.id,
      r.runtime.ok ? 'ok' : '—',
      r.static.ok ? 'ok' : '—',
      c ? c.classes.coverage : '—',
      c ? c.vars.coverage : '—',
      c ? String(c.bridgeMissing.length) : '—',
      c?.themeHint?.length ? '!' : '—',
    ];
    if (bd) row.push(baselineMark);
    row.push(agentStatus(r));
    return row;
  });
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => String(row[i] ?? '').length)),
  );
  const fmt = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');
  console.log(fmt(header));
  for (const row of rows) console.log(fmt(row));
}

/** Markdown 修订清单：直接面向适配器源码修订的可读报告。 */
export function renderMarkdown(reports, baselineDiff) {
  const lines = [];
  lines.push('# AgentSkin 适配器结构漂移修订清单');
  lines.push('');
  lines.push(`> 生成时间：${new Date().toISOString()} ｜ 共 ${reports.length} 个 Agent`);
  if (baselineDiff) {
    lines.push('');
    lines.push('## 基线对拍摘要');
    lines.push('');
    lines.push(`- 新增漂移：**${baselineDiff.newDriftCount}**（基线 OK → 当前出现，需修订）`);
    lines.push(`- 已恢复：**${baselineDiff.recoveredCount}**（基线漂移 → 当前 OK）`);
    lines.push(
      `- 持续漂移：**${baselineDiff.persistentCount}**（基线、当前均有，已知问题不重复告警）`,
    );
  }
  lines.push('');
  for (const r of reports) {
    const status = agentStatus(r);
    lines.push(`## ${r.displayName}（${r.id}）`);
    lines.push('');
    lines.push(`- 运行状态：**${status}**`);
    if (baselineDiff) {
      const b = baselineDiff.agents.find((a) => a.id === r.id);
      if (b) {
        const marks = [];
        if (b.isNewDrift) marks.push('**新增漂移**（基线 OK → 当前漂移）');
        if (b.isRecovered) marks.push('**已恢复**（基线漂移 → 当前 OK）');
        if (b.baselineStatus === 'DRIFT' && !b.isRecovered)
          marks.push('持续漂移（已知问题，不重复告警）');
        if (b.baselineStatus === 'absent') marks.push('基线中无记录（新增 Agent / 首次建基线）');
        if (marks.length) lines.push(`- 基线对拍：${marks.join('；')}`);
        const news = [
          b.newDeadLandmarks?.length
            ? `新增失效选择器 ${b.newDeadLandmarks.length} 个（${b.newDeadLandmarks.join(', ')}）`
            : null,
          b.newBridgeMissing?.length
            ? `新增 bridge 缺失 ${b.newBridgeMissing.length} 个（${b.newBridgeMissing.join(', ')}）`
            : null,
        ].filter(Boolean);
        if (news.length) lines.push(`  - ⚠️ ${news.join('；')}`);
        const resolved = [
          b.resolvedDeadLandmarks?.length
            ? `恢复失效选择器 ${b.resolvedDeadLandmarks.length} 个（${b.resolvedDeadLandmarks.join(', ')}）`
            : null,
          b.resolvedBridgeMissing?.length
            ? `恢复 bridge 缺失 ${b.resolvedBridgeMissing.length} 个（${b.resolvedBridgeMissing.join(', ')}）`
            : null,
        ].filter(Boolean);
        if (resolved.length) lines.push(`  - ✅ ${resolved.join('；')}`);
      }
    }
    if (r.runtime.ok) {
      lines.push(
        `- CDP：ok @:${r.runtime.port}（类名 ${r.runtime.classInventory.unique} / :root 变量 ${r.runtime.rootVars.unique}）`,
      );
      const sa = r.runtime.styleAst;
      if (sa && !sa.error) {
        lines.push(
          `- 样式 AST：styleSheets=${sa.styleSheets}（${sa.cssRules} 条）｜ adoptedStyleSheets=${sa.adoptedSheets}（${sa.adoptedCssRules} 条）｜ :root 声明 ${sa.rootVars.length}｜主题选择器 ${sa.themeSelectors.length}`,
        );
      }
      const sd = r.runtime.shadowDom;
      if (sd && !sd.error) {
        lines.push(
          `- Shadow DOM：open host ${sd.openHostCount}｜内部元素 ${sd.totalShadowEls}｜shadow 内 adoptedStyleSheets ${sd.adoptedInShadow}`,
        );
        if (sd.closedShadowRisk?.length) {
          for (const c of sd.closedShadowRisk)
            lines.push(
              `  - ⚠️ closed shadow 风险：\`${c.selector}\`（host: ${c.host}，matches=${c.matches}）`,
            );
        }
      }
    } else {
      lines.push(`- CDP：不可用（${r.runtime.error}）`);
    }
    if (r.static.ok) {
      lines.push(
        `- 静态解包：${r.static.layout ?? 'asar'}（类名 ${r.static.classTokens.unique} / CSS 变量 ${r.static.cssVars.unique}）`,
      );
    } else {
      lines.push(`- 静态解包：不可用（${r.static.error}）`);
    }
    const c = r.compare;
    if (c) {
      const dead = (c.verificationDrift ?? []).filter((x) => x.visible === 0);
      if (dead.length) {
        lines.push('');
        lines.push('### 失效 verification 选择器');
        for (const d of dead)
          lines.push(`- \`${d.selector}\`（scope: ${d.scope}，matches=${d.matches}）`);
      }
      const neverDeclared = c.bridgeMissing.filter((b) => !b.declaredInStatic);
      const componentScoped = c.bridgeMissing.filter((b) => b.declaredInStatic);
      if (neverDeclared.length || componentScoped.length) {
        lines.push('');
        lines.push('### bridge 变量问题');
        if (neverDeclared.length) {
          lines.push(
            `- **疑似失效 entry（静态 CSS + 运行时 :root 均未声明）**：${neverDeclared.map((b) => `\`${b.var}\`(${b.role})`).join('、')}`,
          );
        }
        if (componentScoped.length) {
          lines.push(
            `- 组件作用域不可达：${componentScoped.map((b) => `\`${b.var}\`(${b.role})`).join('、')}`,
          );
        }
      }
      if (c.themeHint?.length) {
        lines.push('');
        lines.push('### 主题模式提示');
        for (const h of c.themeHint) lines.push(`- ${h}`);
      }
      const patches = buildPatchActions(r.id, c);
      if (patches.length) {
        lines.push('');
        lines.push('### 修订建议（自动生成）');
        for (const p of patches) {
          lines.push(
            `- **[${p.severity}] ${p.type}**：${p.var || p.target || p.scope || 'agent-wide'} — ${p.note}`,
          );
        }
      }
      lines.push('');
      lines.push('### diff 摘要');
      lines.push(
        `- 类名：shared=${c.classes.sharedCount} onlyStatic=${c.classes.onlyStaticCount} onlyRuntime=${c.classes.onlyRuntimeCount}（覆盖率 ${c.classes.coverage}）`,
      );
      lines.push(
        `- 变量：shared=${c.vars.sharedCount} onlyStatic=${c.vars.onlyStaticCount} onlyRuntime=${c.vars.onlyRuntimeCount}（覆盖率 ${c.vars.coverage}）`,
      );
      if (c.topRuntimeDiffs?.length) {
        lines.push('');
        lines.push('### 高频运行时独有类名（Top-N，静态抓不到）');
        for (const d of c.topRuntimeDiffs) lines.push(`- \`${d.name}\` ×${d.count}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 轻量摘要：剔除冗余原始数据，仅保留对拍结论，供外部脚本 / CI 快速消费。 */
export function buildLightReport(reports, baselineDiff) {
  return {
    generatedAt: new Date().toISOString(),
    agents: reports.length,
    baseline: baselineDiff
      ? {
          generatedAt: baselineDiff.generatedAt,
          newDriftCount: baselineDiff.newDriftCount,
          recoveredCount: baselineDiff.recoveredCount,
          persistentCount: baselineDiff.persistentCount,
          agents: baselineDiff.agents.map((a) => ({
            id: a.id,
            displayName: a.displayName,
            baselineStatus: a.baselineStatus,
            currentStatus: a.currentStatus,
            isNewDrift: a.isNewDrift,
            isRecovered: a.isRecovered,
            newDeadLandmarks: a.newDeadLandmarks ?? [],
            newBridgeMissing: a.newBridgeMissing ?? [],
            resolvedDeadLandmarks: a.resolvedDeadLandmarks ?? [],
            resolvedBridgeMissing: a.resolvedBridgeMissing ?? [],
          })),
        }
      : null,
    summary: reports.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      status: agentStatus(r),
      runtime: r.runtime.ok
        ? {
            port: r.runtime.port,
            classes: r.runtime.classInventory.unique,
            vars: r.runtime.rootVars.unique,
            styleAst: r.runtime.styleAst?.error
              ? { error: r.runtime.styleAst.error }
              : {
                  styleSheets: r.runtime.styleAst?.styleSheets ?? null,
                  adoptedSheets: r.runtime.styleAst?.adoptedSheets ?? null,
                  adoptedCssRules: r.runtime.styleAst?.adoptedCssRules ?? null,
                  rootVarDecls: r.runtime.styleAst?.rootVars?.length ?? null,
                  themeSelectors: r.runtime.styleAst?.themeSelectors?.length ?? null,
                },
            shadowDom: r.runtime.shadowDom?.error
              ? { error: r.runtime.shadowDom.error }
              : {
                  openHostCount: r.runtime.shadowDom?.openHostCount ?? null,
                  totalShadowEls: r.runtime.shadowDom?.totalShadowEls ?? null,
                  adoptedInShadow: r.runtime.shadowDom?.adoptedInShadow ?? null,
                  closedShadowRisk: r.runtime.shadowDom?.closedShadowRisk ?? [],
                  seeds: r.runtime.shadowSeeds ?? [],
                },
            targets: r.runtime.targetEnumeration?.error
              ? { error: r.runtime.targetEnumeration.error }
              : {
                  total: r.runtime.targetEnumeration?.total ?? null,
                  byType: r.runtime.targetEnumeration?.byType ?? {},
                  iframes: r.runtime.targetEnumeration?.iframes?.length ?? null,
                  workers: r.runtime.targetEnumeration?.workers?.length ?? null,
                  frames: r.runtime.targetEnumeration?.frames?.error
                    ? { error: r.runtime.targetEnumeration.frames.error }
                    : {
                        targetCount: r.runtime.targetEnumeration?.frames?.targetCount ?? null,
                        frameCount: r.runtime.targetEnumeration?.frames?.frameCount ?? null,
                        oopifCount: r.runtime.targetEnumeration?.frames?.oopifCount ?? null,
                      },
                },
          }
        : { ok: false, error: r.runtime.error },
      static: r.static.ok
        ? {
            layout: r.static.layout ?? 'asar',
            classes: r.static.classTokens.unique,
            vars: r.static.cssVars.unique,
          }
        : { ok: false, error: r.static.error },
      compare: r.compare
        ? {
            drift: r.compare.drift,
            classCoverage: r.compare.classes.coverage,
            varCoverage: r.compare.vars.coverage,
            bridgeMissing: r.compare.bridgeMissing.map((b) => ({
              var: b.var,
              role: b.role,
              neverDeclared: !b.declaredInStatic,
            })),
            deadLandmarks: (r.compare.verificationDrift ?? [])
              .filter((x) => x.visible === 0)
              .map((x) => x.selector),
            themeHint: r.compare.themeHint,
            topRuntimeDiffs: r.compare.topRuntimeDiffs,
            patchActions: buildPatchActions(r.id, r.compare),
            verdicts: r.compare.verdicts,
          }
        : null,
    })),
  };
}
