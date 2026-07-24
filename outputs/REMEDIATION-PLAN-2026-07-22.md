# AgentSkin Desktop 统一整改方案（基于项目病历 + 安装器重构）

> 输入文档：
> - `outputs/project-medical-report-2026-07-22-complete.md`（140+ 项发现，P0–P3 优先级）
> - `outputs/INSTALLER-REFACTOR-SPEC-ADAPTED.md`（Apple/AI Native 安装器重构指令，已含文件地址栏）
> 本文目标：**把所有整改项收敛成一份可执行的、带"文件操作地址栏"的工作流**，并修正病历中 2 处与真实代码不符的结论。
> 原则：**本文只规划，不改动任何项目文件**（与用户"不做任何修改"约束一致）。

---

## 0. 对病历（medical-report）的修正（必须先说清）

| 病历条目 | 病历说法 | 真实情况（已核实） | 行动影响 |
|---|---|---|---|
| §8.2 | `agentskin.iss` 第 23–24 行引用 `..\..\resources\icon.ico` / `installer-sidebar.bmp` / `installer-header.bmp`，路径不存在会编译报错 | 实测 `.iss` 第 23–24 行为 `OutputDir=..\..\out\inno` / `OutputBaseFilename=...`；全文 `grep` 不到 `SetupIconFile`/`WizardImageFile`/`resources\`，**无此问题** | **从整改清单移除 §8.2**；安装器重构仍以本文 §2（Apple 风）为准 |
| §11.3 | 搜索未找到 `tsconfig.json`，疑似缺失 | `tsconfig.json` 存在于仓库根（vite/main/preload 三份 config 均引用）；`typecheck`/`tsc --noEmit` 正常 | **从整改清单移除 §11.3**；如要判断 strictness，读 `tsconfig.json` 即可 |

> 其余病历条目（P0–P3）经交叉核对与上一轮审计一致，全部保留。

---

## 1. 工作流总览（4 条工作流，互不阻塞可并行）

| 工作流 | 对应病历 | 交付物 | 优先级锚点 |
|---|---|---|---|
| **W1 安装/部署现代化** | §5.2 §5.4 §8.1 §8.3 + 安装器重构 spec | 单一 Windows 安装管道 + 代码签名 + Apple 风 UI | P0/P2（管道归属先决） |
| **W2 死代码与架构减负** | §2.1 §2.2 §12.1 §12.2 §1.1 §1.2 §12.3 §9.1 §9.2 | 删除/拆分，降低耦合 | P0/P1/P3 |
| **W3 质量与正确性** | §2.3 §2.4 §2.5 §2.7 §6.1 §6.3 §3.3 §10.1 | a11y、错误映射、IPC 校验 | P0/P1 |
| **W4 测试与可维护性** | §4.1 §1.3 §7.1 §7.2 §11.1 §11.2 §5.1 §5.3 | 测试、i18n 拆分、依赖清理 | P1/P2/P3 |

---

## 2. W1 安装/部署现代化（与安装器重构 spec 合并）

> 本工作流是"安装器重构 spec"的工程落地版，所有视觉细节见 `INSTALLER-REFACTOR-SPEC-ADAPTED.md`（§0.5 决策门 / §1.1 / §2.4 / §3.4 / §4.4 已含逐文件地址栏）。

### W1-1 决策门：统一安装管道（P0，先做）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\build\inno\agentskin.iss` | 改 | 统一 `MyAppId`（行 12 `"agentskin-desktop"` → `com.agentskin.desktop`，对齐 electron-builder.yml 行 1） |
| `C:\Users\snowb\Desktop\work\desktop-main\electron-builder.yml` | 只读基准 | 行 1 `com.agentskin.desktop` 为权威 |
| `C:\Users\snowb\Desktop\work\desktop-main\forge.config.ts` | 只读基准 | 行 28 `app.agentskin.desktop` |
| `C:\Users\snowb\Desktop\work\desktop-main\build-with-inno.bat` | 改/接 | 接入 `package.json` scripts；ISCC 路径改为 `winget`/环境变量定位 |
| `C:\Users\snowb\Desktop\work\desktop-main\package.json` | 改 | 新增 `build:inno` / `dist:win` |
| `C:\Users\snowb\Desktop\work\desktop-main\.github\workflows\build.yml` | 改 | Windows 步骤接 Inno；处理 `*-Portable.exe` 校验（行 ~220，审计发现） |
| `C:\Users\snowb\Desktop\work\desktop-main\build\installer.nsh` | 改（仅保留 NSIS 时） | §8.1 仅 DetailPrint，无实质功能；若退役则删除 |

**决策 A（推荐）**：Inno 上位为 canonical，退役 NSIS + Forge WiX（解决 §5.2 双构建系统 + §8.1 空 NSIS）。
**决策 B**：NSIS 上位，Apple 风改到 `build/installer.nsh`。

