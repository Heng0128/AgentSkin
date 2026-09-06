# 竞品深度分析报告 · 第 12 轮 (2026-08-29)

> 本轮聚焦 4 个此前未深入分析的高价值项目：CodeDrobe/core（统一换肤引擎）、Lumos-789/zcode-cdp（CDP 治理）、comeonzhj/WorkBuddy-theme-skill（主题管理器）、cdredfox/workbuddy-skin-studio（图片驱动换肤）。

---

## 一、CodeDrobe/core — 统一换肤运行时引擎

### 1.1 基本信息

| 维度 | 详情 |
|------|------|
| 仓库 | CodeDrobe/core |
| 许可证 | Apache-2.0 |
| Stars / Forks | 9 / 2 |
| 贡献者 | 2 人（anhao 主导） |
| 创建时间 | 2026-07-16 |
| 最后推送 | 2026-07-21 |
| 当前版本 | v0.7.0-beta.0 |
| 语言 | JavaScript (Node.js ≥ 22.4) |

### 1.2 架构亮点

**适配器系统**：`AppAdapter` 接口设计极为完整，包含 `matchTarget()` 方法让适配器自行判断 CDP target 归属、`verification` DOM landmarks、`rendererProfiles` 渲染器配置、`hostSettings` 宿主设置。已支持 codex / workbuddy / qoderwork / traework 四个适配器。

**per-window 语义**：v0.7.0-beta.0 引入 per-window probe/verify——主窗口和弹出窗口分开判断，次级窗口缺少主窗口 DOM 时标记为 "skipped"，只有零个合格窗口时才失败。

**DevToolsActivePort 发现**：解决 `remote-debugging-port=0` 场景下调试端口不固定的问题，通过读取 Chromium 的 DevToolsActivePort 文件发现实际端口。

**选择器脆弱性检查**：`lintThemePackage()` 在打包和检查时对 CSS 选择器做脆弱性分析。

### 1.3 与 AgentSkin 对比

| 维度 | CodeDrobe | AgentSkin |
|------|-----------|-----------|
| 契约机制 | CSS 选择器匹配（DOM landmarks） | 14 CSS 变量（--agentskin-*） |
| 注入方式 | Runtime.evaluate | adoptedStyleSheets |
| 分层架构 | 单层 CSS 注入 | 四层（strategy/adapter/hybrid/deep-core） |
| Shadow DOM | 仅记录数量，无注入能力 | DeepCore 完整支持 |
| 验证层级 | required / recommended / contextual | palette + tokens + cosmetic + theme + custom |

### 1.4 可借鉴点

1. **`matchTarget()` 自匹配模式**：让适配器自行判断 target 归属，比固定 target 匹配更灵活。当 AgentSkin 需要处理同一应用的多个变体（如 Codex 的 avatar-overlay 路由）时可参考。
2. **per-window 语义**：次级窗口标记为 skipped 的健壮性模式，对 traework、qoderwork 等多窗口复杂应用有参考价值。
3. **DevToolsActivePort 发现**：对 `remote-debugging-port=0` 的应用，比固定端口扫描更可靠。
4. **选择器脆弱性检查**：可借鉴其分析逻辑，增强对主题 CSS 的质量把控。

### 1.5 风险

- 单人驱动（18/19 commits from anhao），bus factor = 1
- 极早期（创建仅 3 周），API 未稳定
- CSS 选择器驱动契约，应用更新可能导致主题失效

---

## 二、Lumos-789/zcode-cdp — 生产级 CDP 治理框架

### 2.1 基本信息

| 维度 | 详情 |
|------|------|
| 仓库 | Lumos-789/zcode-cdp |
| 许可证 | MIT |
| Stars / Forks | 1 / 0 |
| 贡献者 | 1 人（Lumos-789） |
| 创建时间 | 2026-08-01 |
| 最后推送 | 2026-08-15 |
| 当前版本 | v0.2.0 |
| 语言 | JavaScript (Node.js ≥ 18) |

### 2.2 架构亮点

**端口租约机制**：利用 `mkdir` 的系统级原子性来抢锁，每次获取租约时生成随机 `leaseId`，所有释放/更新操作必须先校验 `leaseId`，防止 PID 复用导致的误释放。双池分离：会话池（9223-9229）由租约管理自动分配/释放；固定池（93xx）只判"端口忙"。

