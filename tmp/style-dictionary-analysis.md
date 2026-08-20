# Style Dictionary (amzn/style-dictionary) 工程化分析

> 分析日期: 2026-08-20  
> 分析目标: 为 AgentSkin 设计 token 体系提供架构参考  
> 项目地址: https://github.com/amzn/style-dictionary

---

## 1. 项目概览

Style Dictionary 是 Amazon 开源的**设计 token 构建系统**（Design Token Build System），核心定位是**将设计 token 定义转换为多平台原生样式文件**。它不是一个运行时库，而是一个**构建时工具链**。

### 核心数据流

```
tokens/*.json  →  解析合并  →  Transform 管道  →  Format 输出  →  各平台文件
(config.json)     (合并所有     (单位/格式/命名     (CSS/SCSS/JS/     (variables.css,
                   token 文件)   转换)               iOS/Android)       tokens.swift)
```

### 关键特征

- **单一数据源（Single Source of Truth）**: 所有 token 集中定义在 JSON/JSON5/YAML 文件中
- **构建时转换**: 非运行时，生成静态文件供各平台消费
- **CTI 命名法**: Category-Type-Item 三层命名规范
- **引用解析**: `{token.path}` 语法实现 token 间引用
- **可扩展**: 支持自定义 transform 和 format

---

## 2. 三层 Token 模型详解

### 2.1 CTI 分类法（Category-Type-Item）

Style Dictionary 采用 CTI 分类法组织 token 命名，这是其三层模型的核心：

```
color.background.button.primary.active
└─┬─┘ └─┬──┘ └┬┘ └─┬───┘ └─┬──┘ └─┬──┘
Category Type  Item  Sub-Item State  (可选)
```

| 层级 | 含义 | 示例 |
|------|------|------|
| **Category** | 大类 | `color`, `size`, `font`, `border`, `spacing` |
| **Type** | 用途类型 | `background`, `text`, `border`, `base` |
| **Item** | 具体元素 | `button`, `input`, `card`, `page` |
| **Sub-item** | 变体 | `primary`, `secondary`, `danger` |
| **State** | 状态 | `active`, `hover`, `disabled`, `focus` |

### 2.2 Token 定义格式

```json
{
  "color": {
    "base": {
      "red": { "value": "#FF0000", "type": "color" },
      "blue": { "value": "#0000FF", "type": "color" }
    },
    "background": {
      "primary": {
        "value": "{color.base.blue.value}",
        "type": "color",
        "description": "主背景色"
      }
    }
  },
  "size": {
    "font": {
      "base": { "value": 16, "type": "dimension" },
      "large": { "value": "{size.font.base.value} * 1.5", "type": "dimension" }
    }
  }
}
```

### 2.3 三层语义映射

| Style Dictionary 层级 | 语义 | 示例 |
|----------------------|------|------|
| **Primitive / Base** | 原始值（色阶/尺寸阶梯） | `color.base.red`, `size.spacing.4` |
| **Alias / Semantic** | 语义别名（引用 primitive） | `color.background.primary` → `{color.base.blue}` |
| **Component** | 组件级 token（引用 semantic） | `color.button.primary.background` → `{color.background.primary}` |

这与 AgentSkin 的 14-token 契约有结构上的对应关系：

| AgentSkin 14-token | Style Dictionary 对应层 |
|-------------------|------------------------|
| `accent`, `secondary`, `background`, `foreground` | Semantic 层（别名引用） |
| `muted`, `surface`, `surfaceElevated`, `border` | Semantic 层 |
| `card`, `ring`, `input` | Component 层 |
| 底层色值（用户不可见） | Primitive 层 |

---

## 3. Transform + Format 管道工作原理

### 3.1 管道阶段

```
Token 文件 → 解析 → 合并 → Transform → 引用解析 → Format → 输出文件
```

### 3.2 Transform 机制

Transform 是**对单个 token 的值进行转换**的函数，分为三种类型：

| Transform 类型 | 作用时机 | 示例 |
|---------------|---------|------|
| `attribute` | 为 token 添加元数据分类 | `attribute/cti` — 根据路径添加 category/type/item 属性 |
| `name` | 转换 token 名称格式 | `name/cti/kebab` — `colorBackgroundPrimary` → `color-background-primary` |
| `value` | 转换 token 值 | `color/hex` — 转为 hex 格式；`size/px` — 添加 px 后缀 |

