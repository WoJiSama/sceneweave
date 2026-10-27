# M2-0d：工程保全、转换和新主仓库

2026-10-24，起点main/0367c5f及未提交的M2-0a/b/c成果。用户明确授权本批完成d，仅做必要简单测试。工程存储与转换接口已实现；主界面仍使用v6，应用版本保持`0.2.0-m1-d2`，目录迁移与主会话切换分别留e/f。未运行用户真实数据转换、全量回归或正式性能，不重建work/evidence。

## 实现与使用边界

- [保全set](../../src/shared/migration/set.ts)实现06的独立索引/分卷：保留各角色、原键、语义hash与确切raw字节，只按rawSHA去重；块/卷/索引的CRC、长度、SHA和记录重组完整覆盖逐项验证，全部重读后才登记私有backupReceipt。导出不发receipt，JSON复制不能伪造。单块8MiB、卷展开含清单32MiB、卷压缩33MiB、清单1MiB、主索引16MiB/最多512卷、累计600000 JSON值/深128，均为保护值。
- [旧库捕获](../../src/compat/legacy/capture.ts)对六个已存在仓库检查精确版本/表/键/索引，每个工程家族在一个readonly事务捕获当前、全部自动/命名/保护、绑定、资源/许可、metadata和完整原件链；缺库不会创建，未知schema不升级。指纹包含这些实际记录/字节，历史改名、资源或metadata变化也能发现。
- [旧行编码](../../src/compat/legacy/row-codec.ts)保留独立捕获的字段值、Blob MIME和实际bytes；规范编码不称原磁盘JSON。捕获私有原始指纹/字节与外部对象分开，取回时独立解码，不暴露可修改的内部行。可序列化坏行能保全，转换仍严格拒绝，不能跳过后称全部成功。
- [旧文件入口](../../src/compat/legacy/file.ts)严格分发v1至v6完整/所选历史包，保全记录直接保存上传ZIP的确切字节；scope使用file-vN，与IDB的vN区分。重读时重新解析原包，准备时的临时规范行只在内存复用规则。新legacy节点及字节绑定实际原文件SHA，不用重新导出冒充原件。
- [完整转换](../../src/compat/legacy/convert.ts)将六代当前转为新完整v1、新sceneId/r0；v6保留lineage/root及出生/拓扑token、合入历史墓碑，历史文档保留原sceneId/revision，owner关联新当前。v6旧自动转只读imported-auto，名称固定`自动保存 · r<源revision>`；v1–v5历史完整保全但首批不安装为可局部恢复的新历史。C2 witness不继承，有限恢复范围不扩张。
- [新主库](../../src/platform/browser/storage/repository.ts)使用sceneweave-projects、Dexie schema1/native10和11表。支持完整保存/重开、同事务revision CAS、最近20自动、named/protection各32、imported-auto独立20、历史metadata和真实源hash CAS。全库资源/许可256MiB、文档128MiB、原件128MiB累计预检。未知结构及检查后出现的低版本外来库拒绝升级，禁止使用六个旧库和实际旧个人库名称。
- journal按唯一jobKey预留一次job、目标和历史映射，每次阶段推进比较jobVersion。prepare完整校验后，commit同事务添加全部内容/引用/来源并更新已有journal为committed，目标仍preparing；冷读完整校验当前、首份自动、全部历史与原件后，再CAS开放ready/verified。v6候选的全部预留历史必须到齐，来源kind及自动revision逐项匹配；重试不覆盖已发布后的手改。

共享资源批次提高到85份以容纳当前＋64命名/保护＋20来源自动；普通便携history仍最多64。兼容准备及冷读按hash共享一份私有字节联合集合，输出端口按工程范围限定读取；各份内容、绑定、许可和实际解码/派生像素仍完整验证，没有长期Bitmap缓存或免检标记。未测内存峰值或正式容量。

## 转换编排入口

[application/migration](../../src/application/migration/conversion.ts)提供：

| 接口 | 行为 |
|---|---|
| beginProjectConversion | 只读捕获指定旧库家族，预留/复用journal，导出完整保全set；不开放目标 |
| beginProjectFileConversion | 捕获确切旧文件，使用file-vN来源，同样先导出保全set |
| continueProjectConversion | 接收重新提供的完整索引/全部卷，验证receipt并从实际记录重算指纹、历史键/源hash，再prepare→commit→cold-read→ready |
| cancelProjectConversion | 停止同一journal；已commit但未开放的目标仍私有保留，重试继续冷读 |