### W1-2 代码签名（P2，高影响）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\build\inno\agentskin.iss` | 改 | 增加 `SignTool=agentskin` + `[Setup]` `SignedUninstaller=yes`；签名命令指向仓库 `scripts/sign-inno.ps1`（新增） |
| `C:\Users\snowb\Desktop\work\desktop-main\.github\workflows\build.yml` | 改 | 注入 `CERT_P12` / `CERT_PASSWORD` secrets，CI 调用 signtool |
| `C:\Users\snowb\Desktop\work\desktop-main\build-with-inno.bat` | 改 | 本地签名占位（开发期可跳过） |

> 解决 §5.4：当前无签名 → SmartScreen "未知发布者"。

### W1-3 Apple/AI Native 视觉重构（P1，按 spec 逐条）
- 视觉规范、页面实现、资源集成：见 `INSTALLER-REFACTOR-SPEC-ADAPTED.md` §2→§4，已含 `build/inno/res/*`、`InnoGDIPlus.dll`、`assets/branding/icon.svg` 等地址栏。
- **回退分支必须保留**（spec §4.3）：GDI+ 初始化失败 → 降级到现有 `ApplyDarkTheme` + `InitializeLogPage`。

### W1-4 脚本可移植（P2）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\build-installer.bat` | 改 | §8.3：移除硬编码 `C:\Users\snowb\...`，改用 `nvm`/`volta` 或 `node` 在 PATH 中 |

---

## 3. W2 死代码与架构减负

### W2-1 删除 Electron 内置安装器（P0）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\installer\installer-wizard.ts` | 删 | §2.1：9 步 7 个 TODO，死代码 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\installer\types.ts` | 删 | §2.1 配套类型 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\installer\index.ts` | 删 | §2.1 导出入口 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\main.ts` | 改（如引用） | 确认无 `import ... installer`；如有则移除 |

### W2-2 删除废弃 UI 组件（P1）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\components\dashboard\QuickActions.tsx` | 删 | §2.2 `@deprecated` 无调用方 |

### W2-3 拆分 `useAppController` 上帝对象（P1）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\hooks\useAppController.ts` | 改 | §1.1：拆为 `useSharedState` + `useThemeDomain` + `useSettingsDomain` + `useNotificationDomain`；组件按需组合 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\hooks\useAppController.ts` | 改 | §12.3：`busy` 改 `Map<op,boolean>` 或 per-hook 状态，消除多 Hook 抢同一 `busy` |
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\pages\*.tsx` | 改 | 调用方随拆分调整 |

### W2-4 `refreshCounter` 模块级可变变量（P3）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\hooks\useEnvironmentActions.ts` | 改 | §1.2：删 `let refreshCounter` + `getRefreshCounter`，改用 React Context 或 Zustand |
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\hooks\useEnvironments.ts` | 改 | §1.2：移除对 `getRefreshCounter` 的依赖与 `useMemo` hack |

### W2-5 主题系统简化（P3）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\theme-library.ts` | 改 | §9.2：`toInstalledTheme` 的 `copy` vs `themeMeta` 双重来源加注释说明 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\catalog\theme-installer.ts` | 改 | §9.1：评估 `installBytes()` 避免每主题 mkdtemp/write/rm |

---

## 4. W3 质量与正确性（含 a11y / 错误 / 安全）

### W3-1 `EnvironmentCard` aria-label 错误（P0）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\components\workspace\EnvironmentCard.tsx` | 改 | §2.7 / §6.1：第 93 行 `aria-label={t.environmentDelete}` → `aria-label={env.name}`，功能实为切换环境 |

### W3-2 `friendlyMessage` 端口错误映射（P1）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\hooks\useNotifications.ts` | 改 | §2.3：第 32–33 行端口匹配后不应吞成 `t.actionFailed`；保留 `agent-engine-service.ts` 的 `portOccupiedMessage(port)` |

### W3-3 进度权重更真实（P1）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\hooks\useThemeInstallFlow.ts` | 改 | §2.4：`getProgress` 改为加权（read 5% / validate 10% / copy 40% / register 30% / done 15%） |

### W3-4 应用到所有 Agent 二次确认（P1）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\components\detail-panel.tsx` | 改 | §6.3：第 44–51 行 `runAll()` 加确认对话框，避免误点同时重启三 Agent |

### W3-5 IPC 输入校验加固（P1）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\main.ts` | 改 | §3.3：对 `wallpaper:set` 的 `next.enabled`/`next.id` 与 `theme:apply` 的 `restartExisting` 做类型/范围防御性校验 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\install-detection.ts` | 只读标注 | §3.1：PowerShell 参数均为硬编码常量，文档标注"不可配置"防注入 |

### W3-6 `RenameDialog` 迁 shadcn（P1）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\components\rename-dialog.tsx` | 改 | §2.8：改用 `src/ui/components/ui/dialog.tsx`，获焦点陷阱/ESC/无障碍 |

