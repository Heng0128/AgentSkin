// SPDX-License-Identifier: MPL-2.0

import { readFile } from 'node:fs/promises';
import { AdapterParseError, InvalidInputError } from '../ir/errors';
import type { AdapterInput, AdapterResult, ThemeAdapter } from '../ir/types';

/**
 * .codex-theme 单文件 JSON 适配器。
 * 输入形态：单个 JSON 文件，顶层包含 colors 字段。
 */
export const legacyCodexAdapter: ThemeAdapter = {
  priority: 20,

  async detect(input: AdapterInput): Promise<boolean> {
    const name = (input.filename ?? input.path ?? '').toLowerCase();
    if (name.endsWith('.codex-theme') || name.endsWith('.json')) {
      if (!input.path) return false;
      try {
        const content = await readFile(input.path, 'utf-8');
        const json = JSON.parse(content);
        return !!json.colors;
      } catch {
        return false;
      }
    }
    return false;
  },

  async parse(input: AdapterInput): Promise<AdapterResult> {
    if (!input.path) {
      throw new InvalidInputError('legacy-codex adapter requires input.path');
    }

    try {
      const content = await readFile(input.path, 'utf-8');
      const json = JSON.parse(content);

      return {
        colors: json.colors ?? {},
        meta: {
          name: json.name,
          author: json.author?.name ?? json.author,
          license: json.license,
          sourceFormat: 'legacy-codex',
        },
        confidence: 0.85,
      };
    } catch (error) {
      throw new AdapterParseError(
        `Failed to parse legacy-codex package: ${(error as Error).message}`,
        'legacy-codex',
      );
    }
  },
};
