# RFC: DSH 社区皮肤主题转换管线

> 状态：`待评审`
> 日期：2026-08-25
> 分支：`feat/dsh-community-converter`
> 范围：`src/main/community/`、`src/shared/types/community.ts`、`scripts/`

---

## 1. 背景与目标

### 1.1 为什么需要这次变更？

DeepSeek Harness (DSH) 社区已涌现 100+ 独立皮肤/主题插件（鲸鱼娘、液态玻璃、氛围光等），视觉设计成熟，但 AgentSkin 当前无法复用这些设计资产。

原方案（`docs/dsh-skin-plugin-integration-plan.md`）提出新建 DSH 适配器 + 自建皮肤市场服务端，经技术评审后确认：
- 新增 DSH 适配器违反黄金规则 1（禁止新增适配器）
- 自建服务端违反黄金规则 3（禁止自建服务端）
- 自然语言换肤和在线预览画廊应各自独立 RFC

### 1.2 目标

1. 扩展现有社区主题转换管线（`src/main/community/`），支持 DSH 皮肤仓库的静态快照转换
2. 实现去中心化皮肤索引（静态 JSON + GitHub API），不建服务端
3. 首批适配 3 款高质量 DSH 皮肤（dsh-deep-whale、dsh-gui-customization、dsh-liquid-glass）
4. 确保许可证合规（CC-BY-NC-SA-4.0 与 MPL-2.0 的冲突处理）

### 1.3 非目标

- 不做独立 DSH 适配器（走社区转换管线）
- 不做自建皮肤市场服务端（去中心化索引）
- 不做自然语言换肤（独立 RFC）
- 不做在线预览画廊（独立 RFC）
- 不复制 JS 驱动动画 / WebGL / Cordis 特有生命周期（静态快照方案，~60% 视觉保真度）

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）— **否**，不改变注入架构
- [x] 新增 UI 页面（突破六页封顶）— **否**，复用现有社区主题页
- [x] 新增适配器（突破六适配器上限）— **否**，走社区转换管线
- [x] 修改核心数据模型（manifest schema、14-token 契约等）— **否**，复用现有 schema

**结论：本 RFC 不触发任何黄金规则强制条件，但涉及外部资产引入和许可证合规，仍需 RFC 评审。**

---

## 3. 现状侦察（代码锚点）

### 3.1 现有社区主题转换管线

| 文件 | 职责 | 关键符号 |
|------|------|---------|
| `src/main/community/community-theme-converter.ts` | ZIP 解压 → 校验 → 转换 → manifest 生成 | `convertThemePackage()`、`normalizeTitle()`、`ConvertedTheme` |
| `src/main/community/community-color-bridge.ts` | DreamSkin 8 色直接映射 + 6 派生 → AgentSkin 14-token | `bridgeColors()`、`AGENTSKIN_TOKEN_KEYS`、`AgentSkinTokens` |
| `src/main/community/community-theme-api.ts` | DreamSkin API 客户端（列表/详情/下载） | `CommunityThemeApi` |
| `src/main/community/community-zip-extractor.ts` | 安全 ZIP 解压（防路径穿越） | `extractThemeZip()`、`cleanupExtractDir()` |
| `src/shared/types/community.ts` | 共享类型定义 | `CommunityTheme`、`CommunityThemeSummary`、`DreamSkinDisplayMeta` |

### 3.2 14-token 契约

`community-color-bridge.ts` 第 44-59 行定义了 `AGENTSKIN_TOKEN_KEYS`，与 `THEME_SPEC.md` 一致：

```
accent, secondary, background, foreground, muted, surface, surfaceElevated,
border, codeBackground, codeForeground, inputBackground, buttonBackground,
buttonForeground, focusRing
```

### 3.3 转换产物格式

`community-theme-converter.ts` 第 242-283 行生成 v1 `.agentskin-theme` 包，包含：
- `format: 'agentskin-theme'`, `schemaVersion: 1`
- `theme.{id, displayName, version, author, catalog, colors}`（colors 字段含 **7 键**：`accent`、`secondary`、`background`、`foreground`、`muted`、`surface`，其余 6 个派生 token 仅用于 CSS 变量推导，不写入 manifest）
- `targets.{traework, qoderwork, workbuddy, doubao, codex, zcode}.css`
- `assets.images.hero.{filename, mimeType, base64}`

