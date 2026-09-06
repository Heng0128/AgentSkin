# 第 28 轮竞品深度分析报告

> 执行日期：2026-08-30 12:00 | 分析项目：5 个 | 报告格式：技术深潜 + 可借鉴评估

---

## 一、本轮分析项目总览

| 项目 | Stars | 语言 | 定位 | 最近活跃 | 与 AgentSkin 相关性 |
|------|-------|------|------|----------|---------------------|
| CodeDrobe/core | 9⭐ | JS | 多应用统一换肤运行时 + CLI | 2026-07-21 | ★★★★★ 直接竞品（同路线） |
| comeonzhj/WorkBuddy-theme-skill | 18⭐ | CSS | 跨平台桌面应用 + Agent Skill | 2026-07-18 | ★★★★☆ WorkBuddy 专项 |
| zhouwei713/WorkBuddy-Dream-Skin | 20⭐ | CSS | Windows WorkBuddy 外置换肤 | 2026-07-24 | ★★★★☆ WorkBuddy 专项 |
| jiarong0423/dream-skin-forge | 1⭐ | JS | macOS Codex 热抽换引擎 | 2026-07-25 | ★★★☆☆ Codex 专项 + 架构参考 |
| ozrwayne/WorkBuddy-Skins | 0⭐ | Rust | WorkBuddy 签名主题管理器 | 2026-07-20 | ★★★☆☆ 主题格式 + 签名验证 |

---

## 二、深度分析

### 2.1 CodeDrobe/core — 多应用统一换肤运行时

**仓库**: https://github.com/CodeDrobe/core
**版本**: v0.7.0-beta.0 (2026-07-21)
**许可证**: Apache-2.0

#### 2.1.1 架构亮点

**声明式验证系统（Landmark Verification）**

CodeDrobe 的核心创新是声明式验证系统。每个主题包通过 JSON 定义验证规则，而非硬编码验证逻辑：

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

关键设计决策：
- `required`：必须存在的 DOM 地标（缺失则阻止注入）
- `recommended`：建议存在（缺失仅警告，不阻止）
- `contexts`：路由特定上下文（仅当 `when.any` 地标可见时才检查）
- 每个渲染窗口独立判断兼容性——secondary windows 缺少 `required` 地标时降级为 `skipped`，不影响主窗口注入

**自动端口发现（DevToolsActivePort 文件读取）**

QoderWork 强制 `remote-debugging-port=0`，用户指定的端口不会绑定。CodeDrobe 的解决方案是自动读取 Chromium 的 `DevToolsActivePort` 文件获取实际端口：

```js
// Launcher: resolveDebugPort(s) read Chromium DevToolsActivePort files
// for hosts that force remote-debugging-port=0; explicit ports always win.
```

**DOM 快照用于 AI 辅助主题创作**

```bash
codedrobe dom snapshot --app codex --output /absolute/codex-dom.json
```

快照记录：
- 当前活动的 CodeDrobe 主题
- 元素关系、语义类、选定安全属性
- 带匹配数的稳定选择器候选
- 边界框、适配器地标匹配
- 主题相关的计算样式

**图片变量映射系统**

```json
{
  "images": {
    "hero": "assets/hero.webp",
    "background": "assets/background.jpg"
  }
}
```

```css
.home-hero { background-image: var(--codedrobe-image-hero); }
```

#### 2.1.2 与 AgentSkin 对比

| 维度 | CodeDrobe/core | AgentSkin |
|------|----------------|-----------|
| 适配应用 | codex, workbuddy, qoderwork, traework | 6 个（+doubao, +zcode） |
| 验证方式 | 声明式 JSON 规则 | 程序化 CDP 探测 |
| 主题格式 | `.codedrobe-theme`（声明式，不含 JS） | `.agentskin-theme`（14-token + CSS） |
| 适配器注册 | `registerAdapter()` 运行时注册 | 静态 6 适配器 |
| DOM 快照 | 内置 AI 辅助 | 无（Visual Analyzer 部分覆盖） |
| 包完整性 | 选择器 lint 警告 | check-themes 脚本 |

#### 2.1.3 可借鉴点

1. **声明式验证规则**（P0 推荐）：将当前程序化验证抽取为声明式 JSON 配置，使主题作者能自声明兼容性要求
2. **路由感知验证**：根据当前页面路由动态调整验证规则
3. **DevToolsActivePort 读取**：对 QoderWork 等强制 `port=0` 的应用实现自动端口发现
4. **选择器 lint 系统**：对主题 CSS 中的危险选择器发出警告

---

### 2.2 comeonzhj/WorkBuddy-theme-skill — 单实例守护 + 社区发布协议

