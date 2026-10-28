# 墨绘原野 · 海岸哨所原创候选

这是 SCN-04「海岸哨所」追加的1种材质和5类物件，目录包为 `sceneweave-handdrawn-outpost@1`，主题沿用 `sceneweave-handdrawn@1`。来源为 **O / 项目原创**，状态为 **P2 待验收**。本包不代表用户美术签收、完整主题P3、SCN-04验收或完整M1通过；帐篷用于营地预演，不是SCN-04必需内容。

SVG由Sceneweave contributors以Codex辅助原创编写，保留可编辑源文件与[构建脚本](../../tools/build-outpost-art.mjs)。没有描摹或嵌入参考截图、第三方图包、字体、商业规则内容，也没有调用图像生成服务。全部原创图稿与脚本按项目[MIT许可原文](LICENSE.txt)提供，逐项真实SHA-256、字节数、像素尺寸、毫米映射、alpha范围与占地见[manifest](manifest.json)。室内和室外旧包保持独立。

| 目录ID | 内容 / 实际PNG | 默认语义 | 最小透明留白 |
|---|---|---|---:|
| `material.sw.dirt-gravel` | 2000×2000 mm土砾单元 / 512×512 px | terrain/path材质；石子不产生碰撞 | 全不透明 |
| `prop.sw.crate` | 绑带木箱 / 320×320 px | 移动阻挡；furniture阴影 | 38 px |
| `prop.sw.supply-rack` | 俯视敞口补给木架 / 384×704 px | 移动阻挡；furniture阴影 | 51 px |
| `prop.sw.campfire` | 石圈、木柴与短焰 / 448×448 px | 非阻挡装饰；none阴影 | 44 px |
| `prop.sw.lamp-stand` | 俯视旧铜灯架 / 256×256 px | 移动阻挡；furniture阴影 | 52 px |
| `prop.sw.tent` | 帆布、缝线与短绳 / 832×704 px | 移动阻挡；furniture阴影 | 45 px |

物件均不默认阻挡视线，实际占地和中心偏移由manifest明确声明，不能按PNG、透明区或投影反推。营火与灯架没有自动危险、伤害、照明或VTT光源；需要这些语义时由场景明确建立。帐篷是单件物件，不能进入内部，也不创建房间或楼层。源图没有烘焙长投影，装饰阴影由场景主题在受众过滤后生成。

在仓库根目录执行：

```sh
node tools/build-outpost-art.mjs
```

脚本使用项目已有Playwright及已安装Chrome，把SVG绘制到原生sRGB Canvas，读取RGBA并清零alpha=0像素的RGB，再用Node编码PNG。PNG仅含IHDR、sRGB、IDAT、IEND块，为8-bit RGBA、straight alpha；源密度为256 px/m。土砾的纹理跨边平移重复，所有物件至少保留8源像素全透明边。Chrome抗锯齿版本可能影响字节，重建后须核对manifest和实际画面，不能用新字节无声改义已采用的固定版本。

加 `--preview` 可另在忽略目录 `work/m1d-outpost-art-review.png` 生成候选总览和2×2、3×3土砾拼接图，预览标签不写入素材。2026-10-23首次技术检查使用Node v24.14.1、Chrome 156.0.8078.47：6项PNG/SVG hash与PNG CRC、尺寸、RGBA、alpha范围/透明RGB和两份MIT复制均已逐项核对；土砾完全不透明，物件最小透明留白如上。人工已查看总览与2×2/3×3拼接，未见明显矩形接缝；混合场景中的尺度、编辑往返、玩家秘密与正式美术仍按后续场景验证记录。

源目录保存SVG、manifest、许可和本说明；静态分发目录 `public/assets/sceneweave-handdrawn-outpost/` 保存6张PNG及相同manifest/许可。工程应携带实际字节、固定定义、完整实例和许可绑定，重开不依赖目录网络。详细制作规格见[15制作清单](../../docs/14-visual-and-assets.md#doc-15)，风格、光照和范围分离见[14视觉规范](../../docs/14-visual-and-assets.md#doc-14)。
