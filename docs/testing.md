# 检查方法

按本次能力和改动选择检查，结果直接说明通过、失败或未运行。记录命令、实际结果和必要环境即可；只有性能、模型或外部软件兼容需要额外注明负载/输入、设备、版本和方法。不再要求每次建立编号报告、复制源码快照或回填多份台账。

<a id="core-journey"></a>
## 编辑、保存、重开与PNG

使用现有[完整页面旅程](../tests/complete-journey-ux.spec.ts)，覆盖桌面和390px页面上的生成、编辑、撤销重做、保存重开、完整备份、空存储导入及双受众4K PNG。用普通生产构建执行，测试创建独立浏览器存储，不读写用户个人库。

1. 运行`npm run build`。
2. 运行`npm run test:e2e:production -- tests/complete-journey-ux.spec.ts --workers=1 --retries=0`。Playwright自行在`http://127.0.0.1:4173/sceneweave/`启停生产预览。
3. 测试会读取实际下载的完整工程、重开结果和 PNG。需要在测试结束后打开图片或下载包时，运行前设置 `SCENEWEAVE_KEEP_TEST_OUTPUT=1`。

通过条件包括编辑实际生效、撤销重做正确、重开后内容与资源完整、备份导入后可以继续编辑，以及 PNG 尺寸正确且能够解码。PR 与 Pages 工作流运行前端和 AI 全量单测、生产构建及 Chromium 编辑、恢复、保密与 VTT 回归，并在 Firefox 与 WebKit 复验生产版导入和下载。标准开发浏览器套件每周运行，也可在 Actions 勾选 `extended` 手动运行。合成夹具的失败诊断可在 Actions 下载。

<a id="release-compatibility"></a>
## 已发布工程的兼容回归

基线取自提交 `80162f9176628569f8de38f7188d89c1dd8f7ad6`。调查场景沿用该构建的首页下载原件。其余三个输入由该提交的写入器和自有 1 像素素材生成，分别为含命名快照的工程、含固定素材与个人标签的库备份、以及含两条子分支的 IndexedDB 原始表结构和记录。文件保存在[固定样本目录](../tests/fixtures/project-compatibility)，读取前按[发布样本摘要](../tests/helpers/release-fixtures.ts)核对原字节。

- `npx vitest run src/platform/browser/storage/release-compatibility.test.ts` 检查旧包、素材身份、原始内容块、分支和快照，继续保存后冷读复核。
- `npx vitest run src/platform/browser/content/image-workflow-store.test.ts` 检查旧图片草稿整理、共享图片、跨窗口版本比较和原工作包逐字节恢复。
- `node --test tools/harness/map.test.mjs tools/image-import/workflow-host.test.mjs` 检查默认地图复验回执、独立交付、缓存回收和本机拆件断点的重新打开。
- `npm run test:e2e:production -- tests/release-compatibility.spec.ts --project=chromium` 使用生产构建从首页导入发布样板，在工作台改名、落盘、冷开并下载备份，逐项核对场景、身份、外观、资源和许可。另对同一张图分别带入和省略主持人扩展，核对玩家 PNG 的实际文件摘要，以及主持人备份中的原文。

Pages 上传前运行这两组检查和素材包合同测试。修改已发布结构或新增持久语义时，将相应旧写入器的原始样本追加到回归中。已有样本及其摘要固定保留。

<a id="checks"></a>
## 按改动选择

| 改动 | 检查入口 |
|---|---|
| 纯逻辑/领域命令 | `npx vitest run <相关文件>` |
| 共享边界 | `npm run check:architecture`、`npm run check:shared` |
| 类型或生产接线 | `npm run typecheck`、`npm run build` |
| 页面操作 | 开发回归用`npm run test:e2e -- tests/<相关文件>.spec.ts`，生产旅程用`npm run test:e2e:production -- tests/<相关文件>.spec.ts` |
| 工作流正文/元数据 | `npm run workflows:sync`、`npm run check:workflows`，以及`src/shared/ai/workflows/catalog.test.ts` |
| MCP 制作与接续 | `node --test --test-concurrency=1 tools/harness/forest-server.test.mjs tools/image-import/workflow-host.test.mjs` |
| 通用助手制图 | `node --test tools/harness/map.test.mjs`，按本机情况选择 Chromium 或 Chrome |
| AI服务 | `npm run ai:test -- <相关文件>`；受控响应与真实付费模型分开 |
| 全量回归 | 整合或发布时按需运行`npm test`、`npm run ai:test`、`npm run test:e2e`和`npm run test:e2e:production` |

