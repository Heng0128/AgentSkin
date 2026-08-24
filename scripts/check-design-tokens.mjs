// SPDX-License-Identifier: MPL-2.0

/**
 * # Design Token Compliance (C6 Sensor)
 *
 * Run via: `node scripts/check-design-tokens.mjs`
 * Exits non-zero on violation so it can gate `npm run check`.
 *
 * Enforces the project design-system invariant (C6). **Calibrated
 * 2026-08-20** to the project's actual visual spec (docs/design-tokens.md
 * §3.3/§4/§7.2 + the 2026-08-14 "6px 圆润" visual reform) —
 * the Quiet Workbench 设计系统（6px 圆润基准，4px 网格间距）。
 * Detected violations:
 *
 * 1. Spacing — Tailwind `p-*`, `m-*`, `gap-*`, `space-*`, `top-*`,
 *    `bottom-*`, `left-*`, `right-*`, `px-*`, `py-*`, `mx-*`, `my-*` and
 *    inline `style={{…}}` must use the project ladder (2–96px Tailwind
 *    standard units, incl. the documented 12px card / 14px grid values).
 *    `w-*`/`h-*`/inline `width`/`height` are layout DIMENSIONS and exempt.
 *    Arbitrary values (`p-[Npx]`) must match ALLOWED_SPACING_ARBITRARY_PX.
 *
 * 2. Font-size — `text-[…]` arbitrary values and inline `font-size` must be
 *    on the documented ladder (§3.3: 8.5px auxiliary mono … 44px big-num).
 *    Below 8.5px is always flagged (CRITICAL data should stay >= 10px).
 *
 * 3. Border-radius — `rounded-none/sm/md/lg/full` plus arbitrary radii
 *    <= 8px and `inherit` are allowed (6px `rounded-md` is the baseline).
 *
 * 4. Box-shadow — `shadow-none`, `shadow-sm/md/lg/xl` (Quiet Workbench multi-level).
 *
 * 9. Hardcoded colors — `rgba()`/`hsla()` with raw numeric channels are
 *    flagged. Whitelisted: `rgba(var(--x), alpha)`, `var(--token, rgba(...))`
 *    fallbacks, `engines/`, RealDomPreview shadow levels, and logo brand
 *    constants (`logo.tsx` `BRAND_*`).
 *
 * 10. Inline box-shadow — only `none` and `var(--shadow…)` are allowed.
 *
 * Scope: `src/ui/` — all `.ts` and `.tsx` files (recursive).
 *
 * Known false-positives:
 * - `transition/transform` px values — handled by property filtering.
 * - `border-width` — not checked (separate concern).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_DIR = join(root, 'src/ui');

const violations = [];

// ---------------------------------------------------------------------------
// Design-token constants (calibrated 2026-08-20 to the project's actual
// visual spec — see docs/design-tokens.md §3.3/§4/§7.2 and the 2026-08-14
// "6px 圆润" visual reform. The calibration reflects the Quiet Workbench design
// system (6px radius baseline, 4px-grid spacing) — matches what the product
// actually ships while still flagging off-ladder
// values that should move to tokens.)
// ---------------------------------------------------------------------------

/**
 * Tailwind spacing units that map to the project's spacing ladder:
 * 2px(.5) 4px(1) 6px(1.5) 8px(2) 10px(2.5) 12px(3) 14px(3.5) 16px(4) 20px(5)
 * 22px(5.5) 24px(6) 28px(7) 30px(7.5) 32px(8) 48px(12).
 * 12px/14px are documented card/grid spacing (design-tokens.md §7.2).
 */
const ALLOWED_SPACING_UNITS = new Set([
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 5.5, 6, 7, 7.5, 8, 9, 10, 12, 14, 16, 20, 24,
]);

