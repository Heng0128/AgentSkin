// SPDX-License-Identifier: MPL-2.0

import type { ResolvedThemeTarget } from '../../legacy/agentskin-core-runtime';
import { HOST_CLASS_PREFIX, hostClassFor } from '../../shared/injection-constants';

/**
 * Build a lightweight CSS-only injection expression for secondary targets
 * (webviews, iframes). This is the DOM-agnostic subset of core's
 * buildApplyExpression: it installs the <style> element + CSS variables + host
 * class, but skips the renderer profile runtime (chrome-layer overlay) which
 * targets the main page's DOM structure (.teams-main-content, .wb-home-page)
 * and would no-op or error on embedded content.
 *
 * The CSS variables + stylesheet alone are enough for embedded React apps
 * (MCP apps, ardot.tencent.com content) to inherit the theme's colors.
 *
 * NOTE on `agentskin-*` identifiers below: the `agentskin-theme` class,
 * `data-agentskin-*` attributes, and `--agentskin-art` / `--agentskin-image-*`
 * CSS custom properties are ENGINE CONTRACTS — @agentskin/engine's theme CSS
 * targets these exact names. They are NOT application-layer naming choices
 * and must not be renamed to `agentskin-*` without a coordinated engine
 * release plus a migration for every existing theme package.
 */
export function buildSecondaryInjectExpression(
  appId: string,
  targetTheme: ResolvedThemeTarget,
): string {
  const host = JSON.stringify({ id: appId, className: hostClassFor(appId) });
  const theme = JSON.stringify(targetTheme.theme);
  const css = JSON.stringify(targetTheme.css);
  const images = JSON.stringify({
    ...(targetTheme.imageDataUrls ?? {}),
    ...(!targetTheme.imageDataUrls?.hero && targetTheme.artDataUrl
      ? { hero: targetTheme.artDataUrl }
      : {}),
  });
  return `(() => {
    const host = ${host};
    const theme = ${theme};
    const cssText = ${css};
    const imageDataUrls = ${images};
    const styleId = 'agentskin-theme-style-' + host.id;
    const resolveImageUrl = (dataUrl) => {
      if (!dataUrl?.startsWith('data:')) return null;
      try {
        const comma = dataUrl.indexOf(',');
        const mimeType = /^data:([^;,]+)/.exec(dataUrl)?.[1] || 'application/octet-stream';
        const binary = globalThis.atob(dataUrl.slice(comma + 1));
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return globalThis.URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      } catch { return dataUrl; }
    };
    const imageUrls = {};
    for (const [name, dataUrl] of Object.entries(imageDataUrls)) {
      const imageUrl = resolveImageUrl(dataUrl);
      if (imageUrl && /^[a-z0-9][a-z0-9_-]*$/i.test(name)) imageUrls[name] = imageUrl;
    }
    const artUrl = imageUrls.hero ?? null;
    const root = document.documentElement;
    if (!root) return JSON.stringify({ installed: false, reason: 'no-root' });
    root.classList.add('agentskin-theme', host.className);
    root.dataset.agentskinHost = host.id;
    root.dataset.agentskinTheme = theme.id;
    root.dataset.agentskinThemeVersion = theme.version;
    for (const [name, imageUrl] of Object.entries(imageUrls)) {
      root.style.setProperty('--agentskin-image-' + name, 'url("' + imageUrl + '")');
    }
    if (artUrl) root.style.setProperty('--agentskin-art', 'url("' + artUrl + '")');
    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      (document.head || root).appendChild(style);
    }
    if (style.dataset.themeVersion !== theme.id + '@' + theme.version) {
      style.textContent = cssText;
      style.dataset.themeVersion = theme.id + '@' + theme.version;
    }
    return JSON.stringify({ installed: true, appId: host.id, themeId: theme.id });
  })()`;
}

/**
 * Build a CSS removal expression for secondary targets — mirrors
 * buildSecondaryInjectExpression's cleanup. Removes the <style> element,
 * host class, CSS variables, and dataset attributes.
 */
export function buildSecondaryRemoveExpression(appId: string): string {
  const hostClass = JSON.stringify(hostClassFor(appId));
  return `(() => {
    const appId = ${JSON.stringify(appId)};
    const styleId = 'agentskin-theme-style-' + appId;
    document.getElementById(styleId)?.remove();
    const root = document.documentElement;
    if (!root) return JSON.stringify({ removed: false });
    root.classList.remove(${hostClass});
    root.style.removeProperty('--agentskin-art');
    for (let i = root.style.length - 1; i >= 0; i--) {
      const name = root.style.item(i);
      if (name.startsWith('--agentskin-image-')) root.style.removeProperty(name);
    }
    if (root.dataset.agentskinHost === appId) {
      delete root.dataset.agentskinHost;
      delete root.dataset.agentskinTheme;
      delete root.dataset.agentskinThemeVersion;
    }
    if (![...root.classList].some((n) => n.startsWith('${HOST_CLASS_PREFIX}'))) {
      root.classList.remove('agentskin-theme');
    }
    return JSON.stringify({ removed: true });
  })()`;
}
