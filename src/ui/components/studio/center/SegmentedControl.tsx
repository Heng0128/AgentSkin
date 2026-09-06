// SPDX-License-Identifier: MPL-2.0

/**
 * # SegmentedControl
 *
 * Generic button-group selector — a row of toggle buttons where exactly one
 * option can be active. Used by CenterTabThemeEditor for spacing density,
 * radius scale, shadow elevation, and motion speed selection.
 *
 * Extracted from CenterTabThemeEditor (RC-12) to shrink the parent component
 * to a manageable size.
 */

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  t: labels,
}: {
  options: { value: T; label: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
  t?: Record<string, string>;
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => {
        const isSelected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
              isSelected
                ? 'border-primary bg-card2 text-foreground'
                : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/40'
            }`}
          >
            {labels?.[opt.value] ?? opt.label}
          </button>
        );
      })}
    </div>
  );
}
