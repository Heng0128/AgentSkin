# WorkBuddy 换肤引擎架构技术深潜

> 2026-08-29 | 基于竞品源码级分析，聚焦注入引擎架构与编排机制，输出 AgentSkin 四引擎 + 编排层优化方案

---

## 一、分析范围与方法

### 1.1 源码获取

| 仓库 | 获取内容 | 大小 |
|------|---------|------|
| cdredfox/workbuddy-skin-studio | `cdp-client.mjs` + `injector.mjs` + `skin-css.mjs` + `theme-schema.mjs` + `skin-menu.mjs` + `constants.mjs` + `cli.mjs` | ~55KB |
| zhouwei713/WorkBuddy-Dream-Skin | `renderer-inject.js` + `style-palettes.json` + `00-base.css` + `60-chrome.css` | ~120KB |
| comeonzhj/WorkBuddy-theme-skill | `theme-library.mjs` (atomic install + sync) | ~14KB |

### 1.2 对照基线

AgentSkin 当前架构（源码实测）：
- `src/shared/injection/orchestrator/` — InjectionOrchestrator + InjectionLock + InjectionQueue + InjectionSnapshotManager
- `src/main/cdp/injection/engine-strategy.ts` — 5 层 CSS 注入 + adapter + hero
- `src/main/cdp/injection/css-inject.ts` — adoptedStyleSheets 注入
- `src/main/cdp/injection/cdp-strategy.ts` — 单样式表策略

---

## 二、竞品 CDP 引擎架构分析

### 2.1 cdredfox：完整 CDP WebSocket 客户端

#### 2.1.1 CdpSession 类（15KB，360 行）

核心设计：**请求-响应关联 + 超时管理 + 单次终止**。

```javascript
// 关键数据结构
class CdpSession {
  this.pending = new Map();        // id → { method, resolve, reject, timer }
  this.nextRequestId = 1;          // 自增 ID
  this.terminalError = null;       // 单次终止标记
  this.socketOpen = false;
  this.opened = false;             // 启用 Runtime + Page 后才算 opened
}
```

**连接生命周期**：
1. `new WebSocket(url)` → 注册 onopen/onmessage/onerror/onclose
2. `onopen` → `Promise.all([send("Runtime.enable"), send("Page.enable")])`
3. 两个 domain 都启用后 `opened = true`，resolve openPromise
4. 任何错误调用 `terminate(error)` — 设置 terminalError，reject 所有 pending，只执行一次

**关键方法**：
- `send(method, params)` — 分配 ID，创建 pending 条目 + 超时定时器，JSON 序列化发送
- `evaluate(expression)` — 调用 `Runtime.evaluate`，检查 `exceptionDetails`，返回 `result.value`
- `close()` — 触发 terminate + closeSocket

**安全约束**：
- `parseLoopbackWebSocketUrl()` — 强制 `ws://127.0.0.1` + 显式端口，拒绝认证/哈希
- `validatePort()` — 1024-65535 范围
- `isRendererTarget()` — 过滤 `renderer/index.html`，只注入正确页面

#### 2.1.2 多目标注入（injector.mjs）

```javascript
async function evaluateTargets(targets, expression, Session) {
  const values = [];
  for (const target of targets) {
    const session = new Session(target.webSocketDebuggerUrl);
    try {
      await session.open();
      values.push(await session.evaluate(expression));
    } finally {
      session.close();
    }
  }
  return values;
}
```

**关键发现**：竞品对**每个 renderer target 创建独立 session**，串行执行同一表达式。这支持 WorkBuddy 多窗口场景。

**对比 AgentSkin**：AgentSkin 的 engine-strategy 在单个 session 上操作，未显式遍历多目标。orchestrator 的 `execute()` 仅针对 `agentId` 维度，不区分同 agent 的多个 render target。

#### 2.1.3 CSS 生成（skin-css.mjs）

**策略**：覆盖 WorkBuddy 的 `--cb-*` 变量系统（60+ 个），使用 `color-mix()` 派生中间色。

