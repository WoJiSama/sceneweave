# 贡献说明

织境 · Sceneweave 当前 M0 几何版原型首轮验证完成。领域内核、画布编辑、保存与双受众输出已有实现；完整编辑器、AI 与真实小团验证仍按[路线图](docs/07-roadmap.md)推进。

室内/室外路线按M1-A/B/C/D推进。B1完整素材工程证据见[17](docs/17-m1b-b1-validation.md)；B2新增VIS-01、原创室内素材、有限原子编辑和共用预览/PNG，证据见[18](docs/18-m1b-b2-validation.md)。[视觉规范](docs/14-visual-and-asset-system.md)、[素材清单](docs/15-m1a-asset-production-list.md)与[交接](docs/16-m1a-handoff.md)给出主定义。B3室外样板、散布与有限通行证据见[19](docs/19-m1b-b3-validation.md)；B4完整性诊断、三组48格受众配对和双样板存档/失败矩阵见[20](docs/20-m1b-b4-validation.md)。B5真实负载/资源观测、预算与限制见[21](docs/21-m1b-b5-validation.md)，下一入口M1-C手工工具与组件库，滚动周计划及投入假设见07。完整M1、主题P3、SCN-04与全交互性能仍待完成；新模型同步格式、迁移和验收。

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

Vitest 运行 `src/**/*.test.ts` 中的领域、存储、工程文件及渲染测试；Playwright 使用 `tests/` 下的浏览器旅程，会按配置启动本地服务或复用已有同端口服务。默认安装并使用 Playwright Chromium。系统 Chrome 可用时也可运行：

```sh
SCENEWEAVE_BROWSER_CHANNEL=chrome npm run test:e2e
```

测试使用独立 profile/浏览器上下文。M0历史在系统 Chrome 上通过 13 个浏览器测试，另有 95 个单元测试（8 文件）、构建与生产依赖审计通过，见 [M0 验证报告](docs/13-m0-validation.md)。B1当前检查、环境和未测范围另见[17](docs/17-m1b-b1-validation.md)。构建、单元和浏览器证据分别记录。

生产构建在 dist/；可使用 `npm run preview` 在本地检查构建结果。当前没有云部署或正式发布流程。

## B5性能复现

当前v2素材预览/PNG使用原生Canvas2D，M0几何工坊使用Konva。B5采用独立生产工具入口，复用实际AssetCanvas、Workspace、样板候选守卫、资源校验和仓库；正常 `npm run build` 只构建应用，不暴露专用性能API。

```sh
npm run build:performance
npm run perf:b5
```

专用产物位于 `dist-performance/`，运行器自行创建仅绑定回环地址的临时服务，输出默认保存在 `performance-results/b5/`。运行器默认使用系统Chrome，每个VIS-01/02的500/2000物件组合分别启动三个独立浏览器进程；每轮执行30次物件编辑、30次轮廓编辑与60次真实指针选择，并记录导入、保存、重开和双受众4K。统计窗口、缓存状态、各项测量边界和未覆盖操作以[21](docs/21-m1b-b5-validation.md)为准。

现有RSS采样使用macOS `/bin/ps` 的进程树与单位约定，完整复现目前仅支持macOS；Linux/Windows的资源采集尚未适配。系统需已安装Chrome，仅安装Playwright Chromium不提供默认Chrome通道。所有正式测量串行运行，期间不并行运行单元/浏览器测试、构建或其他性能任务；macOS运行器使用本次命令范围内的防空闲休眠，不修改系统电源设置。

重测可用 `npm run perf:b5 -- --output performance-results/b5-recheck` 指定新目录，保留旧原始数据。少于默认轮数或操作数的运行仅作诊断，不替代正式采集；每类30次编辑的p95仍须连同样本数和各轮差异解读。进程树RSS和目标JS堆都是采样观测，不是完整浏览器/GPU物理峰值；Canvas提交、画布复制和双rAF显示调度近似值也须分别报告，不能把它们直接写成全部交互已达目标。

## 修改流程

先读 [AGENTS.md](AGENTS.md) 与[文档导航](docs/README.md)，核对工作区和 Git 状态，保留无关修改。较小澄清直接改主文档；范围或数据契约变化同时更新[决策记录](docs/11-decisions-and-open-questions.md)及对应任务/验收。PR 说明具体问题、修改后的行为、相关验证与实际限制。

- 持久修改走领域命令和原子校验，不直接改冻结的 SceneHistory.document 或画布节点。
- 保存完整 SceneDocument；保留整数毫米、共享墙、门附着和单调 revision。
- 锁、候选失败、撤销与跨标签冲突不能以局部成功或最后写入覆盖处理。
- 玩家预览、图层列表与 PNG 共用过滤规则，秘密像素和文本都纳入回归。
- 实现只接受声明支持的范围；尚未实现的硬约束应报错，不能省略后继续保存。

按改动运行相关验证。几何、事务、导入或保存协议变化需覆盖对应负例；浏览器交互变化需核查受影响旅程。仅文档修改检查链接、术语与事实即可，不为低影响可逆改动添加镜像实现的测试。

## 当前适合的贡献

- 用具体备团场景说明需求与卡点，注明规则体系、地图尺度和输出去向。
- 复核 M0 的共享结构、异常恢复、保密输出和可复现负载，补充真实证据。
- 按 M1-A/B/C/D 完善视觉规范、双样板、手工绘图、真实素材与组件，先用样板测量再扩展工具。
- M2 的 AI 使用已入库目录生成布局/布景；新素材生成按可选 A1 独立实施，不能把候选图片直接当成已审核组件。
- 修正文档矛盾与含糊定义，附上来源或可复核的最小例子。

文档以中文为主，实体/字段名使用约定英文。新默认值要说明是产品偏好还是官方规则，并保留版本与来源。VIS-01/02首轮结果见[18](docs/18-m1b-b2-validation.md)/[19](docs/19-m1b-b3-validation.md)，B5技术观测见[21](docs/21-m1b-b5-validation.md)；其他浏览器、真实配额耗尽、完整主题P3、完整SCN-01/02/03/04与全交互性能尚未验证。不能由程序符号、单样板或有限支持操作推定完整通过。后续另建验证记录，保留13/17/18/19/20与各自原始证据。

## 内容与许可

原创贡献按本仓库 [MIT 许可](LICENSE)提供；第三方素材和规则标明各自来源与许可。请勿提交官方规则书全文、商业模组、API Key、个人聊天、私密工程或未授权素材。使用原创最小例子说明问题。

参考项目代码的 GPL/AGPL 义务不能用换语言或改文件名消除；拟复用前先说明兼容安排。有关规则、素材与生成内容的边界见[许可文档](docs/10-rules-assets-and-licensing.md)。提交前核查文档链接、许可与秘密数据，只提交本次明确相关的文件。
