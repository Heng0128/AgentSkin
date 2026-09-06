// SPDX-License-Identifier: MPL-2.0

/**
 * # QuickApplyPanel
 *
 * Agent-native "image → theme" quick-apply UI.
 *
 * Lifecycle:
 *   idle     → user drops / pastes / picks an image file
 *   pending  → image path submitted, waiting for IPC result
 *   progress → pipeline phases streamed back via QUICK_APPLY_PROGRESS
 *   done     → result shown with undo button
 *   error    → error message with retry
 *
 * Visual style follows Quiet Workbench design tokens:
 *   · rounded-md corners, no radius inflation
 *   · spacing from the 4/8/16/24/32 Tailwind scale only
 *   · typography: text-[11px] mono for token names, tabular-nums
 *   · all colors via CSS custom properties (no bare hex/rgba)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNotificationStore } from '@/stores/notificationStore';

import { AGENT_META, type AgentId } from '@shared/types';
import type { QuickApplyProgress, QuickApplyResult } from '@shared/types/ipc';
import { RotateCcw, UploadCloud, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuickApplyPanelProps {
  /** Translation function (UiMessages subset). */
  t: {
    quickApplyTitle: string;
    quickApplyDropHint: string;
    quickApplySupportedFormats: string;
    quickApplyDecoding: string;
    quickApplyAnalyzing: string;
    quickApplyExtracting: string;
    quickApplyBuilding: string;
    quickApplyInstalling: string;
    quickApplyApplying: string;
    quickApplyDone: string;
    quickApplyError: string;
    quickApplyUndo: string;
    quickApplyRetry: string;
    quickApplySelectImage: string;
    quickApplySuccess: string;
    quickApplyClipboardError: string;
  };
  /** Currently selected agent (for apply target). */
  selectedAgent: AgentId;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/avif',
] as const;

const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/bmp,image/avif';

const MAX_FILE_BYTES = 16 * 1024 * 1024; // 16 MB

