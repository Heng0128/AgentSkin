# AgentSkin CDP 注入与主题化 — GitHub 参考项目手册

> 本文档汇总了 GitHub 上所有主流的桌面应用注入/主题化项目，按技术维度提取可落地的方案，用于增强 AgentSkin 现有的 6 个 agent 的注入能力。

---

## 一、注入架构模式 — 代码怎么跑进目标应用

AgentSkin 目前使用 CDP WebSocket 注入，对上电即用型需要更稳定方案。

| 代表项目 | 模式 | 核心做法 | 本项目适用 |
|---------|------|---------|-----------|
| **Vencord** (13.8k★) | 入口重定向 + BrowserWindow 劫持 | `require.main.filename` 重定向 → monkey-patch `BrowserWindow.prototype`，检测 `webPreferences.preload` 时替换为自己的 preload | 高 — 适用于 Electron agent，无需改 asar |
| **BetterDiscord** (9.2k★) | Injector → Preload → Renderer 三层 | 修改 `core.asar/index.js` 注入 require → preload contextBridge 暴露 API → renderer 劫持 Webpack chunk | 中 — 需改 asar，但结构最清晰 |
| **Spicetify** (23.7k★) | 文件层 → 桥接层 → 运行时层 | asar 解包 → HTML 注入 `<link>`/`<script>` → preload insertCSS | 中 — 借鉴其 css-map 版本兼容机制 |
| **OpenAsar** (4.9k★) | Drop-in asar 替换 | 自身体积极小(50KB)，仅重写入口指向原始 asar | 低 — 需要 per-agent 定制 asar |

**推荐吸收**：Vencord 的 **运行时 BrowserWindow 劫持** — 不改 asar 文件，纯运行时注入。对已启动的 Electron 应用，通过 `app.on('browser-window-created')` 拦截：

```typescript
// 来自 Vencord 的 Electron 注入范式
const original = BrowserWindow.prototype;
const proto = Object.create(original);
proto.webPreferences = new Proxy(original.webPreferences, {
  set(target, key, value) {
    if (key === 'preload') {
      // 保存原始 preload，注入自己的 preload 链
      target.__originalPreload = value;
      target.preload = OUR_PRELOAD_PATH;
    }
    return true;
  }
});
BrowserWindow.prototype = proto;
```

---

## 二、CSS 主题覆盖策略 — 样式怎么覆盖才能生效

AgentSkin 目前使用 adoptedStylesheet 多层注入（L0-L4），但在应对 target app 的 CSS specificity 上仍脆弱。

### 2.1 暗色模式生成算法

| 项目 | 核心算法 | 借鉴 |
|------|---------|------|
| **Dark Reader** (10.1k★) | Dynamic 模式：解析 CSS AST → 遍历 CSSOM → 颜色值做 HSL 变换（旋转色相 + 反转亮度 + 降饱和度） | 直接使用其 HSL 变换算法处理从目标提取出的色板 |
| **Dark Reader** | 三种 Filter 模式平衡性能：`Filter`(全图滤镜) → `Filter+`(CSS filter + SVG) → `Dynamic`(逐个重写 CSS 规则) | 可作为 fallback：当动态 token 提取失败时，用 Filter 模式兜底 |

### 2.2 CSS Specificity 争夺

| 项目 | 策略 | 本项目现状差距 |
|------|------|--------------|
| **BetterDiscord themes** | `!important` 全覆盖 + 更高 specificity 选择器 + 注入位置末尾 | 当前 L0-L4 的 specificity 层级可能不够 |
| **Spicetify** | Community `css-map.json` 维护语义名→实际类名映射 | 缺少针对 6 个 agent 的"类名版本映射表" |
| **ply** (西北大学研究) | Visual relevance pruning — 逐一移除属性后截图比对，确认是否生效 | 可作为"注入效果验证"模块：注入前后截图 diff |

### 2.3 CSS Map 机制（对抗目标应用更新）

**Spicetify 的 css-map.json** 是其核心壁垒。Spotify 每次更新会重命名混淆 class，地图随之更新。

