// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs';
import fsAsync from 'node:fs/promises';
import path from 'node:path';
import { type AppLocale, isAppLocale, localeFromSystem } from '../shared/i18n';
import { writeJsonAtomic } from './fs-utils';

interface Preferences {
  locale?: unknown;
}

function preferencesPath(userDataRoot: string): string {
  return path.join(userDataRoot, 'preferences.json');
}

export async function saveLocalePreference(userDataRoot: string, locale: AppLocale): Promise<void> {
  await writeJsonAtomic(preferencesPath(userDataRoot), { locale });
}

export async function loadLocalePreference(
  userDataRoot: string,
  systemLocale: string,
): Promise<AppLocale> {
  try {
    const preferences = JSON.parse(
      await fsAsync.readFile(preferencesPath(userDataRoot), 'utf8'),
    ) as Preferences;
    if (isAppLocale(preferences.locale)) return preferences.locale;
  } catch (error) {
    // First launch (ENOENT) is expected — fall through to system locale detection.
    // Other errors (permission denied, corrupt JSON) are real problems: rethrow
    // so the caller can surface them instead of silently proceeding.
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      throw error;
    }
  }

  const locale = localeFromSystem(systemLocale);
  await saveLocalePreference(userDataRoot, locale);
  return locale;
}

// R6-21: 提供同步 flush 方法供 app before-quit 使用。
// 首次启动时 loadLocalePreference 内部 saveLocalePreference 是异步的，
// 如果进程快速退出（如首次启动后立即 quit），writeFile 可能尚未完成。
// 在 app before-quit 中调用此方法确保 preferences.json 已落盘。
export function flushLocalePreference(userDataRoot: string, locale: AppLocale): void {
  try {
    const file = preferencesPath(userDataRoot);
    const tmp = `${file}.${process.pid}.flush.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ locale }, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    // Best-effort — 同步 flush 失败时进程即将退出，无法恢复。
  }
}
