// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioCenterPanel
 *
 * Center work-area container with a 4-tab bar (theme / wallpaper / bundle /
 * raw). Each tab renders a corresponding content panel.
 *
 * This is the canonical center workspace.
 *
 * Active tab is driven by `studioStore.previewView` (getState().setPreviewView).
 */

import { useStudioStore } from '@/stores/studioStore';
import type { PreviewView } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';
import { CenterTabBundle } from './center/CenterTabBundle';
import { CenterTabRaw } from './center/CenterTabRaw';
import { CenterTabThemeEditor } from './center/CenterTabThemeEditor';
import { CenterTabWallpaper } from './center/CenterTabWallpaper';

/** Ordered list of center tabs with their i18n label keys. */
const CENTER_TABS: {
  view: PreviewView;
  labelKey: 'studioTabTheme' | 'studioTabWallpaper' | 'studioTabBundle' | 'studioTabRaw';
}[] = [
  { view: 'theme', labelKey: 'studioTabTheme' },
  { view: 'wallpaper', labelKey: 'studioTabWallpaper' },
  { view: 'bundle', labelKey: 'studioTabBundle' },
  { view: 'raw', labelKey: 'studioTabRaw' },
];

export function StudioCenterPanel({ t }: { t: UiMessages }) {
  const previewView = useStudioStore((s) => s.previewView);

  const setView = (v: PreviewView) => {
    useStudioStore.getState().setPreviewView(v);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-0 rounded-[2px]" style={{ background: 'var(--bg-2)' }}>
        {CENTER_TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            data-active={previewView === tab.view}
            onClick={() => setView(tab.view)}
            className="ws-btn ws-btn--sm"
            title={t[tab.labelKey]}
          >
            {t[tab.labelKey]}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {previewView === 'theme' && <CenterTabThemeEditor t={t} />}
        {previewView === 'wallpaper' && <CenterTabWallpaper t={t} />}
        {previewView === 'bundle' && <CenterTabBundle t={t} />}
        {previewView === 'raw' && <CenterTabRaw t={t} />}
      </div>
    </div>
  );
}
