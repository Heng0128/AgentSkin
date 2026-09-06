# AgentSkin 主题移植方案

> 版本: 1.0.0
> 日期: 2026-08-17
> 目标: 将 GitHub 上 8 大分类的参考项目移植适配到 AgentSkin 的 `.agentskin-theme` 格式

---

## 0. 移植方法论

### 0.1 AgentSkin 主题契约速览

每个主题必须交付：

```
themes/<id>/
├── manifest.json           # 14 token 声明 + 元数据
├── icon.png                # 128×128
├── preview.png             # 1280×720
├── palette.css             # 生成物（勿手改）
└── assets/css/
    ├── traework.css        # 生成物（--vscode-* 映射）
    ├── qoderwork.css       # 生成物（--color-* antd 映射）
    ├── workbuddy.css       # 生成物（--cb-* 映射）
    ├── doubao.css          # 生成物（--semi-color-* 映射）
    ├── codex.css           # 生成物（--color-* 映射）
    └── zcode.css           # 生成物（--color-* 映射）
```

**14 个 `--agentskin-*` token**：accent, secondary, bg, surface, surface-elevated, text, muted, border, code-bg, code-fg, input-bg, button-bg, focus-ring, selection。

### 0.2 移植流程（统一）

```
参考项目分析
  ├── 提取色板 → 映射到 14 token
  ├── 识别特效/动画 → 评估是否可 CSS-only 实现
  ├── 识别壁纸/图片资源 → 准备 hero.webp
  └── 识别 DOM 结构依赖 → 评估语义漂移风险
      ↓
创建 manifest.json（填 14 token）
      ↓
npm run generate:themes → 产出 palette.css + 6 agent CSS
      ↓
补充自定义 CSS（特效/壁纸/overlay 层）
      ↓
npm run check:themes → 全绿
      ↓
真机验证（6 agent 各跑一遍）
```

### 0.3 移植难度分级

| 等级 | 含义 | 涉及分类 |
|------|------|---------|
| **A — 纯配色** | 仅提取色板，生成器全自动产出 | 配色、极简办公 |
| **B — 配色+特效** | 配色 + CSS 动画/滤镜，无外部资源 | 赛博故障、特效 |
| **C — 配图依赖** | 需要准备图片资源（壁纸/艺术图） | 壁纸+滤镜 |
| **D — 结构依赖** | 依赖宿主 DOM 选择器，有漂移风险 | 完整 UI 复写 |
| **E — 独立叠加层** | 需要额外 HTML/JS overlay，非纯 CSS | 叠加悬浮装饰 |

---

## 1. 纯配色主题（难度 A）

### 1.1 Tokyo Night

