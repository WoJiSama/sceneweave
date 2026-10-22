# 发现

## C1d设计输入
- v3 CompleteProject读者严格检查顶层键；新历史身份必须有独立读写入口，不能将带额外元数据的工程交给旧IO。
- 原生v3 SceneDocument已表达本批所需完整几何/用户层；命名历史与lineage是工程级元数据。本批保留documentSchemaVersion=3，显式升级工程containerVersion=4，采用新profile和独立数据库。
- B4取消解码旧探针等待一次crop完成仍不足：对话框/忙碌提示导致视口尺寸再变，160ms后可重启预览。预览始终使用当前工程原Blob，ZIP导入产生不同Blob；按身份隔离真实导入的计数可直接覆盖目标生命周期而避免重绘干扰。
- 外观字段首批为definitionRef、appearance、visualBoundsMm、shadowClass、shadowOverride；位置/旋转单独一组。已有和历史对象均须无组合/散布/锚点注记恢复依赖。重建已删除对象显式使用完整实体、原层及现存合法支撑。
- 恢复保护会先进行异步flush/校验/落盘，生产UI采样须等工作台忙碌标志清空，再检查已保存和画布状态；仅看到旧“本地已保存”不能证明新采用已经结束。
- 最终C1d仅有功能/正确性、4K等价、秘密配对、离线和CAS证据；未运行历史资源峰值或全流程性能。25/26选择性能结论不自动推广到v4历史全流程。

- 起点 main / 62ba55b，本地 C1a/C1b 与路线改动尚未提交；版本 0.2.0-m1-c1b。
- 历史 C1b 四组框选底图绘制次数不变；单次最大 rAF 间隔 500 为 116.7ms，2000 为 283.4/350.1ms，不能作 p95。
- SceneLibrary 每次重建全部物件按钮，各行用 selectedIds.includes；全选时比较量接近平方。
- SelectionInspector 分别计算多种操作权限，每次 normalizeSelection 重建整图索引/绘制排序；锁提示逐实体扫描组及注记。
- 覆盖层在 useLayoutEffect 同步逐对象绘制，尚需与上述计算分开计时。
- C1c 既有设计：每个可编辑内容实体恰一层，组及成员同层；系统绘制带内排序，完整副本迁移，不改变高程/秘密。

- 性能优化前 production 构建已成功并保全于 work/selection-baseline-dist。测量工具代理只写 tools/performance；core代理只读准备，尚未开始C1c实现。
- 当前production base为 /sceneweave/，性能runner需兼容此前缀。

- 正常生产baseline study500三轮框选release→双rAF p95约45ms；study2000首轮213.7ms、替换495.9ms，长任务与排队明显。后续轮超时导致整个baseline非成功，已保留，不以完成四轮代替完整批次。
- 优化后27项定向单测与构建通过。下一步baseline独立CPU诊断再后测。

- 独立V8诊断样本767ms中program406ms、idle248ms；压缩JS热点无法凭此精确归因，保留cpuprofile仅诊断。列表补content-visibility跳过屏幕外行内部布局/绘制，DOM/键盘行保留。

- verified完整基线/第一轮后测均为12轮；500框选显示代理51/53→45/45ms，2000为193/186→128/120ms。2000多选改单选531/523→483/513ms，残余长任务未闭合。
- 全局styles.css button含 background/color/box-shadow 150ms过渡，选中样式同时变化2000行可能导致动画成本；需时间线/隔离验证。
- 新设计：完整文档不变；轻量选择会话独立订阅、列表仅可见行、属性按需、选择覆盖层分级；编辑预览按投影像素LOD，正式输出维持完整。
- 时间线隔离诊断（小样本、非正式成绩）：旧优化版control双rAF框选/改单选约160/144ms，隐藏列表约32/33ms，关闭按钮过渡约53/44ms。list/transition显示路径与残余成本强相关，待无trace确认。
- 用户共同属性改为展开后计算；摘要只读数量/类型/锁/AABB；超过256显示总范围与原子事务限额。精确命中/实际ID保持完整。
- 视口精细层使用独立crop canvas覆盖底图；每次全原投影校验与解码，取消迟到结果。不在selection依赖中重画底图或crop。

- C1c原生墙排序会影响miter所有权；必须按真实可见墙集合与层序算选择，而选择范围currentOnly只过滤候选，不能改变画面几何。点选/框选/控制轮廓/摘要均复用native墙多边形。
- 原生v3私密/资源/迁移/CAS矩阵已验证，默认迁移四组4K受众输出与v2零RGBA通道差异。空组GM注记和显式false/null来源等边界已修。
- 跨门异高连接仍受既有厚墙支撑和Room中心线范围合同限制，本次仅用合法B3连接作渲染/选择证据；Room分支是防御性隐藏闭包单测，不将不可构造夹具作为实际能力。
- 最终v3同四组720选择样本无LongTask，双rAF框选p95约32ms，与v2最终对照相近；DOM p95略增，未作函数级成本归因。全交互/资源峰值/跨浏览器仍开放。

