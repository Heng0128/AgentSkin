// SPDX-License-Identifier: MPL-2.0

import type { AgentCapabilities } from '../../shared/types';

export type {
  AgentCapabilities,
  AgentCatalogItem,
  AgentCatalogStatus,
  CatalogResult,
  ThemeCatalogItem,
  ThemeSource,
} from '../../shared/types';

/**
 * Internal display metadata that the AgentCatalog layer owns. NOT exported
 * through IPC — the renderer only sees AgentCatalogItem.
 */
export interface AgentDisplayMeta {
  slug: string;
  icon: string;
  description: string;
  /** Full display name when it differs from the adapter's short name. */
  displayName?: string;
  /** Brand/official name (e.g. "TRAE", "Qoder", "WorkBuddy") — not translated. */
  officialName: string;
  /** Market region for this agent build: "CN" | "International" | "Global". */
  region: 'CN' | 'International' | 'Global';
  /** Support tier: "active" or "experimental". */
  tier?: 'active' | 'experimental';
  capabilities: AgentCapabilities;
}
