# M1-D 海岸哨所首批原始证据

实际范围、方法、失败修正和剩余门槛见[35验证报告](../../35-m1d-outpost-validation.md)。本目录独立保留2026-10-23新增批次，不覆写13/17–34原证据；性能专项仍暂缓，C5/完整M1/P3未通过。

- [可编辑样板](outpost-editable.sceneweave)、[GM 4K](outpost-gm-4k.png)、[玩家4K](outpost-player-4k.png)、[桌面](outpost-desktop.png)、[390px玩家](outpost-player-390.png)取自正常生产旅程；工程含项目原创GM线索。
- `browser-initial.json.gz`保留1过3败，`browser-initial-failures.tar.gz`保留3个失败trace/截图/UI；`browser-corrected.json.gz`为4/4专项，`corrected-attachments.tar.gz`保留完整资源/离线历史、4K私密配对和原始JSON。它们不与最终全量拼接。
- `unit-final.json.gz`为85文件1008/1008，`browser-final.json.gz`为175/175全量原始reporter，其中4项M1-D为子集。真实测试名、用时、下载包及附件body保持原字节。
- [生产报告](production-report.json)与`production-ui.tar.gz`包含纯UI运行器、实际下载包/每条资源hash/原生RGBA、命名/保护快照与范围外编辑保持、桌面/390px及双4K。`production-serving.json`核对57份正常产物的实际HTTP字节。默认favicon404单列，不当成成功资源或隐藏失败。
- `application.tar.gz`、`normal-dist.tar.gz`及`frozen-application.json`保全实际受验源码/测试/工具/配置/素材与正常产物，原始manifest/MIT在应用归档和工程包中。`art-*`记录新6件原始来源、实际字节/透明边界及原创P2候选技术检查。
- `baseline.json`保护1188份旧报告/证据/素材和todo原hash；[独立核查](verification.json)、[最终检查](final-checks.json)、[归档复核](archive-verification.json)分别记录数据/包、文档/范围和归档确切字节检查。[索引](index.json)列全部文件真实hash/尺寸及原始reporter hash。

正常生产复现：先从仓库执行`npm run build`，独立串行`npm run preview -- --port 4175 --strictPort`，再执行`node docs/evidence/m1-d-outpost/scripts/production-runner.mjs`。默认写入忽略目录`work/m1d-outpost-20261023/production-ui`，不会覆盖本目录。`SCENEWEAVE_PRODUCTION_URL`与`SCENEWEAVE_PRODUCTION_OUTPUT`可显式指定。脚本不导入src，不调用产品开发API。

独立核查脚本按仓库根目录运行，要求原始`work/m1d-outpost-20261023`仍在；归档本身的字节复核只依赖本目录与index。未提供PWA断网冷启动、真实配额耗尽、通用路径、全套从空白SCN-04、用户P3、跨浏览器、小团或完整性能通过证明。