```javascript
// 核心模式：4 → 60+ 变量展开
function buildSkinCss({ theme, heroDataUrl }) {
  const colors = { accent, secondary, surface, text };  // 4 个输入
  return `
    body[data-application-name=workbuddy] {
      --cb-bg-primary: var(--wb-surface) !important;
      --cb-text-primary: var(--wb-text) !important;
      --cb-vscode-editor-background: var(--wb-surface) !important;
      --cb-button-dark-background: var(--wb-accent) !important;
      /* ... 60+ 变量 ... */
    }
    #root {
      background: linear-gradient(...), url(${heroDataUrl}) right center / cover no-repeat fixed;
    }
    .teams-container { background: transparent !important; }
    [data-view-id] { background: transparent !important; }
    [data-view-id=sidebar] { backdrop-filter: blur(20px) saturate(1.12); }
  `;
}
```

**关键技巧**：
- `color-mix(in srgb, var(--wb-surface) 94%, transparent)` — 半透明派生
- `!important` 全覆盖 — 确保覆盖 WorkBuddy 内联样式
- `#root` 背景图 + 子容器 `transparent` — 让底图透出
- `backdrop-filter: blur(20px)` — 磨砂玻璃面板

**对比 AgentSkin**：AgentSkin 的 engine-strategy 使用 5 层 adoptedStyleSheets（palette → tokens → cosmetic → theme → custom），每层独立生命周期。竞品用单层 CSS 字符串 + `!important` 覆盖。AgentSkin 的分层架构更精细但更复杂。

#### 2.1.4 页面内菜单（skin-menu.mjs，12.6KB）

**架构**：Node 端生成 IIFE 表达式 → CDP `Runtime.evaluate` 在页面内执行 → 创建 DOM + 事件监听。

**核心功能**：
1. 主题切换按钮（右上角 🎨）
2. 主题列表渲染（accent 色 dot + 名称）
3. 自定义图片上传 → Canvas 取色 → 生成 CSS → localStorage 持久化
4. 深浅色自动切换（surface 明度 > 140 = light）
5. `window.__workbuddySkin` 暴露脚本化 API

**取色算法**（`extractPalette`）：
```javascript
// 1. 缩小到 48px 宽
// 2. 遍历像素：过滤灰/暗/低饱和
// 3. 按色相分桶（6 桶 × 2 饱和档 = 12 桶）
// 4. 按权重排序 → accent = 最高权桶
// 5. 找色相差 > 50° 的次色 → secondary
// 6. 根据平均明度派生 surface/text
```

**哨兵机制**（CSS_SENTINELS）：
```javascript
// Node 端生成模板时用哨兵占位
const cssTemplate = buildSkinCss({
  theme: {
    id: CSS_SENTINELS.id,       // "workbuddy-custom-sentinel-id"
    colors: { accent: "#010203", secondary: "#040506", ... },
  },
  heroDataUrl: CSS_SENTINELS.hero,  // "data:image/png;base64,WORKBUDDYHEROSENTINEL"
});

// 页面内替换哨兵 → 真实值
const buildCustomCss = (dataUrl, colors) => data.cssTemplate
  .split(data.sentinels.hero).join(dataUrl)
  .split(data.sentinels.accent).join(colors.accent)
  // ...
```

**对比 AgentSkin**：AgentSkin 的 Studio 是 React 组件，竞品是纯 JS IIFE。AgentSkin 的 `derive-missing-tokens.mjs` 基于规则推导，竞品基于 Canvas 像素分析。

### 2.2 zhouwei713：页面内自持注入器

#### 2.2.1 renderer-inject.js（17KB，一次性 IIFE）

**架构**：自执行函数，接收 CSS/图片/主题 JSON 作为参数，在页面内自持运行。

