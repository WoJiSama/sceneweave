# B4 独立证据

对应[20 联合验证报告](../../20-m1b-b4-validation.md)。旧 M0/B1/B2/B3 报告、证据和原始美术文件保留不变。

| 内容 | 入口 |
|---|---|
| 统一验证 | [总览](validation-summary.json)、[305项单测](unit-results.json)、[58项Chrome](browser-results.json)、[生产页面](production-smoke.json) |
| 中间失败与复核 | [验证历史](verification-history.json)；包含失败轮次，最终结果以browser-results为准 |
| 包与依赖 | [书房依赖](VIS-01-dependency-failure-matrix.json)、[岩岛依赖](VIS-02-dependency-failure-matrix.json)、[实际损坏与解码](VIS-01-byte-and-native-decoder-failures.json)、[取消与像素预算](VIS-02-cancellation-and-pixel-budget.json) |
| 实际隐私像素 | [VIS-01-S01](VIS-01-S01-privacy-matrix.json)、[VIS-02-S01](VIS-02-S01-privacy-matrix.json)、[VIS-02-S02](VIS-02-S02-privacy-matrix.json) |
| 离线数据与往返 | [书房](vis-01-fresh-complete-storage.json)、[岩岛](vis-02-fresh-complete-storage.json) |
| 双标签与恢复 | [书房](vis-01-cross-tab-recovery.json)、[岩岛](vis-02-cross-tab-recovery.json) |
| 失败保留 | [书房](vis-01-failure-preservation.json)、[岩岛](vis-02-failure-preservation.json) |
| 可操作诊断 | [书房](VIS-01-diagnostics.json)、[岩岛](VIS-02-diagnostics.json)、[取消迟到结果](VIS-02-cancel.json) |
| 完整工程 | [书房](study.sceneweave)、[岩岛](island.sceneweave)，均来自最终生产构建的实际下载 |
| 实现指纹 | [SHA-256清单](implementation-files.sha256)，仅对应本批源代码与资源，不重写历史指纹 |
| 静态交付检查 | [文档引用](doc-checks.json)、[完整包与历史保留](delivery-checks.json)，与运行结果分别记录 |

隐私JSON保存48次实际Canvas/4096 PNG观察的完整RGBA哈希、实际解码依赖、释放数量和遮罩像素。每份工程A/B×GM/player×预览/PNG×新上下文/重复调用共16格；重复调用复用模块与Blob字节，每次独立解码并关闭位图，没有持久ImageBitmap缓存。S02两副本一致西移一棵树477mm，以保留所有原物件并满足支撑校验；生产样板不变。

大型机器记录采用紧凑JSON序列化，保留全部字段和观察值；统一结果、方法、范围与限制另有可读摘要。

仓库中的`*-thumbnail-1024.png`为**缩小至长边1024的展示图**，不能代替4K逐像素比较；[缩图索引](privacy-thumbnails.json)保存对应完整PNG字节哈希和大小。完整4K图保存在本次工作区和交付目录。其他`*-production-*.png`与`*-missing-dependencies.png`为实际页面截图。

单次正确性运行的时长不作为B5性能结论。空库存储离线流程先在线加载应用runtime；配额/写入/部分解码故障为明确注入。没有PWA断网冷启动、真实配额耗尽或跨浏览器结论。