#### 内置 Transform Groups

| Transform Group | 包含的 Transforms | 用途 |
|----------------|-------------------|------|
| `css` | attribute/cti, name/cti/kebab, size/px, color/css | 输出 CSS 变量 |
| `scss` | attribute/cti, name/cti/kebab, size/px, color/css | 输出 SCSS 变量 |
| `less` | attribute/cti, name/cti/kebab, size/px, color/css | 输出 Less 变量 |
| `js` | attribute/cti, name/cti/camel, size/px, color/hex | 输出 JS 对象 |
| `ios` | attribute/cti, name/cti/camel, size/px, color/ios | 输出 Swift 代码 |
| `android` | attribute/cti, name/cti/camel, size/px, color/android | 输出 XML/Compose |
| `compose` | attribute/cti, name/cti/camel, size/px, color/compose | 输出 Kotlin Compose |

#### 自定义 Transform 示例

```javascript
StyleDictionary.registerTransform({
  type: 'value',
  transitive: true,
  name: 'figma/calc',
  matcher: ({ value }) => typeof value === 'string' && value?.includes('*'),
  transformer: ({ value }) => `calc(${value})`,
});
```

### 3.3 Format 机制

Format 是**将转换后的 token 集合渲染为最终文件内容**的函数。

#### 内置 Format 列表

| Format | 输出 | 示例 |
|--------|------|------|
| `css/variables` | CSS 自定义属性 | `:root { --color-primary: #FF0000; }` |
| `scss/variables` | SCSS 变量 | `$color-primary: #FF0000;` |
| `less/variables` | Less 变量 | `@color-primary: #FF0000;` |
| `javascript/es6` | ES6 模块 | `export const colorPrimary = "#FF0000";` |
| `javascript/module` | CommonJS 模块 | `module.exports = { ... }` |
| `typescript/es6-declarations` | TS 类型声明 | `export const colorPrimary: string;` |
| `json` | 纯 JSON | `{ "colorPrimary": "#FF0000" }` |
| `ios-swift/colors` | Swift 颜色常量 | `static let colorPrimary = UIColor(...)` |
| `android/colors` | Android XML | `<color name="color_primary">#FF0000</color>` |
| `android/compose` | Kotlin Compose 对象 | `val ColorPrimary = Color(0xFFFF0000)` |

#### 自定义 Format 示例

```javascript
// 自定义 Tailwind 格式
StyleDictionary.registerFormat({
  name: 'tailwind/custom',
  formatter: (dictionary, config) => {
    const tokens = dictionary.allProperties.reduce((acc, prop) => {
      acc[prop.name] = prop.value;
      return acc;
    }, {});
    return `module.exports = ${JSON.stringify(tokens, null, 2)};`;
  },
});
```

### 3.4 配置示例（完整）

```javascript
// style-dictionary.config.js
module.exports = {
  source: ['tokens/**/*.json'],
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'build/css/',
      files: [{
        destination: 'variables.css',
        format: 'css/variables',
        options: {
          outputReferences: true  // 关键：保留 token 引用关系
        }
      }]
    },
    scss: {
      transformGroup: 'scss',
      buildPath: 'build/scss/',
      files: [{
        destination: '_variables.scss',
        format: 'scss/variables'
      }]
    },
    js: {
      transformGroup: 'js',
      buildPath: 'build/js/',
      files: [{
        destination: 'tokens.js',
        format: 'javascript/es6'
      }]
    },
    ios: {
      transformGroup: 'ios',
      buildPath: 'build/ios/',
      files: [{
        destination: 'Tokens.swift',
        format: 'ios-swift/class'
      }]
    },
    android: {
      transformGroup: 'android',
      buildPath: 'build/android/',
      files: [{
        destination: 'colors.xml',
        format: 'android/colors'
      }]
    }
  }
};
```

---

## 4. 核心机制详解

### 4.1 引用机制（Token References）

引用是 Style Dictionary 最核心的能力之一，实现了**声明式的 token 间依赖**。

#### 语法

```json
{
  "color": {
    "base": {
      "blue": { "value": "#0066CC" }
    },
    "primary": {
      "value": "{color.base.blue}"
    }
  }
}
```

#### 引用解析规则

1. **字符串匹配**: 任何包含 `{...}` 模式的字符串都会被解析
2. **路径解析**: `{color.base.blue}` 按路径查找对应 token
3. **值替换**: 将引用替换为对应 token 的实际值（递归解析）
4. **循环检测**: 检测并报告循环引用
5. **outputReferences 选项**: 控制输出时保留引用还是内联值

