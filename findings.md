# 发现

## C1d设计输入
- v3 CompleteProject读者严格检查顶层键；新历史身份必须有独立读写入口，不能将带额外元数据的工程交给旧IO。
- 原生v3 SceneDocument已表达本批所需完整几何/用户层；命名历史与lineage是工程级元数据。本批保留documentSchemaVersion=3，显式升级工程containerVersion=4，采用新profile和独立数据库。
- B4取消解码旧探针等待一次crop完成仍不足：对话框/忙碌提示导致视口尺寸再变，160ms后可重启预览。预览始终使用当前工程原Blob，ZIP导入产生不同Blob；按身份隔离真实导入的计数可直接覆盖目标生命周期而避免重绘干扰。
- 外观字段首批为definitionRef、appearance、visualBoundsMm、shadowClass、shadowOverride；位置/旋转单独一组。已有和历史对象均须无组合/散布/锚点注记恢复依赖。重建已删除对象显式使用完整实体、原层及现存合法支撑。
- 恢复保护会先进行异步flush/校验/落盘，生产UI采样须等工作台忙碌标志清空，再检查已保存和画布状态；仅看到旧“本地已保存”不能证明新采用已经结束。
- 最终C1d仅有功能/正确性、4K等价、秘密配对、离线和CAS证据；未运行历史资源峰值或全流程性能。25/26选择性能结论不自动推广到v4历史全流程。

- 起点 main / 62ba55b，本地 C1a/C1b 与路线改动尚未提交；版本 0.2.0-m1-c1b。
- 历史 C1b 四组框选底图绘制次数不变；单次最大 rAF 间隔 500 为 116.7ms，2000 为 283.4/350.1ms，不能作 p95。
- SceneLibrary 每次重建全部物件按钮，各行用 selectedIds.includes；全选时比较量接近平方。
- SelectionInspector 分别计算多种操作权限，每次 normalizeSelection 重建整图索引/绘制排序；锁提示逐实体扫描组及注记。
- 覆盖层在 useLayoutEffect 同步逐对象绘制，尚需与上述计算分开计时。
- C1c 既有设计：每个可编辑内容实体恰一层，组及成员同层；系统绘制带内排序，完整副本迁移，不改变高程/秘密。

- 性能优化前 production 构建已成功并保全于 work/selection-baseline-dist。测量工具代理只写 tools/performance；core代理只读准备，尚未开始C1c实现。
- 当前production base为 /sceneweave/，性能runner需兼容此前缀。

- 正常生产baseline study500三轮框选release→双rAF p95约45ms；study2000首轮213.7ms、替换495.9ms，长任务与排队明显。后续轮超时导致整个baseline非成功，已保留，不以完成四轮代替完整批次。
- 优化后27项定向单测与构建通过。下一步baseline独立CPU诊断再后测。

- 独立V8诊断样本767ms中program406ms、idle248ms；压缩JS热点无法凭此精确归因，保留cpuprofile仅诊断。列表补content-visibility跳过屏幕外行内部布局/绘制，DOM/键盘行保留。

- verified完整基线/第一轮后测均为12轮；500框选显示代理51/53→45/45ms，2000为193/186→128/120ms。2000多选改单选531/523→483/513ms，残余长任务未闭合。
- 全局styles.css button含 background/color/box-shadow 150ms过渡，选中样式同时变化2000行可能导致动画成本；需时间线/隔离验证。
- 新设计：完整文档不变；轻量选择会话独立订阅、列表仅可见行、属性按需、选择覆盖层分级；编辑预览按投影像素LOD，正式输出维持完整。
- 时间线隔离诊断（小样本、非正式成绩）：旧优化版control双rAF框选/改单选约160/144ms，隐藏列表约32/33ms，关闭按钮过渡约53/44ms。list/transition显示路径与残余成本强相关，待无trace确认。
- 用户共同属性改为展开后计算；摘要只读数量/类型/锁/AABB；超过256显示总范围与原子事务限额。精确命中/实际ID保持完整。
- 视口精细层使用独立crop canvas覆盖底图；每次全原投影校验与解码，取消迟到结果。不在selection依赖中重画底图或crop。

