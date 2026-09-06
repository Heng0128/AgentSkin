<!--
  RFC 文档遵循项目文档规范：
  - 文件命名：YYYY-MM-DD-kebab-case.md
  - 状态标记：待评审 / 已评审 / 已落地 / 已废弃
  - 日期与分支：待定状态注明
-->
# RFC：社区多来源页面（新增顶级「社区」页 + 侧边栏可放宽）

> 状态：`待评审` → 评审计入项见 §8
> 日期：2026-09-03 创建，2026-09-04 补强（三项短板修订）
> 分支：待定
> 范围：`src/ui/`（navigation / App / sidebar / community）、`src/shared/types/community.ts`、`src/main/community/`
>
> 本 RFC 已按多子智能体并行审计结论补强 §6 错误边界、§7 缓存策略、§9 source健康探针三项短板。修订项标注 `[修订-补强]` 标签。

***

## 1. 背景与目标

### 1.1 背景

AgentSkin 当前只有 **DreamSkin 一个已接入社区**，其主题已 **400+**。未来确认会继续接入多社区（CodeDrobe、可能的 DSH 等）。

现状痛点：

- 「社区主题」只是**主题页里的一个 Tab**（`ThemesPage` 的 installed / community），由 `CommunityTabPanel` 渲染**单一扁平网格**。一旦多社区共用一个 `total` 混排，**无法区分来源**，随着主题量增长（DreamSkin 已 400+）会彻底不可用。

- 各社区**格式/API/交互不同**（DreamSkin=10 色 palette→昼夜；CodeDrobe=多应用 CSS 包+sha256；未来 DSH=npm 插件）。若每社区手抄一个页面，接入成本线性膨胀且不可维护。

- 侧边栏固定 56px 纯图标（`w-14`），顶级页增多后无法容纳/表达多层级。

- **主题安装后丢失来源追溯**：社区主题安装进本地库后，用户无法知道其原始来源，在主题冲突或更新排查时会造成困惑。[修订-补强]

### 1.2 目标

1. 新增第 7 个顶级页面 **「社区」**，作为社区主题的总入口（突破六页封顶）。【修订-补强 - 单source价值论述见§1.3】
2. **社区来源隔离**：每个社区 = 一个 `CommunitySource`，UI 只写一次，接入新社区仅登记 source。
3. 默认**按来源隔离**展示，`source + themeId` 天然去重。
4. **侧边栏可放宽/收起**，容纳新的顶级页与将来的多层级。
5. **安装后来源追溯**：主题安装时保留来源标识（`installedFrom: sourceId`），在已安装主题页可标注原始社区。[修订-补强]

### 1.3 [修订-补强] 单source时独立顶级页的价值

即使在当前仅有 DreamSkin 一个社区 source 的情况下，独立顶级页仍具有以下价值：

- **心智模型分离**：已安装主题是用户自己的资产（管理心态），社区主题是外部发现物（探索心态）。两者混在同一页面会导致操作意图模糊。
- **导航位置稳定性**：当未来新增 CodeDrobe 时，用户已熟悉社区入口在第七个顶级位置，不会因Tab位置变化而产生困惑。
- **运营位预留**：社区页的运营位（精选主题、运营活动、Banner推广）在Tab中难以实现，在顶级页可拥有完整的首屏宽度。
- **竞品参考**：DreamSkin Gallery、Catppuccin 色板库、VSCode Themes 均采用独立入口模式。

***

## 2. 触发条件（对照 AGENTS.md §6）

- [ ] 重构注入架构（L0-L4 注入层）
- [x] **新增 UI 页面（突破六页封顶）**
- [ ] 新增适配器（突破六适配器上限）
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）

> 本次命中「新增 UI 页面（突破六页封顶）」，按黄金规则 §7.5 提交本 RFC，经评审通过后实施。

***

## 3. 现状侦察（代码锚点）

