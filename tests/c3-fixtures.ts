import { layerSceneV3 } from '../src/core/v3/test-fixtures'
import { createCompositionContentV5 } from '../src/core/v5/graph'
import { prepareAssetImportV5, prepareCompositionCommandsV5 } from '../src/io/v5/prepare'
import type { CompleteProjectV5 } from '../src/io/v5/types'
export const C3_LAYER = 'layer-default-0'
export const C3_IDS = ['c3-left', 'c3-right', 'c3-secret'] as const
/** Original sRGB fixture with opaque, translucent and transparent pixels, never a decoder stub. */
export async function c3ImageBlob(type = 'image/png'): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!
  context.fillStyle = 'rgb(200,100,50)'; context.fillRect(0, 0, 8, 8)
  context.clearRect(0, 0, 2, 8); context.fillStyle = 'rgba(100,200,50,0.5)'; context.clearRect(6, 0, 2, 8); context.fillRect(6, 0, 2, 8)
  try { return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Fixture image encode failed')), type, 0.95)) } finally { canvas.width = 0; canvas.height = 0 }
}
export async function createC3ProjectV5(options: { title?: string; sceneId?: string } = {}): Promise<CompleteProjectV5> {
  const document = layerSceneV3(); document.sceneId = options.sceneId ?? crypto.randomUUID(); document.title = options.title ?? 'C3 真实图片与组合夹具'
  document.props = {}; delete document.entityLayers.item; document.assets = {}; document.propDefinitions = {}
  let project: CompleteProjectV5 = { ...createCompositionContentV5(document), assets: {}, licenses: {}, licenseBindings: [] }
  project = await prepareAssetImportV5(project, { file: await c3ImageBlob(), name: '原创测试叶片', kind: 'prop', widthMm: 1400, heightMm: 1400, footprintWidthMm: 1000, footprintHeightMm: 1000, blocksMovement: false, blocksSight: false, tags: ['C3', '原创'], licenseText: 'CC0-1.0. Original Sceneweave C3 test artwork; dedicated to the public domain.', attribution: 'Sceneweave original browser fixture', canEmbed: true })
  const definition = Object.values(project.document.propDefinitions)[0]
  project = await prepareCompositionCommandsV5(project, C3_IDS.map((id, index) => ({ type: 'addProp', id, floorId: 'blank-floor', definitionRef: { id: definition.id, version: 1 }, positionMm: { x: 4000 + index * 2000, y: 4000 }, supportRef: { kind: 'floor', id: 'blank-floor' }, layerId: C3_LAYER })))
  project.document.props['c3-secret'].visibility = 'gm'
  project.document.regions['c3-private-mask'] = { id: 'c3-private-mask', floorId: 'blank-floor', editLocked: false, kind: 'manualMask', visibility: 'gm', boundaryMm: [{ x: 7000, y: 1000 }, { x: 12000, y: 1000 }, { x: 12000, y: 7500 }, { x: 7000, y: 7500 }], blocksMovement: false, movementCostMultiplier: 1 }
  project.document.entityLayers['c3-private-mask'] = C3_LAYER
  return project
}
