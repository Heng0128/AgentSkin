# 批 6 · 全量 6 Agent 集成验证记录

> 关联 RFC：`docs/rfc/2026-08-16-cdp-injection-performance.md`
> 日期：2026-08-16
> 范围：`src/main/cdp/live-apply-all.manual.test.ts`（手动集成测试，非 `npm run check` 一部分）
> 环境：6 个 agent 均已启动且 CDP 已开启

---

## 1. 验证目标

批 6 为 RFC 分批落地计划的最后一环，对 6 个 agent 执行**真实主题 apply + 内存热切换 + 恢复**三段式校验，覆盖：

- **B1 冷启动 apply**：对实时 CDP 目标注入真实已安装主题（`sakura-noir`），验证主题被采纳。
- **B2 内存热切换**：不重启、不重新发现端口，直接切换第二主题（`ocean-tide`），验证热路径可用。
- **restore**：验证后恢复各 agent 原主题，保证不污染运行中的应用外观。

每个 agent 独立执行、独立捕获结果，任一 agent 失败不阻塞其余 agent 验证。

---

## 2. 复现方式

```bash
# 前置条件：6 个 agent 均已启动且打开 CDP 调试端口
npx vitest run src/main/cdp/live-apply-all.manual.test.ts
```

---

## 3. 验证机制

| 环节 | 实现 | 说明 |
|------|------|------|
| 端口发现 | `resolveLivePort`（`shared/cdp-discovery.ts`） | 复用 30s TTL 存活端口缓存，失败回退 DevToolsActivePort / PID / netstat |
| 会话建立 | `openMainSession` → `findTargets` → `connectCdp` | 打开主 renderer target 的 WebSocket |
| 主题采纳校验 | `verifyApplied` | 通用 agent 走 `waitForTheme` 统计 `adoptedSheetCount`；Codex 走 `<style id="agentskin-theme-style-codex">` 探针 |
| 应用 | `adapter.applyTheme` | `sakura-noir` → `ocean-tide`（`launch:false / restartExisting:false`） |
| 恢复 | `adapter.restoreTheme` | 每 agent 独立恢复，`finally` 中兜底 |

### 3.1 Codex 特化校验

Codex 目标 CSS 通过 `<style id="agentskin-theme-style-codex">` 注入（design tokens），而非
带 `__agentskin` 标记的 `adoptedStyleSheets`。因此 `verifyApplied` 对 Codex 使用专用探针：

- 检查 `#agentskin-theme-style-codex` 元素存在；
- 检查其 `textContent` 非空；
- 两者皆真判定主题已应用（返回 1）。

`waitForTheme` 的 `adoptedSheetCount` 对 Codex 恒为 0，故不适用。

### 3.2 Codex DOM 预检查修复

批次 6 修前，Codex 因类名哈希化导致 `OpenAI Codex DOM preflight failed for 2 of 2 renderer target(s)`。
根因：验证选择器 `main.main-surface` 已过时。修复：

- `scripts/build-theme-package.mjs` 的 `VERIFICATION.codex` 增加
  `main[class*='MainContentSurface']` 哈希类回退；
- 15 个主题 manifest 同步更新；
- 通过 `reseed-themes.manual.test.ts` 重新生成 `.agentskin-theme` 包到
  `AppData/Roaming/AgentSkin/themes`，并校验 `sakura-noir` 的 codex 验证配置已含
  `MainContentSurface`。

---

## 4. 验证结果

最终一轮全量运行，6 个 agent 全部通过：

| agent | 端口 | B1 adopted | B2 adopted | 恢复 |
|-------|------|-----------|-----------|------|
| traework  | 56211 | 5 | 5 | ok |
| qoderwork | 53137 | 6 | 6 | ok |
| workbuddy | 62854 | 5 | 5 | ok |
| doubao    | 61055 | 5 | 5 | ok |
| codex     | 58554 | 1（style 探针） | 1（style 探针） | ok |
| zcode     | 55435 | 5 | 5 | ok |

**判定**（对每个有活体端口的 agent）：

- B1 `adopted > 0`：主题已注入并被采纳。
- B2 `adopted > 0`：内存热切换成功，未重启 / 未重新发现端口。
- `restored === 'ok'`：原主题已恢复，无残留污染。

---

## 5. 结论

- 6 个 agent 的真实 apply（B1）与内存热切换（B2）均成功，主题采纳立即生效。
- restore 全部成功，验证过程未改变或污染各运行中的应用外观。
- Codex 的 `<style>` 注入机制与类名哈希化均已通过特化探针与选择器回退覆盖。
- 批 6 完成，RFC §6 分批落地计划全部执行完毕。

---

## 6. 遗留说明

- 批 6 为**手动集成验证**，测试文件位于 `src/main/cdp/live-apply-all.manual.test.ts`，
  不纳入 `npm run check`（需活体 CDP 端口，CI 不满足）。
- 未纳入批 6 清单、仍需人工复核的项见 RFC §7（如 WorkBuddy 13 target 注入必要性、
  `app.quit()` 与 `taskkill /F` 对 CDP 端口释放的影响）。