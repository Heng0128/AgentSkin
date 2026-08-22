# CDP × asar 深度适配成果接入方案

> 分析日期: 2026-08-19
> 研究范围: Workspace（工作台）+ Studio（工作室）
> 研究方法: 4 子智能体并行探索（workspace / studio / CDP / asar）+ 汇总交叉分析
> 执行状态: **仅方案，未执行**

---

## 一、现状诊断摘要

### 1.1 能力储备 vs UI 利用率

| 能力层 | 储备状态 | UI 利用率 | 差距 |
|--------|---------|-----------|------|
| CDP 注入 | ✅ 完整（引擎策略 + 验证 + watchdog） | 高（apply/restore 链路） | 小 |
| CDP 快照 | ✅ DevTools 级（cascade + boxModel + fonts） | 中（Studio 预览） | **中** |
| CDP 健康检查 | ✅ 评分 + opaqueLayers + nativeTokens | **低**（仅推送到日志） | **大** |
| CDP Inspect | ✅ 实时元素选择 + cascade 回传 | 中（Studio Inspector） | 小 |
| asar 拓扑 | ✅ HTML 入口 + preload + chunks | **零** | **大** |
| asar 字符串锚点 | ✅ dataAttrs / dataTestids / ids | **零** | **大** |
| asar IPC 表面 | ✅ handle / on / send 通道 | **零** | **大** |
| asar 安全策略 | ✅ CSP / sandbox / contextIsolation | **零** | **大** |
| asar fragility | ✅ 高/中稳定性分级 | **零** | **大** |

### 1.2 核心结论

- **CDP 注入层** 已经是生产级，不需要大改；但 **CDP 分析层大量能力沉睡**（健康检查细节、平台字体、完整级联、基线 CSS）。
- **asar 解包数据** 利用率不到 20%，仅 token 数量进入了 Studio 卡片展示；**字符串锚点、IPC 表面、fragility seed 等高价值数据完全沉睡**。
- **Workspace 的"假功能"集中在预设系统**；**Studio 的"假功能"集中在 4 个占位符 Center Tab + 部分面板的 mock-only 限制**。
- 两者之间的数据流动是单向的：Studio 消耗 CDP 快照但不反哺；Workspace 接收 inspect 结果但不影响 Studio。

---

## 二、Workspace（工作台）接入方案

### 2.1 现有问题

| 问题 | 位置 | 严重度 |
|------|------|--------|
| 预设切换器是空壳 | `workspace-presets.ts` | P1 |
| `tweak-injector.ts` 简化版缺失 colors/dim/opacity 等字段 | `src/main/services/tweak-injector.ts` | P0 |
| AgentLivePreview 是静态 iframe 回放 | `AgentLivePreview.tsx` | P1 |
| 默认 agent 硬编码 codex | `workspaceStore.ts` | P2 |

### 2.2 可接入的 CDP 能力

#### 2.2.1 接入点 A：健康检查报告渲染

**当前状态**: `THEME_HEALTH_REPORT` IPC 推送到 renderer 后未充分渲染。
**CDP 数据源**: `theme-health-check.ts` 输出的 `HealthCheckReport`

| 字段 | 当前 UI | 建议接入位置 | 价值 |
|------|---------|-------------|------|
| `score` (0-100) | 仅日志 | Workspace 顶部状态条 | 即时反馈主题质量 |
| `blockingCount` | 未展示 | 红色警告横幅 + 数字 | 快速定位阻塞问题 |
| `opaqueLayers` 详情 | 未展示 | 新增"不透明层"折叠面板 | 解决"注入无效"的诊断痛点 |
| `nativeTokens` 采样 | 仅主进程日志 | 展示"原生 token 基线" | 理解 agent 的 CSS 变量分布 |
| `heroArtActive` | 未展示 | 预览区角标 | 确认壁纸注入状态 |
| `accentToken` 值 | 未展示 | 颜色指示器 | 确认主题强调色生效 |

**建议 IPC 变更**:
- 无新增通道，现有 `THEME_HEALTH_REPORT` 已足够
- 需要在 `statusStore` 或新建 `diagnosticsStore` 中缓存最新报告
- WorkspacePage 订阅并渲染

#### 2.2.2 接入点 B：Live Tweak 能力扩展（完整 CSS 字段）

**当前状态**: `tweak-injector.ts` 的 `overridesToCssSimple()` 仅覆盖 radius/spacing/shadow/fontSize/color 基础字段。
**CDP 数据源**: `node-cascade.ts` 的 38 维计算样式 + `snapshot-theme.ts` 的完整 cascade

