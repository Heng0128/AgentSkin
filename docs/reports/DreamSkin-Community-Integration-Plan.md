# DreamSkin 社区主题系统集成 — 最终实施计划

> 版本: 1.0 | 日期: 2026-08-20 | 状态: Ready for Implementation

---

## 1. 概要

### 1.1 目标
将 DreamSkin 社区主题生态（外部 API + CDN 资源）集成到 AgentSkin 桌面端作为"社区"主题来源。用户在 ThemesPage 的"社区" Tab 中浏览、搜索、一键安装社区主题包，与本地主题共用同一 ThemeLibrary/Catalog/Apply 管线。

### 1.2 架构原则
- **引擎非产品**：社区模块仅作为 ThemeLibrary 的一个数据源注入点，不新增独立产品形态
- **复用现有管线**：CommunityTheme → (桥接) → InstalledThemePackage → ThemeInstaller → ThemeLibrary
- **零服务端**：主进程直接请求 DreamSkin API（Cloudflare CDN），无自建后端
- **预览图代理**：CDN 资源走主进程代理 + 磁盘缓存，避免 Electron renderer 跨域

### 1.3 不变量影响

| # | 不变量 | 影响 |
|---|--------|------|
| C1 | AgentId 四源一致 | 新桥接层 `community-color-bridge.ts` 适配 apps→targets 映射，不破坏四源 |
| C2 | 14-token 主题契约 | `token-generator.ts` 已有 HCT tonal 推导，桥接层补齐 10→14 token |
| C3 | Palette-CSS 同步 | 社区主题经桥接后走 ThemePackageLoader→ThemeInstaller→generateFallbackCss |
| C4 | 分层依赖方向 | community/ 在 catalog/ 同级，单向依赖 catalog/ 和 services/ |
| C5 | Store 契约一致性 | communityStore 与 themeStore 平级，跨 store 通过 getState() 通信 |

---

## 2. 文件清单

### P0 — 必须最先完成：核心服务层 + IPC + 类型定义

| 文件路径 | 操作 | 职责 |
|----------|------|------|
| `src/shared/types/community.ts` | 新建 | DreamSkin API 响应类型 + CommunityTheme 接口 |
| `src/main/community/community-api-client.ts` | 新建 | HTTP 客户端：主题列表/详情/搜索/下载的缓存 + 超时机 |
| `src/main/community/community-color-bridge.ts` | 新建 | 10 色 → 14-token 桥接（复用 HCT tonal palette 推导） |
| `src/main/community/community-package-converter.ts` | 新建 | CommunityTheme + ZIP bytes → InstalledThemePackage（目录包） |
| `src/main/ipc/community-theme-ipc.ts` | 新建 | 4 个 IPC handler（list/search/detail/install） |
| `src/shared/ipc-channels.ts` | 修改 | 新增 5 个社区通道常量 |

### P1 — 基础功能：UI 组件 + Store + i18n

| 文件路径 | 操作 | 职责 |
|----------|------|------|
| `src/ui/stores/communityStore.ts` | 新建 | Zustand store：社区 Tab 状态、分页、搜索词、下载进度 |
| `src/ui/components/themes/CommunityTab.tsx` | 新建 | 社区 Tab 容器：顶部搜索 + 瀑布流/卡片网格 |
| `src/ui/components/themes/CommunityThemeCard.tsx` | 新建 | 社区主题卡片：预览图 + 名称 + 作者 + 安装按钮 |
| `src/ui/pages/ThemesPage.tsx` | 修改 | 新增 "社区" Tab 分区，与本地主题 Tab 并列 |
| `src/shared/i18n.ts` | 修改 | 新增 community.* 国际化键（zh-CN + en） |
| `src/ui/api/agentSkinClient.ts` | 修改 | 扩展 AgentSkinApi 表面暴露社区方法 |

### P2 — 体验优化：进度推送 + 缓存 + 错误处理

