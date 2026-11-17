import type { TerrainInlayReview } from '../../application/workspace/terrain-inlay-review'
import type { SceneDocument } from '../../shared/model/scene'
import { createEntityLabeler } from './entity-label'

export default function TerrainInlayReviewPanel({ scene, rows }: { scene: SceneDocument; rows: readonly TerrainInlayReview[] }) {
  const name = createEntityLabeler(scene)
  return <>{rows.map(row => <section key={row.connectionId} aria-label="山路填切影响范围">
    <p>{row.finishOnly ? '调整坡面表面' : row.appearanceOnly ? row.sourceGround ? '山路融入周围地表' : '恢复山路单独铺装' : row.restoring ? '恢复原连接及地形' : row.finishKind ? '形成完整坡体' : '形成连续山路'}，涉及源地形：{row.sourceIds.map(name).join('、')}。</p>
    {row.finishOnly ? <p>表面：{row.finishKind === 'steps' ? '石质踏步' : row.finishKind === 'slope' ? '平顺山径' : '原有表现'}。实际坡体、净宽与通行保持。</p>
      : row.appearanceOnly ? <p>只调整路面外观，{row.sourceGround ? '沿用周围地表的材质和涂层' : '恢复连接原有的独立铺装'}；路宽、坡度、补岩、切壁及两端接入保持。</p>
      : <p>原地形、边缘与岸线记录保留；{row.restoring ? '撤回本山路的覆盖。' : '仅填切影响域内改用新表面。'}其余范围保持。</p>}
    {!!row.scopedPaintIds.length && <p>局部覆盖的原有岸线：{row.scopedPaintIds.map(name).join('、')}。</p>}
    <details><summary>源崖变化区间 · {row.sourceIntervals.length} 段</summary>
      <textarea aria-label="山路源崖变化区间" readOnly rows={4} value={row.sourceIntervals.map(interval =>
        `${interval.sourceAreaId} · ${interval.sourceSegmentId} · (${interval.a.x}, ${interval.a.y}) → (${interval.b.x}, ${interval.b.y})`).join('\n')}/>
    </details>
    <details><summary>只读依赖与局部覆盖 · {row.dependencyIds.length} 项</summary>
      <p>这些对象参与支撑、附着、锁或外观检查；本次实际编辑的是所选连接。</p>
      <textarea aria-label="山路只读依赖与局部覆盖" readOnly rows={4} value={row.dependencyIds.map(id =>
        `${row.scopedPaintIds.includes(id) ? '局部覆盖' : '只读依赖'} · ${name(id)} · ${id}`).join('\n')}/>
    </details>
  </section>)}</>
}
