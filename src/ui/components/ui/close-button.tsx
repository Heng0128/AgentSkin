// SPDX-License-Identifier: MPL-2.0
'use client';

import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { X } from 'lucide-react';

/**
 * # CloseButton
 *
 * Shared ghost-style icon button for closing overlays (dialog, sheet).
 * - `muted-foreground` at rest, becomes `foreground` on hover
 * - dynamic radius (`rounded-sm`, derived from `--dl-radius`)
 * - standard focus ring, `duration-base` transition, built-in
 *   `aria-label="Close"`
 *
 * Positioning is owned by the caller via `className`
 * (e.g. `absolute top-4 right-4`); size follows the Button icon scale.
 */
export function CloseButton({
  className,
  size = 'icon-sm',
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="close-button"
      aria-label="Close"
      variant="ghost"
      size={size}
      className={cn('rounded-sm text-muted-foreground hover:text-foreground', className)}
      {...props}
    >
      {children ?? <X />}
    </Button>
  );
}
