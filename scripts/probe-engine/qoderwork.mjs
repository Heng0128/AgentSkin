// SPDX-License-Identifier: MPL-2.0
// probe-engine: qoderwork — QoderWork 深度适配探针（勿套用到其他引擎）
// 身份：app.asar/out/renderer/index.html 主窗；voice-overlay.html 为 secondary。
// 外观：html data-theme。特有点：tokens 108/108 满分（六引擎最佳，--color-* 体系）；
// 锚点大头在功能面板（artifact/MCP/quickpick/canvas/design/writing），首页态采不到属预期。
import { runProbe } from './lib.mjs';

await runProbe('qoderwork', {
  classifyPage: (url) => {
    if (url.includes('renderer/index.html')) return 'main';
    if (url.includes('voice-overlay')) return 'secondary';
    return 'skip';
  },
  appearanceJs: `({ dataTheme: document.documentElement.getAttribute('data-theme') })`,
  tokenExpect: [
    {
      name: '--color-error',
      expect: 'present',
      why: '我方 tokens.css 覆写的精确名（x-ray 108/108 实锤）',
    },
    { name: '--color-warning', expect: 'present', why: '同上' },
    { name: '--color-info', expect: 'present', why: '同上' },
    { name: '--color-primary', expect: 'present', why: '主色族核心名' },
  ],
  assertions: [
    {
      name: 'layout-shell',
      js: `document.querySelectorAll('.agents-layout-root').length===1?'yes':'count:'+document.querySelectorAll('.agents-layout-root').length`,
      expect: 'yes',
      why: '主壳唯一',
    },
    {
      name: 'resizable-sidebar',
      js: `document.querySelectorAll('[data-resizable-sidebar]').length>0?'yes':'no'`,
      expect: 'yes',
      why: '实证侧栏属性锚',
    },
    {
      name: 'composer-editable',
      js: `document.querySelectorAll('[contenteditable="true"],textarea').length>0?'yes':'no'`,
      expect: 'yes',
      why: '输入区在场',
    },
  ],
  viewHints: [
    {
      view: 'artifact/MCP 面板',
      keys: ['artifact-mcp-panels'],
      how: '打开任一 artifact 预览或 MCP 面板',
    },
    { view: '命令面板', keys: ['quickpick'], how: 'Ctrl+Shift+P' },
    {
      view: '设计/写作模式',
      keys: ['canvas-design-writing', 'editor-kit'],
      how: '切换到设计或写作模式（CodeMirror/ProseMirror 懒加载）',
    },
    {
      view: 'header 复验',
      keys: ['header-family', 'extension-nav'],
      how: '展开扩展导航并核对 header 类名',
    },
  ],
});
