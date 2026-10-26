// SPDX-License-Identifier: MPL-2.0
// probe-engine: workbuddy — WorkBuddy 深度适配探针（勿套用到其他引擎）
// 身份：严格 app.asar/renderer/index.html（远程页/iframe 不采——豆皮同款纪律）。
// 外观：class 正则（dark|cb-dark|vscode-dark，Windows 实窗证实 html+body 双挂）。
// 结构断言：teams 壳唯一、侧栏双实现并存（遮蔽补丁前提）、外观走 class 路线。
// token 面：cb/vscode 底座 + 探针实证真名 + 猜测名缺席实锤 + cr 平行系统在场。
import { runProbe } from './lib.mjs';

await runProbe('workbuddy', {
  classifyPage: (url) => (url.includes('app.asar/renderer/index.html') ? 'main' : 'skip'),
  appearanceJs: `({ htmlClass: (document.documentElement.className||'').slice(0,60), dark: /(^|\\s)(dark|cb-dark|vscode-dark)(\\s|$)/.test(document.documentElement.className||'') })`,
  tokenExpect: [
    { name: '--cb-bg-primary', expect: 'present', why: 'cb 主族 567 声明' },
    { name: '--cb-input-background', expect: 'present', why: '探针实证真名（§10.1 映射依据）' },
    { name: '--cb-chat-bg', expect: 'absent', why: '猜测名，本构建无' },
    { name: '--sc-ui-text', expect: 'absent', why: 'sc-ui 块在此构建缺席' },
    { name: '--cr-accent', expect: 'present', why: 'cr 平行主题系统在场（233 声明）' },
    { name: '--vscode-editor-background', expect: 'present', why: 'vscode 底座 867 声明' },
  ],
  assertions: [
    {
      name: 'teams-shell-single',
      js: `document.querySelectorAll('.teams-container').length===1?'yes':'count:'+document.querySelectorAll('.teams-container').length`,
      expect: 'yes',
      why: '主壳唯一',
    },
    {
      name: 'sidebar-dual-impl',
      js: `document.querySelector('.conversation-sidebar')&&document.querySelector('[class*="sidebar-next"]')?'coexist':document.querySelector('.conversation-sidebar')?'conversation-only':'sidebar-next-only'`,
      expect: 'coexist',
      why: '两套侧栏实现并存（tokens.css 遮蔽补丁的前提）',
    },
    {
      name: 'appearance-class-route',
      js: `/(^|\\s)(dark|cb-dark|vscode-dark|light|cb-light|vscode-light)(\\s|$)/.test(document.documentElement.className)?'yes':'no'`,
      expect: 'yes',
      why: '外观声明走 class 路线',
    },
  ],
  viewHints: [
    { view: '网格视图', keys: ['grid-view'], how: '切换到会话网格布局' },
    { view: '视图选择下拉', keys: ['dropdown'], how: '打开左上视图选择器' },
    {
      view: '跨版本复验',
      keys: ['version-drift-fallbacks', 'dead-mainarea-substring'],
      how: 'macOS 5.3.14 或更新版本上复跑',
    },
  ],
});
