// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarRail
 *
 * Collapsed-only rail — a narrow (56px) column showing the brand logo on top
 * and the expand toggle at the bottom. Rendered when the sidebar is collapsed.
 *
 * Uses inline background style to GUARANTEE visibility regardless of theme
 * or Tailwind processing state.
 */

import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';

import { useSidebar } from './SidebarProvider';
import { SidebarToggle } from './SidebarToggle';

export function SidebarRail() {
  const { safeAreaInset } = useSidebar();

  return (
    <div
      className={cn(
        'relative flex h-full shrink-0 flex-col items-center border-r py-3',
        'backdrop-blur-md',
      )}
      style={{
        width: '56px',
        paddingTop: `${12 + safeAreaInset}px`,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        borderRightColor: 'rgba(255, 255, 255, 0.1)',
      }}
    >
      {/* Brand mark */}
      <div className="mb-4 shrink-0">
        <Logo variant="color" className="size-6 rounded-md" />
      </div>

      {/* Spacer — pushes toggle to bottom */}
      <div className="flex-1" />

      {/* Toggle */}
      <SidebarToggle />
    </div>
  );
}
