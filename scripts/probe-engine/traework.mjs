// SPDX-License-Identifier: MPL-2.0
// probe-engine: traework — TRAE SOLO 深度适配探针（勿套用到其他引擎）
// 身份：vscode-file:// TRAE 主窗。外观：html data-theme + .solo-theme 在场。
// 特有点：核心锚点全在 task-list / chat-input-v2 / messageInput 三族（anchors 注册表
// 2026-08-23 实证 .panel-container 为主列、.solo-lite-chat-panel-container 为死选择器）；
// 气泡族与 data-trae-ref 需会话/模式视图。token 面：21 幽灵名（--chat-bubble-*/--brand-*
// 系猜测，原生实为 --brand-brand-*/--bg-bg-*/--text-text-* 族——覆盖扩展专题）。
import { runProbe } from './lib.mjs';

await runProbe('traework', {
  classifyPage: (url) => (url.includes('vscode-file') || url.includes('TRAE') ? 'main' : 'skip'),
  appearanceJs: `({ dataTheme: document.documentElement.getAttribute('data-theme'), soloTheme: !!document.querySelector('.solo-theme') })`,
  tokenExpect: [
    { name: '--vscode-editor-background', expect: 'present', why: 'VS Code 底座' },
    { name: '--chat-bubble-user-bg', expect: 'absent', why: '幽灵名（21 幽灵之一）' },
    { name: '--brand-primary', expect: 'absent', why: '幽灵名——原生实为 --brand-brand-* 族' },
    { name: '--solo-surface-elevated', expect: 'absent', why: '幽灵名' },
  ],
  assertions: [
    {
      name: 'main-column',
      js: `document.querySelectorAll('.panel-container').length>0?'yes':'no'`,
      expect: 'yes',
      why: 'anchors 注册表实证主列',
    },
    {
      name: 'composer-exact',
      js: `document.querySelectorAll('.chat-input-v2-input-box-editable').length>0?'yes':'no'`,
      expect: 'yes',
      why: 'anchors 注册表实证精确 composer',
    },
    {
      name: 'task-list-panel',
      js: `document.querySelectorAll('.task-list-panel,.task-list-base').length>0?'yes':'no'`,
      expect: 'yes',
      why: '任务列表族承载侧栏',
    },
  ],
  viewHints: [
    {
      view: '会话消息流',
      keys: ['bubble-family', 'avatar-link'],
      how: '打开含用户与助手消息的会话',
    },
    {
      view: 'trae-ref 复验',
      keys: ['trae-ref', 'glow-killers'],
      how: '切换 IDE/Solo 模式与输入框聚焦态',
    },
  ],
});