**三层看门狗**：
- 软看门狗：事件循环延迟 > 2000ms 连续 3 次 → 告警
- CPU 看门狗：主进程 CPU% > 85%，滑动窗口超标 → 准备 kill
- 硬看门狗：独立 worker 线程 60s 无心跳 → SIGKILL 主进程

**状态机治理**：`IDLE → ENSURING → ACTIVE → CLOSING` 四态核心循环 + `SHUTTING_DOWN / EXITED` 退出态。relay（本地 TCP 中继）使 backend endpoint 永远有效。

**挂起语义替代缓冲**：ensure 期间 backend 发起的连接在中继被挂起（默认 30s 超时），Chrome 就绪后自然流动，零应用层缓冲代码。

### 2.3 与 AgentSkin 编排层对比

| 维度 | AgentSkin 编排层 | zcode-cdp |
|------|-----------------|-----------|
| 并发控制 | InjectionLock: per-agent mutex + priority | 文件系统 mkdir 原子锁 + leaseId |
| 任务队列 | InjectionQueue: per-agent 优先级排序 | 无显式队列，relay 挂起语义替代 |
| 状态机 | 10 态（含 DEGRADED/SELF_HEALING/FAILED/ROLLING_BACK） | 4+2 态（聚焦 Chrome 生命周期） |
| 自愈能力 | DEGRADED → SELF_HEALING（显式自愈态） | 无自愈，失败即回 IDLE |
| 回滚机制 | CSS 快照回滚 | 不自动重放 |

### 2.4 可借鉴的设计哲学

1. **所有权令牌（leaseId）比简单 owner 字符串更安全**——所有涉及"获取-使用-释放"的资源操作都应考虑所有权校验。
2. **挂起语义优于显式缓冲**——利用基础设施的中继/队列特性而非手写请求缓冲代码。
3. **看门狗的层级化思想**——从"事件循环延迟"到"CPU busy"到"完全卡死"逐级升级。
4. **测试分层（L0/L1/L2）**——零真实 Chrome 副作用的 stub 策略。

### 2.5 适用性结论

直接移植价值有限——AgentSkin 的编排层已经成熟，其设计维度（多引擎协调、CSS 分层注入、持续健康监测、自愈回滚）远超 zcode-cdp 关注的"Chrome 进程生命周期"范畴。但设计哲学可作为 orchestrator 层的**增量强化参考**。

---

## 三、comeonzhj/WorkBuddy-theme-skill — WorkBuddy 主题管理器

### 3.1 基本信息

| 维度 | 详情 |
|------|------|
| 仓库 | comeonzhj/WorkBuddy-theme-skill |
| 许可证 | MIT |
| Stars / Forks | 18 / 4 |
| 内置主题 | 9 套（王者风范、阿轲、安琪拉、孙悟空、小乔、瑶、负鼠等） |
| 创建时间 | 2026-07-18 |
| 最后推送 | 2026-07-18 |
| 当前版本 | v0.1.2 |
| 技术栈 | Electron 43.1.1 + 纯 ESM .mjs |

### 3.2 架构亮点

**零依赖校验器**：`validate-theme.mjs` 仅 140 行纯 Node 脚本，零依赖。三层拦截：
- Manifest 完整性（必须字段、kebab-case ID、semver version）
- CSS 安全规则（作用域限制、禁止 @import、禁止远程资源、禁止隐藏原生控件）
- QA 警告（状态变更属性、pointer-events、窄视口、prefers-reduced-motion）

输出结构化 JSON（status / errors / themeId / version / warnings），CI 可直接消费。

**设计契约驱动**：每个主题都附 `design` 字段表达边界——`allowedChanges`（允许改什么）、`preserve`（不可触碰什么）。15 个语义色板（canvas / surface / raised / input / text / muted / accent / border / focus / success / warning / danger / terminalBackground / terminalForeground）。

**五段验收报告**：designed → statically valid → applied → visually verified → restored successfully。不允许仅凭静态预览或注入 marker 声称视觉验收。

**应用状态感知**：Theme Manager 单实例运行，启动/应用/周期重注入/恢复时自动接管旧 CLI 守护状态，接管前验证 PID 命令确为 `workbuddy-theme.mjs __guard`。

### 3.3 WorkBuddy 特有洞察（供 workbuddy 适配器直接参考）

