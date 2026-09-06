// SPDX-License-Identifier: MPL-2.0

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AdapterParseError, InvalidInputError } from '../ir/errors';
import type { AdapterInput, AdapterResult, ThemeAdapter } from '../ir/types';

/**
 * .codedrobe-theme 多端包适配器。
 * 输入形态：目录，内含 manifest.json + targets/<agent>/css/ + assets/
 * manifest.colors 包含 14-token + 可选 extended。
 */
export const codedrobeAdapter: ThemeAdapter = {
  priority: 10,

  async detect(input: AdapterInput): Promise<boolean> {
    if (!input.path) return false;
    try {
      const manifestPath = join(input.path, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      return !!(manifest.colors && manifest.targets);
    } catch {
      return false;
    }
  },

  async parse(input: AdapterInput): Promise<AdapterResult> {
    if (!input.path) {
      throw new InvalidInputError('codedrobe adapter requires input.path');
    }

    try {
      const manifestPath = join(input.path, 'manifest.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);

      return {
        colors: manifest.colors ?? {},
        meta: {
          name: manifest.name,
          author: manifest.author?.name ?? manifest.author,
          license: manifest.license,
          sourceFormat: 'codedrobe',
        },
        confidence: 0.9,
      };
    } catch (error) {
      throw new AdapterParseError(
        `Failed to parse codedrobe package: ${(error as Error).message}`,
        'codedrobe',
      );
    }
  },
};