> **说明**：14-token 契约中，8 个基础 token 由 `community-color-bridge.ts` 直接从 DreamSkin `displayMeta.colors`（8 个可选键：accent、secondary、background、text、muted、panel、panelAlt、line）映射而来，剩余 6 个（surfaceElevated、border、codeBackground、codeForeground、inputBackground、buttonBackground、focusRing）通过亮度调整/对比计算派生。派生 token 注入到 `targets.*.css` 变量块中，但 `manifest.theme.colors` 仅记录 7 个核心键。

---

## 4. 设计方案

### 4.1 整体架构

```
DSH GitHub Repo (git clone / tarball)
        │
        ▼
┌──────────────────────────────────┐
│  dsh-repo-fetcher.ts             │  下载仓库，提取 CSS 变量 + 预览图
│  (新增)                          │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│  dsh-color-bridge.ts             │  --dsw-* 变量 → 14-token 映射
│  (新增)                          │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│  community-theme-converter.ts    │  复用现有转换逻辑，生成 manifest
│  (扩展：新增 convertFromDSH())   │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│  v1 .agentskin-theme package     │  与 DreamSkin 社区主题统一格式
│  (manifest.json + assets)        │
└──────────────────────────────────┘
```

### 4.2 新增文件结构

```
src/main/community/
├── dsh-repo-fetcher.ts        # DSH 仓库下载与解析
├── dsh-color-bridge.ts        # DSH CSS 变量 → 14-token 映射
├── dsh-skin-index.ts          # 去中心化皮肤索引管理
└── dsh-skin-index.json        # 静态皮肤索引（社区维护）
```

### 4.3 DSH 仓库下载器（dsh-repo-fetcher.ts）

```typescript
interface DSHRepoSource {
  owner: string;           // 如 "Small-tailqwq"
  repo: string;            // 如 "dsh-deep-whale"
  ref?: string;            // commit/tag/branch（可选，锁定版本）
  cssPath: string;         // CSS 文件相对路径
  previewPath: string;     // 预览图相对路径
  license: string;         // 原始许可证
}

interface DSHRepoFetchResult {
  cssContent: string;      // CSS 文件内容
  heroImage: Buffer;       // 预览图二进制
  heroExt: string;         // 图片扩展名
  metadata: {
    name: string;
    author: string;
    license: string;
    repoUrl: string;
    ref: string;
  };
}
```

**实现方式**：通过 GitHub API 获取仓库 tarball（`https://api.github.com/repos/{owner}/{repo}/tarball/{ref}`），解压到临时目录，定位 CSS 和预览图文件。

### 4.4 色彩映射规则（dsh-color-bridge.ts）

DSH 皮肤使用 `--dsw-*` CSS 变量。映射规则如下：

| DSH CSS 变量 | AgentSkin 14-token | 映射方式 |
|--------------|-------------------|---------|
| `--dsw-primary` 或 `--dsw-accent` | `accent` | 直接映射 |
| `--dsw-secondary` | `secondary` | 直接映射 |
| `--dsw-background` 或 `--dsw-bg` | `background` | 直接映射 |
| `--dsw-foreground` 或 `--dsw-text` | `foreground` | 直接映射 |
| `--dsw-muted` 或 `--dsw-text-secondary` | `muted` | 直接映射 |
| `--dsw-surface` 或 `--dsw-panel` | `surface` | 直接映射 |
| `--dsw-surface-elevated` 或 `--dsw-panel-alt` | `surfaceElevated` | 直接映射 |
| `--dsw-border` 或 `--dsw-line` | `border` | 直接映射 |
| — | `codeBackground` | `surface ± brightness` |
| — | `codeForeground` | `foreground` (passthrough) |
| — | `inputBackground` | `surface` (passthrough) |
| — | `buttonBackground` | `accent` (passthrough) |
| — | `buttonForeground` | `getContrastColor(accent)` |
| — | `focusRing` | `color-mix(accent 40%, transparent)` |

**变量名兼容策略**：DSH 社区无统一变量命名规范，采用"候选名列表 + 首次匹配"策略。`dsh-color-bridge.ts` 维护一个 `DSH_VAR_ALIASES` 映射表，按优先级尝试匹配。

### 4.5 静态快照转换策略

基于 spike 分析结论（~60% 视觉保真度）：