| 锚点 | 说明 |
| --- | --- |
| `src/ui/types/navigation.ts` | `Route = 'workspace'\|'apps'\|'themes'\|'wallpaper'\|'studio'\|'settings'`（6 页封顶） |
| `src/ui/App.tsx:264-272` 及 L72-84 | 路由 switch → lazy 页面（新增 `'community'` 分支点） |
| `src/ui/components/sidebar.tsx:18-24,48` | `NAV_ICONS` 固定 5 项，`w-14` 纯图标，无放宽/收起状态 |
| `src/ui/stores/shellStore.ts:39-40,51-52,73,88-105` | **已内置** `sidebarCollapsed` 状态和持久化基础设施 |
| `src/ui/pages/ThemesPage.tsx:57-78` | `installed` / `community` 两个 Tab，社区是嵌在主题页内 |
| `src/ui/components/themes/CommunityTabPanel.tsx` | 单一社区扁平网格：search/sort/load-more/master-detail |
| `src/ui/stores/communityStore.ts` | DreamSkin 社区 store（list/install/download/cancel/重试） |
| `src/shared/types/community.ts` | `CommunityThemeSummary/Detail/ListParams/ListResult`（DreamSkin 契约） |
| `src/main/community/community-theme-api.ts` | main 进程 DreamSkin 代理，`API_BASE = https://api.dreamskin.cc/v1` |
| `src/main/community/community-color-bridge.ts` | DreamSkin 10 色 → AgentSkin 14-token 桥接 |
| `src/shared/import/theme-source-parser.ts` | 导入解析器注册表（已有 `codedrobeParser` / `dreamskinParser`） |

***

## 4. 设计方案

### 4.1 路由与页面

- `Route` 联合新增 `'community'`。
- `App.tsx` 新增 lazy import `CommunityPage` + route 分支 + `RouteAwareSkeleton` `'community'` 分支（骨架屏配置待设计）。
- `sidebar.tsx` 的 `NAV_ICONS` 新增 `{ route:'community', icon: Users, labelKey:'navCommunity' }`。

### 4.2 页面结构（两层：来源 → 主题）

```
CommunityPage
├── SourceRail（左侧：社区来源列表，DreamSkin ✓ · CodeDrobe（待接入）
│                每个 source 显示：名称 + 主题数 + 在线/降级状态徽标
│                单source时也展示以保持布局一致性，视觉弱化为顶部筛选标签）
├── SourceThemeGrid（中央：复用 CommunityTabPanel 核心逻辑，绑定 activeSource
│   ├── search（仅搜索当前 active source，source切换后清空搜索词与排序重置为默认）
│   ├── sort / filter
│   └── 卡片网格（按 source+themeId 隔离）
└── ThemeDetailPanel（右侧，复用现有）
```

- 从 `ThemesPage` **迁出** community Tab，`ThemesPage` 恢复为纯「已安装主题」单 Tab（去 Tab 结构）。
- 只有一个 source（当前 DreamSkin）时，`SourceRail` 保持展示但视觉弱化为单行标题而非占据左侧栏——避免用户无法感知其他 source 的预留位置；source ≥ 2 时展开为完整左侧栏。

### 4.3 `CommunitySource` 抽象（核心）

```ts
/**
 * 社区来源抽象。每个外部主题市场实现此接口即完成接入。
 *
 * `status` 即为**运行时推断**——由 UI 层通过 §9 健康探针动态更新，
 * 非 source 静态声明。初始值 `'online'`，首次探测后校正。
 */
interface CommunitySource {
  id: CommunitySourceId;                 // 'dreamskin' | 'codedrobe' | ...
  name: string;                          // 展示名：「DreamSkin」
  icon: LucideIcon | string;             // Lucide 图标或图片URL（未来社区自定义徽标）

  /** 该来源的主题清单；返回已归一化的 CommunityThemeSummary[] */
  api: {
    list?: (params: CommunityThemeListParams) => Promise<CommunityThemeListResult>;
    get?: (themeId: string) => Promise<CommunityThemeDetail>;
    download?: (themeId: string, signal?: AbortSignal) => Promise<Uint8Array>;
    /** 健康探针：返回 true 表示可用。可选，默认走通用 HEAD 请求。 */
    healthCheck?: () => Promise<boolean>;
  };

  /** 下载字节 → IR → .agentskin-theme 的转换（复用 theme-source-parser 注册表） */
  importer?: ThemeSourceImporter;

  capabilities: {
    paid?: boolean;                      // 付费主题标记为不可一键安装
    pagination?: 'page' | 'cursor';      // 分页模式（DreamSkin=page，未来可能有cursor）
    supportsRating?: boolean;            // 是否支持评分排序
    supportsTagFilter?: boolean;         // 是否支持tag筛选
  };

  /** 运行时推断状态，UI层通过健康探针动态更新 */
  status: 'online' | 'degraded' | 'offline';

  /** 缓存配置，各source独立TTL */
  cacheTTL: number;                      // 毫秒，默认 5 * 60 * 1000
}
```

