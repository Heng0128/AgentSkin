# AgentSkin 主题包规范 v2.1

本文档定义了 AgentSkin 主题包（Theme Package）的目录结构、manifest.json 字段规范、验证规则和最佳实践。

## 目录结构

```
themes/<theme-id>/
├── manifest.json          # 主题元数据（必需）
├── icon.png               # 主题图标，建议 256x256（必需）
├── preview.png            # 预览截图，建议 1280x800（必需）
├── assets/
│   ├── hero.webp          # Hero 背景图（可选，推荐）
│   ├── css/
│   │   ├── traework.css   # TRAE Work CN 专用 CSS
│   │   ├── qoderwork.css  # QoderWork CN 专用 CSS
│   │   ├── workbuddy.css  # WorkBuddy 专用 CSS
│   │   └── doubao.css     # 豆包 专用 CSS
│   ├── fonts/             # 自定义字体（可选）
│   │   └── custom.woff2
│   └── video/             # 视频壁纸（可选）
│       └── background.mp4
└── LICENSE                # 许可证文件（推荐）
```

## manifest.json 字段规范

### 必需字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 主题唯一标识，小写字母+数字+连字符，需与目录名一致 |
| `name` | string | 英文显示名称，1-64 字符 |
| `version` | string | 语义化版本号，如 `"2.2.0"` |
| `icon` | string | 图标文件相对路径，如 `"icon.png"` |
| `preview` | string | 预览图相对路径，如 `"preview.png"` |
| `colors` | object | 颜色令牌，至少包含 `background` 和 `foreground` |

### 推荐字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `schemaVersion` | number | 固定为 `2` |
| `$schema` | string | 指向 `https://agentskin.dev/schema/manifest-v2.json` |
| `displayName` | string | 本地化显示名，如 `"午夜极光"` |
| `description` | string | 主题描述，最多 500 字符 |
| `mode` | string | `"dark"` / `"light"` / `"auto"` |
| `hero` | string | Hero 背景图路径，如 `"assets/hero.webp"` |
| `author` | object | `{ "name": "...", "url": "..." }` |
| `category` | string | 分类：cyberpunk / minimal / anime / nature / retro / professional / creative |
| `tags` | string[] | 搜索标签，最多 10 个 |
| `license` | string | 许可证标识，如 `"MPL-2.0"` |
| `targets` | object | 各 Agent 的 CSS 路径 + 验证锚点 |
| `supportedAgents` | string[] | 支持的 Agent ID 列表 |

### v2.1 新增字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `dynamic` | string \| false | 动态效果：`"aurora"` / `"particles"` / `"gradient"` / `"waves"` / `false` |
| `wallpaper` | object | 视频壁纸配置（见下文） |
| `fonts` | object[] | 自定义字体配置（见下文） |
| `minAppVersion` | string | 最低 AgentSkin 版本要求，如 `"2.1.0"` |
| `homepage` | string | 主题主页 URL |
| `repository` | string | 源码仓库 URL |

### colors 颜色令牌

```json
{
  "accent": "#7C9CFF",
  "secondary": "#aabfff",
  "background": "#0a0a10",
  "foreground": "#e8eaf2",
  "muted": "#84858c",
  "surface": "#16161c",
  "surfaceElevated": "#232328",
  "border": "#7C9CFF2e",
  "codeBackground": "#07070a",
  "codeForeground": "#c9d0e1",
  "inputBackground": "#1f1f25",
  "buttonBackground": "#7C9CFF18",
  "buttonForeground": "#7C9CFF",
  "focusRing": "#7C9CFF60"
}
```

- `background` 和 `foreground` 为必需
- 其余为可选，缺失时由引擎自动推导
- 支持 6 位/8 位 HEX（含 alpha）

### wallpaper 视频壁纸配置

