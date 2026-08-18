// SPDX-License-Identifier: MPL-2.0

import { Badge } from '@/components/ui/badge';

/** section label (kopf / section kicker) */
export function Kicker({
  children,
  count,
  dotColor = 'var(--primary)',
}: {
  children: React.ReactNode;
  count?: number;
  dotColor?: string;
}) {
  return (
    <div className="flex items-center gap-1 font-mono text-[10px] font-semibold ">
      <span className="size-[3px] rounded-[2px]" style={{ background: dotColor }} />
      <span style={{ letterSpacing: '0.14em', color: 'var(--muted-foreground)', opacity: 0.75 }}>
        {children}
      </span>
      {count !== undefined && count > 0 && (
        <Badge className="ml-1 h-[12px] rounded-[2px] border border-white/[0.08] bg-transparent px-1 font-mono text-[10px] font-medium text-white/30">
          {count}
        </Badge>
      )}
    </div>
  );
}