```javascript
((cssText, artDataUrls, theme, skinVersion) => {
  const STATE_KEY = "__WORKBUDDY_DREAM_SKIN_STATE__";
  const previous = window[STATE_KEY];
  previous?.observer?.disconnect();  // 清理旧实例
  
  const ensure = () => { /* 幂等渲染 */ };
  const cleanup = () => { /* 完全清理 */ };
  
  // 持久化：MutationObserver + setInterval(5s)
  const observer = new MutationObserver(scheduleEnsure);
  const timer = setInterval(ensure, 5000);
  window[STATE_KEY] = { ensure, cleanup, observer, timer, ... };
  ensure();
})(cssJson, artJson, themeJson, versionJson);
```

**核心设计模式**：

1. **幂等渲染**（`ensure()`）：
   - 检查元素是否存在，存在则更新，不存在则创建
   - 通过 `dataset.version` 避免重复设置 CSS
   - 返回 `{ installed: true, version, themeId }`

2. **防抖重渲染**（`scheduleEnsure()`）：
   ```javascript
   const scheduler = { timeout: null };
   const scheduleEnsure = () => {
     if (scheduler.timeout) clearTimeout(scheduler.timeout);
     scheduler.timeout = setTimeout(() => {
       scheduler.timeout = null;
       ensure();
     }, 180);  // 180ms 防抖
   };
   ```

3. **双重持久化**：
   - `MutationObserver` — DOM 变化时触发
   - `setInterval(5000)` — 兜底轮询

4. **状态外部化**：`window[STATE_KEY]` 存储所有状态，支持外部调用 `cleanup()`

5. **Object URL 生命周期管理**：
   ```javascript
   const createArtUrl = (artDataUrl) => {
     const binary = atob(artDataUrl.slice(comma + 1));
     const bytes = new Uint8Array(binary.length);
     for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
     return URL.createObjectURL(new Blob([bytes], { type: mime }));
   };
   // 清理时
   for (const oldUrl of new Set(Object.values(previous?.artUrls || {}))) {
     if (oldUrl) URL.revokeObjectURL(oldUrl);
   }
   ```

**对比 AgentSkin**：
- AgentSkin 的 adapter.mjs 已有 MutationObserver 自愈，但无 `setInterval` 兜底
- AgentSkin 的 hero-inject 使用 `Page.addScriptToEvaluateOnNewDocument` 持久化，竞品用 IIFE 内状态
- AgentSkin 缺少 Object URL 的显式 revoke 机制

#### 2.2.2 CSS 分层（8 个文件）

```
assets/css/
├── 00-base.css              # 基础变量 + 字体 + 滚动条
├── 10-conversation.css      # 会话列表
├── 20-workspace-preparing.css
├── 30-composer.css          # 编辑器（22KB，最大）
├── 40-pages.css             # 页面（28KB，最大）
├── 50-overlays.css          # 遮罩层
├── 60-chrome.css            # 侧边栏 + 装饰（40KB，最大）
├── 70-history.css           # 历史记录
├── 80-composer-fade.css     # 编辑器淡入
└── manifest.json            # 清单
```

**命名约定**：数字前缀表示加载顺序，与 AgentSkin 的 palette → tokens → cosmetic → theme → custom 分层理念一致。

**变量系统**：
```css
html.workbuddy-dream-skin {
  --wbds-background: #071318;
  --wbds-panel: #0B2025;
  --wbds-accent: #58E6C2;
  --wbds-text: #E8F7F3;
  --wbds-muted: #91AAA5;
  --wbds-line: rgba(88, 230, 194, .22);
  /* ... 共 15+ 变量 ... */
}
```

**对比 AgentSkin**：AgentSkin 的 `--agentskin-*` 是 14-token 严格契约，竞品是自由命名。AgentSkin 的契约更严谨但灵活性低。

#### 2.2.3 调色板系统（style-palettes.json）