/** Phase → label key mapping. */
const PHASE_LABELS: Record<string, keyof QuickApplyPanelProps['t']> = {
  decoding: 'quickApplyDecoding',
  analyzing: 'quickApplyAnalyzing',
  extracting: 'quickApplyExtracting',
  building: 'quickApplyBuilding',
  installing: 'quickApplyInstalling',
  applying: 'quickApplyApplying',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert token key to CSS variable name for display. */
function tokenLabel(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').trim();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuickApplyPanel({ t, selectedAgent }: QuickApplyPanelProps) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<QuickApplyProgress | null>(null);
  const [result, setResult] = useState<QuickApplyResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const showToast = useNotificationStore((s) => s.showToast);

  // Subscribe to progress events from main process.
  useEffect(() => {
    // The progress events are pushed via the preload bridge.
    // We use window.agentskin.onQuickApplyStatus if available.
    const api = (
      window as unknown as {
        agentskin?: { onQuickApplyProgress?: (cb: (p: QuickApplyProgress) => void) => () => void };
      }
    ).agentskin;
    if (!api?.onQuickApplyProgress) return;
    const unsub = api.onQuickApplyProgress((p) => {
      setProgress(p);
    });
    return unsub;
  }, []);

  // Reset to idle when result is cleared.
  useEffect(() => {
    if (result === null && progress === null && status !== 'idle') {
      // Keep status as-is until user action.
    }
  }, [result, progress, status]);

  // --- File handling ---
  const submitFile = useCallback(
    (file: File) => {
      setStatus('pending');
      setResult(null);
      setProgress({ phase: 'decoding' });

      // Use Electron webUtils.getPathForFile for the absolute path.
      const webUtils = (
        window as unknown as { agentskin?: { getPathForFile?: (f: File) => string } }
      ).agentskin;
      const imagePath = webUtils?.getPathForFile?.(file);

      if (!imagePath) {
        setStatus('error');
        setResult({ success: false, error: 'Could not resolve file path' });
        return;
      }

      // Call the IPC handler.
      const api = (
        window as unknown as {
          agentskin?: {
            quickApplySubmit?: (req: {
              imagePath: string;
              targetAppId: AgentId;
            }) => Promise<QuickApplyResult>;
          };
        }
      ).agentskin;
      api
        ?.quickApplySubmit?.({ imagePath, targetAppId: selectedAgent })
        ?.then((res) => {
          setResult(res);
          setStatus(res.success ? 'done' : 'error');
          if (res.success) {
            showToast(t.quickApplySuccess, 'default');
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          setResult({ success: false, error: msg });
          setStatus('error');
        });
    },
    [selectedAgent, showToast, t.quickApplySuccess],
  );

  const handleFile = useCallback(
    (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
        showToast(t.quickApplyClipboardError, 'destructive');
        return;
      }
      if (file.size > MAX_FILE_BYTES) {
        showToast(t.quickApplyClipboardError, 'destructive');
        return;
      }
      submitFile(file);
    },
    [showToast, t.quickApplyClipboardError, submitFile],
  );

  // --- Paste handler ---
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file);
            return;
          }
        }
      }
    },
    [handleFile],
  );

  // --- Drag handlers ---
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  // --- Undo ---
  const handleUndo = useCallback(() => {
    const api = (
      window as unknown as {
        agentskin?: { quickApplyUndo?: (appId: AgentId) => Promise<{ success: boolean }> };
      }
    ).agentskin;
    api
      ?.quickApplyUndo?.(selectedAgent)
      ?.then((res) => {
        if (res.success) {
          setStatus('idle');
          setResult(null);
          setProgress(null);
        }
      })
      .catch(() => {});
  }, [selectedAgent]);

  // --- Clear ---
  const handleClear = useCallback(() => {
    setStatus('idle');
    setResult(null);
    setProgress(null);
  }, []);

  // --- File input ---
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      e.target.value = '';
    },
    [handleFile],
  );

  // ---------------------------------------------------------------------------
  // Render: error state
  // ---------------------------------------------------------------------------
  if (status === 'error' && result) {
    return (
      <div className="space-y-4 rounded-md border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <X className="size-4 text-destructive" />
          <span className="text-[13px] text-foreground">{t.quickApplyError}</span>
        </div>
        <p className="text-[11px] text-foreground/60">{result.error}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md border border-border bg-card2 px-4 py-1 text-[11px] text-foreground/60"
          >
            {t.quickApplyRetry}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: done state
  // ---------------------------------------------------------------------------
  if (status === 'done' && result?.success && result.tokens) {
    return (
      <div className="space-y-4 rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-foreground">{t.quickApplyDone}</span>
          <span className="text-[11px] text-muted-foreground">
            {AGENT_META[selectedAgent]?.displayName}
          </span>
        </div>

        {/* Token swatches */}
        <div className="flex flex-wrap gap-2">
          {Object.entries(result.tokens)
            .filter(([key, val]) => key !== 'mode' && typeof val === 'string')
            .slice(0, 7)
            .map(([key, value]) => (
              <div key={key} className="flex flex-col items-center gap-1">
                <div
                  className="size-8 rounded-md border border-border"
                  style={{ backgroundColor: value as string }}
                  title={`${tokenLabel(key)}: ${value}`}
                />
                <span className="font-mono text-[11px] text-muted-foreground">
                  {tokenLabel(key)}
                </span>
              </div>
            ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleUndo}
            className="flex items-center gap-1 rounded-md border border-border bg-card2 px-4 py-1 text-[11px] text-foreground/60"
          >
            <RotateCcw className="size-3" />
            {t.quickApplyUndo}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md border border-border bg-card2 px-4 py-1 text-[11px] text-foreground/60"
          >
            {t.quickApplySelectImage}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: pending / progress state
  // ---------------------------------------------------------------------------
  if (status === 'pending') {
    const phaseLabel = progress?.phase
      ? t[PHASE_LABELS[progress.phase] ?? 'quickApplyDecoding']
      : '';
    return (
      <div className="space-y-2 rounded-md border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="text-[11px] text-foreground/60">{phaseLabel}</span>
        </div>
        {progress?.message && (
          <p className="text-[11px] text-muted-foreground/40">{progress.message}</p>
        )}
        <button
          type="button"
          onClick={handleClear}
          className="rounded-md border border-border bg-transparent px-4 py-1 text-[11px] text-muted-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: idle state (drop zone)
  // ---------------------------------------------------------------------------
  return (
    <div onPaste={handlePaste} className="space-y-2">
      <label
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="relative flex cursor-pointer flex-col items-center gap-2"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTR}
          onChange={handleFileInputChange}
          className="hidden"
          aria-label={t.quickApplySelectImage}
        />
        <span
          className="flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed border-border bg-surface p-8 text-center transition-colors hover:border-primary hover:bg-accent"
          data-drag-over={dragOver ? 'true' : undefined}
        >
          <UploadCloud className="size-8 text-muted-foreground" />
          <span className="text-[11px] text-foreground">{t.quickApplyDropHint}</span>
          <span className="text-[11px] text-muted-foreground/40">
            {t.quickApplySupportedFormats}
          </span>
        </span>
      </label>
      <p className="text-[11px] leading-relaxed text-muted-foreground/40">
        {t.quickApplyTitle} · {AGENT_META[selectedAgent]?.displayName}
      </p>
    </div>
  );
}
