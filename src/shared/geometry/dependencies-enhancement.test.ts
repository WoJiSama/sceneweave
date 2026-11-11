import { describe, expect, it } from 'vitest'
import { svgProjectFixture } from '../../../tests/helpers/m24-svg-fixtures.js'
import { inspectDependencies } from './dependencies.js'

describe('untrusted enhancement dependency closure', () => {
  it('reports malformed long chains before JavaScript stack limits can interrupt validation', () => {
    const { bundle } = svgProjectFixture(), document = bundle.project.document, original = document.assets.image
    let sourceAssetId = original.id
    for (let index = 0; index < 12000; index++) {
      const id = `long-enhancement-${index}`
      document.assets[id] = { ...original, id, imageEnhancement: { version: 1, sourceAssetId, originalAssetId: original.id,
        recipe: { version: 1, direction: 'clarity', strength: 'gentle', scale: 1 } } }
      sourceAssetId = id
    }
    document.propDefinitions.definition.defaultAppearance = { kind: 'image', assetId: sourceAssetId, tint: null, opacity: 1 }
    const result = inspectDependencies(document)
    expect(result.assetIds).toHaveLength(12001)
    expect(result.errors.some(issue => issue.code === 'IMAGE_ENHANCEMENT_SOURCE' && issue.message.includes('16层'))).toBe(true)
  })
})
