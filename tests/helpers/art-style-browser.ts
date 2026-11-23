import type { EditableProject } from '../../src/application/workspace/project'
import type { Workspace } from '../../src/application/workspace/workspace'
import { toBundle } from '../../src/application/workspace/project'
import { prepareAssetImport } from '../../src/application/workspace/prepare'
import type { CompositionCommand } from '../../src/shared/model/appearance'
import { createThemePackCatalogProject, themePackDefinitionId } from '../../src/platform/browser/content/theme-pack-catalog'
import { runtime, validation } from '../../src/platform/browser/runtime'
import { exportPng, renderEditorProject, renderProject } from '../../src/platform/browser/render/renderer'
import { ART_STYLE_DEFAULTS, defaultSceneArtStyle, type LegacySceneArtStyle } from '../../src/shared/visual/art-style'
import { neutralColorFilter } from '../../src/shared/visual/color-filter'

const workspace = () => (Reflect.get(window, '__sceneweaveOutdoorDev') as { workspace: Workspace }).workspace
function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Missing PNG'))))
}
async function downloadProof(canvas: HTMLCanvasElement) {
  const url = URL.createObjectURL(await canvasBlob(canvas)), link = document.createElement('a')
  link.href = url; link.download = 'art-style-room.png'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function rectangle(x: number, y: number, w: number, h: number) {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]
}
const privateNote = 'art-style-test-private-note'
const privateNoteTexts = ['隐藏内容甲', '不共享的定位乙']

export async function makeArtStyleRoom() {
  const catalog = await createThemePackCatalogProject('fantasy')
  const image = document.createElement('canvas')
  image.width = 420; image.height = 300
  const ctx = image.getContext('2d')!
  ctx.fillStyle = '#473954'; ctx.fillRect(6, 7, 408, 286)
  ctx.fillStyle = '#908b87'; ctx.fillRect(17, 22, 386, 256)
  ctx.fillStyle = '#62576b'; ctx.fillRect(27, 32, 366, 236)
  ctx.fillStyle = '#97847e'; ctx.fillRect(39, 44, 342, 212)
  ctx.fillStyle = '#535a69'; ctx.fillRect(49, 53, 322, 193)
  ctx.strokeStyle = '#bd9a88'; ctx.lineWidth = 2.5
  for (const x of [93, 210, 327]) {
    ctx.beginPath(); ctx.moveTo(x, 79); ctx.quadraticCurveTo(x + 9, 133, x + 43, 150)
    ctx.quadraticCurveTo(x + 11, 166, x, 219); ctx.quadraticCurveTo(x - 12, 165, x - 43, 150)
    ctx.quadraticCurveTo(x - 11, 131, x, 79); ctx.closePath(); ctx.stroke()
  }
  const project = await prepareAssetImport(catalog, { file: await canvasBlob(image), name: '自备位图地毯', kind: 'prop',
    widthMm: 3100, heightMm: 1950, footprintWidthMm: 2700, footprintHeightMm: 1650,
    blocksMovement: false, blocksSight: false, renderLayer: 'ground', shadowClass: 'none',
    licenseText: 'Sceneweave browser test fixture. Original generated geometric rug. MIT.', attribution: 'Sceneweave original bitmap fixture', canEmbed: true }, { runtime, validation })
  const engine = workspace()
  await engine.adoptNew(project)
  const floorId = Object.keys(project.document.floors)[0], layerId = Object.keys(project.document.userLayers)[0]
  const rug = Object.values(project.document.propDefinitions).find(definition => definition.name === '自备位图地毯')!
  const ref = (key: string) => {
    const definition = project.document.propDefinitions[themePackDefinitionId('fantasy', 'prop', key)]
    return { id: definition.id, version: definition.version }
  }
  const materialId = themePackDefinitionId('fantasy', 'material', 'tavern-plank'), roomId = 'art-style-cabin-room'
  const supportRef = { kind: 'room' as const, id: roomId }
  const bounds = { x: 0, y: 0, width: 9000, height: 5900 }
  await engine.execute([{ type: 'setFloorOutputBounds', id: floorId, outputBoundsMm: bounds }])
  await engine.execute([{ type: 'setSceneBackground', background: { mode: 'transparent' } }, { type: 'renameScene', title: '画风验收客房' }])
  const commands: CompositionCommand[] = [
    { type: 'createRoom', id: roomId, floorId, layerId, boundaryMm: rectangle(550, 580, 7730, 4760), thicknessMm: 200, purpose: '客房',
      materialRef: { id: materialId, version: project.document.materials[materialId].version } },
    { type: 'addProp', id: 'art-style-bed', floorId, layerId, definitionRef: ref('straw-bed'), positionMm: { x: 6770, y: 2680 }, supportRef },
    { type: 'addProp', id: 'art-style-table', floorId, layerId, definitionRef: ref('trestle-table'), positionMm: { x: 2760, y: 2300 }, supportRef },
    { type: 'addProp', id: 'art-style-bench', floorId, layerId, definitionRef: ref('wooden-bench'), positionMm: { x: 2760, y: 1450 }, supportRef },
    { type: 'addProp', id: 'art-style-barrel', floorId, layerId, definitionRef: ref('barrel'), positionMm: { x: 7340, y: 1250 }, supportRef },
    { type: 'addProp', id: 'art-style-sack', floorId, layerId, definitionRef: ref('grain-sack'), positionMm: { x: 7340, y: 4530 }, supportRef },
    { type: 'addProp', id: 'art-style-rug', floorId, layerId, definitionRef: { id: rug.id, version: rug.version }, positionMm: { x: 4640, y: 3730 }, supportRef },
    { type: 'createNote', id: privateNote, floorId, layerId, anchor: { type: 'point', positionMm: { x: 1450, y: 4050 } },
      kind: 'label', text: privateNoteTexts[0], visibility: 'gm' },
    { type: 'upsertManualMask', id: 'art-style-private-mask', floorId, layerId, boundsMm: { x: 900, y: 3830, width: 1180, height: 1210 } },
  ]
  await engine.execute(commands)
  await engine.flush()
  const latest = engine.getState().project as EditableProject
  return { bounds, floorId, revision: latest.document.revision, bed: latest.document.props['art-style-bed'].positionMm, rug: latest.document.props['art-style-rug'].positionMm }
}

