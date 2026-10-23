# 贡献说明

织境 · Sceneweave 当前本地版本为 `0.2.0-m1-c5`，C5联合功能与最终生产通过，正式性能矩阵未完成，性能门未通过。M0几何版原型首轮验证完成，M1-C/C1a已实现空白完整工程与物件放置/修改/删除闭环，C1b已实现框选/多选、右键及有限原子批量操作，C1c新增严格v3用户图层和暂态隐藏管理，C1d增加独立v4历史信封、命名/保护快照和首批独立物件局部恢复，C2增加空白绘房、共墙、附着门窗、量尺与会话内结构恢复，C3增加独立v5组件工程、素材入库、非破坏性参数、固定组合及适用局部恢复，C4增加严格v6室外工程、地形/道路/散布工具和有限持久室外恢复；完整编辑器、AI与真实小团验证仍按[路线图](docs/07-roadmap.md)推进。

室内/室外路线按M1-A/B/C/D推进。B1完整素材工程证据见[17](docs/17-m1b-b1-validation.md)；B2新增VIS-01、原创室内素材、有限原子编辑和共用预览/PNG，证据见[18](docs/18-m1b-b2-validation.md)。[视觉规范](docs/14-visual-and-asset-system.md)、[素材清单](docs/15-m1a-asset-production-list.md)与[交接](docs/16-m1a-handoff.md)给出主定义。B3室外样板、散布与有限通行证据见[19](docs/19-m1b-b3-validation.md)；B4完整性诊断、三组48格受众配对和双样板存档/失败矩阵见[20](docs/20-m1b-b4-validation.md)。B5真实负载/资源观测、预算与限制见[21](docs/21-m1b-b5-validation.md)，C0性能与视口基础见[22](docs/22-m1c-c0-validation.md)。C1a空白创作的实现范围和本批检查见[23](docs/23-m1c-c1a-validation.md)，C1b适用检查见[24](docs/24-m1c-c1b-validation.md)，选择性能及C1c图层实现验证见[25](docs/25-selection-performance.md)/[26](docs/26-m1c-c1c-validation.md)，C1d命名快照/首批独立物件局部恢复与完整历史工程见[27](docs/27-m1c-c1d-validation.md)，C2建筑工具及会话内结构恢复见[28](docs/28-m1c-c2-validation.md)，C3组件与参数外观见[29](docs/29-m1c-c3-validation.md)，C4室外工具与有限恢复见[31](docs/31-m1c-c4-validation.md)，C5联合验证和现版性能结论归[32](docs/32-m1c-c5-validation.md)。完整M1、主题P3、SCN-04与全交互性能仍按各自门槛判断；新模型同步格式、迁移和验收。

当前完整创作入口为 `/#outdoor` 室外工坊，包含场景、建筑、室外和历史面板。新建空白工程携带18个既有B2/B3物件素材和10种材质；物件放置支持画布点击或坐标输入、显式支撑面和暂态预览。建筑绘制、地形/道路/散布、组合、图层和有限外观调整使用统一原子事务。静态PNG/JPEG/WebP可显式入库；源与派生字节、完整许可随工程保存、重开和完整包。当前严格v6信封包含有效v3场景、appearance1与identity3，显式v3视图仅用于领域/渲染，不能替代完整保存。v2→v3→v4→v5→v6均为独立副本迁移并保留旧原件/来源链，旧历史留原库。建筑恢复仍要求本会话连续性witness，持久身份只扩展至明确支持的室外实体；有限局部恢复范围见[28](docs/28-m1c-c2-validation.md)、[29](docs/29-m1c-c3-validation.md)和[31](docs/31-m1c-c4-validation.md)。

C5联合验收批次冻结349份应用源码，最终单元82文件979/979通过（68.85秒），正常构建通过（2.75秒）；最终全量Chrome168/168通过，0失败/重试/跳过（12.8分钟）；最终正常生产UI通过（46.791秒）；study/island×500/2000各三轮正式性能矩阵未完成，已执行批次未形成可合并的完整p95结果。优化后study-500单次诊断普通领域提交1110.4ms，优化前诊断2174.2ms，均不是正式分布且仍超100ms；性能门未通过，本批不能宣布C5或全交互性能通过，实际证据与待验项见[32](docs/32-m1c-c5-validation.md)。

