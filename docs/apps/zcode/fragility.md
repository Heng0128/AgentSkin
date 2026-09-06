# zcode 脆弱性分级（sdk-fragility）

> 与 [architecture.md](./architecture.md) 配套。依赖点按[升级崩溃概率]分级；
> 动态层数据来自 `agents-raw-data/zcode-full-extract.json`（CDP 全量快照）。

## 1. 依赖点分级

| 等级 | 依赖点 | 崩溃概率 | 说明 |
|------|--------|---------|------|
| Low | `file://` 渲染面身份 | Unlikely | scheme 稳定，决定 CDP 暴露面 |
| Low | 原生 `:root` 变量（命名空间） | Unlikely | 设计系统 token，集中声明 |
| Low | 变量来源走原生快路径 | Unlikely | `documentElement` 计算即可覆盖 |
| High | 非 hash class 语义选择器 | Very likely | 非公开 API，随组件重构变化 |
| High | 组件 DOM 结构（div 层级） | Very likely | 布局重构即崩 |
| Medium | DOM 树节点数 / 锚点集合 | Sometimes | 惰性渲染与空态影响采集 |

## 2. 反模式与铁律

- ❌ 不依赖 minified JS 变量名 / hash css-module class（`_pk7td_1`）——每次构建都变。
- ✅ 可依赖字符串字面量：`data-*`、稳定的 `id`、命名空间变量前缀。
- ⚠️ 谨慎依赖运行时对象结构（fiber walk 发现）——名字不变但 shape 会变。

## 3. 升级检查清单

- [ ] 重新跑 CDP 全量快照：`node scripts/cdp-full-extract.mjs --agent zcode`
- [ ] 与上一版 diff：`node scripts/snapshot-compare.mjs <旧> <新> --out docs/apps/zcode/raw/upgrade-diff.md`
- [ ] 检查变量命名空间是否消失/改名（尤其默认 scheme）。
- [ ] 检查语义锚点新增/消失（stable id / class）。
- [ ] 若为分布式变量家族，确认 `rootVars` 聚合策略仍命中（非 0）。
- [ ] 跑 E2E 注入验证，确认主题注入生效且内部控件无意外命中。
- [ ] 更新本文件与 architecture.md 的快照时间/版本行。