export async function renderArtStyleEvidence() {
  const engine = workspace(), project = engine.getState().project!
  const original = { version: 1, active: 'original', presets: structuredClone(ART_STYLE_DEFAULTS) } satisfies LegacySceneArtStyle
  const handOnly = { ...original, active: 'handDrawn' } satisfies LegacySceneArtStyle
  const teaOnly = { ...original, active: 'tea' } satisfies LegacySceneArtStyle
  const both = { ...original, active: 'both' } satisfies LegacySceneArtStyle
  const tea = { ...original, active: 'tea', presets: { ...original.presets, tea: { ...ART_STYLE_DEFAULTS.tea, grain: 0 } } } satisfies LegacySceneArtStyle
  const style = (active: 'tea' | 'handDrawn', depth: number, strength = 100): LegacySceneArtStyle => ({ ...tea, active, presets: {
    ...tea.presets, [active]: { ...tea.presets.tea, depth, strength },
  } })
  const paper = (grainSize: number): LegacySceneArtStyle => ({ ...tea, presets: { ...tea.presets, tea: { ...tea.presets.tea, grain: 65, grainSize } } })
  const skip = (preset: 'handDrawn' | 'tea'): LegacySceneArtStyle => ({
    ...both, presets: { ...both.presets, [preset]: { ...both.presets[preset], strength: 0 } },
  })
  const compareStrength = (preset: 'handDrawn' | 'tea', strength: number, legacy = false): LegacySceneArtStyle => {
    const { paintVersion, ...parameters } = original.presets[preset]
    return { ...original, active: preset, presets: { ...original.presets, [preset]: { ...parameters, strength, ...(legacy ? {} : { paintVersion }) } } }
  }
  const options = { audience: 'gm' as const, longEdgePx: 1100 }
  const legacyBrush = { ...teaOnly, presets: { ...teaOnly.presets, tea: { ...teaOnly.presets.tea, paintVersion: 2 as const } } }
  const images = []
  try {
    for (const value of [original, handOnly, teaOnly, both, tea, style('tea', 0), style('handDrawn', 72), style('tea', 72, 0), paper(0), paper(75), skip('handDrawn'), skip('tea'),
      compareStrength('handDrawn', 50), compareStrength('tea', 50), compareStrength('handDrawn', 100, true), compareStrength('tea', 100, true), legacyBrush]) {
      images.push(await renderEditorProject(toBundle(project), { ...options, artStyleDraft: value }))
    }
    const [base, hand, teaDefault, stacked, styled, shallow, sameKnobsHandDrawn, none, fine, coarse, noHand, noTea,
      halfHand, halfTea, legacyHand, legacyTea, oldBrush] = images.map(canvas => canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height))
    const count = (a: ImageData, b: ImageData, box = [0, 0, 1, 1], alphaOnly = false) => {
      let different = 0
      for (let y = Math.round(box[1] * a.height); y < Math.round(box[3] * a.height); y++) {
        for (let x = Math.round(box[0] * a.width); x < Math.round(box[2] * a.width); x++) {
          const i = (y * a.width + x) * 4
          if (alphaOnly ? a.data[i + 3] !== b.data[i + 3] : [0, 1, 2, 3].some(c => a.data[i + c] !== b.data[i + c])) different++
        }
      }
      return different
    }
    const differenceFromOriginal = (image: ImageData) => {
      let difference = 0
      for (let i = 0; i < base.data.length; i += 4) {
        difference += Math.abs(base.data[i] - image.data[i]) + Math.abs(base.data[i + 1] - image.data[i + 1]) + Math.abs(base.data[i + 2] - image.data[i + 2])
      }
      return difference
    }
    const board = document.createElement('canvas'), width = images[0].width, height = images[0].height
    board.width = width * 2 + 54; board.height = height * 2 + 118
    const ctx = board.getContext('2d')!
    ctx.fillStyle = '#f5f1e8'; ctx.fillRect(0, 0, board.width, board.height)
    ctx.fillStyle = '#343b33'; ctx.font = '600 25px sans-serif'
    for (const [i, text] of ['原画', '仅手绘', '仅茶绘', '手绘 + 茶绘'].entries()) {
      const x = 18 + i % 2 * (width + 18), y = 13 + Math.floor(i / 2) * (height + 51)
      ctx.fillText(text, x, y + 22); ctx.drawImage(images[i], x, y + 34)
    }
    await downloadProof(board)
    return { bedDepth: count(styled, shallow, [.71, .32, .80, .54]), woodDepth: count(styled, shallow, [.13, .16, .2, .35]),
      rugDepth: count(styled, shallow, [.45, .59, .59, .75]),
      sameKnobsBed: count(styled, sameKnobsHandDrawn, [.71, .32, .80, .54]), rugTone: count(base, styled, [.45, .59, .59, .75]),
      rugGrain: count(styled, fine, [.45, .59, .59, .75]), rugGrainSize: count(fine, coarse, [.45, .59, .59, .75]),
      zeroStrength: count(base, none), styledAlpha: count(base, styled, undefined, true),
      stackedAlpha: count(base, stacked, undefined, true), stackedFromHand: count(hand, stacked), stackedFromTea: count(teaDefault, stacked),
      zeroHand: count(teaDefault, noHand), zeroTea: count(hand, noTea),
      handHalf: differenceFromOriginal(halfHand), handFull: differenceFromOriginal(hand), legacyHand: differenceFromOriginal(legacyHand),
      teaHalf: differenceFromOriginal(halfTea), teaFull: differenceFromOriginal(teaDefault), legacyTea: differenceFromOriginal(legacyTea),
      barrelBrush: count(teaDefault, oldBrush, [.78, .16, .84, .265]),
      sackBrush: count(teaDefault, oldBrush, [.78, .70, .84, .825]),
      unchangedAlpha: count(teaDefault, oldBrush, undefined, true) }
  } finally { for (const canvas of images) canvas.width = canvas.height = 0 }
}

