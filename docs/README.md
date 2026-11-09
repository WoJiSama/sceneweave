# 文档导航

日常先看[路线图](07-roadmap.md#development)确认任务，再读相关主定义。当前分支的第一优先级与A–E执行序列集中在[同一份路线图](07-roadmap.md#general-map-generation-priority)，总体架构见[通用地图生成器设计](reference/general-map-generation.md)。全部验收从[质量计划](09-quality-plan.md#acceptance)开始。正文负责现行合同，历史台账负责按日期/冻结保留的实现、测试、失败和发布证据；两者不混写。

开发期只维护[一套当前完整工程v1](04-scene-document.md#development-single-v1)，保留[独立一次性本机迁入](06-storage-and-export.md#development-single-v1-import)；旧版本表只作迁入和领域能力来源说明，当前归一实现的验证与剩余项见07。B的实际模块/版本映射见[设计第10节](reference/general-map-generation.md#capability-version-map)；D的源码研究、算法选择和领域边界见[第11节](reference/general-map-generation.md#d-domain-design)，实施状态按[07的D1–D7表](07-roadmap.md#d-domain-implementation)维护；E的有限混合与交付合同见[11.8](reference/general-map-generation.md#e-mixed-delivery)。

当前容量主线为[层级组合、局部坐标与分区存储设计](reference/general-map-generation.md#aggregate-spatial-capacity)，实施集中在[07同一大步骤的a–j表](07-roadmap.md#t2-implementation)，数据/存储目标见04/06，完整验收见[09补充矩阵](09-quality-plan.md#aggregate-capacity-acceptance)。运行时合同和完整v1使用方见[04](04-scene-document.md#aggregate-coordinate-contract)及[设计映射](reference/general-map-generation.md#aggregate-consumer-map)；整体编辑、分区加载与新存储状态仍以07为准。

工作台信息架构八项开发整改已实现，整合自检与正式待验分开记录：需求看[01左右分工](01-product.md#workspace-information-architecture-requirements)，完整设计看[交互与架构](reference/editor-and-architecture.md#workspace-information-architecture)，八个实施切片与当前接续看[07](07-roadmap.md#workspace-information-architecture-plan)，新布局正式矩阵看[09](09-quality-plan.md#workspace-information-architecture-acceptance)。前轮UX自检不自动覆盖本次导航和上下文重排。

## 八份主文档

| 要解决的问题 | 唯一主定义 |
|---|---|
| 做什么、支持什么用户任务、哪些不做 | [01 产品](01-product.md) |
| 严格版本、实体关系、整数毫米、原子事务与身份 | [04 数据](04-scene-document.md) |
| 模型连接、授权、任务/工具、隔离草稿与采用 | [05 AI](05-ai-and-generation.md) |
| 完整工程、保存/CAS、迁移原件、资源与双受众输出 | [06 存储](06-storage-and-export.md) |
| 当前做什么、下一步是什么、什么时候进入验收/M3 | [07 路线](07-roadmap.md) |
| 冻结、QA输入/退出、真实AI样本、视觉/P3、性能与交付验收 | [09 质量](09-quality-plan.md#acceptance) |
| 规则、素材、参考项目和公开分发许可 | [10 许可](10-rules-assets-and-licensing.md) |
| 画面风格、成图方法、固定素材及尺寸/占地/许可台账 | [14 视觉与素材](14-visual-and-assets.md) |

## 按需参考

| 场景 | 参考 |
|---|---|
| 查用户操作、候选生命周期、模块和平台边界 | [交互与架构](reference/editor-and-architecture.md) |
| 查通用地图生成器的总体分层、领域接入和迁移边界 | [通用地图生成器设计](reference/general-map-generation.md) |
| 查地形当前支持/拒绝边界、双尺度、算法和局部联动 | [地形生成](reference/terrain-generation.md#terrain-capabilities) |
| 执行固定SCN/VIS场景，核对尺寸、输入和秘密 | [固定验收场景](reference/acceptance-scenarios.md) |
| 追溯设计决定、外部来源和未实测问题 | [决策与研究依据](reference/decisions-and-research.md) |
| 查正式性能方法、各冻结分布、失败和未达门槛 | [性能方法与结果](reference/performance.md) |
| 准备自有图片、名称、标定、清单和个人库携带 | [素材导入指南](reference/asset-import.md) |

运行/配置/部署命令见[贡献说明](../CONTRIBUTING.md)，用例选择见[测试说明](../tests/README.md)。只读源码核对不等于运行测试；已有工具不等于真实模型或目标软件验收通过。

## 历史与维护

六份[历史台账](archive/README.md)按主题保留证据、首轮失败、修复、未通过结论和各自冻结。旧编号从历史索引追溯；原54视觉质量方法已并入14，原55变为地形参考，旧会话工作笔记并入既有M2台账。它们不再作为独立计划入口。

- 一个事实只有一个主定义；其他页面简短引用，不再复制排期、版本状态或长测试数字。
- 开发任务只改07；验收样本、执行顺序和复验规则只改09；功能和格式变化同步所属合同。
- 新结果补入已有主题台账；不新增逐批报告、根目录工作笔记或空壳跳转文件。
- 计划、实现、自检、验收、发布分别记录，不拼接不同冻结的通过数字；用户P3由用户签收。
- `todo.md`保持用户独立清单；临时计划、诊断和大图放被Git忽略的`work/`，不得成为新的执行主入口。