- `communityStore` 重构为 **source 驱动**：持有 `sources: Record<SourceId, CommunitySourceState>` 与 `activeSourceId`，每 source 状态（themes/total/loading/error/installingIds…）独立，**避免多来源状态串扰**。

- 现有 DreamSkin 的 IPC（list/get/download）与 `community-theme-api.ts` 原样封装进 `dreamskin` source，**行为不回归**。

- 新社区接入 = 新增一个 `CommunitySource` 实例 + 登记，不重复写 UI。

### 4.4 数据契约

- 保留 `CommunityThemeSummary/Detail` 为**统一对外模型**（已存在，勿破坏）。
- 各 source 的 API client 负责把**异构原始报文映射到统一模型**：
  - DreamSkin：已实现（`mapApiToThemeSummary`）。
  - CodeDrobe（未来）：根据抓包/文档映射。
- `community-color-bridge.ts`（DreamSkin→token）仅 DreamSkin 内部使用，不泛化。

### 4.5 去重策略（已拍板：默认按来源隔离）

- 语义为 `sourceId + themeId` 为唯一键，**天然去重**。
- 跨源视觉重复（同名/IP 同款）**不做归一化**，保持各来源独立；后续按需单独立项。

### 4.6 侧边栏可放宽/收起

> **重要发现**：`shellStore.ts` 已内置 `sidebarCollapsed: boolean`、`setSidebarCollapsed()`、`toggleSidebar()` 及其 localStorage 持久化逻辑（键名 `agentskin:sidebar-clapsed`）。B3 阶段仅需更新 sidebar 组件的 CSS 变量映射与交互，无需新增 store 状态。

实现要点：
- 收起态 `w-14`（当前）、放宽态 `w-48`（192px，符合 Tailwind `w-48` 档）。
- 放宽态下显示完整标签文本 + 来源/子项缩进空间；收起态保留 tooltip。
- 折叠偏好跨会话持久化（**已有** SIDEBAR_KEY localStorage 机制）。
- 所有页面主内容区通过 CSS 变量 `--sidebar-width` 自适应（避免硬编码 w-14）。

### 4.7 安装链路（不变）

社区主题下载 → 走 `theme-source-parser` 注册表转为 `.agentskin-theme` → 进入主题库安装（沿用现有 install/cancel/progress）。未知来源格式在解析层报错、不崩溃。

### 4.8 [修订-补强] 来源追溯

安装链路增加来源标记：

- `communityStore.installTheme` 完成时，将 `{ themeId, sourceId, installedAt }` 写入 `installationLog: Map<string, InstallationRecord>`。
- `themeStore.installedThemes` 中新增可选字段 `sourceId?: CommunitySourceId`，安装时由 bridge 注入。
- ThemesPage 的已安装主题卡片在 hover 时显示来源徽标（如「DreamSkin」标签）。

```ts
interface InstallationRecord {
  themeId: string;
  sourceId: CommunitySourceId;
  installedAt: number;       // Date.now()
  sourceThemeVersion: string;
}
```

***

## 5. 分批落地计划（按风险/收益排序，每批 `npm run check` 全绿）

