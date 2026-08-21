// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioCenterPanel
 *
 * Center work-area container with a 6-tab bar (theme / wallpaper / bundle /
 * inspect / generator / raw). Each tab renders a corresponding content panel.
 *
 * This is the canonical center workspace — the missing piece that i18n
 * reserved (6 studioTab* keys) but no component ever rendered.
 *
 * Active tab is driven by `studioStore.previewView` (getState().setPreviewView).
 */

import { useStudioStore } from '@/stores/studioStore';
import type { PreviewView } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';
import { CenterTabBundle } from './center/CenterTabBundle';
import { CenterTabGenerator } from './center/CenterTabGenerator';
import { CenterTabInspect } from './center/CenterTabInspect';
import { CenterTabRaw } from './center/CenterTabRaw';
import { CenterTabThemeEditor } from './center/CenterTabThemeEditor';
import { CenterTabWallpaper } from './center/CenterTabWallpaper';

/** Ordered list of center tabs with their i18n label keys. */
const CENTER_TABS: {
  view: PreviewView;
  labelKey:
    | 'studioTabTheme'
    | 'studioTabWallpaper'
    | 'studioTabBundle'
    | 'studioTabInspect'
    | 'studioTabGenerator'
    | 'studioTabRaw';
}[] = [
  { view: 'theme', labelKey: 'studioTabTheme' },
  { view: 'wallpaper', labelKey: 'studioTabWallpaper' },
  { view: 'bundle', labelKey: 'studioTabBundle' },
  { view: 'inspect', labelKey: 'studioTabInspect' },
  { view: 'generator', labelKey: 'studioTabGenerator' },
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
        {previewView === 'inspect' && <CenterTabInspect t={t} />}
        {previewView === 'generator' && <CenterTabGenerator t={t} />}
        {previewView === 'raw' && <CenterTabRaw t={t} />}
      </div>
    </div>
  );
}