14 个预置调色板，每个包含：
```json
{
  "pink-dream": {
    "name": "绯樱少女",
    "appearance": "light",
    "backgroundOverlay": 0.42,
    "heroOverlay": 0.18,
    "panelOpacity": 0.9,
    "decoration": { "variant": "full-image-card", "position": "right 14px top 170px" },
    "colors": { "background", "panel", "panelAlt", "accent", "accentAlt", "secondary", "highlight", "text", "muted", "line" }
  }
}
```

**对比 AgentSkin**：AgentSkin 的主题 manifest 是 14-token + 6 CSS，竞品是调色板 + 固定 CSS。竞品的"调色板驱动"模式更适合快速换肤。

### 2.3 comeonzhj：原子安装 + 安全校验

#### 2.3.1 原子安装（theme-library.mjs）

```javascript
async function atomicInstall(stagedDirectory, destination) {
  const backup = `${destination}.backup-${randomUUID()}`;
  const hadDestination = existsSync(destination);
  if (hadDestination) await rename(destination, backup);  // 1. 备份旧目录
  try {
    await rename(stagedDirectory, destination);           // 2. 原子移动
    if (hadDestination) await rm(backup, { recursive: true });  // 3. 成功→删备份
  } catch (error) {
    if (hadDestination && existsSync(backup)) await rename(backup, destination);  // 4. 失败→回滚
    throw error;
  }
}
```

**对比 AgentSkin**：AgentSkin 的 theme-store.ts 使用 `atomicWriteFile`（临时文件 + rename），但目录级安装未使用 backup 回滚模式。

#### 2.3.2 主题校验

```javascript
export async function validateThemeDirectory(themeDirectory) {
  // 1. 检查 theme.json 必需字段
  for (const key of ["schemaVersion", "id", "displayName", "version", "mode", "css", "design", "palette"]) { ... }
  
  // 2. CSS 安全检查
  if (!css.includes(`body[data-workbuddy-theme="${manifest.id}"]`)) errors.push("CSS 缺少主题作用域");
  if (/@import\b/i.test(css)) errors.push("主题不能使用 @import");
  if (urls.some((url) => url !== "__WORKBUDDY_THEME_ART__")) errors.push("CSS 只能引用声明的本地背景图占位符");
  
  // 3. 路径穿越防护
  if (!isInside(directory, cssPath)) errors.push("CSS 路径无效");
}
```

**对比 AgentSkin**：AgentSkin 的 `theme-source-parser.ts` 有 schema 校验，但缺少 CSS 内容安全扫描（@import/URL 检查）。

#### 2.3.3 GitHub 同步

```javascript
export async function syncThemesFromGitHub(userThemesDirectory, { registryUrl, knownVersions, fetchImpl }) {
  // 1. 下载 registry.json（2MB 限制）
  // 2. 校验 schemaVersion + themes 数组 + rawBaseUrl
  // 3. URL 固定：rawBase.href !== DEFAULT_RAW_BASE → 拒绝
  // 4. 增量同步：knownVersions[remoteTheme.id] ≥ remoteVersion → skip
  // 5. 逐文件下载 + SHA-256 校验
  // 6. 校验通过后 atomicInstall
}
```

**对比 AgentSkin**：AgentSkin 无远程同步能力（受 §7 限制）。但竞品的 URL 固定 + SHA-256 校验模式值得参考。

---

## 三、竞品编排机制分析

### 3.1 生命周期管理

| 阶段 | cdredfox | zhouwei713 | comeonzhj |
|------|---------|------------|-----------|
| 启动 | `apply.ps1` → `cli.mjs apply` | `apply.command` → `cli.mjs` | Electron 启动 → Theme Manager |
| 注入 | CDP evaluate IIFE | CDP evaluate IIFE | CDP evaluate IIFE |
| 持久化 | IIFE 内 `window.__workbuddySkin` | `MutationObserver` + `setInterval(5s)` | 守护进程 + `Page.addScriptToEvaluateOnNewDocument` |
| 清理 | `pause.ps1` → `removeSkin()` | `cleanup()` → 移除所有 DOM | Theme Manager → `restore` |
| 重启恢复 | 需重新 apply | 需重新 apply | 守护进程自动恢复 |

