// SPDX-License-Identifier: MPL-2.0
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';

import { uiMessages } from '@shared/i18n';
import type { LucideProps } from 'lucide-react';
import { Loader2 } from 'lucide-react';

interface SpinnerProps extends LucideProps {
  label?: string;
}

function Spinner({ className, label, ...props }: SpinnerProps) {
  const locale = useShellStore((s) => s.locale);
  return (
    <Loader2
      data-slot="spinner"
      role="status"
      aria-label={label ?? uiMessages[locale].loading}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
