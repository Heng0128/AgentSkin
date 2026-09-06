// SPDX-License-Identifier: MPL-2.0

import { Window } from 'happy-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SkeletonTransition } from '../SkeletonTransition';

function renderToDom(node: React.ReactElement) {
  const html = renderToStaticMarkup(node);
  const window = new Window();
  window.document.write(html);
  return window.document;
}

describe('SkeletonTransition', () => {
  it('renders both layers in DOM regardless of showSkeleton', () => {
    const doc = renderToDom(
      <SkeletonTransition showSkeleton={true} skeleton={<div>skeleton</div>}>
        <div>content</div>
      </SkeletonTransition>,
    );
    expect(doc.body.textContent).toContain('skeleton');
    expect(doc.body.textContent).toContain('content');
  });

  it('shows skeleton layer (data-state=showing) when showSkeleton=true', () => {
    const doc = renderToDom(
      <SkeletonTransition showSkeleton={true} skeleton={<div>skeleton</div>}>
        <div>content</div>
      </SkeletonTransition>,
    );
    const layers = doc.querySelectorAll('[data-state]');
    expect(layers.length).toBe(2);
    // First layer (skeleton) should be showing
    expect(layers[0].getAttribute('data-state')).toBe('showing');
    // Second layer (content) should be hidden
    expect(layers[1].getAttribute('data-state')).toBe('hidden');
  });

  it('shows content layer (data-state=showing) when showSkeleton=false', () => {
    const doc = renderToDom(
      <SkeletonTransition showSkeleton={false} skeleton={<div>skeleton</div>}>
        <div>content</div>
      </SkeletonTransition>,
    );
    const layers = doc.querySelectorAll('[data-state]');
    expect(layers.length).toBe(2);
    // First layer (skeleton) should be hidden
    expect(layers[0].getAttribute('data-state')).toBe('hidden');
    // Second layer (content) should be showing
    expect(layers[1].getAttribute('data-state')).toBe('showing');
  });

  it('sets aria-hidden=true on skeleton when showSkeleton=false', () => {
    const doc = renderToDom(
      <SkeletonTransition showSkeleton={false} skeleton={<div>skeleton</div>}>
        <div>content</div>
      </SkeletonTransition>,
    );
    const hiddenEls = doc.querySelectorAll('[aria-hidden="true"]');
    // Skeleton layer should be aria-hidden when showSkeleton=false
    expect(hiddenEls.length).toBeGreaterThanOrEqual(1);
  });

  it('applies custom duration via inline style', () => {
    const doc = renderToDom(
      <SkeletonTransition showSkeleton={true} skeleton={<div>skeleton</div>} duration={400}>
        <div>content</div>
      </SkeletonTransition>,
    );
    const layers = doc.querySelectorAll('[style*="400ms"]');
    expect(layers.length).toBe(2);
  });
});
