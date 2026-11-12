# 贡献与运行说明

本页维护环境、配置、部署和验证命令；当前任务顺序以[路线图](docs/07-roadmap.md)为准，历史测试/发布结果从[历史索引](docs/archive/README.md)查询。只提交本次相关文件，保留无关修改和独立 `todo.md`。

## 开发环境与命令

建议使用`.nvmrc`指定的Node.js24.14.1，依赖由`package-lock.json`锁定。`package.json`允许Node.js>=22.12.0且<27；允许安装不等于已完成该版本的运行验证。

```sh
npm ci
npm run dev
```

开发服务默认绑定 127.0.0.1:5173。端口对应独立的浏览器存储来源；更换端口或清站点数据前下载主持人工程备份。

```sh
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

共享内核可单独运行`npm run check:shared`：AST依赖边界、无DOM/无Node类型编译、真实Node原生ESM命令/身份/投影及当前/历史ZIP往返，临时发射目录自动清理。保留的兼容模块API测试用于领域/存储依赖及既有来源记录，不能据此宣称产品支持旧版导入或转换；M2-0b至f当批命令与数字分别见[48](docs/archive/m2-project-validation.md#doc-48)至[52](docs/archive/m2-project-validation.md#doc-52)。

`npm run check:architecture`检查共享层只依赖共享层、应用层只依赖共享层和应用层；类型导入与动态导入遵守同一边界。应用端口由应用层定义，浏览器在组合根注入实现。正常`typecheck`和`build`会先运行此检查；它不替代共享层无DOM编译或行为验证。Pages CI在构建前另执行`npm run check:shared`，阻止平台全局或无DOM类型错误进入发布产物。

原生定向入口位于`src/application/workspace`、`src/editor/main`、`src/editor/native-canvas`、`src/platform/browser/render`及新主库的历史包/原件测试。真实浏览器可定向运行`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20f-ui.spec.ts tests/m20f-render.spec.ts tests/m20f-entry.spec.ts --reporter=line`，检查混合主会话/目录、实际GM/player 4K逐RGBA对照及完整v1所选历史包的独立导入；旧转换UI旅程不再执行。每次修改按实际范围验证，不将52的旧批次当作当前结果。

Vitest 运行 `src/**/*.test.ts` 中的领域、存储、工程文件及渲染测试；Playwright 使用 `tests/` 下保留的浏览器旅程，会按配置启动本地服务或复用已有同端口服务。旧整页UI用例已退休，当前工作区与M2旅程继续执行，旧领域/IO的API用例按依赖保留，完整范围及退休清单见[tests/README](tests/README.md)。默认安装并使用 Playwright Chromium。系统 Chrome 可用时也可运行：

```sh
SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e
```

测试使用独立profile/浏览器上下文；当前范围见[测试导航](tests/README.md)，实际结果归对应[历史台账](docs/archive/README.md)，验收要求归[质量计划](docs/09-quality-plan.md#acceptance)。退休UI脚本和旧批次数字不能作为当前通过证明。

生产构建在 dist/；可使用 `npm run preview` 在本地检查构建结果。[GitHub Pages 工作流](.github/workflows/deploy.yml)在推送 main 或手动触发时，读取 `.nvmrc` 安装 Node，执行 `npm ci` 和 `npm run build` 后部署静态站点至[在线预览](https://wojisama.github.io/sceneweave/)。该工作流只负责构建和部署，不代替上述单元/浏览器验证；成功结果以 GitHub Actions 运行记录为准。它不包含 AI 网关、工程云同步或正式发行版流程。

<a id="local-map-harness"></a>
## 本地地图harness（开发工具）

当前适配器提供一个新建林中建筑的语义接口，供本地agent或人手提交JSON；使用与页面相同的生成意图、固定素材和领域执行器。它不含模型，不需要provider密钥；先安装依赖及Playwright Chromium。能力表、参数schema、限制和唯一样例由共享代码输出：

```sh
npx playwright install chromium
node tools/harness/sceneweave.mjs capabilities
node tools/harness/sceneweave.mjs example > /absolute/existing-parent/request.json
node tools/harness/sceneweave.mjs generate --input /absolute/existing-parent/request.json --output /absolute/existing-parent/new-map --allow forest-building --budget standard
```

示例路径需替换，输入/输出均须绝对路径。输出目录必须尚不存在且父目录已存在；`--allow forest-building`明确授权此能力和内置固定素材，`--budget small|standard|expanded`由执行环境选择注册预算，两者均不接受模型JSON代填。也可用`npm run harness -- <子命令>`。参数包括20–100米宽高、1–4房间、共用用途、家具开关、0–2植被倍率和seed；未知字段或不支持环境明确拒绝。当前营地仅预留空地，不包含帐篷/篝火，不保证任意参数必有解；完整限制见[接口合同](docs/reference/ai-entry-strategy.md#semantic-entry-contract)。

工具启动临时回环服务和全新Chromium上下文，禁止站外请求和浏览器数据库打开，不复用用户profile、不打开应用工作台。真实图片/像素校验、生成、完整包导出和玩家PNG使用现有平台端口；输出`request.json`、`map.sceneweave`、`preview.png`及`result.json`。只有结果`status:"complete"`才表示落盘SHA复读、另一空白页面完整冷导入和2048长边预览RGBA一致均通过。失败目录保留诊断且不自动重试；重试须明确使用新目录，不能将该工具当作旧AI任务的恢复入口。

在正常页面首页选择“打开工程文件”，选取`map.sceneweave`，即可继续编辑和保存。文件交接仅是独立新工程；不授予替换已打开工程、直接写IndexedDB或合并历史的权限。CLI和SDK尚属仓库内开发工具，普通页面制图不要求clone源码；正式分发、真实模型收益、视觉/P3及[09比较](docs/09-quality-plan.md#ai-entry-acceptance)均另验。定向入口为`npx vitest run src/application/workspace/semantic-generation.test.ts`和`node --test tools/harness/io.test.mjs`。

页面参数助手位于“生成 → 混合场景 → 林中建筑 → 用自然语言填写参数 · 实验”。先在“AI”模块连接现有任务服务，返回后输入需求，检查参数、默认值、歧义及未支持项，再点击“填入生成参数”；这一步只更新表单，仍须手动点击“预览混合场景”并按原流程保存新工程。解析失败保留原文和表单，可直接手填继续。用量显示来自实际任务，不承诺固定单次模型请求。

<a id="image-import-mcp"></a>
## 图片拆解页面与模型 tools

正常页面首页、工作区文件菜单或“场景”面板选择“从图片新建场景”。上传原图后，标注房间和两点标尺，按上层优先顺序拆出物件，分别指定下层纹理取样。审阅合成、补底和逐层显隐，填写实际来源/许可并确认嵌入后，预览、保存并打开独立工程。保存成功后物件自动进入“素材与布景 → 我的素材”，可再次放置或编辑为独立素材副本。当前补底使用用户取样平铺，复杂边缘与高差继续按[支持范围](docs/reference/image-to-project.md#shared-tool)校正。

项目自带MCP工具可由支持stdio的模型宿主启动。先安装依赖和Playwright Chromium，指定一张获准处理的图片、许可全文、署名及已经存在的输出目录。

```sh
node tools/image-import/server.mjs --image /absolute/map.jpg --license-file /absolute/license.txt --attribution "实际作者与来源" --output /absolute/existing-output
```

服务实现initialize、ping、tools/list和tools/call，工具定义含严格JSON Schema。先inspect读取原图身份与generation，再set_scale、set_room、extract_item或apply_recipe，每次修改使用返回的新generation。suggest_region提供颜色连通区域建议，preview返回PNG，undo推进代次，build_project输出独立候选。只有候选目录result.json为complete，才表示落盘复读、独立页面完整冷读及2048预览像素一致通过。工具参数只能访问启动时的原图，源文件和许可路径由宿主配置。

`image_import_refine_selection` 接收 `{generation,target,strokes,contour?}`：target为已拆图层ID，strokes中的每笔为 `{mode:'keep'|'remove',points,radiusPx}`，可选contour为 `{points,radiusPx?}`。工具使用同一磁性贴边与连续画笔，重放受影响层成功后一次提交，失败/取消/旧代次保持草稿。精细覆盖保存为可选selectionMask，配方及MCP请求最多8MiB；像素及复杂度预算另按schema检查。模型可提交候选并在页面继续修正，本接口不自动外发图片，也不代表已验证视觉模型识别质量。

候选recipe.json可在页面原图上传后载入“模型拆解提案 JSON”，与手工操作走同一执行层。页面功能可在关闭模型时完成。MCP服务和页面均调用项目模块，运行期所需的是项目依赖与浏览器。定向检查为 `npx vitest run src/shared/image-import src/platform/browser/content/image-import*.test.ts` 及 `npx playwright test tests/image-import-tool.spec.ts`。

无需模型宿主时，可直接让程序重放同一严格配方，仍通过上述项目MCP执行层交付和完整冷读。

```sh
node tools/image-import/replay.mjs --image /absolute/map.jpg --recipe /absolute/recipe.json --license-file /absolute/license.txt --attribution "实际作者与来源" --output /absolute/existing-output
```

原图保真模式禁止当前 `trace` / `wood` / `rug` 改写可见外观；MCP `image_import_set_vector` 仅接受 `options:null` 清理旧设置，旧提案不能直接采用。`set_source_boundary` 保存包含原墙线的外框；`set_output_scale` 指定1/2/4倍原色采样，物理尺寸不变且不声称恢复缺失细节。`assess_fidelity` 现场计算同坐标原图报告，`preview` 支持difference/inference；`build_project` 的sourceFidelity与落盘/冷读verification分开。地板材质与物件自动入库，源墙沿只关联房间外观。既有SVG素材编辑仍可制作新固定副本，不作为保真转换通过的证据。详见[失败规则与保真边界](docs/reference/image-to-project.md#fidelity-failure-rules)。

<a id="image-room-sample-tool"></a>
## 图片分层样板工具

`node tools/image-import/build-room-sample.mjs --input /absolute/room-sample.json --output /absolute/existing-parent/new-output` 在隔离浏览器中构建蓝毯琴房完整v1。输入清单包含 `floor`、`piano`、`rug` 三项，各有本地PNG的 `path`（可相对清单目录）及原图像素范围 `boundsPx: {x,y,width,height}`，另需 `licenseText` 和 `attribution`；可选 `sceneId` 与 `now` 固定新工程身份及时间。工具使用现有PNG规范化和完整资源/像素校验。先安装Playwright Chromium，输出目录须为尚不存在的新目录。

成功输出 `map.sceneweave`、`preview.png` 和 `result.json`。只有结果为 `complete` 才表示落盘复读、独立页面完整冷导入和2048预览RGBA一致通过。工具仅写指定文件目录，输入原件保留；失败保留结果，修正后另选新目录运行。工程可从正常页面“打开工程文件”继续编辑，输入素材及实际样板均在被忽略的 `work/image-to-project/`。两点标定、样板的编辑粒度、比例及视觉差异见[设计](docs/reference/image-to-project.md#sample-tool)，开发状态见[07](docs/07-roadmap.md#image-to-project-plan)。

<a id="image-item-workflow-tools"></a>
### 可接续的图片 item 制作

共同操作协议见[图片 item 工作流](docs/reference/image-item-workflow.md)，仓库助手入口为 `.agents/skills/sceneweave-image-items/SKILL.md`。普通场景工程、个人素材库和 `.sceneweave-image-work` 制作工作包分别保存；后者保全原图、辅助笔迹、未完成选区、问题与下一步，不是新的场景工程版本。页面“从图片新建场景”可自动保存、继续上次拆分及打开／导出制作工作包。

项目 stdio MCP 可向实际具备工具与视觉能力的模型提供相同工作流、参数与检查点。下面路径须替换为已有绝对文件／输出目录：

```sh
node tools/image-import/server.mjs --image ABS_IMAGE --license-file ABS_LICENSE --attribution TEXT --output EXISTING_OUTPUT_DIRECTORY
node tools/image-import/server.mjs --resume ABS_WORK_PACKAGE --output EXISTING_OUTPUT_DIRECTORY
```

可选离线CPU语义分割由宿主另外显式启用，不替换页面默认算法。准备Python 3.12及独立依赖目录，例如手动运行 `python -m pip install --target ABS_DEPENDENCY_DIR numpy==2.3.2 onnxruntime==1.23.2 Pillow==11.3.0`。依赖安装与公开权重下载只在准备时进行；实际推理不联网、不自动安装或重试。模型使用Apache-2.0的[ONNX仓库](https://huggingface.co/Xenova/slimsam-77-uniform/tree/5850ab45f587c112167512ffef949107115e26a0/onnx)，固定revision `5850ab45f587c112167512ffef949107115e26a0`，仅下载下表两文件到本机模型目录；保留模型许可与来源，权重不提交Git。

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `vision_encoder.onnx` | 23276014 | `9f8433273a6750b587779baa0cf5508111001bf7e7acfcf585d370139fd366d0` |
| `prompt_encoder_mask_decoder.onnx` | 16557892 | `f4514391764fbd56e08e119060d874ecd7d52994bfb1968af159e12d4943b5bb` |

```sh
node tools/image-import/server.mjs --resume ABS_WORK_PACKAGE --output EXISTING_OUTPUT_DIRECTORY --local-model-dir ABS_MODEL_DIR --python ABS_PYTHON --python-path ABS_DEPENDENCY_DIR
node --test tools/image-import/local-segmentation.test.mjs
```

只有启用时，`tools/list` 才提供 `image_import_local_segment`。它返回3份候选及预览，不自动采用；返回的 `selectionMask` 和 `selectionOrigin` 可经共同工具采用并存入独立工作包，页面继续精修无需再次推理。每次请求单独进程，默认30秒，最多4线程，原图坐标、目标25万像素、输入64KiB与输出8MiB预算；错误、取消或超时不修改草稿。模型文件共约39.8MB，但开发机单Python进程实测峰值工作集约1.9GiB／提交约2.9GiB，不能据权重大小称低内存或浏览器可用。耗时仅本机开发诊断，正式性能另行冻结；换权重须重新评估，不接受同名替换。当前工具无浏览器直连Python或普通应用聊天入口。

先发现工具，再调用 `image_import_workflow` 读取当前代次和下一步；成功修改后宿主写新检查点，返回 `checkpointError` 时先导出保全再退出。普通应用聊天尚未接入图片工具，配置模型不会自动启用。原图不自动发送到外部服务。开发自检按影响范围运行，真实裁片和补底须分别看图：

工作流返回项目默认制作总则和图片专用指引；应用内新建普通聊天及有限草稿任务自动加载同源规范，不追加图片执行权限。切后可调用 `image_import_enhancement_candidates({target,direction,count,scale?})`，其中 `count` 为2/3，`scale` 为1/2；`contour` 用于有实心支撑的部分二值斜角，`edge` 只调已有半透明带。输出独立 `enhancement-代次-随机身份/`，包含确切 `source.png`、各候选与换底PNG、绑定父源/配方/摘要的 `candidates.json`，均写后复读。工具只读，不修改蒙版、复核或制作包；采用需在统一素材页基于确切父源和同配方审阅。候选目录不在严格三条目工作包内，需要接续比较时单独携带。零变化不算提升，插值放大不称恢复细节。

```sh
npx vitest run src/shared/image-import src/platform/browser/content/image-item-workflow-session.test.ts src/platform/browser/content/image-workflow-store.test.ts
npx playwright test tests/image-item-workflow.spec.ts tests/image-import-selection.spec.ts tests/image-import-draft-protection.spec.ts tests/image-import-quality.spec.ts
```

系统 Chrome 可用时设置 `SCENEWEAVE_BROWSER_CHANNEL=chrome`；使用现有独立页面时设置 `SCENEWEAVE_TEST_BASE_URL`。多个 Vite 运行实例使用各自缓存目录，避免依赖预构建互相失效。工具检查和冷读通过不能替代09的视觉、独立试做及用户P3。

<a id="legacy-svg-recovery"></a>
## 旧 SVG 的独立恢复工具

`tools/migration/migrate-legacy-svg.mjs`仅处理已导出的当前完整v1归档中仍含processor1的SVG，不提供旧IndexedDB发现、普通导入旁路或原地修复。先安装依赖及所选Playwright引擎，在仓库根目录显式指定输入文件、归档类型和**尚不存在**的绝对输出目录；输出目录的父目录必须已经存在，不能先用`mktemp -d`创建目标目录。以下绝对路径为待替换示例：

```sh
npx playwright install chromium
node tools/migration/migrate-legacy-svg.mjs --input "/absolute/source.sceneweave" --output "/absolute/existing-parent/new-svg-copy" --mode complete
```

所选历史包改用`--mode history`；默认使用Playwright Chromium，可显式选`--browser chromium|firefox|webkit`，Chromium另可加`--channel chrome`。须安装对应引擎并选择与旧制品实际来源匹配的环境；选项不保证复现任意旧浏览器版本。工具先完整校验原始源、规范化源、原PNG及确切许可，原生SVG实际RGBA必须与旧PNG一致，任何不匹配都拒绝，不能猜测生产环境后静默重画。参数说明可用`node tools/migration/migrate-legacy-svg.mjs --help`查看。

严格拒绝无processor1源的当前工程、区域地图、带`aggregateCoordinates`的工程，以及`generation`或`generation.legacy`下除版本标识外的非空记录；缺少可重建固定目录身份的符号外观源、兼作派生输出的SVG源也拒绝。归档仍受普通严格字段、资源/许可、CRC/SHA及预算校验，输入须为非空普通文件且不超过100MiB；不丢弃不支持的收据、历史或字段来制造成功。

源文件只以只读方式捕获，工具启动临时本机服务和隔离浏览器，禁止IndexedDB/localStorage/sessionStorage及站外网络，不打开用户profile或应用工作台。新目标仅复制当前场景，分配新sceneId、lineage及固定身份、revision0，以processor2生成新PNG和派生并仅用其能力完成冷导入校验；所选旧快照及原固定身份完整留在原始归档，不伪造新历史连续性。

独立输出包含原字节`original.sceneweave`、新候选`converted.sceneweave`和`mapping.json`；记录源/目标hash、身份映射、实际引擎和保全快照ID。只有`mapping.json`的`status:"complete"`确认原件与候选落盘重读hash、源文件未变和候选冷读均完成；失败目录保留供诊断，重试须另选新目标。工具不安装、保存或发布到用户工程库，不清源库；成功候选由用户另行显式导入，不代表视觉/P3、VTT或性能验收。

恢复候选与五类冻结普通艺术工程可通过[SVG确定性与冷读专项](tests/README.md#svg-determinism)在正常生产dist执行6输入×三引擎回归。须显式传入冻结目录、恢复包文件、生产baseURL和输出目录；配置单worker、每例300秒且零重试，不启动开发服务器。该专项只核对真实UI导入、完整领域/来源/资源/许可及冷读保全，恢复包另留双受众4K PNG；不能替代完整视觉组合、人工美术/P3或正式性能验收。

## M2-1本地任务服务

使用`.nvmrc`指定的Node版本。Node/Hono服务提供流式对话和隔离草稿，协议、工具、预算与保留期归[AI合同](docs/05-ai-and-generation.md)。`node:sqlite`在该Node版本仍有experimental提示。服务单实例独占一个数据目录，主工程与个人素材仍在浏览器。

首次配置且`.env.ai`不存在时，将`.env.example`复制为`.env.ai`并设为0600，在文件里填写`SCENEWEAVE_AI_PROVIDER_BASE_URL`、`PROVIDER_API_KEY`、`PROVIDER_MODEL`及独立随机`SCENEWEAVE_AI_ACCESS_TOKEN`（所有变量均带`SCENEWEAVE_AI_`前缀）。可选`SCENEWEAVE_AI_PROVIDER_VISION_MODEL`固定视觉模型，未填时沿用文字模型；完整请求历史含图片时选择视觉模型，带图历史的后续答仍走该模型。连接信息会显示实际配置，前端不能修改provider模型。后端默认127.0.0.1:8787、数据根local-data/ai；允许Origin必须精确到协议/主机/端口，不含Pages路径。保留现有配置，不盲目覆盖；真实配置被Git忽略，provider key不能使用VITE_前缀。

Windows服务私有数据使用实际NTFS DACL：依赖系统PowerShell/.NET，仅当前服务账户及SYSTEM完全控制配置数据根，已有内容先核验／加固，新文件及SQLite日志继承权限；无法建立证明时明确拒绝。不要把`.env.ai`的POSIX0600显示值当作Windows权限检查，凭据文件也应由维护者设置仅服务账户可读。源素材及许可的确切字节由`.gitattributes`保留LF；不得为检出换行差异改素材清单hash。

```sh
npm run ai:build
npm run ai:start
```

另一个终端运行`npm run dev`。在统一工作区“AI对话”填写后端地址和`.env.ai`中的应用访问凭据，点击连接；页面不填写provider key。应用凭据仅本次页面内存，刷新后重新输入；模型/地址由服务器固定。生产前端通过`VITE_SCENEWEAVE_AI_URL`设置公开后端origin；已记录的[公网HTTPS后端](https://124.223.95.142)及[Pages前端](https://wojisama.github.io/sceneweave/)部署结果见[AI历史台账](docs/archive/ai-validation.md)，使用前按本页部署步骤核对实际版本与健康状态。使用127.0.0.1与localhost时需分别配置准确Origin。

```sh
npm run ai:test
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m21-ai-conversation.spec.ts tests/m22-ai-authoring.spec.ts --reporter=line
```

草稿操作前先在产品内明确授权对象、允许操作、固定素材与支撑范围，并同意两层元数据发送范围。任务不会直接改主工程；等待本机实际资源校验、审阅差异后，才保护当前并一次采用。重新绑定/查询只读取任务，明确继续才再次调用模型。授权/采用合同见[AI合同](docs/05-ai-and-generation.md#12-m2-2-技能与独立物件草稿2026-10-24实施合同)，真实结果另见[AI历史台账](docs/archive/ai-validation.md)。

ai:test覆盖共享草稿/后端/provider/客户端；本机原子采用另运行`npx vitest run src/application/workspace/atomic.test.ts src/application/workspace/workspace.test.ts src/platform/browser/storage/repository.test.ts --maxWorkers=1`。Chrome使用真实HTTP/SSE/SQLite和受控模型替身，普通测试不调用真实模型。`npm run build`和typecheck也检查服务类型；ai:build另输出被忽略的dist-ai。确需验证真实渠道时，在编译后明确运行`node --env-file=.env.ai tools/testing/ai-provider-probe.mjs`；默认三次请求测文字和工具续答，`--interrupt-and-error`另测首段后中止及坏凭据，可能产生模型费用且无自动重试。探针不输出密钥/正文；用`--out`保存到新系统临时路径，不归档大报告。

<a id="受控ai-runner与t8定向复现"></a>
### 受控AI runner与地形样片复现

新runner先运行`npm run ai:build`，再从`tools/testing/create-ai-task-runner.mjs`导入`createControlledTaskRunner(config,{cooldownMs:10000,lastCompletedAt})`；`config`和`lastCompletedAt`可省略。构造只连接私有store、provider和engine，不创建/恢复任务或发送请求；完成后调用`close()`。同一实例串行执行响应后冷却；若另起实例继续受控运行，由调用方传入确切的最近完成时间，不能假定跨进程自动共享。观察型fetch可以记录传输统计，不能再次sleep/retry。调度/计数/硬门见[05](docs/05-ai-and-generation.md#1915-按剩余时间收尾与锚点参数诊断)。已收费旧runner/unknown保持原证据，不自动恢复。

T8容量和样片脚本不调用模型，启动独立Vite端口5186并阻断外部HTTP；输出仅写被忽略的work目录。使用新输出目录保留旧失败，命令串行执行：

```sh
SCENEWEAVE_EVIDENCE_DIR=work/t8-capacity-review node tools/testing/terrain-t8-review.mjs capacity
SCENEWEAVE_EVIDENCE_DIR=work/t8-sample-review node tools/testing/terrain-t8-review.mjs samples
npm test -- --maxWorkers=1 --testTimeout=30000 src/shared/terrain-generation/t8-fixtures.test.ts src/shared/terrain-generation/contracts.test.ts src/platform/browser/terrain-generation/client.test.ts src/application/workspace/terrain.test.ts
npx playwright test tests/terrain-generation.spec.ts --grep T8 --project=chromium
```

容量脚本每输入仅一次开发观察，同页缓存复用；CDP只采主页面JS heap，不包含Worker/GPU/进程，也不是正式峰值或p95。样片使用当批完整v3明确坐标参考，保存/包往返和实际双受众PNG检查不代表组合算法或完整v4的验收。原结果及限制见[地形台账](docs/archive/terrain-validation.md#t8-20261028)。

<a id="m3前视觉ai开发与可选截图"></a>
<a id="program-base-map"></a>
### 无模型程序底图

工程面板的“程序底图生成方式”默认本机Worker，可离线使用。选择服务端时填写已配置自有服务的origin与应用访问凭据，再从原自然地形/地貌组合入口生成；当前页面不持久保存凭据。新接口为`POST /v1/terrain/basemap`，沿用上面的鉴权、精确Origin与存储可用性守卫，直接调用共享确定性核心，不创建AI任务或调用provider。当前服务配置仍要求原有provider配置；本接口不等于支持无provider配置启动。

独立空白元数据请求最多4MiB、完整JSON响应最多8MiB，实际字节/UTF-8/长度均检查；并发为`min(maxConcurrent,2)`，读取正文前占名额，正文总等待30秒，失败/取消均释放。同步领域计算受内部几何/256预算约束，不能宣称中途可被事件循环即时抢占。旧任务接口的32KiB及authoring/vision独立预算不变。客户端不自动重发或切换计算位置；旧后端404须更新代码并重新构建/发布后端，本地实现通过不代表线上已经更新。

协议与领域结果指纹见[04](docs/04-scene-document.md#program-base-map-protocol)，真实资源物化和最终采用仍在本机。当前新生成@3可在确切物化后选择“继续用AI修改底图”，注册profile与策略2在开始前固定；新前后端再明确协商创作4，旧2/3任务各自保留重放。服务先匹配版本及policy/profileHash，旧@1保持原256会话回执且不能补造接续来源。G/A分账、完整来源/账本、执行消耗和当前拒绝边界归[05](docs/05-ai-and-generation.md#budget-continuation-contract)，线上旧后端须更新后才能使用新能力，本轮本地实现不代表已部署。

必要定向检查串行运行：

```sh
npx vitest run src/shared/ai/continuation.test.ts src/shared/terrain-generation/base-map.test.ts src/platform/browser/terrain-generation/base-map-client.test.ts src/application/workspace/base-map.test.ts src/application/workspace/base-map-clock.test.ts --maxWorkers=1 --testTimeout=30000
npx vitest run --config vitest.ai.config.ts services/ai/continuation.test.ts services/ai/execution-checkpoint.test.ts services/ai/base-map.test.ts services/ai/app.test.ts services/ai/authoring-tool-catalog.test.ts --maxWorkers=1 --testTimeout=30000
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/base-map.spec.ts tests/base-map-continuation.spec.ts --reporter=line
```

浏览器用例启动隔离Hono/SQLite/SSE服务并使用确定性provider，不读`.env.ai`或发送付费请求；底图生成本身模型/新增任务数为0，接续用例检查真实Worker、资源像素、保护CAS、一次采用/撤销、冷读和完整包/双受众PNG。真实模型质量与正式验收另行冻结执行。

<a id="image-edit-service"></a>
#### 素材补画专用服务

在服务端私有环境显式设置 `SCENEWEAVE_AI_IMAGE_EDIT_BASE_URL`、`SCENEWEAVE_AI_IMAGE_EDIT_API_KEY`、`SCENEWEAVE_AI_IMAGE_EDIT_MODEL`；base URL应为供应商API根（例如以 `/v1` 结尾），程序追加 `/images/edits`。三项须同时配置，全部省略则能力返回不可用；不自动复用对话配置。不得使用 `VITE_` 前缀或向静态产物/工程写供应商密钥。

浏览器使用应用服务Origin与应用访问凭据，先GET `/v1/image-edit/capabilities`，明确同意后POST `/v1/image-edit`。该独立接口沿用应用鉴权和精确Origin检查，单次multipart编辑、单候选、透明内联PNG、明确尺寸，拒绝URL输出；并发最多2，超时180秒。请求要求供应商支持16对齐、655360至800万像素、长边3840/短边2160内且比例1:3–3:1的显式尺寸与透明PNG；能力标 `configured-unverified`，必须对实际固定渠道另测，配置不等于模型可用或图像质量证明。[官方参数依据](https://developers.openai.com/api/reference/resources/images/methods/edit)。

服务在私有 `DATA_DIR/image-edit-requests/` 保存hash与unknown/finished收据，每次付费请求前落盘；同owner+clientRequestId跨重启拒绝重发，最多1万收据后明确拒绝新请求，维护者应在独立核对计费后处理容量，不能自动删除未知记录。取消或断网后先按页面保留的客户端ID核对，不自动重发。测试用fake fetch，不读取私有配置或发付费请求：`npx vitest run --config vitest.ai.config.ts services/ai/image-edit.test.ts services/ai/config.test.ts services/ai/request-boundaries.test.ts --maxWorkers=1`，浏览器transport和完整源闭包用 `src/platform/browser/content/image-refinement-model.test.ts` / `image-refinement.test.ts`，生产旅程用 `tests/asset-refinement.spec.ts`。

### 当前完整3–6的创作4检查

[创作4](docs/05-ai-and-generation.md#current-authoring-contract)先显式协商 `current-authoring@1`、完整版本及预算身份，再使用固定资源、阶段原子操作、预算收尾和实际公开PNG复核；旧1–3不会取得新操作。当前工程source4与真实生成source3的保护/采用路径分别验证。下面都是本地确定性provider，未读取私有环境文件、未调用真实付费模型：

```sh
npx vitest run src/shared/ai/current-authoring.test.ts src/application/workspace/current-authoring.test.ts src/platform/browser/ai/client.test.ts src/platform/browser/ai/public-vision.test.ts src/editor/main/ai-draft-reviewability.test.ts --maxWorkers=1 --testTimeout=30000
npx vitest run --config vitest.ai.config.ts services/ai/current-authoring-v4.test.ts services/ai/app.test.ts services/ai/execution-checkpoint.test.ts services/ai/visual-review.test.ts services/ai/authoring-tool-catalog.test.ts --maxWorkers=1 --testTimeout=30000
npx playwright test tests/ai-current-closeout.spec.ts tests/base-map-continuation.spec.ts --workers=1 --reporter=line
```

`ai-current-closeout`的工程升级、草稿/截图授权、暂停/继续、修正、完整包、保护采用、撤销/重做与冷读均通过可见UI操作，不依赖开发模块或数据库注入。可对正常 `npm run build` 产物启用本地preview，再将 `SCENEWEAVE_TEST_BASE_URL` 指向带 `/sceneweave/` 前缀的站点单独运行该用例。其他底图接续用例仍包含开发态的独立资源核对入口，不能据它们声称正常生产UI已运行；每次结果按实际命令与构建分别记录。

## 视觉AI开发与可选截图

本地开发版增加严格v2视觉工程、连续曲线/边沿、材质铺贴、局部光雾、有限滤镜与AI制作清单。既有完整v1在工作区先明确保存独立v2副本，再冻结Floor/图层/矩形/对象/素材/允许操作；AI不暗中升级。制作计划与结构诊断不代表模型已看到画面或完成审美验收。视觉/截图/工具合同归[AI合同](docs/05-ai-and-generation.md#18-视觉制作回读与provider适配)，产品视觉范围归[视觉与素材规范](docs/14-visual-and-assets.md)。真实模型失败、修正和保护采用结果见[AI历史台账](docs/archive/ai-validation.md)与[视觉历史台账](docs/archive/visual-quality-validation.md)，不从旧发布记录推定当前部署。

可选制作证据检查支持明确活动区净空、分离物件组数量、双高程足宽台阶/坡道、房间用途与真实家具/材质、已启用边沿种类。检查矩形和固定素材必须位于冻结授权内，独立分组矩形不得重叠；仅以授权公开子集及本任务创建内容判定，不把房名或claimed当成完成。实际旋转图像的占幅/重叠另行诊断，不能只用较小碰撞占地安排树冠。大量采样点的地形读回超过8KiB回执预算时，明确返回`geometryOmitted`，随后以`sceneweave_read_scene`的`anchors`和单个地形ID、offset/limit分页取得真实point/segment；连续边沿直接引用真实boundaryId，不能沿用重采样前的旧segmentId。

`sceneweave_probe_placement`是无写入的有限诊断：固定definition/support、候选毫米坐标、旋转、最小净距与是否避让完整图像，返回实际地面支撑、整块占地是否受支撑、授权障碍、实测净距及最多5个确定性建议。支撑包围盒各轴固定17等分，检查16×16内部点、最多256个样点，只读取冻结公开子集；没有建议不等于穷尽证明。候选必须再次通过原本完整几何、锁/依赖/预算及本机采用，不自动放置、不扩大范围。开发验收中的确定性局部修复与真实模型生成报告分开保留，尤其不能因本机恢复/采用成功把request_limit或计费unknown写成自动创作通过。

在现有服务器环境文件中可显式设置`SCENEWEAVE_AI_PROVIDER_VISION=unverified|disabled|enabled`，默认unverified。保持unverified时可使用全部文字工具/结构诊断，截图复选框禁用。只有确认该固定渠道/实际视觉模型支持Chat Completions内联PNG后，维护者才设置enabled并重启服务；不要因模型名称或一次HTTP成功自动启用。文字/视觉模型与渠道能力以服务器连接信息及[AI合同](docs/05-ai-and-generation.md)为准。各渠道成功、失败和未确认请求保留在[视觉历史台账](docs/archive/visual-quality-validation.md)，不能借另一渠道的实证启用。每消息一图/每任务四图及披露/范围绑定保持，未知请求不自动重发；渠道实测及部署版本分别见[视觉历史台账](docs/archive/visual-quality-validation.md)与[AI历史台账](docs/archive/ai-validation.md)。

创作任务可在私有服务器配置中设置`SCENEWEAVE_AI_AUTHORING_OUTPUT_TOKENS`，默认1024、允许整数1–8192；普通对话仍1024。连接信息展示创作预算，工具参数/完整回执8KiB、65536可见输出字节、16请求/64工具/300秒及256累计展开等原保护不变。高输出创作请求可能有较多推理流事件：普通≤1024预算保留1MiB/2048事件的SSE解码门，较高预算使用4MiB/16384事件；32KiB单行和64KiB单事件保持。配置值不保证完整创作或渠道费用；模型/共享实现/预算改变后重新冻结独立任务组，保留旧失败与unknown。

GLM-5.3/FLASH的强制思考及交错工具续答按[供应商说明](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode)处理。私有配置可显式设置`SCENEWEAVE_AI_PROVIDER_PRESERVE_REASONING=enabled|disabled`，默认disabled；是否启用由维护者按固定渠道的续答需求明确配置。启用时仅在服务端私有消息中保留每回复最多64KiB的不透明`reasoning_content`，供provider续答，计入原每任务16MiB、全库256MiB及七日生命周期；不解释或执行该字段，不进入文字回调、snapshot/SSE、工具回执或工程/导出。关闭后不再保存或发给provider；既有任务在下次请求时移除本任务历史中的该字段，不批量改写全部旧任务。不要在诊断中打印该字段，配置变更需重启并独立验收。

对已确认支持的渠道，可显式设置`SCENEWEAVE_AI_PROVIDER_REASONING_EFFORT=low|high|max`；不填时不发送thinking/effort，显式值发送`thinking:{type:'enabled'}`与`reasoning_effort`。[GLM-5.3官方文档](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3)说明默认max并建议enabled+low；当前GLM文字/Flash支持该选项。它不关闭思考、不代替私有续答、不改变任务预算，也不保证正文余量、固定延迟或费用。变更后重启并新冻结验证，不恢复旧unknown任务。

AI面板连接后可为新任务选择跟随服务/low/high/max，并提示选择模型支持的思考程度；该设置同时用于普通对话和场景草稿。服务默认在创建事务中冻结，已有任务/暂停续答/同请求重试不受页面后来选择影响；更改服务器默认只影响新任务。任务实际设置单独回显，未显式指定为模型默认，不表示关闭思考。后端需提供`capabilities.taskReasoningEffort:true`；页面和后端必须同时更新才能启用该选择，发布状态须独立核对。协议见[任务思考程度合同](docs/05-ai-and-generation.md#1916-页面选择与任务固定思考程度)，历史探针、检查和超时时间线见[视觉台账](docs/archive/visual-quality-validation.md#doc-54-1313-页面思考程度与超时时间线)。

组合候选向provider提供根`type:object`、分支属性并集、必填`kind`和`additionalProperties:false`，保持严格`oneOf`分支及运行时校验。模型失败、代码检查和已完成但未通过的严格v2性能矩阵见[历史台账](docs/archive/ai-validation.md#contributing-provider-results)及[性能参考](docs/reference/performance.md)；它们不代表当前冻结验收。

需要单独核对渠道时，以下命令**会执行一次真实付费请求**：随机4×3色块、384×288px、369600种等量颜色排列，不读取工程或用户图片，不用工具，默认请求128输出token，可显式用`--probe-max-output-tokens`设1–8192并记录实际值；使用已配置视觉模型或文字模型回退。成功只证明该颜色观察，不证明地图美术能力，不改环境文件或连接能力，输出配置也不是费用硬上限。默认超时60秒，可显式以`--probe-timeout-ms`在1000–90000ms内设置。未知结果须保留并核对任务，不为补日志自动重跑。

```sh
npm run ai:build
node --env-file=.env.ai dist-ai/services/ai/vision-probe.js --run-vision-probe
```

截图须在新任务或明确继续时分别勾选同意。浏览器重新生成真实玩家投影并裁剪授权矩形，长边先768px，字节超限时降到512/384px；每张最多512KiB，任务累计最多4张。后端还验证真实PNG/CRC/hash/有限解压、sceneId/revision和当前草稿stamp；请求体上限6MiB，普通文字与元数据预算保持。图片只在私有任务消息中按七日/任务删除规则保留，不进snapshot/SSE；后续模型请求会重复携带带图历史，不能把一次上传当作仅计一次图片费用。`deploy/Caddyfile`和IP覆盖文件没有额外请求体限制；若外层另有反向代理，须核对6MiB创建/继续请求可达及SSE禁缓冲，不能只提高前端上限。本地检查不能替代目标线上版本的图片流程复测。

不调用付费模型的定向入口：

```sh
npm run ai:test
npx vitest run src/shared/ai/visual-authoring.test.ts src/application/workspace/visual.test.ts --maxWorkers=1
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/visual-authoring.spec.ts tests/visual-ai-authoring.spec.ts tests/visual-renderer.spec.ts --workers=1 --reporter=line
npx playwright test --config=tests/visual-playwright.config.ts --workers=1
node tools/testing/visual-production-smoke.mjs
```

真实模型验收须另行明确发起，记录自然语言要求、冻结范围、请求/token、失败工具和最终本机候选/实际资源/保护采用；unknown不自动重发，也不按未知价格换算金额。普通测试使用受控provider，不调用上述真实探针或模型。

## M2-5线上 AI 服务与 Pages

仓库提供可复现的 Node 24 服务镜像和 Caddy HTTPS 反向代理。部署入口位于`Dockerfile`和`deploy/compose.yaml`：AI 容器以非 root `node` 用户运行，根文件系统只读，任务 SQLite/私有制品写入独立的`ai-data`卷；Caddy 固定为`2.11.7-alpine`，申请/续期证书并只把请求转发到内部 AI 服务，事件流保持即时刷新。`/healthz`不需要应用凭据，Docker 和 Compose 健康检查只返回 `{ "ok": true }`，不会暴露模型、Origin、令牌或存储信息。

先在服务器安装 Docker Engine/Compose，保留已有配置；下列`cp`仅适用于目标文件尚不存在的首次部署。公共配置与私有凭据分别准备：

```sh
cp deploy/compose.env.example .env.deploy
chmod 600 .env.deploy
# 编辑 .env.deploy，SCENEWEAVE_AI_DOMAIN 仅填域名或公网 IP，不带协议、端口或路径
cp deploy/ai.env.example .env.ai.production
chmod 600 .env.ai.production
# 用 openssl rand -hex 32 生成仅供应用登录使用的访问令牌
# 编辑 .env.ai.production，替换访问令牌、模型供应商地址/密钥/模型和 Pages Origin
```

有域名时，将 A/AAAA 记录指向服务器并放行公网 TCP 80/443；UDP 443 用于可选的 HTTP/3。确认端口可用后使用默认配置：

```sh
docker compose --env-file .env.deploy -f deploy/compose.yaml config --quiet
docker compose --env-file .env.deploy -f deploy/compose.yaml up -d --build
docker compose --env-file .env.deploy -f deploy/compose.yaml ps
curl --fail --silent --show-error https://ai.example.com/healthz
```

没有自有域名时，可直接使用受信任的 HTTPS IP 证书。将`.env.deploy`中的`SCENEWEAVE_AI_DOMAIN`设为服务器的固定公网 IP，再使用`deploy/compose.ip.yaml`覆盖配置；**Docker Compose 须为 2.24.4 或更高版本**，以支持`!override`完整替换端口列表。该配置只映射 TCP/UDP 443，不占用或重启已有的 80 端口服务。证书验证和 HTTPS 需要放行云安全组及主机防火墙的公网 TCP 443；UDP 443 不参与证书验证。

```sh
docker compose version
docker compose --env-file .env.deploy -f deploy/compose.yaml -f deploy/compose.ip.yaml config --quiet
docker compose --env-file .env.deploy -f deploy/compose.yaml -f deploy/compose.ip.yaml up -d --build
docker compose --env-file .env.deploy -f deploy/compose.yaml -f deploy/compose.ip.yaml ps
# 将下列文档示例 IP 替换为实际公网 IP；证书签发成功前此检查不会通过
curl --fail --silent --show-error https://203.0.113.10/healthz
```

IP 方案使用`deploy/Caddyfile.ip`：显式指定 Let's Encrypt ACME issuer 和`shortlived`证书配置，以 TLS-ALPN-01 在 443 完成验证；禁用 HTTP challenge 和自动 HTTP 跳转，保留现有 80 端口服务。全局`default_sni`指向该公网 IP，使浏览器不发送 SNI 时，Docker/NAT 后的服务也能选择正确的 IP 证书。IP 证书有效期为 **160 小时**，由持续运行的 Caddy 自动续期，必须保留`caddy-data`卷、公网 TCP 443 验证通路、服务器正确时钟，以及到 ACME 服务的出站 HTTPS；不能把默认的内部 CA 证书当作浏览器已信任的证书。此配置固定使用上述 Caddy 版本，不将旧版本的 ACME profile 支持等同于完整的 IP/TLS-ALPN 支持。

依据为 [Let's Encrypt 的 IP/短期证书正式开放公告](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability/)、[验证类型说明](https://letsencrypt.org/docs/challenge-types/)、[Caddy ACME issuer 配置](https://caddyserver.com/docs/caddyfile/directives/tls#acme)及[默认 SNI 配置](https://caddyserver.com/docs/caddyfile/options#default-sni)。这些资料说明方案可用，不代替目标服务器的实际证书签发与浏览器检查。

`deploy/ai.env.example`中的`SCENEWEAVE_AI_ALLOWED_ORIGINS`必须写 Pages 的精确Origin，例如`https://wojisama.github.io`，不带`/sceneweave/`路径；若另有自定义域名，按逗号加入完整Origin。应用访问令牌和模型供应商密钥只放在服务器的`.env.ai.production`，不能提交仓库，也不能以`VITE_`前缀或GitHub Pages变量发布。数据卷和 Caddy 证书卷应纳入服务器备份；只允许一个 AI 容器实例独占数据卷，更新时用`docker compose ... up -d --build`，服务重启后会按协议将未决任务置为暂停并保留可查询进度。IP 部署的更新、检查、重启和停止命令始终同时传入`-f deploy/compose.yaml -f deploy/compose.ip.yaml`；遗漏覆盖文件可能重新占用 80 端口或换回域名证书配置。不要用`down -v`删除任务及证书卷，恢复数据卷前先停止唯一 AI 实例。

