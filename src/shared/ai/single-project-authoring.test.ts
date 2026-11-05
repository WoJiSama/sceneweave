import { describe, expect, it } from 'vitest'
import { layerSceneV3 } from '../../core/v3/test-fixtures.js'
import { createCompositionContent } from '../appearance/graph.js'
import type { ProjectData } from '../model/project.js'
import type { SceneDocument } from '../model/scene.js'
import { createEmptyGeneration5 } from '../terrain-generation/composition-contracts.js'
import { emptyVisualSystem } from '../visual/types.js'
import { validateProjectData } from '../project/validate.js'
import { cloneJson } from '../validation/json.js'
import { createCurrentAuthoringStartV4 } from './current-authoring.js'
import { applyAuthoringStep, authoringProjectHash, publicAuthoringContext, replayAuthoring } from './authoring.js'
import { CURRENT_AUTHORING_CAPABILITY, assertCurrentAuthoringCapability, assertUnsupportedRuleContentUnchanged, currentAuthoringOperationSupported } from './current-authoring-capability.js'
import { CurrentExtraOperationSchema } from './authoring-protocol-v4.js'

function projectFixture(): ProjectData {
  const document = { ...cloneJson(layerSceneV3()), format: 'sceneweave-scene', schemaVersion: 1, mapMode: 'scene', regional: null,
    generation: createEmptyGeneration5(), visual: { version: 3, base: { version: 2, base: emptyVisualSystem(), materializedEdges: {} }, transitions: {} },
    decorations: {}, decorationClusters: {}, surfaceRules: {}, assets: {}, propDefinitions: {}, materials: {}, styleThemes: {}, activeStyleThemeRef: null } as SceneDocument
  let sequence = 0
  const content = createCompositionContent(document, { ids: { nextId: () => `single-v1-${++sequence}` }, clock: { now: () => document.createdAt } })
  return validateProjectData({ format: 'sceneweave-complete-project', schemaVersion: 1, ...content,
    assets: {}, licenses: {}, licenseBindings: [], authoringSources: {} })
}
function startFixture() {
  const project = projectFixture(), document = project.document
  return createCurrentAuthoringStartV4({ project, seed: '70859a22-1bd4-45e3-9a82-96dc5da14af3', preparedAt: document.createdAt,
    flowId: 'single-v1-current', preservation: { sceneId: document.sceneId, revision: document.revision, contentHash: authoringProjectHash(project), checkpoint: 0 },
    scope: { targetIds: ['item'], operations: ['transform', 'opacity'], placement: null } })
}

describe('single complete v1 AI contract', () => {
  it('keeps protocol4, full identity and real command accounting on project1', () => {
    const start = startFixture(), initial = replayAuthoring(start, [])
    const next = applyAuthoringStep(start, initial.state, [{ kind: 'transform', id: 'item', positionMm: { x: 5000, y: 5000 } }], 'move')
    expect(next.project.schemaVersion).toBe(1)
    expect(next.project.historyIdentity.version).toBe(5)
    expect(next.project.appearance.version).toBe(2)
    expect(next.state.schemaVersion).toBe(4)
    expect(next.state.budget.aiCost).toBeGreaterThan(0)
    expect(next.project.document.props.item.positionMm).toEqual({ x: 5000, y: 5000 })
    expect(replayAuthoring(start, next.state.steps)).toEqual(next)
    expect(publicAuthoringContext(start, next.state)).toMatchObject({ schemaVersion: 4, capability: CURRENT_AUTHORING_CAPABILITY })
  })
  it('does not reinterpret an old project number or old project hash as a current credential', () => {
    const start = startFixture(), forged = cloneJson(start)
    ;(forged.project as unknown as { schemaVersion: number }).schemaVersion = 8
    expect(() => replayAuthoring(forged, [])).toThrow()
    const changed = cloneJson(start); changed.project.document.title = 'changed after grant'
    expect(() => replayAuthoring(changed, [])).toThrow()
    expect(assertCurrentAuthoringCapability(start.project, CURRENT_AUTHORING_CAPABILITY)).toBe(true)
  })
  it('offers only implemented operations from actual model capabilities', () => {
    const project = projectFixture()
    for (const operation of ['terrainEdit', 'terrainLocal', 'connectionRoute', 'decorationCluster']) expect(currentAuthoringOperationSupported(project, operation)).toBe(true)
    for (const operation of ['surfaceRule', 'canopyRule', 'unknown']) expect(currentAuthoringOperationSupported(project, operation)).toBe(false)
    expect(CurrentExtraOperationSchema.safeParse({ kind: 'surfaceRule', id: 'rule' }).success).toBe(false)
    const regional = cloneJson(project); regional.document.mapMode = 'regional'
    expect(currentAuthoringOperationSupported(regional, 'connectionRoute')).toBe(false)
  })
  it('blocks indirect rule, support, member and appearance mutations with one fixed rejection', () => {
    const before = projectFixture(), scene = before.document
    // This check is the unsupported-dependency guard; the full scene validator
    // separately owns rule geometry/identity validation.
    scene.surfaceRules.rule = { id: 'rule', floorId: 'blank-floor', editLocked: false, visibility: 'gm',
      supportRef: { kind: 'terrainArea', id: 'support' }, field: 'trees', paintOrder: 0, regionsMm: [], clusterId: 'cluster', coveragePpm: 500000 }
    scene.decorationClusters.cluster = { members: { member: { entityId: 'item' } } } as never
    expect(() => assertUnsupportedRuleContentUnchanged(before, cloneJson(before))).not.toThrow()
    const unrelated = cloneJson(before); unrelated.document.title = 'unrelated'
    expect(() => assertUnsupportedRuleContentUnchanged(before, unrelated)).not.toThrow()
    for (const change of [
      (next: ProjectData) => { next.document.props.item.positionMm.x++ },
      (next: ProjectData) => { next.document.surfaceRules.rule.paintOrder++ },
      (next: ProjectData) => { next.document.terrainAreas.support = { id: 'support' } as never },
      (next: ProjectData) => { next.appearance.instanceAdjustments.item = [{ id: 'adjust', kind: 'opacity', enabled: true, value: .5 }] },
    ]) {
      const next = cloneJson(before); change(next)
      expect(() => assertUnsupportedRuleContentUnchanged(before, next)).toThrow('当前AI操作涉及尚未开放或未授权的规则依赖，此步骤未采用。')
    }
  })
})
