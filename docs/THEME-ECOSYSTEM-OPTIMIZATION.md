# AgentSkin 主题生态优化设计文档

> 版本: 1.0.0  
> 日期: 2026-07-21  
> 状态: 设计评审

---

## 1. 参考项目分析报告

### 1.1 AgentSkin Skills

**核心机制**: `.codedrobe-theme` 包格式，通过 CDP 注入可逆 CSS。

**关键设计决策**:
- **声明式包**: 主题包不包含 JavaScript，只声明 CSS 文件和验证锚点
- **适配器模式**: `codex` / `workbuddy` / `qoderwork` / `traework` 四个内置适配器
- **目标声明**: `targets.<adapterId>.css` 指定 CSS 文件
- **验证锚点**: `verification.required` + `verification.recommended` 定义 DOM 结构契约
- **上下文感知**: `contexts[].when` 条件匹配路由特定的 DOM 节点
- **最大 32 张命名图片**: `assets.images` 嵌入为 base64，CSS 变量 `--codedrobe-image-{name}` 暴露
- **Legacy 转换**: `codedrobe theme convert` 可将旧 `.codex-theme` 转为通用格式

**manifest 关键字段**:
```json
{
  "format": "codedrobe-theme",
  "schemaVersion": 1,
  "theme": { "id": "...", "displayName": "...", "version": "..." },
  "targets": { "workbuddy": { "css": "workbuddy.css" } },
  "assets": { "images": { "hero": { "filename": "preview.png", "base64": "..." } } }
}
```

### 1.2 Codex-Dream-Skin (Fei-Away)

**核心机制**: Windows/macOS 本地 CDP 注入，PowerShell 脚本驱动。

**关键设计决策**:
- **不修改官方安装目录**: 纯 CDP 注入，不改 `WindowsApps` / `app.asar`
- **配置持久化**: `%LOCALAPPDATA%\CodexDreamSkin\config.toml` 管理活跃主题和保存主题
- **托盘控制**: 应用内一键暂停/恢复/导入/保存/切换
- **图片尺寸限制**: 拒绝空或超过 16MB 的图片
- **UTF-8 严格配置**: `config.toml` 严格 UTF-8，不用编码相关的文件读写
- **端口探测**: 9335 被占用时扫描空闲端口

### 1.3 get-codex-theme (ViisOpen)

**核心机制**: 开源便携主题包标准，带 JSON Schema 验证。

**关键设计声明**:
- **Pack 格式**: `manifest.json` + `assets/` + `screenshots/` + `tokens/`
- **Manifest 必需字段**: `schemaVersion`, `id`, `name`, `description`, `version`, `mode`, `platforms`, `delivery`, `palette`, `layout`, `assets`, `license`, `unofficial`
- **调色板契约**: 必需 11 个 token（accent, background, foreground, muted, surface, surfaceElevated, border, codeBackground, codeForeground, inputBackground, buttonBackground, buttonForeground）
- **布局定位**: `focusX`, `focusY`, `overlayStrength`, `contentSide`
- **版本策略**: patch=压缩/小修复, minor=向后兼容设计添加, major=视觉/格式断裂

### 1.4 codex-styler (xuhuanstudio)

**核心机制**: Tauri 桌面编辑器 + 运行时注入，数据-only 包。

**关键设计决策**:
- **场景模型**: `layers[]`, `entities[]`, `renderer`, `behaviors` 替代 DOM 选择器
- **数据-only 包**: 仅本地栅格资产 + JSON，无脚本、无任意 CSS、无 SVG、无视频
- **包格式**: `.codex-styler-theme` = ZIP with `theme.json` + `LICENSES.json` + `assets/*.png` + `previews/*.`
- **伴侣系统**: 独立于主题的拖拽实体，指针感知
- **Composer 交互**: 替换原生配置控件

### 1.5 seeyouintokyo/codexskin

**核心机制**: macOS 专用 CDP 注入，轻量 SKILL.md 驱动。

