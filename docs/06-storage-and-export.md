# 本地存储、工程文件与地图导出

## 完整v1现行存储与转换合同（2026-10-24）

**新完整v1、sceneweave-projects及sceneweave-library已接入默认主会话，M2-4非空SVG源及算法2目录闭包已接通。** M2-0a至e历史结果保留于48至[51](51-m20e-library-conversion-validation.md)，f当时实际检查见[52](52-m20f-native-workspace-validation.md)。六旧库、旧catalog及原文件仅通过兼容边界只读保全转换，不自动迁移真实用户数据；旧整页编辑器退役。交接见[47](47-m20-unified-v1-handoff.md)，M2-1至4任务/场景/素材与服务私有存储见H节及[05](05-ai-and-generation.md)。现行回归结果集中在[05](05-ai-and-generation.md)与[09](09-quality-plan.md)；M2-5服务器容器已部署，公网443/受信任IP证书及Pages联合仍待，详05第15节，正式性能继续后置。不恢复已清理的work/evidence或生成新的原始验收大包。

### A. 工程容器及严格分发

扩展名仍为`.sceneweave`。新manifest精确字段：`format:'sceneweave-complete-project'/schemaVersion:1/application:'Sceneweave'/applicationVersion/packageMode/sceneId/revision/entries/assetRecords/licenseBindings`，packageMode仅`complete/history`。entries每条精确为`path/role/sha256/sizeBytes/mimeType`，不把旧containerVersion数字拿来识别新格式。

必需JSON为`scene.json/identity.json/appearance.json/sources.json`，分别对应04的新场景、完整身份、完整外观、authoringSources；M2-0初期sources为`{}`，M2-4已接收严格非空来源。manifest的assetRecords给出以hash为键的实际图片五字段描述，license正文由对应UTF-8文件提供；读者重建纯ProjectData，再与独立捕获字节组成ProjectBundle完整校验。

允许路径仅manifest及以上JSON、history.json、`snapshots/00`至`63`的`.scene/.identity/.appearance/.sources.json`、`assets/<sha256>.png|jpg|webp`、`sources/<sha256>.svg`、`licenses/<sha256>.txt`。角色/MIME/后缀必须匹配，重复/未知/目录/嵌套ZIP/路径穿越拒绝；目录和实际内容的CRC/长度/SHA及完整引用闭包逐项核对。M2-0当时拒绝非空SVG源；现行M2-4对每份原始/规范化源执行04的语法、安全、规范化、真实PNG比例及逐RGBA校验，缺SVG端口明确拒绝，不因已有hash而省略。

complete仅当前；history带history.json及明确选择的命名/保护快照（合计最多64），索引含当前/各快照的资源hash、许可hash/绑定、源hash及四份JSON路径。快照摘要使用ownerSceneId，历史document的sceneId/revision不暗改。资源按hash去重，但各受众/历史的引用与许可不能混同。imported-auto和本地legacy原件不默认塞进普通便携包；完整转换保全用下一节的独立set。

c将索引精确落实为`{schemaVersion:1,current,snapshots}`。current引用字段为`scenePath/identityPath/appearancePath/sourcesPath/assetHashes/licenseHashes/sourceHashes/licenseBindings`；snapshots每条含相同引用字段及04的`summary`。当前路径固定四份根JSON，快照按显式顺序使用00至63；三类hash列表按UTF-16键序唯一排列。manifest.assetRecords为全包联合图片描述，manifest.licenseBindings须与当前引用一致；各快照仅取得自己声明且完整闭合的资源/许可。多余JSON、未引用图片/许可或来源均拒绝。

entry.role与根四JSON分别为`scene/identity/appearance/sources`，历史索引为`history`，快照为`snapshot-scene/snapshot-identity/snapshot-appearance/snapshot-sources`，图片/许可/源文件为`asset/license/source`；JSON用application/json，许可用text/plain，SVG源用image/svg+xml，图片使用对应实际MIME。sourceHashes必须精确列出原始/规范化源的真实hash，不能用assetId代替；当前与每份快照各自限定可读闭包，缺失、多余或跨范围源拒绝。新`importProject`与`importHistoryArchive`互相拒绝另一packageMode；全部六代旧工程读者也拒绝新标识，不降级试读。

已实施保护值：压缩100MiB、展开300MiB、manifest/history索引各1MiB、单scene/identity/appearance JSON20MiB、许可256KiB、ZIP3000条、JSON深128/累计600000值；历史四份JSON累计128MiB，包含sources。单图20MiB、边8192、单图3200万像素、256张/累计6400万像素。sources JSON至多1MiB、来源记录256项、原始/规范化源至多512个不同hash，单SVG源1MiB/实际源总32MiB且计入累计资源/展开预算；当前及所选历史的联合资源分别核对图片和源上限。新metadata引起超限也必须预检明确拒绝，不静默丢数据。这些是保护值，非实测容量。

### B. 一个主工程仓库与独立个人库

新主工程库名固定`sceneweave-projects`，个人库名固定`sceneweave-library`，Dexie schema均从1开始（native IDB version 10）；不得写入旧库或升级旧库schema。发现旧库用精确表/键/索引检查，不存在的库不自动创建。新库未知版本/外来schema拒绝。

| 新主工程表 | 主键 | 职责 |
|---|---|---|
| projects | sceneId | 当前纯ProjectData、revision/savedAt/contentHash、status及conversionJobId；status仅preparing/ready，最近工程只列ready；普通新建/导入的conversionJobId为null，转换目标必指向journal |
| automaticSnapshots | [ownerSceneId,revision] | 新主工程最近20次成功保存，含当前；绑定完整资源 |
| snapshots | [ownerSceneId,id] | named/protection，两种各最多32；同owner跨kind的id唯一 |
| importedSnapshots | [ownerSceneId,id] | 只读imported-auto，单来源v6家族最多20；不进入自动淘汰或占命名额度 |
| resources / licenseTexts | sha256 | 实际图片/源字节及许可正文，hash去重；语义/引用由绑定与描述决定 |
| resourceBindings | [ownerSceneId,kind,recordId] | kind为current/automatic/named/protection/imported-auto，关联asset/source/license hash与许可绑定；current的recordId固定current，automatic为revision十进制，其余为快照id |
| historyMetadata | ownerSceneId | 单调metadataVersion，与命名/保护/来源快照CAS同事务比较 |
| legacyBlobs / legacySources | sha256 / [ownerSceneId,nodeId] | 旧原件实际字节与来源节点；节点保留原sourceSchemaVersion/sceneId/revision/hash/migratorVersion/migratedAt/前序关系，不再递归嵌成第七代信封 |
| conversionJobs | jobId，jobKey唯一 | 固定源指纹、转换器/目标format、目标ID与快照映射、备份receipt、状态及单调jobVersion；不是可编辑业务字段 |

ownerSceneId/相关kind/id、savedAt/status、jobKey按实际查询设索引，唯一约束在写入器前落实为上述键及jobKey；不允许旁路表重复存一份可独立编辑场景。新主保存不依赖旧仓库。legacyBlobs只保留已有确切原件/输入文件；从IDB重新序列化的全家族保全包在独立set中，不冒充先前磁盘原文件，也不自动额外复制整包进原件表。

累计保护值按**整个新工程库**计算：resources/许可256MiB，全部当前/自动/命名/保护/imported-auto文档128MiB，legacy原件128MiB；SVG源计入资源，不另开逃逸额度。六库合并可能超过旧单库上限，须提前显示范围/字节并拒绝超限转换，保留完整备份和旧库。65,536出生/墓碑、65,536外观源、源深16、每目标64调整、4096变体和单采用256展开保持。不能把备份分卷当作扩大主库/工程容量。

### C. 专用迁移保全set

新增文件集合格式`sceneweave-migration-set/schemaVersion:1`，主索引扩展名`.sceneweave-migration.json`，这是转换/取回工具的输入，不是第七套可编辑工程。一次scope为一个旧工程家族，或一个完整旧个人库；不伪称全站同一时刻快照。

索引精确字段为`format/schemaVersion/setId/createdAt/converterVersion/scope/sourceFingerprint/volumes/records/complete`。scope精确为`kind:'project-family'|'catalog'/repository/sourceSceneId`（目录的sourceSceneId为null）；volumes为`path/sizeBytes/sha256`；records为`role/recordKey/sourceFormat/contentHash/rawSha256/parts`，parts为`volume/entry/offset/length`，明确重组字节的完整覆盖，无洞/重叠/重复。role仅`current/automatic/named/protection/resource/license/resource-binding/history-metadata/legacy-source/legacy-blob/catalog-entry/catalog-organization/catalog-metadata`，不执行任意内容。

每卷为ZIP，文件名限`part-0000.sceneweave-migration-part`至`part-0511.sceneweave-migration-part`，仅含volume.json及`chunks/<sha256>.bin`。volume.json精确为`format:'sceneweave-migration-volume'/schemaVersion:1/setId/index/entries`，entries每条为`path/sha256/sizeBytes`；清单至多1MiB，每卷至多3000条，实际CRC/长度/hash及setId/index逐项核对。每卷展开负载含清单不超过32MiB，单块8MiB；大原件按确切字节分块，重组后再验原始总hash。主索引最多16MiB/512卷，JSON深128/累计600000值；解析前先检查声明总量。parts中的offset是重组记录内的字节偏移，length须等于对应完整chunk字节数。卷名/entry不接受外部URL、任意本地路径或嵌套ZIP。缺任一卷、坏hash、超限/不可读记录都不能complete。文件数量是保护值，不是存储能力承诺。

工程scope包含捕获时的当前、全部现存自动/命名/保护、相应资源/许可/绑定、historyMetadata和完整旧来源链。目录scope包含所有安装载体、全部organization记录（包括未安装或内容暂不可解析者）、metadata revision、确切安装状态。存储字节仅按rawSha256去重，contentHash只用于语义指纹；内容等价但原ZIP字节不同也分别保全，不丢角色/时间/来源对应。旧文件输入保留原始bytes；IDB行保留独立捕获的精确字段值及Blob bytes，规范序列化只用于保全/指纹，不声称原JSON排版。

普通history导出不含自动/原件，旧库所选备份最多64安装项，不足以替代此set。转换前必须重新读取本scope完整索引/全部卷核验，取得绑定setId/sourceFingerprint/hash的backupReceipt；“已开始下载”或用户点过保存按钮不等于取回验证。取消/损坏留在旧库原状；无法完整保全的输入隔离并明确失败，不跳过后称全部成功。

M2-0d将工程scope.repository明确为v1至v6，对应六个原生仓库；确切文件输入使用file-v1至file-v6，唯一current记录直接保存上传ZIP原bytes，重读时重新走对应严格读者。IDB行编码保留字段值及Blob MIME/bytes，单行512MiB、行元数据16MiB保护值不提高目标库预算。每卷压缩字节另限33MiB。导出器不产生receipt，只有完整索引/全部卷重新读取、核验及重组后登记的私有凭证可推进转换；复制JSON不能获得凭证。

### D. 指纹、幂等和两阶段开放

每旧库一个只读事务捕获scope的全部记录；事务结束再做hash/解码。sourceFingerprint覆盖repository/原sceneId、当前revision/contentHash、metadataVersion、全部历史键/内容摘要、资源/许可/原件摘要；目录含全局revision、条目和organization-only精确值。旧无contentHash的记录按规范捕获值计算，不能只看当前revision。

jobKey为规范JSON的SHA256，字段固定`sourceRepository/scopeId/sourceFingerprint/converterVersion/targetFormat`，converterVersion初版`m20-converter-1`。首次以目标短事务按唯一jobKey添加预留journal，固定jobId、新sceneId及快照id映射，状态captured、jobVersion0；之后每次状态推进比较并递增jobVersion。重复请求复用已预留映射，不凭名称或旧sceneId跨库合并。新转换器发现旧映射也不能覆盖已编辑目标，需明确另建副本或重算。

状态：captured→backup-verified→prepared→committed→verified；failed/cancelled明确停止。prepared先完整校验候选/全部历史/固定内容/资源/许可和目标累计预算，source库始终只读。一个目标事务以add/唯一键写入所有内容、引用、历史及来源索引，同时CAS更新已存在的prepared journal为committed，projects先标preparing；不是再次add journal。事务失败不留半份工程，预留journal可记录失败供重试。

