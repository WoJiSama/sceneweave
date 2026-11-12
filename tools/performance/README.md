# 性能运行器与历史负载复现方法

当前性能／容量会话的跨电脑接续见[07交接入口](../../docs/07-roadmap.md#performance-capacity-cross-machine-handoff)。`baselines/wall-paint-20261111.patch`与`baselines/encoding-owner-20261111.patch`保留两个独立优化的正向源码差异；只在隔离测量副本反向应用以重建单项基线，先`--reverse --check`，不能直接回退日常工作区。它们不包含旧机的忽略输入、原始证据或完整历史冻结，不是性能通过证明。

本页先列当前跨电脑单项对照工具，再维护B5/C0旧格式负载和保留运行器的方法；当前验收入口见[质量计划](../../docs/09-quality-plan.md#acceptance)，正常原生主路径及严格v2视觉负载的命令见[贡献说明](../../CONTRIBUTING.md)。旧工作台已经退役，历史结果不能替代当前产品验证。

## 当前完整v1单项开发对照

长历史总耗时三步整改使用`baselines/history-total-20261112.patch`，`prepare-production-pair.mjs --optimization history-total`可在新隔离副本反向还原改前实现，保留全部13个产品／测试文件的确切差异；临时Git库显式关闭换行转换，正反向逐字节核对。`run-production-pair.mjs --optimization history-total --history-depth 20`只接受该范围内12个src文件差异，页面测试第13文件另由生产专项执行。20／44／66深度分别运行AB／BA／AB；这是三项合并整改的对照，不能归因成某一个小改动的独立收益。往返一毫米会重复两个实际领域状态，缓存收益不能外推到每次都产生不同领域内容的长历史；任意实际内容变化仍完整校验。

`run-history-cause-analysis.mjs`现同时观察旧`scanTotals`／`history.audit`与新`prepareAccounting`／`auditCapturedTotals`，保留冷首写实际原生事务完成跨度、审计期间另一原生连接readwrite的获得／完成等待，以及原保活空读次数。锁探针只读epoch、不写入内容；它会扰动调度，跨度仍含克隆、加载、等待和GC，只作单独组件归因，不能与正常生产UI耗时拼接。旧实际图／profile及旧版本工具指纹保留，新增结果按本轮冻结记录，方法与边界见[三步整改](../../docs/reference/performance.md#history-total-remediation-20261112)。

长历史整改使用`baselines/history-audit-20261112.patch`在独立源码副本反向重建基线，再各自正常build。`run-production-pair.mjs --optimization history-audit --history-depth 20`在冷开前通过真实UI保留指定次数的往返编辑；可分别用20／44／66，`--first-side after`将该对改为BA。深度必须为2–100的偶数，默认2保持旧八操作方法；每侧共`historyDepth+6`条观测、`historyDepth+2`次真实修订，完整包及双受众实际RGBA在浏览器退出后复核。该scope同时包括完整历史后台调度及同次新鲜场景证明消除内容／身份重复领域校验，不宣称二者各自单项净收益。输入／源码／正常产物／工具全部冻结；不能在采样时修改本目录。

`run-storage-scale.mjs`仍为源码组件诊断，另保留每笔保存内的long task及50ms心跳实际间隔。显式源码插桩副本可输出`SCENEWEAVE_HISTORY_DIAGNOSTIC`分段，工具只捕获该前缀；递归函数逐次计时可能严重扰动结果，不能拿插桩总时长或相互包含的span相加当作正常生产性能。原生事务保活／复制／锁等待包含在真实总等待内，页面heap不包含Worker／native／GPU；正式判定继续从09执行。

`prepare-production-pair.mjs`只向仓库忽略的`work/`新空目录捕获副本，不反转日常工作区；它链接现有锁定依赖、反向预检并应用所选patch，再串行运行与正常build相同的架构、前后端类型和Vite步骤。编码基线的旧函数签名与新增回归测试不兼容，因此将该测试原文保全到副本外的`baseline-optimized-test.ts.txt`，after和日常工作区完整保留测试。两侧产品只允许编码的两个存储文件或墙面一个renderer文件不同，额外测试差异显式登记；不能同时逆转两项后宣称单项收益。

先安装锁定依赖，按以下顺序执行；路径需替换为本机绝对路径，每个输出均须新空目录。Windows默认npm缓存若无写权限，可显式用`npm ci --cache D:\code\sceneweave\work\npm-cache`，不修改锁文件或全局配置。

```powershell
node tools/performance/prepare-current-formal.mjs --mode capacity --cases mixed-2000 --channel chrome --output D:\code\sceneweave\work\new-pair\fixtures
node tools/performance/prepare-production-pair.mjs --optimization encoding-owner --output D:\code\sceneweave\work\new-pair\builds
node --test tools/performance/production-pair-audit.test.mjs tools/performance/resources.test.mjs
node tools/performance/run-production-pair.mjs --optimization encoding-owner --before-source D:\code\sceneweave\work\new-pair\builds\before --after-source D:\code\sceneweave\work\new-pair\builds\after --before-dist D:\code\sceneweave\work\new-pair\builds\before\dist --after-dist D:\code\sceneweave\work\new-pair\builds\after\dist --fixtures D:\code\sceneweave\work\new-pair\fixtures --case mixed-2000 --pairs 3 --channel chrome --output D:\code\sceneweave\work\new-pair\results
node tools/performance/summarize-production-pair.mjs D:\code\sceneweave\work\new-pair\results --output D:\code\sceneweave\work\new-pair\summary-recomputed.json
```

准备器`--cases`可选八份完整Prop容量输入的子集；不传保持原矩阵，`--mode visual`拒绝容量筛选。准备器、测试、构建结束并关闭浏览器后才开始测量。运行器默认三对AB／BA／AB，每侧独立Chrome/profile，真实UI导入→独立公开Prop首次X+1mm→暖笔回原位→双受众4K→一次完整页面重置／目录冷开→冷开首笔+1mm→下一笔回原位。所有操作均校验确切revision与保存／画布就绪；文件选择自动化、observer与CDP开销保留。运行器只消费上述容量manifest和独立Prop，不是通用拆图／多图片负载替身；墙面反例与图片负载仍须补适配和对应输入，不能用无有效遮罩分配差异的输入代表所有墙面收益。

完整包下载在采样停止后，PNG与包审计在专属浏览器退出后以Node完成。PNG核对CRC、4K尺寸／比例、元数据白名单与实际解码RGBA；工程核对完整包全部条目、领域／身份／外观／固定来源／资源／许可，只允许导入的独立root／时钟及确切4次revision变化。汇总器重新审计已保留最终包／PNG，并拒绝失败／未完成manifest，不修复旧失败为通过。原始输入比较在运行器保留；重建仍需冻结的fixtures目录，Git不携带运行产物。

这是低样本开发诊断，未接入独占系统负载guard，不可关闭正式性能或宣称稳定净收益。macOS仍采专属进程树RSS；2026-11-12起本开发对照在Windows单独采Working Set和私有提交，其他未支持平台显式`rssMode:unavailable`，缺值为null。原`run-current-formal.mjs`默认macOS RSS要求保持，Windows不能直接并入旧RSS分布。旧Windows缺测结果见[原记录](../../docs/reference/performance.md#encoding-owner-windows-20261111)，新方法/限制见[三步接续](../../docs/reference/performance.md#three-steps-20261112)。

`--optimization workflow`使用`baselines/workflow-20261112.patch`重建2026-11-12四条路径的整体改前版本。准备器捕获所有未忽略源码/测试，运行器严格要求7产品+4测试文件差异；其他模式的单项白名单保持。它比较整组整改，不能将合并前后数字当作其中某个微优化的独立收益。新补丁已独立正反向应用并核对完整文本，Windows Git换行归一与原始源码SHA分开记录；不把文本相等声称为所有换行字节相等。后续源码演进先反向`--check`，上下文不兼容时显式适配，不能覆盖日常工作区。具体数值及撤回候选见[本轮整改](../../docs/reference/performance.md#workflow-remediation-20261112)。

<a id="storage-responsiveness-capacity"></a>
## 保存规模、后台计算和资源连续旅程

本组全部是开发诊断，正式入口和阈值仍归09。先冻结源码/真实资源输入并完成正常构建；每条命令使用独立新空输出目录，准备、构建、单元测试与浏览器测量串行。原始输入、profile、图片及工作包放忽略目录，不随Git携带；下列准备器可在新机器重建压力输入，但独立素材身份可能变化，必须冻结实际包hash，不能与旧分布拼接。

`run-storage-scale.mjs --source ABS --input ABS_SCENEWEAVE --output ABS_NEW [--matrix 1:2,5:2,1:20]`使用真实Chrome/native IndexedDB和公共仓库API，分别准备owner数量/每owner历史保存次数，重开后量冷读/冷首写/两次暖写及inclusive方法跨度。它用源码模块并包装私有方法归因，不是生产UI计时；标题修改没有Prop编辑器的局部事务回执。每case前后冻结源码/输入/工具，漂移即拒绝。全库/全部分支审计、真实字节、预算/CAS不关闭。

`run-history-cause-analysis.mjs --source ABS_FROZEN --input ABS_SYNTHETIC_SCENEWEAVE --output ABS_NEW_WORK_DIRECTORY [--history 20]`在忽略的输出目录复制冻结src，44处同步边界记录inclusive／self与调用父边，避免对递归JSON节点逐次插桩。真实导入、逐笔标题保存、冷读首写后保留`actual-read-graph.json`；对同一图串行执行事务内／外／外／内Worker审计，计实际保活空读并用另一原生连接探测readwrite等待。只读探针不改数据；事务外模式只是分析，不是新的产品保存合同。JSON大小不代表堆／RSS，函数self仍含未插桩子函数／调度／GC。`analysis.json`包含冻结、事件、原始图摘要与每次结果，正常源码／dist不改。

`profile-history-audit.mjs --source ABS_FROZEN --graph ABS_ACTUAL_READ_SYNTHETIC_JSON --output ABS_NEW`对上项实际图运行未修改源码，三次独立Worker审计，另一次同步页面调用采CPU profile及互斥叶节点汇总。它独立核对源码／图／工具指纹和图不变、所有严格审计结果一致；没有数据库事务／资源／正常UI保存，不与插桩分布拼接。两工具只用可保全的合成压力输入，图和profile留忽略目录；计时含加载、克隆、编译与调度，未提供独占guard。具体根因与方案边界见[最终实现复核](../../docs/reference/performance.md#history-audit-causes-20261112)。

`run-svg-worker-analysis.mjs --source ABS --input ABS_SCENEWEAVE --output ABS_NEW [--rounds 3]`在源码模块环境读取完整工程的规范SVG，使用相同固定WASM处理器比较主线程/后台，先初始化、交替次序，分别保留实际RGBA、总耗时、long task及16ms heartbeat。初始化、严格导入、结果hash和取消专项不计进批次。它不代表正常UI或全部验证无阻塞；正常旅程另用`run-production-pair.mjs --optimization representation-worker`，对应可携带基线为`baselines/representation-worker-20261112.patch`，只在隔离副本反向应用，正常源码不回退。

`--optimization history-endpoint`由`baselines/history-endpoint-20261112.patch`重建最近完整编码端点复用之前的版本，源码只允许`delta.ts`及表示集成测试两个文件差异。它与`representation-worker`分开做正常三对；长历史组件另用`run-storage-scale.mjs --matrix 1:20`按AB/BA交替执行，不能用不同时段的合并改动冒充单项收益。两份补丁均在隔离目录正向/反向应用并逐字节roundtrip核对；Windows检查副本显式设置本地`core.autocrlf=false`以免新增文件换行自动转换，只影响该临时Git库，不修改全局设置。叠加后的实现要还原本轮之前基线时，先逆转history-endpoint再逆转representation-worker；每步先`--reverse --check`，只在副本执行。实际SHA与测量边界归[性能主题](../../docs/reference/performance.md#three-steps-20261112)，源码演进后上下文冲突须重新适配。

`prepare-resource-stress.mjs --source ABS_FROZEN --output ABS_NEW [--cases names]`调用`tools/testing/resource-stress-fixtures.ts`创建原创确定性棋盘/透明PNG，保留完整Prop/固定定义/许可/资源闭包并严格导出冷读。默认7份合法压力输入为2048²、4096²、8192×3906近3200万像素、3×4096²约5033万像素，以及64/128/256张256²独立图片；另实际准备257张和4×4096²超累计预算负例。每张实际字节不同，来源和synthetic标记明确；这些是附加资源压力，不能替代真实建筑/自然/混合地图。负例保持在manifest.rejections，不伪造可导入成功包。

`run-capacity-journey.mjs --source ABS --dist ABS --fixtures ABS --output ABS_NEW [--cases names] [--cycles 3] [--edits 20]`消费正常生产构建与已完成manifest，每case新Chrome/profile。默认三循环各20次独立公开Prop一毫米往返、撤销/重做、命名快照、页面重置冷开核命名历史；首尾双受众4K，空闲6秒核后台Worker释放，结束后下载完整包并在Chrome退出后核全部内容/实际RGBA。所有场景内容回原位，revision精确增加；命名历史在本机冷读检查，不因普通备份未携带本机pins判内容丢失。失败保留截图/页面文本/部分操作，不自动重试；短时循环不证明无长期泄漏，完整09故障/恢复/拖动等矩阵另行执行。

Windows资源采样由单个隐藏PowerShell助手读取名称/父子PID/WorkingSetSize/PrivatePageCount/CPU与出生计数，不读取命令行。专用Chrome进程树的Working Set同时求和可能重复共享页；PrivatePageCount是私有提交，不是私有驻留或GPU；目标CDP heap不含Worker/native/GPU。WMI目标间隔下限500ms，记录真实查询耗时与样本间隔；助手不重叠发起查询，停止时结束自身进程。树外只保留浏览器/Node数量及全系统CPU繁忙比例，不保存用户进程名/路径。后台存在时仍只交付诊断，不关闭正式独占性能门。

<a id="workflow-analysis"></a>
## 当前完整v1逐步耗时与CPU归因

`workflow-diagnostic-targets.mjs`声明当前函数边界，确切数量/行号随每份诊断metadata冻结；旧分析为76处。`build-workflow-diagnostic.mjs`仅对独立产物插入阶段计时，不修改src或正常dist；观察器compact模式保留全部次数／inclusive耗时／输入长度及失败，≥0.25ms才保留逐次span。函数span有嵌套、并行和await等待，不得相加或解释为CPU；非async函数返回Promise只测提交部分。新PNG metrics另列原生toBlob同步提交、回调/等待、Blob读取及规范化；原生提交可包含延迟绘制，不能统称压缩CPU。

可选`build-workflow-diagnostic.mjs ABS_NEW --flush-4k`在4K主绘制函数的各顶层绘制语句后读回1像素，观察`canvas.flush4k:*`跨度，定位原本延迟到输出时才完成的Canvas工作。该模式改变提交/完成时机和成本，只作归因；绝不能把其中变短的encodePng当作优化收益。对照正常构建的耗时、PNG像素以及不带该选项的分段分别保留。

`run-workflow-analysis.mjs --mode stages|cpu`运行与上面相同的八个实际UI操作。stages必须使用带诊断metadata的构建；cpu必须用未插桩正常构建，逐操作采1ms目标间隔主线程profile。每操作先保留保存／主画布／显示代理终点，再另行排空精细预览；尾部等待单列，避免混进下一操作。PNG／完整包审计在测量与浏览器结束后进行，源码／产物／输入／工具指纹须保持。两个模式都只是归因，不作正式分布或优化前后收益。

```powershell
node tools/performance/build-workflow-diagnostic.mjs D:\code\sceneweave\work\new-analysis\stage-dist
node tools/performance/run-workflow-analysis.mjs --mode stages --dist D:\code\sceneweave\work\new-analysis\stage-dist --fixtures D:\code\sceneweave\work\new-pair\fixtures --output D:\code\sceneweave\work\new-analysis\stages
node tools/performance/summarize-workflow-analysis.mjs --analysis D:\code\sceneweave\work\new-analysis\stages\analysis.json --output D:\code\sceneweave\work\new-analysis\stages-summary.json
node tools/performance/run-workflow-analysis.mjs --mode cpu --dist D:\code\sceneweave\work\new-pair\builds\after\dist --fixtures D:\code\sceneweave\work\new-pair\fixtures --output D:\code\sceneweave\work\new-analysis\cpu
```

CPU源码映射应在**同一捕获副本**以Vite `--sourcemap hidden --outDir ABS_NEW`另建产物；可见sourceMappingURL可能改变worker引用和chunk名，不可只剥离主文件注释后假定等同。`summarize-workflow-analysis.mjs --analysis ABS_CPU_JSON --maps ABS_HIDDEN_MAP_DIST --reference-dist ABS_NORMAL_DIST --output ABS_NEW_JSON`逐字节检查全部正常文件与profile构建指纹，只许额外map，再映射并保留原始profile／map SHA。独占叶节点按timeDeltas分配，inclusive来源每样本递归去重但仍重叠，SHA祖先不作调用次数；idle／GC／program／未知／原生帧不丢弃。CPU只覆盖目标主线程，原生帧可含flush／阻塞，不能据此断言纯编码或数据库等待。

每个输出目录必须新空；测量期间不要并行运行浏览器、测试或构建。语法检查及`node --test tools/performance/workflow-analysis.test.mjs tools/performance/production-pair-audit.test.mjs tools/performance/resources.test.mjs`在测量结束后运行。当前具体数值、失败和实现分析见[性能主题](../../docs/reference/performance.md#workflow-attribution-20261111)。

## 以下为历史B5/C0方法

B5工具测量 VIS-01 书房与露台、VIS-02 双层岩岛的 500/2000 物件副本。它通过独立生产入口复用实际 `AssetCanvas`、`WorkspaceV2`、样板候选守卫、资源校验、IndexedDB 仓库及 PNG 管线。普通 `npm run build` 不暴露 `window.__sceneweavePerformance`。

这里定义复现方法，不预先宣布最终性能或容量通过。实际版本、设备、原始数据、失败记录及退出判断以 [B5 验证报告](../../docs/archive/m0-m1-validation.md#doc-21) 为准。普通负载保留原创真实材质、透明物件、覆盖层和阴影；高密度摆放允许视觉重叠，不是可玩布局或美术验收。

## 环境与正式命令

完整资源采样目前面向 **macOS + 已安装的系统 Google Chrome**。采集器依赖 `/bin/ps -axo pid=,ppid=,rss=,comm=` 及 macOS RSS KiB 约定；Linux/Windows 的完整采样尚未建立兼容验证。仅安装 Playwright Chromium 不会提供默认 `chrome` 通道。

采用 `.nvmrc` 指定的 Node.js **24.14.1**，在仓库根目录依次执行：

```sh
npm ci
npm run build:performance
npm run perf:b5 -- --output performance-results/b5-final --runs 3 --edits 30 --selections 60 --cases study-500,study-2000,island-500,island-2000 --channel chrome
node tools/performance/summarize-b5.mjs performance-results/b5-final
```

`dist-performance/` 是被测生产构建。运行器自行启动仅绑定 `127.0.0.1` 的临时 HTTP 服务，无需运行 Vite 开发服务器。`--output` 接受仓库相对路径或绝对路径；每次使用新目录。已有 `manifest.json` 的目录会被拒绝，避免覆盖旧证据。汇总器只接受 `manifest.status=complete`，会检查样本数、保存/重开、20 个快照、编辑渲染及跨轮 RGBA 一致性；它生成或更新派生的 `summary.json`。

正式测量必须串行，期间不要并行运行测试、构建、其他浏览器自动化或性能任务，也不要修改被测源码、夹具或 `dist-performance/`。macOS 运行器用本次命令生命周期内的 `caffeinate -i` 防止空闲休眠，不修改系统电源配置。`manifest` 记录 HEAD、脏文件列表、Node、硬件概况和运行配置；每轮记录 Chrome、GPU 设备/特征状态及采样信息。HEAD 和脏文件名不是构建内容指纹；交付前还须保存相应源码与构建文件的 SHA-256，防止把运行中修改后的源码误认为被测版本。

默认矩阵为四组 × 三轮，共 **12 个独立 Chrome 进程/配置文件**。素材夹具在另一个准备进程中创建、严格校验并导出，关闭该进程后再正式采集。每轮先观察约 1 秒空闲，然后执行：

1. 生产运行时导航；禁用该目标的 HTTP 缓存，服务器也使用 `Cache-Control: no-store`。
2. 读取完整工程、严格导入、采用并持久化，等待实际产品画布复制及双 rAF 调度近似值。
3. 发现两个不同的真实 hit-test 选择状态，再交替执行 60 次可信指针点击，逐次核对选中结果。
4. 交错执行 30 次物件 0/1° 旋转与 30 次轮廓 ±1 mm 编辑；每次须增加一个 revision，完成预览并 `flush()` 保存。室外轮廓使用产品的 `terrainPointCommandsV2`，包含共享轮廓与浅水覆盖更新。
5. 仓库重开，核对完整文档、资源 key 及快照数量；分别导出 GM/player 固定 4K PNG。
6. 拒绝 4097 长边，继续编辑/撤销/保存，并等待最终 revision 的实际画布；第一轮另生成完整工程备份。
7. 所有上述产品导出完成后，才进入单独的工具像素审计/下载阶段；随后观察约 2 秒尾部空闲并停止采样。

“冷”表示本轮新浏览器进程、配置文件和空 IndexedDB；没有清除操作系统文件缓存，也没有证明断网冷启动。“热”表示同一运行时、工程 Blob 和已用过的资源；应用没有跨 render 的解码 Bitmap 缓存，浏览器内部缓存策略未被强行清除。

## 计时与统计口径

| 字段 | 实际边界与限制 |
|---|---|
| `runtimeNavigationMs` | Node 侧导航至专用 API 就绪，单独于工程打开；不能与页面侧时间戳直接相减 |
| `cold.fetchMs` / `strictImportMs` / `adoptPersistMs` | 页面侧读取完整包、严格导入、采用及保存的连续阶段；采用还包括再次完整校验和安装，不是纯数据库写入 |
| `cold.fullDisplayMs` | 从工程 fetch 开始，至实际画布复制后的双 rAF 调度近似值；不包含运行时导航 |
| `selectionHandlerMs` | Canvas click 的 DOM capture 至产品 hit test 回调；不包含事件进入页面前的输入排队，也不等同完整 INP |
| `eventToCanvasCopyMs` / `canvasCopyMs` | 到产品 Canvas 复制和选中效果的同步调用完成；不是 GPU 完成或最终屏幕呈现时间 |
| `eventToPaintMs` / `displayProxyMs` | 在上述真实 Canvas 更新之后等待两个 rAF 的调度近似值；不是以空转 rAF 代替产品交互，也不是显示器呈现测量 |
| `commitMs` | 已准备好的命令进入 `WorkspaceV2.execute` 至同步提交结束，含实际领域校验/候选守卫/冻结/发布；**不包含命令构造** |
| 编辑的 `canvasCopyMs` / `displayProxyMs` | 同样从命令准备完成后开始；室外 helper 内的文档 clone 与轮廓准备不在此窗口，不能称整个工具操作的端到端延迟 |
| `validationProjectionMs` | 严格场景校验、快照/受众投影和尺寸/能力检查 |
| `resourceVerificationMs` | 资源记录、Blob 读取、真实 header/CRC/SHA 校验；与 native 解码分开 |
| `decoderQueueWaitMs` / `imageDecodeMs` | 当前实现分别记录共享槽等待与 native `createImageBitmap`；旧直连 baseline 没有等待字段，汇总按 0 处理 |
| `drawSubmissionMs` | 同步 `drawProjection` 提交，未包含输出 Canvas/context 创建；不是 GPU 时间 |
| render `totalMs` | 本次 render 总耗时至临时资源释放，未含 observer 和 PNG 编码；各子阶段不必恰好相加为该值 |
| 编辑 `flushMs` | 画布调度近似值之后尚需等待的保存尾部，可能因自动保存已经完成而很小；不是完整保存时长 |
| `warmSaveMs` | 仓库 save 的实测持续时间，只取起止都落在编辑窗口内的保存；排除冷采用与故障恢复保存，不证明磁盘 fsync 耐久性 |
| PNG `durationMs` / `encodeAndFlushMs` | 前者为完整 export wall time，后者为减去 render 的残差，仍含调度/编码/释放开销，不是编码器 CPU 时间；不含额外 RGBA 审计 |

页面时间来自 `performance.now()`；资源轮询还保存自己的起止和相位标记。`decoderCalls` 是所有被包装的 native 调用记录，包含验证、渲染和最终工具审计，分析时需按窗口区分。

每轮保留操作级原始数组和统计。`summary.json` 的编辑/选择指标跨同一组的三轮合并，按 `sorted[ceil(n*q)-1]` 取 nearest-rank p50/p95，不平均三个 p95，也不以均值代替 p95。默认每组有 180 次编辑、90 次每类编辑及 180 次选择；冷打开和每个受众导出仅各 3 次，p95 即这三次中的最大值。必须连同样本数、每轮差异和原始窗口解释结果。固定夹具的一毫米编辑不能证明自由拖拽、缩放、绘制或全部地图交互已达标。

## 资源采样与像素审计

`resources.mjs` 独立按目标约 **100 ms** 轮询专用 Chrome 根 PID 的当前子树 RSS，按约 **200 ms** 通过目标 CDP session 读取 JS heap。前者将单次 `ps` 中该树的 RSS 相加，后者只描述所连接页面目标。它们都是采样观测，主线程阻塞和 `ps` 持续时间会延长真实间隔，短暂峰值可能落在采样之间。

- 保存每个样本的请求/响应时间、起止 phase、真实间隔、轮询耗时、缺失与错误；不能把配置的 100/200 ms 当作实际间隔。
- RSS 可能重复统计共享映射，重归属到树外的进程不会纳入；它不是去重物理内存、完整浏览器内存、GPU/Metal 分配峰值或机器总内存。
- 不同进程类型的采样峰值可能不同时发生，不能相加。像素数 ×4 仅是理论 RGBA 下界，不能替代任何实测峰值。
- `byPhase` 仅使用请求与响应都处于同一 phase 的样本。跨界样本保留在全局原始数据与全局峰值中，但不属于单一阶段；某个短阶段样本数为 0 时，该阶段是缺失证据。
- `productRssSampledPeakBytes` 为非 tooling、非尾部 idle 的单阶段 RSS 峰值中的最大值，包含导航、冷打开等产品阶段，**不含跨 phase 样本**。它比全局窗口更窄，也不是连续峰值或精确的单次导出峰值。
- `globalIncludingAuditRssSampledPeakBytes` 与 `jsHeapSampledPeakBytes` 均包含工具审计、下载及尾部空闲。尤其后者不能直接标成“产品 JS 堆峰值”；需要单阶段产品值时读取原始 `byPhase` 并明确边界。
- `resourceEvidenceStatus=sampled` 只表示存在有效根进程/heap 样本且无采样错误，不保证每个短阶段都有充足样本。查看各阶段计数、跨界数和间隔，不能仅靠这个状态宣称完整峰值已覆盖。
- 没有强制 GC、heap snapshot、GPU dump 或全系统内存测量。尾部 idle 值也不构成泄漏排除证明。

额外 PNG 解码、4K 审计 canvas、`getImageData`、哈希和下载统一放在 `tooling-pixel-audit-and-download`，防止把审计自身的大数组当作产品导出成本。先等待失败后编辑/撤销的最终画布，避免工具审计解码与未完成预览交叠。跨轮 RGBA hash 相同只说明该固定负载输出确定；秘密内容的 GM/player 配对、玩家不泄漏及完整工坊流程须引用单独的真实浏览器回归证据。

## B5历史baseline、撤回候选与当批最终构建

历史正式 baseline 的 12 轮观测到 native decoder 在途峰值 **2**，与候选预算 1 不符。当前代码使用 `io/v2/resources.ts` 的共享单槽，覆盖同一页面模块实例中的验证、规范化和 renderer；这是并发预算修复；B5当批最终冻结构建的正式12轮实测峰值均为 **1**，记录见21及final原始observations。该槽覆盖同一页面模块实例，不是跨标签页/Worker/整个机器的信号量。

历史 `candidate-reuse` 同时包含单槽修复和同尺寸 paint canvas 重用，key 变化时恢复单位变换并全幅清空。其正式 12 轮已完成并保留原始数据；四组产品 RSS 采样峰值均高于 baseline，室外 2000 的绘制提交与显示调度近似值也出现退化，因此该重用方案已经撤回。浏览器可能进行源快照、延迟提交或写时复制，不能仅按 JS canvas 数量宣布底层资源下降，也不能只凭 RSS 证明具体分配机制。

最终源码保留共享 decoder 单槽及临时资源所有权修复：相同 key 继续使用已有 paint，key 变化时先释放旧画布、分配新画布，并在获取 context/创建 pattern 前登记所有权；不再进行同尺寸重用及其 reset/clear。B5当批最终冻结构建已独立跑完12轮，不能沿用已撤回候选的通过结论；复现或后续修改仍须按实际受测构建另行记录。`candidate-reuse` 与最终构建可用于比较重用策略；baseline 与最终构建之间还包含 decoder 预算及所有权修复，耗时和资源差异须按这三个实际构建分别报告。数值、逐轮波动、RGBA/夹具一致性及最终判断统一见验证报告。

## 诊断、失败与输出

只验证环境/运行链路，可使用新目录短跑：

```sh
npm run perf:b5 -- --output performance-results/b5-smoke --runs 1 --edits 2 --selections 6 --cases study-500 --channel chrome
```

该命令只产生 `diagnostic-smoke`，不能替代正式矩阵。此短跑不足 20 个快照，不适用正式汇总器的快照门槛，直接查看 manifest 和逐轮 JSON。`--edits` 为每类次数且必须是正偶数，使可逆轮廓返回原几何；所有数值参数必须是正整数。`measurementClass=formal` 仅是次数分类，仍须确认四组齐全、全部轮次完成及最终验收证据。

## C0 归档夹具与真实工作台

C0方法与结果由[22](../../docs/archive/m0-m1-validation.md#doc-22)独立记录，21及其原始证据保留。`run-b5.mjs --fixtures /absolute/archive` 会逐字节复制已完成归档的完整包，检查包SHA/长度、内部场景SHA/身份/数量/范围与资源摘要，同时保存原summary指纹。每次冷打开仍经过完整产品读取器，不以工具的摘要检查代替资源校验。

保留的B5专用入口使用生产视口CSS和双层画布，长边1200栅格不变；主画布用aria标签定位。原`startMs`、`commitMs`和`displayProxyMs`保留命令准备完成后的起点，新增`intentStartMs`在读取当前工程和构造命令之前。`prepMs`、`intentToCommitMs`、`intentToCanvasCopyMs`、`intentToDisplayProxyMs`逐次保留，汇总器仅在新字段完整时输出新增统计。专用入口的意图是工具调用起点，不冒充真实用户事件。

正常生产工作台测量使用以下独立运行器，无需Vite服务或产品测量API：

```sh
npm run build
node tools/performance/run-c0-workbench.mjs --output "$PWD/performance-results/c0-workbench" --fixtures "$PWD/tests/fixtures/performance-b5" --runs 3 --edits 10 --channel chrome
```

默认四组×3个新Chrome进程，每轮10次物件编辑、10次轮廓预览及10次采用，原始事件分别保存。工具只安装采集用init-script，真实可信Enter capture开始计时；focusout capture至document bubble经过React同步处理，包含命令准备与候选校验；采用点击单列。MutationObserver观察到新底图计数、正确修订及主画布可见后等待双rAF。`event.timeStamp`至capture只描述浏览器创建事件后的排队，不含物理设备时间。

每轮另执行30次平移pointermove和20次滚轮，按rAF发出可信事件，保留事件至DOM变换/双rAF、合并事件归属与rAF间隔；校验视口不改变修订、保存状态或底图计数。自动化节奏、观察器与浏览器调度均会影响结果；没有GPU完成、输入到光子、自由物件拖动或完整QA-PERF-01/04结论。该运行器不采集资源峰值，RSS/CDP数据只引用专用模块矩阵。

`--output`、`--fixtures`必须绝对路径；输出须为空。`--cases study-500 --runs 1 --edits 2`只做诊断，不归类为正式工作台观测。失败保留partial及manifest，不自动重试；正常dist的全部字节在前后核对。正式两组采样与其他浏览器/测试/构建串行，源码/构建指纹另行保存。

每轮产品计时和资源采样结束后，采集器直接关闭自己启动的BrowserServer；不先等待远程Browser关闭通知。收尾有独立限时：必要时终止本轮专用进程，根进程已退出后才释放其继承管道，确认退出才启动下一轮。实际收尾方式和耗时单列`manifest.teardowns`，不计入产品性能；失败则停止矩阵，不自动续跑或混入中断批次。

每轮原始文件为 `<case>-run-N.json`，含时间窗口、操作、render/save/native decoder、资源样本/汇总、GPU 信息、错误、双受众 PNG 尺寸与 hash。第一轮保留 PNG、编辑后的完整工程和预览截图，工程含失败恢复后撤销产生的新 revision。`fixtures/` 和 manifest 保留各负载的完整工程与资源/alpha/几何统计。源 alpha 面积会重复计入实例交叠，投影纳入数也不是遮挡后的实际可见数。

失败不会自动重试：manifest 标记 failed，已有完整轮次保留，当前轮另写 `-partial-failure.json` 和已取得的资源样本。默认 action timeout 为 30 秒；画布等待有 30 秒诊断上限，页面另有 8 分钟 watchdog。这些是防挂起限制，不能当成产品性能通过线。失败文件可能不含尚未采到的页面 observations，不能补造缺失数据。修复后使用新输出目录，并保留失败与复测的对应关系。
