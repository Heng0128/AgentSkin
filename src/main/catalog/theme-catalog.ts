// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeCatalog
 *
 * Provides the UI-facing theme display model. The renderer calls
 * `listThemes()` / `getTheme(id)` / `searchThemes(query)` / `filterByAgent()`
 * and receives `ThemeCatalogItem` — it never touches `ThemePackage`,
 * `ThemeLibrary`, or `@agentskin/engine`.
 *
 * ## Boundary
 *
 * The catalog does NOT import `ThemeLibrary`. It accepts a
 * `ThemeDataProvider` interface — any object that can supply installed themes
 * satisfies it. This is the seam where future data sources plug in:
 *
 *   local      →  ThemeLibrary (implements summaries())
 *   marketplace →  MarketplaceService (future: implements same interface)
 *   plugin     →  PluginThemeSource (future)
 *
 * ## Design rules
 *
 * - Catalog = view-model adapter, NOT a business/service layer
 * - `ThemePackage` is the *installation format*; `ThemeCatalogItem` is the
 *   *product display model* — they are intentionally separate
 * - No caching — each call regenerates from the data provider
 * - Product metadata (author, category, tags, license, mode) flows from
 *   v2 manifests through ThemeLibrary.toInstalledTheme() → ThemeCatalog.toItem()
 */

import type { AgentId, InstalledTheme } from '../../shared/types';
import type { ThemeCatalogItem } from './types';

/**
 * Minimal data provider the catalog consumes. `ThemeLibrary` satisfies this
 * interface structurally — no explicit implementation needed.
 */
export interface ThemeDataProvider {
  /** Returns all installed themes as summary objects. */
  summaries(): Promise<InstalledTheme[]>;
}

export class ThemeCatalog {
  constructor(private readonly source: ThemeDataProvider) {}

  /** All installed themes as display items. Color-scheme variants are merged
   *  into a single entry carrying a `schemes` list (default first). */
  async listThemes(): Promise<ThemeCatalogItem[]> {
    const themes = await this.source.summaries();
    return this.mergeSchemeVariants(themes).map((theme) => this.toItem(theme));
  }

  /** A single theme by id, or null when not installed. */
  async getTheme(id: string): Promise<ThemeCatalogItem | null> {
    const themes = await this.listThemes();
    return themes.find((t) => t.id === id) ?? null;
  }

  /**
   * Merge scheme variants (`<themeId>--<schemeId>` bundles) back into their
   * base entry so the UI shows one card per theme with a color-scheme picker
   * instead of one card per scheme.
   *
   * The base entry is the 'default' scheme bundle (plain `<themeId>` id) when
   * it carries `schemes` metadata; it keeps its own colors/mode for display
   * and gains a `schemes` list built from every variant's colors. Themes
   * without scheme metadata (legacy/imported packages) pass through unchanged.
   */
  private mergeSchemeVariants(themes: InstalledTheme[]): InstalledTheme[] {
    const byId = new Map<string, InstalledTheme>();
    const baseIds = new Set<string>();
    const variants = new Map<string, Map<string, InstalledTheme>>();

    for (const theme of themes) {
      if (theme.scheme && theme.scheme !== 'default' && theme.schemes?.length) {
        // Variant bundle: group by its declared base id (strip the --<schemeId> suffix).
        const baseId = theme.id.slice(0, theme.id.length - theme.scheme.length - 2);
        let group = variants.get(baseId);
        if (!group) {
          group = new Map();
          variants.set(baseId, group);
        }
        group.set(theme.scheme, theme);
        continue;
      }
      if (theme.schemes?.length) {
        // Default-scheme bundle with scheme metadata — the merge base.
        byId.set(theme.id, theme);
        baseIds.add(theme.id);
        continue;
      }
      byId.set(theme.id, theme);
    }

    for (const baseId of baseIds) {
      const base = byId.get(baseId);
      const group = variants.get(baseId);
      if (!base || !group || group.size === 0) continue;
      byId.set(baseId, {
        ...base,
        schemes: base.schemes?.map((s) => {
          if (s.id === 'default') {
            return { ...s, colors: base.colors ?? s.colors };
          }
          const variant = group.get(s.id);
          return variant ? { ...s, colors: variant.colors ?? s.colors } : s;
        }),
      });
    }

    return [...byId.values()];
  }

  /** Case-insensitive search across name, description, tags, and category. */
  async searchThemes(query: string): Promise<ThemeCatalogItem[]> {
    const themes = await this.listThemes();
    const q = query.trim().toLowerCase();
    if (!q) return themes;
    return themes.filter(
      (theme) =>
        theme.name.toLowerCase().includes(q) ||
        theme.description.toLowerCase().includes(q) ||
        theme.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        theme.category.toLowerCase().includes(q),
    );
  }

  /** Themes that support a specific agent. */
  async filterByAgent(agentId: AgentId): Promise<ThemeCatalogItem[]> {
    const themes = await this.listThemes();
    return themes.filter((theme) => theme.supportedAgents.includes(agentId));
  }

  /**
   * Transform an InstalledTheme into a UI-safe ThemeCatalogItem.
   * Maps v2 fields (author, category, tags, license, mode) through.
   */
  private toItem(theme: InstalledTheme): ThemeCatalogItem {
    return {
      id: theme.id,
      name: theme.displayName,
      version: theme.version,
      author: theme.author ?? '',
      description: theme.tagline ?? '',
      // Preview/icon are served as inline base64 data URLs (the library
      // already extracts them in toInstalledTheme). We deliberately do NOT use
      // a custom scheme here — `agentskin-theme://` was never registered as a
      // privileged scheme and is absent from the renderer CSP, so <img> tags
      // pointing at it are silently blocked. Base64 renders reliably.
      preview: theme.coverDataUrl,
      icon: theme.icon ?? null,
      supportedAgents: theme.supportedAgents,
      legacyTargets: theme.legacyTargets ?? [],
      category: theme.category ?? '',
      tags: theme.tags ?? [],
      license: theme.license,
      mode: theme.mode,
      unofficial: theme.unofficial,
      source: 'local',
      installed: true,
      colors: theme.colors ?? undefined,
      schemes: theme.schemes,
      wallpaper: theme.wallpaper ?? null,
    };
  }
}
