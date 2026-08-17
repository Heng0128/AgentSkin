/**
 * 语义别名选择器注册表
 *
 * 为每个平台的 adapter 提供结构化的"语义名 — fallback 链"映射。当第三方 Agent
 * 应用更新导致 hash 类名（如 _.css-1a2b3c4、_container_a1b2c3d4_5）变化时，
 * 多 fallback 机制保证兼容性：按顺序尝试选择器数组，第一个可见匹配项即为结果。
 *
 * 此注册表与 adapter.verification 互为补充 —— adapter 定义的是"最小验证集合"
 * （随 npm 包发布，build-time known），注册表提供"完整语义选择器图谱"
 * （consumed by resolver + runtime diagnostics + test fixtures）。
 *
 * 命名约定：
 *   root        — 应用根节点（必须存在，阻塞验证）
 *   sidebar     — 侧边栏
 *   workspace   — 主工作区
 *   composer    — 用户输入区域
 *   messageList — 消息列表滚动容器
 *   toolbar     — 顶部工具栏
 */

/**
 * @typedef {object} SemanticControlConfig
 * @property {boolean} controlled - 该组件是否由主题控制（isNativeThemeControlled）。
 *   true = 应用主题色值；false = 保留原生样式。缺省按 true 处理（维持现状），
 *   避免因未配置而导致现有渲染失效。
 * @property {string} [controllingSelector] - 真正承载主题样式的锚点选择器
 *   （区别于 entry.selectors 的 fallback 链，选中实际视觉载体）。
 * @property {string[]} [nonControlled] - 该组件内部**不应**被主题覆盖的子选择器
 *   （如 inner input / inner button / divider / collapse-toggle），运行时会为
 *   这些节点标记 `agentskin-non-controlled` 并从主题过滤中排除。
 */

/**
 * @typedef {object} SemanticSelectorEntry
 * @property {string[]} selectors - 按优先级排序的 CSS 选择器 fallback 数组
 * @property {boolean} required - true 表示该节点必须存在（阻塞预检）
 * @property {string} [description] - 人类可读的用途说明
 * @property {SemanticControlConfig} [semantic] - 语义控制配置（对抗过度渲染，
 *   驱动 `isNativeThemeControlled` 判定与 `agentskin-non-controlled` 标记）。
 *   缺省即视为主题受控（controlled=true）。
 */

/**
 * 按平台 ID 编制的选择器注册表。
 * @type {Record<string, Record<string, SemanticSelectorEntry>>}
 */
