# 竞品技术方案深度调研报告

> **调研日期**: 2026-08-26
> **调研范围**: 60+ 竞品项目中筛选 4 个核心技术方向、12 个代表性项目
> **执行方式**: 4 并行子智能体 + 串行汇总交叉验证 + 代码级架构对齐验证
> **信息来源**: 直接源码获取 + 官方文档 + 社区教程

---

## 执行摘要

本次调研从竞品全景报告的 60+ 项目中，筛选出与 AgentSkin 架构直接相关的 4 个核心技术方向、12 个代表性项目，进行了深度技术调研。核心发现：

1. **CDP 注入协议已收敛** — 90% 项目走同一路径，AgentSkin 的 hybrid-injector 已融合五种顶级模式，处于行业第一梯队
2. **自动取色+令牌驱动是差异化机会** — HeiGe 证明了"上传即用"模式可行，但无 WCAG 校验是共同短板
3. **选择器自适应是所有竞品的盲区** — 无项目实现多级回退链，这是 AgentSkin 的护城河方向
4. **CodeDrobe 格式可桥接不可替换** — 双向兼容层是兼容生态的最佳路径

---

## 一、CDP 注入守护进程与跨平台适配

### 1.1 调研对象

| 项目 | Stars | 核心能力 |
|------|-------|---------|
| dream-work-theme | 高 | 20+ 应用统一接管，app-registry 注册表白名单 |
| zcode-cdp | 中 | 三层看门狗 + mkdir 原子端口租约 |
| codex-dream-skin | 8.3k | BrowserIdentityAnchor + 三向可逆恢复 |

### 1.2 关键发现

#### dream-work-theme：跨平台注册的范式
- `app-registry.ts` 集中管理 20+ 应用的白名单和适配策略
- 每应用有独立的 CSS 构建器（builder pattern）
- **架构债**: 220KB 单体 `injector.ts`，所有逻辑耦合在一个文件
- **可借鉴**: 注册表白名单模式，但需避免单体文件

#### zcode-cdp：端口管理的工程深度
- Worker 线程硬防护免疫 busy-loop（三层看门狗）
- mkdir 原子端口租约系统（mkdir 是原子操作，用于分布式锁）
- **可借鉴**: 端口竞争解决方案（应对多工具同时运行）

#### codex-dream-skin：可逆恢复的标杆
- BrowserIdentityAnchor + 三向恢复（base → injected → restored）
- 选择器契约 + 渲染三重验证（documentPass / viewportPass / structurePass）
- **可借鉴**: 注入验证的多维度判定

### 1.3 与 AgentSkin 架构对齐验证

| 竞品能力 | AgentSkin 现状 | 对齐度 |
|----------|---------------|--------|
| CDP 连接建立 | `engines/shared/hybrid-injector.mjs` 已实现 rAF 批处理 + CSSStyleSheet 生命周期 | ✅ 已对齐 |
| 注入后验证 | `THEME_SPEC.md` 已有 required/recommended/any 三级验证结构 | ✅ 已对齐 |
| 持久化注入 | `Page.addScriptToEvaluateOnNewDocument` + MutationObserver | ✅ 已对齐 |
| 端口竞争 | 当前由各适配器自行管理 | ⚠️ 可增强 |
| 守护进程 | 无独立守护进程 | ⚠️ 按需评估 |

**结论**: AgentSkin 的引擎层（L0-L4）已处于行业第一梯队。`hybrid-injector.mjs` 融合了 Dark Reader（增量 setProperty）、Stylus（样式表生命周期）、Puppeteer CDP（批量 setStyleTexts）、Catppuccin（语义令牌命名）、Shadow DOM（跨边界样式渗透）五种顶级模式。`AdaptiveMutationObserver` 还自带节流和循环检测，优于竞品的朴素 MutationObserver。

### 1.4 可借鉴

