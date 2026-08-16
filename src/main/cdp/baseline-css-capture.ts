// SPDX-License-Identifier: MPL-2.0

/**
 * # baseline-css-capture — CSS 规则级基准采集（RFC §6 / §8 序 4 demo）
 *
 * 目标：在未注入任何自定义主题之前，采集该应用**原生主题的原始 CSS 规则
 * 文本**，作为基准真值。区别于 computedStyle 近似（丢失 var()/calc()/渐变/
 * 媒体查询上下文），本模块保存规则原文，为后续 `baseline-css-replay` 的
 * 精确回注（ΔE→0）提供输入。
 *
 * 实现要点（对齐 `node-cascade.ts` / `snapshot-theme.ts` 的 CDP 栈）：
 *
 *   1. 按语义组件选择器定位节点（侧边栏 / 输入框 / 聊天区……），仅锚定关键
 *      组件，不做全样式表扫描。
 *   2. `CSS.getMatchedStylesForNode` → 收集每个受控节点实际命中的规则及其
 *      `styleSheetId`。
 *   3. `CSS.getStyleSheetText` → 拉取命中原生规则所在的样式表原文，按
 *      `origin` 过滤（只留 `regular`，剔除 user-agent / user），天然排除
 *      第三方库。
 *   4. `var(--x)` 依赖递归解析：被引用变量若定义在另一张样式表，补采该表，
 *      保证变量引用链完整。
 *   5. 全部 best-effort + 超时兜底：任何一步失败都不 throw，降级为已采集
 *      的部分。
 *
 * 生命周期（RFC §5）：仅在本窗口初始化 / 版本变更 / 模板更新时采集，不入
 * 高频轮询。采集总在城市 `Debugger.setJavaScriptEnabled(false)` 之后、恢复
 * 之前执行，防止页面 JS 动态篡改基准（RFC §6 调度层）。
 */

import { toMessage } from '../../shared/errors';
import type { AgentId } from '../../shared/types';
import { mainWarn } from '../logger';
import type { CdpSession } from './cdp-client';
import { connectCdp } from './cdp-client';
import { findDomTargets } from './cdp-targets';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** CDP `CSS.getStyleSheetText` 的样式表原文条目。 */
export interface CapturedStyleSheet {
  /** styleSheetId（CDP CSS 域句柄，会话内有效）。 */
  styleSheetId: string;
  /** 该样式表为哪个受控组件被命中而采集（首个命中组件）。 */
  firstMatchedFor: string;
  /** 原始 CSS 文本。 */
  cssText: string;
  /** 该表命中的选择器（去重，用于溯源）。 */
  matchedSelectors: string[];
}

/** 一次完整基准采集的结果。 */
export interface BaselineCssCapture {
  appId: AgentId;
  /** 采集时的页面 URL。 */
  url: string;
  /** 按 styleSheetId 去重后的样式表原文集。 */
  stylesheets: CapturedStyleSheet[];
  /** 探针到的 var(--x) 依赖名集合（即使未能补采也记录，便于诊断）。 */
  varDependencies: string[];
  /**
   * `Debugger.setJavaScriptEnabled(false)` 是否成功——决定本次采集是否算
   * "可信基准"（true=页面静止采集，未被 JS 篡改；false=降级采集）。
   */
  jsFrozen: boolean;
  /** 采集是否完整完成（false = 中途降级 / 部分失败）。 */
  complete: boolean;
  capturedAt: number;
}

/** 采集配置。 */
export interface BaselineCssOptions {
  /** 语义组件选择器（受控节点锚点）。缺省用 `:root`，聚焦根变量表。 */
  componentSelectors?: string[];
  /**
   * 允许的 CSS origin。默认只采 `regular`（作者样式），剔除
   * `user-agent`/`user`，从源头排除第三方/扩展样式。
   */
  allowedOrigins?: string[];
  /** 是否暂停页面 JS。默认 true（审计 §6：防动态篡改）。 */
  freezeJs?: boolean;
}

// ---------------------------------------------------------------------------
// 纯逻辑 helper（可单测）
// ---------------------------------------------------------------------------

