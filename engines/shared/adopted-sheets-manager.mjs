/**
 * ADOPTED-SHEETS-MANAGER — 共享 Sheet 管理器
 * ============================================================
 * 集中管理 adoptedStyleSheets setter 拦截与 owned sheets 注册，
 * 使多 adapter 共存时 setter 只安装一次，owned sheets 统一管理。
 *
 * 解决 P1-7：6 个 adapter 各自独立 setter IIFE 导致 last-writer-wins、
 * owned 数组互相覆盖、同一 sheet 在多 adapter 重复注册的问题。
 *
 * 纯脚本（无 import/export）— 由主进程拼接在 adapter.mjs 之前，
 * 在 CDP Runtime.evaluate 上下文中执行，不可用 ES module 解析。
 *
 * IIFE + 幂等守卫（同 deep-core.mjs 模式）。
 *
 *   install()   幂等安装 setter 拦截；首次调用时捕获现有 __agentskin sheets
 *   adopt(sheet) 注册 adapter sheet 并确保出现在数组中
 *   release(sheet) 从 owned 集合注销 sheet（数组由宿主/其他逻辑管理）
 *   releaseAll() 还原原始 setter 与 owned 集合
 *
 * @agentskin-engine-keep-alive
 */

(function () {
  'use strict';

  if (window.__AGENTSKIN_SHEET_MANAGER_LOADED__) return;
  window.__AGENTSKIN_SHEET_MANAGER_LOADED__ = true;

  const owned = [];
  let installed = false;
  let savedDesc = null;
  let savedSet = null;

  function installDescriptor() {
    if (installed) return;
    const proto = Document.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'adoptedStyleSheets');
    if (!desc || !desc.configurable) return;
    savedDesc = desc;
    savedSet = desc.set;

    Object.defineProperty(proto, 'adoptedStyleSheets', {
      configurable: true,
      enumerable: false,
      get: desc.get,
      set: function (value) {
        const merged = Array.isArray(value) ? value.slice() : [];
        for (let i = 0; i < merged.length; i++) {
          const s = merged[i];
          if (s && s.__agentskin === true && owned.indexOf(s) === -1) {
            owned.push(s);
          }
        }
        for (let j = 0; j < owned.length; j++) {
          if (owned[j] && merged.indexOf(owned[j]) === -1) {
            merged.push(owned[j]);
          }
        }
        savedSet.call(this, merged);
      }
    });

    const existing = desc.get.call(document) || [];
    for (let i = 0; i < existing.length; i++) {
      const s = existing[i];
      if (s && s.__agentskin === true && owned.indexOf(s) === -1) {
        owned.push(s);
      }
    }

    installed = true;
    window.__agentskin_originalAdoptedSheetsDesc = savedDesc;
  }

  function adoptSheet(sheet) {
    if (!sheet || sheet.__agentskin !== true) return;
    if (!installed) installDescriptor();
    if (owned.indexOf(sheet) === -1) owned.push(sheet);
    try {
      const current = (savedDesc ? savedDesc.get.call(document) : document.adoptedStyleSheets) || [];
      if (current.indexOf(sheet) === -1) {
        const merged = current.filter(s => !(s && s.__agentskin === true && s.__agentskin_layer === sheet.__agentskin_layer));
        merged.push(sheet);
        document.adoptedStyleSheets = merged;
      }
    } catch {}
  }

  function releaseSheet(sheet) {
    const idx = owned.indexOf(sheet);
    if (idx !== -1) owned.splice(idx, 1);
  }

  function releaseAll() {
    if (savedDesc && savedSet) {
      try {
        Object.defineProperty(Document.prototype, 'adoptedStyleSheets', savedDesc);
      } catch {}
      const current = (savedDesc.get ? savedDesc.get.call(document) : document.adoptedStyleSheets) || [];
      const cleaned = current.filter(s => !(s && s.__agentskin === true && owned.indexOf(s) !== -1));
      try { savedSet.call(document, cleaned); } catch {}
    }
    owned.length = 0;
    installed = false;
    savedDesc = null;
    savedSet = null;
  }

  window.__agentskin_sheet_manager__ = {
    install: installDescriptor,
    adopt: adoptSheet,
    release: releaseSheet,
    releaseAll: releaseAll
  };
})();
