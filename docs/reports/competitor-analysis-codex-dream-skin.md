# 竞品深度分析报告：Codex Dream Skin (Fei-Away/Codex-Dream-Skin)

> 生成日期：2026-08-20 | 分析范围：GitHub 仓库 + 多级 fork + 公开技术文档

---

## 1. 项目概览

### 1.1 基本信息

| 维度 | 数据 |
|------|------|
| 仓库 | `Fei-Away/Codex-Dream-Skin`（用户提到的 `xnydl/codex-dream-skin` 并非活跃仓库，实际主仓为 Fei-Away） |
| 定位 | OpenAI Codex 桌面端的外部主题/换肤方案 |
| Star | **~7.2k**（截至 2026-07-17 社区统计，当前预计 7.5k+） |
| 首次公开提交 | 2026-07-15（Windows 初始发布） |
| 最新版本 | v**1.5.16**（injector.mjs 内置常量） |
| 最近活跃 | 2026-07-16/17（多 fork 显示持续更新） |
| 许可证 | MIT（NOTICE.md 附加限制） |
| 平台 | macOS 13+ / Windows 11 |
| 主题格式 | `.zip` 包（含 manifest.json + theme.json + theme.css + 背景图） |
| 注入方式 | CDP（localhost loopback） |

### 1.2 关键时间线

| 日期 | 事件 |
|------|------|
| 2026-07-15 | 首次公开仓库、Windows v1.0 发布 |
| 2026-07-16 | 新增 AGENTS.md、bilingual issue/PR 模板、macOS 菜单栏控制 + 热切换 + 浅/暗 auto |
| 2026-07-17 | 中文教程大面积覆盖，社区 fork 涌现 |
| 2026-07-18 | Windows 完整使用教程发布 |
| 持续 | 每周 1-2 个修复/增强（CDP lifecycle、config UTF-8 加固、Safe CSS 增强） |

### 1.3 市场热度

- **7.2k+ stars**（2026-07-17 数据），发布两周内达成
- **多个活跃 fork**（YYssong、liwenxiang-bot、nightt5879、pinlu-0、Larkspur-Wang、Fei-Away 主仓）
- **中文技术博客全覆盖**（CSDN、博客园、知乎、SegmentFault、oschina）
- **赞助商**：Passion8（AI API aff 模式），README 顶部显著植入
- **影响范围**：被咸鱼/闲鱼引流倒卖（99-199 元人民币不等）

---

## 2. 技术实现亮点

### 2.1 CDP 注入机制（核心差异点）

Codex Dream Skin 的 CDP 注入设计与 AgentSkin 截然不同：

#### 2.1.1 架构分层

```
AgentSkin (Electron 应用内多引擎)
┌─────────────┐
│   UI 层     │  -- React 19 + Zustand
├─────────────┤
│   Preload   │  -- IPC bridge
├─────────────┤
│  Main 进程  │  -- 4 引擎编排 (strategy/adapter/hybrid/deep-core)
├─────────────┤
│  CDP WS     │  -- WebSocket → 目标应用
└─────────────┘

Codex Dream Skin (独立外部工具)
┌───────────────────────────┐
│  菜单栏 App / 系统托盘     │  -- Swift/SwiftUI (Mac) / WinForms (Win)
├───────────────────────────┤
│  Injector Daemon (Node)   │  -- scripts/injector.mjs
├───────────────────────────┤
│  CDP WS (127.0.0.1:9341) │  -- 标准 Chromium DevTools Protocol
├───────────────────────────┤
│  Renderer Inject (IIFE)   │  -- assets/renderer-inject.js
└───────────────────────────┘
```

**关键差异**：Dream Skin 是**外部驻留工具**，Codex 不需要被修改、不需要是 Electron 应用，纯 Store/官方二进制即可。这比 AgentSkin 的"应用内多引擎"方案更轻量，但也意味着更少的控制力。

#### 2.1.2 CDP 注入流程（基于 SKILL.md + injector.mjs 源码分析）