| 字段 | 值 |
|------|-----|
| 参考项目 | [enkia/tokyo-night-vscode-theme](https://github.com/enkia/tokyo-night-vscode-theme) |
| 许可证 | MIT |
| 移植类型 | 纯配色（Night / Storm / Light 三变体） |

**色板提取**（来自 `themes/tokyo-night-color-theme.json`）：

| agentskin token | Night 值 | Storm 值 | Light 值 |
|-----------------|----------|----------|----------|
| accent | `#7aa2f7` | `#7aa2f7` | `#336199` |
| secondary | `#bb9af7` | `#bb9af7` | `#583aa6` |
| bg | `#1a1b26` | `#16161e` | `#eff1f5` |
| surface | `#24283b` | `#24283b` | `#e6e9ef` |
| surface-elevated | `#2f344d` | `#2f344d` | `#dce0e8` |
| text | `#c0caf5` | `#c0caf5` | `#303648` |
| muted | `#565f89` | `#565f89` | `#9aa5ce` |
| border | `rgba(122,162,247,0.18)` | `rgba(122,162,247,0.18)` | `rgba(51,97,153,0.18)` |
| code-bg | `#1a1b26` | `#16161e` | `#e6e9ef` |
| code-fg | `#c0caf5` | `#c0caf5` | `#303648` |
| input-bg | `#24283b` | `#24283b` | `#dce0e8` |
| button-bg | `rgba(122,162,247,0.2)` | `rgba(122,162,247,0.2)` | `rgba(51,97,153,0.2)` |
| focus-ring | `#7aa2f760` | `#7aa2f760` | `#33619960` |
| selection | `rgba(122,162,247,0.32)` | `rgba(122,162,247,0.32)` | `rgba(51,97,153,0.32)` |

**移植步骤**：

1. `mkdir themes/tokyo-night`
2. 写 `manifest.json`（mode: "dark"，填上表 Night 值）
3. 可选：创建 `color-schemes/storm.json` 和 `color-schemes/light.json` 实现三变体切换
4. 准备 `icon.png`（可用参考项目的 icon.svg 转 PNG）
5. `npm run generate:themes`
6. `npm run check:themes`

**预期产出**：3 套完整主题（Night/Storm/Light），每套含 6 agent CSS。

---

### 1.2 Catppuccin

| 字段 | 值 |
|------|-----|
| 参考项目 | [catppuccin/catppuccin](https://github.com/catppuccin/catppuccin) |
| 许可证 | MIT |
| 移植类型 | 纯配色（4 Flavor: Latte / Frappé / Macchiato / Mocha） |

**色板提取**（来自 `resources/palette.json`，推荐 Mocha 暗色 + Latte 亮色）：

| agentskin token | Mocha（暗） | Latte（亮） |
|-----------------|-------------|-------------|
| accent | `#cba6f7` | `#8839ef` |
| secondary | `#f5c2e7` | `#ea76cb` |
| bg | `#1e1e2e` | `#eff1f5` |
| surface | `#313244` | `#e6e9ef` |
| surface-elevated | `#45475a` | `#dce0e8` |
| text | `#cdd6f4` | `#4c4f69` |
| muted | `#6c7086` | `#9ca0b0` |
| border | `rgba(203,166,247,0.18)` | `rgba(136,57,239,0.18)` |
| code-bg | `#181825` | `#e6e9ef` |
| code-fg | `#cdd6f4` | `#4c4f69` |
| input-bg | `#313244` | `#dce0e8` |
| button-bg | `rgba(203,166,247,0.2)` | `rgba(136,57,239,0.2)` |
| focus-ring | `#cba6f760` | `#8839ef60` |
| selection | `rgba(203,166,247,0.32)` | `rgba(136,57,239,0.32)` |

**移植步骤**：

1. `mkdir themes/catppuccin`
2. 写 `manifest.json`（mode: "dark"，Mocha 值）
3. 创建 `color-schemes/latte.json`（mode: "light"，Latte 值）
4. 可选：追加 `frappe.json` / `macchiato.json` 实现 4 Flavor
5. 准备 `icon.png`（Catppuccin logo 剪影）
6. `npm run generate:themes`
7. `npm run check:themes`

**Catppuccin 社区生态可借鉴**：
- [catppuccin/vscode](https://github.com/catppuccin/vscode) — VSCode 端口，可参考其 `--vscode-*` 映射
- [catppuccin/tmux](https://github.com/catppuccin/tmux) — 终端配色映射
- [catppuccin/discord](https://github.com/catppuccin/discord) — 社区 overlay 实现

---

### 1.3 Dracula

| 字段 | 值 |
|------|-----|
| 参考项目 | [dracula/dracula-theme](https://github.com/dracula/dracula-theme) |
| 许可证 | MIT |
| 移植类型 | 纯配色（单暗色变体） |

**色板提取**：

| agentskin token | 值 |
|-----------------|-----|
| accent | `#bd93f9` |
| secondary | `#ff79c6` |
| bg | `#282a36` |
| surface | `#44475a` |
| surface-elevated | `#6272a4` |
| text | `#f8f8f2` |
| muted | `#6272a4` |
| border | `rgba(189,147,249,0.18)` |
| code-bg | `#21222c` |
| code-fg | `#f8f8f2` |
| input-bg | `#44475a` |
| button-bg | `rgba(189,147,249,0.2)` |
| focus-ring | `#bd93f960` |
| selection | `rgba(189,147,249,0.32)` |

**移植步骤**：同 Tokyo Night，单 variant。

---

## 2. 壁纸 + 滤镜主题（难度 C）

### 2.1 液态磨砂玻璃套装

| 字段 | 值 |
|------|-----|
| 参考项目 | [catsout/wallpaper-engine-kde-plugin](https://github.com/catsout/wallpaper-engine-kde-plugin) |
| 许可证 | GPL-2.0 |
| 移植类型 | 壁纸 + backdrop-filter 滤镜 |

**核心特性移植**：

| 特性 | 参考项目实现 | AgentSkin 移植方案 |
|------|-------------|-------------------|
| 底层壁纸 | Steam 创意工坊 MP4/WebP | 用户自选图片 → `hero.webp` + `--agentskin-art` |
| 模糊滑块 | QML Slider → `blur-radius` | CSS `backdrop-filter: blur(var(--glass-blur, 12px))` |
| 暗化遮罩 | 强制黑色 overlay | `::before { background: rgba(0,0,0,0.4) }` |
| 边框 | QML Rectangle | `border: 1px solid rgba(var(--agentskin-accent-raw), 0.2)` |
| 磨砂 | `backdrop-filter: blur()` + `brightness()` | 同上，CSS 变量控制强度 |

**新增 CSS 变量**（在 agent CSS 中扩展）：

```css
:root {
  --glass-blur: 12px;
  --glass-brightness: 0.85;
  --glass-border-opacity: 0.2;
  --glass-overlay-opacity: 0.4;  /* 暗化遮罩，强制 ≥ 0.3 保障可读性 */
}
```

**降级开关实现**：

```css
/* 低配模式：关闭全部 glass 效果 */
html.agentskin-low-power .glass-panel {
  backdrop-filter: none !important;
  background: var(--agentskin-surface) !important;
}
```

**移植步骤**：

1. `mkdir themes/liquid-glass`
2. 写 `manifest.json`（暗色基底，accent 偏蓝 `#7eb8da`）
3. 在 agent CSS 中追加 `.glass-panel` 选择器 + `backdrop-filter` 规则
4. 准备 `hero.webp`（流体渐变艺术图，1920×1080）
5. 在 `src/ui/` 的 Settings 面板添加 4 滑块 UI（blur / brightness / border / overlay）
6. 滑块值通过 IPC → 主进程 → 注入 CSS 变量更新
7. `npm run generate:themes` + `npm run check:themes`

**风险**：`backdrop-filter` 在 Windows 7/8 和部分 WGPU 环境下不支持，必须有降级。

---

### 2.2 静谧星空壁纸套装

| 字段 | 值 |
|------|-----|
| 参考项目 | [orangci/walls-catppuccin-mocha](https://github.com/orangci/walls-catppuccin-mocha) |
| 移植类型 | 静态壁纸 + 低饱和配色 |

**移植方案**：

1. 从参考项目选取 3-5 张星空壁纸 → 转 WebP → 作为 `hero.webp` 备选
2. 配色对齐 Catppuccin Mocha（见 1.2 色板）
3. 暗化遮罩强制开启（opacity ≥ 0.5，星空图通常较亮）
4. 无额外 CSS 特效，纯 `color-scheme` + 背景图

---

## 3. 特效主题（难度 B）

### 3.1 交互粒子星云

| 字段 | 值 |
|------|-----|
| 参考项目 | [matteobruni/tsparticles](https://github.com/matteobruni/tsparticles) |
| 许可证 | MIT |
| 移植类型 | Canvas 粒子 + 鼠标交互 |

**移植策略**：tsparticles 是完整 JS 引擎，AgentSkin 不直接引入。移植其**预设配置**为轻量 CSS + Canvas 实现。

**核心移植**：

```css
/* 粒子层：绝对定位、pointer-events 穿透 */
html.agentskin-host-traework .agentskin-particles {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;  /* 不拦截点击 */
  opacity: var(--fx-particle-opacity, 1);
  transition: opacity 0.3s;
}

/* 低配降级 */
html.agentskin-low-power .agentskin-particles {
  display: none;
}
```

**JS 注入**（通过 CDP Runtime.evaluate）：

```javascript
// 轻量粒子：50 个 div，CSS animation 驱动
// 参考 tsparticles 的 "absorbers" 预设做简化版
// 实际实现放在 engines/fx/particles.ts
```

**移植步骤**：

1. `mkdir themes/nebula`
2. 写 `manifest.json`（深色基底 + 亮 accent）
3. 在 `engines/fx/` 新增 `particles.ts` 模块
4. 粒子总开关：Settings → `fx.particles.enabled`（默认 true）
5. 性能守卫：FPS < 30 持续 5s → 自动降级关闭

---

### 3.2 多层流体渐变背景

| 字段 | 值 |
|------|-----|
| 参考项目 | [Ansimilo/animated-gradient-backgrounds](https://github.com/Ansimilo/animated-gradient-backgrounds) |
| 移植类型 | 纯 CSS 动画，零图片资源 |

**移植策略**：直接复用 CSS `@keyframes` + `background: linear-gradient()` 动画。

```css
/* 流体渐变：纯 CSS，GPU 友好 */
html.agentskin-host-traework body::before {
  content: '';
  position: fixed;
  inset: -50%;
  background: linear-gradient(
    45deg,
    var(--agentskin-accent),
    var(--agentskin-secondary),
    var(--agentskin-accent)
  );
  background-size: 400% 400%;
  animation: fluid-gradient 15s ease infinite;
  opacity: 0.15;
  z-index: -1;
  pointer-events: none;
}

@keyframes fluid-gradient {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

/* 降级 */
html.agentskin-low-power body::before {
  animation: none;
  opacity: 0.08;
}
```

**移植步骤**：

1. `mkdir themes/fluid-gradient`
2. 写 `manifest.json`
3. 在 agent CSS 追加 `body::before` 伪元素规则
4. 无需额外 JS，纯 CSS 动画

---

### 3.3 柔和全局光晕套件

| 字段 | 值 |
|------|-----|
| 移植类型 | CSS `box-shadow` + `filter: glow()` |

```css
/* 消息卡片外发光 */
html.agentskin-host-traework .chat-bubble {
  box-shadow: 0 0 12px rgba(var(--agentskin-accent-raw), 0.3);
}

/* 按钮发光 */
html.agentskin-host-traework button:focus {
  box-shadow: 0 0 0 3px rgba(var(--agentskin-accent-raw), 0.4),
              0 0 12px rgba(var(--agentskin-accent-raw), 0.2);
}
```

---

## 4. 完整 UI 复写主题（难度 D — 高风险）

### 4.1 Windows XP Luna 复刻

| 字段 | 值 |
|------|-----|
| 参考项目 | [felixrieseberg/clippy](https://github.com/felixrieseberg/clippy)（外壳范式参考） |
| 移植类型 | 按钮/窗口/滚动条视觉复写 |

**移植策略**：**仅 CSS 覆写，不改动 DOM 层级**。

```css
/* XP Luna 按钮：蓝色渐变 + 圆角 3px + 内阴影 */
html.agentskin-host-traework button {
  background: linear-gradient(180deg, #4a90d9 0%, #2c5aa0 100%) !important;
  border: 1px solid #1a3f6f !important;
  border-radius: 3px !important;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.3) !important;
  color: white !important;
  padding: 4px 16px !important;
}

/* XP Luna 标题栏 */
html.agentskin-host-traework .titlebar {
  background: linear-gradient(180deg, #0058e6 0%, #0047b3 50%, #003d99 100%) !important;
}
```

**语义漂移告警**：

```javascript
// 在 engines/drift-detector.ts 中注册
// 当 .titlebar 选择器连续 3 次探测不到 → 触发告警
// 告警方式：notification + Settings → Diagnostics 标记
```

**移植步骤**：

1. `mkdir themes/xp-luna`
2. 写 `manifest.json`（accent: `#2c5aa0` XP 蓝）
3. 在 agent CSS 追加 Luna 风格组件选择器
4. 注册语义漂移探针（每个 agent 的 3-5 个核心选择器）
5. 准备 Luna 风格 `icon.png`（XP 标志或 Luna 球）

**风险**：高。宿主更新后选择器失效概率大，必须配套漂移告警。

---

### 4.2 Minecraft 像素方块主题

| 字段 | 值 |
|------|-----|
| 移植类型 | 像素字体 + 方块按钮 + 像素滚动条 |

```css
/* 像素字体 */
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

html.agentskin-host-traework {
  font-family: 'Press Start 2P', monospace !important;
  font-size: 10px; /* 项目设计系统底线 */
}

/* 像素按钮：直角 + 黑色边框 + 灰色 face */
html.agentskin-host-traework button {
  border: 2px solid #000 !important;
  border-radius: 0 !important;
  background: #c6c6c6 !important;
  box-shadow: inset 2px 2px 0 #fff, inset -2px -2px 0 #555 !important;
}
```

---

## 5. 叠加悬浮装饰主题（难度 E）

### 5.1 可交互深海小猫桌宠

| 字段 | 值 |
|------|-----|
| 参考项目 | [ruguo0119/AI-Desktop-Pet](https://github.com/ruguo0119/AI-Desktop-Pet) |
| 许可证 | MIT |
| 移植类型 | Electron overlay 窗口 + Live2D + 状态机 |

**移植策略**：AgentSkin 已有主窗口 + studioWindow，桌宠作为第三个 `petWindow` 实现。

**架构设计**：

```
主进程
├── mainWindow      (AgentSkin 主界面)
├── studioWindow    (Theme Studio)
└── petWindow       (桌宠 overlay — 新增)
    ├── 透明无边框
    ├── always-on-top
    ├── skip-taskbar
    └── ignore-mouse-events (除拖拽区域外)
```

**状态机对齐**（参考 AI-Desktop-Pet）：

| Agent 状态 | 桌宠动画 |
|-----------|---------|
| Idle | 呼吸摆动 + 自动眨眼 |
| Thinking | 思考气泡 + 眼睛跟随鼠标 |
| Speaking | 说话动画 + 嘴型同步 |
| Waiting | 休眠（趴下） |

**IPC 通信**：

```typescript
// 主进程 → petWindow
mainWindow.webContents.send('agent-state-changed', 'thinking');
// petWindow 接收 → 切换动画
```

**移植步骤**：

1. `mkdir themes/deep-sea-cat`（主题包，含配色）
2. 在 `src/main/` 新增 `pet-window.ts`（BrowserWindow 创建 + 配置）
3. 在 `src/ui/` 新增 `Pet/` 组件目录（React + Live2D canvas）
4. 状态机：`src/shared/pet-state-machine.ts`
5. Settings 面板：桌宠开关 + 位置记忆 + 收起/展开
6. 资源：Live2D 模型文件（.cat 格式，需原创或 CC 许可）

**关键约束**：
- `pointer-events` 必须穿透，不拦截宿主应用点击
- 可一键隐藏（总开关）
- 低配设备自动隐藏

---

### 5.2 悬浮硬件监控小组件

| 字段 | 值 |
|------|-----|
| 移植类型 | Electron overlay + systeminformation.js |

```typescript
// 使用 systeminformation 库读取 CPU/内存
import si from 'systeminformation';

setInterval(async () => {
  const cpu = await si.currentLoad();
  const mem = await si.mem();
  petWindow.webContents.send('hw-update', {
    cpu: cpu.currentLoad.toFixed(1),
    mem: ((mem.used / mem.total) * 100).toFixed(1),
  });
}, 2000);
```

---

## 6. 赛博故障艺术主题（难度 B）

### 6.1 CRT 扫描线故障终端

| 字段 | 值 |
|------|-----|
| 参考项目 | CSS 自建（参考 Shadertoy CRT 效果简化） |
| 移植类型 | CSS 滤镜 + 伪元素动画 |

**核心 CSS**：

```css
/* 扫描线：repeating-linear-gradient 模拟 */
html.agentskin-host-traework body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.15) 0px,
    rgba(0, 0, 0, 0.15) 1px,
    transparent 1px,
    transparent 3px
  );
  animation: crt-scan 8s linear infinite;
}

/* RGB 色差偏移 */
html.agentskin-host-traework body {
  text-shadow:
    0.5px 0 0 rgba(255, 0, 0, 0.3),
    -0.5px 0 0 rgba(0, 255, 255, 0.3);
}

/* 故障动画 */
@keyframes crt-scan {
  0%   { background-position: 0 0; }
  100% { background-position: 0 100%; }
}

/* 总开关 */
html.agentskin-fx-off body::after {
  display: none;
}
html.agentskin-fx-off body {
  text-shadow: none;
}
```

**强度滑块**：

```css
:root {
  --crt-intensity: 1; /* 0-1，0 = 全关 */
}
html.agentskin-host-traework body::after {
  opacity: var(--crt-intensity);
}
```

---

### 6.2 Matrix 数字雨背景

| 字段 | 值 |
|------|-----|
| 移植类型 | Canvas + CSS overlay |

```javascript
// engines/fx/matrix-rain.ts
// 轻量实现：Canvas 绘制绿色字符下落
// 字符集：01 + 片假名 + 英文字母
// 帧率限制：30fps，低配自动关闭
```

---

## 7. IP-游戏向主题（难度 D）

### 7.1 科技终端风格（终末地视觉参考）

| 字段 | 值 |
|------|-----|
| 参考项目 | [Phunzage/endfield-blog-ui](https://github.com/Phunzage/endfield-blog-ui)（视觉风格参考） |
| 移植类型 | 科技终端气泡 + 等宽字体 + 霓虹色条 |

**设计语言**（不直接复制 IP，仅借鉴"科技终端"风格）：

```css
/* 终端气泡：等宽字体 + 细线边框 + 微发光 */
html.agentskin-host-traework .chat-bubble {
  font-family: 'IBM Plex Mono', 'Courier New', monospace !important;
  border: 1px solid rgba(var(--agentskin-accent-raw), 0.3) !important;
  background: rgba(var(--agentskin-surface-raw), 0.8) !important;
  box-shadow: 0 0 8px rgba(var(--agentskin-accent-raw), 0.15) !important;
}

/* 状态栏用量监视（装饰性） */
html.agentskin-host-traework .token-counter {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  color: var(--agentskin-muted);
  border-top: 1px solid rgba(var(--agentskin-accent-raw), 0.15);
  padding: 4px 8px;
}
```

**⚠️ 版权注意**：不使用终末地/绝区零的 IP 形象、logo、角色。仅借鉴"科技终端"通用视觉语言。

---

## 8. 极简办公主题（难度 A）

### 8.1 深度专注模式

| 字段 | 值 |
|------|-----|
| 参考项目 | [arcticicestudio/nord](https://github.com/arcticicestudio/nord) |
| 许可证 | MIT |
| 移植类型 | 配色 + 关闭动画 + 弱化装饰 |

**色板**（Nord）：

| agentskin token | 值 |
|-----------------|-----|
| accent | `#88c0d0` |
| secondary | `#81a1c1` |
| bg | `#2e3440` |
| surface | `#3b4252` |
| surface-elevated | `#434c5e` |
| text | `#eceff4` |
| muted | `#7b88a1` |
| border | `rgba(136,192,208,0.18)` |
| code-bg | `#2e3440` |
| code-fg | `#d8dee9` |
| input-bg | `#3b4252` |
| button-bg | `rgba(136,192,208,0.2)` |
| focus-ring | `#88c0d060` |
| selection | `rgba(136,192,208,0.32)` |

**关闭动画 CSS**：

```css
/* 深度专注：禁用全部 CSS 动画，保留 JS 交互 */
html.agentskin-focus-mode *,
html.agentskin-focus-mode *::before,
html.agentskin-focus-mode *::after {
  animation: none !important;
  transition: none !important;
}

/* 弱化边角装饰 */
html.agentskin-focus-mode * {
  border-radius: 0 !important;
  box-shadow: none !important;
}
```

---

### 8.2 低饱和商务极简

| 字段 | 值 |
|------|-----|
| 移植类型 | 低饱和灰调 + 无装饰 |

| agentskin token | 值 |
|-----------------|-----|
| accent | `#5b7b9a` |
| secondary | `#8a9baa` |
| bg | `#1e2329` |
| surface | `#282e36` |
| surface-elevated | `#323a44` |
| text | `#d4d9df` |
| muted | `#6b7785` |
| border | `rgba(91,123,154,0.15)` |
| code-bg | `#1a1f25` |
| code-fg | `#c8d0d8` |
| input-bg | `#282e36` |
| button-bg | `rgba(91,123,154,0.18)` |
| focus-ring | `#5b7b9a60` |
| selection | `rgba(91,123,154,0.32)` |

---

## 9. 移植优先级与路线图

### Phase 1（第 1-2 周）— 纯配色，快速铺量

| 优先级 | 主题 | 难度 | 预估工时 |
|--------|------|------|---------|
| P0 | Tokyo Night | A | 2h |
| P0 | Catppuccin | A | 2h |
| P0 | Dracula | A | 1h |
| P1 | Nord（深度专注） | A | 1.5h |
| P1 | 低饱和商务极简 | A | 1h |

**交付**：5 套完整主题，每套 6 agent CSS + 校验全绿。

### Phase 2（第 3-4 周）— 特效 + 赛博

| 优先级 | 主题 | 难度 | 预估工时 |
|--------|------|------|---------|
| P1 | 流体渐变背景 | B | 3h |
| P1 | CRT 扫描线故障 | B | 4h |
| P2 | 柔和光晕套件 | B | 2h |
| P2 | Matrix 数字雨 | B | 4h |

### Phase 3（第 5-6 周）— 壁纸 + 滤镜

| 优先级 | 主题 | 难度 | 预估工时 |
|--------|------|------|---------|
| P2 | 液态磨砂玻璃 | C | 6h |
| P2 | 静谧星空 | C | 3h |

### Phase 4（第 7-10 周）— 结构依赖 + 独立 overlay

| 优先级 | 主题 | 难度 | 预估工时 |
|--------|------|------|---------|
| P3 | XP Luna 复刻 | D | 8h |
| P3 | Minecraft 像素 | D | 6h |
| P3 | 深海小猫桌宠 | E | 16h |
| P3 | 科技终端风格 | D | 4h |

---

## 10. 移植质量检查清单

每个主题交付前必须通过：

- [ ] `npm run check:themes` 全绿
- [ ] 6 个 agent 各跑 30 分钟无崩溃
- [ ] 语义漂移告警注册（D/E 级必做）
- [ ] 降级开关有效（B/C/E 级必做）
- [ ] WCAG AA 对比度校验（accent/text 组合）
- [ ] 内存泄漏检查（特效类：连续 1h 内存增量 < 50MB）
- [ ] 低配模式验证（关闭全部特效后仍可用）
- [ ] 主题包导入/导出正常（`.agentskin-theme` 格式）

---

## 附录 A：Token 映射速查表

| 参考项目色板名 | agentskin token | 用途 |
|---------------|-----------------|------|
| primary / brand | accent | 主强调色 |
| secondary / accent2 | secondary | 次强调色 |
| background / base | bg | 全局背景 |
| surface / card | surface | 卡片/面板表面 |
| surface-variant | surface-elevated | 提升表面 |
| text / foreground | text | 主文本 |
| text-muted / comment | muted | 次要文本 |
| border / divider | border | 边框 |
| code-background | code-bg | 代码块背景 |
| code-foreground | code-fg | 代码块前景 |
| input-background | input-bg | 输入框背景 |
| button-background | button-bg | 按钮底色 |
| focus / ring | focus-ring | 焦点环 |
| selection | selection | 文本选区 |

## 附录 B：参考项目许可证速查

| 项目 | 许可证 | 商用友好 |
|------|--------|---------|
| tokyo-night-vscode-theme | MIT | ✅ |
| catppuccin | MIT | ✅ |
| dracula | MIT | ✅ |
| nord | MIT | ✅ |
| tsparticles | MIT | ✅ |
| AI-Desktop-Pet | MIT | ✅ |
| BongoCat | MIT | ✅ |
| VPet | MIT | ✅ |
| wallpaper-engine-kde-plugin | GPL-2.0 | ⚠️ 仅参考思路，不直接复用代码 |