**仓库**: https://github.com/comeonzhj/WorkBuddy-theme-skill
**Stars**: 18⭐ | **Forks**: 4
**版本**: 持续更新（2026-07-18 最后 push）
**许可证**: MIT

#### 2.2.1 架构亮点

**单实例守护进程 + 竞争消除**

Theme Manager 会以单实例运行，并自动接管旧版命令行换肤工具留下的主题守护进程，避免多个守护进程同时注入 CSS 导致主题来回闪烁：

```
Theme Manager 是运行时所有者，安全接管已记录的 CLI guard 后再执行 apply/reapply/restore。
```

这解决了多注入器竞态问题——AgentSkin 当前的 automation-lock 是文件级锁，而 Theme Manager 是进程级所有权转移。

**ZIP 导入安全模型**

- ZIP 导入拒绝可执行文件、远程样式、路径穿越和超限内容
- GitHub 同步固定到 HTTPS raw-content 源并逐文件校验哈希
- 主题资源必须在主题目录内，禁止远程脚本和可执行 URL
- `.gitignore` 排除真实界面截图、运行状态、日志和环境变量文件

**Agent Skill 全流程协议**

SKILL.md 定义了完整的主题开发契约：
1. 先写设计契约（light/dark 模式、语义调色板、视觉主题）
2. 通过 token 翻译参考图，不直接翻译坐标为绝对布局
3. 静态验证（validate-theme.mjs + dry-run）
4. 权限门控（注入前必须获得明确许可）
5. 应用后视觉验证（宽/窄双视口矩阵）
6. 恢复原生主题能力

#### 2.2.2 可借鉴点

1. **单实例守护进程模式**（P1 推荐）：当一个注入器已在运行时，新启动的 UI 应接管而非并行注入
2. **ZIP 导入安全验证**：对导入的主题包执行文件类型、体积、路径、CSS 作用域的完整检查
3. **社区发布协议**：SHA-256 校验 + 版本规范 + PR 检查表
4. **设计契约先行**：先写 JSON 设计契约，再写 CSS，减少返工

---

### 2.3 zhouwei713/WorkBuddy-Dream-Skin — 自动化审计系统

**仓库**: https://github.com/zhouwei713/WorkBuddy-Dream-Skin
**Stars**: 20⭐ | **Forks**: 6
**版本**: v0.7.6 (WorkBuddy 5.3.3 + Electron 37)
**许可证**: MIT

#### 2.3.1 架构亮点

**自动化审计矩阵**

覆盖 WorkBuddy 全部主要界面的自动化审计：

| 审计模块 | 覆盖范围 |
|----------|----------|
| `audit-hover` | 会话卡片、更多入口、快捷操作、活动入口、侧栏展开收起 |
| `audit-composer` | 模型按钮、工作空间、权限按钮、模型列表、说明浮层 |
| `audit-scenes` | 日常办公、代码开发、设计创意、推荐标签 |
| `audit-pages` | 新建任务、四条历史任务、助理、项目、专家、技能、连接器、自动化、用户菜单、设置 |
| `audit-details` | 专家详情、新建项目、自动化编辑器、更多菜单、腾讯文档授权 |
| `audit-settings` | 账户、系统、智能体、快捷键、记忆、模型、助理、个性化、数据、安全、帮助 |

**安全边界设计**

1. CDP 只监听 `127.0.0.1` 或 `::1`
2. 启动脚本验证监听端口归属于选定的 `WorkBuddy.exe`
3. 注入器只接受本地 `file:` 或 `vscode-file:` 页面
4. 二次检查 WorkBuddy 标题和根节点
5. 装饰层使用 `pointer-events: none`，不拦截鼠标操作
6. 恢复脚本只终止状态文件记录且命令行匹配的注入器

**三层图片结构**

- 背景图（background）：全屏底层
- 主视觉图（hero）：主区域焦点
- 角色装饰图（character）：右下角拍立得/挂件

支持 PNG/JPEG/WebP/GIF/SVG，单张上限 16MB，GIF 保持动画。

**图片自动配色分析**

分析导入图片的综合色相与明度，自动匹配绯樱少女、薄荷花房、晴日校园、鎏金夜宴或深海夜航 UI 色板与明暗模式。

#### 2.3.2 可借鉴点

1. **自动化审计矩阵**（P1 推荐）：为 6 个适配器各建立一套自动化验证脚本
2. **安全边界标准化**：CDP 端口归属验证 + 页面协议白名单 + 注入器匹配
3. **图片分层结构**：三层图片模型可作为壁纸/主题设计的参考
4. **图片→色板自动匹配**：与 AgentSkin 的 image-theme-analyzer 功能对齐

---

### 2.4 jiarong0423/dream-skin-forge — 模块化运行时修复