**应用事实**：
- Bundle ID: `com.workbuddy.workbuddy`
- 版本: 5.2.6, Electron 37.10.3, Chrome 138.0.7204.251
- Renderer URL: `file:///Applications/WorkBuddy.app/Contents/Resources/app.asar/renderer/index.html#`

**关键 CSS 变量策略**：WorkBuddy 5.2.6 暴露了完整的 VS Code 兼容 `--vscode-*` token 面（80+ 变量），覆盖 editor、input、list、menu、badge、buttons、panels、tabs、terminal、diff 等。

**已验证稳定根选择器**：
- `.conversation-sidebar`
- `.teams-container` / `.teams-content-wrapper` / `.teams-main-content`
- `.detail-panel-container`
- `.cbChat`
- `.claw-agent-chat-pane` / `.claw-agent-chat-topbar`
- `.codebuddy-menubar` / `.codebuddy-menu-container`
- `.wb-home-composer` / `.wb-home-composer__input-slot` / `.wb-scene-tabs`
- `[class*="_mainArea_"]` / `[class*="_title_"]` / `[class*="_time_"]`

**WorkBuddy 5.2.6 特有陷阱**：
1. 深色主题不可仅靠 `--vscode-*`——可能在侧栏标签、折叠任务头等保留 `light` 类或硬编码黑色
2. 每条可见描边只能有一个主人——`.wb-home-composer` 是外部装配件，不在它上面画输入 outline
3. 大 artwork 不要存在 CSS 自定义属性里——多 MB data URL 存入 CSS 自定义属性会令 resolved background 静默失效
4. 原生高选择器优先级——如果 narrowly scoped 规则仍被覆盖，加稳定的 `#root` 锚而非拓宽选择器

### 3.4 可借鉴点

1. **零依赖 + 结构化输出 + 三级拦截（error/warning/QA）模式**——可作为 `check-themes` 脚本的改进参照
2. **`design` 契约字段 + `allowedChanges` / `preserve` 边界清单**——可为 manifest schemaVersion:2 引入边界声明
3. **WorkBuddy 已验证选择器根列表 + `--vscode-*` token 命名 + 5.2.6 特有陷阱**——直接提升 workbuddy 适配器的注入精度
4. **五段验收报告模板**——可在 Studio 导入/发布流程中复用

---

## 四、cdredfox/workbuddy-skin-studio — 图片驱动换肤引擎

### 4.1 基本信息

| 维度 | 详情 |
|------|------|
| 仓库 | cdredfox/workbuddy-skin-studio |
| 许可证 | MIT |
| Stars / Forks | 169 / 25 |
| 内置预设 | 10 套（Miku、原神 ×2、鸣潮 ×2、火影忍者 ×2、恋与深空 ×2） |
| 创建时间 | 2026-07-16 |
| 最后推送 | 2026-07-17 |
| 技术栈 | 纯 ESM .mjs，零 npm 依赖 |

### 4.2 架构亮点

**「一张图片就是一个主题」**：用户上传 PNG/JPG/JPEG/WebP 图片，通过 Canvas 在 WorkBuddy renderer 中绘制图片，使用 `getImageData` 获取像素数据，对像素进行聚类分析提取 4 个关键色（accent / secondary / surface / text），压缩为 WebP 格式存储。

**极简 4-token 模型**：
```json
{
  "schemaVersion": 1,
  "id": "my-skin",
  "name": "My Skin",
  "hero": "hero.webp",
  "colors": {
    "accent": "#24C9D7",
    "secondary": "#EF8FD3",
    "surface": "#F7FBFF",
    "text": "#17344F"
  }
}
```

`surface` 的明度决定 light/dark 模式（亮度 > 140 为 light），自动切换 WorkBuddy 的 `data-vscode-theme-kind`。

**🎨 内置菜单**：注入后 WorkBuddy 右上角出现菜单，支持热切换、上传、删除，用户体验流畅。

**零依赖策略**：PNG→WebP 转换通过 CDP 在 WorkBuddy 的 Chromium renderer 中执行 Canvas 操作完成，而非使用 `sharp` 或 `canvas` 等图像处理库。

### 4.3 与 AgentSkin image-theme-analyzer 对比

