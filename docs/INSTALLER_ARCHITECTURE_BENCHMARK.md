# 安装程序架构对标基准——五维成熟度标准参照

> **版本**: v1.0
> **参照基准**: AgentSkin NSIS Installer (`build/installer.nsh`)
> **适用范围**: 基于 electron-builder + NSIS 的 Windows 桌面应用安装器
> **用途**: 作为安装器项目的逐项对标自检标准，明确「已达标 / 未达标 / 不适用」

---

## 迁移说明（2026-07 更新）

本文档原用于对标基于 **DuiLib_Ultimate** 自定义 UI 框架 + **electron-builder 自定义 NSIS 脚本** 的传统安装器方案。该项目已于 2026 年 7 月迁移至 **electron-builder 内置 NSIS** 方案，简化后的构建流程为：

1. `electron-vite build` — 打包前端代码
2. `electron-builder --win --x64` — 直接生成 NSIS 安装包

迁移后不再需要以下组件：
- `Build-Plugin.ps1` — DuiLib 插件编译脚本
- `generate-payload.mjs` — 负载生成脚本
- `cmake` + `DuiLib_Ultimate` — 自定义 UI 框架及构建工具
- `build/installer.nsh` — 自定义 NSIS 脚本

安装包输出路径变更为：`out/make/v{version}/AgentSkin-{version}-x64-Setup.exe`

> **注意**: 本文档保留作为历史架构对标记录，供参考比较。当前项目实际使用的是 electron-builder 内置 NSIS（配置位于 `electron-builder.yml` 的 `nsis:` 区块）。

---

## 文档说明

本文档将安装器架构分解为 **五大维度**，每个维度拆分为若干 **子项**，每个子项进一步拆分为可逐条核对的 **细项指标**。

使用者按以下格式自行完成对标检查：

```
[ ] 已实现  [ ] 部分实现  [ ] 未实现  [ ] 不适用
```

完成后即可明确当前项目距离「以 AgentSkin/Mineradio 为标准」的差距所在。

---

## 维度一：安全的安装/卸载保护机制

> 核心目标：防止安装到错误目录、防止误删非本应用文件、防止旧版本残留冲突。

### 1.1 目录归属校验

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 1.1.1 | **专属目录强制校验** — 安装路径必须为独立的 `\AppName` 子目录，不能是已有其他文件的通用文件夹 | `AgentSkinValidateInstallDir` 检查路径后缀必须为 `\AgentSkin` 或 `\agentskin`，非专属则 `Abort` | [ ] |
| 1.1.2 | **目录空检查（非空阻断）** — 防止误安装到已有其他用户的文件目录 | `IfFileExists "$INSTDIR\*.*"` 检查非空且有内容则拒绝；但若已有 marker 或 `.exe` 证明属于本应用则允许 | [ ] |
| 1.1.3 | **最大深度防护** — 避免多层嵌套路径导致安装深度过深 | 路径分隔符计数超过 `AS_MAX_DEPTH`（默认 4）时自动重置为 `X:\AppName` | [ ] |
| 1.1.4 | **安装前进程清理** — 安装前强制终止应用进程，避免文件被占用 | `customInit` 中连续 3 次 `taskkill /F /IM AgentSkin.exe /T` + `Sleep` 间隔确保进程彻底退出 | [ ] |

### 1.2 Marker 机制（安装/卸载双向标记）

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 1.2.1 | **marker 文件写入** — 安装成功后在安装根目录写入标记文件 | `AgentSkinWriteMarker` 在 `customInstall` 中写入 `.agentskin-install-root`，内含 `appId`、`version`、`product`、`installedAt` 元数据 | [ ] |
| 1.2.2 | **marker 文件读取验证** — 卸载前读取同一 marker 文件确认目录归属 | `un.AgentSkinInstallDirLooksOwned` 检查 marker 存在性并验证首行包含 `appId=` | [ ] |
| 1.2.3 | **双向对称校验** — 安装写 marker、卸载读 marker，两端逻辑一致且相互依赖 | 安装时 `customInstall` → `AgentSkinWriteMarker`；卸载时 `customUnInit` → `un.AgentSkinValidateUninstallDir` | [ ] |
| 1.2.4 | **marker 清理** — 卸载流程结束后删除 marker 文件 | `un.AgentSkinRemoveMarker` 在 `customUnInstall` 中 Delete marker | [ ] |