export async function artStylePrivatePair() {
  const engine = workspace(), project = engine.getState().project!
  const exportBytes = async (audience: 'gm' | 'player') => new Uint8Array(await (await exportPng(toBundle(engine.getState().project!), { audience, longEdgePx: 700 })).arrayBuffer())
  const oldPlayer = await exportBytes('player'), oldGm = await exportBytes('gm')
  await engine.execute([
    { type: 'updateNote', id: privateNote, changes: { text: privateNoteTexts[1] } },
  ])
  const changedPlayer = await exportBytes('player'), changedGm = await exportBytes('gm')
  const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, index) => value === b[index])
  return { samePlayer: equal(oldPlayer, changedPlayer), sameGm: equal(oldGm, changedGm), style: project.document.artStyle }
}

export async function verifyMixedLineArt() {
  const engine = workspace(), project = engine.getState().project!
  const rug = project.document.props['art-style-rug'], { floorId } = rug, layerId = project.document.entityLayers[rug.id]
  if (!rug.definitionRef) throw new Error('Missing bitmap fixture definition.')
  await engine.execute([{ type: 'setFloorOutputBounds', id: floorId, outputBoundsMm: { x: 0, y: 0, width: 20000, height: 8000 } }])
  await engine.execute([
    { type: 'setSceneBackground', background: { mode: 'solid', color: '#CAC4A5' } },
    { type: 'setSceneArtStyle', style: { ...defaultSceneArtStyle(), active: 'lineArt' } },
  ])
  await engine.execute([
    { type: 'deleteProp', id: rug.id },
    { type: 'createPath', id: 'art-style-remote-road', floorId, layerId, widthMm: 1000,
      centerlineMm: [{ x: 11500, y: 3000 }, { x: 14500, y: 3000 }, { x: 17000, y: 3600 }, { x: 19100, y: 3600 }],
      supportRefs: [{ kind: 'floor', id: floorId }] },
  ])
  const render = async () => {
    const output = await renderProject(toBundle(engine.getState().project!), { audience: 'player', longEdgePx: 1000, floorId })
    const context = output.getContext('2d')!
    const pixels = { road: context.getImageData(530, 70, 455, 230).data, indoor: context.getImageData(70, 115, 310, 150).data }
    output.width = output.height = 0
    return pixels
  }
  const native = await render()
  await engine.execute([{ type: 'addProp', id: 'art-style-remixed-rug', floorId, layerId,
    definitionRef: rug.definitionRef, supportRef: rug.supportRef, positionMm: rug.positionMm,
  }])
  const mixed = await render()
  const filter = neutralColorFilter()
  filter.curves.red[1].output = 130
  await engine.execute([{ type: 'upsertVisualFilter', filter: {
    id: 'art-style-regional-dye', floorId, layerId, visibility: 'public', editLocked: false, enabled: true, seed: 'art-style-dye',
    target: { kind: 'region', boundaryMm: rectangle(1300, 2200, 6400, 2900) }, preset: 'neutral',
    exposure: 1, saturation: 1, contrast: 1, vignette: 0, grain: 0, colorFilter: filter,
  } }])
  const scoped = await render()
  const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => a.reduce((count, value, index) => count + Number(value !== b[index]), 0)
  return { remoteRoadChanged: difference(native.road, mixed.road), rugChanged: difference(native.indoor, mixed.indoor),
    roadInk: mixed.road.reduce((count, value, index) => count + Number(index % 4 === 0 && value < 155), 0),
    regionalChanged: difference(mixed.indoor, scoped.indoor), outsideRegionChanged: difference(mixed.road, scoped.road) }
}