| 可转换（静态快照） | 不可转换（放弃） |
|-------------------|-----------------|
| 色板 / CSS 变量 | JS 驱动动画（昼夜切换、粒子效果） |
| 单张 hero 预览图 | Cordis 特有生命周期钩子 |
| 背景图（静态） | WebGL 液态透镜折射 |
| 字体族声明 | 实时交互效果（拖拽、呼吸） |
| 圆角 / 间距变量 | 动态氛围光（需持续 JS） |

**转换流程**：
1. 下载 DSH 仓库 tarball → 解压到临时目录
2. 解析 CSS 文件，提取 `:root` 下的 `--dsw-*` 变量
3. 通过 `dsh-color-bridge.ts` 映射为 14-token
4. 提取 hero 预览图（优先 `preview.png` > `screenshot.png` > `README.md` 中首张图片）
5. 生成 v1 `.agentskin-theme` manifest（复用 `community-theme-converter.ts` 的产物结构）
6. 清理临时目录

### 4.6 安全模型（tarball 解压与资产校验）

DSH 仓库 tarball 下载后的解压与校验需满足以下安全要求，复用并扩展现有 `community-zip-extractor.ts` 的三重防护机制：

#### 4.6.1 解压安全防护

| 防护层 | 现有实现（ZIP） | DSH tarball 复用/扩展 |
|--------|----------------|----------------------|
| 路径穿越防护 | `isWithinDir()` 校验每条目解析路径 | **复用**：相同逻辑应用于 tar 条目，拒绝 `../` 逃逸 |
| 解压炸弹防护 | `MAX_EXTRACT_SIZE`（100MB）+ `MAX_ENTRY_COUNT`（1000） | **复用**：相同上限约束 tar 解压 |
| 条目数防护 | `zipfile.entryCount > MAX_ENTRY_COUNT` 拒绝 | **复用**：tar 条目数同步校验 |

#### 4.6.2 签名/校验和验证

- **下载前校验**：通过 GitHub API 获取 tarball 时，记录响应 `ETag` 或 `Content-Length`；若索引中已声明 `sha256` 字段，下载完成后校验哈希
- **可选签名验证**：若 DSH 皮肤作者提供 GPG/Minisign 签名，`dsh-repo-fetcher.ts` 在解压前校验签名有效性
- **校验失败处理**：校验不通过时拒绝安装，向用户展示具体失败原因（哈希不匹配 / 签名无效）

#### 4.6.3 解压后安全扫描

解压完成后、进入转换流程前，执行以下扫描：

| 扫描项 | 规则 | 处置 |
|--------|------|------|
| 符号链接 | 检测 tar 条目类型 `LNKTYPE` / `SYMTYPE`，或解压后 `fs.lstatSync().isSymbolicLink()` | 拒绝并警告：符号链接可能指向系统敏感路径 |
| 可执行文件 | 检测扩展名（`.exe`、`.dll`、`.bat`、`.sh`、`.ps1`）或 UNIX 权限位 `S_IXUSR` | 拒绝并移除：皮肤包不应包含可执行文件 |
| 超大单文件 | 单文件 > 10MB（CSS/图片除外） | 警告并跳过：可能为嵌入的恶意资源 |
| 非预期 MIME 类型 | 文件扩展名与 magic bytes 不匹配 | 警告：文件类型伪装攻击 |

#### 4.6.4 CSS 注入安全

DSH CSS 可能含外部请求声明，需在转换前清洗：

| 危险模式 | 例子 | 处置 |
|----------|------|------|
| `@import url(...)` | `@import url(https://evil.com/steal.css)` | **移除**：禁止外部 CSS 引用 |
| `behavior` | `behavior: url(#default#userData)` | **移除**：IE CSS expression/HTC 攻击向量 |
| `expression()` | `width: expression(alert('XSS'))` | **移除**：IE 动态表达式执行 |
| `url()` 外部资源（非图片） | `background: url(https://tracker.com/pixel.gif)` | **警告 + 替换为占位符**：防止跟踪像素 |

清洗逻辑在 `dsh-repo-fetcher.ts` 中实现为 `sanitizeCSS(content: string): string`，返回清洗后的 CSS 并记录被移除的规则。

> **参考**：OWASP Unzip Security Best Practices、CWE-502 (Deserialization of Untrusted Data)、CWE-494 (Download of Code Without Integrity Check)

### 4.7 色彩函数处理策略

DSH 皮肤 CSS 变量值可能使用现代色彩函数。`dsh-color-bridge.ts` 需支持以下格式：

