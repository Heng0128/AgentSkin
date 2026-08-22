/**
 * 基准真值层（RFC §4.2）引擎落地
 *
 * 维护「原生主题计算样式快照」的进程内真值缓存，按 `{appId, appVersion, themeMode}`
 * 三元组键控，并提供生命周期（fresh/stale/expired）与失效定义。
 *
 * 仅负责**状态与判定**（纯逻辑，不触达 CDP / DOM），采集脚本由 main 侧
 * `baseline-css-capture.ts` / `dom-snapshot` 提供，这里专注：存、查、失效（S1/审计 §2.2）。
 */

/**
 * 快照新鲜期：≤ FRESH_MS 视为 fresh，免校验直用。
 */
export const BASELINE_FRESH_MS = 30 * 60 * 1000;

/**
 * 快照失效率：> STALE_MS 视为 expired，必须重采。
 */
export const BASELINE_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * @typedef {object} BaselineKey
 * @property {string} appId - 平台 ID
 * @property {string} appVersion - 目标应用版本（失效的第一权重）
 * @property {string} themeMode - 'light' | 'dark'（原生亮/暗各一份）
 * @property {string} [schema] - 引擎快照 schema 版本
 */

/**
 * @typedef {object} BaselineNode
 * @property {string} selector - 语义选择器（去生成哈希后的稳定标识）
 * @property {string} tag
 * @property {number} depth
 * @property {{ x: number; y: number; width: number; height: number }} rect
 * @property {Record<string, string>} styles - 关键计算样式子集
 * @property {Record<string, string>} customProperties - 该节点相对父级的 CSS 变量覆盖
 */

/**
 * @typedef {object} BaselineSnapshot
 * @property {number} schemaVersion
 * @property {string} appId
 * @property {string} appVersion
 * @property {string} themeMode
 * @property {string} route - 采集时路径（路由变化不重采）
 * @property {{ width: number; height: number; devicePixelRatio: number }} viewport
 * @property {BaselineNode[]} nodes
 * @property {Record<string, string>} rootCustomProperties - 根节点 --* 变量集（`--cb-*`、`--agentskin-*` 等）
 * @property {string} [capturedAt]
 */

/**
 * 计算快照生命周期（纯函数，便于单测）。
 *
 * @param {object} params
 * @param {string} [params.capturedAt] - ISO 时间；缺省取 now
 * @param {number} params.now - 触发判定的当前时间戳（ms）
 * @returns {'fresh' | 'stale' | 'expired'}
 */
export function snapshotLifecycle({ capturedAt, now }) {
	const captured = capturedAt ? Date.parse(capturedAt) : now;
	if (!Number.isFinite(captured)) return 'expired';
	const age = now - captured;
	if (age < 0) return 'fresh';
	if (age <= BASELINE_FRESH_MS) return 'fresh';
	if (age <= BASELINE_STALE_MS) return 'stale';
	return 'expired';
}

/**
 * 判定快照对目标三元组是否仍有效（纯函数）。
 *
 * 失效条件（对齐 RFC §4.2）：
 *   1. appId / appVersion / themeMode 任一不匹配 → 失效（版本更新即重采，对应 S5）；
 *   2. 生命周期 expired → 失效；
 *   3. schema 不匹配（引擎升级）→ 失效。
 * 路由变化**不**失效（同一应用内路径迁移不重采）。
 *
 * @param {BaselineSnapshot | null | undefined} snapshot
 * @param {BaselineKey} key
 * @param {number} now - 当前时间戳（ms）
 * @returns {boolean} 是否仍可作为真值直用
 */
export function isBaselineValid(snapshot, key, now) {
	if (!snapshot) return false;
	if (snapshot.appId !== key.appId) return false;
	if (snapshot.appVersion !== key.appVersion) return false;
	if (snapshot.themeMode !== key.themeMode) return false;
	if (key.schema && snapshot.schemaVersion !== Number(key.schema)) return false;
	if (!Array.isArray(snapshot.nodes) || snapshot.nodes.length === 0) return false;
	if (snapshotLifecycle({ capturedAt: snapshot.capturedAt, now }) === 'expired') return false;
	return true;
}

/**
 * 基准真值缓存的进程内实现。
 *
 * - LRU 上限：超过 maxSlots 时淘汰最旧（按最近访问）条目。
 * - 键：`${appId}\u0000${appVersion}\u0000${themeMode}\u0000${schema}`。
 * - 语义：get() 时自动执行失效判定，失效则删除并返回 null。
 */
export class BaselineStore {
	/**
	 * @param {{ maxSlots?: number; now?: () => number }} [opts]
	 */
	constructor(opts = {}) {
		this.maxSlots = opts.maxSlots ?? 16;
		this.now = opts.now ?? Date.now;
		/** @type {Map<BaselineSnapshot, { snapshot: BaselineSnapshot; at: number }>} */
		this._entries = new Map();
	}

	_key(key) {
		return [key.appId, key.appVersion, key.themeMode, key.schema ?? ''].join("\u0000");
	}

	/**
	 * 读取命中且有效的快照；未命中或已失效返回 null（并清除失效项）。
	 * @param {BaselineKey} key
	 * @returns {BaselineSnapshot | null}
	 */
	get(key) {
		const mapKey = this._key(key);
		const entry = this._entries.get(mapKey);
		if (!entry) return null;
		// 存取一次即刷新最近访问（LRU 保序）
		this._entries.delete(mapKey);
		this._entries.set(mapKey, entry);
		if (!isBaselineValid(entry.snapshot, key, this.now())) {
			this._entries.delete(mapKey);
			return null;
		}
		return entry.snapshot;
	}

	/**
	 * 写入快照。
	 * @param {BaselineKey} key
	 * @param {BaselineSnapshot} snapshot
	 */
	put(key, snapshot) {
		const composed = {
			schemaVersion: snapshot.schemaVersion,
			appId: key.appId,
			appVersion: key.appVersion,
			themeMode: key.themeMode,
			route: snapshot.route,
			viewport: snapshot.viewport,
			nodes: snapshot.nodes,
			rootCustomProperties: snapshot.rootCustomProperties ?? {},
			capturedAt: snapshot.capturedAt ?? new Date(this.now()).toISOString(),
		};
		const mapKey = this._key(key);
		this._entries.delete(mapKey);
		this._entries.set(mapKey, { snapshot: composed, at: this.now() });
		while (this._entries.size > this.maxSlots) {
			// Map 按插入序迭代，删掉最老的首项即可（get 已刷新访问，所以首项为最久未用）
			const oldestKey = this._entries.keys().next().value;
			if (oldestKey === undefined) break;
			this._entries.delete(oldestKey);
		}
		return composed;
	}

	/**
	 * 使特定三元组下的快照失效。
	 * @param {Pick<BaselineKey, 'appId'> & Partial<BaselineKey>} partial
	 * @returns {number} 清除的条目数
	 */
	invalidate(partial) {
		let removed = 0;
		for (const [mapKey, entry] of this._entries) {
			const snapshot = entry.snapshot;
			if (partial.appId !== undefined && snapshot.appId !== partial.appId) continue;
			if (partial.appVersion !== undefined && snapshot.appVersion !== partial.appVersion) continue;
			if (partial.themeMode !== undefined && snapshot.themeMode !== partial.themeMode) continue;
			this._entries.delete(mapKey);
			removed += 1;
		}
		return removed;
	}

	/** 清空全部缓存。 @returns {number} 清除条目数 */
	clear() {
		const removed = this._entries.size;
		this._entries.clear();
		return removed;
	}

	/** 当前缓存条目数（含已过期未剔） */
	get size() {
		return this._entries.size;
	}
}