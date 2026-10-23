# U2最小证据

仅定向单元摘要/部分原始日志、类型/正常构建和两个Chrome冒烟。完整回归及性能待用户通知。实现范围及实际限制以[41](../../41-u2b-catalog-validation.md)为准，严格合同见[40](../../40-u2a-catalog-contract.md)。

- `browser-initial/report.json`：两个脚本定位失败，保留trace/截图和hash附件。
- `browser-corrected/report.json`：修正后的两个简单Chrome流程，0失败/重试/跳过。
- `simple-checks.json`：逐批命令、计数、来源和没有运行的矩阵；没有原stdout的代理回报明确标示。
- `source-fingerprints.json`：本批相关最终源码hash。
- `delivery-checks.json`：文档链接、旧证据/todo保护和范围核查。

附件按SHA256寻址，报告中的附件hash和实际字节可独立核验；没有复制完整浏览器HTML报告或旧工程资源。
