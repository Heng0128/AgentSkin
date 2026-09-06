# ASAR 静态分析报告 — 豆包 Doubao (doubao Agent)

> **分析日期**: 2026-08-30
> **目标应用**: 豆包 Doubao Desktop
> **Agent ID**: doubao
> **安装路径**: `C:\Users\snowb\AppData\Local\Doubao`
> **架构类型**: Chromium 封装（非 Electron，无 ASAR 包）

---

## 1. 文件拓扑

### 1.1 目录树概览

```
C:\Users\snowb\AppData\Local\Doubao\
├── Application\
│   ├── Doubao.exe                    ← 主进程入口
│   ├── uninstall.exe                 ← 卸载程序
│   └── app\
│       ├── Doubao.exe                ← 应用启动器副本
│       ├── Doubao.dll                ← 核心动态库
│       ├── Doubao_elf.dll            ← ELF 兼容层
│       ├── Doubao_wer.dll            ← Windows 错误报告
│       ├── Doubao_browser_proxy.exe  ← 浏览器代理进程
│       ├── Doubao_proxy.exe          ← 代理服务进程
│       ├── ghelper.exe               ← Google 帮助服务
│       ├── push_detect.exe           ← 推送检测服务
│       ├── repair.exe                ← 修复工具
│       ├── update.exe                ← 更新程序
│       ├── ffmpeg.dll                ← 音视频处理
│       ├── libEGL.dll / libGLESv2.dll ← OpenGL ES 渲染
│       ├── vulkan-1.dll / vk_swiftshader.dll ← Vulkan 渲染
│       ├── dxcompiler.dll / d3dcompiler_47.dll ← DirectX 编译
│       ├── sscronet.dll              ← 字节跳动网络库
│       ├── pc_push.dll               ← 推送服务库
│       ├── shellext.dll / shellextcore.dll ← Shell 扩展
│       ├── simplelog.dll             ← 日志库
│       ├── voixcap.dll               ← 音频捕获
│       ├── aha_net.dll               ← AHA 网络诊断
│       ├── logifier_retrieval.dll    ← 日志检索
│       ├── metasecml.dll             ← 安全检测
│       ├── doctor_sdk.dll            ← 诊断 SDK
│       ├── VolcEngineRTCAudio.dll    ← 火山引擎 RTC 音频
│       ├── Microsoft.WindowsAppRuntime.Bootstrap.dll
│       ├── vcruntime140.dll / msvcp140.dll ← VC++ 运行时
│       ├── resources.pak             ← Chrome 资源包
│       ├── doubao_100_percent.pak    ← 豆包 100% DPI 资源
│       ├── doubao_200_percent.pak    ← 豆包 200% DPI 资源
│       ├── locales\                  ← 国际化文件 (56 个 .pak)
│       │   ├── zh-CN.pak / zh-TW.pak / en-US.pak ...
│       │   └── af.pak, am.pak, ar.pak, ... (52 种语言)
│       ├── launcher\
│       │   ├── Doubao.exe            ← 启动器
│       │   └── uninstall.exe
│       ├── aha_doctor\               ← AHA 诊断工具
│       │   ├── aha_doctor.exe
│       │   ├── task_host.exe
│       │   ├── xperf.exe
│       │   ├── applogrs.dll / perfctrl.dll
│       └── local_webcontents\        ← ★ 可分析源码目录
│           └── extensions\
│               └── ai-views\         ← 豆包 AI 视图扩展
│                   ├── manifest.json
│                   ├── options.html / popup.html / side_panel.html
│                   ├── static\
│                   │   ├── css\      ← 543 个 CSS 文件
│                   │   ├── js\       ← 1001 个 JS 文件
│                   │   ├── svg\      ← 图标资源
│                   │   └── assets\   ← Worker 脚本
│                   ├── _locales\     ← 扩展国际化
│                   ├── configs\      ← 配置文件
│                   └── assets\       ← 图标资源
└── User Data\                        ← 用户数据目录
    ├── Default\                     ← 默认 Profile
    │   ├── Extensions\              ← 用户扩展 (Dark Reader 等)
    │   └── sandbox_envs_dir\        ← 沙箱环境 (Python/Node)
    ├── Profile 1\                   ← 第二 Profile
    ├── Doctor\                      ← 诊断工具数据
    ├── Doctor_Update\               ← 诊断更新
    └── sandbox_runtime\              ← 沙箱运行时
        └── bases\                   ← Python 3.13 + Node.js 完整环境
```