Pages 工作流读取 GitHub 仓库 Actions 变量`VITE_SCENEWEAVE_AI_URL`作为公开后端Origin，并在构建前拒绝 HTTP、路径、查询、片段或凭据。**HTTPS Pages 无法调用公网 HTTP 后端**，浏览器会阻止这类混合内容；CORS 配置不能解除该限制。容器内的 HTTP 转发不影响浏览器对公网 HTTPS 的要求。证书签发并实际验证后，将仓库变量设为`https://ai.example.com`或`https://实际公网IP`，再手动运行或推送触发 Pages 工作流。只有设置该变量后，线上前端才会预填后端地址；凭据仍由使用者在页面内存中输入。工作流不读取服务器`.env.ai.production`，不会把应用令牌或 provider key 放进静态产物。检查命令中的示例域名/IP也应替换成实际部署地址。实际Pages地址和后端Origin配置须在交付时核对；旧工作流、地址与证书记录见[AI历史台账](docs/archive/ai-validation.md)。

历史部署、证书签发、失败和线上旅程见[AI历史台账](docs/archive/ai-validation.md)。证书有效期、健康状态和部署版本必须在实际交付时重新核对，不将历史200响应当作持续可用证明。

## 当前主路径回归

开发任务只按[路线图](docs/07-roadmap.md#development)维护，全部验收从[质量计划](docs/09-quality-plan.md#acceptance)执行。开发整改期间运行受影响的定向检查；完整回归在验收阶段或用户另行要求时执行。旧整页工作台及旧转换UI已退役，默认Playwright套件覆盖当前原生工作区、AI旅程及仍保留的底层API；范围见[测试导航](tests/README.md)。以下命令依次串行执行：

```sh
npm test -- --maxWorkers=1
npm run ai:test
npm run typecheck
npm run check:shared
npm run ai:build
npm run build
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test --workers=1 --reporter=line
```

同化与失败草稿恢复专项使用默认Playwright配置和确定性provider，经过真实HTTP/SSE、SQLite、IndexedDB与Canvas，不调用付费模型。单件→固定组合→两个新基线明确范围，以及请求上限后的有效草稿备份/重绑/审阅/保护采用分别由下列专项复现：

```sh
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m2-assimilation-acceptance.spec.ts tests/m2-failed-draft-recovery.spec.ts --workers=1 --reporter=line
```

三引擎联合验收使用专用串行配置，须先安装对应Playwright浏览器；该配置固定使用Playwright Chromium、Firefox和WebKit，`SCENEWEAVE_BROWSER_CHANNEL=chrome`不改变其中的Chromium项目。默认输出在被忽略的`test-results/m2-joint`，可用`SCENEWEAVE_JOINT_OUTPUT`指定独立输出目录：

```sh
npx playwright install chromium firefox webkit
npx playwright test --config=tests/m2-joint-playwright.config.ts --workers=1
```

默认配置与专用配置均可启动或复用`127.0.0.1:5173`开发服务；使用已启动的同版开发服务时可设置`SCENEWEAVE_TEST_BASE_URL`。这些专项包含开发模块入口，不能直接把生产`dist`地址当作等价入口。冻结源码后再运行，分别保留失败与复验结果；命令说明不代表已经执行，测试不得与正式性能测量并行。

首页图片刷新使用`node tools/build-home-showcase.mjs`，从真实完整样板原生渲染六图并记录源/PNG/像素hash。火山独立热裂版本使用`node tools/build-themed-art.mjs --lava-hot`及`node tools/build-volcano-variant.mjs`；旧固定源/图/manifest保留，已存在固定ID不同字节时拒绝覆盖。

开发模块入口与正常生产UI分别记录。Firefox/WebKit的适用范围、受控配额、真实磁盘满、原生缩放、秘密/输入矩阵和无引导SCN等不能由一个专项外推；实际历史结果见[AI台账](docs/archive/ai-validation.md)，当前检查要求归[质量计划](docs/09-quality-plan.md)。

## 原生样板加载诊断

原生样板加载的历史修复与前后结果见[性能参考](docs/reference/performance.md#doc-34-2026-10-24原生完整v1样板加载修复)。必要定向入口为`npx vitest run src/application/workspace src/platform/browser/content src/platform/browser/storage src/editor/main/*.test.ts src/platform/browser/render --maxWorkers=1`及`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/sample-loading.spec.ts tests/m20f-ui.spec.ts tests/m20f-entry.spec.ts tests/m20f-render.spec.ts --reporter=line`；此处只定义复现方法，不表示已执行完整回归。

诊断使用正常`npm run build`，先在一个终端执行`npm run preview -- --port 5174`，再在另一终端逐条运行下列命令；期间不并行测试、构建或其他浏览器负载。输出使用新的系统临时目录：

```sh
sample_load_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-sample-load.XXXXXX")
node tools/testing/sample-load-diagnostic.mjs --runs 2 --out "$sample_load_dir/local.json"
node tools/testing/sample-load-diagnostic.mjs --runs 1 --samples study --delay-ms 80 --out "$sample_load_dir/delay.json"
```

工具默认真实`http://127.0.0.1:5174/sceneweave/`页面，系统Chrome独立上下文，不启用应用调试API；每个上下文首次/回首页再次打开各一次。记录点击至确认、采用至保存/画布就绪代理、PNG读取调用、位图创建及长任务，等待本次后台活动稳定再计数。`--delay-ms`仅模拟每次PNG请求的延迟，路由会禁用HTTP缓存，不能当作GitHub Pages实测；低次数结果不产生正式p95/通过结论。该诊断不引入长期位图缓存，也不测量地形Worker或完整正式矩阵。

<a id="current-formal-acceptance"></a>
## 当前完整v1容量、性能与视觉验收命令

跨电脑的单项开发前后对照另见[可携带对照工具](tools/performance/README.md#当前完整v1单项开发对照)：重新准备当前许可输入、隔离反转单项patch、正常构建与AB／BA真实UI；Windows诊断RSS明确缺测，不替代下述正式验收。当前冷开首笔额外完整哈希的定向入口为`src/platform/browser/storage/content-encoding-reuse.test.ts`。

先完成[当前主路径回归](#当前主路径回归)及受影响的正确性检查，再冻结源码、固定素材、工具和正常`dist`。正式采样独占串行执行：夹具准备、smoke、性能矩阵、视觉三引擎分别结束并关闭浏览器后才进入下一项；期间不并行测试、构建、模型任务或其他自动浏览器。共享目录仍有源码/工具编辑时先使用独立完整副本，不能在采样中更新输入。以下命令均从仓库根目录执行，使用`.nvmrc`的Node、系统Chrome及新的空绝对输出目录；当前性能进程树RSS仅支持macOS。命令定义不表示已执行或通过，正式结论从[09](docs/09-quality-plan.md#aggregate-capacity-acceptance)及[性能记录](docs/reference/performance.md)追溯。

先串行检查夹具合同、构建正常生产包，再由隔离工具浏览器准备并冻结真实完整工程：

```sh
npx vitest run --config tools/testing/formal-capacity.vitest.config.ts
npm run build
formal_prepared_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-current-fixtures.XXXXXX")
node tools/performance/prepare-current-formal.mjs --output "$formal_prepared_dir" --mode all
```

准备器的`--mode all`生成建筑/自然/混合各500/2000完整Prop及远端/局部外接两种变体，容量清单为`manifest.json`；视觉输入为室内、原岩岛、海岸、混合及`current-island`五类，每类包含效果/中性/秘密配对副本及四份派生取景工程，清单为`formal-visual-fixtures.json`。原四类继续作为独立回归输入；`current-island`由当前生产算法7真实物化，单独覆盖带route的naturalRock双支撑台阶、紧凑高地树及真实海岸/悬崖材质消费，取景绑定实际生成几何，不以旧岩岛样片代替新能力证据。`preparation.json`保留准备结果和失败。所有工程使用当前完整v1，保留真实资源、许可、实际像素与完整字段，落盘复读SHA后才可测量；准备阶段不计入性能样本。可用`--mode capacity`或`--mode visual`单独准备，但必须保留确切输入字节，不能拼接不同准备进程的身份/输出。确认准备器成功退出且工具浏览器/服务关闭后再继续。

先在新目录跑单组低样本smoke；它只核对运行链，不形成正式p95或容量通过：

```sh
formal_smoke_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-current-smoke.XXXXXX")
node tools/performance/run-current-formal.mjs --fixtures "$formal_prepared_dir" --output "$formal_smoke_dir" --dist "$PWD/dist" --cases building-500 --smoke --timeout-ms 180000
```

`--smoke`固定一轮、2次组内预览/采用编辑＋2次独立物件即刻编辑、4次列表选择、2次画布选择和缩减连续操作，分类为`diagnostic-current-v1-production-ui-smoke`；不能混入正式分布。修正问题后重新完成受影响正确性检查、正常构建和输入冻结，并另开输出目录。源码、素材、夹具清单、运行器和dist在采样前后均核对，冻结目录中的日志也不得继续写入。

组操作正常结束或明确拒绝后，运行器会通过普通取消按钮退出仍存在的对应表单草稿，核对取消前后revision/选择及完整包实际条目不变，再开始选择测量。取消与额外包审计是setup/tooling，不计作产品操作样本；未知失败保留原错误，不自动取消或重试。只检查该工具边界可执行`node --test tools/performance/aggregate-draft-cleanup.test.mjs`，不启动浏览器；完整建筑500链仍须按上面的独占smoke执行。

正式六组矩阵使用同一份冻结输入和全新输出目录，不带`--smoke`：

```sh
formal_performance_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-current-performance.XXXXXX")
node tools/performance/run-current-formal.mjs --fixtures "$formal_prepared_dir" --output "$formal_performance_dir" --dist "$PWD/dist" --timeout-ms 180000
node tools/performance/summarize-current-formal.mjs "$formal_performance_dir" > "$formal_performance_dir/summary-recomputed.json"
```

默认建筑/自然/混合×500/2000六组，各三轮独立Chrome进程/profile；每轮30次组内完整Prop预览/采用编辑＋30次独立完整Prop即刻编辑，两类均为公开物件的世界X加1mm/复位，另有60次对象列表选择、6次实际画布选择，以及平移/缩放各三段，分别逐rAF发送30次pointermove和20次wheel。独立即刻目标固定为`controls.remoteEntityId`，开始前核对未归属聚合组、预制组合、散布或装饰簇，且公开、未锁、原位与加1mm的完整足迹均有真实支撑。另测组预览/采用及撤销/重做；两类物件编辑完成后核对冷重开、完整包/资源hash、只读内容块/记录行字节和GM/player真实4K PNG。输入固定180m×180m、3.6m显示网格，即50×50格；500/2000均为完整Prop，轻量Decoration不替代物件数量。可显式`--cases mixed-500-remote,mixed-500-local-ports`在另一新目录测准备好的边界输入：前者在500基线上增加远端500完整Prop，后者有16条真实局部外接连接，按有限支撑合同应拒绝不完整组移动。它们不替代默认六组，也不证明更大规模支持。

当前组内物件字段编辑采用预览→确认采用两阶段：分别报告Enter→候选、采用click→领域事务、Enter→领域事务总区间和保存/显示；总区间包含实际审阅/自动化等待，不能混成纯领域耗时。独立物件由真实trusted Enter即刻提交，500完整Prop的100ms门使用Enter→实际校验完成的领域事务全链，要求三轮每轮至少30次、合并至少90次，逐轮及合并p95均不超过100ms；Enter→保存、实际重绘和显示代理分别报告。组内采用click子指标独立保留，不替代即刻编辑全链门；自由物件拖动及其余QA-PERF操作仍需各自证据。连续帧只统计真实输入活动窗，排除前置与尾部等待；双rAF仍是浏览器调度代理。三轮及合并nearest-rank分布、CPU连续性、采样间隔/缺样、RSS/目标页JS堆、首轮失败和组保护拒绝均保留，失败不自动重试或降载。逻辑内容块/最终变化行字节不等于物理磁盘I/O。运行器自动写`manifest.json`、每轮结果和`summary.json`；上面的汇总命令只重算已有证据，不启动测量。

性能浏览器全部退出后，视觉三引擎使用同一正常dist和独立产物目录。先安装引擎；在终端A启动已经构建的生产预览服务：

```sh
npx playwright install chromium firefox webkit
npm run preview -- --port 5174 --strictPort
```

回到此前准备夹具和执行性能命令的原终端B（保留`formal_prepared_dir`），串行执行五类视觉输入，等待命令结束后关闭终端A服务：

```sh
formal_visual_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-current-visual.XXXXXX")
SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5174/sceneweave/ SCENEWEAVE_FORMAL_VISUAL_FIXTURES="$formal_prepared_dir" SCENEWEAVE_FORMAL_VISUAL_OUTPUT="$formal_visual_dir" npx playwright test --config=tests/formal-visual.config.ts --workers=1
```

该配置不自动启动服务，要求`SCENEWEAVE_TEST_BASE_URL`包含部署base；固定Chromium/Firefox/WebKit、1512×982、单worker、零重试，`results.json`和`results/`保留真实下载、图像与失败trace。Chromium默认使用Playwright引擎，只有`SCENEWEAVE_CHROME_CHANNEL=chrome`会切换系统Chrome；通用`SCENEWEAVE_BROWSER_CHANNEL`不改变本配置。用例从正常首页导入冻结包，经实际UI编辑/采用/撤销、保存冷读及4K双受众输出，核对同引擎秘密配对像素、资源/完整内容和原生像素裁切；跨引擎不要求抗锯齿逐像素相同。这些自动技术证据不关闭14第8节全部视觉操作矩阵、人工观感或用户P3，也不替代自由物件拖动、完整轮廓/历史/故障矩阵、原SCN场景、1万/10万容量及完整QA-PERF-01/04。

每条视觉用例另写`results/<test-id>/formal-visual-progress.json`并附入报告，逐阶段保留实际包/像素事实，记录导入、备份、PNG/像素处理、冷开和隔离上下文创建/关闭的耗时。失败或900秒超时时保留当前操作、已完成阶段和Playwright首败；突然终止或磁盘不可写只能保留最近成功检查点。该文件仅供诊断，全部原断言完成后的`formal-visual-facts.json`才是完整技术事实，阶段耗时不作正式性能。无需启动浏览器即可执行`node --test tools/testing/formal-visual-progress.test.mjs`核查记录器边界。

下方M2、Q5及开发期分段章节保留原冻结方法和历史工具定位。`run-native-m2.mjs`、旧`visual-v2-fixtures`仍含旧schema/身份/存储或UI假设，未按当前合同重新适配前，不作为当前完整v1正式入口；`run-aggregate.mjs`继续仅作j的低次数开发观察。

## M2 原生完整v1正常生产性能复现

新标识完整v1负载使用`tools/performance/run-native-m2.mjs`，从正常`npm run build`产物的`/sceneweave/#home`进入同一原生完整v1工作区，不使用B5专用构建、旧v6入口或产品开发API。先完成受测功能修改与正确性验证，再冻结源码、构建和运行器；下列命令依次执行，采样期间不运行其他浏览器、单元/浏览器测试、构建或性能任务。系统须已安装Chrome；当前进程树RSS采样仅适配macOS。运行器使用独立回环HTTP服务和新Chrome进程/profile，拦截站外网络，不调用模型；macOS防空闲休眠仅在命令存活期间生效。

先以新的空临时目录验证运行器并诊断热点；此命令仅是低次数诊断，不产生正式通过结论：

```sh
npm run build
native_m2_diag_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-native-m2-profile.XXXXXX")
node tools/performance/run-native-m2.mjs --output "$native_m2_diag_dir" --fixtures "$PWD/tests/fixtures/performance-b5" --diagnostic-profile --cases study-500 --runs 1 --selections 1 --edits 1 --layers 2 --appearances 1 --restores 1 --menus 1 --gestures 1
```

`--diagnostic-profile`自动标为诊断，以1000μs间隔分别采集每轮首个普通编辑、首个保护/恢复采用的CDP CPU profile；包含对应字段准备、自动化与观测等待。LongTask、CPU采样和资源轮询均有观测开销，带profile的结果不能与无profile正式样本混池。只需无profile诊断时使用`--diagnostic`，并保留同样的样本缩减参数。

完成诊断修复、相关正确性验证及新一轮正常构建后，在新的空目录执行正式矩阵：

```sh
npm run build
native_m2_formal_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-native-m2-formal.XXXXXX")
node tools/performance/run-native-m2.mjs --output "$native_m2_formal_dir" --fixtures "$PWD/tests/fixtures/performance-b5"
```

默认study/island × 500/2000四组，每组3轮、每轮独立Chrome进程/profile。保留的B5严格v2原包先由独立工具准备：临时Vite工具服务与全新Chrome/profile严格读取原bytes，导出保全集合到输出目录的`preparation/<case>/`，逐文件落盘重读，再以固定journal完成完整资源校验、冷读发布和完整v1导出；结果写入`native-fixtures/<case>.sceneweave`，核对原物件字段、范围、图片/许可及新包每条hash。准备工具不进入产品，准备阶段不计入测量分布。工具服务和浏览器关闭后，每个测量进程仅从冻结的正常dist首页直接冷导入该完整v1包；首页完整重载后再点击最近工程的“打开”，重载与只读仓库核对属于重开前置。冷导入、保存、首次画布就绪记录为一个实际区间，不拆造内部耗时。

每轮框选/替换选择各30次、普通编辑10次、图层隐藏/合法重排各10次、图层外观预览/采用各5次、局部恢复3次、命名快照1次、指针/键盘菜单合计10次；平移和缩放各3段，分别逐rAF发送30次pointermove和20次wheel，另含本地重开和双受众4K导出。每组普通编辑合并n30、每种选择n90、恢复n9；同时报告每轮和合并nearest-rank p95及样本数，不把小样本包装成完整用户体验验收。新增两个小图层，仅marker进入被测层，仍检查实际依赖与256展开预算。选择/菜单/视口须保持文档和保存状态，选择前后完整包及持久库保持；最终检查保护点、自动历史、原生完整包条目和4K PNG尺寸。

精确领域区间从可信提交输入（普通物件编辑为Enter）开始，到Workspace完成领域校验、身份与撤销状态、在通知React前记录的会话时间结束；对应`data-transaction-revision`必须等于提交后revision。DOM revision、Canvas计数/就绪、保存完成和双rAF显示调度代理各自报告，不能用保存或双rAF替代领域提交。时戳只在会话/DOM，不进入工程、历史或导出。500物件普通领域p95目标100ms，连续输入帧间隔目标约33ms，2000物件作为压力观察；运行器完成不代表达标。

`manifest.json`及每轮结果记录Node、操作系统、CPU/逻辑核数、内存、Chrome版本、1512×982/DPR1视口和实际命令参数，并记录源码、构建输入、dist与运行器SHA256及采样前后未变核对。每轮原始输入/事务/LongTask、独立资源记录和CPU诊断文件保留，成功完成后自动写`summary.json`。RSS目标间隔100ms、目标页JS堆200ms，报告真实间隔、阶段、边界样本及采样错误；RSS可能重复共享页，JS堆不含完整浏览器/GPU，二者均非物理峰值。双rAF不是GPU或屏幕呈现完成；HTTP缓存关闭但不清系统缓存，不宣称50×50显示网格、自由拖拽或完整QA-PERF-04通过。输出目录必须为空且独立于原夹具，失败、取消与慢样本保留，修正后另开目录重跑。方法说明不是运行结果，各冻结的实际结果、失败修正、证据路径和剩余边界以[34后续记录](docs/reference/performance.md#doc-34)为准。

## Q5 完整v2视觉负载性能复现

参考图质量阶段使用独立的严格完整v2岩岛/旅舍负载，不走上节B5转换。先冻结实现，完成正常构建与其它检查，再准备四个固定工程包：

```sh
npm run build
node tools/performance/visual-v2-fixtures.mjs --output "$PWD/work/visual-v2-fixtures"
```

输出目录必须为空。准备器保留两份原精修作品，再增加独立持久物件至study/island各500/2000：室内保留23源/23实际PNG/五固定家具组，岩岛13源/14实际PNG含固定tint派生图。源、PNG、许可、完整包各条hash与完整v2/scene2/visual1均核对，原作品和密集合成负载分别记录；500为普通观察、2000为压力观察，不将合成密度称作自然布景。

确认准备浏览器、其它测试、构建与模型任务均结束后，独占串行执行完整矩阵：

```sh
node tools/performance/run-native-m2.mjs --output "$PWD/work/visual-v2-formal" --visual-v2-fixtures "$PWD/work/visual-v2-fixtures"
```

默认四组×三轮，每轮159观察、共1908；沿用上节普通编辑/选择/图层/外观/保护恢复/菜单/平移缩放/冷导入重开/双4K及资源采样，另含真实曲线手柄30次rAF指针移动、普通预览/完整影响范围确认/采用及普通UI撤销。岛屿500/2000的完整只读支撑依赖为507/2007，必须披露，实际展开写入仅10；旅舍装饰曲线依赖/展开均2。只读依赖数量不充当写入预算，也不能因此省略依赖检查。

完整矩阵分类为`formal-visual-v2-production-ui-observation`；缩样或`--diagnostic`/`--diagnostic-profile`另列诊断，不混入正式分布。普通500物件intent→domain commit逐轮及合并p95仍以100ms为子指标，连续输入/曲线调度、保存/恢复、渲染和4K独立报告。相同冻结、时钟中断检测、实际采样间隔和RSS/JS堆边界沿用上节；运行完成不等于达到性能门，也不替代P3、完整QA-PERF-01/04或九份真实AI新作。各冻结实际结果与剩余瓶颈只写[性能参考](docs/reference/performance.md#doc-34)，不覆盖旧完整v1或B5历史。

<a id="development-stage-diagnostics"></a>
## 开发期分段诊断

复用上节准备器生成的完整v2真实负载。下列命令依次运行，期间不并行其他浏览器、构建、测试或模型任务，输出均用新的空目录；低次数只用于定位，不产生正式p95或容量通过结论：

```sh
npm run build
node tools/performance/run-native-m2.mjs --output "$PWD/work/perf-baseline" --visual-v2-fixtures "$PWD/work/visual-v2-fixtures" --runs 1 --selections 1 --edits 2 --layers 2 --appearances 1 --restores 1 --menus 1 --gestures 1 --diagnostic
node tools/performance/diagnostic-stages.mjs --out-dir "$PWD/work/perf-stage-dist"
node tools/performance/run-native-m2.mjs --output "$PWD/work/perf-stages" --visual-v2-fixtures "$PWD/work/visual-v2-fixtures" --dist "$PWD/work/perf-stage-dist" --runs 1 --selections 1 --edits 2 --layers 2 --appearances 1 --restores 1 --menus 1 --gestures 1 --diagnostic-stages --diagnostic-profile
```

计时工具只在内存转换选定函数，生成独立的优化构建和source map，不修改应用源码或正常dist；记录完整校验、资源读/解码/SVG光栅、派生命中、候选、快照/恢复、历史扫描、hash及绘制跨度，并接收已有RenderMetrics。manifest绑定转换边界及原文件hash；缺少计时构建却传计时标志，或将计时构建作为正常/正式测量，均在启动浏览器前拒绝。工具观察器只在该显式诊断模式允许，不放开产品调试API。

每次操作的`diagnosticStages`保留已完成和未结束跨度、命中/失败及绘制分段；不得直接相加嵌套或并发耗时。额外timer、await、metrics和CPU profile会影响时延，只能与正常基线分别解读；失败或取消记录保留，新目录重跑。已有profile边界、可信输入、事务时标、资源采样与时钟断裂检查继续执行。数据及源码定位结论归[性能参考](docs/reference/performance.md#budget-performance-diagnosis)，不另建逐批报告。

分级容量模块诊断使用同一完整v2夹具，独立进程串行导入真实资源，再做公开校验、冷/热point与bounds命中、双受众投影和剔除/LOD计划：

```sh
node tools/performance/interaction-capacity.mjs --output "$PWD/work/interaction-capacity-new"
```

默认原500/2000与合成4000/10000/16000，可用`--cases study-2000,island-2000 --candidates 9900`缩小补样。合成实例复用原固定源、原位叠加且非阻挡；不测UI绘制、保存/历史/撤销或PNG，不据此放宽领域预算。真实守卫拒绝作为诊断结果保留，非脚本失败；工具/源码/夹具指纹变化或未结束进程不能报完整。当前结果与边界归[性能参考](docs/reference/performance.md#interaction-capacity-20261030)。

## 历史性能与旧工作台记录

B5/C0的专用构建、旧`assets/layers`工作台选择测量及C1c至C2浏览器命令属于退休前的历史方法。旧UI脚本不再作为当前站点的运行入口，不能用旧结果替代完整v1的性能或回归证据；旧页面相关用例按[tests/README](tests/README.md)退休。B5完整负载、设备/资源口径和失败限制见[21](docs/archive/m0-m1-validation.md#doc-21)，C0见[22](docs/archive/m0-m1-validation.md#doc-22)，选择及native v3对照见[25](docs/archive/m0-m1-validation.md#doc-25)/[26](docs/archive/m0-m1-validation.md#doc-26)，历史/建筑工具见[27](docs/archive/m0-m1-validation.md#doc-27)/[28](docs/archive/m0-m1-validation.md#doc-28)。原始B5 manifest与四个包仍在`tests/fixtures/performance-b5`，本次不删除或改写它们。

新标识完整v1性能使用上节独立运行器，正式测量仍须冻结源码、构建与运行器并串行执行；macOS进程树RSS和目标JS堆是采样观测，均非完整浏览器/GPU物理峰值。低次数、少轮次、带CPU profile的诊断不能混入正式分布，双rAF仅是显示调度代理。实际结果和未通过门槛继续归[34](docs/reference/performance.md#doc-34)，本次入口删除不重认定旧结果。

## 修改流程

先读 [AGENTS.md](AGENTS.md) 与[文档导航](docs/README.md)，核对工作区和 Git 状态，保留无关修改。较小澄清直接改主文档；范围或数据契约变化直接更新所属主定义及对应任务/验收，历史决策参考不再复制当前状态。PR 说明具体问题、修改后的行为、相关验证与实际限制。

- 持久修改走领域命令和原子校验，不直接改冻结的 SceneHistory.document 或画布节点。
- 保存完整 SceneDocument；保留整数毫米、共享墙、门附着和单调 revision。
- 锁、候选失败、撤销与跨标签冲突不能以局部成功或最后写入覆盖处理。新增图层锁、固定范围批量操作及局部恢复同样遵守这些边界；持久化语义改变先更新04/06的版本和完整迁移。
- C5认证只复用内部严格解析、独立深冻结的document/historyIdentity/appearance三元对象引用；外部克隆、换任一元及未知/访问器/隐藏包装字段不能借旧认证，参见`src/core/v6/schema-certification.test.ts`。资源字节/hash/许可/预算、每次解码、依赖/锁/保护点/CAS继续校验；只变revision元数据的受控路径仍独立校验身份。
- 玩家预览、图层列表与 PNG 共用过滤规则，秘密像素和文本都纳入回归。
- 实现只接受声明支持的范围；尚未实现的硬约束应报错，不能省略后继续保存。

按改动运行相关验证。几何、事务、导入或保存协议变化需覆盖对应负例；浏览器交互变化需核查受影响旅程。仅文档修改检查链接、术语与事实即可，不为低影响可逆改动添加镜像实现的测试。

## 当前适合的贡献

按[开发整改任务](docs/07-roadmap.md#development)修复问题、完善生成与编辑闭环；用具体备团场景说明需求与卡点，注明规则体系、地图尺度和输出去向。文档矛盾直接修正所属主定义，附来源或可复核的最小例子；当前状态与排期不再追加到其他主题。

文档以中文为主，实体/字段名使用约定英文。新默认值要说明是产品偏好还是官方规则，并保留版本与来源。实际检查的结果、首轮失败与复验归对应[历史台账](docs/archive/README.md)；不新增逐批编号报告，也不由单个样板或有限支持操作推定完整验收通过。

## 内容与许可

原创贡献按本仓库 [MIT 许可](LICENSE)提供；第三方素材和规则标明各自来源与许可。请勿提交官方规则书全文、商业模组、API Key、个人聊天、私密工程或未授权素材。使用原创最小例子说明问题。

参考项目代码的 GPL/AGPL 义务不能用换语言或改文件名消除；拟复用前先说明兼容安排。有关规则、素材与生成内容的边界见[许可文档](docs/10-rules-assets-and-licensing.md)。提交前核查文档链接、许可与秘密数据，只提交本次明确相关的文件。

## 证据归档与资料体量

现状和候选见[46](docs/archive/m2-project-validation.md#doc-46)。普通Git保留测试/必要夹具、简短结论、失败及修正、环境/命令/源码指纹、紧凑结果与关键附件。新批次沿用`tools/testing/compact-reporter.mjs`，避免base64附件内嵌大JSON和重复源码/dist全量快照；未保留附件如实标记。

B5 manifest与四个原始包按原字节保存在`tests/fixtures/performance-b5`；早期清理及附件可用性见历史台账。新运行使用被忽略的`work/`、`test-results/`或独立系统临时目录，按需清理，不默认提交大附件。用户工程、资源与旧数据不因文档整理而删除；测试去重须保留实际行为保障。
