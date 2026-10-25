# 贡献说明

织境 · Sceneweave 本地版本号仍为 `0.2.0-m1-d2`，当前唯一产品主路径为完整v1、原生Workspace/Canvas/Workbench及sceneweave-projects、sceneweave-library。按用户2026-10-25决定，删除旧整页工作台、首页旧版本发现和旧格式保全/转换入口；工程导入仅接收完整v1当前包与所选历史包。现有新库schema、历史与确切来源原件保全语义保持，旧领域/IO模块按真实依赖保留，不构成旧版产品支持。此次裁剪后的检查另按05/09登记，不能沿用既有结果。

M2-0f当时的混合编辑/有限恢复、备份、普通样板双受众4K逐RGBA和旧库UI保全转换子项归[52](docs/52-m20f-native-workspace-validation.md)；a至e历史归48至51。M2-1本地后端/流式文本及只读工具续答已完成（05），M2-2隔离草稿/保护采用已扩展至M2-3场景工具及M2-4受限SVG/渐进同化，M2-5服务器容器及受信任IP HTTPS已部署，Pages公开地址已配置，必要线上创作/采用/保存导出旅程已通过，见05第15节；用户已要求本轮回归和commit/push（排除todo.md），现行结果集中05/09。2026-10-25用户进一步要求完成M2实际使用验收与修复，并恢复此前后置的性能验收；新主路径正式性能已完成四组×三轮，但普通编辑100ms门槛未通过，完整M1、现行范围QA-AI-16与性能门仍分别保持开放，细节见[34](docs/34-performance-followup.md)。

室内/室外路线按M1-A/B/C/D推进。B1完整素材工程证据见[17](docs/17-m1b-b1-validation.md)；B2新增VIS-01、原创室内素材、有限原子编辑和共用预览/PNG，证据见[18](docs/18-m1b-b2-validation.md)。[视觉规范](docs/14-visual-and-asset-system.md)、[素材清单](docs/15-m1a-asset-production-list.md)与[交接](docs/16-m1a-handoff.md)给出主定义。B3室外样板、散布与有限通行证据见[19](docs/19-m1b-b3-validation.md)；B4完整性诊断、三组48格受众配对和双样板存档/失败矩阵见[20](docs/20-m1b-b4-validation.md)。B5真实负载/资源观测、预算与限制见[21](docs/21-m1b-b5-validation.md)，C0性能与视口基础见[22](docs/22-m1c-c0-validation.md)。C1a空白创作的实现范围和本批检查见[23](docs/23-m1c-c1a-validation.md)，C1b适用检查见[24](docs/24-m1c-c1b-validation.md)，选择性能及C1c图层实现验证见[25](docs/25-selection-performance.md)/[26](docs/26-m1c-c1c-validation.md)，C1d命名快照/首批独立物件局部恢复与完整历史工程见[27](docs/27-m1c-c1d-validation.md)，C2建筑工具及会话内结构恢复见[28](docs/28-m1c-c2-validation.md)，C3组件与参数外观见[29](docs/29-m1c-c3-validation.md)，C4室外工具与有限恢复见[31](docs/31-m1c-c4-validation.md)，C5联合验证和现版性能结论归[32](docs/32-m1c-c5-validation.md)。完整M1、主题P3、SCN-04与全交互性能仍按各自门槛判断；新模型同步格式、迁移和验收。

当前默认首页为`/#home`，完整创作入口为`/#workspace`，包含工程、建筑、素材库、室外及图层/对象/历史；其他hash统一回首页，离开工作区仍检查未保存内容。完整v1空白工程保留23个物件、11种材质和3种组合预装策略，画布/坐标放置使用显式支撑和暂态预览。主路径由editor/main、editor/native-canvas、application/workspace及新platform适配构成，共用shared，不经旧core/io/render视图往返；实际资源/派生像素、许可、锁、256预算、单调revision和CAS保持。当前/所选历史包导入整体安装为新owner/r0，旧格式和迁移set明确拒绝，失败或取消不替换当前工程。建筑恢复仍要求本会话witness，持久身份限明确支持的物件/组合/室外范围，现行契约见04/06，历史边界见28/29/31和52。

