# 竞品项目深度分析报告 — 第 7 轮

> 执行时间: 2026-08-28 13:00
> 分析范围: DSH 插件生态 + 桌面宠物 + macOS 主题控制器 + Windows 皮肤套件 + CDP SDK
> 深度分析 5 个高价值项目

---

## 一、本轮分析目标

本轮聚焦**前几轮未覆盖**的高价值项目，重点关注：
- DSH 插件聚合生态（"一切皆插件"架构）
- 桌面宠物积累型伙伴系统
- macOS 原生菜单栏主题控制器
- Windows 皮肤套件（看门狗自动恢复）
- TypeScript CDP SDK（SuperJSON 复杂类型序列化）

## 二、项目总览

| # | 项目 | Stars | License | 语言 | 最近更新 | 核心亮点 |
|---|------|-------|---------|------|---------|---------|
| 1 | zhu1090093659/dsh-web | 6,314 | Apache-2.0 | TypeScript | 2026-08-28（今日） | DSH 插件聚合生态 + 性能 HUD + 存在契约 |
| 2 | vlln/whale-girl | 293 | MIT | JavaScript | 2026-08-27（昨日） | DSH 桌面宠物 + 积累型伙伴 + 15 状态机 |
| 3 | z0rgoyok/codex-theme-controller | 4 | 无 | Swift | 2026-02-08（停滞） | macOS 菜单栏 + CDP 主题控制 + 自动发现 |
| 4 | ismoshushi/codex-skinkit | 3 | MIT | CSS | 2026-07-17（停滞） | Windows 皮肤套件 + 看门狗自动恢复 + 验证截图 |
| 5 | ntoskrnl7/electron-cdp | 2 | MIT | TypeScript | 2026-05-18 | CDP SDK + SuperJSON + 执行上下文跟踪 |

---

## 三、深度分析摘要

### 3.1 zhu1090093659/dsh-web — DSH 插件聚合生态 (6,314⭐)

**定位**: DeepSeek Harness Web GUI 的插件聚合生态包，"一切皆插件"的架构典范。

**核心架构**:
- 插件市场 (dsh-market.com) + 功能插件 + 皮肤插件 三轨分离
- 所有插件共享 `dsh web` profile，不改 DSH 核心代码
- 皮肤作为"皮肤插件"的子资产包（skin.json + 样式 + 可选图片）
- 性能 HUD 监控：事件延迟 P99、FPS/Longtask、内存与写延迟

**技术亮点**:

1. **"一切皆插件"架构** — 任务看板、移动远程、SSH 运维、图像理解、Agent 预设全部是插件。每个插件独立加载/卸载，互不影响。*AgentSkin 当前是单体引擎 + 6 适配器，可借鉴插件注册表的解耦思想。*

2. **性能 HUD + 节流治理** — 三级节流（轻/标/严），活的事件数超阈值自动告警。写延迟监控 + 自动降级 fsync。*AgentSkin 当前缺少系统级性能监控面板。*

3. **存在契约 (Presence Contract)** — 桌面伴侣运行时，页面内宠物自动隐藏（TTL 45s）；伴侣退出/崩溃后页面宠物恢复。*AgentSkin 的 InjectDock 与主窗口的关系可参考此契约设计。*

4. **皮肤插件子资产包** — 皮肤不是独立产品，而是功能插件的子资产。skin.json + 样式 + 可选图片，由功能插件统一加载。*AgentSkin 的主题包结构与这种"子资产"模式有相似之处。*

5. **移动端远程** — 同一连接 PC 浏览器可反向控制，支持 SSE 实时推送。插件自有设备优先通道。

**与 AgentSkin 对比**:

| 维度 | dsh-web | AgentSkin |
|------|---------|-----------|
| 架构 | 插件注册表 + profile 隔离 | 单体引擎 + 6 适配器 |
| 皮肤定位 | 功能插件的子资产 | 核心功能 |
| 性能监控 | HUD + 三级节流 | 无系统级面板 |
| 多端协同 | 移动远程 + SSE | 单窗口 |
| 存在契约 | 桌面伴侣 ↔ 页面宠物 | 无 |

**可借鉴点（按可行性排序）**:

1. ⭐⭐⭐ **性能 HUD** — 在 Diagnostics 页添加 CDP 事件延迟、注入耗时、内存占用监控
2. ⭐⭐⭐ **插件注册表思想** — 将适配器抽象为可插拔插件，降低耦合
3. ⭐⭐ **存在契约** — InjectDock 与主窗口的显式生命周期契约
4. ⭐ **SSE 实时推送** — 替代部分轮询场景