| 文件路径 | 操作 | 职责 |
|----------|------|------|
| `src/main/community/community-asset-cache.ts` | 新建 | 预览图/图标的磁盘缓存 + LRU GC |
| `src/main/community/community-download-progress.ts` | 新建 | 下载进度事件推送（main→renderer） |
| `src/ui/components/themes/CommunityThemeCard.tsx` | 修改 | 集成进度条 + 错误重试 |
| `src/main/ipc/community-theme-ipc.ts` | 修改 | 完善错误码映射 + 通知推送 |

### 测试文件（与实现同步创建）

| 文件路径 | 覆盖 |
|----------|------|
| `tests/main/community/community-api-client.test.ts` | API 客户端缓存、超时、重试 |
| `tests/main/community/community-color-bridge.test.ts` | 色桥推导正确性、边界色值 |
| `tests/main/community/community-package-converter.test.ts` | ZIP 解压 + 转换 + 路径安全 |
| `tests/main/ipc/community-theme-ipc.test.ts` | IPC handler 输入校验 + 错误路径 |
| `tests/ui/stores/communityStore.test.ts` | Store 状态机 + 分页 + 搜索 |
| `tests/main/community/community-integration.test.ts` | 端到端：API→下载→转换→安装→IPC |

---

## 3. 每个文件的详细规格

### 3.1 P0 核心文件

#### 3.1.1 `src/shared/types/community.ts`

**新建** — 社区主题相关的共享类型定义。

```typescript
// DreamSkin API 响应形状（基于 Cloudflare CDN API 反推）
export interface DreamSkinThemeItem {
  id: string;
  name: string;
  author: { name: string; url?: string };
  version: string;
  description?: string;
  previewUrl: string;
  iconUrl?: string;
  zipUrl: string;
  downloads: number;
  rating: number;
  category: string;
  tags: string[];
  colors: {
    primary: string;
    background: string;
    surface: string;
    text: string;
    accent: string;
    secondary?: string;
    muted?: string;
    border?: string;
    codeBg?: string;
    codeFg?: string;
  };
  apps: string[]; // DreamSkin 侧的应用标识（如 "trae", "qoder"）
  size: number;   // ZIP 字节数
  createdAt: string;
}

export interface DreamSkinSearchResult {
  items: DreamSkinThemeItem[];
  total: number;
  page: number;
  pageSize: number;
}

// UI 层使用的社区主题引用（已从 API 转换但与'本地主题'平行）
export interface CommunityThemeRef {
  apiId: string;
  name: string;
  displayName?: string;
  author: { name: string; url?: string };
  version: string;
  description?: string;
  previewUrl: string;
  iconUrl?: string;
  category: string;
  tags: string[];
  apps: string[]; // 已映射到 AgentId（compat → targets）
  colors: CommunityColors;
  downloads: number;
  rating: number;
  size: number;
  installed: boolean; // 本地是否已安装
  installedThemeId?: string; // 安装后的本地 theme id
}

export interface CommunityColors {
  primary: string;
  background: string;
  surface: string;
  text: string;
  accent: string;
  secondary?: string;
  muted?: string;
  border?: string;
  codeBg?: string;
  codeFg?: string;
}

// 桥接后的 14-token 输出（与 ThemeColors 兼容）
export interface CommunityTokenOutput {
  mode: 'light' | 'dark';
  accent: string;
  accentMuted: string;
  secondary: string;
  background: string;
  foreground: string;
  muted: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  codeBackground: string;
  codeForeground: string;
  inputBackground: string;
  buttonBackground: string;
  buttonForeground: string;
  focusRing: string;
  inference: Record<string, 'provided' | 'derived' | 'default'>;
}
```

**依赖**: 无外部依赖，纯类型。被 `community-api-client.ts`、`community-color-bridge.ts`、`communityStore.ts` 消费。

---

#### 3.1.2 `src/main/community/community-api-client.ts`

**新建** — DreamSkin API 的 HTTP 客户端层。

**核心职责**:
- HTTP GET 请求封装，带超时（默认 10s）、重试（2 次，指数退避）
- 内存缓存（TTL 5 分钟），避免每次翻页都重新请求
- 预览图/图标的本地磁盘缓存（asset-cache 模块）
- ZIP 下载到临时目录（可中断、流式）

