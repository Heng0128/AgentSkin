// SPDX-License-Identifier: MPL-2.0

/**
 * # ExternalThemeImportPanel
 *
 * Import external theme formats (Codedrobe / VS Code JSON / Raw CSS) and
 * convert them to AgentSkin 6-agent CSS via the theme-asset engine.
 *
 * Lifecycle:
 *   idle      → user picks an external theme file
 *   selected  → file ready, user triggers conversion
 *   converting → IPC call to main process convertThemeAsset
 *   done      → conversion result displayed (adapter, confidence, tokens)
 *   error     → user can retry with a different file
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotificationStore } from '@/stores/notificationStore';

import type { UiMessages } from '@shared/i18n';
import { FileUp } from 'lucide-react';
import { FileInfoCard } from './FileInfoCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdapterInfo {
  id: string;
  name: string;
  extensions: string[];
  description: string;
}

interface ConvertResult {
  ok: boolean;
  adapter?: string;
  confidence?: number;
  tokens?: Record<string, string>;
  agentCss?: Record<string, string>;
  error?: string;
  report?: {
    passed: boolean;
    tokenCoverage: number;
    warnings: string[];
  };
}

type ImportStatus = 'idle' | 'selected' | 'converting' | 'done' | 'error';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExternalThemeImportPanel({ t }: { t: UiMessages }) {
  // --- Adapter list (static from main) ---
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);

  // --- Local state ---
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<ImportStatus>('idle');
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // --- File input ref ---
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Convert (defined first so handleConvert can reference it) ---
  const performConvert = useCallback(
    async (data: ArrayBuffer | string | null) => {
      if (!data) {
        setStatus('error');
        setErrorMsg(t.studioExternalThemeFailed('Empty file'));
        return;
      }
      try {
        const bytes = new Uint8Array(data as ArrayBuffer);
        const convertResult = await window.agentSkin?.convertThemeAsset(
          { kind: 'bytes', data: bytes, filename: file?.name },
          { detectFormat: true },
        );

        if (!convertResult) {
          setStatus('error');
          setErrorMsg(t.studioExternalThemeFailed('No response'));
          return;
        }

        if (convertResult.ok) {
          setResult(convertResult);
          setStatus('done');
          useNotificationStore.getState().showToast(t.studioExternalThemeSuccess, 'default');
        } else {
          setStatus('error');
          setErrorMsg(t.studioExternalThemeFailed(convertResult.error ?? 'Unknown error'));
        }
      } catch (err) {
        setStatus('error');
        setErrorMsg(t.studioExternalThemeFailed((err as Error).message));
      }
    },
    [file, t.studioExternalThemeFailed, t.studioExternalThemeSuccess],
  );

  // --- Load adapters on mount ---
  const loadAdapters = useCallback(async () => {
    try {
      const list = await window.agentSkin?.listThemeAdapters();
      if (list) setAdapters(list);
    } catch {
      // Non-fatal: adapter list is display-only
    }
  }, []);

  useEffect(() => {
    void loadAdapters();
  }, [loadAdapters]);

  // --- File handling ---
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setStatus('selected');
      setResult(null);
      setErrorMsg(null);
    }
    e.target.value = '';
  }, []);

  const handlePickClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // --- Convert ---
  const handleConvert = useCallback(async () => {
    if (!file) return;
    setStatus('converting');
    setResult(null);
    setErrorMsg(null);

    try {
      const reader = new FileReader();
      reader.onload = () => {
        void performConvert(reader.result);
      };
      reader.onerror = () => {
        setStatus('error');
        setErrorMsg(t.studioExternalThemeFailed('File read error'));
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      setStatus('error');
      setErrorMsg(t.studioExternalThemeFailed((err as Error).message));
    }
  }, [file, t.studioExternalThemeFailed, performConvert]);

  // --- Clear ---
  const handleClear = useCallback(() => {
    setFile(null);
    setStatus('idle');
    setResult(null);
    setErrorMsg(null);
  }, []);

  // --- Accepted extensions ---
  const acceptAttr = adapters.flatMap((a) => a.extensions).join(',');

  // ---------------------------------------------------------------------------
  // Render: error state
  // ---------------------------------------------------------------------------
  if (status === 'error') {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[11px] text-foreground/60">{errorMsg}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="rounded-md border border-border bg-card2 px-4 py-1 text-[11px] text-foreground/60"
            >
              {t.studioExternalThemeSelectFile}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: converting state
  // ---------------------------------------------------------------------------
  if (status === 'converting' && file) {
    return (
      <div className="space-y-2">
        <FileInfoCard file={file} icon={<FileUp className="size-4 text-muted-foreground" />} />
        <button
          type="button"
          disabled
          className="w-full rounded-md border border-border bg-card2 px-4 py-2 text-[11px] text-muted-foreground opacity-60"
        >
          {t.studioExternalThemeConverting}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="w-full rounded-md border border-border bg-transparent px-4 py-1 text-[11px] text-muted-foreground"
        >
          {t.studioImageToThemeClear}
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: done state (conversion result)
  // ---------------------------------------------------------------------------
  if (status === 'done' && result) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <FileInfoCard file={file!} icon={<FileUp className="size-4 text-muted-foreground" />} />

          {/* Conversion metadata */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border bg-card p-2">
              <span className="text-[11px] text-muted-foreground/40">
                {t.studioExternalThemeAdapterLabel}
              </span>
              <p className="font-mono text-[11px] text-foreground">{result.adapter ?? '—'}</p>
            </div>
            <div className="rounded-md border border-border bg-card p-2">
              <span className="text-[11px] text-muted-foreground/40">
                {t.studioExternalThemeConfidenceLabel}
              </span>
              <p className="font-mono text-[11px] text-foreground">
                {result.confidence !== undefined ? `${(result.confidence * 100).toFixed(0)}%` : '—'}
              </p>
            </div>
          </div>

          {/* Token coverage */}
          {result.report && (
            <div className="rounded-md border border-border bg-card p-2">
              <span className="text-[11px] text-muted-foreground/40">
                {t.studioExternalThemeTokenCoverageLabel}
              </span>
              <p className="font-mono text-[11px] text-foreground">
                {(result.report.tokenCoverage * 100).toFixed(0)}%
              </p>
              {result.report.warnings.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t.studioExternalThemeWarnings(result.report.warnings.length)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md border border-border bg-card2 px-4 py-1 text-[11px] text-foreground/60"
          >
            {t.studioImageToThemeClear}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: file selected (ready to convert)
  // ---------------------------------------------------------------------------
  if (status === 'selected' && file) {
    return (
      <div className="space-y-2">
        <FileInfoCard file={file} icon={<FileUp className="size-4 text-muted-foreground" />} />
        <button
          type="button"
          onClick={handleConvert}
          className="w-full rounded-md bg-primary px-4 py-2 text-[11px] text-primary-foreground"
        >
          {t.studioExternalThemeConvert}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="w-full rounded-md border border-border bg-transparent px-4 py-1 text-[11px] text-muted-foreground"
        >
          {t.studioImageToThemeClear}
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: idle state (file picker + adapter list)
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-4">
      <label className="relative flex cursor-pointer flex-col items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept={acceptAttr}
          onChange={handleFileSelect}
          className="hidden"
          aria-label={t.studioExternalThemeSelectFile}
        />
        <span
          className="flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed border-border bg-surface p-8 text-center transition-colors hover:border-primary hover:bg-accent"
          onClick={handlePickClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handlePickClick();
          }}
          role="button"
          tabIndex={0}
        >
          <FileUp className="size-8 text-muted-foreground" />
          <span className="text-[11px] text-foreground">{t.studioExternalThemeSelectFile}</span>
        </span>
      </label>

      {/* Adapter list */}
      {adapters.length > 0 && (
        <div className="space-y-2">
          <span className="text-[11px] text-muted-foreground/40">
            {t.studioExternalThemeAdapters}
          </span>
          <div className="space-y-1">
            {adapters.map((adapter) => (
              <div key={adapter.id} className="rounded-md border border-border bg-card p-2">
                <p className="text-[11px] text-foreground">{adapter.name}</p>
                <p className="text-[11px] text-muted-foreground/40">{adapter.description}</p>
                <div className="mt-1 flex gap-1">
                  {adapter.extensions.map((ext) => (
                    <span
                      key={ext}
                      className="rounded-md border border-border bg-card2 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                    >
                      {ext}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