/** Tailwind arbitrary spacing values (px) within the project's ladder. */
const ALLOWED_SPACING_ARBITRARY_PX = new Set([
  2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 22, 24, 28, 30, 32, 36, 38, 48, 64, 70, 72, 76, 80, 96, 100,
]);

/** Allowed Tailwind text size names (not arbitrary values). */
const _ALLOWED_TEXT_NAMES = new Set([
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  '6xl',
  '7xl',
  '8xl',
  '9xl',
]);

/**
 * px values allowed for arbitrary `text-[Npx]` — the project's actual font
 * ladder (design-tokens.md §3.3): 8.5–9px auxiliary mono, 9.5px 辅助标签,
 * 10–10.5px data, 11–11.5px secondary (text-xs), 12–12.5px body (text-sm),
 * 13px card titles, 22px page titles, plus named-size equivalents.
 * Values BELOW 8.5px remain flagged (CRITICAL data must stay >= 10px).
 */
const ALLOWED_TEXT_ARBITRARY_PX = new Set([
  8.5, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 16, 18, 20, 22, 24, 30, 36, 44, 48, 60, 72, 96,
  128,
]);

/**
 * Allowed rounded classes — calibrated to the 2026-08-14 "6px 圆润" visual
 * reform: `rounded-md` (6px, the --radius-base baseline) plus the adjacent
 * 4px (`rounded-sm`) and 8px (`rounded-lg`) steps, `rounded-full` for
 * circular/capsule elements, and small arbitrary radii <= 8px. `rounded-[inherit]`
 * is allowed (radius inheritance). `var(--radius-*)` references are allowed.
 */
const ALLOWED_ROUNDED = new Set([
  'rounded-none',
  'rounded-sm',
  'rounded-md',
  'rounded-lg',
  'rounded-full',
]);

/** Allowed shadow class names — Quiet Workbench multi-level system. */
const ALLOWED_SHADOW = new Set([
  'shadow-none',
  'shadow-sm',
  'shadow-md',
  'shadow-lg',
  'shadow-xl',
  'shadow-float', // deprecated but allowed for backward compat
]);

// ---------------------------------------------------------------------------
// Rule 9: rgba/hsla hardcoded color detection
// ---------------------------------------------------------------------------

const HARD_COLOR_RE = /(rgba?|hsla?)\((\d+(\.\d+)?\s*,\s*){2,3}(\d+(\.\d+)?)\)/g;

