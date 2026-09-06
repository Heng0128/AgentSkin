/**
 * css-variable-detection — CSS 变量引用检测（RFC §5 S10 / 语义过滤层 MVP）
 *
 * 上下文：`isNativeThemeControlled` 的判定优先级（审计 §2.3）为
 *   显式标记 > 背景色差法(>30) > 文本色差法(>30) > CSS 变量关联法 > 标签+角色启发法。
 * 注册表（selectivity-registry）提供「显式标记」层级；但当某个组件**未**配置
 * semantic 时，我们需要一个**自动**兜底来判定它是否受主题控制——这正是 S10 的
 * 「CSS 变量引用检测（80%+ 准确率）」。
 *
 * 原理：原生主题化应用（Codex/ChatGPT、Semi Design、Ant Design 等）把主题色值
 * 泵入 CSS 自定义属性（--cb-*、--semi-*、--ant* / --agentskin-*），受控组件通过
 * `var(--…)` 引用这些变量。因此：
 *   - 命中节点引用了主题域变量 → 与主题强关联 → 视为受控（应用主题色值）；
 *   - 仅硬编码色值、不引用任何主题变量 → 与主题弱关联 → 视为非受控（排除）。
 *
 * 本模块为**纯逻辑**（不触达 CDP / DOM，输入以下层采集的原始规则/变量），可独立单测。
 * 供编排层在「显式标记缺失」时回退到该判定，输出顺从 `controlled` 布尔。
 */

/**
 * 默认主题变量域前缀（按各 Agent 原生框架）。命中任一前缀即视为主题关联。
 * 覆盖：AgentSkin 注入层、Codex/ChatGPT(--cb-)、Semi Design(--semi-)、
 * AntD(--ant)、通用 app 主题域。
 */
export const DEFAULT_THEME_DOMAINS = [
	"--agentskin-",
	"--cb-",
	"--semi-",
	"--ant-",
	"--antd-",
	"--app-",
];

/**
 * 从 CSS 规则/声明原文中抽取所有 `var(--x)` 引用的变量名（去重、小写）。
 *
 * @param {string | null | undefined} text
 * @returns {string[]} 引用的 CSS 自定义属性名（含 `--` 前缀）
 */
export function extractVarReferences(text) {
	if (typeof text !== "string") return [];
	const out = [];
	const seen = new Set();
	const re = /var\(\s*(--[a-z0-9_-]+)/gi;
	let match;
	while ((match = re.exec(text)) !== null) {
		const name = match[1].toLowerCase();
		if (!seen.has(name)) {
			seen.add(name);
			out.push(name);
		}
	}
	return out;
}

/**
 * 判定某变量名是否属于主题域。
 *
 * @param {string} varName 需为 CSS 自定义属性名（以 `--` 开头）
 * @param {string[]} [domains] 主题域前缀；缺省 DEFAULT_THEME_DOMAINS
 * @returns {boolean}
 */
export function matchesThemeDomain(varName, domains = DEFAULT_THEME_DOMAINS) {
	const name = String(varName).toLowerCase();
	return domains.some((domain) => name.startsWith(domain.toLowerCase()));
}

/**
 * 汇总变量集为单位判定：主题关联变量数是否 ≥ required。
 *
 * @param {Iterable<string>} vars 观测到的 CSS 变量名集合
 * @param {{ domains?: string[]; required?: number }} [opts]
 * @returns {{
 *   controlled: boolean; referencedVars: string[]; themedVars: string[]; themedCount: number; totalCount: number;
 * }}
 */
export function assessThemeAssociation(vars, opts = {}) {
	const domains = opts.domains ?? DEFAULT_THEME_DOMAINS;
	const required = opts.required ?? 1;
	const referencedVars = [...new Set([...vars].map(String).map((v) => v.toLowerCase()))];
	const themedVars = referencedVars.filter((v) => v.startsWith("--") && matchesThemeDomain(v, domains));
	return {
		controlled: themedVars.length >= required,
		referencedVars,
		themedVars,
		themedCount: themedVars.length,
		totalCount: referencedVars.length,
	};
}

/**
 * 单节点的主题关联分析：合并其命中规则原文与已解析变量，做受控判定。
 *
 * @param {{
 *   rules?: string[];                       // 该节点命中的 CSS 规则原文（含 var() 引用）
 *   customProperties?: string[] | Record<string, string>; // 变量名列表 或 变量名→解析值
 * }} [nodeInput]
 * @param {{ domains?: string[]; required?: number }} [opts]
 * @returns {{
 *   controlled: boolean; referencedVars: string[]; themedVars: string[]; themedCount: number; totalCount: number;
 *   reason: 'css-var-association' | 'css-var-none';
 * }}
 */
export function analyzeNodeThemeAssociation(nodeInput = {}, opts = {}) {
	const vars = new Set();
	for (const text of nodeInput.rules ?? []) {
		for (const v of extractVarReferences(text)) vars.add(v);
	}
	const props = nodeInput.customProperties;
	if (Array.isArray(props)) {
		for (const p of props) {
			if (typeof p === "string" && p !== "") vars.add(p);
		}
	} else if (props && typeof props === "object") {
		for (const key of Object.keys(props)) {
			if (key.startsWith("--")) vars.add(key);
		}
	}
	const verdict = assessThemeAssociation(vars, opts);
	return {
		...verdict,
		reason: verdict.controlled ? "css-var-association" : "css-var-none",
	};
}

/**
 * 批量分类一组节点为主题受控/非受控。
 *
 * @param {Array<{ key: string; rules?: string[]; customProperties?: string[] | Record<string, string> }>} nodes
 * @param {{ domains?: string[]; required?: number; minRatio?: number }} [opts]
 * @returns {{
 *   controlled: Array<{ key: string } & ReturnType<typeof analyzeNodeThemeAssociation>>;
 *   nonControlled: Array<{ key: string } & ReturnType<typeof analyzeNodeThemeAssociation>>;
 *   ratio: number; pass?: boolean;
 * }}
 */
export function classifyNodesThemeControl(nodes = [], opts = {}) {
	const controlled = [];
	const nonControlled = [];
	for (const node of nodes) {
		const verdict = analyzeNodeThemeAssociation(node, opts);
		const item = { key: node.key, ...verdict };
		if (verdict.controlled) controlled.push(item);
		else nonControlled.push(item);
	}
	const ratio = nodes.length > 0 ? controlled.length / nodes.length : 1;
	const result = { controlled, nonControlled, ratio };
	if (opts.minRatio !== undefined) result.pass = ratio >= opts.minRatio;
	return result;
}