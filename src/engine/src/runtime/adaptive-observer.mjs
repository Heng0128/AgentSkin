/**
 * AdaptiveMutationObserver - 集成了三层节流的 MutationObserver 包装器
 *
 * 三层节流：
 * 1. 窗口限流：10s 内最多处理 50 次突变
 * 2. 冷却期：超限后 2s 静默期（暂停处理突变，但不 disconnect）
 * 3. 循环检测：同一元素 1s 内变更超过 10 次则跳过
 *
 * 使用方式（兼容原生 MutationObserver API）：
 *   import { AdaptiveMutationObserver } from './adaptive-observer.mjs';
 *   const obs = new AdaptiveMutationObserver(callback);
 *   obs.observe(document.body, { childList: true, subtree: true });
 *   obs.disconnect();
 */

export class AdaptiveMutationObserver {
  /**
   * @param {MutationCallback} callback - 与原生 MutationObserver 相同的回调
   * @param {Object} [options]
   * @param {number} [options.throttleWindow=10000] - 限流窗口大小（ms）
   * @param {number} [options.throttleMaxAttempts=50] - 窗口内最大处理次数
   * @param {number} [options.retryTimeout=2000] - 超限后冷却期（ms）
   * @param {number} [options.loopThreshold=1000] - 循环检测时间窗口（ms）
   * @param {number} [options.loopMaxCycles=10] - 循环检测阈值（同一元素变更次数）
   */
  constructor(callback, options = {}) {
    this.callback = callback;
    this.throttleWindow = options.throttleWindow ?? 10000;
    this.throttleMaxAttempts = options.throttleMaxAttempts ?? 50;
    this.retryTimeout = options.retryTimeout ?? 2000;
    this.loopThreshold = options.loopThreshold ?? 1000;
    this.loopMaxCycles = options.loopMaxCycles ?? 10;

    this.attemptCount = 0;
    this.windowStart = Date.now();
    this.isThrottled = false;
    this.elementChanges = new WeakMap();
    this._throttleTimer = null;

    this.observer = new MutationObserver((records) => {
      this._handleMutations(records);
    });
  }

  /**
   * 委托给底层 MutationObserver
   * @param {Node} target
   * @param {MutationObserverInit} options
   */
  observe(target, options) {
    this.observer.observe(target, options);
  }

  /**
   * 断开连接并清理冷却定时器
   */
  disconnect() {
    this.observer.disconnect();
    if (this._throttleTimer) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
  }

  /**
   * 获取待处理的突变记录（原生 API 兼容）
   * @returns {MutationRecord[]}
   */
  takeRecords() {
    return this.observer.takeRecords();
  }

  // -------------------------------------------------------------------------
  // 内部方法
  // -------------------------------------------------------------------------

  _handleMutations(records) {
    // 循环检测：过滤高频变更元素
    const filtered = records.filter((r) => !this._isLooping(r.target));
    if (filtered.length === 0) return;

    // 冷却期检测
    if (this.isThrottled) return;

    // 窗口限流检测
    const now = Date.now();
    if (now - this.windowStart > this.throttleWindow) {
      // 窗口过期，重置
      this.windowStart = now;
      this.attemptCount = 0;
    }

    this.attemptCount++;
    if (this.attemptCount > this.throttleMaxAttempts) {
      this._enterCooldown();
      return;
    }

    this.callback(filtered);
  }

  /**
   * 检测单个元素是否处于高频变更循环
   * @param {Node} node
   * @returns {boolean} true = 正在循环（应跳过）
   */
  _isLooping(node) {
    const last = this.elementChanges.get(node);
    const now = Date.now();
    if (!last || now - last.time > this.loopThreshold) {
      this.elementChanges.set(node, { count: 1, time: now });
      return false;
    }
    last.count++;
    last.time = now;
    return last.count > this.loopMaxCycles;
  }

  /**
   * 进入冷却期：暂停处理，定时恢复
   */
  _enterCooldown() {
    this.isThrottled = true;
    console.warn(`[AgentSkin] MutationObserver throttled for ${this.retryTimeout}ms`);
    this._throttleTimer = setTimeout(() => {
      this.isThrottled = false;
      this.attemptCount = 0;
      this.windowStart = Date.now();
      this._throttleTimer = null;
    }, this.retryTimeout);
  }
}

export default AdaptiveMutationObserver;
