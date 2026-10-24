# 场景文档与编辑契约

## 完整v1现行合同（2026-10-24）

**M2-0f已将默认主会话切到本节新标识完整v1，M2-3/4现已接通场景工具、非空SVG源与渐进同化。** 应用版本号仍为`0.2.0-m1-d2`，默认工程/个人库为sceneweave-projects和sceneweave-library，旧v6/有效v3及旧个人库仅经兼容边界只读保全转换。a至e历史见48至[51](51-m20e-library-conversion-validation.md)，f当时必要检查见[52](52-m20f-native-workspace-validation.md)，不自动转换真实用户数据。任务授权/草稿合同及本轮实际结果见[05](05-ai-and-generation.md)，M2-5受信任IP HTTPS后端与Pages真实模型必要旅程已通过，详05第15节。M2-0交接见[47](47-m20-unified-v1-handoff.md)；旧格式段保留历史能力，不原地偷换字段。

### A. 格式识别与完整模型

| 对象 | 固定标识与版本 | 必需字段/约束 |
|---|---|---|
| `ProjectData`，纯JSON | `format:'sceneweave-complete-project', schemaVersion:1` | 精确字段为format/schemaVersion/document/historyIdentity/appearance/assets/licenses/licenseBindings/authoringSources，无其他顶层键 |
| `SceneDocument` | `format:'sceneweave-scene', schemaVersion:1` | 下列完整场景字段，不继承旧SceneDocumentV2/V3，也不靠旧领域视图保存 |
| `HistoryIdentity` | `version:1` | lineageId/rootSceneId/propTokens/prefabTokens/outdoorTokens全部必需；语义完整承接identity3，不是旧identity1 |
| `AppearanceGraph` | `version:1` | sources/propSources/surfaceSources/instanceAdjustments/layerAdjustments/variants/prefabAppearanceTemplates，完整承接appearance1 |
| `ProjectBundle`，运行时交付 | `project:ProjectData`＋资源字节端口 | 每个已引用图片/SVG字节按hash可读、独立捕获；纯JSON通过不表示完整校验通过 |

旧M0的`sceneweave/schemaVersion:1`和`sceneweave-project/containerVersion:1`只交给legacy读者。分发先识别format，再检查其版本及精确字段；新标识不能交给旧读者试读，也不把未知版本降级。数据库schema版本和目录身份算法都不是工程文件版本。

完整场景必需字段集合：`format/schemaVersion/sceneId/revision/title/createdAt/updatedAt/units/exportBoundsMm/floors/vertices/rooms/walls/openings/props/regions/notes/assets/presetSnapshot/constraints/propDefinitions/materials/terrainAreas/terrainEdges/terrainConnections/paths/prefabDefinitions/prefabInstances/scatterGroups/styleThemes/activeStyleThemeRef/userLayers/entityLayers`；可选`generationMetadata`沿用已有有限来源摘要。各实体、固定定义、物理/受众、层和散布人工字段完整承接现行v3语义；不得以“统一”删掉未直接显示的字段。

`assets`以SHA256为键，每条精确为`sha256/mimeType/sizeBytes/pixelWidth/pixelHeight`，不含Blob；mime限PNG/JPEG/WebP。`licenses`以hash为键，精确为`sha256/text`；`licenseBindings`沿用subjectKind/subjectId/licenseRef/licensePath/embedding，逐主体及完整嵌入权校验。实际字节放资源端口，受控读入后校验CRC/hash/编码/尺寸/真实像素和预算；不能用描述代替字节。

资源复用凭证还必须绑定本机独立捕获的不可变字节闭包或受控资源句柄代次；相同JSON三元对象、hash声明或同一个端口对象都不能证明字节不变。重新供字节、换句柄、网络接收和持久化重读均重新完整验证。document/historyIdentity/appearance认证仍只证明这三个对象；authoringSources另行严格验证并绑定完整资源证明，不借用旧三元认证跳过。

c实现采用前一种方式：独立深冻结ProjectData和私有不可变字节闭包的确切对象对由WeakMap认证，读取只返回字节副本；联合历史按hash持有一份字节，每个工程端口只开放自身资源范围。所有输入端口逐个读取、核对hash/尺寸并真实解码，公开入口即使接收已认证包也重验。取消/失败不返回完整认证结果；图片端口为应用注入的受信实现，任务JSON不能指定实现或传免检标记。

新内容hash为规范JSON的SHA256，覆盖完整ProjectData（含源元数据、许可正文/绑定），不含资源端口、运行时认证、转换journal或本地旧原件。规范JSON递归按键的确定性UTF-16顺序排列、数组顺序保留、UTF-8无BOM、拒绝非有限数和非法JSON数据；不使用localeCompare。旧hash单独作为sourceContentHash保存，转换后必须重算，不能继续声称旧hash覆盖新结构。

### B. 身份、外观与当前/历史归属

物件/组合token、室外kind/token/topologyToken/topologyHash及全部墓碑保持；拓扑中途改变又改回仍换连续性token，轮廓循环换首点规则保持。新当前sceneId在转换journal只分配一次，revision从0开始；v6 lineageId/rootSceneId及已有token原值保留。rootSceneId标识历史根，不强制等于新副本sceneId。

新快照摘要精确字段：`id/ownerSceneId/lineageId/sourceRevision/name/kind/createdAt/contentHash`，kind为`named/protection/imported-auto`。ownerSceneId是当前归属；快照内SceneDocument保留原sceneId/revision与时间，仅转换其格式字段。普通保存的自动快照仍用所属sceneId/revision，不伪装命名快照。转换的v6自动历史为只读imported-auto，最多20份，与原生最近20次自动历史分开保留，不占32+32命名/保护限额。

旧自动行没有用户命名，imported-auto的name固定生成`自动保存 · r<源revision>`，createdAt由原savedAt转为ISO时间；这是生成标签，不冒充原始命名。原savedAt字段值及旧行在保全set中保留。

当前身份合入同一家族已转换历史的墓碑并完整验冲突，现存对象以当前拓扑token为准。跨库即使sceneId/lineage/标题相同也不自动合并。v1–v5首批只转换当前；旧全部历史保全，可显式另建工程，不给缺证明的旧对象追认连续性。v6转换保留已有有限恢复；C2建筑witness不序列化，重开/导入/转换仍清空，不因此支持持久建筑或任意拓扑恢复。

外观字段和源→层→实例优先级完整保持，固定source/variant/template不改义；源祖先、非活动位图根、人工覆盖与私密组合模板不删除。当前层规则与冻结对象批改分开，表面底材opacity仍须1。旧固定派生ID/参数和实际PNG保留，转换不能用重跑生成替代实际字节。

d已按上述身份合同转换v6家族与v6所选历史文件。新仓库最终准备和提交要求全部预留v6历史到齐，逐源键核对named/protection/automatic类别与自动revision，不能仅检查候选ID属于预留集合。v1–v5仍只转换当前，全部旧历史由set/原文件保全。共享资源批次上限85是当前＋64命名/保护＋20只读来源自动，普通便携history上限仍64。

### C. SVG源、规范化与真实光栅（M2-4已接通）

`authoringSources`以有效光栅assetId为键，每条精确为`kind:'svg'/sourceSha256/normalizedSha256/sourceSizeBytes/normalizedSizeBytes/rasterSha256/processorId/processorVersion`；processorId固定`sceneweave-static-svg`、processorVersion初始1。两源hash分别绑定原始可编辑源与规范化静态源，rasterSha256必须等于该asset的实际PNG；逻辑尺寸、锚点和占地继续由定义/实例字段表达，不能从SVG推断。

源是完整资源的一部分，同一asset的许可须明确覆盖源与派生；保留原件，源/规范化源和PNG都不可变。源字节与PNG共同进入完整/历史/目录闭包。最多256项来源、512个不同源hash，原始与规范化源各单文件1MiB、工程实际源字节合计32MiB，并计入总资源/ZIP预算；最多256张图片仍独立校验。通用不可变字节端口最多768条，为图片和两类源之和，不授予768张图片容量。这些是已实施保护值，不是容量实测。

M2-0所有转换输出`authoringSources:{}`；当时在真实SVG处理可用前拒绝非空，这是该历史切片边界。M2-4现已严格接收非空记录：重新读取并独立捕获源字节，核对UTF-8/长度/hash，重做原始与规范化源解析并核对确定性规范化结果，检查PNG尺寸/viewBox比例，经受信SVG端口实际栅格化后逐RGBA核对保存的PNG。缺SVG能力或任一步失败均不签发完整资源证明，不允许半验入库、保存、导出或渲染。

静态语法只接受svg/g/defs、有限线性/径向渐变及stop、path/rect/circle/ellipse/line/polyline/polygon和明确属性；拒绝活动XML/DOCTYPE/实体、脚本/事件、外部引用、image/text/字体/CSS、foreignObject、动画与滤镜。原始/规范化各1MiB、4096节点/32层/16384属性、256路径/16384路径命令/32768点、坐标和viewBox边8192；栅格上限边4096/1600万像素/20MiB，AI工具另限制长边16–1024像素。浏览器通过隔离Blob图片解码与Canvas生成PNG，不把源插入应用DOM；释放位图/URL，失败和取消不采用。

同化授权冻结为单件、一个公开组合的存活成员或明确目标ID和边界的局部范围，不由模型自行扫描扩圈。SVG制作/修改产生新固定资源、定义和来源版本，原件及祖先源、确切许可、逻辑尺寸、锚点、占地、支撑、通行、秘密和组合/散布人工记录保持；tint/brightness/opacity逐目标物化，范围外和当前层规则不暗改。空白制作须先有明确授权的新物件/场景放置，不能用整张SVG替代语义场景。

### D. 目录身份映射

已有位图/参数条目冻结为身份算法1：namespace、逻辑键`[1,namespace,kind,catalogId,fixedVersion]`、精确键追加contentHash。内容投影与现行catalog/content.ts一致：固定定义五集合、固定外观三集合、资源五字段元数据、排序许可hash和完整绑定；不含工程格式/ID/revision/层实例、载体hash或个人整理。空authoringSources不加入旧投影，转换后这类条目的namespace/logicalKey/contentHash/key必须逐字相同；capsuleSha256按新ZIP重算。

M2-0e已在shared/library直接实现算法1及严格完整v1中性载体，不经旧v6视图计算。载体必须完整等于固定中性工程的所选根闭包，包含祖先/非活动派生输入输出/保全定义及私密组合模板，不能携带场景实例、层规则、历史或原件；读取实际字节/许可/派生像素后重抽闭包核对。内置全部62项完整item及6组refines逐字保持，结果见51。

非空SVG源属于新增固定内容，使用已接通的身份算法2：键首项2，其内容hash覆盖`{domain:'sceneweave-svg-fixed',version:1,base:算法1完整投影,authoringSources:所选根必要源闭包}`；不能把源忽略后沿用纯位图身份。中性载体精确保留所选根及祖先所需SVG源/实际PNG/许可，个人库安装、采用与所选离线备份均完整核对；源原文改变即使规范化和PNG相同也改变身份。M2-0当时不产生/安装算法2的历史保持；此算法号与工程文件v1分开，既有无SVG素材继续使用算法1，不整体重编号。

个人tags/colors/favorite、organization-only及安装状态保持确切key关系。默认namespace/定义/物理字段/许可/固定版本不因换载体改变。62项curation和6项refines按新构造器实算旧key等价，禁止名称/catalogId/缩略图或“最新版”兜底。新库/新备份与全组织保全归06；旧40保持旧严格合同，不就地改义。

### E. 原子候选接口边界

共享应用接口区分`prepareAtomicCandidate`与`adoptAtomicCandidate`。候选绑定主工程sceneId/revision/checkpoint/contentHash、任务代次（如有）、明确scope/允许工具和字段、步骤来源、完整读写集合/差异及实际展开成本。运行时内部凭证只绑定本机独立捕获/校验后的对象，不能由网络JSON填入validated或skipValidation。

跨领域步骤先在独立副本按支持顺序执行，保留真实中间身份推进，最终完整验证、根据同一批全部实际影响计算256展开预算。不得将多轮命令绕过最终上限，也不能直接取消现有混批拒绝。对远端草稿须本地校验/重放其受支持步骤后产生自己的候选，不直接采信完整模型JSON或自报成本。

最终写目标及真实支撑几何按主工程基线及采用时当前的有效实体锁/层锁检查；只读资源、许可及排序引用保留在依赖集合，不因此获得写权限或把纯排序读取当作编辑；草稿内先解锁再编辑不授予额外权限。确需解锁时，由用户先做独立事务，原任务基线失效后重新计算。

最终采用前保护当前保存点，再源/场景/历史元数据CAS，主工程只一次revision+1与一个撤销单位。旧基线、锁/范围/资源/预算失败不部分采用；草稿保留供显式重算。M2-2建立本机授权/重放与采用入口，M2-3现已扩到有限建筑、室外、组合/散布和GM文字，M2-4加入延后物化的SVG/参数配方；均复用同一原子入口，`previewPrepared`仍限追加素材。本机依据确切基线重放全部账本，物化后的完整候选重新验证资源/像素并确认真实变化；确定性身份、256累计预算、等待本机校验及30秒采用租约保持，详细合同见[05](05-ai-and-generation.md)。场景工具不因此获得秘密改写、未授权依赖、通用寻路或持久建筑恢复能力。

以下旧格式段保留各批实现语义与历史证据；内容续批及重构前自动化结果见[43](43-content-m1d-validation.md)、[44](44-full-regression-validation.md)，现行新v1读写和主会话以上节及52为准。M1-D首批新增混合素材、可编辑SCN-04及房间材质/整墙平移/单位显示的当时范围见[35](35-m1d-outpost-validation.md)；C4当时严格v6/identity3、有效v3及appearance1语义由新完整v1承接。C5联合功能历史见[32](32-m1c-c5-validation.md)，资源复用见[33](33-c5-resource-reuse-validation.md)。现行回归结果集中在[05](05-ai-and-generation.md)与[09](09-quality-plan.md)；余下性能按[34](34-performance-followup.md)暂缓，C5及完整性能验收仍未通过，人工P3/完整SCN、小团和持久建筑/任意拓扑恢复仍待，线上HTTPS必要旅程另见05第15节。

