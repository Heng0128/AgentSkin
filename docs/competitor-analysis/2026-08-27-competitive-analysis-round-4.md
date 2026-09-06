# 竞品深度分析报告（第 4 轮）

> 执行日期：2026-08-27 08:00
> 分析范围：5 个竞品项目（CodeDrobe/core, tluyben/electron-inject, ntoskrnl7/electron-cdp, xxxhh336/dream-work-theme, cdredfox/workbuddy-skin-studio）

---

## 一、CodeDrobe/core — 统一换肤运行时

### 1.1 基本信息

| 维度 | 数据 |
|------|------|
| Stars | 9 |
| Forks | 2 |
| License | Apache-2.0 |
| 语言 | JavaScript |
| 创建日期 | 2026-07-16 |
| 最近更新 | 2026-08-05 |
| 最新版本 | v0.7.0-beta.0 (2026-07-21) |

### 1.2 技术架构

CodeDrobe 是一个**多应用换肤 CLI 和运行时**，核心设计：

- **包名**: `@codedrobe/core`
- **架构**: CLI → 适配器 → CDP 注入 → 验证 → 回滚
- **支持应用**: codex, workbuddy, qoderwork, traework（4 个适配器）
- **主题包格式**: `.codedrobe-theme`（含 manifest + CSS + 图片资源）

### 1.3 核心亮点

#### 1.3.1 Landmark 验证机制（⭐⭐⭐⭐⭐ 高价值）

CodeDrobe 的 landmark 验证是其最核心的创新：

```json
{
  "targets": {
    "workbuddy": {
      "css": "workbuddy.css",
      "verification": {
        "required": [
          { "name": "chat-surface", "any": [".chat-container", ".wb-cb-chat"] }
        ],
        "recommended": [
          { "name": "conversation-list", "any": [".conversation-list"] }
        ],
        "contexts": [
          {
            "name": "active-chat",
            "when": { "any": [".chat-route"] },
            "required": [
              { "name": "message-list", "any": [".message-list"] }
            ]
          }
        ]
      }
    }
  }
}
```

**设计精髓**：
- `required` — 必须存在的 DOM 锚点，缺失则阻止注入
- `recommended` — 推荐存在的锚点，缺失仅警告
- `contexts` — 路由上下文，只在特定页面激活时检查
- 二级窗口（弹出聊天）缺失 required 时被标记为 skipped，不阻塞整体注入

#### 1.3.2 DOM Snapshot API

```bash
codedrobe dom snapshot --app codex --output /absolute/codex-dom.json
```

- 只读 DOM + computed-style 快照
- 记录元素关系、语义类、稳定选择器候选、边界框、主题相关 computed styles
- 排除文本内容、表单值、可访问名称、query/hash 数据、链接、媒体源
- 默认只包含可见元素

#### 1.3.3 应用发现机制

- macOS: 扫描默认路径
- Windows: 通过安装程序注册表卸载项发现
- 支持 `--app-path` 显式覆盖
- 端口冲突时自动选择空闲端口

#### 1.3.4 热重载与重启策略

- Codex 热重载外观设置，切换主题无需重启
- 应用未以 CDP 调试标志启动时返回 `CODEDROBE_RESTART_REQUIRED`
- 只有显式 `--restart-existing` 才重启运行中的应用

### 1.4 与 AgentSkin 对比

| 维度 | CodeDrobe | AgentSkin |
|------|-----------|-----------|
| 适配器数量 | 4 | 6 |
| 验证机制 | Landmark 三级验证 | 无系统验证 |
| 主题格式 | .codedrobe-theme 包 | 14-token manifest + CSS |
| 应用发现 | 注册表 + 默认路径 | 多策略探测 |
| DOM 快照 | 有（AI 辅助主题创作） | 无 |

### 1.5 可借鉴点

1. **Landmark 验证机制** — 移植到 AgentSkin 的注入后验证阶段，确保 CSS 注入成功
2. **DOM Snapshot API** — 为主题创作提供只读 DOM 分析能力
3. **应用发现注册表查询** — 增强 Windows 平台应用发现能力

---

## 二、tluyben/electron-inject — CDP REPL 经典范本

### 2.1 基本信息

