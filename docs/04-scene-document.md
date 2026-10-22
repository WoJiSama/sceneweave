# 场景文档与编辑契约

状态：M0严格v1、并列严格v2及B1–B5、C0/C1a/C1b保持，历史结果见13/17–24。大量选择优化见[25](25-selection-performance.md)，严格v3用户图层见[26](26-m1c-c1c-validation.md)。C1d已实现独立v4工程信封/容器、命名快照和首批独立物件局部恢复，场景文档继续严格v3；实际验证与限制见[27](27-m1c-c1d-validation.md)。下一入口为C2结构工具与相应恢复；C3非破坏性外观和M2素材生成/同化仍为后续契约。完整手工工具、主题P3及SCN-04仍待完成。更新：2026-10-22。

这是对象字段、坐标、修订和几何不变量的主定义。当前类型、严格 Zod Schema、几何校验和事务入口位于 src/core；文件封装见[存储与导出](06-storage-and-export.md)，AI 后续参数见[AI 与生成](05-ai-and-generation.md)。

B1的v2类型与校验位于src/core/v2，覆盖定义快照、资源引用/版本、斜墙开口、地形支撑、连接带区及组合/散布存档关系；格式可以接受完整结构，不表示所有工具已开放。B2的 `applyCommandsV2` 接受有限严格指令，整体克隆与校验，`WorkspaceV2.execute` 对变化批次只提交一次、增加revision并纳入保存/历史。支持顶点移动、墙厚/反转/拆分、材质/铺装设置、地形轮廓点、组合变换/拆分、成员位置/旋转及外观替换。墙拆分暂只提供领域API；UI提供边界、墙厚与反转候选预览。

所有受影响的实体与锚定依赖共同检查编辑锁；组合成员修改保留overrideFields，拆组保留成员身份/实际物理参数，并把组的有效GM受众写回。带局部覆盖材质的墙拆分、被组锚点注记引用的拆组明确拒绝。B3新增高程、覆盖边界、连接阻断/移除、既有散布组重生成、成员删除/退出和有限编辑锁命令；散布成员手改变为manual，删除保留旋转占地的世界AABB外扩排除区，退出固化有效私密受众。被注记引用的删除/生成移除拒绝。完整范围/基线/来源协议的v2 CommandBatch、任意绘图、新放组合/散布域与通用占地路径仍待后续；不支持的路径硬约束继续拒绝，v1入口保持独立。

B2另有明确启用的有限门口校验：仅持久化预设 `sceneweave-vis01@1` 应用入口1000 mm净宽/两侧各1000 mm，以及露台门1200 mm净宽/两侧各1500 mm的预留区。`WorkspaceV2.preview/execute` 在变化候选提交前调用同一校验，矩形跟随当前开口端点与方向，检查完整旋转阻挡占地、扣除门洞的实体墙带、miter/bevel转角和Floor边界。边界接触允许，冲突整笔拒绝且不改变修订、历史和保存队列；换外观、受众和组合中心不绕过成员检查。它不求解开门/锁门状态、通用路径、地形通行或预留区外的家具碰墙；其他工程不因标题/实体ID相似而自动启用。完整路径硬约束仍明确拒绝。

B3的 `checkTerrainTravelV2` 只检查一条明确的全宽直线走廊：有效支撑、水阻挡、真实旋转占地、墙/门状态、显式边缘和足宽未阻挡的高差连接，不搜索替代路径。`sceneweave-vis02@1` 在新编辑候选上启用required台阶（2000 mm）及两端各2000 mm接入区守卫；普通无此预设的草稿可缺连接，由局部检查说明无路。高低共边顶点和显式1500 mm浅水覆盖在UI候选中成批更新；尖角/破环/冲突整体拒绝。通用pathChecks/minPathWidthMm仍不支持。

## C0 执行快照与视口边界

`validateSceneSnapshotV2`对外部输入执行原有完整严格结构、预算、引用与几何校验，返回与输入分离且深冻结的文档，并仅在模块私有WeakMap登记该返回身份。调用者原对象不会被登记，自行浅冻/深冻、复制相同内容、复用sceneId/revision都不能跳过校验。认证只在当前运行时有效，不进入JSON、完整包、数据库或其他标签；读入后的新对象仍须严格验证。普通`applyCommandsV2`继续提供独立可变候选，既有调用者不因此获得不可变认证。