| 批 | 内容 | 改动范围 | 验证标准 |
| -- | --- | --- | ------- |
| **B1** | Source 抽象 + `communityStore` 重构为 source 驱动（仅 DreamSkin，行为不变）+ 健康探针 + 缓存层 + 安装来源追溯 | store / types / api 封装 | **量化标准**：a) 现有社区测试用例 100% 通过（≥12 个用例覆盖 load/install/cancel/loadMore）；b) 新增 DreamSkin 行为不回归测试 ≥3 个（含详情加载失败、网络超时降级、source健康探针）；c) `installationLog` 字段完整写入验证 |
| **B2** | 新增顶级「社区」页 + 路由/侧边栏入口，`ThemesPage` 迁出 community Tab | navigation / App / ThemesPage / sidebar / 新 `CommunityPage` | **量化标准**：a) CommunityPage 单测 ≥5 个（渲染、source切换、骨架屏）；b) ThemesPage 单测从双 Tab 迁出后仍 ≥6 个（详情/导入/export不回归）；c) 手动 E2E 验收清单 ≥10 项（DreamSkin 加载→搜索→排序→详情→安装→应用全流程）；d) 骨架屏配置 `aspect: '16/9'` 与现有 ThemesPage/WallpaperPage 一致 |
| **B3** | 侧边栏可放宽/收起（基于 shellStore 已有基础设施） | sidebar 组件 CSS 变量映射 | **量化标准**：a) 所有 7 个页面在 w-14 / w-48 两档下布局不溢出（Playwright 视口 1280x720 + 1920x1080）；b) sidebarCollapsed localStorage 持久化验证（关闭再打开保留状态）；c) tooltip 在 w-48 态隐藏、w-14 态显示 |
| **B4** | 接入 CodeDrobe source（复用解析器 + 新 api client）+ 离线降级展示 | 新 `codedrobe` source | **量化标准**：a) CodeDrobe API 探针自动标记 online/degraded/offline；b) CodeDrobe 离线时 communityPage 「CodeDrobe」条目显示降级徽标但不阻塞 DreamSkin 展示；c) CodeDrobe parser→IR→agentskin-theme 转换流程 ≥2 个 E2E |

***

## 6. [修订-补强] 错误边界与空状态设计

### 6.1 页面级错误边界（Page-Level ErrorBoundary）

```tsx
<ErrorBoundary
  fallback={({ error, reset }) => (
    <CommunityErrorState
      title="社区加载失败"
      message={error.message}
      onRetry={reset}
    />
  )}
>
  <CommunityPage />
</ErrorBoundary>
```

- `ErrorBoundary` 复用社区已有组件（需确认路径，通常位于 `src/components/ErrorBoundary.tsx`）。
- `CommunityErrorState` 为新组件：插画（lucide AlertCircle）+ 错误摘要 + 「重试」按钮 + 「返回已安装主题」跳转链接。

### 6.2 Source 级错误隔离

每个 source 卡片在 SourceRail 内的错误**不传播**至其他 source：

- DreamSkin 加载失败 → DreamSkin 卡片显示红色徽标 + 「暂时不可用」提示 + 点击重试按钮。
- CodeDrobe 加载失败 → 仅 CodeDrobe 卡片降级，不影响 DreamSkin 列表。
- 中央主题网格在 activeSource 加载失败时显示 `CommunityErrorState`（source-specific 错误），其他 source 的数据不受影响。

```ts
// communityStore 错误隔离结构
interface CommunitySourceState {
  status: 'online' | 'degraded' | 'offline';
  error: string | null;          // 独立错误信息，不污染其他 source
  loading: boolean;              // 独立 loading 态
  themes: CommunityThemeSummary[];
  // ... 其他状态
}
```

### 6.3 多级空状态

| 场景 | 空状态内容 |
| --- | -------- |
| **全部 source 离线** | 插画 + 「网络不可达，请检查网络连接」+ 「重试」按钮 + 「浏览已安装主题」跳转 |
| **某 source 缓存为空** | 插画 + 「暂无主题，请稍后再试」 |
| **搜索结果为空** | 插画 + 「没有找到匹配的主题」+ 「清除搜索词」按钮 |
| **source 降级但有缓存** | 主题列表顶部 banner：「数据可能不是最新，点击查看最新」|

### 6.4 安装错误隔离

- 安装失败仅影响该 `installingIds` 中的特定 `themeId`，不阻塞其他安装。
- 安装失败自动重试 3 次（沿用现有 `MAX_RETRIES=3` + `RETRY_DELAY_MS=2000`）。
- 重试耗尽后，该主题显示安装失败徽标 + 「重试安装」按钮，不影响其他主题的安装状态。

***

## 7. [修订-补强] 缓存与刷新策略

### 7.1 缓存结构

