// SPDX-License-Identifier: MPL-2.0

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { AppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';

import { CheckmarkCircle02Icon, Copy01Icon, File01Icon } from '@hugeicons/core-free-icons';

export function LogDrawer({ controller }: { controller: AppController }) {
  const { t, logs, logsOpen, showToast } = controller;
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (logs.length === 0) return;
    const text = logs.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast(t.copyLogsDone);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API (e.g. older
      // Electron, or clipboard permission denied). Use a hidden textarea
      // + document.execCommand('copy') as last resort.
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        showToast(t.copyLogsDone);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        showToast(t.copyLogsFailed, 'destructive');
      }
    }
  }, [logs, showToast, t]);

  return (
    <Sheet open={logsOpen} onOpenChange={controller.setLogsOpen}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle>{t.runtimeLog}</SheetTitle>
              <SheetDescription>{logs.length > 0 ? `${logs.length} 条` : null}</SheetDescription>
            </div>
            {logs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-7 shrink-0 gap-1.5 px-2 text-xs"
                title={t.copyLogs}
              >
                <HugeIcon
                  icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
                  className={cn('size-3.5', copied && 'text-cr-success')}
                />
                {copied ? t.copyLogsDone : t.copyLogs}
              </Button>
            )}
          </div>
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
                // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only display items — no reorder, insert, or delete, so index keys are safe.
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