### 1.3 旧版本清理

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 1.3.1 | **旧 uninstaller 检测清理** — 自动识别并删除不带 marker 残留的旧版 uninstaller 文件 | `AgentSkinDeleteLegacyUninstaller`：无 marker 则 `FindFirst` 遍历并 `Delete` 旧 `Uninstall *.exe` | [ ] |
| 1.3.2 | **旧注册表项清理** — 清除已存在的旧版卸载注册表键值（HKCU + HKLM 双向） | `customInit` 中检测到旧安装后删除 `INSTALL_REGISTRY_KEY`、`UNINSTALL_REGISTRY_KEY`、`Uninstall\${APP_ID}` 等键 | [ ] |
| 1.3.3 | **旧文件强制删除** — 升级安装时彻底删除旧版本目录 | `customInit` 中 `RMDir /r "$1"` 清除旧安装路径后再继续安装 | [ ] |
| 1.3.4 | **升级路径硬清理** — 升级时清理注册表 + 旧文件 + 卸载入口，确保无残留 | `AgentSkinExistingInstallPathCanBeAdopted` 校验通过后执行完整的注册表 + 目录 + 卸载键清理 | [ ] |

### 1.4 安装模式安全

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 1.4.1 | **静默模式安全校验** — 无 UI 静默安装时仍执行核心目录校验 | `customInit` 中 `${If} ${Silent}` 分支下调用 `AgentSkinValidateInstallDir`，不绕过专属目录要求 | [ ] |
| 1.4.2 | **静默模式失败退出** — 静默模式下校验失败应 `Quit` 而非继续 | `${If} ${Silent}` + 校验失败 → `LogDetail "SILENT: directory validation FAILED"` + `Quit` | [ ] |
| 1.4.3 | **per-user 模式** — 默认 HKCU 安装，无需管理员权限 | `perMachine: false` + `customInstallMode` 日志确认 | [ ] |

### 1.5 卸载保护

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 1.5.1 | **卸载前目录归属验证** — 确认 $INSTDIR 确实属于本应用才执行卸载 | `un.AgentSkinValidateUninstallDir` → `un.AgentSkinInstallDirLooksOwned` | [ ] |
| 1.5.2 | **归属的目录阻止卸载** — 目录不属于本应用时阻止卸载并给出中文提示 | 校验失败 → `MessageBox MB_ICONSTOP` + `Quit`（非 Abort，直接退出卸载流程） | [ ] |

---

## 维度二：智能路径决策

> 核心目标：让用户无需手动选择路径，同时在有明确意图时支持精确控制。

### 2.1 路径输入方式

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 2.1.1 | **命令行参数覆盖支持** — 允许 `/D=<path>` 命令行参数强制指定安装目录 | `${GetParameters} $R0` 提取 `/D=...`，配合 electron-builder 原生 `$INSTDIR` 覆盖 | [ ] |
| 2.1.2 | **命令行参数日志记录** — 静默安装时记录命令行参数便于排查 | `AgentSkinDetectCommandLineDir` 将 `/D=` 值写入安装日志 | [ ] |
| 2.1.3 | **注册表遗留位置探测** — 自动从注册表读取之前安装的记录并沿用 | `ReadRegStr HKCU/HKLM\...\InstallLocation` 两级读取已有路径 | [ ] |
| 2.1.4 | **注册表路径不可用时回退** — 读到的注册表路径无效时走 fallback 而非崩溃 | 空值被当作「未发现」处理，清空后走默认路径逻辑 | [ ] |

### 2.2 路径校验与采纳

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 2.2.1 | **已安装路径合法性再判定** — 读到的注册表路径需经过 `CanBeAdopted` 校验才能沿用 | `AgentSkinExistingInstallPathCanBeAdopted` 检查路径下是否有 marker、`AgentSkin.exe`、`resources\app.asar` 等标志性文件 | [ ] |
| 2.2.2 | **无后缀路径自动补全** — 注册表路径不以 `\AppName` 结尾时自动尝试补全 | `AgentSkinExistingInstallPathCanBeAdopted` 检查后缀，不匹配则尝试追加 `\${AS_DIR_NAME}` | [ ] |
| 2.2.3 | **采纳失败日志记录** — 校验失败时记录原因便于诊断 | `!insertmacro LogDetail "Registry path rejected (not adoptable): $0"` | [ ] |

