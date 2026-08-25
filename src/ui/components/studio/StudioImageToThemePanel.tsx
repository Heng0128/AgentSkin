// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioImageToThemePanel
 *
 * Pywal-style image → theme extraction panel for the Studio workspace.
 *
 * Lifecycle:
 *   idle  → user picks / drops an image file
 *   file  → local state holds File + object URL preview
 *   extracting → store calls IPC `extractThemeFromImage`
 *   ready → 14-token palette rendered by group + tonal-scale accent picker
 *   error → user can retry or clear
 *
 * Visual style follows Quiet Workbench design tokens:
 *   · rounded-md corners, no radius inflation
 *   · spacing from the 4/8/16/24/32/48 Tailwind scale only
 *   · typography: text-[10px] mono for token names, tabular-nums
 *   · all colors via CSS custom properties (no bare hex/rgba)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNotificationStore } from '@/stores/notificationStore';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { UploadCloud } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { hexToHsl, hslToHex } from './harmony';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Accepted MIME types for the file picker + drag-and-drop. */
const ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/avif',
] as const;

/** Human-readable accept string for the <input type="file">. */
const ACCEPT_ATTR = 'image/png,image/jpeg,image/webp,image/bmp,image/avif';

/** Max file size (8 MB). */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** Tonal-scale lightness stops (5 steps), applied in HSL space. */
const TONAL_LIGHTNESSES = [22, 36, 50, 64, 78] as const;

