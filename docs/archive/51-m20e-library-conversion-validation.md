# M2-0e：个人素材库、载体与内置内容

2026-10-24，起点main/0367c5f及未提交的M2-0a至d。用户授权做e，只做必要简单测试。本批模块/API已实现，主界面仍使用v6及sceneweave-catalog-v1，切换留f；应用版本仍为0.2.0-m1-d2。没有自动转换用户数据、调用AI渠道、全量回归、正式性能或commit/push，不重建work/evidence。

## 交付内容

- [共享个人库](../../src/shared/library/index.ts)新增8个纯模块：算法1精确身份/metadata、组织、固定根闭包和新中性载体、所选备份、补标与过滤。namespace、logicalKey、contentHash、完整key及item元数据保持；新ZIP实际capsuleSha256重算。载体读取后完整重抽固定中性工程，包含私密组合模板、源祖先、非活动派生输入/输出及保全定义，不带场景实例/层规则/历史/原件。实际字节、许可和派生像素继续验证，采用仅返回追加固定内容候选，保持场景、身份、revision和256展开限额。
- [新所选备份](../../src/shared/library/backup.ts)使用sceneweave-asset-library/schemaVersion1/capsuleFormat sceneweave-complete-project@1。最多64安装项，也可只选择organization-only；原显示文本及顺序、颜色顺序和收藏保持。新旧格式互相拒绝，规范base64/实际SHA/完整载体逐项检查。备份64MiB、载体累计47MiB/单项32MiB保持，不把所选包称全库保全。
- [旧个人库捕获与转换](../../src/compat/legacy/catalog.ts)严格检查native10及三表/唯一索引，用一个readonly事务捕获全部安装、全部组织和原元数据；缺库不创建。metadata保全记录是全部原行的{rows:[{key,value}]}，空库不虚构revision。合法key的可序列化坏payload能先保全、转换明确失败；非法主键在begin预留时明确拒绝，仍可通过底层capture＋set单独取回，不静默漏行。旧所选文件用file-catalog-v1，确切原JSONbytes在保全set内保留，文件来源不扫描数据库。
- [新个人库](../../src/platform/browser/library/repository.ts)使用sceneweave-library、Dexie schema1/native10和五表：entries、organizations、metadata、conversionJobs、conversionStaging。普通变更64目标，完整转换512安装/2048组织有界单事务；单载体32MiB，公开载体与私有暂存合计128MiB，不能靠分批绕过。所有预留键/源摘要必须到齐；未知结构/低版本升级竞争明确拒绝。普通列表检查公开metadata/hash，load、写入与转换完整核验实际载体。
- 固定journal和jobVersion CAS贯穿备份重读、prepare、私有staging committed、冷读和一次原子发布。既有公开内容在发布前保持可读；合并检查精确/逻辑身份冲突，个人整理策略明确keep-local或replace-selected，范围外保持。取消、失败、目标冲突重试保留同job及已冻结策略；verified重入返回当前库，不覆盖后来的整理。已有exactkey复用也完整冷读旧载体，再在事务内比对，不能用有效暂存遮蔽损坏的已安装项。
- [独立内置provider](../../src/platform/browser/content/index.ts)运行时不依赖editor或旧catalog TS，使用125205字节固定内容JSON、57个既有PNG路径和原补标JSON，没有复制图片或重画素材。每次读取实际字节并走新图像端口，响应流按预期长度封顶，结构取消信号不冒充原生AbortSignal。旧新62项完整item、62个补标键及6组refines保持。

## 转换入口

[application/migration/library-conversion.ts](../../src/application/migration/library-conversion.ts)提供beginLibraryConversion、beginLibraryFileConversion、continueLibraryConversion及cancelLibraryConversion。begin只捕获/预留/导出；continue必须重新提供完整索引/全部卷，验证私有receipt并重算实际指纹、所有键及源hash，才prepare→commit私有暂存→冷读→发布。

源库提交前、发布前后复查；默认源变化/不可读阻断，明确captured-copy才继续采用已保全副本，原源后来修改保留。已committed的任务刷新后可不带备份继续冷读；尚未提交的重试仍须完整set。文件scope按已重读原bytes处理。首页、素材面板和默认保存切换留f，File/Blob测试不是磁盘下载/用户重新选择文件的UI验收。

## 实际必要检查

