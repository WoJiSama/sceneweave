# C1d 命名快照与首批局部恢复验证

日期：2026-10-22。当前本地版本为 `0.2.0-m1-c1d`。本批按用户“继续”授权，承接[选择性能优化](25-selection-performance.md)与[C1c用户图层](26-m1c-c1c-validation.md)，实现命名历史和独立物件的首批局部恢复。源码尚未提交或发布；13/17–26及其原始证据保持历史结论。

## 实现与格式边界

场景仍是完整、严格的 `schemaVersion=3` 文档；新增历史身份放在严格 `CompleteProjectV4` 工程信封中。容器为 `containerVersion=4/documentSchemaVersion=3/profile=m1-history`，仓库为独立 IndexedDB `sceneweave-m1-history`，不升级旧库或向严格v3文档偷加字段。原生v3 IO/Canvas入口通过 `toCompleteProjectV3` 只接收 `document/assets/licenses/licenseBindings` 四项，历史元数据不进入投影或PNG。

`historyIdentity` 包含版本1、lineageId、rootSceneId及物件出生令牌。删除后仍保留已分配ID；普通新建/复制不能复用旧身份。撤销、重做、另存和历史导入保留令牌并集，同名对象、相同旧revision或矩形位置不能代替身份检查。

历史工坊支持创建命名快照、改名、删除、查看完整内容，以及恢复采用前自动建立的保护点。快照内容及内容hash不可变；名称可改，但不作为匹配键。最近20份自动历史、命名快照、保护点和会话撤销栈分别管理；保护点不被自动20份淘汰。当前界面没有任意手动创建保护分支的入口。

从当前v3工程或完整v3文件启用历史，先保全当前分支，再建立新sceneId/r0的完整副本，保留实体/图层ID及全部资源。文件迁移保留输入的确切Blob/hash，本地还保留已有v2/v1来源链并提供原件下载。旧自动历史留在旧数据库，界面明确提示未迁入。

两种便携包的含义固定：

| 模式 | 实际携带内容 |
|---|---|
| `complete` | 当前完整场景、历史身份、全部当前资源和许可；不暗含快照或撤销栈 |
| `history` | 当前完整工程，加用户明确勾选的命名/保护快照；每份独立完整校验，资源联合闭包按实际hash去重 |

便携包不自动携带本地迁移原件或旧自动历史；导入创建隔离副本，不覆盖打开工程。旧v1/v2/v3读者拒绝v4。manifest字段/路径/角色/大小/hash、ZIP CRC、实际资源字节/格式/尺寸/解码及许可检查全部保留，不能凭历史来源省略。

## 首批恢复范围

每次明确选择1–256个稳定物件ID，先预览差异，再一次采用。超过限制整笔拒绝，不拆批绕过。

| 模式 | 恢复字段与保留规则 |
|---|---|
| 外观 `appearance` | definitionRef、appearance、visualBoundsMm、shadowClass、shadowOverride；保留当前位置/角度、物理占地/通行、支撑、图层、秘密及编辑锁 |
| 位置角度 `transform` | positionMm、rotationDeg；保留当前外观和其他语义，使用当前资源/许可 |
| 完整物件 `entity` | 显式恢复完整独立物件及历史图层归属；可找回已删除物件，历史图层与合法支撑须仍存在。已有对象的编辑锁保留，重建对象未锁定；涉及玩家公开范围变化时显式展示并审阅 |

当前或历史中存在组合/散布成员关系、锚点注记、路径/结构检查依赖时拒绝该目标。当前实体锁、当前层/目标层锁、房间及地形支撑链锁同时约束恢复。缺层/支撑、跨Floor、不同lineage、出生令牌冲突、被其他实体占用的ID、固定定义/资源内容冲突、坏许可、非法几何或秘密遮罩不足均拒绝。

外观/完整实体模式只合入实际采用的固定定义和图像资源闭包；不把历史中的无关许可冲突扩大到本次恢复。不会恢复整个历史图层，不隐式删除快照后新增对象，也不运行散布seed重算。

