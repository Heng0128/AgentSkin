// SPDX-License-Identifier: MPL-2.0

/**
 * # ImageToThemePanel
 *
 * pywal-style image → palette extraction panel for the Theme Studio right rail.
 *
 * Workflow:
 *   1. User drops an image or picks one through the native file dialog.
 *   2. Client-side HTML5 Canvas thumbnail renders the preview (no upload yet).
 *   3. Raw base64 data URL is sent to the main process via
 *      `api.extractThemeFromImage()`, which runs median-cut + luminance-balance
 *      on the Electron side (see `src/main/theme/theme-from-image.ts`) and
 *      returns a 14-key `--agentskin-*` palette + mode.
 *   4. Rendered as Swiss-styled swatches. User hits "Apply to Project" →
 *      `onThemeGenerated(palette)` bubbles up to the Studio page.
 *
 * Inspired by:
 *   - HeiGe Codex Skin Studio: image upload → auto color extraction → theme
 *   - WorkBuddy Skin Studio: canvas pixel-level saturation-weighted hue bucketing
 *
 * Design: Swiss/International — rounded-[2px], #141418 base, #FF453A primary,
 * Space Grotesk display + IBM Plex Mono mono, 9–11px uppercase mono labels.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { contrastRatio, hexToHsl, hexToHsv, hexToRgb, textOn } from '@/utils/color-theory';

import {
  ChevronRightIcon,
  Image02Icon,
  PaintBucketIcon,
  RefreshIcon,
  UploadSquareIcon,
} from '@hugeicons/core-free-icons';
import type { UiMessages } from '@shared/i18n';
import { deriveTonalPalette, TONAL_STEPS } from '@shared/tonal-palette';
import type { ImagePaletteKey } from '@shared/types';
import { Kicker } from './kicker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ImageToThemePanelProps {
  /** Translation function — UiMessages from '@shared/i18n'. */
  t: UiMessages;
  /** Called when the user accepts the generated palette. */
  onThemeGenerated: (palette: Record<string, string>) => void;
  /** Tightens padding/spacing for dense right-rail embed (default: false). */
  compact?: boolean;
}

