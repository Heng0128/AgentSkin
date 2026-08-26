// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeCard
 *
 * Single theme card component for the Theme Wall. Displays a preview
 * thumbnail, theme name, author, and a color palette strip. Supports
 * hover effects, click animation, and an active/selected state.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';

import { Check } from 'lucide-react';

export interface ThemeCardPreview {
  id: string;
  name: string;
  author: string;
  thumbUrl?: string;
  colors?: {
    accent?: string;
    background?: string;
    text?: string;
    panel?: string;
    secondary?: string;
  };
  tags?: string[];
}

interface ThemeCardProps {
  theme: ThemeCardPreview;
  selected: boolean;
  onSelect: (id: string) => void;
}

export function ThemeCard({ theme, selected, onSelect }: ThemeCardProps) {
  const [imgError, setImgError] = useState(false);
  const hasPreview = Boolean(theme.thumbUrl) && !imgError;

  const colorEntries = theme.colors
    ? [
        theme.colors.accent,
        theme.colors.background,
        theme.colors.text,
        theme.colors.panel,
        theme.colors.secondary,
      ].filter(Boolean)
    : [];

  return (
    <button
      type="button"
      onClick={() => onSelect(theme.id)}
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-lg border bg-card text-left shadow-sm transition-all duration-fast ease-out',
        selected
          ? 'border-primary ring-2 ring-primary/30'
          : 'border-border hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md',
      )}
    >
      {/* Preview — 16:9 aspect ratio */}
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted">
        {hasPreview ? (
          <img
            src={theme.thumbUrl}
            alt={theme.name}
            loading="lazy"
            decoding="async"
            className="size-full object-cover transition-transform duration-slower ease-out group-hover:scale-[1.03]"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/10 via-secondary/10 to-accent/10">
            <span className="text-[14px] font-semibold text-muted-foreground/50">
              {theme.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}

        {/* Selected indicator — top-right */}
        {selected && (
          <div className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
            <Check className="size-3" strokeWidth={3} />
          </div>
        )}

        {/* Color palette strip — bottom */}
        {colorEntries.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 flex h-1.5 gap-0">
            {colorEntries.map((color) => (
              <div
                key={color}
                className="flex-1 transition-all duration-200 hover:flex-[2]"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-2.5">
        <h3 className="truncate text-[13px] font-semibold leading-snug">{theme.name}</h3>
        <p className="truncate text-[11px] text-muted-foreground">by {theme.author}</p>

        {/* Tags — max 2 */}
        {theme.tags && theme.tags.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {theme.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
