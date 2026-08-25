// SPDX-License-Identifier: MPL-2.0

import { useState } from 'react';
import { cn } from '@/lib/utils';

import type { AgentId } from '@shared/types';
import { AGENT_META } from '@shared/types';
import codexIcon from '../assets/apps/codex.png';
import doubaoIcon from '../assets/apps/doubao.png';
import qoderworkIcon from '../assets/apps/qoderwork.png';
import traeworkIcon from '../assets/apps/traework.png';
import workbuddyIcon from '../assets/apps/workbuddy.png';
import zcodeIcon from '../assets/apps/zcode.png';

/** Icon registry — display names come from AGENT_META (single source of truth). */
export const APP_META: Record<AgentId, { name: string; icon: string }> = {
  workbuddy: { name: AGENT_META.workbuddy.displayName, icon: workbuddyIcon },
  qoderwork: { name: AGENT_META.qoderwork.displayName, icon: qoderworkIcon },
  traework: { name: AGENT_META.traework.displayName, icon: traeworkIcon },
  doubao: { name: AGENT_META.doubao.displayName, icon: doubaoIcon },
  codex: { name: AGENT_META.codex.displayName, icon: codexIcon },
  zcode: { name: AGENT_META.zcode.displayName, icon: zcodeIcon },
};

/** App icon mark (mirrors the website's AppMark; rounded-square app icon). */
export function AppMark({
  appId,
  size = 18,
  className,
}: {
  appId: AgentId;
  size?: number;
  className?: string;
}) {
  const meta = APP_META[appId];
  const [failed, setFailed] = useState(false);
  const label = meta?.name ?? appId;
  if (!meta || failed) {
    // Neutral monogram fallback for a missing/broken icon – not a brand mark.
    return (
      <span
        title={label}
        role="img"
        aria-label={label}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md bg-muted font-normal text-muted-foreground',
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.55)) }}
      >
        {label.charAt(0)}
      </span>
    );
  }
  return (
    <img
      src={meta.icon}
      width={size}
      height={size}
      alt={label}
      title={label}
      draggable={false}
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-md object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}