### 1.2 关键文件说明

| 文件 | 用途 | 分析价值 |
|------|------|----------|
| `Doubao.exe` | 主进程入口（C++ 编译） | 二进制，不可直接分析 |
| `Doubao.dll` | 核心功能动态库 | 二进制，可能包含 CDP 调试接口 |
| `local_webcontents/extensions/ai-views/` | AI 视图扩展（Manifest V3） | ★ 主要分析目标 |
| `resources.pak` | Chrome 资源包 | 可解包获取字符串/图片 |
| `doubao_100_percent.pak` | 豆包 UI 资源 | 可解包获取 UI 字符串 |
| `sscronet.dll` | 字节跳动网络库 | 可能包含自定义协议处理 |
| `sandbox_runtime/bases/` | Python 3.13 + Node.js | 沙箱执行环境 |

---

## 2. 可访问源码分析

### 2.1 扩展 Manifest (manifest.json)

```json
{
  "manifest_version": 3,
  "name": "__MSG_name__",
  "version": "1.0.0.4482",
  "default_locale": "zh_CN",
  "background": {
    "service_worker": "static/js/background.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "side_panel.html"
  },
  "permissions": [
    "storage", "cookies", "tabs", "webRequest",
    "sidePanel", "scripting", "contextMenus",
    "declarativeNetRequest", "webNavigation", "bookmarks"
  ],
  "externally_connectable": {
    "matches": [
      "https://*.doubao.com/*",
      "https://*.cici.com/*",
      "https://*.ciciai.com/*",
      "https://*.dola.com/*",
      "https://*.larkoffice.com/*",
      "https://*.feishu.cn/*"
    ]
  }
}
```

**关键发现**:
- Manifest V3 扩展架构
- 版本号: `1.0.0.4482`（与 JS 中的 `scmVersion` 一致）
- 使用 Service Worker 作为 background
- 支持 side_panel（侧边栏）
- 外部连接白名单包含 doubao.com、cici.com、feishu.cn 等字节系域名

### 2.2 HTML 入口文件

#### popup.html
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <script defer="defer" src="/static/js/popup.js" nonce="argus-csp-token"></script>
</head>
<body>
  <div id="root"><!--<?- html ?>--></div>
</body>
</html>
```

#### side_panel.html
```html
<!DOCTYPE html>
<html>
<head>
  <script defer="defer" src="/static/js/sidepanel_pre_run.js" nonce="argus-csp-token"></script>
  <title>Side Panel</title>
  <!-- 多个 JS/CSS chunk -->
  <script defer="defer" src="/static/js/side_panel.js" nonce="argus-csp-token"></script>
</head>
<body>
  <div id="root"><!--<?- html ?>--></div>
  <div id="sidepanel_skeleton" class="skeleton-container">
    <!-- 骨架屏内容 -->
  </div>
</body>
</html>
```

#### options.html
```html
<!DOCTYPE html>
<html>
<head>
  <title>豆包设置</title>
  <!-- 多个 JS/CSS chunk -->
  <script defer="defer" src="/static/js/options.js" nonce="argus-csp-token"></script>
</head>
<body>
  <div id="root"><!--<?- html ?>--></div>