## C2 起点
- main/2e14885 干净，C1与部署已提交推送；用户明确授权C2，按07的建筑绘制/共墙/门窗/量尺及结构恢复实施。
- 原生v3 SceneDocument已能保存房间/顶点/墙/门窗/注记；v3命令复用v2几何但缺创建建筑/开口入口，层归属需覆盖所有新增/拆分实体。
- 当前v4身份严格version1，仅对prop分配非复用出生token。结构恢复不能假装已有结构出生身份；设计必须明确复活/ID冲突边界及是否需要独立版本迁移。

- C2秘密房间遵循现有Region.kind=manualMask固定矩形合同；新增注记/遮罩命令使用现有字段，不新增场景schema。注记锚点递归锁与循环/悬空校验，删除被引用实体拒绝；玩家缺覆盖继续拒绝出图。
- 结构出生身份不在严格v4 identity v1中。本批结构恢复采用不可伪造会话连续性证明，命名/保护快照需在本次会话建立；重开/导入/拓扑变化后拒绝该恢复，不推断删除重建为同实体。后续持久恢复需显式版本迁移。

- C2全部Chrome132项在最终源码状态同批通过，避免沿用C1c/C1d的分批证明。正常产物双室验证r6→r7→r8→r9，所选历史包18位图/许可与邻室后改名保持；390px面板纵排且无横向溢出。
- 世界范围调整目前按全Floor锁及实体数+1保守计费，已有256实体可能拒绝扩大范围；该限制与仅同会话结构连续性都必须在28保留，不将有限恢复写成持久结构身份。

## C3设计起点
- C2源码31项及正常产物43项与docs28指纹一致，baseline main/2e14885，C2未提交。历史13/17–28及所有原证据不可覆写。
- 当前场景v3已有物件/材质/组合/层及有效外观字段；v4工程信封仅prop身份。C3需新工程信封/严格读者/来源闭包/组合身份，保留v3有效场景与native renderer。
- C3首版有限外观参数：tint（颜色或null）、brightness（0.25–2）、opacity（0–1）、shadowClass（仅物件）。逐项覆盖enabled，优先级固定源→当前层→实例/成员，非支持目标整笔诊断拒绝；更换外观不改物理/支撑/秘密。

### C3 implementation/verification findings — 2026-10-22
- Native strict v3 requires every image prop/template to have a fixed definition and every asset to have a scene/definition consumer. C3 therefore preserves non-active derived/ancestor images with immutable retained appearance definitions, not by deleting bytes or relaxing the native format. Actual Chrome originally reproduced UNUSED_ASSET after a second color version; the source-root fix resolved the real pixel/disable/remove tests.
- Strict v3 SurfaceStyle base.opacity stays 1. Props support opacity 0–1; styled surface scopes/layers with opacity below 1 reject atomically. Theme shadowClass does not override fixed source shadowOverride. These finite limits are now explicit in UI/contracts/report29.
- Room/wall paint restoration uses C2 session continuity evidence; no persistent room/wall birth identity was added. Terrain/path/edge/connection and scatter restore dependencies remain C4.
- A complete full-suite run passed 70 files/837 unit tests. A complete Chrome regression passed 145/145 (11.3m). After an App handoff callback fix, the final C3 cohort passed 14/14; source fingerprints before the narrow navigation fix are retained separately. No whole interaction performance inference is made.
- Final review identified that public prepared-import candidates must not serve as arbitrary in-place scene edits. Workspace ingress is being restricted to catalog/resource additions; command-prepared edits remain private and retain finite command/lock validation. A native V5 two-tab CAS check is being added, since old V4 Chrome evidence alone is not V5 evidence.
- All 666 protected historical reports/evidence match the C3-start hash. todo.md acquired unrelated edits during the task; the task never rewrites/restores that file and excludes it from this task's whitespace check rather than changing user content.

### C3 最终验证结论

- 上述实施中记录由最终结果补充：70文件839单元通过；全量Chrome145通过后，最终C3专项16项通过，含真实v5原生双标签revision与保护点metadata CAS。不同源码批次分别保留，旧v4证据不替代v5实测。
- 公开已准备候选入口已严格限为目录/资源追加；现存场景、身份、锁、私密和覆盖不能变化，旧资源/许可不能修改或移除。编辑命令经实际有限命令准备后走私有注册，没有公开可信标记可绕过。
- 正常生产页面没有开发API；空白→放置→调色/亮度→命名→再改色→单物件外观恢复→完整重开与下载均通过。实际派生像素、完整包hash/许可、GM/玩家4K及390px布局都有独立产物；完整报告29。
- 目前仅建立C3有限切片的适用证据。表面底材不透明、固定源自定义阴影优先、组合无嵌套/结构/散布、结构恢复会话连续性、256条原子预算继续有效；C4/C5与M2、完整视觉及全交互性能仍待后续。
