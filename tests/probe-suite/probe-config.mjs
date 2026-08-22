// SPDX-License-Identifier: MPL-2.0

/**
 * probe-config.mjs — 探测套件共享配置
 *
 * 定义 6 个 Agent 的 CDP 端口、宿主选择器、原生 token 命名空间。
 * 仅供新建的测试使用，不修改任何现有代码。
 */

export const AGENT_CONFIG = {
  traework: {
    port: 56211,
    hostSelector: 'html.agentskin-host-traework',
    tokenNamespaces: ['--vscode-', '--color-', '--cb-'],
    description: 'Trae IDE (VSCode 衍生)',
  },
  qoderwork: {
    port: 53137,
    hostSelector: 'html.agentskin-host-qoderwork',
    tokenNamespaces: ['--vscode-', '--color-'],
    description: 'Qoder IDE',
  },
  workbuddy: {
    port: 57440,
    hostSelector: 'html.agentskin-host-workbuddy',
    tokenNamespaces: ['--wb-', '--color-'],
    description: 'WorkBuddy',
  },
  doubao: {
    port: 61055,
    hostSelector: 'html.agentskin-host-doubao',
    tokenNamespaces: ['--dbx-', '--color-', '--text-'],
    description: 'Doubao AI',
  },
  codex: {
    port: 58554,
    hostSelector: 'html.agentskin-host-codex',
    tokenNamespaces: ['--text-', '--color-'],
    description: 'Codex CLI',
  },
  zcode: {
    port: 55435,
    hostSelector: 'html.agentskin-host-zcode',
    tokenNamespaces: ['--text-', '--color-'],
    description: 'Z-Code Editor',
  },
};

export const CDP_CONNECTION_TIMEOUT = 8000;
export const CDP_EVAL_TIMEOUT = 10000;
export const MAX_DOM_NODES = 2000;
export const DOM_DEPTH_LIMIT = 12;

export const OUTPUT_DIR = 'tests/probe-suite/output';