- C1c原生墙排序会影响miter所有权；必须按真实可见墙集合与层序算选择，而选择范围currentOnly只过滤候选，不能改变画面几何。点选/框选/控制轮廓/摘要均复用native墙多边形。
- 原生v3私密/资源/迁移/CAS矩阵已验证，默认迁移四组4K受众输出与v2零RGBA通道差异。空组GM注记和显式false/null来源等边界已修。
- 跨门异高连接仍受既有厚墙支撑和Room中心线范围合同限制，本次仅用合法B3连接作渲染/选择证据；Room分支是防御性隐藏闭包单测，不将不可构造夹具作为实际能力。
- 最终v3同四组720选择样本无LongTask，双rAF框选p95约32ms，与v2最终对照相近；DOM p95略增，未作函数级成本归因。全交互/资源峰值/跨浏览器仍开放。

## C2 起点
- main/2e14885 干净，C1与部署已提交推送；用户明确授权C2，按07的建筑绘制/共墙/门窗/量尺及结构恢复实施。
- 原生v3 SceneDocument已能保存房间/顶点/墙/门窗/注记；v3命令复用v2几何但缺创建建筑/开口入口，层归属需覆盖所有新增/拆分实体。
- 当前v4身份严格version1，仅对prop分配非复用出生token。结构恢复不能假装已有结构出生身份；设计必须明确复活/ID冲突边界及是否需要独立版本迁移。

- C2秘密房间遵循现有Region.kind=manualMask固定矩形合同；新增注记/遮罩命令使用现有字段，不新增场景schema。注记锚点递归锁与循环/悬空校验，删除被引用实体拒绝；玩家缺覆盖继续拒绝出图。
- 结构出生身份不在严格v4 identity v1中。本批结构恢复采用不可伪造会话连续性证明，命名/保护快照需在本次会话建立；重开/导入/拓扑变化后拒绝该恢复，不推断删除重建为同实体。后续持久恢复需显式版本迁移。

- C2全部Chrome132项在最终源码状态同批通过，避免沿用C1c/C1d的分批证明。正常产物双室验证r6→r7→r8→r9，所选历史包18位图/许可与邻室后改名保持；390px面板纵排且无横向溢出。
- 世界范围调整目前按全Floor锁及实体数+1保守计费，已有256实体可能拒绝扩大范围；该限制与仅同会话结构连续性都必须在28保留，不将有限恢复写成持久结构身份。

## C3设计起点
- C2源码31项及正常产物43项与docs28指纹一致，baseline main/2e14885，C2未提交。历史13/17–28及所有原证据不可覆写。
- 当前场景v3已有物件/材质/组合/层及有效外观字段；v4工程信封仅prop身份。C3需新工程信封/严格读者/来源闭包/组合身份，保留v3有效场景与native renderer。
- C3首版有限外观参数：tint（颜色或null）、brightness（0.25–2）、opacity（0–1）、shadowClass（仅物件）。逐项覆盖enabled，优先级固定源→当前层→实例/成员，非支持目标整笔诊断拒绝；更换外观不改物理/支撑/秘密。

### C3 implementation/verification findings — 2026-10-22
- Native strict v3 requires every image prop/template to have a fixed definition and every asset to have a scene/definition consumer. C3 therefore preserves non-active derived/ancestor images with immutable retained appearance definitions, not by deleting bytes or relaxing the native format. Actual Chrome originally reproduced UNUSED_ASSET after a second color version; the source-root fix resolved the real pixel/disable/remove tests.
- Strict v3 SurfaceStyle base.opacity stays 1. Props support opacity 0–1; styled surface scopes/layers with opacity below 1 reject atomically. Theme shadowClass does not override fixed source shadowOverride. These finite limits are now explicit in UI/contracts/report29.
- Room/wall paint restoration uses C2 session continuity evidence; no persistent room/wall birth identity was added. Terrain/path/edge/connection and scatter restore dependencies remain C4.
- A complete full-suite run passed 70 files/837 unit tests. A complete Chrome regression passed 145/145 (11.3m). After an App handoff callback fix, the final C3 cohort passed 14/14; source fingerprints before the narrow navigation fix are retained separately. No whole interaction performance inference is made.
- Final review identified that public prepared-import candidates must not serve as arbitrary in-place scene edits. Workspace ingress is being restricted to catalog/resource additions; command-prepared edits remain private and retain finite command/lock validation. A native V5 two-tab CAS check is being added, since old V4 Chrome evidence alone is not V5 evidence.
- All 666 protected historical reports/evidence match the C3-start hash. todo.md acquired unrelated edits during the task; the task never rewrites/restores that file and excludes it from this task's whitespace check rather than changing user content.

