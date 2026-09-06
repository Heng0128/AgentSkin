# 第 18 轮竞品深度分析报告

> 执行时间：2026-08-29 12:00
> 分析项目：5 个（workbuddy-skin-studio / dream-work-theme / aios / dsh-suite / codex-skin-manager）

---

## 一、本轮分析项目概览

| 项目 | Stars | 活跃度 | 与 AgentSkin 关系 | 核心价值 |
|------|-------|--------|-------------------|----------|
| cdredfox/workbuddy-skin-studio | 169⭐ | 稳定 | WorkBuddy 适配目标 | 图片即主题 UX + SKILL.md + 零等待切换菜单 |
| xxxhh336/dream-work-theme | 8⭐ | 极高（日更） | WorkBuddy + TRAE Work | 跨平台端口探测 + Relaxed fallback |
| MagMueller/aios | 0⭐ | 停滞 | 非目标（学习思想） | CSP 双重绕过 + 多事件延迟补偿 |
| whyihaveyou/dsh-suite | 49⭐ | 极高（自动化） | 非目标（学习思想） | 单一事实源 + CI 兼容性验证 |
| ZhjGo/codex-skin-manager | 25⭐ | 停滞 | Codex 适配目标 | 安全扫描 + verify 模式 + watch 重注入 |

---

## 二、各项目核心发现

### 2.1 cdredfox/workbuddy-skin-studio（169⭐）

**技术定位**：纯 JavaScript 零依赖 WorkBuddy 换肤工具，2 天开发完成。

**架构**：
- CDP 注入：自实现 WebSocket 客户端（15KB），`--remote-debugging-port=9223` 重启注入
- 主题格式：`theme.json`（仅 `--cb-*` 变量）+ `hero.webp`（单图）
- 状态管理：纯文件级，无 Store 抽象

**三大 UX 亮点**：
1. **一张图片 = 一个主题**：`create --image` 自动取色生成皮肤
2. **右上角常驻 🎨 菜单**：已装主题即点即换，CSS 变量热替换不重新走 CDP
3. **SKILL.md AI 安装引导**：任意 AI 助手读 URL 即可完成安装

**与 AgentSkin 差距**：
- 注入架构：单文件 direct inject vs 四引擎 + orchestrator
- 主题契约：无结构 `--cb-*` 覆盖 vs 14-token 结构化契约
- 持久性：重启丢失 vs Session 持久 + 自动恢复

### 2.2 xxxhh336/dream-work-theme（8⭐）

**技术定位**：跨平台 Electron Work 应用主题切换器，适配 20+ 应用（违反铁律，仅学习）。

**架构**：
- 端口分配：每个应用预分配固定端口（9339-9357），TCP bind 检测冲突
- Target 匹配：`rendererHints` URL 子串匹配，失败退化为任意 page target
- 持久化脚本：对会重建 renderer 的应用使用 `addScriptToEvaluateOnNewDocument`

**高价值借鉴**：
1. **TCP 端口探测 + 自动回退**：比 AgentSkin 硬编码端口更灵活
2. **Relaxed Fallback 策略**：hint 失败时退化为任意 page target，解决应用更新后路径变化问题
3. **注入后 DOM 检测 + 重试**：WorkBuddy 等待 `data-applicationName`，Codex 检测 class 添加

**反模式警示**：240KB 单文件 `injector.ts` 是大泥球反模式，AgentSkin 应坚持四引擎分层。

### 2.3 MagMueller/aios（0⭐）

**技术定位**：任意 macOS Electron 应用实时修改套件（侵入式，需改 asar）。

**架构**：
- 安装：解包 `app.asar` → 主进程入口插入 `require("./aios-agent")` → 重打包 → ad-hoc 重签名
- 三条轨道：配置文件热重载（1 秒轮询）、CDP 端点、主进程 Agent

**可借鉴模式**：
1. **CSP 双重绕过**：`executeJavaScript` + `webRequest.onHeadersReceived` 剥离 CSP 头
2. **幂等注入**：先清理旧节点再注入，防止重复叠加
3. **多事件 + 延迟补偿**：`dom-ready` / `did-finish-load` / `did-navigate-in-page` + 500/1500/3000ms 延迟

**路线差异**：aios 是侵入式（改目标应用），AgentSkin 是非侵入式（独立宿主）。根本路线不同。

### 2.4 whyihaveyou/dsh-suite（49⭐）

**技术定位**：DSH 插件活目录，每小时刷新、每日兼容实测。

**架构**：
- 单一事实源：`data/plugins.json` → `npm run gen:readme` → 自动生成目录
- 三层自动化：hourly refresh / daily snapshot / daily compat
- 兼容性标记：`ok / broken / unknown` 三枚举，未测就说 unknown

