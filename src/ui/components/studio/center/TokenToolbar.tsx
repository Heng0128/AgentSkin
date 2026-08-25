// SPDX-License-Identifier: MPL-2.0

/**
 * # TokenToolbar
 *
 * Coolors-inspired lock + shuffle workflow bar.
 * Users lock favourite tokens and shuffle the remaining unlocked ones
 * to generate new colour schemes.
 *
 * - Each token swatch carries a lock toggle (top-left).
 * - Spacebar triggers shuffle (skips when focus is in an input).
 * - Bottom action bar shows Shuffle button + locked count.
 */

import { useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';

import type { UiMessages } from '@shared/i18n';
import { Lock, Shuffle, Unlock } from 'lucide-react';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TokenToolbarProps {
  /** token 列表: [{ name, hex, locked }] */
  tokens: Array<{ name: string; hex: string; locked: boolean }>;
  /** 锁定状态变更回调 */
  onToggleLock: (name: string) => void;
  /** 打乱未锁定 token 回调 */
  onShuffle: () => void;
  /** 单个 token 颜色变更回调 */
  onColorChange: (name: string, hex: string) => void;
  t: UiMessages;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TokenToolbar({
  tokens,
  onToggleLock,
  onShuffle,
  onColorChange,
  t,
}: TokenToolbarProps) {
  const lockedCount = tokens.filter((tk) => tk.locked).length;
  const totalCount = tokens.length;

  // Spacebar → shuffle (ignore when typing in an input / textarea / select)
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (target?.isContentEditable) return;
      e.preventDefault();
      onShuffle();
    },
    [onShuffle],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="rounded-md border border-border bg-surface p-2">
      {/* ── Colour swatch row ─────────────────────────────────────────── */}
      <div className="flex gap-2">
        {tokens.map((tk) => (
          <div key={tk.name} className="group relative flex shrink-0 items-start">
            {/* Swatch (acts as colour picker trigger) */}
            <button
              type="button"
              className={`w-12 h-12 rounded-md transition-shadow ${
                tk.locked ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-transparent'
              }`}
              style={{ backgroundColor: tk.hex }}
              title={`${tk.name} — ${tk.hex}`}
              onClick={() => {
                // Click opens native colour picker via hidden input
                const input = document.createElement('input');
                input.type = 'color';
                input.value = tk.hex;
                input.addEventListener('input', (ev) => {
                  onColorChange(tk.name, (ev.target as HTMLInputElement).value);
                });
                input.click();
              }}
            />

            {/* Lock toggle — top-left */}
            <button
              type="button"
              onClick={() => onToggleLock(tk.name)}
              className="absolute top-1 left-1 flex size-4 items-center justify-center rounded-md bg-surface/70 text-foreground/60 opacity-0 transition-opacity group-hover:opacity-100"
              style={{ backdropFilter: 'blur(2px)' }}
              title={tk.locked ? t.tokenLocked : t.tokenUnlocked}
              aria-label={tk.locked ? t.tokenLocked : t.tokenUnlocked}
            >
              {tk.locked ? <Lock className="size-3" /> : <Unlock className="size-3" />}
            </button>
          </div>
        ))}
      </div>

      {/* ── Bottom action bar ────────────────────────────────────────── */}
      <div className="mt-2 flex items-center justify-between">
        <Button size="sm" variant="default" onClick={onShuffle}>
          <Shuffle className="size-3" />
          {t.shuffle}
        </Button>

        <span className="text-[10px] text-muted-foreground">
          {t.tokenLockedCount(lockedCount, totalCount)}
        </span>
      </div>
    </div>
  );
}
