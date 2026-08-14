// SPDX-License-Identifier: MPL-2.0

/**
 * # TweakPanel
 *
 * Live-tweak control panel for the Workbench. Exposes the subset of
 * `ToolOverride` dimensions that map to simple controls:
 *
 *   - radius        slider  0–16px
 *   - spacing       slider  4–32px
 *   - shadowLevel   select  none / sm / md / lg
 *   - accent        color
 *   - background    color
 *   - foreground    color
 *   - fontSize      slider  10–18px
 *
 * Every change fires `onChange` synchronously so the parent can push the full
 * override set to the running agent in real time. The component is fully
 * controlled — it reflects `overrides`, never owns the source of truth.
 *
 * design system:
 *   - spacing values are drawn from 4/8/16/24/32 only
 *   - corners rounded-md
 *   - numeric readouts use tabular-nums
 *   - no 10/12/14px type — labels stay at 11px (the mono minimum)
 */

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ToolOverride } from '@/types/override';

import type { UiMessages } from '@shared/i18n';

// ---------------------------------------------------------------------------
// Shadow levels — shared with tweak-injector.ts shadowFromLevel()
// ---------------------------------------------------------------------------

const SHADOW_LEVELS = ['none', 'sm', 'md', 'lg'] as const;

/** Map a shadow level to its i18n key — keeps the lookup statically typed. */
const SHADOW_LABEL_KEY: Record<string, keyof UiMessages> = {
  none: 'workspaceTweakShadowNone',
  sm: 'workspaceTweakShadowSm',
  md: 'workspaceTweakShadowMd',
  lg: 'workspaceTweakShadowLg',
};

/**
 * Read a string-valued i18n key. `UiMessages` mixes string and function
 * values (e.g. `themeStatsActive`), so a bare index access widens to a
 * union that is not assignable to `string` / `ReactNode`. This helper
 * narrows to the string case — callers only use it on known-string keys.
 */
function str(t: UiMessages, key: keyof UiMessages): string {
  const v = t[key] as unknown;
  return typeof v === 'string' ? v : '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TweakPanel({
  overrides,
  onChange,
  t,
}: {
  overrides: ToolOverride;
  onChange: (next: ToolOverride) => void;
  t: UiMessages;
}) {
  const set = (key: keyof ToolOverride, value: ToolOverride[keyof ToolOverride]) =>
    onChange({ ...overrides, [key]: value });

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1: radius + spacing + font size — slider trio */}
      <div className="grid grid-cols-3 gap-4">
        {/* Radius */}
        <label className="flex flex-col gap-2">
          <span className="text-[11px] tracking-tight text-muted-foreground ">
            {str(t, 'workspaceTweakRadius')}
          </span>
          <input
            type="range"
            min={0}
            max={16}
            step={1}
            value={pxToInt(overrides.radius, 0)}
            onChange={(e) => set('radius', `${e.target.value}px`)}
            aria-label={str(t, 'workspaceTweakRadius')}
          />
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {overrides.radius ?? '0px'}
          </span>
        </label>

        {/* Spacing */}
        <label className="flex flex-col gap-2">
          <span className="text-[11px] tracking-tight text-muted-foreground ">
            {str(t, 'workspaceTweakSpacing')}
          </span>
          <input
            type="range"
            min={4}
            max={32}
            step={4}
            value={overrides.spacing ?? 8}
            onChange={(e) => set('spacing', Number(e.target.value))}
            aria-label={str(t, 'workspaceTweakSpacing')}
          />
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {overrides.spacing ?? 8}px
          </span>
        </label>

        {/* Font size */}
        <label className="flex flex-col gap-2">
          <span className="text-[11px] tracking-tight text-muted-foreground ">
            {str(t, 'workspaceTweakFontSize')}
          </span>
          <input
            type="range"
            min={10}
            max={18}
            step={1}
            value={overrides.fontSize ?? 13}
            onChange={(e) => set('fontSize', Number(e.target.value))}
            aria-label={str(t, 'workspaceTweakFontSize')}
          />
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {overrides.fontSize ?? 13}px
          </span>
        </label>
      </div>

      {/* Row 2: shadow select */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] tracking-tight text-muted-foreground ">
          {str(t, 'workspaceTweakShadow')}
        </span>
        <Select
          value={overrides.shadowLevel ?? 'none'}
          onValueChange={(v) => set('shadowLevel', v as ToolOverride['shadowLevel'])}
        >
          <SelectTrigger className="h-8 w-32 rounded-md text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SHADOW_LEVELS.map((level) => (
              <SelectItem key={level} value={level} className="text-[13px]">
                {str(t, SHADOW_LABEL_KEY[level])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Row 3: color pickers — accent / background / foreground */}
      <div className="grid grid-cols-3 gap-4">
        <ColorField
          label={str(t, 'workspaceTweakAccent')}
          value={overrides.accent}
          onChange={(v) => set('accent', v)}
          t={t}
        />
        <ColorField
          label={str(t, 'workspaceTweakBackground')}
          value={overrides.background}
          onChange={(v) => set('background', v)}
          t={t}
        />
        <ColorField
          label={str(t, 'workspaceTweakForeground')}
          value={overrides.foreground}
          onChange={(v) => set('foreground', v)}
          t={t}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ColorField — hex text input + native color picker in amerged row
// ---------------------------------------------------------------------------

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  t: UiMessages;
}) {
  const hex = value ?? '#888888';
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[11px] tracking-tight text-muted-foreground ">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={toColorInput(hex)}
          onChange={(e) => onChange(e.target.value)}
          className="size-7 cursor-pointer rounded-md  bg-transparent p-0"
          aria-label={label}
        />
        <Input
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 flex-1 rounded-md px-2 font-mono text-[11px] tabular-nums"
        />
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pxToInt(px: string | undefined, fallback: number): number {
  if (!px) return fallback;
  const n = Number.parseInt(px, 10);
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Normalize a hex string to the 6-digit form `<input type="color">` expects.
 * Falls through unrecognized values — the color input will clamp to its
 * default rather than throw.
 */
function toColorInput(hex: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    const r = hex[1];
    const g = hex[2];
    const b = hex[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return '#888888';
}
