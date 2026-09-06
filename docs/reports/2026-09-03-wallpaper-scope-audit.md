# 壁纸库最终方案：替换线 / 导出线分离

- **日期**: 2026-09-03（v2，定稿自 v1 范围审计）
- **状态**: 待老板批准实施
- **决策来源**: 老板 2026-09-03 两轮澄清：
  1. "壁纸库只做替换壁纸的事，不做主题"；壁纸（图/视频）= 主题的背景层资源，
     替换是把选中壁纸换到当前主题做背景，不生成新主题、不覆盖原主题。
  2. 完整模型（本轮）：正常替换 = 纯替换；自动取色保留；
     "导出为主题包"= 显式按钮 → 主题包加入主题库，**不属于注入流程**；
     视频同样可作为主题包背景来源。

---

## 1. 产品模型（定稿）

```
壁纸库（图 + 视频）
 ├─ 替换线  「应用」            → 纯背景替换（现状已正确，零改动）
 └─ 导出线  「导出为主题包」     → 取色 → 生成主题包 → 加入主题库（不自动 apply / 不注入）
```

- 大部分主题本来就是"先有背景图 → 再生成主题包"；壁纸库的资源（含视频）天然是
  主题包背景素材源。
- 视频主题：导出时把视频捆绑为主题自带壁纸（theme.wallpaper.video 机制，已存在），
  复用"每个主题自带壁纸"的模型。

## 2. 现状 vs 目标（代码面）

| 现有 | 现状行为 | 目标行为 |
|------|---------|---------|
| `WALLPAPER_EXTRACT_THEME`（wallpaper-ipc:218） | 壁纸取色→生成主题包→install（不 apply） | ✅ 语义本已正确 → **保留**，改 UI 定位为"导出为主题包" |
| `WALLPAPER_PREVIEW_THEME`（wallpaper-ipc:284） | 实时取色预览（不落盘） | ✅ 自动取色能力 → **保留** |
| `WALLPAPER_APPLY_THEME`（wallpaper-ipc:304） | 生成主题包 + install + **自动 apply 到 agent** | ❌ 混入注入流程 → **删除**（apply 不属于壁纸流程） |
| MCP `create_theme_from_image`（creation-tools） | 通用图片→主题创作 | 保留与否由老板另裁（与壁纸库无关，本方案不动） |
| 正常替换链路（APPLY_AGENT/APPLY_TO_AGENT/REMOVE） | 纯背景注入 + 可还原 | ✅ 零改动 |

## 3. 改动清单（批准后执行）

### 主进程
1. `wallpaper-ipc.ts`：删 `WALLPAPER_APPLY_THEME` handler（304-343）；
   `WALLPAPER_EXTRACT_THEME` 保留（注释改"导出为主题包"语义）
2. `shared/ipc-channels.ts` / `shared/types/ipc.ts`：删 `WALLPAPER_APPLY_THEME`
   通道与方法契约
3. `preload/wallpaper.facet.ts`：删 `applyThemeFromWallpaper`；`extractThemeFromWallpaper`
   重命名或注释为 exportTheme

### UI
4. 壁纸页/卡片：将既有触发提取的地方改为显式**「导出为主题包」**按钮
   （确认后新增/改名；成功 toast 引导去主题页查看）
5. `wallpaperStore.ts` / `studio/image-wallpaper-store.ts`：同步删 apply 调用、
   提取调用接导出语义（不自动 apply）；测试 mock 同步

### 文档/契约
6. IPC 契约文档、wallpaper store 测试、image-wallpaper-store 测试同步

## 4. 风险

- IPC 契约变更 → preload/UI/store/test 同一版本内同步删（本地应用自洽，无跨版本包袱）
- EXTRACT_THEME 与导出按钮行为核对：点击导出 = build + install，**不触发**
  apply/ensureCdpReady（确认当前 handler 无隐性注入）
- 视频导出为主题包走既有 registerThemeWallpaper → 主题自带壁纸，属保留机制

## 5. 待老板确认

1. 「导出为主题包」按钮放在壁纸卡片操作区（同"应用/删除"并列）可以吗？
2. MCP `create_theme_from_image`（通用图片→主题）本轮动还是不动？
