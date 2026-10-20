# 场景文档与编辑契约

状态：M0 几何版原型首轮验证完成，格式 v1 尚未正式发行。最后更新：2026-10-20。

这是对象字段、坐标、修订和几何不变量的主定义。当前类型、严格 Zod Schema、几何校验和事务入口位于 src/core；文件封装见[存储与导出](06-storage-and-export.md)，AI 后续参数见[AI 与生成](05-ai-and-generation.md)。

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

## 顶层字段

| 字段 | 含义与约束 |
|---|---|
| format / schemaVersion | 固定格式标识 sceneweave；初始设计版本 1；与应用版本独立 |
| sceneId / revision | 场景身份与当前文档修订；另存副本生成新 sceneId |
| title | 主持人使用的标题；导出文件名由用户另外确认 |
| createdAt / updatedAt | UTC 时间字符串；用于显示/审计，不替代修订冲突判断 |
| units | 世界单位 mm，显示单位、网格/吸附设置；世界单位不可变 |
| exportBoundsMm | 显式的导出矩形，不根据秘密几何自动扩大/裁剪 |
| floors | Floor 集合；M1 恰好一层 |
| vertices / rooms / walls / openings | 稳定 ID 索引的几何实体集合 |
| props / regions / notes | 物件、区域和注记集合 |
| assets | AssetRef 清单，不含 Blob 或外部执行内容 |
| presetSnapshot | 预设 ID、版本、显示/量尺策略快照及规则来源版本标签 |
| constraints | entranceOpeningIds、wallEndClearanceMm、可选最小门宽/通道净空、pathChecks 及约束来源；未启用项不得推成硬约束 |
| generationMetadata | 可选已采用的生成来源，见下文 |

文件中的集合不可含重复 ID；schema 校验不能通过静默丢弃重复键来“修复”文档。持久化文档不保存 Konva 类名、React state、访问令牌、当前选区、视口或未采用的 AI 提案。

## 对象定义

### Floor、Vertex、Room

| 对象 | 字段 | 约束 |
|---|---|---|
| Floor | id、name、boundsMm | 可编辑世界边界；与可裁剪的 exportBoundsMm 独立；单层版本不表达楼梯传送或层间可见性 |
| Vertex | id、floorId、xMm、yMm、editLocked | 可被多个墙与房间共享；移动共享顶点会影响所有引用者 |
| Room | id、floorId、boundaryVertexIds、purpose、editLocked、visibility、accessExpectation | 边界是有序顶点环，末尾不重复第一个；purpose 为用途标签 |

Room.boundaryVertexIds 至少 3 个非重复顶点；M1 编辑器只生成正交简单多边形。M0 校验要求环具有正带符号面积（x 右、y 下时视觉顺时针），方向错误明确拒绝，不在导入时静默重排。不允许自交、零面积、零长边或同层室内面积重叠，允许共享边和接触。门开口不改变房间边界环。

Vertex 与 Room 边界描述墙中心线，Wall.thicknessMm 向中心线两侧各扩展一半。房间占地区域与实际可走净空分开计算；例如两平行墙中心线相距 1300 mm、墙厚均为 100 mm 时净宽为 1200 mm。房间尺寸表和生成器必须说明中心线尺寸与净空要求，不能把显示上相距一格直接当作一格通路。门 widthMm 是沿墙开口净宽，首版不额外模拟门框厚度或门扇扫掠碰撞。

初始绘制墙厚建议默认 100 mm，可在属性中显式调整；该数值是工程默认，不是建筑设计规范或跑团规则。

accessExpectation：unspecified（草稿，提示未连接）、required（必须满足指定入口结构连通）、intentionalIsolation（明确允许孤立）。手工新房间默认 unspecified。标成 intentionalIsolation 时保存主持人说明到私密注记；AI 不能把已有 required 自动降为其他值。

走廊可表示为 purpose=corridor 的 Room。室外草地、营地区域或危险地带用 Region，不要求为了摆放物件先建一个封闭房间。

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

secret=true 且 revealed=false 时，玩家投影把该开口补成普通墙段。revealed=true 只公开门的位置，不自动改变 state、locked 或隐藏房间的 visibility。AI 创建秘密门必须来自请求中的明确设计意图，新秘密门始终未揭示。

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

AI 新建普通几何沿用 public；请求明确要求的隐藏房间/通路由核心创建为 gm，秘密门为 secret=true、revealed=false；放入 gm 房间的新物件默认 gm。模型不能自行改变已有实体可见性，不能以“默认public”覆盖用户的秘密设计意图。所有新 AI 注记仍为 gm，公开描述的改写先产生 gm 草稿。

Note.discovered 只记录线索发现状态，不自动公开正文；主持人显式改变 visibility 才能发布。对象被删时附属注记随事务删除，或由主持人先改为坐标锚点；禁止留下悬空引用。删除这类操作属于手工编辑能力，M2 AI 白名单暂不提供。

AssetRef.origin 存原创/导入/生成的来源类别与必要授权信息，避免绝对本地路径、provider 凭据或完整提示词。多个引用可共用相同 hash。原始资产许可及可嵌入标记见[规则与素材](10-rules-assets-and-licensing.md)。

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

完整批次在候选状态上计算，统一校验后一次提交。不将前几个成功操作先应用再留下后续错误；后续选中 AI 部分建议时按依赖组构造新的完整批次重新校验。undo/redo 恢复内容，保留同一 sceneId，并以当前 revision+1 提交。新的普通编辑清空 redo 分支。M0 对外提供深冻结快照；会话历史不跨重开恢复。拖动中的位置属于暂态，释放时仅提交一次；取消或基线修订已变化时不提交。

## 生成与预设元数据

generationMetadata 仅记录已经采用的 brief 摘要、generatorVersion、seed、模型/适配器标识与生成时间等来源。摘要默认属于 GM 工程内容，不能进入玩家图或无关网络日志。用户可选择不保存来源文字；禁止凭据或原始模型隐藏推理入档。

presetSnapshot 包含 presetId、presetVersion、distanceMode、单位/网格建议、采用的规则来源标识及自定义覆盖。选择新预设前显示变化；手工覆盖是否重置需明确，坐标绝不随预设切换改变。旧存档按快照重开，不用最新预设悄悄替换规则。

## 版本、错误和兼容

- 文件格式版本独立于 appVersion、presetVersion、generatorVersion。修改必填字段或含义时需要显式格式迁移。
- 新版本导入旧文档先在隔离副本迁移、校验，再保存为当前格式；原文件保留。失败给出对象级诊断。
- 老版本遇到未知主格式或未知必须理解的实体，不做静默丢字段保存。首版可以拒绝并说明需要更新版本。
- 文档容量、图片大小、ZIP 条目与解压限制由导入策略规定；读取者必须限制资源，不能把“合法 JSON”当作足够验证。
- 可修复的缺失素材与结构损坏分开报告。结构损坏不能进入可提交文档；允许下载原始文件保留，但不能标记修复成功。

硬不变量、暂态草稿诊断与专项生成约束应分别返回，保证编辑流程可用。对应验收与负例见[质量计划](09-quality-plan.md)。
