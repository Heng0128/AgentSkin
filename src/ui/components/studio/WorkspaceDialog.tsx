// SPDX-License-Identifier: MPL-2.0

/**
 * # WorkspaceDialog
 *
 * Generic dialog shell for Studio workspace modals — provides a Swiss-styled
 * title bar (title + description) and a normalized footer slot.
 *
 * Compound pattern:
 *   <WorkspaceDialog open={...} onClose={...} title="..." width={480}>
 *     <div>body content</div>
 *     <WorkspaceDialog.Footer>
 *       <button>Cancel</button>
 *       <button>Confirm</button>
 *     </WorkspaceDialog.Footer>
 *   </WorkspaceDialog>
 */

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

interface WorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  width?: number;
  children: React.ReactNode;
}

function WorkspaceDialog({
  open,
  onClose,
  title,
  description,
  width = 440,
  children,
}: WorkspaceDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent style={{ width, maxWidth: '90vw' }} className="gap-[var(--space-3)]">
        <div>
          <DialogTitle
            className="font-mono text-[length:12px] font-semibold uppercase"
            style={{ letterSpacing: '0.1em', color: 'var(--fg-0)' }}
          >
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription
              className="mt-[2px] font-mono text-[length:10px]"
              style={{ color: 'var(--fg-2)' }}
            >
              {description}
            </DialogDescription>
          )}
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Footer slot — fixed layout for action buttons. */
function WorkspaceDialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center justify-end gap-[var(--space-2)] pt-[var(--space-2)]"
      style={{ borderTop: '1px solid var(--border-subtle)' }}
    >
      {children}
    </div>
  );
}

WorkspaceDialog.Footer = WorkspaceDialogFooter;

export { WorkspaceDialog };