/** 14-token palette → 7 display groups. */
const TOKEN_GROUPS: {
  labelKey:
    | 'studioImageToThemeGroupCore'
    | 'studioImageToThemeGroupSurface'
    | 'studioImageToThemeGroupText'
    | 'studioImageToThemeGroupCode'
    | 'studioImageToThemeGroupInput'
    | 'studioImageToThemeGroupButton'
    | 'studioImageToThemeGroupInteraction';
  tokens: string[];
}[] = [
  { labelKey: 'studioImageToThemeGroupCore', tokens: ['accent', 'secondary'] },
  {
    labelKey: 'studioImageToThemeGroupSurface',
    tokens: ['background', 'surface', 'surfaceElevated'],
  },
  { labelKey: 'studioImageToThemeGroupText', tokens: ['foreground', 'muted'] },
  { labelKey: 'studioImageToThemeGroupCode', tokens: ['codeBackground', 'codeForeground'] },
  { labelKey: 'studioImageToThemeGroupInput', tokens: ['inputBackground'] },
  { labelKey: 'studioImageToThemeGroupButton', tokens: ['buttonBackground', 'buttonForeground'] },
  { labelKey: 'studioImageToThemeGroupInteraction', tokens: ['focusRing', 'border'] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a 5-step tonal scale from a base hex color (HSL lightness sweep). */
function tonalScale(baseHex: string): string[] {
  const hsl = hexToHsl(baseHex);
  return TONAL_LIGHTNESSES.map((l) => hslToHex({ ...hsl, l }));
}

/** Convert a hex string to "rgb(r, g, b)" for detail display. */
function hexToRgbDisplay(hex: string): string {
  const hsl = hexToHsl(hex);
  const sn = hsl.s / 100;
  const ln = hsl.l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((hsl.h / 60) % 2) - 1));
  const mm = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hsl.h < 60) [r, g, b] = [c, x, 0];
  else if (hsl.h < 120) [r, g, b] = [x, c, 0];
  else if (hsl.h < 180) [r, g, b] = [0, c, x];
  else if (hsl.h < 240) [r, g, b] = [0, x, c];
  else if (hsl.h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return `rgb(${Math.round((r + mm) * 255)}, ${Math.round((g + mm) * 255)}, ${Math.round((b + mm) * 255)})`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StudioImageToThemePanel({ t }: { t: UiMessages }) {
  // --- Store subscription (shallow-merged) ---
  const {
    imageToThemeStatus,
    imageToThemeError,
    imageToThemePalette,
    imageToThemeAccent,
    extractImageFromImage,
    applyImageToTheme,
    clearImageToTheme,
    setImageAccent,
  } = useStudioStore(
    useShallow((s) => ({
      imageToThemeStatus: s.imageToThemeStatus,
      imageToThemeError: s.imageToThemeError,
      imageToThemePalette: s.imageToThemePalette,
      imageToThemeAccent: s.imageToThemeAccent,
      extractImageFromImage: s.extractImageFromImage,
      applyImageToTheme: s.applyImageToTheme,
      clearImageToTheme: s.clearImageToTheme,
      setImageAccent: s.setImageAccent,
    })),
  );

  // --- Local state: file, preview URL, expanded swatch ---
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [expandedToken, setExpandedToken] = useState<string | null>(null);

  // --- Drag-depth ref (prevents child dragenter/leave flicker) ---
  const dragDepth = useRef(0);
  const [dragOver, setDragOver] = useState(false);

  // --- File input ref ---
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Cleanup object URL on unmount / file change ---
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // --- Derived: accent source ---
  const activeAccent = imageToThemeAccent ?? imageToThemePalette?.accent ?? null;

  // --- Derived: tonal scale from active accent ---
  const tonals = useMemo(() => (activeAccent ? tonalScale(activeAccent) : []), [activeAccent]);

  // --- Handlers ---
  const handleFile = useCallback(
    (f: File) => {
      // Pre-validate MIME type
      if (!ACCEPTED_TYPES.includes(f.type as (typeof ACCEPTED_TYPES)[number])) {
        useNotificationStore
          .getState()
          .showToast(t.studioImageToThemeErrorInvalidFormat, 'destructive');
        return;
      }
      // Pre-validate size
      if (f.size > MAX_FILE_BYTES) {
        useNotificationStore
          .getState()
          .showToast(t.studioImageToThemeErrorInvalidFormat, 'destructive');
        return;
      }
      // Set local state
      setFile(f);
      setExpandedToken(null);
      const url = URL.createObjectURL(f);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    },
    [t.studioImageToThemeErrorInvalidFormat],
  );

  const _handlePickClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      // Reset input so the same file can be re-selected
      e.target.value = '';
    },
    [handleFile],
  );

  const handleExtract = useCallback(() => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      void extractImageFromImage(dataUrl);
    };
    reader.onerror = () => {
      useNotificationStore.getState().showToast(t.studioImageToThemeErrorReadFailed, 'destructive');
    };
    reader.readAsDataURL(file);
  }, [file, extractImageFromImage, t.studioImageToThemeErrorReadFailed]);

  const handleClear = useCallback(() => {
    clearImageToTheme();
    setFile(null);
    setExpandedToken(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [clearImageToTheme, previewUrl]);

  const handleApply = useCallback(() => {
    applyImageToTheme();
    handleClear();
  }, [applyImageToTheme, handleClear]);

  // --- Drag handlers (ThemesPage pattern: depth counter) ---
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

  // --- Swatch copy ---
  const handleCopy = useCallback(
    (value: string, label: string) => {
      void navigator.clipboard.writeText(value).catch(() => {});
      useNotificationStore.getState().showToast(t.studioImageToThemeCopyFormat(label), 'default');
    },
    [t.studioImageToThemeCopyFormat],
  );

  // ---------------------------------------------------------------------------
  // Render by status
  // ---------------------------------------------------------------------------

  // --- Error state ---
  if (imageToThemeStatus === 'error') {
    return (
      <div className="space-y-2">
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-[11px] text-foreground/60">{imageToThemeError}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleClear}
              className="rounded-md border border-border bg-card2 px-4 py-1 text-[10px] text-foreground/60"
            >
              {t.studioImageToThemeClear}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Ready state: palette display ---
  if (imageToThemeStatus === 'ready' && imageToThemePalette) {
    return (
      <div className="space-y-4">
        {/* Generated palette title */}
        <h3 className="text-[13px] font-normal text-foreground">
          {t.studioImageToThemeGeneratedPalette}
        </h3>

        {/* Palette groups */}
        {TOKEN_GROUPS.map((group) => (
          <div key={group.labelKey} className="space-y-1">
            <span className="text-[10px] text-muted-foreground/40">{t[group.labelKey]}</span>
            <div className="flex flex-wrap gap-1">
              {group.tokens.map((token) => {
                // ThemeColorsFromImage has no index signature; tokens are a
                // known-valid subset of keys, so a cast here is safe.
                const value = (imageToThemePalette as unknown as Record<string, string>)[token];
                if (!value) return null;
                const isExpanded = expandedToken === token;
                return (
                  <button
                    key={token}
                    type="button"
                    title={t.studioImageToThemeSwatchExpand}
                    onClick={() => setExpandedToken(isExpanded ? null : token)}
                    className="rounded-md border border-border p-1 text-left"
                  >
                    <div className="size-6 rounded-md" style={{ backgroundColor: value }} />
                    <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                      {token}
                    </span>
                    {isExpanded && (
                      <div className="mt-1 space-y-1">
                        <span className="block font-mono text-[10px] tabular-nums text-foreground/60">
                          {value}
                        </span>
                        <span className="block font-mono text-[10px] tabular-nums text-muted-foreground">
                          {hexToRgbDisplay(value)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(value, token);
                          }}
                          className="rounded-md border border-border bg-card2 px-2 py-0.5 text-[10px] text-foreground/60"
                        >
                          {t.studioImageToThemeCopyFormat(token)}
                        </button>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Tonal derivative */}
        {activeAccent && tonals.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] text-muted-foreground/40">
              {t.studioImageToThemeTonalDerivative}
            </span>
            <p className="text-[10px] text-muted-foreground">{t.studioImageToThemeTonalHint}</p>
            <div className="flex gap-1">
              {tonals.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  onClick={() => setImageAccent(tone)}
                  className="size-8 rounded-md border border-border"
                  style={{ backgroundColor: tone }}
                  title={tone}
                />
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleApply}
            className="rounded-md bg-[var(--primary)] px-4 py-1 text-[11px] text-[var(--primary-foreground)]"
          >
            {t.studioImageToThemeApplyToProject}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="rounded-md border border-border bg-card2 px-4 py-1 text-[10px] text-foreground/60"
          >
            {t.studioImageToThemeClear}
          </button>
        </div>
      </div>
    );
  }

  // --- Extracting state (with file preview) ---
  if (imageToThemeStatus === 'extracting' && file) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
          {previewUrl && (
            <img src={previewUrl} alt={file.name} className="size-12 rounded-md object-cover" />
          )}
          <div className="flex-1 truncate">
            <p className="truncate font-mono text-[11px] text-foreground">{file.name}</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled
          className="w-full rounded-md border border-border bg-card2 px-4 py-2 text-[11px] text-muted-foreground opacity-60"
        >
          {t.studioImageToThemeExtracting}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="w-full rounded-md border border-border bg-transparent px-4 py-1 text-[10px] text-muted-foreground"
        >
          {t.studioImageToThemeClear}
        </button>
      </div>
    );
  }

  // --- File-selected idle state (ready to extract) ---
  if (file && previewUrl) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
          <img src={previewUrl} alt={file.name} className="size-12 rounded-md object-cover" />
          <div className="flex-1 truncate">
            <p className="truncate font-mono text-[11px] text-foreground">{file.name}</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExtract}
          className="w-full rounded-md bg-[var(--primary)] px-4 py-2 text-[11px] text-[var(--primary-foreground)]"
        >
          {t.studioImageToThemeExtractButton}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="w-full rounded-md border border-border bg-transparent px-4 py-1 text-[10px] text-muted-foreground"
        >
          {t.studioImageToThemeClear}
        </button>
      </div>
    );
  }

  // --- Idle state: drag-and-drop upload zone ---
  return (
    <label
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative flex cursor-pointer flex-col items-center gap-2 space-y-2"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_ATTR}
        onChange={handleFileInputChange}
        className="hidden"
        aria-label={t.studioImageToThemeDragOrClick}
      />
      <span
        className="flex w-full flex-col items-center gap-2 rounded-md border-2 border-dashed border-border bg-surface p-8 text-center transition-colors hover:border-primary hover:bg-accent"
        data-drag-over={dragOver ? 'true' : undefined}
      >
        <UploadCloud className="size-8 text-muted-foreground" />
        <span className="text-[11px] text-foreground">{t.studioImageToThemeDragOrClick}</span>
        <span className="text-[10px] text-muted-foreground/40">
          {t.studioImageToThemeSupportedFormats}
        </span>
      </span>
      <p className="text-[10px] leading-relaxed text-muted-foreground/40">
        {t.studioImageToThemeHintText}
      </p>
    </label>
  );
}