C5联合验收批次冻结349份应用源码，最终单元82文件979/979通过（68.85秒），正常构建通过（2.75秒）；最终全量Chrome168/168通过，0失败/重试/跳过（12.8分钟）；最终正常生产UI通过（46.791秒）；study/island×500/2000各三轮正式性能矩阵未完成，已执行批次未形成可合并的完整p95结果。优化后study-500单次诊断普通领域提交1110.4ms，优化前诊断2174.2ms，均不是正式分布且仍超100ms；性能门未通过，本批不能宣布C5或全交互性能通过，实际证据与待验项见[32](docs/32-m1c-c5-validation.md)。

其后资源复用批次通过992项单元、20项适用Chrome及正常构建/生产UI，独立诊断归[33](docs/33-c5-resource-reuse-validation.md)。2026-10-23用户曾要求将余下性能优化暂缓；2026-10-25已恢复本轮验收，按当前新完整v1主路径重新采集并完成四组×三轮；结果见[34](docs/34-performance-followup.md)，功能正确性回归与性能指标分开判断。性能门仍未通过，不作容量承诺。

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

共享内核可单独运行`npm run check:shared`：AST依赖边界、无DOM/无Node类型编译、真实Node原生ESM命令/身份/投影及当前/历史ZIP往返，临时发射目录自动清理。保留的兼容模块API测试用于领域/存储依赖及既有来源记录，不能据此宣称产品支持旧版导入或转换；M2-0b至f当批命令与数字分别见[48](docs/48-m20b-shared-core-validation.md)至[52](docs/52-m20f-native-workspace-validation.md)。

原生定向入口位于`src/application/workspace`、`src/editor/main`、`src/editor/native-canvas`、`src/platform/browser/render`及新主库的历史包/原件测试。真实浏览器可定向运行`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20f-ui.spec.ts tests/m20f-render.spec.ts tests/m20f-entry.spec.ts --reporter=line`，检查混合主会话/目录、实际GM/player 4K逐RGBA对照及完整v1所选历史包的独立导入；旧转换UI旅程不再执行。每次修改按实际范围验证，不将52的旧批次当作当前结果。

Vitest 运行 `src/**/*.test.ts` 中的领域、存储、工程文件及渲染测试；Playwright 使用 `tests/` 下保留的浏览器旅程，会按配置启动本地服务或复用已有同端口服务。旧整页UI用例已退休，当前工作区与M2旅程继续执行，旧领域/IO的API用例按依赖保留，完整范围及退休清单见[tests/README](tests/README.md)。默认安装并使用 Playwright Chromium。系统 Chrome 可用时也可运行：

```sh
SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e
```

测试使用独立 profile/浏览器上下文。M0历史在系统Chrome上通过13个浏览器测试，另有95个单元测试（8文件）、构建与生产依赖审计通过，见[M0验证报告](docs/13-m0-validation.md)。B1历史环境和未测范围见[17](docs/17-m1b-b1-validation.md)，C1a/C1b历史批次见[23](docs/23-m1c-c1a-validation.md)/[24](docs/24-m1c-c1b-validation.md)。这些数字及退休UI脚本只描述历史版本，不要求当前恢复旧工作台。构建、单元和浏览器证据分别记录，当前运行结果集中05/09。