```json
// css-map.json 示例
{
  "version": "1.2.42",
  "map": {
    ".main-nowPlayingBar-container": "main-nowPlayingBar-container",
    ".main-topBar-topbarContent": "NHapMTgGWyWl6rj7bHX0",
    ".Root__now-playing-bar": "Ft1cMDRtZKG1GGBe30N0"
  }
}
```

**AgentSkin 需要**：
1. 为每个 agent 建立 `class-map.json` 映射表
2. 对 Webpack hash 类名做正则 fallback（如 `.css-1x2abc-*`）
3. CDP 快照抓取时记录"稳定锚点"（role、data-* 属性、DOM 位置）

---

## 三、Token 提取与分类 — 怎么知道要改哪些变量

### 3.1 运行时 CSS 自定义属性提取

| 项目 | 提取方式 | 借鉴点 |
|------|---------|--------|
| **design-extract** | Playwright 渲染后遍历 `document.styleSheets` + 解析 `:root` 自定义属性，按 `primitive/composite/semantic` 三级分类 | 三级分类法适合我们的 token 语义映射 |
| **Dark Reader Dynamic** | 完整遍历 `document.styleSheets *` 每条规则，匹配颜色属性 | 颜色属性的批量正则匹配 |

### 3.2 Token 语义自动推断

```typescript
// 来自 design-extract + AgentSkin 实际需求
interface TokenClassification {
  property: string;          // 原始变量名，如 "--doubao-chat-bg"
  semantic: 'background' | 'surface' | 'text' | 'border' | 'accent';
  luminance: number;         // 相对亮度 0-1
  frequency: number;         // DOM 节点使用此变量的次数
  agentskinMapping: string;  // 推断映射目标
}

// 推断规则（综合自 ply + design-extract）
function inferSemantic(propName: string, value: string): Semantic {
  const lp = propName.toLowerCase();
  
  // 按名称前缀/关键词打分 (最高优先级)
  if (/^(color|c-|text-?|foreground)/.test(lp)) return 'text';
  if (/^(bg|background|backdrop)/.test(lp)) return 'background';
  if (/^(surface|panel|card|container|body)/.test(lp)) return 'surface';
  if (/^(outline|border|divider|separator)/.test(lp)) return 'border';
  if (/^(primary|accent|brand|theme|link)/.test(lp)) return 'accent';
  
  // fallback: 分析值颜色亮度
  const lum = relativeLuminance(parseColor(value));
  if (lum > 0.8) return 'background';
  if (lum < 0.15) return 'text';
  return 'unknown';
}
```

### 3.3 Token 频率统计

**Lighthouse CSS usage gatherer** 的模式：

```javascript
// 获取所有节点的计算样式，按属性聚合
const tokenFrequency: Map<string, number> = new Map();

// Step 1: CDP 批量获取
const { nodeIds } = await client.DOM.querySelectorAll({ selector: '*' });
const computedStyles = await Promise.all(
  nodeIds.map(id => client.CSS.getComputedStyleForNode({ nodeId: id }))
);

// Step 2: 统计每个 CSS 自定义属性的使用次数
for (const style of computedStyles) {
  for (const prop of style.computedStyle) {
    if (prop.name.startsWith('--')) {
      tokenFrequency.set(prop.name, (tokenFrequency.get(prop.name) ?? 0) + 1);
    }
  }
}

// Step 3: 按频率排序 → 高频 token 优先映射
const sortedTokens = [...tokenFrequency.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 50);  // 前 50 个即覆盖 80%+ 的场景
```

---

## 四、持久化与兼容性 — 主题注入后怎么活得更久

### 4.1 Reload 后保持注入

| 项目 | 持久化方式 | 可做 |
|------|-----------|------|
| **AgentSkin 现有** | `Page.addScriptToEvaluateOnNewDocument` | 已做 — 页面 reload 后自动重新注入 ✓ |
| **Vencord** | Injector 注入 Chromium startup preload，拦截所有 BrowserWindow 创建 | 更底层 — 不仅对页面，对所有窗口生效 |
| **Tampermonkey** | `run-at document-start` 声明式时机 + 脚本由扩展进程持久化 | 可借鉴声明式时机声明 |
| **Replugged** | 内置 Updater 自动检测 Discord 更新后重新 patch | **关键借鉴**：需要在 agent 更新时重做注入 |