#### 4.7.1 支持的色彩格式

| 格式 | 示例 | 解析支持 |
|------|------|---------|
| HEX | `#4f8cff`、`#fff` | 完全支持（现有 `parseHex()`） |
| RGB/RGBA | `rgb(79, 140, 255)`、`rgba(79,140,255,0.8)` | 解析为 HEX 后处理 |
| HSL/HSLA | `hsl(217, 100%, 65%)` | 解析为 HEX 后处理 |
| oklch | `oklch(0.65 0.2 250)` | 需引入色彩空间转换库（如 `culori`） |
| color-mix | `color-mix(in srgb, var(--dsw-accent) 40%, transparent)` | 若可静态求值则解析，否则 fallback |

#### 4.7.2 Fallback 策略

当色彩函数无法解析时：

1. **使用默认值**：根据 `appearance`（light/dark）选用对应的默认色板
2. **警告日志**：`mainError('dsh-color', "Unparseable color value: ${raw}, falling back to default")`
3. **UI 提示**：转换完成后在结果摘要中标记"部分色彩使用了默认值"

#### 4.7.3 色彩空间转换精度说明

- oklch → sRGB 转换可能超出 sRGB 色域，需做 gamut clipping（`culori` 的 `clamp('rgb')`）
- 转换精度误差 ≤ 0.1%（8-bit 通道 rounding），肉眼不可感知
- `color-mix()` 若含 `var()` 引用且父变量未定义，无法静态求值，使用 fallback

### 4.8 回滚与隔离

DSH 管线的 bug 不应影响现有 DreamSkin 转换功能。隔离策略如下：

| 隔离层 | 机制 |
|--------|------|
| Feature Flag | `settingsStore.enableDSHConverter`（默认 `关闭`），仅当用户手动开启时激活 DSH 管线 |
| 代码隔离 | DSH 相关逻辑全部在 `dsh-*.ts` 文件中，不修改 `community-theme-converter.ts` 核心路径（仅新增 `convertFromDSH()` 入口分支） |
| 数据隔离 | DSH 转换产物存储在独立目录 `themes/community/dsh/`，与 DreamSkin 社区主题 `themes/community/dreamskin/` 物理分离 |
| 回滚触发 | DSH 管线异常率 > 5%（通过 `diagnosticsStore` 统计）时，自动禁用 feature flag 并通知用户 |

### 4.9 去中心化皮肤索引

**不建服务端**。皮肤索引以静态 JSON 文件维护：

```json
// src/main/community/dsh-skin-index.json
{
  "version": 1,
  "lastUpdated": "2026-08-25",
  "skins": [
    {
      "id": "dsh-deep-whale",
      "name": "Deep Whale - Maid Atelier",
      "owner": "Small-tailqwq",
      "repo": "dsh-deep-whale",
      "branch": "main",
      "cssPath": "src/theme.css",
      "previewPath": "preview.png",
      "license": "CC-BY-NC-SA-4.0",
      "tags": ["character", "light-dark"],
      "addedAt": "2026-08-25"
    }
  ]
}
```

**索引维护方式**：社区通过 PR 提交新皮肤条目，CI 校验 JSON schema + 仓库可访问性。

### 4.10 许可证合规策略

| 许可证 | 兼容性 | 处理方式 |
|--------|--------|---------|
| MIT | 与 MPL-2.0 兼容 | 直接转换，保留许可证声明 |
| Apache-2.0 | 与 MPL-2.0 兼容 | 直接转换，保留许可证声明 |
| CC-BY-NC-SA-4.0 | **与 MPL-2.0 潜在冲突** | 见下文 |
| CC-BY-4.0 | 与 MPL-2.0 兼容 | 直接转换，保留许可证声明 |
| GPL 系列 | 与 MPL-2.0 不兼容 | 拒绝转换 |

**CC-BY-NC-SA-4.0 处理方案**：
1. **NC（非商业）条款**：AgentSkin 仅提供技术转换能力，用户需自行评估其使用场景是否符合原皮肤许可证约束。AgentSkin 在导入时展示原皮肤许可证文本，并建议用户咨询法律专业人士
2. **SA（相同方式共享）条款**：转换后的主题以 CC-BY-NC-SA-4.0 发布（非 MPL-2.0），在 manifest 中明确标注 `license: "CC-BY-NC-SA-4.0"`
3. **归属要求**：manifest 中保留原作者信息、原始仓库 URL、许可证全文路径
4. **隔离策略**：CC-BY-NC-SA-4.0 主题安装到独立目录（`themes/community/cc-by-nc-sa/`），不与 MPL-2.0 主题混合
5. **用户提示**：安装 CC-BY-NC-SA-4.0 主题时，弹窗展示许可证全文，用户需勾选"我已阅读并理解许可证条款"方可继续

