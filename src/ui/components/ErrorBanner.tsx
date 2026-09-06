// SPDX-License-Identifier: MPL-2.0

/**
 * # ErrorBanner
 *
 * Shared destructive-semantics alert banner for transient operation errors
 * (push failures, import failures, scan failures...).
 *
 * Visual language (aligned across pages):
 *   - `destructive` tokens on a soft destructive-tinted panel
 *   - `px-4 py-2.5`, `rounded-lg`, one-line truncated headline,
 *     optional wrapped detail line underneath
 *   - optional retry action (caller supplies locale-correct label)
 *   - dismiss: text button when `dismissLabel` given, otherwise the shared
 *     icon-only CloseButton (accessible `aria-label="Close"` built in)
 */

import { Button } from '@/components/ui/button';
import { CloseButton } from '@/components/ui/close-button';
import { cn } from '@/lib/utils';

interface ErrorBannerProps {
  /** Short failure headline (e.g. localized "Push failed"). */
  message: string;
  /** Optional long-form reason / raw error string. */
  detail?: string;
  /** Optional retry callback; renders only with a `retryLabel`. */
  onRetry?: () => void;
  /** Locale-correct label for the retry action. */
  retryLabel?: string;
  /** Optional dismiss callback. */
  onDismiss?: () => void;
  /** Locale-correct dismiss label — switches the dismiss control to text. */
  dismissLabel?: string;
}

export function ErrorBanner({
  message,
  detail,
  onRetry,
  retryLabel,
  onDismiss,
  dismissLabel,
}: ErrorBannerProps) {
  return (
    <div
      role="alert"
      data-slot="error-banner"
      className="flex items-start justify-between gap-3 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-medium text-destructive">{message}</p>
        {detail && (
          <p className="mt-0.5 line-clamp-2 break-words text-[11px] leading-relaxed text-destructive/80">
            {detail}
          </p>
        )}
      </div>
      <div className={cn('flex shrink-0 items-center gap-1')}>
        {onRetry && retryLabel && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        )}
        {onDismiss &&
          (dismissLabel ? (
            <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
              {dismissLabel}
            </Button>
          ) : (
            <CloseButton
              className="-my-1 -mr-1 text-destructive/70 hover:text-destructive"
              onClick={onDismiss}
            />
          ))}
      </div>
    </div>
  );
}