export const SELECTOR_REGISTRIES = {
	workbuddy: {
		root: {
			selectors: [
				"#root > .teams-container",
				".teams-container",
				"#root",
				"#app",
				"body > div",
			],
			required: true,
			description: "WorkBuddy 主根节点。teams-container 是其标志性壳体；#root 为通用兜底。",
		},
		sidebar: {
			selectors: [
				".conversation-sidebar",
				".conversation-list",
				"[class*='sidebar']",
				"nav",
			],
			required: false,
			description: "左侧会话列表导航",
		},
		workspace: {
			selectors: [
				".teams-main-content",
				".main-content",
				".chat-container",
				"[class*='chat']",
				"main",
			],
			required: false,
			description: "主工作区内容容器",
		},
		composer: {
			selectors: [
				"[role='textbox'][contenteditable='true']",
				".wb-home-composer [contenteditable='true']",
				"[contenteditable='true']",
			],
			required: false,
			description: "用户消息输入区域",
			semantic: {
				controlled: true,
				// 输入框/按钮等内层控件不随主题强制着色；容器外壳仍由主题控制。
				innerInputNonControlled: true,
				innerInputSelector: "[contenteditable='true'], textarea",
				innerButtonNonControlled: true,
				innerButtonSelector: "button, [role='button']",
				nonControlled: ["[contenteditable='true']", "textarea", "button", "[role='button']"],
			},
		},
		toolbar: {
			selectors: [
				".wb-home-header",
				".app-header",
				"header",
			],
			required: false,
			description: "顶部工具栏",
		},
	},
	codex: {
		root: {
			selectors: [
				"main.main-surface",
				"main",
				"#root",
				"body > div",
			],
			required: true,
			description: "ChatGPT/Codex 主视图根节点。main-surface 是 Codex 桌面端的标志性类名。",
		},
		sidebar: {
			selectors: [
				"aside.app-shell-left-panel",
				"aside[class*='left']",
				"[class*='sidebar']",
				"aside",
			],
			required: false,
			description: "左侧历史对话面板",
		},
		composer: {
			selectors: [
				".composer-surface-chrome",
				"form textarea",
				"[contenteditable='true']",
				"textarea",
			],
			required: false,
			description: "底部输入区域",
			semantic: {
				controlled: true,
				controllingSelector: ".composer-surface-chrome",
				innerInputNonControlled: true,
				innerInputSelector: "[contenteditable='true'], textarea",
				innerButtonNonControlled: true,
				innerButtonSelector: "button, [role='button']",
				nonControlled: ["[contenteditable='true']", "textarea", "button", "[role='button']"],
			},
		},
		workspace: {
			selectors: [
				".conversation-shell",
				".chat-viewport",
				"main > div",
			],
			required: false,
			description: "会话主内容区",
		},
	},
	doubao: {
		root: {
			selectors: [
				"#root",
				"#app",
				"body > div:first-child",
				"body",
			],
			required: true,
			description: "豆包 React 根节点。结构较简单，主要靠 #root 兜底。",
		},
		sidebar: {
			selectors: [
				"[class*='sidebar']",
				"[class*='session-list']",
				"aside",
				"nav",
			],
			required: false,
			description: "侧边栏",
		},
		messageList: {
			selectors: [
				"[class*='message-list']",
				"[class*='chat-content']",
				"[role='log']",
			],
			required: false,
			description: "消息列表滚动容器",
		},
		composer: {
			selectors: [
				"[contenteditable='true']",
				"textarea",
				"[class*='input']",
			],
			required: false,
			description: "用户输入区域",
			semantic: {
				controlled: true,
				innerInputNonControlled: true,
				innerInputSelector: "[contenteditable='true'], textarea",
				innerButtonNonControlled: true,
				innerButtonSelector: "button, [role='button']",
				nonControlled: ["[contenteditable='true']", "textarea", "button", "[role='button']"],
			},
		},
	},
	qoderwork: {
		root: {
			selectors: [
				"#root .agents-layout-root",
				".agents-layout-root",
				"#root",
				"#app",
			],
			required: true,
			description: "QoderWork 主布局根节点。agents-layout-root 是其 React 布局容器。",
		},
		sidebar: {
			selectors: [
				".agents-sidebar",
				"[data-resizable-sidebar]",
				"[class*='sidebar']",
				"aside",
			],
			required: false,
			description: "左侧可拖拽调整大小的侧边栏",
		},
		workspace: {
			selectors: [
				".agents-content-area",
				".agents-layout-body",
				"[class*='content-area']",
				"main",
			],
			required: false,
			description: "主工作区内容面板",
		},
		composer: {
			selectors: [
				".chat-input-editor-text[contenteditable='true']",
				"[contenteditable='true']",
				"textarea",
			],
			required: false,
			description: "可编辑输入区域",
			semantic: {
				controlled: true,
				innerInputNonControlled: true,
				innerInputSelector: "[contenteditable='true'], textarea",
				innerButtonNonControlled: true,
				innerButtonSelector: "button, [role='button']",
				nonControlled: ["[contenteditable='true']", "textarea", "button", "[role='button']"],
			},
		},
	},
	traework: {
		root: {
			selectors: [
				"#root .panel-container",
				"#root .solo-lite-layout",
				".panel-container",
				".solo-lite-layout",
				"#root",
			],
			required: true,
			description: "TRAE solo-lite 主容器。home 路由渲染 panel-container；会话渲染 solo-lite-layout。",
		},
		sidebar: {
			selectors: [
				".task-list-base",
				".task-list-panel",
				"[class*='task-list']",
				"[class*='sidebar']",
				"aside",
			],
			required: false,
			description: "左侧任务/会话列表",
			semantic: {
				controlled: true,
				controllingSelector: ".task-list-base",
				innerHoverControlled: true,
				innerHoverSelector: ".task-list-item:hover",
				nonControlled: [".task-list-divider", ".collapse-toggle-icon"],
			},
		},
		workspace: {
			selectors: [
				".panel-container",
				".solo-lite-layout",
				".conversation-shell",
				"main",
			],
			required: false,
			description: "主工作区",
		},
		composer: {
			selectors: [
				".chat-input-v2-input-box-editable[contenteditable='true']",
				"[contenteditable='true']",
				"textarea",
			],
			required: false,
			description: "用户输入区域",
		},
		toolbar: {
			selectors: [
				".solo-lite-header",
				"[class*='header']",
				"header",
			],
			required: false,
			description: "顶部工具栏",
		},
	},
	zcode: {
		root: {
			selectors: [
				"#root",
				"#app",
				"body > div",
				"body",
			],
			required: true,
			description: "ZCode Electron 根节点。React 应用挂载于 #root。",
		},
		sidebar: {
			selectors: [
				"[class*='sidebar']",
				"[class*='panel-left']",
				"aside",
				"nav",
			],
			required: false,
			description: "侧边栏",
		},
		composer: {
			selectors: [
				"[contenteditable='true']",
				"[role='textbox']",
				"textarea",
			],
			required: false,
			description: "用户输入区域",
			semantic: {
				controlled: true,
				innerInputNonControlled: true,
				innerInputSelector: "[contenteditable='true'], textarea",
				innerButtonNonControlled: true,
				innerButtonSelector: "button, [role='button']",
				nonControlled: ["[contenteditable='true']", "textarea", "button", "[role='button']"],
			},
		},
		workspace: {
			selectors: [
				"[class*='main']",
				"[class*='editor']",
				"main",
			],
			required: false,
			description: "主工作区",
		},
	},
};

