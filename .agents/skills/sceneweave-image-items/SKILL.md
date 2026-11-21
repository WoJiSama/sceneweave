---
name: sceneweave-image-items
description: 在 Sceneweave 中从获准使用的地图图片提取、审阅和交付可编辑 Item，或从图片制作工作包接续拆件任务。
---

# Sceneweave 图片 Item 制作

按项目 [AGENTS.md](../../../AGENTS.md) 开始。在仓库根运行 `node tools/harness/sceneweave.mjs workflows`，选 `sceneweave-image-items`。用 `--id` 读取步骤列表。查询 `--step` 时，把目录返回的 `definitionHash` 传给 `--definition-hash`。制作与审核正文见[共享流程](../../../workflows/image-items.md)，页面操作和示例见[图片工具说明](../../../docs/reference/image-item-workflow.md)。

图片执行走页面或[图片 MCP](../../../CONTRIBUTING.md#image-item-workflow-tools)。使用 MCP 时，先核对实际 `tools/list`，再通过 `sceneweave_workflow` 的 `read`、`step` 和 `schema` 查询同一流程，按 `definitionHash` 对齐版本。调用 `image_import_workflow` 读取实际原图、代次、未决审核和下一步。工具未接通时交代页面入口和当前断点。

从工作包接续时，用页面恢复入口或 `node tools/image-import/server.mjs --resume ABS_WORK_PACKAGE --output EXISTING_OUTPUT_DIRECTORY`。通过 `sceneweave_workflow` 的 `progress` 核对实际工作包和绑定。若摘要已变化，保留原包与伴随文件，使用原版本恢复，或在页面打开原包、核对当前输入和新规则后另起任务。