### 4.2 目标应用更新后的应对

| 问题 | Spicetify 方案 | 可抽象的机制 |
|------|--------------|-------------|
| CSS 类名 hash 变化 | 社区手动更新 css-map.json | 自动 diff 新旧类名 → 匹配相似选择器 → 更新映射表 |
| 入口文件路径变化 | `manifest.json` 记录多版本路径 fallback | 维护每个 agent 的版本 → 注入路径 映射 |
| 构建工具切换 (Babel→SWC) | 全部 patch 切换到更高级别的模块 ID 劫持 | 预留多种注入策略的 fallback chain |
| 签名/完整性校验 | 直接移除签名校验代码 | 不推荐，法律风险 |

### 4.3 Undo / Clean Restore

**BetterDiscord** 的做法：
- 所有注入内容存放在独立目录，不影响原始 asar
- 提供 "Disable" 按钮，移除注入标签和被修改的入口
- 支持一键还原原始 Discord

**AgentSkin 应该：**
1. 注入的 adapter/tokens/cosmetic 存放在独立于 agent userData 的目录（而非覆盖原始文件）
2. Adapter 注入后保存"恢复脚本"：断开 CDP → evaluate 恢复脚本 → 清理 adoptedStylesheet
3. 健康检查 daemon：每 30s 探测一次，如果注入被清除就尝试重新注入

---

## 五、插件/扩展隔离 — 多个 Plugin 如何共存防冲突

### 5.1 错误隔离

| 项目 | 方式 | 借鉴 |
|------|------|------|
| **Notion-Enhancer** (5k★) | 独立 Loader + try/catch 包裹每个扩展初始化 + 单扩展失败不阻塞其他 | 关键模式：`await Promise.allSettled(extensions.map(load))` |
| **Vencord** | Patcher API 包装了 before/after/instead 三种注入，失败时自动 unwrap | before/after/instead API 抽象 |

### 5.2 Handler 生命周期

```typescript
// Vencord Patcher API — 可抽象为 AgentSkin 的"注入点注册器"
class Patcher {
  // 三种注入方式
  before(obj: any, key: string, handler: (args: any[]) => any) {
    const original = obj[key];
    obj[key] = function (...args: any[]) {
      handler.call(this, args);
      return original.apply(this, args);
    };
  }
  
  instead(obj: any, key: string, handler: (args: any[], original: Function) => any) {
    const original = obj[key];
    obj[key] = function (...args: any[]) {
      return handler.call(this, args, original.bind(this));
    };
  }
  
  after(obj: any, key: string, handler: (args: any[], ret: any) => any) {
    const original = obj[key];
    obj[key] = function (...args: any[]) {
      const ret = original.apply(this, args);
      return handler.call(this, args, ret);
    };
  }
  
  // 一键 undo — 按 ID 反转 patch 操作
  unpatch(id: string) { /* ... */ }
}
```

---

## 六、Anti-detection / 注入隐蔽

### 6.1 对抗 ASAR 校验

BetterDiscord 曾被 Discord 短暂对抗（read-only check），应对：

| 方法 | 代表 | 说明 |
|------|------|------|
| **不修改 asar 原始文件** | Vencord, OpenAsar | 运行时 patch 而非静态 patch — 无法被文件 hash 校验发现 |
| **Steam 皮肤目录** | Metro for Steam | 走官方支持路径 — 零对抗风险 |
| **独立壳** | ArmCord, Altus(WhatsApp), WebCord | 不用 Discord.exe — 完全不被反作弊检测 |

### 6.2 运行时检测规避

**GoofCord** 的实现：
- 所有注入的 CSS 类名均有 `gf-` 前缀，方便批量清除（防被检测后清理）
- 通过 Settings API 切换而非 DOM 修改时保留原始
- 使用 `Settings` 字段而非 localStorage 存储配置（Discord 无法轻易读取）

### 6.3 持久化脚本的自我保护

**AgentSkin 现有的** MutationObserver 自愈机制（部分 adapter.mjs 中已有），可强化：

