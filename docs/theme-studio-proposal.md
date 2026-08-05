# AgentSkin Theme Studio 改进方案

> 基于对 AgentSkin 现有 1800 行 ThemeStudioPage.tsx 的深度分析和 20+ GitHub 参考项目的调研，提出 Theme Studio 的完整重构方向。核心目标：从"8 维滑块 + 不联动"进化为"实时主题工作台 + 主题库/壁纸库双向联动"。

---

## 一、现有 Studio 快速诊断

### 1.1 已有能力（不需要推倒重来）

| 能力 | 状态 |
|------|------|
| CDP 抓取 Agent 真实 DOM 快照 | ✅ 完整 |
| DESIGN / RENDER / RAW 三视图预览 | ✅ 完整 |
| 8 维工具箱（色/形/字/动效/滤镜） | ✅ 完整 |
| DOM 节点检视器 + 伪状态 + 明暗变体 | ✅ 完整 |
| CDP Inspect 模式实时点选 PIN TO SNAPSHOT | ✅ 完整 |
| 导出 .agentskin-theme 包 | ✅ 完整 |
| 工程 CRUD + 快照持久化 | ✅ 完整 |
| 签名指纹 summary | ✅ 完整 |

### 1.2 主要问题

| 问题 | 现状 | 用户需求 |
|------|------|---------|
| **主题库联动** | Studio 只管新建，不能浏览/安装/修改已有主题 | 跟 Theme Marketplace 打通 |
| **壁纸库联动** | 不能从壁纸库选壁纸，也不能让壁纸驱动主题色 | 跟 Wallpaper Library 联动 |
| **跨资源组合** | 只能编辑颜色/间距等参数，不能一次性组合主题+壁纸+图标 | 多资源打包 |
| **Undo/Inspire** | 空壳按钮，没实现 | 需要撤销栈 + AI 灵感生成 |
| **预览真实性** | iframe srcDoc 渐变背景 mock，不是真实 UI | 要做真实 Agent UI 预览 |
| **UI 简陋** | 三栏 + Swiss 风格但控件重复、缺少可视化 | 需要更现代的编辑器体验 |
| **Studio 单文件 1800 行** | 耦合严重，不好维护 | 拆分为 hooks + 子组件 |

---

## 二、GitHub 参考项目核心借鉴

### 2.1 界面参考：tweakcn (7.2k★) — 实时主题编辑器

**布局**：左预设面板 + 中间实时预览 + 右导出面板  
**核心模式**：
- 编辑 -> CSS Variables -> 即时预览
- 预设系统 + 自定义微调双层
- OKLCH 颜色空间

**AgentSkin 参考**：把三栏（左项目+中预览+右工具）改为 **四栏（新增：顶部标签切换：THEME / WALLPAPER / COMBINE）**

### 2.2 Token 参考：Tokens Studio for Figma + catppuccin (19k★)

**Token 树结构**：
```
primitive/              ← 原子值（hex / size / duration）
  color.base.blue.500 = #4c8ff
semantic/               ← 语义映射
  color.accent = {color.base.blue.500}
  color.bg = {color.base.gray.950}
component/              ← 组件绑定
  button.bg = {color.accent}
  button.radius = {space.2}
```

**引用机制**：tokens 可以用 `{path.to.token}` 引用  
**多 set 切换**：base / light / dark / brand 多 set 并行

**AgentSkin 参考**：把主题色板提升为"三层 token"而不是现在 14 个打平变量

### 2.3 联动参考：pywal (9.1k★) — 壁纸驱动主题

**核心模式**：
```
壁纸图片 → 颜色量化算法 → 16 色调色板
→ 广播到 terminal / polybar / rofi / Firefox / VS Code
```

**AgentSkin 参考**：
```
用户选壁纸（整个画面或 URL）
→ 提取主色 + 辅助色
→ 自动派生主题色板
→ 实时预览在 Agent 界面上
→ 用户可保存为主题工程
```

这就是"壁纸库 -> 主题库"联动的核心算法。

### 2.4 资产组合参考：KDE Plasma Global Theme + Rainmeter

**KDE Global Theme**：一个 `.tar.gz` bundle 内含：
```
wallpaper/           ← 壁纸
icons/               ← 图标主题
.cursor-theme        ← 光标
colors/              ← 配色
plasma-theme/        ← Plasma 面板布局
                 → 一键安装 → 全部应用
```

**Rainmeter Layout**：
```
Layout = 5 个皮肤组件（时钟 + CPU + 天气 + 音乐 + 笔记）
     每个皮肤有自己的 .ini + 图片
     → 一键切换整个桌面风格
```

**AgentSkin 参考**：建立"组合包"概念：

```
Skin Bundle = 1 Theme + 1 Wallpaper + (可选) Icon Pack + (可选) Wallpaper preset
           -> 一键安装 -> 全部应用到 Agent + 桌面
```

### 2.5 资产编辑器参考：Blockbench (5.4k★) + Spicetify Marketplace

**Blockbench** 模式：左侧资源库 + 中间 3D 视口 + 右侧属性面板 + 底部时间轴

**Spicetify Marketplace** 模式：在 Spotify 客户端内嵌侧边栏标签页
```
Marketplace Tab 显示：
  Themes Library     ← 主题列表（按颜色/风格分类）
  Extensions Library ← 插件列表
  Apps Library       ← 第三方应用
  → 点击安装 → 自动应用
```

**AgentSkin 参考**：在 Theme Studio 中新增"资源市场"标签页：

```
Studio 标签页：
  PROPERTIES    ← 当前的 8 维编辑
  THEME STORE  ← 已安装 + 在线预览主题
  WALLPAPERS   ← 壁纸库 + 从壁纸派生主题
  BUNDLES      ← 组合包管理
  INSPECT      ← 元素检视器
```

---

## 三、新界面设计

### 3.1 四标签布局

```
+---------------------------------------------------------------------------+
| THEME STUDIO                                    [Theme] [Wallpaper] [Bundle] [Inspect] |
+------------+--------------------------------------------------------------+
|            |                                                              |
| RESOURCE   |                     MAIN WORKAREA                            |
| PANLE      |                                                              |
|            |   Tab = THEME:        Tab = WALLPAPER:       Tab = BUNDLE: |
| PROJECTS   |   +----------------+  +------------------+  +-------------+ |
| --------   |   | Theme Editor   |  | Wallpaper Preview|  | Bundle      | |
| My Dark    |   |                |  |                  |  | Manager     | |
| My Light   |   | Colors         |  | [从壁纸生成主题] |  |             |
| Naruto     |   | Spacing        |  |                  |  | Theme: My   |
| Work Theme |   | Typography     |  | Extract Palette: |  | Wallpaper: X|
|            |   | Glass          |  |  ██ ██ ██ ██     |  | Icons:    Y |
| + New      |   | Preview        |  |  ██ ██ ██ ██     |  | [导出 .skin]|
| + Import   |   |                |  |                  |  |             |
|            |   +----------------+  +------------------+  +-------------+ |
| THEMES     |                                                              |
| --------   |   REAL-TIME PREVIEW (右侧 560px，连接任意 Agent 窗口)     |
| + Browse   |   +------------------------------------------------------+   |
| + Install  |   |                                                      |   |
| Wallpapers |   |   Agent UI + Theme Real-time                          |   |
| + Featured |   |                                                      |   |
| + Local    |   |                                                      |   |
|            |   +------------------------------------------------------+   |
+------------+--------------------------------------------------------------+
```

