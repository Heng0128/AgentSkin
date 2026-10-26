// SPDX-License-Identifier: MPL-2.0

/**
 * # CSS Class Contract (C13 sensor)
 *
 * Run via: `node scripts/check-css-classes.mjs`
 * Exits non-zero when a class name USED BY THE SOURCE produces NO RULE in the
 * built CSS, or when a CSS selector is duplicated in a way that can silently
 * drop declarations.
 *
 * Why this exists: Tailwind v4 emits a utility only if the class string is
 * found while scanning sources AND the class resolves against a real theme
 * namespace. A token declared in the WRONG namespace therefore yields a class
 * name that compiles to nothing — the element silently keeps the inherited
 * value. Six such families were found by hand (docs/design-tokens.md
 * §13.2 #11–#13, #18–#19): `text-micro` (57 uses), `duration-base|fast|slow|
 * slower` (87 uses), `shadow-elev2` (6 uses), `animate-indeterminate`,
 * `bg-cr-primary`. No earlier sensor caught them.
 *
 * Truth source is the BUILT ARTIFACT, never reasoning about what Tailwind
 * "should" generate — string-counting the Tailwind dist is unreliable
 * (measured: `--ease-` occurs 0 times in the dist yet `.ease-spring` is
 * emitted correctly).
 *
 * Modes:
 *   node scripts/check-css-classes.mjs            # check
 *   node scripts/check-css-classes.mjs --json     # machine-readable
 *   node scripts/check-css-classes.mjs --update   # accept current findings
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'css-classes.baseline.json');
const ASSETS = join(ROOT, 'out', 'renderer', 'assets');
const UPDATE = process.argv.includes('--update');
const JSON_OUT = process.argv.includes('--json');

/* ------------------------------------------------------------------ *
 * 1. The artifact side: every class that actually has a rule
 * ------------------------------------------------------------------ */

function findArtifact() {
  if (!existsSync(ASSETS)) return null;
  // Every emitted stylesheet counts: the main window ships globals-*.css while
  // the Studio window ships studio-*.css, and Studio-only BEM classes
  // (ws-drawer__*, pw__*) live in the latter. Reading only globals-*.css
  // reports those as dead, which is wrong.
  const files = readdirSync(ASSETS).filter(
    (f) => f.endsWith('.css') && !/^vendor-.*\.css$/.test(f),
  );
  if (files.length === 0) return null;
  files.sort((a, b) => statSync(join(ASSETS, b)).mtimeMs - statSync(join(ASSETS, a)).mtimeMs);
  return files.map((f) => join(ASSETS, f));
}

/**
 * Newest mtime among the files Tailwind actually compiles. An artifact older
 * than one of these does NOT describe the current source, so a green result
 * would be a lie. This is not hypothetical: a FAILED `npm run build` leaves
 * out/ untouched, and this sensor then grades the stale CSS and reports
 * "pass" — observed during development of this very script.
 */
function newestSourceMtime() {
  let newest = 0;
  let culprit = '';
  (function walk(dir) {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(?:tsx?|css|html)$/.test(e.name)) continue;
      const m = statSync(p).mtimeMs;
      if (m > newest) {
        newest = m;
        culprit = p.slice(ROOT.length + 1).replaceAll('\\', '/');
      }
    }
  })(join(ROOT, 'src'));
  return { newest, culprit };
}

/** Characters that end a class name inside a selector (unescaped). */
const NAME_END = ':.[({,>+)~ \t\n"\'*=#%&|!';

/** Pull all `.`-prefixed names out of one selector, honouring `\` escapes. */
function namesInSelector(sel, out) {
  for (let i = 0; i < sel.length; i += 1) {
    if (sel[i] !== '.') continue;
    let name = '';
    let j = i + 1;
    for (; j < sel.length; j += 1) {
      const ch = sel[j];
      if (ch === '\\') {
        if (sel[j + 1] === undefined) break;
        name += sel[j + 1];
        j += 1;
        continue;
      }
      if (NAME_END.includes(ch)) break;
      name += ch;
    }
    if (name) out.add(name);
    /* Park i ON the NAME_END char (not past it): for compound selectors like
       `.status-dot.good` the char that ended `status-dot` IS the `.` that
       starts `good`. Parking past it (i = j) skipped every second segment of
       a compound selector, so `.x.y`'s `y` was never counted as emitted and
       real usages of chained utility classes were reported as dead. */
    i = j - 1;
  }
}