### C3 最终验证结论

- 上述实施中记录由最终结果补充：70文件839单元通过；全量Chrome145通过后，最终C3专项16项通过，含真实v5原生双标签revision与保护点metadata CAS。不同源码批次分别保留，旧v4证据不替代v5实测。
- 公开已准备候选入口已严格限为目录/资源追加；现存场景、身份、锁、私密和覆盖不能变化，旧资源/许可不能修改或移除。编辑命令经实际有限命令准备后走私有注册，没有公开可信标记可绕过。
- 正常生产页面没有开发API；空白→放置→调色/亮度→命名→再改色→单物件外观恢复→完整重开与下载均通过。实际派生像素、完整包hash/许可、GM/玩家4K及390px布局都有独立产物；完整报告29。
- 目前仅建立C3有限切片的适用证据。表面底材不透明、固定源自定义阴影优先、组合无嵌套/结构/散布、结构恢复会话连续性、256条原子预算继续有效；C4/C5与M2、完整视觉及全交互性能仍待后续。

## C5 性能超时定位

- `work/c5-20261022/performance-final/island-2000-run-1-partial-failure.json` 的失败动作是`restore-protect-adopt-save`。failure evidence 显示页面最终 revision 从29到30、`domainCommittedAtMs`、`savedReadyMs` 和 `displayProxyMs` 均已记录，且无 pageerror、request failure 或产品错误；耗时从可信 click 到显示代理约60.8秒，期间有7.2秒级、7.5秒级长任务。原错误是Playwright等待窗口60秒到期。
- 运行器增加`--wait-timeout-ms`，默认值和旧批次口径保持60000；新正式批次将显式180000并写入manifest，单轮15分钟看门狗不变。新批次必须单独目录并与旧失败目录并存，不能把混合runner哈希的结果直接伪装为同一批。

## C4 准备：现场基线
- 当前main/8fcf8ed已包含C2/C3，origin/main本地跟踪也在同一提交；远端是否一致另作只读核对。C3报告29及v5 core/editor/io已在仓库，旧计划的未提交状态为当时事实。
- C4路线现列地形轮廓/高程/覆盖、来源边缘、连接、道路支持子集、散布和人工覆盖恢复；C3严格v5仅持久prop/prefab出生身份，室外依赖恢复须审阅现有合同后明确范围。

- 已只读核对真实远端main为8fcf8ed835778da59fcf564a39ae9c5c0b2d7303，与本地一致；不据此推定Pages部署结果。当前276份源码/测试/配置及45份正常构建产物与C3最终指纹完全一致，11份reporter/日志归档压缩与解压hash均一致，4份生产工程ZIP CRC/条目hash一致。核查记录放独立m1-c4-preparation，不修改C3历史证据。
- C3记录为70文件839单元通过、较早全量Chrome145及最终专项16分别通过，不能合并为同批最终全量。正常生产UI记录passed；本轮仅复核记录/字节，没有重跑测试。
- SCN-03风桥基线明确为同平面2000mm净桥带，溪流上下段主动留口；不需要用高差连接或第二层支撑面伪造桥。量尺三段6000/4000/6000mm、两端2000mm净接入与原始Region/Prop/Note验收保持。
- 旧散布重生成以candidateKey派生确定prop ID；v5持久物件墓碑拒绝普通ID复用。密度降低删除后再升高可能触发身份冲突，C4需优先设计candidateKey与新生prop ID的区别并实测，不放宽墓碑。
- 首次按旧asset-renderer文件名搜索无结果；实际renderer路径为src/render/v2/renderer.ts与v3/renderer.ts，已按rg --files纠正。
- 两路只读审阅完成：通用创建工具、来源段重映射和道路真实投影/Canvas/选择/隐私链路是主要缺口；VIS-02辅助含样板特例，不能直接推广。散布身份问题仍为静态风险，未运行复现。
- C4建议按可跨重开的室外命名恢复设计显式新工程身份合同（拟议v6/identity3），先冻结04/06和独立完整副本迁移；有效场景仍可用严格v3。旧v5室外快照不补造身份，C2建筑仍仅会话恢复，旧物件/组合token及来源链保留。
- docs/30将默认外观与显式历史散布成员/关系恢复分开：默认保持manual/deleted/detached、全部当前exclusions和后续新增；关系恢复逐项列出真实实体、出生身份及抑制变更，不运行seed替代历史、不清空后续人工记录。
- SCN-03用途/危险Region入口需补，桥的同平面基线与6000/4000/6000mm量尺保持；高差技术变体另测，P2/P0素材状态及完整路径/全交互性能继续据实记录。

