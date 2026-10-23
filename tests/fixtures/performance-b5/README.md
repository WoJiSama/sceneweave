# B5 固定性能夹具

保留四个原始完整工程包和确切manifest，供既有浏览器/性能工具复现相同负载；它们是测试输入。2026-10-23按用户要求清理work与docs/evidence时，从原B5目录迁入，字节和原来源信息保持。

`manifest.json`记录当时的完成状态/来源修订与完整summary，不代表当前代码新测通过；历史原始测量日志和图片已清理，结论见[21](../../../docs/21-m1b-b5-validation.md)。迁移记录见[46](../../../docs/46-validation-retention-audit.md)。

浏览器测试可设置`SCENEWEAVE_B5_FIXTURE_DIR=tests/fixtures/performance-b5`。性能工具使用绝对路径`--fixtures "$PWD/tests/fixtures/performance-b5"`；内部`fixtures/`路径由加载器验证，不能只移动包而改写manifest的hash或summary。

四包合计961333字节，包含已验证的实际资源/许可。需要新增负载时按现行生成器/测量方法制作，不把历史manifest当当前性能结论。
