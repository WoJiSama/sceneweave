---
name: sceneweave-map-generation
description: 在 Sceneweave 中按用户需求生成新地图，例如林中建筑或海洋地图，并审阅候选和交付完整工程。
---

# Sceneweave 地图生成

按项目 [AGENTS.md](../../../AGENTS.md) 开始。在仓库根运行 `node tools/harness/sceneweave.mjs workflows`，根据用户题材和交付目标选择目录里的工作流。用 `--id` 读取步骤列表，按需查询 `--schema`。读取 `--step` 时，把目录返回的 `definitionHash` 传给 `--definition-hash`。连接支持 `sceneweave_workflow` 的宿主时，核对同一流程 ID、版本和摘要。

按流程所列的实际入口和当前授权调用[地图 CLI 或有限 MCP](../../../CONTRIBUTING.md#local-map-harness)，或在需要页面操作时指出准确入口。用宿主返回的真实候选、诊断和预览完成共享流程的交付检查。

从文字或参考图新建场景时，读 `sceneweave-map-authoring` 的 `start`。参考图的户外题用 `map example landscape-reference`，文字题从适合的地形、室内或林地示例开始。填决定构图的区域、地标和主要通路，用 `--stage draft` 出真图。用 `around` 指定绕行方向，用 `covers` 和 `scenery` 表达覆盖和布景。先核对路线、地标与主区域，有诊断标记时查看对应回执。画面可用后，用 `map verify --editor reopen`复核同一候选并确认普通页面能打开，再考虑可选细化。