### 4.11 皮肤管理面板（复用现有）

不新增 UI 页面。在现有社区主题页增加 DSH 标签/筛选：
- 索引浏览：从 `dsh-skin-index.json` 加载皮肤列表
- 一键安装：下载 → 转换 → 安装到主题库
- 互斥管理：复用现有 `themeStore` 的互斥逻辑（同一时间仅一个主题生效）
- 许可证提示：安装 CC-BY-NC-SA-4.0 主题时弹出确认对话框

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| R1 | DSH 仓库结构不一致 | 中 | CSS 变量名/文件路径差异大 | 候选名列表匹配 + 手动配置覆盖（`dsh-skin-index.json` 中可指定 `cssPath`） | 转换时校验 14-token 完整性，缺失 token 使用默认值并警告 |
| R2 | CC-BY-NC-SA-4.0 许可证冲突 | 高 | 用户将 NC 主题用于商业场景 | manifest 明确标注许可证，安装时弹窗提示，隔离存储 | `check-license-header.mjs` 扩展校验 |
| R3 | GitHub API 限流 | 中 | 频繁下载仓库 tarball | 本地缓存已下载仓库（24h TTL），优先使用缓存 | HTTP 403/429 时降级提示 |
| R4 | DSH 皮肤素材版权争议 | 中 | 皮肤使用未授权动漫/游戏素材 | 仅转换明确标注 MIT/Apache/CC-BY 许可证的皮肤，社区 PR 审核 | 索引维护时人工校验许可证字段 |
| R5 | 视觉保真度不足 | 低 | 用户期望 100% 还原 DSH 效果 | 明确标注"静态快照转换"，管理面板显示"转换保真度: ~60%" | 安装预览页展示对比截图 |
| R6 | CSS 变量提取失败 | 中 | DSH 皮肤使用非标准格式（如 SCSS 变量） | 仅支持 CSS 原生变量（`--dsw-*`），SCSS/LESS 预处理变量暂不支持 | 转换前预检，不支持的格式跳过并提示 |
| R7 | DSH 仓库失效 | 中 | 仓库删除、改名或转为私有化 | **三层降级**：① 本地缓存（已转换主题可继续使用）；② 社区 fork 备份（索引中记录多个 fork 源）；③ 用户提示（"原仓库不可用，可尝试社区 fork 或手动导入"） | 索引 CI 定期探测仓库可访问性，404/403 时触发 fork 切换 |
| R8 | CSS 注入安全 | 高 | DSH CSS 含 `@import url()`、`behavior`、`expression()` 等外部请求或可执行声明 | 转换前强制执行 CSS 清洗（见 §4.6.4），移除所有外部引用与危险属性 | `dsh-repo-fetcher.ts` 中 `sanitizeCSS()` 函数 + 单元测试覆盖 |

---

## 6. 分批落地计划

### Phase 1：核心转换引擎（预计 3d）

**改动范围**：
- 新增 `src/main/community/dsh-repo-fetcher.ts`
- 新增 `src/main/community/dsh-color-bridge.ts`
- 新增 `src/main/community/dsh-skin-index.json`（含 3 款首批皮肤）
- 扩展 `src/main/community/community-theme-converter.ts`（新增 `convertFromDSH()` 入口）
- 新增 `tests/main/community/dsh-*.test.ts`

**验证方式**：
- 单元测试：CSS 变量解析、14-token 映射、manifest 生成
- 集成测试：端到端转换 3 款首批皮肤，校验产物可被 `ThemeLibrary.installFile` 安装

### Phase 2：UI 集成、许可证合规与自动化测试（预计 3d）

**改动范围**：
- 社区主题页增加 DSH 标签/筛选
- 安装流程增加许可证确认对话框
- `src/shared/types/community.ts` 增加 `DSHSkinSource` 类型
- 新增自动化测试套件（见下方测试策略）

