import type { SceneDocument } from '../../shared/model/scene.js'
import type { PlayerCoverageIssue } from '../../shared/projection/projection.js'
import { resolveFloorOutput } from '../../shared/floors/output.js'
import { createEntityLabeler } from './entity-label.js'
import { formatDistanceMm } from '../native-canvas/building-session.js'

export default function PrivacyCoverageNotice({ scene, issues, onRepair, disabled = false, repaired = false }: {
  scene: SceneDocument; issues: readonly PlayerCoverageIssue[]; onRepair?: () => void; disabled?: boolean; repaired?: boolean
}) {
  if (!issues.length) return null
  const label = createEntityLabeler(scene), format = (value: number) => formatDistanceMm(value, scene.units.display)
  return <section className="building-details" aria-label="保密覆盖诊断">
    <h3>{repaired ? '候选已补齐这些范围' : '这些内容还没有被完整遮住'}</h3>
    <p className="asset-muted">{repaired ? '红色是本次候选补齐的范围，包含实际墙厚、图像和阴影；采用前请检查下方实际玩家图。' : '当前工程未修改，输入仍然保留。红色表示需要补齐的范围，包含实际墙厚、图像和阴影。'}</p>
    {[...new Set(issues.map(issue => issue.floorId))].map(floorId => {
      const bounds = resolveFloorOutput(scene, floorId).boundsMm, rows = issues.filter(issue => issue.floorId === floorId)
      return <div key={floorId}><strong>{scene.floors[floorId].name}</strong>
        <svg role="img" aria-label={`${scene.floors[floorId].name}缺少遮罩的具体范围`} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} style={{ width: '100%', maxHeight: 190, background: '#f1f0e8', border: '1px solid #a8b8a4' }}>
          {Object.values(scene.regions).filter(region => region.floorId === floorId && region.kind === 'manualMask').map(region => <polygon key={region.id} points={region.boundaryMm.map(p => `${p.x},${p.y}`).join(' ')} fill="#6196a144" stroke="#356777" strokeWidth={bounds.width / 350}/>)}
          {rows.flatMap((issue, n) => issue.missingBoundsMm.map((box, i) => <rect key={`${n}-${i}`} x={box.x} y={box.y} width={box.width} height={box.height} fill="#c44a4555" stroke="#a33131" strokeWidth={bounds.width / 350}/>))}
        </svg>
        <ul>{rows.map(issue => <li key={`${issue.entityKind}-${issue.entityId}-${issue.requiredBoundsMm.x}-${issue.requiredBoundsMm.y}`}><strong>{label(issue.entityId)}</strong><ul>{issue.missingBoundsMm.map((box, i) => <li key={i}>需补齐：X {format(Math.floor(box.x))}、Y {format(Math.floor(box.y))}，宽 {format(Math.ceil(box.x + box.width) - Math.floor(box.x))}、高 {format(Math.ceil(box.y + box.height) - Math.floor(box.y))}</li>)}</ul></li>)}</ul>
      </div>
    })}
    {onRepair && <button className="secondary asset-wide" type="button" disabled={disabled} onClick={onRepair}>补齐遮罩并重试</button>}
    {onRepair && <p className="asset-muted">会把补齐范围加入同一次候选，再检查玩家图中的公开内容。现在不会直接改工程。</p>}
  </section>
}