- C4首轮真实Chromium为3过9失败：3道路夹具负角度违反既有严格合同；4存储夹具把新外观派生与固定组合放同一准备批次；1高差拒绝提示实际为“高差边界必须为阻挡移动的 cliff”而断言未匹配；1退出成员按既有合同propId置null但独立Prop保留，预期误认为仍归组。SCN-03技术基线、跨重开恢复、显式道路/台阶已通过；失败不汇总为通过，夹具修正后独立复验。

- C4正常生产入口`/#outdoor`实测完成空白16×12m、真实草地/道路/散布、r6重开后地形geometry恢复为r7且道路后改宽度/散布物件保留、单保护点、明确所选历史包、双受众4K及390px布局。单元替身不代替该生产证据。完整Chromium delivery批次仍在运行。

- 已目视本轮正常生产的桌面恢复、390px重开以及GM 4K截图。恢复侧栏列实际依赖/跨层和before/after；窄屏垂直布局无横向溢出；树冠/草地/道路均在实际图中。生产道路仅显式Floor支撑，多支撑保存由C4专项Chrome独立覆盖。

### C4 最终证据边界

- 最终同版源码969单元、正常构建、162真实Chrome及最终生产UI全部通过；C4 14项是162内的子集。早期专项12过、早期全量161/162和初始夹具失败独立保留，不拼接不同批次通过数。
- 最终生产包425377字节，SHA256=828ffc320dc72add05ec89a179bbfba9770d15cb4244ec0df2b5981d486fbd23；当前/重开contentHash=9b7857c486f15d7d002c590d620a45527ab32e3d6544c9975044bc7d978335b7。生产场景全部公开，双PNG相同；真正秘密配对、资源拒绝和独立公开参考由C4 renderer另证。
- SCN-03仅30×24m原Region/Prop/Note技术基线：同平面4000×2000mm桥带、两端2000mm接入、6000/4000/6000mm实际量尺、有限通行正负例及两条GM线索双受众4K。仅1件P2石头，无完整营火/帐篷/灯架美术，不关闭完整SCN-03/路径/小团。
- 保护基线705份历史文件、todo原hash及371份冻结源码/48份正常产物已独立机械核对一致；24份无损归档、3 reporter、21附件与8份生产包CRC/资源/许可/内容hash通过。791本地引用、12锚点、213表格及67项QA引用有效，本批凭据/私人资料目标模式无命中。全交互性能、持久建筑/任意拓扑恢复、P3和C5联合矩阵不由C4通过推定；下一入口C5，本轮不开始、不提交推送。

## C5 起点