| 维度 | AgentSkin image-theme-analyzer | WorkBuddy Skin Studio |
|------|-------------------------------|----------------------|
| 量化算法 | 中位切分（median-cut） | Canvas 像素聚类 |
| Token 数量 | 14（完整契约） | 4（极简） |
| WCAG 验证 | 内置（fgOnBg ≥ 4.5） | 无 |
| 置信度评分 | 基于颜色多样性的 0-1 分数 | 无 |
| 深浅色判定 | 加权中值亮度 + preferDark 偏置 | surface 明度 > 140 |
| 输出格式 | ThemeManifest v2（完整） | theme.json（极简） |

### 4.4 可借鉴点

1. **「上传图片 → 自动取色 → 即时预览 → 应用」一站式 UX 流程**——当前 image-theme-analyzer 是底层基础设施，缺少端到端 UX
2. **🎨 菜单的热切换模式**——无需重启应用即可切换主题
3. **SKILL.md 模式**——将安装/应用流程封装为 AI 可读的指南
4. **容器透明策略**——`#root` 背景 + 子容器透明让底图透出

### 4.5 风险

- 4-token 模型仅 4 个颜色难以覆盖复杂 UI 的配色需求
- 无 WCAG 验证，自动提取的颜色可能无法满足无障碍阅读标准
- 单一作者，无 Release 版本，稳定性无保障

---

## 五、综合评估与执行优先级

### 5.1 可执行改进排序

| 优先级 | 改进项 | 来源 | 影响范围 | 工作量 |
|--------|--------|------|----------|--------|
| **P0** | WorkBuddy 适配器注入精度提升——应用已验证选择器根列表 + `--vscode-*` token 命名 + 5.2.6 陷阱规避 | WorkBuddy-theme-skill | workbuddy 适配器 | 小 |
| **P1** | 主题校验器增强——结构化 JSON 输出 + 三级拦截（error/warning/QA） | WorkBuddy-theme-skill | check-themes 脚本 | 中 |
| **P1** | 图片→主题 UX 流程优化——端到端一站式 + 即时预览 | workbuddy-skin-studio | Studio 模块 | 中 |
| **P2** | 适配器 `matchTarget()` 自匹配模式 | CodeDrobe/core | 适配器层 | 中 |
| **P2** | per-window probe/verify 语义 | CodeDrobe/core | 注入验证 | 中 |
| **P3** | 设计契约字段（allowedChanges / preserve）| WorkBuddy-theme-skill | manifest schema | 大 |
| **P3** | 看门狗层级化思想（事件循环→CPU→心跳） | zcode-cdp | 主进程健康监测 | 大 |

### 5.2 不建议采纳的方向

1. **CodeDrobe 的 CSS 选择器驱动契约**——AgentSkin 的 14-token 变量驱动契约更稳定，不应降级
2. **zcode-cdp 的端口租约体系**——AgentSkin 的编排层已成熟，直接移植是杀鸡用牛刀
3. **4-token 简化模型**——AgentSkin 的 14-token 契约是核心设计，不应降级
4. **零依赖策略**——AgentSkin 已有成熟的 color-quantize.ts 基础设施

### 5.3 下一步行动建议

1. **立即执行**：将 WorkBuddy 已验证选择器根列表和 `--vscode-*` token 命名整合到 workbuddy 适配器测试中
2. **短期规划**：重构 `check-themes` 输出为结构化 JSON，增加 warning 级别
3. **中期规划**：为 Studio 模块增加「上传图片 → 自动取色 → 即时预览 → 应用」一站式 UX
4. **长期关注**：CodeDrobe 的 per-window 语义和选择器脆弱性检查，待其成熟后评估引入

---

## 六、关键数据汇总

| 项目 | Stars | 创建 | 最后推送 | 许可证 | 与 AgentSkin 关联度 |
|------|-------|------|----------|--------|-------------------|
| CodeDrobe/core | 9 | 2026-07-16 | 2026-07-21 | Apache-2.0 | 高（4/6 应用重叠） |
| Lumos-789/zcode-cdp | 1 | 2026-08-01 | 2026-08-15 | MIT | 中（设计哲学） |
| comeonzhj/WorkBuddy-theme-skill | 18 | 2026-07-18 | 2026-07-18 | MIT | 高（WorkBuddy 直接相关） |
| cdredfox/workbuddy-skin-studio | 169 | 2026-07-16 | 2026-07-17 | MIT | 高（WorkBuddy + 图片分析） |