这是对象字段、坐标、修订和几何不变量的主定义。当前类型、严格Zod Schema、几何校验和事务入口位于src/shared及src/application/workspace；src/core保留旧格式实现。文件封装见[存储与导出](06-storage-and-export.md)，AI参数见[AI 与生成](05-ai-and-generation.md)。

2026-10-23另完成U1/U2文档准备：统一工作区与个人素材组织的计划边界见本文末节及[37准备交接](37-workspace-and-asset-library-handoff.md)。本次未实现U1/U2，未新增格式、字段或仓库；精确目录合同须在U2a冻结后才能编写目录写入器。

B1的v2类型与校验位于src/core/v2，覆盖定义快照、资源引用/版本、斜墙开口、地形支撑、连接带区及组合/散布存档关系；格式可以接受完整结构，不表示所有工具已开放。B2的 `applyCommandsV2` 接受有限严格指令，整体克隆与校验，`WorkspaceV2.execute` 对变化批次只提交一次、增加revision并纳入保存/历史。支持顶点移动、墙厚/反转/拆分、材质/铺装设置、地形轮廓点、组合变换/拆分、成员位置/旋转及外观替换。墙拆分暂只提供领域API；UI提供边界、墙厚与反转候选预览。

所有受影响的实体与锚定依赖共同检查编辑锁；组合成员修改保留overrideFields，拆组保留成员身份/实际物理参数，并把组的有效GM受众写回。带局部覆盖材质的墙拆分、被组锚点注记引用的拆组明确拒绝。B3新增高程、覆盖边界、连接阻断/移除、既有散布组重生成、成员删除/退出和有限编辑锁命令；散布成员手改变为manual，删除保留旋转占地的世界AABB外扩排除区，退出固化有效私密受众。被注记引用的删除/生成移除拒绝。完整范围/基线/来源协议的v2 CommandBatch、任意绘图、新放组合/散布域与通用占地路径仍待后续；不支持的路径硬约束继续拒绝，v1入口保持独立。

B2另有明确启用的有限门口校验：仅持久化预设 `sceneweave-vis01@1` 应用入口1000 mm净宽/两侧各1000 mm，以及露台门1200 mm净宽/两侧各1500 mm的预留区。`WorkspaceV2.preview/execute` 在变化候选提交前调用同一校验，矩形跟随当前开口端点与方向，检查完整旋转阻挡占地、扣除门洞的实体墙带、miter/bevel转角和Floor边界。边界接触允许，冲突整笔拒绝且不改变修订、历史和保存队列；换外观、受众和组合中心不绕过成员检查。它不求解开门/锁门状态、通用路径、地形通行或预留区外的家具碰墙；其他工程不因标题/实体ID相似而自动启用。完整路径硬约束仍明确拒绝。

B3的 `checkTerrainTravelV2` 只检查一条明确的全宽直线走廊：有效支撑、水阻挡、真实旋转占地、墙/门状态、显式边缘和足宽未阻挡的高差连接，不搜索替代路径。`sceneweave-vis02@1` 在新编辑候选上启用required台阶（2000 mm）及两端各2000 mm接入区守卫；普通无此预设的草稿可缺连接，由局部检查说明无路。高低共边顶点和显式1500 mm浅水覆盖在UI候选中成批更新；尖角/破环/冲突整体拒绝。通用pathChecks/minPathWidthMm仍不支持。

## C0 执行快照与视口边界

`validateSceneSnapshotV2`对外部输入执行原有完整严格结构、预算、引用与几何校验，返回与输入分离且深冻结的文档，并仅在模块私有WeakMap登记该返回身份。调用者原对象不会被登记，自行浅冻/深冻、复制相同内容、复用sceneId/revision都不能跳过校验。认证只在当前运行时有效，不进入JSON、完整包、数据库或其他标签；读入后的新对象仍须严格验证。普通`applyCommandsV2`继续提供独立可变候选，既有调用者不因此获得不可变认证。

Workspace使用`applySnapshotCommandsV2`：认证当前文档可复用其输入校验，外部命令仍严格解析，在独立草稿上检查锁和依赖，变化后的最终全场景严格校验一次。候选先冻结再交给样板guard，guard不得修改候选；guard期间若工作区已有新编辑，checkpoint阻止旧候选覆盖。确定无变化的批次返回当前认证引用，不增revision、历史或保存；无效命令即使没有产生业务变化也继续拒绝。

提交通过同一严格Schema的revision/updatedAt子集核验新文档头，revision必须为当前值加一的非负安全整数；溢出在消费历史前失败。撤销/重做复用会话内已认证的冻结内容，生成新文档头，不重新克隆全部内容，也不恢复旧revision。新编辑仍清空redo，历史恢复不重新执行仅适用于新编辑的样板guard；这种内部历史能力不向普通命令或外部输入开放。

C0视口为独立会话暂态：25%–800%倍率相对于适应全图，平移/锚定滚轮缩放/适应全图只改变已有长边1200像素预览栅格的CSS变换，命中再反算世界毫米。视口不属于SceneDocument，不改变几何、实体比例、revision、撤销/重做、自动保存或固定范围PNG；当前不持久化视口。选区覆盖层也不进入工程或导出。认证复用不省略资源/许可检查，不放宽任何Schema、容器或图片限额；实现与验证边界分别见03、06和22。

C5将相同原则用于v6完整内容：证书只绑定本模块严格解析后拥有、深冻结的document/historyIdentity/appearance三个确切对象；换其中任一对象、外部冻结、同ID/revision或JSON复制均不能继承证书。严格revision/updatedAt派生只共享已认证几何与外观，独立校验合并后的出生身份/墓碑；不提供任意“已信任”标志。普通立即编辑合并准备与采用，完整输入和物化候选仍校验实际资源及原件链；有展示期的显式预览保留采用时二次检查。领域guard、player投影、完整锁/依赖/预算、checkpoint和同步回调重入检查、单次undo及单调revision不变。`lastTransaction`仅记录会话完成时间及对应修订，位于全部领域/历史更新后、通知React前；不是SceneDocument、历史信封或快照字段。实际验证与性能判定归[32](32-m1c-c5-validation.md)。

## C1a 空白工程与有限单件放置（已实现）

`createBlankDocumentV2`创建严格v2、revision=0、恰好一个Floor的空白文档，保存用户填写的名称、毫米范围及通用预设快照。初始Floor边界与exportBoundsMm相同；不包含样板房间、墙门、地形、物件、注记、组合、散布或样板专用入口约束。工程采用B2的11个与B3的7个固定PropDefinition及其对应AssetRef，版本、默认值和来源许可沿用现有目录；没有新增持久字段。实际PNG和许可字节随完整工程由06规定的资源闭包保存。

| 通用预设 | 持久初始设置 |
|---|---|
| investigation 调查 | 米制显示，metric距离偏好，1000 mm格线、100 mm吸附，默认隐藏格线 |
| tactical 战术 | 英尺显示，grid距离偏好，1524 mm格线、254 mm吸附，默认显示格线 |
| narrative 叙事 | 米制坐标显示，abstract距离偏好，1000 mm格线、100 mm吸附，默认隐藏格线；不把抽象距离等同固定米数 |

创建工厂API可明确覆盖格线显示；当前表单使用所选预设的格线默认值。名称去除首尾空白后须非空且不超过120字符；每边为1000–200000 mm的安全整数，长宽比不超过20:1。上述是C1a创建入口的保护范围，不改变既有v2导入/格式限额，也不构成大场景性能容量声明。预设只决定初始展示与吸附设置，不缩放世界坐标；当前不因此承诺完整的运行中预设切换工具。

新增有限 `addProp` 指令只接收稳定id、floorId、精确definitionRef、整数positionMm，以及可选rotationDeg/supportRef。从已采用固定定义独立复制appearance、视觉边界、实际占地/偏移、阻挡、系统绘制带和阴影默认值，不能注入任意Prop字段。新物件在同Floor、同系统绘制带内排到已有物件之上，renderOrder安全整数溢出时拒绝；不会越过系统带或改变高程。

放置表面显式选择Floor、Room或TerrainArea，默认Floor。命令检查目标存在、同层与支撑链上的编辑锁；选择Room同时写入其roomId，并检查房间的上游地形。私密房间或上游私密地形使新物件visibility为gm，公开支撑则初始为public。Floor模式中的物件保持独立：仅因XY落入某个房间，不会自动获得roomId、房间锁或房间受众；需要这些关系时须明确选择该房间。最终校验仍要求实际占地位于指定有效支撑面，不能以选择Floor绕过其上覆盖地形的支撑约束。

`createPlacedPropV2`与命令共用构造逻辑，用于尚未采用的放置预览；预览允许移到无效位置，不能据此视为合法实体。点击采用时，完整候选统一校验重复ID、精确版本、引用、整数/角度、旋转后的视觉边界及实际占地的Floor边界、有效支撑和当前样板守卫。失败或过期工作区基线不改文档、revision、撤销历史和保存队列；成功由Workspace提交一次revision+1。当前没有通用物件碰撞/通路求解，空白工程不因具备这些校验就宣称所有物件互不重叠或全图可通行。

位置/旋转复用 `updateProp`，删除复用 `deleteProp`。删除检查物件与组合/散布容器的编辑锁、锚定注记引用；组合成员保留key并置propId=null，散布成员保留deleted状态及世界排除区，普通独立物件则移除实例。目录定义及资源继续作为工程编辑根保留。保存、重开、完整包、PNG和撤销重做沿用现有v2路径；C1a没有增加用户图层、命名历史或局部恢复能力，实际验证见23。

C1a待放置图片的临时预览同样逐次检查引用/记录、实际字节、CRC/hash、尺寸与单图预算，经过共享原生解码槽。预览未就绪不能采用，失败退出待放置并保留当前工程；取消、换素材或离开时释放本次位图，不建立长期缓存。相关验证见[23](23-m1c-c1a-validation.md)。

## C2 建筑命令与现有字段（已实现；适用验证见28）

C2沿用严格`SceneDocumentV3`与完整v4历史工程信封，不新增场景/身份字段，也不改v1/v2读取行为。v3内容命令新增`createRoom/updateRoom`、`addOpening/updateOpening/deleteOpening`、`setEntranceOpenings`，以及`createNote/updateNote/deleteNote`、`upsertManualMask/deleteManualMask`与`setCanvasBounds`。编辑锁入口扩展到顶点/房间/墙/开口/注记/区域，仍须独立事务；门窗的通行锁不是编辑锁。混合建筑、既有有限内容和注记命令在独立草稿上有序执行，最终一次严格全场景校验后才暴露候选；内部draft执行器不作为绕过解析/校验的公开工作区入口。

- `createRoom`接收稳定房间ID、Floor、整数毫米多边形、墙厚及可选目标层、用途/可见性/连通声明、显式Floor/地形支撑和已采用固定地板材质。边界接受任一绘制方向，规范为正向；3–256个顶点，展开共边后仍最多256，禁止重复、自交、自接触、折返、零面积或与现有房间正面积重叠。UI数值多边形入口另限3–128点。默认`unspecified`、公开、Floor支撑，不自动重挂内部既有物件。
- 同坐标唯一现存顶点和完整共墙复用身份；新房间边插入已有共线墙端点，部分共边拆旧墙并同步邻接房间边界。原墙ID保留靠原start的第一段，拆出的墙段/切点继承原墙层，其余新房间/墙/点进入目标层。共墙厚度冲突、隐式合并多个同坐标身份或新边界穿越旧墙段内部均拒绝。新派生ID确定生成且须未占用、最长256字符，碰撞/超长不静默换身份。
- 拆分时门窗必须完整落在唯一墙段，开口跨切点拒绝；保留其世界端点、宽度、状态、秘密与通行锁。改变稳定基准需要减去的距离必须是精确整数毫米，不能四舍五入斜墙开口来凑合法值。带局部覆盖的旧墙拒绝自动拆分，避免复制内嵌覆盖身份。现有v2显式拆墙API的历史行为不因此改写。
- 门窗新增/修改显式提供附着墙、稳定计量端点、偏移、净宽和种类；开关、通行锁、秘密/揭示与编辑锁独立。最终原生几何校验真实墙长、端部间隙、最小门宽、区间重叠及引用；显式入口必须是恰好一个房间通向外部的真实门。删除仍有注记、地形连接或入口引用的开口先拒绝，需在有序事务中明确先解除引用。`required`仅验证结构连接，不能据此证明全图通行。
- 内容锁闭包包括相关墙端点/转角邻墙、邻室、开口、地形支撑、房间支撑物件、路径/连接、父组合/散布和递归锚定注记，并合成所属层锁。完整影响ID与层由预览列出，跨层影响须明确确认；不自动解锁或删依赖。建筑新增/改变/删除实体与约束修改按展开成本累计，整体仍不得超过256条操作，不能拆批绕过。
- 玩家遮罩为现存`Region.kind=manualMask`矩形，注记沿用现存坐标/实体锚点；未知字段严格拒绝。`setCanvasBounds`只修改现存Floor世界边界和固定导出矩形，各边1000–200000mm、最大20:1、起点为安全整数；同Floor全部实体作为影响/锁闭包，成本为实体数加1，保留内容最终完整校验。此命令不按秘密几何自动扩裁范围，也不改变坐标比例。

建筑预览、绘图与量尺为会话暂态。工作区采用继续检查checkpoint、当前场景/revision、资源与样板guard，再一次revision+1、可撤销、串行保存。C2本地实现及适用验证及限制见[28](28-m1c-c2-validation.md)；普通房间/墙删除、任意拓扑恢复、整组建筑变换及通用路径尚未开放。

## M0 实现范围

M0 使用简化雾灯宅验证两个公开房间与一条私密走廊，恰好一层；完整 SCN-01 与从空白绘图尚未完成。完整文档保存和历史重开以现有字段为准，不从 seed 或 Konva 重建。对象未知字段、集合键与 id 不一致、重复 ID、坏引用、非安全整数及非法几何均拒绝；稳定 ID 上限为 256 个字符。

