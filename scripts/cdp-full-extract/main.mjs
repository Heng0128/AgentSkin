// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-full-extract — 主入口
 *
 * CDP Full Extract - 完整 Agent 样式探针
 *
 * 功能：
 * 1. 通过 CDP CSS Domain 获取所有样式表文本
 * 2. 解析亮/暗主题下的 CSS 变量原始定义
 * 3. 提取完整 DOM 结构（类名、标签、层级）
 * 4. 采样计算样式（颜色、字体、间距、阴影、圆角）
 * 5. 切换 prefers-color-scheme 捕获双主题数据
 * 6. 输出结构化 JSON 供 Theme Studio 使用
 *
 * 用法：
 *   node scripts/cdp-full-extract/main.mjs --port 58360 --name codex --out agents-raw-data
 *   node scripts/cdp-full-extract/main.mjs --all  --out agents-raw-data
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CdpClient } from '../../src/engine/src/cdp/session.mjs';
import { listAdapters } from '../../src/engine/src/index.mjs';
import { DEFAULT_MAX_DEPTH, DEFAULT_MAX_DOM_NODES, resolveAgentTiming } from './constants.mjs';
import { extractVariablesWithMedia, flattenVars } from './css-parser.mjs';
import {
  captureAllStylesheets,
  captureDomTree,
  enumerateFrames,
  sampleChildFrames,
  sampleComputedStyles,
} from './dom-capture.mjs';
import { discoverLivePort, pickPrimaryTarget } from './port-discovery.mjs';
import {
  getRootComputedVariables,
  resetEmulatedMedia,
  rootVarsCount,
  rootVarsEntries,
  setColorScheme,
} from './theme-switch.mjs';
import { analyzeColorPalette, categorizeVars, probeApiFingerprint } from './variable-analysis.mjs';

// ============== 主爬取流程 ==============

