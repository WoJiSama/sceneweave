import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { taskBudgetProfile } from '../src/shared/budget/task-budget'
import { inspectInteriorConnections } from '../src/shared/generation/domains/interior/connectivity'
import { normalizeInteriorInput } from '../src/shared/generation/domains/interior'
import { roomDoorPorts } from '../src/shared/generation/domains/interior/furnishing-circulation'
import { interiorEntityId } from '../src/shared/generation/domains/interior/layout'
import { openingEndpoints, propFootprint, roomPoints } from '../src/shared/geometry/geometry'
import { getLegacyGeneration } from '../src/shared/terrain-generation/composition-contracts'
import { createKeyboardProject, keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved } from './keyboard-ux-helpers'
import { openGenerationTask } from './workspace-navigation-helpers'
import { mapExportButton } from './workspace-ux-helpers'

const samples = [
  { id: 'bedroom', seed: 'd3-guest-bedroom', width: '7.6', height: '5.6', purposes: ['卧室'], roles: ['bed', 'storage'] },
  { id: 'kitchen', seed: 'd3-kitchen-pantry', width: '11', height: '7', purposes: ['厨房', '储藏室'], roles: ['work', 'hearth'] },
  { id: 'common', seed: 'interior-1', width: '12', height: '8', purposes: ['公共室', '储藏室'], roles: ['table', 'seat'] },
] as const

for (const sample of samples) test(`${sample.id} seed delivers a furnished, walkable project`, async ({ page, browser }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await createKeyboardProject(page, '室内对照起点')
  await openGenerationTask(page, '室内布局')
  const panel = page.getByRole('region', { name: '室内布局生成', exact: true })
  await panel.getByLabel('室内工程名称', { exact: true }).fill(`室内对照 · ${sample.purposes[0]}`)
  await panel.getByLabel('室内生成种子', { exact: true }).fill(sample.seed)
  await panel.getByLabel('室内建筑宽米', { exact: true }).fill(sample.width)
  await panel.getByLabel('室内建筑高米', { exact: true }).fill(sample.height)
  if (sample.purposes.length === 1) await panel.getByRole('button', { name: '移除房间 2', exact: true }).click()
  for (const [index, purpose] of sample.purposes.entries()) {
    await panel.getByLabel(`房间${index + 1}用途`, { exact: true }).fill(purpose)
  }
  if (sample.id === 'kitchen') {
    await panel.getByLabel('房间1最小面积', { exact: true }).fill('40')
    await panel.getByLabel('房间2最大面积', { exact: true }).fill('25')
    await panel.getByLabel('室内入口房间', { exact: true }).selectOption('room-1')
  }

  const candidate = page.getByLabel('室内布局候选摘要', { exact: true })
  await panel.getByRole('button', { name: '预览室内布局', exact: true }).click()
  await expect(candidate).toBeVisible({ timeout: 90_000 })
  const notes = await candidate.innerText()
  const summary = await candidate.getByLabel('室内首次布置结果', { exact: true }).innerText()
  await candidate.getByRole('button', { name: '保存为新工程', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '室内布局已完整保存' })).toBeVisible({ timeout: 90_000 })
  await keyboardWorkspaceSaved(page)
  const backupPath = info.outputPath('map.sceneweave')
  const { document, hashes } = await keyboardProjectBackup(page, backupPath)
  const pending = page.waitForEvent('download')
  await (await mapExportButton(page, 'gm')).click()
  await (await pending).saveAs(info.outputPath('map.png'))
  await keyboardWorkspaceSaved(page)
  await page.locator('.workspace-export-menu > summary').click()
  await page.screenshot({ path: info.outputPath('editor.png') })

  const recipes = getLegacyGeneration(document)?.recipes ?? {}
  const recipe = Object.values(recipes).find(value => value.algorithmId === 'interior-layout')!
  const input = normalizeInteriorInput({ version: 1, algorithmVersion: recipe.algorithmVersion, seed: recipe.seed, parameters: recipe.parameters })
  const rooms = input.parameters.rooms.map(requirement => {
    const roomId = interiorEntityId(document.sceneId, input.seed, `room:${requirement.id}`)
    const polygon = roomPoints(document, document.rooms[roomId]), xs = polygon.map(point => point.x), ys = polygon.map(point => point.y)
    const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y
    const clearAreaMm2 = (width - input.parameters.wallThicknessMm) * (height - input.parameters.wallThicknessMm)
    return { roomId, requirementId: requirement.id, boundsMm: { x, y, width, height }, clearAreaMm2 }
  })
  const connections = inspectInteriorConnections(document, input, { rooms, corridors: [] }, { profile: taskBudgetProfile('standard'), checkCancelled() {} })
  const openings = Object.values(document.openings).map(opening => ({ id: opening.id, wallId: opening.wallId, widthMm: opening.widthMm,
    wallThicknessMm: document.walls[opening.wallId].thicknessMm, endpoints: openingEndpoints(document, opening) }))
  await writeFile(info.outputPath('observations.json'), JSON.stringify({ input, rooms, openings, connections, notes,
    props: Object.values(document.props).map(prop => ({ id: prop.id, supportRef: prop.supportRef, definition: prop.definitionRef?.id,
      positionMm: prop.positionMm, rotationDeg: prop.rotationDeg, footprint: propFootprint(prop) })), sceneHash: hashes['scene.json'] }, null, 2))
  expect(input.seed).toBe(sample.seed)
  expect(input.algorithmVersion).toBe(21)
  expect(Object.values(document.rooms).map(room => room.purpose).sort()).toEqual([...sample.purposes].sort())
  expect(openings).toHaveLength(sample.purposes.length)
  expect(openings.every(opening => opening.widthMm >= 900 && opening.wallThicknessMm === 200)).toBe(true)
  expect(summary).toContain(`${openings.length}/${openings.length} 条建议通路通过净空检查`)
  expect(connections.routes).toHaveLength(openings.length)
  expect(connections.routes.map(({ status, widthMm, notes }) => ({ status, widthMm, notes })))
    .toEqual(openings.map(() => ({ status: 'clear', widthMm: 900, notes: [] })))
  const entrance = connections.routes.find(route => route.fromRoomId === null)!
  expect(roomDoorPorts(document, entrance.toRoomId, 600, () => {}, () => {}, true)).toContainEqual(expect.objectContaining({ openingId: entrance.openingId }))
  const primaryProps = Object.values(document.props).filter(prop => prop.supportRef.kind === 'room' && prop.supportRef.id === rooms[0].roomId)
  for (const role of sample.roles) {
    expect(primaryProps.some(prop => input.parameters.arrangement.palette.some(row => row.role === role && row.ref.id === prop.definitionRef?.id))).toBe(true)
  }

  // Reopen the actual backup in a context with an empty project store.
  const coldContext = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: page.viewportSize() })
  try {
    const reopened = await coldContext.newPage()
    reopened.on('pageerror', error => errors.push(error.message))
    await reopened.goto('./#home')
    await reopened.getByTestId('native-project-file').setInputFiles(backupPath)
    await keyboardWorkspaceSaved(reopened)
    const imported = await keyboardProjectBackup(reopened, info.outputPath('cold-read.sceneweave'))
    for (const collection of ['rooms', 'vertices', 'walls', 'openings', 'props', 'generation'] as const) {
      expect(imported.document[collection]).toEqual(document[collection])
    }
    expect(keyboardResourceHashes(imported.hashes)).toEqual(keyboardResourceHashes(hashes))
  } finally {
    await coldContext.close()
  }
  expect(errors).toEqual([])
})
