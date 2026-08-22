// SPDX-License-Identifier: MPL-2.0

import { UnsupportedFormatError } from './ir/errors';
import type { AdapterInput } from './ir/types';

/** 根据文件名推断可能的格式 */
export function sniffFormat(input: AdapterInput): string {
  const name = (input.filename ?? input.path ?? '').toLowerCase();

  if (name.endsWith('.codedrobe-theme') || name.includes('codedrobe')) {
    return 'codedrobe';
  }
  if (name.endsWith('.codex-theme') || name.includes('codex')) {
    return 'legacy-codex';
  }
  if (name.endsWith('.vscode-theme') || name.includes('vscode')) {
    return 'vscode-json';
  }
  if (name.endsWith('.css')) {
    return 'raw-css';
  }

  throw new UnsupportedFormatError(
    `Cannot sniff format from: ${input.filename ?? input.path ?? 'unknown'}`,
  );
}