### 3.2 四大核心标签页

#### Tab 1: Theme Properties（重构现有 8 维面板）

```
左: 项目列表 + 资源浏览器
中: Theme Editor Tokens（替代现有 8 维滑块）

Tabs 细分:
  ┌--------------------------------------------------┐
  │ [Colors] [Spacing] [Typography] [Glass] [Effects]│
  └--------------------------------------------------┘
  
Colors Tab:
  ┌─ Primitive (色相) ─┐  ┌─ Semantic (语义) ────────┐
  │ ■ Brand/Blue       │  │ Accent  = {brand}        │
  │ ■ Brand/Purple     │  │ BG      = {gray.950}     │
  │ ■ Gray/50...950    │  │ Surface = {gray.800}     │
  │ ■ Semantic/Green   │  │ Text    = {gray.100}     │
  │ ■ Semantic/Red     │  │ Muted   = {gray.400}     │
  └────────────────────┘  └──────────────────────────┘

Glass Tab:
  ┌─ Blur ─────────┐  ┌─ Tint ──────────┐  ┌─ Effects ──┐
  │ SM ████████ 8px │  │ SM ██████░░ 45% │  │ ☑ Noise    │
  │ MD █████████ 16 │  │ MD ████░░░░ 15% │  │ ☑ Border   │
  │ LG ██████████ 24│  │ LG ████████ 72% │  │ ☑ Glow     │
  └────────────────┘  └─────────────────┘  └────────────┘

右: Agent 实时预览（CDP iframe）

关键改造：
- 原有 8 维"平铺"改为"分组 Tab"
- 颜色改为"Primitive/Semantic 双层"（借鉴 Tokens Studio）
- Glass Tab 单独列出（当前 blur 混在 Effects Tab）
- Undo 实现（Ctrl+Z）— 当前是空壳
- Inspire 按钮接入 AI 灵感生成
```

#### Tab 2: Wallpaper（新增）

```
┌---------------------------------------------------------------------┐
│ WALLPAPER LIBRARY                              [从壁纸生成主题]     │
├---------------------------------------------------------------------┤
│                                                                     │
│  Filter: [All ▾] [Video] [Image] [Web] [Preset]                    │
│                                                                     │
│  +------+  +------+  +------+  +------+  +------+                    │
│  |      |  |      |  |      |  |      |  |      |                    │
│  |  1   |  |  2   |  |  3   |  |  4   |  |  5   |  ← Grid View     │
│  |      |  |      |  |      |  |      |  |      |                    │
│  +------+  +------+  +------+  +------+  +------+                    │
│  +------+  +------+  +------+  +------+  +------+                    │
│  |      |  |      |  |      |  |      |  |      |                    │
│  |  6   |  |  7   |  |  8   |  |  9   |  | 10   |                    │
│  |      |  |      |  |      |  |      |  |      |                    │
│  +------+  +------+  +------+  +------+  +------+                    │
│                                                                     │
├---------------------------------------------------------------------┤
│ 壁纸详情面板:                                                        │
│                                                                      │
│ +--------------------+  名称: 星空                                    │
│ |                    |  类型: 视频                                     │
│ |                    |  分辨率: 2560x1440                             │
│ |     缩略图         |  大小: 12MB                                    │
│ |                    |  源: Wallpaper Engine Workshop                 │
│ |                    |                                               │
│ +--------------------+  [提取主色] [应用到 Agent] [设为主题背景]        │
│                         +----------------+                           │
│                         │ █ █ █ █ █     │  ← 提取的 5 色调色板       │
│                         │ █ █ █ █ █     │                           │
│                         +----------------+                           │
│                         [基于此配色生成主题]                           │
└---------------------------------------------------------------------┘
```

**从壁纸提取主色驱动主题的流程**：

```
用户选中壁纸
→ 浏览器内 canvas 绘制图片
→ 颜色量化算法（MMCQ / K-Means）
→ 提取 5-16 主色
→ 智能映射：主色 → accent, 灰阶 → bg/surface/text
→ 自动生成临时主题工程
→ 左侧显示"从壁纸生成的主题"草稿
→ 用户可在 8 维面板微调 + 保存为正式主题
```

#### Tab 3: Bundle（组合管理）

```
┌---------------------------------------------------------------------┐
│ SKIN BUNDLES                                          [新建组合]     │
├---------------------------------------------------------------------┤
│                                                                     │
│ +-- Work Mode Bundle ---------------------------------------------+ │
│ |  Theme:   [Midnight Agent    ▾]                                | │
│ |  Wallpaper: [Stars Field     ▾]   [预览]                        | │
│ |  Icon Pack: [Default          ▾]                                | │
│ |                                                              | │
│ |  效果预览:                                                     | │
│ |  ┌────────────────────────────────────────────────-----+      | │
│ |  | (缩略图)  Midnight Theme + Stars Wallpaper           |      | │
│ |  |           + Default Icons                            |      | │
│ |  +------------------------------------------------------+      | │
│ |                                                              | │
│ |  [安装整套] [导出 .agentskin-bundle] [卸载]                    | │
│ +--------------------------------------------------------------+ │
│                                                                     │
│ +-- Play Mode Bundle ---------------------------------------------+ │
│ |  Theme:   [Sakura Chat       ▾]                                | │
│ |  Wallpaper: [Sakura Motion   ▾]                                | │
│ |  ...                                                          | │
│ +--------------------------------------------------------------+ │
│                                                                     │
└---------------------------------------------------------------------┘
```

#### Tab 4: Inspect（增强现有）

保留现有的 CDP Inspect 模式，增加：
- 从 DOM 节点直接"设为 color-accent"
- 右键菜单：智能推荐搭配颜色
- 历史操作记录 + Undo

---

## 四、核心新能力的实现路径

### 4.1 主题库联动

```
当前: Studio 只能新建工程，不与已安装主题交互

改造路径:
  ┌─────────────────────────────────────────────────────┐
  │ 1. Studio 左侧面板新增"Themes"资源分类               │
  │ 2. 读取已安装主题列表: themes/*/manifest.json        │
  │ 3. 每个主题显示: 缩略图 + 调色板色块 + 名称版本       │
  │ 4. 点击主题 → 加载到编辑器调色板（只读/编辑副本）      │
  │ 5. 点击"基于此主题新建" → 创建工程 + 导入当前调色板   │
  │ 6. 修改保存时 → 回到 Studio Theme Tab                │
  │ 7. Settings → Themes 与 Studio 双向同步              │
  └─────────────────────────────────────────────────────┘
```

**代码层面**：共用现有的 `theme-library.ts` API（`listThemes / installTheme / removeTheme`）

### 4.2 壁纸库联动

```
改造路径:
  ┌─────────────────────────────────────────────────────┐
  │ 1. Studio 新增 Wallpaper Tab                         │
  │ 2. 与现有 WallpaperEnginePage 共享 wallpaper-server  │
  │ 3. 读取 wallpaper library + 本地 wallpapers 列表      │
  │ 4. 缩略图网格浏览                                     │
  │ 5. 选中壁纸 → canvas 绘制 → 提取主色                  │
  │ 6. 主色 → 通过 token mapper → 生成 agentskin 调色板   │
  │ 7. 在 Theme Editor 创建副本工程                       │
  │ 8. 用户可进一步微调                                   │
  └─────────────────────────────────────────────────────┘
```

