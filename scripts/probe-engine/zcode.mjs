// SPDX-License-Identifier: MPL-2.0
// probe-engine: zcode — ZCode 深度适配探针（勿套用到其他引擎）
// 身份：app.asar/out/renderer/index.html 聊天窗；编辑器窗为独立 target（未开时
// monaco 族不可采——断言会显式报告窗口类型）。外观：.dark/.theme-zai-dark 类。
// tokens.css 为有意占位（L0 空操作，所有权在主题层 zcodeColorTokenOverrides），
// 不设 L0 token 期望；宿主 --color-* 精确名以主题层产物为准。
import { runProbe } from './lib.mjs';

await runProbe('zcode', {
  classifyPage: (url) => (url.includes('renderer/index.html') ? 'main' : 'skip'),
  appearanceJs: `({ dark: document.documentElement.classList.contains('dark'), zaiDark: document.documentElement.classList.contains('theme-zai-dark') })`,
  tokenExpect: [],
  assertions: [
    {
      name: 'window-kind',
      js: `document.querySelector('.monaco-workbench')?'editor-window':'chat-window'`,
      expect: 'chat-window',
      why: '当前 target 是聊天窗；编辑器窗打开后应另跑一次（editor-window 态）',
    },
    {
      name: 'workspace-sidebar-attr',
      js: `document.querySelectorAll('[data-workspace-sidebar-panel="true"]').length>0?'yes':'no'`,
      expect: 'yes',
      why: '本引擎最稳锚点（probe-verified exact anchor）',
    },
    {
      name: 'appearance-class-route',
      js: `document.documentElement.classList.contains('dark')||document.documentElement.classList.contains('theme-zai-dark')||document.documentElement.classList.contains('light')?'yes':'no'`,
      expect: 'yes',
      why: '外观声明走 class 路线',
    },
  ],
  viewHints: [
    { view: '编辑器窗', keys: ['monaco-family'], how: '打开 ZCode 编辑器窗口后带其端口复跑本探针' },
    { view: 'PDF 预览', keys: ['pdf-family'], how: '打开任一 PDF' },
    { view: '公式渲染', keys: ['katex'], how: '让回复包含数学公式' },
    {
      view: '浮层/按钮态',
      keys: ['overlay-substrings', 'button-substrings', 'aria-current'],
      how: '打开浮层菜单并进入选中态',
    },
  ],
});