```ts
interface SourceCacheEntry<T = CommunityThemeSummary[]> {
  data: T;
  fetchedAt: number;        // Date.now()
  ttl: number;              // 毫秒，默认 5 * 60 * 1000（5分钟）
  sourceVersion?: string;   // 用于版本校验
}

interface CommunitySourceState {
  cache?: SourceCacheEntry<CommunityThemeSummary[]>;
  detailCache: Map<string, SourceCacheEntry<CommunityThemeDetail>>;
  // ...
}
```

### 7.2 缓存策略规则

| 场景 | 行为 |
| --- | --- |
| **首次加载** | 无缓存 → 发起 API 请求 → 成功后写入缓存（`fetchedAt=Date.now()`） |
| **source 切换（缓存未过期）** | 直接读取缓存 → **即时显示** → 后台静默刷新（`backgroundRefresh=true`） |
| **source 切换（缓存已过期）** | 显示旧缓存 + 「数据可能不是最新」banner → 发起刷新 → 成功后替换缓存 |
| **用户手动刷新（下拉/按钮）** | 强制刷新，忽略缓存 → 加载态 → 成功后替换缓存并清除 banner |
| **应用从后台恢复（`visibilitychange`）** | 若任何 active source 缓存超过 `ttl/2`（2.5分钟），静默后台刷新 |
| **安装成功后** | 更新 `installedIds` set → 通知 themeStore.refreshThemes() **并**将该 source 的缓存标记为 stale（下次切换时刷新） |

### 7.3 缓存 TTL 默认值

- **主题列表**：`5 * 60 * 1000`（5分钟）——社区主题更新频率低
- **主题详情**：`30 * 60 * 1000`（30分钟）——详情更稳定
- **降级模式**：source offline 时延长缓存有效期至 `30 * 60 * 1000`（避免频繁刷新失败提示）

### 7.4 跨 store 缓存一致性

安装完成后需同步两处缓存：

```
communityStore.installTheme() 成功后：
  1. communityStore.markInstalled(themeId)     ← 更新本 source 的 installedIds
  2. useThemeStore.getState().refreshThemes()   ← themeStore 刷新已安装列表
  3. 将 communityStore.activeSource.cache标记为 stale  ← 确保下次切换时刷新
```

***

## 8. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
| - | --- | -- | ------ | ------ | ------ |
| 1 | 突破六页封顶合规 | 高 | 新增顶级页 | 本 RFC 即评审依据 | 评审通过后才实施 |
| 2 | 多来源状态并发串扰 | 中 | 来源≥2 同时加载/安装 | 每 source 独立状态切片 + **独立 RequestToken 实例**（非全局）| `npm test` 社区 store 回归（B1 新增快速连续 source 切换测试用例）|
| 3 | source API 不稳定/付费 | 中 | CodeDrobe 等第三方接口变更 | client 统一超时/降级 `status:'degraded'`；付费主题禁装；§9 健康探针自动标记 | 探针 + 状态展示 + 离线缓存兜底 |
| 4 | 侧边栏放宽破坏布局 | 中 | 状态切换时局部错位 | CSS 变量 `--sidebar-width` 解耦（组件不硬编码 w-14）；折叠态持久化已有 | 组件测试 / 双档视口 Playwright 验证 |
| 5 | ThemesPage 迁出社区回归 | 中 | Tab 结构改动 | 迁移期保留旧 Store 兼容，分 B1/B2 落地隔离 | `npm run check` 全绿 + B2 量化 E2E 清单 |
| 6 | communityStore 重构引入 RequestToken 竞态 | **修订-补强** | B1 将扁平 themes 改为 sources Record 后，activeSourceId 切换与 loadThemes 产生新竞态 | **每个 source 独立 RequestToken 实例**，取消全局 token | B1 新增"快速连续 source 切换"测试用例（100ms 内连续切换） |
| 7 | 缓存一致性问题 | **修订-补强** | 已安装主题的社区Tab与社区页看到的数据版本不一致 | §7.4 跨 store 缓存一致性协议（安装成功同时刷新两处缓存） | B1 新增缓存同步 E2E 测试 |

***

## 9. [修订-补强] Source 健康探针设计

### 9.1 探测时机

