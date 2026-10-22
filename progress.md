# 执行记录

## C1d，2026-10-22
- 用户在下一步建议后“继续”，授权命名快照、独立物件局部恢复、安全保护点及可携带历史备份。
- 已核对README/导航/AGENTS、路线、04/06/09及现有v3工作区/仓库/完整包。继续使用planning-with-files；原Git脏改动均保留，前批证据不覆盖。
- 合同选择：SceneDocument继续严格v3；历史身份为新严格v4工程信封/容器的数据，不向v3文档或旧manifest加字段。领域、渲染和用户层继续使用完整原生v3文档。
- C1d合同已冻结；核心身份/恢复、IO容器/独立仓库、工坊UI分别分工。主代理已写WorkspaceV4，完整资源随撤销状态保存，保护点前后校验基线/源快照，尚未运行验证。
- C1d领域、IO、工作区与UI均已实现；全量53文件649项单测、正常生产构建通过。两项重写入存储测试受全套并发影响超过默认5秒，保留失败日志并分别设20秒上限后全套通过；未放宽产品校验。
- 首轮12项Chrome为9过3败；双样板/双受众4K逐像素等价、两组秘密物件恢复、真实双标签CAS及5项UI已通过。离线夹具过早拦截运行时静态素材元数据，迁移符号夹具遗漏清空未配套位图目录；修正测试准备后进行12项串行复验，保留首轮现场。
- 修正夹具后的C1d定向12项全部通过；全量Chrome121项为120过/1败，唯一失败是旧B4 VIS-02取消探针混入后续视口crop解码（decoded17/closed14），产品/持久化/取消状态断言通过。
- 探针改按当前资源Blob身份排除预览，只暂停/统计导入解出的新Blob；真实解码和精确关闭计数不放宽。B4四项串行复验全过，完整121项已分别取得通过记录，但不写成同批一次全过。当前完成正常生产UI与docs/27归档。
- 正常生产UI通过并目视桌面/390px窄屏：真实样板命名、35°→0°范围恢复、取消、保护点、r3/r4/r5采用/撤销/重做与明确备份子集均符合预期。首次runner过早采样已另留报告，补等待忙碌状态结束后通过；产品未改。最终独立类型检查通过。
- docs/27已记录严格v4信封/严格v3文档、迁移/身份/三种恢复模式、预算/CAS与故障阶段、各批真实计数和未完成项。C1d目标20份附件、全量reporter无损gzip、日志及诊断已归档，正在完成机械校验；未开始C2。
- C1d最终机械检查通过：31份主文档的617个本地链接/11锚点、20份附件、43份本地诊断、原reporter压缩前后hash和31份源码指纹一致。仅清理4个本批源码文件末尾多余空行，无语义改动；目标凭据模式未命中，LICENSE/public无本批更改，暂存仍仅todo.md且保留原空行提示。本地交付完成，未提交/推送，C2尚未开始。

## 2026-10-21
- 已重读 README、导航、协作和相关路线；Git 状态已盘点。memory 搜索无 Sceneweave 命中。
- 当前进行性能基线与工具设计，尚未修改产品源码或开始 C1c。

- 性能定向既有单测26项通过；基线短跑study500正常完成(2次，不纳正式)。现正式四组×3轮×30次基线串行运行。
- 已改选择索引仅认证快照复用、锁提示复用、Set合并/列表查询、memo行、面板派生缓存；等待后测。新增访问者可变/浅冻结负例尚未运行。

## 性能设计确认后
- baseline-verified / optimized-verified 均完整12轮；第一轮后433项单测、构建通过，未据此开启C1c。
- 2000框选DOM p95由82/86ms降至23/21ms，双rAF128/120ms；多选改单选仍483/513ms。
- 已发现全局button选择颜色/背景过渡150ms，待外部隔离与时间线验证，不把嫌疑当定论。
- 用户确认选择会话解耦、轻量摘要、对象列表虚拟化、选区和编辑预览LOD、精确空间索引。
- 子代理分别只写虚拟列表、空间索引/摘要、诊断工具；主代理负责会话集成与LOD。正式测量统一串行。

- 已集成选择独立订阅、按需共同属性、32/256级选框；长列表约14行。编辑视口保持即时变换，停稳160ms后请求最长2048px可见crop；渲染端LOD独立入口由core代理实现中。诊断串行运行，暂不测试。
- 首轮C0/C1b浏览器15过4败，trace明确为候选取消后复用同project身份但crop源canvas已释放，layout effect误读零尺寸Canvas导致卸载。已增加释放态检查并补回归，保留失败log于/tmp/sceneweave-selection-v2-browser.log。

- 修复crop释放态后C0/C1b真实Chrome19项全部通过；LOD真实6项5过，1项small测试工程越Floor边界，测试代理修夹具并定向复测。另补placement bitmap已关闭尺寸防护。

