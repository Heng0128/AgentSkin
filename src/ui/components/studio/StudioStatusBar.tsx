// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioStatusBar
 *
 * Workspace status bar — 24px fixed bottom, displays:
 *   · current viewMode
 *   · fingerprint (bg/fg/accent color swatches)
 *   · active window count
 *   · zoom percentage
 *   · inspect mode indicator
 */

import { useStudioStore } from '@/stores/studioStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

/**
 * Find a CSS property value inside a landmark's `styles` array (best-effort).
 */
function findStyle(
  lm: { styles?: Array<{ property: string; value: string }> },
  prop: string,
): string | null {
  return lm.styles?.find((s) => s.property === prop)?.value ?? null;
}

/**
 * Extract bg/fg/accent hex values from the snapshot's landmarks — best-effort;
 * returns nulls when the snapshot or its styles are unavailable.
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

  // Fall back to first visible landmark's styles.
  const visible = snapshot.landmarks?.filter((lm) => lm.visible) ?? [];
  const first = visible[0] ?? snapshot.landmarks?.[0];
  if (first) {
    const bg = findStyle(first, 'background-color');
    const fg = findStyle(first, 'color');
    // accent: scan all landmarks for `accent-color`
    const accentLandmark = snapshot.landmarks?.find((lm) => findStyle(lm, 'accent-color') != null);
    return {
      bg,
      fg,
      accent: accentLandmark ? findStyle(accentLandmark, 'accent-color') : null,
    };
  }

  return { bg: null, fg: null, accent: null };
}

export function StudioStatusBar() {
  const snapshot = useStudioStore((s) => s.snapshot);
  const inspectMode = useStudioStore((s) => s.inspectMode);
  const activeWindowId = useWorkspaceStore((s) => s.activeWindowId);
  const windows = useWorkspaceStore((s) => s.windows);
  const viewMode = useWorkspaceStore((s) => s.viewMode);

  const winCount = windows.length;
  const scale = windows.find((w) => w.id === activeWindowId)?.scale ?? 1;
  const zoomPct = Math.round(scale * 100);

  const colors = extractFingerprintColors(snapshot);

  return (
    <footer className="ws-statusbar">
      <span className="val">{viewMode}</span>
      <span className="sep">·</span>

      {/* Fingerprint: bg / fg / accent color dots */}
      <span className="inline-flex items-center gap-[4px]">
        <span
          className="inline-block size-[7px] rounded-[1px] border border-[var(--border-subtle)]"
          style={{ background: colors.bg || 'transparent' }}
          title={colors.bg ? `bg: ${colors.bg}` : 'bg: n/a'}
        />
        <span
          className="inline-block size-[7px] rounded-[1px] border border-[var(--border-subtle)]"
          style={{ background: colors.fg || 'transparent' }}
          title={colors.fg ? `fg: ${colors.fg}` : 'fg: n/a'}
        />
        <span
          className="inline-block size-[7px] rounded-[1px] border border-[var(--border-subtle)]"
          style={{ background: colors.accent || 'transparent' }}
          title={colors.accent ? `accent: ${colors.accent}` : 'accent: n/a'}
        />
        <span className="val ml-[2px]">
          {colors.bg || '—'} / {colors.fg || '—'} / {colors.accent || '—'}
        </span>
      </span>

      <span className="sep">·</span>
      <span>{winCount} win</span>
      <span className="sep">·</span>
      <span>zoom {zoomPct}%</span>

      {inspectMode && (
        <>
          <span className="sep">·</span>
          <span style={{ color: 'var(--accent)' }}>● INSPECT</span>
        </>
      )}
    </footer>
  );
}
