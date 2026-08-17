// SPDX-License-Identifier: MPL-2.0
// 临时分析：导出各 Agent 活动遮蔽规则的精确 token 清单（对比 tokens.css 覆盖）
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const ROOT = resolve(__dirname, '..');
const AGENTS = ['codex', 'doubao', 'workbuddy', 'qoderwork', 'traework', 'zcode'];

// 读取 tokens.css 里我们覆盖的 token 集
function ourTokens(agentId) {
  const p = resolve(ROOT, 'engines', agentId, 'tokens.css');
  try {
    const src = readFileSync(p, 'utf-8');
    const set = new Set();
    const re = /(--[A-Za-z0-9_-]+)\s*:/g;
    let m;
    while ((m = re.exec(src))) set.add(m[1]);
    return set;
  } catch {
    return new Set();
  }
}

for (const agent of AGENTS) {
  const fp = join(OUT, `_shadow-scope-${agent}.json`);
  let report;
  try {
    report = JSON.parse(readFileSync(fp, 'utf-8'));
  } catch {
    console.log(`\n===== ${agent}: 无报告 =====`);
    continue;
  }
  if (!report.ok) {
    console.log(`\n===== ${agent}: 探测失败 =====`);
    continue;
  }
  const our = ourTokens(agent);
  console.log(`\n===== ${agent} =====  (tokens.css 覆盖 ${our.size} 个 token)`);
  const active = [];
  const latent = [];
  for (const f of report.families) {
    for (const s of f.shadowed) {
      const entry = { family: f.family, sel: s.sel, spec: s.spec, important: s.important, hits: s.hits };
      if (s.active) active.push(entry);
      else latent.push(entry);
    }
  }
  console.log(`--- 活动遮蔽 ${active.length} 条 ---`);
  for (const a of active) {
    // 只看未被 tokens.css 覆盖的 token
    const missing = a.hits.filter((t) => !our.has(t));
    console.log(`  [${a.family}] ${a.sel} (${a.spec.join(',')})${a.important ? ' !important' : ''}`);
    console.log(`      hits=${a.hits.length} 缺=${missing.length}`);
    if (missing.length) console.log(`      MISSING: ${missing.join(', ')}`);
  }
  console.log(`--- 潜伏遮蔽 ${latent.length} 条（不在 DOM）---`);
  for (const l of latent.slice(0, 12)) {
    const missing = l.hits.filter((t) => !our.has(t));
    console.log(`  [${l.family}] ${l.sel} 缺=${missing.length}`);
    if (missing.length) console.log(`      MISSING: ${missing.join(', ')}`);
  }
  if (latent.length > 12) console.log(`  ... 其余 ${latent.length - 12} 条`);
}