</body>
</html>
```

**关键发现**:
- 使用 CSP nonce: `argus-csp-token`
- 服务端渲染（SSR）占位符: `<!--<?- html ?>-->`
- 骨架屏（Skeleton）预渲染
- 使用 rspack 打包（`bundler=rspack@1.2.8`）

### 2.3 JS 架构分析

#### 打包工具信息
- **Bundler**: rspack v1.2.8
- **Webpack Chunk 格式**: `self.webpackChunkflow_web_extension`
- **代码分割**: 大量 async chunk（1001 个 JS 文件）

#### 核心模块识别

| 模块 | 文件 | 功能 |
|------|------|------|
| 背景脚本 | `background.js` | Service Worker 后台 |
| 内容脚本 | `content.js` | 页面注入脚本 |
| 预注入 | `preinject.js` | document_start 注入 |
| 侧边栏预运行 | `sidepanel_pre_run.js` | 浏览器类型检测 |
| 注入脚本 | `inject.js` | YouTube 字幕拦截 |
| 主应用 | `side_panel.js` / `popup.js` / `options.js` | UI 主入口 |

#### 关键 JS 代码片段

**sidepanel_pre_run.js** — 浏览器类型检测:
```javascript
function getBrowserType() {
  if (window?.neotix) return "desktop";
  if (/\bEdge\//i.test(navigator.userAgent)) return "edge";
  if (/\bSafari\//i.test(navigator.userAgent) && !/\bChrome\//i.test(navigator.userAgent)) return "safari";
  if (/\bChrome\//i.test(navigator.userAgent)) return "chrome";
  return "unknown";
}
```

**inject.js** — YouTube 字幕拦截:
```javascript
// 拦截 YouTube /api/timedtext 请求
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (url.includes('/api/timedtext')) {
    // 解析并缓存字幕数据
  }
  return response;
};
```

**54525.js** — 应用标识:
```javascript
const APP_NAME = "Doubao";
const APP_CN = "豆包";
const DOMAIN = "doubao.com";
const CDN_URL = "https://lf-flow-web-cdn.doubao.com/obj/flow-doubao";
```

**88707.js** — 平台检测:
```javascript
// 检测 Chromium 版本
const match = userAgent.match(/Chrom(?:e|ium)\/([0-9]+)\.([0-9]+)\.([0-9]+)\/([0-9]+)/);
// 检测 SamanthaDoubao / SamanthaCici 自定义 UA
```

### 2.4 原生 API 接口 (neotix)

豆包暴露了 `window.neotix` 对象用于扩展与原生交互:

```javascript
// 弹窗视图
neotix.popupView.popupWebView(options);

// 云配置
neotix.cloudConfig.get({ biz: "ask-doubao-align" });

// AI 视图信息
neotix.aiView.getCurrentAIViewInfo({});

// 日志写入
neotix.log.writeLog({ level, message, module, source });

// 频道通信
neotix.neotixChannel.on("common_popup_webview", callback);
```

---

## 3. 二进制文件清单

### 3.1 主进程可执行文件

| 文件 | 大小估计 | 功能 |
|------|----------|------|
| `Doubao.exe` | ~100MB+ | 主进程入口 |
| `Doubao_browser_proxy.exe` | ~50MB+ | 浏览器代理 |
| `Doubao_proxy.exe` | ~50MB+ | 代理服务 |
| `ghelper.exe` | ~10MB+ | Google 辅助服务 |
| `push_detect.exe` | ~10MB+ | 推送检测 |
| `repair.exe` | ~20MB+ | 修复工具 |
| `update.exe` | ~20MB+ | 更新程序 |
| `aha_doctor.exe` | ~15MB+ | 诊断工具 |
| `task_host.exe` | ~10MB+ | 任务宿主 |
| `xperf.exe` | ~10MB+ | 性能分析 |

### 3.2 核心动态库

| 文件 | 功能 |
|------|------|
| `Doubao.dll` | 核心功能库（可能包含 CDP 调试接口） |
| `Doubao_elf.dll` | ELF 兼容层 |
| `Doubao_wer.dll` | Windows 错误报告 |
| `sscronet.dll` | 字节跳动网络库（Cronet） |
| `pc_push.dll` | 推送服务 |
| `shellext.dll` / `shellextcore.dll` | Windows Shell 扩展 |
| `metasecml.dll` | 安全检测模块 |
| `doctor_sdk.dll` | 诊断 SDK |
| `VolcEngineRTCAudio.dll` | 火山引擎 RTC 音频 |

### 3.3 多媒体/图形库

| 文件 | 功能 |
|------|------|
| `ffmpeg.dll` | 音视频编解码 |
| `libEGL.dll` / `libGLESv2.dll` | OpenGL ES 渲染 |
| `vulkan-1.dll` / `vk_swiftshader.dll` | Vulkan 渲染 |
| `dxcompiler.dll` / `d3dcompiler_47.dll` | DirectX 着色器编译 |
| `voixcap.dll` | 音频捕获 |

### 3.4 沙箱运行时

```
User Data\sandbox_runtime\bases\9f6d27f23933fb44a3a1c728c88a5ce4\
├── python\                    ← Python 3.13 完整环境
│   ├── python.exe / pythonw.exe
│   ├── python3.dll / python313.dll
│   └── Lib\                  ← 标准库 + pip 包
├── node\                      ← Node.js 环境
│   └── node.exe
└── rg.exe                     ← ripgrep 搜索工具
```

---

## 4. CSS Token 清单

### 4.1 Semi Design 变量系统

豆包使用 **Semi Design** 组件库，定义了完整的 CSS 变量系统。

#### 基础颜色变量 (77473.css)

```css
.semi-always-dark, body {
  /* 基础色板 */
  --semi-black: 0,0,0;
  --semi-white: 255,255,255;
  
  /* 红色系 (0-9 阶) */
  --semi-red-0: 108,9,11;
  --semi-red-1: 144,17,16;
  --semi-red-2: 180,32,25;
  --semi-red-3: 215,51,36;
  --semi-red-4: 251,73,50;
  --semi-red-5: 252,114,90;
  --semi-red-6: 253,153,131;
  --semi-red-7: 253,190,172;
  --semi-red-8: 254,224,213;
  --semi-red-9: 255,243,239;
  
  /* 蓝色系 */
  --semi-blue-0: 5,49,112;
  --semi-blue-1: 10,70,148;
  --semi-blue-2: 19,92,184;
  --semi-blue-3: 29,117,219;
  --semi-blue-4: 41,144,255;
  --semi-blue-5: 84,169,255;
  --semi-blue-6: 127,193,255;
  --semi-blue-7: 169,215,255;
  --semi-blue-8: 212,236,255;
  --semi-blue-9: 239,248,255;
  
  /* 其他色板: cyan, grey, lime, pink, teal, amber, brand, green, 
     indigo, orange, purple, violet, yellow, light-blue, light-green */
  
  /* 背景色 */
  --semi-color-bg-0: #16161a;
  --semi-color-bg-1: #232429;
  --semi-color-bg-2: #35363c;
  --semi-color-bg-3: #43444a;
  --semi-color-bg-4: #4f5159;
  
  /* 填充色 */
  --semi-color-fill-0: rgba(var(--semi-white),0.05);
  --semi-color-fill-1: rgba(var(--semi-white),0.09);
  --semi-color-fill-2: rgba(var(--semi-white),0.13);
  
  /* 文本色 */
  --semi-color-text-0: rgba(var(--semi-white),0.95);
  --semi-color-text-1: rgba(var(--semi-white),0.82);
  --semi-color-text-2: rgba(var(--semi-white),0.62);
  --semi-color-text-3: rgba(var(--semi-white),0.35);
  
  /* 功能色 */
  --semi-color-info: rgba(var(--semi-blue-5),1);
  --semi-color-link: rgba(var(--semi-blue-5),1);
  --semi-color-primary: rgba(var(--semi-blue-5),1);
  --semi-color-success: rgba(var(--semi-green-5),1);
  --semi-color-warning: rgba(var(--semi-amber-5),1);
  --semi-color-danger: rgba(var(--semi-red-5),1);
}
```

### 4.2 豆包自定义变量 (s-前缀)

```css
/* 背景色 */
--s-color-bg-body: #fff;                    /* 页面背景 */
--s-color-bg-content-base: #f9fafb;         /* 内容区背景 */
--s-color-bg-float: #fff;                   /* 浮层背景 */
--s-color-bg-mask: rgba(0,0,0,.3);          /* 遮罩背景 */
--s-color-bg-trans: rgba(0,0,0,.04);        /* 透明背景 */
--s-color-bg-trans-primary: rgba(0,0,0,.06);
--s-color-bg-trans-tertiary: rgba(0,0,0,.15);
--s-color-bg-intact-primary: #fff;

/* 文本色 */
--s-color-text-primary: #000;               /* 主要文本 */
--s-color-text-secondary: rgba(0,0,0,.8);   /* 次要文本 */
--s-color-text-tertiary: rgba(0,0,0,.55);   /* 辅助文本 */
--s-color-text-quaternary: rgba(0,0,0,.3);  /* 占位文本 */
--s-color-text-disable: rgba(0,0,0,.15);    /* 禁用文本 */
--s-color-text-invert-primary: #fff;        /* 反色文本 */
--s-color-text-static-white-primary: #fff;  /* 固定白色文本 */

/* 边框色 */
--s-color-border-primary: rgba(0,0,0,.2);   /* 主要边框 */
--s-color-border-secondary: rgba(0,0,0,.12); /* 次要边框 */
--s-color-border-tertiary: rgba(0,0,0,.08); /* 辅助边框 */

/* 品牌色 */
--s-color-brand-primary-default: #0057ff;   /* 品牌主色 */

/* 字体 */
--s-font-xs: ...;
--s-font-small-strong: ...;
--s-font-xxs-em: ...;

/* 圆角 */
--s-radius-xxSS: 8px;
--s-radius-xs: 10px;
--s-radius-s: 12px;
--s-radius-m: 16px;
--s-radius-L: 20px;
```

### 4.3 其他 CSS 变量

```css
/* 链接色 */
--color-link-text: ...;
--color-link-text-hover: ...;
--color-link-text-active: ...;

/* 中性色 */
--color-neutral-100: ...;
--color-primary-50: ...;
--primary-transparent-1: ...;
--primary-transparent-2: ...;

/* 聊天输入 */
--chat-input-skill-border-radius: ...;
--chat-input-skill-font-size: ...;

/* 滚动条 */
--custom-scrollbar-width: 7px;
--scrollbar-color-hover: ...;
--scrollbar-color-active: ...;
--dbx-static-black-15: ...;
--dbx-static-black-30: ...;
--dbx-static-black-55: ...;

/* 画布 */
--canvas-radius-size: 0;
--canvas-footer-padding: 12px 24px 24px;
--header-height: 56px;
--right-rect-height: 100px;
--right-rect-left: 0px;
--right-rect-width: 100px;
--right-rect-top: 0;
--leaving-rect-width: ...;
--sash-pct: ...;
```

### 4.4 Dark Mode 支持

```css
@media (prefers-color-scheme: dark) {
  body, html { background: #333; }
  body.cici-browser-chrome { background: #282828; }
  /* 骨架屏深色适配 */
  #sidepanel_skeleton .skeleton-circle-btn,
  #sidepanel_skeleton .skeleton-rect {
    background: linear-gradient(90deg, hsla(0,0%,100%,.16), hsla(0,0%,100%,.16));
  }
}
```

---

## 5. 架构摘要

### 5.1 Chromium 版本与特征

| 特征 | 值 |
|------|-----|
| 基础引擎 | Chromium (Blink) |
| 扩展架构 | Manifest V3 |
| 打包工具 | rspack 1.2.8 |
| 组件库 | Semi Design |
| 版本号 | 1.0.0.4482 |
| 构建分支 | release_train_samantha_2026-04-24_1143243928578 |
| 构建插件版本 | 3.4.3 |

**Chromium 版本推断**:
- 从 `userAgent.match(/Chrom(?:e|ium)\/([0-9]+)/)` 检测逻辑推断
- 支持 `prefers-color-scheme`（Chrome 76+）
- 支持 `backdrop-filter`（Chrome 76+）
- 支持 CSS `@property`（Chrome 85+）
- 估计 Chromium 版本: **120+**（2024+）

### 5.2 注入机制

豆包的注入架构分为三层:

```
┌─────────────────────────────────────────────────────────────┐
│                    Doubao.exe (C++)                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Chromium Embedded Framework               │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │         local_webcontents/extensions/ai-views/   │  │  │
│  │  │  ┌─────────────┐  ┌──────────┐  ┌───────────┐  │  │  │
│  │  │  │ Service     │  │ Content  │  │ Side      │  │  │  │
│  │  │  │ Worker      │  │ Script   │  │ Panel     │  │  │  │
│  │  │  │ (bg.js)     │  │ (ct.js)  │  │ (sp.html) │  │  │  │
│  │  │  └─────────────┘  └──────────┘  └───────────┘  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              neotix Native API                         │  │
│  │  - popupView.popupWebView()                           │  │
│  │  - cloudConfig.get()                                  │  │
│  │  - aiView.getCurrentAIViewInfo()                      │  │
│  │  - log.writeLog()                                     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 安全机制

| 机制 | 实现 | 影响 |
|------|------|------|
| CSP | `nonce="argus-csp-token"` | 限制内联脚本执行 |
| Manifest V3 | Service Worker 替代 background page | 无法持久化后台页面 |
| 外部连接白名单 | `externally_connectable.matches` | 仅允许字节系域名通信 |
| 沙箱运行时 | `sandbox_envs_dir` + `sandbox_runtime` | 隔离执行 Python/Node |
| 安全检测 | `metasecml.dll` | 运行时安全扫描 |
| 代码签名 | 所有 exe/dll 签名 | 防止二进制篡改 |

---

## 6. CDP 注入可行性评估

### 6.1 可行性分析

| 评估项 | 状态 | 说明 |
|--------|------|------|
| CDP 端口 | ✅ 可用 | `Doubao.exe --remote-debugging-port=9222` |
| WebSocket 调试 | ✅ 支持 | Chromium 标准 CDP 协议 |
| 页面 Target | ✅ 可枚举 | 主窗口 + 扩展页面 |
| 注入点 | ⚠️ 受限 | Manifest V3 限制内容脚本注入 |
| 持久化 | ⚠️ 受限 | Service Worker 无持久化 DOM |

### 6.2 注入方案

#### 方案 A: 命令行启动（推荐）
```powershell
# 启动豆包并开启 CDP 调试
Start-Process "C:\Users\snowb\AppData\Local\Doubao\Application\Doubao.exe" `
  -ArgumentList "--remote-debugging-port=9222"

# 获取 WebSocket URL
Invoke-RestMethod "http://localhost:9222/json/version"

# 枚举所有 Target
Invoke-RestMethod "http://localhost:9222/json/list"
```

#### 方案 B: 快捷方式修改
```
目标: "C:\Users\snowb\AppData\Local\Doubao\Application\Doubao.exe" --remote-debugging-port=9222
```

#### 方案 C: 运行时附加（需重启）
```powershell
# 关闭现有进程
Stop-Process -Name "Doubao" -Force

# 带调试端口重启
& "C:\Users\snowb\AppData\Local\Doubao\Application\Doubao.exe" --remote-debugging-port=9222
```

### 6.3 注入目标识别

```javascript
// CDP 注入脚本示例
const targets = await fetch('http://localhost:9222/json/list').then(r => r.json());

// 查找主聊天窗口
const mainTarget = targets.find(t => 
  t.url.includes('doubao-chat/chat') || 
  t.url.includes('doubao') ||
  t.title.includes('豆包')
);

// 查找扩展页面
const extensionTarget = targets.find(t => 
  t.url.startsWith('chrome-extension://')
);
```

### 6.4 注入难度评估

| 维度 | 难度 | 说明 |
|------|------|------|
| CDP 连接 | ⭐ 低 | 标准 Chromium 协议 |
| 页面识别 | ⭐⭐ 中 | 需要解析 Target URL |
| CSS 注入 | ⭐⭐ 中 | 可通过 `CSS.insertRule` 或 `adoptedStyleSheets` |
| JS 注入 | ⭐⭐⭐ 高 | Manifest V3 限制 `scripting.executeScript` |
| 持久化 | ⭐⭐⭐ 高 | Service Worker 无持久化上下文 |
| 原生 API | ⭐⭐⭐⭐ 极高 | `neotix` 对象需特殊权限 |

---

## 7. 与现有引擎的匹配度评估

### 7.1 现有适配器代码分析

```typescript
// src/adapters/domestic/doubao.ts
export class DoubaoAdapter extends BaseApplicationAdapter {
  readonly id = 'doubao';
  readonly name = AGENT_META.doubao.displayName;
  readonly type = 'desktop' as const;
  readonly tier = 'active' as const;
  readonly coreId = 'doubao';

  override readonly installHints: InstallHints = {
    dirNames: ['Doubao'],
    exeNames: ['Doubao.exe'],
    registryNames: ['Doubao', '豆包'],
  };

  override readonly windowHints = [
    { role: WindowRole.Main, patterns: ['doubao-chat/chat', 'doubao', '豆包'] },
    { role: WindowRole.Popup, patterns: ['*/mini*', '*/popout*', 'mini', 'popout'] },
    { role: WindowRole.Secondary, patterns: ['*/background*', '*/service-worker*'] },
  ];
}
```

### 7.2 匹配度评估

| 评估项 | 匹配度 | 说明 |
|--------|--------|------|
| Agent ID | ✅ 100% | `doubao` 一致 |
| 安装检测 | ✅ 100% | `Doubao.exe` + `Doubao` 目录 |
| 窗口匹配 | ⚠️ 70% | 需验证 `doubao-chat/chat` URL 模式 |
| 注入机制 | ⚠️ 50% | 现有引擎假设 Electron，实际为 Chromium 封装 |
| CSS 变量 | ✅ 80% | Semi Design 变量可映射到 14-token 系统 |
| IPC 通信 | ❌ 0% | 无 Electron IPC，使用 `neotix` API |

### 7.3 需要调整的部分

1. **架构假设修正**:
   - 现有引擎假设 Electron 架构（`ipcRenderer`、`ipcMain`）
   - 实际为 Chromium 封装，需使用 CDP 注入
   - 需移除 `contextIsolation`、`sandbox` 等 Electron 特有检查

2. **注入方式调整**:
   - Electron: 通过 preload 脚本注入
   - 豆包: 通过 CDP `Runtime.evaluate` 或 `scripting.executeScript`

3. **窗口识别增强**:
   - 需通过 CDP Target 识别主窗口
   - URL 模式可能为 `chrome://doubao-chat/chat` 或自定义协议

4. **CSS 变量桥接**:
   - Semi Design 变量 (`--s-color-*`, `--semi-color-*`) 可映射到 AgentSkin 14-token 系统
   - 需创建变量映射表

### 7.4 推荐注入策略

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentSkin 注入管线                        │
├─────────────────────────────────────────────────────────────┤
│  1. CDP 连接 (localhost:9222)                               │
│     ↓                                                       │
│  2. Target 枚举 → 识别主聊天窗口                             │
│     ↓                                                       │
│  3. Runtime.evaluate → 注入 CSS 变量定义                     │
│     ↓                                                       │
│  4. CSS.adoptedStyleSheets → 注入主题样式                    │
│     ↓                                                       │
│  5. 监听 DOM 变化 → 动态应用样式                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. 总结

### 8.1 关键发现

1. **非 Electron 架构**: 豆包是 Chromium 封装应用，非 Electron，无 ASAR 包
2. **Manifest V3 扩展**: 使用 Service Worker + Content Script 架构
3. **Semi Design**: 使用字节跳动 Semi Design 组件库
4. **neotix API**: 暴露 `window.neotix` 用于扩展与原生交互
5. **沙箱运行时**: 内置 Python 3.13 + Node.js 完整环境
6. **CDP 可用**: 支持 `--remote-debugging-port=9222` 调试

### 8.2 注入可行性

| 维度 | 评估 |
|------|------|
| 技术可行性 | ✅ 高（CDP 标准协议） |
| 实现复杂度 | ⭐⭐⭐ 中高（需适配 Chromium 封装） |
| 持久化难度 | ⭐⭐⭐ 高（Manifest V3 限制） |
| 维护成本 | ⭐⭐ 中（CSS 变量映射需维护） |

### 8.3 建议

1. **短期**: 使用 CDP + `Runtime.evaluate` 注入 CSS 变量
2. **中期**: 开发 Semi Design → AgentSkin 14-token 自动映射
3. **长期**: 探索 `neotix` API 深度集成，实现原生级主题定制

---

## 附录 A: 文件统计

| 类型 | 数量 | 总大小估计 |
|------|------|------------|
| EXE | 67 | ~1.5 GB |
| DLL | 65 | ~500 MB |
| PAK | 58 | ~200 MB |
| CSS | 543 | ~10 MB |
| JS | 1001 | ~50 MB |
| HTML | 3 | ~10 KB |
| SVG | 42 | ~500 KB |

## 附录 B: 参考资源

- 豆包官网: https://www.doubao.com
- Semi Design: https://semi.design
- Chromium CDP: https://chromedevtools.github.io/devtools-protocol/
- Manifest V3: https://developer.chrome.com/docs/extensions/mv3/
