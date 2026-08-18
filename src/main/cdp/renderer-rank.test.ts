// SPDX-License-Identifier: MPL-2.0

/**
 * renderer-rank 单测（RFC 2026-08-18 P0）。
 *
 * 覆盖：secondary 排除 > preferredUrlPatterns 有序命中 > score 排序 > 退化(第一个 page)。
 * 全为纯函数，无需 mock CDP。
 */

import { describe, expect, it } from 'vitest';
import {
  type CdpTargetInfo,
  isSecondaryRenderer,
  partitionRenderers,
  pickPrimaryRenderer,
  type RendererHints,
} from './renderer-rank';

function page(id: string, url: string, title = ''): CdpTargetInfo {
  return {
    id,
    type: 'page',
    url,
    title,
    webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${id}`,
  };
}

describe('renderer-rank', () => {
  describe('isSecondaryRenderer', () => {
    it('无 hints 或空 secondaryPatterns 时为 false', () => {
      expect(isSecondaryRenderer(undefined, page('a', 'http://x'))).toBe(false);
      expect(isSecondaryRenderer({ secondaryPatterns: [] }, page('a', 'http://x'))).toBe(false);
    });

    it('命中 URL pattern 判为次', () => {
      const hints: RendererHints = { secondaryPatterns: ['avatar-overlay'] };
      expect(isSecondaryRenderer(hints, page('a', 'http://x?initialRoute=avatar-overlay'))).toBe(
        true,
      );
      expect(isSecondaryRenderer(hints, page('b', 'http://x'))).toBe(false);
    });

    it('命中 title 同样判为次', () => {
      const hints: RendererHints = { secondaryPatterns: ['boot'] };
      expect(isSecondaryRenderer(hints, { ...page('a', 'http://x'), title: 'Boot Screen' })).toBe(
        true,
      );
    });

    it('非法正则不抛错，按字面匹配退化', () => {
      const hints: RendererHints = { secondaryPatterns: ['['] };
      expect(() => isSecondaryRenderer(hints, page('a', 'http://x'))).not.toThrow();
    });
  });

  describe('partitionRenderers', () => {
    it('无 hints 时退化：第一个 page 即主，其余为候选', () => {
      const r = partitionRenderers(undefined, [page('a', 'http://x'), page('b', 'http://y')]);
      expect(r.primary?.id).toBe('a');
      expect(r.candidates.map((t) => t.id)).toEqual(['b']);
      expect(r.secondaries).toEqual([]);
    });

    it('secondaryPatterns 命中的 target 不参与主/候选', () => {
      const hints: RendererHints = { secondaryPatterns: ['avatar-overlay|boot'] };
      const r = partitionRenderers(hints, [
        page('main', 'http://app'),
        page('boot', 'http://x?initialRoute=boot'),
        page('ovl', 'http://x?initialRoute=avatar-overlay'),
      ]);
      expect(r.primary?.id).toBe('main');
      expect(r.candidates.map((t) => t.id)).toEqual([]);
      expect(r.secondaries.map((t) => t.id).sort()).toEqual(['boot', 'ovl']);
    });

    it('preferredUrlPatterns 有序命中主 renderer', () => {
      const hints: RendererHints = { preferredUrlPatterns: ['main-window|app/'] };
      const r = partitionRenderers(hints, [
        page('a', 'http://x/boot'),
        page('b', 'http://x/app/chat'),
      ]);
      expect(r.primary?.id).toBe('b');
      expect(r.matchedPreferredPattern).toBe('main-window|app/');
    });

    it('preferred 未命中时回退 score 排序', () => {
      const hints: RendererHints = {
        preferredUrlPatterns: ['/nowhere/'],
        score: (t) => (t.url?.includes('main') ? 10 : t.url?.includes('chat') ? 5 : 0),
      };
      const r = partitionRenderers(hints, [page('a', 'http://x/chat'), page('b', 'http://x/main')]);
      expect(r.primary?.id).toBe('b');
    });

    it('score 取最高者为主', () => {
      const hints: RendererHints = { score: (t) => t.id.length };
      const r = partitionRenderers(hints, [page('a', 'http://x'), page('bbb', 'http://y')]);
      expect(r.primary?.id).toBe('bbb');
    });

    it('候选为空时 primary 为 undefined', () => {
      const r = partitionRenderers(undefined, []);
      expect(r.primary).toBeUndefined();
      expect(r.secondaries).toEqual([]);
      expect(r.candidates).toEqual([]);
    });
  });

  describe('pickPrimaryRenderer', () => {
    it('简捷返回主 renderer', () => {
      const hints: RendererHints = { preferredUrlPatterns: ['app/chat'] };
      expect(
        pickPrimaryRenderer(hints, [page('a', 'http://x/boot'), page('b', 'http://x/app/chat')])
          ?.id,
      ).toBe('b');
    });

    it('无候选返回 undefined', () => {
      expect(pickPrimaryRenderer(undefined, [])).toBeUndefined();
    });
  });
});