- 用户已授权C5联合验收。当前版本0.2.0-m1-c4、main/8fcf8ed，完整C4实现/证据及准备文档均未提交；保护它们和todo，不回退到HEAD。
- C5依据07应在同一v6工程混用建筑、室外、组件/参数、图层、选择/菜单/键盘，再验迁移/所选历史/离线/保护与保存故障/双受众，最后以500目标/2000压力串行测量；旧选择专项不代表现版本全交互通过。
- CONTRIBUTING总述与部分末尾段落落后C4；本批一并同步，不改旧报告或证据。首次文件清单搜索包含不存在的scripts目录，仅工具路径未命中，后续按rg --files实际tools目录操作。
- 正常v6只有data-revision/完成raster等DOM观测，无法精确拆出异步准备至领域完成。新增会话lastTransaction {sceneId,revision,committedAtMs}由Workspace全部校验/身份/历史更新后、通知React前采时；不持久化、不暴露工程内容，root DOM只给revision与时间。输入捕获至该时间才用于100ms领域目标，DOM/raster/保存另列。
- C5诊断2的500书房普通编辑从真实Enter至领域完成2174.2ms，重排2149.2/2465.6ms，采用682.9/765.8ms，恢复含保护5230.4ms；仅低次数诊断，不能作p95正式结论。选择显示33.7/23.8ms、隐藏约80ms，明显慢点在v6持久事务链。静态审查列普通execute至少4次完整v6资源/内容验证、7次全图resolve和多次clone；下一步先CPU profile确认，再按严格内部身份认证减少JSON重复，资源真实字节/许可/解码等检查不可省略。
- 性能候选口径为四组B5原包经正常UI完整升级v6，每组3新Chrome；每轮30框选/30替换、30平移/20wheel、10物件编辑、10隐藏/10重排、5有限层参数、3命名/恢复、冷开/重开及双4K。小层1–8成员避免违反256预算；先诊断后冻结正式口径，未运行不记录通过。
- 诊断3的CPU profile已完成且单列诊断开销，确认普通编辑中出现重复v3严格解析/有界JSON/组合内容求值和完整迁移原件ZIP。内部复用仅接受严格解析后自有深冻的确切document＋historyIdentity＋appearance组合，不能凭同revision或外部Object.freeze命中；资源与来源链每次仍独立捕获、预算/hash/许可/真实解码检查。普通execute合并准备/采用路径以去除中间显示预览的重复校验，正式是否达标仍待复测。

### C5冻结与无profile诊断4

- 最终349份源码/测试/工具/配置在2026-10-22T16:19:38.248Z冻结，版本0.2.0-m1-c5。单元979/979和正常构建通过，最终全量Chrome单worker串行执行中；正式期间不改受测代码或产物。
- 单study-500诊断4的普通领域提交1110.4ms，较诊断2单次2174.2ms下降约49%，仍超过100ms。恢复4733.4ms且完整显示/保存代理约8454ms；不能由选择约32ms推定整个交互通过，也不能把低次数诊断当正式p95。
- 目前安全优化仅减少内部严格JSON重复与普通编辑重复预览采用边界。实际资源/许可/原件链每次仍检查；下一轮若要调整检查粒度，须先设计可验证的资源/来源不可变边界与失败恢复，不能直接跳过校验。
- 正式矩阵进行中的9轮结果和CPU诊断方向一致：普通提交与保护恢复仍慢，500目标不能凭选择专项通过关闭。最后三轮island2000仍须完整执行；最终结论按12轮manifest、分组/每轮分布和实际资源峰值记录，C5功能通过与性能未通过分开交接。

### C5 归档结论，2026-10-23

- 三个正式性能批次均失败，失败原因不能合并为一个产品p95：原始批在`island-2000-run-1`等待超时，第一次补测在853553ms宿主wall gap中断，第二次补测在898445ms宿主wall gap中断。原始批探针虽最终记录revision 29→30、保存和显示代理完成，仍不改变等待超时事实。
- 当前可用事实是：原始正式子集9/12轮、1332条完整样本；补测各自只有2/12和0/12轮；三批合计11轮/1628条完整样本仅作库存清点。失败partial不进入统计，独立summary不存在；所有批次都保持`completeFormalMatrix=false`和`performanceGatePassed=false`。
- 唯一冻结源码偏差是`tools/performance/run-c5.mjs`的可配置等待时长；原始声明hash、当前hash/字节和理由均写入delivery-config及独立归档。其余348份冻结源码一致，不能将当前runner字节标为原始runner。
- 机械证据链的职责是证明记录完整、资源/许可/包/源码/历史保护核查通过，不替性能门背书。C5功能回归、构建、全量Chrome和最终生产UI可以关闭相应功能子项；性能门与完整M1仍开放，不进入M1-D/M2。
- 最终机械链已实际通过：349份源码（348未变、1项明确runner例外）、48构建、826历史及todo原hash、35原始归档/6reporter/24附件全部核对；三批性能原始树/失败字段/日志缺失或空日志分别保留，8时延字段按case/run及9行perRun独立复算。892本地引用/12锚点、230表和67项QA无问题；目标凭据模式无命中，任务空白检查通过。allPassed仅表示证据与文档完整性，不能改变性能失败结论。