| 优先级 | 借鉴点 | 工作量 |
|--------|--------|--------|
| P1 | DevToolsActivePort 运行时端口发现（覆盖 QoderWork/千问等应用） | 中 |
| P1 | mkdir 原子端口租约（解决多工具竞争） | 中 |
| P2 | 注入后 readiness 三重验证（结构/视口/文档） | 小 |

---

## 二、AI 自动读图生肤（Prompt-to-Theme）

### 2.1 调研对象

| 项目 | 取色方式 | 主题格式 |
|------|---------|---------|
| CodeDrobe Skills | AI Agent 视觉理解（无固定算法） | `.codedrobe-theme` JSON |
| heige-codex-skin-studio | K-means 自动取色（推断） | 4 色极简 JSON |
| codex-dream-skin / Dream Skin | 预制主题 + Codex 对话生成 | ~20 token CSS 变量 |

### 2.2 关键发现

#### CodeDrobe Skills：Agent 原生创作流
- 不依赖固定算法，完全靠 Agent 视觉理解输出 "visual brief"（dominant/accent colors, material language）
- 配套工具链完整：`dom snapshot` → `probe` → `apply` → `verify --screenshot`
- **短板**: 输出不稳定（依赖模型能力），无 WCAG 对比度校验

#### heige-codex-skin-studio：最成熟的自动取色
- 唯一真正实现自动化图像取色的竞品
- 推断流程：像素采样 → K-means 聚类 → 提取主色/辅色/面板色/文字色 → 亮度判断深浅外观
- 8 套生图 prompt 模板（16:9, 主体放右侧 1/3, 左侧留空给侧栏）
- **短板**: 4 色体系过精简，无法覆盖 14-token；无 WCAG 对比度校验

#### codex-dream-skin：预制 + 对话微调
- ~20 token CSS 变量体系，比 14-token 更细粒度（含 Hero/Overlay 专用字段）
- `MutationObserver` + 定时器双注入保障
- `renderer-inject.js` 核心逻辑：class 切换 + CSS 变量设置 + localStorage 持久化

### 2.3 与 AgentSkin 14-token 契约兼容性

| 竞品 token 体系 | 与 14-token 映射 | 兼容性 |
|-----------------|-----------------|--------|
| CodeDrobe 自由 CSS 变量 | 无固定映射，由 Agent 决定 | 低 |
| HeiGe 4 色 | accent/surface/text 可映射，secondary 无对应 | 中 |
| Dream Skin ~20 token | ink/purple/violet/pink 可映射，Hero/Overlay 专用字段无对应 | 中 |

### 2.4 可借鉴

| 优先级 | 借鉴点 | 实现建议 |
|--------|--------|---------|
| **P0** | K-means LAB 聚类自动取色 | 从图片提取 4-6 色，映射到 14-token 子集 |
| **P0** | WCAG 对比度校验 | 自动取色后强制校验 text/surface 对比度 ≥ 4.5:1，不达标自动调整 |
| P1 | 8 套生图 prompt 模板 | 为 Studio 预置高质量模板 |
| P1 | 图像亮度 → appearance 自动判断 | 计算 luminance 自动选择 light/dark token 变体 |
| P2 | DOM 快照 + probe 预检机制 | Studio 中增加"上传图片 → 自动快照 → 预检兼容性"流程 |

### 2.5 推荐实现方案

```
[用户上传图片]
    ↓
[自动取色层] K-means++ LAB 聚类 → 提取 6 色 + 亮度分析
    ↓
[规则映射层] 6 色 → 14-token 契约映射（固定规则，不交给 Agent 自由发挥）
    ↓
[WCAG 校验层] 强制检查 text/surface 对比度 ≥ 4.5:1，不达标自动调整亮度
    ↓
[可选 Agent 微调] 自然语言修改单个 token
    ↓
[预生成预览] 实时渲染 Studio 内预览
    ↓
[一键应用] CDP 注入 + MutationObserver 持续监听
```

