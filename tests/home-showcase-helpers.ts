import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { expect, type Page } from '@playwright/test'
import type { HomeShowcaseKind } from '../src/platform/browser/content/home-showcase'
import type { Workspace } from '../src/application/workspace/workspace'
import type { WorkspaceRepository } from '../src/editor/main/repository'

export type MountedWorkspace = { workspace: Workspace; repository: WorkspaceRepository }
export const featuredSampleIds = ['fantasy', 'wilderness', 'ruins', 'volcano'] as const satisfies readonly HomeShowcaseKind[]
export const showcaseManifest = JSON.parse(await readFile(new URL('../src/platform/browser/content/home-showcase-manifest.json', import.meta.url), 'utf8')) as typeof import('../src/platform/browser/content/home-showcase-manifest.json')
export const archiveUrl = (id: HomeShowcaseKind) => new URL('../public/assets/home-scenes/projects/' + showcaseManifest.entries[id].archiveFile, import.meta.url)

export async function importSampleFile(page: Page, id: HomeShowcaseKind) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('workspace-home').getByRole('button', { name: '打开工程文件', exact: true }).click()
  await (await chooser).setFiles(fileURLToPath(archiveUrl(id)))
  await expect(page).toHaveURL(/#workspace$/, { timeout: 30_000 })
}