export async function extractAgent(
  port,
  agentName,
  outputDir,
  adapter = null,
  discoveredTargets = null,
) {
  let resolved;
  if (adapter && discoveredTargets) {
    resolved = { port, adapter, targets: discoveredTargets };
  } else {
    try {
      resolved = await discoverLivePort(agentName, port);
    } catch (e) {
      console.error(`  ✗ 端口发现失败: ${e.message}`);
      return null;
    }
  }
  const { adapter: activeAdapter, targets } = resolved;
  const primaryTarget = pickPrimaryTarget(activeAdapter, targets);
  if (!primaryTarget?.webSocketDebuggerUrl) {
    console.error(`  ✗ 没有可用的主渲染器 target`);
    return null;
  }
  const wsDebugUrl = primaryTarget.webSocketDebuggerUrl;
  console.log(`\n--- 提取 ${agentName} (port: ${resolved.port}) ---`);
  console.log(`  主渲染器: ${primaryTarget.title || primaryTarget.url || 'untitled'}`);

  const timing = resolveAgentTiming(agentName);
  const client = new CdpClient(wsDebugUrl, {
    connectTimeout: timing.connectTimeout,
    commandTimeout: timing.commandTimeout,
    timing,
  });

  try {
    await client.connect();
    console.log(`  ✓ CDP 连接成功`);

    await client.send('Runtime.enable').catch(() => {});

    // A-16：运行时 API 指纹
    const apiFingerprint = await probeApiFingerprint(client);
    if (apiFingerprint?.polluted?.length) {
      console.warn(`  ⚠ API 被污染: ${apiFingerprint.polluted.join(', ')}`);
    }

    // ====== 1. 捕获所有样式表 ======
    console.log(`  → 提取样式表...`);
    const stylesheets = await captureAllStylesheets(client);
    console.log(`  ✓ 获取 ${stylesheets.length} 个样式表`);

    const allVarsByScheme = { dark: {}, light: {}, neutral: {} };
    const allCssTexts = [];

    for (const sheet of stylesheets) {
      if (sheet.cssText && !sheet.error) {
        allCssTexts.push(sheet.cssText);
        const parsed = extractVariablesWithMedia(sheet.cssText);
        for (const scheme of ['dark', 'light', 'neutral']) {
          for (const [sel, vars] of Object.entries(parsed[scheme])) {
            if (!allVarsByScheme[scheme][sel]) allVarsByScheme[scheme][sel] = [];
            allVarsByScheme[scheme][sel].push(...vars);
          }
        }
      }
    }

    // ====== 2. 根元素变量提取（当前主题） ======
    console.log(`  → 提取根元素 CSS 变量（当前主题）...`);
    const rootVarsDefault = await getRootComputedVariables(client);
    console.log(
      `  ✓ 当前主题根变量: ${rootVarsCount(rootVarsDefault)} 个${rootVarsDefault.__host ? `（回退宿主 ${rootVarsDefault.__host}）` : ''}`,
    );

    // ====== 3. 当前主题（默认态）的 DOM 和计算样式 ======
    console.log(`  → 捕获 DOM 树（默认态）...`);
    const domDefault = await captureDomTree(client, DEFAULT_MAX_DOM_NODES, DEFAULT_MAX_DEPTH);
    console.log(`  ✓ 默认态 DOM: ${domDefault.totalNodes} 节点`);

    console.log(`  → 采样计算样式（默认态）...`);
    const computedDefault = await sampleComputedStyles(client, 300);
    console.log(`  ✓ 默认态采样: ${computedDefault.length} 节点`);

    // ====== 4. 切换暗色主题 ======
    console.log(`  → 切换到暗色主题...`);
    const darkOk = await setColorScheme(client, 'dark', timing.themeSwitchWait);
    let domDark = null,
      computedDark = null,
      rootVarsDark = {};

    if (darkOk) {
      console.log(`  ✓ 切换到暗色成功`);
      rootVarsDark = await getRootComputedVariables(client);
      console.log(
        `  ✓ 暗色根变量: ${rootVarsCount(rootVarsDark)} 个${rootVarsDark.__host ? `（回退宿主 ${rootVarsDark.__host}）` : ''}`,
      );
      domDark = await captureDomTree(client, DEFAULT_MAX_DOM_NODES, DEFAULT_MAX_DEPTH);
      console.log(`  ✓ 暗色 DOM: ${domDark.totalNodes} 节点`);
      computedDark = await sampleComputedStyles(client, 300);
      console.log(`  ✓ 暗色采样: ${computedDark.length} 节点`);
    } else {
      console.log(`  ⚠ 暗色切换失败（可能 Agent 不响应 prefers-color-scheme）`);
    }

    // ====== 5. 切换亮色主题 ======
    console.log(`  → 切换到亮色主题...`);
    const lightOk = await setColorScheme(client, 'light', timing.themeSwitchWait);
    let domLight = null,
      computedLight = null,
      rootVarsLight = {};

    if (lightOk) {
      console.log(`  ✓ 切换到亮色成功`);
      rootVarsLight = await getRootComputedVariables(client);
      console.log(
        `  ✓ 亮色根变量: ${rootVarsCount(rootVarsLight)} 个${rootVarsLight.__host ? `（回退宿主 ${rootVarsLight.__host}）` : ''}`,
      );
      domLight = await captureDomTree(client, DEFAULT_MAX_DOM_NODES, DEFAULT_MAX_DEPTH);
      console.log(`  ✓ 亮色 DOM: ${domLight.totalNodes} 节点`);
      computedLight = await sampleComputedStyles(client, 300);
      console.log(`  ✓ 亮色采样: ${computedLight.length} 节点`);
    } else {
      console.log(`  ⚠ 亮色切换失败（可能 Agent 不响应 prefers-color-scheme）`);
    }

    await resetEmulatedMedia(client);

    // ====== 构建输出 ======
    const allVarsDark = { ...allVarsByScheme.dark };
    const allVarsLight = { ...allVarsByScheme.light };
    const allVarsNeutral = { ...allVarsByScheme.neutral };

    const rootVarsDetection = {
      default: rootVarsDefault.__host ? JSON.parse(rootVarsDefault.__host) : null,
      dark: rootVarsDark.__host ? JSON.parse(rootVarsDark.__host) : null,
      light: rootVarsLight.__host ? JSON.parse(rootVarsLight.__host) : null,
    };
    delete rootVarsDefault.__host;
    delete rootVarsDark.__host;
    delete rootVarsLight.__host;
    if (Object.keys(rootVarsDefault).length > 0) {
      allVarsNeutral[':root@runtime'] = rootVarsEntries(rootVarsDefault).map(([name, value]) => ({
        name,
        value,
      }));
    }
    if (Object.keys(rootVarsDark).length > 0) {
      allVarsDark[':root@runtime:dark'] = rootVarsEntries(rootVarsDark).map(([name, value]) => ({
        name,
        value,
      }));
    }
    if (Object.keys(rootVarsLight).length > 0) {
      allVarsLight[':root@runtime:light'] = rootVarsEntries(rootVarsLight).map(([name, value]) => ({
        name,
        value,
      }));
    }

    // ====== A-22：帧树遍历 & 帧级隔离采样 ======
    let frameInfos = [];
    let childFrameSamples = [];
    try {
      frameInfos = (await enumerateFrames(client)) || [];
      if (frameInfos.length > 1) {
        childFrameSamples = await sampleChildFrames(client, frameInfos);
        console.log(
          `  ✓ 帧树: ${frameInfos.length} 帧（${frameInfos.length - 1} 个 iframe），已隔离采样 ${childFrameSamples.length} 个子帧`,
        );
      }
    } catch (e) {
      console.warn(`  ⚠ 帧树采样失败: ${e.message}`);
    }

    const result = {
      meta: {
        agent: agentName,
        port: port,
        extractedAt: new Date().toISOString(),
        wsDebugUrl,
        dataQuality: {
          totalNodes: {
            default: domDefault.totalNodes,
            dark: domDark?.totalNodes ?? null,
            light: domLight?.totalNodes ?? null,
          },
          corsBlockedSheets: stylesheets.filter((s) => s.error).length,
          failedSchemes: [...(darkOk ? [] : ['dark']), ...(lightOk ? [] : ['light'])],
          domDegraded:
            domDefault.totalNodes <= 1 ||
            (domDark !== null && domDark.totalNodes <= 1) ||
            (domLight !== null && domLight.totalNodes <= 1),
          truncated: {
            default: domDefault.truncated === true,
            dark: domDark?.truncated === true || null,
            light: domLight?.truncated === true || null,
          },
          multiFrame: frameInfos.length > 1,
          iframeCount: frameInfos.length - 1,
          frames: childFrameSamples,
          apiPolluted: apiFingerprint?.polluted ?? [],
          apiFingerprint: apiFingerprint?.fingerprint ?? null,
        },
      },
      frameSnapshot: {
        frames: frameInfos,
        sampledFrames: childFrameSamples,
      },
      rootVariables: {
        default: rootVarsDefault,
        dark: rootVarsDark,
        light: rootVarsLight,
      },
      rootVarsDetection,
      variables: {
        dark: {
          grouped: allVarsDark,
          flat: flattenVars(allVarsDark),
        },
        light: {
          grouped: allVarsLight,
          flat: flattenVars(allVarsLight),
        },
        neutral: {
          grouped: allVarsNeutral,
          flat: flattenVars(allVarsNeutral),
        },
      },
      categories: {
        dark: categorizeVars(flattenVars(allVarsDark), agentName),
        light: categorizeVars(flattenVars(allVarsLight), agentName),
        neutral: categorizeVars(flattenVars(allVarsNeutral), agentName),
      },
      colorPalette: {
        dark: analyzeColorPalette(flattenVars(allVarsDark)),
        light: analyzeColorPalette(flattenVars(allVarsLight)),
        neutral: analyzeColorPalette(flattenVars(allVarsNeutral)),
      },
      stylesheets: {
        count: stylesheets.length,
        sheets: stylesheets.map((s) => ({
          href: s.href,
          type: s.type,
          ruleCount: s.ruleCount,
          hasError: !!s.error,
          textLength: s.cssText?.length || 0,
        })),
        styleBlocks: stylesheets
          .filter((s) => s.cssText && s.cssText.length > 50 && !s.error)
          .map((s) => s.cssText)
          .filter(
            (txt, i, arr) => arr.findIndex((x) => x.slice(0, 200) === txt.slice(0, 200)) === i,
          )
          .slice(0, 50),
      },
      dom: {
        default: domDefault.root,
        dark: domDark?.root || null,
        light: domLight?.root || null,
      },
      computedSample: {
        default: computedDefault,
        dark: computedDark,
        light: computedLight,
      },
      stats: {
        rootVars: {
          default: rootVarsCount(rootVarsDefault),
          dark: rootVarsCount(rootVarsDark),
          light: rootVarsCount(rootVarsLight),
        },
        domNodes: {
          default: domDefault.totalNodes,
          dark: domDark?.totalNodes || 0,
          light: domLight?.totalNodes || 0,
        },
        styleVars: {
          dark: Object.keys(flattenVars(allVarsDark)).length,
          light: Object.keys(flattenVars(allVarsLight)).length,
          neutral: Object.keys(flattenVars(allVarsNeutral)).length,
        },
        computedSamples: {
          default: computedDefault.length,
          dark: computedDark?.length || 0,
          light: computedLight?.length || 0,
        },
      },
    };

    const outPath = join(outputDir, `${agentName}-full-extract.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`  💾 已保存到 ${outPath}`);
    console.log(
      `  📊 统计: vars(dark=${result.stats.styleVars.dark}, light=${result.stats.styleVars.light}, neutral=${result.stats.styleVars.neutral}) | rootVars(default=${result.stats.rootVars.default}, dark=${result.stats.rootVars.dark}, light=${result.stats.rootVars.light})`,
    );

    // A-12：语义基线持久化
    const baseline = buildSemanticBaseline(agentName, result);
    const baselinePath = join(outputDir, `${agentName}-baseline.json`);
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
    console.log(`  📎 语义基线已保存到 ${baselinePath}`);

    return result;
  } catch (e) {
    console.error(`  ✗ 提取失败: ${e.message}`);
    return null;
  } finally {
    client.close();
  }
}

// ============== 语义基线构建（审计 A-12 / A-15）==============

export function buildSemanticBaseline(agentName, result) {
  const scheme = (name) => {
    const cat = result.categories[name];
    if (!result.rootVariables[name] && !cat) return null;
    return {
      rootVariables: result.rootVariables[name] ?? {},
      categories: cat ?? {},
      colorPalette: result.colorPalette[name] ?? [],
    };
  };
  return {
    meta: {
      agent: agentName,
      extractedAt: result.meta.extractedAt,
      generatedBy: 'cdp-full-extract',
      dataQuality: {
        failedSchemes: result.meta.dataQuality.failedSchemes ?? [],
        domDegraded: result.meta.dataQuality.domDegraded ?? false,
        truncated: result.meta.dataQuality.truncated ?? null,
        multiFrame: result.meta.dataQuality.multiFrame ?? false,
        apiPolluted: result.meta.dataQuality.apiPolluted ?? [],
      },
    },
    schemes: {
      neutral: scheme('neutral'),
      dark: scheme('dark'),
      light: scheme('light'),
    },
  };
}

// ============== 入口 ==============

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outputDir = outIdx >= 0 ? args[outIdx + 1] : 'agents-raw-data';
  const useAll = args.includes('--all');

  const resolvedOut = resolve(outputDir);
  if (!existsSync(resolvedOut)) {
    mkdirSync(resolvedOut, { recursive: true });
  }

  const agentsToExtract = {};

  if (useAll) {
    for (const adapter of listAdapters()) agentsToExtract[adapter.id] = null;
  } else {
    const portArg = args.indexOf('--port');
    const nameArg = args.indexOf('--name');
    const portIdx = portArg >= 0 ? args[portArg + 1] : undefined;
    const nameIdx = nameArg >= 0 ? args[nameArg + 1] : undefined;
    if (nameIdx) {
      agentsToExtract[nameIdx] = portIdx ? parseInt(portIdx, 10) : null;
    } else {
      console.log('用法:');
      console.log('  node scripts/cdp-full-extract/main.mjs --all --out agents-raw-data');
      console.log(
        '  node scripts/cdp-full-extract/main.mjs --port 58360 --name codex --out agents-raw-data',
      );
      console.log(
        '  node scripts/cdp-full-extract/main.mjs --name codex --out agents-raw-data   // 自动发现端口',
      );
      process.exit(1);
    }
  }

  console.log('=== CDP Full Extract ===');
  console.log(`目标: ${Object.keys(agentsToExtract).join(', ')}`);
  console.log(`输出: ${resolvedOut}`);
  console.log(
    '提示: 端口经项目三层发现策略（DevToolsActivePort→argv→netstat）自动定位，无需手写端口表',
  );
  console.log('');

  const results = {};
  for (const [name, port] of Object.entries(agentsToExtract)) {
    try {
      results[name] = await extractAgent(port, name, resolvedOut);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      results[name] = null;
    }
  }

  const summary = {
    extractedAt: new Date().toISOString(),
    agents: {},
  };
  for (const [name, data] of Object.entries(results)) {
    if (data) {
      summary.agents[name] = {
        status: 'ok',
        styleVars: data.stats.styleVars,
        rootVars: data.stats.rootVars,
        domNodes: data.stats.domNodes,
        colorPaletteDark: data.colorPalette.dark?.length || 0,
        colorPaletteLight: data.colorPalette.light?.length || 0,
        colorPaletteNeutral: data.colorPalette.neutral?.length || 0,
      };
    } else {
      summary.agents[name] = { status: 'failed' };
    }
  }

  writeFileSync(join(resolvedOut, '_extract-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== 提取完成 ===');
  console.log(`汇总: ${join(resolvedOut, '_extract-summary.json')}`);
}

// 仅在作为 CLI 直接执行时运行
if (import.meta.main) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