**颜色量化算法（参考 pywal）**：
```javascript
// 提取 16 主色
function extractPalette(imageData) {
  // 方法1:MMCQ（中位切割量化）- pywal 采用
  // 方法2:K-Means 聚类
  // 方法3:简单颜色频率排序（performance fallback）
  
  // 输出: 16 个 hex 字符串数组
  // ['#0a0c10', '#141820', '#1c2230', ...]
  
  // 智能映射（基于亮度分类）
  const sorted = palette.sort(byLuminance);
  return {
    bg: sorted[0],           // 最深
    surface: sorted[2],
    text: sorted[15],        // 最亮
    accent: mostSaturated(palette),  // 最鲜艳
  };
}
```

### 4.3 Bundle 组合包

**新文件格式 `.agentskin-bundle`**：

```
skin-bundle/
  manifest.json            ← Bundle 元数据
  theme/                   ← 完整主题包（复用现有结构）
    manifest.json
    palette.css
    assets/
  wallpaper/               ← 壁纸资源
    thumbnail.jpg
    source.{mp4/webp/html}
  icons/                   ← 可选图标包
    ...
  preview.png              ← Bundle 整体预览
```

**manifest.json**：
```jsonc
{
  "schemaVersion": 1,
  "id": "midnight-coder-bundle",
  "name": "Midnight Coder",
  "version": "1.0.0",
  "theme": "theme/",
  "wallpaper": {
    "file": "wallpaper/source.mp4",
    "thumbnail": "wallpaper/thumbnail.jpg",
    "type": "video",
    "recommendedMode": "dark"
  },
  "icons": "icons/",           // optional
  "tags": ["dark", "coding", "starry"]
}
```

### 4.4 Undo 系统

**当前**：按钮占位，无 reducer  
**改造**：在 ThemeStudioPage 上封装 `useReducer`

```typescript
type EditorState = {
  palette: Record<string, string>;
  overrides: Overrides;
  history: Array<{ palette; overrides }>;
  historyIndex: number;
};

type EditorAction =
  | { type: 'SET_COLOR'; key: string; value: string }
  | { type: 'SET_OVERRIDE'; key: keyof Overrides; value: any }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'JUMP_TO_SNAPSHOT' };  // 跳回快照状态

// useReducer 维护 history stack（最多 50 步）
// Ctrl+Z / Ctrl+Shift+Z 绑定
```

### 4.5 Inspire（AI 灵感生成）

```
可选方案:
  1. 本地算法: 基于当前 accent + 配色理论（互补色/类似色/分裂互补）生成 5 套变体
  2. 云端 AI: 调 GPT-4 / DALL-E 生成配色推荐（需联网）
  3. 社区灵感: 从 Marketplace 下载"配色灵感包"
  
最小 MVP:
  - 用户点击 Inspire
  - 基于当前 hue 旋转 30°/60°/120° 生成 3 套互补色变体
  - 应用 → 用户可 Undo
```

---

## 五、代码拆分重构

### 5.1 现状：1800 行单文件

```
ThemeStudioPage.tsx (1800+ 行)
  ├── 状态管理 (15+ useState)
  ├── 快照/基线/导出业务逻辑
  ├── 全部布局 JSX（含内联样式）
  ├── CascadeView 子组件 (~100 行)
  ├── ...
```

### 5.2 目标结构

```
src/ui/pages/
  ThemeStudioPage.tsx          ← 600 行：布局 + Tabs 路由 + 组合 hooks
  studio/
    ThemeEditor.tsx            ← 主题 Tab：引用 TokenEditor + LivePreview
    WallpaperLibrary.tsx       ← 壁纸 Tab：Grid + 提取 + 应用到编辑器
    BundleManager.tsx          ← Bundle Tab：创建 + 导出 + 安装
    InspectPanel.tsx           ← Inspect Tab（已有能力封装）

src/ui/components/studio/
  TokenEditor/
    ColorTokens.tsx            ← Primitive + Semantic 双层编辑
    GlassTokens.tsx            ← Blur/Tint/Noise 三级
    SpacingTokens.tsx          ← 间距系统
    TypographyTokens.tsx       ← 字体系统
    EffectTokens.tsx           ← 阴影/滤镜
  LivePreview/
    AgentPreview.tsx           ← CDP iframe 实时预览（增强现有 RealDomPreview）
    BundlePreview.tsx          ← 组合包看板预览
  Inspector/
    DomInspector.tsx           ← DOM 节点检视器
    CascadeView.tsx            ← 级联规则面板
  Library/
    ThemeGrid.tsx              ← 主题缩略图网格
    WallpaperGrid.tsx          ← 壁纸缩略图网格
    PaletteSwatches.tsx        ← 调色板色块

src/ui/hooks/studio/
  useStudioEditor.ts           ← 编辑器状态 + reducer + undo
  useThemeLibrary.ts           ← 已安装主题列表 + CRUD
  useWallpaperLibrary.ts       ← 壁纸库浏览 + 提取
  useBundleManager.ts          ← 组合包管理
  useLivePreview.ts            ← CDP iframe 通信
```

---

## 六、分阶段实施路线

### Phase A: 当前 -> 第一周（架构重构 + Undo）

```
目标: 把 1800 行拆分成可维护结构，实现 Undo/Redo

任务:
  ✅ 新增 useStudioEditor reducer (取代 15+ useState)
  ✅ 提取 hooks: useStudioSnapshot / useToolboxOverrides / useHistory
  ✅ 实现 Undo/Redo 功能 (history stack + 快捷键)
  ✅ 拆分 ThemeEditor / TokenEditor / LivePreview 组件
  ✅ StudioColorSets 推导逻辑提取为 hooks

验收:
  - ThemeStudioPage 缩减到 <600 行
  - Ctrl+Z / Ctrl+Y 正常工作
  - 现有 CDP 预览、快照、检视功能不受影响
```

### Phase B: 第 2-3 周（主题库联动）

```
目标: Studio 能浏览、安装、编辑已安装主题

任务:
  ✅ Studio 左侧面板新增"Themes"分类
  ✅ 读取+显示已安装主题列表 (名称 + 缩略图 + 调色板色块)
  ✅ 点击加载到编辑器（副本模式）
  ✅ "基于此主题新建工程" 按钮
  ✅ 导出/覆盖保存

验收:
  - 从 Studio 可直接跳回 Settings → Themes
  - 双向同步
```

### Phase C: 第 4-5 周（壁纸库联动）

```
目标: Studio 能浏览壁纸库 + 从壁纸提取主色驱动主题

任务:
  ✅ Studio 新增"Wallpapers" Tab
  ✅ 与现有 WallpaperEnginePage 共享 wallpaper-server API
  ✅ 缩略图网格浏览
  ✅ 选中壁纸 -> canvas -> 提取 5-16 主色
  ✅ 主色智能映射 -> agentskin 调色板
  ✅ 生成临时主题工程 + 自动跳转到 Theme Editor Tab

验收:
  - 选一个星空壁纸 -> 自动生成深蓝暗色主题
  - 选一个樱花壁纸 -> 自动生成粉色亮色主题
```