**关键接口**:
```typescript
export class CommunityApiClient {
  constructor(options?: {
    baseUrl?: string;        // 默认 https://api.dreamskin.cn/v1
    timeout?: number;        // 默认 10000ms
    retries?: number;        // 默认 2
    cacheTtl?: number;       // 默认 300000ms
  });

  // API: 分页列表
  listThemes(params?: {
    page?: number;
    pageSize?: number;
    category?: string;
    sort?: 'popular' | 'latest' | 'rating';
  }): Promise<DreamSkinSearchResult>;

  // API: 搜索
  searchThemes(query: string, params?: {
    page?: number;
    pageSize?: number;
  }): Promise<DreamSkinSearchResult>;

  // API: 详情
  getTheme(apiId: string): Promise<DreamSkinThemeItem>;

  // API: ZIP 下载（流式写入临时文件）
  downloadThemeZip(
    zipUrl: string,
    onProgress?: (downloaded: number, total: number) => void,
  ): Promise<string>; // 返回临时文件绝对路径

  // API: 预览图/图标下载
  downloadAsset(url: string): Promise<string>; // 返回缓存路径
}
```

**依赖**: `node:https`、`node:fs`、路径校验复用 `theme-package-loader.ts` 的 `resolveWithin` 思路。

---

#### 3.1.3 `src/main/community/community-color-bridge.ts`

**新建** — DreamSkin 10 色 → AgentSkin 14(+1)-token 桥接器。

**核心职责**:
- 接收 `CommunityColors`，输出 `CommunityTokenOutput`
- 对已提供的色值标记 `inference: 'provided'`
- 对推导出的色值标记 `inference: 'derived'`
- 使用 `token-generator.ts` 的 HCT tonal 推导计算缺失 token

**关键函数**:
```typescript
/**
 * 将 DreamSkin 社区 10 色桥接为 14(+1)-token 主题色板。
 *
 * 策略：
 *  - 5 个基础色（primary/background/surface/text/accent）直接使用
 *  - accentMuted = accent 降低 20% 亮度（HCT 推导或简单混合）
 *  - secondary = provided or accent × 0.7
 *  - muted = 中间色（foreground 与 surface 的 40% 混合）
 *  - surfaceElevated = surface 提高 8% 亮度（dark 模式）/ 降低 4%（light 模式）
 *  - border = foreground + alpha(0.12/0.18)
 *  - codeBg = background 的微妙变体
 *  - codeFg = foreground 的高对比变体
 *  - inputBackground = surface 的微妙变体
 *  - buttonBackground = accent + alpha(0.2/0.9)
 *  - buttonForeground = accent 上的可读色
 *  - focusRing = accent + alpha(0.6)
 */
export function bridgeCommunityColors(
  community: CommunityColors,
): CommunityTokenOutput;
```

**算法选择**:
- 优先复用 `token-generator.ts` 的 HCT tonal 路径（当 `@material/material-color-utilities` 可用时提供 primary 色）
-  fallback：纯 TS 实现 HSL 微调（避免运行时新依赖）

**依赖**: `src/main/theme/token-generator.ts`（HCT tonal，可选）。无新运行时依赖。

---

#### 3.1.4 `src/main/community/community-package-converter.ts`

**新建** — 社区主题 ZIP → 标准目录包 → InstalledThemePackage。

**核心职责**:
- 解包 ZIP 到临时目录
- 生成合规的 `manifest.json`（基于 API 返回的元数据 + 桥接后的 colors）
- 从 assets 目录读取/生成预览图 + 图标
- 输出 `InstalledThemePackage` 传给 `ThemeInstaller`

**关键函数**:
```typescript
export class CommunityPackageConverter {
  /**
   * 从已下载的 ZIP + API 元数据构建 InstalledThemePackage。
   *
   * 流程：
   * 1. 解压 ZIP 到 userData/themes/_community/<apiId>/
   * 2. 读取包内 CSS 文件（如有，DreamSkin 包可能只提供颜色）
   * 3. 桥接 colors → 14(+1)-token
   * 4. 生成 v2 manifest.json（apps 映射为 targets）
   * 5. 返回 { packagePath, manifest }
   */
  async convert(
    zipPath: string,
    apiData: DreamSkinThemeItem,
    bridgeResult: CommunityTokenOutput,
  ): Promise<InstalledThemePackage>;
}
```

