# M1-C / C4 室外工具与地形恢复验证

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](46-validation-retention-audit.md#7-按用户要求执行清理)。

日期：2026-10-22。状态：C4有限切片已本地实现并完成下列适用验证，版本 `0.2.0-m1-c4`，未提交、推送或发布。用户授权为“做”；本批从 `main / 8fcf8ed835778da59fcf564a39ae9c5c0b2d7303` 开始，保留C4准备文档及用户已有编辑。下一入口为C5联合验收，本报告不关闭完整M1、完整场景、美术或全交互性能门槛。[30](30-m1c-c4-handoff.md)保留实施前的准备状态。

## 实现范围与版本

- 新增室外工坊 `/#outdoor`；从组件工坊先保存当前工程，再创建独立v6室外副本，也可直接新建空白工程。绘图或整数毫米坐标均经过暂态预览、完整依赖确认及一次原子采用。
- 支持地形轮廓、高程、底材与覆盖，规范来源边缘、显式台阶/坡道、道路、用途/危险Region，以及固定组、显式生成和有限编辑的可控散布。道路采用方端帽、miterLimit=2及bevel带区；真实Canvas绘制、选择和注记锚点使用一致几何。
- 采用严格v6完整工程信封/容器，profile `m1-outdoor`、identity3、appearance1和独立仓库 `sceneweave-m1-outdoor`；有效SceneDocument保持严格v3。完整保存包含场景、身份、外观源图、实际源/派生字节与许可；显式v3视图只用于原生渲染/领域工具。
- v5当前修订以独立sceneId完整副本迁移，保留prop/prefab出生token、lineage、确切v5原件及既有来源链；旧当前工程、自动/命名/保护历史继续留旧仓库。新室外身份从迁移时开始，不给旧v5快照补造证明。普通便携完整包及明确所选历史包不夹带本地迁移原件。
- 室外出生与拓扑身份持久化，允许跨重开有限恢复现存连续实体的几何/业务字段、适用表面外观，以及显式选定的真实历史散布成员。保留当前拓扑、层、锁和范围外后续编辑；C2建筑恢复仍只使用本会话witness。

主合同见[04](../04-scene-document.md)和[06](../06-storage-and-export.md)。旧读者拒绝新语义，不通过丢字段另存降级。

## 依赖、散布与恢复边界

地形点/段具有稳定ID；轮廓换起始行按相同有向邻接认定连续性，改变邻接则生成新拓扑token。坐标、高程或材质改变不单独构成拓扑变化；删除重建或拓扑变化后，即使撤销回相同JSON，也不能伪造历史连续性。来源边缘按真实来源/邻接规范化，轮廓改变需要附着重映射时必须显式列出；不能按点数组下标暗中换边。高差连接检查真实端点、净宽和支撑，单放桥或道路图片不赋予跨高差通行。

预览列出根对象、真实修改/创建/删除、只读依赖及跨层影响。仅JSON不变但支撑、附着或可见轮廓含义改变的对象同样进入影响清单；实体锁、图层锁及必要支撑锁共同约束。256预算按真实实体、成员记录及删除/排除写入展开计数，不能以一个重生成命令或自动拆批规避。

散布candidateKey标识算法候选槽位，不能作为永久物件出生身份。仍存活成员保留ID/token，新出生成员使用未用过的ID；密度淘汰与用户删除区分，普通重生成不能复用墓碑或历史复活。保存完整实际实例，保留人工移动、外观、deleted/detached、锁和所有当前exclusions，重开不重新运行seed。成员退出后保留独立Prop，成员记录的propId置空。

默认外观恢复保留当前人工位置、删除、退出、排除及后增成员；“历史源/参数＋当前层效果”另列差异。显式历史散布成员恢复读取快照中的完整Prop和出生证明，逐项列出成员/删除/排除变化，只调整本次明确范围。所有恢复先保存当前完整分支并落保护点，再重新核对源hash、场景checkpoint和metadata CAS，一次revision+1采用，可单调撤销/重做。保护/采用前失败不改当前；采用后保存失败保留新内存、撤销、保护点及旧持久分支。

## 验证方法与最终结果

环境：macOS 26.6.2（25G83）、MacBookPro17,1、Apple M1、16 GiB，Node v24.14.1、npm 11.11.0、系统Chrome `156.0.8078.47`。浏览器、构建和生产页面批次串行执行；浏览器1 worker，单元批次内部使用配置的Vitest worker pool。本批没有正式性能采样，环境与命令见environment（原附件已清理，旧路径：`docs/evidence/m1-c4/environment.json`）。

最终同一冻结源码批次：

| 验证 | 实际命令与结果 | 原始记录 |
| --- | --- | --- |
| 全量单元 | `npm test -- --reporter=default --reporter=json --outputFile=work/c4-20261022/unit-final-corrected.json`；81文件、969/969通过，21.14秒，exit 0 | JSON无损gzip（原附件已清理，旧路径：`docs/evidence/m1-c4/unit-final-corrected.json.gz`）、日志（原附件已清理，旧路径：`docs/evidence/m1-c4/unit-final-corrected.log.gz`） |
| 正常生产构建 | `npm run build`，含类型检查，exit 0 | 构建日志（原附件已清理，旧路径：`docs/evidence/m1-c4/build-final-corrected.log.gz`） |
| 全量真实Chrome | `SCENEWEAVE_BROWSER_CHANNEL=chrome PLAYWRIGHT_HTML_OUTPUT_DIR=work/c4-20261022/chromium-final-corrected-report npm run test:e2e -- --output=work/c4-20261022/chromium-final-corrected-results`；162/162通过，731.65秒，0跳过/重试通过/失败，exit 0 | 原始reporter ZIP（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected.report.zip`）、全部用例索引（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-summary.json`）、日志（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected.log.gz`） |
| C4子集 | 上述全量中的14/14：renderer 3、storage 4、workbench 7 | 同一reporter和目标附件目录（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts`） |
| 正常生产UI | `node work/c4-20261022/production-runner.mjs`；正常build/preview，仅实际UI和下载内容核查，通过 | 最终生产报告（原附件已清理，旧路径：`docs/evidence/m1-c4/production-ui/run-2026-10-22T14-50-23-377Z/report.json`） |

单元的Canvas、原生解码或IndexedDB替身只证明明确覆盖的逻辑、容器及故障注入。真实图片解码、Canvas像素、原生IndexedDB保存重开和跨页面竞争另由Chrome及生产页面证明，不相互替代。

| 适用子项 | 实际证据与结果 |
| --- | --- |
| 地形/来源/覆盖 | 地形与边段（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-terrain-edge-overlay.json`）：取消不改revision，隐式换段拒绝，显式范围/身份保持。完整场景守卫、锁、预算及非法几何由相关单元覆盖 |
| 道路/连接 | 显式连接（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-supported-connection-path.json`）及多支撑/铺装（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-road-multiple-supports-and-paint.json`）：高差守卫、支撑完整保留、取消、缺支撑拒绝与持久化 |
| 真实道路像素/秘密 | 4K配对（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-road-material-4k-privacy.json`）：5次顺序4K、独立公开参考、GM有效不同/玩家一致及4个材质/phase变体；实际解码和原生Canvas，不用快照替身 |
| 选择/编辑隐藏/资源失败 | 命中与隐藏（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-road-selection-anchor-hiding.json`）：端帽/转角/凹形带区命中、半路径长度注记锚点、支撑隐藏递归隐藏道路/注记；正式PNG忽略编辑隐藏。出图守卫（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-road-output-resource-guards.json`）：装饰外扩遮罩不足、隐藏/屏外公开缺资源仍拒绝；私密资源先过滤，玩家不要求解码 |
| 散布人工记录 | 密度循环与重开（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-scatter-density-reopen.json`）：人工移动/删除/退出/锁/exclusion及出生身份保持；批量及右键（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-scatter-batch-confirmation.json`）：完整依赖确认、取消及一次采用 |
| 跨重开有限恢复 | UI地形恢复（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-restore-after-reload.json`）保留后改道路；原生checkpoint（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-native-checkpoint-recovery.json`）覆盖室外身份、选定已删散布出生、自动检查点及单调undo/redo |
| 原生跨页面CAS | revision竞争（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-native-two-page-cas.json`）：两页面、独立连接、原生IndexedDB保留两分支，冲突副本完整重开。保护点metadata竞争（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-native-protection-metadata-cas.json`）只暂停方法入口，另一页面真实提交metadata，真实事务拒绝旧保护并允许重新预览重试 |
| 完整迁移/明确历史包 | 原生包与失败（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-native-selected-history-packages.json`）：本地分支保留确切v5原件，便携包排除本地原件，所选历史/资源许可完整；坏内容、许可及原件字节失败均保留当前 |

QA-TERRAIN-01/02、QA-MAT-01、QA-SCATTER-01、QA-REC-01至04及QA-IO/IMPORT/SEC仅按以上适用子项判定；[09](../09-quality-plan.md)中的完整矩阵仍逐项验收。

## SCN-03 技术基线

真实UI记录（原附件已清理，旧路径：`docs/evidence/m1-c4/chromium-final-corrected-artifacts/c4-scn03-open-camp-rulers-travel-privacy-and-4k.json`）从30×24m空白工程制作原基线，只用Region/Prop/Note，无Room和Path。南北阻挡水域主动留出长4000mm、净宽2000mm的同平面桥带，两端各有2000mm接入；东“高地”为地面Region名称，不捏造高差或第二层。

实际画布点击量尺三段为6000/4000/6000mm，暂态测量不改revision/历史。有限直线桥路线检查通过，过水负例为 `TERRAIN_TRAVEL_OBSTACLE`。两条GM线索在玩家侧过滤，真实双受众PNG为4096×3277，文件无私密文字元数据。

本例只有1个P2技术石头物件，营火、帐篷、灯架完整美术仍缺；非零高程台阶由独立连接用例覆盖。本例不等于完整SCN-03、美术签收、全图寻路或真实小团验收，也不改写[08](../08-test-scenarios.md)的场景合同。

## 正常生产页面实测

最终运行目录为 run-2026-10-22T14-50-23-377Z（原附件已清理，旧路径：`docs/evidence/m1-c4/production-ui/run-2026-10-22T14-50-23-377Z`），使用正常 `npm run build` 和 `npm run preview -- --port 4173 --strictPort`。脚本见同目录runner-used.mjs（原附件已清理，旧路径：`docs/evidence/m1-c4/production-ui/run-2026-10-22T14-50-23-377Z/runner-used.mjs`），不导入源码、不调用开发/性能API。

从16×12m空白开始，18个物件定义、10材质、28张实际图片全部原生解码。先预览/采用草地、显式Floor支撑的道路、固定散布组并显式生成3个物件；r4建立“C4 地形与道路基线”命名快照，再改地形和独立道路至r6。页面重开后只恢复地形几何至r7，保留道路后改宽度1200mm与3个物件，落1个保护点。

明确只勾选该r4命名快照的历史包为425,377字节；manifest路径集合、每条大小/hash、许可、完整场景/identity/appearance及快照内容hash均核对。28张图真实解码，包内不含本地迁移原件。当前与重开后完整contentHash一致，为 `9b7857c486f15d7d002c590d620a45527ab32e3d6544c9975044bc7d978335b7`。历史包SHA-256为 `828ffc320dc72add05ec89a179bbfba9770d15cb4244ec0df2b5981d486fbd23`。

GM/玩家PNG均4096×3072、各1,132,385字节；解码像素hash均为 `22fa7dde183d8202441d63d2c2616dbb1947df3c35cf1536ceac0fdbef8b0ea4`。PNG仅IHDR/IDAT/IEND，无文字/时间/EXIF块。生产小场景全部公开，两受众相同符合预期；秘密配对以独立renderer用例为证。

桌面1512×982及390px窄屏实际操作与截图目视完成，窄屏无横向溢出；无pageerror、地图HTTP错误或 `__sceneweave*` 开发API，仅保留既有favicon.ico 404控制台记录。

- 桌面重开（原附件已清理，旧路径：`docs/evidence/m1-c4/production-ui/run-2026-10-22T14-50-23-377Z/outdoor-reopened-desktop.png`）、390px重开（原附件已清理，旧路径：`docs/evidence/m1-c4/production-ui/run-2026-10-22T14-50-23-377Z/outdoor-reopened-390.png`）
- GM 4K（原附件已清理，旧路径：`docs/evidence/m1-c4/production-ui/run-2026-10-22T14-50-23-377Z/gm-4k.png`）、玩家4K（原附件已清理，旧路径：`docs/evidence/m1-c4/production-ui/run-2026-10-22T14-50-23-377Z/player-4k.png`）

## 发现、修正与批次归属

初次浏览器因Chromium未安装而未执行产品代码；安装后首轮12项为3过9败。失败夹具分别涉及负角度、把新派生与固定组合放进同一准备批次、既有高差拒绝消息及退出成员的propId=null语义；按合法合同修正，没有弱化守卫。较早专项12/12、78.60秒的真实记录独立保留，不能与最终14项或162项相加。

审查补充修正：更换材质时保留完整铺装与覆盖参数，道路编辑保留多个显式支撑，散布批量/右键改动需要完整依赖确认，轮廓循环换首行不误判拓扑。较早全量162项为161过1败，唯一失败为旧VIS-01门口阻挡用例：SceneInspector将同步execute异常送入异步包装后吞掉，页面没有正常显示拒绝提示。现区分同步异常与Promise，并补pageerror断言；最终全量162包含该旧用例复验通过。

上述失败日志/trace不删改，最终unit/build/全量Chrome和生产run均对应同一冻结源码。生产较早 `run-2026-10-22T14-03-19-825Z` 另保留，不能把其425,407字节或旧hash当成最终数值。最终构建仍有主包大于500kB及第三方注释警告，不因此宣称性能达标。

## 证据与最终机械核查

本批证据独立归 evidence-index（原附件已清理，旧路径：`docs/evidence/m1-c4/evidence-index.json`）：24份原日志/JSON无损gzip，3份真实Playwright HTML内嵌原始reporter ZIP，以及两份生产UI运行。原始reporter ZIP保留report.json、各文件完整JSON及inline附件正文，不以裁剪索引冒充原件。

最终reporter含162项、38成员（report.json＋37份文件JSON），SHA-256为 `eba2bd16b38cd00567a4f6f5a08c2fa03c42b92098137a942153977443e12e9a`。14项C4的14份JSON附件、4张真实4K PNG另外归档；较早唯一失败的截图/error-context/trace另保留。其他旧回归的外部大PNG/包没有重复永久归档，仍在本地 `work/c4-20261022/*report/data`；各summary记录实际大小/hash和原路径，明确不是完整外部附件备份。

最终371份应用/测试/素材/配置和48份正常构建产物分别见source-fingerprints（原附件已清理，旧路径：`docs/evidence/m1-c4/source-fingerprints.json`）、build-fingerprints（原附件已清理，旧路径：`docs/evidence/m1-c4/build-fingerprints.json`）；较早源码基线独立保留。归档压缩/解压hash、ZIP CRC/条目集合/许可闭包、用例计数和生产包复核见evidence-verification（原附件已清理，旧路径：`docs/evidence/m1-c4/evidence-verification.json`）。历史13/17–30及705份受保护文件、用户todo.md保持起始hash，文档链接/锚点/表格/QA引用、凭据与私人资料目标模式及排除todo.md的空白检查见final-checks（原附件已清理，旧路径：`docs/evidence/m1-c4/final-checks.json`）。核查脚本随证据保存，方便复现。

## 后续与已知限制

C5下一步先冻结同一v6工程的建筑、室外、组件/参数、图层、框选/右键及键盘联合矩阵，再验证旧版来源链迁移、明确历史离线往返、CAS/保护/保存失败和双受众真实像素；随后按设备、500目标/2000压力、操作数与资源方法串行测量。旧25/26选择专项不升级为v6全交互性能证据；本批不自行开始C5。

持久身份只覆盖所列室外种类；建筑仍会话witness，任意拓扑或已删室外结构重建不支持。道路贴图不授予高差通行，有限路线检查不是全图寻路。表面底材opacity仍须1，物件支持0–1；源自定义shadowOverride优先于主题阴影类别。来源链、墓碑和实际展开预算继续有界。

完整SCN-01/03/04、主题P3/用户美术签收、全交互性能、真实配额耗尽、跨浏览器、真实小团、AI、Worker、PWA及UVTT仍需后续独立证据。C4本地可用及本报告适用验证不等于完整M1完成或已发布。
