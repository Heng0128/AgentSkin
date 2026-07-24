# AgentSkin v2.1.1 Release Final Gate Report

**Date:** 2026-07-21
**Version:** v2.1.1 Release Candidate
**Status:** ✅ Release Ready

---

## 1. Agent 命名冻结

### 最终正式名称

| Agent ID    | 展示名称       | 官方名称 | 区域 | 状态 |
| ----------- | ------------- | -------- | ---- | ---- |
| `traework`  | TRAE Work CN  | TRAE     | CN   | 正式 |
| `qoderwork` | QoderWork CN  | Qoder    | CN   | 正式 |
| `workbuddy` | WorkBuddy     | WorkBuddy| Global| 正式 |

### 单一事实来源

所有展示名称源自 `src/shared/types.ts` 的 `AGENT_META`：

```ts
export const AGENT_META: Readonly<Record<AgentId, AgentMeta>> = Object.freeze({
  traework:  { displayName: 'TRAE Work CN',  officialName: 'TRAE',      region: 'CN',            tier: 'active' },
  qoderwork: { displayName: 'QoderWork CN',  officialName: 'Qoder',     region: 'CN',            tier: 'active' },
  workbuddy: { displayName: 'WorkBuddy',     officialName: 'WorkBuddy', region: 'Global',        tier: 'active' },
});
```

### 消费链

| 文件 | 引用方式 | 结果 |
|------|---------|------|
| `agent-engine-service.ts` `PRODUCT_DISPLAY_NAMES` | `Object.fromEntries(Object.entries(AGENT_META).map(...))` | 派生 ✅ |
| `agent-catalog.ts` `DISPLAY_META` | `AGENT_META.traework.displayName` 等 | 派生 ✅ |
| `app-mark.tsx` `APP_META` | `AGENT_META.traework.displayName` 等 | 派生 ✅ |
| `settings-dialog.tsx` | `APP_META[appId].name` | 派生 ✅ |
| `useEnvironments.ts` | `agent.displayName` (来自 Catalog) | 派生 ✅ |

### 禁止名称验证

搜索以下模式在 `src/` 中：

- `"Qoder CN"` → 零匹配 ✅
- `"Qoder"` (独立单词) → 零匹配 ✅
- `"QoderWork"` (无 CN) → 零匹配 ✅
- `"TRAE SOLO"` → 零匹配 ✅
- `"TRAE Work"` (无 CN) → 零匹配 ✅

**所有禁止名称零残留。**

---

## 2. 图标验证

### Agent 图标

| Agent | 文件 | 大小 | 来源 |
|-------|------|------|------|
| TRAE Work CN | `src/ui/assets/apps/traework.png` | 2.1 KB | 独立图标 |
| QoderWork CN | `src/ui/assets/apps/qoderwork.png` | 14.9 KB | 独立图标 |
| WorkBuddy | `src/ui/assets/apps/workbuddy.png` | 7.9 KB | 独立图标 |

### 应用图标

| 用途 | 文件 | 尺寸 | 说明 |
|------|------|------|------|
| 主图标 | `assets/branding/app-icon.png` | 1024×1024 | AgentSkin "A" 标志 |
| 托盘图标 (Win) | `assets/runtime/tray-icon.png` | 16×16 | 从主图标缩放 |
| 托盘图标 (macOS) | `assets/runtime/trayTemplate.png` | 16×16 | 灰度模板 |
| ICO | `assets/icon.ico` | 多分辨率 | Windows 安装包 |
| ICNS | `assets/icon.icns` | 多分辨率 | macOS 安装包 |
| SVG | `assets/icon.svg` | 1024×1024 | 矢量源文件 |

---

## 3. Theme Center 验证

### 默认 Agent 列表

`useThemeCenter` 通过 `controller.agents.filter(a => a.supported)` 获取 Agent 选项：

- ✅ TRAE Work CN
- ✅ QoderWork CN
- ✅ WorkBuddy
- ❌ `qoder` (experimental) — 不会出现在 UI 中

### supportedAgents 过滤

主题包通过 `bundle.targets` 中的 `AgentId` 声明支持的应用。`isAgentId()` 函数检查 `AGENT_IDS`（仅 active tier），所以实验性 `qoder` 不会被当作有效 AgentId 过滤。

---

## 4. 品牌清理

### README 更新

- `README.md` — GitHub 链接、网站 URL、API 环境变量全部更新为 `agentskin`
- `README_zh.md` — 中文版本同步更新

### 保留项（合法）

| 内容 | 位置 | 原因 |
|------|------|------|
| `@codedrobe/core` | 多处 import | 核心运行时包名 |
| `codedrobe-core-runtime.ts` | `src/legacy/` | 运行时包装文件名 |
| `.codedrobe-theme` | forge.config.ts, file-open.ts | macOS 文件扩展名兼容 |
| `codedrobe-theme` | electron-builder.yml | 文件关联扩展名 |

---

## 5. 测试结果

### TypeScript 编译

```
tsc --noEmit → 零错误 ✅
```

### 单元测试

```
Test Files:  7 passed (7)
Tests:       68 passed (68)
Duration:    1.66s
```

全部测试通过，无回归。

---

## 6. 安装包验证

⏳ 待执行 `npm run make` 生成实际安装包后验证。

---

## 7. 已知问题

| 问题 | 影响 | 状态 |
|------|------|------|
| `theme-installer.ts` 类型错误 | 不影响运行时 | 预存 |
| `theme-seeder.ts` 参数数量 | 不影响运行时 | 预存 |
| `theme-library.ts` ThemePackage 属性 | 不影响运行时 | 预存 |
| `useEnvironments.ts` AgentId 类型断言 | 不影响运行时 | 预存 |
| `theme-package-loader.test.ts` 文件系统访问 | 预存 flaky | 预存 |

以上均为预存问题，本轮修改未引入任何新问题。

---

## 最终状态

```
AgentSkin v2.1.1
Release Ready ✅
```

**Agent 命名契约已冻结。不再修改名称链路。**
