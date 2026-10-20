import licenseText from '../../../LICENSE?raw'
import { createHouse } from '../../core/seed'
import { migrateSceneV1 } from '../../core/v2/migration'
import { collectDependenciesV2 } from '../../core/v2/dependencies'
import type { AssetRef } from '../../core/types'
import type { PropDefinition, PropV2 } from '../../core/v2/types'
import { normalizeImageAsset, sha256Bytes } from '../../io/v2/resources'
import { validateCompleteProjectV2 } from '../../io/v2/project-file'
import type { AssetBlobRecord, CompleteProjectV2 } from '../../io/v2/types'

/** Original calibration drawings for format/IO checks, separate from the planned art theme. */
async function drawImage(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { colorSpace: 'srgb' })
  if (!context) throw new Error('浏览器无法创建素材画布。')
  try {
    draw(context)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('素材编码失败。')), 'image/png'))
    return await normalizeImageAsset(blob, { signal })
  } finally { canvas.width = 0; canvas.height = 0 }
}
function drawWood(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#ba9269'; ctx.fillRect(0, 0, 512, 512)
  const colors = ['#c6a076', '#b88d62', '#c29a70', '#b68b65']
  for (let column = 0; column < 4; column++) {
    ctx.fillStyle = colors[column]; ctx.fillRect(column * 128 + 1, 0, 126, 512)
    ctx.strokeStyle = '#624b3644'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(column * 128, 0); ctx.lineTo(column * 128, 512); ctx.stroke()
    const joint = column % 2 ? 340 : 170
    ctx.beginPath(); ctx.moveTo(column * 128, joint); ctx.lineTo(column * 128 + 128, joint); ctx.stroke()
    for (let grain = 0; grain < 10; grain++) {
      const x = column * 128 + 12 + grain * 11
      ctx.strokeStyle = grain % 2 ? '#efe1c02b' : '#6a4c3424'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.bezierCurveTo(x + 9, 160, x - 7, 360, x, 512); ctx.stroke()
    }
    ctx.fillStyle = '#5c463b70'
    for (const y of [joint - 8, joint + 8]) for (const x of [column * 128 + 9, column * 128 + 119]) {
      ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill()
    }
  }
}
function drawDesk(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#3a2b2622'; ctx.beginPath(); ctx.roundRect(35, 38, 450, 194, 12); ctx.fill()
  ctx.fillStyle = '#986b48'; ctx.strokeStyle = '#47372b'; ctx.lineWidth = 4
  ctx.beginPath(); ctx.roundRect(25, 24, 462, 205, 8); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#c49a6a'; ctx.beginPath(); ctx.roundRect(34, 31, 444, 180, 5); ctx.fill(); ctx.stroke()
  for (let y = 58; y < 205; y += 29) {
    ctx.strokeStyle = '#73553866'; ctx.lineWidth = 1.3
    ctx.beginPath(); ctx.moveTo(40, y); ctx.bezierCurveTo(180, y - 4, 340, y + 3, 472, y); ctx.stroke()
  }
  ctx.save(); ctx.translate(150, 113); ctx.rotate(-0.12)
  ctx.fillStyle = '#50382b33'; ctx.fillRect(-50, -60, 113, 123)
  ctx.fillStyle = '#eee2bf'; ctx.strokeStyle = '#907754'; ctx.lineWidth = 2
  ctx.fillRect(-55, -65, 108, 120); ctx.strokeRect(-55, -65, 108, 120)
  ctx.strokeStyle = '#826c4955'; ctx.lineWidth = 2
  for (let y = -42; y < 40; y += 13) { ctx.beginPath(); ctx.moveTo(-39, y); ctx.lineTo(35, y + 2); ctx.stroke() }
  ctx.restore()
  ctx.fillStyle = '#4e6855'; ctx.strokeStyle = '#344b3c'; ctx.lineWidth = 3
  ctx.beginPath(); ctx.roundRect(306, 63, 103, 134, 4); ctx.fill(); ctx.stroke()
  ctx.strokeStyle = '#d3bc89'; ctx.lineWidth = 2; ctx.strokeRect(317, 74, 81, 112)
  ctx.fillStyle = '#3c3028'; ctx.beginPath(); ctx.arc(441, 62, 14, 0, Math.PI * 2); ctx.fill()
}
function drawChair(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#2a26211f'; ctx.beginPath(); ctx.roundRect(53, 69, 157, 157, 16); ctx.fill()
  ctx.fillStyle = '#a57950'; ctx.strokeStyle = '#4e3d2e'; ctx.lineWidth = 4
  ctx.beginPath(); ctx.roundRect(49, 63, 158, 156, 12); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#7d8a6b'; ctx.beginPath(); ctx.roundRect(60, 81, 136, 126, 16); ctx.fill(); ctx.stroke()
  ctx.fillStyle = '#bc9366'; ctx.beginPath(); ctx.roundRect(39, 39, 178, 47, 11); ctx.fill(); ctx.stroke()
  ctx.strokeStyle = '#e9ddba70'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(70, 94, 116, 101, 11); ctx.stroke()
}

