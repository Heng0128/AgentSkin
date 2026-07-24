# 主题包 / CDP 注入问题诊断：为什么 workbuddy 能，qoderwork CN 与 trae 不能

> 调查时间：2026-07-22
> 范围：`src/adapters/*`（AgentSkin 侧）+ `node_modules/@codedrobe/core@0.6.0` 的 adapter / injector / launcher / renderer-payload / theme package
> 结论先行：**workbuddy 与另两个的差别不在 AgentSkin 业务代码，而在 `@codedrobe/core` 里每个 app 的「端口发现 + matchTarget + 验证选择器」。workbuddy 在 macOS/Windows 双端都验证过；qoderwork/traework 的 `lastVerified` 只有 darwin，Windows 配置（端口文件、可执行名、DOM 选择器）全是「静态包分析、未真机验证」，所以 Windows 上 qoderwork/traework 找不到 CDP target 或验证不通过。**

---

## 1. 调用链与责任边界（先说清"改哪里没用"）

```
UI → agent-engine-service → registry → ApplicationAdapter(Identity 壳)
   → src/legacy/codedrobe-core-runtime.ts  ← 全仓库唯一 import @codedrobe/core 的地方
   → @codedrobe/core: applySkin → launchApp → resolveDebugPorts → listCdpTargets
                              → injector.findTargets(adapter.matchTarget) → probe(verification) → 注入 CSS
```

**关键事实**：`src/adapters/domestic/{workbuddy,qoder,qoder,workbuddy}.ts` 只是身份壳（`id`/`coreId`/`installHints`），**所有 CDP 行为（端口、matchTarget、验证）都在 `@codedrobe/core` 的 `adapters/*.mjs` 里**。AgentSkin 自己的 adapter 源码一个字都改不了 matchTarget/端口/选择器。

- `@codedrobe/core` 导出 `registerAdapter`（`adapters/index.mjs:20`），但**重复 id 会抛错**（`adapters/index.mjs:24`），所以不能在 AgentSkin 里"替换"内置 adapter，只能运行时 mutate 对象或等上游修。
- `package.json` 把 `@codedrobe/core` 锁死在 `0.6.0`。

---

## 2. 三份 adapter 的差异（证据）

### workbuddy.mjs（`node_modules/@codedrobe/core/src/adapters/workbuddy.mjs`）
- `defaultPort: 9336`
- `lastVerified`: **darwin + win32 都验证过**（行 5–8）
- `matchTarget`（行 28–36）：**极宽** —— 匹配 `app.asar/renderer/index.html`、标题 `/workbuddy/i`、`workbuddy:`/`vscode-file:` scheme、`localhost/127.0.0.1`。几乎总能命中 target。
- 无 `devToolsActivePortFile`：说明它**尊重传入的 `--remote-debugging-port=9336`**（launcher.mjs:309 会传），所以端口能绑上 → CDP 通。
- `verification.rootAny` 含 `#root` 兜底，`recommended` 不阻断。

