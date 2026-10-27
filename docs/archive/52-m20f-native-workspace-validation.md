# M2-0f：原生主工作区与入口收敛

2026-10-24，起点main/0367c5f及未提交的M2-0a至e，应用版本号仍为0.2.0-m1-d2。用户“继续”授权按设计推进f，只做必要简单测试。**M2-0f开发和本批必要定向检查已完成：默认编辑路径为新完整v1及两个新仓库，旧整页入口收拢到只读保全转换。下一开发入口为M2-1；完整回归、QA-AI-16全矩阵及性能门仍未关闭。**

本批没有自动转换真实用户工程或个人库，没有调用模型渠道、部署后端、启动全量回归或正式性能、commit/push。48至51保留各批历史结果，不改写为f的新主路径证据；旧素材、测试及独立todo保留，不重建work/或docs/evidence/原始附件目录。

## 实施内容

- [原生会话](../../src/application/workspace/workspace.ts)以新完整v1的ProjectData和独立资源端口持有唯一编辑分支，直接使用共享命令、身份、外观、纯投影及新ProjectRepository。普通编辑、预览/采用、撤销重做、串行保存/同事务CAS、失败另存副本和checkpoint保持；撤销也增加revision。普通命令领域限制、编辑锁、依赖展开和256预算保留，未提前实现M2-2多步骤任务采用接口。
- [编辑工程捕获](../../src/application/workspace/project.ts)使用明确native字段和资源端口；toBundle剥离应用端口后严格验证，fromBundle独立捕获实际字节和像素。未知字段、访问器、隐藏字段、Symbol和不合法端口拒绝，不把旧v6工程包装成新格式视图。
- [资源准备](../../src/application/workspace/prepare.ts)通过共享真实派生和浏览器图片适配器生成固定PNG，保留源/派生、许可、非活动固定根、物理字段和私密性。静态图片导入显式提供尺寸/占地/阻挡/许可；素材库采用走新中性载体和算法1精确身份。入库和参数准备不写主工程revision，采用前完整检查真实资源闭包。
- [主工作台](../../src/editor/main/Workbench.tsx)、[原生画布](../../src/editor/native-canvas/AssetCanvas.tsx)与[Canvas渲染](../../src/platform/browser/render/index.ts)成为默认路径，接入建筑、室外、组合、图层、框选/右键、有限恢复和三范围目录。视口、选择、编辑隐藏、布局偏好仍为会话/本机状态；玩家输出经过共享过滤投影及遮罩，不能读个人整理或历史秘密来生成公开内容。
- [原生样板工厂](../../src/platform/browser/content/factories.ts)直接构造新完整v1和独立资源端口，支持空白、书房与露台、双层岩岛、海岸哨所、原创材质校样、苔石墓园及灰烬熔脉。固定定义和实际素材沿用已有内容，不以默认最新素材替换历史引用，不提高P2/P3或完整SCN验收结论。
- [新默认入口](../../src/App.tsx)和[首页](../../src/editor/main-shell/WorkspaceHome.tsx)使用sceneweave-projects及sceneweave-library；旧整页hash统一回首页。兼容边界继续只读发现六库、严格读取旧文件、下载完整保全set并重新选择所有卷核验，再经固定journal和冷读开放为新副本；旧库/原文件不写不删。
- [原生历史包安装](../../src/platform/browser/storage/repository.ts)完整验证后创建新当前owner/r0，保留历史document的原sceneId/revision、lineage与出生/拓扑证明，以新owner及独立快照ID绑定；当前、自动版本、所选命名/保护、实际资源和许可绑定在目标库单事务写入，取消、坏资源或预算拒绝整笔回滚。

首页可[打开完整保全集合](../../src/application/migration/preservation.ts)：文件选择先核验索引、全部原名分卷、实际字节/重组/指纹；新浏览器重新生成与新job绑定的集合，仍须下载并重新选择。旧源缺失或变化时默认拒绝，仅明确captured-copy才继续；committed但未开放的副本也保留此选择。历史面板另可[下载迁移原件](../../src/editor/main/legacy-original-download.ts)，仓库每次验证所属工程、全部来源节点/前序、实际SHA及累计预算，下载确切字节。普通完整包不自动携带本地原件。

