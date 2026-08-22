// SPDX-License-Identifier: MPL-2.0
import * as React from 'react';

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function getTheme(): 'light' | 'dark' | 'system' {
  if (typeof document === 'undefined') return 'system';
  if (document.documentElement.classList.contains('dark')) return 'dark';
  if (document.documentElement.classList.contains('light')) return 'light';
  return 'system';
}

const Toaster = ({ ...props }: ToasterProps) => {
  const [theme, setTheme] = React.useState(getTheme());

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(getTheme());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  return (
    // sonner v2.0.8 的 <section> 硬编码了 aria-live="polite" + aria-label，但不会
    // 透传任意 role（role 传入会被丢弃），也不支持 error toast 单独用 role="alert"。
    // 在外层补一个 role="status" 容器，让通知区作为完整的状态 live region 暴露。
    <div role="status" aria-live="polite">
      <Sonner
        theme={theme as ToasterProps['theme']}
        className="toaster group"
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
            '--border-radius': 'var(--radius)',
          } as React.CSSProperties
        }
        {...props}
      />
    </div>
  );
};

export { Toaster };
