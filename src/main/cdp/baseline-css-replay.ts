// SPDX-License-Identifier: MPL-2.0

/**
 * # baseline-css-replay — 原生基准 CSS 精确回注（RFC §6 / §8 序 5）
 *
 * 接收端：把 {@link baseline-css-capture} 采集到的**原生主题原始 CSS 规则**
 * 回注到目标页，复刻应用原生亮/暗主题，输出可对比的截图，作为视觉一致性
 * 验收。
 *
 * 为什么「精确回注」而非「computedStyle 映射」（对应审计 §6 极限还原策略）：
 *
 *   - 保存的是规则原文（`var()`、`calc()`、渐变方向/色标、`@media`、`@layer`
 *     级联顺序），不是丢失上下文的最终计算值。回注后 ΔE 由「近似」收敛到 0。
 *   - 通过 `adoptedStyleSheets` 注入（复用引擎内核 `buildAdoptOwnedSheetExpression`
 *     与 `buildClearEngineInjectionExpression`），与 AgentSkin 现有 CSS 注入管道
 *     完全一致，生命周期一致，方便复刻后「撤销回注」回落。
 *
 * 典型使用（基准复刻校验 / 降级兜底）：
 *
 *   ```
 *   const cap   = await captureBaselineCssOnPort(port, 'traework');
 *   const ok    = await replayBaseline(session, cap);
 *   const shot  = await captureReplayScreenshot(port, 'traework', './shot.png');
 *   await stopReplay(session);            // 撤销回注，回落原状态
 *   ```
 */

import { toMessage } from '../../shared/errors';
import { buildClearEngineInjectionExpression } from '../../shared/injection-runtime';
import { mainWarn } from '../logger';
import type { BaselineCssCapture } from './baseline-css-capture';
import type { CdpSession } from './cdp-client';
import { connectCdp } from './cdp-client';
import { findDomTargets } from './cdp-targets';
import { injectCssAdopted } from './injection/css-inject';

// ---------------------------------------------------------------------------
// 纯逻辑 helper（可单测）
// ---------------------------------------------------------------------------

/**
 * 将采集到的样式表原文按顺序拼接为一个可回注的 CSS 字符串。
 *
 * - 保留 `capture.stylesheets` 的原始顺序（级联语义依赖加载次序）。
 * - 可选拆分：只回注作用于特定组件的样式表（`firstMatchedFor` 精确匹配），
 *   用于"单组件复刻"验收。
 * - 空样式表 / 空原文自动跳过。
 */
export function buildReplayCss(
  capture: Pick<BaselineCssCapture, 'stylesheets'>,
  opts: { onlyFor?: string } = {},
): string {
  const blocks = capture.stylesheets
    .filter((s) => typeof s.cssText === 'string' && s.cssText.length > 0)
    .filter((s) => {
      if (!opts.onlyFor) return true;
      return s.firstMatchedFor === opts.onlyFor || s.matchedSelectors.includes(opts.onlyFor);
    })
    .map((s) => s.cssText);
  return blocks.join('\n');
}

/** 计算一次回注可以覆盖的语义组件集合（用于报告 / 日志）。 */
export function replayableComponents(capture: Pick<BaselineCssCapture, 'stylesheets'>): string[] {
  const set = new Set<string>();
  for (const s of capture.stylesheets) {
    if (s.firstMatchedFor && s.firstMatchedFor !== 'unknown') set.add(s.firstMatchedFor);
    for (const sel of s.matchedSelectors) set.add(sel);
  }
  return [...set];
}

// ---------------------------------------------------------------------------
// CDP 回注
// ---------------------------------------------------------------------------

/**
 * 回注基准 CSS：先清理引擎注入（owned adopted stylesheets），再注入拼接的
 * 原生规则原文，使目标页回到「仅原生主题 + 基准规则」的状态。
 *
 * 返回 false 表示清理或注入失败（best-effort，不抛错）。
 */
export async function replayBaseline(
  session: CdpSession,
  capture: Pick<BaselineCssCapture, 'stylesheets'> | BaselineCssCapture,
  opts: { onlyFor?: string } = {},
): Promise<boolean> {
  const css = buildReplayCss(capture, opts);
  if (!css) {
    mainWarn('BaselineCss.Replay', 'replay aborted: empty replay CSS (no captured stylesheets)');
    return false;
  }
  // 先清理 AgentSkin-owned 样式表，确保复刻为"纯原生"（不会被旧主题残留覆盖）。
  try {
    await session.evaluate(buildClearEngineInjectionExpression());
  } catch (error) {
    mainWarn('BaselineCss.Replay', `clear engine injection failed: ${toMessage(error)}`);
  }
  return injectCssAdopted(session, css);
}

/** 撤销回注：清理所有 AgentSkin-owned 样式表，回落原状态。 */
export async function stopReplay(session: CdpSession): Promise<void> {
  try {
    await session.evaluate(buildClearEngineInjectionExpression());
  } catch (error) {
    mainWarn('BaselineCss.Stop', `stop replay failed: ${toMessage(error)}`);
  }
}

/**
 * 截图验收：对目标应用主 DOM 窗口执行 `Page.captureScreenshot` 并写入文件。
 * 返回截图绝对路径（供人工/工具对比）。
 *
 * 对齐 `@agentskin/engine` 的 `captureScreenshot` 用法（format=png,
 * fromSurface=true, 不超出视口）。
 */
export async function captureReplayScreenshot(port: number, output: string): Promise<string> {
  const targets = await findDomTargets(port);
  if (!targets.length || !targets[0].webSocketDebuggerUrl) {
    throw new Error(`baseline replay screenshot: no DOM target on port ${port}`);
  }
  const session = await connectCdp(targets[0].webSocketDebuggerUrl, 3000);
  try {
    // 写入文件（路径 / 目录处理放在调用方或这里）。
    const { pathToFileURL } = await import('node:url');
    const fsp = await import('node:fs/promises').then((m) => m.default ?? m);
    const path = await import('node:path').then((m) => m.default ?? m);

    const result = await session.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    const absolute = path.resolve(output);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, Buffer.from(result.data, 'base64'));
    return pathToFileURL(absolute).href;
  } finally {
    try {
      session.close();
    } catch {
      /* already closed */
    }
  }
}
