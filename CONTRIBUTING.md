# 运行与贡献

先读[协作约定](AGENTS.md)。已实现能力归[功能清单](docs/completed.md)，剩余工作归[roadmap](docs/roadmap.md)，不再维护逐次完成报告。

## 本地开发

建议使用`.nvmrc`中的Node.js 24，依赖由`package-lock.json`锁定：

```sh
npm ci
npm run dev
```

默认地址为`http://127.0.0.1:5173`。每个Origin有独立浏览器存储，换端口或清数据前先导出工程备份。

```sh
npx vitest run <相关文件>
npm run typecheck
npm run build
npx playwright install chromium
npx playwright test tests/<相关文件>.spec.ts
```

全量入口为`npm test`、`npm run ai:test`和`npm run test:e2e`。日常选择受改动影响的检查，生产旅程及环境变量见[检查方法](docs/testing.md)和[测试导航](tests/README.md)。共享层检查使用`npm run check:architecture`和`npm run check:shared`。

<a id="shared-workflows"></a>
## 共享工作流

元数据只编辑[workflows/catalog.json](workflows/catalog.json)，正文只编辑同目录Markdown的步骤段；参数schema继续归执行器。`npm run workflows:sync`更新应用投影，`npm run check:workflows`检查定义、引用和确切预览。前端构建和类型检查会运行这项检查，单独打包 AI 服务前也先核对。生成文件为`catalog.generated.ts`。

```sh
node tools/harness/sceneweave.mjs workflows
node tools/harness/sceneweave.mjs workflows --id sceneweave-forest-building --step generate
node tools/harness/sceneweave.mjs workflows --id sceneweave-forest-building --schema
node tools/harness/sceneweave.mjs workflows --id sceneweave-forest-building --effects
```

Codex 的地图和图片 Skill 从这份目录选择流程。应用及图片MCP通过`sceneweave_workflow`读取同一份步骤正文和实际宿主能力。CLI在`--id`查询时可加`--definition-hash`核对任务绑定，图片MCP的`image_import_workflow`也带相同ID、版本和摘要。目录不授予工具权限；普通应用聊天尚无图片执行工具。任务和制作包绑定真实定义摘要。换电脑时携带工作包及其`.workflow.json`伴随文件。遇到旧摘要时，用对应版本恢复，或在页面打开实际工作包并核对新版流程和输入后另起任务。

<a id="local-map-harness"></a>
## 本机地图CLI

安装Playwright Chromium后读取能力和规范example，再提交严格请求。以下绝对路径替换为实际路径，输出目录必须尚不存在且父目录存在：

```sh
node tools/harness/sceneweave.mjs capabilities
node tools/harness/sceneweave.mjs example > /absolute/existing-parent/request.json
node tools/harness/sceneweave.mjs generate --input /absolute/existing-parent/request.json --output /absolute/existing-parent/new-map --allow forest-building --budget standard
```

工具在隔离浏览器运行，输出`request.json`、`map.sceneweave`、`preview.png`和`result.json`。只有`status:complete`表示实际落盘复读、独立完整冷导入与预览像素核对通过；视觉和用户签收另判。从普通页面导入结果继续编辑，不写入用户旧库。