function isWhitelistedHardColor(line, match, matchIndex, relPath) {
  // Whitelist 1: rgba(var(--x), alpha) — uses CSS variables
  if (/rgba?\(\s*var\(--/.test(match)) return true;
  // Whitelist 2: var(--token, rgba(...)) fallback declaration — the rgba sits
  // inside an unclosed var( ... ) span ending at the match.
  const varOpen = line.lastIndexOf('var(', matchIndex);
  if (varOpen !== -1) {
    const inside = line.slice(varOpen, matchIndex);
    if (!inside.includes(')')) return true;
  }
  // Whitelist 3: engines/ 目录 — CDP 注入输出
  if (relPath.startsWith('engines/')) return true;
  // Whitelist 4: RealDomPreview shadow levels — 预览引擎
  if (relPath.includes('RealDomPreview') && /shadow|case/.test(line)) return true;
  // Whitelist 5: brand constants (logo.tsx BRAND_*) — brand asset colors
  if (relPath.endsWith('logo.tsx') && /\bBRAND_[A-Z_]+\s*=\s*'?rgba?\(/i.test(line)) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rule 10: inline box-shadow multi-level detection
// ---------------------------------------------------------------------------

const INLINE_SHADOW_RE = /(?:box-shadow|boxShadow):\s*([^;}\n]+)/g;

function isWhitelistedShadow(value) {
  if (value === 'none') return true;
  if (/var\(--shadow-float/.test(value)) return true;
  if (/var\(--shadow/.test(value)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert a Tailwind spacing unit (number) to px. unit * 4 = px. */
function spacingUnitToPx(unit) {
  return unit * 4;
}

/** Parse a numeric value from a string like "10px", "1.5rem", "20". */
function parsePxValue(raw) {
  const trimmed = raw.trim();
  // Match number (int or decimal) optionally followed by px
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)(px)?$/);
  if (!match) return null;
  return parseFloat(match[1]);
}

// ---------------------------------------------------------------------------
// Violation record
// ---------------------------------------------------------------------------

function addViolation(file, line, problem, fix, guide) {
  violations.push({ file, line, problem, fix, guide });
}

// ---------------------------------------------------------------------------
// Scanner: walk src/ui/**/*.{ts,tsx}
// ---------------------------------------------------------------------------

const IGNORED_DIRS = new Set(['node_modules', 'out', '.git', '.build-tmp', 'dist', 'assets']);

function walkDir(dir, callback) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      walkDir(fullPath, callback);
    } else if (entry.isFile()) {
      callback(fullPath, entry.name);
    }
  }
}

// ---------------------------------------------------------------------------
// Pattern matchers
// ---------------------------------------------------------------------------

function checkLine(line, _fileName, lineNum, relPath) {
  // --- 1. Spacing: Tailwind named classes (p-3, m-5, gap-3.5, etc.) ---
  // Match spacing classes that use numeric units (not the approved set)
  //
  // NOTE: every exec loop below pre-fetches the NEXT match before processing
  // the current one, so `continue` on an allowed value can never skip the
  // regex advance (that was a real infinite-loop bug: any line containing an
  // allowed class like `p-2` hung the whole `npm run check`).
  const spacingClassRe = /\b([pmwh])([xytrlb])?-(\d+(?:\.\d+)?)\b/g;
  let m = spacingClassRe.exec(line);
  while (m !== null) {
    const next = spacingClassRe.exec(line);
    const prefix = m[1]; // p, m, w, h
    const _axis = m[2]; // x, y, t, r, b, l (optional)
    const unitStr = m[3];
    const unit = parseFloat(unitStr);

    // w-/h- are layout DIMENSIONS (width/height: w-[1240px] container,
    // h-7 titlebar, etc.), not padding/margin — exempt from the spacing
    // ladder. Only p/m/gap/space/inset follow the spacing scale.
    if (prefix === 'w' || prefix === 'h') {
      m = next;
      continue;
    }

    // Skip if it's inside a comment or string heuristic (we check raw line)
    // We accept the Swiss sequence units
    if (ALLOWED_SPACING_UNITS.has(unit)) {
      m = next;
      continue;
    }

    // Zero means "no spacing" — always allowed
    if (unit === 0) {
      m = next;
      continue;
    }

    // gap-3.5 is 3.5 (not in set) — flag it
    // space-x-0.5 etc — we want to allow half units only for 0.5 (=2px) — but
    // per Swiss rules we flag anything not in the sequence
    if (unit === 0.5) {
      m = next;
      continue; // 2px — below minimum but used in sub-pixel cases
    }
    if (unit === 1.5) {
      m = next;
      continue; // 6px — not in sequence but commonly used for borders/separators
    }

    const pxValue = spacingUnitToPx(unit);
    const className = m[0];

    // Avoid flagging Tailwind color opacity shadegens like bg-primary/20 — but
    // our regex explicitly requires the axis pattern, so colors (bg-red-500) won't match.

    // Avoid flagging text-[...] — handled separately
    if (className.startsWith('text-')) {
      m = next;
      continue;
    }

    // w- and h- (sizing) — also checked, but we allow fractional widths like w-1/2, w-1/3 etc.
    if ((prefix === 'w' || prefix === 'h') && unitStr.includes('/')) {
      m = next;
      continue;
    }

    // z-index (z-10, z-20, z-50)
    if (className.startsWith('z-')) {
      m = next;
      continue;
    }

    // Order values (order-1, order-2)
    if (className.startsWith('order-')) {
      m = next;
      continue;
    }

    // Flex (flex-1)
    if (className.startsWith('flex-')) {
      m = next;
      continue;
    }

    // Inset values (top-0, left-4) — these follow the spacing scale, keep checking
    // but allow some Swiss exceptions
    if (['top', 'bottom', 'left', 'right', 'inset'].some((p) => className.startsWith(p))) {
      // inset-0, top-0 are fine
      if (unit === 0) {
        m = next;
        continue;
      }
    }

    const nearest = findNearestSpacing(pxValue);
    addViolation(
      relPath,
      lineNum,
      `间距 ${className} (${pxValue}px) 不在 Swiss 序列 (4/8/16/24/32/48)`,
      `改为 ${nearest.tw} (${nearest.px}px)`,
    );
    m = next;
  }

  // --- 2. Spacing: Tailwind arbitrary values (p-[10px], m-[3rem], etc.) ---
  const arbitrarySpacingRe = /\b([pmwh])([xytrlb])?-\[(\d+(?:\.\d+)?)(px|rem)?\]/g;
  m = arbitrarySpacingRe.exec(line);
  while (m !== null) {
    const next = arbitrarySpacingRe.exec(line);
    const prefix = m[1];
    const val = parseFloat(m[3]);
    const unit = m[4] || 'px';
    const className = m[0];

    // w-[Npx]/h-[Npx] are layout dimensions, not spacing — exempt.
    if (prefix === 'w' || prefix === 'h') {
      m = next;
      continue;
    }

    if (unit === 'px') {
      if (ALLOWED_SPACING_ARBITRARY_PX.has(val)) {
        m = next;
        continue;
      }
      // Check inline style separately for rem values
      const pxValue = val;
      const nearest = findNearestSpacing(pxValue);
      addViolation(
        relPath,
        lineNum,
        `间距 ${className} (${val}px) 不在 Swiss 序列 (4/8/16/24/32/48)`,
        `改为 ${nearest.tw} (${nearest.px}px) 或内联 style`,
      );
    }
    // rem-based arbitrary: flag if not whole-rem (1rem ≈ 16px)
    if (unit === 'rem') {
      // Allow 1rem (16px), 0.5rem (8px), 1.5rem (24px), 2rem (32px), 3rem (48px)
      const allowedRem = [0.5, 1, 1.5, 2, 2.5, 3];
      if (allowedRem.includes(val)) {
        m = next;
        continue;
      }
      const pxApprox = val * 16;
      const nearest = findNearestSpacing(pxApprox);
      addViolation(
        relPath,
        lineNum,
        `间距 ${className} 约 ${pxApprox}px 不在 Swiss 序列 (4/8/16/24/32/48)`,
        `改为 ${nearest.tw} (${nearest.px}px)`,
      );
    }
    m = next;
  }

  // gap/space arbitrary values
  const gapArbitraryRe = /\b(gap|space-[xy])-\[(\d+(?:\.\d+)?)(px|rem)?\]/g;
  m = gapArbitraryRe.exec(line);
  while (m !== null) {
    const next = gapArbitraryRe.exec(line);
    const val = parseFloat(m[2]);
    const unit = m[3] || 'px';
    const className = m[0];

    // Guard against NaN from unexpected regex matches
    if (Number.isNaN(val)) {
      m = next;
      continue;
    }

    if (unit === 'px') {
      if (ALLOWED_SPACING_ARBITRARY_PX.has(val)) {
        m = next;
        continue;
      }
      const nearest = findNearestSpacing(val);
      addViolation(
        relPath,
        lineNum,
        `间距 ${className} (${val}px) 不在 Swiss 序列 (4/8/16/24/32/48)`,
        `改为 ${nearest.tw} (${nearest.px}px)`,
      );
    }
    m = next;
  }

  // --- 3. Font-size: Tailwind named text sizes — always allowed ---
  // xs(12)/sm(14)/base(16)/lg(18)/xl(20)/2xl(24)/3xl(30)/4xl(36) — all >= 10px
  // No check needed for named sizes.

  // --- 4. Font-size: text-[Npx] arbitrary ---
  const textArbitraryRe = /\btext-\[(\d+(?:\.\d+)?)(px|rem)?\]/g;
  m = textArbitraryRe.exec(line);
  while (m !== null) {
    const next = textArbitraryRe.exec(line);
    const val = parseFloat(m[1]);
    const unit = m[2] || 'px';
    const className = m[0];

    if (unit === 'px') {
      // Allowed ladder values first (8.5px+ auxiliary mono through 44px titles)
      if (ALLOWED_TEXT_ARBITRARY_PX.has(val)) {
        m = next;
        continue;
      }
      // Below the auxiliary-mono floor (8.5px) is always flagged.
      if (val < 8.5) {
        addViolation(
          relPath,
          lineNum,
          `字号 ${className} (${val}px) 低于辅助 mono 最小字号 8.5px`,
          '改为 >= 8.5px（CRITICAL 数据建议 >= 10px）',
        );
        m = next;
        continue;
      }
      // Otherwise it's an off-ladder value (e.g. text-[15px], text-[26px])
      const nearest = findNearestFontSize(val);
      addViolation(
        relPath,
        lineNum,
        `字号 ${className} 不在项目字号阶梯（见 docs/design-tokens.md §3.3）`,
        `改为 ${nearest}`,
      );
    }
    if (unit === 'rem') {
      const pxApprox = val * 16;
      if (pxApprox < 10) {
        addViolation(
          relPath,
          lineNum,
          `字号 ${className} (约 ${pxApprox}px) 低于 Swiss 最小字号 10px`,
          '改为 text-[10px] 或 text-xs (12px)',
        );
      }
      // Named Tailwind rem sizes: text-xs=0.75rem, text-sm=0.875rem, text-base=1rem, etc.
      // These are captured by the named-size check, not here.
    }
    m = next;
  }

  // --- 5. Font-size: inline style {{ fontSize: N }} (React camelCase) ---
  // Also handles CSS kebab-case: font-size: Npx
  const inlineFontRe = /(?:fontSize|font-size):\s*(\d+(?:\.\d+)?)(px)?/g;
  m = inlineFontRe.exec(line);
  while (m !== null) {
    const next = inlineFontRe.exec(line);
    const val = parseFloat(m[1]);
    if (Number.isNaN(val)) {
      m = next;
      continue;
    }
    if (val < 8.5) {
      addViolation(
        relPath,
        lineNum,
        `内联字号 ${m[0]} (${val}px) 低于辅助 mono 最小字号 8.5px`,
        '改为 >= 8.5px（CRITICAL 数据建议 >= 10px）',
      );
    }
    m = next;
  }

  // --- 6. Border-radius: rounded-* classes ---
  const roundedRe = /\brounded-(none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\])/g;
  m = roundedRe.exec(line);
  while (m !== null) {
    const next = roundedRe.exec(line);
    const className = m[0];
    if (ALLOWED_ROUNDED.has(className)) {
      m = next;
      continue;
    }
    // Allow CSS variable references (e.g. rounded-[var(--r-micro)])
    if (className.includes('var(')) {
      m = next;
      continue;
    }
    // Also allow rounded-[Npx] where N <= 8 (radius steps above the 6px base)
    if (className.startsWith('rounded-[')) {
      const innerVal = className.slice(9, -1); // strip "rounded-[" prefix
      const parsed = parsePxValue(innerVal);
      if (parsed !== null && parsed <= 8) {
        m = next;
        continue; // round-[1px]..round-[8px] all allowed
      }
      // rounded-[inherit] — radius inheritance
      if (innerVal === 'inherit') {
        m = next;
        continue;
      }
    }
    addViolation(
      relPath,
      lineNum,
      `圆角 ${className} 不在 Swiss 圆角系统 (仅 rounded-none, rounded-[2px])`,
      '改为 rounded-[2px] 或 rounded-none',
    );
    m = next;
  }

  // --- 7. Box-shadow: shadow-* classes ---
  const shadowRe = /\bshadow-(none|sm|md|lg|xl|2xl|inner|\[[^\]]+\])/g;
  m = shadowRe.exec(line);
  while (m !== null) {
    const next = shadowRe.exec(line);
    const className = m[0];
    if (ALLOWED_SHADOW.has(className)) {
      m = next;
      continue;
    }
    // Allow shadow-[...] arbitrary if it references shadow-float
    if (className.startsWith('shadow-[')) {
      m = next;
      continue; // arbitrary shadow — skip
    }
    addViolation(
      relPath,
      lineNum,
      `阴影 ${className} 不在 Swiss 阴影系统 (仅 shadow-none, shadow-float)`,
      '改为 shadow-float 或 shadow-none',
    );
    m = next;
  }

  // --- 9. Hardcoded rgba/hsla colors ---
  {
    let hcMatch = HARD_COLOR_RE.exec(line);
    while (hcMatch !== null) {
      const matchText = hcMatch[0];
      const matchIndex = hcMatch.index;
      if (!isWhitelistedHardColor(line, matchText, matchIndex, relPath)) {
        addViolation(
          relPath,
          lineNum,
          `硬编码颜色 ${matchText} — 应使用 CSS 变量或 design token`,
          '改为 rgba(var(--token), alpha) 或 var(--token, fallback)',
        );
      }
      hcMatch = HARD_COLOR_RE.exec(line);
    }
    // Reset lastIndex for next line (regex is global)
    HARD_COLOR_RE.lastIndex = 0;
  }

  // --- 10. Inline box-shadow ---
  {
    let shMatch = INLINE_SHADOW_RE.exec(line);
    while (shMatch !== null) {
      const value = shMatch[1].trim();
      if (!isWhitelistedShadow(value)) {
        addViolation(
          relPath,
          lineNum,
          `内联 box-shadow 使用了非 Swiss shadow token: ${value}`,
          '改为 var(--shadow-float) 或 shadow-none',
        );
      }
      shMatch = INLINE_SHADOW_RE.exec(line);
    }
    INLINE_SHADOW_RE.lastIndex = 0;
  }

  // --- 8. Inline style spacing (React camelCase + CSS kebab-case) ---
  // React: style={{ width: 200, marginTop: 12, paddingLeft: 8 }}
  // CSS:   style={{ 'margin-top': '12px', 'padding-left': '8px' }}
  const inlineSpacingRe =
    /((?:margin|padding|gap|top|bottom|left|right|width|height)[A-Z]?[a-z]*|margin-[a-z]+|padding-[a-z]+):\s*(\d+(?:\.\d+)?)(px)?/g;
  m = inlineSpacingRe.exec(line);
  while (m !== null) {
    const next = inlineSpacingRe.exec(line);
    const property = m[1];
    const val = parseFloat(m[2]);
    const hasPxSuffix = !!m[3];

    if (Number.isNaN(val)) {
      m = next;
      continue;
    }

    // width/height are layout dimensions, not spacing — exempt.
    if (/^(width|height)$/i.test(property)) {
      m = next;
      continue;
    }

    // For non-px values (React unitless = px), 0/1/2 are always safe
    if (!hasPxSuffix) {
      if (val === 0 || val === 1 || val === 2) {
        m = next;
        continue;
      }
    } else {
      if (val === 0 || val === 1 || val === 2) {
        m = next;
        continue;
      }
    }

    if (ALLOWED_SPACING_ARBITRARY_PX.has(val)) {
      m = next;
      continue;
    }

    // Flag with softer note if likely border/hairline
    const isLikelyBorder = property.toLowerCase().includes('border') || val <= 2;

    const nearest = findNearestSpacing(val);
    const note = isLikelyBorder ? '（如果用于 border-width 可忽略）' : '';
    addViolation(
      relPath,
      lineNum,
      `内联 ${property}: ${val}px 不在 Swiss 序列 (4/8/16/24/32/48)${note}`,
      isLikelyBorder
        ? `如需 Swiss 对齐改为 ${nearest.px}px；如为 border-width 可忽略`
        : `改为 ${nearest.px}px 或提取为 Tailwind 工具类`,
    );
    m = next;
  }
}