**高价值借鉴**：
1. **catalog.json 单一事实源**：杜绝手工漂移
2. **CI 自动兼容性验证**：每日真实安装测试，标记诚实
3. **自动生成目录页**：数据驱动，永不手改表格

### 2.5 ZhjGo/codex-skin-manager（25⭐）

**技术定位**：跨平台 Codex 主题管理器，零残留清理机制。

**架构**：
- CDP 注入：自实现 WebSocket 客户端，零外部依赖
- 注入模式：`--once` / `--watch` / `--verify` / `--remove`
- 集中式清理：`PURGE` 常量白名单，全量扫描清理

**高价值借鉴**：
1. **皮肤导入安全扫描**：静态检测 `fetch` / `eval` / `localStorage` 等危险模式
2. **verify 模式**：检查 rootClass 存在、style 标签渲染、chrome 覆盖层 pointerEvents
3. **watch 模式双保险**：轮询发现 target + 事件驱动重注入

---

## 三、优先级矩阵与实施建议

### P0（立即可做，高价值 + 高可行性）

| 项目 | 借鉴点 | 当前状态 | 移植方案 |
|------|--------|----------|----------|
| codex-skin-manager | 皮肤导入安全扫描 | 完全缺失 | 在 `theme-source-parser.ts` 增加 CSS/JS 危险模式扫描 |
| dsh-suite | catalog.json 单一事实源 | 主题管理分散 | 建立 `themes/catalog.json`，主题列表页从此生成 |
| dsh-suite | CI 自动兼容性验证 | 人工验证不可持续 | 每日把主题真实注入各适配器，CDP 探测验证变量生效 |

### P1（本季度，中等价值或需适配）

| 项目 | 借鉴点 | 当前状态 | 移植方案 |
|------|--------|----------|----------|
| workbuddy-skin-studio | 图片→主题自动构图 | 手动编辑 palette.css | custom 主题 creator 集成"上传图片→自动构图→14-token palette" |
| workbuddy-skin-studio | SKILL.md AI 安装引导 | 缺失对外触达 | 编写对外 SKILL.md，让社区 AI 助手安装 AgentSkin |
| dream-work-theme | TCP 端口探测 + 回退 | 硬编码端口 | 适配器端口管理增加"探测 + 回退"逻辑 |
| dream-work-theme | Relaxed fallback 匹配 | hint 失败即失败 | adapter 层增加 fallback 兜底 |

### P2（未来 RFC 或低优先级）

| 项目 | 借鉴点 | 当前状态 | 移植方案 |
|------|--------|----------|----------|
| aios | CSP 双重绕过 | adoptedStyleSheets 不受 CSP 影响 | DeepCore 的 JS 注入场景可作为备选 |
| aios | 多事件延迟补偿 | 已有类似能力 | 参考优化 adapter 对异步渲染框架的适配 |
| workbuddy-skin-studio | 右上角常驻菜单 | 设置页切换 | WorkBuddy 适配器内小范围试验（需 RFC） |

### 明确禁止移植

| 项目 | 禁止内容 | 原因 |
|------|----------|------|
| dream-work-theme | 适配列表扩展逻辑 | 违反铁律 #1：6 适配器上限 |
| dream-work-theme | 240KB 单文件 CSS 硬编码 | 违反铁律 #4：注入架构需 RFC |
| aios | asar 解包/重打包机制 | AgentSkin 不改目标应用 |
| aios | 新增 Slack/Discord/Notion 适配器 | 违反铁律 #1 |
| codex-skin-manager | 壁纸设计器 | 违反黄金规则 #2：禁止 Studio 新增创作类 |

---

## 四、执行计划

### Wave 1：P0 三项并行实施

1. **皮肤导入安全扫描** — 新增 `src/shared/import/security-scanner.ts`
2. **themes/catalog.json 单一事实源** — 建立 catalog + 自动生成脚本
3. **CI 自动兼容性验证** — 新增 `scripts/verify-adapter-compat.mjs`

### Wave 2：P1 四项串行实施

1. **图片→主题自动构图** — 集成到 custom 主题 creator
2. **SKILL.md 对外发布** — 编写 AI 安装引导
3. **TCP 端口探测增强** — 优化适配器端口管理
4. **Relaxed fallback 匹配** — 增强注入鲁棒性

---

## 五、测试与验证

每个实施项必须：
1. 新增单元测试（覆盖率 > 80%）
2. 全量测试通过（`npm test`）
3. tsc 无新增错误
4. `npm run check` 全绿

---

## 六、下一步建议

- Wave 1 完成后评估 Wave 2 优先级
- 追踪 dream-work-theme 的跨平台适配策略（关注其端口管理机制演进）
- 关注 dsh-suite 的自动化 CI 模式（可借鉴到 AgentSkin 的 check 体系）
- 考虑将 SKILL.md 作为社区推广的切入点

---

**报告生成时间**：2026-08-29 12:00
**分析子智能体**：5 个并行执行
