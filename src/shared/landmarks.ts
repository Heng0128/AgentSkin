// SPDX-License-Identifier: MPL-2.0

/**
 * # landmarks — 各适配器的默认 DOM 锚点定义
 *
 * 用于注入前预检（landmark-preflight）和探测兜底选择器。
 * 当 ASAR 扫描不可用时，这些已知选择器可作为探测的 fallback。
 */

import type { AgentId } from './types/agent';

/** 单个 landmark 定义 — 描述目标页面中一个语义锚点。 */
export interface LandmarkDefinition {
  /** 语义名称，如 "chat-surface"。 */
  name: string;
  /** CSS 选择器候选列表（按优先级排序，第一个命中即停）。 */
  selectors: string[];
  /** true=必须存在（缺失阻止注入），false=仅警告。 */
  required: boolean;
  /** 可选的路由上下文提示（用于诊断输出）。 */
  routeHint?: string;
}

/** 各适配器的默认 landmark 定义。 */
export const DEFAULT_LANDMARKS: Record<AgentId, LandmarkDefinition[]> = {
  codex: [
    {
      name: 'main-content',
      // Selector contract synced with upstream Codex-Dream-Skin selectors.json
      // (verified 26.715 → 26.818): keep legacy anchors, append stable
      // attributes / CSS-Module prefixes, never match a full hash. Note
      // [role='main'] exists ONLY on the home route, so it stays last as a
      // degraded fallback, not a route-agnostic anchor.
      selectors: [
        "main:is(.main-surface, [data-app-shell-main-surface], [class*='_MainContentSurface_'])",
        "main[class*='MainContentSurface']",
        '#root',
        'main',
        "[role='main']",
      ],
      required: true,
      routeHint: '/',
    },
    {
      name: 'composer',
      selectors: [
        ":is(.composer-surface-chrome, [class*='_ComposerLayoutRoot_'], [data-composer-surface-variant][data-composer-radius-variant])",
        '.composer-surface-chrome',
        "[class*='composer-surface']",
        "[class*='_multilineSurface_']",
      ],
      required: false,
      routeHint: '/',
    },
    {
      name: 'sidebar',
      selectors: ['aside.app-shell-left-panel', '.app-shell-left-panel'],
      required: false,
      routeHint: '/',
    },
    {
      name: 'header',
      selectors: [
        "header:is(.app-header-tint, [data-app-shell-header-edge-scroll], [class*='_Header_'])",
        'header',
      ],
      required: false,
      routeHint: '/',
    },
  ],
  workbuddy: [
    {
      name: 'chat-container',
      selectors: [
        '.teams-container',
        '.chat-container',
        '.wb-cb-chat',
        '.chat-main',
        '.message-list',
      ],
      required: true,
      routeHint: '/',
    },
    {
      name: 'main-content',
      selectors: ['.main-content', '.main-content--welcome', '.teams-main-content'],
      required: true,
      routeHint: '/',
    },
    {
      name: 'sidebar',
      selectors: ["[data-view-id='sidebar']", '.sidebar-next'],
      required: false,
      routeHint: '/',
    },
  ],
  qoderwork: [
    {
      name: 'layout-body',
      selectors: ['.agents-layout-root', '.agents-layout-body', '.agents-content-area'],
      required: true,
      routeHint: '/',
    },
    { name: 'qoder-sidebar', selectors: ['.agents-sidebar'], required: false, routeHint: '/' },
  ],
  traework: [
    {
      name: 'chat-panel',
      selectors: ['.panel-container', '.solo-lite-layout', '.solo-lite-chat-panel-container'],
      required: true,
      routeHint: '/',
    },
    {
      name: 'conversation',
      selectors: ["[role='log']", 'article', "[class*='message-list']", "[class*='conversation']"],
      required: true,
      routeHint: '/',
    },
    {
      name: 'task-list',
      selectors: ['.task-list-base', '.task-list-panel'],
      required: false,
      routeHint: '/',
    },
  ],
  doubao: [
    {
      name: 'chat-input',
      selectors: [
        "[data-testid='chat_input']",
        "[class*='input-guidance']",
        "[class*='input-container'][class*='flex']",
      ],
      required: true,
      routeHint: '/',
    },
    {
      name: 'chat-content',
      selectors: [
        "[data-testid='chat_list_wrapper']",
        "[class*='message-list']",
        "[class*='chat-content']",
        "[role='log']",
      ],
      required: true,
      routeHint: '/',
    },
    {
      name: 'sidebar',
      selectors: [
        "[data-testid='chat_route_layout_leftside_nav']",
        "[data-testid='flow_chat_sidebar']",
        'nav',
      ],
      required: false,
      routeHint: '/',
    },
  ],
  zcode: [
    {
      name: 'main-content',
      selectors: ['#root', 'main', "[role='main']"],
      required: true,
      routeHint: '/',
    },
    { name: 'sidebar', selectors: ['aside', 'nav'], required: false, routeHint: '/' },
  ],
};

/** 获取指定适配器的默认 landmark 定义。 */
export function getDefaultLandmarks(agentId: AgentId): LandmarkDefinition[] {
  return DEFAULT_LANDMARKS[agentId] ?? [];
}

/**
 * 从 landmark 列表中提取所有选择器（去重），用于探测兜底。
 * 每个 landmark 取第一个选择器（优先级最高）。
 */
export function getFallbackSelectors(agentId: AgentId): string[] {
  const landmarks = DEFAULT_LANDMARKS[agentId] ?? [];
  const selectors: string[] = [];
  const seen = new Set<string>();
  for (const lm of landmarks) {
    for (const sel of lm.selectors) {
      if (!seen.has(sel)) {
        seen.add(sel);
        selectors.push(sel);
      }
    }
  }
  return selectors;
}