---

### 3.2 vlln/whale-girl — DSH 桌面宠物 (293⭐)

**定位**: DSH Web GUI 的桌面宠物插件（QQ 宠物形态），右下角悬浮、可拖拽/投喂/玩耍的积累型伙伴。

**核心架构**:
- 15 状态完整状态机（idle/working/celebrate/error/disappointed/joy/eat/play/drag/walk/sleep/wake/welcome/think/wait）
- XP/头衔积累系统：完成任务、会话、陪伴时间积累到 seniority levels
- 非均匀动画节奏数据驱动（frameMs 逐帧停留时长）
- 独立桌面伴侣应用（Tauri v2 + Rust，零运行时依赖）

**技术亮点**:

1. **积累型伙伴系统** — 完成任务/升级/头衔/记忆全部持久化。不是简单的动画循环，而是有"成长"的长期陪伴。*AgentSkin 的 InjectDock 可借鉴此积累系统，让主题切换/使用时长有"成长感"。*

2. **15 状态优先级状态机** — 每个状态有明确的优先级和转换规则。working 插曲不被 refresh 轮询重排（armWorking 待触发守卫）。*AgentSkin 的 bootProgress 状态机可参考此设计。*

3. **非均匀动画节奏** — frameMs 逐帧停留时长数据驱动（如 wake [1000,200]），非均匀节奏更自然。*AgentSkin 的启动动画可参考此非均匀节奏设计。*

4. **存在契约实现** — 桌面伴侣运行时页面内宠物隐藏，伴侣退出后 45s TTL 恢复。*AgentSkin 的 Dock 与主窗口关系可参考。*

5. **独立桌面伴侣** — Tauri v2 构建的独立应用，通过公开 API 与插件通信，不修改插件代码。

**与 AgentSkin 对比**:

| 维度 | whale-girl | AgentSkin |
|------|-----------|-----------|
| 伙伴系统 | 积累型 15 状态机 | 无 |
| 动画系统 | 非均匀帧停留数据驱动 | 固定时序 |
| 持久化 | XP/头衔/记忆 | 无 |
| 多端 | 页面内 + 独立桌面伴侣 | 仅主窗口 |

**可借鉴点**:

1. ⭐⭐⭐ **积累型伙伴系统** — InjectDock 可加入使用时长/主题切换次数的积累机制
2. ⭐⭐⭐ **非均匀动画节奏** — 启动动画进度与真实耗时挂钩
3. ⭐⭐ **状态优先级守卫** — bootProgress 状态机增加"进行中不被打断"守卫
4. ⭐ **独立桌面伴侣** — 可选的 Tauri 常驻伴侣应用

---

### 3.3 z0rgoyok/codex-theme-controller — macOS 菜单栏主题控制器 (4⭐)

**定位**: 原生 macOS SwiftUI 应用，通过 CDP 管理运行中 Codex 实例的主题。

**核心架构**:
- 扫描运行中的 Codex 实例（PID、命令、--remote-debugging-port）
- 菜单栏图标 + 独立控制器窗口
- 5 套内置主题（Darcula/Nord/Monokai/Teal/LM Studio）
- 选择主题立即应用到所有可注入实例
- "Apply to All" 批量应用
- 启动新实例时自动应用上次选中主题

**技术亮点**:

1. **原生菜单栏集成** — macOS 原生 SwiftUI 菜单栏图标，轻量无干扰。*AgentSkin 是 Electron 单体应用，可借鉴菜单栏模式作为轻量控制入口。*

2. **自动发现运行实例** — 自动扫描 PID 和调试端口，无需手动配置。*AgentSkin 已有类似能力（port-resolver.ts），但可增强自动发现 UX。*

3. **CSS 变量覆盖策略** — 不针对单个元素，而是覆盖 ~120 个 CSS 自定义属性（--color-token-*、--color-background-* 等）。*这与 AgentSkin 的 14-token 契约异曲同工，但更全面。*

4. **主题持久化** — 上次选择主题在下次启动时恢复。

**与 AgentSkin 对比**:

| 维度 | codex-theme-controller | AgentSkin |
|------|----------------------|-----------|
| 定位 | macOS 轻量菜单栏工具 | 完整 Electron 产品 |
| 主题应用 | CSS 变量覆盖（~120 个） | 14-token 契约 |
| 实例发现 | 自动扫描 PID + 端口 | port-resolver |
| 批量应用 | Apply to All | 单 Agent 逐一应用 |

**可借鉴点**:

1. ⭐⭐ **CSS 变量覆盖策略** — 可补充 AgentSkin 的 14-token 未覆盖的 CSS 变量
2. ⭐⭐ **菜单栏轻量入口** — 作为 Electron 主窗口的补充控制通道
3. ⭐ **自动发现增强** — 优化运行中实例的自动发现 UX

---

### 3.4 ismoshushi/codex-skinkit — Windows 皮肤套件 (3⭐)

**定位**: Windows 专属 Codex 皮肤管理器，5 套内置主题 + 自定义图片主题 + 看门狗自动恢复。

**核心架构**:
- 5 套内置主题（World Cup Night/Deep Space/Ember Bloom/Aurora Veil + 默认）
- 看门狗自动恢复：安装主题后 watchdog 监控进程，连续失败后暂停恢复
- 自定义图片上传（PNG/JPEG/WebP），自动压缩至 1600x1000/5MB 以内
- 主题配置存储在 IndexedDB，不上传网络
- 验证截图：生成 pass:true 的验证截图

**技术亮点**:

1. **看门狗自动恢复** — 安装主题后持续监控进程路径、命令、启动时间。连续失败后暂停恢复。*AgentSkin 缺少此防御性机制——目标应用更新后适配器失效时无自动恢复。*

2. **主题验证截图** — 生成 pass:true 的验证截图，可视化确认主题状态。*AgentSkin 的 Diagnostics 可借鉴此可视化验证。*

3. **IndexedDB 本地存储** — 主题配置和图片全部本地存储，不上传网络。*AgentSkin 已有类似本地优先策略。*

4. **MSIX 安装包不修改** — 不修改官方安装包、签名或 app.asar。CDP 只监听 127.0.0.1。

**与 AgentSkin 对比**:

| 维度 | codex-skinkit | AgentSkin |
|------|--------------|-----------|
| 平台 | Windows 专属 | 跨平台 |
| 看门狗 | 自动恢复 + 连续失败暂停 | 无 |
| 验证 | 可视化验证截图 | Diagnostics 面板 |
| 存储 | IndexedDB | 文件系统 |

**可借鉴点**:

1. ⭐⭐⭐ **看门狗自动恢复** — 目标应用更新后自动检测适配器失效并尝试恢复
2. ⭐⭐ **验证截图** — Diagnostics 页添加主题验证截图功能
3. ⭐ **连续失败暂停** — 适配器连续失败 N 次后自动暂停，避免无限重试

---

### 3.5 ntoskrnl7/electron-cdp — TypeScript CDP SDK (2⭐)

**定位**: 简化 Electron 中 CDP 使用的 TypeScript 库，提供直观的 API 和复杂类型序列化。

**核心架构**:
- Session / MainSession 两类会话
- SuperJSON 集成（Date/Map/Set/Error/Buffer 自动序列化）
- 执行上下文跟踪（execution-context-created/destroyed/cleared）
- 自动目标附着（iframe/worker/service_worker/shared_worker）
- 函数暴露（exposeFunction）支持 retry/timeout/withReturn

**技术亮点**:

1. **SuperJSON 集成** — Date/Map/Set/Error/Buffer 等复杂类型自动序列化，无需手动转换。*AgentSkin 当前 CDP 通信中复杂类型需手动序列化，可借鉴。*

2. **执行上下文跟踪** — 实时监控浏览器执行上下文创建/销毁，对调试注入时机极有价值。*AgentSkin 的注入编排层可参考此上下文跟踪。*

3. **自动目标附着** — 自动发现并附着 iframe/worker，无需手动管理。*AgentSkin 的 DeepCore 引擎处理 Shadow DOM，可参考此自动附着模式。*

4. **函数暴露 + retry** — exposeFunction 支持 retry/timeout/withReturn，简化 Node→Browser 函数注入。

**与 AgentSkin 对比**:

| 维度 | electron-cdp | AgentSkin |
|------|-------------|-----------|
| 定位 | CDP SDK 库 | 完整产品 |
| 序列化 | SuperJSON 自动 | 手动 |
| 上下文跟踪 | 实时监控 | 无 |
| 目标附着 | 自动 iframe/worker | DeepCore 手动 |

