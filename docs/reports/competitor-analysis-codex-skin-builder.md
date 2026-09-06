# 竞品分析报告：kongxcer555/codex-skin-builder

> 生成日期：2026-08-20  
> 分析范围：项目概览 / 技术亮点 / 可借鉴模式 / 实施建议

---

## 1. 项目概览

| 指标 | 数值 |
|------|------|
| 仓库 | `kongxcer555/codex-skin-builder` |
| 定位 | 给 Codex 桌面版构建可安装动态皮肤的 **Skill** |
| 平台 | macOS 仅限（Bundle ID `com.openai.codex`） |
| License | MIT |
| Stars | 20 |
| Forks | 3 |
| Open Issues | 1 |
| 主要语言 | JavaScript (Node.js + 浏览器内注入) |
| 仓库体积 | 7,265 KB |
| 创建时间 | 2026-07-16 |
| 最后更新 | 2026-08-10 |
| Commits | 4（全部在 2026-07-16 当天） |
| Releases | 无正式 Release |
| 活跃作者 | `liudd1` / `workliu111`（同一人双账号） |

**活跃度判断**：项目仍处 MVP 验证期，4 个 commit 集中在创建当日，此后仅有 README 维护更新。不同于 AgentSkin 长期演进的四引擎架构，这是单次发布 + 轻度维护模式。Star 数 20 但零 Release，说明更多是 skill 模板而非成熟产品。

---

## 2. 技术实现分析

### 2.1 整体架构

```
start-salary-cat-skin.sh (Launcher)
  │
  ├─ open -na Codex.app --args --remote-debugging-port=9335
  │
  └─ injector.mjs --watch --port 9335   (CDP 客户端，主进程)
       │
       ├─ fetch http://127.0.0.1:9335/json/list  → 发现 app:// targets
       │
       └─ WebSocket 连接 → Runtime.evaluate(renderer-inject.js)
            │
            └─ 页面内：注入 <style> + 装饰 DOM + MutationObserver
```

**关键决策**：单进程 CDP 客户端直连，不走 Electron 壳。无 React/UI 框架，纯 Node.js + Shell 脚本。

### 2.2 CDP 注入方式

| 层面 | 实现 | 说明 |
|------|------|------|
| 连接层 | 自研 `websocket-client.mjs` | 零安装 WebSocket，兼容 Node.js 18 |
| 注入层 | `Runtime.evaluate` 一次性 payload | 非 `addScriptToEvaluateOnNewDocument` |
| 持久化层 | `Page.loadEventFired` 事件 + 低频率轮询 | 900ms 心跳重新发现 targets |
| 幂等性 | `window.__CODEX_SALARY_CAT_SKIN_STATE__` | 全局状态 + cleanup 回调 |
| 清理 | DOM 移除 + CSS 变量移除 + class 移除 + watcher 停止 | 5 步原子清理 |

**并发控制设计**：
- 锁目录 (`$STATE_ROOT/start.lock`) 防止双启动
- 端口占用预检（发现已有 CDP targets 则跳过重启）
- 先停 Dream Skin daemon 再注入，避免多皮肤叠加

### 2.3 主题格式（skin.json）

```json
{
  "schemaVersion": 1,
  "id": "codex-monthly-salary-cat-skin",
  "name": "Codex 月薪喵",
  "version": "1.0.0",
  "author": "Codex",
  "description": "...",
  "platforms": ["macos"],
  "preview": "assets/salary-cat-source.png",
  "animatedHero": "assets/salary-cat-hero.gif",
  "scripts": {
    "install": "scripts/install-...sh",
    "activate": "scripts/start-...sh",
    "deactivate": "scripts/restore-...sh",
    "verify": "scripts/verify-...sh"
  },
  "requirements": {
    "node": ">=18",
    "codexBundleId": "com.openai.codex",
    "defaultPort": 9335
  }
}
```

**对比 AgentSkin**：AgentSkin 使用 14-token + schemaVersion 2 + palette.css + hero/preview/icon 多图体系；Codex Skin Builder 结构极简，schemaVersion 1，无 token 体系（颜色直接硬编码在 CSS 中）。

### 2.4 配色系统（"五角色采样法"）

竞品提出从原画中采样 5 种角色色：

1. ink/text（墨/文本）
2. main surface（主表面）
3. sidebar surface（侧边栏）
4. accent/border（强调/边框）
5. semantic success/error/skill（语义色）

参考实现实际使用 **7 个 CSS 自定义属性**：
```
--salary-cat-ink / --salary-cat-cocoa / --salary-cat-apricot
--salary-cat-gold / --salary-cat-cream / --salary-cat-sage / --salary-cat-line
```

AgentSkin 的 14-token 体系更严谨（强制合规），竞品的 5 角色采样法更灵活但依赖美术素养。

