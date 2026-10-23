# C5 资源复用第一批独立证据

实际范围与结论见[33](../../33-c5-resource-reuse-validation.md)。2026-10-23，保留严格v6/v3、完整原件与持久事务。普通编辑明显改善，100ms和完整性能门仍未通过。

| 文件 | 内容 |
|---|---|
| [index.json](index.json) | 本批归档、设计和核查脚本的完整SHA/字节清单 |
| [baseline.json](baseline.json) / [frozen-application.json](frozen-application.json) | 开工前源码/历史/产物指纹与本批348源码测试配置/48产物冻结 |
| baseline-source/dist.tar.gz、current-source/dist.tar.gz | 可复核的前后实际代码/测试/配置及正常生产产物 |
| performance-before/after.tar.gz | 两侧各36真实UI观测、10次普通编辑、资源采样、下载包/PNG及正常完成manifest/summary |
| [comparison.json](comparison.json) | 原始值、各类中位/nearest-rank p95及产品阶段资源采样峰值 |
| chrome-reports.tar.gz | 3项新增专项与17项适用回归的原始Playwright JSON，内含base64实际附件；20项0失败/重试/跳过 |
| production-ui.tar.gz | 正常生产完整旅程、包/PNG、桌面/390px截图、实际runner与passed报告 |
| validation-logs.tar.gz | 本批所有已执行构建/测试/性能/生产日志，含初始Blob兼容失败与修正后结果 |
| [verification-attempt1.log](verification-attempt1.log) / [external-worktree-change.json](external-worktree-change.json) | todo外部变化导致首次核查失败的现场，保留独立更新后的现状 |
| [verification.json](verification.json) | 从归档逐项重算的证据检查，不代表性能门通过 |
| [final-checks.json](final-checks.json) | 链接、许可/凭据模式、改动范围与最终工作区核查 |

`scripts/archive.py`只创建独立归档并拒绝覆盖；`scripts/verify.py`只读归档和当前应用源码重算，输出verification。归档后README/脚本或设计若变化，要重新生成index再验证；已有source/dist/性能/生产归档不覆写。解包使用普通tar工具，不需要执行归档中的产品代码。Chrome reporter附件可按`contentType`及`body`的base64读取；包含本机路径的原始环境/工具元数据不是工程许可内容。

docs32及旧证据保持冻结。本批低次数诊断不能拼入旧正式矩阵；没有重新声明完整SCN/P3、跨浏览器、真实配额耗尽、小团、UVTT或完整M1通过。未commit/push。
