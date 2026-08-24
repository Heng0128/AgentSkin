# 紧急故障修复报告

> **日期**: 2026-08-24
> **严重等级**: P0 — 主题系统不可用

---

## 一、故障现象

用户反馈"项目无法运行，主题无法应用"。具体表现：
- 主题列表为空，无法选择和应用任何主题
- CDP 注入验证失败："Renderer evaluation failed: verify crashed"
- 大量预存未暂存变更（449 个文件，+9,374/-100,530 行）

---

## 二、根因分析

### 2.1 主因：24 个主题目录被误删

`themes/` 目录被无条件删除（unstaged `D` 状态），导致：
- 无主题可加载/展示
- themeStore 无法获取主题列表
- CDP 注入的目标 CSS 内容不存在

**疑似原因**：工作区有大量未暂存变更，可能在某次操作中误删。

### 2.2 次因：依赖未安装

`node_modules/typescript` 不存在，导致：
- 编译时类型检查失效
- `npm run check` 无法执行

### 2.3 附带问题：调试残留

- `cdp-strategy.ts` 残留 `[hero-diag2]` 调试日志
- `cdp-fanout.ts` 残留 `TEMP-DIAG` 诊断块（含 `statSync` + `deps.log` + `[hero-diag]`）

---

## 三、修复操作

| # | 操作 | 命令/文件 | 状态 |
|---|------|----------|:----:|
| 1 | 恢复 themes 目录 | `git checkout HEAD -- themes/` | ✅ |
| 2 | 安装依赖 | `npm install` | ✅ |
| 3 | 移除 cdp-strategy.ts 调试残留 | 删除第 144-146 行 `[hero-diag2]` | ✅ |
| 4 | 移除 cdp-fanout.ts TEMP-DIAG 块 | 删除第 431- 449 行 + 清理 statSync import | ✅ |

**验证结果**: 227 test files passed, 4362 tests passed, 4 skipped（主题测试恢复后测试数从 3620 增至 4362）

---

## 四、GitHub 同类项目参考

调研了 7 个同类项目，核心收获：

| 项目 | Stars | 可借鉴点 |
|------|:-----:|----------|
| Dark Reader | 20k+ | 多引擎回退架构（CSS变量/完整注入/滤镜 fallback） |
| Altus | 668 | Electron + CSS 注入模式，多账号主题隔离 |
| workbuddy-theme-skin-skill | — | CDP + `!important` + 前缀属性选择器 `[class*="prefix"]` |
| dark-mode-toggle | — | 系统偏好 + 用户覆盖的三态模型 |
| next-themes | 5k+ | 零闪烁注入时序，跨 tab 同步 |
| electron-store | — | Crash-safe 原子写入，JSON Schema 验证 |

### 对 AgentSkin 的 5 个改进方向

1. **多引擎回退**（参考 Dark Reader）: CSS 变量替换 → 完整注入 → 滤镜 fallback
2. **零闪烁注入**（参考 next-themes）: `Page.addScriptToEvaluateOnNewDocument` 预注入
3. **按适配器独立持久化**（参考 Dark Reader + electron-store）
4. **壁纸取色自动生成主题**（参考 workbuddy-skill 的 extract_colors.py）
5. **主题健康检查闭环**（参考 Dark Reader IGNORE + Altus 重注入）

---

## 五、长期防护建议

1. **Git 防护**: 大量未暂存变更（449 文件）极易引发误操作。建议推到 feature 分支并定期 commit
2. **.npmignore 加固**: 确保 `themes/` 不会被误删
3. **操作前快照**: 在执行批量删除前，先 `git stash` 或 `git commit` 当前状态
4. **CI 门禁**: 增加主题文件存在性检查到 CI 流程
