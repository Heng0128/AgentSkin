// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { DomTreeNode } from '../../shared/types';
import { buildNativeProfile, buildRef, inferRole, quantifyStyle } from './native-profile';

const VIEWPORT = { w: 1920, h: 1080 };

/** 构造一个节点。style 是 computed-style 子集（宽高用 rect 而非 style）。 */
function node(
  tag: string,
  rect: { w: number; h: number; x: number; y: number },
  over: Partial<DomTreeNode> = {},
): DomTreeNode {
  return {
    tag,
    cls: over.cls ?? '',
    rect,
    style: over.style ?? {},
    children: over.children ?? [],
    text: over.text,
  } as DomTreeNode;
}

/** 逼真的暗色聊天 IDE 布局：backdrop 壳 + 侧栏 + 消息列表 + 输入框。 */
function chatAppFixture(): DomTreeNode {
  return node(
    'div',
    { w: 1920, h: 1080, x: 0, y: 0 },
    {
      style: { 'background-color': 'rgb(10, 10, 16)', 'z-index': '0' },
      children: [
        node(
          'div',
          { w: 320, h: 1080, x: 0, y: 0 },
          {
            cls: 'sidebar-nav',
            style: { 'background-color': 'rgb(22, 22, 30)', 'z-index': '1' },
            children: [
              node(
                'button',
                { w: 280, h: 40, x: 20, y: 20 },
                {
                  cls: 'nav-item',
                  text: 'Chats',
                  style: { 'background-color': 'rgb(30, 30, 40)', color: 'rgb(230, 230, 240)' },
                },
              ),
            ],
          },
        ),
        node(
          'div',
          { w: 1600, h: 1080, x: 320, y: 0 },
          {
            cls: 'chat-panel',
            style: { 'background-color': 'rgb(10, 10, 16)' },
            children: [
              node(
                'div',
                { w: 1560, h: 760, x: 340, y: 0 },
                {
                  cls: 'message-list',
                  style: { 'background-color': 'rgb(13, 13, 20)' },
                  children: [
                    node(
                      'div',
                      { w: 1000, h: 120, x: 380, y: 20 },
                      {
                        cls: 'message-bubble',
                        text: 'Hello, how can I help you today?',
                        style: {
                          'background-color': 'rgb(30, 30, 44)',
                          color: 'rgb(235, 235, 245)',
                          'border-radius': '12px',
                        },
                      },
                    ),
                  ],
                },
              ),
              node(
                'div',
                { w: 1560, h: 220, x: 340, y: 820 },
                {
                  cls: 'composer',
                  style: {
                    'background-color': 'rgba(30, 30, 44, 0.85)',
                    'backdrop-filter': 'blur(20px)',
                  },
                  children: [
                    node(
                      'textarea',
                      { w: 1500, h: 120, x: 360, y: 850 },
                      {
                        text: 'Ask anything…',
                        style: {
                          'background-color': 'rgb(40, 40, 54)',
                          color: 'rgb(220, 220, 230)',
                        },
                      },
                    ),
                  ],
                },
              ),
            ],
          },
        ),
      ],
    },
  );
}

describe('quantifyStyle', () => {
  it('extracts background/color/radius/blur from computed subset', () => {
    const n = node(
      'div',
      { w: 10, h: 10, x: 0, y: 0 },
      {
        style: {
          'background-color': 'rgba(30, 30, 44, 0.85)',
          color: 'rgb(235, 235, 245)',
          'border-radius': '12px',
          'backdrop-filter': 'blur(20px)',
        },
      },
    );
    const q = quantifyStyle(n);
    expect(q.background).toEqual({ r: 30, g: 30, b: 44, a: 0.85 });
    expect(q.color).toEqual({ r: 235, g: 235, b: 245, a: 1 });
    expect(q.borderRadius).toBe(12);
    expect(q.blur).toBe(20);
  });
});

