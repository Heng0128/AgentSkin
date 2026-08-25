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
          <h1 className="text-title font-medium tracking-[-0.015em]">{title}</h1>
          {count !== undefined && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-micro text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {children && <div className="flex items-center gap-2">{children}</div>}
      </div>
      {description && <p className="text-label text-muted-foreground">{description}</p>}
    </div>
  );
}

export type { PageHeaderProps };
export { PageHeader };