### 2.3 路径规范化

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 2.3.1 | **路径尾斜杠修剪** — 自动去除路径末尾多余的斜杠符号 | `AgentSkinTrimInstallDir` 循环去除尾部 `\`，标准化格式 | [ ] |
| 2.3.2 | **路径规范化（归一化）** — 确保最终路径为 `\AppName` 的子目录形式 | `AgentSkinNormalizeInstallDir` 检查并补足缺失的 `\AgentSkin` 后缀，保证最终形式为 `X:\AgentSkin` | [ ] |
| 2.3.3 | **短盘符校验** — 输入如 `C:` 这样的短盘符时自动补全为 `C:\AppName` 格式 | `AgentSkinNormalizeInstallDir` 判断盘符长度 ≤ 3 字符时特殊处理逻辑 | [ ] |
| 2.3.4 | **深度超限自动修正** — 当检测到路径嵌套过深时自动重置 | 反斜杠计数超过 `AS_MAX_DEPTH` → 取盘符前 2 字符 + `\${AS_DIR_NAME}` | [ ] |

### 2.4 默认盘位智能扫描

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 2.4.1 | **非 C 盘优先** — 当无命令行且无合法注册表路径时，扫描非 C 盘作为默认首选 | `AgentSkinUseFirstAvailableInstallDir` 顺序扫描 D-Z 盘，首个存在即设为 `$INSTDIR` | [ ] |
| 2.4.2 | **C 盘兜底** — 仅当 D-Z 盘均不可用时才回退到 C 盘默认路径 | D-Z 扫描全部失败 → `as_scan_fallback` → 保持 electron-builder 默认 `$LOCALAPPDATA\Programs\AgentSkin` | [ ] |
| 2.4.3 | **重复安装识别** — 目标盘已有 AgentSkin 目录且带 marker 时视为重复安装复用该目录 | `IfFileExists "$0:\${AS_DIR_NAME}\${AS_MARKER_FILE}"` → 直接采纳 | [ ] |
| 2.4.4 | **已占用跳过** — 目标盘已有 AgentSkin 目录但不属于本应用时跳过该盘 | 目录存在但无 marker → `as_scan_next` 继续下一盘符 | [ ] |

---

## 维度三：UI 细节打磨

> 核心目标：安装界面视觉统一、品牌感强、中文字体渲染准确。

### 3.1 窗口效果

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 3.1.1 | **DWM Mica/Acrylic 玻璃效果** — 调用 `DwmSetWindowAttribute` 启用 Win11 系统级背景材质 | `AgentSkinEnableDwmGlass` 设置属性 19（`DWMWA_SYSTEMBACKDROP_TYPE`）= 2（Mica）+ 属性 20（暗色模式）= 0 | [ ] |
| 3.1.2 | **圆角窗口** — 调用 `CreateRoundRectRgn` + `SetWindowRgn` 实现窗口圆角 | `ApplyRoundedCorners` 宏，半径 24px，在 `customInit` / `customInstall` / `customUnInit` / `customUnInstall` 各阶段均重新应用 | [ ] |
| 3.1.3 | **最佳-effort 兼容** — DWM 和圆角在 Win10 上静默失败而非报错 | `System::Call` 返回值忽略，不做错误检查 | [ ] |

### 3.2 色彩系统

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 3.2.1 | **统一色彩变量定义** — 在文件顶部集中定义所有界面颜色变量 | `AS_ACCENT_HEX "7C3AED"`、`AS_SURFACE_HEX "F5F5F7"`、`AS_TEXT_HEX "1D1D1F"`、`AS_TEXT_LIGHT_HEX "6E6E73"` | [ ] |
| 3.2.2 | **品牌强调色使用** — 用产品主色调标识重要信息（如默认路径、链接） | 确认页路径显示为品牌紫色 `7C3AED`，Next 按钮背景色 `7C3AED` | [ ] |
| 3.2.3 | **标题栏/按钮颜色逐个定制** — 通过 `SetCtlColors` 逐个设置每个控件的前景/背景色 | `AgentSkinTintCommonControls` 函数内对 `$HWNDPARENT` 下属每个控件 ID（1006/1/2/3）逐一调用 `SetCtlColors` | [ ] |
| 3.2.4 | **品牌色板自动生成** — 色彩值由 `scripts/branding.config.mjs` 单一数据源自动生成 NSIS include | `build/brand.nsh` 由 `scripts/generate-nsis-assets.mjs` 自动生成，标记 `AUTO-GENERATED`，禁止手动编辑 | [ ] |

### 3.3 字体系统

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 3.3.1 | **微软雅黑 UI 字体** — 全部使用 `Microsoft YaHei UI` 作为界面字体 | `AS_FONT_FAMILY "Microsoft YaHei UI"`，通过 `CreateFont` + `SendMessage WM_SETFONT` 应用到每个控件 | [ ] |
| 3.3.2 | **字号层级体系** — 建立 Hero / Title / Body / Small 四个明确字号层级 | 24px Hero（品牌大标题）、15px Title（页标题）、9px Body（正文说明）、8px Small（辅助说明/小字） | [ ] |
| 3.3.3 | **字重区分** — 不同层级使用不同字重（700 bold / 400 regular / 500 medium） | Hero/Title 用 700，Body 用 400，Small 用 500，形成视觉层次 | [ ] |
| 3.3.4 | **MUI 页面字体统一** — MUI 标准页面（Welcome/Directory/Finish）的字体与自定义页一致 | `!define MUI_FONT '${AS_FONT_FAMILY}'` + `!define MUI_FONT_TITLE '${AS_FONT_FAMILY}'` | [ ] |

### 3.4 自定义页面

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 3.4.1 | **nsDialogs 自定义页面** — 使用 nsDialogs 创建确认安装页，取代传统 MUI 页面 | `Page custom AgentSkinConfirmPageCreate AgentSkinConfirmPageLeave` 创建自定义确认页 | [ ] |
| 3.4.2 | **确认页品牌标识** — 页首显示品牌名称标签（小字号+强调色） | `${NSD_CreateLabel} "AGENTSKIN"` + `SetCtlColors "${AS_ACCENT_HEX}" transparent` | [ ] |
| 3.4.3 | **确认页路径展示** — 用品牌色高亮显示最终安装路径 | `$INSTDIR` 显示为紫色 `7C3AED`，与正文形成视觉区分 | [ ] |
| 3.4.4 | **确认页操作指引** — 提供明确的下一步操作说明 | 底部提示 "点击「安装」开始。完成后可以立即启动 AgentSkin。如需更改位置，请点击「上一步」返回。" | [ ] |
| 3.4.5 | **页面切换效果保持** — 页面切换后重新应用 DWM/圆角/色彩效果 | `AgentSkinConfirmPageCreate` 中调用 `AgentSkinGuiInit` 确保每次页面切换后效果一致 | [ ] |

### 3.5 MUI 页面文本

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 3.5.1 | **中文化页面标题** — 所有 MUI 页面标题为中文 | `MUI_WELCOMEPAGE_TITLE "安装 AgentSkin"`、`MUI_FINISHPAGE_TITLE "安装完成"` 等 | [ ] |
| 3.5.2 | **中文化页面正文** — 所有 MUI 页面正文为中文 | `MUI_WELCOMEPAGE_TEXT`、`MUI_FINISHPAGE_TEXT`、`MUI_UNWELCOMEPAGE_TEXT` 等均为中文 | [ ] |
| 3.5.3 | **中文化确认提示** — 中止安装/卸载时的确认对话框为中文 | `MUI_ABORTWARNING_TEXT`、`MUI_UNABORTWARNING_TEXT` | [ ] |

---

## 维度四：错误处理的完整性

> 核心目标：所有路径/操作异常均有明确阻断 + 中文用户友好提示，不留静默失败。

### 4.1 输入校验阻断

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 4.1.1 | **空路径阻断** — 用户未填写任何目录时阻止继续 | `AgentSkinValidateInstallDir` 中 `StrCmp $INSTDIR ""` → `MessageBox MB_ICONSTOP` + `SetErrors` | [ ] |
| 4.1.2 | **非法目录阻断** — 目录不符合专属要求时阻止安装 | 路径后缀必须为 `\AgentSkin` → 不符则 `MessageBox MB_ICONSTOP` | [ ] |
| 4.1.3 | **专属目录格式错误阻断** — 目录名不是独立的 `\AppName` 子文件夹时阻止 | `StrCmp $1 "\${AS_DIR_NAME}"` 不匹配 → `Abort` 停留当前页 | [ ] |
| 4.1.4 | **已有内容目录校验** — 非空且无 marker 的目录视为非法，阻止安装 | `IfFileExists "$INSTDIR\*.*"` + 无 marker + 无 exe → `MessageBox MB_ICONSTOP` | [ ] |
| 4.1.5 | **确认页离开校验** — 用户点击「安装」按钮时触发最终路径校验 | `AgentSkinConfirmPageLeave` 调用 `AgentSkinValidateInstallDir` + `IfErrors 0` → `Abort` 停留页面 | [ ] |

### 4.2 系统调用异常兜底

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 4.2.1 | **注册表读取失败兜底** — `ReadRegStr` 返回空值时走后续 fallback 分支而非崩溃 | `ReadRegStr $0 ...` 后 `${If} $0 == ""` 处理，空值被当作「未发现」 | [ ] |
| 4.2.2 | **taskkill 失败容忍** — 进程不存在时 taskkill 报错但不终止安装流程 | `nsExec::Exec 'taskkill ...'` 返回值 Pop 到 `$0` 但不做 IfErrors 判断 | [ ] |
| 4.2.3 | **DWM 调用失败容忍** — Win10 上不支持的属性不导致安装失败 | `System::Call 'dwmapi::DwmSetWindowAttribute(...)' i .r0` 但不对 `$r0` 做判断 | [ ] |
| 4.2.4 | **FindFirst 无结果处理** — 遍历文件时若无匹配文件正常退出循环 | `FindFirst` → `${Do}` → `StrCmp $1 "" as_legacy_nomore` → `FindClose` | [ ] |

### 4.3 安全模式不降级

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 4.3.1 | **静默模式不跳过校验** — `${If} ${Silent}` 分支下依然调用完整校验逻辑 | `${If} ${Silent}` → `Call AgentSkinValidateInstallDir` → `IfErrors 0` → `Quit` | [ ] |
| 4.3.2 | **静默模式校验失败退出** — 静默模式下校验失败必须 `Quit` 而非弹出对话框 | 校验失败分支 → `LogDetail "SILENT: directory validation FAILED, aborting"` → `Quit` | [ ] |

### 4.4 用户提示友好性

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 4.4.1 | **中文友好提示** — 所有错误消息为中文，且包含操作指引 | "安装目录必须是独立的 AgentSkin 文件夹。$\r$\n例如：D:\AgentSkin" | [ ] |
| 4.4.2 | **弹窗阻断类型明确** — 使用 `MB_ICONSTOP` 等图标类型传达严重性 | 所有阻断性错误使用 `MB_ICONSTOP\|MB_OK` | [ ] |
| 4.4.3 | **多行提示格式** — 使用 `$\r$\n` 换行符分隔标题和说明文字 | MessageBox 内统一格式：`标题。$\r$\n详细说明或示例。` | [ ] |

---

## 维度五：架构清晰性与可维护性

> 核心目标：代码组织有序、命名语义清晰、职责单一、修改局部化。

### 5.1 配置管理

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 5.1.1 | **配置集中式宏定义** — 所有常量在文件顶部通过 `!define` 集中管理 | `AS_DIR_NAME`、`AS_MARKER_FILE`、`AS_LOG_DIR`、`AS_MAX_DEPTH`、`AS_ACCENT_HEX` 等全部在 SECTION 1 集中 | [ ] |
| 5.1.2 | **无魔法字符串** — 代码体中不出现未定义为常量的字符串字面量 | 所有产品名引用 `${AS_DIR_NAME}`、路径引用 `${AS_LOG_DIR}`，无硬编码 | [ ] |
| 5.1.3 | **品牌色板自动同步** — 品牌色彩值单一数据源 → 自动生成 → include 引用 | `scripts/branding.config.mjs` (source) → `scripts/generate-nsis-assets.mjs` (gen) → `build/brand.nsh` (output) → `!include "brand.nsh"` | [ ] |

### 5.2 函数模块化

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 5.2.1 | **功能模块化函数分离** — 每条功能链路由独立函数承担，职责单一 | `AgentSkinTrimInstallDir`（修剪）/ `AgentSkinNormalizeInstallDir`（规范化）/ `AgentSkinValidateInstallDir`（校验）/ `AgentSkinUseFirstAvailableInstallDir`（扫描）/ `AgentSkinExistingInstallPathCanBeAdopted`（采纳）各自独立 | [ ] |
| 5.2.2 | **函数命名语义清晰** — 函数名直接表达其目的 | 命名遵循 `[动作][对象]` 模式：`AgentSkinValidateInstallDir`、`AgentSkinNormalizeInstallDir`、`AgentSkinEnableDwmGlass` 等 | [ ] |
| 5.2.3 | **安装与卸载逻辑对称** — 安装写 marker ↔ 卸载读 marker；安装校验目录 ↔ 卸载也校验目录 | `AgentSkinWriteMarker` ↔ `un.AgentSkinRemoveMarker`；`AgentSkinValidateInstallDir` ↔ `un.AgentSkinValidateUninstallDir` | [ ] |
| 5.2.4 | **卸载逻辑独立命名空间** — 卸载相关函数以 `un.` 前缀标识 | `un.AgentSkinInstallDirLooksOwned`、`un.AgentSkinValidateUninstallDir`、`un.AgentSkinRemoveInstalledFiles`、`un.AgentSkinCleanRegistry` | [ ] |

### 5.3 编译时分支

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 5.3.1 | **安装/卸载代码物理隔离** — 使用 `!ifndef BUILD_UNINSTALLER` / `!ifdef BUILD_UNINSTALLER` 分离 | 安装函数块 `!ifndef BUILD_UNINSTALLER` ... `!endif`；卸载函数块 `!ifdef BUILD_UNINSTALLER` ... `!endif` | [ ] |
| 5.3.2 | **宏定义结构化组织** — 整个脚本按功能块分节并有注释标记 | `SECTION 1: CONFIGURATION` → `SECTION 2: UTILITY MACROS` → `SECTION 3: INSTALLER FUNCTIONS` → `SECTION 4: UNINSTALLER FUNCTIONS` → `SECTION 5: INSTALLER HOOKS` → `SECTION 6: UNINSTALLER HOOKS` → `SECTION 7: MUI PAGE TEXT` | [ ] |

### 5.4 Hooks 注入

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 5.4.1 | **customInit 集中初始化** — 安装初始化阶段统一处理进程清理 + 路径决策 + 日志 + 静默校验 | `!macro customInit` → 进程终止 → 日志 → DWM → 命令行检测 → 注册表路径检测 → 扫描/路径规范化 → 静默校验 | [ ] |
| 5.4.2 | **customInstall 后置处理** — 文件安装完成后写入 marker + 清理旧卸载器 | `!macro customInstall` → 最终进程终止 → 圆角重应用 → `AgentSkinWriteMarker` → `AgentSkinDeleteLegacyUninstaller` → 日志 | [ ] |
| 5.4.3 | **customUnInit 卸载前置校验** — 卸载开始前验证目录归属 | `!macro customUnInit` → 日志 → `un.AgentSkinValidateUninstallDir` → DWM + 圆角 | [ ] |
| 5.4.4 | **customUnInstall 明确清理** — 卸载时显式删除文件列表 + 注册表 + 日志 | `!macro customUnInstall` → 圆角 → `un.AgentSkinRemoveMarker` → `un.AgentSkinRemoveInstalledFiles` → `un.AgentSkinCleanRegistry` → 日志 | [ ] |
| 5.4.5 | **customCheckAppRunning 进程检测** — 覆盖 electron-builder 默认的"应用正在运行"检测（跳过阻塞弹窗） | `!macro customCheckAppRunning` → PowerShell `Get-CimInstance Win32_Process` → `Stop-Process -Force` → `Sleep 2000` | [ ] |

### 5.5 日志系统

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 5.5.1 | **时间戳辅助宏** — 提供标准化时间戳生成 | `!macro TimeStamp` → `GetLocalTime` → 格式化 `$R9` | [ ] |
| 5.5.2 | **分级日志宏** — 主日志 + 缩进详情日志 | `LogMessage "=== Install started ==="`（主信息） / `LogDetail "Product: ..."`（缩进 4 空格） | [ ] |
| 5.5.3 | **安装全流程日志覆盖** — 关键节点均有日志记录 | `customInit` → 4 条、`customInstall` → 4 条、`customUnInit` → 4 条、`customUnInstall` → 4 条 | [ ] |
| 5.5.4 | **日志路径独立于安装目录** — 日志写入 `$LOCALAPPDATA\AppName\`，不受安装路径影响 | `AS_LOG_DIR "$LOCALAPPDATA\AgentSkin"` + `AS_LOG_FILE "${AS_LOG_DIR}\installer.log"` | [ ] |
| 5.5.5 | **日志目录自动创建** — 写入日志前确保目录存在 | `CreateDirectory "${AS_LOG_DIR}"` 在每次日志写入前调用 | [ ] |

### 5.6 卸载文件清理清单

| # | 细项指标 | 标准实现参照 | 状态 |
|---|----------|--------------|------|
| 5.6.1 | **显式文件删除列表** — 在 `RemoveInstalledFiles` 中逐个列出要删除的已知文件 | 逐个 `Delete` 已知文件（.exe、.dll、.pak、.bin 等） | [ ] |
| 5.6.2 | **子目录递归删除** — 列出名删除子目录 | `RMDir /r` 子目录（resources、locales、swiftshader、crashpad） | [ ] |
| 5.6.3 | **根目录尝试清除** — 文件删除后尝试移除根目录 | `RMDir "$INSTDIR"`（仅目录为空时成功） | [ ] |
| 5.6.4 | **卸载器自身删除** — 卸载器可执行文件也在清理列表中 | `Delete "$INSTDIR\Uninstall AgentSkin.exe"` | [ ] |

---

## 附录 A：快速统计

| 维度 | 子项数 | 已达标 | 未达标 | 不适用 |
|------|--------|--------|--------|--------|
| D1 安全保护 | 16 | | | |
| D2 路径决策 | 14 | | | |
| D3 UI 打磨 | 22 | | | |
| D4 错误处理 | 13 | | | |
| D5 架构清晰性 | 22 | | | |
| **合计** | **87** | | | |

---

## 附录 B：AgentSkin 安装器已知实现状态

> 如参照 AgentSkin 本身进行对标，以下为各子项的实现情况（供参考）：

- ✅ D1.1.1 专属目录强制校验 → `AgentSkinValidateInstallDir`
- ✅ D1.1.2 目录空检查 → `ValidateInstallDir` → `IfFileExists`
- ✅ D1.1.3 最大深度防护 → 反斜杠计数 > `AS_MAX_DEPTH` 时重置
- ✅ D1.1.4 安装前进程清理 → 3 次 taskkill + Sleep
- ✅ D1.2.1 marker 写入 → `AgentSkinWriteMarker` (`.agentskin-install-root`)
- ✅ D1.2.2 marker 读取验证 → `un.AgentSkinInstallDirLooksOwned`
- ✅ D1.2.3 双向对称校验 → 安装写 / 卸载读 + 验证
- ✅ D1.2.4 marker 清理 → `un.AgentSkinRemoveMarker`
- ✅ D1.3.1 旧 uninstaller 清理 → `AgentSkinDeleteLegacyUninstaller`
- ✅ D1.3.2 旧注册表清理 → 检测旧安装后 `DeleteRegKey`
- ✅ D1.3.3 旧文件强制删除 → `RMDir /r "$1"`
- ✅ D1.3.4 升级路径硬清理 → 注册表 + 目录 + 卸载键全清
- ✅ D1.4.1 静默模式校验 → `${If} ${Silent}` 分支校验
- ✅ D1.4.2 静默模式失败退出 → 校验失败 `Quit`
- ✅ D1.4.3 per-user 模式 → `perMachine: false`
- ✅ D1.5.1 卸载前验证 → `un.AgentSkinValidateUninstallDir`
- ✅ D1.5.2 非归属目录阻断 → `MessageBox + Quit`
- ✅ D2.1.1 命令行参数覆盖 → `${GetParameters}` 检测 `/D=`
- ✅ D2.1.2 命令行参数日志 → `AgentSkinDetectCommandLineDir`
- ✅ D2.1.3 注册表遗留探测 → `ReadRegStr HKCU/HKLM`
- ✅ D2.1.4 注册表回退 → `${If} $0 == ""` 走默认路径
- ✅ D2.2.1 路径采纳校验 → `AgentSkinExistingInstallPathCanBeAdopted`
- ✅ D2.2.2 无后缀补全 → 不匹配则追加 `\${AS_DIR_NAME}`
- ✅ D2.2.3 采纳失败日志 → `LogDetail "Registry path rejected"`
- ✅ D2.3.1 尾斜杠修剪 → `AgentSkinTrimInstallDir`
- ✅ D2.3.2 路径归一化 → `AgentSkinNormalizeInstallDir`
- ✅ D2.3.3 短盘符校验 → `StrLen $0 <= 3` 特殊处理
- ✅ D2.3.4 深度超限修正 → `AS_MAX_DEPTH` 判定
- ✅ D2.4.1 非 C 盘优先 → `AgentSkinUseFirstAvailableInstallDir` (D-Z 扫描)
- ✅ D2.4.2 C 盘兜底 → `as_scan_fallback`
- ✅ D2.4.3 重复安装识别 → `IfFileExists marker`
- ✅ D2.4.4 已占用跳过 → 目录存在无 marker → 下一盘符
- ✅ D3.1.1 DWM Mica → `AgentSkinEnableDwmGlass` 属性 19=2
- ✅ D3.1.2 圆角窗口 → `ApplyRoundedCorners $HWNDPARENT 24`
- ✅ D3.1.3 Win10 兼容 → 返回值不检查
- ✅ D3.2.1 色彩变量集中 → SECTION 1 `!define AS_ACCENT_HEX ...`
- ✅ D3.2.2 品牌强调色 → 路径 + Next 按钮使用 `7C3AED`
- ✅ D3.2.3 控件逐一定制 → `AgentSkinTintCommonControls`
- ✅ D3.2.4 色板自动生成 → `generate-nsis-assets.mjs`
- ✅ D3.3.1 微软雅黑字体 → `AS_FONT_FAMILY "Microsoft YaHei UI"`
- ✅ D3.3.2 字号层级体系 → 24/15/9/8 四级
- ✅ D3.3.3 字重区分 → 700/400/500
- ✅ D3.3.4 MUI 字体统一 → `MUI_FONT '${AS_FONT_FAMILY}'`
- ✅ D3.4.1 nsDialogs 自定义页面 → `AgentSkinConfirmPageCreate`
- ✅ D3.4.2 确认页品牌标识 → `NSD_CreateLabel "AGENTSKIN"`
- ✅ D3.4.3 确认页路径展示 → 紫色 `$INSTDIR`
- ✅ D3.4.4 确认页操作指引 → "点击「安装」开始..."
- ✅ D3.4.5 页面切换重应用 → `AgentSkinGuiInit` 内含 DWM + 圆角
- ✅ D3.5.1 中文化标题 → 所有 `MUI_*PAGE_TITLE`
- ✅ D3.5.2 中文化正文 → 所有 `MUI_*PAGE_TEXT`
- ✅ D3.5.3 中文化确认提示 → `MUI_ABORTWARNING_TEXT`
- ✅ D4.1.1 空路径阻断 → `StrCmp $INSTDIR ""`
- ✅ D4.1.2 非法目录阻断 → 后缀不匹配
- ✅ D4.1.3 专属目录格式错误 → `StrCmp $1 "\${AS_DIR_NAME}"`
- ✅ D4.1.4 已有内容校验 → `IfFileExists` 三重检查
- ✅ D4.1.5 确认页离开校验 → `AgentSkinConfirmPageLeave`
- ✅ D4.2.1 注册表读取兜底 → 空值 → fallback
- ✅ D4.2.2 taskkill 容忍 → Pop 不判断 IfErrors
- ✅ D4.2.3 DWM 失败容忍 → 返回值忽略
- ✅ D4.2.4 FindFirst 无结果 → `StrCmp $1 ""` 正常退出
- ✅ D4.3.1 静默不跳过校验 → `${If} ${Silent}` + `ValidateInstallDir`
- ✅ D4.3.2 静默失败退出 → `Quit`
- ✅ D4.4.1 中文提示 → 所有 MessageBox 内容中文
- ✅ D4.4.2 阻断类型明确 → `MB_ICONSTOP\|MB_OK`
- ✅ D4.4.3 多行换行 → `$\r$\n` 分隔
- ✅ D5.1.1 配置集中宏定义 → SECTION 1 全部 `!define`
- ✅ D5.1.2 无魔法字符串 → 全引用宏
- ✅ D5.1.3 色板单一数据源 → `branding.config.mjs → generate → brand.nsh`
- ✅ D5.2.1 功能模块化 → 5+ 独立函数
- ✅ D5.2.2 命名语义清晰 → `[动作][对象]` 模式
- ✅ D5.2.3 安装卸载对称 → `WriteMarker ↔ RemoveMarker`
- ✅ D5.2.4 卸载命名空间 → `un.*` 前缀
- ✅ D5.3.1 编译时物理隔离 → `!ifndef/!ifdef BUILD_UNINSTALLER`
- ✅ D5.3.2 分节组织 → 7 个 SECTION 注释标记
- ✅ D5.4.1 customInit 集中 → 完整流程 10+ 步
- ✅ D5.4.2 customInstall 后置 → marker + legacy
- ✅ D5.4.3 customUnInit 前置 → 校验 + DWM
- ✅ D5.4.4 customUnInstall 清理 → 文件 + 注册表 + 日志
- ✅ D5.4.5 customCheckAppRunning → PowerShell 静默终止
- ✅ D5.5.1 时间戳宏 → `!macro TimeStamp`
- ✅ D5.5.2 分级日志 → `LogMessage` / `LogDetail`
- ✅ D5.5.3 全流程覆盖 → 4 阶段各 4 条日志
- ✅ D5.5.4 日志路径独立 → `$LOCALAPPDATA\AgentSkin`
- ✅ D5.5.5 目录自动创建 → `CreateDirectory` + `FileOpen`
- ✅ D5.6.1 显式文件列表 → 20+ 个 Delete 逐一列出
- ✅ D5.6.2 子目录删除 → 4 个 `RMDir /r`
- ✅ D5.6.3 根目录清除 → `RMDir "$INSTDIR"`
- ✅ D5.6.4 卸载器自身删除 → `Delete "Uninstall AgentSkin.exe"`

---

## 附录 C：版本记录

| 版本 | 日期 | 变更说明 |
|------|------|----------|
| v1.0 | 2026-07-28 | 初版发布，基于 AgentSkin v5.8.7 安装器实现 |
