# M0 首轮验证证据

采集日期：2026-10-20。解释、命令、设备与适用边界见 [M0 验证报告](../../13-m0-validation.md)。这里只保存本轮固定结果；后续实现变化不自动沿用通过结论。

| 文件 | 内容 |
|---|---|
| [validation-summary.json](validation-summary.json) | 命令结果、版本、设备、未测范围；根据完成的运行输出记录 |
| [implementation-files.sha256](implementation-files.sha256) | 本轮 35 个源码、测试和配置文件的 SHA-256；不包括文档和证据自身 |
| [performance.json](performance.json) | 500/2000 符号物件的全部原始时间样本、统计、浏览器和环境 |
| [privacy-and-export.json](privacy-and-export.json) | 4K 配对像素、PNG 结构、遮罩与一次导出观察值 |
| [sceneweave-editor.png](sceneweave-editor.png) | 1512 × 982 的主持人编辑器截图 |
| [workload-500.png](workload-500.png) / [workload-2000.png](workload-2000.png) | 两种程序符号负载的编辑器截图 |
| [player-4k.png](player-4k.png) | 实际 4096 × 3234 玩家输出 |
| [house.sceneweave](house.sceneweave) | UI 下载的原创主持人样例；包含固定虚构秘密，可导入复核 |

所有场景和符号均为本项目原创测试内容，没有玩家资料或官方模组。浏览器自动化在独立测试上下文运行；性能 JSON 的 heap 是单点读数，不代表峰值资源。`house.sceneweave` 是几何版主持人工程，玩家图与主持人工程的用途不同。