- 新production构建通过并保全work/selection-designed-dist。正式采样首批在第二轮被refinement检查中止：实际60样本计数均2，setup/warmup中1→2被过宽before窗口误判；工具代理修正窗口后用全新selection-designed-verified-setup-fixed重跑，旧失败目录保留。
- docs/25草稿与baseline/第一轮后测的无损压缩样本、诊断overview已入evidence/m1-c-selection，不作为最终通过声明。

- 最终选择复测12轮完整通过，500/2000双rAF框选p95均约32ms、改单选约28–29ms，720样本选择窗口无LongTask。已开启C1c；core/v3、io/v3、render/v3分工，主代理负责编辑集成。完整交互性能仍开放。

## C1c，2026-10-22收尾
- 严格v3领域、native投影/Canvas、m1-layers完整包和独立DB、v2确切原件/来源链迁移已实现；图层成员移层/非空删层显式完整范围预览，锁与256预算复用完整依赖校验。
- 修正真实可见墙join/层序选择、隐藏连接与递归文字、空组合GM注记及显式null/false迁移来源；选择层成员及对象菜单移层已接入。
- 最终全量单测47文件568项通过；生产构建通过。单测首次4败来自跨门高差无效夹具，改为合法B3地形连接及明确防御性引用闭包测试，保留失败日志，不弱化几何校验。
- 全量Chrome109项108过/1败；旧B4取消解码探针混入后台初始crop。等待初始crop完成再暂停真实导入后，B4四项+C1c三项定向7项全过；C1c持久化/渲染13项在全量内全部通过。原失败现场与最终定向记录均保留。
- 生产UI真实副本迁移、展开7项整组移层、隐藏不改revision、正常站点无DEV/performance API已验证并目视两张截图。仅有既有favicon.ico 404；不计为地图资源错误，报告单独保留。
- native v3相同四组B5负载正式选择测量已启动，期间无其他浏览器、测试或构建。
- native v3正式12轮完成，720样本无LongTask；500/2000双rAF框选p95为31.7–32.8ms、替换27.3–29.3ms。完整native v3包/原始IDB/revision/save/base/refinement及构建指纹不变；独立样本已归档26，未混用v2成绩。
- 最终检查561个本地文档链接无缺失，归档哈希与解压720样本一致；本批native源码无尾随空白、目标密钥模式未命中。git diff --check仅既有todo.md末尾空行提示，保持无关文件原样。未提交、未推送；C1c本地交付完成，下一入口C1d仍待后续授权与新历史合同。

## C2，2026-10-22
- 用户“做吧”授权C2。已重读AGENTS/README/导航、07与现有v3命令/v4身份/恢复/历史工坊。使用planning-with-files，保留历史计划记录并追加新阶段。
- memory快速检索Sceneweave无命中；无相关历史memory事实。工作区干净，从main/2e14885开始。

- C2已接入建筑面板/画布整数吸附、矩形与斜边多边形、墙门属性与显式依赖确认、会话量尺、固定遮罩/注记及既有世界/导出范围字段的事务入口。独立 annotations/范围/绘图暂态9项单测通过，当前类型检查通过；建筑拓扑和结构恢复由分工代理继续实现，尚无完整UI或SCN01通过声明。
- 工作期间todo.md出现用户新增“打开场景等待准备/确认”的缺陷记录，保留原样，未纳入C2结论或覆盖。

- C2结构恢复已接工坊：类型筛选/虚拟列表、精确依赖与跨层确认、字段差异、保护点后一次采用及取消。修复建筑列表展开交互；补组合/散布父锁回归。集成类型检查及SCN01/命令32项通过；SCN01首轮两失败为支撑边界夹具和浮点端点断言，修正测试后复验通过，未放宽产品守卫。现串行Chrome C2首轮执行中，尚无浏览器通过结论。

- C2首轮Chrome 6项5过1败；渲染/离线/秘密3项及共墙锁/量尺2项通过。SCN01入口复选框直接预览后checked读旧文档造成控件复位，修为暂态勾选+显式预览入口修改，待复验；完整失败日志和trace保留在c2-first。

- C2最终全量单测59文件721项通过，正常生产构建含类型检查通过；C2定向Chrome11/11通过，全量Chrome同批132/132通过（714.04秒），没有跳过、失败或重试通过。此前失败现场与修正后独立记录均保留。
- 正常生产构建真实UI双室/门窗、r4命名后r6共墙厚度恢复、取消、保护采用r7/撤销r8/重做r9及所选历史完整包通过。目视1512×982与390×844截图，无横向溢出；邻室后改名称和完整资源保持，正常页面无开发/性能API。仅既有favicon404留在报告。
- C2报告与主文档已同步实际子项结果及会话结构恢复/预算限制。归档18份目标附件、113份本地诊断索引、原始reporter无损gzip及31份本批源码指纹；现在完成文档/哈希/许可与私人信息机械检查。未改用户todo.md，未提交、推送或开始C3。
- 另目视符号家具的玩家/GM 4K对照：固定遮罩隐藏密道、秘密门及GM文字，GM保留对应内容；这组图仍只作28所列有限子集证据，不升级完整SCN-01或主题P3。
- C2交付机械检查通过：35份主文档及全部本地链接/锚点、205个表格、33项PRD/67项QA引用、原reporter无损hash、18附件、31源码/43构建和113本地产物指纹一致；完整ZIP CRC/hash/许可复核通过，目标凭据模式无命中，排除用户todo.md后无空白错误。去除了103份已核对相同的全量旧用例重复产物（原始test-results保留，原reporter无损归档），C2与失败截图独立保留。所有阶段完成，未提交推送、未开始C3。

