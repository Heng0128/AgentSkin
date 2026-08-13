// SPDX-License-Identifier: MPL-2.0

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
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import type { EnvironmentModel } from '@/types/environment';

import { Rocket01Icon } from '@hugeicons/core-free-icons';
import type { UiMessages } from '@shared/i18n';
import { AgentStatusDot, envToDotVariant } from './AgentStatusDot';

interface AgentDetailSheetProps {
  env: EnvironmentModel | null;
  installedThemeCount: number;
  t: UiMessages;
  onApply: (env: EnvironmentModel) => void;
  onOpenChange: (open: boolean) => void;
  /** When true, the apply button shows a spinner and is disabled to prevent duplicate clicks. */
  isApplying?: boolean;
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
 * 「操作面板」模式——聚焦主操作（应用环境），辅助信息最小化。
 * 详细的 Agent 版本/路径/端口配置已迁移至 Agents 页面。
 */
export function AgentDetailSheet({
  env,
  installedThemeCount,
  t,
  onApply,
  onOpenChange,
  isApplying = false,
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

            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              {/* 状态 + 当前主题 — 仅保留最关键信息 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AgentStatusDot variant={envToDotVariant(env)} size="sm" />
                  <span className="text-sm font-medium text-foreground">{statusLabel(env, t)}</span>
                </div>
                {env.theme && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {env.theme.name}
                  </span>
                )}
              </div>

              {/* 主题预览 — 视觉锚点 */}
              {env.theme?.preview && (
                <div className="overflow-hidden rounded-[2px] border border-border/60 bg-muted">
                  <img
                    src={env.theme.preview}
                    alt=""
                    decoding="async"
                    className="aspect-video w-full object-cover"
                    draggable={false}
                  />
                </div>
              )}

              {/* 次要信息 — 紧凑一行 */}
              <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                <span>
                  {env.detectedVersion ? t.versionLabel(env.detectedVersion) : t.detailNotInstalled}
                </span>
                <span>{t.detailInstalledThemes(installedThemeCount)}</span>
              </div>
            </div>

            <SheetFooter className="border-t border-border/60">
              <Button
                className={cn(
                  'w-full gap-1.5 rounded-[2px] bg-primary text-primary-foreground',
                  'hover:bg-primary/90',
                )}
                disabled={isApplying}
                onClick={() => {
                  if (isApplying) return;
                  onApply(env);
                  onOpenChange(false);
                }}
              >
                {isApplying ? <Spinner size={15} /> : <HugeIcon icon={Rocket01Icon} size={15} />}
                {isApplying ? t.applying : t.detailApply}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