| ToolOverride 字段 | 当前可推送 | 建议扩展 | CSS 映射 |
|-------------------|-----------|---------|---------|
| `radius` | ✅ | 已完成 | `--agentskin-radius-*` |
| `spacing` | ✅ | 已完成 | `--agentskin-spacing-*` |
| `shadow` | ✅ | 已完成 | `--agentskin-shadow-*` |
| `fontSize` | ✅ | 已完成 | `--agentskin-font-size-*` |
| `color` | ✅ | 已完成 | `--agentskin-color-*` |
| `colors` (semantic palette) | ❌ | **扩展** | 14-token palette 子集 |
| `dim` (不透明度遮罩) | ❌ | **扩展** | `opacity` 或 `filter: brightness()` |
| `contrast` | ❌ | **扩展** | `filter: contrast()` |
| `saturate` | ❌ | **扩展** | `filter: saturate()` |
| `gradientAccent` | ❌ | **扩展** | `linear-gradient()` 生成 |

**实现路径**:
1. 扩展 `tweak-injector.ts` 的 `overridesToCss()` 为完整版（参考 `RealDomPreview.tsx` 中的实现）
2. TweakPanel 新增调色板编辑器、滑块控件
3. 预览链路同步更新（已支持 `postMessage` 注入 override CSS）

#### 2.2.3 接入点 C：真实 CDP 实时预览（替代静态 iframe）

**当前状态**: `AgentLivePreview` 通过 `snapshotBaseline` 获取 DOM 后在 iframe 内回放，数据非实时。
**CDP 数据源**: `snapshot-theme.ts` + `dom-tree.ts`

**方案选项**:

| 方案 | 描述 | 复杂度 | 收益 |
|------|------|--------|------|
| A. 增量快照轮询 | 每 2-3 次 tweak 操作后重新抓取基准 | 低 | 中等 |
| B. CDP 事件驱动 | 订阅 `DOM.documentUpdated` 自动刷新 | 中 | **高** |
| C. 双轨渲染 | iframe 实时预览 + 真实 CDP 推送并行 | 中 | **高** |

**推荐方案 C**: 保留 iframe 低延迟预览，同时在每次 `updateOverride` 时并行推送到真实 agent，实现"所见即所得"。

#### 2.2.4 接入点 D：预设系统重塑

**当前状态**: `workspace-presets.ts` 的 5 个预设完全等价。
**CDP 数据源**: 无（纯本地配置）

**建议改造**:

| 预设 ID | 含义 | 具体行为 |
|---------|------|---------|
| `default` | 重置为基线 | 调用 `resetTweak` |
| `compare` | 对比模式 | 左右分屏：左=基线，右=当前 override |
| `focus` | 专注模式 | 隐藏 drawer + inspector，仅保留 TweakPanel |
| `generator` | 从当前 agent 生成预设 | 读取 CDP snapshot 的计算样式作为初始值 |
| `audit` | 审计模式 | 跳转健康检查视图 |

**`generator` 预设接入 CDP**:
- 通过 `studio:snapshot` 或 `studio:snapshot:baseline` 获取当前状态
- 将 `landmark.styles` 反序列化为 `ToolOverride` 初始值
- 实现"从当前 UI 状态反向生成 tweak 起点"

### 2.3 可接入的 asar 数据

#### 2.3.1 接入点 E：Agent CSS 变量目录

**数据源**: `extract-asar-summary.mjs` → `tokens.namespaces`
**当前状态**: 仅 token 数量进入 Studio 卡片

**接入位置**: Workspace → TweakPanel → "从 Agent 变量导入" 按钮

**用户流程**:
1. 用户选择 "从 agent 导入"
2. 前端调用 `api.getAgentTokenNamespaces(agentId)`
3. 后端读取 `agents-profiles/<agent>-profile.json` 的 `namespaces`
4. 展示可搜索的变量列表（按命名空间分组）
5. 用户选择变量 → 自动生成对应的 override 条目

**数据契约**:
```typescript
interface AgentTokenNamespaces {
  agentId: AgentId;
  namespaces: Array<{
    prefix: string;       // e.g. "vscode", "semi", "cb"
    varCount: number;
    sampleVars: string[]; // 前 5-10 个示例
  }>;
}
```

#### 2.3.2 接入点 F：安全态势指示器

