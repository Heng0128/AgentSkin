// SPDX-License-Identifier: MPL-2.0

/**
 * ambient-router.mjs — WorkBuddy 氛围路由感知注入
 *
 * 氛围收敛 UX：根据当前页面类型动态调整背景强度。
 *   - 首页 (home)：壁纸完整呈现，强度 1.0
 *   - 工作页 (workspace)：自动降低壁纸对比度，强度 0.4
 *   - 详情页 (detail)：背景进一步淡出，强度 0.15
 *
 * 通过 MutationObserver 监听 DOM 变化，检测页面类型并设置
 * --agentskin-background-opacity CSS 变量，配合 CSS transition
 * 实现平滑过渡。
 *
 * 本模块为独立 ES module，未来集成到 adapter.mjs。
 */

/** Intensity levels per page type. */
export const AMBIENT_INTENSITY = {
  HOME: 1.0,
  WORKSPACE: 0.4,
  DETAIL: 0.15,
};

/** Page type detection selectors (ordered by priority per type). */
const PAGE_SELECTORS = {
  home: [
    '[data-page="home"]',
    '.home-surface',
    '#home-view',
    '[data-testid="home-page"]',
    '.agentskin-home-active',
  ],
  workspace: [
    '[data-page="chat"]',
    '[data-page="workspace"]',
    '.conversation-surface',
    '.chat-view',
    '[data-testid="conversation"]',
  ],
  detail: [
    '[data-page="detail"]',
    '[data-page="settings"]',
    '.detail-surface',
    '.settings-view',
    '[data-testid="detail-page"]',
  ],
};

/** @typedef {'home'|'workspace'|'detail'} PageType */

/**
 * AmbientRouteManager — detects page type from DOM and applies
 * background opacity intensity via CSS custom property.
 */
export class AmbientRouteManager {
  /**
   * @param {Object} [options]
   * @param {(page: PageType, intensity: number) => void} [options.onPageChange]
   *   Callback invoked when the detected page type changes.
   * @param {string} [options.cssVariable] — CSS variable name to set.
   * @param {number} [options.transitionMs] — Transition duration in ms.
   */
  constructor(options = {}) {
    /** @type {PageType} */
    this.currentPage = 'home';
    /** @type {number} */
    this.intensity = AMBIENT_INTENSITY.HOME;
    /** @type {MutationObserver|null} */
    this.observer = null;
    /** @type {string} */
    this.cssVariable = options.cssVariable || '--agentskin-background-opacity';
    /** @type {number} */
    this.transitionMs = options.transitionMs ?? 350;
    /** @type {((page: PageType, intensity: number) => void)|null} */
    this.onPageChange = options.onPageChange || null;
  }

  /**
   * Start observing DOM for route changes.
   * Returns a stop function for convenience.
   * @returns {() => void} Stop function.
   */
  start() {
    // Apply initial intensity immediately.
    this.applyIntensity(this.currentPage);

    // Guard: MutationObserver may not be available (non-browser env).
    if (typeof MutationObserver === 'undefined') {
      return () => this.stop();
    }

    this.observer = new MutationObserver(() => {
      const detected = this.detectPage();
      if (detected !== this.currentPage) {
        this.currentPage = detected;
        this.applyIntensity(detected);
        this.onPageChange?.(detected, this.intensity);
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    return () => this.stop();
  }

  /**
   * Stop observing DOM changes and clean up.
   */
  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /**
   * Detect current page type from DOM using selector heuristics.
   * @internal
   * @returns {PageType}
   */
  detectPage() {
    // Order: home → workspace → detail. First match wins.
    for (const type of ['home', 'workspace', 'detail']) {
      const selectors = PAGE_SELECTORS[type];
      for (const sel of selectors) {
        if (document.querySelector(sel)) {
          return type;
        }
      }
    }
    // Fallback: keep current page if nothing matches.
    return this.currentPage;
  }

  /**
   * Apply intensity via CSS variable on :root.
   * @internal
   * @param {PageType} page
   */
  applyIntensity(page) {
    const key = /** @type {keyof typeof AMBIENT_INTENSITY} */ (page.toUpperCase());
    const value = AMBIENT_INTENSITY[key];
    this.intensity = value;

    const root = document.documentElement;
    root.style.setProperty(this.cssVariable, String(value));

    // Ensure transition is set for smooth opacity changes.
    const existingTransition = root.style.getPropertyValue('transition');
    if (!existingTransition.includes(this.cssVariable)) {
      root.style.setProperty(
        'transition',
        `${existingTransition ? existingTransition + ', ' : ''}background-opacity ${this.transitionMs}ms ease`.trim(),
      );
    }
  }
}

/**
 * Convenience: create and start in one call.
 * @param {ConstructorParameters<typeof AmbientRouteManager>[0]} [options]
 * @returns {{ manager: AmbientRouteManager, stop: () => void }}
 */
export function startAmbientRoute(options = {}) {
  const manager = new AmbientRouteManager(options);
  const stop = manager.start();
  return { manager, stop };
}
