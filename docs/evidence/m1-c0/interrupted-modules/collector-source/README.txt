# B5 真实素材负载复现

该工具测量 VIS-01 书房与露台、VIS-02 双层岩岛的 500/2000 物件副本。它通过独立生产入口复用实际 `AssetCanvas`、`WorkspaceV2`、样板候选守卫、资源校验、IndexedDB 仓库及 PNG 管线。普通 `npm run build` 不暴露 `window.__sceneweavePerformance`。

这里定义复现方法，不预先宣布最终性能或容量通过。实际版本、设备、原始数据、失败记录及退出判断以 [B5 验证报告](../../docs/21-m1b-b5-validation.md) 为准。普通负载保留原创真实材质、透明物件、覆盖层和阴影；高密度摆放允许视觉重叠，不是可玩布局或美术验收。

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

## baseline、已撤回候选与最终构建

历史正式 baseline 的 12 轮观测到 native decoder 在途峰值 **2**，与候选预算 1 不符。当前代码使用 `io/v2/resources.ts` 的共享单槽，覆盖同一页面模块实例中的验证、规范化和 renderer；这是并发预算修复；本次最终冻结构建的正式12轮实测峰值均为 **1**，记录见21及final原始observations。该槽覆盖同一页面模块实例，不是跨标签页/Worker/整个机器的信号量。

历史 `candidate-reuse` 同时包含单槽修复和同尺寸 paint canvas 重用，key 变化时恢复单位变换并全幅清空。其正式 12 轮已完成并保留原始数据；四组产品 RSS 采样峰值均高于 baseline，室外 2000 的绘制提交与显示调度近似值也出现退化，因此该重用方案已经撤回。浏览器可能进行源快照、延迟提交或写时复制，不能仅按 JS canvas 数量宣布底层资源下降，也不能只凭 RSS 证明具体分配机制。

最终源码保留共享 decoder 单槽及临时资源所有权修复：相同 key 继续使用已有 paint，key 变化时先释放旧画布、分配新画布，并在获取 context/创建 pattern 前登记所有权；不再进行同尺寸重用及其 reset/clear。本次最终冻结构建已独立跑完12轮，不能沿用已撤回候选的通过结论；复现或后续修改仍须按实际受测构建另行记录。`candidate-reuse` 与最终构建可用于比较重用策略；baseline 与最终构建之间还包含 decoder 预算及所有权修复，耗时和资源差异须按这三个实际构建分别报告。数值、逐轮波动、RGBA/夹具一致性及最终判断统一见验证报告。

## 诊断、失败与输出

只验证环境/运行链路，可使用新目录短跑：

```sh
npm run perf:b5 -- --output performance-results/b5-smoke --runs 1 --edits 2 --selections 6 --cases study-500 --channel chrome
```

该命令只产生 `diagnostic-smoke`，不能替代正式矩阵。此短跑不足 20 个快照，不适用正式汇总器的快照门槛，直接查看 manifest 和逐轮 JSON。`--edits` 为每类次数且必须是正偶数，使可逆轮廓返回原几何；所有数值参数必须是正整数。`measurementClass=formal` 仅是次数分类，仍须确认四组齐全、全部轮次完成及最终验收证据。

## C0 归档夹具与真实工作台

C0方法与结果由[22](../../docs/22-m1c-c0-validation.md)独立记录，21及其原始证据保留。`run-b5.mjs --fixtures /absolute/archive` 会逐字节复制已完成归档的完整包，检查包SHA/长度、内部场景SHA/身份/数量/范围与资源摘要，同时保存原summary指纹。每次冷打开仍经过完整产品读取器，不以工具的摘要检查代替资源校验。

当前专用入口使用生产视口CSS和双层画布，长边1200栅格不变；主画布用aria标签定位。原`startMs`、`commitMs`和`displayProxyMs`保留命令准备完成后的起点，新增`intentStartMs`在读取当前工程和构造命令之前。`prepMs`、`intentToCommitMs`、`intentToCanvasCopyMs`、`intentToDisplayProxyMs`逐次保留，汇总器仅在新字段完整时输出新增统计。专用入口的意图是工具调用起点，不冒充真实用户事件。

正常生产工作台测量使用以下独立运行器，无需Vite服务或产品测量API：

```sh
npm run build
node tools/performance/run-c0-workbench.mjs --output "$PWD/performance-results/c0-workbench" --fixtures "$PWD/docs/evidence/m1-b5/final" --runs 3 --edits 10 --channel chrome
```

默认四组×3个新Chrome进程，每轮10次物件编辑、10次轮廓预览及10次采用，原始事件分别保存。工具只安装采集用init-script，真实可信Enter capture开始计时；focusout capture至document bubble经过React同步处理，包含命令准备与候选校验；采用点击单列。MutationObserver观察到新底图计数、正确修订及主画布可见后等待双rAF。`event.timeStamp`至capture只描述浏览器创建事件后的排队，不含物理设备时间。

每轮另执行30次平移pointermove和20次滚轮，按rAF发出可信事件，保留事件至DOM变换/双rAF、合并事件归属与rAF间隔；校验视口不改变修订、保存状态或底图计数。自动化节奏、观察器与浏览器调度均会影响结果；没有GPU完成、输入到光子、自由物件拖动或完整QA-PERF-01/04结论。该运行器不采集资源峰值，RSS/CDP数据只引用专用模块矩阵。

`--output`、`--fixtures`必须绝对路径；输出须为空。`--cases study-500 --runs 1 --edits 2`只做诊断，不归类为正式工作台观测。失败保留partial及manifest，不自动重试；正常dist的全部字节在前后核对。正式两组采样与其他浏览器/测试/构建串行，源码/构建指纹另行保存。

每轮原始文件为 `<case>-run-N.json`，含时间窗口、操作、render/save/native decoder、资源样本/汇总、GPU 信息、错误、双受众 PNG 尺寸与 hash。第一轮保留 PNG、编辑后的完整工程和预览截图，工程含失败恢复后撤销产生的新 revision。`fixtures/` 和 manifest 保留各负载的完整工程与资源/alpha/几何统计。源 alpha 面积会重复计入实例交叠，投影纳入数也不是遮挡后的实际可见数。

失败不会自动重试：manifest 标记 failed，已有完整轮次保留，当前轮另写 `-partial-failure.json` 和已取得的资源样本。默认 action timeout 为 30 秒；画布等待有 30 秒诊断上限，页面另有 8 分钟 watchdog。这些是防挂起限制，不能当成产品性能通过线。失败文件可能不含尚未采到的页面 observations，不能补造缺失数据。修复后使用新输出目录，并保留失败与复测的对应关系。
