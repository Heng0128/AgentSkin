# AgentSkin UI 改版设计（阶段 4.2.8.3）

> 持续更新的方案。**v2** 将 P2 从"Agent 控制台升级"升级为真正的**产品模型重设计**：主要对象从 **Agent** 变为 **环境（Environment）**。

## 0. 产品定位（修订后）

AgentSkin **不是**管理 TRAE / Qoder / WorkBuddy 的工具，它管理的是开发者的 **AI 工作环境**。

- Agent + 皮肤（主题）+ 状态 + 偏好绑定为一个 **环境人设（Environment persona）**。
- 一个有名称的环境（前端工作 / 后端工作 / AI 研究）就是"皮肤"的含义：一个 AI agent 的完整工作环境皮肤。
- 统一的产品语言树：
  `Workspace → { Environments, Skins, Agents }`

## 1. 信息架构

```
Workspace            (首页 —— 当前环境 + 最近活动)
 ├ Environments      (AI 环境中心：当前环境、环境卡片、切换器)
 ├ Skins             (P3：原"主题库" → 皮肤工作室)
 └ Agents            (底层 agent 发现/状态，只读，弱化展示)
Settings
```

"Agents" 仍是底层注册/发现层，但用户面对的首要概念是 **Environments**。移除管理表格的观感。

## 2. P2 —— AI 环境中心（分阶段）

### P2.1 —— 渲染层概念验证（不涉及主进程改动）
- 新增 UI 类型：`src/ui/types/environment.ts` → `EnvironmentModel` v1。
- 新增 hook：`src/ui/hooks/useEnvironments.ts`，基于 **mock 数据**。
- 新页面：`EnvironmentsPage`，由以下部分组成：
  - `EnvironmentHero` —— 当前环境（名称、agent + 皮肤、上次使用）
  - `EnvironmentCard` —— 一个已保存的环境
  - `AgentSwitcher` —— 切换当前环境
  - `EnvironmentTimeline` —— 最近使用记录
  - `QuickEnvironmentActions` —— 应用 / 恢复 / 自定义
- 导航：将 "Agents" 改为 "Environments"。
- 目标：验证页面结构、卡片设计、用户心智模型。主进程不涉及。

### P2.5 —— 确认模型
`EnvironmentModel v1 = { id, name, agentId, themeId, themeName?, lastUsed?, status }`。
（推迟 v2 扩展项：工作区路径、字体、设置、提示词配置。）

### P2.6 —— 升级为基础能力
- 新增 `src/main/environment-service.ts`（userData/ 下的 JSON 存储）。
- IPC：`environment:list | create | update | delete`。
- `useEnvironments` 将 mock 替换为真实服务。此时涉及主进程（可接受，范围受控；不影响 Runtime / Adapter / Core / 主题引擎）。

## 3. EnvironmentModel（v1）

```ts
export type EnvironmentStatus = 'active' | 'idle';

export interface EnvironmentModel {
  id: string;
  name: string;
  agentId: AgentId;
  themeId: string;
  themeName: string;   // 仅用于展示，mock 阶段的便利字段
  lastUsed?: string;   // ISO；undefined = 从未激活
  status: EnvironmentStatus;
}
```

## 4. 组件树（P2.1）

```
EnvironmentsPage
 ├ EnvironmentHero         (当前环境)
 ├ QuickEnvironmentActions (应用 / 恢复 / 自定义)
 ├ EnvironmentCard × N     (已保存环境网格)
 ├ AgentSwitcher           (切换当前环境)
 └ EnvironmentTimeline      (最近使用)
```

## 5. 设计令牌

与 v1 保持一致 —— `src/ui/design` 中的设计系统已支持该方案（默认深色、surface/hover/transition 工具类复用）。

## 6. P3 —— 皮肤工作室（P2 之后）

主题库 → **皮肤工作室**：主题重构为绑定到环境的皮肤。产品语言：导航中用 `Skins` 替代 `Themes`。

## 7. 迁移状态

- P1 ✅ Home→Workspace 重命名（仅渲染层，`npm run check` 通过）。
- P2.1 🔄 环境概念（仅渲染层，mock 数据）—— 当前阶段。
- P2.5 ⏳ 确认 EnvironmentModel v1。
- P2.6 ⏳ environment-service + IPC（推迟到模型稳定后）。
- P3  ⏳ 皮肤工作室（P2 之后）。