已实现现有家具、顶点、门窗、房间属性和注记的领域操作，以及墙反转/拆分、编辑锁和会话撤销重做。UI 提供其中的样例编辑能力，不提供所有新建/删除工具。结构连通检查已实现；当前通行、家具/区域占地路径和通道求解尚未实现。非空 constraints.pathChecks 或已设置 constraints.minPathWidthMm 会明确报错，不能把未支持的硬约束当作已经通过。

M0 工程只接受 assets 为空且 Prop.assetId=null 的原创程序符号。下面保留 AssetRef、路径和 AI 的后续设计字段；字段存在不等于当前 IO 或命令已经支持其行为。几何版原型已完成首轮单元与 Chrome 浏览器检查，具体证据见[M0 验证报告](13-m0-validation.md)，不代表占地路径或完整三场景验收通过。

## 计量和标识

- 场景世界坐标采用整数毫米：x 向右、y 向下，原点由场景确定。坐标、长度、宽度、开口偏移与包围盒单位全部是 mm。画布像素只存在于表现层。
- 1 英尺 = 304.8 mm；常用 5 英尺格为 1524 mm。尺寸输入在转换到毫米后四舍五入一次；界面显示换算不反复写回，避免漂移。
- 几何吸附间距以 mm 存储，可以与显示网格分开。切换预设或单位不缩放已有实体；改变真实比例是独立显式操作，首版不提供隐式整图缩放。
- 所有 ID 是稳定、不可复用的不透明字符串，不从中文名称、数组下标或当前坐标派生。重命名不改变引用。
- revision 为非负安全整数，成功文档事务增加 1；撤销、重做也增加。禁止把旧快照修订号覆盖回正在编辑的文档。
- 角度使用 degree，顺时针为正，归一化到 [0, 360)。所有数值必须有限。M0 对房间面积与线段相交使用整数判定，面积/叉积用 BigInt 避免大坐标消减误差；只在旋转矩形家具与楼层边界比较时使用 1e-6 mm 容差。触边允许，房间正面积重叠不允许；最终持久坐标仍是整数毫米。

## M0 v1 顶层字段

| 字段 | 含义与约束 |
|---|---|
| format / schemaVersion | 固定格式标识 sceneweave；初始设计版本 1；与应用版本独立 |
| sceneId / revision | 场景身份与当前文档修订；另存副本生成新 sceneId |
| title | 主持人使用的标题；导出文件名由用户另外确认 |
| createdAt / updatedAt | UTC 时间字符串；用于显示/审计，不替代修订冲突判断 |
| units | 世界单位 mm，显示单位、网格/吸附设置；世界单位不可变 |
| exportBoundsMm | 显式的导出矩形，不根据秘密几何自动扩大/裁剪 |
| floors | Floor 集合；当前恰好一层；M1 仍为单 Floor，离散地面高度按下文 v2 契约另行表达 |
| vertices / rooms / walls / openings | 稳定 ID 索引的几何实体集合 |
| props / regions / notes | 物件、区域和注记集合 |
| assets | AssetRef 清单，不含 Blob 或外部执行内容 |
| presetSnapshot | 预设 ID、版本、显示/量尺策略快照及规则来源版本标签 |
| constraints | entranceOpeningIds、wallEndClearanceMm、可选最小门宽/通道净空、pathChecks 及约束来源；未启用项不得推成硬约束 |
| generationMetadata | 可选已采用的生成来源，见下文 |

文件中的集合不可含重复 ID；schema 校验不能通过静默丢弃重复键来“修复”文档。持久化文档不保存 Konva 类名、React state、访问令牌、当前选区、视口或未采用的 AI 提案。

## M0 v1 对象定义

### Floor、Vertex、Room

| 对象 | 字段 | 约束 |
|---|---|---|
| Floor | id、name、boundsMm | 可编辑世界边界；与可裁剪的 exportBoundsMm 独立；单层版本不表达楼梯传送或层间可见性 |
| Vertex | id、floorId、xMm、yMm、editLocked | 可被多个墙与房间共享；移动共享顶点会影响所有引用者 |
| Room | id、floorId、boundaryVertexIds、purpose、editLocked、visibility、accessExpectation | 边界是有序顶点环，末尾不重复第一个；purpose 为用途标签 |

Room.boundaryVertexIds 至少 3 个非重复顶点；M0 只接受正交简单多边形。M0 校验要求环具有正带符号面积（x 右、y 下时视觉顺时针），方向错误明确拒绝，不在导入时静默重排。不允许自交、零面积、零长边或同层室内面积重叠，允许共享边和接触。门开口不改变房间边界环。M1 计划支持含斜角的简单多边形，需要同步升级几何、共墙、门投影、净空与导出算法，当前格式读写行为不因本项计划改变。

Vertex 与 Room 边界描述墙中心线，Wall.thicknessMm 向中心线两侧各扩展一半。房间占地区域与实际可走净空分开计算；例如两平行墙中心线相距 1300 mm、墙厚均为 100 mm 时净宽为 1200 mm。房间尺寸表和生成器必须说明中心线尺寸与净空要求，不能把显示上相距一格直接当作一格通路。门 widthMm 是沿墙开口净宽，首版不额外模拟门框厚度或门扇扫掠碰撞。

初始绘制墙厚建议默认 100 mm，可在属性中显式调整；该数值是工程默认，不是建筑设计规范或跑团规则。

accessExpectation：unspecified（草稿，提示未连接）、required（必须满足指定入口结构连通）、intentionalIsolation（明确允许孤立）。手工新房间默认 unspecified。标成 intentionalIsolation 时保存主持人说明到私密注记；AI 不能把已有 required 自动降为其他值。

走廊可表示为 purpose=corridor 的 Room。v1 用 Region 表达简单室外区域或危险地带，不要求为了摆放物件先建一个封闭房间。后续完整自然地面由 TerrainArea 承担；Region 继续表达跑团区域与人工遮罩，不将已有 Region 自动解释为台地或悬崖。

### Wall 与 Opening

| 对象 | 字段 | 约束 |
|---|---|---|
| Wall | id、floorId、startVertexId、endVertexId、thicknessMm、blocksMovement、blocksSight、editLocked | 有向墙的起终点保持稳定；房间共享边只保存一份 |
| Opening | id、floorId、wallId、offsetMm、widthMm、kind、state、locked、secret、revealed、editLocked | 门或窗必须附着于一条墙；M1 没有自由悬空开口 |

Room 每一对相邻 boundaryVertexIds 都恰有一条 Wall，方向可以与房间遍历方向相反。额外独立墙允许存在，用于室内隔断或外部围栏。相交墙在交点必须共享顶点并拆分；不能出现看似连接而实际不同点的隐式连接。

部分共用墙时拆分两侧房间的边界引用，更新共享顶点与墙；不能保留两条重叠墙。wall 所邻接的房间集合从边界引用派生，不单独保存一份可编辑 roomIds。

Opening.offsetMm 从有向墙起点量到开口近端，widthMm 为沿墙宽度。必须满足 offsetMm >= 0、widthMm > 0、offsetMm + widthMm <= 墙长，并满足当前配置的端部安全间隙。初始工程默认安全间隙建议 100 mm，可在场景约束中明确修改；这不是任何跑团规则规定。相同墙上的开口区间不重叠。

kind=door 或 window；state=open 或 closed；locked 表示门窗的通行锁定状态；editLocked 表示编辑器中禁止修改。这两类锁互相独立。新门默认 closed、locked=false、secret=false、revealed=false；新窗默认 closed，移动视线行为由种类策略派生。首版窗默认阻挡移动、允许视线，不自动表达攀爬、玻璃破坏或百叶窗。

普通关闭门阻挡移动和视线，打开门释放墙上对应区间；locked 本身不画出另一堵墙。结构连接视图承认有效门，无论当下是否关闭；当前通行视图按 state/locked 计算。窗不算普通可通行连接。

secret=true 且 revealed=false 时，玩家投影把该开口补成普通墙段。revealed=true 只公开门的位置，不自动改变 state、locked 或隐藏房间的 visibility。当前M2-3场景工具只创建普通未锁门窗，固定secret=false、revealed=false，不开放AI创建秘密门；未来若增加此权限仍须明确设计意图和独立合同，不能从提示词推定授权。M2素材同化不创建或改动门语义。

移动/拆分/删除墙时，所有 Opening 必须在同一事务保持或重新挂接到唯一墙段；需要跨越拆分点的开口应使该拆分失败并提示。反转墙方向必须同步计算新 offset；UI 不依赖索引或贴图坐标推断开口位置。

### Prop、Region、Note、AssetRef

| 对象 | 核心字段 | 约束 |
|---|---|---|
| Prop | id、floorId、assetId、symbol、positionMm、rotationDeg、footprintMm、blocksMovement、blocksSight、visibility、editLocked、可选 roomId | 家具/装饰有真实占地；roomId 是可选归属引用，不是画布父节点变换 |
| Region | id、floorId、boundaryMm、kind、blocksMovement、movementCostMultiplier、visibility、editLocked | 危险、室外地面、地标或人工遮罩；可与房间面积重叠，不能伪装成结构墙 |
| Note | id、floorId、anchor、kind、可选 title、text、visibility、可选 discovered、editLocked | anchor 为实体引用或世界坐标；kind 包含 note、clue、label；标题和正文仅普通文本 |
| AssetRef | id、sha256、mimeType、pixelWidth、pixelHeight、logicalSizeMm、licenseRef、origin | 图片实际 bytes 在资产仓库；项目导出可内嵌合法资产 |

M0 的 Prop.assetId 固定为 null；symbol 必填，取 table、chair、shelf、rug 或 crate，表示原创程序符号，不引用外部素材。后续接入真实素材时再扩展支持策略，不把当前符号当作已完成图片管线。

Prop 的 footprintMm 是旋转前局部矩形占地，M0 校验旋转后的全部角点不越过 Floor.boundsMm；占地进入当前通行求解是后续工作。图片留白不自动代表可通行。视觉透明区域与碰撞区域分开。后续资产缺失可显示占位，但不可宣称视觉导出完整。

Region.boundaryMm 是独立多边形，不能被房间边界引用；遮罩用于玩家投影时必须在所有装饰、阴影之上最终合成。Region 可以表示 manualMask，但不能以“隐藏注记”替代遮罩。

Region.blocksMovement 默认 false，movementCostMultiplier 默认为 1 且不得小于 1。溪水等可设为不可通行区域，危险区域标签与物理阻挡分别表达；遮罩不能影响实际移动，M0 要求 manualMask 的 blocksMovement=false 且 movementCostMultiplier=1。后续求解中，重叠阻挡区域的并集不可通行，非阻挡区域重叠时取最大代价系数，不能靠上绘一张桥贴图覆盖阻挡语义。此为几何与路线提示数据，不进行角色行动或游泳规则裁定。

Room/Prop/Region.visibility=public 或 gm，控制对象几何输出；标签正文必须用 Note 单独表示。新手工房间/物件默认 public，新注记默认 gm。实体的技术 ID、purpose 与生成来源不自动作为玩家标签。Wall 的可见性由共享结构与玩家投影推导；Opening 用 secret/revealed 处理隐藏，不另设冲突的 visibility 字段。

当前M2-3场景工具只接受明确授权的公开几何/支撑和公开新增对象，不开放隐藏房间/通路、秘密门或GM支撑内布置；此类请求须明确诊断未支持，不能降成公开内容。模型不能改变已有实体可见性。新增AI注记始终为gm，可改写本任务新建注记，既有公开描述则另建绑定原对象的GM草稿；模型上下文不含既有GM正文。这些场景创建权限不属于M2素材生成/同化入口。

Note.discovered 只记录线索发现状态，不自动公开正文；主持人显式改变 visibility 才能发布。对象被删时附属注记随事务删除，或由主持人先改为坐标锚点；禁止留下悬空引用。删除这类操作属于手工编辑能力，M2-3场景工具提案白名单暂不提供；M2素材生成/同化也不获得删除场景实体的权限。

AssetRef.origin 存原创/导入/生成的来源类别与必要授权信息，避免绝对本地路径、provider 凭据或完整提示词。多个引用可共用相同 hash。原始资产许可及可嵌入标记见[规则与素材](10-rules-assets-and-licensing.md)。

## M1-A v2 开发契约与 B1 实现边界

本节是 M1-B/C 的实现输入，文档采用 `format="sceneweave"`、`schemaVersion=2`；工程容器采用 `containerVersion=2`、`profile="m1-assets"`、`packageMode="complete"`。它与上文 v1 是独立的严格 Schema，不能向 v1 塞入未知字段、更换 profile 冒充兼容或在导入时丢字段。B1 已新增对应领域与完整包入口；下列生成算法、依赖编辑事务和全部表现要求仍是后续实现合同，不能由格式可读推定完成。预算是拒绝策略，尚未证明样板容量或性能。修改本节基线须同步06、14及验收，不在实现过程中暗改含义。

### 公共类型、定义身份与顶层集合

所有 v2 对象采用严格对象校验：表中字段均为必填，只有标为“可省略”的字段例外；`null` 与省略不同。整数必须是安全整数；ID 为1～256字符且不接受 `__proto__`；未知字段、重复 JSON 键、集合键与 id 不一致、跨 Floor 引用、坏引用与重复身份全部拒绝。定义与场景实体不共享 ID，内嵌轮廓顶点/边段 ID 也在整个工程中唯一；模板子项键只要求在该模板内唯一。

