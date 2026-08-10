// SPDX-License-Identifier: MPL-2.0

import type { DomTreeNode } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { nodeToHtml } from './RealDomPreview';

function node(tag: string, over: Partial<DomTreeNode> = {}): DomTreeNode {
  return { tag, cls: '', style: {}, rect: { w: 0, h: 0, x: 0, y: 0 }, children: [], ...over };
}

describe('nodeToHtml — XSS 防护', () => {
  it('drops script tags entirely', () => {
    const html = nodeToHtml(node('script', { text: 'window.pwned = 1' }));
    expect(html).toBe('');
  });

  it('walks children of a dropped wrapper instead of hiding them', () => {
    const html = nodeToHtml(node('iframe', { children: [node('span', { text: 'inner' })] }));
    expect(html).not.toContain('<iframe');
    expect(html).toContain('<span>inner</span>');
  });

  it('strips on* event-handler attributes', () => {
    const html = nodeToHtml(node('img', { attrs: { onerror: 'alert(1)', src: 'x.png' } }));
    expect(html).not.toContain('onerror');
    expect(html).toContain('src="x.png"');
  });

  it('blocks javascript: / data:text/html URLs on src', () => {
    const html = nodeToHtml(
      node('img', { imgSrc: 'javascript:alert(1)', attrs: { src: 'javascript:alert(1)' } }),
    );
    expect(html).not.toContain('javascript:');
  });

  it('blocks javascript: URLs on href', () => {
    const html = nodeToHtml(node('a', { attrs: { href: 'javascript:alert(1)' }, text: 'x' }));
    expect(html).not.toContain('javascript:');
  });

  it('keeps safe content tags and escapes text', () => {
    const html = nodeToHtml(
      node('p', { text: '<b>hi</b>', children: [node('strong', { text: 'ok' })] }),
    );
    // text is escaped, strong child is rendered via allowlisted tag
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(html).toContain('<strong>ok</strong>');
  });

  it('drops object/embed/link/meta/style tags', () => {
    for (const dangerous of ['object', 'embed', 'link', 'meta', 'style']) {
      const html = nodeToHtml(node(dangerous, { text: 'x' }));
      expect(html).toBe('');
      expect(html).not.toContain(`<${dangerous}`);
    }
  });
});
