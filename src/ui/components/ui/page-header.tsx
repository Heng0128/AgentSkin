// SPDX-License-Identifier: MPL-2.0

interface PageHeaderProps {
  title: string;
  description?: string;
  count?: number | string;
  children?: React.ReactNode;
}

function PageHeader({ title, description, count, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <h1 className="text-base font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
          {count !== undefined && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
      {description && <p className="text-[12px] text-muted-foreground">{description}</p>}
    </div>
  );
}

export type { PageHeaderProps };
export { PageHeader };
