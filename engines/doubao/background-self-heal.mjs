// SPDX-License-Identifier: MPL-2.0

/**
 * # doubao — Background Layer Self-Heal
 *
 * Provides the runtime logic for an independent art background layer that
 * survives Doubao's `data-theme` switch. The CSS rule
 * `div.agentskin-background-layer` is injected by the theme CSS generator
 * (`scripts/generators/doubaoCss.mjs`); this module creates the actual DOM
 * element and watches body's `style` attribute for hostile resets.
 *
 * ## Why an independent div
 *
 * The previous approach painted the art on `body::before` (a pseudo-element).
 * Doubao's native CSS redeclares `body { background }` with `!important` on
 * every `data-theme` switch, which paints an opaque fill over the hero. A
 * real element with `z-index: -1` is painted on top of body's background, so
 * the hero stays visible. The MutationObserver is the self-heal safety net:
 * when Doubao's switch mutates body's `style` attribute, we re-create the div
 * if it was removed.
 *
 * ## Contract with the adapter
 *
 * `engines/doubao/adapter.mjs` evaluates as a CDP string and cannot `import`,
 * so the same logic is mirrored inline there (search for BACKGROUND_SELF_HEAL
 * in adapter.mjs). When editing this file, update the mirror too.
 *
 * ## Lifecycle
 *
 *   createBackgroundLayer()  → DOM div inserted
 *   setupBackgroundSelfHeal() → MutationObserver on body[style]
 *   cleanupBackgroundSelfHeal() → disconnect + remove div
 */

/** CSS class applied to the background layer div. */
export const BG_LAYER_CLASS = 'agentskin-background-layer';

/** Prefix for the div's `id` attribute (suffix = Date.now()). */
export const BG_LAYER_ID_PREFIX = 'agentskin-bg-';

/**
 * Remove any existing background layer div(s).
 * Idempotent — safe to call when none exist.
 */
export function removeBackgroundLayer() {
  const existing = document.querySelector(`div.${BG_LAYER_CLASS}`);
  if (existing) existing.remove();
}

/**
 * Create the background layer div and prepend it to body.
 *
 * The div's visual appearance comes entirely from the `.agentskin-background-layer`
 * CSS rule injected by the theme CSS (position, z-index, background, …). This
 * function only creates the element, sets the id + aria-hidden, and inserts it.
 *
 * @returns {HTMLDivElement|null} The created div, or null if `--agentskin-art`
 *   is not set (no art to display).
 */
export function createBackgroundLayer() {
  const artValue = getComputedStyle(document.documentElement)
    .getPropertyValue('--agentskin-art')
    .trim();
  if (!artValue || artValue === 'none' || artValue === '') return null;

  const div = document.createElement('div');
  div.id = `${BG_LAYER_ID_PREFIX}${Date.now()}`;
  div.className = BG_LAYER_CLASS;
  div.setAttribute('aria-hidden', 'true');
  document.body.prepend(div);
  return div;
}

/**
 * Set up a MutationObserver that watches `body`'s `style` attribute.
 *
 * Doubao's `data-theme` switch mutates `body.style` (e.g. setting
 * `backgroundColor` to an opaque value). When that happens, the observer
 * restores the background layer div so the hero art stays visible.
 *
 * @returns {MutationObserver} The observer — pass to
 *   `cleanupBackgroundSelfHeal()` for disposal.
 */
export function setupBackgroundSelfHeal() {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (
        m.type !== 'attributes' ||
        m.attributeName !== 'style' ||
        m.target !== document.body
      ) {
        continue;
      }
      const body = document.body;
      const bgImg = body.style.backgroundImage;
      const bgColor = body.style.backgroundColor;
      // Doubao resets body background on data-theme switch.
      if (bgImg === '' || bgImg === 'none' || bgColor === '' || bgColor === 'transparent') {
        // Body background was reset — ensure the art layer div is present.
        const existing = document.querySelector(`div.${BG_LAYER_CLASS}`);
        if (!existing) {
          removeBackgroundLayer();
          createBackgroundLayer();
        }
      }
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
  return observer;
}

/**
 * Tear down the MutationObserver and remove the background layer div.
 *
 * @param {MutationObserver|null} observer  Observer returned by
 *   `setupBackgroundSelfHeal()`, or null if setup was never called.
 */
export function cleanupBackgroundSelfHeal(observer) {
  if (observer) observer.disconnect();
  removeBackgroundLayer();
}