```javascript
// 强化版自愈 — 来自现有 workbuddy/adapter.mjs 的思路
const HEALTH_CHECK_INTERVAL = 5000;

function selfHeal() {
  // 检查注入标记是否还在
  if (!document.documentElement.classList.contains('agentskin-host-workbuddy')) {
    // 被清除了 → 重新注入核心
    reapplyBaseInjection();
  }
  
  // 检查 adoptedStylesheet 是否被移除
  const styleEl = document.getElementById('agentskin-palette');
  if (!styleEl) {
    reapplyStylesheet();
  }
  
  // 周期性恢复选择器匹配的元素样式
  applyHeuristicStyles();
}

setInterval(selfHeal, HEALTH_CHECK_INTERVAL);
```

---

## 七、具体可落地的增强清单（按优先级）

### 🔴 高优先级（立即增强）

| # | 增强项 | 吸取自 | 工作量 |
|---|--------|-------|--------|
| 1 | **CSS Map 版本映射表**：为 6 个 agent 建立 `{name → actualClass}` 映射，支持正则 fallback | Spicetify css-map.json | 中 |
| 2 | **Token Auto-Mapper**：CDP 批量 getComputedStyle → 频率统计 → 语义推断 → agentskin 映射文件 | design-extract + Lighthouse | 大 |
| 3 | **HSL Color Transform**：当目标 app 没有 CSS 自定义属性时，用颜色变换算法实现暗色主题 | Dark Reader Dynamic | 中 |
| 4 | **注入健康 Daemon**：周期性自检 + 自动重注入 | Spicetify + 现有部分 adapter 自愈 | 小 |
| 5 | **before/after/instead Patcher API**：比正则替换更稳定的注入点劫持 | Vencord Patcher | 中 |

### 🟡 中优先级（下个版本）

| # | 增强项 | 吸取自 | 工作量 |
|---|--------|-------|--------|
| 6 | **Visual Relevance Pruning**：注入效果验证 — 截图 diff 确认样式生效 | ply (西北大学) | 大 |
| 7 | **Modular Loader 隔离**：单 agent 注入失败不阻塞其他 | Notion-Enhance | 小 |
| 8 | **声明式注入时机 API**：`run-at: page-start/dom-ready/idle` | Tampermonkey | 中 |
| 9 | **独立壳方案**：对无法注入的应用，提供"封装外壳"作为最后 fallback | ArmCord, Altus | 大 |

### 🟢 低优先级（探索期）

| # | 增强项 | 吸取自 | 份量 |
|---|--------|-------|------|
| 10 | **ASAR Patch Pipeline**：解包 → patch → 重打包，应对需要静态注入的场景 | Wand-Enhancer | 中 |
| 11 | **远程 css-map 自动更新**：云端 agent 版本 → class 映射表，自动化维护 | Replugged Updater | 中 |
| 12 | **Plugin Marketplace**：在内嵌设置 UI 中提供主题/插件商店入口 | Spicetify Marketplace / Replugged Store | 大 |

---

## 八、当前 AgentSkin 薄弱项 vs 已知解决方案对照

| 薄弱现状 | 参考项目已解决的问题 | 推荐方案 |
|---------|-------------------|---------|
| CDP 注入后，一旦 target app 刷新/路由变化，注入丢失 | Dark Reader 持久化 + AgentSkin 已有 addScriptToEvaluateOnNewDocument | 在持久化脚本中加入 MutationObserver 强化自愈 |
| 目标 app 更新后 class 名 hash 全部打乱，原有 adapter 选择器失效 | Spicetify css-map (700+ 条目经验) | 为每个 agent 维护版本化 css-map.json |
| CSS Specificity 不够，target app 原生样式覆盖了 injected 样式 | BetterDiscord 全程 `!important` + 末尾注入 | L0-L4 层统一加 `!important` 标记 |
| 暗色主题仅靠 CSS 变量覆盖，对"颜色写死"的 app 无解 | Dark Reader 三级 fallback | 引入颜色变换算法，作为 token 映射失败的兜底 |
| 手动编写 adapter.mjs 工作量大（每个 agent 30-50 行 CSS+NPE） | Spicetify 的 css-map 减少手写 + CSS Loader 的声明式 | 自动化 adapter 生成 (50% 自动 + 人工微调) |
| 无"注入效果验证"手段，用户只能肉眼判断 | ply 的 visual relevance pruning | 注入前后 CDP 截图 diff + deltaE 色差计算 |
| 没有插件/扩展市场，对新特性都要改核心代码 | Spicetify Marketplace / Replugged Store / Vencord 100+ 插件 | 先聚焦现有的 6 个 agent 做好，再做生态 |

