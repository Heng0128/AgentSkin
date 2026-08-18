// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabBundle
 *
 * Placeholder panel for the "Bundle" center tab.
 * Full implementation will manage installed bundle packages.
 */

import type { UiMessages } from '@shared/i18n';

export function CenterTabBundle({ t }: { t: UiMessages }) {
  const desc =
    'studioTabBundleDesc' in t
      ? (t as unknown as Record<string, string>).studioTabBundleDesc
      : '管理已安装的 bundle 包（主题 + 壁纸组合）。';

  return (
    <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">{t.studioTabBundle}</h3>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">{desc}</p>
      <div className="mt-4 rounded-[2px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-2)] p-8 text-center">
        <p className="font-mono text-[10px] text-[var(--fg-3)]">Bundle 管理（即将推出）</p>
      </div>
    </div>
  );
}
