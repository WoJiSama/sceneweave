# 浏览器测试范围

当前产品入口只保留首页 `#home` 和统一工作区 `#workspace`，使用严格 `sceneweave-complete-project@1|2|3` 完整工程及原生工程／素材仓库。新空白为2，已有新标识1可建立独立视觉副本。未知 hash 回到首页，活动草稿仍接受正常离开守卫。

2026-10-25 按用户「开发阶段不需要旧工作台及首页旧版本支持」的要求，删除仅服务于旧整页工作台的测试。当前首页、样板、布局、素材、选择、混合工具、历史、AI 及 SVG 测试继续使用原生会话。U1a 的三种样板取消／采用、继续编辑、草稿导航守卫、建筑连续性、完整工程导入、资源取消与真实跨标签 CAS 均保留。

54冻结默认配置曾发现 **39个文件、142个用例**；在原37文件137项上新增精修岩岛1项及精修样板4项，含三palette真实空白闭包、SVG透明边缘CPU栅格、海岸/室内取消/采用/撤销/重载/离线双4K。M2旧入口裁剪批次为34文件127项。裁剪前清单是62文件258项；退休28组共126项，加混合文件移除的5项旧入口，合计减少131项。列表只确认发现与加载，实际执行结果见[53](../docs/53-visual-authoring.md)与[54](../docs/54-reference-quality-plan.md)，旧M2裁剪回归归05第18节。

新增 `visual-authoring`、`visual-ai-authoring`、`visual-renderer` 覆盖真实原创空白、三样板UI/离线/4K逐像素、秘密光雾过滤、实际曲线控制柄与范围确认、有限历史恢复、视觉授权/制作清单及隔离保护采用、区域滤镜羽化和透明阴影。`tests/visual-playwright.config.ts`另含`refined-island`与`refined-samples`，15项用于Firefox/WebKit，共30个执行位置；它不代表旧M2全部流程都跨引擎执行。正常生产另运行 `node tools/testing/visual-production-smoke.mjs`，共11步且只经UI写入，没有DEV钩子或真实模型请求。

完整回归运行期间保持源码冻结，使用新的Vite进程。运行中修改Workbench会使App带时间戳导入与测试的无查询导入取得不同会话实例；Q5首次120通过/22失败的运行已保留，不能将空实例失败解读为保存成果丢失，也不能以定向通过冒充重新全套通过。

## T0/T1地形专项（2026-10-26）