/**
 * Walk the CSS and treat the text immediately preceding each `{` as a
 * selector (or at-rule prelude). This is what makes the scan correct for
 * minified output, where a rule starts right after the previous rule's `}`.
 */
function extractDefinedClasses(css) {
  const found = new Set();
  let buf = '';
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === '{') {
      namesInSelector(buf, found);
      buf = '';
    } else if (ch === '}' || ch === ';') {
      buf = '';
    } else {
      buf += ch;
      if (buf.length > 4000) buf = '';
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * 2. The source side: every class the source actually asks for
 * ------------------------------------------------------------------ */

const SCAN_DIRS = ['src/ui', 'src/main', 'src/preload', 'src/shared'];
const SCAN_EXT = ['.tsx', '.ts', '.html'];

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.includes('.test.')) continue;
    else if (SCAN_EXT.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

/** Utility-ish shape; rejects prose, numbers, JS identifiers. */
const UTILITY_SHAPE = /^[!\w[][\w!:/[\]().,%#<>+*~-]*$/;

function addTokens(used, file, body) {
  if (!body) return;
  for (const tok of body.split(/\s+/)) {
    if (!tok || !UTILITY_SHAPE.test(tok)) continue;
    if (tok.includes('${') || tok.includes('\x00')) continue;
    // A trailing dash is a dynamic fragment (`size-${n}`, `text-${tone}`);
    // it cannot be judged statically.
    if (tok.endsWith('-')) continue;
    // Marker classes carry no declaration of their own — they exist purely so
    // `group-hover/badge:` / `peer-checked:` variants can reference them, so
    // they never appear as a rule in the artifact. Not dead code.
    if (/^(?:group|peer)(?:\/[\w-]+)?$/.test(tok)) continue;
    if (!used.has(tok)) used.set(tok, new Set());
    used.get(tok).add(file);
  }
}

/** All string/template literals in a chunk, with cva object keys blanked out. */
function literals(chunk) {
  const safe = chunk.replace(/(['"])([^'"\n]*)\1(\s*:)/g, (_m, _q, key) => `\x00${key}\x00:`);
  const out = [];
  for (const m of safe.matchAll(/(['"`])([^'"`]*)\1/g)) out.push(m[2]);
  return out;
}

/**
 * Blank out string literals that are the VALUE of a known non-class property
 * (`{ variant: 'destructive', size: 'sm' }`), while KEEPING class values that
 * legitimately live inside braces in a cva definition (`{ sm: 'h-8 px-2' }`).
 *
 * The earlier approach — strip every `{...}` — was rejected: it silently drops
 * every class written as a cva variant value, which is exactly the pattern
 * `ui/button.tsx` and `ui/pagination.tsx` use most.
 */
const NON_CLASS_KEY =
  /(?:\b|['"])(?:variant|size|type|side|position|align|role|name|id|key|tone|status|state|scheme|target|kind|action|event|channel|topic|label|title|placeholder|idProp)(['"]?)\s*:\s*(['"`])[^'"`]*\2/g;

/**
 * Blank out string literals that are the operand of an equality comparison
 * (`state === 'launching'`, `'idle' !== mode`). A compared value is runtime
 * data, never a class list — but the literal collector would otherwise count
 * it as a "used class" that the CSS artifact can never emit (real case:
 * AppCard's `state === 'launching'` reported `launching` as never-emitted).
 */
const EQUALITY_OPERAND =
  /(?:===|==|!==|!=)\s*(['"`])[^'"`]*\1|(['"`])[^'"`]*\2\s*(?:===|==|!==|!=)/g;

function blankNonClassValues(chunk) {
  return chunk
    .replace(EQUALITY_OPERAND, (m) => ' '.repeat(m.length))
    .replace(NON_CLASS_KEY, (_m, _q1, _q2) => ' '.repeat(_m.length));
}

/**
 * Net `(` minus `)` of a line, ignoring parens inside string literals —
 * class names legitimately contain them (`[&_svg:not([class*='size-'])]`).
 */
function parenBalance(chunk) {
  const stripped = chunk.replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, "''");
  let bal = 0;
  for (const ch of stripped) {
    if (ch === '(') bal += 1;
    else if (ch === ')') bal -= 1;
  }
  return bal;
}

function collectUsedClasses() {
  const used = new Map();
  const files = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);

  for (const abs of files) {
    const rel = abs.slice(ROOT.length + 1).replaceAll('\\', '/');
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    let attrDepth = 0; // >0 while inside a multi-line className={...}
    let cvaDepth = 0; // >0 while inside a multi-line cva()/tv() definition
    for (const line of lines) {
      // A cva() definition spans many lines and its variant VALUES are the
      // classes (`sm: 'h-7 gap-1.5 …'`). Scanning only the line holding `cva(`
      // misses every one of them — measured: a dead class injected into
      // ui/button.tsx's `icon:` variant went unreported until this tracker
      // existed.
      if (cvaDepth > 0) {
        for (const lit of literals(blankNonClassValues(line))) addTokens(used, rel, lit);
        cvaDepth += parenBalance(line);
        if (cvaDepth < 0) cvaDepth = 0;
        continue;
      }
      const cvaStart = /\b(?:cva|tv)\s*\(/.exec(line);
      if (cvaStart) {
        const rest = line.slice(cvaStart.index);
        for (const lit of literals(blankNonClassValues(rest))) addTokens(used, rel, lit);
        cvaDepth = Math.max(0, parenBalance(rest));
        continue;
      }

      if (attrDepth > 0) {
        for (const lit of literals(blankNonClassValues(line))) addTokens(used, rel, lit);
        for (const ch of line) {
          if (ch === '{') attrDepth += 1;
          else if (ch === '}') attrDepth -= 1;
          if (attrDepth === 0) break;
        }
        continue;
      }

      // className="..." / class="..."  → only that literal.
      for (const m of line.matchAll(/\b(?:className|class)\s*=\s*"([^"]*)"/g)) {
        addTokens(used, rel, m[1]);
      }
      // className={ ... }  → every literal from the brace onward.
      const jsxAttr = /\b(?:className|class)\s*=\s*\{/.exec(line);
      if (jsxAttr) {
        const rest = line.slice(jsxAttr.index + jsxAttr[0].length);
        for (const lit of literals(blankNonClassValues(rest))) addTokens(used, rel, lit);
        attrDepth = 1;
        for (const ch of rest) {
          if (ch === '{') attrDepth += 1;
          else if (ch === '}') attrDepth -= 1;
        }
        if (attrDepth <= 0) attrDepth = 0;
        continue;
      }
      // cn(...) / clsx(...) / twMerge(...) calls → class lists.
      // (cva/tv are handled by the depth tracker above.)
      const fn = /\b(?:cn|clsx|twMerge|tw-merge)\s*\(/.exec(line);
      if (fn) {
        for (const lit of literals(blankNonClassValues(line.slice(fn.index))))
          addTokens(used, rel, lit);
      }
    }
  }
  return used;
}

/* ------------------------------------------------------------------ *
 * 3. Baseline of accepted findings
 * ------------------------------------------------------------------ */

function loadBaseline() {
  if (!existsSync(BASELINE)) return { dead: {}, dupSelectors: {} };
  try {
    return JSON.parse(readFileSync(BASELINE, 'utf8'));
  } catch {
    return { dead: {}, dupSelectors: {} };
  }
}

/* ------------------------------------------------------------------ *
 * 4. Duplicate-selector census
 * ------------------------------------------------------------------ */

/**
 * Matches element and wildcard selectors too. A census restricted to selectors
 * starting with `.` or `#` misses `:root`, `*`, `html`, `body`, `*::before` —
 * precisely where the silent-loss risk lives (see §13.2 #17).
 * Grouping includes the enclosing at-rule, so a `prefers-reduced-motion`
 * override is not reported as a duplicate of the base rule.
 */
function duplicateSelectors(cssFiles) {
  const groups = new Map();
  for (const file of cssFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const ctxStack = [];
    let depth = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (!line) continue;
      if (/^@(media|supports|layer|container)/.test(line))
        ctxStack.push(line.replace(/\{.*$/, '').trim());
      const m = line.match(/^([^{};]+)\{\s*$/);
      if (m) {
        const sel = m[1].replace(/\s+/g, ' ').trim();
        if (sel && !sel.startsWith('@') && !/^(from|to|\d+(\.\d+)?%)$/.test(sel)) {
          const key = `${sel} @@ ${ctxStack.join(' > ') || '-'}`;
          if (!groups.has(key)) groups.set(key, []);
          groups
            .get(key)
            .push({ file: file.slice(ROOT.length + 1).replaceAll('\\', '/'), line: i + 1 });
        }
      }
      for (const ch of line) {
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0 && ctxStack.length) ctxStack.pop();
        }
      }
    }
  }
  return [...groups.entries()]
    .filter(([, occ]) => occ.length > 1)
    .map(([key, occ]) => ({
      selector: key.split(' @@ ')[0],
      ctx: key.split(' @@ ').slice(1).join(' @@ '),
      occurrences: occ,
    }));
}

/* ------------------------------------------------------------------ *
 * 5. Main
 * ------------------------------------------------------------------ */

const REQUIRE = process.argv.includes('--require-artifact');

const artifacts = findArtifact();
if (!artifacts) {
  if (REQUIRE) {
    console.error('[css-classes] ✖ --require-artifact: no built CSS at out/renderer/assets/*.css.');
    console.error(
      '[css-classes]   the guard is vacuous without an artifact — run `npm run build`.',
    );
    process.exit(1);
  }
  console.log('[css-classes] SKIP — no built CSS at out/renderer/assets/*.css');
  console.log(
    '[css-classes]   run `npm run build` first; this sensor compares against the artifact',
  );
  process.exit(0);
}

// A stale artifact is worse than none: it looks like a verdict. Refuse to
// write a baseline from it, and fail outright when the caller asked for a
// guarantee (CI). A plain local run still gets the comparison — it catches
// most drift — but never silently, and never as a snapshot.
const srcNewest = newestSourceMtime();
const artifactOldest = Math.min(...artifacts.map((p) => statSync(p).mtimeMs));
const stale = srcNewest.newest > artifactOldest;
if (stale) {
  console.warn(
    `[css-classes] ⚠ artifact is OLDER than source — ${srcNewest.culprit} was modified after out/ was built.`,
  );
  console.warn(
    '[css-classes] ⚠ results below describe the PREVIOUS build, not this working tree. Run `npm run build`.',
  );
  if (UPDATE) {
    console.error('[css-classes] ✖ refusing to write a baseline from a stale artifact.');
    process.exit(1);
  }
  if (REQUIRE) {
    console.error(
      '[css-classes] ✖ --require-artifact: stale artifact is not an acceptable verdict.',
    );
    process.exit(1);
  }
}

const defined = new Set();
for (const abs of artifacts) {
  for (const c of extractDefinedClasses(readFileSync(abs, 'utf8'))) defined.add(c);
}
const used = collectUsedClasses();
const baseline = loadBaseline();
const artifactLabel = artifacts
  .map((p) => p.slice(ROOT.length + 1).replaceAll('\\', '/'))
  .join(', ');

// `allDead` is the complete current debt; `dead` is only what the baseline
// does NOT already cover. --update must snapshot `allDead` — snapshotting
// `dead` would write an empty file the moment the baseline goes green, which
// silently disarms the guard for everyone after you.
const allDead = [];
for (const [cls, files] of used) {
  if (defined.has(cls)) continue;
  allDead.push({ class: cls, count: files.size, files: [...files].sort() });
}
allDead.sort((a, b) => b.count - a.count || a.class.localeCompare(b.class));
const dead = allDead.filter((d) => {
  const acc = baseline.dead?.[d.class];
  return !(acc && (acc.files ?? 0) >= d.count);
});

const cssFiles = [];
(function collectCss(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) collectCss(p);
    else if (e.name.endsWith('.css')) cssFiles.push(p);
  }
})(join(ROOT, 'src'));

const allDups = duplicateSelectors(cssFiles);
const dups = allDups.filter((d) => !baseline.dupSelectors?.[`${d.selector}@@${d.ctx}`]);

if (JSON_OUT) {
  console.log(JSON.stringify({ artifact: artifactLabel, dead, dups }, null, 2));
} else {
  console.log(`[css-classes] artifact : ${artifactLabel}`);
  console.log(`[css-classes] source   : ${used.size} class name(s) referenced`);
  console.log(`[css-classes] artifact : ${defined.size} class name(s) actually emitted`);
  if (dead.length === 0) {
    console.log('[css-classes] ✓ no dead class name beyond the accepted baseline');
  } else {
    console.log(`[css-classes] ✖ ${dead.length} class name(s) used but never emitted:`);
    for (const d of dead) {
      console.log(
        `    ${d.class.padEnd(30)} ${String(d.count).padStart(3)} file(s): ${d.files.slice(0, 3).join(', ')}${d.files.length > 3 ? ', …' : ''}`,
      );
    }
    console.log('    → usual causes: token in the wrong Tailwind namespace');
    console.log(
      '      (--font-size-* does NOT feed text-*; --duration-* does NOT feed duration-*),',
    );
    console.log('      or a colour/radius key declared in :root instead of @theme.');
    console.log('    → accept knowingly: node scripts/check-css-classes.mjs --update');
  }
  if (dups.length === 0) {
    console.log('[css-classes] ✓ no unbaselined duplicate selector group');
  } else {
    console.log(
      `[css-classes] ✖ ${dups.length} duplicate selector group(s) (per-declaration cascade risk):`,
    );
    for (const d of dups) {
      console.log(
        `    ${d.selector}  [${d.ctx}]  ${d.occurrences.map((o) => `${o.file}:${o.line}`).join(', ')}`,
      );
    }
    console.log('    → before merging, diff the property lists: one copy may own a declaration');
    console.log('      no other copy declares (scrollbar-color, will-change, font stacks).');
  }
}

if (UPDATE) {
  // A SNAPSHOT, not a merge. Merging lets stale entries survive forever: a
  // finding that was later fixed, or structurally excluded (the `group`/`peer`
  // markers), would keep occupying a baseline slot, so the baseline could
  // never shrink and the ratchet would silently rot. Human-written `note`
  // text is carried forward for entries that are still reported.
  const carry = (store, key) => store?.[key]?.note ?? 'accepted';
  const next = {
    note: 'Accepted findings — a snapshot of current debt, not a permanent pardon. Regenerate: node scripts/check-css-classes.mjs --update',
    generatedFrom: artifactLabel,
    dead: Object.fromEntries(
      allDead.map((d) => [d.class, { files: d.count, note: carry(baseline.dead, d.class) }]),
    ),
    dupSelectors: Object.fromEntries(
      allDups.map((d) => {
        const key = `${d.selector}@@${d.ctx}`;
        return [
          key,
          { lines: d.occurrences.map((o) => o.line), note: carry(baseline.dupSelectors, key) },
        ];
      }),
    ),
  };
  const dropped = Object.keys(baseline.dead ?? {}).filter((k) => !next.dead[k]);
  writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  console.log('[css-classes] baseline updated: scripts/css-classes.baseline.json');
  if (dropped.length) {
    console.log(`[css-classes] dropped ${dropped.length} stale entr(s) no longer reported:`);
    for (const d of dropped) console.log(`    - ${d}`);
  }
  process.exit(0);
}

process.exit(dead.length === 0 && dups.length === 0 ? 0 : 1);