export async function createCalibrationProject(signal?: AbortSignal): Promise<CompleteProjectV2> {
  const old = createHouse(), floorId = 'f-a1'
  old.title = '木纹书房 · 材质校样'
  old.exportBoundsMm = { x: 0, y: 0, width: 10000, height: 8000 }
  old.floors = { [floorId]: { id: floorId, name: '一层', boundsMm: { ...old.exportBoundsMm } } }
  old.vertices = Object.fromEntries([[1000, 1000], [9000, 1000], [9000, 7000], [1000, 7000]].map(([xMm, yMm], index) => {
    const id = `v-cal-${index}`; return [id, { id, floorId, xMm, yMm, editLocked: false }]
  }))
  old.rooms = { 'r-cal': { id: 'r-cal', floorId, boundaryVertexIds: Object.keys(old.vertices), purpose: '素材与工程往返校样', visibility: 'public', accessExpectation: 'required', editLocked: false } }
  old.walls = Object.fromEntries([0, 1, 2, 3].map(index => {
    const id = `w-cal-${index}`; return [id, { id, floorId, startVertexId: `v-cal-${index}`, endVertexId: `v-cal-${(index + 1) % 4}`, thicknessMm: 200, blocksMovement: true, blocksSight: true, editLocked: false }]
  }))
  old.openings = { 'o-cal': { id: 'o-cal', floorId, wallId: 'w-cal-2', offsetMm: 3400, widthMm: 1200, kind: 'door', state: 'open', locked: false, secret: false, revealed: false, editLocked: false } }
  old.props = {}; old.regions = {}; old.notes = {}
  old.constraints.entranceOpeningIds = ['o-cal']
  const scene = migrateSceneV1(old)
  const images = [await drawImage(512, 512, drawWood, signal), await drawImage(512, 256, drawDesk, signal), await drawImage(256, 256, drawChair, signal)]
  const origin: AssetRef['origin'] = { kind: 'original', attribution: 'Sceneweave 项目原创程序校样；非正式主题素材', canEmbed: true }
  const assets: Record<string, AssetBlobRecord> = {}
  const assetIds = ['a-cal-wood', 'a-cal-desk', 'a-cal-chair']
  images.forEach((image, index) => {
    const id = assetIds[index]
    assets[image.sha256] = image
    scene.assets[id] = { id, sha256: image.sha256, mimeType: image.mimeType, pixelWidth: image.pixelWidth, pixelHeight: image.pixelHeight,
      logicalSizeMm: index === 0 ? { width: 2000, height: 2000 } : index === 1 ? { width: 2000, height: 1000 } : { width: 1000, height: 1000 }, licenseRef: 'MIT', origin: { ...origin } }
  })
  scene.materials['m-cal-wood'] = { id: 'm-cal-wood', catalogId: 'calibration.wood', version: 1, licenseRef: 'MIT', origin: { ...origin },
    name: '木板校样', tags: ['校样', '木材'], textureAssetId: assetIds[0], defaultTileSizeMm: { width: 2000, height: 2000 }, applicableSurfaces: ['room'] }
  scene.rooms['r-cal'].floorStyle = { base: { materialRef: { id: 'm-cal-wood', version: 1 }, tileSizeMm: { width: 2000, height: 2000 }, rotationDeg: 0, alignment: 'world', originMm: { x: 0, y: 0 }, tint: null, opacity: 1 }, overlays: [] }
  const definitions: PropDefinition[] = [
    { id: 'd-cal-desk', catalogId: 'calibration.desk', version: 1, name: '书桌校样', tags: ['校样', '家具'], licenseRef: 'MIT', origin: { ...origin },
      defaultAppearance: { kind: 'image', assetId: assetIds[1], tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -1000, y: -500, width: 2000, height: 1000 },
      defaultFootprintMm: { width: 1800, height: 800 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: true, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' },
    { id: 'd-cal-chair', catalogId: 'calibration.chair', version: 1, name: '椅子校样', tags: ['校样', '家具'], licenseRef: 'MIT', origin: { ...origin },
      defaultAppearance: { kind: 'image', assetId: assetIds[2], tint: null, opacity: 1 }, defaultVisualBoundsMm: { x: -500, y: -500, width: 1000, height: 1000 },
      defaultFootprintMm: { width: 600, height: 600 }, defaultFootprintOffsetMm: { x: 0, y: 0 }, defaultBlocksMovement: true, defaultBlocksSight: false, defaultRenderLayer: 'object', defaultShadowClass: 'none' },
  ]
  for (const [index, definition] of definitions.entries()) {
    scene.propDefinitions[definition.id] = definition
    const id = `p-cal-${index}`, prop: PropV2 = { id, floorId, editLocked: false, definitionRef: { id: definition.id, version: 1 },
      appearance: structuredClone(definition.defaultAppearance), visualBoundsMm: { ...definition.defaultVisualBoundsMm },
      positionMm: { x: 5000, y: index === 0 ? 3500 : 4600 }, rotationDeg: index === 0 ? 0 : 180,
      footprintMm: { ...definition.defaultFootprintMm }, footprintOffsetMm: { x: 0, y: 0 }, blocksMovement: true, blocksSight: false,
      visibility: 'public', roomId: 'r-cal', supportRef: { kind: 'room', id: 'r-cal' }, renderLayer: 'object', renderOrder: index, shadowClass: 'none', shadowOverride: null }
    scene.props[id] = prop
  }
  const licenseHash = await sha256Bytes(new TextEncoder().encode(licenseText))
  const project: CompleteProjectV2 = { document: scene, assets, licenses: { [licenseHash]: { sha256: licenseHash, text: licenseText } },
    licenseBindings: collectDependenciesV2(scene).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })) }
  await validateCompleteProjectV2(project, { signal })
  return project
}