```
1. 安装 (install-dream-skin.ps1 / .sh)
   ├── 校验官方 Codex 签名 / Team ID / 打包架构
   ├── 校验内置 Node.js 运行时（或复用 Codex 自带的 signed Node）
   ├── 备份 config.toml（UTF-8 strict，atomic same-dir replace）
   ├── 设置 appearance 以匹配主题基准色（不强制，可恢复）
   └── 复制运行时到稳定路径 (%LOCALAPPDATA%/~/.codex/)
   
2. 启动 (start-dream-skin.ps1)
   ├── 解析 Appx 包清单 → AppUserModelId
   ├── 通过 launchd/Store 激活启动 Codex + CDP debug port
   ├── 等待 CDP endpoint 可达
   ├── 校验 port 属于当前 Store 包（防 MITM）
   └── 连接 ws://127.0.0.1:<port>/devtools/page/<id>

3. 注入 (injector.mjs)
   ├── 进入 app:// 渲染页（过滤 pet overlay 等特殊 surface）
   ├── 注入 staticPayload（CSS + 背景图 dataURL + themeConfig）
   ├── 注册 watcher 监听 navigation/reload → 重新注入
   └── 注册 operation UI host（状态提示浮层）

4. 验证 (verify-dream-skin.ps1)
   ├── 等待 skin marker 出现
   ├── 校验背景连续铺满、侧栏可见、composer 原生
   ├── 校验 injection marker 存在
   ├── 截图 → 与 qa-inventory.md 比对
   └── 校验普通任务页 + 首页两个 route

5. 恢复 (restore-dream-skin.ps1)
   ├── 停止 injector
   ├── 关闭保存的 CDP session
   ├── 可选：恢复 config 为安装时备份（byte-for-byte）
   └── 重启 Codex（官方正常入口）
```

#### 2.1.3 CDP 安全边界（Dream Skin 的独特设计）

Dream Skin 在 CDP 安全上做了许多 AgentSkin 未明确覆盖的工作：

| 安全措施 | Dream Skin 实现 | AgentSkin 对比 |
|---------|----------------|----------------|
| Port ownership 校验 | 验证 CDP listener 属于 Store/App 包 identity | 通过 WebSocket 握手隐式校验 |
| Same-port loopback 约束 | 必须 127.0.0.1 + 启动时 Browser ID 一致 | 通过 orchestrator 乐观锁 |
| 渲染器标记验证 | 检测 Codex-specific renderer markers | 通过 contract.json |
| CDP redirect 拒绝 | `redirect: "error"` on fetch | 通过 WebSocket origin check |
| Session 复写防护 | 持久化 non-default CDP profile (Chromium 136+ requirement) | 复用已有 profile |
| Fail-closed 原则 | 任意 validate 失败 → 立即终止 | 注入失败自动回滚 |

### 2.2 主题格式对比

#### 2.2.1 Dream Skin 主题包结构

```text
<theme>.zip
├── manifest.json        ← 平台校验、min client ver、文件 SHA-256
├── theme.json           ← 自适应图像主题契约 + colors override
├── theme.css            ← Safe CSS（allowlist 校验）
├── background.webp/jpg  ← 唯一背景图
├── LICENSE.txt          ← 可选，保留但不再校验
└── manifest.sig         ← 预留，当前不参与签名验证
```

#### 2.2.2 theme.json 自适应契约（Dream Skin 核心创新）

```json
{
  "appearance": "auto",
  "art": {
    "focusX": 0.72,
    "focusY": 0.45,
    "safeArea": "auto",
    "taskMode": "auto"
  }
}
```

- **appearance**: `auto` 跟 Codex 原生壳 + OS；显式 `light`/`dark` 优先
- **art.focusX/Y**: 归一化焦点 → `background-position`
- **art.safeArea**: `auto` 自动识别低信息侧；显式 left/right/center/none
- **art.taskMode**: `auto`（超宽图→横幅+纵向渐隐，普通→低噪背景）；ambient/banner/full/off

**核心设计哲学**：一张背景图 → 本机 Canvas 分析（亮度、accent、焦点、safe area、aspect ratio）→ 生成整套配色 → **无外部 API / 无上传**。

#### 2.2.3 与 AgentSkin 14-Token 契约对比

| 维度 | AgentSkin（14 tokens） | Dream Skin（自适应图像） |
|------|----------------------|----------------------|
| 变量数量 | 14 个 `--agentskin-*` token | ~40 个 `--ds-*` / `--ds-theme-*` CSS 变量 |
| 来源 | `palette.css` 显式定义 | 图像分析自动生成 + theme.json 显式覆盖 |
| 适配等级 | 浅/中/深三级 | 仅图像级（一张图 = 一套主题） |
| 校验 | check-themes 脚本强制 14-token 齐全 | 导入时 SHA-256 + Safe CSS + 尺寸校验 |
| 灵活性 | 严格契约，易验证 | 更灵活但难以自动化校验一致性 |
| 创作门槛 | 需手动填写 14-token | 拖一张图，本机生成 |
| 用户体验 | 开发者友好 | 小白友好 |

### 2.3 智能校验与验证机制

Dream Skin 的 `verify-dream-skin.ps1` 是一套**完整的 QA 流程**，这在 AgentSkin 中完全缺失：

