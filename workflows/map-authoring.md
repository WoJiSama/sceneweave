# 通用助手制图

## start
户外参考图用 `map reference --stage draft`，或给 `sceneweave_map_reference` 传 `stage: "draft"`。只标背景取样、用户点名的地貌与通路。程序返回可编辑草稿、叠图和可复用的生成请求。文字题可用对应的可运行示例。

纯文字山地可用 `landscape`。用 `interior` 表达房间用途、面积和相邻关系，用 `forest` 指定入口和空地，也可选火山、混合、岩岛或海岸示例。需要精确对象坐标时可用 `layout` 或追加 `operations`。

在 `landscape` 中，原图锚点用 `referenceSizePx` 声明宽高，程序等比映射。已知图中两点距离时可用 `referenceScale`。纯文字制图的配方位置与半径用每轴 0–1000 的相对坐标。净宽、高程和绕行距离用毫米。山路可给起终点和 `around: { landmarkId, side }`，其中 `side` 为 `north`、`east`、`south` 或 `west`。程序用真实净宽带筛选走向并计算坡面、平台和踏步。已知确切途经点时可以提供 `via`。

山脚到山顶使用 `ascent: { from: { at, radius }, toLandmarkId, minRiseMm }`，可加 `around` 指定一侧。程序按实际岸线、坡度和道路净宽选落脚点，保存后检查两端接入与高差。允许收窄时才填 `minWidthMm`，回执列出首选、下限和实际净宽。有成段梯面时可设 `ascent.staircase: "flight"`。用 `map example landscape-ascent` 查看完整输入。已知固定途经点时用 `via`。

`finish: "natural"` 按坡面安排岸浪、岩面、地被和坡脚碎石，保护低地中的局部凸起。参考图能识别连续的草地颜色和部分浓密林丛，再生成为可编辑布景。特殊凸起可设 `preserveRelief: true`，有取景要求时再用 `covers` 和 `scenery` 局部调整。需要额外保留的步行走廊写入 `checks`。

## reference
用 `map capabilities` 的 `referenceGuide` 查看简短例子。将示例坐标替换为原图整数像素。`map reference --image ABS_IMAGE --input ABS_GUIDE_JSON --output NEW_ABS_DIR --allow map-authoring --stage draft` 接受本地静态 PNG、JPEG 或 WebP。用 `design.landforms` 标主要高低和地貌，用 `design.ascents` 填出发区、目标地标和绕行方向。默认由程序选半径。需要只看轮廓时省略 `--stage`。

在 `background` 点水面或背景，`foreground` 点代表性的陆地颜色，`keep` 保留局部小陆地，`omit` 忽略噪点。先看首图和 `overlay.png`。背景取样可疑、窄接缝和无效设计标记会在叠图中编号。只需改局部时可用返回的 `correction`，或添加 `corrections` 笔画。用 `surfaceFromReference: false` 关闭按参考图识别植被。网页「生成 → 参考图地形」提供同样的取样、补画、比例和地貌设置。MCP 可用 `sceneweave_map_preview` 的 `view: "overlay"` 查看叠图。

## diagnose
有结构问题时，用 `map diagnose --input ABS_JSON --allow map-authoring` 或 `sceneweave_map_diagnose` 检查轮廓、路线和地标。结果标出入水、转角冲突或挖填位置。需要完整地形和道路坐标时，用 `--geometry full` 或 MCP 的 `geometry: true`。页面入口是「只检查几何」。

## generate
文字题或已有完整请求时用 `map generate --stage draft`，或给 `sceneweave_map_generate` 传 `stage: "draft"`。新目录先写真实工程和 `preview.png`，`topReadyAt` 表示可以先看正俯视。要同时检查高差可传 `oblique: true`，有地形高差时也会默认出 `oblique.png`。MCP 的 `includePreview: true` 可把实际 PNG 随回执返回。

先看用户点名的构图和通路。回执记录实际画风、比例、通行结果、地标中心与邻域高程。有可定位的问题时，打开 `diagnostic.png`，图片编号对应回执中的 `diagnosticMarkers`。MCP 可用 `sceneweave_map_preview` 的 `view: "diagnostic"` 和 `draft: true` 查看。自动绕行失败时，CLI、MCP 和参考图页面都保留能够生成的地形预览并标出原因。必需检查通过后可正式复核并保存。

## revise
在 `map inspect` 或 `sceneweave_map_inspect` 查找公开对象和工程摘要。把 `projectHash`、楼层和修改交给 `map edit` 或 `sceneweave_map_edit`。用 `path-update` 加 `around` 改现有自动道路的一侧。用 `terrain-shape` 调起伏，`cover-zone` 铺地表，`scenery-zone` 布置林木、灌草或碎石，`scenery-density` 调已有组。换画风用同一工程提交 `art-style`，页面可在草稿上直接切换。编辑默认使用毫米。

编辑时带上额外需要满足的 `checks` 和 `heightChecks`。原生成请求声明的登高关系在生成候选复核时按实际路线检查。草稿中某条自动道路尚未生成时，可调整原请求的出发区、绕行侧或净宽再出候选。相邻场景与旧候选留在各自目录。

## deliver
画面可用后，用 `map verify --candidate ABS_DIR --output NEW_ABS_DIR --allow map-authoring --editor reopen`，或给 `sceneweave_map_verify` 传 `editor: true`。读取 `result.json` 的 `status: complete`、实际通路结果和重开记录。交付时显示真实预览和可编辑工程。可用返回的 `delivery.markdown`，MCP 也可传 `includePreview: true` 返回同一张已复核 PNG。先保存可交付版本，再做可选细化。

如果已写出图和工程，复核遇到中断或像素差异，可对同一目录再次复核。通过 `error.phase` 和各视图记录查看具体失败位置。发现缺少斜俯视或图片本身损坏时，用 `map verify --previews redraw` 或 MCP 的 `previews: "redraw"` 从同一工程重绘并独立复核。若同一问题仍在，保留已满足验收的版本和具体差距。用户给了时间要求时，在约定时间内交付现有最完整的版本并说明未满足项。
