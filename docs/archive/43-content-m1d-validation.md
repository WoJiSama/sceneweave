# 内容补标、题材小样、精修与M1-D续批记录

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](46-validation-retention-audit.md#7-按用户要求执行清理)。

2026-10-23；本地版本`0.2.0-m1-d2`。用户授权“既有素材补标＋墓地小样＋火山小样”，完成后精修旧素材，再开始M1-D完整续批；六项精修由实现方选择。范围与只读补标合同见[42](42-content-and-m1d-continuation.md)。本批完成需求实现与下述简单检查，**完整回归仍等用户通知**；未自动commit/push，不据本批关闭完整M1、P3或C5/性能门。

## 实际内容与入口

| 内容 | 实际交付 | 入口 / 边界 |
|---|---|---|
| 既有补标 | 原37项及全部62项提供场景/用途/材质与人工多色，只读精确身份索引 | 内置/本工程/已安装的相同固定身份可匹配；不改原发布者tags、个人整理、工程或库备份 |
| 墓地 | 5图：苔石、墓土、墓碑顶盖、石棺、铁栏；纪念小组及20×16m工程 | 首页“苔石墓园”，先检查再保存独立副本；四组纪念组合、步道、围栏和植被均真实可编辑 |
| 火山 | 5图：玄武岩、火山灰、熔岩冷壳、岩块、裂隙；岩缝组合及20×16m工程 | 首页“灰烬熔脉”；1m高台、四来源崖边、显式坡道，熔岩材质与独立危险Region分别保存 |
| 旧素材精修 | 阔叶树冠、圆叶灌丛、灰绿碎石簇、草地、裸岩、细砂六项新`.refined@1`族 | 搜索“精修”查看原件/新版真实图片并分别采用；保留全部原物理字段与确切旧来源 |
| 室内补件 | 衣架、长凳、炉台、操作桌、边柜、床、衣柜七件真实俯视物件 | 支持SCN-01基础布景；缺失时走普通完整目录候选，未使用椅子等占位冒充 |
| M1-D阶段制作 | SCN-01/04从空白逐步预览/确认/采用普通有限命令 | 左侧“工程”→“分步制作 SCN-01 / SCN-04”；状态来自当前真实内容，已有部分/不同基线或锁明确阻止覆盖 |
| C4-N02 | 新源图像、保留的实例映射、旋转范围及占地差异提示 | 选中物件的“外观变体”→“预览外观替换”；草稿接会话守卫，采用仍保留物理/支撑/阻挡/私密字段 |

本批新23图为8材质、15透明物件，均有原创SVG、实际PNG、项目MIT、像素/字节/透明边界及双SHA记录。全内置目录为**62项：38物件、19材质、5组合；57张PNG，合计1,629,765字节**。原空白工厂仍37项/34张PNG，不会打开旧工程即加图或替换实例。新增23张PNG合计1,079,491字节；完整清单与尺寸见[15](../15-m1a-asset-production-list.md)及[manifest](../../assets/sceneweave-handdrawn-content/manifest.json)。

源图采用既有可编辑SVG→Chrome栅格化管线，未调用图像生成服务，M2模型尚未接入。新增与精修均是**O/P2候选**；用户P3视觉签收另记，当前内置是开发候选目录。

## 可审阅画面

- 新件与室内补件总览（原附件已清理，旧路径：`docs/evidence/content-m1d/art-contact.png`）
- 六项旧版／精修前后对照（原附件已清理，旧路径：`docs/evidence/content-m1d/art-comparison.png`）
- 八种材质3×3拼接（原附件已清理，旧路径：`docs/evidence/content-m1d/art-tiles.png`）
- 墓园实际编辑器（原附件已清理，旧路径：`docs/evidence/content-m1d/graveyard.png`）、火山实际编辑器（原附件已清理，旧路径：`docs/evidence/content-m1d/volcano.png`）
- 雾灯宅从空白完成基础布景（原附件已清理，旧路径：`docs/evidence/content-m1d/scn-01.png`）、海岸哨所从空白完成阶段制作（原附件已清理，旧路径：`docs/evidence/content-m1d/scn-04.png`）
- 正常生产页面中的原件/精修实图对照（原附件已清理，旧路径：`docs/evidence/content-m1d/production/production-comparison.png`）

主代理实际查看了新件总览、精修前后、3×3纹理以及上述小样/普通制作/生产截图。首轮树冠/灌木叶群过粗、碎石过圆与熔岩网格过强已返工：树冠约40叶群、灌木23叶群；碎石恢复角状分面与碎片，熔岩调整为暗缝局部余热，衣架改俯视褶皱。这里只确认本批可用候选，不代签完整画风/P3。

## 格式、完整性与保全

工程继续严格v6/identity3/appearance1与有效v3，个人库v1和完整库备份不演进。新只读curation v1精确绑定完整`CatalogItem.identity.key`，没有名称或近似ID回退；固定tags与补充信息、个人整理在UI分开。索引62条、24,135字节，SHA-256为`ef044377ab8de9c4ecedf2a089926f73bdc3581ad6578857d8be8ea5d1660081`。目录详情显式打开后即加载对照图；普通列表仍懒加载并回收Blob URL。

实际CRC/PNG-SVG SHA/sRGB/RGBA8、透明RGB=0、alpha尺寸及两处manifest/MIT一致性见美术审计（原附件已清理，旧路径：`docs/evidence/content-m1d/art-audit.json`）。15物件透明留白最小22px；8材质全不透明。相同Chrome再次生成23个SVG与23个PNG的SHA均一致，见复现记录（原附件已清理，旧路径：`docs/evidence/content-m1d/art-repro.json`）。单份新PNG解码尺寸合计28,213,248字节只是尺寸计算，未测内存峰值。

六项精修逐字段保持旧版像素、逻辑/视觉尺寸、占地与偏移、阻挡、渲染和阴影类别；manifest记录旧catalogId/version/assetSHA。新素材只追加到内置提供器，实际采用仍走完整资源/许可闭包、有限预算与当前基线检查。组合保存确切成员源与模板私密性；未自动安装或自动替换当前场景。

SCN辅助只生成普通命令，建筑/室外预览沿用真实影响与跨层确认，组件/目录/显示沿既有候选；采用、撤销、保存、锁/依赖、256展开预算、保护恢复与CAS边界保持。进度不写工程字段，匹配不到真实基线时停止，不把样板加载或文档替换计作从空白创作。C2持久建筑身份、任意拓扑恢复及通用寻路没有在本批提供。

起始HEAD为`e749faba64ab2b6d15b1db6c25caa50d60a061ce`。旧资产/运行图片、既有证据、13/17–41历史报告与用户todo共1303份文件保持起始hash，见保全核对（原附件已清理，旧路径：`docs/evidence/content-m1d/preservation.json`）。本轮未清理旧数据或改写Git历史。 应用源码、包版本/锁文件与本批工具/测试hash见源码指纹（原附件已清理，旧路径：`docs/evidence/content-m1d/source-fingerprint.json`），最终链接/附件/差异核对见交付检查（原附件已清理，旧路径：`docs/evidence/content-m1d/delivery-checks.json`）。

## 实际简单检查

| 检查 | 实际结果 | 证据及限制 |
|---|---|---|
| 素材/curation/查询定向 | 3文件11/11，1.12s | 目录检查报告（原附件已清理，旧路径：`docs/evidence/content-m1d/catalog-checks.json`）；代理实际工具输出摘要，原stdout未另存。单元资源解码用明确的头/尺寸替身，实际解码另有真实Chrome生成器 |
| SCN阶段/换图领域定向 | 2文件7/7，6.57s | 工作流检查报告（原附件已清理，旧路径：`docs/evidence/content-m1d/workflow-checks.json`）；空资源包装只验证普通命令、几何/玩家投影和门前净空，不冒充图片IO |
| 小样领域定向 | 1文件2/2，956ms | 实际日志（原附件已清理，旧路径：`docs/evidence/content-m1d/samples-unit-final.log`）；真实几何/组合/危险与视觉分离，未在该纯测试中解码图片 |
| 会话守卫定向 | 1文件30/30，143ms | 实际日志（原附件已清理，旧路径：`docs/evidence/content-m1d/session-guard-unit.log`），含换图草稿 |
| 内置索引生成 | 真实Chrome完整57图字节/hash/许可/原生解码通过，2.726s | 生成器报告（原附件已清理，旧路径：`docs/evidence/content-m1d/catalog-checks.json`）；62条确切身份来自实际完整提供器 |
| 最终类型检查 | exit0 | 实际日志（原附件已清理，旧路径：`docs/evidence/content-m1d/typecheck-final.log`） |
| 正常生产构建 | 通过，Vite构建2.84s | 实际日志（原附件已清理，旧路径：`docs/evidence/content-m1d/build-final.log`）；保留chunk体积提示，本批未做性能专项 |
| 修正后真实Chrome功能流程 | **5/5，79.865s，0失败/重试/跳过，1 worker** | 紧凑报告（原附件已清理，旧路径：`docs/evidence/content-m1d/browser-corrected/report.json`）与日志（原附件已清理，旧路径：`docs/evidence/content-m1d/browser-corrected.log`）；隔离新上下文，实际UI操作，DEV仅观察状态/已存文档 |
| 正常生产简单检查 | 通过，3.733s，0页面异常 | 实际结果（原附件已清理，旧路径：`docs/evidence/content-m1d/production/result.json`）；Home检查/保存墓园、真实原件与精修图，所查DEV/性能属性不存在；没有DEV写入 |

上述单元合计是**7文件分批50项**，没有运行全量单元或全量浏览器回归。Chrome正常生产UA为`HeadlessChrome/156.0.0.0`；不把旧批其他Chrome版本的结果继承到本版。

五个浏览器流程实际覆盖：两个小样检查后完整保存、普通旋转/持久化/撤销；空白仍34图，浏览补标/对照不改工程，显式候选前不写入，采用精修后35图；选中精修树换成尺寸不同源时提示比例、Home受草稿守卫保护，预览不改工程，采用保留物理/私密字段；两个SCN从真实空白逐步完成后与原生保存文档一致。

SCN-01引导共14个状态，初始显示设置已匹配，实际执行13个普通阶段，加一次七件室内素材候选，最终r14：7房、9门、3窗、19物件、2固定组合、3GM线索。SCN-04引导共21状态，实际执行20个阶段，最终r20：2房/7墙/2开口、3地形、9来源边、1道路/1台阶、2组合、3散布及28实际物件。没有通过多次空事务凑步骤，也没有载入样板替换当前文档。

本批复现命令以[测试源码](../../tests/content-m1d-simple.spec.ts)与[正常生产脚本](../../tools/testing/content-production-smoke.mjs)为准：

```sh
npm run typecheck
npm run build
SCENEWEAVE_BROWSER_CHANNEL=chrome SCENEWEAVE_EVIDENCE_DIR=work/content-20261023/browser-corrected npx playwright test tests/content-m1d-simple.spec.ts --reporter=line,./tools/testing/compact-reporter.mjs
SCENEWEAVE_BROWSER_CHANNEL=chrome SCENEWEAVE_EVIDENCE_DIR=work/content-20261023/production node tools/testing/content-production-smoke.mjs
```

## 首轮失败与修正

1. 初始铁栏默认图像矩形包含半毫米字段，定向检查拒绝；修生成器为640×256px、2500×1000mm，重新生成/校验后通过。没有在运行时取整绕过严格合同。
2. 工作流测试曾把严格v3场景交给v2几何函数，类型检查拒绝；改用显式`geometryDocumentForValidationV3`视图，未做类型断言或降级保存。
3. 第一轮五项浏览器流程仅火山通过，4失败，记录见原结果（原附件已清理，旧路径：`docs/evidence/content-m1d/browser-initial/report.json`）。墓园树冠靠边导致25°旋转越界，整笔拒绝后工程保持；将初始树冠内移留出旋转余量。对照图位于裁剪面板下方，原懒加载不触发，改显式详情按需立即加载，普通列表保持懒加载。
4. 第一轮SCN-01期间本批仍在改Vite载入模块，出现开发会话重置与步骤等待超时，该次不算有效SCN完成证据；修正轮先冻结产品源码再串行执行。SCN-04的测试助手曾在异步候选尚未出现时检查确认框，漏点确认导致采用禁用；改为等候选按钮出现后再确认。没有移除真实确认门槛。修正轮5/5通过。

文档保留原结果索引、JSON/PNG及摘要；首轮原trace ZIP仍在`work/content-20261023/browser-initial`，报告记录确切SHA/字节，不声称ZIP已归档到文档。原13/17–41证据保持原样。

## 仍待与后续入口

本批完成补标、两题材小样、六精修与M1-D基础阶段制作功能，尚不关闭无引导手工SCN-01/04、所有固定交互/通行输入、跨新内容的完整工程/所选历史离线往返与恢复/失败/CAS矩阵、双受众4K/秘密对照、窄屏/键盘/跨浏览器联合和真实小团。上述完整回归待用户通知后统一运行；旧35/41结果不能直接充当本版通过。

P3/参考效果仍需用户看实际图与地图签收，自动化只确认所列技术与简单使用。余下性能按[34](../34-performance-followup.md)暂缓，C5与QA-PERF-01/04未通过。下一步收集本批素材/制作流程反馈并整理M1-D剩余验收输入；M2仍依路线中的固定源、明确范围、候选采用和部分恢复合同推进单件生成/同化准备，不在本轮接入模型。
