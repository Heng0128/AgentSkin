// SPDX-License-Identifier: MPL-2.0
//
// Tests for dom-snapshot.mjs — DOM Snapshot API
//
// Covers: CDP connection, DOM capture, filtering rules, selector generation,
// output format, and landmark matching. Uses mock CDP client for isolation.

import { describe, expect, it } from 'vitest';
import {
  captureDomSnapshot,
  filterSensitiveAttributes,
  generateFullPathSelector,
  generateStableSelector,
  isExcludedTag,
  matchLandmark,
  parseArgs,
} from './dom-snapshot.mjs';

// ---------------------------------------------------------------------------
// Mock CDP Client
// ---------------------------------------------------------------------------

/**
 * Create a mock CDP client that returns predefined results for
 * Runtime.enable and Runtime.evaluate.
 *
 * @param {object} captureResult - The parsed JSON result from the capture expression.
 * @returns {object} Mock CDP client with send() method.
 */
function createMockCdpClient(captureResult) {
  return {
    async send(method, _params) {
      if (method === 'Runtime.enable') {
        return {};
      }
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            type: 'string',
            value: JSON.stringify(captureResult),
          },
        };
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
    close() {},
  };
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** A realistic capture result simulating a workbuddy-like page. */
const MOCK_CAPTURE_RESULT = {
  url: '/chat/session-abc',
  totalElements: 200,
  filteredElements: 150,
  truncated: false,
  nodes: [
    {
      tagName: 'div',
      id: 'root',
      attributes: { class: 'app-root', 'data-view-id': 'main-root' },
      boundingBox: { x: 0, y: 0, width: 1200, height: 800 },
      computedStyle: {
        backgroundColor: 'rgb(255, 255, 255)',
        color: 'rgb(0, 0, 0)',
        fontSize: '14px',
      },
      visible: true,
    },
    {
      tagName: 'div',
      id: null,
      attributes: { class: 'chat-container _abc123_hash data-view-id="chat-surface"' },
      boundingBox: { x: 200, y: 0, width: 800, height: 800 },
      computedStyle: {
        backgroundColor: 'rgb(245, 245, 245)',
        color: 'rgb(33, 33, 33)',
        fontSize: '14px',
      },
      visible: true,
    },
    {
      tagName: 'nav',
      id: null,
      attributes: { class: 'sidebar-nav', role: 'navigation' },
      boundingBox: { x: 0, y: 0, width: 200, height: 800 },
      computedStyle: {
        backgroundColor: 'rgb(30, 30, 30)',
        color: 'rgb(200, 200, 200)',
        fontSize: '13px',
      },
      visible: true,
    },
    {
      tagName: 'input',
      id: 'message-input',
      attributes: {
        class: 'compose-input',
        type: 'text',
        placeholder: 'Type a message...',
        value: 'secret text',
      },
      boundingBox: { x: 220, y: 760, width: 760, height: 40 },
      computedStyle: {
        backgroundColor: 'rgb(255, 255, 255)',
        color: 'rgb(0, 0, 0)',
        fontSize: '14px',
      },
      visible: true,
    },
    {
      tagName: 'a',
      id: null,
      attributes: {
        class: 'link',
        href: 'https://example.com/sensitive',
        'data-url': 'https://example.com/data',
      },
      boundingBox: { x: 100, y: 100, width: 50, height: 20 },
      computedStyle: { color: 'rgb(0, 0, 255)', fontSize: '14px' },
      visible: true,
    },
    {
      tagName: 'div',
      id: null,
      attributes: { class: 'tooltip _xyz789_hash', 'aria-label': 'User profile', role: 'button' },
      boundingBox: { x: 300, y: 200, width: 120, height: 40 },
      computedStyle: {
        backgroundColor: 'rgb(50, 50, 50)',
        color: 'rgb(255, 255, 255)',
        fontSize: '12px',
      },
      visible: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests: parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses --port and --adapter', () => {
    const args = parseArgs(['--port', '9222', '--adapter', 'workbuddy']);
    expect(args.port).toBe(9222);
    expect(args.adapter).toBe('workbuddy');
    expect(args.includeHidden).toBe(false);
  });

  it('parses --include-hidden flag', () => {
    const args = parseArgs(['--port', '9222', '--adapter', 'codex', '--include-hidden']);
    expect(args.includeHidden).toBe(true);
  });

  it('parses --out option', () => {
    const args = parseArgs(['--port', '9222', '--adapter', 'codex', '--out', 'output.json']);
    expect(args.out).toBe('output.json');
  });

  it('parses --max-elements option', () => {
    const args = parseArgs(['--port', '9222', '--adapter', 'codex', '--max-elements', '500']);
    expect(args.maxElements).toBe(500);
  });

  it('uses default max-elements when not specified', () => {
    const args = parseArgs(['--port', '9222', '--adapter', 'codex']);
    expect(args.maxElements).toBe(1500);
  });
});