**可借鉴点**:

1. ⭐⭐⭐ **SuperJSON 序列化** — CDP 通信中复杂类型自动序列化
2. ⭐⭐ **执行上下文跟踪** — 注入编排层增加上下文生命周期监控
3. ⭐⭐ **自动目标附着** — 简化 iframe/Shadow DOM 目标管理
4. ⭐ **函数暴露 + retry** — 简化 Node→Browser 函数注入

---

## 四、跨项目趋势总结

### 趋势 1：插件化架构成为主流
dsh-web 的"一切皆插件"架构证明：功能可扩展性的关键是插件注册表 + profile 隔离。AgentSkin 的 6 适配器虽非插件，但可借鉴注册表的解耦思想。

### 趋势 2：积累型伙伴系统提升粘性
whale-girl 的 XP/头衔/记忆系统让桌面宠物从"动画循环"进化为"长期陪伴"。AgentSkin 的 InjectDock 可加入使用积累机制。

### 趋势 3：看门狗自动恢复保障可靠性
codex-skinkit 的看门狗机制解决了"目标应用更新后适配器失效"的痛点。AgentSkin 当前缺少此防御性机制。

### 趋势 4：性能 HUD 成为标配
dsh-web 的三级节流性能 HUD 是系统级可观测性的标配。AgentSkin 的 Diagnostics 可补充类似面板。

### 趋势 5：SuperJSON 解决 CDP 序列化痛点
electron-cdp 的 SuperJSON 集成解决了 CDP 通信中复杂类型的序列化问题。AgentSkin 可借鉴。

---

## 五、推荐落地方案

### 方案 A：性能 HUD + 执行上下文跟踪（高可行性）

**目标**: 在 Diagnostics 页添加 CDP 性能监控面板

**改动范围**:
- `src/ui/pages/diagnostics-page.tsx` — 新增性能 HUD 组件
- `src/shared/cdp/` — 新增 performance-tracker.ts
- `tests/` — 新增 10-15 测试

**预期收益**: 系统级可观测性，P99 延迟/注入耗时/内存占用可视化

### 方案 B：看门狗自动恢复机制（高可行性）

**目标**: 目标应用更新后自动检测适配器失效并尝试恢复

**改动范围**:
- `src/main/services/` — 新增 adapter-watchdog.ts
- `src/shared/types/` — 新增 watchdog 类型
- `tests/` — 新增 8-10 测试

**预期收益**: 减少手动干预，提升适配器鲁棒性

### 方案 C：SuperJSON CDP 序列化（中可行性）

**目标**: CDP 通信中复杂类型自动序列化

**改动范围**:
- `src/shared/cdp/` — 引入 SuperJSON 或自研轻量实现
- `tests/` — 新增 5-8 测试

**预期收益**: 消除手动序列化样板代码

### 方案 D：积累型 InjectDock（中可行性）

**目标**: InjectDock 加入使用时长/主题切换次数的积累机制

**改动范围**:
- `src/ui/components/` — InjectDock 组件增强
- `src/stores/` — 新增 accumulation store
- `tests/` — 新增 5-8 测试

**预期收益**: 提升用户粘性和回访率

---

## 六、重大更新标记

| 项目 | 状态 | 说明 |
|------|------|------|
| zhu1090093659/dsh-web | ⚠️ 爆发式增长 | 从 922→6,314 stars（+5,392），已成为 DSH 生态最大插件包 |
| vlln/whale-girl | ⚠️ 活跃开发中 | 293 stars，昨日仍有提交，15 状态机持续完善 |
| z0rgoyok/codex-theme-controller | ❌ 已停滞 | 2026-02-08 后无更新，190 天停滞 |
| ismoshushi/codex-skinkit | ❌ 已停滞 | 2026-07-17 后无更新，42 天停滞 |
| ntoskrnl7/electron-cdp | ⚠️ 低活跃 | 2026-05-18 后无更新，102 天停滞 |

---

## 七、下一步建议

1. **立即执行**: 方案 A（性能 HUD）+ 方案 B（看门狗自动恢复）— 高可行性，直接提升 AgentSkin 可靠性
2. **中期规划**: 方案 C（SuperJSON）— 需评估引入新依赖的复杂度
3. **长期探索**: 方案 D（积累型 Dock）— 需用户调研验证需求强度
4. **持续关注**: dsh-web 和 whale-girl 的后续演进，特别是插件注册表和积累系统的完善
