# M1-C / C5 联合验收记录

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](46-validation-retention-audit.md#7-按用户要求执行清理)。

日期：2026-10-22至2026-10-23。状态：**功能联合回归及最终正常生产复验已完成；三批正式性能测量均已停止，完整矩阵未完成，性能门未通过。** 当前本地版本 `0.2.0-m1-c5`，起始提交为 `main / 8fcf8ed835778da59fcf564a39ae9c5c0b2d7303`。本批核对同一严格v6工程中的建筑、室外、组件/参数、图层、选择/菜单、命名历史及存档边界；保持identity3、appearance1和有效严格v3场景，不新增持久化格式。

下列记录属于各自实际执行的批次。最终源码的979项单元、168项真实Chrome与正常生产流程均通过；原始正式批次完整轮次子集的普通领域提交p95为1095.5–3613ms，明显超过100ms。**功能通过不能关闭C5整体、完整M1或全交互性能门槛，本批未进入M1-D/M2。** 三批性能记录独立统计，partial/pending不补为成功样本。本批未提交、推送或发布；C4及此前历史报告、证据和用户已有编辑继续保留。范围依据为[07路线图](07-roadmap.md)、[09质量计划](09-quality-plan.md)及本批执行矩阵（原附件已清理，旧路径：`work/c5-20261022/matrix.md`）。

原始现场位于本地 `work/c5-20261022`。本批独立归档、配置驱动事实表及机械核查单列于后文；归档核查只确认记录完整和合同一致，不改变`completeFormalMatrix=false`、`performanceGatePassed=false`。原始runner字节缺失与部分旧回归外部附件仅保留本地路径的边界继续明确记录。

## 已执行批次及适用范围

| 批次 | 实际结果 | 证据与解释 |
| --- | --- | --- |
| 优化前集成单元 | 81文件、970/970通过，68.36秒 | JSON（原附件已清理，旧路径：`work/c5-20261022/unit-integration.json`）、日志（原附件已清理，旧路径：`work/c5-20261022/unit-integration.log`）；这是优化前集成批，不是最终冻结源码结果 |
| 优化前正常构建 | `npm run build`成功，Vite构建2.63秒 | 日志（原附件已清理，旧路径：`work/c5-20261022/build-integration.log`）；含类型检查，保留主包大于500kB提示，不作性能通过依据 |
| corrected联合Chrome专项 | 6/6通过，47.235秒；0失败、0跳过、0重试通过 | 日志（原附件已清理，旧路径：`work/c5-20261022/joint-corrected.log`）、原始HTML reporter（原附件已清理，旧路径：`work/c5-20261022/joint-corrected-report/index.html`）；3项跨工具/受众UI＋3项原生存储联合测试，不是全量Chrome回归 |
| 初次正常生产页面 | `run-2026-10-22T15-52-49-262Z`为passed | 实际报告（原附件已清理，旧路径：`work/c5-20261022/production-ui/run-2026-10-22T15-52-49-262Z/report.json`）、日志（原附件已清理，旧路径：`work/c5-20261022/production-initial.log`）；正常构建/preview、仅实际UI与下载内容核查，属于初次集成版本 |
| 诊断1、2 | 两批均failed，未形成完成的正式case/run | 各自日志1（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-1.log`）、manifest1（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-1/manifest.json`）、日志2（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-2.log`）、manifest2（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-2/manifest.json`）独立保留 |
| CPU诊断3 | 单个study-500、单轮、28条观测完成；`diagnostic-c5-cpu-profile` | 日志（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-3.log`）、manifest（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-3/manifest.json`）、summary（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-3/summary.json`）及原始CPU profile（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-3/study-500-run-1-ordinary-edit-1.cpuprofile`）；用于定位，不属于正式性能证据 |
| 优化后诊断4 | 单个study-500、单轮、28条观测完成，无CPU profile | 日志（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-4.log`）、manifest（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-4/manifest.json`）、summary（原附件已清理，旧路径：`work/c5-20261022/perf-diagnostic-4/summary.json`）；仍为低次数诊断，不并入正式矩阵 |
| 最终单元 | 82文件、979/979通过，68.85秒 | JSON（原附件已清理，旧路径：`work/c5-20261022/unit-final.json`）、日志（原附件已清理，旧路径：`work/c5-20261022/unit-final.log`）；349份冻结源码/测试/工具/配置的最终批次 |
| 最终正常构建 | 类型检查与正常生产构建成功，Vite 2.75秒 | 日志（原附件已清理，旧路径：`work/c5-20261022/build-final.log`）；保留既有chunk大于500kB与第三方注释提示 |
| 最终全量Chrome | 168/168通过，770381.158ms；0失败、0跳过、0重试通过 | 日志（原附件已清理，旧路径：`work/c5-20261022/browser-final.log`）、原始HTML reporter（原附件已清理，旧路径：`work/c5-20261022/browser-final-report/index.html`）；含C5六项，不与corrected批次相加 |
| 最终正常生产页面 | `run-2026-10-22T16-32-53-066Z`为passed，46.791秒 | 实际报告（原附件已清理，旧路径：`work/c5-20261022/production-ui/run-2026-10-22T16-32-53-066Z/report.json`）、日志（原附件已清理，旧路径：`work/c5-20261022/production-final.log`）；页面与全部15个JS/CSS匹配最终dist，无产品dev/perf API |

初次和最终生产报告均记录Chrome `156.0.8078.47`。349份冻结源码/测试/工具/配置的指纹捕获于 `2026-10-22T16:19:38.248Z`；其后唯一变化为性能runner增加可配置等待时长，其余348份一致。该工具例外与原始声明hash/当前hash/实际字节单列，不能把当前runner标为原始字节。正式性能的环境、DPR、负载构成与构建指纹按各批manifest独立记录，不继承旧批结果。

最终回归实际使用以下入口；日志与reporter分别保留，命令顺序串行：

```sh
npm test -- --maxWorkers=1 --reporter=default --reporter=json --outputFile=work/c5-20261022/unit-final.json
npm run build
SCENEWEAVE_BROWSER_CHANNEL=chrome PLAYWRIGHT_HTML_OUTPUT_DIR=work/c5-20261022/browser-final-report npm run test:e2e -- --output=work/c5-20261022/browser-final-results
node work/c5-20261022/production-runner.mjs
```

## corrected六项联合正确性

实现入口为[跨工具测试](../tests/c5-integration.spec.ts)和[存储测试](../tests/c5-storage.spec.ts)。原始reporter包含各项完整JSON附件；截图、下载PNG和inline报告按原批次保留。

| 子项 | 实际输入与观察到的结果 | 范围边界 |
| --- | --- | --- |
| 同一v6跨工具旅程 | 在同一工程中建立房间、明确房间支撑的两把椅子、固定组合、家具层、有限外观、地形与道路；预览取消不改文档；命名后只恢复选定地形，保留后改道路宽度1200mm、房间、组合、外观和层成员；保护点及撤销/重做、原生重开均核查 | 是有限混合旅程，不是完整SCN-04；室外恢复与建筑会话连续性继续分别判定 |
| 跨工具拒绝与锁 | 257个明确目标触及256实际展开预算时拒绝；有效层锁、受支撑对象依赖锁和自身层外观拒绝均保留完整当前分支；附件记录失败前后revision及持久内容一致 | 不允许拆批绕过预算，不用“候选被拒绝”证明全部非法输入矩阵通过 |
| 实际4K受众与编辑隐藏 | 原生v6混合工程含组合、散布、地形与道路；6次4096×4096实际双受众导出。眼睛/独显前后各受众PNG相同；只改私密外观后GM像素有效不同，玩家像素保持一致；编辑隐藏未持久化 | 覆盖本混合夹具的秘密/图层边界，不替代SCN-04固定遮罩与全部秘密矩阵 |
| 六原生仓库与来源链 | v1至v6分别保存于六个真实IndexedDB；核对五份v1–v5迁移原件的确切字节/hash、旧v4/v5命名历史和自动历史。v6关闭连接重开后继续改公开物件/地形，原件与旧库记录保持，未把旧历史暗迁入v6 | 此条使用无位图几何来源链；真实图片由下一条独立证明。第一份M0夹具原件导出前已保守扩大原遮罩，保留秘密房间/门和原遮罩ID；没有放宽产品投影守卫 |
| 所选历史空存储离线往返 | 带真实源/派生PNG、材质、组合、散布、建筑/图层/注记的混合v6包，明确选择一命名＋一保护点并排除另一快照；26962字节包传入独立空浏览器context。预加载模块后离线完成导入、保存、连接关闭重开、续编及只恢复道路，范围外新编辑保持 | 真实原生IndexedDB和图片解码；不证明PWA断网冷启动、任意恶意包或实际配额容量 |
| 恢复采用后原生保存失败 | 保护点已单独成功落盘、恢复已采用后，仅在目标revision的原生`IDBObjectStore.add`快照写入抛模拟`QuotaExceededError`。实际事务中止使current/resource/snapshot行回滚；新内存、保护点、旧持久分支及撤销仍可用，随后retry、redo和重开保存成功 | 是确定性故障注入，非真实耗尽；不能误写成“恢复从未采用”，也不抵扣其他阶段的CAS/配额失败矩阵 |

受众配对附件记录：玩家RGBA hash在基线、隐藏/独显、私密外观改变后三次均为 `6c6e872a379838322b78b873a5a339f896465359c90a0f166183d5d0b68f094e`；GM从 `03d58054ef1ff1edf3ca972e70725c2d152981bc3368ba3f578c838d615a3561` 变为 `176db74ff7cfa991ccb91ac7037aac551b40bb218204fa797cf0d47068032563`。这是同一次实际原生解码配对的结果，不把同一图片的重复附件计为新增独立样本。

两页面revision CAS、保护点metadata CAS、源丢失/保护失败等原有子项见[C4](31-m1c-c4-validation.md)与[C3](29-m1c-c3-validation.md)。最终168项全量重新执行了现有Chrome用例；新增六项只是其中子集，不用旧报告冒充本批复验，也不把不同批次通过数相加。

## 初次正常生产页面

实际运行目录为run-2026-10-22T15-52-49-262Z（原附件已清理，旧路径：`work/c5-20261022/production-ui/run-2026-10-22T15-52-49-262Z`）。runner-used.mjs（原附件已清理，旧路径：`work/c5-20261022/production-ui/run-2026-10-22T15-52-49-262Z/runner-used.mjs`）只操作正常生产UI和下载内容，不导入产品源码，不调用开发/性能API；页面 `__sceneweave*` API名单为空。

从20×20m空白新建，18个内置物件定义、10种材质、28张图全部实际解码。建筑工具绘房后新建家具层，放置两把明确房间支撑的椅子，保存固定组合并采用有限外观；再创建带材质地形、显式Floor支撑道路、固定散布并显式生成。r10建立“C5 书房与庭院基线”命名快照，之后分别修改地形、道路和组件参数。重开后只恢复地形几何，由r14到r15，落1保护点，保留道路1200mm、6个物件、后改旋转20°、建筑/组合和外观/图层归属。

只勾选r10命名快照的历史包为446149字节，SHA-256 `dc8e4b599ba875d3bd19e8d5582c01d82401df5ba427f11988a6755ff3c23f7e`。运行核对manifest路径集合、每条大小/hash、许可、完整scene/identity/appearance及快照内容hash，30张实际图片解码；包内不含本地迁移原件。当前与重开完整contentHash均为 `67fe4e2c9861826f1b618010182922ae22d64f9c135e7bd30b741277a662f540`。

GM/玩家PNG均为4096×4096、各1528271字节，解码像素hash同为 `1c0e5e40d482cb99ebddd86c70c64d2eb6f67e8b08b44d1086209d315e81fc31`，仅含IHDR/IDAT/IEND块。该生产旅程全公开，所以两受众相同；秘密变化隔离由上一节独立混合配对证明。

运行保存1512×982桌面及390px窄屏的恢复/重开截图，报告的窄屏宽度均390；未记录pageerror或地图HTTP失败，单列保留favicon.ico 404控制台记录。本批未新增人工美术或完整可访问性签收；最终源码的生产复验和截图检查见下一节。

## 最终正常生产页面

最终生产报告（原附件已清理，旧路径：`work/c5-20261022/production-ui/run-2026-10-22T16-32-53-066Z/report.json`）对应优化后冻结源码，运行于 `2026-10-22T16:32:53.067Z` 至 `16:33:39.858Z`。独立HTTP核对正常preview的index及全部15份JS/CSS与当前dist逐字节一致，见核对记录（原附件已清理，旧路径：`work/c5-20261022/preview-final-server-verification.json`）。运行不调用开发/性能API；与初次生产分开保留。

同一20×20m工程从空白新建，18定义、10材质、28原图实际解码；绘房、两把明确room支撑的椅子/固定组合、家具层及外观、地形/道路/散布依次采用。r10命名后编辑到r14，重开后仅恢复所选地形几何到r15，创建1保护点；道路1200mm、6物件、后改20°旋转、建筑/组合、appearance和层归属均保持。再次重开完整内容hash为 `7cdb3da3a0e537bf5804413a183cf3cd2c0c73617dddce566fab2024218e356a`，与采用后相同。

仅携带r10命名快照的完整历史包为446105字节，SHA-256 `b80cda48222d65d248287cdfd3a550a442e131f6b74aaa22ad1186ab8677ab11`。核对完整ZIP路径/条目hash、许可、scene/identity/appearance、所选快照内容hash及30张实际资源解码；未夹带未勾选保护点或本地迁移原件。

双受众PNG均为4096×4096、1526789字节，文件SHA-256同为 `73f40602ee17b6194be2447c657c5c083300da7801d4f903b6e917ac050cbac4`，RGBA hash为 `b9039cd19397d2231325ebc30f37e2d7e4c9b71ee58b8f5e333c42b75134eff8`；只含IHDR/IDAT/IEND。该生产工程全公开，所以两图相同；秘密变化隔离由最终Chrome中的独立配对证明。

已目视桌面恢复（原附件已清理，旧路径：`work/c5-20261022/production-ui/run-2026-10-22T16-32-53-066Z/mixed-restore-desktop.png`）、390px重开（原附件已清理，旧路径：`work/c5-20261022/production-ui/run-2026-10-22T16-32-53-066Z/mixed-reopened-390.png`）及GM 4K（原附件已清理，旧路径：`work/c5-20261022/production-ui/run-2026-10-22T16-32-53-066Z/gm-4k.png`）：实际材质/椅子/道路/树冠可见，恢复差异面板与画布分开，窄屏纵向排列。两次窄屏scrollWidth均390，无横向溢出；不由此推定完整美术或可访问性通过。pageerror为空；只保留默认favicon.ico的404记录，没有地图资源错误。

## CPU证据与有限优化

CPU分析（原附件已清理，旧路径：`work/c5-20261022/cpu-analysis.md`）与完整映射（原附件已清理，旧路径：`work/c5-20261022/cpu-analysis.json`）核对诊断3的profile、67个压缩函数位置/源码符号以及4份原JS产物hash。普通编辑领域提交2464.6ms；提交前严格场景解析约占采样权重30.5%，迁移导入/ZIP并集约43.9%，纯外观resolve约1.8%。分类是inclusive，存在嵌套重叠，不能相加；时钟对齐误差、敏感性与profile开销均保留。这是单次诊断，不能作最终p95。

据此实现以下有限优化，持久格式不变：

- v6自有严格解析并深冻结的document＋historyIdentity＋appearance三元对象可复用认证；证书绑定确切对象身份。外部冻结、同ID/revision、JSON复制、换任一对象、非法几何、隐藏字段/accessor/symbol均不能取得免检信任。revision/时间派生仍独立验证身份及墓碑。
- 完整工程捕获保留上述三元引用，其他资源记录/Blob、许可及迁移原件链仍独立捕获；实际字节、CRC/hash、预算、原生解码和派生像素检查不省略。原生v3只接受既有认证快照复用，外部输入保持严格。
- 普通立即编辑合并重复的预览注册/采用路径；prepare的完整输入与候选校验、锁/256预算/身份/玩家投影/撤销/CAS继续执行。显式预览/采用保留二次检查，验证回调后的checkpoint检查防止同步重入覆盖新分支。
- `lastTransaction`仅在会话记录同revision领域完成时间，由DOM供只读性能观测；不进入文档、工程、历史、包或检查点。完整显示与保存另计，不把时间戳当成功存档凭据。

新增安全回归覆盖外部/混合/伪冻结输入、认证后损坏Blob/许可/原生解码失败、真实prepare的双IO边界、同步命令捕获、失败/晚到/同步重入和单次undo；最终979项及168项Chrome均包含适用测试。

| 单次诊断操作 | 优化前领域ms | 优化后领域ms | 优化后完整显示/保存代理ms |
| --- | --- | --- | --- |
| 普通编辑 | 2174.2 | 1110.4 | 2445.9 |
| 合法层重排（2次） | 2465.6 / 2149.2 | 1001.2 / 946.7 | 2753.1 / 2615.3 |
| 有限外观采用 | 765.8 | 454.8 | 2217.4 |
| 含保护点恢复 | 5230.4 | 4733.4 | 8454.0 |

此表仅对照诊断2与无profile诊断4的低次数原始值；优化前后约减半的普通提交仍远超100ms。诊断4框选/替换显示代理31.9/22.8ms，不能抵扣事务链的等待。正式批次独立记录，不混入本表，也不把诊断2最终因错误分型失败的整批改记成功。

### 后续性能设计入口

一次命令仍必须满足全部几何、身份、依赖、锁、隐私和预算合同。下一轮的设计应把“领域命令提交并发布新场景”“完整画布细节显示”“自动保存/CAS完成”作为独立目标，不用整体等待时间掩盖瓶颈，也不把其中一个目标改名后视为其余已通过。以下是基于冻结实现调用链的设计方向，不是当前已实现能力，也没有100ms达标承诺。

1. **先认证完整工程闭包。** [schema.ts](../src/core/v6/schema.ts)当前的私有认证覆盖document/historyIdentity/appearance确切对象；[captureCompleteProjectV6](../src/io/v6/project-file.ts)仍复制资源记录、许可和迁移链。Blob字节不可变，但包裹记录、映射和lineage可以被替换；可在完整严格验证后为自有深冻结的资源/许可/原件闭包建立同身份凭证。外部导入、冷载入、公开API、迁移和导出继续完整验字节/许可/预算/CRC/hash/解码；内部编辑仅在闭包身份未变时复用，新增资源则重验。验收需覆盖容器字段变更、Blob替换、无效迁移原件拒绝与有效内部编辑资源身份保持。
2. **建立内部命令提交快路径。** [prepareCompositionCommandsV6](../src/io/v6/prepare.ts)会完整验证输入，再由`materializeProjectV6`克隆/重求派生外观并验证；普通场景命令进入[applyCommandsV3](../src/core/v3/commands.ts)，对输入和候选各做完整验证。虽已有快照事务入口，当前普通链路未使用。可以仅对可信内部版本引入命令声明的影响集、路径级复制与候选严格检查；未知或全局命令回退完整路径。验收应把每类增量结果与现有全量validator做差分核对，并证明锁、墙门、支撑、图层、隐私、身份、撤销与256条展开预算完全一致。
3. **绑定精确版本维护依赖索引。** [inspectDependenciesV3](../src/core/v3/dependencies.ts)、[geometryIdentityIdsV3](../src/core/v3/domain.ts)与[applyCompositionCommandsV6](../src/core/v6/commands.ts)目前需要扫描或克隆整场景。会话索引可记录实体/Floor/图层、支撑下游、墙开口、组合成员、外观及身份ID占用，但必须绑定确切文档认证对象，每个事务增量生成下一版本索引；仅按命令目标ID不足以覆盖依赖范围。未知命令、拓扑/全局预算变化及重开后的首建索引应走全量扫描；验收需验证失效闭包、重开重建及索引/全量结果等价。
4. **优化保存/恢复的重复保全边界。** [SceneRepositoryV6.save](../src/io/v6/storage.ts)会再次克隆、完整校验、捕获/比较迁移原件，并在事务内扫描用量；保护点和恢复也分别校验完整工程。内部路径可传递已认证闭包以免重复解包重算，但持久写入仍必须做revision/content hash CAS、新资源检查、事务原子性和失败回滚。全库精确预算扫描可能仍然昂贵；在不增加持久schema的当前约束下，需要单独测量其权重，并设计跨标签准确方案，不可用不完整缓存替代。验收包括资源篡改、hash冲突、配额失败、双页CAS与保护点失败/重试矩阵。
5. **按视口构造正确资源闭包。** [renderEditorProjectV3](../src/render/v3/renderer.ts)先构建全受众投影，[createEditorRenderPlan](../src/render/shared/editor-render-plan.ts)再做视口筛选；[renderRasterProjection](../src/render/shared/canvas-renderer.ts)当前解码需求仍来自原完整投影。可评估以可见视口作为首帧计划并精确列出阴影/材质/来源依赖，仍按玩家过滤后生成且不设长期Bitmap缓存。首帧可见和细节完成分别计时，GM/玩家与完整固定4K导出作像素对照，验证遮罩、阴影及隐私没有被裁剪破坏。

顺序建议：固化分段计时→内部资源/原件闭包认证→命令局部验证与版本绑定索引→保存/恢复内部保全复用→受众安全的视口资源闭包。每一步都重跑同一串行正式矩阵；本轮矩阵不因后续假设而修改。

## 失败批次与诊断归属

| 原始批次 | 实际状态 | 保留方式与后续 |
| --- | --- | --- |
| ui-initial | No tests found，0项实际执行 | 日志（原附件已清理，旧路径：`work/c5-20261022/ui-initial.log`）、reporter（原附件已清理，旧路径：`work/c5-20261022/ui-initial-report/index.html`）；不能把reporter的0/0当成产品通过 |
| ui-verified | 3项中2过1败 | 日志（原附件已清理，旧路径：`work/c5-20261022/ui-verified.log`）、reporter（原附件已清理，旧路径：`work/c5-20261022/ui-verified-report/index.html`），失败截图/error-context/trace保留 |
| ui-budget-recheck | 仅重跑预算/锁项，0过1败 | 日志（原附件已清理，旧路径：`work/c5-20261022/ui-budget-recheck.log`）、reporter（原附件已清理，旧路径：`work/c5-20261022/ui-budget-recheck-report/index.html`）；与其他批次独立 |
| joint-verified | 6项中4过2败 | 日志（原附件已清理，旧路径：`work/c5-20261022/joint-verified.log`）、reporter（原附件已清理，旧路径：`work/c5-20261022/joint-verified-report/index.html`）；失败为跨工具拒绝项与完整迁移链续编项 |
| joint-corrected | 同六项6/6 | 日志（原附件已清理，旧路径：`work/c5-20261022/joint-corrected.log`）及原始reporter；保持旧失败，不把通过数和早期批次相加 |
| perf-diagnostic-1 | 近期工程按钮处等待超时 | 原始partial failure、资源采样、截图和日志保留；未完成矩阵 |
| perf-diagnostic-2 | 完成若干操作后页面/控制台错误检查失败 | 原始partial failure、完整下载与资源/错误记录保留；不删慢样本，也不把诊断失败算作正式性能结果 |
| perf-diagnostic-3 | 单轮CPU profile诊断完成 | CPU采样仅覆盖首个普通编辑窗口，含诊断开销；不能与无profile的正式结果混并 |
| perf-diagnostic-4 | 优化后单轮无profile诊断完成 | 28条观测、普通领域1110.4ms；保持诊断分类，不充当正式四组/三轮结果 |

CPU诊断3的普通编辑只有1个样本，`intentToDomainCommitMs`为2464.60ms、`formalMatrix=false`。该值证明当时需要继续定位；不能以单样本p95推断总体分布，也不能据诊断完成关闭性能门槛。源码、runner与方法修正后的最终复验必须使用新的独立目录。

## 素材与完整场景差距

素材状态以[15制作台账](15-m1a-asset-production-list.md)为准，C5增加实例、参数派生或执行技术测试均不升级艺术状态。

| 范围 | 已有内容 | 仍缺内容与验收 |
| --- | --- | --- |
| VIS-01室内包 | 4材质、11物件、2固定组合；15张PNG及来源/许可保留，状态O/P2 | 完整主题P3、用户观感与素材签收；可编辑样板与技术往返不能代签 |
| VIS-02室外包 | 6材质、7物件；13张PNG与来源/许可保留，状态O/P2 | 完整主题P3及用户观感；坡道与混合追加表现继续单独验收 |
| 混合追加包 | 目前只有制作规格，O/P0 | `material.sw.dirt-gravel`；`prop.sw.crate/supply-rack/campfire/lamp-stand/tent`；`prefab.sw.outpost-supplies`及相应道路/混合主题表现。道路工具实现不等于土砾材质和主题美术已制作 |
| SCN-01雾灯宅 | C2已有7空间、9门、3窗的建筑及适用结构/隐私证据，见[28](28-m1c-c2-validation.md) | 六房/暗廊的完整基础家具与布景、普通门开启状态下完整净宽动线、完整手工闭环和视觉签收；衣架/长凳、炉台、边柜、床/衣柜、木箱等不能由现有书桌椅子冒充 |
| SCN-03风桥营地 | C4已有Region/Prop/Note技术基线、6000/4000/6000mm量尺、有限桥路线及隐私子项，见[31](31-m1c-c4-validation.md) | 帐篷、营火、物资、灯架等完整美术和手工准备，M3真实小团/预设用途；原“东岸高地”Region名不等于已建立高差 |
| SCN-04海岸哨所 | 本批有限混合夹具证明若干工具可共用同一v6工程 | [08](08-test-scenarios.md)规定的36×28m低/高台地、1000/3000mm高程、值守室/储物间共墙门、院子/道路/唯一台阶、补给/灯架、净空路线、预设及秘密配对仍未完整运行；留M1-D，不能拿20×20m旅程替代 |

SCN-02完整地下城与三场景真实小团属于后续相应阶段。本批没有制作新的主题美术，也没有把程序像素夹具、原有18个定义或性能复制实例计为新增P3资源。

## QA追踪与结论边界

以下仅把已执行子项对应到[09](09-quality-plan.md)，整项状态仍按完整输入/门槛分别判断。

| QA | 本批可核查子项 | 仍开放的范围 |
| --- | --- | --- |
| QA-TXN-01/02/03 | 跨工具取消/拒绝、预算/锁、单次恢复及单调撤销；拒绝前后内存/持久分支保持；最终168项全量重新执行适用用例 | 其他非法/过期和依赖组合；自由物件拖动的QA-TXN-04未由此证明 |
| QA-UX-01/03/04、QA-LAYER-01/02 | 实际UI组合、层/参数、选择/菜单及键盘路径；临时隐藏/独显不改正式双受众PNG | 完整人工键盘/中文输入法、辅助技术、缩放/设备与可访问性矩阵 |
| QA-IO-01/03/05、QA-IMPORT-03 | 六库原件链、明确历史联合资源、独立空存储离线续编/重开、恢复后原生事务中止；最终全量回归与生产重开通过 | 真实配额/权限、所有迁移/损坏/取消组合；PWA冷启动未证明 |
| QA-REC-01/03/04 | 命名/保护点、明确所选历史、范围外新编辑保持、原生保存失败及retry/undo/redo；既有CAS用例随最终全量复验 | 全部恢复模式和依赖组合不能由六项抵扣。持久建筑身份、任意拓扑或删除结构恢复仍不支持 |
| QA-SEC-02/03/06 | 混合原生v6真实4K私密外观配对、编辑隐藏隔离、生产PNG元数据 | SCN-04固定遮罩、完整秘密类型与跨浏览器矩阵；全公开生产图不能证明秘密隔离 |
| QA-MAT-01、QA-ASSET-01、QA-COMP-01、QA-SCATTER-01 | 真实图片/许可闭包、组合/散布/参数与存档共同存在，原有人工记录随完整包保存 | P3、美术签收、所有成员/散布编辑和外观组合；不升级15台账 |
| QA-SCN-01/03/04、QA-VIS-01/02、QA-PLAY-01 | 与历史适用子项保持追踪，本批不改写原场景合同 | 上节全部场景差距、主题及真实小团；均不据本报告整项关闭 |
| QA-PERF-01/02/03/04 | 三批失败正式记录、原始批9轮完整子集及独立补测统计；真实输入、领域/DOM/raster/保存/显示代理、连续视口与可测资源峰值分别保留 | 四组×三轮矩阵未完成、普通领域100ms目标未达；自由物件拖动、50×50显示网格、完整混合流程及GPU/去重物理峰值仍缺证据 |

## 独立归档与机械核查

三批均已停止，未完成部分按失败现场归档，不再等待不存在的完整summary。独立目录为`docs/evidence/m1-c5`；证据索引（原附件已清理，旧路径：`docs/evidence/m1-c5/evidence-index.json`）保留配置、受保护历史基线、冻结源码/构建指纹、35份原始日志/JSON无损压缩、6份原始reporter ZIP及24份C5/失败附件、两次生产完整内容、四批诊断/CPU产物和三批性能完整树。性能树共132份文件，诊断树共47份文件，CPU基线另有4份dist产物。旧回归非C5大附件的实际本地路径、hash/大小继续保留在reporter索引；这不冒充它们的完整分发备份。

唯一冻结工具例外为`tools/performance/run-c5.mjs`：原声明SHA-256 `ea4d297266df24db86d28819b4f61dc45a6bc0b5b35398dd4ee60e6530b666a6`（55826字节），当前SHA-256 `64591983a8a7d28bc37a12f9e71d01eb4c8b633da02afb184540fcaeafdbe1fb`（56110字节）。仅增加可配置等待，默认60000ms、补测180000ms；原始runner字节不可得，保留声明和当前实际字节，不以当前文件冒充原件。delivery-config的toolingDeviations与仅对应原始批的runnerHashExceptions精确声明该例外，其余348份源码及其他不匹配仍必须拒绝。

离线收尾已按`report-formal.mjs`→`archive-evidence.py`→`verify-evidence.py`→`final-checks.py`实际顺序执行，不启动浏览器、测试、构建或新测量。证据复核（原附件已清理，旧路径：`docs/evidence/m1-c5/evidence-verification.json`）包含每批全部树成员和原字节/hash、无summary/finishedAt、partial/pending/probe/失败原因与日志状态、完整轮次可信输入/时钟/时延/资源/网络、8种时延字段按case/run独立分布及9行perRun p95复算、PNG实际解码、ZIP CRC/资源/许可/身份/快照闭包及349份源码与48份构建产物；348份冻结源码未变，唯一工具例外按上述声明处理。最终执行脚本以证据索引的`scripts`清单中内容寻址版本为准；根目录`*-used.py`保留首次归档快照，不覆盖历史字节。

最终检查（原附件已清理，旧路径：`docs/evidence/m1-c5/final-checks.json`）核对826份历史保护文件与todo起始hash保持；40份文档、892处本地引用、12处锚点、230个表格及67项QA编号有效。869份文本载荷的目标凭据/私人资料模式无命中，本批排除未改写的用户todo.md后空白检查通过；该文件原有空白保留，工作区仍未暂存、提交、推送或发布。证据复核与最终检查均为`allPassed=true`，只表示上述机械核查通过；`completeFormalMatrix=false`、`performanceGatePassed=false`保持。

最终功能回归与生产结果已独立登记，正式性能矩阵未完成、普通编辑100ms目标未达，不据功能通过交接M1-D。完整M1、主题P3、真实配额、跨浏览器、小团、AI、Worker、PWA与UVTT继续各自验收。