| 公共类型 | 固定结构／约束 |
|---|---|
| PointMm / SizeMm / BoundsMm | `{x,y}` / `{width,height}` / `{x,y,width,height}`；位置为整数mm，宽高为正整数mm；Bounds可有负局部起点 |
| VersionRef | `{id,version}`；id必须命中对应定义集合的记录，version为正整数并与该记录完全一致 |
| DefinitionIdentity | `{id,catalogId,version,licenseRef,origin}`；id是不透明工程快照ID，catalogId是逻辑目录身份，origin为 `{kind,attribution,canEmbed}`，kind沿用original/imported/generated |
| SurfaceRef | `{kind:"floor",id}`、`{kind:"terrainArea",id}` 或 `{kind:"room",id}` 的严格联合；指同一个Floor |
| Appearance | `{kind:"image",assetId,tint,opacity}` 或 `{kind:"symbol",symbol,tint,opacity}`；symbol仅五种v1符号；tint为null或 `#RRGGBB`，opacity为[0,1]有限数 |
| ShadowStyle | `{directionDeg,offsetMm,blurMm,opacity,color}`；方向为世界+x轴顺时针角度[0,360)，offset/blur为非负整数mm，opacity为[0,1]，color为 `#RRGGBB` |
| 编辑实体 | 沿用id/floorId/editLocked；需要受众控制的实体另有visibility=public/gm。定义快照不可原地编辑，不以editLocked代替版本 |

同一 catalogId 的多个版本可以同时存在；同一个“定义种类＋catalogId＋version”只能对应一份内容，不能用不同 id 隐藏内容冲突。集合中的固定版本是完整快照，不能依赖目录服务器“最新版本”。复制实例复用定义快照和图片 hash，复制定义并修改内容则建立新版本。用户名称、技术ID和catalogId不自动成为公开标签。

v2 保留 v1 顶层元数据、units、exportBoundsMm、单个Floor及 vertices/rooms/walls/openings/props/regions/notes/assets、presetSnapshot、constraints、generationMetadata；按下文替换相关对象类型，并新增以下**必填**集合：

| 顶层字段 | 内容 |
|---|---|
| propDefinitions | 物件定义快照；资产字节与物件物理默认值分开 |
| materials | MaterialRef定义快照 |
| terrainAreas / terrainEdges / terrainConnections / paths | 支撑面、边缘、高差连接和路径 |
| prefabDefinitions / prefabInstances | 固定物件组合定义及采用后的实例 |
| scatterGroups | 已采用散布、人工覆盖和删除记录 |
| styleThemes / activeStyleThemeRef | 主题快照集合；当前VersionRef或null。null使用固定的v2程序默认外观，不伪称已采用插画主题 |

`assets` 的 AssetRef 保留v1字段；sha256标识规范化后实际采用并持久化的文件字节，logicalSizeMm只是导入建议，不能直接改实例占地。合法图片种类为PNG/JPEG/WebP，外部URL、SVG、HTML、脚本和字体不成为AssetRef。每个图像引用必须命中assets；每个采用的资产及定义必须具备licenseRef和必要来源记录。可嵌入完整包要求引用闭包内origin.canEmbed=true及对应许可文本，具体容器和字节校验见06。v2不把未采用目录条目、缩略图缓存或AI候选变成必需资产；素材缺失可进入独立修复预览，不能作为正常可提交工程或“完整导出成功”。

### 物件定义、实例、显示范围与占地

| 对象 | v2字段 |
|---|---|
| PropDefinition | DefinitionIdentity、name、tags、defaultAppearance、defaultVisualBoundsMm、defaultFootprintMm、defaultFootprintOffsetMm、defaultBlocksMovement、defaultBlocksSight、defaultRenderLayer、defaultShadowClass；name为普通文本，tags为去重文本数组，defaultAppearance为Appearance；新建Prop的renderOrder固定初始0、shadowOverride=null，不从图片载入顺序决定 |
| Prop | v1的id/floorId/editLocked/positionMm/rotationDeg/footprintMm/blocksMovement/blocksSight/visibility及可省略roomId；移除assetId和symbol，新增definitionRef、appearance、visualBoundsMm、footprintOffsetMm、supportRef、renderLayer、renderOrder、shadowClass、shadowOverride |

definitionRef为物件定义VersionRef或null；null允许迁移的原创符号，不接受没有定义的新增图片物件。Prop保存的是当前采用的**完整结果**，不能加载时重套definition默认值。`renderLayer` 为ground/object/canopy，renderOrder为[-10000,10000]整数，只在同类绘制层内排序；`shadowClass` 为none/furniture/vegetation，shadowOverride为null或完整ShadowStyle。定义标签、图片尺寸和树冠层均不推导通行属性。

Prop.positionMm是局部原点的世界位置；局部x右、y下、未旋转的北为-y，正旋转顺时针。图片完整像素矩形（含透明留白）线性映射到局部visualBoundsMm，再围绕局部(0,0)旋转和平移，不再叠加目录或组变换。像素锚点只能从visualBounds反算，工程不另存第二个pixel pivot。footprintMm是保守矩形，中心位于局部footprintOffsetMm；圆桌、树干首批也使用矩形。其全部旋转角点和所属支撑面参与物理校验，视觉树冠、书页留白和装饰阴影不会扩张碰撞。

supportRef指实际地面；supportRef为room时，roomId若存在必须为同一Room；非room支撑上的roomId仍只表示用途归属，不作为物理父节点，且继承该房间的保密限制。物件占地应落在对应的有效支撑面内，边界接触允许；装饰画面可越出支撑面，但仍受Floor边界与显式导出裁剪控制。M1不支持把书本/纸张作为另一物件的三维支撑面：桌面装饰与桌子引用同一地面，使用renderOrder显示叠放。替换图片/物件变体保留position、footprint、offset、支撑、阻挡和可见性；可预览更新visualBounds。改变物理值必须通过显式操作，不能因加载新定义暗改通道。

### 材质、局部覆盖与主题

| 对象 | v2字段与含义 |
|---|---|
| MaterialRef | DefinitionIdentity、name、tags、textureAssetId、defaultTileSizeMm、applicableSurfaces；applicableSurfaces为room/wall/terrain/path中的非空去重集合 |
| MaterialPaint | materialRef:VersionRef、tileSizeMm:SizeMm、rotationDeg、alignment、originMm、tint、opacity；alignment为world/surface，tint/opacity沿用Appearance约束 |
| SurfaceStyle | `{base,overlays}`；base为MaterialPaint，overlays为有序SurfaceOverlay数组；整个SurfaceStyle为null时使用固定程序颜色 |
| SurfaceOverlay | id、boundaryMm、paint、blendWidthMm、renderOrder；boundaryMm为世界坐标简单整数多边形，paint为MaterialPaint，blendWidthMm为非负整数，renderOrder为[-10000,10000]整数 |
| StyleTheme | DefinitionIdentity、name、materialSuggestions、propSuggestions、prefabSuggestions、outline、openingStyle、edgeStyles、shadowPresets、terrainCliff；建议项均为相应VersionRef数组 |

Room.floorStyle、Wall.topStyle、TerrainArea.surfaceStyle、Path.surfaceStyle取SurfaceStyle或null。每个材质引用必须满足适用表面；tileSizeMm表示**整张纹理一周期**的世界宽高，不能误当单根木板宽度。base必须为不透明铺装（opacity=1），局部overlays可以透明；overlay按renderOrder升序、相同时按稳定id排序，并裁剪到所属表面。它们只改变材质，没有独立高程/通行/秘密属性；需要不同受众时建立独立受众实体。草/岩/沙过渡用overlay，不额外制造台地。SurfaceOverlay的边界改变也必须原子校验，不能留下自交遮罩。

MaterialPaint.originMm始终存世界坐标，rotationDeg始终存当前世界方向；alignment规定整面移动/旋转时的行为：world保持原点和纹理方向，surface随明确的整面变换更新两者。仅拖动边界顶点不重置纹理原点或尺度。这样既能跨区域连续铺设，也能旋转房间铺装，不从新包围盒重新拉伸纹理。

主题的outline为 `{widthMm,color}`，仅用于墙的主轮廓；物件本体线条在PNG中，崖/岸/路径边线使用edgeStyles。openingStyle为 `{doorStrokeWidthMm,windowStrokeWidthMm,frameWidthMm,doorFill,windowFill}`；edgeStyles是shore/cliff/materialTransition/path四个必填条目，每项为 `{strokeWidthMm,color,bandWidthMm}`。宽度均为非负整数，颜色均为 `#RRGGBB`。门框只作装饰，不能侵占声明净宽。shadowPresets包含none/furniture/vegetation/wall四个完整ShadowStyle；terrainCliff为 `{directionDeg,offsetFactor,maxOffsetMm,blurMm,opacity,color}`，offsetFactor为[0,1]有限数，其装饰偏移为 `round(min(maxOffsetMm,offsetFactor*abs(deltaHeightMm)))`。Prop覆盖只替换自身shadowStyle；阴影始终沿世界方向，不随图片旋转。主题中的建议引用也是完整包依赖；仅已制作且采用的定义可进入快照，不能用未来占位引用破坏闭包。

首批主题逻辑身份为catalogId=sceneweave-handdrawn、version=1；其工程记录id仍是不透明ID。14定义艺术参数，15定义素材清单；256px/m为制作基准，不是世界坐标或Schema的硬单位。主题变更只改外观，不能暗改墙厚、物理尺寸、高度或受众。

### 地形支撑、轮廓和边缘

| 对象 | v2字段 |
|---|---|
| TerrainArea | id/floorId/editLocked、visibility、boundaryMm、groundElevationMm、coveragePriority、surfaceStyle、blocksMovement、blocksSight、movementCostMultiplier |
| TerrainArea.boundaryMm子项 | `{id,segmentId,positionMm}`；id是该轮廓顶点ID，segmentId是从此点到下一个点的有向边段ID；末尾连接第一点，不重复闭合点 |
| TerrainEdge | id/floorId/editLocked、visibility、source、neighborAreaId、kind、shoreline、blocksMovement、blocksSight、surfaceStyle、styleOverride；source为 `{areaId,segmentId}`，neighborAreaId为Id或null，kind为shore/cliff/materialTransition，shoreline为boolean，surfaceStyle采用terrain适用材质以绘崖侧/岸带，styleOverride为null或与主题edgeStyles单项同形的完整覆盖 |
| TerrainConnection | id/floorId/editLocked、visibility、kind、from、to、widthMm、openingId、blocksMovement、movementCostMultiplier、surfaceStyle；kind为stairs/ramp，from/to为 `{surfaceRef,positionMm}`，openingId为Id或null，surfaceStyle使用path适用材质 |
| Path | id/floorId/editLocked、visibility、centerlineMm、widthMm、supportRefs、surfaceStyle、movementCostMultiplier、renderOrder；centerlineMm为至少2点的世界整数折线，supportRefs为非空去重SurfaceRef数组 |

M1恰好一个Floor。未被TerrainArea覆盖的Floor基底高程固定0、允许普通步行、移动代价1；材料为空时使用程序底色，不隐藏未覆盖地面。groundElevationMm是整数离散高度，与renderOrder、coveragePriority分别保存。TerrainArea的blocksMovement/blocksSight显式给值，movementCostMultiplier为[1,100]有限数；水色、草名、阴影都不决定这些值。不会形成同一XY上下两层可行走面，桥下通行、多楼层与连续三维地形不在M1范围。

一个点的地形支撑面取包含它且coveragePriority最高的TerrainArea，否则取Floor；coveragePriority为[-10000,10000]整数，与高度大小无绑定。同优先级正面积重叠拒绝；触边允许。被覆盖的低优先级区域保留完整输入，但不在覆盖处同时通行。临界边界以两侧面邻接表达，不由点在边上的包含顺序决定。GM/玩家分别在各自过滤结果中解析，秘密小台地不得挖空公开高地。

输入轮廓为正带符号面积的简单整数多边形，不含孔洞、自交、相邻重复点或零长边。低/高台地接壤的重合段必须有一致端点；相交边先在交点显式分段。非整数交点不得偷偷截断：转换操作预览一次量化的新整数轮廓，整体重新验证，不能通过时拒绝。M1-B采用“水基底＋互相接壤的台地”，允许完整包含的高优先级私密小区域用于VIS-02隐私用例；覆盖解析可能派生孔洞/裁切环，但不提供任意孔洞的独立手工编辑。

自然轮廓的**权威存档是采用后的完整整数折线**。M1-B支持不规则多边形；M1-C笔刷/曲线输入须先转换为候选折线，再量化、简化和校验，采用后保存每个顶点/边段ID。v2不保存未定义的Bezier控制点格式，不在重开时按视口、seed或新版算法重新采样。移动已有顶点保留其ID和相邻边段ID；拆分保留一个子段的原ID、另建新ID；合并显式选择保留ID并提供旧到新引用映射。不能依靠数组下标推断TerrainEdge或连接的身份。

TerrainEdge的**位置从source派生，语义/样式可编辑**。它必须对应有效支撑面边界，neighborAreaId必须与完整GM地形解析的邻接相符，null表示未覆盖Floor侧；不能单独拖开崖面。接壤区域共边只存一个TerrainEdge，以areaId字典序较小一侧的有效源边段为source；海水基底内的岸线以岛屿轮廓为源。每个有效源边段至多一个边缘；被覆盖而不暴露的边段不保留有效边缘实体。边界交会处显式分段，使每段具有恒定的两侧邻接。生成边缘、重映射或删除旧边缘都进入同一次地形事务，绝不由渲染器私自写文档。

不同高度的邻接边强制kind=cliff、blocksMovement=true；shoreline=true可以在同一崖边额外绘主题shore岸沫，避免高差海岸必须二选一；该开关只决定外观。相同高度的shore/materialTransition仍按显式边缘阻挡与两侧地面语义计算。跨高差需TerrainConnection，不能简单把悬崖blocksMovement改成false。连接端点必须分别落在from/to的有效支撑面内且两端高度不同，from/to不能相同；widthMm为净宽，blocksMovement为显式boolean，movementCostMultiplier沿用[1,100]范围。首批连接为两端点间直线矩形走廊，必须仅跨越所声明两地面的一条邻接边，无自交或第三个支撑面，无未声明实体墙/障碍侵入；它在声明走廊内提供有条件的跨边连接，不把台阶变成第二层支撑面。M1最多一个room端，必须同时引用其有效门openingId；无room端时openingId=null。开口净宽必须不小于连接宽度，连接仍受真实门状态控制，关闭门只是当前不可通行，不使连接结构损坏。端高程从引用地面派生，不保存会失同步的第二份高度；改高度必须重验连接。