1. **连续壁纸检测**：背景必须跨过整窗连续铺满（非拼接、非重复）
2. **组件可见性校验**：首页 hero/banner、侧栏、输入框必须原生可见
3. **Injection marker 校验**：DOM 注入标记存在 + 版本号匹配
4. **任务页校验**：普通任务页背景自动降低干扰
5. **安全边界校验**：无整窗假截图、无 overlay 伪造
6. **响应式建议卡**：native suggestion count 2-4 区间内即通过

AgentSkin 目前通过 `check-injection-contract`（C1）脚本做静态校验，但**没有在运行时做截图级别的视觉 QA**。

### 2.4 配置备份与原子恢复

Dream Skin 的 config 管理是亮点：

- 安装时 `config.toml` 完整备份（byte-for-byte）
- 仅修改 `appearance` 相关 key，不改 API Key / Base URL
- 恢复时 `-RestoreBaseTheme`（只恢复外观）/ `-RecoverConfigBackup`（完整恢复）/ `-Uninstall`
- 必须 Codex 已关闭 + 操作锁 + same-filename UTF-8 + unchanged-byte check 后才写回
- 恢复后归档当次安装备份，为下次安装提供新基线

这比 AgentSkin 的"修改前 grab snapshot"机制**更精细、更可靠**。

### 2.5 Safe CSS 机制

Dream Skin 的 theme.css 必须通过本机 Safe CSS 校验：

- 白名单 allowlist（特定的属性/选择器）
- 仅在 12 个（Windows）/ 注册部件上生效
- 每次 import + 每次 apply 都重新校验
- 不允许新导入包给旧主题新增兼容旁路

这一点与 AgentSkin 的 injection contract 校验有相似之处，但 Dream Skin 的 allowlist 更激进（只允许装饰性 CSS，不允许 display/position/visibility 修改）。

### 2.6 并发控制

Dream Skin 通过**操作锁（per-user operation lock）**实现串行：

- install/start/restore/verify 共享同一把锁
- 锁持有期间新 CLI/托盘调用失败
- 明确的 operation state machine：applying → success/error/cancelled
- 状态文件位于 %LOCALAPPDATA%/~/Library 路径

这与 AgentSkin 的 InjectionLock + InjectionQueue 对等，但 Dream Skin 是**单引擎串行**，AgentSkin 是**多引擎协调**。

---

## 3. 可借鉴设计模式

### 3.1 高优先级（强烈推荐）

| # | 模式 | Dream Skin 实现 | AgentSkin 现状 | 借鉴可行性 |
|---|------|----------------|---------------|-----------|
| P0 | **运行时视觉 QA** | verify-dream-skin.ps1 + qa-inventory.md 截图比对 | 仅静态 C1 校验 | 高 — 可增量加入 verify 阶段 |
| P0 | **原子配置备份恢复** | config UTF-8 strict + backup 归档 + byte-for-byte 恢复 | 注入前 grab snapshot | 高 — 直接提升鲁棒性 |
| P0 | **一键换肤** | `dreamskin://apply?ver=...` 协议，原生确认框，SHA-256 校验后应用 | 需手动导入 zip | 高 — AgentSkin 适配后可实现 Theme store 一键安装 |
| P1 | **自适应图像主题** | Canvas 本机分析 → auto palette +焦点 + safe area | 需手动填写 14 token | 中 — 需考虑与现有 14-token 契约兼容 |
| P1 | **分层验证** | 安装/启动/验证/恢复独立步骤 | 耦合在 installFlow store | 中 — 可单独拆分 verify 为独立阶段 |
| P1 | **官方更新兼容** | 动态解析 Appx 包 → 不依赖固定路径 | 依赖固定 adapter selector | 高 — 值得学习包动态发现机制 |

### 3.2 中优先级（可选增强）

| # | 模式 | Dream Skin 实现 | AgentSkin 现状 | 借鉴可行性 |
|---|------|----------------|---------------|-----------|
| P2 | **官方主题库 + 在线 Studio** | DreamSkin.cc（Gallery + Studio + 投稿审核） | 内置 themes/ 目录 | 低 — AgentSkin 禁止自建 CDN/服务端 |
| P2 | **Safe CSS allowlist** | 每次 import + apply 都校验 | contract + validation | 中 — 可强化 CSS 沙箱 |
| P2 | **操作锁状态持久化** | 锁 token 跨进程传递 | 内存态 InjectionLock | 中 — 可引入锁持久化 |
| P2 | **Pet surface 过滤** | 排除 avatar overlay 渲染表面 | 按 agent 区分 | 高 — 按 agent 已有 contract 隔离 |

