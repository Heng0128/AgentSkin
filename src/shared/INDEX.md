# shared — 共享层

## 用途
主进程、渲染进程、引擎模块三方共用的类型定义、常量、工具函数与基础设施，禁止包含任何 Electron API 或 DOM 依赖。

## 结构

### 根目录（核心共享模块）

| 路径 | 用途 |
|------|------|
| `injection-constants.ts` | 注入契约常量：14-token 定义、CSS 变量前缀、选择器锚点 |
| `injection-runtime.ts` | 注入运行时类型与工具，描述单次注入的完整生命周期 |
| `ipc-channels.ts` | IPC 通道名常量枚举，主-渲染进程通信的唯一契约源 |
| `i18n.ts` | 国际化基础框架，翻译 key 枚举与 t 函数类型定义 |
| `types.ts` | 全局共享类型基础（导出 types/ 下的聚合类型） |
| `theme-id.ts` | Theme ID 验证与解析工具 |
| `theme-mapping.ts` | 主题映射关系，维护 AgentId ↔ ThemeId 的合法对应 |
| `cdp-discovery.ts` | CDP 端口发现服务，通过 HTTP 探测目标应用的 DevTools 端口 |
| `errors.ts` | 统一错误类型与错误码定义 |
| `tonal-palette.ts` | 色调调色板工具，基于 Material You 的色彩空间计算 |
| `withTimeout.ts` | 超时工具函数，为 Promise 添加统一超时处理 |
| `exec-async.ts` | 异步执行工具，封装 child_process 为 Promise |

### 类型目录（types/）

| 路径 | 用途 |
|------|------|
| `types/index.ts` | 类型聚合入口，re-export 所有子模块类型 |
| `types/agent.ts` | Agent 类型定义：AgentId、AgentMeta、AgentStatus |
| `types/theme.ts` | 主题类型定义：ThemeToken、14-token 结构、Palette |
| `types/ipc.ts` | IPC 请求/响应类型，通道签名与参数类型 |
| `types/wallpaper.ts` | 壁纸类型定义：壁纸资源类型、注入配置、渲染参数 |
| `types/visual-analysis.ts` | Visual Analyzer 类型：视觉分析结果、特征提取数据 |

## 约定

1. **零运行时依赖**：shared 模块禁止 import Electron、React、Node.js 内置模块（除 `exec-async.ts`）。
2. **类型唯一源**：所有跨模块使用的类型必须在 `shared/types/` 定义，禁止在各模块内重复定义相同概念。
3. **IPC 强类型**：新增 IPC 通道必须同时在 `ipc-channels.ts`（通道名）和 `types/ipc.ts`（参数/响应类型）中定义。
4. **常量不可变**：`injection-constants.ts` 中导出的常量视为编译期常量，运行时禁止修改。
5. **循环依赖防控**：通过将核心状态类型拆分为独立模块（位移核心）消除循环依赖。
6. **测试共置**：共享工具的 `.test.ts` 文件与源文件同目录。
