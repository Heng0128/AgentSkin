import { cn } from '@/lib/utils';

import type { LucideProps } from 'lucide-react';
import { Loader2 } from 'lucide-react';

function Spinner({ className, ...props }: LucideProps) {
  return (
    <Loader2
      data-slot="spinner"
      role="status"
      aria-label="加载中"
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  );
}

export { Spinner };