/** Shape returned by `api.extractThemeFromImage`. */
interface ExtractResult {
  palette: Record<string, string>;
  mode: 'dark' | 'light';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PALETTE_KEYS: ImagePaletteKey[] = [
  'accent',
  'secondary',
  'background',
  'foreground',
  'surface',
  'surfaceElevated',
  'muted',
  'border',
  'codeBackground',
  'codeForeground',
  'inputBackground',
  'buttonBackground',
  'buttonForeground',
  'focusRing',
];

/** Token groups with Swiss mono labels — inspired by Tokens Studio for Figma */
const PALETTE_GROUPS: Array<{
  id: string;
  labelKey: keyof UiMessages;
  keys: ImagePaletteKey[];
  defaultOpen: boolean;
}> = [
  {
    id: 'core',
    labelKey: 'studioImageToThemeGroupCore',
    keys: ['accent', 'secondary', 'background', 'foreground'],
    defaultOpen: true,
  },
  {
    id: 'surface',
    labelKey: 'studioImageToThemeGroupSurface',
    keys: ['surface', 'surfaceElevated', 'border'],
    defaultOpen: true,
  },
  { id: 'text', labelKey: 'studioImageToThemeGroupText', keys: ['muted'], defaultOpen: true },
  {
    id: 'code',
    labelKey: 'studioImageToThemeGroupCode',
    keys: ['codeBackground', 'codeForeground'],
    defaultOpen: false,
  },
  {
    id: 'input',
    labelKey: 'studioImageToThemeGroupInput',
    keys: ['inputBackground'],
    defaultOpen: false,
  },
  {
    id: 'button',
    labelKey: 'studioImageToThemeGroupButton',
    keys: ['buttonBackground', 'buttonForeground'],
    defaultOpen: false,
  },
  {
    id: 'interaction',
    labelKey: 'studioImageToThemeGroupInteraction',
    keys: ['focusRing'],
    defaultOpen: false,
  },
];

const PALETTE_LABELS: Record<ImagePaletteKey, string> = {
  accent: 'ACCENT',
  secondary: 'SECONDARY',
  background: 'BG',
  foreground: 'FG',
  surface: 'SURFACE',
  surfaceElevated: 'SURFACE+',
  muted: 'MUTED',
  border: 'BORDER',
  codeBackground: 'CODE BG',
  codeForeground: 'CODE FG',
  inputBackground: 'INPUT',
  buttonBackground: 'BTN BG',
  buttonForeground: 'BTN FG',
  focusRing: 'FOCUS',
};

/** Maximum thumbnail width — keeps the right rail compact. */
const THUMB_MAX_W = 236;
/** Maximum thumbnail height — leaves room for swatches + action row. */
const THUMB_MAX_H = 96;

/** Acceptable MIME types for image extraction. */
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/avif'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick black or white text for legibility over a hex background. */

// ---------------------------------------------------------------------------
// WCAG contrast helpers (P0-2)
// ---------------------------------------------------------------------------

export type WcagLevel = 'AAA' | 'AA' | 'AA Large' | 'Fail';

function wcagLevel(ratio: number): WcagLevel {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Fail';
}

const WCAG_BG: Record<WcagLevel, string> = {
  AAA: '#2ED573',
  AA: '#3B82F6',
  'AA Large': '#F59E0B',
  Fail: '#FF453A',
};

/** Given a token key and full palette, pick the reference background color
 *  that this token's contrast should be evaluated against. */
function referenceBg(key: ImagePaletteKey, palette: Record<string, string>): string {
  const textTokens = new Set(['foreground', 'muted', 'codeForeground', 'buttonForeground']);
  if (textTokens.has(key)) return palette.background || '#000000';
  return palette.foreground || '#ffffff';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SwatchRow({
  hex,
  label,
  contrastLevel,
  expanded,
  onToggle,
  expandTitle,
}: {
  hex: string;
  label: string;
  contrastLevel?: WcagLevel;
  expanded?: boolean;
  onToggle?: () => void;
  expandTitle?: string;
}) {
  const safe = hex || '#333333';
  const badgeBg = contrastLevel ? WCAG_BG[contrastLevel] : undefined;
  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer items-center gap-2 border-0 py-[3px] text-left transition-colors ${expanded ? 'bg-white/[0.04]' : 'bg-transparent hover:bg-white/[0.02]'}`}
      onClick={onToggle}
      title={expandTitle}
    >
      <div
        className="size-[22px] shrink-0 rounded-[2px] border border-white/[0.06]"
        style={{ background: safe }}
      />
      <div className="min-w-0 flex-1">
        <span
          className="block truncate font-mono text-[10px] font-medium uppercase"
          style={{ letterSpacing: '0.06em', color: 'var(--foreground)' }}
        >
          {safe}
        </span>
        <span
          className="block truncate font-mono text-[9.5px]"
          style={{ color: 'var(--muted-foreground)', opacity: 0.65 }}
        >
          {label}
        </span>
      </div>
      {contrastLevel && badgeBg && (
        <span
          className="shrink-0 rounded-[2px] px-1 py-[1px] font-mono text-[9.5px] font-bold uppercase"
          style={{
            letterSpacing: '0.05em',
            color: '#000',
            background: badgeBg,
            opacity: contrastLevel === 'Fail' ? 1 : 0.9,
          }}
          title={`WCAG ${contrastLevel}`}
        >
          {contrastLevel}
        </span>
      )}
      <span className="font-mono text-[9.5px]" style={{ color: textOn(safe), opacity: 0.5 }}>
        {expanded ? '▴' : '●'}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Color format converters (P0-3)
// ---------------------------------------------------------------------------

function SwatchDetailPanel({
  hex,
  copyTitle,
}: {
  hex: string;
  copyTitle?: (label: string) => string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(null), 1200);
    return () => clearTimeout(id);
  }, [copied]);
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const [hslH, hslS, hslL] = hexToHsl(hex);
  const [hsvH, hsvS, hsvV] = hexToHsv(hex);
  const formats = [
    { label: 'HEX', value: hex.toUpperCase() },
    { label: 'RGB', value: `${r}, ${g}, ${b}` },
    {
      label: 'HSL',
      value: `${Math.round(hslH)}°, ${Math.round(hslS * 100)}%, ${Math.round(hslL * 100)}%`,
    },
    {
      label: 'HSV',
      value: `${Math.round(hsvH)}°, ${Math.round(hsvS * 100)}%, ${Math.round(hsvV * 100)}%`,
    },
  ];
  const handleCopy = (val: string, label: string) => {
    navigator.clipboard.writeText(val).then(
      () => {
        setCopied(label);
      },
      () => {},
    );
  };
  return (
    <div className="mt-1 border border-white/[0.06] bg-black/20 p-1.5">
      <div className="grid grid-cols-2 gap-1">
        {formats.map((f) => (
          <button
            key={f.label}
            type="button"
            onClick={() => handleCopy(f.value, f.label)}
            className="flex items-center justify-between gap-1 border border-white/[0.06] bg-white/[0.02] px-1.5 py-1 transition-colors hover:bg-white/[0.06]"
            style={{ borderRadius: '2px' }}
            title={copyTitle?.(f.label)}
          >
            <span
              className="font-mono text-[9.5px] font-bold uppercase"
              style={{ letterSpacing: '0.06em', color: 'var(--muted-foreground)' }}
            >
              {f.label}
            </span>
            <span
              className="truncate font-mono text-[9.5px]"
              style={{ color: 'var(--foreground)' }}
            >
              {copied === f.label ? '✓' : f.value}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PaletteStripe({ palette }: { palette: Record<string, string> }) {
  const ordered = PALETTE_KEYS.map((k) => palette[k]).filter((v) => v && v !== 'transparent');
  return (
    <div className="flex gap-[2px]">
      {ordered.map((hex) => (
        <div
          key={hex}
          className="h-4 flex-1 rounded-[1px] transition-all hover:flex-[2.5]"
          style={{ background: hex }}
          title={hex}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ImageToThemePanel({
  t,
  onThemeGenerated,
  compact = false,
}: ImageToThemePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [palette, setPalette] = useState<Record<string, string> | null>(null);
  const [mode, setMode] = useState<'dark' | 'light' | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [rawBase64, setRawBase64] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<ImagePaletteKey | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(PALETTE_GROUPS.filter((g) => g.defaultOpen === false).map((g) => g.id)),
  );

  const [tonalOpen, setTonalOpen] = useState(false);
  const [tonal, setTonal] = useState<ReturnType<typeof deriveTonalPalette> | null>(null);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  // --- Draw the uploaded image into the Swiss thumbnail canvas ---
  useEffect(() => {
    if (!imagePreview || !canvasRef.current) return;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current!;
      // Aspect-ratio-constrained thumbnail within THUMB_MAX_W × THUMB_MAX_H.
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const ratio = Math.min(THUMB_MAX_W / w, THUMB_MAX_H / h, 1);
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingQuality = 'medium';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }
    };
    img.src = imagePreview;
  }, [imagePreview]);

  // --- Core pipeline: file → base64 → IPC extract ---
  // biome-ignore lint(correctness/useExhaustiveDependencies): t is a stable i18n table reference
  const processFile = useCallback((file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(t.studioImageToThemeErrorInvalidFormat);
      return;
    }
    setError(null);
    setPalette(null);
    setMode(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImagePreview(dataUrl);
      // Strip the data-URI prefix so we pass pure base64 to the main process.
      const base64 = dataUrl.split(',')[1] ?? '';
      setRawBase64(base64);
    };
    reader.onerror = () => setError(t.studioImageToThemeErrorReadFailed);
    reader.readAsDataURL(file);
  }, []);

  // --- Drag & drop handlers ---
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  // --- File picker ---
  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      // Reset so the same file can be re-selected.
      e.target.value = '';
    },
    [processFile],
  );

  // --- Trigger main-process extraction ---
  // biome-ignore lint(correctness/useExhaustiveDependencies): t is a stable i18n table reference
  const handleExtract = useCallback(async () => {
    if (!rawBase64) return;
    setExtracting(true);
    setError(null);
    try {
      // IPC call to the main process. The palette keys returned use the
      // `--agentskin-*` contract (see src/main/theme/theme-from-image.ts).
      const result = (await api.extractThemeFromImage(rawBase64)) as unknown as ExtractResult;
      setPalette(result.palette);
      setMode(result.mode);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.studioImageToThemeErrorExtractFailed);
    } finally {
      setExtracting(false);
    }
  }, [rawBase64]);

  // --- Apply to project ---
  const handleApply = useCallback(() => {
    if (!palette) return;
    // Normalize `--agentskin-accent` → `accent` keys for the onThemeGenerated callback.
    const normalized: Record<string, string> = {};
    for (const key of PALETTE_KEYS) {
      const cssVar = `--agentskin-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
      normalized[key] = palette[key] ?? palette[cssVar] ?? '';
    }
    onThemeGenerated(normalized);
  }, [palette, onThemeGenerated]);

  // --- Reset everything ---
  const handleReset = useCallback(() => {
    setImagePreview(null);
    setFileName(null);
    setPalette(null);
    setMode(null);
    setError(null);
    setRawBase64(null);
  }, []);

  // --- 把某个色阶 tone 作为新强调色载入到编辑器 ---
  const applyTone = useCallback(
    (tone: string) => {
      if (!palette) return;
      const normalized: Record<string, string> = {};
      for (const key of PALETTE_KEYS) {
        const cssVar = `--agentskin-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
        normalized[key] = palette[key] ?? palette[cssVar] ?? '';
      }
      normalized.accent = tone;
      onThemeGenerated(normalized);
    },
    [palette, onThemeGenerated],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const hasImage = !!imagePreview;
  const hasResult = !!palette && Object.keys(palette).length > 0;
  const needExtract = hasImage && !hasResult && !extracting;

  return (
    <div
      className={`flex flex-col gap-3 ${compact ? 'p-3' : 'p-4'}`}
      style={{ background: 'var(--card)' }}
    >
      {/* ===== Panel header ===== */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HugeIcon icon={PaintBucketIcon} className="size-3" style={{ color: 'var(--primary)' }} />
          <span
            className="font-mono text-[10px] font-semibold uppercase"
            style={{ letterSpacing: '0.12em', color: 'var(--foreground)' }}
          >
            {t.studioImageToThemePanelTitle}
          </span>
          {mode && (
            <Badge className="h-[14px] rounded-[2px] border border-white/[0.08] bg-transparent px-1 font-mono text-[9.5px] font-medium text-white/40">
              {mode === 'dark' ? t.studioImageToThemeModeDark : t.studioImageToThemeModeLight}
            </Badge>
          )}
        </div>
        {hasImage && (
          <button
            type="button"
            onClick={handleReset}
            className="font-mono text-[10px] uppercase tracking-wider transition-colors hover:text-white/70"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {t.studioImageToThemeClear}
          </button>
        )}
      </div>

      {/* ===== Upload zone ===== */}
      {!hasImage ? (
        <button
          type="button"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handlePickFile}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 border border-dashed transition-colors ${
            dragging
              ? 'border-[var(--primary)] bg-[var(--primary)]/5'
              : 'border-[var(--border)] bg-[var(--muted)]/40 hover:border-white/[0.15]'
          }`}
          style={{
            borderRadius: '2px',
            height: compact ? 96 : 120,
          }}
        >
          <HugeIcon
            icon={dragging ? Image02Icon : UploadSquareIcon}
            className="size-5"
            style={{ color: dragging ? 'var(--primary)' : 'var(--muted-foreground)' }}
          />
          <span
            className="font-mono text-[9.5px] font-medium uppercase"
            style={{
              letterSpacing: '0.08em',
              color: dragging ? 'var(--primary)' : 'var(--foreground)',
              opacity: 0.85,
            }}
          >
            {dragging ? t.studioImageToThemeDropToUpload : t.studioImageToThemeDragOrClick}
          </span>
          <span
            className="font-mono text-[9.5px]"
            style={{ color: 'var(--muted-foreground)', opacity: 0.55 }}
          >
            {t.studioImageToThemeSupportedFormats}
          </span>
        </button>
      ) : (
        /* ===== Image preview (canvas thumbnail) ===== */
        <div className="flex flex-col items-center gap-2">
          <div
            className="overflow-hidden rounded-[2px] border border-white/[0.06]"
            style={{ background: 'var(--muted)' }}
          >
            <canvas
              ref={canvasRef}
              className="block"
              style={{ maxWidth: THUMB_MAX_W, maxHeight: THUMB_MAX_H }}
            />
          </div>
          {fileName && (
            <span
              className="block max-w-full truncate font-mono text-[9.5px]"
              style={{ color: 'var(--muted-foreground)', opacity: 0.6 }}
              title={fileName}
            >
              {fileName}
            </span>
          )}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        onChange={handleFileChange}
        className="hidden"
      />

      {/* ===== Error display ===== */}
      {error && (
        <div
          className="border border-[#FF453A]/30 bg-[#FF453A]/8 p-2 font-mono text-[10px]"
          style={{
            borderRadius: '2px',
            color: '#FF453A',
          }}
        >
          {error}
        </div>
      )}

      {/* ===== Extract button ===== */}
      {needExtract &&
        (extracting ? (
          <Button
            disabled
            className="h-8 w-full gap-2 rounded-[2px] border border-white/[0.06] bg-white/[0.03] font-mono text-[9.5px] font-semibold uppercase tracking-wider text-white/40"
          >
            <Spinner className="size-3" />
            {t.studioImageToThemeExtracting}
          </Button>
        ) : (
          <Button
            onClick={handleExtract}
            className="h-8 w-full gap-2 rounded-[2px] border border-[var(--primary)]/40 font-mono text-[9.5px] font-semibold uppercase transition-colors hover:bg-white/[0.04]"
            style={{
              letterSpacing: '0.1em',
              background: 'var(--primary)/10',
              color: 'var(--primary)',
            }}
          >
            <HugeIcon icon={RefreshIcon} className="size-3" />
            {t.studioImageToThemeExtractButton}
          </Button>
        ))}

      {/* ===== Extracting spinner ===== */}
      {extracting && !needExtract && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Spinner className="size-3" />
          <span
            className="font-mono text-[10px] uppercase"
            style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
          >
            {t.studioImageToThemeExtracting}
          </span>
        </div>
      )}

      {/* ===== Generated palette ===== */}
      {hasResult && (
        <>
          <Kicker count={PALETTE_KEYS.length}>{t.studioImageToThemeGeneratedPalette}</Kicker>

          {/* Wide color stripe */}
          <PaletteStripe palette={palette as Record<string, string>} />

          {/* 衍生色阶 (Material You) —— 由强调色派生 11 阶 tonal */}
          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => {
                const tp = deriveTonalPalette(palette.accent);
                setTonal(tp);
                setTonalOpen((v) => !v);
              }}
              className="flex h-7 w-full items-center gap-2 rounded-[2px] border border-white/[0.08] px-2 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors hover:bg-white/[0.04]"
              style={{ color: 'var(--foreground)', letterSpacing: '0.1em' }}
            >
              <span className="size-2 rounded-[1px]" style={{ background: palette.accent }} />
              {t.studioImageToThemeTonalDerivative} {tonalOpen ? '▴' : '▾'}
            </button>
            {tonalOpen && tonal && (
              <div className="space-y-0.5 border border-white/[0.06] bg-black/20 p-1.5">
                <p
                  className="font-mono text-[9.5px] uppercase"
                  style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)', opacity: 0.6 }}
                >
                  {t.studioImageToThemeTonalHint}
                </p>
                {TONAL_STEPS.map((step) => {
                  const hex = tonal[step];
                  return (
                    <button
                      key={step}
                      type="button"
                      onClick={() => applyTone(hex)}
                      className="flex w-full items-center gap-2 rounded-[1px] px-1 py-[3px] text-left transition-colors hover:bg-white/[0.04]"
                      title={`tone ${step} · ${hex}`}
                    >
                      <span
                        className="size-4 shrink-0 rounded-[1px] border border-white/[0.06]"
                        style={{ background: hex }}
                      />
                      <span
                        className="font-mono text-[10px]"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {step}
                      </span>
                      <span
                        className="ml-auto font-mono text-[9.5px]"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {hex.toUpperCase()}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Individual swatches — grouped by semantic role (Tokens Studio style) */}
          <ScrollArea className="max-h-[280px] pr-1">
            <div className="-mx-1 space-y-0.5 px-1">
              {PALETTE_GROUPS.map((group) => {
                const groupPalette = palette as Record<string, string>;
                const isCollapsed = collapsedGroups.has(group.id);
                return (
                  <div key={group.id}>
                    {/* Group header — collapsible */}
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      className="flex h-5 w-full items-center gap-1.5 rounded-[2px] px-1 text-left transition-colors hover:bg-white/[0.04]"
                    >
                      <HugeIcon
                        icon={ChevronRightIcon}
                        className={`size-2 text-white/40 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-90'}`}
                      />
                      <span
                        className="font-mono text-[9.5px] font-semibold uppercase"
                        style={{
                          letterSpacing: '0.12em',
                          color: 'var(--muted-foreground)',
                          opacity: 0.7,
                        }}
                      >
                        {String(t[group.labelKey])}
                      </span>
                      <span className="ml-auto rounded-[2px] border border-white/[0.06] px-1 font-mono text-[9.5px] text-white/20">
                        {group.keys.length}
                      </span>
                    </button>
                    {/* Swatches in this group */}
                    {!isCollapsed && (
                      <div className="ml-1.5 space-y-0">
                        {group.keys.map((key) => {
                          const hex = groupPalette[key];
                          if (!hex) return null;
                          const bgRef = referenceBg(key, groupPalette);
                          const level = wcagLevel(contrastRatio(hex, bgRef));
                          const isExpanded = expandedKey === key;
                          return (
                            <div key={key}>
                              <SwatchRow
                                hex={hex}
                                label={PALETTE_LABELS[key]}
                                contrastLevel={level}
                                expanded={isExpanded}
                                onToggle={() => setExpandedKey(isExpanded ? null : key)}
                                expandTitle={t.studioImageToThemeSwatchExpand}
                              />
                              {isExpanded && (
                                <SwatchDetailPanel
                                  hex={hex}
                                  copyTitle={t.studioImageToThemeCopyFormat}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {/* Apply action */}
          <Button
            onClick={handleApply}
            className="h-8 w-full gap-2 rounded-[2px] border border-[var(--primary)]/40 font-mono text-[9.5px] font-semibold uppercase transition-colors active:scale-[0.98]"
            style={{
              letterSpacing: '0.1em',
              background: 'var(--primary)',
              color: 'var(--on-primary, #fff)',
            }}
          >
            <HugeIcon icon={PaintBucketIcon} className="size-3" />
            {t.studioImageToThemeApplyToProject}
          </Button>
        </>
      )}

      {/* ===== Hint text ===== */}
      <p
        className="font-mono text-[9.5px] leading-relaxed"
        style={{ color: 'var(--muted-foreground)', opacity: 0.45 }}
      >
        {t.studioImageToThemeHintText}
      </p>
    </div>
  );
}