**仓库**: https://github.com/jiarong0423/dream-skin-forge
**Stars**: 1⭐ | **Forks**: 0
**定位**: macOS Codex 内部热抽换引擎（第二版重构）
**许可证**: MIT

#### 2.4.1 架构亮点

**模块矩阵（Module Matrix）**

```bash
node macos/scripts/module-matrix.mjs \
  --state-dir "/tmp/dream-skin-forge-matrix-state" \
  --assets-dir macos/assets \
  --format text
```

模块矩阵定义了运行时模块的所有权和 payload budget：
- 每个模块有明确的 ownership 边界
- `theme-packs-extension` 必须通过预算检查
- 运行时检测模块完整性，不完整则重送

**热抽换失败防护**

| 故障现象 | 根因 | 修复策略 |
|----------|------|----------|
| Hot-swap selector 消失 | renderer 可跳过 core apply，但没有确认 live hot-swap DOM 是否存在 | injector.mjs 检查 hot-swap bay/select 完整度，不完整就重送 core |
| Theme-pack cache 失效 | 旧 cache hash 看似一致，但 payload 不是 renderer-safe data URL | themePacks asset group 检查 schema 与 data:image/...，不安全就失效重送 |
| Sidebar row 变形 | 官方 sidebar 已有原生 icon/status gutter，旧 glyph 插入会打架 | renderer 检测 native side gutter 后让 sidebar glyph module fail closed |
| Titlebar/sidebar 接缝 | header divider 是 header 拥有，不应用 sidebar overlay 遮住 | CSS 改由 header `::after` 从 left shell width 之后开始画线 |

**Pack Validation 清单**

- manifest 完整性
- source count（素材数量）
- alpha 通道检查
- frame count（帧数）
- SVG 验证
- payload budget（payload 预算）
- manual-click-only（仅手动触发）
- cleanup gate（清理门控）

#### 2.4.2 可借鉴点

1. **模块所有权矩阵**（P2 推荐）：定义注入引擎各层的 ownership 边界，防止冲突
2. **fail-closed 设计**：当检测到原生 UI 冲突时，让主题模块静默失效而非破坏原生 UI
3. **payload budget**：对每个主题包的资源大小设置硬上限
4. **运行时完整性检查**：注入后验证 DOM 完整性，不完整则自动重试

---

### 2.5 ozrwayne/WorkBuddy-Skins — Rust 签名主题格式

**仓库**: https://github.com/ozrwayne/WorkBuddy-Skins
**Stars**: 0⭐ | **Forks**: 0
**语言**: Rust（多 crate 架构）
**许可证**: MIT

#### 2.5.1 架构亮点

**多 Crate 分层架构**

```
crates/
├── injector-core/      # 注入核心
├── manager-core/       # 管理器核心
├── platform-core/      # 平台抽象
├── theme-core/         # 主题格式
└── workbuddy-skins-cli/ # CLI 工具
```

**`.wbtheme` 签名格式**

主题包只允许：JSON、图片、元数据、许可证和签名。通过数字签名验证主题包完整性和来源。

**基于 BuddyCanvas 0.1.3 修改**

该项目的代码基础是 BuddyCanvas 0.1.3（MIT），说明社区存在代码复用和演进。

#### 2.5.2 可借鉴点

1. **主题包签名验证**：对导入的主题包执行签名验证，确保完整性和来源可信
2. **内容白名单**：主题包只允许特定文件类型（JSON、图片、元数据）
3. **Rust 核心抽象**：虽然 AgentSkin 不迁移 Rust，但其 injector-core / platform-core 的分层值得参考

---

## 三、跨项目模式总结

### 3.1 行业共识模式

通过分析 5 个项目，识别出 6 个行业共识：

| 共识 | 描述 | 代表项目 |
|------|------|----------|
| 1. 纯 CDP 注入 | 通过 loopback CDP 注入，不修改 app.asar | 全部 |
| 2. 声明式验证 | JSON 定义验证规则，非硬编码 | CodeDrobe |
| 3. 安全边界 | CDP 端口白名单 + 协议白名单 + 归属验证 | zhouwei713, comeonzhj |
| 4. 自动化审计 | 对主要界面执行自动化视觉检查 | zhouwei713 |
| 5. 单实例守护 | 防止多注入器并行导致闪烁 | comeonzhj |
| 6. 图片驱动 | 从图片自动提取配色生成主题 | zhouwei713, CodeDrobe |

### 3.2 AgentSkin 差距分析

| 能力 | AgentSkin 现状 | 竞品参考 | 优先级 |
|------|----------------|----------|--------|
| 声明式验证规则 | 程序化 CDP 探测 | CodeDrobe | P0 |
| 路由感知验证 | 无 | CodeDrobe | P0 |
| 自动化审计矩阵 | 无 | zhouwei713 | P1 |
| 单实例守护 | 文件级 automation-lock | comeonzhj | P1 |
| ZIP 导入安全验证 | 基础文件检查 | comeonzhj | P1 |
| 主题包签名 | 无 | ozrwayne | P2 |
| 模块所有权矩阵 | orchestrator 部分覆盖 | jiarong0423 | P2 |