/**
 * 检测一个 CSS 类名是否为构建工具生成的 hash 类名
 * (如 "css-1x2y3z4"、"_container_a1b2c3d4_5")。
 * 这类名随构建变化，不能作为稳定选择器锚点。
 *
 * @param {string} className
 * @returns {boolean}
 */
export function isGeneratedClass(className) {
	if (!className || typeof className !== "string") return false;
	const name = className.trim();
	if (!name) return false;
	if (name.length > 80) return true;
	// css-hash pattern: "css-" + 6+ alphanumeric
	if (/^css-[a-z0-9]{6,}$/i.test(name)) return true;
	// emotion/styled-components: "_prefix_HASH_COUNT"
	if (/^_[a-z][a-z0-9]*_[a-z0-9]{5,}_\d+$/i.test(name)) return true;
	// 纯十六进制 hash
	if (/(?:^|[-_])[a-f0-9]{8,}(?:$|[-_])/i.test(name)) return true;
	return false;
}

/**
 * 获取指定平台的语义名 fallback 链。
 *
 * @param {string} agentId - 平台 ID (如 "workbuddy")
 * @param {string} semanticName - 语义别名 (如 "root", "sidebar")
 * @returns {string[] | null} 选择器数组，若未找到返回 null
 */
export function getSelectors(agentId, semanticName) {
	const registry = SELECTOR_REGISTRIES[agentId];
	if (!registry) return null;
	const entry = registry[semanticName];
	if (!entry) return null;
	return entry.selectors;
}

/**
 * 判断某平台的某选择器条目是否为"必须存在"。
 *
 * @param {string} agentId
 * @param {string} semanticName
 * @returns {boolean} 仅当注册表存在且 required=true 时返回 true，否则 false
 */
export function isRequired(agentId, semanticName) {
	const registry = SELECTOR_REGISTRIES[agentId];
	if (!registry) return false;
	const entry = registry[semanticName];
	if (!entry) return false;
	return entry.required === true;
}

/**
 * 判断元素是否"可见" -- 有非零尺寸且未被 display/visibility 隐藏。
 * 应用可能在 DOM 中保留隐藏副本（抽屉、虚拟滚动等），这些不应被视为有效命中。
 *
 * @param {Element} element
 * @returns {boolean}
 */
export function isVisible(element) {
	if (!element || typeof element.getBoundingClientRect !== "function") return false;
	const box = element.getBoundingClientRect();
	if (box.width <= 0 || box.height <= 0) return false;
	if (typeof getComputedStyle === "function") {
		const style = getComputedStyle(element);
		if (style.display === "none" || style.visibility === "hidden") return false;
	}
	return true;
}

/**
 * 按 fallback 链解析语义名为实际 DOM 元素。
 *
 * 遍历选择器数组，返回第一个在文档中可见匹配的元素。
 * 应用更新后只要任意一个 fallback 命中，主题仍能正确挂载。
 *
 * @param {string} agentId - 平台 ID
 * @param {string} semanticName - 语义别名
 * @param {Document | { querySelector: Function }} [doc] - 目标文档对象，默认当前 document
 * @returns {Element | null} 匹配到的 DOM 元素，全未命中返回 null
 */