### Phase D: 第 6-7 周（Bundle 组合包）

```
目标: 一次性安装"主题+壁纸+图标"套装

任务:
  ✅ 新增"组合包"Tab
  ✅ Bundle manifest schema 定义
  ✅ 创建 Bundle 向导（选择 Theme + Wallpaper + Icons）
  ✅ Bundle 一键安装（应用到 Agent + 设置壁纸）
  ✅ Bundle 导出 (.agentskin-bundle zip)
  ✅ Bundle 市场在线预览

验收:
  - 用户安装一个 Bundle = 同时改变了主题 + 壁纸
  - 在线 Bundle 商店可浏览
```

### Phase E: 第 8 周（Polish + Inspire）

```
目标: 体验打磨 + AI 灵感生成

任务:
  ✅ Inspire 按钮本地版: 基于配色理论生成变体
  ✅ 实时预览增强（支持明暗切换）
  ✅ 性能优化（iframe 重建 -> patch）
  ✅ 错误边界 + 降级 UI
  ✅ Help / Documentation 面板
```

---

## 七、Bundle 格式规范

### 7.1 文件结构

```
my-bundle.agentskin-bundle           ← 实际是 zip 解压后的目录
├── manifest.json                    ← Bundle 元数据
├── theme/                           ← 完整主题目录
│   ├── manifest.json
│   ├── icon.png
│   ├── preview.png
│   ├── palette.css
│   └── assets/
│       ├── hero.webp
│       └── css/
│           ├── workbuddy.css
│           ├── ...
├── wallpaper/                       ← 壁纸资源
│   ├── poster.jpg
│   ├── source.{mp4,webp,html,gif}
│   └── metadata.json
└── icons/                           ← 可选图标包
    └── ...
```

### 7.2 manifest.json 格式

```jsonc
{
  "schemaVersion": "1.0",
  "type": "agentskin-bundle",
  "id": "midnight-coder-bundle",
  "name": "Midnight Coder",
  "version": "1.0.0",
  "author": { "name": "...", "url": "..." },
  "description": "深色编程主题 + 星空动态壁纸 + 深色图标组合",
  "category": "workspace-skin",
  "tags": ["dark", "coding", "stars", "ambient"],
  
  "theme": {
    "path": "theme/",
    "recommendedMode": "dark"
  },
  
  "wallpaper": {
    "path": "wallpaper/source.mp4",
    "poster": "wallpaper/poster.jpg",
    "type": "video",
    "loop": true,
    "speed": 1.0,
    "audio": false,
    "fillMode": "cover"
  },
  
  "icons": {
    "path": "icons/",
    "format": "svg"                // svg / png / icns
  },
  
  "screenshots": [
    "screenshots/overview.png",
    "screenshots/agent-ui.png",
    "screenshots/desktop.png"
  ],
  
  "minAppVersion": "1.2.0"
}
```

### 7.3 安装流程

```
用户安装 Bundle:
  1. 解压 Bundle 到 %APPDATA%/AgentSkin/bundles/<id>/
  2. 安装 Theme -> 调用 theme-installer (复制到 themes/<theme-id>/)
  3. 安装 Wallpaper -> 调用 wallpaper-service (保存到库)
  4. 安装 Icons -> 调用 icon-service (复制到 icons/<pack-id>/)
  5. 标记 Bundle 为"已安装"
  6. 可选：自动切换到该主题 + 设置桌面壁纸
```

---

## 八、总结：从 Studio 进化为 Workbench

| 进化维度 | 当前 | 目标 |
|---------|------|------|
| **资源覆盖** | 仅调色板 | Theme + Wallpaper + Icons |
| **交互深度** | 8 维滑块 | Tokens + 实时预览 + 真实 UI |
| **库联动** | 无 | 主题库 + 壁纸库 + 组合包 |
| **Undo** | 空壳 | History Stack + 50 步 |
| **Inspire** | 空壳 | 本地配色理论 + 云端 AI |
| **产出物** | .agentskin-theme | .agentskin-bundle |
| **UI 风格** | Swiss + 简陋 | Swiss + Professional + 可视化 |
| **扩展性** | 闭合 | 插件 + Marketplace |

---

*文档版本: v1.0 | 创建日期: 2026-08-05 | 配套代码: ThemeStudioPage.tsx / Toolbox.tsx / RealDomPreview.tsx / studio-ipc.ts*

---

## 九、可执行实施方案 — 文件级改造清单

> 本节将第六部分的分阶段实施路线落地为具体的文件新增 / 修改清单，配合代码示例与验证标准，确保每个 Phase 可独立交付、可回滚。

---

### 9.1 准备阶段 — 必须优先克隆的项目

在动代码之前，先把以下四个参考项目 clone 到本地，重点阅读其核心实现。按优先级排序：

| 优先级 | 项目 | GitHub 地址 | Stars | 核心借鉴点 | 阅读重点 |
|--------|------|-------------|-------|-----------|---------|
| 🥇 | **tweakcn** | `https://github.com/jrvcalderon/tweakcn` | 7.2k★ | 实时主题编辑器 + OKLCH 颜色空间 + 预设系统 | `src/hooks/useThemeGenerator.ts`（编辑 → CSS Variables → 预览的 reducer 模式） |
| 🥈 | **pywal** | `https://github.com/dylanaraps/pywal` | 9.1k★ | 壁纸驱动主题 + MMCQ 颜色量化算法 | `pywal/backends/`（调色板提取）+ `pywal/export.py`（多目标广播） |
| 🥉 | **KDE/plasma-framework** | `https://github.com/KDE/plasma-framework` | — | Global Theme 组合包格式 + Plasma Package 结构 | `src/plasma/package.cpp`（package 目录约定） |
| 🏅 | **Figma Tokens Studio** | `https://github.com/tokens-studio/figma-plugin` | — | Token 树 + 引用机制 + 多 set 切换 | `src/storage/`（token 存储模型）+ `src/utils/token.ts`（引用解析） |

**推荐阅读顺序**：tweakcn（先把 reducer 模式看明白）→ pywal（理解颜色量化流水线）→ KDE（理解 bundle 物理结构）→ Tokens Studio（理解 token 引用链）。

---

### 9.2 新增 npm 依赖

以下依赖在对应 Phase 开始时安装，不使用 transpiler/bundler 类依赖，优先选择纯 ESM、零依赖、包体小的库。

```bash
# Phase A — 状态管理 + Undo
npm install immer                    # reducer 不可变更新，~6KB gzip

# Phase B — 主题库联动（无需新依赖，复用现有 catalog API）

# Phase C — 颜色量化
npm install @anthropic-ai/color-quantize   # MMCQ 算法，纯 JS 实现
# 或者更轻量的替代:
npm install fast-colors              # 1.8KB gzip，含多种量化策略

# Phase D — Bundle ZIP 处理（Node 内置 AdmZip 替代，无需新依赖）

# Phase E — 配色理论
# （纯函数 + hsl 转换，无需新依赖；可选）
npm install chroma-js               # 颜色操作工具，~12KB gzip;
                                    # 如果包体敏感，自己写 hsl→hex 转换函数即可
```

