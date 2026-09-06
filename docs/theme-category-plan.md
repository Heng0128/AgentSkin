# 主题分类重规划（Theme Category Re-Plan）

> 版本: 1.0.0 | 日期: 2026-08-17
> 目标：以**宣传卖点**为纲重设主题分类谱系，删除旧的 14/15 个内置主题包（砍包不砍页），并为后续每个分类落 1 个代表主题打好规划。

---

## 1. 现状与问题

- 当前内置主题包（`themes/<id>/`）：`amber-dusk / aurora-violet / bamboo-mist / cyber-rose / deepspace-nebula / forest-pine / glacier-white / graphite-code / midnight-jazz / nordic-minimal / ocean-tide / rose-quartz / sakura-noir / sakura-pastel / terminal-green`（共 15 个，用户口述 14 个，存在 1 个出入）。
- 旧分类标签（`src/shared/i18n.ts` `categoryLabel` 注册的 slug）：`cyberpunk / minimal / anime / nature / retro / professional / creative / dark / light / art`，偏"裸标签"，难以作为宣传抓手。
- 现状分布不均：`minimal` 3 个、`nature` 4 个、`creative` 3 个，`anime / cyberpunk / retro` 各 1 个；缺乏"成套、场景、材质、动效"等可感知的营销切入点。

**决策：** 将旧的 15 个内置主题包整体清空（仅删除 `themes/<id>/` 目录与其在用户库中的残留副本），保留主题页骨架；在此基础上用下面的"宣传式分类谱"重新立项，遵循**一分类一代表主题**的开发策略。

---

## 2. 新分类谱（宣传卖点维度）

### 2.1 核心 8 大分类主线

| # | 分类（slug） | 宣传卖点 | 说明 |
|---|--------------|----------|------|
| C1 | `ui-override` 完整 UI 复写 | 旗舰/还原度 | 配色到组件/字体/圆角/动效/骨架全量改写，还原目标 99%+ |
| C2 | `ip` IP 联名 | 粉丝圈/传播 | 知名 IP 配色复写（二次元/游戏/影视） |
| C3 | `editor` 编辑器 | 极客/开发 | GitHub Dark、Dracula、Darcula、One Dark 等高还原编辑风 |
| C4 | `gaming` 游戏成套 | 玩家圈 | 成套游戏氛围复写示例：原神/塞尔达/战地暗夜 |
| C5 | `retro` 怀旧 | 情绪/记忆点 | CRT、像素、报纸、拟物（Win98）、黑胶/磁带 |
| C6 | `wallpaper-fx` 壁纸特效（动态） | 氛围/动效 | 极光、星空、数字雨、流体渐变、玻璃拟态 |
| C7 | `palette` 纯配色（壁纸+滤镜） | 低门槛/普适 | 单色滤镜、潘通/莫兰迪色系、季节限定 |
| C8 | `cyberpunk` 赛博主题 | 视觉冲击/自带传播 | 霓虹故障艺术、东京雨夜、matrix 绿 |
| C9 | `premium` 高级视觉 | 质感/贵 | 琉璃、午夜爵士、鎏金暗黑、羊绒布料 |
| C10 | `minimal-work` 极简办公 | 专注/效率 | 冰川白、北欧、石墨代码、禅意留白 |

> C1–C10 中 C2/C3/C4 是"完整 UI 复写(C1)"的题材壳，归并在 C1 大类下作为落地方向；C8 与"C6 叠加悬浮故障艺术"合并；其余为独立宣传档。

### 2.2 补充分类（补全遗漏，task c）

| slug | 卖点 | 说明 |
|------|------|------|
| `nature-season` 自然·四季 | 治愈 | 竹林雾凇/松林/琥珀暮色/海潮/雪景 |
| `anime` 动漫二次元 | 年轻化 | 樱花少女/热血番/治愈番 |
| `material` 材质质感 | 真实感 | 木纹/石纹/布艺/金属拉丝/纸张 |
| `terminal` 终端·极客文字 | 极客圈 | Matrix/ASCII/代码雨/terminal 绿 |
| `interactive` 轻交互动效 | 炫技 | 拖尾/涟漪/悬停光晕/打字机 |
| `tech` 科技数据感 | 未来办公 | HUD 平视/进度脉冲/网格矩阵 |
| `holiday` 节日限定 | 事件营销 | 春节/圣诞/新年倒计时/万圣 |
| `functional` 情绪功能 | 刚需场景 | 番茄钟专注/深夜护眼/阅读纸感/冥想 |

> 完整谱系覆盖 5 个维度：**题材**(IP/游戏/编辑器)、**氛围**(怀旧/自然/节日)、**视觉**(赛博/高级/科技/材质)、**功能**(纯配色/极简/专注/终端)、**动效**(壁纸特效/轻交互)。

---

## 3. 现有主题 → 新分类映射（供补全与复用参考）

