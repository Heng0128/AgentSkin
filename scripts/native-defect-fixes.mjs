// SPDX-License-Identifier: MPL-2.0
//
// # native-defect-fixes.mjs — single source of truth for "native hardcoded
// visual defect fixes".
//
// Every agent paints a few HARD-CODED visual defects that clash with the
// themed art surface: native square box-shadows on bubbles, sticky dark
// gradient fade masks, hardcoded grey/opaque bubble backgrounds. These must
// be neutralized. Historically these rules were hand-written TWICE — once in
// the theme generator (scripts/generators/<agent>Css.mjs) and once in the
// engine adapter (engines/<agent>/adapter.mjs) — so they drifted and new
// themes kept regressing.
//
// This module is the single source. Rules are theme-agnostic (props only use
// "clear" values like none/transparent, never theme colors), so the same
// registry can drive both the Node-side generator and the runtime adapter.
//
// See docs/rfc/2026-08-18-native-defect-fixes-consolidation.md

import { HOSTS } from './theme-utils.mjs';

/**
 * @typedef {Object} NativeDefectRule
 * @property {string} label  — stable identifier (e.g. 'chat-bubble-shadow')
 * @property {string} note   — one-line note on the native defect being fixed
 * @property {string[]} selectors — host-descendant selectors (no host prefix)
 * @property {string[]} props — "clear" declarations, e.g. 'box-shadow: none !important'
 */

/**
 * Registry of native-defect fixes, keyed by agent.
 * `props` MUST NOT inject theme colors — this must stay theme-agnostic.
 */
export const NATIVE_DEFECT_FIXES = {
  traework: [
    {
      label: 'chat-bubble-shadow',
      note: 'kill native squared box-shadow on chat bubbles',
      selectors: [
        '[class*="message-bubble"]',
        '[class*="messageBubble"]',
        '[class*="msg-bubble"]',
        '[class*="chat-bubble"]',
        '[class*="bubble"]',
        '[class*="message-content"]',
        '[class*="msg-content"]',
      ],
      props: ['box-shadow: none !important', 'outline: none !important'],
    },
    {
      label: 'user-message-surface',
      note: 'clear native grey rounded surface on the user-message text box',
      selectors: ['.user-message__text-box', '[class*="user-message__text-box"]'],
      props: [
        'background: transparent !important',
        'background-color: transparent !important',
        'background-image: none !important',
        'border-color: transparent !important',
      ],
    },
    {
      label: 'message-navigator-mask',
      note: 'remove native hardcoded fade-gradient mask over the message list',
      selectors: ['[class*="user-message-navigator__mask"]'],
      props: ['background-image: none !important', 'background: transparent !important'],
    },
  ],
  workbuddy: [
    {
      label: 'quick-actions-shadow',
      note: 'kill native side shadows on the recommendation chips above the input',
      selectors: [
        '.quick-actions',
        '.quick-actions__list',
        '[class*="quick-action"]:not(.quick-actions__item)',
      ],
      props: ['box-shadow: none !important', 'outline: none !important'],
    },
    {
      label: 'quick-actions-shadow-desc',
      note: 'kill stacked side shadows on descendants of the quick-action chips',
      selectors: ['.quick-actions *', '.quick-actions__list *'],
      props: ['box-shadow: none !important', 'outline: none !important'],
    },
  ],
  doubao: [
    {
      label: 'suggest-cards-shadow',
      note: 'kill native shadow/border effects on suggestion & topic cards',
      selectors: ['[class*="suggest"]', '[class*="recommend"]', '[class*="topic"]'],
      props: [
        'outline: none !important',
        'box-shadow: none !important',
        'border-image: none !important',
      ],
    },
    {
      label: 'suggest-cards-shadow-desc',
      note: 'kill stacked shadow/blur/border on suggested-card children',
      selectors: ['[class*="suggest"] *', '[class*="recommend"] *', '[class*="topic"] *'],
      props: [
        'border-color: transparent !important',
        'outline: none !important',
        'box-shadow: none !important',
        'backdrop-filter: none !important',
      ],
    },
  ],
  qoderwork: [],
  codex: [],
  zcode: [],
};

// Agents whose defect rules are embedded in color/glass blocks rather than
// independent clear-token rules have empty registries above. They still call
// nativeDefectFixCss() so any future rule added here is picked up automatically.

/** @returns {NativeDefectRule[]} The defect rules for an agent (empty array if none). */
export function getNativeDefectRules(agent) {
  return NATIVE_DEFECT_FIXES[agent] ?? [];
}

/**
 * Render the defect-fix CSS for an agent, scoped under `hostScope`
 * (defaults to the shared HOSTS mapping, see ./theme-utils.mjs).
 * @param {string} agent
 * @param {string} [hostScope]
 * @returns {string}
 */
export function nativeDefectFixCss(agent, hostScope = HOSTS[agent]) {
  const rules = getNativeDefectRules(agent);
  const prefix = hostScope ? `${hostScope} ` : '';
  const blocks = rules.map((rule) => {
    const selectors = rule.selectors.map((s) => `${prefix}${s}`).join(',\n');
    const props = rule.props.map((p) => `  ${p};`).join('\n');
    return `/* ---- ${rule.note} ---- */\n${selectors} {\n${props}\n}`;
  });
  return blocks.join('\n\n');
}