源库在提交前、开放前后复查。默认源变更/不可读会阻断；明确sourcePolicy=captured-copy可将已保全内容作为独立副本，保留后来源编辑。发布后再发现源变化只报告副本来源，不回滚或改写新目标。固定文件来源没有可变源库，已重读的原bytes就是来源，不伪造DB检查。verified重入返回当前目标，允许其revision已高于0；并发失败的调用不能把另一调用已推进的journal标失败。

这里交付模块API和存储基础；首页/迁移面板、默认保存切换及旧入口退役归M2-0f。当前未自动迁移用户工程，File/Blob测试不等于已经完成真实磁盘下载/重新选择文件的UI验收。

## 实际必要检查

环境沿49：Node24.14.1、TypeScript5.9.3、Vitest4.1.12、Vite7.3.7、Chrome156.0.8078.47。数据库仅使用独立fake-IDB或Playwright新隔离context。

| 命令 | 最终实际结果 | 范围 |
|---|---|---|
| `npm run check:shared` | 52源码模块通过 | AST边界、无DOM编译、真实Node原生ESM；含无图片当前/历史ZIP及set重读/receipt，未提供Node真实图片适配器 |
| `npx vitest run src/shared src/compat/legacy src/platform/browser/storage` | 10文件124/124，8.00秒 | 既有共享规则/IO、14项set、16项legacy、16项仓库与85批次；含真实32MiB+7字节两卷、六代旧文件、IDB CAS/故障/结构与全历史门 |
| `SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20d-conversion.spec.ts --reporter=line` | 4/4，8.8秒，0失败/重试/跳过 | 实际PNG/派生像素、原件、全家族和原ZIP、File/Blob重读、新库冷开、commit中断续跑、后改不覆盖和源变化 |
| `npm run typecheck` / `npm run build` | 通过；最终构建含tsc，Vite阶段2.74秒 | 正常生产构建保留原有依赖注释/混合导入/大chunk提示；未把模块API检查写成新主UI已验证 |

四项Chrome分别验证：

1. 真实旧v6写入器建立PNG及亮度派生、v5原件、两自动与命名/保护各一份；完整捕获/重读/转换后关闭并冷开新库，实际字节/许可/外观、owner/原历史身份与token保持，玩家投影排除秘密，旧库指纹不变。
2. 坏包与取消保持未开放并复用job/目标/历史ID；原子commit后截住publish并刷新页面，重启无backup继续冷读开放；随后手工保存r1，转换重入保留手改。
3. 备份后源改到r2，默认拒绝开放；明确captured-copy后新目标仍是旧捕获r0，源r2保持，结果报告源变化。
4. 真实v6历史ZIP经原生File读取，作为schema6原件逐字保留，两个所选历史保持源身份/修订/token，无来源自动；注入的旧库工厂未被访问，真实旧库指纹保持。

首轮Chrome3通过/1失败（15.1秒），测试误将整个ProjectData传入严格三元命令入口；只改测试显式提取document/historyIdentity/appearance后4/4（8.7秒），最终源码4/4（8.8秒）。Node首轮仓库1项为receipt正则大小写，旧文件1项为v4/v5测试当前/快照分别生成不同lineage，均修夹具/断言后通过，未放宽产品校验。整合类型问题为descriptor.value可选类型，按已有运行时检查补TS收窄。

交叉审查实际补强：历史冷读单份资源union、私有捕获所有权、结构检查到打开间的升级竞争回滚、v6全部映射历史/类别/revision最终门，以及实际旧个人库名保护。最终相关单元、四项Chrome和构建均在修正后通过。

## QA与下一入口

QA-V1-03的六代当前/v6家族/旧档案/身份子项、04的工程scope保全/卷损坏/原bytes、05的工程CAS/取消/commit刷新重试/源变化/预算注入、07的真实资源/冷读子项通过本批必要检查。没有穷举所有阶段的进程崩溃、真实用户库存量/配额耗尽或跨浏览器；全目录512安装/2048组织与精确身份映射留e，主会话混合旅程/双受众PNG和QA-V1-08留f。整个M2-0/QA-AI-16仍开放。

下一M2-0e：新个人库、中性完整v1载体和备份、算法1精确key、全组织/安装状态保全及curation/refines映射；随后f切主会话。AI服务、草稿与SVG仍按M2-1至4推进。旧源码/测试/素材、48/49及更早结论、独立todo与a/b/c成果保留，未commit/push或部署。

交付保护检查：54份文档801处本地链接/锚点、266张表格和QA/PRD/ADR编号、差异空白/凭据模式均通过。677份起始文件655原字节保持，22处为本批说明/计划及共享入口/批次/检查工具；新增21文件。旧产品源码/测试/素材、48/49、独立todo、依赖/应用版本、HEAD与空暂存保持，没有删除起始文件；work/evidence未重建。小型hash/检查清单仅在系统临时目录，不新增原始验收大包。
