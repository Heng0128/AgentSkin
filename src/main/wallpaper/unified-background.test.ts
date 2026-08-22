// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { WALLPAPER_CONTINUATION_ID } from '../../shared/injection-constants';
import type { CdpTarget } from '../cdp/cdp-targets';
import type { SurfaceRect } from './injector-types';
import {
  buildContinuationMountJs,
  buildContinuationRemoveJs,
  computeContinuationLayout,
  computeUnifiedPlan,
} from './unified-background';

function makeTarget(id: string): CdpTarget {
  return {
    id,
    type: 'page',
    url: `http://localhost/${id}.html`,
    title: id,
    webSocketDebuggerUrl: `ws://127.0.0.1:9222/devtools/page/${id}`,
  } as unknown as CdpTarget;
}

const RECT_MAIN: SurfaceRect = { x: 0, y: 0, width: 1200, height: 800 };
const RECT_SIDE: SurfaceRect = { x: 1200, y: 0, width: 300, height: 800 };

describe('computeUnifiedPlan', () => {
  it('is disabled for an empty target set', () => {
    const plan = computeUnifiedPlan([]);
    expect(plan.enabled).toBe(false);
    expect(plan.primary).toBeUndefined();
    expect(plan.secondaries).toEqual([]);
  });

  it('is disabled for a single target (no shared path)', () => {
    const t = makeTarget('main');
    const plan = computeUnifiedPlan([t]);
    expect(plan.enabled).toBe(false);
    expect(plan.primary).toBe(t);
    expect(plan.secondaries).toEqual([]);
  });

  it('is enabled for >=2 targets, primary is the first (main-goes-first) and the rest are secondaries', () => {
    const main = makeTarget('main');
    const a = makeTarget('a');
    const b = makeTarget('b');
    const plan = computeUnifiedPlan([main, a, b]);
    expect(plan.enabled).toBe(true);
    expect(plan.primary).toBe(main);
    expect(plan.secondaries).toEqual([a, b]);
  });
});

describe('computeContinuationLayout', () => {
  it('places the primary rect in secondary viewport coordinates (offset by secondary origin)', () => {
    const layout = computeContinuationLayout(RECT_MAIN, RECT_SIDE);
    // Primary at host (0,0); secondary origin at host (1200,0) → the primary
    // appears at left = 0 - 1200 = -1200 in the secondary's coordinate space.
    expect(layout).toEqual({ left: -1200, top: 0, width: 1200, height: 800 });
  });

  it('is a no-op offset when primary and secondary share the same origin', () => {
    const layout = computeContinuationLayout(RECT_MAIN, RECT_MAIN);
    expect(layout).toEqual({ left: 0, top: 0, width: 1200, height: 800 });
  });

  it('keeps primary size (image continuity), only the position shifts', () => {
    const layout = computeContinuationLayout(RECT_SIDE, RECT_MAIN);
    // Side at host (1200,0) viewed from main origin (0,0) → (1200,0).
    expect(layout).toEqual({ left: 1200, top: 0, width: 300, height: 800 });
  });
});

describe('buildContinuationMountJs', () => {
  const opts = {
    src: 'http://127.0.0.1:0/wp.png',
    primaryRect: RECT_MAIN,
    secondaryRect: RECT_SIDE,
    render: { alignment: 'fill' as const },
  };

  it('emits an element with the continuation ID and aria-hidden', () => {
    const js = buildContinuationMountJs(opts);
    expect(js).toContain(`getElementById('${WALLPAPER_CONTINUATION_ID}')`);
    expect(js).toContain(`document.createElement('div')`);
    expect(js).toContain('aria-hidden');
  });

  it('positions the layer from the computed host-window offset', () => {
    const js = buildContinuationMountJs(opts);
    // computeContinuationLayout(primary=0,0 side=1200,0) → left:-1200, top:0
    expect(js).toContain('left:-1200px');
    expect(js).toContain('top:0px');
    expect(js).toContain('width:1200px');
    expect(js).toContain('height:800px');
  });

  it('reuses the shared image src and never carries its own scrim', () => {
    const js = buildContinuationMountJs(opts);
    expect(js).toContain('http://127.0.0.1:0/wp.png');
    // Continuation is background-only — the scrim/guard lives on the primary.
    expect(js).toContain('pointer-events:none');
    expect(js).toContain('z-index:-2');
  });

  it('escapes the render JS with JSON.stringify (alignment fill → object-fit cover)', () => {
    const js = buildContinuationMountJs(opts);
    // buildMediaElementCss maps alignment 'fill' → object-fit:cover
    expect(js).toContain('object-fit:cover');
    expect(js.startsWith('(async')).toBe(true);
  });
});

describe('buildContinuationRemoveJs', () => {
  it('removes the continuation element idempotently', () => {
    const js = buildContinuationRemoveJs();
    expect(js).toContain(`getElementById('${WALLPAPER_CONTINUATION_ID}')`);
    expect(js).toContain('.remove()');
  });
});
