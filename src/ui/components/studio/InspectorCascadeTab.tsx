// SPDX-License-Identifier: MPL-2.0

/**
 * # InspectorCascadeTab
 *
 * Cascade tab content for StudioInspector — self-subscribes to the studio
 * snapshot so that the parent component does not need to pass it down as prop
 * (avoids unnecessary re-renders of the entire inspector panel when snapshot
 * changes).
 */

import { CascadeView } from '@/components/studio/CascadeView';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import type { ThemeVisualSnapshot } from '@shared/types';

export function InspectorCascadeTab({ t }: { t: UiMessages }) {
  const snapshot = useStudioStore((s) => s.snapshot);

  if (!snapshot) {
    return (
      <p className="font-mono text-[10px] text-[var(--fg-2)] px-1">{t.studioInspectorEmpty}</p>
    );
  }

  // Aggregate matched rules from all visible landmarks
  const allMatchedRules = snapshot.landmarks
    .filter((lm) => lm.visible)
    .flatMap((lm) => lm.matchedRules ?? [])
    .filter((r, i, arr) => {
      // Deduplicate by selector origin
      const key = `${r.origin}:${r.selector}`;
      return arr.findIndex((x) => `${x.origin}:${x.selector}` === key) === i;
    })
    .slice(0, 12);

  // Collect platform fonts from all visible landmarks
  const allFonts = [
    ...new Set(
      snapshot.landmarks.filter((lm) => lm.visible).flatMap((lm) => lm.platformFonts ?? []),
    ),
  ].slice(0, 8);

  // Use root landmark box model
  const rootLandmark = snapshot.landmarks.find(
    (lm) => lm.selector === ':root' || lm.tag === 'html',
  );
  const boxModel = rootLandmark?.boxModel ?? null;

  return (
    <CascadeView
      cascade={{
        matchedRules: allMatchedRules,
        platformFonts: allFonts,
        boxModel,
      }}
      t={t}
    />
  );
}
