# U1a 独立记录索引

本地版本`0.2.0-m1-u1a`，实现、实际运行与待统一回归项见[38记录](../../38-u1a-workspace-validation.md)。用户2026-10-23要求先需求开发和简单测试，完整回归等通知后统一进行；本次不再扩大验证或归档。

原始记录保留在仓库根目录的`work/u1a-20261023/`，不删除或改写旧报告。轻量状态摘要见[status.json](status.json)；这不是完整附件归档清单。

- `unit-final.json`与`unit-final.log`：最近一次87文件1075/1075，102.99秒；已在调整节奏前运行完成。
- `build-final.log`：正常构建成功，Vite阶段4.70秒。
- `chrome-u1a-final/report.json`：当时15项专项通过，87.454秒；不代表之后新增用例或最新完整回归。
- `chrome-full-before-review/report.json`：原190项批次150通过、2失败、2超时、1中断、35未运行。
- `chrome-review-corrected/report.json`：定向14通过、2失败，407.164秒；对应修正/未复验内容见38。
- `production-ui/run-2026-10-23T08-28-14-578Z/`：正常生产UI功能冒烟通过，34.406秒；保留4个完整工程下载、runner、报告和截图。390px全页截图异常待复核，不能视为窄屏视觉通过。
- `typecheck-handoff.log`：最新浏览器用例补充后的类型检查；不等于运行了这些用例。

紧凑reporter按SHA保存可保留附件，大于8MiB只记录hash/大小及`retained:false`，不能据此称已保存原件。所有记录区分Node/fake-indexeddb、真实Chrome原生存储/Canvas与正常生产UI；模拟失败不是真实磁盘耗尽。源码/产物早期冻结只归对应批次。

最新完整回归、离开屏障挂起保存两阶段、采用后无卸载提示及窄屏视觉复核均留待用户通知后统一进行。U1b/U2、完整M1/P3与正式性能门继续保持原状态；未commit/push或发布。
