// SPDX-License-Identifier: MPL-2.0

/**
 * # ExtendedColorsEditor
 *
 * Visual editor for the `colors.extended` semantic color block.
 *
 * Provides:
 *   · Add / edit / delete extended colors with live preview
 *   · WCAG 2.1 contrast checking via ContrastBadge
 *   · OKLCH perceptual adjustment sliders (Lightness / Chroma / Hue)
 *   · Preset quick-add buttons for common semantic names
 *
 * Data sources:
 *   · extended-colors.mjs → wcagCheck, autoOnColor
 *   · oklch-utils.mjs → hexToOklch, oklchToHex, generateRamp
 */

import { useCallback, useMemo, useState } from 'react';

import type { UiMessages } from '@shared/i18n';
import { X } from 'lucide-react';
import { autoOnColor, wcagCheck } from '../../../../../scripts/extended-colors.mjs';
import { hexToOklch, oklchToHex } from '../../../../../scripts/oklch-utils.mjs';
import { ContrastBadge } from '../ContrastBadge';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtendedColorsEditorProps {
  /** Current extended colors object (name → hex). */
  colors: Record<string, string>;
  /** Change callback — fires when any color value changes. */
  onChange: (colors: Record<string, string>) => void;
  /** Delete callback — fires when a color is removed. */
  onDelete: (name: string) => void;
  /** Add callback — fires when a new color is added. */
  onAdd: (name: string, hex: string) => void;
  t: UiMessages;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const PRESETS: Array<{ name: string; hex: string }> = [
  { name: 'error', hex: '#ef4444' },
  { name: 'success', hex: '#22c55e' },
  { name: 'warning', hex: '#f59e0b' },
  { name: 'info', hex: '#3b82f6' },
];

// ---------------------------------------------------------------------------
// OKLCH slider component
// ---------------------------------------------------------------------------

function OklchSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 font-mono text-[10px] text-[var(--fg-2)]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 flex-1 cursor-pointer appearance-none rounded-[var(--dl-radius,2px)] bg-[var(--bg-2)] accent-[var(--accent)]"
        aria-label={label}
      />
      <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--fg-3)]">
        {value}
        {unit}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExtendedColorsEditor({
  colors,
  onChange,
  onDelete,
  onAdd,
  t,
}: ExtendedColorsEditorProps) {
  // Local state for the "add new color" form
  const [newName, setNewName] = useState('');
  const [newHex, setNewHex] = useState('#6366f1');

  // Currently selected color for OKLCH adjustment
  const [selectedName, setSelectedName] = useState<string | null>(null);

  // Derived: sorted entries for stable rendering
  const entries = useMemo(
    () => Object.entries(colors).sort(([a], [b]) => a.localeCompare(b)),
    [colors],
  );

  // Derived: selected color's OKLCH values
  const selectedHex = selectedName ? colors[selectedName] : undefined;
  const oklch = useMemo<[number, number, number]>(() => {
    if (!selectedHex) return [0.5, 0.1, 200];
    try {
      return hexToOklch(selectedHex);
    } catch {
      return [0.5, 0.1, 200];
    }
  }, [selectedHex]);

  // --- Handlers -----------------------------------------------------------

  const handleAdd = useCallback(() => {
    const name = newName.trim().toLowerCase();
    if (!name || colors[name]) return;
    onAdd(name, newHex);
    setNewName('');
  }, [newName, newHex, colors, onAdd]);

  const handlePreset = useCallback(
    (name: string, hex: string) => {
      if (colors[name]) return;
      onAdd(name, hex);
    },
    [colors, onAdd],
  );

  const handleColorRowClick = useCallback((name: string) => {
    setSelectedName((prev) => (prev === name ? null : name));
  }, []);

  const handleOklchChange = useCallback(
    (axis: 'l' | 'c' | 'h', value: number) => {
      if (!selectedName) return;
      const [l, c, h] = oklch;
      let next: [number, number, number];
      if (axis === 'l') next = [value / 100, c, h];
      else if (axis === 'c') next = [l, value / 100, h];
      else next = [l, c, value];

      try {
        const hex = oklchToHex(next[0], next[1], next[2]);
        onChange({ ...colors, [selectedName]: hex });
      } catch {
        // ignore invalid OKLCH conversions
      }
    },
    [selectedName, oklch, colors, onChange],
  );

  const handleDelete = useCallback(
    (name: string) => {
      onDelete(name);
      if (selectedName === name) setSelectedName(null);
    },
    [onDelete, selectedName],
  );

  // --- Render -------------------------------------------------------------

  return (
    <div className="flex h-full flex-col rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      {/* Header */}
      <div>
        <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">
          {t.studioExtColors ?? 'Extended Colors'}
        </h3>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
          {t.studioExtColorsDesc ??
            'Semantic color tokens (error, success, warning, info, glow…) with WCAG contrast and OKLCH adjustment.'}
        </p>
      </div>

      {/* ── Add new color ─────────────────────────────────────────────── */}
      <div className="mt-4 rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioExtAddColor ?? 'Add Color'}
        </h4>

        <div className="mt-2 flex items-center gap-2">
          {/* Name input */}
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t.studioExtNamePlaceholder ?? 'color name'}
            className="h-7 w-32 rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-1)] px-2 font-mono text-[10px] text-[var(--fg-0)] placeholder:text-[var(--fg-3)] focus:border-[var(--accent)] focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
          />

          {/* Native color picker */}
          <input
            type="color"
            value={newHex}
            onChange={(e) => setNewHex(e.target.value)}
            className="h-7 w-7 cursor-pointer rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-transparent"
            aria-label={t.studioExtPickColor ?? 'Pick color'}
          />

          {/* Hex readout */}
          <span className="font-mono text-[10px] tabular-nums text-[var(--fg-3)]">{newHex}</span>

          {/* Add button */}
          <button
            type="button"
            onClick={handleAdd}
            disabled={!newName.trim() || !!colors[newName.trim().toLowerCase()]}
            className="ws-btn ws-btn--sm ws-btn--primary"
          >
            {t.studioExtAdd ?? 'Add'}
          </button>
        </div>

        {/* Preset buttons */}
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-[10px] text-[var(--fg-3)]">
            {t.studioExtPresets ?? 'Presets:'}
          </span>
          {PRESETS.map((p) => {
            const disabled = !!colors[p.name];
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => handlePreset(p.name, p.hex)}
                disabled={disabled}
                className="flex items-center gap-1 rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-1)] px-2 py-1 font-mono text-[10px] text-[var(--fg-2)] transition-colors hover:border-[var(--fg-3)] disabled:cursor-not-allowed disabled:opacity-40"
                title={`${p.name} — ${p.hex}`}
              >
                <span
                  className="inline-block h-3 w-3 rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)]"
                  style={{ backgroundColor: p.hex }}
                  aria-hidden="true"
                />
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Existing colors list ──────────────────────────────────────── */}
      <div className="mt-4 flex-1 overflow-y-auto rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioExtCurrent ?? 'Current Colors'} ({entries.length})
        </h4>

        {entries.length === 0 ? (
          <div className="mt-4 rounded-[var(--dl-radius,2px)] border border-dashed border-[var(--border-subtle)] p-6 text-center">
            <p className="font-mono text-[10px] text-[var(--fg-3)]">
              {t.studioExtEmpty ?? 'No extended colors yet. Add one above.'}
            </p>
          </div>
        ) : (
          <div className="mt-2 space-y-1">
            {entries.map(([name, hex]) => {
              const onColor = autoOnColor(hex);
              const isSelected = selectedName === name;

              return (
                <div
                  key={name}
                  className={`flex items-center gap-2 rounded-[var(--dl-radius,2px)] border p-2 transition-colors ${
                    isSelected
                      ? 'border-[var(--accent)] bg-[var(--bg-1)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-1)] hover:border-[var(--fg-3)]'
                  }`}
                >
                  {/* Color swatch with on-color preview */}
                  <button
                    type="button"
                    onClick={() => handleColorRowClick(name)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] font-mono text-[10px] font-bold"
                    style={{ backgroundColor: hex, color: onColor }}
                    title={`${name} — ${hex}`}
                  >
                    Aa
                  </button>

                  {/* Name + hex */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[10px] font-bold text-[var(--fg-0)]">
                      {name}
                    </div>
                    <div className="font-mono text-[10px] tabular-nums text-[var(--fg-3)]">
                      {hex}
                    </div>
                  </div>

                  {/* WCAG contrast badge (on-color vs color) */}
                  <ContrastBadge fgHex={onColor} bgHex={hex} mode="full" />

                  {/* Delete */}
                  <button
                    type="button"
                    onClick={() => handleDelete(name)}
                    className="flex size-5 shrink-0 items-center justify-center rounded-[var(--dl-radius,2px)] text-[var(--fg-3)] transition-colors hover:bg-red-500/10 hover:text-red-500"
                    title={`${t.studioExtDelete ?? 'Delete'} ${name}`}
                    aria-label={`${t.studioExtDelete ?? 'Delete'} ${name}`}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── OKLCH adjustment panel ────────────────────────────────────── */}
      {selectedName && selectedHex && (
        <div className="mt-4 rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-4">
          <div className="flex items-center justify-between">
            <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
              {t.studioExtOklch ?? 'OKLCH Adjust'} — {selectedName}
            </h4>
            <button
              type="button"
              onClick={() => setSelectedName(null)}
              className="text-[var(--fg-3)] transition-colors hover:text-[var(--fg-0)]"
              aria-label={t.studioExtCloseOklch ?? 'Close OKLCH panel'}
            >
              <X className="size-3" />
            </button>
          </div>

          {/* Live preview swatch */}
          <div
            className="mt-2 flex h-10 items-center justify-center rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] font-mono text-xs font-bold"
            style={{
              backgroundColor: colors[selectedName],
              color: autoOnColor(colors[selectedName]),
            }}
          >
            {selectedName} — {colors[selectedName]}
          </div>

          <div className="mt-3 space-y-2">
            {/* Lightness: OKLCH L is 0-1, slider maps to 0-100 */}
            <OklchSlider
              label={t.studioExtLightness ?? 'Lightness'}
              value={Math.round(oklch[0] * 100)}
              min={0}
              max={100}
              step={1}
              unit=""
              onChange={(v) => handleOklchChange('l', v)}
            />

            {/* Chroma: OKLCH C is 0-0.4, slider maps to 0-50 (×100 for precision) */}
            <OklchSlider
              label={t.studioExtChroma ?? 'Chroma'}
              value={Math.round(oklch[1] * 100)}
              min={0}
              max={50}
              step={1}
              unit=""
              onChange={(v) => handleOklchChange('c', v)}
            />

            {/* Hue: 0-360 */}
            <OklchSlider
              label={t.studioExtHue ?? 'Hue'}
              value={Math.round(oklch[2])}
              min={0}
              max={360}
              step={1}
              unit="°"
              onChange={(v) => handleOklchChange('h', v)}
            />
          </div>

          {/* WCAG summary for the selected color */}
          <div className="mt-3 flex items-center gap-3 font-mono text-[10px] text-[var(--fg-2)]">
            <span>{t.studioExtContrast ?? 'Contrast:'}</span>
            <ContrastBadge
              fgHex={autoOnColor(colors[selectedName])}
              bgHex={colors[selectedName]}
              mode="full"
            />
            <span className="text-[var(--fg-3)]">
              ({t.studioExtOnColor ?? 'on-color'}: {autoOnColor(colors[selectedName])})
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
