# 0.2.0-m1-d2 全量自动化回归

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](46-validation-retention-audit.md#7-按用户要求执行清理)。

2026-10-23，用户明确要求“全量回归”，启动此前38/39/41/43后置的自动化检查。当前功能版本保持`0.2.0-m1-d2`，起始HEAD为`e749faba64ab2b6d15b1db6c25caa50d60a061ce`，包含上一批未提交素材与功能。本轮不开发M2、不自动commit/push、不执行34中暂缓的正式性能专项。

**全量单元1123/1123通过；完整Chrome套件203项全部执行，首轮200通过、3个旧测试合同失败，修正后相关三个文件14/14通过；203个不同用例均已有通过结果，无未解决自动化失败。** 这是一次全量执行加相关文件复验，未声称重新完整执行了一轮203/203。两批间产品`src`字节保持一致，变更仅为测试/检查工具、报告及交接。

## 环境与范围

- macOS26.6.2、arm64；Node24.14.1、npm11.11.0。
- Vitest4.1.12、Playwright1.56.1、系统Chrome156.0.8078.47；浏览器1 worker，配置重试0。
- 实际环境（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/environment.json`）、依赖核对（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/dependencies.log`）、203项/47文件列表（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/browser-tests.list`）、范围说明（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/scope.json`）。

完整套件覆盖M0至C5、M1-D哨所、U1首页/统一会话/兼容入口、U1b布局、U2目录组织/采用/备份，以及内容补标、两题材小样、精修与SCN阶段制作。沿用独立浏览器上下文及原创/合成夹具，不使用真实用户工程。既有M0的500/2000程序物件负载用例保留在浏览器套件中，其观察不替代C5正式性能矩阵。

## 实际结果

| 检查 | 实际结果 | 原始记录 |
|---|---|---|
| 全量单元 | **98文件1123/1123，32.65s** | 日志（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/unit-initial.log`） |
| 类型检查 | 初始、新增回归夹具后、测试修正后与最终均exit0 | 最终日志（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/typecheck-final.log`） |
| 正常生产构建 | 通过，Vite3.38s；保留既有大chunk提示 | 日志（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/build-initial.log`） |
| 补标索引与实际资源 | 真实Chrome完整字节/许可/解码及精确索引`--check`通过：62条、旧37、六精修 | 日志（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/curation-check.log`） |
| 首轮完整Chrome | **203项/47文件：200通过、3失败，1130.328s**；0重试/跳过，未中止 | 报告（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/browser-initial/report.json`）、日志（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/browser-initial.log`） |
| 修正后相关文件复验 | **14/14，65.123s**；含所有C0四组500/2000、候选/键盘/窗口/受众与4K、素材工坊和VIS-01 | 报告（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/browser-corrected/report.json`）、日志（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/browser-corrected.log`） |
| 用例核对 | 按同一用例标题合并最新结果，203个不同用例均通过、0未解决；产品源码未变 | 核对记录（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/browser-reconciliation.json`） |
| 正常生产U1流程 | 最终检查通过，13.848s；0dialog/page/console/HTTP错误，无DEV API | 最终报告（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/production-u1a-final/report.json`） |
| 正常生产内容流程 | 通过，3.505s；实际墓园检查/保存与原件、精修实图解码 | 结果（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/production-content/result.json`） |

生产U1流程从默认首页新建真实完整空白，实际放置与旋转25°，下载完整包，Home继续保持选区/缩放/undo，刷新首页后明确重开原生存档。四次完整包检查实际manifest/entry SHA、完整资源许可、identity3/appearance1及34图真实解码，重新打开的document/identity/appearance/resources完全相同。正常生产目录保持`/sceneweave/`子路径，未通过DEV或源码导入注入工程。

## 首轮失败与测试修正

本轮没有修改产品实现或放松领域/隐私/依赖/CAS门槛。所有原失败结果保留；修正针对当前已定交互及有效等待。

1. **旧素材工坊完整包含断言。** 显示完整校验报告后视口收缩，U1b保持实际像素比例，地图允许被裁剪；旧测试仍期待自动适应全图。现在明确点击“适应全图”，等待zoom1/pan0与绘制帧，再对实际viewport检查地图四边完整包含，并保留非平坦实际纹理检查。
2. **C0候选和窗口缩放的相对zoom断言。** 保存的trace显示候选前后实际地图均1053.5×752.5px、pan(-40,0)，候选栏占64px后图像Y补偿32px，相对fit倍率1.25→1.3986988847583641。当前合同保持世界中心与实际px/mm，测试改测实际地图尺寸及归一pan；窗口改变同样检查，随后明确按0验证全图。候选取消后的原视口恢复、8/.25上下限、受众/工程切换重置及4K像素断言均保留。
3. **旧VIS-01换图直接提交预期。** 当前兼容工坊选择后先形成可取消候选，旧测试立即读取已提交文档。现在明确检查预览前后工程不变、取消保留原件，再重新选择并采用，继续检查占地/字段、组合拆分、undo/redo及持久重开。

回归前还修正了两处U1a统一工作区旧“场景”tab定位为右下“对象”，M0负载用例显式进入`#geometry`；保留兼容工坊的旧“场景”和34图空白断言。正常生产U1工具同样更新对象导航，并发现点击放大后过早采样旧倍率1，而实际已1.25；补等待真实倍率改变后，Home继续与重开检查通过。其首轮生产失败（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/production-u1a-initial/report.json`）独立保留。诊断记录（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/audit-notes.json`）列出轨迹证据和覆盖边界。

## 新增U2真实浏览器回归

原41只有公开单图的简单旅程。本轮新增两项有实际执行证据的用例，均在完整203项中通过：

- **真实派生及私密固定组合跨库。** Chrome实际Canvas源图→0.5亮度派生→至少两层固定源与GM模板→完整库备份；新浏览器上下文的空库离线恢复，采用真实固定闭包。缺合法遮罩时普通Workspace候选拒绝且当前工程/undo保持；有遮罩时放置保留GM成员，撤销/重做与原生重开保持。实际4096×4096输出中，放置前/后玩家RGBA hash相同，GM输出改变，PNG无文本/EXIF/时间元数据；源/派生字节和许可实际SHA、8×8像素值分别核对。该原创像素夹具验证机制，不代替P2/P3美术。
- **两页个人整理CAS。** 同一站点两个实际页面编辑不同确切素材；先保存者生效，旧库revision提交被拒绝，草稿保留；刷新只更新基线，明确再保存后两条记录及两工程/undo都保持。

完整实际JSON/PNG见首轮报告中的`u2-private-library-offline-4k.json`、`u2-private-restored-{gm,player}-4k.png`与`u2-two-page-cas-draft.json`附件。离线前先载入模块，不是空缓存PWA冷启动或真实配额耗尽。

## 旧待验项复验与视觉检查

38中C5首条冷启动、legacy采用后无残留卸载提示、兼容离开等待真实保存成功/模拟拒绝后的输入屏障与分支保留，本轮均由对应实际浏览器用例通过。U1全部首页/发现/副本升级、真实C2 witness寿命、导航/迟到结果及原生CAS用例通过；U1b两条桌面/触摸布局、偏好和焦点流程通过。新内容、两小样、精修对照和SCN-01/04普通阶段制作5项均通过。

390px整页截图在本轮一张正常、一张出现重复拼接，不能只凭功能断言通过关闭视觉问题。独立正常生产诊断记录DOM始终只有1份home/header/h1和5张样板卡；实际scrollY为0/650/1040时页眉位置0/−650/−1040，中部（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/home-capture-audit/viewport-middle.png`）/底部（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/home-capture-audit/viewport-bottom.png`）真实viewport截图连续正常，页面宽390、根高度1884，无横向溢出。截图工具增加resize后的字体/双帧等待，主代理实际查看的最终整页图（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/production-u1a-final/home-390.png`）正常。只读像素核对发现异常旧图在y775/1532精确重复顶部logo，最终图与独立诊断全图无重复，见诊断观察（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/home-capture-audit/observations.json`）/像素分析（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/home-capture-analysis.json`）。证据支持捕获时序/拼接问题的推断，未确认Chrome内部根因，也不保证所有整页捕获永不异常；异常原图仍保留。产品页面未为截图作改写。最终桌面重开画面（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/production-u1a-final/workspace-reopened-desktop.png`）与正常生产精修对照（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/production-content/production-comparison.png`）另存。

## 保全、复现与仍待

旧素材/运行图片、既有证据、13/17–43报告与用户todo共1399份文件保持起始hash，见保全核对（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/preservation.json`）。当前测试/工具与应用指纹见源码记录（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/source-fingerprint.json`）。没有清理数据、覆盖原证据、提交或推送。

文档只收录紧凑结果、三失败截图/上下文及新增U2关键证据。原始其他附件、trace和生产完整包仍在`work/regression-20261023`，索引保留实际SHA/字节与工作路径；未归档到文档的字节明确标记，避免再次生成大型重复归档。

```sh
npm test
npm run typecheck
npm run build
node tools/build-content-curation.mjs --check
SCENEWEAVE_BROWSER_CHANNEL=chrome SCENEWEAVE_EVIDENCE_DIR=work/regression-20261023/browser-initial npx playwright test --reporter=line,./tools/testing/compact-reporter.mjs
SCENEWEAVE_BROWSER_CHANNEL=chrome SCENEWEAVE_EVIDENCE_DIR=work/regression-20261023/browser-corrected npx playwright test tests/assets-browser.spec.ts tests/c0-viewport.spec.ts tests/study-browser.spec.ts --reporter=line,./tools/testing/compact-reporter.mjs
```

**自动化全套已有通过结果，不等于完整M1/P3/所有人工QA签收。** 实际200%浏览器缩放、完整键盘/触摸排列、最新`#workspace`的QA-WS-06全套混合/空存储历史/恢复/双受众联合旅程，不能单凭旧`#outdoor` C5或分开通过的用例直接关闭。真实小团、跨浏览器、实际配额耗尽、UVTT目标软件导入和P3仍需各自证据。C5正式四组×三轮性能矩阵按34继续后置，QA-PERF-01/04未通过。

当前可按07继续M2-A实施准备；M1-D及M1仍保留上述人工/专项验收边界。后续新功能按具体授权安排检查，不把本次全量结果永久继承到未实现的代码。
