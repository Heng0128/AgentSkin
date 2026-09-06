# AgentSkin Documentation Index

顶层 docs/ 目录存放项目级架构、规范、设计系统与适配文档。

## 目录

| 目录 | 用途 | 索引 |
|------|------|------|
| `reports/` | 审计/巡检/实施报告 | `reports/INDEX.md` |
| `rfc/` | RFC 方案与实施报告 | （按日期命名，无集中索引） |
| `competitor-analysis/` | 竞品分析文档 | `competitor-analysis/INDEX.md` |
| `apps/` | 各 Agent 适配文档与逆向素材 | `apps/ADAPTATION-INDEX.md` |
| `adapters/` | 适配器级专题文档（如安全边界） | — |
| `research/` | 研究报告（如 Shadow DOM piercing） | — |
| `reverse-engineering/` | 逆向工程报告与批次素材 | — |

## 维护规则

1. **新增子目录必须登记**：在本文档的「目录」表添加行，写明用途与索引文件位置。
2. **新增报告必须登记**：审计/巡检类报告登记到 `reports/INDEX.md`；竞品分析登记到 `competitor-analysis/INDEX.md`；RFC 直接放入 `rfc/`。
3. **命名规范**：`<主题>-<日期>.md` 或 `<主题>-report.md`；RFC 使用 `YYYY-MM-DD-<主题>.md` 格式。
4. **废弃文件**：移入 `archive/` 或直接删除，不允许在 INDEX 中保留死引用。
