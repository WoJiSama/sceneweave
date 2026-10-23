# U1b 简单检查记录

当前本地版本`0.2.0-m1-u1b`，实现、操作与未验证边界见[39](../../39-u1b-layout-validation.md)。用户要求仅简单测试，完整回归等待通知。本目录只保留小日志、两条布局冒烟及窄屏保存状态复验的JSON/截图，没有重跑或改写前批证据。

- [checks.json](checks.json)：本批实际范围、结果、源码hash与起始1663文件保护核查。
- [simple-unit.log](simple-unit.log)：2文件11/11定向检查，221ms。
- [build-final.log](build-final.log)：tsc与正常Vite通过，Vite阶段3.52秒；不是性能门。
- [simple-browser/report.json](simple-browser/report.json)：2/2布局冒烟，12.308秒。第一轮2/2/14.1秒另留日志。
- [save-status-smoke/report.json](save-status-smoke/report.json)：修正旧样式隐藏保存状态后，仅窄屏简单用例复验。

浏览器附件按SHA引用，采用真实首页新建的空白工程，DEV仅只读观察；没有夹具工程写入、4K、压力负载或完整联合旅程。纯单元、实际浏览器和完整验收分别记录，不把数量合并为完整QA通过。manifest.json列本目录实际保留文件的sha/大小，不包含自身hash。

历史报告35–38、素材/领域/IO与既有证据及todo保持；不删除用户数据，未commit/push。
