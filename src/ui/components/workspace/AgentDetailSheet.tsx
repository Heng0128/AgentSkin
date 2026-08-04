// SPDX-License-Identifier: MPL-2.0

import type { ReactNode } from 'react';
import { AppMark } from '@/components/app-mark';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { EnvironmentModel } from '@/types/environment';

import { Rocket01Icon } from '@hugeicons/core-free-icons';
import type { UiMessages } from '@shared/i18n';
import { AgentStatusDot, envToDotVariant } from './AgentStatusDot';

interface AgentDetailSheetProps {
  /** The environment to show, or null when the sheet is closed. */
  env: EnvironmentModel | null;
  /** Number of installed themes that target this agent. */
  installedThemeCount: number;
  t: UiMessages;
  onApply: (env: EnvironmentModel) => void;
  onOpenChange: (open: boolean) => void;
}

function statusLabel(env: EnvironmentModel, t: UiMessages): string {
  if (env.status === 'active') return t.activeBadge;
  if (env.agentRunning) return t.agentStatusRunning;
  if (env.agentInstalled) return t.statusInstalled;
  return t.detailNotInstalled;
}

/**
 * # AgentDetailSheet
 *
 * Slide-in panel opened when an environment card is clicked. Surfaces the
 * agent's live details (status, version, install path, current theme, and
 * how many themes target it) without forcing an immediate switch — the user
 * opts in via the "Apply environment" action.
 */
export function AgentDetailSheet({
  env,
  installedThemeCount,
  t,
  onApply,
  onOpenChange,
}: AgentDetailSheetProps) {
  return (
    <Sheet open={env !== null} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        {env && (
          <>
            <SheetHeader className="border-b border-border/60">
              <div className="flex items-center gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-[2px] bg-card2 ring-1 ring-border-strong/50">
                  <AppMark appId={env.agent.id} size={36} />
                </div>
                <div className="min-w-0">
                  <SheetTitle className="truncate">{env.name}</SheetTitle>
                  <SheetDescription className="truncate">{env.agent.displayName}</SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              {/* Status */}
              <div className="flex items-center gap-2">
                <AgentStatusDot variant={envToDotVariant(env)} size="sm" />
                <span className="text-sm font-medium text-foreground">{statusLabel(env, t)}</span>
              </div>

              {/* Theme preview banner */}
              {env.theme?.preview && (
                <div className="overflow-hidden rounded-xl border border-border/60 bg-muted">
                  <img
                    src={env.theme.preview}
                    alt=""
                    decoding="async"
                    className="aspect-video w-full object-cover"
                    draggable={false}
                  />
                </div>
              )}

              {/* Current theme */}
              <DetailRow label={t.detailCurrentTheme}>
                {env.theme ? env.theme.name : t.statusNoTheme}
              </DetailRow>

              {/* Version */}
              <DetailRow label={t.detailVersion}>
                {env.detectedVersion ? t.versionLabel(env.detectedVersion) : t.detailNotInstalled}
              </DetailRow>

              {/* Install path */}
              <DetailRow label={t.detailPath}>
                {env.detectedPath ? (
                  <span
                    className="block max-w-full truncate font-mono text-xs text-muted-foreground"
                    title={env.detectedPath}
                  >
                    {env.detectedPath}
                  </span>
                ) : (
                  t.detailNotInstalled
                )}
              </DetailRow>

              {/* Installed themes targeting this agent */}
              <DetailRow label={t.supportedAppsLabel}>
                {t.detailInstalledThemes(installedThemeCount)}
              </DetailRow>
            </div>

            <SheetFooter className="border-t border-border/60">
              <Button
                className={cn(
                  'w-full gap-1.5 rounded-lg bg-primary text-white shadow-md',
                  'hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20',
                  'dark:bg-primary dark:text-white dark:hover:bg-primary/90',
                )}
                onClick={() => {
                  onApply(env);
                  onOpenChange(false);
                }}
              >
                <HugeIcon icon={Rocket01Icon} size={15} />
                {t.detailApply}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="swiss-kv">
      <span className="swiss-kv-key font-mono">{label}</span>
      <span className="swiss-kv-val font-mono">{children}</span>
    </div>
  );
}
