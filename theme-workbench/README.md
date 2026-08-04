# 主题工作台 (Theme Workbench)

## 说明

这是一个用于制作和自定义 **AgentSkin** 桌面应用主题的文件夹。  
配合 **Theme Studio（工作室）** 使用 — 它是一个可视化主题复刻 + 创作工作台。

## 使用方式

### Theme Studio（工作室）

1. 在侧边栏点击「工作室」进入工作台。
2. 选择目标 Agent（TRAE/Qoder/WorkBuddy/Doubao/Codex），可选已安装主题。
3. 点击「抓取」：
   - AgentSkin 通过 CDP 将主题应用到真实 Agent 窗口（也可不选主题，直接抓原生界面）；
   - 用 DevTools 同款 CDP 检查栈（CSS/DOM 域）抓每个 landmark 的**完整级联来源、计算样式、真实渲染字体、协议级几何**；
   - 在站内 mock 骨架里用 CSS variable 驱动像素级还原。
4. 点击骨架中的元素，右侧 Inspector 展示该元素的计算样式 + 级联来源（哪个选择器/样式表、`!important`）。
5. 点击「开始检查」可在真实 Agent 上点选元素，工作室实时高亮并同步其级联（开发者工具式）。
6. 底部工具箱提供 16 维微调：**圆角 · 间距 · 阴影 · 毛玻璃 · 字号 · 字体 · 动效时长 · 缓动**。
7. 右栏「导出主题包」：将当前调色板（来自快照）与 8 维微调导出为可导入的
   `.agentskin-theme` 包，写入 `theme-workbench/out/<id>.agentskin-theme/`，可直接在主题库导入。

### 本地主题包

- `themes/` — 存放主题配置文件（`manifest.json` + `assets/`）
- `assets/` — 存放主题相关的图片资源
- `out/` — 工作室导出的主题包（按 id 分目录）

## 目录结构

```
theme-workbench/
├── README.md      # 本文件
├── themes/        # 存放主题配置文件（manifest.json、CSS targets）
├── assets/        # 存放主题相关的图片等资源
└── out/           # 工作室导出的 .agentskin-theme 包
```

## Theme Studio 技术栈

| 层级 | 文件 | 职责 |
|------|------|------|
| 后端抓取 | `src/main/cdp/snapshot-theme.ts` | CDP 完整 DOM 抓取（级联 + 计算样式 + 真实字体 + box model） |
| 级联核心 | `src/main/cdp/node-cascade.ts` | `captureNodeCascade`：CSS/DOM 域级联抓取（共用） |
| 实时检查 | `src/main/cdp/inspect-session.ts` | DevTools 式点选元素（Overlay 域） |
| IPC | `src/main/ipc/studio-ipc.ts` | `studio:snapshot` / `studio:export` / `studio:inspect:*` 通道 |
| 导出脚本 | `scripts/build-theme-package.mjs` | 由调色板 + 16 维参数生成 `.agentskin-theme` 包 |
| 类型 | `src/shared/types.ts` | `ThemeVisualSnapshot` / `CssMatchedRule` / `InspectedNode` / `ThemeStudioExportRequest` |
| 前端页面 | `src/ui/pages/ThemeStudioPage.tsx` | 主页面（抓取样例 + ReplicaFrame + Inspector + 工具箱 + 导出） |