Path为带状外观及可选代价覆盖，不生成连接。缓冲形状采用世界直线段、方端帽、斜接转角（miterLimit=2，超过转为bevel），相交或折返导致自重叠时拒绝；实际带区由中心线和widthMm确定，不另存第二份可编辑轮廓。路径所有带区必须落在supportRefs并集内；跨高差仍需独立有效连接。它不会解除水域、悬崖、Region或墙的阻挡；重叠非阻挡代价按最大值合成，不承诺道路一定降低移动代价。沿岸碎石带可用TerrainEdge作散布域，无需伪造Path。

### Room支撑、高差入口与斜墙

Room v2新增 `supportRef`、`groundElevationMm`、`floorStyle`；supportRef仅允许floor/terrainArea，room内部墙中心线包围区域必须始终落在该有效支撑面内，groundElevationMm必须等于该支撑面的高度。Room地板是该地面的室内表现，不创建新的上下叠层；覆盖地形图像不抹去原地面高度。外扩墙体可跨同高程地面接缝，不可悬在不同高程地面上。Wall新增 `topStyle`，独立墙的高度归属从相邻地面验证；共墙两室高度必须相同，不能一墙暗接不同高程房间。露台用TerrainArea或明确的Floor地面，不要求造一个封闭Room。

门内/外同高度时，真实门提供结构连接；门外高度不同则还要TerrainConnection，只有门图像或贴图相接不算连通。Room/Prop的支撑引用是实际几何依赖：改台地轮廓不能把建筑或物件留在引用面之外；候选须显式重绑到等高合法面或整体失败。单独提高支撑台地可以在同事务更新该Room高度，不移动其XY；支撑不成立时不能靠自动改visibility或删物件修复。

M1手工Room允许任意整数顶点构成的直边简单多边形，包括VIS-01斜角；曲线墙不在本版。共享墙、拆分、相交点及厚度不变量沿用v1，二维净空按真实墙厚和斜墙带区计算。墙带区为中心线两侧各thickness/2的几何带，相邻墙带取并集，转角miterLimit=2、超出用bevel；不得为画面好看而挪动中心线或改变物理净宽。持久坐标是整数，表现/求交的派生点可为非整数，不写回文档充当新顶点。

Opening v2新增**必填** `offsetReferenceVertexId`，必须为所引用墙的任一端点。offsetMm从该稳定端点沿墙朝另一端量到开口近端；整数offset和width仍代表真实沿墙mm，不能用x/y投影替代。UI明确显示基准端点，moveOpening以该基准输入；反转Wall.start/end不改reference或offset，非整数斜边长也不会累积反转漂移。v1仍按Wall.start计偏移，迁移时把原start写入reference，不能回改M0历史定义。

令参考端到另一端的向量为(dx,dy)，真实长度L=sqrt(dx²+dy²)，开口两端只在表现/检查中按 `reference + s/L*(dx,dy)` 派生；s分别为offset、offset+width。端部安全间隙与全长比较可用整数平方/BigInt判定，不先把L截成轴长或整数。VIS-01斜窗offset400、width600在长sqrt(2000000)的墙上合法。拆分后开口整段必须归属唯一墙段，跨拆点即拒绝；需更换基准端点时，候选把新的沿墙offset四舍五入到最近整数mm（恰半向远离0），显示实际位移及误差，重新检查宽度/间隙/重叠后才可采用。量化只发生在一次明确编辑提交中，重开/绘制/撤销不重复量化；反转本身不触发量化。

### 组合定义、实例与人工覆盖

| 对象 | v2字段 |
|---|---|
| PrefabDefinition | DefinitionIdentity、name、tags、members；members为非空有序数组，每项严格为 `{key,propTemplate}`，key为稳定模板子项键，propTemplate为下行完整PropTemplate |
| PropTemplate | definitionRef、appearance、positionMm、rotationDeg、visualBoundsMm、footprintMm、footprintOffsetMm、blocksMovement、blocksSight、renderLayer、renderOrder、shadowClass、shadowOverride；position为模板局部坐标，其他类型沿用Prop |
| PrefabInstance | id/floorId/editLocked、visibility、definitionRef、anchorMm、rotationDeg、members；members为稳定模板key索引的 `{propId,overrideFields}` 记录，propId为Id或null（人工删除），overrideFields为已覆盖字段名去重数组 |

M1组合只含Prop，不能打包墙门、TerrainArea、其他组合或ScatterGroup。放置时模板展开为独立稳定ID的完整Prop；成员世界变换和属性是权威，anchor/rotation仅用于下一次整组变换，不在渲染时再乘一次。模板和实例都不支持隐式比例缩放，首次比例由真实mm默认值确定。整组平移/旋转先对当前成员结果计算新候选坐标并一次量化；取消不量化存档，撤销恢复原值。

overrideFields采用Prop字段名白名单（definitionRef、supportRef、roomId、visibility、appearance、visualBoundsMm、positionMm、rotationDeg、footprintMm、footprintOffsetMm、blocksMovement、blocksSight、shadowClass、shadowOverride、renderLayer、renderOrder）；成员实际值仅存props，不存另一份补丁数据。手工删除成员保留key及propId=null，升级定义时不能复活。M1首版不提供自动升级已有组合到新定义：用户可放置新版本对照，再显式替换/拆开；旧实例完整保留。拆开只删组合关系并保存有效受众，成员ID/位置/占地不变。复制创建新组/成员ID，继承覆盖与删除记录。

一个Prop最多属于一个PrefabInstance或一个ScatterGroup；不允许嵌套/双重管理。整组移动/旋转/删除/拆开必须检查组及全部成员编辑锁；组锁也禁止直接修改其成员。公开组不能公开私密成员，gm组隐含隐藏所有成员；拆组不能顺带把gm内容发布。

### 可控散布与稳定重生成

当前同步实现每次最多遍历250000候选网格，超出明确拒绝；这是保护限额，不是已测容量或性能承诺。有效公开散布使用过滤后的公开地形、路径、边缘、支撑和物件生成候选，保留已有私密managed成员。最终采用仍校验完整真实几何；若公开候选与隐藏高优先级支撑或保留的私密成员硬间距冲突，整笔拒绝，不能暗中筛掉或移动公开候选来适应秘密。

ScatterGroup字段固定为id/floorId/editLocked、visibility、domain、palette、seed、algorithmVersion、gridOriginMm、cellSizeMm、densityFactor、minDistanceMm、rotationRangeDeg、members、exclusions。domain是 `{kind:"area",areaId}`、`{kind:"path",pathId}` 或 `{kind:"edgeBand",edgeId,widthMm}`；palette为 `{key,propDefinitionRef,weight}` 非空数组，weight为正整数；key在palette内唯一，所有propDefinitionRef固定版本。algorithmVersion首批为scatter-cell-v1，seed为1～128字符文本，gridOriginMm为世界整数原点，cellSizeMm/minDistanceMm为正整数，densityFactor为[0,1]，rotationRangeDeg为 `{min,max}` 且0<=min<=max<360。

members按稳定candidateKey索引，每项为 `{propId,state,overrideFields}`；state为managed/manual/deleted/detached。managed/manual必须引用真实Prop，deleted/detached的propId为null，作为永久抑制记录；manual的实际值仍仅存props。exclusions为 `{id,boundaryMm,reason,sourceCandidateKey}` 数组，sourceCandidateKey为文本或null，reason为manual/delete/entrance；boundaryMm是固定世界简单整数多边形，不因域变大或密度变高消失。

scatter-cell-v1使用固定世界网格，以“seed命名空间＋带符号列号＋行号”形成candidateKey（为SHA-256(UTF-8(JSON.stringify([seed,列号,行号])))的64位十六进制摘要）；定义选择、单元内位置、旋转及密度筛选均从该key的确定性hash子流取样，按稳定候选顺序做间距/占地筛选。densityFactor只改变采纳阈值，不能重编号全部候选。seed、网格原点和cellSize在既有组的普通密度重生成中固定；更换这些参数是显式“重建候选网格”，仍继承全部世界排除区和人工物件。hash子流固定为SHA-256(UTF-8(JSON.stringify([seed,列号,行号,channel])))，channel仅density/x/y/palette/rotation；取摘要前13位十六进制为整数除以2^52，得到u∈[0,1)。候选保留条件u_density<densityFactor；单元内位置为gridOrigin+(列/行+u_x/y)*cellSize后按最近整数mm量化，恰半向远离0；旋转在保存范围内线性插值并量化至0.001°，随后按模360归一化到[0,360)，360回到0。palette按key字典序按weight累积分段选择；候选按行号再列号升序筛选，实际占地须完全在域内且不碰排除区，物理矩形间距至少minDistanceMm。采用过程须将具体测试向量记入M1-B证据；改变上述输出即新算法版本，不在开档时迁移随机结果。

采用时完整保存所有Prop、候选key、seed、算法/定义版本、参数和排除记录，加载从不重撒。手动移动/替换/改占地把成员标为manual；手工删除把成员标为deleted，并保存删除前旋转占地的保守世界轴对齐包围矩形（最小值向下、最大值向上取整到mm），再按minDistanceMm外扩为世界排除区。人工划区/入口保留也保存世界排除区。退出组时保留普通Prop，并将原key标为detached，避免生成第二份。

重新生成先产出候选；只可替换仍managed且未锁定的成员，保留manual、deleted、detached和所有exclusions。锁定成员不在重生成影响集合中，其位置作为间距障碍；需要修改锁定实体时整批失败。排除区禁止新候选占地相交，删除的key即使落点改变也不得复活；人工覆盖移到域外可以保留并提示，但其支撑/场景硬约束仍须合法。缺失算法版本时可继续编辑已存实例，禁用重生成并说明原因。M2-3可新增组及Prop，或对明确授权的公开组执行有限密度重生成，固定素材/域/真实依赖仍逐项检查；不能清除人工移动、deleted/detached、排除记录或解除锁。M2外观同化不调用重生成来替换成员。

### 原子依赖、锁、受众与设计限额

| 修改 | 同一候选事务内必须完成的依赖处理 |
|---|---|
| 改/拆/删建筑顶点或墙 | 相邻Room、共享Wall、Opening基准与偏移、材质覆盖边界、支撑及附属注记；开口无法保持时整批拒绝 |
| 改/拆/删TerrainArea轮廓或高程 | 解析覆盖邻接，显式增删/重映射TerrainEdge，检查连接/Path/Room/Prop支撑与散布域；不自动重新散布 |
| 改TerrainEdge或Connection | 验证源边段/两端引用、走廊净宽与阻挡；不得只改贴图位置 |
| 改/删组合或散布成员 | 同步members、覆盖或删除记录、实体注记和引用；禁止留下半组或悬空ID |
| 更换定义/材质/主题 | 先验证完整资产和许可依赖闭包，再按明确外观/物理操作更新引用；定义快照原地不改 |

影响集合先计算、预览并校验，所有需要改变的锁定实体使整批失败；纯渲染缓存可以失效重算，实体/锚点/引用/实际轮廓不能在事务外修复。只读取锁定表面的缓存不算修改该实体，但更新其依赖关系或使其几何含义变化算修改。手工删除依赖默认拒绝并列出引用者；用户选择的级联删除/重绑必须显式列在同一批次，不能静默删除建筑、连接或人工物件。定义/资产移除也执行反向引用检查。所有成功批次只增一次revision，过期候选拒绝，撤销恢复完整实体、覆盖、抑制记录和引用。

有效受众由实体自身、支撑引用、所属组合/散布共同约束：任一上游为gm则该内容不进入玩家投影，public不会反向公开依赖。TerrainEdge须source及所声明邻接均可公开，Connection须两端可公开，Path的supportRefs须全部可公开；出现混合秘密依赖时保守隐藏该实体，不用秘密裁切出的洞提示位置。玩家管线先过滤，随后重算支撑覆盖、默认边缘、材质裁剪、阴影与排序，最后按固定manualMask合成；不能沿用GM缓存。私密Note与来源元数据不进入PNG文本/元数据。规范细节与秘密配对证据见06、08、09。

本版设计限额：每个Room最多256边、每个TerrainArea最多2048边、每个SurfaceOverlay或排除区最多512边、每个Path最多256个中心点、单个PrefabDefinition最多128成员、单个ScatterGroup最多5000个活成员及10000条抑制/排除记录。总工程容量与图片/解压预算以06为主，多个小集合不能绕过总限额。这些是M1-A拒绝策略的设计数值，尚未证明其性能；M1-B用真实纹理与两样板实测后若要调整，须改规范及负例一起提交。

Note.anchor的entityKind在v1种类上新增terrainArea/terrainEdge/terrainConnection/path/prefabInstance/scatterGroup，引用必须同Floor；定义快照不是场景锚点。删除实体时附属注记按既有原子删除/改坐标锚点策略处理。constraints.pathChecks仍独立表达专项检查，不因Note支持新锚点就默认增加已实现路径求解能力。

M1手工能力不自动扩充AI权限。M2工具按05逐组启用并经任务scope控制：同化只改明确外观字段，场景工具可在已验证范围处理建筑/地形/布景。不得原地改固定定义、秘密、锁或人工记录，不接受任意JSON patch。现有几何校验与样板也不证明通用占地寻路已完成。

### v1 → v2 显式迁移默认值

迁移在隔离副本中完成，并生成独立sceneId；原v1工程/IndexedDB记录保留，完整流程见06。原有世界几何、门状态、秘密、锁、预设与注记逐字段保留；不得把旧Region转换为TerrainArea或从颜色推断高度。