冷读通过完整校验后，第二个目标短事务比较job/目标revision0、metadataVersion及contentHash，原子置ready/verified，之后才列入首页或切换会话。commit后断线/崩溃，重试找到同一journal并继续冷读，不新建第二份。verified之后已有手改时返回当前目标/已有映射，绝不重新覆盖或要求恢复到revision0；坏目标明确失败，不以原候选静默修复。

发布前后复查源指纹；源变化只说明独立副本来自旧捕获，要重新捕获或明确补迁，旧新成果均保留。跨源/目标库没有原子CAS，也不通过后台继续扫描去修改已开放工程。正常保存仍比较expectedRevision且新revision严格更大；快照/保护恢复还比较metadataVersion和真实源ID/hash，采用只一次新事务。

应用层beginProjectConversion/beginProjectFileConversion仅捕获、预留和导出；continueProjectConversion接收重新提供的set，重算真实来源指纹/历史键/hash后推进阶段，cancelProjectConversion停止同一journal。源库默认必须保持捕获状态；明确sourcePolicy=captured-copy才允许把已保全内容作为独立副本继续，原源及后续编辑始终保留。固定文件来源不扫描旧库。f已接入首页和文件选择/保全转换UI，实际重新下载/选择/核验、取消重试及原件取回归52；d当时的模块接口结果仍独立保留，不表示已转换真实用户数据。

### E. 历史映射与旧来源

首批v6家族中current只重置为新sceneId/revision0；历史四部分JSON转新schema，源时间/sceneId/revision保留，由ownerSceneId关联新当前。lineage/root及已有token不重造，合入同家族墓碑，冲突拒绝；快照ID按repository/源owner/kind/源id固定映射，自动用源revision定位。同名不合并，原始与新内容hash分别记录。v6/file-v6的全部预留历史必须到齐，来源kind和自动revision必须匹配；旧自动转换为只读imported-auto，名称固定为`自动保存 · r<源revision>`。当前＋64命名/保护＋20来源自动的完整资源验证批次最多85份，普通便携history仍最多64份。

v1–v5当前转换为新完整v1；其全部旧历史在set及旧库保全，首批不作为新当前可局部恢复快照。之后可读取明确旧档案另建独立工程，不能把按当前新分配的token套给旧历史。v6只保留既有恢复范围，建筑witness失效、拓扑不连续继续拒绝。任何旧库删除或源档案回收仍是后续明确操作，不属于此次转换或入口退役。

### F. 个人库、载体与新备份

新sceneweave-library表为entries（key主键、logicalKey唯一索引）、organizations（key）、metadata（id固定catalog，revision）、conversionJobs（jobId/jobKey唯一，含jobVersion）及conversionStaging（主键[jobId,kind,key]，kind仅entry/organization，保存拟发布的完整行）。普通读者只读entries/organizations，staging不出现在搜索、备份或已安装状态；已有可用内容始终可读。仍512安装项/2048组织项、普通变更单批64、标签32×40码点、人工12色最多8、单载体32MiB/库总128MiB、工程采用256展开。staging实际字节也计入库总预算，不另开容量。native capsule使用完整v1中性工程，精确重抽根闭包核对；无SVG旧内容只改载体和byte hash、不改算法1内容key。新增非空SVG内容使用04定义的算法2，身份覆盖所选原始/规范化源元数据；实际源字节、PNG、祖先源与许可随载体完整校验并在安装、采用和所选备份中保留，不能忽略源后降成算法1。

保留所选根全部固定定义/祖先、变体输入输出、必要SVG原始/规范化源、非活动保全根与私密组合模板，不带场景实例/层覆盖/秘密注记/历史/旧原件。新中性场景固定ID与时间，不能只检查props为空就接受任意合法工程；所选闭包不能捎带邻近对象的SVG源。个人整理的原显示文本和顺序、颜色顺序、favorite与是否安装原样保持；内容暂不可解析的organization-only仍保留旧key，不自动安装或猜测重绑。

新普通所选库备份仍使用`.sceneweave-library`扩展名，但format改为`sceneweave-asset-library`、schemaVersion1。顶层精确字段为`format/schemaVersion/capsuleFormat/records/organizations`；capsuleFormat为`sceneweave-complete-project@1`；records各为`item/capsuleBase64/capsuleSha256`，organizations为明确选入key到tags/colors/favorite的映射，可含未安装key。原单文件64MiB/载体47MiB/最多64安装项及单载体限额保持；这是所选内容/整理备份，全库保全仍用set，不能混称全库。

旧format sceneweave-library/schemaVersion1只通过legacy读者接收其v6载体；不能在同一旧严格合同内偷换载体。目录转换复用D的指纹/预留journal/状态与备份receipt：首个提交只原子添加staging并CAS journal为committed；冷读完整核验后，发布事务比较目标catalog revision和jobVersion，再一次写入正式条目/组织、递增revision、清除该job的staging并置verified。冷读失败、目标冲突或取消均不改变现有已安装内容/整理；不能分批写入公开表后宣称全库原子。

迁移发布是专用有界全库事务，最多512安装项/2048组织项，先预检合并后总量；不受普通变更64项限制，也不改变工程256展开限制。没有与工程仓库的跨库事务。相同精确内容幂等复用，逻辑键不同内容始终冲突；组织冲突明确保留本机或替换所选，范围外保持。重试仍用既有job和固定映射，已verified后不覆盖后来的个人编辑。

e的旧目录scope.repository为实际sceneweave-catalog-v1，sourceSceneId为null；catalog-metadata唯一记录保存全部原元数据行的`{rows:[{key,value}]}`，空库rows为空，不虚构revision。旧所选文件使用file-catalog-v1、唯一catalog-metadata记录保存确切原JSONbytes，不能称全库。合法精确key的坏载体/整理可先完整保全再明确拒绝转换；非法主键会在begin预留阶段明确失败，仍可通过底层capture＋set导出取回，不静默略过。

应用层beginLibraryConversion/beginLibraryFileConversion、continueLibraryConversion/cancelLibraryConversion复用全set重读及源指纹策略；冲突策略明确keep-local/replace-selected，准备后取消、失败或目标冲突重试仍保留原策略。发布前完整冷读暂存及实际复用的既有载体，事务内再核对字节摘要、完整键集合、目标revision及jobVersion；失败不拿有效新候选遮蔽坏的已安装载体。普通列表只读公开metadata/hash，load及转换仍完整核验。实际65安装＋2048整理一次发布已测，512是保护/预留边界，非容量实测。

主工程/目录继续浏览器本地。SQLite任务、对话和事件属于M2-1服务存储，不进入以上工程/目录/保全合同；M2-0不提前建立后端或调用模型。d/e模块结果归50/51，f主会话混合操作、备份、实际样板双受众4K与旧入口收敛的必要检查归52，不从文档准备或旧44结果推定新路径通过。

### G. 原生会话、便携安装与原件取回（M2-0f）

主会话直接持有完整v1元数据和不可变字节端口，保存只进入新主库；公开保存、冷读取、导入/导出、派生像素和渲染均完整验证。普通新建与另存副本保存完整内容及资源，当前和最近20个成功自动版本同事务绑定，CAS比较实际持久revision；撤销/重做仍递增revision。个人库写入使用独立catalog revision，不进入工程undo或玩家输出。

