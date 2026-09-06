// SPDX-License-Identifier: MPL-2.0

import { InputTooLargeError, InvalidInputError, UnsupportedFormatError } from '../ir/errors';
import type { AdapterInput, AdapterResult, ThemeAdapter } from '../ir/types';
import { codedrobeAdapter } from './codedrobe';
import { legacyCodexAdapter } from './legacy-codex';
import { rawCssAdapter } from './raw-css';
import { vscodeJsonAdapter } from './vscode-json';

const REGISTRY: ThemeAdapter[] = [];

const MAX_INPUT_BYTES = 5 * 1024 * 1024; // 5MB

export function register(adapter: ThemeAdapter): void {
  REGISTRY.push(adapter);
  REGISTRY.sort((a, b) => a.priority - b.priority);
}

export function resetRegistry(): void {
  REGISTRY.length = 0;
}

export async function detectAndParse(input: AdapterInput): Promise<AdapterResult> {
  if (!input.path && !input.buffer) {
    throw new InvalidInputError('AdapterInput must have at least one of: path, buffer');
  }
  if (input.buffer && input.buffer.length > MAX_INPUT_BYTES) {
    throw new InputTooLargeError(`Input exceeds ${MAX_INPUT_BYTES} bytes`);
  }

  for (const adapter of REGISTRY) {
    if (await adapter.detect(input)) {
      return await adapter.parse(input);
    }
  }

  throw new UnsupportedFormatError(`Unsupported theme format: ${input.filename ?? input.path}`);
}

/** 注册所有内置适配器 */
export function registerAllAdapters(): void {
  register(codedrobeAdapter);
  register(legacyCodexAdapter);
  register(vscodeJsonAdapter);
  register(rawCssAdapter);
}

// 默认注册
registerAllAdapters();