**关键设计决策**:
- **平台限定**: 当前仅 macOS
- **六套主题**: 深海蓝、玫瑰粉、奶油淡黄、极光紫、熔岩红、翡翠绿
- **CDP 安全**: 127.0.0.1 环回，只接受 `app://` 目标

---

## 2. 重新设计的 `.agenttheme` 规范

### 2.1 目录结构

```
.theme-name/
├── manifest.json           # 主题元数据（必需）
├── preview.png             # 主题预览图（1280×720，PNG/JPEG/WebP）
├── icon.png                # 主题图标（64×64，PNG）
├── assets/
│   ├── background/         # 背景图（多比例适配）
│   │   ├── bg-16x10.png    # 默认比例
│   │   ├── bg-16x9.png     # 宽屏适配
│   │   └── bg-4x3.png      # 标准屏适配
│   ├── colors/             # 色板导出
│   │   ├── palette.json    # 语义色 token 导出
│   │   └── tailwind.css    # Tailwind CSS 变量导出
│   ├── css/                # 适配器特定 CSS
│   │   ├── base.css        # 通用基础样式
│   │   ├── traework.css    # TRAE Work CN/SOLO
│   │   ├── qoderwork.css   # Qoder Work CN
│   │   ├── qoder.css       # Qoder International
│   │   └── workbuddy.css   # WorkBuddy
│   └── metadata/           # 额外元数据
│       ├── license.txt     # 资产许可证
│       └── changelog.md    # 版本变更记录
└── README.md               # 主题说明（可选）
```

