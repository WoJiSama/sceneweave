import type { SceneDocument } from '../../shared/model/scene'
import { hasGeneratedIslandBase, hasIslandDressingV2 } from '../../shared/decorations/island-dressing'
import { hasIslandSurfaceDressingV1 } from '../../shared/decorations/island-dressing-v3'
import { TERRAIN_VARIANT_DEFINITION_IDS } from '../../shared/visual/terrain-variant-specs'
import { hasIslandCliffDetail } from '../../shared/decorations/island-cliff-detail'

/** The base generator and the later dressing edit keep separate adoption boundaries. */
export default function IslandDressingPanel({ scene, disabled, onPrepareCopy, onPrepareSources, onPreview }: {
  scene: SceneDocument
  disabled: boolean
  onPrepareCopy: () => void
  onPrepareSources: (ids: string[]) => void
  onPreview: (mode?: 'cliff' | 'surface') => void
}) {
  const applied = hasIslandDressingV2(scene)
  const surfaceApplied = hasIslandSurfaceDressingV1(scene)
  if (!hasGeneratedIslandBase(scene) && !applied) return null
  const missing = TERRAIN_VARIANT_DEFINITION_IDS.filter(id => !scene.propDefinitions[id])
  return <section className="terrain-generation-panel" aria-label="岩岛生成后布景">
    <h2>岩岛生成后布景</h2>
    <p>保留当前地形与树岩，在高台边缘增加植被、下层追加簇状布景，并将直行楼梯细化为自然岩阶。保留活动空地和完整通路净空。</p>
    {scene.schemaVersion === 8 && !surfaceApplied ? <>
      <p>使用区域规则布置高台树木、灌木和草簇，并接入连续材质。支撑面、活动区及连接净空通过同一候选检查。</p>
      {missing.length > 0
        ? <button className="secondary asset-wide" disabled={disabled} onClick={() => onPrepareSources([...TERRAIN_VARIANT_DEFINITION_IDS])}>预览岩岛布景素材</button>
        : <button className="primary asset-wide" disabled={disabled} onClick={() => onPreview('surface')}>预览规则驱动岩岛布景</button>}
    </> : surfaceApplied ? <>
      <p>区域规则布景已采用。可以继续调整各字段区域与成员；重复运行配方会明确拒绝。</p>
      {!hasIslandCliffDetail(scene) && <button className="secondary asset-wide" disabled={disabled} onClick={() => onPreview('cliff')}>预览高台崖面细节</button>}
    </> : applied ? <>
      <p>成图细化已采用。可以继续逐件编辑植被和岩阶；原底图配方已暂停，重新生成前请检查人工修改。</p>
      {hasIslandCliffDetail(scene) ? <p>高台崖面细节已采用，岩层与裂隙随工程保存。</p> : <>
        <p>还可单独预览高台崖面的岩层与裂隙，确认后一次采用或撤销。</p>
        <button className="secondary asset-wide" disabled={disabled} onClick={() => onPreview('cliff')}>预览高台崖面细节</button>
      </>}
    </> : scene.schemaVersion < 6 ? <>
      <p>先分步保存保全原工程的独立工作副本，再单独预览布景。每步完成后保存；后续步骤失败时保留已完成的副本。</p>
      <button className="secondary asset-wide" disabled={disabled} onClick={onPrepareCopy}>准备布景工作副本</button>
    </> : <>
      <p>先单独预览采用12种原创固定素材，再预览植被与岩阶。高台逐件放置、下层布景及楼梯在同一候选中检查预算及完整影响，一次采用或撤销；预览列出实际数量。</p>
      {missing.length > 0
        ? <button className="secondary asset-wide" disabled={disabled} onClick={() => onPrepareSources([...TERRAIN_VARIANT_DEFINITION_IDS])}>预览岩岛布景素材</button>
        : <button className="primary asset-wide" disabled={disabled} onClick={() => onPreview()}>预览岩岛自动布景</button>}
      <p>采用后可在 AI 面板中对当前地图明确授权精修；这是独立的当前工程任务，使用普通编辑额度。</p>
    </>}
  </section>
}
