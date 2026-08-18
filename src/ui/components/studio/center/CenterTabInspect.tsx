// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabInspect
 *
 * Placeholder panel for the "Inspect" center tab.
 * Full implementation will provide front-end theme compliance checking.
 */

import type { UiMessages } from '@shared/i18n';

export function CenterTabInspect({ t }: { t: UiMessages }) {
  const desc =
    'studioTabInspectDesc' in t
      ? (t as unknown as Record<string, string>).studioTabInspectDesc
      : '前端主题合规检查：对比度、字号、间距、色值一致性。';

  return (
    <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">{t.studioTabInspect}</h3>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">{desc}</p>
      <div className="mt-4 rounded-[2px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-2)] p-8 text-center">
        <p className="font-mono text-[10px] text-[var(--fg-3)]">合规检查（即将推出）</p>
      </div>
    </div>
  );
}
