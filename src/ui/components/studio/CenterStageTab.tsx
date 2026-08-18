// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterStageTab
 *
 * Dispatcher that renders the correct center-tab panel based on the
 * current `previewView` value (wallpaper / bundle / inspect / raw).
 *
 * Used by StudioStage when the active tab is not 'theme' or 'generator'.
 */

import type { PreviewView } from '@/types/workspace';

import type { UiMessages } from '@shared/i18n';
import { CenterTabBundle } from './center/CenterTabBundle';
import { CenterTabInspect } from './center/CenterTabInspect';
import { CenterTabRaw } from './center/CenterTabRaw';
import { CenterTabWallpaper } from './center/CenterTabWallpaper';

export function CenterStageTab({ view, t }: { view: PreviewView; t: UiMessages }) {
  switch (view) {
    case 'wallpaper':
      return <CenterTabWallpaper t={t} />;
    case 'bundle':
      return <CenterTabBundle t={t} />;
    case 'inspect':
      return <CenterTabInspect t={t} />;
    case 'raw':
      return <CenterTabRaw t={t} />;
    default:
      return null;
  }
}