| 维度 | 数据 |
|------|------|
| Stars | 0 |
| Forks | 0 |
| License | 无 |
| 语言 | JavaScript |
| 创建日期 | 2025-03-15 |
| 最后更新 | 2025-03-15（已停滞） |

### 2.2 技术架构

一个**交互式 CDP REPL**，允许向运行中的 Electron 应用注入 JavaScript：

- 连接 `--remote-debugging-port=9222` 启动的应用
- 提供交互式 REPL + REST API + 脚本文件执行
- 支持命令历史（上下箭头）

### 2.3 核心亮点

#### 2.3.1 REST API 设计

```
POST /execute
Content-Type: application/json
{
  "code": "document.title = 'New Title'; return document.title;"
}
```

#### 2.3.2 脚本文件执行

```bash
node server.js --script ./my-script.js
```

### 2.4 与 AgentSkin 对比

| 维度 | electron-inject | AgentSkin |
|------|-----------------|-----------|
| 定位 | 调试 REPL | 生产注入引擎 |
| 使用场景 | 开发调试 | 终端用户 |
| 持久化 | 无 | 有 |

### 2.5 可借鉴点

1. **REST API 设计模式** — 可为 AgentSkin Studio 提供远程调试接口
2. **脚本文件热加载** — 开发阶段快速迭代注入脚本

### 2.6 风险评估

⚠️ 项目已停滞（最后更新 2025-03-15），无许可证，仅作参考。

---

## 三、ntoskrnl7/electron-cdp — CDP TypeScript SDK

### 3.1 基本信息

| 维度 | 数据 |
|------|------|
| Stars | 2 |
| Forks | 0 |
| License | MIT |
| 语言 | TypeScript |
| 创建日期 | 2024-08-03 |
| 最后更新 | 2026-05-18 |
| 最新版本 | v0.4.9 |

### 3.2 技术架构

一个**简化 Electron 中 CDP 使用的 TypeScript 库**：

- `MainSession` / `Session` 抽象
- SuperJSON 序列化（Date, Map, Set, Error, Buffer 等）
- 执行上下文跟踪
- 自动附加到 iframe/worker
- 类型安全的事件系统

### 3.3 核心亮点

#### 3.3.1 SuperJSON 序列化

```ts
const data = await session.evaluate((userData: { name: string; createdAt: Date }) => {
  return {
    ...userData,
    processedAt: new Date()
  };
}, { name: 'John', createdAt: new Date() });
```

支持复杂数据类型自动序列化，无需手动 JSON.stringify/parse。

#### 3.3.2 执行上下文跟踪

```ts
const contexts = session.executionContexts;
const context = contexts.get(contextId);
const result = await context.evaluate(() => {
  return window.location.href;
});
```

#### 3.3.3 自动 Target 附加

```ts
await session.setup({
  autoAttachToRelatedTargets: ['iframe', 'worker', 'service_worker']
});
```

### 3.4 与 AgentSkin 对比

| 维度 | electron-cdp | AgentSkin |
|------|--------------|-----------|
| 定位 | CDP SDK 底层库 | 完整注入引擎 |
| 序列化 | SuperJSON | 手动 JSON |
| 类型安全 | 完整 TypeScript | 部分 |

### 3.5 可借鉴点

1. **SuperJSON 序列化** — 简化 CDP 通信中的复杂数据传输
2. **执行上下文跟踪** — 更好地管理多 iframe/worker 场景
3. **Session 抽象** — 可参考其 Session/MainSession 分层设计

---

## 四、xxxhh336/dream-work-theme — 跨平台主题切换器

### 4.1 基本信息

| 维度 | 数据 |
|------|------|
| Stars | 7 |
| Forks | 2 |
| License | Apache-2.0 |
| 语言 | TypeScript |
| 创建日期 | 2026-08-05 |
| 最近更新 | 2026-08-26（非常活跃） |
| 最新版本 | v1.2.6 (2026-08-26) |

### 4.2 技术架构

**面向 Electron Work 类应用的主题管理器**：

- 支持 400+ 内置主题
- 支持 18+ 应用（WorkBuddy, TRAE Work, QoderWork, CatPaw, ZCode, 豆包等）
- 右下角浮动菜单
- 守护器自动恢复主题
- 使用频率排序

### 4.3 核心亮点

#### 4.3.1 守护器自动恢复机制（⭐⭐⭐⭐⭐ 高价值）

