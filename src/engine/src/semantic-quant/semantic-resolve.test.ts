// SPDX-License-Identifier: MPL-2.0

/**
 * semantic-resolve.mjs 单测（RFC 附录 §E #1-#4）
 *
 * DEPRECATED_ALIASES 在 Phase 1 为空表，弃用分支通过 vi.mock 注入假表覆盖。
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { resolveComponentId, isDeprecated, listDeprecatedIds } from './semantic-resolve.mjs';

vi.mock('./taxonomy.mjs', () => ({
  DEPRECATED_ALIASES: {
    'chat-sidebar': { deprecatedAt: 2, replacedBy: 'sidebar' },
  },
}));

describe('resolveComponentId', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('正常 id 原样返回，deprecated=false', () => {
    expect(resolveComponentId('sidebar')).toEqual({ id: 'sidebar', deprecated: false });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('已弃用 id 解析为别名并置 deprecated=true、打印 warning', () => {
    const result = resolveComponentId('chat-sidebar');
    expect(result).toEqual({ id: 'sidebar', deprecated: true, replacedBy: 'sidebar' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('chat-sidebar');
    expect(warnSpy.mock.calls[0][0]).toContain('sidebar');
  });

  it('不存在 id 原样返回、不抛错、不告警', () => {
    expect(resolveComponentId('does-not-exist')).toEqual({ id: 'does-not-exist', deprecated: false });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('isDeprecated / listDeprecatedIds', () => {
  it('isDeprecated 命中弃用表', () => {
    expect(isDeprecated('chat-sidebar')).toBe(true);
    expect(isDeprecated('sidebar')).toBe(false);
  });

  it('listDeprecatedIds 返回全部弃用 id', () => {
    expect(listDeprecatedIds()).toEqual(['chat-sidebar']);
  });
});
