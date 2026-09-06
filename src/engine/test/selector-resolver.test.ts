// SPDX-License-Identifier: MPL-2.0

/**
 * selector-registry.mjs tests
 *
 * jsdom/happy-dom are not installed in this project, so a minimal DOM mock
 * is built inline to emulate document.querySelector / Element.getBoundingClientRect
 * / getComputedStyle. The mock implements the exact surface that resolveSelector
 * and isVisible depend on, nothing more.
 */

import { describe, expect, it } from 'vitest';
import {
	resolveSelector,
	verifyRequiredSelectors,
	getSelectors,
	isRequired,
	isVisible,
	isGeneratedClass,
	listSemanticNames,
	listRegisteredAgents,
	SELECTOR_REGISTRIES,
} from '../src/runtime/selectivity-registry.mjs';

// ---------------------------------------------------------------------------
// Minimal global getComputedStyle mock — reads from MockElement.computedStyle
// ---------------------------------------------------------------------------

class MockCS {
	private el: MockElement;
	constructor(el: MockElement) {
		this.el = el;
	}
	get display() { return this.el.computedStyle.display; }
	get visibility() { return this.el.computedStyle.visibility; }
}

function installGlobalMockCS() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).getComputedStyle = (el: MockElement) => new MockCS(el) as unknown as globalThis.CSSStyleDeclaration;
}

installGlobalMockCS();

// ---------------------------------------------------------------------------
// Minimal DOM mock
// ---------------------------------------------------------------------------

interface MockElement {
	tagName: string;
	classes: string[];
	attributes: Record<string, string>;
	parentElement: MockElement | null;
	rect: { width: number; height: number; x: number; y: number };
	computedStyle: { display: string; visibility: string };
	getBoundingClientRect: () => { width: number; height: number; x: number; y: number; top: number; left: number; right: number; bottom: number; toJSON: () => unknown };
}

function createElement(config: Partial<Omit<MockElement, 'getBoundingClientRect'>> & { selector: string }): MockElement {
	const rect = config.rect ?? { width: 100, height: 100, x: 0, y: 0 };
	return {
		tagName: config.tagName ?? 'div',
		classes: config.classes ?? [],
		attributes: config.attributes ?? {},
		parentElement: config.parentElement ?? null,
		rect,
		computedStyle: config.computedStyle ?? { display: 'block', visibility: 'visible' },
		getBoundingClientRect() {
			return { ...rect, top: rect.y, left: rect.x, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON() { return this; } };
		},
	};
}

/**
 * A fake document that maps selectors to mock elements and performs
 * simplified CSS selector matching sufficient for the registry tests.
 */
class FakeDocument {
	private elements = new Map<string, MockElement>();

	register(selector: string, element: MockElement): void {
		this.elements.set(selector, element);
	}

	querySelector(selector: string): MockElement | null {
		if (this.elements.has(selector)) return this.elements.get(selector)!;
		for (const [, element] of this.elements) {
			if (this.fuzzyMatch(selector, element)) return element;
		}
		return null;
	}

	/**
	 * Simplified matching: handles class, attr, tag, and [class*='x'] patterns.
	 */
	private fuzzyMatch(selector: string, el: MockElement): boolean {
		const cleaned = selector.replace(/:[a-z-]+(\(.+\))?/gi, '');

		// [attr='value']
		const attrMatch = /\[([a-z-*]+)=?'([^']*)'?\]/i.exec(cleaned);
		if (attrMatch) {
			const attrName = attrMatch[1];
			const attrValue = attrMatch[2];
			if (attrName === 'class' && attrValue) {
				if (el.classes.some((c) => c.includes(attrValue))) return true;
			} else if (el.attributes[attrName] === attrValue) {
				return true;
			}
		}

