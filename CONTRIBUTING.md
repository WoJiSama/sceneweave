# 贡献说明

织境 · Sceneweave 本地版本号仍为 `0.2.0-m1-d2`，M2-0f默认主路径已切到新完整v1、原生Workspace/Canvas/Workbench及sceneweave-projects、sceneweave-library。旧整页入口退役，兼容边界保留严格读取、只读发现/完整保全转换与原件取回；不自动迁移真实用户数据。f适用必要检查、混合编辑/有限恢复、备份、普通样板双受众4K逐RGBA和旧库UI保全转换子项归[52](docs/52-m20f-native-workspace-validation.md)，最终批次以报告为准；a至e历史归48至51。M2-1本地后端/流式文本及只读工具续答已完成（05），M2-2隔离草稿/保护采用已扩展至M2-3场景工具及M2-4受限SVG/渐进同化，M2-5部署配置已实现、真实HTTPS服务待资料；用户已要求本轮回归和commit/push（排除todo.md），现行结果集中05/09，34正式性能继续后置，不关闭QA-AI-16、完整M1或性能门。

室内/室外路线按M1-A/B/C/D推进。B1完整素材工程证据见[17](docs/17-m1b-b1-validation.md)；B2新增VIS-01、原创室内素材、有限原子编辑和共用预览/PNG，证据见[18](docs/18-m1b-b2-validation.md)。[视觉规范](docs/14-visual-and-asset-system.md)、[素材清单](docs/15-m1a-asset-production-list.md)与[交接](docs/16-m1a-handoff.md)给出主定义。B3室外样板、散布与有限通行证据见[19](docs/19-m1b-b3-validation.md)；B4完整性诊断、三组48格受众配对和双样板存档/失败矩阵见[20](docs/20-m1b-b4-validation.md)。B5真实负载/资源观测、预算与限制见[21](docs/21-m1b-b5-validation.md)，C0性能与视口基础见[22](docs/22-m1c-c0-validation.md)。C1a空白创作的实现范围和本批检查见[23](docs/23-m1c-c1a-validation.md)，C1b适用检查见[24](docs/24-m1c-c1b-validation.md)，选择性能及C1c图层实现验证见[25](docs/25-selection-performance.md)/[26](docs/26-m1c-c1c-validation.md)，C1d命名快照/首批独立物件局部恢复与完整历史工程见[27](docs/27-m1c-c1d-validation.md)，C2建筑工具及会话内结构恢复见[28](docs/28-m1c-c2-validation.md)，C3组件与参数外观见[29](docs/29-m1c-c3-validation.md)，C4室外工具与有限恢复见[31](docs/31-m1c-c4-validation.md)，C5联合验证和现版性能结论归[32](docs/32-m1c-c5-validation.md)。完整M1、主题P3、SCN-04与全交互性能仍按各自门槛判断；新模型同步格式、迁移和验收。

当前默认首页为`/#home`，完整创作入口为`/#workspace`，包含工程、建筑、素材库、室外及图层/对象/历史；`/#outdoor`等旧整页hash统一回首页。新完整v1空白工程保留23个物件、11种材质和3种组合预装策略，画布/坐标放置使用显式支撑和暂态预览。主路径由editor/main、editor/native-canvas、application/workspace及新platform适配构成，共用shared，不经旧core/io/render视图往返；实际资源/派生像素、许可、锁、256预算、单调revision和CAS保持。旧输入必须先保全完整scope、重新选择全卷核验，再建立独立转换副本；普通新包导入也整体安装为新owner/r0。建筑恢复仍要求本会话witness，持久身份限明确支持的物件/组合/室外范围，历史能力边界见28/29/31，原生新路径结果见52。

C5联合验收批次冻结349份应用源码，最终单元82文件979/979通过（68.85秒），正常构建通过（2.75秒）；最终全量Chrome168/168通过，0失败/重试/跳过（12.8分钟）；最终正常生产UI通过（46.791秒）；study/island×500/2000各三轮正式性能矩阵未完成，已执行批次未形成可合并的完整p95结果。优化后study-500单次诊断普通领域提交1110.4ms，优化前诊断2174.2ms，均不是正式分布且仍超100ms；性能门未通过，本批不能宣布C5或全交互性能通过，实际证据与待验项见[32](docs/32-m1c-c5-validation.md)。

其后资源复用批次通过992项单元、20项适用Chrome及正常构建/生产UI，独立诊断归[33](docs/33-c5-resource-reuse-validation.md)。2026-10-23用户要求将余下性能优化暂缓，待其他需求完成后集中处理；性能欠项暂不阻塞后续需求开发，正式性能门保持未通过。后续入口见[34](docs/34-performance-followup.md)，后续功能仍运行适用正确性回归，不因暂缓改为性能通过或容量承诺。

