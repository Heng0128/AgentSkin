// SPDX-License-Identifier: MPL-2.0

/**
 * # UI Contract – White-list / Black-list
 *
 * This file is the boundary marker. The UI layer (renderer) may ONLY import
 * from this white-list. Anything not listed here is forbidden.
 *
 * ## Allowed imports (Presentation Domain)
 *
 *   @shared/types:  AgentCatalogItem, ThemeCatalogItem, CatalogResult,
 *                   AgentSkinApi, AgentCapabilities, AgentCatalogStatus,
 *                   ThemeSource, AgentId, AppLocale, ApplyRequest, etc.
 *   @shared/i18n:   UiMessages, uiMessages, DEFAULT_LOCALE
 *   ./types/*:      Component-level models (ThemeCardModel, AgentCardModel, …)
 *
 * ## Allowed IPC
 *
 * Hooks and components MUST import `api` from `@/api/agentSkinClient` and
 * call methods on it — NEVER touch `window.agentSkin` directly. The `api`
 * singleton is a typed {@link AgentSkinClient} (which `extends AgentSkinApi`
 * from `shared/types.ts`), so:
 *
 *   catalog.agents.list()        → CatalogResult<AgentCatalogItem>
 *   catalog.themes.list()        → CatalogResult<ThemeCatalogItem>
 *   catalog.themes.get(id)       → ThemeCatalogItem | null
 *   catalog.themes.search(q)     → CatalogResult<ThemeCatalogItem>
 *   catalog.themes.filter(aid)   → CatalogResult<ThemeCatalogItem>
 *   applyTheme(request)          → ApplyResponse
 *   restoreApp(appId)            → SystemStatus
 *   importTheme / exportTheme / deleteTheme / settings.*
 *
 * Direct `window.agentSkin` access is forbidden in the renderer (it bypasses
 * the typed contract and prevents unit-test mocking).
 *
 * ## Forbidden (Execution Domain – NEVER import in renderer)
 *
 *   ThemePackage, ThemeBundle, InstalledTheme  (core/install format)
 *   ThemeLibrary, ThemeEntry                    (file-system layer)
 *   ApplicationAdapter, BaseApplicationAdapter (adapter layer)
 *   AgentAdapterInfo, AgentDisplayMeta         (catalog internals)
 *   Registry, registerBuiltinAdapters          (runtime registry)
 *   agentskin-core-runtime, @agentskin/core    (engine)
 *
 * Violation = architectural breach. If a component needs a field that isn't
 * on the catalog item, add it to the catalog item in shared/types.ts, not by
 * reaching into the execution domain.
 */

export type { AgentCatalogItem, AgentCapabilities, AgentCatalogStatus, ThemeCatalogItem, ThemeSource, CatalogResult, AgentId, AgentSkinApi } from '@shared/types';
export type { AgentSkinClient } from '@/api/agentSkinClient';
