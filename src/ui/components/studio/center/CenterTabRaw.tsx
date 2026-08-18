// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabRaw
 *
 * Placeholder panel for the "Raw" center tab.
 * Full implementation will provide native CSS source editing.
 */

import type { UiMessages } from '@shared/i18n';

export function CenterTabRaw({ t }: { t: UiMessages }) {
  const desc =
    'studioTabRawDesc' in t
      ? (t as unknown as Record<string, string>).studioTabRawDesc
      : '原生 CSS 源码编辑：直接修改注入样式表。';

  return (
    <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">{t.studioTabRaw}</h3>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">{desc}</p>
      <div className="mt-4 rounded-[2px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-2)] p-8 text-center">
        <p className="font-mono text-[10px] text-[var(--fg-3)]">CSS 源码编辑（即将推出）</p>
      </div>
    </div>
  );
}
