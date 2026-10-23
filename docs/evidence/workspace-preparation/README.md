# 统一工作区与素材库准备检查

日期：2026-10-23。对应[37准备交接](../../37-workspace-and-asset-library-handoff.md)，原讨论[36](../../36-workspace-and-asset-library-proposal.md)与M1-D首批[35](../../35-m1d-outpost-validation.md)保持原样。

本目录只记录文档准备与保护范围检查，不是产品运行、素材美术或性能证据。应用保持 `0.2.0-m1-d-outpost`；U1/U2未实现，QA-WS/QA-CAT全部未运行。本轮没有运行单元、浏览器、构建、正式性能或删除数据，也没有stage/commit/push。

- `baseline.json`：开始时HEAD、Git状态及1641份非忽略既有文件的SHA-256/大小；含M1-D未提交代码、文档、素材与证据，未把它们恢复成HEAD。
- `documents-before.tar.gz`：本轮17份可修改主文档/计划的原始字节，保护此前M1-D和讨论记录。相对路径为仓库根目录路径，不包含todo或运行工程数据。
- [checks.json](checks.json)：准备收尾时从原文件独立核对非本轮文件、源码/素材/旧报告、35/36、todo、HEAD和版本；文档链接/锚点/编号/表格与新增文本目标凭据模式检查，只检查本轮新文字的空白，不篡改原始日志或证据来消除旧提示。

准备文件的允许修改范围为README/AGENTS、docs导航及01/02/03/04/06/07/08/09/11/14/15、task_plan/progress/findings、新交接37和本目录。其他既有文件逐项hash保护；工作区若出现外部编辑，记录实际差异并保留，不回滚或伪称一致。检查只证明文档与现状保全，不关闭完整M1-D、M1、P3、C5或性能门。

操作日志、原始diff和核查脚本保留在本地 `work/workspace-preparation-20261023`。本目录使用独立小清单，不复制既有大reporter/图片/工程包，不清理旧档案。
