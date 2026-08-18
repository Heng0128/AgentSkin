# 贡献指南

感谢你对 AgentSkin 的关注！本文档提供了快速上手的开发参考。

## 环境要求

- **Node.js**：≥ 22.0.0（建议与 `engines.node` 保持一致）
- **包管理器**：npm（`package-lock.json` 为唯一锁文件）

## 克隆与安装

```bash
git clone <repo-url>
cd desktop-main
npm install
```

安装会自动通过 `husky` 注册 pre-commit hook。

## 开发命令速查

| 命令 | 说明 |
|------|------|
| `npm start` | 启动开发模式（`electron-vite dev`） |
| `npm run build` | 生产构建 |
| `npm run package:win` | 打包 Windows 版（不发布） |
| `npm run package:mac` | 打包 macOS arm64 版（不发布） |
| `npm run build:installer` | 构建最终安装包（调用 `build.bat`） |
| `npm test` | 运行全部测试（vitest） |
| `npm run typecheck` | TypeScript 类型检查（`tsc --noEmit`） |
| `npm run lint` | Biome 代码检查（仅 `src/`） |
| `npm run lint:fix` | Biome 自动修复格式问题 |
| `npm run check` | 完整门禁：typecheck + lint + test + 契约校验 + 主题校验 |
| `npm run check:contract` | 注入契约四源一致性校验 |
| `npm run check:themes` | 14-token 主题契约校验 |
| `npm run generate:themes` | 重新生成所有主题的 palette + CSS |

## 项目结构简介

```
src/
  main.ts              主进程入口
  renderer.tsx         渲染进程入口（主窗口）
  studio.tsx           Theme Studio 独立窗口入口
  preload.ts           contextBridge 桥接层
  main/                主进程服务（IPC / CDP / 编排器 / 编目）
  ui/                  React 组件与页面
  shared/              共享工具与类型
  adapters/            ApplicationAdapter 契约与注册
  engine/              vendored @agentskin/engine 包
themes/                15 个内置主题（manifest + palette + 配色方案）
engines/               6 个目标应用运行时三件套（adapter.mjs / tokens.css / cosmetic.css）
scripts/               构建 / 校验 / 生成脚本
docs/                  活文档（ARCHITECTURE / ROADMAP / THEME_SPEC 等）
```

更多架构细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 代码规范

项目使用 **Biome** 进行格式化与检查（配置见 `biome.json`）：

- 缩进：2 空格（LF 行尾）
- 行宽：100 字符
- 字符串：单引号；语句：分号结尾；尾逗号：处处
- JSX：`react-jsx` 转换模式
- 推荐规则全量启用；`noNonNullAssertion` 关闭，`useOptionalChain` 关闭

提交前 hook 会自动执行 `lint-staged`（Biome 修复 + themes 校验）。TypeScript 严格模式（`strict: true`）。

## 提交规范

遵循 Conventional Commits 风格：

```
feat: 新功能
fix: 修复
refactor: 重构
docs: 文档
style: 格式 / lint
chore: 杂项
```

主题 / 色彩相关变更前缀建议用 `fix(theme):` / `feat(theme):`。

## 测试要求

测试框架：**Vitest**（配置见 `vitest.config.ts`），双 project 隔离：

| Project | 覆盖范围 |
|---------|----------|
| main    | `src/main/**/*.test.ts`、`src/shared/**/*.test.ts` |
| ui      | `src/ui/**/*.test.ts`、`src/ui/**/*.test.tsx` |

运行：`npm test`（全部）或 `npx vitest run --project main`（指定 project）。

覆盖阈值（`vitest.config.ts` 内配置）：statements / branches / functions / lines 各 ≥ 25%。

## 主题开发指南

主题以目录形式存放于 `themes/<theme-id>/`，核心是 `manifest.json`（声明 14 个语义色 token 与元数据）。新增或修改主题后：

1. 修改 `manifest.json` 中的 `colors` 字段
2. 运行 `npm run generate:themes` 重新生成 `palette.css` 与各 Agent 专用 CSS
3. 运行 `npm run check` 确保全部门禁通过

详细 manifest 字段、配色方案、分发格式规范见 [docs/THEME_SPEC.md](docs/THEME_SPEC.md)。

### 关于「原生硬编码视觉缺陷」修正规则

目标应用会自带一些**无法通过主题变量修改**的硬编码视觉缺陷（气泡方角阴影、硬编码的渐变遮罩带、灰/实底色等），它们会破坏主题的艺术背景。项目已把这些修正规则收敛为**单一来源**：

- 规则唯一存放于 `scripts/native-defect-fixes.mjs`（`NATIVE_DEFECT_FIXES` 注册表 + `nativeDefectFixCss()` 生成函数）。
- 各 `scripts/generators/<agent>Css.mjs` 在生成时**自动拼接**这些规则。

因此：**新增或重建主题时，这些缺陷修正会自动带上，无需你手写、也无需记住任何选择器**。你只管在 `manifest.json` 里定义 14 个语义色即可。

注意两点：

1. **遇到新的硬编码缺陷**，请往 `scripts/native-defect-fixes.mjs` 的注册表加规则（`selectors` + `props`），**不要**直接在生成器里手写一段——否则又与 adapter 内嵌副本漂移。`props` 只允许「清除类」值（`none`/`transparent`），不得注入主题颜色。
2. **adapter 内嵌副本靠校验守护**：`engines/<agent>/adapter.mjs` 因浏览器自包含约束也内嵌一份同一规则，由一致性校验脚本保证它与注册表同步，漂移会 fail 门禁。

设计文档见 `docs/rfc/2026-08-18-native-defect-fixes-consolidation.md`。

## 行为准则

- 保持最小改动；每次提交只解决一个问题。
- 修改公共接口前需说明影响范围。
- 新增依赖前确认无法用标准库或现有依赖替代。
- 禁止将密钥、Token、密码写入代码或日志。