#### outputReferences 效果

```css
/* outputReferences: false（默认） */
:root {
  --color-primary: #0066CC;
}

/* outputReferences: true */
:root {
  --color-base-blue: #0066CC;
  --color-primary: var(--color-base-blue);
}
```

### 4.2 条件输出（Platform-Specific）

```javascript
// 自定义 transform 按平台条件执行
StyleDictionary.registerTransform({
  type: 'value',
  name: 'platform-size',
  matcher: (token) => token.attributes.category === 'size',
  transformer: (token, options) => {
    // options.platform 可区分平台
    if (options.platform === 'ios') {
      return `${token.value}pt`;
    } else if (options.platform === 'android') {
      return `${token.value}dp`;
    }
    return `${token.value}px`;
  }
});
```

### 4.3 Token 属性扩展

```json
{
  "color": {
    "primary": {
      "value": "#0066CC",
      "type": "color",
      "description": "品牌主色，用于主要按钮和链接",
      "private": true,
      "themeable": true
    }
  }
}
```

- `type`: 数据类型声明（color, dimension, fontFamily 等）
- `description`: 文档说明
- `private`: 是否作为私有 token 不输出
- `themeable`: 是否参与主题切换
- 自定义属性：可扩展任意属性供 transform 使用

---

## 5. 跨平台一致性保障

### 5.1 一致性机制

| 机制 | 实现方式 |
|------|---------|
| **单一数据源** | 所有平台消费同一份 token JSON |
| **统一 Transform Group** | 确保命名、单位在同一平台内一致 |
| **outputReferences** | 保留引用关系确保值同步 |
| **自定义属性** | 标记 token 的平台可见性 |
| **校验脚本** | 验证 token 完整性和一致性 |

### 5.2 多主题支持

```javascript
// 通过多 source 或条件 token 实现主题
{
  "source": [
    "tokens/primitives.json",
    "tokens/themes/light.json",  // Light 主题覆盖
  ],
  // ...
}
```

### 5.3 数学表达式处理

Style Dictionary 内置**不支持**数学运算（设计决策：`*` 可能是 UI 文本），需通过自定义 transform 实现：

```javascript
StyleDictionary.registerTransform({
  type: 'value',
  transitive: true,
  name: 'math/eval',
  matcher: ({ value }) => typeof value === 'string' && /\d+\s*[*/+-]\s*\d+/.test(value),
  transformer: ({ value }) => {
    try {
      return Function(`'use strict'; return (${value})`)();
    } catch {
      return value;
    }
  },
});
```

---

## 6. 对 AgentSkin 的借鉴点

### 6.1 值得借鉴的模式

#### A. 引用机制（Token References）

**Style Dictionary**: `{color.base.blue}` 引用语法

**AgentSkin 现状**: 当前 manifest.json 中 color token 是扁平结构，无引用能力

**借鉴建议**: 在主题生成器内部引入轻量引用层：

```json
{
  "primitives": {
    "blue500": "#0066CC"
  },
  "colors": {
    "accent": "{primitives.blue500}",
    "ring": "{primitives.blue500}40"
  }
}
```

**收益**: 
- 修改 primitive 值自动传播到所有引用位置
- 减少手动同步错误
- 支持派生色（透明度变体）

#### B. Transform 管道思维

**Style Dictionary**: 声明式定义转换步骤

**AgentSkin 适用场景**: 主题生成时的色彩处理管道

```javascript
// AgentSkin 主题生成器的 transform 管道示例
const transforms = [
  'expandOpacity',    // blue500 → blue50040 (自动计算带透明度的变体)
  'ensureContrast',   // 检查并调整对比度
  'generateFallback', // 为旧版 Agent 生成 fallback
  'validateFormat',   // 验证格式合规
];
```

#### C. outputReferences 模式

**Style Dictionary**: 输出时保留 var(--xxx) 引用

**AgentSkin 收益**: 
- 生成的 CSS 中 `color: var(--color-accent)` 而非内联色值
- 运行时切换主题只需更改变量值，无需替换全部样式

#### D. CTI 命名规范的结构化思维

**Style Dictionary**: `color.background.button.primary`

**AgentSkin 适配**: 当前 AgentSkin 采用简化的扁平 token 名（14-token），可在内部映射为结构化命名：