其后资源复用批次通过992项单元、20项适用Chrome及正常构建/生产UI，独立诊断归[33](docs/33-c5-resource-reuse-validation.md)。2026-10-23用户要求将余下性能优化暂缓，待其他需求完成后集中处理；性能欠项暂不阻塞后续需求开发，正式性能门保持未通过。后续入口见[34](docs/34-performance-followup.md)，后续功能仍运行适用正确性回归，不因暂缓改为性能通过或容量承诺。

## 开发环境与命令

建议使用.nvmrc的Node.js24.14.1；B2/B3/B4使用该版本/npm11.11.0，B1历史覆盖24与26，依赖由package-lock.json锁定。package.json允许Node.js>=22.12.0且<27；其他允许版本不等于已验证。

```sh
npm ci
npm run dev
```

开发服务默认绑定 127.0.0.1:5173。端口对应独立的浏览器存储来源；更换端口或清站点数据前下载主持人工程备份。

```sh
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Vitest 运行 `src/**/*.test.ts` 中的领域、存储、工程文件及渲染测试；Playwright 使用 `tests/` 下的浏览器旅程，会按配置启动本地服务或复用已有同端口服务。默认安装并使用 Playwright Chromium。系统 Chrome 可用时也可运行：

```sh
SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e
```

测试使用独立 profile/浏览器上下文。M0历史在系统 Chrome 上通过 13 个浏览器测试，另有 95 个单元测试（8 文件）、构建与生产依赖审计通过，见 [M0 验证报告](docs/13-m0-validation.md)。B1历史检查、环境和未测范围见[17](docs/17-m1b-b1-validation.md)，C1a历史批次见[23](docs/23-m1c-c1a-validation.md)，C1b历史批次见[24](docs/24-m1c-c1b-validation.md)。构建、单元和浏览器证据分别记录；C1a浏览器旅程位于 `tests/c1a-creation.spec.ts`，可用 `npm run test:e2e -- tests/c1a-creation.spec.ts` 定向执行，C1b选择/菜单/批量及500/2000物件真实框选回归位于 `tests/c1b-selection.spec.ts`，可用 `npm run test:e2e -- tests/c1b-selection.spec.ts` 定向执行。需要使用系统Chrome时设置 `SCENEWEAVE_BROWSER_CHANNEL=chrome`；复用B5正式完整夹具可设置 `SCENEWEAVE_B5_FIXTURE_DIR=docs/evidence/m1-b5/final`。实际结果以验证记录为准。

生产构建在 dist/；可使用 `npm run preview` 在本地检查构建结果。[GitHub Pages 工作流](.github/workflows/deploy.yml)在推送 main 或手动触发时，读取 `.nvmrc` 安装 Node，执行 `npm ci` 和 `npm run build` 后部署静态站点至[在线预览](https://wojisama.github.io/sceneweave/)。该工作流只负责构建和部署，不代替上述单元/浏览器验证；成功结果以 GitHub Actions 运行记录为准。它不包含 AI 网关、工程云同步或正式发行版流程。

## B5性能复现

当前v2素材预览/PNG使用原生Canvas2D，M0几何工坊使用Konva。B5采用独立生产工具入口，复用实际AssetCanvas、Workspace、样板候选守卫、资源校验和仓库；正常 `npm run build` 只构建应用，不暴露专用性能API。

```sh
npm run build:performance
npm run perf:b5
```

专用产物位于 `dist-performance/`，运行器自行创建仅绑定回环地址的临时服务，输出默认保存在 `performance-results/b5/`。运行器默认使用系统Chrome，每个VIS-01/02的500/2000物件组合分别启动三个独立浏览器进程；每轮执行30次物件编辑、30次轮廓编辑与60次真实指针选择，并记录导入、保存、重开和双受众4K。B5历史口径见[21](docs/21-m1b-b5-validation.md)，C0新增命令准备与真实工作台测量见[22](docs/22-m1c-c0-validation.md)。

C0复用B5原始完整包，`--fixtures` 必须是包含manifest和fixtures的绝对目录；每次选择独立输出，禁止覆盖历史。两类测量必须依次运行，不能与浏览器测试或构建并行：

```sh
npm run build:performance
npm run perf:b5 -- --output performance-results/c0-modules --fixtures "$PWD/docs/evidence/m1-b5/final"
node tools/performance/summarize-b5.mjs performance-results/c0-modules
npm run build
node tools/performance/run-c0-workbench.mjs --output "$PWD/performance-results/c0-workbench" --fixtures "$PWD/docs/evidence/m1-b5/final"
```

第一组保留原事务计时并新增准备前起点；第二组只通过正常生产页面真实操作，分列Enter提交、轮廓候选、采用点击与视口手势。两组数据不混池，双rAF均是调度代理。`SCENEWEAVE_B5_FIXTURE_DIR`可为 `tests/b5-workbench.spec.ts`、`tests/c0-viewport.spec.ts`提供相同归档包，在正常生产地址配合 `SCENEWEAVE_TEST_BASE_URL`验证，无需DEV API。

现有RSS采样使用macOS `/bin/ps` 的进程树与单位约定，完整复现目前仅支持macOS；Linux/Windows的资源采集尚未适配。系统需已安装Chrome，仅安装Playwright Chromium不提供默认Chrome通道。所有正式测量串行运行，期间不并行运行单元/浏览器测试、构建或其他性能任务；macOS运行器使用本次命令范围内的防空闲休眠，不修改系统电源设置。

重测可用 `npm run perf:b5 -- --output performance-results/b5-recheck` 指定新目录，保留旧原始数据。少于默认轮数或操作数的运行仅作诊断，不替代正式采集；每类30次编辑的p95仍须连同样本数和各轮差异解读。进程树RSS和目标JS堆都是采样观测，不是完整浏览器/GPU物理峰值；Canvas提交、画布复制和双rAF显示调度近似值也须分别报告，不能把它们直接写成全部交互已达目标。

## 大量选择及native v3复测

使用正常生产构建、同一B5原始完整包和独立空输出目录；每组3个新Chrome进程、每轮30次框选/30次替换选择。`layers` 路由通过真实UI把完整v2包迁为v3，不使用开发API；v2历史对照见25，v3独立结果见26。两次正式采集需依次执行，期间不运行其他浏览器/测试/构建：

```sh
npm run build
node tools/performance/run-selection.mjs --output "$PWD/performance-results/selection-assets-recheck" --fixtures "$PWD/docs/evidence/m1-b5/final" --workbench assets
node tools/performance/run-selection.mjs --output "$PWD/performance-results/selection-layers-recheck" --fixtures "$PWD/docs/evidence/m1-b5/final" --workbench layers
```

每个case每种操作90样本、nearest-rank p95；计时分列DOM就绪、双rAF显示调度代理和LongTask，完整包/资源/原始IDB/revision/保存/底图及采样窗口细节计数必须保持。双rAF不是GPU或物理呈现，也不替代完整交互/资源峰值矩阵。`--diagnostic`、`--isolate`、`--trace` 或减少轮数仅供诊断，不混入正式通过记录。

C1c真实UI、持久化/故障与双受众渲染矩阵可用 `SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c1c-layers.spec.ts tests/c1c-storage.spec.ts tests/c1c-renderer.spec.ts` 串行运行。v1/v2/v3读者分别严格分派，v3领域视图不可用于旧版渲染或落盘。

C1d真实UI、严格来源迁移、空存储离线历史往返、实际双标签CAS/故障和原生双受众像素用例可运行 `SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c1d-workbench.spec.ts tests/c1d-storage.spec.ts tests/c1d-renderer.spec.ts`。v4信封内仍为严格v3 SceneDocument；仅通过显式完整v3视图进入v3渲染/IO，完整v4包不得送入旧读者。实际证据及首批独立物件边界归27；此正确性矩阵不替代历史操作性能/容量或真实配额耗尽。

C2从空白建立建筑、共墙/门窗/注记/遮罩、缩放量尺、会话结构恢复与原生4K/离线往返可运行 `SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c2-workbench.spec.ts tests/c2-polygon-workbench.spec.ts tests/c2-structure-history.spec.ts tests/c2-renderer.spec.ts`。结构恢复须明确依赖及跨层确认；重开/导入后没有连续性witness，旧结构恢复会拒绝。本批不扩大持久结构身份、物件完整恢复或全交互性能声明；实际证据见[28](docs/28-m1c-c2-validation.md)。

## 修改流程

先读 [AGENTS.md](AGENTS.md) 与[文档导航](docs/README.md)，核对工作区和 Git 状态，保留无关修改。较小澄清直接改主文档；范围或数据契约变化同时更新[决策记录](docs/11-decisions-and-open-questions.md)及对应任务/验收。PR 说明具体问题、修改后的行为、相关验证与实际限制。

- 持久修改走领域命令和原子校验，不直接改冻结的 SceneHistory.document 或画布节点。
- 保存完整 SceneDocument；保留整数毫米、共享墙、门附着和单调 revision。
- 锁、候选失败、撤销与跨标签冲突不能以局部成功或最后写入覆盖处理。新增图层锁、固定范围批量操作及局部恢复同样遵守这些边界；持久化语义改变先更新04/06的版本和完整迁移。
- C5认证只复用内部严格解析、独立深冻结的document/historyIdentity/appearance三元对象引用；外部克隆、换任一元及未知/访问器/隐藏包装字段不能借旧认证，参见`src/core/v6/schema-certification.test.ts`。资源字节/hash/许可/预算、每次解码、依赖/锁/保护点/CAS继续校验；只变revision元数据的受控路径仍独立校验身份。
- 玩家预览、图层列表与 PNG 共用过滤规则，秘密像素和文本都纳入回归。
- 实现只接受声明支持的范围；尚未实现的硬约束应报错，不能省略后继续保存。

按改动运行相关验证。几何、事务、导入或保存协议变化需覆盖对应负例；浏览器交互变化需核查受影响旅程。仅文档修改检查链接、术语与事实即可，不为低影响可逆改动添加镜像实现的测试。

## 当前适合的贡献

- 用具体备团场景说明需求与卡点，注明规则体系、地图尺度和输出去向。
- 复核 M0 的共享结构、异常恢复、保密输出和可复现负载，补充真实证据。
- 按 M1-A/B/C/D 完善视觉规范、双样板、手工绘图、真实素材与组件，先用样板测量再扩展工具。
- M2以素材生成/同化为主线：单件→组合→明确范围的渐进批次，候选/入库/采用分别校验；旧布局/布景/文字为可选M2-L。M1先提供参数调整、原件/版本保护与局部恢复。
- 修正文档矛盾与含糊定义，附上来源或可复核的最小例子。

文档以中文为主，实体/字段名使用约定英文。新默认值要说明是产品偏好还是官方规则，并保留版本与来源。VIS-01/02首轮结果见[18](docs/18-m1b-b2-validation.md)/[19](docs/19-m1b-b3-validation.md)，B5技术观测见[21](docs/21-m1b-b5-validation.md)，C1a创作闭环见[23](docs/23-m1c-c1a-validation.md)，C1b有限选择/批改/菜单见[24](docs/24-m1c-c1b-validation.md)，选择性能、C1c与C1d见[25](docs/25-selection-performance.md)/[26](docs/26-m1c-c1c-validation.md)/[27](docs/27-m1c-c1d-validation.md)，C2建筑与有限恢复见[28](docs/28-m1c-c2-validation.md)，C3组件/参数及适用恢复见[29](docs/29-m1c-c3-validation.md)，C4室外/有限恢复见[31](docs/31-m1c-c4-validation.md)，C5联合功能与最终生产通过、性能未达和正式矩阵未完成结论见[32](docs/32-m1c-c5-validation.md)；其他浏览器、真实配额耗尽、完整主题P3、完整SCN-01/02/03/04与全交互性能尚未验证。不能由程序符号、单样板或有限支持操作推定完整通过。各批另建验证记录，保留13/17–23与各自原始证据。

## 内容与许可

原创贡献按本仓库 [MIT 许可](LICENSE)提供；第三方素材和规则标明各自来源与许可。请勿提交官方规则书全文、商业模组、API Key、个人聊天、私密工程或未授权素材。使用原创最小例子说明问题。

参考项目代码的 GPL/AGPL 义务不能用换语言或改文件名消除；拟复用前先说明兼容安排。有关规则、素材与生成内容的边界见[许可文档](docs/10-rules-assets-and-licensing.md)。提交前核查文档链接、许可与秘密数据，只提交本次明确相关的文件。

C3组件工坊入口为 `/#composition`，历史工坊「组件与外观」先保存再迁移当前v4为独立副本。开发与新代码位于 `core/v5`、`io/v5`、`editor/v5`；严格v5完整信封内保留有效v3场景，显式v3视图只用于原生渲染/领域工具，禁止替代v5保存或导出。内部固定保全定义用于保持源/非活动派生资源闭包，不作为普通放置目录条目。