### 2.5 动画与可访问性

| 方案 | 实现 |
|------|------|
| 主视觉 | 12 帧循环 GIF（1264x553），blob URL 注入 |
| 降级 | `@media (prefers-reduced-motion: reduce)` → 静态 PNG |
| 粒子动效 | CSS keyframes animation（硬币飘落、爪子摇摆、拍立得浮动） |
| 兼容性 | GIF 转 data URL base64 嵌入 payload，单 payload 自包含 |

### 2.6 配置恢复机制（theme-config.mjs）

竞品独立管理 Codex 的 `~/.codex/config.toml`：

```javascript
const keys = [
  "appearanceTheme",
  "appearanceLightCodeThemeId", 
  "appearanceLightChromeTheme"
];
```

恢复策略为**精确所有权模型**：
- 备份 `config.before-salary-cat-skin.toml`
- 恢复时：存在的 key 还原值，不存在的 key 完全移除
- 保留安装后用户新增的无关 key
- 仅在备份中也无 `[desktop]` 段时才移除空段

这是 AgentSkin 目前不具备的细粒度"非侵入式配置管理"能力。

---

## 3. 亮点提取

### 3.1 Skill 范式 — 完整的 install/activate/verify/restore 生命周期

| 阶段 | 竞品实现 | AgentSkin 现状 |
|------|---------|---------------|
| 安装 | 复制到 `~/.codex/skills/<slug>/` + 创建桌面 .app 启动器 | 主题目录直接是包 |
| 启动 | Shell 启动器 → open Codex with CDP args | Electron 主进程内直接注入 |
| 验证 | `--verify` 模式探测 DOM 元素边界 + 截图保存 | 无独立 verify 脚本 |
| 恢复 | `--remove` + `--uninstall` + `--restore-base-theme` 三档 | 关闭注入即恢复 |
| 隔离测试 | 支持临时 HOME 目录 + 桌面目录 | 无隔离测试模式 |

### 3.2 视觉工作流文档（visual-workflow.md）

竞品将"从图片到皮肤"的流程文档化为可执行规范：
- **角色锁（Character Lock）**：防止 AI 生成时角色走形，记录 silhouette/face/markings/outline 的强制约束
- **Prompt 模板**：16:7 宽高比 + 左侧留白 + 无文字 Logo
- **GIF 设计约束**：10-16 帧、90-140ms/帧、≤2% 相机运动、≤3 个独立动效层

### 3.3 脚手架系统（scaffold_skin.py）

Python 脚手架一次性完成：
1. 复制参考实现
2. 全文替换标识符（slug / PascalCase / UPPER / lower 四种变体）
3. 重命名文件
4. 写入元数据（skin.json / SKILL.md / openai.yaml / README / runtime-notes / qa-inventory）
5. 复制素材

确保每个生成包**完全独立**，避免标识符冲突。

### 3.4 QA 体系（qa.md）

分层验证清单：
1. **静态检查**：Shell/JS 语法 + JSON 合法性 + 无泄露的绝对路径
2. **媒体检查**：PNG 尺寸、GIF 帧数/循环、主体裁剪、降级模式
3. **隔离安装恢复**：临时 HOME 创建 → 安装 → 加新 key → 恢复 → 验证
4. **活体验证**：DOM 探测 + 截图可视化审查（强调"boolean 通过 ≠ 视觉通过"）
5. **发布检查**：ZIP 结构 + SHA-256 + 漏做检查的显式声明

### 3.5 脆弱点自我认知文档（runtime-architecture.md §Fragile Points）

竞品主动列出自己实现的脆弱点：
- Bundle ID 信任优先于文件名
- Node.js 18 WebSocket 兼容性
- 多兆字节 GIF 的 data URL 处理
- DOM 类名随时可能随 Codex 升级而改变
- 防多皮肤叠加
- 装饰层 `pointer-events: none`

---

## 4. 可借鉴点对比表

