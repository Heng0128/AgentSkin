// SPDX-License-Identifier: MPL-2.0

import { readFile } from 'node:fs/promises';
import type { ThemeColors } from '../../../main/catalog/theme-manifest';
import { AdapterParseError, InvalidInputError } from '../ir/errors';
import type { AdapterInput, AdapterResult, ThemeAdapter } from '../ir/types';

/**
 * VS Code 主题 JSON 适配器。
 * 输入形态：VS Code theme JSON（workbench.colors + tokenColors）。
 * 实现策略：workbench 字段 → 14-token 映射表（60% 直接映射 + 30% 缺失推导）。
 *
 * detect：检查 .json 扩展名 + workbench.colors 或 tokenColors 字段。
 * parse：字段映射 → 14-token + extended（tokenColors 中的语法色）。
 */

/** workbench.colors → 14-token 映射表（基于 VS Code 标准主题格式） */
const WORKBENCH_TO_TOKEN: Record<string, string> = {
  // 背景色
  'editor.background': 'background',
  'sideBar.background': 'surface',
  'activityBar.background': 'surface',
  'panel.background': 'surface',
  'titleBar.activeBackground': 'surfaceElevated',
  'header.background': 'surfaceElevated',
  'editorWidget.background': 'surfaceElevated',
  'input.background': 'inputBackground',
  'terminal.background': 'codeBackground',

  // 文字色
  'editor.foreground': 'foreground',
  'sideBar.foreground': 'foreground',
  'activityBar.foreground': 'foreground',
  foreground: 'foreground',
  descriptionForeground: 'muted',
  'editorLineNumber.foreground': 'muted',

  // 强调色
  'button.background': 'accent',
  'button.foreground': 'buttonForeground',
  'textLink.foreground': 'accent',
  focusBorder: 'focusRing',
  'editor.selectionBackground': 'border',

  // 边框色
  'panel.border': 'border',
  'sideBar.border': 'border',
  'editorGroup.border': 'border',
  contrastBorder: 'border',
};

/** tokenColors scope → extended 语法色映射 */
const SCOPE_TO_SYNTAX: Record<string, string> = {
  keyword: 'syntaxRed',
  string: 'syntaxGreen',
  comment: 'syntaxGreen',
  variable: 'syntaxBlue',
  function: 'syntaxYellow',
  type: 'syntaxBlue',
  number: 'syntaxRed',
  constant: 'syntaxBlue',
  class: 'syntaxYellow',
  property: 'syntaxBlue',
};

export const vscodeJsonAdapter: ThemeAdapter = {
  priority: 30,

  async detect(input: AdapterInput): Promise<boolean> {
    const name = (input.filename ?? input.path ?? '').toLowerCase();
    if (!name.endsWith('.json')) return false;

    // 排除 legacy-codex：legacy-codex 检测的是顶层 colors 扁平对象
    // VS Code 格式则包含 workbench.colors 或 tokenColors
    if (!input.path) return false;

    try {
      const content = await readFile(input.path, 'utf-8');
      const json = JSON.parse(content);
      return !!(json.colors || json.tokenColors);
    } catch {
      return false;
    }
  },

  async parse(input: AdapterInput): Promise<AdapterResult> {
    if (!input.path) {
      throw new InvalidInputError('vscode-json adapter requires input.path');
    }

    try {
      const content = await readFile(input.path, 'utf-8');
      const json = JSON.parse(content);

      const workbench = json.colors ?? {};
      const tokenColors = json.tokenColors ?? [];

      // 映射 workbench → 14-token
      const colors: Record<string, string> = {};
      const inference: Record<string, 'provided' | 'derived' | 'default'> = {};

      for (const [wbKey, tokenKey] of Object.entries(WORKBENCH_TO_TOKEN)) {
        const val = workbench[wbKey];
        if (typeof val === 'string' && val.startsWith('#')) {
          colors[tokenKey] = val;
          inference[tokenKey] = 'provided';
        }
      }

      // 提取 tokenColors 中的语法色 → extended
      const extended: Record<string, string> = {};
      for (const tc of tokenColors) {
        if (tc.settings?.foreground && Array.isArray(tc.scope)) {
          for (const scope of tc.scope) {
            const scopeLower = scope.toLowerCase();
            for (const [pattern, syntaxKey] of Object.entries(SCOPE_TO_SYNTAX)) {
              if (scopeLower.includes(pattern) && !extended[syntaxKey]) {
                extended[syntaxKey] = tc.settings.foreground;
                break;
              }
            }
          }
        }
      }

      // 确保 background/foreground 存在（VS Code 可能用不同字段名）
      if (!colors.background && workbench['editor.background']) {
        colors.background = workbench['editor.background'];
      }
      if (!colors.foreground && workbench['editor.foreground']) {
        colors.foreground = workbench['editor.foreground'];
      }

      // 确保 background/foreground 必填（ThemeColors 契约）
      if (!colors.background) colors.background = workbench['editor.background'] ?? '#1e1e1e';
      if (!colors.foreground) colors.foreground = workbench['editor.foreground'] ?? '#e0e0e0';

      return {
        colors: {
          ...colors,
          extended: Object.keys(extended).length > 0 ? extended : undefined,
          inference: Object.keys(inference).length > 0 ? inference : undefined,
        } as ThemeColors,
        meta: {
          name: json.name ?? json.label ?? 'VS Code Theme',
          author: json.author,
          license: json.license?.spdx ?? json.license,
          sourceFormat: 'vscode-json',
          sourceUrl: json.repository?.url,
        },
        confidence: 0.75,
      };
    } catch (error) {
      throw new AdapterParseError(
        `Failed to parse VS Code JSON theme: ${(error as Error).message}`,
        'vscode-json',
      );
    }
  },
};
