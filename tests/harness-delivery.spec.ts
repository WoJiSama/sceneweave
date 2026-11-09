import { expect, test } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { semanticGenerationExample } from '../src/shared/generation/semantic-request'
import { keyboardProjectBackup, keyboardResourceHashes, keyboardWorkspaceSaved, selectKeyboardProp } from './keyboard-ux-helpers'

test('local harness files open in the normal editor, retain edits and undo, and cold reopen', async ({ page }, info) => {
  test.setTimeout(300000)
  const parent = info.outputPath('harness'), input = path.join(parent, 'input.json'), output = path.join(parent, 'delivery')
  await mkdir(parent, { recursive: true })
  await writeFile(input, JSON.stringify(semanticGenerationExample()))
  await promisify(execFile)(process.execPath, ['tools/harness/sceneweave.mjs', 'generate', '--input', input, '--output', output,
    '--allow', 'forest-building', '--budget', 'standard'], { cwd: process.cwd(), timeout: 240000, maxBuffer: 1024 * 1024 })
  const result = JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8'))
  expect(result.status).toBe('complete'); expect(result.modelRequests).toBe(0)
  expect(result.diskVerification.changedPixels).toBe(0)
  const errors: string[] = [], modelRequests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/\/v1\/(?:tasks|generation)/.test(request.url())) modelRequests.push(request.url()) })
  await page.goto('./#home')
  const choosing = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await choosing).setFiles(path.join(output, 'map.sceneweave'))
  await expect(page.getByRole('heading', { name: result.title, exact: true, level: 1 })).toBeVisible({ timeout: 90000 })
  await keyboardWorkspaceSaved(page)
  const original = await keyboardProjectBackup(page, info.outputPath('imported.sceneweave'))
  expect(Object.keys(original.document.rooms)).toHaveLength(2)
  expect(Object.keys(original.document.paths)).toHaveLength(2)
  const furniture = Object.values(original.document.props).find(prop => prop.supportRef.kind === 'room')
  expect(furniture).toBeTruthy()
  await selectKeyboardProp(page, furniture!.id)
  await page.getByRole('button', { name: '删除物件', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const edited = await keyboardProjectBackup(page, info.outputPath('edited.sceneweave'))
  expect(edited.document.props[furniture!.id]).toBeUndefined()
  await page.getByRole('button', { name: '撤销编辑', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const undone = await keyboardProjectBackup(page, info.outputPath('undone.sceneweave'))
  expect(undone.document.props).toEqual(original.document.props)
  expect(keyboardResourceHashes(undone.hashes)).toEqual(keyboardResourceHashes(original.hashes))
  await page.goto('./#home'); await page.reload()
  const row = page.getByTestId('workspace-home').locator(`[data-project-key="native:${undone.document.sceneId}"]`)
  await expect(row).toBeVisible({ timeout: 30000 })
  await row.getByRole('button', { name: '打开', exact: true }).click()
  await keyboardWorkspaceSaved(page)
  const cold = await keyboardProjectBackup(page, info.outputPath('cold.sceneweave'))
  expect(cold.document).toEqual(undone.document)
  expect(cold.identity).toEqual(undone.identity)
  expect(keyboardResourceHashes(cold.hashes)).toEqual(keyboardResourceHashes(undone.hashes))
  expect(errors).toEqual([]); expect(modelRequests).toEqual([])
})