**数据源**: `extract-asar-summary.mjs` → `security.*`
**当前状态**: 未接入 UI

**接入位置**: Workspace 顶部 agent 列表每个 agent 卡片

| 数据 | 展示形式 | 交互 |
|------|---------|------|
| `contextIsolation` | ✅/❌ 图标 | hover 说明 |
| `sandbox` | ✅/❌ 图标 | hover 说明 |
| `webSecurity` | ✅/⚠️/❌ 图标 | hover 展示 CSP 摘要 |
| CSP 严格度 | 评分 badge | 点击展开 CSP 详情 |

---

## 三、Studio（工作室）接入方案

### 3.1 现有问题

| 问题 | 位置 | 严重度 |
|------|------|--------|
| 4 个 Center Tab 占位符 | `center/CenterTab*.tsx` | **P0** |
| FX override 仅 mock 生效 | `DockTabFX.tsx` | **P0** |
| License/Target Directory 字段未接入 | `ExportDialog.tsx` | P1 |
| studio-history.ts 未使用 | `profile/studio-history.ts` | P2 |
| studio-theme-templates.ts 未引用 | `profile/studio-theme-templates.ts` | P2 |
| createdAt 硬编码空 | `studio-workspace-ipc.ts` | P2 |

### 3.2 可接入的 CDP 能力

#### 3.2.1 接入点 G：Bundle 管理面板（填充 CenterTabBundle）

**当前状态**: "Bundle 管理（即将推出）" 占位符
**CDP 数据源**: 无（Bundle 数据已在 `studio-workspace-ipc.ts` 实现真实接口）

**发现**: Bundle 相关 IPC 已全部实现真实后端：
- `studio:bundle:list` → 扫描 `userData/bundles/`
- `studio:bundle:import` → `installBundleFromPath()`
- `studio:bundle:install-by-id` → `ThemePackageLoader` + `ThemeInstaller`
- `studio:bundle:delete` → `fs.rm`

**问题**: IPC 层完整但 UI 层缺失。

**建议填充内容**:

| 区块 | 数据来源 | 操作 |
|------|---------|------|
| Bundle 列表 | `STUDIO_BUNDLE_LIST` | 展示 name/themeId/hasWallpaper |
| 导入按钮 | `STUDIO_BUNDLE_IMPORT` | 文件选择器 |
| 安装按钮 | `STUDIO_BUNDLE_INSTALL_BY_ID` | 对列表中未安装的执行 |
| 删除按钮 | `STUDIO_BUNDLE_DELETE` | 二次确认后删除 |

#### 3.2.2 接入点 H：CSS 源码编辑器（填充 CenterTabRaw）

**当前状态**: "CSS 源码编辑（即将推出）" 占位符
**CDP 数据源**: `baseline-css-capture.ts` + `baseline-css-replay.ts`

**可暴露的编辑能力**:

| 功能 | 数据源 | 操作 |
|------|--------|------|
| 查看基线 CSS | `CSS.getStyleSheetText` | 只读展示原生 token |
| 编辑 override CSS | `STUDIO_TWEAK_PUSH`（需新增） | 实时编辑 + preview |
| 查看 Engine 生成的 CSS | `scripts/build-theme-package.mjs` 已输出 | 展示 palette/tokens/cosmetic/theme 分层 |
| Diff 对比 | 当前 vs 基线 | 行级高亮 |

**建议 Workflow**:
1. 用户在 Inspector 中选择元素
2. 点击"查看源码" → 右侧面板展示 `CSS.getStyleSheetText(layerId)` 原文
3. 用户编辑 override 规则 → 通过 CDP `CSS.setStyleSheetText` 实时生效

#### 3.2.3 接入点 I：Wallpaper → Theme 面板（填充 CenterTabWallpaper）

**当前状态**: "Wallpaper → Theme（即将推出）" 占位符
**CDP 数据源**: `studio:image:extract-theme` 已真实实现

**发现**: `deriveThemeFromImage()` 已实现 14-token palette 生成。

**建议填充内容**:

| 区块 | 功能 | IPC |
|------|------|-----|
| 图片上传区 | 拖放 / 文件选择 | 直接传 base64 到 extract |
| 提取进度 | 展示 deriveThemeFromImage 各阶段 | `STUDIO_IMAGE_EXTRACT_THEME` |
| 调色板预览 | 14 token 色块 + hex 值 | 同步展示 |
| tonal scale | Material You 风格 13 阶 tonal palette | 色阶条 |
| 保存为新主题 | manifest.json 生成 + 写入工程 | `STUDIO_PROJECT_SAVE` |
| 应用为壁纸 | 调用已有的 wallpaper IPC | `wallpaper-ipc.ts` |