**关键设计决策**:
- **apps 映射**: DreamSkin 的 `apps: ["trae", "qoder"]` → AgentSkin `compat` 字段。本模块负责转换为 `manifest.targets`（per-agent CSS 目标）
- **CSS 处理**: 社区 ZIP 如含 `theme.css` 等文件则嵌入，否则 ThemeInstaller 走 `generateFallbackCss` fallback
- **路径安全**: 复用 `resolveWithin` 思路，解压后验证所有文件在包目录内

**依赖**: Node 内置 `node:zlib`（基础 ZIP）或 `node:fs` 流式 + 可选 `extract-zip` 库（若在 package.json 已有则复用）。当前代码库未引入 ZIP 库，实现使用 Node 内置 `node:zlib` + `node:fs` 流式解压（避免新增依赖）。如需支持加密/高级 ZIP，后续可改为 `yauzl`。

---

#### 3.1.5 `src/main/ipc/community-theme-ipc.ts`

**新建** — 社区主题 IPC handler 注册。

**核心职责**:
- 处理 renderer 发来的社区主题相关请求
- 校验输入、调用 service、返回结构化响应
- 通过 `webContents.send` 推送下载进度

**IPC Channels**:

| Channel | 方向 | Payload | 返回 |
|---------|------|---------|------|
| `COMMUNITY_LIST` | invoke | `{ page?, pageSize?, category?, sort? }` | `DreamSkinSearchResult` |
| `COMMUNITY_SEARCH` | invoke | `{ query, page?, pageSize? }` | `DreamSkinSearchResult` |
| `COMMUNITY_DETAIL` | invoke | `{ apiId: string }` | `DreamSkinThemeItem` |
| `COMMUNITY_INSTALL` | invoke | `{ apiId: string }` | `InstalledTheme` |
| `COMMUNITY_INSTALL_PROGRESS` | send (main→renderer) | `{ apiId, downloaded, total, percent }` | — |

**关键函数**:
```typescript
export function registerCommunityThemeIpc(
  deps: MainContext,
  apiClient: CommunityApiClient,
  converter: CommunityPackageConverter,
): void;
```

**错误处理**:
- API 不可用 → 返回 `{ error: 'network', message }` 并触发 renderer toast
- ZIP 下载失败 → 返回 `{ error: 'download' }`
- 转换失败（包损坏）→ 返回 `{ error: 'package' }`
- 安装失败 → 透传 library 异常

**依赖**: `electron.ipcMain`、`community-api-client.ts`、`community-package-converter.ts`、`MainContext`。

---

#### 3.1.6 `src/shared/ipc-channels.ts`（修改）

在 `IpcChannel` 对象新增：

```typescript
// --- Community themes (community-theme-ipc.ts) ---
COMMUNITY_LIST: 'community:list',
COMMUNITY_SEARCH: 'community:search',
COMMUNITY_DETAIL: 'community:detail',
COMMUNITY_INSTALL: 'community:install',
COMMUNITY_INSTALL_PROGRESS: 'community:install-progress', // SEND_ONLY
```

---

### 3.2 P1 UI 文件

#### 3.2.1 `src/ui/stores/communityStore.ts`

**新建** — 社区 Tab 的 Zustand store。

**状态模型**:
```typescript
interface CommunityState {
  // 数据
  items: CommunityThemeRef[];
  total: number;
  page: number;
  pageSize: number;
  query: string;
  category: string;
  sort: 'popular' | 'latest' | 'rating';

  // UI 状态
  loading: boolean;
  error: string | null;

  // 下载进度：apiId → percent
  downloadProgress: Record<string, { downloaded: number; total: number; percent: number }>;

  // Actions
  fetchList(): Promise<void>;
  search(query: string): Promise<void>;
  installTheme(apiId: string): Promise<void>;
  loadMore(): Promise<void>;
  setCategory(category: string): void;
  setSort(sort: 'popular' | 'latest' | 'rating'): void;
  clearError(): void;
}
```

