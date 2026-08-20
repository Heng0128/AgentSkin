// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioStatusBar
 *
 * Workspace status bar — 24px fixed bottom, displays:
 *   · fingerprint (bg/fg/accent color swatches)
 *   · zoom percentage
 *   · inspect mode indicator
 *
 * Multi-window view mode display is removed.
 */

import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import { paletteFromSnapshot } from './palette';

/**
 * Extract bg/fg/accent hex values from the snapshot.
 *
 * Tries CSS custom properties on `:root` first (most reliable), then
 * delegates to `paletteFromSnapshot` which scans landmark computed styles.
 */
function extractFingerprintColors(
  snapshot: ReturnType<typeof useStudioStore.getState>['snapshot'],
): {
  bg: string | null;
  fg: string | null;
  accent: string | null;
} {
  if (!snapshot) return { bg: null, fg: null, accent: null };

  // Try root vars first (most reliable).
  const rootVars = snapshot.rootVars;
  if (rootVars) {
    return {
      bg: rootVars['--color-background'] || rootVars['--background'] || null,
      fg: rootVars['--color-foreground'] || rootVars['--foreground'] || null,
      accent: rootVars['--color-accent'] || rootVars['--accent'] || null,
    };
  }

  // Delegate to shared palette extractor.
  const palette = paletteFromSnapshot(snapshot);
  return palette;
}

export function StudioStatusBar({ t }: { t: UiMessages }) {
  const snapshot = useStudioStore((s) => s.snapshot);
  const inspectMode = useStudioStore((s) => s.inspectMode);
  const window = useWorkspaceStore((s) => s.window);

  const scale = window?.scale ?? 1;
  const zoomPct = Math.round(scale * 100);

  const colors = extractFingerprintColors(snapshot);

  return (
    <footer className="ws-statusbar">
      {/* Fingerprint: bg / fg / accent color dots */}
      <span className="inline-flex items-center gap-[4px]">
        <span
          className="inline-block size-[7px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
          style={{ background: colors.bg || 'transparent' }}
          title={colors.bg ? t.studioStatusBg(colors.bg) : 'bg: n/a'}
        />
        <span
          className="inline-block size-[7px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
          style={{ background: colors.fg || 'transparent' }}
          title={colors.fg ? t.studioStatusFg(colors.fg) : 'fg: n/a'}
        />
        <span
          className="inline-block size-[7px] rounded-[var(--radius-sm)] border border-[var(--border-subtle)]"
          style={{ background: colors.accent || 'transparent' }}
          title={colors.accent ? t.studioStatusAccent(colors.accent) : 'accent: n/a'}
        />
        <span className="val ml-[2px]">
          {colors.bg || '—'} / {colors.fg || '—'} / {colors.accent || '—'}
        </span>
      </span>

      <span className="sep">·</span>
      <span>{t.studioStatusZoom(zoomPct)}</span>

      {inspectMode && (
        <>
          <span className="sep">·</span>
          <span style={{ color: 'var(--accent)' }}>● {t.studioStatusInspect}</span>
        </>
      )}
    </footer>
  );
}