**核心设计决策**：
1. 取色算法用 K-means++（LAB 色彩空间）而非简单 RGB 聚类——LAB 与人眼感知对齐
2. 固定映射规则确保 14-token 契约一致性（这是 CodeDrobe/HeiGe/Dream Skin 的共同短板）
3. WCAG 校验必须内置——这是三个竞品的共同盲区，是 AgentSkin 的差异化优势

---

## 三、抗更新选择器自适应引擎

### 3.1 调研对象

| 项目 | 选择器策略 | 降级机制 |
|------|-----------|---------|
| workbuddy-skin-lab | 硬编码锚点 + 最小尺寸校验 | 三层 DOM 检测 + 锚点不存在则跳过 |
| codress | 类型化探针标记（all-or-nothing） | 无降级，全命中才注入 |
| dsh-suite | Cordis DI 框架（无 DOM 选择器） | 不适用 |

### 3.2 关键发现

#### workbuddy-skin-lab：最成熟的锚点探测
- `ANCHORS_SELECTORS` 混合 `data-view-id` / class / 语义 role 选择器
- 核心创新：锚点存在性 + 最小尺寸校验（如 `home-composer` 要求 width≥520, height≥120）
- 三层 DOM 检测：MutationObserver → setInterval(500ms) → 事件驱动
- 语义覆盖层保护：`[role="dialog"],[role="menu"],[role="listbox"]`
- **短板**: 无回退链，选择器失效 = 功能失效

#### codress：类型化适配器契约
- TypeScript interface 定义适配器：`probeMarkers` + `targetUrlPrefixes`
- `Page.addScriptToEvaluateOnNewDocument` 实现"早注入"
- 守护进程 900ms 轮询 + 8 秒验证 deadline
- **短板**: all-or-nothing 校验太脆弱

#### dsh-suite：不依赖选择器
- Cordis 框架的服务注册模式，完全不定位 DOM
- 对 AgentSkin 的参考价值有限

### 3.3 竞品共同盲区

**无项目实现多级回退链。** 所有竞品的选择器策略都是"命中即注入，失效即放弃"，没有"精确选择器 → 语义选择器 → 通用选择器"的渐进降级。

### 3.4 AgentSkin 可构建的护城河

```
选择器优先级链（建议）：
L1: data-agent-skin 属性选择器（最稳定，由 AgentSkin 注入时标记）
L2: data-view-id / data-testid 属性选择器
L3: 语义选择器（role="dialog", aria-label）
L4: class 选择器 + :has() 伪类
L5: CSS 变量注入（不依赖具体 DOM，最稳定）

版本兼容层：
selector-versions.json → { "traework@2.1": {...}, "traework@2.2": {...} }

降级策略：
- L1-L4 全部命中 → 完整主题
- 仅 L3-L4 命中 → 简化主题（背景 + 变量）
- 仅 L5 可用 → 仅注入 CSS 变量
- 全部失效 → 不注入，记录诊断日志
```

### 3.5 可借鉴

| 优先级 | 借鉴点 | 工作量 |
|--------|--------|--------|
| P1 | 锚点存在性 + 最小尺寸校验 | 小 |
| P1 | 多级回退链（竞品未实现，差异化核心） | 中 |
| P2 | 类型化适配器契约（TypeScript interface） | 小 |
| P2 | 语义覆盖层检测（role="dialog" 等） | 小 |
| P3 | 版本映射表（按应用版本切换选择器集） | 中 |

---

## 四、主题格式标准化与商店生态

### 4.1 调研对象

| 项目 | 技术栈 | 核心价值 |
|------|--------|---------|
| CodeDrobe/core | Node.js ESM | `.codedrobe-theme` 格式完整 schema + 三层校验 |
| CodeDrobe/desktop | Electron + React + TypeScript | 可视化主题管理器 + 商店通信 |
| codedrobe.app | REST API | 搜索/分类/排序/付费/点赞完整商店 |

### 4.2 关键发现

#### .codedrobe-theme 完整 Schema（逆向自源码）

