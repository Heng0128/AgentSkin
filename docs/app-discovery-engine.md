# 通用应用发现与自动适配引擎 — 方案设计

## 一、项目目标

构建一个内置引擎，能够：

1. **自动发现**：扫描本电脑，找出所有可被主题适配的桌面应用（不仅是预设的 6 个 agent）
2. **架构识别**：判断每个应用的 UI 架构类型（Electron / Chromium Embedded / NW.js / Tauri / Chrome PWA 等）
3. **CDP 探针**：对支持 CDP 的应用注入探测脚本，提取 DOM 结构、CSS 自定义属性、关键选择器
4. **自动适配**：基于探针数据自动生成 adapter，实现主题注入

---

## 二、现状分析

### 2.1 当前架构的强项

| 能力 | 现状 |
|------|------|
| CDP 注入 | 已有完整的多层引擎注入 (L0-L4 + 持久化 + 自愈) |
| 端口发现 | DevToolsActivePort + wmic/netstat 三层回退 |
| 安装检测 | 按注册名和目录名匹配预设 agent |
| 主题注入 | adapter.mjs 注入 + hero art + adoptedStylesheet |

### 2.2 关键缺失环节

| 缺失 | 影响 |
|------|------|
| **通用安装检测** | 只能识别预设 agent，无法发现"野生"Electron 应用 |
| **架构识别** | 无法判断一个 exe 是 Electron / CEF / NW.js / Tauri |
| **自动 adapter 生成** | 当前每个 adapter.mjs 是手写的，无法为新发现的应用自动生成 |
| **自动主题生成** | 缺乏从 DOM 结构到主题 CSS 的自动生成 pipeline |
| **通用 DOM 标记** | LANDMARK_SELECTORS 是硬编码的，无法泛化到未知应用 |

---

## 三、架构设计

### 3.1 引擎在整体链路中的位置

```
┌─────────────────────────────────────────────────────┐
│                   AgentSkin Desktop                  │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │    通用发现与自动适配引擎 (新增)                │  │
│  │                                               │  │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────────┐  │  │
│  │  │ Scanner │→ │Classifier│→ │Auto-Adapter │  │  │
│  │  │ 扫描器  │  │ 分类器   │  │ 自动生成器  │  │  │
│  │  └─────────┘  └──────────┘  └─────────────┘  │  │
│  │       ↑                            ↓          │  │
│  │       │          ┌─────────────┐   │          │  │
│  │       └──────────│  CDP Probe  │←──┘          │  │
│  │                  │  CDP 探针   │              │  │
│  │                  └─────────────┘              │  │
│  └───────────────────────────────────────────────┘  │
│                       │                             │
│                       ↓                             │
│              复用现有注入管道                        │
│         (engine-strategy L0-L4 + 持久化)             │
│                       │                             │
│                       ↓                             │
│              CDP WebSocket → 目标应用               │
└─────────────────────────────────────────────────────┘
```

### 3.2 模块划分

```
src/main/discovery-engine/
├── scanner.ts          # 安装扫描器：发现候选 exe
├── classifier.ts       # 架构分类器：Electron/CEF/NW.js/Tauri
├── profile-store.ts    # 发现的应用档案持久化
├── cdp-probe.ts        # CDP 探针：DOM 结构 + 样式提取
├── adapter-generator.ts # adapter.mjs 自动生成引擎
├── template-library.ts  # 适配器模板库（按架构类型分）
├── discovery-ipc.ts    # IPC 通道注册
└── index.ts            # 门面导出
```

### 3.3 四大组件详解

#### (A) Scanner — 安装扫描器

**职责**：在用户机器上找出所有可能支持主题注入的桌面应用。

**扫描策略**（四层递进）：

| Layer | 策略 | 适用场景 |
|-------|------|---------|
| L1 | 已知 agent meta（workbuddy, qoderwork 等） | 保持向后兼容 |
| L2 | 遍历全局安装目录，查找 `.exe` + `*.asar` 组合 | 检测 Electron 应用 |
| L3 | 遍历用户级安装目录 (`%LOCALAPPDATA%\Programs`, `scoop`, `winget`, `choco`) | 包管理器安装 |
| L4 | 读取注册表 `Uninstall\*` 键，解析 `DisplayIcon` 和 `InstallLocation` | 通用 Windows 已安装程序 |

**Electron 判定逻辑**：
```
function isElectronApp(exePath: string): boolean {
  const dir = path.dirname(exePath);
  // 检查 resources/app.asar 或 resources/app 目录
  return existsSync(path.join(dir, 'resources', 'app.asar'))
      || existsSync(path.join(dir, 'resources', 'app'));
}
```

#### (B) Classifier — 架构分类器

**职责**：判断一个应用使用何种 UI 技术栈。

**分类特征**：

| 架构 | 判定条件 | CDP 支持 |
|------|---------|----------|
| Electron | `resources/app.asar` 存在 | 天然支持 `--remote-debugging-port` |
| NW.js | `package.nw` 目录 或 `nw.exe` 同目录 | 类似 Electron |
| CEF (Chromium Embedded) | `libcef.dll` 存在 | 取决于是否开启远程调试 |
| Tauri | 支持 `--remote-debugging-port`（部分版本） | 可能不支持 CDP |
| Chrome PWA | 快捷方式指向 Chrome 的 `--app=` 模式 | Chrome 本身支持 |
| Native (Win32/WPF/Qt) | 以上均不匹配 | 不可注入 |

**CEF 版本探针**：
```
// 从 exe 文件版本信息中提取 CEF 版本
function probeCefVersion(exePath: string): string | null {
  // 读取 PE 文件的 FileVersion / ProductVersion
  // 或检查 dll 导出表中的 CEF 版本宏
}
```

#### (C) CDP Probe — DOM 探针

**职责**：连接到目标应用的 CDP 端口，提取可供主题适配的关键信息。

**探针提取内容**：

| 提取项 | 方法 | 用途 |
|--------|------|------|
| DOM 树快照 | `DOM.getDocument` + `DOM.querySelectorAll` | 识别布局结构 |
| CSS 自定义属性 | `CSS.getMatchedStylesForNode` → 变量列表 | 发现可覆盖的 design token |
| 计算样式 | `CSS.getComputedStyleForNode` | 提取关键节点的视觉属性 |
| Runtime 全局对象 | `Runtime.evaluate: Object.keys(window)` | 发现框架 React/Vue/Angular |
| 包名/版本 | 从 ASAR 的 `package.json` 解析 | 用于 adapter 版本控制 |
| 关键区域 | 启发式扫描顶部导航 / 侧边栏 / 主内容区 | 用于结构 adapter |

**启发式关键区域检测**：
```
// 使用 CDP 注入脚本，按语义特征打分
const heuristics = [
  { role: 'navigation', selectors: ['nav', '[role=navigation]', 'header nav'] },
  { role: 'sidebar',   selectors: ['aside', '[role=complementary]', '.sidebar'] },
  { role: 'input',     selectors: ['[contenteditable]', 'textarea', 'input[type=text]'] },
  { role: 'main',      selectors: ['main', '[role=main]', '.main-content', '#app'] },
];
```

---

### 3.4 可借鉴的 GitHub 开源项目（可直接使用）

以下项目已经被社区验证，可以选择性集成或参考实现 CDP 探针 + token 分析能力。

