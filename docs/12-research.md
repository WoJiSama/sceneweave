# 调研依据与复用判断

原仓库/规则核验日期：2026-10-20；PS编辑思路资料补充日期：2026-10-21。方式：读取README、许可证、关键源码、Git提交元数据与官方文档。未构建或运行三个参考项目，也未执行真实AI请求、PS操作验证、性能测量或VTT导入。以下仓库证据固定到核验提交，外部网站可能更新。

## 三个参考项目

| 项目 | 核验结果 | 决策 |
|---|---|---|
| TownGeneratorOS | Haxe/OpenFL/Lime；城镇街区、街道、建筑占地；GPL-3.0；开源默认分支提交停留在2019-04-07 | 学习seed、用途驱动、拓扑与几何分层；不把城镇模型当场景内核 |
| civ-atlas | React/TS/Vite、Canvas 2D/WebGL2、Worker；星球与文明模拟；AGPL-3.0-only；核验HEAD为2026-10-19 | 重点借鉴AI提案、语义校验、基线检查、撤销与实际结果快照 |
| gjhhust/nortantis | 中文衍生版本2.85，Java17/Swing；世界/大陆；AGPL v3-or-later；核验提交2025-05-14 | 参考生成后编辑；需要世界背景可直接使用其输出 |

以上为对所读源码的事实摘要；“不做底座”是针对 Sceneweave 首版范围的工程判断，不是对项目质量的整体评价。

### TownGeneratorOS

