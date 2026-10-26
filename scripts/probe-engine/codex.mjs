// SPDX-License-Identifier: MPL-2.0
// probe-engine: codex — Codex/ChatGPT 桌面深度适配探针（勿套用到其他引擎）
// 身份：app://-/index.html 主窗；initialRoute 变体（avatar-overlay 等）为 secondary。
// 外观：data-vscode-context + data-vscode-theme-kind（VS Code 底座路线）。
// 本探针是 C14 合同的活体复验器：A 源=anchors 注册表（2026-08-23 build 59480）、
// C 源=合同条目逐变体（.x / [class*=x] / testid / attr 四类映射）、D 源=引擎文件
// 全量提取；CSS Module 名轮换由多锚点变体自动兜住，注册锚点全零即报 DRIFT。
// L0 为占位（token 所有权在主题层/renderer payload），不设 L0 token 期望。
import { runProbe } from './lib.mjs';

await runProbe('codex', {
  classifyPage: (url) => {
    if (url === 'app://-/index.html') return 'main';
    if (url.startsWith('app://-/index.html')) return 'secondary';
    return 'skip';
  },
  appearanceJs: `({ vscodeContext: !!document.querySelector('[data-vscode-context]'), themeKind: document.documentElement.getAttribute('data-vscode-theme-kind') })`,
  tokenExpect: [],
  assertions: [
    {
      name: 'shell-main',
      js: `document.querySelectorAll('[data-app-shell-main-surface]').length>0?'yes':'no'`,
      expect: 'yes',
      why: '主面板 data-* 锚（CSS Module 名已轮换，data 属性为承载）',
    },
    {
      name: 'composer-attrs',
      js: `document.querySelectorAll('[data-composer-surface-variant]').length>0?'yes':'no'`,
      expect: 'yes',
      why: 'composer 语义属性锚',
    },
    {
      name: 'sidebar-items',
      js: `document.querySelectorAll('.sidebar-item').length>0?'yes':'no'`,
      expect: 'yes',
      why: '侧栏行精确类',
    },
  ],
  viewHints: [
    {
      view: '首页路由',
      keys: ['home-icon', 'home-utility', 'home-suggestions'],
      how: '回到首页（home-icon testid 仅首页渲染）',
    },
    { view: 'Radix 浮层', keys: ['overlay-popper'], how: '打开任意 Radix popover/菜单' },
    { view: '设置页', keys: ['settings-panel'], how: '进入设置页（data-settings-panel-slug）' },
    {
      view: '会话线程',
      keys: ['message', 'reasoning-annotation', 'thread-surface'],
      how: '打开含消息的线程（部分 data-* 仅线程内渲染）',
    },
  ],
});