Workspace使用`applySnapshotCommandsV2`：认证当前文档可复用其输入校验，外部命令仍严格解析，在独立草稿上检查锁和依赖，变化后的最终全场景严格校验一次。候选先冻结再交给样板guard，guard不得修改候选；guard期间若工作区已有新编辑，checkpoint阻止旧候选覆盖。确定无变化的批次返回当前认证引用，不增revision、历史或保存；无效命令即使没有产生业务变化也继续拒绝。

提交通过同一严格Schema的revision/updatedAt子集核验新文档头，revision必须为当前值加一的非负安全整数；溢出在消费历史前失败。撤销/重做复用会话内已认证的冻结内容，生成新文档头，不重新克隆全部内容，也不恢复旧revision。新编辑仍清空redo，历史恢复不重新执行仅适用于新编辑的样板guard；这种内部历史能力不向普通命令或外部输入开放。

C0视口为独立会话暂态：25%–800%倍率相对于适应全图，平移/锚定滚轮缩放/适应全图只改变已有长边1200像素预览栅格的CSS变换，命中再反算世界毫米。视口不属于SceneDocument，不改变几何、实体比例、revision、撤销/重做、自动保存或固定范围PNG；当前不持久化视口。选区覆盖层也不进入工程或导出。认证复用不省略资源/许可检查，不放宽任何Schema、容器或图片限额；实现与验证边界分别见03、06和22。

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

secret=true 且 revealed=false 时，玩家投影把该开口补成普通墙段。revealed=true 只公开门的位置，不自动改变 state、locked 或隐藏房间的 visibility。可选M2-L布局提案如创建秘密门，必须来自请求中的明确设计意图，新秘密门始终未揭示；M2素材同化不创建或改动门语义。

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

可选M2-L布局提案新建普通几何沿用public；请求明确要求的隐藏房间/通路由核心创建为gm，秘密门为secret=true、revealed=false；放入gm房间的新物件默认gm。模型不能自行改变已有实体可见性，不能以“默认public”覆盖用户的秘密设计意图。可选M2-L的新AI注记仍为gm，公开描述的改写先产生gm草稿；这些创建权限不属于M2素材生成/同化入口。

Note.discovered 只记录线索发现状态，不自动公开正文；主持人显式改变 visibility 才能发布。对象被删时附属注记随事务删除，或由主持人先改为坐标锚点；禁止留下悬空引用。删除这类操作属于手工编辑能力，可选M2-L布局提案白名单暂不提供；M2素材生成/同化也不获得删除场景实体的权限。

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

重新生成先产出候选；只可替换仍managed且未锁定的成员，保留manual、deleted、detached和所有exclusions。锁定成员不在重生成影响集合中，其位置作为间距障碍；需要修改锁定实体时整批失败。排除区禁止新候选占地相交，删除的key即使落点改变也不得复活；人工覆盖移到域外可以保留并提示，但其支撑/场景硬约束仍须合法。缺失算法版本时可继续编辑已存实例，禁用重生成并说明原因。可选M2-L的ScatterProps只能新增组与Prop，不能用此机制重写旧组、清除删除记录或解除锁；M2外观同化不调用重生成来替换成员。

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

M1新手工领域能力不自动扩充AI权限。M2素材生成/同化只能经过受控资源入库及明确外观采用事务；原布局/布景操作属于可选M2-L，白名单统一归05。两者均不可直接改地形高程/轮廓、原地改固定定义快照、秘密、锁或旧散布人工覆盖，不可发送任意JSON patch。M1/B的字段完整性、几何校验和可编辑样板也不自动代表占地寻路求解器已经完成。

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

## C1b–C4 编辑契约（C1b有限能力已实现，后续仍待完成）

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
4. **逐步扩围。** M2-A先对一个组件或材质生成/同化候选，M2-B扩展至明确组合及成员映射，M2-C才允许明确选择的多个组合或区域逐批采用。每次扩围重新固定baseRevision、目标ID和允许属性组；相似风格、同目录引用或空间相邻不能授权自动传播。人工覆盖默认保护，只有本批明确选入的外观覆盖允许修改；人工位置、删除/排除记录、未选对象/属性/覆盖保持，模型建议的更大范围只能成为待选范围。
5. **采用和还原。** 预览差异、资源校验、范围/锁/基线校验后，通过与手工相同的原子事务采用；部分采用按完整依赖组重新形成候选。取消或生成失败不改源版本，已采用派生可通过撤销、移除覆盖或局部快照恢复回退。