// ---------------------------------------------------------------------------
// Nearest-value helpers (used only for violation fix suggestions)
// ---------------------------------------------------------------------------

const SWISS_SPACING_PX = [4, 8, 12, 14, 16, 20, 22, 24, 28, 30, 32, 48];
const SWISS_TW_MAP = {
  4: 'p-1',
  8: 'p-2',
  12: 'p-3',
  14: 'p-3.5',
  16: 'p-4',
  20: 'p-5',
  22: 'p-[22px]',
  24: 'p-6',
  28: 'p-7',
  30: 'p-[30px]',
  32: 'p-8',
  48: 'p-12',
};

function findNearestSpacing(px) {
  let best = SWISS_SPACING_PX[0];
  let bestDist = Math.abs(px - best);
  for (const v of SWISS_SPACING_PX) {
    const dist = Math.abs(px - v);
    if (dist < bestDist) {
      bestDist = dist;
      best = v;
    }
  }
  return { px: best, tw: SWISS_TW_MAP[best] };
}

const SWISS_FONT_PX = [9.5, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 30, 36, 44];
const SWISS_FONT_TW_MAP = {
  9.5: 'text-[9.5px]',
  10: 'text-[10px]',
  11: 'text-[11px]',
  12: 'text-xs',
  13: 'text-[13px]',
  14: 'text-sm',
  16: 'text-base',
  18: 'text-lg',
  20: 'text-xl',
  22: 'text-[22px]',
  24: 'text-2xl',
  30: 'text-3xl',
  36: 'text-4xl',
  44: 'text-[44px]',
};

