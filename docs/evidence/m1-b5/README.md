# B5 证据索引

对应[21报告](../../21-m1b-b5-validation.md)。本目录独立于M0/B1/B2/B3/B4历史；旧证据和原素材不覆写。

## 生产构建与回归

- [验证摘要](validation-summary.json)、[330单测/28文件](unit-results.json)、[62项完整Chrome回归](browser-results.json)、[4项正常生产工作台复核](production-results.json)。
- [正常构建及API隔离检查](build-checks.json)、[实际生产页面字节核对](production-served-build.json)、[生产构建日志](build.log)、[实现指纹](implementation-files.sha256)、[文档检查](doc-checks.json)、[交付检查](delivery-checks.json)。
- [本批验证历史](verification-history.json)区分诊断pilot、已撤回正式试验和最终证据；没有隐式重试或提高测试超时。
- [最终隐私回归](privacy-regression/summary.json)：B4三组48格矩阵在最终实现重跑，完整4K玩家像素与B4历史一致；完整原始矩阵保留在同目录。

普通B5负载保留原样板公开性，GM/player图相同不能代替秘密配对；保密结论依赖上述独立矩阵。工作台正确性用例包含真实点击/属性编辑/撤销重做、轮廓候选取消/采用/撤销、完整备份、新上下文预载应用后断网导入并继续编辑，没有PWA离线冷启动结论。

## 三个实际构建

| 构建 | 内容与去留 | 数据 |
|---|---|---|
| baseline | 加入观察器后的原生产管线；渲染与IO分开的解码入口，实际native峰值2 | [每组汇总](baseline/summary.json)、[环境/负载/窗口](baseline/manifest.json)、[源码和构建指纹](baseline/source-build-fingerprints.json) |
| candidate-reuse | 共享单槽修复＋同尺寸paintCanvas复用；正式比较后撤回复用 | [每组汇总](candidate-reuse/summary.json)、[环境/负载/窗口](candidate-reuse/manifest.json)、[源码和构建指纹](candidate-reuse/source-build-fingerprints.json) |
| final | 共享单槽与临时资源所有权修复；按key变化重新分配paintCanvas，不进行同尺寸重用 | [每组汇总](final/summary.json)、[环境/负载/窗口](final/manifest.json)、[源码和构建指纹](final/source-build-fingerprints.json) |

每个构建都是12轮正式测量：四组×三个新Chrome进程；每轮60次真实选择及30次物件/30次轮廓编辑，24次双受众4K。每个目录的`*-run-1.json`至`*-run-3.json`保留全部单次时间数组、原生解码区间、逐PID同时RSS、目标CDP堆、采样请求/响应时间与阶段标记；JSON只无损压紧空白，数值未抽样或四舍五入。性能采集期间串行运行，不并行其他测试/构建。

[三构建对比](comparison.json)核对四份工程所有ZIP条目字节及八组case/audience完整4K RGBA，并另算产品阶段JS堆。原summary中的全局堆包含工具审计/下载与idle；产品phase峰值排除这些阶段及跨阶段观察。RSS进程树和可能重复计共享页，最大采样间隔可能远高于100/200ms目标；不宣称唯一物理/GPU或瞬态完整峰值。

源/构建指纹是实际测量时的字节身份，不是远端提交已包含这些未提交改动的声明；`sourceRevision`记录开发基线。baseline还保存[渲染器源码](baseline/source-snapshot/renderer.ts.txt)与[IO源码](baseline/source-snapshot/resources.ts.txt)，已撤回候选保留[复用渲染器源码](candidate-reuse/source-snapshot/renderer.ts.txt)。不声称本目录保留全部历史编译bundle；最终实现可从交付提交重建，复现方式见[性能工具](../../../tools/performance/README.md)。

## 可编辑工程与图像

| 最终负载 | 初始严格完整工程 | 62修订编辑后备份 | 预览 |
|---|---|---|---|
| 书房500 | [fixture](final/fixtures/study-500.sceneweave) | [edited](final/study-500-edited.sceneweave) | [1024缩图](final/study-500-gm-thumbnail-1024.png) |
| 书房2000 | [fixture](final/fixtures/study-2000.sceneweave) | [edited](final/study-2000-edited.sceneweave) | [1024缩图](final/study-2000-gm-thumbnail-1024.png) |
| 岩岛500 | [fixture](final/fixtures/island-500.sceneweave) | [edited](final/island-500-edited.sceneweave) | [1024缩图](final/island-500-gm-thumbnail-1024.png) |
| 岩岛2000 | [fixture](final/fixtures/island-2000.sceneweave) | [edited](final/island-2000-edited.sceneweave) | [1024缩图](final/island-2000-gm-thumbnail-1024.png) |

baseline和已撤回候选各自也保留四份fixture/edited完整包。原始JSON的artifact路径记录原运行目录布局；不代表所有PNG原图都收进Git。[图像索引](artifact-index.json)记录三个构建真实PNG大小/hash和最终缩图路径；完整4K RGBA hash见各summary，逐像素比较先于缩图生成。最终原图在本轮本地交付目录，缩图只用于展示。

这些高密度副本有大量真实尺寸物件重叠；受众纳入数和输出范围数均已记录，遮挡后实际可见数未测。它们是合法性能负载，不能作为推荐布景密度、独立图片容量或P3艺术验收。