### 3.3 低优先级（不适合 AgentSkin）

| # | 模式 | 不适合原因 |
|---|------|-----------|
| - | **仅 Codex 单 agent** | AgentSkin 适配 6 agent，需通用方案 |
| - | **外部驻留工具模式** | AgentSkin 是引擎嵌入 Electron，不从外部注入 |
| - | **赞助/aff 模式** | 非技术因素 |
| - | **图片即主题** | 与 14-token 契约冲突，需 Schema 变更 |

---

## 4. Codex 适配器对比（AgentSkin vs Dream Skin）

| 维度 | AgentSkin (codex adapter) | Dream Skin |
|------|--------------------------|------------|
| 注入方式 | Electron main 进程通过 CDP | 外部 Node injector 通过 CDP |
| 图像支持 | 支持背景图（theme 级） | **图像即一等公民** |
| 自适应分析 | 无（开发者显式填 token） | Canvas 本机分析 → palette 推断 |
| Selector 契约 | contract.json + selector-candidate-scorer | selector contract（selectors.json） |
| 主题热更新 | Support via HybridInjector | 支持（hot_reapply_theme，CDP 存活时秒级切换） |
| 验证机制 | check-injection-contract 静态校验 | 独立 verify 脚本 + 截图比对 |
| 配置保护 | Snapshot + restore | config backup + UTF-8 strict + atomic write |
| 状态持久化 | Zustand store | JSON file on disk |

---

## 5. 实施建议

### 5.1 短期（无需 RFC）

1. **引入独立 verify 脚本**：为现有 installFlow 增加视觉 QA 步骤，截图后对关键 DOM marker 做断言
2. **配置备份机制**：在修改目标应用配置前，自动做 UTF-8 strict + byte-for-byte 备份
3. **一键换肤协议**：注册 `agentskin://apply?theme=...` 协议，复用现有 ZIP 导入 + Safe 校验链路

### 5.2 中期（需评估）

4. **自适应图像主题扩展**：作为现有 14-token 的可选补充——当用户提供图像但无 token 定义时，通过 Canvas 分析自动生成 token。需保持 14-token 向后兼容。
5. **运行时视觉回归**：在 contract-verify 中引入 Puppeteer/CDP 截图对比（仅针对 agent 可截图场景）

### 5.3 长期（需 RFC）

6. **主题商店一键安装**：如果未来 AgentSkin 需要 Theme store 能力，可参考 Dream Skin 的 `dreamskin://` 协议 + 多重校验链路。但这涉及服务端，在当前规则下不可行。

---

## 6. 关键风险标注

### 6.1 Dream Skin 已知风险

- **CDP 无认证**：任何本机进程都可连接 127.0.0.1:9341 — Dream Skin 文档显式声明，但未完全缓解
- **Windows Store 包路径**：依赖 Appx 包清单解析，Codex 更新后 SKILL.md 报告了多个 breakage issue（#235）
- **人物素材权利**：README 包含特定人物图片（桥本有菜 / Arina Hashimoto），公开 DMG 已排除
- **Safe CSS 实现细节**：未公开完整 allowlist，但从 SKILL.md 推断仅装饰性属性

### 6.2 对 AgentSkin 的威胁评估

Dream Skin **不是直接竞品**——它只适配 Codex 桌面端，而 AgentSkin 是六 agent 引擎。但它的**用户体验设计**全面领先：

- 一键换肤协议
- 托盘/菜单栏常驻
- 验证/恢复独立步骤
- 小白友好（一张图 → 主题）

如果 AgentSkin 在 Codex 适配器上不提供对等体验，用户可能双开两个工具。

---

## 7. 总结

Codex Dream Skin 是 2026 年 7 月出现的**高质量、快速爆发**的专项换肤工具。它在 CDP 注入、主题格式、验证机制、配置恢复、安全边界五个维度上有**值得 AgentSkin 借鉴的设计**。

**核心启示**：

1. **运行时验证 > 静态校验**：Dream Skin 的 verify 脚本是真实 QA，AgentSkin 需要补这块
2. **图像即主题**：自适应 token 生成可降低创作门槛，但需与现有契约兼容
3. **原子恢复机制**：Dream Skin 的 config 管理比 AgentSkin 的 snapshot 更可靠
4. **一键协议**：`dreamskin://` 模式用户体验极好，AgentSkin 可以借鉴但无需服务端

**无需恐慌**：AgentSkin 的六 agent 架构、14-token 契约、四引擎注入能力在**广度与深度**上远超 Dream Skin。Dream Skin 的优势集中在**单 agent 的小白体验**层面。

---

*报告完成。*