## C5 性能第一批设计，2026-10-23

- 普通execute在prepare输入和materialize输出各完整验证v6；显式预览注册/采用再追加；save还有独立完整验证和持久迁移保全。每次包含v3依赖/许可/预算、每图字节CRC/hash/原生解码、变体实际像素、v5→v4→v3→v2/M0原件导入。捕获/物化的structuredClone会丢失对象引用资格，是安全复用前须改变的边界。
- 第一批采用模块私有WeakMap签发自有资源三元闭包（assets/licenses/licenseBindings），仅完整验证成功后的独立捕获对象可获证并深冻结，Blob也冻结以防方法/size/type覆盖。每候选仍走完整领域/依赖/许可对应关系与预算；默认validate、导入/导出/冷载入/保存继续全验，内部新入口仅复用确切注册闭包，任何对象替换回退全验。变体像素仍逐次检查，本批不缓存变体或位图。
- 迁移原件独立认证为自有冻结完整链，绑定目标sceneId并检验所有祖先唯一；换target重新校验，不凭sourceHash/scene revision或外部Object.freeze取得资格。捕获前检查普通data字段、描述符/原型，拒绝隐藏/symbol/accessor、循环与Blob方法覆盖；异步期间只验证捕获内容，取消/失败不签发。
- 冻结前正常dist的study-500独立生产诊断已串行完成；新目录保留10次普通编辑及其他低次数流程，后续按同方法对照，不混入32正式失败矩阵。存储事务CAS、资源/原件冲突比较、保护点及失败回滚本批保持原实现，保存权重与后续优化分开。

- C5资源复用第一批实测：同方法study-500各10次普通编辑，领域中位1118.6→325.0ms（减少70.95%），诊断p95/最大1817.1→858.7ms；第一笔858.7ms包含认证，后9笔275.4–380.1ms。当前每笔仍超100ms。画布中位1190.5→414.8ms；保存与显示代理尾部变慢，保护恢复仍约13秒，不能以领域收益关闭全交互性能。20项适用真实Chrome及992单元和正常生产UI通过。后续先分段定位剩余领域/保存/恢复成本；完整正式矩阵另启新批次。证据归docs/33。

## 性能暂缓决定，2026-10-23

- 用户明确要求先commit/push现有成果，余下性能优化暂时记录，其他需求做完后再集中处理。此安排替代上文各批当时“先性能、不进入M1-D/M2”的开发顺序，不改变性能未通过、正式验收和数据保护要求。
- 新增docs/34集中记录领域仍超100ms、保存/显示长尾、约13秒保护恢复和未完成正式矩阵，恢复入口为新版本分段诊断与独立完整测量。后续功能按07和实际任务授权推进，本轮不开始新切片。

## M1-D 海岸哨所初版，2026-10-23

- 用户“做”授权混合追加素材＋海岸哨所可编辑初版。起点main/5589464与origin/main一致，仅todo.md独立编辑；memory快查无Sceneweave条目，沿用planning-with-files。
- 08规定SCN-04为36×28m、1000/3000mm低高台地、两室共墙、院子道路、唯一显式台阶及补给/灯架。15的dirt-gravel、crate/supply-rack/campfire/lamp-stand/tent与补给组仍P0；旧双样板素材保持P2，不能代签P3。
- 采用现有原创SVG→真实Chrome栅格化→静态sRGB PNG与manifest/许可管线，独立新包；不改旧素材、格式和性能策略。当前v6具备命令/身份/恢复及完整IO，先复用再根据真实场景修复缺口。

- 独立审查找到既有工程显示设置和房间换地面材质入口缺口；新增setSceneDisplay仅修改现有units和presetSnapshot.distanceMode/gridSizeMm，保留固定preset身份/来源及毫米几何。v6预览/撤销/保存共用原子事务；坐标继续mm，量尺及范围按m/ft显示。
- 增加整面墙两端同笔平移入口，预览复用完整建筑依赖/锁及256展开预算；不增加建筑持久身份、通用拖拽或拓扑恢复。哨所有限门口/道路/台阶检查明确不替代全图寻路。