## C3，2026-10-22
- 用户明确授权C3。已读取README、导航、协作、路线与04/06的来源/覆盖/恢复合同；继续planning-with-files，保留完整C2脏基线和所有历史证据。
- 采用新严格v5完整工程信封及独立仓库，完整有效SceneDocument保持v3；新的源/派生/层与实例覆盖图不偷加旧字段，identity2加入非复用组合身份。旧v4只通过显式严格视图用于既有几何/渲染，不能以视图替代保存。

### C3 integration progress — 2026-10-22
- Froze a new strict v5 composition envelope/container and independent repository; effective scene remains native strict v3. Public contract appended to 04/06; implementation still under verification.
- Root added /#composition, explicit V4→V5 entry, searchable stock/custom catalog, PNG/JPEG/WebP import form with physical/license declarations, parameter scope/per-rule removal controls, fixed prefab/member controls, generic reviewed candidates and V5 history UI.
- SceneInspector public workspace contract now explicitly permits async execution; compound delete/detach/unpack handlers await before changing selection. Existing V2/V3/V4 routes remain separate.
- New C3 real browser fixture and UI tests written; NOT yet run. Agents own core V5, complete IO/storage/migration/pixel validation, and restore/workspace semantics and tests. No historical report/evidence overwritten.

### C3 verification and fixes — 2026-10-22
- Domain targeted unit: 32 new tests across commands/graph/identity passed after enforcing source ancestry, immutable template privacy, continuous adjustment mutual exclusion and retained source/variant native-v3 roots. IO targeted unit: 51 tests passed; restore/workspace targeted: 31 passed before the final cross-branch ancestor-root addition. These are scoped results, not final all-suite evidence.
- System Chrome real PNG/JPEG/WebP metadata removal, wrong-pixel refusal, offline selected-history package and decode cancellation passed. Initial UI fixture missed a valid GM mask and was corrected without relaxing privacy guards; subsequent UI source/layer/undo, import/search/license and private prefab cases passed. A stable isolated scoped effective restore passed after a real orphan-derived-asset failure prompted fixed root retention. Targeted combined runs before that fix were interrupted/failed and retained under work/c3-20261022; final stable run pending.
- Root inspected desktop UI screenshot. Bounded surface opacity and custom source shadow rules now have explicit UI wording. Normal production runner prepared but not yet run. Final source freeze waits for branch-ancestor resource/license restore test, then unit/build/full Chrome/production and final documentation.

### C3 最终交付记录

- 跨分支祖先资源恢复、候选注册/采用二次校验已完成。最终审查进一步将公开previewPrepared限为纯目录/素材追加；既有实体、私密性、锁、层、identity、源映射和覆盖不变，旧资源/许可不可改删；普通编辑只走有限命令及私有注册。15种绕过拒绝与实际入库/CRC失败回归已通过。
- 最终全量单元70文件839项全部通过（55.05秒）；全量Chrome145/145（680.35秒），其后App一次性交接修复和v5入库限制由最终C3专项16/16（170.20秒）覆盖，两个源码批次指纹分开保留。新原生存储测试实际验证双标签revision冲突与完整另存副本、保护点metadata竞争拒绝与重新预览成功。没有把不同批次相加成一次全量结果。
- 最终构建首次仅因新测试条目unknown类型失败；补两处会被擦除的as const后正常npm run build通过。正常构建C3按需加载，仍保留主包>500kB及第三方注释警告；未作正式性能容量声明。
- 正常生产UI不调用dev API：创建16×12m空白、解码18内置素材、放置书桌r1、分别调色/亮度至r3、命名后再改色r4、只恢复物件外观并落保护点至r5、下载与重开通过。18原图+3派生真实解码且派生逐像素符合固定源计算；选一命名历史包222723字节、全部条目hash/许可核验，GM/玩家PNG4096×3072。桌面与390px截图已目视，无横向溢出，无开发/性能API；仅既有favicon404。
- 主文档和docs29已同步实际范围与下一入口C4。839单元/最终C3原reporter、日志、生产包/PNG/截图已归档；145全量reporter原件留work，永久compact索引保留用例与附件真实hash，避免重复大附件。历史666文件逐项hash受保护，todo.md工作期间存在无关新编辑，全部保留，任务未写入或恢复该文件。未提交、推送或发布，未开始C4。
