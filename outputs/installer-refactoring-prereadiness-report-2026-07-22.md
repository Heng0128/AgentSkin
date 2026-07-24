# AgentSkin 安装器重构前置探查 — 4 大架构疑点调查报告

> **调查时间**：2026-07-22 15:07
> **调查范围**：`desktop-main` 仓库全部源码、配置、CI 脚本
> **原则**：所有结论基于可验证代码，禁止推测

---

## 问题 1：安装器与主程序的通信契约

### 事实陈述

**当前 NSIS 安装器（electron-builder 生成）完全不涉及目标应用（TRAE/Qoder/WorkBuddy）的路径检测或版本信息获取。** 安装器仅负责：

1. 将打包好的 Electron 应用文件解压到目标目录
2. 写入卸载注册表项（HKCU）
3. 创建桌面/开始菜单快捷方式
4. 注册文件关联（`.agenttheme`、`.codedrobe-theme`、`.codex-theme`）

目标应用的路径检测和主题注入 **完全由 Electron 主程序在首次启动后完成**，安装器对此一无所知。

### 代码证据

#### 证据 1.1：`build/installer.nsh` — NSIS 安装器钩子

**文件**：`build/installer.nsh`（158 行）

```
!macro customInit          ← 仅记录版本、用户名、前次安装路径
!macro customInstall       ← 仅记录文件计数、注册表、快捷方式、文件关联
!macro customUnInstall     ← 仅删除文件、注册表、快捷方式、文件关联
```

整份脚本 **没有任何** 对目标应用（TRAE/Qoder/WorkBuddy）的注册表查询、文件系统扫描或版本探测。所有检测逻辑为零。

#### 证据 1.2：`electron-builder.yml` — NSIS 配置

**文件**：`electron-builder.yml`（第 24-32 行）

```yaml
nsis:
  artifactName: AgentSkin-${version}-${arch}-Setup.${ext}
  include: build/installer.nsh
  oneClick: false
  allowToChangeInstallationDirectory: true
  perMachine: false           # 仅 HKCU（per-user）
  createDesktopShortcut: true
  createStartMenuShortcut: true
  runAfterFinish: true
```

没有 `perAppMutex`、没有 `runAsAdmin`、没有 `postInstall` 脚本调用外部 EXE。

#### 证据 1.3：`build-installer.bat` — 构建流程

**文件**：`build-installer.bat`（第 85-93 行）

```bat
REM ============ [5/6] electron-builder NSIS ============
call :step "electron-builder NSIS" 5 6 65
powershell ... -Command "npm run make:windows:installers"
```

构建流程为：`npm run package`（生成 `out/AgentSkin-win32-x64/`）→ `npm run make:windows:installers`（调用 `electron-builder` 打 NSIS 包）。**中间不生成任何配置文件传递给安装器。**

#### 证据 1.4：Inno Setup PoC 安装器

**文件**：`build/inno/agentskin.iss`（277 行）

Inno Setup 版本同样是 **纯文件拷贝 + 注册表写入 + 快捷方式创建**，不涉及目标应用检测。唯一的 `[Code]` 段（第 136-277 行）是 UI 日志控制台和进度条，`RunPostInstall` 过程（第 215-239 行）仅验证 `AgentSkin.exe` 是否存在。

### 数据流向图

```
electron-forge package → out/AgentSkin-win32-x64/（完整 Electron 应用）
                          ↓
electron-builder NSIS → AgentSkin-xxx-Setup.exe
                          ↓
  安装器职责：
    ├─ 解压文件到 $INSTDIR
    ├─ 写入 HKCU Uninstall 注册表
    ├─ 创建快捷方式
    └─ 注册 .agenttheme 文件关联
                          ↓
  用户双击 AgentSkin.exe（首次启动）
                          ↓
  Electron 主程序（main.ts）：
    ├─ detectInstallation() ← 路径检测
    ├─ seedBuiltInThemes()  ← 主题播种
    └─ agent-engine-service.applyTheme() ← 主题注入
```