### 3.2 并发控制

**cdredfox**：无并发控制。单 session 串行，多 target 串行。

**zhouwei713**：IIFE 内 `STATE_KEY` 保证单实例。新调用断开旧 observer，清理旧 timer。

**comeonzhj**：Electron 单实例锁 + 守护进程接管。

**对比 AgentSkin**：AgentSkin 的 `InjectionLock` + `InjectionQueue` 是最完善的并发控制方案。竞品均无 per-agent 锁机制。

### 3.3 错误恢复

**cdredfox**：
- `CdpSession.terminate()` — 单次终止，所有 pending 被 reject
- `fetchRendererTargets` 超时 → 抛出异常
- `applySkin` 中单个 theme 加载失败 → 跳过（不阻塞菜单）

**zhouwei713**：
- `ensure()` 幂等 — 可安全重试
- `setInterval(5s)` 兜底 — 即使 MutationObserver 错过也能恢复

**comeonzhj**：
- `atomicInstall` 失败 → rename 回滚备份
- `syncThemesFromGitHub` 单主题失败 → 跳过，不影响其他主题

**对比 AgentSkin**：AgentSkin 的 `InjectionSnapshotManager` 提供事务回滚，但 capture 函数返回空状态（orchestrator.ts L117），实际回滚能力有限。

---

## 四、AgentSkin 四引擎 + 编排层优化建议

### 4.1 engine-strategy.ts 优化

#### 4.1.1 【P0】多 renderer target 支持

**现状**：engine-strategy 在单个 session 上操作，未遍历同 agent 的多个 render target。

**竞品方案**：cdredfox 的 `evaluateTargets()` 对每个 target 创建独立 session，串行执行。

**建议**：
```typescript
// 新增：获取 agent 的所有 renderer targets
async function getAllRendererTargets(session: CdpSession): Promise<Array<{webSocketDebuggerUrl: string}>> {
  // 调用 http://127.0.0.1:{port}/json/list
  // 过滤 RENDERER_URL_HINT
}

// 修改 injectThemeViaEngine：对每个 target 执行注入
for (const target of allTargets) {
  const targetSession = await getSessionForTarget(target);
  await injectToSession(targetSession, options);
}
```

**影响**：支持 WorkBuddy 多窗口场景（如独立聊天窗口）。

#### 4.1.2 【P1】CSS 校验增强

**现状**：`theme-source-parser.ts` 校验 schema，不扫描 CSS 内容。

**竞品方案**：comeonzhj 检查 `@import`、URL 引用、作用域选择器。

**建议**：在 `validateThemeManifest` 中新增：
```typescript
function validateCssSecurity(css: string, themeId: string): string[] {
  const errors: string[] = [];
  if (/@import\b/i.test(css)) errors.push("CSS 禁止使用 @import");
  if (/url\(\s*["']?https?:/i.test(css)) errors.push("CSS 禁止引用远程 URL");
  if (!css.includes(`:root[data-agentskin-theme="${themeId}"]`)) {
    errors.push("CSS 缺少主题作用域选择器");
  }
  return errors;
}
```

#### 4.1.3 【P1】Object URL 生命周期管理

**现状**：hero-inject 创建 Blob URL，但未显式 revoke。

**竞品方案**：zhouwei713 在 cleanup 时遍历 `previous.artUrls` 逐一 revoke。

