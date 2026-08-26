// SPDX-License-Identifier: MPL-2.0
import { cn } from '@/lib/utils';

interface SectionLabelProps {
  label: string;
  count?: number;
  action?: React.ReactNode;
  className?: string;
}

function SectionLabel({ label, count, action, className }: SectionLabelProps) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <span className="text-[11px] font-medium tracking-tight text-muted-foreground">{label}</span>
      {(count !== undefined || action) && (
        <div className="flex items-center gap-1">
          {count !== undefined && (
            <span className="text-[11px] tabular-nums text-muted-foreground/60">{count}</span>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

export type { SectionLabelProps };
export { SectionLabel };
