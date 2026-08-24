// SPDX-License-Identifier: MPL-2.0

interface PageHeaderProps {
  title: string;
  description?: string;
  count?: number | string;
  children?: React.ReactNode;
}

function PageHeader({ title, description, count, children }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-[16px] font-normal tracking-[-0.015em]">{title}</h1>
          {count !== undefined && (
            <span className="rounded-sm bg-muted px-1 py-0 text-[10px] text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
      {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
    </div>
  );
}

export type { PageHeaderProps };
export { PageHeader };