**建议**：
```typescript
// 在 adapter.mjs 或 engine-strategy 中
const previousBlobUrl = await session.evaluate(
  `getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art')`
);
if (previousBlobUrl.startsWith('url("blob:')) {
  await session.evaluate(`URL.revokeObjectURL(${previousBlobUrl.replace(/^url\("blob:/, '').replace(/"\)$/, '')})`);
}
```

#### 4.1.4 【P2】color-mix 派生策略

**现状**：AgentSkin 的 CSS 由 theme 提供，硬编码颜色值。

**竞品方案**：cdredfox 和 zhouwei713 大量使用 `color-mix(in srgb, var(--x) 94%, transparent)` 派生中间色。

**建议**：在 `derive-missing-tokens.mjs` 中引入 color-mix 派生：
```typescript
// 从 14 token 自动派生半透明变体
function deriveOpacityVariants(tokens: ThemeTokens): Record<string, string> {
  return {
    'accent-16': `color-mix(in srgb, var(--agentskin-accent) 16%, transparent)`,
    'accent-30': `color-mix(in srgb, var(--agentskin-accent) 30%, transparent)`,
    'surface-88': `color-mix(in srgb, var(--agentskin-surface) 88%, transparent)`,
    // ...
  };
}
```

### 4.2 adapter.mjs 优化

#### 4.2.1 【P1】幂等渲染 + 状态外部化

**现状**：adapter 有 MutationObserver 自愈，但状态存储在闭包内。

**竞品方案**：zhouwei713 的 `window[STATE_KEY]` 模式，支持外部 cleanup。

**建议**：
```javascript
// adapter.mjs 中
const STATE_KEY = '__agentskin_adapter_state__';
const previous = window[STATE_KEY];
if (previous?.observer) previous.observer.disconnect();
if (previous?.timer) clearInterval(previous.timer);

// ... 初始化 ...

window[STATE_KEY] = {
  observer,
  timer,
  themeId,
  cleanup() {
    observer.disconnect();
    clearInterval(timer);
    // 移除注入的 DOM
  }
};
```

#### 4.2.2 【P2】防抖重渲染

**现状**：adapter 的 MutationObserver 回调直接执行。

**竞品方案**：zhouwei713 的 `scheduleEnsure()` 180ms 防抖。

**建议**：
```javascript
let debounceTimer = null;
const observer = new MutationObserver(() => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    ensure();
  }, 180);
});
```

### 4.3 HybridInjector 优化

#### 4.3.1 【P2】原子更新 + 回滚

**现状**：HybridInjector 的热替换无备份机制。

**竞品方案**：comeonzhj 的 `atomicInstall` 备份 + rename + 回滚。

**建议**：在 `dynamic-overrides` 层注入前，先读取当前 CSS 变量值作为 snapshot：
```typescript
async function injectWithRollback(session, layerName, newCss) {
  // 1. 读取当前值
  const snapshot = await session.evaluate(
    `getComputedStyle(document.documentElement).getPropertyValue('--agentskin-accent')`
  );
  
  // 2. 注入新值
  const ok = await injectCssLayer(session, layerName, newCss);
  
  // 3. 失败则回滚
  if (!ok) {
    await session.evaluate(`document.documentElement.style.setProperty('--agentskin-accent', '${snapshot}')`);
  }
}
```

### 4.4 DeepCore 优化

#### 4.4.1 【P2】Shadow DOM 持久化增强

**现状**：DeepCore 使用 Shadow DOM + 路由监听。

**竞品方案**：zhouwei713 的双重持久化（MutationObserver + setInterval）。

**建议**：在 DeepCore 中增加 `setInterval` 兜底：
```javascript
// 每 5 秒检查 Shadow DOM 是否仍然存在
const timer = setInterval(() => {
  if (!document.getElementById(SHADOW_HOST_ID)?.shadowRoot) {
    ensure();  // 重新创建
  }
}, 5000);
```

### 4.5 orchestrator.ts 优化

#### 4.5.1 【P1】Snapshot 实际捕获

**现状**：`initSnapshotManager` 的 capture 函数返回空状态（L117-121）。

**竞品方案**：无直接对应，但 comeonzhj 的 backup 模式可参考。

**建议**：
```typescript
private initSnapshotManager(): void {
  this.snapshotManager = new InjectionSnapshotManager(
    // Capture: 实际读取当前 CSS 变量
    async (agentId) => {
      const session = await getSessionForAgent(agentId);
      const cssVariables = await session.evaluate(`(() => {
        const styles = getComputedStyle(document.documentElement);
        return {
          '--agentskin-accent': styles.getPropertyValue('--agentskin-accent').trim(),
          '--agentskin-surface': styles.getPropertyValue('--agentskin-surface').trim(),
          // ... 其他关键变量
        };
      })()`);
      return { cssVariables, appliedStylesheets: {}, agentId };
    },
    // Restore: 恢复 CSS 变量
    async (snapshot) => {
      const session = await getSessionForAgent(snapshot.agentId);
      for (const [name, value] of Object.entries(snapshot.cssVariables)) {
        await session.evaluate(`document.documentElement.style.setProperty('${name}', '${value}')`);
      }
      return true;
    },
  );
}
```

#### 4.5.2 【P2】注入后健康检查

**现状**：orchestrator 的 `verifyInjection` 仅做 contract 验证。

**竞品方案**：zhouwei713 的 `setInterval(5s)` 持续监测。

**建议**：在 `execute` 成功后启动 watchdog：
```typescript
async execute(params) {
  const result = await this.queues.enqueue(agentId, () => this.doExecute(params), priority);
  
  if (result.success) {
    // 启动健康检查：3s 后验证注入是否存活
    setTimeout(() => this.healthCheck(params.agentId), 3000);
  }
  
  return result;
}

