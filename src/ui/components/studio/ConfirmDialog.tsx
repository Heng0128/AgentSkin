// SPDX-License-Identifier: MPL-2.0

/**
 * # ConfirmDialog
 *
 * Generic danger-confirmation dialog for irreversible operations:
 *   · Delete project
 *   · Delete bundle
 *   · Apply destructive overrides
 *
 * Layout: title → description → danger confirm button (red) + cancel.
 * Built on WorkspaceDialog shell. Width clamped to 440px for readability.
 */

import type { UiMessages } from '@shared/i18n';
import { WorkspaceDialog } from './WorkspaceDialog';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  t: UiMessages;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  loading = false,
  t,
}: ConfirmDialogProps) {
  return (
    <WorkspaceDialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      width={440}
    >
      {/* Body intentionally sparse — the description carries the explanation */}
      <div className="font-mono text-[11px] leading-relaxed" style={{ color: 'var(--fg-2)' }}>
        {description && <p className="mt-[var(--space-1)]">{description}</p>}
      </div>

      <WorkspaceDialog.Footer>
        <button type="button" className="ws-btn ws-btn--sm" onClick={onClose} disabled={loading}>
          {cancelLabel ?? t.cancel}
        </button>
        <button
          type="button"
          className="ws-btn ws-btn--sm"
          disabled={loading}
          onClick={onConfirm}
          style={{
            background: 'var(--accent)',
            color: '#fff',
            borderColor: 'var(--accent)',
            fontWeight: 600,
            letterSpacing: '0.06em',
          }}
        >
          {loading ? t.studioLoadingDots : (confirmLabel ?? t.studioBundleActionDelete)}
        </button>
      </WorkspaceDialog.Footer>
    </WorkspaceDialog>
  );
}