图层外观覆盖是用户明确建立的持续规则，移入成员会继承，移出成员会失去该层覆盖；修改、停用或移除覆盖都先枚举实际受影响成员并检查有效锁，不能通过改层参数绕过成员锁。批量外观调整、AI采用和普通局部恢复默认固定本次目标ID及属性组，不暗建持续层规则；显式恢复图层覆盖本身时须按当前成员重新列出影响，不能只检查历史成员。

本节的完整来源链和可移除覆盖尚未存在于严格v2。当前组合 `overrideFields` 仅标记实际Prop哪些字段已被人工修改，不存可独立撤回的源参数链；当前外观替换也不能据此宣称已具备完整调整图层或AI同化。

### C1d起：命名快照与局部恢复

#### C1d冻结合同（2026-10-22，已实现；验证见27）

本批不改变场景字段：`SceneDocument.schemaVersion=3`继续使用严格v3的完整用户图层/几何契约。工程信封和容器独立演进为v4；`historyIdentity={version:1,lineageId,rootSceneId,propTokens}`属于完整主持人工程，不能加进v3场景JSON。`propTokens`为稳定物件ID到不可复用身份token的映射，包含已删除物件；创建新物件分配新token，普通新建/复制不允许复用已分配ID。撤销/重做保留已分配身份并集；隔离导入和另存副本保留lineage、实体ID及token。相同ID但token不同或lineage不同的快照不得用于恢复。

首批以明确ID列表（最多256）选择三种模式：仅外观恢复`definitionRef/appearance/visualBoundsMm/shadowClass/shadowOverride`，保留当前占地、支撑、位置、旋转、渲染带/顺序、层、锁和visibility；位置/旋转只恢复`positionMm/rotationDeg`；完整实体模式允许恢复现存独立物件或显式重建已删除物件，完整列出层/visibility/占地/支撑等变化。现存物件保留当前editLocked，重建物件为未锁定，不从历史重放锁。模式不隐式删除快照后新增对象。两端对象不得有组合、散布、锚点注记或路径硬约束依赖；所需现存层/支撑、固定资源和依赖锁仍须校验，缺失时拒绝，不扩展成结构恢复。当前实体及目标层有效锁、完整几何、样板约束及玩家投影继续约束候选。新素材定义不可覆盖当前同ID不同版本/内容；资源依赖无法无歧义合并时拒绝。

命名快照内容不可变，名称仅作显示；采用固定快照ID及contentHash、当前sceneId/revision/checkpoint和属性组。保护快照须成功落盘后再次核对当前基线及快照仍存在且内容一致，再以revision+1的单一事务采用。原生v3绘图仅接收完整v3场景及必要资源，工程历史元数据不进入像素投影。存储/容器和独立预算以06为主定义。

命名快照捕获一个完整、可验证的工程修订及资源闭包；名称是快照元数据，重命名不改变捕获内容。自动保存的最近20份、用户固定的命名快照、会话撤销栈和C0运行时认证快照是四种不同概念。命名与保留/删除、恢复前备份和历史导出策略以06为主；实体级恢复必须遵循本节语义。

局部恢复从历史完整快照提取“稳定ID＋选定属性组＋必要依赖”，在**当前完整工程**中建立新的候选事务；不把旧SceneDocument整体覆盖回来，不倒退revision，不丢掉未选区域后续编辑。C1d先支持无组合/散布/结构恢复依赖的独立物件及其已支持外观属性；用户可选当前实体，也可在快照中选择已删除对象。共享墙门/房间恢复随C2开放，完整组合/人工覆盖与新外观链恢复随C3开放，地形/连接/散布依赖随C4开放。图层选择可作为已支持成员的批量入口，但完整图层内容恢复需相应实体类型和依赖恢复均已实现。

下表为C1d至C4的整体恢复语义；当前仅实现上述三种独立物件模式，不提供层覆盖、完整图层、结构或组合/散布关系恢复。

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
