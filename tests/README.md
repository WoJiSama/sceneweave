# 测试导航与复现

本页只维护测试入口、覆盖范围和运行方法；开发任务归[路线图](../docs/07-roadmap.md#development)，全部验收归[质量计划](../docs/09-quality-plan.md#acceptance)，实际通过、失败、跳过和冻结指纹归[历史台账](../docs/archive/README.md)。发现/加载的用例数不等于执行结果，历史测试数字不在本页滚动维护。

当前产品只保留首页`#home`与统一工作区`#workspace`，正常工程只读写当前完整v1；旧整页工作台和旧文件导入不作为产品入口。首页另有独立的一次性本机迁入工具，使用只读源与隔离目标。未知hash回首页，活动草稿经过离开守卫；实际支持及拒绝范围归04/06。

当前工具入口按[交互与架构](../docs/reference/editor-and-architecture.md#current-task-navigation)定位：生成/地形子任务使用 `workspace-navigation-helpers.ts`，明确受众导出与工程管理重开使用 `workspace-ux-helpers.ts`。UX定向单测为 `src/editor/main/{opening-placement,catalog-categories,entity-label}.test.ts` 与 `src/editor/native-canvas/length-input.test.ts`。入口同步与 `--list` 只证明用例可解析，不代表完整浏览器组通过；旧格式升级流程的历史用例须按归一v1合同另行整理。

复制粘贴、Enter绘图及删除快捷键的正常生产旅程分别在 `clipboard-ux.spec.ts`、`enter-drawing-ux.spec.ts`、`canvas-delete-ux.spec.ts`；`keyboard-narrow-acceptance.spec.ts` 合并1512/900/390px的真实键盘、长候选摘要和备份冷读检查。共用 `keyboard-ux-helpers.ts`，事实来自实际下载完整工程，不使用DEV读取入口；取消候选后须等待真实画布就绪再发后续快捷键。当前范围、冻结与通过记录从[09限定验收](../docs/09-quality-plan.md#keyboard-narrow-acceptance)追溯，不能外推真实输入法或完整无障碍验收。

`complete-journey-ux.spec.ts`在1512/390px通过正常首页新建、真实Worker生成室内、手工移动物件、撤销重做、最近工程冷重开及双受众4K下载，最后从空存储用文件选择器导入真实备份。核对完整条目hash、文档/身份/外观与资源清单/许可绑定；截图覆盖八个模块、首页、候选和导出。另检查新建对话框、帮助与导出菜单的Esc层级及isComposing/229守卫，合成事件只证明处理器逻辑；真实输入法、失焦、读屏和用户P3仍从09独立验收。

核心收束的正常生产补充入口为 `core-convergence-journey.spec.ts`：森林及林中建筑通过真实Worker候选、独立保存、保护后局部密度修改、撤销/重做、目录冷开和玩家4K PNG，下载工程核对真实文档、身份、外观与资源/许可，并重开原工程检查保全。`domain-cancel-ux.spec.ts`共用现行八模块与右侧候选定位，继续覆盖四领域的运行取消和真实迟到响应。这些是定向旅程，不替代09完整领域、视觉或性能验收。

`asset-expansion.spec.ts`通过正常生产页面检查单图名称跟随/手改保留、严格清单ZIP及名称/标定原样采用、空根锚拒绝、撤销/重做、保存冷开和空个人库备份恢复；另检查按需主题加载/所选闭包采用、本工程只读审核与独立本机审核记录、六包真实PNG及十二份可编辑工程下载、室内/海岸样板的实际编辑和玩家4K输出。受影响单元入口为shared `assets/{import-manifest,theme-packs,review}`、browser `assets/{batch-source,image-dimensions,review-content,review-repository}`、content `theme-pack-catalog`及application `workspace/{prepare,asset-batch}`；确切素材闭包检查继续复用`shared/library-content`。冻结生产地址须带末尾斜线，例如`SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5225/sceneweave/`。实际结果和首败/最小复验归[素材台账](../docs/archive/workspace-content-validation.md#asset-expansion-20261109)，不替代美术、完整状态覆盖或P3。

`asset-quality.spec.ts`通过正常生产页面核对真实透明SVG拒绝及完整备份保全、实际16px PNG低分辨率提示、逐件复核后采用、取消重建后确认失效、原文名称与一次撤销，并检查390px复核图片/控件及无提示SVG路径。`asset-quality-helpers.ts`只为测试明确fixture代行逐件查看确认，不改变产品默认值。纯规则/确切确认/应用入口的单元分别为shared `assets/{quality,quality-review}`、application `workspace/{asset-quality,prepare,asset-batch,artwork,atomic}`；AI覆盖现有SVG/调色物化、透明拒绝、复核前不保护/claim及重放一致性，不启用当前创作4禁止的素材能力。真实执行和限制见[初筛台账](../docs/archive/workspace-content-validation.md#asset-quality-20261109)。

`directory-navigation-ux.spec.ts`是需要Vite源码模块的开发回归：只控制目录/容量读取的完成时机和失败，核对搜索失败后游标撤销、迟到分页隔离、容量检查恢复及切工程后的旧结果丢弃；严格内容打开/恢复仍由正常入口检查。它不作为正常生产包或正式存储故障矩阵证据。

`panel-appearance-ux.spec.ts`在1512/390px的正常生产UI核对工程/外观控件实际字体、字号、圆角和高度，截图覆盖七模块与六外观子工具；检查精细采样默认折叠、跨子工具草稿保留，布局设置Esc保留底层候选，以及展开/重置后菜单关闭与焦点返回。预览取消、布局操作和最近工程冷重开后比较完整包逐条目hash，检查页面错误与横向溢出；共用真实下载辅助函数，不注入工程。样式和布局变化配套复查既有三视口键盘旅程，结果归[主题台账](../docs/archive/workspace-content-validation.md#ux-panel-unification-20261106)，截图不能替代用户P3。

`panel-polish-ux.spec.ts`通过正常UI创建有材质的房间，修改铺装目标、纹理尺寸/方向、对齐/相位与局部覆盖，跨子工具和工程/AI模块浏览后核对草稿及展开状态保留，再真实预览/取消并比较完整备份hash。桌面/390px同时核对AI/工程主标题、面板内边距、按钮高度、真实Tab/Shift+Tab焦点、禁用状态及未选工具的悬停反馈；只填本地占位凭据、不点击连接或调用后端。失败反例、修复和同一正常生产包回归见[细调台账](../docs/archive/workspace-content-validation.md#ux-panel-polish-20261106)。

`building-terrain-forms-ux.spec.ts`在正常生产1512/390px核对建筑/地形主要预览首屏可见、键盘展开精确设置、房间与室外草稿跨折叠/模块/工具保留、绘图取消无误提交、候选期间字段禁用、错误恢复，以及两类预览取消后的完整包hash保持；不注入工程或读写测试钩子。既有房间/建筑组用例同步按需展开入口；`--list`仅证明解析。最终同包结果见[长表单台账](../docs/archive/workspace-content-validation.md#ux-building-terrain-20261106)。

`workspace-feedback-polish-ux.spec.ts`通过正常生产1512/390px UI检查长候选的确认/操作可达、非法坐标反馈、真实取点后的绘图退出、新建尺寸错误、VTT组合状态处理器/实际Escape与焦点返回，以及首页无匹配清空后的搜索焦点。390×600另核对末尾尺寸字段、VTT确认框不被固定操作区遮挡，并用Space确认；取消前后比较正常下载完整包逐条目hash，不注入工程。该组配套复查长表单、完整旅程与三档键盘；同包结果、截图及未覆盖范围见[六项整理台账](../docs/archive/workspace-content-validation.md#ux-six-finish-20261106)，不把合成组合事件或VTT预检记作原生输入法/目标软件导入通过。

`complex-workspace-ux.spec.ts`在1512/390px经正常UI生成林中建筑，下载核对2房间、42物件、地形/道路后，检查建筑/地形草稿跨模块保持、同一固定家具按明确支撑放置、新工程创建图层、两对象多选移层取消/采用/一次撤销重做、历史读取与刷新冷开。对取消和冷读比较完整包逐条目hash，移层保留物件/房间/地形；采集生成、保存、编辑、历史及冷开状态与驱动耗时，仅作体验诊断，不能作为正式性能。整合包的首轮11项检查与两项复验及失败保留见[本轮台账](../docs/archive/workspace-content-validation.md#ux-integration-20261107)。

后续素材库/属性面板仅调整CSS，复用上述两份面板spec及三视口键盘spec完成同包回归；同图卡片/详情/空状态截图及正常UI浏览、筛选、勾选、取消放置的完整包保全证据归[素材库与属性面板台账](../docs/archive/workspace-content-validation.md#ux-library-inspector-20261106)，未为样式实现另写镜像测试。

场景导航本轮同样只调整CSS，复用`keyboard-narrow-acceptance.spec.ts`并以隔离正常UI旅程核对对象搜索、图层草稿、历史搜索/勾选和取消快照草稿；固定对象40px、历史48px行高以及完整包保全事实归[导航样式台账](../docs/archive/workspace-content-validation.md#ux-navigation-20261106)。

`terrain-connection-ux.spec.ts`补齐桌面台阶与390px坡道：正常UI制作1.2m高台，画布取点Enter预览、键盘取消/确认采用、一次撤销/重做，以及整页刷新后从首页最近工程重新打开。实际完整包检查支撑、整数毫米净宽、身份/资源与取消/重开hash；测试进程对下载文档检查显式直线净宽通行，不在页面注入工程或调用DEV接口。只关闭[09限定验收](../docs/09-quality-plan.md#keyboard-narrow-acceptance)所列成功路径，不证明完整寻路、曲线或全部失败矩阵。

`terrain-connection-failure-ux.spec.ts`覆盖桌面/390px的支撑选择、错误端点、零宽、第三支撑、显式阻挡及支撑锁拒绝，核对可读目标/解除锁说明、输入和完整包保全及修正后恢复；双页例使用同context的真实UI改名保存触发CAS，直接下载冲突页备份、另存副本并分别刷新重开。跨页CAS保留独立内存分支，不等同采用阶段拒绝同页旧候选；后者由 `src/application/workspace/curved-connections.test.ts` 的锁后旧候选例及原支撑锁例定向检查。完整范围与冻结见[09](../docs/09-quality-plan.md#keyboard-narrow-acceptance)。

`curve-interruption-ux.spec.ts`在正常生产页面生成岩岛，通过CDP真实触控流取消及原生捕获API检查pointercancel/lostpointercapture，并单独检查合成window blur处理逻辑；桌面/390px核对全曲线回滚、捕获释放、迟到松手、重新拖动/Esc、无新编辑Worker及实际完整包/冷重开。使用隔离Chromium与`hasTouch: true`的context，不调用DEV接口或写入数据库。后台切标签不会自动产生原生失焦；合成blur不能替代真实窗口失焦。成功松手预览/采用另有未解决拒绝，具体复现、配置和覆盖边界见[主题记录](../docs/archive/workspace-content-validation.md#curve-interruption-ux-20261106)。

跨引擎主要旅程与768×500/390×844重排在 `platform-ux.spec.ts`，可配合 `clipboard-ux.spec.ts` 在隔离Chromium/Firefox/WebKit运行；macOS WebKit默认Option+Tab纳入按钮，WebKit引擎不代表Safari应用验收。数值字段Esc只取消该字段编辑，表单保留草稿时须通过原取消入口退出；启动画图后先等待设置抽屉实际展开再关闭，画布取点前使用「适应全图」并核对可见范围。`browser-zoom-ux.spec.ts`使用Playwright自带Chromium的隔离临时配置和本地测试扩展，通过浏览器原生 `chrome.tabs.setZoom/getZoom` 验证200%缩放、重排、错误反馈及长候选键盘可达，核对设备像素比/实际CSS视口并恢复100%；不会安装到用户浏览器，也不以CSS缩放抵扣浏览器缩放。两者均不证明真实输入法或VoiceOver朗读；口径与结果从[09接续验收](../docs/09-quality-plan.md#platform-input-accessibility-acceptance)追溯。

`workspace-information-architecture.spec.ts`覆盖新八模块直达、目录临时详情、原选区/草稿保留、右侧唯一候选、查看层与绘制层分离、900/390px单抽屉/焦点、1079/1080/1081px断点往返、独立滤镜区域及旧布局偏好迁移。旧三面板/七模块定位已从本轮受影响的Enter、曲线、历史、素材和整合旅程迁移；使用`workspace-navigation-helpers.ts`统一入口。实际运行与首败/复验归[信息架构台账](../docs/archive/workspace-content-validation.md#workspace-information-architecture-implementation)，未运行的历史专项不因选择器更新而算通过。

## 运行规则

开发期按[最小自检策略](../docs/07-roadmap.md#development-self-check-policy)只运行本次直接相关检查；下列全量/专项命令是可选入口，不是每步必跑清单。完整验收在后续开发完成后按09统一执行。

- 普通Vitest、AI和Playwright测试使用受控输入/provider，不调用真实付费模型。真实模型验收必须另行明确发起，未知计费请求不自动重发。
- 完整浏览器回归前冻结源码并启动同版Vite。运行中修改Workbench可能使带时间戳导入和测试无查询导入得到不同会话，不能把该环境失败解释为数据丢失，也不能用定向通过拼成全套通过。
- 正常生产检查先运行正常`npm run build`，从dist的真实UI操作，不使用DEV钩子、源码导入或存储注入。浏览器、测试、构建与正式性能串行。
- 每轮使用新的输出目录，保留首次失败、修复及复验。默认产物位于忽略的`work/`或`test-results/`；可用`SCENEWEAVE_EVIDENCE_DIR`指定生产检查目录。
- 同轮本机冷重载检查完整内容hash；独立导入会分配fresh身份/revision0，不要求导入前后整包hash相同。图像仍按实际像素、秘密过滤和资源闭包核对。

基本命令、浏览器安装、系统Chrome及三引擎配置见[贡献说明](../CONTRIBUTING.md#当前主路径回归)。完整回归不在日常文档或低影响修改时重复运行。

<a id="t3五地貌与路线专项2026-10-26"></a>
## 按能力选择检查

| 范围 | 主要入口 | 关注边界 |
|---|---|---|
| 单一完整工程与独立迁入 | `development-import`；shared `migration/development-project`、browser `storage/development-import`；`tools/testing/current-project-production-smoke.mjs` | 旧1–8只由独立迁入解析；全部分支/pin/原件/个人素材精确key保全、目标冷读和独占发布；浏览器用隔离夹具与真实Canvas/IDB/locks，生产脚本只通过UI创建/编辑/下载/冷重开，不读取用户旧库 |
| 通用生成编排与空间 | shared `generation/orchestrator/stages/space/natural-adapter`；`base-map`浏览器registered profile例 | 强类型临时产物、精确步骤输入/版本/基数/Floor、阶段私有文档/写域/失效事实拒绝、实际预算/取消；真实支撑/旋转占地/全厚墙门边界和有限同Floor二维预留区检查；自然适配Worker/HTTP完整结果一致，该组不证明室内/洞穴/混合生成能力 |
| 领域公共执行链 | shared `generation/execution`；browser `generation/client`；service `generation`；application `workspace/interior/forest/volcano/mixed/generation-local`；生产`local-generation/mixed-generation` | 四领域exact shared结果/产物/阶段/报告、规范化与请求/基线/代次/严格hash/profile；Worker/显式HTTP能力协商、真实字节/超时/取消/清理/无重试；公共新建与当前目标，主机资源全验、假候选采用重放拒绝、保存冷读与保护/CAS/一次撤销。浏览器隔离上下文验证真实Worker，未使用用户库或模型；正式矩阵仍留09。 |
| 有限混合与支撑建筑 | `mixed-generation`；shared `generation/domains/mixed/mixed`、`interior/supported`、`building-port`、`local-volcano-mixed`；application `workspace/mixed`；公共Worker/HTTP同源用例 | 真正terrainArea高程支撑、真实门的方向/净宽和连续穿门转角、植被避让及原火山路线/连接不变；组合/子模块归属和累计预算、旧室内hash保留、跨模块只读依赖与人工删除保全。真实资源/完整包/冷读、新工程原件保全、私有见证/取消/旧基线/冷读失败，以及局部保护/采用/一次撤销重做；生产浏览器使用隔离上下文和正常dist UI，不读用户数据。完整混合故障/多种子/像素矩阵仍留09。 |
| 参数化室内布局 | `interior-generation`；shared `generation/domains/interior/interior/connectivity/furnishing`、`terrain-generation/building-ownership/integrity`，application `workspace/interior` | 可变数量/面积/邻接与实际走廊净宽、严格矩形形状/共享墙、确定性与失败分类；真实门/全宽路线、关闭门/家具堵路与禁门关系反例、面积/用途自适应家具/缺项；真实归属/出生/人工/删除/拓扑，完整资源、预览不写入、同会话重放、独立保存/冷读和失败保护；浏览器纯UI改参失效→保存冷开→删除家具→再冷开不补回，未使用用户库或模型 |
| 森林空地与真实植被 | `forest-generation`；shared `generation/domains/forest/forest`、application `workspace/forest`及`terrain-generation/integrity` | 显式林区/空地/入口/折线路线、真实支撑/全宽/完整足迹与绘制保留、固定三通道、目标/实际缺项；现有支撑/阻挡/高差失败、逐产出归属与普通单件预算、人工移动/删除及原成员保全；完整资源、候选重放/独立保存冷读/包及失败保护；隔离浏览器纯UI改参→保存冷开→删树→再冷开不复活 |
| 火山结构与危险表现 | `volcano-generation`；shared `generation/domains/volcano/volcano`、application `workspace/volcano`及content `volcano-blank` | 实际低火口/平台、足宽连接/路线、火口/流道改参、显式阻挡/第三支撑拒绝、材质与物理独立、人工危险修改删除/归属；完整资源候选、重放/独立保存冷读/完整包及失败保护；隔离生产浏览器纯UI改参失效→保存→原工程保留→冷开 |
| 受限局部生成 | `local-generation`；shared `generation/local-interior/local-forest/local-volcano`、application `workspace/generation-local` | 当前真实几何、受管字段/槽位、fresh出生与人工移动/删除/退出/锁/外观保护；火口同拓扑与依赖冲突拒绝；完整写集/只读依赖、完整元数据普通256、私有重放/保护/CAS/取消/旧基线、一次撤销/重做和保存失败保全；隔离生产UI轮廓预览→改参失效→采用→撤销重做→冷开。完整正式矩阵留09。 |
| 子格吸附与填充复制 | `fill-copy`、`fill-copy-ux`；application `fill-copy`、native-canvas `subgrid` | 会话锚点与整数毫米、独立物件/组合真实成员、支撑/锁/旋转占地/重叠/实际预算、地图外松开与取消不写工程、一次采用/撤销/重做。`fill-copy-ux`从正常生产UI新建/放置，检查两份数值填充、一次采用/撤销、按钮/Esc取消与完整工程下载保全；`fill-copy`仍使用DEV状态读取，不代替正式验收 |
| 建筑编辑补齐 | `building-edit`；shared commands `building-edit`、appearance `building-transform`、application `building-edit-history`、native-canvas `building-edit` | 正交闭合/拖边取消、共墙和门窗位置、合法删除/四向整栋变换/精确拓扑修复；完整实体/装饰/视觉及跨层影响、固定表面源与调整、锁/预算拒绝、拓扑凭据失效及一次采用/撤销；浏览器受控夹具与实际UI分别标明 |
| 有限VTT导出 | `uvtt`；shared `export/uvtt` | 当前完整v1与外观图只读、负/非零原点和整格扩边、极大坐标拒绝、门窗/秘密/锁降级、旋转物理阻挡与点光；真实ZIP/PNG尺寸及字节、无双烘焙、原范围裁切、GM/遮罩阻止、玩家PNG回退及坏资源/取消保全；源码profile不代表Foundry真实导入 |
| 当前主会话与工程IO | `m20f-ui/render/entry`、`u1a-workspace`、`u2-catalog-regression`、`sample-loading` | 安全新建/切换、完整包、混合编辑、资源取消与跨标签CAS；兼容API测试与产品入口分别报告 |
| 增量历史与完整导航 | `incremental-history`；shared `project/delta`、storage `incremental-history/repository/history-migration/history-maintenance/history-overview`、workspace `workspace-persistent-history` | 真实UI上一个版本/后续分支、先保存保护再以新revision采用、冷重开、所选便携完整历史及双受众4K实际像素；双向差异/检查点、坏图/CAS/副本迁移、预算receipt失效、全引用资源维护及概览合并读取与五路单独调用一致 |
| 资源有界并发 | `resource-parallelism`；shared `project/task-queue`、`project-resources/project-svg` | 实际PNG/SVG解码重叠、全局两项及像素权重约束、串行回退、失败/取消后收尾和容量释放；实际像素/资源不变，正常生产恢复及双受众输出另核 |
| 聚合边界与多物件/建筑预览 | `aggregate-boundary`；shared `aggregates/*`、application `aggregate-boundary/aggregate-boundary-workspace/aggregate-boundary-structure` | 唯一持久归属、目标组/Floor/基线证明、独立冻结空间快照与有界闭包复用；同时移动的候选包络替换、隐式结构/门窗跨组附着/拆合墙/入口约束、厚墙真实转角和秘密邻墙过滤、缺包络保守回退；旧/新旋转占地及图像范围、普通属性/建筑面板预览/取消/采用/撤销/重做/冷开。新位置/精确依赖/锁/资源/CAS不省略，诊断不入工程或玩家输出；结构仍完整几何，不证明容量收益 |
| 有限候选内部求解复用 | shared `validation/scene-derivation`、`geometry/prop-move-derivation`；application `aggregate-boundary-workspace` | exact认证基线/伪造克隆失效、完整字段/record顺序差异守卫、仅归组独立prop位置角度复用、容器回退；真实新位置/旋转offset/显示范围/支撑/曲线连接碰撞与full逐结果相等，公开full solver调用及私有候选证据，正常预览/采用/撤销/冷开不持久化证据。求解调用诊断不作正式性能 |
| d建筑组整体操作 | `aggregate-building`；shared `aggregates/building-transform/building-clearance`、application `aggregate-building` | 明确创建完整连通建筑/随动闭包，嵌套父帧与子帧保全、真实门/道路/家具/附着注记、固定表面源与身份；缺成员/新依赖/单端外接连接拒绝。真实厚墙/门洞/转角、旋转物理占地、外部完整宽路及门前净空；正常UI组选择/进入内部/平移旋转预览取消采用、撤销重做、保存冷开及完整包，不扩展内部证明或声明性能 |
| e自然与混合聚合 | `aggregate-domains`；shared `aggregates/domain-adapters/natural-transform` | 真实森林/火山/混合及自然闭包，跨高差/道路/建筑、散布布景人工槽/删除退出、固定外观源与物化视觉来源；外部支撑、前后邻域锁/共享来源/过期拒绝；正常预览取消采用、撤销重做及保存冷开 |
| f空间区块与派生 | shared `aggregates/chunks`；native-canvas `selection-chunks`、browser `render/aggregate-residency`及`aggregate-residency-render` | 稳定网格/跨块去重/远程依赖/选择派生、墙转角门洞完整形状、独立采样顺序/邻接带/唯一归属、失败非空白；屏外绘制位图延迟，完整资源验证和PNG仍全量，不证明JSON内存或性能收益 |
| g有限组拆合复制与出生 | `aggregate-domains`；shared `aggregates/group-edit/group-copy/group-identity`、`terrain-generation/composition-cost` | 完整成员/子组分区、同父合并/换父/解组；prop+递归注记有限复制及外引确认，原实体身份/人工记录/秘密保全；容器退休出生、跨池及跨/同批ID复用拒绝、真实撤销墓碑和计量；不含几何布尔/复杂容器或跨工程复制 |
| h不可变完整内容块 | browser `storage/content-blocks`、`aggregate-coordinates`、`incremental-history`、`history-maintenance/history-overview/import-archive/snapshot-read/save-content-proof` | 同事务内容块/清单/历史head、真实新写字节及未变共享、保留分支/完整离线包、缺块坏字节拒绝、插块后配额/取消/CAS回滚；schema1–3 additive升级保留源，不跳过资源或完整冷读；暂不自动GC内容块 |
| i普通事务与组影响预算 | `manual-tiers`、`aggregate-building`；shared `budget/command-budget/manual-request`、commands `manual-tier-commands/command-budget-commands`、history `manual-budget`；workspace `manual-tier/manual-budget/prepare-budget-usage/fill-copy-manual`及UI `command-budget-details` | 准备前展开单命令成员/图层/外观/新副本、256/512/1024冻结目标与4096/16384/65536组内影响；纯核心变换的真实局部不变量、近侧视固定朝向及表面源派生、伪造或混合成员变化回退；真实新容器及新成员计量、完整几何独立拒绝、锁/保护/CAS、取消/旧基线/一次撤销/保存冷开。正常生产UI显示各项读数并下载完整工程核对；保护上限不是已测容量，完整性能仍留09 |
| j复杂基底整合与开发观察 | `tools/testing/aggregate-capacity-fixtures.test.ts`、`tools/performance/run-aggregate.mjs` | 建筑/自然/混合的500/2000细节，真实素材/结构和人工记录，固定局部组后增加远端500细节或16条远处独立Floor→terrain连接，1/32目标修改；正常UI整体预览/采用、撤销重做、远处选择、保存冷开和完整包比对。细节为完整Prop与轻量Decoration之和，不能代替500/2000完整物件或局部端口扇出的正式矩阵；方法与结果见[性能参考](../docs/reference/performance.md#aggregate-integration-j-20261106) |
| 语义生成与轻量页面参数 | `harness-delivery`、`generation-parameters`；application `workspace/semantic-generation`、shared `ai/generation-parameters`及`node --test tools/harness/io.test.mjs` | 显式授权与严格支持参数、取消/预算/固定素材，真实CLI落盘包/PNG及冷读像素一致；产品首页打开→编辑→撤销→保存冷开；确定性文字替身只填表不生成、失败保全、未知创建只读查原请求与迟到草稿拒绝。不证明真实模型收益或原完整哨站成图 |
| AI与保护采用 | `m21-ai-conversation`、`m22-ai-authoring`、`m2-assimilation-acceptance`、`m2-failed-draft-recovery` | 真实HTTP/SSE/SQLite与受控provider，单件→组合→明确范围，失败草稿恢复及保护一次采用 |
| 当前创作4阶段与图片 | `ai-current-closeout`；shared/application `current-authoring`、service `current-authoring-v4`、browser `client/public-vision`与`ai-draft-reviewability` | 当前完整1/协议4/真实source3严格协商、固定资源；旧协议只用于经过来源核对的内部重放；阶段原子/预算收尾/图片确切身份/有限修正；纯UI的当前完整工程正常生产包与保护采用链，确定性provider不作审美签收 |
| 视觉编辑 | `visual-authoring`、`visual-ai-authoring`、`visual-renderer`、`refined-island`、`refined-samples` | 原创空白、真实样板、曲线控制柄、授权/范围、滤镜/透明阴影、秘密与离线双受众4K |
| 地形生成与组合 | `terrain-generation`、`terrain-composition`、`terrain-composition-ux`；`src/shared/terrain-generation/*.test.ts` | 旧配方与v4组合路径分别固定输入，Node/Worker规范化一致，真实成本、保存/冷读/候选取消及过期拒绝。`terrain-composition-ux`通过当前完整工程正常生产UI、真实Worker受控交付/读取故障检查运行取消、迟到、参数保持、显式重试真实候选及下载工程不变，不替换生成结果或注入应用/存储状态 |
| 无模型程序底图 | `base-map`；shared/browser/application与`services/ai/base-map.test.ts` | 同输入Worker/HTTP完整结果一致，严格关联/版本/素材/hash，真实图片/保存/包冷读，服务端模型与新增任务数为0；初始成本/余量只属本次会话 |
| 底图AI接续 | `base-map-continuation`；shared `continuation`、workspace `base-map/clock`与service `continuation/execution-checkpoint` | source3/创作4显式协商；旧@2/v2只作内部重放，不创建当前公开任务；G/A分类、四hash/来源重放/执行累计；真实Worker/HTTP/SSE/SQLite、保护原工程后一次采用新工程、撤销/重做/冷读/包与双受众PNG，取消保留独立底图；确定性provider不等于真实模型验收 |
| 局部地形编辑 | `terrain-editing`、`terrain-surroundings`、`terrain-topology` | 笔刷/曲线、人工移动删除锁定保护、外围冻结范围、布尔完整结果、逐槽支撑重绑、保护/CAS及单次撤销。`terrain-editing --grep 'curve drag Escape restores'`可对正常生产UI检查真实拖动、Esc坐标回滚/释放捕获、松开无候选及下载工程不变；该例不使用DEV钩子，其余内容读取用例仍需开发入口 |
| 地形层次与布景 | `terrain-dressing`；同名规划/应用/目录单元及`scatter-v2` | 实际来源与布景同候选计数，预览取消不写主工程、完整影响确认、冷读与单次撤销；旧算法向量、人工状态、当前活动净空和固定来源保全 |
| 近侧视与区域 | `terrain-presentation`、`regional-authoring` | 根锚/占地/固定源、地影与秘密遮罩；区域来源、条件物化、独立下钻、离线包及双受众4K |
| 素材批量导入与形状变体 | `asset-batch`、`terrain-variants`、`u2-catalog`；application `asset-batch/workspace-catalog-budget`、browser `assets/batch-source/content/terrain-variant-catalog` | 多文件/文件夹/ZIP、所选项原子采用与撤销、严格SVG/原始源/PNG/许可、图像与占地/根锚分开、公共256来源预算、当前完整表现字段、空库备份、实际透明轮廓与近侧视/俯视旋转；真实dist纯UI烟测与DEV读取分别报告 |
| 曲线连接与程序组件变形 | `curved-connections`、`stair-cliff`；application `curved-connections`、shared `geometry/connection-route/visual/deformation` | 当前完整v1及完整来源/版本图保全、真实双支撑/足宽/单次高差、世界弧长三风格、控制柄/单段拉伸、真实派生刷新及锁/预算、完整包/冷读/撤销恢复、私密成对像素及旧崖口不变；生产dist纯UI单独记录 |
| 轻量实例与簇状布景 | `decoration-clusters`、`decoration-island`、`island-dressing`；application `terrain-dressing`、shared `decorations/generate/presentation` | 当前完整v1/identity5及全图/原件保全、固定完整树岩与轻量职责、真实道路/曲线楼梯/活动区净空、逐件移动删除/锁/退出/层独立、实际费用不重复计量及生成回执失效；`island-dressing`覆盖算法5岩岛当前完整候选、十二固定源采用、两簇同候选、撤销重做、完整包/冷读/双受众4K及当前工程AI候选；开发自检不作容量/P3/真实模型承诺 |

上表名称省略`.spec.ts`。地形路线单元另覆盖`t3-matrix`、`t3-route-generation`和`src/shared/geometry/terrain-travel.test.ts`：全转角带、障碍/连接、有限搜索、真实指定路线与伪造回执拒绝。有限搜索或某组样板通过不证明任意输入都可生成。

私密夹具须有覆盖两份配对几何及实际地影外扩的固定遮罩；缺遮罩应继续拒绝玩家投影。区域无法安全表达的来源保留完整快照并列入报告，不能把条件物化写成全量迁移。

<a id="aggregate-development-observation"></a>
## 层级组合开发观察入口（j）

在仓库根目录依次执行，浏览器观察期间不并行测试、构建或其他自动浏览器。先冻结需要观测的完整源码/资源/工具及正常dist；共享目录有并行编辑时使用独立完整副本。以下产物目录须为空；默认只有六组，显式列出八组才包含两种远端变体。

```sh
npx vitest run --config tools/testing/aggregate-capacity.vitest.config.ts
npm run build
node tools/performance/run-aggregate.mjs --output "$PWD/work/aggregate-observation-new" --dist "$PWD/dist" --cases building-500,building-2000,natural-500,natural-2000,mixed-500,mixed-2000,mixed-500-remote,mixed-500-boundary
node tools/performance/summarize-aggregate.mjs "$PWD/work/aggregate-observation-new" > work/aggregate-observation-new/summary.json
```

准备浏览器通过正常异步入口物化真实派生图、全验完整包与许可，关闭后才逐组启动生产浏览器；`--fixtures ABS_DIRECTORY`可复用已有manifest所列确切输入字节，每份SHA及磁盘复读保持。新准备进程可分配不同来源身份，不假设跨次包hash相同。运行器使用隔离profile，从正常首页导入并操作UI；只读审计发现的IDB表，不写入产品状态或读取用户库。汇总保留全部单次值、CPU连续性/缺样与逻辑块/行字节，不输出正式p95或容量结论。最终轮方法、冻结和剩余项归[性能参考](../docs/reference/performance.md#aggregate-integration-j-20261106)，失败分别保留于[主题台账](../docs/archive/workspace-content-validation.md#aggregate-integration-j-20261106)。

<a id="current-formal-acceptance"></a>
## 当前完整v1正式容量、性能与视觉入口

完整命令及冷热、计时和资源边界见[贡献说明](../CONTRIBUTING.md#current-formal-acceptance)。先完成主路径及受影响正确性检查，冻结源码/固定素材/工具/正常dist，再按下面顺序串行执行；准备器、smoke、性能和视觉浏览器分别退出后才进入下一项。正式采样期间不运行其他浏览器、测试、构建或模型任务，不修改冻结目录，首轮失败保留且不自动重试。所有输出使用新的空绝对目录，命令说明不代表已通过。

```sh
npx vitest run --config tools/testing/formal-capacity.vitest.config.ts
npm run build
formal_prepared_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-current-fixtures.XXXXXX")
node tools/performance/prepare-current-formal.mjs --output "$formal_prepared_dir" --mode all
formal_smoke_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-current-smoke.XXXXXX")
node tools/performance/run-current-formal.mjs --fixtures "$formal_prepared_dir" --output "$formal_smoke_dir" --dist "$PWD/dist" --cases building-500 --smoke --timeout-ms 180000
formal_performance_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-current-performance.XXXXXX")
node tools/performance/run-current-formal.mjs --fixtures "$formal_prepared_dir" --output "$formal_performance_dir" --dist "$PWD/dist" --timeout-ms 180000
node tools/performance/summarize-current-formal.mjs "$formal_performance_dir" > "$formal_performance_dir/summary-recomputed.json"
```

`prepare-current-formal`的工具浏览器先全验真实字节/像素/许可并冷读，保存容量`manifest.json`、视觉`formal-visual-fixtures.json`及`preparation.json`后关闭；准备耗时不进入性能分布。容量默认建筑/自然/混合各500/2000完整Prop、无轻量Decoration替代，180m×180m范围与3.6m显示网格构成50×50格。`--smoke`仅一轮2次组内预览/采用＋2次独立即刻编辑、4次列表/2次画布选择，为诊断；正式默认六组×三轮，每轮30次组内完整Prop预览/采用编辑＋30次独立完整Prop即刻编辑、60次列表/6次画布选择、平移/缩放各三段（每段逐rAF发送30次pointermove/20次wheel），另测组操作与撤销/重做。独立即刻目标固定为`controls.remoteEntityId`，启动前检查无聚合组/预制组合/散布/装饰簇归属、公开未锁及原位/+1mm完整足迹支撑；两类编辑完成后检查保存冷开、完整内容/资源、实际块/行字节及双受众4K。预备的远端＋500完整Prop和16条真实局部外接连接可另用`--cases mixed-500-remote,mixed-500-local-ports`独立观察；后者应按支撑合同拒绝不完整组移动。

独立即刻编辑的500完整Prop 100ms门使用真实trusted Enter→校验完成的领域事务全链，要求三轮每轮至少30次、合并至少90次，逐轮及合并p95均不超过100ms；保存、实际重绘及显示代理另列。组内采用click→领域事务子指标、Enter→预览及两阶段总区间独立报告，不替代即刻门；自由拖动和其余QA-PERF操作仍需各自验收。帧p95只覆盖真实连续输入窗；每轮与合并nearest-rank、CPU断续、资源采样/缺样及失败原样保留。组超限拒绝不降载；少量内容块不代表全链加速，逻辑块/行字节不代表物理磁盘写入。运行器自动写`summary.json`，重算汇总不启动浏览器。当前RSS采样仅支持macOS，系统Chrome须预先安装。

组操作已完成或明确拒绝后，运行器通过普通取消入口退出残留建筑/室外表单草稿，核对取消前后revision、选择和完整包条目保持，再进入画布选择。该退出及包审计位于setup/tooling阶段，不写入产品测量样本；未知操作失败不自动取消。无浏览器的工具回归入口为`node --test tools/performance/aggregate-draft-cleanup.test.mjs tools/testing/formal-visual-progress.test.mjs`，不替代真实建筑500smoke或视觉长链。

性能结束后，先安装三个引擎，再在终端A启动同一正常生产包：

```sh
npx playwright install chromium firefox webkit
npm run preview -- --port 5174 --strictPort
```

回到此前准备夹具和执行性能命令的原终端B，沿用其中的`formal_prepared_dir`并创建独立视觉输出目录；完成后关闭终端A服务：

```sh
formal_visual_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-current-visual.XXXXXX")
SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5174/sceneweave/ SCENEWEAVE_FORMAL_VISUAL_FIXTURES="$formal_prepared_dir" SCENEWEAVE_FORMAL_VISUAL_OUTPUT="$formal_visual_dir" npx playwright test --config=tests/formal-visual.config.ts --workers=1
```

`formal-visual.config.ts`没有自动webServer，固定Chromium/Firefox/WebKit单worker、零重试，JSON结果在`results.json`，下载与trace在`results/`；默认Chromium为Playwright引擎，可通过`SCENEWEAVE_CHROME_CHANNEL=chrome`改用系统Chrome，旧`SCENEWEAVE_BROWSER_CHANNEL`不影响该专用配置。`formal-visual.spec.ts`核对室内/岩岛/海岸/混合/current-island五类的效果、中性、秘密配对及每类四份派生取景工程，以正常生产UI、真实完整包和双受众4K建立技术证据；同引擎比较实际秘密像素，跨引擎不强制相同抗锯齿。每条用例另写`results/<test-id>/formal-visual-progress.json`并附在Playwright结果：阶段和操作耗时、已完成事实、当前失败/超时及首败。该文件仅作失败诊断；只有全部原断言完成后生成的`formal-visual-facts.json`才是完整技术事实，阶段完成不表示视觉/P3/正式性能通过。自动技术结果不关闭14第8节全操作矩阵、人工观感或用户P3；完整历史/故障、自由物件拖动、原SCN场景和1万/10万负载仍按09分别验收。

上方j的`run-aggregate.mjs`保持开发观察定位；`run-native-m2.mjs`、旧`visual-v2-fixtures`及下方旧专项只保留各自历史冻结/格式范围，未适配当前schema/身份/存储/UI前不充当当前完整v1正式入口。

<a id="svg-determinism"></a>
## 正常生产 SVG 确定性与冷读回归

`svg-determinism.config.ts`独立运行五类冻结普通`art`输入（室内、岩岛、海岸、混合、当前算法岩岛）及旧失败室内经独立工具生成的`converted.sceneweave`，共6输入×Chromium/Firefox/WebKit。每例使用全新上下文，通过正常dist首页文件选择器导入、下载完整备份、刷新后从最近工程冷重开并再次备份。比较完整领域数据，导入仅允许根`sceneId/revision/createdAt/updatedAt`变化；身份、外观、来源、资源和许可逐条目hash保持，冷重开全部条目hash严格相同。实际非空SVG、processor2/resvg固定描述及已有派生资源链必须存在且保全，六输入整体至少含一条真实位图派生链；不使用DEV动态导入、状态钩子或像素mock。

先在独立终端启动已冻结的正常生产dist，串行执行下列命令。四个环境变量均显式提供，目录/文件为绝对路径，输出使用新的空目录；配置不启动服务器，每例300秒、零重试、单worker。恢复包在每个引擎各真实导出GM/player4K PNG一次并检查尺寸与无元数据块，其他输入不重复大图或局部取景。

```sh
svg_determinism_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-svg-determinism.XXXXXX")
SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5174/sceneweave/ SCENEWEAVE_SVG_DETERMINISM_FIXTURES="$formal_prepared_dir" SCENEWEAVE_SVG_DETERMINISM_RECOVERY="$PWD/work/root-remediation-20261106/svg-recovery-interior/converted.sceneweave" SCENEWEAVE_SVG_DETERMINISM_OUTPUT="$svg_determinism_dir" npx playwright test --config=tests/svg-determinism.config.ts --workers=1
```

`FIXTURES`指向含`formal-visual-fixtures.json`的冻结目录；`RECOVERY`指向显式选定的恢复包文件，不能用原始旧源替代。JSON报告为输出目录的`results.json`，实际备份、恢复包PNG与逐条目事实在`results/`。默认测试配置忽略该专用spec；`--list`仅证明18条用例可发现。该聚焦回归只补SVG确定性与持久化支持证据，不补齐完整formal视觉15组合、人工美术/P3或性能验收。

## 定向与跨浏览器入口

```sh
npx playwright test tests/incremental-history.spec.ts --workers=1
npx playwright test tests/terrain-generation.spec.ts tests/terrain-composition.spec.ts tests/terrain-editing.spec.ts --workers=1
npx playwright test tests/terrain-surroundings.spec.ts tests/terrain-topology.spec.ts tests/terrain-presentation.spec.ts tests/regional-authoring.spec.ts --workers=1
npx playwright test --config=tests/visual-playwright.config.ts --workers=1
npx playwright test --config=tests/terrain-playwright.config.ts --workers=1
npx playwright test --config=tests/m2-joint-playwright.config.ts --workers=1
```

专用配置分别固定其Chromium/Firefox/WebKit项目，系统Chrome环境变量不改变专用配置已指定的项目。新增成图与局部修改流程核查适用跨引擎范围；旧M2全部流程不能由视觉专项外推。同一引擎往返做实际像素比较，跨引擎不要求抗锯齿逐像素相同。

## 正常生产检查

当前完整v1的最小端到端自检：

```sh
npm run build
node tools/testing/current-project-production-smoke.mjs
```

下列历史专项脚本包含旧格式或旧预算断言，迁移为当前合同前不能作为当前格式的执行入口；运行记录仍保留原冻结。

```sh
npm run build
node tools/testing/visual-production-smoke.mjs
node tools/testing/terrain-production-smoke.mjs
node tools/testing/terrain-edit-production-smoke.mjs
node tools/testing/terrain-presentation-production-smoke.mjs
```

地形生成生产脚本默认保留`island/coast`。需检查五配方及路线时，在新目录运行：

```sh
SCENEWEAVE_TERRAIN_KINDS=river,lake,forest,hill,mixed SCENEWEAVE_TERRAIN_ROUTE=1 SCENEWEAVE_TERRAIN_CANCEL=first SCENEWEAVE_EVIDENCE_DIR=work/terrain-route-production node tools/testing/terrain-production-smoke.mjs
```

取消默认逐类检查，`CANCEL=first`只检查第一类。正常生产核对候选/主工程/冷读字节、资源hash和实际GM/player PNG；工程时间戳会使不同轮整包hash不同，只要求同轮一致。技术链通过不关闭真实模型、视觉/P3、正式性能或UVTT真实导入。各批结果及首轮失败见[地形历史台账](../docs/archive/terrain-validation.md)和[视觉历史台账](../docs/archive/visual-quality-validation.md)。

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

这些检查验证保留的内部算法或历史格式，不代表产品继续提供旧工作台、旧库发现或旧格式导入入口，也不能替代当前主路径的UI／联合证据。

三引擎联合配置为`tests/m2-joint-playwright.config.ts`。部分用例存在浏览器条件跳过，报告实际执行与跳过范围；旧发现数量只属于原冻结。退休旧入口性能用例不表示性能门通过。

`curve-submit-ux.spec.ts`覆盖正常生产桌面/390px的曲线释放范围拒绝、显式扩大、预览取消、采用/一次撤销重做及完整包冷重开；`save-recovery-ux.spec.ts`与`history-recovery-ux.spec.ts`使用隔离页原生IDB定向异常验证恢复，不注入工程。当前执行结果及各冻结见[工作区主题台账](../docs/archive/workspace-content-validation.md#ux-five-recovery-20261106)，不外推完整验收。

`generation-cancel-ux.spec.ts`验证自然/组合运行中Esc与真实迟到Worker响应；`domain-cancel-ux.spec.ts`覆盖室内/森林/火山/混合的重试期间旧响应隔离；`regional-cancel-ux.spec.ts`仅延迟原生PNG fulfillment，验证区域资源准备阶段取消，不能外推同步几何可抢占。`fill-handle-ux.spec.ts`使用正常UI组合和实际完整备份核对拖柄旅程。范围与冻结归[本轮台账](../docs/archive/workspace-content-validation.md#ux-five-recovery-20261106)。

`export-privacy-ux.spec.ts`在正常生产包以真实UI建立公开/私密对照，检查双受众4K PNG的实际RGBA/容器、遮罩删除拒绝，以及完整工程真实下载→空存储导入副本→刷新冷开后的文档/资源/许可/身份/外观。使用`SCENEWEAVE_TEST_BASE_URL`指定包含部署base的冻结地址，默认后台运行；不得启动可见独立窗口。未通过的原生失焦探索保存在被忽略的`work/ux-audit/`，不加入默认测试套件。已验证与待实测边界见[接续记录](../docs/archive/workspace-content-validation.md#ux-export-native-20261106)。
