// SPDX-License-Identifier: MPL-2.0

/**
 * Skeleton atom component tests.
 *
 * The ui vitest project runs in `environment: 'node'`, so we use
 * renderToStaticMarkup (SSR) and parse the HTML with happy-dom to query
 * the resulting markup — the same pattern used by StudioDrawer.test.tsx.
 */

import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PageSkeleton,
  Skeleton,
  SkeletonCard,
  SkeletonListRow,
  SkeletonStat,
  SkeletonText,
} from '../skeleton';

function renderToDom(node: React.ReactElement) {
  const html = renderToStaticMarkup(node);
  const window = new Window();
  window.document.write(html);
  return window.document;
}

describe('Skeleton atoms', () => {
  it('Skeleton renders with aria-hidden', () => {
    const doc = renderToDom(<Skeleton className="h-4 w-20" />);
    const el = doc.querySelector('[aria-hidden="true"]');
    expect(el).toBeTruthy();
  });

  it('SkeletonText renders correct number of lines', () => {
    const doc = renderToDom(<SkeletonText lines={4} />);
    const lines = doc.querySelectorAll('.animate-pulse');
    expect(lines.length).toBe(4);
  });

  it('SkeletonText defaults to 3 lines', () => {
    const doc = renderToDom(<SkeletonText />);
    const lines = doc.querySelectorAll('.animate-pulse');
    expect(lines.length).toBe(3);
  });

  it('SkeletonCard default variant renders 3 skeletons', () => {
    const doc = renderToDom(<SkeletonCard />);
    const skeletons = doc.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(3);
  });

  it('SkeletonCard wide variant renders 2 skeletons', () => {
    const doc = renderToDom(<SkeletonCard variant="wide" />);
    const skeletons = doc.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(2);
  });

  it('SkeletonCard compact variant renders 3 skeletons', () => {
    const doc = renderToDom(<SkeletonCard variant="compact" />);
    const skeletons = doc.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(3);
  });

  it('SkeletonListRow renders with avatar by default', () => {
    const doc = renderToDom(<SkeletonListRow />);
    const avatar = doc.querySelector('.rounded-full');
    expect(avatar).toBeTruthy();
  });

  it('SkeletonListRow with rounded=false uses square avatar', () => {
    const doc = renderToDom(<SkeletonListRow rounded={false} />);
    const avatar = doc.querySelector('.rounded-full');
    expect(avatar).toBeNull();
  });

  it('SkeletonListRow with avatar=false hides avatar', () => {
    const doc = renderToDom(<SkeletonListRow avatar={false} />);
    const avatar = doc.querySelector('.size-8');
    expect(avatar).toBeNull();
  });

  it('SkeletonStat without subtitle renders 2 rows', () => {
    const doc = renderToDom(<SkeletonStat />);
    const skeletons = doc.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(2);
  });

  it('SkeletonStat with subtitle renders 3 rows', () => {
    const doc = renderToDom(<SkeletonStat subtitle />);
    const skeletons = doc.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(3);
  });

  it('PageSkeleton renders children', () => {
    const doc = renderToDom(
      <PageSkeleton>
        <div data-testid="child">content</div>
      </PageSkeleton>,
    );
    expect(doc.body.textContent).toContain('content');
  });

  it('PageSkeleton header=minimal hides subtitle', () => {
    const doc = renderToDom(
      <PageSkeleton header="minimal">
        <div />
      </PageSkeleton>,
    );
    const skeletons = doc.querySelectorAll('.animate-pulse');
    // header minimal: title (1) + button (1) = 2
    expect(skeletons.length).toBe(2);
  });

  it('PageSkeleton header=false hides header', () => {
    const doc = renderToDom(
      <PageSkeleton header={false}>
        <div />
      </PageSkeleton>,
    );
    const skeletons = doc.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(0);
  });

  it('PageSkeleton toolbar=true renders filter chips', () => {
    const doc = renderToDom(
      <PageSkeleton toolbar>
        <div />
      </PageSkeleton>,
    );
    // header (3) + toolbar (5 chips + 1 search = 6) = 9
    const skeletons = doc.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(9);
  });
});
