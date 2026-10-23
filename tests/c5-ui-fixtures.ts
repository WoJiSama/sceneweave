import { createC4ProjectV6, C4_AREA, C4_FLOOR } from './c4-fixtures'
import { prepareCompositionCommandsV6 } from '../src/io/v6/prepare'
import type { CompositionCommandV6 } from '../src/core/v6/types'
import type { CompleteProjectV6 } from '../src/io/v6/types'

export const C5_BUDGET_LAYER = 'c5-budget-layer'
export const C5_SUPPORTED_LAYER = 'c5-supported-layer'
export const C5_SUPPORTED_PROP = 'c5-supported-prop'
export const C5_BUDGET_IDS = Array.from({ length: 257 }, (_, index) => `c5-budget-${String(index).padStart(3, '0')}`)

/** Preparation uses legal batches; the measured UI operation still targets all 257 at once. */
export async function createC5BudgetProjectV6(): Promise<CompleteProjectV6> {
  let project = await createC4ProjectV6({ title: 'C5 跨工具预算与支撑锁' })
  project = await prepareCompositionCommandsV6(project, [
    { type: 'createLayer', id: C5_BUDGET_LAYER, floorId: C4_FLOOR, name: 'C5 257 件' },
    { type: 'createLayer', id: C5_SUPPORTED_LAYER, floorId: C4_FLOOR, name: 'C5 支撑物件' },
  ])
  const definitionRef = project.document.props['c3-left'].definitionRef!
  const commands: CompositionCommandV6[] = C5_BUDGET_IDS.map((id, index) => ({
    type: 'addProp', id, floorId: C4_FLOOR, layerId: C5_BUDGET_LAYER, definitionRef,
    // The existing terrain claims y >= 9000, including its zero-elevation surface.
    // Keep all 1000 mm footprints in the explicit floor-only band (y <= 8250).
    positionMm: { x: 1000 + index % 17 * 1000, y: 1000 + Math.floor(index / 17) * 450 },
    supportRef: { kind: 'floor', id: C4_FLOOR },
  }))
  for (let offset = 0; offset < commands.length; offset += 128) project = await prepareCompositionCommandsV6(project, commands.slice(offset, offset + 128))
  project = await prepareCompositionCommandsV6(project, [{
    type: 'addProp', id: C5_SUPPORTED_PROP, floorId: C4_FLOOR, layerId: C5_SUPPORTED_LAYER, definitionRef,
    positionMm: { x: 11000, y: 12000 }, supportRef: { kind: 'terrainArea', id: C4_AREA },
  }])
  return project
}