// ---------------------------------------------------------------------------
// Tests: isExcludedTag
// ---------------------------------------------------------------------------

describe('isExcludedTag', () => {
  it('excludes script, style, noscript tags', () => {
    expect(isExcludedTag('script')).toBe(true);
    expect(isExcludedTag('style')).toBe(true);
    expect(isExcludedTag('noscript')).toBe(true);
  });

  it('excludes iframe, object, embed tags', () => {
    expect(isExcludedTag('iframe')).toBe(true);
    expect(isExcludedTag('object')).toBe(true);
    expect(isExcludedTag('embed')).toBe(true);
  });

  it('excludes SVG-related tags', () => {
    expect(isExcludedTag('svg')).toBe(true);
    expect(isExcludedTag('path')).toBe(true);
    expect(isExcludedTag('g')).toBe(true);
  });

  it('does not exclude content tags', () => {
    expect(isExcludedTag('div')).toBe(false);
    expect(isExcludedTag('span')).toBe(false);
    expect(isExcludedTag('button')).toBe(false);
    expect(isExcludedTag('a')).toBe(false);
    expect(isExcludedTag('input')).toBe(false);
    expect(isExcludedTag('nav')).toBe(false);
    expect(isExcludedTag('main')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tests: filterSensitiveAttributes
// ---------------------------------------------------------------------------

describe('filterSensitiveAttributes', () => {
  it('removes aria-label and aria-describedby', () => {
    const input = {
      class: 'btn',
      'aria-label': 'Submit button',
      role: 'button',
    };
    const result = filterSensitiveAttributes(input);
    expect(result.class).toBe('btn');
    expect(result.role).toBe('button');
    expect(result['aria-label']).toBeUndefined();
    expect(result['aria-describedby']).toBeUndefined();
  });

  it('removes value and placeholder from form elements', () => {
    const input = {
      class: 'input',
      type: 'text',
      value: 'secret',
      placeholder: 'Enter text',
    };
    const result = filterSensitiveAttributes(input);
    expect(result.class).toBe('input');
    expect(result.type).toBe('text');
    expect(result.value).toBeUndefined();
    expect(result.placeholder).toBeUndefined();
  });

  it('removes href and src URL attributes', () => {
    const input = {
      class: 'link',
      href: 'https://example.com/private',
      src: 'https://example.com/image.png',
    };
    const result = filterSensitiveAttributes(input);
    expect(result.class).toBe('link');
    expect(result.href).toBeUndefined();
    expect(result.src).toBeUndefined();
  });

  it('preserves data-* attributes (non-URL)', () => {
    const input = {
      class: 'component',
      'data-view-id': 'chat-surface',
      'data-testid': 'submit-btn',
    };
    const result = filterSensitiveAttributes(input);
    expect(result['data-view-id']).toBe('chat-surface');
    expect(result['data-testid']).toBe('submit-btn');
  });

  it('removes data-src and data-href URL attributes', () => {
    const input = {
      'data-src': 'https://cdn.example.com/img.jpg',
      'data-href': 'https://example.com/page',
      'data-view-id': 'main',
    };
    const result = filterSensitiveAttributes(input);
    expect(result['data-src']).toBeUndefined();
    expect(result['data-href']).toBeUndefined();
    expect(result['data-view-id']).toBe('main');
  });
});

// ---------------------------------------------------------------------------
// Tests: generateStableSelector
// ---------------------------------------------------------------------------

describe('generateStableSelector', () => {
  it('returns #id when element has an id', () => {
    const node = { tagName: 'div', id: 'root', attributes: { class: 'app' } };
    expect(generateStableSelector(node)).toBe('#root');
  });

  it('prefers data-view-id over class', () => {
    const node = {
      tagName: 'div',
      id: null,
      attributes: { class: 'chat-container', 'data-view-id': 'chat-surface' },
    };
    expect(generateStableSelector(node)).toBe('[data-view-id="chat-surface"]');
  });

  it('prefers data-testid', () => {
    const node = {
      tagName: 'button',
      id: null,
      attributes: { class: 'btn _hash1234', 'data-testid': 'send-btn' },
    };
    expect(generateStableSelector(node)).toBe('[data-testid="send-btn"]');
  });

  it('returns first stable class when no id or data-*', () => {
    const node = {
      tagName: 'div',
      id: null,
      attributes: { class: 'chat-container _abc123_hash' },
    };
    expect(generateStableSelector(node)).toBe('.chat-container');
  });

  it('skips CSS Modules hashed class names', () => {
    const node = {
      tagName: 'div',
      id: null,
      attributes: { class: '_assistantRow_14nyt_184 _header_abc123' },
    };
    // All classes are hashed — should fall through to role or tag
    const result = generateStableSelector(node);
    // With no role and no stable class, it returns null for non-landmark tags
    expect(result).toBeNull();
  });

  it('returns role selector when no id/class/data', () => {
    const node = {
      tagName: 'div',
      id: null,
      attributes: { role: 'navigation' },
    };
    expect(generateStableSelector(node)).toBe('[role="navigation"]');
  });

  it('returns tag name for landmark elements', () => {
    const node = { tagName: 'main', id: null, attributes: {} };
    expect(generateStableSelector(node)).toBe('main');

    const node2 = { tagName: 'nav', id: null, attributes: {} };
    expect(generateStableSelector(node2)).toBe('nav');

    const node3 = { tagName: 'aside', id: null, attributes: {} };
    expect(generateStableSelector(node3)).toBe('aside');
  });

  it('returns null for non-landmark tags without stable attributes', () => {
    const node = { tagName: 'span', id: null, attributes: {} };
    expect(generateStableSelector(node)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: generateFullPathSelector
// ---------------------------------------------------------------------------

describe('generateFullPathSelector', () => {
  it('returns #id when element has an id', () => {
    const node = { tagName: 'div', id: 'root', attributes: { class: 'app' } };
    expect(generateFullPathSelector(node)).toBe('#root');
  });

  it('returns tagName.class when element has a class', () => {
    const node = { tagName: 'div', id: null, attributes: { class: 'chat-container extra' } };
    expect(generateFullPathSelector(node)).toBe('div.chat-container');
  });

  it('returns tagName when no id or class', () => {
    const node = { tagName: 'span', id: null, attributes: {} };
    expect(generateFullPathSelector(node)).toBe('span');
  });
});

// ---------------------------------------------------------------------------
// Tests: matchLandmark
// ---------------------------------------------------------------------------

describe('matchLandmark', () => {
  it('matches role="main" to main-content', () => {
    const node = { tagName: 'div', id: null, attributes: { role: 'main' } };
    expect(matchLandmark(node, 'workbuddy')).toBe('main-content');
  });

  it('matches role="navigation" to nav', () => {
    const node = { tagName: 'div', id: null, attributes: { role: 'navigation' } };
    expect(matchLandmark(node, 'workbuddy')).toBe('nav');
  });

  it('matches role="complementary" to sidebar', () => {
    const node = { tagName: 'div', id: null, attributes: { role: 'complementary' } };
    expect(matchLandmark(node, 'workbuddy')).toBe('sidebar');
  });

  it('matches id containing "chat" to chat-surface', () => {
    const node = { tagName: 'div', id: 'chat-panel', attributes: {} };
    expect(matchLandmark(node, 'workbuddy')).toBe('chat-surface');
  });

  it('matches id containing "root" to root', () => {
    const node = { tagName: 'div', id: 'app-root', attributes: {} };
    expect(matchLandmark(node, 'workbuddy')).toBe('root');
  });

  it('matches class containing "sidebar" to sidebar', () => {
    const node = { tagName: 'div', id: null, attributes: { class: 'sidebar-panel' } };
    expect(matchLandmark(node, 'workbuddy')).toBe('sidebar');
  });

  it('matches tag "nav" to nav', () => {
    const node = { tagName: 'nav', id: null, attributes: {} };
    expect(matchLandmark(node, 'workbuddy')).toBe('nav');
  });

  it('matches tag "header" to header', () => {
    const node = { tagName: 'header', id: null, attributes: {} };
    expect(matchLandmark(node, 'workbuddy')).toBe('header');
  });

  it('returns null for non-landmark elements', () => {
    const node = { tagName: 'span', id: null, attributes: { class: 'highlight' } };
    expect(matchLandmark(node, 'workbuddy')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: captureDomSnapshot (integration with mock CDP)
// ---------------------------------------------------------------------------

describe('captureDomSnapshot', () => {
  it('produces correct output structure', async () => {
    const client = createMockCdpClient(MOCK_CAPTURE_RESULT);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'workbuddy',
      cdpClient: client,
    });

    expect(snapshot.adapter).toBe('workbuddy');
    expect(snapshot.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(snapshot.url).toBe('/chat/session-abc');
    expect(snapshot.elements).toBeInstanceOf(Array);
    expect(snapshot.elements.length).toBeGreaterThan(0);
    expect(snapshot.stats).toBeDefined();
    expect(snapshot.stats.totalElements).toBe(200);
    expect(snapshot.stats.filteredElements).toBe(150);
  });

  it('filters sensitive attributes from output elements', async () => {
    const client = createMockCdpClient(MOCK_CAPTURE_RESULT);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'workbuddy',
      cdpClient: client,
    });

    // Find the input element (should have value/placeholder stripped)
    const inputEl = snapshot.elements.find((e) => e.tagName === 'input');
    expect(inputEl).toBeDefined();
    expect(inputEl.attributes.value).toBeUndefined();
    expect(inputEl.attributes.placeholder).toBeUndefined();
    expect(inputEl.attributes.class).toBe('compose-input');
    expect(inputEl.attributes.type).toBe('text');

    // Find the link element (should have href stripped)
    const linkEl = snapshot.elements.find((e) => e.tagName === 'a');
    expect(linkEl).toBeDefined();
    expect(linkEl.attributes.href).toBeUndefined();
    expect(linkEl.attributes['data-url']).toBeUndefined();

    // Find the tooltip element (should have aria-label stripped)
    const tooltipEl = snapshot.elements.find((e) => e.attributes.role === 'button');
    expect(tooltipEl).toBeDefined();
    expect(tooltipEl.attributes['aria-label']).toBeUndefined();
  });

  it('generates stable selectors for each element', async () => {
    const client = createMockCdpClient(MOCK_CAPTURE_RESULT);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'workbuddy',
      cdpClient: client,
    });

    for (const el of snapshot.elements) {
      expect(el.stableSelector).toBeDefined();
      expect(el.selector).toBeDefined();
    }

    // Root element should have #root selector
    const rootEl = snapshot.elements.find(
      (e) => e.tagName === 'div' && e.attributes['data-view-id'] === 'main-root',
    );
    expect(rootEl).toBeDefined();
    expect(rootEl.stableSelector).toBe('#root');
  });

  it('matches landmarks correctly', async () => {
    const client = createMockCdpClient(MOCK_CAPTURE_RESULT);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'workbuddy',
      cdpClient: client,
    });

    // Root element should match 'root' landmark
    const rootEl = snapshot.elements.find((e) => e.landmarkMatch === 'root');
    expect(rootEl).toBeDefined();

    // Nav element should match 'nav' landmark
    const navEl = snapshot.elements.find((e) => e.landmarkMatch === 'nav');
    expect(navEl).toBeDefined();

    // Stats should count landmark matches
    expect(snapshot.stats.landmarkMatches).toBeGreaterThan(0);
  });

  it('includes boundingBox and computedStyle for each element', async () => {
    const client = createMockCdpClient(MOCK_CAPTURE_RESULT);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'workbuddy',
      cdpClient: client,
    });

    for (const el of snapshot.elements) {
      expect(el.boundingBox).toBeDefined();
      expect(el.boundingBox).toHaveProperty('x');
      expect(el.boundingBox).toHaveProperty('y');
      expect(el.boundingBox).toHaveProperty('width');
      expect(el.boundingBox).toHaveProperty('height');
      expect(el.computedStyle).toBeDefined();
      expect(typeof el.computedStyle).toBe('object');
    }
  });

  it('handles empty DOM gracefully', async () => {
    const emptyResult = {
      url: '/empty',
      totalElements: 0,
      filteredElements: 0,
      truncated: false,
      nodes: [],
    };
    const client = createMockCdpClient(emptyResult);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'codex',
      cdpClient: client,
    });

    expect(snapshot.elements).toEqual([]);
    expect(snapshot.stats.recordedElements).toBe(0);
    expect(snapshot.stats.landmarkMatches).toBe(0);
  });

  it('handles truncated results', async () => {
    const truncatedResult = {
      ...MOCK_CAPTURE_RESULT,
      truncated: true,
      filteredElements: 2000,
    };
    const client = createMockCdpClient(truncatedResult);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'workbuddy',
      cdpClient: client,
    });

    expect(snapshot.stats.truncated).toBe(true);
  });

  it('preserves data-* attributes in output', async () => {
    const client = createMockCdpClient(MOCK_CAPTURE_RESULT);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'workbuddy',
      cdpClient: client,
    });

    const rootEl = snapshot.elements.find((e) => e.attributes['data-view-id'] === 'main-root');
    expect(rootEl).toBeDefined();
    expect(rootEl.attributes['data-view-id']).toBe('main-root');
  });

  it('records correct element count in stats', async () => {
    const client = createMockCdpClient(MOCK_CAPTURE_RESULT);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'workbuddy',
      cdpClient: client,
    });

    expect(snapshot.stats.recordedElements).toBe(MOCK_CAPTURE_RESULT.nodes.length);
  });
});

// ---------------------------------------------------------------------------
// Tests: Output JSON serialization
// ---------------------------------------------------------------------------

describe('output JSON format', () => {
  it('produces valid JSON that can be parsed back', async () => {
    const client = createMockCdpClient(MOCK_CAPTURE_RESULT);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'workbuddy',
      cdpClient: client,
    });

    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json);

    expect(parsed.adapter).toBe('workbuddy');
    expect(parsed.elements).toBeInstanceOf(Array);
    expect(parsed.stats.totalElements).toBe(200);
  });

  it('does not leak sensitive data in serialized JSON', async () => {
    const client = createMockCdpClient(MOCK_CAPTURE_RESULT);
    const snapshot = await captureDomSnapshot({
      wsUrl: 'ws://mock',
      adapter: 'workbuddy',
      cdpClient: client,
    });

    const json = JSON.stringify(snapshot);

    // Should not contain sensitive values
    expect(json).not.toContain('secret text');
    expect(json).not.toContain('https://example.com/sensitive');
    expect(json).not.toContain('https://example.com/private');
    expect(json).not.toContain('Type a message...');
  });
});