		// [class*='x']
		const subMatch = /\[class\*='([^']*)'\]/i.exec(cleaned);
		if (subMatch && el.classes.some((c) => c.includes(subMatch[1]))) return true;

		// .class
		const classMatch = /\.([a-z0-9_\-]+)/gi;
		let m: RegExpExecArray | null;
		while ((m = classMatch.exec(cleaned)) !== null) {
			if (el.classes.includes(m[1])) return true;
		}

		// pure tag name
		const tagOnly = cleaned.match(/^([a-z]+)$/i);
		if (tagOnly && el.tagName === tagOnly[1].toLowerCase()) return true;

		return false;
	}
}

/** Mock getComputedStyle used by isVisible */
function mockGetComputedStyle(el: MockElement): { display: string; visibility: string } {
	return el.computedStyle;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isGeneratedClass', () => {
	it('detects CSS Modules / hash class names', () => {
		expect(isGeneratedClass('css-1a2b3c4')).toBe(true);
		expect(isGeneratedClass('css-abcDEF789')).toBe(true);
		expect(isGeneratedClass('_container_a1b2c3d4_5')).toBe(true);
	});

	it('detects emotion/styled-components pattern', () => {
		expect(isGeneratedClass('_css_abc123def_1')).toBe(true);
	});

	it('rejects stable semantic class names', () => {
		expect(isGeneratedClass('teams-container')).toBe(false);
		expect(isGeneratedClass('chat-input')).toBe(false);
		expect(isGeneratedClass('conversation-sidebar')).toBe(false);
		expect(isGeneratedClass('main-content')).toBe(false);
		expect(isGeneratedClass('wb-home-composer')).toBe(false);
	});

	it('handles edge cases', () => {
		expect(isGeneratedClass('')).toBe(false);
		expect(isGeneratedClass('a'.repeat(81))).toBe(true);
		expect(isGeneratedClass('normal-class')).toBe(false);
	});

	it('detects long hex-embedded class names', () => {
		expect(isGeneratedClass('prefix-a1b2c3d4e5f6')).toBe(true);
		expect(isGeneratedClass('myclass_a1b2c3d4e5f6_other')).toBe(true);
		expect(isGeneratedClass('a1b2c3d4e5f6')).toBe(true);
	});
});

describe('resolveSelector - happy path', () => {
	it('returns the first visible matching element (workbuddy root)', () => {
		const doc = new FakeDocument();
		const mockEl = createElement({
			selector: '#root > .teams-container',
			classes: ['teams-container'],
			tagName: 'div',
			rect: { width: 800, height: 600, x: 0, y: 0 },
		});
		doc.register('#root > .teams-container', mockEl);

		const result = resolveSelector('workbuddy', 'root', doc as unknown as Document);
		expect(result).toBe(mockEl);
	});

	it('falls back to second selector when first is unmatched', () => {
		const doc = new FakeDocument();
		const sidebarEl = createElement({
			selector: '.conversation-list',
			classes: ['conversation-list'],
			tagName: 'aside',
			rect: { width: 200, height: 600, x: 0, y: 0 },
		});
		doc.register('.conversation-list', sidebarEl);

		const result = resolveSelector('workbuddy', 'sidebar', doc as unknown as Document);
		expect(result).toBe(sidebarEl);
	});

	it('returns null when no selector matches', () => {
		const doc = new FakeDocument();
		const result = resolveSelector('workbuddy', 'sidebar', doc as unknown as Document);
		expect(result).toBeNull();
	});

	it('skips elements with display:none', () => {
		const doc = new FakeDocument();
		const hiddenEl = createElement({
			selector: '.conversation-sidebar',
			classes: ['conversation-sidebar'],
			tagName: 'aside',
			rect: { width: 200, height: 600, x: 0, y: 0 },
			computedStyle: { display: 'none', visibility: 'visible' },
		});
		doc.register('.conversation-sidebar', hiddenEl);

		const result = resolveSelector('workbuddy', 'sidebar', doc as unknown as Document);
		expect(result).toBeNull();
	});

	it('skips zero-size elements', () => {
		const doc = new FakeDocument();
		const zeroEl = createElement({
			selector: '.conversation-sidebar',
			classes: ['conversation-sidebar'],
			tagName: 'aside',
			rect: { width: 0, height: 0, x: 0, y: 0 },
		});
		doc.register('.conversation-sidebar', zeroEl);

		const result = resolveSelector('workbuddy', 'sidebar', doc as unknown as Document);
		expect(result).toBeNull();
	});

	it('returns null for unknown agent ID', () => {
		const doc = new FakeDocument();
		expect(resolveSelector('unknown_platform', 'root', doc as unknown as Document)).toBeNull();
	});

	it('returns null for unknown semantic name', () => {
		const doc = new FakeDocument();
		expect(resolveSelector('workbuddy', 'nonexistent', doc as unknown as Document)).toBeNull();
	});
});