/** 从 CSS 文本中提取 `var(--name)` 自定义属性名。 */
export function extractVarDependencies(cssText: string): string[] {
  const names = new Set<string>();
  const re = /var\(\s*(--[a-zA-Z0-9_-]+)/g;
  let m: RegExpExecArray | null = re.exec(cssText);
  while (m !== null) {
    if (m[1]) names.add(m[1]);
    m = re.exec(cssText);
  }
  return [...names];
}

/** 在 CSS 文本中查找某自定义属性是否已被定义（`--x:` 声明）。 */
export function definesVar(cssText: string, varName: string): boolean {
  // 匹配 `--name:` 声明（忽略注释内误匹配的极小风险；粗粒度足够）
  const re = new RegExp(`(^|[;{\\n])\\s*${escapeVar(varName)}\\s*:`, 'm');
  return re.test(cssText);
}

/** 在已采集的样式表原文中查找定义某 var 的样式表。返回 id 或 null。 */
export function findStylesheetDefiningVar(
  stylesheets: CapturedStyleSheet[],
  varName: string,
): CapturedStyleSheet | null {
  return stylesheets.find((s) => definesVar(s.cssText, varName)) ?? null;
}

function escapeVar(name: string): string {
  // 自定义属性名理论上可含转义，但实际都是 `--[a-z0-9_-]+`；为安全做简单转义。
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// CDP 采集
// ---------------------------------------------------------------------------

/** 最小的匹配规则外包形状（只读 motif 字段）。 */
interface CdpMatchedRule {
  rule: { styleSheetId?: string; origin?: string };
}

interface GetMatchedStylesResult {
  matchedCSSRules?: CdpMatchedRule[];
}

interface GetStyleSheetTextResult {
  text: string;
}

interface GetDocumentResult {
  root?: { nodeId?: number };
}

interface QuerySelectorResult {
  nodeId?: number;
}

/** 打开到主 DOM 目标的会话（复用 apply-baseline 的寻址方式）。 */
async function openMainDomSession(port: number): Promise<CdpSession | null> {
  try {
    const targets = await findDomTargets(port);
    if (!targets.length || !targets[0].webSocketDebuggerUrl) return null;
    return await connectCdp(targets[0].webSocketDebuggerUrl, 3000);
  } catch (error) {
    mainWarn('BaselineCss.Connect', `open main DOM session failed: ${toMessage(error)}`);
    return null;
  }
}

function closeSafely(session: CdpSession): void {
  try {
    session.close();
  } catch {
    // already closed
  }
}

/**
 * 对一个已打开的会话执行基准 CSS 采集。任何一步失败都不抛错，返回部分结果
 * 并标记 `complete=false`。
 */
export async function captureBaselineCss(
  session: CdpSession,
  appId: AgentId,
  opts: BaselineCssOptions = {},
): Promise<BaselineCssCapture> {
  const selectors = opts.componentSelectors?.length ? opts.componentSelectors : [':root'];
  const allowedOrigins = new Set(opts.allowedOrigins ?? ['regular']);
  const freezeJs = opts.freezeJs !== false;

  const stylesheets = new Map<string, CapturedStyleSheet>();
  const matchedSelectors = new Map<string, string[]>();
  let varDependencies = new Set<string>();
  let jsFrozen = false;
  let complete = true;

  // 1) 暂停页面 JS，防采集过程中被动态篡改（可降级）。
  if (freezeJs) {
    try {
      await session.send('Debugger.setJavaScriptEnabled', { value: false });
      jsFrozen = true;
    } catch (error) {
      mainWarn(
        'BaselineCss.Freeze',
        `Debugger freeze failed (degraded capture): ${toMessage(error)}`,
      );
      jsFrozen = false;
    }
  }

  try {
    // 2) 启用 CSS/DOM domain 并取文档根。
    try {
      await session.send('DOM.enable');
    } catch {
      /* best-effort */
    }
    await session.send('CSS.enable');
    const doc = await session.send<GetDocumentResult>('DOM.getDocument', {
      depth: 1,
      pierce: false,
    });
    const rootNodeId = doc.root?.nodeId ?? 0;
    if (typeof rootNodeId !== 'number' || rootNodeId <= 0) {
      // 无文档根 → 无法定位任何节点，整体降级为"未采集"。
      return buildResult(appId, jsFrozen, varDependencies, stylesheets, false);
    }

    // 3) 定位每个组件节点，收集其命中规则引用的样式表。
    for (const selector of selectors) {
      const nodeId = await resolveNodeId(session, rootNodeId, selector);
      if (nodeId == null) continue;
      const matched = await collectMatchedStyles(session, nodeId);
      for (const rule of matched) {
        const sheetId = rule.rule?.styleSheetId;
        const origin = rule.rule?.origin ?? 'regular';
        if (!sheetId) continue;
        if (!allowedOrigins.has(origin)) continue;
        const list = matchedSelectors.get(sheetId) ?? [];
        if (!list.includes(selector)) list.push(selector);
        matchedSelectors.set(sheetId, list);
      }
    }

    // 4) 拉取被命中样式表的原文。
    for (const [sheetId, selectorsHit] of matchedSelectors) {
      const text = await fetchStylesheetText(session, sheetId);
      if (text == null) {
        complete = false;
        continue;
      }
      stylesheets.set(sheetId, {
        styleSheetId: sheetId,
        firstMatchedFor: selectorsHit[0] ?? 'unknown',
        cssText: text,
        matchedSelectors: selectorsHit,
      });
      varDependencies = new Set([...varDependencies, ...extractVarDependencies(text)]);
    }

    // 5) var() 依赖递归补采：被引用但未在本轮样式表中定义的变量，尝试从
    //    :root 节点命中表补足。受实际 CDP 约束，仅尽力而为。
    const orphanVars = [...varDependencies].filter(
      (v) => !findStylesheetDefiningVar([...stylesheets.values()], v),
    );
    if (orphanVars.length) {
      const rootNodeId2 = await resolveNodeId(session, rootNodeId, ':root');
      if (rootNodeId2 != null) {
        const rootMatched = await collectMatchedStyles(session, rootNodeId2);
        for (const rule of rootMatched) {
          const sheetId = rule.rule?.styleSheetId;
          const origin = rule.rule?.origin ?? 'regular';
          if (!sheetId || stylesheets.has(sheetId) || !allowedOrigins.has(origin)) continue;
          const text = await fetchStylesheetText(session, sheetId);
          if (text == null) continue;
          const sheet: CapturedStyleSheet = {
            styleSheetId: sheetId,
            firstMatchedFor: ':root (var dep)',
            cssText: text,
            matchedSelectors: [':root'],
          };
          stylesheets.set(sheetId, sheet);
          for (const dep of extractVarDependencies(text)) varDependencies.add(dep);
        }
      }
    }
  } catch (error) {
    mainWarn('BaselineCss.Capture', `capture degraded: ${toMessage(error)}`);
    complete = false;
  } finally {
    // 6) 恢复页面 JS（无论成功失败）。
    if (freezeJs) {
      try {
        await session.send('Debugger.setJavaScriptEnabled', { value: true });
      } catch {
        /* best-effort */
      }
    }
  }

  const result = buildResult(appId, jsFrozen, varDependencies, stylesheets, complete);
  return result;
}

function buildResult(
  appId: AgentId,
  jsFrozen: boolean,
  varDependencies: Set<string>,
  stylesheets: Map<string, CapturedStyleSheet>,
  complete: boolean,
): BaselineCssCapture {
  return {
    appId,
    url: '', // url 由 caller 通过 evaluate 补充（避免依赖 location 时序）
    stylesheets: [...stylesheets.values()],
    varDependencies: [...varDependencies],
    jsFrozen,
    complete,
    capturedAt: Date.now(),
  };
}

async function resolveNodeId(
  session: CdpSession,
  rootNodeId: number,
  selector: string,
): Promise<number | null> {
  try {
    const res = await session.send<QuerySelectorResult>('DOM.querySelector', {
      nodeId: rootNodeId,
      selector,
    });
    return typeof res.nodeId === 'number' && res.nodeId > 0 ? res.nodeId : null;
  } catch (error) {
    mainWarn('BaselineCss.Query', `querySelector(${selector}) failed: ${toMessage(error)}`);
    return null;
  }
}

async function collectMatchedStyles(
  session: CdpSession,
  nodeId: number,
): Promise<CdpMatchedRule[]> {
  try {
    const res = await session.send<GetMatchedStylesResult>('CSS.getMatchedStylesForNode', {
      nodeId,
    });
    return res.matchedCSSRules ?? [];
  } catch (error) {
    mainWarn('BaselineCss.Match', `getMatchedStylesForNode failed: ${toMessage(error)}`);
    return [];
  }
}

async function fetchStylesheetText(session: CdpSession, sheetId: string): Promise<string | null> {
  try {
    const res = await session.send<GetStyleSheetTextResult>('CSS.getStyleSheetText', {
      styleSheetId: sheetId,
    });
    return typeof res.text === 'string' ? res.text : null;
  } catch (error) {
    mainWarn('BaselineCss.Text', `getStyleSheetText(${sheetId}) failed: ${toMessage(error)}`);
    return null;
  }
}

/**
 * 便捷入口：给定端口打开主 DOM 会话并采集基准 CSS。返回 null 表示无会话 / 全失败。
 */
export async function captureBaselineCssOnPort(
  port: number,
  appId: AgentId,
  opts: BaselineCssOptions = {},
): Promise<BaselineCssCapture | null> {
  const session = await openMainDomSession(port);
  if (!session) return null;
  try {
    const capture = await captureBaselineCss(session, appId, opts);
    // 补充页面 URL（需 Runtime.evaluate，因会话不允许读 location 时序而隔离）。
    try {
      const raw = await session.evaluate('location.href');
      if (raw && raw !== 'null') capture.url = raw;
    } catch {
      /* best-effort */
    }
    return capture;
  } finally {
    closeSafely(session);
  }
}