### 风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| **安装器与目标应用零耦合** | ✅ 低风险 | 这是正确的设计。安装器不应知道目标应用的存在 |
| **Inno Setup 安装器也无耦合** | ✅ 低风险 | 同上，迁移后行为一致 |
| **NSIS 脚本无法传递检测数据** | ⚠️ 中风险 | 如果迁移后需要在安装器阶段检测目标应用路径，当前架构不支持。需引入独立预检工具 |

---

## 问题 2：`install-detection.ts` 的真实状态

### 事实陈述

`install-detection.ts` **已上线生产代码**，被 `AgentEngineService` 在每次查询应用状态时调用。它不是实验性代码，而是 Windows 端应用安装检测的核心模块。但它 **仅支持 Windows**，macOS 路径直接返回 `NOT FOUND`。

### 代码证据

#### 证据 2.1：唯一调用方 — `agent-engine-service.ts`

**文件**：`src/main/agent-engine-service.ts`

```typescript
// 第 8 行：导入
import { detectInstallation } from './install-detection';

// 第 328-339 行：在 appStatus() 方法中调用
const probe = await detectInstallation({
  platform: process.platform,
  appPath: override.appPath,
  hints: adapter.installHints,
  displayName: PRODUCT_DISPLAY_NAMES[appId],
  logFile: this.detectionLogFile,
});
const installed = coreInstalled || probe.installed;  // 合并 @codedrobe/core 检测结果
```

调用链：`core.status()` → `appStatus(appId)` → `detectInstallation(opts)`。每次 UI 轮询系统状态时都会执行。

#### 证据 2.2：适配器提供 `InstallHints`

**文件**：`src/adapters/base.ts`，第 61-71 行

```typescript
export interface InstallHints {
  dirNames: string[];       // 安装目录名
  exeNames: string[];       // 可执行文件名
  registryNames: string[];  // 注册表 DisplayName 子串
}
```

**文件**：`src/adapters/domestic/trae.ts`，第 14-18 行

```typescript
readonly installHints: InstallHints = {
  dirNames: ['Trae', 'Trae CN'],
  exeNames: ['Trae.exe'],
  registryNames: ['Trae'],
};
```

**文件**：`src/adapters/domestic/qoder.ts`，第 17-22 行

```typescript
readonly installHints: InstallHints = {
  dirNames: ['QoderWork CN', 'QoderWork CN\\QoderWork CN'],
  exeNames: ['QoderWork CN.exe'],
  registryNames: ['QoderWork CN', 'QoderWork'],
};
```

**文件**：`src/adapters/domestic/workbuddy.ts`，第 14-18 行

```typescript
readonly installHints: InstallHints = {
  dirNames: ['WorkBuddy'],
  exeNames: ['WorkBuddy.exe'],
  registryNames: ['WorkBuddy'],
};
```

#### 证据 2.3：macOS 检测直接返回 NOT FOUND

**文件**：`src/main/install-detection.ts`，第 198-207 行

```typescript
export async function detectInstallation(opts: DetectInstallationOptions): Promise<InstallDetection> {
  const { platform, appPath, hints, displayName, logFile } = opts;
  const empty: InstallDetection = { installed: false, path: null, version: null, source: null };

  if (platform !== 'win32' || !hints) {
    if (logFile) {
      await appendLog(logFile, formatLogEntry(stamp, displayName, [], 
        'n/a (unsupported platform)', 'NOT FOUND', empty));
    }
    return empty;  // ← macOS 直接返回未安装
  }
  // ... 后续 Windows 专用逻辑
}
```

#### 证据 2.4：数据结构

**文件**：`src/main/install-detection.ts`，第 14-21 行

```typescript
export interface InstallDetection {
  installed: boolean;
  path: string | null;       // 安装目录或可执行文件目录
  version: string | null;    // 从 exe 版本信息读取
  source: 'path' | 'registry' | 'core' | null;
}
```

#### 证据 2.5：检测日志写入

**文件**：`src/main/agent-engine-service.ts`，第 107 行

```typescript
this.detectionLogFile = path.join(path.dirname(stateFile), 'logs', 'agent-detection.log');
```

日志写入 `userData/logs/agent-detection.log`，供问题排查使用。

### 直接复用到 Inno Setup 的可行性评估

