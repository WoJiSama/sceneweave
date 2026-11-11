import { useEffect, useState } from 'react'
import type { SceneCommand } from '../../shared/commands/commands'
import type { SceneDocument } from '../../shared/model/scene'
import { NumberInput } from '../native-canvas/controls'

type Props = {
  scene: SceneDocument
  floorId: string
  disabled: boolean
  onPreview: (commands: SceneCommand[], description: string) => void
  onDraftChange?: (dirty: boolean) => void
}

/** World/export settings have their own draft and scope, independent of building tools. */
export default function SceneBoundsPanel({ scene, floorId, disabled, onPreview, onDraftChange }: Props) {
  const floor = scene.floors[floorId]
  const [world, setWorld] = useState(() => ({ ...(floor?.boundsMm ?? scene.exportBoundsMm) }))
  const [exportBounds, setExportBounds] = useState(() => ({ ...(floor?.outputBoundsMm ?? scene.exportBoundsMm) }))
  useEffect(() => {
    setWorld({ ...(scene.floors[floorId]?.boundsMm ?? scene.exportBoundsMm) })
    setExportBounds({ ...(floor?.outputBoundsMm ?? scene.exportBoundsMm) })
  }, [scene.sceneId, scene.revision, floorId])
  return <details className="building-details scene-bounds-settings">
    <summary>世界与导出范围</summary>
    <p className="asset-muted">世界范围 · {floor?.name ?? '未选择地面'}；须容纳真实墙厚。本楼层双受众共享固定导出范围，坐标可为负数。</p>
    <fieldset disabled={disabled || !floor}>
      <h3>世界范围</h3>
      {(['x', 'y', 'width', 'height'] as const).map((key, index) => <NumberInput key={key} displayUnit={scene.units.display}
        label={['世界起点 X', '世界起点 Y', '世界宽度', '世界高度'][index]} value={world[key]}
        onCommit={value => { setWorld(current => ({ ...current, [key]: value })); onDraftChange?.(true) }}/>) }
      <h3>导出范围</h3>
      {(['x', 'y', 'width', 'height'] as const).map((key, index) => <NumberInput key={key} displayUnit={scene.units.display}
        label={['导出起点 X', '导出起点 Y', '导出宽度', '导出高度'][index]} value={exportBounds[key]}
        onCommit={value => { setExportBounds(current => ({ ...current, [key]: value })); onDraftChange?.(true) }}/>) }
      <button type="button" className="secondary asset-wide" onClick={() => onPreview([
        { type: 'setCanvasBounds', floorId, floorBoundsMm: world, exportBoundsMm: exportBounds },
      ], '修改世界与固定导出范围')}>预览画布范围</button>
    </fieldset>
  </details>
}