#### 3.2.4 接入点 J：合规检查面板（填充 CenterTabInspect）

**当前状态**: "合规检查（即将推出）" 占位符
**CDP 数据源**: `theme-health-check.ts` 的 `HealthCheckReport`

**建议填充内容**:

| 区块 | 数据源 | 可视化 |
|------|--------|--------|
| 主题健康评分 | `healthCheck.score` | 0-100 环形进度条 |
| 不透明层列表 | `healthCheck.opaqueLayers` | 按 depth 排序的层列表 |
| 阻塞问题数 | `healthCheck.blockingCount` | 红色告警卡片 |
| WCAG 对比度检查 | 新增: 从 snapshot 采样前景/背景色 | 合规/不合规标签 |
| 原生 token 覆盖 | `healthCheck.nativeTokens` | 变量名 + 计算值表格 |

#### 3.2.5 接入点 K：FX Dock 面板推送真实 agent

**当前状态**: `DockTabFX.tsx` 的 override 仅作用于 iframe mock replica。
**CDP 数据源**: 当前 CDP 注入链路已支持 CSS 层注入（`css-inject.ts`）。

**方案选项**:

| 方案 | 描述 | 复杂度 | 推荐 |
|------|------|--------|------|
| A. 走 workspace pushTweak | 复用 `workspace:tweak:push` 通道 | 低 | ✅ 推荐 |
| B. 新建 studio:tweak:push 通道 | 独立 IPC，更清晰的职责分离 | 中 | 长期 |
| C. 扩展 apply 频率 | 每次 slider 变化触发完整 apply | 低 | 性能差 |

**推荐方案 A**:
- DockTabFX 将 `toolOverrides` 通过 `workspace:tweak:push` 推送到真实 agent
- 同时保留 iframe preview（双轨渲染）
- 需要 dock → store → IPC 的桥接代码

### 3.3 可接入的 asar 数据

#### 3.3.1 接入点 L：工程创建时的 Agent  Profile 引导

**数据源**: `agents-profiles/<agent>-profile.json`（由 `gen-agent-arch-docs.mjs` 从 asar 生成）
**当前状态**: Studio 工程创建时不利用 profile 数据

**建议改造**:

| 步骤 | 当前行为 | 建议行为 |
|------|---------|---------|
| 1. 新建工程 | 仅填写 name/author/agent | 同上 + 展示 agent profile 摘要 |
| 2. Token 映射 | 无 | 根据 profile 的 `namespaces` 推荐 token 覆盖策略 |
| 3. 选择器推断 | 无 | 根据 profile 的 `fragilitySeeds.high` 推荐注入锚点 |
| 4. 初始模板 | 空工程 | 根据 agent 类型预填充推荐的 override 起点 |

#### 3.3.2 接入点 M：Agent 架构浏览器增强

**数据源**: `extract-asar-summary.mjs` 完整输出
**当前状态**: Visual Analysis Summary 卡片仅展示 token 统计数字

**建议增强**:

| 新增面板 | 数据来源 | 价值 |
|---------|---------|------|
| 安全态势 | `security.*` | 理解注入风险 |
| IPC 通道目录 | `surfaces.ipc.*` | 辅助逆向新 agent |
| Preload API 列表 | `surfaces.preloadExposed` | 理解 bridge 注入点 |
| Fragility 热力图 | `fragilitySeeds` | 评估注入稳定性 |
| Sourcemap 可用率 | `sourcemaps` | 判断可调试性 |

#### 3.3.3 接入点 N：自动选择器发现与验证

**数据源**: `extract-asar-summary.mjs` → `strings.dataTestids` + `strings.ids` + `fragilitySeeds`
**当前状态**: 适配器选择器是手工编写的静态规则

**高阶构想（需评估 ROI）**:

1. **离线阶段**: 从 asar 提取所有 `data-testid` 和 `id` 作为候选注入锚点
2. **运行时验证**: CDP `Runtime.evaluate` 查询候选锚点是否实际存在于 DOM
3. **稳定性评分**: 结合 `fragilitySeeds` 分级（high/medium）排序
4. **自适应注入**: 自动选择最高稳定性的锚点进行 theme layer 挂载

---

