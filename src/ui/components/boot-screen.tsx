// SPDX-License-Identifier: MPL-2.0

import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';

/**
 * # BootScreen
 *
 * Branded opening sequence shown while the renderer bootstraps (the
 * `app:bootstrap` IPC round-trip). Rather than a static spinner it plays a
 * short, flowing piece of motion:
 *
 *   - three blurred aurora blobs (red / amber) drift behind the mark,
 *   - the logo pops in, then floats gently over a slow rotating red conic halo,
 *   - the "AgentSkin" wordmark is rendered in solid brand-primary red,
 *   - the hint and progress bar rise in on a stagger,
 *   - on `leaving` the whole overlay zooms-and-fades into the app.
 *
 * It is rendered as a `fixed inset-0` overlay (not a `<main>`) so App.tsx can
 * keep it mounted while the real UI settles underneath and cross-fade it out.
 */
export function BootScreen({ hint, leaving = false }: { hint: string; leaving?: boolean }) {
  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-9 overflow-hidden bg-background text-foreground',
        leaving && 'pointer-events-none animate-boot-exit',
      )}
      aria-hidden={leaving}
    >
      {/* Drifting aurora backdrop — three blurred brand-coloured blobs. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-32 -left-24 size-[28rem] animate-aurora-a rounded-full bg-[radial-gradient(circle_at_center,rgba(255,69,58,0.18),transparent_65%)] blur-3xl" />
        <div className="absolute top-1/4 -right-28 size-[30rem] animate-aurora-b rounded-full bg-[radial-gradient(circle_at_center,rgba(255,106,97,0.15),transparent_65%)] blur-3xl" />
        <div className="absolute -bottom-36 left-1/4 size-[26rem] animate-aurora-c rounded-full bg-[radial-gradient(circle_at_center,rgba(255,176,32,0.12),transparent_65%)] blur-3xl" />
      </div>

      {/* Brand mark + wordmark. */}
      <div className="relative flex flex-col items-center gap-5 animate-boot-rise">
        {/* Logo: pop-in, rotating conic halo, gentle float. */}
        <div className="relative animate-boot-pop">
          <div className="absolute -inset-6 animate-orbit rounded-full bg-[conic-gradient(from_0deg,rgba(255,69,58,0.4),rgba(255,69,58,0.1),rgba(255,69,58,0.4))] opacity-60 blur-2xl" />
          <div className="relative animate-float">
            <Logo
              variant="color"
              className="size-20 drop-shadow-[0_8px_28px_rgba(255,69,58,0.45)]"
            />
          </div>
        </div>

        {/* Wordmark with a flowing gradient shimmer + locale hint. */}
        <div className="text-center animate-boot-rise [animation-delay:150ms]">
          <h1 className="text-2xl font-semibold tracking-tight text-primary">AgentSkin</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{hint}</p>
        </div>
      </div>

      {/* Indeterminate progress bar with a soft glow. */}
      <div className="relative h-1 w-64 overflow-hidden rounded-full bg-muted animate-boot-rise [animation-delay:300ms]">
        <div className="h-full w-1/3 animate-progress rounded-full bg-gradient-to-r from-red-500 via-red-400 to-red-500 shadow-[0_0_12px_rgba(255,69,58,0.6)]" />
      </div>
    </div>
  );
}