**关键实现**:
- `installTheme` 异步调用 `api.community.install(apiId)`
- 通过 `STATUS_CHANGED` 类事件或自定义 community progress 事件更新 `downloadProgress`
- `items` 中每个 `CommunityThemeRef.installed` 在安装成功后从本地 catalog 同步

**依赖**: `@/api/agentSkinClient`、`@shared/types`。

---

#### 3.2.2 `src/ui/components/themes/CommunityTab.tsx`

**新建** — 社区 Tab 容器组件。

**布局**:
- 顶部：搜索框 + 分类下拉 + 排序切换
- 中部：响应式卡片网格（网格 24px gap，卡片 min-width 280px）
- 空状态：空查询提示 / 无结果提示
- 错误状态：带重试按钮的错误横幅

**关键逻辑**:
- `useEffect` 挂载时调用 `communityStore.fetchList()`
- 搜索防抖 300ms
- 滚动触底自动 `loadMore()`

**依赖**: `CommunityThemeCard`、`communityStore`、`@shared/i18n`。

---

#### 3.2.3 `src/ui/components/themes/CommunityThemeCard.tsx`

**新建** — 社区主题卡片组件。

**视觉规格**:
- 预览图（16:10 比例，圆角 8px，object-fit cover）
- 名称 + 作者（单行截断）
- 分类标签 + 下载数
- 安装按钮（已安装则显示"已安装"禁用态）
- 下载中显示进度条

**交互**:
- 点击卡片 → 展开详情（可选：侧滑面板或 modal）
- 点击安装 → 触发 `communityStore.installTheme(apiId)`
- 安装成功 → 按钮变为"已安装"，同时触发 `themeStore.refreshCatalog()`

**依赖**: `communityStore`、`@shared/i18n`、Tailwind 样式。

---

#### 3.2.4 `src/ui/pages/ThemesPage.tsx`（修改）

**修改内容**:
- 在现有 Tab 栏新增"社区" Tab（位于"已安装" Tab 之后）
- 条件渲染：`activeTab === 'community'` 时渲染 `<CommunityTab />`
- 社区 Tab 的 badge 显示"新"或主题总数（可选）

**向后兼容**:
- 默认 Tab 仍为"已安装"，社区 Tab 不改变现有用户行为
- 社区 Tab 数据加载延迟到用户首次切换时（懒加载）

---

#### 3.2.5 `src/shared/i18n.ts`（修改）

新增键（zh-CN + en）:

```typescript
// zh-CN
communityTab: '社区',
communitySearchPlaceholder: '搜索社区主题...',
communityCategoryAll: '全部分类',
communitySortPopular: '最热',
communitySortLatest: '最新',
communitySortRating: '评分最高',
communityInstall: '安装',
communityInstalled: '已安装',
communityInstalling: '安装中...',
communityDownloadCount: (n: string) => `${n} 次下载`,
communityEmpty: '暂无社区主题',
communityLoadFailed: '加载失败，点击重试',
communityNetworkError: '网络连接失败，请检查网络后重试',
communityInstallSuccess: (name: string) => `「${name}」安装成功`,
communityInstallFailed: (name: string) => `「${name}」安装失败`,

// en
communityTab: 'Community',
communitySearchPlaceholder: 'Search community themes...',
// ... 对应英文翻译
```

---

#### 3.2.6 `src/ui/api/agentSkinClient.ts`（修改）

在 `AgentSkinApi` 接口（`shared/types.ts`）新增:

```typescript
// 社区主题
community: {
  list(params?: { page?: number; pageSize?: number; category?: string; sort?: string }): Promise<DreamSkinSearchResult>;
  search(query: string, params?: { page?: number; pageSize?: number }): Promise<DreamSkinSearchResult>;
  detail(apiId: string): Promise<DreamSkinThemeItem>;
  install(apiId: string): Promise<InstalledTheme>;
};
```

在 `preload.ts` 新增对应 `ipcRenderer.invoke` 调用。

---

### 3.3 P2 体验优化文件

#### 3.3.1 `src/main/community/community-asset-cache.ts`

**新建** — 预览图/图标的磁盘缓存。