- M1-D实际修复与边界：固定源tint必须经materialize采用真实派生PNG后才可交付完整v6；隐私变体b中心Y9000，旋转图像/offset+4blur在08原固定mask内，未扩大遮罩。有限通行对未知版本/缺设施明确失败，UI不能用空集合every判断成功。灯架含GM锚点注记，按既有规则拒绝仅外观局部恢复；验收改用独立营火，灯架秘密保持。混合外观/普通命令仍分笔事务。
- 当前v6目录34PNG/23物件/11材质/3组合，旧固定物件/组合和v6材质定义deepEqual保留；新增6件102296PNG字节保持原创P2。直接原生blank保留创建sceneId/time，无伪造迁移。房间两处门净宽1200/1000、道路2m与台阶2m分别有限检查，不等于全程2m路径或转角搜索。
- corrected四项4/4后，全量85文件1008/1008单元通过70.806秒；冻结应用/工具/测试/配置/实际素材446文件，正在执行全量Chrome。本批不运行性能专项。

- 最终本批原始证据归docs/evidence/m1-d-outpost、报告35。全量175Chrome与1008单元通过，正常生产只用UI/下载字节，未调用src或开发API；保护恢复几何保留后续物理/外观与秘密，空库离线历史闭包和五次固定mask配对均有独立真实记录。完整SCN-04从空白尚缺全套布景，不把结构与样板旅程拼接成完整验收。25545数据/资源检查和536归档确切字节核对通过，历史1188文件和todo保全。

## 统一工作区与素材库讨论，2026-10-23

- 侧栏消失原因已由App路由确认：六个开发代际是六套整页工作台，默认旧geometry；v6自身又将场景/图层与素材等作为左栏互斥内容。02原设计已要求共用画布/会话；建议以v6能力提取稳定工作区，右侧保留属性及图层/对象/历史。
- 物件/材质/组合已有固定tags和简单搜索；用户导入可填标签，但缺入库后打标、批量整理、颜色筛选、缩略图和个人全库。现有VIS/SCN/P2标签不适合普通检索。固定定义含tags，个人整理不能原地改义，建议独立目录元数据并明确备份；工程增加持久字段须显式新版本。
- 空白工程预装全部三包资源；扩容应改为目录索引/缩略图与采用时完整闭包，离线库可安装主题包。旧工程已采用定义及历史/源链根不能仅因当前无实例而删除。
- 只读盘点work约1.9GiB、evidence约743MiB、tests约924KiB；大证据重复额外至少163MiB。work并非都可删：M1-D独立核查仍依赖原始目录。部署只上传dist。建议临时产物可再生清理、最小夹具留回归、历史大证据另行可复核归档。
- 顺序建议U1首页/工作区→U2素材组织→既有补标与墓地/火山小包→新工作区M1-D全流程→M2，性能继续后置；36为讨论稿，未改07正式路线。
## 2026-10-23 统一工作区示意核对

- 讨论草图保留同一场景画布，左侧切素材/建筑/地形不改变右侧选中对象与图层；浏览素材详情保持场景选择，首页/独立素材管理返回后保留搜索条件。浅深色桌面与窄屏已目视。
- 23项草图检查通过，覆盖模块/属性保持、墓地与灰色交集、个人标签添加与搜索、首页/素材管理往返、折叠恢复、对象选择、320–1024窗口及触摸窄屏无横向溢出；这是讨论草图验证，不是产品实现/回归证据。
- 36讨论稿与文档导航62处本地目标存在，本批空白检查通过。图中墓地/火山条目为示意，未产出或验收新的正式素材；主题包工作不沿用已有旧A1编号，避免和M2历史迁移映射混淆。

## 2026-10-23 统一工作区与素材库准备

