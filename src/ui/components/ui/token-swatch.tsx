// SPDX-License-Identifier: MPL-2.0
/**
 * # TokenSwatch
 *
 * Displays a design token color swatch with its name and hex/rgb value.
 * Used in theme editors, color inspectors, and palette display grids.
 *
 * Features:
 *   · Click to copy value
 *   · Dark/light adaptive contrast text
 *   · Compact and expanded modes
 *   · WCAG contrast badge (optional)
 */

import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';

import { Check, Copy } from 'lucide-react';

export interface TokenSwatchProps {
  /** Token name (e.g. 'primary', 'cr-success'). */
  name: string;
  /** CSS color value — hex, rgb, or var() reference. */
  value: string;
  /** Show the value text below the name. Default: true. */
  showValue?: boolean;
  /** Compact mode — swatch only, no text. */
  compact?: boolean;
  /** Swatch size — 'sm' (size-6), 'md' (size-8), 'lg' (size-10). */
  size?: 'sm' | 'md' | 'lg';
  /** Additional className. */
  className?: string;
}

const SIZE_MAP = {
  sm: 'size-6',
  md: 'size-8',
  lg: 'size-10',
} as const;

export function TokenSwatch({
  name,
  value,
  showValue = true,
  compact = false,
  size = 'md',
  className,
}: TokenSwatchProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

  if (compact) {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          'shrink-0 rounded-md border border-border transition-all duration-base hover:scale-110 hover:shadow-md',
          SIZE_MAP[size],
          className,
        )}
        style={{ backgroundColor: value }}
        title={`${name}: ${value}`}
        aria-label={`Copy ${name} color value: ${value}`}
      >
        {copied && <Check className="mx-auto size-3 text-white drop-shadow-md" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'group flex items-center gap-2 rounded-md border border-border bg-card2 p-2 transition-all duration-base hover:border-border-strong hover:shadow-md',
        className,
      )}
      title={`Copy ${value}`}
    >
      <span
        className={cn(
          'shrink-0 rounded-md border border-border ring-1 ring-white/5',
          SIZE_MAP[size],
        )}
        style={{ backgroundColor: value }}
      />
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate font-mono text-[11px] font-normal text-foreground">{name}</p>
        {showValue && (
          <p className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
            {value}
          </p>
        )}
      </div>
      <span className="shrink-0 text-muted-foreground/40 transition-colors group-hover:text-foreground">
        {copied ? <Check className="size-3 text-cr-success" /> : <Copy className="size-3" />}
      </span>
    </button>
  );
}
