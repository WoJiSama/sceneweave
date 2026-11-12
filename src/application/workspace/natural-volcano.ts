import { applyCompositionCommands } from '../../shared/appearance/commands.js'
import { selectManualTransactionBudget } from '../../shared/budget/command-budget.js'
import { createNaturalVolcanoProfile, naturalVolcanoFinishCommands } from '../../shared/generation/domains/volcano/natural-profile.js'
import { checkVolcanoResult } from '../../shared/generation/domains/volcano/index.js'
import { checkTerrainRoute, assertTerrainConnectionClearances } from '../../shared/geometry/terrain-travel.js'
import { polygonInside, terrainPoints } from '../../shared/geometry/geometry.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import { reviseCompositionContent } from '../../shared/validation/content.js'
import type { CompositionContent } from '../../shared/model/appearance.js'
import { prepareVolcanoProject, type VolcanoPreparationOptions } from './volcano.js'
import { materializeProject } from './prepare.js'
import type { EditableProject } from './project.js'

/** New independent project creation through native generation and one explicit
 * finish transaction. Existing algorithm-1 requests are never reinterpreted. */
export async function prepareNaturalVolcanoProject(base: EditableProject, options: VolcanoPreparationOptions & { seed?: string }) {
  checkCancelled(options.signal)
  const profile = createNaturalVolcanoProfile(base.document, options.seed)
  const generated = await prepareVolcanoProject(base, profile.input, options)
  checkCancelled(options.signal)
  const source = generated.project
  const commands = naturalVolcanoFinishCommands(source.document, profile, generated.report)
  const budget = selectManualTransactionBudget(source.document)
  const before: CompositionContent = { document: source.document, historyIdentity: source.historyIdentity, appearance: source.appearance }
  const edited = applyCompositionCommands(before, commands, options.runtime, { budget })
  const revised = reviseCompositionContent(edited, source.document.revision + 1, options.runtime.clock.now())
  const project = await materializeProject({ ...source, ...revised }, { runtime: options.runtime,
    validation: options.validation, baseline: source, budget, signal: options.signal })
  checkCancelled(options.signal)
  const document = project.document, p = profile.input.parameters
  checkVolcanoResult(document, profile.input, generated.report)
  const lava = terrainPoints(document.terrainAreas[profile.lavaAreaId]), crater = terrainPoints(document.terrainAreas[generated.report.craterAreaId])
  if (!polygonInside(lava, crater)) throw new Error('自然熔岩池没有完整保留在真实低陷火口。')
  const fixtures = generated.report.connectionIds.map(connectionId => ({ connectionId,
    minWidthMm: p.route.widthMm, approachDepthMm: Math.max(1, Math.floor(p.route.widthMm / 3)) }))
  assertTerrainConnectionClearances(document, fixtures)
  const routeChecks = generated.report.pathIds.map(pathId => {
    const path = document.paths[pathId]
    return { pathId, ...checkTerrainRoute(document, { floorId: path.floorId, pointsMm: path.centerlineMm, widthMm: path.widthMm }) }
  })
  if (routeChecks.some(row => !row.ok)) throw new Error('自然火山的真实路线净宽或支撑不成立。')
  return { project, profile, generated, commands, routeChecks, fixtures }
}