<a id="forest-loop-mcp"></a>
有限林中建筑循环使用`node tools/harness/forest-server.mjs --input /absolute/request.json --output /absolute/new-loop --allow forest-building --budget standard`。先发现实际state/action工具，再按当前stateHash执行。最多3次生成或指定房间修正、4次决策，需求固定、无改善停止，最终审阅保存。具体边界见[架构](docs/architecture.md#ai)。

完成一次动作后，可用 `node tools/harness/forest-server.mjs --resume /absolute/saved-loop --allow forest-building --budget standard` 按原预算档位重开。宿主核对固定请求、流程绑定、已用预算和候选文件，随后从 `sceneweave_forest_state` 读取当前可执行动作。移交时携带完整循环目录。若中断时仍有动作在途，保留原记录，并从已完成候选的 `map.sceneweave` 进入页面审阅。

<a id="image-import-mcp"></a>
<a id="image-item-workflow-tools"></a>
## 图片拆解与接续

页面从“从图片新建场景”上传、标定、拆件和审阅。图片MCP入口：

```sh
node tools/image-import/server.mjs --image /absolute/map.jpg --license-file /absolute/license.txt --attribution "实际作者与来源" --output /absolute/existing-output
```

先按实际tools/list和`image_import_workflow`发现操作，每次修改使用最新generation。页面和MCP共用[制作步骤](docs/reference/image-item-workflow.md)；原图、独立制作工作包、普通工程和个人库分别保全。外部模型必须实际具备工具与视觉能力，图片外发按本次授权。

MCP 交付目录包含 `map.sceneweave`、`preview.png`、`recipe.json` 和 `result.json`。以 `complete` 回执核对任务 ID、流程绑定、源图摘要、各文件的真实字节摘要和工程冷读结果。

<a id="legacy-svg-recovery"></a>
旧SVG恢复使用[独立工具](tools/migration/migrate-legacy-svg.mjs)，先读该脚本的`--help`并选择与原件匹配的环境，不在普通导入中改写固定源或跳过像素校验。

<a id="ai-service"></a>
## 本地AI服务

首次配置且文件不存在时，把`.env.example`复制为被忽略的`.env.ai`，填写`SCENEWEAVE_AI_PROVIDER_BASE_URL`、`SCENEWEAVE_AI_PROVIDER_API_KEY`、`SCENEWEAVE_AI_PROVIDER_MODEL`和独立随机的`SCENEWEAVE_AI_ACCESS_TOKEN`。来源白名单精确到协议/主机/端口；完整可选项见[配置源码](services/ai/config.ts)。不要覆盖已有配置，密钥不使用`VITE_`前缀。

```sh
npm run ai:build
npm run ai:start
```

默认服务`127.0.0.1:8787`，数据在`local-data/ai`，单实例独占数据目录。页面AI连接框输入后端地址和应用访问凭据，provider密钥仅在服务端；页面凭据只留当前内存。Windows使用实际NTFS权限保护凭据与私有数据，不把POSIX模式显示值当DACL证明。

普通测试采用受控响应，不产生真实模型费用。只有本次授权的真实模型检查才发provider请求，失败/unknown不自动重发。服务端密钥、完整私密提示和私人图像不进入仓库或产品日志。

## 部署AI服务与Pages

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

Pages 工作流读取 GitHub 仓库 Actions 变量`VITE_SCENEWEAVE_AI_URL`作为公开后端Origin，并在构建前拒绝 HTTP、路径、查询、片段或凭据。**HTTPS Pages 无法调用公网 HTTP 后端**，浏览器会阻止这类混合内容；CORS 配置不能解除该限制。容器内的 HTTP 转发不影响浏览器对公网 HTTPS 的要求。证书签发并实际验证后，将仓库变量设为`https://ai.example.com`或`https://实际公网IP`，再手动运行或推送触发 Pages 工作流。只有设置该变量后，线上前端才会预填后端地址；凭据仍由使用者在页面内存中输入。工作流不读取服务器`.env.ai.production`，不会把应用令牌或 provider key 放进静态产物。检查命令中的示例域名/IP也应替换成实际部署地址。实际Pages地址和后端Origin配置须在交付时核对。

证书有效期、健康状态和部署版本必须在实际交付时重新核对，不将历史200响应当作持续可用证明。

## 修改与交付

当前schema、事务、资源和玩家保密约束见[架构](docs/architecture.md)。变更时同步相关实现和必要测试；完成后只更新一条能力说明，剩余缺口集中写roadmap。临时图片/trace/性能输出放忽略的`work/`。

性能工具见[目录说明](tools/performance/README.md)，其他会话测量时不要运行竞争任务。提交、推送、部署按当前授权执行；检查素材许可和密钥/私人资料，只包含本次相关改动。