| 旧主题包 | 建议新分类 | 备注 |
|----------|-----------|------|
| cyber-rose | cyberpunk | 赛博蔷薇霓虹 |
| terminal-green | retro / terminal | 复古终端 |
| midnight-jazz | premium | 午夜爵士蓝调 |
| sakura-noir | premium | 樱花暗黑高级感 |
| graphite-code | minimal-work / editor | 石墨代码 |
| glacier-white | minimal-work | 冰川白 |
| nordic-minimal | minimal-work | 北欧极简 |
| amber-dusk | nature-season | 琥珀暮色 |
| forest-pine | nature-season | 松林 |
| bamboo-mist | nature-season / material | 竹林雾凇 |
| ocean-tide | nature-season / wallpaper-fx | 海潮/渐变 |
| aurora-violet | wallpaper-fx / premium | 极光流动 |
| deepspace-nebula | wallpaper-fx | 深空漫游 |
| rose-quartz | premium | 琉璃石英质感 |
| sakura-pastel | anime | 樱花粉 |

---

## 4. 各分类示例（task a：补全 + 独特/通用例）

> 每类摘 1+ 独特例，再列通用（不独特）例。

- **C1 UI 复写**：独特 = 赛博故障整机复写 / 黑胶拟物音乐台 / 白金极简几何 / CRT 终端整机；通用 = 深色护眼复写、跟随系统浅色。
- **C2 IP**：独特 = 火影带土 / 原神璃月 / 塞尔达山海 / 泡泡玛特马卡龙；通用 = 泛卡通可爱合集。
- **C3 编辑器**：独特 = GitHub Dark / JetBrains Darcula / VSCode One Dark / Neovim 极简；通用 = 泛终端绿蓝。
- **C4 游戏成套**：独特 = 明日方舟性冷淡 / 原神璃月国风 / 塞尔达山海 / 战地暗夜；通用 = 泛游戏炫彩霓虹。
- **C5 怀旧**：独特 = CRT 绿磷光 / Game Boy 像素绿 / 报纸打印 / Win98 拟物 / 黑胶磁带 / 街机；通用 = 泛复古棕褐、泛旧照片灰蓝。
- **C6 壁纸特效**：独特 = 极光流动 / 星空深空 / 数字雨 / 流体渐变 / 流动液体 / 玻璃拟态；通用 = 泛渐变、泛暗色动态模糊。
- **C7 纯配色**：独特 = 樱花粉滤镜(↔sakura-pastel) / 莫兰迪 / 潘通年度色 / 季节限定；通用 = 红蓝绿单色滤镜、黑白极简。
- **C8 赛博**：独特 = 赛博蔷薇霓虹(↔cyber-rose) / 霓虹青紫故障 / 东京雨夜 / matrix 绿；通用 = 泛暗色荧光描边。
- **C9 高级视觉**：独特 = 琉璃石英(↔rose-quartz) / 午夜爵士(↔midnight-jazz) / 樱花暗黑(↔sakura-noir) / 鎏金暗黑 / 羊绒质感；通用 = 泛暗金高级、泛灰蓝商务。
- **C10 极简办公**：独特 = 冰川白(↔glacier-white) / 北欧(↔nordic-minimal) / 石墨(↔graphite-code) / 禅意留白 / 深度专注单色；通用 = 泛白底单主色。

---

## 5. 后续开发主题路线（task b，规划不开发）

每个分类先 1 个代表主题，达成"一分类一标杆"，后续在同分类内用 `color-schemes` 变体横向扩展。

- **极简**：禅意留白单色
- **数字雨**：Matrix 代码雨（terminal/cyberpunk）
- **流体渐变**：流动渐变壁纸特效
- **玻璃效果**：玻璃拟态磨砂
- **流动液体**：液体流动动态
- **悬浮玻璃**：悬浮玻璃卡片轻动效
- （建议补）深空漫游 / 极光流动 / 黑胶复古 / 末日战地 / 二次元樱花 / HUD 科技感

---

## 6. 开发策略与执行约定

1. **砍包不砍页**：删除仅限 `themes/<id>/` 主题包及其用户库残留副本；主题页、分类展示、分类 taxonony 结构保留。
2. **一分类一代表**：先覆盖后扩展——每分类首个主题做标杆，后续用变体扩展不新增空包。
3. **落地顺序**（建议）：
   - [ ] 删除旧 15 个主题包目录
   - [ ] 在 `theme-seeder.ts` 的 `REMOVED_BUILTIN_THEME_IDS` 中登记被删 id，启动时清理用户库残留
   - [ ] 更新 `src/shared/i18n.ts` 分类 label，注册新分类 slug
   - [ ] 按分类谱选择首批代表主题（每分类 1 个）立项开发

> 说明：本文件是**规划**文档，记录分类谱系与路线；旧包的删除登记与分类代码改造为后续执行项，避免一次性大改动冲击现有契约（C2/check-themes）。