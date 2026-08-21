// SPDX-License-Identifier: MPL-2.0

/**
 * # TweakPanel
 *
 * Live-tweak control panel for the Workbench. Exposes the subset of
 * `ToolOverride` dimensions that map to simple controls, grouped by
 * category (color, shape, typography, motion):
 *
 *   - color:      accent / background / foreground / surface
 *   - shape:      radius / spacing / shadowLevel / blurPx / borderWidth
 *   - typography: fontSize / fontFam / lineHeight
 *   - motion:     duration / timing
 *
 * Every change fires `onChange` synchronously so the parent can push the full
 * override set to the running agent in real time. The component is fully
 * controlled — it reflects `overrides`, never owns the source of truth.
 *
 * design system:
 *   - spacing values drawn from 4/8/16/24/32 only
 *   - corners rounded-md
 *   - numeric readouts use tabular-nums
 *   - no 10/12/14px type — labels stay at 11px (the mono minimum)
 *   - groups are collapsible; color group expanded by default
 */

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ToolOverride } from '@/types/override';
import { DEFAULT_EXPANDED_GROUP, OVERRIDE_GROUPS, type TweakGroupId } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';

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

/** Field label i18n keys. */
const FIELD_LABEL_KEY: Record<string, keyof UiMessages> = {
  radius: 'workspaceTweakRadius',
  spacing: 'workspaceTweakSpacing',
  shadowLevel: 'workspaceTweakShadow',
  fontSize: 'workspaceTweakFontSize',
  accent: 'workspaceTweakAccent',
  background: 'workspaceTweakBackground',
  foreground: 'workspaceTweakForeground',
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
// Helpers
// ---------------------------------------------------------------------------

/** Get the default value for a field (used to determine if it's overridden). */
function getFieldDefault(key: keyof ToolOverride): ToolOverride[keyof ToolOverride] | undefined {
  switch (key) {
    case 'radius':
      return '0px';
    case 'spacing':
      return 8;
    case 'shadowLevel':
      return 'none';
    case 'fontSize':
      return 13;
    default:
      return undefined;
  }
}

/** Check if a field is currently overridden (differs from default). */
function isFieldOverridden(key: keyof ToolOverride, overrides: ToolOverride): boolean {
  const value = overrides[key];
  if (value === undefined) return false;
  const defaultVal = getFieldDefault(key);
  return defaultVal !== undefined && value !== defaultVal;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TweakPanel({
  overrides,
  onChange,
  t,
  highlightedField,
}: {
  overrides: ToolOverride;
  onChange: (next: ToolOverride) => void;
  t: UiMessages;
  /** Field key to visually highlight (from element picking). */
  highlightedField?: string;
}) {
  // Track which groups are expanded. Default: color expanded, others collapsed.
  // If highlightedField belongs to a collapsed group, auto-expand it.
  const [expandedGroups, setExpandedGroups] = useState<Set<TweakGroupId>>(() => {
    const initial = new Set([DEFAULT_EXPANDED_GROUP]);
    if (highlightedField) {
      const group = OVERRIDE_GROUPS.find((g) => g.fields.includes(highlightedField));
      if (group) initial.add(group.id);
    }
    return initial;
  });

  const toggleGroup = (groupId: TweakGroupId) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  // Auto-expand the group containing highlightedField when it changes
  // (e.g. user picks an element in inspect mode). The useState initializer
  // only runs on mount, so this effect handles subsequent prop changes.
  useEffect(() => {
    if (highlightedField) {
      const group = OVERRIDE_GROUPS.find((g) => g.fields.includes(highlightedField));
      if (group) {
        setExpandedGroups((prev) => {
          if (prev.has(group.id)) return prev;
          const next = new Set(prev);
          next.add(group.id);
          return next;
        });
      }
    }
  }, [highlightedField]);

  const setField = (key: keyof ToolOverride, value: ToolOverride[keyof ToolOverride]) =>
    onChange({ ...overrides, [key]: value });

  const resetField = (key: keyof ToolOverride) => {
    const next = { ...overrides };
    delete next[key];
    onChange(next);
  };

  /** Render a single field based on its key. */
  const renderField = (key: string) => {
    const labelKey = FIELD_LABEL_KEY[key];
    const label = labelKey ? str(t, labelKey) : key;
    const overridden = isFieldOverridden(key as keyof ToolOverride, overrides);
    const isHighlighted = highlightedField === key;

    switch (key) {
      case 'radius':
        return (
          <FieldRow
            key={key}
            label={label}
            overridden={overridden}
            highlighted={isHighlighted}
            onReset={() => resetField('radius')}
            t={t}
          >
            <input
              type="range"
              min={0}
              max={16}
              step={1}
              value={pxToInt(overrides.radius, 0)}
              onChange={(e) => setField('radius', `${e.target.value}px`)}
              aria-label={label}
            />
            <span className="as-mono tabular-nums">{overrides.radius ?? '0px'}</span>
          </FieldRow>
        );
      case 'spacing':
        return (
          <FieldRow
            key={key}
            label={label}
            overridden={overridden}
            highlighted={isHighlighted}
            onReset={() => resetField('spacing')}
            t={t}
          >
            <input
              type="range"
              min={4}
              max={32}
              step={4}
              value={overrides.spacing ?? 8}
              onChange={(e) => setField('spacing', Number(e.target.value))}
              aria-label={label}
            />
            <span className="as-mono tabular-nums">{overrides.spacing ?? 8}px</span>
          </FieldRow>
        );
      case 'fontSize':
        return (
          <FieldRow
            key={key}
            label={label}
            overridden={overridden}
            highlighted={isHighlighted}
            onReset={() => resetField('fontSize')}
            t={t}
          >
            <input
              type="range"
              min={10}
              max={18}
              step={1}
              value={overrides.fontSize ?? 13}
              onChange={(e) => setField('fontSize', Number(e.target.value))}
              aria-label={label}
            />
            <span className="as-mono tabular-nums">{overrides.fontSize ?? 13}px</span>
          </FieldRow>
        );
      case 'shadowLevel':
        return (
          <FieldRow
            key={key}
            label={label}
            overridden={overridden}
            highlighted={isHighlighted}
            onReset={() => resetField('shadowLevel')}
            t={t}
          >
            <Select
              value={overrides.shadowLevel ?? 'none'}
              onValueChange={(v) => setField('shadowLevel', v as ToolOverride['shadowLevel'])}
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
          </FieldRow>
        );
      case 'accent':
      case 'background':
      case 'foreground':
      case 'surface':
        return (
          <FieldRow
            key={key}
            label={label}
            overridden={overridden}
            highlighted={isHighlighted}
            onReset={() => resetField(key as keyof ToolOverride)}
            t={t}
          >
            <ColorField
              label={label}
              value={overrides[key as keyof ToolOverride] as string | undefined}
              onChange={(v) => setField(key as keyof ToolOverride, v)}
              t={t}
            />
          </FieldRow>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {OVERRIDE_GROUPS.map((group) => {
        const isExpanded = expandedGroups.has(group.id);
        return (
          <div key={group.id} className="flex flex-col gap-2">
            {/* Group header */}
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              className="flex items-center gap-2 text-[11px] font-medium tracking-tight text-muted-foreground hover:text-foreground transition-colors"
              aria-expanded={isExpanded}
            >
              {isExpanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              {group.label}
            </button>
            {/* Group fields */}
            {isExpanded && (
              <div className="flex flex-col gap-4 pl-5">{group.fields.map(renderField)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FieldRow — label + control + override indicator + reset button
// ---------------------------------------------------------------------------

function FieldRow({
  label,
  children,
  overridden,
  highlighted,
  onReset,
  t,
}: {
  label: string;
  children: React.ReactNode;
  overridden: boolean;
  highlighted?: boolean;
  onReset: () => void;
  t: UiMessages;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-[var(--dl-radius,2px)] px-1 py-0.5 transition-colors ${
        highlighted ? 'bg-[var(--accent-ghost)] ring-1 ring-[var(--accent)]' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        {/* Override indicator dot */}
        <span
          className={`size-[5px] rounded-full ${overridden ? 'bg-[var(--accent)]' : 'bg-transparent'}`}
          title={overridden ? '已覆盖' : '默认值'}
        />
        <span className="text-[11px] tracking-tight text-muted-foreground flex-1">{label}</span>
        {/* Reset button — only show when overridden */}
        {overridden && (
          <button
            type="button"
            onClick={onReset}
            className="size-5 flex items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground hover:text-foreground hover:bg-[var(--surface)] transition-colors"
            title={str(t, 'studioToolboxReset') ?? '重置'}
            aria-label={str(t, 'studioToolboxReset') ?? '重置'}
          >
            <RotateCcw className="size-3" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ColorField — hex text input + native color picker in a merged row
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
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={toColorInput(hex)}
        onChange={(e) => onChange(e.target.value)}
        className="size-7 cursor-pointer rounded-md bg-transparent p-0"
        aria-label={label}
      />
      <Input
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 flex-1 rounded-md px-2 font-mono text-[11px] tabular-nums"
      />
    </div>
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