- 准备基线HEAD为55894649，应用仍0.2.0-m1-d-outpost；1641份非忽略既有文件已记录hash。M1-D首批1008单元/175Chrome为35旧记录，不是本轮新测；完整从空白SCN-04、SCN-01布景、差异提示、P3和完整M1/性能仍待后续。
- 37明确U1a入口/共同会话→U1b布局→U2a独立目录合同→U2b组织与完整采用→既有补标/墓地/火山→M1-D续→M2。U1无需改当前严格v6/v3字段；精确新目录schema、身份编码、预算、并发和备份冲突先由U2a定稿，准备不假定已有写入器。
- 面板浏览不丢选择/草稿/候选；回首页先明确结束冲突暂态，再继续同一会话而非重开工程。浏览器导航/关闭保护和迟到异步代次须有验收；真实重开/导入/切工程仍按现有C2 witness失效，不能因统一UI扩大结构恢复权限。
- 本轮仅相关文档分工，36讨论原文、35及旧证据、产品代码/测试/配置/素材和todo保持；不提交推送、不清数据、不运行产品测试或性能采样。

## U1a 实施（2026-10-23）

起始基线独立保存于work/u1a-20261023/baseline.json。当前授权首页、统一工程入口和编辑会话；37保留准备历史，性能按34暂缓。

U1a当前结果：原生记录的savedAt是毫秒，v1 scenes为document包装；各库load整行失败会吞列表，故只读cursor发现与完整校验准备分开。当前v6走openPersisted，旧native当前修订新生成完整原件ZIP，四级已有原件仍逐字节保全；不能拿不同时间导出的ZIP元数据要求整包SHA相同。StrictMode effect重复注册必须在实际交付请求时才消费。显式legacy close重置undo/witness，成功导航释放单次source再设置当前handoff。legacy待预览表单按owner跟踪，采用只结束相应owner，不能让不相关即时提交清掉另一草稿。


2026-10-23用户最新开发安排：需求与实现优先，每个切片仅必要类型/构建和简单定向检查；完整回归等待用户明确通知统一进行。U1a待验证事项归docs/38第5节，之前已运行结果/失败保留，不默认再跑全量或扩大证据归档。


## U1b 起点

37固定布局合同：顶栏工程操作；左窄工具条+资源/工具选项；中央同Canvas；右上属性/外观，右下图层/对象/历史；底栏视图控制。U1a当前左侧混有图层/对象/历史与工具模块，需分离挂载位置而保持组件生命周期和同一会话。偏好仅本机版本化UI配置，损坏/不可用存储不影响工程。范围仅简单验证。

U1b布局pref采用sceneweave:workspace-layout:v1，两个展开宽度+三项折叠，实际窗口压缩不覆写记忆值。视口在resize按fit比重算相对zoom并保持真实scale/中心，触界仍用既有25%–800%与pan约束。左右pane和tab固定DOM，Portal只移动原工具按钮。旧窄屏asset-save display:none需在统一shell覆盖，避免保存状态消失。

## U2 调研与合同取向（2026-10-23）

现有workspace.previewPrepared提供严格append-only目录候选入口，采用继续同一revision/undo/CAS；新库不改场景语义。用只含所选固定闭包的中性v6载体复用实际PNG/派生像素/许可/ZIP校验，明确禁止场景几何、历史及迁移原件入库。个人组织独立CAS，组合必须复制确切prefabAppearanceTemplates及私密性。原空白34图预装保留。

U2最终：内容API以中性原生v6载体复用严格IO；独立catalog v1不改变工程格式。个人整理只有库revision，采用才revision+1/undo；同逻辑异内容连org-only记录也拒绝。完整备份仅选中安装条目，JSON内嵌真实v6 ZIP与许可，不含工程/历史/迁移原件。默认新建仍预装34PNG。完整QA-CAT与旧版/历史/双受众4K/性能后置，不把小单元或两个Chrome旅程升级为全验收。

2026-10-23累计交付核对：M1-D、U1和U2此前相关脏文件共205份；仅todo.md为独立编辑排除。素材实际布局为assets/SVG源与public/PNG，分别按sourceSha256与图片hash/尺寸检查。GitHub接受88.79MiB压缩历史报告但给建议警告；原报告和日志保留，不在提交任务内启动数据清理或LFS迁移。下一开发任务保持既有补标＋墓地小样，随后火山、M1-D完整旅程及M2。