2026-10-24加载修复只复用已通过完整验证的内部交接结果：新主库load/loadNamedSnapshot先完整冷验，应用随后凭确切不可变元数据/字节证明建立编辑包装，避免再次全验同一结果；伪造/克隆或换端口无此资格。样板准备的4路字节读取仍受原资源预算和完整校验约束；失败/取消不生成可采用半套工程，当前内容及撤销保持。准备提示和按需目录不改变存档格式或新建预装内容，实测及限制见[34](34-performance-followup.md#2026-10-24原生完整v1样板加载修复)。

新便携当前/所选历史包导入在隔离候选完整验证后，一次创建新owner及revision0；命名/保护摘要重新绑定owner并分配独立快照ID，历史document的原sceneId/revision、lineage/root和token不改写。当前、自动版本、所选历史、实际资源/许可及绑定在新主库同一事务写入，预算/取消/冲突失败整体回滚。安装后最终字节捕获与激活前再次检查当前会话checkpoint，迟到结果不替换后续编辑；已保存的独立导入成果保留。

局部恢复继续先保存当前和保护点，再重新核来源快照ID/hash、当前revision、metadataVersion与会话checkpoint，一次采用保留范围外修改。C2 witness不持久化，回首页/继续及被动flush保持，真实重开/导入/另存副本/切工程清空；室外出生/拓扑连续性与现有有限组合/散布恢复范围不扩大。imported-auto在新界面只读，不改名、删除或进入普通便携历史勾选。

新界面可按本地owner列举已保留的legacy来源节点，核对节点/前序/来源hash与实际原字节后由GM明确下载；JSON原记录与旧ZIP分别以对应文件类型取回，不重序列化冒充原件。普通完整/历史包仍不默认携带本地旧原件，原件与完整保全set边界不变。另存副本不删除原来源owner/旧库或先前保全文件，不宣称普通副本已经携带全部旧档案。

以下旧格式段保留各批实现语义和历史证据；内容续批及重构前自动化结果见[43](43-content-m1d-validation.md)、[44](44-full-regression-validation.md)，现行新v1文件读写以上节及52为准。M1-D首批混合素材/SCN-04、房间材质/整墙平移与单位显示的当时范围见[35](35-m1d-outpost-validation.md)；C4严格v6/identity3、有效v3及appearance1语义由新完整v1承接。C5联合功能历史见[32](32-m1c-c5-validation.md)，资源复用见[33](33-c5-resource-reuse-validation.md)。余下性能按[34](34-performance-followup.md)暂缓，C5及完整性能验收仍未通过；人工P3/完整SCN、小团、持久建筑/任意拓扑恢复及线上HTTPS仍待。

### H. M2-1至4服务私有任务与SVG制品

本地任务服务已使用独立SQLite和私有制品目录，默认根为被忽略的`local-data/ai`，不进入以上浏览器工程/目录/转换库。任务私有对话、幂等请求及有序事件/checkpoint同事务保存；完整assistant调用和本轮工具结果/receipt整体提交。单实例SQLite独占锁在恢复前取得；重启保全running为paused/unknown，未知付费请求不自动重发。落故障状态也失败时停止执行并对任务API返回503，避免假运行。

任务按创建起7日保留，可鉴权后主动删除；数量、累计运行、任务/全服务实际磁盘和事件限额以[05第11节](05-ai-and-generation.md#11-m2-1连接与任务协议2026-10-24实施合同)为准。SQLite采用DELETE journal、secure_delete与零journal保留，私有目录0700/DB0600；删除/过期仅清服务私有数据，不操作主工程、素材或历史资源。M2-4私有制品已持久化原始SVG、规范化SVG和处理器/hash记录，以任务UUID与源hash固定路径、暂存后rename发布；拒绝符号链接，每次读取重验规范化和hash，不返回公开URL或服务器路径。制品计入同一任务磁盘与清理边界，实际PNG由浏览器本机物化后进入完整工程。应用访问凭据仅前端内存，provider key仅后端环境；普通工程包不携带任务对话或凭据。

M2-2建立的任务授权元数据、成功步骤账本和采用回执已支持M2-3场景步骤与M2-4SVG/样式配方，服务不持有主工程图片闭包或历史快照。`waiting_browser/ready`停止执行时钟；30秒`applying`租约排斥取消/删除，到期或重启保留未解决claim并暂停。本机重放后生成SVG/PNG与固定来源，完整校验实际字节/像素/许可；最终保存与revision、metadata版本、保护ID/hash在同一IndexedDB写事务校对，失败保留新内存/撤销和旧持久分支。对话及步骤仍不进入普通工程包，下载物化草稿走完整工程IO并可导入独立副本；保存重开和所选历史/有限外观恢复不依赖再次调用模型。详细合同见[05](05-ai-and-generation.md)。

### I. M2-5服务器容器与公网联合边界

服务器独立容器已真实构建运行，非root/node、只读根、私有持久卷及内部健康检查通过；应用/provider凭据分离，Pages仅构建静态前端。经SSH访问的单次真实模型流、断线回读与幂等1请求，以及重启检查点、取消、备份还原和合成7日清理检查通过，实际过程与边界见[05第15节](05-ai-and-generation.md)。公网TCP443仍云安全组超时，受信任IP证书尚未签发成功，Pages后端URL变量未设置；公网鉴权/精确Origin、SSE重连与创作→采用→本机保存→导出旅程仍待HTTPS下联合验证，不能宣称完整M2-5或公网上线。

本文件规定保存成功的含义、导入失败的行为与玩家输出边界。字段以[场景文档](04-scene-document.md)为准，案例以[固定场景](08-test-scenarios.md)为准。

2026-10-23完成37准备后，用户明确授权U1a。统一发现/打开与连续会话已实现，验证归38，原六仓库、严格v6及备份格式保持；U1b布局与本机偏好已实现（简单检查归39），U2独立个人目录仍待后续，U2a须先冻结精确目录/备份/并发合同。

B1实现位于src/io/v2与src/editor/v2：严格完整包往返、实际资源hash/静态编码/尺寸与受控解码校验、许可闭包、独立sceneweave-m1数据库、同事务CAS、最近20个成功快照，以及保留原始v1来源的迁移。B2在 `render/v2` 新增共用受众投影/PNG管线，工作台提供主持人/玩家切换和4K下载；VIS-01固定14000×10000mm输出4096×2926像素。外部素材有受保护规范化API，完整素材管理UI和资源极限/真实配额能力仍待验证。B2实际证据见[18](18-m1b-b2-validation.md)。

B2玩家输出沿用本章保守固定矩形遮罩语义：隐藏物件也需遮罩覆盖视觉边界与阴影外扩，覆盖不足拒绝。普通VIS-01不含私密几何；V1-S01另建固定遮罩配对副本。先过滤，再采样公开材质/生成墙角与阴影；PNG重新编码，不嵌入场景、来源或秘密文字，下载名固定 `sceneweave-player-map.png` / `sceneweave-gm-map.png`。B3已加入非零地形、边缘、台阶/坡道、材质覆盖/柔化和材质着色；道路与物件着色仍停止不完整出图，完整工程可备份。VIS-02固定30000×27000mm输出4096×3686像素。私密地形在公共支撑/边缘派生前过滤；遮罩要覆盖崖面、边带、柔化及阴影外扩，实际配对见[19](19-m1b-b3-validation.md)。每次绘制校验所需实际图片字节并关闭解码资源；不将文件缺失当作删图成功。

v2预览与PNG实际使用原生Canvas2D，M0几何工坊使用Konva。B5以真实工程复用当前资源校验、Workspace、样板候选守卫与仓库，分别观测支持操作的加载、编辑、保存和导出；正常构建不暴露专用性能API。专用生产入口与完整工作台UI验证分开，方法与结果归21。

C0只为本机模块拥有、严格验证后深冻结的文档身份复用输入领域校验；外部可变文档、自行冻结对象、数据库读取或工程导入的新对象仍完整验证。该认证不代表实际资源字节、许可或存档CAS已经通过，仓库save、导入、备份和PNG的既有边界继续保留。每次render仍验证该受众需要的实际位图字节，经IO/renderer共用的原生解码单槽处理，随后关闭解码资源；单槽只覆盖同一页面模块实例，不是跨标签或整机限额。没有新增持久ImageBitmap缓存或重新启用同尺寸paintCanvas重用。

C5的v6三元内容证书同样只驻留当前模块。捕获工程时可保留这三个确切不可变JSON对象，文档证书本身不认证资源或迁移原件。普通立即编辑减少中间预览的重复整工程校验，候选物化后仍通过当前依赖、许可与预算检查再同步采用；显式预览采用、保护点与命名保存、仓库CAS、导入/导出保留各自边界。完成时间仅供会话性能观测，不能进入任何完整包、存档、快照或迁移原件。该批历史联合证据和性能状态见[32](32-m1c-c5-validation.md)。

后续资源复用由独立内部入口认证确切的`assets/licenses/licenseBindings`三元对象。未知输入在首个await前按data描述符独立捕获，拒绝隐藏字段、symbol、访问器、自定义原型与循环；Blob通过原生structuredClone隔离并冻结。完整字节、CRC、SHA、原生解码、许可文本及闭包验证成功且未取消后才登记模块私有凭证。不变自有三元闭包的内部候选可省去重复字节/hash/解码，当前文档、资源元数据、许可主体/允许嵌入和累计预算仍逐次检查。任一容器或记录替换均重新完整捕获、验证，新增派生资源/许可绑定先复制三个容器。v6迁移原件另以独立深冻结的完整来源链和目标sceneId绑定；换原件、链节点、元数据或目标需全量SHA/旧格式导入及祖先检查。失败/取消不返回可用凭证。派生真实像素继续逐次验证；公开validate、冷载入、存储save、导入/导出和渲染的实际资源校验未改，也没有长期Bitmap缓存。实现与独立诊断归[33](33-c5-resource-reuse-validation.md)。

C0预览由长边1200像素的底图和透明选框组成，25%–800%的CSS视口倍率相对于适应全图。选择、平移、缩放和适应全图不改变文档、资源绑定、历史或保存队列；PNG从捕获的完整revision独立生成，不截取屏幕视口。工程/受众切换时两层同步隐藏，并取消和失效旧绘制token，玩家预览不能短暂显示旧GM底图或选框。C0实现与正式验证分开记录于22，完整M1及SCN-04仍按原门槛验收。

## C1a 空白完整工程的创建与保存（已实现）

新建入口保存名称、画布范围和调查/战术/叙事通用预设；具体初始值与保护范围以04为准。`createBlankProjectV2`直接构造空白严格v2文档，采用现有B2/B3的18个固定单件定义，只读取对应18张PNG及许可，不加载样板材质、几何或散布内容。定义和AssetRef属于文档，实际字节和许可属于完整工程资源；即使尚未放置物件，这些已采用目录定义也是继续编辑所需的依赖根，不能作为“未使用资源”丢弃。

完整工程在采用前检查实际PNG字节、CRC/hash、格式/尺寸、真实解码及许可/引用闭包。创建准备期间可取消，资源缺失、损坏、解码或许可失败不会切换当前工程；工作区checkpoint阻止迟到结果覆盖期间的新编辑。进入保存阶段后等待完整新记录保存完成，先处理当前分支保存，再以无现有记录的CAS期望值写入新sceneId、revision=0与全部资源绑定，成功后才切换。失败保留原分支和可重试入口，不采用半套空白工程。

单件放置、位置/旋转和删除继续通过Workspace产生单一原子修订并排队保存；未采用的放置预览、鼠标移动和取消不入档。删除实例后目录定义、对应位图和许可继续保留，组合/散布关系的删除语义归04。新建与编辑均沿用 `sceneweave-m1` 的现有数据库结构、schemaVersion=2、containerVersion=2和 `m1-assets/complete`，本批没有新增持久字段、历史类型或迁移版本。

保存重开与 `.sceneweave` 完整包继续携带实际资源和许可；离线重开不依赖再次从内置目录下载位图。首次新建仍需获得应用随附的静态资源，未据此实现PWA断网冷启动。主持人/玩家PNG沿用固定exportBoundsMm、受众投影和遮罩校验，支撑选择的受众语义以04为准；新放私密物件仍须满足既有遮罩覆盖规则。创建、继续编辑与离线往返的实际证据统一见[23](23-m1c-c1a-validation.md)，不扩写13及17–22的历史结果。

## C1c v3 完整副本与独立仓库（2026-10-21 冻结；实现验证单独记录）

用户图层采用 `schemaVersion=3` / `containerVersion=3` / `documentSchemaVersion=3` / `profile=m1-layers` / `packageMode=complete`。v3包与v2并列严格读写，资源、许可、ZIP条目/CRC/hash、有界JSON与每次真实解码预算沿用现有限额，不把v3伪装成v2交给旧读者。旧读者拒绝未知版本。新仓库为独立 `sceneweave-m1-layers`（IndexedDB结构版本1），不升级、清空或改写M0和 `sceneweave-m1` 的工程与自动历史。

启用用户图层从捕获的完整v2工程建立新sceneId、revision=0的v3副本，每个Floor有默认层，完整几何/定义/实际位图/许可随迁移保留。先保全当前分支，再验证新副本与资源，CAS创建成功后才切换。准备可取消；失败、配额故障、CAS冲突或准备期间checkpoint变化都保留当前工程。不会将视口、选区或编辑眼睛状态作为工程内容。

本地迁移记录保存来源schema=2、sceneId、revision、完整原包SHA-256、迁移器版本/时间及原始完整包Blob；从文件迁移保存所导入的确切字节，从当前工作区迁移保存捕获修订的完整v2包。验证原包的实际文档与资源身份，不能只比较ID和revision。若来源v2自身保有v1迁移原件，另保留该来源记录，避免迁移链丢失。普通v3完整离线包携带继续编辑所需文档与资源，不额外捎带本地迁移原件和旧自动历史；迁移原件由本地独立下载入口保全。

v3沿用同事务CAS、串行保存、单调revision、最近20份成功自动快照及失败另存副本。组织、归属、顺序与锁受完整事务/撤销约束；隐藏/独显、当前层与选择范围重开重置，正式玩家/主持人PNG忽略这些会话状态。v3原仓库不增加命名历史；C1d通过下述独立v4完整副本提供命名快照和局部恢复。C1c实现及运行证据见26，不覆写17–24历史。

## M0 当前支持配置

M0 使用单层完整几何文档与原创程序符号，拒绝外部素材引用。IndexedDB 同事务 CAS、串行保存、最近 20 次成功保存的快照、冲突保留与另存副本已有实现；首轮 Chrome、往返、模拟故障与冲突证据见[M0 验证报告](13-m0-validation.md)。本节保留 M0 配置边界；B1 的新增实现另见开头及17，真实存储配额耗尽与其他浏览器仍未验证。

| 项目 | M0 实际边界 |
|---|---|
| 工程类型 | ZIP，containerVersion=1、documentSchemaVersion=1、profile=m0-geometry |
| ZIP 条目 | 恰好 manifest.json、scene.json 两项；不接受额外文件、assets、licenses 或嵌套归档 |
| 压缩与展开预算 | 整包压缩至多 5 MiB；scene.json 展开至多 10 MiB；manifest.json 至多 64 KiB |
| JSON | 有效 UTF-8；解码后的重复字段拒绝；最多 128 层、300000 个值；未知必需语义与字段拒绝 |
| 素材 | assets 必须为空；所有 Prop.assetId=null，使用必填 symbol |
| PNG | API 长边 256–4096 整数像素、至多 16777216 像素；UI 提供 2K/4K，固定文档 exportBoundsMm |
| 遮罩 | 玩家投影仅接受主持人预设的整块轴对齐矩形；覆盖不足则拒绝玩家预览与导出 |

读取先检查 ZIP 目录、本地记录、路径、版本、条目数量与声明预算，再按有界块解压并核对实际展开量、CRC 与 scene.json 的 SHA-256/大小。几何或版本损坏不进入当前文档。导入始终生成新 sceneId 和 revision=0，预览确认后先成功保存新场景，再切换编辑器；期间当前修订变化则保留当前编辑。

M0 界面不提供任意遮罩绘制、素材缺失重关联、原场景覆盖导入或资产清理。B1 在独立素材工坊新增 v1 副本迁移和 v2 完整工程入口，沿用后文 M1-A 规范；不改写本节 M0 的文件或数据库配置，也不据此授予完整 M1 容量或导出能力。

## 保存的三个层次

| 层次 | 用途 | 是否可交给玩家 |
|---|---|---|
| 当前内存文档 | 实时编辑、撤销历史、正在排队的未保存状态 | 否 |
| IndexedDB 完整快照，v2 含资源绑定 | 自动保存、重开恢复、有限历史恢复 | 否 |
| .sceneweave 工程文件 | 主持人备份、跨浏览器迁移、继续编辑 | 否，包含主持人秘密 |

玩家 PNG 是经过投影和重新编码的展示结果，不能当作可编辑工程。文件输出可以存在多个用途，但界面必须明确 GM、玩家和主持人工程三个选项。

## 自动保存协议

编辑事务成功后，内存文档 revision 增加，UI 进入“未保存”。保存协调器在一次手势/批次结束后排队，可以合并尚未开始写入的中间版本；单场景只能串行写入。不得让早启动、晚结束的旧保存覆盖新保存。

每个标签保留 expectedPersistedRevision，即自己最后确认读取/写入的持久化版本。写入必须在同一个 IndexedDB 事务里读取当前记录并比较：相等才写入完整新文档、必要资产和历史元数据，再更新 persistedRevision；不相等则整体终止。比较不能只靠 BroadcastChannel 通知或内存变量。未写过的场景使用显式“无记录”期望值。

revision 与 persistedRevision 可以相隔多个值，因为保存可能合并中间编辑。保存重试不增加 revision，用户新编辑才增加。只有事务完成才把对应版本标为已保存；如果写入完成时内存已有更新版本，仍显示待保存。

C0在内存历史中共享已认证、深冻结的场景内容，只为提交/撤销/重做创建新文档头并严格检查revision/updatedAt；它不改变上述expectedPersistedRevision、同事务CAS和串行保存语义。取消、无变化、失败以及视口手势都不产生额外文档修订。冻结认证是运行时身份，不能随JSON或IndexedDB克隆传递为免检凭据。

| 状态 | 用户可见含义 | 行为 |
|---|---|---|
| 未保存 | 内存包含比持久化更新的内容 | 排队保存；手工导出仍可用 |
| 保存中 | 某个完整版本正在写入 | 新编辑排队，不能覆盖在途版本的基线 |
| 已保存 | 当前内存版本与持久化版本一致 | 显示保存状态与当前修订 |
| 保存失败 | 配额、事务或浏览器存储失败 | 保留内存；提供重试和工程导出；不清空旧存档 |
| 外部更新冲突 | 同一场景已被其他标签保存 | 暂停此标签的自动写入；保留双方版本 |

遇到跨标签冲突，用户可将当前内存另存为新 sceneId，或明确放弃本地分支并载入最新版本。重新载入先提示未保存内容并允许导出；不提供静默“最后写入获胜”。BroadcastChannel 可提前提示其他标签已编辑，但 CAS 是最终门槛。

## 恢复和配额

M0和v2/v3仓库均保留最近20个成功保存的完整文档快照；素材仓库同时保有该修订的资源绑定。这些版本的历史恢复生成新sceneId，避免旧revision写回原场景；恢复前必须成功保存当前分支，保存失败或冲突时先另存当前副本。直接另存当前内存分支可用于冲突救援；若等待过程中又有新编辑，不切换掉当前文档。资源快照通过hash复用Blob；命名/保护快照与当前工程局部恢复由C1d独立v4仓库实现。

初版不自动删除还可能被当前文档、其他场景或历史快照引用的资产。清理必须计算全引用关系并展示可回收项。存储不足时优先提示导出备份和主动清理，不能以删除旧数据掩盖失败。

浏览器持久存储授权可作为优化请求，但用户拒绝不阻断编辑。浏览器清理、隐私模式和系统回收意味着 IndexedDB 不是唯一备份，界面提供清楚的工程导出入口。页面关闭前的提示是辅助措施，不依赖 unload 阶段完成关键写入。

### C1d命名快照、局部恢复与保留策略（已实现，验证见27）

#### 已冻结的C1d实施合同（2026-10-22）

完整工程采用严格新信封`CompleteProjectV4`，包含完整严格v3文档、`historyIdentity`、资源、许可及可选本地v3迁移来源。新容器为`containerVersion=4/documentSchemaVersion=3/profile=m1-history`，`packageMode=complete`只携带当前文档、身份和全部当前资源；`packageMode=history`显式携带当前工程及用户所选命名/保护快照。每份快照包括完整文档、身份、资源/许可绑定和内容hash，联合资源按真实hash去重；每份均独立验证。manifest路径/角色/大小/hash、ZIP CRC、格式/尺寸、实际字节/解码和许可校验不得弱化；旧v1/v2/v3读者拒绝v4。历史名称和GM信息仅在主持人备份，玩家PNG仍只来自当前过滤投影。

仓库为独立`sceneweave-m1-history`，不升级或修改旧库。v3启用历史时完整副本迁移为新sceneId/r0，实体/图层ID保留，建立lineage/token并保留确切v3原包和先前v2/v1来源链；旧自动历史留在旧库，界面明确未迁入。从v4当前包/历史包导入也只创建隔离副本，保留可验证lineage及所选快照身份，不覆盖打开工程。迁移原件可单独下载，普通工程/历史包不自动携带本地旧原件。

首批保护预算（不是实测容量承诺）：每场景最多32个命名快照、32个恢复保护点；便携包最多64个所选快照；数据库唯一资源/许可256MiB、全部文档/身份JSON128MiB、保留迁移原件128MiB；便携历史文档/身份JSON128MiB，ZIP继续采用现有100MiB压缩/300MiB展开及图片/许可限额。每份身份最多65536个已分配物件ID。达到限制时整笔拒绝，提供导出和显式删快照入口；无自动删除固定项，无资源垃圾回收，不以滚动20份回收仍被引用的字节。

命名创建先捕获并完整校验工程、flush成功，再在写入快照的同一事务核对sceneId/revision/当前完整内容并写入资源与快照；改名不改内容hash，删除只删明确快照及其绑定，不删除共享字节。保护点采用相同CAS，并在同一事务核对源快照hash和历史元数据版本，成功后不能被自动20份淘汰；期间修改、取消、源快照删除或内容hash不一致均阻止旧候选采用。采用后的自动保存失败保留新内存、撤销、保护点和旧持久分支；冲突保留双方。实际验证以27为准。

命名快照是用户明确保留的完整工程时间点，支持后续从中恢复局部；它不是C0的内存认证对象，也不等同会话撤销栈。C1d交付独立物件/外观局部恢复，C2补有限同会话结构恢复，C3已补有限组合/源链恢复，C4已补持久室外连续身份与有限地形/散布恢复，分别见29/31。具体字段组和边界由[04](04-scene-document.md)定义。

#### C2沿用严格v4的保存与结构恢复边界（已实现；适用验证见28）

C2房间、共墙/门窗、遮罩、注记及世界/导出范围全部写入既有严格v3字段，继续由v4完整信封、container4/m1-history和独立历史仓库保存；没有新数据库/容器/identity字段，也不扩大资源/历史限额。建筑候选原子采用、撤销重做、保存重开、当前包和明确所选历史包沿用C1d完整资源/CAS路径。保存与导入仍要严格验证文档、字节和许可，不因内容由建筑工具创建而免检。

结构恢复的连续性记录只驻留当前工作区内存，为本次打开期间新建命名快照和成功落盘保护点登记。记录绑定快照ID/contentHash、完整文档与持续结构身份，不能序列化、导入、复制或以结构ID/名称替代。重开、导入、另存副本或切换工程会清空记录；已删除重建或拓扑改变的历史结构即使最终JSON/ID相同也拒绝局部恢复，撤销不能重新使其有效。既有完整命名/保护快照继续保存在包/仓库，可查看和备份，适用独立物件恢复也保持；不能把携带历史包解释为已提供跨会话结构恢复。未来持久结构身份需新版本严格契约与完整副本迁移。

结构恢复`geometry`为位置与尺寸，`properties`为位置、尺寸与业务属性；均保留当前图层/锁/材质/资源/许可/支撑/高程/拓扑，不从历史合并旧材质字节来恢复建筑外观，也不重建已删结构。依赖与跨层范围先检查、明确确认再预览。采用前flush当前工程，核对来源hash及当前checkpoint；保护点以场景、历史元数据及来源快照同事务CAS落盘，再重新校验连续性/候选并一次revision+1采用。保护失败保留当前内容；保护成功后的取消/失败及采用后保存失败继续遵循下列阶段语义，不能将后者误记为从未修改内存。适用子项已完成验证，具体证据与限制归[28](28-m1c-c2-validation.md)。


| 类别 | 保存内容 | 保留与删除 |
|---|---|---|
| 最近自动保存快照 | 完整已保存修订及资源绑定 | 继续作为有界滚动历史；目前为最近20份成功保存，淘汰该行不代表资源可立即清除 |
| 用户命名/固定快照 | 不可变完整工程引用、源sceneId及lineage、源revision、格式版本、创建时间、名称和资源/许可闭包 | 与自动20份分开；不因继续编辑、自动淘汰或清理而静默删除。用户明确取消固定或删除后才可回收无引用资源 |
| 恢复前保护快照 | 采用局部恢复前的完整当前内容及全部必需资源，记录恢复操作归属 | 先成功落盘再采用恢复；至少保留到用户明确释放或执行预先说明的清理策略，不能刚恢复就被滚动20份淘汰 |
| 会话撤销/重做 | 当前会话内原子操作历史 | 首版仍可在关闭会话后丢弃，不能用它代替命名快照 |

命名与固定成功以完整事务落盘为准；若目标是当前未保存修订，要先捕获完整工程并写入必要资源，失败时保持未保存提示，不生成空的“快照已建”条目。名称可修改，快照ID和捕获内容不可变；名称不作为实体匹配键。取消固定、删除快照、删除当前工程、导出备份分别展示影响：删除一个快照不删除其他快照或当前工程共用的资源，删除工程也不能顺带静默删除用户固定历史。

C1d界面显示命名/保护快照数量、存储资源/文档/原件占用及预算，并提供明确删除快照入口。32份数量上限有自动化拒绝证据；256/128MiB预算是实现的保护上限，不是实测容量或真实浏览器配额承诺。预算不足整笔拒绝，提供现有工程导出/明确清理入口，不自动删除用户固定项腾位置。当前删除快照不回收共享字节；未来垃圾回收闭包须包含全部当前场景、自动历史、命名历史、恢复保护点、迁移原件及跨场景资源引用，清理事务不能与正在采用/保存的资源绑定竞态。

局部恢复遵循以下提交过程：

1. 读取并严格验证目标快照的完整文档、实际字节、固定版本及许可；检查与当前场景的可验证lineage。原始快照丢失、已淘汰、损坏、不同lineage或缺资源时给出诊断，不能以名称或旧revision猜测匹配。
2. 从快照中按稳定ID及选择的属性组提取候选，计算最小必要依赖，显示当前值/历史值、增加/删除对象、图层归属变化和范围外影响。仅外观恢复默认保留当前几何、物理语义、锁和visibility；历史图层内容恢复需单列快照后新增内容的删除，不隐式丢弃新编辑。
3. 固定sceneId、baseRevision、快照身份和范围，校验当前完整候选；恢复前捕获当前完整分支并成功保存为保护快照。保护保存遵守同事务CAS和工作区checkpoint；失败、冲突、取消或期间有新编辑时，旧恢复候选不得覆盖当前工作。
4. 备份成功后再次核对基线和资源，采用为当前revision+1的单一可撤销领域事务，保持未选区域。锁、引用、几何、资源闭包、保密/遮罩等全部校验通过才提交；不得借history来源绕过现有锁，也不能把快照revision写回当前场景。
5. 按现有串行保存和CAS将新完整修订落盘；若后续保存失败，保留新内存状态、撤销能力、已落盘的保护快照和原持久分支，显示失败并允许导出/另存。跨标签已更新时保留双方，不进行静默合并。

恢复预览不会修改自动保存队列；失败/取消释放候选资源而不删除原快照资源。已成功创建的恢复保护点即使后来取消，也有明确条目和清理方式。恢复导致公开范围变化时必须显式列出并重新审阅玩家输出；源快照的GM内容、图层名称和历史元数据不进入玩家PNG。验收包括重命名/删后恢复/后增对象、跨层关系、共享墙门、组合和散布人工记录、有效锁、不同lineage、缺资源、快照淘汰、CAS冲突及配额故障，分期范围见07/09。

### 新契约的副本迁移与历史备份（C1c/C1d已实现边界）

严格v2的`m1-assets/complete`及v3的`m1-layers/complete`仅封装当前SceneDocument、实际资产和许可，不导出数据库最近20份历史或接受额外历史条目。v4的`m1-history/complete`也仅携带当前工程；只有明确勾选快照后下载的`history`包携带所选命名/保护历史，不包含未选快照、会话撤销栈或旧自动历史。

C1c新增用户图层，C1d新增命名历史/lineage，C3新增非破坏性源链时，须分别明确文档、数据库及容器是否升级，先冻结严格字段、版本分派和读者行为，再实现完整副本迁移。C1c/C1d版本及序列化已在本页冻结并实现，C3的新v5合同见本页末节；不能在现有schemaVersion=2/3场景或旧manifest中偷偷增加字段/条目，也不能只改profile规避旧校验。

迁移保留原v1/v2工程、来源字节及历史。新副本保持所有实体ID及既有物理/受众语义，建立可验证来源关系，并以新场景修订起点独立保存；用户图层的确定性默认归属、原有排序的等价映射、旧快照与新实体身份映射须有逐项对照，不能按最新目录或画布顺序猜值。对历史提供明确迁移选择和逐项结果，未迁移的历史保留在原仓库，不能显示为“已备份到新工程”。失败/取消不删除旧工程或部分历史。

C1d命名历史交付须同时提供明确的可携带备份方案：当前工程包与“包含所选命名快照的历史备份”区分入口，后者采用明确的新容器合同，完整包含每份快照的文档和联合资源/许可闭包，hash去重但逐份可验证。历史格式及独立数量/展开预算冻结前不得写入当前v2包。导入历史仍创建隔离副本，迁移后验证来源关系和全部快照；不覆盖当前sceneId，也不把缺失历史资源降为可成功恢复。两种主持人备份都可能包含历史秘密，玩家出口只生成当前已过滤结果。

### C3/M2派生素材的持久化（C3本地有限实现，实际证据见29）

参数调整与AI生成/同化共用受控素材入口：固定源定义/源图、保存派生版本和有界参数，规范化并保存实际采用字节及许可，然后由原子外观事务引用。移除覆盖要能回到固定来源；不得以seed、提示词、URL或重新调用provider代替资产备份，也不得修改默认素材原件或让其他引用它的实例自动变化。

源/派生链、图层/成员覆盖及完整有效外观进入新契约的依赖闭包；已采用组合及散布人工记录保持完整，未采用AI候选留会话暂存，取消后可释放。新字节或来源许可校验失败时不产生半套定义，不覆盖当前资源。AI单件、组合、多组合逐步采用各自形成可撤销批次和可追溯固定范围，完整新格式往返须验证关闭网络后仍可编辑、逐项移除调整及恢复旧外观。

## M1 本地仓库与数据库兼容规范（B1 已实现基础）

数据库版本、文档 schemaVersion 与容器 containerVersion 是三个独立版本。本轮冻结 M1 使用新数据库名 `sceneweave-m1`，初始 IndexedDB 结构版本为 1；不原地升级、覆盖或清空现有 `sceneweave-m0` 数据库。M0 原件与最近 20 个历史快照因此继续保留，旧应用仍只能处理其自己的几何仓库。切换应用版本不自动迁移全部本地工程，不把“未在新仓库找到”解释为原件已删除。

| 存储项 | 键／内容 | 保存与清理约束 |
|---|---|---|
| scenes | sceneId；revision、documentSchemaVersion=2、完整 document、savedAt | 仅接受严格 v2 文档；savedAt 是本地排序时间，不代替 revision |
| snapshots | [sceneId, revision]；相同的完整文档记录 | 延续最近 20 个成功保存版本；恢复为新 sceneId |
| assetBlobs | sha256；规范化位图 Blob、mimeType、sizeBytes、pixelWidth、pixelHeight | hash 对实际采用字节计算；同 hash 不得绑定不同字节／类型／尺寸 |
| licenseTexts | sha256；UTF-8 许可／来源／署名文本 | 内容寻址；同一许可文本可被多条引用复用 |
| resourceBindings | [sceneId, revision]；该版本的资产 hash、许可 hash 及依赖索引 | 与文档同事务写入；索引可重算，不能取代 scene 内引用与完整定义 |
| migrationSources | 新 sceneId；sourceSchemaVersion、sourceSceneId、sourceRevision、sourceHash、migratorVersion、migratedAt、保留的原始 scene JSON 或原始容器 | 只保存本地迁移证据，不包含系统路径、凭据；普通工程导出不默认夹带第二份旧场景 |

图片解码、清理元数据、hash、领域校验和依赖闭包计算在事务外的隔离候选中完成。真正持久化时用一个包含上述相关表的 IndexedDB 事务，比较目标场景的 `expectedPersistedRevision`，再写入完整文档、缺少的资源、该修订绑定、历史记录及必要迁移来源；任一步失败整体回滚。新增目标使用显式“无记录”期望值，已有记录还须匹配 documentSchemaVersion=2，未知版本不能当作空场景覆写。读者校验文档与资源，不只信任数据库行中重复保存的版本号。

所有标签仍遵守前文串行队列与 CAS 协议。同一 hash 的去重写入必须在事务内核对已有资源；不能先提交新文档、随后异步补资产。取消或配额失败可丢弃尚未采用的候选，不能删除旧版本仍引用的 Blob。新版本升级 `sceneweave-m1` 的数据库结构时，versionchange 先停止新写入并关闭旧连接；blocked／升级失败明确显示，不能回退到旧结构继续保存。较旧读者遇到更高数据库结构版本、文档版本或必需语义一律拒绝，不提供“删掉未知内容再另存”。

跨仓库迁移读取 M0 的一个完整已保存修订，迁移到新 sceneId；不尝试跨两个数据库制造原子覆盖。迁移期间 M0 标签继续编辑产生的是另一个后续修订，M1 副本保留其实际来源修订，不覆盖其中任何一方。M1 迁移落盘、资源绑定与迁移来源在目标仓库内仍是同一事务。重复迁移可提示已有来源副本，不能静默把新旧分支合并。后续若提供原场景替换，须另行设计跨版本保留与 CAS，M1-B 不提供此入口。

## .sceneweave 文件设计

扩展名 `.sceneweave`，媒体类型 `application/x-sceneweave`，使用标准 ZIP。格式配置必须整体匹配，不能只换 profile 让旧 Schema 接受新实体。

| 配置 | 容器／文档／profile | 阶段与读者行为 |
|---|---|---|
| M0 几何包 | containerVersion=1、documentSchemaVersion=1、profile=m0-geometry | 当前已实现；严格两条目，拒绝外部素材与未知字段 |
| M1 完整资产包 | containerVersion=2、documentSchemaVersion=2、profile=m1-assets、packageMode=complete | B1 已实现独立完整包读写与显式 v1 副本迁移；实际验证范围见17，预览/编辑能力按切片开放 |
| 只含引用／缺失资产的包 | 未分配可写配置 | M1-B 不接受或写出；后续独立设计，不阻塞双样板 |

工程可能包含私密注记、秘密几何和生成摘要，界面必须标注“主持人工程”，不能直接交给玩家。包内不保存会话撤销历史、provider 配置、GM 缩略图、模型原始响应、API Key、会话凭据、绝对本地路径或系统信息。

旧 M0 读者按其严格预算、条目及版本校验拒绝 v2，不会尝试降级读取；含资源的新包可能先因条目数或大小被拒绝，不保证返回同一种版本提示。新读者先按外层版本分派到严格解析器，再校验其中 documentSchemaVersion 与 scene.schemaVersion；未知高版本、未知 profile、未知必需字段、大小写变体和不匹配组合均拒绝。应用版本仅供诊断，不决定兼容。没有 v2→v1 压平、删素材或拆组合的降级保存。

### v2 包布局与 manifest 机器字段

除 manifest.json 本身外，每一文件必须在 entries 中出现恰好一次，实际 ZIP 条目集合必须等于 manifest.json 加 entries 的路径集合；不接受额外缓存、目录条目、嵌套归档或未声明文件。manifest.json 不列入自己的 hash 清单，避免自引用；其大小与结构另有硬限制。

| 路径 | 内容 |
|---|---|
| manifest.json | 严格 JSON manifest，下表字段不可缺少；未知字段拒绝 |
| scene.json | 一个完整 v2 SceneDocument，包含实际采用的定义快照、参数、全部成员和人工覆盖；不含 Blob |
| assets/\<sha256\>.png、.jpg 或 .webp | 允许嵌入且已规范化的实际采用位图；扩展名与实际 MIME 严格对应，同 hash 只存一项 |
| licenses/\<sha256\>.txt | UTF-8 许可、来源及必要署名文本；hash 按这份文本实际字节计算，不把用户输入的 licenseRef 拼成路径 |

| manifest 字段 | 类型／固定值与约束 |
|---|---|
| format | 固定字符串 sceneweave-project |
| containerVersion / documentSchemaVersion | 整数 2 / 2；scene.json 的 schemaVersion 必须为 2 |
| application / applicationVersion | 固定 Sceneweave／非空版本字符串，至多 100 个 Unicode 码点；不据此跳过格式校验 |
| profile / packageMode | 固定 m1-assets / complete；缺省不推断为 complete |
| sceneId / revision | 与 scene.json 完全一致；revision 为非负安全整数，导入后不是目标存档 CAS 的期望值 |
| entries | 对象数组；每项恰有 path、role、sha256、sizeBytes、mimeType；path 唯一，role 为 scene、asset 或 license |
| licenseBindings | 对象数组；每项恰有 subjectKind、subjectId、licenseRef、licensePath、embedding；subjectKind 为 asset、material、propDefinition、prefabDefinition 或 styleTheme，embedding 固定 allowed |

entries 的 scene 角色恰有 scene.json 一项，mimeType 固定 application/json；asset 的 MIME 为 image/png、image/jpeg 或 image/webp；license 为 text/plain。sizeBytes 是解压后真实字节数的正安全整数，sha256 是 64 个小写十六进制字符。asset／license 路径中的 hash 必须同时等于该项 sha256，拒绝绝对路径、反斜线、空段、`.`、`..`、NUL、大小写别名、重复路径、加密 ZIP、分卷、ZIP64 和不支持的压缩法；v2 只接受 stored 或 deflate。目录／本地记录的名称、偏移、大小、方法和 CRC 必须一致，不能以 manifest 的声明取代实际边界检查。

licenseBindings 将 scene.assets 或某种定义快照的 subjectId 绑定到该对象的 licenseRef，以及一个已声明 license 条目。subjectKind/subjectId 组合唯一，不接受悬空绑定；每个有许可依赖的实际采用对象恰有一条一致绑定；同一 licenseRef 在一包内只映射一种许可文本 hash。AssetRef 及四类定义的 origin.canEmbed 必须为 true，全部传递依赖也必须允许打包；机器标记只能记录已核对的来源结论，不能把未知或禁止嵌入自动改成 allowed。自制素材仍需保留来源和必要许可，主题／组合的可分发性不能覆盖成员的限制。许可文本不作为 HTML 执行，不能含凭据、绝对系统路径或不必要私人信息。具体来源准则见[规则与素材](10-rules-assets-and-licensing.md)。

### 可继续编辑的依赖闭包

完整包按[场景文档](04-scene-document.md)的实际引用计算传递闭包，闭包根包括全部实体、实际采用的主题、完整组合／散布记录及用于继续编辑的固定定义快照；不只检查当前视口内可见的像素。它必须包含：

- 全部房间／地形的已采用轮廓、高度、coveragePriority、边缘、连接、材质实例参数，以及原有锁、秘密、注记、约束与预设快照。
- Prop.appearance、MaterialRef 等引用到的 AssetRef 及其实际字节；PropDefinition、MaterialRef、PrefabDefinition、StyleTheme 的工程内快照。定义引用使用 `{id, version}` 精确匹配，集合 key 为不透明快照 id，catalogId 是来源目录身份，不是运行时下载地址。
- PrefabDefinition 中尚未单独出现在场景的模板子项、成员定义、默认外观和主题建议的实际定义依赖。允许同 catalogId 多版本并存，同 catalogId/version 内容不同则拒绝；相同位图 hash 可以由多个语义定义复用。
- 完整采用的组合成员、散布物件、稳定成员身份、人工移动／替换／删除覆盖和排除记录。seed、算法版本和目录版本只记录来源，重开不能重新撒布或复活删除项。
- 闭包内全部资产与定义的许可、来源及署名。只打包工程采用的定义及其引用闭包，不复制整个全局目录；未采用候选、缩略图、模型原始响应和聊天记录不属于依赖。

引用必须指向包内已存在且版本匹配的对象。asset／license 条目必须恰好覆盖引用闭包，不接受未被引用的位图、许可或额外库缓存。定义依赖图不得循环或无限展开；先做对象数、深度和去重检查再遍历，不能仅靠递归等待栈溢出。重复 hash 只去重字节，不合并定义 ID、真实尺寸、物理占地、秘密或许可。渲染缓存、派生路径图、解码位图、GPU 纹理和预览缩略图均可重建，不是存档的唯一内容。

B4新增`ProjectValidationErrorV2.issues`和`diagnoseCompleteProjectV2`，正式导入/导出/存储复用严格验证。结构合法后聚合缺依赖、固定版本与许可问题，附对象/依赖ID、hash或包内path；结构或依赖不合格不解码，诊断不返回可采用工程。最多展示256项（含明确未展示数量），错误字符串只摘要前8项；字节/hash/CRC/实际解码仍首错停止。UI提供成功摘要或失败清单，切受众/工程/修订后清理。取消保留AbortError，原生解码错误替换为固定可读原因，不输出GM正文或外部机器路径。实际两样板矩阵见[20](20-m1b-b4-validation.md)。

材料、定义版本及主题按保存的快照重开；目录更新、网络恢复、应用升级都不得静默升级。采用新版本必须形成有差异预览的独立事务。缺定义、坏引用、缺位图或缺许可的 v2 包一律不能作为 complete 导入正式仓库；可以列出诊断并让用户保留原始文件，不能先持久化一个占位场景再宣称往返完整。将来若提供诊断预览，其状态也不具有完整工程导出资格。

M1-B 只写出完整包。禁止嵌入或缺失依赖时，完整工程导出失败并列出可替换项；用户可以保留现有本地文档并更换为可嵌入素材。只含引用的包、下载补齐、缺图重关联和自动外链请求均为后续范围，没有“忽略警告继续导出”的完整包入口。PNG 若所需视觉资源缺失或未解码成功，同样不能生成一张删图后的“成功”地图。

## 导入事务与 v1→v2 迁移（B1 已实现基础）

1. 在完整读入文件体与解压资源前，先检查压缩大小，再通过有界切片检查 ZIP 中央目录／本地记录、条目数、声明预算和路径；随后有界读取 manifest 并分派支持的配置。未知配置直接停止，不尝试嵌套解压或联网补齐。
2. 在隔离暂存区有界解析 manifest、scene 和许可文本，拒绝无效 UTF-8、解码后重复键、未知字段、超深度／数量的 JSON；逐项核对实际展开量、CRC、SHA-256、MIME 和资产头部尺寸。
3. v2 做严格 Schema、几何、依赖闭包、固定定义版本与许可检查；支持的 v1 按下表迁移完整副本，再校验 v2。PNG/JPEG/WebP 通过尺寸预算后按受控并发实际解码，核对尺寸、静态格式与透明数据；任何失败停止。
4. 展示标题、来源版本、几何／素材完整度、保密属性和迁移摘要。默认新 sceneId、revision=0，记录源 sceneId/revision；实体 ID 可在独立场景命名空间保留。新 createdAt/updatedAt 表示副本时间，原时间保留在迁移来源中。
5. 主持人确认后将完整候选、全部必需资源与绑定、快照和迁移原件在一个目标 IndexedDB 事务写入，CAS 期望为“无记录”。事务成功后才切换编辑器；确认期间当前内存修订变化则保留当前编辑，不自动切换。
6. 失败／取消保持当前文档、旧数据库和输入文件完整，释放隔离缓存；没有部分入库。M1-B 不提供覆盖原 sceneId 导入，既有本地 v2 的正常保存继续使用 CAS。

当前 M0 仅执行其几何配置支持的步骤，没有素材解码、旧版本迁移、跨仓库复制或 v2 支持。新迁移器只接受通过严格 M0 v1 校验的 m0-geometry 包／本地快照：assets={}、Prop.assetId=null、单 Floor，且未带现行不支持的路径硬约束。不能把“泛称 v1”的未知资产文档当作可靠迁移输入。

| v1 内容 | 冻结的 v2 迁移结果 |
|---|---|
| format、坐标、单位、几何、实体 ID | format 保持 sceneweave、schemaVersion=2；除新 sceneId／副本修订与时间外，原有整数毫米、Floor 范围、顶点、共享墙、墙厚、门窗挂接与导出边界保持 |
| Opening 的挂接参考 | 新增 offsetReferenceVertexId=原 Wall.startVertexId；offsetMm、widthMm 原值保持，以该稳定端点计量；迁移不重新取整门位置，M0 原反转行为保持历史事实 |
| Prop.assetId=null 与五种 symbol | 转为 appearance={kind:symbol, symbol:原值, tint:null, opacity:1}；definitionRef=null；不强制找图或替换原创符号，v2 不保留旧 assetId/symbol 为另一个并行外观来源 |
| Prop 物理与外观 | positionMm、rotationDeg、footprintMm、blocksMovement、blocksSight、visibility、editLocked、roomId 原样保留；footprintOffsetMm=(0,0)，visualBoundsMm 取原 footprint 尺寸，x=-floor(width/2)、y=-floor(height/2)，奇数mm仅有最多0.5mm视觉中心差异；renderOrder=0，supportRef 指原 Floor，roomId只保留归属并继承房间保密；其余新增字段按04的迁移表 |
| Room、Floor 与外观 | 地面以原 Floor 基准 0 mm 开始；支持关系与外观采用04的显式中性默认，不推断材质、台地、阴影或自动生成支撑区域 |
| Region | 原样保留其 kind、边界、阻挡、代价、可见性与锁；terrain 名称不触发 TerrainArea 转换，manualMask 继续遵守遮罩语义 |
| 秘密、注记与约束 | Room/Prop/Region 的 visibility、秘密门 secret/revealed/state/locked、Note 的锚点／标题／正文／discovered、编辑锁、accessExpectation、constraints、presetSnapshot 与 generationMetadata 原样保留；不公开 GM 内容或补写未声明路径约束 |
| 新定义与地形／组合集合 | propDefinitions、materials、terrainAreas、terrainEdges、terrainConnections、paths、prefabDefinitions、prefabInstances、scatterGroups、styleThemes 均为空，activeStyleThemeRef=null；assets 仍为空 |

完整默认值以04的 v1→v2 表为唯一字段主定义；迁移不能依据目录最新默认值或当前渲染器偏好补值。迁移前保留输入原始容器或本地 v1 JSON，并对实际保留字节计算 sourceHash（SHA-256）；本地对象先序列化为保留的 UTF-8 JSON 字节，再迁移副本，不以迁移后文档反算来源 hash；旧仓库原记录与历史不删。迁移结果另存副本，原 revision 作为来源，不能当作新场景的 CAS 版本。任何未知语义、坏引用、非空旧资产、不支持约束、资源失败或写入失败都终止，不留下“新文档配旧资源”的半包。

迁移必须建立专用的 v1 输入／v2 输出对照、M0 原件不变、重复迁移、配额／CAS／取消／并发编辑负例；M0 既有往返测试不覆盖这些行为。

## 资产输入与候选资源保护策略（B1 已设防护／未测容量）

M0不导入外部位图，M1当时仅支持静态PNG、JPEG、WebP。M2-4现按本页A及04的严格合同接收有界静态SVG源并物化实际PNG；活动SVG、HTML、脚本、外链资源、字体、动画、多帧与3D内容继续拒绝，APNG／动画WebP也不接受。只看扩展名或浏览器成功显示不算格式校验；文本按普通UTF-8文本处理，打开工程不得发出外部请求。

外部素材先受控解码并规范化为本地、静态、sRGB 位图，再供采用；先应用来源方向和色彩转换，再移除 EXIF、XMP、注释、文本块等不必要元数据，必要来源／署名单独写许可。规范化后的实际字节产生新 hash，AssetRef 的尺寸与 MIME 与之对应；不能先以原字节 hash 入库再暗改内容。导入 v2 完整包应已满足同一规范，元数据／编码不符合时拒绝并报告，不能校验 hash 后静默替换为另一张图。许可要求的署名通过许可闭包保留。

下表为B1采用的**候选保护值**，用于相应输入入口的前置拒绝与有界处理；具体负例见17/20。它们不是已验证容量、性能目标或公开支持声明；PNG项已是当前渲染器的执行上限，样板实际出图见18/19。B5在21记录真实负载、保护行为与预算依据，M1-C/C0继续据实测调整体验与支持范围，不因500/2000实例观测而扩大格式限额。M0继续以开头的5 MiB／10 MiB／64 KiB／两条目为准。

| 保护项 | M1 候选值／执行位置 |
|---|---|
| 整包压缩 bytes／全部实际展开 bytes | ≤100 MiB／≤300 MiB；读取 Blob 前与流式解压中分别累计，不只信任目录 |
| manifest／scene／单份许可 bytes | ≤1 MiB／≤20 MiB／≤256 KiB；实际解码前限长 |
| ZIP 实际文件条目数／JSON 限额 | ≤3000（含 manifest）；每份 JSON 深度≤128，整包累计解析值≤600000；解码后重复键拒绝 |
| 单位图编码 bytes | ≤20 MiB；文件头前即可检查长度 |
| 单位图宽高／像素 | 每边≤8192 px、宽×高≤32000000；头部预检与实际解码后都核对，乘法必须为安全整数 |
| 全包独立位图／累计像素 | ≤256 张 hash 去重位图／≤64000000 像素；同时限制对象引用数，不因复用同图绕过 JSON／成员数量预算 |
| 基础解码内存下界 | 累计像素×4 ≤256000000 bytes；这是候选基础 RGBA 预算，不含解码器、GPU、atlas、Canvas 或编码峰值，不能声称进程只占这些内存 |
| 解码并发 | 同一应用运行上下文中的v2原生解码至多1项；渲染与IO校验/规范化共用解码槽，排队等待与原生解码耗时分列。它不表示只驻留1张已解码位图；单项失败停止任务，不自动无限重试 |
| 场景成员数量 | 全部实体累计≤10000，组合／散布展开后的每个 Prop 均单独计数；候选展开前先估算并预留数量，展开中仍累计，拒绝超限且不截断 |
| 定义依赖遍历 | 去重后定义≤4096、依赖深度≤32；先校验引用和循环，超限报错，不做隐式截断 |
| PNG 输出 | 长边≤4096、总像素≤16777216；B2/B3固定样板出图见18/19，B5固定4K与4097拒绝后的继续编辑矩阵见21，不外推为其他资源规模的容量承诺 |

预算相互独立：编码文件很小仍可能解出巨量像素，位图数量很少仍可能产生大量成员，理论 RGBA 合计较小也不证明 4K 合成峰值可承受。解压要在块回调中核对实际输出并及时中止；不能先无界解压，再检查解压后数组。CRC、哈希和尺寸验证不能被缩略预览或浏览器缓存跳过；异常比率可作为诊断，不替代实际字节上限。ZIP 不能触发嵌套文件读取或网络下载。

### 资源故障、恢复与测量

缺 Blob、坏 hash、错误 MIME／尺寸、动画、解码错误、GPU 纹理或 Canvas 分配失败分开报告，包含资产或定义 ID，日志不写原文件路径、GM 文本或来源凭据。取消／失败释放新创建的解码图、对象 URL、临时 Canvas／GPU 资源和候选；保留文档、未保存编辑、已有资源及导出配置。不可为继续出图而静默删图、降低精度、降级样式或把缺图 PNG 标为成功。用户可显式重试、选择已入库的可用资源替换，或选择较小输出；任何替换仍要预览及原子采用。这不包含被拒绝的不完整包导入或文件路径重关联。

当前内存文档仍可在资源问题时保留编辑状态；只有完整依赖可用才可标为“已保存完整工程”。仓库加载发现损坏时保留原记录，进入诊断／恢复流程；不以覆盖原行修复，更不能用占位图的 hash 代替失踪原图。有限缓存可淘汰解码／GPU 数据，不能淘汰仍被场景或最近快照引用的持久 Blob。快照、迁移原件与跨场景引用都计入清理闭包，垃圾回收后续实现。

M1-B 对 VIS-01、VIS-02 分别记录文件压缩体积、JSON／资产展开 bytes、hash 去重位图数量、累计像素、纹理／atlas 数量、几何／边缘复杂度、Prop／组合／散布成员数、设备／浏览器与测量方法。冷路径从新仓库导入并首次解码开始，热路径在缓存可复用时重开／编辑／导出；记录至少三次运行的各次数据与缓存状态。分别测导入、首帧、平移缩放、一次材质／物件编辑、保存重开和 4K 导出的时间与可观测内存峰值；同时记录预览是否驻留、并存导出 Canvas 和解码／编码缓冲。无法取得的 GPU／浏览器内存指标标为未测，不能用理论估算冒充进程峰值。

B5适用矩阵为VIS-01/02各500/2000物件，分别在三个新Chrome进程中冷导入；每轮60次真实选择、30次物件编辑与30次轮廓编辑，真实保存/重开并检查20个快照，GM/player各导出一次固定4K，同时检查超限拒绝后的编辑与撤销。每个受测版本共12轮、24次4K导出；原始数据、基线与候选比较及最终状态统一归21。当前无持久ImageBitmap缓存，warm表示已加载模块、源Blob或已有仓库，不能写成跨绘制解码缓存命中。B5测量时v2尚无自由平移/缩放/拖动；C0后来已补视口平移/缩放及相应证据，物件自由拖动等后续操作仍须按M1-C实际实现补测。

B5编辑计时在命令构造完成后才开始：`commitMs`覆盖准备好命令后的`workspace.execute`校验与文档事务，`displayProxy`也从该时点起算；室外轮廓的克隆/浅水联动准备、面板与输入成本未计入。即使500实例的提交值低于100ms，也不能据此关闭QA-PERF-01的普通编辑端到端目标；C0须补输入与命令准备成本。

资源采样目前仅适配macOS：OS以100ms目标间隔采集专属浏览器进程树同一时刻RSS之和，CDP以200ms目标间隔观测目标renderer的JS堆，并保留实际间隔与阶段。JS堆默认全程汇总包含tooling-audit、下载与idle；产品阶段应从`byPhase`单独提取，引用全程值时标明其范围。RSS共享页可能重复计入，漏采瞬态、去重物理内存及GPU/驱动分配保持缺证据；不能将JS堆、RSS合计或理论RGBA缓冲互相替代。Canvas绘图提交不等于GPU完成，画布复制后的双rAF只作显示调度近似值。500作为M1-C工作目标、2000作为压力观察，C0复测前不承诺全交互流畅或公开容量；滚动计划与投入假设见[07](07-roadmap.md)。

VIS-01验证墙角、木板方向、透明家具与接触阴影；VIS-02验证草岩沙水过渡、悬崖／岸线和树石散布。同一次绘制内，相同hash资源可以共享解码结果；这不构成持久缓存，2000实例也不表示2000张独立纹理已达标。新profile的完整往返、资源失败恢复、资源峰值和玩家保密分别归17–21，历史13/17/18/19/20及原始证据保持原状。具体退出标准见[质量计划](09-quality-plan.md)。

## 玩家投影

M0 投影输入是确定修订的 SceneDocument 和明确的 gm/player 受众；输出是目标受众的临时渲染数据。GM 与玩家导出均从同一文档生成，玩家投影在绘图之前过滤数据，而非先画 GM 图再简单盖住文字。

| 内容 | GM 输出 | 玩家输出 |
|---|---|---|
| public 房间、物件、区域 | 可见 | 可见 |
| gm 几何 | 带主持人标记可见 | 从渲染集合剔除，隐藏空间以保守遮罩覆盖 |
| gm 注记/线索 | 按导出开关显示 | 完全剔除正文、标签与图标 |
| 未揭示秘密门 | 显示秘密门标记 | 补齐普通墙段，连续纹理和轮廓 |
| revealed 的秘密门 | 显示状态 | 可显示门；关联房间/注记仍按各自可见性 |
| 引擎 ID、生成摘要、素材来源 | 不自动打印 | 不绘制、不写入文件元数据 |

public 注记不保证锚点本身公开。若它锚定 gm 几何、未揭示秘密门或被遮罩位置，玩家投影仍剔除该注记并在 GM 预览列出冲突；主持人可以公开锚点或把文字移动到明确公开的坐标后再发布。禁止在隐藏地点留下悬浮标签。遮罩的最后合成也覆盖所有注记和图标。

保守遮罩必须覆盖隐藏区域以及会暗示其存在的边框、阴影、光照与装饰。M0 使用样例中预设的整块矩形未知区，不精确描出秘密通道；若隐藏对象移动出覆盖范围，玩家预览和导出明确拒绝。当前没有遮罩编辑工具，应先恢复受支持的可见性或几何；M1 再提供主持人调整整块遮罩的工具。

M0 以隐藏 Room、Prop、Region 在导出范围内的轴对齐包围盒检查遮罩并集全覆盖，比精确多边形检查更保守。单独把公开区域内的家具设为 gm，也须已有遮罩覆盖，否则拒绝玩家输出。GM 房间所属的秘密墙段不进入玩家集合；其他独立内墙/围栏默认公开，完全被遮罩覆盖的墙段（含墙厚）剔除，部分覆盖仍由最终不透明遮罩裁切。图标偏移后的实际位置与原注记锚点都参与遮罩保密检查。

导出画布范围来自 exportBoundsMm，与隐藏内容的包围盒无关。秘密家具变动不能改变裁剪、网格相位或文件名。最终不透明遮罩在地面、装饰、阴影、墙线和网格合成之后应用；公共边界需由投影重建而非暴露秘密边线。

M0 的预览与最终 PNG 已使用相同投影器；高分辨率导出也按同一世界坐标策略重绘。最终 PNG 经独立 Canvas 编码，不嵌入场景 JSON、prompt、资源 URL 或私密文本块。当前下载名固定为 sceneweave-player-map.png / sceneweave-gm-map.png；后续如支持自定义标题也不能自动取秘密地点名。

“隐藏精确内容”与“玩家不会推测存在任何未知空间”需要分别验证。原始建筑布局本身也可能让玩家推测密室；工具保证其输出遵守遮罩与公开信息契约，主持人仍应在发布预览中检查整个画面是否符合剧情需要。质量验证使用公开内容相同、秘密内容不同的配对场景，检测无关像素差异。

### M1 材质、地形与组合的保密边界

B2/B3已实现下述有限样板子集，B4三组配对证据见20；B5涉及解码排队或临时画布生命周期的实际结果见21。C0认证复用、一次投影内的受众局部索引和双层视口仍须回归相同保密边界，结果归22；局部索引不跨render，也不在GM/player之间共用。SCN-04与完整混合工具继续留M1-D，不把有限子项扩为完整M1验收。

新增外观不会降低上述规则。先从固定 revision 的完整工程构建受众投影，再计算该受众的地表覆盖、相邻边缘、墙角、材质过渡、悬崖侧面、接触阴影和装饰效果。不能从完整 GM 图导出阴影／岸线缓存后仅移除隐藏对象的主体图片。

组合和散布先展开已保存成员并执行成员可见性／来源约束，再进入绘制；整个组隐藏时不得残留其任何成员或阴影，公开组也不能公开内部 gm 成员。私密边缘或连接的名称、锚点标记、装饰台阶与水纹同样过滤。素材库分类、技术 ID、生成说明、许可路径不自动显示在地图或写入 PNG 元数据。

地表被秘密对象改变时，公开边界和材质相位必须只依赖公开数据及固定世界原点。隐藏岛屿、洞口或通道不能改变其他公开区域的阴影、岸线、纹理接缝、散布随机序列或裁剪范围；与隐藏来源有关的效果应剔除，必须保留未知空间时使用整块保守遮罩。遮罩覆盖范围需考虑实际装饰外扩和投影，覆盖不足继续拒绝玩家输出。

M1 使用配对场景验证：分别只改变私密家具／组合、未公开台地高度或轮廓、秘密门及生成记录，玩家图应保持相同公开像素，GM 图应体现修改。同时验证缩放预览与最终 PNG 使用同一投影、材质参数、排序和外观派生。新素材可能带来的 alpha 边缘、图像元数据、跨域污染和新缓存依赖都需要单独负例；13 的程序符号证据保留为历史，不作为这些测试已通过的证明。

## PNG 导出

M0 可选择 GM/player、2K 或 4K 长边、是否绘制格线和标签。导出边界固定取文档 exportBoundsMm，UI 暂不提供任意裁剪或像素密度编辑。输出按物理宽高比舍入到整数像素，不改变实体尺寸；长边与像素预算见本页开头。4K 编码、时间与资源的实际证据见13，超预算明确拒绝，不能静默截断。

导出使用固定 revision 快照；结果标识其来源版本，避免误以为包含之后新增的内容。位图显示与几何标定从同一变换派生。后续为 VTT 对齐提供 pixels-per-grid 等摘要时，不在图中写入无关技术文字。

v2继续按文档exportBoundsMm和指定受众独立绘制4K，不使用C0的CSS偏移、缩放比例、当前选框或视口裁剪；高倍率预览不会改变PNG范围或让1200像素底图成为4K源图。认证快照仅减少重复输入领域校验，资源验证、双受众投影、固定遮罩、4K预算与失败清理仍执行。

出图失败保留文档和导出配置。按钮不能因下载尝试开始就显示“已导出”，应以编码完成、可用文件产生为完成点；浏览器最终保存位置不作未经确认的承诺。

## Universal VTT：M4

M4 才实现，目标先固定一个 Foundry 与 Universal Battlemap Importer 版本组合。它是给主持人导入 VTT 的场景包，不是直接发送给玩家的文件。程序必须显式区分玩家 PNG 与主持人 VTT 工程。

| 字段类别 | 拟议映射 | 需要验证 |
|---|---|---|
| 图片与 resolution | 显示范围、原点、map_size、pixels_per_grid | 原点/轴向/比例是否一致 |
| line_of_sight | 墙段及选定阻挡物 | 拆分、闭合、精度和性能 |
| portals | 门及目标格式允许的开口属性 | 门窗、开闭、上锁、秘密状态能否保留 |
| lights | 后续真实光源模型 | M1–M3 无光源实体，不从装饰火把自动捏造灯光 |
| 私密信息 | 不导出不被目标支持的文字/元数据 | 正确的主持人/玩家视图和保密语义 |

无法保留的属性在导出前列出；玩家保密无法可靠映射时提供安全图片回退或阻止该模式，而不是默认公开。UVTT 的地图图片与结构字段如何配合秘密遮罩，必须在目标工具玩家身份下验证。多楼层等扩展独立立项，不借字段存在就宣称支持。

最少测试导入、编辑门状态、保存重开、玩家视角和比例尺。只解析成功不是互操作通过，详见[质量计划](09-quality-plan.md)。

### C3 完整组件工程、容器与独立仓库 v5（2026-10-22 冻结）

新增`containerVersion=5`、`documentSchemaVersion=3`、profile=`m1-composition`，不修改旧v2/v3/v4容器接受集合。当前完整包与明确勾选命名/保护快照的history包分开；每份完整工程均包含有效v3文档、identity version 2、appearance version 1、实际资源/许可与绑定。未知或缺失字段、条目hash/CRC/字节预算不符、无许可、缺图/解码失败、派生像素与声明参数不一致均拒绝，不允许删图成功或丢元数据降级。

新数据库`sceneweave-m1-composition`独立于历史仓库`sceneweave-m1-history`；最近20次自动保存、32份命名＋32份保护、64份随包快照及既有资源/文档/迁移原件预算维持原限额。新外观图与组合身份进入同事务完整保存、内容hash、元数据比较和保留计数。内存候选异步准备并复查checkpoint，采用一次增加revision；取消/失败不生成半套定义、派生字节、身份或历史。恢复先保存当前完整分支和保护点，再重查源/场景/元数据CAS后一次采用，冲突时双方分支和撤销仍可保全。

从v4迁移仅复制当前完整工程：保留场景内容、已有物件出生token与lineage，初始化组合出生token，创建独立sceneId/r0，并保存确切v4原始字节及其v3→v2→v1来源链；原工程与旧自动/命名/保护历史继续留旧仓库。界面必须明确旧历史没有随迁移进入新库。v5本地原件链不进入普通完整/历史备份；所选v5历史包自身包含逐份可验证的联合源/派生资源闭包，导入时仍建立隔离副本。原生v3渲染/双受众PNG只接受显式有效场景视图，不读取历史、源链、图层名称或许可文本到玩家像素/元数据。

C3本地导入限静态PNG/JPEG/WebP并经既有sRGB/去元数据路径规范化；许可全文、署名、embedding声明及固定定义/实际输出同时采用。颜色派生实际解码源和输出，以确定参数逐像素核对RGB并保持alpha；完整验证、往返和离线恢复均不依赖重跑生成器、AI或网络。AI供应商、提示词流程及逐步生成批次仍留M2。实际实现、验证与尚缺证据在新增29报告维护，不改写旧阶段证据。

C3非活动派生和祖先图片源也保持native-v3的真实固定定义引用；保全定义及其确切来源许可一同进入完整闭包，不把源图当可清理缓存。撤销到较早分支后按命名快照恢复，会在首次严格校验前补齐必要源根，再以对应资产的确切许可绑定完整采用；范围外目录根不盲目并入。保全定义不显示为普通组件目录，图与所有实际字节仍完整保存。

组件工坊的“已准备素材”入库候选只允许新增已验证的素材、固定定义、来源与许可闭包，不能借入库候选修改或删除当前实体、身份、图层、约束、既有源/覆盖和资源。实体及外观修改仍由受支持有限命令在内部准备并重新检查锁、范围与checkpoint；不提供可由调用者伪造的“已经校验”标志。未来AI也必须沿相同边界进入，不能直接提交任意完整候选来绕过锁。

## C4：严格v6完整室外工程与副本迁移（本地实现）

C4按04的identity3采用containerVersion=6、profile=`m1-outdoor`和独立`sceneweave-m1-outdoor`仓库。有效场景仍schemaVersion=3、appearance.version=1；完整当前工程与明确勾选命名/保护历史包区分，沿用既有资源/图片/ZIP/历史预算、CRC/hash、严格版本分派、实际字节/解码/许可闭包。未知字段或版本拒绝；旧v3/v4/v5读者不能读取新语义，不通过丢身份字段降级另存。v3完整视图只用于原生渲染与领域工具。

v5→v6迁移只复制完整当前修订到新sceneId，保留prop/prefab出生token、lineage/root关系与固定源/派生实际字节。MigrationSourceV6记录sourceSchemaVersion=5、sourceSceneId/sourceRevision、sourceHash、migratorVersion、migratedAt及确切original Blob，可携带previousSource原v5来源链；逐级验证原件/来源真实关系，原仓库当前及全部旧历史保持。新室外身份从迁移边界创建，不给旧v5快照补造出生或拓扑令牌。失败、取消、原件不匹配和预算不足保留现有工程；旧版需经各自显式完整迁移步骤，不能将旧对象强制视为新信封。

本地迁移原件由独立仓库保存，当前工程/历史便携包不携带本地原件；完整包携带其明确选择的当前与命名/保护内容及联合资源闭包。离线导入、另存副本与快照恢复保留对应身份来源或新场景关系，不能把另一lineage同ID拼接为恢复来源。

v6继续串行自动保存与expectedPersistedRevision同事务比较；保护点使用真实checkpoint、来源快照hash和metadataVersion CAS，成功保护后才核基线并一次采用。采用前取消/冲突不改当前文档和undo，已落盘保护点可明确保留；采用后保存失败保留新内存文档、可用撤销、保护点和旧持久分支，提供导出/另存副本。入库已准备候选仍限固定目录/资源追加，不能借候选绕过有限命令、锁、当前身份或私密性。

地形/散布恢复按实际快照保存的实体与人工记录执行；重开可恢复的身份范围、拒绝的拓扑及C2会话建筑限制均按04显示。原始13/17–30及各自证据不覆写，C4实际运行与限制见[31](31-m1c-c4-validation.md)。正式性能、真实配额耗尽、跨浏览器和完整SCN场景仍以独立实测为准。


## M1-D 海岸哨所首批（2026-10-23）

混合样板与v6空白新增素材沿用完整原生v6工程和独立仓库；直接新建不伪造迁移原件链。场景/固定源与非活动资源、实际PNG、许可、持续层规则和identity3必须完整保存，v3视图仅供领域/渲染。显示设置通过同一事务保存、撤销与单调revision，不缩放毫米实体。完整包、明确所选命名/保护历史包、独立空库离线导入、重开及保护恢复证据归[35](35-m1d-outpost-validation.md)；不等同PWA断网冷启动、真实配额耗尽或新的性能门。旧报告13/17–34及其原始证据保持。

## U1统一发现与U2个人素材库备份（U1a已实现，U2计划）

本节保留U1/U2阶段PRD-034—037的准备与实施历史，实施先后与当时准备退出条件见[37](37-workspace-and-asset-library-handoff.md)，[36](36-workspace-and-asset-library-proposal.md)保留讨论。U1a当时实现/验证见38；U2在该准备节点只冻结职责，随后40/41定稿旧目录及备份。现行M2-0新库/新载体/新备份以本页开头为准，51/52记录实现检查；不将以下旧v6阶段描述当作新主路径仍使用旧写入器。

### U1a：发现旧工程，安全打开一个当前工程

U1a已统一发现六个既有仓库，以“仓库＋sceneId”识别条目，名称仅用于显示。查看最近工程或切模块不触发迁移；打开旧工程须明确选择完整副本升级，保留原仓库工程、旧历史及已有来源链。继续编辑同一会话不重建工程或撤销栈，实际打开/导入/切换才沿现有规则处理连续性证明。

最近列表命中当前“仓库＋sceneId”时默认走Continue，不调用install/reset；显式“重新载入”才属于真实打开。旧深链接/原生编辑入口也通过统一离开守卫，访问其他原生工程算真实切换/兼容访问，不并存第二个活跃会话，不误保留旧v6的C2 witness。回首页前先明确结束冲突草稿/候选，安全首页往返沿用共同会话，不把仍待采用候选藏到首页或重新注册为新基线。

切工程先处理当前待审阅候选的采用/明确取消，再保存并保全当前分支；随后在隔离候选中准备、完整校验和保存目标，成功后才激活。当前保存失败或CAS冲突阻止丢弃离开，保留重试、导出和另存副本入口。准备失败、取消或迟到异步结果不能替换当前内容、丢失撤销/草稿，不能用返回页面重新授予旧候选基线。浏览器返回与离开也须有明确防丢处理，不能仅依赖应用内按钮或在unload时补关键写入。布局偏好独立本机保存，损坏可重置；浏览器重载的保证仍限已持久化工程，不新增会话状态存档。

### U2：三种可携带内容分别标明

| 内容 | 携带范围与边界 |
|---|---|
| 现有完整工程／明确所选历史包 | 沿用当前严格格式和已采用内容的联合闭包；包含必要固定定义、成员、源/派生实际字节及许可，不自动附带个人全库标签/颜色/收藏或本地迁移原件 |
| 计划中的完整素材库备份 | 携带用户明确选择的组织记录及对应固定定义、完整组合外观模板/成员、源祖先与非活动派生保全根、实际资产与许可闭包；须可独立校验并离线采用，具体格式与预算由U2a冻结 |
| 可选的仅组织清单 | 若U2a决定提供，须明确标为“仅组织数据”，不含资源时不能宣称完整库备份或离线可采用；目标库缺固定来源时的保留/提示/关联规则先冻结 |

三个目录范围的名称、缩略图、个人组织和完整库备份均属GM编辑数据，个人标签还可能包含私密用途或线索。库备份和组织清单均由用户明确选择分享范围，不进入玩家PNG或其元数据。工程完整导出仍以工程采用闭包为准，不能用目录URL、缩略图或个人库安装记录替代实际资源。现有本地迁移原件及所选历史的携带边界继续沿各版本合同，不因新目录自动扩包。

目录浏览计划只读取有界索引与缩略图；固定来源是否已安装、缺图片、缺许可或不可嵌入须可区分，浏览成功不能冒充可离线采用。采用时复制并校验完整固定定义、模板成员、来源祖先、实际字节与确切许可；派生像素、当前资源/文档预算、身份冲突、依赖、锁和工程CAS均按现有入口执行，再以有限事务采用。不能借目录入库候选修改当前实体、身份或私密性，也不能自动拆批绕过256展开预算。取消或任一资源失败不生成可采用的半套定义或工程。离线保证针对已完整安装或随包携带的素材，不等同PWA断网冷启动。

组合闭包须逐项携带`prefabAppearanceTemplates.visibility`、成员source/adjustments、完整来源祖先，以及非活动派生保全定义根及对应实际字节/确切许可。不能只搬`PrefabDefinition`后在缺少原私密实例的目标重新同步模板；本工程显式存入“我的素材”、库备份恢复、再在新公开Floor放置，都须保留固定模板的有效私密性。仅浏览本工程不自动推广个人库，也不自动收录整个工程或其历史。上述链路归QA-CAT-03/04/05及既有玩家投影回归，尚待真实验证。

“内置／我的／本工程”不共享可变定义。个人组织修订与工程revision独立；同固定身份不同内容必须作为冲突处理，不按文件名或目录优先级静默覆盖。U2a须明确本地组织CAS、完整安装状态、可见提交时点和导入合并规则，资源跨存储边界时不能假称一个IndexedDB事务涵盖全部仓库。导入在隔离候选完成严格格式、字节/hash、许可、闭包和预算校验；失败/取消/并发冲突须保留既有库、当前工程和可恢复的用户整理，具体恢复与重试状态在写入器之前冻结。

删除目录条目或个人组织不改变工程内固定定义，不能联动删除仍被当前工程、其他工程、命名/保护历史、来源链或非活动保全定义引用的资源。缩略图缓存与这些依赖根分开；“画布无实例”不构成回收证明。任何数据归档/回收另列任务并核对完整引用，本次没有清理或删除。新建工程当前预装定义的行为保持到U2采用支持显式调整，不能提前改成仅存引用的工程。

U2a的精确数据责任分工见[04](04-scene-document.md)末节；素材展示/标注与生产记录见[14](14-visual-and-asset-system.md)、[15](15-m1a-asset-production-list.md)。计划验证包括QA-CAT-02个人组织隔离、03采用与离线闭包、04备份/冲突/原子失败、05资源/许可/删除保护，以及QA-WS-01/05/06；具体用例归[09](09-quality-plan.md)，U2准备未运行其产品测试、浏览器或构建；本轮U1a的实际运行独立归38，不外推旧仓库结果为新目录已通过。

U1a实际读取通过既有六数据库的只读事务完成：缺库探测中止升级，不创建新库；坏摘要逐行诊断，未知数据库结构独立诊断。打开时按当前修订读取完整资源/许可绑定、来源链和适用历史元数据，调用各版完整校验/hash及既有迁移器。旧原件链按确切字节保留；原生当前修订的迁移原件是在读取后生成的完整序列化包，不把此前某次未入库导出的ZIP时间戳当作原生存档内容。旧历史留旧库，完整文件导入沿原有独立副本及明确历史选择规则。实际证据与取消/失败边界归[38](38-u1a-workspace-validation.md)。


U1b界面记录使用独立localStorage键`sceneweave:workspace-layout:v1`，仅含version=1、resourcesWidth/detailsWidth和三项Collapsed布尔值。非法/旧版本回默认，访问/写入失败降级为本次会话。它不属于完整v6工程、历史或素材库备份，不改工程revision/undo/资源/CAS，实际边界见[39](39-u1b-layout-validation.md)。

### U2a 独立目录 v1 冻结合同（2026-10-23）

U2a精确身份、组织字段/限额、目录CAS、实际固定闭包及完整库备份的执行合同已在新写入器前冻结，见[40](40-u2a-catalog-contract.md)。本合同是本主题的补充主定义；严格工程v6/identity3/appearance1与有效v3保持。后续实现和本批简单检查归41，完整回归待用户通知。原“U2a待定稿”描述保留准备背景，当前以40的固定合同为准。

### 内容补标与精修边界（2026-10-23）

只读curation v1索引按确切目录内容身份关联，补充标签/人工颜色不改CatalogItem、DB、备份或工程格式；新题材与精修用独立固定定义与实际完整资源采用，旧空白预装与旧工程保留。精确范围和角色见[42](42-content-and-m1d-continuation.md)，实际结果另归43。
