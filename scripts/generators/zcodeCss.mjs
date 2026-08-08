// SPDX-License-Identifier: MPL-2.0
import { tokenBlock, shellTokenOverrides, shellStructureCss, sharedChromeRules } from '../theme-utils.mjs';

function zcodeCss(t) {
  const host = 'html.agentskin-host-zcode';
  return `/* ${t.name} — ZCode (generic --text-*/--bg-* design tokens) */
${tokenBlock(t)}

/* ===== Native token overrides (wins over :root[data-theme]) ===== */
${shellTokenOverrides(host, t)}
${shellStructureCss(host, t)}
${sharedChromeRules(host, t)}`;
}

export default zcodeCss;
