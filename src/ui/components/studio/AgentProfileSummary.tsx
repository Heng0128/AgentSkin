// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentProfileSummary
 *
 * Displays token count, categories, brand colors, and strategy for the
 * selected agent in the project creation form.
 */

import { AppMark } from '@/components/AppMark';

import type { UiMessages } from '@shared/i18n';
import { AGENT_META, type AgentId } from '@shared/types';
import { AGENT_BRAND_COLORS, AGENT_TOKEN_COUNTS, getStrategyKey } from './agent-profile-utils';

export function AgentProfileSummary({ t, newAgent }: { t: UiMessages; newAgent: string | null }) {
  const tokens = AGENT_TOKEN_COUNTS[newAgent ?? ''];
  const brand = AGENT_BRAND_COLORS[newAgent ?? ''];
  if (!tokens || !brand) return null;
  const strategyKey = getStrategyKey(tokens.dark);
  return (
    <div className="flex flex-col gap-1 p-2 rounded-sm border border-muted">
      <div className="flex items-center justify-between">
        <span className="text-micro text-muted-foreground">{t.studioProfileSummary}</span>
        <span className="text-micro text-muted-foreground tabular-nums font-mono">
          {AGENT_META[newAgent as AgentId]?.displayName ?? newAgent}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {/* Brand color swatches */}
        <div className="flex items-center gap-1">
          <span
            className="size-4 rounded-sm border border-border"
            style={{ background: brand.dark }}
            title={`${t.studioProfileAccent} (dark)`}
          />
          <span
            className="size-4 rounded-sm border border-border"
            style={{ background: brand.light }}
            title={`${t.studioProfileAccent} (light)`}
          />
        </div>
        <span className="text-micro text-muted-foreground">{t.studioProfileTokens}:</span>
        <span className="text-micro text-foreground tabular-nums font-mono">{tokens.dark}</span>
        <span className="text-micro text-muted-foreground">{t.studioProfileCategories}:</span>
        <span className="text-micro text-foreground tabular-nums font-mono">
          {tokens.categories}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <span className="text-micro text-muted-foreground">{t.studioProfileStrategy}:</span>
        <span className="text-micro text-muted-foreground font-mono">{t[strategyKey]}</span>
      </div>
    </div>
  );
}
