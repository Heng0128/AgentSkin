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

### 目录总览

```
engines/
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
4. 监听_theme 变更事件，动态替换 CSS 内容

## 约定

1. **三件套不变**：每个适配器严格保持 `adapter.mjs` + `tokens.css` + `cosmetic.css` 三文件结构，禁止增减文件类型。
2. **Token 前缀统一**：所有 CSS 自定义属性使用 `--ag-` 前缀，避免与目标应用样式冲突。
3. **Cosmetic 最小化**：`cosmetic.css` 仅包含必要的外观微调，禁止使用 `!important` 覆盖（除非目标应用已使用）。
4. **Adapter 幂等**：`adapter.mjs` 必须支持重复注入不产生副作用（标签去重、样式替换而非追加）。
5. **适配器禁令**：禁止新增适配器（不变量：除非目标应用用户基数大且无原生主题能力）。
6. **CSS 生成同步**：`tokens.css` 由 `scripts/generators/*Css.mjs` 生成，禁止手动编辑。
7. **协议兼容**：`adapter.mjs` 必须兼容 CDP Protocol v1.3+，处理 WebSocket 断连重试。
