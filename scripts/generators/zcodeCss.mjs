// SPDX-License-Identifier: MPL-2.0

import { nativeDefectFixCss } from '../native-defect-fixes.mjs';
import {
  sharedChromeRules,
  shellStructureCss,
  shellTokenOverrides,
  tokenBlock,
  zcodeColorTokenOverrides,
} from '../theme-utils.mjs';

function zcodeCss(t) {
  const host = 'html.agentskin-host-zcode';
  return `/* ${t.name} — ZCode (--color-* Tailwind v4 native tokens + engine flat semantic layer) */
${tokenBlock(t)}

/* ===== Native token overrides (wins over :root[data-theme]) ===== */
${shellTokenOverrides(host, t)}
${zcodeColorTokenOverrides(host, t)}
${shellStructureCss(host, t)}
${sharedChromeRules(host, t)}

/* ---- native hardcoded visual defects (single source: ../native-defect-fixes.mjs) ----
   ZCode 没有独立的清除类缺陷规则（原生缺陷已由 token 覆盖 + 结构着色块消解）；
   注册表为空。今后若发现新缺陷，加入共享模块后即自动带上。 */
${nativeDefectFixCss('zcode', host)}
`;
}

export default zcodeCss;