private async healthCheck(agentId: AgentId) {
  const session = await getSessionForAgent(agentId);
  const installed = await session.evaluate(
    `Boolean(document.getElementById('__agentskin_adapter_state__'))`
  );
  if (!installed) {
    // 注入丢失，触发重新注入
    this.events.emit('injection:lost', { agentId });
  }
}
```

#### 4.5.3 【P2】Layer 依赖验证

**现状**：orchestrator 检查 layer 所有权，但不检查 layer 间依赖。

**竞品方案**：cdredfox 的 CSS 分层有隐含顺序（base → conversation → ...）。

**建议**：在 `validateMatrix` 中新增依赖检查：
```typescript
const LAYER_DEPENDENCIES: Record<LayerName, LayerName[]> = {
  'tokens': ['palette'],      // tokens 依赖 palette 的变量定义
  'cosmetic': ['tokens'],     // cosmetic 依赖 tokens 的覆盖
  'theme': ['cosmetic'],      // theme 依赖 cosmetic 的基础样式
  'custom': ['theme'],        // custom 是最终覆盖
};

validateDependencies(): string[] {
  const errors: string[] = [];
  for (const [layer, deps] of Object.entries(LAYER_DEPENDENCIES)) {
    for (const dep of deps) {
      if (!this.layerOwnership.has(dep)) {
        errors.push(`Layer '${layer}' depends on '${dep}' which is not registered`);
      }
    }
  }
  return errors;
}
```

---

## 五、优先级矩阵

| 优先级 | 优化项 | 影响范围 | 工作量 | 预期收益 |
|--------|--------|---------|--------|---------|
| P0 | 多 renderer target 支持 | engine-strategy | 2d | 多窗口场景覆盖 |
| P1 | CSS 安全校验增强 | theme-source-parser | 0.5d | 防止恶意主题 |
| P1 | Object URL revoke | hero-inject | 0.5d | 内存泄漏修复 |
| P1 | Snapshot 实际捕获 | orchestrator | 1d | 真正的事务回滚 |
| P1 | 幂等渲染 + 状态外部化 | adapter | 1d | 可调试性 + 可靠清理 |
| P1 | 注入后健康检查 | orchestrator | 1d | 自愈能力增强 |
| P2 | color-mix 派生 | derive-missing-tokens | 1d | 配色质量提升 |
| P2 | 防抖重渲染 | adapter | 0.5d | 性能优化 |
| P2 | 原子更新 + 回滚 | HybridInjector | 1d | 热替换可靠性 |
| P2 | Shadow DOM 持久化 | DeepCore | 0.5d | 路由切换稳定性 |
| P2 | Layer 依赖验证 | orchestrator | 0.5d | 分层架构健壮性 |

---

## 六、架构决策记录

### 6.1 不采纳的竞品设计

| 竞品设计 | 不采纳原因 |
|---------|-----------|
| 单 CSS 字符串 + `!important` 全覆盖 | AgentSkin 的 5 层架构更精细，支持独立生命周期 |
| 调色板驱动（固定 CSS + 换色板） | AgentSkin 的 14-token 契约更严谨，WCAG 可验证 |
| 页面内 IIFE 菜单 | AgentSkin 的 React Studio 更工程化 |
| 远程主题同步 | 违反 AGENTS.md §7 第 3 条 |

### 6.2 采纳的竞品模式

| 模式 | 来源 | 采纳方式 |
|------|------|---------|
| 多 target 遍历 | cdredfox | engine-strategy 新增 getAllRendererTargets |
| CSS 安全扫描 | comeonzhj | theme-source-parser 新增 validateCssSecurity |
| Object URL revoke | zhouwei713 | hero-inject 新增 cleanupPreviousBlob |
| 幂等渲染 + 状态外部化 | zhouwei713 | adapter 改用 window[STATE_KEY] |
| 防抖重渲染 | zhouwei713 | adapter MutationObserver 加 180ms 防抖 |
| 原子安装 + 回滚 | comeonzhj | theme-store 目录级安装加 backup |
| Snapshot 实际捕获 | 自建 | orchestrator capture 读取真实 CSS 变量 |
| 注入后健康检查 | 自建 | orchestrator execute 后启动 watchdog |

---

## 七、验证计划

### 7.1 单元测试

- `validateCssSecurity` — 5 测试（@import/远程 URL/作用域缺失/合法/空输入）
- `getAllRendererTargets` — 3 测试（单 target/多 target/无 target）
- `atomicInstall` 回滚 — 3 测试（成功/失败回滚/备份清理）
- `injectWithRollback` — 3 测试（成功/失败回滚/异常）

### 7.2 集成测试

- 多窗口注入 — 启动 2 个 WorkBuddy 窗口，验证两个都注入成功
- 主题安装回滚 — 模拟写入失败，验证备份恢复
- 健康检查 — 手动移除注入 DOM，验证 3s 后自动恢复

### 7.3 性能基线

- 注入耗时基线（当前 engine-strategy 均值 ± 标准差）
- 内存泄漏检测（Blob URL 创建/释放平衡）
- 重渲染频率（防抖前后的 evaluate 调用次数）

---

## 八、附录：竞品源码结构对照

### 8.1 cdredfox 模块依赖

```
cli.mjs → injector.mjs → cdp-client.mjs
                       → skin-css.mjs
                       → skin-menu.mjs
                       → theme-schema.mjs
                       → theme-store.mjs
                       → constants.mjs
```

### 8.2 AgentSkin 模块依赖

```
orchestrator.ts → injection-lock.ts
                → injection-queue.ts
                → injection-snapshot.ts
                → contract-validator.ts
                → types.ts

engine-strategy.ts → css-inject.ts
                   → hero-inject.ts
                   → cdp-session.ts
                   → landmark-preflight.ts
                   → shared.ts
                   → types.ts
```

### 8.3 关键差异总结

| 维度 | 竞品 | AgentSkin |
|------|------|-----------|
| CDP 连接 | 每 target 新 session | 单 session 复用 |
| CSS 层 | 1 层 + `!important` | 5 层 adoptedStyleSheets |
| 持久化 | IIFE 内状态 + 观察者 | Page.addScriptToEvaluateOnNewDocument |
| 并发控制 | 无 | per-agent Lock + Queue |
| 事务回滚 | 无 | SnapshotManager（待完善） |
| 安全校验 | CSS 内容扫描 | Schema 校验 |
| 健康检查 | setInterval(5s) | 无 |
