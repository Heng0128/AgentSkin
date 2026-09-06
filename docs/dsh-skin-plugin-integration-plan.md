# DSH 社区皮肤/主题插件全景索引与 AgentSkin 整合方案

> 整理日期：2026-08-25  
> 适用范围：DeepSeek Harness (DSH) 社区皮肤插件 + AgentSkin 项目整合规划  
> 状态：**草案**（待 RFC 评审后执行）

---

## 目录

1. [背景与目标](#一背景与目标)
2. [DSH 社区皮肤插件全景索引](#二dsh-社区皮肤插件全景索引)
3. [AgentSkin 能力借鉴分析](#三agentskin-能力借鉴分析)
4. [插件化加载与适配策略](#四插件化加载与适配策略)
5. [整合实施路线图](#五整合实施路线图)
6. [附录：完整插件清单](#附录完整插件清单)

---

## 一、背景与目标

### 1.1 为什么关注 DSH 皮肤生态？

**DeepSeek Harness (DSH)** 是 DeepSeek 官方于 2026 年 8 月开源的 AI Agent 运行时框架，核心理念为「**一切皆插件**」（Everything is a Plugin）。其底层基于 Cordis 微内核，模型、工具、会话、沙箱、UI 甚至 Agent Loop 本身均可被插件替换或扩展。

原生 Web UI 界面简洁朴素，社区已涌现 **超过 100 个独立皮肤/主题插件**，涵盖：
- 角色立绘/完整皮肤包（鲸鱼娘、夕小瑶、QQ2006 复古等）
- 配色/调色板主题（OKLCH 设计器、VS Code 风格等）
- 液态玻璃/毛玻璃风格
- 桌宠/互动宠物
- 换肤工具/管理器

### 1.2 AgentSkin 的定位与机会

**AgentSkin** 的核心思路——通过 CDP 注入为 AI 应用替换主题和皮肤——与 DSH 插件体系理念高度一致。两者面临相同的问题域：如何让用户轻松地为 AI Agent 工具换肤。

本方案的目标是：
1. **梳理 DSH 皮肤生态全貌**，建立完整的插件索引
2. **识别可借鉴的设计模式和能力**，优化 AgentSkin 本体
3. **规划 DSH 皮肤插件的适配路径**，让 AgentSkin 支持加载 DSH 皮肤
4. **设计插件化入口**，将社区皮肤以插件形式引入 AgentSkin

---

## 二、DSH 社区皮肤插件全景索引

### 2.1 核心基础设施（推荐首先了解）

| # | 名称 | 链接 | Stars | 说明 |
|---|------|------|-------|------|
| 1 | dsh-market | https://github.com/dsh-market/dsh-market | ~2,200+ | DSH 内置可视化插件市场，支持浏览/搜索/安装/更新/卸载所有社区插件 |
| 2 | awesome-dsh-plugin | https://github.com/awesome-dsh-plugin/awesome-dsh-plugin | ~7,200+ | 社区维护的插件精选列表，按 11 个分类整理，是查找皮肤插件的主要入口 |
| 3 | deepseek-harness-plugin.com | https://deepseek-harness-plugin.com | - | 独立的社区主题索引站，含每款插件的安装命令和详细说明 |

### 2.2 插件分类统计

| 分类 | 特点 | 代表项目数 | 典型项目 |
|------|------|-----------|---------|
| A. 角色立绘/完整皮肤包 | 整站视觉更换，含角色形象、背景、动效 | ~20 | dsh-deep-whale, whale-girl, dsh-qq2006 |
| B. 配色/调色板主题 | 仅改颜色，不改布局/素材 | ~25 | freestyle-dsh-theme, dsh-gui-customization |
| C. 液态玻璃/毛玻璃 | Glassmorphism 风格主题 | ~12 | dsh-liquid-glass, DSH-Transparent-UI-Plugin |
| D. 桌宠/互动宠物 | 界面角落悬浮宠物 | ~8 | whale-girl, KinGao294/dsh-skin |
| E. 换肤工具/管理器 | 提供换肤辅助工具、设计器 | ~15 | dsh-skin-toggle, dsh-skin-picker |
| F. 综合工作台增强 | 多插件聚合包 | ~5 | dsh-web-ui, dsh-better-sidebar |

---

### 🐋 A. 角色立绘/完整皮肤包

#### 1. dsh-deep-whale — 鲸鱼娘 maid-atelier 皮肤系列 ⭐ 社区首选
- **项目链接**：https://github.com/Small-tailqwq/dsh-deep-whale
- **GitHub Stars**：~1,562
- **许可证**：CC BY-NC-SA 4.0
- **主语言**：TypeScript
- **特色**：鲸鱼娘/深海女仆工坊系列皮肤，亮色 + 暗色双模式切换，含预览图
- **素材规模**：多套皮肤，每套含角色立绘、背景图、装饰元素
- **安装命令**：`dsh plugin --profile web add github:Small-tailqwq/dsh-deep-whale`

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐⭐ 高
> - 多皮肤系列化管理模式可直接参考
> - 亮暗双模式的预览机制值得学习
> - 角色立绘+背景+装饰元素的完整素材组织方式

#### 2. deep-whale-day-night-theme — 鲸鱼娘昼夜工坊
- **项目链接**：https://github.com/GGBond2424648901/deep-whale-day-night-theme
- **特色**：完整昼夜主题（水晶白昼/月潮夜晚），含角色/Q版宠物、鲸鱼花边、玻璃面板、动态氛围、**356 张素材**；仅限个人/非商业使用
- **说明**：dsh-deep-whale 的衍生增强版，内容更完整

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - 昼夜双模式的素材管理体系
> - 动态氛围效果的实现方式

#### 3. whale-girl — QQ 宠物形态桌宠
- **项目链接**：https://github.com/vlln/whale-girl
- **GitHub Stars**：~261
- **许可证**：MIT
- **特色**：右下角悬浮可拖拽/投喂/玩耍的积累型伙伴，类似经典 QQ 宠物体验
- **安装命令**：`dsh plugin --profile web add github:vlln/whale-girl`

> **AgentSkin 借鉴价值**：⭐⭐⭐ 中
> - 桌面宠物的交互逻辑可参考
> - 但桌宠功能更适合作为独立插件，而非核心能力

#### 4. dsh-xiaoyao-skins — 夕小瑶 × DSH 皮肤合集 ⭐ 创作者平台
- **项目链接**：https://github.com/147228/dsh-xiaoyao-skins
- **GitHub Stars**：~20
- **特色**：夕小瑶角色向皮肤合集 + 安装器 + 社区创作工具链（模板、投稿通道、三平台测试、素材授权规范）；首发六套皮肤
- **定位**：既是皮肤包，也是皮肤创作分发平台

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - 社区创作工具链的设计思路
> - 素材授权规范的参考

#### 5. dsh-qq2006 — 完整 QQ2006 复古皮肤
- **项目链接**：https://github.com/LaplaceYoung/dsh-qq2006
- **特色**：完整复刻 2006 年 QQ 客户端界面；**356 张素材**；注册珊瑚蓝主题、全局皮肤表与组件级补丁；一键切换 + 持久化
- **说明**：DSh Meme Hub 收录的整活类代表作之一

> **AgentSkin 借鉴价值**：⭐⭐⭐ 中
> - 复古风格的素材组织方式
> - 组件级补丁的实现（如何精确覆盖特定 UI 元素）

#### 6. dsh-deepcel — Excel 风格布局皮肤
- **项目链接**：https://github.com/Small-tailqwq/dsh-deepcel
- **特色**：将 DSH 重建成电子表格样式，会话、工具、设置均重构为可交互单元格
- **定位**：趣味整活类，非实用向

> **AgentSkin 借鉴价值**：⭐⭐ 低
> - 可作为插件示例，但不建议直接集成

#### 7. dsh-skin-blue-whale — 深蓝鲸鱼主题
- **项目链接**：https://github.com/zenghuizhu69-hub/dsh-skin-blue-whale
- **特色**：DeepSeek 官方渐变蓝 + 跃鲸艺术图；轻量级单套皮肤

#### 8. dafy-whale-theme — 蓝色大肥鱼主题
- **项目链接**：https://github.com/DViridescent/dafy-whale-theme
- **特色**：海洋蓝配色 + 游动鱼群 + 上升气泡 + 右下角 DeepSeek 娘吉祥物（可互动）+ 「每日鱼语」输入框上方文字

#### 9. deepseek-harness-skin — 21 套内置皮肤 + 图片生成配色
- **项目链接**：https://github.com/HeiGeAi/deepseek-harness-skin
- **GitHub Stars**：~32
- **特色**：21 套内置皮肤 + 「传一张图即生成整套配色」的自定义通道；保对比度推导，构建期校验可读性
- **许可证**：MIT

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - 图片生成配色的算法值得研究
> - 对比度推导和可读性校验机制

---

### 🎨 B. 配色/调色板主题

#### 10. freestyle-dsh-theme — OKLCH 主题设计器 ⭐ 自设计首选
- **项目链接**：（社区目录页收录，需进一步确认精确 GitHub 路径）
- **特色**：基于 OKLCH 色彩模型的「主题提案 + 主题设计器」；点卡片或拖滑杆即可换肤；重启后自动读回上次的配色；跨重启持久化
- **定位**：面向设计师/极客用户的深度定制工具

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐⭐ 高
> - OKLCH 色彩模型的应用方式
> - 主题设计器的交互设计
> - 跨重启持久化机制

#### 11. dsh-gui-customization — Nous 蓝配色 + 氛围光 + 背景图/视频 ⭐ 综合定制首选
- **项目链接**：https://github.com/LAN-TINA-WS/dsh-gui-customization
- **GitHub Stars**：~14
- **当前版本**：v0.6.2（2026-08-16 发布）
- **特色**：
  - 4 套预设一键切换（系统默认/Nous 蓝/靛紫/翡翠绿）
  - 13 个主题色字段自定义（明暗双盘独立）
  - 氛围光（开关/强度/呼吸幅度/5 种位置模式）
  - 图片/视频背景（透明度和侧栏透底单独控制）
  - 配置 JSON 导入/导出 + localStorage/IndexedDB 跨重启持久化
- **安装命令**：`dsh plugin --profile web add github:LAN-TINA-WS/dsh-gui-customization#path:packages/dsh-gui-customization`
- **许可证**：MIT

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐⭐ 高
> - 氛围光的实现方式
> - 图片/视频背景的透明度和模糊控制
> - 配置 JSON 导入/导出机制
> - 明暗双盘独立管理的思路

#### 12. dsh-theme-plugin — 五套内置预设 + 完全自定义
- **项目链接**：https://github.com/BeiZi6/dsh-theme-plugin
- **特色**：5 套内置预设 + 完全自定义的浅/深配色（强调色、背景、前景、字体、半透明侧栏、对比度）；即时热切换并持久化到 localStorage

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - 半透明侧栏的实现
> - 即时热切换机制

#### 13. dsh-ui-skins — 换肤插件（注册到 ui-theme service）
- **项目链接**：https://github.com/edwardyang0011/dsh-ui-skins
- **特色**：将预设颜色皮肤注册为 ui-theme service 上的 alias-token 主题；拥有持久的 `ui-skins.skin` 偏好；在设置「通用」区注册「皮肤」行

> **AgentSkin 借鉴价值**：⭐⭐⭐ 中
> - ui-theme service 的注册机制
> - 偏好持久化的方式

#### 14. oil-oil/dsh-theme — 实时主题编辑器
- **项目链接**：https://github.com/oil-oil/dsh-theme
- **特色**：带 curated palettes 和排版控制的实时主题编辑器；更改即时生效，刷新后可恢复

#### 15. dsh-themes（MangMax）— VS Code 风格主题库
- **项目链接**：https://github.com/MangMax/dsh-themes
- **特色**：内置调色板、明/暗/跟随系统外观模式；支持 Open VSX 搜索安装和 VS Code 主题导入；主题库持久化

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - VS Code 主题导入机制（支持读取 .vsix 或 theme.json）
> - Open VSX 搜索安装的复用方式

#### 16. dsh-themes（whyihaveyou）— 151 个昼夜一体皮肤合集 ⭐ 规模最大
- **项目链接**：https://github.com/whyihaveyou/dsh-themes
- **来源迁移**：来自 [aionui-themes](https://github.com/whyihaveyou/aionui-themes)（302 套源）
- **特色**：151 个昼夜一体皮肤，涵盖绝区零/原神/崩铁/宝可梦/任天堂角色、20 个经典编辑器配色、20 种美学风格、节日限定、系统复古与彩蛋
- **配套画廊**：https://whyihaveyou.github.io/dsh-themes/（在线预览全部 151 款皮肤双模式截图）
- **所属套件**：dsh-suite 全家桶的一部分（含文档站 dsh-docs.com、插件开发指南等）

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐⭐ 高
> - 大规模皮肤合集的组织和管理方式
> - 昼夜一体的皮肤管理规范
> - 在线预览画廊的实现

---

### 🌊 C. 液态玻璃/毛玻璃风格

#### 17. dsh-liquid-glass（Ultronen）— 液态玻璃开关
- **项目链接**：https://github.com/Ultronen/dsh-liquid-glass
- **特色**：一键开启全界面通透液态玻璃效果；实时透明度滑块；支持自定义全屏背景图

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - 液态玻璃效果的实现（backdrop-filter + 透明度控制）
> - 实时透明度滑块的交互设计

#### 18. dsh-liquid-glass（xingyingyuzhui）— 壁纸 + 液态玻璃岛叠加
- **项目链接**：https://github.com/xingyingyuzhui/dsh-liquid-glass
- **特色**：在官方浅/深/跟随系统三色之上叠加壁纸，以及可选液态玻璃岛效果

#### 19. dsh-webUI-Glass-Theme — 全局磨砂玻璃主题
- **项目链接**：https://github.com/makuralymi/dsh-webUI-Glass-Theme
- **特色**：全局 `backdrop-filter` 磨砂玻璃覆盖层；保留原有浅色/深色选择；iOS/macOS 风格 frosted-glass 质感

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - 全局磨砂玻璃的实现
> - 与原有主题系统的兼容方式

#### 20. deepseek-harness-liquid-glass-theme — WebGL 液态透镜主题
- **项目链接**：https://github.com/Rainpomelo/deepseek-harness-liquid-glass-theme
- **特色**：WebGL 物理透镜折射 + 水波交互 + 分层毛玻璃 + 自定义图片/视频壁纸；技术含量最高

> **AgentSkin 借鉴价值**：⭐⭐⭐ 中
> - WebGL 效果的应用（可作为高级插件选项）
> - 分层毛玻璃的实现

#### 21. dsh-tide-ui — 极光潮汐液态玻璃皮肤
- **项目链接**：https://github.com/SoDaZilla-zzz/dsh-tide-ui
- **特色**：极光潮汐背景 + 液态玻璃 + 浮动工作区 + 鲸鱼娘伴侣；全方位 tunable 玻璃效果

#### 22. dsh-cerrda-theme — 液态玻璃丝绸暗色主题
- **项目链接**：https://github.com/Cerrda/dsh-cerrda-theme
- **特色**：部署级静态 Web 插件；一套完整的工业风液态玻璃设计；包含配色/字体/玻璃/背景动效

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - 工业风液态玻璃的设计语言
> - 完整的主题设计体系

#### 23. DSH-Transparent-UI-Plugin — Aqua 高自由度玻璃主题
- **项目链接**：https://github.com/vaspike/DSH-Transparent-UI-Plugin
- **特色**：顶栏/侧边栏/输入框/统计行/轨迹视图全部磨砂玻璃化；可调玻璃模糊度/磨砂度；支持流体或自定义壁纸（壁纸单独调模糊和磨砂）；开关关闭即可回到原生

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐⭐ 高
> - 高自由度的玻璃效果调节
> - 各 UI 组件的独立控制
> - 开关式回退到原生的设计

---

### 🐾 D. 桌宠/互动宠物

#### 24. dsh-theme-kit — 32 预设主题 + 桌面键盘宠物
- **项目链接**：https://github.com/ink5897/dsh-theme-kit
- **特色**：32 套预设主题 + 动画/静态壁纸 + 纸张纹理 + 分区文字深度控制 + 键盘形态桌面宠物（keyboard desktop pet）

> **AgentSkin 借鉴价值**：⭐⭐ 低
> - 桌面宠物更适合作为独立插件

#### 25. KinGao294/dsh-skin — 换皮肤 + 奶龙桌宠
- **项目链接**：https://github.com/KinGao294/dsh-skin
- **特色**：换皮肤 + 自定义背景 + **奶龙桌宠**（带 sticker pack）；Codex 风格主题切换体验

---

### 🔧 E. 换肤工具/管理器

#### 26. dsh-skin-toggle — 鲸鱼按钮皮肤管理器
- **项目链接**：https://github.com/tiantyu/dsh-skin-toggle
- **特色**：可拖拽鲸鱼按钮；左键点击恢复默认外观，右键点击切换已安装皮肤；纯客户端插件

> **AgentSkin 借鉴价值**：⭐⭐⭐ 中
> - 快捷切换的皮肤管理器交互
> - 可作为浮窗控件参考

#### 27. dsh-skin-switcher — 设置页皮肤切换面板
- **项目链接**：https://github.com/zhtx2024/dsh-skin-switcher
- **特色**：在设置界面新增「皮肤」页，列出所有已安装皮肤并提供一键切换；支持一键恢复官方默认外观

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - 设置页皮肤管理的设计
> - 一键恢复默认的外观

#### 28. dsh-theme-picker — 设置面板主题管理页
- **项目链接**：https://github.com/yhPrime/dsh-theme-picker
- **特色**：在设置面板添加「主题」页面；统一管理应用主题与已安装的主题插件；同一时间仅一个主题生效，其余自动禁用

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - 主题管理页的统一设计
> - 互斥主题的管理逻辑

#### 29. dsh-skin-picker — 自然语言换肤 + 跨设备同步
- **项目链接**：https://github.com/Lzh-12/dsh-skin-picker
- **GitHub Stars**：待核实
- **特色**：10 套预设皮肤 + **自然语言换肤**（用自然语言描述想要的效果即可换肤） + 自定义背景图片 + 界面控件联动；settings.yaml 跨设备同步

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐⭐ 高
> - 自然语言换肤的交互创新
> - 跨设备同步机制

#### 30. Yugitan/dsh-skin — 图片换肤 + 渐变色预设
- **项目链接**：https://github.com/Yugitan/dsh-skin
- **特色**：渐变色预设 + 图片壁纸 + 半透明 + 强调色；配置持久化到用户设置

#### 31. dsh-skin-market — 社区皮肤市场
- **项目链接**：https://github.com/kingOfSoySauce/dsh-skin-market
- **GitHub Stars**：~54
- **特色**：嵌入 DSH 设置页的皮肤市场；可浏览/安装/使用/停用/更新/卸载社区皮肤；100+ 皮肤已收录；支持评分和人工审核入口

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐⭐ 高
> - 社区皮肤市场的完整架构
> - 评分和审核机制
> - 在线浏览和安装流程

---

### 🖼️ F. 综合工作台式皮肤包

#### 32. dsh-web-ui — DSH Web 插件聚合生态包 ⭐ 全家桶
- **项目链接**：https://github.com/zhu1090093659/dsh-web-ui
- **GitHub Stars**：~2,000+
- **特色**：
  - **任务看板**（task board）
  - **移动端远程控制**（mobile remote）
  - **SSH 运维终端**
  - **图像理解**（image understanding）
  - **梁神模式 agent 预设**
  - **救助模式**（rescue mode）
  - **右侧面板**
  - **多个预置皮肤**（blue-fantasy/dragon-heir/harbor/miku/minecraft/qq98 等）
  - **桌宠集成**（whale-girl 内置）
  - **WebGL 深度优化**，支持 Wallpaper Engine 壁纸
- **说明**：最完整的 DSH Web 工作台增强包，含 10+ 独立插件 + 皮肤系统

> **AgentSkin 借鉴价值**：⭐⭐⭐⭐ 中高
> - 多插件聚合的打包方式
> - 皮肤系统与功能插件的结合

#### 33. dsh-better-sidebar — 开放式侧边栏工作台底座
- **项目链接**：https://github.com/omdsh-dev/dsh-better-sidebar
- **GitHub Stars**：~2,500
- **特色**：VS Code 风格的右侧边栏 + 底部面板双工作台；支持第三方插件注册新侧边栏页面；内置文件渲染编辑/终端/侧边对话/Git/子代理页面

---

---

## 三、AgentSkin 能力借鉴分析

### 3.1 现状对比

| 维度 | AgentSkin 现状 | DSH 社区实践 | 差距/机会 |
|------|--------------|-------------|----------|
| 皮肤来源 | 内置主题 + 社区主题 | 100+ 社区皮肤插件 | **需补充插件入口** |
| 皮肤类型 | 静态配色 + 壁纸 | 角色立绘、液态玻璃、桌宠等 | **需扩展皮肤类型** |
| 管理方式 | 设置页单选 | 多皮肤并存 + 一键切换 | **需改进管理交互** |
| 自定义能力 | 有限的调色板 | OKLCH 设计器、自然语言换肤 | **需增强自定义** |
| 社区生态 | 无市场机制 | 皮肤市场 + 评分审核 | **需建设生态** |

### 3.2 借鉴优先级矩阵

根据「借鉴价值」和「实现难度」两个维度，将 DSH 社区实践分为四类：

| 优先级 | 标准 | 借鉴项 |
|--------|------|--------|
| 🔴 P0 | 高价值 + 低难度 | 氛围光效果、液态玻璃效果、背景图/视频控制 |
| 🟠 P1 | 高价值 + 中难度 | 自然语言换肤、皮肤市场机制、跨设备同步 |
| 🟡 P2 | 中价值 + 低难度 | 明暗双盘独立管理、配置 JSON 导入/导出 |
| 🟢 P3 | 中价值 + 中难度 | 昼夜一体皮肤管理、在线预览画廊 |

---

### 3.3 具体借鉴项详解

#### 3.3.1 主题与视觉效果

| 借鉴项 | DSH 参考项目 | AgentSkin 应用方式 | 优先级 |
|--------|------------|-------------------|--------|
| 氛围光效果 | dsh-gui-customization | 作为内置主题增强选项，支持角落光晕、呼吸效果 | 🔴 P0 |
| 液态玻璃效果 | DSH-Transparent-UI-Plugin, dsh-liquid-glass | 提供玻璃质感主题变体，支持透明度/模糊度调节 | 🔴 P0 |
| 背景图/视频控制 | dsh-gui-customization, dsh-webUI-Glass-Theme | 强化壁纸引擎，支持局部透明、混合模式 | 🔴 P0 |
| 明暗双盘独立 | dsh-gui-customization | 完善现有主题系统的明暗模式支持 | 🟡 P2 |
| 配置 JSON 导入/导出 | dsh-gui-customization | 支持主题的分享和备份 | 🟡 P2 |
| 在线预览画廊 | whyihaveyou.github.io/dsh-themes | 在社区主题页增加预览功能 | 🟢 P3 |

#### 3.3.2 插件功能

| 功能模块 | DSH 参考项目 | AgentSkin 应用方式 | 优先级 |
|----------|------------|-------------------|--------|
| 自然语言换肤 | Lzh-12/dsh-skin-picker | 作为可选插件，支持用自然语言描述并生成主题 | 🟠 P1 |
| 皮肤市场机制 | kingOfSoySauce/dsh-skin-market | 建设社区皮肤市场，支持浏览/安装/评分 | 🟠 P1 |
| 跨设备同步 | Lzh-12/dsh-skin-picker | 主题配置的云同步能力 | 🟠 P1 |
| 主题设计器 | freestyle-dsh-theme | 提供主题创建工具，支持 OKLCH 调色 | 🟠 P1 |
| 图片生成配色 | HeiGeAi/deepseek-harness-skin | 上传任意图片自动生成匹配的主题配色 | 🟠 P1 |

#### 3.3.3 管理与交互模块

| 管理模块 | DSH 参考项目 | AgentSkin 应用方式 | 优先级 |
|----------|------------|-------------------|--------|
| 皮肤切换面板 | zhtx2024/dsh-skin-switcher | 在设置页增加皮肤管理 Tab，支持预览和切换 | 🔴 P0 |
| 主题互斥管理 | yhPrime/dsh-theme-picker | 同一时间仅一个主题生效，自动禁用冲突主题 | 🔴 P0 |
| 快捷切换控件 | tiantyu/dsh-skin-toggle | 提供浮窗快捷切换控件（可选） | 🟡 P2 |
| 一键恢复默认 | zhtx2024/dsh-skin-switcher | 支持一键恢复到系统默认主题 | 🟡 P2 |

---

## 四、插件化加载与适配策略

### 4.1 DSH 皮肤作为插件的设计思路

**核心原则**：不将 DSH 皮肤直接转为 AgentSkin 内置主题，而是通过插件机制加载和适配。这样既尊重原作者的版权和创作意图，又保持了 AgentSkin 的模块化架构。

#### 4.1.1 插件分类

根据 DSH 皮肤的性质，将其分为三类插件：

| 插件类型 | 说明 | 示例 | 适配难度 |
|----------|------|------|----------|
| **原生皮肤插件** | 可直接转换为 AgentSkin 主题格式的皮肤 | dsh-deep-whale, dsh-qq2006 | 中 |
| **特效插件** | 提供特殊视觉效果（液态玻璃、氛围光等） | DSH-Transparent-UI-Plugin, dsh-gui-customization | 低 |
| **工具插件** | 提供换肤辅助功能 | dsh-skin-picker, dsh-skin-market | 高 |

#### 4.1.2 插件加载架构

```
┌─────────────────────────────────────────────────────────┐
│                    AgentSkin 主进程                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  内置主题包  │  │  DSH适配器  │  │  工具插件   │     │
│  │  (themes/)  │  │ (adapters/) │  │  (plugins/) │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
│         │                │                │             │
│         └────────────────┼────────────────┘             │
│                          ▼                              │
│              ┌─────────────────────┐                    │
│              │    插件管理服务      │                    │
│              │  (plugin-service)   │                    │
│              └──────────┬──────────┘                    │
│                         ▼                               │
│         ┌───────────────┼───────────────┐               │
│         ▼               ▼               ▼               │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐          │
│   │ CDP注入  │   │ CSS变量  │   │ 本地存储  │          │
│   │  引擎    │   │  系统    │   │  管理    │          │
│   └──────────┘   └──────────┘   └──────────┘          │
└─────────────────────────────────────────────────────────┘
```

### 4.2 DSH 皮肤适配流程

#### 4.2.1 适配步骤

```
DSH 皮肤仓库
     │
     ▼
┌─────────────────┐
│  1. 素材解析     │  识别皮肤结构：CSS/JSON/图片/字体
└────────┬────────┘
         ▼
┌─────────────────┐
│  2. 格式转换     │  转换为 AgentSkin 主题格式
│                 │  - CSS 变量映射到 design tokens
│                 │  - 图片资源复制到 themes/{name}/assets/
│                 │  - manifest.json 生成
└────────┬────────┘
         ▼
┌─────────────────┐
│  3. 兼容性验证   │  检查 14-token 契约、Palette-CSS 同步
└────────┬────────┘
         ▼
┌─────────────────┐
│  4. 插件打包     │  生成 .agentskin 插件包
└────────┬────────┘
         ▼
┌─────────────────┐
│  5. 安装部署     │  注册到插件市场，支持一键安装
└─────────────────┘
```

#### 4.2.2 关键适配规则

| 规则 | 说明 | 参考项目 |
|------|------|----------|
| Token 映射 | DSH 的 `--dsw-*` 变量映射到 AgentSkin 的 `--dl-*` 变量 | dsh-gui-customization |
| 素材组织 | 保持原始素材结构，复制到 `themes/{name}/assets/` | dsh-deep-whale |
| 双模式支持 | 确保亮色/暗色两套配色都正确适配 | deep-whale-day-night-theme |
| 版权标注 | 在 manifest.json 中保留原作者信息和许可证 | 所有插件 |
| 尺寸规范 | 遵循 AgentSkin 的尺寸和间距规范 | check-design-tokens.mjs |

### 4.3 插件化加载机制

#### 4.3.1 插件注册表

```typescript
// src/main/plugin-service/types.ts
interface DSHPluginManifest {
  id: string;                    // 插件唯一标识
  name: string;                  // 显示名称
  version: string;               // 版本号
  type: 'skin' | 'effect' | 'tool';  // 插件类型
  author: string;                // 作者
  license: string;               // 许可证
  description: string;           // 描述
  screenshots?: string[];        // 截图
  dshSource?: {                 // DSH 源信息
    repoUrl: string;             // GitHub 仓库地址
    commit?: string;             // 固定 commit（可选）
    originalLicense?: string;    // 原始许可证
  };
  assets: {                      // 资源清单
    css?: string[];              // CSS 文件
    images?: string[];           // 图片文件
    fonts?: string[];            // 字体文件
  };
  compatibility: {               // 兼容性声明
    minDSHVersion: string;       // 最低 DSH 版本
    maxDSHVersion?: string;      // 最高 DSH 版本
  };
}
```

#### 4.3.2 插件生命周期

```
下载 → 解析 → 转换 → 验证 → 打包 → 安装 → 启用 → 运行 → 卸载
 │                                              │
 └──────────────── 快照/还原 ───────────────────┘
```

---

## 五、整合实施路线图

### 5.1 阶段划分

| 阶段 | 时间 | 目标 | 关键交付物 |
|------|------|------|-----------|
| Phase 1 | 2026-Q3 | 插件框架搭建 | 插件管理系统、DSH 适配器基础 |
| Phase 2 | 2026-Q4 | 首批皮肤适配 | 3-5 个高质量 DSH 皮肤插件 |
| Phase 3 | 2027-Q1 | 社区生态建设 | 皮肤市场、创作者工具链 |
| Phase 4 | 2027-Q2 | 高级功能 | 自然语言换肤、在线预览画廊 |

### 5.2 Phase 1 详细计划（插件框架）

#### 5.2.1 新建目录结构

```
src/
├── main/
│   ├── plugin-service/
│   │   ├── index.ts                 # 插件服务入口
│   │   ├── registry.ts              # 插件注册表
│   │   ├── loader.ts                # 插件加载器
│   │   ├── validator.ts             # 插件验证器
│   │   └── types.ts                 # 类型定义
│   └── adapters/
│       └── dsh/                     # DSH 适配器
│           ├── index.ts
│           ├── converter.ts         # 格式转换器
│           ├── token-mapper.ts      # Token 映射器
│           └── verifier.ts          # 兼容性验证器
└── ui/
    ├── components/
    │   └── plugin-manager/
    │       ├── PluginMarketPanel.tsx
    │       ├── PluginCard.tsx
    │       └── PluginDetailSheet.tsx
    └── stores/
        └── pluginStore.ts           # 插件状态管理
```

#### 5.2.2 核心接口设计

```typescript
// 插件管理器接口
interface IPluginManager {
  // 加载
  loadPlugin(pluginPath: string): Promise<LoadedPlugin>;
  unloadPlugin(pluginId: string): Promise<void>;
  
  // 查询
  getPlugin(pluginId: string): Plugin | null;
  listPlugins(type?: 'skin' | 'effect' | 'tool'): Plugin[];
  
  // 安装/卸载
  installPlugin(source: PluginSource): Promise<InstalledPlugin>;
  uninstallPlugin(pluginId: string): Promise<void>;
  
  // 启用/禁用
  enablePlugin(pluginId: string): Promise<void>;
  disablePlugin(pluginId: string): Promise<void>;
  
  // 更新
  updatePlugin(pluginId: string): Promise<void>;
}

// DSH 适配器接口
interface IDSHAdapter {
  // 解析 DSH 皮肤结构
  parseDSHSkin(repoUrl: string, commit?: string): Promise<DSHSkinManifest>;
  
  // 转换为 AgentSkin 格式
  convertToAgentSkin(skin: DSHSkinManifest): Promise<AgentSkinManifest>;
  
  // 验证兼容性
  validateCompatibility(manifest: AgentSkinManifest): ValidationResult;
}
```

### 5.3 Phase 2 详细计划（首批皮肤适配）

#### 5.3.1 选定适配目标

基于以下标准选择首批适配的皮肤：

| 标准 | 权重 | 说明 |
|------|------|------|
| 社区热度 | 高 | GitHub Stars > 100 |
| 素材质量 | 高 | 素材完整、设计规范 |
| 适配难度 | 中 | 结构简单，易于转换 |
| 许可证友好 | 高 | MIT/Apache-2.0/CC BY |

#### 5.3.2 首批适配清单

| 排名 | 插件名 | 适配理由 | 预计工作量 |
|------|--------|----------|-----------|
| 1 | dsh-deep-whale | 社区最热门（1562 stars），素材完整 | 3d |
| 2 | dsh-gui-customization | 综合定制能力强，设计优秀 | 2d |
| 3 | deepseek-harness-skin | 图片生成配色，创新性强 | 2d |
| 4 | dsh-liquid-glass | 液态玻璃效果，视觉冲击力强 | 2d |
| 5 | DSH-Transparent-UI-Plugin | 高自由度玻璃主题 | 2d |

#### 5.3.3 适配工作流程

```
1. 克隆 DSH 皮肤仓库
2. 分析素材结构和 CSS 变量
3. 编写 Token 映射规则
4. 执行格式转换
5. 手动调整细节（如字体、间距）
6. 运行 check-design-tokens 验证
7. 打包为 .agentskin 插件
8. 提交到 AgentSkin 插件市场
```

### 5.4 Phase 3-4 高级功能

#### 5.4.1 自然语言换肤

基于 `Lzh-12/dsh-skin-picker` 的实现思路：

```typescript
// 自然语言换肤服务
class NaturalLanguageSkinService {
  async generateSkinFromPrompt(prompt: string): Promise<SkinConfig> {
    // 1. 调用 LLM 解析意图
    const intent = await this.parseIntent(prompt);
    
    // 2. 匹配现有主题或生成新配色
    const theme = await this.matchOrGenerateTheme(intent);
    
    // 3. 生成完整皮肤配置
    return await this.buildSkinConfig(theme);
  }
  
  private async parseIntent(prompt: string): Promise<SkinIntent> {
    // 使用 LLM 提取关键词：
    // - 风格（极简/工业/可爱/复古）
    // - 主色（深蓝/粉色/暗黑）
    // - 特殊效果（玻璃/渐变/动态）
  }
}
```

#### 5.4.2 皮肤市场建设

参考 `kingOfSoySauce/dsh-skin-market` 的架构：

```typescript
// 皮肤市场服务
class SkinMarketService {
  // 浏览皮肤
  async browseSkins(filters?: SkinFilters): Promise<SkinList>
  
  // 搜索皮肤
  async searchSkins(query: string): Promise<SkinList>
  
  // 获取皮肤详情
  async getSkinDetail(skinId: string): Promise<SkinDetail>
  
  // 安装皮肤
  async installSkin(skinId: string): Promise<InstallationResult>
  
  // 评分和评论
  async rateSkin(skinId: string, rating: number): Promise<void>
  async addReview(skinId: string, review: string): Promise<void>
}
```

---

## 六、风险与注意事项

### 6.1 许可证合规

| 风险点 | 说明 | 应对措施 |
|--------|------|----------|
| 许可证不一致 | DSH 皮肤使用不同许可证（MIT/CC BY-NC-SA 等） | 在插件元数据中明确标注，禁止商用 skin 不可用于商业化版本 |
| 素材版权 | 部分皮肤使用动漫/游戏角色素材 | 仅适配明确授权或原创素材的皮肤 |
| 品牌混淆 | DSH 品牌与 AgentSkin 品牌的关系 | 明确标注「社区适配版」，不使用 DeepSeek 官方品牌 |

### 6.2 技术风险

| 风险点 | 说明 | 应对措施 |
|--------|------|----------|
| DSH API 变化 | DSH 处于快速迭代期，插件接口可能破坏 | 锁定兼容的 DSH 版本范围，提供多版本适配器 |
| 性能影响 | 复杂特效（WebGL、动态壁纸）可能影响性能 | 提供性能等级选项，允许用户降级 |
| 兼容性 | 不同 AI Agent 应用的 UI 结构差异 | 建立应用适配层，针对不同应用定制注入策略 |

### 6.3 社区治理

- 建立插件审核流程，确保质量和安全
- 制定皮肤创作者指南，统一素材规范
- 设立贡献者激励机制（积分、认证等）

---

## 七、总结

### 7.1 核心价值

1. **生态互补**：AgentSkin 提供技术和架构基础，DSH 社区提供丰富的创意素材
2. **用户受益**：用户可以更方便地为各类 AI Agent 工具换肤，享受个性化体验
3. **创作者赋能**：皮肤创作者可以通过插件市场触达更多用户

### 7.2 下一步行动

- [ ] RFC 评审：提交本方案至 docs/rfc/ 目录
- [ ] 技术验证：实现 DSH 适配器原型，验证格式转换可行性
- [ ] 社区沟通：与 DSH 皮肤作者联系，获取适配授权
- [ ] 开发排期：确定 Phase 1 的具体任务和时间节点

---

## 附录：完整插件清单

| # | 插件名 | 作者/仓库 | 类别 | 链接 | 借鉴优先级 |
|---|--------|----------|------|------|-----------|
| 1 | dsh-deep-whale | Small-tailqwq/dsh-deep-whale | 角色立绘 | https://github.com/Small-tailqwq/dsh-deep-whale | 🔴 P0 |
| 2 | deep-whale-day-night-theme | GGBond2424648901/deep-whale-day-night-theme | 角色立绘 | https://github.com/GGBond2424648901/deep-whale-day-night-theme | 🔴 P0 |
| 3 | whale-girl | vlln/whale-girl | 桌宠 | https://github.com/vlln/whale-girl | 🟡 P2 |
| 4 | dsh-xiaoyao-skins | 147228/dsh-xiaoyao-skins | 角色皮肤+创作者工具链 | https://github.com/147228/dsh-xiaoyao-skins | 🟠 P1 |
| 5 | dsh-qq2006 | LaplaceYoung/dsh-qq2006 | 复古风格 | https://github.com/LaplaceYoung/dsh-qq2006 | 🔴 P0 |
| 6 | dsh-deepcel | Small-tailqwq/dsh-deepcel | 整活/Layout | https://github.com/Small-tailqwq/dsh-deepcel | 🟢 P3 |
| 7 | dsh-skin-blue-whale | zenghuizhu69-hub/dsh-skin-blue-whale | 轻量皮肤 | https://github.com/zenghuizhu69-hub/dsh-skin-blue-whale | 🟡 P2 |
| 8 | dafy-whale-theme | DViridescent/dafy-whale-theme | 角色+动效 | https://github.com/DViridescent/dafy-whale-theme | 🟡 P2 |
| 9 | deepseek-harness-skin | HeiGeAi/deepseek-harness-skin | 多皮肤+图生成 | https://github.com/HeiGeAi/deepseek-harness-skin | 🟠 P1 |
| 10 | freestyle-dsh-theme | （社区目录收录） | 主题设计器 | - | 🟠 P1 |
| 11 | dsh-gui-customization | LAN-TINA-WS/dsh-gui-customization | 综合定制 | https://github.com/LAN-TINA-WS/dsh-gui-customization | 🔴 P0 |
| 12 | dsh-theme-plugin | BeiZi6/dsh-theme-plugin | 配色预设 | https://github.com/BeiZi6/dsh-theme-plugin | 🔴 P0 |
| 13 | dsh-ui-skins | edwardyang0011/dsh-ui-skins | 皮肤注册 | https://github.com/edwardyang0011/dsh-ui-skins | 🟡 P2 |
| 14 | dsh-theme | oil-oil/dsh-theme | 实时编辑器 | https://github.com/oil-oil/dsh-theme | 🟡 P2 |
| 15 | dsh-themes | MangMax/dsh-themes | VS Code 主题库 | https://github.com/MangMax/dsh-themes | 🟠 P1 |
| 16 | dsh-themes | whyihaveyou/dsh-themes | 151 套皮肤合集 | https://github.com/whyihaveyou/dsh-themes | 🔴 P0 |
| 17 | dsh-liquid-glass | Ultronen/dsh-liquid-glass | 液态玻璃 | https://github.com/Ultronen/dsh-liquid-glass | 🔴 P0 |
| 18 | dsh-liquid-glass | xingyingyuzhui/dsh-liquid-glass | 液态玻璃叠加 | https://github.com/xingyingyuzhui/dsh-liquid-glass | 🔴 P0 |
| 19 | dsh-webUI-Glass-Theme | makuralymi/dsh-webUI-Glass-Theme | 全局磨砂玻璃 | https://github.com/makuralymi/dsh-webUI-Glass-Theme | 🔴 P0 |
| 20 | deepseek-harness-liquid-glass-theme | Rainpomelo/deepseek-harness-liquid-glass-theme | WebGL 液态透镜 | https://github.com/Rainpomelo/deepseek-harness-liquid-glass-theme | 🟡 P2 |
| 21 | dsh-tide-ui | SoDaZilla-zzz/dsh-tide-ui | 极光潮汐 | https://github.com/SoDaZilla-zzz/dsh-tide-ui | 🟡 P2 |
| 22 | dsh-cerrda-theme | Cerrda/dsh-cerrda-theme | 液态玻璃丝绸暗色 | https://github.com/Cerrda/dsh-cerrda-theme | 🔴 P0 |
| 23 | DSH-Transparent-UI-Plugin | vaspike/DSH-Transparent-UI-Plugin | Aqua 玻璃主题 | https://github.com/vaspike/DSH-Transparent-UI-Plugin | 🔴 P0 |
| 24 | dsh-theme-kit | ink5897/dsh-theme-kit | 32 预设+桌面宠物 | https://github.com/ink5897/dsh-theme-kit | 🟢 P3 |
| 25 | dsh-skin（KinGao294） | KinGao294/dsh-skin | 换皮肤+奶龙桌宠 | https://github.com/KinGao294/dsh-skin | 🟡 P2 |
| 26 | dsh-skin-toggle | tiantyu/dsh-skin-toggle | 皮肤切换按钮 | https://github.com/tiantyu/dsh-skin-toggle | 🟡 P2 |
| 27 | dsh-skin-switcher | zhtx2024/dsh-skin-switcher | 设置页皮肤管理 | https://github.com/zhtx2024/dsh-skin-switcher | 🔴 P0 |
| 28 | dsh-theme-picker | yhPrime/dsh-theme-picker | 主题选择器 | https://github.com/yhPrime/dsh-theme-picker | 🔴 P0 |
| 29 | dsh-skin-picker | Lzh-12/dsh-skin-picker | 自然语言换肤 | https://github.com/Lzh-12/dsh-skin-picker | 🟠 P1 |
| 30 | dsh-skin（Yugitan） | Yugitan/dsh-skin | 渐变色+图片换肤 | https://github.com/Yugitan/dsh-skin | 🟡 P2 |
| 31 | dsh-skin-market | kingOfSoySauce/dsh-skin-market | 社区皮肤市场 | https://github.com/kingOfSoySauce/dsh-skin-market | 🟠 P1 |
| 32 | dsh-web-ui | zhu1090093659/dsh-web-ui | 工作台全家桶 | https://github.com/zhu1090093659/dsh-web-ui | 🟡 P2 |
| 33 | dsh-better-sidebar | omdsh-dev/dsh-better-sidebar | 侧边栏工作台 | https://github.com/omdsh-dev/dsh-better-sidebar | 🟡 P2 |

---

*本报告基于 2026 年 8 月下旬的 DSH 社区生态整理，由于生态处于爆发期，部分数据和链接可能已有变化，请以最新信息为准。*