**安装验证**：

```bash
npm list immer fast-colors chroma-js 2>&1 | cat
```

---

### 9.3 文件修改清单 — 按 Phase A-E

#### Phase A: 架构拆分的具体文件变化（Week 1）

> 目标：1800 行单文件拆分为 hooks + 子组件，实现 Undo/Redo。

| 操作 | 文件路径 | 预估行数 | 说明 |
|------|----------|---------|------|
| 新建 | `src/ui/pages/studio/ThemeEditor.tsx` | ~300 | 从 ThemeStudioPage.tsx 提取：Theme Tab 主体，包含 TokenEditor + LivePreview 组合 |
| 新建 | `src/ui/pages/studio/WallpaperLibrary.tsx` | ~200 | 右侧面板，空壳占位（Phase C 填充） |
| 新建 | `src/ui/pages/studio/BundleManager.tsx` | ~180 | Bundle Tab，空壳占位（Phase D 填充） |
| 新建 | `src/ui/hooks/studio/useStudioEditor.ts` | ~250 | reducer 替代 15+ useState，维护 palette/overrides |
| 新建 | `src/ui/hooks/studio/useStudioHistory.ts` | ~100 | Undo/Redo history stack，最大 50 步 |
| 新建 | `src/ui/hooks/studio/useLivePreview.ts` | ~120 | CDP iframe 通信封装 |
| **修改** | `src/ui/pages/ThemeStudioPage.tsx` | <600 | 缩减为路由 + 顶层布局 + Tab 切换；删除所有内联业务逻辑 |

**Phase A 完成后 ThemeStudioPage.tsx 骨架**：

```tsx
// ThemeStudioPage.tsx (重构后 ~550 折)
import { useState } from 'react';
import { ThemeEditor } from './studio/ThemeEditor';
import { WallpaperLibrary } from './studio/WallpaperLibrary';
import { BundleManager } from './studio/BundleManager';
import { useStudioEditor } from '../hooks/studio/useStudioEditor';
import { useStudioHistory } from '../hooks/studio/useStudioHistory';
import { useLivePreview } from '../hooks/studio/useLivePreview';

type StudioTab = 'theme' | 'wallpaper' | 'bundle' | 'inspect';

export function ThemeStudioPage() {
  const [activeTab, setActiveTab] = useState<StudioTab>('theme');
  const editor = useStudioEditor();
  const history = useStudioHistory(editor);
  const preview = useLivePreview(editor.state.palette);

  return (
    <div className="studio-layout studio-theme-dark">
      <StudioHeader activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="studio-body">
        <ResourceSidebar editor={editor} />
        <main className="studio-workspace">
          {activeTab === 'theme'    && <ThemeEditor editor={editor} history={history} preview={preview} />}
          {activeTab === 'wallpaper' && <WallpaperLibrary />}
          {activeTab === 'bundle'   && <BundleManager />}
          {activeTab === 'inspect'  && <InspectPanel />}
        </main>
        <LivePreviewFrame url={preview.agentUrl} palette={preview.palette} />
      </div>
    </div>
  );
}
```

---

#### Phase B: 主题库联动（Week 2-3）

> 目标：Studio 能浏览、安装、编辑已安装主题。

| 操作 | 文件路径 | 预估行数 | 说明 |
|------|----------|---------|------|
| 新建 | `src/ui/components/studio/Library/ThemeGrid.tsx` | ~120 | 主题缩略图网格，每个主题显示：缩略图 + 调色板色块 + 名称版本 |
| 新建 | `src/ui/components/studio/Library/PaletteSwatches.tsx` | ~80 | 调色板色块展示组件，复用多次 |
| **修改** | `src/ui/hooks/useThemes.ts` | +40 | 增加 `loadThemeIntoStudio(manifestPath)` 方法，读取 manifest → 生成 EditorState |
| **修改** | `src/main/catalog/theme-library.ts` | +60 | 新增公开 API `getThemeManifest(themeId): ThemeManifest`，返回序列化的主题元数据 |
| **修改** | `src/main/ipc/theme-ipc.ts` | +30 | 新增 `theme:getManifest` channel |

**`loadThemeIntoStudio` 核心接口**：

```typescript
// 在 useThemes.ts 中添加
async function loadThemeIntoStudio(manifestPath: string): Promise<EditorState> {
  const manifest = await window.studioIPC.getThemeManifest(manifestPath);
  return {
    palette: manifest.colors,              // 直接映射 Primitive 层
    overrides: manifest.overrides ?? {},   // 间距/字号等
    sourceThemeId: manifest.id,            // 标记来源（用于"覆盖保存"或"另存为"）
    isReadOnly: manifest.protected ?? false,
  };
}
```

---

#### Phase C: 壁纸库联动（Week 4-5）

> 目标：用户选择壁纸 → canvas 提取主色 → 自动派生主题调色板 → 跳转到 Theme Editor。

| 操作 | 文件路径 | 预估行数 | 说明 |
|------|----------|---------|------|
| 新建 | `src/ui/hooks/studio/useWallpaperExtractor.ts` | ~150 | canvas 绘制 → getImageData → 颜色量化 → 16 色调色板 |
| 新建 | `scripts/color-quantize.mjs` | ~120 | MMCQ / fast-colors 封装，提供 `extractPalette(imageData, count=16)` |
| **修改** | `src/main/wallpaper/wallpaper-server.ts` | +80 | 新增 `getLibraryThumbnails(): ThumbnailEntry[]` 返回壁纸缩略图列表 |
| **修改** | `src/main/ipc/wallpaper-ipc.ts` | +40 | 新增 `wallpaper:getLibraryThumbnails` channel |
| **修改** | `src/ui/pages/studio/WallpaperLibrary.tsx` | +150 | Phase A 空壳填充完整逻辑 |

---

#### Phase D: Bundle 组合包（Week 6-7）

> 目标：定义 `.agentskin-bundle` 格式 + 实现 CRUD + 一键安装。

| 操作 | 文件路径 | 预估行数 | 说明 |
|------|----------|---------|------|
| 新建 | `src/main/services/bundle-service.ts` | ~250 | Bundle 校验、解压、安装（CRUD + 应用到 Theme/Wallpaper/Icon） |
| 新建 | `src/main/ipc/bundle-ipc.ts` | ~120 | Bundle 相关 IPC channel 注册 |
| 新建 | `src/ui/hooks/studio/useBundleManager.ts` | ~130 | 组合包状态管理、安装进度、错误处理 |
| **修改** | `src/ui/pages/studio/BundleManager.tsx` | +200 | Phase A 空壳填充完整逻辑 |

**Bundle manifest Zod Schema（核心校验逻辑）**：