| 旧对象 | 新字段／默认值 |
|---|---|
| 顶层 | schemaVersion=2；新增定义/地形/组合/散布集合为空，activeStyleThemeRef=null |
| Room | supportRef指原Floor、groundElevationMm=0、floorStyle=null |
| Wall / Opening | topStyle=null；Opening.offsetReferenceVertexId=迁移前Wall.startVertexId |
| Prop | definitionRef=null；appearance为原symbol、tint=null、opacity=1；visualBounds为以(0,0)为中心且等于footprint的矩形，footprintOffsetMm=(0,0)；supportRef指原Floor且roomId继续保留归属；renderLayer=object、renderOrder=0、shadowClass=none、shadowOverride=null；移除原assetId/symbol |
| Region / Note / AssetRef | 保留既有字段；M0支持的输入assets为空，无需伪造外部素材或许可记录 |

旧footprint若奇数mm导致居中视觉边界为半毫米，迁移visualBounds采用x=-floor(width/2)、y=-floor(height/2)，只在视觉锚点产生至多0.5mm差异，物理footprint和中心保持原值。迁移后须通过严格v2结构/引用/几何校验，失败不覆盖原文档。新增默认值不回写到v1。

以下仅演示一个迁移后的Prop和固定材质引用片段，**不是可独立导入的SceneDocument**；floor-1及mat-snapshot-1等需存在于所属完整工程：

```json
{
  "propFragment": {
    "id": "prop-1", "floorId": "floor-1", "editLocked": false,
    "positionMm": {"x": 3000, "y": 2500}, "rotationDeg": 0,
    "footprintMm": {"width": 1800, "height": 800},
    "footprintOffsetMm": {"x": 0, "y": 0},
    "visualBoundsMm": {"x": -900, "y": -400, "width": 1800, "height": 800},
    "definitionRef": null,
    "appearance": {"kind": "symbol", "symbol": "table", "tint": null, "opacity": 1},
    "blocksMovement": true, "blocksSight": false, "visibility": "public",
    "supportRef": {"kind": "floor", "id": "floor-1"},
    "renderLayer": "object", "renderOrder": 0,
    "shadowClass": "none", "shadowOverride": null
  },
  "materialPaintFragment": {
    "materialRef": {"id": "mat-snapshot-1", "version": 1},
    "tileSizeMm": {"width": 2000, "height": 2000},
    "rotationDeg": 0, "alignment": "world", "originMm": {"x": 0, "y": 0},
    "tint": null, "opacity": 1
  }
}
```

## C1b–C4 编辑契约（各批有限能力已实现，联合验收待C5）

本节规定新能力的逻辑语义，不给当前 `schemaVersion=2` 增加可接受字段。现有 `Prop.renderLayer/renderOrder`、材质覆盖、组合 `overrideFields`、执行快照和最近20份保存记录都不等于下述完整能力。C1c已冻结并实现下述v3文档/容器及独立仓库、严格字段和完整副本迁移；C1d/C3若继续新增语义也须显式演进。未冻结的序列化字段名和版本号不得作为已实现接口引用，旧读者继续拒绝未知语义。迁移和历史保留规则见[06](06-storage-and-export.md)。

### C1b：选择集合与统一命令

已实现范围见[24](24-m1c-c1b-validation.md)：暂态选择、包含/相交、组/成员、有限批量变换/复制/删除与菜单；`copyProp`克隆当前独立实例并保留有效私密性，`setEditLock`支持prefab容器。每事务最多256条命令，失败整批拒绝；没有向严格v2增加选择或用户图层字段。

框选矩形、命中结果、追加/移除选择、当前编辑目标和右键菜单均属编辑会话；它们不写入SceneDocument或单独增加revision。选择集合使用稳定实体ID，按当前视口变换反算世界位置；框选覆盖规则、组合展开选择和快捷键由[02](02-editor-ux.md)定义。选中锁定实体用于查看属性不等于获得修改权。

右键、工具栏、属性面板、快捷键与后续AI采用共用领域命令和权限判断。移动、复制、删除等批量编辑须先展开实际影响集合，在隔离候选中共同校验；一次操作只产生一个可撤销事务。部分对象不可编辑时显示具体原因，不先修改可编辑的一半。菜单展示哪些动作取决于命中对象、选择集合及已实现工具，不以菜单入口授予未实现能力。

### C1c：用户图层与系统绘制层

| 概念 | 逻辑合同 | 与现有字段的区别 |
|---|---|---|
| 用户图层 | 同一Floor内的平面逻辑集合；有稳定ID、名称、顺序、编辑锁和成员归属，作为工程内容保存 | 可命名、选择和批量管理，不是 `ground/object/canopy` 三个系统绘制带 |
| 实体归属 | 每个可编辑场景内容实体恰好归属一个用户图层；共享墙/顶点仍只有一个身份，不能为两间房复制。Floor、固定定义和图层本身不作为层成员 | 归属不替代roomId、supportRef、组合或散布关系 |
| 组合/散布归属 | 容器与现存成员保持同层，移层是整组原子操作；人工删除记录继续保留在原容器 | 拆组后成员继续保有原图层，不能借移层丢掉人工覆盖或删除记录 |
| 图层顺序 | 仅在系统允许的同一绘制带内按层顺序、实体局部顺序、稳定ID确定排序 | 不越过地面、结构、物件、树冠等系统带，不修改地面高程、覆盖支撑或Floor |
| 图层编辑锁 | 实体本体锁或所属图层锁均生效；需修改的组合/散布容器锁及其他依赖锁也参与检查，任一有效锁使整批拒绝 | 解图层锁不解除实体本体锁；锁定/解除仍是独立手工事务 |
| 编辑隐藏/独显 | 仅决定当前编辑会话中的查看/命中集合，不持久化为玩家发布状态 | `visibility`、秘密门和不透明遮罩独立，玩家投影不能以编辑眼睛图标为依据 |

用户可新建、重命名、排序、选取图层成员和移动归属；空图层可以删除。删除有内容的图层必须区分“把内容移至指定层后删层”和“删除该层内容及其依赖”，预览实际范围后原子提交，不能隐式删除内容。重命名保持图层ID；移动已有实体保持实体ID。跨层共享结构编辑遵守依赖闭包，图层不能把唯一共享墙分裂成两份。

首版采用平面图层，不把层嵌套、任意混合模式、像素蒙版或完整PS兼容作为C1c完成条件。图层外观调整由C3逐项开放支持属性；图层功能先解决组织、选择、锁和受控顺序。

#### C1c 严格 v3 合同（2026-10-21 冻结；实现验证单独记录）

新文档使用 `schemaVersion=3`，完整保留 v2 的几何、资源、定义、私密性和人工记录；只新增以下两个必填字段。v1/v2 读者继续拒绝该版本，不以删字段方式回存。

| 字段 | 严格含义 |
|---|---|
| `userLayers` | ID → `{id,floorId,name,order,editLocked}`；平面图层，全工程最多128层，每个Floor至少一层；名称去首尾空白后1–80字符；同Floor的order恰为0起的连续整数，较大值在同一允许绘制带内后画 |
| `entityLayers` | 可编辑顶层内容实体ID → 同Floor的层ID；顶点、墙、开口、房间、物件、区域、注记、地形面/边/连接、道路、组合及散布均恰有一条，未知ID或缺失均拒绝；地形内嵌控制点继承所属面的层，不重复登记 |

组合及散布中 `propId` 非空的现存成员与容器同层；移入任一成员必须展开到容器与全部现存成员。`deleted/detached` 的空引用记录保留，不作为独立成员；退出散布后保留下来的独立物件保持原层。拆组/删除清理失效归属，新物件显式采用当前目标层，复制继承来源层，拆墙及重新散布的新实体继承来源墙/容器层。迁移按每个Floor建立一个默认层，保留既有带内绘制顺序。

图层命令为新建、改名、设置层锁、同Floor完整顺序重排、移动成员和删层。内容编辑与图层组织命令不混用；锁/解锁单独提交，不借同批解锁绕过权限。层锁参与已有几何、支撑、锚点和组合/散布依赖锁检查，不能只检查当前选中项；原实体锁不被层解锁改写。移层与有内容删层先展示展开后的完整ID集合，采用时重查checkpoint、当前层/成员和锁。空层可删；有内容层仅提供明确目标层的整体迁移后删层，不提供尚未支持依赖删除的“删除全部内容”。每事务256条命令上限保留，不通过拆批绕过。

层顺序先服从系统绘制带；地形物理覆盖优先级/高程和墙洞几何保持既有语义，合法带内再按图层、局部顺序和稳定ID排序。隐藏/独显、当前层、所有层/当前层选择范围只驻留会话，重开重置。隐藏墙同时隐藏附着开口；只隐藏开口时保留墙洞。来源地形隐藏时省略其装饰派生和依赖连接；锚点隐藏时省略其文字。其他可见层上的支撑家具仍显示，不删除完整文档引用。玩家预览和正式双受众PNG忽略编辑隐藏/独显，玩家投影不携带层名或ID。

v3独立严格校验/渲染/IO入口；仅可为已有领域几何和属性面板构造显式临时v2领域视图，不交给v2渲染或持久化。认证复用只信任自身严格解析并深冻结的身份，实际资源字节/解码/许可检查继续独立执行。完整副本迁移、容器和仓库规则见06；实现与实际验证由26独立记录；本节合同不替代运行证据。

### C3与M2：非破坏性外观及素材派生

1. **固定来源。** 默认素材、导入素材、AI生成结果和参数变体都保留源定义/源资源的固定版本。修改产生新派生版本，当前目录版本升级不改旧实例；移除调整可回到该实例明确采用的来源，不能回到“目录最新版”。来源链须有界、无循环，并随完整工程保留继续编辑所需的字节与许可。
2. **有界覆盖。** 实例、组合成员及用户图层上的调整只可修改已支持的外观属性组，如明确支持的着色、透明度、材质铺装参数或阴影。优先级固定为源版本 → 图层外观覆盖 → 实例/成员显式覆盖；每项覆盖可独立停用或移除。图层覆盖只影响当前归属且支持该属性的成员，移层前预览外观变化；不支持的成员明确诊断。定义原件不改写，图片/色彩变化不改位置、占地、支撑、通行、锁、秘密或可见性。
3. **完整采用结果。** 持久化固定源/派生引用、实际采用的规范化位图字节、版本化参数及完整有效外观；有效结果与覆盖计算须一致，不能产生两个可独立编辑的真值。AI输出位图不靠seed、prompt、远端URL或provider再次生成才能重开。参数只能作为可编辑依据，完整已采用结果仍是离线重现所必需的数据。
4. **逐步扩围。** 当前M2-4支持单个公开物件、一个公开组合的存活成员和明确ID/边界的局部物件范围，不开放AI表面材质重画。后续批次须重新固定baseRevision、目标ID和允许属性组；相似风格、同目录引用或空间相邻不能授权自动传播。人工覆盖默认保护，只有本批明确选入的外观覆盖允许修改；人工位置、删除/排除记录、未选对象/属性/覆盖保持，模型建议的更大范围只能成为待选范围。
5. **采用和还原。** 预览差异、资源校验、范围/锁/基线校验后，通过与手工相同的原子事务采用；部分采用按完整依赖组重新形成候选。取消或生成失败不改源版本，已采用派生可通过撤销、移除覆盖或局部快照恢复回退。

图层外观覆盖是用户明确建立的持续规则，移入成员会继承，移出成员会失去该层覆盖；修改、停用或移除覆盖都先枚举实际受影响成员并检查有效锁，不能通过改层参数绕过成员锁。批量外观调整、AI采用和普通局部恢复默认固定本次目标ID及属性组，不暗建持续层规则；显式恢复图层覆盖本身时须按当前成员重新列出影响，不能只检查历史成员。

本节的完整来源链和可移除覆盖尚未存在于严格v2。当前组合 `overrideFields` 仅标记实际Prop哪些字段已被人工修改，不存可独立撤回的源参数链；当前外观替换也不能据此宣称已具备完整调整图层或AI同化。

### C1d起：命名快照与局部恢复

#### C1d冻结合同（2026-10-22，已实现；验证见27）

本批不改变场景字段：`SceneDocument.schemaVersion=3`继续使用严格v3的完整用户图层/几何契约。工程信封和容器独立演进为v4；`historyIdentity={version:1,lineageId,rootSceneId,propTokens}`属于完整主持人工程，不能加进v3场景JSON。`propTokens`为稳定物件ID到不可复用身份token的映射，包含已删除物件；创建新物件分配新token，普通新建/复制不允许复用已分配ID。撤销/重做保留已分配身份并集；隔离导入和另存副本保留lineage、实体ID及token。相同ID但token不同或lineage不同的快照不得用于恢复。

首批以明确ID列表（最多256）选择三种模式：仅外观恢复`definitionRef/appearance/visualBoundsMm/shadowClass/shadowOverride`，保留当前占地、支撑、位置、旋转、渲染带/顺序、层、锁和visibility；位置/旋转只恢复`positionMm/rotationDeg`；完整实体模式允许恢复现存独立物件或显式重建已删除物件，完整列出层/visibility/占地/支撑等变化。现存物件保留当前editLocked，重建物件为未锁定，不从历史重放锁。模式不隐式删除快照后新增对象。两端对象不得有组合、散布、锚点注记或路径硬约束依赖；所需现存层/支撑、固定资源和依赖锁仍须校验，缺失时拒绝，不扩展成结构恢复。当前实体及目标层有效锁、完整几何、样板约束及玩家投影继续约束候选。新素材定义不可覆盖当前同ID不同版本/内容；资源依赖无法无歧义合并时拒绝。

命名快照内容不可变，名称仅作显示；采用固定快照ID及contentHash、当前sceneId/revision/checkpoint和属性组。保护快照须成功落盘后再次核对当前基线及快照仍存在且内容一致，再以revision+1的单一事务采用。原生v3绘图仅接收完整v3场景及必要资源，工程历史元数据不进入像素投影。存储/容器和独立预算以06为主定义。

命名快照捕获一个完整、可验证的工程修订及资源闭包；名称是快照元数据，重命名不改变捕获内容。自动保存的最近20份、用户固定的命名快照、会话撤销栈和C0运行时认证快照是四种不同概念。命名与保留/删除、恢复前备份和历史导出策略以06为主；实体级恢复必须遵循本节语义。

