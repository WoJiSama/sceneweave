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
