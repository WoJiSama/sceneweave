import { useState } from 'react'
import { Route } from 'lucide-react'
import { checkTerrainTravel } from '../../shared/geometry/terrain-travel'
import type { SceneDocument } from '../../shared/model/scene'

export default function TerrainTravelPanel({ scene, disabled }: { scene: SceneDocument; disabled: boolean }) {
  const [result, setResult] = useState<{ sceneId: string; revision: number; text: string; ok: boolean } | null>(null)
  const check = (stairs: boolean) => {
    const connection = scene.terrainConnections['island-stairs']
    const from = connection?.from.positionMm ?? { x: 12500, y: 10000 }, to = connection?.to.positionMm ?? { x: 15500, y: 10000 }
    const response = checkTerrainTravel(scene, { floorId: 'island-floor', from: stairs ? from : { ...from, y: 7000 }, to: stairs ? to : { ...to, y: 7000 }, widthMm: 2000 })
    setResult({ sceneId: scene.sceneId, revision: scene.revision, ok: response.ok, text: response.ok ? '这条 2 m 宽的直线走廊可通行。' : response.issues.map(issue => issue.message).join('；') })
  }
  return <div className="asset-travel-panel"><h3><Route size={14}/> 局部通行检查</h3><p className="asset-muted">检查样板两处直线走廊的地面、高差和占地。</p><div><button className="secondary" disabled={disabled} onClick={() => check(true)}>检查台阶通路</button><button className="secondary" disabled={disabled} onClick={() => check(false)}>检查崖边直行</button></div>{result?.sceneId === scene.sceneId && result.revision === scene.revision && <p role="status" className={result.ok ? 'asset-travel-ok' : 'asset-travel-blocked'}>{result.text}</p>}</div>
}
