// SPDX-License-Identifier: MPL-2.0

/**
 * # WorkspaceSwitcher
 *
 * Floating workspace preset switcher — anchored to Top Bar right side.
 * Click outside to dismiss; ESC to close.
 *
 * Expected to be simplified to a single-button Default reset in M2.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { WorkspacePresetId } from '@/stores/workspace-presets';
import { WORKSPACE_PRESETS } from '@/stores/workspace-presets';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';
import { X } from 'lucide-react';

interface WorkspaceSwitcherProps {
  open: boolean;
  onClose: () => void;
  t: UiMessages;
}

export function WorkspaceSwitcher({ open, onClose, t }: WorkspaceSwitcherProps) {
  const { activePresetId, applyPreset } = useWorkspaceStore();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Close on click outside dialog
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (!dialogRef.current) return;
      if (!dialogRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, onClose]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  const handlePick = (id: WorkspacePresetId) => {
    applyPreset(id);
    onClose();
  };

  return (
    <div className="ws-dialog-overlay" aria-hidden="true">
      <div
        ref={dialogRef}
        className="absolute right-[var(--space-4)] top-[var(--h-topbar)] w-[300px] rounded-[var(--dl-radius,2px)] overflow-hidden border border-[var(--border-default)] bg-[var(--bg-2)] shadow-float"
        role="dialog"
        aria-modal="true"
        aria-label={t.studioWorkspacePresets}
      >
        <div className="px-[var(--space-4)] h-12 flex items-center justify-between border-b border-[var(--border-subtle)]">
          <span className="text-[13px] font-normal text-[var(--fg-0)]">
            {t.studioWorkspacesLabel}
          </span>
          <button
            type="button"
            className="ws-dialog__close"
            onClick={handleClose}
            aria-label={t.studioCloseSwitcher}
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-[var(--space-2)]">
          {WORKSPACE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handlePick(preset.id as WorkspacePresetId)}
              className="w-full flex items-center gap-[var(--space-2)] p-[var(--space-2)] rounded-[var(--r-xs)] text-left hover:bg-[var(--bg-3)] transition-colors"
              style={{
                borderColor: activePresetId === preset.id ? 'var(--accent)' : 'transparent',
                background: activePresetId === preset.id ? 'var(--accent-ghost)' : 'transparent',
                border: '1px solid',
              }}
            >
              <div className="size-8 rounded-[var(--r-xs)] border border-[var(--border-subtle)] bg-[var(--bg-1)] flex items-center justify-center text-[10px] text-[var(--fg-2)]">
                {preset.viewMode === 'single' && '×1'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[length:11px] font-normal text-[var(--fg-0)]">
                  {preset.label}
                </div>
                <div className="text-[length:10px] text-[var(--fg-3)] mt-0">
                  {preset.viewMode}
                  {preset.dock?.open && ` · ${t.studioPresetDock}`}
                  {!preset.drawer?.collapsed && ` · ${t.studioPresetDrawer}`}
                  {!preset.inspector?.collapsed && ` · ${t.studioPresetInspector}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