---

*文档版本: v1.0 | 创建日期: 2026-08-05 | 调研覆盖项目数: 28 个*

---

## 九、可执行实施方案 — 文件级改造清单

> 以下是将上述参考项目经验落地的具体文件修改清单。按优先级排序，包含"改哪个文件"、"加什么代码"、"参考哪个项目"。

### 9.1 准备阶段 — 必须优先克隆的项目

| 排名 | 项目 | 理由 | 克隆到 |
|------|------|------|--------|
| 🥇 #1 | **Vencord** (github.com/Vendicated/Vencord) | Patcher API + BrowserWindow 劫持 + before/after/instead 注入范式 | `~/.agentskin/ref/vencord/` |
| 🥈 #2 | **BetterDiscord** (github.com/BetterDiscord/BetterDiscord) | Injector 三层架构 + asar 解包 + css-map 机制 | `~/.agentskin/ref/betterdiscord/` |
| 🥉 #3 | **Dark Reader** (github.com/darkreader/darkreader) | CSS AST HSL 变换 + 三级 Filter 模式 | `~/.agentskin/ref/darkreader/` |
| #4 | **Replugged** (github.com/replugged-org/replugged) | Updater 自动检测目标版本变化 + 重新 patch | `~/.agentskin/ref/replugged/` |
| #5 | **OpenAsar** (github.com/GooseMod/OpenAsar) | 最小 asar 替换模式（50KB drop-in） | `~/.agentskin/ref/openasar/` |

### 9.2 文件修改清单 — 按执行顺序

#### 第一周：强化 CSS Specificity + 注入健康检查

**文件 1**: `src/main/cdp/injection/engine-strategy.ts`
- **改动内容**: 在注入 L0-L4 层时，为每个 CSS 规则附加 `!important` 标记
- **代码改动**:
```typescript
// 在函数 `injectCssLayer` 中，构建 CSS 文本后添加：
function ensureImportant(cssText: string): string {
  // 在每条规则的分号后插入 !important
  return cssText.replace(/([a-z-]+):\s*([^;{}]+)([;}])/gi, '$1: $2 !important$3');
}
```
- **参考**: BetterDiscord themes 的 `!important` 全覆盖策略

**文件 2**: `src/main/cdp/cdp-inject.ts`
- **改动内容**: 新增 `startHealthCheckDaemon` 函数
- **代码改动**:
```typescript
// 新增健康检查守护进程
const HEALTH_CHECK_INTERVAL_MS = 30_000;

export function startHealthCheckDaemon(session: CdpSession, agentId: string) {
  const timer = setInterval(async () => {
    try {
      const result = await verifyTheme(session);
      if (result.adoptedSheetCount === 0) {
        // 注入被清除，触发重注入
        mainWarn(`[health] ${agentId} injection lost, re-injecting...`);
        // 调用 re-inject 逻辑
      }
    } catch (err) {
      mainWarn(`[health] ${agentId} health check failed: ${toMessage(err)}`);
    }
  }, HEALTH_CHECK_INTERVAL_MS);
  
  // 返回清理函数
  return () => clearInterval(timer);
}
```
- **参考**: Spicetify 的监听检测 + AgentSkin 现有部分 adapter 的自愈机制

**文件 3**: `src/main/cdp/cdp-watcher.ts`
- **改动内容**: 在 agent 注册时启动健康 daemon
- **改动方式**: 在 `watchAgent` 函数返回值中增加 cleanup 数组，将 health daemon 加入清理列表

#### 第二周：CSS Map 版本映射表

