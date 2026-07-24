# AgentSkin 项目病历（健康诊断报告）

> 诊断日期：2026-07-23 ｜ 诊断方式：静态结构审查 + 真实化验（typecheck / test / build 日志）
> 患者：AgentSkin Desktop（国内 AI 编码工具主题管理平台）｜ 当前声明版本：package.json = 5.0.0

---

## 一、患者基本档案

| 项 | 值 |
|---|---|
| 名称 | agentskin-desktop / AgentSkin |
| 声明版本 | 5.0.0（package.json）｜ 最近实际构建 2.1.35（build 日志） |
| 技术栈 | Electron 37 + React 19 + TypeScript 5.9 + Vite 7 + Tailwind 4；vitest 3；electron-builder 26 |
| 代码规模 | src 共 75 .ts + 36 .tsx，约 14,965 行 |
| 适配器 | 9 个（3 active：traework / qoderwork / workbuddy；6 experimental：doubao / codebuddy / marscode / comate / tongyi_lingma / tencent_ai_code） |
| 主题 | themes/ 下 131 个文件，按子目录组织 |

---

## 二、主诉

用户要求“了解整个项目，给一份病历” —— 即对全项目做一次健康体检与诊断。

---

## 三、现病史（架构概览）

- 分层调用链：UI → agent-engine-service → registry → ApplicationAdapter → legacy core runtime → @codedrobe/core（引擎）。
- 适配器层：src/adapters/registry.ts 为唯一来源，registerBuiltinAdapters() 在 main.ts 启动时注册；agent-engine-service 必须 requireAdapter(id)，禁止 if(id===) 硬编码。设计清晰、职责分明。
- Tier 守卫：active 适配器委托 runtime 真实应用主题；experimental 适配器在真实调用时抛 AGENTSKIN_EXPERIMENTAL_ADAPTER，调用方得到诚实错误而非静默 no-op。
- 引擎桥接：真实引擎包仍是 @codedrobe/core（已安装，0.6.0），源码经 tsconfig.json 的 path 别名 "@agentskin/core": ["./node_modules/@codedrobe/core"] 以新名 @agentskin/core 引用（见 src/legacy/agentskin-core-runtime.ts）。
- 构建链：build.bat → bump-version → electron-forge package → electron-builder NSIS（今日产物 2.1.35，104 MB）→ 自建 installer shell 包裹 NSIS 作为资源。今日构建成功。

---

## 四、化验结果（辅助检查）

| 项目 | 指令 | 结果 |
|---|---|---|
| 类型检查 | npm run typecheck（tsc --noEmit） | 通过，0 错误 |
| 构建 | 今日 logs/build-20260723-130850.log | 通过，产出 NSIS(104MB)+installer shell |
| 单元测试 | npm run test（vitest run） | 异常：>12 分钟零输出仍未结束，疑似挂起 |

---

## 五、阳性体征 / 诊断

### 诊断 1【高危】无任何可用的版本控制
- 证据：.git/ 是空目录（仅 . 和 ..，total 12）；git status 报 fatal: not a git repository。git ls-files 返回 0。
- 影响：无提交历史、无回滚点、无代码审查轨迹、无法追溯 2.x→5.0.0 的版本跃迁发生在何时/为何。对一个约 15k 行、每日多次构建、已发布安装包的项目，这是最大单点风险。

### 诊断 2【中高】版本号失同步 + 未记录的主版本跃迁
- 证据：package.json 声明 5.0.0；但今日构建日志 version -> 2.1.35 (strategy: patch)（build.bat 调用 scripts/bump-version.mjs 从 package.json 打补丁）。即 5.0.0 仅存在于源码声明、从未被构建；2.x→5.0.0 跃迁无 CHANGELOG / git tag 说明。工作记忆中记录的 2.1.26 也已过时（今日已到 2.1.35）。
- 影响：发布物与源码声明脱节，无法确认线上跑的是哪个版本；版本真相不唯一。

### 诊断 3【中】测试套件异常（质量门失效）
- 证据：npm run test 运行 >12 分钟零输出仍未结束。测试代码本身无 setTimeout/spawn/fetch/waitFor 等挂起点；项目完全没有 vitest 配置文件（无 environment / isolation / pool / testTimeout）。最可能是 vitest 在转换重型依赖图（@codedrobe/core 引擎 + Electron）时卡死或极慢。
- 影响：本地与 CI 的质量门实际上不可用，回归风险无法被拦截。

