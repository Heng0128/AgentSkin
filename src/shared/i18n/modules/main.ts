// SPDX-License-Identifier: MPL-2.0

import { type AppLocale, DEFAULT_LOCALE } from '../base';

export const mainMessages = {
  'zh-CN': {
    trayTooltip: 'AgentSkin 主题管理器',
    trayOpen: '打开 AgentSkin',
    trayRestore: '一键恢复',
    trayQuit: '退出 AgentSkin',
    trayTooltipActive: (count: number) => `AgentSkin · ${count} 个应用已应用主题`,
    trayAppRunning: '运行中',
    trayAppNotRunning: '未运行',
    trayAppNotInstalled: '未安装',
    trayAppThemed: (name: string) => `已应用：${name}`,
    trayAppNoTheme: '未应用主题',
    trayRestoreApp: (app: string) => `恢复 ${app}`,
    trayApplyTheme: '应用主题',
    trayNoThemes: '无可用主题',
    importDialogTitle: '导入 AgentSkin 主题',
    pickAppDialogTitle: (app: string) => `选择 ${app} 的安装位置`,
    exportDialogTitle: '导出 AgentSkin 主题',
    themePackageFilter: 'AgentSkin 主题包',
    bundleExportDialogTitle: '导出 AgentSkin 组合包',
    bundleInstallDialogTitle: '安装 AgentSkin 组合包',
    bundleFilter: 'AgentSkin 组合包',
    bundleNoSource: (themeId: string) =>
      `找不到主题「${themeId}」的目录包（仅内置/壁纸生成主题可导出组合包）`,
    invalidBundle: '不是有效的 AgentSkin 组合包（.agentskin-bundle）。',
    startupErrorTitle: 'AgentSkin 启动失败',
    packageTooLarge: (maxMb: number) => `主题包超过限制（最大 ${Math.round(maxMb)}MB），无法导入。`,
    invalidLocale: '不支持这个界面语言。',
    manifestInvalidId: '主题 ID 只能包含字母、数字、下划线和连字符。',
    themeNotFound: (id: string) => `主题不存在：${id}`,
    invalidPackage: '不是有效的 AgentSkin 主题包。',
    unsupportedPlatform: '当前只支持 macOS 和 Windows。',
    invalidCdpPort: 'CDP 端口必须是 1024 至 65535 的整数。',
    invalidPort: '端口必须是 1024 至 65535 的整数。',
    portAllOccupied: '端口全部被占用',
    invalidCustomCss: '自定义 CSS 无效（非文本或超过 256KB 上限）。',
    invalidLiveDomRefreshInterval: '实时预览刷新间隔必须是非负整数（毫秒）。',
    invalidAgentId: '无效的应用标识符。',
    invalidThemeId: '无效的主题标识符。',
    invalidPath: '无效的路径。',
    invalidSearchQuery: '无效的搜索关键词。',
    invalidApplyRequest: '无效的应用主题请求。',
    wallpaperImportDialogTitle: '导入壁纸',
    wallpaperImportFilterAll: '图片和视频',
    wallpaperImportFilterVideo: '视频',
    wallpaperImportFilterImage: '图片',
    wallpaperThemeNoPreview: '该壁纸没有可用的预览图，无法自动取色生成主题。',
    restartRequiredMessage:
      '应用正在运行，需要由 AgentSkin 重启一次才能启用主题。请在弹窗中点击"重启并应用"。',
    cdpNotDetectedMessage:
      '该应用当前未开启调试端口，无法直接注入主题。需要重启该应用以启用调试端口后才能应用主题。',
    portOccupiedMessage: (port: number) =>
      `端口 ${port} 被其他进程占用，AgentSkin 无法连接或重启该应用。请关闭占用端口的程序，或在设置中为该应用更换端口后重试。`,
    themeApplied: (name: string, app: string) => `${name} 已应用到 ${app}。`,
    shuffle: '打乱',
    tokenLocked: '已锁定',
    tokenUnlocked: '未锁定',
    tokenLockedCount: (locked: number, total: number) => `${locked}/${total} 已锁定`,
  },
  en: {
    trayTooltip: 'AgentSkin Theme Manager',
    trayOpen: 'Open AgentSkin',
    trayRestore: 'Restore all',
    trayQuit: 'Quit AgentSkin',
    trayTooltipActive: (count: number) =>
      `AgentSkin · ${count} app${count === 1 ? '' : 's'} themed`,
    trayAppRunning: 'Running',
    trayAppNotRunning: 'Not running',
    trayAppNotInstalled: 'Not installed',
    trayAppThemed: (name: string) => `Theme: ${name}`,
    trayAppNoTheme: 'No theme',
    trayRestoreApp: (app: string) => `Restore ${app}`,
    trayApplyTheme: 'Apply theme',
    trayNoThemes: 'No themes available',
    importDialogTitle: 'Import a AgentSkin theme',
    pickAppDialogTitle: (app: string) => `Choose the ${app} install location`,
    exportDialogTitle: 'Export a AgentSkin theme',
    themePackageFilter: 'AgentSkin theme package',
    bundleExportDialogTitle: 'Export AgentSkin bundle',
    bundleInstallDialogTitle: 'Install AgentSkin bundle',
    bundleFilter: 'AgentSkin bundle',
    bundleNoSource: (themeId: string) =>
      `No directory package found for theme "${themeId}" (only built-in / wallpaper-generated themes can be exported as bundles)`,
    invalidBundle: 'This is not a valid AgentSkin bundle (.agentskin-bundle).',
    startupErrorTitle: 'AgentSkin failed to start',
    packageTooLarge: (maxMb: number) => `Theme package exceeds limit (max ${Math.round(maxMb)}MB).`,
    invalidLocale: 'This interface language is not supported.',
    manifestInvalidId: 'Theme IDs may only contain letters, numbers, underscores, and hyphens.',
    themeNotFound: (id: string) => `Theme not found: ${id}`,
    invalidPackage: 'This is not a valid AgentSkin theme package.',
    unsupportedPlatform: 'Only macOS and Windows are currently supported.',
    invalidCdpPort: 'The CDP port must be an integer from 1024 to 65535.',
    invalidPort: 'The port must be an integer from 1024 to 65535.',
    portAllOccupied: 'All ports are occupied',
    invalidCustomCss: 'Invalid custom CSS (not text or exceeds the 256KB limit).',
    invalidLiveDomRefreshInterval:
      'Live preview refresh interval must be a non-negative integer (ms).',
    invalidAgentId: 'Invalid agent id.',
    invalidThemeId: 'Invalid theme id.',
    invalidPath: 'Invalid path.',
    invalidSearchQuery: 'Invalid search query.',
    invalidApplyRequest: 'Invalid apply request.',
    wallpaperImportDialogTitle: 'Import Wallpaper',
    wallpaperImportFilterAll: 'Images & Videos',
    wallpaperImportFilterVideo: 'Video',
    wallpaperImportFilterImage: 'Image',
    wallpaperThemeNoPreview:
      'This wallpaper has no usable preview image — cannot auto-extract a theme.',
    restartRequiredMessage:
      'The app is running and AgentSkin must restart it once before the theme can be enabled. Click "Restart & apply" in the dialog.',
    cdpNotDetectedMessage:
      'The app has no debug port open, so the theme cannot be injected directly. The app needs to be restarted with a debug port before the theme can be applied.',
    portOccupiedMessage: (port: number) =>
      `Port ${port} is occupied by another process, so AgentSkin cannot attach to or restart the app. Close whatever is using the port, or change the app's port in Settings, then retry.`,
    themeApplied: (name: string, app: string) => `${name} has been applied to ${app}.`,
    shuffle: 'Shuffle',
    tokenLocked: 'Locked',
    tokenUnlocked: 'Unlocked',
    tokenLockedCount: (locked: number, total: number) => `${locked}/${total} locked`,
  },
};

let currentMainLocale: AppLocale = DEFAULT_LOCALE;

export function setMainLocale(locale: AppLocale): void {
  currentMainLocale = locale;
}

export function getMainLocale(): AppLocale {
  return currentMainLocale;
}

export function getMainMessages() {
  return mainMessages[currentMainLocale];
}