### 2.2 manifest.json Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://agentskin.dev/schema/manifest-v2.json",
  "title": "AgentSkin Theme Manifest v2",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "id",
    "name",
    "displayName",
    "version",
    "description",
    "author",
    "mode",
    "targets",
    "assets",
    "colors",
    "preview",
    "icon"
  ],
  "properties": {
    "$schema": {
      "type": "string",
      "format": "uri-reference"
    },
    "schemaVersion": {
      "const": 2,
      "description": "Manifest schema version. Fixed at 2 for this spec."
    },
    "id": {
      "type": "string",
      "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
      "minLength": 2,
      "maxLength": 64,
      "description": "Unique theme identifier. Lowercase kebab-case."
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80,
      "description": "Primary theme name (English)."
    },
    "displayName": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80,
      "description": "Localized display name. Used in UI."
    },
    "version": {
      "type": "string",
      "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$",
      "description": "Semantic version (SemVer 2.0)."
    },
    "description": {
      "type": "string",
      "minLength": 20,
      "maxLength": 500,
      "description": "Theme description. Bilingual encouraged."
    },
    "author": {
      "type": "object",
      "required": ["name"],
      "properties": {
        "name": { "type": "string", "minLength": 1, "maxLength": 80 },
        "email": { "type": "string", "format": "email" },
        "url": { "type": "string", "format": "uri" },
        "avatar": { "type": "string", "format": "uri" }
      },
      "additionalProperties": false
    },
    "mode": {
      "enum": ["dark", "light", "auto"],
      "description": "Color mode. 'auto' follows system appearance."
    },
    "targets": {
      "type": "object",
      "description": "Per-agent adapter configuration. Each agent can have its own CSS and verification anchors.",
      "additionalProperties": false,
      "patternProperties": {
        "^traework$|^qoderwork$|^qoder$|^workbuddy$|^codex$": {
          "type": "object",
          "required": ["css"],
          "properties": {
            "css": {
              "type": "string",
              "description": "Relative path to the CSS file for this agent."
            },
            "verification": {
              "type": "object",
              "properties": {
                "required": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["name"],
                    "properties": {
                      "name": { "type": "string" },
                      "any": {
                        "type": "array",
                        "items": { "type": "string" }
                      }
                    }
                  }
                },
                "recommended": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": ["name"],
                    "properties": {
                      "name": { "type": "string" },
                      "any": {
                        "type": "array",
                        "items": { "type": "string" }
                      }
                    }
                  }
                }
              }
            },
            "contexts": {
              "type": "array",
              "items": {
                "type": "object",
                "required": ["name", "when"],
                "properties": {
                  "name": { "type": "string" },
                  "when": {
                    "type": "object",
                    "properties": {
                      "any": {
                        "type": "array",
                        "items": { "type": "string" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    "assets": {
      "type": "object",
      "additionalProperties": false,
      "required": ["background"],
      "properties": {
        "background": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "default": { "type": "string" },
            "16x10": { "type": "string" },
            "16x9": { "type": "string" },
            "4x3": { "type": "string" },
            "fallback": { "type": "string" }
          }
        },
        "images": {
          "type": "object",
          "description": "Named images up to 32. Exposed as CSS variables.",
          "maxProperties": 32,
          "additionalProperties": {
            "type": "object",
            "required": ["filename"],
            "properties": {
              "filename": { "type": "string" },
              "mimeType": { "type": "string", "enum": ["image/png", "image/jpeg", "image/webp", "image/gif"] },
              "base64": { "type": "string" }
            }
          }
        }
      }
    },
    "colors": {
      "type": "object",
      "description": "Semantic color tokens. Subset of get-codex-theme palette.",
      "additionalProperties": false,
      "required": ["accent", "background", "foreground"],
      "properties": {
        "accent": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "secondary": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "success": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "warning": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "danger": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "focusRing": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "background": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "foreground": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "muted": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "surface": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "surfaceElevated": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "border": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "codeBackground": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "codeForeground": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "inputBackground": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "buttonBackground": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
        "buttonForeground": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" }
      }
    },
    "preview": {
      "type": "string",
      "description": "Filename of the preview screenshot (1280×720)."
    },
    "icon": {
      "type": "string",
      "description": "Filename of the theme icon (64×64)."
    },
    "category": {
      "type": "string",
      "enum": [
        "cyberpunk",
        "minimal",
        "anime",
        "nature",
        "professional",
        "retro",
        "gradient",
        "dark",
        "light",
        "custom"
      ],
      "description": "Theme category for filtering."
    },
    "tags": {
      "type": "array",
      "minItems": 1,
      "maxItems": 12,
      "uniqueItems": true,
      "items": {
        "type": "string",
        "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$"
      },
      "description": "Searchable tags."
    },
    "license": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80,
      "description": "SPDX license identifier or custom license name."
    },
    "homepage": {
      "type": "string",
      "format": "uri",
      "description": "Theme homepage URL."
    },
    "unofficial": {
      "type": "boolean",
      "const": true,
      "description": "Always true — this is an unofficial theme."
    }
  }
}
```

### 2.3 与现有规范的差异

| 字段 | 现有 manifest | 新 manifest | 说明 |
|------|--------------|-------------|------|
| `schemaVersion` | 无 | `2` (const) | 引入 schema 版本 |
| `displayName` | 无 | 必需 | 本地化显示名 |
| `author` | `string` | `object` | 支持 email/url/avatar |
| `targets` | 无 | 必需对象 | 按 Agent 声明 CSS |
| `colors` | `colors.primary` 等简单对象 | 完整语义调色板 | 11+ token |
| `category` | 无 | 枚举分类 | 用于过滤 |
| `tags` | 无 | 字符串数组 | 用于搜索 |
| `mode` | 有 | 增加 `auto` | 跟随系统 |
| `verification` | 无 | 可选锚点 | 注入验证 |
| `contexts` | 无 | 可选上下文 | 路由感知 |
| `images` | 无 | 最多 32 张命名图 | CSS 变量暴露 |

---

## 3. 主题兼容层设计

### 3.1 支持的 Agent 列表

| Agent ID | 全称 | 类型 | 平台 | 注入方式 |
|----------|------|------|------|----------|
| `traework` | TRAE Work CN | VS Code 衍生 | macOS, Windows | CDP `--remote-debugging-port` |
| `qoderwork` | QoderWork CN | VS Code 衍生 | macOS, Windows | CDP `--remote-debugging-port` |
| `qoder` | Qoder International | VS Code 衍生 | macOS, Windows, Web | 插件/IDE 集成 |
| `workbuddy` | Tencent WorkBuddy | Electron | macOS, Windows | CDP `--remote-debugging-port` |

### 3.2 兼容层架构

```
.agenttheme/
├── manifest.json           # 全局元数据
├── assets/
│   ├── css/
│   │   ├── base.css        # 通用基础样式（所有 Agent 共享）
│   │   ├── traework.css    # TRAE Work 专用覆盖
│   │   ├── qoderwork.css   # Qoder Work CN 专用覆盖
│   │   ├── qoder.css       # Qoder International 专用覆盖
│   │   └── workbuddy.css   # WorkBuddy 专用覆盖
│   └── background/         # 多比例背景
```

### 3.3 注入策略

```typescript
// src/adapters/registry.ts 扩展
export const ADAPTER_MAP: Record<AgentId, AdapterConfig> = {
  traework: {
    bundleId: {
      darwin: 'cn.trae.solo.app',
      win32: '{GUID}_is1'  // Inno Setup AppId
    },
    debugFlag: '--remote-debugging-port={PORT}',
    portDefault: 9335,
    portBehavior: 'random_free',  // TRAE 允许手动指定端口
    workbenchHtml: 'solo-lite/index.html',  // 非标准 Monaco workbench
    landmarkClasses: ['.solo-home', '.solo-workspace'],
  },
  qoderwork: {
    bundleId: {
      darwin: 'com.qoder.qoderwork',
      win32: 'QoderWork CN'
    },
    debugFlag: '--remote-debugging-port=0',  // 强制随机端口
    portBehavior: 'read_devtools_active_port',  // 从 DevToolsActivePort 读取
    workbenchHtml: 'workbench.html',
    landmarkClasses: ['.monaco-workbench', '.part.sidebar'],
  },
  qoder: {
    bundleId: {
      darwin: 'com.qoder.qoder',
      win32: 'Qoder'
    },
    debugFlag: '--remote-debugging-port=0',
    portBehavior: 'read_devtools_active_port',
    workbenchHtml: 'workbench.html',
    landmarkClasses: ['.monaco-workbench', '.editor-group-container'],
  },
  workbuddy: {
    bundleId: {
      darwin: 'com.tencent.workbuddy',
      win32: 'WorkBuddy'
    },
    debugFlag: '--remote-debugging-port={PORT}',
    portDefault: 9336,
    portBehavior: 'random_free',
    workbenchHtml: 'index.html',
    landmarkClasses: ['.wb-cb-chat', '.conversation-list'],
  },
};
```

### 3.4 适配资源优先级

当主题没有某个 Agent 的专用 CSS 时：

1. **精确匹配**: `assets/css/{agentId}.css` 存在 → 使用
2. **通用回退**: `assets/css/base.css` 存在 → 使用基础样式
3. **完全回退**: 两者都不存在 → 跳过该 Agent 主题注入（不影响其他 Agent）

### 3.5 风险点

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Agent 更新导致 DOM 类名变化 | 主题注入失效 | 验证锚点 + 回退 base.css |
| Windows Store 版应用无法启用 CDP | 无法注入 | 检测 + 友好提示 |
| Qoder International 未实际验证 | 兼容性未知 | 标记为 experimental |
| 多窗口弹出 | 部分窗口未应用 | 验证报告 skipped windows |

---

## 4. Theme Center 优化

### 4.1 现有问题分析

当前 `useThemeCenter.ts` 已有搜索、Agent 过滤、分类过滤和排序功能。但 `ThemeCenterCardModel` 缺少版本号信息。

### 4.2 优化方案

#### 4.2.1 扩展 `ThemeCenterCardModel`

```typescript
// src/ui/types/theme-center.ts
export interface ThemeCenterCardModel {
  id: string;
  name: string;
  preview: string | null;
  icon: string | null;
  author: string;
  version: string;            // 新增
  tags: string[];
  category: string;
  supportedAgents: AgentId[];
  installed: boolean;
  source: ThemeSource;
  mode: 'dark' | 'light' | 'auto';  // 新增
  description: string | null;     // 新增
}
```

#### 4.2.2 新增排序选项

```typescript
export type ThemeSortKey = 'name' | 'author' | 'category' | 'version' | 'dateAdded';
```

#### 4.2.3 新增筛选维度

```
分类筛选: 全部 / cyberpunk / minimal / anime / nature / professional / retro / gradient / dark / light / custom
模式筛选: 全部 / 深色 / 浅色 / 自动
Agent 筛选: 全部 / TRAE Work CN / Qoder Work CN / Qoder International / WorkBuddy
排序: 名称 ↑↓ / 作者 ↑↓ / 分类 ↑↓ / 版本 ↑↓ / 添加日期 ↑↓
搜索: 名称 + 标签模糊匹配
```

#### 4.2.4 预览增强

- **卡片预览**: 16:9 缩略图（preview.png）
- **大图预览**: 点击卡片打开 1280×720 全屏查看
- **多 Agent 预览**: 同一主题展示不同 Agent 下的效果
- **色板预览**: 显示主题调色板色块

### 4.3 UI 组件改动

| 组件 | 改动 | 说明 |
|------|------|------|
| `ThemesPage.tsx` | 添加版本列 | 卡片底部显示版本号 |
| `useThemeCenter.ts` | 新增 sortKey | 支持版本/日期排序 |
| `theme-center.ts` | 扩展 CardModel | 新增 version, mode, description |
| `detail_panel.tsx` | 增强详情面板 | 显示完整作者信息、许可证、变更日志 |

---

## 5. 中文体验保障

### 5.1 中文化原则

**保留不变的**:
- Agent 产品名称: `TRAE Work CN`, `Qoder Work CN`, `Qoder International`, `WorkBuddy`
- 品牌名称: `AgentSkin`, `Codex`, `TRAE`, `Qoder`
- 技术术语: `CDP`, `manifest.json`, `schemaVersion`, `base64`

**需要中文化的**:
- UI 标签: "Theme Center" → "主题中心"
- 按钮文本: "Install" → "安装", "Export" → "导出"
- 分类名称: "cyberpunk" → "赛博朋克", "minimal" → "极简"
- 状态文本: "Applied" → "已应用", "Requires Restart" → "需要重启"

### 5.2 分类映射表

| 英文分类 | 中文分类 |
|---------|---------|
| `cyberpunk` | 赛博朋克 |
| `minimal` | 极简 |
| `anime` | 动漫 |
| `nature` | 自然 |
| `professional` | 专业 |
| `retro` | 复古 |
| `gradient` | 渐变 |
| `dark` | 深色 |
| `light` | 浅色 |
| `custom` | 自定义 |

### 5.3 语言检测

```typescript
// src/shared/i18n.ts 扩展
export const CATEGORY_LABELS: Record<AppLocale, Record<string, string>> = {
  zh: {
    cyberpunk: '赛博朋克',
    minimal: '极简',
    anime: '动漫',
    nature: '自然',
    professional: '专业',
    retro: '复古',
    gradient: '渐变',
    dark: '深色',
    light: '浅色',
    custom: '自定义',
  },
  en: {
    cyberpunk: 'Cyberpunk',
    minimal: 'Minimal',
    anime: 'Anime',
    nature: 'Nature',
    professional: 'Professional',
    retro: 'Retro',
    gradient: 'Gradient',
    dark: 'Dark',
    light: 'Light',
    custom: 'Custom',
  },
};
```

---

## 6. 官方主题重新设计

### 6.1 Cyber Neon（赛博霓虹）

**设计理念**: 深邃暗黑画布 + 电光青/品红霓虹点缀，专为深夜 AI 编码会话打造。

**色板**:
| Token | 值 |
|-------|-----|
| accent | `#00ffff` (电光青) |
| secondary | `#ff00ff` (品红) |
| background | `#050816` (深空黑) |
| surface | `#0a0a12` (暗灰) |
| surfaceElevated | `#12121f` (悬浮面) |
| foreground | `#e0e8ff` (浅蓝白) |
| muted | `#5a6080` ( muted 文本) |
| border | `#1a1a2e` (边框) |
| codeBackground | `#0d0d1a` (代码块) |
| codeForeground | `#a0b0d0` (代码文本) |
| inputBackground | `#0f0f1e` (输入框) |
| buttonBackground | `#00ffff18` (按钮) |
| buttonForeground | `#00ffff` (按钮文本) |
| focusRing | `#00ffff60` (焦点) |

**背景图**: 深蓝黑色渐变 + 微弱网格线 + 霓虹光晕

### 6.2 Arctic White（北极白）

**设计理念**: 清爽白色表面 + 自信蓝色点缀，冷静无干扰的专业编码环境。

**色板**:
| Token | 值 |
|-------|-----|
| accent | `#2563eb` (皇家蓝) |
| secondary | `#0ea5e9` (天蓝) |
| background | `#ffffff` (纯白) |
| surface | `#f1f5f9` (冰灰) |
| surfaceElevated | `#e2e8f0` (悬浮灰) |
| foreground | `#0f172a` (深灰) |
| muted | `#64748b` (次要文本) |
| border | `#e2e8f0` (边框) |
| codeBackground | `#f8fafc` (代码块) |
| codeForeground | `#334155` (代码文本) |
| inputBackground | `#ffffff` (输入框) |
| buttonBackground | `#2563eb12` (按钮) |
| buttonForeground | `#2563eb` (按钮文本) |
| focusRing | `#2563eb40` (焦点) |

**背景图**: 纯白/极浅灰渐变 + 微妙冰川纹理

### 6.3 Sakura（樱花）

**设计理念**: 温柔粉紫渐变 + 日式樱花元素，适合创意编码和表达型工作空间。

**色板**:
| Token | 值 |
|-------|-----|
| accent | `#ec4899` (樱花粉) |
| secondary | `#a855f7` (薰衣草紫) |
| background | `#fff7fb` (樱花白) |
| surface | `#fdf2f8` (浅粉) |
| surfaceElevated | `#fce7f3` (悬浮粉) |
| foreground | `#1e1b4b` (深靛蓝) |
| muted | `#8b5cf6` (次要文本) |
| border | `#fce7f3` (边框) |
| codeBackground | `#faf5ff` (代码块) |
| codeForeground | `#4c1d95` (代码文本) |
| inputBackground | `#ffffff` (输入框) |
| buttonBackground | `#ec489912` (按钮) |
| buttonForeground | `#ec4899` (按钮文本) |
| focusRing | `#ec489940` (焦点) |

**背景图**: 粉紫渐变 + 飘落樱花粒子

### 6.4 图像生成要求

**禁止**: 1×1 占位图、纯色块、AI 生成的 UI 截图。

**必须**:
- `preview.png`: 1280×720，展示主题在 Agent 应用中的实际效果（含真实 UI 元素）
- `icon.png`: 64×64，主题标志图标
- `assets/background/bg-16x10.png`: 1920×1200，无缝背景
- `assets/background/bg-16x9.png`: 1920×1080，宽屏适配
- `assets/background/bg-4x3.png`: 1600×1200，标准屏适配

---

## 7. 验证测试计划

### 7.1 测试矩阵

| 测试项 | 步骤 | 预期结果 |
|--------|------|----------|
| **主题安装** | 1. 双击 `.agenttheme` 文件<br>2. 或拖入 Theme Center | 主题出现在 Theme Center 列表中 |
| **主题导入** | 1. File → Import Theme<br>2. 选择 ZIP 包 | 主题安装成功，icon/preview 正确加载 |
| **主题导出** | 1. 右键主题 → Export<br>2. 选择导出路径 | 生成 `.agenttheme` ZIP 包，包含完整 assets |
| **首次启动安装** | 1. 全新安装 AgentSkin<br>2. 首次启动 | 内置主题自动安装到 ThemeLibrary |
| **多 Agent 适配** | 1. 安装 Cyber Neon<br>2. 分别应用到 TRAE/Qoder/WorkBuddy | 三个 Agent 都正确应用对应 CSS |
| **主题切换** | 1. 应用主题 A<br>2. 切换到主题 B | 无残留样式，切换流畅 |
| **主题恢复** | 1. 应用主题<br>2. 点击 Restore | Agent 恢复默认外观 |
| **分类筛选** | 1. 选择 "赛博朋克" 分类 | 只显示 cyberpunk 类别主题 |
| **搜索** | 1. 输入 "neon" | 匹配名称和标签中包含 "neon" 的主题 |
| **版本排序** | 1. 按版本号降序 | 最新版本排在最前 |

### 7.2 回归测试

| 测试项 | 现有影响 | 风险评估 |
|--------|----------|----------|
| `ThemePackageLoader` | 需要更新验证逻辑 | 中 — 新增字段验证 |
| `ThemeInstaller` | 需要更新 bundle 构建 | 中 — 新增 targets 处理 |
| `ThemeLibrary` | 需要支持新 manifest 字段 | 低 — 向后兼容 |
| `useThemeCenter` | 需要支持新版本排序 | 低 — 扩展而非修改 |
| `ThemesPage` | 需要显示新版本信息 | 低 — UI 增强 |

---

## 8. 修改文件清单

### 8.1 新增文件

| 文件路径 | 说明 |
|---------|------|
| `docs/THEME-SPEC-V2.md` | 完整主题规范文档 |
| `src/main/catalog/manifest-schema.json` | JSON Schema 文件 |
| `src/main/catalog/theme-validator.ts` | manifest 验证器 |
| `themes/cyber-neon/assets/css/base.css` | 通用基础 CSS |
| `themes/cyber-neon/assets/css/traework.css` | TRAE 专用 CSS |
| `themes/cyber-neon/assets/css/qoderwork.css` | Qoder Work CN CSS |
| `themes/cyber-neon/assets/css/workbuddy.css` | WorkBuddy CSS |
| `themes/arctic-white/assets/css/` | Arctic White CSS 目录 |
| `themes/sakura/assets/css/` | Sakura CSS 目录 |

### 8.2 修改文件

| 文件路径 | 改动 |
|---------|------|
| `themes/*/manifest.json` | 升级到 schemaVersion 2，新增 targets/colors/category/tags |
| `src/main/catalog/theme-manifest.ts` | 扩展类型定义 |
| `src/main/catalog/theme-package-loader.ts` | 新增 schema 验证 |
| `src/main/catalog/theme-installer.ts` | 新增 per-agent CSS 处理 |
| `src/main/catalog/theme-seeder.ts` | 不变（兼容层） |
| `src/shared/types.ts` | 扩展 ThemeManifest，新增 category/tags/version |
| `src/ui/types/theme-center.ts` | 新增 version/mode/description 字段 |
| `src/ui/hooks/useThemeCenter.ts` | 新增版本/日期排序 |
| `src/ui/pages/ThemesPage.tsx` | 新增版本列、分类标签 |
| `src/ui/components/detail_panel.tsx` | 增强详情面板 |
| `src/shared/i18n.ts` | 新增分类映射表 |
| `src/adapters/registry.ts` | 新增适配资源优先级逻辑 |

### 8.3 删除文件

| 文件路径 | 原因 |
|---------|------|
| 无 | 向后兼容，不删除任何文件 |

---

## 9. 风险评估

| 风险 | 级别 | 说明 | 缓解措施 |
|------|------|------|----------|
| Schema v2 破坏性变更 | 高 | 旧 manifest v1 不再兼容 | 提供迁移工具 `theme-migrate --from v1 --to v2` |
| Agent DOM 结构变化 | 中 | 主题注入锚点失效 | 验证锚点 + base.css 回退 |
| 图片资源体积 | 中 | 多比例背景 + 32 张命名图 | 自动 WebP 转换 + 尺寸限制 |
| 首次启动性能 | 低 | 内置主题扫描 + 验证 | 异步扫描 + 缓存结果 |
| Windows Store 版 CDP | 中 | 无法启用调试端口 | 检测 + 友好提示 + 替代方案 |
| 多 Agent CSS 冲突 | 低 | 不同 Agent 的 CSS 变量名不同 | 每个 Agent 独立 CSS 文件 |

---

## 10. 主题包最终结构

```
my-awesome-theme.agenttheme (ZIP)
├── manifest.json                 # schemaVersion: 2
├── preview.png                   # 1280×720
├── icon.png                      # 64×64
├── assets/
│   ├── background/
│   │   ├── bg-16x10.png          # 1920×1200
│   │   ├── bg-16x9.png           # 1920×1080
│   │   └── bg-4x3.png            # 1600×1200
│   ├── colors/
│   │   ├── palette.json          # 导出色板
│   │   └── tailwind.css          # Tailwind 变量
│   ├── css/
│   │   ├── base.css              # 通用基础
│   │   ├── traework.css          # TRAE Work
│   │   ├── qoderwork.css         # Qoder CN
│   │   ├── qoder.css             # Qoder Intl
│   │   └── workbuddy.css         # WorkBuddy
│   └── metadata/
│       ├── license.txt           # 资产许可
│       └── changelog.md          # 版本变更
└── README.md                     # 主题说明（可选）
```

---

## 11. 实施路线图

### Phase 1: 规范定义（本周）
- [ ] 完成 manifest.json v2 Schema
- [ ] 编写 THEME-SPEC-V2.md 文档
- [ ] 实现 theme-validator.ts

### Phase 2: 兼容层（下周）
- [ ] 扩展 ADAPTER_MAP
- [ ] 实现 per-agent CSS 加载逻辑
- [ ] 验证 TRAE Work CN / Qoder CN 适配

### Phase 3: Theme Center 升级
- [ ] 扩展 ThemeCenterCardModel
- [ ] 新增版本/日期排序
- [ ] 分类映射表中文化

### Phase 4: 官方主题重制
- [ ] 生成 Cyber Neon 真实预览图
- [ ] 生成 Arctic White 真实预览图
- [ ] 生成 Sakura 真实预览图
- [ ] 为每个主题编写 per-agent CSS

### Phase 5: 验证测试
- [ ] 安装/导入/导出测试
- [ ] 首次启动安装测试
- [ ] 多 Agent 适配测试
- [ ] 回归测试

---

## 附录 A: 与参考项目的继承关系

| 特性 | AgentSkin v1 | get-codex-theme | codex-styler | AgentSkin v2 |
|------|-----------|-----------------|--------------|--------------|
| CDP 注入 | ✅ | ✅ | ✅ | ✅ |
| 可逆恢复 | ✅ | ✅ | ✅ | ✅ |
| 声明式包 | ✅ | ✅ | ✅ | ✅ |
| 多 Agent 支持 | ✅ | ❌ | ❌ | ✅ |
| 命名图片 | ✅ | ❌ | ❌ | ✅ |
| 验证锚点 | ✅ | ❌ | ❌ | ✅ |
| 语义调色板 | ❌ | ✅ | ❌ | ✅ |
| JSON Schema | ❌ | ✅ | ❌ | ✅ |
| 数据-only | ❌ | ❌ | ✅ | ✅ |
| 场景模型 | ❌ | ❌ | ✅ | ❌ |
| 伴侣系统 | ❌ | ❌ | ✅ | ❌ |

## 附录 B: 关键决策记录

1. **为什么保留 `schemaVersion: 2` 而不是 1?**
   - 避免与 get-codex-theme 的 schemaVersion 1 冲突
   - 引入 `targets` 对象结构是重大格式变更

2. **为什么 per-agent CSS 文件是可选的？**
   - 允许主题作者先只写 `base.css`，后续逐步适配
   - 不支持的 Agent 会自动跳过，不影响其他 Agent

3. **为什么保留现有 `themes/<id>/` 目录结构？**
   - 最小化迁移成本
   - `.agenttheme` ZIP 只是目录结构的打包形式
   - 开发时直接编辑目录，发布时打包

4. **为什么新增 `displayName` 字段？**
   - `name` 是技术标识（kebab-case）
   - `displayName` 是用户可见名称（支持中文/特殊字符）
