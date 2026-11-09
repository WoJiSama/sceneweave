import { ASSET_BATCH_LIMITS } from '../../platform/browser/assets/batch-source'

const template = {
  format: 'sceneweave-asset-pack', schemaVersion: 1,
  pack: { id: 'my-furniture', name: '我的家具', version: 1, style: '手绘', scenes: ['室内'] },
  licenses: [{ id: 'my-license', text: '请替换为这些图片实际适用的完整许可文本。', attribution: '请填写作者与实际来源。' }],
  items: [{ path: '木桌.png', name: '木桌', kind: 'prop', widthMm: 2000, heightMm: 1000,
    footprintWidthMm: 1800, footprintHeightMm: 800, rootAnchorMm: { x: 1000, y: 500 },
    blocksMovement: true, blocksSight: false, renderLayer: 'object', shadowClass: 'furniture',
    tags: ['桌子'], licenseId: 'my-license' }],
}
function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2) + '\n'], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'sceneweave-assets.json'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export default function AssetImportRequirements() {
  return <details className="asset-import-requirements"><summary>格式要求、命名与导入流程</summary>
    <p>支持静态 PNG、JPEG、WebP 和受限 SVG。透明物件优先 PNG；JPEG 没有透明背景。材质应能平铺；导入会保留实际像素、规范为 PNG 并移除图片元数据，不自动抠图、裁边或改变物理占地。</p>
    <p>单图片不超过20 MiB、最长边8192像素且不超过3200万像素；SVG不超过1 MiB，按固定处理器转为长边512像素。每批最多{ASSET_BATCH_LIMITS.assets}项、原文件累计64 MiB；ZIP最多64 MiB压缩、128 MiB展开、512条记录。工程剩余资源和事务预算仍单独核对。</p>
    <p>显示名优先使用你填写的名称或清单名称；默认仅从文件名去掉最后的扩展名。不翻译、不改下划线、不加编号，最多120个字符，超限会提示修改。同名素材可共存，按图片、来源和独立身份区分。</p>
    <p>图片宽高是映射到地图的实际尺寸；占地、根锚、阻挡和绘制层分别设置。名称叫“门”“桥”或“灯”不会自动创建门、可通行结构或光源。</p>
    <p>批量包可以包含一份 <code>sceneweave-assets.json</code>，按相对路径预填名称、尺寸、用途、标签、根锚与许可。清单只填草稿，仍需你确认嵌入权利并完成真实图片校验；不授予公共默认包审核状态。</p>
    <button type="button" className="secondary" onClick={downloadTemplate}>下载素材清单模板</button>
    <p>流程：选文件 → 确认名称与标定 → 校验并预览 → 一次采用到当前工程。采用后可在“当前工程”选择素材，保存到“我的素材”，再用素材库备份跨工程或设备携带。取消或失败不安装半批。</p>
  </details>
}