## 开发环境与命令

建议使用.nvmrc的Node.js24.14.1；B2/B3/B4使用该版本/npm11.11.0，B1历史覆盖24与26，依赖由package-lock.json锁定。package.json允许Node.js>=22.12.0且<27；其他允许版本不等于已验证。

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

M2-0共享内核可单独运行`npm run check:shared`：AST依赖边界、无DOM/无Node类型编译、真实Node原生ESM命令/身份/投影、无图片当前/历史ZIP及保全set重读闭环，临时发射目录自动清理。d批适用定向命令为`npx vitest run src/shared src/compat/legacy src/platform/browser/storage`，当批10文件124项，Node图片端口使用明确替身；真实资源/像素IO运行`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20c-resources.spec.ts --reporter=line`，d家族/文件保全转换与新库冷读另运行`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20d-conversion.spec.ts --reporter=line`。b/c/d历史分别见[48](docs/48-m20b-shared-core-validation.md)、[49](docs/49-m20c-resource-io-validation.md)、[50](docs/50-m20d-preservation-conversion-validation.md)；f的新默认主路径另按52验证，完整回归仍按用户通知。

e整合定向命令为`npx vitest run src/shared src/compat/legacy src/platform/browser/storage src/platform/browser/library src/platform/browser/content --maxWorkers=1`，当批15文件165项；串行避免62项内容对照受并发负载触发默认测试超时。当批`check:shared`为60模块，并实际执行organization-only新库备份的Node往返。真实目录/原文件保全、私密模板/派生像素、冷开/续跑与57内置图片检查为`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20e-library.spec.ts --reporter=line`，4项历史结果见[51](docs/51-m20e-library-conversion-validation.md)。f已切换主UI/新个人库，不把这些早期模块API测试写成已迁移真实用户数据或全量回归通过。

f原生定向入口位于`src/application/workspace`、`src/editor/main`、`src/editor/native-canvas`、`src/platform/browser/render`及新主库的历史包/原件测试。真实浏览器可定向运行`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20f-ui.spec.ts tests/m20f-render.spec.ts tests/m20f-entry.spec.ts --reporter=line`，分别检查混合主会话/目录、实际GM/player 4K逐RGBA对照及完整保全重读/取消重试/原件下载；执行前核对本轮改动和用户授权，不默认启动全部测试。最终命令、批次结果及失败修正以[52](docs/52-m20f-native-workspace-validation.md)为准。

Vitest 运行 `src/**/*.test.ts` 中的领域、存储、工程文件及渲染测试；Playwright 使用 `tests/` 下的浏览器旅程，会按配置启动本地服务或复用已有同端口服务。默认安装并使用 Playwright Chromium。系统 Chrome 可用时也可运行：

```sh
SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e
```

测试使用独立 profile/浏览器上下文。M0历史在系统 Chrome 上通过 13 个浏览器测试，另有 95 个单元测试（8 文件）、构建与生产依赖审计通过，见 [M0 验证报告](docs/13-m0-validation.md)。B1历史检查、环境和未测范围见[17](docs/17-m1b-b1-validation.md)，C1a历史批次见[23](docs/23-m1c-c1a-validation.md)，C1b历史批次见[24](docs/24-m1c-c1b-validation.md)。构建、单元和浏览器证据分别记录；C1a浏览器旅程位于 `tests/c1a-creation.spec.ts`，可用 `npm run test:e2e -- tests/c1a-creation.spec.ts` 定向执行，C1b选择/菜单/批量及500/2000物件真实框选回归位于 `tests/c1b-selection.spec.ts`，可用 `npm run test:e2e -- tests/c1b-selection.spec.ts` 定向执行。需要使用系统Chrome时设置 `SCENEWEAVE_BROWSER_CHANNEL=chrome`；复用B5正式完整夹具可设置 `SCENEWEAVE_B5_FIXTURE_DIR=tests/fixtures/performance-b5`。实际结果以验证记录为准。

