// SPDX-License-Identifier: MPL-2.0

/**
 * cdp-full-extract.mjs 帧树遍历纯函数单测（审计 A-22 / R-20）
 *
 * flattenFrameTree 为纯函数，不触达 CDP/DOM。断言多层嵌套帧树拍平为有序
 * frameId 数组（DFS），支撑"同窗口多 iframe 同 URL 不同状态 → frameId 隔离采样"。
 */

import { describe, expect, it } from 'vitest';
import { flattenFrameTree } from '../../scripts/cdp-full-extract.mjs';

describe('flattenFrameTree', () => {
  it('returns [] for empty / missing tree', () => {
    expect(flattenFrameTree(undefined)).toEqual([]);
    expect(flattenFrameTree(null)).toEqual([]);
    expect(flattenFrameTree({})).toEqual([]);
  });

  it('flattens a single (main) frame', () => {
    const frames = flattenFrameTree({ frame: { id: 'main', url: 'https://a.app' } });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ frameId: 'main', parentId: null, url: 'https://a.app' });
  });

  it('flattens nested iframes in DFS order and keeps parentId linkage', () => {
    const tree = {
      frame: { id: 'm', url: 'https://main.app' },
      childFrames: [
        {
          frame: { id: 'f1', url: 'https://if-1.app' },
          childFrames: [{ frame: { id: 'f1a', url: 'https://if-1-1.app' } }],
        },
        { frame: { id: 'f2', url: 'https://if-2.app' } },
      ],
    };
    const frames = flattenFrameTree(tree);
    expect(frames.map((f) => f.frameId)).toEqual(['m', 'f1', 'f1a', 'f2']);
    expect(frames[1].parentId).toBe('m');
    expect(frames[2].parentId).toBe('f1');
    expect(frames[3].parentId).toBe('m');
  });

  it('distinguishes same-URL iframes by their distinct frameId', () => {
    // R-20：同窗口多 iframe 同 URL 不同状态 —— frameId 必须各自独立。
    const tree = {
      frame: { id: 'm', url: 'https://main.app' },
      childFrames: [
        { frame: { id: 'ia', url: 'https://widget.app' } },
        { frame: { id: 'ib', url: 'https://widget.app' } },
      ],
    };
    const frames = flattenFrameTree(tree);
    const widgetIds = frames.filter((f) => f.url === 'https://widget.app').map((f) => f.frameId);
    expect(widgetIds).toEqual(['ia', 'ib']); // 同一 URL 也不同 frameId → 隔离采样前提成立
  });
});
