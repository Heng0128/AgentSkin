# CDP × asar 深度适配 — 细化审计报告

**日期**: 2026-08-19
**范围**: 方案交叉验证 + 命名审计 + 精确代码定位
**方法**: 逐文件核对原方案中的路径、IPC 通道、store 字段、组件状态

---

## 一、命名审计结果

### 1.1 当前中英文核心术语对照

| i18n Key | zh-CN | en | 备注 |
|----------|-------|----|------|
| navDashboard | 概览 | Overview | ✅ 一致 |
| navWorkspace | 工作台 | Workspace | ⚠️ 中英文不对称 |
| navAgents | Agents | Agents | ✅ 品牌词不翻译 |
| navStudio | Studio | Studio | ⚠️ 未翻译为"工作室" |
| navOverview | 概览 | Overview | ⚠️ 与 navDashboard 重复 |
| dashboardTitle | 概览 | Overview | ✅ |
| agentsTitle | Agents | Agents | ✅ |
| agentsPageTitle | Agents | Agents | ✅ |
| navThemes | 主题 | Themes | ✅ |
| navSettings | 设置 | Settings | ✅ |
| navWallpaperEngine | 壁纸 | Wallpaper | ✅ |

### 1.2 命令面板翻译不一致（P1 问题）

| i18n Key | zh-CN | en | 问题 |
|----------|-------|----|------|
| cmdGoDashboard | **仪表盘** | Dashboard | ❌ 应为"概览"，与 navDashboard 一致 |
| cmdGoWorkspace | **工作空间** | Workspace | ❌ 应为"工作台"，与 navWorkspace 一致 |
| cmdGoWallpaper | 壁纸 | Wallpaper | ✅ |

**影响范围**: `src/shared/i18n.ts` L56, L59（zh-CN）/ L1111, L1114（en）

**建议修正**:
- `cmdGoDashboard` zh-CN: '仪表盘' → '概览'
- `cmdGoWorkspace` zh-CN: '工作空间' → '工作台'
- `cmdGoDashboard` en: 'Dashboard' → 'Overview'（与 navDashboard 一致）

### 1.3 Studio Tab 命名

| i18n Key | zh-CN | en | 状态 |
|----------|-------|----|------|
| studioTabWallpaper | 壁纸 | Wallpaper | ✅ |
| studioTabBundle | 打包 | Bundle | ✅ |
| studioTabInspect | 检查 | Inspect | ✅ |
| studioTabRaw | 原貌 | Raw | ✅ |

Studio tab 命名无一致性问题。

---

## 二、方案交叉验证结果

### 2.1 严重错误（方案描述与实际不符）

#### ❌ 错误 #1：CenterTabBundle 被误判为"占位符"

**原方案声称**: "Bundle 管理（即将推出）" 占位符

**实际状态**: **已完整实现**。`src/ui/components/studio/center/CenterTabBundle.tsx` 包含：
- Bundle 列表展示（name, themeId, hasWallpaper, createdAt）
- 刷新按钮 → `refreshBundles()`
- 导入按钮 → `importAndInstallBundle()`
- 删除按钮 → `deleteBundle(id)` + 二次确认
- Loading 状态 + 空态展示

**结论**: 不需要"填充"，已可用。原方案 P0 中的 G 接入点（Bundle 管理面板）应从计划中移除。

#### ❌ 错误 #2：CenterTabWallpaper 被误判为"占位符"

**原方案声称**: "Wallpaper → Theme（即将推出）" 占位符

**实际状态**: **已完整实现**。`src/ui/components/studio/center/CenterTabWallpaper.tsx` 直接组合 `StudioImageToThemePanel` 组件，该组件提供完整的拖放上传 → 14-token 提取 → 应用工作流。

**结论**: 不需要"填充"，已可用。原方案 P0 中的 I 接入点（Wallpaper → Theme 面板）应从计划中移除。

#### ❌ 错误 #3：DockTabFX 被误判为"仅 mock 生效"

**原方案声称**: "override 仅作用于 iframe mock replica"

**实际状态**: **已双轨渲染**。`src/ui/components/studio/DockTabFX.tsx` L140-147：

```typescript
const pushOverride = (key: keyof ToolOverride, value: string | number | boolean | undefined) => {
  setOverride(key, value); // iframe mock preview
  // Push to real agent only when a valid agent session exists.
  if (wsAgentId) {
    void wsUpdateOverride(key, value);
  }
};
```

同时 L49, L58-68 还实现了从 workspaceStore 自动桥接 agentId 和 port 的逻辑。

**结论**: K 接入点（FX Dock 推送真实 agent）已完成核心功能。缺失的是 tweak-injector.ts 中部分 CSS 字段的推送支持（见下文）。

### 2.2 部分错误（方案描述部分正确）

#### ⚠️ 部分正确 #1：CenterTabInspect 被归为"占位符"

**原方案声称**: "合规检查（即将推出）" 占位符

