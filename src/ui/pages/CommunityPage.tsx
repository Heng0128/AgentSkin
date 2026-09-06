// SPDX-License-Identifier: MPL-2.0

/**
 * # CommunityPage
 *
 * Standalone community theme browser page — two-column layout:
 *   Theme grid (main) | SourceDetailPanel (right, conditional).
 *
 * The sidebar owns the community source selector (DreamSkin / CodeDrobe),
 * so this page does NOT render a duplicate SourceRail.
 *
 * ## Sub-route integration
 *
 * The sidebar renders community source buttons under `community.<sourceId>`
 * sub-routes. Receiving any route starting with `community.`, this page:
 *   1. Parses the sub-route to extract the source id (e.g. "dreamskin").
 *   2. Calls `useCommunityStore.setActiveSource(sourceId)` to switch the store's
 *      active source slice before rendering.
 *
 * Source switching itself is handled by the sidebar. The detail panel only
 * appears when a theme is actually selected.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthorPanel } from '@/components/themes/AuthorPanel';
import { CommunityTabPanel } from '@/components/themes/CommunityTabPanel';
import { SourceDetailPanel } from '@/components/themes/SourceDetailPanel';
import { PageHeader } from '@/components/ui/page-header';
import { useCommunityStore } from '@/stores/communityStore';
import { useShellStore } from '@/stores/shellStore';
import type { CommunitySubRoute, Route } from '@/types/navigation';

import { uiMessages } from '@shared/i18n';
import { useShallow } from 'zustand/react/shallow';

interface CommunityPageProps {
  /** Parent route value, e.g. "community.dreamskin". */
  route: Route;
}

export function CommunityPage({ route }: CommunityPageProps) {
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  const { activeSourceId, selectedThemeId, setActiveSource, loadThemeDetail } = useCommunityStore(
    useShallow((s) => ({
      activeSourceId: s.activeSourceId,
      selectedThemeId: s.selectedThemeId,
      setActiveSource: s.setActiveSource,
      loadThemeDetail: s.loadThemeDetail,
    })),
  );

  // Author panel — mutually exclusive with SourceDetailPanel
  const [selectedAuthorId, setSelectedAuthorId] = useState<string | null>(null);

  const handleAuthorClick = useCallback((authorId: string) => {
    setSelectedAuthorId(authorId);
    // Clear theme selection to avoid both panels showing
    useCommunityStore.getState().selectTheme(null);
  }, []);

  const handleAuthorClose = useCallback(() => {
    setSelectedAuthorId(null);
  }, []);

  const handleSelectTheme = useCallback((themeId: string | null) => {
    if (themeId) {
      setSelectedAuthorId(null);
      void loadThemeDetail(themeId);
    }
  }, [loadThemeDetail]);

  // Parse "community.dreamskin" → "dreamskin"; strip unknown suffixes gracefully.
  // When the bare `community` route is accessed (e.g. browser refresh), treat it
  // as `dreamskin` — the default sub-source — and redirect so the sub-nav renders.
  let targetSource = route.includes('.') ? (route.split('.').pop() as CommunitySubRoute) : null;
  if (route === 'community') {
    targetSource = 'dreamskin';
  }

  // Defensive redirect: if on the bare `community` route, push to the default sub-source.
  // This also covers the case where sidebar or deep-linking lands on `community` directly.
  useEffect(() => {
    if (route === 'community') {
      void useShellStore.getState().setRoute('community.dreamskin');
    }
  }, [route]);

  // Guard against redundant source switches when the target matches the
  // current activeSourceId (avoids tearing down and re-fetching data).
  const lastSyncRef = useRef<CommunitySubRoute | null>(null);

  useEffect(() => {
    if (!targetSource) return;
    if (activeSourceId === targetSource) {
      lastSyncRef.current = targetSource;
      return;
    }
    if (lastSyncRef.current === targetSource) return;
    lastSyncRef.current = targetSource;
    void setActiveSource(targetSource);
  }, [targetSource, activeSourceId, setActiveSource]);

  // Fallback: if target is unknown or store fell back, render nothing in main.
  if (!targetSource) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PageHeader title={t.sourceCommunity} />
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <span className="text-[13px] text-muted-foreground">Unknown community source</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t.sourceCommunity} />
      <div className="flex min-h-0 min-h-0 flex-1">
        <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <CommunityTabPanel hideDetailPanel onAuthorClick={handleAuthorClick} onSelectTheme={handleSelectTheme} />
        </main>
        {/* Right panel — mutually exclusive: AuthorPanel vs SourceDetailPanel */}
        {selectedAuthorId && (
          <AuthorPanel authorId={selectedAuthorId} onClose={handleAuthorClose} onSelectTheme={handleSelectTheme} />
        )}
        {selectedThemeId && !selectedAuthorId && <SourceDetailPanel />}
      </div>
    </div>
  );
}
