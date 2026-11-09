export type AssetSurface = 'room' | 'wall' | 'terrain' | 'path'
export interface AssetSemanticsValues {
  kind: 'prop' | 'material'
  renderLayer: 'ground' | 'object' | 'canopy'
  shadowClass: 'none' | 'furniture' | 'vegetation'
  offsetX: string
  offsetY: string
  applicableSurfaces: AssetSurface[]
}
export const defaultAssetSemantics = (): Omit<AssetSemanticsValues, 'kind'> => ({
  renderLayer: 'object', shadowClass: 'furniture', offsetX: '0', offsetY: '0',
  applicableSurfaces: ['room', 'wall', 'terrain', 'path'],
})

export default function AssetSemanticsFields({ value, onChange, prefix }: {
  value: AssetSemanticsValues; onChange: (patch: Partial<AssetSemanticsValues>) => void; prefix: string
}) {
  if (value.kind === 'material') return <div className="asset-material-surfaces">
    <p>允许应用的表面（至少选择一种）</p>
    {([['room', '房间地面'], ['wall', '墙面'], ['terrain', '地形'], ['path', '道路']] as const).map(([id, name]) =>
      <label className="composition-check" key={id}><input type="checkbox" aria-label={`${prefix}适用${name}`}
        checked={value.applicableSurfaces.includes(id)} onChange={event => onChange({ applicableSurfaces: event.target.checked
          ? [...value.applicableSurfaces, id] : value.applicableSurfaces.filter(surface => surface !== id) })}/>{name}</label>)}
    <small>铺装尺寸表示一次平铺的世界大小。材质图片不改变高程、通行或墙体结构。</small>
  </div>
  return <>
    <div className="composition-fields"><label>占地偏移 X mm<input aria-label={`${prefix}占地偏移X毫米`} type="number" step="1" value={value.offsetX} onChange={event => onChange({ offsetX: event.target.value })}/></label>
      <label>占地偏移 Y mm<input aria-label={`${prefix}占地偏移Y毫米`} type="number" step="1" value={value.offsetY} onChange={event => onChange({ offsetY: event.target.value })}/></label></div>
    <small>占地中心相对物件落点的偏移；透明边缘不会自动参与碰撞。</small>
    <label>绘制层<select aria-label={`${prefix}绘制层`} value={value.renderLayer} onChange={event => onChange({ renderLayer: event.target.value as AssetSemanticsValues['renderLayer'] })}><option value="ground">地面装饰</option><option value="object">普通物件</option><option value="canopy">冠层</option></select></label>
    <label>阴影类别<select aria-label={`${prefix}阴影类别`} value={value.shadowClass} onChange={event => onChange({ shadowClass: event.target.value as AssetSemanticsValues['shadowClass'] })}><option value="none">无阴影</option><option value="furniture">家具与设施</option><option value="vegetation">植被</option></select></label>
  </>
}
