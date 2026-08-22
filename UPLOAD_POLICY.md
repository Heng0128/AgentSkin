# 仓库上传策略（2026-08-23 重建）

> 目的：2026-08-23 远程仓库重建后，明确哪些内容进仓库、哪些不进。
> 背景：旧仓库堆积了 13 个临时分支与大量污染文件，历史中混入 130+ 垃圾文件，难以同步维护。

## 一、上传规则（进 main）

### 目录（全部上传）

| 目录 | 内容 |
|------|------|
| `src/` | 全部源码（主进程 / preload / 渲染进程 / 编译器） |
| `engines/` | 6 适配器运行时三件套（adapter / tokens / cosmetic） |
| `themes/` | 内置主题包（manifest + palette + 配色方案） |
| `scripts/` | 校验 / 构建 / 生成 / 审计脚本 |
| `assets/` | 图标与图像资源 |
| `build/` | 构建配置与 NSIS 资源 |
| `licenses/` | 第三方许可文本 |

### 文件（根目录，全部上传）

| 文件 | 用途 |
|------|------|
| `package.json` / `package-lock.json` | 依赖清单（npm 唯一锁文件） |
| `tsconfig.json` / `electron.vite.config.ts` / `electron-builder.yml` | 构建配置 |
| `biome.json` / `vitest.config.ts` / `vitest.setup.ui.ts` / `postcss.config.mjs` / `components.json` | 工具链配置 |
| `index.html` / `studio.html` / `splash.html` | 三窗口入口 |
| `build.bat` / `builder-debug.yml` | 打包脚本 |
| `AGENTS.md` / `CONTRIBUTING.md` | 项目规范（工程协作唯一入口） |
| `README.md` / `README_zh.md` / `LICENSE` / `NOTICE` / `CHANGELOG.md` / `THIRD_PARTY_NOTICES.md` / `TRADEMARKS.md` / `ASSETS_LICENSE.md` / `SOURCE_CODE.md` / `OPEN_SOURCE_STRATEGY.md` | 顶层文档 |
| `.gitignore` / `.editorconfig` | 工程配置 |

## 二、不上传规则（不进 main）

### 目录（禁止上传）

| 目录 | 原因 |
|------|------|
| `docs/` | 活文档与审计报告——**另存于本地/归档仓库**，不作为源码提交 |
| `debug-tools/` | 一次性探针/调试脚本，非生产资产 |
| `agents-raw-data/` `agents-run-now/` `agents-profiles/` | CDP 抓取/Agent 运行缓存，可再生成 |
| `port-sources/` | 外部主题移植源，本地参考 |
| `patches/` | 依赖补丁（patch-package 本地应用） |
| `blueprint/` | 静态 HTML/CSS/JS 视觉参考，非构建输入 |
| `test-output/` | 命令输出捕获（测试/检查日志） |
| `tmp/` `temp/` | 临时目录 |
| `.quality/` | 质量工具运行产物 |
| `coverage/` `out/` `node_modules/` `.vite/` | 构建产物与依赖 |

### 文件（禁止上传）

- 根目录所有 `.txt` / `.log` 命令输出捕获
- `项目审计报告.md` / `战略审计报告.md`（咨询交付物）
- `*.tsbuildinfo`（tsc 增量缓存）
- 以绝对路径命名的垃圾文件（如 `CUsers*.txt`）

## 三、强制机制

1. `.gitignore` 是唯一入口——所有禁止项必须能在 `.gitignore` 找到对应规则。
2. 新增文件时先判断归属：核心源码进 `src/`，脚本进 `scripts/`，文档进 `docs/`（不上传）。
3. 命令输出禁止落根目录，统一放 `test-output/`（见 CONTRIBUTING.md「目录与文件规范」）。
4. 禁止创建新临时分支（`feature/inspection-*` 等），只允许 `main` 单线开发。