```typescript
// src/schemas/bundle-schema.ts
import { z } from 'zod';

export const BundleWallpaperSchema = z.object({
  path: z.string().min(1),
  poster: z.string().optional(),
  type: z.enum(['video', 'image', 'web', 'preset']),
  loop: z.boolean().default(true),
  speed: z.number().min(0).max(5).default(1.0),
  audio: z.boolean().default(false),
  fillMode: z.enum(['cover', 'contain', 'stretch']).default('cover'),
});

export const BundleManifestSchema = z.object({
  schemaVersion: z.literal('1.0'),
  type: z.literal('agentskin-bundle'),
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  author: z.object({ name: z.string(), url: z.string().url().optional() }),
  description: z.string().max(500),
  category: z.string(),
  tags: z.array(z.string()).max(10),
  theme: z.object({
    path: z.string(),
    recommendedMode: z.enum(['light', 'dark']),
  }),
  wallpaper: BundleWallpaperSchema,
  icons: z.object({
    path: z.string(),
    format: z.enum(['svg', 'png', 'icns']),
  }).optional(),
  minAppVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export type BundleManifest = z.infer<typeof BundleManifestSchema>;

// 公开校验函数
export function validateBundleManifest(data: unknown): {
  success: boolean;
  data?: BundleManifest;
  errors?: string[];
} {
  const result = BundleManifestSchema.safeParse(data);
  if (result.success) return { success: true, data: result.data };
  return {
    success: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
  };
}
```

---

#### Phase E: Inspire + Polish（Week 8）

> 目标：本地配色理论算法驱动 Inspire 按钮，体验打磨。

| 操作 | 文件路径 | 预估行数 | 说明 |
|------|----------|---------|------|
| 新建 | `src/ui/utils/color-harmony.ts` | ~180 | 配色理论算法：互补色 / 三色组 / 分裂互补 / 类似色 / 单色 |
| **修改** | `src/ui/pages/studio/ThemeEditor.tsx` | +60 | Inspire 按钮 click 逻辑：调用 `generateHarmonyVariants(currentAccent)` → 弹出变体选择器 |
| **修改** | `src/ui/hooks/studio/useLivePreview.ts` | +40 | 支持明暗模式切换、patch 替代 iframe 重建 |
| **修改** | `src/ui/pages/ThemeStudioPage.tsx` | +30 | 增加 ErrorBoundary 包裹每个 Tab 子组件 |

---

### 9.4 代码示例

#### 9.4.1 `useStudioEditor.ts` — 编辑器状态 + Reducer

```typescript
// src/ui/hooks/studio/useStudioEditor.ts
import { useReducer, useCallback } from 'react';

// ─── 类型定义 ───────────────────────────────────────────────
export interface EditorState {
  palette: Record<string, string>;    // key: 'brand.blue.500' → hex
  overrides: Record<string, number | string>; // key: 'spacing.md' → 16
  historyIndex: number;               // 指向 history stack 当前位置
  history: Array<{ palette: Record<string, string>; overrides: Record<string, number | string> }>;
  sourceThemeId: string | null;       // 从哪个主题加载的（null = 新建）
}

export type EditorAction =
  | { type: 'SET_COLOR'; key: string; value: string }
  | { type: 'SET_COLORS'; colors: Record<string, string> }  // 批量替换
  | { type: 'SET_OVERRIDE'; key: string; value: number | string }
  | { type: 'LOAD_STATE'; state: Partial<EditorState> }      // 从主题加载
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET' };

const MAX_HISTORY = 50;

const INITIAL_STATE: EditorState = {
  palette: {},
  overrides: {},
  historyIndex: -1,
  history: [],
  sourceThemeId: null,
};

// ─── Reducer 实现 ───────────────────────────────────────────
function pushHistory(state: EditorState, next: { palette: Record<string, string>; overrides: Record<string, number | string> }): EditorState {
  // 丢弃 historyIndex 之后的"未来"分支
  const trimmed = state.history.slice(0, state.historyIndex + 1);
  const newHistory = [...trimmed, next];
  // 超过容量限制时丢弃最早的记录
  if (newHistory.length > MAX_HISTORY) newHistory.shift();
  return {
    ...state,
    history: newHistory,
    historyIndex: newHistory.length - 1,
  };
}

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'SET_COLOR': {
      const nextPalette = { ...state.palette, [action.key]: action.value };
      const snapshot = { palette: nextPalette, overrides: { ...state.overrides } };
      return pushHistory({ ...state, palette: nextPalette }, snapshot);
    }
    case 'SET_COLORS': {
      const snapshot = { palette: action.colors, overrides: { ...state.overrides } };
      return pushHistory({ ...state, palette: action.colors }, snapshot);
    }
    case 'SET_OVERRIDE': {
      const nextOverrides = { ...state.overrides, [action.key]: action.value };
      const snapshot = { palette: { ...state.palette }, overrides: nextOverrides };
      return pushHistory({ ...state, overrides: nextOverrides }, snapshot);
    }
    case 'LOAD_STATE': {
      // 加载状态不入 history，相当于"新开工程"
      return {
        palette: action.state.palette ?? {},
        overrides: action.state.overrides ?? {},
        historyIndex: 0,
        history: [{ palette: action.state.palette ?? {}, overrides: action.state.overrides ?? {} }],
        sourceThemeId: action.state.sourceThemeId ?? null,
      };
    }
    case 'UNDO': {
      if (state.historyIndex <= 0) return state;
      const newIndex = state.historyIndex - 1;
      const snapshot = state.history[newIndex];
      return { ...state, palette: snapshot.palette, overrides: snapshot.overrides, historyIndex: newIndex };
    }
    case 'REDO': {
      if (state.historyIndex >= state.history.length - 1) return state;
      const newIndex = state.historyIndex + 1;
      const snapshot = state.history[newIndex];
      return { ...state, palette: snapshot.palette, overrides: snapshot.overrides, historyIndex: newIndex };
    }
    case 'RESET': {
      return pushHistory({ ...INITIAL_STATE }, { palette: {}, overrides: {} });
    }
    default:
      return state;
  }
}

// ─── Hook 封装 ──────────────────────────────────────────────
export function useStudioEditor() {
  const [state, dispatch] = useReducer(editorReducer, INITIAL_STATE);

  const setColor = useCallback((key: string, value: string) => dispatch({ type: 'SET_COLOR', key, value }), []);
  const setColors = useCallback((colors: Record<string, string>) => dispatch({ type: 'SET_COLORS', colors }), []);
  const setOverride = useCallback((key: string, value: number | string) => dispatch({ type: 'SET_OVERRIDE', key, value }), []);
  const loadState = useCallback((s: Partial<EditorState>) => dispatch({ type: 'LOAD_STATE', state: s }), []);
  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  return {
    state,
    setColor, setColors, setOverride,
    loadState, undo, redo, reset,
    canUndo: state.historyIndex > 0,
    canRedo: state.historyIndex < state.history.length - 1,
  };
}
```

---

#### 9.4.2 `useWallpaperExtractor.ts` — Canvas → 16 色调色板