### W3-7 `ThemeBackgroundAssets` 废弃清理（P3）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\catalog\theme-manifest.ts` | 改 | §2.5：移除或静默跳过 `assets.background` 校验 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\catalog\theme-package-loader.ts` | 改 | §2.5：第 153–173 行停止对 `assets.background` 警告 |

---

## 5. W4 测试与可维护性

### W4-1 核心模块测试（P0 / P1）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\agent-engine-service.ts` | 测 | §4.1：481 行核心编排，**零测试**；mock `@codedrobe/core` 单测 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\install-detection.ts` | 测 | §4.1：310 行，**零测试**；抽象为可测接口或 Windows 专用测试 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\theme-installer.ts` | 测 | §4.1：253 行，**零测试** |
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\wallpaper-service.ts` | 测 | §4.1：285 行，**零测试** |
| `C:\Users\snowb\Desktop\work\desktop-main\src\legacy\codedrobe-core-runtime.ts` | 测 | §4.1：217 行封装，**零测试** |
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\hooks\useAppController.ts` | 测 | §4.1：集成测试（拆分后更易测） |
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\hooks\useThemes.ts` 等 | 测 | §4.1：UI Hook 全零测试 |

### W4-2 i18n 与分类（P2）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\shared\i18n.ts` | 拆 | §7.1：按模块拆 `i18n/workspace.ts` / `themes.ts` / `settings.ts` |
| `C:\Users\snowb\Desktop\work\desktop-main\src\shared\i18n.ts` | 改 | §7.2：`categoryLabel` 的 IP slug（naruto/genshin/...）移出分类系统或降为标签 |

### W4-3 依赖与脚本清理（P2 / P3）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\package.json` | 改 | §5.3：确认 `sharp` 未用则移除（已核实 lockfile 无 sharp） |
| `C:\Users\snowb\Desktop\work\desktop-main\package.json` | 改 | §5.1：确认 `@codedrobe/core` 来源，公共包改 `^0.6.0` |
| `C:\Users\snowb\Desktop\work\desktop-main\scripts\` | 清 | §11.2：删 `fix_theme_installer*.py` / `fix_use_environments.py` / `fix_i18n.js` 等迭代补丁 |
| `C:\Users\snowb\Desktop\work\desktop-main\forge.config.ts` | 改 | §11.1：Deep Links 被注释 → 改为环境变量条件分支 |

### W4-4 IPC 面收敛 / 杂项（P3）
| 文件 | 操作 | 备注 |
|---|---|---|
| `C:\Users\snowb\Desktop\work\desktop-main\src\shared\types.ts` | 改 | §10.1：`AgentSkinApi` 30+ 方法按 `themeOps`/`settingsOps`/`systemOps` 分组 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\globals.css` | 改 | §12.5：移除无使用的 `--chart-*` 变量 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\main\catalog\theme-catalog.ts` | 改 | §1.4 / §12.4：`listThemes` 加内存缓存失效；`getTheme` 改单独查询不重扫全量 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\shared\types.ts` | 改 | §1.3：`APP_META` 重命名 `APP_ICONS`，去 `name` 字段 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\pages\ThemesPage.tsx` | 改 | §6.4：排序 `<select>` 统一为 shadcn `Select` 或自定义 |
| `C:\Users\snowb\Desktop\work\desktop-main\src\ui\components\install-progress.tsx` | 改 | §6.5：`../../../assets/branding/app-icon.png` 改 `@/assets/...` 别名 |

---

## 6. 执行顺序建议（按风险与依赖）

1. **先过 W1-1 决策门**（管道归属）——它决定 W1-2/W1-3 落在 `.iss` 还是 `.nsh`，且影响所有 Windows 产物。
2. **并行启动 W2-1（删死代码）/ W3-1（a11y 必修）/ W4-1 中 `agent-engine-service` 测试**——都是低风险高价值，不互相依赖。
3. **W2-3 拆分 `useAppController`** 放在 W4-1 UI Hook 测试之前（先拆后测）。
4. **W1-2 签名** 需证书到位，通常最后接入 CI。
5. **W3/W4 其余** 按 P1→P2→P3 滚动。

---

## 7. 验收（合并自两份输入）
- 安装器：600×500 无边框 24px 圆角 + 柔和阴影 + 紫粉自绘进度条；AppId 统一 `com.agentskin.desktop`；PublisherURL 修正；产物经 `build-with-inno.bat` 产出且 CI 通过（见安装器 spec §5）。
- 架构：`useAppController` 已拆分；`src/main/installer/` 已删（若选 W1-A）；无 `refreshCounter` hack。
- 质量：`EnvironmentCard` aria 正确；端口错误可定位；应用到所有有确认；IPC 参数防御校验。
- 测试：`agent-engine-service` / `install-detection` / `theme-installer` / `wallpaper-service` / `codedrobe-core-runtime` 至少冒烟测试；UI Hook 有集成测试。
- 维护：`i18n` 模块化；`scripts/` 补丁清理；`sharp` 去留明确；双构建系统收敛为单管道。
