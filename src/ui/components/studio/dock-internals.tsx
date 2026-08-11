// SPDX-License-Identifier: MPL-2.0

/**
 * # dock-internals
 *
 * Shared Swiss-styled micro-components used by the Dock panels
 * (DockTabFX color / slider / select / toggle cards).
 *
 * Each card targets 160×72px with 1px border and 6px radius
 * per the Swiss design spec.
 */

import { useCallback } from 'react';

// ---------------------------------------------------------------------------
// SliderCard — horizontal track + fill + thumb indicator
// ---------------------------------------------------------------------------

export function SliderCard({
  label,
  displayValue,
  value,
  min,
  max,
  step,
  unit = '',
  overridden,
  onReset,
  onChange,
}: {
  label: string;
  displayValue: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  overridden: boolean;
  onReset: () => void;
  onChange: (v: number) => void;
}) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(parseFloat(e.target.value));
    },
    [onChange],
  );

  return (
    <div className="ws-dock-card" style={{ height: 72 }}>
      <div className="ws-dock-card__label">
        <span className="name">{label}</span>
        <span className="val" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {displayValue}
          {unit}
        </span>
      </div>
      <div className="ws-dock-card__slider">
        <div className="ws-dock-card__slider-track" />
        <div className="ws-dock-card__slider-fill" style={{ width: `${pct}%` }} />
        <div className="ws-dock-card__slider-thumb" style={{ left: `${pct}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleInput}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <div className="ws-dock-card__footer">
        <button
          type="button"
          onClick={onReset}
          disabled={!overridden}
          className="ws-dock-card__reset disabled:opacity-30"
        >
          ↺
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ColorCard — swatch + hex input
// ---------------------------------------------------------------------------

export function ColorCard({
  label,
  value,
  overridden,
  onReset,
  onChange,
}: {
  label: string;
  value: string;
  overridden: boolean;
  onReset: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="ws-dock-card" style={{ height: 72 }}>
      <div className="ws-dock-card__label">
        <span className="name">{label}</span>
      </div>
      <div className="ws-dock-card__color-row">
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="ws-dock-card__color-swatch"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#RRGGBB"
          className="ws-dock-card__color-input"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        />
      </div>
      <div className="ws-dock-card__footer">
        <button
          type="button"
          onClick={onReset}
          disabled={!overridden}
          className="ws-dock-card__reset disabled:opacity-30"
        >
          ↺
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectCard — dropdown in 160px card
// ---------------------------------------------------------------------------

export function SelectCard({
  label,
  value,
  options,
  overridden,
  onReset,
  onChange,
}: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  overridden: boolean;
  onReset: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="ws-dock-card" style={{ height: 72 }}>
      <div className="ws-dock-card__label">
        <span className="name">{label}</span>
        <span className="val" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ws-dock-card__select"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="ws-dock-card__footer">
        <button
          type="button"
          onClick={onReset}
          disabled={!overridden}
          className="ws-dock-card__reset disabled:opacity-30"
        >
          ↺
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToggleCard — inline switch
// ---------------------------------------------------------------------------

export function ToggleCard({
  label,
  checked,
  overridden,
  onReset,
  onChange,
}: {
  label: string;
  checked: boolean;
  overridden: boolean;
  onReset: () => void;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="ws-dock-card" style={{ height: 72 }}>
      <div className="ws-dock-card__toggle-row" style={{ flex: 1 }}>
        <span className="lbl-name">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          data-on={checked ? 'true' : undefined}
          className="ws-dock-toggle"
          onClick={() => onChange(!checked)}
        />
      </div>
      <div className="ws-dock-card__footer">
        <button
          type="button"
          onClick={onReset}
          disabled={!overridden}
          className="ws-dock-card__reset disabled:opacity-30"
        >
          ↺
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionChip — horizontal section label above card rows
// ---------------------------------------------------------------------------

export function SectionChip({ label, active = false }: { label: string; active?: boolean }) {
  return (
    <span className="ws-chip" data-active={active ? 'true' : undefined}>
      {label}
    </span>
  );
}
