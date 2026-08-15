// SPDX-License-Identifier: MPL-2.0

/**
 * # ExportDialog
 *
 * Modal dialog for exporting the active Studio project as a packaged theme.
 * Replaces the inline dock-tab export pattern with a focused dialog flow.
 *
 * Fields:
 *   · name, author, license (optional)
 *   · target directory (Electron dialog)
 *   · toggles: [Tokens] [Assets] [Meta]
 *
 * Confirm triggers `studioStore.exportTheme()` which wraps the IPC call.
 */

import { useState } from 'react';
import { useNotificationStore } from '@/stores/notificationStore';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { WorkspaceDialog } from './WorkspaceDialog';

export function ExportDialog({
  open,
  onClose,
  t,
}: {
  open: boolean;
  onClose: () => void;
  t: UiMessages;
}) {
  const activeProject = useStudioStore((s) => s.getActiveProject());
  const { snapshot, exportName, exportAuthor, exportState } = useStudioStore();
  const setExportName = useStudioStore((s) => s.setExportName);
  const setExportAuthor = useStudioStore((s) => s.setExportAuthor);
  const exportTheme = useStudioStore((s) => s.exportTheme);
  const showToast = useNotificationStore((s) => s.showToast);

  const [license, setLicense] = useState('');
  const [targetDir, setTargetDir] = useState('');
  const [includeTokens, setIncludeTokens] = useState(true);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [includeMeta, setIncludeMeta] = useState(true);

  const handlePickDir = async () => {
    // Fallback: renderer-side directory selection via IPC if available,
    // otherwise user types the path manually. The core export path lives in
    // `exportTheme()` which calls `api.exportStudioTheme()` internally.
    try {
      const result = await (
        window as unknown as {
          __electronInvoke?: (
            channel: string,
          ) => Promise<{ canceled: boolean; filePaths?: string[] }>;
        }
      ).__electronInvoke?.('dialog:openDirectory');
      if (result?.canceled === false && result?.filePaths?.[0]) {
        setTargetDir(result.filePaths[0]);
      }
    } catch {
      showToast(t.studioToastDirPickerUnavailable, 'destructive');
    }
  };

  const handleConfirm = () => {
    if (!activeProject) return;
    if (!snapshot) {
      showToast(t.studioToastCaptureSnapshotFirst, 'destructive');
      onClose();
      return;
    }
    if (license.trim()) {
      // TODO: License support — requires store field + payload update.
      // For now the input collects the value but it is not written to the export payload.
    }
    if (targetDir) {
      // TODO: Target directory support — exportTheme() currently manages output path internally.
      // This field pre-validates user intent but is not yet passed to the export pipeline.
    }
    void exportTheme();
    onClose();
  };

  return (
    <WorkspaceDialog
      open={open}
      onClose={onClose}
      title={t.studioExportDialogTitle}
      description={t.studioExportDialogDesc}
      width={480}
    >
      <div className="flex flex-col gap-[var(--space-2)]">
        {/* Name */}
        <div className="ws-field">
          <label className="ws-field__label" htmlFor="export-name">
            {t.studioExportNameLabel}
          </label>
          <input
            id="export-name"
            className="ws-input"
            value={exportName}
            onChange={(e) => setExportName(e.target.value)}
            placeholder={activeProject?.name ?? t.studioExportNamePlaceholder}
          />
        </div>

        {/* Author */}
        <div className="ws-field">
          <label className="ws-field__label" htmlFor="export-author">
            {t.studioExportAuthorLabel}
          </label>
          <input
            id="export-author"
            className="ws-input"
            value={exportAuthor}
            onChange={(e) => setExportAuthor(e.target.value)}
            placeholder={t.studioExportAuthorPlaceholder}
          />
        </div>

        {/* License (optional) */}
        <div className="ws-field">
          <label className="ws-field__label" htmlFor="export-license">
            {t.studioExportLicenseLabel}{' '}
            <span style={{ color: 'var(--fg-3)' }}>{t.studioExportLicenseOptional}</span>
          </label>
          <input
            id="export-license"
            className="ws-input"
            value={license}
            onChange={(e) => setLicense(e.target.value)}
            placeholder={t.studioExportLicensePlaceholder}
          />
        </div>

        {/* Target directory */}
        <div className="ws-field">
          <label className="ws-field__label" htmlFor="export-dir">
            {t.studioExportDirLabel}
          </label>
          <div className="flex gap-[var(--space-2)]">
            <input
              id="export-dir"
              className="ws-input flex-1"
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
              placeholder={t.studioExportDirPlaceholder}
            />
            <button type="button" className="ws-btn ws-btn--sm shrink-0" onClick={handlePickDir}>
              {t.studioExportBrowse}
            </button>
          </div>
        </div>

        {/* Inclusion toggles */}
        <fieldset className="ws-field" style={{ marginBottom: 0, border: 'none', padding: 0 }}>
          <legend className="ws-field__label" style={{ float: 'left', marginBottom: '2px' }}>
            {t.studioExportIncludeLabel}
          </legend>
          <div className="flex gap-[var(--space-3)]" style={{ paddingTop: '2px' }}>
            <ToggleCheck
              label={t.studioExportIncludeTokens}
              checked={includeTokens}
              onChange={setIncludeTokens}
            />
            <ToggleCheck
              label={t.studioExportIncludeAssets}
              checked={includeAssets}
              onChange={setIncludeAssets}
            />
            <ToggleCheck
              label={t.studioExportIncludeMeta}
              checked={includeMeta}
              onChange={setIncludeMeta}
            />
          </div>
        </fieldset>

        {/* Export state feedback */}
        {exportState.error && (
          <p
            className="border border-destructive/30 bg-destructive/10 px-2 py-1 font-mono text-[10px] text-destructive"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {exportState.error}
          </p>
        )}
        {exportState.dir && (
          <p
            className="border border-green-700/30 bg-green-900/10 px-2 py-1 font-mono text-[10px] text-green-400 break-all"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {exportState.dir}
          </p>
        )}
      </div>

      <WorkspaceDialog.Footer>
        <button type="button" className="ws-btn ws-btn--sm" onClick={onClose}>
          {t.cancel}
        </button>
        <button
          type="button"
          className="ws-btn ws-btn--primary ws-btn--sm"
          disabled={!snapshot || exportState.loading}
          onClick={handleConfirm}
        >
          {exportState.loading ? t.studioExporting : t.studioExportButton}
        </button>
      </WorkspaceDialog.Footer>
    </WorkspaceDialog>
  );
}

/** Small checkbox row used in the export dialog inclusion toggles. */
function ToggleCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-[6px] cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
        aria-label={label}
      />
      <span
        aria-hidden="true"
        className="size-[14px] flex items-center justify-center border rounded-[2px] transition-colors"
        style={{
          borderColor: checked ? 'var(--accent)' : 'var(--border-subtle)',
          background: checked ? 'var(--accent)' : 'transparent',
        }}
      >
        {checked && (
          <svg width="9" height="9" viewBox="0 0 9 9" fill="none" aria-hidden="true">
            <path
              d="M1 4.5L3.5 7L8 2"
              stroke="var(--primary-foreground)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="font-mono text-[10px] font-medium" style={{ color: 'var(--fg-1)' }}>
        {label}
      </span>
    </label>
  );
}
