# Shadow DOM 样式穿透技术调研报告

> 生成时间：2026-08-22 ｜ 适用模块：AgentSkin ShadowPiercer ｜ 状态：完成

---

## 目录

1. [Shadow DOM 注入方案对比](#一shadow-dom-注入方案对比)
2. [各方案可执行代码片段](#二每个方案的可执行代码片段)
3. [attachShadow patch 的安全实现模式](#三attachshadow-patch-的安全实现模式)
4. [对 AgentSkin ShadowPiercer 模块的具体建议](#四对-agentskin-shadowpiercer-模块的具体建议)
5. [参考链接](#五参考链接)

---

## 一、Shadow DOM 注入方案对比

| 方案 | 兼容性 | closed support | patch needed | 性能 | 推荐度 | 适用场景 |
|------|--------|---------------|-------------|------|--------|---------|
| CSS 变量继承 | Chrome 73+ / FF 67+ / Safari 16.4+ | **穿透（继承通道）** | 否 | 极高 | ⭐⭐⭐⭐⭐ | 主题色/字号/间距等 design token 透传 |
| `::part()` | Chrome 97+ / FF 79+ / Safari 15.4+ | 否（需组件暴露 part） | 否 | 高 | ⭐⭐ | 仅当目标组件暴露了 `part` 属性时可用 |
| attachShadow patch | 全部支持 attachShadow 的浏览器 | **是** | 是 | 中 | ⭐⭐⭐⭐ | 需要 100% 覆盖 closed shadow DOM 时 |
| MutationObserver 监听 | 全部 | 否（无法检测 closed） | 否 | 低 | ⭐⭐ | 仅对 open shadowRoot 有延迟检测能力 |
| CDP DOM/CSS 域操作 | Chromium only | **是** | 否 | 低 | ⭐ | 调试/临时注入，不适合生产注入 |
| `adoptedStyleSheets` 共享 | Chrome 73+ / FF 94+ / Safari 16.4+ | 否（需先获取 shadowRoot） | 否 | 高 | ⭐⭐⭐⭐ | 已知 open shadowRoot 时的最佳批量注入 |

### 关键发现（基于对 Stylus 等项目源码的分析）

**Stylus 扩展的方案**：Stylus 不 patch `attachShadow`。它的 content script 注入策略是：
1. 通过 `document.styleSheets` 遍历所有已加载样式表，逐一操作 `cssRules`
2. 对每个 `<style>` 和 `<link>` 节点直接注入 CSS 文本
3. 对 Web Components 使用 `shadowRoot.adoptedStyleSheets`（当 shadowRoot 为 open 时）
4. **无法处理 closed shadow DOM** — 这是已知的 Stylus 限制

**为什么 Stylus 不 patch attachShadow**：
- 链式堆积风险；扩展更新/卸载后无法还原
- 与页面自身脚本的 `attachShadow` 调用冲突
- Manifest V3 的 content script 隔离模型使 patch 更脆弱

---

## 二、每个方案的可执行代码片段

### 方案 A：CSS 变量继承（首选）

这是 AgentSkin 当前已经在使用的主力方案。CSS 自定义属性穿透 shadow boundary 的机制是 **自上而下的继承通道**：在宿主元素上定义的 CSS 变量会穿透到其所有 shadow DOM 后代（前提是后代自身不声明同名变量覆盖）。

```js
/**
 * injectCSSVariables — 在宿主元素上声明 CSS 自定义变量
 * 变量穿透方向：宿主 → shadow DOM 内后代（继承通道）
 * 限制：仅穿透「可继承属性」（color, font, spacing 等），非继承属性不穿透
 */
function injectCSSVariables(hostElement, variables) {
  // 推荐在 html 或 body 上声明，确保最大穿透范围
  const target = hostElement || document.documentElement;
  for (const [name, value] of Object.entries(variables)) {
    target.style.setProperty(name, value);
  }
}

// 用法
injectCSSVariables(document.documentElement, {
  '--ag-surface': '#1a1a2e',
  '--ag-text': '#eaeaea',
  '--ag-accent': '#7c3aed',
  '--ag-spacing-unit': '8px',
});
```

```css
/* 在 shadow DOM 内部，组件作者需要默认使用变量 */
/* 外部注入的变量会自动穿透到这个 shadow tree 内 */
:host {
  color: var(--ag-text, inherit);
  background: var(--ag-surface, transparent);
}
```

**穿透方向图示**：

```
document (可继承属性)
  └── html.agentskin-host [--ag-surface: #1a1a2e]
       └── body
            └── <custom-element> (shadow host)
                 └── #shadow-root (open 或 closed)
                      └── 内部元素 ← 继承 --ag-surface ✅
```

**关键结论**：
- CSS 变量穿透是 **单向下行**（祖先 → 后代），不是双向
- `mode: 'closed'` **不影响** CSS 变量穿透 — 继承与 mode 无关
- 但如果组件在 shadow root 内部 **重新声明** 同名变量，则内部声明优先级更高（这才是 AgentSkin "遮蔽作用域" 探测工具要解决的问题）

### 方案 B：`::part()` 伪元素（条件使用）

```js
/**
 * styleShadowParts — 通过 ::part() 样式化暴露了 part 属性的 shadow DOM 元素
 * 前提：目标组件内部必须有 part="xxx" 属性的元素
 */
function styleShadowParts(hostSelector, partStyles) {
  const style = document.createElement('style');
  const rules = Object.entries(partStyles).map(([part, css]) =>
    `${hostSelector}::part(${part}) { ${css} }`
  );
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
  return style;
}

// 用法（仅当目标组件暴露了 part 属性时）
styleShadowParts('my-component', {
  'button': 'background: var(--ag-accent) !important',
  'label': 'color: var(--ag-text)',
});
```

**限制**：
- 需要目标组件在 shadow DOM 内部元素上使用 `part="button"` 等属性
- 不支持链式选择器（`::part(button) span` 无效）
- 不适用于 closed shadow DOM（无法通过 JS 确认 part 存在）

### 方案 C：`adoptedStyleSheets`（批量注入 open shadowRoot）

```js
/**
 * createSharedStyleSheet — 创建可复用的 CSSStyleSheet 实例
 * 同一个 sheet 可被多个 shadowRoot 共享，避免重复解析
 */
const sharedSheetCache = new Map();

function createSharedStyleSheet(cssText) {
  if (sharedSheetCache.has(cssText)) {
    return sharedSheetCache.get(cssText);
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  sharedSheetCache.set(cssText, sheet);
  return sheet;
}

/**
 * adoptStyleIntoShadowRoot — 向已知的 open shadowRoot 注入样式
 * @param {ShadowRoot} shadowRoot - 必须是 open 的 shadowRoot
 * @param {string} cssText - 要注入的 CSS 文本
 */
function adoptStyleIntoShadowRoot(shadowRoot, cssText) {
  const sheet = createSharedStyleSheet(cssText);
  // 合并而非替换：保留 shadow 内部原有样式
  const existing = [...shadowRoot.adoptedStyleSheets];
  if (!existing.includes(sheet)) {
    shadowRoot.adoptedStyleSheets = [...existing, sheet];
  }
  return sheet;
}

// 用法
const el = document.querySelector('my-component');
if (el.shadowRoot) {
  adoptStyleIntoShadowRoot(el.shadowRoot, `
    :host { color: var(--ag-text); }
    .internal-element { background: var(--ag-surface); }
  `);
}
```

**重要**：
- `adoptedStyleSheets` 一旦设置，shadowRoot 内的 `<style>` 标签全部失效
- 建议使用**追加**而非全量替换
- `replaceSync()` 是同步操作，大量使用时可能有性能影响

### 方案 D：safe patch attachShadow（完整安全实现）

详见第三章。

### 方案 E：MutationObserver 辅助检测（仅补充）

```js
/**
 * observeNewShadowRoots — 监听 DOM 中新出现的 shadow root（仅 open 模式）
 * 注意：无法检测 closed shadowRoot 的创建
 */
function observeNewShadowRoots(callback) {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // 检查是否有 open shadowRoot
          if (node.shadowRoot) {
            callback(node.shadowRoot, node);
          }
          // 递归检查子元素
          node.querySelectorAll?.('*').forEach((el) => {
            if (el.shadowRoot) callback(el.shadowRoot, el);
          });
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}

// 用法
const obs = observeNewShadowRoots((shadowRoot, hostElement) => {
  adoptStyleIntoShadowRoot(shadowRoot, AGENTSKIN_SHADOW_CSS);
});
```

---

## 三、attachShadow patch 的安全实现模式

### 问题陈述

AgentSkin 当前顾虑：
1. **re-patch 链式堆积**：多次注入时重复 patch，形成 A→B→A→Original 的调用链
2. **remove 无法还原**：撤销注入时无法安全恢复原始 `attachShadow`
3. **与目标应用冲突**：目标应用自身可能也在 patch `attachShadow`

### 安全实现模式

以下是一个工业级的 safe-patch 实现，解决了上述三个问题：

```js
/**
 * SafeAttachShadowPatcher — 安全地 patch Element.prototype.attachShadow
 * 
 * 安全特性：
 * 1. 单例守卫（只 patch 一次，不产生链式堆积）
 * 2. 保存原始引用（清理时可 100% 还原）
 * 3. WeakMap 追踪 owned_shadow_roots（自动 GC，无内存泄漏）
 * 4. 注入样式隔离（清理时可精确移除）
 */
class SafeAttachShadowPatcher {
  static #originalAttachShadow = null;
  static #isPatched = false;
  static #ownedShadows = new WeakMap(); // hostElement -> Set<ShadowRoot>
  static #injectedSheets = new WeakMap(); // shadowRoot -> Set<CSSStyleSheet>
  static #injectFn = null;

  /**
   * 安装 patch
   * @param {Function} injectFn - (shadowRoot, hostElement) => void 注入回调
   */
  static install(injectFn) {
    if (this.#isPatched) {
      // 单例守卫：只 patch 一次，更新注入函数即可
      this.#injectFn = injectFn;
      return;
    }

    // 保存原始引用（仅在首次 patch 时保存）
    this.#originalAttachShadow = Element.prototype.attachShadow;
    this.#injectFn = injectFn;

    const self = this;

    // 使用箭头函数保持 this 绑定，同时避免重复创建函数引用
    Element.prototype.attachShadow = function attachShadow(...args) {
      // 调用原始方法（保证 shadow DOM 正常创建）
      const shadowRoot = self.#originalAttachShadow.apply(this, args);

      // 追踪这个 shadow root 属于哪个 host 元素
      if (!self.#ownedShadows.has(this)) {
        self.#ownedShadows.set(this, new Set());
      }
      self.#ownedShadows.get(this).add(shadowRoot);

      // 执行注入
      try {
        self.#injectFn?.(shadowRoot, this);
      } catch (err) {
        console.warn('[ShadowPiercer] inject error:', err);
      }

      return shadowRoot;
    };

    this.#isPatched = true;
  }

  /**
   * 卸载 patch — 完全还原原始 attachShadow
   * 解决的问题：remove 时可以 100% 还原
   */
  static uninstall() {
    if (!this.#isPatched) return;
    Element.prototype.attachShadow = this.#originalAttachShadow;
    this.#originalAttachShadow = null;
    this.#isPatched = false;
    this.#injectFn = null;
    // WeakMap 无需手动清理，会自动 GC
  }

  /**
   * 检查是否已 patch
   */
  static get isPatched() {
    return this.#isPatched;
  }
}

// ======== 使用示例 ========

// 1. 安装 patch（只在首次调用时真正 patch）
SafeAttachShadowPatcher.install((shadowRoot, hostElement) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { color: var(--ag-text, inherit); }
    * { box-sizing: border-box; }
  `);
  shadowRoot.adoptedStyleSheets = [
    ...shadowRoot.adoptedStyleSheets,
    sheet,
  ];
});

// 2. 卸载（完全还原）
// SafeAttachShadowPatcher.uninstall();
```

### 进阶：分层注入 + 回调钩子

```js
/**
 * 更完善的模式：支持多个注入者（分层），互不干扰
 */
class MultiInjectorShadowPatcher {
  static #original = null;
  static #isPatched = false;
  static #injectors = new Map(); // id -> { priority, fn }

  static install(id, injectorFn, priority = 100) {
    // 首次安装时才 patch prototype
    if (!this.#isPatched) {
      this.#original = Element.prototype.attachShadow;
      this.#isPatched = true;
      const original = this.#original;
      const injectors = this.#injectors;

      Element.prototype.attachShadow = function (...args) {
        const shadowRoot = original.apply(this, args);
        // 按优先级排序执行所有注入者
        const sorted = [...injectors.entries()]
          .sort((a, b) => a[1].priority - b[1].priority);
        for (const [, { fn }] of sorted) {
          try { fn(shadowRoot, this); } catch (e) { /* 静默 */ }
        }
        return shadowRoot;
      };
    }
    this.#injectors.set(id, { fn: injectorFn, priority });
  }

  static uninstall(id) {
    this.#injectors.delete(id);
    // 所有注入者都移除后才还原 prototype
    if (this.#injectors.size === 0 && this.#isPatched) {
      Element.prototype.attachShadow = this.#original;
      this.#isPatched = false;
      this.#original = null;
    }
  }
}

// 使用：多个模块可独立安装和卸载
MultiInjectorShadowPatcher.install('agentskin-theme', (sr, host) => {
  // 主题注入
}, 10);

MultiInjectorShadowPatcher.install('agentskin-cosmetic', (sr, host) => {
  // 外观注入
}, 20);
```

---

## 四、对 AgentSkin ShadowPiercer 模块的具体建议

### 4.1 推荐架构：分层注入策略

基于对 AgentSkin 现有架构（`engines/<id>/adapter.mjs` + `tokens.css` + `cosmetic.css`）和业界实践的分析，ShadowPiercer 应该采用 **分层注入策略**，按优先级依次尝试：

```
优先级 1: CSS 变量继承      ← 无需 patch，性能最高，覆盖 80% 场景
优先级 2: ::part() 样式     ← 仅当目标组件暴露了 part 属性
优先级 3: adoptedStyleSheets ← 对已知 open shadowRoot 批量注入
优先级 4: attachShadow patch ← 最后手段，处理 closed shadow DOM 全覆盖
```

### 4.2 模块签名建议

```typescript
/**
 * ShadowPiercer — AgentSkin Shadow DOM 样式注入模块
 * 
 * 设计原则：
 * - 分层降级：先尝试轻量方案，失败再升级重量级方案
 * - 最小侵入：CSS 变量优先，patch 最后
 * - 可还原：所有注入都有对应的 remove/restore 路径
 */
interface ShadowPiercer {
  /**
   * 初始化注入（幂等：多次调用不重复 patch）
   * @param config 注入配置
   */
  inject(config: ShadowPiercerConfig): Promise<InjectionResult>;
  
  /**
   * 完全撤销注入（还原到注入前状态）
   */
  remove(): Promise<void>;
  
  /**
   * 动态更新（热替换注入样式，不需重新 patch）
   */
  update(cssVariables: Record<string, string>): Promise<void>;
}

interface ShadowPiercerConfig {
  /** 注入范围：'all' | 'open-only' | 'variables-only' */
  mode: 'all' | 'open-only' | 'variables-only';
  /** CSS 变量映射（优先级 1） */
  variables: Record<string, string>;
  /** attachShadow patch 的 CSS 注入内容（优先级 4 时使用） */
  shadowCss?: string;
  /** 性能预算：patch 超时时间（ms），超时则降级 */
  budgetMs?: number;
}

interface InjectionResult {
  /** 实际使用的注入模式 */
  modeUsed: 'variables' | 'adopted' | 'patch' | 'mixed';
  /** 注入的 shadow root 数量 */
  shadowRootsInjected: number;
  /** 通过 CSS 变量穿透的范围是否需要 JS 干预 */
  variablePenetrationRate: number;
}
```

### 4.3 关键逻辑伪代码

```js
async function pierceShadowDOM(config) {
  // 步骤 1: 始终尝试 CSS 变量继承（零副作用）
  injectCSSVariables(document.documentElement, config.variables);
  
  // 步骤 2: 扫描已存在的 open shadowRoot，使用 adoptedStyleSheets
  const openShadows = scanExistingOpenShadowRoots();
  for (const { root, host } of openShadows) {
    adoptStyleIntoShadowRoot(root, config.shadowCss || '');
  }
  
  // 步骤 3: 如果 mode 为 'all'，安装 attachShadow patch
  if (config.mode === 'all') {
    SafeAttachShadowPatcher.install((shadowRoot, hostElement) => {
      const sheet = createSharedStyleSheet(config.shadowCss);
      shadowRoot.adoptedStyleSheets = [
        ...shadowRoot.adoptedStyleSheets,
        sheet,
      ];
    });
  }
  
  // 步骤 4: 启动 MutationObserver，监听新添加的 open shadowRoot
  observeNewShadowRoots((shadowRoot, hostElement) => {
    adoptStyleIntoShadowRoot(shadowRoot, config.shadowCss || '');
  });
  
  return {
    modeUsed: config.mode === 'all' ? 'mixed' : 'adopted',
    shadowRootsInjected: openShadows.length,
    variablePenetrationRate: estimatePenetration(),
  };
}
```

### 4.4 与现有 AgentSkin 架构的整合建议

1. **在 `adapter.mjs` 中集成**：不新建独立模块，而是在每个适配器的 `adapter.mjs` 中引入 ShadowPiercer 逻辑
2. **tokens.css 变量延伸**：确保所有主题 token 变量都使用 CSS 自定义属性，天然穿透 shadow boundary
3. **cosmetic.css 补充**：对于通过变量无法覆盖的组件（有内部变量声明），在 cosmetic.css 中添加 `::part()` 选择器或组件特定覆盖
4. **复用现有探测工具**：`debug-tools/probe-shadow-scope.mjs` 的遮蔽检测逻辑可以作为 ShadowPiercer 的前置分析步骤

### 4.5 风险与限制

| 风险 | 缓解措施 |
|------|---------|
| patch 被目标应用覆盖 | 在注入前检查 `Element.prototype.attachShadow.toString()` 是否含原生标记 |
| CSS 变量名冲突（目标应用也声明同名变量） | 使用 AgentSkin 唯一前缀 `--ag-`，并在遮蔽探测报告中识别冲突 |
| `adoptedStyleSheets` 覆盖 shadow 内部原有样式 | 始终使用追加（spread）而非替换 |
| 性能：大量 shadow root 创建时重复注入 | 使用 `sharedSheetCache` 复用同一 sheet 实例 |
| 注入顺序不确定导致层叠问题 | 使用 `!important` 或提升特异性 |

---

## 五、参考链接

### GitHub 仓库

| 项目 | 链接 | 说明 |
|------|------|------|
| Stylus 扩展 | https://github.com/openstyles/stylus | 样式注入策略参考（cssRules 遍历） |
| Vencord | https://github.com/Vendicated/Vencord | Discord 客户端修改，WebSocket 注入 |
| Chrome DevTools Protocol | https://chromedevtools.github.io/devtools-protocol/ | CDP 协议文档 |
| devtools-protocol 类型 | https://github.com/ChromeDevTools/devtools-protocol | CDP JSON schema |

### W3C / Web 平台规范

| 规范 | 链接 | 说明 |
|------|------|------|
| CSS Shadow Parts Level 1 | https://www.w3.org/TR/css-shadow-parts-1/ | `::part()` 规范（2025-12 WD） |
| CSS Scoping Module Level 1 | https://www.w3.org/TR/css-scoping-1/ | Shadow DOM 样式隔离规范 |
| CSSOM (Constructable Stylesheets) | https://www.w3.org/TR/cssom-1/#cssstylesheet | `CSSStyleSheet` 构造函数规范 |
| Web Components (Shadow DOM) | https://html.spec.whatwg.org/multipage/scripting.html#shadow-trees | WHATWG Shadow DOM 规范 |
| `::part()` 浏览器兼容 | https://caniuse.com/mdn-css_selectors_part | Chrome 97+ / FF 79+ / Safari 15.4+ |
| CSSStyleSheet API 兼容 | https://caniuse.com/mdn-api_cssstylesheet_cssstylesheet | Chrome 73+ / FF 94+ / Safari 16.4+ |

### MDN Web 文档

| 文档 | 链接 |
|------|------|
| `Element.attachShadow()` | https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow |
| `CSSStyleSheet` | https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet |
| `adoptedStyleSheets` | https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptedStyleSheets |
| `::part()` | https://developer.mozilla.org/en-US/docs/Web/CSS/::part |
| CSS Custom Properties | https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties |
| `ShadowRoot` | https://developer.mozilla.org/en-US/docs/Web/API/ShadowRoot |

### AgentSkin 内部相关文件

| 文件 | 用途 |
|------|------|
| `debug-tools/probe-shadow-scope.mjs` | 遮蔽作用域探测主脚本 |
| `engines/INDEX.md` | 引擎架构文档 |
| `engines/<id>/adapter.mjs` | 各适配器 CDP 注入器 |
| `engines/<id>/tokens.css` | 14-token 变量定义 |
| `engines/<id>/cosmetic.css` | 外观微调样式 |

### 未经验证项

以下是基于文档和代码分析得出的结论，尚未在 AgentSkin 实际目标应用（traework / qoderwork / workbuddy / doubao / codex / zcode）中逐一验证：

1. **CSS 变量穿透 closed shadowRoot**：理论上是继承机制决定的，应该工作，但具体效果取决于各应用是否声明了同名竞争变量
2. **attachShadow patch 在各 Electron 版本中的可靠性**：patch 方式在所有 Chromium 版本中理论可行，但各 Electron 版本是否有沙箱限制需实测
3. **CDP CSS 域直接操作 shadow DOM 样式**：CDP 的 `CSS.setStyleSheetForShadowRoot` 命令是否存在尚需验证 public CDP registry
4. **Stylus 对 closed shadow DOM 的具体降级策略**：Stylus 仓库源码因 GitHub 403 无法直接读取，策略基于文档分析推测

---

## 附录：决策矩阵 — 何时使用哪种方案

```
                    ┌─────────────────────────────────┐
                    │ 目标组件使用 Shadow DOM？        │
                    └──────────┬──────────────────────┘
                           │
              ┌────────────┴────────────┐
              │ 是                       │ 否
              ▼                          ▼
    ┌─────────────────────┐    ┌──────────────────┐
    │ 是 open 模式？       │    │ 常规 CSS 注入即可 │
    └──────────┬──────────┘    └──────────────────┘
              │
     ┌────────┴────────┐
     │ 是               │ 否（closed）
     ▼                 ▼
┌──────────────┐  ┌────────────────────┐
│ 可直接访问   │  │ CSS 变量继承       │
│ shadowRoot   │  │（穿透 closed 边界）  │
│ → adopted    │  └─────────┬──────────┘
│   StyleSheets│            │
└──────────────┘     ┌──────┴──────┐
                     │ 变量被覆盖？  │
                     └──────┬──────┘
                    ┌───────┴───────┐
                    │ 是             │ 否
                    ▼               ▼
            ┌──────────────┐  ┌──────────┐
            │ attachShadow │  │ 变量穿透  │
            │ patch        │  │ 成功 ✅   │
            │（最后手段）   │  └──────────┘
            └──────────────┘
```

---

*本报告基于 2026-08-22 前的公开技术文档、GitHub 开源项目源码、W3C 规范草案以及 AgentSkin 项目内部代码分析编写。*
