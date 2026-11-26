# 通用助手制图

## start
有参考图的户外地图从 `node tools/harness/sceneweave.mjs map example landscape-reference` 开始。本机 MCP 用 `sceneweave_map_example` 的 `landscape-reference`。用主要岸角、海湾、地标和路线两端做出首图。天然边界可选 `outline: "smooth"`，程序保留岸角及共享边。首版先看主要构图与通行关系，再按实际画面补需要的细节。

纯文字山地可用 `landscape`。用 `interior` 表达房间用途、面积和相邻关系，用 `forest` 指定入口和空地，也可选火山、混合、岩岛或海岸示例。需要精确对象坐标时可用 `layout` 或追加 `operations`。

在 `landscape` 中，原图锚点用 `referenceSizePx` 声明宽高，程序等比映射。已知图中两点距离时可用 `referenceScale`。纯文字制图的配方位置与半径用每轴 0–1000 的相对坐标。净宽、高程和绕行距离用毫米。山路可给起终点和 `around: { landmarkId, side }`，其中 `side` 为 `north`、`east`、`south` 或 `west`。程序用真实净宽带筛选走向并计算坡面、平台和踏步。已知确切途经点时可以提供 `via`。

低地里需要保留的山丘、岩块或台地可设 `preserveRelief: true`。用 `covers` 单独铺草、沙和裸岩。布景区可选 `pattern: "meadow"` 留开阔处，或 `"grove"` 布置较密林丛。必要的步行走廊写入 `checks`，布景会预留完整净宽。需要确认实际高差时，`heightChecks` 接受低点、高点和最小高差。

## generate
CLI 调用 `map generate --stage draft`，MCP 给 `sceneweave_map_generate` 传 `stage: "draft"`。在新目录生成真实工程和 `preview.png`。要同时检查高差可传 `oblique: true`，有地形高差时也会默认出 `oblique.png`。本机 MCP 用 `sceneweave_map_preview` 加 `draft: true` 查看草稿。

先看用户点名的构图和通路。回执记录实际画风、比例、通行结果、地标中心与邻域高程。有可定位的问题时，打开 `diagnostic.png`，图片编号对应回执中的 `diagnosticMarkers`。MCP 可用 `sceneweave_map_preview` 的 `view: "diagnostic"` 和 `draft: true` 查看。自动绕行失败时，草稿保留能够生成的地形和图像，回执指出指定侧和净宽。必需检查失败时须修正候选才能完成正式复核。

## revise
在 `map inspect` 或 `sceneweave_map_inspect` 查找公开对象和工程摘要。把 `projectHash`、楼层和修改交给 `map edit` 或 `sceneweave_map_edit`。用 `path-update` 加 `around` 改现有自动道路的一侧。用 `terrain-shape` 调起伏，`cover-zone` 铺地表，`scenery-zone` 布置林木、灌草或碎石，`scenery-density` 调已有组。画风对照可对同一工程单独提交一次 `art-style`，从回执查看生效画风。编辑默认使用毫米。

编辑时带上仍需满足的 `checks` 和 `heightChecks`。若路径改了位置，更新相应检查点。草稿中某条自动道路尚未生成时，可调整原请求再出候选。相邻场景与旧候选留在各自目录。

## deliver
画面可用后，用 `map verify --candidate ABS_DIR --output NEW_ABS_DIR --allow map-authoring` 或 `sceneweave_map_verify` 复核落盘的工程和图片。用 CLI 的 `--editor reopen` 或 MCP 的 `editor: true` 同时走普通首页导入、保存和视图检查。读取 `result.json` 的 `status: complete` 与实际检查结果。先保留可交付的版本，再做可选细化。

如果已写出图和工程，复核遇到中断或像素差异，可对同一目录再次复核。通过 `error.phase` 和各视图记录查看具体失败位置。发现缺少斜俯视或图片本身损坏时，用 `map verify --previews redraw` 或 MCP 的 `previews: "redraw"` 从同一工程重绘并独立复核。若同一问题仍在，保留已满足验收的版本和具体差距。用户给了时间要求时，在约定时间内交付现有最完整的版本并说明未满足项。