```
当前: accent → 结构化: color.accent.primary
当前: surfaceElevated → 结构化: color.surface.elevated
```

**收益**: 
- 为未来扩展提供命名空间
- 减少命名冲突
- 提高 IDE 自动补全效率

### 6.2 不适用 AgentSkin 的部分

#### A. 构建时 vs 运行时

| 维度 | Style Dictionary | AgentSkin |
|------|-----------------|-----------|
| **执行时机** | 构建时（npm run build） | 运行时（用户切换主题时） |
| **输出产物** | 静态 CSS/SCSS/JS 文件 | 动态 CSS 注入（CDP） |
| **token 来源** | 设计系统 JSON 文件 | 用户选择的主题包 |
| **目标平台** | Web/iOS/Android | Web（各 Agent 的 Electron 视图） |

**结论**: AgentSkin 是**运行时生成器模式**，Style Dictionary 是**构建时转换模式**。不应在 AgentSkin 中引入构建步骤。

#### B. Transform Group 重型结构

Style Dictionary 的 transform group 包含多个重量级 color/size transform，针对 iOS pt/dp、Android sp 等平台转换。AgentSkin 仅面向 Web/CSS，不需要这些跨平台 transform。

#### C. Format 输出层

Style Dictionary 输出完整 CSS 文件、Swift 代码、Android XML。AgentSkin 的输出是：
- CSS 字符串（注入到 CDP）
- JSON 对象（供 React store 消费）
- 内联 style（部分场景）

不需要完整的文件输出系统。

#### D. 文件合并与解析

Style Dictionary 需要解析 JSON 文件、合并、处理循环引用。AgentSkin 的主题数据是运行时从 manifest.json 读取的结构化对象，合并场景简单。

### 6.3 适配建议总结

| 借鉴项 | 适配方式 | 优先级 |
|--------|---------|--------|
| 引用语法 `{x.y}` | 在主题生成器中实现轻量解析 | 高 |
| Transform 管道 | 构建色彩处理管线（扩展/校验/转换） | 高 |
| CTI 命名结构 | 内部类型定义，不暴露给用户 | 中 |
| outputReferences | CSS 变量引用链保留 | 中 |
| 自定义属性扩展 | manifest.json 扩展字段 | 低 |
| 构建时体系 | **不适用**，AgentSkin 是运行时 | 不采纳 |
| 多平台 format | **不适用**，仅 Web | 不采纳 |

---

## 7. 架构对比总结

### Style Dictionary vs AgentSkin

| 维度 | Style Dictionary | AgentSkin |
|------|-----------------|-----------|
| **模式** | 构建时转换 | 运行时生成 |
| **输入** | 多 JSON 文件 | manifest.json + 用户选择 |
| **核心操作** | Transform + Format | Theme 组装 + CSS 生成 |
| **输出目标** | 多平台原生文件 | CDP 注入 CSS |
| **扩展机制** | registerTransform / registerFormat | Adapter 架构 |
| **引用系统** | `{token.path}` + 递归解析 | 当前无（建议引入） |
| **主题切换** | 重新构建 | 运行时热切换 |
| **依赖关系** | 无（纯 Node 工具） | Electron + CDP + React |

### 核心洞察

1. **Style Dictionary 的引用机制是最佳实践**: 声明式 token 引用是解决主题一致性的关键模式
2. **Transform 管道思维可复用**: 但需要适配为运行时轻量函数链
3. **CTI 命名可局部采用**: 作为内部类型约束，不暴露给终端用户
4. **构建时体系不适用**: AgentSkin 的实时预览和热切换需求决定了必须是运行时架构

---

## 8. 参考资料

- [GitHub: amzn/style-dictionary](https://github.com/amzn/style-dictionary)
- [Style Dictionary 官方文档](https://amzn.github.io/style-dictionary/)
- [tokens-studio/sd-transforms](https://github.com/tokens-studio/sd-transforms) — Tokens Studio 的扩展 transform 集
- [lukasoppermann/design-token-transformer](https://github.com/lukasoppermann/design-token-transformer) — Figma Tokens → Style Dictionary 桥接
- [CSDN: Style Dictionary 终极指南](https://blog.csdn.net/gitblog_00773/article/details/141583176)
- [CSDN: 如何用 Style Dictionary 统一 iOS、Android 和 Web 样式](https://blog.csdn.net/gitblog_00385/article/details/141655378)