局部恢复从历史完整快照提取“稳定ID＋选定属性组＋必要依赖”，在**当前完整工程**中建立新的候选事务；不把旧SceneDocument整体覆盖回来，不倒退revision，不丢掉未选区域后续编辑。C1d先支持无组合/散布/结构恢复依赖的独立物件及其已支持外观属性；用户可选当前实体，也可在快照中选择已删除对象。C2已本地实现下述有限同会话共享墙门/房间/注记恢复；C3已补有限组合/源链恢复，C4已补连续室外实体与显式历史散布成员的有限恢复；各自范围见本页C3/C4合同。图层选择可作为已支持成员的批量入口，但完整图层内容恢复需相应实体类型和依赖恢复均已实现。

#### C2有限结构恢复合同（已实现；适用验证见28）

结构请求只接受历史和当前都存在、类型及Floor一致的顶点、房间、墙、开口和注记，明确1–256个ID。字段组如下；`properties`包含`geometry`，不是仅业务属性：

| 类型 | `geometry`：位置与尺寸 | `properties`：位置、尺寸与业务属性 |
|---|---|---|
| Vertex | `xMm/yMm` | 同左 |
| Room | 自身`boundaryVertexIds`列明顶点的坐标 | 同左，加所选房间`purpose/visibility/accessExpectation` |
| Wall | 自身两个端点坐标、`thicknessMm` | 同左，加所选墙`blocksMovement/blocksSight` |
| Opening | `offsetMm/widthMm` | 同左，加`kind/state/locked/secret/revealed` |
| Note | 仅固定坐标锚点的位置 | 同左，加`kind/title/text/visibility/discovered`；实体锚点关系保留 |

只有明确根对象和为其写入所必需的共享顶点恢复上述字段；相邻墙/房间、开口、地形支撑、物件/父容器、路径/连接与递归锚点注记进入当前影响/锁/几何检查，但其业务字段不因扩闭包而回到历史。例如选房间不会自动恢复邻墙墙厚或附着门状态。保持当前图层、全部编辑锁、材质/资源/许可、支撑、高程与拓扑；不恢复房间边界引用、墙端点引用、门窗附着墙/计量端点、实体锚点或入口集合，不重建已删结构。

预览分两步：先检查完整根/写入/依赖ID与字段、当前/历史层关系，再准确确认全部扩展依赖及跨层影响，才能生成可采用候选。相邻新增内容只列为当前校验依赖并保留；现存历史结构也须证明连续身份。所有影响实体及当前层锁生效，写入实体展开成本最多256，不拆批。候选仍通过严格v3几何、当前样板guard和玩家秘密投影；有效开口、支撑、遮罩或资源无效则整笔拒绝，不能部分恢复。

严格v4的`historyIdentity`仍只提供C1d物件token，不能把相同结构ID当作跨会话身份凭据。C2工作区仅为本次打开后新建的命名/保护快照保留不序列化的结构连续性记录，绑定真实快照ID/hash、当前与历史完整文档及会话世代；普通JSON、伪冻结对象或重新拼同ID不能制造证据。重开/导入/切工程时清空；曾删除/重建或改变所选/必要历史结构拓扑后即拒绝，撤销回同样JSON也不重置。拓扑包括Floor、房间边界与支撑关系、墙端点方向、开口附着与基准端点、注记实体锚点；新加入必要邻接引起共享历史结构拓扑变化也可能使旧快照不适用，须重新建快照。

命名历史仍完整落盘/携带，但连续性记录不进入v3场景、v4信封、数据库、包或玩家输出；导入/重开后可查看旧快照并沿用C1d适用物件恢复，旧结构恢复明确拒绝。未来持久结构身份、跨会话结构恢复或拓扑恢复须新版本字段、严格读者分派与完整副本迁移，不能给当前严格格式偷加记录。采用沿用flush、来源hash/元数据/场景CAS保护点、二次基线校验及一次revision+1可撤销事务；资源使用当前完整闭包，范围外新编辑保持。实际验证见[28](28-m1c-c2-validation.md)。

下表为C1d至C4的整体恢复目标。C1d提供上述三种独立物件模式，C2补有限同会话结构模式；当前C3在独立v5合同下增加有限组合/成员关系、外观源链及当前层规则恢复，具体范围与证据见本页C3章节及[29](29-m1c-c3-validation.md)。C4进一步提供持久室外连续身份与有限地形/散布恢复，见本页C4合同及[31](31-m1c-c4-validation.md)。完整图层内容、任意拓扑及持久建筑恢复仍未提供。


| 恢复模式或变化 | 必须处理的含义 |
|---|---|
| 仅外观（默认） | 恢复所选属性组在快照中的有效外观及固定资源依赖；当前层覆盖已改变时，必要的差异写为所选对象的显式实例覆盖，不能为找回一件物品而修改共享层规则。保留当前位置、几何、占地、支撑、锁、归属和visibility；这不承诺恢复历史整图像素。不能用支持的覆盖链表达时拒绝；视觉范围或阴影变化仍重查遮罩 |
| 原参数与层规则 | 用户可明确选择“恢复对象原参数并沿用当前层效果”，此时展示与历史有效外观的差异。只有另选“恢复图层覆盖”才修改持续层规则，并按当前全部受影响成员重算范围、锁和隐私；不从选中层内几个对象推定整层恢复 |
| 完整选中实体 | 显式列出被恢复的属性、重建/删除关系与扩展影响；现存实体保持稳定ID。恢复已删实体须验证同一身份，ID不可复用，也不能靠名称匹配 |
| 快照后新增内容 | 默认保留。完整图层内容恢复如需要移除后增成员，必须在差异中逐项列出删除及依赖；仅外观或普通实体恢复不隐式清除它们 |
| 名称或图层变化 | 同ID改名仍是同对象；默认恢复所选属性时保留当前名称/层归属。显式恢复这些属性才按历史关系处理，缺失图层需纳入依赖或拒绝 |
| 结构/支撑依赖 | 共墙、顶点、附着开口、房间、支撑面、边缘、连接和锚点注记须构造最小必要闭包；涉及范围外对象时先列出扩展，不可复制共享墙或留下悬空引用 |
| 组合/散布人工记录 | 同时检查成员key、完整实体、overrideFields及manual/deleted/detached/exclusions。外观恢复保留人工移动/删除；完整关系恢复若会复活或删除成员必须明确列出，不能重新运行seed代替历史结果 |
| 锁及受众 | 当前有效锁优先，恢复不混入编辑锁变更，解锁/锁定仍是独立手工事务。外观恢复保留当前visibility；显式完整恢复若使任何内容更公开，须列出变化、重新审阅玩家输出并通过保密校验 |
| 场景身份 | 只接受当前场景或有可验证迁移/分支来源关系的快照；不同lineage或无法证明关系时拒绝按ID拼接，独立副本保留供查看 |
| 缺失/淘汰/冲突 | 快照、固定定义、字节或许可缺失，以及依赖冲突均拒绝该恢复候选，不拿最新版、占位图或当前同名对象补齐 |

局部恢复与当前编辑一样检查完整文档、几何、约束、有效锁、资源与玩家输出规则。预览携带sceneId、baseRevision、快照身份及范围；当前文档、目标图层成员或资源基线变化后须重新生成预览，旧候选拒绝采用。恢复前完整备份成功后才采用；备份失败/配额/CAS冲突保留当前分支。采用形成当前revision+1的单一可撤销事务，再按同事务CAS保存；具体落盘和取消边界见06。不得把内部历史重放的特权暴露给普通恢复命令。

## 连接与通行

1. 房间邻接从共享墙与房间边界派生。
2. 结构连接从有效门与走廊派生；入口是与外部连通的显式门户集合，至少可手工指定。
3. 当前可通行图在结构上叠加门状态、物件占地、Region 阻挡/代价和含墙厚的通道净宽。
4. 房间级连通不证明家具之间有可行路线；生成器与专项检查还需进行占地栅格或几何路径验证。
5. 门宽、通道净宽与需要到达的入口是场景约束。默认值属于生成偏好，不伪装成 CoC/D&D/匕首之心统一规则。

required 的含义是能通过结构连接到任一指定入口。具有真实门的密室/锁门房间可以保持 required，其例外只作用于当前状态下的通行检查；只有明确允许无结构连接的空间才设 intentionalIsolation。是否必须在当前开锁状态下可达，是独立约束，不能混入默认结构连接判断。没有入口且全部 unspecified 的手工草稿显示诊断；一旦有 required 房间却没有指定入口，无论手工还是 AI 都不能提交该硬约束声明或相关无效修改。

requiredRoomIds 从 Room.accessExpectation 派生，不在文档保存第二份可编辑列表。后续 constraints.pathChecks 可描述起点/终点锚点（实体或坐标）、净宽、结构或当前通行模式，以及主持人明确允许假设打开的门集合；假设开门仅用于检查，不修改真实 state/locked。室外路径限制在 Floor.boundsMm 内，导出裁剪不改变通行结果。wallEndClearanceMm 保存当前采用的端部间隙，默认建议 100 mm。M0 明确拒绝非空 pathChecks 和已设 minPathWidthMm。

## CommandBatch、撤销与锁

| 字段 | 含义 |
|---|---|
| batchId | 一次事务标识，重复应用必须被检测 |
| sceneId / baseRevision | 请求所依据的场景与修订 |
| source | manual、ai、import、history 或 migration |
| origin | 可选 requestId / proposalId，用于 AI 请求归属与重复采用检测，不替代 source 枚举 |
| scope | 允许影响的实体/区域及显式范围说明；范围扩大需要重新预览 |
| operations | 有序领域操作，不接受任意脚本或裸 JSON patch |
| label | 面向用户的撤销描述 |

每个操作计算完整影响集合。改变共享墙会触及邻室、顶点、开口与关联物件；任何被触及的 editLocked 实体都导致整组失败。对 AI 来说不在 scope 内也失败。对手工操作，由交互预览显示扩展影响并由用户操作明确提交；不能只锁住一个贴图而放任几何被相邻修改带走。

锁定/解除编辑锁是主持人专用的独立事务，允许只改变明确选中对象的 editLocked，而不能借同一事务顺带修改锁内几何或内容。该例外不在 AI 白名单内。单线历史的撤销/重做可以重放自身锁变更；它基于当前历史头和修订校验，不是给普通命令绕过锁的权限。

M0 对 source=ai 明确返回未启用，外部 source=history 也不能伪造历史重放；AI 的 scope 与提案采用仍待 M2 实现。锁定/解锁只接受独立的 manual 批次。

完整批次在候选状态上计算，统一校验后一次提交。不将前几个成功操作先应用再留下后续错误；后续选中AI部分建议时按依赖组构造新的完整批次重新校验。undo/redo恢复内容，保留同一sceneId，并以当前revision+1提交。新的普通编辑清空redo分支。M0与v2 Workspace对外发布深冻结快照；C0只在上述认证边界内共享历史内容，会话历史不跨重开恢复。物件/几何拖动中的位置应属暂态，释放时仅提交一次；取消或基线修订已变化时不提交。C0的视口平移属于看图操作，结束手势也不提交文档事务。

## 生成与预设元数据

当前generationMetadata仅记录已经采用的brief摘要、generatorVersion、seed、模型/适配器标识与生成时间等来源；它不具备完整素材派生链，也不能替代实际位图、参数和固定版本存档。M2素材生成/同化的来源与采用记录须随新契约显式演进，旧布局来源字段不承担新的隐含语义。摘要默认属于GM工程内容，不能进入玩家图或无关网络日志。用户可选择不保存来源文字；禁止凭据或原始模型隐藏推理入档。

presetSnapshot 包含 presetId、presetVersion、distanceMode、单位/网格建议、采用的规则来源标识及自定义覆盖。选择新预设前显示变化；手工覆盖是否重置需明确，坐标绝不随预设切换改变。旧存档按快照重开，不用最新预设悄悄替换规则。

## 版本、错误和兼容

- 文件格式版本独立于 appVersion、presetVersion、generatorVersion。修改必填字段或含义时需要显式格式迁移。
- 新版本导入旧文档先在隔离副本迁移、校验，再保存为当前格式；原文件保留。失败给出对象级诊断。
- 老版本遇到未知主格式或未知必须理解的实体，不做静默丢字段保存。首版可以拒绝并说明需要更新版本。
- 文档容量、图片大小、ZIP 条目与解压限制由导入策略规定；读取者必须限制资源，不能把“合法 JSON”当作足够验证。
- 可修复的缺失素材与结构损坏分开报告。结构损坏不能进入可提交文档；允许下载原始文件保留，但不能标记修复成功。

硬不变量、暂态草稿诊断与专项生成约束应分别返回，保证编辑流程可用。对应验收与负例见[质量计划](09-quality-plan.md)。

### C3 冻结契约：完整组件工程信封 v5（2026-10-22，本地实现）

C3不向既有严格SceneDocument v3或v4历史信封增加可忽略字段。新增严格`CompleteProjectV5`，内含原生、完整的有效v3场景，以及必填`appearance`图和`historyIdentity` version 2；文档、资源和许可共同构成唯一持久化单元。显式v3视图仅用于已有原生渲染和领域工具，不是降级保存通路。旧v4读者必须拒绝v5；容器/独立仓库及完整副本迁移见06。以下为本轮实现合同，实际通过范围以[29](29-m1c-c3-validation.md)证据为准。

`appearance.version=1`包含固定`sources`、现存物件/已设样式表面的`propSources`/`surfaceSources`、`instanceAdjustments`、`layerAdjustments`、`variants`及`prefabAppearanceTemplates`。源保存完整物件外观快照或完整SurfaceStyle，以固定ID引用；父源最多16层，拒绝环、悬空与未知字段，不能原地升级来源。物件源不包含位置、占地、支撑或公开状态。固定源及派生资产保留完整实际字节、定义、许可和有界来源闭包，删除实例后不得产生现存目标悬空映射。