**文件 4**: `src/main/catalog/manifest-v2.schema.json`
- **改动内容**: 新增 `cssMap` 字段
```jsonc
{
  "properties": {
    "cssMap": {
      "type": "object",
      "description": "CSS class name mapping for version resilience",
      "patternProperties": {
        "^.*$": { "type": "string" }
      }
    }
  }
}
```

**文件 5-10**: 为每个 agent 创建 `engines/<agent>/class-map.json`
- **workbuddy**: `engines/workbuddy/class-map.json`
- **doubao**: `engines/doubao/class-map.json`
- **zcode**: `engines/zcode/class-map.json`
- **qoderwork**: `engines/qoderwork/class-map.json`
- **traework**: `engines/traework/class-map.json`
- **codex**: `engines/codex/class-map.json`

格式：
```jsonc
{
  "agentVersion": ">=1.0.0",
  "map": {
    "sidebar": "_css_sidebar_1x2abc",
    "main-chat": "_css_mainChat_3def45",
    "composer": "_css_composer_678ghi"
  },
  "regexFallbacks": {
    "sidebar": ["aside", "[role=complementary]", ".sidebar-.*"],
    "main-chat": ["main", "[role=main]", "[data-testid=chat].*"]
  }
}
```

**文件 11**: `src/main/cdp/dom-tree.ts`
- **改动内容**: 新增 `selectorsFromClassMap` 函数
```typescript
interface ClassMapEntry {
  agentVersion: string;
  map: Record<string, string>;
  regexFallbacks: Record<string, string[]>;
}

export function resolveSelector(key: string, classMap: ClassMapEntry): string {
  // 1. 优先精确匹配
  if (classMap.map[key]) return `.${classMap.map[key]}`;
  // 2. 正则 fallback
  if (classMap.regexFallbacks[key]) {
    return classMap.regexFallbacks[key].join(', ');
  }
  // 3. 最终 fallback：aria
  return `[data-agentskin-region="${key}"]`;
}
```

#### 第三周：Token Auto-Mapper（CDP 批量统计 + 语义推断）

**文件 12**: `src/main/cdp/dom-tree.ts`
- **改动方向**: 新增 `extractTokenFrequency` 和 `classifyTokens` 两个函数

```typescript
// 新增：批量提取 CSS 自定义属性使用频率
export async function extractTokenFrequency(
  session: CdpSession
): Promise<Array<{ property: string; count: number; semantic: string }>> {

  // Step 1: 获取所有节点
  const doc = await session.client.DOM.getDocument();
  const { nodeIds } = await session.client.DOM.querySelectorAll({
    nodeId: doc.root.nodeId,
    selector: '*',
  });

  // Step 2: 批量获取计算样式 (每批 50 个避免超时)
  const tokenCounts = new Map<string, number>();
  const BATCH_SIZE = 50;
  
  for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
    const batch = nodeIds.slice(i, i + BATCH_SIZE);
    const styles = await Promise.all(
      batch.map(id =>
        session.client.CSS.getComputedStyleForNode({ nodeId: id })
      )
    );
    for (const cs of styles) {
      for (const prop of cs.computedStyle) {
        if (prop.name.startsWith('--')) {
          tokenCounts.set(prop.name, (tokenCounts.get(prop.name) ?? 0) + 1);
        }
      }
    }
  }

  // Step 3: 按频率排序 + 语义推断
  return [...tokenCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([property, count]) => ({
      property,
      count,
      semantic: inferSemanticFromProperty(property),
    }));
}

// 新增：从属性名推断语义
function inferSemanticFromProperty(prop: string): string {
  const lower = prop.toLowerCase();
  if (/text|color|foreground/.test(lower)) return 'text';
  if (/bg|background/.test(lower)) return 'background';
  if (/surface|panel|card|container/.test(lower)) return 'surface';
  if (/border|divider|separator/.test(lower)) return 'border';
  if (/primary|accent|brand|theme/.test(lower)) return 'accent';
  return 'unknown';
}
```

**文件 13**: `src/main/profile/color-quantize.ts`
- **改动方向**: 更新为支持 Dark Reader 风格的 HSL 变换