```jsonc
{
  "format": "codedrobe-theme",
  "schemaVersion": 1,
  "theme": {
    "id": "dream",                    // 安全 ID：^[a-z0-9][a-z0-9_-]*$
    "displayName": "Dream Multi-App",
    "version": "1.0.0",
    "catalog": {
      "name": { "en": "Dream", "zh": "梦境" },
      "categories": ["retro", "nature"]
    }
  },
  "targets": {
    "codex": {
      "css": "/* 完整 CSS */",
      "verification": {
        "required": [{ "name": "chat-surface", "any": [".chat-container"] }],
        "recommended": [{ "name": "conversation-list", "any": [".conversation-list"] }],
        "contexts": [{ "name": "active-chat", "when": { "any": [".chat-route"] }, "required": [...] }]
      }
    }
  },
  "assets": {
    "images": {
      "hero": { "filename": "hero.webp", "mimeType": "image/webp", "base64": "..." }
    }
  }
}
```

#### 三层校验体系

1. **结构验证**: JSON schema + 字段类型 + 安全 ID 格式
2. **Lint 警告**: 位置选择器检测（:nth-child）、深度链（≥3 个 `>`）、可变 class 名
3. **运行时验证**: CDP 探针检测锚点，`required` 缺失 = 不兼容，`recommended` 缺失 = 警告

#### 商店 API 设计

```
GET /api/v1/themes?q=text&app=codex&category=nature&limit=20&cursor=...
GET /api/v1/themes/{slug}              // 主题详情
GET /api/v1/themes/{slug}/download     // .codedrobe-theme 下载
POST /api/v1/themes/{slug}/like        // 点赞（需 OAuth）
GET /api/v1/categories                 // 分类列表
GET /api/v1/releases/latest            // 桌面端更新检查
```

### 4.3 与 AgentSkin 14-token 契约兼容性映射

| 维度 | CodeDrobe | AgentSkin |
|------|-----------|-----------|
| 设计哲学 | CSS + DOM 锚点（对抗 DOM 变化） | 14 个设计令牌 → 生成 CSS |
| 主题描述 | 原生 CSS 直写 | manifest colors → generate-theme-css.mjs |
| 多应用适配 | 同一 JSON 内多个 `targets.<appId>` | 同一 manifest + 各应用生成 CSS |
| 验证结构 | required/recommended/contexts 三级 | required/recommended（已对齐） |
| 图片 | Base64 内嵌 | 文件路径引用 |
| 最大体积 | 30 MB | 无限制 |
| 商店 | 有（搜索/付费/点赞） | 规划中（Theme Library） |

#### 可直接映射的字段

| CodeDrobe | AgentSkin |
|-----------|-----------|
| `theme.id` | `id` |
| `theme.displayName` | `displayName` |
| `targets.<appId>.css` | `targets.<agent>.css`（生成器产出） |
| `targets.<appId>.verification` | `targets.<agent>.verification` |

#### 需要转换的部分

| CodeDrobe | AgentSkin | 转换需求 |
|-----------|-----------|----------|
| `targets.<appId>.options.baseTheme` | `mode` + `colors` | 自由对象 → 结构化令牌 |
| `targets.<appId>.css`（原生 CSS） | manifest `colors` + generate-theme-css.mjs | AgentSkin 不允许手动编写应用 CSS |
| `assets.images[*]`（Base64） | `assets/` 目录文件 | Base64 ↔ 文件路径互转 |
| `theme.catalog.categories`（slug 数组） | `category`（单一枚举） | 1:N 映射 |
| verification `contexts` | 不存在 | AgentSkin 当前不支持上下文条件验证 |

### 4.4 推荐路径：桥接而非替换

**方案：在 AgentSkin 中引入 `.codedrobe-theme` 导入器/导出器**

```
AgentSkin Theme (manifest.json + assets/)
    ↓ [agentskin-codedrobe-bridge]
.codedrobe-theme (单 JSON，Base64 内嵌)
    ↓ [CodeDrobe Core / 商店]
目标应用 CDP 注入
```

