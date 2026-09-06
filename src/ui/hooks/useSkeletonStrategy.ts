// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useRef, useState } from 'react';

type SkeletonStatus = 'idle' | 'pending' | 'showing' | 'timeout';

interface SkeletonStrategyOptions {
  antiFlickerMs?: number;
  timeoutMs?: number;
}

interface SkeletonStrategyResult {
  showSkeleton: boolean;
  isSlowLoading: boolean;
}

function sanitizeMs(value: number | undefined, defaultValue: number): number {
  if (value === undefined || !Number.isFinite(value)) return defaultValue;
  return Math.max(0, value);
}

export function useSkeletonStrategy(
  loading: boolean,
  options: SkeletonStrategyOptions = {},
): SkeletonStrategyResult {
  const antiFlickerMs = sanitizeMs(options.antiFlickerMs, 120);
  const timeoutMs = sanitizeMs(options.timeoutMs, 800);

  const [status, setStatus] = useState<SkeletonStatus>('idle');

  const flickerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (flickerTimerRef.current !== null) {
      clearTimeout(flickerTimerRef.current);
      flickerTimerRef.current = null;
    }
    if (timeoutTimerRef.current !== null) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  // Single effect depends only on `loading` (+ stable options) so the cleanup does NOT clear timers when
  // `status` changes. Both the flicker timer and the timeout timer are chained here: the timeout is
  // armed inside the flicker callback, guaranteeing it fires within the same clock window.
  // biome-ignore lint/correctness/useExhaustiveDependencies: status intentionally omitted -- adding it would cause cleanup to clear the flicker timer when status transitions idle to pending
  useEffect(() => {
    if (loading) {
      if (status === 'idle') {
        setStatus('pending');
        clearTimers();
        flickerTimerRef.current = setTimeout(() => {
          flickerTimerRef.current = null;
          setStatus((prev) => (prev === 'pending' ? 'showing' : prev));
          // Arm the timeout timer exactly when the skeleton starts showing.
          timeoutTimerRef.current = setTimeout(() => {
            timeoutTimerRef.current = null;
            setStatus((prev) => (prev === 'showing' ? 'timeout' : prev));
          }, timeoutMs);
        }, antiFlickerMs);
      }
    } else {
      clearTimers();
      setStatus('idle');
    }

    return () => clearTimers();
  }, [loading, antiFlickerMs, timeoutMs, clearTimers]);

  return {
    showSkeleton: status === 'showing' || status === 'timeout',
    isSlowLoading: status === 'timeout',
  };
}
