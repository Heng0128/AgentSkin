// SPDX-License-Identifier: MPL-2.0
import {
  sharedChromeRules,
  shellStructureCss,
  shellTokenOverrides,
  tokenBlock,
} from '../theme-utils.mjs';

function codexCss(t) {
  const host = 'html.agentskin-host-codex';
  return `/* ${t.name} — OpenAI Codex (--text-*/--bg-* design tokens) */
${tokenBlock(t)}

/* ===== Native token overrides ===== */
${shellTokenOverrides(host, t)}
${shellStructureCss(host, t)}
${sharedChromeRules(host, t)}`;
}

export default codexCss;