| 维度 | 评估 | 说明 |
|------|------|------|
| **能否直接复用** | ❌ 不可直接复用 | `install-detection.ts` 是 TypeScript/Node.js 模块，Inno Setup 的 `[Code]` 段使用 Pascal Script，两者语言完全不兼容 |
| **逻辑能否移植** | ✅ 可以移植 | 检测算法（文件系统扫描 + 注册表查询）可以用 PowerShell 脚本实现，Inno Setup 通过 `Exec()` 调用 |
| **数据格式兼容性** | ✅ 兼容 | `InstallDetection` 结构的 4 个字段可以直接映射到 Inno Setup 的变量 |
| **macOS 部分** | ❌ 无法移植 | 当前 macOS 路径为空，Inno Setup 仅用于 Windows，这不是问题 |

### 风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| **TypeScript → Pascal 移植** | ⚠️ 中风险 | PowerShell 检测逻辑可移植，但需重写为 Inno Setup `[Code]` 段可调用的形式 |
| **macOS 缺失** | ℹ️ 不影响 Inno 迁移 | Inno Setup 仅用于 Windows，macOS 检测缺失不是本次迁移的 blocker |
| **注册表权限** | ✅ 低风险 | 当前安装器使用 HKCU（per-user），与 `install-detection.ts` 的注册表查询范围一致 |

---

## 问题 3：主题注入机制与安装器的耦合度

### 事实陈述

**安装器不参与任何主题注入或环境初始化操作。** 完整的"安装 → 首次启动 → 主题生效"链路如下：

```
安装器阶段（NSIS/Inno Setup）：
  1. 解压 AgentSkin.exe 和资源文件
  2. 写入 HKCU 卸载注册表
  3. 创建快捷方式
  4. 注册 .agenttheme 文件关联
  5. 结束 ← 安装器职责到此为止

首次启动阶段（Electron main.ts → AgentEngineService）：
  1. app.whenReady() → library.initialize() → 创建 userData/themes 目录
  2. seedBuiltInThemes() → ThemeInstaller → 将 themes/ 目录下的 12 个内置主题
     转换为 .codedrobe-theme 格式 → 安装到 userData/themes/
  3. core.initialize() → 加载 manager-state.json 恢复上次的主题绑定
  4. UI 渲染 → 用户点击"应用主题" → IPC → AgentEngineService.apply()
  5. adapter.applyTheme() → @codedrobe/core.applySkin() → CDP 注入 CSS
  6. agent-scheme.ts → CDP 切换亮/暗色模式
  7. 主题生效
```

### 代码证据

#### 证据 3.1：NSIS 安装器无主题相关逻辑

**文件**：`build/installer.nsh`

`customInstall` 宏（第 49-91 行）仅记录文件计数、注册表、快捷方式和文件关联。无任何主题相关操作。

#### 证据 3.2：Inno Setup 安装器无主题相关逻辑

**文件**：`build/inno/agentskin.iss`

`RunPostInstall` 过程（第 215-239 行）仅验证 `AgentSkin.exe` 存在。无任何主题注入。

#### 证据 3.3：内置主题播种在首次启动时完成

**文件**：`src/main.ts`，第 190-203 行

```typescript
// Seed built-in themes from themes/ directory into the library (P3.1).
const themesDir = getThemesDir();
const bootThemes = await library.summaries();
const installedIds = new Set(bootThemes.map((t) => t.id));
const installedVersions = new Map(bootThemes.map((t) => [t.id, t.version]));
await seedBuiltInThemes(library, themesDir, installedVersions);
// Remove built-in themes that were dropped from the bundle (upgrade path).
await pruneRemovedBuiltInThemes(library, installedIds);
```

#### 证据 3.4：主题注入通过 `@codedrobe/core` 的 `applySkin()` 完成

**文件**：`src/legacy/codedrobe-core-runtime.ts`，第 86-100 行

```typescript
export function applyTheme(params: ApplyThemeParams): Promise<ApplySkinResult> {
  const adapter = getAdapter(params.coreId);
  return applySkin({
    adapter,
    targetTheme: params.targetTheme,
    port: params.port,
    launch: params.launch,
    appPath: params.appPath,
    restartExisting: params.restartExisting,
    timeoutMs: params.timeoutMs,
  });
}
```