| # | 借鉴点 | 竞品实现 | AgentSkin 现状 | 可行性 | 优先级 | 备注 |
|---|--------|---------|---------------|--------|--------|-------|
| 1 | **TOML 配置精确恢复** | `theme-config.mjs` 50 行实现备份/还原/所有权管理 | 无 | 高 | **P0** | AgentSkin 的 codex 适配器可参考此模式管理 `~/.codex/config.toml` |
| 2 | **isolate 隔离测试** | 临时 HOME + 桌面目录往返测试 | 无 | 高 | **P0** | 可显著提升 codex 适配器质量保障 |
| 3 | **视觉 QA 截图审查** | verify 强制截图 + 人工视觉检查 | 仅有 DOM 探测逻辑 | 高 | **P1** | 与 AgentSkin 的 DeepCore 结合 |
| 4 | **角色锁文档化** | Character Lock 规范防 AI 走形 | 工作流中有类似实践但未文档化 | 高 | **P1** | 可规范化为 theme-creator.md 的强制章节 |
| 5 | **per-skin state dir + 锁** |~/Library/Application Support/Codex<Slug>Skin + .lock | 单 state 目录 | 中 | **P2** | 多主题并行切换时需要 |
| 6 | **骨架脚手架** | scaffold_skin.py 一次生成独立包 | 仅手工复制 + 改名 | 中 | **P2** | 可作为 Studio 导出功能的参考 |
| 7 | **prefers-reduced-motion** | GIF→PNG 自动降级 | 未实现 | 高 | **P1** | 可访问性要求 |
| 8 | **端口冲突预检** | 启动前发现占用即退出或切换 | Electron 主进程端口固定 | 低 | **P3** | Electron 场景不直接适用 |
| 9 | **5 角色采样法** | 从原画采样 ink/surface/sidebar/accent/semantic 五色 | 14-token 强制 | 中 | **P3** | 可作为 Theme Creator UI 的"快速采样"模式 |
| 10 | **Bundle ID 信任** | 通过 `com.openai.codex` 定位，不依赖文件名 | 不适用 | 低 | **N/A** | macOS 限定，AgentSkin 跨平台不适用 |

---

## 5. 实施建议

### 5.1 立即可做（无需 RFC）

| 动作 | 影响范围 | 预估工时 |
|------|---------|---------|
| 为 codex 适配器实现 `--verify --screenshot` 模式 | engines/ + 适配器 | 1-2 天 |
| 引入 `@media (prefers-reduced-motion: reduce)` 全局适配 | engine-strategy | 0.5 天 |
| 新增 theme-config 精确恢复能力（对标 `theme-config.mjs`） | codex 适配器 + 文档 | 1 天 |
| 在 QA 清单中增加"截图视觉审查"强制步骤 | check-themes 或新脚本 | 0.5 天 |

### 5.2 中期规划（需设计对齐）

| 动作 | 影响范围 | 说明 |
|------|---------|------|
| 引入"角色锁"文档规范 | docs/ + Studio 工作流 | 防止 AI 生成主题时 IP 走形 |
| 实现隔离安装/恢复测试模式 | engines/ + 测试 | 临时 HOME + 桌面往返 |
| 新增"骨架代码生成"工具 | scripts/ + Studio | 对标 scaffold_skin.py 的自动化程度 |

### 5.3 不建议借鉴

| 项 | 原因 |
|----|------|
| shell 脚本驱动的启动/恢复 | AgentSkin 是 Electron 壳内主进程，不需要通过 Shell 启动外部应用 |
| TOML 手写解析器 | AgentSkin codex 适配器场景下，可直接用 `@iarna/toml` 或 `smol-toml` |
| 单端口 watch 注入模式 | AgentSkin 四引擎编排层已有 InjectionLock + InjectionQueue，竞品的锁机制是冗余的 |
| 五角色自由采样替代 14-token | AgentSkin 的 14-token 是契约核心（C2 不变量），不可削弱；但可补充为"快速采样向导" |

---

## 6. 重大更新标记

| 日期 | 事件 | 影响 |
|------|------|------|
| 2026-07-16 | 仓库创建，4 commit 全部当天 | — |
| 2026-08-10 | 最后一次 `pushed_at` | 仅有 README 维护 |
| — | 无 Release、无 Tag、无 Branch | 仍为 MVP 阶段 |

**结论**：竞品处于"可工作但未成熟"状态，核心价值在于**流程文档化**（QA/视觉工作流/脆弱点自识）而非技术实现本身。其技术实现简单直接（直连 CDP + 自包含 payload），没有 AgentSkin 的分层注入复杂度，也不具备多应用适配能力。

---

## 7. 总结

`codex-skin-builder` 是一个 20 star、单作者、单次发布的 Codex 皮肤构建 Skill，技术实现约 300 行 JS + 200 行 Python 脚手架，核心技术方案为 **自研 WebSocket CDP 客户端 + Runtime.evaluate 注入 + 全局 state 幂等清理**。

**对 AgentSkin 的核心价值不在代码，在方法论**：

1. **"可验证"作为一等公民** — QA 清单层次分明，静态/隔离/活体/发布各有独立步骤
2. **配置精确恢复的所有权模型** — 只改自己创建的键、保留用户后续键、空段条件清理
3. **视觉工作流的角色锁** — 防止 AI 生成内容偏离原始 IP 的可执行规范
4. **对脆弱点的显式记录** — 主动列出实现假设和可能失效的边界

上述四点与 AgentSkin 的 C1-C11 不变量验证体系高度互补。建议将第 1、2 项落地到 codex 适配器增强，第 3、4 项沉淀为 Theme Creator 和适配器维护文档的标准章节。