环境沿50：Node24.14.1、TypeScript5.9.3、Vitest4.1.12、Vite7.3.7、Chrome156.0.8078.47。fake-IDB/Playwright均使用隔离测试数据，不连接用户浏览器profile。

| 检查 | 最终结果 | 实际范围 |
|---|---|---|
| `npm run check:shared` | 60源码模块通过 | AST边界、无DOM编译、真实Node原生ESM；原闭环加organization-only新所选备份往返/旧格式拒绝；Node没有真实图片适配器 |
| `npx vitest run src/shared src/compat/legacy src/platform/browser/storage src/platform/browser/library src/platform/browser/content --maxWorkers=1` | 15文件165/165，18.79秒 | a至d相关基础＋e共享13、旧目录/provider11、新库17；实际65载体/2048整理发布，512是预留上限；故障/CAS/策略/预算/真实原bytes/身份对照 |
| `SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20e-library.spec.ts --reporter=line` | 4/4，7.8秒，0失败/重试/跳过 | 实际PNG/亮度派生/私密模板、全目录及原文件保全、File重读、空新库/冷开、commit刷新续跑/源后改、57实际图片与全部62item |
| 类型与`npm run build` | 通过，最终构建含tsc，Vite阶段2.71秒 | 正常生产构建；既有依赖注释/混合导入/大chunk提示保持，旧UI尚未切换 |

四项Chrome分别覆盖：

1. 真实旧写入器建立两项安装、三条整理（含未安装key）、实际亮度派生及私密组合；完整set重新读取后转换/冷开，原字节/许可/祖先/私密模板保持。本机同key整理按keep-local保留，范围外和organization-only不丢；新所选备份经File往返空库，旧源指纹不变。
2. 坏卷拒绝、取消和同job重试；私有暂存提交后截断publish并刷新，公开库仍为空，重启无backup完成发布；后续人工整理再重入不被覆盖。
3. 备份后源整理变化默认阻断，重试不重复传策略仍保留replace-selected，captured-copy采用捕获值并保留源后改；旧所选文件原bytes完整保全，文件转换从未打开旧库。
4. 独立provider使用真实浏览器端口验证57图，逐字比较原57图及62项完整item；6组精修关系、补标检索和新精修载体保持，provider不创建数据库。

首次整合15文件163/164通过，一项62内容对照在并发负载下超过默认5秒（6.878秒）；不改阈值，串行复验164/164（20.04秒）。审查修正策略重试后，最终同范围165/165。Chrome初版4/4（7.5秒），加入原策略省略续跑的实际断言后最终4/4（7.8秒）。类型整合修复测试颜色类型、默认数值literal及Record收窄；子任务初期的scatter夹具引用、spy复用、converterVersion缺失均只改测试，不放宽产品校验。

交叉审查补强已有载体完整复用、阶段patch首await前捕获和重试不丢原策略。固定provider生成时使用头尺寸替身，只作为内容数据生成；Node字节/规则测试不记真实解码，实际57图由上述Chrome另验。没有运行512实际安装/真实配额耗尽、内存峰值、全阶段进程崩溃或跨浏览器。

## QA与下一入口

QA-V1-04/05的个人库scope保全、组织/安装状态、私有暂存/冷读发布、失败/CAS/续跑和策略保持，以及06/07的算法1/中性完整闭包/实际资源/62补标/6精修子项通过必要检查。QA-V1-08的主会话混合创作、离线续编/有限恢复与双受众PNG留f；整个M2-0/QA-AI-16仍开放，44不替代新内核证据。

下一M2-0f接通首页/主编辑会话、默认新主库/个人库、新核心/渲染与必要文件UI，验证实际等价后收敛旧整页入口；旧只读/转换及取回保全档案保持。AI服务、草稿和SVG仍按M2-1至4推进。历史48至50、旧产品源码/测试/素材、独立todo与a至d成果保留，未commit/push或部署。

交付保护：56份文档796处本地链接/锚点、267张表格、QA/PRD/ADR引用、空白/凭据模式检查通过。698份起始文件677原字节保持、21处为本批说明/计划和入口/工具，新增26文件，无起始文件删除。旧core/editor/io/render/catalog、旧测试/素材、48至50、独立todo、依赖/版本、HEAD及空暂存保持，work/evidence不存在。小型hash/检查清单只在系统临时目录，不新增原始验收大包。
