// SPDX-License-Identifier: MPL-2.0
// probe-engine: doubao — 豆包系深度适配探针（勿套用到其他引擎）
// 身份：doubao:// 与 chrome:// 是两种文档（样式表构成不同），都采并分列；
// background/壳页 skip。外观：宿主 html[data-theme] 优先（豆皮 appMode 同路线）。
// 结构断言：豆包专属——左导航 testid、composer 几何、greeting 类名锚点。
// token 面：dbx/s-color/semi 承重 + N/B 组件作用域 + ffc 真 legacy（v1 扫描 0 声明）。
import { runProbe } from './lib.mjs';

await runProbe('doubao', {
  classifyPage: (url) => {
    if (url.includes('cross-site-support') || url === 'doubao://doubao-background/') return 'shell';
    if (url.startsWith('doubao://doubao-chat') || url.startsWith('chrome://doubao-chat'))
      return 'main';
    if (url.includes('doubao-launcher')) return 'secondary';
    return 'skip';
  },
  appearanceJs: `({ dataTheme: document.documentElement.getAttribute('data-theme'), bodyThemeMode: document.body && document.body.getAttribute('theme-mode') })`,
  tokenExpect: [
    { name: '--dbx-bg-body-web', expect: 'present', why: '承重背景族（v1 doubao:// 页 251 声明）' },
    { name: '--s-color-bg-body', expect: 'present', why: '承重表面族 242 声明' },
    { name: '--semi-color-bg-1', expect: 'present', why: 'Semi 栈核心' },
    { name: '--ffc-text-primary', expect: 'absent', why: '真 legacy：v1 宿主扫描 ffc 声明数=0' },
    {
      name: '--N100',
      expect: 'present',
      why: 'N 色阶组件作用域声明（tokens.css N/B 块为继承兜底）',
    },
    {
      name: '--input-guidance-input-container-background',
      expect: 'present',
      why: '输入框族 12 声明',
    },
  ],
  assertions: [
    {
      name: 'left-nav-testid',
      js: `document.querySelectorAll('[data-testid="chat_route_layout_leftside_nav"]').length>0?'yes':'no'`,
      expect: 'yes',
      why: 'L1 侧栏身份',
    },
    {
      name: 'composer-geometry',
      js: `(function(){var e=document.querySelector('[data-testid="chat_input"]');if(!e)return 'no';var r=e.getBoundingClientRect();return r.width>300?'yes':'too-narrow'})()`,
      expect: 'yes',
      why: 'composer 存在且几何合理',
    },
    {
      name: 'greeting-class-anchor',
      js: `document.querySelectorAll('[class*="greeting-text-"]').length>0?'yes':'no'`,
      expect: 'yes',
      why: 'D4 类名锚点（首页视图）；会话视图下 no 属正常→见 viewHints',
    },
  ],
  viewHints: [
    {
      view: '会话消息流',
      keys: [
        'conversation-item',
        'suggest-glass-family',
        'scrollbar-thumb',
        'darkmode-substring-fallbacks',
        'welcome-image-family',
      ],
      how: '打开任一含消息的会话并滚动',
    },
    {
      view: '弹窗/菜单',
      keys: ['semi-popup-shadow', 'semi-component-classes'],
      how: '打开模型选择器或右键菜单',
    },
    {
      view: '豆包工作',
      keys: ['chat-route-main'],
      how: '启动 DoubaoWork（doubaowork://）后对其端口复跑本探针',
    },
  ],
});