```
"HanaAgent 启动期间可能重建 renderer。Dream Work Theme 会等待主 renderer 稳定，并在运行期间对新建或丢失主题的 renderer 自动补充注入。"
```

**设计精髓**：
- 监控 renderer 创建、导航、重载
- 页面切换后自动恢复当前主题
- 首次注入不再使用固定等待，CDP renderer 稳定确认后立即应用

#### 4.3.2 使用频率排序

```
"右下角菜单最多显示 4 个快捷预置主题，不再固定绑定某几个主题 ID。Dream Work Theme 会按当前应用中的切换次数排序，次数相同时优先最近使用的主题。"
```

- 使用频率按应用分别统计
- 同一主题在不同应用中可以有不同排序
- 使用记录保存在用户数据目录的 `theme-usage.json`

#### 4.3.3 多应用 CDP 端口管理

- 每个应用配置首选调试端口
- 端口被占用时自动顺延
- 启动前通过真实 TCP bind 检查端口
- 支持 Windows 幽灵监听状态检测

#### 4.3.4 豆包 Desktop 适配

```
"豆包是定制 Chromium 应用，实际运行文件位于 %LOCALAPPDATA%\Doubao\Application\app\Doubao.exe"
"豆包使用固定 CDP 端口 9349"
"暗色主题会重映射侧栏账号、搜索、历史对话、顶部标题、首页建议、对话内容以及输入框操作栏的 dbx / s-color 文字 token"
```

### 4.4 与 AgentSkin 对比

| 维度 | dream-work-theme | AgentSkin |
|------|------------------|-----------|
| 支持应用数 | 18+（但非我们的适配目标） | 6（严格限定） |
| 主题数量 | 400+ | 15 |
| 守护器 | 有（自动恢复） | 无 |
| 使用频率排序 | 有 | 无 |
| 豆包适配 | 有详细适配方案 | 有 |

### 4.5 可借鉴点

1. **守护器自动恢复机制** — 高优先级移植，解决 AgentSkin 页面切换后主题丢失问题
2. **使用频率排序** — 提升用户体验，让常用主题更容易访问
3. **豆包暗色主题适配方案** — 参考其 token 重映射策略

---

## 五、cdredfox/workbuddy-skin-studio — WorkBuddy 换肤工作室

### 5.1 基本信息

| 维度 | 数据 |
|------|------|
| Stars | 168 |
| Forks | 25 |
| License | MIT |
| 语言 | JavaScript |
| 创建日期 | 2026-07-16 |
| 最后更新 | 2026-07-17 |

### 5.2 技术架构

**WorkBuddy 专用换肤工具**：

- 10 个内置预设（Miku, 原神, 鸣潮, 火影, 恋与深空）
- 一张图片自动生成主题（取色）
- 右上角 🎨 菜单即时切换
- 自定义图片上传 + canvas 取色
- 深浅色自动适配

### 5.3 核心亮点

#### 5.3.1 图片自动取色

```bash
node src/cli.mjs create --image "/path/to/hero.webp" --name "My Skin"
```

- canvas 自动取色 + 压缩成 webp
- 提取主色、辅色、面板底色、文字色
- 根据 surface 明度自动切换 light/dark 模式

#### 5.3.2 极简主题格式

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

只有 schemaVersion、id、name、hero 必填，颜色和文案都可省略。

#### 5.3.3 WorkBuddy CSS 变量系统

```
"CSS override WorkBuddy 的 --cb-* 变量（--cb-bg-primary / --cb-text-primary / --cb-vscode-editor-background 等 60+ 个）实现全局换色"
```

### 5.4 与 AgentSkin 对比

| 维度 | workbuddy-skin-studio | AgentSkin |
|------|----------------------|-----------|
| 定位 | WorkBuddy 专用 | 6 应用通用 |
| 主题生成 | 图片自动取色 | 14-token 手动定义 |
| 主题格式 | 极简 4 字段 | 完整 14-token |
| 菜单 | 右上角浮动 | 无 |

### 5.5 可借鉴点

1. **图片自动取色生成主题** — 可集成到 AgentSkin Studio 降低主题创作门槛
2. **极简主题格式** — 为普通用户提供简化版主题创建流程
3. **WorkBuddy CSS 变量系统** — 参考其 `--cb-*` 变量命名和组织方式

