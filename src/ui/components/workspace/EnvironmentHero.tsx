// SPDX-License-Identifier: MPL-2.0

import type { UiMessages } from '@shared/i18n';
import type { EnvironmentModel } from '@/types/environment';
import { AppMark } from '@/components/app-mark';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { BotIcon, Rocket01Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import { HugeIcon } from '@/components/ui/huge-icon';

/**
 * # EnvironmentHero
 *
 * Product-first hero with animated aurora mesh gradient background.
 *
 * Visual hierarchy:
 *   1. Animated aurora blobs (3 layers, different speeds)
 *   2. Decorative dot grid overlay
 *   3. Greeting + workspace label
 *   4. Active environment card (glassmorphism)
 *   5. "Continue" primary action
 *
 * Design principles:
 * - Dynamic, living background (aurora animation)
 * - Glassmorphism card for active environment
 * - One clear action: Continue
 * - Theme preview as background when available
 */
export function EnvironmentHero({
  activeEnv,
  t,
  onContinue,
}: {
  activeEnv: EnvironmentModel | null;
  t: UiMessages;
  onContinue?: () => void;
}) {
  const greeting = greetingForHour(new Date().getHours(), t);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60">
      {/* === Animated aurora mesh gradient background === */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-br from-primary/[0.08] via-card to-card dark:from-primary/[0.12] dark:via-card dark:to-card">
        {/* Aurora blob A — top-left, warm */}
        <div className="absolute -left-16 -top-16 size-52 rounded-full bg-primary/20 blur-3xl animate-aurora-a dark:bg-primary/25" />
        {/* Aurora blob B — center-right, cool */}
        <div className="absolute -right-10 top-1/4 size-44 rounded-full bg-violet-500/15 blur-3xl animate-aurora-b dark:bg-violet-400/20" />
        {/* Aurora blob C — bottom-center, accent */}
        <div className="absolute -bottom-12 left-1/3 size-40 rounded-full bg-sky-500/10 blur-3xl animate-aurora-c dark:bg-sky-400/15" />
      </div>

      {/* === Decorative dot grid === */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05]"
        style={{
          backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* === Theme preview background (if available) === */}
      {activeEnv?.theme?.preview && (
        <div aria-hidden className="absolute inset-0 opacity-[0.06] dark:opacity-[0.10]">
          <img
            src={activeEnv.theme.preview}
            alt=""
            className="size-full object-cover"
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/60 to-transparent" />
        </div>
      )}

      {/* === Content === */}
      <div className="relative p-5">
        {/* Greeting row */}
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight">{greeting}</h1>
          <HugeIcon icon={SparklesIcon} className="size-3.5 text-primary/60 animate-float" />
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{t.yourWorkspace}</p>

        {/* Active environment hero */}
        {activeEnv ? (
          <div className={cn(
            'mt-4 rounded-xl border backdrop-blur-sm transition-all duration-300',
            'border-white/20 bg-white/[0.06] shadow-lg shadow-primary/5',
            'dark:border-white/10 dark:bg-white/[0.04]',
            'group/hero',
          )}>
            <div className="flex items-center gap-3.5 p-3.5">
              {/* Agent icon — prominent with glow */}
              <div className={cn(
                'relative flex size-13 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 group-hover/hero:scale-105',
                'bg-gradient-to-br from-primary/25 to-primary/10 ring-1 ring-primary/20',
                'shadow-md shadow-primary/10',
              )}>
                <AppMark appId={activeEnv.agent.id} size={36} />
                {/* Glow ring */}
                <div className="absolute -inset-1 rounded-xl bg-primary/10 blur-md -z-10" />
              </div>

              {/* Environment info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-base font-bold tracking-tight">{activeEnv.name}</p>
                  <span className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  )}>
                    <span className="relative flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                    </span>
                    {t.activeBadge}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {activeEnv.agent.displayName}
                  {' · '}
                  {activeEnv.theme ? activeEnv.theme.name : t.statusNoTheme}
                </p>
              </div>

              {/* Continue action — inline */}
              {onContinue && (
                <Button
                  size="sm"
                  className={cn(
                    'gap-1.5 rounded-lg shadow-md transition-all duration-200',
                    'bg-primary text-white hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20',
                    'dark:bg-primary dark:text-white dark:hover:bg-primary/90',
                  )}
                  onClick={onContinue}
                >
                  <HugeIcon icon={Rocket01Icon} size={14} />
                  {t.continueWorking}
                </Button>
              )}
            </div>
          </div>
        ) : (
          /* Empty state — first launch */
          <div className="mt-5 rounded-xl border-2 border-dashed border-border/40 py-10 text-center backdrop-blur-sm dark:border-border/30">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10 animate-float">
              <HugeIcon icon={BotIcon} className="size-6 text-primary/60" />
            </div>
            <p className="text-sm font-medium">{t.createFirstWorkspace}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t.createFirstWorkspaceHint}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function greetingForHour(hour: number, t: UiMessages): string {
  if (hour < 12) return t.greetingMorning;
  if (hour < 18) return t.greetingAfternoon;
  return t.greetingEvening;
}