- [README](https://github.com/watabou/TownGeneratorOS/blob/7fbc87a9398cc508af24de93f79cf2ad027f352b/README.md#L1-L6)明确开源版缺少在线版水体、选项界面等功能，因此不能把在线产品全部功能记入仓库。
- [构建配置](https://github.com/watabou/TownGeneratorOS/blob/7fbc87a9398cc508af24de93f79cf2ad027f352b/project.xml#L4-L21)固定旧版 Lime/OpenFL；[生成流程](https://github.com/watabou/TownGeneratorOS/blob/7fbc87a9398cc508af24de93f79cf2ad027f352b/Source/com/watabou/towngenerator/building/Model.hx#L87-L143)包括分区、道路、街区和建筑几何。
- [建筑切分](https://github.com/watabou/TownGeneratorOS/blob/7fbc87a9398cc508af24de93f79cf2ad027f352b/Source/com/watabou/towngenerator/wards/Ward.hx#L125-L195)得到的是建筑轮廓；本轮未发现房间门窗、撤销与VTT墙线导出实现。
- [GPL](https://github.com/watabou/TownGeneratorOS/blob/7fbc87a9398cc508af24de93f79cf2ad027f352b/LICENSE)约束代码复用；生成结果与素材许可需分别判断。

### civ-atlas

- [依赖](https://github.com/guaner-334/civ-atlas/blob/38255984866272fa66afb7052d85284ca3f6fe49/package.json#L19-L45)、[世界模型](https://github.com/guaner-334/civ-atlas/blob/38255984866272fa66afb7052d85284ca3f6fe49/src/gen/world.ts#L43-L82)与[Worker](https://github.com/guaner-334/civ-atlas/blob/38255984866272fa66afb7052d85284ca3f6fe49/src/worker.ts#L1-L25)说明它的主尺度是星球与文明。
- [AI说明](https://github.com/guaner-334/civ-atlas/blob/38255984866272fa66afb7052d85284ca3f6fe49/src/ai/agent/assistant.ts#L1-L15)、[应用前基线检查](https://github.com/guaner-334/civ-atlas/blob/38255984866272fa66afb7052d85284ca3f6fe49/src/ui/assistantStore.ts#L560-L612)支持“提案—验证—采用”的设计参考。
- [快照说明](https://github.com/guaner-334/civ-atlas/blob/38255984866272fa66afb7052d85284ca3f6fe49/src/gen/snapshot.ts#L1-L22)说明实际保存结果的重要性；seed不够保证升级后的地图一致。
- [许可及素材说明](https://github.com/guaner-334/civ-atlas/blob/38255984866272fa66afb7052d85284ca3f6fe49/README.md#L187-L211)区分AGPL代码与输出；未完成全部传递依赖审计。
- [服务器边界](https://github.com/guaner-334/civ-atlas/blob/38255984866272fa66afb7052d85284ca3f6fe49/docs/development.md#L18-L19)说明账号/云同步等服务并不包含在仓库中，不能据静态部署能力宣称所有在线功能可自行完整部署。

### Nortantis

- [中文来源说明](https://github.com/gjhhust/nortantis/blob/2b6a6b732fc16eb43b60d6e952d53d5e8db9e5c9/README.md#L1-L9)与[Java/Swing构建](https://github.com/gjhhust/nortantis/blob/2b6a6b732fc16eb43b60d6e952d53d5e8db9e5c9/build.gradle#L1-L26)定义用户提供仓库的实际边界。
- [编辑类注释](https://github.com/gjhhust/nortantis/blob/2b6a6b732fc16eb43b60d6e952d53d5e8db9e5c9/src/nortantis/swing/MapEdits.java#L23-L44)强调用户编辑成为事实来源；这比让每次重绘都重新生成更适合长期地图维护。
- [导出实现](https://github.com/gjhhust/nortantis/blob/2b6a6b732fc16eb43b60d6e952d53d5e8db9e5c9/src/nortantis/swing/ImageExportDialog.java#L63-L111)包含图片与高度图，并明确高度图不反映画笔编辑；不能默认所有输出语义一致。
- [程序及输出许可](https://github.com/gjhhust/nortantis/blob/2b6a6b732fc16eb43b60d6e952d53d5e8db9e5c9/installer/end_user_license_agreement.txt#L1-L19)声明AGPL v3-or-later以及生成地图的独立使用条件。
- [原上游核验提交](https://github.com/jeheydorn/nortantis/tree/9e9700c23d154774f9ade9a0b6b813a7fd30f53a)为2026-10-03、源码版本3.21；后续研究应关注原上游，不能把其新功能自动算作中文2.85已有能力。

## 规则官方来源

| 来源 | 核验位置 | 支持的结论 |
|---|---|---|
| [D&D SRD入口](https://www.dndbeyond.com/srd)与[5.2.1 PDF](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf) | 第1页许可，第13页方格 | CC BY 4.0；选择方格时常用5英尺；版本须区分 |
| [匕首之心SRD入口](https://www.daggerheart.com/srd/)与[2.0 PDF](https://www.daggerheart.com/wp-content/uploads/2026/08/DH_SRD_2_2026_08_25.pdf) | 第51页 | 抽象距离与可选精确方格并存 |
| [DPCGL入口](https://darringtonpress.com/license/)与[2.0 PDF](https://darringtonpress.com/wp-content/uploads/2026/08/DPCGL_2.0_AUG_26_2026.pdf) | 第2页 | 私人使用与公开Sharing区别，分发形式与VTT另有条件 |
| [CoC快速入门入口](https://www.chaosium.com/cthulhu-quickstart/)与[PDF](https://www.chaosium.com/content/FreePDFs/CoC/CHA23131%20Call%20of%20Cthulhu%207th%20Edition%20Quick-Start%20Rules.pdf) | 版权段 | 免费获取不等于可任意再分发；保留特定游戏内使用许可 |

调查/战术/叙事的产品默认值是 Sceneweave 自己的设计，不能把产品选择写成官方强制规则。本仓库只提供来源链接，不打包这些外部文件。

## 渲染和交换格式

- [Konva官方概览](https://konvajs.org/docs/overview.html)：图层、事件、拖动、变换等能力，支持优先完成编辑交互的选择；未据此证明本项目性能。
- [PixiJS官方概览](https://pixijs.com/8.x/guides/getting-started/intro)：WebGL/可选WebGPU二维渲染定位，为性能或视觉需求变化后的备选。
- [Foundry官方导入器页面](https://foundryvtt.com/packages/dd-import)、[固定提交README](https://github.com/moo-man/FVTT-DD-Import/blob/3c78eb1b640f00b9bc9b3e30382ebbd03ee374ba/README.md)与[图片/墙门/光源读取](https://github.com/moo-man/FVTT-DD-Import/blob/3c78eb1b640f00b9bc9b3e30382ebbd03ee374ba/ddimport.js#L292-L373)：支持把Universal VTT作为后续导出候选；不证明全平台无损互通。

这些链接是研究证据，不是已选依赖清单。源码发布、实际性能、模型能力、兼容版本与资产授权需在各里程碑按真实集成结果验证。

## Photoshop编辑思路参考（2026-10-21）

按用户提出的编辑习惯阅读Adobe官方资料，只借鉴交互和非破坏性思路。右键目标、矩形命中规则、图层空间语义和持久恢复协议由Sceneweave自行设计，主定义分别在02/04/06。

| 官方资料 | 资料支持的事实 | Sceneweave的采用判断 |
|---|---|---|
| [非破坏性编辑](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/create-layer-compositions/non-destructive-editing-techniques.html) | 调整层、智能对象等方式保留原始内容，使后续调整可修改或移除 | 采用源素材/派生版本/覆盖分离，保留本地参数路径；不据此承诺全部滤镜、像素绘画或PSD兼容 |
| [历史面板快照](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-work-snapshots.html) | 文档说明快照用于比较历史状态，其快照在关闭文档前的会话内可用 | 借鉴命名和比较入口；Sceneweave另行设计跨重开的完整命名快照及资源保留，不把会话历史当长期备份 |
| [History Brush局部恢复](https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/paint-image-states.html) | 可从历史状态或快照选择性恢复图像局部，保留其他编辑 | 将“只找回一部分”的意图映射到稳定对象ID/属性组及依赖闭包；地图结构恢复是新事务，不直接复制旧像素或旧revision |

以上是外部产品文档的事实与本项目的设计推论，尚未形成Sceneweave实现或可用性证据。界面隐藏与玩家秘密、高程与绘制顺序继续分离；完整PSD工具集和自动全图同化未进入当前排期。
