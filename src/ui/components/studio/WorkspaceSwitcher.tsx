// SPDX-License-Identifier: MPL-2.0

/**
 * # WorkspaceSwitcher
 *
 * Floating workspace preset switcher — anchored to Top Bar right side.
 * Click outside to dismiss; ESC to close.
 *
 * 5 presets: Default · Compare · Multi-Agent · Focus · Export
 * Each saves viewMode + dock/inspector/drawer state.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WORKSPACE_PRESETS, type WorkspacePresetId } from '@/types/workspace';

interface WorkspaceSwitcherProps {
  open: boolean;
  onClose: () => void;
}

export function WorkspaceSwitcher({ open, onClose }: WorkspaceSwitcherProps) {
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
        className="absolute right-[var(--space-4)] top-[var(--h-topbar)] w-[300px] rounded-[var(--r-md)] overflow-hidden border border-[var(--border-default)] bg-[var(--bg-2)] shadow-[var(--shadow-dialog)]"
        role="dialog"
        aria-modal="true"
        aria-label="Workspace presets"
      >
        <div className="px-[var(--space-4)] h-12 flex items-center justify-between border-b border-[var(--border-subtle)]">
          <span className="font-mono text-[13px] font-semibold text-[var(--fg-0)]">Workspaces</span>
          <button
            type="button"
            className="ws-dialog__close"
            onClick={handleClose}
            aria-label="Close workspace switcher"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-[var(--space-2)]">
          {WORKSPACE_PRESETS.map((preset) => (
            <button
              key={preset.presetId}
              type="button"
              onClick={() => handlePick(preset.presetId)}
              className="w-full flex items-center gap-[var(--space-2)] p-[var(--space-2)] rounded-[var(--r-xs)] text-left hover:bg-[var(--bg-3)] transition-colors"
              style={{
                borderColor: activePresetId === preset.presetId ? 'var(--accent)' : 'transparent',
                background:
                  activePresetId === preset.presetId ? 'var(--accent-ghost)' : 'transparent',
                border: '1px solid',
              }}
            >
              <div className="size-8 rounded-[var(--r-xs)] border border-[var(--border-subtle)] bg-[var(--bg-1)] flex items-center justify-center font-mono text-[10px] text-[var(--fg-2)]">
                {preset.viewMode === 'single' && '×1'}
                {preset.viewMode === 'dual' && '×2'}
                {preset.viewMode === 'triple' && '×3'}
                {preset.viewMode === 'quad' && '×4'}
                {preset.viewMode === 'focus' && '⊞'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[length:11px] font-medium text-[var(--fg-0)]">
                  {preset.name}
                </div>
                <div className="font-mono text-[length:10px] text-[var(--fg-3)] mt-0">
                  {preset.viewMode}
                  {preset.dockOpen && ' · dock'}
                  {!preset.drawerCollapsed && ' · drawer'}
                  {!preset.inspectorCollapsed && ' · inspector'}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
