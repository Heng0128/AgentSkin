# OPEN_SOURCE_STRATEGY.md — AgentSkin 开源策略（冻结版）

状态：**已冻结（FROZEN）** · 生效日期：2026-08-07
本文档冻结 AgentSkin 的许可证策略、CodeDrobe 归属声明、目录级许可划分、商标政策与贡献规则。
后续任何商业化、分发、接受贡献的行为，均以本文档为准；与本文档冲突的旧表述一律作废。

---

## 0. 核心结论

- AgentSkin 基于 **CodeDrobe Desktop**（MPL-2.0）演进，不是简单 fork，而是经过大规模重构与重新定位的独立产品。
- MPL-2.0 **允许**：修改、衍生、商业发布、收费服务；**要求**：修改过的 MPL 文件继续以 MPL 分发，并保留许可与归属声明。
- CodeDrobe 的**名称、Logo、图标、视觉资产不随 MPL 授权**。AgentSkin 必须（也已经）使用独立品牌。
- 商业化无障碍：开源桌面端免费，Premium Themes / Environment Packs / Enterprise 均可在 MPL 框架内合法运营。
- 护城河从"代码保密"转移到：**Agent 适配速度、官方主题质量、环境生态、社区、品牌**。

**标准对外表述（唯一认可口径）：**

> AgentSkin is an independent evolution based on CodeDrobe Desktop, licensed under MPL 2.0.

> AgentSkin 基于 CodeDrobe Desktop 开源项目演进，并经过大量架构重构和产品重新定位。

**禁止表述**：~~"AgentSkin is a fork of CodeDrobe"~~（弱化品牌，且不符合实际重构程度）；任何暗示与 CodeDrobe 存在官方关系或获得其背书的措辞。

---

## 1. License 策略

### 1.1 继承层（MPL-2.0）

所有源自 CodeDrobe 的文件、以及在其基础上修改的文件，继续以 **MPL-2.0** 分发。MPL 是**文件级** copyleft：

| 允许 | 要求 |
|------|------|
| 修改与衍生 | 修改过的 MPL 文件保持 MPL |
| 商业发布、闭源发行二进制 | 分发可执行文件时提供/承诺提供对应源码（已由 SOURCE_CODE.md 满足） |
| 与不同许可的代码组合为 Larger Work（MPL §3.3） | 保留每个 MPL 文件中的许可声明 |
| 为自己**新创建**的文件选择其他条款 | 不得改变既有 MPL 文件的许可 |

### 1.2 AgentSkin 新增部分

AgentSkin 原创的新模块（如壁纸运行时、Scene 解析、环境组合包等）当前**统一采用 MPL-2.0**，保持仓库单一主许可，降低合规复杂度。

保留的权利（暂不行使）：未来若需要，可在独立目录/独立仓库中为特定新增模块采用 Apache-2.0 或商业许可（MPL §3.3 Larger Work 允许），但必须：

1. 不与既有 MPL 文件混放于同一文件内；
2. 在该目录显式放置独立 LICENSE 文件；
3. 在 THIRD_PARTY_NOTICES.md 或本文档登记。

### 1.3 Vendored 引擎（Apache-2.0）

`src/engine/`（`@agentskin/engine`）以 **Apache-2.0** vendored 引入，与 MPL 兼容（MPL-2.0 与 Apache-2.0 单向兼容）。保留其 Apache-2.0 属性不变，许可文本存放于 `licenses/Apache-2.0.txt`。

### 1.4 仓库许可文件布局（现状 + 要求）

```
AgentSkin/
├── LICENSE                  ← MPL-2.0 全文（已就位，16.7KB）
├── NOTICE                   ← CodeDrobe 归属声明（已就位）
├── ASSETS_LICENSE.md        ← 视觉资产保留条款（已就位）
├── TRADEMARKS.md            ← 商标政策（已就位）
├── SOURCE_CODE.md           ← 源码获取承诺（已就位，满足 MPL 可执行文件分发要求）
├── THIRD_PARTY_NOTICES.md   ← 第三方组件清单（已就位）
├── OPEN_SOURCE_STRATEGY.md  ← 本文档
└── licenses/
    └── Apache-2.0.txt       ← vendored 引擎许可文本（已就位）
```

---

## 2. CodeDrobe 归属声明（Attribution）

### 2.1 已落地（保持）

- **NOTICE**（根目录）：声明衍生自 CodeDrobe Desktop、MPL-2.0、列举实质性变更、明确不使用其商标与视觉资产。
- **README.md → Attribution 章节**：与 NOTICE 口径一致。

