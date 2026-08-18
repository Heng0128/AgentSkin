# RFC · AgentSkin 多资产注入（2a）

> 状态: **细则草案**（未实现）
> 上游: `deep-adaptation-initiative.md` 缺口 2a（多资产注入通道）
> 关联约束: `AGENTS.md`——改注入架构需 RFC；不动适配器数量、不新增 UI 页、不建服务端
> 结论速览: 多图**打包/校验/解析已存在**，真正的断点在"注入链路只把 hero 传下去、其余图片全丢"。本 RFC 只补"把已解析的多图集穿透到运行时，并按素材绑定 CSS 变量"一段。

---

## 0. 决策背景

目标是让主题能放"背景图 + 侧栏图 + 对话框图 + 透明小人/GIF"等多张协调素材，而不是只有单张背景 hero。经代码核对，**这事的 60% 已经在仓库里了**，不是从零建。

### 已核实现状（证据）

| 环节 | 现状 | 位置 |
|------|------|------|
| 打包 | `bundle.assets.images` 已支持**多图**，每张 `{filename, mimeType, base64}`，有 `SAFE_ID`/`SAFE_IMAGE_TYPES`/`MAX_THEME_IMAGES` 校验 | [package.mjs](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/theme/package.mjs#L53-L57) |
| 解析 | `resolvedImageAssets()` 收集全部 images（`art` 映射为 `hero`）→ `imageDataUrls` 含**所有图** | [package.mjs](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/theme/package.mjs#L53-L57) |
| schema | manifest 已有 `hero`、`assets.background`(deprecated) | [manifest-v2.schema.json](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/catalog/manifest-v2.schema.json#L54-L122) |
| **落地（断点）** | 注入只消费 hero：`artDataUrl: imageDataUrls.hero ?? null` | [cdp-strategy.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/injection/cdp-strategy.ts#L34-L36) |
| 传输 | `transferHeroBase64` **写死 `--agentskin-art` 一个变量**、只传一张图 | [hero-inject.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/injection/hero-inject.ts#L73) |

### 跨层模型（2a 视角）

```
① 打包/解析  bundle.assets.images ──多图已存──► imageDataUrls { hero, sidebar, chat, pet... }
─────────────────────────────────────────────── ✅ 已具备
② 路由       把 imageDataUrls 透传给注入函数
─────────────────────────────────────────────── ❌ 只透传 hero，其余丢弃
③ 注入       每张图 → Blob URL → 绑到 CSS 变量
─────────────────────────────────────────────── ❌ 只写 --agentskin-art
④ 消费       agent CSS 用 var(--agentskin-asset-*) 铺各面
─────────────────────────────────────────────── ❌ 依赖 ②③
```

**断点 = ②③**。reactiv：2a 的工作 = **把 `imageDataUrls` 整个透传 + 泛化传输函数为"多变量绑多图"**。④（绑定到具体面、坐标、尺寸）属 2b，不在本 RFC。

---

## 1. 目标（S.M.A.R.T.）

1. 多图从 `imageDataUrls` 全部到达运行时，不再只传 hero。
2. 每张素材写入独立 CSS 变量 `--agentskin-asset-<id>`（保留 `--agentskin-art` 作为 hero 别名，向后兼容）。
3. 传输复用现有 chunk/Blob/revoke 机制，不引入新 CSP 问题。
4. 大小/数量门禁明确，防止 Debug 主题把包撑爆。
5. 完全向后兼容：不声明多素材的旧主题行为不变；`minAppVersion` 不强制升级。

---

## 2. 方案设计

### 2.1 manifest 字段（复用 `assets.images`，不另起新结构）

打包脚本核对结论：**路线已定死——复用 B 线 `bundle.assets.images`，不新造文件路径结构**。两条生产线的分裂要一并收敛：

- **A 线（Studio 导出）** `build-theme-package.mjs`：当前只写 `manifest.json` + 单 CSS + preview + icon，**不产 hero、不产多图** → 需补 hero + 多图收包。
- **B 线（engine 运行时）** `theme/package.mjs`：已支持 `bundle.assets.images`（`{id, filename, mimeType, base64}`，`SAFE_ID`/`SAFE_IMAGE_TYPES`/`MAX_THEME_IMAGES` 全校验）且 `imageDataUrls` 已含全部图 → 差透传+注入。

声明形态（对齐 B 线既有结构）：

```jsonc
{
  "hero": "hero.webp",
  "assets": {
    "images": {
      "hero":    { "filename": "hero.webp",    "mimeType": "image/webp", "base64": "…" },
      "sidebar": { "filename": "sidebar.png",  "mimeType": "image/png",  "base64": "…" },
      "mascot":  { "filename": "mascot.gif",   "mimeType": "image/gif",  "base64": "…" }
    }
  }
}
```

> 决策定论（§7 #1）：**复用 `bundle.assets.images`**。`hero` 作为 `images.hero` 的特例（沿用 `resolvedImageAssets()` 的 `art→hero` 映射语义）。不新增 `assets.decorations`。

### 2.2 注入链路改造（核心）

**改动点 A — 透传多图集**（现在只传 hero）
- [package.mjs](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/theme/package.mjs) 已产出 `imageDataUrls`（全量）→ 当前被压成 `artDataUrl: imageDataUrls.hero`。改为把 `imageDataUrls` **整个**传给自己端/注入函数（含 hero）。
- `cdp-strategy` / `engine-strategy` 的入参从 `heroDataUrl?: string` 扩为 `imageDataUrls?: Record<string,string data-url>`。

**改动点 B — 泛化传输函数**
- [hero-inject.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/injection/hero-inject.ts#L48) 的 `transferHeroBase64` 泛化为 `transferImageSet`：遍历多图 → 每张 `URL.createObjectURL` → 写 `--agentskin-asset-<id>`。
- 保留 hero：`--agentskin-art` = `--agentskin-asset-hero`（别名写入，避免 2 份内存）。
- 复用既有 chunk 阈值 `HERO_CHUNK_THRESHOLD` + revoke 旧 URL（防泄漏）。

**改动点 C — 验证器更新**
- `cdp-strategy` 的 `heroInjected`/`heroBlobActive` 校验扩为多素材：检查 `--agentskin-asset-<id>` 已设置的可达性（至少校验"非空集时无失败"）。
- 为每个素材维护 `dataset.agentskinAssetBlobUrl_<id>`，沿用 revoke 语义。

**改动点 D — A 线（Studio 导出）补齐收包【新增】**
- `build-theme-package.mjs` 当前不产 hero/multi-image → 需在 `buildThemePackage()` 里按 manifest `hero` + `assets.images` 读图转 base64 进 bundle，并复用 B 线校验（`SAFE_IMAGE_TYPES` 等）。
- 否则 Studio 导出的主题永远无法带多素材，2a 只对 B 线原生效。

### 2.3 安全 / 门禁（已核对定值）

已核对 [package.mjs](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/theme/package.mjs#L8-L12)：
- **数量上限**：`MAX_THEME_IMAGES = 32`（当前值）→ 沿用，不另设。
- **mime 白名单** `SAFE_IMAGE_TYPES`：`image/png / image/jpeg / image/webp / image/gif` — **已含 GIF** → mascot 动画小人 2a 即可做，无需等 2c。
- **id 校验** `SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i`。
- **体积上限**：每素材沿用 hero 传输上限（chunk ~2MB/次）。**累计体积门禁已定 = 8MB**（base64）——见下方推导。
- **路径安全**：复用 [theme-package-loader.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/catalog/theme-package-loader.ts#L54-L60) 的 `resolveWithin`（防路径逃逸包根）。
- **CSP**：Blob URL 方案不变，已绕过 file:// CSP。

### 2.3.1 累计体积门禁推导（已定 8MB base64）

常量（见 [injection-constants.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/shared/injection-constants.ts#L174)）：
- `HERO_CHUNK_THRESHOLD = 256KB`：低于此走单 evaluate 直传。
- `WALLPAPER_CHUNK_SIZE = 2MB`：每次 evaluate 块上限。
- 已知教训（[hero-inject.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/injection/hero-inject.ts#L23-L31)）：单 hero 800KB→~1.1MB base64 曾致 30s 超时，chunk 化后解决。

**推导**：
- base64 膨胀 ~4/3（800KB → 1.1MB ≈ ×1.34）。
- 8MB base64 ≈ 6MB 原始素材。以 2MB/次 chunk 传输，需 4 次 evaluate。
- 32 张上限 ÷ 8MB 累计 ≈ 平均每张 ≤ 250KB base64（≈ 187KB 原始）——即绝大多数素材走 **64KB~256KB 区间**，恰好落在"无需 chunk、单 evaluate 直传"带内，注入开销与现有单 hero 同级。
- 8MB 超出的场景（如 5 张 1.5MB 大图）触发 chunk 化，仍受每块 2MB 约束，不会重蹈 30s 超时。

→ **定 8MB base64 为累计上限**：85% 典型主题全走单 evaluate 快路径，放大器场景靠 chunk 兜底。若未来需要大图集，可单独提高但需重测超时。

### 2.4 向后兼容

- 旧主题无多素材 → `imageDataUrls` 仅 hero → 行为与现在完全一致。
- `--agentskin-art` 别名保留，所有现有 agent CSS 无需改动。
- `minAppVersion` 仅对新主题标注，旧主题无需更名。

---

## 3. 边界（本 RFC 明确不做）

- ❌ 素材**绑到具体面/坐标/尺寸/z-index** → 属 2b（面级布局定位）。
- ❌ 透明可动 overlay / GIF 动画运行时 → 属 2c。
- ❌ 壁纸通道（`image-injector`/`video-injector`）改造——它们是独立单壁纸渲染，不并入。
- ❌ 新增适配器 / 新增 UI 页。

---

## 4. 验收标准

1. 主题声明 2+ 素材 → 运行时 `--agentskin-asset-*` 全部可读，hero 别名 `--agentskin-art` 仍生效。
2. 旧主题（仅 hero）→ resource 级像素不变、无回归。
3. 超数量/体积门禁 → 打包被拒并报清晰错误。
4. 切主题 N 次无 Blob 泄漏（沿用 revoke 校验）。
5. `npm run check` 全绿（含 check-themes / staleness 契约）。

---

## 5. 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 多 Blob 传输增大注入耗时 | 中 | 中 | 复用 chunk；素材惰性注入（首屏只 hero，其余按需） |
| 改注入函数破坏现有 hero 链路 | 中 | 高 | 别名 + 兼容分支 + 既有 hero 测试保底 |
| 体积膨胀撑爆包 | 低 | 中 | 数量 + 累计体积门禁 |
| 验证器语义漂移 | 低 | 中 | 复用 `heroInjected` 架构，仅扩素材维度 |

---

## 6. 依赖 / 前置

- `deep-adaptation-initiative.md` §4.2 已包含本 RFC 为子项。
- **路线已定**：复用 `bundle.assets.images`（B 线），A 线 `build-theme-package.mjs` 需补 hero/多图收包（改动点 D）。
- **全部门禁已定**：`MAX_THEME_IMAGES = 32`；`SAFE_IMAGE_TYPES` 含 `image/gif`；累计体积 8MB base64；注入时机=全量。**无剩余待核项**。

---

## 7. 评审待决策

| # | 待决策 | 倾向建议 |
|---|--------|---------|
| 1 | 素材声明走 `bundle.assets.images`(打包进 bundle) 还是独立文件路径？ | ✅ **已定：复用 `bundle.assets.images`**（见 §2.1），不另起 `assets.decorations` |
| 2 | 注入时机：全量注入 vs 首屏 hero + 其余按需？ | ✅ **已定：初版全量注入**（一次 `transferImageSet` 完成，一致性优先）。多数素材 ≤256KB 走单 evaluate 快路径，多图不显著增加开销；按需注入/懒加载相位延迟到阶段三。 |
| 3 | 数量上限定多少？ | ✅ **已定：沿用 `MAX_THEME_IMAGES = 32`**（当前值，不另设） |
| 4 | hero 别名 `--agentskin-art` 是否长期保留？ | 保留（向后兼容硬要求） |
| 5 | GIF/svg 是否纳入 `SAFE_IMAGE_TYPES`？ | ✅ **已定：GIF 已在白名单**（`SAFE_IMAGE_TYPES` 含 `image/gif`）；svg 未纳入，风险高，留给 2c |

---

## 8. 分阶段实施（评审通过后）

- **阶段一（P0）**：透传 `imageDataUrls` 全量 + 泛化注入（**全量 `transferImageSet`**）+ 别名兼容 + 回归测试。
- **阶段二（P0)**：A 线 `build-theme-package.mjs` 补 hero/multi-image 收包(复用 `bundle.assets.images` 校验) + 数量/累计体积门禁(8MB) + 校验器扩素材。
- **阶段三（P2）**：按需/懒加载注入优化（可选，如素材多时先 hero 后其余）。