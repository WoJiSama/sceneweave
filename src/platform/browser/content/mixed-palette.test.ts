import { expect, it } from 'vitest'
import { createRefinedBlankDocument } from './refined-blank.js'
import { mixedInteriorId, namespaceMixedInteriorCatalogue } from './mixed-palette.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { inspectDependencies } from '../../../shared/commands/dependencies.js'
import { captureJson, encodeUtf8 } from '../../../shared/validation/json.js'
import { sha256Bytes } from '../../../shared/validation/hash.js'
import { validateProjectData } from '../../../shared/project/validate.js'
import { REFINED_INTERIOR_LICENSE } from '../../../shared/visual/interior-art.js'
import type { ProjectData } from '../../../shared/model/project.js'

it('creates a distinct composable fixed catalogue with exact license bodies and all references, without changing the original', () => {
  const document = createRefinedBlankDocument('interior', { title: 'mixed', widthMm: 40000, heightMm: 32000, preset: 'narrative', now: '2026-11-05T00:00:00.000Z' })
  const original = captureJson(document), hash = '0'.repeat(64), licenseHash = sha256Bytes(encodeUtf8(REFINED_INTERIOR_LICENSE))
  let id = 0
  const project: ProjectData = { format: 'sceneweave-complete-project', schemaVersion: 1,
    ...createCompositionContent(captureJson(document), { ids: { nextId: () => `mixed-${++id}` }, clock: { now: () => document.createdAt } }),
    assets: { [hash]: { sha256: hash, mimeType: 'image/png', sizeBytes: 100, pixelWidth: 512, pixelHeight: 512 } },
    licenses: { [licenseHash]: { sha256: licenseHash, text: REFINED_INTERIOR_LICENSE } },
    licenseBindings: inspectDependencies(document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })), authoringSources: {} }
  namespaceMixedInteriorCatalogue(project)
  Object.assign(project, createCompositionContent(project.document, { ids: { nextId: () => `merged-${++id}` }, clock: { now: () => document.createdAt } }))
  expect(validateProjectData(project).document.activeStyleThemeRef?.id).toBe(mixedInteriorId(original.activeStyleThemeRef!.id))
  expect(document).toEqual(original)
  expect(project.licenses[licenseHash].text).toBe(REFINED_INTERIOR_LICENSE)
  for (const binding of project.licenseBindings) {
    expect(binding.licenseRef).toBe(`license-${licenseHash}`)
    expect(binding.licensePath).toBe(`licenses/${licenseHash}.txt`)
  }
  for (const [sourceId, source] of Object.entries(original.propDefinitions)) {
    const copy = project.document.propDefinitions[mixedInteriorId(sourceId)]
    expect(copy.catalogId).not.toBe(source.catalogId)
    expect(copy.defaultFootprintMm).toEqual(source.defaultFootprintMm)
    expect(copy.origin.attribution).toContain(source.origin.attribution)
    expect(copy.defaultAppearance.kind === 'image' && project.document.assets[copy.defaultAppearance.assetId].sha256).toBe(hash)
  }
})
