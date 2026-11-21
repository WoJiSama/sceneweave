import { useEffect, useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { BoundsMm, SceneDocument } from '../../shared/model/scene'
import { resolveFloorOutput } from '../../shared/floors/output'
import { formatDistanceMm } from '../native-canvas/building-session'
import { NumberInput } from '../native-canvas/controls'

type Props = {
  scene: SceneDocument
  floorId: string
  disabled: boolean
  onPreview: (commands: SceneCommand[], description: string) => void
  onDraftChange?: (dirty: boolean) => void
}

const sameBounds = (a: BoundsMm, b: BoundsMm) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** World/export settings have their own draft and scope, independent of building tools. */
export default function SceneBoundsPanel({ scene, floorId, disabled, onPreview, onDraftChange }: Props) {
  const floor = scene.floors[floorId]
  const storedWorld = floor?.boundsMm ?? scene.exportBoundsMm
  const storedExport = floor ? resolveFloorOutput(scene, floorId).boundsMm : scene.exportBoundsMm
  const [world, setWorld] = useState(storedWorld)
  const [exportBounds, setExportBounds] = useState(storedExport)
  const [exportWholeMap, setExportWholeMap] = useState(() => sameBounds(storedWorld, storedExport))
  useEffect(() => {
    setWorld(storedWorld)
    setExportBounds(storedExport)
    setExportWholeMap(sameBounds(storedWorld, storedExport))
  }, [scene.sceneId, scene.revision, floorId])
  const output = exportWholeMap ? world : exportBounds
  const format = (mm: number) => formatDistanceMm(mm, scene.units.display)
  return <details className="building-details scene-bounds-settings">
    <summary>世界与导出范围</summary>
    <p className="asset-muted">{floor?.name ?? '请先选择楼层'} · 世界范围决定可编辑区域，导出范围决定 PNG 取景。</p>
    <fieldset disabled={disabled || !floor}>
      <h3>世界范围</h3>
      {(['x', 'y', 'width', 'height'] as const).map((key, index) => <NumberInput key={key} displayUnit={scene.units.display}
        label={['世界起点 X', '世界起点 Y', '世界宽度', '世界高度'][index]} value={world[key]}
        onCommit={value => { setWorld(current => ({ ...current, [key]: value })); onDraftChange?.(true) }}/>) }
      <h3>导出范围</h3>
      <label className="building-check"><input type="checkbox" checked={exportWholeMap} onChange={event => {
        setExportWholeMap(event.target.checked)
        if (!sameBounds(world, exportBounds)) onDraftChange?.(true)
      }}/>导出整张地图</label>
      {exportWholeMap ? <p className="asset-muted" aria-live="polite">PNG 随世界范围更新 · {format(world.width)} × {format(world.height)}</p> : (['x', 'y', 'width', 'height'] as const).map((key, index) => <NumberInput key={key} displayUnit={scene.units.display}
        label={['导出起点 X', '导出起点 Y', '导出宽度', '导出高度'][index]} value={exportBounds[key]}
        onCommit={value => { setExportBounds(current => ({ ...current, [key]: value })); onDraftChange?.(true) }}/>) }
      <button type="button" className="secondary asset-wide" onClick={() => onPreview([
        { type: 'setCanvasBounds', floorId, floorBoundsMm: world, exportBoundsMm: output },
      ], exportWholeMap ? '调整地图范围并导出整张地图' : '调整地图范围与 PNG 取景')}>预览画布范围</button>
    </fieldset>
  </details>
}