采用顺序为：捕获工作区checkpoint、sceneId/revision、快照ID/hash和请求 → 完整预览校验 → flush当前分支 → 在同事务场景内容CAS、历史元数据CAS和源快照检查下成功落盘保护点 → 再核对基线及取消状态 → 提交当前revision+1的单一可撤销事务 → 串行CAS保存。源快照删除、期间新编辑、切工程、取消或迟到结果均阻止旧候选提交。

保护点成功后若采用前取消，可保留该保护条目并明确删除。采用后保存失败则保留已恢复的内存、撤销能力、保护点和旧持久分支，显示未保存/冲突并允许导出或另存；不能把这一阶段写成“内存从未恢复”。

实现保护预算如下；它们不等于真实容量或浏览器配额承诺：

| 项目 | 上限 |
|---|---:|
| 每场景命名快照 / 保护点 | 各32份 |
| 历史包显式所选快照 | 64份 |
| 每份身份累计已分配物件ID | 65536个 |
| 数据库唯一资源及许可 | 256 MiB |
| 数据库文档/身份JSON / 迁移原件 | 各128 MiB |
| 历史包文档/身份JSON | 128 MiB |
| ZIP压缩 / 展开 | 沿用100 / 300 MiB，其他单图/许可限额保持 |

超限整笔拒绝；不自动删除固定快照腾空间。本批没有共享资源字节垃圾回收，显式删快照只删该项及绑定，不能由此推定物理字节立刻减少。

## 实际验证

环境：Apple M1、16 GiB、Darwin25.6.0 arm64、Node24.14.1、Chrome155.0.8059.84；浏览器单worker，1512×982、DPR1，另检查390×844窄屏。系统采集值见[环境](evidence/m1-c1d/environment.json)。本批没有运行正式性能测量。

| 检查 | 实际结果与证据 |
|---|---|
| 全量单测 | `npm test`：53文件、649项通过，24.12s；[日志](evidence/m1-c1d/unit.log) |
| 正常生产构建与类型检查 | `npm run build`及最终`npm run typecheck`通过；[构建](evidence/m1-c1d/build.log)、[类型检查](evidence/m1-c1d/typecheck.log)。保留Zod注释及chunk大于500kB提示，不当作运行性能成绩 |
| C1d定向Chrome | 12/12通过，54.38s；[逐项摘要](evidence/m1-c1d/browser/c1d-target-summary.json)、[原reporter](evidence/m1-c1d/browser/c1d-target-run.json) |
| 全量Chrome | 121项中120过、1项旧B4取消探针失败，613.89s；[逐项摘要](evidence/m1-c1d/browser/full-run-summary.json)、[原reporter无损gzip](evidence/m1-c1d/browser/full-run.json.gz) |
| B4探针修正后定向Chrome | 4/4通过，16.22s；[逐项摘要](evidence/m1-c1d/browser/b4-target-summary.json)。121个用例已在全量与定向批次中分别取得通过结果，不写成一次全量全绿 |
| 正常生产UI与视检 | 无DEV/性能API，真实UI完成命名、范围恢复、取消、保护、撤销/重做和所选备份；[报告](evidence/m1-c1d/production-ui/report.json)及三张截图已目视检查。390px下文档宽度390，无横向溢出；页面及地图资源错误为零，既有favicon.ico 404单列 |

核心/IO/工作区单测覆盖出生身份及墓碑、256目标上限、三种字段组、锁与不支持依赖拒绝、资源及许可冲突、严格未知字段/重复JSON键/CRC/hash/路径负例、来源链、滚动20份、命名/保护各32份、元数据/内容CAS、取消重入、保护失败回滚和采用后保存失败。Node存储测试使用fake-indexeddb，真实解码与浏览器数据库由以下Chrome用例补充，不能混为真实配额耗尽。

C1d的12项Chrome包含3项渲染、3项持久化、6项工坊验证：

- 双样板×双受众的4K默认迁移等价；两组独立秘密物件恢复配对。
- 双样板历史包进入空数据库后离线恢复误删物件，保留后来新增图层，继续撤销/重做并重开；真实双标签元数据与场景CAS冲突保留双方。
- 真实预览/取消/保护/采用、改名/删除与明确备份子集、180行物件选择器的键盘焦点、玩家公开范围变化审阅、IndexedDB写失败注入、完整v3文件迁移及确切来源字节。