| 时机 | 行为 |
| --- | --- |
| **source 注册时** | 立即发起首次健康探针；超时 2 秒未响应则标记 `degraded` 并使用缓存数据（若有）|
| **应用启动时** | 对所有已注册 source 并行首次探测（`Promise.allSettled`），总超时 5 秒 |
| **后台定期探测** | 每 60 秒对 `activeSource` 发起探测；非 active source 每 5 分钟探测 |
| **用户手动重试** | 点击 source 卡片的「重试」按钮 → 立即探测 |
| **source 加载失败后** | 延长退避至 30 秒再探测 |

### 9.2 探测实现

```ts
async function probeSourceHealth(source: CommunitySource): Promise<boolean> {
  // 优先使用自定义探针
  if (source.api.healthCheck) {
    const result = await Promise.race([
      source.api.healthCheck(),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
    ]);
    return result;
  }

  // 默认探针：HEAD 请求 API_BASE
  try {
    const url = new URL(source.apiBaseUrl);
    const response = await net.fetch(url.origin, { method: 'HEAD' });
    return response.ok;
  } catch {
    return false;
  }
}
```

### 9.3 状态转换规则

```
online ───(连续 2 次探测失败)──▶ degraded ───(再连续 3 次失败)──▶ offline
  ▲                                                               │
  └───────────────────(任意一次成功)───────────────────────────────┘
```

- `online`→`degraded`：连续 2 次失败，激活 banner 「连接不稳定，数据可能不是最新」
- `degraded`→`offline`：再连续 3 次失败，激活 banner 「暂时不可用」+ source 卡片红色徽标
- 任意成功立即恢复为 `online`，清除 banner

### 9.4 降级模式行为

- `degraded`：仍显示缓存数据 + banner 提示；发起 API 请求但 2 秒超时则继续复用缓存
- `offline`：仅显示缓存数据（若有）+ 灰色禁用态；用户可点击「重试」按钮触发即时探测

***

## 10. 人工复核项

- [x] 顶级页命名确认：「社区」（已初定）— 2026-09-04 确认
- [ ] 多来源各带独立视觉标识（名称/图标/来源徽标），避免卡片混淆的呈现方式
- [ ] 社区页是否完全复用主题页的搜索/排序/详情范式，还是允许部分差异
- [ ] 侧边栏放宽宽度具体档位（`w-48` = 192px 是否够容纳来源子项）— 已确认满足
- [x] 社区主题安装后标明来源 → 新增 `installationLog` + `sourceId` 字段（§4.8）
- [ ] SourceRail 单 source 时视觉样式（弱化标签 or 完整侧边栏占位）需设计确认

***

## 11. 评审结论

（由评审人员填写）

**评审准则**：

- §1 背景与目标是否完整？
- §4 设计方案是否覆盖 §6-9 的补强内容？
- §5 分批计划验证标准是否可量化、可重复？
- §8 风险识别是否完整（含修订-补强项 R6/R7）？
- 是否遵循 AGENTS.md §6 黄金规则？
- 是否遵循 design-tokens.md / Tailwind 标准档？

**评审人签字**：____________  日期：____________

***

## 附录 A：竞品参考（佐证本方案选取）

| 参考项目 | 借鉴模式 | 应用位置 |
| --- | --- | --- |
| DreamSkin Gallery | 独立顶级入口 + 卡片网格 + 详情面板 + 一键换肤 | CommunityPage 整体布局 |
| Catppuccin | 中央 palette + 多平台转译 + flavor 变体 | CommunitySource 抽象（每个 source 类似一个 flavor） |
| vscodethemes | URL-state 驱动的搜索/过滤 + 市场扫描器+本地索引 | SourceThemeGrid 搜索交互 |
| BetterDiscord/Vencord | Plugin manifest schema + Patcher API 设计哲学 | CommunitySource 接口设计（扩展而非修改） |
| iTerm2-Color-Schemes | 源格式→转译器→多平台产地的去重验证 | theme-source-parser 注册表 |

## 附录 B：多维评分选型结论

本 RFC 方案经 8 维加权评分，业务根治度 9/10、长期演进性 9/10，加权总分 7.05/10。备选方案 A（最小侵入 Tab 式）6.30/10、备选方案 C（侧滑抽屉式）7.15/10。方案 B 虽然总分非最高，但在"根治多 source 痛点"与"未来平台化扩展"上具有不可替代性。

详细评分矩阵见选型报告对应章节。
