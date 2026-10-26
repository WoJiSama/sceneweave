import { useState } from 'react'
import type { SceneDocument, SurfaceStyle } from '../../shared/model/scene'
import type { AppearanceGraph } from '../../shared/model/appearance'
import type { SceneCommand } from '../../shared/commands/commands'
import { surfaceStyle } from '../../shared/appearance/graph'
import { newId } from './runtime'

const collections = { room: 'rooms', terrainArea: 'terrainAreas', wall: 'walls', path: 'paths', terrainEdge: 'terrainEdges', terrainConnection: 'terrainConnections' } as const
const names = { room: '房间', terrainArea: '地形', wall: '墙面', path: '道路', terrainEdge: '边缘', terrainConnection: '台阶/坡道' }
type Kind = keyof typeof collections
export default function VisualSurfacePanel({ scene, appearance, selectedIds, onPreview }: {
  scene: SceneDocument; appearance: AppearanceGraph; selectedIds: readonly string[]; onPreview: (commands: SceneCommand[], label: string) => void
}) {
  const [target, setTarget] = useState<{ kind: Kind; id: string } | null>(null), [style, setStyle] = useState<SurfaceStyle | null>(null)
  const materials = Object.values(scene.materials)
  const paint = (id = materials[0]?.id) => ({ materialRef: { id, version: scene.materials[id].version }, tileSizeMm: { ...scene.materials[id].defaultTileSizeMm }, rotationDeg: 0, alignment: 'world' as const, originMm: { x: 0, y: 0 }, tint: null, opacity: 1 })
  const select = (id: string) => {
    const kind = (Object.keys(collections) as Kind[]).find(key => Object.hasOwn(scene[collections[key]], id))
    if (!kind) { setTarget(null); setStyle(null); return }
    const source = appearance.sources[appearance.surfaceSources[id]], saved = source?.kind === 'surface' ? source.snapshot : surfaceStyle(scene, id)
    setTarget({ kind, id }); setStyle(saved ? structuredClone(saved) : materials.length ? { base: paint(), overlays: [] } : null)
  }
  const numeric = (label: string, value: number, change: (value: number) => void, step = 1) => <label key={label}>{label}<input aria-label={`视觉${label}`} type="number" value={value} step={step} onChange={e => change(Number(e.target.value))}/></label>
  return <><p>按世界毫米设置铺装比例、方向和相位。覆盖层可柔化材质交界；源和可移除调整分别保留。</p>
    <button disabled={!selectedIds.some(id => (Object.values(collections)).some(key => Object.hasOwn(scene[key], id)))} onClick={() => select(selectedIds.find(id => Object.values(collections).some(key => Object.hasOwn(scene[key], id)))!)}>使用选中的表面</button>
    <label>铺装对象<select aria-label="视觉铺装对象" value={target?.id ?? ''} onChange={e => select(e.target.value)}><option value="">选择对象</option>{(Object.keys(collections) as Kind[]).flatMap(kind => Object.values(scene[collections[kind]]).map(entity => <option key={entity.id} value={entity.id}>{names[kind]} · {entity.id}</option>))}</select></label>
    {style && target && <><label>底材<select aria-label="视觉铺装底材" value={style.base.materialRef.id} onChange={e => setStyle({ ...style, base: { ...style.base, materialRef: { id: e.target.value, version: scene.materials[e.target.value].version } } })}>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <div className="visual-pair">{numeric('纹理宽 mm', style.base.tileSizeMm.width, v => setStyle({ ...style, base: { ...style.base, tileSizeMm: { ...style.base.tileSizeMm, width: v } } }))}{numeric('纹理高 mm', style.base.tileSizeMm.height, v => setStyle({ ...style, base: { ...style.base, tileSizeMm: { ...style.base.tileSizeMm, height: v } } }))}</div>
      {numeric('纹理方向 °', style.base.rotationDeg, v => setStyle({ ...style, base: { ...style.base, rotationDeg: v } }))}
      <label>对齐<select value={style.base.alignment} onChange={e => setStyle({ ...style, base: { ...style.base, alignment: e.target.value as 'world' | 'surface' } })}><option value="world">世界坐标（邻面保持相位）</option><option value="surface">表面坐标</option></select></label>
      <div className="visual-pair">{numeric('纹理原点X mm', style.base.originMm.x, v => setStyle({ ...style, base: { ...style.base, originMm: { ...style.base.originMm, x: v } } }))}{numeric('纹理原点Y mm', style.base.originMm.y, v => setStyle({ ...style, base: { ...style.base, originMm: { ...style.base.originMm, y: v } } }))}</div>
      <details><summary>局部材质覆盖 · {style.overlays.length}</summary>{style.overlays.map((overlay, index) => <div key={overlay.id} className="visual-segment"><strong>覆盖 {index + 1}</strong><label>材质<select value={overlay.paint.materialRef.id} onChange={e => setStyle({ ...style, overlays: style.overlays.map((v, i) => i === index ? { ...v, paint: { ...v.paint, materialRef: { id: e.target.value, version: scene.materials[e.target.value].version } } } : v) })}>{materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>{numeric(`覆盖${index+1}羽化 mm`, overlay.blendWidthMm, v => setStyle({ ...style, overlays: style.overlays.map((o,i) => i === index ? { ...o, blendWidthMm: v } : o) }))}{numeric(`覆盖${index+1}透明度`, overlay.paint.opacity, v => setStyle({ ...style, overlays: style.overlays.map((o,i) => i === index ? { ...o, paint: { ...o.paint, opacity: v } } : o) }), .05)}{overlay.boundaryMm.map((point, row) => <div key={row} className="visual-pair">{(['x','y'] as const).map(axis => numeric(`覆盖${index+1}点${row+1}${axis}`, point[axis], v => setStyle({ ...style, overlays: style.overlays.map((o,i) => i === index ? { ...o, boundaryMm: o.boundaryMm.map((p,j) => j === row ? { ...p, [axis]: v } : p) } : o) })))}</div>)}<button onClick={() => setStyle({ ...style, overlays: style.overlays.filter((_,i) => i !== index) })}>移除此覆盖</button></div>)}<button disabled={style.overlays.length >= 8} onClick={() => {
        const bounds = scene.floors[scene[collections[target.kind]][target.id].floorId].boundsMm
        const x = Math.round(bounds.x + bounds.width * .35), y = Math.round(bounds.y + bounds.height * .35), width = Math.round(bounds.width * .3), height = Math.round(bounds.height * .3)
        setStyle({ ...style, overlays: [...style.overlays, { id: newId(), boundaryMm: [{x,y},{x:x+width,y},{x:x+width,y:y+height},{x,y:y+height}], paint: paint(style.base.materialRef.id), blendWidthMm: 250, renderOrder: style.overlays.length }] })
      }}>添加明确局部覆盖</button></details>
      <button className="primary asset-wide" onClick={() => onPreview([{ type: 'setVisualSurface', kind: target.kind, id: target.id, style }], '调整材质比例、方向与局部覆盖')}>预览铺装</button>
    </>}
  </>
}