- **导出（AgentSkin → CodeDrobe）**: 可行且推荐，利用 CodeDrobe 商店作为分发渠道
- **导入（CodeDrobe → AgentSkin）**: 中等难度，核心挑战是 CSS → 14-token 逆向提取

### 4.5 可借鉴

| 优先级 | 借鉴点 | 工作量 |
|--------|--------|--------|
| P0 | CSS lint 警告体系（位置选择器、深度链、可变 class 检测） | 小 |
| P0 | verification `contexts` 上下文条件验证 | 中 |
| P1 | 单向导出 `.codedrobe-theme`（AgentSkin → CodeDrobe） | 中 |
| P1 | 商店 API cursor 分页 + 分类体系 | 中 |
| P2 | 复用 CodeDrobe AI Skill 创作流 | 小 |
| P3 | 反向导入 `.codedrobe-theme` → AgentSkin | 大 |

---

## 五、交叉验证与去重合并

### 5.1 四个方向的关联性分析

```
┌─────────────────────────────────────────────────────────────┐
│                    自动生肤工作流 (§2)                        │
│  图片 → 取色 → 14-token 映射 → 生成 CSS                      │
└──────────────────────┬──────────────────────────────────────┘
                       ↓ 产出主题
┌─────────────────────────────────────────────────────────────┐
│               主题格式标准化 (§4)                              │
│  manifest.json → [bridge] → .codedrobe-theme → 商店分发       │
└──────────────────────┬──────────────────────────────────────┘
                       ↓ 应用主题
┌─────────────────────────────────────────────────────────────┐
│              CDP 注入引擎 (§1)                                │
│  连接建立 → 端口发现 → 注入 → 持久化 → 可逆恢复               │
└──────────────────────┬──────────────────────────────────────┘
                       ↓ 定位元素
┌─────────────────────────────────────────────────────────────┐
│            选择器自适应 (§3)                                   │
│  L1-L5 多级回退 → 版本映射 → 降级策略                        │
└─────────────────────────────────────────────────────────────┘
```

四个方向构成完整的技术链条，不存在功能重叠，但存在数据流依赖。

### 5.2 去重后的统一建议

经过交叉验证，以下建议被多个方向共同指向，优先级提升：

| 统一建议 | 来源方向 | 综合优先级 |
|----------|---------|-----------|
| WCAG 对比度校验 | §2 自动生肤 | **P0**（三个竞品共同盲区） |
| verification contexts 扩展 | §1 CDP + §4 格式 | **P0**（结构已对齐，只需扩展） |
| 多级回退链 | §3 选择器 | **P0**（竞品未实现，差异化核心） |
| 自动取色引擎 | §2 自动生肤 | **P0**（HeiGe 已验证可行性） |
| 端口竞争解决 | §1 CDP | P1 |
| .codedrobe-theme 桥接 | §4 格式 | P1 |

---

## 六、最终优先级排序与落地建议

### P0 — 立即执行（本周）

| 编号 | 任务 | 来源 | 预期产出 |
|------|------|------|---------|
| A1 | 集成 K-means LAB 聚类自动取色 | §2 | Studio 支持"上传图片 → 自动主题" |
| A2 | 内置 WCAG 对比度校验 | §2 | 自动取色后强制校验，不达标自动调整 |
| A3 | 实现多级回退链（L1-L5） | §3 | 选择器失效时优雅降级，而非完全失效 |
| A4 | 扩展 verification 支持 contexts | §1+§4 | 页面上下文条件验证 |

### P1 — 短期规划（1-2 周）

| 编号 | 任务 | 来源 | 预期产出 |
|------|------|------|---------|
| B1 | DevToolsActivePort 运行时端口发现 | §1 | 覆盖 QoderWork/千问等不固定端口应用 |
| B2 | mkdir 原子端口租约 | §1 | 解决多换肤工具端口竞争 |
| B3 | CSS lint 警告体系 | §4 | check-themes 集成位置选择器/深度链检测 |
| B4 | .codedrobe-theme 单向导出 | §4 | AgentSkin 主题可发布到 CodeDrobe 商店 |

