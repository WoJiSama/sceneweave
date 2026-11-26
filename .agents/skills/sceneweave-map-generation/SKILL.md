---
name: sceneweave-map-generation
description: 在 Sceneweave 中按用户需求生成新地图，例如林中建筑或海洋地图，并审阅候选和交付完整工程。
---

# Sceneweave 地图生成

按项目 [AGENTS.md](../../../AGENTS.md) 开始。在仓库根运行 `node tools/harness/sceneweave.mjs workflows`，根据用户题材和交付目标选择目录里的工作流。用 `--id` 读取步骤列表，按需查询 `--schema`。读取 `--step` 时，把目录返回的 `definitionHash` 传给 `--definition-hash`。连接支持 `sceneweave_workflow` 的宿主时，核对同一流程 ID、版本和摘要。

按流程所列的实际入口和当前授权调用[地图 CLI 或有限 MCP](../../../CONTRIBUTING.md#local-map-harness)，或在需要页面操作时指出准确入口。用宿主返回的真实候选、诊断和预览完成共享流程的交付检查。

从文字或参考图新建场景时，读 `sceneweave-map-authoring` 的 `start`。户外参考图用 `map reference --stage draft` 一次得到首图和叠图，`map capabilities` 提供 `referenceGuide` 示例。取少量背景色并标记用户点名的低处、主要地貌和通路。文字题从适合的地形、室内或林地示例开始。先查看真实预览和必要的通行检查，再按编号处理局部问题。画面可用后，用 `map verify --editor reopen` 复核同一候选，通过后把真实预览及可编辑工程一同交给用户。
