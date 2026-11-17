import { applyCommands } from '../../shared/commands/commands.js'
import type { CompositionCommand } from '../../shared/model/appearance.js'
import { assertCommandBudget, selectManualTransactionBudget, type CommandBudgetUsage } from '../../shared/budget/command-budget.js'
import { emptyBudgetUsage, withAdditionalExecutionWorkObserver } from '../../shared/budget/task-budget.js'
import { buildingFurnishingSchema, assertFurnishingPalette, furnishingPaletteLabel, furnishingPaletteMatches } from '../../shared/furnishing/palette.js'
import { furnishingRoleNames, type RoomFurnishingReview } from '../../shared/furnishing/contracts.js'
import { planRoomFurnishing } from '../../shared/furnishing/plan.js'
import { checkTerrainRoute } from '../../shared/geometry/terrain-travel.js'
import { replanInteriorCirculation } from '../../shared/generation/domains/interior/connectivity.js'
import { taskBudgetProfile } from '../../shared/budget/task-budget.js'
import { captureJson } from '../../shared/validation/json.js'
import { checkCancelled } from '../../shared/ports/resources.js'
import type { TransactionReceipt } from '../../shared/transaction/receipt.js'
import { combineManualPreparationUsage, prepareCompositionCommands, type PrepareOptions } from './prepare.js'
import type { EditableProject } from './project.js'

/** One conservative envelope, one complete candidate. Intermediate documents
 * only let later rooms see earlier proposed furniture; none is committed. */
export async function prepareBuildingFurnishing(catalog: EditableProject, raw: unknown, options: PrepareOptions & {
  cooperate?: () => Promise<void>; assertBaseline?: () => void
}) {
  const rows = buildingFurnishingSchema.parse(captureJson(raw))
  const budget = selectManualTransactionBudget(catalog, rows.reduce((sum, { request }) => sum + 1 + request.movableIds.length + request.functions.reduce((n, fn) => n + fn.count, 0), 0))
  let document = catalog.document
  const observed = emptyBudgetUsage(), commands: CompositionCommand[] = [], scopeIds: string[] = []
  const rooms: NonNullable<RoomFurnishingReview['rooms']> = [], preserved = new Set<string>()
  const plans: ReturnType<typeof planRoomFurnishing>[] = []
  const check = () => { checkCancelled(options.signal); options.assertBaseline?.() }
  const observe = (delta: Partial<CommandBudgetUsage>) => {
    for (const key of Object.keys(delta) as (keyof typeof observed)[]) observed[key] += delta[key] ?? 0
    assertCommandBudget(budget, observed)
  }
  for (const row of rows) {
    check(); assertFurnishingPalette(document, row)
    const result = withAdditionalExecutionWorkObserver(observe, () => planRoomFurnishing(document, row.request, options.runtime, check))
    plans.push(result)
    if (result.commands.length) document = withAdditionalExecutionWorkObserver(observe, () => applyCommands(document, result.commands, options.runtime))
    commands.push(...result.commands); scopeIds.push(row.request.roomId, ...result.addedIds, ...result.movedIds)
    result.preservedIds.forEach(id => preserved.add(id))
    const access = result.report.rooms.flatMap(room => room.circulation ?? [])
    const mixed = row.request.functions.filter(fn => fn.count && !furnishingPaletteMatches(catalog.document.propDefinitions[fn.definitionRef.id], row.palette))
    const summary = `${row.request.purpose} · 新增${result.addedIds.length}件、移动${result.movedIds.length}件、保留${result.preservedIds.length}件 · ${result.missing.length}项未填充`
    rooms.push({ roomId: row.request.roomId, purpose: row.request.purpose, style: furnishingPaletteLabel(row.palette), summary,
      added: result.addedIds.length, moved: result.movedIds.length, preserved: result.preservedIds.length,
      missing: result.missing.map(value => value.replace(/ ([a-z]+):(\d+)$/, (_, _role: string, index: string) => ` · 第${Number(index) + 1}件`)),
      notes: [...new Set([...result.notes, ...mixed.map(fn => `已明确允许${furnishingRoleNames[fn.role]}使用跨风格或未标注素材：${catalog.document.propDefinitions[fn.definitionRef.id].name}。`)])],
      routes: result.routes, furnitureAccess: { clear: access.filter(value => value.status === 'clear').length, total: access.length }, hasCandidate: !!result.commands.length })
    await options.cooperate?.(); check()
  }
  // A later room can affect the opposite approach to a shared door. Recheck
  // every previously clear route against the final combined geometry before
  // presenting its proof count; an unproved route is never silently promoted.
  if (rows.length > 1) for (const [index, plan] of plans.entries()) {
    const floorId = document.rooms[rows[index].request.roomId].floorId, roomReview = rooms[index]
    const clear = (pointsMm: { x: number; y: number }[], widthMm: number) => {
      check()
      observe({ fieldEvaluations: Object.keys(document.walls).length + Object.keys(document.props).length + Object.keys(document.regions).length + pointsMm.length })
      return checkTerrainRoute(document, { floorId, pointsMm, widthMm }).ok
    }
    const finalRoutes = withAdditionalExecutionWorkObserver(observe, () => replanInteriorCirculation(document, plan.input, plan.layout, plan.circulation,
      { profile: taskBudgetProfile('small'), checkCancelled: check, avoidPaintedBodies: false }))
    const routes = finalRoutes.routes.filter(route => route.status === 'clear' && clear(route.pointsMm, route.widthMm)).length
    const access = plan.report.rooms.flatMap(room => room.circulation ?? [])
    const furniture = access.filter(route => route.status === 'clear' && clear(route.pointsMm, route.widthMm)).length
    if (routes < roomReview.routes.clear || furniture < roomReview.furnitureAccess.clear) roomReview.notes.push('合并其他房间后，部分原通路未通过最终占地复核；请调整家具与门前空间。')
    roomReview.routes.clear = routes; roomReview.furnitureAccess.clear = furniture
    await options.cooperate?.(); check()
  }
  const sum = (key: 'added' | 'moved') => rooms.reduce((n, room) => n + room[key], 0)
  const review: RoomFurnishingReview = { summary: rooms.length === 1 ? rooms[0].summary : `${rooms.length}个房间 · 新增${sum('added')}件、移动${sum('moved')}件、保留${preserved.size}件`,
    added: sum('added'), moved: sum('moved'), preserved: preserved.size, missing: rooms.flatMap(room => room.missing.map(value => `${room.purpose}：${value}`)),
    notes: [...new Set(rooms.flatMap(room => room.notes))], routes: { clear: rooms.reduce((n, r) => n + r.routes.clear, 0), total: rooms.reduce((n, r) => n + r.routes.total, 0) },
    furnitureAccess: { clear: rooms.reduce((n, r) => n + r.furnitureAccess.clear, 0), total: rooms.reduce((n, r) => n + r.furnitureAccess.total, 0) }, hasCandidate: !!commands.length, rooms }
  if (!commands.length) return { review, commands, scopeIds, budget }
  let preparedUsage: CommandBudgetUsage | undefined, executionReceipt: TransactionReceipt | undefined
  const project = await prepareCompositionCommands(catalog, commands, { ...options, budget, onBudgetUsage: usage => { preparedUsage = usage }, onTransactionReceipt: receipt => { executionReceipt = receipt } })
  check()
  const budgetUsage = assertCommandBudget(budget, combineManualPreparationUsage(preparedUsage!, emptyBudgetUsage(), observed))
  return { project, review, commands, scopeIds, budget, budgetUsage, executionReceipt }
}
