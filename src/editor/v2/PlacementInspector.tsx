import { Move, X } from 'lucide-react'
import type { PropV2, SceneDocumentV2, SurfaceRef } from '../../core/v2/types'
import { NumberInput } from './controls'

export default function PlacementInspector({ scene, prop, busy, ready, onChange, onPlace, onCancel }: {
  scene: SceneDocumentV2; prop: PropV2; busy: boolean; ready: boolean; onChange: (changes: Partial<Pick<PropV2, 'positionMm' | 'rotationDeg' | 'supportRef'>>) => void; onPlace: () => void; onCancel: () => void
}) {
  const definition = prop.definitionRef && scene.propDefinitions[prop.definitionRef.id]
  const surfaces: { ref: SurfaceRef; label: string }[] = [
    ...Object.values(scene.floors).map(floor => ({ ref: { kind: 'floor' as const, id: floor.id }, label: floor.name })),
    ...Object.values(scene.rooms).map(room => ({ ref: { kind: 'room' as const, id: room.id }, label: room.purpose || '房间' })),
    ...Object.values(scene.terrainAreas).map((area, index) => ({ ref: { kind: 'terrainArea' as const, id: area.id }, label: `地形 ${index + 1} · ${area.groundElevationMm} mm` })),
  ]
  return <><div className="asset-section-heading"><Move size={16}/><h2>放置物件</h2></div><h3>{definition ? definition.name : '物件'}</h3>
    <p className="asset-muted">移动鼠标预览，点击画布放置；也可输入坐标后确认。虚线显示图像范围与物理占地，Escape 取消。</p>
    <fieldset disabled={busy}>
      <NumberInput label="放置 X" value={prop.positionMm.x} onCommit={x => onChange({ positionMm: { ...prop.positionMm, x } })}/>
      <NumberInput label="放置 Y" value={prop.positionMm.y} onCommit={y => onChange({ positionMm: { ...prop.positionMm, y } })}/>
      <NumberInput label="放置旋转" value={prop.rotationDeg} unit="°" onCommit={rotationDeg => onChange({ rotationDeg })}/>
      <label className="asset-select">放置表面<select aria-label="放置表面" value={`${prop.supportRef.kind}:${prop.supportRef.id}`} onChange={event => {
        const surface = surfaces.find(value => `${value.ref.kind}:${value.ref.id}` === event.target.value)
        if (surface) onChange({ supportRef: surface.ref })
      }}>{surfaces.map(surface => <option key={`${surface.ref.kind}:${surface.ref.id}`} value={`${surface.ref.kind}:${surface.ref.id}`}>{surface.label}</option>)}</select></label>
      <button className="primary asset-wide" disabled={!ready} onClick={onPlace}>在此放置</button>
      {!ready && <p className="asset-muted" role="status">正在检查并解码待放置素材…</p>}
    </fieldset>
    <button className="secondary asset-wide" disabled={busy} onClick={onCancel}><X size={14}/>取消放置</button>
    <dl className="asset-facts"><dt>物理占地</dt><dd>{prop.footprintMm.width} × {prop.footprintMm.height} mm</dd><dt>图像范围</dt><dd>{prop.visualBoundsMm.width} × {prop.visualBoundsMm.height} mm</dd></dl>
  </>
}
