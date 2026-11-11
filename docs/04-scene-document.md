# 场景文档与编辑契约

本文是严格字段、坐标、实体语义与原子编辑的主定义。开发期目标由下节单一v1合同定义；下表及各旧版本领域段落记录迁入合同与能力来源，不再要求未来开发维护多套工程格式。执行任务见[路线图](07-roadmap.md)，验证结果只在[历史台账](archive/README.md)追溯。

<a id="development-single-v1"></a>
## 开发期唯一完整工程 v1（当前实现合同与剩余收口）

依据[产品决策](01-product.md#development-single-project-format)，正常新建、打开、保存、导入/导出、历史、候选、编辑和渲染只维护一个完整工程合同：`ProjectData.schemaVersion = SceneDocument.schemaVersion = manifest.schemaVersion = 1`。最终验收前新增/调整字段直接修改同一套严格schema、模型、命令、资源与投影合同；不再为功能递增工程版本，也不长期兼容旧开发工程文件。未知/缺失字段、旧结构和伪装成1的旧包仍严格拒绝，不能宽松读入后丢字段保存。

**目标v1完整字段取自现有v8，而非恢复早期v1功能。** 保留完整建筑/室外/图层/规则/人工记录及工程顶层资源字段；`mapMode/generation/regional/visual/decorations/decorationClusters/surfaceRules`为完整合同必需字段，空集合明确保存，场景/区域互斥仍完整校验。曲线连接route保持真实控制源和采样几何，直行连接可无route；区域图不携带物理实体。v7专属`canopyRule`只由一次性迁入转成统一`surfaceRules`，不在目标簇中并列保留。

首轮收束工程版本轴，内部只保留**一个当前组合**：全量`identity5 / appearance2 / visual3 / generation5`和适用的`regional1`语义。这些内部结构数字不再驱动多工程版本分派；以后开发修改其唯一当前schema即可，无须另增兼容分支。全部出生/拓扑token、墓碑、人工覆盖、固定表现/来源、受众及依赖语义保留，不因schemaVersion变成1走回旧身份或旧计价路径。

算法/配方自身版本、固定定义/素材版本、AI任务/传输协议、预算策略/profile、增量历史记录结构及数据库schema不是工程版本。特别是算法/配方6确定性领域重放继续保持；新v1工程序列化会改变工程hash，须重新计算，不声称与旧格式工程hash相等。新工程请求仍分配真实新身份，同一次重放绑定原身份分配表。

目标新v1与早期旧v1外层同名时，正常读者只认**当前完整严格字段结构**；不能仅凭数字1判断兼容。旧格式解析只归[独立迁入工具](06-storage-and-export.md#development-single-v1-import)。本节优先于下方要求并行保留工程v1–v8、相邻副本升级或新增功能必须升工程版本的旧约定；完整领域校验、资源、CAS、撤销及秘密约束不变。当前模型、严格I/O和工厂已收束；剩余回归与通用生成器实现状态见[07](07-roadmap.md#general-map-generation-priority)。下表仅用于解释旧数据和领域能力来源，不能作为日常格式分派。

工程改名使用既有 `SceneDocument.title`，`renameScene` 命令严格接收trim后的1–120字符名称；沿完整工程验证、原子采用、单调revision、撤销/重做、自动保存与CAS提交，原值不产生新历史。不新增工程格式字段，不与内容、组织或解锁命令混批；不放开AI操作白名单。

<a id="map-detail-model-boundary"></a>
### 地图细节主线的模型与事务边界（当前完整v1）

按[01确认范围](01-product.md#map-detail-scope)推进，具体交付与状态归[07](07-roadmap.md#map-detail-mainline)。道路吸附、整面高程、门口接路、有限局部塑形与地表/植被配方复用普通原子命令；结构身份、门路关系和独立Floor输出按下述严格字段保存。局部塑形在简单单面内部新增更高覆盖优先级的真实高程面及阻挡高差边，原面与身份不变；氛围配方保存实际环境和效果记录，临时原色对比只改编辑投影。背景采用下述`outputBackground`，由当前严格v1完整保存。实现新增持久语义前，必须在当前完整v1内同步严格schema、模型、工厂、命令、投影和I/O，不增工程版本或保留并行开发格式。

| 事项 | 必须保持的责任边界 |
|---|---|
| 道路辅助 | 吸附候选/屏幕容差/目标提示/Shift状态属于工具暂态；采用保存实际整数毫米中心线、宽度和显式支撑。没有持久附着合同就不能声明随门或其他道路自动跟随。道路完整带区、门墙/障碍与高差检查分别有明确结果；绘画合法、可通行以及请求的必达约束不混为一项，也不因材质或吸附关闭而放宽硬约束。 |
| 有限高程编辑 | 每面单一高程与Floor、层序分开。升降和平整按确切目标、范围、基线形成候选；局部台地/洼地保存真实地块、边缘、身份及依赖关系。房间支撑高度、道路跨面、连接两端、覆盖/曲线、物件和人工记录必须重验；未支持联动拒绝并说明，不悄悄抬房、补坡、删树或重绑支撑。 |
| 拓扑与预算 | 新建/切分/合并采用真实出生/拓扑身份，不能凭同ID复用旧连续性；完整写集和只读依赖、锁、人工保护与当前冻结manual额度都计入。连续滚轮合并工具草稿，不把一次修改拆成多批绕过限制；取消/失败不产生部分工程。 |
| 背景与预设 | `outputBackground?: {mode:"solid",color:"#RRGGBB"} \| {mode:"transparent"}`为全图公开输出设置，缺省使用既有暖灰底色；颜色严格六位十六进制且不带alpha，透明由明确mode表达。`setSceneBackground`经工程设置独立事务采用，null删除字段恢复默认；完整校验、单调revision、撤销和CAS保持。编辑器棋盘格/临时查看偏好不能混入地形；草地/水域地表和树石实例仍有各自真实实体语义，不能用背景图片冒充支撑或通行。 |
| 布景与效果 | 预设采用后保存确切参数、来源和实际成员，保留人工移动/删除/退出/锁；旧固定素材/算法不能原地改义。临时关闭效果/对照属于查看状态，正式效果修改进入同一原子命令链。玩家派生只消费过滤后的来源，私密几何不塑造公开道路、散布空洞或阴影。 |
| 原型与AI | 连续高度场原型的采样网格、临时mesh或交互日志不进入生产工程；转产品前另定单一高度权威、坡度/支撑与保存合同。新手工工具不自动扩大AI操作白名单、scope或预算，已有AI权限保持。 |


**普通地表与群落配方**：同面草岩斑块、明确道路的静态路肩和明确营地片段以完整world paint、种子、范围和显式支撑建立新覆盖；现有覆盖和固定源祖先保全，片段fresh ID，整数交点/洞/预算失败整笔拒绝。它们与真实两侧terrain transition分工，静态接片不会自动随道路移动。植被编排显式指定Floor/area/layer、主树/次树/灌木/草簇四通道palette及空地/避让，产生普通scatter-cell-v2组与完整实际成员；不隐式删除旧组或重撒旧成员，后续人工状态沿原生scatter合同保全。样板继续保留各自选材、布局与配方偏向。

<a id="detail-render-profiles"></a>
#### 显式细节表现（当前完整v1）

`VisualEdgeLook.renderProfile?: "rockRelief2" | "rockRelief3"`只适用于cliff边带；`ConnectionRoute.renderProfile?: "naturalRockSteps2"`只适用于stairs连接且stairStyle为naturalRock。字段缺省保留原算法/原固定像素路径；新配方显式选择新算法，不从实体ID、seed前缀或调用方标记猜测。它们是外观算法轴，不增加工程容器版本；严格模型/schema、命令、受众投影、当前编辑表单与完整I/O同步。改变profile不改变物理轮廓、支撑或净宽，仍重验完整工程/许可/锁/基线和实际像素。AI视觉协议暂不声明新profile，拒绝对带新profile边带的隐式重写，手工入口可明确切换。

<a id="detail-followup-contracts"></a>
#### 局部覆盖、持续附着与独立多Floor合同

以下三项已接入当前完整v1的严格模型与普通事务；实现范围和开发自检归07，正式验收仍只从09执行。首版限制按具体依赖类别说明，不按样板或presetId放行。

**带纯材质覆盖的局部塑形**：首版仅接受base及所有overlay为world对齐；surface对齐须先通过显式外观转换，不能因新面包围盒变化暗改纹理相位。保留当前“原面不挖洞、内部新增更高覆盖优先级真实面+阻挡高差边”的拓扑模式；原面/原覆盖及其身份/来源不变，新面只接收与明确局部环精确相交的覆盖片段。每个非空连通片使用新operation/sourceOverlay/片序派生的fresh ID，保留完整world XY paint、尺度/旋转/相位/透明度和相对顺序，建立新表面源与出生证明，不能复制旧嵌入ID冒充原记录。单一overlay不支持洞；若裁切结果含洞、非整数毫米交点、退化或不可证明顺序，则整笔拒绝并指出原因，不偷偷取整/填洞/删片。无交集覆盖不进入新面，原覆盖仍完整保留。有效固定表面源链可只读复用并完整保全祖先，最多16层；当前raw snapshot须与表面逐字段一致，缺源/循环/类型不符拒绝，不能烘焙启用中的layer/instance外观调整。surfaceRules、生成/自然组、建筑/道路/连接/注记/散布及锁等不支持依赖继续拒绝。单次预算计入新面、每段cliff、每个覆盖片段/身份/来源和依赖真实展开；预览列父面、局部环、目标高程、片段数量/来源与拒绝项，采用前再次检查确切基线。旧量化布尔接口保持原行为；局部裁切使用独立严格整数结果接口，不能因显示裁切成功而跳过持久覆盖验证。

**门与道路持续附着**：`SceneDocument.pathAttachments?`保存严格version1关系字典，Path仍是实际完整道路的唯一权威。`HistoryIdentity.structureTokens?`独立保存floor/room/wall/vertex/opening/pathAttachment出生及拓扑令牌/摘要，并与既有生成归属分开；墓碑与其他身份共用65536总额及全局唯一令牌检查。新工程建立该池；缺池的当前工程只能通过显式`initializeStructureIdentity`事务建立当下证明，不补写旧历史，也不能通过合并历史记录补造缺失的当前结构连续性。坐标、墙厚、门宽和门状态是同出生内编辑；拓扑改变再改回、删除重建或受控撤销不会恢复旧连续性令牌。生成建筑的generationTokens不能替代普通结构证明，会话C2 witness仍只用于原有有限历史恢复。

关系保存fresh ID/version1、floorId/pathId/openingId/end、leadLengthMm/maxDisplacementMm/editLocked、实际端口与完整路线/tail/support的anchor，以及lineage/path/opening/wall/room的真实出生与拓扑证明。关系自身也有结构出生证明；它不是独立图层实体，编辑层锁继承实际道路图层。Path仍为完整路线的唯一权威；现有path拓扑令牌只覆盖Floor/支撑，不能证明首尾、控制点次序或宽度未变。首版点无稳定ID，策略仅管理所选端的门外点和法向引导点，其余tail按确切顺序保全；反向/插删或人工改附着端须显式解除后编辑或重新绑定，不能转移数组下标冒充连续性。生成管理的同字段须明确转为manual或拒绝，避免两个持续权威。

绑定采用明确预览；门沿同一墙滑移、保持正交且拓扑连续的建筑/墙平移及宽度变化，在明确有限位移内重算真实端口、外引和整条足宽带区。无合法结构带区/支撑、编辑锁、私密冲突、来源失效或预算超限时整笔拒绝。首版显式固定manual compact256，不借当前普通事务的自动512/1024选档扩大范围；真实成员、身份/元数据、几何和只读依赖按各维度计量。列出全部写入与只读依赖；路肩/营地覆盖和散布没有持续关系，不自动重放样板覆盖人工成果。关门/门锁只影响当前通行，不删除结构关系；几何端口与结构带校验独立于当前可通检查，不能临时打开门获得伪校验成功。合法编辑锁允许保存/冷读，在后续写入/联动时拒绝受保护变更。

删除门/换窗/重附墙/拆并或反向墙，首版要求明确解除并保留路后继续；删路则在同笔事务删除对应关系和路，保留门墙房间，其他引用另行明确处理。首版只支持公开、同Floor同高程的正交单房间外门与单端路；整栋90度旋转、斜墙、共享门、多门/双端图与跨Floor另列后续。引用删除重建、导入/冷读与历史恢复重验真实身份；撤销/重做推进令牌后须同事务重协调关系见证，不能复活旧令牌。实施顺序为身份轴→独立结构port/带区→有限重接→base/building/outdoor/aggregate全部命令及反向依赖→保存/投影/历史→工作区绑定/解除；不能只在移门UI或renderer中接钩。

**独立多Floor**：完整领域、投影与PNG输出显式识别目标Floor；已有floorId或隐藏用户层本身不构成隔离。首版仅支持相互独立的Floor，继续拒绝跨Floor墙门/房间支撑、地形支撑、组合/聚合/散布/装饰簇、生成归属及楼梯坡道；同Floor地面高差连接不改作跨楼层入口。先完成所有Floor各自几何/引用/资源/身份的完整验证，再从确切完整快照投影目标Floor+受众，不能删掉其他Floor或坏资源后注册为完整工程。

Floor保存id/name/boundsMm及可选outputBoundsMm/完整environment，出生/退休归structureTokens；不新增Floor实体锁，实际保护仍来自所属层、实体和视觉依赖。世界界限与输出范围分开；首版新输出范围限制在该Floor世界界限内，旧单Floor缺省精确保留原exportBoundsMm，不在冷开重裁切。公开输出请求显式指定floorId、受众和尺寸，固定范围从首次捕获的完整快照解析；Projection携带相同floorId/range，raster核对请求与绘制投影的Floor/受众及固定范围一致。出生证明属于该完整快照的结构校验，不另设调用方birth或范围免检参数；不存在/已退休/范围不匹配明确失败，不能回退首Floor。输出范围/世界端点和像素预算分别验证，setCanvasBounds在多Floor或已有专属范围时只改目标层世界/outputBounds；旧单层缺省沿用原全景字段。编辑activeFloor和相机/命中/吸附/框选为会话态；Floor进入异步发布作用域，迟到候选不得切错层。正式渲染不从编辑视口推定范围。

环境采用“全景完整默认值→本Floor完整VisualEnvironment覆盖”，删除覆盖回退，未知/缺字段拒绝；同一有效环境供调色、光向、接触影和私密包围范围。outputBackground、单位/格线和activeStyleTheme首版仍为全景设置，不隐式归入环境六字段。场景滤镜target=scene只作用于效果自身Floor的固定范围，全部曲线/过渡/边带/灯雾滤镜/支撑/散布/阴影/遮罩先按目标Floor+受众过滤再派生像素。相同XY异Floor不得碰撞、遮挡或影响私密范围。全工程真实资源/许可/像素核验仍包含非目标及隐藏资源；目标输出只解码已过滤消费者。

Floor预设槽位绑定structureTokens中的真实出生身份，以floorId+birth命名；缺证据拒绝，不能只凭字符串ID。旧全景槽位不自动分配/复制到各Floor。首版Floor写入受所属层/实体及确切跨层依赖锁约束；若新增Floor锁另定严格字段/命令，不假定当前已有。全景环境检查全部实际受影响对象的锁，标题/单位/背景沿各自命令政策。整工程仍共用一套单调revision、候选基线、CAS和撤销历史，改另一Floor也使旧候选过期，不拆分保存或每层CAS。createFloor同事务建立独立空层及首图层，首次转多层时明确冻结旧实际输出；若旧输出越出旧世界范围，须先显式修正，不能暗裁旧图。deleteEmptyFloor只允许无物理/视觉/生成/聚合/外观依赖的空层。区域地图、UVTT跨层输出、垂直楼层连接和旧有限历史恢复的跨层守卫继续保留。AI公开截图尚无Floor绑定协议，多Floor截图入口明确拒绝；AI全景环境不能越过本层覆盖。

保存、冷读、历史、双受众输出与失败保全见[06](06-storage-and-export.md#map-detail-persistence-boundary)；完整正式检查归[09](09-quality-plan.md#map-detail-acceptance)。

<a id="generation-staging"></a>
### 通用生成的临时候选与持久责任

D1的请求/步骤依赖、13类临时空间产物、只读候选快照及阶段hash回执仅存在于会话，不加入工程、历史或导出字段。算子物化到私有完整SceneDocument，后续阶段读取实际墙门、支撑和占地；主工程身份/revision/Floor不变。`prepared`不是可采用凭据，仍须沿完整ProjectData的身份、资源/许可/像素、范围/锁、预算、保护/CAS及一次撤销路径准备与采用。具体接口及旧自然协议桥见[生成设计](reference/general-map-generation.md#d1-stage-contract)。

当前D2/D3室内沿现有`generation.legacy`严格联合保存`domain:interior / algorithmId:interior-layout`，旧算法/配方为`2/2`，新建默认`3/3`，两者必须严格配对，包含规范化完整房间/关系需求、范围/墙厚/走廊、固定floor/wall材质及初次布置`arrangement`。后者精确保存门/入口/家具开关、建议门宽/通路净宽与显式角色→固定定义palette；配方props必须与该palette逐项一致。不增加工程版本或开发工程兼容分支。既有自然配方分支的结构和字段不变。building规则使用现有rules/ownership，引用可含room/wall/vertex/opening；结构→连接→内容三个阶段依次产room/wall/vertex、真实opening、真实prop，每阶段只补本阶段归属并重算完整规则hash。稳定需求ID是配方局部键，不占用场景实体ID；实际房间/墙/顶点/门/家具有独立稳定输出键及受管理geometry/properties/surface/source组。

新建语义确定性按布局几何而非完整工程hash定义：相同规范参数、seed、固定素材与注册预算，在不同新工程身份下，室内算法3及地形建筑算法2以语义需求/实际墙几何和seed选择房间连接、外门及家具位置，身份分配仍独立。混合算法2选择地形建筑算法2，并沿既有森林/火山算法1执行；后续树木仍避让实际家具与路径。旧算法不得因新默认改写输入、版本、实体或重放hash；完整文档与资源继续保存，不能靠固定sceneId、删业务字段或只保存seed制造等价。当前工程后续人工编辑与局部家具操作不自动重建整图，局部操作按原配方选择新/旧排序策略。

生成建筑的真实出生与拓扑记录复用当前`historyIdentity.generationTokens`，kind增加generatedRoom/generatedWall/generatedVertex/generatedOpening，只为building归属目标建立，不给普通手工建筑补造生成身份。出生/墓碑仍计入同一65536总上限，不增工程或身份版本、不另开身份池。手工用途、顶点坐标、共享墙及真实端点几何变化进入脱管判断；删除保留墓碑，每条原生命令后的拓扑推进及撤销/重做不回退旧拓扑令牌。稳定输出键和临时回执都不替代身份凭据。家具继续使用现有propTokens，门使用generatedOpening，归属记录仍在同一building规则；没有第二套身份池。初次布置仅为建议，不写`Room.accessExpectation=required`、入口必达列表、pathChecks或持久必需家具数；门关闭/删除、家具搬动/删除沿原生命令脱管/墓碑及撤销语义，冷读不补回。D4/D5沿此责任扩展；没有真实凭据时拒绝需要该证明的结构重生成，不扩大现有历史恢复权限。

D4森林沿同一`generation.legacy`保存严格`domain:forest / algorithmId:forest-layout / algorithmVersion:1 / recipeVersion:1`。参数包含明确林区/空地/入口/折线路线、选定或新建地面、三通道覆盖/间距和固定palette；recipe.materials/props必须与输入中的ground/path和tree/shrub/grass引用完整一致。局部需求ID不占场景实体ID。forest规则按真实产出分别绑定geometry/properties及适用的surface/appearance/source/membership，完整树Prop、轻量Decoration、DecorationCluster和SurfaceRule使用现有身份池与人工状态；引用联合增加后三种实体，并只为新种类补其真实字段投影，旧自然引用hash保持。

森林空地activityArea与入口port均为soft首次保留；实际生成仍复核完整占地/绘制范围、真实支撑与道路净宽，缺少合法连接的路线拒绝。手工删改走原生脱管/删除/墓碑，不在打开/保存时补回。完整坐标、成员槽位、固定资源和软保留记录保存在工程，临时预览报告与空间事实不成为另一份权威地图。已有同通道规则不被隐式重撒；同seed已有森林配方的追加拒绝，受限局部更新见下述D6合同。

D5火山同样直接保存于唯一完整v1的`generation.legacy`，严格`domain:volcano / algorithmId:volcano-layout / algorithmVersion:1 / recipeVersion:1`。参数含山体/低火口/平台真实闭环与高程、外部入口、两处高差连接、两条指定路线及有限折点、可选火口内流道控制线/宽度、显式区域策略和ground/mountain/crater/platform/flow/route六种固定材质绑定；recipe.materials必须与参数完整一致，props为空。山体高于基底、火口低于山体，高程可低于基底；覆盖优先级不表示高程。流道完整带区规范到1mm，实际保存为火口内同高程TerrainArea；危险/阻挡/移动代价各存Region，不从熔岩纹理推断，也不以Path冒充跨高差流道。

volcano规则按实际TerrainArea/TerrainEdge/TerrainConnection/Path/Region逐项建立有限归属，共享精确配方；引用联合新增region，原有引用字段投影与自然算法hash不变。地形/连接仍使用现有室外出生/拓扑身份，Region使用生成归属的出生与manual/deleted记录，不据此扩大结构恢复权限。活动区、入口及路线均为soft首次建议；实际首次生成需检查当前支撑/完整净宽/两端接入和显式阻挡。手工改危险、换材质或删除Region沿原生脱管/删除与撤销语义保存，打开不再生成；建筑拓扑重写与跨领域结构重生成尚不支持。

D6不增加工程字段或版本。四类局部操作复用已保存配方、现有rules/ownership、SurfaceRule/DecorationCluster与真实身份；只认领本次明确授权且之前仍受管的字段，既有manual/deleted/detached与墓碑不清零。原配方保留首次输入，当前密度、材质及坐标由实际规则/实体保存；新家具、林区成员分配独立出生身份和有限归属，稳定输出键不授权复活旧ID。火口坐标调整保留现有点/段及拓扑；改变拓扑或删除重建后即使撤销回原几何，原生历史推进的新拓扑令牌仍使该几何归属保持人工，不能恢复旧生成控制。相关Region仅在其几何仍受管时随动，不改变人工策略；不支持建筑分合/新删房间等拓扑重写。操作范围和拒绝边界见[设计11.6](reference/general-map-generation.md#d-regeneration)，保存事务见[06](06-storage-and-export.md#local-generation-storage)。

E在同一严格配方联合保存`domain:interior / supported-interior`与`domain:mixed / mixed-layout`；两者旧算法/配方均为`1/1`，新建默认均为`2/2`，拒绝错配。前者沿室内完整参数增加显式terrainArea支撑；后者保存室外模块参数、房间需求和接入路线。`composition`规则只管理组合自身新增的地面及路径，建筑与森林/火山保留各自配方及逐输出归属，不接管前序实体。接入规则读取实际房间、墙厚、门开闭/锁/秘密及支撑的几何/业务字段；新配方/规则严格配对、固定材质/物件与规范输入一致。初次连通仅为生成时检查，后续手改只按原生人工/删除/依赖失效语义保存。建筑/火山局部操作读取真实跨领域支撑、路径与建筑依赖，但不获得结构重写权。工程版本保持完整v1，旧室内算法2及自然算法6重放不改义；细节见[设计11.8](reference/general-map-generation.md#e-mixed-delivery)。

<a id="domain-generation-protocol"></a>
### 领域生成的会话传输边界

D7使用独立`protocolVersion:1`请求，精确包含requestId、workspaceId/checkpoint/epoch、domain、完整候选基底SceneDocument、规范输入、注册profile和requestHash；不传图片字节、当前工程或历史。最新能力声明为`interior-layout@3 / forest-layout@1 / volcano-layout@1 / mixed-layout@2`；明确旧输入仍按`interior-layout@2 / mixed-layout@1`原路径重放。响应绑定同一请求/上下文，包含完整领域结果、强类型空间产物/阶段回执和报告；逐项验证场景、产物与阶段hash。实际计时单独计量，不进入确定性resultHash。8MiB请求、16MiB结果和600000个JSON值均为保护上限，不是容量承诺。

这些信封、临时事实、诊断、端点凭据与执行端选择不增加持久字段。唯一完整v1继续保存实际实体、精确配方/归属、人工状态、身份、外观和资源。摘要只能证明候选自洽；即使远端重算全部摘要，采用仍须本机会话私有凭据、完整重放与资源校验，不能直接另存网络场景。旧自然底图协议与算法6重放原路保留。


| 迁入前的旧完整工程 | 旧严格场景 | 视觉来源 | 历史身份来源 | 外观来源 | 被当前完整v1承接的能力 |
|---|---|---|---|---|---|
| v1 | scene1 | 无visual字段 | identity1 | appearance1 | 完整建筑、室外实体、图层与有限恢复 |
| v2 | scene2 | visual1 | identity1 | appearance1 | 共享曲线、边带和有限静态效果 |
| v3 | scene3 | visual2 | identity2 | appearance2 | generation1–4、regional1、物化边与固定近侧视源 |
| v4 | scene4 | visual3 | identity3 | appearance2 | generation5组合、显式过渡与局部联动 |
| v5 | scene5 | visual3 | identity3 | appearance2 | 保留v4完整模型，显式曲线/回折连接与适用曲线组件编辑 |
| v6 | scene6 | visual3 | identity4 | appearance2 | 保留v5完整模型，固定源轻量装饰与可编辑簇状布景 |
| v7 | scene7 | visual3 | identity4 | appearance2 | 保留v6完整模型，可选树冠区域规则领域字段 |
| v8 | scene8 | visual3 | identity5 | appearance2 | 保留v7有效场景；统一保存连续地表字段规则与区域植被成员 |

按问题查阅：[当前工程](#当前完整工程与版本分派)、[地形/区域v3](#完整v3地形与区域合同)、[地貌组合v4](#terrain-t8-contract)、[曲线连接v5](#curved-connections-v5)、[轻量布景v6](#decoration-clusters-v6)、[树冠区域v7](#canopy-regions-v7)、[连续地表规则v8](#surface-rules-v8)、[计量与标识](#计量和标识)、[实体字段](#材质地形与组件字段语义旧m1-v2来源)、[选择与历史](#选择图层外观与历史)、[事务](#commandbatch撤销与锁)、[个人目录](#会话与个人目录)。

上表各行是旧数据的固定组合，独立迁入器验证旧工程schemaVersion等于其场景schemaVersion。当前完整v1使用上方唯一组合。generation5以legacy保留严格generation1–4。数据库版本、目录身份算法与旧M1容器版本均是其他维度，不与此表互换。

<a id="完整v1现行合同2026-10-24"></a>

<a id="完整v1v2现行合同2026-10-25"></a>
## 当前完整工程与版本分派

默认主工程与个人库分别为`sceneweave-projects-dev-v1`和`sceneweave-library-dev-v1`；独立迁入成功后原子选择同一来源指纹的成对目标库。当前打开、保存与导入只接收当前完整v1及明确所选历史，旧格式仅由独立本机迁入处理。AI授权与草稿合同见[05](05-ai-and-generation.md)，存储与副本升级见[06](06-storage-and-export.md)。

### A. 格式识别与完整模型

| 对象 | 固定标识与版本 | 必需字段/约束 |
|---|---|---|
| `ProjectData`，纯JSON | `format:'sceneweave-complete-project', schemaVersion:1` | 精确字段为format/schemaVersion/document/historyIdentity/appearance/assets/licenses/licenseBindings/authoringSources，无其他顶层键 |
| `SceneDocument` | `format:'sceneweave-scene', schemaVersion:1` | 下列完整场景字段，不继承旧SceneDocumentV2/V3，也不靠旧领域视图保存 |
| `HistoryIdentity` | `version:5` | 完整保留各出生/拓扑池、墓碑、lineageId/rootSceneId和规则身份 |
| `AppearanceGraph` | `version:2` | sources/propSources/surfaceSources/instanceAdjustments/layerAdjustments/variants/prefabAppearanceTemplates及固定presentations |
| `ProjectBundle`，运行时交付 | `project:ProjectData`＋资源字节端口 | 每个已引用图片/SVG字节按hash可读、独立捕获；纯JSON通过不表示完整校验通过 |

旧M0的`sceneweave/schemaVersion:1`和`sceneweave-project/containerVersion:1`只交给legacy读者。分发先识别format，再检查其版本及精确字段；新标识不能交给旧读者试读，也不把未知版本降级。数据库schema版本和目录身份算法都不是工程文件版本。

完整场景必需字段集合另含`mapMode/generation/regional/visual/decorations/decorationClusters/surfaceRules`，共同字段为：`format/schemaVersion/sceneId/revision/title/createdAt/updatedAt/units/exportBoundsMm/floors/vertices/rooms/walls/openings/props/regions/notes/assets/presetSnapshot/constraints/propDefinitions/materials/terrainAreas/terrainEdges/terrainConnections/paths/prefabDefinitions/prefabInstances/scatterGroups/styleThemes/activeStyleThemeRef/userLayers/entityLayers`；可选`generationMetadata`沿用已有有限来源摘要。各实体、固定定义、物理/受众、层和散布人工字段完整承接现行v3语义；不得以“统一”删掉未直接显示的字段。

`assets`以SHA256为键，每条精确为`sha256/mimeType/sizeBytes/pixelWidth/pixelHeight`，不含Blob；mime限PNG/JPEG/WebP。`licenses`以hash为键，精确为`sha256/text`；`licenseBindings`沿用subjectKind/subjectId/licenseRef/licensePath/embedding，逐主体及完整嵌入权校验。实际字节放资源端口，受控读入后校验CRC/hash/编码/尺寸/真实像素和预算；不能用描述代替字节。

资源复用凭证还必须绑定本机独立捕获的不可变字节闭包或受控资源句柄代次；相同JSON三元对象、hash声明或同一个端口对象都不能证明字节不变。重新供字节、换句柄、网络接收和持久化重读均重新完整验证。document/historyIdentity/appearance认证仍只证明这三个对象；authoringSources另行严格验证并绑定完整资源证明，不借用旧三元认证跳过。

c实现采用前一种方式：独立深冻结ProjectData和私有不可变字节闭包的确切对象对由WeakMap认证，读取只返回字节副本；联合历史按hash持有一份字节，每个工程端口只开放自身资源范围。所有输入端口逐个读取、核对hash/尺寸并真实解码，公开入口即使接收已认证包也重验。取消/失败不返回完整认证结果；图片端口为应用注入的受信实现，任务JSON不能指定实现或传免检标记。

新内容hash为规范JSON的SHA256，覆盖完整ProjectData（含源元数据、许可正文/绑定），不含资源端口、运行时认证、转换journal或本地旧原件。规范JSON递归按键的确定性UTF-16顺序排列、数组顺序保留、UTF-8无BOM、拒绝非有限数和非法JSON数据；不使用localeCompare。旧hash单独作为sourceContentHash保存，转换后必须重算，不能继续声称旧hash覆盖新结构。

<a id="workspace-snapshot-contract"></a>
### A0. 当前会话不可变快照与分层证明（2026-11-08用户确认）

用户要求“先沉淀成文档,然后按照这个全部完成”，采用[会话快照架构](reference/editor-and-architecture.md#workspace-snapshot-architecture)作为编辑、验证、预览、保存和历史的共同边界。本节是目标合同；实施/验证状态只归07，不由本文推定完成。

每次已采用事务产生完整、不可变的工程快照；内容验证、受众画面完成和持久化完成分别记录。严格模型、完整工程v1、整数毫米、world运行视图/local唯一持久表示、固定资源身份、许可、人工记录、出生/墓碑、单调revision及原子撤销不变。组所有权、检查依赖、内容块和空间区块各有责任，不合并为同一种分组。

私有快照证明只由校验器对独立捕获的完整领域/身份/外观及不可变资源闭包签发；调用方自报hash/revision、冻结、changedIds、端口对象或序列化凭证均无资格。资源证明另绑定实际图片/源字节、来源及派生图、许可闭包、严格模型和受信处理器/适配器能力代次；更换实际能力或任一相关内容使对应证明失效。当前依赖、许可主体/嵌入权、预算、锁、支撑、受众及最终基线仍由各自操作核对。

内部编辑预览和自动保存可消费确切快照的完整证明，复用未变资源的字节/源到像素验证事实；未知或外部输入回退完整验证，不开放skipValidation或调用方注册证明。公开validate、普通save、冷读、导入/备份/正式输出仍完整验证实际字节与像素。内部自动保存虽可继承内存资源证明，仍独立核数据库实际资源/块、CAS和原子提交，资源证明不证明磁盘新鲜性。此段明确替代下文及旧C0/C5中将每次编辑预览/自动保存也强制重新栅格化全部未变资源的表述，外部完整验证要求继续执行。

执行器私有变更证据绑定实际before/after、真实写入、只读依赖、绘制影响与逐步成本；不得从最终净差抹掉中间工作。有限Prop位置/角度继承现有证明，其他领域及未知变更用同一完整规则保守回退，不新建宽松的第二套校验器。采用、撤销/重做、AI及恢复保持各自授权、连续性、保护和CAS语义。

证明只驻留内存，不进入工程、历史、包或数据库。单次操作必要基线/结果不受可选缓存FIFO淘汰；可选缓存与在途工作有界，失败/取消不签发部分证明。GM/player先按各自闭包过滤再生成投影、空间索引、阴影/遮罩；不得复用跨受众派生图像，也不引入长期Bitmap/RGBA缓存。Worker计算通过受控平台能力交接，structured clone不传播私有证明，生成/AI Worker结果仍不授予采用权限。

<a id="core-transaction-contract"></a>
### 核心收束：受信事务结果与影响协议（目标合同）

本节将[会话快照](#workspace-snapshot-contract)和下节有限Prop证明收束为可供各操作族共同实现的合同，属于用户确认的核心建设目标。接口归属与调用方向见[统一架构](reference/editor-and-architecture.md#core-convergence-architecture)；开发状态只归07，验证与验收只归09。本节不表示地形、建筑或全部候选已经接入，也不扩大既有局部恢复权限。

受信执行器从确切已认证基线执行严格命令，校验器依据真实执行和所属领域检查签发不可变事务结果。概念上的`TransactionResult`是本机会话产物，不是新增工程字段、持久事件账本或外部可提交的证明。它至少包含以下相互绑定的事实：

| 内容 | 必须表达的事实与责任 |
|---|---|
| 前后快照 | 确切`before/after`完整内容与资源闭包关联、基线场景/修订及操作代次；结果尚未提交时不冒充当前工程 |
| 真实写集 | 按执行顺序记录目标类型/稳定身份、受支持字段、创建/更新/删除及真实前后值；最终净差和逐步工作分别保留 |
| 有类型依赖 | 只读依赖与写入目标分开；区分几何、支撑、附着、成员、图层/锁、受众、外观/资源和生成归属；记录相应owner及前后依赖变化 |
| 失效范围 | 由各owner产生需重新检查、重新派生或完整回退的事实，含旧/新空间范围及受众；声明未知或未覆盖，不能用空集合表示无法判断 |
| 身份与人工状态 | 真实出生、删除、拓扑连续性变化和受管/人工/退出记录；同批改回、撤销或同ID重建不得消除已经发生的连续性事件 |
| 资源变化 | 实际新增/替换引用的固定源、定义、字节、许可与派生依赖；未变证明仍绑定确切内容、字节闭包和能力代次 |
| 实际预算 | 每步展开、几何/计算、依赖、元数据及资源用量和冻结预算合同；重复操作、中途修改再改回及失败前已执行工作不从最终净差中退款 |

命令执行器拥有写集，领域模块拥有其依赖和检查语义，公共影响服务只组合有类型的边与结果。候选审阅、锁检查、预算、身份/人工保全、历史差异、投影失效与保存编码消费同一笔事务的相容证据；不由多个调用方分别猜测哪些实体发生了变化。空间接触仍须查询真实旧/新位置，不能只沿已有引用图传播；资源、外观、生成依赖也不能因不属于物理实体图而遗漏。

证明复用必须明确所覆盖的操作族、字段及依赖性质。任一未知命令、未映射依赖、基线变化、能力变化或证明链不连续时，转入原完整校验和完整差异路径；无法保全合法语义时拒绝整笔操作。调用方传入`changedIds`、任意字段路径、hash、冻结标记或序列化结果均不能授予复用资格。传输、Worker结构化复制、导入和冷读不继承私有证明；公开validate/save及正式输出继续全验。

事务结果只说明被验证的变化，不授予采用权限。当前工程采用仍核对有效锁、明确范围、基线、保护、资源、人工状态和CAS，以一次事务提交并保留一次撤销；revision继续单调增加。未知路径可以先产生完整验证结果，再逐操作族建立有限证明，不能通过通用免检开关追求覆盖率。

代码中的会话形态为`TransactionReceipt`与完整工程的`ProjectTransactionReceipt`：描述类型/纯组装函数不授予信任，只有执行器私有登记及校验器绑定的确切端点可复用。逐步事件与最终净变化分开，普通Prop/地形/建筑命令回执仍声明`requiresFullProjection`和完整依赖回退；只有原有有限Prop证明使用其明确覆盖的局部校验。revision+1可继承同笔受信结果；注册凭据按本次操作确切句柄释放，净无变化操作不能覆盖或撤销当前待保存事务的证据。不能串接下一笔命令或借回执省略资源字节、许可和玩家投影检查；调用方仍持有完整候选/回执时，其确切前后快照也仍被引用，不以撤销注册冒充物理内存释放。

<a id="core-domain-capability-contract"></a>
### 核心收束：领域事实与实体能力（目标合同）

领域扩展继续使用唯一完整v1和同一严格实体模型；新增持久语义同步模型/schema、命令、依赖、身份、投影和保存，不建立第二份生成地图。算法/配方重放、固定素材身份、AI权限/预算与数据库结构各按独立合同演进；旧自然重放由明确兼容适配器保留原义。

领域事实提供器从实际已保存实体、生成归属及显式引用中提取有类型的支撑、端口、占地、净空和连接事实，并核对来源身份、Floor、坐标框架、高程、宽度与有效性。共同空间服务只消费这些事实和真实几何，不内置题材、配方名或实体ID命名规则。当前同Floor二维与离散高程边界保持；尚无垂直净空/连续三维能力时明确不支持，不从图片、颜色或材质推断物理事实。

每个新增实体或表现能力须声明其依赖/锁传播、人工与生成归属、受众与依附传播、资源、可编辑字段、物理/视觉范围及适用的输出能力。对某种输出不支持或只能降级时必须显式声明；未登记不能被默认为公开、无依赖或完整可导出。纯外观变化不暗改支撑、碰撞、危险、通行或秘密。表现适配器合同见[统一架构](reference/editor-and-architecture.md#projection-presentation-capability)，正式输出边界见[06](06-storage-and-export.md#core-delivery-capability-contract)。

<a id="trusted-prop-local-transaction"></a>
### A1. 受信 Prop 局部事务

当前有限执行器仅从自身已严格认证、深冻结的`document/historyIdentity/appearance`三元基线执行Prop的`positionMm/rotationDeg`命令，签发真实前后值及字段写集；没有调用方登记changed IDs、字段路径或免检标记的入口。执行时仍检查有效实体/图层及递归注记锁、完整足迹/支撑和几何、nearSide方向，以及聚合成员的帧坐标往返。预制组合、散布、装饰簇成员，生成读写/检查依赖及可能影响地形过渡的物件等超出有限证明范围时，回到原完整事务路径，不按选区或同ID猜测独立性。

普通手工预算只沿确切受信三元链继承未变的保留几何/元数据计数，按真实改变的Prop及其前后几何重新计量，并读取本次实际资源元数据的字节/像素总量；已有档位和计算保护继续执行。此路径不改AI任务、配方重放或累计账本。完整ProjectData的局部元数据认证另须持有自身全验建立的大小/闭包证明，所有非三元顶层字段保持确切引用，只按执行器实际Prop前后值或受信revision/updatedAt变化更新JSON预算；复制、外部冻结及声明hash不能取得该证明。

私有`ProjectLocalTransaction`绑定完整基线与结果，不序列化进工程、历史或包。Prop阶段从本次输入建立基线；仅紧邻它的单次revision+1可合并为同一笔编辑，后续Prop编辑或revision不得拼接旧链。保存前可保留原确切结果作为证据，但保存的独立完整副本必须与私有结果的**完整规范内容**相等，历史差异还须核对真实数据库父态与私有基线全文相等；内容块分区只从自身按确切基线全文建立的分区复用。world原表示先比对再转local，防止非法数值被变换归一化。凭证缺失、内容变化或分支基线不同即回退全量差异。

完整内容SHA仍由实际规范字节计算，局部写集只减少重复推导；它不证明资源字节/像素已验，也不替代CAS、保护点、固定源/身份保全或玩家输出。公开校验、保存的完整资源校验、冷读、导入/导出与渲染保持各自完整领域/许可/实际字节及像素边界。历史与有界内容块缓存的持久责任见[06](06-storage-and-export.md#trusted-prop-local-save)。

### A2. 视觉系统语义（旧v2能力来源，当前v1完整承接）

以下相邻升级过程仅为旧数据来源说明，日常入口已退役。当前新建直接创建完整v1，并在visual3.base.base保留严格 `visual:{version:1,boundaries,edgeLooks,lights,fogs,filters,environment}`，其余完整字段不丢失。当前命名空间的完整v1仍可读；从视觉面板启用时先保存原工程，再创建新sceneId/r0、独立完整校验和保存的v2副本，成功后切换。原v1及历史不覆盖。该版本号与旧M1 `sceneweave/schemaVersion:2` 不同。

场景2的房间、注记和用途区在各自合法绘制带内先按用户图层，再按稳定ID排序；字典键的插入顺序不是持久层序。规范JSON重排键后仍产生相同投影和画面。渲染时，连续同外观且无独立实体/图层滤镜的房间可共享一次裁切，子路径按实际几何固定顺序，避免共边重复抗锯齿覆盖；不同外观或独立滤镜保持投影顺序。这只改变呈现派生，不改领域几何、工程身份或投影层序。场景1保持原有局部顺序规则。

| 对象 | 必需字段（除共同字段外） | 约束 |
|---|---|---|
| 共同视觉实体 | id/floorId/layerId/visibility/editLocked | 显式Floor/层/受众/锁，不能藏入physical entityLayers或以层序充当高程 |
| Boundary | closed/segments/sampleSpacingMm/toleranceMm/binding | 分段稳定id及start/control1/control2/end整数毫米；terrain绑定1–2条有向端点链，path绑定一个真实路径，decoration不改物理几何 |
| EdgeLook | boundaryId/kind/side/widthMm/color/accentColor/opacity/intensity/seed/repeatMm/enabled | kind=shore/cliff/grass/path/fence；世界弧长派生，不持久化像素，视觉外扩进入实际范围 |
| Light | positionMm/radiusMm/color/intensity/wallOcclusion/enabled | 静态二维遮挡，不自动成为VTT灯或物理通行证明 |
| Fog | boundaryMm/color/opacity/directionDeg/scaleMm/seed/enabled | 确定性静态区域，向内羽化，不向范围外溢出 |
| Filter | target/preset/exposure/saturation/contrast/vignette/grain/seed/enabled | target为scene/region/entities/layer；layer持续规则与AI冻结目标分开；preset仅neutral/warm/cool/aged/moonlight |
| Environment | ambientColor/ambientOpacity/exposure/lightDirectionDeg/contactShadowMm/contactShadowOpacity | 显式全图参数，无共同实体字段；AI须单独授权完整Floor |

曲线控制源和现行TerrainArea轮廓/Path中心线必须逐点等于确定性采样，不能分别存出不一致几何。两侧绑定以稳定端点、有向顺序和reverse描述，不偷换附着/支撑。实际几何变化更新既有室外出生/拓扑身份，完整锁/依赖/预算继续约束；解绑需明确处理依附边带，保留当前采样轮廓。材质编辑沿用完整SurfaceStyle和不可变父源；底材仍不透明，覆盖最多8、单覆盖最多128点，AI不伪造未物化tint位图。

保护值：64曲线、每条32分段/512采样点，场景总256分段/4096采样；128边带、各最多1024装饰；光/雾/滤镜各16，区域最多128点。一次手工/AI真实展开仍最多256，渲染像素和装饰复杂度另受预算。超限拒绝，不通过跳效果输出成功。实际定义见shared/visual，视觉规范见[14](14-visual-and-assets.md#visual-rendering)，运行证据见[视觉历史](archive/visual-quality-validation.md#doc-53-overview)。

视觉有限恢复只处理本会话真实快照后的现存连续参数/曲线几何与环境。绑定/分段ID/闭合结构、显式对象滤镜目标等视为拓扑；同批删后重建或改变后改回也永久失效，undo不能追认。恢复保留当前层、锁、受众及范围外内容，绑定几何还需当前物理出生/拓扑证明；不重建已删效果，不支持跨重开/导入witness。完整历史包的持久保全与这些局部恢复权限分开。

### B. 身份、外观与当前/历史归属

物件/组合token、室外kind/token/topologyToken/topologyHash及全部墓碑保持；拓扑中途改变又改回仍换连续性token，轮廓循环换首点规则保持。新当前sceneId在转换journal只分配一次，revision从0开始；v6 lineageId/rootSceneId及已有token原值保留。rootSceneId标识历史根，不强制等于新副本sceneId。

新快照摘要精确字段：`id/ownerSceneId/lineageId/sourceRevision/name/kind/createdAt/contentHash`，kind为`named/protection/imported-auto`。ownerSceneId是当前归属；快照内SceneDocument保留原sceneId/revision与时间，仅转换其格式字段。普通保存的自动历史仍记录所属sceneId/revision，不伪装命名快照；最近20条仅为自动摘要的展示范围，底层保留的不可变版本、祖先及分支不因此删除。转换的v6自动历史为只读imported-auto，最多20份，与原生自动历史分开保留，不占32+32命名/保护限额。

旧自动行没有用户命名，imported-auto的name固定生成`自动保存 · r<源revision>`，createdAt由原savedAt转为ISO时间；这是生成标签，不冒充原始命名。原savedAt字段值及旧行在保全set中保留。

当前身份合入同一家族已转换历史的墓碑并完整验冲突，现存对象以当前拓扑token为准。跨库即使sceneId/lineage/标题相同也不自动合并。v1–v5首批只转换当前；旧全部历史保全，可显式另建工程，不给缺证明的旧对象追认连续性。v6转换保留已有有限恢复；C2建筑witness不序列化，重开/导入/转换仍清空，不因此支持持久建筑或任意拓扑恢复。

外观字段和源→层→实例优先级完整保持，固定source/variant/template不改义；源祖先、非活动位图根、人工覆盖与私密组合模板不删除。当前层规则与冻结对象批改分开，表面底材opacity仍须1。旧固定派生ID/参数和实际PNG保留，转换不能用重跑生成替代实际字节。

d已按上述身份合同转换v6家族与v6所选历史文件。新仓库最终准备和提交要求全部预留v6历史到齐，逐源键核对named/protection/automatic类别与自动revision，不能仅检查候选ID属于预留集合。v1–v5仍只转换当前，全部旧历史由set/原文件保全。共享资源批次上限85是当前＋64命名/保护＋20只读来源自动，普通便携history上限仍64。

<a id="local-history-versions"></a>
#### 本地不可变版本与恢复

浏览器存储以不可变版本ID、完整内容hash和父版本关系记录已成功保存的工程；版本内的历史revision不会随当前采用而改写。当前工程revision仍单调增加，包括撤销、重做及完整历史版本采用。回退后继续编辑形成新分支，原后续版本继续保留；命名/保护点引用已持久化的确切版本。保存可合并尚未落盘的中间编辑，因此不是每个内存revision都有独立保存版本。

完整版本导航先保全当前，再核对所选自有自动版本及来源hash，一次采用历史完整内容并生成更大的当前revision；出生、墓碑及拓扑连续性按现行恢复规则合并，不能直接安装旧身份来绕过连续性。现有局部恢复仍只采用明确ID、属性组和允许的依赖范围，保留范围外修改及既有锁/连续性约束。会话撤销/重做与持久版本导航分别保留各自语义。完整基线、双向增量、检查点、预算及CAS均属于[06的浏览器存储合同](06-storage-and-export.md#incremental-history-target)，不向严格完整工程v1–v5添加本地版本图字段。

### C. SVG源、规范化与真实光栅（M2-4已接通）

`authoringSources`以有效光栅assetId为键，公共字段精确为`kind:'svg'/sourceSha256/normalizedSha256/sourceSizeBytes/normalizedSizeBytes/rasterSha256/processorId/processorVersion`。processorId固定`sceneweave-static-svg`；新制品使用独立processor2，另含严格`rasterizer:{id:'resvg-wasm',version:'2.6.2',moduleSha256}`及`pixelFormat:'rgba8-srgb-straight-v1'`，WASM摘要固定为`22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70`。文本规范化协议仍为1，不能将其版本当作像素处理器身份。两源hash分别绑定原始可编辑源与规范化静态源，rasterSha256必须等于该asset的实际PNG；逻辑尺寸、锚点和占地继续由定义/实例字段表达，不能从SVG推断。原processor1记录仅保留上述公共字段，供显式独立迁入核验，不自动改标为2。

源是完整资源的一部分，同一asset的许可须明确覆盖源与派生；保留原件，源/规范化源和PNG都不可变。源字节与PNG共同进入完整/历史/目录闭包。最多256项来源、512个不同源hash，原始与规范化源各单文件1MiB、工程实际源字节合计32MiB，并计入总资源/ZIP预算；最多256张图片仍独立校验。通用不可变字节端口最多768条，为图片和两类源之和，不授予768张图片容量。这些是已实施保护值，不是容量实测。

M2-0所有转换输出`authoringSources:{}`；当时在真实SVG处理可用前拒绝非空，这是该历史切片边界。M2-4现已严格接收非空记录：重新读取并独立捕获源字节，核对UTF-8/长度/hash，重做原始与规范化源解析并核对确定性规范化结果，检查PNG尺寸/viewBox比例，经受信SVG端口实际栅格化后逐RGBA核对保存的PNG。缺SVG能力或任一步失败均不签发完整资源证明，不允许半验入库、保存、导出或渲染。

processor2在生产、PNG编码/解码和源关联验证中采用固定软件RGBA流程，不以当前浏览器原生SVG或Canvas往返定义基准像素；根源为processor2的固定调色/亮度派生沿同一软件像素链处理，普通位图及旧根保持既有算法。普通端口只提供2；processor1须显式旧环境能力并仍逐RGBA比对，不匹配即拒绝。工程容器继续是当前完整v1，不因独立处理器变化增加工程版本。

静态语法只接受svg/g/defs、有限线性/径向渐变及stop、path/rect/circle/ellipse/line/polyline/polygon和明确属性；拒绝XML声明/处理指令、注释、BOM、DOCTYPE/实体、脚本/事件、外部引用、image/text/字体/CSS、foreignObject、动画与滤镜。原始/规范化各1MiB、4096节点/32层/16384属性、256路径/16384路径命令/32768点、坐标和viewBox边8192；栅格上限边4096/1600万像素/20MiB，AI工具另限制长边16–1024像素。源不插入应用DOM；按各自固定处理器能力生成PNG，临时位图/URL均释放，失败和取消不采用。

同化授权冻结为单件、一个公开组合的存活成员或明确目标ID和边界的局部范围，不由模型自行扫描扩圈。SVG制作/修改产生新固定资源、定义和来源版本，原件及祖先源、确切许可、逻辑尺寸、锚点、占地、支撑、通行、秘密和组合/散布人工记录保持；tint/brightness/opacity逐目标物化，范围外和当前层规则不暗改。空白制作须先有明确授权的新物件/场景放置，不能用整张SVG替代语义场景。

<a id="image-to-project-model"></a>
### 图片校正草稿与当前工程实体（目标合同）

图片导入草稿保存像素坐标、原图身份、标定、正负例、相对高低和待确认关系。采用时按同一标定换算整数毫米并重新执行完整领域校验；共边唯一，开口绑定墙、端点、距离与宽度，物件独立定义外观、占地、支撑及隐私。绘制遮挡顺序、地面高程、Floor 和显式通行连接分开映射；无法表达或缺少证据的部分列入审阅差异。输出只使用当前严格完整 v1；新增持久语义须同步严格模型、命令、投影与 I/O。草稿代次和确认状态属于导入会话。过程见[识别与工程生成](reference/image-to-project.md#recognition)。

当前可重放拆解配方 `sceneweave-image-import-recipe@1`属于独立操作协议，页面和MCP共享。采用结果按原生Prop、PropDefinition与房间材质保存，个人item使用既有固定素材载体；用户修改名称、图像尺寸、占地或阻挡时创建新的固定定义与item。资源像素及实际来源许可闭包继续全验，当前工程格式保持完整v1。

拆解图层可选 `selectionMask` 保存原图坐标中的严格RLE覆盖蒙版，作为裁片外观的实际边界，保留孔洞及不连通细节；粗多边形与物理占地不替代该蒙版。页面画笔、磁性套索及MCP精修共用，采用时物化为固定PNG，普通工程与个人素材不依赖导入草稿。蒙版受尺寸、段数及累计预算约束，不能作为任意半透明内部或补底范围外改画的保真豁免。协议详情归[图片工具](reference/image-to-project.md#shared-tool)。

矢量拆解沿用本节既有静态SVG `authoringSources`，地面绑定材质纹理asset，物件绑定PropDefinition的图片asset；源、规范化源、processor2和实际PNG闭包全量校验。配方的 `floorVector` 与逐层 `vector` 记录重建方法、调色板、轮廓简化、木板方向/板宽和种子，仍为独立导入协议；不为它增加工程版本。矢量地面裁切保留原图坐标偏移，不能改变物理标定。逐层可选原图绝对像素占地矩形 `footprintPx`，转换到既有占地毫米尺寸和相对图像中心的偏移；完整视觉轮廓与物理本体分开。盆栽叶片伸到墙上不授权跳过本体支撑校验，非阻挡装饰同样检查支撑。源编辑创建新固定asset/定义/item，旧源及祖先许可不原地修改，完整保存与冷读仍按已有SVG合同执行。

<a id="asset-batch-import"></a>
#### 外部素材批量候选与现有字段映射

文件、多选文件夹及素材ZIP共用选定项候选准备路径；单张PNG/JPEG/WebP继续经过原有真实解码、方向/色彩规范化及元数据移除，单张入口使用同一条单项批次路径。受限外部SVG沿用上节静态语法、真实光栅和来源闭包，不新增另一种SVG信任级别。此入口只新增当前工程中的固定图片、物件定义或材质及其必要来源/许可，不能改变场景实例或既有固定内容，也不自动推广到个人库。批次选择、文件路径、校准表单和结果索引均为会话暂态；批量入口沿用已有严格字段，不增加batch或rootAnchor持久字段，也不因批量入库改变schema版本；完整v5仅按[曲线连接合同](#curved-connections-v5)增加可选route语义。

每项明确填写图像逻辑宽高；物件另填独立的物理占地、阻挡属性及可选根锚。根锚为从图像左上角量起的整数毫米`{x,y}`，满足`0≤x≤widthMm、0≤y≤heightMm`，映射为既有`defaultVisualBoundsMm:{x:-x,y:-y,width:widthMm,height:heightMm}`；缺省取`floor(widthMm/2)、floor(heightMm/2)`，保持原单图中心锚行为。根锚只改变图像相对放置原点的位置，不根据图像轮廓推断占地，不改变占地偏移、支撑、通行或视线语义。材质沿用图像及铺装毫米尺寸，不接受物件根锚。

每个选定项均须有完整许可正文、真实署名/来源与明确允许嵌入声明。许可引用按确切正文hash隔离并逐主体绑定，同名MIT等许可名不能替代正文或混用不同许可。实际规范化PNG按真实输出字节hash复用资源；相同图片配不同名称、尺寸、根锚、占地、阻挡、标签或许可仍产生独立固定定义。仅同批完全相同的捕获元数据、实际图片及SVG来源元数据可报告同一定义重复；不同SVG原文即使生成相同PNG，仍各自保全真实源闭包。名称冲突不授权覆盖既有定义。

只有明确选中的项进入完整素材语义/字节/像素校验与候选；来源收集的路径、归档结构及CRC安全检查按[06](06-storage-and-export.md#asset-batch-import)覆盖全部输入。首个异步边界前独立捕获全部选定项、嵌套数据及原生Blob字节句柄，拒绝数据对象中的访问器、隐藏/Symbol字段、自定义原型，以及稀疏或带额外字段的批次数组。选定任一项失败或取消均不返回可用半批工程；成功预览仍不写工程、历史或仓库，采用时再核对基线、完整依赖/资源，一次递增revision并形成一次撤销单位。采用后撤销整批目录变化，不能逐项留下半批来源。

所选1–64项仍受普通素材目录事务的**256实际新增记录/展开预算**约束。成本取新增固定记录数与实际展开成本的较大者：记录覆盖场景五类固定目录、固定sources/variants/prefabAppearanceTemplates/presentations、工程图片/authoringSources/许可及新增逐主体许可绑定；准备末尾与公共工作区预览入口共用同一公式并分别拒绝超限。64是选择上限，不能保证64个不同定义均可采用；此入口不取得[动态底图策略](#capacity-budget-evolution)的512/1024/2048档位，不自动拆批绕限。累计源、输出字节、真实处理像素及完整工程上限继续独立检查，数值和保存失败边界见[06批量入库合同](06-storage-and-export.md#asset-batch-import)；本次实现与定向证据归[素材工作区台账](archive/workspace-content-validation.md#asset-batch-20261031)，不据此提前签收验收或发布。

### D. 目录身份映射

已有位图/参数条目冻结为身份算法1：namespace、逻辑键`[1,namespace,kind,catalogId,fixedVersion]`、精确键追加contentHash。内容投影与现行catalog/content.ts一致：固定定义五集合、固定外观三集合、资源五字段元数据、排序许可hash和完整绑定；不含工程格式/ID/revision/层实例、载体hash或个人整理。空authoringSources不加入旧投影，转换后这类条目的namespace/logicalKey/contentHash/key必须逐字相同；capsuleSha256按新ZIP重算。

M2-0e已在shared/library直接实现算法1及严格完整v1中性载体，不经旧v6视图计算。载体必须完整等于固定中性工程的所选根闭包，包含祖先/非活动派生输入输出/保全定义及私密组合模板，不能携带场景实例、层规则、历史或原件；读取实际字节/许可/派生像素后重抽闭包核对。内置全部62项完整item及6组refines逐字保持，结果见51。

非空SVG源属于新增固定内容，使用已接通的身份算法2：键首项2，其内容hash覆盖`{domain:'sceneweave-svg-fixed',version:1,base:算法1完整投影,authoringSources:所选根必要源闭包}`；不能把源忽略后沿用纯位图身份。中性载体精确保留所选根及祖先所需SVG源/实际PNG/许可，个人库安装、采用与所选离线备份均完整核对；源原文改变即使规范化和PNG相同也改变身份。M2-0当时不产生/安装算法2的历史保持；此算法号与工程文件v1分开，既有无SVG素材继续使用算法1，不整体重编号。

个人tags/colors/favorite、organization-only及安装状态保持确切key关系。默认namespace/定义/物理字段/许可/固定版本不因换载体改变。62项curation和6项refines按新构造器实算旧key等价，禁止名称/catalogId/缩略图或“最新版”兜底。新库/新备份与全组织保全归06；旧40保持旧严格合同，不就地改义。

### E. 原子候选接口边界

共享应用接口区分`prepareAtomicCandidate`与`adoptAtomicCandidate`。候选绑定主工程sceneId/revision/checkpoint/contentHash、任务代次（如有）、明确scope/允许工具和字段、步骤来源、完整读写集合/差异及实际展开成本。运行时内部凭证只绑定本机独立捕获/校验后的对象，不能由网络JSON填入validated或skipValidation。

生成候选还须绑定输入/算法/固定素材指纹、冻结请求ID/时间、操作代次、新身份分配表、完整delta及hash、真实读写集合、字段级影响、资源变化、约束和实际成本。新请求即使同seed同形，也分配新出生身份；不能重用已删token。新建工程同样预演完整成本；可明确减少未锁定的软细节并列差异，不能降低硬要求、净宽或物理/显示一致性，不在后台拆成多次采用。同一操作依赖的地形、支撑、规则、人工记录与图像锚点必须一起提交。

普通手工与创作v1的跨领域步骤先在独立副本按支持顺序执行，保留真实中间身份推进，最终完整验证。当前工作台普通手工按F节的独立对象与多维保护检查；创作v1保留原256展开公式，程序底图接续v2/v3也按F节对应版本策略执行。不得将多轮命令绕过最终上限，也不能直接取消现有混批拒绝。对远端草稿须本地校验/重放其受支持步骤后产生自己的候选，不直接采信完整模型JSON或自报成本。

<a id="program-base-map-protocol"></a>
程序底图使用独立传输协议`sceneweave-base-map@1|@2|@3`，不扩充持久工程格式。以下为@1兼容合同；@2在严格请求中加入flowId与完整冻结policy，结果hash另覆盖generationBudget的语义目标/成本及复杂度，完整来源与分类接续见[F节](#capacity-budget-evolution)和[05](05-ai-and-generation.md#budget-continuation-contract)。严格请求区分当前`workspaceSceneId/checkpoint/operationEpoch`与独立空白`base.sceneId`；只接受无实体/注记/锁/历史标记的SceneDocument2/visual1。`generation`明确为普通terrain输入或composition配方，省略旧算法/配方版本仍保持1含义。`inputHash`覆盖完整规范generation，`baseHash`覆盖完整空白，`paletteHash`覆盖固定assets/materials/propDefinitions/prefabDefinitions/styleThemes及activeStyleThemeRef；响应`resultHash`覆盖`{generation,result,domainCost}`。普通结果保留完整TerrainGenerationResult，组合保留完整领域文档和严格plan；服务端与Worker使用同一纯执行器。协议请求/结果分别限4/8MiB，不能用摘要代替实际领域结果。@3明确使用算法4/配方4、完整注册profile及profileHash；inputHash绑定generation和profileHash，结果hash覆盖独立usage及语义成本，领域cost不再表示旧混合展开量；具体限额与兼容归F节。

@3明确分派算法/配方6与7，不改变更早选择器、缺省含义或重放结果。算法6/配方6继续使用`terrain-scene-v6` / `terrain-compose-v6`；算法7/配方7分别使用`GET /v1/capabilities?baseMapSelector=terrain-scene-v7` / `terrain-compose-v7`精确协商，核对返回的单一`baseMapSelectors`、底图协议版本和本次注册profile hash后才发送原样@3请求。旧服务缺少确切选择器时，显式服务端生成在POST前失败，不静默改走Worker。v7只把规则驱动的材质/植被和目标岩岛视觉派生放入新结果；固定seed及出生令牌可确定性重放，候选仍需浏览器完整重放、资源/许可/像素校验及最终成本复核。v6输出及历史保持原义，不按新规则重解释；v7不升级工程schema，也不授予AI修改严格v8工程的能力，AI完整工程版本仍限3–7。算法/配方5原有`surfaceRecipeVersions:[1]`协商只用于其旧地表含义，保持独立。

`domainCost`包含完整领域展开，组合使用真实临时计数图的identity/appearance元数据，但仍标`finalAdoptionCostChecked:false`；不返回或安装这些计数身份。浏览器须重放完整结果、物化并校验真实资源，再核对实际成本。通过后，独立候选的会话回执绑定真实完整`projectHash`与`initialOperationCost/operationLimit=256/remainingOperationCost`；采用继续用当前会话凭证，网络JSON不能直接成为可采用凭证。回执不是工程永久容量或后续AI账本，也不进入严格文档、历史或导出；跨冷读继续同一生成/AI流程须后续显式可重放合同，不从当前实体数或seed猜测初始成本。

最终写目标及真实支撑几何按主工程基线及采用时当前的有效实体锁/层锁检查；只读资源、许可及排序引用保留在依赖集合，不因此获得写权限或把纯排序读取当作编辑；草稿内先解锁再编辑不授予额外权限。确需解锁时，由用户先做独立事务，原任务基线失效后重新计算。

最终采用前保护当前保存点，再源/场景/历史元数据CAS，主工程只一次revision+1与一个撤销单位。旧基线、锁/范围/资源/预算失败不部分采用；草稿保留供显式重算。M2-2建立本机授权/重放与采用入口，M2-3现已扩到有限建筑、室外、组合/散布和GM文字，M2-4加入延后物化的SVG/参数配方；均复用同一原子入口，`previewPrepared`仍限追加素材。本机依据确切基线重放全部账本，物化后的完整候选重新验证资源/像素并确认真实变化；确定性身份、256累计预算、等待本机校验及30秒采用租约保持，详细合同见[05](05-ai-and-generation.md)。场景工具不因此获得秘密改写、未授权依赖、通用寻路或持久建筑恢复能力。

<a id="capacity-budget-evolution"></a>
### F. 分层容量目标与版本化预算

本节定义分层容量目标、当前普通手工事务及程序底图接AI的独立运行时策略；创作v1、底图@1和未显式选择新策略的共享入口继续使用原公式。普通手工策略不写入工程或AI账本，不改写旧任务重放含义，当前完整工程仍为v1。产品采用[分层编辑能力](01-product.md#25-分层容量目标已确认待实现)，容量同时核对场景JSON字节/值数量、实际实例、出生及墓碑、来源/资源和历史增长；不能只提高命令常量，或靠分组、拆提交规避实际成本。实现任务只在[路线图](07-roadmap.md#development)维护。

| 预算维度 | 目标语义 |
|---|---|
| 语义编辑量 | 按操作实际展开的语义目标计量；同一操作内去重，AI不同操作之间累计。曲线点/段、自动来源与身份记录不直接折算为用户编辑次数，实际改变的依赖对象仍计入。具体对象和边界见下表。 |
| 计算复杂度 | 几何点/段、依赖展开、求交/采样、候选搜索及渲染等分别有界；一个语义目标也不能带入无界几何。来源、身份及生成状态等记账数据从用户编辑额度中解耦，仍完整验证，并有独立数量、字节与计算保护。 |
| 工程与资源容量 | 区分完整领域对象与轻量装饰实例，保存完整实际结果及适用人工记录；文档、身份/墓碑、历史、图片/源字节、解压及像素预算共同核对。数据结构改变采用新严格版本和完整副本迁移，保全旧工程与来源链。 |
| AI执行与全流程 | 程序底图生成和后续AI修改分别限额，保留覆盖两者的完整累计账本及全流程计算、资源、时间上限。分类额度不授权重置历史成本，也不能绕过最终一次采用的完整影响校验；具体接续合同归[05](05-ai-and-generation.md#2-前后端职责与网络)。 |

<a id="aggregate-coordinate-contract"></a>
#### 层级坐标、聚合体与区块（运行时合同与持久目标）

[通用设计3.8](reference/general-map-generation.md#aggregate-spatial-capacity)规定整体与成员使用核心/局部坐标，对外暴露端口、占地、支撑及明确依赖。当前完整v1在运行时只提供物化的world视图；含聚合成员的工程包、数据库和历史检查点以`aggregateCoordinates.encoding=local`保存实体坐标，父级帧树是其唯一持久坐标。没有聚合字段的旧工程仍逐字段等价。严格读取必须先转换为独立world视图，再执行原完整领域、资源、身份、许可和玩家输出校验；不保留可分别修改的world/local两份几何。完整实现状态与尚未覆盖的转换器接线归[07的b](07-roadmap.md#t2-implementation)，数据迁入保全旧成果，不新增长期工程格式版本。

不变量：所有权/变换父级唯一且无环，层级有界；语义组与空间区块正交，跨块索引不复制实体；共享墙由房间所有者的最近共同组持有，没有共同组时归世界层。内部证明绑定校验器掌握的确切内容、代次、约束与相关依赖；移动只复用被该变换保持的性质，新旧位置的支撑/空间冲突、成员锁及受众仍检查。外部真实ID引用须纳入端口或明确依赖，不以“已封装”忽略跨界关系。

重新归组和解组保持未变实体身份；新容器、复制实例及切割产生的新实体按各自事件分配身份，真实拓扑改变更新令牌。区块清单和完整内容引用、人工修改/删除/退出及历史仍可独立读取；来源seed与算法版本不能代替已生成结果。预算分别描述操作根、实际影响成员、工作与资源，不以只写核心字段隐瞒成员权限/锁和外部影响。开发顺序归[07子步骤表](07-roadmap.md#t2-implementation)，存储目标归[06](06-storage-and-export.md#aggregate-chunk-storage)。

**a的只读诊断接口**定义在`src/shared/model/aggregate.ts`和`src/shared/aggregates/contracts.ts`。`sceneweave-aggregate-contract@1`绑定会话完整场景，不是持久工程版本，也不进入历史或包。b另将严格`aggregateCoordinates`字段纳入唯一完整v1；它不带块字节、加载态、内部证明或AI权限。

| 字段 / 结果 | 严格含义与边界 |
|---|---|
| `source` | 绑定sceneId、revision及完整规范场景SHA256；同revision换内容也失效。解析先检查普通JSON描述符，再独立完整校验场景；输入不变、不冻结，输出独立深冻结。hash仅用于确切来源核对，不充当可复用证明。 |
| `groups` | 显式成员`kind/id`、唯一父级、Floor、帧及组锁；不按位置自动收编。最多4096组、深度16，成员与祖先同Floor；重复归属、缺父、环、缺实体和共墙归属错误拒绝。未分组实体合法。 |
| `aggregateCoordinates` | 严格对象 `{encoding,groups}`；有效场景仅接受`encoding: world`。磁盘专用`local`在包/IDB边界先解码，不能直接交给渲染、命令或领域验证。每组字段含唯一父级、同Floor、0–3次四分之一圈帧、明确成员和保留的未启用组锁字段。组ID不得撞场景、Floor、实体、固定定义或图层；成员只能唯一归属。 |
| `frame` | `translationMm`与`quarterTurns`均严格解析；变换和反变换使用BigInt中间值，最终点、方向和边界框须安全。点和可旋转方向按祖先链组合，父级变换顺序不交换。自由角、缩放、剪切和未知键拒绝。 |
| `ports` | 最多16384个，绑定本组/子组实际opening、path的start/end或terrainConnection的from/to，同组同端点不得重复。`inspectAggregateContract`从完整world场景派生端口位置/方向/净宽/Floor/高程/支撑及结构连接/当前局部通行，并将端点和几何绑定到来源hash；开口使用稳定墙端点，路径/连接使用实际中心线和支撑。结构连接不代表当前通行，局部通行也不证明全图可达。尚无bridge实体，不声明桥头适配。独立`deriveAggregatePortGeometry`要求真实组归属，拒绝调用者提交几何。 |
| `chunks` | 最多16384块，以Floor和有符号整数x/y为稳定键，统一正整数毫米块宽；半开单元两端须安全整数。planned/generated/modified与驻留状态独立。只索引同Floor现存实体，可跨块重复引用但单块不能重复，不改变成员所有权；planned不得携带实际实体。全部组/块成员引用累计最多131072。这些数值是合同保护值，不是容量证明。 |
| 检查结果 | 枚举未分组及未索引实体，区块缺索引不解释为空白；从当前真实实体关系列出跨组几何、附着、支撑、成员与注记引用。`aggregateAffectedClosure`沿反向依赖与几何/成员共同编辑关系求确定性闭包，返回须整Floor复核的提示；未知目标或悬空/跨Floor引用要求全场景回退。该实体图不含appearance/资源和生成来源，也不代替完整领域校验。 |
| 空间候选与受众 | `buildAggregateSpatialIndex`从已校验world场景的实际房间、墙/开口、物件足迹/视觉范围、地形、道路/连接、危险区和布景生成Floor隔离的保守包围盒网格；player索引先应用现有公开可见性闭包，私密几何不进入候选/摘要。`queryAggregateSpatialIndex`及`queryAggregateSpatialChange`只返回旧/新范围的宽相候选，不证明精确相交、净空、支撑或通行；索引绑定完整来源，改动后拒绝旧索引，巨型范围回退至该Floor扫描。 |
| 锁与秘密 | 复用当前选择锁闭包，分别报告组祖先、自身实体、既有容器、递归注记/建筑/支撑等依赖与独立去重的图层锁来源；精确操作仍须调用当前命令锁闭包重新检查完整影响。合同诊断仅供GM；尚未求递归闭包的vertex/note明确为unresolved，不发布玩家摘要。独立player空间索引先过滤秘密，再建立可见候选。 |
| 能力与身份 | b已开放严格局部坐标持久化、世界视图转换、创建归属/换父级/解组；这些操作不移动世界几何或改变拓扑。c的私有冻结证明绑定完整`ProjectData`元数据、确切场景/合同、组成员/边界依赖、约束和算法；公开验证仍完整核源，复制或内容变化失效。边界查询必须匹配工程唯一持久归属、目标组及Floor，证明结果`baselineProofValid`只指未变基线有效。独立捕获的只读检查器可复用同一基线空间索引、组证明和最多16项依赖闭包，查询范围明确为`supplied-bounds`；不能认证候选不变量或把组外候选当真实写集。普通单/多物件位置/角度及建筑结构预览已消费此诊断；实际实体差异与入口约束形成根，前后反向依赖和建筑附着上下文共同确定范围，按持久组/Floor报告。候选查询移除全部失效旧行并补入候选真实包络，不能漏掉同时移动的组外对象；厚墙使用真实miter/bevel，玩家先过滤隐藏邻墙。无独立包络或仅有锚点的关联内容明确要求保守全场景回退。报告只在GM会话/预览中，不入工程、历史或玩家输出。候选内部复用另由场景校验器的私有确切snapshot及严格认证三元基线负责：仅私有受控执行器签发的真实写集可证明既有Prop的positionMm/rotationDeg变化，范围包括组外独立Prop及通过帧坐标往返检查的聚合成员；复制、外部冻结、调用方changed IDs或边界诊断不能取得该证明。Prefab/scatter/decorationCluster托管成员、生成读写/检查依赖及可能影响地形过渡的物件保守回到完整路径。未变几何结论仅沿该确切证明复用，变化物件完整旋转占地/显示范围/真实支撑及所有连接的真实带区碰撞重算；依赖、其他域、身份/外观、资源许可、锁、预算和采用CAS仍检查。诊断证据不授予权限或持久化；公开校验、冷读及包边界继续完整几何。建筑整体变换按下节有限合同执行；自然/有限拆合和按需派生按下文合同，分块保存归06；任意几何切割和AI聚合操作仍未开放。 |

驻留合同另为unloaded/loading/resident或带reason的failed；它不能提供验证凭证。a接受的是显式只读提案，不是自动持久分组或已完成的空间分区。端口和块内容完整性、内部证明及命令/存储接线继续按b–h完成；[完整v1使用方映射](reference/general-map-generation.md#aggregate-consumer-map)列出后续责任。

<a id="aggregate-building-transform"></a>
#### 完整建筑组与整体变换（d有限支持）

建筑工具从现存房间明确创建持久组，消费共墙/共顶点连通建筑、真实门窗、房间支撑物件/道路、容器成员与递归附着注记的完整移动闭包；只读地形/Floor支撑不收编。Floor支撑的独立物件不因位于房间轮廓内而自动归组。创建先列实际成员并预览确认；组选择和进入内部为会话行为，成员仍使用原单件命令编辑。

`transformAggregateBuilding`只接受现存组ID、整数毫米`offsetMm/pivotMm`及0–3次`quarterTurns`。选定组子树必须恰好拥有完整连通建筑及全部随动成员；缺少共墙、跨组共享结构、后增附着依赖或额外成员均明确拒绝，不能自动收编或半移。只改变根的世界刚体帧，再反算其父级局部帧；子组帧保持，现有world消费者读取变换后的实际实体。实体ID、出生/未变拓扑、门沿墙附着距离、锁/秘密与人工内容保持；近侧视方向仍按既有固定表现合同处理，固定表面源按真实变换派生，不能烘焙层/实例有效外观。

变换使用既有建筑事务和完整领域/资源校验；再检查最终位置的有限跨边界净空：真实厚墙及miter/bevel、结构门洞、旋转物理占地、阻挡区域、道路完整方端帽/转角带区及门前带。门前带深度为半墙厚向上取整＋半门宽向上取整＋1mm；只检查外部阻挡，不把既有内部家具布局或初次生成建议升级为全图必达要求。门当前开关/门锁不改变；秘密内容仍参加GM完整检查，玩家输出先过滤。仅一端随建筑移动的外接台阶/坡道明确拒绝；不暗中拉伸道路、重绑支撑或移动外部障碍。编辑只要求最终落点合法，不模拟沿途运动。

所有实际成员、递归依赖、图层和只读支撑沿原锁策略检查，组/祖先锁不覆盖成员锁；当前组锁字段仍未开放编辑。manual按真实展开和变化元数据计量，组不算一个物件掩盖成员工作。预览不写工程，采用前复核基线/CAS，成功为一次revision与撤销单位，保存冷读及完整包保全实际内容。此路径仍完整物化和几何校验，不扩大c的内部证明复用范围，不声明仅改根即可O(1)完成、分区存储或容量/性能收益。

<a id="aggregate-domain-editing"></a>
#### 自然聚合、有限拆合与容器出生（e/g）

`AGGREGATE_DOMAIN_ADAPTERS`以相同的成员、根帧、端口和只读依赖合同适配建筑与自然内容。自然组由用户明确选择一个或多个`terrainArea`，沿真实支撑、建筑连通、容器和递归注记关系列出完整随动闭包，不因相邻或题材名收编对象；已有生成归属仅用于确切来源关联。`transformAggregateNatural`使用整数毫米平移和四分之一转，保留高程、Floor、实际道路/高差连接、散布/布景人工、删除及退出记录。固定配方和seed不重跑；固定表面源另行派生，物化边缘与过渡由原所有者重算来源。外部非Floor支撑不完整、共享曲线半移、无确切归属的世界排除、锁定或过期来源明确拒绝；完整最终几何检查仍可拒绝不能精确再采样的曲线，不承诺任意曲线变换均合法。

`splitAggregateGroup`将源组的全部直接成员和直接子组恰好分配到至少两个新容器；`mergeAggregateGroups`只合并同Floor、同父级的组。它们与换父级、解组均保留世界几何、实际成员ID、未变拓扑及人工记录，共墙LCA等原所有权约束继续检查。当前切割限成员/完整子组的归属分区，不进行建筑或地形布尔切割。有限复制只支持独立prop与注记的完整组子树，逐项确认外部支撑/锚点，生成新成员和容器ID，重映射内部递归注记，保留固定源、有效秘密及人工位置；Prefab、散布、布景、结构和跨工程资源迁入不由此入口隐式展开。跨工程仍使用完整工程/资源许可导入边界。

当前`HistoryIdentity`直接增加可选`aggregateTokens: Record<groupId,birthToken>`，身份版本保持5；存在活组时每组必须有真实出生记录，无组且从未分组的工程可省略。退休容器保留墓碑，新建/拆合/复制不得复用已分配ID；出生与其他身份池全局唯一并共用65536保护。真实撤销/重做恢复同一出生并保留已产生墓碑，普通删除重建不能冒充恢复。候选、保存、完整包和所有保留分支均保全该账本。组锁字段尚未开放，成员、图层和依赖锁仍逐项检查。

<a id="aggregate-derived-loading"></a>
#### 空间区块与按需派生（f有限支持）

`aggregate-spatial-chunks@1`按稳定Floor/x/y建立内容清单，跨块实体只有一份实际内容，单元仅引用ID；planned/generated/modified与unloaded/loading/resident/failed分开。查询合并必要邻接范围及任意距离的显式依赖，视口命中和显式选择才派生相应精确形状；巨型或无独立包络实体保守保留。缺少实际区块、实体或派生失败明确拒绝，不当空白。调用者先完成受众过滤，驻留状态不授予几何或资源证明。

正常编辑器按视口延迟屏外物件的绘制位图解码，首次完整资源验证、JSON、投影及PNG仍全量；尚不提供实体JSON卸载或冷读内存收益。显式新分区采样器`aggregate-partition-stream@1`从seed、算法、逻辑区域键和空间坐标派生，使用邻接带及半开唯一归属；执行顺序不改结果，不改既有森林/火山等重放向量，也不因移动/复制组重新撒点。

<a id="manual-transaction-budget"></a>
#### 普通手工事务与负载分档（T5基础、层级组合i，2026-11-06）

**计量合同**：普通编辑目标与组内影响分别准入；完整几何、工作、依赖、元数据及资源继续独立保护。这些是开发保护上限，不能作为已验证容量或耗时承诺。实施及自检状态以[路线图i](07-roadmap.md#t2-implementation)为准。

工作台明确选择注册`manual`策略，整份策略必须与注册值相等。三档统一使用独立的`profileVersion=3/countingVersion=2`；compact为256目标，standard/expanded带明确tierId，分别512/1024目标。此版本只标记会话内manual准入，不改变完整工程v1或生成/AI策略版本。普通场景/建筑/室外/视觉/外观/图层命令、填充复制、固定素材与场景联合候选、普通布景，以及受支持的属性/室外/建筑局部恢复使用此策略。生成、笔刷/布尔地形算子、领域局部重生成和AI仍走各自明确策略及原重放路径；不把这些流程的冻结cost/hash换成普通手工计数。

| 独立维度 | compact | standard | expanded |
|---|---:|---:|---:|
| 编辑目标 / 原始命令 / 请求选择上限（各自） | 256 | 512 | 1024 |
| 纯核心变换的组内影响（实际成员及子组容器） | 4096 | 16384 | 65536 |
| 几何点 / 几何段（各自） | 4096 | 16384 | 65536 |
| 曲线控制段 | 128 | 256 | 256 |
| 网格节点 | 24576 | 65536 | 65536 |
| 场求值 | 196608 | 786432 | 3145728 |
| 求交边对 | 2000000 | 32000000 | 128000000 |
| 完整依赖引用 | 4096 | 32768 | 131072 |
| 变化元数据记录 / 规范字节 | 8192 / 2MiB | 32768 / 8MiB | 131072 / 32MiB |
| 唯一资源保留字节 / 像素 | 300MiB / 64000000 | 同左 | 同左 |
| 候选尝试 / 主动执行毫秒 | 4 / 300000 | 同左 | 同左 |

准备前静态展开明确请求：图层/外观成员、组合成员、拆合/换父级、真实新副本与容器，以及组整体变换的完整子树。超过512请求目标、1024保留实体或16384组内影响选expanded，否则超过256请求目标、256保留实体或4096组内影响选standard，其余compact；未知输出的有限领域命令一次保守选择expanded。恢复在读取真实快照后展开当前/历史图层、组合/散布成员和结构关联范围，再固定档位。候选/恢复预览携带确切冻结profile，采用复用同一档；不先试跑、捕获超限再升级重跑，也不拆批。填充每份计真实存活成员及新容器；原始命令、请求选择、实际展开和组内影响各自保护。纯素材入库256新增记录、组合自身128成员、房间顶点/连接采样等单对象保护保持；默认共享及旧TaskProfile入口保留其原256解析。

点/段完整计源与实际样本，简化/删除也检查旧几何，同批重复修改累计几何工作。求交使用保守结构估计和已有执行观测，不能当作端到端耗时；未观测的计时也不能据此宣称已测性能。只读依赖不占对象额度，但核对完整闭包。变化元数据包含增删和键字节，未变化记录不重复占增量额度；完整工程JSON/身份限制另外执行。资源按完整真实闭包核对，不扩大原字节、hash、许可或像素准入。各维独立拒绝，不合成总分。

例如一条200点道路计1个对象，几何点/段另计；移动共享墙顶点时，实际改变的墙、房间及附着开口各计一次，内部顶点不额外计对象。组合/散布/簇按实际改变成员计，现存纯承载同步的容器不重复加1；新建/删除容器与独立业务变化仍计。复制按所有实际新成员和新容器计，不压缩成一个核心。图层规则按层→实例覆盖后的实际有效变化展开，已被实例覆盖且未改变的成员不占对象额度。场景设置与Floor也有明确目标，身份/固定源/自动关系不冒充独立编辑次数。

纯组平移/四分之一转只有在真实before/after可证明根核心帧之外的完整子树归属、局部几何、业务字段、图层及有效外观关系均未变时，才计1个编辑目标；实际成员和嵌套子组另记`groupMembers`，外部实际关系端点另记`externalDependencies`。固定表面源的变换派生须保留真实祖先且在局部帧下参数完全相同；固定近侧物件仍保持世界朝向。不能只凭命令名称、调用方布尔值或hash获得减计。组内位置/删除/外观修改、拆合、换父级、解组以及不能证明不变的人工/散布业务记录，均回到实际目标计数；混合变换与成员编辑不能藏在核心中。成员/图层锁、秘密、支撑、端口及外部道路/连接仍完整检查，结构/自然变换继续全量物化和几何求解。即使编辑目标为1，任何独立几何或依赖上限仍可拒绝。

准备阶段逐步检查中间完整候选并累计几何/已有执行观测，物化后再检查完整资源；注册预览及采用前从真实工作区基线按同一档重算最终影响，并保留准备期间已计的工作和组内影响峰值。预览分别显示编辑目标、组内影响、组外依赖及几何等读数；保护详情仅为本次候选的会话内读数，默认折叠，不进入工程、历史、导出或AI账本。取消、旧基线、任一分量超限均不部分采用；局部恢复仍先保护当前，再完整CAS和一次撤销。纯素材入库继续独立检查256新增固定记录；联合候选分别检查素材记录和场景对象，不再混成同一总分。

T5基础证据见[工作区台账](archive/workspace-content-validation.md#manual-transaction-budget-20261105)，T2分档与优化的新负载、方法和限制另归[性能参考](reference/performance.md#t2-manual-capacity-20261105)。500/2000完整Prop及实际512/1024层迁移仅支撑首批开发范围，不能外推复杂建筑、密集纹理、所有1024命令组合或几十万内容；T2后续分层容量及完整矩阵仍待[09](09-quality-plan.md#acceptance)。

旧底图@2/创作v2保留`sceneweave-generated-authoring`策略1/计数1（G256/A256/最终512及原复杂度保护）；新底图@3/创作v3使用策略2/计数2，按范围、画面细节和本机设备探针，在开始前选择small/standard/expanded注册档位，也可显式选择。注册档位分别提供512/1024/2048生成目标与相同的AI累计目标，最终采用上限为1024/2048/4096，仍受完整几何和资源约束。这不开放通用手工事务扩容，也不等于产品容量验收通过。成本含义变化须显式固定策略版本，并同步任务/传输/重放合同；旧任务按原策略重放或明确拒绝不支持的接续，不能用新计价重新解释旧hash与账本。只有持久结构改变才升级工程格式，不为纯运行时计价变化机械迁移全部工程。旧策略1由底图@2/创作v2、策略2由底图@3/创作v3协商，旧入口保持原有限额。新增创作v4须独立协商 `sceneweave-current-authoring@1`：真实source3保留策略2注册档位；当前工程source4不伪造生成来源，G=0/A256且整任务实际展开/最终采用仍≤256，工作维度另按新能力保护。新4账本首项明确baseline或generation，四hash贯穿；不改变旧1–3的计价或内容hash。完整合同归[05](05-ai-and-generation.md#current-authoring-contract)。

#### 语义目标与一次操作

语义目标用稳定的`kind/id`定位，包括可独立编辑的场景对象、视觉对象及用户图层；有效几何、位置、外观、物理/受众属性或成员归属发生改变时进入影响集合。仅作支撑、许可或排序读取的依赖不算编辑，但继续参与范围和锁检查。内部顶点/采样点、派生片段、身份令牌、固定来源副本及自动生成关系归复杂度/记账预算；不能把可独立编辑的物件降为内部记录以少计。

| 操作情形 | 计量规则 |
|---|---|
| 一个对象改多个字段 | 同一原子操作内按一个语义目标计。一次手工拖动的多次pointer预览不重复扣额度，确认时按最终实际影响集合检查；预览计算仍有独立上限。 |
| 一段曲线或一行过渡 | 该视觉对象计1；它真实改变的TerrainArea、Path、其他独立视觉对象等依赖分别计入。控制点、采样点、多边形及笔触数量进入几何预算，不能把其物理依赖藏在“视觉1次”中。 |
| 组合或散布500个成员 | 实际改变500个可独立编辑成员就计500，同一成员不因组入口和成员入口重复计。容器为承载成员更新而同步的列表/派生状态不额外加1；另有独立容器业务变更时才作为独立目标。 |
| 图层或外观规则 | 只改层名等独立组织属性，按该层计1；改变规则导致500个物件的有效外观变化，按实际500个目标展开，不能只按规则行计1。隐藏/独显、选区和视口仍是编辑暂态。 |
| 共享墙、附着和支撑联动 | 按完整领域影响列出实际改变的独立对象并去重；共享墙只计一次。原始坐标点、邻接搜索及只读支撑不作为额外语义目标，几何/依赖校验不省略。 |
| 自动来源/身份/生成记录 | 不重复扣场景编辑额度，逐项核对来源、许可、出生/拓扑、人工记录和引用，并进入独立记录数量/字节及计算预算。独立素材制作仍受相应资源任务预算，不由此获得无限SVG或图片生成。 |

一次AI操作按`max(1, 本次明确编辑目标与真实改变目标的并集大小)`累计；同一目标在后续操作再次处理仍计，no-op至少1，改回不退款。服务为一种操作展开的内部命令在该操作内去重；多次AI操作不能合并成一次“批处理”来抵消成本。手工确认无实际变化不新增工程事务，预览和计算消耗仍记录。

#### 三种边界分别检查

1. **操作边界**：手工确认或每次受支持AI操作检查语义目标、几何复杂度、实际依赖、锁与资源；所有中间状态合法，不能只检查最终JSON。
2. **流程累计边界**：生成累计`G`、AI修改累计`A`各自单调增加并分别检查额度。成功步骤才进入场景编辑账本；整步失败不保留部分修改，已发生的模型请求、工具尝试、计算和时间不退款。预演不扣编辑额度，但计工具及实际执行消耗；检查/重放同一已记账步骤不再次扣语义额度。相同操作ID的幂等交付不能重复安装，内容不同则拒绝。
3. **最终采用边界**：从实际采用基线到最终完整候选计算一次影响集合，检查全部依赖和一次采用安全边界；它与`G/A`累计是不同量，最终净差不能抵消先前累计。新建底图接AI从新空白基线计算完整结果；已有地图局部编辑从其确切主工程基线计算变化。策略必须能覆盖其允许的生成与AI额度组合，不能实际又塞回旧256总池。先保护、CAS、一次revision增长和一个撤销单位保持。

几何输入/输出点段、实际依赖遍历/求交/候选次数、记录数量/字节、图片/源字节、解码/绘制像素分别有上限，不把不同单位相加冒充“成本总分”。可重放的结构规模与执行端实际工作量分别记录；场景/历史保留量取实际完整闭包，重复使用同一不可变资产不重复算保留字节，但每次真实解码和执行仍计资源/时间。保存、冷读、导入、导出继续按完整工程容量校验。

#### 旧策略1兼容边界

| 维度 | 固定保护 |
|---|---|
| 语义量 | G256、A256、最终完整采用512；同一操作内去重，跨操作累计，no-op至少1、改回不退款 |
| 结构复杂度 | 每操作256、累计131072；这是原领域展开公式的独立保护，不是语义额度 |
| 账本/集合 | 最多256步、每步16操作；读集合16384、写集合8192 |
| 来源/请求 | 来源16MiB、接续请求24MiB；完整工程、JSON、资源与像素另取原有更严保护 |
| 执行 | 同流程16次模型请求、64次工具尝试、300000ms主动执行；失败、取消、重放计算不退款 |

首版接续只使用现有受支持领域操作与固定资源闭包，不支持延后SVG/样式素材制作；需要新增派生位图的底图不能接续，合法底图仍可独立采用。计价层有限entities滤镜按明确目标及真实有效变化展开，载体记录不重复加1；scene/region/layer滤镜拒绝。旧创作v2/v3的完整v3/v4底图不支持visual创作授权，旧接续明确拒绝此授权，不能据计价帮助函数广告视觉能力。旧v1滤镜语义不改。

策略的`evidence=roadmap-capacity-diagnostic-20261030`对应[容量模块诊断](reference/performance.md#interaction-capacity-20261030)、[账本与真实接续检查](archive/ai-validation.md#base-map-continuation-20261030)的组合依据。4000物件模块观察不证明512目标一次事务性能；512/513纯元数据边界和真实资源接续样例分别记录，不能拼成已测G256+A256的512对象完整旅程。总实体10000、ProjectData 600000 JSON值、scene/identity/appearance各自20MiB及65536身份记录仍共同约束，不能把保护值当作容量承诺。

#### 当前策略2与动态选择

`TaskBudgetProfile`固定profileId、profileVersion=1、countingVersion=2、各维限额与profileHash；仅接受注册表中完整相等的档位。自动选择先按任务类型、画布面积和standard/detailed细节确定需求，再受设备档位限制；浏览器使用逻辑处理器、可用时的设备内存提示和一次有界整数计算探针，结果仅作为本页本地选择依据，不上传原始硬件数据、不代表可用RAM或正式性能分数。显式档位直接选择对应注册值。选定后进入输入hash、来源、策略hash、账本与采用身份，同一任务不得动态加额、降精度或切换算法。

| 独立维度（单候选保护） | small | standard | expanded |
|---|---:|---:|---:|
| 语义编辑目标 | 512 | 1024 | 2048 |
| 几何点 / 几何段（各自） | 4096 | 8192 | 16384 |
| 曲线控制段 | 128 | 256 | 256 |
| 实际网格节点 | 24576 | 49152 | 65536 |
| 场求值 | 196608 | 393216 | 786432 |
| 求交边对 | 2000000 | 4000000 | 8000000 |
| 依赖引用 | 4096 | 8192 | 16384 |
| 元数据记录 | 8192 | 16384 | 32768 |
| 元数据规范字节 | 2MiB | 4MiB | 8MiB |
| 唯一资源保留字节 | 64MiB | 128MiB | 256MiB |
| 唯一资源准入像素 | 16000000 | 32000000 | 64000000 |
| 候选尝试 | 4 | 4 | 4 |

各维独立拒绝，不再将点、记录和实体相加后卡256。几何包括区域地图、轮廓采样、控制点、覆盖和派生边；元数据包括生成、身份和外观记录及完整引用。domain中assetBytes=0表示未测量，必须在实际ProjectData物化后重新检查真实声明、字节/hash/解码/许可；decodePixels表示不可变资源闭包的准入像素，不冒充实际解码次数。算法内部求交可按每次输入边笛卡尔积作保守计量界，显式布尔编辑另记录实际边对比较，均不是第三方库指令数。

成功逻辑步骤保留独立usage向量；几何/元数据/资源按当前完整候选或保留峰值准入，执行工作跨操作累加。AI累计语义上限为所选档位，最终采用上限为两倍；网格/场/求交/依赖/尝试累计工作门为单候选门的64倍，保留量门不乘64。真实执行另在执行检查点累计失败、只读预演和重放中已发生的工作，不向成功编辑账本伪造步骤；主动时间由执行钟计量。16次模型请求、64次工具、300000ms主动执行保持，扩展容量不增加付费调用额度。

新底图传输24MiB请求/32MiB结果，来源32MiB、AI请求48MiB；单任务持久记录/快照16MiB、全库256MiB及完整工程/资源原保护继续共同约束，较大请求门不承诺每份请求都能持久化。整个工程JSON不再误用旧4MiB“metadata”门，辅助元数据由上述独立维度检查。新预算不向严格工程文档增加字段，保存、冷读、包与历史仍使用当前完整版本；档位和账本只属于会话/AI任务。新4工程重开后继续手工局部编辑时，以当前范围为新任务选档并冻结于候选，采用按同档重放；不靠seed重生成。其他手工操作保留既有边界。

#### 策略固定与兼容

策略至少固定`policyId/policyVersion/policyHash`、计数算法版本、适用操作类别、各维限额及验证负载依据；`policyHash`覆盖规范化策略内容和全部数值。策略由应用/服务支持的配置冻结，模型、任务正文或远端成本回执不能提高额度；缺数值或未完成相应验证的策略不得启用。数组/步骤/消息大小等独立协议保护也须明确，不能遗留隐藏的256长度约束而宣称新额度可用。

旧版本继续使用各自原有实体、几何和元数据公式；不是把所有旧任务统一套进一个新的“legacy计数”。成本策略标识与工程格式分开：只改变计价和任务状态时，升级对应运行/传输/重放合同；出现新的装饰持久模型或身份结构时，才按04/06升级严格工程及完整副本迁移。任务分账、确定性账本与运行时消耗的绑定归[05](05-ai-and-generation.md#budget-continuation-contract)。

<a id="2026-10-26-t0t1严格完整v3地形合同"></a>
## 完整v3地形与区域合同

本节定义完整v3地形与区域分区；v1/v2保持各自严格语义。完整v3生成路径使用`sceneweave-complete-project@3` / `SceneDocument3` / `visual2` / `HistoryIdentity2` / `AppearanceGraph2`，不能降成v2另存。旧完整v1/v2解析器仍拒绝这些新字段；新旧格式分别分派，资源认证不跨版本复用。

SceneDocument3必填`mapMode`、`generation.version=1|2|3|4`、`regional`与`visual.version=2`。scene模式的regional为null；regional模式保存区域面/线/地标/图符及独立制图配置，人物物理集合为空。区域非空绘制、编辑及独立下钻已有有限实现；来源保全、物化和明确拒绝边界见下文区域合同。visual2完整保留`base:visual1`，另有严格`materializedEdges`；物化边只支持已实现的有限颜色多边形/笔触，未支持的材质表现明确拒绝输出。同一曲线同一用途不能重复启用旧边带与物化边。

GenerationSystem1严格保存固定recipes、intents/skeleton、rules、ownership、exclusions、constraints、checks、sourceLinks。规则输入/受管输出逐字段组计算hash，加载只检查、不重新生成或修补。手工改变实际几何、物理支撑、业务、材质或外观时，将相应字段从managed移到manual；删除保留deleted记录，规则暂停、检查失效。规则锁及所属层锁也保护这些隐式记录。笔刷、外围重生成和复杂拓扑分别由generation2、3、4记录，不向generation1隐式加字段。

岸线整改采用显式算法/配方版本，不改变上述文件字段：`terrain-scene@2`只用于新岩岛/海岸候选，缺省或显式1的旧请求继续执行原算法；recipe、rule引用及活动检查一致记录2。组合场求值仍固定`terrain-compose@1`，新群岛/浅湾使用配方2保存完整特征、精度及阈值来源；配方1输入与物化含义保持。新浅湾基底为800mm，不重复叠加同材质同物理的800mm低地；200mm浅滩为实际陆地轮廓围绕唯一陆块骨架中心的1.08倍整数毫米包络，拒绝孔洞、退化、自交、不完整包含或越界，1800mm台地仍为独立真实表面。完整结果持久化，不能由显示缩放代替。冷读不重生成，实际点/段、来源副本、身份与外观继续计入256。实现/自检状态见路线图及地形台账。

新岸岩外观使用显式`terrain-scene@5`/`terrain-scene-t3@5`与组合配方5：以4的确切物理构图为基线，仅保存新的固定材质、SurfaceStyle覆盖、既有边带参数与环境配置。严格核对边界/高程/覆盖优先级、楼梯/道路支撑与宽度、阻挡及物件位置未改，旧1–4算法与素材输出保持。新5普通规则列完整overlay材质闭包及真实视觉所有权；组合继续由native composition唯一写者持有完整outputRefs/dependency writes并重算hash。仅新5结果诊断cost增加environmentChanges以平衡原有环境计量，不重释旧4成本。

新源采用独立shore-v1材质/asset/catalog ID和版本1，`MIT-Sceneweave-Shore-Surfaces-1`引用对应完整许可；旧Q1/Q2的原文/hash/绑定不替换。浅水/湿岩/湿沙与草岩交界采用已有世界毫米覆盖和羽化；新5配方自身每表面最多128新增overlay、每条最多512点，超过profile或原生边界明确拒绝。新5自动选档因完整岸带几何至少使用standard，受约束设备检测不足时在任务开始前明确说明；显式small仍是原注册限额，复杂新5候选可超限拒绝，不中途扩档。新5手工局部任务同样初选至少standard。新5材质与深浅水角色来自确切定义/生成角色，主题名不决定语义；外观不授予水面通行。没有增加持久字段或替换旧renderer/transition算法，因此当前完整v3/v4容器与迁移合同保持。

经典外观任务使用`terrain-scene@4`/`terrain-scene-t3@4`及组合配方4，绑定注册profile与画面细节，覆盖既有七种普通地貌和四种组合。普通新4提高场采样和轮廓精度，按局部边长限制曲线切线，楼梯沿真实相邻采样累计固定物理宽度；组合新4细化采样，浅滩从真实低场阈值与陆地并集构造，不依赖旧同心缩放假设。完整geometry/support校验保持，已有严格visual每边界32段等限制继续生效。旧版本输出与hash保持原义。

本分支岩岛构图扩展使用显式`terrain-scene@3`，仅用于新岩岛；海岸仍选2，其他地貌仍选原算法。算法3采用带侧向回入凹湾、双肩与错位狭颈的非径向主陆块，另保存两份独立真实礁石TerrainArea；高台、活动区和1500mm净宽楼梯完整检查。礁石、轮廓、管理记录和实际资源仍计入256，不将程序线条变成无预算的隐藏实体。主岸/高台采用版本3自身固定的采样参数，物理边界与显示共用采样；简化与失败回退不改旧1/2输出。

新群岛采用显式配方3，继续使用`terrain-compose@1`已有椭圆/通道特征和冻结阈值算法；用不对称陆块及弯曲水道组织主岛和次级陆块，水道硬要求绑定该配方的真实中心线，净宽仍为1800mm×scale，陆地分量仍为明确2/3、最小面积仍为世界面积1.7%。精度、特征、水道坐标、阈值完整来源和recipeRef=3一起保存；其他组合不接受配方3。旧配方1/2来源、阈值和结果不重释。新增算法/配方选择贯穿Worker/服务、本机重放和候选hash，未知版本拒绝；缺省旧请求保持缺省，不在重放时补3。此扩展不增加现有完整工程的持久字段，不改变v1–v4合法版本组合；保存实际完整结果，冷读不重生成。


identity2保留原prop/prefab/outdoor含义，并为生成记录、骨架、来源特征、区域实体/控制点、覆盖层、物化边/笔触记录出生与拓扑令牌。逐命令捕获拓扑，同批改回及撤销不回退连续性；跨池墓碑、错误kind合并与层ID占用拒绝。新增身份与墓碑共同受65536保护。appearance2为每个固定Prop源保存显式presentation；旧俯视源显式保持topDown/rotateWithGround；新固定近侧视源使用nearSide/fixedUpright、独立根锚及地面影，沿appearance2严格解析。

`terrainCommandCost`保留旧混合展开公式：累计物理实体、真实地形点/段、曲线段、覆盖、生成记录/引用、来源几何、区域几何和物化边；场景命令逐步累计，v3重复/no-op至少1，终态改回不能抵消先前成本。旧创作及无显式预算的领域入口继续上限256、安装前检查；当前普通手工改按[F节](#manual-transaction-budget)，程序底图接续v2按策略1，新底图@3/创作v3按策略2独立维度。规范生成分区合计4MiB；规则256、关系记录8192、物化边128/累计8192点与笔触控制量、区域实体2048/图符4096。完整20MiB文档及资源/许可/像素预算保持。这些是拒绝上限，不是已测容量。

独立副本升级、原件归档和完整包见[06的T0/T1小节](06-storage-and-export.md#2026-10-26-t0t1完整v3与升级原件归档)，算法、实际样本和验证结果统一归[55第17节](archive/terrain-validation.md#17-t0t1实施与实际验证)。

### 地形分区与规则记录

| 分区 | 持久内容 | 约束 |
|---|---|---|
| `mapMode` | `scene`或`regional` | 创建后固定；模式改变生成独立新工程 |
| `generation` | 规范输入、固定配方、规则图、人工字段/排除、来源、约束与状态 | 严格version1–4；笔刷、外围重生成和拓扑各有明确记录版本 |
| `regional` | 区域地貌面、线网、地标、图符及制图样式 | regional模式必填；scene模式为null |
| `visual` | visual2；旧语义基底与新物化表现 | 不把v3投给旧v2/visual1解析器 |
| 原物理集合 | 现有房墙门、地形、路径、Prop、组合等 | scene模式照常；regional模式为空，复用公共资源/图层/注记需新分派 |

所有坐标、半径与实体尺寸仍使用安全整数毫米；区域图公里显示只是格式化。生成器采用局部整数原点计算，并对平方/叉积做安全界检查；50km范围不能假设JS浮点的全部整数乘积都精确。

#### GenerationSystem1

以下为持久记录的核心字段与语义；字段省略/未知值不得依赖运行时猜测，精确接受集合以严格schema为准。

| 记录 | 必需内容 |
|---|---|
| `GenerationRecipe` | id、固定recipeVersion、algorithmId/version、mapMode、seed、单位化参数、固定素材引用、几何精度配置 |
| `GenerationIntent` | id/floorId/visibility、世界范围、地貌骨架、规范笔刷约束、活动区、路线要求、保留区；不存完整私人提示词 |
| `GenerationRule` | id/floorId/layerId/visibility/editLocked、kind、recipeRef、带字段组的输入引用、输出引用、参数、状态、inputHash、managedOutputHash |
| `OutputOwnership` | 稳定outputKey、实体/嵌套记录引用、受管字段组、人工字段组、managed/manual/deleted/detached状态；实际字段值只存目标实体 |
| `GenerationExclusion` | 稳定key、世界多边形、原因、相关候选key及出生令牌；继承删除/退出，不凭坐标相近复活 |
| `TerrainConstraint` | id、硬/软、公开性、范围、类型、冻结参数；类型限活动区/指定路线/端口/保留几何/保留实体 |
| `ConstraintCheck` | 约束id、通过/失败/未检查、检查算法版本、所检输入hash和公开问题；源变化后过期，不能继续显示已通过 |
| `SourceRegionLink` | GM本机的源身份/完整hash、选区、平移、获准继承快照及publicInputHash、字段精度或估计状态；只读来源事实，公开投影不含完整源身份 |

持久规则状态为`active/paused/detached`，无隐式后台执行；active仅表示下次明确编辑可提出联动。`unsupported`与待处理冲突属于当前运行时能力/候选状态，不因为更换软件版本就在加载时改写文档。读取完整工程时检查依赖引用与管理hash，已采用的实体一致性继续全验。对人工字段从managedOutputHash的受管集合中剔除，但仍进入完整工程contentHash。

#### RegionalModel1

- 区域实体共用必填`id/floorId/layerId/visibility/editLocked`，仅同Floor引用；实体锁与所属用户层锁共同约束。所有区域实体进入完整实体/层归属登记、删除依赖及玩家投影分派，不能假定旧Prop分派自动覆盖。
- `RegionalArea`：稳定ID、公开性、层/锁、简单多边形、land/water/forest/hill类型、固定样式、可选相对高程/分类，不包含人物占地。
- `RegionalLine`：稳定控制点、river/ridge/road类型、固定宽度表示、实际宽度提示、端口、连通/流向引用、公开性/层/锁。
- `RegionalLandmark`：共用字段、世界锚点、用途、名称/说明、固定图符定义和可选所属地貌引用。
- `RegionalSymbol`：共用字段、固定源版本、世界锚点、固定图像显示范围、朝向模式、层序、管理key，以及明确的来源区域/线/地标引用；独立手工图符以null表示无来源，不借Prop的碰撞字段表达图符。
- `RegionalSymbolDefinition`：独立固定目录身份、源图/实际资源、根锚/显示规则、作者和许可；加入新完整包与个人库的主体类型白名单，不能借现有Prop定义名义省略图符合同。
- `CartographicProfile`：线宽/符号尺度/颜色/简化误差与固定样式版本。缩放不改该配置，显式调整属于普通事务。

区域面和线的关系按实际几何核对，地图符号可省略重复绘制但不能替代区域实体。通行按钮在regional模式显示地貌/路线连接说明，不产生场景级`pathChecks`结果。

区域实体的有效public/gm由自身与所有来源/地貌依赖取最严格可见性，图层锁约束写入；编辑时的层隐藏/独显仍为暂态，不改变玩家输出。图符依附的森林面或地标为GM时，图符不能因自身public而公开；秘密河段/地标不能影响公开河图、布局或符号避让。玩家投影先过滤区域实体与关系，随后才做排序、遮挡、公开间距处理与绘制，最后应用既有玩家遮罩。生成来源、父图身份及规则诊断仅留GM完整工程。

#### VisualSystem2与AppearanceGraph2

visual2使用明确分区：`base`保存完整visual1基底并维持旧曲线/环境/边带语义；`materializedEdges`保存新生成的显式边缘多边形/笔触。近侧视画法由AppearanceGraph2的固定源解析后进入临时渲染投影，不再保存一份独立可改的实例根锚表。未知算法不可作为渲染脚本载入。

新场景曲线继续使用base中的共享曲线及现有采样保护限额。新变宽边缘由`materializedEdges`引用真实曲线和其输入hash，存有限的实际几何/材质引用；不能同时启用同一用途的旧边带与新边缘而产生重复描边。区域几何由regional自己的精度配置处理，不全局放宽visual1的20m采样间隔、1m容差或5m边带限制。

近侧视素材源的根锚、固定画法、地面影形状及允许朝向属于固定定义/外观源的一部分。AppearanceGraph2把这些信息纳入源快照、派生和恢复闭包；定义默认值与所采用来源逐字段核对，实例图像范围须与实际解析结果相符。替换图像时不能漏掉锚点，复制/组合/散布/入个人库时不能退化成普通旋转位图。已有appearance1来源升级时显式标为旧俯视模式，其原来源记录作为迁移原件保全，真实源图字节/hash不变；新结构对象hash按新版本重新计算，不伪称加字段后对象hash仍相同。

materializedEdges的最大几何量与包预算单独校验。材质/图像仍逐字节hash、解码与必要真实像素校验；新规则不是省略资源验证的凭证。

#### HistoryIdentity2

保留原有prop/prefab/outdoor身份的确切含义，增加生成规则、区域实体与需要连续恢复的嵌套覆盖/表现记录身份。每个可恢复记录具有出生令牌、拓扑令牌与拓扑hash；删除再建产生新身份。相同坐标、ID、seed或规则名都不足以证明连续性。

旧v2升级时生成新工程/lineage，迁移内以明确映射保留实体关系与来源，不伪造旧历史连续性。新规则的参数恢复必须同时生成相关实体的新候选；不能只回滚参数，让当前结果与参数不一致。形状分裂/合并后拒绝不具连续性的局部恢复，仍允许从完整历史创建独立工程。

### T2局部编辑记录（2026-10-26）

完整工程和场景仍为v3。新生成的T1结果保留严格generation1；首次T2候选显式升级为generation2，新增严格strokes集合，不向generation1追加字段。每条记录有operationId、连续strokeIndex、Floor/受众、笔刷类别、目标地形、规范世界坐标轨迹、毫米半径、冻结scope、联动模式、固定材质/高程及算法版本。旧子格式携带未知strokes字段仍拒绝。候选确认时说明升级，采用前完整保护点保留旧generation1；一次撤销恢复整个旧状态，revision继续增加。

笔画身份进入identity2的generationStroke；实际增删改、轨迹点与子格式转换计入256累计预算，逐笔计费包含重复/no-op，不以最终净差抵消。玩家投影不包含规则/笔画元数据。冷读只验证完整实体与记录，不执行重生成；同一operationId不能重复采用。当前规范轨迹按10mm量化并去重/去共线，保持幂等；几何计算使用固定世界单位，不存屏幕像素或原始pointer事件。

T2写入当前实际曲线控制点及其绑定物理采样，保持既有拓扑、Floor、图层、秘密、锁与采样参数；添陆/挖水沿已有陆地岸线有限推拉，材质/高程沿用明确目标。铺草新增固定材质覆盖，清空添加持久保留区并删除允许管理的自动物件。关联自动布景仅在同支撑面寻找附近合法位置，不新增或复活物件；人工位置、外观、删除和退出状态保持。支撑、锁、范围、物化边缘或预算冲突整笔拒绝。当前支持见[地形参考](reference/terrain-generation.md#terrain-capabilities)，当批检查归[地形T2历史](archive/terrain-validation.md#18-t2笔刷与局部联动实施)。

### T3路线持久语义（2026-10-26）

T3沿用完整/SceneDocument3、visual2、identity2、appearance2及严格generation1；笔刷仍显式升级generation2。五新配方身份为`terrain-scene-t3@1`，完整Path持久折点/宽度/支撑、硬route约束持久完整路线与最小净宽。渡水方式以明确检查算法`terrain-route@1`（允许配方真实浅滩）或`terrain-route-ground@1`（禁止配方固定浅滩）冻结，不向旧严格约束追加字段。已知passed/failed回执必须与当前完整几何重验一致；hash只证明输入一致。传输结果的pathPoints是实际成本分项，不进入工程文档。有限路线边界与当批检查见[地形T3历史](archive/terrain-validation.md#19-t3常见地貌与有限路线实施)。

### T-S06与复杂拓扑严格记录（2026-10-27）

外围重生成保存为`generation.version:3`，包括冻结范围、受保护实体/图层归属hash、输入参数、完整输出和状态；generation1的配方及generation2的strokes不重释。关闭布景重排、或对象已人工移动/改外观/删除/退出管理/处于组合散布关系时，当前实体保持；获准重排仅覆盖存活独立受管Prop。建筑、门窗、道路、连接、活动区和路线必须按真实几何/净空参与候选。

复杂布尔拓扑保存为`generation.version:4`，包括完整输入轮廓、运算/裁切请求、全部输出组件与孔洞、显式孔洞表面属性、每个受影响支撑槽的明确重绑，以及算法和输入/输出hash。新输出使用新身份；既有生成/编辑记录保留但相关拓扑连续性失效。属性不一致、范围外输入/输出、未处理的覆盖/地形边绑定、锁冲突、无效重绑、几何失败或超过256展开成本均拒绝整笔操作。

### T4/T5完整3表现与区域合同（2026-10-27）

T4新固定源在appearance2中保留`nearSide/fixedUpright/fixedRotationDeg:0/world`、独立根锚与地面影；它不改变SceneDocument3或旧素材语义。T5沿用`regional.version:1`。下钻先以来源快照完整保留父图几何、身份、方向和资源证据，再将满足边界、孔洞、宽度、支撑、许可和预算条件的区域面、河流/山脊带、可安全裁切道路及合格地标/图符物化为独立场景实体；无法表达的内容只保留来源并列入候选报告。图符映射为非阻挡Prop，不产生区域图上的人物碰撞语义。资源闭包继续严格拒绝未引用资产；技术结果单独见[地形历史台账](archive/terrain-validation.md)。当前支持和拒绝边界见[地形参考](reference/terrain-generation.md#terrain-capabilities)，统一验收见[09](09-quality-plan.md#acceptance)。

<a id="terrain-t8-contract"></a>
<a id="t8后续地形严格版本与容量合同2026-10-28待实施"></a>
## 完整v4地貌组合与过渡合同

完整v4读写、副本迁移、离散常色过渡、条件布景及有限局部联动已有实现，仍按本节固定结构解析。本节只定义完整v4、generation5、visual3、identity3和appearance2的固定组合；完整v5由[下一节](#curved-connections-v5)独立定义，未支持的新增语义继续拒绝。开发任务见[07](07-roadmap.md)，实际结果见[地形历史台账](archive/terrain-validation.md#t10-t13-20261029)。

以下是完整v4的严格结构；字段均必填，只有显式`null`才允许空值，没有任意扩展对象。`ID`为1–256字符且不是`__proto__`；整数为有限安全整数，`Hash`为64位小写SHA256，`P={x,y}`使用整数毫米，`Rect={x,y,width,height}`的宽高为正。所有新坐标/范围位于本场景exportBoundsMm内，引用同Floor，字典键等于记录id，ID/引用列表不得重复；新记录ID与现有实体、定义、图层和墓碑全局不冲突。`Common={id,floorId,layerId,visibility,editLocked}`沿用现有合法层、受众和锁。旧完整v1–v3组合仍按原读者接受；**首批完整v4只有一组合法组合**：

| 严格对象 | 精确结构与组合 |
|---|---|
| `ProjectData4` | 完整保留现有`format/schemaVersion/document/historyIdentity/appearance/assets/licenses/licenseBindings/authoringSources`，其中`format=sceneweave-complete-project`、`schemaVersion=4`；必须是scene4 + generation5 + visual3 + identity3 + appearance2。不得接受appearance1/3、visual2或identity2作为可选组合；appearance3尚未定义，不在v4读者中占位接受 |
| `SceneDocument4` | 现有SceneDocument3全部非generation/visual字段逐字段承接，仅`schemaVersion=4`、generation为下述5、visual为下述3。scene模式`regional=null`；regional模式仍严格regional1，新增features/compositions/requirements/checks/thresholds/dependencies及transitions必须为空，原regional结果不改为人物物理语义 |
| `Generation5` | 精确为`{version:5,legacy,features,compositions,requirements,checks,thresholds,dependencies}`；`legacy`必须是原严格generation1/2/3/4之一的完整对象，原recipes/rules/ownership/exclusions/constraints/checks/sourceLinks及strokes/surroundings/topology均不改形、不重新生成。新建时legacy为合法空generation1；新规则不回填旧子格式 |
| `Identity3` | identity2全部必填字段原样承接：`propTokens`、`prefabTokens`、`outdoorTokens`、`generationTokens`、`regionalTokens`、`presentationTokens`；仅`version=3`并新增`terrainTokens:ID→{kind,token,topologyToken,topologyHash}`，kind只允许`terrainFeature/terrainComposition/terrainRequirement/terrainCheck/terrainThreshold/terrainDependency/terrainTransition/terrainTransitionPolygon/terrainTransitionStroke`。七个池的出生/墓碑合计仍≤65536，token与topologyToken不得跨记录复用 |
| `Visual3` | 精确为`{version:3,base,transitions}`；`base`是完整严格visual2（包括其visual1基底与materializedEdges），保留原有边界/效果/环境，不重新解释其hash或实体身份。新增过渡只按下表保存；不在visual2中增加字段 |

`features`≤128、`compositions`≤32；新requirements与legacy.constraints合计≤256，新checks与legacy.checks合计≤256；thresholds≤64、dependencies≤256。以下新增字典项、成员/引用和legacy关系记录共同受既有8192关系记录、4MiB规范生成分区及256单笔实际展开约束，分项上限不保证能同时达到。`Ref`精确为`{kind,entityId,parentId,fieldGroup}`：既有kind完整枚举为`terrainArea/terrainPoint/terrainSegment/terrainEdge/terrainConnection/path/prop/scatterGroup/scatterMember/surfaceOverlay/visualBoundary/visualEdgeLook/materializedEdge/regionalArea/regionalLine/regionalLandmark/regionalSymbol`，generation5另允许顶层`vertex/room/wall/opening/note/prefabInstance`；fieldGroup精确为既有八值`geometry/properties/surface/appearance/membership/exclusions/presentation/source`。parentId仅`terrainPoint/terrainSegment/scatterMember/surfaceOverlay`需要真实所属ID，其他既有及新增kind必须为null；不存在的目标与错误父子关系拒绝。新增kind首批只用于reads.preserve且fieldGroup只能为geometry，snapshot取完整原生严格实体（包括原有支撑、锁、秘密、锚点/成员字段），相关顶点、墙、成员和递归锚点实体分别列入reads；不借此开放建筑写入或恢复。既有kind的快照字段投影沿用现有`resolveGenerationTarget`八组定义；新增引用不改变legacy读者。

| generation5记录 | 精确必填字段、有限范围与含义 |
|---|---|
| feature | `{...Common,kind,shape,elevationMm,roughnessPpm,seedKey}`；kind限`landmass/lakeBasin/riverValley/ridge/forest/clearing/plateau`，roughnessPpm为0–1000000，seedKey为1–128字符。landmass/lakeBasin/forest/clearing/plateau的shape精确为`{kind:ellipse,centerMm,radiusXMm,radiusYMm,rotationMilliDeg}`，半径为正、旋转0–359999；riverValley/ridge精确为`{kind:corridor,pointsMm,widthMm}`，2–32点且宽度为正。它们是构图输入；实际地形面、道路和高差连接仍完整物化保存，特征颜色/形状不授予支撑或通行 |
| composition | `{...Common,recipeRef,seed,boundsMm,algorithmId,algorithmVersion,precision,baseElevationMm,members,thresholdIds,requirementIds,outputRefs,state,inputHash,outputHash}`；recipeRef为legacy内固定配方的`{id,version}`，seed为1–128字符，algorithm固定`terrain-compose@1`，precision严格沿用`{sampleSpacingMm,toleranceMm,noiseCellMm}`且均为正。members为1–128条`{featureId,field,operation,weightPpm}`，field限`land/elevation/vegetation`、operation限`add/subtract/max`、weightPpm为1–1000000；同featureId+field最多一次，数组顺序是显式运算顺序，不作为随机key。thresholdIds≤2、requirementIds≤256、outputRefs≤256；state限`active/paused/detached`，active必须有物化输出且全部hard要求通过 |
| requirement | 公共`{id,compositionId,kind,strength:hard}`，其余字段仅按kind分支：`componentCount`加`{surface:land或water,excludeBoundaryTouching:boolean,expected:0–16}`；`minimumComponentArea`加`{surface,excludeBoundaryTouching,minAreaMm2}`；`channelWidth`加`{pointsMm,minWidthMm}`，2–32点；`legacyConstraint`只加`{constraintId}`，指向legacy内strength=hard的约束。面积/宽度均为正且不超过候选范围面积/对角线；分量按真实有效表面连通计算，channelWidth检查整条水域走廊及拐角净宽，不能仅抽点或看颜色。边界接触在规范整数几何上判定 |
| check | `{id,requirementId,algorithmId:terrain-requirement,algorithmVersion:1,state,inputHash,issues}`，state限`passed/failed/unchecked`；issues≤128条严格`{code,message,entityId}`，code为ID、message为1–512字符、entityId为ID或null。冷读重验已知算法与当前真实几何；哈希相等不替代面积/分量/净宽检查，failed/unchecked不能安装active候选 |
| threshold | `{id,compositionId,field,valueQ,targetCoveragePpm,grid,sourceInput,inputHash}`；field限`land/elevation`、valueQ为-1000000–1000000、targetCoveragePpm为0–1000000；grid精确`{originMm,columns,rows,spacingMm}`，列/行各2–512、乘积≤65536、间距为正且采样范围覆盖boundsMm。sourceInput精确`{algorithmId:terrain-compose,algorithmVersion:1,seed,precision,boundsMm,baseElevationMm,members,features}`，冻结求阈值时同composition字段及其完整feature字典，仍≤128成员/特征。它保存真实来源而非临时场数组，完整结果由outputRefs指向。首次候选可全局求阈值，局部重生成必须保持现有valueQ/grid/targetCoveragePpm/sourceInput，若需变化则创建新的全范围候选，不能让范围外漂移 |
| dependency | `{id,compositionId,featureIds,thresholdIds,reads,writes,transitionIds,scopeMm,haloMm,algorithmId:terrain-dependencies,algorithmVersion:1,inputHash}`；featureIds≤128、thresholdIds≤2、reads/writes各≤256、transitionIds≤128；reads每条精确`{target:Ref,role,contentHash,snapshot}`，role限`preserve/baseline`，snapshot必须是该kind+fieldGroup对应原生严格字段组的完整值，不接受任意JSON；contentHash覆盖该值。writes为Ref列表；同一target最多一条read。scopeMm为写范围，haloMm为0至候选范围对角线向上取整的整数；读取范围为scope外扩halo后裁到候选bounds。halo必须覆盖算法采样/噪声/过渡宽度、笔触半宽和被读取的物件完整占地/支撑，跨界依赖必须显式列入reads；不足或闭包超预算即拒绝，不能只按落点归属。preserve不得是写目标且active状态下须与当前内容一致；baseline必须是写目标，用作完整采用前的输入证明，冷读校验快照/hash而不拿采用后值冒充旧输入。新过渡的读写由transitionIds及其完整当前记录一并冻结 |

特征kind与field固定映射：landmass/lakeBasin写land，ridge/plateau写elevation，forest/clearing写vegetation，riverValley可分别写land和elevation；其他组合拒绝。feature必须至少属于一个composition且同一composition内读写同Floor；每个实际输出字段组只能有一个活动写者，包括legacy.rules和新composition，不允许两套所有权。依赖图不得循环。writes列实际场景字段组，相关metadata闭包确定性展开为：这些目标全部出生/拓扑记录、以目标为target/input/output的legacy所有权/规则/排除、所属新composition及其feature/threshold/requirement/check/dependency、直接transition及其结果身份、被目标固定源/材质引用的完整资源/许可；闭包任一项变化计入差异和成本，不能将metadata伪装成Ref目标。范围外结果保持原字段值；无法在此有限闭包内表达的跨目标依赖拒绝。

| visual3新增记录 | 精确必填结构与有限结果 |
|---|---|
| transition | `{...Common,enabled,boundaryId,kind,side,leftSurface,rightSurface,leftElevationMm,rightElevationMm,widthMm,distanceSource,polygons,strokes,inputHash,outputHash}`；kind限`shore/riverMouth/grassRock/forestEdge/cliff/pathShoulder`，side限`left/right/both`，两侧surface限`water/sand/soil/grass/rock/path/forest`，widthMm为正且≤来源范围对角线。boundaryId必须指向visual3.base.base内真实边界，左右以其持久方向为准；表面/高程与绑定地形实际求值一致，不能只填标签 |
| distanceSource | 精确`{algorithmId:terrain-distance,algorithmVersion:1,metric:euclidean-mm,boundaryHash:Hash,clipMm:Rect,reachMm,sampleSpacingMm,inputHash:Hash}`；reachMm≥widthMm且为正，sampleSpacingMm为正。来源是该边界完整曲线/采样配置、绑定两侧及clip内实际遮挡/开口/支撑；boundaryHash覆盖这些几何身份。距离场仅是有界临时计算，不能以缓存或场参数代替持久polygons/strokes，冷读不自动重算或修补图像 |
| polygons/strokes | polygons≤128条严格`{id,pointsMm,fillColor,opacity,materialRef:null}`，每条3–512点、简单无孔环；strokes≤256条严格`{id,pointsMm,widthMm,color,opacity}`，每条2–512点、宽度为正，端帽/连接固定现有方端帽/miterLimit2/bevel。颜色为`#RRGGBB`、opacity为0–1；两集合不可同时空。新transitions与既有materializedEdges合计≤128，全部结果几何累计仍≤8192点，结果必须位于clipMm及依赖halo内，点与新增身份逐项计入实际成本 |

首批只支持离散常色多边形/笔触；连续渐变、渐变停点、任意混合模式、带孔环和非null材质字段均明确拒绝。需要孔洞时只能由生成器显式产出覆盖等价且不重叠的无孔简单片，无法在误差/点数/256预算内表达则候选失败；不得丢孔填实。多条常色带须完整保存并报告为离散色带，不称连续渐变。后续纹理过渡或appearance3须另行定义完整版本，不凭预留号接受。相同boundaryId+kind+side不得与启用的旧edgeLook/materializedEdge重复绘制；新增效果仅改变外观，不改变支撑/通行。任一来源含GM内容时该过渡不得标public，玩家派生仍先过滤完整来源再计算可公开效果。

所有hash使用本文件既定规范JSON/SHA256，输入快照与完整结果分别核验：threshold.inputHash仅覆盖`{field,targetCoveragePpm,grid,sourceInput}`，不含valueQ；按固定sourceInput复算valueQ一致性，加载只检查而不替换。dependency.inputHash覆盖本记录除inputHash外字段、所引feature/threshold完整值、reads内严格snapshot及所需固定资源描述/实际hash；只保存transitionIds，不把transition或composition的hash反嵌进输入。composition.inputHash覆盖算法/版本、seed、recipe完整固定值、bounds/precision/baseElevation、members及完整features、所引threshold/requirement、dependency完整记录、固定资源描述/实际hash，不含输出或checks。其outputHash覆盖outputRefs的完整当前字段值、直接transition的polygons/strokes、ownership/人工/删除状态和对应身份token；人工修改导致输出不一致时必须转paused/detached并保留原冻结输入。transition.inputHash覆盖本记录除polygons/strokes/inputHash/outputHash外字段及完整边界/绑定/有效两侧表面和scope内实际依赖；distanceSource.inputHash覆盖其除inputHash外字段及同一完整距离来源，不引用composition/dependency的hash。transition.outputHash仅覆盖polygons/strokes。check.inputHash覆盖requirement完整定义、参与的当前真实地形/支撑/障碍/连接/路线和算法版本，不含回执自身。transitionIds仅指向本composition过渡；所有引用hash按上述投影重算，不信任声明值或递归混入回执。文档完整hash仍覆盖整个ProjectData。

迁移时新sceneId/lineage遵守06，旧identity2的各池、token、topologyToken、topologyHash及墓碑逐条复制到identity3，不因generation/visual增加包装而重分配旧身份；旧描述符按解包后的同一实体计算。新terrainTokens仅为实际新记录/结果分配。新topologyHash统一覆盖`{kind,floorId,parentIds,orderedChildIds,geometryStructure}`：parentIds为所属composition、关联requirement或边界的明确ID列表；orderedChildIds为成员featureId+field、输出Ref、结果polygon/stroke ID等实际有序连接；geometryStructure包含shape分支、点数以及完整点坐标，非几何参数/颜色/锁不在其中。首批对新无稳定点ID的feature/结果采取保守连续性：任何几何坐标改变都换topologyToken；这不影响已有室外实体的原生连续性，也不授予新特征/过渡局部历史恢复。撤销不回退拓扑token；删除重建用fresh ID与新出生，不能复用旧ID/token。旧完整v1/v2须先按已有完整副本链获得合法完整v3，再升级；旧工程/快照仍保留自身版本，不能据新lineage伪造跨版本可恢复资格。完整v4仅由对应严格读者接收；旧版本读者拒绝这些字段，未知后续版本仍拒绝。不得降级试读或利用summary/tags/Note/任意扩展JSON隐藏新语义。

三类中性样片固定为群岛海岸、森林河谷和草岩丘陵。每个尺寸/种子向量必须同时给出世界尺寸、采样间距/节点数、轮廓误差、实体/点/段/曲线/路径数量、边缘与覆盖、生成规则/关系、身份和实际成本分项；另记录规范JSON/资源字节、图片数/像素、生成/预览/完整校验/冷读耗时、内存观测方法及失败原因。Node与浏览器使用同一冻结输入比较规范结果hash；尚无浏览器或峰值内存结果时标记未测，不能以Node结果外推。实际样片和可公开尺寸以55中的新鲜容量证据为准，保护值不构成容量承诺。

单笔仍按`terrainCommandCost`计入全部实际展开：新增/修改/删除实体、控制点/边段、路径、覆盖、物化边、生成记录及引用、来源几何、身份/人工/删除记录和格式转换均不得遗漏。v4成本在安装前按以下规则计算：每个新改字典项/身份至少1、每个成员/Ref/阈值源特征/读快照至少1，其内点/段/闭环按既有几何分项再展开；ellipse按一个中心点和四个基轴端点计成本，halo/grid/sourceInput及版本转换各至少1，快照中重复保存的几何继续计费，不按引用去重免单。累计上限256，重复/no-op至少1，改回终态不退还成本，也不拆批绕过。单笔放不下的特征、快照或离散色带整笔拒绝，不能因为分项上限较大便默认可采用。生成分区规范JSON仍限4MiB，规则/关系/边缘及65536身份与墓碑等现有上限保持；包、资源、许可和迁移保全归[06的T8合同](06-storage-and-export.md#terrain-t8-storage)。

<a id="curved-connections-v5"></a>
## 完整v5曲线连接与适用组件合同

完整v5沿用`sceneweave-complete-project/schemaVersion=5`与`sceneweave-scene/schemaVersion=5`，完整承接v4的generation5、visual3、identity3、appearance2及所有固定源、物理实体、层、受众、历史与资源字段。本次新增持久语义仅为`TerrainConnection.route`可选字段，不新增组件实体或任意扩展JSON。Scene1–4的严格连接对象不接收route，Scene5也不接收持久`route:null`；**不出现route键即原两端点直线连接**，保留其平端矩形、原默认踏面和旧固定画面。4→5完整副本不为旧连接补route键，原模型、规则来源/结果快照与资源保持原值；升级与保存边界归[06](06-storage-and-export.md#curved-connections-v5)。

| `route`精确字段 | 合同与保护值 |
|---|---|
| `version/kind` | `version=1`，kind仅`polyline/cubic`；与外层connection.kind的`stairs/ramp`分别定义。直行与之字回折均可用polyline，曲线使用cubic |
| `segments` | 1–16个有序`{id,start,control1,control2,end}`；稳定段ID全局不冲突，四点均为整数毫米。相邻段端点连续；polyline要求control1精确等于start、control2精确等于end，不靠接近共线猜测类型 |
| `sampleSpacingMm/toleranceMm` | 分别为4–20000mm、1–1000mm整数；确定性采样规则与既有VisualBoundary共用，不依赖视口/导出分辨率/当前机器 |
| `centerlineMm` | 2–256个完整实际整数毫米点，须与本route源控制段及采样参数的结果逐点、同序相等；首尾精确等于外层from/to.positionMm。源与实际中心线一起保存，缺项、不同采样或按端点重建均拒绝 |
| `stairStyle/treadDepthMm` | 样式仅`stone/wood/naturalRock`，踏深为50–2000mm整数；按全线实际累计弧长派生的踏面不超过512级，不在每段重新开始相位。它们是明确表现/业务参数，不从纹理或图片猜测物理高差 |

16段、256采样点与512踏面是单对象保护值，不保证达到所有上限的对象可通过一次编辑预算。平端、miterLimit2及超限bevel的实际足宽带由完整centerlineMm与世界widthMm共同求得；命中、选择外框、通行/有限路线、崖口、布景净空、视觉影响范围和秘密遮罩使用同一几何。旧无route分支继续使用原矩形，不以道路的方端延长量改写连接。踏面按同一弧长位置的切线/法线派生，图像改变不改实际净宽、Floor或支撑。

连接仍须具有同Floor的两个不同有效支撑、真实高差及完整可支撑净宽带；整条中心线恰好跨越一次声明的地面邻接，不侵入第三有效支撑面。自交、零长段/原地反向折返、过窄回折、越界、墙/门/家具真实占地和锁冲突均不能以画面成功掩盖；足宽且不自交的U形回折可用。崖口由中心线真实穿过来源边界的位置及完整带区裁切，端点弦线不能替代真实路线。玩家投影先过滤连接、两端支撑、附着门和相关私密来源，再派生踏面、阴影及遮罩；隐藏连接不能从弯线外扩或崖口效果泄露。

手工创建/更新通过同一有限领域命令与候选事务，Scene5可显式提供route；旧无route请求保留原义。清除路线的命令可用null表示删除该键，采用后的严格文档只保留缺键，不存null。预览列实际写集和只读依赖，采用前重新检查基线、完整几何、固定来源、递归注记、实体/层锁及资源；一次采用、单调revision和一次撤销，失败不部分修改。该历史版本首发时使用256混合展开；当前完整v1工作台按[F节普通事务](#manual-transaction-budget)计独立连接及实际影响对象，控制段/点、完整采样点/边段、依赖和身份/外观元数据分别受保护。底图512/1024/2048档位不扩大普通手工对象额度，超限明确拒绝，不自动降采样、缩窄或拆批绕过。

identity3七类池及65536出生/墓碑上限保持。无route连接继续原`[floorId,from.surfaceRef,to.surfaceRef,openingId]`拓扑hash；Scene5有route时，额外纳入route类型和有序segment.id。纯控制点/端点坐标、采样参数、样式和踏深调整不重生；添加/移除route、改类型或段ID/顺序改变父连接的topologyToken，同批改回或撤销也不回退连续性。新段ID不得与已有实体、其他曲线或墓碑冲突，不以同ID复用代替出生证明。generation管理的geometry/properties投影及严格依赖快照包含实际完整route，改变受管字段须如实停止/暂停对应生成，不能重写冻结输入来追认旧回执。

局部恢复沿既有同出生/同拓扑、真实历史与当前锁/依赖规则：`outdoorGeometry`同时恢复from/to/width、路线源控制及完整采样，但保留当前route的stairStyle/treadDepthMm；`outdoorProperties`恢复完整route及明确业务字段。范围外编辑、当前层/锁/支撑与资源不变；跨路线拓扑变更不授予局部恢复资格。完整撤销重做及版本导航保存全部route，并按当前身份规则推进令牌，不只恢复端点。

岸/崖/草沿、道路边带及围栏等明确适用组件复用已有`VisualBoundary + EdgeLook`：段控制点、绑定、世界宽度/重复间距与实际派生结果持久化，弯曲/局部拉伸通过有限命令生成完整候选。仅装饰绑定不暗增碰撞；terrain/path绑定同步实际轮廓/中心线并列完整依赖。固定图片/定义不原地变义，不承诺任意Prop/Prefab位图无损扭曲或新的可安装曲线模板。Scene5中受影响的物化边/过渡在同一候选重建并检查锁、来源hash及预算；不能留下原控制源配旧派生结果。

Scene5当前走手工编辑与完整工程IO；共享AI start/scene授权明确拒绝5，现有AI1–4及旧生成器继续各自固定版本，不能从通用ProjectData可读推断旧工具已支持新路线。后续协议和能力适配按[07](07-roadmap.md#branch-plan)实施。开发定向证据归[地形台账](archive/terrain-validation.md#curved-connections-20261031)，正式输入/通过条件只从[09](09-quality-plan.md#branch-feature-acceptance)运行；本节不代表统一验收、P3或发布通过。

<a id="decoration-clusters-v6"></a>
## 完整v6轻量装饰与簇状布景合同

新完整v6/Scene6保留v5的实际曲线连接、generation5、visual3、appearance2及全部已有字段，使用严格identity4。仅Scene6必需新增`decorations`和`decorationClusters`两份字典；旧1–5拒绝这些键，不能通过旧props、Note或扩展JSON隐藏新语义。新对象按真实层映射存入`entityLayers`，层序与Floor、高程分别处理。两个集合不是新的物理支撑或碰撞集合，区域地图模式不允许放入轻量装饰或簇。

| 对象 | 精确持久字段与边界 |
|---|---|
| Decoration | `id/floorId/editLocked/visibility/definitionRef/supportRef/positionMm/rotationDeg/scalePpm/renderOrder`。固定来源为精确`{id,version}`；坐标用整数毫米，比例为500000–1500000整数ppm。图像、世界图像范围、根锚、透明度及绘制带从既有固定定义/FixedPresentation派生；轻量角色不生成主题投影、接触影或点光遮挡，不重复保存整份Prop；来源定义必须不阻移动/视线，图片与许可闭包完整。轻量实例没有占地阻挡、支撑其他对象或门墙附着职责 |
| DecorationCluster | `id/floorId/editLocked/visibility/supportRef/boundsMm/seed/algorithmVersion/palette/maxInstances/spacingMm/clusterRadiusMm/clearanceMm/members`。算法固定`cluster-v1`，palette每项精确`{key,definitionRef,kind,weight}`，kind为`prop/decoration`。实际完整物件保存在props，实际轻量实例保存在decorations，不以seed替代结果 |
| cluster.members | SHA256候选key映射到`{kind,entityId,state}`，state仅`managed/manual/deleted/detached`。存活项引用同种真实对象；deleted明确保留空引用和删除槽，不能再次布景时自动复活；manual保留人工变换/锁/受众，detached保留退出自动控制的槽及仍存活对象引用；独立对象后来删除时清空引用，退出槽继续抑制重生。一个实际对象不能被多个簇同时管理 |

palette最多12项且key及`kind+definitionRef`各自唯一；每簇最多64个候选/人工/删除槽，maxInstances为1–64。spacing、clusterRadius与clearance使用正整数毫米，明确区分簇内间距、簇的世界范围及活动区/道路/连接净空。当前保护值为64簇、4096轻量实例，另与完整工程JSON、实际资源、身份和普通事务预算共同约束；这些不是已实测满载容量。树木和较大岩石继续使用完整Prop，保留其真实占地、阻挡、支撑及固定表现，不用轻量装饰偷减碰撞职责。任何职责升级都须显式生成完整物件并走相同几何/资源/锁校验，不能只开一个隐含标记。

轻量实例可逐件选择、移动、旋转、缩放、改受众、删除及锁定，变更形成当前工程的新事务并可撤销。簇生成先固定明确支撑、实际范围、固定palette和参数，以版本化确定性簇状分布保留疏密及活动留白；候选列出所有实际Prop/Decoration及成员记录，明确采用后一次生效。再次布景保留人工移动、删除、退出、锁和范围外编辑，不能重开、缩放、渲染或导出时重新撒点。轻量装饰只声明落在所选真实支撑上；它不扩大可通行区域，也不把图像alpha推断成碰撞范围。

该历史版本首发时来源、实例、成员、身份和派生变化共用256混合展开。当前完整v1普通编辑改按[F节](#manual-transaction-budget)计实际完整/轻量成员并去除承载容器重复，独立容器业务变更仍计；来源、成员/删除记录、身份、依赖和派生几何另受保护，不得只按一个簇收费或拆批绕过。界面先明确预览/采用缺少的固定素材，再预览/采用布景；已有素材直接复用，两者是独立的资源与场景操作。应用API可将固定源物化与场景实例合成一个候选，分别检查固定记录和场景对象，任一超限整笔拒绝。采用前仍完整核对真实图片/源/许可、基线、实体及跨层锁、支撑和净空。底图512/1024/2048运行时档位不自动扩大该手工事务。

identity4完整承接identity3七类池和墓碑，新增严格`decorationTokens`，每条精确`{kind,token,topologyToken,topologyHash}`，kind为`decoration/decorationCluster`。所有池合计仍65536，ID、出生token及拓扑token全局唯一；删后重建不能复用ID，撤销不回退连续性。Decoration拓扑绑定Floor、固定definitionRef及明确supportRef，纯坐标/比例/旋转不重生；簇拓扑绑定Floor、支撑、固定算法及有序palette key/职责/定义。成员/人工状态随完整文档保存，完整历史导航及撤销重做包含全部字段和新池；本轮不额外授予轻量实体的有限属性组局部恢复或Note锚定。

v5→v6按[06](06-storage-and-export.md#decoration-clusters-v6)创建独立完整副本，新两集合及身份池为空，旧路线、旧池/墓碑、源/祖先、全部实际资源和旧历史保持。新v6的旧AI入口仍拒绝，后续工具授权按[05](05-ai-and-generation.md)和[07](07-roadmap.md#branch-plan)适配；文件可读不等于旧AI能编辑新模型。正式验收输入和通过条件只从[09](09-quality-plan.md#branch-feature-acceptance)执行，开发自检不替代视觉/P3或容量验收。

<a id="canopy-regions-v7"></a>
## 完整v7树冠区域规则领域合同

完整v7保留完整v6/Scene6/identity4/appearance2的精确模型，只在严格v7的`decorationClusters`项上允许可选`canopyRule`；严格v6解析继续拒绝该字段。v6普通装饰与簇命令仍可在v6及更高版本使用，树冠区域创建/更新只允许完整v7。v6→v7采用独立副本，不原地补字段。

`canopyRule`完整保存整数毫米`regionsMm`、固定`channel:'trees'`、同一地形面/受众内单调`paintOrder`、`mode:'plant'|'erase'`及树冠覆盖整数ppm。规则簇必须明确支撑于同Floor地形面，区域完整位于该面内，palette只有一个完整Prop图片素材。`plant`按区域的树冠覆盖比例估算植株数，最高64棵；实例按普通完整Prop保存并计入成员、identity4令牌、普通事务预算和玩家过滤。真实占地、层/实体锁、地形支撑、活动区/连接净空仍逐实例检查，密度目标不能替代合法候选校验。

较新的同树木通道、同地形面、同受众规则覆盖其重叠区域；GM规则不得改变公开规则的植株位置或数量。删除较新的整条规则会重算并显露较早规则。完整v7的严格语义保持不变；后续统一区域覆盖使用完整v8合同，v7字段只在v7读取及显式副本转换中解释。树冠规则尚无AI配方；AI的簇操作会完整检查v7成员、支撑、锁和授权依赖。

本合同的命令/成员/identity4/双受众领域自检不替代区域编辑UI、保存撤销完整旅程、视觉/P3或正式验收；验收输入从[09](09-quality-plan.md#branch-feature-acceptance)执行，开发进度归[07](07-roadmap.md#current-step)。

<a id="surface-rules-v8"></a>
## 完整v8连续地表与区域植被规则合同

完整v8保留v7的有效场景字段及外观/资源语义，新增必需`surfaceRules`字典并使用严格identity5；完整v8的DecorationCluster不再保存v7专有`canopyRule`，旧v1–v7解析、保存和历史重放继续按各自字段集合执行。v7树冠规则只在明确的v7→v8完整副本中转换。`appearance`保持version2，不由区域规则隐式创建或改写固定源。

每条规则属于一个且仅一个地形面、受众和字段。共同字段为`id/floorId/editLocked/visibility/supportRef/field/paintOrder/regionsMm`；`supportRef`必须明确引用同Floor的`terrainArea`。`field`为`material/trees/shrubs/grass`：材质规则另存确切版本的terrain材质绘制参数及`blendWidthMm`；植被规则另存`clusterId/coveragePpm`，种子、固定palette、成员出生/人工状态和实际物件/装饰结果由该DecorationCluster完整保存。区域用整数毫米外环和孔洞环表示，可含多个不相连分量。规则ID、支撑、图层、材质/植被定义及完整资源/许可闭包均须有效。

规则解析先过滤受众及编辑隐藏层，再在相同支撑面、字段和受众内按`paintOrder`求值；较新区域覆盖重叠部分，其余字段独立叠加。GM层在生成公开结果前已排除，不能改变玩家规则、植被数量/位置、材质、阴影或PNG元数据。材质规则经同一解析器作为投影期临时patch交给编辑器和PNG渲染，不写回`TerrainArea.surfaceStyle`、场景文档、历史或存档；`blendWidthMm`只控制外观羽化。世界对齐使用同一毫米原点/尺度，使共享表面上的纹理相位可连续。

植被覆盖目标按固定图像实际默认范围与所选区域面积估算件数，单规则候选不超过64个实际成员；目标不是接受保证。候选仍逐项验证真实Prop占地/支撑、重叠、活动区、道路、楼梯净空、受众、实体/层/支撑/规则锁、注记与路径依赖及完整展开预算。增减覆盖只调整仍由规则管理的成员；人工移动/属性、锁定成员、手工删除、退出记录和有效私密性须保留。对0覆盖率是有效抑制覆盖，不等同擦除。

画笔默认只裁切到起笔选择的真实地形面；明确开启相连面扩展后，按共享边界或真实地形连接扩展为同一原子候选中的多个逐面命令。它不建造地形、不改高程、物理支撑、通行或Floor。局部擦除只从当前规则栈最上层可见区域扣除命中部分；再解析后自然显露仍有效的旧规则或基础材质。孔洞保留为孔洞，不转换成填实多边形。修改到锁定规则或依赖、成员重排超出256操作预算以及任一完整几何/资源校验失败时，整笔拒绝且工程不变。

identity5完整承接identity4的所有身份池及墓碑，另以`surfaceRuleTokens`记录每条规则出生和拓扑token；规则/簇/实际成员仍计入合计65536保护上限。规则区域/覆盖字段编辑保留规则出生身份，支撑、字段或所属簇拓扑变化推进拓扑身份；删除后不得复用ID或令牌，撤销不能回退连续性。

当前v8包含手工画笔、局部擦除、字段独立覆盖、植被数量预览、一次事务采用/撤销及编辑器/PNG材质投影。显式岩岛生成后候选已复用这些规则，但通用自动底图尚未接入；通用楼梯/坡道端部融合和目标岩岛的视觉结果仍待收口。v8规则未获AI写入能力；现行AI能力协商仍显式只接受完整3–7。相关开发证据及限制见[07](07-roadmap.md#current-step)，统一验收条件见[09](09-quality-plan.md#branch-feature-acceptance)。

以下领域字段与有限命令保留当前格式承接的语义；涉及旧M0/M1格式、仓库或版本时仅用于兼容维护。实际检查和失败分别见[历史索引](archive/README.md)，当前验收按[09](09-quality-plan.md)执行。

这是对象字段、坐标、修订和几何不变量的主定义。当前类型、严格Zod Schema、几何校验和事务入口位于src/shared及src/application/workspace；src/core保留旧格式实现。文件封装见[存储与导出](06-storage-and-export.md)，AI参数见[AI 与生成](05-ai-and-generation.md)。

会话与个人目录合同见本文相应主题及[06](06-storage-and-export.md)；其准备、冻结和实施记录分别保存在[工作区历史台账](archive/workspace-content-validation.md)。

B1的v2类型与校验位于src/core/v2，覆盖定义快照、资源引用/版本、斜墙开口、地形支撑、连接带区及组合/散布存档关系；格式可以接受完整结构，不表示所有工具已开放。B2的 `applyCommandsV2` 接受有限严格指令，整体克隆与校验，`WorkspaceV2.execute` 对变化批次只提交一次、增加revision并纳入保存/历史。支持顶点移动、墙厚/反转/拆分、材质/铺装设置、地形轮廓点、组合变换/拆分、成员位置/旋转及外观替换。墙拆分暂只提供领域API；UI提供边界、墙厚与反转候选预览。

所有受影响的实体与锚定依赖共同检查编辑锁；组合成员修改保留overrideFields，拆组保留成员身份/实际物理参数，并把组的有效GM受众写回。带局部覆盖材质的墙拆分、被组锚点注记引用的拆组明确拒绝。B3新增高程、覆盖边界、连接阻断/移除、既有散布组重生成、成员删除/退出和有限编辑锁命令；散布成员手改变为manual，删除保留旋转占地的世界AABB外扩排除区，退出固化有效私密受众。被注记引用的删除/生成移除拒绝。这些旧v2 API不因此获得完整跨域CommandBatch、任意绘图、新建组合/散布域或通用寻路能力；旧读者保持独立。不支持的硬路径约束明确拒绝，现行新格式的有限候选按本文件原子入口处理。

B2另有明确启用的有限门口校验：仅持久化预设 `sceneweave-vis01@1` 应用入口1000 mm净宽/两侧各1000 mm，以及露台门1200 mm净宽/两侧各1500 mm的预留区。`WorkspaceV2.preview/execute` 在变化候选提交前调用同一校验，矩形跟随当前开口端点与方向，检查完整旋转阻挡占地、扣除门洞的实体墙带、miter/bevel转角和Floor边界。边界接触允许，冲突整笔拒绝且不改变修订、历史和保存队列；换外观、受众和组合中心不绕过成员检查。它不求解开门/锁门状态、通用路径、地形通行或预留区外的家具碰墙；其他工程不因标题/实体ID相似而自动启用。完整路径硬约束仍明确拒绝。

B3的 `checkTerrainTravelV2` 只检查一条明确的全宽直线走廊：有效支撑、水阻挡、真实旋转占地、墙/门状态、显式边缘和足宽未阻挡的高差连接，不搜索替代路径。`sceneweave-vis02@1` 在新编辑候选上启用required台阶（2000 mm）及两端各2000 mm接入区守卫；普通无此预设的草稿可缺连接，由局部检查说明无路。高低共边顶点和显式1500 mm浅水覆盖在UI候选中成批更新；尖角/破环/冲突整体拒绝。通用pathChecks/minPathWidthMm仍不支持。

<a id="c0-执行快照与视口边界"></a>
## 内容认证与视口暂态

`validateSceneSnapshotV2`对外部输入执行原有完整严格结构、预算、引用与几何校验，返回与输入分离且深冻结的文档，并仅在模块私有WeakMap登记该返回身份。调用者原对象不会被登记，自行浅冻/深冻、复制相同内容、复用sceneId/revision都不能跳过校验。认证只在当前运行时有效，不进入JSON、完整包、数据库或其他标签；读入后的新对象仍须严格验证。普通`applyCommandsV2`继续提供独立可变候选，既有调用者不因此获得不可变认证。

Workspace使用`applySnapshotCommandsV2`：认证当前文档可复用其输入校验，外部命令仍严格解析，在独立草稿上检查锁和依赖，变化后的最终全场景严格校验一次。候选先冻结再交给样板guard，guard不得修改候选；guard期间若工作区已有新编辑，checkpoint阻止旧候选覆盖。确定无变化的批次返回当前认证引用，不增revision、历史或保存；无效命令即使没有产生业务变化也继续拒绝。

提交通过同一严格Schema的revision/updatedAt子集核验新文档头，revision必须为当前值加一的非负安全整数；溢出在消费历史前失败。撤销/重做复用会话内已认证的冻结内容，生成新文档头，不重新克隆全部内容，也不恢复旧revision。新编辑仍清空redo，历史恢复不重新执行仅适用于新编辑的样板guard；这种内部历史能力不向普通命令或外部输入开放。

C0视口为独立会话暂态：25%–800%倍率相对于适应全图，平移/锚定滚轮缩放/适应全图只改变已有长边1200像素预览栅格的CSS变换，命中再反算世界毫米。视口不属于SceneDocument，不改变几何、实体比例、revision、撤销/重做、自动保存或固定范围PNG；当前不持久化视口。选区覆盖层也不进入工程或导出。认证复用不省略资源/许可检查，不放宽任何Schema、容器或图片限额；实现与验证边界分别见03、06和22。

C5将相同原则用于v6完整内容：证书只绑定本模块严格解析后拥有、深冻结的document/historyIdentity/appearance三个确切对象；换其中任一对象、外部冻结、同ID/revision或JSON复制均不能继承证书。严格revision/updatedAt派生只共享已认证几何与外观，独立校验合并后的出生身份/墓碑；不提供任意“已信任”标志。普通立即编辑合并准备与采用，完整输入和物化候选仍校验实际资源及原件链；有展示期的显式预览保留采用时二次检查。领域guard、player投影、完整锁/依赖/预算、checkpoint和同步回调重入检查、单次undo及单调revision不变。`lastTransaction`仅记录会话完成时间及对应修订，位于全部领域/历史更新后、通知React前；不是SceneDocument、历史信封或快照字段。实际验证与性能判定归[32](archive/m0-m1-validation.md#doc-32)。

<a id="c1a-空白工程与有限单件放置已实现"></a>
## 空白工程与有限单件放置

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

C1a待放置图片的临时预览同样逐次检查引用/记录、实际字节、CRC/hash、尺寸与单图预算，经过共享原生解码槽。预览未就绪不能采用，失败退出待放置并保留当前工程；取消、换素材或离开时释放本次位图，不建立长期缓存。相关验证见[23](archive/m0-m1-validation.md#doc-23)。

<a id="subgrid-fill-copy"></a>
### 子格吸附与有限填充复制

子格为会话暂态，可关闭或按原格细分1、2、4、8份，选择格线交点或格心；以原格的有理数锚点一次量化到整数毫米，不累加取整误差，不改`units`或持久字段。细分间距小于1毫米时禁用对应选项；格距变小使当前细分失效时提示并关闭子格。当前用于单件放置与填充柄定位，数值间距仍按用户明确输入的整数毫米处理。

每次填充明确选择一个独立Prop或一个PrefabInstance；数量只计新增副本，首个副本的位移决定后续间距和方向。组合按当前存活成员复制，保留人工覆盖、删除槽、支撑、有效私密性和外观，副本及存活成员分配新身份；散布/布景簇成员须先明确脱离其管理关系。预览列实际锚点、源/支撑依赖、层、旋转占地重叠和实际展开成本；支撑链与层/实体锁、视觉范围及完整资源仍校验。默认拒绝新增占地正面积重叠，可显式允许重叠；不把组合内部已有重叠重复算作新增冲突。一次候选只接受1–256份且累计真实事务成本最多256，组合成员/身份等实际费用可能先触发拒绝，不截断或拆批。

拖动中及尚未采用候选均不写工程；取消、Escape、地图外松开不产生编辑。采用重新核对基线及完整候选，整批只形成一次编辑和一个撤销单元；revision继续单调增加。开发自检及失败修复见[工作区台账](archive/workspace-content-validation.md#fill-copy-subgrid-20261102)，正式条件归[09](09-quality-plan.md#branch-feature-acceptance)。

<a id="c2-建筑命令与现有字段已实现适用验证见28"></a>
## 建筑命令与依赖闭包

C2沿用严格`SceneDocumentV3`与完整v4历史工程信封，不新增场景/身份字段，也不改v1/v2读取行为。v3内容命令新增`createRoom/updateRoom`、`addOpening/updateOpening/deleteOpening`、`setEntranceOpenings`，以及`createNote/updateNote/deleteNote`、`upsertManualMask/deleteManualMask`与`setCanvasBounds`。编辑锁入口扩展到顶点/房间/墙/开口/注记/区域，仍须独立事务；门窗的通行锁不是编辑锁。混合建筑、既有有限内容和注记命令在独立草稿上有序执行，最终一次严格全场景校验后才暴露候选；内部draft执行器不作为绕过解析/校验的公开工作区入口。

- `createRoom`接收稳定房间ID、Floor、整数毫米多边形、墙厚及可选目标层、用途/可见性/连通声明、显式Floor/地形支撑和已采用固定地板材质。边界接受任一绘制方向，规范为正向；3–256个顶点，展开共边后仍最多256，禁止重复、自交、自接触、折返、零面积或与现有房间正面积重叠。UI数值多边形入口另限3–128点。默认`unspecified`、公开、Floor支撑，不自动重挂内部既有物件。
- 同坐标唯一现存顶点和完整共墙复用身份；新房间边插入已有共线墙端点，部分共边拆旧墙并同步邻接房间边界。原墙ID保留靠原start的第一段，拆出的墙段/切点继承原墙层，其余新房间/墙/点进入目标层。共墙厚度冲突、隐式合并多个同坐标身份或新边界穿越旧墙段内部均拒绝。新派生ID确定生成且须未占用、最长256字符，碰撞/超长不静默换身份。
- 拆分时门窗必须完整落在唯一墙段，开口跨切点拒绝；保留其世界端点、宽度、状态、秘密与通行锁。改变稳定基准需要减去的距离必须是精确整数毫米，不能四舍五入斜墙开口来凑合法值。带局部覆盖的旧墙拒绝自动拆分，避免复制内嵌覆盖身份。现有v2显式拆墙API的历史行为不因此改写。
- 门窗新增/修改显式提供附着墙、稳定计量端点、偏移、净宽和种类；开关、通行锁、秘密/揭示与编辑锁独立。最终原生几何校验真实墙长、端部间隙、最小门宽、区间重叠及引用；显式入口必须是恰好一个房间通向外部的真实门。删除仍有注记、地形连接或入口引用的开口先拒绝，需在有序事务中明确先解除引用。`required`仅验证结构连接，不能据此证明全图通行。
- 内容锁闭包包括相关墙端点/转角邻墙、邻室、开口、地形支撑、房间支撑物件、路径/连接、父组合/散布和递归锚定注记，并合成所属层锁。完整影响ID与层由预览列出，跨层影响须明确确认；不自动解锁或删依赖。建筑新增/改变/删除实体与约束修改按展开成本累计，整体仍不得超过256条操作，不能拆批绕过。
- 玩家遮罩为现存`Region.kind=manualMask`矩形，注记沿用现存坐标/实体锚点；未知字段严格拒绝。`setCanvasBounds`只修改现存Floor世界边界和固定导出矩形，各边1000–200000mm、最大20:1、起点为安全整数；同Floor全部实体作为影响/锁闭包，成本为实体数加1，保留内容最终完整校验。此命令不按秘密几何自动扩裁范围，也不改变坐标比例。

建筑预览、绘图与量尺为会话暂态。工作区采用继续检查checkpoint、当前场景/revision、资源与样板guard，再一次revision+1、可撤销、串行保存。C2本地实现及适用验证及限制见[28](archive/m0-m1-validation.md#doc-28)；普通房间/墙删除、任意拓扑恢复、整组建筑变换及通用路径尚未开放。

<a id="m0-实现范围"></a>
## 旧M0格式的拒绝边界（仅兼容维护）

M0 使用简化雾灯宅验证两个公开房间与一条私密走廊，恰好一层；完整 SCN-01 与从空白绘图尚未完成。完整文档保存和历史重开以现有字段为准，不从 seed 或 Konva 重建。对象未知字段、集合键与 id 不一致、重复 ID、坏引用、非安全整数及非法几何均拒绝；稳定 ID 上限为 256 个字符。

已实现现有家具、顶点、门窗、房间属性和注记的领域操作，以及墙反转/拆分、编辑锁和会话撤销重做。UI 提供其中的样例编辑能力，不提供所有新建/删除工具。结构连通检查已实现；当前通行、家具/区域占地路径和通道求解尚未实现。非空 constraints.pathChecks 或已设置 constraints.minPathWidthMm 会明确报错，不能把未支持的硬约束当作已经通过。

M0 工程只接受 assets 为空且 Prop.assetId=null 的原创程序符号。下面保留 AssetRef、路径和 AI 的后续设计字段；字段存在不等于当前 IO 或命令已经支持其行为。几何版原型已完成首轮单元与 Chrome 浏览器检查，具体证据见[M0 验证报告](archive/m0-m1-validation.md#doc-13)，不代表占地路径或完整三场景验收通过。

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

Room.boundaryVertexIds 至少 3 个非重复顶点；M0 只接受正交简单多边形。M0 校验要求环具有正带符号面积（x 右、y 下时视觉顺时针），方向错误明确拒绝，不在导入时静默重排。不允许自交、零面积、零长边或同层室内面积重叠，允许共享边和接触。门开口不改变房间边界环。旧M1 v2及现行新格式的斜边、共墙、开口和净空按后文各自合同处理；不能据此扩张旧M0 v1的读写集合。

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

<a id="m1-a-v2-开发契约与-b1-实现边界"></a>
## 材质、地形与组件字段语义（旧M1 v2来源）

本节定义旧M1素材格式及现行实体承接的字段语义，旧文档采用 `format="sceneweave"`、`schemaVersion=2`；工程容器采用 `containerVersion=2`、`profile="m1-assets"`、`packageMode="complete"`。它与上文 v1 是独立的严格 Schema，不能向 v1 塞入未知字段、更换 profile 冒充兼容或在导入时丢字段。B1 已新增对应领域与完整包入口；生成算法、依赖编辑和表现的可用范围须分别核对当前入口，不能由格式可读推定全部完成；预算是拒绝策略，不是整体容量或性能证据。修改本节基线须同步06、14及验收，不在实现过程中暗改含义。

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

原生渲染的连接开口只消费受众过滤后的实际连接及支撑关系，按真实中心线与绑定边界相交裁切；临时支撑ID和物化边缘来源ID不进入工程、历史或算法输入。私密连接、未揭示秘密门关联连接不向玩家产生开口、依赖文字或资源旁证。编辑隐藏连接或支撑时，相应暂态开口一起省略；正式输出仍不使用编辑隐藏状态。关门/锁门/blocksMovement只影响当前通行或标记，不抹掉已经公开的实体楼梯与结构开口。

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

显式新建组可选择`scatter-cell-v2`；省略仍为v1，已有组不能用configure替换算法。v2保留v1候选key、位置、旋转和palette独立子流，仅将密度阈值乘以`0.2+0.8×noise`：noise为4×4格粗网格上独立命名空间SHA-256取样的smoothstep双线性插值，形成相邻格疏密关联。完整参数、人工/删除/退出/锁和世界排除仍沿用同一模型与事务；开档不重撒，未知已存算法仍保全实例但拒绝重生成。

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

建筑编辑在当前完整工程版本内执行，不增加持久字段。正交绘制只生成整数毫米房间边界；直接拖墙边在一个候选中移动该墙两端并保留共享顶点关系。删除房间保留邻室仍使用的共享墙；只有用户明确选择时才一并移除不再属于任何房间的墙。删除仍被房间、门窗或引用对象使用的墙必须先在同一批次显式处理关联，最终几何验证不通过则拒绝。整栋变换以选中房间/墙为种子，扩展共享顶点相连的建筑结构，精确平移或按90度旋转；支撑对象、组合/簇成员、路径、连接与递归注记逐项纳入影响，无法保持实际支撑或附着关系时整批拒绝。拓扑修复只开放明示的精确操作（合并冗余共线墙段；对同批编辑形成的精确端点接点拆分墙段），不尝试修复导入或当前已无效工程，也不推断斜交、重叠、开口归属或材质分配。每种操作仍经过完整锁、依赖、预算及最终场景校验，并由一次候选采用/撤销落地。

影响集合先计算、预览并校验，所有需要改变的锁定实体使整批失败；纯渲染缓存可以失效重算，实体/锚点/引用/实际轮廓不能在事务外修复。只读取锁定表面的缓存不算修改该实体，但更新其依赖关系或使其几何含义变化算修改。手工删除依赖默认拒绝并列出引用者；用户选择的级联删除/重绑必须显式列在同一批次，不能静默删除建筑、连接或人工物件。定义/资产移除也执行反向引用检查。所有成功批次只增一次revision，过期候选拒绝，撤销恢复完整实体、覆盖、抑制记录和引用。

有效受众由实体自身、支撑引用、所属组合/散布共同约束：任一上游为gm则该内容不进入玩家投影，public不会反向公开依赖。TerrainEdge须source及所声明邻接均可公开，Connection须两端可公开，Path的supportRefs须全部可公开；出现混合秘密依赖时保守隐藏该实体，不用秘密裁切出的洞提示位置。玩家管线先过滤，随后重算支撑覆盖、默认边缘、材质裁剪、阴影与排序，最后按固定manualMask合成；不能沿用GM缓存。私密Note与来源元数据不进入PNG文本/元数据。规范细节与秘密配对证据见06、08、09。

本版设计限额：每个Room最多256边、每个TerrainArea最多2048边、每个SurfaceOverlay或排除区最多512边、每个Path最多256个中心点、单个PrefabDefinition最多128成员、单个ScatterGroup最多5000个活成员及10000条抑制/排除记录。总工程容量与图片/解压预算以06为主，多个小集合不能绕过总限额。这些是M1-A拒绝策略的设计数值，尚未证明其性能；调整这些限额须同时更新规范、负例及对应真实负载证据。

单次事务的**256实际展开预算**是本项目的工程保护参数，不是费用、全图物件总数或浏览器硬性容量。命令、实体/成员和相应几何等按各版本合同展开；完整v4还计入固定来源/快照、身份和生成状态变化，已存相同内容不作为新增来源重复计费，执行后改回也不退还本次累计成本。来源追加与布景合成一个候选时，先计真实来源成本，再累计命令成本，最后复核净差；不能先单独采用目录规避。数值256尚无最佳容量的性能结论，调限须另有真实负载证据。

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

<a id="c1bc4-编辑契约各批有限能力已实现联合验收待c5"></a>
## 选择、图层、外观与历史

本节规定新能力的逻辑语义，不给当前 `schemaVersion=2` 增加可接受字段。现有 `Prop.renderLayer/renderOrder`、材质覆盖、组合 `overrideFields`、执行快照和最近20份保存记录都不等于下述完整能力。C1c已冻结并实现下述v3文档/容器及独立仓库、严格字段和完整副本迁移；C1d/C3若继续新增语义也须显式演进。未冻结的序列化字段名和版本号不得作为已实现接口引用，旧读者继续拒绝未知语义。迁移和历史保留规则见[06](06-storage-and-export.md)。

### C1b：选择集合与统一命令

已实现范围见[24](archive/m0-m1-validation.md#doc-24)：暂态选择、包含/相交、组/成员、有限批量变换/复制/删除与菜单；`copyProp`克隆当前独立实例并保留有效私密性，`setEditLock`支持prefab容器。每事务最多256条命令，失败整批拒绝；没有向严格v2增加选择或用户图层字段。

框选矩形、命中结果、追加/移除选择、当前编辑目标和右键菜单均属编辑会话；它们不写入SceneDocument或单独增加revision。选择集合使用稳定实体ID，按当前视口变换反算世界位置；框选覆盖规则、组合展开选择和快捷键由[02](reference/editor-and-architecture.md#doc-02)定义。选中锁定实体用于查看属性不等于获得修改权。

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

旧严格v2没有完整来源链与可移除覆盖；其组合`overrideFields`只标记实例人工修改字段，不能据此推定独立参数链、调整图层或AI同化。现行新标识工程的appearance图按本文件对应版本处理。

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

命名历史仍完整落盘/携带，但连续性记录不进入v3场景、v4信封、数据库、包或玩家输出；导入/重开后可查看旧快照并沿用C1d适用物件恢复，旧结构恢复明确拒绝。未来持久结构身份、跨会话结构恢复或拓扑恢复须新版本字段、严格读者分派与完整副本迁移，不能给当前严格格式偷加记录。采用沿用flush、来源hash/元数据/场景CAS保护点、二次基线校验及一次revision+1可撤销事务；资源使用当前完整闭包，范围外新编辑保持。实际验证见[28](archive/m0-m1-validation.md#doc-28)。

下表为C1d至C4的整体恢复目标。C1d提供上述三种独立物件模式，C2补有限同会话结构模式；当前C3在独立v5合同下增加有限组合/成员关系、外观源链及当前层规则恢复，具体范围与证据见本页C3章节及[29](archive/m0-m1-validation.md#doc-29)。C4进一步提供持久室外连续身份与有限地形/散布恢复，见本页C4合同及[31](archive/m0-m1-validation.md#doc-31)。完整图层内容、任意拓扑及持久建筑恢复仍未提供。


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

C3不向既有严格SceneDocument v3或v4历史信封增加可忽略字段。新增严格`CompleteProjectV5`，内含原生、完整的有效v3场景，以及必填`appearance`图和`historyIdentity` version 2；文档、资源和许可共同构成唯一持久化单元。显式v3视图仅用于已有原生渲染和领域工具，不是降级保存通路。旧v4读者必须拒绝v5；容器/独立仓库及完整副本迁移见06。以下为本轮实现合同，实际通过范围以[29](archive/m0-m1-validation.md#doc-29)证据为准。

`appearance.version=1`包含固定`sources`、现存物件/已设样式表面的`propSources`/`surfaceSources`、`instanceAdjustments`、`layerAdjustments`、`variants`及`prefabAppearanceTemplates`。源保存完整物件外观快照或完整SurfaceStyle，以固定ID引用；父源最多16层，拒绝环、悬空与未知字段，不能原地升级来源。物件源不包含位置、占地、支撑或公开状态。固定源及派生资产保留完整实际字节、定义、许可和有界来源闭包，删除实例后不得产生现存目标悬空映射。

覆盖按固定源→当前用户图层→实例/成员求值；每项有独立ID、enabled及有限参数：调色为`#RRGGBB|null`、亮度0.25–2、透明度0–1、物件阴影为既有类别。同种参数逐级覆盖，不隐含相乘。持续图层规则与冻结ID的单次批量明确区分。显式选择含不支持的实体则整批拒绝；图层规则列出当前支持范围及不适用项。切层、关闭/移除任一覆盖后重新求有效外观，物理/通行/秘密不变。实际影响及依赖锁展开计入256操作预算，不能自动拆批绕过。首批颜色/亮度支持真实图片和已设样式表面；符号物件不支持颜色派生，不宣称原生渲染已支持符号调色。

颜色位图派生记录源assetId、调色、亮度和输出assetId，规范化后存实际输出字节；必须按源像素和参数核对输出，不能只信声明hash。透明alpha保持，原生v3有效物件引用实际位图且`tint=null`；透明度与阴影仍为完整有效字段。材质调整保留铺装几何、覆盖区域及高程。既有严格v3要求SurfaceStyle底材opacity=1；本轮物件透明度支持0–1，阴影参数只调整主题类别并保留源自定义shadowOverride；已设样式表面或含其图层设opacity<1明确拒绝整批，不放宽旧约束。导入静态PNG/JPEG/WebP显式声明图像/占地或铺装毫米、阻挡属性、标签、完整许可与署名和嵌入许可；未经校验的候选不进入工程/历史。

固定组合可从同层、同Floor的独立物件保存定义和成员来源/覆盖、明确放置、按当前实际成员及删除记录复制、拆开和删除。首批不含嵌套组合/散布/结构组。来源私密性保留于固定模板，不能由模板缺省值暗中公开。历史身份version 2增加`prefabTokens`，物件与组合合计最多65536个出生身份；删除后ID不得普通复用。成员恢复校验组合身份、固定定义版本、成员key/映射及双方出生身份；关系恢复逐项列出现存修改、重建、删除及人工记录，不重新生成成员。

外观局部恢复默认固定历史有效外观到所选实例，保留当前图层规则及未选对象的后续编辑；另提供“历史源/参数＋当前层效果”模式并预览差异。图层规则恢复是显式独立范围，列出当前受影响成员及有效锁。组合关系恢复与独立物件完整恢复区分；后续C4的有限散布/地形依赖范围见下节。恢复继续使用真实快照、内容hash、保护点、源/场景/元数据CAS、单调revision及一次撤销语义。C2结构恢复维持原有会话连续性证明与拒绝条件，不因C3身份扩展变成持久结构身份。

## C4：室外身份与有限手工工具（严格v6合同，本地实现）

用户2026-10-22“做”授权后，C4采用独立严格v6工程信封；有效SceneDocument仍为严格v3、非破坏外观图仍为appearance1。当前/历史完整信封继续保存document、historyIdentity、appearance及完整资源/许可，不用v3或v5视图替代保存。实现与实际验证范围见[31](archive/m0-m1-validation.md#doc-31)，准备交接30保留原状态。

identity3严格字段为version=3、lineageId、rootSceneId、propTokens、prefabTokens、outdoorTokens。前两种出生表延续C3；outdoorTokens每个ID记录kind、token、topologyToken、topologyHash。kind限定terrainArea/terrainPoint/terrainSegment/terrainEdge/terrainConnection/path/scatterGroup/scatterExclusion；出生token及室外拓扑token全局唯一，三类出生表及墓碑ID合计不超过65536。topologyHash为当前关系的规范SHA-256；轮廓忽略循环起始行但保留有向邻接，path包含Floor/supportRefs，scatter包含Floor/domain/seed/algorithmVersion。坐标、高程、材质和业务参数不作为拓扑。普通拓扑变化生成新topologyToken，撤销/重做不能回退令牌来伪造旧连续性；删除墓碑保留，同ID/type/Floor不足以认同一实体。C2建筑仍使用原会话witness，C4不扩充持久建筑身份。

新户外命令以严格白名单创建/修改/删除地形、来源边缘、连接、道路、用途/危险Region与散布；世界坐标整数毫米，采用前严格检查完整场景、资源、有效锁及玩家输出。新地形生成固定点/段ID；显式来源边缘规范化唯一来源/邻接，高差必须阻挡。轮廓/高程变化不在事务外偷偷改边缘或重生成散布；必要来源重映射必须明确同批列出，不能保持的附着拒绝。道路使用已定义方端帽/miterLimit2及bevel带区、显式支撑和独立移动代价，材质不授予高差通行或全图寻路。

预览列根、真实改变、创建/删除、只读依赖和跨层影响；几何不变而支撑/附着/可见轮廓含义变化的依赖也要列出。实体、当前图层和必要支撑锁共同约束；修改实际语义也算修改，纯读依赖不等于写入。每次最多256条实际展开操作，实体、成员记录及抑制/排除写入计入，不以单个regenerate命令规避预算，不自动拆批。

散布candidateKey继续标识算法候选槽位；仍存活的同候选成员保留物件ID与出生token，新出生成员取得从未使用的ID。人工移动、覆盖、deleted/detached、锁与所有当前exclusions优先，C3固定源与实例外观不能被默认重生成覆盖。密度淘汰不等于用户删除；普通重生成没有历史复活权限。保存完整实际实例及人工记录，关闭重开不运行seed重建。

恢复新增outdoorGeometry、outdoorProperties和scatterMembers；appearance/source延伸到连续身份可证的现存室外表面及散布成员。首批室外几何/业务恢复保留当前拓扑、层、锁、支撑关系及范围外后改，只接受同出生/拓扑令牌和合法当前依赖；当前新增依赖重新检查，不隐式恢复历史拓扑。默认外观保留当前人工位置、删除、退出、排除和后增成员，必要实例覆盖隔离当前层；原源/参数模式显式沿用当前层规则并列差异。历史散布成员重建是独立显式模式，使用快照真实完整Prop及出生证明，逐项列成员/删除/排除记录变化，只调整本次明确范围；不能清空后续人工或入口排除，也不能运行seed替代历史结果。

所有恢复保持真实快照ID/hash、固定来源祖先及确切许可、完整依赖确认、先保护当前、源/场景/元数据CAS和一次revision+1可撤销采用；失败/取消及采用后保存失败沿06保全双方。玩家派生先过滤私密上游再计算公共支撑/边缘/道路/材质/阴影，最后固定遮罩；实际PNG不携带私密元数据。表面底材opacity=1及源自定义shadowOverride优先规则保持。


<a id="m1-d-首批显示与混合场景合同2026-10-23"></a>
## 显示设置与混合场景

继续使用严格v6完整信封、identity3、appearance1及有效v3场景；新目录/固定定义是完整资源数据，不新增保存字段。`setSceneDisplay` 独立原子事务只更新既有 `units.display/gridSizeMm/snapMm/gridVisible` 和 `presetSnapshot.distanceMode/gridSizeMm`；世界单位保持整数mm，固定预设ID/版本/来源、几何、占地、支撑、通行、图层、锁与外观/历史身份保持。显示预设取既有调查/战术/叙事默认值，不重置固定样板的校验标识。不能与解锁、内容或组织操作混批。

房间材质使用既有 `setSurfaceMaterial`；整墙平移在同笔事务移动两个稳定端点，保留开口端点基准与沿墙偏移，并检查真实邻墙、房间、开口、支撑与注记/图层依赖及256预算。有限哨所守卫按固定 `sceneweave-scn04@1` 检查两门结构净空、至少2m道路、明确接到台阶低端及唯一台阶接入；关门是合法编辑，当前路线另按门状态显示。道路首段与1.2m南门分别检查，未承诺一条全程2m路线或任意寻路。未知样板版本不显示通行成功。固定源/派生实际位图、许可及私密投影规则不降级，见[35](archive/m0-m1-validation.md#doc-35)。

<a id="u1u2-准备会话目录身份与个人组织计划未实现"></a>
<a id="u1u2-准备会话目录身份与个人组织历史合同"></a>
## 会话与个人目录

本节集中定义会话暂态、固定内容与个人组织的职责。当前产品使用本文件开头的新标识工程与独立个人库；旧六仓库发现/转换仅有历史兼容实现，见[37准备记录](archive/workspace-content-validation.md#doc-37)，不作为当前入口。

一个编辑会话持有唯一当前完整工程。只读浏览模块面板保留当前选择、视口、当前层/编辑隐藏状态、各模块草稿/搜索、待审阅候选、撤销与保存/错误状态；这些状态不因面板位置调整而写入SceneDocument。只允许一个活动待审阅候选；回首页前须先明确结束冲突草稿、采用或取消待审阅候选，保存保护完成后首页与“继续编辑”仍沿用同一会话，保留选择/视口/撤销和连续性证明，不执行open/import。互斥指针工具或冲突编辑也不能暗丢草稿或候选；异步结果仍绑定原generation/checkpoint，返回面板不能取得新的可信基线。实际重开、导入或切工程继续使相应会话连续性证明失效；仅浏览面板或安全首页往返不应等同重开。浏览器重载只承诺恢复已持久化内容，不新增草稿或撤销栈的跨重启存档。格线/单位继续是现有工程事务，布局偏好独立在本机按版本保存，损坏时复位，均不混入历史身份。

### 固定内容与个人组织分别负责什么

“内置素材／我的素材／本工程”是目录浏览范围，不表示自动分享或同一份可变定义。浏览本工程不自动将条目推广到个人库，保存到“我的素材”须明确采用范围。个人组织记录以确切固定来源身份关联，须区分定义种类、逻辑目录和固定版本并核对内容；工程快照ID、显示名或位图hash单独都不足以替代该身份。精确编码与来源命名空间按本文件目录身份映射和06的个人库合同执行。既有“同种类＋catalogId＋version只能有一份内容”不变，同身份不同内容不得静默合并或用改快照ID掩盖。

| 数据责任 | 边界 |
|---|---|
| 发布者固定定义、标签与来源 | 沿用不可变内容。发布者改默认标签也要发布显式新固定版本；目录更新不改已采用工程 |
| 个人标签、人工颜色描述与收藏 | 独立、带版本的组织记录，绑定确切固定来源；不修改发布者字段、资产字节或定义默认值，也不增加工程revision |
| 目录索引、缩略图与资源安装状态 | 用于浏览和提示可用性；索引/缩略图不能证明完整资源已安装或已获嵌入许可，不能作为保存的唯一内容 |
| 工程采用内容 | 保存确切固定定义、源/父源、成员、实际资源及许可闭包；个人全库整理不自动随工程分享 |

组合从本工程显式存入个人库、库备份/恢复及随后放置的闭包，必须包含`prefabAppearanceTemplates.visibility`、每个成员的source/adjustments、完整来源祖先、非活动派生保全定义及其实际字节和确切许可。不能只复制`PrefabDefinition`再调用同步逻辑补模板：目标没有原私密实例时，默认重建模板可能将组合公开。固定模板的有效私密性不得因换库或放在公开Floor上丢失；恢复和放置继续服从当前场景的完整依赖与受众校验，无合法固定遮罩时整笔拒绝，不能改为公开制造成功。三个目录范围的名称、缩略图、个人组织及完整库备份属于GM编辑数据，不进入玩家输出。

个人标签允许中文和普通自由文本；匹配规范化与显示原文分离，不因大小写、空白或全半角归一化丢失用户显示用字。制作/保全内部标签与发布者标签标明来源，内部保留元数据不开放个人编辑。同维度多选取任一、跨维度取交集，自由标签明确选择全部/任一；具体字符、去重、排序与限额按固定组织schema执行，旧目录v1的精确来源见[40](archive/workspace-content-validation.md#doc-40)。颜色首批是人工确认的多色描述，关联固定源或变体；算法取色、场景当前有效颜色筛选和实例标签均不在首批。标签/收藏/颜色不改变占地、支撑、危险、阻挡、受众或场景选区。

<a id="u2a-必须先冻结的合同"></a>
### 目录合同的责任边界

| 冻结项 | 主定义责任与交付要求 |
|---|---|
| 目录与组织记录 | 本文定义独立严格schema、确切身份编码、记录版本、发布者/个人/内部元数据边界与兼容拒绝方式；当前准备不创建新格式 |
| 文本与集合预算 | 本文与06共同明确标签规范化、显示保留、重复判定、数量/长度/展开限额；不能直接把工程256事务上限当作全部目录容量 |
| 本地并发与安装状态 | 06冻结组织修订/CAS、完整资源安装与取消/失败状态、跨存储边界的提交次序；不能借工程revision代替个人目录并发版本 |
| 备份与导入冲突 | 06冻结完整库备份及可选仅组织清单的精确格式、预算、缺失引用处理、同身份内容冲突和组织合并规则；不静默覆盖固定内容或另一标签的整理 |
| 采用与删除边界 | 本文定义有限采用命令、固定身份与闭包；06定义实际字节、许可、离线、原子失败及引用保护。删个人目录条目不删除工程/历史/来源根 |

任何未来实例标签或组织快照都须独立演进严格合同，不向既有场景/身份字段追加未定义语义。目录采用、并发、备份和玩家隔离的验证项目见[09](09-quality-plan.md)。

### U2a 独立目录 v1 冻结合同（2026-10-23）

旧目录v1的精确字段、组织限额、目录CAS和完整库备份合同保存在[40](archive/workspace-content-validation.md#doc-40)，准备/实施结果分别见37/41；当前新个人库以本文件目录身份映射及[06](06-storage-and-export.md)为准，不延续当时“待定稿/待回归”的状态。

### 内容补标与精修边界（2026-10-23）

只读curation v1索引按确切目录内容身份关联，补充标签/人工颜色不改CatalogItem、DB、备份或工程格式；新题材与精修用独立固定定义与实际完整资源采用，旧空白预装与旧工程保留。精确范围和角色见[42](archive/workspace-content-validation.md#doc-42)，实际结果另归43。
