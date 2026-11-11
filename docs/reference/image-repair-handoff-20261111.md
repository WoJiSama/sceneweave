# 图片拆解、统一素材编辑与代码修复交接（2026-11-11）

这是用户要求的跨电脑会话交接，覆盖琴房图片拆解、统一编辑页、钢琴有限结构重绘，以及最后讨论的代码修复方向。它保存本会话的上下文和接续方法；开发任务仍以[07路线图](../07-roadmap.md#image-to-project-plan)为准，正式验收仍从[09](../09-quality-plan.md#image-to-project-acceptance)执行，不另建任务或验收台账。

**接续结论：用户认可最后一版钢琴结构重绘，下一步应提高通用代码修复的下限，再让视觉模型处理需要语义判断和有限推断的部分。最新一轮只是分析这些算法方向，尚未实现或验证新的分割、抠色、木纹结构修复算法。** 当前交付请求是写交接文档，不继续修改算法。

## 1. 仓库基线与同步边界

本次交接核对时分支为 `main`，HEAD 为 `5b2119d040342f3c8fb56e098a0a3a433681514d`（`docs: 同步能力合同验证台账与跨机器性能交接`），工作区原本干净。本会话功能已经进入受 Git 管理的源码，不是只留在临时目录的原型。可追溯提交包括：

- `0b3c5cc`：统一素材编辑入口及图片拆解草稿保护。
- `823c06d`：可追溯的图像增强与素材重绘内核。
- `0de7c40`：同步工作台导航和当前功能浏览器回归夹具。

上述提交用于定位历史，另一台电脑应先核对实际 HEAD 和差异，保留后续提交及无关编辑，不回退或覆盖当前仓库。本交接文档及导航修改需要提交并推送后，另一台电脑才能通过 Git 获取；写入非忽略路径本身不会完成同步，本次交接不执行提交、推送或部署。

**仅拉取仓库能继续通用算法开发和自动化自检，不能复现原钢琴的全部视觉结果。** 用户原图、实际结构稿、完整示例工程、截图和原始日志均在旧电脑忽略目录中，详见第6节。浏览器 IndexedDB、个人素材库、会话草稿、密钥和本机模型配置也不随 Git 同步。

## 2. 用户已经确认的产品与算法方向

1. 首要问题是真实缺陷：钢琴的青蓝色边，木纹补底的接缝、重复暗带；增加分辨率不能算增加精细度。
2. 内置、个人和导入 item 都应进入统一素材编辑页，集中属性、占地、图像、来源及许可。图片转项目也应有完整阶段、对象清单、统计和问题审阅，避免分散的独立画质工具页。
3. 琴房和钢琴用于诊断、验证可推广的算法与设计，不能为了拆得更多而拆，也不能把手工修好一张示例当通用算法进步。
4. 保留两条可选路线：**SVG矢量重建**、**图像模型有限补画**。二者共用原件、来源、许可、候选审阅和一次采用/撤销。
5. SVG路线无需图片编辑模型、服务地址或 API key。当前钢琴的部件关系和结构稿由具备视觉能力的助手分析后提供，代码负责严格编译和落地；应用尚未自动从图片识别完整结构稿。
6. 允许有限重绘，包括边缘和缺失细节，但必须区分观察与推断，不能声称恢复了原图中根本看不清的真实细节。
7. 用户对最终钢琴明确表示“现在的最终结果我觉得是好的”，随后要求分析代码还能改什么，确认“首先用代码来修复，然后会用视觉模型辅助”，“代码修复决定了下限，而大模型决定了上限”。这不是全部图片拆解、所有画风或完整P3/M3验收通过。

## 3. 本会话做过什么，结果如何

### 3.1 共用图片导入与统一编辑

沿用并完善项目自己的图片导入链：原像素提取、精细蒙版、磁性圈选、保留/排除画笔、分材质取样补底、逐层重放和来源诊断；候选采用后可保存本地 item。原件与派生来源保全，手工和模型工具复用执行层。

编辑入口已收拢：内置/个人/导入 item 使用素材副本编辑页，场景实例共享编辑布局；图片导入集中四阶段、对象清单、统计和定位问题。切换处理方式保留各自参数与候选；清理草稿有明确确认，取消保留成果。已提供并查看桌面、近景、窄屏及目录副本预览；图片文件本身未进入 Git。

### 3.2 基础代码处理：已有能力与真实失败

基础链包含线性光、预乘 alpha 插值、保守透明边调整、弱降噪及显式 `decontaminate` 去色边。它们属于可撤销的派生处理，不覆盖原件。

真实钢琴的三个保守去色边候选没有有效变化，拒绝把无变化候选当修复采用。单纯插值提高了输出尺寸，未增加细节；旧像素描摹与后来的区域色阶/渐变虽减少碎色块，仍保留蓝边，键盘仍模糊，用户明确判为不合格。相近源像素误差、更多路径或更大尺寸均未作为画质改善证明。

补底已有按材质 donor、对齐与颜色校正，但木板接缝和重复暗带仍存在。部分先前试验失败，不能再把相同试验换名当新改进，具体见第7节。

### 3.3 新增源绑定的有限结构SVG重绘

新增通用结构稿编译器：支持 `M/L/Q/C/Z` 路径、重复矩形、色面、渐变和描边；每个部件说明观察/推断及理由。钢琴几何存放于独立稿件，没有写成生产算法的特殊模板。

- `structure-plan-v1` 绑定真实源字节 hash、源尺寸/坐标框和完整计划。
- 输出真实SVG及长边1024的规范PNG，允许改善轮廓，不再套回旧 alpha。
- 严格解析、累计预算、危险引用、访问器和保守描边外扩检查持续执行；全透明结果拒绝。
- 公开校验、保存/导入和冷读实际重编译并核对SVG/PNG；保留原件、许可、物理占地、支撑、私密、锁、基线和私有候选 witness。
- SVG页默认结构重绘，原像素描摹保留作对照。修改结构稿后，旧候选不能继续采用。
- 已修复处理中间父源无法恢复的问题：根原图A→基础处理B→结构重绘C，保存并冷读C后，“已保存结构稿来源”读取确切B，恢复真实hash/像素/框；不能把计划hash改成根原图或当前结果来绕过绑定。

钢琴经过三轮视觉复查，修正琴盖偏长、高光像胶带、厚边过宽和琴凳图标感。最后轮廓、厚边、琴键和琴凳可辨，在白/黑/暖底下未见原来连续的青蓝杂边；同尺度原场景复查未见不可接受的位置、方向、比例或遮挡变化，色调基本协调。其风格比周围手绘家具更圆顺、规整，键数、黑键节律、铰接、缝线和部分高光属于推断。

**修复的是新派生结构候选的边缘；原保真裁片自身仍带蓝边。木纹接缝/暗带及周边低清没有随钢琴重绘解决。** 当前编译器负责把给定结构稿变成合规资产，不等于已实现从图片自动生成结构稿。

### 3.4 可选图像模型补画与自审修复

已接可选图片编辑服务的能力检查、单次明确授权、上传像素来源、请求ID及派生采用链。能力查询与上传分开；发送前登记请求，unknown、取消和已完成后处理失败仍保留请求ID，不自动重发可能计费的请求。自审发现并修复了全透明成功结果可被采用、返回后取消/解码失败丢失请求ID，以及中间父源恢复等问题。

本轮服务验证使用受控HTTP响应，**没有发送真实图片模型请求，没有产生本轮图片模型费用**。真实补画画质未验证；缺少这一路配置不应阻塞SVG或本地算法。

## 4. 从哪些文件继续

| 范围 | 受Git管理的入口 |
|---|---|
| 统一素材编辑布局、个人/导入item、场景实例 | [AssetEditorLayout.tsx](../../src/editor/main/AssetEditorLayout.tsx)、[ImageImportItemEditor.tsx](../../src/editor/main/ImageImportItemEditor.tsx)、[SceneAssetEditor.tsx](../../src/editor/main/SceneAssetEditor.tsx) |
| 双路线与基础处理页面 | [ImageRefinementPanel.tsx](../../src/editor/main/ImageRefinementPanel.tsx)、[ImageEnhancementPanel.tsx](../../src/editor/main/ImageEnhancementPanel.tsx) |
| 图片导入、选区与审阅 | [ImageImportTool.tsx](../../src/editor/main/ImageImportTool.tsx)、[ImageSelectionReview.tsx](../../src/editor/main/ImageSelectionReview.tsx) |
| SVG结构稿、旧描摹、区域色阶 | [structure-plan.ts](../../src/shared/asset-refinement/structure-plan.ts)、[vector.ts](../../src/shared/asset-refinement/vector.ts)、[regional-tones.ts](../../src/shared/asset-refinement/regional-tones.ts) |
| 算法分派及严格派生元数据 | [algorithms.ts](../../src/shared/asset-refinement/algorithms.ts)、[metadata.ts](../../src/shared/asset-refinement/metadata.ts) |
| 基础插值/透明边、保守去色边 | [pixels.ts](../../src/shared/image-enhancement/pixels.ts)、[decontaminate.ts](../../src/shared/image-enhancement/decontaminate.ts) |
| 原像素提取、选区、补底、按层重放 | [pixels.ts](../../src/shared/image-import/pixels.ts)、[selection.ts](../../src/shared/image-import/selection.ts)、[repair.ts](../../src/shared/image-import/repair.ts)、[layer-replay.ts](../../src/shared/image-import/layer-replay.ts) |
| 真实字节、候选witness、来源和中间父源 | [image-enhancement.ts](../../src/platform/browser/content/image-enhancement.ts)、[image-refinement.ts](../../src/platform/browser/content/image-refinement.ts)、[resources.ts](../../src/shared/project/resources.ts) |
| 可选图片模型服务 | [image-edit.ts](../../services/ai/image-edit.ts) |
| 页面/程序/工具共用的导入宿主 | [replay.mjs](../../tools/image-import/replay.mjs)、[server.mjs](../../tools/image-import/server.mjs)、[build-room-sample.mjs](../../tools/image-import/build-room-sample.mjs) |

合同见[双路线](image-to-project.md#asset-refinement-routes)、[逐层来源证据](image-to-project.md#layer-source-evidence)。历史结果保留在同一[工作区验证台账](../archive/workspace-content-validation.md#asset-refinement-routes-20261111)，另有[真实缺陷跟进](../archive/workspace-content-validation.md#image-quality-followup-20261111)、[算法诊断](../archive/workspace-content-validation.md#image-algorithm-diagnostics-20261111)和[统一编辑](../archive/workspace-content-validation.md#unified-asset-editor-20261111)。这些受Git管理的文字可带走；其中引用的 `work/` 截图和日志不能靠 Git 获取。

## 5. 已有自检证据与复现方法

### 5.1 历史冻结结果

最后一次结构重绘开发冻结：

- 结构编译器与宿主两个测试文件 **33/33**，包括A→B→C保存/冷读后继续使用B。
- 正常生产 `npm run build` 退出0；冻结1878个输入、179个生产文件，记录的源码/产物未漂移，本任务源码与交付时工作区一致。
- 同一个正常生产包串行执行3条结构稿、7条双路线、3条统一编辑旅程，合计 **13/13**。
- 实际钢琴从普通页面生成、采用、撤销/重做、完整包导出，并在空白浏览器存储导入冷读；原件/资源、物理/位置/支撑/私密/锁保持。该旅程页面错误与图片模型请求均0。
- 7张页面截图覆盖桌面、棋盘/黑底200%、模型未配置、390px窄屏及目录副本；页面/console/网络失败0，390px无横向溢出。另有原房间与重绘后同尺度对照。

保留的首败包括：并行构建负载下一个大源用例超过原30000ms，串行保持原时限通过；现场冻结因其他存储工作线源码变化被拒绝，改用独立快照；首次快照遗漏 `assets/`，补入71个素材输入后构建通过；首次房间截图布局/选择框不一致，最终统一canvas为1200×1070、显示约1176.984375×1049后再作比较。

这些是**指定历史冻结的开发自检**，不是新电脑的当前结果或全仓正式验收。不能拼接其他冻结的数字，也不能把受控模型替身、用户对单张钢琴的认可外推为真实模型效果或全部P3通过。原日志缺失时只能引用已提交的文字记录，不能补造原始证据。

### 5.2 新电脑可独立运行的最小检查

先读根目录README、文档导航、07和09，核对Git状态。Node建议使用[.nvmrc](../../.nvmrc)中的24.14.1。以下夹具在仓库中，不依赖私人琴房图、模型凭据或旧电脑 `work/`：

```sh
npm ci
npx playwright install chromium
npx vitest run src/shared/asset-refinement/structure-plan.test.ts src/platform/browser/content/image-refinement.test.ts --maxWorkers=1
npm run build
npm run preview -- --port 5414 --strictPort
```

保持preview运行，在另一终端执行：

```sh
SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5414/sceneweave/ npx playwright test tests/asset-structure-redraw.spec.ts tests/asset-refinement.spec.ts tests/unified-asset-editor.spec.ts --workers=1
```

端口可调整，环境变量应与实际preview和当前Vite base对应；上述基线使用 `/sceneweave/`。未设置 `SCENEWEAVE_TEST_BASE_URL` 时Playwright通常启动开发服务，应明确区分开发服务与正常生产包证据。不要并行运行构建与这些验证来重现历史超时。

单测生成已知RGBA真值，页面回归用内置素材与独立几何夹具；它们证明编译、来源、采用/撤销、冷读和编辑链，**不证明真实钢琴画质**。后续分割/补底改动再运行相关pixels、selection、repair、layer-replay及受影响保存/页面测试，不因本交接文档重复全仓测试。

## 6. 不随Git到另一台电脑的数据

[.gitignore](../../.gitignore)排除了 `work/`、`/docs/evidence/`、`local-data/`、`.env*`（示例除外）、依赖、构建和测试产物。以下是**旧电脑仓库根目录下的历史相对路径**，仅用于查找与核对，另一台电脑不应把它们视为现成文件。

| 历史路径 | 用途与核对值 |
|---|---|
| `work/image-to-project/inputs/interior-reference.jpg` | 原房间参考；SHA-256 `bbed73cfd49a7360f43c26bc899f9cdb84d4fa983e683bed1e20442b478396ac` |
| `work/piano-limited-inpainting-20261111/inputs/piano-original-rgba.png` | 原钢琴204×150；SHA-256 `43aec9d33b6c303d39b3865ae49b1181d938fc69040c61475111f29cf4fea390` |
| `work/structural-redraw-20261111/piano-structure-plan.json` | 最终结构稿18797字节；SHA-256 `dfbae7ba556eaef5e8265b263430420598ddfc72226adb0c0bbcca8f70a82c52` |
| `work/structural-redraw-20261111/piano-structure.svg` | 最终SVG13320字节；SHA-256 `7ee43f29501931a0d77005c19f3eb57a870836048812bb36a70c83ddcb4b692b` |
| `work/structural-redraw-20261111/frontend/piano-redone.sceneweave` | 可编辑完整包619560字节；SHA-256 `d244fe8b88912b0c566513ae6537ad11f506913abb1c07b687e32a074704da4b` |
| `work/structural-redraw-20261111/frontend/piano-cold-read.sceneweave` | 独立冷读包619557字节；SHA-256 `8b33853fc419dd531fb99ec1d0c992ae808da3ea1a54937ad9abad4e6849cbcc` |

最终结构稿包含31个声明元素、64条展开路径、373条指令，10项依据观察、21项含推断。这些是识别稿件的辅助信息，不是画质分数。

其他本机资料：

- `work/structural-redraw-20261111/frontend/01-scene-vector-desktop.png`、`02-scene-vector-comparison.png`：页面与候选对照。
- 同目录 `08-room-original.png`、`09-room-redrawn.png`：最终同尺度真实房间对照。
- `work/structural-redraw-20261111/` 下的日志、facts、源码快照和产物清单：历史冻结的原始证据。
- `work/image-quality-followup-20261111/`、`work/image-quality-remediation-20261111/`：早期缺陷诊断、失败试验及说明；重点是后者的 `README` 和 `repair/README`。

跨机携带分三种情况处理：

1. **只做通用算法/单测**：无需这些图片，使用仓库内生成真值与独立夹具即可。先把下限做扎实，真实样例质量标为未复验。
2. **复现最终钢琴和普通页面续编**：从旧电脑私下携带 `piano-redone.sceneweave`，经普通“打开工程文件”完整校验导入；包内保全资源与来源后，可使用“已保存结构稿来源”继续。另带最终JSON和SVG便于审阅、diff及直接载入稿件。用表中SHA-256核对，不手改hash来适配别的源。
3. **继续原图分割、背景混色与木纹诊断**：还需要原房间参考图及相应拆解配方/原始选区和补底输入，仅有透明钢琴裁片不足以恢复周围背景信息。来源上下文或配方缺失时先明确缺失，不捏造旧框坐标和采样记录；无法回取则用新的获准输入重新建立基线。

本次只把文字交接放入受Git管理的文档，未将原图、派生美术或完整包强制加入Git。旧样例用于本机开发不等于取得公开再分发许可；需要精确复现时按原许可私下转移。配置按新电脑环境重新设置，凭据不要写进此文档、工程或日志。

## 7. 下一步代码还能做什么（已讨论，未实现）

### 7.1 优先：引导分割与前景/背景混色分离

当前提取主要复制扁平RGB并乘选区覆盖率，画笔覆盖率并不是真实前景alpha。应先区分：误选进来的真实蓝色地毯像素，以及前景与地毯已混合的边缘像素；单纯去蓝或缩alpha会误删合法颜色与细节。

利用原图邻域、可信前景/背景笔画、分材质局部模型，评估有预算限制的图割/能量求解来形成选区候选，再在约束和正则下估计 `C ≈ αF + (1−α)B`。内侧可信前景和外侧可信背景分别约束F、B；低alpha、前后景近色、阴影和JPEG处可标记不确定或拒绝强修。不能仅凭此欠定公式声称恢复真实颜色。

保护黑色琴沿、合法蓝绿饰边、1px细线、孔洞和分离部件；不以统一色相删除、蒙版腐蚀或放宽旧阈值替代新算法。透明裁片缺乏背景上下文时，应降低能力承诺。

### 7.2 其次：可信取样与显式木板结构

`repair.ts` 当前按材质使用单一镜像donor、全局整数相位及颜色校正，缺少木板缝端点、方向、宽度的对应，可能复制donor里的结疤和暗带。来源报告目前能披露声明矩形交集，真实采样/边界仍为 `notMeasured`，不要把它当作已完成逐像素来源证明。

先记录实际采样及边界来源；优先观察区，排除前序推断、其他材质、已知物体与声明阴影。再由可见板缝端点/方向建立有限结构约束，保留手绘不规则，评估多patch重叠和接缝优化，减少醒目暗标记重复。可分离低频亮度/底色与高频笔触，但保护真实板缝和阴影；遮挡下的新内容始终属于推断。

旧忽略目录已经试过独立12px无重叠小块、逐行/列颜色续接、更换donor和扩大清理范围，未解决真实问题。先读旧失败说明（如已携带），不要盲目重试；未携带时仍应把这些失败作为本轮已知限制。

### 7.3 再做：通用轮廓、线条与重复结构拟合

在可靠分割基础上去局部锯齿和抖动，同时锁住拐角、拓扑、细线及孔洞。可按实测支持拟合曲线/直线、平行线、透视与重复形元，并自动形成结构稿。现有编译器可以承接输出，但图像到计划的估计器尚不存在。

代码适合把明确的约束变成稳定几何，视觉模型适合判断“这是什么部件、哪些相连、哪里有遮挡”并提供有限语义锚点。看不清的准确键数不能由重复拟合证明恢复；模型提出的内容也要标记推断，并经过同一编译和验收检查。不要把所有手绘线强制拉直。

### 7.4 低优先级：有限去模糊

只有可估计模糊/噪声且有可测信号时，才评估受限降噪或反卷积，控制振铃和细节丢失。更强插值不能恢复已经丢失的结构，先解决选区、混色和结构问题。

### 7.5 如何证明代码下限提升

先建立与调参分离的真值和保留组合，再改算法：

- 已知F/B/alpha合成：多背景色、真实彩边、黑白边、细线、孔洞、分离部件、阴影、模糊及JPEG；评价误删、颜色/alpha误差和拓扑保护。
- 完整真实木纹裁片上制造遮挡孔，保留遮挡前真值；覆盖斜向、不等板宽、多材质、阴影和不同孔形。评价板缝端点连续、重复暗标记、笔触对比和频率，避免仅用边界色差抹平纹理。
- 局部处理范围外像素应精确不变；改轮廓需明确允许范围，采用/撤销/冷读、来源许可及锁/基线仍要验证。
- 独立物件与画风留作保留样本，不能全部围绕同一钢琴调参。像素变化数、路径数、分辨率和与原图更近均不等于视觉收益。

顺序是代码先提供可解释、可验证的稳定修复，再让视觉模型补语义和有限缺失；模型输出之后同样运行几何、预算、来源和结果检查。

## 8. 给另一台电脑的新会话使用

可复制下面的接续说明，并附上实际已转移文件的位置：

> 接续Sceneweave图片拆解与代码修复。先读AGENTS.md、README.md、docs/README.md、docs/07-roadmap.md的image-to-project-plan，以及docs/reference/image-repair-handoff-20261111.md，核对当前Git状态，保留其他工作和todo.md。钢琴有限结构SVG最终稿已获用户认可，但原裁片蓝边、木纹接缝/暗带和通用自动图像到结构稿仍未解决。方向是先用代码提高下限，再用视觉模型辅助，保留独立SVG/模型补画双路线；SVG不依赖图片模型。最后讨论的引导分割、混色分离、木纹结构约束只是分析，尚未实现。先核对受Git管理的实现与夹具，以及旧电脑资料是否实际携带；忽略目录、IndexedDB和配置均不会随Git出现。需要继续开发时，先以已知F/B/alpha和保留组合建立基线，优先区分误选背景与真实混色，再改局部前景/背景修复；木纹线先补真实采样来源和板缝约束。不要继续靠提分辨率、泛去蓝、手工美化一张钢琴或伪造来源hash推进。只运行改动所需自检，任务回填07，正式验收归09，明确区分已实现/自检/用户认可/正式待验。精确钢琴复现材料缺失时先用仓库内夹具推进通用工作，不宣称复现了旧结果。付费图片请求和提交/推送/部署按新会话当前授权处理，unknown不自动重发。

本交接保留上下文和建议顺序；新会话应按用户当时的具体要求开始行动，不能把上面尚待执行的算法分析写成已经交付。
