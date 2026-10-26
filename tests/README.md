# 浏览器测试范围

当前产品入口只保留首页 `#home` 和统一工作区 `#workspace`，使用严格 `sceneweave-complete-project@1|2` 完整工程及原生工程／素材仓库。新空白为2，已有新标识1可建立独立视觉副本。未知 hash 回到首页，活动草稿仍接受正常离开守卫。

2026-10-25 按用户「开发阶段不需要旧工作台及首页旧版本支持」的要求，删除仅服务于旧整页工作台的测试。当前首页、样板、布局、素材、选择、混合工具、历史、AI 及 SVG 测试继续使用原生会话。U1a 的三种样板取消／采用、继续编辑、草稿导航守卫、建筑连续性、完整工程导入、资源取消与真实跨标签 CAS 均保留。

默认配置当前发现 **39个文件、142个用例**；在原37文件137项上新增精修岩岛1项及精修样板4项，含三palette真实空白闭包、SVG透明边缘CPU栅格、海岸/室内取消/采用/撤销/重载/离线双4K。M2旧入口裁剪批次为34文件127项。裁剪前清单是62文件258项；退休28组共126项，加混合文件移除的5项旧入口，合计减少131项。列表只确认发现与加载，实际执行结果见[53](../docs/53-visual-authoring.md)与[54](../docs/54-reference-quality-plan.md)，旧M2裁剪回归归05第18节。

新增 `visual-authoring`、`visual-ai-authoring`、`visual-renderer` 覆盖真实原创空白、三样板UI/离线/4K逐像素、秘密光雾过滤、实际曲线控制柄与范围确认、有限历史恢复、视觉授权/制作清单及隔离保护采用、区域滤镜羽化和透明阴影。`tests/visual-playwright.config.ts`另含`refined-island`与`refined-samples`，15项用于Firefox/WebKit，共30个执行位置；它不代表旧M2全部流程都跨引擎执行。正常生产另运行 `node tools/testing/visual-production-smoke.mjs`，共11步且只经UI写入，没有DEV钩子或真实模型请求。

完整回归运行期间保持源码冻结，使用新的Vite进程。运行中修改Workbench会使App带时间戳导入与测试的无查询导入取得不同会话实例；Q5首次120通过/22失败的运行已保留，不能将空实例失败解读为保存成果丢失，也不能以定向通过冒充重新全套通过。

## 退休的旧入口测试

这些文件依赖 `#assets`、`#history`、`#layers`、`#geometry`、`#composition` 或 `#outdoor` 整页 UI，随对应工作台一起删除。Git 保留历史版本及旧验收记录。

| 文件 | 原用例数 |
| --- | ---: |
| assets-browser.spec.ts | 4 |
| b4-privacy.spec.ts | 3 |
| b4-workbench.spec.ts | 4 |
| b5-workbench.spec.ts | 4 |
| c0-viewport.spec.ts | 6 |
| c1a-creation.spec.ts | 6 |
| c1b-selection.spec.ts | 13 |
| c1c-layers.spec.ts | 3 |
| c1c-renderer.spec.ts | 7 |
| c1d-workbench.spec.ts | 6 |
| c2-polygon-workbench.spec.ts | 1 |
| c2-structure-history.spec.ts | 4 |
| c2-workbench.spec.ts | 3 |
| c3-storage.spec.ts | 2 |
| c3-workbench.spec.ts | 8 |
| c4-storage.spec.ts | 4 |
| c4-workbench.spec.ts | 7 |
| c5-integration.spec.ts | 3 |
| c5-storage.spec.ts | 3 |
| editor-browser.spec.ts | 5 |
| editor-lod.spec.ts | 6 |
| island-browser.spec.ts | 4 |
| island-renderer.spec.ts | 3 |
| m1d-outpost.spec.ts | 4 |
| performance.spec.ts | 1 |
| study-browser.spec.ts | 4 |
| study-renderer.spec.ts | 4 |
| u1a-legacy.spec.ts | 4 |
| **合计** | **126** |

混合文件另退休：`m20f-entry.spec.ts` 的旧工程保全转换、旧个人库转换、取消转换三个 UI 用例；`u1a-workspace.spec.ts` 的六旧库发现和显式 v5 升级两个 UI 用例。`m20f-entry` 保留原生历史包导入、失败保护和重开用例；U1a 文件导入用例改为当前完整 v1 合同。

## 保留的底层检查

部分 API／资源／迁移测试仍直接调用旧数据模块，例如 `assets-resources`、`b4-package`、`b4-storage`、`c1c-storage`、`c1d-renderer/storage`、`c2-renderer`、`c3-resources`、`c4-renderer`、`c5-resource-reuse`、`study/island-assets`、`privacy/storage-browser`、`m20d-conversion`、`m20e-library`。`m20f-render` 使用旧渲染器作为独立像素参考；`u2-catalog-regression` 的第一个用例保留历史底层库与渲染验证，第二个当前两页 UI 用例使用原生素材仓库。`m2-joint-acceptance` 中旧六库转换也是直接 API 检查。

这些检查验证保留的内部算法或历史格式，不代表产品继续提供旧工作台、旧库发现或旧格式导入入口，也不能替代当前完整 v1 的 UI／联合证据。

`tests/m2-joint-playwright.config.ts` 仍发现 11 个不同用例、3 种浏览器共 33 个执行位置；部分浏览器存在明确条件跳过，必须按实际执行和跳过数报告。正式性能矩阵仍按独立计划执行，退休旧入口性能用例不表示性能门通过。
