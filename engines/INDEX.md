# engines — CDP 注入引擎集

## 用途
通过 Chrome DevTools Protocol 为 6 款 AI 应用提供视觉定制注入。每个适配器由三件套组成：注入器脚本、令牌样式与外观样式。

## 结构

### 适配器清单

| 目录 | 目标应用 | 说明 |
|------|---------|------|
| `traework/` | traework | Trae AI IDE 视觉定制 |
| `qoderwork/` | qoderwork | Qoder 视觉定制 |
| `workbuddy/` | workbuddy | WorkBuddy 视觉定制 |
| `doubao/` | doubao | 豆包 AI 视觉定制 |
| `codex/` | codex | Codex 视觉定制 |
| `zcode/` | zcode | ZCode 视觉定制 |

### 适配器三件套（每个目录结构一致）

| 文件 | 用途 |
|------|------|
| `adapter.mjs` | 适配器主脚本，通过 CDP WebSocket 连接目标应用并注入 CSS。负责：协议握手、DOM 检测、注入时机选择、异常降级 |
| `tokens.css` | 14-token 主题令牌样式，定义 CSS 自定义属性（`--ag-*` 前缀）。由主题系统生成，与应用无关 |
| `cosmetic.css` | 外观样式，处理目标应用特有的 UI 微调（间距、字体覆盖、组件隐藏等）。与应用 DOM 结构强相关 |

### 共享运行时（shared/）

| 文件 | 用途 |
|------|------|
| `deep-core.mjs` | DeepCore 运行时 — Shadow DOM 穿透、Fragment 路由、上下文感知（RFC 2026-08-20） |
| `hybrid-injector.mjs` | HybridInjector — 混合注入核心（GitHub Top 5 可移植模式合并）。提供 `applyIncremental`（rAF 批量 setProperty）、`applyFullTheme`（CDP 原子全量替换）、`applyBatch`（多规则原子更新）、`hotReplace`（无闪烁热替换） |
| `hybrid-injector.test.mjs` | HybridInjector 独立验证测试（18 项，`node engines/shared/hybrid-injector.test.mjs`） |
| `adopted-sheets-manager.mjs` | 统一管理 Document.prototype.adoptedStyleSheets 的 setter 拦截，消除多 adapter 共存时的 setter 覆盖冲突 |
| `token-discovery.mjs` | 增量 CSS 变量发现引擎，替代 adapter 中的全量 stylesheet 扫描 |

### 目录总览

```
engines/
├── shared/
│   ├── deep-core.mjs               # DeepCore 运行时（Shadow DOM / Fragment / 上下文）
│   ├── hybrid-injector.mjs         # 混合注入核心（增量 + 全量 + 批量）
│   ├── hybrid-injector.test.mjs    # 独立验证测试
│   ├── adopted-sheets-manager.mjs  # adoptedStyleSheets setter 统一管理
│   └── token-discovery.mjs         # 增量 CSS 变量发现引擎
├── traework/
│   ├── adapter.mjs      # traework CDP 注入器
│   ├── tokens.css        # 14-token 变量定义
│   └── cosmetic.css      # traework 专属外观补丁
├── qoderwork/
│   ├── adapter.mjs
│   ├── tokens.css
│   └── cosmetic.css
├── workbuddy/
│   ├── adapter.mjs
│   ├── tokens.css
│   └── cosmetic.css
├── doubao/
│   ├── adapter.mjs
│   ├── tokens.css
│   └── cosmetic.css
├── codex/
│   ├── adapter.mjs
│   ├── tokens.css
│   └── cosmetic.css
└── zcode/
    ├── adapter.mjs
    ├── tokens.css
    └── cosmetic.css
```

## 注入流程

1. `adapter.mjs` 通过 CDP WebSocket 连接到目标应用的 DevTools 端口
2. 监听 `DOMContentLoaded` 和 `load` 事件确定注入时机
3. 注入 `tokens.css`（主题变量）→ 注入 `cosmetic.css`（外观补丁）
4. 监听主题变更事件，按场景选择注入策略：
   - **增量调色**（Studio Hue Slider 实时拖拽）→ `HybridInjector.applyIncremental()` — rAF 合并后 setProperty O(1)
   - **完整主题切换**（暗→亮 / 主题 A→B）→ `HybridInjector.applyFullTheme()` — CDP 原子 setStyleSheetText

## 混合注入策略（GitHub Top 5 可移植模式）

| 场景 | 策略 | 方法 | 复杂度 |
|------|------|------|--------|
| 1 变量变更 | 增量 setProperty | `applyIncremental(tokens)` | O(1) |
| 14 变量同变 | rAF 合并 + setProperty | `applyIncremental(tokens)` → 单次 rAF | O(n/rAF) |
| 暗→亮全切 | CDP 原子全量替换 | `applyFullTheme(layerId, css)` | 单次替换 |
| 100+ 元素动态 | CSS 继承（var 级联） | 根节点 setProperty → 子元素自动继承 | O(1) |

## 约定

1. **三件套不变**：每个适配器严格保持 `adapter.mjs` + `tokens.css` + `cosmetic.css` 三文件结构，禁止增减文件类型。
2. **Token 前缀统一**：所有 CSS 自定义属性使用 `--ag-` 前缀，避免与目标应用样式冲突。
3. **Cosmetic 最小化**：`cosmetic.css` 仅包含必要的外观微调，禁止使用 `!important` 覆盖（除非目标应用已使用）。
4. **Adapter 幂等**：`adapter.mjs` 必须支持重复注入不产生副作用（标签去重、样式替换而非追加）。
5. **适配器禁令**：禁止新增适配器（不变量：除非目标应用用户基数大且无原生主题能力）。
6. **CSS 生成同步**：`tokens.css` 由 `scripts/generators/*Css.mjs` 生成，禁止手动编辑。
7. **协议兼容**：`adapter.mjs` 必须兼容 CDP Protocol v1.3+，处理 WebSocket 断连重试。