**策略**:
- 缓存目录: `userData/community-assets/`
- 文件名: `SHA1(url).ext`
- LRU 淘汰: 最大 200MB，超出时删除最旧文件
- TTL: 7 天未访问自动清理

**关键函数**:
```typescript
export class CommunityAssetCache {
  constructor(cacheDir: string, options?: { maxSize?: number; ttl?: number });
  get(url: string): Promise<string | null>; // 返回缓存路径
  put(url: string, sourcePath: string): Promise<string>; // 返回缓存路径
  cleanup(): Promise<void>; // LRU + TTL 清理
}
```

---

#### 3.3.2 `src/main/community/community-download-progress.ts`

**新建** — 下载进度事件推送。

**实现**:
- 在 `CommunityApiClient.downloadThemeZip` 的 `onProgress` 回调中调用 `webContents.send(IpcChannel.COMMUNITY_INSTALL_PROGRESS, payload)`
- renderer 通过 `ipcRenderer.on` 订阅（在 preload 暴露）

---

## 4. 实施步骤

### Day 1（半天 × 2）：基础设施

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | 创建 `src/shared/types/community.ts` | 类型定义完成 |
| 上午 | 修改 `src/shared/ipc-channels.ts` 新增通道常量 | IPC 通道就绪 |
| 下午 | 实现 `src/main/community/community-api-client.ts` | API 客户端 + 缓存 |
| 下午 | 编写 `community-api-client.test.ts` | 单元测试通过 |

**验收**: `npm run typecheck` 全绿，API 客户端单测通过。

---

### Day 2（半天 × 2）：核心服务

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | 实现 `src/main/community/community-color-bridge.ts` | 色桥推导完成 |
| 上午 | 编写 `community-color-bridge.test.ts` | 色桥测试通过 |
| 下午 | 实现 `src/main/community/community-package-converter.ts` | ZIP→目录包转换 |
| 下午 | 实现 `src/main/ipc/community-theme-ipc.ts` | IPC handler 注册 |

**验收**: 手动调用 IPC `community:list` 返回模拟数据，`community:install` 完成端到端安装。

---

### Day 3（半天 × 2）：UI 组件

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | 创建 `src/ui/stores/communityStore.ts` | Store 状态机 |
| 上午 | 编写 `communityStore.test.ts` | Store 测试通过 |
| 下午 | 实现 `CommunityTab.tsx` + `CommunityThemeCard.tsx` | UI 组件 |
| 下午 | 修改 `ThemesPage.tsx` 集成社区 Tab | Tab 切换正常 |

**验收**: 启动 `npm start`，切换到社区 Tab 看到主题列表，卡片渲染正确。

---

### Day 4（半天 × 2）：集成测试 + 错误处理

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | 编写 `community-integration.test.ts`（端到端） | 集成测试 |
| 上午 | 完善错误处理（网络超时、ZIP 损坏、磁盘满） | 错误路径覆盖 |
| 下午 | 实现 `community-asset-cache.ts` | 预览图缓存 |
| 下午 | 实现 `community-download-progress.ts` | 进度推送 |

**验收**: 集成测试全绿，手动断网/损坏 ZIP 测试错误提示正确。

---

### Day 5（半天 × 2）：体验优化 + 文档

| 时段 | 任务 | 产出 |
|------|------|------|
| 上午 | 完善 i18n 翻译（zh-CN + en 全覆盖） | 国际化完成 |
| 上午 | 视觉回归测试（社区 Tab 截图对比） | 视觉一致 |
| 下午 | 编写 `docs/reports/INDEX.md` 更新 | 报告登记 |
| 下午 | 运行 `npm run check` 全量校验 | 全绿 |

**验收**: `npm run check` 全绿，`npm test` 全绿，`npm run typecheck` 全绿。

---

## 5. 测试策略

### 5.1 单元测试