```typescript
// 新增：HSL 颜色变换（用于没有 CSS 变量时的暗色 fallback）
export function hslTransform(color: RGB, mode: 'darken' | 'desaturate'): RGB {
  const [h, s, l] = rgbToHsl(color.r, color.g, color.b);
  
  if (mode === 'darken') {
    return hslToRgb(h, s * 0.85, Math.min(l * 0.6, 0.15));
  }
  return hslToRgb(h, s * 0.7, 1 - l * 0.8);
}
```

#### 第四周：before/after/instead Patcher API + 错误隔离

**文件 14**: `src/main/cdp/injection/engine-strategy.ts`
- **改动方向**: 新增 Patcher class（从 Vencord 抽象）

```typescript
// 新增：注入点注册器 — 参考 Vencord Patcher API
export class Patcher {
  private patches = new Map<string, { original: Function; unpatch: () => void }>();

  before<T extends (...args: any[]) => any>(
    target: { [key: string]: T },
    key: string,
    handler: (args: Parameters<T>) => void
  ): string {
    const original = target[key];
    const id = `before_${key}_${Date.now()}`;
    
    target[key] = function (...args: any[]) {
      handler(args);
      return (original as Function).apply(this, args);
    } as T;

    this.patches.set(id, {
      original,
      unpatch: () => { target[key] = original; },
    });
    return id;
  }

  // after / instead 同理...

  unpatch(id: string) {
    const entry = this.patches.get(id);
    if (entry) {
      entry.unpatch();
      this.patches.delete(id);
    }
  }

  unpatchAll() {
    for (const [, entry] of this.patches) entry.unpatch();
    this.patches.clear();
  }
}
```

**文件 15**: `src/main/cdp/cdp-fanout.ts`
- **改动方向**: 用 `Promise.allSettled` 替代 `Promise.all`（隔离单 agent 失败）

```typescript
// 修改前：
// await Promise.all(sessions.map(s => applyTheme(s, theme)));

// 修改后（参考 Notion-Enhancer 的隔离模式）：
const results = await Promise.allSettled(
  sessions.map(s => applyTheme(s, theme))
);

for (let i = 0; i < results.length; i++) {
  if (results[i].status === 'rejected') {
    mainWarn(`[fanout] ${sessions[i].agentId} failed: ${(results[i] as PromiseRejectedResult).reason}`);
    // 继续处理，不阻塞其他 agent
  }
}
```

#### 第五周：HSL Color Transform 兜底

**文件 16**: `src/main/cdp/cdp-inject.ts`
- **改动方向**: 新增 `applyHslFallback` 函数

```typescript
// 当目标 app 没有 CSS 变量时，对写死的颜色值做 HSL 变换
// 参考 Dark Reader Dynamic 模式
async function applyHslFallback(session: CdpSession) {
  const expression = `
    (() => {
      // 遍历所有 CSS 规则
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.style && rule.style.color) {
              // HSL 变换 ...
            }
          }
        } catch (e) { /* cross-origin stylesheet, skip */ }
      }
    })()
  `;
  await session.client.Runtime.evaluate({ expression });
}
```

### 9.3 新增 npm 依赖

| 包名 | 用途 | 安装命令 |
|------|------|---------|
| `color-convert` | RGB/HSL/Lab 颜色空间转换 | `npm install color-convert` |
| `css-selector-generator` | 稳定 CSS 选择器生成（已有则不需） | `npm install css-selector-generator` |
| `postcss` | CSS 语法校验 | `npm install -D postcss` |
| `wcag-contrast` | WCAG 对比度计算 | `npm install wcag-contrast` |

### 9.4 验证标准

| 验证项 | 命令 | 期望 |
|--------|------|------|
| 注入健康检查生效 | 启动 agent + 应用主题 → 等待 30s | 日志输出 `[health] injection verified` |
| CSS Map fallback | 在 engines/<agent>/class-map.json 写错 class 名 | 仍然通过 regex/aria fallback 命中目标 |
| Token 提取 | 运行 `node scripts/extract-tokens.mjs --agent=workbuddy` | 输出 top 50 tokens + 语义分类 |
| 单 agent 失败隔离 | 关闭一个 agent，对另一个注入 | 成功的 agent 主题正常应用 |
| Patcher undo | 调用 `patcher.unpatchAll()` | 所有注入点恢复原始 |
