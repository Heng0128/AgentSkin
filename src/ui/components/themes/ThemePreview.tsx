// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemePreview
 *
 * Pure-frontend preview panel for a theme. Renders the 14-token palette
 * as color swatches and a simulated UI mock (sidebar + chat area) using
 * the theme's color tokens via CSS custom properties.
 *
 * Does NOT touch the injection engine — entirely presentational.
 */

import type { UiMessages } from '@shared/i18n';
import type { ThemeCenterCardModel } from '@/types/theme-center';
import { cn } from '@/lib/utils';

/** The 14 known token keys in display order. */
const TOKEN_ORDER: Array<{ key: string; label: string }> = [
  { key: 'background', label: 'Background' },
  { key: 'foreground', label: 'Foreground' },
  { key: 'surface', label: 'Surface' },
  { key: 'surfaceElevated', label: 'Surface Elevated' },
  { key: 'muted', label: 'Muted' },
  { key: 'border', label: 'Border' },
  { key: 'accent', label: 'Accent' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'buttonBackground', label: 'Button' },
  { key: 'buttonForeground', label: 'Button Text' },
  { key: 'inputBackground', label: 'Input' },
  { key: 'codeBackground', label: 'Code BG' },
  { key: 'codeForeground', label: 'Code Text' },
  { key: 'focusRing', label: 'Focus Ring' },
  { key: 'selection', label: 'Selection' },
];

function TokenSwatches({ colors }: { colors: Record<string, string> }) {
  const entries = TOKEN_ORDER.filter(({ key }) => Boolean(colors[key]));
  if (entries.length === 0) {
    return (
      <p className="py-4 text-center text-[12px] text-muted-foreground">No color tokens</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {entries.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-2">
          <span
            className="size-6 shrink-0 rounded-md border border-border"
            style={{ backgroundColor: colors[key] }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-medium leading-tight">{label}</p>
            <p className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
              {colors[key]}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Mock UI that consumes theme colors via CSS custom properties.
 * Scoped to the preview container so it does not leak.
 */
function MockUI({ colors }: { colors: Record<string, string> }) {
  const style: Record<string, string> = {
    '--preview-bg': colors.background || '#1e1e2e',
    '--preview-fg': colors.foreground || '#cdd6f4',
    '--preview-surface': colors.surface || '#181825',
    '--preview-surface-elevated': colors.surfaceElevated || '#313244',
    '--preview-muted': colors.muted || '#6c7086',
    '--preview-border': colors.border || '#45475a',
    '--preview-accent': colors.accent || '#89b4fa',
    '--preview-secondary': colors.secondary || '#a6adc8',
    '--preview-button-bg': colors.buttonBackground || colors.accent || '#89b4fa',
    '--preview-button-fg': colors.buttonForeground || '#1e1e2e',
    '--preview-input-bg': colors.inputBackground || '#313244',
    '--preview-focus': colors.focusRing || '#89b4fa',
  };

  return (
    <div
      className="overflow-hidden rounded-md border"
      style={style as React.CSSProperties}
    >
      {/* Mock app shell: sidebar + main */}
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
            {/* Incoming message */}
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

            {/* Outgoing message */}
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

            {/* Code block */}
            <div
              className="rounded-md border px-2.5 py-1.5 font-mono text-[10px]"
              style={{
                backgroundColor: colors.codeBackground || 'var(--preview-surface)',
                borderColor: 'var(--preview-border)',
                color: colors.codeForeground || 'var(--preview-fg)',
              }}
            >
              {'const x = () => { }'}
            </div>
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

export function ThemePreview({
  theme,
  t,
}: {
  theme: ThemeCenterCardModel;
  t: UiMessages;
}) {
  const colors = theme.colors ?? {};
  const hasColors = Object.keys(colors).length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Palette section */}
      <section>
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t.themePreviewPalette}
        </h3>
        {hasColors ? (
          <TokenSwatches colors={colors} />
        ) : (
          <p className="py-4 text-center text-[12px] text-muted-foreground">
            {t.themePreviewNoColors}
          </p>
        )}
      </section>

      {/* Mock UI section */}
      <section>
        <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t.themePreviewMockUI}
        </h3>
        <MockUI colors={colors} />
      </section>
    </div>
  );
}