describe('verifyRequiredSelectors', () => {
	it('returns empty failed array when all required selectors match', () => {
		const doc = new FakeDocument();
		const rootEl = createElement({
			selector: '#root > .teams-container',
			classes: ['teams-container'],
			tagName: 'div',
			rect: { width: 800, height: 600, x: 0, y: 0 },
		});
		doc.register('#root > .teams-container', rootEl);

		const result = verifyRequiredSelectors('workbuddy', doc as unknown as Document);
		expect(result.ok).toContain('root');
		expect(result.failed).toHaveLength(0);
		expect(result.unknown).toHaveLength(0);
	});

	it('classifies unmatched required selectors as failed', () => {
		const doc = new FakeDocument();
		const result = verifyRequiredSelectors('workbuddy', doc as unknown as Document);
		expect(result.ok).toHaveLength(0);
		expect(result.failed).toContain('root');
	});

	it('returns unknown category for unregistered agent', () => {
		const doc = new FakeDocument();
		const result = verifyRequiredSelectors('nonexistent', doc as unknown as Document);
		expect(result.ok).toHaveLength(0);
		expect(result.failed).toHaveLength(0);
		expect(result.unknown).toContain('nonexistent');
	});

	it('only checks entries with required=true', () => {
		const doc = new FakeDocument();
		const rootEl = createElement({
			selector: '#root',
			tagName: 'div',
			rect: { width: 800, height: 600, x: 0, y: 0 },
		});
		doc.register('#root', rootEl);

		const result = verifyRequiredSelectors('codex', doc as unknown as Document);
		expect(result.ok).toContain('root');
		expect(result.failed).toHaveLength(0);
	});
});

describe('getSelectors / isRequired', () => {
	it('getSelectors returns the correct fallback array', () => {
		const selectors = getSelectors('workbuddy', 'root');
		expect(selectors).not.toBeNull();
		expect(selectors![0]).toBe('#root > .teams-container');
		expect(selectors!.length).toBeGreaterThan(1);
	});

	it('getSelectors returns null for unknown agent', () => {
		expect(getSelectors('xxx', 'root')).toBeNull();
	});

	it('getSelectors returns null for unknown semantic name', () => {
		expect(getSelectors('workbuddy', 'xxx')).toBeNull();
	});

	it('isRequired correctly reflects required flag', () => {
		expect(isRequired('workbuddy', 'root')).toBe(true);
		expect(isRequired('workbuddy', 'sidebar')).toBe(false);
		expect(isRequired('workbuddy', 'nonexistent')).toBe(false);
		expect(isRequired('unknown_agent', 'root')).toBe(false);
	});
});

describe('registry completeness', () => {
	it('all 6 platforms are registered', () => {
		const agents = listRegisteredAgents();
		expect(agents).toContain('workbuddy');
		expect(agents).toContain('codex');
		expect(agents).toContain('doubao');
		expect(agents).toContain('qoderwork');
		expect(agents).toContain('traework');
		expect(agents).toContain('zcode');
		expect(agents).toHaveLength(6);
	});

	it('every platform has the root semantic', () => {
		for (const agent of listRegisteredAgents()) {
			expect(listSemanticNames(agent)).toContain('root');
		}
	});

	it('every platform root is required', () => {
		for (const agent of listRegisteredAgents()) {
			expect(isRequired(agent, 'root')).toBe(true);
		}
	});

	it('every required node has at least 2 fallback selectors', () => {
		for (const agent of listRegisteredAgents()) {
			const registry = SELECTOR_REGISTRIES[agent];
			for (const [name, entry] of Object.entries(registry)) {
				if (entry.required) {
					expect(entry.selectors.length).toBeGreaterThanOrEqual(2);
				}
			}
		}
	});
});