---

## 六、综合评估与优先级排序

### 6.1 高优先级（建议立即执行）

| 排名 | 项目 | 可借鉴点 | 可行性 | 价值 |
|------|------|---------|--------|------|
| 1 | dream-work-theme | 守护器自动恢复机制 | 高 | 解决页面切换主题丢失 |
| 2 | CodeDrobe/core | Landmark 验证机制 | 高 | 注入质量保障 |
| 3 | workbuddy-skin-studio | 图片自动取色 | 中 | 降低主题创作门槛 |

### 6.2 中优先级（可规划执行）

| 排名 | 项目 | 可借鉴点 | 可行性 | 价值 |
|------|------|---------|--------|------|
| 4 | dream-work-theme | 使用频率排序 | 高 | 用户体验提升 |
| 5 | electron-cdp | SuperJSON 序列化 | 中 | 简化 CDP 通信 |
| 6 | CodeDrobe/core | DOM Snapshot API | 中 | 主题创作辅助 |

### 6.3 低优先级（仅作参考）

| 排名 | 项目 | 可借鉴点 | 可行性 | 价值 |
|------|------|---------|--------|------|
| 7 | electron-inject | REST API 设计 | 低 | 开发调试 |
| 8 | electron-cdp | 执行上下文跟踪 | 低 | 多 iframe 场景 |

---

## 七、铁律合规性确认

✅ **严格遵守铁律**：本次分析未发现任何需要新增适配器的内容。所有借鉴点均为：
- 注入质量验证机制（Landmark）
- 主题恢复机制（守护器）
- 用户体验优化（使用频率排序）
- 主题创作工具（图片取色）
- CDP 通信优化（SuperJSON）

**未涉及任何非目标应用的适配代码移植**。

---

## 八、下一步行动建议

### 8.1 立即执行（P0）

1. **移植守护器自动恢复机制**（来自 dream-work-theme）
   - 监控 renderer 创建/导航/重载
   - 页面切换后自动恢复主题
   - 首次注入使用稳定确认而非固定等待

2. **实现 Landmark 验证**（来自 CodeDrobe/core）
   - 为每个适配器定义 required/recommended landmarks
   - 注入后验证 CSS 是否成功应用
   - 缺失 required landmark 时阻止注入并报告

### 8.2 规划执行（P1）

3. **图片自动取色生成主题**（来自 workbuddy-skin-studio）
   - 集成到 AgentSkin Studio
   - 上传图片 → canvas 取色 → 生成 14-token 主题

4. **使用频率排序**（来自 dream-work-theme）
   - 记录主题切换次数
   - 常用主题优先展示

### 8.3 研究参考（P2）

5. **SuperJSON 序列化**（来自 electron-cdp）
6. **DOM Snapshot API**（来自 CodeDrobe/core）

---

## 九、附录：原始数据

### 9.1 GitHub API 数据汇总

| 项目 | Stars | Forks | 语言 | 最近更新 | 许可证 |
|------|-------|-------|------|---------|--------|
| CodeDrobe/core | 9 | 2 | JavaScript | 2026-08-05 | Apache-2.0 |
| tluyben/electron-inject | 0 | 0 | JavaScript | 2025-03-15 | 无 |
| ntoskrnl7/electron-cdp | 2 | 0 | TypeScript | 2026-05-18 | MIT |
| xxxhh336/dream-work-theme | 7 | 2 | TypeScript | 2026-08-26 | Apache-2.0 |
| cdredfox/workbuddy-skin-studio | 168 | 25 | JavaScript | 2026-07-17 | MIT |

### 9.2 版本发布历史

**CodeDrobe/core**:
- v0.7.0-beta.0 (2026-07-21) — Codex avatar-overlay 排除和 per-window probe/verify
- v0.6.1 (2026-07-19) — CLI 错误显示 studio 验证字段详情
- v0.6.0 (2026-07-18) — QoderWork 和 TRAE SOLO 适配器

**xxxhh336/dream-work-theme**:
- v1.2.6 (2026-08-26) — 支持 AutoClaw 主题
- v1.2.5 (2026-08-21) — 支持 MonkeyCode 主题
- nightly (2026-08-06) — Nightly Build

---

*报告生成时间：2026-08-27 08:00*
*分析员：AgentSkin 竞品研究引擎*
