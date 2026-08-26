// SPDX-License-Identifier: MPL-2.0

interface PageHeaderProps {
  title: string;
  description?: string;
  count?: number | string;
  children?: React.ReactNode;
}

function PageHeader({ title, description, count, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
          {count !== undefined && (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full border border-border bg-gradient-to-br from-muted/60 to-muted/30 px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground ring-1 ring-border/50">
              {count}
            </span>
          )}
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
      {description && (
        <p className="text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

export type { PageHeaderProps };
export { PageHeader };