命名及局部恢复继续先保存当前、落保护点，再核来源快照hash、当前revision/元数据及会话checkpoint，一次采用并保留范围外编辑。C2建筑witness只在当前真实打开会话有效，回首页/继续和被动flush保留；真实重开、导入、另存副本或切工程清空。物件/组合/室外仍遵守既有出生/拓扑连续性，不提供任意拓扑恢复。

## 当前已取得的必要检查

所有浏览器检查使用隔离测试内容和profile，不访问用户实际IndexedDB。以下为实际运行结果，未将旧44或48至51当作新主路径通过证据。

| 检查 | 已有结果 | 范围与限制 |
|---|---|---|
| 最终类型与正常生产构建 | 通过；Vite 2.44秒 | npm run build及末次npm run typecheck通过；保留zod注释和大chunk警告，不据此宣布性能通过 |
| 新核心及f相关定向单元 | **28文件219/219，23.85秒** | shared、兼容转换、新工程/个人库、原生会话/准备、面板辅助、选择/视口、渲染、历史包/原件及保全文件选择；非全量单元回归 |
| 真实Chrome主路径联合批次 | **11/11，1.3分钟** | 3项入口/文件/目录、3项混合UI及5项双受众/隐私/资源检查；0失败/重试/跳过 |
| 已提交未开放副本补充专项 | **1/1，4.7秒** | 最后补齐的committed＋旧源缺失入口，默认拒绝、明确captured-copy后原target开放；独立批次，不混写为一次12项全绿 |
| 正常生产页面简单检查 | **通过，8.206秒** | 实际/sceneweave/子路径，首页→海岸哨所→125%缩放→Home继续→玩家PNG→重载/重开；0 pageerror/失败HTTP，仅两个新库；4096×3186 PNG，4723460字节 |
| 真实隔离Chrome新建空白 | 已通过简单检查 | 3个Canvas、pageerrors为0；只创建sceneweave-projects和sceneweave-library，没有创建旧库；不代表完整混合制作旅程 |
| 七种原生模板真实资源验证 | 已完成 | 上述七种模板通过真实Chrome完整资源验证；不等于七份完整人工SCN、全部交互或视觉P3通过 |
| 原生Workspace独立专项 | 2文件10/10，1.64秒 | 作为上述定向集合内子项记录，不重复计数；保存/冷读/单调撤销、来源/过期预览、锁/256、范围恢复/保护失败、跨连接CAS、witness及真实小PNG派生 |

无DOM与Node检查：npm run check:shared通过60个模块的独立无DOM编译、实际ESM规则/无图片ZIP及set/整理往返；Node真实图片适配器仍未提供。

最终定向命令：

```sh
npx vitest run src/shared src/compat/legacy src/platform/browser/storage src/platform/browser/library src/application/workspace src/application/migration src/editor/native-canvas src/editor/main-shell/read-preservation.test.ts src/editor/main/*.test.ts src/platform/browser/render --maxWorkers=1
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20f-ui.spec.ts tests/m20f-entry.spec.ts tests/m20f-render.spec.ts --reporter=line
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20f-entry.spec.ts --grep 'unpublished committed' --reporter=line
npm run check:shared
npm run build
npm run typecheck
```

联合11项运行时entry文件有3项；之后新增committed专项为该文件第4项并单独运行。现在上述不带grep的完整f命令将发现12项。普通书房、岩岛及海岸哨所的GM/player 4096长边PNG与旧参考逐RGBA完全一致；独立固定遮罩隐私副本另核对私密物件/注记投影和实际玩家遮罩像素，缺真实资源时拒绝出图且原工程保持。

