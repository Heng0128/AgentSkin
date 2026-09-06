# RFC: Skills 工作流页面（引擎更新）

## 状态
DRAFT — 待评审

## 背景
AgentSkin 的 6 个适配器（traework/qoderwork/workbuddy/doubao/codex/zcode）需要随目标应用更新而持续维护。当前已有以下基础设施：

- `engines/*/adapter.mjs` — 各适配器的 CSS 选择器和注入逻辑
- `selector-candidate-scorer.ts` — 选择器候选评分系统
- `health-monitor.ts` — 运行时 CSS 变量漂移检测
- `baseline-css-capture.ts` — 基准 CSS 状态捕获
- `injection-state-machine.ts` — 10 状态注入生命周期

问题：现有诊断能力分散在 SettingsPage 的面板中，缺少一个集中式的"引擎更新工作流"界面，让用户/维护者能：
1. 一目了然看到哪些适配器的选择器已漂移
2. 触发 probe → diff → regenerate → apply → verify 的完整流水线
3. 回滚失败的更新

## 提案
新增第 7 个顶级页面 `skills`（路由名），作为引擎更新的 Skill 化工作流入口。

### 页面结构

```
SkillsPage
├── AgentSelector（左侧 rail：6 个适配器 + 状态指示灯）
├── WorkflowPanel（中央工作区）
│   ├── StepIndicator（5 步进度：Probe → Diff → Generate → Apply → Verify）
│   ├── ActionBar（Probe / Apply / Rollback 按钮）
│   └── OutputConsole（日志输出 + diff 展示）
└── StatusSidebar（右侧：当前选择器健康度 + 基线对比）
```

### 工作流步骤

| 步骤 | 触发动作 | 底层调用 |
|------|---------|---------|
| Probe | 用户点击"探测" | CDP 读取实时 DOM，提取关键节点 |
| Diff | Probe 完成后自动 | 对比 baseline 与当前 DOM，标记增减的选择器 |
| Generate | Diff 有变化时可用 | 选择器评分系统推荐新选择器，生成新 CSS |
| Apply | 用户确认后 | 状态机驱动注入，先快照后注入 |
| Verify | Apply 后自动 | 读取 computed style + 截图对比 |

### 回滚机制
每次 Apply 前自动快照 injected stylesheets，Verify 失败时自动回滚到快照。

## 修改范围

| 文件 | 变更 |
|------|------|
| `src/ui/types/navigation.ts` | Route 新增 `'skills'` |
| `src/ui/App.tsx` | 路由分支 + lazy import |
| `src/ui/components/sidebar.tsx` | 新增导航图标 |
| `src/ui/stores/skillsStore.ts` | 新 Store（workflow 状态 + actions） |
| `src/ui/pages/SkillsPage.tsx` | 新页面 |
| `src/ui/components/skills/` | 工作流子组件 |
| `src/i18n/messages.ts` | 新增翻译 key |

## 风险评估
- 低：不改动注入引擎核心逻辑，仅新增 UI 层
- 中：新 Store 需与现有 diagnostics/selectorStore 通信

## 依赖
无新增运行时依赖，复用现有 lucide-react 图标。