```typescript
// src/ui/hooks/studio/useWallpaperExtractor.ts
import { useCallback } from 'react';
import { extractMMCQ } from '../../../scripts/color-quantize.mjs';

export interface PaletteResult {
  hex: string;      // '#1a2b3c'
  r: number; g: number; b: number;
  pixelCount: number; // 该颜色在画布上有多少像素
}

/**
 * 从壁纸图片提取主色调色板。
 * 流程：加载图片 → offscreen canvas 绘制 → getImageData → MMCQ 量化 → 返回 N 色
 */
export function useWallpaperExtractor() {
  const extractFromUrl = useCallback(async (imageUrl: string, colorCount = 16): Promise<PaletteResult[]> => {
    // 1. 加载图片（跨域安全：仅支持同源或 CORS 图片）
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    await img.decode();

    // 2. canvas 绘制（降采样到 256x256 以提升性能）
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, size, size);

    // 3. 提取像素数据
    const imageData = ctx.getImageData(0, 0, size, size);

    // 4. MMCQ 量化
    const palette = extractMMCQ(imageData.data, colorCount);
    return palette;
  }, []);

  /**
   * 智能映射：把量化得到的 N 色映射到 agentskin 语义 token
   * 策略：按亮度排序 → 最暗=color-bg, 最亮=color-text, 最饱和=color-accent
   */
  const mapToTokens = useCallback((palette: PaletteResult[]) => {
    const sorted = [...palette].sort((a, b) => luminance(a) - luminance(b));
    const mostSaturated = palette.reduce((best, cur) => saturation(cur) > saturation(best) ? cur : best);

    return {
      'color.bg': sorted[0].hex,
      'color.surface': sorted[Math.floor(sorted.length * 0.25)].hex,
      'color.surface.hover': sorted[Math.floor(sorted.length * 0.4)].hex,
      'color.text': sorted[sorted.length - 1].hex,
      'color.text.muted': sorted[Math.floor(sorted.length * 0.85)].hex,
      'color.accent': mostSaturated.hex,
      'color.border': sorted[Math.floor(sorted.length * 0.15)].hex,
      'color.success': sorted.find(c => isHue(c, 'green'))?.hex ?? '#22c55e',
      'color.warning': sorted.find(c => isHue(c, 'yellow'))?.hex ?? '#eab308',
      'color.error': sorted.find(c => isHue(c, 'red'))?.hex ?? '#ef4444',
    };
  }, []);

  return { extractFromUrl, mapToTokens };
}

// ─── 辅助函数 ───────────────────────────────────────────────
function luminance(c: PaletteResult): number {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}
function saturation(c: PaletteResult): number {
  const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
  return (max - min) / max;
}
function isHue(c: PaletteResult, hue: 'red' | 'green' | 'yellow'): boolean {
  if (hue === 'green') return c.g > c.r * 1.3 && c.g > c.b * 1.3;
  if (hue === 'red')   return c.r > c.g * 1.3 && c.r > c.b * 1.3;
  if (hue === 'yellow') return c.r > 200 && c.g > 200 && c.b < 150;
  return false;
}
```

---

#### 9.4.3 `color-harmony.ts` — 配色理论算法

```typescript
// src/ui/utils/color-harmony.ts

export interface HSL {
  h: number; // 0-360
  s: number; // 0-100
  l: number; // 0-100
}

export interface HarmonyVariant {
  name: string;
  description: string;
  colors: {
    accent: string;
    secondary: string;
    tertiary: string;
    bg: string;
    surface: string;
    text: string;
  };
}

// ─── HSL → Hex ──────────────────────────────────────────────
function hslToHex({ h, s, l }: HSL): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ─── Hex → HSL ──────────────────────────────────────────────
function hexToHsl(hex: string): HSL {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// ─── 配色变体生成 ───────────────────────────────────────────
export function generateHarmonyVariants(currentAccentHex: string): HarmonyVariant[] {
  const base = hexToHsl(currentAccentHex);

  return [
    {
      name: '互补色',
      description: '对比强烈，适合强调主操作按钮',
      colors: buildPalette(base, 'complementary'),
    },
    {
      name: '三色组',
      description: '均衡三角，适合信息密集型界面',
      colors: buildPalette(base, 'triadic'),
    },
    {
      name: '分裂互补',
      description: '对比柔和又不失活力，适合长时间使用',
      colors: buildPalette(base, 'split-complementary'),
    },
    {
      name: '类似色',
      description: '和谐统一，适合沉浸式阅读场景',
      colors: buildPalette(base, 'analogous'),
    },
    {
      name: '单色',
      description: '极简克制，适合专注工作场景',
      colors: buildPalette(base, 'monochromatic'),
    },
  ];
}

function buildPalette(base: HSL, mode: HarmonyVariant['name'] extends string ? string : never) {
  // 派生不同 hue 的角色色
  const hueOffset = (deg: number) => ((base.h + deg) % 360 + 360) % 360;

  let secondaryH: number, tertiaryH: number;

  switch (mode) {
    case 'complementary':
      secondaryH = hueOffset(180); tertiaryH = hueOffset(180); break;
    case 'triadic':
      secondaryH = hueOffset(120); tertiaryH = hueOffset(240); break;
    case 'split-complementary':
      secondaryH = hueOffset(150); tertiaryH = hueOffset(210); break;
    case 'analogous':
      secondaryH = hueOffset(30); tertiaryH = hueOffset(-30); break;
    case 'monochromatic':
      secondaryH = base.h; tertiaryH = base.h; break;
    default:
      secondaryH = hueOffset(180); tertiaryH = hueOffset(180);
  }

  // 背景：始终深色（跟随 base 的互补色降低明度）
  const bgL = 8 + (base.l < 30 ? 0 : 4); // 极深背景
  const surfaceL = bgL + 8;

  return {
    accent: hslToHex({ h: base.h, s: Math.min(base.s + 10, 100), l: 55 }),
    secondary: hslToHex({ h: secondaryH, s: base.s, l: 50 }),
    tertiary: hslToHex({ h: tertiaryH, s: base.s - 10, l: 50 }),
    bg: hslToHex({ h: base.h, s: 10, l: bgL }),
    surface: hslToHex({ h: base.h, s: 12, l: surfaceL }),
    text: hslToHex({ h: base.h, s: 5, l: 95 }),
  };
}
```

---

#### 9.4.4 `color-quantize.mjs` — MMCQ 中位切割量化

```javascript
// scripts/color-quantize.mjs
// 基于 median cut 的颜色量化算法，提取图片主色
// 参考 pywal 的 MMCQ 实现，纯 JS 零依赖

/**
 * @param {Uint8ClampedArray} pixels - canvas.getImageData().data
 * @param {number} count - 需要提取的颜色数量 (默认 16)
 * @returns {Array<{hex: string, r: number, g: number, b: number, pixelCount: number}>}
 */
export function extractMMCQ(pixels, count = 16) {
  // 1. 收集所有像素为 [r, g, b] 三元组
  const pixelArray = [];
  for (let i = 0; i < pixels.length; i += 4) {
    // 排除完全透明像素
    if (pixels[i + 3] < 128) continue;
    pixelArray.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  }

  // 2. 中位切割量化
  const cubes = [pixelArray];
  while (cubes.length < count) {
    // 找到范围最大的 cube
    let maxIdx = 0, maxRange = -1;
    for (let i = 0; i < cubes.length; i++) {
      const range = cubeRange(cubes[i]);
      if (cubes[i].length > 1 && range > maxRange) {
        maxRange = range; maxIdx = i;
      }
    }
    if (maxRange < 0) break; // 无法再切分

    // 按最大范围通道排序后中位切割
    const cube = cubes[maxIdx];
    const channel = maxChannel(cube);
    cube.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(cube.length / 2);
    cubes.splice(maxIdx, 1, cube.slice(0, mid), cube.slice(mid));
  }

  // 3. 每个 cube 取平均值作为代表色
  return cubes.map(cube => {
    if (cube.length === 0) return { hex: '#000000', r: 0, g: 0, b: 0, pixelCount: 0 };
    const avg = cube.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
    const r = Math.round(avg[0] / cube.length);
    const g = Math.round(avg[1] / cube.length);
    const b = Math.round(avg[2] / cube.length);
    return {
      hex: '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''),
      r, g, b,
      pixelCount: cube.length,
    };
  }).sort((a, b) => b.pixelCount - a.pixelCount); // 按出现频率降序
}

function cubeRange(cube) {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const [r, g, b] of cube) {
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  return Math.max(rMax - rMin, gMax - gMin, bMax - bMin);
}

function maxChannel(cube) {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const [r, g, b] of cube) {
    if (r < rMin) rMin = r; if (r > rMax) rMax = r;
    if (g < gMin) gMin = g; if (g > gMax) gMax = g;
    if (b < bMin) bMin = b; if (b > bMax) bMax = b;
  }
  const rRange = rMax - rMin, gRange = gMax - gMin, bRange = bMax - bMin;
  if (rRange >= gRange && rRange >= bRange) return 0;
  if (gRange >= bRange) return 1;
  return 2;
}
```

