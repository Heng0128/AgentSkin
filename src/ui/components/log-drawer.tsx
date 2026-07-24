// SPDX-License-Identifier: MPL-2.0

import { File01Icon } from '@hugeicons/core-free-icons';
import type { AppController } from '@/hooks/useAppController';
import { HugeIcon } from '@/components/ui/huge-icon';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export function LogDrawer({ controller }: { controller: AppController }) {
  const { t, logs, logsOpen } = controller;
  return (
    <Sheet open={logsOpen} onOpenChange={controller.setLogsOpen}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t.runtimeLog}</SheetTitle>
          <SheetDescription>
            {logs.length > 0 ? `${logs.length} 条` : null}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <div className="flex size-10 items-center justify-center rounded-xl bg-muted/60">
                <HugeIcon icon={File01Icon} className="size-4 text-muted-foreground/50" />
              </div>
              <p className="text-xs text-muted-foreground">{t.noLogs}</p>
            </div>
          ) : (
            <div className="space-y-px font-mono text-[11px] leading-5">
              {logs.map((line, i) => (
                <div key={i} className="flex gap-2 rounded px-1.5 py-0.5 odd:bg-muted/30">
                  <span className="w-6 shrink-0 select-none text-right text-muted-foreground/40 tabular-nums">
                    {i + 1}
                  </span>
                  <span className="min-w-0 break-words whitespace-pre-wrap text-muted-foreground">
                    {line}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