历史物件选择器在180项中实际挂载9行，End键可定位并选中完整ID `item-179`；这是选择器功能证据，不是大量快照/资源恢复的性能成绩。离线用例先在线预载运行时，再断网导入完整包，外部请求为零；不证明PWA离线冷启动。

### 渲染与秘密

[4K逐像素对照](evidence/m1-c1d/browser/attachments/c1d-default-pixel-parity.json)：VIS-01两受众均4096×2926，VIS-02均4096×3686，四次原生v3与v4显式视图对照的差异RGBA通道数均为0，原文档未变，PNG未带历史身份元数据。

| 样板 | 两受众各自对照的RGBA SHA-256 |
|---|---|
| VIS-01 | `4465c2d3e29518a6b30ad851523cdeeee3e7f52c10bf6f7871a858b047bac4d2` |
| VIS-02 | `b53a5352d371dcae1766242ea504c62b8aaba9eda3c2b4e798a743e42851b7e6` |

普通样板的GM/player相同不抵扣秘密验证。另从B4的VIS-01-S01、VIS-02-S02各去除锚点注记，形成符合独立物件范围的副本，将秘密物件角度137°恢复至0°；1200px渲染及PNG解码像素证明GM确实变化，玩家前后hash保持相同，visibility仍为gm且遮罩未变。玩家hash分别为 `7107efd0d895d76732e5bba86d063d7bd312461d5826bfaac7a29ad1b85b6a19` 与 `0899b018628c43fb7aebf957535978e55e5e4844474f8d51825122925b3b60a4`。原记录见[VIS-01](evidence/m1-c1d/browser/attachments/c1d-secret-VIS-01-S01.json)、[VIS-02](evidence/m1-c1d/browser/attachments/c1d-secret-VIS-02-S02.json)。不据两组恢复配对推定全部任意恢复隐私矩阵通过。

### 持久化与生产界面

[书房](evidence/m1-c1d/browser/attachments/study-c1d-offline-history.json)和[岩岛](evidence/m1-c1d/browser/attachments/island-c1d-offline-history.json)的历史包分别137637 / 335155字节，空库离线导入后从r0采用误删物件至r1、撤销r2、重做并重开r3；历史内容hash保持，后来图层仍在，分别真实解码15 / 13个图像资源。旧读者拒绝新包，本地确切迁移原件保持；离线新分支与源工程分开。

正常生产UI使用真实书房样板：r0命名“露台陈设 · 初稿”，把 `terrace-flowerpot` 从0°转至35°成为r1，再建“稍后新增图层”至r2。恢复预览明确35°→0°，取消不改文档/历史；再次采用前建立1个保护点，采用/撤销/重做分别到r3/r4/r5，后来图层保持。仅勾选命名快照下载历史备份，保护点未被夹带；包131575字节，SHA-256为 `7584af6b2f963abcfa9fabd2f8c0364cf7c7f20fe5e763fa524dbe4fa2df514d`，全部manifest条目实际大小/hash核对通过。

[桌面恢复预览](evidence/m1-c1d/production-ui/history-preview-desktop.png)、[390px窄屏](evidence/m1-c1d/production-ui/history-preview-narrow.png)、[采用后](evidence/m1-c1d/production-ui/history-adopted-desktop.png)与[实际runner](evidence/m1-c1d/production-ui/runner-used.mjs)一并保留。该runner固定写本批证据目录，复现时先复制并改为新的输出目录，避免覆盖历史。

## 失败现场与修正

以下原结果均保留，不合并成成功执行；索引见[诊断文件与本地trace](evidence/m1-c1d/diagnostic/local-artifacts.json)及[验证索引](evidence/m1-c1d/verification-index.json)。