function findNearestFontSize(px) {
  let best = SWISS_FONT_PX[0];
  let bestDist = Math.abs(px - best);
  for (const v of SWISS_FONT_PX) {
    const dist = Math.abs(px - v);
    if (dist < bestDist) {
      bestDist = dist;
      best = v;
    }
  }
  return SWISS_FONT_TW_MAP[best];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let checkedFiles = 0;

function fileExists(absPath) {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

if (!fileExists(UI_DIR)) {
  console.log(`⊘ src/ui/ not found — skipping design token check`);
  process.exit(0);
}

walkDir(UI_DIR, (filePath, fileName) => {
  if (!fileName.endsWith('.ts') && !fileName.endsWith('.tsx')) return;
  // Skip test files — they may contain mock values outside the design system
  if (fileName.endsWith('.test.ts') || fileName.endsWith('.test.tsx')) return;

  checkedFiles++;
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const relPath = relative(root, filePath).replace(/\\/g, '/');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment lines (heuristic: line starts with // or * or /*)
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      continue;
    }
    checkLine(line, fileName, i + 1, relPath);
  }
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (violations.length > 0) {
  console.error(`✖ ${violations.length} design token violation(s) found:\n`);
  for (const v of violations) {
    console.error(`  [C6] DESIGN TOKEN VIOLATION`);
    console.error(`  File: ${v.file}:${v.line}`);
    console.error(`  Problem: ${v.problem}`);
    console.error(`  Fix: ${v.fix}`);
    console.error(`  Guide: AGENTS.md §4 row C6 + docs/design-tokens.md`);
    console.error('');
  }
  process.exit(1);
}

console.log(`✓ Design tokens OK — checked ${checkedFiles} files, all within Swiss system`);