## 四、跨页面协同机会

### 4.1 Workspace → Studio 数据流

| 场景 | 数据 | 通道 |
|------|------|------|
| tweak 保存后同步到 Studio | override → 工程文件 | `studio:project:save` |
| 从 Studio 导入工程时覆盖 Workspace | 工程 → overrides | 桥接逻辑 |
| 健康检查请求跳转 | agentId + port | query param |

### 4.2 Studio → Workspace 数据流

| 场景 | 数据 | 通道 |
|------|------|------|
| Studio 导出主题后 Workspace 可立即应用 | bundle 路径 | `workspace:applyExportedTheme`（需新增） |
| Inspector 选中元素同步到 TweakPanel | node path + computed styles | 内存事件 |
| 快照基线同步 | baseline.json | 共享文件 |

---

## 五、实施优先级矩阵

### P0 — 立即可做（后端已就绪，仅 UI 缺失）

| 编号 | 名称 | 页面 | 工作量 | 价值 |
|------|------|------|--------|------|
| G | Bundle 管理面板 | Studio | 2-3h | ⭐⭐⭐⭐ |
| I | Wallpaper → Theme 面板 | Studio | 3-4h | ⭐⭐⭐⭐ |
| K | FX Dock 推送真实 agent | 跨页面 | 2-3h | ⭐⭐⭐⭐⭐ |
| J | 合规检查面板 | Studio | 3-4h | ⭐⭐⭐⭐ |

### P1 — 需小量后端扩展

| 编号 | 名称 | 页面 | 工作量 | 价值 |
|------|------|------|--------|------|
| A | 健康检查报告渲染 | Workspace | 1-2h | ⭐⭐⭐⭐ |
| B | Live Tweak 完整 CSS 字段 | 跨页面 | 4-6h | ⭐⭐⭐⭐⭐ |
| D | 预设系统重塑 | Workspace | 2-3h | ⭐⭐⭐ |
| E | Agent CSS 变量目录 | Workspace | 2-3h | ⭐⭐⭐⭐ |

### P2 — 需后端新增接口

| 编号 | 名称 | 页面 | 工作量 | 价值 |
|------|------|------|--------|------|
| C | 真实 CDP 实时预览 | Workspace | 4-6h | ⭐⭐⭐⭐ |
| F | 安全态势指示器 | Workspace | 1-2h | ⭐⭐⭐ |
| L | 工程创建 Profile 引导 | Studio | 3-4h | ⭐⭐⭐ |
| M | Agent 架构浏览器增强 | Studio | 2-3h | ⭐⭐⭐ |

### P3 — 长期高价值

| 编号 | 名称 | 页面 | 工作量 | 价值 |
|------|------|------|--------|------|
| H | CSS 源码编辑器 | Studio | 6-8h | ⭐⭐⭐⭐⭐ |
| N | 自动选择器发现 | 底层 | 8-12h | ⭐⭐⭐⭐⭐ |
| ExportDialog 完善 | License + TargetDir | Studio | 1h | ⭐⭐ |

---

## 六、详细实施计划

### 第一批：Bundle + Wallpaper + Inspect（3 个并行线程）

**目标**: 消灭 3 个占位符 Center Tab

| 线程 | 接入点 | 交付物 | 验收标准 |
|------|--------|--------|---------|
| 1 | G — Bundle 管理 | `CenterTabBundle.tsx` | 列表展示 + 导入/安装/删除 |
| 2 | I — Wallpaper→Theme | `CenterTabWallpaper.tsx` | 图片上传 + 14-token 提取 + 保存 |
| 3 | J — 合规检查 | `CenterTabInspect.tsx` | 健康评分 + 不透明层 + 阻塞列表 |

### 第二批：FX Dock 真实推送 + 健康检查渲染（2 个并行线程）

**目标**: 最核心的用户可见提升

| 线程 | 接入点 | 交付物 | 验收标准 |
|------|--------|--------|---------|
| 1 | K — FX Dock 推送真 agent | `DockTabFX.tsx` 改造 | slider 变化同时影响 iframe + 真实 agent |
| 2 | A — 健康检查报告渲染 | `WorkspacePage.tsx` 扩展 | 顶部状态条 + 不透明层面板 |

### 第三批：Live Tweak 完整化 + 预设系统（2 个并行线程）

**目标**: Workspace 从"可用"到"好用"