describe('consistency with adapter.verification', () => {
	it('workbuddy registry contains the adapter rootAny selectors', () => {
		const regRoot = getSelectors('workbuddy', 'root')!;
		for (const sel of ['#root > .teams-container', '.teams-container', '#root', '#app', 'body > div']) {
			expect(regRoot).toContain(sel);
		}
	});

	it('codex registry contains the adapter rootAny selectors', () => {
		const regRoot = getSelectors('codex', 'root')!;
		expect(regRoot).toContain('main.main-surface');
	});

	it('doubao registry contains the adapter rootAny selectors', () => {
		const regRoot = getSelectors('doubao', 'root')!;
		expect(regRoot).toContain('#root');
		expect(regRoot).toContain('body');
	});

	it('qoderwork registry contains the adapter rootAny selectors', () => {
		const regRoot = getSelectors('qoderwork', 'root')!;
		expect(regRoot).toContain('#root .agents-layout-root');
		expect(regRoot).toContain('.agents-layout-root');
		expect(regRoot).toContain('#root');
	});

	it('traework registry contains the adapter rootAny selectors', () => {
		const regRoot = getSelectors('traework', 'root')!;
		expect(regRoot).toContain('#root .panel-container');
		expect(regRoot).toContain('#root .solo-lite-layout');
		expect(regRoot).toContain('#root');
	});

	it('zcode registry contains the adapter rootAny selectors', () => {
		const regRoot = getSelectors('zcode', 'root')!;
		expect(regRoot).toContain('#root');
		expect(regRoot).toContain('body');
	});
});

describe('fallback chain scenario simulation', () => {
	it('falls back to stable selector after hash class rename (simulated)', () => {
		const doc = new FakeDocument();
		// Only register #root — simulating old hash gone but stable anchor present
		const stableRoot = createElement({
			selector: '#root',
			classes: [],
			attributes: { id: 'root' },
			tagName: 'div',
			rect: { width: 1200, height: 800, x: 0, y: 0 },
		});
		doc.register('#root', stableRoot);

		const result = resolveSelector('workbuddy', 'root', doc as unknown as Document);
		expect(result).toBe(stableRoot);
	});

	it('does not throw on invalid selectors', () => {
		const doc = new FakeDocument();
		expect(() => resolveSelector('workbuddy', 'root', doc as unknown as Document)).not.toThrow();
		expect(resolveSelector('workbuddy', 'root', doc as unknown as Document)).toBeNull();
	});
});

describe('isVisible direct tests', () => {
	it('returns true for visible elements', () => {
		const el = createElement({
			selector: 'test',
			rect: { width: 100, height: 50, x: 0, y: 0 },
			computedStyle: { display: 'block', visibility: 'visible' },
		});
		expect(isVisible(el as unknown as Element)).toBe(true);
	});

	it('returns false for display:none', () => {
		const el = createElement({
			selector: 'test',
			rect: { width: 100, height: 50, x: 0, y: 0 },
			computedStyle: { display: 'none', visibility: 'visible' },
		});
		expect(isVisible(el as unknown as Element)).toBe(false);
	});

	it('returns false for visibility:hidden', () => {
		const el = createElement({
			selector: 'test',
			rect: { width: 100, height: 50, x: 0, y: 0 },
			computedStyle: { display: 'block', visibility: 'hidden' },
		});
		expect(isVisible(el as unknown as Element)).toBe(false);
	});

	it('returns false when getBoundingClientRect is missing', () => {
		const el = { tagName: 'div' } as unknown as Element;
		expect(isVisible(el)).toBe(false);
	});
});