export function resolveSelector(agentId, semanticName, doc = document) {
	const selectors = getSelectors(agentId, semanticName);
	if (!selectors) return null;

	for (const selector of selectors) {
		try {
			const element = doc.querySelector(selector);
			if (element && isVisible(element)) {
				return element;
			}
		} catch {
			// 选择器语法无效（如包含目标引擎不支持的结构）时跳过，继续下一个 fallback
		}
	}
	return null;
}

/**
 * 验证平台上所有 required=true 的选择器。
 *
 * 返回结构化的 ok/failed 列表，供 preflight 检查使用。
 * 全部通过意味着"应用已完成启动"且 hash 类名未发生破坏性变化。
 *
 * @param {string} agentId
 * @param {Document | { querySelector: Function }} [doc]
 * @returns {{ ok: string[], failed: string[], unknown: string[] }}
 *   ok:     注册表存在且选择器命中;
 *   failed: 注册表存在但选择器全未命中;
 *   unknown: 注册表不存在此平台
 */
export function verifyRequiredSelectors(agentId, doc = document) {
	const registry = SELECTOR_REGISTRIES[agentId];
	if (!registry) {
		return { ok: [], failed: [], unknown: [agentId] };
	}

	const ok = [];
	const failed = [];

	for (const [semanticName, entry] of Object.entries(registry)) {
		if (!entry.required) continue;
		const resolved = resolveSelector(agentId, semanticName, doc);
		if (resolved) {
			ok.push(semanticName);
		} else {
			failed.push(semanticName);
		}
	}

	return { ok, failed, unknown: [] };
}

/**
 * 返回某平台注册表中的所有语义别名（键名列表）。
 * UI 层可用此动态渲染"检查状态面板"。
 *
 * @param {string} agentId
 * @returns {string[]}
 */
export function listSemanticNames(agentId) {
	const registry = SELECTOR_REGISTRIES[agentId];
	if (!registry) return [];
	return Object.keys(registry);
}

/**
 * 获取所有已注册的平台 ID 列表。
 * @returns {string[]}
 */
export function listRegisteredAgents() {
	return Object.keys(SELECTOR_REGISTRIES);
}

/**
 * 读取某语义条目的语义控制配置（`semantic`）。
 *
 * @param {string} agentId
 * @param {string} semanticName
 * @returns {import("./selectivity-registry.mjs").SemanticControlConfig | null}
 *   未配置或条目不存在时返回 null（调用方应将其视作"受控"，见 isNativeThemeControlled）。
 */
export function getSemantic(agentId, semanticName) {
	const registry = SELECTOR_REGISTRIES[agentId];
	if (!registry) return null;
	const entry = registry[semanticName];
	if (!entry || !entry.semantic) return null;
	return entry.semantic;
}

/**
 * 判定某语义条目是否由主题控制（isNativeThemeControlled）。
 *
 * 判定规则（对齐审计 §2.3 优先级之一「显式标记」）：
 *   - 显式配置 `semantic.controlled` → 按其值返回；
 *   - 无 `semantic` 配置 → 按 true 处理（维持现状：现有引擎默认渲染全节点，
 *     避免因未配置而退化）。
 *
 * @param {string} agentId
 * @param {string} semanticName
 * @returns {boolean}
 */
export function isNativeThemeControlled(agentId, semanticName) {
	const semantic = getSemantic(agentId, semanticName);
	if (!semantic) return true;
	return semantic.controlled !== false;
}

/**
 * 收集某平台所有「标注了 nonControlled 子节点」的语义条目拓扑，供语义过滤层
 * 在运行时标记非受控节点并从主题过滤中排除。
 *
 * 返回结构：
 *   [{ name, selectors, semantic: SemanticControlConfig }]
 *
 * 仅返回配置了 `semantic.nonControlled` 且 `controlled !== false` 的条目。
 *
 * @param {string} agentId
 * @returns {Array<{ name: string; selectors: string[]; semantic: import("./selectivity-registry.mjs").SemanticControlConfig }>}
 */
export function collectNonControlledTopology(agentId) {
	const registry = SELECTOR_REGISTRIES[agentId];
	if (!registry) return [];
	const result = [];
	for (const [name, entry] of Object.entries(registry)) {
		const semantic = entry.semantic;
		if (!semantic || semantic.controlled === false) continue;
		const nonControlled = semantic.nonControlled;
		if (Array.isArray(nonControlled) && nonControlled.length) {
			result.push({ name, selectors: entry.selectors, semantic });
		}
	}
	return result;
}