| 模块 | 测试用例 |
|------|----------|
| `community-api-client.ts` | 1. 正常列表请求返回解析后数据<br>2. 超时触发重试<br>3. 缓存命中不重复请求<br>4. 非 200 状态码抛错 |
| `community-color-bridge.ts` | 1. 全 10 色输入 → 14 token 完整输出<br>2. 仅 5 基础色输入 → 推导补齐<br>3. 极端色值（纯黑/纯白）不崩溃<br>4. inference 标记正确 |
| `community-package-converter.ts` | 1. 有效 ZIP → 标准目录包<br>2. ZIP 内含路径穿越文件 → 拒绝<br>3. ZIP 损坏 → 抛错<br>4. apps 映射正确（compat → targets） |
| `communityStore.ts` | 1. fetchList 成功更新 items<br>2. search 防抖<br>3. installTheme 触发进度更新<br>4. 错误状态正确设置 |

### 5.2 集成测试

**端到端流程**:
```
[Mock DreamSkin API] → apiClient.listThemes() → store.items → CommunityTab 渲染
                                                         ↓
[Mock DreamSkin API] → apiClient.downloadThemeZip() → converter.convert() → ThemeInstaller.install() → ThemeLibrary → IPC THEME_LIST 返回新安装主题
```

**Mock 策略**:
- 使用 `nock` 或自定义 HTTP server mock DreamSkin API
- 提供 fixture ZIP 文件（含 manifest + CSS + 预览图）

### 5.3 视觉回归

- 社区 Tab 空状态截图
- 社区 Tab 有数据截图（卡片网格）
- 安装中进度条截图
- 错误状态截图

### 5.4 边界测试

| 场景 | 预期行为 |
|------|----------|
| 网络超时（>10s） | 显示"网络连接失败"提示，可重试 |
| ZIP 文件 > 50MB | 拒绝下载，提示"文件过大" |
| ZIP 内含路径穿越（`../../etc/passwd`） | 解压时拒绝，抛安全错误 |
| 磁盘满 | 写入失败，清理临时文件，提示"磁盘空间不足" |
| API 返回 503 | 显示"服务暂不可用"，可重试 |
| 重复安装同一主题 | 提示"已安装"，不重复下载 |
| 安装过程中退出应用 | 下次启动时清理临时文件 |

---

## 6. 风险评估与缓解

### 6.1 API 不可用/变更

**风险等级**: 中

**影响**: 社区 Tab 无法加载，用户看到错误提示。

**缓解**:
- API 客户端实现优雅降级：失败时显示缓存数据（TTL 内）
- 所有 API 调用有超时 + 重试
- 错误信息明确区分"网络问题"与"服务不可用"
- 社区 Tab 失败不影响本地主题 Tab 的正常使用

### 6.2 颜色推导质量

**风险等级**: 低-中

**影响**: 社区主题安装后视觉与预览图不一致。

**缓解**:
- 桥接层使用 HCT 感知均匀推导（与 Studio 调色板同算法）
- 提供 `inference` 元数据，UI 可标记"部分颜色为推导"
- 社区主题标记 `unofficial: true`，用户预期管理
- 后续可让 DreamSkin API 直接提供 14-token（推动上游改进）

### 6.3 安装包安全

**风险等级**: 中

**影响**: 恶意 ZIP 可能包含路径穿越、超大文件、恶意 CSS。

**缓解**:
- 解压时严格校验所有文件路径在包目录内（复用 `resolveWithin`）
- ZIP 大小上限 50MB（与 ThemeLibrary 一致）
- 解压后文件类型白名单（仅允许 .css/.png/.jpg/.webp/.json/.woff2）
- CSS 注入前走 ThemeInstaller 的 sanitize 管线
- 社区主题标记 `unofficial: true`，不享受官方签名验证

### 6.4 性能影响

**风险等级**: 低

**影响**: 大预览图解码、ZIP 解压可能阻塞主进程。

**缓解**:
- ZIP 解压使用流式 API（不一次性读入内存）
- 预览图使用磁盘缓存 + 缩略图（不直接渲染原图）
- 社区 Tab 懒加载（首次切换时才 fetch）
- 分页加载（每页 20 条），避免一次性渲染大量卡片

### 6.5 依赖风险

**风险等级**: 低

**影响**: 新增 ZIP 解压库可能引入安全漏洞或增加包体积。