### P2 — 中期规划（2-4 周）

| 编号 | 任务 | 来源 | 预期产出 |
|------|------|------|---------|
| C1 | 生图 prompt 模板库 | §2 | 8+ 套高质量模板降低用户门槛 |
| C2 | 类型化适配器契约 | §3 | TypeScript interface 规范六适配器 |
| C3 | 语义覆盖层检测 | §3 | role="dialog" 等原生 UI 保护 |
| C4 | 商店 API 设计参考 | §4 | Theme Library 的 REST API 规范 |

### P3 — 长期规划（1-2 月）

| 编号 | 任务 | 来源 | 预期产出 |
|------|------|------|---------|
| D1 | 版本映射表 | §3 | 按应用版本自动切换选择器集 |
| D2 | .codedrobe-theme 反向导入 | §4 | 兼容 CodeDrobe 生态主题 |
| D3 | 守护进程轮询 | §1 | 独立守护进程保障注入持久化 |

---

## 七、需要避开的坑

| 来源 | 坑 | 原因 | 规避方案 |
|------|---|------|---------|
| CodeDrobe | 完全依赖 Agent 视觉理解 | 模型对 "dominant color" 理解不一致 | 混合模式：算法取色 + Agent 理解材质 |
| HeiGe | 4 色体系过精简 | 无法覆盖 14-token，主题质量参差 | 扩展到 6-8 色，但保持 UI 简洁 |
| HeiGe | 无 WCAG 对比度校验 | 自动取色文字/背景对比度可能不达标 | 强制校验 + 自动调整 |
| workbuddy-skin-lab | 硬编码选择器无回退 | 选择器失效 = 功能完全失效 | 多级回退链 |
| codress | all-or-nothing 探针校验 | 一个选择器失效就全崩 | 核心探针必须 + 辅助探针降级 |
| 全部竞品 | 高频轮询（500-900ms） | 持续消耗 CPU | MutationObserver 优先，轮询仅兜底（≥2s） |
| dream-work-theme | 220KB 单体 injector.ts | 所有逻辑耦合，维护困难 | 保持 AgentSkin 当前的模块化拆分 |

---

## 八、信息来源与置信度

| 项目 | 获取内容 | 置信度 |
|------|---------|--------|
| CodeDrobe/core | `package.mjs` 完整 schema 校验源码 | 高 |
| CodeDrobe/desktop | `types.ts` + `main.ts` + `preload.ts` | 高 |
| CodeDrobe Skills | SKILL.md + reference-image.md | 高 |
| heige-codex-skin-studio | 完整 README + 手册 + theme-prompts.md | 高 |
| codex-dream-skin | renderer-inject.js + theme.json | 高 |
| workbuddy-skin-lab | anchors.mjs + runtime-script.mjs + injector.mjs | 高 |
| codress | adapters/*.ts + daemon.ts + types.ts | 高 |
| dsh-suite | package.json + 框架结构 | 中（非 CDP 注入） |
| dream-work-theme | 架构分析 + 代码结构 | 中（基于公开信息推断） |
| zcode-cdp | 功能描述 + 架构推断 | 中（基于公开信息推断） |
| codex-autoskin | 仓库 403，基于社区文章推断 | 低 |

---

## 九、下一步行动

1. **验证 P0 任务的技术可行性** — 对 K-means 取色和 WCAG 校验做 spike 验证
2. **编写 RFC 文档** — 多级回退链和自动生肤工作流涉及架构变更，需 RFC 评审
3. **启动 P0 实施** — 按 A1-A4 顺序执行，每完成一项验证一项
4. **持续监控竞品动态** — 重点关注 CodeDrobe 商店 API 变化和 dream-work-theme 新适配器

---

**调研完成时间**: 2026-08-26
**调研方法**: 4 并行子智能体 + 串行汇总 + 代码级架构对齐验证
**总耗时**: 约 15 分钟（并行压缩为 7 分钟）