**实际状态**: **部分实现**。`src/ui/components/studio/center/CenterTabInspect.tsx` 已展示：
- Landmark 数量 + 列表
- CSS 变量数量 + 列表
- DOM 节点数

**未实现**: 健康评分环形进度条、不透明层列表、阻塞问题数、WCAG 对比度检查、原生 token 覆盖表格。

**结论**: J 接入点（合规检查面板）仍有高价值工作可做，但描述应从"填充占位符"改为"增强现有面板"。

#### ⚠️ 部分正确 #2：tweak-injector.ts 字段缺失范围

**原方案声称**: "仅覆盖 radius/spacing/shadow/fontSize/color 基础字段"

**实际状态**: `overridesToCssSimple()`（L109-139）实际覆盖的字段比方案描述更多：

**已推送字段**:
- radius, spacing, shadowLevel, blurPx, fontSize, fontFam
- duration, timing, accent, background, foreground, surface
- borderWidth, lineHeight, separators

**确实未推送字段**:
- colors（语义调色板，14-token palette 子集）
- dim, contrast, saturate, scale, invert, opacity
- gradientAccent

**结论**: B 接入点（Live Tweak 完整 CSS 字段）仍然有效，但工作量需修正为仅补充 7 个缺失字段，而非"从 5 个扩展到 14 个"。

#### ⚠️ 部分正确 #3：workspace-presets.ts 预设行为

**原方案声称**: "5 个预设完全等价"

**实际状态**: `workspace-presets.ts` L34-40 确认所有 5 个预设（default, compare, multi-agent, generator, focus）确实都是 `{ viewMode: 'single' }` 无差异化配置。但原方案建议的 generator 预设"从 CDP snapshot 反向生成"是一个新能力，需要对预设系统做结构性改造，不只是"填充"。

### 2.3 验证正确项

以下方案描述与实际代码一致：

| 方案描述 | 验证结果 |
|---------|---------|
| workspace-presets.ts 5 个预设等价 | ✅ L34-40 确认 |
| studio-history.ts 未引用 | ✅ 搜索确认无消费方 |
| studio-theme-templates.ts 未引用 | ✅ 搜索确认无消费方 |
| ExportDialog License 未接入 | ✅ L73-76 TODO 注释确认 |
| ExportDialog TargetDir 未接入 | ✅ L77-80 TODO 注释确认 |
| createdAt 硬编码空 | ✅ 需查看 studio-workspace-ipc.ts 具体返回 |
| THEME_HEALTH_REPORT 推送到 renderer | ✅ ipc-channels.ts L225 |
| HealthCheckReport 包含 score/opaqueLayers/nativeTokens | ✅ theme-health-check.ts L44-67 |
| extract-asar-summary.mjs 输出 tokens.namespaces | ✅ 脚本存在 |
| ToolOverride 类型字段完整 | ✅ shared/override.ts L9-42 |
| tweak-injector.ts 简化版注释说明 | ✅ L96-107 注释清晰 |
| DockTabFX 同时写 iframe + real agent | ✅ L140-147 双路推送 |
| workspace:tweak:push IPC 通道存在 | ✅ ipc-channels.ts L217 |
| studio:bundle:* 全部 IPC 实现 | ✅ studio-workspace-ipc.ts L139-242 |
| studio:project:* 全部 IPC 实现 | ✅ studio-project-ipc.ts L180-252 |
| studio:snapshot / snapshot:baseline 实现 | ✅ ipc-channels.ts L113-116 |
| studio:inspect:start/stop/result 实现 | ✅ ipc-channels.ts L119-123 |
| studio:image:extract-theme 实现 | ✅ ipc-channels.ts L96 |

---

## 三、修正后的接入点矩阵

### P0 — 已可用或接近可用

| 编号 | 名称 | 页面 | 状态 | 剩余工作 |
|------|------|------|------|---------|
| G | Bundle 管理 | Studio | ✅ 已完成 | 无需开发 |
| I | Wallpaper→Theme | Studio | ✅ 已完成 | 无需开发 |
| J | 合规检查增强 | Studio | 🟡 部分完成 | 添加健康评分 + 不透明层 + WCAG |
| K | FX Dock 真 agent | 跨页面 | ✅ 核心完成 | 仅缺 7 个 CSS 字段推送 |

### P1 — 需小量后端扩展

| 编号 | 名称 | 页面 | 修正说明 |
|------|------|------|---------|
| A | 健康检查报告渲染 | Workspace | 有效，数据源已就绪（THEME_HEALTH_REPORT） |
| B | Live Tweak 完整 CSS 字段 | 跨平台 | 工作量从"全量"修正为"补充 7 个缺失字段" |
| D | 预设系统重塑 | Workspace | 有效，但需结构性改造而非简单扩展 |
| E | Agent CSS 变量目录 | Workspace | 有效，数据源 agents-profiles/ 已就绪 |

### P2 — 需后端新增接口