1. 两项多次写入存储单测在全套并发下超过默认5秒，分别设20秒用例上限后全量通过；没有放宽领域、资源或事务校验。v4测试夹具的v3视图最初通过spread带多余元数据，改为显式四项视图后构建通过。
2. 首轮C1d Chrome为9/12。两项离线夹具在预载运行时前断网，另一个符号迁移夹具保留了未配套的位图目录；修正准备流程和完整夹具后12项通过，产品严格资源检查未削弱。
3. 全量唯一失败为B4 VIS-02取消解码计数17/14；trace显示对话框/忙碌状态改变视口后，新的idle crop也进入旧探针。C1c时等待首个crop的方法仍不能隔离后续crop。现用当前资源Blob身份WeakSet排除预览，只暂停/计数从ZIP解出的新Blob，仍执行真实解码并逐个检查关闭；两样板分别16/16、14/14，另记录忽略预览3/1。取消丢弃迟到结果及文档/历史/持久化不变断言保持，B4四项正常复验通过。探针回调类型声明另经最终TypeScript检查通过。
4. 首次生产runner在保护异步工作未结束时读到旧“已保存”，误断言r2为采用结果。等待 `.asset-busy` 清空后再读保存和画布状态，生产核验通过；没有修改产品。首轮runner、报告和日志另保留于[首次生产记录](evidence/m1-c1d/diagnostic/production-first-attempt/report.json)。

原reporter无损gzip保留全部嵌入内容；C1d及B4目标附件另外归档20份。失败截图/上下文入仓，较大的原始trace保留本地路径/大小/hash，不声称它们是便携备份。全量reporter原始93670192字节、SHA-256为 `90a53467ab91929985c91362282ee7bd5bbb4dd20922cbf03df7c550ad5877d8`；归档校验见[机械检查](evidence/m1-c1d/final-checks.json)，全文件清单见[artifact-index](evidence/m1-c1d/artifact-index.json)。

最终机械检查覆盖31份主文档的617个本地链接及11个锚点、20份目标附件、43份本地诊断与[31份源码指纹](evidence/m1-c1d/source-fingerprints.json)。验证后仅清理4个本批源码文件末尾多余空行，无语义改动。目标凭据模式无命中，LICENSE/public无本批变更；既有暂存todo.md及其末尾空行提示保留。哈希清单用于核对本次文件状态，不代替运行验证或全面凭据审计。

## 验收判定与下一步

| 质量项 | 本批可判定子项 | 仍未完成的范围 |
|---|---|---|
| QA-REC-01 | 命名/改名/删除、滚动20份保留固定历史、完整资源、明确所选备份、空库重开及元数据不进入PNG | 大规模历史资源峰值/真实容量、共享字节垃圾回收；未实现的清理工具不能记作已验收 |
| QA-REC-02 | 独立物件三组恢复语义、保留范围外后续编辑、显式误删找回、单调撤销/重做与公开范围审阅 | 持续图层/实例外观覆盖链、组合同化及通用外观恢复 |
| QA-REC-03 | 不同lineage/身份、有效锁、缺层/支撑、固定资源与不支持关系拒绝；完整当前候选校验 | 共墙/门/注记、完整组合/散布人工关系、地形/连接依赖闭包的实际恢复 |
| QA-REC-04 | 缺资源/坏hash/严格格式/超限、过期/取消/迟到、保护失败、采用后保存失败保留、真实双标签CAS和注入事务故障 | 真实浏览器配额耗尽、AI分批采用后的联合恢复及全部故障/容量矩阵 |

以上仅关闭首批适用子项，不能统一宣布QA-REC-01至04整行通过。完整交互性能QA-PERF-01/04保持开放；本批未测历史读入/差异/保护/采用/保存/导出的分段性能、RSS/堆/GPU峰值，也未重跑选择专项。不将25/26中的选择成绩外推为v4全流程成绩。跨浏览器、中文输入法、真实小团、PWA及UVTT仍未验证。

下一入口为C2建筑工具与共享结构恢复，尚未开始。C3/C4再扩展组合/非破坏性外观、地形及其依赖恢复，C5收口；通用素材入库和AI按[07路线图](07-roadmap.md)后续推进。本批保留所有既有和无关脏文件，未提交、未推送。
