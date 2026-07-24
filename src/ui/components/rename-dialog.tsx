// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef } from 'react';

interface RenameDialogProps {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  maxLength?: number;
}

export function RenameDialog({
  open,
  value,
  onChange,
  onConfirm,
  onCancel,
  title,
  confirmLabel,
  cancelLabel,
  maxLength = 64,
}: RenameDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.select(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        className="w-80 rounded-xl border bg-card p-4 shadow-xl scale-in-95 animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold">{title}</h3>
        <input
          ref={inputRef}
          autoFocus
          className="mt-2 w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-primary/30"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim()) onConfirm();
            if (e.key === 'Escape') onCancel();
          }}
          maxLength={maxLength}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            disabled={!value.trim()}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