---

### 9.5 文件树总表

以下是 Theme Studio 模块拆分后的完整文件树及预估行数（Phase E 完成后）：

```
src/ui/
├── pages/
│   ├── ThemeStudioPage.tsx                    # ~550  顶层路由 + Tab 容器 + ErrorBoundary
│   └── studio/
│       ├── ThemeEditor.tsx                    # ~320  TokenEditor 组合 + Undo/Redo 快捷键
│       ├── WallpaperLibrary.tsx               # ~350  缩略图网格 + 提取面板 + 应用到主题
│       ├── BundleManager.tsx                  # ~380  组合包列表 + 创建向导 + 安装/卸载
│       └── InspectPanel.tsx                   # ~200  现有 CDP Inspect 封装
│
├── components/studio/
│   ├── TokenEditor/
│   │   ├── ColorTokens.tsx                    # ~200  Primitive +  Semantic 双层
│   │   ├── GlassTokens.tsx                    # ~120  Blur/Tint/Noise/Border
│   │   ├── SpacingTokens.tsx                  # ~80   间距系统
│   │   ├── TypographyTokens.tsx               # ~100  字体系统
│   │   └── EffectTokens.tsx                   # ~100  阴影/滤镜/动画
│   ├── LivePreview/
│   │   ├── AgentPreview.tsx                   # ~180  CDP iframe + patch 通信
│   │   └── BundlePreview.tsx                  # ~120  组合包缩略图预览
│   ├── Inspector/
│   │   ├── DomInspector.tsx                   # ~150  节点检视 + 伪状态切换
│   │   └── CascadeView.tsx                    # ~100  级联规则可视化
│   └── Library/
│       ├── ThemeGrid.tsx                      # ~130  主题缩略图 + 调色板色块
│       ├── WallpaperGrid.tsx                  # ~140  壁纸缩略图 + 筛选
│       └── PaletteSwatches.tsx                # ~80   可复用调色板组件
│
├── hooks/studio/
│   ├── useStudioEditor.ts                     # ~250  reducer 状态管理
│   ├── useStudioHistory.ts                    # ~100  Undo/Redo stack
│   ├── useStudioSnapshot.ts                   # ~120  快照/基线持久化
│   ├── useLivePreview.ts                      # ~160  CDP iframe 通信 + 明暗切换
│   ├── useWallpaperExtractor.ts               # ~200  canvas → 量化 → token 映射
│   └── useBundleManager.ts                    # ~130  组合包 CRUD + 安装进度
│
└── utils/
    ├── color-harmony.ts                       # ~180  配色理论 5 变体算法
    ├── color-convert.ts                       # ~60   HSL/Hex/RGB/LCH 互转
    └── token-mapper.ts                        # ~100  量化色 → agentskin 语义 token

src/main/
├── catalog/
│   └── theme-library.ts                       # +60   新增 getThemeManifest API
├── wallpaper/
│   └── wallpaper-server.ts                    # +80   新增 getLibraryThumbnails API
├── services/
│   └── bundle-service.ts                      # ~250  Bundle 校验 + 安装 + 卸载
└── ipc/
    ├── theme-ipc.ts                           # +30    新增 getManifest channel
    ├── wallpaper-ipc.ts                       # +40    新增 getLibraryThumbnails channel
    └── bundle-ipc.ts                          # ~120  Bundle CRUD IPC

src/schemas/
└── bundle-schema.ts                           # ~80    Bundle manifest Zod Schema

scripts/
└── color-quantize.mjs                         # ~120  MMCQ 中位切割量化

────────────────────────────────────────
总文件数: 32 个文件（新建 24 + 修改 8）
总预估新增代码: ~4,200 行
```

---

### 9.6 验证标准表格

| Phase | 验证方法 | 通过标准 | 验证命令 / 操作 |
|-------|---------|---------|----------------|
| **Phase A** | 行数检查 + 快捷键测试 | ThemeStudioPage.tsx <600 行；Ctrl+Z/Ctrl+Y 正常撤销/重做、不影响 CDP 预览 | `Get-Content src\ui\pages\ThemeStudioPage.tsx \| Measure-Object -Line`；手动测试：修改 3 次颜色 → Ctrl+Z 3 次 → 回初始 |
| **Phase A** | 回归测试 | 全部现有 CDP 功能可用（快照、检视、导出） | 手动：导出 .agentskin-theme → 在 Settings → Themes 安装 → 验证渲染正确 |
| **Phase B** | 主题加载测试 | 侧边栏显示已安装主题；点击加载 → 编辑器调色板改变；"另存为"不覆盖原主题 | 手动：安装 2 个测试主题 → Studio 中点击 → `palette` 变化；检查原文件未被修改 |
| **Phase B** | 双向同步 | Studio 保存后 → Settings → Themes 列表可见新主题 | 手动操作验证 |
| **Phase C** | 颜色提取正确性 | 星空壁纸 → 主色包含深蓝/紫色系；樱花壁纸 → 主色包含粉色系 | 手动：选 3 种不同类型壁纸 → 检查 `mapToTokens` 输出的语义 token 合理性 |
| **Phase C** | 提取性能 | 256x256 图片提取 16 色 <100ms | `console.time('extract')` hook 中打印耗时 |
| **Phase D** | Bundle 安装端到端 | 创建 Bundle → 安装后同时检测到 Theme + Wallpaper 变更 | 手动：BundleManager 创建 → 安装 → 检查 Theme 列表 + 桌面壁纸 |
| **Phase D** | 校验拒绝非法 Bundle | 上传缺少 `theme.path` 的 manifest → 拒绝安装 + 提示具体字段 | 手动：构造 3 种非法 manifest（缺字段、类型错、版本格式错） |
| **Phase E** | Inspire 生成质量 | 点击 Inspire → 显示 5 个变体 → 每个变体可应用 → 应用后实时预览更新 | 手动：在 Theme Editor 中点击 Inspire → 逐一应用验证 |
| **Phase E** | ErrorBoundary | Wallpaper Tab 抛出异常 → 仅该 Tab 显示降级 UI，其他 Tab 正常 | 手动：在 WallpaperLibrary 中临时插入 `throw new Error('test')` → 验证隔离 |