### 2.2 归属措辞规范

| 场景 | 允许 | 禁止 |
|------|------|------|
| README / 官网 | "based on CodeDrobe Desktop"、"evolved from CodeDrobe Desktop" | "fork of"、"CodeDrobe 中文版"、"CodeDrobe Pro" |
| 产品内（关于页） | 一行致谢："Based on the open-source CodeDrobe Desktop project (MPL-2.0)" | 展示 CodeDrobe Logo、使用其配色体系做品牌暗示 |
| 应用商店描述 | 如实描述兼容性："与 CodeDrobe 主题格式兼容" | 暗示官方关系、使用 CodeDrobe 名称做关键词堆砌 |
| 安装包 / 二进制 | 附带 NOTICE + LICENSE | 移除或修改 NOTICE |

### 2.3 兼容性声明

可以声明"基于 / 兼容 / 源自 CodeDrobe"，前提是不具误导性。`.codex-theme` / `.agentskin-theme` 等格式的转换能力可作为兼容事实描述，但不得将 CodeDrobe 名称用于 AgentSkin 的文件扩展名、产品名或域名。

---

## 3. 目录级许可地图

以当前仓库结构为准，冻结如下：

| 目录 / 范围 | 许可证 | 说明 |
|-------------|--------|------|
| `src/main/`、`src/adapters/`、`src/shared/`、`src/types/`、`src/ui/`、`src/legacy/` | **MPL-2.0** | 桌面应用主体（继承 + 深度重构） |
| `src/engine/` | **Apache-2.0** | vendored `@agentskin/engine`，独立许可，不并入 MPL |
| `engines/` | **MPL-2.0** | 各 Agent 注入适配层（adapter.mjs / tokens.css / cosmetic.css） |
| `themes/` | **MPL-2.0**（内置主题代码与 manifest） | 内置主题的图像资产按 ASSETS_LICENSE.md 保留条款处理 |
| `scripts/` | **MPL-2.0** | 构建与校验脚本 |
| `assets/` 中的品牌资产（Logo / 图标 / hero 图） | **保留所有权利** | 不随 MPL 授权，见 ASSETS_LICENSE.md |
| `assets/` 中的字体 | 按各自字体许可（SIL OFL 等） | 见 THIRD_PARTY_NOTICES.md |
| `node_modules` 依赖 | 各自许可 | package.json 依赖均为 MIT/Apache 系兼容许可 |
| 未来 Premium 内容（主题包 / 环境包） | 商业许可，独立分发渠道 | 不放入本开源仓库 |
| 未来 Enterprise 模块 | 商业许可，独立仓库 | 与开源仓库物理隔离 |

**判定规则**：新文件默认 MPL-2.0 + SPDX 头；例外（Apache/商业/保留）必须在本文档登记后方可入库。

---

## 4. 商标政策

### 4.1 上游（CodeDrobe）

- 不使用 CodeDrobe 的名称（作为产品名/域名/包名前缀）、Logo、图标、宣传图、截图。
- 仅允许描述性文字引用（第 2 节口径）。
- 仓库中如残留任何 CodeDrobe 视觉资产，发现即移除。

### 4.2 自身（AgentSkin）

- "AgentSkin" 名称、Logo、视觉标识为 AgentSkin 项目资产；MPL-2.0 不授予任何商标使用权（与 TRADEMARKS.md 一致）。
- 下游 fork / 重新分发必须换品牌，不得暗示官方版本或获得认可。
- 允许他人如实声明"基于 / 兼容 / 源自 AgentSkin"。

### 4.3 第三方目标应用

- Codex / OpenAI、豆包、TRAE、QoderWork、WorkBuddy、ZCode、Wallpaper Engine 均为各自所有者商标。
- 仅作描述性引用（"支持为 X 注入主题"），不暗示合作或背书；产品内已有"与 OpenAI 无关联"声明，同类声明应覆盖所有被适配的目标应用（建议在关于页统一声明）。

---

## 5. 贡献规则

### 5.1 入站许可

- 向本仓库提交代码即表示同意以该文件既有许可（默认 MPL-2.0）授权项目使用。MPL 自带专利授权条款（§2.1），**无需额外 CLA**。
- 新增文件必须包含 SPDX 头：`// SPDX-License-Identifier: MPL-2.0`（现状覆盖率 100%，314 个源文件均已携带，CI 应维持该门禁）。

