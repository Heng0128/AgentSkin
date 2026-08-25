// SPDX-License-Identifier: MPL-2.0

/**
 * renderer-fingerprint 单测。
 * 覆盖：单/多 renderer 识别、primary/secondary/ignored 分类、空列表、匹配优先级、注入规划。
 */

import { describe, expect, it } from 'vitest';
import {
  buildInjectionPlan,
  type CdpTargetInfo,
  classifyTarget,
  identifyRenderers,
  matchHint,
  planInjectionOrder,
  type RendererHintsConfig,
} from './renderer-fingerprint';

function target(id: string, url: string, type = 'page'): CdpTargetInfo {
  return {
    id,
    type,
    url,
    title: '',
    webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${id}`,
  };
}

const testHints: RendererHintsConfig = {
  primary: ['solo/solo-lite.html', 'solo-lite.html', 'index.html'],
  secondary: ['launcher.html', 'settings.html'],
};

describe('matchHint', () => {
  it('exact > substring > regex > null', () => {
    expect(matchHint('index.html', 'index.html')).toBe('exact');
    expect(matchHint('app:///solo/solo-lite.html', 'solo-lite.html')).toBe('substring');
    expect(matchHint('renderer/app-v2/index.html', 'renderer/.*')).toBe('regex');
    expect(matchHint('completely/different', 'index.html')).toBeNull();
  });

  it('invalid regex falls back to null', () => {
    expect(matchHint('http://x', '[')).toBeNull();
  });
});

describe('classifyTarget', () => {
  it('classifies primary, secondary, ignored', () => {
    expect(
      classifyTarget(target('a', 'app:///solo/solo-lite.html'), testHints).classification,
    ).toBe('primary');
    expect(classifyTarget(target('b', 'app:///launcher.html'), testHints).classification).toBe(
      'secondary',
    );
    expect(classifyTarget(target('c', 'chrome://about'), testHints).classification).toBe('ignored');
  });

  it('primary takes priority over secondary', () => {
    const r = classifyTarget(target('d', 'index.html?settings'), testHints);
    expect(r.classification).toBe('primary');
    expect(r.matchTier).toBe('substring');
  });
});

describe('identifyRenderers', () => {
  it('single renderer → primary', () => {
    const r = identifyRenderers([target('a', 'app:///solo-lite.html')], 'traework');
    expect(r.primary).toHaveLength(1);
    expect(r.secondary).toHaveLength(0);
    expect(r.ignored).toHaveLength(0);
  });

  it('multi-renderer: primary + secondary + ignored', () => {
    const r = identifyRenderers(
      [
        target('main', 'app:///solo/solo-lite.html'),
        target('side', 'app:///launcher.html'),
        target('boot', 'chrome://about'),
      ],
      'traework',
    );
    expect(r.primary[0].target.id).toBe('main');
    expect(r.secondary[0].target.id).toBe('side');
    expect(r.ignored[0].target.id).toBe('boot');
  });

  it('unknown hints → ignored', () => {
    const r = identifyRenderers(
      [target('x', 'chrome://flags'), target('y', 'devtools://devtools')],
      'qoderwork',
    );
    expect(r.primary).toHaveLength(0);
    expect(r.secondary).toHaveLength(0);
    expect(r.ignored).toHaveLength(2);
  });

  it('empty list → empty buckets', () => {
    const r = identifyRenderers([], 'workbuddy');
    expect(r.primary).toEqual([]);
    expect(r.secondary).toEqual([]);
    expect(r.ignored).toEqual([]);
  });

  it('all six adapters match their hints', () => {
    expect(
      identifyRenderers([target('a', 'workbuddy://app.asar/renderer/index.html')], 'workbuddy')
        .primary,
    ).toHaveLength(1);
    expect(
      identifyRenderers([target('a', 'doubao://doubao-chat/chat')], 'doubao').primary,
    ).toHaveLength(1);
    expect(
      identifyRenderers([target('a', 'https://codex.example.com/prompt-library.html')], 'codex')
        .secondary,
    ).toHaveLength(1);
    expect(
      identifyRenderers([target('a', 'zcode://authentication.html')], 'zcode').secondary,
    ).toHaveLength(1);
  });
});

describe('planInjectionOrder', () => {
  it('primary first (delay 0), secondary delayed', () => {
    const id = identifyRenderers(
      [target('main', 'app:///solo/solo-lite.html'), target('side', 'app:///launcher.html')],
      'traework',
    );
    const plan = planInjectionOrder(id, { secondaryDelayMs: 300 });
    expect(plan.steps[0].classification).toBe('primary');
    expect(plan.steps[0].delayMs).toBe(0);
    expect(plan.steps[1].classification).toBe('secondary');
    expect(plan.steps[1].delayMs).toBe(300);
  });

  it('ignored excluded from plan', () => {
    const id = identifyRenderers(
      [target('main', 'app:///solo/solo-lite.html'), target('unk', 'chrome://flags')],
      'traework',
    );
    const plan = planInjectionOrder(id);
    expect(plan.steps).toHaveLength(1);
    expect(plan.ignoredCount).toBe(1);
  });

  it('default secondary delay is 500ms', () => {
    const id = identifyRenderers([target('side', 'app:///launcher.html')], 'traework');
    expect(planInjectionOrder(id).steps[0].delayMs).toBe(500);
  });
});

describe('buildInjectionPlan', () => {
  it('end-to-end identify + plan', () => {
    const plan = buildInjectionPlan(
      [
        target('main', 'out/renderer/index.html'),
        target('welcome', 'welcome.html'),
        target('ghost', 'chrome://newtab'),
      ],
      'qoderwork',
      { secondaryDelayMs: 200 },
    );
    expect(plan.primaryCount).toBe(1);
    expect(plan.secondaryCount).toBe(1);
    expect(plan.ignoredCount).toBe(1);
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0].target.id).toBe('main');
    expect(plan.steps[1].target.id).toBe('welcome');
    expect(plan.steps[1].delayMs).toBe(200);
  });
});
