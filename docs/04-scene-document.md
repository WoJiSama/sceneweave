# 场景文档与编辑契约

状态：M0 几何版原型首轮验证完成，格式 v1 尚未正式发行；下文 M1-A 的 schemaVersion=2 开发契约已冻结为本批设计基线，尚未实现或实测。最后更新：2026-10-20。

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

## M1-A v2 开发契约（当前代码未接受）

本节是 M1-B/C 的实现输入，文档采用 `format="sceneweave"`、`schemaVersion=2`；工程容器采用 `containerVersion=2`、`profile="m1-assets"`、`packageMode="complete"`。它与上文 v1 是独立的严格 Schema，不能向 v1 塞入未知字段、更换 profile 冒充兼容或在导入时丢字段。当前 src/core 和 IO 继续只支持 v1；冻结设计不代表 v2 文件已能打开，预算也不是性能实测。修改本节基线须同步06、14及验收，不在实现过程中暗改含义。

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

ScatterGroup字段固定为id/floorId/editLocked、visibility、domain、palette、seed、algorithmVersion、gridOriginMm、cellSizeMm、densityFactor、minDistanceMm、rotationRangeDeg、members、exclusions。domain是 `{kind:"area",areaId}`、`{kind:"path",pathId}` 或 `{kind:"edgeBand",edgeId,widthMm}`；palette为 `{key,propDefinitionRef,weight}` 非空数组，weight为正整数；key在palette内唯一，所有propDefinitionRef固定版本。algorithmVersion首批为scatter-cell-v1，seed为1～128字符文本，gridOriginMm为世界整数原点，cellSizeMm/minDistanceMm为正整数，densityFactor为[0,1]，rotationRangeDeg为 `{min,max}` 且0<=min<=max<360。

members按稳定candidateKey索引，每项为 `{propId,state,overrideFields}`；state为managed/manual/deleted/detached。managed/manual必须引用真实Prop，deleted/detached的propId为null，作为永久抑制记录；manual的实际值仍仅存props。exclusions为 `{id,boundaryMm,reason,sourceCandidateKey}` 数组，sourceCandidateKey为文本或null，reason为manual/delete/entrance；boundaryMm是固定世界简单整数多边形，不因域变大或密度变高消失。

scatter-cell-v1使用固定世界网格，以“seed命名空间＋带符号列号＋行号”形成candidateKey（为SHA-256(UTF-8(JSON.stringify([seed,列号,行号])))的64位十六进制摘要）；定义选择、单元内位置、旋转及密度筛选均从该key的确定性hash子流取样，按稳定候选顺序做间距/占地筛选。densityFactor只改变采纳阈值，不能重编号全部候选。seed、网格原点和cellSize在既有组的普通密度重生成中固定；更换这些参数是显式“重建候选网格”，仍继承全部世界排除区和人工物件。hash子流固定为SHA-256(UTF-8(JSON.stringify([seed,列号,行号,channel])))，channel仅density/x/y/palette/rotation；取摘要前13位十六进制为整数除以2^52，得到u∈[0,1)。候选保留条件u_density<densityFactor；单元内位置为gridOrigin+(列/行+u_x/y)*cellSize后按最近整数mm量化，恰半向远离0；旋转在保存范围内线性插值并量化至0.001°，随后按模360归一化到[0,360)，360回到0。palette按key字典序按weight累积分段选择；候选按行号再列号升序筛选，实际占地须完全在域内且不碰排除区，物理矩形间距至少minDistanceMm。采用过程须将具体测试向量记入M1-B证据；改变上述输出即新算法版本，不在开档时迁移随机结果。

采用时完整保存所有Prop、候选key、seed、算法/定义版本、参数和排除记录，加载从不重撒。手动移动/替换/改占地把成员标为manual；手工删除把成员标为deleted，并保存删除前旋转占地的保守世界轴对齐包围矩形（最小值向下、最大值向上取整到mm），再按minDistanceMm外扩为世界排除区。人工划区/入口保留也保存世界排除区。退出组时保留普通Prop，并将原key标为detached，避免生成第二份。

重新生成先产出候选；只可替换仍managed且未锁定的成员，保留manual、deleted、detached和所有exclusions。锁定成员不在重生成影响集合中，其位置作为间距障碍；需要修改锁定实体时整批失败。排除区禁止新候选占地相交，删除的key即使落点改变也不得复活；人工覆盖移到域外可以保留并提示，但其支撑/场景硬约束仍须合法。缺失算法版本时可继续编辑已存实例，禁用重生成并说明原因。M2的ScatterProps只能新增组与Prop，不能用此机制重写旧组、清除删除记录或解除锁。

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

M1新手工领域能力不扩充M2的AI权限。05仍定义11个白名单操作；AI不可直接改地形高程/轮廓、定义快照、秘密、锁或旧散布覆盖，不可发送任意JSON patch。M1/B的字段完整性、几何校验和可编辑样板也不自动代表占地寻路求解器已经完成。

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