默认Playwright配置启动开发服务，生产配置启动同版构建的预览。已有匹配服务时可通过`SCENEWEAVE_TEST_BASE_URL`指定地址。系统Chrome/Edge可用`SCENEWEAVE_BROWSER_CHANNEL`选择。依赖本机作品的专项需要提供用例指定的输入，具体条件见[测试导航](../tests/README.md)。

### 通用助手首次制图

助手拿原始需求、参考图（如果有）和随候选版本交付的公开入口。评审从助手收到任务开始计时，包含能力发现、读图、返工和技术核对。第 15 分钟观察实际进展，另记首张真实预览、首份已复核版本和实际交付时间。第 40 分钟核对已收到的工程和视图。比较模型时再用同一任务测试第二位助手。当前回归题稳定后，换室内、地形、混合构图及开发时留出的需求。脚本执行时间用于诊断，验收使用端到端墙钟时间。

开跑前从干净副本按公开说明安装并走通出图、局部修改及普通首页重开。复用真实失败案例检查对应修复，例如给台阶指定绕行侧，或测量低地中地标的实际高差。用 `map verify --editor reopen` 核对未改动工程和双视图，并走真实首页导入。美术签收和工程冷读分别记录。

Playwright升级后用`npx playwright install`安装匹配引擎；不要用旧浏览器目录替代新版本。海洋素材的固定WASM逐像素校验在Windows旧WebKit 26.0曾间歇性失败，旧失败与新引擎结果分别保留，不能据此推定真实Safari已测。

保存/历史/导入改动需检查完整往返、坏资源拒绝、取消/配额保全及CAS冲突；渲染/秘密改动需检查GM和player实际像素、隐藏几何变形及文件元数据。不能通过删断言、丢资源或缩小原目标把失败改为成功。

专用阶梯检查使用`src/shared/stairs/*.test.ts`和[页面旅程](../tests/staircase-tools.spec.ts)：覆盖完整踏面分割、重复/拉伸及纹理尺度、覆盖可逆、锁/过期候选、撤销重做、资源备份冷读与双受众PNG。可选私有岩岛用例仅在明确设置`SCENEWEAVE_STAIRCASE_REFERENCE`时执行，未提供输入时跳过；通用夹具通过不代表岩岛美术签收。

图片完整补片边界衔接需检查旧 `context` 与 `context-blend` 重放、`context-blend-v2` 的同尺寸补区预算，以及移除、保护、前序推断和物件证据排除。实际作品按原尺寸及放大检查板缝、边缘和移转露底，分别冷开制作包、可编辑工程和个人库。

<a id="performance"></a>
## 性能

先复现有体感的问题并定位瓶颈，再选择现有运行器。生产测量独占串行，使用相同输入/操作和正常构建，记录设备、浏览器、对象/资源负载、样本数、p50/p95/max及缺样。诊断插桩、低样本观察和跨机器数字分别说明，不混成正式分布。

500物件交互目标仍为帧p95≤33ms、领域提交p95≤100ms；2000物件作为压力评估，保存与导出耗时另列。Windows Working Set/私有提交与macOS RSS分开，未测峰值不能由单点heap或理论分配替代。当前整体性能仍有未解决项，见[剩余事项](roadmap.md#remaining)。

斜俯视可用 `prepare-current-formal.mjs --mode capacity --cases mixed-500,mixed-2000 --output <绝对路径>` 准备完整夹具。设置 `SCENEWEAVE_OBLIQUE_FIXTURES` 为夹具目录后运行 `oblique-preview.spec.ts`，逐角度检查 500/2000 物件的绘制调用分别不超过 45/60 次，同时核对贴图总像素、三角面上限、接近预算上限时的贴图上传次数和缩回后的画面。耗时与显存在生产构建上单独测量。

具体工具只在[性能工具说明](../tools/performance/README.md)维护。其他会话正在测量时，不并行运行构建、浏览器测试或新的性能任务。

<a id="external"></a>
## 真实效果与发布

- UVTT兼容以明确版本的目标软件和导入器实际导入为准，检查比例、墙门、秘密、灯光和玩家视角。
- AI收益比较相同需求的完整交付、人工修正、缺项和实际用量；mock、工具成功或回复速度不能代替。
- 视觉检查实际全景和关键近景。用户美术签收由用户完成，自动化和代理看图分别说明。
- 能力可以按明确范围独立交付。提交、推送、部署与公开发布按当前授权执行；历史授权不延续。

常规 Playwright 配置仅留失败运行的截图、下载包和 trace。需要保留通过用例的输出和生成 HTML 报告时设置 `SCENEWEAVE_KEEP_TEST_OUTPUT=1`。单独的视觉验收配置按自身设置保留复核产物。可复现夹具和回归测试留在仓库。