`@codedrobe/core` 是一个 npm 包（`node_modules/@codedrobe/core`），**不是 CLI 工具，也不通过 IPC 通信**。它通过 CDP WebSocket 直接连接到目标应用的渲染进程。

#### 证据 3.5：CDP 注入是运行时行为

**文件**：`src/main/cdp-client.ts`，第 24-28 行

```typescript
export function connectCdp(webSocketDebuggerUrl: string, openTimeoutMs = 5000): Promise<CdpSession> {
  const ws = new WebSocket(webSocketDebuggerUrl);
  // ...
}
```

CDP 连接通过 WebSocket 发起，目标地址是 `ws://localhost:<port>/devtools/page/<id>`，完全依赖目标应用已启动并启用了远程调试端口。

### 安装器职责边界

```
┌─────────────────────────────────────────────────────────────┐
│                    安装器职责（NSIS/Inno Setup）              │
│                                                             │
│  ✅ 解压 Electron 应用文件                                    │
│  ✅ 写入卸载注册表（HKCU）                                    │
│  ✅ 创建快捷方式                                              │
│  ✅ 注册 .agenttheme 文件关联                                 │
│  ✅ 验证 AgentSkin.exe 存在                                   │
│                                                             │
│  ❌ 不检测目标应用安装                                        │
│  ❌ 不注入主题 CSS                                            │
│  ❌ 不调用 @codedrobe/core                                   │
│  ❌ 不进行 CDP 连接                                           │
│  ❌ 不处理亮/暗色模式同步                                     │
└─────────────────────────────────────────────────────────────┘
```

### 风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| **安装器无需主题注入** | ✅ 低风险 | 主题注入是运行时行为，安装器不应参与 |
| **首次启动种子逻辑已完善** | ✅ 低风险 | `seedBuiltInThemes()` + `pruneRemovedBuiltInThemes()` 覆盖了安装和升级两种场景 |
| **Inno Setup 安装后启动** | ✅ 低风险 | `agentskin.iss` 的 `[Run]` 段（第 52 行）配置了 `nowait postinstall skipifsilent`，安装完成后自动启动 AgentSkin |

---

## 问题 4：现有 CI/CD 与签名流程

### 事实陈述

**当前 Windows 安装包（NSIS + WiX MSI）未经过数字签名。** 代码库中没有任何 Windows 代码签名配置。仅 macOS 构建了代码签名流程。

### 代码证据

#### 证据 4.1：`forge.config.ts` — 仅 macOS 签名

**文件**：`forge.config.ts`，第 10-13、60-68 行

```typescript
const macosSign = process.env.MACOS_SIGN === '1';
const macosNotarize =
  macosSign &&
  Boolean(process.env.APPLE_API_KEY) &&
  ...

// 打包配置
osxSign: macosSign ? {} : undefined,
osxNotarize: macosNotarize ? { ... } : undefined,
```

**无** `win.sign`、`win.publisherName`、`winTimestampUrl` 等任何 Windows 签名配置。

#### 证据 4.2：`electron-builder.yml` — 无签名

**文件**：`electron-builder.yml`

全文 42 行，**无任何签名相关字段**。`publish: null` 表示不启用自动发布。

#### 证据 4.3：`build/installer.nsh` — NSIS 无签名

**文件**：`build/installer.nsh`

全文 158 行，**无任何签名相关指令**（如 `SignTool`、`!addplugindir` 等）。

#### 证据 4.4：`build/inno/agentskin.iss` — Inno Setup 无签名

**文件**：`build/inno/agentskin.iss`

全文 277 行，**无任何签名相关指令**（如 `SignTool=` 段、`SignedUninstaller=yes` 等）。

#### 证据 4.5：`.github/workflows/build.yml` — 仅 macOS 签名

**文件**：`.github/workflows/build.yml`，第 77-133 行

```yaml
- name: Import code signing credentials
  env:
    MACOS_CERT_P12_BASE64: ${{ secrets.MACOS_CERT_P12_BASE64 }}
    MACOS_CERT_PASSWORD: ${{ secrets.MACOS_CERT_PASSWORD }}
    APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY_BASE64 }}
```

此步骤仅导入 macOS 开发者证书（P12）和 Apple API Key。