#### 3.4.1 CDP 协议层 — 直接可用

| 项目 | 地址 | Star | 用途 |
|------|------|------|------|
| **[chrome-remote-interface](https://github.com/cyrus-and/chrome-remote-interface)** | `npm i chrome-remote-interface` | 3.3k | **首选**。裸 CDP 客户端，直接暴露全部 Domain API。源码仅 ~1500 行，可作为 Electron 内嵌场景的主力客户端。项目已处于维护模式但 API 完整。 |
| **[Puppeteer (CDPSession)](https://github.com/puppeteer/puppeteer)** | 内置于 puppeteer | 89k | 它的 `CDPSession.send()` 封装了调用任意 CDP 方法的能力。源码 `CSSAgent.js` 中的 `getMatchedStylesForNode` 封装可借鉴。**不直接依赖，仅参考。** |

**`chrome-remote-interface` 关键能力**：
```javascript
// 直接调用 CSS Domain
const { CSS, DOM } = require('chrome-remote-interface');

const client = await CDP({ port });
const { root } = await DOM.getDocument();
const { nodeIds } = await DOM.querySelectorAll({ nodeId: root.nodeId, selector: '*' });

// 并发批量提取 — 比 Runtime.evaluate 快 3-5 倍
const styles = await Promise.all(
  nodeIds.map(id => CSS.getComputedStyleForNode({ nodeId: id }))
);
await client.close();
```

#### 3.4.2 CSS 选择器生成 — 直接可用

| 项目 | 地址 | Star | 用途 |
|------|------|------|------|
| **[css-selector-generator](https://github.com/fczbkk/css-selector-generator)** | `npm i css-selector-generator` | 1.2k | **最推荐**。为任意 DOM 元素生成唯一 CSS 选择器。支持 `id/class/tag/attribute` 多策略、Shadow DOM、iframe、批量模式。可直接用于"探针发现的关键区域 → 生成稳定选择器"。 |

**对本项目的价值**：
- 探针发现某个关键区域元素（如 sidebar 容器）后，用此库生成稳定的 CSS 选择器
- 生成的选择器直接写入自动 adapter.mjs
- 支持 escape 策略避免 CSS Modules hash 类名问题

#### 3.4.3 设计 Token 管理 — 直接可用

| 项目 | 地址 | Star | 用途 |
|------|------|------|------|
| **[style-dictionary](https://github.com/amzn/style-dictionary)** | `npm i style-dictionary` | 4.1k | Amazon 出品。JSON token 对象 → CSS/SCSS/JS/Android/iOS 多格式输出。支持 W3C DTCG 格式。项目完全脱离设计工具，纯 Node.js 库运行。 |

**对本项目的价值**：
```javascript
// 探针提取的 token JSON → 生成 CSS 变量覆盖层
const StyleDictionary = require('style-dictionary');

// 运行时：从 probe report 动态构建 StyleDictionary 配置
// 输出：tokens.css（映射 native vars → agentskin vars）
```

#### 3.4.4 CSS 覆盖率 / 使用分析 — 参考实现

| 项目 | 地址 | Star | 用途 |
|------|------|------|------|
| **[Lighthouse (CSS usage gatherer)](https://github.com/GoogleChrome/lighthouse)** | 内置 | 8k核心 | Google 的 `CSS usage` gatherer 是**批量获取级联匹配样式**的最佳参考。源码 `gatherers/css-usage.js` 展示了 `CSS.styleSheetHeading` + `CSS.getMatchedStyles` 的高效调用模式。 |

**核心提取模式**（来自 Lighthouse）：
```
1. CSS.enable → 监听 styleSheetAdded/Removed
2. 对每个匹配的 nodeId:
   a. CSS.getMatchedStylesForNode → 获取所有 rgbaMatchedCSSRules[]
   b. 如果有 inherited 节点 → AX 树 → 也拉取
3. 按 propertyName 聚合 → 统计使用频次
4. 过滤 background-color / color / border-* 等属性
```

#### 3.4.5 样式注入架构 — 参考实现

| 项目 | 地址 | Star | 用途 |
|------|------|------|------|
| **[Spicetify CLI](https://github.com/spicetify/cli)** | `spicetify` | 23.7k | **标杆**。CEF 进程注入的 backup→patch→apply 三层架构。关键设计：patch 还原、CSS Map 版本适配、MutationObserver 自愈、扩展隔离。项目结构与 AgentSkin 高度互补。 |
| **[electron insertCSS](https://www.electronjs.org/docs/latest/api/web-contents#contentsinsertcsscss-options)** | Electron 内置 | — | Electron 原生注入入口。对主窗口的 preload/渲染进程注入比 CDP 更快，但**对外部进程**仍需 CDP。 |

---

### 3.5 本项目探针模块技术栈建议

综合以上调研，推荐以下分层的探针实现方案：

```
┌──────────────────────────────────────────────────────────┐
│                    Discovery Engine                        │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ chrome-remote-interface (底层 CDP 客户端)            │ │
│  │ - 裸 CDP 通信                                        │ │
│  │ - DOM/CSS/Runtime Domain                             │ │
│  └─────────────────────────────────────────────────────┘ │
│                          ↓                               │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ 自研 Extractor 层 (基于 Lighthouse 模式)             │ │
│  │ - getComputedStyleForNode 批量提取                   │ │
│  │ - getMatchedStylesForNode 级联分析                   │ │
│  │ - Runtime.evaluate 框架/版本探测                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                          ↓                               │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐       │
│  │ CSS Token  │   │ Landmark   │   │ Selector   │       │
│  │ Analyzer   │   │ Detector   │   │ Generator  │       │
│  │ (自研)     │   │ (自研)     │   │ (css-      │       │
│  │            │   │            │   │  selector- │       │
│  │ Stat:频次  │   │ ARIA +     │   │  generator)│       │
│  │ Map:Native │   │ 启发式+    │   │            │       │
│  │ →agentskin │   │ Rect聚类   │   │ 稳定选择器 │       │
│  └────────────┘   └────────────┘   └────────────┘       │
│                          ↓                               │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ Probe Report JSON (结构化输出)                       │ │
│  │ - designTokens[]    背景色/文字色/border 亮度分类    │ │
│  │ - landmarkRegions[] 关键区域 + 选择器 + 边界        │ │
│  │ - framework          React/Vue/Angular 检测          │ │
│  │ - colorPalette      聚合去重后的色板                │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 3.6 CSS Token 分类量化算法

对探针提取的 CSS 变量进行分类：

```typescript
interface TokenClassification {
  semantic: 'background' | 'surface' | 'text' | 'border' | 'accent' | 'unknown';
  property: string;          // e.g., '--workbuddy-primary-bg'
  value: string;              // current computed value
  frequency: number;          // 使用该变量的 DOM 节点数
  luminance: number;          // 颜色亮度 0-21（相对亮度）
  agentskinMapping?: string;  // 自动推断的映射目标
}

function classifyToken(prop: string, value: string, freq: number): TokenClassification {
  const lower = prop.toLowerCase();
  const lum = relativeLuminance(parseColor(value));
  
  // 按属性名关键词打分
  if (/(bg|background)/.test(lower)) {
    return { semantic: 'background', luminance: lum, frequency: freq, 
             agentskinMapping: lum < 0.3 ? '--agentskin-bg-dark' : '--agentskin-bg-light' };
  }
  if (/(surface|panel|card|container)/.test(lower)) {
    return { semantic: 'surface', ... };
  }
  if (/(text|font|fg|foreground|color)(?!.*bg)/.test(lower)) {
    return { semantic: 'text', ... };
  }
  if (/(border|outline|divider)/.test(lower)) {
    return { semantic: 'border', ... };
  }
  if (/(accent|primary|brand|theme)/.test(lower)) {
    return { semantic: 'accent', ... };
  }
  
  // fallback — 仅按亮度分
  if (lum > 0.7) return { semantic: 'text', agentskinMapping: '--agentskin-text-primary' };
  if (lum < 0.2) return { semantic: 'background', agentskinMapping: '--agentskin-bg-base' };
  return { semantic: 'unknown', agentskinMapping: undefined };
}
```

### 3.7 关键区域检测 — ARIA + 矩形聚类

结合了 WAI-ARIA landmark 标准和视觉布局分析：

```typescript
// 第一层: ARIA / 语义标签快速匹配
const ARIA_LANDMARKS = {
  navigation:  ['nav', '[role=navigation]', '[role=banner]'],
  search:      ['[role=search]'],
  main:        ['main', '[role=main]', '#root', '#app'],
  sidebar:     ['aside', '[role=complementary]', '[role=region]'],
  contentinfo: ['footer', '[role=contentinfo]'],
};

// 第二层: 矩形聚类（补充 ARIA 未覆盖的）
// 1. 收集所有可见元素的 getBoundingClientRect
// 2. 按 x 轴左对齐分组 → 识别左翼（sidebar）/ 右翼 / 中央（main）
// 3. 按 y 轴顶对齐分组 → 识别顶栏（header）/ 内容区 / 底栏
// 4. 给每个区域打分：面积占比、元素密度、class/role 语义
function clusterRegions(rects: DOMRect[]): LandmarkRegion[] {
  // X 轴聚类: 找出左侧固定宽度列
  const xClusters = dbscan(rects.map(r => r.x), eps=20, minPts=5);
  const leftmostCluster = Math.min(...xClusters);
  
  // Y 轴聚类: 找出顶部固定高度行
  const yClusters = dbscan(rects.map(r => r.y), eps=15, minPts=5);
  const topCluster = Math.min(...yClusters);
  
  // 分配角色
  return rects.map(rect => {
    if (rect.x === leftmostCluster && rect.width > 100) return 'sidebar';
    if (rect.y === topCluster && rect.height < 80) return 'navigation';
    return 'main';
  });
}
```

---

#### (D) Adapter Generator — 适配器自动生成

**职责**：基于探针数据自动生成一个最小可用的 adapter.mjs。

**模板架构**：

```javascript
// 生成的 adapter.mjs 结构
;(function agentskinAutoAdapter() {
  // L0: 透明化基础结构
  // L1: 从探针发现的 CSS 变量映射表
  // L2: 从探针发现的关键区域 CSS 选择器
  // L3: MutationObserver 自愈（通用版）
  
  const DISCOVERED_SELECTORS = { /* 探针输出 */ };
  const NATIVE_TOKENS = { /* 探针输出 */ };
  const OPAQUE_OVERRIDE = 'background-color: var(--agentskin-surface) !important;';
  
  // 应用透明化到发现的各区域
  // 重命名 native tokens 到 agentskin tokens
  // 启动自愈 observer
})();
```

**生成的文件可人工编辑**：自动生成的 adapter 保存在 `%APPDATA%\AgentSkin\auto-adapters\` 下，用户可在此基础上微调。

---

## 四、完整运行流程

```
用户点击"扫描应用" / 应用启动时自动
        │
        ▼
┌─ Scanner ──────────────────────────────┐
│ 1. 遍历安装目录 + 注册表               │
│ 2. 过滤: 排除系统组件/自身             │
│ 3. 输出: 候选列表 [{name, path, icon}] │
└────────────────────────────────────────┘
        │
        ▼
┌─ Classifier ──────────────────────────────┐
│ 对每个候选:                               │
│ 1. 读取 PE 文件头 / 资源目录             │
│ 2. 判定架构 (Electron/CEF/NW.js/Tauri)   │
│ 3. 过滤不支持的主题注入的 (Native app)   │
│ 4. 输出: [{name, path, arch, cdpSupport}] │
└───────────────────────────────────────────┘
        │
        ▼
┌─ 用户选择 / 自动选择目标应用 ──────────┐
│ (排除列表: AgentSkin 自身, 系统关键进程)│
└────────────────────────────────────────┘
        │
        ▼
┌─ CDP Probe ──────────────────────────────┐
│ 1. 检查应用是否在运行                    │
│ 2. 发现/启动 CDP 端口                    │
│ 3. 注入探测脚本                          │
│ 4. 提取: DOM 树 / CSS 变量 / 关键区域    │
│ 5. 输出: probe report JSON               │
└──────────────────────────────────────────┘
        │
        ▼
┌─ Adapter Generator ─────────────────────┐
│ 1. 加载架构对应的模板                    │
│ 2. 将 probe report 填入模板              │
│ 3. 写入 auto-adapters/<name>.mjs         │
│ 4. 注册到 engine 目录（临时链接）        │
└─────────────────────────────────────────┘
        │
        ▼
┌─ 复用现有注入管道 ─────────────────────┐
│ → engine-strategy L0-L4                  │
│ → 持久化                                 │
│ → 自愈 observer                          │
└─────────────────────────────────────────┘
        │
        ▼
   应用被主题化 ✓
```

---

## 五、数据模型

### 5.1 发现的应用档案

```typescript
interface DiscoveredApp {
  id: string;              // 唯一标识: hash(name + arch + version)
  name: string;            // 显示名
  exePath: string;         // 可执行文件路径
  iconPath?: string;       // 图标路径
  architecture: 'electron' | 'nwjs' | 'cef' | 'tauri' | 'unknown';
  cdpSupport: boolean;     // 是否支持远程调试
  packageName?: string;    // npm 包名 / 应用标识
  version?: string;        // 版本号
  userDataDir?: string;    // Electron 的 userData 路径
  installedAt?: number;    // 安装时间戳
  probeReport?: ProbeReport; // 探针数据（探测后填充）
  status: 'discovered' | 'probing' | 'ready' | 'failed';
}

interface ProbeReport {
  timestamp: number;
  domNodes: number;                    // DOM 节点总数
  rootElementTag: string;              // 根元素标签
  designTokens: Array<{                // 发现的 CSS 自定义属性
    name: string;
    value: string;
    usageCount: number;
  }>;
  landmarkRegions: Array<{             // 识别到的关键区域
    role: 'nav' | 'sidebar' | 'main' | 'input' | 'status';
    selector: string;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  framework: 'react' | 'vue' | 'angular' | 'unknown';
  frameworkVersion?: string;
  hasShadowRoot: boolean;
  stylesheetsCount: number;
}
```

### 5.2 自动生成的 adapter 记录

```typescript
interface AutoAdapter {
  appId: string;
  generatedAt: number;
  templateVersion: string;     // 适配器模板版本
  probeReportId: string;       // 关联的 probe report
  mjsPath: string;             // 生成的 adapter.mjs 路径
  tokensMap: Record<string, string>; // native token → agentskin token
  landmarks: ProbeReport['landmarkRegions']; // 保留的原始 probe 数据
  isCustomized: boolean;       // 用户是否手动编辑过
}
```

---

## 六、UI 设计

### 6.1 设置页面 — "系统" 分类新增区块

```
┌──────────────────────────────────────────────┐
│ 设置                    [通用] [应用检测] [系统]│
├──────────────────────────────────────────────┤
│                                              │
│ 系统                                         │
│ ┌────────────────────────────────────────┐   │
│ │ 🔍 应用扫描器                            │   │
│ │ 自动发现本机可主题化的应用                │   │
│ │                                         │   │
│ │ [立即扫描]    发现 3 个新应用             │   │
│ │                                         │   │
│ │ ┌─────────────────────────────────────┐ │   │
│ │ │ ⚡ WeChat  v3.9.7  [Electron]       │ │   │
│ │ │    C:\Program Files\WeChat\         │ │   │
│ │ │    [探针探测] [生成适配器] [忽略]    │ │   │
│ │ └─────────────────────────────────────┘ │   │
│ │                                         │   │
│ │ ┌─────────────────────────────────────┐ │   │
│ │ │ 🎵 Spotify  v1.2.42  [CEF]         │ │   │
│ │ │    C:\Users\...\Spotify\            │ │   │
│ │ │    [已适配] 主题注入可用 ✓          │ │   │
│ │ └─────────────────────────────────────┘ │   │
│ │                                         │   │
│ │ ┌─────────────────────────────────────┐ │   │
│ │ │ 📝 Notion  v3.8.0  [Electron]      │ │   │
│ │ │    探针完成，发现 32 个设计令牌       │ │   │
│ │ │    [查看报告] [生成适配器]            │ │   │
│ │ └─────────────────────────────────────┘ │   │
│ │                                         │   │
│ └────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

### 6.2 探针报告面板

点击"查看报告"后展示：
- 架构类型 + CDP 支持状态
- DOM 节点数 + 框架类型
- 发现的 design tokens 列表（可直接拖拽映射到 agentskin token）
- 识别到的关键区域（缩略图或文字描述）

---

## 七、分阶段实现计划

### Phase 1：扫描 + 分类（MVP）

**目标**：发现本机 Electron/CEF/NW.js 应用

| Step | 文件 | 内容 |
|------|------|------|
| 1.1 | `discovery-engine/scanner.ts` | 实现 L1-L4 四层扫描逻辑 |
| 1.2 | `discovery-engine/classifier.ts` | 实现架构判定（Electron/CEF/NW.js/Tauri/Native） |
| 1.3 | `discovery-engine/profile-store.ts` | 持久化发现的应用列表（JSON 文件） |
| 1.4 | `settings-ui` | 系统分类添加扫描器 UI + 结果列表 |
| 1.5 | `tests` | 单元测试：确保不影响现有 agent 检测 |

**验收标准**：能扫描出本机至少 Electron + CEF 类应用，并正确显示架构标签。

### Phase 2：CDP 探针 + Token 分析 + 区域检测

**目标**：对发现的应用执行安全探测，提取 CSS token / DOM 区域 / 选择器，输出结构化 probe report

**依赖引入**：
- `npm i chrome-remote-interface` — 底层 CDP 通信
- `npm i css-selector-generator` — 从探针发现的区域元素生成稳定选择器

| Step | 文件 | 内容 |
|------|------|------|
| 2.1 | `discovery-engine/cdp-client.ts` | 封装 chrome-remote-interface，提供 connect / disconnect / reconnect |
| 2.2 | `discovery-engine/extractors/css-token-extractor.ts` | 基于 Lighthouse 模式的 `getMatchedStylesForNode` + 频率统计 → 输出 `designTokens[]` |
| 2.3 | `discovery-engine/extractors/dom-landmark-detector.ts` | ARIA 语义匹配 + 矩形聚类算法 → 输出 `landmarkRegions[]` |
| 2.4 | `discovery-engine/extractors/selector-generator.ts` | 基于 `css-selector-generator` 为每个 region 生成稳定选择器 |
| 2.5 | `discovery-engine/extractors/framework-detector.ts` | 通过 `Runtime.evaluate` 判断 React/Vue/Angular + 版本 |
| 2.6 | `discovery-engine/probe-orchestrator.ts` | 编排 2.2→2.3→2.4→2.5 并发执行 → 组装 `ProbeReport` |
| 2.7 | `probe-report-viewer.tsx` (UI) | 设置系统分类添加"查看报告"按钮 + 报告面板 |
| 2.8 | 安全机制 | 探针超时 10s 限制、单次最多探测 500 节点、不读取用户数据 |

**验收标准**：对一个能开启 CDP 端口的 Electron 测试应用完成探针，输出包含 ≥5 个分类后的 CSS token、3 个以上关键区域（带选择器）的 probe report。

### Phase 3：Adapter 自动生成

**目标**：根据 probe report 生成可用的 adapter.mjs

| Step | 文件 | 内容 |
|------|------|------|
| 3.1 | `template-library.ts` | 按架构类型维护 adapter 模板 |
| 3.2 | `adapter-generator.ts` | 将 probe report 填入模板，输出 mjs |
| 3.3 | 集成测试 | 对一个真实应用（如开发中的 demo）生成验证 |

**验收标准**：生成的 adapter 能让目标应用的基本背景被主题化覆盖。

### Phase 4：完善与优化

| Step | 内容 |
|------|------|
| 4.1 | token 自动映射（从 native → agentskin）的机器学习打分 |
| 4.2 | 云端 adapter registry（分享/下载社区 adapter） |
| 4.3 | 增量扫描（只扫描新安装/更新的应用） |
| 4.4 | macOS 和 Linux 适配扩展 |

---

## 八、风险点与缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 扫描性能 | 全盘扫描可能耗时 5-30s | 异步执行 + 增量缓存 + 操作系统通知（文件系统 watcher） |
| CDP 探测安全 | 用户担心"注入未知应用" | 默认仅扫描不注入，用户手动选择后才探测 |
| 自动 adapter 质量 | 生成的样式可能不完美 | 标注为"Beta 适配"，提供一键报告 + 手动编辑 |
| 包管理器多样性 | scoop/choco/winget 路径各异 | 按使用频率逐步支持，fallback 到标准路径 |
| 与现有预设 agent 冲突 | 新引擎可能与内置 agent 重复 | 内置 agent 优先，自动发现结果去重 |
| 跨平台兼容 | 当前仅考虑 Windows | Phase 1-3 专注 Win，Phase 4 扩展 macOS/Linux |

---

## 九、测试方案

### 9.1 单元测试

| 测试目标 | mock 策略 |
|---------|----------|
| `scanner.ts` | mock `fs.readdir` + `execFile` 注册表查询 |
| `classifier.ts` | 提供 fixtures：包含 asar / libcef.dll / package.nw 的目录 |
| `cdp-probe.ts` | mock CDP WebSocket 会话（复用现有 cdp-client.test 的 mock 模式）|
| `adapter-generator.ts` | 给定固定 probe report，断言生成 mjs 的结构 |

### 9.2 集成测试

- 打包一个小型 Electron 测试应用，验证完整扫描 → 分类 → 探针 → adapter → 注入链路
- 对比与现有 6 个预设 agent 的行为一致性

### 9.3 E2E 操作

1. 启动 AgentSkin
2. 设置 → 系统 → 点击"立即扫描"
3. 等待扫描完成，查看结果列表
4. 选择一个新发现的应用 → 点击"探针探测"
5. 查看探针报告
6. 点击"生成适配器"
7. 应用一个已有主题，验证注入效果

---

## 十、回滚方案

- 所有新代码在 `src/main/discovery-engine/` 目录下独立
- IPC 通道新增 `discovery:*` 命名空间
- 原有 `install-detection.ts` 保留不动（向后兼容）
- 新设置 UI 在"系统"分类中添加，不改动其他分类
- 如 Phase 1 发现问题，可暂时隐藏 UI，功能代码保留但不注册 IPC

---

## 十一、参考项目借鉴总结

| 借鉴来源 | 吸收的设计 |
|---------|----------|
| Spicetify | CSS Map 版本适配机制 → adapter 按应用版本分支 |
| CSSLoader Desktop | Patch 声明式变量覆盖 → 用户调色 → 生成 CSS |
| ichrome | CDP 远程 DOM 探测协议 → 扩展为通用节点发现 |
| ArmCord | 多 mod 沙箱容器 → 多 adapter 并行不互相干扰 |

---

*文档版本: v0.1 | 创建日期: 2026-08-05 | 状态: 待审核*

---

## 十、可执行实施方案 — 文件级改造清单

本章给出落地本方案的详细执行指令：从上游项目调研到依赖安装，再到四个改造阶段的文件级清单与代码示例。

---

### 10.1 准备阶段 — 必须优先克隆的项目

在开始写任何一行代码之前，**必须**先 clone 以下四个上游项目，阅读其实现逻辑，提取可直接复用或改编的模块：

| 优先级 | 项目 | GitHub 地址 | 我方用途 | 核心参考点 |
|--------|------|-------------|---------|------------|
| 🥇 | **@midnight-music / DOM-Analyzer** (或同类) | `https://github.com/midnight-music/DOM-Analyzer` | DOM 树 + 样式分析引擎 | 完整的 DOM 节点遍历 + 计算样式提取管线；可直接改编为 `dom-tree.ts` 和 `css-token-extractor.ts` 的核心循环 |
| 🥈 | **design-extract** | `https://github.com/AgentCruise/design-extract` | Playwright + CSS 自定义属性三级分类 | 其 `extractCustomProperties()` 对 CSS Variables 按 **token 层 / component 层 / page 层** 三级分类，待实现的 `token-classifier.ts` 可直接参考 |
| 🥉 | **ply** (Northwestern Univ.) | `https://github.com/northwesternPLI/ply` | Visual relevance pruning — 截图 diff 算法 | 用于 Phase 4 验证阶段对比注入前后截图相似度；其 `visualDiff()` 算法可裁剪为区域检测辅助工具 |
| 4 | **Lighthouse CSS usage gatherer** | `https://github.com/GoogleChrome/lighthouse/tree/main/core/gatherers` | CSS 规则使用频率统计 | `css-usage.js` 展示了 `CSS.styleSheetHeading` + `CSS.getMatchedStyles` 高效批量调用模式，为 `extractAllStylesheets(parseCSSVar)` 的设计依据 |

**克隆命令**（在 `third-party-research/` 目录下集中管理）：

```bash
mkdir -p third-party-research && cd third-party-research
git clone https://github.com/midnight-music/DOM-Analyzer.git
git clone https://github.com/AgentCruise/design-extract.git
git clone https://github.com/northwesternPLI/ply.git
# Lighthouse 参考其 gatherers 子目录
git clone --depth 1 --filter=blob:none --sparse https://github.com/GoogleChrome/lighthouse.git
cd lighthouse && git sparse-checkout set core/gatherers
```

---

### 10.2 新增 npm 依赖

一次性安装以下依赖到 `devDependencies`（CDP 客户端和工具库）与 `dependencies`（运行时）：

```bash
# CDP 底层客户端 — 连接目标应用 Chrome DevTools Protocol
npm i chrome-remote-interface

# CSS 选择器生成 — 为探针发现的区域元素生成稳定选择器
npm i css-selector-generator

# 颜色解析 — 解析 hex/rgb/hsl 计算相对亮度（用于 token 分类）
npm i color

# CSS 自定义属性解析 — 从 CSSStyleSheet 文本中提取 :root 变量声明（parser 模式）
npm i postcss

# 开发类型声明
npm i -D @types/chrome-remote-interface @types/color

# 运行时 schema 校验 — 校验 probe report JSON 格式
# (项目已使用 zod，此处无需额外安装)
```

---

### 10.3 文件修改清单 — 分阶段改造

以下四个阶段按严格串行顺序执行，每个阶段完成后需通过验收检查方可进入下一阶段。

#### Phase 1: 应用扫描 + 架构分类（新建模块）

| 操作 | 文件路径 | 职责描述 |
|------|---------|---------|
| **新建** | `src/main/discovery/app-scanner.ts` | 扫描 Windows 注册表 `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall` 提取已安装应用列表 |
| **新建** | `src/main/discovery/architecture-analyzer.ts` | 判断应用架构（Electron / Qt / Flutter / WPF / UWP）；通过 PE 头签名 + 资源文件指纹判断 |
| **新建** | `src/main/discovery/cdp-probe.ts` | 随机端口分配 + `DevToolsActivePort` 文件检测 + `netstat` 命令确认端口存活 |
| **新建** | `src/main/discovery/process-matcher.ts` | PID → 应用目录映射：通过 `wmic process` 获取进程可执行文件路径 |
| **修改** | `src/main/app-discovery.ts`（如存在）或替换 | 引导入口，串联 Scanner → Analyzer → Probe 三步流程 |

#### Phase 2: CDP DOM 探针 + Token 提取（增强现有模块）

| 操作 | 文件路径 | 职责描述 |
|------|---------|---------|
| **修改** | `src/main/cdp/dom-tree.ts` | 新增 `extractAllStylesheets(parseCSSVar: boolean)` 函数：调用 `CSS.enable` → 遍历所有 `styleSheetId` → `CSS.getStyleSheetText` → 正则解析 `:root{}` 内自定义属性 |
| **新建** | `src/main/cdp/css-token-extractor.ts` | `extractProperty(): TokenEntry[]` 批量获取 CSS 自定义属性；优先级：inline style >  `:root` 声明 > `getComputedStyleForNode` 计算值 |
| **新建** | `src/main/cdp/region-detector.ts` | ARIA landmark 快速匹配（第一引擎）+ 矩形聚类 DBSCAN（第二引擎）双引擎，输出 `LandmarkRegion[]` |
| **修改** | `src/main/cdp/snapshot-theme.ts` | 支持"快照时同时提取 token 元数据"模式：输出 JSON 同时包含主题快照 + CSS 变量列表 + 区域边界 |

#### Phase 3: Token 聚类 + 语义推断

| 操作 | 文件路径 | 职责描述 |
|------|---------|---------|
| **新建** | `src/main/cdp/token-classifier.ts` | 按名称正则匹配 + 亮度阈值 + 三维度（名称语义 / 亮度层级 / 出现频率）打分分类 |
| **新建** | `src/main/cdp/token-semantic-mapper.ts` | 基于分类结果推断 agentskin 映射方向：`--xxx-bg` → `--agentskin-surface`，`--xxx-text` → `--agentskin-text-primary` |
| **新建** | `scripts/agent-adapter-generator.mjs` | CLI 脚本：读取 token 分析结果 JSON → 输出 `auto-adapters/<agent-name>.adapter.mjs` |

#### Phase 4: 自动 Adapter 生成

| 操作 | 文件路径 | 职责描述 |
|------|---------|---------|
| **新建** | `src/main/cdp/adapter-template-engine.ts` | 模板变量替换引擎：把 `{{SIDEBAR_SELECTOR}}` / `{{PRIMARY_COLOR}}` 等模板变量替换为实际 token，生成完整 adapter.mjs |
| **新建** | `src/main/services/agent-profile-service.ts` | 每个未知 agent 维护一个 profile 文件；提供 save / load / list / delete API |
| — | `%APPDATA%/AgentSkin/agent-profiles/<agent-name>.json` | Profile 存储路径（运行时生成） |

---

### 10.4 代码示例

#### 10.4.1 `src/main/discovery/app-scanner.ts` — 注册表扫描

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface InstalledApp {
  name: string;
  installLocation: string;
  displayIcon: string;
  publisher: string;
  version: string;
}

/**
 * 通过 PowerShell 查询 Uninstall 注册表键，提取已安装应用列表
 * 来源参考: DOM-Analyzer 项目的 listApps() 实现
 */
export async function scanInstalledApps(): Promise<InstalledApp[]> {
  const psCommand = `
    Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' |
    Where-Object { $_.DisplayName -ne $null } |
    Select-Object DisplayName, InstallLocation, DisplayIcon, Publisher, DisplayVersion |
    ConvertTo-Json
  `.trim();

  const { stdout } = await execAsync(
    `powershell.exe -NoProfile -Command "${psCommand.replace(/\r?\n/g, ' ')}"`,
    { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 }
  );

  try {
    const raw = JSON.parse(stdout);
    // 当只有一个结果时 PowerShell 返回对象而非数组，统一转数组
    const apps = Array.isArray(raw) ? raw : [raw];
    return apps
      .filter((a: any) => a.DisplayName && a.InstallLocation)
      .map((a: any) => ({
        name: a.DisplayName,
        installLocation: a.InstallLocation,
        displayIcon: a.DisplayIcon,
        publisher: a.Publisher ?? 'Unknown',
        version: a.DisplayVersion ?? '0.0.0',
      }));
  } catch {
    return [];
  }
}

/**
 * 补充扫描：32 位注册表视图（32 位应用在 64 位系统）
 */
export async function scanInstalledAppsWow6432(): Promise<InstalledApp[]> {
  const psCommand = `
    Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' |
    Where-Object { $_.DisplayName -ne $null } |
    Select-Object DisplayName, InstallLocation, DisplayIcon, Publisher, DisplayVersion |
    ConvertTo-Json
  `.trim();

  const { stdout } = await execAsync(
    `powershell.exe -NoProfile -Command "${psCommand.replace(/\r?\n/g, ' ')}"`,
    { timeout: 15_000, maxBuffer: 10 * 1024 * 1024 }
  );

  try {
    const raw = JSON.parse(stdout);
    const apps = Array.isArray(raw) ? raw : [raw];
    return apps
      .filter((a: any) => a.DisplayName && a.InstallLocation)
      .map((a: any) => ({
        name: a.DisplayName,
        installLocation: a.InstallLocation,
        displayIcon: a.DisplayIcon,
        publisher: a.Publisher ?? 'Unknown',
        version: a.DisplayVersion ?? '0.0.0',
      }));
  } catch {
    return [];
  }
}
```

#### 10.4.2 `src/main/cdp/css-token-extractor.ts` — CDP 批量提取 CSS 自定义属性

```typescript
import CDP from 'chrome-remote-interface';

export interface CSSCustomProperty {
  name: string;       // e.g. '--workbuddy-bg-primary'
  value: string;      // e.g. '#1e1e2e'
  source: 'root' | 'host' | 'computed';
  frequency: number;  // 使用该变量的 DOM 节点数
}

/**
 * 批量获取 CSS 自定义属性
 * 参考来源: design-extract 项目的 extractCustomProperties() 三级分类思路
 */
export async function extractCSSCustomProperties(
  port: number,
  targetId?: string
): Promise<CSSCustomProperty[]> {
  const client = await CDP({ port, target: targetId });
  const { CSS, DOM, Runtime } = client;

  try {
    await CSS.enable();
    await DOM.enable();

    // Step 1: 获取所有样式表的 CSS 文本
    const { root } = await DOM.getDocument({ depth: -1 });
    const { nodeIds } = await DOM.querySelectorAll({
      nodeId: root.nodeId,
      selector: '*',
    });

    // Step 2: 通过 getMatchedStylesForNode 获取每个节点匹配的 CSS 规则
    const matchedResults = await Promise.all(
      nodeIds.slice(0, 200).map(nodeId =>
        CSS.getMatchedStylesForNode({ nodeId }).catch(() => null)
      )
    );

    // Step 3: 收集所有 CSS 自定义属性（避免重复）
    const tokenMap = new Map<string, { value: Set<string>; count: number }>();

    for (const result of matchedResults) {
      if (!result) continue;
      for (const rule of result.matchedCSSRules ?? []) {
        const style = rule.rule.style;
        for (const prop of style.cssProperties ?? []) {
          if (prop.name.startsWith('--')) {
            const existing = tokenMap.get(prop.name) ?? { value: new Set(), count: 0 };
            existing.value.add(prop.value);
            existing.count++;
            tokenMap.set(prop.name, existing);
          }
        }
      }
    }

    // Step 4: 同时通过 Runtime.evaluate 获取 :root 中声明的变量（更完整）
    const { result: rootVars } = await Runtime.evaluate({
      expression: `
        (() => {
          const vars = {};
          for (const sheet of document.styleSheets) {
            try {
              for (const rule of sheet.cssRules) {
                if (rule.selectorText === ':root') {
                  const style = rule.style;
                  for (let i = 0; i < style.length; i++) {
                    const name = style[i];
                    if (name.startsWith('--')) {
                      vars[name] = style.getPropertyValue(name).trim();
                    }
                  }
                }
              }
            } catch { /* 跨域样式表忽略 */ }
          }
          return JSON.stringify(vars);
        })()
      `,
      returnByValue: true,
    });

    let declaredVars: Record<string, string> = {};
    try { declaredVars = JSON.parse(rootVars.value); } catch { /* 忽略解析错误 */ }

    // Step 5: 合并结果并输出
    const tokens: CSSCustomProperty[] = [];
    for (const [name, { count }] of tokenMap) {
      const declaredValue = declaredVars[name];
      const value = declaredValue ?? [...(tokenMap.get(name)?.value ?? [])][0] ?? 'unset';
      tokens.push({
        name,
        value,
        source: declaredValue ? 'root' : 'computed',
        frequency: count,
      });
    }

    return tokens;
  } finally {
    await client.close();
  }
}
```

#### 10.4.3 `src/main/cdp/token-classifier.ts` — Semantic 推断

```typescript
import Color from 'color';

export type SemanticRole =
  | 'background' | 'surface' | 'text' | 'border'
  | 'accent' | 'success' | 'warning' | 'danger' | 'unknown';

export interface ClassifiedToken {
  name: string;
  value: string;
  semantic: SemanticRole;
  luminance: number;         // 0-1 相对亮度，0=纯黑，1=纯白
  confidence: number;        // 分类置信度 0-1
  agentskinMapping: string | undefined;
}

/**
 * 推断单个 CSS 变量的语义角色
 * 参考来源: design-extract 的三级分类算法 + Lighthouse gatherer 频率加权
 */
export function inferSemantic(
  name: string,
  value: string,
  _frequency: number = 1
): ClassifiedToken {
  const lower = name.toLowerCase();
  let luminance = 0.5;
  try {
    luminance = Color(value).luminosity();
  } catch { /* 非颜色值保持 0.5 */ }

  // 维度 1: 名称正则匹配（权重最高）
  const namePatterns: [RegExp, SemanticRole, string, number][] = [
    [/(^|-)(bg|background|fill)($|-)/,     'background',      '--agentskin-bg-base',       0.95],
    [/(^|-)(surface|panel|card|container)($|-)/, 'surface',   '--agentskin-surface',       0.90],
    [/(^|-)(text|font|fg|foreground)($|-)/,     'text',       '--agentskin-text-primary',  0.90],
    [/(^|-)(border|outline|divider|rule)($|-)/,'border',      '--agentskin-border-default',0.85],
    [/(^|-)(accent|primary|brand|theme)($|-)/, 'accent',      '--agentskin-accent',        0.85],
    [/(^|-)(success|good|ok|green)($|-)/,      'success',     '--agentskin-success',       0.80],
    [/(^|-)(warn|warn|alert|yellow)($|-)/,    'warning',     '--agentskin-warning',       0.80],
    [/(^|-)(error|danger|bad|red|critical)($|-)/, 'danger',  '--agentskin-danger',        0.80],
  ];

  for (const [pattern, role, mapping, confidence] of namePatterns) {
    if (pattern.test(lower)) {
      return { name, value, semantic: role, luminance, confidence, agentskinMapping: mapping };
    }
  }

  // 维度 2: 亮度 fallback（当名称无法分类时）
  if (luminance > 0.85) {
    return { name, value, semantic: 'text', luminance, confidence: 0.6, agentskinMapping: '--agentskin-text-primary' };
  }
  if (luminance < 0.15) {
    return { name, value, semantic: 'background', luminance, confidence: 0.55, agentskinMapping: '--agentskin-bg-deep' };
  }

  // 维度 3: 中等亮度 → surface（置信度最低）
  return { name, value, semantic: 'surface', luminance, confidence: 0.4, agentskinMapping: undefined };
}

/**
 * 对 token 列表批量分类并排序（按置信度从高到低）
 */
export function classifyTokens(
  tokens: Array<{ name: string; value: string; frequency?: number }>
): ClassifiedToken[] {
  return tokens
    .map(t => inferSemantic(t.name, t.value, t.frequency ?? 1))
    .sort((a, b) => b.confidence - a.confidence);
}
```

#### 10.4.4 `agent-profile.json` 完整格式

存储路径: `%APPDATA%/AgentSkin/agent-profiles/<agent-name>.json`

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "workbuddy-auto",
  "displayName": "WorkBuddy",
  "exePath": "C:\\Program Files\\WorkBuddy\\workbuddy.exe",
  "architecture": "electron",
  "cdpSupport": true,
  "packageName": "workbuddy",
  "version": "2.1.4",
  "installedAt": 1719187200000,
  "userDataDir": "C:\\Users\\snowb\\AppData\\Roaming\\WorkBuddy",
  "probeReport": {
    "timestamp": 1723456789012,
    "domNodes": 1847,
    "rootElementTag": "body",
    "designTokens": [
      {
        "name": "--wb-bg-primary",
        "value": "#1e1e2e",
        "usageCount": 42,
        "semantic": "background",
        "agentskinMapping": "--agentskin-bg-base",
        "confidence": 0.95
      },
      {
        "name": "--wb-sidebar",
        "value": "#181825",
        "usageCount": 18,
        "semantic": "surface",
        "agentskinMapping": "--agentskin-surface",
        "confidence": 0.90
      },
      {
        "name": "--wb-text",
        "value": "#cdd6f4",
        "usageCount": 120,
        "semantic": "text",
        "agentskinMapping": "--agentskin-text-primary",
        "confidence": 0.90
      },
      {
        "name": "--wb-accent",
        "value": "#89b4fa",
        "usageCount": 35,
        "semantic": "accent",
        "agentskinMapping": "--agentskin-accent",
        "confidence": 0.85
      }
    ],
    "landmarkRegions": [
      {
        "role": "sidebar",
        "selector": "body > div#app > aside.sidebar-container[data-region='nav']",
        "bounds": { "x": 0, "y": 48, "width": 240, "height": 720 },
        "arrivalMethod": "aria"
      },
      {
        "role": "navigation",
        "selector": "body > div#app > header.top-bar",
        "bounds": { "x": 0, "y": 0, "width": 1440, "height": 48 },
        "arrivalMethod": "aria"
      },
      {
        "role": "main",
        "selector": "body > div#app > main.content-area",
        "bounds": { "x": 240, "y": 48, "width": 1200, "height": 672 },
        "arrivalMethod": "rect-clustering"
      }
    ],
    "framework": "vue",
    "frameworkVersion": "3.4.21",
    "hasShadowRoot": false,
    "stylesheetsCount": 12,
    "colorPalette": ["#1e1e2e", "#181825", "#cdd6f4", "#89b4fa", "#a6e3a1", "#f38ba8"]
  },
  "autoAdapter": {
    "appId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "generatedAt": 1723456890123,
    "templateVersion": "v2.1",
    "probeReportId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "mjsPath": "%APPDATA%/AgentSkin/auto-adapters/workbuddy.adapter.mjs",
    "tokensMap": {
      "--wb-bg-primary": "--agentskin-bg-base",
      "--wb-sidebar": "--agentskin-surface",
      "--wb-text": "--agentskin-text-primary",
      "--wb-accent": "--agentskin-accent"
    },
    "isCustomized": false,
    "lastInjectedAt": null,
    "injectionSuccessCount": 0,
    "injectionFailureCount": 0
  },
  "status": "ready",
  "lastScannedAt": 1723456700000,
  "scanCount": 1,
  "failReason": null,
  "metadata": {
    "scannerVersion": "0.1.0",
    "osVersion": "10.0.26200",
    "electronVersion": "31.0.0"
  }
}
```

字段说明：
- **已实现（Phase 1-3 后填充）**：`id`, `name`, `displayName`, `exePath`, `architecture`, `cdpSupport`, `probeReport`
- **待填充（Phase 4 后填充）**：`autoAdapter.mjsPath`, `autoAdapter.lastInjectedAt`, `autoAdapter.injectionSuccessCount`
- **自动管理**：`scanCount`, `lastScannedAt`, `status`, `failReason`, `metadata`

#### 10.4.5 `src/main/cdp/adapter-template-engine.ts` — 模板变量替换

```typescript
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface TemplateVariables {
  AGENT_NAME: string;
  SIDEBAR_SELECTOR: string;
  NAV_SELECTOR: string;
  MAIN_SELECTOR: string;
  PRIMARY_BG: string;
  SURFACE_BG: string;
  TEXT_PRIMARY: string;
  ACCENT_COLOR: string;
  BORDER_COLOR: string;
  SELECTORS_CSS: string;      // 拼接后的选择器 CSS 块
  TOKENS_MAP_JSON: string;    // tokensMap 的 JSON 字符串（注入到 mjs）
}

/**
 * 把模板变量替换为实际 token，生成完整 adapter.mjs
 * 参考来源: Spicetify CLI 的 CSS patch 变量机制
 */
export function generateAdapter(
  templatePath: string,
  variables: TemplateVariables
): string {
  const template = readFileSync(templatePath, 'utf-8');

  return template
    .replace(/\{\{AGENT_NAME\}\}/g,        variables.AGENT_NAME)
    .replace(/\{\{SIDEBAR_SELECTOR\}\}/g,  variables.SIDEBAR_SELECTOR)
    .replace(/\{\{NAV_SELECTOR\}\}/g,      variables.NAV_SELECTOR)
    .replace(/\{\{MAIN_SELECTOR\}\}/g,     variables.MAIN_SELECTOR)
    .replace(/\{\{PRIMARY_BG\}\}/g,        variables.PRIMARY_BG)
    .replace(/\{\{SURFACE_BG\}\}/g,        variables.SURFACE_BG)
    .replace(/\{\{TEXT_PRIMARY\}\}/g,      variables.TEXT_PRIMARY)
    .replace(/\{\{ACCENT_COLOR\}\}/g,      variables.ACCENT_COLOR)
    .replace(/\{\{BORDER_COLOR\}\}/g,      variables.BORDER_COLOR)
    .replace(/\{\{SELECTORS_CSS\}\}/g,     variables.SELECTORS_CSS)
    .replace(/\{\{TOKENS_MAP_JSON\}\}/g,   variables.TOKENS_MAP_JSON);
}

/**
 * 根据 probe report 自动生成 TemplateVariables
 * 供 CLI 脚本 scripts/agent-adapter-generator.mjs 调用
 */
export function buildVariablesFromProfile(profile: any): TemplateVariables {
  const tokens: Record<string, string> = {};
  for (const t of probeReport.designTokens) {
    tokens[t.name] = `var(${t.agentskinMapping ?? '--agentskin-fallback'})`;
  }

  // 关键变量：优先取置信度最高的
  const findBySemantic = (sem: string) =>
    probeReport.designTokens.find((t: any) => t.semantic === sem)?.value ?? '#888888';

  return {
    AGENT_NAME: profile.name,
    SIDEBAR_SELECTOR: findSelectorByRole('sidebar'),
    NAV_SELECTOR:      findSelectorByRole('navigation'),
    MAIN_SELECTOR:     findSelectorByRole('main'),
    PRIMARY_BG:        findBySemantic('background'),
    SURFACE_BG:        findBySemantic('surface'),
    TEXT_PRIMARY:      findBySemantic('text'),
    ACCENT_COLOR:      findBySemantic('accent'),
    BORDER_COLOR:      findBySemantic('border'),
    SELECTORS_CSS:     buildSelectorsBlock(),
    TOKENS_MAP_JSON:   JSON.stringify(tokens, null, 2),
  };

  function findSelectorByRole(role: string): string {
    const region = profile.probeReport.landmarkRegions.find((r: any) => r.role === role);
    return region?.selector ?? 'body > *:first-child';
  }

  function buildSelectorsBlock(): string {
    return probeReport.landmarkRegions
      .map((r: any) => `${r.selector} { /* region: ${r.role} */ }`)
      .join('\n');
  }
}
```

---

### 10.5 新增文件树总表 — `src/main/discovery/`

```
src/main/discovery/
├── app-scanner.ts              # Phase 1 | Windows 注册表扫描提取已安装应用列表
├── architecture-analyzer.ts    # Phase 1 | PE 头 + 资源文件指纹判定 UI 架构类型
├── cdp-probe.ts                # Phase 1 | 随机端口分配 + DevToolsActivePort + netstat
├── process-matcher.ts          # Phase 1 | wmic 进程 PID → 可执行文件路径映射
│
├── css-token-extractor.ts      # Phase 2 | CDP CSS Domain 批量提取 CSS 自定义属性
│
├── token-classifier.ts         # Phase 3 | 名称正则 + 亮度 + 三维度打分分类 tokens
├── token-semantic-mapper.ts    # Phase 3 | 基于分类推断 agentskin 映射方向
│
└── index.ts                    # 门面导出（可选，引导入口）

src/main/cdp/
├── dom-tree.ts                 # Phase 2 | 修改: 新增 extractAllStylesheets(parseCSSVar)
├── region-detector.ts          # Phase 2 | 新建: ARIA landmark + DBSCAN 双引擎区域检测
├── adapter-template-engine.ts  # Phase 4 | 新建: 模板变量替换生成完整 adapter.mjs
└── snapshot-theme.ts           # Phase 2 | 修改: 快照同时输出 token 元数据

src/main/services/
└── agent-profile-service.ts    # Phase 4 | 新建: CRUD agent profile JSON 文件

scripts/
└── agent-adapter-generator.mjs # Phase 3 | 新 CLI 脚本: 读取 probe report 输出 adapter.mjs

dist/runtime/adapters/auto-adapters/     # Phase 4 产物: 自动生成的 adapter.mjs 集合
%APPDATA%/AgentSkin/agent-profiles/      # Phase 4 产物: <agent-name>.profile.json 集合
```

---

### 10.6 验证标准表格

| 序号 | 验证项 | 目标值 | 验证方法 |
|------|--------|--------|---------|
| 1 | **扫描发现率** | ≥ 85% | 在装有 ≥20 台已知应用的测试机上运行 `app-scanner.ts`，对比控制面板"程序和功能"列出的应用，计算召回率 |
| 2 | **架构分类准确率** | ≥ 90% | 在 10 个标注好架构的 Electron / Qt / Flutter / WPF / UWP 应用上测试 `architecture-analyzer.ts`，对比目视检查结果 |
| 3 | **CDP 连接成功率** | ≥ 80% | 在 ≥10 个 CDP-supporting 应用上依次调用 `cdp-probe.ts`，统计成功建立 WebSocket 并收到 DOM.getDocument 响应的比例 |
| 4 | **Token 提取完整率** | ≥ 70% | 对一个已知含 30 个 CSS 自定义属性的测试 Electron 应用运行 `css-token-extractor.ts`，对比实际声明数与提取数 |
| 5 | **语义推断准确率** | ≥ 75% | 对 Phase 4 提取的 tokens 人工标注 ground truth（100 个随机 token），计算 `token-classifier.ts` 的分类 Top-1 准确率 |
| 6 | **Adapter 可直接注入率** | ≥ 60% | 对 5 个不同 Electron 应用执行完整 pipeline（扫描 → 探针 → 分类 → 生成 adapter），验证生成的 adapter.mjs 可在无人工修改情况下成功注入主题并产生视觉变化 |

**验收条件**：所有 6 项指标均达到目标值方可标记 Phase 4 为完成。任一指标未达标需留存 failure analysis 文档并制定迭代计划。

---

*文档版本: v0.2 | 更新日期: 2026-08-05 | 状态: 待审核 — 新增第十节*