覆盖按固定源→当前用户图层→实例/成员求值；每项有独立ID、enabled及有限参数：调色为`#RRGGBB|null`、亮度0.25–2、透明度0–1、物件阴影为既有类别。同种参数逐级覆盖，不隐含相乘。持续图层规则与冻结ID的单次批量明确区分。显式选择含不支持的实体则整批拒绝；图层规则列出当前支持范围及不适用项。切层、关闭/移除任一覆盖后重新求有效外观，物理/通行/秘密不变。实际影响及依赖锁展开计入256操作预算，不能自动拆批绕过。首批颜色/亮度支持真实图片和已设样式表面；符号物件不支持颜色派生，不宣称原生渲染已支持符号调色。

颜色位图派生记录源assetId、调色、亮度和输出assetId，规范化后存实际输出字节；必须按源像素和参数核对输出，不能只信声明hash。透明alpha保持，原生v3有效物件引用实际位图且`tint=null`；透明度与阴影仍为完整有效字段。材质调整保留铺装几何、覆盖区域及高程。既有严格v3要求SurfaceStyle底材opacity=1；本轮物件透明度支持0–1，阴影参数只调整主题类别并保留源自定义shadowOverride；已设样式表面或含其图层设opacity<1明确拒绝整批，不放宽旧约束。导入静态PNG/JPEG/WebP显式声明图像/占地或铺装毫米、阻挡属性、标签、完整许可与署名和嵌入许可；未经校验的候选不进入工程/历史。

固定组合可从同层、同Floor的独立物件保存定义和成员来源/覆盖、明确放置、按当前实际成员及删除记录复制、拆开和删除。首批不含嵌套组合/散布/结构组。来源私密性保留于固定模板，不能由模板缺省值暗中公开。历史身份version 2增加`prefabTokens`，物件与组合合计最多65536个出生身份；删除后ID不得普通复用。成员恢复校验组合身份、固定定义版本、成员key/映射及双方出生身份；关系恢复逐项列出现存修改、重建、删除及人工记录，不重新生成成员。

外观局部恢复默认固定历史有效外观到所选实例，保留当前图层规则及未选对象的后续编辑；另提供“历史源/参数＋当前层效果”模式并预览差异。图层规则恢复是显式独立范围，列出当前受影响成员及有效锁。组合关系恢复与独立物件完整恢复区分；后续C4的有限散布/地形依赖范围见下节。恢复继续使用真实快照、内容hash、保护点、源/场景/元数据CAS、单调revision及一次撤销语义。C2结构恢复维持原有会话连续性证明与拒绝条件，不因C3身份扩展变成持久结构身份。

## C4：室外身份与有限手工工具（严格v6合同，本地实现）

用户2026-10-22“做”授权后，C4采用独立严格v6工程信封；有效SceneDocument仍为严格v3、非破坏外观图仍为appearance1。当前/历史完整信封继续保存document、historyIdentity、appearance及完整资源/许可，不用v3或v5视图替代保存。实现与实际验证范围见[31](31-m1c-c4-validation.md)，准备交接30保留原状态。

identity3严格字段为version=3、lineageId、rootSceneId、propTokens、prefabTokens、outdoorTokens。前两种出生表延续C3；outdoorTokens每个ID记录kind、token、topologyToken、topologyHash。kind限定terrainArea/terrainPoint/terrainSegment/terrainEdge/terrainConnection/path/scatterGroup/scatterExclusion；出生token及室外拓扑token全局唯一，三类出生表及墓碑ID合计不超过65536。topologyHash为当前关系的规范SHA-256；轮廓忽略循环起始行但保留有向邻接，path包含Floor/supportRefs，scatter包含Floor/domain/seed/algorithmVersion。坐标、高程、材质和业务参数不作为拓扑。普通拓扑变化生成新topologyToken，撤销/重做不能回退令牌来伪造旧连续性；删除墓碑保留，同ID/type/Floor不足以认同一实体。C2建筑仍使用原会话witness，C4不扩充持久建筑身份。

新户外命令以严格白名单创建/修改/删除地形、来源边缘、连接、道路、用途/危险Region与散布；世界坐标整数毫米，采用前严格检查完整场景、资源、有效锁及玩家输出。新地形生成固定点/段ID；显式来源边缘规范化唯一来源/邻接，高差必须阻挡。轮廓/高程变化不在事务外偷偷改边缘或重生成散布；必要来源重映射必须明确同批列出，不能保持的附着拒绝。道路使用已定义方端帽/miterLimit2及bevel带区、显式支撑和独立移动代价，材质不授予高差通行或全图寻路。

预览列根、真实改变、创建/删除、只读依赖和跨层影响；几何不变而支撑/附着/可见轮廓含义变化的依赖也要列出。实体、当前图层和必要支撑锁共同约束；修改实际语义也算修改，纯读依赖不等于写入。每次最多256条实际展开操作，实体、成员记录及抑制/排除写入计入，不以单个regenerate命令规避预算，不自动拆批。

散布candidateKey继续标识算法候选槽位；仍存活的同候选成员保留物件ID与出生token，新出生成员取得从未使用的ID。人工移动、覆盖、deleted/detached、锁与所有当前exclusions优先，C3固定源与实例外观不能被默认重生成覆盖。密度淘汰不等于用户删除；普通重生成没有历史复活权限。保存完整实际实例及人工记录，关闭重开不运行seed重建。

恢复新增outdoorGeometry、outdoorProperties和scatterMembers；appearance/source延伸到连续身份可证的现存室外表面及散布成员。首批室外几何/业务恢复保留当前拓扑、层、锁、支撑关系及范围外后改，只接受同出生/拓扑令牌和合法当前依赖；当前新增依赖重新检查，不隐式恢复历史拓扑。默认外观保留当前人工位置、删除、退出、排除和后增成员，必要实例覆盖隔离当前层；原源/参数模式显式沿用当前层规则并列差异。历史散布成员重建是独立显式模式，使用快照真实完整Prop及出生证明，逐项列成员/删除/排除记录变化，只调整本次明确范围；不能清空后续人工或入口排除，也不能运行seed替代历史结果。

所有恢复保持真实快照ID/hash、固定来源祖先及确切许可、完整依赖确认、先保护当前、源/场景/元数据CAS和一次revision+1可撤销采用；失败/取消及采用后保存失败沿06保全双方。玩家派生先过滤私密上游再计算公共支撑/边缘/道路/材质/阴影，最后固定遮罩；实际PNG不携带私密元数据。表面底材opacity=1及源自定义shadowOverride优先规则保持。


## M1-D 首批显示与混合场景合同（2026-10-23）

继续使用严格v6完整信封、identity3、appearance1及有效v3场景；新目录/固定定义是完整资源数据，不新增保存字段。`setSceneDisplay` 独立原子事务只更新既有 `units.display/gridSizeMm/snapMm/gridVisible` 和 `presetSnapshot.distanceMode/gridSizeMm`；世界单位保持整数mm，固定预设ID/版本/来源、几何、占地、支撑、通行、图层、锁与外观/历史身份保持。显示预设取既有调查/战术/叙事默认值，不重置固定样板的校验标识。不能与解锁、内容或组织操作混批。

房间材质使用既有 `setSurfaceMaterial`；整墙平移在同笔事务移动两个稳定端点，保留开口端点基准与沿墙偏移，并检查真实邻墙、房间、开口、支撑与注记/图层依赖及256预算。有限哨所守卫按固定 `sceneweave-scn04@1` 检查两门结构净空、至少2m道路、明确接到台阶低端及唯一台阶接入；关门是合法编辑，当前路线另按门状态显示。道路首段与1.2m南门分别检查，未承诺一条全程2m路线或任意寻路。未知样板版本不显示通行成功。固定源/派生实际位图、许可及私密投影规则不降级，见[35](35-m1d-outpost-validation.md)。

## U1/U2 准备：会话、目录身份与个人组织（计划，未实现）

本节保留U1/U2准备时PRD-034—037的职责边界和“计划，未实现”语境，历史入口见[37](37-workspace-and-asset-library-handoff.md)、[36](36-workspace-and-asset-library-proposal.md)。准备时使用严格v6/identity3/appearance1及有效v3，以下概念当时不是新字段，也未在该准备批次分配新版本。现行M2-0完整v1与个人库已在本页开头和06独立定义并实现，不能将本节旧状态解释为默认UI仍未切换；当前顺序见07，实际主路径检查归52。

U1a/b计划由一个编辑会话持有唯一当前完整工程。只读浏览模块面板保留当前选择、视口、当前层/编辑隐藏状态、各模块草稿/搜索、待审阅候选、撤销与保存/错误状态；这些状态不因面板位置调整而写入SceneDocument。只允许一个活动待审阅候选；回首页前须先明确结束冲突草稿、采用或取消待审阅候选，保存保护完成后首页与“继续编辑”仍沿用同一会话，保留选择/视口/撤销和连续性证明，不执行open/import。互斥指针工具或冲突编辑也不能暗丢草稿或候选；异步结果仍绑定原generation/checkpoint，返回面板不能取得新的可信基线。实际重开、导入或切工程继续使相应会话连续性证明失效；仅浏览面板或安全首页往返不应等同重开。浏览器重载只承诺恢复已持久化内容，不新增草稿或撤销栈的跨重启存档。格线/单位继续是现有工程事务，布局偏好独立在本机按版本保存，损坏时复位，均不混入历史身份。

### 固定内容与个人组织分别负责什么

“内置素材／我的素材／本工程”是目录浏览范围，不表示自动分享或同一份可变定义。浏览本工程不自动将条目推广到个人库，保存到“我的素材”须明确采用范围。个人组织记录以确切固定来源身份关联，须区分定义种类、逻辑目录和固定版本并核对内容；工程快照ID、显示名或位图hash单独都不足以替代该身份。精确编码与来源命名空间由U2a冻结。既有“同种类＋catalogId＋version只能有一份内容”不变，同身份不同内容不得静默合并或用改快照ID掩盖。

| 数据责任 | 计划边界 |
|---|---|
| 发布者固定定义、标签与来源 | 沿用不可变内容。发布者改默认标签也要发布显式新固定版本；目录更新不改已采用工程 |
| 个人标签、人工颜色描述与收藏 | 独立、带版本的组织记录，绑定确切固定来源；不修改发布者字段、资产字节或定义默认值，也不增加工程revision |
| 目录索引、缩略图与资源安装状态 | 用于浏览和提示可用性；索引/缩略图不能证明完整资源已安装或已获嵌入许可，不能作为保存的唯一内容 |
| 工程采用内容 | 保存确切固定定义、源/父源、成员、实际资源及许可闭包；个人全库整理不自动随工程分享 |

组合从本工程显式存入个人库、库备份/恢复及随后放置的闭包，必须包含`prefabAppearanceTemplates.visibility`、每个成员的source/adjustments、完整来源祖先、非活动派生保全定义及其实际字节和确切许可。不能只复制`PrefabDefinition`再调用同步逻辑补模板：目标没有原私密实例时，默认重建模板可能将组合公开。固定模板的有效私密性不得因换库或放在公开Floor上丢失；恢复和放置继续服从当前场景的完整依赖与受众校验，无合法固定遮罩时整笔拒绝，不能改为公开制造成功。三个目录范围的名称、缩略图、个人组织及完整库备份属于GM编辑数据，不进入玩家输出。

个人标签允许中文和普通自由文本；匹配规范化与显示原文分离，不因大小写、空白或全半角归一化丢失用户显示用字。制作/保全内部标签与发布者标签标明来源，内部保留元数据不开放个人编辑。同维度多选取任一、跨维度取交集，自由标签明确选择全部/任一；具体字符、去重、排序与限额仍由U2a冻结。颜色首批是人工确认的多色描述，关联固定源或变体；算法取色、场景当前有效颜色筛选和实例标签均不在首批。标签/收藏/颜色不改变占地、支撑、危险、阻挡、受众或场景选区。

### U2a 必须先冻结的合同

| 冻结项 | 主定义责任与交付要求 |
|---|---|
| 目录与组织记录 | 本文定义独立严格schema、确切身份编码、记录版本、发布者/个人/内部元数据边界与兼容拒绝方式；当前准备不创建新格式 |
| 文本与集合预算 | 本文与06共同明确标签规范化、显示保留、重复判定、数量/长度/展开限额；不能直接把工程256事务上限当作全部目录容量 |
| 本地并发与安装状态 | 06冻结组织修订/CAS、完整资源安装与取消/失败状态、跨存储边界的提交次序；不能借工程revision代替个人目录并发版本 |
| 备份与导入冲突 | 06冻结完整库备份及可选仅组织清单的精确格式、预算、缺失引用处理、同身份内容冲突和组织合并规则；不静默覆盖固定内容或另一标签的整理 |
| 采用与删除边界 | 本文定义有限采用命令、固定身份与闭包；06定义实际字节、许可、离线、原子失败及引用保护。删个人目录条目不删除工程/历史/来源根 |

上述责任在目录写入器与批量入库之前落实，再进入U2b界面和采用；现有空白工程的预装目录行为保持到U2支持显式调整。工程若将来需要持久实例标签或组织快照，另行演进合同，不能向当前严格v6/v3加字段。计划验证对应[09](09-quality-plan.md)的QA-WS-01—06、QA-CAT-01—06，本次均未运行产品验证；不改变35及更早证据、素材P2或性能暂缓状态。

### U2a 独立目录 v1 冻结合同（2026-10-23）

U2a精确身份、组织字段/限额、目录CAS、实际固定闭包及完整库备份的执行合同已在新写入器前冻结，见[40](40-u2a-catalog-contract.md)。本合同是本主题的补充主定义；严格工程v6/identity3/appearance1与有效v3保持。后续实现和本批简单检查归41，完整回归待用户通知。原“U2a待定稿”描述保留准备背景，当前以40的固定合同为准。

### 内容补标与精修边界（2026-10-23）

只读curation v1索引按确切目录内容身份关联，补充标签/人工颜色不改CatalogItem、DB、备份或工程格式；新题材与精修用独立固定定义与实际完整资源采用，旧空白预装与旧工程保留。精确范围和角色见[42](42-content-and-m1d-continuation.md)，实际结果另归43。