C3真实图片、离线资源/历史及UI可串行运行 `SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c3-workbench.spec.ts tests/c3-resources.spec.ts`；全量单元可用 `npm test -- --maxWorkers=1` 避免高负载身份/预算测试互相争用。C3单位中的图像/存储替身不能代替真实Canvas/IndexedDB结论。正常生产验收必须使用 `npm run build` 的产物且没有 `__sceneweave` 开发/性能入口；本批实际命令、原始证据及边界归[29](docs/29-m1c-c3-validation.md)，不覆盖13/17–28的历史结果。

C4入口为 `/#outdoor`，新代码位于 `core/v6`、`io/v6`、`editor/v6`；原生场景仍严格v3，新增持久室外identity3和严格v6完整信封/仓库。可串行运行 `SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c4-workbench.spec.ts tests/c4-storage.spec.ts tests/c4-renderer.spec.ts`，包含室外真实依赖、跨层锁/256预算、重开/离线/原件链、CAS与双受众。范围和本批原始证据见[31](docs/31-m1c-c4-validation.md)，建筑身份不因室外持久身份而升级。

C5新增联合用例为 `tests/c5-integration.spec.ts` 和 `tests/c5-storage.spec.ts`，可按以下命令串行定向运行：

```sh
SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c5-integration.spec.ts tests/c5-storage.spec.ts
```