describe('inferRole', () => {
  it('classifies a full-bleed backdrop at depth 0', () => {
    const n = node(
      'div',
      { w: 1920, h: 1080, x: 0, y: 0 },
      { style: { 'background-color': 'rgb(10,10,16)' } },
    );
    expect(inferRole(n, VIEWPORT, 0)).toBe('backdrop');
  });

  it('classifies a narrow full-height column as sidebar', () => {
    const n = node('div', { w: 320, h: 1080, x: 0, y: 0 }, { cls: 'sidebar' });
    expect(inferRole(n, VIEWPORT, 1)).toBe('sidebar');
  });

  it('classifies a text-bearing large panel at the bottom as composer', () => {
    const n = node(
      'div',
      { w: 1560, h: 220, x: 340, y: 820 },
      {
        children: [node('textarea', { w: 100, h: 20, x: 0, y: 0 }, { text: 'x' })],
      },
    );
    expect(inferRole(n, VIEWPORT, 2)).toBe('composer');
  });

  it('classifies a small text card as message', () => {
    const n = node('div', { w: 1000, h: 120, x: 0, y: 0 }, { text: 'hi', cls: 'message' });
    expect(inferRole(n, VIEWPORT, 3)).toBe('message');
  });
});

describe('buildNativeProfile', () => {
  it('produces a complete profile with meta and metrics', () => {
    const profile = buildNativeProfile(chatAppFixture(), {
      agentId: 'traework',
      appVersion: '1.0.0',
      scheme: 'dark',
      viewport: VIEWPORT,
    });
    expect(profile.meta.agentId).toBe('traework');
    expect(profile.meta.scheme).toBe('dark');
    expect(profile.components.length).toBeGreaterThan(3);
  });

  it('assigns roles matching the fixture layout', () => {
    const profile = buildNativeProfile(chatAppFixture(), {
      agentId: 'traework',
      appVersion: '1.0.0',
      viewport: VIEWPORT,
    });
    const roles = profile.components.map((c) => c.role);
    expect(roles).toContain('backdrop');
    expect(roles).toContain('sidebar');
    expect(roles).toContain('chatlist');
    expect(roles).toContain('composer');
    expect(roles).toContain('message');
  });

  it('flags hasText on the message bubble and composer', () => {
    const profile = buildNativeProfile(chatAppFixture(), {
      agentId: 'workbuddy',
      appVersion: '1.0.0',
      viewport: VIEWPORT,
    });
    const message = profile.components.find((c) => c.role === 'message');
    expect(message?.hasText).toBe(true);
    const composer = profile.components.find((c) => c.role === 'composer');
    expect(composer?.hasText).toBe(true);
  });

  it('builds a luminance-ordered elevation ladder with sane deltas', () => {
    const profile = buildNativeProfile(chatAppFixture(), {
      agentId: 'traework',
      appVersion: '1.0.0',
      viewport: VIEWPORT,
    });
    expect(profile.metrics.elevationLadder.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < profile.metrics.elevationLadder.length; i++) {
      expect(profile.metrics.elevationLadder[i].deltaLuminance).toBeGreaterThanOrEqual(0);
    }
  });

  it('computes WCAG contrast pairs between text and background colors', () => {
    const profile = buildNativeProfile(chatAppFixture(), {
      agentId: 'traework',
      appVersion: '1.0.0',
      viewport: VIEWPORT,
    });
    expect(profile.metrics.contrastPairs.length).toBeGreaterThan(0);
    for (const p of profile.metrics.contrastPairs) {
      expect(p.wcagRatio).toBeGreaterThan(1);
    }
  });

  it('builds stable refs from structural path + tag (no class names)', () => {
    const fixture = chatAppFixture();
    const profile = buildNativeProfile(fixture, {
      agentId: 'traework',
      appVersion: '1.0.0',
      viewport: VIEWPORT,
    });
    for (const c of profile.components) {
      expect(c.ref).toMatch(/::[a-z]+$/);
      expect(c.ref).not.toContain('.sidebar-nav'); // 不依赖类名
    }
    // buildRef 直接可用
    expect(buildRef(fixture, '')).toBe('::div');
  });

  it('returns empty components for null root', () => {
    const profile = buildNativeProfile(null, { agentId: 'x', appVersion: '0.0.1' });
    expect(profile.components).toEqual([]);
  });
});