| 线程 | 接入点 | 交付物 | 验收标准 |
|------|--------|--------|---------|
| 1 | B — 完整 CSS 字段 | `tweak-injector.ts` + `TweakPanel.tsx` | colors/dim/contrast/saturate 全部可推送 |
| 2 | D — 预设系统重塑 | `workspace-presets.ts` + `WorkspaceSwitcher.tsx` | 5 个预设行为不同 + generator 从 CDP 反向 |

### 第四批：架构浏览器 + 变量目录（2 个并行线程）

**目标**: 高级用户深度利用 asar 数据

| 线程 | 接入点 | 交付物 | 验收标准 |
|------|--------|--------|---------|
| 1 | M — 架构浏览器增强 | `StudioDrawer.tsx` 扩展 | 安全 + IPC + Fragility 面板 |
| 2 | E — Agent CSS 变量目录 | `TweakPanel.tsx` 新增导入 | 从 namespaces 搜索选择变量 |

### 第五批：长期高价值（2 个并行线程）

**目标**: 技术壁垒提升

| 线程 | 接入点 | 交付物 | 验收标准 |
|------|--------|--------|---------|
| 1 | H — CSS 源码编辑器 | `CenterTabRaw.tsx` | 基线 CSS 查看 + inline edit + diff |
| 2 | N — 自动选择器发现 | 引擎层 + 适配器离线生成 | 新 agent 适配器选择器 70% 自动生成 |

---

## 七、风险评估

### 7.1 技术风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| CDP 连接抖动导致 FX Dock 推送失败 | 中 | 中 | 复用 session pool + 失败重试 |
| `deriveThemeFromImage` 大图性能问题 | 低 | 低 | 已降采样 48px，足够 |
| 完整 override CSS 生成过于复杂 | 中 | 低 | 渐进式：先基础字段 → 再扩展 |
| asar profile JSON 与运行时版本不一致 | 中 | 中 | 标注"离线数据，仅参考" |

### 7.2 架构约束

| 约束 | 影响 |
|------|------|
| 禁止新增适配器 | ✅ 无冲突 |
| Studio 禁止创作类功能 | ⚠️ CSS 源码编辑器（H）需确认是否属于"创作类"——建议归入"编辑类"，因其修改的是 override 而非源 |
| 禁止自建 CDN/服务端 | ✅ 所有数据本地 |
| UI 页面新增需 RFC | ✅ 本次不改页面数，仅填充已有 Center Tab |

### 7.3 命名一致性提醒

根据用户偏好：
- **Agents**：品牌复数词，不翻译
- **Dashboard** → **概览**
- **Workspace**：应检查是否翻译为"工作台"
- **Studio**：应检查是否翻译为"工作室"

建议在实施前统一中英文名称映射表。

---

## 八、核心发现汇总

### 已验证为"真实"的功能（无需改动）

1. `workspace:tweak:push` / `save` / `reset` — Live Tweak 全链路 CDP 注入 ✅
2. `studio:snapshot` / `snapshot:baseline` — DevTools 级视觉快照 ✅
3. `studio:inspect:start/stop/result` — 实时元素选择器 ✅
4. `studio:project:*` — 工程 CRUD ✅
5. `studio:image:extract-theme` — 图片→14-token 提取 ✅
6. `studio:export` — 主题包构建 ✅
7. `studio:bundle:*` — Bundle 管理后端 ✅（仅 UI 缺失）
8. CDP 引擎注入（palette/tokens/cosmetic/theme/adapter 5 层）✅

### 已验证为"虚假/空壳"的功能

1. `workspace-presets.ts` — 预设无差异 ❌
2. 4 个 Studio Center Tab 占位符 ❌
3. `DockTabFX` 仅 mock 生效 ❌
4. `ExportDialog` License/TargetDir 未接入 ❌
5. `createdAt: ''` 硬编码空 ❌
6. `studio-history.ts` / `studio-theme-templates.ts` 已实现但未引用 ❌

### 已验证为"沉睡能力"（有后端无前端）

1. `THEME_HEALTH_REPORT` 详情未渲染
2. `opaqueLayers` 详情未展示
3. `nativeTokens` 采样仅日志
4. asar `strings.dataTestids` / `ids` 完全未利用
5. asar `surfaces.*` 完全未利用
6. asar `security.*` 完全未利用
7. asar `fragilitySeeds` 完全未利用
8. `agents-profiles/` 完整 profile 仅用了 token 数量

---

> 方案完成。下一步可进入第一批实施，或按用户指定顺序调整。