生产构建在 dist/；可使用 `npm run preview` 在本地检查构建结果。[GitHub Pages 工作流](.github/workflows/deploy.yml)在推送 main 或手动触发时，读取 `.nvmrc` 安装 Node，执行 `npm ci` 和 `npm run build` 后部署静态站点至[在线预览](https://wojisama.github.io/sceneweave/)。该工作流只负责构建和部署，不代替上述单元/浏览器验证；成功结果以 GitHub Actions 运行记录为准。它不包含 AI 网关、工程云同步或正式发行版流程。

## M2-1本地任务服务

使用`.nvmrc`的Node24.14.1。本地Node/Hono服务、只读对话工具及M2-2独立物件草稿已经实现，协议、预算/保留期和实际结果集中[05第11节](docs/05-ai-and-generation.md#11-m2-1连接与任务协议2026-10-24实施合同)。`node:sqlite`在本批Node仍有experimental提示；未声明其他Node版本通过。服务单实例独占一个数据目录，主工程/个人素材仍在浏览器。

首次配置且`.env.ai`不存在时，将`.env.example`复制为`.env.ai`并设为0600，在文件里填写`SCENEWEAVE_AI_PROVIDER_BASE_URL`、`PROVIDER_API_KEY`、`PROVIDER_MODEL`及独立随机`SCENEWEAVE_AI_ACCESS_TOKEN`（所有变量均带`SCENEWEAVE_AI_`前缀）。后端默认127.0.0.1:8787、数据根local-data/ai；允许Origin必须精确到协议/主机/端口，不含Pages路径。保留现有配置，不盲目覆盖；真实配置被Git忽略，provider key不能使用VITE_前缀。

```sh
npm run ai:build
npm run ai:start
```

另一个终端运行`npm run dev`。在统一工作区“AI对话”填写后端地址和`.env.ai`中的应用访问凭据，点击连接；页面不填写provider key。应用凭据仅本次页面内存，刷新后重新输入；模型/地址由服务器固定。生产前端可通过`VITE_SCENEWEAVE_AI_URL`设置公开后端origin；M2-5已部署[公网HTTPS后端](https://124.223.95.142)，[Pages前端](https://wojisama.github.io/sceneweave/)已预填该地址，必要线上创作/采用/保存导出旅程已通过，详05第15节。使用127.0.0.1与localhost时需分别配置准确Origin。

```sh
npm run ai:test
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m21-ai-conversation.spec.ts tests/m22-ai-authoring.spec.ts --reporter=line
```

草稿操作前先在产品内明确授权对象、允许操作、固定素材与支撑范围，并同意两层元数据发送范围。任务不会直接改主工程；等待本机实际资源校验、审阅差异后，才保护当前并一次采用。重新绑定/查询只读取任务，明确继续才再次调用模型。完整合同与结果见[05第12节](docs/05-ai-and-generation.md#12-m2-2-技能与独立物件草稿2026-10-24实施合同)。

ai:test覆盖共享草稿/后端/provider/客户端；本机原子采用另运行`npx vitest run src/application/workspace/atomic.test.ts src/application/workspace/workspace.test.ts src/platform/browser/storage/repository.test.ts --maxWorkers=1`。Chrome使用真实HTTP/SSE/SQLite和受控模型替身，普通测试不调用真实模型。`npm run build`和typecheck也检查服务类型；ai:build另输出被忽略的dist-ai。确需验证真实渠道时，在编译后明确运行`node --env-file=.env.ai tools/testing/ai-provider-probe.mjs`；默认三次请求测文字和工具续答，`--interrupt-and-error`另测首段后中止及坏凭据，可能产生模型费用且无自动重试。探针不输出密钥/正文；用`--out`保存到新系统临时路径，不归档大报告。

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

Pages 工作流读取 GitHub 仓库 Actions 变量`VITE_SCENEWEAVE_AI_URL`作为公开后端Origin，并在构建前拒绝 HTTP、路径、查询、片段或凭据。**HTTPS Pages 无法调用公网 HTTP 后端**，浏览器会阻止这类混合内容；CORS 配置不能解除该限制。容器内的 HTTP 转发不影响浏览器对公网 HTTPS 的要求。证书签发并实际验证后，将仓库变量设为`https://ai.example.com`或`https://实际公网IP`，再手动运行或推送触发 Pages 工作流。只有设置该变量后，线上前端才会预填后端地址；凭据仍由使用者在页面内存中输入。工作流不读取服务器`.env.ai.production`，不会把应用令牌或 provider key 放进静态产物。检查命令中的示例域名/IP也应替换成实际部署地址。当前仓库变量已设为`VITE_SCENEWEAVE_AI_URL=https://124.223.95.142`，[Pages工作流40113648232](https://github.com/WoJiSama/sceneweave/actions/runs/40113648232)成功，前端地址为[https://wojisama.github.io/sceneweave/](https://wojisama.github.io/sceneweave/)。

2026-10-25实际部署：服务器 Docker 镜像构建、非 root/只读容器内部健康通过；初次公网 TCP 443 超时后，云侧已放行，当前[HTTPS健康端点](https://124.223.95.142/healthz)返回200。受信任证书由 Let's Encrypt YE2 签发，SAN 为`IP Address:124.223.95.142`，本次有效期为`2026-10-24T15:54:28Z`至`2026-10-31T07:54:27Z`（以UTC记录，非固定续期时间）。Node默认信任验证/TLS1.3、缺凭据401、错误Origin403和Pages精确Origin的GET/POST/DELETE预检204已通过；经SSH的单次真实模型流/断线回读/幂等1请求、重启检查点/取消/备份还原及合成7日清理结果见[05第15节](docs/05-ai-and-generation.md)。公网HTTPS及静态Pages地址现已可用，实际Pages中的真实模型场景/SVG→草稿校验→保护一次采用→本机保存→完整包/4K PNG/重开必要旅程通过；9请求、44展开、43条完整包hash正确，0页面错误。公网SSE断流续读、任务归属隔离及重启保全/合成取消也通过；完整私密/两批扩围和自由创作质量仍单独验收。

## 当前主路径回归

旧整页工作台及旧转换UI已删除，默认Playwright套件执行当前完整v1/M2旅程和仍保留的底层API用例；退休UI文件及原因见[tests/README](tests/README.md)。旧203项Chrome结果和此前首页交付39项结果都保留为历史，不能直接证明当前改动通过。用户已明确要求完成M2收尾后全量回归，按当批源码运行：

```sh
npm test -- --maxWorkers=1
npm run ai:test
npm run typecheck
npm run check:shared
npm run ai:build
npm run build
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test --workers=1 --reporter=line
```

本轮同化与失败草稿恢复使用默认Playwright配置和确定性provider，经过真实HTTP/SSE、SQLite、IndexedDB与Canvas，不调用付费模型。单件→固定组合→两个新基线明确范围，以及请求上限后的有效草稿备份/重绑/审阅/保护采用分别由下列专项复现：

```sh
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m2-assimilation-acceptance.spec.ts tests/m2-failed-draft-recovery.spec.ts --workers=1 --reporter=line
```

三引擎联合验收使用专用串行配置，须先安装对应Playwright浏览器；该配置固定使用Playwright Chromium、Firefox和WebKit，`SCENEWEAVE_BROWSER_CHANNEL=chrome`不改变其中的Chromium项目。默认输出在被忽略的`test-results/m2-joint`，可用`SCENEWEAVE_JOINT_OUTPUT`指定独立输出目录：

```sh
npx playwright install chromium firefox webkit
npx playwright test --config=tests/m2-joint-playwright.config.ts --workers=1
```

默认配置与专用配置均可启动或复用`127.0.0.1:5173`开发服务；使用已启动的同版开发服务时可设置`SCENEWEAVE_TEST_BASE_URL`。这些专项包含开发模块入口，不能直接把生产`dist`地址当作等价入口。冻结源码后再运行，分别保留失败与复验结果；命令说明不代表已经执行，测试不得与正式性能测量并行。

首页图片刷新使用`node tools/build-home-showcase.mjs`，从真实完整样板原生渲染六图并记录源/PNG/像素hash。火山新增独立热裂版本使用`node tools/build-themed-art.mjs --lava-hot`及`node tools/build-volcano-variant.mjs`；旧lava v1源/图/manifest保留，已存在固定ID不同字节时拒绝覆盖。必要线上AI旅程见05第15节；本轮实际使用与失败修复的适用结果见[05第17节](docs/05-ai-and-generation.md#17-2026-10-25-m2实际使用验收与修复)及09：确定性单件/组合/两批范围、三引擎四个完整v1秘密配对的实际4K、保存失败/CAS/迁移/离线与390px，以及Chromium隔离origin真实配额和原生200%等子项已有通过证据。Firefox/WebKit的Chromium专属配额override和原生缩放两项为不适用跳过；未覆盖秘密/输入矩阵、默认设备容量/真实磁盘满、Firefox/WebKit配额、其他浏览器原生200%、完整无引导SCN、真实模型风格与用户P3仍分别验收。修复提交`887aad9`已由[Pages工作流40142916372](https://github.com/WoJiSama/sceneweave/actions/runs/40142916372)发布并完成公网复测；正式性能方法、实际结果和剩余边界集中于[34](docs/34-performance-followup.md)，不预填本轮通过结论。

## 当前原生样板加载诊断

2026-10-24按用户授权修复的范围及前后结果集中在[34](docs/34-performance-followup.md#2026-10-24原生完整v1样板加载修复)，不新增逐批验收报告。必要定向入口为`npx vitest run src/application/workspace src/platform/browser/content src/platform/browser/storage src/editor/main/*.test.ts src/platform/browser/render --maxWorkers=1`及`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/sample-loading.spec.ts tests/m20f-ui.spec.ts tests/m20f-entry.spec.ts tests/m20f-render.spec.ts --reporter=line`；本批结果分两批Chrome运行，不等同完整回归。

诊断使用正常`npm run build`，先在一个终端执行`npm run preview -- --port 5174`，再在另一终端逐条运行下列命令；期间不并行测试、构建或其他浏览器负载。输出使用新的系统临时目录：

```sh
sample_load_dir=$(mktemp -d "${TMPDIR:-/tmp/}sceneweave-sample-load.XXXXXX")
node tools/testing/sample-load-diagnostic.mjs --runs 2 --out "$sample_load_dir/local.json"
node tools/testing/sample-load-diagnostic.mjs --runs 1 --samples study --delay-ms 80 --out "$sample_load_dir/delay.json"
```

工具默认真实`http://127.0.0.1:5174/sceneweave/`页面，系统Chrome独立上下文，不启用应用调试API；每个上下文首次/回首页再次打开各一次。记录点击至确认、采用至保存/画布就绪代理、PNG读取调用、位图创建及长任务，等待本次后台活动稳定再计数。`--delay-ms`仅模拟每次PNG请求的延迟，路由会禁用HTTP缓存，不能当作GitHub Pages实测；低次数结果不产生正式p95/通过结论。没有长期位图缓存或Worker，本批不替代下述历史矩阵，也不重建work/evidence。

## M2 原生完整v1正常生产性能复现

本轮使用`tools/performance/run-native-m2.mjs`，从正常`npm run build`产物的`/sceneweave/#home`进入同一原生完整v1工作区，不使用B5专用构建、旧v6入口或产品开发API。先完成受测功能修改与正确性验证，再冻结源码、构建和运行器；下列命令依次执行，采样期间不运行其他浏览器、单元/浏览器测试、构建或性能任务。系统须已安装Chrome；当前进程树RSS采样仅适配macOS。运行器使用独立回环HTTP服务和新Chrome进程/profile，拦截站外网络，不调用模型；macOS防空闲休眠仅在命令存活期间生效。

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

`manifest.json`及每轮结果记录Node、操作系统、CPU/逻辑核数、内存、Chrome版本、1512×982/DPR1视口和实际命令参数，并记录源码、构建输入、dist与运行器SHA256及采样前后未变核对。每轮原始输入/事务/LongTask、独立资源记录和CPU诊断文件保留，成功完成后自动写`summary.json`。RSS目标间隔100ms、目标页JS堆200ms，报告真实间隔、阶段、边界样本及采样错误；RSS可能重复共享页，JS堆不含完整浏览器/GPU，二者均非物理峰值。双rAF不是GPU或屏幕呈现完成；HTTP缓存关闭但不清系统缓存，不宣称50×50显示网格、自由拖拽或完整QA-PERF-04通过。输出目录必须为空且独立于原夹具，失败、取消与慢样本保留，修正后另开目录重跑。方法说明不是运行结果，本轮实际结果、失败修正、证据路径和剩余边界以[34后续记录](docs/34-performance-followup.md)为准。

## 历史性能与旧工作台记录

B5/C0的专用构建、旧`assets/layers`工作台选择测量及C1c至C2浏览器命令属于退休前的历史方法。旧UI脚本不再作为当前站点的运行入口，不能用旧结果替代完整v1的性能或回归证据；旧页面相关用例按[tests/README](tests/README.md)退休。B5完整负载、设备/资源口径和失败限制见[21](docs/21-m1b-b5-validation.md)，C0见[22](docs/22-m1c-c0-validation.md)，选择及native v3对照见[25](docs/25-selection-performance.md)/[26](docs/26-m1c-c1c-validation.md)，历史/建筑工具见[27](docs/27-m1c-c1d-validation.md)/[28](docs/28-m1c-c2-validation.md)。原始B5 manifest与四个包仍在`tests/fixtures/performance-b5`，本次不删除或改写它们。

当前完整v1性能使用上节独立运行器，正式测量仍须冻结源码、构建与运行器并串行执行；macOS进程树RSS和目标JS堆是采样观测，均非完整浏览器/GPU物理峰值。低次数、少轮次、带CPU profile的诊断不能混入正式分布，双rAF仅是显示调度代理。实际结果和未通过门槛继续归[34](docs/34-performance-followup.md)，本次入口删除不重认定旧结果。

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

## M1与U1/U2历史开发记录

C3/C4/C5旧组件、室外工作台及其迁移、原件链、CAS和双受众验证均为历史批次；当前产品不提供`/#composition`、`/#outdoor`或逐级升级入口。各批完整格式与实际证据仍见[29](docs/29-m1c-c3-validation.md)、[31](docs/31-m1c-c4-validation.md)、[32](docs/32-m1c-c5-validation.md)，不重写为完整v1当前结果。仍使用的源链、固定定义、许可、锁和单调事务语义由当前04/06承接。

M1-D海岸哨所首批历史见[35](docs/35-m1d-outpost-validation.md)，当前从首页样板详情进入原生完整v1工作区。`tools/build-outpost-art.mjs`只重建新增原创包，源SVG、manifest与许可位于`assets/sceneweave-handdrawn-outpost/`，静态PNG位于对应`public/assets/`；既有固定包不原位改义。当前内容简单流程由`tests/content-m1d-simple.spec.ts`覆盖，历史旧UI脚本已退休。

U1a当时保留旧几何原型及多代工作台深链接的安排已经结束；当前只提供`/#home`和`/#workspace`，未知hash经过未保存守卫后回首页。U1a/U1b当批实际结果和简单检查边界分别保留于[38](docs/38-u1a-workspace-validation.md)/[39](docs/39-u1b-layout-validation.md)。当前工作区/布局旅程为`tests/u1a-workspace.spec.ts`和`tests/u1b-layout.spec.ts`，保留的`tools/u1a-production-smoke.mjs`仅检查当前首页与原生工作区的正常生产行为，不是正式性能矩阵。

U2个人目录的历史合同及两项初次简单检查见[40](docs/40-u2a-catalog-contract.md)/[41](docs/41-u2b-catalog-validation.md)。当前产品使用sceneweave-library和完整v1中性载体；`tests/u2-catalog.spec.ts`、`tests/u2-catalog-regression.spec.ts`及原生工作区用例仍在默认浏览器回归中，旧目录转换只保留底层模块测试，不作为产品使用流程。

2026-10-23用户曾要求开发切片只做必要定向检查；后续已明确要求M2收尾和当前版本全量回归，本轮按上节执行。普通后续切片仍根据实际改动选择相关检查，不自动扩成长时间性能专项或大规模原始证据归档。已运行的结果、失败和未复验的修正分别记录，不以局部结果宣布完整验收或性能通过。

## 0.2.0-m1-d2全量自动化回归

用户2026-10-23明确启动本次全量；实际批次、失败与修正、覆盖和人工/性能边界见[44](docs/44-full-regression-validation.md)。1123全量单元通过，203项Chrome完整首轮200通过/3旧测试合同失败，相关三个文件14/14复验通过；产品源码未改变，未混写为一轮203项全绿。新U2真实私密库/派生/空库离线4K及两页CAS用例在`tests/u2-catalog-regression.spec.ts`，随完整`npm run test:e2e`运行。正常生产U1工具按右下“对象”导航，并等待实际缩放完成后记录Home继续基线。窄屏首页以单DOM与实际分段滚动核对；一次fullPage重复拼接及等待后最终正常图均保留，详44，P3、人工矩阵与正式性能仍单独验收。

## 证据归档与资料体量

现状和候选见[46](docs/46-validation-retention-audit.md)。普通Git保留测试/必要夹具、简短结论、失败及修正、环境/命令/源码指纹、紧凑结果与关键附件。新批次沿用`tools/testing/compact-reporter.mjs`，避免base64附件内嵌大JSON和重复源码/dist全量快照；未保留附件如实标记。

2026-10-23用户随后明确要求清理work/与docs/evidence/，现已删除两个目录。B5 manifest与四个原始包按原字节保存在tests/fixtures/performance-b5，以上复现命令已更新；其余原始附件未另建大包备份，报告已标注可用性。新运行使用被忽略的`test-results/`或独立系统临时目录，不重建work/与docs/evidence/，按需清理，不默认提交大附件。删除当前文件不缩减Git历史，本轮不重写历史；测试随统一v1迁移与去重，不按行数删除行为保障。
