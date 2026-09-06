// SPDX-License-Identifier: MIT

/**
 * # Self-Heal Patrol Agent
 *
 * Cron-style patrol that verifies the injected `<style id="agentskin-style">`
 * element still exists and is non-empty. Hostile agents (notably Doubao) may
 * delete `<style>` elements via a 50 ms timer; V3 engine-strategy's own
 * injection is idempotent but cannot re-enter from outside — that is what this
 * independent patrol process is for.
 *
 * ## Exports
 *
 * - `createPatrolAgent(startGuard, options)` — generic timer-based patrol
 * - `initPageScopePatrol(config)` — page-scoped dual-channel (idle + interval)
 *
 * ## Contract
 *
 * The caller owns re-injection. This module only *detects* loss and reports it
 * via `onInvalidate`. It never mutates the DOM itself.
 */

/** Sentinel session storage key that disables all patrol activity. */
export const PATROL_DISABLED_KEY = '__agentskin_disabled__';

/** Default polling interval when none is supplied. */
const DEFAULT_INTERVAL_MS = 5000;

/** Minimum gap between successive `onInvalidate` calls (cooldown). */
const DEFAULT_COOLDOWN_MS = 100;

/** Element id that the patrol watches for. */
const AG_STYLE_ID = 'agentskin-style';

/**
 * Create a timer-based patrol agent.
 *
 * @param {() => boolean} startGuard
 *   Returns true when the patrol is allowed to run, false to skip the current
 *   tick (self-heal disabled for this cycle). Must remain stable-enough that
 *   callers can toggle it to shut the patrol down permanently.
 * @param {Object} [options]
 * @param {number} [options.intervalMs=5000]  Polling interval.
 * @param {function(string): void} [options.onInvalidate]
 *   Called with `'style-missing'` when the style element is gone or empty.
 * @param {number} [options.cooldownMs=100]  Minimum ms between two onInvalidate calls.
 * @returns {{ stop: () => void }}
 */
export function createPatrolAgent(startGuard, options = {}) {
	const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
	const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
	const onInvalidate = options.onInvalidate;

	let timerId = null;
	let lastFire = 0;

	function tick() {
		if (!startGuard()) return;

		const el = document.getElementById(AG_STYLE_ID);
		const ok = el && typeof el.textContent === 'string' && el.textContent.length > 0;
		if (ok) return;

		const now = Date.now();
		if (now - lastFire < cooldownMs) return;
		lastFire = now;

		if (typeof onInvalidate === 'function') {
			onInvalidate('style-missing');
		}
	}

	timerId = setInterval(tick, intervalMs);

	return {
		stop() {
			if (timerId !== null) {
				clearInterval(timerId);
				timerId = null;
			}
		},
	};
}

/**
 * Initialise a page-scoped patrol using both `requestIdleCallback` and a
 * 5 s `setInterval` for dual-channel detection.
 *
 * Exits silently without creating any timers when
 * `sessionStorage.__agentskin_disabled__ === '1'`.
 *
 * @param {Object} [config]
 * @param {() => boolean} [config.startGuard]  Optional override guard.
 * @param {function(string): void} [config.onInvalidate]  Loss callback.
 * @param {number} [config.intervalMs]  Override interval (default 5000).
 * @param {number} [config.cooldownMs]  Override cooldown (default 100).
 * @returns {() => void}  Cleanup function that cancels all timers + idle callback.
 */
export function initPageScopePatrol(config = {}) {
	if (typeof sessionStorage !== 'undefined') {
		try {
			if (sessionStorage.getItem(PATROL_DISABLED_KEY) === '1') {
				return () => {};
			}
		} catch {
			// sessionStorage may be unavailable (private mode); proceed anyway.
		}
	}

	const { onInvalidate, intervalMs, cooldownMs } = config;
	const startGuard = typeof config.startGuard === 'function' ? config.startGuard : () => true;

	// Channel 1: interval-based (always active).
	const agent = createPatrolAgent(startGuard, {
		intervalMs,
		cooldownMs,
		onInvalidate,
	});

	// Channel 2: idle-callback (best-effort, watches but does NOT fire —
	// interval channel owns the re-invalidate flow to avoid cooldown conflicts).
	let idleId = null;
	if (typeof requestIdleCallback === 'function') {
		idleId = requestIdleCallback(
			() => {
				// 仅做轻量检测并预加载（实际 re-invalidate 由 interval channel 节流）。
				const el = document.getElementById(AG_STYLE_ID);
				if (!el || typeof el.textContent !== 'string' || el.textContent.length === 0) {
					// 检测到缺失 — 等待 interval channel 的下一个 tick 执行实际 re-inject。
					// 不调用 onInvalidate，避免双通道风暴。
				}
			},
			{ timeout: intervalMs },
		);
	}

	return () => {
		agent.stop();
		if (idleId !== null && typeof cancelIdleCallback === 'function') {
			cancelIdleCallback(idleId);
			idleId = null;
		}
	};
}

// Expose globals so IIFEs in the concatenation chain (engine.mjs, adapter.mjs) can call them
window.__agentskin_initPageScopePatrol = initPageScopePatrol;
window.__agentskin_createPatrolAgent = createPatrolAgent;