新增`terrain-generation.spec.ts`四项：完整2→独立3前后PNG/旧内容hash及全scope原件ZIP下载/导入；Node与真实Worker固定重放；五岩岛＋五海岸未修图完整包/全图/固定取景近景；取消/再生成/采用、手工移树与改岸50mm、撤销重做/保存冷读/完整包/双4K。最终同次4/4通过（1.7分钟），新增升级用例的早期就绪等待/定位失败与trace单独保留，详[55第17节](../docs/55-terrain-generation-design.md#17-t0t1实施与实际验证)。

当前默认配置发现40文件146项；这是加载清单，未将其标记为本批完整执行结果。54的39文件142项保留为其历史冻结记录。

```sh
npx playwright test tests/terrain-generation.spec.ts --output=work/terrain-t0t1-browser
```

相关定向单元35文件393/393、服务边界4文件78/78及正常构建通过。新格式与旧格式严格分派、完整原件保全、嵌套身份/拓扑、逐步no-op累计成本、取消/旧候选与保存失败、物化边秘密过滤/绘制均有对应单元。原始附件保存在忽略的`work/terrain-t0t1-20261026/`，最终样本来自`browser-verified/`；不拼入54旧冻结全量回归数字，也不称T7/跨引擎/正式性能或P3完成。正常生产地形专项17/17通过（396463ms），4次真实编译Worker、岩岛/海岸候选/采用/冷读完整包字节一致及双受众实际4096×3072 PNG；错误均0。首次脚本误用14PNG数量的断言失败单列保留，实际岩岛空白为13原PNG，详55。

```sh
npm run build
node tools/testing/terrain-production-smoke.mjs
```

生产脚本只用真实UI，不使用DEV钩子、存储注入或付费模型；与其他浏览器/测试/构建串行运行。输出默认留在忽略的work目录，复跑可用`SCENEWEAVE_EVIDENCE_DIR`指定新的work子目录。


## T2有限地形编辑专项（2026-10-26）

`terrain-editing.spec.ts`三项覆盖真实拖笔与Escape、键盘多笔、四笔刷、设置变化后重新预览、保护后单次撤销重做、完整包/冷重载/空库独立导入、手工移树删树锁树后拖岸、越界和锁拒绝以及实际双受众4K。独立导入按现行合同建立fresh工程身份与revision0，不要求整包hash相同；本机冷重载仍要求完整内容hash相同。实际结果与首次失败统一归[55第18节](../docs/55-terrain-generation-design.md#18-t2笔刷与局部联动实施)。

```sh
npx playwright test tests/terrain-editing.spec.ts --output=work/terrain-t2-browser
npm run build
node tools/testing/terrain-edit-production-smoke.mjs
```

正常生产脚本只用UI和编译edit Worker，不用DEV钩子或模型。输出位于忽略的work目录，与其他测试/构建串行；保留首次失败产物，复跑用新的`SCENEWEAVE_EVIDENCE_DIR`。本批只覆盖既有岸线推拉、铺材质/清空、现存曲线和有界联动，复杂布尔分裂、独立内湖/区域/AI及T7完整回归不由此验收。

## 退休的旧入口测试

这些文件依赖 `#assets`、`#history`、`#layers`、`#geometry`、`#composition` 或 `#outdoor` 整页 UI，随对应工作台一起删除。Git 保留历史版本及旧验收记录。

| 文件 | 原用例数 |
| --- | ---: |
| assets-browser.spec.ts | 4 |
| b4-privacy.spec.ts | 3 |
| b4-workbench.spec.ts | 4 |
| b5-workbench.spec.ts | 4 |
| c0-viewport.spec.ts | 6 |
| c1a-creation.spec.ts | 6 |
| c1b-selection.spec.ts | 13 |
| c1c-layers.spec.ts | 3 |
| c1c-renderer.spec.ts | 7 |
| c1d-workbench.spec.ts | 6 |
| c2-polygon-workbench.spec.ts | 1 |
| c2-structure-history.spec.ts | 4 |
| c2-workbench.spec.ts | 3 |
| c3-storage.spec.ts | 2 |
| c3-workbench.spec.ts | 8 |
| c4-storage.spec.ts | 4 |
| c4-workbench.spec.ts | 7 |
| c5-integration.spec.ts | 3 |
| c5-storage.spec.ts | 3 |
| editor-browser.spec.ts | 5 |
| editor-lod.spec.ts | 6 |
| island-browser.spec.ts | 4 |
| island-renderer.spec.ts | 3 |
| m1d-outpost.spec.ts | 4 |
| performance.spec.ts | 1 |
| study-browser.spec.ts | 4 |
| study-renderer.spec.ts | 4 |
| u1a-legacy.spec.ts | 4 |
| **合计** | **126** |

混合文件另退休：`m20f-entry.spec.ts` 的旧工程保全转换、旧个人库转换、取消转换三个 UI 用例；`u1a-workspace.spec.ts` 的六旧库发现和显式 v5 升级两个 UI 用例。`m20f-entry` 保留原生历史包导入、失败保护和重开用例；U1a 文件导入用例改为当前完整 v1 合同。

## 保留的底层检查

部分 API／资源／迁移测试仍直接调用旧数据模块，例如 `assets-resources`、`b4-package`、`b4-storage`、`c1c-storage`、`c1d-renderer/storage`、`c2-renderer`、`c3-resources`、`c4-renderer`、`c5-resource-reuse`、`study/island-assets`、`privacy/storage-browser`、`m20d-conversion`、`m20e-library`。`m20f-render` 使用旧渲染器作为独立像素参考；`u2-catalog-regression` 的第一个用例保留历史底层库与渲染验证，第二个当前两页 UI 用例使用原生素材仓库。`m2-joint-acceptance` 中旧六库转换也是直接 API 检查。

这些检查验证保留的内部算法或历史格式，不代表产品继续提供旧工作台、旧库发现或旧格式导入入口，也不能替代当前完整 v1 的 UI／联合证据。

`tests/m2-joint-playwright.config.ts` 仍发现 11 个不同用例、3 种浏览器共 33 个执行位置；部分浏览器存在明确条件跳过，必须按实际执行和跳过数报告。正式性能矩阵仍按独立计划执行，退休旧入口性能用例不表示性能门通过。

## T3五地貌与路线专项（2026-10-26）

`src/shared/terrain-generation/t3-matrix.test.ts`覆盖125地貌/seed/尺寸组合及T1兼容；`t3-route-generation.test.ts`覆盖真实指定路线、成本、完整保存与伪造回执拒绝；`geometry/terrain-travel.test.ts`核对完整转角带、障碍、连接和有限搜索。浏览器同源Worker/Node哈希及UI采用/冷读归terrain-generation.spec.ts的T3项。

```sh
npm test -- --maxWorkers=1 --testTimeout=30000 src/shared/terrain-generation src/shared/geometry/terrain-travel.test.ts src/application/workspace/terrain.test.ts src/application/workspace/terrain-candidate.test.ts src/application/workspace/terrain-review.test.ts src/application/workspace/terrain-edit.test.ts src/platform/browser/terrain-generation src/shared/scene-equivalence.test.ts
npx playwright test tests/terrain-generation.spec.ts tests/terrain-editing.spec.ts --grep 'T3|T2'
npm run check:shared
npm run build
SCENEWEAVE_TERRAIN_KINDS=river,lake,forest,hill,mixed SCENEWEAVE_TERRAIN_ROUTE=1 SCENEWEAVE_TERRAIN_CANCEL=first SCENEWEAVE_EVIDENCE_DIR=work/terrain-t3-production node tools/testing/terrain-production-smoke.mjs
```

正常生产必须在正常构建后，与其他浏览器/测试/构建串行；默认参数继续保留旧island/coast。新参数逐类检查完整候选/主工程/冷读字节、资源hash及实际双4K；取消检查默认每类，CANCEL=first只复核第一类，无DEV钩子或模型调用。实际结果与失败归55第19节，不外推到建筑周边重生成、区域/AI、跨引擎、P3或正式性能。

## T-S06、复杂拓扑与 T4–T6（2026-10-27）

`terrain-surroundings.spec.ts`覆盖既有房间、共享墙、门、院路和地形外围的候选预览/取消、保护采用、冷读及范围外保全；`terrain-topology.spec.ts`使用解除视觉绑定的合法矩形夹具，覆盖冻结范围拒绝、逐槽支撑重绑、完整包/冷读和单次撤销。两者均沿真实统一工作区运行，不提高256展开预算。

`terrain-presentation.spec.ts`覆盖T4近侧视固定源、旧地形/根锚/占地、完整工程与个人库往返、双受众4K及私密遮罩安全门。私密夹具必须提供覆盖两份配对几何和地影外扩的固定矩形遮罩；没有遮罩的场景应继续拒绝玩家投影。

T4正常生产入口另有独立smoke，只在正常构建后的dist preview中点击“新建近侧视苔岛”，等待真实素材和Canvas，检查完整包逐条hash、冷读字节一致及主持人/玩家4096×3072 PNG原生解码；不使用DEV钩子、源码导入、存储注入或模型：

```sh
npm run build
SCENEWEAVE_EVIDENCE_DIR=work/terrain-followup-20261027/t4-production-final node tools/testing/terrain-presentation-production-smoke.mjs
```

2026-10-27最终同次7步通过（41341ms，exit 0）：完整包64条清单、20张位图、19个SVG来源、20个近侧视实例，冷读SHA-256一致；GM/player实际PNG均4096×3072，页面/console/HTTP/失败请求/外网阻断均0。工程创建时间会使不同轮次的完整包哈希变化，本检查只要求同轮冷读一致。该结果只证明技术链，不关闭P3视觉签收；早期跨浏览器首轮失败及独立私密遮罩夹具结果仍按55记录。

`regional-authoring.spec.ts`覆盖三种区域配方预览/取消、区域实体保护采用、撤销/重做、来源比较、独立下钻、完整包/离线导入、双受众4K和离线网络计数。代码收尾后的当前统一验收已完成：全量单元189文件2058/2058、AI23文件292/292、共享108模块、类型/构建通过；Chromium156/156，适用Firefox/WebKit专项28/28；区域生产10项、T2编辑6项、岩岛/混合生成16项及T4近侧视生产7项均通过。条件物化不等于全量几何迁移，无法安全表达的来源继续保存在完整快照中。

T6 的作者范围和地形工具协议通过本地单元/服务边界检查；真实模型16项任务矩阵、配额/unknown重试和视觉质量签收尚未执行。当前最终证据为全量单元2058/2058、AI292/292、共享108模块/类型/构建、Chromium156/156，适用跨引擎28/28；正常生产区域、T2编辑、岩岛/混合生成和T4近侧视均通过。P3与正式性能不由这些专项自动关闭。

最新收尾补齐授权来源关联清洗/保留、独立GM道路/地标/图符逐实体遮罩、大装饰主题与完整反向折线用例，代码阶段及统一验证均已完成。修正前2052单元/290 AI/108共享和构建结果不外推；当前完整Chromium156/156、适用跨引擎28/28，区域/T2/T3/T4正常生产均通过。未执行项与首轮失败边界见[55第20.8节](../docs/55-terrain-generation-design.md#208-代码收尾后的统一验收结果)。