| 编号 | 名称 | 页面 | 修正说明 |
|------|------|------|---------|
| C | 真实 CDP 实时预览 | Workspace | 有效，AgentLivePreview.tsx 仍是静态 iframe |
| F | 安全态势指示器 | Workspace | 有效，extract-asar-summary 已输出 security.* |
| L | 工程创建 Profile 引导 | Studio | 有效，agents-profiles/ 数据未在创建流程使用 |
| M | Agent 架构浏览器增强 | Studio | 有效，Visual Summary 卡片可扩展 |

### P3 — 长期高价值

| 编号 | 名称 | 页面 | 修正说明 |
|------|------|------|---------|
| H | CSS 源码编辑器 | Studio | 有效，CenterTabRaw.tsx 确实是纯占位符 |
| N | 自动选择器发现 | 底层 | 有效，高阶构想 |

---

## 四、精确代码位置索引

### 4.1 需要修改的文件（方案涉及）

| 文件 | 涉及接入点 | 当前状态 |
|------|-----------|---------|
| `src/ui/stores/workspace-presets.ts` | D | 5 预设等价，无差异化 |
| `src/main/services/tweak-injector.ts` | B | overridesToCssSimple 缺 7 字段 |
| `src/main/theme-health-check.ts` | A | HealthCheckReport 完整，需 UI 渲染 |
| `src/ui/components/workspace/AgentLivePreview.tsx` | C | 静态 iframe 回放 |
| `src/shared/i18n.ts` | 命名 | cmdGoDashboard/cmdGoWorkspace 不一致 |

### 4.2 已验证无需修改的文件

| 文件 | 涉及接入点 | 实际状态 |
|------|-----------|---------|
| `src/ui/components/studio/center/CenterTabBundle.tsx` | G | 完整实现 |
| `src/ui/components/studio/center/CenterTabWallpaper.tsx` | I | 完整实现 |
| `src/ui/components/studio/DockTabFX.tsx` | K | 已双轨渲染 |
| `src/ui/components/studio/center/CenterTabInspect.tsx` | J | 部分实现，可增强 |
| `src/ui/components/studio/center/CenterTabRaw.tsx` | H | 纯占位符 |

### 4.3 关键 IPC 通道

| 通道 | 方向 | 状态 |
|------|------|------|
| `workspace:tweak:push` | renderer → main | ✅ 实现 |
| `workspace:tweak:save` | renderer → main | ✅ 实现 |
| `workspace:tweak:reset` | renderer → main | ✅ 实现 |
| `theme:health-report` | main → renderer | ✅ 实现 |
| `studio:bundle:list/import/install/delete` | 双向 | ✅ 全部实现 |
| `studio:project:*` | 双向 | ✅ 全部实现 |
| `studio:snapshot*` | 双向 | ✅ 全部实现 |
| `studio:inspect:*` | 双向 | ✅ 全部实现 |
| `studio:image:extract-theme` | renderer → main | ✅ 实现 |

---

## 五、建议的修正后实施优先级

### 第一批（立即可做，UI + 后端已就绪）

1. **命名修正**: `cmdGoDashboard` '仪表盘' → '概览'，`cmdGoWorkspace` '工作空间' → '工作台'
2. **合规检查增强**: CenterTabInspect 增加健康评分 + 不透明层 + 阻塞列表（数据源已就绪）
3. **健康检查报告渲染**: WorkspacePage 订阅 THEME_HEALTH_REPORT 渲染详情面板

### 第二批（小量扩展）

4. **Live Tweak 字段补全**: tweak-injector.ts 补充 colors/dim/contrast/saturate/scale/invert/opacity/gradientAccent 的 CSS 生成
5. **预设系统改造**: workspace-presets 支持差异化配置 + generator 从 CDP 反向

### 第三批（需新接口）

6. **安全态势指示器**: 从 asar profile 渲染 contextIsolation/sandbox/CSP
7. **工程创建 Profile 引导**: Studio 工程创建时展示 agent profile 摘要

### 第四批（长期）

8. **CSS 源码编辑器**: CenterTabRaw 填充 + CDP CSS.getStyleSheetText 集成
9. **自动选择器发现**: 离线 asar 分析 + 运行时验证

---

## 六、总结

原方案的**战略方向正确**，对沉睡能力的识别准确率高（asar 数据利用率低、CDP 分析层能力未充分渲染、预设系统等）。但**战术层面有 3 个严重错误**：

1. 误判 CenterTabBundle 为占位符（已完成）
2. 误判 CenterTabWallpaper 为占位符（已完成）
3. 误判 DockTabFX 为 mock-only（已双轨推送）

这导致原方案 P0 中 3 个接入点有 2 个已经不需要"开发"，1 个（FX Dock 真推）核心已完成。

修正后，实际剩余工作量比原方案估计的**减少约 30-40%**，且 high-hanging fruit（合规检查增强、健康检查渲染、Live Tweak 字段补全）的优先级应提升。
