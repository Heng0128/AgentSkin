// SPDX-License-Identifier: MPL-2.0

import type { EnvironmentModel } from '@/types/environment';
import type { UiMessages } from '@shared/i18n';
import type { ProgressMap } from '@/hooks/useBootProgress';
import { EnvironmentCard } from './EnvironmentCard';
import { BotIcon } from '@hugeicons/core-free-icons';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Button } from '@/components/ui/button';

/**
 * # EnvironmentGrid
 *
 * Displays all environments in a responsive grid.
 * Sentence-case titles (not uppercase tracking).
 * Product-first empty state.
 *
 * Each card supports:
 *   - Click to switch
 *   - Menu (…) for preset operations (rename/duplicate/delete)
 */
/**
 * Adaptive grid columns based on environment count:
 *   1 → 1 col, 2 → 2 cols, 3 → 3 cols (single row),
 *   4 → 2 cols (2×2), 5–6 → 3 cols, 7+ → 4 cols.
 * On smaller screens, always fall back to fewer columns.
 */
function gridColsClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (count === 3) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  if (count === 4) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 6) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
}

export function EnvironmentGrid({
  environments,
  activeId,
  onSwitch,
  onRename,
  onDuplicate,
  onDelete,
  title,
  t,
  onBrowseThemes,
  progress,
}: {
  environments: EnvironmentModel[];
  activeId: string | null;
  onSwitch?: (env: EnvironmentModel) => void;
  onRename?: (presetId: string) => void;
  onDuplicate?: (presetId: string) => void;
  onDelete?: (presetId: string) => void;
  title: string;
  t: UiMessages;
  onBrowseThemes?: () => void;
  progress?: ProgressMap;
}) {
  if (environments.length === 0) {
    return (
      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        <div className="rounded-xl border-2 border-dashed border-border/40 py-10 text-center dark:border-border/30">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-primary/5">
            <HugeIcon icon={BotIcon} className="size-5 text-primary/40" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">{t.emptyEnvironmentsHint}</p>
          {onBrowseThemes && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3 gap-1.5 text-xs"
              onClick={onBrowseThemes}
            >
              {t.browseThemes}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        <span className="inline-flex size-5 items-center justify-center rounded-md bg-secondary text-[10px] font-semibold text-muted-foreground">
          {environments.length}
        </span>
      </div>
      <div className={`grid gap-2.5 ${gridColsClass(environments.length)}`}>
        {environments.map((env) => (
          <EnvironmentCard
            key={env.id}
            env={env}
            isActive={env.id === activeId}
            onClick={onSwitch ? () => onSwitch(env) : undefined}
            onRename={onRename}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            t={t}
            progress={progress?.get(env.agent.id) ?? null}
          />
        ))}
      </div>
    </div>
  );
}