**缓解**:
- 优先使用 Node 内置 `node:zlib`（无需新依赖）
- 如需第三方 ZIP 库，选择成熟维护的（`yauzl` 或 `extract-zip`）
- 在 `package.json` 锁定版本，定期审计

---

## 7. 验收标准

### 7.1 功能验收清单

- [ ] 社区 Tab 在 ThemesPage 正确显示，与本地 Tab 并列
- [ ] 首次切换社区 Tab 时自动加载主题列表
- [ ] 搜索框输入后 300ms 防抖触发搜索
- [ ] 分类下拉可筛选（全部/赛博朋克/极简/...）
- [ ] 排序切换（最热/最新/评分）
- [ ] 卡片显示预览图、名称、作者、下载数
- [ ] 点击安装按钮触发下载 + 转换 + 安装
- [ ] 安装过程中显示进度条
- [ ] 安装成功后按钮变为"已安装"
- [ ] 安装失败显示错误提示 + 重试按钮
- [ ] 已安装主题在本地 Tab 同步显示
- [ ] 断网时显示网络错误提示
- [ ] 社区 Tab 异常不影响本地 Tab 功能

### 7.2 性能验收指标

| 指标 | 目标值 |
|------|--------|
| 社区 Tab 首次加载时间 | < 2s（网络正常情况下） |
| 搜索响应时间 | < 500ms（含防抖） |
| 单主题安装时间 | < 5s（10MB ZIP，不含下载） |
| 预览图缓存命中率 | > 80%（二次访问） |
| 内存增量 | < 50MB（社区 Tab 加载 100 条） |
| 安装过程主进程阻塞 | < 200ms（UI 不卡顿） |

### 7.3 安全验收检查

- [ ] ZIP 路径穿越攻击被拦截
- [ ] 超大 ZIP（>50MB）被拒绝
- [ ] 非白名单文件类型被拒绝
- [ ] 社区主题 CSS 注入前经过 sanitize
- [ ] 社区主题标记 `unofficial: true`
- [ ] 临时文件在安装完成后清理
- [ ] 缓存目录大小有上限（200MB LRU）

### 7.4 代码质量验收

- [ ] `npm run typecheck` 全绿
- [ ] `npm test` 全绿（新增测试通过）
- [ ] `npm run check` 全量校验全绿
- [ ] 所有新文件有 SPDX 头部
- [ ] 所有新文件有 JSDoc 注释
- [ ] 无新架构分层违规（check-architecture-boundaries）
- [ ] 无新设计 token 违规（check-design-tokens）
- [ ] 无路径污染（git status 干净）

---

## 8. 后续迭代（不在本次范围）

1. **收藏/点赞**: 用户可收藏社区主题，数据本地持久化
2. **上传/分享**: 用户可将本地主题上传到 DreamSkin（需账号系统，当前无）
3. **自动更新**: 检测社区主题新版本，提示更新
4. **评论/评分**: 展示社区评论（只读）
5. **推荐算法**: 基于用户已安装主题推荐相似社区主题

---

## 9. 关键文件路径汇总

| 路径 | 操作 |
|------|------|
| `src/shared/types/community.ts` | 新建 |
| `src/shared/ipc-channels.ts` | 修改 |
| `src/shared/i18n.ts` | 修改 |
| `src/main/community/community-api-client.ts` | 新建 |
| `src/main/community/community-color-bridge.ts` | 新建 |
| `src/main/community/community-package-converter.ts` | 新建 |
| `src/main/community/community-asset-cache.ts` | 新建 |
| `src/main/community/community-download-progress.ts` | 新建 |
| `src/main/ipc/community-theme-ipc.ts` | 新建 |
| `src/ui/stores/communityStore.ts` | 新建 |
| `src/ui/components/themes/CommunityTab.tsx` | 新建 |
| `src/ui/components/themes/CommunityThemeCard.tsx` | 新建 |
| `src/ui/pages/ThemesPage.tsx` | 修改 |
| `src/ui/api/agentSkinClient.ts` | 修改 |
| `src/preload.ts` | 修改 |
| `tests/main/community/*.test.ts` | 新建（6 个测试文件） |

---

*文档结束 — 可直接作为开发任务书使用。*
