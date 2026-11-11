# 工作区、素材库与内容历史台账

本文件汇集原始批次记录，正文中的“当前”、未通过项、发布授权和测试数字只属于各自日期及冻结。现行顺序以[路线图](../07-roadmap.md)为准；不把历史通过数拼成新验收。

- [主题作品驱动的代码与算法开发自检（2026-11-11）](#theme-driven-interior-20261111)
- [图片算法诊断与真实前端预览（2026-11-11）](#image-algorithm-diagnostics-20261111)
- [图片色边、纹理接缝与草稿保护接续（2026-11-11）](#image-quality-followup-20261111)
- [源码审查发现项整改自检（2026-11-11）](#source-review-fixes-20261111)
- [旧测试清理与必要自检（2026-11-11）](#old-test-cleanup-20261111)
- [全系统回归与中断接续（2026-11-11）](#system-regression-20261111)
- [图片分层琴房样板开发自检（2026-11-10）](#image-room-sample-20261110)
- [项目图片拆解工具与本地item开发自检（2026-11-10）](#image-import-tool-20261110)
- [图片拆解画面质量整改（2026-11-10）](#image-import-quality-20261110)

<a id="theme-driven-interior-20261111"></a>
## 主题作品驱动的代码与算法开发自检（2026-11-11）

用户要求在本会话持续制作各主题精美完整作品，并明确以创作暴露问题、持续改进项目代码和算法为重点；最后由用户审核效果。本轮先以近代调查、现代城市、奇幻城镇三类室内研究候选检验通用家具摆位，未把候选、自动检查或生成数量记为成品/P3。开发状态只归[07](../07-roadmap.md#theme-driven-development)，实际算法边界归[室内设计](../reference/general-map-generation.md#d-interior-layout)，正式验收仍归[09](../09-quality-plan.md#theme-driven-acceptance)。

两项可复现缺口为旧家具始终0°、座椅与桌面各自优先贴墙而可能分处房间两端。本批室内算法4新增有限四向姿态及先主体后座椅的邻近候选，完整旋转占地/绘制边界、支撑、100mm物理间隔、门前带与已通过路线继续检查；有同室桌面却无法邻近安置座椅时列缺项，不回退远墙孤椅。新建默认接入室内4，旧室内2/3与地形建筑1/2完整结果保留；新增地形建筑3显式映射室内4，混合3仍使用地形建筑2。工程容器仍为唯一完整v1，局部重排现存家具只改位置、保留其任意旋转与人工保护。

本机证据根为忽略目录 `work/theme-masterpieces-20261111/`。以下首个画面冻结的数据分别来自 `investigation-furnishing-review-2/result.json`、`modern-furnishing-review-2/result.json`、`fantasy-furnishing-review-2/result.json`，浏览器均为141.0.7390.37、页面异常数组为空。共同seed为 `theme-masterpieces-interior-1`，建筑范围17×13m、墙厚240mm、建议门宽1500mm/通路净宽1100mm，均生成4房；三份实际素材palette、输入、布局、报告和包hash保存在各自结果中。

**对照边界**：before在算法4已产生的同一固定房间、墙、门与通路几何上，只替换为旧 `interior-furnishing@3`；after是算法4完整结果。两侧世界尺度、固定素材字节、灯光和滤镜相同，before另清除不适用的生成来源，避免伪造完整旧配方重放。因此该组只隔离家具摆位差异，不表示旧完整生成器也会选择新算法的结构，不是旧版与新版整条生成链的总体效果或性能比较。

| 实际研究候选 | 物件数 before→after | 非零旋转 before→after | 座椅距同室最近桌面占地边缘 before→after | 通路及缺项 |
|---|---|---|---|---|
| 雨夜旧宅调查所 | 20→19 | 0→14 | 345–5274mm→415–440mm | 两侧均4/4指定路线clear；新版研究办公室1件座椅无合法邻近摆位，明确保留缺项 |
| 街角事务与社区服务中心 | 20→19 | 0→14 | 348–5513mm→380–405mm | 两侧均4/4指定路线clear；新版研究办公室1件座椅同样列缺项 |
| 余烬酒馆与旅舍 | 20→20 | 0→13 | 500–4080mm→395–420mm | 两侧均4/4指定路线clear；本组家具报告无缺项 |

距离来自结果中的 `nearestWorkSurfaceMm`，是实际占地多边形的最近间距；它不证明座椅拉出空间、桌面操作净空或主观构图已合格。clear也只覆盖本次指定端点/实际门与完整带区，不外推任意全图寻路。

三组各保存 `before.sceneweave`、`after.sceneweave`、玩家2048×1638 PNG与主持人4096×3277 PNG。六份完整包均从磁盘重新读入，在新页面实际冷读资源/许可/像素；`diskVerification.projectHash`与各自导出前值相同，玩家PNG与冷读后同尺度Canvas2D逐RGBA比较均 `changedPixels:0`。包SHA-256、项目hash及冷读诊断时长在各份结果中，时长不作正式性能证据。该像素一致性不扩大为双受众4K全矩阵、保密渗漏或用户视觉验收。

生成及落盘冷读命令为 `SCENEWEAVE_THEME_REVIEW_RUN=2 node work/theme-masterpieces-20261111/run-interior-review.mjs investigation modern fantasy`；该脚本调用项目共用生成、完整工程导出/导入和原生渲染函数，浏览器IndexedDB打开/删除被显式阻止，未访问用户库。首轮研究输出仍保留在 `*-furnishing-review-1/`，上述数据只属于review-2，不拼接前轮或后续结果。

review-2技术整合冻结的7文件48项定向检查通过：`npx vitest run src/shared/generation/domains/interior/furnishing.test.ts src/shared/generation/domains/interior/interior.test.ts src/shared/generation/domains/interior/supported.test.ts src/shared/generation/local-interior.test.ts src/shared/generation/domains/registry.test.ts src/application/workspace/generation-intent.test.ts src/shared/generation/determinism.test.ts --maxWorkers=1`，该次总耗时53.46秒。覆盖窄室旋转、桌椅关系、偏心完整姿态、缺项、当前默认与跨工程身份确定性、严格新旧版本配对、旧非空家具完整hash、局部位置更新及人工保全。四组旧结果hash在改契约前冻结、改后复验保持；首次组合hash测试触发默认5秒超时，明确提高该检查等待至30秒后通过，不修改产品执行预算或据此宣称性能正常。正常 `npm run build`通过，保留常规bundle告警；整合仅补其他会话所有的 `src/shared/image-import/layer-replay.ts` 回调类型 `layer: T`，该模块既有工作不计为本次家具算法行为证据。

该冻结中主代理实际回看review-2三份成图，桌椅邻近与转向改进可观察，画面仍明显稀疏。本批保持算法研究候选：室内用途细节、构图疏密、朝向与操作空间、题材素材画法继续制作；review-2只冻结这次研究输入/结果，不把算法4记为最终成品语义。其他主题及首页岩岛、墓园、火山等题材未被本组覆盖。该冻结尚未覆盖实际生产页面操作；后续生产补验另列下文。完整编辑/撤销/存储故障矩阵、跨浏览器、独占性能、完整09和用户P3仍分别待验，不以离线harness交付替代。保留其他会话脏改动与独立 `todo.md`，未提交、推送或部署。

**用途扩展冻结（review-3）**：在review-2之后，算法4按用途与面积扩展建议至每房最多16件／总64件，授权palette按固定name／tags的用途偏好排序、以seed破同序；正常新建palette补入写字桌与长桌。三份 `*-furnishing-review-3/result.json` 仍采用上面的固定结构旧摆位对照方法，新版近代调查／现代城市／奇幻城镇实际物件数分别35／39／31，before各20件，两侧指定通路均4/4 clear。六份完整包独立落盘冷读后项目hash保持，2048×1638实际RGBA变化均0，浏览器141.0.7390.37、页面异常数组为空。近代调查与奇幻仍各列一件座椅未落下，现代本组无缺项；更多物件或更近的座椅不等于构图、工作站完整度或操作空间已合格。review-3是座位负载偏好补强前的独立冻结，不能外推最终源码。

随后补入临时座位负载：同室现有座椅按真实占地最近距离关联桌面，优先给尚未服务的桌面第一把椅子；人工保留座椅参与读取，但不保存永久配对，也不保证每桌齐备。新 `supported-interior@3` 的原12000×10000两房保护夹具，按现行普通事务默认compact策略及完整document／historyIdentity／appearance执行同批删除与移动，实际为2个语义目标、19条元数据、1565字节，后续局部重布保留两项人工结果并读取真实支撑；锁支撑后正确拒绝重布。旧无budget API会在每步重复计入整栋规则的156个output引用，组合为173＋162＝335而拒绝；这不是扩大当前普通编辑档位的理由。旧supported1／2保留原夹具和调用，原组合成本255；诊断原始数据另存 `work/supported3-budget-diagnostic-20261111/result.json`，不把旧展开上限与现行普通事务的多维计数混成一种证据。

本轮沿上面同一条7文件联合命令再次自检，51项全部通过、总耗时75.17秒，较前轮新增局部家具2项、家具摆位1项；完整输出只留在本会话工具session18580，没有另外保存文件日志。它属于用途扩展与座位分配之后的新冻结，与上面的48项／53.46秒分开，不相加；最终9份生产源码摘要另存 `final-source-manifest.json`。新增supported3保护用例曾触发默认5秒等待超时，记录首败后仅该新版本用例明确等待至30秒；旧1／2仍用原阈值。等待调整没有改变产品执行预算，也不能证明正常性能。源码构建曾因 `FurnitureAnchor` 未包含真实Prop字段失败，已将使用处类型补为交集；最终正常 `npm run build` 已退出0，架构与类型检查及普通Vite打包完成，Vite阶段9.33秒；该数字不是整条构建耗时或性能验收。首败保留，不抹去。review-2后的正常生产页面旅程在独立浏览器上下文通过室内生成、保存、reload冷读、手工删除与再次冷读不补回，31.0秒，产物／附件归 `production-smoke-1/`；它只证明当时冻结，后续第二次生产补验另列下文，不用31.0秒旧结果代表后续源码。

**首份原生命令细化候选（dressed-2）**：`investigation-dressed-2/result.json` 记录算法4生成后，继续用项目原生表面、物件、门窗及灯光命令细化的近代调查工程，含4房、62个Prop、7扇窗、6盏灯，4/4指定通路clear。完整包磁盘冷读项目hash保持，2048×1638实际RGBA变化0，页面异常为空；这没有新增通用自动细化算子，也不记为精修成品或用户P3。该次候选独立保留，材质调整后另生成 `investigation-dressed-3/`，不覆写本次冻结。review-4在诊断工具重构时漏传profile而首败，修复后重新执行review-5，原目录保留。

**座位分配冻结（review-5，宽边整改前）**：三主题六包生成及磁盘冷读脚本退出0，数据分别见 `investigation-furnishing-review-5/result.json`、`modern-furnishing-review-5/result.json`、`fantasy-furnishing-review-5/result.json`。对照仍遵守上面的固定结构边界，不能把before当成旧生成器完整结构输出。

| 研究候选 | 物件数 before→after | 非零旋转 before→after | 指定通路 |
|---|---|---|---|
| 近代调查 | 20→35 | 0→27 | 两侧4/4 clear |
| 现代城市 | 20→39 | 0→29 | 两侧4/4 clear |
| 奇幻城镇 | 20→31 | 0→20 | 两侧4/4 clear |

六份完整包均从磁盘重新导入，项目hash与导出前保持；2048×1638同尺度Canvas2D逐RGBA比较全部 `changedPixels:0`，浏览器141.0.7390.37、页面异常数组为空。主持人4096×3277 PNG另保留。它是当前算法候选的技术证据，未完成用户构图／美术审核，数量与旋转数不代表质量签收。

**调查细化冻结（dressed-3，宽边整改前）**：脚本退出0，`investigation-dressed-3/result.json` 记录材质调整后的完整可编辑工程，仍为4房、62个Prop、7扇窗、6盏灯及4/4指定通路clear。项目hash为 `e37ce0d5f638182a079f3c0eb09c699490cebd045b9a7426a0eb426d902c8d62`，完整包SHA-256为 `14b00d79c4245b6e7b4d51aef38abca3f25781be154d0142361c6a95ff3f722e`；磁盘冷读项目hash保持，2048×1638逐RGBA变化0，页面异常为空。它延续原生命令细化，未声明新增通用自动细化能力，仍待用户审阅，不记为精修成品或P3。

**正常生产补验（production-smoke-2）**：独占性能窗口释放后，正常生产E2E工具session93049退出0，1项通过，整体47.7秒、用例43.8秒；附件归 `production-smoke-2/`，覆盖室内生成、保存／冷开、删除家具与再次冷开不补回。该结果对应 `final-source-manifest.json` 的宽边整改前源码冻结，与上一31.0秒生产结果独立，不能外推随后修改。

**本机审核画廊（gallery-review-1）**：`gallery-review-1/result.json` 记录8个去重文件URL实际返回HTTP200，三主题对照slider均实测0%→100%，实际下载文件名为 `investigation.sceneweave`。`desktop.png` 为1600×1100、`mobile.png` 为390×844；窄屏scrollWidth为390、图片全部加载、页面异常0。主代理实际回看桌面截图与dressed-3成图，构图仍偏规整、桌椅组合松散；链接、下载和布局检查不证明美术质量或用户P3。

**宽边整改前诊断**：只读几何核对发现，调查dressed-3的11把椅子有6把在最近桌面的局部短端，现代review-5的15把有8把在短端。当时四边等权，最近距离与路线合法不等于自然桌椅组合；两组椅源SVG可证明本组+Y前向，但定义及授权palette没有通用前向字段，不能将此假设推广到所有素材。主代理随后写入矩形宽边几何偏好，短端保留候选；前述51项、正常构建、review-5／dressed-3成图及production-smoke-2均属于整改前冻结，新代码的必要自检独立记录如下。

**宽边偏好独立冻结（review-6）**：证据归 `wide-edge-remediation/`。新增偏好只给正交长方桌面的长边更高候选次序，保留短端回退，不推断通用前向，也不减少完整占地、支撑、门前带、锁或已通过通路检查。`before-manifest.json` 与 `after-product-manifest.json` 的本轮9份自有生产源码中，仅 `src/shared/generation/domains/interior/furnishing-poses.ts` 改变；这项对照范围不能扩大为全工作区只有该文件变化。

| 本次必要自检 | 完整结果与边界 |
|---|---|
| 新增边界 | `new-edge-cases.log`：4项通过、7项跳过；单文件5.32秒，不把跳过项记为本次执行 |
| 家具摆位全文件 | `furnishing.log`：11项通过，15.17秒 |
| 七文件联合复验 | `unit-recheck.log`：7文件55项全部通过，90.06秒；原测试等待阈值未改。本次与旧51项独立，不累加 |
| 首轮联合中断 | `unit.log` 已输出部分失败文件，但完整失败详情未取得；主代理在主机负载173.86时中断自有进程，退出130。`unit-attempt-1.json` 保留部分报告和未完成状态，不将所有失败归因于负载，也不记首轮全绿 |
| 正常生产构建 | `npm run build -- --outDir work/theme-masterpieces-20261111/production-wide-edge-dist` 通过；Vite阶段11.04秒，保留常规注释／导入／大包告警。`build-start-manifest.json` 冻结1380文件，`build-source-drift.json` 为0漂移；这是该构建期间核对范围，不是性能验收 |

`review-6.log` 及三份 `*-furnishing-review-6/result.json` 保存同一固定结构对照的独立输出。三主题before仍各20件／0转向，after近代调查35件／28转向、现代39件／29转向、奇幻31件／20转向；两侧均4/4指定通路clear。六包实际磁盘冷读均成功，项目hash与导出前一致，玩家2048×1638逐RGBA变化全部0；六张主持人PNG均4096×3277。浏览器141.0.7390.37，页面异常数组均空；4K文件存在及尺寸不等于4K冷读像素矩阵已验。

`edge-comparison.json` 只按最近实际正交矩形占地作几何分类：调查宽边席5→6／11、现代7→9／15、奇幻4→4／6；通路均4/4。改善有限，没有证明桌椅自然朝向、操作空间或整体美术已好。下一方向是核对桌面落位时是否需要预留邻近座椅空间，仍待验证，不能写成已证实根因；旧production-smoke-2和调查dressed-3不代表这次源码。

**正常生产宽边补验（production-smoke-3）**：`wide-edge-remediation/production-smoke-3.log` 记录工具session18783退出0，单worker的1项真实页面旅程通过，总30.9秒、用例30.3秒。使用4179的独立正常 `production-wide-edge-dist`，覆盖真实室内生成、保存、reload冷开、手工删家具与再reload不补回；附件归 `production-smoke-3/`。完成后preview主动Ctrl-C退出130；不把正常停服记为测试失败。该冻结与smoke-2独立，属于正确性自检，不是性能、美术或完整验收。

**现代独立构图首败保留**：以13×15m建筑范围、四种不同面积功能房和真实走廊调用室内算法4，初步生成成功；继续原生命令细化时，`modern-dressed-1/` 的新增档案架找不到安全位置而拒绝，未导出工程或PNG。原失败源码 `authoring-source.ts`、`failure.json` 和 `wide-edge-remediation/modern-dressed-1.log` 保留。随后经原生命令删减通用档案货箱、保留书架后重新执行，不靠放宽几何或资源校验通过。

**宽边源码下的两份原生命令候选**：`modern-dressed-2` 和 `investigation-dressed-4` 脚本均退出0，各自保留完整包、双受众PNG及 `result.json`；不覆写旧dressed-3。

| 独立候选 | 实际内容与通路 | 项目hash／完整包SHA-256 | 磁盘冷读像素与主持人输出 |
|---|---|---|---|
| modern-dressed-2 | 32 Prop、四功能房加1真廊（rooms共5）、5窗、8灯；5/5指定通路clear | `3e02bf141f1fae316b6638bab903155b48552b9c9c39bb868515e3284fdf54f9`／`786b47e93866d4164e1f703fc69606ee8e724b2c7d23bdc6e37bbcbb3a16fd88` | 玩家1820×2048实际RGBA变化0，项目hash保持；主持人3641×4096 PNG |
| investigation-dressed-4 | 62 Prop、4房、7窗、6灯；4/4指定通路clear | `24bdc345a28421600a43aa57c274e50a22d2e6c59327a4fc03550506b5432c4e`／`a1afcce635eba0c3feba3b02d253ca657dabb2495211debcb71e39628a2b821e` | 玩家2048×1638实际RGBA变化0，项目hash保持；主持人4096×3277 PNG |

两份浏览器均141.0.7390.37、页面异常数组空。主代理已目视现代图，用途材质区分与真实廊道成立，但侧廊偏长且空、候客沙发零散、部分桌椅仍在短端；调查新图材质与细节良好，但四矩形结构和松散构图仍在；均不算精修成品。这些离线工程和像素自检不代替09正式验收或用户美术签收。

**新版画廊独立冻结（gallery-review-2）**：画廊更新至两份原生命令候选与review-6后，`gallery-review-2/result.json` 记录10个去重文件URL均HTTP200，三个比较滑块实测0%→100%；两份真实下载的SHA-256与上表原完整包完全一致，分别为 `investigation.sceneweave` 与 `modern.sceneweave`。1600px桌面及390px窄屏scrollWidth均等于视口宽度、8图全部加载，页面异常数组空，浏览器141.0.7390.37。主代理实际回看 `modern-feature.png` 和 `mobile.png`，版面可用；链接、下载和页面布局检查不抵扣作品美术签收。旧gallery-review-1保持review-5／dressed-3独立冻结，不覆写或外推。

性能第三次自然窗口已释放，本轮headless浏览器、测试、构建与preview均结束，只留4181静态服务供用户查看。本文本更新只整理已有结果，不启动新重任务；接续向用户展示两份可编辑候选，继续桌面落位／构图、现代与奇幻细化及其余六类题材。写实版、09完整验收与用户P3仍分别待完成，不提交、推送或部署。

**并排座位整改与长凳反例（独立冻结）**：`seat-diagnostics/initial/` 在未改产品时，从实际生成结构重放家具；三主题的带记录副本均与真实内核完整document／report一致，且props与实际生成结果一致，才解释拒绝。调查268、现代165、奇幻287次实际尝试，页面异常为空。短端对应的长边有边界删候选、通路以及其他桌椅碰撞等多类原因；至少四例可证先放中央椅占住同侧两个四分之一偏移，而另一侧在房间外。日志仅记录接受前实际访问候选，另列房间边界probe，不把未访问位置当穷尽失败或认定所有短端同根因。

室内4因此只在建议多席、正交矩形真实长边能容下两份当前座具完整占地／画框包络及100mm间隔时，优先试尺寸感知并排位置，中央仍作回退；单席、过宽长凳、短端及未知长边优先中央并保留原有限沿边错位。完整物理／绘制／支撑／门带／通路、预算、取消、原生事务及人工保全不减，未写永久桌椅配对。首轮12项中1项短端回退失败，收紧到已知长边后57项通过；review-7虽六包冷读像素一致，却因误删过宽长凳旧错位使奇幻6→5席，保留中间结果并修复，不记最终成功。首轮构建期间其他会话两张图片编辑面板变化另记`build-source-drift.json`，不能作为全仓静止冻结。

最终恢复长凳回退后，`pair-spacing-bench-unit.log`记录相关七文件57项通过、46.78秒，无预算／超时放宽；覆盖双椅完整并排、单席／整长凳中心与错位、偏心／转向、门路及旧2／3、supported1／2重放和局部人工保全。额外base-map的早期七文件78项属中间冻结，不与57相加。正常`production-pair-spacing-bench-dist`构建通过，Vite10.05秒，常规warnings保留；1441个源码／工具／配置文件在该构建前后hash不变，详见`bench-build-start-manifest.json`与`bench-build-source-drift.json`。`production-smoke.log`在该正常构建的4179独立页面运行1项通过，总36.4秒／用例35.5秒，覆盖生成、保存、冷开、删除、再冷开不补回；附件在`seat-diagnostics/production-smoke/`，完成后preview结束。属于正确性自检，不是性能或视觉签收。

`*-furnishing-review-8/`三主题六包均磁盘冷导入hash保持、玩家2048×1638逐RGBA变化0，页面异常为空，主持人4096×3277。与review-6同输入和结构比，调查35→36物件、宽边席6/11→9/12；现代39物件、9/15→13/15；奇幻31物件、4/6保持。两侧各4/4指定路线clear。`bench-edge-comparison.json`只是最近真实正交矩形占地分类，不等同桌面操作空间、未知素材正面或艺术评分；review-8的before仍是同固定结构替换旧家具3，不能当完整旧生成链。

**最新三份原生命令候选**：`investigation-dressed-5`为63 Prop／4房／7窗／6灯、4/4路线，项目hash`1f98891c916818074a413a517f3c0660bb47cf445fbff41e3ee23ac2be039585`；`modern-dressed-3`为32 Prop／四功能房加真廊／5窗／8灯、5/5路线，项目hash`7c85cbfca72ec55bc3fdbe3953ead3eb4e94c580fc055fbfa01a04452a3a2c2a`。两包落盘冷读hash保持，玩家分别2048×1638、1820×2048实际RGBA变化0，页面异常为空；完整包SHA及输出参数在各自result与`seat-diagnostics/verification-summary.json`。主代理已看两张新玩家图和现代／奇幻review-8：椅子并排有改善，但调查四矩形与松散桌组、现代长空廊及候客区、奇幻同质平涂仍在，未签收精美成品。

遗迹`ruins-dressed-7`独立采用14.5×12m室内4五房／340mm实际墙及真实门，原生命令细化24固定物件／6灯，房间用途为门厅、祭祀室、主墓库、纪念侧室、藏室；无新增自动墓库布景能力。全部5条实际路线在布景时保护，最后显式关闭上锁仅主墓库相连的藏室门，最终4条clear／该1条unavailable。大柱、墓盖、石像及窄藏室石棺的五轮拒绝保留在各轮日志、source／failure及`review-and-failure-index.json`；调整真实布景密度，没有缩放定义或松安全条件。完整包项目hash`0810a5a769d2001678f068292ebbef1afab3ad10d7ca5654d4eb654133525377`，SHA-256`e667a7e0c4745c09607b2fea54e02b259ee7931f873f25144c974d9d4ccbde14`，磁盘冷读hash保持、玩家2048×1755逐RGBA变化0、主持人4096×3511，页面异常为空。主代理已看6／7，子代理另看7的GM图：用途可辨，石材和线描偏平、墓葬松散，暖光改善有限，继续待精修／用户审阅。失败到通过仅属这一创作过程，不推定生成器能自动完成同类美术。

新版画廊`gallery-review-3/result.json`独立复核三份新候选与review-8：12个唯一文件URL均HTTP200，三个滑块实测0%→100%；三份完整工程实际下载文件名及SHA与原件相同，1600／390px均无横向溢出且图片全部加载，页面异常为空。主代理已看遗迹feature和窄屏截图，页面可用，不作作品美术验收。旧gallery-review-1／2及各旧作品保持原冻结。

**奇幻五用途候选与新手绘表面冻结**：`fantasy-dressed-1`因work源码注记结尾多余括号失败，原source／failure／日志保留；修正后`fantasy-dressed-2`实际生成14.5×12m室内4五个不同面积用途房、23物件／4窗／5灯，五条指定路线全部clear。公共餐厅保留两组生成桌凳，厨房复用真实石灶和备餐台，酒粮库仅接厨房，两间客房仅接公共厅；三份现有精修室内来源与奇幻主题分别保留确切字节、固定尺寸和各自许可，没有把锻炉改成灶或缩放定义。两个桌面组保留完整图框／实际图案在桌面内的独立证明，物件仍是房间支撑，不宣称新增Prop台面支撑系统。原工程hash`99660be53ce7d53ffa597828d4217fb19485867a91256f2a98c1f116939a36ae`、包SHA`a9af58c3ea919b6ea1d956b79cd58f65c9cafe5de91f51dc2a810d67d89f1eaa`，磁盘冷读hash保持，玩家2048×1755实际RGBA变化0、GM4096×3511、errors[]。主代理看图确认功能可辨但餐厅／客房留白大、桌组松散、图案偏平，仍待精修与用户审阅。

新`handdrawn-surfaces`独立四来源用于检验共同材质债务，固定身份／尺寸／许可归[14](../14-visual-and-assets.md#handdrawn-surfaces-v1)。木纹、石板色层、边角和颗粒由有限确定性静态SVG生成，自由笔触跨两轴重复。`surface-swatches-1`工具误按ID读取hash-key资源失败，修正为document.assets；2／3／4保留石块尺度与重复边缘的中间校样。最终`surface-swatches-5`为实际canonical1024×1024 PNG，四张alpha全255、SVG源hash与512校样保持，源大小约26–56KB、5–18path／1948–4170commands，均在原限额内。X边界平均RGB差分别木0.115、石灰岩0.302、玄武岩0.168、灰泥0.004，Y分别0.003／0.060／0.059／0.032；只是接缝诊断，主代理实际回看3×3和两张地图，仍有程序化平涂与周期，不作美术通过。

普通生产页面的512初筛提示木80px/m和石约107px/m低于128参考，因此修改共享`materializeVisualArtBatches`支持批次显式512／1024／2048像素，缺省512保留旧批次；新独立四材质batch选1024，不改毫米尺寸／固定源或初筛规则。非法尺寸在任何batch栅格化或scene修改前整批拒绝。最终`handdrawn-surfaces-1024-unit.log`三文件20项通过11.08秒，包括旧默认512实际参数／fixture字节、显式1024源／尺寸／许可、非法值前拒绝、固定源SHA、正常胶囊采用及完整包冷读；目录测试用签名像素，不冒充真实美术。正常`production-handdrawn-surfaces-1024-dist`构建通过、Vite9.77秒，1457源码／工具／配置文件前后hash无变化，常规warnings保留；早期512七项／构建另留独立冻结，不与20相加。

`surface-production-ui-1`采用／撤销／重做后错误假设reload自动开工程而失败，原证据保留；2使用首页最近工程实际打开通过，但仅512冻结。最终3在新正常1024生产包走新建→普通四材质预览→采用→真实缩略图→撤销消失→重做恢复→首页刷新并最近工程冷开→真实工程下载，errors[]；主代理回看实际预览，初筛明确“未发现本轮规则覆盖的明显像素问题”，不是用户签收。真实下载包SHA`9af7620e2a8752a8206897d83acbc2d0ce772fb48983bc7141e2a5c4161c99d1`，ZIP审计四新材质／四实际1024图／四authoring source、0场景Prop；页面采用不自动放置物件。

两张完整工程的最终同几何地板对照为`fantasy-surface-review-3`与`ruins-surface-review-2`。均正常准备／采用四素材，再单事务修改五房地板材质及显式实际tile尺寸，所有墙保持，灰泥仅入库未应用。before为确切原包；after逐项核对room／wall业务与结构、其余几何／Prop／门／灯／注记／图层、历史出生／拓扑令牌、人工外观、全部旧固定源／派生／许可绑定和真实资源字节不变，revision只加1。普通编辑选择器自动得到compact，实际semanticTargets5／256，不提高档位或拆批。此前奇幻review1含墙、review2只地板但helper漏传普通预算而触发旧展开计数拒绝，两份failure保留；helper改按现有Workspace／dressed普通路径向apply和materialize传同一注册预算，未修改产品预算策略。

| 最终对照 | after项目hash | after完整包SHA256 | 落盘冷读与输出 |
|---|---|---|---|
| 奇幻地板review3 | `112a62f49fb45e0beb71f1bf28d52fe7f7e8c6db7f1a444dd7d1a48356c6edc6` | `dc83ab90cabd6cdbbdc4bc70c53bf9d2a746872f84a966523f965943244f3e84` | 前后各2048×1755玩家RGBA变化0、hash保持；GM4096×3511 |
| 遗迹地板review2 | `f45806b73101a0b603705ca1e2957d2c72081413a396a1855411ea9725690942` | `d740478e9fdbd29722dcb8418ad99eb4ca5afa3bc4433cb3790b43e5353c1f93` | 前后各2048×1755玩家RGBA变化0、hash保持；GM4096×3511 |

上述两组四包均从磁盘重新读取实际archive和PNG后导入独立空页面，浏览器141.0.7390.37、errors[]；时长仅诊断，不是独占性能。主代理实际看两份after及原图，新地板明暗／接缝可见，仍不能解决整体构图和笔触品质；完整正式矩阵与P3未关闭。五个室外题材待创作，下一片以独立溪岸补给站核对真实地形、建筑工作面与道路，尚未运行；写实继续等内置工具，不调用API备用路径。未提交、推送或部署。

当前画廊`gallery-review-4`独立检查17个唯一文件URL均HTTP200、五个滑块0%→100%、四份主作品实际下载与原包字节／SHA相同；1600／390px均无横向溢出且全部图加载、errors[]。主代理看新遗迹feature与窄屏截图，四候选、两个地板对照及平铺校样均可回看；旧gallery3与512中间结果保留，不把页面检查算作品艺术验收。1024 preview服务器已结束，4181仅保留静态审核画廊。

**五类户外独立候选冻结**：先前四室内之后，使用原生领域生成与普通命令独立创作五户外；不是新增五种专用自动布景领域。首轮海岸生成包／PNG后，冷读遇到其他工作线正在写入的模块缺依赖而失败，`coast-dressed-1`保留，不记整轮通过。为避免在途源码混合，建立`source-freeze-outdoor-1`，复制1320份src及必要素材／harness，捕获前后与副本hash0漂移；后续作者稿另存每轮source，不把可继续编辑的work文件当永久冻结。以下五份均在该冻结运行，成功后复制回根work供画廊读取；不外推后续根目录其他会话代码。

| 独立候选 | 实际规模 | 项目hash | 完整包SHA256 | 玩家／GM像素 |
|---|---|---|---|---|
| 溪岸巡林补给站／`wilderness-dressed-3` | 46物件；4/4条指定路线clear | `1f126223df6d0e6ad6bc45a40d3c882296af363fbb93c8f2c9368ef313cafb40` | `69074de763b074bb17acece520e89bde789ddd9c81007e63fca7851ef371c4b0` | 2048×1583／4096×3165 |
| 潮湾渔获与岸边补给站／`coast-dressed-2` | 54物件；6/6条指定路线clear | `bd0e2a158ac6b773cc300b765ddb481443dd4ddf28b8fe50f0343d37ce8bfd65` | `8948289d13e2dd06951320af13c7cf2a663c5304393b3c991c8bdc41936c36e9` | 2048×1638／4096×3277 |
| 双台岬岛／`island-dressed-1` | 23物件；4/4条指定路线clear | `ea7dcf3d8e0baf10c744ce56384b1ebace990b099d44f77b9be26ae9199b7d37` | `a98b2f5fdafa2b00c413a6619344799858c56175752597bd841301d69431b4cb` | 2048×1593／4096×3186 |
| 雨后纪念花园／`graveyard-dressed-5` | 36物件；3/3条指定路线clear | `57ab774f8f9a9be69e9d11fcdddf624fc6d90563bef82603d62345faaec8a2ae` | `e82b869700838934601e67aead832ede6f40bd69564301c871abd8e696e97d97` | 2048×1664／4096×3328 |
| 灰脊火口观测步道／`volcano-dressed-1` | 24物件；5/5条指定路线clear | `7f4925be163c172af74741bb29e7dff7e44ba656583092cf790d3f488f9e456d` | `876d3940a17e795bb490a5ac236532655dda78825748f4f976ebbcfc46dbca49` | 2048×1556／4096×3113 |

五份完整包均从磁盘另页冷读，项目hash保持、玩家同尺寸逐RGBA变化0、页面errors[]，浏览器141.0.7390.37；GM为实际4096长边PNG，未把玩家一致扩大成双受众全部验收或正式性能。确切报告、完整字节与尺寸归各result及`outdoor-verification-summary.json`。五份均为`formalAcceptance:false`、用户美术待审；仅画廊可访问或工程合法不能记精修签收。

荒野44×34m包含真实阻水溪流、双房supported-interior3（室内4）、完整门前路、七林区与营地；153植被目标实际124（27树），普通`buildRoadCampPatchPlan`采用两条实际路肩覆盖，旧底材保全。荒野首轮ground与溪流cap共边缺分段、次轮直接将浮点pathPolygon写成整数毫米覆盖失败均保留；作者稿显式分段，路肩改用已有整数构造plan，未取整物理带或放宽产品守卫。海岸40×32m有两房、三Path、10.08m²真实分拣空地，55物件请求实际54、一个optional shell因安全几何跳过；海水负探针核对`TERRAIN_NOT_WALKABLE`且实际支撑为阻水water，不强求该错误本来不携带的entityId。

岩岛36×28m使用确切refined-island1的13固定图及原512像素，真实900／2700mm台地、1800mm石阶和两端1200mm接入，五块普通自然地表覆盖与10.15m²活动区。墓园32×26m采用确切荒野2／遗迹1／植被细节1及既有独立leafy-fern批，11墓位、无顶纪念庭院与2200mm门洞；先unspecified草稿建门，再改required。原env与rename混批、未建门required、蕨与墙完整占地冲突的失败保留，后者移动真实位置，不放宽检查；三条访墓Path全部读实际records核对。火山50×38m经过正常blank→prepare→采用，5面／17崖／2Path／2高差连接，37.13m²活动平台，平台与山体1800mm／火口-400mm；熔岩阻挡来自实际Region，负探针为`TERRAIN_TRAVEL_OBSTACLE`及该Region ID，24／24物件落位。

主代理逐份实际回看：荒野／海岸空房与松散工作组、岸线和道路硬边；岩岛崖面像棕色平带、苔点重复；墓园规整围合、植被稀疏、细蕨弱；火山石纹周期、火口折线和熔脉过直。全部继续精修，未认定九主题成品完成。写实仍等内置工具，不走付费API备用；用户P3、完整正式矩阵分别待完成。

**森林顺序隔离诊断**：`forest-order-diagnostics/run-1`先逐项精确复现wilderness3的input／inputHash／report／resultHash／stages／buildingResultHash，参考树27、灌49、草48，总124。单处可逆仪器改动仅按tree→shrub→grass物化，所有规范化／种子／几何／保护／有限搜索／预算及完整森林检查保持；7项配对控制全部true、冻结1320份源码前后0漂移、errors[]。试排树39、灌46、草48，总133；北岸柳0→1，南岸柳1→0，未承诺各区都改善或必达目标。reference结果hash`8cffad9931d28ba98a9e31291b886fa88e05e9f2ae3b22939374a421e0c1e469`、试排`a1c5a7e0dfda99f36c89e6293076a1b6c120a2b0ec0e8d1267c506063a208c92`。这只证明单输入顺序效应，试排不导出旧forest1身份工程／PNG；正式新版本会改变派生seed，必须另留实际结果与异输入验证，不以39棵作为新版承诺。

<a id="image-algorithm-diagnostics-20261111"></a>
## 图片算法诊断与真实前端预览（2026-11-11）

用户明确本阶段为持续改进算法与设计，琴房不是待交付成品。证据根为本机忽略目录 `work/image-quality-remediation-20261111/`。人工mask与取样实验全部保留为诊断；没有把局部变干净称为通用改善，没有提交／推送／部署或调用外部模型。以下冻结与此前92项／8项自检分开。

| 范围 | 实际行为与边界 |
|---|---|
| 真实缺陷与失败实验 | 浏览器实际规范化源身份为 `7cb9e9b371c119651243ecd508b98a820f07ae3596615d2cefa9efe8f4dec851`，1280×840；`normalized-source.json`记录原JPG和确切PNG。粗琴选区包含真实地毯／木板，人工收紧又切掉部分黑轮廓，不能作为通用分割真值。单镜像取样、相位搜索、patch与方向延续仍产生板缝错接、重复阴影、块状或纹理变平，未新增生产补底算法；`edge/`早期“final／交付”命名仅保留实验原貌，当前范围以根README为准 |
| 共享顺序重放 | 页面预览、MCP的逐层操作与重建共用 `replayImageLayers`。一张最终来源图记录最后修补者，裁片及声明取样矩形分别统计前序推断；RGBA没变仍记推断，孔洞／未修补保留原图身份。报告仅诊断，不改变配方准入及旧tile／seamless／aligned的提取、修补RGBA。取样框交集包含重复声明，不是实际读取或污染像素数；actualSampled／boundary明确未测。页面在完成标定后的保真区显示，MCP通过assess／build返回；inspect不增加重放 |
| 诊断成本与编码边界 | 只读审阅发现初稿反复全矩形扫描的成本回归，改为32px精确块统计，完整块计数／producer位集、部分块检查原来源，覆盖时清除旧producer；不保留中间全图。另发现直接复用固定SVG编码器会收窄导入预算，已独立提供原色PNG编码路径保留8192／3200万／20MiB，SVG的4096／1600万不变。软件编码保全半透明RGB；不宣称PNG编码文件字节沿用旧值 |
| 定向自检 | 最终7文件79项通过，`verification/source-evidence-unit-final.log`。覆盖朴素扫描对照、跨块／图像边块、重复覆盖、producer高位、孔洞／清理、相交但实际tile未采样、旧三种修补RGBA与蒙版一致、MCP评估／撤销、PNG透明RGB及8192侧预算；来源输入不变 |
| 无DOM与正常构建 | `verification/shared-final.log`通过286共享源码模块及Node ESM／无图片工程ZIP往返，未代替真实图片适配器。`verification/build-final.log`为本轮正常架构／全工程及AI类型／Vite构建，产物见production-dist；源码／产物hash及并发漂移如实记录于verification，不把其他会话变化称全仓冻结 |
| 正常生产页面 | 同一production-dist的9条串行旅程全部通过，`verification/browser-final.log`及browser-final/。覆盖三个增强、三个草稿保护、两个旧拆解质量旅程和新增来源诊断：裁片200／声明取样框50前序推断、实际读取未测及配方导出原样。使用隔离Chromium与正常UI，不是独占性能或正式视觉验收 |
| 原真实配方重放 | `verification/real-replay-report.json`使用确切规范化源和此前17层aligned配方，不加人工mask。逐层与旧顺序extract原语核对裁片、mask、repairMask及最终剩余底图RGBA完全一致，源图不变；最终推断49,567像素、裁片累计3,256像素来自前序推断、声明取样框交集0。后两项不能代替实际采样／边界读取或视觉质量，不能把修补来源视为新观察 |
| 真实前端预览 | frontend-current/保留4张1600×1000真实截图、1600×1216总览与index.html；使用上述正常生产包、旧完整琴房和17层原配方，不使用人工mask、不采用候选。实际零变化并禁用采用，页面明确“本次未处理”；来源报告3256／0与共享重放一致。facts.json记录输入／配方hash、浏览器及原文，gallery-check.json记录5图／18链接可读、1600和390宽无横向溢出。frontend-before/的16张旧功能截图和总览保持，画廊明确分开时间与用途 |


收尾 `verification/final-integrity.json`记录本任务源码无漂移、177份生产产物hash保持、605个本地文档文件目标存在、`todo.md`不变及`git diff --check`通过。构建及截图期间其他活动会话仍在修改无关生成模块和旧测试，因此未宣称全工作区不可变冻结。预览端口5403／5404已停止。

下一算法方向归[设计边界](../reference/image-to-project.md#layer-source-evidence)与[路线图](../07-roadmap.md#image-to-project-plan)。来源报告只帮助识别证据循环，不能判断琴沿是否准确、木纹是否自然。真实蓝边、木纹接缝和暗带仍未解决；前景／背景引导候选、结构补底、未参与调参组合与异画风盲测尚待继续。开发自检与截图不关闭09或用户P3。

<a id="image-quality-followup-20261111"></a>
## 图片色边、纹理接缝与草稿保护接续（2026-11-11）

用户在琴房导入整改会话后要求并发接续。本轮新增显式 `decontaminate` 画质方向与 `repair:'aligned'` 补底；R3草稿保护由[源码整改会话](#source-review-fixes-20261111)独立实现，本轮只复核并纳入整合。保留其他会话编辑与独立 `todo.md`，未提交、推送、部署或调用外部模型。证据根为本机忽略目录 `work/image-quality-followup-20261111/`，本节不把开发自检算正式验收。

| 范围 | 实际结果与证据 |
|---|---|
| 固定算法与边界 | `aligned`按每种用户指定材质搜索有限整数平移，再执行已有无缝融合，不旋转或扩大遮罩；默认seamless、旧tile/缺省及旧seamless固定结果保持。`decontaminate`仅在真实透明轮廓旁窄边带、存在稳定内侧颜色依据时减弱异常色度，alpha保留，亮度只容许通道取整误差；不可靠区域不变。旧三方向的算法及源解码保持。页面、Worker、采用与公开冷读共用相同方向语义；新方向的规范RGBA8 PNG从编码字节读取确切像素，其他合法格式回退既有图片适配器，真实资源解码及完整许可校验继续执行 |
| 定向算法／平台／资源 | 确切源修正后9文件92项通过，日志 `verification/unit-exact-png.log`；此前89项属于修正前冻结，不重复加总。覆盖透明窄边、固有彩色与无证据不改、局部范围外、原件及输入不变、旧方向固定hash、Worker取消、私有采用witness、PNG回退、native半透明RGB舍入、实际解码失败及完整资源重放；补底覆盖已知错相位、双材质隔离、孔洞/清理外沿、取样冲突和预算失败原子保全 |
| 无DOM与正常构建 | `verification/shared-exact-png.log`记录284共享源码模块及真实Node ESM/工程ZIP往返通过，不代替真实图片适配器检查。最终正常 `npm run build -- --outDir work/image-quality-followup-20261111/production-final-dist`通过，`verification/build-final.log`；319源码模块架构、全工程及AI类型和普通Vite打包均完成。最终1,351份源码/配置/测试输入在构建中无漂移，177份产物hash归 `verification/source-final-build-start.json`、`source-final-build-drift.json`、`production-final-manifest.json`；未使用性能profile。保留动态/静态混合导入与大chunk警告 |
| 最新正常生产页面 | 预览端口5398的`/sceneweave/`，三个增强、三个草稿保护及两个拆解质量旅程共8项串行通过，见 `verification/browser-final.log`与`browser-final/`。覆盖同基线候选、真实局部采用及源保全、无关编辑/旧目标拒绝、撤销/冷开再增强、去色边真实PNG与alpha、R3失败/取消/匹配成功、显式aligned配方重载/两底材/采用/冷开；不用合成样例证明真实琴沿已改善 |
| 真实琴房共享MCP与冷读 | `repair/project-output/candidate-1-14f4de34-af98-4eeb-b46b-687084b872d0/`实际完成落盘及独立冷读，只有琴、毯改aligned，其他层保持原设置。`result.json`的projectHash为`762952b8f73603b80efe998d5a6aa7f703167f8e1ad1ce1bd47bf2ab9577e017`；原图可比较163,666像素变化0，背景修补范围外变化0，2048×1825冷读RGBA变化0。物件及背景推断区域分别单列，不能证明真实遮挡细节；原图来源及用途约束沿用原导入台账 |
| 真实编码源对照 | `style-comparison-exact/`从上述完整包的原编码assets直接取琴/毯/植物/地板，另取4张已知原创MIT素材；未复用旧native派生source.png。8图×4方向×3强度96候选重放/实际PNG复读一致，8原图不变，32组局部范围外RGB及alpha变化均0。新方向真实图RGB变化为琴0、毯26、植物0、地板0，alpha均不变；MIT椅/盆/毯/木为421/4/1284/0，均为既有半透明边沿，不能据此认定存在污染或质量改善。源码/输入/产物hash归该目录`manifest.json`，视觉结论归`visual-review.md`。该离线组仅比较像素算法，不模拟旧方向的native输入，也不是独立盲测 |
| 完整琴房继续编辑与目视 | `real-ui-final/verification.json`及实际备份/截图记录正常生产UI独立IndexedDB导入、200%同尺度黑白换底、三个去色边候选无变化且预览禁用、未采用后全部props/materials/assets保持；保存冷开资源字节hash相同，继续旋转7°、移琴至X4950mm／移毯至X6025mm成功，页面错误0。最终三候选说明文字换行且均留在按钮内。实际移开图已查看，琴沿青蓝仍在，板缝和重复暗带仍可见。确切源修正前与修正后未补换行的诊断分别留在`real-ui/`和`real-ui-exact/`，不能冒充最后产物 |

首轮失败与修正保留：`verification/browser.log`的两条新增失败分别为去色边夹具缺真实透明依据、aligned旧label定位；改为有真实透明边框与显式蒙版的夹具及角色定位后，`browser-recheck.log`再暴露断言把房间裁片当整张400×240原图，按360×200裁片及20,20偏移比较后通过。操作定位等待设15秒，未删除业务像素断言。合成透明夹具56个RGB像素改变、alpha0只证明可采用链路，不能外推到琴房蓝边。上述首败、补验与最终8项是不同冻结，不拼接成一次更大通过数。

真实图复核另确证：修正前钢琴导出出现520个RGB变化，均为半透明像素，而原编码源上直接运行去色边为0；这是native Canvas解码量化，证据归`real-ui/pixel-audit.json`、`pixel-decoder-comparison.json`。本轮仅对新增方向引入确切PNG输入后，页面如实显示不变并禁用采用；既有方向不改重放。实际截图还发现候选长说明横向溢出，最终补换行约束并在正常产物检查。离线对照脚本首轮独立PNG库要求Buffer而收到Uint8Array，转换为Buffer视图后完整再生退出0；不涉及产品源像素变更。早先`sips`补底对照及native派生源对照只作辅助诊断，不能作为确切编码源的改善证据。

收尾核对1,351份输入与177份产物均无漂移，`todo.md`的SHA-256保持；7份相关文档822个本地文件目标均存在，`git diff --check`通过，详见`verification/final-integrity.json`。

本轮证明新增选项及必要编辑链路已接入，没有证明完整蓝边修复、任意手绘木纹无缝、缺失细节恢复或整体画质达标。固有彩色边饰也可能被估计改变，应显式局部审阅；强度和变化像素数不是质量分。下一接续点由[07](../07-roadmap.md#image-to-project-plan)维护；授权异画风盲测、完整视觉、真实模型收益、跨浏览器、独占性能及用户P3仍从09执行。

<a id="source-review-fixes-20261111"></a>
## 源码审查发现项整改自检（2026-11-11）

承接源码审查，按用户要求先核对图片增强与旧测试整改两个会话，再修复独立范围。HEAD为`36eedc26ef27a2e6b11250d4c2f753667cae1006`；工作区含其他会话脏改动，修复前清单、各组日志、逐文件hash与浏览器输出保存在本机忽略目录`work/source-review-fixes-20261111/`。原错误行为及覆盖边界保留于`work/source-review-20261111-122600/review-summary.md`，未把审查索引覆盖说成全部源码逐行审读。

本轮修复AI runner最终错误边界及body准入、两种有限恢复的保护守卫、底图终结释放、历史读取能力身份、共享纯JSON复制、UVTT Floor范围、区域下钻输出和负斜率墙归一。图片增强会话随后收口，才接手图片拆解草稿离开保护，保留其既有增强实现；旧测试会话仍活动，本轮未接管其既有测试。

| 必要自检 | 当前证据与解释 |
|---|---|
| AI任务与上传 | 本地stub/临时SQLite，3文件38项通过；同例旧冻结3失败并捕获1个未处理拒绝，日志`ai-boundaries-red.log`/`ai-boundaries-final.log`。覆盖错误处理再次读库失败、多请求中止、抛错订阅、上传数量/总字节、取消/超时与容量恢复。整合发现测试helper未接收Hono同步Response后，仅修类型适配并同文件3项通过；不向外部模型发请求 |
| 恢复、底图与仓库证明 | 新增关键回归17项通过，同案旧实现15失败/2通过，见`core-red.log`/`core-green.log`；包括两个连接删除真实historyPins保护点、采用前保全、最终保存失败保留内存及undo、在途后代guard消费、失败重试，以及SVG processor/并发能力变化。收窄现有回归5文件69项通过，另两个普通/空工作区关闭checkpoint用例通过，见`core-focused-regression.log`/`core-close-regression.log`；与17项有重叠，不重复加总 |
| Floor/区域/墙归一 | 9文件63项通过，见`floor-regression.log`；旧实现区域/负斜率及有效UVTT crop首败各自保留，UVTT错误夹具的首轮失败不算产品诊断。当前覆盖非零裁剪/补边、LOS/门窗/点光、区域重建/下钻、父图不变和正负斜率/逆序/分组不误合并 |
| 共享层 | 282源码模块无DOM/无Node类型编译与真实Node ESM、命令/身份/投影、工程/历史ZIP往返通过；`shared-check-final.log`。JSON复制直接影响的4文件4项通过，`shared-focused.log`；更宽5文件同步预算组中断exit130，未计通过。Pages CI已增加共享检查 |
| 真实浏览器输出 | Chromium开发源码端口5391调用实际完整验证/导出链，两个检查完成。4096×3072玩家PNG整墙/同形拆墙、重复对照、拆墙有无未公开秘密门三组逐RGBA均0差异；`wall-pixel-evidence.json`。UVTT显式Floor范围`2500,2300,10000,7000`，补边`2000,2000,11000,8000`，实际1540×1120 PNG、LOS和报告一致，补边像素留空；`uvtt-floor-crop-evidence.json`和实际PNG。不据此声称秘密字段曾泄露或Foundry真实导入已验 |
| 图片草稿保护 | 纯规则3项通过（含匹配草稿身份），开发源码真实页面两旅程通过，见`image-draft-green.log`/`image-draft-browser-final.log`；另“未载图文字编辑→返回草稿→丢弃后旧requestKey不重弹”单独1条通过，`image-draft-text-final.log`。核心同两旅程在正常生产177文件产物、5392的`/sceneweave/`子路径再次2/2通过，`image-draft-production.log`，不重复加总独立场景。覆盖原图/房间标注收起重开、导航/新建阻挡、真实刷新beforeunload选择保留、明确丢弃，以及自交房间准备失败、候选取消、真实IndexedDB新增工程QuotaExceeded失败/重试与匹配采用后清空。旧行为规则/浏览器首败保留；修复后首旅程因Playwright取消reload后的导航等待超时，trace确认旧页面及草稿仍在，改为页面直接触发真实刷新后按原45秒限制通过；第二旅程首轮已通过，不把工具等待错误记作新产品缺陷 |
| 正常整合构建 | `integrated-build-final.log`退出0：317源码模块架构、全工程类型、AI类型及正常Vite生产打包完成；未使用性能profile。`final-source-manifest.json`记录1,096份非测试源码/配置，构建及生产旅程核对时无漂移，177文件产物hash保存在`production-artifact.json`；包含另一会话此前已完成的图片增强，不能将其新增能力独立归于本轮修复。收尾14:58后图片增强/补底工作线继续修改7份源码，包含`ImageImportTool.tsx`；其草稿保护目标区段另做只读核对，其余15份本轮修复源码与所测输入相同。这些后续叠加不在所测产物和构建结论中，详见`final-integrity.json`。依赖注释和大chunk警告保留，不影响该次构建退出状态 |

本轮仅做受影响的开发自检。宽范围核心首轮运行3分钟未完成后中断exit143，另收窄为直接影响用例；两次中断均保留，不记全量通过。正常构建首轮类型错误保留于`integrated-build.log`；本轮只修自有AI测试helper，另一个旧测试会话同步完成其`terrain-surroundings`的类型收窄，再执行最终构建。真实模型收益、用户P3、跨浏览器其余矩阵、独占性能和目标VTT导入仍归09；不据本轮自检关闭。

<a id="old-test-cleanup-20261111"></a>
## 旧测试清理与必要自检（2026-11-11）

本次是获授权的测试维护，承接原回归首败分类，保留产品缺陷的实际回归。改动范围为单元夹具/成本/身份/错误合同、八模块与左右两栏导航、候选portal、当前完整v1及严格旧包、真实取消/事务故障注入和测试输出路径；不改产品代码，不提高预算或超时。原32条单元失败不能全部归为旧测试：兼容多历史转换的8条真实失败仍单独保留。其他会话的图片增强、源码修复、文档与`todo.md`未由本轮接管。

| 必要自检 | 已执行事实与边界 |
|---|---|
| 失败单元所在9文件 | 首轮107通过/2条旧错误文案断言失败；8个最终未再变的文件共95项通过。地形候选补上“编辑/切工程主动取消确切候选”的断言，最终单文件14项通过。两次有效绿色证据分别为`work/old-test-cleanup-20261111/unit/after.{log,json}`与`unit/terrain-candidate-final.{log,json}`，不是一次9文件全绿运行；状态/逐文件hash归`unit/final-status.json` |
| 类型与构建 | 普通`npm run build`已有通过证据，见`build-integrated.log`；更早被其他工作线Response类型适配阻断的`build.log`保留。最后测试修改后，根目录主工程`tsc --noEmit`及AI `tsc -p tsconfig.ai.json --noEmit`均exit0，见`typecheck-final.{log,json}`；不以此前构建证明根目录后续产品编辑。差异检查及510个本地文档文件目标检查通过 |
| 浏览器稳定输入 | 共享目录首组因外部`Workbench.tsx`热更新与`work/`trace HTML触发Vite页面重载而中断，2失败/1中断/7通过/15未运行保留于`browser-navigation-root/`，均不作为有效结论。随后冻结当前源码与测试到`source/`，关闭HMR、产物置于快照外；61文件经当前HTTP/内部保留SVG拆分后发现162项，按单worker、原测试/断言阈值、无自动重试分批续验。完整逐文件hash归`frozen-source.json`，选择归`browser-selection.json`，当前发现归`browser-current-discovery.json` |
| 冻结单元整合与阈值复核 | 较早`unit/integrated-final.{log,json}`为108过/1条原5000ms超时，取消条同阈值独立通过。最终`unit/closure-nine.{log,json}`完整9文件109项为105过/4超时：重复无操作预算原30000ms、真实候选采用/变更冷读/哨站外观原5000ms。`unit/closure-timeouts-focused.{log,json}`同阈值4条全部通过（14.397s/4.144s/3.865s/1.110s），31条仅名称筛选未执行；不合称一次109全绿，也未新增skip或提高阈值。9文件hash仍匹配`unit/final-status.json` |
| 稳定余项首批及修正 | `browser-stable-remaining/results.json`实际13过/5败/139未运行；额外runner错误仅为达到5败停止。首条完整底图接续已完成真实PNG、撤销、冷读及资源检查。3条协议首败分别为当前authoring4协商与`basemap?baseMapVersion=3`请求/当前v1基线的旧断言，历史详情首败为未从目录打开右栏；另补4文件同根AI审阅portal定位。原请求次数、GET-only、零模型、预算/身份、备份/保护/撤销断言保留。测试增量hash归`test-updates-2.json`；143条修正及未执行项续验选择归`stable-followup-tests.txt`，产品源码未变见`source-integrity-followup.json` |
| 新暴露的真实产品失败 | `building-edit.spec.ts`的`explicit junction repair`通过公开UI创建合法场景；共享命令逐步观察在首个`moveVertex`后调用身份`finish`并完整校验，尚未执行同批后续移动和`splitJunctions`即报未拆分交点。错误、截图与trace保留于`browser-stable-remaining/results/building-edit-explicit-jun-67e61-ening-in-the-same-candidate-chromium/`。该用例未删除、skip或修改业务预期；后续测试维护续验中明确保留该红灯，产品修复另行接续 |
| 续验与旧夹具最小修复 | `browser-stable-followup/`完整13过/5败/125未运行，3条协议修复及桌面复杂地图已过。素材补充用例补回“浏览素材”后在`browser-targeted-recheck/`通过；旧库原生版本30夹具从当前表清单改为`PROJECT_STORES_V3`，`browser-stable-next/`两条迁入成功/取消及源库保全均通过。该批8过/4败/1中断/114未运行后主动停止，避免旧候选父区域定位重复等待，退出130保留 |
| 填充、生成取消及共同就绪 | `browser-patched-focused/`6条中4过/2败：两条填充复制修复当前米制输入/摘要与组合工具展开后通过，两条桌面真实Worker取消/迟到隔离/重试通过。候选定位只改生成article，结构自有“候选审阅”区域未批量替换。共同保存helper在原30秒窗口同时等待保存文本、全局busy为0及画布就绪，不再先通过旧工程保存标记后只给完整采用8秒。测试增量归`test-updates-3/4/5.json`；窄屏曲线已越过采用等待，仍在真实关闭抽屉后丢失焦点，原断言保留 |

已取得后续完整旅程通过：增量历史分支/冷读/历史包/双受众像素、局部重生成采用/撤销/冷读、当前authoring4的结构HTTP创作、内部保留SVG/同化重放、秘密门4K对照及其他三组A/B、390px混合工具/历史恢复、原生200%缩放、混合生成交付/取消、面板草稿/密度、精修岩岛/海岸/旅舍离线4K、区域创作/PNG取消、组合地貌故障保全与地形生成。每组以各自完整JSON为准，不将跨批定向通过拼成一次全套绿色；当前入口不开放素材AI授权，retained内部发布及冷重开不提供AI采用的撤销记录，另用普通编辑/局部恢复验证撤销。样板切工程后需通过正常菜单重开，图层查看筛选与绘制层分开，尺寸断言依11月9日信息密度合同改为桌面32px/窄屏38px及12px内边距。

本轮新增确认且保留的产品红灯：窄屏关闭抽屉后焦点丢失（复杂地图、曲线中断及生成取消三条）、区域植被range使用无效HTML数值字符串而实际value被压成100、AI预算收尾先发terminal failed再发waiting_browser，客户端提前停止读取且没有POST本机草稿校验。最后一项在`browser-ai-closeout-diagnostic/results.json`以原30秒ready断言独立复现；真实SQLite依次为running→failed→waiting_browser，16请求/15工具，校验请求为空，相关root与冻结源码hash相同，精简诊断归`ai-closeout-product-diagnostic.json`。建筑接点中间态与保留兼容API的Floor身份冲突继续保留，不把手动结束生成当作自动收尾通过。植被三段撤销补回除revision/updatedAt外的完整文档严格比较、每步revision+1与冷读精确一致；滑杆之后仍未到达的断言不记已测。

最终61文件发现的162项均有执行记录；按每个当前标题取跨批最近完成结果为151通过/11失败、无未执行，索引为`browser-latest-evidence.json`，不是一次162项全绿。最后完整批次分别是`browser-final-fifteen/results.json`9过/5败/1未执行、`browser-final-four/results.json`1过/3败、`browser-final-three/results.json`2过/1败；此前所有首败/中断原始记录保留。米/英尺设置、手工岸线、视觉创作7项与1512/390px反馈旅程均已完整通过。反馈测试显式取消退出取点后保留的表单草稿，弹窗标题按当前统一样式核对16px；最终完整包不变、键盘与焦点断言未弱化。

新增4条真实产品失败归于3类边界，精简证据见`new-product-failures-final.json`：周边重生成与拓扑操作新建current回执后，在候选准备的`detachChangedAppearance→detachChangedOutputs`中立即被误标historical，采用及冷读均持久该状态；四刷第一次添陆采用后，岸线geometry按手工编辑合同转为manual；第二次显式挖水却沿只接受自动管理的轮廓分支被拒绝，显式笔刷的持续编辑权限衔接有缺口，不能以取消人工保护修复；视觉AI已完成创作4协商与生成，但当前包装差异路径缺少业务标签映射，显示`visual.base.base.lights/fogs`而非点光/区域雾。原current、连续四刷和业务标签预期继续保留，不用改断言消除失败。四刷先验证原scope拒绝且hash/revision不变，再通过可见精确字段授权真实整曲线及边带范围；首次采用、revision+1、700mm半径、10mm规范落点、持久scope及资源保全已通过，第二刷之后的铺草/清空/双受众PNG未到达。周边/拓扑采用冷读已观测，后续撤销未到达；视觉AI采用/撤销与其后授权细节未到达，不记为通过。

11项失败为原7项加上述4项；对应8类产品问题：Floor身份合并、建筑原子中间态、窄屏焦点、植被range、AI预算收尾SSE、地形新回执、连续显式笔刷权限与AI视觉标签。兼容迁入8条单元失败仍单独保留。冻结产品1496份文件无漂移，61份测试及5个helper与根目录一致，独立todo未变，见`final-integrity.json`。本轮runner均已结束、冻结Vite停止，没有测试/构建/服务器继续运行。

当前执行日志归本机忽略目录`work/old-test-cleanup-20261111/`。导航发现/静态检查只证明可解析；测试名称含“production”而本次使用开发入口时仍只记DEV集成。正式视觉、容量性能、真实模型、VTT目标导入和用户P3各自保持待验。下一步和未收口范围只在[07](../07-roadmap.md#old-test-cleanup-20261111)维护，不覆盖原回归冻结结果。

<a id="system-regression-20261111"></a>
## 全系统回归与中断接续（2026-11-11）

按用户“回归全系统已实现能力，看看有没有问题”的要求，只读执行并归因，没有修复产品或测试。证据根为本机忽略目录`work/system-regression-20261111/`；源码复制于2026-11-11 11:47（北京时间），HEAD为`ebee8d016a8254234bb011fe1d5b6dfc480fc3dd`。`source-manifest.json`绑定1,855份文件，`frozen-artifact.json`绑定正常生产构建及176份产物，生产预览为5311。接续核对源码和产物均无漂移，详见`continuation/resumed-integrity.json`。根目录随后已有独立提交及图片增强等编辑，本次结果仅属于原冻结；固定素材、用户数据与`todo.md`没有因回归而修改。

| 范围 | 实际结果与解释 |
|---|---|
| 正常构建与共享检查 | 正常`npm run build`通过；`check:shared`及`tsc -p tsconfig.shared.json --noEmit`失败，详见`build.log`、`shared-boundaries.log`、`shared-types.log`。不能由普通构建推定共享检查通过 |
| 完整单元 | 452文件、4,346项：4,313通过、32失败、1跳过。32项归为8个保留兼容迁入回归、18个旧夹具/断言失配、6个按原超时单项复跑通过的超时。完整集首败保留，未重新宣称全绿；失配断言之后未到达的检查仍未获证。结果及归因见`unit/full-results.json`、`unit/failure-classification.json`、`continuation/final-unit-review.json` |
| AI服务 | 26文件、379项，首轮378通过、1超时；该项按原Node24及原60秒限制复跑通过。原首败与补验分别保留，非同一轮379全绿；无真实模型、外网服务或计费调用 |
| Node工具与容量夹具 | Node工具32/32，正式容量夹具8/8；聚合夹具首轮4通过、2断言失败、2超时，后两条按原30秒分别通过，2条建筑玩家投影误拒绝仍存在。夹具正确性不等于容量或性能验收，见`continuation/final-service-shared-review.json` |
| 默认浏览器范围 | 开发211项（118通过、89失败、4跳过）与生产147项（104通过、41失败、2跳过），合计358项：222通过、130失败、6跳过。中断恢复只合并同一测试的最终完成结果，没有重复加总；后半程把已确证旧定位的单动作等待改为15秒，测试级及断言级限制保持，原首轮也保留。不能将130失败全部算产品缺陷或全部算旧测试 |
| SVG一致性补充组 | 原配置、零重试、3引擎18项完整结束：Chromium6/6、WebKit6/6、Firefox3通过/3失败，其中2个导入检查等待失败、1个下载/测试超时。15份完整facts保留；Firefox原因尚未确证，无自动重试或延长阈值后通过的结论。见`svg-determinism/results.json`、`continuation/svg-determinism-review.json` |
| 完整视觉补充组 | 室内和岩岛均完成正常导入、双受众PNG及冷读，随后在已移除的资源面板“对象”tab定位失败。确认重复根因后向本轮runner发SIGINT，退出130：2失败、1中断、12未运行。阶段记录不替代完整facts，见`formal-visual/results.json`、`continuation/formal-visual-review.json` |

确证的产品/公共合同问题如下；同一根因的多条失败不当作多个缺陷：

- **当前首页迁入补造结构连续性**：`src/shared/migration/development-project.ts`在旧历史没有`structureTokens`时，以相同lineage/scene/序号生成新证明。真实“加门→删除→同ID重建”的严格旧快照迁入后被判为同出生，违反不凭同ID补造连续性的合同。当前首页迁入17项通过用例保留真实结构池，没有覆盖此条件；未证明页面恢复可利用、源数据损坏或丢失。最小复现为`ai-tools/legacy-structure-current-diagnostic.json`。
- **保留兼容API多历史转换失败**：`src/compat/legacy/convert.ts`分别为当前及历史生成Floor身份，合并时同Floor出生冲突，导致8项迁入失败。此API与首页一次性迁入是不同调用链，不能把前者失败直接说成首页迁入不可用。
- **玩家安全范围误计不存在的阴影**：`src/shared/projection/presentation-contract.ts`的普通物件范围对`shadowClass=none`仍添加`contactShadowMm*4`边距，而真实画法和contact元数据均排除该阴影。500/2000建筑夹具的真实私密图像已被遮罩覆盖，却因额外每边200mm范围被拒绝；+1000mm平移后仍可复现。保持私密而仅关闭contact透明度即可通过。必须修共同范围合同，不删除真实遮罩检查；证据为`ai-tools/aggregate-privacy-current-diagnostic.json`。
- **共享平台边界破坏**：`path-attachments/endpoint-plan.ts`、`state.ts`、`validation.ts`与`surface-details/road-camp-patches.ts`四处直接调用`structuredClone`，使平台隔离检查与无DOM编译失败；相关当前源码与冻结一致。
- **固定样板与首页图来源漂移**：六张缩略PNG字节仍匹配原manifest，但六份当前场景源摘要全部不匹配；摘要匹配`7cf25f2`，`231cd05`更新源而未重建图。书房原主题45°阴影被后来补入的visual默认135°覆盖；全局光照机制有设计依据，但14仍规定45°，未找到专门授权该固定样板切换方向的证据。不能仅改摘要掩盖来源过期，也不能直接判当前画面等价或P3通过。源码/提交关系见`continuation/final-unit-review.json`的`supplementaryVisualAudit`。

图片RGB需区分冻结：旧生产用例有31个半透明像素发生RGB差异，最大通道差8，不透明像素保持；符合Canvas预乘量化，但不满足原RGB保真合同。另一图片工作线已改软件编码并保存独立构建/生产复验记录，见[精细选区台账](#image-import-boundary-editor-20261111)，不把该修复回写为本轮原冻结通过。接续另对当前代码作极小纯Node诊断，确证合法4097×1裁片可提取，却被复用的`png-rgba.ts`之4096边/1600万像素上限拒绝；图片合同允许8192边/3200万像素。探针结果在`continuation/final-service-shared-review.json`的`new-image-canonical-encoder-dimension-regression`项，不能由小图保RGB证明完整大图链路已修复。

接续按原配置串行复验3项：390px普通曲线提交完整通过；图片精细选区在原冻结仍因RGB量化失败；390px曲线中断在旧helper等待“关闭资源面板”至原360秒超时，此前首轮8秒busy失败没有在本次同阶段重现。结果1通过/2失败保留于`browser-production/recheck-results.json`及`continuation/curve-image-recheck.log`，不是修复后的绿结果。区域确认框“被顶栏挡住”已排除为产品布局缺陷：正常旅程在相同位置可点击，测试`settled()`调用`projectBackupButton`打开导出菜单后未关闭，随后VTT按钮拦截确认框；普通关闭菜单即成功。最小命中与实际点击证据为`continuation/regional-menu-hit-test.json`及对应图，无需改产品布局。

本轮不覆盖真人美术/P3、实际模型收益、目标VTT导入、真实小团、全矩阵性能或根目录新改动；运行中的长链耗时存在并发干扰，不作为正式性能。整改顺序只在[07](../07-roadmap.md#system-regression-20261111)维护，正式验收仍从09执行。默认浏览器最终分类和原配置复验见`continuation/final-browser-review.json`，首轮失败保留，不通过改阈值、删断言或恢复旧UI制造全绿。

<a id="image-import-quality-20261110"></a>
## 图片拆解画面质量整改（2026-11-10）

用户指出程序版明显逊于最初的图像模型样板。原图复核发现蓝毯真实右沿约x819，钢琴右半直接压木板；旧配方将毯扩到x875，并把整琴底部填成蓝色，导致琴形补丁。旧钢琴轮廓也切掉部分顶盖。最初模型样板重画了更宽地毯和高分辨率细节，两份结果的布局保真与美术细腻度分别比较。

本轮增加每层最多8个补底分区、无缝纹理衔接、显式0–8像素残影清理、100%–400%近景与拖点/撤销、已拆层精修。原像素裁片保持精确轮廓，背景使用独立清理遮罩。颜色校正取同材质未遮像素，限制边界阴影向内传播，自动延续物件内的材质标签到修补外沿。旧配方缺省仍使用原平铺和0清理。

| 自检 | 实际结果及附件 |
|---|---|
| 算法、事务与冷读 | 标定、草稿、pixels、repair、工具会话、工程/个人item及快照保存共9文件42项通过，记录 `work/image-to-project/quality-remediation/unit-final.log`。跨两底材、清理外沿、孔洞/透明、无效donor、预算及旧平铺均有定向检查。实际修补范围并集外改变0像素，事实归 `repair-diagnostic/final-facts.json`。 |
| 近景页面 | `tests/image-import-quality.spec.ts`实际通过400%拖点/精确撤销、三视图滚动位置、在物件内部画的蓝毯/木板两区、采用后PNG真实两色。首轮跨区混色结果保留，算法修正后严格像素期望通过。最终在同一正常产物串行复跑本项及原手工/提案流程，3/3通过，21.9秒，日志为 `quality-remediation/browser-final.log`。 |
| 真实原图项目工具 | 修正版配方含原窄毯、琴下多材质和宽木板取样。MCP候选 `quality-remediation/output-wide/candidate-1-acb7c261-c0dc-407e-addc-c0cf4a655ecc/`完成落盘冷读，2048×1843预览RGBA差异0，projectHash `be9379884e5993a5323162b4e73efa13a532c50cdd1a8c051f415bd28a960a70`。 |
| 正常生产页面 | 该候选的 `ui-quality/`含页面原图上传/配方采用、移琴露窄毯、移毯露木板、r6保存/首页重开、琴旋转12°后r7及自动本地item/编辑副本实际记录。错误0。页面全景及对应近景已查看，琴形蓝斑和大块暗影已去除，木板接头与局部取样重复仍可见。 |
| 构建 | 正常 `npm run build`最终通过，日志 `quality-remediation/build-final.log`。早先并行VisualPanel/氛围类型错误日志保留其时点。本轮正常Vite产物归 `quality-remediation/production-dist/`。 |

真实图试验先出现贴边阴影被调和扩散、窄木纹donor自身形成重复暗带，以及只画到物件内的材质分区在外沿退回默认色等问题，分别以显式清理范围、宽纹理取样、材质标签延拓修正。每次图和事实保留在 `repair-diagnostic/`，失败候选及校验拒绝保留原目录。冷导入还复现shared新依赖路径的schema初始化循环，revision小schema改为首次使用时缓存，领域检查保持，实际冷读及快照保存回归通过。

当前程序结果保留原图约430×385像素房间的细节上限。木纹连续性、复杂阴影和精细美术仍需目视校正，本次未宣称达到最初模型重绘清晰度或用户P3签收。开发状态只回填07，正式验收仍从09执行。

<a id="image-import-tool-20261110"></a>
## 项目图片拆解工具与本地item开发自检（2026-11-10）

用户确认页面人工/程序入口与模型tools共用同一拆解能力，拆出物件在采用后自动安装本地item并可有限编辑。本轮在原图重新执行项目内像素提取与donor补底，素材来自原像素及程序纹理平铺。此前图像模型重绘样板及其限制保留在下节。

| 检查 | 实际结果 |
|---|---|
| 单元与类型 | 共享标定、草稿、pixels及通用工程、个人库、item副本、工具session共7文件28项通过。正常 `npm run build`通过，源码/应用边界检查、完整TypeScript与Vite产物归 `work/image-to-project/native-build-final.log`。构建的大chunk提示保留。 |
| 通用页面 | `tests/image-import-tool.spec.ts`使用可再分发的96×64程序PNG。手描标定/房间、琴/毯逐层拆解、三种像素、普通采用与真实下载包、自动我的素材、冷开续编均通过；同源JSON配方的错误摘要拒绝与重放路径也通过。手描用例后扩展有限编辑并复跑通过，600mm图宽/500mm占地与新名称冷开保留，三项素材可放置。 |
| 项目MCP重拆原图 | 实际initialize、tools/list、比例/房间/逐层extract、旧代次拒绝、preview及build调用，成功候选 `work/image-to-project/native-tools/candidate-4-d6d946d9-5c17-4d97-bbc1-03caac3fcbd8/`。落盘冷读projectHash `10fb128ef9d80ba5944d703725ca02b47ee84d52328f38c9e368ef2b594518c7`，2048×1843预览RGBA差异0。原图轮廓与取样由人工给定，本轮未计供应商自动语义识别。 |
| 同一原图的正常生产页面 | 隔离正常产物 `work/image-to-project/native-production-final/`。首页上传原图、载入MCP配方、预览采用，自动生成两项我的素材；将琴移至(5800,8200)、毯移至(2700,8200)mm，查看原位补底，撤销/重做后保存r6，首页冷重开位置保持，再旋转琴12°保存r7。我的素材中将琴编辑成“原图钢琴 · 便携版”，图宽1600/占地宽1400mm，原条目与副本共存。页面错误0，真实截图/下载包及记录归候选的 `ui-final-fixed/`。 |
| 共用执行层 | MCP候选与正常页面采用后实际下载包中的3项PNG资源逐字节SHA一致，记录为 `ui-final-fixed/common-engine-verification.json`。 |
| MCP协议边界 | 独立宿主的批量stdin与立即EOF、通知静默、错误JSON-RPC、旧代次拒绝与按序执行专项通过。主代理另以5请求立即EOF复核，5个应答、9个tools、旧代次拒绝、最终generation1及退出0，记录 `work/image-to-project/native-tools/protocol-verification.json`。 |

开发中发现并修正两项真实页面问题。空库入口的可空状态比较曾进入空值分支，修正显式存在性检查后正常。item编辑草稿曾触发全局草稿保护而锁住自身表单，新增允许完成自身catalog草稿的禁用条件后，开发测试与原图生产旅程均通过。首轮失败截图保留在候选 `ui-final/`，最终成功单独归 `ui-final-fixed/`。另有一次扩充琴凳轮廓后donor与选区相交，被像素工具拒绝，改选独立露出区域后成功。

MCP宿主的首轮EOF测试还定位了私有Vite默认stdin结束监听抢先退出的问题，修正为宿主接管EOF、顺序排空请求再清理。候选状态同时收束为running后完整冷读再发布complete，失败发布failed；协议错误按JSON-RPC返回。修正后专门协议检查通过，像素/工程生成继续消费同一模块。

支持范围为单房间人工轮廓、颜色连通建议、最多64个拆层、纹理取样平铺与固定副本编辑。原图只有1280×840，补底仍有可见拼接和重复纹理，复杂轮廓、阴影及不可见细节需要校正。相对高低的纯草稿基础已有，完整高差页面、自动墙网、多房共边和语义识别仍按07接续。本次属于开发自检，正式P3、完整09和跨设备性能保持各自待验。

<a id="image-room-sample-20261110"></a>
## 图片分层琴房样板开发自检（2026-11-10）

用户授权先实现右上房间的移琴露毯、移毯露板及保存重开续编，并行推进独立基础。实现包括 `image-room-sample.ts` 工厂、`shared/image-import/` 标定与标注草稿、`tools/image-import/build-room-sample.mjs`。固定图摘要及设计见[专题](../reference/image-to-project.md#sample)，开发状态只在[07](../07-roadmap.md#image-to-project-plan)维护。

| 实际检查 | 观察与边界 |
|---|---|
| 纯模块与类型 | `npx vitest run src/platform/browser/content/image-room-sample.test.ts src/shared/image-import/calibration.test.ts src/shared/image-import/draft.test.ts` 三文件10项通过；`npx tsc -p tsconfig.shared.json --noEmit`通过。覆盖分层原生命令、比例坐标、正负标注与确认保护、依赖/高低循环、撤销和迟到代次。 |
| 完整包与真实像素 | 最终 `work/image-to-project/room-sample-v4/result.json`为complete。实际输入先经现有PNG规范化，保留原始/规范资源摘要；落盘复读并在另一页面完整冷导入，projectHash为 `9243b80eba30b76dead78ed8792ed0ad101739373fc609182941b068e3665acd`，2048×1839预览RGBA差异0。 |
| 正常生产页面 | 正常Vite产物位于独立 `work/image-to-project/production-dist/`。从首页打开实际完整包，普通详情字段分别移琴至(5800,8200)、移毯至(2700,8200)mm；实际查看前/后图，原位依次露毯和木板，下载包核对下层内容保持。撤销/重做后r6保存，刷新并从首页最近工程重新打开，位置保持；继续旋转琴12°后保存为r7。页面错误0，记录与四张图及实际下载包归 `room-sample-v4/ui-final/`。 |
| 构建 | `npx vite build --outDir work/image-to-project/production-dist`通过。此次 `npm run build`在类型阶段失败，指向并行哨站 `island-surface-transitions-v2.ts:36/37` 的possibly undefined与 `natural-rock-steps.ts:65` 的polygon类型，共3处；本次样板文件未出现类型错误。 |

首轮 `deliverable/result.json`保留源PNG色彩元数据被严格校验拒绝的结果，工具改走已有规范化路径后 `deliverable-v2`成功。随后样板试设墙面着色时缺固定派生位图，完整校验拒绝，失败留在 `room-sample/result.json`；撤回该外观改动，最终保留默认墙顶。页面检查脚本的两次错误等待（首页导入后等待工作区确认框、刷新后等待自动恢复）已修正为正常首页导入及最近工程打开，原失败附件保留，最终实际旅程通过。

图像模型重绘与遮挡补全的像素和原图存在差异，声明比例为25mm/px，实际比例待标定。当前仅琴与小蓝毯独立编辑，底板其余陈设及部分墙描边仍为固定像素。自动墙网、交互分割、页面标注和完整正式矩阵仍待实施；本次属于开发自检，视觉P3、全仓构建与正式性能各按实际范围另行收口。

- [36-workspace-and-asset-library-proposal](#doc-36)
- [37-workspace-and-asset-library-handoff](#doc-37)
- [38-u1a-workspace-validation](#doc-38)
- [39-u1b-layout-validation](#doc-39)
- [40-u2a-catalog-contract](#doc-40)
- [41-u2b-catalog-validation](#doc-41)
- [42-content-and-m1d-continuation](#doc-42)
- [43-content-m1d-validation](#doc-43)
- [44-full-regression-validation](#doc-44)
- [普通事务预算开发自检](#manual-transaction-budget-20261105)
- [层级组合运行时合同开发自检](#aggregate-contract-20261105)
- [局部坐标与完整工程表示开发自检](#aggregate-coordinates-20261105)
- [边界接口、空间候选与失效服务开发自检](#aggregate-boundaries-20261105)
- [完整建筑组整体操作开发自检](#aggregate-building-transform-20261106)
- [层级组合代表性整合与开发交接](#aggregate-integration-j-20261106)
- [当前完整v1容量、性能与视觉验收前置及结果](#current-formal-acceptance-20261106)
- [不可变会话快照与保存/预览架构整改](#workspace-snapshot-20261108)
- [工作台信息架构与左右分工实施](#workspace-information-architecture-implementation)
- [四项核心能力六步收束与开发自检](#core-convergence-20261109)
- [目录与保存重复编码整改](#snapshot-remediation-20261109)
- [性能运行器草稿退出工具整改](#validation-tool-remediation-20261110)
- [温带荒野素材、林中哨站与河岸山道整改](#wilderness-remediation-20261110)
- [生成链路确切快照消费整改与开发自检](#generation-certificate-20261110)
- [地图细节首轮工具与导航开发自检](#map-detail-tools-20261110)

<a id="map-detail-tools-20261110"></a>
## 地图细节首轮工具与导航开发自检（2026-11-10）

用户在确认细节主线与文档后授权开始，并允许并行互不影响的工作。任务状态和接续只归[07](../07-roadmap.md#map-detail-mainline)，交互与支持边界归[架构](../reference/editor-and-architecture.md#detail-workflow-and-road-tools)、[地形](../reference/terrain-generation.md#terrain-sculpting-tools)及04/06，正式验收仍归[09](../09-quality-plan.md#map-detail-acceptance)。本轮由本会话主代理收口`Workbench`、`AssetCanvas`和草稿守卫，三个subagent分别负责道路规则/面板、导航与测试、高程规则/面板；未向其他用户会话派发消息，保留其他工作线的脏改动与独立`todo.md`。

### 确切改动

- 导航按场景→生成→地形→建筑→素材与布景→氛围排列，AI/历史独立固定底部；真实DOM顺序、方向键/Home/End与短屏滚动消费同一分组，模块ID和草稿不重置。
- 手工道路在确切文档、当前Floor、净宽、显式支撑、隐藏范围及受众上下文中预计算合法门前/道路端点/中心线目标；12px捕获、18px保持，Shift只在活动绘路临时关闭语义与网格辅助，仍量化整数毫米。画布显示真实方端帽/miter2/bevel带区及吸附目标/方向；不在每次鼠标移动中全验场景。
- 道路面板可显式检查完整带区通行，保留原经由点在总512节点/128点预算内找绕行、组合后复核；结果先披露路线和实际支撑，再明确替换草稿及所列支撑。仍经原室外预览/确认/采用链；既有合法草稿不被统一要求当前可通行，不改变门状态、宽度或范围外内容。
- 高程入口冻结明确选择的完整地形面、文档身份和checkpoint；独立`elevationForm`防止与其他室外草稿互相覆盖。简单裸整面可滚轮升降或数值设高、多面统一平整及真实地面取高。滚轮仅在可见活动工具和蓝色所选整面轮廓内累积草稿；普通模式仍缩放，取高只更新目标。预览后确认一次采用/一次撤销，取消和迟到请求均不写工程。
- 未新增工程/schema/资源或算法版本；采用保存原有道路实际中心线、净宽、支撑与地形高程。资源全验、基线、锁、依赖、保护/CAS、预算、玩家投影及保存语义沿现有路径。

### 开发自检与首败

证据位于被Git忽略的`work/detail-mainline-implementation-20261110/`；同机保存正常构建日志、单元日志、生产页面日志、截图及实际完整工程下载。没有正式性能、跨浏览器、目标画风或用户P3结论。

| 实际检查 | 结果与材料 |
|---|---|
| 道路吸附/绕行及高程规则 | `unit.log`，3文件38/38通过。包含缩放容差、竞争目标、私密/隐藏/锁/支撑、真实带宽与障碍、经由点/预算、正负高程/多面平整、整数溢出、取高及复杂依赖拒绝 |
| 正常生产构建 | `build-final.log`，`npm run build`退出0，包含架构边界及应用/AI类型检查、正常Vite构建；既有Rollup注释、静态/动态导入与大chunk提示保留，不作性能声明 |
| 正常生产UI | 本机正常preview `5257`、Playwright bundled Chromium、单worker串行；`playwright-final.log`5/5通过：道路Shift、高程完整旅程、桌面导航、900px/390px窄屏。未启用性能API或编辑器内部测试接口 |
| 补充边界复测 | `playwright-boundaries.log`2/2通过，复验跨模块暂停/返回恢复、素材详情遮挡、轮廓外滚轮、取高、等待预览时取消、跨工程重建道路工具配置；只统计为同两条旅程的扩展，不累加成新的正式通过数 |
| 失焦与最终类型复核 | `playwright-road-focus.log`1/1复测通过，失焦清除自由光标并恢复后再次吸附；`typecheck-final.log`最终`tsc -b`退出0。`document-links.json`核对本轮脏文档新增本地链接136项，无缺失；`git diff --check`通过 |
| 实际下载核对 | 高程草稿取消、预览取消与等待中取消的工程各entry hash保持；采用只改所选高程及正常revision/时标，资源hash保持；单次撤销恢复原地形及正常递增revision。普通滚轮不改工程；道路取消保持完整工程hash |

道路斜线投影曾有一项失败：数学500.5受浮点误差落到500。整数输入改用BigInt有理投影后，同例及道路全部24项复验通过，最终与高程一起38/38。静态复查还修复父effect覆盖新道路配置、失焦后旧cursor残留、忙碌/平移时Shift更新，以及高程详情隐藏仍响应、返回草稿未恢复模块、取消后的迟到候选；对应生产旅程补测，未覆盖的正式场景不作通过推定。

### 保留范围

首轮冻结时：门前吸附只复用公开、打开、未锁的正交外门；GM私密道路只在明确私密绘路上下文可作为来源，公开绘路不消费私密来源。门口详情快捷接路、生成器/样板接线、路口和地表视觉融合、局部台地/洼地、复杂地形依赖自动联动、背景透明、植被配方、氛围对照及连续高度场当时未完成；门口/局部高程/氛围的后续切片见下文，不反写首轮结果。高程先拒绝建筑、完整道路、连接、物件/轻量装饰真实占地、覆盖/散布、显式地形边和绑定曲线等复杂依赖，图片外扩不当作支撑。

### 同日接续：门口接路、局部高程与氛围配方

用户继续授权并行开发。三个subagent各自实现门详情/道路面板、局部塑形纯规则/面板、氛围配方/面板，主代理收口共享组合根、草稿守卫、编辑渲染和文档；其他会话、固定样板与性能任务未派发或重跑。

- 门详情用已采用门及独立道路净宽准备确切门前首点；核对文档引用/checkpoint、同Floor、完整实际支撑、隐藏与依赖锁后一次性交接普通道路草稿。内门、闭锁/秘密门、净宽/整数锚点或支撑不符明确拒绝；不带入未采用门窗字段、不自动开门。
- 单一简单裸面严格内部闭环新增更高覆盖优先级的真实高程面及全边阻挡cliff。原面/坐标/身份/固定材质源和区域外保持，新面新出生；已有物件/道路/建筑/叠加/曲线/管理规则等复杂依赖拒绝。输入最多48点、实际完整展开仍受256预算；台地/洼地都不自动补坡。冻结目标/操作ID/document/checkpoint，跨模块暂停，取消及等待预览取消释放迟到候选。
- 中性、白昼、阴天、黄昏、月夜五套配方用实际环境/滤镜/雾参数进入原候选/采用/一次撤销。首轮单Floor，环境/调色全图、雾取楼层完整边界；固定槽位避免叠加，手改/启停/私密/锁或ID占用拒绝覆盖，独立手工灯/雾/滤镜保留。中性只移除预设自有记录。
- 主持人原色对比仅修改已校验受众投影的临时drawing；关闭环境染色/曝光修饰、点光/雾/滤镜，保留材质、几何高差、世界光向和接触阴影。完整资源验证/秘密mask/工程/历史及正式PNG保持原路径，工程冷开清除对比状态。

证据在忽略目录`work/detail-mainline-continuation-20261110/`；只表示本机开发自检，不表示正式性能、目标样板视觉、跨浏览器或P3通过。

| 实际检查 | 结果与材料 |
|---|---|
| 规则与投影 | `atmosphere-unit.log`6/6；`detail-unit-final.log`道路6+塑形14+对比2共22/22；非空灯/雾/滤镜的比较测试补强后`comparison-unit-final.log`2/2。共4文件28个不同用例，不把复跑累加 |
| 正常构建 | `build-final.log`，架构边界、应用/AI类型检查与正常生产Vite构建退出0；既有Rollup注释和chunk提示保留 |
| 正常生产旅程 | 自有preview5257、bundled Chromium、单worker，`playwright.log`3/3：门口真实样板导入→内门拒绝/首点参数/取消/采用/单次撤销；裸面→局部真实面+4cliff→撤销重做/备份导入/冷开；氛围预览取消→切换不叠加→手工效果保全/撤销/冷读/导入 |
| 取消与暂停扩展 | `playwright-sculpt-boundaries.log`同一局部旅程1/1复验，通过跨模块点击不加点、返回恢复、等待预览时普通DOM按钮同步取消、迟到无候选/完整包hash保持；不另算不同旅程 |
| 原色与公开输出 | 同视角实际canvas PNG hash切换/还原，镜头尺寸/zoom保持；对比开启时完整备份document/appearance保持，实际玩家4096 PNG再次导出文件hash相同。冷开与新上下文导入对比状态均false |
| 窄屏 | 390×844正常生产检查见`playwright-narrow-final.log`；逐按钮检查原色对比及地面查看不越过视口，截图核对工具条 |
| 最终完整性 | `typecheck-final.log`最终`tsc -b`退出0；`document-links.json`核对当前脏文档新增本地链接180项无缺失，`git diff --check`通过，独立`todo.md`无改动。`verification.json`冻结本轮20个源码/用例文件hash及实际日志；自有preview5257已停止 |

首次规则检查暴露测试把48点输入上限误当作完整展开预算保证，实际预算正确拒绝；改用16点成功、48点超256拒绝及49点输入拒绝，未放宽额度。比较测试最初直接使用旧格式fixture，改为明确当前格式后通过。静态审查补非空效果清除断言；窄屏首张截图发现新增按钮挤压旧地面查看，工具条改为换行并补按钮边界检查。旧失败日志和初始截图保留。

尚未覆盖：任意局部切并/自动支撑重绑、带复杂依赖塑形、连续高程笔刷、多Floor氛围、生成器/哨站样板自动接路与地表/植被融合、透明背景及正式视觉验收；工作状态和下一步统一回[07](../07-roadmap.md#map-detail-mainline)。

### 同日接续：哨站门前道路、地表与植被编排

本次主代理整合主题样板/密度入口与生产旅程，三个子代理分别负责独立`outpost-roads`、`outpost-surfaces`、`outpost-vegetation`规则和测试。新哨站采用独立`sceneweave-outpost-layout@1`布局身份，仍消费原温带荒野固定v2材质/物件/组合；当前完整v1、数据库和固定源不变，旧工程不在打开时重写。实际门前首点为`(6750,12311)`mm、净宽1400mm；四条道路肩带及两块营地接片只作为持久外观保存，后续改路不自动重贴。树/灌/草分别保存三个`scatter-cell-v2`组，疏16/20/6、适中25/23/13、密34/27/21，真实占地避让完整道路、房屋、营地和中央活动空地。

证据根为被忽略的`work/outpost-detail-20261110/`。用户随后授权新的并行开发，故这份结果只绑定保全的`source/`和`production/sceneweave/`，后续渲染/高程改动不继承本次构建结论。

| 实际检查 | 结果与边界 |
|---|---|
| 规则与完整包 | `unit.log`4文件28项通过；植被最后补组ID跨类型占用和支撑层锁，`vegetation-final.log`7/7通过。共29个不同用例，覆盖真实门口、完整带宽、地表物理不变、三档实际成员、人工/删除/锁及晚失败原子保全；目录完整包真实资源端口冷读和其余五包固定hash保全通过，不把复跑累加 |
| 正常构建 | `build.log`架构边界、应用/AI类型和正常Vite构建退出0；既有Rollup及chunk提示保留，没有性能构建 |
| 正常生产UI | 自有preview5261、bundled Chromium、单worker。`playwright.log`的密度旅程通过：实际三包/资源hash/完整通路与当前工程备份不变；哨站旅程中断后修正测试审阅步骤，`playwright-final.log`同案1/1通过：哨站与河岸山道真实导入、编辑/人工成员、一次撤销、冷开及四张双受众4096实际RGBA。不同旅程共2项；不记首轮为全绿 |
| 输入与看图 | `first-wave-integrity.json`核对1162份源码与176份正常产物保全一致；实际查看哨站整图，腐土肩带与树群已落图，路径仍偏折线、道路入营地仍有10mm描边/端帽。目标自然画风和用户P3未签收 |

首轮植被开发曾误引用不存在的几何导出，改为实际存活实体ID收集后规则复验通过。生产旅程最初把受管树木移动当作即刻编辑，未确认现有室外候选就等待备份，卡在正确禁用的导出按钮；保留trace并主动中断。测试补真实影响范围确认/采用后，同一正常构建通过，产品保护未放宽。

上述实现尚不包含道路与营地地块联合去线、草岩/崖脚融合、已有复杂场景自动重排、持续附着或连续高度场生产化。正式视觉、跨浏览器、性能与P3仍按09执行，未提交、推送或发布。

### 同日并行接续：营地接头、覆盖层高程与高度场原型

用户要求寻找可并行项并一起开发。本次三个子代理独立负责道路描边/受众投影、整面高程规则/面板、忽略目录高度场原型，主代理负责共同文档、完整样板和实际生产UI整合。没有并行更改严格模型、固定资源或组合根；仍是当前完整v1，未提交、推送或部署。前一小节的冻结和限制保留，不以新结果覆写。

道路入地形只去除完全兼容公开表面内的道路描边：同Floor、同用户层、单一同高程，世界对齐底材参数完全一致且不透明，无局部覆盖、受管材质片或实体/图层滤镜；真实地形绘制顺序与房间遮挡参与判定，只有线段两侧都处于兼容顶面才裁掉。关系在受众/编辑显隐过滤后临时派生，私密/隐藏地形不参与；公开道路超过128、地形/房间任一超过256时保留原线。没有改变道路填充、命中、物理、支撑或持久工程。哨站地面六条肩带保留，营地无覆盖底材接头可去线；整体折线感及自然画风仍待视觉整改/签收。

整面高程现在允许纯`SurfaceStyle.overlays`随整面升降/平整保留世界XY及完整材质参数、身份和来源。受管`surfaceRules`、道路/建筑/散布/装饰/高差边/视觉曲线及锁等原依赖仍明确拒绝，非法覆盖层仍完整校验。它不提供复杂支撑自动联动或局部塑形覆盖支持。

证据根为被忽略的`work/detail-parallel-20261110/`；原型在`work/heightfield-prototype-20261110/`。

| 实际检查 | 新鲜结果与边界 |
|---|---|
| 规则与事务 | `unit.log`9文件90项通过，覆盖新哨站/其余五包固定hash、道路描边/投影和高程范围。随后仅把测试的fake-indexeddb动态导入改成仓库已有的静态副作用导入，`elevation-final.log`同组27/27通过，不累加复跑数。真实1px资源Workspace检查取消/过期/采用/撤销/重做/冷读、源/身份与范围外编辑保全 |
| 正常构建 | `build.log`首次被测试动态导入触发的TS7016拒绝；修正导入后`build-final.log`架构284共享模块、应用/AI类型及正常Vite构建退出0。既有Rollup/chunk提示保留，没有性能构建 |
| 正常生产UI | 预览5261、bundled Chromium、单worker，最终产品源码/产物未再修改。`playwright.log`初跑3通过/1失败：道路默认吸附/Shift释放、裸面滚轮草稿及哨站/山道完整旅程通过。覆盖层同案以最终合法夹具在`playwright-overlay-resource-final.log`1/1通过，实际普通导入→升高300mm→完整范围确认/采用→一次撤销→最近工程冷重开，完整样式/源资源及冷开条目hash一致。共4条不同旅程，不把初跑写成全绿 |
| 真实PNG及看图 | `browser/`保存哨站及河岸山道玩家/主持人四张4096×3186 RGBA，主代理实际查看哨站输出。`png-comparison.json`与前冻结逐像素比较：哨站两受众各5566像素改变，山道两受众0像素改变；`sample-document-comparison.json`排除revision/创建与更新时间后，实际下载的哨站文档仅另存sceneId不同，其余顶层字段完全一致。不以差异数证明整体美术达标。便于查看的副本为`outpost-balanced-player.png`、`outpost-balanced.sceneweave` |
| 冻结保全 | `product-hashes.json`记录1341份源/产物/旅程输入，`integration-integrity.json`核对1340份不变，唯一差异是修正过的`tests/map-detail-tools.spec.ts`；`verified-input/`保全实际产品源与dist，最终旅程另留确切副本/指纹。不沿用前冻结构建结论 |
| 隔离原型 | `self-check.mjs`14组规则通过；三个模块语法检查通过。主代理独立`ui-check.mjs`真实指针检查预览无历史、Esc取消且松手不提交、整笔一次提交、撤销/重做恢复Canvas hash、坡度切换改变绘图，390px无横向溢出，页面错误为空；`ui-facts.json`与桌面/390px截图保留。未使用产品测试接口 |

覆盖层旅程的前四次失败及截图/trace分别在`browser/`、`browser-overlay-final/`、`browser-overlay-identity-final/`、`browser-overlay-complete-final/`，日志同名保留：夹具先选了仅适用房间的材质，改后缺少新增覆盖层出生证明，再补身份后又与既有外观源不一致，改用正式完整模型事务后还因tint派生实际位图未物化而拒绝。最终夹具复用实际下载的地形材质，以旋转/透明度覆盖构造，正式事务同步身份和不可变源，再走普通文件导入/实际资源校验；产品守卫未放宽。此前手改完整包的假设已撤回，测试不把直接改scene.json当成合法工程。

道路规则开发曾因隐藏支撑连带隐藏道路、另Floor缺图层、私密几何/paintOrder和错误文案的夹具不符合现行合同而失败；修正夹具后相关四文件34项通过，随后纳入上述90项整合。图像差异分析环境未装Pillow，改用仓库现有Playwright PNG解码器读取实际RGBA，未安装依赖或改图。

高度场原型采用64/128节点、500mm间距的整数毫米高度数组（31.5/63.5m范围），双线性取高与同一曲面的解析坡度；升降/有限平整/前态3×3平滑、同笔最大权重及整笔撤销。Node短诊断与并行开发同机运行，仅说明有限数组计算和存储规模，不是产品性能。结论为继续隔离研究、暂缓生产接入：单元梯度跳变、全宽道路纵横坡、房屋基础、人工记录/身份、锁/CAS、完整存储与受众输出尚无合同；原型64笔内存历史上限不能替代产品历史保全。正式视觉、跨浏览器、性能与用户P3仍统一从09执行。

### 同日并行接续：岩岛地表、输出背景与轻氛围

用户确认上一条建议的三线一起做。岩岛代理仅新增`detailed-island`样板/规则；背景代理负责当前v1模型/schema、工程设置命令、投影与独立表单；氛围代理新增`sample-atmosphere`并核对多Floor作用域。主代理串行接公共渲染器、工作台/候选摘要、显式样板入口、正常构建、实际页面及文档。保留原脏树与`todo.md`，未提交、推送、部署或改数据库结构；正式验收不在本项执行。

新「岬湾苔岛 · 地表细化」为`sceneweave-detailed-island@1`，复用原Q1的13项固定素材及许可，物理地形800/2600mm、1500mm台阶、物件与支撑保全。8片草岩覆盖改轮廓并加8条有限草沿，新3片苔岩与2片落地覆盖，海岸/高台崖宽560/870mm及明暗/重复节奏属于独立配方和主题身份；静态装饰不声称后续自动跟随。初始额外物化崖脚与旧同kind边带冲突，被`TERRAIN_EDGE_DUPLICATE`拒绝，已撤回该技术方案，继续用单一连续崖面及真实台阶开口。

当前完整v1新增可选`outputBackground`及`setSceneBackground`，严格六位RGB或明确透明，null恢复既有默认底色。氛围→背景复用原候选/采用/撤销/CAS和全资源校验，候选显示真实前后值。CSS棋盘格不进PNG；透明路径在环境/灯雾/滤镜前保存内容和阴影的alpha，将非零alpha像素暂按全覆盖straight RGB计算颜色再恢复原alpha。后续格线/注记仍正常画，玩家不透明秘密遮罩最后盖；真实地表与物理不变。

新白昼哨站是显式下载选项`sceneweave-outpost-daylight@1`，原两个代表场景保留；新岩岛和白昼哨站使用无滤镜/雾的轻环境。构造helper完整核对基线、Q1两条已知原效果及锁/私密/手改，不在旧工程冷开时执行。多Floor源码核对发现领域几何本身、投影和输出均要求单Floor，尚无activeFloor输出或按Floor环境权威；本轮只交设计输入，没有解除限制。合同归14与交互参考，完整源核对留本机`atmosphere-scope.md`。

证据根为被忽略的`work/surface-background-20261110/`，只绑定各自保全源码和正常产物，不继承上两轮冻结。

| 检查 | 实际结果与边界 |
|---|---|
| 规则与真实资源事务 | `unit.log`实际4文件28项通过（背景5、氛围8、岩岛6、目录9）；修正投影测试类型后`atmosphere-final.log`8/8复验，不累加复跑。包含真实1px资源Workspace取消/过期/采用/撤销重做/冷读/完整包/null恢复、物理/固定源与既有五包保全；未运行不存在的额外visual-projection路径 |
| 正常构建与类型 | `build.log`首次因投影不存在的顶层openings键和旧新增旅程材质可能null而失败；移除错误键（开口已包含在walls比较）并补夹具非空声明。`build-final.log`正常构建通过；补候选背景摘要后`build-review-final.log`再次通过，286共享模块架构/应用与AI类型/正常Vite。测试最终修正后`typecheck-final.log`的`npx tsc --noEmit`退出0。既有Rollup/chunk提示保留，无性能构建 |
| 两份新样板UI | preview5267、bundled Chromium、单worker。`playwright-final.log`两项样板旅程通过：新岛通过普通准备/明确保存副本，双受众效果/中性4张4096×3072、两处1024px原生近景、保存冷开/中性采用撤销及原工程完整hash保全；新白昼哨站与原样板物理/资源相同、实际双受众4096输出、当前工程完整hash保持 |
| 背景实际UI与alpha | `playwright-background-final.log`2/2通过：390px错误RGB/前后摘要、预览取消完整包、纯色实际像素、撤销/重做后单调revision及冷开、全空透明PNG的所有RGBA为0、棋盘格状态和无横向溢出；完整真实资源夹具普通导入后地表不透明、灯雾/环境后alpha保持、私密几何变形玩家RGBA不变、秘密遮罩固定不透明。随后将原像素夹具的恒等中性滤镜加强为实际暖色滤镜，`playwright-alpha-warm-final.log`同案1/1通过，不算第五条不同旅程 |
| 半透明颜色与秘密 | 最终`browser-alpha-warm-final/**/alpha-facts.json`记录69424个半透明像素、全图alpha不变、玩家私密变形像素hash不变；同RGB的alpha255/64物件按预乘色一字节精度比较，避免把8位Canvas不可表达的straight RGB误差当暗边。最终GM实际秘密内容与玩家固定遮罩不同，效果工程冷开完整hash相同。未扩展为完整秘密矩阵 |
| 冻结与实际看图 | `review-input-hashes.json`记录1354份源/正常产物/输入，`verified-review-input/`保全；最终核对1353不变，唯一修正为背景测试输入，最终测试另存`final-test-input/`，`todo.md`hash保持。实际查看新岛全景/台阶原生近景和390px控件；草沿/落地已落图，但踏步仍规整、环形崖带明显，整体色层与自然度须继续目视整改，不给P3结论 |

首轮页面`playwright.log`为1通过、1失败、1主动中断、1未运行：新岛准备后测试遗漏「保存并打开副本」确认；背景测试误在场景浏览区寻找单位表单，主代理中断等待后改走页脚设置入口。首轮trace保留。随后`playwright-final.log`为两样板通过、两背景失败：一处把重做后的冷开hash错误地与重做前旧revision相比，改为核对重做后完整包并显式断言revision单调；另一处把alpha64下的8位straight RGB误差上限固定为2，实际蓝通道差3，按原生预乘精度核对（误差×alpha/255≤1）后同案通过。没有放宽产品校验。

开发期alpha审阅还发现仅在末尾恢复alpha会保留低alpha像素合成后的额外染深，故在首次像素验证前已改为先按straight RGB全覆盖计算再恢复。用例发现`discovery.log`曾因Node测试直接导入浏览器样板工厂而加载`wasm?url`失败；改用真实UI按钮文案定位，`discovery-final.log`4项可解析，未加生产测试接口。子代理规则首轮的完整内容包装、资产ID与kind同名触发保守闭包回退、草稿revision及多Floor身份/文案错误夹具，均修正后纳入28项；不把失败写成通过。

实际交付副本为`island-surface.sceneweave`、`island-effect-player.png`、`island-neutral-player.png`、两张`island-*-native.png`及`outpost-daylight.sceneweave`/玩家PNG。`sample-artifacts.json`绑定真实样板/源PNG hash和原生裁切矩形；裁切来自同一正常GM导出、无重采样。背景透明的跨浏览器、裁切/padding、完整资源/秘密/故障矩阵及正式性能仍待09统一验收；多Floor与连续高度场产品化均未实现。

### 同日十项滚动接续：自然细节、固定植被与生成门前直入

用户确认十项一起推进、完成立即接下一项。本轮约定为前7项可调用实现，后3项交付合同；三个subagent依次完成岩阶→草岩接缝→mixed算法3、崖面→道路营地过渡→附着合同核对、六件素材→植被编排→多Floor核对，主代理统一接严格模型/profile、原生渲染、当前表单、样板/素材入口、04/06/14及最终自检。没有创建其他用户会话，没有运行正式性能、计费AI或提交/推送/部署；旧脏改动与独立todo保留。

新`sceneweave-natural-detail-island@1`显式选择`naturalRockSteps2`/`rockRelief2`及草岩过渡2，保留原固定资源/800及2600mm地形/1500mm实际连接带；旧无profile分支和旧样板保持。新`sceneweave-natural-detail-outpost@1`保留四条门前真实路，使用地表过渡2、六件独立植被v1和四个真实散布组，三档实得33/47/65成员，完整资源hash一致。新树冠/根占地分别避让，人工/删除/锁/退出及伪managed改动由旧配方完整重放拒绝；保存不重撒。素材source/PNG/根锚/占地和独立MIT详见[14](../14-visual-and-assets.md#natural-detail-fixed-batch)。

mixed原算法1/2已经使用真实门端口和足宽检查，本项只补真实增量：新算法/配方3保留显式via顺序，在门外增加法向引导点，最多7种有限候选，每次失败也按既有预算收费。森林/火山复用，原四组1/2 resultHash/documentHash精确保持。普通UI默认3，可选2；旧语义CLI的@1身份及未指定请求沿原defaults2。没有持续自动附着。三个后续合同归04/06：覆盖相交片段fresh身份、持久建筑/关系身份先于附着、独立Floor全工程校验后目标投影/输出；均未开放相应新功能。

证据根为忽略目录`work/detail-queue-20261110/`，正常preview5271、bundled Chromium、单worker。设备为macOS/Apple M1/16GB、Node24.14.1；以下不是性能测量或正式验收。

| 实际检查 | 新鲜结果与范围 |
|---|---|
| 规则与集成 | `integration-units.log`15文件首次103通过/1失败；失败为新增AI测试未同时授权现存边界，补完整scope后`ai-profile-final.log`同文件13/13通过。不同用例总数104，覆盖profiles严格值/受众/普通事务、七叶模块/新样板、混合新旧重放/注册/意图/确定性及AI不丢profile，不累加复跑。代理额外旧崖面/连接输入及HTTP/Worker单项不计入104 |
| 正常构建 | `build.log`首轮因叶模块visual空值收窄与polygon-clipping二维点对类型失败；显式空值拒绝、上下文Polygon类型后`build-final.log`架构290模块、应用/AI类型与正常Vite构建通过。Rollup/chunk提示保留，没有性能构建。新增旅程最后的联合recipe类型访问由domain改为已有algorithmId判别，最终类型结果另存`typecheck-final-green.log` |
| 新岩岛/哨站UI | `journeys.log`四项初跑中前两条通过：新岛普通准备/保存副本、实际双受众效果/中性PNG、原生近景、撤销/冷读及原工程hash保全；新哨站三包/真实成员/全宽门路/完整资源一致、导入冷读、受管树移动转manual及撤销、双受众4096×3186和输出只读通过 |
| 素材/混合UI复验 | 首轮素材检查把Uint8Array交给只接Buffer的PNG解码器失败；混合检查误在候选期间点击正确禁用的备份，主动中断并保留trace。`journeys-final.log`素材同案通过，混合在新工程已保存但工作区准备未完时撞到helper默认8秒等待。按既有生命周期显式等待新标题/完整busy结束后，`mixed-final.log`同案1/1通过：真实生产Worker、算法/配方3完整备份、门前法向/门内外全宽、冷读与玩家PNG、旧工程hash保全。共4条不同旅程最终通过，不写首轮全绿 |
| 看图与交付副本 | `sample-artifacts.json`记录8份确切工程/PNG副本hash及两张1024原生裁切矩形，无重采样。实际查看新岩岛全景/踏面近景、哨站全景及六张512源PNG拼图；踏面分片/断续岩纹和新树形已落图，崖面仍有分块感、整体草沿羽化偏柔，蕨叶缩小后偏细线，保留正式视觉/P3检查。六件真实PNG均有非空alpha与透明留白，冷读/重做资源hash一致；自动化逐件初筛不是人工签收 |

叶模块首轮还出现短草沿宽度超过实际短曲线支持范围、测试地面/阻挡面同覆盖优先级等合法性夹具错误；在原守卫下缩限宽度/修正fixture后通过。三档重建测试并行时超过默认5秒，复用只读baseline clone并对多场景构造显式15秒上限；主代理同类三档检查首次也因默认5秒超时，15秒检查通过。没有放宽产品校验或预算。集成复核在首次生产构建前修复了V2法向重复翻转及外层异常restore，并只从受众可见投影读取完整双侧高差。

`verification.json`核对1544份生产冻结输入，正式运行源码与dist无差异；只修正AI/旅程测试与测试说明三文件。`verified-input/`和`final-input-hashes.json`保全1381份源码、正常产物和关键配置；最终`tsc -b`与`git diff --check`退出0，本地文档链接无缺失，todo保持且起始文件无删除。正式双浏览器、完整故障/秘密矩阵、UVTT目标软件、性能和用户P3仍归09。后3项设计不能记成运行能力，旧冻结结果继续独立保留。

### 通用工具提炼、持久门路与独立Floor接续

用户要求回看既有地图细节，提炼可复用逻辑并保留配方偏向，再接着推进后续任务。三个subagent按独立文件滚动完成自然覆盖→崖面3→目标Floor投影/渲染→普通关系面板、路肩/营地→结构门口→端点及持久关系→楼层/门路页面旅程、群落→新蕨叶→独立Floor领域/命令→按层氛围/工具；主代理统一模型/schema、命令与身份、生命周期、普通入口、精确裁切、原生画布和最终验证。图片导入的并行改动保留；本段只证明地图细节切片，不外推该独立工作线。没有运行正式性能或计费AI，没有提交/推送/发布。

同面草岩、明确道路的静态路肩/营地以及显式palette/空地/避让的四通道群落均已接普通面板，消费实际对象与参数，不按样板ID放行；旧样板仍保留构图和选材偏向。局部塑形支持world覆盖精确相交、fresh片段身份及有效固定源祖先保全，非整数/孔洞/启用外观调整或未支持物理依赖仍拒绝。新增独立`rockRelief3`和`leafy-fern-v1`不改变旧固定源。持久`structureTokens`及有限`pathAttachments`消费真实当前出生/拓扑记录；缺池须显式建立，不能借历史合并补造证明。关系只管理一个明确端点的两个受管点，保存完整人工tail；关闭/业务锁门与当前通行分开，改变拓扑等未支持编辑要求先解除。

独立Floor具有各自世界/固定输出范围与完整环境覆盖，普通放置、支撑、地形/曲线、选择和异步预览按当前层接通；所有层共用整工程revision/CAS/撤销。公开PNG显式选择Floor，完整校验仍包括非目标资源；目标投影和raster核对受众/身份及固定绘制范围。区域地图、跨层支撑/组/连接、UVTT多层和未提供Floor绑定的AI截图继续拒绝，不回退首层。数据库表/索引/版本没有改变。

本次证据根为忽略目录`work/generalization-20261110/`；个别叶模块日志仍在`work/detail-queue-20261110/`。macOS/Apple M1/16GB、Node24.14.1，正常生产构建、bundled Chromium、单worker串行页面旅程。最终产物独立保存在`production-dist/`并由preview5274提供，避免并行工作覆盖dist；下表均属开发自检。

| 检查 | 实际结果与范围 |
|---|---|
| 规则与存储 | `final-units.log`38文件、370项通过/4项超时，超时均为原测试/钩子时限。按原门槛串行复验，`contention-recheck.log`中atomic/scatter/群落三文件全过，workspace另一恢复用例超时；随后`workspace-serial-final.log`26/26通过，`restore-isolated.log`同案通过。未改产品预算或提高这些时限，不将首轮写为全绿。 |
| 最后改动的定向证据 | `identity-no-backfill-final.log`3文件20/20，含缺池不由历史补造、完整工作区门路/Floor冷读与撤销；`output-target-final.log`2文件22/22，含raster错Floor/受众/范围先拒绝、单层专属crop和未绑定multi截图拒绝；`sculpt-fixed-chain-final.log`17/17。`floor-ui-scopes-final.log`（旧证据目录）23/23覆盖普通按层面板、曲线与12项氛围规则。 |
| 正常构建 | `build-ready.log`最终完整退出0：307模块架构边界、应用/AI类型和正常Vite生产产物。首轮正常构建通过后，整合又修正了本任务类型/import/tuple收束；并行图片导入曾有临时类型错误，保留该工作线后等待其完成再全量构建，不删除或替换其实现。Rollup/chunk提示保留，不是性能测量。 |
| 普通楼层与门路页面 | `floor-link-browser-final-rerun.log`2/2、49.8秒：正常创建12×15m B层、B层房间/环境、本层完整范围审阅；A层同受众原图hash严格不变，各层真实GM/player PNG、撤销/重做与冷读完整hash；关闭且上锁的真实外门从普通文件导入后建立身份/绑定，偏移随动、完整Path字段及人工tail逐点保全、冷读和真实道路像素。390×844关闭抽屉后的楼层选择、页头/视图动作矩形和无横向溢出通过。 |
| 普通地表、素材与群落页面 | `generic-browser-final.log`中草岩/路肩、cliff2→3两条首轮通过；蕨叶同案在`generic-browser-fern-roomy.log`最终1/1、31.6秒通过。任意ID普通工程经完整ZIP/manifest进入，覆盖取消/追加源链/采用/撤销/冷读及真实玩家PNG。新蕨正常入库，普通两通道实际11棵主树+15株蕨、两组各7条边缘/避让记录，候选26件与采用一致；真实原始/规范SVG、PNG及完整许可字节核对通过。五条不同页面旅程有最终通过结果，不累计重跑次数。 |
| 实际首败与修复 | 楼层环境最初被归为组件候选，修为视觉候选并列目标层完整范围后同案通过。GM/player公开图分别有可重复40/48个AA像素RGB差1、alpha差0；只对此跨受众比较限定同尺寸/alpha严格、RGB≤1且差异像素≤256，诊断在`floor-link-raster-comparison.json`，同受众A层隔离与冷读完整hash仍严格。蕨叶测试曾错误要求`sources.json`不能追加，改为旧entry/实际文件严格保全及新增固定源验证；24×18m及更密采样仍容不下完整树冠，最终通过普通UI显式使用36×24m场地，保留双通道非空和完整避让断言，没有修改产品保护。 |
| 保全与看图 | `preserved-fixed-sources.json`核对旧崖面/岩阶、旧六件植被与目录、既有岛/哨站配方及todo共8文件hash不变。最终`document-file-links-final.json`检查917个本地文件目标无缺失。`final-product-hashes.json`记录75份本任务产品源、176份隔离生产产物及最终两份旅程输入指纹。实际查看390px页面、新蕨512规范源、地图内原像素近景和cliff3玩家近景；蕨叶有明确叶面，崖面沿原包络采用低对比岩片，整体草沿柔边与大形仍需正式审美判断。`generic-browser-facts.json`及两组PNG/完整工程保留真实产物。 |

新增公开能力的成功和关键拒绝路径以上述有限切片为准；没有执行09完整故障/私密变形/跨浏览器/UVTT目标软件矩阵、正式性能或人工P3。旧104项和前轮四条旅程保持原冻结，不拼接为本次验收。

<a id="map-detail-targeted-acceptance-20261110"></a>
#### 地图细节定向验收、通用覆盖与缺陷复验（2026-11-10）

用户授权按[09细节矩阵](../09-quality-plan.md#map-detail-acceptance)并行执行。证据根为忽略目录`work/detail-acceptance-20261110/`，三个subagent滚动承担通用来源、关系/塑形、视觉/兼容，主代理负责完整楼层保密配对、集成和公共缺陷。各冻结独立，不把上一节开发自检改称验收，也不将同案复跑相加。没有计费AI、提交、推送、部署或数据库结构变更。

首冻结`75c9d96e…d25290`逐份核对75项相关源码与176项已成功正常构建产物未变，副本从5275提供；并行图片线正在施工的源码没有因此取得构建通过。修复候选5276的完整构建门曾被图片工具的一处类型关联阻塞；在对应名称schema已严格解析的前提下仅补`unknown`类型断言，`type-only-integration.json`证明前后擦除后的JS完全一致。随后`build-final.log`完整退出0，310模块架构、应用/AI类型与正常Vite均过，5277的`final-artifact.json`核对176项与5276候选逐字节一致。原候选`normalNpmBuildPassed:false`原样保留，以独立同一性证据关联后续正常构建门。

| 切片 | 已实际取得的证据与限制 |
|---|---|
| 普通地表与来源 | 通用线11个独立用例按真实日志5＋4＋1＋1归集，非单次11/11。新48×36m负坐标斜角凹形、改名换合法ID、草岩/草沿、折角路肩、营地、非整数/孔洞/锁拒绝及真实两标签CAS保全通过；实际同受众PNG确认采用改变像素。手绘四通道32件，经普通受管成员删除和密度0.9重撒保留deleted/排除记录并冷读。真实森林未用种子产生45 props、1 path、3 surfaceRules，普通草岩追加后一次撤销恢复完整生成记录及4096玩家像素hash。`general/progress-facts.json`保留各版本、首败和同一性关联；逐能力的其他来源组合继续由`detail-provenance-acceptance.spec.ts`补证，不能把总体触达四类来源外推为每个组合均过。 |
| 门路、塑形与失败保全 | 四向/两端新位置组合13/13规则通过；塑形首批6/7，复杂自然组＋样板合并项5s超时保留，拆成独立负例后原默认5s各自通过，非一次21/21。正常西墙/end文件导入后关系锁拒绝、墙厚候选取消/采用、完整tail、撤销重做、冷读和双受众像素通过。原生删路遗漏关系已修复；候选普通UI验证锁拒删全包不变、审阅真实关系/门墙房间/顶点、同笔删除、双墓碑与undo/redo/cold，道路像素改变而房间像素严格保持。具体源阶段与日志归`relations/`。 |
| 楼层保密配对 | `privacy-transparent.log`在首冻结上通过：两个同XY楼层、透明背景、A层私密物件/门墙/注记/灯雾变形与B层公开物件/环境变化；A层玩家RGBA前后及冷读严格同hash，GM与B层实际改变。实际PNG无文本/EXIF块，透明角alpha0、秘密遮罩alpha255，完整冷读包逐文件相同。使用同受众精确比较，不沿用此前公开GM/player的AA容差。最新整合冻结的受影响复验另留独立结果。 |
| 视觉实际观察 | Chromium代表矩阵3/3及真实wheel/Space-pan/适应全图只读检查通过；新蕨按与36×28m哨站相同113.7778px/m补独立320px原生近景，6件旧源的实际SVG/PNG/许可另核保全。已实际查看全图与近景，profile3减弱重复分块，新蕨有实心叶面；灰色落地带、土环平面感、草岩/路肩软贴片及密度仍不判美术通过。原图水平深线由X向连接真实侧壁产生，不能归因端帽；端帽误描另由预冻结3000mm崖面输入显露，公共侧壁函数已修，后续同文件复验不改输入挑图。对照页`visual/review-chromium.html`及`observations.md`保留判断依据。 |
| 兼容、预算与复审 | Firefox/WebKit使用相同完整输入，经普通文件选择器全验；首次10s准备及30s导入门限失败保留，自有90s实际保存就绪等待不减验证，非性能通过。后续确切结果以`visual/`各独立日志为准。独立源码复审另发现关系删除可被大预算放大，以及只读共享结构带入兄弟锁；普通属性的两种插入顺序及真实几何锁拒绝3项已过，固定compact累计门和最终正常构建/相关旅程仍须完成后另列。 |

首败中还保留夹具支撑、未知/未物化tint、事务类别混批、受管成员按钮和表单步长错误，均与产品缺陷区分；森林0.15%不合0.1%步长时未提交生成，首个实际请求明确修订为0.2%，其余预冻参数不变。普通新planner没有独立AI/Worker/CLI高阶入口，不自动新增权限；样板/P3、完整故障/秘密变形、更多保护与多种子、目标VTT和正式性能均不由本段授予整组通过。

2026-11-11接续复验使用`integration-source/`和`integration-dist/`。`build-integration.log`退出0，311个源码模块通过架构边界检查，应用与AI类型检查及正常Vite构建通过。`integration-source-inputs.json`记录1815个输入。`integration-artifact.json`记录176个产物文件及指纹`ed4134b0…a61c7`，构建结束时本次冻结的产品源码与工作区逐文件一致。此次冻结包含最终256条输入门和植被候选逐通道数量披露。

- 门路规则19项的分组结果保存在`relations/transaction-budget-remediation.md`。最终正常构建的删路单项通过，锁拒删前后完整备份逐条目一致。解锁后候选列出道路、关系和真实依赖，采用时保留两类墓碑，撤销、重做及冷读均通过。4096×3072玩家PNG中道路位置变为地面像素，房间中心像素严格一致。日志为`relations/delete-browser-normal-5278-20261111.log`，同名目录保留冻结输入指纹、候选和冷读输出。
- 最终正常构建的楼层保密配对通过，`privacy-integration.log`退出0。私密内容和另一层变化前后，目标层4096×2926玩家PNG及冷读输出的RGBA逐字节一致。另一层玩家输出为4096×3072，GM及另一层玩家图有预期变化。透明角alpha为0，遮罩alpha为255，冷读完整包逐条目一致。`privacy-integration-results/`保留配对输入、PNG及`floor-privacy-facts.json`。
- 来源组合续测按分组2＋1收口，不写作单次3/3。`work/general-provenance/channel-disclosure-integration.log`保留森林、手工两条完整通过及第三条中断；本轮哨站用Node24.14.1同冻结/同测试复跑，`outpost-integration-node24.log`最终1/1、3.1分钟、退出0。森林/手工/哨站四通道实际数依次为0/2/8/5、0/1/2/4、0/1/3/0，零件均明确显示“本次未生成”，森林390px候选无溢出。每一步采用、撤销、重做、完整冷读及玩家PNG断言完成；redo与cold分别127/59/109个ZIP条目逐字节相同，既有源祖先和生成记录保持。`work/general-provenance/resume-20261111-facts.json`关联完整附件及源码/产物同一性。Node26首次哨站续测打印通过后runner未退出，SIGINT退出130，原日志与附件保留；未据此判定产品缺陷或进程成功，也未复跑未变化的岩岛。
- Firefox哨站已有整合冻结上的独立1/1通过，`visual/firefox-outpost-integration.log`为3.7分钟，原90秒就绪断言没有放宽。本轮`visual/firefox-resume-audit.json`重核176项产物、与原Chromium相同的输入SHA、5个完整包逐条目、12份实际PNG文件及RGBA、6份旧素材和4个真实通道，页面异常为空；未重复启动长链。旧trace仅证明当次保存就绪标志未出现，根因仍无确证。功能兼容复验收口，不将其当作性能正常或完整冷重开矩阵通过。
- `resume-integrity-audit.json`核对1815份冻结输入和176份产物均未变，接续时工作区产品源码亦相同；独立`todo.md`仍为`c80b1d29…e49b6`。只读画面复核确认profile3仍调用连续侧壁描线，原岛线宽87mm、alpha约0.441；落地带同时消费每端928mm支撑混合、自然岩阶蒙版与两片固定落地覆盖，尚未消融区分贡献。后续视觉开发先用原输入分别隔离这些层，再以显式新画法/配方改善，不能全局改写旧保存语义或以端帽修复关闭美术/P3。
- 性能前置首败保存在`performance-resume-node24-smoke/`：原复用输入`debc756d…d2b7`含旧版SVG固定资源，普通导入明确拒绝，180秒就绪等待后退出1，未产生编辑样本。没有扩大等待或旁路校验。独立准备脚本仅从冻结的当前准备器选取`natural-500`，`performance-resume-inputs/preparation.json`完整退出，500完整Prop、0轻量替代、14份真实图片及完整冷读/许可验证；实际新包SHA为`47502d58…9063`。随后新输入smoke及三轮正式运行均退出0，共510个操作观察、完整冷读和六张实际4K PNG，原始结果与重算汇总一致；分布与子门边界归[性能参考](../reference/performance.md#map-detail-natural-500-20261111)。新输入与旧分布分开，不能用此次测量宣称历史提速。
- `resume-final-audit.json`确认三轮原始文件及PNG实际SHA、冷读全条目、浏览器退出及冻结源/产物完整性。工作区图片导入线后续修改了8份产品/测试文件，未进入隔离测量源码与产物；不把本次结果外推到这些编辑。全部本会话进程已结束，独立`todo.md`哈希保持，未提交、推送或部署。

<a id="generation-certificate-20261110"></a>
## 生成链路确切快照消费整改与开发自检（2026-11-10）

用户在温带荒野整改和共同链路诊断后要求继续。本项消费已有[04会话快照合同](../04-scene-document.md#workspace-snapshot-contract)及[06保存合同](../06-storage-and-export.md#snapshot-persistence-contract)，开发状态只归[07](../07-roadmap.md#generation-certificate-implementation)，正式矩阵归[09](../09-quality-plan.md#workspace-snapshot-acceptance)。本次在main工作区继续，保留原脏树及独立`todo.md`，未切分支、提交、推送或部署；没有模型请求、重发未知任务或更改素材/生成算法。

### 实现及保全边界

`workspace/project.ts`增加内部`consumeEditableSnapshot`，以共享校验器的`validateProjectSnapshot`消费确切metadata/独立字节闭包及当前真实images/SVG能力；未知包装、外部克隆、伪冻结、换reader或更换实际方法均回退全验。公开`fromBundle`及`validateEditableProject`不变，没有调用方免检字段或持久化凭证。

共同`prepareDomainProject`不再先克隆base丢失私有认证，物化传入已认证baseline，并在执行器await及物化后再次确认当前实际处理能力，防止等待期间替换解码器而沿用旧能力证明。Workspace的生成base、采用前候选和冷读后转换使用同一私有消费路径；冷读仍由仓库真正读取实际数据库并全验，未知仓库返回仍完整验证。传输提案严格解析及采用时本机完整重放、精确身份分配、当前基线/领域/锁/依赖/玩家投影、预算、公开save、实际load/CAS与失败保全保持。当前完整v1及数据库结构未变。

### 必要自检、首败与实际交付

证据根为被Git忽略的本机`work/generation-certificate-20261110/`。原正常生产包复用前轮最终产物，开始前1142份产品源/配置逐份与原冻结相同；副本与全部计时另存，不覆盖上轮诊断或AI比较。后组1662份源/配置/素材/测试与176份正常产物独立冻结，交付校验使用冻结源码，不消费后来并行任务的文档状态。

| 检查 | 新鲜结果与实际范围 |
|---|---|
| 重复校验复现及同案修复 | `red-generation.log`在原实现对同一已认证1px资源预览断言失败，实际decode调用3次。实现后`green-generation.log`同案通过：预览不重复解码，采用时公开save及真实cold load仍解码2次。首败是整改前目标复现，未删除/弱化断言。 |
| 相关集成回归 | `unit-integration.log`同轮7文件52项通过，串行maxWorkers1/testTimeout30000；覆盖应用资源交接、四生成领域、语义生成入口与共享快照能力生命周期。新增未知/克隆/换reader、坏字节/许可、getter不执行、缓存取消、执行器await更换实际方法、冷读后更换能力/取消及未知冷读返回；现有重算公开hash的恶意提案仍被本机重放拒绝，过期/保存/冷读失败保全与删除/撤销保持。 |
| 正常生产构建 | `build-normal.log`退出0，架构284模块、应用/AI类型及正常Vite通过；既有包体积/重复导入告警保留，没有性能构建或探针。 |
| 真实UI生成及前后观察 | 原九参数表单路径，前后各三轮空context，正常生产页面实际预览、采用保存、完整工程及4096玩家PNG下载均complete，页面异常0，无自动重试。设备、全量样本、计时终点及后台负载限制统一归[性能参考](../reference/performance.md#generation-certificate-observation-20261110)，不在此重复数表或关闭正式性能。 |
| 六包独立冷导入/资源/实际PNG | `verification.log`及六份`baseline/proof-*`、`after/proof-*`均verified；每份实际包经真实资源/许可全验，实际下载的4096×3277玩家PNG与重渲染RGBA一致。六份限定几何、56PNG+112SVG源共168资源与实际RGBA一致，原完整工程/文档规范内容及比较排除项独立保留于proof，不宣称全元数据或原包二进制完全相同。 |

本轮开发缩样不替代真人时间、真实模型、全跨浏览器、完整视觉/P3、存储故障/容量或09正式性能。未更改源码中的通行、固定源/许可、人工编辑保护和公开验证边界；素材工厂与正式输出仍有完整验证开销。后续从07当前主线接续，需要继续性能整改时另立确切输入及正常生产证据。

最终`final-integrity.json`确认前后各176份固定产物、后组1662份输入均无漂移；1142份原产品输入仅本轮3份运行时/2份测试变化，当前根工作区与后组输入一致。并行会话的04、14及其他新增文档修改单列，不覆盖或归为本轮产品验证；`todo.md`哈希保持。五份相关文档788条本地链接/锚点及`git diff --check`通过。新的本机成果页`http://127.0.0.1:5214/work/generation-certificate-20261110/`展示全部六轮、实际地图/工程及proof；26条链接HTTP200，实际图片解码、1440/390布局无横溢、页面异常0，最终两视口截图已实际核看，不代表公开发布或用户签收。

<a id="wilderness-remediation-20261110"></a>
## 温带荒野素材、林中哨站与河岸山道整改（2026-11-10）

用户确认先整改温带荒野及代表样板，再定位共同生成链路耗时。开发状态只归[07](../07-roadmap.md#asset-expansion-implementation)，素材合同归[14](../14-visual-and-assets.md#asset-theme-first-review)，完整验收仍从[09](../09-quality-plan.md#asset-expansion-acceptance)执行。本节是开发整改与必要复核，不替代六包完整视觉矩阵、真人收益研究或用户P3；未提交、推送或部署。

### 固定内容、真实场景与保全

新增原创静态SVG的温带荒野固定v2，含7材质、21物件和5组合。原20项重画时保留尺寸、占地、阻挡、绘制层及阴影语义；新增旧木板与破损营帐、散落装备、值守桌、补给箱、行军床、地图卷、路牌。材质降低对比并裁去无关周期复制，树冠使用不规则透明叠色，营帐改为纯俯视。整套28项约384KB，最高221节点/110路径，实际源通过严格SVG检查；这不是模型生图或付费请求。

`THEME_PACK_ART_V1`完整保留原120项固定源，当前目录仅将温带荒野指向v2，工程仍为当前完整v1，其他五包保持固定v1。`art-preservation-final.json`逐包确认六包原v1源哈希不变；其他五包目录及各两份样板共15个规范JSON哈希与任务前一致。面板数量改为读取所选目录元数据，不再将新包显示为旧6/14/3。

两份36×28m可编辑样板均使用真实领域实体：哨站有共享墙双房间、外门/内门/窗与家具，在用及废弃营地，成簇林缘、四条道路、450mm羽化腐土/苔地和实际主持人秘密线索；河岸山道有弯折河岸、1.8m高岩台、六段阻挡崖边和1.8m宽坡道。道路真实带区与阻挡物占地无正面积相交，门旁2.2m通道不被家具侵入。高差和通行由模型表达，图片不授予额外通行。

### 冻结、实际运行与独立交付复核

证据根为被Git忽略的本机`work/wilderness-remediation-20261110/`；定向单元另在`work/wilderness-catalog-20261110/`。最终正常生产副本是`production-final/sceneweave/`，本机工作台地址为`http://127.0.0.1:5253/sceneweave/`。旧冻结与失败附件均保留，不把中间画面/测试与最终版本拼成一轮通过。

| 必要开发复核 | 实际结果及边界 |
|---|---|
| 定向单元 | `unit-layout-revision-final.log`同轮1文件8项通过，核对新目录版本/数量、两份真实样板、共享结构/支撑/高差、占地通路与旧五包保全。 |
| 最终正常生产构建 | `build-visual-final.log`退出0，284模块共享边界、应用/AI类型与Vite通过；既有包体积及重复导入告警保留。1142份产品源/配置与实际产物分别冻结于`source-freeze-final.json`、`dist-freeze-final.json`。 |
| 两样板真实UI旅程 | `browser-final.log`单条完整旅程通过，约1.8分钟：正常UI载入实际PNG、下载两份样板、空profile首页导入、保存后真实冷开、独立物件移动1mm及撤销，核对资源/几何保全、主持人秘密过滤，并实际下载GM与玩家PNG。事实与附件位于`browser-final/`和`delivery/`，不是受控端口模拟。 |
| 实际4K与完整包 | 两样板均为4096×3186，完整包各含28PNG和56SVG源共84资源。`delivery-verification.log`及`delivery-verification.json`确认两个实际包经独立冷导入、真实资源/许可全验后，玩家PNG与包重渲染RGBA逐像素一致。玩家RGBA分别为`b23edfdcb18d5fa48f781176fa25a3fc9f5303a5aee15f43990cebb0868c638c`、`05e65ec42b6115b08636e5f8e545e7d70f43d00259a3dbdd1a629e1786e152c7`。 |
| 实际看图与本地展示 | 实际核看28项合集、最终哨站及山道输出；`index.html`展示实际地图、材质3×3平铺和完整工程/双受众下载。成果页为`http://127.0.0.1:5214/work/wilderness-remediation-20261110/`，属于本机复核附件，不是公开发布或用户签收。 |

首轮类型构建因房间支撑引用类型过宽而失败，收窄为真实terrainArea字面类型后构建通过；首轮浏览器误用导入前sceneId定位冷开，改为实际打开工程的本地ID后旅程通过，产品导入fresh ID语义未改。初轮画面稀疏、营地边界生硬，已补林缘/羽化地表及圆润营地边界，再对最终布局重跑上表检查。成果页检查首次误把没有src的隐藏放大图当作待解码图片，修正筛选后检查通过；首败日志各自保留。

### 当前边界与耗时定位交接

旧用途缺件、正视营帐与稀疏林缘已有具体整改；程序化叠色仍有形状简化，河岸/道路仍为折线，不据此宣称自然水彩目标、美术审核或P3通过。其他五包及完整世界尺度/旋转/状态、跨浏览器和故障矩阵仍按09接续。独立`todo.md`和无关编辑保留。

共同生成链路的单次隔离诊断、设备/方法、首败及局限集中在[性能参考](../reference/performance.md#generation-validation-diagnosis-20261110)。预览/采用保存观察为22.67/23.98秒，主要成本证据是重复真实像素/SVG校验；未修改产品验证链路，没有已提速结论。诊断实际包与原机器样例的几何、168资源及4096RGBA一致，不重发模型、不替换旧计时，也不将本轮自动化视为真人研究。

收尾`final-integrity.json`复核1142份产品源/配置及176份固定生产文件无漂移；25份任务前保全文件只有本轮拥有的07、09及素材源入口发生预期变化，其余哈希不变，独立`todo.md`保持。五份相关文档749条本地链接/锚点无错误，`git diff --check`通过。补入性能段后重新运行`gallery-check.mjs`，全部有src图片解码、全部链接HTTP200、1440/390布局无横溢、放大/Escape及页面异常检查通过，最终桌面/手机截图已实际核看。

<a id="validation-tool-remediation-20261110"></a>
## 性能运行器草稿退出工具整改（2026-11-10）

本项按用户明确选择的两项并行工具整改实施，当前状态归[07](../07-roadmap.md#validation-tool-remediation)，视觉诊断另归[视觉台账](visual-quality-validation.md#visual-progress-tooling-20261110)。不修改产品/素材/生成算法，不提交、推送或发布；另一活跃会话的生产运行不作为本项证据。

原失败位于`work/snapshot-remediation-20261109/baseline-normal/building-500-run1.json`：组预览因预算/几何等受支持的拒绝结束后，建筑表单输入仍保留，首次`canvas-prop-selection`被导航守卫阻止，180秒超时。原完整失败文本明确要求“取消建筑草稿”；失败冻结、该组无性能结论及其他已完成mixed结果均保持。

`run-current-formal.mjs`现通过独立`aggregate-draft-cleanup.mjs`包裹组生命周期。仅在组操作成功结束或原逻辑已明确确认的拒绝返回后，点击本领域唯一的普通取消按钮；建筑使用“取消建筑草稿”，自然组使用“取消室外草稿”。无残留草稿不额外导出，未知错误保留首败且不取消。实际取消放在setup阶段，取消前后保存两份完整包，复用逐manifest/条目集合/实际条目SHA一致性检查，并核对revision、格式与选择未变，全部通过后才进入画布选择。新辅助模块纳入测量前后工具指纹，拒绝与原采样门槛不降低。

工具级回归先在缺少退出行为时复现“草稿阻止选择”，随后同组7项通过，覆盖建筑/自然草稿、无草稿、未知失败不丢弃、重复控件拒绝、revision/选择变化与相同revision下资源被改动拒绝；运行器语法检查与`--help`通过。工具单测使用受控UI端口，不冒充真实浏览器；日志及本任务文件指纹保存在忽略目录`work/parallel-runner-repair-20261110/`。

本轮没有启动建筑500生产smoke、正式性能矩阵或完整视觉浏览器，也没有新建正常生产构建；后续须在独立冻结和空闲窗口执行真实UI链。工具回归不能证明建筑500时延、33.4ms帧缺口或整体性能通过。

<a id="snapshot-remediation-20261109"></a>
## 目录与保存重复编码整改（2026-11-09）

用户在时间分布分析后授权“按你说的，开始整改”。本项消费[快照合同](../04-scene-document.md#workspace-snapshot-contract)与[保存合同](../06-storage-and-export.md#snapshot-persistence-contract)，实施状态归[07](../07-roadmap.md#workspace-snapshot-implementation)，完整验收归[09](../09-quality-plan.md#workspace-snapshot-acceptance)。完整工程v1、数据库schema4/native40、history v1不变；保留无关脏树和独立`todo.md`，未提交、推送或部署。

只读诊断绑定11月8日旧正式冻结，证据位于`work/mixed-2000-timing-20261109/`：隐藏目录每次工程对象改变重走完整元数据校验，采样约432/452ms；热保存函数约2.23/2.39秒，主要为重复canonical、clone、同步SHA及旧基线物化。预览解码await与保存主线程计算重叠，不能视为纯解码CPU。历史混合2000第三轮整段约30Hz，新独立诊断未复现，33.4ms原因仍未证实，未据保存整改宣称修复该问题。

本轮实际实现：校验器签发的确切不可变固定素材闭包共享深冻结目录索引，实例位置/角度不使它失效，外部克隆/伪冻结/换reader保守检查；私有编码owner一次生成真实canonical/UTF8/SHA/stored，局部delta与checkpoint共用双端编码，只有活跃真实事务/receipt和精确不可变端点可复用。保存operation各持独立lease并pin结果/基线/分支，同事务raw row、实际块及物化结果共享；每个新事务仍重新读取全部引用块、核hash/长度，并在完整manifest和逐字节相等后复用owned解析，公开读仍为独立可变副本。资源/许可与最终CAS不减，基线提交成功才发布，失败保留旧lease；可选跨保存编码保留上限64MiB，显式/native close、versionchange/blocked及跨关闭保存均释放且不能重新挂缓存。

证据集中于`work/snapshot-remediation-20261109/`，Node24.14.1、Vitest4.1.12、正常生产Chrome157.0.8103.38。`baseline/`在10:46冻结，已经包含目录优化，故前后pair仅用于保存整改，不能量化目录收益；遗漏的构建输入只按清单补齐tests/services/assets/config，没有覆盖冻结运行时源码。前两次缺输入构建失败保留，`baseline-build-final.log`正常build最终退出0。整改后1607份输入见`after-freeze.json`，正常`npm run build`执行架构检查、应用/AI类型及Vite后退出0，175份产物冻结于`after-build-freeze.json`；生产完整性测试后补的测试overlay另列，不假报全部输入始终相同。

| 必要自检 | 新鲜结果与边界 |
|---|---|
| 最终整合单元 | `targeted-close-integration.log`同轮6文件96/96：目录反伪造/闭包、delta、content context/local blocks、增量历史与workspace snapshot persistence，串行`--maxWorkers=1 --testTimeout=30000`。关闭五类生命周期、可变/陌生端点回退、坏块/历史/失败保护及冷读在对应断言覆盖；此前spy/计数和fixture错误的失败独立保留，不与最后数字相加。 |
| 类型与生产构建 | `typecheck.log`及`current-build.log`均退出0。正常构建保留既有Rollup/包体积提示，不将构建成功当作性能或全量回归。 |
| 失败恢复 | `production-safety.log`首轮4项中2通过、2失败。通过项为桌面QuotaExceededError重试、390px UnknownError另存副本；内存编辑、旧持久分支、备份及恢复冷读保持。故障仅注入临时独立库的原生IDB写入，不是物理磁盘耗尽。 |
| 实际坏块/缺块 | 上述首轮两项已验证热保存及冷打开拒绝，最后仍要求首页全量读块，与新目录not-checked合同冲突而失败。只改测试末尾：刷新后保留工程行并说明内容未检查，再实际打开拒绝；同一dist定向复验`production-integrity-confirm.log`2/2通过。实际块原生get、hash/长度、内存revision/undo、原行和故障块不被覆盖均保留，没有为通过修改产品。 |
| 双标签CAS | `production-cas.log`独立单项通过：先热保存15°，第二标签30°成功，旧标签45°及撤销回15°均冲突；旧标签内存/递增revision/备份保持，第三冷页面逐条目hash与30°赢家一致。真实共享origin/IDB，无状态或故障注入。 |

三组浏览器运行各自保留，不宣称同轮5/5。`production-test-overlay.json`、测试源码副本及`production-safety-audit.json`绑定实际用例与facts；未访问用户库、连接模型或启动用户外部浏览器。独占正常生产低样本、输出等价和剩余热点归[本次性能记录](../reference/performance.md#snapshot-remediation-20261109)，不以调用数或本节正确性检查关闭旧正式失败、全部性能/内存、视觉/P3或其他09矩阵。

最终`closeout-facts.json`复核1607份after冻结输入、175份产物均无漂移，本轮10个目录/编码/保存运行时文件与根工作区相同，生产测试overlay保持；四份相关文档563条本地链接（499个Markdown锚点）无错误，`git diff --check`通过，独立`todo.md` SHA256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`。测量后根工作区已有其他任务7份素材导入/准备相关文件变化，另有本轮测试overlay；明确列入漂移清单，不将冻结产品结论外推为不断变化的根目录全量通过。

<a id="core-convergence-20261109"></a>
## 四项核心能力六步收束与开发自检（2026-11-09）

用户授权按1–6依次完成核心建设。本轮在当前完整工作区集成：①合同/owner与验收映射；②四领域共同操作会话、候选生命周期和应用端口；③实际逐步事务回执及准备/审阅/revision/delta消费；④静态领域注册、森林/火山事实owner、精确算子写域与混合串行组合；⑤共同表现/绘制包络、输出能力和应用意图准备；⑥轻量目录、事务内固定家族索引及真实选择链派生交接。具体合同归04/06和架构参考，开发状态只归[07](../07-roadmap.md#core-convergence-implementation)，正式矩阵只归[09](../09-quality-plan.md#core-convergence-acceptance)。

共同入口已迁移实际UI/Workspace/Worker/存储消费者；旧四领域方法只作薄转发。未知命令/依赖/资源消费者继续完整回退；普通地形/建筑回执不扩大有限Prop证明，选择复用只允许确切受信Prop位置/角度事务及双端依赖闭包。导航`not-checked`不证明完整内容有效；历史实际记录/块/完整SHA与最终CAS仍检查，索引事务失败不发布。保存合并替换只撤销已弃置的确切临时证明，在途IO、撤销文档及失败副本保全。没有改变唯一完整v1、数据库/算法轴、资源字节/像素/许可、人工保护、保密投影或历史删除政策。

性能owner于2026-11-08 17:23 UTC明确释放独占窗口后才恢复本轮检查。其18/18结果绑定旧`e23a417b`冻结，不能覆盖这里的架构变化。本轮没有正式性能数据，也不宣称O(K)、空间卸载、PNG/包IO提速或全部质量门通过。

原始证据归被忽略的`work/sceneweave-core-analysis/`。Node24.14.1、Vitest4.1.12；各组串行`--maxWorkers=1 --no-file-parallelism`，必要失败只复验对应文件。前轮正常生产包175文件集合SHA256 `20074afdaecba55429db5e202986b8b4bef6e2871bbaa65cb1d5a8de1da41f28`；961份运行时输入集合SHA256 `695075d58c78b787241c5f3ce0a66ba7ef98d0452eda1156a15608fae6789a50`，HEAD `6fb36b4b622e7bf023119e2e2b107d98a865f712`加当时工作区修改。集合按路径→文件SHA256排序、紧凑JSON后SHA256；`source-freeze.json`、`dist-freeze.json`绑定下列原轮结果。新增森林边界修复后的最终独立冻结另见下文，最终收口不再断言正在并行修改的根工作区与旧冻结相同；各冻结均只证明明确影响范围，不能外推全仓回归。

| 检查范围 | 新鲜结果与实际边界 |
|---|---|
| 类型/依赖与正常构建 | `typecheck-2.log`退出0，架构检查271个生产模块及应用/AI类型通过；`shared-1.log`为238个纯共享模块无DOM编译和原生ESM命令/身份/投影、工程/所选历史ZIP、迁入原件及素材库备份往返通过。`build-1.log`正常构建退出0，保留既有Rollup/大chunk提示，不作性能结论。 |
| 会话/事务/资源准备 | `transactions-1.log`9文件104项中102通过、2项fixture假设失败；`transactions-receipt-2.log`单独21/21通过，其他8文件不重复。覆盖四领域会话取消/迟到、图片端口、意图、Prop普通回退、完整资源准备、逐步回执和delta，以及合并pending、延迟写、真实CAS失败与另存副本的冷读/撤销保全。 |
| 领域注册/写域/组合 | `generation-1.log`16文件154/154，覆盖四领域执行/Worker失败协议、精确写域、空间事实、共同组合/预算/取消和应用候选；有限watch-room扩展夹具没有复制核心生命周期。`mixed-replay-1.log`另1/1，以改造前runner对照forest/volcano两种mixed@1规范完整结果，seed、阶段/实体/报告/hash保持。 |
| 表现/隐私/输出与选择 | `presentation-1.log`11文件105项中102通过，新选择夹具三项失败；修正后`selection-transfer-4.log`12/12通过，其余10文件未重复。覆盖实际端帽/转角包络、裁剪/驻留、未归属资源全decode、GM/player投影、UVTT显式能力以及确切选择视图、锁/排序、组/外观/未知依赖回退；不代替视觉/P3或目标VTT真实导入。 |
| 目录/历史/持久化 | `storage-1.log`7文件86/86；`lifecycle-storage-1.log`另3文件50/50。覆盖原生目录不物化、标题/元数据错误保留、完整打开拒坏块，固定身份各历史分支/取消/abort/冷开，repository与workspace的实际CAS/历史/迁入/素材库保存链。 |
| 延迟/失败目录UI | `directory-browser-1.log`2/2，独立dev5234与隔离headless Chrome：搜索失败去掉旧cursor、迟到分页不覆盖新搜索；容量读取失败重试、旧工程迟到结果不污染新工程。只注入目录/usage延迟和失败，不伪造完整工程认证。dev已关闭。 |
| 正常生产旅程 | `building-browser-2.log`同包建筑完整旅程1/1通过（真实Worker、编辑/撤销/重做、冷开hash、GM/player 4K与空库重新导入）；`remaining-browser-2.log`8条中6通过/2失败：四领域原生Worker真实结果门闩、Esc取消/迟到拒绝/显式重试/冷读包不变，以及森林/火山参数变更、保存冷开/删除保全通过。新forest/mixed完整交付的首败、再次复验及最终独立包2/2结果见下，不拼成单轮全绿。 |

首次失败保留：类型首轮为状态联合泛型、Dexie多表overload和素材库fixture端口类型；事务两项错误假设普通revision没有独立local proof，修为显式隔离再测共同回执撤销。选择夹具将内容/显示/锁/外观跨分类混批或缺已采用许可，按合法独立命令和真实许可修正；中间两次复验又暴露updateProp只支持位置/角度及实体锁独立分类，最后用独立实体锁往返检查中间写入，不放宽生产约束。

生产首轮建筑采用busy期间超时，trace存在约978秒无进展及更长teardown，保留原失败并中断该轮；未直接将原因归为产品。相同生产包单条建筑复验通过。新增森林交付用例先将默认8%树木降至4%，真实展开超过256而正确拒绝，改用2%→3%支持范围内的小事务；mixed首次已准备/采用后被通用辅助函数8秒busy默认提前判失败，本spec显式等待完整操作结束再核对新revision/saved，不扩大产品预算，也不将测试等待用于性能结论。失败日志与trace均保留，不写成单轮全绿。

同旧包`core-browser-3.log`定向复验两条：mixed完整交付通过，forest的2%→3%局部修改被完整几何校验安全拒绝，暴露真实边界缺口。冻结采样器检查近侧视树木的根锚点绘制轮廓，可能接受绘制在世界内、原生未平移`visualBoundsMm`却出界的候选；初始forest@1已有额外过滤，当前地表命令安装缺此检查。修复仅在`surface-rules/commands.ts`按既有`validatePropGeometry`过滤本次提案中`OUTSIDE_FLOOR`受管实体及对应成员槽；若提案拟替换已有受管实体，将该ID交回普通删除与依赖检查。不重采样、不改冻结算法/目标覆盖/世界边界，人工、锁定及删除记录仍由原采样与事务保护。缺额仍按实际数量报告。

`forest-boundary-1.log`三文件20/20；补强回归直接证明旧采样器仍产生原生出界候选，现命令结果完整合法、无悬空成员且原输入/世界/覆盖不变，`forest-boundary-2.log`两文件11/11（地表命令与工作区局部生成）。`mixed-replay-2.log`1/1，再次确认两种mixed@1规范完整输出与改造前一致。上述是定向开发自检，不扩大普通256预算或认证复用范围。

随后性能owner开始另一项已授权存储/目录整改，本任务停止编辑其文件，捕获1605份源码/测试/配置/工具到独立`final-workspace/`。`final-source-capture.json`记录捕获前后与副本相同，集合SHA256 `a2dd1b11eda15719935195931690a1777c4b3e986d9a8bc8b6aa747b1326724c`。独立`build-2.log`仅因新增测试对SurfaceRule联合类型直接读取coveragePpm而失败；改为对象匹配断言，生产代码未变。`final-verified-source.json`记录该单测试overlay，最终1605份输入集合SHA256 `0c99cce6c1c6b8fbfa71cd9435737ca511673e9bf13d8a2b74eefad4341d4554`。`build-3.log`正常构建退出0，保留既有Rollup/大chunk提示；`final-dist-freeze.json`为175文件集合SHA256 `ce7a03c5e6dc63f7bb77b814c42e4008632ad6dd94920a80b7eec363a0e81183`。最终两条受影响旅程只消费这个独立生产包，根目录后续并行编辑不纳入本轮已验证声明。

最终`core-browser-4.log`在独立preview5235、单worker隔离headless Chrome上2/2通过，日志退出0；`final-core-results/`与`final-core-journey-summary.json`保存实际下载和事实。森林2%→3%局部修改后10物件、0房间，混合局部修改后35物件、2房间；两者均经真实Worker生成，保护后一次采用、撤销/重做、冷开document/identity/appearance及资源hash完全一致，原工程完整保全，无生成服务请求或pageerror，玩家PNG分别4096×3072、4096×3277。这里只是两条代表旅程的正确性证据，不是运行时间/视觉验收或全部浏览器矩阵；自有preview已关闭。额外只读交叉审阅未发现边界过滤破坏人工/锁/依赖或旧重放路径，静态审阅不代替上述运行证据。

最终`closeout-facts.json`核对独立1605份输入及175份产物无漂移、独立`todo.md`未改、`git diff --check`通过；正在变化的根目录文件及新增输入逐项报告，不断言其与独立副本一致。所列相关文档共检查808条本地链接/679个Markdown锚点；核心合同及证据链接有效，另有并行页面密度任务尚未写入的`workspace-information-density-20261109`一处待补锚点，单独列为`parallelPendingLinks`，本任务没有伪造该任务证据或改写其入口。

全部浏览器使用独立headless上下文与临时站点库；未打开外部可见窗口、操作用户原库、调用真实AI或目标VTT。`todo.md` SHA256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`，未提交、推送或部署。CDP诊断窗口已明确释放；本项必要开发自检完成，后续按09进入实际影响范围验收。完整失败矩阵、跨浏览器、正式性能/容量、视觉/P3、真实AI及VTT仍分别保留，后续存储/目录独立整改不继承本轮通过结论。

<a id="workspace-information-architecture-implementation"></a>
## 工作台信息架构与左右分工实施（2026-11-08）

用户授权完成[07实施计划](../07-roadmap.md#workspace-information-architecture-plan)的1–8项。本节只记录该工作线的开发自检，需求及归属见[01](../01-product.md#workspace-information-architecture-requirements)和[架构参考](../reference/editor-and-architecture.md#workspace-information-architecture)；[09正式矩阵](../09-quality-plan.md#workspace-information-architecture-acceptance)、P3及发布保持独立。原始日志、截图、下载工程和指纹保存在被Git忽略的`work/workspace-ia-implementation-20261108/`。

### 实施范围

- 外壳改为八个直接模块：场景、素材、建筑、地形、氛围、生成、AI、历史。左侧负责查找/组织/任务入口，右侧负责所选对象、活动工具和候选审阅；文件操作在顶部，选择/平移及绘图捷径在画布工具条。旧“资源面板”总分类、七模块网格和右下全局导航已退役。
- 模块浏览、画布选区、查看图层/绘制图层、工具草稿和素材临时详情分别保持状态。场景统一虚拟对象搜索，图层的查看、设为绘制层和选择成员是三个独立动作；名称、显示、世界/导出范围、资源完整性和既有通路检查有独立场景设置入口。
- 建筑/室外工具使用单份参数表单；退出取点保留参数草稿。素材详情可返回原对象、工具、候选或目录；独立保留导入/管理入口。六类表面铺装沿原目标类型处理，实例与图层规则分离，区域滤镜不再借用雾表单的范围。
- 生成、局部修改、AI及历史候选通过`WorkspaceReview`进入右侧，采用/取消仍调用原处理器，不复制领域事务。历史列表留左、恢复配置归右；自动刷新票据不能取消显式刷新。玩家预览不展示迟到的完整AI审阅内容。
- 1080px以下一次只打开一个抽屉，保留草稿、模块滚动及返回焦点；UI偏好v2只读迁入旧v1，不改写旧记录或工程。Esc按实际焦点和事件所有者分层处理，Enter仅完成绘图预览。帮助、现行入口说明和相关浏览器测试定位已同步。

### 实际运行与冻结

正常`npm run build -- --outDir work/workspace-ia-implementation-20261108/dist`退出0，包含应用及AI类型检查，日志`build-drawer-escape.log`。保留原有Rollup注释和大chunk提示；这不是性能测量。单元自检`unit.log`实际运行布局偏好与场景剪贴板两个文件，13/13通过；命令中误列的`src/editor/main/session-guard.test.ts`不存在，未计为已运行。

最终正常生产包由`http://127.0.0.1:5209/sceneweave/`提供，Playwright使用隔离的headless Chromium上下文，单worker串行；没有打开用户的外部可见浏览器或操作其原站点工程库。最终整合结果收录于`verified-browser.log`及`verified-results/`，收口检查另见`closeout-facts.json`。

| 最终包代表范围 | 证据内容 |
|---|---|
| 信息架构 | 八模块直达、画布单实例与选区保留、临时素材详情返回、候选确认保留、查看层/绘制层分离、900/390px单抽屉和草稿焦点返回、滤镜范围独立、旧偏好只读迁移与冷开 |
| 建筑/地形与Enter | 1512/390px长表单和草稿取消；矩形、多边形、地形/道路完成绘图及不完整连接拒绝，Enter不直接采用 |
| 键盘与窄屏 | 1512×982、900×800、390×844；Tab/Shift+Tab、菜单Esc、复制粘贴、删除取消、长候选确认/取消、撤销、保存冷开及完整包内容核对 |
| 历史失败恢复 | 1512/390px真实IndexedDB方法故障注入；读取失败显式重试、实体/图层锁提示、保护点失败事务回滚及重试采用，保留当前完整包和撤销状态 |
| 完整制作与交付 | 1512/390px正常新建、本机Worker室内生成、移动/撤销重做、冷开hash一致、GM/玩家PNG和空库重新导入；每例实际2房间9物件，双受众4096×2731，无服务端生成请求 |
| 曲线 | 1512/390px实际拖动；范围不足拒绝、明确扩大范围、预览取消、保护采用、撤销重做和冷读hash一致 |
| AI接续 | 受控provider经真实本地服务与正常工作台，导航不重发，读取新鲜授权PNG并保护采用；仅证明接线与会话语义，不代表真实收费模型验收 |

实际目视复核`verified-results/complete-journey-*/panel-场景.png`的桌面布局及`04-generation-candidate.png`的390px候选：八模块文字和图标可见，左侧图层/对象与右侧物件参数分工明确；手机候选的摘要、采用和取消入口没有水平溢出。桌面截图已安排在Codex侧栏显示；这是开发观感检查，不代替用户P3签收。

运行时源文件集合1235项，`final-runtime-manifest.json`集合SHA256为`bf19d75c57d01ab5cf673e175c6807238c14d11524f0b3f6469d032e2ea73014`；正常产物175项，`final-dist-manifest.json`集合SHA256为`3d7621830f3318337dd22a5f095ac9669c94e9c6ef64de2245398afc003800b8`。集合摘要算法为对路径→文件SHA256映射按key排序、紧凑JSON编码后再SHA256；源集合包含`src/`、`public/`及package/lock/Vite配置，不含`tests/`和`docs/`。本工作区同时有独立存储、渲染和容量整改，指纹绑定实际整合状态，不将它们归为本次UX新增功能。

### 首败、修复与证据边界

早期开发服务HMR及旧导航选择器使`e2e-1.log`、`regression-browser.log`的运行中断；转为正常冻结生产包。`ia-browser.log`首轮4过3失败，包括隐藏表单重复定位和窄屏焦点恢复；修正唯一可见目标及关闭抽屉后过期焦点记录。`final-browser.log`在Enter问题修复前中断，其中完整旅程和曲线各两宽度通过，不能称整轮通过；旧包和指纹保存在`dist-before-enter-fix/`与`before-enter-*-manifest.json`。

`closeout-browser.log`完整执行17例，13过4失败：窄屏历史测试未等候选出现便关闭/重新打开抽屉造成测试时序竞争；900/390px画布Esc被“任意抽屉已打开”的全局守卫挡住；图层断言匹配了两份不同工具提示。分别补真实可见状态等待、让抽屉只消费属于自身焦点的Esc、精确定位房间提示。另修正画布已preventDefault后的候选取消传播、仅取点未修改字段时的工具草稿标记；不删除领域或完整包断言。该轮旧包保存在`dist-before-drawer-escape-fix/`及`before-drawer-escape-*-manifest.json`。最终结果只计最后冻结包的实际运行，不拼接此前通过数字。

最后正常生产包的`verified-browser.log`完整执行21例，20过1失败：信息架构原7例、完整旅程、曲线、Enter、历史、AI及桌面/900px键盘通过；390px键盘脚本在右抽屉未关闭时点击被遮挡的画布工具，超时。仅将测试改为先用真实关闭按钮收起抽屉，不改产品或产物。`interaction-confirm.log`复验三种宽度键盘，3/3通过；同批新增断点用例首次因把随视口尺寸调整的相对zoom误当恒定值而失败。修正为检查有效缩放、原草稿、revision、可见焦点及无水平溢出后，`breakpoint.log`独立1/1通过，覆盖1079/1080/1081往返并回到1512px。原7例和新断点共8个信息架构用例已有各自通过证据，不虚构为一次22/22运行。

最终源码及正常产物集合均无新增或改动漂移，649个相关文档本地链接/锚点检查通过，`git diff --check`及新增文件空白检查通过；详见`closeout-facts.json`。已完成开发整改，下一接续为具体页面反馈及09正式矩阵。

本轮未执行真实中文输入法、系统失焦或VoiceOver，遵循用户已决定跳过的范围；合成composition/229事件及ARIA/焦点检查不替代原生实测。完整玩家秘密配对矩阵、跨浏览器、200%缩放、真实AI、正式性能、P3与目标VTT仍按09执行。开发自检不能写成验收或发布通过。上述开发实施阶段没有commit、push或部署；独立`todo.md`前后SHA256均为`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`。

**提交前独立核验（2026-11-08）**：用户随后明确授权commit/push。以当时HEAD `fb041f5`加本次IA改动构造独立副本`work/ux-commit-20261108/workspace/`，排除并行的存储、SVG、容量与预览调度改造；共用`Workbench.tsx`只提交IA部分，`AssetCanvas.tsx`的调度改造及`persistenceBusy`接线留在工作区。该副本正常构建通过；布局偏好/剪贴板13项单测通过；正常生产包的IA8例、Enter2例、历史恢复2例及三宽度键盘3例在同轮15/15通过。日志为同目录上级的`projected-build.log`、`projected-unit.log`与`projected-browser.log`。待提交文档601个本地链接/锚点通过，新增代码无素材或第三方许可变更，凭据模式检查无命中。本证据只覆盖本次提交树，前述完整制作/曲线/AI等仍绑定各自整合冻结；不以此次检查替代正式验收或发布。

<a id="workspace-snapshot-20261108"></a>
## 2026-11-08：不可变会话快照与保存/预览架构整改

用户先要求将方案成文，再按确认方案全部实施。目标合同归[04](../04-scene-document.md#workspace-snapshot-contract)、[06](../06-storage-and-export.md#snapshot-persistence-contract)，实际分层归[架构参考](../reference/editor-and-architecture.md#workspace-snapshot-architecture)，状态只归[07](../07-roadmap.md#workspace-snapshot-implementation)。本轮保留完整工程v1、schema4/native40、history v1和flat规范SHA；未操作用户库，未提交、推送或发布。

| 实施与风险 | 新鲜证据及边界 |
|---|---|
| 共享资源证明 | `validateProjectSnapshot`只识别校验器自有的确切不可变project/resource对，能力绑定owner、实际方法、并发能力及源处理器profile；联合批次按每份工程的真实源能力记证。未知/克隆/改闭包及公开validate继续全验；新能力共享在途验证、独立取消，失败/最后取消不晚签。新增14项包含能力替换、混合批次、取消与恢复。 |
| 保存与预览接线 | Workspace只有自动保存选择可选`saveSnapshot`，普通仓库适配器仍回退save；新建、导入及正式输出沿公开全验。runtime与editor renderer共用稳定平台能力。自动保存不重复未变像素验证，同时实际坏资源仍使保存失败并保留revision、内存和undo。两次门闩保存证明单writer、旧完成不误标新编辑saved，flush等待后续写入。 |
| 编码与真实存储 | `EncodedSnapshot`每操作独占，局部准备、current、checkpoint及计量共用同次local编码/完整SHA。必要全文证明固定3槽；事务实际读缓存另限64MiB。并发读取同current及同根checkpoint只物化一次，每个原生块get一次；外返工程/manifest/字节独立。自有写入失效、跨事务重新实际读块；内存正确不能覆盖真实坏块/坏资源/CAS冲突。超过原4Mi字符窗口的新旧内容与周期checkpoint用例保持原recordHash。 |
| 预览与清理 | 每画布`PreviewScheduler`只保留最新主图/精细请求；替换立即撤销发布资格，等待已取消任务清理后再开该lane；保存/交互忙时暂停精细图，空闲恢复最新视口。测试覆盖晚到成功/错误、受众/会话替换、重复取消、严格生命周期、主图失败不由裁剪替代；临时Canvas释放。未新增长期像素缓存。 |
| 整合定向验证 | Node24.14.1，Vitest4.1.12，`--maxWorkers=1 --testTimeout=30000`。`integrated-verified.json`为18文件217/217；`resource-boundary-verified.json`为另2文件32/32；共20个不同文件249项通过。包含现有SVG、历史、repository、workspace、terrain/local生成及原子失败回归，不能替代全量09。 |
| 平台边界与构建 | 共享边界/无DOM编译228模块及Node ESM往返通过。正常`npm run build`在独立副本退出0，包括应用与AI类型检查；随后当前根目录`npm run typecheck`也退出0。保留原有大chunk告警，无诊断产品API。`source-snapshot.json`证明1606文件捕获前后无漂移且复制一致；随后根目录另有UI编辑，生产结果只绑定冻结副本。 |
| 真实生产旅程与输出 | `production-smoke-confirm`的建筑/自然/混合各500/2000完整Prop共6组complete、失败0、输入前后无漂移。真实组变换、撤销重做、成员与独立物件编辑、画布/列表选择、平移缩放、真实块/包审计、冷开及双受众4K通过。建筑两档输入与11月7日normal-control包字节相同；两档主持人/玩家4张4K PNG也逐字节相同，证据`normal-output-comparison.json`。不替代私密突变配对全集、视觉/P3或正式性能。 |

原始证据集中在被忽略的`work/snapshot-architecture-20261108/`。首轮旧decode调用数断言、测试tuple类型及SVG旧字段夹具已按实际能力/严格模型修正；共享层计时器导致无DOM编译失败后改为结构取消订阅，完整共享检查复验通过，没有加DOM全局声明。概览存在性查询由两次严格读取降为一次后同步旧次数断言，实际坏块、资源与事务反例保持。

生产运行器适配了并行任务的新导航入口；首轮因外层详情与内部内容同名“候选审阅”产生严格选择器冲突，失败目录`production-smoke/`原样保留。后续仅限定真实候选内容选择器，产品源码/dist未改变，工具调整单列`source-snapshot-tool-adjustments.json`。`production-smoke-confirm/`运行期间检测到另一个浏览器回归，整轮只作正确性证据；其耗时不纳入独占性能结论，冲突记录见`measurement-concurrency-note.json`。生产完整旅程及独占耗时的最终结果见[性能记录](../reference/performance.md#workspace-snapshot-20261108)。

首次及接续独占尝试均在监测到外部构建后停止，原始失败/中断和已完成子项保留，不拼接为本轮通过。用户随后明确授权协调测试/构建暂停；Git提交和推送可以继续。`production-exclusive-resume-confirm-20261108`于2026-11-08 20:48:49–20:51:28 +0800完整结束：监控/运行器退出0，两档均complete、失败0、clockGaps为空；先等60秒空闲并每2秒排查其他测试/构建及自动化浏览器，测量期间未检测到并行负载，结束已通知恢复。

新轮输入指纹仍为`3a580fd610118f85156401f6971e5ca6340ff3d6c3a31bc761c3efdcf627b62b`，前后未变；开始前核对冻结产品1478文件、保存/预览9个核心文件与当前工作区一致。两档完整包/实际块/资源许可、组变换和撤销重做、冷开与双受众4K通过；输入包及四张4K PNG与11月7日normal-control逐字节相同，比较脚本同时核对设备/浏览器、视口及操作次数一致。保存/画布的低样本前后区间、采样内存及剩余长任务只归[性能记录](../reference/performance.md#workspace-snapshot-20261108)，原值汇总为`exclusive-before-after-comparison-20261108.json`。2000档采样RSS较旧轮上升，保留为待复验风险；未以单轮判断泄漏或预先迁移Worker。

本项实现、正确性及受影响的独占低样本观察已经收口；该轮不替代正式性能/内存和完整安全/失败矩阵。用户随后授权的集成冻结、正确性复验及六组正式性能见下节，视觉/P3及其余验收状态保持。

<a id="workspace-snapshot-integrated-20261108"></a>
### 2026-11-08：集成冻结与正确性复验

用户明确授权“做123”：冻结已提交的新布局与快照架构，复验受影响正确性，再独占串行执行建筑/自然/混合×500/2000完整Prop各三轮。独立目录为`work/snapshot-formal-20261108/`，源码HEAD为`6fb36b4b622e7bf023119e2e2b107d98a865f712`，包含布局三次提交；`source-freeze.json`保留1606份源文件及当时脏树，正常构建后`product-freeze.json`固定1478份src/public/assets/dist，产品指纹为`e23a417b3d5b4010e9bf1abb5b40c3baee9554c8b67fb13b51508046d843103c`。`fixture-freeze.json`证明56份输入与原processor2完整v1容量语料逐字节一致，未重新生成身份；每次仍经正常UI严格导入并核对实际资源/像素/许可。

| 风险 | 本冻结的新证据与限度 |
|---|---|
| 会话证明、真实内容及存储 | `correctness-core.json`为15文件181/181，覆盖snapshot persistence、workspace/history、content context/blocks、公开保存证明、repository、incremental history、snapshot resources、renderer/scheduler、路径接缝与玩家投影；`fixture-contracts.json`另1文件8/8。不是全量测试或全部09。 |
| 平台边界与生产构建 | `shared-boundary.log`为228模块无DOM编译及实际Node ESM工程/历史ZIP往返；Node24.14.1正常构建退出0，应用/AI类型检查通过，仅保留既有chunk体积提示。 |
| 真实旅程与玩家输出 | 正常生产Chrome隔离context，1512/390px两档生成→编辑→undo/redo→备份→冷开→新库导入及双受众PNG成功；秘密房间/物件/注记/开口/遮罩按实际RGBA及文件元数据核对，两档成功。完整旅程见`correctness-browser`，窄屏隐私修复确认见`correctness-browser-confirm`。 |
| 保存/历史失败与CAS | 两档历史读取重试、锁拒绝、保护点写失败后恢复、undo和冷读成功，证据在首轮`correctness-browser-initial-interrupted`已结束的两个history用例；其另两个保存用例被主动中断，不能算该轮全绿。`correctness-browser-final`两档保存失败恢复2/2，分别注入原生IDB QuotaExceededError/UnknownError并检查内存及持久分支、备份、重试/副本和冷开；不是物理磁盘耗尽。真实第二标签保存CAS见`correctness-cas-final.log`1/1。 |
| 真实DB坏块/缺块 | 新增`snapshot-storage-integrity.spec.ts`，`correctness-integrity`2/2：仅在临时独立context修改本次UI创建的唯一工程当前props块，分别翻转实际字节/删除块。manifest/revision/行SHA保持；原生get观察证明热保存和冷打开均重新读目标块并拒绝，内存编辑、递增revision与undo保留，故障块和持久行没有被覆盖；全页重载明确报告列表读取失败，不新建空工程。实际DB名、native40、引用/实际SHA/长度及命中归各例facts。 |

浏览器首轮因新布局抽屉与同名隐藏/可用控件出现3个定位失败；第一次修复后保存名称仍因重复控件失败，最终限定真实场景设置与enabled输入/按钮后2/2成功，窄屏秘密输出先关闭抽屉后成功。只修改三份测试的导航/上下文定位及操作顺序，保留故障注入、断言和原超时；未改产品。初次准备坏块测试时路径基准错误的命令日志也单独保留，未运行用例。最终测试字节清单为`test-entry-adjustments-final.json`，首版清单和所有失败/中断目录保持。

`correctness-evidence-index.json`索引本冻结11个不同浏览器场景的成功证据；它们来自如上明确的修复后定向运行，不宣称一次完整调用全绿。正式测量前另跑建筑500正常dist运行器smoke，退出0、输入不变、失败0，证据`runner-smoke/`，仅用于工具接线正确性，不计正式分布。

2026-11-09归档本项完整正式复测：`performance-coordinated/`于2026-11-08 16:03:11–17:23:09 UTC结束，18/18轮complete、失败0，运行器/监控器均退出0，无外部负载事件，独占窗口已通知恢复。1546份输入/工具/产品文件复核无漂移；18份raw的SHA及压缩后内容与manifest相等，冻结工具重算summary也一致。所有完整包编辑后/冷读摘要及资源许可源闭包核对通过；36张真实4096×4096 PNG大小/SHA有效，同case同受众三轮字节一致。该配对只证明重复轮输出保持，不代替私密变形对照或用户P3。

六组矩阵完整不等于全部验收通过：三类500的固定独立Prop即刻字段编辑100ms及连续帧33ms子项通过；混合2000第三轮及合并帧33.4ms、两处短暂选择阶段缺内存样本、CPU辅助进程连续性提示和剩余长任务均保留，具体数值与原始证据只归[性能参考](../reference/performance.md#workspace-snapshot-integrated-20261108)。前两次被外部tsc/Vitest中断的目录原样保留、不拼入新轮。

本轮只调整测试入口、增加隔离故障用例并维护现有证据文档，后续核心收束代码不计入该产品冻结；用户脏树/独立todo保持，未提交、推送或发布。

<a id="root-remediation-20261106"></a>
## 2026-11-06：容量/视觉失败后的根因整改

本轮承接用户授权的根因整改，保留上次正式失败证据和无关界面编辑；不提交、推送或发布。完整工程仍为v1，SVG processor2是独立处理协议；数据库结构未变，用户IndexedDB未打开。现行数据/存储合同归[04](../04-scene-document.md)和[06](../06-storage-and-export.md)。

- 严格认证的有限Prop执行器覆盖归组与组外独立物件的位置/角度，真实写集贯通逐步预算、受控资源派生、元数据大小、revision和提交。托管成员、真实生成/过渡影响及不支持字段保守回退；瞬时往返工作不按最终零差异免计，外部克隆/伪冻结/替换资源闭包不继承证明。
- 保存先完成原公开全量验证，再以真实工程凭证和完整世界/持久内容精确相等尝试局部历史差异及变化Prop桶编码。缓存最多4项/64MiB，只保留自有内容/清单/字节；完整SHA、累计预算、事务内CAS和DB实际块校验保持。非法角度不能通过坐标归一化成为合法候选，真实缺块/坏字节均拒绝，原持久revision保持。
- SVG生产、验证及固定派生统一至固定SHA的resvg2.6.2 WASM及软件RGBA8/PNG链。原processor1不自动改写；独立CLI用原环境完整校验后分配新固定身份与lineage，保全原包和旧历史，拒绝未支持的生成/区域/aggregate转换。上次确切失败室内包已在Chrome157完成原件保全、转换包落盘复读及canonical-only冷导入，`mapping.status=complete`，源文件未变。
- 同层/同高程/同样式可见道路的内部交叉描边移除，物理模型和命中保持；五类固定视觉输入新增真实算法7自然岩阶/高台树木，不用旧直梯夹具替代当前能力。

必要自检：工作区/局部准备/历史差异3文件55项、SVG/投影/预算/PNG/道路9文件73项、内容块及真实Workspace保存2文件21项、校正后的artwork7项通过；另有资源、旧SVG迁入及视觉投影定向用例通过。正常构建和228模块共享边界检查通过。预览采用不再重复解码、canonical不再调用原生PNG编码器，两处旧故障注入/调用数断言随实际协议更新后复验通过；没有放松保存或冷读解码断言。

实际生产输入及代码分别冻结在`work/root-remediation-20261106/fixtures/`与`workspace/`；完整源快照清单见`source-snapshot.json`。建筑500/2000低样本完成且包/冷读一致，领域提交为19.1–19.7/87.2–98.8ms，但保存与绘制仍秒级，详见[性能观察](../reference/performance.md#root-remediation-20261106)，不关闭正式门。五类三引擎长链视觉复验已保留5项Chromium通过、Firefox室内超时/岩岛中断及其余未运行；五类普通图及恢复包的正常生产三引擎SVG/冷读专项18/18通过，完整领域/资源/许可和冷读条目hash保持，详情及独立源码冻结归[视觉台账](visual-quality-validation.md#root-remediation-20261106)，不替代完整视觉长链。用户P3、真实模型、全部09及VTT仍分别待验收。

<a id="current-formal-acceptance-20261106"></a>
## 当前完整v1容量、性能与视觉验收前置及结果（2026-11-06）

用户明确授权执行正式容量、性能与视觉专项，合同来自[09](../09-quality-plan.md#acceptance)，当前状态只在[07](../07-roadmap.md#acceptance-stage)维护。共享工作区有其他开发并行修改，因此本轮以`work/formal-acceptance-20261106/workspace`独立副本运行；原始源码/合同、修正前后hash、完整失败日志、输入包与正常dist分别保留。结果只适用于该副本，不能外推为随后共享HEAD、线上版本或完整项目通过；未操作用户存储，未授权提交、推送和部署。

### 正确性前置及保留的失败

| 检查 | 真实结果与边界 |
|---|---|
| 首轮完整单元 | `unit-full.log`：356文件中348通过、8失败；3415项中3391通过、24失败，1094.50秒，退出1。当次npm实际使用Node26；后续固定绝对路径Node24.14.1。失败包括旧schema/历史出生身份/预算计量测试输入、迁入内容块审核缺陷及默认5秒超时，原日志保留。 |
| 修正后完整单元 | `unit-full-final.log`：356文件中355通过、1失败；3420项中3419通过，1090.77秒，退出1。唯一失败为`terrain-candidate.test.ts`保存中取消用例5020ms超过默认5秒；仅该用例给20秒预算、保留门闩与保全断言，随后全文件14/14通过（`terrain-candidate-final.log`）。这是完整轮失败后定向通过，不能写成单次完整全绿。 |
| AI模块回归 | 首轮`ai-unit.log`为41文件40通过、554项552通过，375.63秒，两项17配方stage触发默认5秒超时。两项设置局部20秒后，`ai-unit-final.log`为41文件40通过、554项553通过，322.05秒；剩余接续重复/回退预算用例6264ms超时。该文件以显式`--testTimeout=20000`复验16/16通过（`ai-continuation-budget-final.log`，66.37秒），不改产品预算，也不将两轮数字合为全量通过。 |
| 类型、边界和正常构建 | `typecheck-final.log / typecheck-ai-final.log / typecheck-formal-final.log / check-shared-final.log / normal-build-final.log / ai-build-final.log`对应检查退出0；正式工具/夹具额外显式类型检查，不假定默认tsconfig已包含它们。正常dist无性能专用产品钩子。容量夹具必要测试8/8通过，输入准备另做实际图片、许可及完整包冷读。 |
| 本机迁入真实修复 | `development-import.ts`原先先由完整projects写出内容块，再把空预期块表判为额外成果；冷审核又把native清单与完整工程直接比较。现从已全验完整rows用同一`partitionProjectContent`推导真实行与唯一不可变块闭包，安装与冷审核比较同一物理表示。不允许额外块、不跳表、不放宽schema或来源保护。合法暂存重试、缺块/坏块/额外块及源/既有成果保全反例共17/17通过（`migration-corrected.log`）。未改数据库结构，不清库。 |

首轮测试输入修正包括旧schema3使用确切`PROJECT_STORES_V3`、Dexie/native版本断言、通过真实`advanceHistoryIdentity`建立组合出生，以及按当前04分别检查固定源和semanticTargets；1025原始命令即使最终改回仍拒绝，累计几何工作不清零。夹具准备首轮失败、冒烟和视觉取景修正也各自保留，不混入正式分布。

### 正式输入及执行边界

`fixtures-second/preparation.json`为complete：建筑/自然/混合各恰好500/2000完整Prop、零Decoration；另有mixed500远端增加500完整Prop，以及16条真实局部外接支撑连接。完整资源/许可/来源和既有人工记录保留。范围180×180m、3.6m显示网格，实际50×50格；原细节集中在合法focus/remote支撑范围，不能冒充全图均匀可见密度。局部连接组变换必须因外部支撑不完整而拒绝，是安全负例。准备器移除了会全量重绑既有森林缩放素材的生成专用bind调用，保留原固定快照；由Decoration转成完整Prop的新输入不宣称与旧j样本逐像素相同。

三类500正常生产冒烟`smoke-second`均complete、无失败，仅每类2次组内预览/采用和2次独立即刻编辑，不作为正式p95。正式性能使用同一冻结输入、正常dist，六组各三轮，每轮30次组内预览/采用和30次独立即刻编辑，连续输入、选择、冷读与双受众4K分列；实际结论归[性能参考](../reference/performance.md)。正式采样期间本任务不并行测试、构建、准备器或其他自动化浏览器，OS及其他应用背景另记录。艺术近景按实际几何固定，技术检查与用户P3分开，结果归[视觉台账](visual-quality-validation.md)。

### 正式运行结果与复验边界

性能原六组冻结A在natural-2000第3轮期间由测量运行器V8内存溢出退出134；之前已有合盖睡眠与超时失败，原日志、电源事实和采样缺口保持。产品Chrome内存与Node运行器内存分开，不把工具OOM记为产品OOM。仅修正工具在raw落盘后的重复资源序列保留方式，11份既有结果raw/compact汇总深相等；随后只运行原来尚未启动的mixed两组，各三轮独立冻结B。两份summary均failed，实际分布、失败及完整矩阵缺口只在[性能台账](../reference/performance.md#current-formal-acceptance-20261106)维护，不能拼成一轮全绿或自动补跑替换失败。500完整Prop三类的即刻编辑均未达到100ms目标，容量与性能未签收。

最终视觉输入单独冻结，沿同一正常dist执行三引擎四类样图。Chromium四类完成普通/中性全景、真实结构与物件编辑、冷读/空库导入、双受众4K及私密物件移动配对；代理目视复核发现成图缺口，用户P3未签收。跨引擎实际失败、固定近景和观察记录只在[视觉台账](visual-quality-validation.md#current-formal-visual-20261106)维护；本节不把秘密位移配对外推为完整09保密矩阵通过。

收口审核：最终视觉源码/构建/工具1474文件及输入38文件hash与集合无漂移；实际PNG附件hash/尺寸、16个原生近景和八份失败截图/trace均已核对。运行器与汇总工具`node --check`、共享工作区`git diff --check`通过；七份相关文档586个本地文件/锚点链接零错误。`visual-final-audit.json`、`document-final-check.json`和普通样图复核页`review.html`留在本轮忽略目录；复核页59个本地附件链接全部存在，本机HTTP读取成功，已请求在当前会话Codex侧栏展示。正式测试preview已停止，其他任务实例保留；未提交、推送或发布。

<a id="aggregate-integration-j-20261106"></a>
## 层级组合代表性整合与开发交接（2026-11-06，j）

本轮消费[07的a–i](../07-roadmap.md#t2-implementation)，新增复杂负载夹具与隔离正常生产观察工具，完成登记范围的j开发交接。未为观察修改产品实现、数据库结构或任何保护，未操作用户库；方法、实际负载/CPU/内存/逻辑字节只在[性能参考](../reference/performance.md#aggregate-integration-j-20261106)定义，正式矩阵继续归[09](../09-quality-plan.md#aggregate-capacity-acceptance)。

| 开发核对 | 最终证据与边界 |
|---|---|
| 工具与真实输入 | `tools/testing/aggregate-capacity-fixtures.ts / .test.ts / aggregate-capacity.vitest.config.ts`及`tools/performance/run-aggregate.mjs / aggregate-observer.mjs / summarize-aggregate.mjs`。旅舍/岩岛/林中建筑各500/2000细节及mixed500远端＋500、远处独立＋16连接共8组，完整Prop/轻量Decoration和实际结构/来源/许可分别列数。1/32目标修改都使用真实正常UI，不能当作500/2000完整Prop或局部端口增长的验收。 |
| 夹具必要自检 | `work/t2-j-fixture-privacy-attempt-2.log`：1文件8/8通过、退出0；完整物理变换、真实支撑/来源/人工记录、单一local往返、原及移动后外观感知玩家投影，移除固定mask拒绝。纯测试不伪造缺失派生图片；浏览器正常异步prepare另做真实物化与全资源/许可/包冷读。最终夹具类型检查退出0，空日志`work/t2-j-fixture-privacy-typecheck-final.log`。 |
| 正常构建与隔离冻结 | 共享源码曾漂移，首次观察测量前拒绝；复制显式源码、配置、工具、assets/public至`work/t2-j-frozen-workspace/`，`work/t2-j-snapshot-capture.json`证明源捕获前后与目标一致。副本正常构建`work/t2-j-frozen-build-verified.log`退出0；src1042文件集合SHA256 `63f7eb0e111cbb96be58f427582fd5a3b81242e3d10983f96656feed77f10080`，build86文件集合SHA256 `bc03b0d7d55ae1fd44b6f979041609d3b633decc9f7e2b36d1d47f2c69faa162`。结论仅绑定此副本，未声称后续共享源码全量验证。 |
| 最终正常生产UI | `work/t2-j-observation-final.log`正常退出0；最终manifest为complete，8/8组、66/66次操作完整，失败列表空。Apple M1/16GiB、Node v26.0.0、Chrome157.0.8103.38、1512×982/DPR1，每case fresh独立进程/profile/IDB。整体＋1m X、一次撤销重做、单件世界＋1mm X、mixed500另32目标＋1mm X、保存与冷开；输入集合指纹 `491710855da1b07b1a204156f97e2f0a50259e813325f877b782895ced7e9299`，每组后src/public/assets/build及工具核对无漂移。 |
| 内容与资源保全 | 正常导入只允许fresh根sceneId/createdAt/updatedAt，其余完整scene/identity/appearance/sources和确切资源/许可一致。根frame精确平移、子frame/完整local成员集合保持、范围外记录不变；固定表面源允许确切随动派生且保全父链。曲线/物化边缘有offset/inputHash检查，其他生成metadata仍由完整领域合同验证，未独立建立所有生成hash的期望器。撤销重做完整内容对齐，单件及32目标修改集合精确，8组冷开全部包条目hash相同。 |
| 字节、CPU与内存 | 最终summary保留66项单次值与所有阶段。单件新增块714–2818B，但变化清单/历史行246339–384021B；整体新增块27594–200104B。只读SHA审计证明逻辑内容共享，不是物理I/O或重复写计数；CPU/内存与冷读不由新块数推断。产品阶段RSS采样峰约1053–1302MiB，JS目标堆峰约88–152MiB；不计工具阶段，不冒充去重物理/GPU峰值或正式门。 |
| 审计、缺样与退出 | 资源采样错误0；mixed500撤销新生一个CPU0的Unzipper，原样保留CPU连续性警告。boundary远端选择过短，RSS/heap缺样为null。页面/HTTP/console/browser错误0；36条首页缩略图/favicon导航ERR_ABORTED保留。8个专属浏览器均rootExited=true/killed=false，4个退出实例额外释放遗留pipe；专属server随runner关闭，不停止其他任务实例。 |
| 截图及保密边界 | 已查看最终mixed500候选/编辑后、natural2000编辑后截图，确认菜单关闭、正常画布与实际预算可见。整体目标building/mixed为1、自然为3，组内影响继续另计；500/2000各自档位和全部保护保留。私密Prop、GM note/秘密门与固定mask预检不等于实际玩家PNG或用户视觉P3。 |

最终附件在被忽略的`work/t2-j-observation-final/`：manifest/summary、每组JSON与真实输入/基线/移动/撤销/重做/编辑/冷开包、预览及编辑后截图。夹具最终SHA256：主文件`6d31c5c629977ff8158117aacd4953e2d4393aaa13cb496b59300089bf12e17a`，测试`b5877d608276db8ffa018a408797d90bc7c11fc241b343ce3e27b715af797f2b`，配置`0f6fe4ead98df1b6b49d044a31731f30683ed753dcd87c4a4a7227760f3082c2`。只引用最终轮数值，不与reviewed或早期部分结果拼接。

### 首轮失败与修正

| 保留现场 | 原因、修正及同范围复核 |
|---|---|
| 初始fixture日志及attempt6–10 | scale低于严格下限、密度支撑不足/图像与足迹重叠、内嵌ID重复、terrain扩展未分段及managed记录/hash未协调；修夹具尺度、合法扩展/分段、确定性非重叠放置与真实人工状态，不放宽产品校验。最终8项与正常browser准备通过。早期部分日志曾覆写，不声称所有原现场齐全。 |
| `t2-j-observation-first`、首份冻结build日志 | 工作区独立UX源码变化使测量前fingerprint拒绝；改为完整副本。首份副本build缺assets，补齐后重新正常构建成功；两次失败原样保留，不计入观察。 |
| `t2-j-observation-isolated` | 工具误要求正常导入保持根ID/时间；改为仅允许产品fresh根sceneId/createdAt/updatedAt，其他字段/身份/资源严格不变。 |
| `t2-j-observation-ui2`、privacy attempt1 | 原mask不足，真实玩家投影拒绝且工程未变；固定世界mask同时覆盖旧/新paint与shadow，去mask反例保持。纯测试缺天然派生图片时，分开物理/外观投影与正常浏览器实际materialization，不造假图片。 |
| `t2-j-observation-masked / ui3` | 工具把组内Enter产生候选误当直接提交，继而误等并不存在的结构confirm；改为真实“采用组件修改”流程，仍保留完整预览和采用核对。 |
| `t2-j-observation-ui4` | 建筑两组完整通过后，工具误拒自然移动时合法固定表面源派生；改为核对确切平移snapshot、完整父链和其他字段不变，最终自然两组及全部8组通过。 |
| `t2-j-observation-reviewed` | 8组66项完整通过后截图显示导出菜单遮挡画布，属于工具操作状态问题；每次下载后关闭菜单并等ready，另以final完整复核，旧轮保留且数值不混用。 |

收口检查：三个新增mjs的`node --check`、相关文档`git diff --check`通过，五份相关文档448个本地文件/锚点链接零错误；最终manifest及66项完整状态、8组冷开hash、采样与浏览器退出复核通过。五份夹具/运行器文件与冻结字节相同，新增工具无行尾空白；独立`todo.md` SHA256仍为`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`。

j本地开发交付完成。尚存全量物化/JSON、领域和资源验证、清单/历史序列化与冷读成本；自然逐成员锁视图是待profile确认的候选瓶颈。完整Prop容量、真正局部端口、连续交互/正式p95、完整历史/故障、多浏览器、玩家PNG、视觉/P3及1万/10万均未关闭。容量开发线移交09输入，UX独立剩余项继续按07推进；未提交、推送或发布。

<a id="aggregate-building-transform-20261106"></a>
## 完整建筑组整体操作开发自检（2026-11-06，d）

本次承接[07的d](../07-roadmap.md#t2-implementation)，当前完整v1及b/c服务继续复用。有限合同归[04](../04-scene-document.md#aggregate-building-transform)，坐标持久化归[06](../06-storage-and-export.md#aggregate-chunk-storage)，正式验收仍由09统一执行。

| 范围 | 实现及本次证据 |
|---|---|
| 完整成员与正常UI | `buildingAggregateMembers`从真实共墙/共顶点连通结构、房间支撑物件/道路、门窗、容器和实际附着注记推导移动闭包；只读地形及其注记不归组。`inspectAggregateBuilding`重算组子树必须恰好拥有全部移动成员，缺少/额外/后增/跨组共享结构拒绝。建筑面板明确创建组、选择整栋与进入内部；创建归属也列真实成员并走原审阅确认，不因位置猜测收编Floor物件。 |
| 同一完整事务与坐标 | `transformAggregateBuilding`复用现有建筑事务，整数毫米平移与0–3次四分之一圈旋转；先在world物化完整实体，再将根worldFrame反算父local frame，子frame保持。嵌套父旋转、家具、室内道路、门端点与沿墙距离、GM注记、实体ID及出生/未变拓扑保留；近侧视继续原固定方向策略。完整包与IDB继续唯一local落盘和完整world冷读，不新增schema或数据库版本。 |
| 外部真实冲突 | `assertAggregateBuildingClearance`只在非noop组变换后检查最终位置，复用真实厚墙/结构门洞/miter2或bevel、旋转及offset物理足迹、阻挡Region、完整方端帽/转角道路带和有限门前带。同Floor正面积侵入拒绝，纯接触/大图小占地不误当物理冲突。足宽门洞允许、蹭jamb/转角延伸/外部阻挡及宽路冲突有定向例；门开关/通行锁/秘密保持。单端随动的外接台阶/坡道明确拒绝，不暗中拉伸或重绑。此检查不代替全图寻路，也不对无关外部旧冲突加硬约束。 |
| 外观、预算与安全链 | 固定表面源从原始snapshot派生位置/方向，保留父源、有效层/实例覆盖及已有派生材质；不能把有效外观烘焙成源。成员/递归注记/层/支撑锁按原策略检查，组锁字段仍未开放；manual计实际成员与元数据而非把整栋算1。Workspace预览不写库，取消/旧基线拒绝，采用一次revision和撤销，flush/冷读/完整包及玩家过滤有实际断言。整体命令仍完整几何与资源/许可/像素验证，不扩展c的prop-only内部证明。 |
| 源码定向检查 | `work/aggregate-building-final-tests.log`记录最终13文件92项集合：12文件通过，合计91项通过、1项既有manual累计几何用例超30秒；该文件随后独立以相同30秒上限复验3/3通过，11.93s，日志`work/aggregate-building-budget-recheck.log`。其余最终集合覆盖新增building-transform/clearance、真实Workspace、旧building-edit/appearance、聚合合同/坐标、c回归及命令等价，不把失败集合记为全绿。增强有效外观源断言后相关2文件14项曾通过，日志`work/aggregate-building-appearance-tests.log`，不与最终集合相加。 |
| 类型、平台与正常构建 | `npm run typecheck`通过；最终`npm run build`通过前后端类型和正常生产构建，日志`work/aggregate-building-build.log`，保留既有依赖注释、静态/动态导入及大chunk警告。`npm run check:shared`通过，219个源码模块及原生Node ESM/既有无DOM烟测，日志`work/aggregate-building-shared.log`。 |
| 正常生产Chrome | 独立5198 preview、本机Chrome及隔离context，`SCENEWEAVE_BROWSER_CHANNEL=chrome SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5198/sceneweave/ npx playwright test tests/aggregate-building.spec.ts tests/aggregate-boundary.spec.ts --project=chromium --workers=1`：2项通过，总2.1m。新组旅程创建预览取消r0、确认采用r1、整栋选择/内部选件、平移1m+90°预览取消、采用r2、撤销r3/重做r4、保存刷新首页重开；物件9.5/4.5m与90°、实际道路坐标/支撑、秘密锁门及附着GM注记保持，组外Floor物件仍16/16m，无pageerror。原物件旋转/墙厚边界旅程也通过。截图`test-results/aggregate-building-create--a6335-he-saved-production-project-chromium/`，日志`work/aggregate-building-browser.log`，本次preview已停止。 |

失败与修正保留：新表面材质测试最初使用错误字段，严格schema拒绝，改为现行textureAssetId/defaultTileSizeMm及完整定义字段后通过。独立审查发现只读地形支撑的注记被原buildingDependants扩入组；修正为从实际移动实体递归推导note归属，原支撑锁/审阅闭包保留。对应测试新增大地形后组外Floor物件支撑已不成立，明确设为该真实地形支撑后通过，未放宽产品验证。预算用例首轮默认5秒超时，30秒串行集合曾通过；最终与其他本机工作并行时该例又超30秒，随后独立同上限复验通过，完整失败日志保留，不据此推导性能。

独立只读复核确认成员闭包、父frame/子frame、固定源、全几何、资源许可、历史身份和采用CAS链；截图人工检查及文档本地文件链接、`git diff --check`完成。保留共享工作区其他UX编辑；独立`todo.md`在并行工作中已有变化，本轮未编辑或回退它，不沿用上次hash宣称未变。未提交、推送或部署。

d的有限首条闭环实现与必要开发自检完成；下一执行点是e多领域聚合适配。整体仍逐实体物化和完整求解，不声明O(1)、大规模容量、分区加载/写入或稳定提速；真实用户工程、完整故障/容量矩阵、正式性能、视觉/P3与发布均未执行。

<a id="aggregate-contract-20261105"></a>
## 层级组合运行时合同开发自检（2026-11-05，a）

本次接续关联会话确认的容量大步骤a，新增`shared/model/aggregate.ts`、`shared/aggregates/contracts.ts`、`relations.ts`及共享出口。字段/拒绝边界归[04](../04-scene-document.md#aggregate-coordinate-contract)，存储目标归[06](../06-storage-and-export.md#aggregate-chunk-storage)，使用方映射归[设计3.8.9](../reference/general-map-generation.md#aggregate-consumer-map)，实施状态只在[07](../07-roadmap.md#t2-implementation)维护。

| 必要开发自检 | 实际结果及边界 |
|---|---|
| 真实完整场景与归属 | 通过当前命令创建两个相邻房间、唯一共墙、实际门与路径；嵌套组、共墙最近共同所有者、未归组/未索引实体及跨组支撑/注记关系可读。重复归属、父环、超过16层、缺父、跨Floor和错误共墙归属拒绝。空间块可以跨块引用同一实体而不重复拥有，重复块键、planned非空拒绝。 |
| 来源、端口与权威表示 | source绑定完整规范SceneDocument而非ProjectData；同revision换门内容仍拒绝旧source。刷新确切source后真实门记录hash随locked变化；类型读取保留完整实际实体，未把静态公共字段误当完整记录。门/路径端点绑定现存实际成员，缺实体拒绝；Floor为只读世界支撑目标，不能归组。a不生成端口几何或持续拓扑证明。向完整v1附加aggregates字段仍被原严格schema拒绝。 |
| 锁、秘密与只读性 | 当前选择锁闭包复用，组祖先、实际实体、既有Prefab父容器、递归注记/结构/支撑依赖及图层分别报告；公开对象在GM支撑或隐藏容器下仍保密。输出仅为GM诊断，vertex/note未求完整公开闭包时标unresolved。未知字段、访问器拒绝且getter未执行；输入保持不变、不冻结，输出独立深冻结，后续修改输入不污染结果。 |
| 能力与身份边界 | 自由角及scale拒绝，声明表示转换/换父级保留身份、复制/切割新实体身份义务。resident状态不能附带verified凭证。局部坐标持久化、整体变换、内部证明复用、分区加载/保存、几何切割及AI工具能力均仍为false；没有据类型合同改变普通预算或旧生成/AI重放。 |
| 最终定向 | Node `v24.14.1`；`npx vitest run src/shared/aggregates/contracts.test.ts --maxWorkers=1`：1文件11项通过。主代理最终同文件复验11项通过，90.08秒（transform83.83秒、tests1.33秒）；这是必要自检，启动/编译争用耗时不是产品性能数据。此前8项及补例过程中10/11不与本轮合并计数。 |
| 类型与平台边界 | 定稿后`npm run typecheck`通过（前端及AI类型）；`npm run check:shared`通过，209源码模块无DOM编译、Node ESM、既有命令/身份/投影、无图片完整/历史ZIP及保全集合烟测通过。没有执行正常生产构建、浏览器、真实用户库或正式性能；a未接产品UI或存储路径。 |

首轮失败与修正保留：SurfaceRef不是可辨识对象联合，最初把floor支撑交给实体引用造成类型错误；最终明确独立Floor只读关系，保留真实支撑。编辑中重复声明relations、误删锁服务import及一次锁摘要回退均已修正，定稿复验通过。测试夹具首次新增Floor缺默认层、把访问器错误码误认成新码，补例首次把房间改为floor支撑却仍被真实地形覆盖；分别修正默认层、沿用NON_JSON_INPUT和移除冲突覆盖后通过，没有放宽领域校验。端口hash最初审阅只看静态类型产生误判，现以完整实体类型和内容变化用例确认实际行为。

数据库、工程/包schema、算法/配方、固定素材、AI白名单均未改变；工作区已有生成器/UX编辑保留，独立todo.md SHA256仍为`15adcd89e490a92516316d35a6a3cbc260b0ae7851a93b7ea579750b532067b9`。未提交、推送或部署。本结果只证明a的运行时合同与受限检查；完整空间闭包、玩家摘要、内部证明、整体编辑和分区存储仍由后续子步骤实现，全部正式验收归09。

<a id="aggregate-coordinates-20261105"></a>
## 局部坐标与完整工程表示开发自检（2026-11-05，b）

本项承接[07的T2-b](../07-roadmap.md#t2-implementation)及[设计3.8](../reference/general-map-generation.md#aggregate-spatial-capacity)，依赖a的聚合合同。运行时以world视图供既有领域/渲染/命中消费；完整v1包、IndexedDB工程/快照/自动快照/导入快照及增量历史检查点以唯一local坐标保存。坐标字段和换算归[04](../04-scene-document.md#aggregate-coordinate-contract)，存储目标归[06](../06-storage-and-export.md#aggregate-chunk-storage)，正式容量与失败验收归[09](../09-quality-plan.md#aggregate-capacity-acceptance)。

| 必要开发自检 | 实际结果及边界 |
|---|---|
| 整数毫米坐标与表示命令 | BigInt中间计算及安全整数范围拒绝；往返覆盖平移、四分之一圈旋转、朝向、边界框、曲线路径与表面局部材质锚点。创建归属、换父级、解组保持世界几何和既有身份；未知/重复编码、非法父链、受锁成员失败保全。不实现整组空间移动、缩放/剪切或任意角旋转。 |
| 完整工程包及世界API | 工程包scene内容使用local表示，导入返回world视图；内容hash与完整场景一致。无聚合坐标字段的既有完整工程继续逐字节等价路径。 |
| 原生数据库与篡改守卫 | fake-indexeddb四类完整工程/快照记录与历史checkpoint写入local、读取物化world。Dexie对local记录只改坐标、只改encoding标记、同时改标记与坐标的嵌套载荷update均拒绝；与之同事务的前序metadata更新一起回滚，raw IDB行不变。完整world `put`正常转换，根级无关状态更新通过；未带聚合坐标的工程仍允许原嵌套修改。 |
| 增量历史与完整内容 | checkpoint JSON往返、local坐标差异的前后向重建和连续版本链通过；公开历史JSON读取回world项目，完整内容hash与保存图一致。checkpoint在完整链事务中只执行一次必要根校验。 |
| 定向自检 | `npx vitest run src/shared/aggregates/coordinates.test.ts src/shared/aggregates/contracts.test.ts src/shared/aggregates/commands.test.ts src/shared/aggregates/representation-integration.test.ts src/platform/browser/storage/aggregate-coordinates.test.ts src/platform/browser/storage/incremental-history.test.ts src/shared/project/delta.test.ts --maxWorkers=1`：7文件78项通过。`npm run typecheck`通过；`npm run check:shared`通过（214源码模块）。触及文件`git diff --check`通过。 |

上述是实现与隔离IDB夹具的必要开发自检，不是正式验收、真实浏览器存储故障测试或性能容量证据。完整故障/导入导出/跨版本/受众及正式性能矩阵仍统一留09；当前接续T2-c。未提交、推送或部署。

<a id="aggregate-boundaries-20261105"></a>
## 边界接口、空间候选与失效服务开发自检（2026-11-05，c首段）

本轮承接[07的T2-c](../07-roadmap.md#t2-implementation)及[设计3.8](../reference/general-map-generation.md#aggregate-spatial-capacity)。新增共享只读服务并把实际端口几何接入a合同检查；实现状态与待接线项只在07维护，正式覆盖矩阵归[09](../09-quality-plan.md#aggregate-capacity-acceptance)。

| 必要开发自检 | 实际结果及边界 |
|---|---|
| 端口几何与合同摘要 | 开口依赖稳定附着墙端点及本组唯一相邻房间，路径使用完整中心线端点/切线，高差连接使用真实两端支撑/高程；结构连接与门扇状态、完整路径带区当前局部阻挡分别报告。缺归属、歧义朝向/支撑、自报几何及失效来源拒绝。局部可通行不代表全图可达。 |
| 反向依赖与失效闭包 | 支撑、共享墙/顶点、门附着、道路/连接、Prefab/散布/装饰成员及注记显式反查；变更闭包稳定排序，几何和成员关系双向扩展，远距离支撑不依赖网格近邻。未知目标、悬空或跨Floor关系要求调用方全场景回退；相关Floor仍交完整空间验证器复核。外观资源、视觉、生成来源及精确空间接触没有被该实体图替代。 |
| 空间候选与受众 | 索引使用Floor隔离的多格包围盒覆盖真实房间、厚墙/开口、物件占地和视觉边界、地形、道路/连接、危险区与布景；长实体跨格登记，过大实体/查询退化为Floor扫描。玩家公开过滤先于索引，公开摘要不随私密几何变化；索引绑定完整scene，仅同一确切场景有效。旧/新范围查询仅返回保守AABB候选，不证明精确碰撞、净空、支撑或通行。 |
| 私有内部证明快照 | 证明由模块私有WeakMap身份签发，深冻结并绑定完整ProjectData元数据hash、场景/合同来源、组子树成员与引用、端口摘要、相关块清单、约束及算法合同；对象复制、过期工程/合同、约束或算法变化拒绝。验证重新完整检查工程/场景和合同，任何工程内容变化均失效；资源字节/像素仍交既有bundle验证器；当前不提供命令消费者、增量摘要缓存或跳过完整验证的快速路径。 |
| 最终定向与边界 | `npx vitest run src/shared/aggregates/*.test.ts`：8文件46项通过。`npm run typecheck`通过。`npm run check:shared`通过：217个共享源码模块无DOM编译、Node ESM及既有命令/身份/投影/无图资源包和保全set烟测通过。`git diff --check`通过。 |

以上只验证共享合同/服务及纯Node领域夹具，不含工作台命令消费者、真实浏览器、用户工程、性能收益或正式容量验收。空间索引需在确切来源变化后重建；大范围查询允许扫描整Floor。没有修改工程/数据库schema、固定素材、预算或AI权限；未提交、推送或部署。

<a id="aggregate-boundary-consumer-20261106"></a>
### 边界影响入口与单物件预览接续（2026-11-06）

保留上方11月5日冻结结果。本次在同主题下补齐`aggregates/boundary.ts`与`workspace/aggregate-boundary.ts`，属性面板对已持久归组物件的单次位置/角度修改进入正常`Workspace.preview`，GM审阅区展示旧/新范围附近对象与反向关联对象；未归组、其他字段和多命令继续原流程。当前实现状态与下一步只维护在[07](../07-roadmap.md#t2-implementation)。

| 必要开发自检 | 实际结果及边界 |
|---|---|
| 基线绑定与权限 | 编辑边界要求合同归属与工程持久groups一致，组/Floor匹配；公开证明另核目标组。临时提案不能把外部障碍划为内部；复制/过期句柄、空角色筛选、错误Floor/类型及访问器拒绝。`baselineProofValid`仅指原基线，`queryScope: supplied-bounds`只表示明确查询范围，候选仍全验。最初两条跨组/Floor回归复现失败，修正后同例通过。 |
| 独立捕获与有界复用 | 只读检查器独立冻结完整元数据/归属/约束，空间快照只查捕获来源；没有接受后续scene/proof的替换口。应用层只对确切已认证wrapper缓存，最多保留最近一个基线上下文；换基线重建，内部按目标组签发证明，最多缓存16项实体依赖闭包。重复查询复用同一闭包对象，变动后的范围仍重新查索引。没有跳过候选内部求解或资源验证。 |
| 几何与端口修复 | 命令前后真实旋转占地与图像边界合并后向外取整，组内候选与组外候选分列；关联对象不暗转为写集或强制解锁范围。网格单元坐标不安全时整Floor回退，扩张非有限拒绝，避免`2^53`附近循环；派生小数几何保持。连接from/to朝向均指向实际中心线外侧，直线与弯折同例通过。 |
| 工作区与数据保全 | 隔离fake-indexedDB经正常`Workspace.preview → adoptPreview → undo/redo → flush → repository.load`通过；预览不写库，取消、旧预览、锁和越界候选原子拒绝。冷读保留实际位置与持久组成员；基线报告不入工程/历史及玩家投影。首轮成功夹具坐标距外部物件300mm而未相交，修正到真实重叠范围后复验通过，没有放宽检查。 |
| 最终定向与构建 | `npm test -- src/shared/aggregates src/application/workspace/aggregate-boundary.test.ts src/application/workspace/aggregate-boundary-workspace.test.ts --maxWorkers=1`：11文件62项通过，日志`work/aggregate-boundary-tests.log`。`npm run check:shared`通过：218共享模块及Node原生ESM/既有烟测。最终`npm run build`通过前后端类型检查和正常生产构建，日志`work/aggregate-boundary-build.log`；既有依赖注释/包大小警告保留。文档本地文件链接与`git diff --check`通过，独立`todo.md`未变。 |
| 正常生产Chrome | 独立5198站点和隔离Chrome context，通过正常文件选择器打开完整工程；属性面板旋转先进入候选，显示附近/关联对象，取消保持r0；再采用到r1，撤销到r2及角度0，重做到r3，刷新后由首页最近工程重新打开，角度30保持，无pageerror。`SCENEWEAVE_BROWSER_CHANNEL=chrome SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5198/sceneweave/ npx playwright test tests/aggregate-boundary.spec.ts --project=chromium --workers=1`：1项通过，日志`work/aggregate-boundary-browser.log`；预览与冷开截图归同名`test-results/aggregate-boundary-*/`。这是两物件缩样，不证明真实用户工程、视觉质量或性能。 |

浏览器脚本前置失败分别来自Playwright直接解析Vite的`?raw`许可文本、未安装其默认Chromium，以及沿用旧测试的文件label/确认弹窗/自动重开假设。夹具改由Vite SSR加载，使用本机已安装Chrome；后续严格按当前文件选择器、直接打开和首页最近工程入口完成，不修改产品导入或自动重开行为。首个预览端口5186已占用，另用5198，没有停止既有服务。

以上为开发自检，不是完整容量、真实用户工程或正式视觉/性能验收；多实体/结构消费者、候选内部不变量复用与跨规模收益仍未完成。没有改变工程/数据库schema、算法/配方、固定素材、普通预算或AI权限，未提交、推送或部署。


### 多物件与建筑结构消费者接续（2026-11-06）

本接续在上述单物件冻结之后扩展，保留原记录；仍属c的开发自检，候选内部求解复用尚未完成。

| 范围 | 实现及本次证据 |
|---|---|
| 多目标候选 | `inspectAggregateEdit`按真实实体差异形成根，入口约束另取实际变化的开口；按既有持久组/Floor输出诊断，候选归属不授予访问或自动收编新实体。修改前后依赖闭包合并；next查询先移除全部失效旧行，再补实际候选包络，两个组同时移动到共同新位置仍互见，移走后无旧位置残留。同组不误报组外候选。 |
| 结构与附着 | 既有建筑命令及moveVertex/setWallThickness/reverseWall/splitWall预览接入同一入口。真实前后建筑依赖上下文补足正向附着，覆盖不变JSON的墙/房间/门窗几何、递归注记、新门窗、跨组重挂、拆合墙及只改入口约束。新墙/顶点不自动继承旧组；被删除引用仍保留原位置影响。 |
| 包络与回退 | `deriveAggregateEntityEnvelopes`按明确引用读记录和必要几何支撑，不重建完整索引，不认证场景；结果独立冻结。墙/门窗使用领域完整厚度和真实miter/bevel，斜角回归在旧半厚AABB以外实查命中；玩家先过滤隐藏邻墙，完整秘密房间不改变公开包络、player sourceHash或查询。vertex/note/prefab/scatter无独立包络，decoration仅锚点，显式列`unboundedTargets`并保守回退；不把缺失当空几何。 |
| 基线与完整校验 | 捕获检查器提供同一有界缓存的只读`affectedClosure`，旧图与候选图都用于确定涉及组。`baselineProofValid`仍只认证基线，未参与候选内部求解；GM诊断不入工程/历史/玩家输出。完整apply/materialize、资源、锁、预算、采用CAS及撤销语义不变。 |
| 定向自检 | 最终源码集合9文件56项通过：shared spatial/boundary/relations/proofs/building-edit与application aggregate-boundary/aggregate-boundary-workspace/aggregate-boundary-structure/building-edit-history，串行`--maxWorkers=1`。测试助手改为直接检查真实冻结报告后，受影响prop文件6项复验通过，不与56累加。正常`npm run build`及`npm run check:shared`通过，后者218模块；构建仍有既有chunk/重复静态动态导入警告。日志：`work/aggregate-multi-{tests,prop-tests,build,shared}.log`。 |
| 正常生产入口 | 正常build、独立5198 preview、本机Chrome串行`tests/aggregate-boundary.spec.ts`，1项通过（9.7s）。真实导入后物件旋转及建筑墙厚均预览→取消不改revision→采用→撤销/重做→自动保存→刷新/首页重开回读；墙厚保持30cm。截图归`test-results/aggregate-boundary-grouped-9b314-diagnostics-before-adoption-chromium/`，日志`work/aggregate-multi-browser.log`；测试后停止本次preview。 |

首轮夹具问题保留：测试助手复制报告后检查冻结属性产生假失败，改为直接检查真实报告；人工增加第二Floor被当前严格单Floor合同拒绝，移除越界测试而不放宽产品校验。定向terrain-edge夹具最初覆盖了原物件的支撑区域，改放无冲突区域后通过。新斜角测试收紧到旧半厚AABB外，防止弱断言假通过；这些修正没有降低完整验证。

本次未建立跨规模收益，没有修改工程/数据库schema、生成重放、固定素材或AI权限，未提交、推送或部署。下一执行点归07：c的受约束候选内部求解复用；完整验收和性能仍归09。

### 受约束候选内部几何复用接续（2026-11-06）

本接续保留上述两次冻结记录，完成c的有限候选复用路径。范围只含既有持久归组、且未被Prefab/scatter/decorationCluster任何成员记录引用的独立prop位置/角度修改；结构与其他变更继续完整几何。当前状态与下一步归[07](../07-roadmap.md#t2-implementation)，合同归[04](../04-scene-document.md#aggregate-coordinate-contract)及[设计3.8.4](../reference/general-map-generation.md#aggregate-spatial-capacity)，正式覆盖矩阵仍归09。

| 范围 | 实现及本次证据 |
|---|---|
| 私有基线与完整差异守卫 | `validateSceneDerivationSnapshot`只信任自身私有WeakMap内确切、独立严格解析并深冻结的场景；候选再次完整JSON检查和严格解析。全字段、键集合及记录顺序比较自动覆盖新增字段；非位置/角度变化、成员/容器/资源/锁/秘密/约束/元数据变化均回退全几何。克隆、调用方冻结及公开校验所得对象不继承凭证；访问器拒绝且getter不执行。 |
| 几何与其他域 | 复用未变非物件及未变物件的已证几何，变化物件仍检查真实旋转占地/offset、显示边界、Floor及有效支撑，并与全部高差连接的真实曲线带区复检阻挡；错误顺序与warnings同完整校验逐结果比较。其他域、身份/外观/回执及原资源字节/像素/许可验证保持。公开validate、冷读、保存及包边界继续全验。 |
| 实际命令消费者 | 仅全为`updateProp`的内部snapshot及完整外观草稿采用此路径，正常单/多物件Workspace候选直接持有新签发证据；测试检查实际`preview.document`，采用/撤销/重做/flush/冷读保全。`SceneDerivationEvidence`只绑定确切候选对象，不能提交为凭证，不进入工程、历史或玩家输出；`baselineProofValid`仍只说明原基线，不与候选认证混同。锁、预算、玩家投影及采用CAS继续原流程。 |
| 最终定向 | `npm test -- src/shared/validation/scene-derivation.test.ts src/shared/geometry/prop-move-derivation.test.ts src/shared/geometry/connection-route.test.ts src/shared/aggregates/contracts.test.ts src/application/workspace/aggregate-boundary-workspace.test.ts src/application/workspace/aggregate-boundary-structure.test.ts src/application/workspace/prepare.test.ts src/application/workspace/manual-budget.test.ts src/shared/commands-equivalence.test.ts src/core/v6/schema-certification.test.ts src/io/v6/resource-certification.test.ts src/shared/project-resources.test.ts --maxWorkers=1`：12文件105项通过，48.74s，日志`work/aggregate-reuse-tests.log`。覆盖完整求解调用守卫、伪基线、容器回退、支撑/旋转/越界及曲线连接；不是正式性能测量。 |
| 类型、共享边界与构建 | `npm run typecheck`通过；`npm run check:shared`通过，218个共享源码模块及原生Node ESM/既有烟测通过。当前源码`npm run build`通过前后端类型检查和正常生产构建，保留既有依赖注释、静态/动态导入及chunk大小警告。日志为`work/aggregate-reuse-{typecheck,shared,build}.log`。 |
| 正常生产Chrome | 新正常构建、独立5198 preview和隔离本机Chrome串行执行`tests/aggregate-boundary.spec.ts`：1项通过，操作用时23.4s。正常导入后，归组物件旋转和建筑墙厚均完成预览/取消/采用/撤销/重做/自动保存/刷新后从首页冷开，实际角度30°与墙厚30cm保持，无pageerror。日志`work/aggregate-reuse-browser.log`，截图归`test-results/aggregate-boundary-grouped-9b314-diagnostics-before-adoption-chromium/`；结构仍是完整几何回退路径。 |

构建首轮曾报告并行工作台填充复制说明中的可空`project`类型错误；复核时当前源码已使用`structure.document`，本轮未改写该UX文件，复跑当前源码构建通过。文档本地文件链接及`git diff --check`通过，独立`todo.md`SHA256保持`15adcd89e490a92516316d35a6a3cbc260b0ae7851a93b7ea579750b532067b9`。

本次仅完成c有限支持范围的实现及必要开发自检，完整差异比较和其他域扫描仍随总内容增长，未建立跨规模收益或稳定提速。整体建筑空间变换及其复用条件留d，分区加载/保存与分档修整仍按07接续；正式容量、真实用户工程、视觉/P3与性能均留09。工程/数据库schema、生成重放、固定素材、AI权限保持，未提交、推送或部署。


<a id="manual-transaction-budget-20261105"></a>
## 普通事务预算开发自检（2026-11-05，原T5）

当前工作台普通手工显式采用固定manual策略，将256独立编辑对象与几何、工作、依赖、变化元数据及完整资源闭包分开。合同与数值只在[04](../04-scene-document.md#manual-transaction-budget)，开发状态与下一步只在[07](../07-roadmap.md#ordinary-transaction-budget)维护。原始命令/选择256、纯素材入库256新增记录、完整工程v1和完整数据校验保持；未选择manual的共享入口、注册TaskBudgetProfile及生成/AI账本和重放不改价。

普通命令、层/外观、填充复制、联合素材布景、受支持局部恢复接入同一计量。房间/墙/附着开口的真实坐标/墙厚影响、实际成员及层→实例后的有效外观进入语义集合；内部顶点、同步容器、固定源/身份记录不重复记为用户编辑。准备逐步核对完整中间内容，并累计重复几何及执行器已有观测；物化、注册预览和采用前再从真实基线检查最终候选。界面保护详情默认折叠，仅会话可见。

| 必要自检 | 实际结果与证据范围 |
|---|---|
| 共享计量与命令 | 200点地形、复杂物化边可在显式manual下通过；无策略共享入口仍按旧256拒绝。共享顶点实际改变的房间/两墙计3，内部顶点不重复计；物化边有独立目标。256成员层移动去除容器重复且保留锁；257成员中实例覆盖遮蔽256项时，层规则实际只改变1项，不按scope长度提前误拒绝。 |
| 填充与历史 | 两成员组合复制两份计4，100份预检计200，129份实际258仍拒绝，257份搜索仍拒绝。长道路局部恢复计1并保留锁/范围外对象；层恢复实际257对象拒绝，建筑恢复仍要求完整依赖确认和本会话连续性证明。 |
| 工作区与真实小资源 | fake-indexeddb隔离库与实际1px PNG字节/解码适配器；200点道路预览不写内存/持久库，采用后revision+1、撤销/重做、独立load完整几何一致。同一对象21次200点修改因累计geometryPoints超限整笔拒绝，当前及持久成果保持；取消/过期预览不能安装。此处不是实际浏览器Canvas或正式容量证据。 |
| 维度及兼容 | 对象/几何/资源独立超限，伪造manual数值拒绝；未变元数据本次增量为0，修改/删除记录及键字节进入独立量；旧TaskProfile调用返回原measureTaskBudget结果。原AI原子、普通工作区及地形显式profile路径定向回归通过。 |
| 定向与构建 | `npm test -- src/shared/budget/command-budget.test.ts src/shared/commands/command-budget-commands.test.ts src/shared/history/manual-budget.test.ts src/application/workspace/fill-copy-manual.test.ts src/application/workspace/manual-budget.test.ts src/application/workspace/curved-connections.test.ts src/editor/main/command-budget-details.test.ts src/application/workspace/workspace.test.ts src/application/workspace/atomic.test.ts src/application/workspace/terrain-profiled-local.test.ts --maxWorkers=1 --testTimeout=30000`：10文件74项通过，47.92秒。随后收窄旧策略兼容时，对`command-budget-commands`、`atomic`、`terrain-profiled-local`按同样串行/30秒参数复验，3文件30项通过，32.74秒；两轮不合并为新测试总数。修正后的`npm run build`前后端类型及正常生产构建通过；既有依赖注解/混合导入/chunk大小提示保留。`npm run check:shared`：206源码模块无DOM编译、Node ESM/既有命令/身份/投影/无图片包及备份烟测通过。 |

早期定向自检中，新增夹具的当前format/外观前置条件和旧基线错误文案断言曾导致失败，已修正并包含在上述最终复验中；没有以跳过严格校验使测试通过。收尾核对把资源保护对齐既有完整工程300MiB/6400万像素，避免小编辑因已保留资源被更小任务档位误拒绝；元数据只计实际变化，补齐可选空分支和键字节，最终74项与构建均在这些修正后执行。

兼容复核另补“旧TaskProfile下复杂物化边仍按原局部256拒绝”的断言，初次5项中1项失败，证明新增预算向下传递时放宽了旧视觉保护。已将新接入的视觉、装饰、地表规则和层分支改为仅manual绕过原混合局部保护；旧TaskProfile保留原入口准入与最终任务计量，补同类图层断言。修复后上述3文件30项及正常构建、共享边界全部通过。413条相关本地文档链接/锚点及`git diff --check`通过；`todo.md`的SHA-256仍为`15adcd89e490a92516316d35a6a3cbc260b0ae7851a93b7ea579750b532067b9`。

本项没有运行浏览器/正式性能/全量回归，不代表更高容量、稳定提速或完整验收。完整各维±1、保存故障/恢复/受众像素/完整包与跨端矩阵留[09](../09-quality-plan.md#acceptance)。未提交、推送或部署；共享工作区其他功能/UX编辑和独立`todo.md`保留。

<a id="e-mixed-generation-20261105"></a>
## E有限混合与完整交付开发自检（2026-11-05）

范围对应[07的E](../07-roadmap.md#general-map-generation-priority)和[设计11.8](../reference/general-map-generation.md#e-mixed-delivery)：同一完整v1中组合一个建筑与森林或火山；使用可编辑参数调用领域算法，未复制样板几何。`supported-interior@1`绑定真实地形高程与完整足迹，`mixed-layout@1`连接真实外门、全宽室外路线及实际穿门转角，再生成避让植被或复核原火山道路/连接。独立模块保留自己的配方/归属/人工记录；组合不接管子配方，D6不提供整图或任意建筑拓扑重建。旧室内算法2精确结果和原自然算法路径保持；AI工具仍为空。

公共direct/Worker/显式HTTP及主机完整资源准备、私有候选见证、采用前本机重放、独立保存和冷读后切换继续复用。室内素材建立独立`mixed-interior-v1`固定副本及目录，按原许可全文hash隔离引用，保留原署名/快照ID及实际图片/SVG字节；不修改旧定义或将同名MIT的不同正文混为一份。混合结果持久化完整实体、身份、配方与实际成员；手工删除、关闭门或修改建议不自动补回。

| 必要自检 | 本轮证据与范围 |
|---|---|
| 共享、Worker与应用定向 | `work/e-focused-verified.log`：12文件60/60。覆盖森林/火山真实混合支撑、门端口/整段净宽、旧室内固定hash、受支持建筑/跨模块依赖、局部冲突；协议/Worker同源及完整资源预览、伪造见证拒绝、取消/旧基线/冷读失败保全、独立原工程保全、完整包往返、人工删除保留、保护采用和等待save后一次撤销/重做。使用隔离fake-indexeddb及真实小PNG，不读取用户库。 |
| 程序化服务 | `work/e-service-final.log`：14/14，四领域全响应同源与原认证/Origin/能力/限额/中止等受影响路径；真实Hono路由，不代表已部署HTTP或真实模型。 |
| 素材许可修复定向 | `work/e-palette-regression.log`：2文件4/4。新固定副本全部引用和许可闭包合法、确切许可/原定义/占地保持，森林/火山混合及拒绝路径复验。元数据用例不冒充真实图片验证，实际来源字节/像素由生产主流程检查。 |
| 类型、正常构建与共享边界 | `work/e-typecheck-final.log`、`work/e-build.log`先行通过；许可修复后的固定副本`work/e-production-source/`再次正常`npm run build`通过，最终日志`work/e-production-build-final.log`包含前端/服务类型与真实Worker产物；仅补齐混合面板既有样式类，不新建表现系统。既有依赖注解、混合导入和大chunk警告保留。`work/e-shared-final.log`：205个共享源码模块无DOM编译及Node ESM/既有命令/身份/投影/无图片包烟测通过；最后两次构建没有修改shared生产源码，不重复扩跑。 |
| 隔离生产浏览器 | `work/e-production-browser-verified.log`先行1/1。最终正常dist及`tests/mixed-generation.spec.ts`按独立上下文拆分后，`work/e-production-browser-isolated.log`为2/2：纯UI新建原工程→默认真实Worker林中两房候选→改参失效→独立保存→子配方选择/林区密度→保护采用→一次撤销/重做→首页冷开并保留原工程；另一隔离工程预览火山平台建筑，等待真实Canvas可见，再取消并确认原工程保持。pageerrors与generation/tasks HTTP请求均为0；没有DEV hook/存储注入，不读取用户库。截图已查看，只作真实绘制/结构证据，不作视觉/P3或性能结论。 |

首轮默认平台范围切到原下降连接的完整带区，已修正参数模板；已有连接事实的source/candidate前缀导致建筑bounds误判，改为仅在新supported分支核查真实新增完整事实，补保留原楼梯回归，不改旧室内hash。静态复核修复穿门转角分段检查、子模块重复候选基数与接入规则遗漏实际房间/墙门业务依赖。初次工作区用例受并行争用超时，并发现fixture过密、未等待局部save及不支持的私密修改假设；减少夹具饱和、串行运行、明确等待save，私密房间无合法玩家遮罩时断言安全拒绝且当前hash不变，最终60项通过。失败日志`work/e-mixed-tests.log`、`work/e-mixed-workspace.log`、`work/e-focused-final.log`及对应复验保留，不将首轮当作成功。

生产首轮`work/e-browser.log`因缺少Playwright Chromium可执行文件未启动；停止下载后使用已安装系统Chrome。`work/e-browser-chrome.log`实际暴露室内/室外同名MIT绑定不同正文的合并冲突，修复为上述独立固定副本，严格许可校验保留。`work/e-production-browser.log`发现并行界面改动把局部参数事件误标为室外草稿而锁死；当前工作区已有收窄事件范围的修复，同步该处到固定副本后`e-production-browser-verified.log`通过。补图首轮`e-production-browser-rendered.log`在火山完整资源准备仍进行时达到45秒断言时限，没有候选错误；下一轮`e-production-browser-final.log`在局部采用30秒等待到期时失败，失败截图已显示采用及保存完成。`e-production-browser-complete.log`在已有森林工程中准备火山达到90秒时仍未完成；trace显示大量重复真实图片校验，未关闭校验或宣称性能正常。将林中完整交付和火山混合预览按场景拆为独立浏览器上下文，所有功能断言保留，最终2/2通过；已有较大工程下资源准备耗时留统一性能矩阵。测试等待与产品执行预算分开，不扩大后者。

已查看最终`work/e-production-browser-isolated/`下的`forest-building-cold-open.png`和`volcano-building-preview.png`，均为实际渲染完成的画面。`work/e-doc-links.json`记录12份相关文档的759条本地文件/锚点检查，无失效；`git diff --check`通过。实际源码/产物与当前工作区差异归`work/e-production-source-fingerprint.json`，E相关文件及独立任务残余归`work/e-final-scope-fingerprint.json`；当前共享工作区后续变化不外推为该冻结已测。

为避免同目录另一任务的持续UI编辑改变构建输入，最终生产检查使用固定源码副本，指纹见`work/e-production-source-fingerprint.json`；副本包含捕获时的界面改动，本节仅评价E路径，不给并行任务签收。冗余的共享目录类型检查已中止，由修复后正常构建覆盖，不计为通过。`todo.md`保持初始SHA-256 `15adcd89e490a92516316d35a6a3cbc260b0ae7851a93b7ea579750b532067b9`；HEAD期间由另一任务从`231cd05`变为`0369704`，不是本轮提交。

本轮没有提交、推送、部署或读取真实用户库。全部混合种子/故障/跨浏览器/完整受众像素、真实AI、视觉/P3、正式性能及VTT仍从[09](../09-quality-plan.md#d-domain-acceptance)统一验收；开发下一项只在07维护。

<a id="d7-generation-execution-20261105"></a>
## D7统一入口与领域执行端开发自检（2026-11-05）

范围对应[07的D7](../07-roadmap.md#d-domain-implementation)，精确协议、权限与存储归[04](../04-scene-document.md#domain-generation-protocol)、[05](../05-ai-and-generation.md#domain-generation-authority)和[06](../06-storage-and-export.md#domain-generation-storage)，模块交接归[设计11.7](../reference/general-map-generation.md#d-delivery)。仅开发必要自检，没有执行E、提交、推送、部署或读取真实用户库。

共享领域注册表/严格请求与结果绑定interior@2、forest@1、volcano@1、规范输入、完整候选基底、profile与请求/工作区/基线/代次；计时与确定性hash分开。Worker和认证HTTP直接运行相同函数，公共主机准备完整资源/许可/像素、身份与固定表现；UI默认Worker，服务端显式协商并选择，无回退/自动重发。公共新建/当前目标进入各自原私有凭据、采用前本机重放、新建保存冷读或保护/CAS/一次撤销链。D6只声明direct，aiTools为空；旧AI能力响应、自然底图及算法6领域重放保持。

| 必要自检 | 本轮证据与范围 |
|---|---|
| 共享协议 | `work/d7-protocol-tests.log`：9/9；三个领域与原runner的文档/报告/产物/阶段/resultHash一致，规范化、严格字段/版本/输入/profile/hash/上下文、getter不读取、字节/取消与能力表；计时变化不改语义hash。 |
| Worker/client | 实际工具完成记录session5587/chunk bf747d：13/13；三领域同源Worker、上下文/篡改拒绝、取消/超时/替换/dispose清理、显式server能力协商、流式限额/中止/无重试。该组未持久化独立日志文件，不捏造附件。 |
| 程序化服务与旧入口 | 工具完成记录session99251：`generation.test.ts`13/13，三个领域全响应（固定执行时钟）一致、认证/Origin/精确能力、严格协议、实际UTF8/声明与流字节、预占并发/abort/期限/结果限额及slot释放。session58354：旧认证/严格cached-client能力/原base-map入口定向3/3；该两组无独立日志附件。使用Hono Request/Response真实路由和受控provider，不冒充已部署HTTP或真实模型。 |
| 应用完整链 | `work/d7/application-tests.log`：5文件17/17；三个领域完整资源、预览/保存/冷读和失败保全，公共executor预览后仅本机重放采用，自洽重算hash的假结果在save前拒绝，迟到结果保留新修改；D6保护/CAS/一次撤销与原v6重放仍过。 |
| 类型/正常构建与共享边界 | `work/d7/build.log`：前端/AI TypeScript及正常Vite构建通过，包含真实新增Worker产物；既有依赖注解与大chunk警告保留。`work/d7/shared.log`：201个共享模块无DOM编译及Node ESM/既有命令/身份/投影/无图片工程和历史包/保全集烟测通过；不作性能或真实图片验收结论。 |
| 隔离生产Chromium | `work/d7/browser.log`：正常dist独立preview，`tests/local-generation.spec.ts`1/1。纯UI新建→默认Worker火山候选（实际Worker事件）→独立保存→火口改参失效→保护采用→一次撤销/重做→首页冷开保留实际轮廓；pageerrors0、generation/tasks HTTP请求0。没有DEV导入、应用hook或存储注入，未使用用户库；只覆盖本机主流程，不宣称浏览器远端模式或跨浏览器已验收。 |

首轮`work/d7/typecheck.log`暴露服务测试替身的泛型返回约束与公共局部采用返回类型丢失；服务注入seam改为其实际消费的精确联合，公共采用增加目标重载，未使用any放宽协议。服务13/13复验及最终正常构建通过。静态复核同时固定了主机跨await前的context捕获；应用定向覆盖真实采用重放和迟到保全。

已查看`work/d7/browser/local-generation-local-cra-97f86-ndoes-redoes-and-cold-opens-chromium/local-crater-cold-open.png`，仅作生成/冷读结构证据，不签收视觉。源码指纹与文档链接结果分别归`work/d7/source-fingerprint.json`和`work/d7/doc-links.json`；临时preview已停止，既有脏工作区及本轮起点的独立todo保持。跨种子/完整故障/浏览器/混合、真实AI、视觉/P3、性能与VTT仍从[09](../09-quality-plan.md#d-domain-acceptance)统一验收，下一实施点只在07维护。

<a id="d6-local-generation-20261105"></a>
## D6归属与受限局部重生成开发自检（2026-11-05）

范围对应[07的D6](../07-roadmap.md#d-domain-implementation)，四类操作与有限边界归[设计11.6](../reference/general-map-generation.md#d-regeneration)，持久归属及候选事务分别归[04](../04-scene-document.md#generation-staging)和[06](../06-storage-and-export.md#local-generation-storage)。本轮只有开发必要自检，未读取真实用户库或调用模型，没有提交、推送或部署，D7/E未提前实施。

**实现**：共享`runLocalGeneration`直接从当前完整v1计算选定房间家具、林区单通道密度/成员、火山底材及火口同拓扑轮廓，不重新生成整图。复用当前规则/ownership、真实身份与原生命令，授权字段只从此前仍受管字段认领；旧manual/deleted/detached不清零。家具保留存活ID及位置之外字段，未出生建议分配fresh ID和稳定槽位键；林区槽位保留移动/删除/锁/退出/附注成员。火山材质保持物理/Region策略，已有人工外观覆盖拒绝；火口保留点/段与连接端点/支撑引用，同轮廓受管Region只随动几何，支撑/流道/完整路线冲突拒绝。原配方保存首次输入，当前规则/实体保存实际局部结果，旧自然投影及v6领域hash不改。

应用接口`previewLocalGeneration / cancelLocalGeneration / adoptLocalGeneration`准备完整身份/固定源/资源/许可/像素，私有凭据绑定真实当前工程并精确重放；展示完整持久写集与只读依赖，按完整before/after计普通256。保护/CAS后一次提交、撤销/重做与保存沿现有链；取消、旧基线、伪造候选和保护失败不提交，最终保存失败保留当前未保存结果与可用撤销。工程面板接入参数失效、取消/Escape、互斥、候选画布及保存消息。

| 必要自检 | 本轮证据与范围 |
|---|---|
| 定向集成 | `work/d6-targeted-final.log`：7文件22/22。家具4例验证同ID位置变化/范围外保留、人工移动删除锁和外观保护、fresh身份/稳定槽位/完整成本、闭门删门不恢复；森林2例验证成员保全/单通道修改、规则手改及取消拒绝并检查完整成本；火山3例验证同拓扑/真实连接道路/身份、材质与人工策略独立、结构依赖/锁/手改/拓扑拒绝；应用5例覆盖完整重放/字节解码、保护采用/撤销重做/冷读及改变拓扑后撤销仍拒绝几何重生成、旧基线/伪造/取消/CAS、最终保存失败保全，以及expanded档下真实外观元数据超256拒绝。原室内布局4例、默认建议与等价hooks3例及原v6重放1例一并通过。 |
| 共享边界 | `work/d6-check-shared-first.log`：200个源码模块无DOM编译、Node原生ESM及既有命令/身份/投影/无图片包烟测通过；不代替真实图片适配器验收。 |
| 正常构建 | `work/d6-build-final.log`：前端/AI TypeScript及正常Vite生产构建通过；保留既有依赖注解与大chunk警告，不作性能结论。 |
| 生产Chromium纯UI | `work/d6-browser-final.log`：正常dist独立preview，`tests/local-generation.spec.ts`1/1。新建→火山完整保存→火口右扩0.5m预览→改参使旧候选失效→重预览→保护采用→一次撤销/重做→首页冷开读取真实轮廓；页面错误0，无DEV源码导入、应用hook或存储注入。 |

**首次失败与修复**：共享森林夹具曾将编辑锁与内容混在同事务，火山锁夹具曾用不存在的命令，均改用合法独立原生锁事务；家具symbol夹具不支持tint，改用受支持opacity后验证人工外观保护。首轮构建只发现测试只读候选类型，克隆后显式按实际可变基底类型传递，正常构建复验通过。新增预算反例最初误以为64点轮廓会超过256，真实成本76并正常允许；改用80个真实表面覆盖的完整固定源反例，不改计价实现。该新夹具先后被真实生成hash、覆盖出生身份和源一致性校验拒绝，最终在首次保存前按完整工厂规范构造，再验证超256确切拒绝；失败日志`work/d6-domain-first.log`、`work/d6-interior-first.log`、`work/d6-build-first.log`、`work/d6-targeted-first.log`与`work/d6-application-second/third/fourth.log`保留，末次应用复验`work/d6-application-fifth.log`5/5。

已查看`work/d6-browser-final/local-generation-local-cra-97f86-ndoes-redoes-and-cold-opens-chromium/local-crater-cold-open.png`，仅作结构/保存开发证据，不签收火山视觉。完整故障/跨种子/跨浏览器、混合场景、统一Worker/服务端与AI能力、正式性能、视觉/P3及VTT仍归[09](../09-quality-plan.md#d-domain-acceptance)。源码指纹归`work/d6-source-fingerprint.json`，文档链接核对归`work/d6-doc-links.json`（17份文档947个本地链接/锚点，无错误），`git diff --check`通过；既有脏工作区与独立`todo.md`保持，下一执行点只在07维护。

<a id="d5-volcano-20261105"></a>
## D5火山结构与独立危险策略开发自检（2026-11-05）

范围对应[07的D5](../07-roadmap.md#d-domain-implementation)，实现与有限输入归[设计11.5](../reference/general-map-generation.md#d-volcano)，持久数据与候选保存归[04](../04-scene-document.md#generation-staging)和[06](../06-storage-and-export.md#volcano-generation-storage)。本轮仅开发必要自检，隔离夹具与浏览器不读取真实用户库，没有提交、推送或部署；D6/D7未提前实施。

**实现**：独立`volcano-layout@1`通过结构→连接两个共同编排阶段，参数直接物化真实山体、低火口、同高程平台及火口内流道，真实cliff来源段、stairs/ramp和两条全宽Path；完整净宽/转角、两端接入、实际支撑与显式阻挡均检查。流道的有限控制线带区规范到整数毫米，必须严格留在火口同高程表面；跨高差流道明确拒绝。危险、阻挡及移动代价分别写Region，四种既有固定火山材质只决定外观，不复制样板几何或新增素材。逐实际产出记录有限规则与人工/删除归属，地形使用现有出生/拓扑身份；完整工程仍唯一v1，旧自然投影及算法6保留。

工程面板参数化火口尺寸/位置/高程、路线宽度和连接类型、火口内流道宽度/冷热材质，以及独立火口/流道策略。候选完整资源与许可校验、私有见证、按真实身份序列重放、先保存原工程、独立新工程保存及冷读后切换全部沿原有链。软入口/活动区/路线记录不强迫用户后续保留；危险人工编辑/删除正常保存，不在冷开补回。新增火山入口事实在发布前复核完整宽度的当前支撑，手改后已失效的端口被省略，合法草稿仍可保存。

| 必要自检 | 本轮证据与范围 |
|---|---|
| 定向集成 | `work/d5-targeted-verified.log`：4文件9/9。共享火山4例覆盖确定性/源不变、低于基底的真实火口/足宽连接/平台、真实火口与流道参数变化、材质单变物理保持、显式阻挡/第三支撑/取消/高程矛盾拒绝、人工区域编辑删除及失效端口省略；workspace2例覆盖私有预览、完整重放/独立保存冷读/完整包、危险策略撤销重做及取消/旧基线/保存/冷读失败保护；工厂2例仅核对固定元数据闭包/取消（mock明确，不充当真实字节/像素证据）；原v6严格领域投影固定hash1例保持。 |
| 共享边界 | `work/d5-check-shared-verified.log`：195个模块无DOM编译、Node原生ESM及既有场景/身份/投影/无图片包烟测通过；不代表真实图片适配器验收。 |
| 正常构建 | `work/d5-build-verified.log`：最终前端与AI服务TypeScript、正常Vite生产构建通过；保留既有依赖注解及大chunk警告，不作性能结论。 |
| 生产Chromium纯UI | `work/d5-browser-verified.log`：正常dist、独立Vite preview，`tests/volcano-generation.spec.ts`1/1（用例6.8秒，总8.1秒）。新建原工程→默认火山预览→改火口高度比例/流道宽与冷热材质使旧候选失效→重新预览→完整保存独立工程→首页冷载确认原工程保留→打开新工程读取实际0.5m火口及两处stairs，页面错误0。没有DEV源码导入、应用hook或存储注入。 |

**修复与限制**：复查发现软入口在手改支撑后可能仍发布过时事实，现已增加当前完整宽度支撑过滤，并在共享用例中真实删除道路/收缩地面验证合法草稿不再发入口事实；未顺带重写旧森林分支。关闭流道后不再校验停用流道的宽度/代价。新增共享测试首次正常构建出现固定JSON字面类型及只读候选传给可变几何接口的类型错误，已改用严格元数据解析和只读字段读取；失败日志保留`work/d5-build-types-failed.log`。没有以测试通过扩大任意多边形路由或视觉质量承诺。

正式多种子/形态多样性、跨领域及Worker/服务端、完整故障/跨浏览器/性能、真实模型、视觉/P3与VTT真实导入仍归[09](../09-quality-plan.md#d-domain-acceptance)。必要自检不关闭正式验收。实际预览/冷开截图归`work/d5-browser-verified/volcano-generation-volcano-3bde0-d-saves-a-cold-open-project-chromium/`，已查看冷开截图，仅作结构/保存开发证据。源码及文档指纹归`work/d5-source-fingerprint.json`；链接/锚点核对归`work/d5-doc-links.json`，既有脏工作区与独立`todo.md`保持。

<a id="d4-forest-20261105"></a>
## D4森林空地、路线与真实植被开发自检（2026-11-05）

范围对应[07的D4](../07-roadmap.md#d-domain-implementation)，算法/API/有限支持归[设计11.4](../reference/general-map-generation.md#d-forest)，完整归属与保存分别归[04](../04-scene-document.md#generation-staging)和[06](../06-storage-and-export.md#forest-generation-storage)。本轮只做开发必要自检，没有使用真实用户库或模型，没有提交、推送或部署；正式验收未开始。

**实现**：独立`forest-layout@1`消费严格林区/空地/入口/显式折点路线与固定三通道palette，复用D1阶段私有物化和既有几何/植被系统。地面→路线→内容三个算子依次发布真实支撑/计划区、入口/完整道路带、实际植被；空地/入口为soft首次保留。Path不是通行图片，指定全宽路线被阻挡或缺合法高差连接时拒绝。SurfaceRule/DecorationCluster保存完整树Prop、轻量草灌Decoration及真实槽位，完整足迹与支撑、精确固定根锚绘制和原生图像边界检查均保留；目标超过保护上限拒绝，有限空间落不满列实际缺项。没有从材质标签猜种植区，没有使用会清空旧成员的自动岩岛流程。

共享API支持新平地或显式已有合法地形，重叠同支撑同通道、覆盖旧规则或重复配方明确拒绝。首个UI提供32×24m默认图、1–4处矩形空地、四侧入口/路线宽度及树灌草覆盖目标；正常候选资源/许可/像素、固定表现/身份、私有重放、原当前工程保全、独立保存与冷读后切换均沿现有链。完整工程仍唯一v1，旧自然算法入口及hash投影不变；局部更新/统一执行端接线分别留D6/D7，不提前扩大AI能力。

每个实际输出独立有限forest规则，共享精确持久配方。移动/删除只改变受影响的规则/成员归属，普通256上限保持；较密共享夹具的普通单树移动成本17、独立删除成本27，同事务移动＋删除也通过。手工移动槽为manual，删除槽为deleted且entityId=null，后续原生植被重生成助手不复活这些槽；已有passed约束回执在新增内容后转unchecked，原基底仍保留passed及原约束。

| 必要自检 | 本轮证据与范围 |
|---|---|
| 定向集成 | `work/d4-targeted-verified.log`：5文件22/22，覆盖森林5例、workspace完整候选2例、持久integrity7例、原自然适配2例与共用space6例。包含两种空地/入口真实变化、完整道路/占地/支撑、已有地面/阻挡/缺高差连接、默认UI真实请求、普通成员移动删除/有限密度/取消及源不变；workspace含预览不写入、私有凭据/旧基线、完整重放/独立保存冷读/完整包、删除撤销重做及保存/冷读失败保全。 |
| 共享边界 | `work/d4-check-shared-verified.log`：193个模块无DOM编译、Node原生ESM、既有场景命令/身份/投影及无图片包/存储烟测通过；不代表真实图片适配器验收。 |
| 正常构建 | `work/d4-build-verified.log`：最终生产代码的前端与AI服务TypeScript、正常Vite构建通过；保留既有依赖注解/大chunk警告，不作性能结论。 |
| 生产Chromium纯UI | `work/d4-browser-verified.log`：正常dist由Vite preview提供，`tests/forest-generation.spec.ts`1/1（56.3秒）。隔离临时浏览器新建原工程→森林候选→修改空地与入口使旧候选失效→重建→完整保存独立工程→页面冷开→对象面板删除真实树→保存/再次冷开按完整ID确认未复活，页面错误为0。没有DEV源码导入、存储注入或用户库读取。 |

截图保留在`work/d4-browser-verified/forest-generation-forest-s-045ba--keep-a-deleted-tree-absent-chromium/`的`forest-preview.png`、`forest-cold-open.png`和`forest-deleted-cold-open.png`。预览截图记录默认候选1条道路、树目标30/实际28、灌木7/7、草簇1/1；这是该输入与本轮快照的实际结果，不是通用覆盖或视觉签收。源码/文档指纹在`work/d4-source-fingerprint.json`，仅为未提交工作区快照。

**失败与修复**：初轮类型检查发现supportRef未先收窄和新引用未覆盖的refKey，已修复；后续构建新增测试的只读候选传给可变旧视图接口，改用独立clone后通过。`d4-targeted-initial.log`的路线支撑输入漏绑、`d4-targeted-second.log`的端口缺少真实已存事实均被编排器拒绝，现已补齐并通过最终集成。`d4-forest-third.log`的高台夹具共边未分段改为合法内嵌高台，仍保留真实高差拒绝；同轮移动/删除超过256的生产根因为单rule引用整林，改为逐输出规则，未提上限或拆批。首轮浏览器`d4-browser-final.log`失败发生在候选阶段：完整路线合法，但两棵树的原生图像越过Floor下边，触发路线核内的场景几何校验；补充森林候选图像边界过滤并如实列缺项，默认参数回归及最终生产浏览器通过。早期通过日志与这些失败均保留，不拼成另一轮完整结果。

本轮未执行全量单元/AI、跨种子/跨浏览器/完整故障矩阵、正式容量/性能、真实模型、混合场景、视觉/P3或目标VTT导入；统一从[09](../09-quality-plan.md#d-domain-acceptance)验收。26份文档1665个本地链接/锚点与`git diff --check`通过。既有脏工作区及独立`todo.md`保留，后者SHA-256仍为`c8952e9305b9e9d0b9f172589f947929bfacf8da8f11264904726aecf55dd9d8`。下一执行点只在07维护。

<a id="d3-interior-suggestions-20261105"></a>
## D3初次门路与用途家具建议开发自检（2026-11-05）

范围对应[07的D3](../07-roadmap.md#d-domain-implementation)，算法及有限支持边界归[设计11.3](../reference/general-map-generation.md#d-interior)，完整数据与保存合同分别归[04](../04-scene-document.md#generation-staging)和[06](../06-storage-and-export.md#interior-generation-storage)。按用户本轮补充，门、入口、通路和用途家具只作为初次生成建议：依据用途、净面积、实际墙段/支撑/占地尽量安排，放不下或缺建议角色素材则说明原因，合法布局仍可采用；之后用户移动、关闭或删除不自动补回，不落永久必达/必需家具约束。

**实现**：室内算法/配方2复用D1的结构→连接→内容三阶段，工程仍为唯一完整v1。真实共墙/外墙经原生`addOpening`建立附墙门；指定房间中心/门锚点只尝试三类有限路线，用完整带区、转角、真实墙厚/门状态及旋转家具检查净宽，并约束在实际相邻房间及明确入口短预留带内。路线为只读建议证据，不创建可见室内Path，不写`constraints.pathChecks/entranceOpeningIds`或房间必达状态。clear只证明指定端点和当前几何，不承诺任意全局寻路；例如外墙紧贴Floor边界时，外部引道缺支撑会如实列缺项。

家具按用途与净面积选择有限角色和数量，使用显式授权的固定定义/版本、原物理尺寸及真实房间支撑；检查墙、其他家具间距、门口保留区，并复核每条原已通过的全宽路线。当前仅0°候选，最多6件/房间、64件/整图；小于4平方米或走廊不建议家具。缺角色/放不下不冒充已布置；显式错误资源、非法几何、取消和预算失败仍拒绝完整候选。房间、墙门和家具的完整实体、参数/固定palette、实际归属/出生及人工/删除记录保存；重放比较含建议报告的完整resultHash，冷读不重新生成。

工程面板提供自动房间门/对外入口/用途家具三个开关、建议门宽/净宽，以及实际门/家具数、净空通过比例和缺项说明。固定家具来自现有原创室内素材，资源/许可准备、当前工程保护、新工程独立保存与冷读全验继续复用原链路；没有扩大AI权限或提前接入D7的Worker/服务端室内分派。

| 必要自检 | 本轮新证据与范围 |
|---|---|
| 定向集成 | `work/d3-targeted-initial.log`：6文件21/21，覆盖室内确定性三阶段、真实门与家具、building归属、workspace完整资源/候选重放/独立保存冷读/完整包，以及原自然算法适配。workspace用例实际删除一件家具和一扇门，撤销/重做后保存冷读确认都不恢复，原当前工程保全；另含取消、旧基线和保存/冷读失败。 |
| 持久配方完整性 | `work/d3-integrity.log`：1文件7/7。严格室内角色联合与参数palette/recipe.props一致性校验通过；自然角色测试先收窄到自然配方，不混用室内角色。 |
| 门路反例收口 | `work/d3-connectivity-final.log`：1文件3/3，实际共享门/外门与全宽路线通过；关闭门、旋转家具封路、开口引用错配及绕出建筑伪造路线均不能报告clear。禁止两房间直连、净宽不足、取消和实际工作量计量有直接断言；未新增持续约束。 |
| 家具建议 | `work/d3-furnishing-second.log`：1文件3/3，大小/用途影响建议、固定实际占地与支撑、缺角色/超大素材给缺项、门口与既有clear路线保全、确定性及可自由删除。此项与前述集成分别保留，不相加为另一全量结果。 |
| 共享无DOM | `work/d3-check-shared.log`：191个源码模块无DOM编译、Node原生ESM及既有命令/身份/投影/存档烟测通过；没有真实图片适配器。 |
| 正常构建 | `work/d3-build-second.log`：`npm run build`通过前端/AI服务TypeScript与正常Vite构建。另一次只读复核`d3-build-verified.log`也通过；保留既有依赖注解/大chunk警告，不作性能结论。 |
| Chromium真实UI | `work/d3-browser-final.log`：`tests/interior-generation.spec.ts`1/1，隔离临时浏览器中正常UI生成三房间、实际门和家具→参数改变使旧候选失效→保存独立工程→冷开→对象面板删除一件真实家具→再次冷开按完整ID确认未恢复，页面错误为0。没有DEV源码导入或存储注入，也未触碰真实用户IndexedDB。 |

截图保留于`work/d3-browser-final/interior-generation-interi-bb851-niture-without-restoring-it-chromium/`：`interior-preview.png`、`interior-cold-open.png`及`interior-deleted-cold-open.png`，用于结构/操作追溯，不代表视觉质量或P3签收。

**首轮失败与修复**：`d3-build-initial.log`发现严格配方角色联合更新后自然测试未先收窄类型，已修正并通过7项及正常构建；`d3-connectivity-initial.log`暴露外部短引道允许区遗漏方端帽边界，修复后最终3项通过；`d3-furnishing-initial.log`是夹具对不同固定定义复用同一catalogId，已改为独立真实身份，未放宽固定源校验；`d3-browser-initial.log`在完整重放/冷读尚未完成时用默认8秒等待候选消失，截图显示实际保存成功。浏览器改为先等待真实“室内布局已完整保存”成功消息（30秒诊断时限），再检查候选关闭和冷开，未改生产预算或保存流程。失败记录保留，不拼成全量验收通过。

本轮只做直接相关开发自检，没有执行全量单元/AI、跨种子/跨浏览器与完整故障矩阵、正式容量/性能、真实模型、混合场景、视觉/P3或目标VTT导入；统一留[09](../09-quality-plan.md#d-domain-acceptance)。26份文档1651个本地链接/锚点与`git diff --check`通过。未提交、推送或部署，既有脏工作区及独立`todo.md`保留（SHA-256仍为`c8952e9305b9e9d0b9f172589f947929bfacf8da8f11264904726aecf55dd9d8`）。下一执行点只在07维护。

<a id="d2-interior-20261105"></a>
## D2室内需求与有限布局开发自检（2026-11-05）

范围对应[07的D2](../07-roadmap.md#d-domain-implementation)，实际接口及有限搜索边界归[设计11.3](../reference/general-map-generation.md#d-interior)，持久归属归[04](../04-scene-document.md#generation-staging)，保存归[06](../06-storage-and-export.md#interior-generation-storage)。本轮只做必要开发自检，未读取真实用户库、调用模型、提交、推送或部署；不是正式验收或视觉/P3签收。

**实现**：严格可变房间需求/净面积/净边长、共墙/分离关系、可选横/纵走廊，经确定性有限矩形切分与有界回溯，原生`createRoom`生成实际房间、顶点及唯一共享墙。实际环形状、精确面积、墙厚边界与走廊净宽独立复核。结果保存规范参数、固定材质、building规则/ownership与真实generationTokens；人工用途/间接几何修改脱管，删除保留墓碑，逐命令拓扑变化及撤销/重做不回退旧令牌。当前无门/路线/家具，必开门、必达、必需家具请求拒绝；有限搜索未找到不证明需求不可行。没有新增工程版本或平行身份池，原自然分支保持。

工程面板提供真实表单与Canvas候选。预览先完整资源准备，不写主工程/仓库；修改参数立即取消旧候选。采用按本会话时间/ID序列完整重放并核对，先保存当前工程，再保存独立新工程并冷读全验，成功才切换。取消、旧基线、伪造凭据、保存/冷读失败保留当前工程；后段失败时独立新记录可保留，不声称跨内存与持久化回滚。

| 必要自检 | 新证据与范围 |
|---|---|
| 定向集成 | `work/d2-targeted-integrated.log`：6文件40/40，覆盖共享室内4例、workspace完整资源/采用4例、building归属及contracts/identities、natural-adapter旧算法6完整响应一致。不同数量、面积、真实走廊、失败分类、出生/人工/删除/拓扑和完整包保存冷读均在此范围；不外推为全部旧算法/多种子验收。 |
| 实际矩形反例与类型收口 | `work/d2-final-domain.log`：2文件9/9，补同包围盒但被切掉一角的实际房间拒绝，复验生成与building归属；与前项分别保留，不相加为另一整套结果。 |
| 共享边界 | `work/d2-check-shared.log`：189个源码模块通过无DOM编译、Node原生ESM与既有命令/身份/投影、资源/存档烟测；无真实图片适配器的边界保持。 |
| 正常生产构建 | `work/d2-build-final.log`：最后代码编辑后`npm run build`通过前端/AI服务TypeScript与Vite，保留既有依赖注解/大chunk警告，不据此声明性能通过。 |
| Chromium真实UI | `work/d2-browser-verified.log`：`tests/interior-generation.spec.ts`1/1。纯UI新建当前工程→3个房间/共墙关系→真实画布→改用途使旧候选失效→重建→保存新工程→页面刷新→从最近工程冷开，页面错误为0；尺寸栏按当前候选12×8m核对。使用隔离临时浏览器，不含DEV导入或存储注入。 |

最终截图为`work/d2-browser-verified/interior-generation-room-r-bf4e3-old-open-a-complete-project-chromium/interior-preview.png`及`interior-cold-open.png`。截图用于结构/操作自检，不把普通填色布局作为成图质量或P3通过。

**首轮失败与修复**：域测试首次误从graph导入命令API，修正为真实commands入口；类型检查发现测试owned clone的readonly类型和ValidationResult联合未收窄，修正夹具类型/断言。首轮浏览器未先切到工程页，第二轮误用不存在的消息class；按实际tab及role=alert修正用例，未改应用迎合定位器。静态复核发现bbox不足以证明真实房间矩形，补正交边/精确环面积与反例；目视发现候选画布尺寸栏仍显示原工程范围，改为当前预览文档，并补UI断言。采用失败后清除失效候选并保留表单/错误；离开守卫使用通用地图候选文案。失败日志保留在`d2-interior-initial.log`、`d2-typecheck-initial.log`、`d2-typecheck-second.log`、`d2-browser-initial.log`、`d2-browser-second.log`；中间成功浏览器轮次为`d2-browser-complete.log`，最后尺寸修复后只引用新的verified结果。

完整单元/AI、跨种子/跨浏览器与完整故障矩阵、Worker/服务端室内分派、真实模型、正式容量/性能、混合场景、门路/家具、视觉/P3和VTT仍留[09](../09-quality-plan.md#d-domain-acceptance)及后续开发范围；原脏工作区和独立`todo.md`保留（SHA-256仍为`c8952e9305b9e9d0b9f172589f947929bfacf8da8f11264904726aecf55dd9d8`）；文档本地目标/新增锚点与`git diff --check`通过。主文件指纹为`work/d2-source-fingerprint.json`，这是未提交工作区快照，不冒充提交冻结。下一执行点只在07维护。

<a id="d1-generation-stages-20261105"></a>
## D1共用接口与阶段候选开发自检（2026-11-05）

本项对应[07的D1](../07-roadmap.md#d-domain-implementation)，接口及限制归[生成设计](../reference/general-map-generation.md#d1-stage-contract)，持久责任归[04](../04-scene-document.md#generation-staging)。执行范围仅D1：共用编排能在私有完整文档上逐步物化，后项读取真实前项事实；没有实现D2室内布局、增加工程持久字段、读取用户数据库或执行提交/推送/部署。正式验收仍从09统一执行。

**实现与边界**：步骤依赖及输入绑定具体stepId、精确算子版本、产物基数/ID/Floor/坐标框架；完整候选逐阶段独立捕获/冻结、校验场景和实际预算，提取新的事实并形成文档/输入/输出hash回执。前序事实失效、越阶段写域、硬约束、失败或取消均拒绝整套结果，source保持不变。墙门事实及实际全厚度/miter/bevel转角参与边界检查；未显式发布的物化事实也检查。当前不提供增量缓存或自动重算调度，改变上游参数以新请求重新执行。候选仍为prepared，完整工程身份/资源/许可/像素、授权/锁及保护/CAS/撤销检查不省略。

自然适配保留原协议一次完整算法调用，仅结构阶段通过显式静态重放桥物化，后阶段读取真实候选；没有将旧算法内部拆成四套新求解器，也未给普通注册开放跨阶段写域。旧算法6的同输入完整响应、seed和resultHash与直接入口及Worker函数逐字段一致；不外推为算法1–7、多种子或真实跨端完整验收。

| 必要自检 | 本轮新证据 |
|---|---|
| 直接影响的生成模块 | `work/d1-final-targeted.log`：4文件41/41；串行`--maxWorkers=1 --testTimeout=30000`。覆盖原生建房/真实墙绑定/门物化/下游查询、重复算子实例的精确选择、版本/基数/Floor/框架/ID拒绝、旧事实失效、参数影响hash、失败/取消保全、越阶段隐藏实体拒绝、墙/开口边界，以及自然算法6响应与Worker函数一致。30秒为开发诊断时限，不是性能或默认5秒通过声明 |
| 共享无DOM | `work/d1-shared-final.log`：`npm run check:shared`通过186个源码模块；Node ESM、命令/身份/投影、无图片ZIP/历史及个人库烟测通过，没有真实图片适配器 |
| 类型与正常构建 | `work/d1-typecheck-final.log`记录`npx tsc -b --pretty false`成功；`work/d1-build-final.log`记录`npm run build`成功，含前后端TypeScript与Vite。既有依赖注释/大chunk警告保持，不据此宣称性能通过 |

**发现与修复**：首轮3文件24通过/1失败（`work/d1-initial-tests.log`）是旧缺输入断言只接受“强类型输入”，新精确绑定更早给出“输入产物基数不符”；仅修正断言，未放宽校验。阶段链首次定向2文件28/28、加入预算后4文件35/35分别保留在`d1-stage-tests.log`、`d1-generation-final.log`。静态复核发现完整物化回调可绕过阶段输出所有权，以及墙/开口边界遗漏；已补独立文档写域检查、真实几何和未发布事实检查，并以反例与合法边界配对通过。最终4文件41项为同一次完整定向结果，不拼接此前通过数。

本轮未运行完整单元/AI、浏览器/多种子矩阵、真实模型、视觉/P3、正式性能或目标VTT验收。已有其他脏工作区编辑和独立`todo.md`保留。下一执行点只由[07](../07-roadmap.md#current-step)维护。

<a id="single-v1-generation-20261105"></a>
## 唯一完整v1、独立迁入与通用生成薄层开发自检（2026-11-05）

本记录属于开发整改，用户目标为通用地图生成器和唯一当前完整v1；不是正式验收、真实模型、容量/性能或发布结论。未读取或迁入用户真实IndexedDB，未提交、推送或部署。工作区已有其他未提交地形/素材改动继续保留，独立`todo.md`未改。

**实现范围**：当前工程/场景/manifest统一为1，固定内部组合identity5/appearance2/visual3/generation5，保留原v8完整能力；正常入口不接受旧开发文件。新建/样板/内置胶囊和编辑/资源/历史/渲染/AI实际能力使用方同步；公开新AI任务仅协议4，旧协议仅来源校验后的内部重放，不延续旧租约。普通256与注册多维预算分别计量，不减身份/外观记录来压成本。算法6领域固定hash及原seed保持，新工程hash重算。

一次性迁入只读旧工程/个人库，重建全历史分支、delta、head/pin与完整资源许可，保留个人素材精确key/组织和原始表行。完整原件冷读留在`sceneweave-development-originals-<源指纹>`；私有目标按指纹隔离，冷读全部记录并复核源后同步发布成对选择指针。重复执行不覆盖已采用成果；锁约束迁入工具，不宣称与旧页面写入构成跨数据库事务。原件库仍缺便携整库下载入口；源库保持原样。

通用层为`shared/generation`会话内强类型产物/约束、精确版本注册、依赖/seed、多维实际计量与取消。空间从严格完整场景提取支撑、旋转占地、真实门/墙厚、足宽连接与二维预留区；它不承担通用三维净空或跨层寻路。自然适配器精确调用原算法，实际底图Worker使用该适配器，但只回传原协议完整结果，后续仍走物化/资源/身份/权限/保护/CAS/一次采用。静态算子为可信代码，不是任意插件沙箱；D的室内/洞穴/混合领域未由本记录证明。

**失败与修复**：

- 首轮默认单元：257文件通过、22文件失败，2825通过/131失败；旧当前版本断言/直接构造、退役升级引用及完整身份/外观计费缺口分别修复。首轮日志`work/single-v1/all-tests.log`保留。
- 第二轮默认单元：279文件通过、3文件失败，2990通过/6失败。4个底图接续用例触发默认5秒上限，另两个为旧协议只读投影与实际成本断言。底图同输入独立60秒诊断17/17通过，涉及接续/取消/保存的真实单例约4.9/15.4/10.3秒，四例单独声明60秒；未改生产预算。AI只读投影必须先证明旧来源，成本按完整元数据计量。日志`all-tests-round2.log`与`base-map-duration-proof.log`保留。
- 旧v7合法画区可超采样框：先红后绿，迁入仅扩为原框与全部原画区包围盒并集，不裁切、不生成成员。旧非法擦除coverage在归一前按旧领域规则拒绝，防止被静默归零。真实managed/manual/deleted/detached、锁、墓碑与拓扑损坏已有回归。
- 冷读仅枚举现存目标可能漏掉整个删除scope，增加已安装记录覆盖复核；verified但未发布的目标还需目标指纹与最终源复核。源变化、缺记录、取消和指针配额失败均不切换。
- AI回执内层长度不足以限制最终JSON包装，改为真实封装8KiB边界分页/裁剪；不增上限。旧服务测试迁移到当前4，并保留旧内部来源/账本冷重启拒重发证据。
- 首次生产脚本错误假定刷新自动恢复会话，后续显式回首页打开最近工程。首轮和两次修正日志保留；应用当时没有页面/网络错误。
- 后续混跑/长停顿产生超时与worker启动失败；这些日志保留为失败，不拼成通过。最终改为防空闲休眠、单进程串行复核；这是开发诊断，不是正式性能测量。
- 独立AI完整集538通过/2失败：累计预算重型用例超过其显式20秒测试时限，按实测声明60秒；HTTP runner测试未扣除已计入的真实初始化时间，改为读取初始剩余额度后推进假时钟，保留30,050ms及冷却跨界断言。两文件定向复验19通过/1失败，原两项已通过，新增失败为布景用例默认5秒超时；该例独跑30秒诊断通过，再声明独立30秒并用默认配置定向复验1/1通过。生产预算和行为断言未放宽；没有重新运行完整AI集。

**已完成的必要证据**：

| 检查 | 结果与边界 |
|---|---|
| 迁入与旧v7转换 | 2文件26/26，通过全部分叉、pin、真实bytes端口、个人胶囊/组织及坏源/取消/源变化/发布失败。`work/single-v1/workspace-v7-import-regressions.log`；使用fake-indexeddb，不代表用户库验收。 |
| 通用编排/空间/自然适配 | 3文件25/25；Worker相关4文件90/90；算法6完整响应一致。固定输入结果不外推为任意领域生成。 |
| 共享无DOM | `npm run check:shared`通过185模块与Node ESM/命令/投影/当前及所选历史ZIP/个人库备份烟测；没有真实图片适配器。 |
| 实际Chromium迁入 | `tests/development-import.spec.ts`2/2：隔离v8三节点分叉/命名pin/真实PNG与Canvas像素，首页迁入发布重载冷开、源只读及真实跨tab锁等待取消。`work/development-import-browser-20261105/migration-run.txt`。 |
| 实际Worker/HTTP | `tests/base-map.spec.ts`registered profile例1/1，small/standard/expanded岛与expanded群岛结果、资源/冷包/预算核对；受控HTTP不调用付费模型。`work/development-import-browser-20261105/registered-profile-run.txt`。 |
| 正常构建 | `npm run build`通过完整前后端类型检查与Vite；末尾UI文案及测试时限调整后补跑同一构建也通过。既有zod注解/大chunk警告保留。日志`work/single-v1/build-final-round1.log`、`build-minimal-closure.log`。 |
| 正常dist纯UI | 新建、结构候选确认、单次采用/撤销重做、完整包hash/长度、显式冷重开一致，无DEV/performance钩子及页面/网络错误。`work/single-v1/production-smoke-final/result.json`；只写隔离浏览器数据。 |
| 最终完整单元集 | 282文件、2999项全部通过；`caffeinate -i npm test -- --maxWorkers=1 --testTimeout=30000 --reporter=dot`。全局30秒是本轮明确开发诊断预算，四个重型底图用例有独立60秒；不作默认5秒或性能通过声明。完整日志`work/single-v1/all-tests-final-awake.log`。 |
| 独立AI服务完整集及定向收口 | 完整执行40文件、538通过/2失败，日志`work/single-v1/ai-tests-final-awake.log`；修复后两文件定向19通过/1超时，日志`ai-two-failures-regression.log`。剩余布景例诊断及显式时限复验各1/1，日志`ai-furnishing-targeted.log`、`ai-furnishing-explicit-timeout.log`。这是完整执行加定向修复证据，不宣称修复后完整540项全绿；完整复跑留09。 |

按2026-11-05用户确认的[开发期最小自检策略](../07-roadmap.md#development-self-check-policy)，本轮只收口已发现问题，不继续扩跑。`decoration-island`浏览器用例已移除退役升级模块引用并改为当前完整v1夹具，本轮未执行该专项；完整单元/AI复跑、完整故障与跨浏览器矩阵、真实模型/用户P3、正式性能和目标VTT导入均留开发完成后由[09](../09-quality-plan.md#acceptance)统一执行。后续范围和当前活动项只看[07](../07-roadmap.md#general-map-generation-priority)。

<a id="doc-36"></a>

<a id="doc-36-首页统一工作区与素材组织讨论稿"></a>
## 首页、统一工作区与素材组织：讨论稿

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](m2-project-validation.md#doc-46-7-按用户要求执行清理)。

状态：2026-10-23 根据用户对首页、侧栏、素材标签/颜色、火山/墓地内容和测试数据的反馈整理。本文是设计与排期建议，尚未实施；不改写[07现行路线](../07-roadmap.md)、既有验收结论或格式合同。本轮仅只读审查、制作讨论草图和记录建议，未删除数据、修改产品代码或提交推送。


<a id="doc-36-1-当前问题与原因"></a>
### 1. 当前问题与原因

- `src/App.tsx` 按 hash 在 geometry/assets/layers/history/composition/outdoor 六套整页入口之间切换。默认打开旧几何原型；点击“素材”会卸载原页面，进入独立工作台，左侧导航和场景内容因此改变。此前版本隔离便于演进，但目前把技术演进顺序暴露成了产品导航。
- v6 `OutdoorWorkbench` 已包含场景、建筑、室外、素材、历史和图层能力；但左栏只在部分 tab 下渲染场景/图层。用户查素材时不能持续查看场景组织。02原设计已要求工具共用工程、画布、选区和历史，当前入口尚未统一。
- 物件定义、材质、组合已有 `tags: string[]`，素材库支持关键词及类型筛选，导入时可填标签。现有标签大量使用 VIS/SCN/P2 等制作信息；缺少入库后打标、批量整理、标签/颜色筛选、图片缩略图与跨工程的个人素材目录。
- 新建v6工程目前预装三包全部定义、图片和许可。继续扩充题材后，每个空白工程都带全部库存的方式需要调整。


<a id="doc-36-2-产品结构建议"></a>
### 2. 产品结构建议

入口组织为：首页 → 统一编辑工作区；首页另提供素材管理。工作区中的素材 tab 打开嵌入式素材浏览器，不跳离工程。底层严格版本和迁移职责继续保留在兼容层，普通使用者按任务找工具。

| 区域 | 推荐职责 | 切换时的约束 |
|---|---|---|
| 首页 | 新建、打开、最近工程、继续编辑、内置示例、素材管理 | 示例、用户工程和开发夹具分开；打开失败保持当前工程 |
| 顶栏 | 回首页、项目名称、保存状态、撤销/重做、导入/导出 | 导航离开前按现有保存/冲突语义处理 |
| 左侧窄工具条 | 选择、平移、建筑、地形、放置、注记、量尺 | 表达指针行为，选中状态明确 |
| 左资源面板 | 素材、建筑、地形等模块tab；模块自己的目录和工具选项 | 仅切模块，不重建工程、画布、历史或视口 |
| 中央 | 同一工程画布及暂态候选 | 当前工程、选区和视口由共同会话持有 |
| 右上 | 场景选中对象属性及外观；未选中时为场景设置 | 浏览素材不抢走场景选区；素材详情在左面板内部打开 |
| 右下 | 图层、对象、历史tab；图层/对象支持锁与编辑隐藏 | 切左侧素材仍保留右侧场景导航 |
| 底栏 | 缩放、吸附、格线、单位、操作提示 | 缩放为会话暂态；格线/单位沿用现有工程显示设置事务，不能因移到新位置改变持久化语义 |

首先实现固定分栏、可折叠/调整宽度、记住布局和重置布局。窄窗口提供明确的面板展开按钮，不能仅靠CSS隐藏后失去访问入口。浮动窗口、任意拖拽停靠、多文档标签后续再议。参考PS的是稳定的位置和职责，不引入像素编辑器的整套功能。

切换模块应保留场景选区/图层与资源搜索条件；未采用的绘图或放置候选须有统一取消/保留规则，明确提示，不会因组件卸载丢失。待采用事务仍使用现有依赖、锁、预算、保护点和CAS规则。


<a id="doc-36-3-重构边界"></a>
### 3. 重构边界

从已有v6能力提取统一壳、编辑会话、面板及动作入口，逐步替换旧整页导航。目标分工：

- 应用壳：首页、项目打开、全局对话框、布局和导航。
- 编辑会话：唯一当前工程、选择/视口/暂态工具、撤销、保存与错误状态。
- 工具与面板：建筑、地形、素材、图层、属性、历史通过共同会话与事务入口工作。
- 素材目录服务：目录检索、组织标签、缩略图与固定资源采用。
- 兼容层：旧格式校验、旧仓库发现、显式完整副本迁移。先补统一发现与安全打开，旧UI退役须在兼容回归后单独处理。

不因整合界面而同时重写渲染器、历史、格式和所有领域命令。工程迁移发生在明确打开/升级时，不能在点击素材或切工具时迁移。首页列旧仓库工程时保留仓库与工程身份，避免同名项目混淆；旧原件、历史和来源链按现有合同保全。


<a id="doc-36-4-素材标签颜色与库存"></a>
### 4. 素材标签、颜色与库存


<a id="doc-36-用户操作"></a>
#### 用户操作

提供图片缩略图、名称与尺寸；可查看详情、放置/应用、添加或删除标签、批量打标。库范围为“内置素材 / 我的素材 / 本工程”，共用搜索和筛选组件。标签允许中文和任意普通关键词，推荐词不限制输入。

| 维度 | 示例 | 说明 |
|---|---|---|
| 类型 | 物件、材质、组合 | 已有类型基础 |
| 场景 | 室内、室外、墓地、火山 | 可以同时属于多个场景 |
| 用途 | 照明、储物、建筑、植被、装饰 | 方便按制作任务找物品 |
| 材质/状态 | 木、石、金属、破损、废弃 | 可选的推荐标签 |
| 颜色 | 红、橙、棕、灰、黑、多色 | 多色允许；色块同时有文字 |
| 自由标签 | 祭坛、旧宅、我的常用道具 | 用户自由整理 |

建议同一维度多选为“任一”，不同维度取交集；自由标签明确提供“全部匹配 / 任一匹配”。所有条件可见、可单独移除、可清空。例如“墓地 + 石质 + 灰色”可以找到墓碑和石棺。文字规范化处理空白、大小写、全半角和重复；保留原显示文本，内部保留标签不交给用户编辑。

颜色首批采用人工确认的多色描述；后续可以从可见像素提取候选主色并允许纠正。透明背景、阴影不能主导结果。素材库颜色描述固定源或变体；场景物件经过外观覆盖后的当前颜色另属场景筛选。给某个实例加“线索”不能让全库同类物件都带上该标签。


<a id="doc-36-数据与采用"></a>
#### 数据与采用

现有固定定义的tags也属于固定内容，不能为了用户打标原地改义。建议增加独立、带版本的素材目录组织数据：以固定素材身份关联用户标签、颜色描述和收藏；发布者标签与个人补充有明确来源。图片与定义版本保持不可变。发布者默认标签调整采用显式新固定定义版本并随目录发布；个人整理独立保存。

首批须明确组织数据备份/导入/导出语义，不能只把标签存在不可携带的界面缓存中。建议素材库备份携带个人整理数据；工程只承载已采用的固定内容及保证可编辑所需资源，个人全库整理不自动对外分享。若要让实例标签或目录组织快照随工程持久化，需按04/06演进新合同/版本，不能向严格v6或v3偷加字段。

目录浏览读取索引和缩略图；采用时才校验并复制该固定素材的完整定义、成员/源链、实际资源字节和许可。离线使用靠本地已安装主题包；未下载资源明确显示不可离线采用。导出仍自包含，原件/派生/历史/组合的依赖不能丢。现有工程已采用定义仍是依赖根，不能以“当前画布没有实例”直接回收。目录标签不自动改物理占地、支撑、危险、阻挡或秘密。


<a id="doc-36-5-内容扩充"></a>
### 5. 内容扩充

火山和墓地作为同一画风的题材包。先给既有素材补用户能理解的标签，再制作少量完整样品和小构图确认风格、比例及筛选，随后扩充变体/组合。每件同步交付源文件、透明图片/材质、实际尺寸、占地、许可与标签。

- 墓地首包：多种墓碑、石棺、围栏段/门、枯树、烛台，以及泥土/石路材质；组合例为墓位或小祭坛。
- 火山首包：玄武岩/火山灰/熔岩材质、岩块、裂隙、烟口装饰；组合例为岩堆或熔岩岸边。熔岩贴图与危险区、通行规则分别显式设置。

优先小包验证视觉与组织，避免先批量堆素材再返工分类。可以先墓地验证通用物件组织，再火山验证材质/地形组合；不绑定AI生成，M2以后沿用相同目录、固定版本与采用流程。P3视觉签收独立于数量和自动化测试。


<a id="doc-36-6-建议工作顺序"></a>
### 6. 建议工作顺序

以下是讨论编号，不替换07现行任务编号，也不表示用户已经授权实现全部切片。

| 顺序 | 工作 | 可检查的结果 |
|---|---|---|
| 准备 | 收口现有M1-D成果，保存本次设计与数据清单 | 已完成成果可追溯；提交推送仍按实际授权 |
| U1 | 首页、统一项目入口和稳定工作区 | 同一工程连续操作建筑/地形/素材；右侧图层/对象始终可访问；选区、视口、历史不因tab切换丢失 |
| U2 | 素材目录边界、缩略图、标签编辑/批量标注与颜色筛选 | 内置/个人/本工程清楚；自由标签可整理、可备份；采用后离线完整 |
| 主题包 | 既有素材补标，墓地/火山小包 | 能按场景、用途、颜色找到素材并组成可编辑小场景；视觉单独评审 |
| D续 | 在统一工作区完成M1-D全流程 | SCN-04从空白全程、SCN-01布景、视觉尺寸/占地差异提示和错误恢复 |
| M2 | 单素材生成/同化，再组合与显式扩围 | 复用已经稳定的素材库和采用语义 |

U1稳定后，可并行做U2与素材样品；大规模入库等标签合同确定后推进。数据生命周期整理是独立小切片，可并行但必须先核对引用。剩余性能专项沿用34继续后置，功能回归仍随改动进行；不据本计划关闭C5/完整M1/性能门。


<a id="doc-36-7-测试数据与归档建议"></a>
### 7. 测试数据与归档建议

2026-10-23本地只读盘点：`work/`约1.9 GiB，`docs/evidence/`约743 MiB，`tests/`约924 KiB，`playwright-report/`约3.5 MiB，`dist/`约2.7 MiB；容量为当前现场近似值。部署仅发布dist，这些证据目录不会全部发给浏览器。

| 类别 | 建议 | 前提 |
|---|---|---|
| 可再生临时报告、截图、构建产物 | 可清理 | 独立失败证据和必要产物已归档；没有活动任务使用 |
| work实验树 | 按清单清理 | 部分归档校验依赖原始work，先消除依赖或保全取回方式；不能整目录盲删 |
| 测试代码、最小夹具 | 保留并随功能维护 | “验收过”不代表重构后仍正确；旧格式夹具仍用于迁移/隐私/恢复 |
| 历史原始证据 | 制定独立归档/去重政策 | 保留报告、环境/负载/方法、源码关联、hash索引、关键附件及可取回原件；迁移后验证链接 |
| 界面开发场景 | 移出日常创作入口 | 示例保留首页；开发负载仅开发入口；用户工程不自动清除 |
| 素材源与运行图片 | 保留各自职责 | assets中的SVG/许可与public中的运行PNG不是无用重复 |

大证据中逐字节重复的≥1 MiB文件额外占用至少约163 MiB。新增M1-D全量reporter单份压缩后约93 MB；后续宜使用紧凑结果清单与按hash引用的独立附件，避免截图/工程包base64在每轮reporter内重复。历史失败证据也有价值，不能只留下成功摘要。

建议以后分为短期运行产物、长期缺陷/验收档案、最小回归夹具三级；现有证据先做内容寻址归档并确认完整，再清冗余副本。删除已提交文件不会自动缩小Git历史；不把历史重写混入普通清理。当前尚未删除任何文件。


<a id="doc-36-8-讨论收口"></a>
### 8. 讨论收口

推荐先确认U1布局与模块职责、U2的标签作用范围和备份语义，再把已确认切片同步到01/02/04/06/07/09/14/15。设计稿中的交互仅用于讨论，不代表产品已有这些能力。


<a id="doc-37"></a>

<a id="doc-37-首页统一工作区与素材库准备交接"></a>
## 首页、统一工作区与素材库：准备交接

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](m2-project-validation.md#doc-46-7-按用户要求执行清理)。

日期：2026-10-23。状态：准备已完成；U1/U2尚未实现、产品验收未运行。用户已接受[36讨论稿](#doc-36)后的建议顺序，并要求“先做准备”。本批只保全和核对当前成果、确定设计边界、接回主需求/路线/验收，不修改产品代码、测试、配置或素材，不删除数据，不提交推送。36保留讨论时原文，35及更早报告/证据保持历史原样。

本交接确定下一批可实施的行为与分工；领域字段主定义仍归[04](../04-scene-document.md)，存储与迁移归[06](../06-storage-and-export.md)，交互归[02](../reference/editor-and-architecture.md#doc-02)，状态职责归[03](../reference/editor-and-architecture.md#doc-03)，需求/顺序/验收分别归[01](../01-product.md)、[07](../07-roadmap.md)、[09](../09-quality-plan.md)。本文不另建工程格式或替代这些主定义。


<a id="doc-37-1-已有成果与剩余责任"></a>
### 1. 已有成果与剩余责任

准备起点为 `main / 55894649dafe2ffb0d5fb8d545379e3925e3c8ff`，工作区已有M1-D和讨论稿未提交改动，应用版本 `0.2.0-m1-d-outpost`。完整工程为严格v6 / identity3 / appearance1，有效场景保持严格v3。基线保存1641份非忽略的既有文件hash及开始时Git状态；本轮允许修改的主文档另存原文。完整源码、素材、既有证据和todo.md不因准备而重置。

| 项目 | 已有状态 | 仍需完成的工作 |
|---|---|---|
| M1-D海岸哨所首批 | 36×28m可编辑混合样板；新增6件原创P2候选和补给组合；房间材质、整墙平移、单位/格线事务已实现 | 不能写作完整M1-D退出通过；完整SCN-04从空白布景、SCN-01完整布景/闭环及用户体验仍待后续 |
| 当前素材目录 | 34张原始PNG、23个物件、11种材质、3种组合，实际资源和许可随工程保全 | 尚无独立个人全库、入库后个人整理、批量打标与颜色筛选；现有全部预装策略先保持 |
| 首批验证 | 35记录1008项单元、175项Chrome及正常构建/生产UI通过；有空白关键结构与样板编辑/恢复/离线/4K证据 | 属于35冻结版本的历史结果，本轮不重跑、不改写；两条旅程不能拼成完整SCN-04手工验收 |
| 美术/通行/恢复 | 既有P2技术候选、有限通行和有限恢复可复用 | P3视觉签收、C4-N02图片与占地差异提示、通用寻路、持久建筑/任意拓扑恢复仍开放；按既有功能责任分批处理 |
| C5性能 | 联合功能与资源复用结果保留 | 完整性能门未通过；按[34](../reference/performance.md#doc-34)继续后置，功能重构不补造正式性能结果 |

已有M1-D未提交成果是本轮需要保护的基线，准备完成不以先提交或清理磁盘为条件；后续提交推送仍按实际授权执行。


<a id="doc-37-2-已定顺序与切片"></a>
### 2. 已定顺序与切片

U1/U2作为M1内的产品整合切片接入07，不建立新的里程碑，也不复用旧A1编号。用户本次授权到准备交付为止；以下实施行保持“计划”，准备完成不会自动开始写代码。

| 切片 | 范围 | 依赖与退出结果 |
|---|---|---|
| 准备 | 现有成果/未完成项、布局和状态转换、目录作用域、需求及验收映射 | 本交接与主文档一致，基线保护和文档核查完成 |
| U1a · 下一实施入口 | 首页、六原生仓库统一发现/安全打开、唯一当前编辑会话和统一动作入口 | 使用已有v6能力；同会话切模块与回首页不丢选择/视口/撤销/错误状态；旧工程显式升级副本且失败安全 |
| U1b | 固定分栏、左右面板职责、折叠/宽度/布局偏好、窄屏访问 | 基于U1a；不再以替换场景组织面板切换素材；完整连续旅程及可访问性通过 |
| U2a | 独立目录/组织/备份合同定稿 | U1稳定；先冻结精确身份、schema/版本/预算、并发/CAS、导入冲突和安装状态，再实现任何新写入器 |
| U2b | 三库范围、缩略图、个人标签/多色/收藏、批量整理、完整素材采用与备份 | 遵守U2a；新环境恢复组织与完整资源、离线续编、失败/冲突/许可边界有证据后，才调整新建工程的按需带入策略 |
| 题材小样 | 既有素材补标 → 墓地小样 → 火山小样 | U1稳定后可与U2并行准备少量样品；大规模入库等U2合同确定，视觉/尺寸/占地单独签收 |
| M1-D续批 | 在统一工作区完成SCN-04全套从空白、SCN-01布景、差异提示及错误恢复 | 复用统一工作区/目录；不以样板或技术自动化替代完整用户旅程/P3 |
| M2-A/B/C | 单素材生成/同化 → 固定组合 → 明确范围渐进扩围 | 沿用07的功能依赖和阶段验收条件；不因准备完成跳过目录、固定版本、采用与恢复边界 |

数据归档为独立小切片，可另行并行安排，不进入U1关键路径；本轮只登记规则，不执行删除或Git历史重写。余下性能专项继续按34后置。


<a id="doc-37-3-u1a统一工程入口与会话"></a>
### 3. U1a：统一工程入口与会话


<a id="doc-37-首页与打开"></a>
#### 首页与打开

首页提供新建、打开、最近工程、继续编辑与内置示例，开发校样/负载不混入普通用户工程列表。素材管理的完整功能归U2，U1不以可点击但无功能的入口冒充已完成；可明确显示待提供的说明。

统一发现至少保留“仓库标识＋sceneId”的真实身份，并展示必要的来源/版本区分；同名工程或不同仓库中的相同sceneId不合并。损坏/不支持的条目显示可诊断状态，不静默消失或触发自动删除。读取列表不批量迁移所有工程，不把列表卡片中的统计/缩略图当成完整工程校验。

打开旧格式时按已有严格分派与完整副本迁移处理：先保全当前工程，明确告知创建新版本副本、原件和旧历史的去向，再校验完整资源与来源链、保存新副本，最后切换。旧自动/命名/保护历史是否迁移继续按各版本现有合同，不承诺全部跟随升级；失败/取消保留当前工程、旧原件及可用撤销。打开当前v6无需为了统一界面再造一次迁移。

最新工程的普通入口统一进入同一编辑工作区；旧深链接、读者和仓库先保留为兼容入口，兼容回归后才单独安排旧UI退役。具体路由接法归U1a实施，不能让点“素材”“建筑”或“地形”触发格式升级。

旧原生编辑入口也纳入统一离开守卫：访问另一个原生工程属于真实切工程/兼容访问，不算v6同会话模块浏览，不能同时形成第二个活跃编辑会话。最近列表若命中当前“仓库标识＋sceneId”，默认执行“继续编辑”，不重新install；只有明确“重新载入”等真实打开动作才按既有规则重置undo/witness。浏览器直接深链接不能绕过这些边界。


<a id="doc-37-会话职责与寿命"></a>
#### 会话职责与寿命

共同会话持有唯一完整当前工程、撤销/重做、保存/错误状态、场景选区、视口、当前层、编辑隐藏/独显、模块搜索与草稿、唯一待采用候选和异步代次。面板订阅会话，不能依赖整页组件卸载/重建来完成切换。首批不提供多文档同时编辑。

同一次打开期间，切模块、素材详情、布局或回首页后“继续编辑”保持该会话，不重新open/import当前工程。C2结构witness可随同一会话保留；真实重开/导入/切工程仍按现有规则失效，不从持久快照、同ID或JSON重新拼接证明。浏览器刷新只保证已成功保存的完整内容；不把选择/视口/草稿/隐藏状态新增写入工程，也不承诺刷新后恢复未采用草稿。


<a id="doc-37-草稿候选与导航规则"></a>
#### 草稿、候选与导航规则

| 用户行为/当前状态 | 保留与允许行为 | 终止或拒绝规则 |
|---|---|---|
| 浏览建筑/地形/素材/图层/对象/历史面板，查看素材详情 | 当前工程、选区、当前层、视口和各模块搜索保留；素材详情在资源面板，不替换场景属性 | 不调用隐式清空选择/草稿或重新加载工程 |
| 绘图/放置草稿尚未生成采用候选 | 草稿仍为会话暂态；允许只读浏览、平移缩放，再回原工具继续 | 进入互斥指针工具或离开工程前，明确继续当前工具或取消草稿；不因tab卸载暗丢，也不新增磁盘草稿格式 |
| 已有待采用预览/局部恢复候选 | 仅一个候选，保持绑定来源/目标/基线与采用/取消入口；允许只读面板和平移缩放 | 冲突编辑/工具及离开当前编辑页须先采用或明确取消，以内联原因说明；新选择不暗改候选范围，不叠加第二候选 |
| 准备/解码/导入仍在异步等待 | 绑定原工程、checkpoint及操作代次；取消后丢弃迟到结果并释放临时资源 | 不能因回首页/重挂载生成一个可冒充新基线的旧结果；待保存阶段的可取消边界按现有事务语义处理 |
| 已保存且没有未结束草稿/候选，回首页再继续 | 保留同一会话、撤销和视口；回到原工程时不另存副本 | 不把“回首页”视作关闭并重开工程 |
| 未保存/保存中，导航或切工程 | 等待串行保存完成；待打开目标可准备，但不得提前替换当前工程 | 保存失败/版本冲突时留在可恢复状态，不丢内存分支；提供重试、完整导出与另存副本，不能自动覆盖对方 |
| 真实关闭/切换工程 | 已确认的当前成果先保全，新目标完整成功后再激活；清空真正失效的暂态和witness | 失败/取消不清旧文档、undo或草稿；真实新会话不继承旧候选/结构证明 |

浏览器Back/Forward、直接hash变化和关闭标签必须覆盖相同的离开保护，不能只保护自定义“回首页”按钮。关闭浏览器可用原生未保存提示，但不得把原生提示当作同步保存成功的保证。所有采用仍复用有限命令、依赖与层锁、256实际展开预算、保护点、单调revision和同事务CAS。


<a id="doc-37-4-u1b固定布局与可访问性"></a>
### 4. U1b：固定布局与可访问性

| 位置 | 职责 |
|---|---|
| 顶栏 | 回首页、工程名称、保存状态、撤销/重做、工程打开/导出与双受众输出 |
| 左侧窄工具条 | 选择、平移、建筑、地形、放置、注记、量尺等指针行为；不是工程版本选择器 |
| 左资源面板 | 素材/建筑/地形等模块目录与工具选项；素材详情在此打开 |
| 中央画布 | 始终对应唯一当前工程和暂态候选，复用现有Canvas与选框/视口逻辑 |
| 右上 | 场景选中对象属性与外观；没有场景选择时为场景设置 |
| 右下 | 图层/对象/历史tab，独立于左模块，锁和编辑隐藏可访问 |
| 底栏 | 缩放、吸附、格线、单位和当前操作提示 |

首批实现固定分栏，可调整宽度、折叠、展开找回、记住布局和一键重置。窄屏使用明确抽屉/面板按钮，键盘与触摸均可访问；关闭抽屉后焦点回到触发器，弹层不把焦点留在隐藏区域。布局数值必须约束在当前可用窗口，损坏/旧版本偏好回到合法默认，不因恢复布局把画布和所有面板挤出屏幕。浮窗、任意停靠、多文档标签和完整PS像素编辑不在首批。

布局偏好为本机独立、带版本的界面配置，不改变工程revision、undo、历史和PNG；选择、缩放、编辑隐藏仍是会话暂态。格线/吸附/单位中已有持久字段继续走现有工程事务，不能因为控件移到底栏变成无存档的缓存，也不能把视口缩放写进世界几何。


<a id="doc-37-5-u2已定产品边界与先行合同责任"></a>
### 5. U2：已定产品边界与先行合同责任

三库范围为“内置素材／我的素材／本工程”，共用搜索、类型和筛选组件。目录条目展示缩略图、名称、尺寸、固定来源/版本和许可；本工程仍包含已采用但暂时无实例的固定依赖根，不按画布出现与否自动删除。首批个人标签、多色描述和收藏独立于固定定义保存；发布者标签与个人补充标识来源，内部保全/制作字段不能由用户改义。

三库名称、缩略图、个人整理及完整库备份属于GM编辑数据，不进入玩家PNG/元数据；浏览“本工程”不会自动推广为个人库，保存到“我的素材”须明确操作并完整保全固定语义。组合采用与备份闭包必须包含确切 `prefabAppearanceTemplates`、模板 `visibility`、成员source/adjustments及祖先/非活动派生保全根；不能只复制组合定义后在目标工程重新推断默认public模板。私密组合转入个人库并在其他工程放置后仍私密；合法遮罩不足时整笔拒绝，不能改公开来制造成功。

普通中文和自由关键词可输入；匹配规范化处理空白、全半角与大小写，保留原显示文本。同一维度多选取“任一”，不同维度取交集，自由标签明确“全部／任一”；筛选条件可见、可单独移除和清空。颜色首批人工确认多色并同时显示色块与文字，算法提色另行后续；目录源/固定变体颜色不等于场景经覆盖后的当前颜色。场景实例标签首批不随目录组织顺带实现。

U2a在任何新写入器之前冻结下列合同，准备阶段不抢先指定新工程版本或编造已可读写的目录格式：

| 项目 | 已定责任/边界 | U2a必须补齐的可执行合同 |
|---|---|---|
| 固定身份 | 按来源/类型/固定ID与版本及内容校验关联个人记录；同ID版本不同内容是冲突 | 精确键编码、来源命名空间、内容摘要范围、严格schema与未知字段规则 |
| 个人组织 | 标签、颜色和收藏不原地改固定定义/源图，也不改场景物理或秘密 | 自有版本、字段/数量/字节限额、匹配规范化、并发/CAS与冲突保全 |
| 浏览/安装 | 索引/缩略图与实际资源分开；未安装、缺资源或不允许嵌入明确标示 | 安装/更新/失败/取消状态、原件完整性、缓存与可回收内容边界 |
| 素材采用 | 校验并复制确切定义、组合成员、源/派生链、实际字节和许可闭包；继续完整自包含工程 | 候选登记/采用原子性、相同固定ID冲突、有限预算和失败不破坏当前工程 |
| 备份/导入 | 明确选择携带个人整理及所需固定内容/资源/许可；完整库备份不能只存引用 | 容器/版本/资源上限、缺依赖/重复/冲突/合并规则、原子失败与空环境离线往返 |
| 组织清单 | 可另提供明确标记的仅整理数据清单，不能声称完整可离线素材库 | 未解析引用如何显示和后续关联；不隐式联网补齐或用最新定义替换固定版本 |
| 删除/更新 | 目录移除不修改已采用工程、快照、源链或其他目录使用者 | 引用清单、保全/删除策略与明确用户动作；不以“无实例”作为工程资源GC依据 |

工程备份继续按06只承载已采用的固定内容、完整资源和显式所选历史，不默认携带个人全库整理。若未来把实例标签或目录组织快照持久化到工程，须另外演进04/06和完整迁移；本轮以及U1不向严格v6/v3塞字段。现有空白工程预装34张图的行为保留至U2采用路径及兼容/离线验证通过，再调整新建策略；旧工程已采用根不因此回收。


<a id="doc-37-6-内容与数据安排"></a>
### 6. 内容与数据安排

现有34PNG和新增6件素材的P2状态保持。先补用户可理解的标签设计，再做墓地小样，之后火山小样；每件实际制作时交付源文件、图片/材质、真实尺寸、占地、来源/许可和固定版本。具体数量和技术参数归后续制作切片，当前不生成素材、不填虚构hash，也不把示意草图条目当库存。熔岩外观、危险区和通行分别显式设置；视觉P3独立评审。

旧证据和work实验树先做依赖清单、内容寻址/去重与可取回原件核验，再由单独授权清理。后续新证据优先使用紧凑reporter和按hash引用附件，保留失败现场；测试代码、最小夹具、旧格式与隐私/迁移回归继续维护。源SVG与运行PNG职责不同，不能当无用重复删掉；删除当前文件也不等于缩小Git历史。


<a id="doc-37-7-实施验收与准备交付检查"></a>
### 7. 实施验收与准备交付检查

新增PRD-034至037；运行验收定义为QA-WS-01至06和QA-CAT-01至06，并复用既有QA-TXN/IMPORT/SECRET/REC/LAYER等适用子项。具体输入/期望/判定以09为准，当前产品状态全部“未运行”。36草图23项仅为讨论示意检查，35的1008单元/175Chrome仅为历史冻结版本结果，均不能填入这些新QA。

U1最小连续旅程：从首页新建 → 绘房 → 浏览素材且保持选择 → 放置 → 编辑地形 → 查看图层/对象 → 命名快照与有限恢复 → 保存重开/完整包与双受众。另覆盖草稿/预览取消、迟到结果、保存失败/多标签冲突、浏览器导航、六仓库同名项目和显式升级副本。布局验证覆盖桌面、窄屏、键盘/触摸、损坏偏好与恢复布局；具体视口和实际方法由实施批次记录，不预写通过次数。

U2最小连续旅程：选择确切素材 → 个人打标/多色/收藏 → 跨工程查找 → 完整闭包采用 → 离线编辑/工程往返 → 空库恢复个人目录与备份。另测私密组合跨库/公开Floor采用与备份后仍保全模板私密性、无合法遮罩则拒绝；同ID版本冲突、许可/图片缺失、取消/写入失败、目录删除保留工程/快照和范围外个人数据；用少量墓地/火山样品检查筛选与真实比例，不以数量替代视觉验收。

准备交付只检查文档与保护范围：主定义/编号/链接/锚点、状态与任务依赖一致；源码/测试/配置/素材/35/36/既有证据和todo指纹保持；新增文本不包含目标凭据模式。不运行产品测试/构建/浏览器、不修改任何旧验收结果。检查记录独立归准备证据目录（原附件已清理，旧路径：`docs/evidence/workspace-preparation/README.md`），准备完成后下一入口为U1a实施，仍按实际任务授权推进。

本轮独立文档/范围核查通过：1624份非本轮既有文件hash保持，含361份源码/测试/工具/配置、83份素材文件及1149份旧证据；35/36、todo、应用版本与HEAD不变，17份原主文档归档与起始hash一致。新增4项PRD和12项QA定义有效，QA产品状态均为未运行，未新增重复编号；本地链接/锚点、表格及新增文本检查通过。完整计数与实际结果见checks.json（原附件已清理，旧路径：`docs/evidence/workspace-preparation/checks.json`）。这些结果仅证明准备文档一致与基线保全，不升级为产品或美术/性能通过。


<a id="doc-38"></a>

<a id="doc-38-u1a-首页统一工程入口与连续会话验证"></a>
## U1a 首页、统一工程入口与连续会话验证

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](m2-project-validation.md#doc-46-7-按用户要求执行清理)。

日期：2026-10-23。本地版本：`0.2.0-m1-u1a`。用户在[37准备交接](#doc-37)后明确要求“做 U1a 吧，先完成首页、统一工程入口和编辑会话”。本批实现U1a；U1b固定分栏/布局偏好与U2目录/标签/颜色/备份仍待后续。37和36保留准备/讨论历史，35和既有证据不覆写，不删除工程或旧数据，不自动commit/push。

**功能实现完成；完整回归暂缓。** 2026-10-23 用户最新要求：先进行需求开发和简单测试，完整回归由用户后续明确通知后统一执行。开发切片只做必要的类型/构建检查与少量定向验证，不默认启动全量单元、全量浏览器、长时间专项或大规模证据归档。已运行的结果和失败现场保留；尚未复验的修正明确列为待验证，不据此宣布完整验收或性能通过。 本记录仅列实际运行，不用旧版1008单元/175Chrome代替本批结果。余下性能按34后置，普通测试时长不是正式性能分布，不关闭C5、完整M1、P3、真实配额/跨浏览器或小团门槛。


<a id="doc-38-1-实现与操作入口"></a>
### 1. 实现与操作入口

- 默认地址或`#home`显示首页：新建、完整工程文件、六原生仓库最近工程、继续编辑，以及书房与露台、双层岩岛、海岸哨所样板。样板先审阅，再保存为独立可编辑v6副本。
- `#workspace`是最新统一工作区，沿用既有建筑/素材/室外/历史/场景面板。五个模块与Canvas在同一会话中保持挂载；被动浏览保留选区、视口、当前层、编辑隐藏/独显、搜索及未采用输入。
- 已安全保存且没有未结束草稿/候选时，可回首页再继续。当前原生v6条目走Continue，不调用open/import；“重新载入已保存版本”才完整重开，清除真实失效的undo与C2结构witness。刷新后从首页打开已保存工程，不承诺刷新恢复会话草稿/视口/undo。
- 建筑/室外制作、素材导入、外观、组合、建筑/室外属性、批量与显示设置的未完成参数提供明确取消/复位。互斥指针工具、改目标或离开前须完成/取消；待采用候选只有一个，浏览侧栏不重定向其冻结范围。即时提交的物件属性继续沿现有事务。
- `#geometry/#assets/#layers/#history/#composition/#outdoor`兼容入口保留。进入另一个原生编辑器是真正切换，须保存并close当前会话；传入旧版本的单次迁移来源不跨首页残留。旧工坊待预览表单有离开/卸载保护，可明确放弃未提交输入后离开，已采用内容仍须成功保存。


<a id="doc-38-2-数据安全与兼容边界"></a>
### 2. 数据、安全与兼容边界

发现与打开分开。注册表按“仓库种类＋sceneId”识别六个原生仓库，以固定`vN:sceneId`作界面键；标题不去重。发现用只读cursor获取摘要，不全量解码或迁移，缺库探测中止升级、不创建新库；摘要检查可识别的坏行保留可见诊断和禁用动作；完整图与资源损坏在打开时拒绝，未知表/索引/数据库版本独立报告，不吞其他仓库。

打开在只读事务中捕获当前修订及完整资源/许可绑定、适用历史元数据和迁移来源，再使用现有完整validator/hash。原生v6走`openPersisted`；旧版逐级生成完整独立v6候选，确认后保存成功才激活。现有原件链按确切字节保留；原生当前修订没有此前某次导出ZIP作为其存档本体，会为本次迁移生成完整序列化包，因此比较其完整内容与实际Blob SHA，不错误要求两次导出ZIP的时间元数据一致。旧版工程文件升级时仍保全提供的确切原件；原生v6文件导入保全完整内容与明确所选历史，不另存输入ZIP原Blob，旧历史继续留旧库。

所有采用继续使用严格v6/identity3/appearance1和有效v3场景，无格式字段/限额扩展，资源/许可、源/派生闭包、保护点、有限256命令、依赖/锁、单调revision和CAS保持。未引入个人目录、跨工程资源GC或长期Bitmap缓存。浏览器Back/Forward、直接hash及兼容按钮经过共同离开守卫；卸载提示仅为提示，不保证同步落盘。保存失败/冲突、目标校验失败、取消与迟到结果保留当前分支和可用undo。

开发StrictMode重复注册时，首页请求保留至实际可用控制器消费一次；隐藏工作区暂停全局热键，Canvas忽略零尺寸ResizeObserver测量，避免Home往返缩坏视口。真实close先flush并复查checkpoint后清会话，失败或期间新提交不清分支，C2 witness不因UI导航扩大寿命。兼容入口等待关闭时，根路由在首个await前将旧编辑DOM设为inert，并在window捕获阶段阻止编辑按键；beforeunload涵盖关闭处理中状态。finally成功/失败均释放，不误清旧工坊内部操作的busy状态。


<a id="doc-38-3-实际运行"></a>
### 3. 实际运行

| 批次 | 方法与结果 | 解释 |
|---|---|---|
| 初始定向单元 | v2/v4 close 43/43；v2–v5修正后91/91；registry 25/25；v6会话/持久化/守卫最终定向57/57 | Node/fake-indexeddb，部分测试在已有IO异步边界使用替身；不充当真实浏览器持久化或像素证据 |
| 首轮类型/构建 | 类型曾因并行新增测试的unknown/递归来源链声明失败，修正后通过；正常构建通过 | 失败日志保留；不改变原产品格式 |
| Chrome首次入口 | 3失败、9未完成后主动中止 | 发现StrictMode消费首页请求过早的真实入口缺陷；未写入工程，修正后复验 |
| Chrome入口修正 | 4/4通过，46.7秒 | 真实首页新建及三个样板审阅/取消/采用 |
| Chrome首次完整U1a | 11通过、2失败，1.8分钟 | 两个测试预期修正：原生v5序列化ZIP元数据、文件副本标题后缀；现有四级原件/旧库与内容断言继续严格保留 |
| 默认并行全量单元 | 1070通过、5超时；降低为2 workers后87文件1075/1075，50.79秒 | 本批源码、真实数据合同与既有适用单元 |
| Chrome首次完整回归 | 190项中150通过、2失败、2超时、1中断、35未运行；23.33分钟后主动停止 | U1a及旧版适用回归，串行系统Chrome；不做性能门推断 |
| Chrome修正定向首轮 | 14通过、2失败，407.164秒 | C5首次冷启动8秒超时和新增legacy双alert选择器失败；其他适用项通过，原现场独立保留 |
| 关闭屏障后单元首轮 | maxWorkers=2时1074/1075、129.48秒；单进程1074/1075、237.98秒 | 同一既有v5累计节点压力用例超过20秒；现场均保留。v4/v5/v6同类压力用例限时统一60秒，固定5万身份×12快照/累计节点拒绝断言与实际资源预算不变，不作性能通过解释 |
| 本批最近一次全量单元 | 87文件1075/1075，102.99秒，maxWorkers=2 | 已在用户调整节奏前运行完成；以后不默认重复全量 |
| 正常生产构建 | 通过，tsc与Vite成功；Vite阶段4.70秒 | 最新新增浏览器测试文件随后另做类型检查，不声称已运行该用例 |
| 收尾类型检查 | 通过，含最新第3/4条legacy用例 | 仅类型检查，不计浏览器通过；日志typecheck-handoff.log |
| 最新完整Chrome回归 | 按用户要求暂缓，未重跑 | 已有失败/中断批次不能计为完整通过 |
| 正常生产UI冒烟 | 功能断言通过，34.406秒，Chrome156.0.8078.47 | 无DEV API/源码导入/IDB注入；新建、放置旋转、Home继续、刷新后原生重开及4个完整包的实际资源/许可/SHA/34图解码通过；无dialog/page/console/HTTP错误。390px全页截图有异常，视觉复核另列待办 |

首轮15项U1a/旧入口专项独立通过（87.454秒）。完整回归随后发现保存等待先读旧“已保存”标签的测试竞态；已改为动作结束后读保存状态，并在恢复重开前核对原生持久完整内容。两处旧用例在失败预览后直接继续锁层/撤销，与新草稿保留合同冲突，现先明确取消再继续，仍检查工程未变。原细节画布用例由CSS百分比重建裁剪范围，舍入偏离真实参数；会话DOM现暴露精确暂态裁剪/比例供独立渲染验证，不进入格式或改变渲染算法。另修正旧`#outdoor`重复通用草稿capture造成采用后残留离开提示，v6统一由自身逐表单守卫管理，并新增真实重新加载无提示回归。首轮现场与修正专项分别保留。

浏览器专项包含：首页原生空白工程实际34PNG/23物件/11材质/3组合；三个样板独立副本；六个原生数据库同ID同名、坏行保留与只读指纹；v5明确升级、四级确切祖先原件和新捕获当前内容；Home/Continue同Canvas/选择/视口/搜索/undo；建筑/外观草稿、预览和浏览器导航；C2同会话证明与真实重开失效；文件审阅/取消/坏文件/独立副本；挂起真实PNG请求取消及迟到；两标签原生CAS；旧入口单次迁移来源释放和待预览表单离开保护。

QA-WS-01/02/03/05按本批实际子项留证；QA-WS-04/06的U1b布局/完整联合旅程和QA-CAT-01至06不据本批通过。4K、隐私、完整包与旧版本合同沿适用旧回归执行，不以首页截图代替这些内容检查。模拟故障和真实浏览器/原生事务分别标明，不声称真实磁盘配额耗尽、断网PWA冷启动或跨浏览器。


<a id="doc-38-4-证据与剩余安排"></a>
### 4. 证据与剩余安排

起点是已有M1-D与准备文档的脏工作区，基线独立保存在`work/u1a-20261023/baseline.json`，没有回退或提交这些成果。新证据优先按SHA引用附件；紧凑reporter仅记录大于8MiB附件的hash及未保留状态，不伪称归档了缺失内容。已有原始记录保留于该work目录；按最新安排不再展开大规模归档，入口与轻量状态摘要见本批证据索引（原附件已清理，旧路径：`docs/evidence/u1a-workspace/README.md`）。早期冻结仅对应当时源码，不冒充最新冻结版本。

本批不调整U1b的最终分栏、调宽/折叠/本机布局偏好，不增加U2素材组织格式，不实现AI、墓地/火山内容、任意拓扑或持久建筑恢复，也不重新开启性能专项。下一切片按07为U1b；当前M1-D首批、旧历史与格式继续保全，完整M1/P3仍不据本批关闭。



<a id="doc-38-5-统一回归待办"></a>
### 5. 统一回归待办

以下项目保留为待验证，需求开发先继续；没有正在执行的自动回归，也没有安排后台自动重跑。

- 完整适用Chrome矩阵：此前190项批次未完整通过，后续统一回归以届时真实源码为准，不合并旧批次推定通过。
- C5首条联合旅程：原生保存等待/持久内容核对已修正，定向首轮在冷启动8秒等待处失败；启动等待已调整为30秒，尚未复验。
- 旧室外入口采用后的无多余卸载提示：第3条legacy用例已修正双alert选择器，尚未复验；不据类型检查算浏览器通过。
- 兼容入口离开期间输入屏障：inert/捕获按键/beforeunload实现已完成，第4条legacy用例覆盖挂起保存成功/模拟拒绝两阶段，尚未运行。
- 390px首页全页截图出现重复画面：暂未判定是截图管线还是页面滚动问题，不记为窄屏目视通过；桌面首页已查看。

U1b/U2尚未开始。本批代码未commit/push，旧证据与todo保持。


<a id="doc-39"></a>

<a id="doc-39-u1b-固定分栏与本机布局偏好"></a>
## U1b 固定分栏与本机布局偏好

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](m2-project-validation.md#doc-46-7-按用户要求执行清理)。

日期：2026-10-23。本地版本：`0.2.0-m1-u1b`。用户明确要求完成固定分栏、面板调宽折叠和布局偏好，**只做简单测试，完整回归等用户通知后统一执行**。本批功能已实现，不把简单检查计为QA-WS-04/06、完整M1或正式性能验收通过。U1a结果与待验证事项仍归[38](#doc-38)，37/36保留准备/讨论历史。


<a id="doc-39-已实现"></a>
### 已实现

统一入口`#workspace`使用固定工作区：顶栏显示工程名称、保存状态、撤销/重做和打开/导出；左侧窄工具条提供选择、平移、画房间、地形、选择待放置素材、注记和量尺；左资源面板切换工程、建筑、素材库、室外选项；中央保持同一Canvas；右上是属性与外观，右下独立切换图层、对象、历史。素材详情只在资源面板呈现，不替换场景属性。底栏提供缩放/全图、单位/格线/吸附摘要、显示设置入口、选中数量与当前工具提示。

左右分隔条支持鼠标/触摸指针拖动和键盘。Arrow每次10px，Shift+Arrow为40px，Home/End到当前合法边界；右分隔条按画面方向调整。左栏默认280px、范围220–440px，右栏默认320px、范围260–480px。实际宽度受窗口约束，桌面中央至少保留360px；窗口自动压缩不会改写记住的展开宽度。

资源、属性、场景导航可分别折叠，并有始终可见的入口找回。“展开全部面板”保留宽度，“重置布局”恢复默认宽度与展开状态。低于1080px使用明确的资源/属性/场景按钮打开非模态抽屉；关闭后焦点返回触发按钮，隐藏内容使用hidden/inert。各面板和右侧tab内容保持挂载，折叠、调宽、切tab与窄屏访问不卸载表单或Canvas；原有草稿、采用/取消与错误入口继续可达。

布局偏好使用独立`localStorage`键`sceneweave:workspace-layout:v1`，仅含版本、两个展开宽度及三项折叠标记。未知版本/字段、损坏JSON、非有限/非整数/越界宽度或非法布尔值整体回到默认。存储访问/写入失败时当前会话仍可操作，显示偏好仅本次生效。偏好不进入工程、revision、撤销、快照、完整包或PNG；既有单位与格线修改仍走预览及原子事务。

画布控制通过Portal复用原选择/平移和缩放按钮；Canvas留在固定位置。调整布局时保持视口中心的世界坐标和实际像素/毫米比例，只有触达既有25%–800%缩放/平移边界时按原限额约束；显式“全图”、切工程与受众仍沿原重置规则。严格v6/identity3/appearance1、有效v3文档、资源/许可与保存/CAS合同不变。六套兼容入口保留，完整兼容矩阵本批未重跑。


<a id="doc-39-简单检查"></a>
### 简单检查

| 检查 | 实际结果 | 范围 |
|---|---|---|
| 类型检查 | 通过 | TypeScript；不代替运行验证 |
| 定向小单元 | 2文件11/11，221ms | 偏好解析/异常存储/限幅/空间预留与恢复；视口缩放、中心及调宽往返 |
| 桌面/窄屏冒烟 | 首轮2/2，14.1秒；补充焦点处理及截图后2/2，12.308秒 | 仅`tests/u1b-layout.spec.ts`两条，不运行全量浏览器 |
| 窄屏保存状态补充 | 1/1，8.471秒 | 仅复验保存状态可见/在视口内及原窄屏简单用例 |
| 正常构建 | 通过，最终Vite阶段3.52秒（此前3.27秒） | tsc及正常Vite产物；非性能门 |

桌面用例使用1512×982，通过首页实际新建空白v6；检查键盘/鼠标调宽、折叠/恢复/重置、外观亮度输入跨左右面板浏览保留、同一个Canvas及文档/历史身份/外观/undo不变，并在真实刷新/原生重开后恢复偏好。390×844用例启用触摸，检查三个抽屉入口、焦点返回、无页面横向溢出、损坏/未知版本偏好合法回退，以及首页不自动打开工程。开发接口仅只读观察，不注入工程或调用领域写入。

仅留本批小日志、两条冒烟的摘要与截图，不展开大规模证据归档。简明归档见本批记录索引（原附件已清理，旧路径：`docs/evidence/u1b-layout/README.md`），原始记录位于`work/u1b-20261023/`；起始1663份文件hash记录用于保全前批脏成果与todo。没有运行全量单元、全量Chrome、C5/M1-D联合旅程、双受众4K、真实配额/跨浏览器、完整无障碍或正式性能矩阵。


<a id="doc-39-后续"></a>
### 后续

QA-WS-04只记录上述简单子项；200%浏览器缩放、复杂候选/菜单焦点及完整键盘/触摸矩阵留待集中回归。QA-WS-06连续混合旅程、U1a最新守卫用例、旧入口/导出/隐私/存档适用矩阵仍等待用户通知；不把本批或旧报告的子项合并成完整通过。

下一开发切片为U2a目录/个人组织/备份合同定稿，之后才是U2b实施。固定素材、个人整理与当前工程保持独立；本批未实现目录标签/颜色/收藏或AI，未删除数据、commit/push或发布。性能继续按34后置。


<a id="doc-40"></a>

<a id="doc-40-u2a独立素材目录与完整库合同-v1"></a>
## U2a：独立素材目录与完整库合同 v1

M2-0进度补充（2026-10-24）：本文以下保留**U2历史合同**sceneweave-catalog-v1、中性v6载体及旧严格备份，未原地换义。现行默认UI已由f切到sceneweave-library、新完整v1中性载体和sceneweave-asset-library所选备份，精确字段与保全转换以04/06为主；e模块历史见[51](m2-project-validation.md#doc-51)，f实际个人组织/organization-only备份、主会话采用及旧库保全转换子项与最终批次见[52](m2-project-validation.md#doc-52)。算法1精确身份、原显示文本/顺序、全部组织和安装状态保持；旧库仅只读捕获转换，不自动迁移真实用户数据。本文历史运行仍见41/44，不当作新内核验证；后续M2-1后端/流式连接，顺序见[47](m2-project-validation.md#doc-47)、07。

2026-10-23 用户授权U2a/U2b。本合同在新目录写入器之前冻结；本文件定义本批可执行边界，实现与简单测试另归41。严格完整工程v6、identity3、appearance1和有效SceneDocument v3保持，不在工程内添加个人整理字段。完整回归等用户通知，性能继续按34后置。


<a id="doc-40-身份与固定内容"></a>
### 身份与固定内容

目录schemaVersion为1，支持`prop / material / prefab`。来源命名空间是确切固定定义`origin`的规范JSON SHA256（来源声明，不是认证发布者身份）。逻辑键为规范JSON数组`[1,namespace,kind,catalogId,fixedVersion]`；精确键为`[1,namespace,kind,catalogId,fixedVersion,contentHash]`。内容摘要覆盖所选根的全部固定定义、素材资源元数据、外观源及祖先、变体、组合模板、许可绑定和许可文本hash；实际字节必须另验hash、解码、尺寸和真实派生像素。场景名称/时间/ID/revision、位置、实例覆盖、图层、快照和迁移原件不参与目录身份，不得进入库载体。相同逻辑键内容不同明确冲突；不同来源但与工程内固定ID发生冲突同样拒绝，不能改名/换最新版/覆盖。

每个安装条目携带一个中性、无几何和现存实体的原生完整v6 ZIP载体及确切根选择器；只允许所选固定定义及其必要闭包。复用原生严格字段、容器CRC/hash、资源/许可/派生像素校验，不将缩略图当作已安装凭证。保全实际非活动外观、源祖先、变体输入输出和原生保全定义根。组合携带确切`prefabAppearanceTemplates`，包括visibility、成员source与adjustments；不在目标工程重新推断public。固定素材保存不截取场景实例参数，已有实例/层覆盖不暗中烘焙。需要形成新固定组合时沿用现有显式创建组合入口。


<a id="doc-40-独立组织和限额"></a>
### 独立组织和限额

独立IndexedDB `sceneweave-catalog-v1`，数据库版本1；元数据全局单调revision与目录/组织记录同事务CAS。条目以精确键存储并对逻辑键唯一约束。组织记录精确绑定该键，可为未安装的内置/本工程条目存在；浏览工程不自动安装。组织严格字段为`tags:string[] / colors:string[] / favorite:boolean`，未知字段拒绝。标签保留原显示文本，比较使用NFKC、去首尾/连续空白归一和大小写折叠；控制字符及规范化重复拒绝。颜色首批人工选择带文字的12色（红橙黄绿青蓝紫粉棕黑白灰），最多8色，不自动提色。发布者标签只读，内部`sceneweave:`保全标签不作为可编辑个人标签。

限额：最多512安装条目、2048组织记录；单批最多64个不同精确键；每条32标签、每标签40 Unicode码点；单载体32MiB，库内载体总计128MiB。先隔离捕获并完整校验后进入短事务；CAS失败/写入失败/取消整批不落盘，保留界面草稿和已有库。冲突后刷新并显式重应用，不静默最后写入覆盖。目录操作不使用工程revision，不创建工程undo；采用进入工程后才走原有undo/CAS。


<a id="doc-40-浏览安装采用和移除"></a>
### 浏览、安装、采用和移除

内置素材、我的素材、本工程共用关键词、类型、发布者标签/个人标签、颜色及收藏筛选；同维多选OR、不同维AND，自由标签明确全部/任一。过滤条件可见、可单独移除和清空。元数据详情保持场景选择。缩略图用实际图片，说明固定源颜色与当前场景有效颜色不同。安装状态区分可安装、准备中、已安装、缺失/失败和取消；只在完整写入成功后显示已安装。

内置索引不等于本机完整安装；本工程明确“保存到我的素材”才复制完整闭包。采用只追加兼容的确切固定内容、实际资源和许可，走既有`workspace.previewPrepared`候选，用户确认后单一revision/撤销提交；浏览/准备/取消不改工程。单次实际展开（固定定义、外观源/变体/模板、资源和许可新增）最多256，不拆批绕过。后续放置继续现有几何、支撑、锁、预算和玩家投影检查；私密模板不改公开，无合法遮罩时拒绝。重复采用兼容内容可提示已在工程。首批保留空白工程既有34图预装，未以本批简单检查替代兼容/离线完整验证。

移除只删除明确所选个人安装条目及其个人整理；展示影响范围并确认。该库按条目保全独立载体，不回收工程/历史/其他条目的资源，不以无实例为依据清理工程，也不删除内置索引。当前版本不提供自动更新固定定义或自动清理。


<a id="doc-40-完整库备份与导入"></a>
### 完整库备份与导入

扩展名`.sceneweave-library`，UTF-8严格JSON，顶层固定`format:'sceneweave-library' / schemaVersion:1 / records`；每record固定`item / capsuleBase64 / capsuleSha256 / organization`。item结构以`src/catalog/types.ts`为精确接口，未知字段、重复键、重复精确键/逻辑键、未知版本、非规范base64和摘要不符拒绝。每个内嵌载体是完整原生v6 ZIP；全文件最多64MiB、实际嵌入载体累计47MiB、最多64个条目，继承单载体32MiB和原生解压/图像/许可限额。不能只存图片URL或目录引用，载体不携带场景秘密注记/历史/迁移原件。整个库可分次选择备份；不自动拆分一次超限导入。

导入先完整解析、验证所有载体及其精确身份，再预览数量和个人整理冲突，明确选择“保留本机整理”或“替换本次选中整理”，最后依据预览时库revision一次CAS提交。固定内容冲突始终拒绝；相同精确固定内容可幂等复用，组织差异按显式策略处理，范围外记录不变。取消/缺字节/许可错误/容量/写入失败保持原库。离线安装内容不依赖网络。首批只提供完整内容备份，不提供仅整理清单；对应清单专项为不适用，不声称已测。

主定义入口为04/06，产品/交互/路线/QA同步本合同；任何后续格式或含义变化必须显式版本演进，不能向本严格v1增加可忽略字段。


<a id="doc-41"></a>

<a id="doc-41-u2b三库个人整理与完整库备份"></a>
## U2b：三库、个人整理与完整库备份

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](m2-project-validation.md#doc-46-7-按用户要求执行清理)。

2026-10-23，用户授权“做u2a和u2b”。当前本地版本`0.2.0-m1-u2`。先在[40](#doc-40)及04/06冻结独立catalog v1合同，再实现内容、仓库和界面。U1a/U1b及此前M1-D未提交工作保留；本批未commit/push或发布。

用户已要求先需求开发与简单测试，完整回归等通知。本报告只记录本批定向检查和两个Chrome冒烟，不关闭完整QA-CAT、QA-WS-06、完整M1、C5或性能门。[34](../reference/performance.md#doc-34)的性能后置安排保持，35–39及更早记录和证据不改写。


<a id="doc-41-当前实现"></a>
### 当前实现

统一工作区的素材库新增“内置素材／我的素材／本工程”。三库共用关键词、物件/材质/组合类型、发布者标签、个人标签、颜色和收藏筛选。同维度任一、不同维度交集；个人标签另有全部/任一开关，条件可逐项移除或清空。中文、全半角、大小写和连续空白按NFKC等规则比较，个人标签保留显示文本。可见条目按24项扩展显示，真实图片按可见范围加载；缺图/校验失败明确标示，几何素材单独说明。

详情在左资源面板显示固定来源、ID/目录版本、内容摘要、尺寸、发布者标签和完整许可，不选择场景对象。缩略图来自确切asset ID对应SHA的实际Blob；透明背景用棋盘，组合以成员源图缩略展示，不声称它是场景最终合成图。个人颜色是人工整理描述，和实例/图层覆盖后的有效外观分开；首批12色带文字，最多8色，没有自动提色。URL及时回收；载体读取缓存最多32项，没有新增Bitmap缓存。

明确勾选最多64项后，个人整理可写自由标签（每行一个，最多32条、每条40 Unicode码点）、多色和收藏。批量表单明确说明以当前完整整理替换这批条目的个人记录；未选项保持。发布者标签只读，内部`sceneweave:`保全字段不展示为可编辑标签。浏览工程或只打标不会自动安装到“我的素材”。整理草稿和导入预览接入统一工作区离开守卫，面板浏览保留输入；可明确取消整理，不清除其他模块草稿。

“保存到我的素材／安装到我的素材”先完整准备并校验固定闭包，再独立CAS安装。保存固定素材不截取当前实例/层覆盖；新固定组合仍通过既有显式创建组合入口制作。内置目录可读不等于已安装。准备中、取消、失败、缺失及成功状态分别显示，只有落盘成功才记已安装。

“预览采用到本工程”只追加确切固定定义与依赖，复用`workspace.previewPrepared`登记候选；确认后一次revision/撤销，随后从本工程放置。内容准备不改变几何、现存实例/覆盖、图层、历史身份或revision；过期/取消拒绝登记或采用。单次实际新增定义、外观源/变体/模板、资源、许可及绑定合计最多256项。已有兼容固定内容提示无需重复采用；逻辑身份或原生固定ID/许可绑定冲突拒绝，不改名、覆盖或替换最新版。

独立条目采用中性原生完整v6载体，剥离场景标题/几何、私密注记、现存实体与身份映射、实例/层覆盖、历史及迁移原件。保全所选固定语义、组合模板visibility/成员源与adjustments、源祖先、变体实际输入/输出及非活动位图原生保全根、许可绑定和正文。私密模板不会在目标工程重推为public；放置仍走原有支撑、锁、预算和玩家投影检查，缺合法遮罩整笔拒绝。


<a id="doc-41-独立存储和完整备份"></a>
### 独立存储和完整备份

`src/catalog`实现独立`sceneweave-catalog-v1`，Dexie schema版本1（原生IndexedDB版本值10）。安装条目、个人记录和全局单调revision同事务CAS；不用工程revision，不创建工程undo。组织可精确绑定尚未安装的来源项；安装和仅组织记录均检查同逻辑身份异内容冲突。单纯读列表/打标不重新解码整个库，put/load及外部读入继续完整实际资源校验。未知数据库版本/表结构拒绝，原数据保留。

异步输入先独立捕获并校验，再进短事务。初次open尚未完成就卸载时，终止旧连接，禁止迟到结果重新打开数据库。CAS冲突保留当前输入，刷新仅更新库基线，再由用户明确保存或导入；不自动重试覆盖他方结果。独立库最多512安装条目、2048个人记录，总载体128MiB；单载体32MiB，单批64个确切键，其他精确字段及预算以40为准。

所选安装条目可下载`.sceneweave-library`完整内容备份：严格UTF-8 JSON、schemaVersion 1，内嵌完整原生v6 ZIP的规范base64、SHA256及个人整理。外层最多64MiB、实际载体累计47MiB、最多64项；继续完整原生CRC/hash/字段/资源/许可/派生像素和解压限额检查。整个个人库可分次明确选择备份，不自动拆超限批次。不提供仅整理清单，相关分支不适用。

导入先完整校验全部条目，显示选择范围、固定内容冲突和个人整理差异，明确选“保留本机整理”或“替换本次选中整理”，再用预览时库revision一次CAS提交。固定内容冲突始终拒绝；范围外记录保持。取消、缺字节、损坏或写入失败不产生半目录/半资源。移除个人安装条目需确认范围，连同其个人整理移除；不触及已采用工程、历史、源根、内置目录及其他安装条目，没有自动资源回收。

工程仍以完整v6/identity3/appearance1保存，有效SceneDocument仍严格v3；既有六仓库及完整工程/所选历史包保持原合同。个人全库不自动随工程备份分享。新建空白工程的34图预装策略保持，未依据本次简单检查切换为按需预装。


<a id="doc-41-实际简单检查"></a>
### 实际简单检查

各定向批次分别执行，不伪装为一次全量验收。结果摘要与保留的原始输出见simple-checks.json（原附件已清理，旧路径：`docs/evidence/u2-catalog/simple-checks.json`）。内容与查询代理只留执行回报摘要，未保存原始stdout，报告中明确注明；存储、守卫、类型及构建有原始日志。

| 检查 | 结果 | 范围/边界 |
|---|---|---|
| content定向单元 | 7/7，最终约1.12秒 | 真实资源/许可往返及场景信息剥离；GM模板/两级祖先；缺遮罩投影拒绝与合法遮罩；非活动派生闭包；伪造/未知/访问器/损坏；同逻辑身份/许可冲突；展开超256；取消与异步捕获 |
| organization/repository/backup定向 | 3文件11/11，836ms | 精确整理/规范化；独立两连接CAS；实际载体put/load；非法输入/65目标/取消；写入失败回滚；明确移除；未来库拒绝；StrictMode卸载迟到open；备份真实字节与未知/重复/非规范/损坏拒绝 |
| query定向 | 4/4，175ms | NFKC/空白/大小写、同维OR/跨维AND、个人标签全部/任一、发布者与个人隔离 |
| 会话守卫定向 | 29/29，170ms | 既有有限草稿守卫及新增catalogForm的具体取消指引 |
| 类型检查、正常构建 | 通过 | `npm run build`包含`tsc -b`，Vite 3.16秒；有既有混合导入和大chunk提示，无编译失败 |
| 两项简单Chrome | 2/2，18.224秒，0重试/跳过 | Vite开发站点，单worker、Chrome channel；桌面1512×982与触摸390×844，详下文；未做正常生产UI冒烟 |

派生像素单元使用受限1px PNG/Canvas替身来验证IO闭包和像素比较逻辑，不把它记为真实浏览器派生/隐私验收。Chrome流程使用真实PNG及浏览器规范化、解码和实际IndexedDB。

桌面旅程从首页创建工程，通过公开UI导入真实PNG和实际许可、采用固定素材；写个人标签/棕黄多色/收藏，确认完整document/historyIdentity/appearance及undo状态保持；完整保存到我的素材并按规范化个人标签检索。下载实际14158字节库备份，移除唯一安装条目，再完整导入空个人库，确认标签/颜色/收藏恢复且来源工程保持。新建另一个空白目标后将浏览器context设为离线，从我的素材准备候选、取消不变、再次采用r0→r1；放置真实物件后两次撤销依次撤掉放置与目录采用。只证明这条离线旅程，不推定空缓存PWA冷启动或所有组合/旧格式离线验收。

窄屏旅程从首页创建工程，触摸打开资源抽屉，键盘Enter打开“铜色桌灯”详情，建立个人整理草稿；建筑/素材库面板往返后输入保持。关闭抽屉并回首页时守卫提示取消素材整理草稿；明确取消后可回首页，文档无横向溢出。未把这一小旅程当作全部键盘/触摸和P3视觉验收。

首轮两项被脚本定位阻断：桌面使用了错误的嵌套相对`has`定位，窄屏检索误写“台灯”（实际名称“铜色桌灯”）；原报告/trace/截图保留在browser-initial（原附件已清理，旧路径：`docs/evidence/u2-catalog/browser-initial/report.json`）。修正定位和检索词后的独立批次为browser-corrected（原附件已清理，旧路径：`docs/evidence/u2-catalog/browser-corrected/report.json`），不覆写原失败。初轮类型检查的BlobPart和泛型收窄错误已修复，失败日志同样保留。开发中发现的数据库关闭竞争已增加定向保护并复查。


<a id="doc-41-未覆盖与后续"></a>
### 未覆盖与后续

完整单元、全量浏览器、六仓库迁移/旧版/历史恢复联合、真实配额耗尽、所有缺资源/并发/取消排列、私密组合跨库与备份后的双受众4K真实浏览器矩阵、人工视觉P3、正式性能均未在本批运行。QA-CAT-01至06只登记上述适用简单子项，不宣布完整通过；C5与完整M1仍保持未通过。已有U1a待复验项按38保留，不能用本批替代。

下一开发入口按07为既有素材补标与墓地小样，再火山小样、M1-D完整续批和M2素材主线。AI、实例标签、自动提色、自动更新固定版本、仅整理清单及按需新建策略均没有随本批顺带实现。完整回归由用户后续通知启动。

源码指纹见source-fingerprints.json（原附件已清理，旧路径：`docs/evidence/u2-catalog/source-fingerprints.json`），收尾链接/范围及历史保全检查见delivery-checks.json（原附件已清理，旧路径：`docs/evidence/u2-catalog/delivery-checks.json`）。


<a id="doc-42"></a>

<a id="doc-42-内容补标题材小样精修与m1-d续批"></a>
## 内容补标、题材小样、精修与M1-D续批

2026-10-23，用户明确授权“既有素材补标＋墓地小样＋火山小样”，沿用整理/制作、可编辑小构图、实际使用检查三步；随后精修已有较粗糙素材，这些完成后进入M1-D完整续批。用户确认精修对象由实现方根据实际图像选择。本文件记录本批范围与数据边界，实际结果见[43](#doc-43)；本文件保留实施范围与数据边界，不代替实际检查或P3签收。


<a id="doc-42-顺序与具体范围"></a>
### 顺序与具体范围

1. 为既有37个固定目录项补充可读场景/用途标签及人工颜色；不原地修改旧定义、源图、个人整理或工程。新增墓地5件（苔石铺地、墓土、俯视墓碑顶盖/基座、石棺、铁栏段）与火山5件（玄武岩、火山灰、熔岩材质、玄武岩块、裂隙装饰），各一组可编辑组合及小构图。这里是制作清单，只有实际形成字节与测量后才能登记为库存。
2. 新件小构图检查后，对阔叶树冠、圆叶灌丛、灰绿碎石簇、草地、裸岩和细砂六件提供独立精修版本及前后对照。保持旧版与原工程，精修件原物理/视觉毫米范围、像素标称尺寸、锚点、占地/偏移和阻挡语义保持；用新固定身份保存实际图片与来源记录。人工视觉P3仍由用户评审，不由自动检查自签。
3. 上述内容检查后进入M1-D续批。SCN-01完整基础布景还缺衣架、长凳、炉台、操作桌、边柜、床、衣柜七种真实素材，需先制作相应独立俯视物件，再用于SCN-01与SCN-04的完整普通命令创作流程。补C4-N02换图视觉范围/物理占地差异提示。引导创作仅为可审阅普通事务辅助，不用样板载入或替换场景文档冒充从空白制作；无引导手工、全SCN及联合验收仍依实际运行分别判定。

各阶段仅必要定向单元、类型/构建与少量真实浏览器使用检查。完整回归、正式性能和真实小团继续等待用户后续通知；不会因为新增内容/引导流程关闭C5、完整M1或P3。原报告与原证据、todo独立编辑不回滚，本轮不自动commit/push。


<a id="doc-42-补标合同独立只读目录索引"></a>
### 补标合同：独立只读目录索引

旧固定定义的tags也属于不可变含义，不能在同ID/版本下改写。补充采用独立、随应用提供的只读curation版本1索引，精确绑定完整`CatalogItemV1.identity.key`，即已验证来源命名空间/类型/catalogId/固定版本/完整内容摘要。未知字段、重复或非法键、未知版本与不合法标签/颜色拒绝；来源条目不匹配时不按名称、近似ID或最新版关联。生成索引需来自真实完整素材及许可，不能编造内容hash。

补充标签/颜色在UI标明“目录补充（只读）”，与固定发布者tags、用户个人tags/colors分别显示。关键词及只读标签筛选可合并检索固定tags与目录补充tags；个人标签全部/任一仍只作用于个人记录。颜色维度取目录人工颜色与个人颜色的并集，UI明确来源；不做自动提色，不从场景层/实例覆盖回写全库。条件内OR、维度间AND保持。

索引不修改严格`CatalogItemV1`、原生工程v6/v3、独立库DB或完整库备份格式；不把补充字段偷塞到既有严格文件。完整备份继续保全确切固定内容与个人整理；只读应用补标不冒充新增已随包持久化内容。匹配不到应用补标的外来条目仍可按其固定与个人信息使用。


<a id="doc-42-新素材精修与小构图"></a>
### 新素材、精修与小构图

沿用本项目可编辑SVG原作与规范化PNG体系，保持原创来源、实际字节/像素/CRC/hash、MIT文本及嵌入声明。源SVG与运行PNG各自保留。新件固定身份按新包语义key创建，精修件为旧catalogId的`.refined`独立族@1，在manifest记录旧catalogId/version/assetSHA与源文件来历，不覆盖旧固定源。

新包首先进入内置素材提供器，经U2显式完整候选采用；旧空白工程原34张图预装策略保持。已有工程不会打开即增加新定义，也不会被自动换成精修版。组合携确切模板、成员源与参数；采用仍完整校验字节/许可/依赖并遵守256实际展开预算，取消/基线变化保留当前工程。

墓地与火山小构图保存真实可编辑TerrainArea、Path、Prop、Prefab等实体，不使用整张背景图代替可编辑内容。熔岩图片本身不定义危险、阻挡、移动代价或高程；火山小样另有明确危险Region及必要连接，标签也不授予通行。所有新增几何为整数毫米，支撑明确，玩家过滤沿既有实现。


<a id="doc-42-m1-d续批的判定边界"></a>
### M1-D续批的判定边界

固定阶段创作由实际当前场景派生步骤状态，逐阶段列明坐标、对象/关系、依赖与预览范围，再经同一工作区普通命令候选采用/撤销/保存。资源缺失、坐标冲突、锁或不兼容状态阻止相应阶段，不能把部分成功写入再继续。阶段菜单只显示工作流状态，不添加工程内的隐藏向导进度或绕过真实实体检查。

C4-N02提示比较新固定源的默认图像范围、当前图像映射及物理占地，明确换图保持当前占地/阻挡。外观预览不暗改尺寸、支撑、通行或私密性；扩大真实占地仍需独立显式事务和全部校验。没有新增通用寻路、持久建筑身份或任意拓扑恢复。

实际素材台账在15登记，路线归07，43记录本批实际制作、前后图、小构图/普通创作检查和未运行矩阵；本文件本身不构成产品验收。


<a id="doc-43"></a>

<a id="doc-43-内容补标题材小样精修与m1-d续批记录"></a>
## 内容补标、题材小样、精修与M1-D续批记录

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](m2-project-validation.md#doc-46-7-按用户要求执行清理)。

2026-10-23；本地版本`0.2.0-m1-d2`。用户授权“既有素材补标＋墓地小样＋火山小样”，完成后精修旧素材，再开始M1-D完整续批；六项精修由实现方选择。范围与只读补标合同见[42](#doc-42)。本批完成需求实现与下述简单检查，**完整回归仍等用户通知**；未自动commit/push，不据本批关闭完整M1、P3或C5/性能门。


<a id="doc-43-实际内容与入口"></a>
### 实际内容与入口

| 内容 | 实际交付 | 入口 / 边界 |
|---|---|---|
| 既有补标 | 原37项及全部62项提供场景/用途/材质与人工多色，只读精确身份索引 | 内置/本工程/已安装的相同固定身份可匹配；不改原发布者tags、个人整理、工程或库备份 |
| 墓地 | 5图：苔石、墓土、墓碑顶盖、石棺、铁栏；纪念小组及20×16m工程 | 首页“苔石墓园”，先检查再保存独立副本；四组纪念组合、步道、围栏和植被均真实可编辑 |
| 火山 | 5图：玄武岩、火山灰、熔岩冷壳、岩块、裂隙；岩缝组合及20×16m工程 | 首页“灰烬熔脉”；1m高台、四来源崖边、显式坡道，熔岩材质与独立危险Region分别保存 |
| 旧素材精修 | 阔叶树冠、圆叶灌丛、灰绿碎石簇、草地、裸岩、细砂六项新`.refined@1`族 | 搜索“精修”查看原件/新版真实图片并分别采用；保留全部原物理字段与确切旧来源 |
| 室内补件 | 衣架、长凳、炉台、操作桌、边柜、床、衣柜七件真实俯视物件 | 支持SCN-01基础布景；缺失时走普通完整目录候选，未使用椅子等占位冒充 |
| M1-D阶段制作 | SCN-01/04从空白逐步预览/确认/采用普通有限命令 | 左侧“工程”→“分步制作 SCN-01 / SCN-04”；状态来自当前真实内容，已有部分/不同基线或锁明确阻止覆盖 |
| C4-N02 | 新源图像、保留的实例映射、旋转范围及占地差异提示 | 选中物件的“外观变体”→“预览外观替换”；草稿接会话守卫，采用仍保留物理/支撑/阻挡/私密字段 |

本批新23图为8材质、15透明物件，均有原创SVG、实际PNG、项目MIT、像素/字节/透明边界及双SHA记录。全内置目录为**62项：38物件、19材质、5组合；57张PNG，合计1,629,765字节**。原空白工厂仍37项/34张PNG，不会打开旧工程即加图或替换实例。新增23张PNG合计1,079,491字节；完整清单与尺寸见[15](../14-visual-and-assets.md#doc-15)及[manifest](../../assets/sceneweave-handdrawn-content/manifest.json)。

源图采用既有可编辑SVG→Chrome栅格化管线，未调用图像生成服务，M2模型尚未接入。新增与精修均是**O/P2候选**；用户P3视觉签收另记，当前内置是开发候选目录。


<a id="doc-43-可审阅画面"></a>
### 可审阅画面

- 新件与室内补件总览（原附件已清理，旧路径：`docs/evidence/content-m1d/art-contact.png`）
- 六项旧版／精修前后对照（原附件已清理，旧路径：`docs/evidence/content-m1d/art-comparison.png`）
- 八种材质3×3拼接（原附件已清理，旧路径：`docs/evidence/content-m1d/art-tiles.png`）
- 墓园实际编辑器（原附件已清理，旧路径：`docs/evidence/content-m1d/graveyard.png`）、火山实际编辑器（原附件已清理，旧路径：`docs/evidence/content-m1d/volcano.png`）
- 雾灯宅从空白完成基础布景（原附件已清理，旧路径：`docs/evidence/content-m1d/scn-01.png`）、海岸哨所从空白完成阶段制作（原附件已清理，旧路径：`docs/evidence/content-m1d/scn-04.png`）
- 正常生产页面中的原件/精修实图对照（原附件已清理，旧路径：`docs/evidence/content-m1d/production/production-comparison.png`）

主代理实际查看了新件总览、精修前后、3×3纹理以及上述小样/普通制作/生产截图。首轮树冠/灌木叶群过粗、碎石过圆与熔岩网格过强已返工：树冠约40叶群、灌木23叶群；碎石恢复角状分面与碎片，熔岩调整为暗缝局部余热，衣架改俯视褶皱。这里只确认本批可用候选，不代签完整画风/P3。


<a id="doc-43-格式完整性与保全"></a>
### 格式、完整性与保全

工程继续严格v6/identity3/appearance1与有效v3，个人库v1和完整库备份不演进。新只读curation v1精确绑定完整`CatalogItem.identity.key`，没有名称或近似ID回退；固定tags与补充信息、个人整理在UI分开。索引62条、24,135字节，SHA-256为`ef044377ab8de9c4ecedf2a089926f73bdc3581ad6578857d8be8ea5d1660081`。目录详情显式打开后即加载对照图；普通列表仍懒加载并回收Blob URL。

实际CRC/PNG-SVG SHA/sRGB/RGBA8、透明RGB=0、alpha尺寸及两处manifest/MIT一致性见美术审计（原附件已清理，旧路径：`docs/evidence/content-m1d/art-audit.json`）。15物件透明留白最小22px；8材质全不透明。相同Chrome再次生成23个SVG与23个PNG的SHA均一致，见复现记录（原附件已清理，旧路径：`docs/evidence/content-m1d/art-repro.json`）。单份新PNG解码尺寸合计28,213,248字节只是尺寸计算，未测内存峰值。

六项精修逐字段保持旧版像素、逻辑/视觉尺寸、占地与偏移、阻挡、渲染和阴影类别；manifest记录旧catalogId/version/assetSHA。新素材只追加到内置提供器，实际采用仍走完整资源/许可闭包、有限预算与当前基线检查。组合保存确切成员源与模板私密性；未自动安装或自动替换当前场景。

SCN辅助只生成普通命令，建筑/室外预览沿用真实影响与跨层确认，组件/目录/显示沿既有候选；采用、撤销、保存、锁/依赖、256展开预算、保护恢复与CAS边界保持。进度不写工程字段，匹配不到真实基线时停止，不把样板加载或文档替换计作从空白创作。C2持久建筑身份、任意拓扑恢复及通用寻路没有在本批提供。

起始HEAD为`e749faba64ab2b6d15b1db6c25caa50d60a061ce`。旧资产/运行图片、既有证据、13/17–41历史报告与用户todo共1303份文件保持起始hash，见保全核对（原附件已清理，旧路径：`docs/evidence/content-m1d/preservation.json`）。本轮未清理旧数据或改写Git历史。 应用源码、包版本/锁文件与本批工具/测试hash见源码指纹（原附件已清理，旧路径：`docs/evidence/content-m1d/source-fingerprint.json`），最终链接/附件/差异核对见交付检查（原附件已清理，旧路径：`docs/evidence/content-m1d/delivery-checks.json`）。


<a id="doc-43-实际简单检查"></a>
### 实际简单检查

| 检查 | 实际结果 | 证据及限制 |
|---|---|---|
| 素材/curation/查询定向 | 3文件11/11，1.12s | 目录检查报告（原附件已清理，旧路径：`docs/evidence/content-m1d/catalog-checks.json`）；代理实际工具输出摘要，原stdout未另存。单元资源解码用明确的头/尺寸替身，实际解码另有真实Chrome生成器 |
| SCN阶段/换图领域定向 | 2文件7/7，6.57s | 工作流检查报告（原附件已清理，旧路径：`docs/evidence/content-m1d/workflow-checks.json`）；空资源包装只验证普通命令、几何/玩家投影和门前净空，不冒充图片IO |
| 小样领域定向 | 1文件2/2，956ms | 实际日志（原附件已清理，旧路径：`docs/evidence/content-m1d/samples-unit-final.log`）；真实几何/组合/危险与视觉分离，未在该纯测试中解码图片 |
| 会话守卫定向 | 1文件30/30，143ms | 实际日志（原附件已清理，旧路径：`docs/evidence/content-m1d/session-guard-unit.log`），含换图草稿 |
| 内置索引生成 | 真实Chrome完整57图字节/hash/许可/原生解码通过，2.726s | 生成器报告（原附件已清理，旧路径：`docs/evidence/content-m1d/catalog-checks.json`）；62条确切身份来自实际完整提供器 |
| 最终类型检查 | exit0 | 实际日志（原附件已清理，旧路径：`docs/evidence/content-m1d/typecheck-final.log`） |
| 正常生产构建 | 通过，Vite构建2.84s | 实际日志（原附件已清理，旧路径：`docs/evidence/content-m1d/build-final.log`）；保留chunk体积提示，本批未做性能专项 |
| 修正后真实Chrome功能流程 | **5/5，79.865s，0失败/重试/跳过，1 worker** | 紧凑报告（原附件已清理，旧路径：`docs/evidence/content-m1d/browser-corrected/report.json`）与日志（原附件已清理，旧路径：`docs/evidence/content-m1d/browser-corrected.log`）；隔离新上下文，实际UI操作，DEV仅观察状态/已存文档 |
| 正常生产简单检查 | 通过，3.733s，0页面异常 | 实际结果（原附件已清理，旧路径：`docs/evidence/content-m1d/production/result.json`）；Home检查/保存墓园、真实原件与精修图，所查DEV/性能属性不存在；没有DEV写入 |

上述单元合计是**7文件分批50项**，没有运行全量单元或全量浏览器回归。Chrome正常生产UA为`HeadlessChrome/156.0.0.0`；不把旧批其他Chrome版本的结果继承到本版。

五个浏览器流程实际覆盖：两个小样检查后完整保存、普通旋转/持久化/撤销；空白仍34图，浏览补标/对照不改工程，显式候选前不写入，采用精修后35图；选中精修树换成尺寸不同源时提示比例、Home受草稿守卫保护，预览不改工程，采用保留物理/私密字段；两个SCN从真实空白逐步完成后与原生保存文档一致。

SCN-01引导共14个状态，初始显示设置已匹配，实际执行13个普通阶段，加一次七件室内素材候选，最终r14：7房、9门、3窗、19物件、2固定组合、3GM线索。SCN-04引导共21状态，实际执行20个阶段，最终r20：2房/7墙/2开口、3地形、9来源边、1道路/1台阶、2组合、3散布及28实际物件。没有通过多次空事务凑步骤，也没有载入样板替换当前文档。

本批复现命令以[测试源码](../../tests/content-m1d-simple.spec.ts)与[正常生产脚本](../../tools/testing/content-production-smoke.mjs)为准：

```sh
npm run typecheck
npm run build
SCENEWEAVE_BROWSER_CHANNEL=chrome SCENEWEAVE_EVIDENCE_DIR=work/content-20261023/browser-corrected npx playwright test tests/content-m1d-simple.spec.ts --reporter=line,./tools/testing/compact-reporter.mjs
SCENEWEAVE_BROWSER_CHANNEL=chrome SCENEWEAVE_EVIDENCE_DIR=work/content-20261023/production node tools/testing/content-production-smoke.mjs
```


<a id="doc-43-首轮失败与修正"></a>
### 首轮失败与修正

1. 初始铁栏默认图像矩形包含半毫米字段，定向检查拒绝；修生成器为640×256px、2500×1000mm，重新生成/校验后通过。没有在运行时取整绕过严格合同。
2. 工作流测试曾把严格v3场景交给v2几何函数，类型检查拒绝；改用显式`geometryDocumentForValidationV3`视图，未做类型断言或降级保存。
3. 第一轮五项浏览器流程仅火山通过，4失败，记录见原结果（原附件已清理，旧路径：`docs/evidence/content-m1d/browser-initial/report.json`）。墓园树冠靠边导致25°旋转越界，整笔拒绝后工程保持；将初始树冠内移留出旋转余量。对照图位于裁剪面板下方，原懒加载不触发，改显式详情按需立即加载，普通列表保持懒加载。
4. 第一轮SCN-01期间本批仍在改Vite载入模块，出现开发会话重置与步骤等待超时，该次不算有效SCN完成证据；修正轮先冻结产品源码再串行执行。SCN-04的测试助手曾在异步候选尚未出现时检查确认框，漏点确认导致采用禁用；改为等候选按钮出现后再确认。没有移除真实确认门槛。修正轮5/5通过。

文档保留原结果索引、JSON/PNG及摘要；首轮原trace ZIP仍在`work/content-20261023/browser-initial`，报告记录确切SHA/字节，不声称ZIP已归档到文档。原13/17–41证据保持原样。


<a id="doc-43-仍待与后续入口"></a>
### 仍待与后续入口

本批完成补标、两题材小样、六精修与M1-D基础阶段制作功能，尚不关闭无引导手工SCN-01/04、所有固定交互/通行输入、跨新内容的完整工程/所选历史离线往返与恢复/失败/CAS矩阵、双受众4K/秘密对照、窄屏/键盘/跨浏览器联合和真实小团。上述完整回归待用户通知后统一运行；旧35/41结果不能直接充当本版通过。

P3/参考效果仍需用户看实际图与地图签收，自动化只确认所列技术与简单使用。余下性能按[34](../reference/performance.md#doc-34)暂缓，C5与QA-PERF-01/04未通过。下一步收集本批素材/制作流程反馈并整理M1-D剩余验收输入；M2仍依路线中的固定源、明确范围、候选采用和部分恢复合同推进单件生成/同化准备，不在本轮接入模型。


<a id="doc-44"></a>

<a id="doc-44-020-m1-d2-全量自动化回归"></a>
## 0.2.0-m1-d2 全量自动化回归

> 资料状态（2026-10-23后续清理）：用户已明确要求删除`work/`与`docs/evidence/`原始附件。本报告保留当时的结果、失败和限制；文内旧路径是历史记录，不再提供对应附件。必要测试夹具已独立保留，详见[清理记录](m2-project-validation.md#doc-46-7-按用户要求执行清理)。

2026-10-23，用户明确要求“全量回归”，启动此前38/39/41/43后置的自动化检查。当前功能版本保持`0.2.0-m1-d2`，起始HEAD为`e749faba64ab2b6d15b1db6c25caa50d60a061ce`，包含上一批未提交素材与功能。本轮不开发M2、不自动commit/push、不执行34中暂缓的正式性能专项。

**全量单元1123/1123通过；完整Chrome套件203项全部执行，首轮200通过、3个旧测试合同失败，修正后相关三个文件14/14通过；203个不同用例均已有通过结果，无未解决自动化失败。** 这是一次全量执行加相关文件复验，未声称重新完整执行了一轮203/203。两批间产品`src`字节保持一致，变更仅为测试/检查工具、报告及交接。


<a id="doc-44-环境与范围"></a>
### 环境与范围

- macOS26.6.2、arm64；Node24.14.1、npm11.11.0。
- Vitest4.1.12、Playwright1.56.1、系统Chrome156.0.8078.47；浏览器1 worker，配置重试0。
- 实际环境（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/environment.json`）、依赖核对（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/dependencies.log`）、203项/47文件列表（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/browser-tests.list`）、范围说明（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/scope.json`）。

完整套件覆盖M0至C5、M1-D哨所、U1首页/统一会话/兼容入口、U1b布局、U2目录组织/采用/备份，以及内容补标、两题材小样、精修与SCN阶段制作。沿用独立浏览器上下文及原创/合成夹具，不使用真实用户工程。既有M0的500/2000程序物件负载用例保留在浏览器套件中，其观察不替代C5正式性能矩阵。


<a id="doc-44-实际结果"></a>
### 实际结果

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


<a id="doc-44-首轮失败与测试修正"></a>
### 首轮失败与测试修正

本轮没有修改产品实现或放松领域/隐私/依赖/CAS门槛。所有原失败结果保留；修正针对当前已定交互及有效等待。

1. **旧素材工坊完整包含断言。** 显示完整校验报告后视口收缩，U1b保持实际像素比例，地图允许被裁剪；旧测试仍期待自动适应全图。现在明确点击“适应全图”，等待zoom1/pan0与绘制帧，再对实际viewport检查地图四边完整包含，并保留非平坦实际纹理检查。
2. **C0候选和窗口缩放的相对zoom断言。** 保存的trace显示候选前后实际地图均1053.5×752.5px、pan(-40,0)，候选栏占64px后图像Y补偿32px，相对fit倍率1.25→1.3986988847583641。当前合同保持世界中心与实际px/mm，测试改测实际地图尺寸及归一pan；窗口改变同样检查，随后明确按0验证全图。候选取消后的原视口恢复、8/.25上下限、受众/工程切换重置及4K像素断言均保留。
3. **旧VIS-01换图直接提交预期。** 当前兼容工坊选择后先形成可取消候选，旧测试立即读取已提交文档。现在明确检查预览前后工程不变、取消保留原件，再重新选择并采用，继续检查占地/字段、组合拆分、undo/redo及持久重开。

回归前还修正了两处U1a统一工作区旧“场景”tab定位为右下“对象”，M0负载用例显式进入`#geometry`；保留兼容工坊的旧“场景”和34图空白断言。正常生产U1工具同样更新对象导航，并发现点击放大后过早采样旧倍率1，而实际已1.25；补等待真实倍率改变后，Home继续与重开检查通过。其首轮生产失败（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/production-u1a-initial/report.json`）独立保留。诊断记录（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/audit-notes.json`）列出轨迹证据和覆盖边界。


<a id="doc-44-新增u2真实浏览器回归"></a>
### 新增U2真实浏览器回归

原41只有公开单图的简单旅程。本轮新增两项有实际执行证据的用例，均在完整203项中通过：

- **真实派生及私密固定组合跨库。** Chrome实际Canvas源图→0.5亮度派生→至少两层固定源与GM模板→完整库备份；新浏览器上下文的空库离线恢复，采用真实固定闭包。缺合法遮罩时普通Workspace候选拒绝且当前工程/undo保持；有遮罩时放置保留GM成员，撤销/重做与原生重开保持。实际4096×4096输出中，放置前/后玩家RGBA hash相同，GM输出改变，PNG无文本/EXIF/时间元数据；源/派生字节和许可实际SHA、8×8像素值分别核对。该原创像素夹具验证机制，不代替P2/P3美术。
- **两页个人整理CAS。** 同一站点两个实际页面编辑不同确切素材；先保存者生效，旧库revision提交被拒绝，草稿保留；刷新只更新基线，明确再保存后两条记录及两工程/undo都保持。

完整实际JSON/PNG见首轮报告中的`u2-private-library-offline-4k.json`、`u2-private-restored-{gm,player}-4k.png`与`u2-two-page-cas-draft.json`附件。离线前先载入模块，不是空缓存PWA冷启动或真实配额耗尽。


<a id="doc-44-旧待验项复验与视觉检查"></a>
### 旧待验项复验与视觉检查

38中C5首条冷启动、legacy采用后无残留卸载提示、兼容离开等待真实保存成功/模拟拒绝后的输入屏障与分支保留，本轮均由对应实际浏览器用例通过。U1全部首页/发现/副本升级、真实C2 witness寿命、导航/迟到结果及原生CAS用例通过；U1b两条桌面/触摸布局、偏好和焦点流程通过。新内容、两小样、精修对照和SCN-01/04普通阶段制作5项均通过。

390px整页截图在本轮一张正常、一张出现重复拼接，不能只凭功能断言通过关闭视觉问题。独立正常生产诊断记录DOM始终只有1份home/header/h1和5张样板卡；实际scrollY为0/650/1040时页眉位置0/−650/−1040，中部（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/home-capture-audit/viewport-middle.png`）/底部（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/home-capture-audit/viewport-bottom.png`）真实viewport截图连续正常，页面宽390、根高度1884，无横向溢出。截图工具增加resize后的字体/双帧等待，主代理实际查看的最终整页图（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/production-u1a-final/home-390.png`）正常。只读像素核对发现异常旧图在y775/1532精确重复顶部logo，最终图与独立诊断全图无重复，见诊断观察（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/home-capture-audit/observations.json`）/像素分析（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/home-capture-analysis.json`）。证据支持捕获时序/拼接问题的推断，未确认Chrome内部根因，也不保证所有整页捕获永不异常；异常原图仍保留。产品页面未为截图作改写。最终桌面重开画面（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/production-u1a-final/workspace-reopened-desktop.png`）与正常生产精修对照（原附件已清理，旧路径：`docs/evidence/full-regression-20261023/production-content/production-comparison.png`）另存。


<a id="doc-44-保全复现与仍待"></a>
### 保全、复现与仍待

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

<a id="visual-production-handoffs"></a>
## 视觉制作与目录交接原文（原14/15的历史追加段）

以下为2026-10-29文档整理时迁入的既有原文。日期、当批状态、授权、测试数字和未通过项仅属于原冻结；迁移没有重新运行检查，不作为当前执行入口或新验收结果。

<a id="doc-14-9-实施顺序"></a>
### 9. 实施顺序

M1-A历史批次交付本文数值规范、15制作台账，以及04/06契约与迁移/输出规则，当时不产出代码或正式图片。后续B1实现新格式基础，B2制作室内P2候选并搭建可编辑VIS-01；B3室外可编辑样板与首轮检查见19，B4三组48格隐私/完整存档矩阵见[20](m0-m1-validation.md#doc-20)，B5真实负载/资源观测、候选比较及缺证据见[21](m0-m1-validation.md#doc-21)。M1-B可使用聚焦样板的受控编辑入口，不要求完整笔刷/工具库；烘焙成图或只可拖整图的演示不能代替可编辑样板。有限负载观测不等于最终画面、完整M1-B或全交互性能验收。

M1-C在C0基础上已实现空白放置闭环（C1a）、框选与右键（C1b）、图层（C1c）、命名快照与独立物件局部恢复（C1d），C2补建筑工具与有限同会话结构恢复。C3组件库、固定参数派生、非破坏外观及有限组合/人工覆盖恢复见[29](m0-m1-validation.md#doc-29)，C4室外与连续身份/散布有限恢复见[31](m0-m1-validation.md#doc-31)，C5联合功能与未通过的性能门见32/33。2026-10-23按用户安排暂缓余下性能专项，保留未通过结论与[34后续入口](../reference/performance.md#doc-34)，继续其他需求。M1-D本批提供海岸哨所原创追加包、补给组合与可编辑混合场景候选，联合验收结果归35；完整雾灯宅与M1验收仍需各自证据。M2按07/45的新顺序先统一v1/共享核心，再后端、草稿、场景工具和SVG/渐进同化；旧可选M2-L并入主线，生图API首版排除。

上述规范不自行授予功能通过状态，P2素材保持P2；技术检查不替代用户对参考效果的签收。C0至C4各批适用结果见22–29/31，C5见32/33，当前滚动计划见[07](../07-roadmap.md)，每周10小时只是投入假设，按每个切片的实际投入、返工和素材供给校准；不虚构已发生工时或承诺日历。对应原视觉需求PRD-021—028及新增编辑/渐进同化需求，质量证据归[09](../09-quality-plan.md)，既有批次与原始证据独立保留，不因新增P2资源、候选混合场景或性能后置安排而将完整主题P3、SCN-01/04、QA-PERF-01/04或完整M1标为通过。


<a id="doc-14-c3-素材采用与视觉证据边界"></a>
#### C3 素材采用与视觉证据边界

历史C3组件工坊使用独立v5完整信封：实际固定源、参数派生PNG、来源/许可和逐项覆盖随当前/所选历史完整包往返。真实sRGB调色/亮度保留alpha，完整验证会按源及参数检查输出像素。物件透明度0–1；表面底材须不透明；主题阴影分类不替换固定源自定义阴影。参数不等于完整美术换风格，C3当批不提升既有P2台账、不签收P3，也未接入M2模型。实际图片/离线/双受众及有限恢复历史证据归29，C4/C5归31–33；哨所混合布景归35；当前M2素材流程另见05。


<a id="doc-14-10-u1u2-准备素材组织与题材小样计划未实现"></a>
### 10. U1/U2 准备：素材组织与题材小样（历史合同）

本节保留PRD-034—037在准备阶段的合同：统一会话中浏览资源，素材详情不抢走场景选区；目录范围、个人标签/颜色/收藏及备份独立维护。讨论和原切片顺序见[36](#doc-36)、[37](#doc-37)。U1/U2后续已实现，数据与存储合同归04/06，实际结果归[工作区历史台账]()，当前排期归[07](../07-roadmap.md)。以下“计划”只描述准备时点。


<a id="doc-14-101-面向创作的分类与显示"></a>
#### 10.1 面向创作的分类与显示

内置素材、我的素材、本工程共用检索语义，但各自的范围和来源必须可见。列表计划提供实际图片缩略图、名称、尺寸和固定版本，详情区分图像视觉范围与物理占地，并能查看来源/许可；不能仅因缩略图可见就标为已安装、可离线采用或许可完整。保全定义和内部生产元数据不变成普通可编辑素材条目。

| 维度 | 推荐用法与边界 |
|---|---|
| 类型、场景、用途 | 物件/材质/组合，以及室内/室外/墓地/火山、照明/储物/植被等可读分类；一件可有多个标签 |
| 材质与状态 | 木/石/金属、破损/废弃等作为整理提示，不改实际MaterialRef或实体业务属性 |
| 自由标签 | 允许中文与普通自由文本；推荐词不构成封闭词表，匹配规范化同时保留显示用字 |
| 颜色 | 首批人工确认的多色描述，色块始终有文字；描述确切固定源/变体，不冒充场景覆盖后的有效颜色 |
| 收藏 | 个人组织偏好，独立于发布者标签和工程采用；取消收藏不删除定义或资源 |

同维度多个条件取任一，跨维度取交集，自由标签显式选择全部/任一；条件可见、可单独移除或清空。标签和色块须支持键盘操作，不能只靠颜色传达命中或选中。首批不实现算法自动取色；后续取色候选需考虑可见像素并允许人工纠正，透明留白和阴影不能主导结果。场景有效颜色筛选与实例标签另属后续范围，给一个实例标“线索”不能使全库同类素材共享该说明。

现有固定定义的tags仍属于不可变内容。个人补充关联确切固定来源，独立保存、备份，不直接改定义；发布者调整默认标签须发布新固定版本，已采用工程不随目录更新。制作状态、内部保全标记和个人自由标签分开显示/维护，个人整理不修改P0—P3或许可。完整库备份与可选仅组织清单的区别、采用闭包和删除保护由06定义；个人全库组织不自动随工程分享。目录名称、缩略图、组织与完整库备份均属GM编辑数据，不进入玩家图片；浏览本工程也不自动推广到个人库。标签、颜色或收藏均不改变占地、支撑、危险、阻挡或秘密。


<a id="doc-14-102-先补标再以小样验证题材"></a>
#### 10.2 先补标，再以小样验证题材

准备之后按U1a统一发现/当前会话→U1b稳定面板→U2a合同冻结→U2b目录组织与采用推进。U1稳定后可并行准备U2与题材小样，大规模入库须等目录合同；内容顺序为既有素材补标→墓地小样→火山小样，再用于M1-D剩余完整旅程，M2沿用同一固定来源与采用流程。本次未启动这些实现或制作切片。

既有室内、室外和哨所P2素材先整理面向使用者的场景/用途/材质状态/颜色候选标注，核对缩略图、真实尺寸、锚点、占地与来源。墓地小样用于检查墓碑/石棺等物件、围栏/装饰与可编辑小组合的比例和检索；火山小样再检查玄武岩/火山灰/熔岩等材质、岩块/裂隙装饰与地形构图。例子表达制作方向，数量、目录身份、固定版本、真实尺寸/占地和来源许可须在各自制作切片逐项确定，当前不预造台账或测量。

每个真实小样继续交付可追溯源文件、规范化实际图片、确切许可、尺寸/占地及可编辑成员；先评小构图与检索使用，再决定扩充。熔岩画面与危险区、移动代价及通行分别显式设置，不能由纹理或“火山”标签自动推导。原有P2和哨所六张图片保持P2；补标签、增加数量或自动测试通过均不构成P3及用户美术签收。

计划验收归[09](../09-quality-plan.md)：QA-CAT-01范围/筛选、02个人组织与固定身份隔离、03完整采用及离线、04备份/导入、05缺资源/许可/删除保护、06颜色/缩略图/可访问性与视觉区分；统一浏览的选区和会话连续性另由QA-WS验证。本次没有运行这些产品检查，也不改写35及更早的视觉/性能证据。逐项实际生产记录继续归[15](../14-visual-and-assets.md#doc-15)。


<a id="doc-14-u2au2b2026-10-23"></a>
#### U2a/U2b（2026-10-23）

U2现已实现三库的固定源实图、人工文字多色和个人标签/收藏；目录固定源与场景实例/图层覆盖后的有效颜色明确分开。新增颜色来自人工12色选择，未提供自动提色。发布者标签只读、内部保全字段隐藏；当前素材数量/美术质量未因目录功能升级，P2/P3状态不变。固定素材跨工程采用和完整库闭包按[40](#doc-40)，本批简单检查见[41](#doc-41)。既有补标、墓地小样、火山小样为后续入口，本批未制作新素材。


<a id="doc-14-2026-10-23内容批次"></a>
#### 2026-10-23内容批次

以上U1/U2准备保留当时状态，U1/U2已实现并见38–41；本轮已制作墓地5件、火山5件、自然精修6件及室内补件7件，均为原创O/P2候选。真实源、尺寸/透明与许可登记[15](../14-visual-and-assets.md#doc-15)，对照与实际小样检查见[43](#doc-43)。新23件由原生可编辑SVG制作，未调用图像生成服务；六精修保留旧源和全部物理字段。内置提供器是当前开发候选目录，P3与默认正式发行签收仍单列。

树冠/灌丛以更细的不规则叶群增强层次，碎石保留角状分面；草岩砂增加低对比细节，避免夺走场景主体。墓碑按俯视顶盖/基座绘制，熔岩为冷壳暗缝中的局部余热；图像不授予危险/通行。小构图含独立可编辑实体，继续按实际视觉反馈精修，不因数量、标签或自动检查升级P3。


<a id="doc-14-115-参考图质量提升与精修素材入口"></a>
#### 11.5 参考图质量提升与精修素材入口

后续M2-Q0–Q5见[54](../14-visual-and-assets.md#visual-quality)：先固定风格卡和审阅近景，以双层岩岛形成第一份精修标杆，再扩展海岸与多房间室内。重点是自然大轮廓、既有材质覆盖、崖面收口/明暗、独立形状变体与按用途布景；现有曲线/光雾/滤镜继续复用。开发复核记录构图、贴边、层次、尺度、疏密和可编辑性，用户P3单独签收。

新素材使用独立固定版本；新采样/渲染算法或持续材质绑定需先定严格版本与原工程保全，不能重释旧参数。Q0/Q1未新增严格字段或改采样/渲染算法；独立13素材及精修岩岛、实际中性/效果四框、离线双受众4K和开发复核见[54第10节](visual-quality-validation.md#doc-54-10-q0q1实际实施与交付2026-10-26)。规则崖分格/简洁踏面仍为视觉审阅项，O/P2不自动升级P3。

Q2另制15项海岸素材与23项室内素材，分别形成「潮痕浅湾 · 精修版」和「灯下旅舍 · 精修版」可编辑作品；实际固定版本、尺寸/占地/许可清单归[15](../14-visual-and-assets.md#doc-15-q2海岸与室内精修制作2026-10-26)，成图、往返和适用检查归[54第11节](visual-quality-validation.md#doc-54-11-q2素材作品与同源空白实际交付2026-10-26)。海岸的干湿沙/浅深水使用既有共享曲线、边带与4个显式覆盖；这4个覆盖不持续绑定岸线，后续任意改岸须单独审阅覆盖。室内以实际家具区分五处用途，保留五个固定组合及可编辑成员，门前后按旋转物理占地检查净空。没有暗改旧24件源或通用边带算法。

同一「新建空白场景」对话框的「原创素材组」现可选择通用视觉24项、岬湾苔岛13项、潮痕浅湾15项或灯下旅舍23项。精修空白复用对应样板的固定源、许可和实际PNG物化流程，只复制固定定义；室内固定组合模板可供新建，但没有实际组合成员。新工程没有房间、地形、物件、曲线或效果，环境中性，也不复制样板历史/人工记录。准备、资源校验和保存成功后才切换；取消保留当前工程。三精修作品仍从工程页独立审阅、保存副本，不能用样板实体复制冒充AI从空白制作。旧62项/57图目录与旧24项集合保持；新增入口、技术检查和开发目视不替代用户P3或09的完整QA-VIS-09至14。



<a id="doc-14-12-t0t1地形生成的视觉边界2026-10-26"></a>
### 12. T0/T1地形生成的视觉边界（2026-10-26）

用户在[55](../reference/terrain-generation.md)确认的最终方向是：场景地面保持准确正交俯视，树木略露侧面；区域地图使用竖直的正面树木、山形和地标符号。地面比例、物理占地、树根锚点、图像范围和遮挡分别定义。该方向按T4/T5实现，当前T0/T1仍使用54的俯视树石和地表材质，没有把旧树冠旋转或拉伸为近侧视新素材。

岩岛/海岸生成界面默认24×18m，每次一个候选，提供五个固定种子逐份比较。首轮以同源材质、中性环境、实际地形和登高连接审阅构图；地形大轮廓、偏置高台、活动空地及树石分布形成差别，不依靠雾、暗角或调色遮住几何问题。每份应保留全景和一致取景的近景，不能只展示最好的一张。

完整v3的visual2保留既有visual1语义，并严格承载可选的物化边缘多边形与笔触。物化结果由保存数据绘制，先过滤私密/来源支撑/隐藏图层，再与既有边带按明确顺序合成；同一边界同一用途不能同时启用新旧边缘造成双画。该支持不表示T1的每个过渡都已升级为持续联动规则。

手工修改岸线或移动树石后，当前完整结果继续可编辑，相关受管字段转人工、规则暂停、检查失效。T2才提供重新计算相关过渡/自动布景的联动候选；T1不通过重绘自行补齐。T0的区域技术向量没有生产级树/山图符或区域生成界面，也不产生场景人物通行证明。

首轮视觉审阅发现高台偏圆，算法已改为弯脊/宽肩并重跑审阅完整十图的全景与近景；仍有崖面分格、局部折面、稀疏布景和简单干湿沙过渡。浏览器流程、确定性和几何预算通过不等同视觉质量通过。本批最终图与检查归55，原素材O/P2状态保持；近侧视素材、区域图符、用户P3及性能目标仍按各自门槛验收。


<a id="doc-14-t3五地貌视觉复用2026-10-26"></a>
#### T3五地貌视觉复用（2026-10-26）

五新配方复用岬湾苔岛固定素材，林地使用苔地，浅滩和道路使用独立实例paint以区分地面；实例染色物化为真实派生PNG，保留原源和许可，不原地修改素材定义。道路与所有坡道入口先保留物理净空，树石随后按支撑/林地及活动区筛选。颜色仅帮助辨识，通行仍由真实支撑/高差/完整净宽核验。曲线与简洁骨架、俯视树冠、4–8物件、重复地表和简化坡道仍有限，不作为T4近侧视或P3签收，结果见55第19节。


### 6. 制作顺序与交接

ART-00至ART-03是素材制作批次，与16中的开发切片B1至B5分别编号；它们描述的依赖和实际进展仍以各自交付证据为准。

| 批次 | 内容 | 进入下一步的证据 |
|---|---|---|
| ART-00 主题校样 | 木板/石板/草岩各一小块，桌椅/树冠各一件，门窗/崖边的主题表现 | 按14近景尺度试放；色板、线宽、旋转和全局投影方向通过人工检查 |
| ART-01 VIS-01包 | §2室内材质、§3.1物件、书桌与露台组合、墙/开口表现 | 真实文件和来源齐全；按08完成可编辑样板、替换/拆分/重开/导出 |
| ART-02 VIS-02包 | 草/岩/崖/沙/浅深水、§3.2物件、岸崖/连接表现 | 实际36件植被/碎石加3礁、人工移动/删除保留、轮廓修改和4K导出证据 |
| ART-03 追加包 | dirt-gravel、§3.3五物件、补给组合及原生Path候选已形成O/P2 | M1-D已提供SCN-04首批可编辑样板；技术实值见§3.4，真实联合结果归35；不追溯为M1-B历史交付 |

每批生产记录需列实际文件、作者/来源、许可/嵌入条件、目录版本、真实hash、PNG像素与解码字节、采用的世界范围/占地、样板引用、评审截图及结果。P0计划行不生成假证明；记录可在后续单独证据目录维护，未通过条目保留失败原因。

M1-A退出检查只确认规范和契约可交接；当时条目均为P0。后续B2的4材质、11物件、2组定义及室内结构表现为P2候选，来源/解码/视觉与工程子项的实际证据见18，B3的6材质/7物件及室外结构表现同为P2候选（见19）。2026-10-23混合追加1材质/5物件与补给固定定义已形成O/P2，SCN-04首批实际联合结果归35。B5技术负载与资源观测归21，完整主题P3、用户美术签收及完整M1仍待验收。M1-B边界、固定取景与艺术检查见14，运行/隐私/性能门槛见09，M1-D当前入口与滚动计划见07；余下性能专项按[34](../reference/performance.md#doc-34)暂缓，不据开发顺序调整推定通过。


<a id="doc-15-7-b5技术负载与m1-c素材交接"></a>
### 7. B5技术负载与M1-C素材交接

B5使用本清单既有真实资源构成VIS-01/02各500/2000实例变体，保留固定定义、组合/散布及许可闭包，不通过重复一张极小图片冒充真实素材。实际hash去重数量/像素、资产实例分布、透明与潜在可见口径、完整工程和双受众4K观测归[21](m0-m1-validation.md#doc-21)。增加实例不是新增独立素材，也不是原样板艺术构图或推荐密度；本表不增加假hash、未制作条目或P3状态。

v2使用原生Canvas2D、M0使用Konva；当前无持久ImageBitmap缓存。渲染/IO现共用原生解码槽，并修复临时画布提前登记所有权；同尺寸paintCanvas重用试验已撤回，三构建比较见21。不从实现形式推定速度、资源收益或完整容量。保护限额仍归06；500为后续工作目标、2000为压力观察，不是2000张独立图或256张/64M像素容量承诺。B5受测时缺少平移/缩放/自由拖动，当时commit与显示代理不含命令准备及面板输入成本，不能据提交子区间低于100ms关闭端到端编辑目标。RSS/JS堆采样不能代替GPU峰值验收；JS堆全程汇总含tooling-audit、下载和idle，产品阶段需从byPhase单列，方法边界见09/21。

M1-C/C0已实现性能与视口基础，输入/命令准备与真实工作台观测见[22](m0-m1-validation.md#doc-22)，未新增或升级任何素材。C1a复用本台账18件既有单件素材提供空白放置闭环，证据见[23](m0-m1-validation.md#doc-23)，没有新增或升级素材。C1b有限选择/批改/菜单复用原素材，适用验证归[24](m0-m1-validation.md#doc-24)，没有新增美术或提升P2签收。后续C1c–d及C2–C5按[07](../07-roadmap.md)调整后的依赖推进；旧W2–W8占位不再适用。C3先提供参数/派生变体，M2再做单件→组合→明确范围渐进同化。单维护者每周10小时是假设，素材处理/返工计入同一预算，没有额外美术人力或承诺日期；逐切片据实际投入校准。技术验证使用的P2仍为P2，完整P3和用户视觉签收独立执行，SCN-04混合验收在M1-D，真实小团在M3。13/17/18/19/20与其原始证据保留历史，不以B5重写。


<a id="doc-15-u1u2-准备交接既有补标与题材小样计划未制作"></a>
### U1/U2 准备交接：既有补标与题材小样（历史准备合同）

本节落实PRD-036/037的素材交接要求，完整安排以[37](#doc-37)及[07](../07-roadmap.md)为准；[36](#doc-36)保留讨论记录。当前三个来源包共34张PNG、23件物件、11种材质、3个固定组合，是既有制作事实；海岸哨所六张图片已包括在其中。当前条目仍为P2，以下计划不增加已制素材数量，不补造hash、尺寸、内存测量或视觉通过记录。

U1统一会话与面板稳定后，U2a须先冻结独立个人目录/组织身份、schema、限额、并发/CAS、安装状态、导入冲突和备份合同，再进入U2b目录界面与采用。小样可在U1后与U2并行准备，大规模入库等待U2a合同；此次授权仅覆盖文档准备，未启动这些制作或实现。

| 顺序 | 计划工作 | 开始实际制作/整理后的交付要求 |
|---|---|---|
| 既有素材补标 | 先为室内、室外、哨所既有条目整理可读场景、用途、材质/状态、人工多色描述与检索示例 | 核对确切固定来源、真实缩略图、尺寸/占地和许可；标明发布者与个人补充，内部VIS/SCN/P2/保全记录不作为用户必须理解的分类 |
| 墓地小样 | 以墓碑/石棺、围栏/装饰及小组合等候选方向检查同画风物件比例与组织 | 在实际切片确定样品名单、目录身份/固定版本、来源许可与真实尺寸；先小构图、可编辑成员和检索，再决定扩充 |
| 火山小样 | 以玄武岩/火山灰/熔岩材质及岩块/裂隙装饰等候选方向检查地形构图 | 同样逐项确定实际数据；材质平铺/边缘、物件范围及组合关系分别检查，熔岩外观不自动设置危险或通行 |

“补标”不允许原地修改已冻结定义的tags。个人标签、颜色与收藏写入U2a定义的独立组织记录，关联确切固定来源；若调整发布者默认元数据，应在后续显式新固定版本发布，并保留旧版工程可重开。本次不修改任何定义、素材或manifest。完整库备份携带所选组织和必需固定闭包；可选仅组织清单必须标明缺资源，不能当作离线完整库。工程只分享已采用闭包，删除目录条目/取消收藏不删除工程或历史保留的源图，主合同归04/06。

实际生产沿用本表既有记录要求：源文件、作者/来源、许可及嵌入条件、固定定义/成员、真实资源hash/像素、透明度或平铺、世界视觉范围/锚点/占地、检索标注和人工评审结果缺一不得虚记完成。数量和尺寸在样品真实形成后登记；当前墓地/火山仅为计划范围，不设伪P1/P2/P3行。人工颜色描述标明对应固定源或变体，不以场景覆盖后的颜色回写全库；视觉标签也不推导游戏规则。

验收分别记录组织可用性与视觉质量：QA-CAT-01—06检验目录范围/搜索、个人组织隔离、完整采用/离线、备份冲突、资源/许可/删除保护、颜色/缩略图可访问性；现有QA-ASSET/VIS检查继续用于真实小样。测试通过不能提升现有P2或代替P3美术签收。本次未运行产品测试、浏览器或构建，未开始数据清理；M1-D剩余完整旅程、M2素材流程和按34暂缓的性能欠项仍分别跟踪。




### 2026-10-26 T0/T1地形候选复用与后续素材计划

T0/T1本批未追加一套近侧视树或区域图符生产包。岩岛生成复用54的「岬湾苔岛」固定素材，海岸生成复用「潮痕浅湾」固定素材；原SVG、规范化源、实际PNG、确切许可、世界尺寸、占地和版本继续完整保留。新工程采用完整v3 / SceneDocument3 / visual2 / identity2 / appearance2，素材固定来源不因工程升级而原地改义。

| 内容 | 本批状态 | 交付归属 |
|---|---|---|
| 岩岛/海岸地形候选 | 默认24×18m，每次一个；五个固定种子逐份生成与比较，实际实体数量和展开成本随候选报告 | T1生成结果，不作为新素材数量重复入账 |
| 既有俯视树石与材质 | 复用54固定资源；检查中性构图、轮廓、过渡和实际可编辑性 | 仍按原O/P2状态，未获新增P3 |
| 近侧视树、岩石及灌草 | 计划；需新固定源、根锚、图像范围、独立物理占地与阴影合同 | T4，当前未制作/开放 |
| 正面树丛、丘陵/山脊与地标图符 | 计划；须使用区域符号定义，不能拿场景Prop占地代替制图尺寸 | T5，当前技术向量不算素材交付 |
| AI制作或自动生图 | 本批无模型生成素材或新生图API | T6只先接共用生成工具，具体素材生产另按明确范围验收 |

最终同次四项Chrome流程通过；高台偏圆问题改进后已重新保留并审阅五岩岛/五海岸全组，不以旧图或选中优图代替复核，规则崖面/局部折面与过渡简单仍如实保留。最终产物与检查见[55](../reference/terrain-generation.md)，不得据技术测试将本批标成最终美术、性能或P3通过。


<a id="doc-15-t3配方素材复用2026-10-26"></a>
#### T3配方素材复用（2026-10-26）

河谷/内湖/森林/丘陵/混合沿用岬湾苔岛13个固定源/素材闭包，没有新增原创素材族或近侧视树。浅滩/道路的颜色仅为工程内独立固定派生位图；每份完整包携带实际派生PNG、父源和许可，按真实hash/像素校验，不作为新增原创素材数量重复入账。使用24×18m、4–8树石/活动区/坡道的有限配方，P3、T4/T5素材生产及正式台账验收仍独立，详55第19节。

<a id="asset-batch-20261031"></a>
### 素材形状变体与批量摄取（2026-10-31 开发自检）

范围为[07分支计划](../07-roadmap.md#branch-plan)第3项；模型与事务合同归[04](../04-scene-document.md#asset-batch-import)、来源/ZIP/保存边界归[06](../06-storage-and-export.md#asset-batch-import)，十二份原创源的确切键、许可、尺寸、占地与根锚归[14固定变体台账](../14-visual-and-assets.md#terrain-variants-v1)。这是开发整改的必要自检，未运行全量Q4、真实模型、正式性能或用户P3，没有提交、推送或部署。

实现复用现有严格工程字段和受限SVG链，不增加容器版本。多文件、文件夹和素材ZIP先收集路径/CRC/来源字节，再只为明确选中项准备完整固定资源候选；普通目录256新增记录/展开预算在准备和公共工作区预览入口分别执行。实际规范PNG去重与完整定义去重分开；不同SVG原文、许可、尺寸和根锚不合并身份。新素材通过独立“地形变体”范围供明确采用，旧固定源和算法1–5不改义，自动簇状布景仍为第5项工作。

#### 定向单元与浏览器检查

`work/asset-batch-20261031/unit-final.log`：7文件99项通过，实际入口为browser `assets/batch-source`、shared `project-file`、application `asset-batch/prepare/workspace-catalog-budget/workspace`及browser `terrain-variant-catalog`。覆盖ZIP默认严格合同、空目录/单文件归档、路径/CRC/展开保护、同步独立捕获/取消、坏SVG/坏图/许可/去重、根锚字段、单图回归与一次事务。新增公共入口用例直接构造并完整验证258条新增记录，绕过批量准备函数，仍被`previewPrepared`拒绝；当前对象/checkpoint/冷存档/撤销保持，先前合法候选继续可用。单元素材端口不等于真实画面证据。

真实Chromium从正常Vite开发入口运行`asset-batch.spec.ts`、`terrain-variants.spec.ts`和既有`u2-catalog.spec.ts`，未调用模型。最终同次5项全部通过，结果和JSON/PNG/完整包归`work/asset-batch-20261031/browser-verified.log`与`browser-verified/`；本轮覆盖以下事实：

| 入口 | 实际输入与检查 |
|---|---|
| 批量素材UI | 含显式目录、PNG/JPEG/WebP、重复PNG、合法SVG、外链image非法SVG及LICENSE sidecar的真实ZIP。六项预览整批拒绝且主工程hash保持；明确取消非法项后五项规范PNG实际解码。取消预览保留列表并撤销缩略图URL，重新预览后一次采用，revision只增加1、不创建场景实例；独立SVG许可和1200×900mm图像/1000×1000mm占地/左上角根锚(350,800)保持。 |
| 来源与保存 | 人工加入PNG的`tEXt`不进入规范PNG，采用图片只含IHDR/sRGB/IDAT/IEND；原始SVG字节逐字保全。完整工程包回读和仓库冷读与当前完整内容hash一致，五件素材库载体/备份回读保持；一次撤销移除全部新增定义，一次重做恢复。真实文件夹只收图片、跳过LICENSE；路径穿越ZIP拒绝，空错误批次可在本表单清空；外链请求数为0。 |
| 十二个原创形状 | 三树/三岩/两灌丛/两草缘/两碎石，各实际PNG透明像素与有效像素分别大于10%和5%，十二个alpha hash均不同。真实原始SVG、PNG/许可与八个固定近侧视presentation经过工程采用/冷读/完整包保持；十二件备份在独立空IndexedDB素材库安装并逐条冷读完整载体。 |
| 版本与原子性 | 旧完整工程选中十二件时因近侧视根锚整组拒绝，选择保持；明确只选四件俯视地表素材可以一次采用/撤销。完整v3工程十二件一次采用、一次撤销/重做，不静默过滤八件近侧视素材。 |
| 实际渲染 | 十二件经共用领域命令放到24×18m地面，再走真实原生Canvas渲染1600×1200。八件近侧视非零旋转逐件明确拒绝；合法零旋转时保持固定根锚和直立。四件俯视地表0°/45°各实际像素不同，八件近侧视对应区域像素差为0。 |
| 原有素材流程 | 原单图导入、固定缩略图、独立个人整理、备份/删除/空库恢复、断网跨工程采用、放置/两步撤销，以及390px窄屏草稿/离开守卫两项既有UI用例均复验。 |

图库为`work/asset-batch-20261031/terrain-variants-gallery.png`；实际放置和地表旋转分别为同目录`terrain-variants-placed.png`/`terrain-variants-rotated.png`，根锚十字是图库标记，不是工程图片的一部分。已查看真实图库与放置图；它们用于尺寸/轮廓/根锚自检，不是岩岛最终构图或P3签收。批量预览截图`batch-review.png`来自窄侧栏的元素裁切，只作运行附件，不作为全表单排版/全部项目同时可见的证据。

#### 失败、修复与边界

首轮合法SVG夹具误含现有严格语法禁止的注释，预览被正确拒绝；修夹具而未放宽解析器。后续测试因采用成功重置折叠表单、以及空库summary误读成`identity`而非`item.identity`失败，分别改为实际重新展开和读取正确结构。实际放置补测最初给近侧视条目45°，被既有零旋转合同拒绝；修为逐件确认八次拒绝，并只旋转四件俯视条目。`browser-final/`、`browser-complete/`和相应日志保留后两类失败，最终结果只引用新的同次复验，不把失败组与补跑拼作原组全过。

只读审查发现首次读取失败/取消或只有sidecar时空列表无法在表单清空草稿；修为准备结束后可清空，并一并重置许可、校准和草稿状态。参数修改、来源变化与取消均中止旧准备并使原候选失效，原始SVG不直接进入应用DOM。采用后保存CAS失败仍遵循现有完整内存事务/旧持久分支保全合同，不宣称磁盘与内存跨层回滚；真实配额耗尽、多标签竞争、完整安全矩阵及所有正式验收仍留[09](../09-quality-plan.md#branch-feature-acceptance)。

正常生产构建（含前后端TypeScript）、最终`typecheck-final.log`与共享无DOM/Node边界检查均通过，构建和共享结果分别归`build.log`和`shared.log`；共享检查142个源码模块。正常构建仍有既有大chunk及依赖注释警告，未据此宣称性能改善。实现与测试20文件的实际输入hash、分支/HEAD及保留的独立todo hash归`source-fingerprint.json`；现有脏工作区与无关编辑保留，不冒充已提交版本。

正常dist另通过纯UI烟测（`production.log`、`production/result.json`，Chromium 141.0.7390.37）：八个步骤全部完成。独立临时浏览器从`/sceneweave/`新建→逐卡实际解码十二件变体→真实多文件PNG/SVG预览→一次采用保存/检索→整批撤销/重做→下载完整工程→通过已保存版本按钮冷重载再检索，全部用实际UI，无DEV源码导入、应用hook或存储注入。实际下载包的44个manifest条目长度/hash、确切许可主体绑定、原始/规范化SVG及规范PNG均由Node独立字节检查核对；包SHA-256为`9adf1a612abed07d5f5cae576d538c5cd7f4cc0df8f6c150dc9569c66e2386b0`，包与截图保留在`production/`。页面/控制台/HTTP错误和外部请求均为0；这是开发纯UI烟测，不等于正式验收或性能数据。

<a id="fill-copy-subgrid-20261102"></a>
### 子格吸附与填充柄复制（2026-11-02 开发自检）

范围为[07分支计划](../07-roadmap.md#branch-plan)第7项；确认的产品行为归[01](../01-product.md#branch-feature-scope)，定向验收矩阵继续归[09](../09-quality-plan.md#branch-feature-acceptance)。子格细分与格线/格心锚点为编辑会话状态，不修改工程格式或原始网格。拖拽或数值入口均检查实际新增数量、坐标、依赖与层/实体锁、物理支撑、旋转占地及重叠，并在同一候选内完整计量；独立物件和组合分别使用现有受限复制命令，成员人工字段、定义引用和新身份保留。超出实际事务预算时整笔拒绝，未采用候选不写工程，采用后一次撤销完整填充。

最终定向证据保留于`work/fill-copy-20261102/`：`unit-verified.log`中`src/application/workspace/fill-copy.test.ts`和`src/editor/native-canvas/subgrid.test.ts`共12项通过；`browser-complete.log`中正常Chromium开发工作台的`tests/fill-copy.spec.ts`两项通过；截图为`browser-complete/`下的`prefab-fill-preview.png`。浏览器覆盖格心子格放置、拖拽取消/地图外松开、Escape、数值位置、候选未变、独立物件单次采用/撤销以及双成员组合拖拽预览、位置/预算展示、单次采用/撤销/重做，另检查格距改成1毫米后1/8选项禁用、旧子格关闭。最终`typecheck-final.log`是最后代码编辑后的完整前后端类型检查结果；`git-diff-check.log`为最后文档与代码状态检查。

首次填充柄点击测试发现底图绘制层截获了SVG句柄的命中；将填充预览置于底图上方，并以真实`elementFromPoint`断言目标为句柄，最终浏览器两项均通过。首次撤销断言把合法更新后的`updatedAt`当成工程内容回退缺陷；修正断言后只归一化该时钟元数据，revision及其余完整文档仍逐字段比较。以上是开发必要自检，不含跨浏览器/全量回归、正式容量/性能、岩岛参考图视觉/P3、真实模型、真实VTT导入或整体验收；验收仍待[09](../09-quality-plan.md#branch-feature-acceptance)统一执行。

最终边界复查发现合法的1毫米格距仍可选1/8子格，后续定位会被纯算法的重复锚点保护拒绝。`browser-small-grid-red.log`保留该UI缺口；修为禁用小于1毫米的细分，格距变化时明确提示并关闭不再合法的会话子格。`browser-verified.log`复验复用了热更新后的Vite，界面工程正常但测试的无查询源码导入读到另一空会话实例；重启本轮服务，冻结代码后重新加载。`browser-clean.log`中原生option已带disabled属性，通用`toBeDisabled`断言仍报enabled，改为直接核对原生`option.disabled`属性。最终`browser-complete.log`同次两项均通过，不将此前单项结果拼成整组通过；本轮开发服务`http://127.0.0.1:5173/`实际HTTP 200。未提交、推送或部署；原脏工作区和独立`todo.md`保持。

<a id="building-edit-20261102"></a>
### 建筑编辑补齐（2026-11-02 开发自检）

范围为[07分支计划](../07-roadmap.md#branch-plan)第8项，行为和影响约束归[04](../04-scene-document.md)、[产品范围](../01-product.md#branch-feature-scope)及[交互参考](../reference/editor-and-architecture.md#doc-02-42-调整与删除)，正式验收矩阵仍只由[09](../09-quality-plan.md#branch-feature-acceptance)维护。五类能力均已实现：正交绘制、直接拖墙边、受依赖约束的房间/墙删除、整栋90度倍数平移/旋转，以及两种明确的精确拓扑修复（合并共线冗余接点、同批移动后拆分精确T接点）。候选显示几何、实体、用户图层、跨层曲线/边带及派生过渡的实际影响；共享墙和门窗使用稳定端点/整数距离，支撑、递归注记、实体/图层锁、完整事务预算和拓扑连续性均在采用前复核。固定表面对齐材质及局部覆盖通过不可变源派生跟随建筑变换；旧v1/v3与新版本的多次命令逐步保持实际拓扑范围，不覆盖旧源、有效材料/参数调整或未移动表面。

最终开发证据保留于`work/building-edit-20261102/`：`unit-final.log`中9个定向测试文件共83项通过，覆盖建筑领域事务、正交/拖边算法、工作区历史失效、固定材质源和派生调整、presentation、历史等价、草稿证明及准备链；`browser-final.log`中Chromium `tests/building-edit.spec.ts` 5项通过，覆盖真实工作台UI草图/预览/采用/撤销，含一个由DEV工作区构造后再经UI操作的跨层曲线/边带候选。`typecheck-final.log`前后端类型检查通过；`shared-final.log`共享158个源码模块的无DOM/Node边界、原生ESM与资源/存档烟测通过；`build-final.log`记录正常生产构建。几何单测含极大安全整数坐标：门窗末端恰在T接点且`offsetMm + widthMm`超过JavaScript安全整数精度时，精确拆分仍保留原墙基准和开口计量。`git-diff-check.log`覆盖最后文档与代码差异。

本项自检没有运行全量回归、跨浏览器矩阵、完整故障/迁移矩阵、正式容量/性能、真实模型、岩岛视觉/P3或目标VTT真实导入，不是正式验收；完整建筑适用矩阵继续留在09，用户P3由用户签收。未提交、推送或部署；原有脏工作区与独立`todo.md`保持。


<a id="uvtt-export-20261102"></a>
### 有限UVTT导出（2026-11-02 开发自检）

范围为[07](../07-roadmap.md#branch-plan)第9项的有限目标适配，当前合同归[06](../06-storage-and-export.md#universal-vttm4)，实际软件验收只从[09](../09-quality-plan.md#uvtt-import-acceptance)执行。工作区主持人入口预检图片/格距、墙门灯数量、全部降级和阻止原因，审阅后下载含UVTT、真实PNG、映射报告和说明的ZIP；完整工程格式、revision和撤销栈不变。当前源码档为Foundry14/Importer6.1.1，首个待验证组合选择Foundry14.369/Importer6.1.1，不代表真实目标导入已通过。

共享纯模型按整数主格扩边、稳定参考端点切开门窗、原范围裁切、物件旋转物理占地及显式公开点光生成结构；底图临时去掉格线、注记、门符号和点光。未揭示秘密门成为连续墙，共线墙拆分归一化不留下秘密位置端点；私密结构/遮罩、跨边开口、多Floor、超过81格及无法满足0.05px坐标误差时阻止结构包。导入器的portal.closed仅区分门窗，实际开关/锁、秘密可操作性、单独阻挡、地形通行、窗口阈值和灯光遮挡均按合同明确降级；单位与灯半径须按报告在目标端校正。

本次证据集中于被忽略的 `work/uvtt-20261102/`：

- `unit-final.log`：共享适配器19项通过，含严格场景1–6、外观图/源文档只读、负/非零原点、英尺、整格与小图边界、反向/斜墙开口、公开/秘密墙等价、旋转物理阻挡、启用/受众点光、私密/多层/极大坐标拒绝及无内部ID/秘密文字。
- `browser-regression-final.log`：Chromium 8项通过，其中 `tests/uvtt.spec.ts` 5项、既有 `c4-renderer.spec.ts` 3项。实际UI创建房间/门/秘密门/点光并下载ZIP；核对嵌入PNG字节和实际尺寸/PPG；普通门state改变并移除灯的反事实只读副本保持UVTT底图逐字节相同。固定遮罩及GM房间通过UI阻止结构包并下载真实玩家PNG，实际覆盖像素一致；非零范围扩边留空、原范围内成像和墙端点裁切均核对。坏资源及取消保持内容hash/revision/撤销/检查点；反事实、私密和错误用例使用DEV只读/工作区夹具，其范围不冒充纯UI。
- `typecheck-final.log`、`shared-final.log`、`build-final.log`：前后端类型、共享159模块无DOM/Node边界和正常生产构建通过。正常构建保留既有大chunk警告，不据此宣称性能通过。
- `production-smoke.log`、`production/result.json`：正常dist由独立预览服务与Chromium141.0.7390.37完成纯UI新建→建房→预检→下载；无源码导入、应用hook或存储注入。实际包四文件、2520×1680PNG及4条墙段一致，页面错误和外部请求为0；产物、截图和复现脚本保留于 `production/` 与 `production-smoke.mjs`。
- `source-audit.md`、`sources.json`、固定提交源码/官方资料、`source-fingerprint.json`及文档链接/差异检查记录用于复核来源与本轮文件。官方版本信息仅证明稳定版/兼容声明，不证明使用人数或本项目互操作。

本次没有执行真实Foundry导入、目标门操作/保存重开/玩家角色视角、全量回归、跨浏览器、完整故障/迁移、正式容量/性能、真实模型或视觉/P3。有限导出与开发自检不能关闭这些验收。目标岩岛仍需生成器接入新素材并核对实际成图；未提交、推送或部署，既有脏工作区与独立 `todo.md` 保持。

<a id="ux-task-navigation-20261105"></a>
### 工具分类与基础制作旅程（2026-11-05 开发自检）

范围为[07用户体验整改](../07-roadmap.md#ux-improvements)，操作约定归[交互参考](../reference/editor-and-architecture.md#current-task-navigation)，正式矩阵仍由[09](../09-quality-plan.md#ux-task-navigation)维护。本轮调整七模块及生成/地形子任务、基础属性与高级折叠、房间收尾和点击墙放门窗、素材用途/来源/单项接续操作、对象名称/搜索、常用尺寸输入和导出目的。沿用当前完整v1和原候选、完整资源许可、基线/锁、撤销、CAS及玩家投影，不改变生成算法或持久格式。

`entity-label`、`opening-placement`、`catalog-categories`、`length-input`四个定向单元文件共26项通过，前后端类型检查和正常生产构建通过。入口变化涉及的旧浏览器用例已同步，Playwright枚举解析成功；没有运行整组浏览器回归，不以枚举替代执行。

补充坐标接续自检：地形/道路、经典连接、折线及曲线控制点共用空项保全的整数解析；缺失坐标或重复标点不再被补0或合并忽略。`npm test -- src/editor/main/outdoor-coordinates.test.ts src/editor/main/connection-route-input.test.ts --maxWorkers=1`两文件9项通过，覆盖合法分隔符、负坐标、控制源往返和缺项拒绝；`npm run typecheck`通过。该修正只影响输入解析，未更改存档、算法重放或领域事务边界。

| 实际浏览器操作 | 观察结果 |
| --- | --- |
| 新建与草稿 | 14米→英尺→14米保持尺寸；切换生成/自然地形后返回，房间名称草稿保持。画布两点后可在画布旁预览房间，取消保持revision；4.5米房间采用成功。 |
| 门窗与物件 | 点击墙面放置0.9米门，一次采用后可撤销/重做；同位置重叠开口被领域拒绝。家具单项添加取消保持revision，确认后自动进入放置；物件X为-100米时拒绝并回显原3米，3.25米提交成功。 |
| 素材与导航 | 用途和来源可分别筛选；对象结构显示调查室、墙、门及素材名称，搜索可用，底层顶点默认折叠。地形选中后添加冷却玄武岩材质会接续应用候选；采用后一次撤销恢复原露台石板。 |
| 导出与生产回读 | 实际下载玩家/主持人PNG，均为4096×2926；完整工程下载后通过正常生产页面导入，房间、门及挂衣木架保持可编辑。该生产页面自检时控制台错误为空。 |

实测修复了普通物件坐标输入被误标成外观草稿的问题，外观草稿改由具体表单上报；材质适用性在添加前检查，避免完成添加后才发现所选表面不支持。900px窗口检查另发现旧顶部滚动样式裁切导出菜单，修正为允许菜单溢出；窄窗口资源面板使用抽屉。实际下载和截图保留在被忽略的 `work/ux-audit/`，不作为正式验收附件或已提交版本。

地形/道路表单已改为取点摘要与按需展开的精确坐标，高程、净宽、间距跟随显示单位，支撑面仍须明确选择；高级路线、来源边缘和散布参数折叠保留草稿。素材库筛选区已压缩，切换模块时滚动回面板顶部。隔离浏览器的1280×720地形及900×800素材库截图已复核，窄窗口搜索、分类和前两项素材可见；零道路净宽的预览给出原因并保留工程。补充定向检查与正常构建日志为 `work/ux-audit/forms-final-tests.log` 和 `forms-final-build.log`，两文件9项通过，构建完成；不与首轮26项拼为整套回归。

| 补充实际浏览器操作 | 观察结果 |
| --- | --- |
| 地形草稿与候选 | 独立工程「地形道路体验自检」中，四点轮廓和1.25米高程在折叠、跨模块返回后保持；预览取消保持r0，采用后r1。 |
| 道路与撤销 | 道路净宽1.5米，画布两点后通过「预览绘制结果」接续候选；取消保持r1，采用后r2。属性改宽0被拒绝且保持r2；改为1.75米采用r3，一次撤销恢复1.5米，r4保存重开仍保持地形和道路。补查创建净宽0时显示具体提示，不产生候选；工具栏从道路切到地形后，三点预览使用当前点集，取消后仍r4。 |
| 素材筛选与首屏 | 搜索「桌」并选择家具得到4项匹配，详细筛选折叠/展开及跨模块返回保留搜索和书桌勾选，浏览保持r4。1280×720首屏完整显示首张素材卡及放置按钮；900×800、390×800资源抽屉首屏均显示搜索、分类、来源及至少两张完整卡片/主要动作。临时视口检查结束后已恢复默认尺寸。 |

补充截图为 `work/ux-audit/catalog-compact-after.jpg`、`catalog-narrow-after.jpg`、`catalog-mobile-after.jpg`与`outdoor-form-after.jpg`，仅作本机开发证据。地形相关旧浏览器入口19项枚举解析成功，未执行整组浏览器回归。

#### 新手旅程、操作文案与快捷键帮助

顶部增加可用键盘打开、滚动和关闭的「操作帮助」，沿新建→绘制/布置→预览/确认采用→导出说明实际操作；区分当前浏览器内的自动保存与另行下载的可编辑工程备份。撤销/重做统一为「撤销编辑/重做编辑」，导入统一为「打开工程文件」；保存中、未保存、失败/冲突分别配合图标，候选明确说明勾选确认后才能采用。门窗指引使用面板名称，适用于桌面和抽屉布局。快捷键只说明当前真实覆盖范围，未新增绘图Enter完成、Delete删除或复制粘贴快捷键，也未修改原事务与键盘守卫。

最终 `npm run build` 完成前后端类型检查与正常生产构建，日志为 `work/ux-audit/journey-build.log`。初次构建遇到并行预算改动尚未补齐的模块/表单定义，失败日志保留为 `journey-build-interrupted.log`，相关定义补齐后最终构建通过。旧浏览器用例的撤销/重做定位名称已同步；`u1a-workspace`与`terrain-editing`共14项仅完成枚举解析，未执行整组浏览器回归。本轮未新增或运行单元测试，不与前述26项、9项结果合并。

开发页面受到并行改动热更新影响后，最终主流程改在正常生产预览中完成。隔离工程「新手制作旅程生产自检」（`08ba17a0-3843-4497-ac24-fe9bcd741976`，14×10米）的观察如下：

| 新手旅程实际操作 | 观察结果 |
| --- | --- |
| 新建、预览与帮助 | 新建页说明保存位置与后续路径；「新手书房」房间预览在确认前不能采用。打开帮助、Tab进入内容后按Esc仅关闭帮助，候选保持，焦点回到帮助入口；确认采用后r1。 |
| 撤销、重做与输入焦点 | 画布Ctrl+Z撤销到r2，Ctrl+Shift+Z重做到r3；搜索框输入「书」再Ctrl+Z不撤销工程，仍r3。画布缩放/复位及Ctrl+S不增加文档修订。 |
| 实际导出 | 下载玩家PNG与完整工程备份。PNG为4096×2926；工程包40条目，scene.json回读为r3、一间「新手书房」、34条素材记录和72条许可绑定。本次未重新导入该备份，不以包内回读代替重开/导入验证。 |
| 390px帮助 | 390×800窗口内帮助可完整滚动且浮层没有横向溢出，Tab进入内容、End滚到底可见关闭按钮；Esc关闭并返回入口。检查结束后恢复默认视口。 |

本机证据保留在被忽略的 `work/ux-audit/`：`journey-help-desktop.jpg`、`journey-help-mobile.jpg`、`journey-help-mobile-end.jpg`、`journey-player.png`与`journey-backup.sceneweave`，仅作开发自检。该旅程的正式范围已加入09的QA-UX-11，仍待统一验收。

#### 禁用原因与失败恢复

四类生成面板沿原校验条件显示首个参数问题及修改方法，并通过`aria-describedby`关联预览按钮；已有候选时不显示旧参数错误。局部重生成保留原schema与请求构造，无支持配方/目标时说明适用范围和手工工具去向。个人素材库将读取中、读取失败与真正空库区分，读取失败原因与显式重读入口位于来源筛选附近，重读沿原基线更新流程保留草稿，不自动重试安装/导入。

保存失败/版本冲突改为独立持续的恢复区，提供下载当前已采用工程、另存副本和普通保存失败时的重试，详细原因可展开。普通提示单独关闭，不再覆盖保存问题；文案明确成果仍在页面内、未保存到本机、备份包含秘密且不包含未采用草稿。处理/候选期间的禁用沿原状态与守卫，并显示原因；未改变保存、CAS、备份验证或副本新身份语义。

本轮 `npm run build` 通过前后端类型检查与正常生产构建，日志为 `work/ux-audit/recovery-build.log`。既有跨连接CAS定向用例通过（`workspace.test.ts`中`keeps the edited branch and undo on cross-connection CAS conflict`，1项执行、24项跳过），日志为`recovery-cas-test.log`；没有运行整文件、整组或全量回归。

| 实际开发自检 | 观察结果 |
| --- | --- |
| 参数禁用与纠正 | 正常生产页面独立工程「错误恢复体验自检」中，室内最大面积4小于最小8、森林地图宽10米导致原空地越界、混合名称为空，分别显示具体修改提示且预览不可用；恢复80平方米、32米及非空名称后预览恢复，未执行生成或改变工程r0。空白工程的局部重生成显示无支持配方及「生成」/手工工具去向。 |
| 真实双页面保存冲突 | 同一工程`b82e2c98-c0ab-4b60-8f7b-b45d5dd50987`，第二页面先采用并保存「另一页面的房间」到r1；原r0页面采用「冲突页面保留的房间」到内存r1后发生真实CAS冲突。恢复区、备份、另存副本和撤销可达；下载成功提示关闭后恢复区仍在。 |
| 冲突分支备份与独立副本 | 实际下载完整备份，包内40条目、原sceneId/r1及「冲突页面保留的房间」保持。另存为`a69523f0-07c2-48c5-b714-00bbf5a38abe`、标题「错误恢复体验自检 · 副本」、r0并显示本地已保存。原工程通过正常入口重新打开后仍为r1且保留「另一页面的房间」，未被副本覆盖。本轮未导入该下载备份。 |
| 个人库受控读取故障 | 独立5177端口夹具挂载真实CatalogLibrary，替换read返回空快照或明确失败，不读取/写入真实个人库。初读失败在来源旁显示具体原因及重读，未误显示空库；恢复读取后显示真正空库。已有「书桌」筛选、深橡木书桌勾选和标签整理草稿时，刷新失败再显式重读成功后均保持，未执行整理保存/安装/导入。 |

证据位于被忽略的`work/ux-audit/`：`recovery-invalid-form.jpg`、`recovery-conflict.jpg`、`recovery-conflict-backup.sceneweave`、`recovery-catalog-failure.jpg`、`recovery-catalog-restored.jpg`及`catalog-recovery.html/tsx`夹具。夹具首轮缺少必填新建尺寸参数而加载失败，补齐后完成检查；开发热更新曾重置夹具会话，重新建立稳定会话后上述失败→重读保留结果完成。它们仅为本机开发证据，不代替正常生产的真实存储故障或完整容量验证。普通配额失败、全部错误/禁用组合、窄窗口恢复区及跨浏览器仍待09的QA-UX-12统一验收。

#### 对象选择、图层与编辑锁反馈

画布旁集中呈现仅当前层、独显、手动隐藏及图层锁，分别提供恢复选择范围、退出独显、显示当前层和图层管理入口。图层行明确区分手动隐藏与独显排除；对象列表显示隐藏/范围外/自身锁/图层锁，范围拒绝另有具体调整入口。成功选择或调整选择视图后清除旧拒绝提示。显隐和范围仍为会话状态，不暗中解除锁。

锁来源查询从原`isEntityEditLocked`依赖闭包提取，布尔热路径保留`.some()`；完整层级封装将真实对象锁与图层锁分开。建筑、物件/组合、室外和布景属性显示实际来源名称，支持查看相关对象与前往图层。内容编辑采用含层锁的有效锁反馈，自身解锁仍走原独立命令及层/父容器/规则守卫，不将完整有效锁直接作为禁止自身解锁的条件，也不一次清除依赖锁。实际编辑命令仍按自己的真实影响范围校验。

`src/shared/commands/edit-lock-sources.test.ts`的5项定向检查串行通过，覆盖只读来源、父子锁分别保全、递归注记、建筑跨层锁及地形闭包，不把独立prop的支撑面锁捏造为自身锁。`npm run build`完成前后端类型检查和正常生产构建，最终日志为`work/ux-audit/selection-build.log`；未运行全量或整组回归。

| 实际开发自检 | 观察结果 |
| --- | --- |
| 最终生产构建与范围恢复 | 独立工程「选择与图层反馈自检」`c924a80f-133a-4c9c-8c15-f0277bce2f8e`，从普通工程列表冷读房间；当前层切到空的「布景测试层」且选择范围为仅当前层时，原房间列表标出范围外并给恢复入口。恢复所有可见图层后可选中房间，旧拒绝提示消失；最终构建复查维持r8。 |
| 隐藏与独显叠加 | 默认层手动隐藏且独显另一层时，两种原因分别可见；「显示当前图层」只取消手动隐藏，仍标出独显排除，继续退出独显后恢复选择与编辑。隐藏对象列表明确拒绝并可前往图层恢复。显隐与恢复过程保持r6，另一次隐藏拒绝/恢复保持r8。 |
| 自身锁、层锁与依赖定位 | 房间自身锁与默认层锁同时显示，字段不可编辑；先解除层锁后仍显示自身锁且字段保持禁用，再明确解除自身锁才恢复。只锁房间再查看邻墙时，墙属性列出真实来源「锁定反馈房间」，点击来源能返回其属性，来源查看保持r7。 |
| 390px恢复操作 | 390×844窗口中，锁来源文字、对象/层区分与前往图层按钮完整可见；按钮打开图层导航抽屉。r10→r11只解除层锁后仍保留自身锁，r11→r12再解除对象锁后房间名称恢复可编辑。窗口尺寸已复原，最终测试工程保持可编辑。 |

截图保留于被忽略的`work/ux-audit/selection-lock-sources.jpg`和`selection-mobile-lock.jpg`。这些是本机必要开发自检，不代表完整可访问性、全部多选/锁依赖组合、跨浏览器或玩家输出像素验收；QA-UX-13仍待09统一执行。

上述UX整改已实现并完成各自必要自检，下一步审核候选预览与批量操作的影响摘要、确认和撤销反馈；全量回归、跨浏览器、完整可访问性/离线/故障、秘密像素与P3均待09统一验收。本轮未提交、推送或部署；独立混合生成/岩岛视觉/预算工作、原有脏编辑与独立 `todo.md` 保持。


#### 候选审阅、批量操作与完成反馈

候选摘要补入`entityLayers`的真实归属变化并与对象字段合并，避免纯移层被报为0个对象；`userLayers`创建/删除/改名/顺序/锁定单独计为图层组织变化。批量面板和上下文菜单共用原散布/布景判定，区分预览与立即执行；旋转不再复用移动的可用状态。结构、批量、图层、外观和填充复制沿用原确认与事务规则，摘要独立滚动，确认及采用/取消固定在底部，填充复制仅保留一套操作按钮。采用成功、无变化、按钮/Esc取消及顶部/键盘撤销重做均给出结果提示，不把采用误报为本机保存完成。

`npx vitest run src/editor/main/entity-label.test.ts src/editor/main/selection-action-feedback.test.ts --maxWorkers=1`两文件9项通过，覆盖纯归属变化、图层组织、近侧视旋转限制与托管锁预览。`npm run build`完成前后端类型检查与正常生产构建；初次构建发现摘要视图对象缺少返回类型，补齐后通过。日志为`work/ux-audit/candidate-tests.log`与`candidate-build.log`。两份菜单定位相关浏览器用例仅做枚举解析，不替代执行，也未运行整组或全量回归。

| 正常生产页面自检 | 观察结果 |
| --- | --- |
| 纯移层及取消/采用/撤销 | 隔离工程「选择与图层反馈自检」从r12开始，房间移层摘要列出1个房间及“默认图层→布景测试层”；按钮取消仍r12。重新预览采用到r13，一次撤销到r14并恢复默认归属；重做到r15，再撤销到r16，各有真实结果提示。 |
| 长摘要与390px确认 | 同一工程房间改名候选展开摘要，390×844下摘要可滚动、确认与两个操作按钮保持可见，无横向溢出。未勾选时采用不可用，勾选后采用到r17，再一次撤销到r18恢复原名称与归属；检查后恢复默认视口。 |
| 批量复制及零变化 | 正常样板“书房与露台”的独立副本，书架与花盆两件零位移候选采用仍r0，并提示未新增编辑/撤销。右键菜单显示预览复制/删除及立即锁定/解锁；复制两件采用后13→15件，画布Ctrl+Z一次恢复13件。 |
| 删除取消及即时锁定 | 同两件删除候选显示实际删除2件，Escape取消后工程不变并给结果提示；立即锁定两件提示一次编辑且有效锁为2，顶部一次撤销恢复。自检副本最终r4、13件且两件未锁定；一次自动化点击超时后先读取页面，确认已执行，未重复触发。 |
| 填充复制 | 单件数值填充候选列出新增数量、间距、方向及支撑/重叠；全页仅一枚“采用填充复制”按钮。按钮取消有反馈，工程仍r4。此项没有执行实际填充采用。 |

本机截图为被忽略的`work/ux-audit/candidate-layer-summary.jpg`、`candidate-mobile-confirm.jpg`与`candidate-batch-review.jpg`。最终生产页面控制台错误为空。上述是必要开发自检，完整锁/过期/失败组合、全部候选类型、跨浏览器、可访问性及P3仍由09的QA-UX-14统一验收。

#### 首页、画布、历史与生成流程的开发自检

本次完成07中首页→画布→历史→生成器四项页面整改。工程改名沿既有完整v1原子命令、撤销与CAS，不改持久格式；画布取消、历史范围和生成候选状态只调整明确的用户操作与反馈。

- `src/application/workspace/workspace.test.ts`只运行改名事务1项，覆盖trim/空值拒绝/原值无变化、撤销重做、完整工程冷读及首页列表名称；最终1通过、25跳过。名称与批量反馈两个既有相关文件另跑9项，均通过，日志为`work/ux-audit/followup-unit.log`。没有运行整个workspace测试或全量回归。
- `npm run build`最终完成前后端类型检查与正常生产构建，日志为`work/ux-audit/final-build.log`。首次集成遇到HistoryPanel空值表达式混用的编译错误，补括号后构建通过。后续仅修正反馈时态，最终构建再次通过。
- `tests/terrain-editing.spec.ts`补充笔刷→选择及曲线拖动Esc回滚的回归用例，4项枚举解析通过；本次没有运行该整组或新增拖动用例，不能记为浏览器曲线回滚验证。

| 生产页面实际操作 | 结果与边界 |
| --- | --- |
| 首页与工程管理 | 用独立自检工程`c924a80f-133a-4c9c-8c15-f0277bce2f8e`（原「选择与图层反馈自检」）验证名称首尾空格搜索、匹配数量、短ID和完整ID折叠；改名草稿点击首页被守卫并保留输入；改名r18→r19、撤销r20、重做r21，回首页显示真实“本地已保存”，继续编辑保持会话撤销。最终名为「首页与历史体验自检 · 生产」。读取失败和同名场景组合尚未做受控故障实测。 |
| 画布选择退出笔刷 | 从首页保存新的双层岩岛独立样板副本`b0ce1eb7`开始，选择低地面并激活地表植被笔刷，选择按钮aria-pressed为false；点击选择后为true，笔刷回到“开始地表涂绘”，原“结束地表绘制”消失。随后点击画布不生成笔迹候选，撤销仍不可用，工程保持r0。曲线拖动Esc改动未实拖，留QA-UX-16。 |
| 完整历史恢复 | 独立岩岛副本建立「体验检查基线」r0命名快照；改名到r1后选择r0完整版本并恢复，生成r2且保留r1分支及「完整版本恢复前保护」。面板显示整个工程范围、此次r2结果及顶部撤销入口。 |
| 局部历史恢复 | 在同一副本将一件阔叶树冠X从16.908m改为17.5m，按原依赖确认采用到r3；从基线选位置角度恢复，差异显示物件与关联散布组名称、17.5m→16.908m及8项实际范围，原始值折叠。Esc取消明确提示未修改且保持r3；重新预览/确认/采用到r4，新增「恢复前 · 体验检查基线」保护点并显示可撤销反馈。保存完成后回首页为r4。读取失败/恢复后保存失败与过期组合仅代码约束核对，留QA-UX-17。 |
| 生成流程反馈 | 改森林种子后显示“参数已修改，请预览当前设置。当前工程尚未改变”，取消草稿恢复；组合地貌首次运行显示生成进度及取消入口，生成完成前未成功点到运行取消，不能记为运行中止已实测。组合候选成功出现后改种子，明确提示仍显示上次候选且采用禁用，取消回原工程r4。各领域完整重新生成/采用及失败矩阵留QA-UX-18。 |

最终生产页面控制台错误为空；首页截图为被忽略的`work/ux-audit/home-management.jpg`。正常构建仍有既存大chunk提示，没有因此做无关拆包。独立`todo.md`的SHA-256仍为`15adcd89e490a92516316d35a6a3cbc260b0ae7851a93b7ea579750b532067b9`。这些仅为必要开发自检；完整输入/失败/跨浏览器/可访问性/秘密像素及P3矩阵仍按09的QA-UX-15至19统一执行。后续AI对话与任务反馈、跨视口/键盘整合自检见下文。

#### AI对话、任务状态与草稿采用反馈

AI面板为连接、任务查询/读取、发送/同请求重试、暂停/继续/取消和删除显示对应处理中状态；草稿面板区分读取后本机重放、创建、备份、结束生成审阅、租约释放及保护快照后采用。活动任务初次连接、重连、已断开、暂停和状态同步使用不同说明。取消提示说明服务器停止后续步骤并保留最后确认进度；停止本地读取不代表服务器取消。没有改变创建请求ID、用户确认继续、unknown付费请求、隔离草稿、完整差异、资源重放、保护/CAS、保存或采用回执语义。

`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m21-ai-conversation.spec.ts --project=chromium`通过3/3；真实HTTP/CORS/SSE/SQLite使用确定性本机模型替身，覆盖任务创建处理中状态、响应完成后清除、只读恢复、暂停/继续、取消与迟到结果、同请求ID显式重试。`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m22-ai-authoring.spec.ts --grep 'authorized tools make an isolated draft|explicit pause and supplementary resume|a paused nonempty draft can finish for review' --project=chromium`通过3/3；覆盖采用处理中状态、保护快照、一次保存、撤销/重做/原生重开，以及暂停后继续或结束草稿。两组没有调用真实付费模型。

首次M22运行发现创建请求实际为`/v1/tasks?authoringVersion=4`，旧响应监听把它与不带查询参数的URL全串比较，导致测试错过已成功创建的任务；改为匹配后端origin、pathname及POST后同三项全部通过。暂停用例另有固定`1/256`文案预期，与当前实际账本显示不符；用例改为核对“当前工程实际操作 n/256”格式，没有改动计费或预算行为。`unknown`付费结果不自动重发、原始请求身份、草稿隔离及保护采用合同保持。

#### 跨视口与键盘整合自检

`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/u1b-layout.spec.ts --project=chromium`通过2/2。桌面1512×982检查面板宽度键盘/指针调节、折叠与恢复、左右面板切换期间保留外观草稿、同一Canvas与工程/历史/undo不变及真实刷新后布局恢复；窄屏390×844检查触屏抽屉入口、面板切换、Escape关闭、焦点回到触发按钮、无横向溢出及布局偏好损坏时回退默认。属性面板中的“外观与图层调整”按设计默认折叠，第一次运行因测试未展开它而超时；截图和DOM确认页面路径正常，更新用例显式展开后两种视口均通过，未改产品行为。

这些浏览器检查均使用本机Vite开发服务和已安装Chrome，通过`SCENEWEAVE_BROWSER_CHANNEL=chrome`选用系统浏览器；Playwright自带Chromium下载曾断线，因此未依赖其安装。以上仅为开发自检，不代表生产环境、全量键盘可访问性或跨浏览器验收。完整AI断流/未知费用/保护与保存失败归09的QA-UX-19；跨视口整合覆盖的其他正式输入、失败、辅助技术与秘密像素矩阵仍按QA-UX-06至18执行。

接续整合时补了M21窄屏旅程。完整命令`SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/m21-ai-conversation.spec.ts --project=chromium`通过4/4。390×844实际打开资源抽屉进入AI对话，拦住真实HTTP创建请求后，确认`role=status`的处理中提示完整处于当前视口且宽度不越出390px；放行后任务完成、提示清除、画布基线不变且页面无横向溢出。提交中和完成截图附在Playwright结果中。

#### 混合场景运行中取消（2026-11-06 开发自检）

混合生成面板、画布状态区及Esc共用原取消入口，新增取消生成/候选/参数修改的结果提示；内部参数失效、基线更新及生成前清理保持静默。全局键盘监听通过实时abort/候选/草稿引用选择提示，避免使用初次渲染的状态。开始新预览清除旧操作提示，防止已取消与正在生成同时显示。原epoch、AbortController、Worker终止、严格资源校验与独立工程采用语义保持。

最终命令`SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5186/sceneweave/ SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/mixed-generation.spec.ts -g "running mixed generation" --workers=1 --output=work/ux-audit/mixed-cancel-production-final`通过1/1，日志为`work/ux-audit/mixed-cancel-browser-final.log`。正常dist独立预览、隔离浏览器上下文中，通过真实UI新建工程；仅在Worker构造器上暂扣真实计算响应的交付，未替换生成结果、读取用户库或注入应用/存储状态。

同一用例依次由面板按钮、画布按钮和Esc取消运行中的混合生成。每次确认运行状态出现、新预览没有残留取消提示；取消后提示当前工程未改变，运行区和候选消失，释放暂扣的真实Worker回调后仍无候选。工程revision保持、撤销不可用、本地已保存状态保持，取消前后实际下载的完整工程解包后所有文件SHA-256一致；页面错误为0。这覆盖响应尚未交付的运行取消及迟到处理，不外推任意计算阶段、服务端模式、其他领域或窄屏已通过。

`npm run build`最终通过前后端类型及正常生产构建，日志为`work/ux-audit/mixed-cancel-build.log`，保留既有依赖注解/混合导入和大chunk警告。`git diff --check`通过；独立`todo.md`的SHA-256仍为`15adcd89e490a92516316d35a6a3cbc260b0ae7851a93b7ea579750b532067b9`。已查看最终运行/取消截图；它们位于上述final输出目录，仅作开发自检证据。

首次默认Chromium因本机缺少Playwright缓存可执行文件，未进入页面；切到系统Chrome后，开发服务在用例中重新连接并重载为空工作区，该次不计通过。转为正常生产预览后，顶部和属性面板的同名标题使严格定位匹配两项，修正为顶部一级标题；失败trace保留于`work/ux-audit/mixed-cancel-production-first/`。随后生产用例通过；补齐新预览清除旧提示后，最终同例再次通过。没有将中间结果相加为整组回归，未提交、推送或部署；组合地貌运行中取消及完整矩阵按07和09继续。

#### 组合地貌运行取消与显式重试（2026-11-06 开发自检）

当前组合页面沿`generateBaseMap`和`sceneweave-base-map`真实Worker执行；没有改动旧`composition-client`、算法/配方、共享传输的中止/代次/迟到守卫、资源校验或保存/采用流程。面板新增取消结果提示，取消保留类型、种子及岛屿数；新操作清除旧反馈。失败时预览按钮明确变为「重新预览地貌组合」，说明未自动重试；失败区在所属面板未隐藏且处理结束后滚入视口。字段复用既有地形表单样式，没有增加并行样式体系。

正常`npm run build`最终完成前后端类型与生产构建，日志为`work/ux-audit/composition-feedback-build.log`；将同版dist固定于`work/ux-audit/composition-feedback-dist/`供独立preview，避免其他开发构建或热更新影响有状态旅程。最终命令`SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5186/sceneweave/ SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/terrain-composition-ux.spec.ts --workers=1 --output=work/ux-audit/composition-feedback-browser`通过2/2，日志为`work/ux-audit/composition-feedback-browser.log`。使用隔离上下文及真实UI新建/调整参数/下载工程，不读取用户库或注入应用/存储状态；测试只在真实Worker消息交付处设闸门，并调用实际messageerror处理器模拟响应读取失败，不伪造成功候选。

| 必要开发自检 | 实际结果及边界 |
| --- | --- |
| 运行中取消与迟到 | 两岛`terrain-compose-0`真实计算响应尚未交付时，进度区可用取消；取消后明确反馈当前工程未改变，种子和两岛选择保持、预览按钮恢复。释放真实迟到回调后无候选，真实发送数仍为1。实际下载完整工程解包后的所有文件SHA-256与取消前一致，revision/撤销不可用/本地已保存状态保持，pageerrors为0。 |
| 读取失败与显式重试 | 在相同受控交付边界触发实际messageerror处理器；显示严格响应校验失败原因及未自动重试说明，错误文本和重试按钮均完整处于桌面视口。释放失败任务迟到结果后仍无候选，下载工程保持且真实发送仍为1。用户点击重试后才发送第2次请求；不再拦截实际响应，完整资源准备成功且采用按钮可用，等待Canvas绘制完成后留图。取消该真实候选后再次下载工程，逐文件hash及revision/撤销/保存状态保持，pageerrors为0。 |

首轮构建因另一工作线`prepare.ts`暂时引用尚未落齐的`aggregate-boundary.js`失败，日志为`work/ux-audit/composition-cancel-build.log`；依赖文件落齐后正常构建通过，未改动该接线。首轮生产2/2通过，但截图中错误区在面板底部之外、候选画布仍解码；随后补齐错误区滚动与既有字段样式，增加错误/重试按钮完整可见及Canvas绘制完成断言，最终同两例再次通过，不将两轮相加为4项回归。

已查看最终运行/取消、读取失败和重试完成截图，它们保留在上述输出目录，仅为开发自检，不作视觉/P3或性能结论。`git diff --check`通过，独立`todo.md` SHA-256保持`15adcd89e490a92516316d35a6a3cbc260b0ae7851a93b7ea579750b532067b9`。未执行整组旧T9/全部配方/服务端/跨浏览器/窄屏及完整故障矩阵，没有提交、推送或部署；完整验收仍归09，UX下一执行点只在07维护。

<a id="curve-drag-cancel-ux-20261106"></a>
#### 曲线控制点Esc取消（2026-11-06 开发自检）

本次补齐既有曲线取消修正的正常生产页面证据，没有再改动画布或领域实现。`tests/terrain-editing.spec.ts`将笔刷切选择和曲线拖动分为独立用例；曲线例通过真实UI生成并保存岩岛，选择岸线、实际鼠标拖动控制点和按Esc，不使用DEV钩子、注入工程或用户数据库。入口改为相对路径，兼容正常生产的`/sceneweave/`前缀。

`npm run build`完成前后端类型及正常生产构建，退出0，日志为`work/ux-audit/curve-drag-build.log`；既有依赖注解、混合导入及大chunk提示保持。同版dist固定在`work/ux-audit/curve-drag-dist/`，以独立preview运行。命令`SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5187/sceneweave/ SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/terrain-editing.spec.ts --grep 'curve drag Escape restores' --workers=1 --output=work/ux-audit/curve-drag-browser`通过1/1，退出0，日志为`work/ux-audit/curve-drag-browser.log`。未运行同文件其余四项或整组验收。

实际拖动时控制点X/Y均改变，SVG持有此次真实pointerId的捕获；Esc后两轴恢复原值、指针捕获释放并提示“已取消曲线拖动，工程未修改”。随后真实松手并继续移动，控制点保持原位，没有地形影响候选、计算进度或编辑Worker；revision保持、退出轮廓工具后撤销仍不可用、本地已保存。通过普通导出入口实际下载的取消前后完整工程，解包后全部文件SHA-256相同，pageerrors为0。导出前明确退出轮廓工具，沿用现有草稿守卫。

已查看`curve-drag-browser/`下的`curve-dragging.png`和`curve-cancelled.png`，真实岸线手柄与取消结果可见；同目录保留`curve-before.sceneweave`和`curve-cancelled.sceneweave`。这些只证明所列桌面Esc路径，不外推pointercancel/失焦/正常释放、所有轮廓/跨浏览器/窄屏或视觉P3；完整矩阵仍由09的QA-UX-16统一执行。独立`todo.md`保持，未提交、推送或部署。

<a id="fill-copy-ux-20261106"></a>
#### 填充复制采用与取消（2026-11-06 开发自检）

本次新增`tests/fill-copy-ux.spec.ts`补齐现有填充复制的生产页面证据，没有改动候选、采用或领域实现。通过正常UI新建完整v1工程、从本工程素材库放置铜色桌灯至(4000,4000)mm，选择对象并输入新增2份、每份偏移(1000,250)mm。不使用DEV钩子、用户数据库、注入工程或模型。

正常`npm run build`最终通过前后端类型与生产构建，退出0，日志为`work/ux-audit/fill-copy-ux-build-final.log`；同版dist固定在`work/ux-audit/fill-copy-ux-final-dist/`。最终命令`SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5188/sceneweave/ SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/fill-copy-ux.spec.ts --workers=1 --output=work/ux-audit/fill-copy-ux-browser-final`通过1/1，退出0，日志为`work/ux-audit/fill-copy-ux-browser-final.log`。使用隔离浏览器上下文，所有工程读数来自实际UI下载的完整包。

| 必要开发自检 | 实际结果及边界 |
| --- | --- |
| 候选审阅与取消 | 预览列出新增2份及真实间距，采用按钮只有一枚且完整处于桌面视口。原工程仍r1；按钮取消及重新预览后的Esc取消均显示工程未修改，按钮取消后撤销仍可用、重做不可用。两次取消后实际下载工程的全部解包文件SHA-256均与原工程一致。 |
| 一次采用 | 第三次预览采用后r1→r2，物件从1件变为3件；副本分别位于(5000,4250)和(6000,4500)mm，原件不变，副本保留原字段、支撑与图层。采用后提示作为一次编辑、可整笔撤销，保存完成且画布显示三件真实桌灯。 |
| 一次撤销 | 顶部撤销一次后r2→r3，恢复原来的一件桌灯；下载的scene除revision和updatedAt外与原件完整一致，重做可用。采用及撤销后的固定素材字节、源与许可文件hash保持，pageerrors为0。此处不要求历史身份及事务时间回退。 |

首轮完整构建被容量工作线的聚合边界测试接口更新暂时阻塞：`externalCandidates`和`inspectAggregatePropMove`旧引用造成类型错误，日志为`work/ux-audit/fill-copy-ux-build.log`。先以当前源码的普通Vite生产包完成同一UI用例1/1；对应工作线接线更新后，完整构建恢复。本线没有修改聚合模块。最终正常构建产物与首轮页面包的主入口字节有变化，因此固定最终dist并重跑同一例1/1，不把两轮相加为2项，也不将首轮Vite打包当成完整类型检查通过。

已查看最终输出目录中的`fill-preview.png`与`fill-adopted.png`；同目录保留取消前、按钮取消、Esc取消、采用和撤销的五份`.sceneweave`。这些仅为桌面独立物件数值填充的必要开发自检，不外推组合/拖柄/重叠拒绝/锁/过期/窄屏及完整失败矩阵；正式范围仍由09的QA-UX-14统一执行。独立`todo.md`保持，未提交、推送或部署。

<a id="ux-lengths-and-delete-20261106"></a>
#### 常用单位、地形表单与画布删除（2026-11-06 开发自检）

按用户确认的1→2→3顺序实施，各项分别冻结必要自检，不合并为完整验收。

**填充复制单位**：间距输入和候选的每份偏移/首末坐标跟随工程米/英尺，复用既有整数毫米换算，不改候选及事务。正常`npm run build`通过，日志`work/ux-audit/fill-units-build-final.log`，固定包`fill-units-dist/`。生产Chrome运行`tests/fill-copy-ux.spec.ts`，2/2通过、退出0（`fill-units-browser.log`）：米制输入1/0.25得到1000/250mm，英尺输入5/1.25得到1524/381mm；两种单位的按钮/Esc取消后全部解包文件hash保持，一次采用新增两件、保留字段/支撑/图层，一次撤销恢复原场景（revision单调增加）。已查看米制候选截图；附件与完整工程在`work/ux-audit/fill-units-browser/`。首轮类型检查发现新增摘要读取可空project，已改为读取候选document，修复后完整构建通过。

**局部地形表单**：半径、只读目标高程、范围摘要/精确输入及影响摘要使用工程米/英尺；范围默认折叠，框选入口常显，半径/范围非法时提示并阻止预览。高级落笔/控制点仍输入整数毫米。正常`npm run build`通过（`work/ux-audit/terrain-form-build.log`），固定包`terrain-form-dist/`。生产Chrome运行`tests/terrain-editing-ux.spec.ts`最终1/1通过、退出0，日志`terrain-form-browser-final.log`：同一用例逐次验证米制0.3m→300mm、英尺1.25ft→381mm，范围换算、折叠保留、字段Esc及非法值提示；按钮取消后全部解包hash相同，保护采用后的笔画记录保留确切radiusMm/scopeMm/坐标，一次撤销/重做除revision/updatedAt外完整恢复，重新载入与下载工程一致。附件在`terrain-form-browser-final/`。首轮脚本误认为取消会保留本次表单；实际取消会重建编辑会话，脚本等待已折叠的落笔入口，已中断并按真实UI重新设置参数后完整重跑。已查看米制布局截图，截图时画布仍在重绘，只作表单布局证据；不作为视觉签收。旧笔刷/拓扑用例按单位和折叠方式同步，未运行整组地形回归。

**画布删除快捷键**：`AssetCanvas`仅在画布焦点、主持人选择模式且无进行中的工具/拖动时请求工作区删除；工作区再次检查草稿、候选、帮助/导出、菜单和弹窗，沿`batchAction(delete)`生成原候选，保留原完整命令、锁、依赖与一次采用/撤销。合成事件（含229）及按住重复不请求删除，输入框保留文本编辑。正常`npm run build`通过（`work/ux-audit/canvas-delete-build.log`），固定包`canvas-delete-dist/`。生产Chrome运行`tests/canvas-delete-ux.spec.ts`最终1/1通过：真实画布Delete/Esc取消及Backspace预览/采用/撤销、已有候选时不叠加；搜索框文本、合成事件/重复事件、Ctrl+Backspace、帮助/导出、上下文菜单/新建弹窗、名称草稿、平移/放置、物件锁和玩家视图均未错误删除。守卫路径与取消后完整包hash相同，采用删除一件r3→r4，一次撤销r4→r5恢复场景（仅revision/updatedAt前进），pageerrors为0。截图和完整包在`canvas-delete-browser-final/`，日志`canvas-delete-browser-final.log`。首轮脚本把Esc发送到不可聚焦menu容器，焦点实际仍在画布，菜单未关闭；改为聚焦真实menuitem后Esc，整例重跑通过，不改产品菜单行为。已查看删除候选截图，只有原一组采用/取消按钮。

所列生产用例只覆盖独立物件、桌面Chrome与合成事件守卫，不等同真实中文输入法、层/成员/依赖全部边界或辅助技术验收；真实矩阵继续由09的QA-UX-07/11/14/16执行。5个受影响浏览器文件仅枚举解析10项，日志`work/ux-audit/lengths-delete-test-list.log`，不表示运行整组。独立`todo.md`hash保持，未提交、推送或部署。

<a id="clipboard-enter-keyboard-narrow-20261106"></a>
#### 复制粘贴、Enter与键盘窄屏限定验收（2026-11-06）

用户授权按复制粘贴→Enter→键盘与窄屏限定验收依次执行。复制范围明确为当前工程独立物件引用；系统剪贴板只写随机会话marker，源字段/外观/图层/出生/有效私密性变化要求重新复制，工程切换/重开清空。不把跨工程或跨应用对象导入算入能力。

复制粘贴开发自检：`npm run build`通过（`work/ux-audit/clipboard-build.log`），固定包`clipboard-dist/`；`scene-clipboard.test.ts`最终3/3通过（`clipboard-tests-final.log`）。首轮发现辅助选择判定在完整模型上不直接覆盖用户图层锁，剪贴板捕获/粘贴补用完整`effectiveEditLocked`，复验通过；候选仍沿原命令完整检查。生产Chrome `tests/clipboard-ux.spec.ts`1/1通过、退出0（`clipboard-browser.log`）：真实Ctrl/⌘+C/V、将marker粘贴进普通搜索框证实只有UUID且无对象/工程/名称；复制、按钮/Esc取消完整包hash保持；15°桌灯副本位于4300/4300mm，原字段/支撑/图层/外观保留且fresh出生token；真实键盘撤销/重做、源移动后拒绝及重复制、输入框文本行为、外部文本拒绝、重开引用失效均通过。附件在`clipboard-browser/`。

Enter开发自检：正常构建通过（`work/ux-audit/enter-build.log`），固定包`enter-dist/`；生产Chrome `tests/enter-drawing-ux.spec.ts`最终2/2通过、退出0（`enter-browser-final.log`）。矩形0/1点、多边形不足3点、地形不足3点、道路/连接不足2点保留草稿并提示；矩形、多边形房间、地形与道路进入原候选，Enter不直接采用。覆盖字段Enter、合成isComposing/229/repeat及修饰键、帮助/菜单守卫、取消完整包hash保全，以及矩形实际4墙坐标、显式确认采用、一次撤销与资源hash。已查看矩形候选截图，附件在`enter-browser-final/`。首轮矩形通过，室外用例因区域和select同名导致测试选择器歧义而失败，改用combobox定位后同例通过；没有为此修改产品。高差连接仅覆盖不足点数，真实中文输入法尚未实测。

本次限定验收从[09入口](../09-quality-plan.md#keyboard-narrow-acceptance)执行，绑定同一正常生产包，不使用DEV读取入口。隔离浏览器为系统Chrome157.0.8103.38，CSS视口1512×982、900×800、390×844，单worker串行运行。源码快照在`work/ux-audit/keyboard-source-20261106/`，重新正常构建退出0（`keyboard-freeze-build.log`），dist逐文件SHA-256与实际服务的`enter-dist/`完全一致，未用后续工作区改动替换已测包。

| 冻结或运行证据 | 实际结果 |
| --- | --- |
| 源码逐文件清单 `keyboard-source-manifest.json` | 1388个文件，集合SHA-256 `c0561dc7a2f2fe32044a842e57a59b26110464c152d81e32eb6302658bf56b62` |
| 生产包逐文件清单 `keyboard-dist-manifest.json` | 集合SHA-256 `6f172193826419563266da12df03aa5035f4f48eb9b9e4871b07f7984d038996`，重新构建包与已测包无差异 |
| `tests/clipboard-ux.spec.ts`、`tests/enter-drawing-ux.spec.ts`、`tests/canvas-delete-ux.spec.ts`、`tests/keyboard-narrow-acceptance.spec.ts` | 同包共7/7通过、退出0，日志`keyboard-narrow-final.log`，附件`keyboard-narrow-final/` |
| 最终补录的三视口旅程与展开长摘要检查 | 3/3通过、退出0，日志`keyboard-narrow-expanded-final.log`，附件`keyboard-narrow-expanded-final/`，各目录有实际完整工程下载、`keyboard-narrow-facts.json`、帮助/画布/粘贴及房间候选截图；先前仅补录焦点的`keyboard-narrow-evidence-final.log`也是3/3通过 |
| 执行时产品文件与最终测试/辅助文件清单 `keyboard-run-manifest.json` | 产品取自固定源码快照；测试取自最终实际执行文件，另列当前工作区差异，不能把并行改动算作已经验收 |

复验真实Tab/Enter/Space展开帮助与导出、面板开关、菜单/帮助/抽屉Esc后的焦点返回；900/390使用抽屉布局，不用force穿透遮挡。输入框正常文本复制粘贴且Enter不完成画布；画布粘贴候选键盘取消/采用、一次撤销，Delete取消、矩形两点Enter预览及键盘取消，Ctrl/⌘+S保存、+/−/0及方向键视口操作均通过。三种视口均无页面横向溢出；粘贴候选取消/采用按钮可完整滚动到视口并由Tab互达。房间候选用Enter/Space展开真实变化与字段详情，明确内容高于可视区；此时键盘可勾选范围确认、Tab依次到取消/采用且采用按钮完整可见，返回取消后工程保持。已查看390px粘贴/房间候选、帮助、画布，以及900px房间候选/画布截图。各旅程revision均为1→2→3→3，最后视口/取消/保存不改工程；真实下载完整包的document/identity/appearance和逐文件hash在取消及冷重开后一致，资源hash保持，无pageerror。最终焦点事实分别保存51/55/55步，不外推完整无障碍认证。

补录过程的失败保留在`keyboard-narrow-evidence.log`和同名附件目录：1512/900px取消删除候选后脚本过早发缩放键，trace显示按键前`aria-busy=true`，画布原有未就绪守卫忽略该键；390px通过。脚本补等待真实画布就绪后同三视口3/3通过，未修改产品处理逻辑。最初只用内存body附件配合list reporter，事实文件未落盘；最终明确写入输出目录再附加，完整事实与候选截图均已保留。

本轮只关闭09所列实际覆盖子项。高差连接成功候选、真实中文输入法、跨浏览器、辅助技术和200%系统缩放尚未执行；完整UX/秘密像素/性能/VTT与用户视觉P3仍按原矩阵验收。验收冻结后并行聚合线增加的建筑组摘要影响收集不在本次包内，其差异另列清单并保留；独立`todo.md`在其他工作中已有变化，本轮未改写或还原。没有提交、推送或部署。

<a id="platform-input-accessibility-20261106"></a>
#### 中文输入、跨引擎与实际浏览器放大接续检查（2026-11-06）

按用户授权的①真实中文输入法→②跨浏览器→③辅助技术与200%放大显示执行并逐项报告。用户随后要求只在Codex侧边栏操作，不使用其浏览器；接到要求后不再操作用户Chrome/Safari窗口。跨引擎自动化全部使用Playwright隔离临时配置的后台浏览器，不读取个人配置或用户工程库。本轮只增加检查用例和精确记录，没有修改产品行为，不表示全部UX或项目验收完成。

**冻结与环境**：接续上一节已正常构建并核对一致的`keyboard-source-20261106/`及`enter-dist/`，源码集合SHA-256仍为`c0561dc7a2f2fe32044a842e57a59b26110464c152d81e32eb6302658bf56b62`，dist集合SHA-256仍为`6f172193826419563266da12df03aa5035f4f48eb9b9e4871b07f7984d038996`。实际服务的86个文件逐一核对hash，无差异；并行容量修改不在此冻结内。最初另捕获的`platform-source-20261106/`构建在重负载下主动中止，退出130；`platform-build.log`、`platform-vite.log`只保留尝试，不计构建通过，未用其产物替换已验证冻结。本轮没有重新将当前并行工作区整体标记为构建通过。Playwright从官方CDN安装专用Chromium/Firefox/WebKit，安装完成退出0，日志`platform-browser-install.log`、`platform-chromium-install.log`。实际系统及最终测试hash归`work/ux-audit/platform-run-manifest.json`。

| 项目 | 实际结果及边界 |
| --- | --- |
| ①真实输入法 | 读取到本机已有ABC和搜狗拼音，未修改输入源配置。在Codex侧边栏新建名称框实际发送Ctrl+Space及s/h/u，得到字母`shu`，没有真实候选或组合证据；截图`platform-ime-sidebar.png`。没有创建这个草稿工程；Esc关闭表单。直接填写中文、合成composition事件都不抵扣真实输入法。该项仍待实测，不能据此认定产品输入法失败。 |
| ②三引擎主要流程 | 最终同一串行命令9/9通过、退出0、无跳过：`npx playwright test --config work/ux-audit/platform-playwright.config.ts --output work/ux-audit/platform-browser-complete`，JSON输出由`PLAYWRIGHT_JSON_OUTPUT_FILE=work/ux-audit/platform-browser-complete-results.json`指定；日志`platform-browser-complete.log`，完整包/截图/焦点和ARIA事实在`platform-browser-complete/`。Chromium141.0.7390.37、Firefox142.0.1、WebKit26.0各运行剪贴板1项和`platform-ux.spec.ts`2项。 |
| ③真实200%浏览器缩放 | 最终增强可见性检查1/1通过、退出0：`npx playwright test --config work/ux-audit/browser-zoom-playwright.config.ts --output work/ux-audit/browser-zoom-final-proof`，JSON输出`browser-zoom-final-proof-results.json`，日志`browser-zoom-final-proof.log`。本地临时测试扩展在隔离Chromium配置中调用`chrome.tabs.setZoom/getZoom`，返回真实倍率2；实际CSS视口1512×982→756×491，DPR1→2，页面宽度均756，无横向溢出。错误提示实际滚动可见，中心命中其SMALL节点，边缘取整裁切0.1796875 CSS px，原数值保留；帮助、抽屉Esc及焦点返回、长候选确认/取消/采用键盘可达，取消后所有解包文件hash与原工程一致，pageerrors为0。正常结束恢复倍率1、DPR1及原视口；临时配置/扩展在清理时移除，没有安装到用户浏览器。此处是浏览器缩放，未测操作系统显示缩放。 |
| ③真实读屏 | 当前工具没有可操作并采集VoiceOver实际朗读的接口，未启用或声称通过。三引擎ARIA/焦点/错误关联仅为补充证据，实际读屏保留待实测。 |

三引擎主流程均从正常UI创建完整v1空白工程：搜索框Enter/Delete保护、帮助/菜单关闭后的真实焦点、两个实际画布点Enter只创建候选、展开真实变化详情、按钮取消后完整包hash相同、明确确认后采用、四墙与整数毫米坐标、一次键盘撤销及真实备份冷开一致。各主流程revision为1→2→3→3，固定素材hash保持，pageerrors为0。768×500及390×844检查错误`aria-invalid`/`aria-describedby`/`role=alert`、原值保留、Esc、抽屉、帮助滚动、长候选按钮与确认、取消完整包保全；未把CSS重排视口叫作真实浏览器缩放。

三引擎的剪贴板例均实际按Ctrl/⌘+C/V，不注入ClipboardEvent：普通搜索框粘贴得到UUID marker，未携带工程/对象字段；取消完整包保全、复制15°桌灯到4300/4300mm、当前字段/支撑/图层/外观及fresh出生身份、一次撤销/重做、复制源改变拒绝、普通文本保护与重开引用失效均通过。JSON reporter中的body事实已从最终结果原样解码为`clipboard-facts-{chromium,firefox,webkit}.json`。该证据不包含跨应用对象导入或用户个人浏览器的剪贴板兼容性。

**首次失败与定位**：首轮Firefox剪贴板和主流程通过后，窄屏脚本未取消保留的建筑表单草稿就尝试启动另一工具，按原守卫禁用；主动中止整轮，退出130，`platform-browser-first.log`与`platform-browser-first/`保留。补上原「取消建筑草稿」后，`platform-firefox-reflow.log`又显示取点前地图已缩放到466%，一个坐标超出实际可点击范围；补用真实「适应全图」并断言可视范围。此后首轮完整三引擎7通过/2失败，`platform-browser-final.log`与`platform-browser-results.json`保留：两个WebKit例均在普通Tab到按钮断言失败。隔离原生HTML探针`platform-webkit-tab-probe.json`确认这是macOS WebKit默认键盘规则，普通Tab跳到可聚焦DIV，Option+Tab依次到取消/采用按钮；未改系统设置或给产品增加tabIndex。用真实Option+Tab/Option+Shift+Tab后，`platform-webkit-retest.log`2/2通过。最后完整同轮9/9通过，不将中间结果累加为更多用例，也不把WebKit引擎等同Safari应用验收。

200%首次尝试因亚像素取整的严格ratio=1断言失败（0.99438及0.99797）；随后实际取点诊断显示启动绘图的异步抽屉请求尚未完成，脚本过早判断关闭，点击实际落到「外观」页签。补等待抽屉真实展开再关闭，并在取点前核对`elementFromPoint`属于地图视口；独立探针`browser-zoom-coordinate-probe.json`验证倍率2下DOM、Playwright边界及鼠标坐标一致。`browser-zoom-complete.log`曾1/1通过，但截图复核发现“在视口内”不能排除固定页签遮挡错误文本；追加真实命中/裁切检查，错误提示滚动到抽屉可见末端后最终通过。早期日志及截图分别保留在`browser-zoom`、`browser-zoom-final`、`browser-zoom-verified`、`browser-zoom-diagnostic`、`browser-zoom-complete`、`browser-zoom-visible`、`browser-zoom-unobscured`，只有`browser-zoom-final-proof`作为最终增强可见性证据。没有以放宽断言掩盖被遮挡文本或未出现候选。

已查看最终200%错误/帮助/候选、Firefox390px候选及WebKit768px候选截图；只作对应流程与布局证明。独立`todo.md`本轮SHA-256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`，无关改动未还原。真实中文输入法、VoiceOver朗读、Safari应用、系统显示缩放、高差连接成功候选和09其他完整矩阵仍各自待验收；没有提交、推送或部署。当前推进与下一执行点只在07维护。

<a id="aggregate-efgh-20261106"></a>
#### 自然聚合、区块派生、有限拆合与内容块保存（2026-11-06 开发自检）

用户授权接续e/f/g/h，并在说明IndexedDB升级影响后确认开发期继续实施h。沿用唯一完整工程v1；数据库结构4、内部块编码1、身份5和算法/配方为独立轴，不新增工程容器版本。执行入口与后续i/j只在[07](../07-roadmap.md#t2-implementation)维护，完整验收仍从[09](../09-quality-plan.md#aggregate-capacity-acceptance)执行。

| 已实现范围 | 约束与开发证据 |
| --- | --- |
| e · 建筑与自然适配 | 建筑/自然共享能力接口；明确地形种子沿真实支撑、连通建筑、容器、道路/高差连接和递归注记形成闭包。自然组平移/四分之一转保留人工移动/删除/退出与确切生成归属，固定源派生、物化边缘及过渡仍由原所有者重算。森林、火山和mixed真实生成输入有定向检查；不按题材名新增全局物理分支。不完整外部支撑、半移共享曲线、旧来源、锁或无法精确再采样的几何拒绝。 |
| f · 有限空间派生 | 稳定Floor/x/y区块引用同一实体，语义组与空间格正交；视口命中/显式选择派生所需精确形状，屏外prop的第二次绘制位图解码延后。JSON、首次完整资源验证、投影和完整PNG仍全量。独立`aggregate-partition-stream@1`采样使用邻接带及半开唯一归属，不改变旧领域重放或因移动/复制重新撒点。6文件35项通过，日志`work/aggregate-chunks-tests.log`；不据此声明实体JSON卸载或冷读内存收益。 |
| g · 拆合、复制与身份 | 拆分是全部直接成员/子组的完整归属分区；合并限同Floor/父级，换父级/解组保持世界几何及实际成员身份。复制限独立prop与递归注记子树，确认外部引用，保留有效秘密、固定源和人工外观，使用fresh成员/容器出生。当前严格身份5直接加入aggregateTokens，退休容器保留墓碑，ID/token全池唯一且共用65536上限；真实撤销/重做恢复原出生。几何布尔切割、Prefab/散布/布景/结构复制及跨工程资源迁入不从此入口隐式展开。 |
| h · 内容块与原历史 | Dexie4/native40只加`projectContentBlocks`，旧表/inline记录保留；新载荷写严格清单及实际规范JSON块，保持local唯一表示。清单/块/当前版本/历史头同事务发布；完整读者核每块字节/长度/hash/规范JSON、完整重建及原领域/资源许可。闭包与单块有128MiB内部上界，原scene/identity/appearance各20MiB及许可正文等领域保护继续独立执行。暂不自动块GC，所有保留字节仍计费；完整包物化实际闭包，可在空库离线恢复。 |

本轮必要自检按其实际集合分别记录，不与a–d或并行UX冻结结果拼接为整体验收：

| 检查 | 最终结果、附件与边界 |
| --- | --- |
| 存储及工作区集成 | `npx vitest run`覆盖content-blocks、repository、incremental-history、history-maintenance、history-overview、import-archive、snapshot-read、save-content-proof、aggregate-coordinates和workspace aggregate-building/aggregate-domains，`--maxWorkers=1 --testTimeout=30000`；11文件118项通过、退出0，日志`work/t2-efgh-storage-final.log`。含坏块/缺块、CAS、预取消/块已插入后取消、原生配额、全部保留历史分支、空库离线包、local原生行、锁/玩家过滤及一次撤销。合法>20MiB完整工程和同hash字段独立性包括在该集合内。 |
| 暖记账与近满库 | repository最终30项包含在上述118项中；日志`work/t2-h-accounting-repository-final.log`。暖受控写不全库扫描，仍同步严格检查变更行；按原生行净差及新增唯一块计量，冷读/外部writer/epoch失效全验。近满库迁入共享current/checkpoint不被两份全文误拒；最终清单/历史图字节使预算超限时全事务回滚，prepared job及epoch保留，目标工程/版本/块均未发布。 |
| 实际内容字节 | 150新增细节prop样本，单件旋转并revision前进；完整工程规范字节111117B，初始唯一块110400B，此次新增块551B、实际清单及历史载荷行54860B，合计55411B。块表实际字节净增与诊断一致；取消事务不计入已提交诊断。定向日志`work/t2-h-content-blocks-write-bytes.log`。不包含其他元数据表、资源及IDB引擎开销，不作端到端耗时、容量或内存声明。 |
| 正常生产构建/共享边界 | 最终`npm run build`完成前后端类型及普通生产打包、退出0，日志`work/t2-efgh-build-final.log`；原有依赖注解、动态导入/分包与大chunk提示保留。`npm run check:shared`通过223源码模块及无DOM编译/Node原生ESM往返，日志`work/t2-efgh-shared.log`。最终`npm run typecheck`另行通过、退出0（`work/t2-efgh-typecheck-final.log`）；7份相关文档本地文件链接/显式锚点及`git diff --check`通过。 |
| 生产Chrome旅程 | 固定正常dist到`work/t2-efgh-production-reviewed-dist/`，独立preview，系统Chrome隔离上下文、单worker。`tests/aggregate-building.spec.ts`及`tests/aggregate-domains.spec.ts`共3/3通过、退出0，最终日志`work/t2-efgh-browser-reviewed.log`，附件`work/t2-efgh-browser-reviewed/`。建筑、自然组及拆合/复制均通过真实UI预览、取消、范围确认采用、撤销及保存冷开；自然组另覆盖重做、实际道路与GM注记，复制明确外部支撑、保留GM锚点。无pageerror，未打开用户库或注入应用/数据库状态；SSR只准备供普通导入的完整工程包。 |

本轮发现并修复的失败：最初dbcore异步写丢失Dexie事务上下文，游标读取也在无PSD回调下误入观测中间件；分别改为Dexie.Promise写链和所属原生事务批量读块。首次记账修法导致暖写重复全扫、近满库判断和坏checkpoint检查回归，已恢复严格行校验与原增量receipt/epoch机制，最终同集合通过。迁入文档预检改为新增唯一块下界，最终同事务仍按全部真实字节核预算。块重建解析缓存最初让相同hash空对象在不同字段间别名共享，已在安装字段前独立递归复制；honest recordHash下的非法来源仍由原严格字段校验拒绝。整份20MiB误限已拆为内部存储上界与原独立领域保护，未放宽原领域或许可校验。

组身份审查发现退休容器ID可能被重用，已补真实出生/墓碑、跨池冲突及计量；不以相同ID伪造历史连续性。早期150细节组合用例在当时高并行机器负载下两次超过30秒，原规模和断言保持，只为该例设置90秒等待；记录在`work/t2-h-content-final.log`，不作为性能数据。最终118项没有超时。完整类型检查曾被并行新增的browser-zoom测试`evaluate`返回unknown阻塞，只补明确返回/参数类型，不改变其测试行为。截图复核时发现通用组审阅沿用“建筑组”字样，改为“分组”并以最终生产包复跑上述三例，不把前后两轮相加。最终包首轮复跑为2/3，拆合复制冷开用例按option序号选副本，规范序列化后随机UUID排序使其偶尔选中原组（实际X=4而期待5）；失败保留在`work/t2-efgh-browser-final.log`及同名附件目录。测试改为保存真实原组/副本ID，重开按持久ID选择，产品与生产包保持；同三旅程重新完整执行。

已核看最终自然变换与复制候选截图：真实成员/秘密、范围确认及单一取消/采用入口可见；这里只是有限行为/布局开发自检，不作视觉/P3签收。未执行整体容量/性能、真实模型、目标VTT导入或完整秘密像素矩阵；i负载分档和j代表性整合仍待接续。保留无关脏编辑与独立todo.md，未提交、推送或部署。

<a id="terrain-connection-ux-20261106"></a>
#### 高差连接成功旅程接续检查（2026-11-06）

用户授权接续高差连接成功预览、明确采用、一次撤销与保存重开。新增`tests/terrain-connection-ux.spec.ts`，从真实UI新建工程和1.2m高台，分别检查1512×982桌面台阶与390×844窄屏坡道；使用Playwright自带Chromium141.0.7390.37的隔离临时配置，不操作用户浏览器、个人数据库或注入应用状态。本轮没有修改产品行为，只关闭[09限定验收](../09-quality-plan.md#keyboard-narrow-acceptance)所列成功路径。

接续此前正常构建的`work/ux-audit/keyboard-source-20261106/`和`enter-dist/`冻结，源码集合SHA-256仍为`c0561dc7a2f2fe32044a842e57a59b26110464c152d81e32eb6302658bf56b62`，dist集合SHA-256仍为`6f172193826419563266da12df03aa5035f4f48eb9b9e4871b07f7984d038996`。磁盘及实际HTTP服务的86个文件逐一核对一致，没有重建并行容量修改后的工作区。测试进程只对实际下载的文档调用`checkTerrainTravel`；其11个本地运行时依赖文件也与冻结逐字节一致。执行文件与依赖hash保留在`work/ux-audit/connection-run-manifest.json`。

最终命令`npx playwright test --config work/ux-audit/connection-playwright.config.ts`单worker串行执行，2/2通过、退出0；日志`work/ux-audit/connection-cold-final.log`，JSON结果`connection-cold-final-results.json`，附件`connection-cold-final-browser/`。新增测试及其传递依赖的限定类型检查`npx tsc --project work/ux-audit/connection-tsconfig.json --noEmit`通过、退出0（`connection-typecheck-final.log`）；未将此当作当前全部工作区类型检查或新生产构建。

| 实际执行 | 观察结果与边界 |
| --- | --- |
| 制作、取点与Enter预览 | 高台轮廓为(7300,1000)至(12500,9000)mm，高程1200mm。连接从Floor的(4000,5000)至高台的(9000,5000)mm，净宽900mm；真实画布点击前核对两点均由Canvas实际命中。Enter进入原「创建高差连接」候选，revision保持1；再次Enter不采用。候选列新增对象、默认图层与真实支撑，展开变化后键盘仍可到达确认/取消/采用。 |
| 取消与一次采用 | 按钮Enter取消与画布Esc取消两次后，实际下载完整包全部解包文件hash均与基线相同。第三次预览以Space确认范围、Tab依次到取消/采用、Enter采用，r1→r2，只新增一条连接；原高台、固定资源、图层、出生身份及public/未锁/无门附着等字段保持正确。 |
| 实际净宽及撤销重做 | 对下载文档检查显式直线路线：原来跨高差拒绝，采用后800mm净宽通过，1000mm仍以`TERRAIN_HEIGHT_CONNECTION`拒绝。一次键盘撤销r2→r3恢复原场景及阻断，一次重做r3→r4恢复连接及通行；除revision/updatedAt外完整文档分别与基线/采用后相同，资源hash保持。这里只证明该显式路线，不证明自动寻路或全部通路。 |
| 保存与刷新重开 | 先用「重新载入已保存版本」读取，再整页刷新以丢弃内存会话，从首页「最近工程」按真实持久ID打开。两次读取后document/identity/appearance及完整包逐文件hash均与重做后一致，revision保持4、通行结果一致。两个视口无页面横向溢出，pageerrors均为0；每例保存15步键盘焦点事实及`connection-facts.json`。 |

首轮`connection-first.log`为1通过/1失败，桌面脚本要求Canvas相交比例严格等于1，实际为0.9993207；改为核对实际取点可见且`elementFromPoint`命中Canvas，`connection-final.log`同两例2/2通过。随后加强整页刷新检查的`connection-cold.log`为0/2：脚本误以为刷新自动打开原工程，实际页面明确为「尚未打开工程」。改按现有首页最近工程入口真正重开后，最终同两例2/2通过；原日志/截图/trace均保留，没有为测试假设改动产品，也不累加中间通过数。

已查看最终两种视口的`connection-preview.png`和`connection-adopted.png`，原候选按钮与实际台阶/坡道可见。每例保留取消前、两次取消、采用、撤销、重做、重新载入和刷新重开的8份实际完整包。曲线/房间附着、第三支撑/阻挡、锁/过期等完整失败矩阵、真实输入法、VoiceOver与视觉P3仍各自待验收，不外推整体UX或项目验收。独立`todo.md`SHA-256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`；保留并行容量工作，未提交、推送或部署。

<a id="terrain-connection-failure-ux-20261106"></a>
#### 高差连接拒绝提示、旧候选与跨页保全（2026-11-06）

用户授权接续端点支撑、阻挡、锁及旧候选的失败反馈与保护。新增`tests/terrain-connection-failure-ux.spec.ts`，正常生产UI在1512×982和390×844制作1.2m高台，逐项触发拒绝、实际下载完整工程并检查恢复；另一例以同一隔离浏览器context的两页操作同一持久工程。使用Playwright自带Chromium141.0.7390.37，不操作用户浏览器、个人库、DEV接口或注入应用/数据库状态。

首轮旧包`connection-failure-first.log`3/3通过数据保护检查，但截图发现锁支撑错误只显示`terrain-UUID`，没有可读对象或解锁说明。增强断言要求真实高台名称后，旧包390px同例明确失败，退出1，`connection-failure-red.log`及`connection-failure-red-browser/`保留。根因为领域锁错误直接透传工作台；新增`outdoor-preview-error.ts`，仅将该类错误中的真实ID映射为现有对象/图层名称并补解除锁后重新预览说明，经`previewOutdoor`接入。其他异常（含AbortError）、完整领域校验、候选/采用、保存和CAS原样保持。

修正源码以原`keyboard-source-20261106/`冻结为底，仅叠加本次工作台接线、错误格式化和两份连接UI测试，排除并行容量实现；源码1391文件清单`work/ux-audit/connection-feedback-source-manifest.json`集合SHA-256为`0fd5a44edeb63452a12b032944ccec4d66bef8e79ef4e2b54c610ee1aa62101c`。正常`npm run build`完成前后端类型与生产构建、退出0（`connection-feedback-build-final.log`），固定包`connection-feedback-dist/`；86文件清单`connection-feedback-dist-manifest.json`集合SHA-256为`ad50f16417236bc2e71ace6e8948e823681b123538c0a028082c1bb90a1d81f8`，实际5190 HTTP服务逐文件核对一致。两个新清单的集合算法均为UTF-8紧凑、key排序的files JSON取SHA-256。

最终`npx playwright test --config work/ux-audit/connection-failure-playwright.config.ts`串行单worker，同一修正包5/5通过、退出0：3项失败旅程及原2项成功回归。日志`work/ux-audit/connection-failure-final.log`，JSON结果`connection-failure-final-results.json`，附件`connection-failure-final-browser/`。当前新UI测试及依赖的限定类型检查通过（`connection-failure-typecheck-final.log`），不将其视为并行当前工作区全量构建结论。

| 实测范围 | 结果与保护边界 |
| --- | --- |
| 表单与几何拒绝 | 未选终点表面、端点不在支撑、零净宽、0.6m第三支撑和阻挡Region均有实际中文原因；提示在视口且命中未被抽屉遮挡，原坐标输入保留，每次拒绝后实际完整包逐文件hash与各自基线相同，无候选或额外revision。失败后不自动重发。 |
| 支撑锁与恢复 | UI锁定真实高台后，新建连接预览拒绝；提示显示「露台石板 · 高程 1.2 m」及解除编辑锁后重试，隐藏原内部ID。属性显示自身锁来源且高程输入禁用；正常解锁后，改用无第三支撑/阻挡的路线可进入原候选，取消完整包保持。两视口均通过，无横向溢出或pageerror。 |
| 同页候选与跨页CAS | A预览期间撤销和其他预览禁用；B从最近工程打开同ID、真实改名保存，A再确认采用后保留自己的含连接内存分支并报告保存冲突。冲突栏直接下载按钮产物与顶部备份逐文件相同，撤销仍可用；冲突栏不提供“重试保存”入口。B的原工程hash保持，A另存fresh ID、revision0的副本完整保留连接，双方整页刷新后从最近工程重开hash分别一致。此处不称为采用阶段直接拒绝跨页候选。 |
| 成功流程回归 | 同修正包桌面台阶/窄屏坡道2/2；Enter仅预览、两种取消、明确采用、一次撤销重做、净宽800mm通过/1000mm拒绝、保存和整页刷新重开保持。每例完整工程和焦点/通行事实保留，不与旧冻结通过数相加。 |

同页旧候选的应用层检查另在当前工作区执行：为`curved-connections.test.ts`增加真实支撑锁提交后采用旧连接候选的定向例，与原支撑锁例一起运行，2通过、4项未选中，退出0（`connection-failure-authority.log`）。旧候选以“场景已有修改”拒绝，当前工程对象、checkpoint、支撑锁及已保存完整内容hash保持，无连接被写入。该当前工作区证据与上述冻结UI包分别记录。

本机准备冻结副本时，首次替换断言未限定函数，发现同一句式出现两处而中止；当时误启动的未叠加修正构建虽退出0，只作为原包记录`connection-feedback-build-unpatched.log`，不作修复证据。随后限定`previewOutdoor`片段叠加并重新正常构建，最终以实际新入口hash和5项复验为准。已查看最终桌面/390px锁提示及跨页冲突截图；其余提示/成功截图、真实完整包和事实文件均保留。完整连接锁组合、曲线/房间门附着、所有失败矩阵、系统输入法、VoiceOver和视觉P3仍待验收；独立todo.md及无关容量改动保持，无提交、推送或部署。


<a id="aggregate-budget-i-20261106"></a>
#### 普通分档与组核心计量（2026-11-06 开发自检）

用户讨论确认i：纯组平移/四分之一转按核心计编辑目标，全部成员另有界检查；成员编辑、归属拆合和复制按实际变化。沿用唯一完整工程v1；manual profile3/counting2和组内影响4096/16384/65536为会话准入，生成/AI策略、算法重放、身份与数据库结构均未换版。现行合同归[04](../04-scene-document.md#manual-transaction-budget)，开发状态归[07](../07-roadmap.md#t2-implementation)，正式验收仍归[09](../09-quality-plan.md#aggregate-capacity-acceptance)。

| 实现与检查 | 证据与范围 |
| --- | --- |
| 核心与完整影响分别计量 | 前后真实local记录、根/子组归属、图层、业务字段及有效外观不变才能计1核心。成员及嵌套容器另记groupMembers，组外真实关系端点另记externalDependencies；几何仍使用全部实际目标。近侧视固定世界朝向及表面不可变源派生使用同步后的严格完整内容，与实际前后场景精确绑定；仅upright集合、假来源链或错配文档不能减计。成员/归属/人工业务变化无法证明时退回实际目标。 |
| 请求预选及工作区 | 准备前展开单命令图层/外观/滤镜、容器成员、真实新建、归属拆合、图层排序和组完整子树，一次选256/512/1024档。恢复读取真实快照后展开当前/历史成员和结构/视觉范围；小图大量新建和800成员单命令不再按原始条数漏估。预览及采用重查同一冻结策略，保留已计几何工作及组内影响峰值；不试跑升级、不拆批。 |
| 代表性成功与失败保全 | 工作区真实1800物件＋200条注记＋地形组：1编辑目标、2001组内影响，锁/一次采用/撤销重做/保存冷读通过；完整2000物件同组的保守求交估计128128032超过expanded的128000000，仍原子拒绝并保全当前及已存revision0。此上限未为样本放宽；2000成员成功不等同于2000物件或复杂组容量通过。单命令800成员、257新副本、历史800成员图层恢复及新复制容器计量另有定向检查。 |
| 冻结后必要定向检查 | `npx vitest run`覆盖shared budget/command-budget、manual-request，commands/manual-tier-commands、command-budget-commands，history/manual-budget，workspace/manual-tier、prepare-budget-usage、manual-budget、aggregate-building、aggregate-domains、fill-copy-manual及UI command-budget-details；`--maxWorkers=1`，12文件70项通过、退出0，日志`work/t2-i-targeted-reviewed.log`。覆盖纯核心/真实成员与几何分计、近侧视/固定源、请求档位边界、复制新容器、800成员单命令/图层恢复、完整资源、锁/旧基线/取消/一次撤销及实际保存冷读。未运行完整全仓回归。 |
| 正常生产构建与共享边界 | `npm run build`退出0，含前后端类型及正常生产包，日志`work/t2-i-build-reviewed.log`；保留既有chunk/依赖提示。`npm run check:shared`退出0，224源码模块和无DOM/Node原生ESM往返通过，日志`work/t2-i-shared.log`。普通构建快照在`work/t2-i-production-reviewed-dist/`，不包含性能API或DEV入口。 |
| 正常Chrome图层旅程 | `SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5199 SCENEWEAVE_BROWSER_CHANNEL=chrome npx playwright test tests/manual-tiers.spec.ts --output=work/t2-i-browser-reviewed`，1/1通过；500成员单命令显示500/512，一次采用/撤销重做，实际下载完整包核对revision/成员图层，冷开一致。日志`work/t2-i-browser-reviewed.log`。修复夹具直接导入失败，改为SSR仅准备普通完整包，浏览器从正常首页文件选择打开；不使用存储注入或DEV读数。 |
| 正常Chrome建筑核心旅程 | 同一正常生产包，串行执行`tests/aggregate-building.spec.ts`，1/1通过；显示1/256编辑目标、13/4096组内影响和1个组外依赖；完整关联对象仍列出，取消/确认采用/撤销重做/保存冷开保持。日志`work/t2-i-building-browser.log`，截图及产物`work/t2-i-building-browser/`；已查看变换预览截图。此为功能读数与流程检查，不作美术/P3签收。 |

开发中发现并修正的失败保留：初轮真实建筑用例仍断言编辑目标大于1，按新合同改为精确核心/成员和非零几何断言；2000物件求交超限保留为明确负例。密集近侧视用例完整检查触及默认5秒，只将该用例时限改为30秒后通过；严格来源和文档绑定仍执行。类型检查中的联合字段/字面量及选档器视觉字段路径错误已修正，正常构建复验通过。一次并行开发时的组合检查69/70通过，选档器代码与新增移层排序用例正在交接，冻结后该文件22/22复验通过（`work/t2-i-planner-reviewed.log`）；该中间结果保留在`work/t2-i-targeted-final.log`，不冒充全部通过；随后对同一12文件冻结重跑70/70通过，以`work/t2-i-targeted-reviewed.log`为本轮最终集合。原预览来源/旧基线/锁、恢复保护两项定向复验通过，日志`work/t2-i-preview-protection.log`，其余24项明确未运行。

这批开发证据未执行完整容量矩阵、CPU/内存/冷读性能、真实AI模型、视觉/P3或目标VTT导入。保护上限与合成样本不外推容量收益。未提交、推送或部署；独立todo.md及无关UX/生成编辑保持。附件为本机忽略目录内的开发产物，未宣称已发布远端。


<a id="curve-interruption-ux-20261106"></a>
#### 曲线中断、重新拖动与提交拒绝（2026-11-06，限定生产检查）

本轮接续高差连接后的UX检查，仅新增`tests/curve-interruption-ux.spec.ts`与既有计划/验收/测试导航记录，未修改产品实现。使用Codex侧边栏的5190正常生产冻结和隔离后台Chromium141.0.7390.37，不操作用户浏览器、注入工程或直接写库。当前`AssetCanvas.tsx`与冻结副本均为SHA-256 `36d876f4fabeb4a714d1d25e4b6e2d0e109945ce74f8edb049b9d3804ee065cb`。

复用上一轮完整正常构建，不重新构建或混入并行容量开发：源码1391文件集合`0fd5a44edeb63452a12b032944ccec4d66bef8e79ef4e2b54c610ee1aa62101c`，dist86文件集合`ad50f16417236bc2e71ace6e8948e823681b123538c0a028082c1bb90a1d81f8`。本轮重新核对两个清单逐文件及5190实际HTTP提供的全部86文件，完全一致；集合算法为UTF-8、按key排序且无额外空白的files对象JSON之SHA-256。清单、源码和dist仍在`work/ux-audit/connection-feedback-*`，原正常构建结果不外推当前并行工作区全量构建。

最终命令`npx playwright test --config work/ux-audit/curve-interruption-playwright.config.ts`串行执行2/2通过、退出0，日志`work/ux-audit/curve-interruption-verified.log`，结果`curve-interruption-verified-results.json`，附件`curve-interruption-verified-browser/`。视口1512×982与390×844、`hasTouch: true`；每组各包含下列三个中断场景。新增测试及依赖的限定类型检查退出0，日志`curve-interruption-typecheck-verified.log`，不代表整组或全仓验收。

| 事件与观察范围 | 结果及证据边界 |
| --- | --- |
| 原生触控pointercancel | CDP发送真实touchStart/touchMove/touchCancel，DOM记录down/cancel/got/lost capture均isTrusted=true、pointerType=touch；整条曲线路径及所有控制点恢复，捕获释放，后续松手与移动不提交。不是dispatchEvent伪造的指针事件。 |
| 原生捕获丢失 | 真实鼠标拖动后调用浏览器releasePointerCapture，再用真实移动交付lostpointercapture；该事件isTrusted=true。全曲线回滚，松手不生成候选。覆盖受控捕获丢失，不外推所有操作系统中断。 |
| window blur处理逻辑 | 真鼠标拖动及捕获后dispatchEvent(new Event('blur'))，明确记录isTrusted=false；现有window监听器回滚曲线并释放真实捕获。此项只证明处理逻辑，不能称为原生窗口切换实测。 |
| 继续拖动与工程保全 | 每次中断后均能用新的真实鼠标手势重新捕获并移动控制点，再用Esc回滚和松手。没有地形候选、计算进度或新增edit-worker；revision不增、撤销不可用、本地已保存。退出草稿后实际下载的三份完整包逐文件hash均与基线相同；整页刷新后从首页最近工程重开再下载，hash仍同。两组pageerrors均为0。成功松手生成候选、采用和撤销不在本次通过范围。 |

事实JSON、拖动/取消截图及五份真实工程（基线、三次中断后、冷重开）保留在各组附件中，运行指纹见`curve-interruption-run-manifest.json`。旧桌面Esc例在首轮另通过1项，不与最终2项拼成同一完整回归。 已查看最终桌面捕获丢失和390px失焦处理后的取消截图，实际控制点及画布可见；文档本地链接378个目标及本轮三个显式UX锚点检查通过，相关diff检查通过。

本轮失败和收窄边界保留如下，未用后续通过覆盖：

- 首轮`curve-interruption-first.log`为2失败、1通过（退出1）。新例在触控取消及重新拖动后，普通松手被“实际写入超出冻结范围；请扩大范围后重新预览”拒绝。脚本原先误把导出矩形等同完整可写影响范围；领域实际包含绘制边带及重复装饰范围，不应跳过该守卫。首轮测试源码保留为`curve-interruption-first.spec.txt`。
- 显式通过表单将范围扩大到(-10m,-10m,44m,38m)后，两个视口的普通松手又被“局部地形物化改变了已审阅结果；请先解决现有表面覆盖或依赖冲突”拒绝。`curve-interruption-scope.log`、源码`curve-interruption-scope.spec.txt`及两个error-context保留；这只证明当前冻结存在该拒绝，尚未定位具体物化差异，不能声称已有真实人工冲突或已修复。旧Esc例随后在等待pointerdown记录时未完成，已向本轮专属runner发SIGINT结束（退出130，结果2失败/1中断）；未记为通过或产品缺陷。
- 进一步尝试真实切换同context隔离标签页，两视口均未观察到原生blur，`curve-interruption-final.log`为2失败、退出1；该版本源码/配置分别保留为`curve-interruption-focus-first.spec.txt`和`.config.txt`。最小独立预检`curve-focus-preflight.json`确认关闭Playwright默认焦点模拟后，前后两页仍hasFocus=true且无blur，因此最终只检查合成blur监听器。真实窗口失焦继续待实测，不启动用户外部浏览器代替。

下一UX步骤先定位正常曲线提交拒绝，再处理保存失败恢复、历史恢复失败、生成取消与迟到、组合/填充拖动，最后补交付旅程及原生输入/辅助技术等实测；唯一执行顺序归[07](../07-roadmap.md#ux-development-closeout)，完整验收仍归[09](../09-quality-plan.md#acceptance)。这些结果不关闭正常释放/采用、真实窗口失焦、多点触控、其他轮廓/引擎、玩家完整秘密矩阵或视觉P3。独立todo.md及无关容量工作保全，未提交、推送或部署。

<a id="ux-five-recovery-20261106"></a>
## 2026-11-06 · 曲线、保存、历史、生成取消与填充拖动的开发自检

本轮按用户授权的1→5逐项执行，后续交付旅程与真实窗口失焦/输入法/读屏/P3不混入本轮通过结论。所有浏览器旅程使用隔离Chromium141.0.7390.37、正常生产构建和实际完整工程下载，不使用DEV状态注入；保存/历史故障是原生API定向异常注入，不冒充真实磁盘耗尽。冻结、日志和附件保留在被忽略的 `work/ux-audit/`。

### 1 · 曲线正常释放、范围修正与采用

原拒绝来自局部编辑后合法的人工几何保护/规则暂停记录未纳入审阅，物化比较错误地把它当成未预期变化。准备阶段先显式协调这些记录，独立重放结果保持不变；完整写入及预算按协调后实际工程计算，物化后未预期差异仍拒绝。UI增加显式“按完整曲线扩大范围”，涵盖旧/新曲线与启用边带，不自动扩大。

`curve-submit-ux.spec.ts`正常UI生成自然岛屿→真实拖动→原范围拒绝且无写入→显式扩大→预览取消完整包hash保持→重新拖动确认采用→一次撤销/重做→刷新从最近工程冷重开，1512×982与390×844两条2/2通过（`curve-submit-first-browser.log`，退出0）。实际控制点、物理轮廓、人工保护记录、固定旧来源及冷开完整包逐文件hash分别核对。`curve-submit-unit-verified.log`三文件32/32通过（退出0）；新应用层测试还注入额外物化变化证明一致性守卫未删除，包含采用/保存冷读/撤销。红测及中间测试断言校准记录原样保留，不计成功。

正常构建 `ux-five-build-step1-verified.log`退出0，源码冻结 `ux-five-source-20261106/` 初次修复集的manifest为 `ux-five-step1-source-manifest.json`，collection SHA256 `d69c14531a75744c8ddf928af1dd985c2facd5bc7ff395069c946bcb9b5606ef`；不可变dist `ux-five-step1-dist/`，collection SHA256 `493b3ea68ddf943286783e80b243340534a71780b92b9fffe318fab1e2a47f7d`。首轮构建类型失败和未覆盖成功的旧曲线中断冻结分别保留，不拼接结论。scope helper六项已计入上述32项。真实窗口失焦、其他曲线/依赖/全部锁矩阵仍未关闭。

### 2 · 保存失败、持续配额错误与恢复

`save-recovery-ux.spec.ts`桌面持续QuotaExceededError及390px UnknownError两条正常UI旅程，原生IDB projects put/add在真实事务内抛出。失败后当前revision/撤销/完整资源保留，普通提示关闭不隐藏恢复栏；三个按钮实际命中可用，当前备份与直接恢复备份一致，第二页冷开原保存分支未变；持续错误下重试与fresh副本均失败且不切工程，写命中仅put/put/add，无自动重发。解除故障后桌面显式重试、390px另存fresh revision0副本成功，原工程与副本分别冷开核对完整包hash。

增加空间不足的可行动说明：先备份，释放可用空间后再重试，另存也需要空间。正常构建 `ux-five-build-step2.log`退出0；该修正包最终 `save-recovery-final.log`两条2/2通过（退出0）。修正前两条也通过，仅证明原有保全行为；中间verified运行因preview监听IPv6而IPv4连接被拒绝，两条均未进入产品，改为显式127.0.0.1后完整重跑，不计产品缺陷或通过。新修正包源码manifest `ux-five-step2-source-manifest.json` SHA256 `a5a94711fd626d71c4da36b7b6b01498a50c4772908c729d534626cf9f15adfc`；dist `ux-five-step2-dist/` SHA256 `9bfc65dd5b91e83be19b24f88bd699e739d3f4e10b8dee4d0a85a72be815e65f`。事实、截图、实际备份保留 `save-recovery-final-browser/`。这不是实际磁盘耗尽、跨页CAS或全部存储故障矩阵。

### 3 · 历史读取、锁来源与保护点失败

生产红测 `history-recovery-red.log`复现拒绝只显示随机物件ID（退出1）。UI边界只映射已知历史编辑锁错误，沿当前真实锁闭包显示对象及实际锁定图层名称，并提示解锁再预览；AbortError/存储/连续性/普通依赖错误保持。未改领域校验、锁、恢复事务或历史内容。疑似手动刷新自身busy造成ticket竞态未在本次旅程复现，未据此修改。

修正包 `history-recovery-verified.log`桌面1512×982与390×844两条2/2通过（退出0）：原生historyHeads.get单次UnknownError保留旧快照、搜索和勾选并能显式重读；物件锁和图层锁分别可读拒绝，解锁后预览取消保持完整包；historyPins.add(kind=protection)单次Quota错误回滚，无新保护点、不采用、不改变revision/可用撤销；重新预览采用后恰有一个保护点、一次撤销和整页冷重开完整包hash一致。首轮修正后2条失败是测试在候选禁用undo期间误取undo基线，改为候选前取值后原旅程完整重跑，记录保留。

`history-recovery-unit.log`两文件10/10通过，含真实锁来源和完整历史保存失败；`history-source-continuity-unit.log`2项通过/24未选中，补来源删除与重开连续性失效（应用层，非生产UI证明）。正常构建 `ux-five-build-step3.log`退出0，源码 `ux-five-step3-source-manifest.json` SHA256 `c2beb7d41902f593640641ff131c41c9745a5cb8b04dabd8c5308c0fbc5d6c82`；dist `ux-five-step3-dist/` SHA256 `0442c7b32ffb79bc8157863d2e607cd817818039d80b174ac99de10aa089c595`。附件 `history-recovery-verified-browser/`保留实际备份/截图/故障事实。全版本恢复故障、跨页删除来源、所有建筑/支撑/跨层组合、读屏/P3仍归完整验收。

### 4 · 运行中取消、迟到结果与显式重试

生产红测 `generation-cancel-red.log`在真实Worker消息已计算但投递被暂存时，复现自然地形Esc未取消进度（退出1）。Workbench补自然/组合运行中terrainAbort及区域regionalAbort的Esc入口，调用各自现有epoch/abort/候选清理并消费事件，窄屏抽屉不抢先关闭，输入框守卫保持。

`generation-cancel-first.log`同一修正包9/9通过（退出0）：室内/森林/火山桌面、混合390px四例各取消后显式再请求，第二请求运行中投递上一轮真实原生Worker消息不能生成候选/结束新任务，投递新一轮真实结果才成功；自然桌面、组合桌面/390三例运行中Esc、旧消息释放无写入、参数保留与显式重试；原组合按钮取消/失败后显式重试两例复验。事件门只保存真实MessageEvent及原payload，不造成功结果；原生messageerror处理器定向注入失败，非真实系统崩溃。完整包hash、revision/撤销、资源及四域冷开均核对。

区域 `regional-cancel-first.log`桌面/390两例2/2通过（退出0）：原生256px PNG实际编码并验证签名/IHDR后仅延迟fulfillment，Esc取消后释放原Blob不继续准备第二素材或候选，工程/备份保持；显式重试放行新的真实PNG后资源全验候选成功，再取消保持。此证据只覆盖资源准备阶段，不证明同步几何计算可抢占，也不外推其他浏览器。

`generation-cancel-clients.log`3文件96/96通过，含Worker取消/超时/迟到、服务端请求/流取消/身份拒绝/无自动重试（测试传输，非线上服务实测）；`generation-local-region-cancel.log`本机局部/区域4项通过、20未选中。正常构建 `ux-five-build-step4.log`退出0；源码manifest `ux-five-step4-source-manifest.json` SHA256 `c5297ab4f430115bbf471817172e7f34f0ab5f87db3a5ff87b41504761e4e572`，dist `ux-five-step4-dist/` SHA256 `e2535ae6e36bcd76baf626837dccbfb2a9b81b5886e42f33a1d407e246006251`。额外区域测试源在最终构建冻结补齐；本包代码已含同一regional Esc实现。真实服务端负载/停止传播、全部本机局部运行中UI和完整失败矩阵仍归09，不混作本轮11条生产检查的覆盖。

### 5 · 组合/成员选择、填充柄与键盘窄屏

最初红测因canonical成员顺序被误当放置顺序，断言错误的固定Y值而失败（`fill-handle-red.log`），改为读取该真实成员的历史Y后继续原旅程。随后 `fill-handle-interruption-red.log`明确复现合成window blur后fill overlay仍存留、捕获拖动没有取消（退出1，`blur-handler-events.json`标记trusted=false），原生lostpointercapture/Esc/范围外松手已走通。该合成事件只证明处理器联动，真实窗口失焦仍未测成。

填充拖动保存实际SVG owner，统一在取消/失捕获/失焦/会话关闭/卸载时清草稿并释放捕获，避免后续松手提交旧报告；填充柄取得地图键盘焦点，触控手势不交给页面滚动。单次采用与完整领域校验/预算未变。

`fill-handle-first.log`同一修正包桌面1512×982与390×844各两条4/4通过（退出0）。正常UI两灯建固定组合→画布整体/成员选择→成员人工位移/旋转→真实拖柄两份2m复制→按钮/Esc取消完整包保持→展开真实长字段→Tab到可见采用按钮并Enter采用→一次撤销/重做→整页最近工程冷重开。完整比较原对象、fresh复制ID/出生、成员overrideFields、Floor支撑/公开visibility、固定源/定义/资源/许可hash。中断旅程分别覆盖原生capture loss、Esc、范围外松手和合成blur；每次中断后重新真实拖动预览/取消可恢复，revision/撤销和完整包保持。窄屏无横向溢出，长摘要按钮实际可见，截图 `group-fill-long-review-keyboard.png`已人工查看。公开Floor样本不证明gm成员/秘密支撑及完整玩家像素矩阵。

正常构建 `ux-five-build-step5.log`退出0，源码manifest `ux-five-step5-source-manifest.json` SHA256 `ac9162cd052644856c4f78a80f7cb3608ebb287677fbe5c677bd2ffce7dae4d0`，dist `ux-five-step5-dist/` SHA256 `82d37c311132962e32404cc3992d124109e078d032da0932d4aa06b9a6beb453`。fill/selection定向3文件14/14通过（`fill-handle-unit.log`退出0），新增测试完整类型检查通过（`ux-five-added-tests-typecheck.log`退出0）。期间发现另一容量任务标记为diagnostic-normal-production-ui；本轮只报告功能一致性，不引用并行诊断耗时或任何正式性能结论。该任务与无关容量编辑均未修改/停止。

### 最终整合复查

当前工作区正常构建 `ux-five-workspace-build.log`退出0，源码完整冻结 `ux-five-final-source/`（独立todo.md未包含）、manifest SHA256 `10a873ea2a6573d4de9794c86cf70d2348b3781437f6b3cc9b97c8df74119a28`；正常dist冻结 `ux-five-final-dist/` SHA256 `82d37c311132962e32404cc3992d124109e078d032da0932d4aa06b9a6beb453`，与第5项修正包逐文件一致。最终运行时源码src/services与该冻结比较无漂移；期间无关容量测试夹具变化未覆盖或回退，独立todo.md SHA256仍为 `c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`。

`ux-five-final-regression.log`在此最终生产包复查曲线正常提交两视口及1512/900/390键盘长摘要/抽屉/冷开三例，5/5通过（退出0）；第5项4条旅程使用相同dist，其他项目仍按各自冻结分别记录，不把不同包数字合成整体验收。新增链接检查386个本地链接零错误、全工作区git diff --check通过。服务继续在Codex侧栏本机5191提供最终包，未操作个人浏览器。未提交、推送或发布。

开发授权的1–5完成；后续为第6项的双受众交付/玩家秘密完整旅程，再补真实窗口失焦、中文输入法、辅助技术和用户视觉P3，完整项目验收仍从09执行。

<a id="ux-export-native-20261106"></a>
## 双受众交付与原生交互接续（2026-11-06）

用户授权完整导出/玩家秘密→真实失焦、中文输入法、读屏；随后明确页面操作仅用Codex侧栏，停止独立可见测试窗口。未改运行时代码，独立todo.md及无关容量修改保留；整体验收/用户视觉P3未关闭。

### 完整导出与玩家秘密

复用上一节正常生产包`work/ux-audit/ux-five-final-dist/`，集合SHA256仍为`82d37c311132962e32404cc3992d124109e078d032da0932d4aa06b9a6beb453`，本机5191/sceneweave提供；运行时src/services与已冻结源码逐文件相同。新增`tests/export-privacy-ux.spec.ts`只走正常UI/真实下载和图片解码，不注入DEV、SceneDocument或IndexedDB。测试文件hash记录在`work/ux-audit/export-privacy-test-manifest.json`。

最终命令`SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5191/sceneweave/ npx playwright test tests/export-privacy-ux.spec.ts --workers=1 --reporter=line --output=work/ux-audit/export-privacy-verified-results`：`export-privacy-verified.log`退出0，2/2通过，Chromium141.0.7390.37，1512×982与390×844。两条均包括：首页新建18×12m、公开房间/注记与固定遮罩对照→gm房间和真实房间支撑的gm桌灯→gm注记、附着私密房间的公开注记→公开房间墙上未揭示秘密门→玩家/主持人PNG与完整备份→拒绝删除唯一遮罩→全新空存储浏览器上下文导入实际备份→刷新后从最近工程冷开→再次备份/双受众出图。实际PNG已目视检查，公开房间/文字保留，主持人图显示暗门和私密内容。

- 两视口玩家PNG均为4096×2731；加入秘密前后完整PNG字节相同，RGBA SHA256均为`6a4dfd20ca7fcd6148600d84c7014f0a17de4df5cbda511f3e3b6e3db1cc821f`；主持人RGBA为`7c735cabb9858a61f4bad35cab661f57acd3217bf98f5f542b6b22024a77d90b`。固定遮罩内部3297856像素全部为[216,213,197,255]，异常0；容器仅IHDR/sRGB/IDAT/IEND，无文本、EXIF、ICC、时间或尾随字节。
- 私密房间、gm物件和实际supportRef、secret/revealed、三种注记及资源均在真实备份中。40个归档文件经全验导入独立sceneId/r0，按合同只更新当前场景身份/revision/创建与修改时标，其余文档、identity/appearance及资源/许可文件保持；冷开后的完整归档逐文件hash与导入副本相同，双受众图片也与导入前相同。
- 删除唯一遮罩在结构候选注册前即明确拒绝，未产生候选或下载；拒绝前后完整包hash一致。此行为早于PNG导出，不能记录为“已生成无罩工程后导出拒绝”。两页均无pageerror及横向溢出。
- 实际包、PNG、逐文件hash与像素事实位于`export-privacy-verified-results/*/`的`complete-secret.sceneweave`、`fresh-import-cold.sceneweave`、`player/gm-secret.png`及`export-privacy-facts.json`；补充`export-privacy-unit.log`中图片字节、连接投影、渲染边界23/23通过，退出0。

探索失败保留：首次`export-privacy-run.log`因错误等待“删除遮罩后候选”而主动停止，退出130；`export-privacy-final.log`2例断言失败，原因是脚本错误要求导入副本sceneId/revision/时标与原工程完全相同。核对仓库导入合同后修正为仅允许这四项信封变化，最终相同旅程2/2通过；未因测试前提错误修改产品。

本次不覆盖所有地形/曲线/组合/散布/近侧视私密矩阵、历史包所选快照、VTT目标软件导入或用户P3；不把两条交付旅程外推为完整保密/UX验收。

### 真实失焦、中文输入法与读屏

真实失焦预检使用临时独立profile的headed Chromium和raw CDP，在自建两窗口间切换；`native-blur-raw-cdp-preflight.{mjs,json,log}`记录可信blur、hasFocus=false及恢复focus。Playwright普通页面存在自身focus emulation，单独CDP session关闭不能消除；该预检不等于产品曲线/填充通过。产品旅程的`native-window-blur-first/second/third.log`保留启动/页面时序及粘滞焦点模拟等失败/中断，没有完成可签收产品证据。用户要求只用侧栏后立即停止独立窗口运行，未完成脚本仅保留在ignored work下，不进入默认测试套件。

`native-input-preflight.py/json`通过macOS26.6.2原生只读API实测AXIsProcessTrusted、CGPreflightPostEventAccess、CGPreflightListenEventAccess均false。TIS在不同前台应用/时点观察到ABC或搜狗拼音，不能据此声称取得中文候选；没有真实拼音修改、Enter确认、Esc取消的证据。

VoiceOver实际启动尝试记录于`voiceover-live-preflight`与`voiceover-starter-preflight`文件。直接进程启动未取得已注册读屏，正式Starter只打开首次使用Quickstart向导；未取得实际网页导航/朗读输出，不以ARIA或注入朗读代替。清理时直接终止向导未复原开关，直接偏好写入被系统拒绝，native stop/preference调用也未恢复；最终向本轮启动的Quickstart发送正常Quit，退出处理器恢复初始voiceOverOnOffKey=0，无向导/VoiceOver或独立测试浏览器残留，事实见`restore-voiceover-off.log`与最终JSON的restoration。未修改辅助功能/自动化/输入监听授权。

真实产品窗口失焦、中文输入法和读屏均继续待实测；后续页面只用Codex侧栏，不能在该入口取得的原生证据明确留空，不继续弹出独立窗口。未完成窗口脚本已移至`work/ux-audit/native-window-blur-paused.spec.ts.txt`，停止与清理状态见`native-window-blur-stop.json`。类型检查`export-native-typecheck.log`及移除未完成用例后的`export-native-final-typecheck.log`均退出0；本地文档链接402项零错误，git diff --check通过。本轮仅新增回归和窄范围文档，不提交、推送或发布。

<a id="ux-regression-sidebar-recheck-20261106"></a>
### 已知失败复验与侧栏原生能力复核（2026-11-06）

用户授权按“已知失败复验→后续修复分块提交→侧栏原生实测”执行。本次从`90dd8ea`捕获16个后续改动文件，再纳入默认浏览器发现范围修复，在`work/ux-closeout-20261106/workspace/`的独立完整源码副本验证。Node为24.14.1；17文件内容、起始提交与SHA256保存在该目录上级的`manifest.json`，验证后均与提交内容逐文件核对。没有读取用户工程库、调用模型、执行正式性能或启动浏览器。

| 检查 | 当前结果与证据 |
| --- | --- |
| 迁入与内容块 | `migration-recheck.log`退出0，17/17通过；原7项失败转绿，并覆盖真实物理清单/块闭包、中断后精确重试、坏块/额外块拒绝、源只读保全与冷读后发布。修复不放宽额外记录或篡改拒绝 |
| 正式完整Prop夹具 | `formal-fixture-recheck.log`退出0，8/8通过；原2项mixed断言改为明确检查专用人工簇的manual/deleted/detached记录，并核对每个原簇的参数、槽位和排除保全，不要求所有原簇都有删除成员 |
| 手工预算与AI阶段 | `budget-regression-recheck.log`14/14通过；`authoring-regression-recheck.log`只运行受影响的两项跨内部步骤用例，2通过/12跳过，不代表完整AI组。本轮定向用例合计41通过 |
| 构建与工具 | `normal-build.log`退出0，正常TypeScript/服务类型/Vite构建通过；`formal-tool-typecheck.log`退出0，额外检查正式工具TS入口；3个mjs语法检查通过，所检凭据模式无命中 |
| 浏览器发现范围 | `browser-list-before.log`保留缺少正式夹具导致默认枚举失败；默认配置明确排除正式视觉专用spec后，`browser-list-after.log`退出0，264项/95文件。专用配置借用既有夹具清单的`formal-browser-list.log`退出0，12项/1文件；两次均仅枚举，不启动浏览器，也不证明夹具字节/像素或任何正式旅程通过 |

源码修复分为`ebf4543`迁入、`851405d`预算/阶段测试和`49c1243`正式工具与默认发现隔离三个本地提交；未推送或部署。固定外观源保全及正式运行说明随工具提交，但工具静态检查不抵扣09的正式采样、视觉或P3。

原生复核为本机macOS26.6.2只读API调用，2026-11-06 08:21:17 UTC记录于`work/ux-closeout-20261106/native-sidebar-capabilities.json`：输入源为搜狗拼音；`AXIsProcessTrusted`、`CGPreflightPostEventAccess`、`CGPreflightListenEventAccess`均false；VoiceOver自动化无提示预检为-600，进程未运行。未启动VoiceOver或向导、未请求系统权限、未发送键盘/鼠标事件或修改系统设置，原预检证据未覆盖。

当前可用工具仅能通过`open_in_codex`打开侧栏UI，没有侧栏页面点击、按键、拖动、DOM/事件观察或实际朗读采集接口。因此未能开始真实产品曲线/填充失焦、原生拼音候选确认/取消和VoiceOver网页导航旅程；三项继续待实测，不判断为产品缺陷或通过。后续须具备现有侧栏的真实操控与证据采集能力，或由人在同一侧栏实际操作并记录事实；仍不得回退到独立窗口、合成事件、直接填汉字或ARIA替代。已有交付像素与键盘通过事实保留各自旧冻结，本次不扩大其范围。

<a id="ux-full-journey-review-20261106"></a>
### 全旅程复核与Esc保护收口（2026-11-06）

用户要求完成剩余体验检查。范围为本会话页面工具/分类、完整操作旅程及原生交互/P3接续，不扩大为项目整体验收。起始提交`178c132`，独立源码副本和正常生产构建在`work/ux-final-review-20261106/workspace/`；只叠加本轮`Workbench.tsx`、`WorkspaceHelp.tsx`与新增旅程用例。起始无关`terrain-candidate.test.ts`不叠加、不修改；后续并行正式工具与视觉spec改动也未纳入本冻结。

最终源码/用例/正常dist逐文件指纹见`work/ux-final-review-20261106/final-source-manifest.json`：运行时集合SHA256 `1a0acd94b9b10f5f8416027d51ae3567986ee32d8e4b3ff3e963af914a957a84`，dist集合SHA256 `0d9423de4164a610d20f23b6bf2a8618bf44570d431e309e4f0fb539c5736403`；集合值为排序路径→文件SHA256映射的紧凑JSON摘要。Node24.14.1、隔离Chromium141.0.7390.37；没有可见外部浏览器、用户库读写、模型调用或正式性能采样。页面可在Codex侧栏的5193查看；后台自动化使用独立临时context。

**发现与修复**：原导出details没有局部Esc处理，生成候选存在时按Esc会取消底层候选而菜单保持展开，`escape-red.log`退出1保留实证。菜单现在只关闭自身、阻止冒泡并把焦点返回summary，保留候选与revision。首修后`journey-fixed-first.log`又复现合成组合状态Esc先进入全局候选取消分支，组合检查现移至监听器入口；独立新建/打开对话框监听器另有相同遗漏，`modal-ime-red.log`退出1复现新建表单消失，现补同样isComposing/229前置守卫。帮助的局部Esc同时补229判断。合成事件只证明处理器保护，不证明真实中文输入法。

| 检查与冻结 | 实际结果 |
| --- | --- |
| 改前主旅程基线 | `baseline-journeys.log`退出0，键盘三视口及双受众完整秘密交付共5/5通过；这是修复前冻结，不与最终结果相加或当作修复后完整秘密复验 |
| 最终正常构建 | `normal-build-final.log`退出0，含应用/测试TypeScript、服务类型及正常Vite构建。构建仍有既有大块体积提示，不作加载/性能达标结论 |
| 完整旅程与键盘回归 | `final-verified-journeys.log`退出0，同一最终dist、单worker、零重试，`complete-journey-ux.spec.ts`桌面1512×982和390×844两项、`keyboard-narrow-acceptance.spec.ts`1512/900/390三项，共5/5通过 |
| 实际内容与交付 | 每条完整旅程经正常UI创建原空白工程、真实Worker生成2房间/9物件独立工程、属性面板移动物件X 1mm，一次撤销/重做、实际保存后刷新并从最近工程重开。完整包条目hash保持；双受众4096×2731 PNG实际下载；空存储用文件选择器导入，fresh sceneId/r0与时标按合同重置，其他文档、identity/appearance、资源文件hash、manifest.assetRecords/licenseBindings保持。每组保留original/generated/edited/undone/redone/cold/imported完整包及`journey-facts.json`，无页面异常或生成HTTP请求 |
| Esc和输入保护 | 新建名称中的合成isComposing/229 Escape均保留表单/输入；普通Escape关闭新建并保留原工程。候选期间帮助与导出Esc返回入口且保留候选；组合状态及229均不关闭浮层/取消候选。原三档键盘流程复验通过 |

最终附件在`work/ux-final-review-20261106/final-verified-results/`。七个资源分类、首页、新建、生成表单/候选、画布、导出和导入截图已核看，实际截图点均无页面横向溢出；窄屏抽屉及菜单未见本轮阻断。该观察只覆盖所列取景，不作整个视觉规范或P3签收。截图切换页及可下载的本轮真实备份位于`work/ux-final-review-20261106/review/index.html`（本机5194）；原曲线/组合填充的已记录备份另作为人工实测样例，来源/hash在`review/native-samples.json`，不算本轮原生通过。复核页所有人工项默认待实测，只有人填写后才可下载观察JSON，不自动签收或写回项目状态。

最终用例修正后`final-typecheck.log`退出0；收口逐文件核对工作区运行时与所选测试均和冻结一致，见`closeout-facts.json`。复核材料页另在隔离无界面浏览器1200/390px检查图片切换、无横向溢出及四个人工项默认均pending，`review-gallery-facts.json`保留事实；已查看页面截图。文档416个本地文件链接目标与新增证据锚点检查通过，git diff --check通过。侧栏打开请求返回queued，实际材料页在人重新显示本会话时出现，不以该返回判断人工已查看。

**首次失败和准备记录保全**：`journey-fixed-final.log`桌面通过/窄屏失败，后者是生成保存标签先出现、完整工程收尾超过脚本8秒等待；改为显式等待busy消失后`verified-journeys.log`5/5通过，该包仅包含首修。补独立对话框/帮助守卫后的`final-journeys.log`4通过/1失败，桌面断言同时命中工程h1与属性h3；限定level1后最终同轮5/5通过，不修改产品规避断言。准备时第一次将修正构建放进前次隔离目录，已恢复前次源文件和dist，12项资产名称/大小与原清单逐项一致，见`baseline-restoration-check.json`；随后一次相对路径拷贝失败产生的旧源码构建另保留为`normal-build-before-modal-overlay.log`，不算最终证据。最终使用本轮独立目录并逐文件核对实际叠加与dist。

**仍未完成**：当前工具只有打开侧栏，没有页面按键/拖动/DOM事件观察或实际朗读采集接口；本轮未改变系统权限或启动VoiceOver。真实中文输入法确认/取消、曲线/填充在真实系统失焦下回滚和重启、VoiceOver网页导航/实际朗读均未取得事实，继续待实测；P3依项目约定由用户签收。复核材料已经具体准备，下一接续为取得这些实际人工观察，有问题后只修复/复验影响范围。完整秘密、多领域/跨浏览器/故障与正式性能仍按09各自执行，不由这5项关闭。独立todo.md SHA256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`，未提交、推送或部署。

**后续用户决定与当前观感评审**：用户明确“这个不验了”“123，然后我们主要看4”，故中文输入法、真实失焦和VoiceOver保留未运行，本轮不再安排人工实测；不将判断或已有合成事件写成真实通过。当前实际重看最终桌面外观/工程与390px生成/素材库截图，并核对`VisualPanel.tsx`、`ProjectTitleForm.tsx`、`visual.css`和`unified-workbench.css`。七模块分类与浅色绿系可保留；外观面板和工程改名保留默认浏览器表单样式、常用与技术参数层级弱、小字号浅色说明偏多、窄屏多排工具与导航挤占首屏，是当前视觉整改建议。未改产品代码，也未作新的功能/性能通过结论。侧栏5194材料页现聚焦七分类截图与上述观感问题，移除前三项人工表单；原材料页另保全在`work/ux-final-review-20261106/review-before-focus4.html`。用户P3仍为未签收，下一实施优先级集中在07的当前UX接续。

<a id="ux-panel-unification-20261106"></a>
### 面板样式、外观层级与窄屏空间统一（2026-11-06）

用户授权按上述观感评审整改，并以截图指出左侧“视觉创作”字体与其他区域不一致。本次统一当前工作区面板的字体、标题/标签/说明层级、表单控件与按钮；独立`workspace-controls.css`限定在当前工作区，保留既有数字字段的单位后缀和素材搜索结构。外观改为“外观与氛围”及六项分段入口，常用参数优先，坐标/采样/阴影/相位等精细设置默认折叠；地形材质过渡只在边界内展开且组件保持挂载，跨子工具不清草稿。窄屏缩减顶部/任务入口间距，“展开全部面板”“重置布局”收进“布局设置”，执行后自动收起并返回焦点；Esc只关闭设置，组合状态/229不误取消。数据模型、单位、命令、候选校验和保存事务未改。

起始提交`178c132`，源码和正常生产构建独立冻结于`work/ux-panel-unification-20261106/workspace/`，此前`ux-final-review-20261106/workspace/dist/`保留作对照。最终逐文件内容与正常dist见`final-source-manifest.json`：运行时集合SHA256 `352ccc0054c46155e09eaa33d832fce3f6f7bbaca8fce3fdc4185a5797a5a85f`，dist集合SHA256 `8abeaecf7d9b724a01a2915d16955ad31b14f18bfd34805ca3d1006b97654dd5`；集合值为排序路径→SHA256映射的紧凑JSON摘要。Node24.14.1，隔离Chromium141.0.7390.37。无关正式性能工具、正式视觉spec及地形候选单测改动未叠入此冻结；最终运行时代码逐文件与当前工作区一致。

| 必要自检 | 本次实际结果与范围 |
| --- | --- |
| 正常生产构建 | `build.log`退出0；初次构建、标题排版调整及菜单关闭前的构建分别保留，不用首轮结果替代最终冻结。既有打包体积提示不算正式性能结果 |
| 面板与草稿 | `panel-appearance-ux.spec.ts`桌面1512×982、390×844两条通过。真实UI新建/放置/完整备份，七模块与六外观子工具取景；工程改名和灯光强度控件的实际字体完全相同、字号12px、圆角6px、高度36px。过渡距离采样默认隐藏，展开填450后切换仍保持；灯光0.35切换保持。预览后布局设置Esc关闭并返回焦点、底层候选保留；取消预览、布局全部展开/重置与刷新最近工程冷开后完整备份逐条目hash保持 |
| 键盘与窄屏复查 | 既有`keyboard-narrow-acceptance.spec.ts`1512/900/390px三条通过，覆盖真实键盘、抽屉/帮助/菜单、长候选摘要可达、取消保全及完整包冷读。与上面两条在同一最终dist、单worker、零retry同轮5/5通过，`final-browser.log`退出0；附件`final-results/`保留实际备份、截图和控件事实。菜单自动关闭前另两项/三项通过的日志与附件保全在`before-menu-close-*`，不与最终轮相加 |
| 同图视觉对照 | `capture-comparison.mjs`通过正常文件选择器将同一真实室内包分别导入改前5193和改后5195的隔离空存储页面，选择相同物件，取工程、生成、外观边界/环境/灯光五种状态及桌面/390px共20张截图；关闭有限动画后再取最终状态，首轮过渡帧另存`comparison-before-settle/`。最终附件`comparison/`、输入包hash/浏览器/取景尺寸归`facts.json`，日志`comparison.log`退出0，无页面错误或页面横向溢出。已核看七模块/六子工具及同图重点状态，未见本轮阻断；不作用户P3签收 |

侧栏5194材料页更新为同图改前/改后切换与重点变化说明，并链接正常5195工作区；原观感评审页保全为`review-before-unification.html`，旧截图未覆盖。全部浏览器自动化为隔离后台context，没有启动用户浏览器或独立可见窗口、读取用户库、调用模型或执行正式性能。中文输入法、真实系统失焦和VoiceOver仍为“未运行；用户决定本轮不执行”，不再索取这三项人工结果；用户P3及其他独立验收未关闭。独立`todo.md` SHA256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`；未提交、推送或部署。下一接续为具体页面观感反馈与对应范围修正。

<a id="ux-panel-polish-20261106"></a>
### AI面板、按钮状态与铺装草稿细调（2026-11-06）

用户继续授权前端体验整改。本轮将AI对话的标题、图标和留白对齐共用面板基线，统一面板按钮与字段的键盘焦点，以及主次按钮悬停和禁用状态；另复现铺装子工具切换导致目标与未采用参数丢失，改为隐藏而不卸载铺装表单，保留目标、参数、局部覆盖和原生details展开状态。外层禁用、会话revision/重置、预览/采用/取消仍按原规则执行，未改模型、生成算法、命令、存储或AI请求行为。

本轮运行时仅在上一节冻结上调整`AiConversationPanel.tsx`、`VisualPanel.tsx`、`workspace-controls.css`和`visual.css`，新增`tests/panel-polish-ux.spec.ts`。源码与正常生产构建独立冻结于`work/ux-panel-polish-20261106/workspace/`，逐文件清单归`final-source-manifest.json`：运行时集合SHA256 `ddb4ef2c1aded7dd69a73945e5ac57c2b28715cfdff97314053fc55cecf9c57c`，dist集合SHA256 `a7803ac614c872bc70658146f115ae0724c76242f9deb3381f32c567a1f816fc`，集合算法与上一节相同。起始提交仍为`178c132`，Node24.14.1、隔离Chromium141.0.7390.37；无关正式性能/视觉及地形候选测试编辑未叠入冻结，前轮源码/dist和失败附件均保留。

| 必要自检 | 实际结果与范围 |
| --- | --- |
| 改前反例与脚本校准 | `before.log`首次因错误地精确匹配“对齐”标签而超时，属于定位器问题；改为在相位区域查找唯一combobox后，`draft-red.log`在上一节正常5195生产包实际复现：修改铺装并切换子工具后，原房间目标变为空，退出1。修复前附件在`draft-red-results/`，未把脚本失败记为产品缺陷 |
| 正常生产构建 | 独立冻结目录执行`npm run build`，`build.log`退出0。既有Rollup/包体积提示保留，不作性能达标结论；修正包由5196/sceneweave提供 |
| 新增桌面/窄屏旅程 | 正常UI新建有真实材质的房间，设置铺装目标、纹理宽2100/高1700mm、方向22°、表面对齐和相位725/-250mm、局部覆盖透明度0.25；跨环境/灯光/滤镜/边界及工程/AI模块浏览后，全部草稿和展开状态保留。真实预览并取消后完整备份逐条目hash保持。AI/工程主标题实际字体、15px字号、600字重及颜色一致，AI左右内边距桌面16px/390px为14px，连接按钮36px；真实Tab/Shift+Tab核对按钮与字段焦点均为2px同色环，原生disabled保持、透明度0.55，未选工具悬停有反馈。只填本地占位地址/凭据，不点击连接，AI网络请求为0 |
| 同包回归 | `SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5196/sceneweave/ node node_modules/@playwright/test/cli.js test tests/panel-polish-ux.spec.ts tests/panel-appearance-ux.spec.ts tests/keyboard-narrow-acceptance.spec.ts --workers=1 --retries=0 --reporter=line --output=work/ux-panel-polish-20261106/first-results`，`first-browser.log`退出0。新增1512/390px两条、既有面板两条及1512/900/390px键盘三条，同一最终正常dist共7/7通过；不与上一节5/5相加。真实工程包、截图和`polish-facts.json`保留在`first-results/`，无页面错误或页面横向溢出 |
| 同图视觉对照 | `capture-comparison.mjs`以正常文件选择器把同一真实室内备份分别导入改前5195/改后5196的空存储context，选择同一物件；工程、生成、AI、边界、环境、灯光、铺装七种状态与1512/390px共28张截图。输入包SHA256 `84fa4810b257d4215632a1b4c91e5189c8627c42a52fed89beadcbf81a4ac08b`，取景与错误事实归`comparison/facts.json`，`comparison.log`退出0，无页面错误或页面横向溢出。已目视核看桌面/窄屏AI及铺装重点截图，未见本轮阻断；不替代用户P3 |

侧栏5194材料页更新为本轮七种状态的前后对照，默认显示改后AI，实际工作区链接改为5196；上一轮页面另存`review-before-polish.html`，`unification-*`及更早截图均保留，本轮图片使用`polish-*`前缀。材料页只提供截图与真实样例下载，不自动写入验收状态。后台检查不启动用户浏览器或独立可见窗口，不调用模型，也不采集正式性能。

收口另用隔离无界面浏览器在1200/390px检查材料页的七状态、两种截图尺寸及前后切换，28组图片加载检查通过，无页面异常或横向溢出；旧页/样例链接和5196实际工作区入口可读取，事实归`review-smoke.json`，材料页截图已核看。侧栏打开请求返回queued，不据此判断用户已查看。`closeout-facts.json`记录694个运行时文件、15个叠加文件及86个dist文件与最终清单无漂移；五份相关文档474个本地链接、其中392个Markdown锚点检查零错误，`git diff --check`通过。

本轮开发整改及上述必要自检已完成，下一接续为具体页面观感反馈与对应范围修正。中文输入法、真实系统失焦、VoiceOver仍为“未运行；依用户决定本轮不执行”，用户P3尚未签收，其他验收继续按09各自执行。独立`todo.md` SHA256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`；未提交、推送或部署。


<a id="ux-library-inspector-20261106"></a>
### 素材库卡片与属性面板视觉统一（2026-11-06）

用户授权继续完成素材库与右侧属性面板细调。本轮运行时仅在上一节冻结上修改`src/editor/main/workspace-controls.css`：将素材分类/类型、卡片选中、放置/添加、来源详情、管理入口和空状态对齐工作区绿系基线，区分悬停与选中；属性面板统一标题、名称、说明、事实及数值字段的层级和间距。卡片采用勾选/内容/操作三列，名称与尺寸正常换行，较长的外部添加操作独占下一行；卡片缩略图桌面58px、窄屏52px，详情128px及精修对照84px保留。缺缩略图的警示颜色保持。共用字段选择器以同义的`:not(...)`列表降低特异性，让既有搜索/单位控件去除内部边框的规则正常生效，保留外层边框及焦点。没有修改筛选、浏览/勾选、放置、编辑、模型、命令或保存语义。

独立冻结位于`work/ux-library-inspector-20261106/workspace/`，起始提交`178c132`并叠加前轮15个运行时文件，最终运行时代码逐文件与当前工作区一致；无关正式性能/视觉及地形候选测试编辑未叠入。`final-source-manifest.json`记录694个运行时文件、15个叠加文件及86个dist文件，运行时集合SHA256 `f434e18beac4f0f9d43e59824ef727d75284cb9fee4ccc844359ed445e3879b4`、dist集合SHA256 `31d64547ad087219ed253b454f7718e277ddd4c113104d84e129be7ac87542d7`，集合算法同前节。Node24.14.1、隔离Chromium141.0.7390.37；5196保留上一轮基线，5198提供本轮最终正常生产包。

| 必要自检 | 本轮实际结果与边界 |
| --- | --- |
| 正常生产构建 | 冻结目录`npm run build`退出0，最终日志`build.log`；既有Rollup/体积提示保留，不作性能结论。调整卡片密度与换行前的构建另存`build-before-density.log`及`build-before-card-wrap.log`，不用中间结果替代最终冻结 |
| 同图视觉与卡片可操作性 | `capture-comparison.mjs`从正常文件选择器将同一真实室内包导入改前5196/改后5198的空存储context，选同一物件；1512/390px各取属性、素材库、详情和筛选空状态，共16张最终截图。输入包SHA256 `84fa4810b257d4215632a1b4c91e5189c8627c42a52fed89beadcbf81a4ac08b`；最终`comparison-final-wrap.log`退出0，`comparison/facts.json`记录无页面错误/横向溢出，两档各24个名称/尺寸文本框无横向溢出，放置按钮与内容分列，搜索内框实际为0px。已目视核看最终桌面素材库、窄屏属性与详情；只作为本轮开发观察 |
| 浏览与取消保全 | 两档正常UI导入后导出完整备份，再浏览/勾选素材、打开详情、筛选至空状态、清空筛选、进入放置并点击实际“取消放置”。清空筛选后仍选中1项；操作前后两组完整包各75个条目hash逐项相同，包含场景、身份、外观、源、资源与许可；没有注入工程或直接读写用户数据库 |
| 最终同包回归 | `SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5198/sceneweave/ node node_modules/@playwright/test/cli.js test tests/panel-appearance-ux.spec.ts tests/panel-polish-ux.spec.ts tests/keyboard-narrow-acceptance.spec.ts --workers=1 --retries=0 --reporter=line --output=work/ux-library-inspector-20261106/final-results`，`final-browser.log`退出0，7/7通过：1512/390px面板两条、铺装/按钮两条及1512/900/390px键盘三条。前密度5项和前换行7项日志/附件独立保留，不与本轮相加 |
| 中间观察与修正 | 首轮卡片仍显疏，收紧后发现共用按钮的`white-space:nowrap`导致长名称越过操作区，最终显式恢复内容换行并重新构建/取景/回归；中间截图保存在`comparison-before-density/`及`comparison-before-card-wrap/`。详情/精修缩略图限定范围后未被卡片尺寸覆盖。探索脚本的页签/开关定位错误保留作脚本失败，不记为产品缺陷 |

侧栏5194材料页继续复用，默认素材库；新增当前轮属性、详情及空状态，最终16张图片用`library-final-*`前缀，中间`library-*`及早期图片保全。AI/外观/工程/生成七种状态明确标为前轮对照，实际可操作入口指向5198；前轮完成页保留为`review-before-catalog.html`。浏览器检查全为隔离无界面context，不启动用户浏览器或独立可见窗口、调用模型或采集正式性能。

收口时在1200/390px检查11种状态与两种截图尺寸，44组图片加载/切换检查通过，无页面错误和横向溢出，旧页、样例及5198入口可读取，事实归`review-smoke.json`；已核看最终材料页。首轮链接检查误用不存在的`browser.request`，其失败日志另存，改用正常HTTP读取后通过，不算产品失败。`closeout-facts.json`确认694个运行时文件、15个叠加文件和86个dist文件无漂移，五份相关文档483个本地链接、其中401个Markdown锚点零错误，`git diff --check`通过。

本轮实现与必要自检完成，下一接续为具体页面观感反馈及对应范围修正；不扩为素材管理全矩阵、跨浏览器或用户P3签收。中文输入法、真实系统失焦和VoiceOver仍为“未运行；依用户决定本轮不执行”，不再索取人工结果。独立`todo.md` SHA256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`；未提交、推送或部署。


<a id="ux-navigation-20261106"></a>
### 图层、对象与历史导航样式统一（2026-11-06）

用户授权继续页面体验整改。本轮运行时只修改`src/editor/main/workspace-controls.css`，把场景导航的标题/说明/数量、面板留白与选中反馈对齐前轮素材库及属性面板，去掉图层/历史内部重复padding；对象和历史搜索只保留外框，真实键盘焦点显示在搜索容器。图层图标点击区域至少30px；保持对象40px、历史对象48px行高及虚拟定位，不改图层锁/隐藏/独显、搜索、选择、命令、恢复、模型或存储逻辑。静态复核发现选中底色被悬停覆盖并修正；截图另发现完整版本区只有一个“上一个版本”按钮时被`:last-child`图标按钮26px宽度挤成竖排，最终显式恢复普通操作按钮的宽度与伸展。危险删除及锁/隐藏状态没有改义。

独立源码/正常dist冻结于`work/ux-navigation-20261106/workspace/`，起始提交`178c132`，沿前轮15个运行时叠加文件保留已完成能力；无关性能/正式视觉/地形候选测试未叠入。`final-source-manifest.json`记录694个运行时文件、15个叠加文件及86个dist文件，最终运行时集合SHA256 `e6f444f93a9d74aa3e89761f78b24f6125a6f6e4d945f363d80ad9066603232e`、dist集合SHA256 `c13a3f943e0554c216c38cfc006ac3560f390cac16d34aa04982a329eef0a3b0`，集合算法同前节。Node24.14.1、隔离Chromium141.0.7390.37，5198保留上一轮正常包，5199提供本轮最终包。

| 必要自检 | 本轮实际结果与边界 |
| --- | --- |
| 正常构建 | 最终`npm run build`退出0，日志`build.log`；原Rollup/体积提示保留，不作性能结论。悬停及历史按钮修正前的源码/dist/构建/键盘日志独立保留，不与最终轮合并 |
| 同图与交互 | `capture-comparison.mjs`经正常文件选择器，将同一真实室内包导入5198/5199隔离空库context；1512/390px取对象、图层、完整历史与局部历史搜索四状态，共16张截图。真实搜索→ArrowDown→Enter选择、无匹配→Esc清空后选区保持，图层名称草稿切页保持再收起，命名快照真实保存后搜索→ArrowDown→Space勾选、切页后搜索/勾选保持；未执行恢复。最终`comparison.log`退出0，`comparison/facts.json`记录38条截图/样式事实且无页面错误、页面或面板横向溢出；两种列表行高实测40/48px，改后搜索内框0px、键盘容器焦点2px，选中对象悬停保持同色，选中快照内部按钮悬停不盖底色；“上一个版本”改后正常36px高 |
| 完整内容保全 | 改后两档在上述浏览、实际快照保存及第二个命名草稿取消前后，正常下载完整备份各75个条目hash逐项一致。快照元数据在隔离库内有明确新增，当前完整包不含命名历史，不能把包相同误写为“历史库未写入”或恢复事务验证 |
| 最终键盘复查 | `SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5199/sceneweave/ node node_modules/@playwright/test/cli.js test tests/keyboard-narrow-acceptance.spec.ts --workers=1 --retries=0 --reporter=line --output=work/ux-navigation-20261106/keyboard-results`退出0，1512/900/390px三条3/3通过，日志`keyboard.log`；不与前轮7/7或中间包3项相加 |
| 脚本与中间失败 | 首次脚本对多行使用严格单元素evaluate失败，改为明确首行；随后窄屏选择会按原产品规则自动打开属性面板，脚本过早重开导航存在竞争，补等待原抽屉关闭后再开；两次均属取景脚本错误，未因此修改产品行为，失败日志/图片保留。重复启动已有5199预览被端口占用拒绝后继续复用原服务。材料页首轮旧页链接未复制进服务目录导致HTTP检查失败，补复制后通过 |

侧栏5194继续复用，默认本轮场景对象，四状态/桌面与窄屏可前后切换，最终16张图使用`navigation-*`前缀；前轮完成页保留为`review/review-before-navigation.html`且所有旧图片保全，实际入口指向5199。材料页1200/390px的四状态×两种截图尺寸共16组图片检查通过，旧页/样例/实际入口可读取，无页面错误和横向溢出，事实归`review-smoke.json`。已目视核看最终桌面历史、窄屏图层与对象页面。所有浏览器检查使用隔离后台context，没有启动用户浏览器或独立可见窗口、读取用户库、调用模型或采集正式性能。

收口检查确认本轮CSS与冻结CSS一致，86个dist文件无漂移；五份相关文档486个本地链接、其中404个Markdown锚点零错误，`git diff --check`通过。期间另一路任务新增SVG/PNG及属性校验编辑，11个既有运行时文件与本冻结出现差异，清单归`parallel-runtime-differences.json`，这些并行编辑及新文件保留，未混入本UX包或宣称已整合验证。侧栏打开请求返回queued，不据此判断用户已查看。

本轮开发整改与上述必要自检完成，后续聚焦建筑/地形长表单参数分组和首屏层级；整体图层/历史故障与跨浏览器矩阵仍归09，用户P3未签收。中文输入法、真实系统失焦及VoiceOver仍为“未运行；依用户决定本轮不执行”。独立`todo.md` SHA256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`；未提交、推送或部署。


<a id="ux-building-terrain-20261106"></a>
### 建筑与地形长表单层级整理（2026-11-06）

用户授权继续处理建筑/地形长表单的常用参数、高级设置与窄屏首屏。本轮仅修改`BuildingPanel.tsx`、`AggregateBuildingPanel.tsx`、`OutdoorToolsPanel.tsx`和共用`workspace-controls.css`对应样式：房间名称/形状、宽高、墙厚/地板材质成组，明确支撑常显；起点X/Y与多边形顶点按需展开，绘制/量尺及预览位于整栋操作之前，建筑组默认收起。室外材质/高程与可见性/阻挡并排，主要绘制与预览先于精确坐标、覆盖优先级、连接路线/开口及散布随机参数。并排单位字段消除旧内边距并对齐高度。原生details保留挂载、状态与草稿捕获；支撑、单位、私密性、禁用/锁守卫及命令/模型/存储语义保持。进入form的绘图、量尺与取消按钮明确使用type=button，避免隐式提交。

独立源码与正常dist基于上一轮导航冻结，仅叠加上述四个运行时文件，位于`work/ux-building-terrain-20261106/workspace/`。`final-source-manifest.json`记录694个运行时文件、24个叠加文件（含测试）和86个dist文件；运行时集合SHA256 `09d0031f58d954037c6a5dab9c9e829abdeeef567092eb1a7fc7c5d98188cbca`，dist集合SHA256 `e88951a2efa6fc8120344ace2286a02c07fc5bf494ba928b181e5f0e54db5d6c`，逐文件集合算法同前节。起始提交`178c132`，Node24.14.1，隔离Chromium141.0.7390.37。当前工作区25个并行运行时差异及新文件保留，未混入该冻结或宣称整合通过；清单见manifest。5199保留改前包，5200提供改后包。

| 必要自检 | 本轮实际结果与边界 |
| --- | --- |
| 正常构建 | 最终冻结目录`npm run build`退出0，日志`build.log`；既有Rollup/体积提示保留，不作性能结论。地形单列及并排字段对齐前的构建/截图/日志另存，不能替代最终冻结 |
| 同图首屏 | 正常文件选择器把同一真实室内包分别导入5199/5200隔离空库；1512/390px建筑、地形各取改前/改后，共8张截图，归`baseline/`及`after/`。输入包SHA256仍为`84fa4810b257d4215632a1b4c91e5189c8627c42a52fed89beadcbf81a4ac08b`。已目视核看窄屏建筑与地形：改前建筑首屏被展开的组管理占据，改后两类主要预览可见；截图只支持本轮页面观察 |
| 草稿与取消保护 | 新增`tests/building-terrain-forms-ux.spec.ts`，以正常UI新建两档独立空白工程；房间起点/宽高/墙厚、折叠状态及建筑组跨模块保持，真实绘图启动/取消不触发候选；结构预览期间常用/精确字段禁用，取消后包hash保持。室外高程/优先级/坐标跨模块、通路净宽与散布随机草稿跨工具保持；重复坐标在折叠区外报错，修正后可真实预览，候选期间字段禁用，取消后包hash保持。两档建筑及室外取消后的完整包各40条目逐项一致，事实归`final-results/**/form-facts.json` |
| 最终同包验证 | `SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5200/sceneweave/ node node_modules/@playwright/test/cli.js test tests/building-terrain-forms-ux.spec.ts tests/keyboard-narrow-acceptance.spec.ts --workers=1 --retries=0 --reporter=line --output=work/ux-building-terrain-20261106/final-results`退出0，`final-browser.log`记录5/5通过：1512/390px表单两条及1512/900/390px键盘三条。无页面错误及页面/面板横向溢出；不与改前或中间包结果相加 |
| 既有入口同步 | `building-edit`、`u1a-workspace`、`export-privacy-ux`、`uvtt`的数值helper仅在房间起点隐藏时展开精确位置，`aggregate-building` helper显式展开组工具；五文件`--list`退出0发现24项，日志`entry-list.log`。未运行这些完整组，不冒充UVTT或导出正式验收 |
| 脚本与中间失败 | 首次在冻结目录执行复制脚本时根路径选择错误，未覆盖主工作区，纠正绝对根后重新构建。初轮新用例取消文案定位与相对has定位写法不符，人工中断后修正；其日志/trace保留在`form-results/`、`form-final-results/`。这些为脚本失败，未据此修改产品语义。截图另暴露地形单列仍挤占首屏及单位字段旧间距，已修正并以最终包重跑5项 |

侧栏5194复核页更新为建筑/地形两种状态、桌面/窄屏前后对照；8张最终截图使用`forms-*`前缀，旧导航页保留为`review-before-building-terrain.html`，其余旧页及图片保持。实际工作区入口指向5200。所有浏览器检查使用隔离无界面context，未启动用户浏览器、独立可见窗口、模型请求或正式性能。

侧栏复核页1200/390px、两种截图尺寸与两种状态共8组图片检查通过，旧页/样例及5200入口可读取，无页面错误和横向溢出，事实归`review-smoke.json`。最终四个运行时文件与冻结一致，86个dist文件无漂移，五份相关文档489个本地链接、其中407个Markdown锚点无错误，`git diff --check`通过；详见`closeout-facts.json`。侧栏打开请求返回queued，不据此判断用户已查看。

本轮开发整改及必要自检完成，后续复查候选审阅区、空状态与错误反馈的一致性。用户P3未签收；中文输入法、真实系统失焦、VoiceOver继续为“未运行；依用户决定本轮不执行”。独立`todo.md` SHA256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`；未提交、推送或部署。


<a id="ux-six-finish-20261106"></a>
### 候选、反馈、弹窗与完整页面旅程收口（2026-11-06）

用户授权依次完成六项页面体验工作：候选审阅、空/错误/读取反馈、弹窗菜单、画布工具状态、窄屏长内容及整体一致性/完整旅程。本轮运行时仅修改`workspace-controls.css`、`Workbench.tsx`、`UvttExportDialog.tsx`、`SceneContextMenu.tsx`与`main-shell/WorkspaceHome.tsx`，新增正常生产旅程`tests/workspace-feedback-polish-ux.spec.ts`。共用字体、标题/正文、按钮与输入基线扩至候选、普通提示/保存恢复、帮助/导出、新建/VTT预检及右键菜单；读取、错误与真实空状态保持各自语义。候选移除正文内层240px滚动限制，由外层正文滚动且确认/操作保留，窄屏原先隐藏的解释恢复可见。普通长提示的正文可滚动，关闭按钮常显；保存问题仍在独立恢复区。

房间、量尺及室外取点从开始就显示点数、下一步和退出按钮，点数足够后才提供原预览动作；退出沿原会话取消路径，保留表单草稿，不写工程。首页无匹配给出清空搜索，两处清空操作都返回搜索框焦点，真实空库说明三种起点。新建/VTT弹窗和右键菜单统一样式，VTT关闭键补`isComposing`/229守卫，原关闭/焦点回归保持；弹窗短屏滚动留出底部动作空间。没有修改领域命令、锁/依赖、支撑、模型、资源许可、保存或玩家投影。

独立源码与正常dist基于前轮长表单冻结，仅叠加上述五个运行时文件，位于`work/ux-six-finish-20261106/workspace/`；起始提交`178c132`。`final-source-manifest.json`记录694个运行时文件、28个叠加文件（含测试）、86个dist文件；集合算法沿前节逐路径及SHA256排序计算，运行时集合SHA256为`c9d2d1e7a3cbc22193d8982b7ab61cf925ef17c7070e94cea9c1911d2a923aac`，dist集合SHA256为`0676055d1a661d57aa5cc256f8342943131914c3edc19cd64401af8b76830104`。冻结时当前根目录有29个并行运行时差异，另有新增文件，均保留但未混入本UX包，不宣称完整工作区整合通过。Node24.14.1、隔离Chromium141.0.7390.37；5200保留改前包，5201提供最终包。

| 必要自检 | 最终结果与实际边界 |
| --- | --- |
| 正常构建 | 冻结目录`npm run build`最终退出0，日志`build.log`；保留既有Rollup/体积提示，不作性能结论。最后修改窄屏提示留白后重新构建，以下9条与两组取景均基于该最终dist |
| 候选、反馈与弹窗 | 桌面1512px/390px两条正常UI新建旅程覆盖长房间名称候选、确认前禁用/勾选后可采用、正文滚动后确认/动作可见、取消、非法坐标错误、房间真实首点后的计数/退出及室外退出、新建尺寸拒绝、VTT预检/合成组合状态守卫/实际Escape与焦点返回、首页无匹配清空及搜索焦点。390×600额外聚焦末尾尺寸字段和VTT确认框，均在底部动作上方，Space勾选后下载可用。取消前后正常下载完整包各40个条目hash一致；未发起VTT下载或目标软件导入。事实归`final-results/**/feedback-facts.json` |
| 长表单复验 | 同包1512/390px两条再次核对主要预览首屏、精确设置和跨模块/工具草稿、候选禁用、错误修正、取消完整包40条目hash保持。390px地形首屏原断言保持，未放宽阈值；事实归`final-results/**/form-facts.json` |
| 完整操作旅程 | 同包1512/390px两条从首页新建→真实本机Worker室内生成→手工移动→撤销重做→刷新后最近工程冷重开→玩家/主持人PNG→空存储正常文件导入。两档均为2房间9物件，编辑后revision3，双受众PNG均4096×2731；冷重开完整包逐条目hash一致，导入只按合同改变工程身份/时间/revision，文档其余内容、身份、外观、资源记录与许可绑定保持。Worker加载被实际观察，无服务端生成请求；事实归`final-results/**/journey-facts.json`。本轮没有另跑完整秘密注入或PNG元数据矩阵，不用该旅程替代前轮保密证据 |
| 最终同包命令 | `SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5201/sceneweave/ node node_modules/@playwright/test/cli.js test tests/workspace-feedback-polish-ux.spec.ts tests/building-terrain-forms-ux.spec.ts tests/complete-journey-ux.spec.ts tests/keyboard-narrow-acceptance.spec.ts --workers=1 --retries=0 --reporter=line --output=work/ux-six-finish-20261106/final-results`退出0；`final-browser.log`记录9/9通过（两条反馈、两条表单、两条旅程和1512/900/390px键盘三条）。无页面异常，截图点无页面横向溢出；不与中间包或历史数字相加 |
| 前后及模块观感 | `capture-comparison.mjs`通过相同正常UI新建/操作，在5200/5201分别取得1512/390px候选、错误、新建、VTT、绘制和首页空结果六状态共24张前后截图，`comparison/facts.json`为24条、errors为空。`capture-modules.mjs`正常文件选择器导入同一真实室内包，取得七模块两档14张最终截图，浏览前后两组完整包各75条目hash一致；`modules/facts.json`无页面异常或页面横向溢出。输入包SHA256为`84fa4810b257d4215632a1b4c91e5189c8627c42a52fed89beadcbf81a4ac08b`。已目视核看候选/绘图/弹窗、宽屏VTT及窄屏外观/素材库和桌面AI，截图仅支持本轮观感复核 |
| 失败及修复保留 | 首次构建发现首页清空handler误用不存在的`setSearch`，改为原`setQuery`后构建通过，首败日志保留。早期反馈两条通过后，长表单回归发现390px地形预览底部807.984px超出面板底部806px；长提示限高后仍复现，最终定位为提示关闭按钮高度新增占位，窄屏提示padding收为6px并保留按钮点击区域，最终9项重跑通过。首轮6/7、8/9及旧构建/截图/trace均独立保留，不算最终通过。取景脚本曾在窄屏绘图自动开抽屉前抢先关闭，补等待data-open后取景，未改产品逻辑 |

侧栏5194复核页更新为上述六状态、桌面/窄屏及前后对照，24张最终图片使用`six-finish-*`前缀，旧长表单页保留为`review-before-six-finish.html`，旧页面/图片链和实际样例保全；工作区入口指向5201。材料页在1200/390px下的六状态×两种截图尺寸共24组检查通过，旧页/样例/实际入口可读取，无页面异常和横向溢出，事实归`review-smoke.json`。侧栏打开请求不代表用户已查看。

最终收口核对五个运行时文件及新增测试与冻结一致，694个冻结运行时文件、86个dist文件均无漂移；五份相关文档492个本地链接、其中410个Markdown锚点零错误，`git diff --check`通过，事实归`closeout-facts.json`。根目录29个并行运行时差异保持独立，不据该冻结外推整合结果。

所有浏览器操作使用隔离无界面context，没有启动用户浏览器或独立可见窗口、读取用户库、连接AI后端/模型或采集正式性能。上述六项开发整改与必要自检已收口，后续按具体页面反馈修复；完整功能/跨浏览器矩阵及用户P3仍归09，UVTT真实目标导入仍待。中文输入法、曲线/填充真实系统失焦、VoiceOver为“未运行；依用户决定本轮不执行”，合成处理器检查不改写该边界。独立`todo.md` SHA256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`；未提交、推送或部署。

<a id="ux-integration-20261107"></a>
## 当前完整版本UX整合、复杂地图与等待反馈（2026-11-06启动，2026-11-07收口）

用户授权依次完成①整合当前完整代码、②复杂地图操作效率、③等待反馈、④修复及分块提交；界面继续只用Codex侧栏，独立自动化使用隔离无界面浏览器。没有操作用户浏览器或真实用户库、连接模型、运行本轮正式性能或恢复已决定不执行的原生实测。

源码冻结于`work/ux-integration-20261106/workspace/`，起始提交`178c1320c278f2e9d1b10a16feeb720e449fbca4`，复制当时完整工作区及资源/许可，包括其他任务当时的存储、渲染、SVG/PNG整改，再只叠加本轮Workbench等待文案及图层初始化修复。`final-source-manifest.json`记录1505个源码/配置/文档文件、845个运行时输入及89个dist文件；集合按逐路径及SHA256排序计算，运行时SHA256为`0a715c5aa071f463229d19015f7beddc35f61254b5704faf0b36daad8c652fe6`，dist为`8ff092f868c713f9f517fb75d74f0c66f8d3e2a7c6f43c049fc81c929781378b`。Node24.14.1与隔离Chromium141.0.7390.37；5202保留改前整合包，5203提供最终正常包。该冻结证明所列整合范围；之后并行变化另列在`closeout-facts.json`，不据此宣称持续变化的根目录全量已测。

本轮运行时只新增Workbench中的操作级busyMessage与UserLayerPanel的工程/会话key。保存室内/森林/火山/混合结果、离开前保存、素材批次/目录检查、完整/所选历史备份及双受众PNG分别说明当前操作；通用路径每次重置默认文案，原并发锁、取消及finally清理保持。图层面板此前在生成新工程后仍保留旧Floor，创建图层被领域校验拒绝；现在沿用其他工具的sceneId-sessionGeneration key重新初始化，普通分类导航只隐藏面板，key不变，仍保留同工程草稿。没有放松严格校验或改变模型、事务、撤销、CAS及保密合同。

| 必要自检 | 实际结果与边界 |
| --- | --- |
| 正常构建 | 冻结目录`npm run build`退出0，最终`build.log`；保留既有Rollup/体积提示，不作为性能结论 |
| 最终同包检查 | `SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5203/sceneweave/ node node_modules/@playwright/test/cli.js test tests/complex-workspace-ux.spec.ts tests/workspace-feedback-polish-ux.spec.ts tests/building-terrain-forms-ux.spec.ts tests/complete-journey-ux.spec.ts tests/keyboard-narrow-acceptance.spec.ts --workers=1 --retries=0 --reporter=line --output=work/ux-integration-20261106/final-results`首轮退出1，`final-browser.log`记录9通过、复杂地图2项因冷重开脚本错误失败；只修正测试，保持同一dist，以`--output=work/ux-integration-20261106/complex-retest-results`单独运行`tests/complex-workspace-ux.spec.ts`退出0，两项2/2通过，日志`complex-retest-browser.log`。不宣称单轮11/11全绿，也不与改前包9项合计 |
| 复杂地图 | 1512×982及390×844两条经正常页面生成并保存林中建筑，各含2房间、42物件、地形和道路。建筑名称/地形高程跨模块保持，浏览完整包hash不变；素材按原固定定义和明确房间支撑新增一件，资源hash保持；创建图层→两物件多选→移层预览取消完整包不变→采用→一次撤销/重做→历史读取→刷新冷开，物件/房间/地形内容保持，冷开逐条目hash与重做后相同。无页面错误或模型请求、无页面横向溢出，事实归`complex-ux-facts.json` |
| 等待观察 | 两档`waiting-observations.json`记录生成、保存、放置、建层、移层采用、历史读取和冷开，保存生成结果的具体状态有实际断言；导航替换DOM后改为驱动计时，不伪造连续观察。DOM时标和驱动时间包含等待/截图/下载开销，且机器另有任务，不得作为正式性能或前后提速结论；数秒级保存仍是性能线独立整改事项 |
| 完整交付与反馈 | 同包两条完整旅程新建→真实Worker室内生成→手工移动→撤销重做→最近工程冷开→玩家/主持人4096×2731 PNG→空库正常文件导入通过；两条长表单、两条候选/错误/弹窗/画布状态及三档键盘也通过。不据此关闭完整秘密像素、跨引擎或原生实测矩阵 |
| 侧栏材料 | 原5194复核页更新为两档保存/地图/多选/移层/历史共10张实际操作截图，原页面保留为`review-before-integration.html`，所有旧图及样例保持；提供真实完整林中建筑备份及5203入口。材料页1200/390px的两截图尺寸×五状态共20组图片/链接/溢出检查通过，结果归`review-smoke.json`；页面已更新不代表用户P3签收 |

初始构建在复制快照完成前启动，因文件未就绪失败，待复制完重跑通过；另一次构建为叠加最终文案而中断，不作为成功证据。首轮复杂旅程被共用辅助函数8秒busy检查提前拒绝，明确对真实生成保存完成等待90秒后继续，产品等待仍如实记录。随后真实复现新工程沿用旧Floor的新建图层失败，修复key后可创建、采用及撤销重做。该轮历史按钮实际包含“· r4”，测试用严格无修订号名称导致两档失败；改为匹配实际名称后，后续11项整合检查中9通过，复杂地图两档在冷开步骤失败：刷新后产品需要从首页最近工程重新打开，脚本误等自动打开。补齐实际最近工程路径、候选截图等待真实画布渲染完成后，保持同一dist的两条复杂地图复验2/2通过；未为这两个脚本问题修改产品。DOM观察跨reload会丢window状态的问题在静态复核时预先修正。首次失败、截图与trace均保留在各自`complex-*-results`及日志中。

本次把累积UX按页面整理、交互修复、测试、文档分块提交：17个前轮运行时作为页面块，Workbench本轮增量单独提交，12份UX用例另块，五份文档只暂存UX内容；正式容量/性能/视觉、数据与资源整改的其他任务修改保留。精确归属核对见`commit-audit.md`及`commit-map.json`，最终Git事实见`commit-facts.json`。源码/产物无漂移、链接/锚点及`git diff --check`由`closeout-facts.json`核对；独立`todo.md` SHA256保持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`。本轮未推送或部署。

用户批准的1–4项开发工作收口；后续只根据具体页面反馈修复对应范围，整体功能、正式性能、目标VTT导入与用户P3仍按09独立验收。中文输入法、曲线/填充真实系统失焦和VoiceOver继续为“未运行；依用户决定本轮不执行”，不再索取人工结果。

<a id="workspace-information-density-20261109"></a>
## 统一工作台信息密度整改（2026-11-09）

用户授权“全部调整”，覆盖场景、素材、建筑、地形、氛围、生成、AI和历史，以及顶部、右侧详情和窄屏。实现遵循[密度规范](../reference/editor-and-architecture.md#workspace-information-density)，开发状态归[07](../07-roadmap.md#workspace-information-architecture-plan)，正式验收仍归[09](../09-quality-plan.md#workspace-information-architecture-acceptance)。

新增`workspace-density.css`统一标题/正文、控件、面板内边距与字段间距；桌面布局入口合并到顶栏，窄窗口保留具名抽屉栏，跨断点移动入口后恢复原焦点。图层名称/数量/绘制状态收紧，对象搜索与列表前置；物件名称/锁同行，物件、组合、放置、建筑顶点/整墙/遮罩/注记等关联坐标成组。填充复制、坐标说明、生成长说明及AI解释按需展开，仍保留直接可见的发送范围简述、错误及候选影响。素材缩略图48px，详情大图、多行输入和候选操作区保留用途；对象40px/历史48px虚拟行高不变。新增`WorkspaceNotice`只让显式成功的备份/PNG提示8秒收起，悬停或焦点停留暂停，其他提示保持。没有修改领域模型、命令、锁/依赖、CAS、资源许可或玩家投影。

本轮14个UI运行时文件与175个正常生产产物记录于`work/workspace-density-20261109/final-ui-manifest.json`；生产产物集合按路径及SHA256的JSON排序计算，SHA256为`36d6d309dbd4d353752ee4a7b2f4765f2211225ee5b1cabbb1127ff702ff4021`。测试服务为5213的固定生产副本，不使用开发热更新包。构建前1267个输入的指纹另存`final-source-manifest.json`；构建期间其他会话修改了7个存储/领域及相关测试文件，详见`build-source-drift.json`，本轮UI文件无漂移。以下结论绑定确切生产产物，不外推为之后持续变化的整个工作区已全量通过。

| 必要自检 | 实际结果与范围 |
| --- | --- |
| 正常构建 | 最终`npm run build`退出0，执行架构依赖检查、两组TypeScript检查和正常Vite构建，日志`final-build.log`。保留现有Rollup注解和包体积提示，不作为性能结论 |
| 密度专项 | `SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5213/sceneweave npx playwright test --config work/workspace-density-20261109/playwright.config.ts --output work/workspace-density-20261109/final-visual-results`退出0，`final-visual.log`为1/1通过。正常UI新建/放置/选择后，1079/1080/1081/1512px布局入口焦点保持；键盘展开填充、收起再展开保留数量，数值预览取消revision保持；八模块、七种生成及六个氛围页截图无页面横向溢出。普通取消提示保持alert，备份成功为status，悬停8.2秒及焦点8.2秒不消失，离开后收起；无页面异常 |
| 实际布局 | 专项`density-facts.json`记录1512px顶栏56px、无提示时画布顶170px，单层行36px、对象虚拟行40px；右侧位置X/Y合计54px高，数值框30px。仅证明本轮样例的布局事实，不将不同内容状态的旧截图作严格前后量化 |
| 最终同包回归 | `SCENEWEAVE_TEST_BASE_URL=http://127.0.0.1:5213/sceneweave npx playwright test tests/workspace-information-architecture.spec.ts tests/keyboard-narrow-acceptance.spec.ts tests/complete-journey-ux.spec.ts --workers=1 --retries=0 --output work/workspace-density-20261109/final-results --reporter list`退出0，`final-browser.log`为单轮13/13通过：信息架构8项、1512/900/390px键盘3项及完整旅程2项。不与专项、开发包或历史结果拼接成同一轮 |
| 完整旅程 | 1512×982与390×844通过首页新建→真实本机Worker室内生成→手工移动→撤销/重做→刷新后最近工程冷开→双受众PNG→空库正常文件导入。两档均2房间/9物件，编辑revision3，玩家/主持人PNG均4096×2731；冷开逐条目hash保持，导入按既有身份转换合同检查。无页面异常或生成服务端请求，详见两份`journey-facts.json`；此旅程不替代完整秘密像素、UVTT真实目标导入或原生输入/读屏检查 |
| 截图及既有用例 | 已目视核看桌面场景/素材/AI/历史、室内/自然/区域生成和环境工具，以及390px场景/素材/候选。三个既有填充用例文件同步默认折叠入口及精确内层定位，`--list`退出0发现8项；未运行这三个完整文件，部分旧导航仍待其独立维护，本轮填充实际路径由专项覆盖 |
| 中间失败 | 开发服务器首轮导航/键盘为10通过1失败，当时组件热更新且页面回到“尚未打开工程”；固定生产包的同项与全组最终通过，未为该首败改领域逻辑，原`browser.log`、`results/`保留。一次早期构建遇到并行新增的surface-rule测试未收窄联合类型；最终运行前该测试已修正，最终正常构建退出0。早期直接Vite打包仅作中间诊断，不替代最终正常构建 |

5213的`/sceneweave/density-review/`提供八模块及候选的桌面/窄屏18张实际截图、当前工作区入口和本轮室内备份；材料单独附加，不改已测JS/CSS。复核页1200/390px视口×两档截图×九状态共36组图片/溢出检查通过，工作区及样例链接可读，详见`review-smoke.json`。所有自动化均使用隔离无界面Chromium，未打开用户外部浏览器或访问真实用户库；侧栏打开结果不代表用户已查看或P3签收。

最终`closeout-facts.json`核对14个UI文件及175个已测生产产物无漂移，四份相关文档552条本地链接/锚点无错误，`git diff --check`通过。侧栏复核页打开请求返回queued，不据此宣称用户已查看。

本轮开发整改及必要自检完成。中文输入法、曲线/填充真实系统失焦、VoiceOver仍为“未运行；依用户决定本轮不执行”；正式验收/P3及发布未完成。无关并行修改和独立`todo.md`保持，后者SHA256为`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`；本轮未提交、推送或部署。

<a id="asset-expansion-20261109"></a>
## 六主题素材与自定义导入全流程开发自检（2026-11-09）

用户授权场景与画风同时扩展、先形成六个主题包，并把用户自有素材导入、名字、格式和配套流程一并实现。开发状态只归[07](../07-roadmap.md#asset-expansion-implementation)，合同归[14](../14-visual-and-assets.md#asset-theme-expansion)与[10](../10-rules-assets-and-licensing.md#asset-review-and-rights)，操作归[导入指南](../reference/asset-import.md)，正式验收按[09](../09-quality-plan.md#asset-expansion-acceptance)。本节是开发自检，不授予P2/P3或发布状态。

实现包含：严格`sceneweave-assets.json`、多来源精确路径与许可映射；单图/批量名称原文、物理标定与表现语义；六包按需来源和选择闭包采用；当前工程固定素材只读审核、单件/整包四维记录及独立用户签收、本机持久化/导出。清单只预填，不授予嵌入权/原创/P3；公开validate、完整字节/像素、来源/许可、原子采用、撤销及CAS保护保持。素材为120份原创静态SVG经固定处理器物化的PNG候选，另有18个真实组合、12份可编辑工程；没有调用生图服务，完整目标画风、用途/状态和美术仍未完成签收。

### 冻结与运行边界

材料存于被Git忽略的`work/asset-expansion-20261109/`。性能owner明确释放独占后开始运行。第一轮正常构建`build-1.log`退出0，对应独立`production-1/sceneweave/`；初次源快照见`source-after-build.json`，最初生产文件hash见`production-1-manifest.json`。该冻结完成六包实际PNG/十二包下载和代表场景交付，后续修复不倒写这些结论。

最终正常构建`build-final.log`退出0，执行架构检查、两组TypeScript和Vite，独立副本为`production-final/sceneweave/`，地址`http://127.0.0.1:5225/sceneweave/`。`source-final.json`记录1127份src/配置输入；`production-final-manifest.json`记录176份生产文件，以Python `json.dumps(files,sort_keys=True)` UTF-8计算SHA256为`24bffdf74fd4c9d91838ea8bdd499c9294cff1c7676e9e76d952b9ba3097acf1`。复核页、图片/包及导入说明随后独立附加，不改变已测JS/CSS；源/产物最终漂移检查单列于`closeout-facts.json`。正常打包保留现有包体积提示，不作为性能结论。

### 必要自检与实际结果

| 范围 | 实际结果与材料 |
|---|---|
| 名称/格式/准备边界 | 首次10文件146项定向单测为145通过1失败（`unit-final.log`），唯一失败是review repository测试旧fixture缺少新整包coverage；补真实两份不同layout/要求映射后11/11通过（`unit-review-repository-final.log`）。原清单、batch source、尺寸解码、prepare/asset-batch及审核用例的通过和失败不拼接为新的整轮数字 |
| 最终受影响闭包/审核 | `unit-asset-final.log`为7文件53/53通过：library-content/snapshot-catalog、review-content/review-repository、theme plan/review/provider。真实双PNG组合完整包回读的固定identity保持；缩略图原序/反序可回读，丢项/伪造/重复仍拒绝，原条目不变 |
| 初始生产旅程 | `browser-1.log`首轮3通过1失败：清单导入完整链、主题选择采用/审核、六包实际图通过；单图名称用例遗漏必填许可而被原生表单拦截，补前置后`browser-2.log`两项2/2通过。单图自动名随换图，手改后保持，超长名明确拒绝 |
| 六包与十二份场景 | `browser-2-results`有六张palette截图与全部12份实际`.sceneweave`；每包23个真实加载缩略图，对应6材质/14物件/3组合。下载走完整导出校验，全部页面无异常；这些结果不等于逐用途覆盖已通过 |
| 代表场景 | `browser-samples.log`为1/1通过：调查室内和海岸样板实际下载→空库正常导入→独立物件移动1mm→完整包确认→撤销→4096px玩家PNG。两张PNG和可编辑截图已目视核看；样板仍较简洁，只证明可编辑和交付的代表路径，不替代高质量成图、双受众秘密矩阵或全部12场景联合验证 |
| 最终主题/本工程审核 | `browser-project-review.log`首次暴露旧组合元数据一致性误拒绝，修复后最终生产的`browser-final-fixed.log`为主题/本工程审核1通过、另一清单断言脚本失败。本工程素材准备显示实际选择列表，准备前后完整下载逐条目hash保持；主题只加勾选的一项，审核仅技术记录，整包及用户签收保持未完成 |
| 最终清单与个人库 | 修正测试的双alert定位后，`browser-manifest-final.log`为1/1通过：ZIP清单姓名/标签/偏移/根锚/阻挡/层/材质表面预填，许可默认未确认；空根锚拒绝且无采用按钮，纠正后一次采用，撤销/重做，最近工程冷开逐条目hash保持，保存我的素材→完整备份→空个人库恢复名称原文保持。facts与完整包在`browser-manifest-final-results` |
| 自有素材实际审核与窄屏 | `review-flow-smoke.log`退出0；从上项真实冷开包正常导入，选择带空格/Unicode的自定义素材，明确记录仅技术通过并实际导出JSON；来源/美术/场景未检查、用户未签收，完整key/资源闭包保留。390px审核选择/主题选择控件在视口内，无页面横向溢出或异常；事实与两张截图见`review-flow-smoke.json`、`custom-review-390.png`、`theme-controls-390.png` |
| 复核材料 | `asset-review/`从已测实际包抽取120PNG，另展示两张实际玩家图及12个工程下载。`gallery-smoke.json`核对122图均成功解码、12下载HTTP200且非空、390px无溢出；已目视核看首屏与窄屏截图。它是本机复核附件，不是部署或用户签收 |

### 首败、窄修复及限制

初次类型检查因三个`fail`箭头函数不满足当前TypeScript控制流收窄失败，改为明确`never`函数声明后`typecheck-2.log`退出0；没有通过断言放宽输入。review repository首批测试的非法固定fixture已修正，后续coverage fixture遗漏独立保留于上述日志。

实际“准备本工程素材审核”首次失败定位到旧`b2-pf-01`书桌六件组和同类组合：素材包canonical JSON重排成员key，导致原来按成员插入顺序生成的thumbnail数组顺序改变；固定hash/资源相同。`checkedCapsule`仅对比较双方的缩略图列表复制排序，其他metadata、完整identity、中性闭包与实际字节像素检查不减，不改变旧62项目录或其输出次序。定向双图回归与最终实际准备通过。

只读复核另发现批量根锚清空后`Number('')`会隐式变零；已明确拒绝空值，并用真实浏览器拒绝→纠正→采用证明。最终第一次浏览器启动地址遗漏末尾斜线，辅助函数`./#home`落到静态目录根；主动中断该无有效UI轮次并保留`browser-final.log`。补斜线后的清单断言匹配到行错误/总错误两个alert，产品已正确拒绝空根锚；收窄根锚错误定位后同一生产包最小复验通过，未为这两项脚本问题改变产品。

尚未执行完整六包世界尺度/近景、2×2/3×3平铺、美术与用途/状态逐项覆盖、跨浏览器、全部故障矩阵和用户P3。计划必需项仍全部保留待审；个人合法导入可用不表示公共默认包再分发已经核准。本轮未提交、推送或部署；无关dirty tree与独立`todo.md`保留，后者SHA256维持`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`。

最终静态收口：`closeout-facts.json`核对9份相关文档821条本地链接/锚点无错误，1127份源/配置及176份已测生产文件无漂移，`git diff --check`通过；`gallery-final-smoke.json`另核对最终5225复核页122图与14条页面/说明/工程链接全部可读，390px无横向溢出。136份复核附件另记`review-manifest.json`。侧栏打开请求返回queued，不据此宣称用户已查看或签收。

<a id="asset-quality-20261109"></a>
## 新素材共同质量初筛与六主题第一轮初审（2026-11-09）

用户授权执行六包初审，并将部分质量规则落入代码，使AI制作或用户导入均先检查。合同归[14共同初筛](../14-visual-and-assets.md#asset-quality-screening)、[AI边界](../05-ai-and-generation.md#asset-quality-authoring)和[导入指南](../reference/asset-import.md)，开发归[07](../07-roadmap.md#asset-expansion-implementation)，完整矩阵仍归[09](../09-quality-plan.md#asset-expansion-acceptance)。本节不覆盖前轮素材扩展冻结，也不授予美术或用户P3。

### 实现与信任边界

共享纯像素策略`asset-quality-v1`扫描实际RGBA，只有全透明为新增硬拒绝；低分辨率、小主体、过淡、留白/背景、裁边、材质透明孔洞及对边接缝为启发提示，像素画、纯色、覆盖和贴边图案仍允许明确复核。单图/批量准备与个人库/主题新增定义使用同一应用检查，复用旧图片但新建尺寸定义仍重评估；原有工程/历史/完整备份不回溯拒绝。取消/坏末项不发布半批，原字节/像素/许可和最终事务校验保留。

共同UI展示确切名称、图片和原因，逐件确认绑定规范PNG的hash、用途/世界尺寸及完整报告；新候选重置确认，采用按钮和处理器均检查。AI SVG及调色/亮度固定派生接入同策略，采用时重物化并比较确切报告；缺确认不flush、建保护或claim，候选继续可审。仅改opacity不当作新空图拒绝。当前创作4仍限定`artwork:null`，底图接续2/3/4显式拒绝SVG/style；本轮没有开放新生图能力、调用模型、自动重试或扩大权限。报告/复核为会话候选信息，不新增工程版本或持久信任凭证。

### 必要开发自检与固定生产结果

证据根为`work/asset-quality-20261109/`；`source-freeze.json`与`dist-freeze.json`记录本轮源码/配置及正常dist。所有生产浏览器使用同一副本`production/sceneweave/`，地址`http://127.0.0.1:5226/sceneweave/`；前轮5225及旧素材/成图未覆写。正式性能独占已释放，本轮不作性能结论。

| 检查 | 实际结果与证据 |
|---|---|
| 类型、依赖与构建 | `typecheck-1.log`和`build-1.log`退出0，共享/应用280源码模块边界与正常Vite产物通过；既有包体积/重复静态动态引用告警保留，不宣称已优化 |
| 定向集成单元 | `unit-final.log`为7文件76项通过：shared质量/确切确认，application真实PNG/SVG初筛/目录新标定/批量与prepare，AI artwork/atomic。覆盖全透明/稀疏低alpha、合法纯色/透明、策略阈值、取消/末项保全、不回溯、错误确认key、确认前无保护/claim及一次采用。AI物化使用受控端口，不代替真实模型/生产生图证明 |
| 清单、库和主题回归 | `browser-1.log`同包清单/个人库、主题只选闭包/只读审核及六包实际PNG/12下载三项通过；名字/标定、撤销重做、冷开与空库恢复保持。六包下载项因grep包含“actual PNG”一并匹配执行，不再重复 |
| 真PNG与无提示SVG | 同轮`asset-quality.spec.ts`第二项通过：实际Canvas生成16×16PNG触发低分辨率且采用禁用，取消后清晰SVG无警告、可采用。截图在`browser-1`对应目录 |
| 透明拒绝、确认重置与窄屏采用 | 首轮透明SVG拒绝、下载完整工程hash保持、风险提示与确认重置已执行；390px后脚本未打开当前详情抽屉，截图等待至120秒失败。仅补真实抽屉操作与图像解码/无横溢断言，同dist的`browser-review-fixed.log`1/1通过：透明拒绝保全、逐件确认→取消→重建需重审，390px实际图像、采用revision+1、空格/Unicode名字保持与一次撤销定义恢复。facts、四份完整包及截图保留 |
| 本地复核页 | `production/sceneweave/asset-review/`复制原120PNG/12工程/两张玩家图，新增12实际场景和6张材质3×3图及逐包整改。`gallery-smoke.json`核对140图全部解码、全部页面/记录/工程链接HTTP200且非空、390px无横溢或页面异常；首屏/窄屏截图已核看。本机附件不是公开发布或用户签收 |

AI两文件31项的代理先行结果另保留于`work/asset-expansion-20261109/quality-ai-tests-final.log`，已包含在上述76项最终集，不重复相加。共享/应用测试初次fixture缺确切许可绑定及显式`undefined`引起失败，修正fixture后通过，未放宽模型。窄屏复验首次grep使用`^quality screening`未匹配Playwright完整测试名，未执行任何用例；去掉该起首锚后得到上表实际通过，不计无用例命令为通过。首轮浏览器为4通过/1脚本失败，最小复验为1通过，分别保留，不拼称首轮全绿。

### 六包实际看图结果与后续

`theme-review/review.md`保留逐包和逐素材观察，`layout-facts.json`包含12个实际工程hash/已放置实体和位置；`png-metrics.json`直接测量120张512×512规范PNG，无全透明，84物件无可见像素贴外边。36张逐项3×3图及6张合集实际核看；12份`.sceneweave`均经前轮5225固定生产正常首页导入，实际Canvas截图约600×450，不宣称全部双受众4K。

六包均为“需要修改”：画风仍主要是相近的平涂矢量描边，现代显示器/冷藏柜和遗迹石像混用正视图标；诊疗屏风/器具台、生活角/托盘、客房/餐饮、真实储藏角、废弃营地和码头/聚落/值守用途有缺项。八份室内场景共用稀疏双房间框架，室外多为直线矩形分区；3×3当前尺度未见明显透明裂缝，但水纹/苔团周期重复明显。具体优先整改归[14初审清单](../14-visual-and-assets.md#asset-theme-first-review)，自动像素未命中不能关闭上述问题。本轮没有重画固定源、变更审核数据库或自动把候选标为通过。

世界尺度/旋转/2×2与4K近景、完整用途状态、双受众、净空矩阵、跨浏览器、全部存储故障及用户P3仍待09。当前任务未提交、推送或部署；最终源码/产物、附件、文档链接与独立`todo.md`完整性见本根`closeout-facts.json`。


<a id="asset-independent-commit-20261109"></a>
### 素材独立提交范围与验证（2026-11-09）

本次提交从`6fb36b4`叠加素材扩展、自定义导入、四维审核与共同质量初筛，排除并行的核心收束、快照/存储优化、SVG处理器2及后续AI入口工作。隔离源码位于`work/asset-quality-20261109/commit/candidate/`，沿用该基线既有SVG处理器1与完整目录校验；其PNG和包身份不冒充上文5225/5226较大工作区冻结，固定身份继续绑定各自真实源、处理器与像素。原工作副本的其他改动保持本地，不据本次结果宣称其已整合或发布。

`commit-build-2.log`正常构建退出0；首次投影构建缺质量导入及混用后续端口的测试夹具，已适配既有接口。`commit-unit.log`为14文件190通过/4失败，四项失败同属新质量用例缺Node图片规范化适配；只补与既有批量测试相同的PNG规范化mock，真实PNG字节、CRC、解码、质量与完整工程校验保持，随后`commit-unit-quality-fixed.log`为5/5通过。其他13个通过文件覆盖清单、读取、审核、主题、确切确认、批量及AI采用；不把两轮拼作一轮全绿。既有`library-content`与`prepare`边界另以`commit-unit-existing-boundary.log`核对2文件15/15通过。

`commit-browser.log`对本次正常dist的`http://127.0.0.1:5227/sceneweave/`串行运行`asset-expansion.spec.ts`和`asset-quality.spec.ts`，7/7通过：名字与标定、ZIP清单、撤销/重做、保存冷开、空个人库恢复、只选闭包/只读审核、六包实际PNG/12工程下载、室内/海岸可编辑样板与玩家PNG，以及透明拒绝保全、逐件确认/取消重置、390px图片与无横溢、真实PNG低分辨率和无提示SVG。AI单元使用受控端口，不代表真实模型运行。完整美术/状态覆盖、跨浏览器、整体性能、目标VTT和用户P3仍待09；本节只记录开发提交验证，不表示部署或签收。

<a id="remaining-integration-delivery-20261109"></a>
### 剩余工作区整合与提交验证（2026-11-09）

用户在素材独立提交后明确要求继续处理其余三百余项改动，并要求提交标题和正文中英双语。本次包含核心/领域端口、事务回执、不可变会话快照、目录和增量内容块存储、SVG处理器2及许可、工作台整合、生产验证工具、AI恢复与语义入口，以及相应现行合同和历史证据。核心、存储、渲染与UI接口互相依赖，作为完整底座提交；验证工具、AI恢复、AI入口及文档分开提交。不改写此前各批冻结，也不把本次推送等同部署或验收。

证据根为`work/remaining-delivery-20261109/`。`candidate/`冻结基础实现，`candidate-ai/`在其上叠加完成后的AI工作线；两者分别正常构建并使用独立5227/5228预览地址。源码hash、逐文件投影与暂存blob核对保存在证据根；基础投影与核心提交唯一差异是AI说明折叠，完整版本在后续AI入口提交纳入并验证。测试均为必要开发自检，本次没有运行完整验收或正式性能。

| 检查 | 本次实际结果 |
|---|---|
| 核心底座 | `build-stable-final.log`正常构建通过；`unit-stable.log`55文件601项通过，覆盖事务/候选、快照与资源、内容块/目录/历史、渲染、生成注册、SVG/真实像素及素材集成 |
| 基础生产浏览器 | `browser-stable.log`12/12通过：森林与混合生成→保护局部采用→撤销/重做→完整备份/冷读；四领域真实Worker取消/迟到结果；1512/900/390px操作；坏块/缺块拒绝保存与冷开，跨标签CAS保全双方分支 |
| 验证工具 | `browser-discovery.log`发现16文件43项；`tool-syntax.json`核对当前性能及SVG迁入脚本语法通过。未运行这些文件的完整视觉、跨浏览器或性能矩阵，不把发现用例数记为通过数 |
| AI整合 | `build-ai-final.log`正常构建、283源码模块架构边界及248共享模块无DOM编译/Node原生往返通过；`unit-ai-services.log`5文件105项、`unit-ai-entry.log`2文件19项、`unit-harness-io.log`4项全部通过 |
| AI入口生产浏览器 | `browser-ai-final.log`5/5通过：参数仅填表、未知创建只读查原编号、超过20个更新任务仍能找回原请求、坏输出/人工修改保全，以及CLI文件正常导入→删除→撤销→保存冷开。实际CLI结果为complete、模型请求0，磁盘工程重读与PNG逐像素一致；页面AI使用受控提供方，未调用真实模型 |
| 许可与交付范围 | 88份resvg许可/说明文本保留原字节，清单中86份原始许可SHA256一致；固定WASM来自锁定依赖。上游许可原文含CRLF/尾空格，完整diff检查的这些警告保留；排除其原文目录后的代码/文档空白检查通过。独立`todo.md`SHA256仍为`c80b1d29ebf3a264ff21bf943fe779c7bf00b21e4f86a2e1bf980504224e49b6`，本机工程、图片和验证附件保持ignored |

底座提交为`56a1583`，验证工具为`2a3ed63`，AI恢复为`857d0d7`，AI入口为`1c66b84`，均使用中英双语标题和正文；文档随本节另行提交。AI入口末尾多余空行在提交收口时移除，未改可执行内容。当前受影响检查均通过，已有包体积/重复引用告警保持；后续六主题画风/用途整改、真实模型收益、完整故障/跨浏览器、整体性能、目标VTT及用户P3仍由07/09推进。本节只证明上述开发交付范围，远端推送结果由交付时Git回读确认。


<a id="image-import-vector-20261110"></a>
## 图片工具的矢量重建与本地源编辑（2026-11-10，开发自检）

本轮按用户确认的“项目程序/人工/模型共用工具”实施。新增纯共享SVG描摹/木板/织物核心，页面可调整分色、轮廓简化、显式去噪、输出长边和最多8个铺板方向分区；物件轮廓与原图占地矩形分开。工厂保全真实静态SVG原始/规范化源、processor2、固定PNG和许可闭包，个人库物件/材质支持编辑SVG源并保存新固定副本。普通完整v1格式保持，未使用Codex图像生成工具或外部图像服务。

原图整房直接描成单SVG的方案实际被16384路径命令保护拒绝。原参数矩阵及8色/简化2/去噪2均未成功，不提升全局预算或静默丢细节。最终样板把其余陈设也从地板分出，形成17个物件及1份纯木板材质，均保存真实SVG源；西、下中、东三块竖向铺板与其余横向板分别重建。西侧盆栽的完整叶尖保留，显式300×300mm花盆占地和(0,12)mm偏移通过原生支撑检查。其他陈设部分仍按相同移动行为作为布景组，尚未逐部件语义化。

首份项目CLI/MCP交付为本机 `work/image-to-project/vector-rebuild/context-output/candidate-1-6ed9d7f9-a304-4432-b6f0-965c09538736/`，projectHash为 `4ee8f498a833450f6698258676f4325c53fc3b769d61f3948d2038b9e162c6c5`。18个asset/18个SVG来源合计9,234,944像素。落盘复读及独立页面完整冷导入后2048×1843玩家预览逐RGBA差异0；这只证明保存/重放一致，不证明美术相似度。原图和结果已实际看图，细小JPEG笔触仍有分色块感，程序木板的接缝与原手绘不同，正式P3继续归09。

必要定向自检为10文件58项通过，1项私有诊断默认跳过；实际私有诊断另有上述拒绝记录。覆盖标定/像素/补底/草稿/工具代次、真实resvg、原生工程冷读、物件与材质固定来源、副本、跨类型18项以内单CAS入库及重试。独立review发现并修复共享色块透明裂缝（原opaque/128分界alpha207/116，修后255/128）和半透明程序纹理增浓（修后统一128），保持孔洞与透明轮廓。显式占地的strict point参数首败已修并保留日志，自动入库64项预算提前在准备阶段检查。

无模型程序入口新增 `tools/image-import/replay.mjs`，调用同一项目MCP。实际自有子server被信号终止后包装器明确返回退出码1并报告失败；不会因等待已发生的exit吞掉错误。当前源码和实际证据在同机被忽略的 `work/image-to-project/vector-rebuild/`；完整页面生产冻结与原图移动/入库联调在本轮收口时补入此节。

原图生产页面进一步暴露冷开后18项自动素材同步占用了全局编辑锁，导致场景对象保持disabled。已将此同步改为独立可取消后台任务，读取已保存工程、库CAS、幂等和失败重试保持；不通过跳过真实源校验来缩短处理。首次失败日志和截图保存在 `original-ui-cold-lock-failure.log` 及原图 `ui-vector/`。本项待同输入生产复验收口。

冷开编辑同例已在正常生产复验通过，实际记录两次后台同步期间对象行enabled，r6冷开后继续旋转钢琴并保存r7，18项全部入库且SVG新副本保存成功。另发现逐item准备重复全验整个来源导致18项等待超过60秒，新增批量准备在一次调用内捕获并完整验证来源一次，各neutral capsule继续公开export全验，整批返回后仍单库CAS和逐项冷读；该优化的最终定向/生产复验随收口补记。


### 2026-11-10用户否决当前矢量样板的视觉结果

用户明确指出颜色与风格发生变化，绝对禁止；低分辨率原图的高清化不能改变其风格。原图与候选按同坐标缩回449×404比较，确认手绘木板变成规则模板、灰棕色阶偏移、细笔触分色块化、黑色粗墙变成灰绿细边。当前17物件加程序木板候选判为视觉不合格，保留技术链路证据和失败产物，不作为目标交付。比对图归本机 `work/image-to-project/fidelity-correction/original-vs-rejected.png`，比较范围/事实在同目录 `comparison.json`。修正后的保真规则归专题设计和09前置硬门；本条否决优先于前文对成图的正面描述。


<a id="image-room-source-fidelity-20261111"></a>
### 2026-11-11右上琴房保真返工自检

项目自有stdio工具与无模型重放生成 `work/image-to-project/fidelity-rebuild/output/candidate-1-0b2e42e7-6ed7-491a-a02c-cb51b8c319e5/`。projectHash为 `0ff607d3bd2a96046b2add55f11a212d96870c14338e4f2fb555c6cb22f603cb`。页面上传同一原图并载入确切配方，完整保存、移琴至5800/8200mm、移毯至2700/8200mm、撤销重做和r6冷开后旋转琴12°至r7均通过。17件拆出物品和1个地板材质实际进入隔离Chromium本地素材库，琴的尺寸和占地可另存为新固定item。入库期间可编辑。完整工程、配方、原图对照、操作截图和结果均保存在本机忽略目录。

同坐标拆层合成比较163666像素、差异0，2191个轮廓抗锯齿像素另列。补底区以外比较116290像素、差异0，49567个遮挡像素属于推断。实际原生输出以原图比例比较，1177像素存在至多1级的通道差异。首轮原生墙体的零宽描边仍叠出底色，最大通道误差64，修正后宽度0时跳过轮廓底色及二次遮罩。独立冷导入后2048×1825玩家PNG与同一工程先前输出差异0，此项只证明存取一致。

定向单元93项通过、1项私人诊断跳过，正常构建通过。正常生产Chromium的图片导入4条回归通过，新增旧配方修正用例还检查实际玩家PNG墙边未被描边染暗。同一失败样板通过MCP重放时以 `material-replacement` 拒绝，未写入候选目录。首轮浏览器用例因旧预览按钮名超时，更新名称后通过。移琴检查发现紧轮廓留琴沿残影，细修轮廓后重新生成并实测。琴边仍带少量蓝毯像素，补出的木板还有局部接缝。2倍素材复制原色像素，缺失细节仍未知。正式视觉和盲测结论归09。


<a id="image-import-boundary-editor-20261111"></a>
### 2026-11-11物件画笔、磁性贴边与精细选区（开发自检）

本轮按用户确认增加磁性自由套索、保留／排除连续画笔、一笔撤销和取消回滚；物件在黑／白／棋盘背景试移试转，查看操作不进入配方。选区以原图坐标RLE蒙版贯通页面、JSON、重放、实际PNG、完整工程及MCP，保留孔洞和分离细节，显式物理占地独立。页面和 `image_import_refine_selection` 共用局部颜色梯度与画笔算法；本轮没有调用视觉模型、上传云端分割或生成式去色边。

证据根为本机忽略目录 `work/image-to-project/boundary-editor-20261111/`。`candidate/` 为独立源码冻结，正常生产预览在5293；只同步本任务文件，不把并行地图细节工作区的后续变化纳入此冻结结论。原图及原配方保持原文件不动，修边结果另存。

首轮定向单元 `unit.log` 为13文件85项通过／1项私人诊断跳过，另1文件因冻结漏复制原始素材许可而收集失败。补齐真实 `assets/` 后 `unit-assets-fixed.log` 的4项通过，未更改产品许可逻辑。首轮构建因撤销记录字面量类型变宽失败，显式保留字面量后正常构建通过。

生产页面首轮 `browser-selection.log` 为1通过／1失败，真实工程PNG检查发现Canvas编码把半透明边缘RGB `[25,31,35]` 改成 `[26,32,34]`；改用既有确定性RGBA编码器，保持像素和透明度，不放宽断言。`unit-encoding-fixed.log` 3文件20项通过，`build-encoding-fixed.log` 正常构建通过；`browser-final.log` 的6条生产回归通过，覆盖连续加减画笔、孔洞／细尖、原RGB与alpha、JSON重放、取消／失焦、400%查看、换底试转、采用后个人库及保存冷开继续编辑、旧重画配方拒绝。以上分轮记录，不拼接为一次全绿。

真实stdio MCP的 `mcp-smoke-fixed.log` 和 `mcp-smoke/2026-11-11T04-05-57-052Z/result.json` 记录15个公开工具、remove孔洞alpha0、keep外伸alpha255、内部alpha255、旧代次拒绝且草稿不变、两步撤销精确恢复。实际生成完整包及磁盘配方保留蒙版；独立冷读2048×2048输出逐像素差异0。源可比较3815像素差异0、29个抗锯齿像素另列，补底区外3261像素差异0。首轮64×64原创小样的墙距边只有2px，厚墙越界被拒绝；小样内缩6px后通过，未放宽几何校验。未调用视觉模型，故本项只证明接口与保存链路。

原图正常页面载入17层配方，钢琴／地毯／西盆栽均实际检查黑白棋盘、23°试转和画笔撤销；撤销后导出配方严格等于初始配方。`reference-ui/` 保留首轮磁性候选：同坐标合成163672像素差异0，但白底出现琴凳与顶左角刺，不能判为视觉改善。原琴沿有蓝灰混边，毯沿有深色边框与不齐小角，植物本身分辨率低且叶缘混色，缺失细节未恢复。`manual-edge-ui/` 用2px排除画笔沿琴左侧和下沿削掉外侧蓝边；修正配方重载保持，显式占地不变，163675个可比较原图像素差异0。局部修边没有证明所有混边或补底接缝已解决。

窄窗口实测还暴露拆解dialog继承折叠侧栏的hidden状态，1024px下不再可见；已将dialog挂载到页面body，并补1024／390／1512px持续编辑和无横溢回归。`build-portal.log` 正常构建及 `browser-portal.log` 同例1/1通过；`manual-edge-ui-fixed.log` 的同原图修边／重载／1024px检查通过，首败保留在 `manual-edge-ui-first-failure.log`。

磁性凹角根因是只约束法向偏移差，没有限制真实线段前进方向。增加实际位移连续性和闭合接缝约束；局部仍反折时有限范围保留人工笔迹，不平滑重画。真实26点的独立几何诊断最小转角余弦从-0.906到0.112，没有自交；该诊断使用独立解码，仅证明几何，正常页面图像另行核看。最终 `unit-final.log` 15文件93项通过／1项私人诊断跳过；追加非邻接边自交断言后 `unit-corners-final.log` 的11/11通过，不重复加总。`build-final.log` 正常构建及313模块架构边界通过，`browser-closeout.log` 对最终正常dist的6/6通过，包含1024／390／1512px不丢草稿且无横溢。已有包体积／动态引用告警保持。

`owned-source-comparison.json` 核对本任务17个代码／测试文件与实际构建冻结相等；`source-freeze.json` 和 `dist-freeze.json` 保存最终摘要，初始清单另保留为 `source-freeze-initial.json`。独立 `todo.md` 与开始时一致。完整视觉、真实模型收益、跨浏览器与用户P3仍按09执行，本任务没有提交、推送或部署；并行会话的其他修改不由本冻结证明。


最终原图生产复验 `reference-ui-final.log` 退出0、页面异常0；`reference-ui-final/` 与首轮分开保存。白底实际核看确认顶左反折尖刺消除，琴凳外侧仍吸入蓝灰背景小块，未把自动候选标为合格切图。最终候选同坐标可比较163689像素、改变0，2168个抗锯齿／推断像素另列、49546个遮挡像素；这些数字仍只证明合成保真。实际手工修边对照为 `manual-edge-ui/piano-brush-comparison.png`，左旧选区、右排除画笔后，其他边缘的混色仍需人工修正。两份候选配方分别保留，未覆盖原样板。

补验 `mcp-smoke-contour.log` 与 `mcp-smoke/2026-11-11T04-26-37-685Z/result.json` 在最终磁性算法上通过真实contour分支（4点、半径4、strokes为空）、内部alpha255／外部0、同源及补底范围外变化0、一次撤销精确恢复；同时复跑加减笔迹、旧代次拒绝、完整包与冷读。脚本及server退出0，仍未调用视觉模型。


<a id="image-enhancement-20261111"></a>
### 2026-11-11画质方向、少量候选与可编辑采用（开发自检）

接续用户确认的“选择方向→2/3个同基线候选→真实场景比较→采用后继续编辑”，并行完成本机算法、严格固定来源和页面。支持图片Prop、房间地板、地形和墙面，原件保留，三方向为2倍受限双三次、半透明边带alpha精修和弱保边去噪；局部画笔、当前/原图依据、黑白棋盘背景及同步倍率均为显式操作。元数据直接演进当前完整工程v1，算法配方独立v1；合同归[04](../04-scene-document.md#image-enhancement-model)、[06](../06-storage-and-export.md#image-to-project-save)及[工具说明](../reference/image-to-project.md#image-enhancement)，正式检查归09。

证据根为本机忽略目录 `work/image-enhancement-20261111/`。原会话中断前的单项结果不拼接为本次完整通过。接续后核心与严格元数据2文件29项通过，含三方向连续两代2倍增强及局部蒙版完整包冷读；平台/Worker/命令准备/快照4文件33项通过（`integration-final.log`）；导入会话/选区2文件23项通过（`import-regression.log`）；个人库与位图管线2文件4项、恶意依赖1文件1项分别通过。上述是分组执行的90项定向检查，不是完整回归。许可、原件、伪造输出、坏来源、循环/深度、颜色覆盖只应用一次、局部范围外像素及无关编辑/锁/旧基线均有针对证据。

审查收束两个边界：纯算法原先允许8192边而保存只支持4096，统一到共享4096门并验证候选生成阶段提前拒绝；来源依赖新增递归改为显式栈，12000层恶意链可正常到达16层领域拒绝。正常 `npm run build` 在 `build-final.log` 退出0，317源码模块架构边界通过，已有大块/动态引用告警保持。`production-dist/` 保存独立正常产物，177文件摘要在 `production-dist-manifest.json`；`owned-source-comparison.json` 核对本项18个生产源码与冻结一致。构建时其他会话另有四份道路源码编辑，单列 `unrelated-source-drift.json`，不由本项验证其行为或性能，也不把后续根目录修改纳入本次正常产物结论。

生产页面首轮 `browser-continuation.log` 为1通过/1失败：取消后面板收起，断言读取隐藏提示；调整为展开后检查。随后 `browser-final.log` 为1通过/1失败，取消Worker后的被拦截网络请求已结束，测试再次continue触发“Route is already handled”，并中断后续保存等待；测试现在等待该被取消路由完成并只处理这项确定的取消错误。产品代码未因此放宽或绕过取消逻辑。最终 `browser-route-fixed.log` 对相同冻结正常产物2/2通过，覆盖三方向、2/3候选、390px无横溢、笔画取消/撤销、生成时修改另一物件、取消/迟到、旧目标拒绝、局部范围外真实RGBA、场景预览取消/采用、撤销重做、冷开移动旋转及当前/原图再生成。首败输出分别保留。

`real-comparison/metrics.json` 固定原琴房包SHA-256 `15214c3df9283e86c3bb67b59728be4ee6350663f3be6b1c8d6d46b6de6ae9ad`。钢琴204×150、地毯144×200、盆栽60×56、地板898×796各生成三方向三候选，原图/轻/中/强用灰/绿/蓝/紫条在同尺度对照；地板联系图只取中央裁片，完整PNG另保留。四类×三方向12组实际局部范围外变化均0，配方重放hash一致，输入包未修改。该离线对照使用软件PNG直RGBA，原始普通位图在页面按native路径解码，半透明RGB可能有舍入差；不把两条路径的输出混成同一像素结论。

`real-ui/run.log` 与 `real-ui/verification.json` 在独立浏览器库、冻结正常生产5387上完成真实原琴房：钢琴从204×150生成三候选，选中间2倍结果408×300，两侧同物理比例显示宽均408px，白/黑底实测；实际画布预览后一次采用，原Prop除定义/外观外全字段保持，其他16件物件保持。下载 `real-ui/map.sceneweave`，页面冷开后的资源hash与采用前备份一致；旋转7度并保存 `continued-edit.sceneweave`，继续处理时可分别读取408px当前图和204px保留原图。原输入hash保持，页面异常0；截图为实际页面和原生画布，不是离线联系图。

代理已实际查看钢琴、地毯、盆栽、地板的候选及琴房冷开画布：放大边缘更平顺，但原图模糊、琴沿混色、植物缺失细节和补底接缝仍在；去噪可能削弱笔触，候选的变化量不代表质量提升。增强是显式派生编辑，不能冒充原图逐像素保真、模型超分或用户P3签收；此轮未接云端/生成式细节。完整跨浏览器、盲测与09矩阵另执行。独立 `todo.md` 保持；保留其他会话改动，未提交、推送或部署。

<a id="unified-asset-editor-20261111"></a>
### 2026-11-11统一素材编辑与导入总览（前轮开发自检）

用户要求素材围绕同一个item编辑，图片导入围绕同一工作台的对象、统计和问题整改；图像处理不另设产品页面。内置、个人与导入物件/材质/组合共用素材副本页，场景实例明确独立范围，切页保留字段和图像草稿；导入集中四阶段、对象清单、统计、可定位问题与单画布。

前轮证据独立保存在本机忽略目录 `work/unified-asset-editor-20261111/`：`unit-final.log` 2文件17项通过，`build-fixed.log` 正常构建通过，`browser-production.log` 对该轮冻结生产包16条通过（6.7分钟）。`frontend/` 保存8张实际页面截图、DOM与 `facts.json`，覆盖场景/素材副本、390px与导入工作台。首次失败和中断输出保留，不将未完成的额外typecheck记为成功；这些结果不覆盖下节新增两路线代码。

钢琴蓝边、木纹接缝和暗带没有因页面统一而解决，插值后的精细度也未改善。后续转为以原钢琴比较矢量结构重建和有限模型补画，目标是可推广的算法与设计收益，不能用手工修好单张或只增加分辨率关闭真实缺陷。

<a id="asset-refinement-routes-20261111"></a>
### 2026-11-11同页矢量重建与模型补画（开发自检）

用户确认两条路线均归统一素材编辑页，目标为持续改善算法与设计。矢量从分色初稿提取共享边界链，同一内界正反复用，在有限双向误差内拟合二次曲线，保护细小闭环与拐角；输出真实受限SVG与固定PNG。模型接入独立图片编辑配置的应用服务，每次一张透明PNG，显式上传/计费同意；采用保留原件、实际PNG、上传像素hash、提示与客户端/供应商请求ID，离线冷读不再调用模型。服务端完整请求摘要与上传像素hash含义不同，工程记录的是后者。基础插值明确不增加细节，收在同页折叠项。

新增 `imageRefinement` 严格来源合同直接演进当前完整工程v1，与基础处理共用16层祖先闭包、资源/许可、逻辑尺寸、固定定义、普通候选采用与撤销。矢量公开/冷读重放到确切SVG并核对实际像素，模型冷读核对上传原件像素hash；颜色派生不复制另一输出的来源声明。私有候选witness防止页面改像素或伪造候选，目标变化/锁定拒绝旧结果。个人素材加入新候选前明确确认清理其他图像草稿，取消保留各路线；名称/尺寸/占地仍保留，未知模型请求ID跨图像子面板重挂载保持。

证据根为本机忽略目录 `work/piano-limited-inpainting-20261111/`。`unit-closeout.log` 的6文件61项通过，覆盖共享曲线/孔洞/细线/半透明边、取消/预算、原件与混合来源闭包、个人副本、完整导入导出/冷读、伪造/旧基线/锁定和普通亮度只应用一次。`service-final.log` 的图片服务11项与 `service-boundaries-final.log` 的配置/HTTP边界18项分组通过；全部受控fetch，不发真实模型请求。`shared-integrated.log` 的289模块无DOM编译与共享边界通过。

审阅修复400万至800万像素规范RGBA源的模型输入模式记录：实际解码方式不再取决于可选小图副本，2048×2048半透明SVG在模拟原生RGB舍入时仍可生成并冷读。首轮该新夹具使用不受支持的 `fill-opacity` 被严格SVG守卫拒绝，改用既有 `opacity`；随后对1600万通道做逐值测试断言导致测试worker退出，改为相同完整RGBA的SHA-256比较后通过，不放宽像素判定或产品预算。首次共享编译发现 `TextEncoder` 进入无DOM模块，改用既有UTF-8适配器；日志原样保留。

原钢琴仍为204×150 PNG，hash `43aec9d33b6c303d39b3865ae49b1181d938fc69040c61475111f29cf4fea390`。`vector-structure-four-way-comparison.png` 用同尺寸比较原图、旧插值、旧trace与新曲线，`vector-structure-report.json` 保留参数/摘要；24条路径、574条Q曲线及最大0.354源像素误差只描述算法结构。实际查看仍见碎分色、蓝边和缺失键盘细节，未判为精细度改善，也未替换示例工程。真实模型尚未请求；钢琴蓝边、木纹接缝/暗带与用户视觉P3仍待09，未提交、推送或部署。

最终 `build-closeout.log` 正常构建退出0，324模块架构边界通过；既有动态引用/包体积告警仍在。`source-freeze.json` 固定1447份源码/工具/配置，构建前后摘要一致，`production-dist/` 与清单为5410上的独立正常产物；`source-drift-check.json` 也未见构建后源码漂移。工作区仍有其他会话编辑，本轮测试仅证明所列影响范围，不外推全仓验收或性能。

生产 `browser-production.log` 首轮为7通过、1失败、1中断、1未运行：失败的个人库用例先用role查找折叠details内隐藏面板，因此无法定位其summary；中断用例停在相同选择器。改为直接定位实际折叠标题，产品代码与正常产物未改变。`browser-unified-fixed.log` 对同包的3条统一编辑旅程全部通过；与首轮7条分组记录，不拼成一次全套通过。实际覆盖SVG下载、两路线保留参数/候选、目标编辑失效、场景一次采用/撤销/重做、原件/完整包冷开、基础局部范围、个人副本、明确清草稿/取消保全，以及unknown只一次POST且ID跨加入候选保留。所有模型HTTP均为受控fixture，无真实费用。

`frontend/capture-final.log` 与 `frontend/facts.json` 从正常UI导入同一原琴房，生成默认24色/0.45矢量候选，实际保存7张桌面、黑底200%、未配置模型、390px与素材副本图；页面异常、控制台错误、失败请求与image-edit请求均0。截图脚本首轮在素材详情同名外容器/内容区严格选择器冲突，前6张与失败记录留 `frontend-first-attempt/`，收窄到真实目录内容区后整轮完成。已实际查看桌面、棋盘/黑底对照、390px与库副本，候选没有预览、采用或另存；两页均明确丢弃草稿，原素材摘要保持。截图只证明当前界面和真实算法输出，不代表画质改善或P3。

用户要求持续自审后的新增证据放在 `work/asset-refinement-self-review-20261111/`，保留前轮冻结。`boundary-audit/run.log` 的3项诊断复现旧缺陷：全透明PNG仍可生成/采用/冷读，成功HTTP后取消或实际解码失败丢失请求ID。已在宿主拒绝全透明结果，响应后拒绝统一保留finished ID；传输在单次POST前同步登记ID，服务明确未发送时更新为not_sent。两编辑器分别持有请求记录，清草稿、切路和个人图像面板重挂载保留；记录用于关闭/离页保护，不作为未采用图像草稿卡住保存。新增修复的 `unit-request-and-host.log` 为2文件21项通过，包含返回后取消/解码/比例/全透明、完成失败及发送前后状态；不重复发送模型请求。诊断用例描述旧行为，其通过表示成功复现旧缺陷，不算修复后的通过证据。

`build.log` 正常构建退出0，325模块边界通过；依赖注释、动态引用与包体积告警保留。`source-freeze.json` 固定1451项源码/工具/配置，构建前后无变化，`production-dist/` 与清单是5411的独立正常产物。该包串行执行 `browser-unified.log` 3项及 `browser-refinement.log` 7项，分别全部通过：正常矢量/模型候选的场景采用、撤销/重做、原图/物理/许可保全及冷开，旧目标拒绝，个人副本跨图像候选确认/取消，未配置不上传，全透明拒绝，POST未返回前已有ID，取消/切路/清草稿及关闭确认仍可核对ID；每个模型旅程只一次受控POST。模型成功夹具只改变一个不透明像素以验证传输与采用，不是补画质量证据。构建后 `source-drift-check.json` 发现其他会话继续修改两份handdrawn-surfaces源/测试；本轮精修相关文件未漂移，所列浏览器结果绑定冻结包，不外推当前全工作区或全仓回归。

`frontend/capture.log`、`frontend/facts.json` 从正常UI导入同一真实琴房，更新7张桌面、对照、黑底200%、未配置模型、390px和素材副本图；Chromium 141.0.7390.37，异常/控制台错误/失败请求/模型请求均0，390px文档横向溢出为0，候选均未采用或另存。路径/曲线数字改收在折叠的“算法与误差记录”，明确不是画质分数。另在 `vector/comparison.png`、`vector/report.json` 对照原图、24色和48色：48色更接近原图色阶，但未补出键盘结构或解决蓝边；加平滑的48色诊断超过16384命令预算，被拒绝，未放宽预算或改变生产算法。实际视觉仍未达到精细度目标，木纹接缝/暗带也未解决。只读检查本机专用图片编辑三项配置均缺失，未发真实模型请求、未产生模型费用；实际补画质量与用户P3仍待，未提交、推送或部署。

用户随后纠正了接续表述：缺少图片编辑模型不能阻塞本机SVG路线。已在页面与专题合同明确SVG不需要模型、服务地址或访问凭据，并在07把SVG整改列为独立优先工作。`work/svg-independent-route-20261111/browser.log` 对当前dev页面定向运行原有矢量旅程1项通过，新增断言覆盖生成、切路、SVG下载、场景采用及撤销/重做期间image-edit请求总数为0；未重跑整套生产回归，也未改变矢量算法或宣称画质改善。

本机SVG继续独立整改的证据归 `work/svg-reconstruction-20261111/`。新 `regional-tones-v1` 用实际源像素距离分色、连通区邻接与受限单方向RGB渐变拟合替换平色填色选择，再复用原共享曲线几何阶段；细窄区不合并，未选用渐变的区域保留原始分色标签。源采样逐通道RMSE≤4、最大通道误差≤12、总平方误差至少比平色低10%才采用渐变，端点限制在观测范围；这些门槛不代表最终曲线渲染全图误差或画质。100万像素、65536采样格、16384区域、20万合并尝试/每区64次及96渐变均有界，超SVG256路径/16384指令预算明确拒绝，不删区域。新旧算法按严格来源ID分别重放，不原地改义。

`integrated-unit.log` 的3文件23项全部通过：旧曲线算法、独立解析色阶夹具的规范SVG实际渲染、1px细线/2px孔洞/独立小块/alpha128、平色无渐变、确定性/源不可变/取消/实际区域超限，以及宿主个人副本/混合来源/完整包/冷读/旧ID和改标篡改拒绝。首轮宿主4项因平色输出空defs被严格SVG拒绝，已改为仅有定义时输出defs；首轮半透明细线RGB断言遇到规范resvg预乘舍入，改与独立同色SVG参考逐值比较，仍精确检查alpha与1px线宽，旧失败日志保留。自审再把渐变RMSE由三通道合计限制收紧为逐通道限制。`legacy-replay-comparison.json` 与原冻结钢琴24色SVG逐字节相同，SHA-256为 `53e6e7c26da1a4ebaebbd759246dcf22d79fb347181b6cf3e6ae9c7a877801e3`。

`evaluation/comparison.png` 依次为同一204×150钢琴原图、旧24色、新24色与新48色。实际查看新算法的碎色块减少，但默认24色仍有色带，48色更接近原图；键盘未知结构没有补出，蓝边仍在。`evaluation/report.json` 的不透明源像素RGB通道RMSE分别为旧24色5.733、新24色4.515、新48色3.222，仅描述对原图的近似，不是新增细节或美术质量评分；原图hash继续为 `43aec9d33b6c303d39b3865ae49b1181d938fc69040c61475111f29cf4fea390`。默认仍24色/0.45，未用提高默认颜色数量替代算法收益；木纹接缝/暗带没有在本次SVG色阶整改中解决。

`shared-check-final.log` 的292共享模块边界与无DOM编译通过；`build.log` 正常构建退出0，327模块架构边界通过，既有依赖注释/动态引用/包体积提示保留。`source-freeze.json` 固定1454项源码/工具/配置，构建前后摘要一致，正常产物独立复制至本轮 `production-dist/` 并在5413预览；全部检查后 `source-drift-check.json` 未见该冻结漂移。`browser-production.log` 在同包串行执行7条双路线和3条统一编辑旅程，10/10通过；SVG全流程零模型请求，新来源ID实际进入采用包，模型仍全部为受控HTTP夹具。

`frontend/capture.log` 与 `frontend/facts.json` 从首页正常导入同一真实琴房，7张桌面、棋盘/黑底200%、未配置模型、390px与素材副本截图全部完成。已实际查看桌面、原图/候选、黑底、两张窄屏和库副本；页面异常/控制台错误/失败请求/image-edit请求均0，390px横向溢出为0。截图用默认24色/0.45，候选均明确丢弃，没有改写原样板。另一次隔离旅程 `frontend/adopt-cold-read.log`/`adopt-cold-read-facts.json` 对真实钢琴生成同参数候选，普通场景一次采用、撤销/重做、完整包下载，再在空白浏览器存储正常导入冷读全部完成；原件与全部PNG/SVG/许可资源摘要保持，物理/支撑/私密/锁字段保持，异常与模型请求均0。输出固定资源ID为 `image-enhancement-41ced7a065814812d63cc31a9e865c2156649989eab8a494e39181f4083b7083`，仅此隔离验证工程采用，不替换用户原琴房。

本轮原型试验中的直接逐色块渐变与过强聚类因仍有色带或压平质感未进入生产；一次过宽对照拼图超过规范PNG边长预算，改为有限布局，不放宽产品限制。自审结论为色阶表达相对旧SVG改善，尚未达到真实钢琴的精细重建目标；继续按07处理前景/环境混色与结构约束，真实模型效果、木纹缺陷和P3保持待验。未发真实付费请求，未提交、推送或部署。

用户对前轮实际画面明确判为不合格，要求以视觉理解重绘边缘和细节。后续证据归 `work/structural-redraw-20261111/`；钢琴几何不写入生产默认算法，而是依据原图分析为独立源绑定结构稿，经共享 `structure-plan.ts` 与同一宿主生成/采用/冷读。结构稿明确区分依据原图的部件关系和推断的具体键数、黑键节律、铰接、缝线、高光形状与接触阴影。编译器不从像素自动识别，不能将该人工视觉稿当自动语义算法已完成。

局部稿件经过三轮实际图像复查：首稿虽然清楚且去掉整圈背景蓝边，但琴盖偏长、高光像胶带、键盘过亮、琴凳像胶囊；第二稿缩短盖面与高光、压低键色并调整凳框，仍有过宽塑料感厚边；第三稿抬起第一层厚边并断开低对比高光，轮廓/键盘/厚边和琴凳已可辨。`piano-structure-plan.json`、`piano-structure.svg` 与 `comparison.png` 保存当前稿，31个声明元素展开为64路径/373指令，10项依据原图与21项含推断；数字仅说明结构复杂度与声明，不证明画质。白/黑/暖底局部复查未见原先整圈青蓝杂边，画风仍更等宽圆顺、色面更平整，属于矢量插画重绘候选，不能称完全保留手绘笔触或真实细节恢复。原保真裁片不改写，木纹接缝/暗带不在本次结构稿修复范围。

默认SVG方式调整为结构重绘；像素描摹作为明确保留原图缺陷的对照入口。页面载入JSON结构稿、审阅部件/推断、修改旧候选阻止采用、切换方式保留各稿，重开可读取已保存稿；生成使用1024长边固定PNG与真实SVG，不套原alpha。严格 `structure-plan-v1` 来源分支直接演进完整工程v1，绑定实际源hash/尺寸与完整计划；公开/冷读重编译计划再核对实际SVG/PNG。原件/许可、物理支撑/私密/锁与旧基线/witness继续适用，结构稿可以修改轮廓但全透明输出拒绝。旧regional/legacy ID语义保持。新增通用路径/重复形元/渐变的源框、累积预算、危险引用、访问器与描边外扩守卫，贴框粗描边显式拒绝而不静默裁断；该控制点包围盒检查是保守界，可能拒绝实际曲线未越界的极端稿件。


本轮冻结验证在 `work/structural-redraw-20261111/`：最终 `unit-parent-fix.log` 为结构编译器与宿主两文件 **33/33通过**，包含基础处理A→中间图B→结构稿C→完整导出/冷读后恢复B实际hash/像素/坐标框并继续生成。首轮最终定向跑有一个既有大源冷读用例在并行构建负载下超过原30000ms时限（`unit-final.log`），最终串行跑保持原时限通过；没有提高超时或删断言。独立审查发现保存稿只可选根原图/当前结果而无法恢复中间父源，已新增「已保存结构稿来源」：只由当前已校验结构资产指定确切直接父源，保持当前目标基线、真实字节/许可和私有witness，不改写稿件hash。新增正常页面链式旅程同时覆盖该修复。

正常构建因其他存储工作线改动导致源冻结守卫拒绝，不将该现场dist当作本次绑定证据；随后复制隔离输入。第一次隔离副本遗漏 `assets/` 导致编译失败（`snapshot-build.log`），补入71个素材输入后通过；父源修复后最终 `snapshot-build-parent-fix.log` 的 `npm run build` **exit 0**。冻结包含1878输入文件与179生产文件，`source-snapshot-after-build.json`、`production-dist-manifest.json` 和 `final-integrity.json` 记录无源码/产物漂移，12个本任务源码/测试与当前工作区内容一致；不覆写其他存储编辑。Vite既有大包与依赖注解警告保留，不当作性能改善证据。

对该冻结正常dist在 `http://127.0.0.1:5414/sceneweave/` 串行运行 `asset-structure-redraw.spec.ts`、`asset-refinement.spec.ts` 和 `unified-asset-editor.spec.ts`：**13/13通过**（`browser-production.log`），包括3条结构稿页面旅程、7条原双路线回归与3条统一编辑页旅程。受控模型响应只作流程验证，不代表真实补画效果或真实渠道已配置。

`frontend/capture.mjs` 从普通首页导入真实琴房工程，以真实 `extracted-piano` 生成本次结构稿，保存7张桌面/棋盘/黑底200%/未配置模型/390窄屏/目录副本截图及DOM观测。`frontend/facts.json` 记录页面错误、console错误、失败请求与图片模型请求均为0；窄屏client/scroll/body宽均390px，生成后显式丢弃场景与素材副本草稿。`frontend/adopt-cold-read.mjs` 再从普通页面实际采用，导出、撤销、重做，并把下载包导入空白浏览器存储：`adopt-cold-read-facts.json` 记录原件/实际资源hash保全、物理/支撑/位置/私密/锁不变、撤销回原图与重做回候选、空库冷读一致，页面错误与模型请求均为0。可继续编辑完整包为 `frontend/piano-redone.sceneweave` 与 `frontend/piano-cold-read.sceneweave`。

原场景对照 `frontend/08-room-original.png`、`09-room-redrawn.png` 使用相同视口，实际canvas均1200×1070、显示1176.984375×1049，并从正常场景菜单清空选中框。第一次截图在布局尚未稳定时画布尺寸不同、采用后仍有选中框，保留于 `frontend/first-room-capture/`，不作为同尺度证明；一次在画布外空白处右键未弹出菜单的截图脚本失败保留于 `frontend/context-capture-failure/`，改为聚焦视口后Shift+F10正常菜单及两帧布局稳定再截图，最终完整旅程通过。独立视觉复查实际查看最终两图，确认本轮轮廓/厚边/键盘更清楚、下沿青蓝混色边消失，无不可接受的位置/方向/比例/遮挡变化；色调与琴房基本协调，但新琴比周围家具规整清晰，琴键略亮且重复更均匀。结论只为本轮有限结构重绘候选达到开发自审目标，不外推自动识别、完整手绘保真、全部拆图质量或用户P3。原保真裁片、木纹接缝/暗带与周边低清仍未修，未发真实模型请求，未提交、推送或部署。