### qoderwork.mjs（`.../qoderwork.mjs`）
- `defaultPort: 9337`
- `lastVerified`: **只有 darwin**（行 13–15），注释明写「Windows support ... stays unverified until a real-app pass」。
- 注释（行 32–34、175–184 in launcher）：**主进程强制 `remote-debugging-port=0`**，真实端口只通过 `DevToolsActivePort` 文件发布 → 必须靠 `devToolsActivePortFile` 发现。
- `devToolsActivePortFile`（行 50–53，win32）：`%APPDATA%\QoderWork\` 与 `%APPDATA%\QoderWork CN\` —— **声明了但路径未经验证**。
- `matchTarget`（行 56–65）：中等 —— 匹配 `app.asar/out/renderer/index.html` 或标题 `/qoderwork/i`，并排除辅助窗口。

### traework.mjs（`.../traework.mjs`）
- `defaultPort: 9338`
- `lastVerified`: **只有 darwin**（行 18–21），win32 未验证。
- **`devToolsActivePortFile`：全文件都没有**（grep 确认 `adapters/*.mjs` 里只有 `qoderwork.mjs` 声明了它）。即 traework **任何平台都没声明端口文件**。只要 TRAE 也强制 ephemeral 端口（像 QoderWork 那样），端口就**永远发现不了**。
- `matchTarget`（行 63–70）：**最窄** —— 只匹配 `\/electron-browser\/solo\/solo-lite\.html/i`，且排除辅助窗口。Windows 上若主窗 URL 不是这个精确路径 → 没有任何 target 命中。

---

## 3. 为什么"找不到 → 注入失败"（机制）

`injector.mjs`：
- `findTargets` = `listCdpTargets(port)` 后 `filter(adapter.matchTarget)`（行 9–12）。
- `waitForTargets` 在超时内无命中 → 抛 **`CODEDROBE_TARGET_TIMEOUT`**（行 14–34）。
- `applyTheme` 先 `waitForCompatibility`（probe，用 `adapter.verification` + 主题的 `target.verification`），`required` 检查不过 → 抛 **`CODEDROBE_DOM_INCOMPATIBLE`**（renderer-payload.mjs:25–48、injector.mjs:59–79）。

`launcher.mjs`：
- `resolveDebugPorts`（行 185–194）只读 `devToolsActivePortFile`，没有就返回 `[]` → 回退 `defaultPort`。
- 启动参数固定 `--remote-debugging-port=${port}`（行 309）。对强制 `port=0` 的 app，这个端口被忽略，真实端口只在 DevToolsActivePort 文件里。

**所以 qoderwork/traework 在 Windows 的失败路径是：**
1. 端口发现：qoderwork 靠未验证的 `devToolsActivePortFile` 路径（错则死）；traework 根本没有端口文件 → 若 TRAE 强制 ephemeral 端口则必然死。
2. 即便端口通，`matchTarget` 对 traework 过窄（solo-lite.html）→ 可能无命中 → `TARGET_TIMEOUT`。
3. 即便命中，`waitForCompatibility` 跑主题的 `required` 验证：qoderwork 要求 `.agents-layout-root`、traework 要求 `.panel-container`/`.solo-lite-layout`（见下方主题包部分）。这些选择器是 macOS 派生、Windows 未验证 → 不命中 → `CODEDROBE_DOM_INCOMPATIBLE`。

workbuddy 因为端口被尊重 + matchTarget 宽 + win32 已验证，三步全部通过。

---

## 4. 主题包层面（`主题包的问题`）

**好消息（已排除的假设）：**
- 12 个主题 manifest **全部声明 `targets: [qoderwork, traework, workbuddy]`**（如 `themes/midnight-aurora/manifest.json:14-116`），不是缺 target。
- 每个 target 有**真实且不同的 CSS**（如 `midnight-aurora/assets/css/`：workbuddy 9.5KB / qoderwork 7.9KB / traework 7.7KB），不是空文件也不是 workbuddy 的复制。traework.css 正确针对 `html.codedrobe-host-traework body` + solo-lite 类。
- `theme-installer.ts:180-191` 构建时把 manifest v2（`schemaVersion:2`）转成引擎接受的 `schemaVersion:1` bundle，`resolveThemeTarget`（package.mjs:356）按 `bundle.targets[appId]` 取，**不会因 schema 版本拒绝**。seed 也不会丢 target（`theme-seeder.ts` 全量 install）。

**真实的问题（主题包侧）：验证选择器是 macOS 派生、Windows 未验证。**
- `midnight-aurora/manifest.json`：
  - traework `verification.required` = `solo-shell: .panel-container | .solo-lite-layout`（行 17–26）
  - qoderwork `verification.required` = `agents-root: .agents-layout-root`（行 46–54）
  - workbuddy `verification.required` = `teams-root: .teams-container`（行 81–89）
- 这些 `required` 是**硬门槛**：`renderer-payload.mjs` 的 probe 中 `required` 不命中 → `compatible=false` → 注入被拒。
- 而 adapter 注释明确写「qoderwork/traework 的 Windows 支持基于静态包分析、未真机验证」。也就是说这些选择器**很可能和 Windows 真机 DOM 对不上**，于是即便 CDP target 找到，主题也被判为「不兼容」而拒绝。

> 一句话：主题包里 qoderwork/traework 的 CSS 与验证是按 macOS 抽出来的，Windows 上既可能 matchTarget 找不到窗、也可能 required 验证不通过。

---

## 5. 根因总结

| 维度 | workbuddy | qoderwork CN | trae |
|---|---|---|---|
| `lastVerified` 含 win32 | ✅ 是 | ❌ 否（仅 darwin） | ❌ 否（仅 darwin） |
| 端口发现 | 尊重传入端口（9336） | 依赖未验证的 `DevToolsActivePort` 路径 | **无任何端口文件**，若强制 ephemeral 则必死 |
| `matchTarget` 宽度 | 极宽 | 中 | **最窄（solo-lite.html 精确匹配）** |
| 主题 `required` 验证 | `.teams-container`（已验证） | `.agents-layout-root`（macOS 派生） | `.panel-container`/`.solo-lite-layout`（macOS 派生） |
| 结果 | 三步全过 ✅ | Windows 多环节失败 ❌ | Windows 多环节失败 ❌ |

**根因 = qoderwork/traework 的 adapter 配置（端口、matchTarget、验证选择器）只在 macOS 验证过，Windows 全是未经真机校验的假设。workbuddy 两端都验证过，所以稳。**

---

## 6. 修复路径（在 AgentSkin 侧能做的 vs 必须上游做的）

由于行为在外部包 `@codedrobe/core@0.6.0`：
- **上游修（最干净）**：让 `@codedrobe/core` 给 traework 补 win32 `devToolsActivePortFile`、放宽 traework `matchTarget`、把 qoderwork/traework 的 win32 端口文件/可执行名/选择器拿到真机验证；并放宽或移除主题里的 macOS 派生 `required`。然后 AgentSkin 升 `@codedrobe/core`。
- **AgentSkin 运行时 patch（不改 core、不 fork，可立即见效）**：在 `main.ts` 启动早期、首次 `getAdapter` 之前，直接从 `@codedrobe/core` `getAdapter('traework'/'qoderwork')` 拿到对象并 mutate：
  - traework：`platforms.win32.devToolsActivePortFile = ['%APPDATA%\\Trae\\DevToolsActivePort', '%APPDATA%\\Trae CN\\DevToolsActivePort']`（需真机确认路径）；放宽 `matchTarget` 允许 `app.asar` 下任意 renderer。
  - qoderwork：核对并修正 win32 `devToolsActivePortFile` 真实路径。
  - 主题侧：把 `required` 降级为 `recommended`（或 AgentSkin 在注入前 patch 主题的 verification）——但这要动 `resolveThemeTarget` 返回值，较绕。
  - 风险：core 升级会覆盖 patch；属 hack，需注释说明。
- **应用侧限制（需确认）**：若 qoderwork CN / trae CN 的 Windows 构建**根本不写 DevToolsActivePort、也不接受 `--remote-debugging-port`**，那任何 skin 方案都无解，只能等 app 开放调试端口。

---

## 7. 下一步建议（待你拍板）

1. **先确认现象平台**：你是在 Windows 上测 qoderwork CN / trae 吗？这决定是端口问题还是选择器问题。
2. **真机抓一次**：在目标 app 运行时，① 看 `http://127.0.0.1:9337/json/list` 和 `:9338/json/list` 是否返回、target 的 `url`/`title` 是什么（决定 matchTarget 该不该放宽）；② 看 `%APPDATA%\QoderWork CN\DevToolsActivePort` 与 Trae 对应文件是否存在（决定端口发现）。
3. 确认后，我可以在 AgentSkin 侧加一个「adapter patch」模块（方案 B），先把 Windows 跑通，同时把发现反馈给 `@codedrobe/core` 上游（方案 A）。

> 注：本次为只读排查，未修改任何文件。
