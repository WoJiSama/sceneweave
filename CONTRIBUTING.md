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

原生定向入口位于`src/application/workspace`、`src/editor/main`、`src/editor/native-canvas`、`src/platform/browser/render`及新主库的历史包/原件测试。真实浏览器可定向运行`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m20f-ui.spec.ts tests/m20f-render.spec.ts tests/m20f-entry.spec.ts --reporter=line`，检查混合主会话/目录、实际GM/player 4K逐RGBA对照及完整v1所选历史包的独立导入；旧转换UI旅程不再执行。每次修改按实际范围验证，不将52的旧批次当作当前结果。

Vitest 运行 `src/**/*.test.ts` 中的领域、存储、工程文件及渲染测试；Playwright 使用 `tests/` 下保留的浏览器旅程，会按配置启动本地服务或复用已有同端口服务。旧整页UI用例已退休，当前工作区与M2旅程继续执行，旧领域/IO的API用例按依赖保留，完整范围及退休清单见[tests/README](tests/README.md)。默认安装并使用 Playwright Chromium。系统 Chrome 可用时也可运行：

```sh
SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e
```

测试使用独立profile/浏览器上下文；当前范围见[测试导航](tests/README.md)，实际结果归对应[历史台账](docs/archive/README.md)，验收要求归[质量计划](docs/09-quality-plan.md#acceptance)。退休UI脚本和旧批次数字不能作为当前通过证明。

生产构建在 dist/；可使用 `npm run preview` 在本地检查构建结果。[GitHub Pages 工作流](.github/workflows/deploy.yml)在推送 main 或手动触发时，读取 `.nvmrc` 安装 Node，执行 `npm ci` 和 `npm run build` 后部署静态站点至[在线预览](https://wojisama.github.io/sceneweave/)。该工作流只负责构建和部署，不代替上述单元/浏览器验证；成功结果以 GitHub Actions 运行记录为准。它不包含 AI 网关、工程云同步或正式发行版流程。

## M2-1本地任务服务

使用`.nvmrc`指定的Node版本。Node/Hono服务提供流式对话和隔离草稿，协议、工具、预算与保留期归[AI合同](docs/05-ai-and-generation.md)。`node:sqlite`在该Node版本仍有experimental提示。服务单实例独占一个数据目录，主工程与个人素材仍在浏览器。

首次配置且`.env.ai`不存在时，将`.env.example`复制为`.env.ai`并设为0600，在文件里填写`SCENEWEAVE_AI_PROVIDER_BASE_URL`、`PROVIDER_API_KEY`、`PROVIDER_MODEL`及独立随机`SCENEWEAVE_AI_ACCESS_TOKEN`（所有变量均带`SCENEWEAVE_AI_`前缀）。可选`SCENEWEAVE_AI_PROVIDER_VISION_MODEL`固定视觉模型，未填时沿用文字模型；完整请求历史含图片时选择视觉模型，带图历史的后续答仍走该模型。连接信息会显示实际配置，前端不能修改provider模型。后端默认127.0.0.1:8787、数据根local-data/ai；允许Origin必须精确到协议/主机/端口，不含Pages路径。保留现有配置，不盲目覆盖；真实配置被Git忽略，provider key不能使用VITE_前缀。

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

协议与领域结果指纹见[04](docs/04-scene-document.md#program-base-map-protocol)，真实资源物化和最终采用仍在本机。默认新生成@2可在确切物化后选择“继续用AI修改底图”；服务先协商版本及policyHash，旧@1保持原256会话回执且不能补造接续来源。G/A分账、完整来源/账本、执行消耗和当前拒绝边界归[05](docs/05-ai-and-generation.md#budget-continuation-contract)，线上旧后端须更新后才能使用新能力，本轮本地实现不代表已部署。

必要定向检查串行运行：

```sh
npx vitest run src/shared/ai/continuation.test.ts src/shared/terrain-generation/base-map.test.ts src/platform/browser/terrain-generation/base-map-client.test.ts src/application/workspace/base-map.test.ts src/application/workspace/base-map-clock.test.ts --maxWorkers=1 --testTimeout=30000
npx vitest run --config vitest.ai.config.ts services/ai/continuation.test.ts services/ai/execution-checkpoint.test.ts services/ai/base-map.test.ts services/ai/app.test.ts services/ai/authoring-tool-catalog.test.ts --maxWorkers=1 --testTimeout=30000
SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/base-map.spec.ts tests/base-map-continuation.spec.ts --reporter=line
```

浏览器用例启动隔离Hono/SQLite/SSE服务并使用确定性provider，不读`.env.ai`或发送付费请求；底图生成本身模型/新增任务数为0，接续用例检查真实Worker、资源像素、保护CAS、一次采用/撤销、冷读和完整包/双受众PNG。真实模型质量与正式验收另行冻结执行。

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