其中存储写入失败通过native事务定点抛出错误验证回滚，不能称为实际配额耗尽；隐私测试保存6份真实4096² PNG并核对RGBA与元数据。全量回归与新增联合用例的实际批次、早期夹具/运行器失败、最终源码指纹分开保留于[32](docs/32-m1c-c5-validation.md)。

## C5 正常生产性能复现

C5使用正常生产页面和可信输入，不使用B5专用性能构建或产品开发API。先构建，再独立串行运行：

```sh
npm run build
node tools/performance/run-c5.mjs --output /ABS/NEW-EMPTY-DIR --fixtures /ABS/sceneweave/docs/evidence/m1-b5/final
```

默认study/island×500/2000、每组3个全新系统Chrome进程/profile，原始v2包经正常UI完整迁v6。每轮框选/替换各30次、普通编辑10次、隐藏/合法重排各10次、有限层参数5次、局部恢复3次、命名1次、指针/键盘菜单共10次，平移/缩放各3段（每段30次pointermove/20次wheel、逐rAF输入），另冷导入/本地重开和双受众4K。只有marker进入小工作层，遵守256实际展开预算。输出目录必须为空，失败及慢样本保留。

精确领域计时从可信提交输入到Workspace全部校验/身份/undo完成、通知React前的会话时间；DOM、raster、保存、双rAF分别列出。该时间和对应revision只在会话/DOM，不能进入工程、历史或备份。每轮及合并nearest-rank p95与n分列；500普通领域p95目标100ms和连续帧p95目标33ms分别判断，2000为压力。双rAF不是GPU或物理显示完成，原B5网格/范围不冒充50×50显示网格。

资源采样目标为进程树RSS100ms、目标页JS堆200ms，报告真实间隔/阶段/raw；RSS可重复共享页，堆不含完整浏览器/GPU。正式测量期间不运行其他浏览器、测试或构建，也不改受测源码、dist或运行器。默认每case普通编辑合并n30、每类选择n90、恢复n9；恢复等小样本须披露，未达标如实记录，不据完成脚本关闭C5或QA-PERF。

低次数诊断可追加 `--diagnostic --cases study-500 --runs 1 --selections 1 --edits 1 --layers 2 --appearances 1 --restores 1 --menus 1 --gestures 1`。`--diagnostic-profile`仅首个普通编辑启用CDP CPU采样，自动标为诊断，不能混入正式分布。查看汇总可运行 `node tools/performance/summarize-c5.mjs /ABS/EVIDENCE-DIR`；实际结论以32及所列原始指纹为准。
