// SPDX-License-Identifier: MPL-2.0

/**
 * # FileInfoCard
 *
 * Shared file information card extracted from StudioImageToThemePanel and
 * ExternalThemeImportPanel. Renders a file preview (image thumbnail or
 * icon), file name, and size in KB, with an optional clear button.
 */

import type { ReactNode } from 'react';

interface FileInfoCardProps {
  file: File;
  previewUrl?: string;
  icon?: ReactNode;
  onClear?: () => void;
}

export function FileInfoCard({ file, previewUrl, icon, onClear }: FileInfoCardProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
      {previewUrl && (
        <img src={previewUrl} alt={file.name} className="size-12 rounded-md object-cover" />
      )}
      {icon && !previewUrl && <div className="shrink-0">{icon}</div>}
      <div className="flex-1 truncate">
        <p className="truncate font-mono text-[11px] text-foreground">{file.name}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {(file.size / 1024).toFixed(1)} KB
        </p>
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-md border border-border bg-card2 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
          aria-label="Clear file"
        >
          Clear
        </button>
      )}
    </div>
  );
}
