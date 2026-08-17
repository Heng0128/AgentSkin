// 临时调试：复现 isCoveredByOverride 逻辑
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../scripts/probe-shadow-scope.mjs', import.meta.url), 'utf-8');
// 提取 2. AGENT_OVERRIDES 定义段 + 3-5 工具函数段，剥掉 import
const start = src.indexOf('const AGENT_FAMILIES');
const end = src.indexOf('// ===========================================================================\n// 6.');
let code = src.slice(start, end);
code = code.replace(/^import .*$/gm, '');
const sandbox = { AGENT_FAMILIES: {}, AGENT_OVERRIDES: {} };
const fn = new Function('sandbox', `${code}\n sandbox.AGENT_OVERRIDES = AGENT_OVERRIDES; sandbox.isCoveredByOverride = isCoveredByOverride; sandbox.selectorSpecificity = selectorSpecificity; sandbox.rightmostCompound = rightmostCompound; sandbox.selectorTargetKind = selectorTargetKind; sandbox.compoundClasses = compoundClasses; sandbox.specGtEq = specGtEq;`);
fn(sandbox);
const { AGENT_OVERRIDES, isCoveredByOverride, selectorSpecificity, rightmostCompound, selectorTargetKind, compoundClasses, specGtEq } = sandbox;

console.log('workbuddy overrides:', JSON.stringify(AGENT_OVERRIDES.workbuddy));
const r = {
  sel: 'body[data-application-name="workbuddy"]',
  important: true,
  rootMatch: false,
};
console.log('appRight:', rightmostCompound(r.sel));
console.log('appKind:', selectorTargetKind(rightmostCompound(r.sel)));
console.log('appSpec:', selectorSpecificity(r.sel));
console.log('ourRight:', rightmostCompound('html.agentskin-host-workbuddy body'));
console.log('ourKind:', selectorTargetKind(rightmostCompound('html.agentskin-host-workbuddy body')));
console.log('ourSpec:', selectorSpecificity('html.agentskin-host-workbuddy body'));
console.log('specGtEq:', specGtEq([0,1,2],[0,1,1]));
console.log('covered?', isCoveredByOverride('workbuddy', r));
