# 测试导航与复现

本页只维护测试入口、覆盖范围和运行方法；开发任务归[路线图](../docs/07-roadmap.md#development)，全部验收归[质量计划](../docs/09-quality-plan.md#acceptance)，实际通过、失败、跳过和冻结指纹归[历史台账](../docs/archive/README.md)。发现/加载的用例数不等于执行结果，历史测试数字不在本页滚动维护。

当前产品只保留首页`#home`与统一工作区`#workspace`，新标识完整工程按严格v1–v4分派；旧整页工作台、旧格式导入和旧库发现不作为产品入口。未知hash回首页，活动草稿经过离开守卫；实际支持及拒绝范围归04/06。

## 运行规则

- 普通Vitest、AI和Playwright测试使用受控输入/provider，不调用真实付费模型。真实模型验收必须另行明确发起，未知计费请求不自动重发。
- 完整浏览器回归前冻结源码并启动同版Vite。运行中修改Workbench可能使带时间戳导入和测试无查询导入得到不同会话，不能把该环境失败解释为数据丢失，也不能用定向通过拼成全套通过。
- 正常生产检查先运行正常`npm run build`，从dist的真实UI操作，不使用DEV钩子、源码导入或存储注入。浏览器、测试、构建与正式性能串行。
- 每轮使用新的输出目录，保留首次失败、修复及复验。默认产物位于忽略的`work/`或`test-results/`；可用`SCENEWEAVE_EVIDENCE_DIR`指定生产检查目录。
- 同轮本机冷重载检查完整内容hash；独立导入会分配fresh身份/revision0，不要求导入前后整包hash相同。图像仍按实际像素、秘密过滤和资源闭包核对。

基本命令、浏览器安装、系统Chrome及三引擎配置见[贡献说明](../CONTRIBUTING.md#当前主路径回归)。完整回归不在日常文档或低影响修改时重复运行。

<a id="t3五地貌与路线专项2026-10-26"></a>
## 按能力选择检查

| 范围 | 主要入口 | 关注边界 |
|---|---|---|
| 当前主会话与工程IO | `m20f-ui/render/entry`、`u1a-workspace`、`u2-catalog-regression`、`sample-loading` | 安全新建/切换、完整包、混合编辑、资源取消与跨标签CAS；兼容API测试与产品入口分别报告 |
| AI与保护采用 | `m21-ai-conversation`、`m22-ai-authoring`、`m2-assimilation-acceptance`、`m2-failed-draft-recovery` | 真实HTTP/SSE/SQLite与受控provider，单件→组合→明确范围，失败草稿恢复及保护一次采用 |
| 视觉编辑 | `visual-authoring`、`visual-ai-authoring`、`visual-renderer`、`refined-island`、`refined-samples` | 原创空白、真实样板、曲线控制柄、授权/范围、滤镜/透明阴影、秘密与离线双受众4K |
| 地形生成与组合 | `terrain-generation`、`terrain-composition`；`src/shared/terrain-generation/*.test.ts` | 旧配方与v4组合路径分别固定输入，Node/Worker规范化一致，真实成本、保存/冷读/候选取消及过期拒绝 |
| 无模型程序底图 | `base-map`；shared/browser/application与`services/ai/base-map.test.ts` | 同输入Worker/HTTP完整结果一致，严格关联/版本/素材/hash，真实图片/保存/包冷读，服务端模型与新增任务数为0；初始成本/余量只属本次会话 |
| 底图AI接续 | `base-map-continuation`；shared `continuation`、workspace `base-map/clock`与service `continuation/execution-checkpoint` | 显式@2/v2与G/A分类、四hash/来源重放/执行累计；真实Worker/HTTP/SSE/SQLite、保护原工程后一次采用新工程、撤销/重做/冷读/包与双受众PNG，取消保留独立底图；确定性provider不等于真实模型验收 |
| 局部地形编辑 | `terrain-editing`、`terrain-surroundings`、`terrain-topology` | 笔刷/曲线、人工移动删除锁定保护、外围冻结范围、布尔完整结果、逐槽支撑重绑、保护/CAS及单次撤销 |
| 地形层次与布景 | `terrain-dressing`；同名规划/应用/目录单元及`scatter-v2` | 实际来源与布景同候选计数，预览取消不写主工程、完整影响确认、冷读与单次撤销；旧算法向量、人工状态、当前活动净空和固定来源保全 |
| 近侧视与区域 | `terrain-presentation`、`regional-authoring` | 根锚/占地/固定源、地影与秘密遮罩；区域来源、条件物化、独立下钻、离线包及双受众4K |

上表名称省略`.spec.ts`。地形路线单元另覆盖`t3-matrix`、`t3-route-generation`和`src/shared/geometry/terrain-travel.test.ts`：全转角带、障碍/连接、有限搜索、真实指定路线与伪造回执拒绝。有限搜索或某组样板通过不证明任意输入都可生成。

私密夹具须有覆盖两份配对几何及实际地影外扩的固定遮罩；缺遮罩应继续拒绝玩家投影。区域无法安全表达的来源保留完整快照并列入报告，不能把条件物化写成全量迁移。

## 定向与跨浏览器入口

```sh
npx playwright test tests/terrain-generation.spec.ts tests/terrain-composition.spec.ts tests/terrain-editing.spec.ts --workers=1
npx playwright test tests/terrain-surroundings.spec.ts tests/terrain-topology.spec.ts tests/terrain-presentation.spec.ts tests/regional-authoring.spec.ts --workers=1
npx playwright test --config=tests/visual-playwright.config.ts --workers=1
npx playwright test --config=tests/terrain-playwright.config.ts --workers=1
npx playwright test --config=tests/m2-joint-playwright.config.ts --workers=1
```

专用配置分别固定其Chromium/Firefox/WebKit项目，系统Chrome环境变量不改变专用配置已指定的项目。新增成图与局部修改流程核查适用跨引擎范围；旧M2全部流程不能由视觉专项外推。同一引擎往返做实际像素比较，跨引擎不要求抗锯齿逐像素相同。

## 正常生产检查

```sh
npm run build
node tools/testing/visual-production-smoke.mjs
node tools/testing/terrain-production-smoke.mjs
node tools/testing/terrain-edit-production-smoke.mjs
node tools/testing/terrain-presentation-production-smoke.mjs
```

地形生成生产脚本默认保留`island/coast`。需检查五配方及路线时，在新目录运行：

```sh
SCENEWEAVE_TERRAIN_KINDS=river,lake,forest,hill,mixed SCENEWEAVE_TERRAIN_ROUTE=1 SCENEWEAVE_TERRAIN_CANCEL=first SCENEWEAVE_EVIDENCE_DIR=work/terrain-route-production node tools/testing/terrain-production-smoke.mjs
```

取消默认逐类检查，`CANCEL=first`只检查第一类。正常生产核对候选/主工程/冷读字节、资源hash和实际GM/player PNG；工程时间戳会使不同轮整包hash不同，只要求同轮一致。技术链通过不关闭真实模型、视觉/P3、正式性能或UVTT真实导入。各批结果及首轮失败见[地形历史台账](../docs/archive/terrain-validation.md)和[视觉历史台账](../docs/archive/visual-quality-validation.md)。

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

这些检查验证保留的内部算法或历史格式，不代表产品继续提供旧工作台、旧库发现或旧格式导入入口，也不能替代当前主路径的UI／联合证据。

三引擎联合配置为`tests/m2-joint-playwright.config.ts`。部分用例存在浏览器条件跳过，报告实际执行与跳过范围；旧发现数量只属于原冻结。退休旧入口性能用例不表示性能门通过。