### 诊断 4【中】安装向导为空壳
- 证据：src/main/installer/installer-wizard.ts 含 7+ 处 TODO（复制 buildDir 内容、创建桌面/开始菜单快捷方式、注册文件关联与协议、将内置主题复制到用户目录、校验磁盘空间/OS/权限、校验文件完整性、清理临时文件）—— 核心安装步骤均未实现。
- 影响：与已可用的 NSIS 安装器（electron-builder）并存，属半成品代码留在主干，易误导后续维护者。

### 诊断 5【中】迁移中改名不一致（技术债，当前非破坏）
- 证据：源码/注释/运行时文件已改为 @agentskin/core（文件 src/legacy/agentskin-core-runtime.ts），但真实引擎包仍是 @codedrobe/core，仅靠 tsconfig.json 别名桥接。typecheck/build 因此正常，但架构记忆与部分注释仍引用旧名 codedrobe-core-runtime.ts，易造成误导。
- 影响：若某天改 package.json 依赖名或删别名而未同步，构建即崩；阅读理解成本高。

### 诊断 6【轻】文档 / 记忆漂移
- 证据：架构记忆记录的 runtime 文件名、版本号与现状不符；registry 注释中的 adapter id（traework/qoderwork/workbuddy）虽准确，但与源码文件名（trae.ts/qoder.ts）不一致，阅读时易混淆。（注：adapter 内部 id 体系自洽，并非 bug。）

---

## 六、诊疗计划（按优先级）

### P0 — 立即（工程治理底线）
1. 恢复版本控制：git init 并做首次基线提交，或恢复被清空的 .git；建立提交/分支纪律，每次发布打 tag（v2.1.35…）。
2. 澄清版本策略：确认 5.0.0 是否为真实意图。若是，重新走 build.bat 构建并发布；若否，回退 package.json 到 2.1.35+1 或统一方案。建议改用 commit-tag 驱动版本，消除 build.bat 手动打补丁导致的漂移，确立单一版本真相。

### P1 — 本周（质量门与半成品）
3. 修复测试挂起：新增 vitest.config.ts（environment: node、明确 include、可选 pool: threads、testTimeout: 15000、限制并发），并排查测试 import 图是否拉入 Electron/引擎重型模块（必要时用 vi.mock 隔离 @agentskin/core）。目标：npm run test 在 2 分钟内完成。
4. 处置 installer-wizard.ts：要么实现 TODO 中的安装步骤（若计划用它替换 NSIS），要么标记为 WIP / 移出主干，避免半成品误导。

### P2 — 技术债清理
5. 消除改名不一致：将引擎依赖在 package.json 中正式更名为 @agentskin/core（并发布/对齐），移除 tsconfig 别名；或统一回退源码引用为 @codedrobe/core。同步更新架构记忆与注释。
6. 更新工作记忆/架构文档至现状（runtime 文件名、版本、适配器命名）。

---

## 七、预后

核心架构健康、类型检查与构建稳定，适配器分层设计清晰。主要风险集中在工程治理层面（版本控制缺失、版本失同步、质量门失效、主干含半成品）。补齐 P0/P1 后，项目可进入稳健迭代；P2 为可持续维护性改进。

阳性发现摘要：① 无 git（空 .git）② 版本 5.0.0 vs 构建 2.1.35 失同步 ③ test 套件 12min 挂起且无 vitest 配置 ④ installer-wizard 7+ TODO 未实现 ⑤ @agentskin/core 经别名桥接旧引擎 ⑥ 文档漂移。阴性（良好）：typecheck 通过、build 通过、适配器架构清晰。

---

## 八、用户更正与说明（2026-07-23 17:30）

用户对前述部分诊断作出澄清，修正定性如下：

1. 关于诊断 5（改名不一致）：属**有意的品牌化改造**，非缺陷。源码来自 codedrobe 开源项目，用户正将其重新品牌化为自有产品 AgentSkin（@codedrobe/core → @agentskin/core）。当前经 tsconfig path 别名桥接旧引擎是可行的过渡方案。注意点：别名仅在本地解析生效；若将来源码对外分发或他人 npm ci，需将依赖正式更名为 @agentskin/core 或发布该包，否则别名失效、构建报错。

