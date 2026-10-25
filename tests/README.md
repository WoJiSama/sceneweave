# 浏览器测试范围

当前产品入口只保留首页 `#home` 和统一工作区 `#workspace`，使用 `sceneweave-complete-project@1` 完整工程及原生工程／素材仓库。未知 hash 回到首页，活动草稿仍接受正常离开守卫。

2026-10-25 按用户「开发阶段不需要旧工作台及首页旧版本支持」的要求，删除仅服务于旧整页工作台的测试。当前首页、样板、布局、素材、选择、混合工具、历史、AI 及 SVG 测试继续使用原生会话。U1a 的三种样板取消／采用、继续编辑、草稿导航守卫、建筑连续性、完整工程导入、资源取消与真实跨标签 CAS 均保留。

默认配置的 `npx playwright test --list` 当前发现 **34 个文件、127 个用例**；原清单是 62 个文件、258 个用例。退休的 28 组共 126 个用例，再加混合文件中移除的 5 个旧入口用例，合计减少 131 个。列表检查只确认发现与加载，不表示浏览器执行通过。实际执行结果以本轮验收文档为准。

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