### 5.2 贡献准入

| 类别 | 规则 |
|------|------|
| 代码 | 通过 `npm run check`（typecheck + lint + test + 契约门禁） |
| 新 Agent 适配器 | 须同时满足"用户基数大 + 无原生主题能力"（见 docs/ROADMAP.md 禁止清单） |
| 主题投稿 | manifest 通过 schema 校验；图像资产必须原创或有授权；主题作者保留版权，随包声明许可 |
| 壁纸 / 环境包投稿 | 同上；不得包含可执行内容 |
| 依赖引入 | 许可兼容性审查（GPL/AGPL 禁止入依赖树）；登记至 THIRD_PARTY_NOTICES.md |

### 5.3 禁止贡献

- 任何 CodeDrobe 或其他上游项目的 Logo、图标、宣传资产；
- 来源不明或无法授权的图像、字体、音频；
- 绕过目标应用安全机制的代码（注入仅限视觉层 CSS/样式，不做数据劫持）。

---

## 6. 商业化路径（冻结）

```
AgentSkin Community（免费）
  └── 开源桌面端：MPL-2.0，GitHub 分发，标签版本对应发布构建
        │
AgentSkin Premium（付费）
  ├── Premium Themes：独立分发的主题包，商业许可
  ├── Environment Packs：主题 + 壁纸 + 配置组合包
  └── Enterprise：私有部署 / 批量环境管理，商业合同
```

合规要点：

1. 收费产品以**独立分发包**形式交付，不与开源仓库混放；
2. 开源版永久免费且功能完整可用（付费内容为增量价值，不做功能阉割式收费）；
3. 分发任何含 MPL 代码的二进制时，附带 NOTICE + LICENSE + 源码获取方式（SOURCE_CODE.md 已满足）；
4. 付费主题包本身是数据资产（CSS/图像/manifest），其许可由主题作者/项目方自行声明，不受 MPL 约束。

---

## 7. 当前仓库合规状态与缺口

审计日期 2026-08-07，基于仓库实测：

| 项目 | 状态 | 说明 |
|------|------|------|
| LICENSE（MPL-2.0 全文） | ✅ | 16,726 字节，标准全文 |
| NOTICE（归属声明） | ✅ | 口径正确 |
| README Attribution 章节 | ✅ | 与 NOTICE 一致 |
| ASSETS_LICENSE.md / TRADEMARKS.md | ✅ | 已按 AgentSkin 品牌改写 |
| SOURCE_CODE.md | ✅ | 满足 MPL 源码提供义务；建议补一句指向 NOTICE 的衍生说明（可选） |
| THIRD_PARTY_NOTICES.md | ✅ | 含 vendored 引擎登记 |
| SPDX 头覆盖率 | ✅ | 314/312 源文件（含测试），100% |
| licenses/Apache-2.0.txt | ✅ | vendored 引擎许可文本 |
| `src/engine/` 目录内许可文件副本 | ⚠️ 缺口 | 目录内无 LICENSE/NOTICE 文件，仅 package.json 声明；建议放置副本或符号链接 |
| CONTRIBUTING.md | ⚠️ 缺口 | 贡献规则目前仅存在于本文档第 5 节；建议增加指向本文档的入口文件 |
| CodeDrobe 视觉资产残留审计 | ⚠️ 待办 | 建议对 assets/、themes/ 图像做一次人工排查，确认无上游品牌资产 |
| 产品内"第三方商标免责声明" | ⚠️ 可选 | 目前仅覆盖 OpenAI，建议关于页统一覆盖全部被适配目标应用 |

---

## 8. 战略附注

MPL + 商标分离 + 大规模重构的组合，使 AgentSkin 的处境优于 MIT 衍生场景：

- **代码不必隐藏**：MPL 天然鼓励共享，隐藏代码没有收益；
- **品牌必须独立**：商标条款反而保护了 AgentSkin 自身的品牌资产不被下游滥用；
- **竞争焦点外移**：从"代码是资产"转为"生态和品牌是资产"——Agent 适配速度、官方主题质量、环境生态、社区、品牌。

演进路线（对外叙事）：

```
CodeDrobe（Theme Manager）
    ↓ 独立演进（非 fork 叙事）
AgentSkin（AI Environment Runtime）
    ↓
AgentSkin Ecosystem（Themes + Environments + Extensions）
```

---

*本文档由项目负责人冻结。修改需显式解冻并记录变更日期与原因。*