UI实际覆盖新建/素材放置/框选/右键复制/单调undo-redo、图层暂态显隐、Home继续选区/缩放及显式重开；建房＋地形＋外观＋命名/保护恢复且保留范围外新位置/地形；仅整理的原文本/颜色顺序/收藏真实下载再导入且不安装素材。入口专项覆盖旧库取消落盘后同job/target重试、索引和全卷真实下载/重读、旧源指纹不变、确切原件下载SHA相同、空浏览器重开保全、新历史包空库独立安装及冷重开、坏文件保持当前分支、目录已冻结策略恢复。

## 已知修正与证据边界

Workspace首次9项定向中6项通过，3项涉及测试锁命令写法、结构恢复未明确确认扩展依赖，以及同步抛错与异步拒绝包装；修正合同使用和验证入口后9/9通过。审查随后发现历史包安装后的最终字节捕获存在迟到切换窗口，已在install前再次检查checkpoint，并用真实新仓库和等待中的资源捕获验证：期间到达的新编辑保留，已导入成果作为独立工程保存。增加该用例后专项10/10通过。

原生会话新增输入边界先检查命令/恢复请求的数据描述符再复制；Blob使用原生读取属性与slice独立捕获。真实PNG派生专项核对固定源与输出SHA、实际像素和物理/支撑/私密字段，没有以元数据或成功返回值代替实际字节。

审查修正了取消转换的并发窗口：取消也持有同步操作锁，先停止并等待活动任务，再落journal状态，最后释放窗口，避免迟到取消覆盖下一次同job重试。恢复个人库任务显示并固定原organizationPolicy。另补committed目标在旧源缺失时的明确选择通道及来源原件下载。

浏览器首轮辅助代码曾受开发服务器HMR的双模块实例、未等待缩放更新、测试DOM变量遮蔽及导出未传真实图片端口影响；分别重启冻结后的服务、等待实际125%和修正测试变量/完整接口后通过。没有放宽产品校验或跳过断言。正常生产截图实际检查了GM/玩家画布及面板，不据此代签人工P3。

主路径使用shared及原生application/platform模块；旧core/io/render及旧编辑器代码保留在兼容/历史范围，旧输入转换可通过严格legacy边界调用必要旧读者，不能把兼容模块加载误记为新主工程经过旧格式往返。旧原件位于独立legacy表，普通新工程副本保留原身份关系，来源owner/旧库和先前保全文件仍保持；本批不清理原件或宣称普通便携包含全部旧档案。

本批没有重跑1123单元/203Chrome全量、正式性能矩阵、真实配额耗尽、跨浏览器、PWA冷启动、UVTT、人工P3或真实小团。保护预算保持既定数值，不把模板可加载当作实测最大容量。不接AI、后端任务循环或非空SVG，流式文本/工具续答能力仍须M2-1实测。

## QA与下一入口

交付保护核对：724份起始文件中701份原字节保持、23处相关说明/主入口/新仓库等调整，无缺失；新增105份（101源码/数据/必要测试、3浏览器测试、1简短报告）。旧core/io/render/catalog、逐代编辑器、素材、48至51、todo及依赖/包版本保持。139个主工作台/runtime/样板递归模块无旧core/io/render/catalog/逐代编辑器依赖、无未解析导入。最终60份主文档/计划的814个本地链接（含46个锚点）无缺失，源码/文档/测试及生产构建产物的凭据模式无命中文件；本批diff/新源码空白检查通过，todo既有7处空白未触碰。HEAD仍0367c5f、暂存为空，无commit/push。小图/临时结果只在系统临时目录或被忽略的测试目录，不新建work/evidence。

QA-V1-08及适用IO/CAT/TXN/SEC的本批必要主会话子项已完成，M2-0a至f开发可交接下一切片。QA-AI-16全矩阵和新核心完整回归仍待安排，不把44旧主路径全量结果外推为新核心通过。

下一开发入口为**M2-1：自有后端与流式连接**。按既定Node/Hono、配置/鉴权、provider适配、SQLite/制品存储和有序事件流实现；实际渠道须通过文本流与至少一轮工具结果续答，再接M2-2独立草稿及一次采用。Pages前端、自有任务后端、首版无生图API、SVG及本地PNG方向保持。开发仍只做必要简单检查，完整回归等用户通知，34正式性能继续后置。