---

## 四、实施建议

### 4.1 P0：声明式验证系统（对标 CodeDrobe）

**目标**：将 AgentSkin 的程序化验证抽取为声明式 JSON 配置

**实现方案**：
1. 新增 `src/shared/injection/declarative-verification.ts`
2. 定义 `LandmarkRule`、`RouteContext`、`VerificationResult` 类型
3. 适配器注册 ABI：`registerVerificationRules(rules)`
4. 主题包支持可选 `verification` 字段
5. 注入前先执行验证，失败则跳过该窗口并报告

### 4.2 P1：自动化审计矩阵（对标 zhouwei713）

**目标**：为 6 个适配器各建立自动化验证脚本

**实现方案**：
1. `src/main/cdp/injection/audit/` 目录
2. 每个适配器一组审计脚本（hover/composer/pages/settings）
3. 生成结构化 JSON 报告（pass/fail/warning + 截图路径）
4. 审计结果持久化到 `audit-output/` 目录

### 4.3 P1：增强型单实例守护（对标 comeonzhj）

**目标**：当 UI 已运行时，CLI 注入请求应委托给 UI 进程

**实现方案**：
1. 主进程维护 `activeInjectorSession` 单例
2. 新注入请求先检查是否有活跃 session
3. 如有，通过 IPC 委托给已有 session（而非创建新 CDP 连接）
4. 确保多窗口切换不会导致重复注入

---

## 五、下一步建议

**短期（本轮可执行）**：
1. 实施声明式验证系统（P0）
2. 为 WorkBuddy 适配器编写自动化审计脚本（P1）

**中期（后续 1-2 轮）**：
3. 实现路由感知验证（根据页面路由动态调整验证规则）
4. 增强 ZIP 导入安全验证（文件类型白名单 + 内容安全检查）
5. 单实例守护增强（进程级所有权转移）

**长期**：
6. 社区发布协议（SHA-256 + 版本规范 + PR 检查表）
7. 主题包签名验证

---

## 附录：原始数据

### A. 项目基本信息

| 项目 | Created | Updated | Pushed | Language | Stars | Forks | Issues |
|------|---------|---------|--------|----------|-------|-------|--------|
| CodeDrobe/core | 2026-07-16 | 2026-08-05 | 2026-07-21 | JavaScript | 9 | 2 | 3 |
| comeonzhj/WorkBuddy-theme-skill | 2026-07-18 | 2026-08-09 | 2026-07-18 | CSS | 18 | 4 | 4 |
| zhouwei713/WorkBuddy-Dream-Skin | 2026-07-19 | 2026-08-26 | 2026-07-24 | CSS | 20 | 6 | 2 |
| jiarong0423/dream-skin-forge | 2026-07-25 | 2026-07-25 | 2026-07-25 | JavaScript | 1 | 0 | 0 |
| ozrwayne/WorkBuddy-Skins | 2026-07-20 | 2026-07-20 | 2026-07-20 | Rust | 0 | 0 | 0 |

### B. 提交活跃度

**CodeDrobe/core**（最近 5 次提交）：
1. `v0.7.0-beta.0` — Codex avatar-overlay 排除和 per-window probe/verify（2026-07-21）
2. 排除 Codex avatar-overlay 路由，跳过 secondary windows（2026-07-21）
3. `v0.6.1` — 改进 CLI 错误提示（2026-07-19）
4. 测试平台特定 fixture（2026-07-18）
5. `v0.6.0` — QoderWork 和 TRAE SOLO 适配器（2026-07-18）

**zhouwei713/WorkBuddy-Dream-Skin**（最近 5 次提交）：
1. 主题库预览 + 本地 WIP 资源提交（2026-07-24）
2. 回滚 WPF save-preset dialog（2026-07-23）
3. 重写 WPF save-preset dialog（2026-07-23）
4. WinForms save-preset dialog 替换（2026-07-23）
5. 输入验证和基础验证改进（2026-07-22）

**comeonzhj/WorkBuddy-theme-skill**（最近 5 次提交）：
1. 防止竞争主题守护（2026-07-18）
2. 添加致谢部分（2026-07-18）
3. 安全主题移除控制（2026-07-18）
4. Windows 发布产物命名（2026-07-18）
5. 使用 Electron networking 进行主题同步（2026-07-18）

---

> 报告完成于 2026-08-30 12:00 | 下轮建议分析：DSH 生态（DeepSeek Harness 皮肤生态）或 TRAE Work 专属生态