生产构建在 dist/；可使用 `npm run preview` 在本地检查构建结果。[GitHub Pages 工作流](.github/workflows/deploy.yml)在推送 main 或手动触发时，读取 `.nvmrc` 安装 Node，执行 `npm ci` 和 `npm run build` 后部署静态站点至[在线预览](https://wojisama.github.io/sceneweave/)。该工作流只负责构建和部署，不代替上述单元/浏览器验证；成功结果以 GitHub Actions 运行记录为准。它不包含 AI 网关、工程云同步或正式发行版流程。

## M2-1本地任务服务

使用`.nvmrc`的Node24.14.1。本地Node/Hono服务、只读对话工具及M2-2独立物件草稿已经实现，协议、预算/保留期和实际结果集中[05第11节](docs/05-ai-and-generation.md#11-m2-1连接与任务协议2026-10-24实施合同)。`node:sqlite`在本批Node仍有experimental提示；未声明其他Node版本通过。服务单实例独占一个数据目录，主工程/个人素材仍在浏览器。

首次配置且`.env.ai`不存在时，将`.env.example`复制为`.env.ai`并设为0600，在文件里填写`SCENEWEAVE_AI_PROVIDER_BASE_URL`、`PROVIDER_API_KEY`、`PROVIDER_MODEL`及独立随机`SCENEWEAVE_AI_ACCESS_TOKEN`（所有变量均带`SCENEWEAVE_AI_`前缀）。后端默认127.0.0.1:8787、数据根local-data/ai；允许Origin必须精确到协议/主机/端口，不含Pages路径。保留现有配置，不盲目覆盖；真实配置被Git忽略，provider key不能使用VITE_前缀。

```sh
npm run ai:build
npm run ai:start
```

另一个终端运行`npm run dev`。在统一工作区“AI对话”填写后端地址和`.env.ai`中的应用访问凭据，点击连接；页面不填写provider key。应用凭据仅本次页面内存，刷新后重新输入；模型/地址由服务器固定。生产前端可通过`VITE_SCENEWEAVE_AI_URL`设置公开后端origin；真实HTTPS部署另归M2-5，当前仅有部署脚手架，尚未部署。使用127.0.0.1与localhost时需分别配置准确Origin。

```sh
npm run ai:test
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m21-ai-conversation.spec.ts tests/m22-ai-authoring.spec.ts --reporter=line
```

草稿操作前先在产品内明确授权对象、允许操作、固定素材与支撑范围，并同意两层元数据发送范围。任务不会直接改主工程；等待本机实际资源校验、审阅差异后，才保护当前并一次采用。重新绑定/查询只读取任务，明确继续才再次调用模型。完整合同与结果见[05第12节](docs/05-ai-and-generation.md#12-m2-2-技能与独立物件草稿2026-10-24实施合同)。

ai:test覆盖共享草稿/后端/provider/客户端；本机原子采用另运行`npx vitest run src/application/workspace/atomic.test.ts src/application/workspace/workspace.test.ts src/platform/browser/storage/repository.test.ts --maxWorkers=1`。Chrome使用真实HTTP/SSE/SQLite和受控模型替身，普通测试不调用真实模型。`npm run build`和typecheck也检查服务类型；ai:build另输出被忽略的dist-ai。确需验证真实渠道时，在编译后明确运行`node --env-file=.env.ai tools/testing/ai-provider-probe.mjs`；默认三次请求测文字和工具续答，`--interrupt-and-error`另测首段后中止及坏凭据，可能产生模型费用且无自动重试。探针不输出密钥/正文；用`--out`保存到新系统临时路径，不归档大报告。

## M2-5线上 AI 服务与 Pages

仓库提供可复现的 Node 24 服务镜像和 Caddy HTTPS 反向代理，但不会代替目标服务器、DNS 或凭据配置。部署入口位于`Dockerfile`和`deploy/compose.yaml`：AI 容器以非 root `node` 用户运行，根文件系统只读，任务 SQLite/私有制品写入独立的`ai-data`卷；Caddy 为域名申请/续期证书并只把请求转发到内部 AI 服务，事件流保持即时刷新。`/healthz`不需要应用凭据，Docker 和 Compose 健康检查只返回 `{ "ok": true }`，不会暴露模型、Origin、令牌或存储信息。

在一台已安装 Docker Engine/Compose、且可从公网接收 TCP/UDP 80/443 的服务器上执行：

```sh
cp deploy/compose.env.example .env.deploy
chmod 600 .env.deploy
# 编辑 .env.deploy，把 SCENEWEAVE_AI_DOMAIN 改成已解析到此服务器的 HTTPS 域名
cp deploy/ai.env.example .env.ai.production
chmod 600 .env.ai.production
# 用 openssl rand -hex 32 生成仅供应用登录使用的访问令牌
# 编辑 .env.ai.production，替换访问令牌、模型供应商地址/密钥/模型和 Pages Origin
docker compose --env-file .env.deploy -f deploy/compose.yaml config --quiet
docker compose --env-file .env.deploy -f deploy/compose.yaml up -d --build
docker compose --env-file .env.deploy -f deploy/compose.yaml ps
curl --fail --silent --show-error https://ai.example.com/healthz
```

`deploy/ai.env.example`中的`SCENEWEAVE_AI_ALLOWED_ORIGINS`必须写 Pages 的精确Origin，例如`https://wojisama.github.io`，不带`/sceneweave/`路径；若另有自定义域名，按逗号加入完整Origin。应用访问令牌和模型供应商密钥只放在服务器的`.env.ai.production`，不能提交仓库，也不能以`VITE_`前缀或GitHub Pages变量发布。数据卷和 Caddy 证书卷应纳入服务器备份；只允许一个 AI 容器实例独占数据卷，更新前用`docker compose ... up -d --build`，服务重启后会按协议将未决任务置为暂停并保留可查询进度。

Pages 工作流读取 GitHub 仓库 Actions 变量`VITE_SCENEWEAVE_AI_URL`作为公开后端Origin，并在构建前拒绝 HTTP、路径、查询、片段或凭据。只有设置该变量后，线上前端才会预填后端地址；凭据仍由使用者在页面内存中输入。工作流不读取服务器`.env.ai.production`，不会把应用令牌或 provider key 放进静态产物。将仓库变量设为例如`https://ai.example.com`后，再手动运行或推送触发 Pages 工作流。检查命令中的`ai.example.com`也应替换成实际部署域名。

上线前必须由部署方完成并实测：域名 A/AAAA 解析、80/443 防火墙、Caddy 证书签发、`/healthz`、Pages Origin 的 OPTIONS/GET/POST/SSE/DELETE、断线重连/取消、容器重启后的暂停任务、数据卷权限与备份恢复，以及一次完整的创建→草稿校验→采用→保存流程。本地 Docker 构建和 Compose 配置检查不代表这些线上条件已满足；本仓库没有目标主机凭据，也不会在此处宣称已部署。

## 当前主路径回归

M2-0f之后，旧整页hash已退役；旧203项Chrome结果保留为历史，不能直接作为当前入口的通过证据。当前适用的联合回归命令：

```sh
npm test -- --maxWorkers=1
npm run ai:test
npm run typecheck
npm run check:shared
npm run build
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/home-showcase.spec.ts tests/sample-loading.spec.ts tests/m20c-resources.spec.ts tests/m20d-conversion.spec.ts tests/m20e-library.spec.ts tests/m20f-entry.spec.ts tests/m20f-ui.spec.ts tests/m20f-render.spec.ts tests/m21-ai-conversation.spec.ts tests/m22-ai-authoring.spec.ts tests/m23-m24-authoring.spec.ts tests/m24-svg-raster.spec.ts --workers=1 --reporter=line
```

首页图片刷新使用`node tools/build-home-showcase.mjs`，从真实完整样板原生渲染六图并记录源/PNG/像素hash。火山新增独立热裂版本使用`node tools/build-themed-art.mjs --lava-hot`及`node tools/build-volcano-variant.mjs`；旧lava v1源/图/manifest保留，已存在固定ID不同字节时拒绝覆盖。正式P3、真实HTTPS、跨浏览器/配额和性能专项仍单独验收。

## 当前原生样板加载诊断

2026-10-24按用户授权修复的范围及前后结果集中在[34](docs/34-performance-followup.md#2026-10-24原生完整v1样板加载修复)，不新增逐批验收报告。必要定向入口为`npx vitest run src/application/workspace src/platform/browser/content src/platform/browser/storage src/editor/main/*.test.ts src/platform/browser/render --maxWorkers=1`及`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/sample-loading.spec.ts tests/m20f-ui.spec.ts tests/m20f-entry.spec.ts tests/m20f-render.spec.ts --reporter=line`；本批结果分两批Chrome运行，不等同完整回归。

诊断使用正常`npm run build`，先在一个终端执行`npm run preview -- --port 5174`，再在另一终端逐条运行下列命令；期间不并行测试、构建或其他浏览器负载。输出使用新的系统临时目录：

```sh
sample_load_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-sample-load.XXXXXX")
node tools/testing/sample-load-diagnostic.mjs --runs 2 --out "$sample_load_dir/local.json"
node tools/testing/sample-load-diagnostic.mjs --runs 1 --samples study --delay-ms 80 --out "$sample_load_dir/delay.json"
```

工具默认真实`http://127.0.0.1:5174/sceneweave/`页面，系统Chrome独立上下文，不启用应用调试API；每个上下文首次/回首页再次打开各一次。记录点击至确认、采用至保存/画布就绪代理、PNG读取调用、位图创建及长任务，等待本次后台活动稳定再计数。`--delay-ms`仅模拟每次PNG请求的延迟，路由会禁用HTTP缓存，不能当作GitHub Pages实测；低次数结果不产生正式p95/通过结论。没有长期位图缓存或Worker，本批不替代下述历史矩阵，也不重建work/evidence。

## B5性能复现

本节保留B5当时的v2素材Canvas2D与M0 Konva历史管线。B5采用独立生产工具入口，复用当时AssetCanvas、Workspace、样板候选守卫、资源校验和仓库；正常 `npm run build` 不暴露专用性能API。M2-0f默认格式/入口已经改变，恢复正式测量前须先核对并适配新主路径、夹具与测量合同；不直接把历史脚本结果作为新完整v1性能结论。当前正式性能仍按34后置，本轮没有执行本节专项。

```sh
npm run build:performance
npm run perf:b5
```

专用产物位于 `dist-performance/`，运行器自行创建仅绑定回环地址的临时服务，输出默认保存在 `performance-results/b5/`。运行器默认使用系统Chrome，每个VIS-01/02的500/2000物件组合分别启动三个独立浏览器进程；每轮执行30次物件编辑、30次轮廓编辑与60次真实指针选择，并记录导入、保存、重开和双受众4K。B5历史口径见[21](docs/21-m1b-b5-validation.md)，C0新增命令准备与真实工作台测量见[22](docs/22-m1c-c0-validation.md)。

C0复用B5原始完整包，`--fixtures` 必须是包含manifest和fixtures的绝对目录；每次选择独立输出，禁止覆盖历史。两类测量必须依次运行，不能与浏览器测试或构建并行：

```sh
npm run build:performance
npm run perf:b5 -- --output performance-results/c0-modules --fixtures "$PWD/tests/fixtures/performance-b5"
node tools/performance/summarize-b5.mjs performance-results/c0-modules
npm run build
node tools/performance/run-c0-workbench.mjs --output "$PWD/performance-results/c0-workbench" --fixtures "$PWD/tests/fixtures/performance-b5"
```

第一组保留原事务计时并新增准备前起点；第二组只通过正常生产页面真实操作，分列Enter提交、轮廓候选、采用点击与视口手势。两组数据不混池，双rAF均是调度代理。`SCENEWEAVE_B5_FIXTURE_DIR`可为 `tests/b5-workbench.spec.ts`、`tests/c0-viewport.spec.ts`提供相同归档包，在正常生产地址配合 `SCENEWEAVE_TEST_BASE_URL`验证，无需DEV API。

现有RSS采样使用macOS `/bin/ps` 的进程树与单位约定，完整复现目前仅支持macOS；Linux/Windows的资源采集尚未适配。系统需已安装Chrome，仅安装Playwright Chromium不提供默认Chrome通道。所有正式测量串行运行，期间不并行运行单元/浏览器测试、构建或其他性能任务；macOS运行器使用本次命令范围内的防空闲休眠，不修改系统电源设置。

重测可用 `npm run perf:b5 -- --output performance-results/b5-recheck` 指定新目录，保留旧原始数据。少于默认轮数或操作数的运行仅作诊断，不替代正式采集；每类30次编辑的p95仍须连同样本数和各轮差异解读。进程树RSS和目标JS堆都是采样观测，不是完整浏览器/GPU物理峰值；Canvas提交、画布复制和双rAF显示调度近似值也须分别报告，不能把它们直接写成全部交互已达目标。

## 大量选择及native v3复测

使用正常生产构建、同一B5原始完整包和独立空输出目录；每组3个新Chrome进程、每轮30次框选/30次替换选择。`layers` 路由通过真实UI把完整v2包迁为v3，不使用开发API；v2历史对照见25，v3独立结果见26。两次正式采集需依次执行，期间不运行其他浏览器/测试/构建：

```sh
npm run build
node tools/performance/run-selection.mjs --output "$PWD/performance-results/selection-assets-recheck" --fixtures "$PWD/tests/fixtures/performance-b5" --workbench assets
node tools/performance/run-selection.mjs --output "$PWD/performance-results/selection-layers-recheck" --fixtures "$PWD/tests/fixtures/performance-b5" --workbench layers
```

每个case每种操作90样本、nearest-rank p95；计时分列DOM就绪、双rAF显示调度代理和LongTask，完整包/资源/原始IDB/revision/保存/底图及采样窗口细节计数必须保持。双rAF不是GPU或物理呈现，也不替代完整交互/资源峰值矩阵。`--diagnostic`、`--isolate`、`--trace` 或减少轮数仅供诊断，不混入正式通过记录。

C1c真实UI、持久化/故障与双受众渲染矩阵可用 `SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c1c-layers.spec.ts tests/c1c-storage.spec.ts tests/c1c-renderer.spec.ts` 串行运行。v1/v2/v3读者分别严格分派，v3领域视图不可用于旧版渲染或落盘。

C1d真实UI、严格来源迁移、空存储离线历史往返、实际双标签CAS/故障和原生双受众像素用例可运行 `SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c1d-workbench.spec.ts tests/c1d-storage.spec.ts tests/c1d-renderer.spec.ts`。v4信封内仍为严格v3 SceneDocument；仅通过显式完整v3视图进入v3渲染/IO，完整v4包不得送入旧读者。实际证据及首批独立物件边界归27；此正确性矩阵不替代历史操作性能/容量或真实配额耗尽。

C2从空白建立建筑、共墙/门窗/注记/遮罩、缩放量尺、会话结构恢复与原生4K/离线往返可运行 `SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c2-workbench.spec.ts tests/c2-polygon-workbench.spec.ts tests/c2-structure-history.spec.ts tests/c2-renderer.spec.ts`。结构恢复须明确依赖及跨层确认；重开/导入后没有连续性witness，旧结构恢复会拒绝。本批不扩大持久结构身份、物件完整恢复或全交互性能声明；实际证据见[28](docs/28-m1c-c2-validation.md)。

## 修改流程

先读 [AGENTS.md](AGENTS.md) 与[文档导航](docs/README.md)，核对工作区和 Git 状态，保留无关修改。较小澄清直接改主文档；范围或数据契约变化同时更新[决策记录](docs/11-decisions-and-open-questions.md)及对应任务/验收。PR 说明具体问题、修改后的行为、相关验证与实际限制。

- 持久修改走领域命令和原子校验，不直接改冻结的 SceneHistory.document 或画布节点。
- 保存完整 SceneDocument；保留整数毫米、共享墙、门附着和单调 revision。
- 锁、候选失败、撤销与跨标签冲突不能以局部成功或最后写入覆盖处理。新增图层锁、固定范围批量操作及局部恢复同样遵守这些边界；持久化语义改变先更新04/06的版本和完整迁移。
- C5认证只复用内部严格解析、独立深冻结的document/historyIdentity/appearance三元对象引用；外部克隆、换任一元及未知/访问器/隐藏包装字段不能借旧认证，参见`src/core/v6/schema-certification.test.ts`。资源字节/hash/许可/预算、每次解码、依赖/锁/保护点/CAS继续校验；只变revision元数据的受控路径仍独立校验身份。
- 玩家预览、图层列表与 PNG 共用过滤规则，秘密像素和文本都纳入回归。
- 实现只接受声明支持的范围；尚未实现的硬约束应报错，不能省略后继续保存。

按改动运行相关验证。几何、事务、导入或保存协议变化需覆盖对应负例；浏览器交互变化需核查受影响旅程。仅文档修改检查链接、术语与事实即可，不为低影响可逆改动添加镜像实现的测试。

## 当前适合的贡献

- 用具体备团场景说明需求与卡点，注明规则体系、地图尺度和输出去向。
- 复核 M0 的共享结构、异常恢复、保密输出和可复现负载，补充真实证据。
- 按 M1-A/B/C/D 完善视觉规范、双样板、手工绘图、真实素材与组件，先用样板测量再扩展工具。
- M2按[45](docs/45-ai-authoring-and-unified-v1-plan.md)先统一完整v1/共享核心，再接自有任务后端、流式技能/工具草稿、场景创作及SVG/渐进同化；首版无生图API，最终采用保持保护点/CAS/锁/256预算。
- 修正文档矛盾与含糊定义，附上来源或可复核的最小例子。

文档以中文为主，实体/字段名使用约定英文。新默认值要说明是产品偏好还是官方规则，并保留版本与来源。VIS-01/02首轮结果见[18](docs/18-m1b-b2-validation.md)/[19](docs/19-m1b-b3-validation.md)，B5技术观测见[21](docs/21-m1b-b5-validation.md)，C1a创作闭环见[23](docs/23-m1c-c1a-validation.md)，C1b有限选择/批改/菜单见[24](docs/24-m1c-c1b-validation.md)，选择性能、C1c与C1d见[25](docs/25-selection-performance.md)/[26](docs/26-m1c-c1c-validation.md)/[27](docs/27-m1c-c1d-validation.md)，C2建筑与有限恢复见[28](docs/28-m1c-c2-validation.md)，C3组件/参数及适用恢复见[29](docs/29-m1c-c3-validation.md)，C4室外/有限恢复见[31](docs/31-m1c-c4-validation.md)，C5联合功能与最终生产通过、性能未达和正式矩阵未完成结论见[32](docs/32-m1c-c5-validation.md)；其他浏览器、真实配额耗尽、完整主题P3、完整SCN-01/02/03/04与全交互性能尚未验证。不能由程序符号、单样板或有限支持操作推定完整通过。各批另建验证记录，保留13/17–23与各自原始证据。

## 内容与许可

原创贡献按本仓库 [MIT 许可](LICENSE)提供；第三方素材和规则标明各自来源与许可。请勿提交官方规则书全文、商业模组、API Key、个人聊天、私密工程或未授权素材。使用原创最小例子说明问题。

参考项目代码的 GPL/AGPL 义务不能用换语言或改文件名消除；拟复用前先说明兼容安排。有关规则、素材与生成内容的边界见[许可文档](docs/10-rules-assets-and-licensing.md)。提交前核查文档链接、许可与秘密数据，只提交本次明确相关的文件。

C3组件工坊入口为 `/#composition`，历史工坊「组件与外观」先保存再迁移当前v4为独立副本。开发与新代码位于 `core/v5`、`io/v5`、`editor/v5`；严格v5完整信封内保留有效v3场景，显式v3视图只用于原生渲染/领域工具，禁止替代v5保存或导出。内部固定保全定义用于保持源/非活动派生资源闭包，不作为普通放置目录条目。

C3真实图片、离线资源/历史及UI可串行运行 `SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c3-workbench.spec.ts tests/c3-resources.spec.ts`；全量单元可用 `npm test -- --maxWorkers=1` 避免高负载身份/预算测试互相争用。C3单位中的图像/存储替身不能代替真实Canvas/IndexedDB结论。正常生产验收必须使用 `npm run build` 的产物且没有 `__sceneweave` 开发/性能入口；本批实际命令、原始证据及边界归[29](docs/29-m1c-c3-validation.md)，不覆盖13/17–28的历史结果。

C4入口为 `/#outdoor`，新代码位于 `core/v6`、`io/v6`、`editor/v6`；原生场景仍严格v3，新增持久室外identity3和严格v6完整信封/仓库。可串行运行 `SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c4-workbench.spec.ts tests/c4-storage.spec.ts tests/c4-renderer.spec.ts`，包含室外真实依赖、跨层锁/256预算、重开/离线/原件链、CAS与双受众。范围和本批原始证据见[31](docs/31-m1c-c4-validation.md)，建筑身份不因室外持久身份而升级。

C5新增联合用例为 `tests/c5-integration.spec.ts` 和 `tests/c5-storage.spec.ts`，可按以下命令串行定向运行：

```sh
SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/c5-integration.spec.ts tests/c5-storage.spec.ts
```

其中存储写入失败通过native事务定点抛出错误验证回滚，不能称为实际配额耗尽；隐私测试保存6份真实4096² PNG并核对RGBA与元数据。全量回归与新增联合用例的实际批次、早期夹具/运行器失败、最终源码指纹分开保留于[32](docs/32-m1c-c5-validation.md)。

## M1-D 混合场景首批

以下保留35当批的入口和复现语境；f以后从首页选择「海岸哨所」进入原生主工作区，旧`/#outdoor`已统一回首页，旧浏览器脚本恢复执行前须适配当前入口。`tools/build-outpost-art.mjs`只重建新增原创包，源SVG、manifest与许可位于`assets/sceneweave-handdrawn-outpost/`，静态PNG位于对应`public/assets/`；旧包不重建。

串行定向浏览器验证：`SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e -- tests/m1d-outpost.spec.ts`。覆盖真实空白结构、混合样板编辑/恢复、原生资源/离线完整历史包和固定遮罩4K；正常生产UI独立验证，不把开发入口当生产证据。实际环境、命令与限制见[35](docs/35-m1d-outpost-validation.md)。本批不启动性能专项或正式补测。

## C5 正常生产性能复现

C5当时使用正常生产页面和可信输入，不使用B5专用性能构建或产品开发API。以下是32记录的v6历史方法，脚本/夹具/默认入口尚须按M2-0f的新主路径重新核对，当前没有执行或重新认定性能通过；恢复专项前先按34安排适配，再构建并独立串行测量：

```sh
npm run build
node tools/performance/run-c5.mjs --output /ABS/NEW-EMPTY-DIR --fixtures /ABS/sceneweave/tests/fixtures/performance-b5
```

默认study/island×500/2000、每组3个全新系统Chrome进程/profile，原始v2包经正常UI完整迁v6。每轮框选/替换各30次、普通编辑10次、隐藏/合法重排各10次、有限层参数5次、局部恢复3次、命名1次、指针/键盘菜单共10次，平移/缩放各3段（每段30次pointermove/20次wheel、逐rAF输入），另冷导入/本地重开和双受众4K。只有marker进入小工作层，遵守256实际展开预算。输出目录必须为空，失败及慢样本保留。

精确领域计时从可信提交输入到Workspace全部校验/身份/undo完成、通知React前的会话时间；DOM、raster、保存、双rAF分别列出。该时间和对应revision只在会话/DOM，不能进入工程、历史或备份。每轮及合并nearest-rank p95与n分列；500普通领域p95目标100ms和连续帧p95目标33ms分别判断，2000为压力。双rAF不是GPU或物理显示完成，原B5网格/范围不冒充50×50显示网格。

资源采样目标为进程树RSS100ms、目标页JS堆200ms，报告真实间隔/阶段/raw；RSS可重复共享页，堆不含完整浏览器/GPU。正式测量期间不运行其他浏览器、测试或构建，也不改受测源码、dist或运行器。默认每case普通编辑合并n30、每类选择n90、恢复n9；恢复等小样本须披露，未达标如实记录，不据完成脚本关闭C5或QA-PERF。

低次数诊断可追加 `--diagnostic --cases study-500 --runs 1 --selections 1 --edits 1 --layers 2 --appearances 1 --restores 1 --menus 1 --gestures 1`。`--diagnostic-profile`仅首个普通编辑启用CDP CPU采样，自动标为诊断，不能混入正式分布。查看汇总可运行 `node tools/performance/summarize-c5.mjs /ABS/EVIDENCE-DIR`；实际结论以32及所列原始指纹为准。

U1a默认首页为`/`或`/#home`，最新统一工作区为`/#workspace`；旧几何原型显式从`/#geometry`访问，其他旧深链接保持。专项回归命令为`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/u1a-workspace.spec.ts tests/u1a-legacy.spec.ts`，正常生产UI可在`npm run build`并服务dist后，以`SCENEWEAVE_PRODUCTION_URL=http://127.0.0.1:4173/sceneweave/#home node tools/u1a-production-smoke.mjs`运行；默认Chrome与输出路径见脚本。这些是功能/存储/导航证据，不是正式性能矩阵。实际批次与失败归docs/38。


2026-10-23 用户最新要求：先进行需求开发和简单测试，完整回归由用户后续明确通知后统一执行。开发切片只做必要的类型/构建检查与少量定向验证，不默认启动全量单元、全量浏览器、长时间专项或大规模证据归档。已运行的结果和失败现场保留；尚未复验的修正明确列为待验证，不据此宣布完整验收或性能通过。


U1b开发期仅小范围检查：`npx vitest run src/editor/workspace/layout-preferences.test.ts src/editor/v2/viewport.test.ts --maxWorkers=1`、`npm run build`与`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/u1b-layout.spec.ts`（两条冒烟）。完整单元/浏览器/联合与性能矩阵等用户通知后统一执行，实际范围及待办见docs/39。

### U2a/U2b（2026-10-23）

U2定向检查可运行 `npm test -- --run src/catalog/content.test.ts src/catalog/repository.test.ts src/catalog/backup.test.ts src/catalog/organization.test.ts src/catalog/query.test.ts`；两项简单界面旅程为 `npx playwright test tests/u2-catalog.spec.ts --project=chromium`。本批只运行必要的定向检查、类型/正常构建和少量Chrome冒烟，不启动完整回归/性能矩阵；完整回归等用户通知。严格独立目录合同见docs/40，实现证据与未覆盖项见docs/41。

## 0.2.0-m1-d2全量自动化回归

用户2026-10-23明确启动本次全量；实际批次、失败与修正、覆盖和人工/性能边界见[44](docs/44-full-regression-validation.md)。1123全量单元通过，203项Chrome完整首轮200通过/3旧测试合同失败，相关三个文件14/14复验通过；产品源码未改变，未混写为一轮203项全绿。新U2真实私密库/派生/空库离线4K及两页CAS用例在`tests/u2-catalog-regression.spec.ts`，随完整`npm run test:e2e`运行。正常生产U1工具按右下“对象”导航，并等待实际缩放完成后记录Home继续基线。窄屏首页以单DOM与实际分段滚动核对；一次fullPage重复拼接及等待后最终正常图均保留，详44，P3、人工矩阵与正式性能仍单独验收。

## 证据归档与资料体量

现状和候选见[46](docs/46-validation-retention-audit.md)。普通Git保留测试/必要夹具、简短结论、失败及修正、环境/命令/源码指纹、紧凑结果与关键附件。新批次沿用`tools/testing/compact-reporter.mjs`，避免base64附件内嵌大JSON和重复源码/dist全量快照；未保留附件如实标记。

2026-10-23用户随后明确要求清理work/与docs/evidence/，现已删除两个目录。B5 manifest与四个原始包按原字节保存在tests/fixtures/performance-b5，以上复现命令已更新；其余原始附件未另建大包备份，报告已标注可用性。新运行仍可在work/生成被忽略的紧凑结果，docs/evidence/也已忽略，按需清理，不默认提交大附件。删除当前文件不缩减Git历史，本轮不重写历史；测试随统一v1迁移与去重，不按行数删除行为保障。