```json
{
  "video": "assets/video/background.mp4",
  "poster": "assets/video/poster.webp",
  "speed": 1.0,
  "loop": true,
  "scrimOpacity": 55
}
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `video` | string | 必需 | 视频文件路径（mp4/webm） |
| `poster` | string | - | 视频加载前的占位图 |
| `speed` | number | 1.0 | 播放速度倍率（0.1-3.0） |
| `loop` | boolean | true | 是否循环播放 |
| `scrimOpacity` | number | 55 | 遮罩不透明度 0-100，越高越清晰 |

### fonts 自定义字体配置

```json
[
  {
    "family": "Custom Sans",
    "src": "assets/fonts/custom-sans.woff2",
    "weight": 400,
    "style": "normal",
    "preload": true
  }
]
```

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `family` | string | 必需 | CSS font-family 名称 |
| `src` | string | 必需 | 字体文件路径（woff2/woff/ttf/otf） |
| `weight` | number/string | 400 | 字重 |
| `style` | string | "normal" | normal / italic / oblique |
| `preload` | boolean | false | 是否预加载 |

最多 5 个字体。

### targets 验证锚点

```json
{
  "traework": {
    "css": "assets/css/traework.css",
    "verification": {
      "required": [
        { "name": "solo-shell", "any": [".panel-container", ".solo-lite-layout"] }
      ],
      "recommended": [
        { "name": "task-sidebar", "any": [".task-list-base", ".task-list-panel"] }
      ]
    }
  }
}
```

- `required`：主题应用后必须存在的 DOM 选择器，缺失则判定注入失败
- `recommended`：建议存在的选择器，缺失仅产生警告

## 验证规则

ThemePackageLoader 在加载时执行以下验证：

1. `manifest.json` 存在且为合法 JSON
2. `id` 与目录名一致，匹配 `^[a-z0-9][a-z0-9_-]*$`
3. `name`、`version`、`icon`、`preview` 非空
4. `mode` 若存在必须为 dark/light/auto
5. `colors.background` 必须存在
6. `icon` 和 `preview` 文件必须存在
7. `hero` 若存在，文件必须存在且路径不逃逸包根目录
8. v2: `targets` 中每个 CSS 路径不逃逸包根目录
9. v2: `author.name` 在 author 存在时必需
10. v2: `tags` 必须为字符串数组
11. v2.1: `dynamic` 必须为 aurora/particles/gradient/waves/false
12. v2.1: `wallpaper.video` 必需，路径不逃逸，speed 0.1-3.0，scrimOpacity 0-100
13. v2.1: `fonts` 最多 5 个，每个需 family+src，路径不逃逸
14. v2.1: `minAppVersion` 必须匹配 semver 格式

## 完整示例

```json
{
  "$schema": "https://agentskin.dev/schema/manifest-v2.json",
  "schemaVersion": 2,
  "id": "midnight-aurora",
  "name": "Midnight Aurora",
  "displayName": "午夜极光",
  "version": "2.2.0",
  "description": "午夜天幕上的极光舞动，冰蓝光带划过深蓝夜空。",
  "author": {
    "name": "JarvisPMS",
    "url": "https://github.com/JarvisPMS/CoderStyle"
  },
  "mode": "dark",
  "icon": "icon.png",
  "preview": "preview.png",
  "hero": "assets/hero.webp",
  "dynamic": "aurora",
  "colors": {
    "accent": "#7C9CFF",
    "secondary": "#aabfff",
    "background": "#0a0a10",
    "foreground": "#e8eaf2",
    "muted": "#84858c",
    "surface": "#16161c",
    "surfaceElevated": "#232328",
    "border": "#7C9CFF2e",
    "codeBackground": "#07070a",
    "codeForeground": "#c9d0e1",
    "inputBackground": "#1f1f25",
    "buttonBackground": "#7C9CFF18",
    "buttonForeground": "#7C9CFF",
    "focusRing": "#7C9CFF60"
  },
  "targets": {
    "traework": {
      "css": "assets/css/traework.css",
      "verification": {
        "required": [{ "name": "solo-shell", "any": [".panel-container"] }],
        "recommended": [{ "name": "task-sidebar", "any": [".task-list-base"] }]
      }
    },
    "qoderwork": { "css": "assets/css/qoderwork.css" },
    "workbuddy": { "css": "assets/css/workbuddy.css" }
  },
  "supportedAgents": ["traework", "qoderwork", "workbuddy"],
  "category": "nature",
  "tags": ["dark", "nature", "blue", "aurora"],
  "license": "MPL-2.0",
  "unofficial": true,
  "minAppVersion": "2.1.0",
  "homepage": "https://agentskin.dev/themes/midnight-aurora",
  "repository": "https://github.com/JarvisPMS/CoderStyle"
}
```

## CSS 编写规范

每个 Agent 的 CSS 文件通过 `--agentskin-*` 统一令牌系统工作：

1. 主题 CSS 只覆写 14 个 `--agentskin-*` 令牌
2. 由 `generate-theme-css.mjs` 生成各 Agent 专用 CSS（traework → `--vscode-*`，qoderwork → `--color-*`，workbuddy → `--cb-*`，doubao → `--dbx-*`）
3. **永远不要手动编辑生成的 CSS 文件**，修改应在 manifest colors 或生成脚本中进行
4. 共享基础 CSS 在 `themes/_shared/<agent>.base.css`

### 豆包适配说明

豆包（Doubao）使用 `--dbx-*` 前缀的 251 个设计 token，通过 `:root[data-theme="dark"|"light"]` 切换主题。AgentSkin 的覆盖策略：

- 选择器 `html.codedrobe-host-doubao:root`（specificity 0,2,1）击败原生 `:root[data-theme]`（0,1,1）
- 只覆写语义层（bg/text/fill/line/code/brand），不触碰 neutral 色阶、static alpha 渐变、color-palette（red/orange/green/blue/purple/yellow）、radius、breakpoint、shadow 等结构性 token
- Art layer 挂载在 `body`（豆包无 React #root 容器）
- CDP 通过 `--remote-debugging-port=0` 随机端口开放，运行时自动发现

## 版本兼容性

- `schemaVersion: 1`：旧版格式，仅支持基础字段
- `schemaVersion: 2`：当前标准，支持 targets/author/category/tags
- v2.1 扩展（dynamic/wallpaper/fonts/minAppVersion）向后兼容，旧客户端忽略未知字段
- 使用新字段时建议设置 `minAppVersion` 防止旧客户端异常