2. 关于诊断 1（无版本控制）：用户**主动选择**不启用 git、不上传 GitHub，开发完全在本地进行。事实成立但非事故。建议（非强制）：即便不上远程，本地 git init 也能提供免费回滚点与变更轨迹，零成本。

3. 关于诊断 2（版本失同步）：5.0.0 是用户**主动要求的大版本更新**（大断层为预期），2.1.35 为改名 / 大版本号设定前的最后一次实际构建。二者不矛盾。提示：build.bat 经 bump-version 以 patch 策略打版本，下次构建会从 5.0.0 升到 5.0.1，属预期；若希望发布物清晰体现“大版本”，可在 CHANGELOG 或产物名中标注。

4. 诊断 3（测试挂起）与诊断 4（installer-wizard 空壳）维持原判断：前者为真实质量门风险（即使本地测试也受影响，建议补 vitest.config.ts）；后者需明确意图（NSIS 已是可用安装器，installer-wizard.ts 是否为弃用 / 未来方案）。

结论（修正后）：核心架构健康、类型与构建稳定。此前“高危 / 中高”两项实为用户的**有意工程决策**（本地无 git、主动大版本跃迁、有意品牌化），不构成缺陷。真正值得跟进的工程改进为：① 补 vitest.config.ts 修复测试挂起；② 明确 installer-wizard.ts 去留；③ 品牌化过渡方案长期化（发布 @agentskin/core 或正式更名依赖）。

### 补充（17:46）：品牌化与安装器的真正动机
用户明确：改名 + 全套安装器工作（NSIS 自定义品牌资源 / MUI 中文化 / 圆角窗口）的核心目标是**做出好看的安装程序界面**。推论：
- 实际发布安装器 = electron-builder 的 NSIS + 自定义 MUI 品牌（build/nsis 资源 + build/installer.nsh），这正是“好看界面”的载体。
- src/main/installer/installer-wizard.ts 是基于 Electron 的自研向导，含 7+ TODO 未实现，与本 NSIS 安装器功能重叠——若 NSIS 才是发布安装器，该 wizard 更可能为冗余 / 弃用代码，建议确认后移除或标记，避免在主干留下误导性半成品。

## 九、测试挂起已修复 + 遗留失败（17:57）

- 已新增 vitest.config.ts：node 环境、@agentskin/core→@codedrobe/core 别名、引擎内联（inline）、forks 池、15s 超时。测试现约 29s 跑完（此前 >12min 挂起）。
- 结果：87 passed / 4 failed（共 91）。4 个失败全部在 src/main/agent-scheme.test.ts 的 applyScheme 用例。
- 失败根因（非本次改动引入，此前被挂起掩盖）：applyScheme 在写入后做 read-back 校验 + 重试（agent-scheme.ts L305-313）；而测试的 scriptedSession 是静态 2 项响应、不持久化写入，read-back 取到的 evaluate 在脚本耗尽后返回 'null' → 校验失败 → 返回 false。即测试 mock 与“读回校验”实现不匹配，属测试/实现脱节，并非引擎或配置问题。
- 修复方向（待确认）：将 scriptedSession 改为有状态（记录 setAttribute/setItem 的写入并在读取时返回），使 read-back 能反射真实写入；若 read-back 逻辑本身非预期，则应改 applyScheme。
- installer-wizard.ts：在 src 内零引用，确认为死代码；因项目无 git，未删除，建议确认后移除或标记弃用。

## 十、品牌化残留复核（18:09）

- 用户目标为把产品完整品牌化为 AgentSkin（含好看安装界面）。复核 src 中 [Cc]ode[Dd]robe 残留：
- 未发现任何用户可见的 CodeDrobe 产品文案（i18n / marketplace / update-service / global.d.ts 均无残留）—— 之前记忆里的“已知品牌残留”已过时，用户可见面已清理干净。
- 仅存的 codedrobe 引用均为有意兼容垫片：① 主题扩展名 .codedrobe-theme（main.ts / useThemes.ts / theme-installer.ts 导入过滤器；引擎内部 THEME_EXTENSION 即此值，保留以兼容旧主题）；② 引擎注入的 CSS 变量 --codedrobe-art（由 @codedrobe/core 引擎定义，内部变量）。二者非品牌泄漏，可保留。
- 结论：品牌化在用户可见层已完整；无新增阻塞项。
