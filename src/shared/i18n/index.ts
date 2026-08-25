// SPDX-License-Identifier: MPL-2.0

/**
 * i18n 聚合入口
 *
 * 消费方通过 `@shared/i18n` 导入，接口与原始单文件完全兼容：
 *   - uiMessages['zh-CN'] / uiMessages.en
 *   - mainMessages['zh-CN'] / mainMessages.en
 *   - UiMessages 类型
 *   - APP_LOCALES / AppLocale / DEFAULT_LOCALE / isAppLocale / localeFromSystem
 *   - setMainLocale / getMainLocale / getMainMessages
 */

export { APP_LOCALES, type AppLocale, DEFAULT_LOCALE, isAppLocale, localeFromSystem } from './base';
export { getMainLocale, getMainMessages, mainMessages, setMainLocale } from './modules/main';

import { agentsMessages } from './modules/agents';
import { appsMessages } from './modules/apps';
import { commonMessages } from './modules/common';
import { communityMessages } from './modules/community';
import { settingsMessages } from './modules/settings';
import { studioMessages } from './modules/studio';
import { themesMessages } from './modules/themes';
import { wallpaperMessages } from './modules/wallpaper';
import { workspaceMessages } from './modules/workspace';

export const uiMessages = {
  'zh-CN': {
    ...commonMessages['zh-CN'],
    ...agentsMessages['zh-CN'],
    ...settingsMessages['zh-CN'],
    ...workspaceMessages['zh-CN'],
    ...themesMessages['zh-CN'],
    ...studioMessages['zh-CN'],
    ...wallpaperMessages['zh-CN'],
    ...communityMessages['zh-CN'],
    ...appsMessages['zh-CN'],
  },
  en: {
    ...commonMessages.en,
    ...agentsMessages.en,
    ...settingsMessages.en,
    ...workspaceMessages.en,
    ...themesMessages.en,
    ...studioMessages.en,
    ...wallpaperMessages.en,
    ...communityMessages.en,
    ...appsMessages.en,
  },
};

export type UiMessages = (typeof uiMessages)['en'];