**验证方式**：
- 手动测试：安装/切换/卸载 DSH 主题
- 许可证提示弹窗功能测试
- 自动化测试全绿（见下方）

#### 自动化测试策略

| 测试类型 | 覆盖范围 | 文件位置 |
|---------|---------|---------|
| parseDSSH 单元测试 | 覆盖 14-token 提取：8 个直接映射 + 6 个派生 token | `tests/main/community/dsh-color-bridge.test.ts` |
| CSS 变量解析测试 | `:root` 选择器解析、多格式色彩值（HEX/HSL/oklch/color-mix）、缺失变量 fallback | `tests/main/community/dsh-repo-fetcher.test.ts` |
| 集成测试 | 真实 DSH 仓库 → tarball 下载 → 解压 → 清洗 → 转换 → 校验输出结构 | `tests/main/community/dsh-pipeline-integration.test.ts` |
| GitHub API 限流 mock 测试 | 模拟 HTTP 403/429 响应，验证缓存降级与错误提示 | `tests/main/community/dsh-repo-fetcher.test.ts`（mock 模式） |
| CSS 清洗安全测试 | 覆盖 `@import`、`behavior`、`expression()`、外部 `url()` 的移除 | `tests/main/community/dsh-css-sanitize.test.ts` |
| manifest 结构校验 | 确认输出 `theme.colors` 仅含 7 键，派生 token 出现在 `targets.*.css` 变量块中 | `tests/main/community/dsh-pipeline-integration.test.ts` |

### Phase 3：文档与社区（预计 1d）

**改动范围**：
- `docs/rfc/dsh-skin-theme-conversion.md`（本 RFC）
- `docs/reports/` 新增转换实施报告
- `scripts/INDEX.md` 登记新增脚本（如有）

**验证方式**：
- `npm run check` 全绿
- RFC 评审通过

---

## 7. 人工复核项

| # | 复核项 | 说明 | 复核人 |
|---|--------|------|--------|
| M1 | CC-BY-NC-SA-4.0 许可证法律合规 | 需确认 NC 条款对开源桌面工具的约束边界，以及 SA 条款的隔离策略是否充分 | 项目法务/负责人 |
| M2 | 首批皮肤作者授权 | dsh-deep-whale、dsh-gui-customization、dsh-liquid-glass 作者是否知情并同意其作品被转换 | 社区运营 |
| M3 | DSH 变量名覆盖度 | 候选名列表是否覆盖主流 DSH 皮肤的变量命名习惯，需抽样验证 10+ 款皮肤 | 开发 |
| M4 | 视觉保真度用户预期 | "~60% 保真度"的标注方式是否会导致用户不满，是否需要调整措辞 | 产品/设计 |
| M5 | 与 DreamSkin 社区主题管线的差异化 | 两套社区主题来源（DreamSkin vs DSH）在 UI 中如何区分展示 | 产品/设计 |
| M6 | DSH 安全模型评审 | tarball 解压安全防护（§4.6.1-4.6.3）和 CSS 清洗（§4.6.4）的实现是否充分，是否需要渗透测试 | 安全/架构 |
| M7 | 色彩函数 fallback 策略确认 | oklch/color-mix 无法解析时的默认色板是否符合用户预期，fallback 日志是否充足 | 开发/产品 |

---

## 8. 首批适配皮肤清单

| 排名 | 皮肤名 | 仓库 | 许可证 | 适配理由 | 预计工作量 |
|------|--------|------|--------|----------|-----------|
| 1 | dsh-deep-whale | Small-tailqwq/dsh-deep-whale | CC-BY-NC-SA-4.0 | 社区最热门（1562 stars），素材完整，亮暗双模式 | 1d |
| 2 | dsh-gui-customization | LAN-TINA-WS/dsh-gui-customization | MIT | 综合定制能力强，氛围光/背景图控制优秀 | 0.5d |
| 3 | dsh-liquid-glass | Ultronen/dsh-liquid-glass | MIT | 液态玻璃效果，视觉冲击力强，结构简洁 | 0.5d |

---

## 9. 评审结论

（评审人填写）

---

*本 RFC 基于技术评审结论对原方案（docs/dsh-skin-plugin-integration-plan.md）进行了重大方向调整：删除独立 DSH 适配器设计，改为社区主题转换管线扩展；删除自建皮肤市场服务端，改为去中心化静态索引；删除 Phase 4 自然语言换肤和在线画廊，各自独立 RFC。*