#### 证据 4.6：Windows 构建步骤无签名

**文件**：`.github/workflows/build.yml`，第 173-188 行

```yaml
- name: Build WiX MSI and packaged application
  run: npm run make -- --arch=x64

- name: Build NSIS and Portable executables
  run: npm run make:windows:installers
```

**无任何签名步骤**。构建完成后直接上传 artifact。

#### 证据 4.7：`build-installer.bat` 本地构建无签名

**文件**：`build-installer.bat`

全文 140 行，**无任何 signtool、签名或证书相关调用**。

### 签名现状总结

| 平台 | 应用签名 | 安装包签名 | 公证/SmartScreen |
|------|---------|-----------|-----------------|
| **macOS** | ✅ Developer ID (P12) | ✅ codesign | ✅ Notarization (API Key) |
| **Windows (NSIS)** | ❌ 未配置 | ❌ 未配置 | ❌ 无 SmartScreen 优化 |
| **Windows (WiX MSI)** | ❌ 未配置 | ❌ 未配置 | ❌ 无 SmartScreen 优化 |
| **Windows (Portable)** | ❌ 未配置 | N/A | N/A |

### 迁移 Inno Setup 后的签名集成方案

由于当前 Windows 签名完全缺失，迁移 Inno Setup 时需要 **从零搭建** Windows 签名流程。建议方案：

```ini
; Inno Setup 6 [Setup] 段
SignTool=signtool sign /fd sha256 /td sha256 /tr http://timestamp.ssl-comms.com /d "AgentSkin" /durl "https://agentskin.app" $f

; CI 中注入证书
- name: Import Windows signing certificate
  env:
    WINDOWS_CERT_PFX_BASE64: ${{ secrets.WINDOWS_CERT_PFX_BASE64 }}
    WINDOWS_CERT_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
```

### 风险评估

| 风险 | 级别 | 说明 |
|------|------|------|
| **Windows 安装包无签名** | 🔴 高风险 | 用户下载后将看到 "Windows 保护了你的 PC" 拦截提示，SmartScreen 评级为 "未知发布者" |
| **NSIS 和 Inno 均无签名** | ℹ️ 不影响迁移决策 | 迁移本身不会引入新的签名风险 |
| **需从零搭建签名流程** | ⚠️ 中风险 | 需要采购 EV 证书（推荐）或代码签名证书，配置 CI 自动化 |
| **macOS 签名流程可参考** | ✅ 低风险 | macOS 的 P12 导入 + 环境变量传递模式可直接借鉴 |

---

## 附录：关键文件索引

| 文件 | 行数 | 关键内容 |
|------|------|---------|
| `build/installer.nsh` | 158 | NSIS 安装器钩子（无目标应用检测） |
| `build/inno/agentskin.iss` | 277 | Inno Setup 安装器（无主题注入） |
| `electron-builder.yml` | 42 | NSIS 配置（perMachine: false） |
| `forge.config.ts` | 114 | Wix MSI 配置（无签名） |
| `src/main.ts` | 487 | 主程序入口（主题播种 + IPC 注册） |
| `src/main/agent-engine-service.ts` | 481 | 应用状态查询（调用 detectInstallation） |
| `src/main/install-detection.ts` | 310 | Windows 安装检测（macOS 返回 NOT FOUND） |
| `src/legacy/codedrobe-core-runtime.ts` | 217 | @codedrobe/core 封装层 |
| `src/main/cdp-client.ts` | 108 | CDP WebSocket 客户端 |
| `src/main/agent-scheme.ts` | 228 | 亮/暗色模式同步策略 |
| `src/main/theme-library.ts` | 336 | 主题包管理 |
| `src/main/catalog/theme-seeder.ts` | 128 | 内置主题播种器 |
| `src/main/catalog/theme-installer.ts` | 257 | 主题包安装器 |
| `src/shared/types.ts` | 364 | 全局类型定义 |
| `src/adapters/base.ts` | 221 | 适配器基类 + InstallHints |
| `.github/workflows/build.yml` | 248 | CI 流水线（仅 macOS 签名） |
| `build-installer.bat` | 140 | 本地构建脚本（无签名） |
