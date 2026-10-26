// SPDX-License-Identifier: MPL-2.0

/**
 * # CommunityThemePreview
 *
 * Pure-frontend preview panel for a DreamSkin community theme. Renders the
 * displayMeta.colors as color swatches and a simulated UI mock (sidebar +
 * chat area) using CSS custom properties.
 *
 * Does NOT touch the injection engine — entirely presentational.
 *
 * Differs from ThemePreview (which targets installed themes' 14-token
 * palette) in that it reads DreamSkin's displayMeta.colors map directly
 * (8-10 keys: accent, secondary, background, text, muted, panel, panelAlt,
 * line, highlight, accentAlt).
 */

import type { UiMessages } from '@shared/i18n';
import type { DreamSkinDisplayMeta } from '@shared/types/community';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Token swatches
// ---------------------------------------------------------------------------

const COLOR_LABELS: Record<string, string> = {
  accent: 'Accent',
  secondary: 'Secondary',
  background: 'Background',
  text: 'Text',
  muted: 'Muted',
  panel: 'Panel',
  panelAlt: 'Panel Alt',
  line: 'Line',
  highlight: 'Highlight',
  accentAlt: 'Accent Alt',
};

function TokenSwatches({ colors }: { colors: Record<string, string> }) {
  const entries = Object.entries(colors).filter(([, v]) => Boolean(v));
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <span
            className="size-5 shrink-0 rounded-md border border-border"
            style={{ backgroundColor: value }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium leading-tight">
              {COLOR_LABELS[key] ?? key}
            </p>
            <p className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
              {value}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mock UI
// ---------------------------------------------------------------------------

function MockUI({ colors }: { colors: Record<string, string> }) {
  const style: Record<string, string> = {
    '--preview-bg': colors.background || '#1e1e2e',
    '--preview-fg': colors.text || '#cdd6f4',
    '--preview-surface': colors.panel || '#181825',
    '--preview-surface-elevated': colors.panelAlt || colors.panel || '#313244',
    '--preview-muted': colors.muted || '#6c7086',
    '--preview-border': colors.line || '#45475a',
    '--preview-accent': colors.accent || '#89b4fa',
    '--preview-secondary': colors.secondary || '#a6adc8',
    '--preview-button-bg': colors.accent || '#89b4fa',
    '--preview-button-fg': colors.background || '#1e1e2e',
    '--preview-input-bg': colors.panelAlt || colors.panel || '#313244',
    '--preview-focus': colors.highlight || colors.accent || '#89b4fa',
  };

  return (
    <div
      className="overflow-hidden rounded-md border"
      style={style as React.CSSProperties}
    >
      <div className="flex h-[240px]">
        {/* Sidebar */}
        <div
          className="flex w-10 shrink-0 flex-col gap-1 border-r p-2"
          style={{
            backgroundColor: 'var(--preview-surface)',
            borderColor: 'var(--preview-border)',
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-6 rounded-md"
              style={{ backgroundColor: 'var(--preview-surface-elevated)' }}
            />
          ))}
        </div>

        {/* Main content area */}
        <div
          className="flex flex-1 flex-col"
          style={{ backgroundColor: 'var(--preview-bg)' }}
        >
          {/* Header bar */}
          <div
            className="flex items-center gap-2 border-b px-3 py-2"
            style={{ borderColor: 'var(--preview-border)' }}
          >
            <span
              className="size-5 rounded-full"
              style={{ backgroundColor: 'var(--preview-accent)' }}
            />
            <span className="text-[11px] font-medium" style={{ color: 'var(--preview-fg)' }}>
              Chat
            </span>
            <span
              className="ml-auto size-2 rounded-full"
              style={{ backgroundColor: 'var(--preview-muted)' }}
            />
          </div>

          {/* Messages */}
          <div className="flex flex-1 flex-col gap-2 overflow-hidden p-3">
            <div className="flex gap-1.5">
              <span
                className="mt-0.5 size-4 shrink-0 rounded-full"
                style={{ backgroundColor: 'var(--preview-secondary)' }}
              />
              <div
                className="rounded-md px-2.5 py-1.5 text-[11px] leading-snug"
                style={{
                  backgroundColor: 'var(--preview-surface-elevated)',
                  color: 'var(--preview-fg)',
                }}
              >
                Hello! How can I help?
              </div>
            </div>

            <div className="flex gap-1.5 self-end">
              <div
                className="rounded-md px-2.5 py-1.5 text-[11px] leading-snug"
                style={{
                  backgroundColor: 'var(--preview-button-bg)',
                  color: 'var(--preview-button-fg)',
                }}
              >
                Show me a theme preview.
              </div>
            </div>

            {colors.accent && (
              <div
                className="rounded-md border px-2.5 py-1.5 font-mono text-[10px]"
                style={{
                  backgroundColor: 'var(--preview-surface)',
                  borderColor: 'var(--preview-border)',
                  color: 'var(--preview-fg)',
                }}
              >
                {'const x = () => { }'}
              </div>
            )}
          </div>

          {/* Input bar */}
          <div
            className="flex items-center gap-2 border-t p-2"
            style={{ borderColor: 'var(--preview-border)' }}
          >
            <div
              className="flex h-6 flex-1 items-center rounded-md border px-2 text-[10px]"
              style={{
                backgroundColor: 'var(--preview-input-bg)',
                borderColor: 'var(--preview-border)',
                color: 'var(--preview-muted)',
              }}
            >
              Type a message…
            </div>
            <span
              className="flex h-6 items-center rounded-md px-2 text-[10px] font-medium"
              style={{
                backgroundColor: 'var(--preview-button-bg)',
                color: 'var(--preview-button-fg)',
              }}
            >
              Send
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/** Filter out undefined values to produce a Record<string, string> for display. */
function definedColors(
  colors: Record<string, string | undefined> | undefined,
): Record<string, string> {
  if (!colors) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(colors)) {
    if (v) result[k] = v;
  }
  return result;
}

export interface CommunityThemePreviewProps {
  colors: DreamSkinDisplayMeta['colors'];
  t: UiMessages;
}

export function CommunityThemePreview({
  colors,
  t,
}: CommunityThemePreviewProps) {
  const colorMap = definedColors(colors);
  const hasColors = Object.keys(colorMap).length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Palette section */}
      <section>
        <h3 className="mb-2 text-[11px] font-medium tracking-tight text-muted-foreground">
          {t.colors ?? 'Colors'}
        </h3>
        {hasColors ? (
          <TokenSwatches colors={colorMap} />
        ) : (
          <p className="py-4 text-center text-[12px] text-muted-foreground">
            {t.communityNoColors ?? 'No color data for this theme'}
          </p>
        )}
      </section>

      {/* Mock UI section */}
      <section>
        <h3 className="mb-2 text-[11px] font-medium tracking-tight text-muted-foreground">
          {t.communityTabMockUI ?? 'Mock Preview'}
        </h3>
        <MockUI colors={colorMap} />
      </section>
    </div>
  );
}
