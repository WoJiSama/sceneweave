import { prepareCompositionCommands, prepareFloorArtwork } from '../../../application/workspace/prepare.js'
import { fromBundle, toBundle, type EditableProject } from '../../../application/workspace/project.js'
import { selectManualCommandBudget } from '../../../shared/budget/manual-request.js'
import { TERRAIN_FACADES } from '../../../shared/appearance/terrain-facade.js'
import { defaultMaterialPaint } from '../../../shared/appearance/surface-paint.js'
import { terrainEdgeFinishCommands } from '../../../shared/commands/terrain-edge-finish.js'
import { resolveBuildingEntrancePort } from '../../../shared/generation/building-port.js'
import { adoptLibraryEntries } from '../../../shared/library/content.js'
import type { PreparedLibraryEntry } from '../../../shared/library/types.js'
import type { CompositionCommand } from '../../../shared/model/appearance.js'
import type { SurfaceStyle } from '../../../shared/model/scene.js'
import { bridgeSideOffset } from '../../../shared/path-assembly/profiles.js'
import { defaultStaircase } from '../../../shared/stairs/contracts.js'
import { emptyVisualSystem } from '../../../shared/visual/types.js'
import { runtime, validation } from '../runtime.js'
import { createBlankProject } from './factories.js'
import { industrialDefinitionRef as ref, prepareIndustrialCatalog } from './industrial-catalog.js'
import { INDUSTRIAL_LAYOUTS, type XY } from './industrial-layouts.js'

const bounds = { x: 0, y: 0, width: 60000, height: 46000 }
const point = ([x, y]: XY) => ({ x, y })
const ground = (id: string) => ({ kind: 'terrainArea' as const, id })
const platform = (level: string, name: string) => ground(level + '-' + name)
const streets = (level: string) => level + '-streets'
const fixtures = (level: string) => level + '-fixtures'
const roofLayer = 'upper-roofs'

export async function createIndustrialSampleProject(variant: 0 | 1, signal?: AbortSignal,
  importedEntries?: PreparedLibraryEntry[]): Promise<EditableProject> {
  const spec = INDUSTRIAL_LAYOUTS[variant]
  const ports = { ...validation, signal }
  const blank = await createBlankProject({ title: spec.title, widthMm: bounds.width, heightMm: bounds.height, preset: 'investigation' }, signal)
  const entries = importedEntries ?? await prepareIndustrialCatalog(signal)
  let project = await fromBundle((await adoptLibraryEntries(toBundle(blank), entries, ports)).bundle, ports)
  const backdrop = Object.keys(project.document.floors)[0]
  const backdropArt = project.document.propDefinitions[ref('prop', 'haze').id].defaultAppearance
  if (backdropArt.kind !== 'image') throw new Error('工业远景底图缺少固定图像。')
  const levels = [['lower', spec.lower], ['upper', spec.upper]] as const
  const commit = async (label: string, commands: CompositionCommand[]) => {
    signal?.throwIfAborted()
    if (!commands.length) return
    try {
      project = await prepareCompositionCommands(project, commands, { runtime, validation: ports, signal, budget: selectManualCommandBudget(project, commands) })
    } catch (cause) {
      signal?.throwIfAborted()
      throw new Error(label + ' · ' + (cause instanceof Error ? cause.message : String(cause)), { cause })
    }
  }
  const material = (key: string, kind?: 'path'): SurfaceStyle => ({
    base: defaultMaterialPaint(project.document.materials[ref('material', key).id], kind), overlays: [],
  })
  const environment = { ...emptyVisualSystem().environment, ambientColor: '#132D3D', ambientOpacity: .24,
    lightDirectionDeg: 318, contactShadowMm: 245, contactShadowOpacity: .48 }
  await commit('建立叠绘楼层', [
    { type: 'renameFloor', id: backdrop, name: '可替换远景底图' },
    { type: 'setFloorOutputBounds', id: backdrop, outputBoundsMm: bounds },
    ...levels.map(([id, level]): CompositionCommand => ({ type: 'createFloor', id, name: level.title,
      boundsMm: bounds, outputBoundsMm: bounds, newLayerId: streets(id), layerName: '道路、平台与承托' })),
    { type: 'setFloorUnderlay', id: 'lower', underlayFloorId: backdrop },
    { type: 'setFloorUnderlay', id: 'upper', underlayFloorId: 'lower' },
    { type: 'setFloorLinks', id: 'lower', links: [{ id: 'service-lift', name: '检修升降机', targetFloorId: 'upper', fromMm: point(spec.access[0]), toMm: point(spec.access[1]) }] },
    ...levels.map(([id]): CompositionCommand => ({ type: 'setFloorEnvironment', id, environment })),
  ])
  project = await prepareFloorArtwork(project, backdrop, { assetId: backdropArt.assetId, boundsMm: bounds }, { runtime, validation: ports, signal })
  await commit('设置出图底色', [{ type: 'setSceneBackground', background: { mode: 'solid', color: '#182B35' } }])
  await commit('建立编辑图层', [
    ...levels.map(([floorId]): CompositionCommand => ({ type: 'createLayer', id: fixtures(floorId), floorId, name: '设备、管线与灯具' })),
    { type: 'createLayer', id: roofLayer, floorId: 'upper', name: '可隐藏的屋面' },
  ])

  for (const [floorId, level] of levels) {
    const streetLayer = streets(floorId), fixtureLayer = fixtures(floorId)
    const bridgeDepthMm = floorId === 'upper' ? 2200 : 1050
    const visibleBridgeDepthMm = Math.round(bridgeSideOffset(bridgeDepthMm).y)
    const facades = new Map(level.facades?.map(([name, profile, settings]) => [name, {
      ...TERRAIN_FACADES[profile], ...(profile === 'girder-v1' && { depthMm: visibleBridgeDepthMm }), ...settings,
    }]))
    await commit('设置钢构平台', level.platforms.map(([name, outline, elevation = level.height, finish = 'service-floor'], index) => ({
      type: 'createTerrainArea', id: platform(floorId, name).id, floorId, layerId: name.endsWith('-cap') ? roofLayer : streetLayer,
      boundaryMm: outline.map(point), groundElevationMm: elevation, coveragePriority: index + 1,
      ...(facades.has(name) && { facade: facades.get(name)! }),
      surfaceStyle: material(finish),
    })))
    for (const [name] of level.platforms) {
      const id = platform(floorId, name).id, area = project.document.terrainAreas[id], roof = name.endsWith('-cap')
      const alloy = variant === 0 ? floorId === 'upper' : floorId === 'lower'
      let edgeIndex = 0
      await commit('平台钢板收边', terrainEdgeFinishCommands(project.document, area.boundaryMm.map(({ segmentId }) => ({ areaId: id, segmentId })),
        { color: alloy ? '#233E45' : '#33363A', strokeWidthMm: roof ? 190 : 320, bandWidthMm: roof ? 320 : 760 },
        () => id + '-steel-edge-' + edgeIndex++, { skipCovered: true, surfaceFor: () => {
          const style = material(alloy ? 'alloy-rim' : 'riveted-rim')
          return { ...style, base: { ...style.base, alignment: 'surface' } }
        } }))
    }
    const [bridgeStyle, widthMm, centerline] = level.bridge, bridgeId = floorId + '-bridge'
    const bridgeRef = ref('prefab', bridgeStyle)
    const { lengthMm, ...style } = project.document.prefabDefinitions[bridgeRef.id].pathStyle!
    await commit('组装桥面与边梁', [{ type: 'setPathAssembly', id: bridgeId, floorId, layerId: streetLayer, widthMm, centerlineMm: centerline.map(point),
      recipe: { ...style, section: { kind: 'prefab', ref: bridgeRef, lengthMm }, sides: 'both', shoulderMm: 1500, endClearanceMm: 340,
        structure: { ...style.structure!, relief: { depthMm: bridgeDepthMm, shadowOpacity: .66 } },
        ...(style.lamps && { lamps: { ...style.lamps, glow: { color: '#FFD08B', radiusMm: floorId === 'upper' ? 1280 : 1460, intensity: .66 } } }),
      },
      bridge: { elevationMm: level.height, visibility: 'public', finish: 'steel' } }])
    const deck = ground(project.document.paths[bridgeId].assembly!.bridge!.deckId)
    const asphalt = floorId === 'lower' && variant === 0
    const bridgePaint = material(asphalt ? 'service-asphalt' : 'deck', 'path')
    await commit('铺设道路', [
      { type: 'setVisualSurface', kind: 'path', id: bridgeId, style: bridgePaint },
      ...level.approaches.map(([support, points, approachWidth], index): CompositionCommand => ({ type: 'createPath', id: floorId + '-approach-' + index,
        floorId, layerId: streetLayer, widthMm: approachWidth ?? widthMm, centerlineMm: points.map(point), supportRefs: [platform(floorId, support), deck],
        materialRef: ref('material', floorId === 'lower' ? 'service-asphalt' : 'deck') })),
      ...(level.walkways ?? []).map(([name, support, widthMm, centerline]): CompositionCommand => ({ type: 'createPath',
        id: floorId + '-walkway-' + name, floorId, layerId: streetLayer, widthMm, centerlineMm: centerline.map(point),
        supportRefs: [platform(floorId, support), deck], materialRef: ref('material', 'service-asphalt') })),
    ])
    if (level.stairs) {
      const [start, from, end, to] = level.stairs
      await commit('接合金属台阶', [{ type: 'createTerrainConnection', id: floorId + '-service-stairs', kind: 'stairs', floorId, layerId: streetLayer,
        widthMm: 2120, from: { surfaceRef: platform(floorId, start), positionMm: point(from) }, to: { surfaceRef: platform(floorId, end), positionMm: point(to) },
        staircase: { ...defaultStaircase(), preset: 'metal-grate', material: 'iron', layout: { kind: 'repeat', treadDepthMm: 320 } } }])
    }
    for (const [name, closed, points, gaps] of level.fences ?? []) {
      const fenceRef = ref('prefab', closed ? 'service-fence' : floorId === 'upper' ? 'ion-bridge' : 'ember-bridge')
      const fence = project.document.prefabDefinitions[fenceRef.id].pathStyle!
      await commit('安装护栏和入口', [{ type: 'setFenceAssembly', id: floorId + '-fence-' + name, floorId, layerId: streetLayer,
        closed, visibility: 'public', centerlineMm: points.map(point), recipe: {
          section: { kind: 'prefab', ref: fenceRef, lengthMm: fence.lengthMm }, fit: true,
          dimensions: closed ? fence.dimensions : { visualWidthMm: 880, footprintWidthMm: 235 }, endClearanceMm: closed ? 0 : 215,
          ...(closed && { lamps: { every: 4, glow: { color: '#FFC480', radiusMm: 1060, intensity: .54 } } }),
          ...(gaps.length ? { gaps: gaps.map(([fromMm, toMm]) => ({ side: 'both', fromMm, toMm })) } : {}),
        } }])
    }
    const rimRef = ref('prefab', floorId === 'upper' ? 'ion-bridge' : 'ember-bridge')
    const rim = project.document.prefabDefinitions[rimRef.id].pathStyle!
    for (const [name, insetMm, edgeIndices] of level.platformFences) {
      const area = project.document.terrainAreas[platform(floorId, name).id]
      await commit('沿平台轮廓安装护栏 · ' + name, [{
        type: 'setFenceAssembly', id: floorId + '-fence-' + name + '-rim', floorId, layerId: streetLayer, visibility: 'public',
        platformBinding: { version: 1, platformId: area.id, insetMm, openingPolicy: 'structural',
          selection: edgeIndices ? { kind: 'segments', segmentIds: edgeIndices.map(index => area.boundaryMm[index].segmentId) } : { kind: 'all' },
        },
        recipe: { section: { kind: 'prefab', ref: rimRef, lengthMm: rim.lengthMm }, fit: true,
          dimensions: { visualWidthMm: 880, footprintWidthMm: 235 }, endClearanceMm: 0 },
      }])
    }
    const rooms = new Map<string, string>()
    for (const [name, support, [left, top, right, bottom], purpose] of level.rooms ?? []) {
      const id = floorId + '-room-' + name
      await commit(purpose, [{ type: 'createRoom', id, floorId, layerId: streetLayer,
        boundaryMm: [point([left, top]), point([right, top]), point([right, bottom]), point([left, bottom])], thicknessMm: 220, purpose,
        supportRef: platform(floorId, support), materialRef: ref('material', 'concrete') }])
      rooms.set(name, id)
      const { walls, vertices, constraints } = project.document
      const faces = Object.values(walls).filter(wall => wall.id.startsWith(id + ':wall:'))
      const doorWall = faces.find(wall => vertices[wall.startVertexId].yMm === bottom && vertices[wall.endVertexId].yMm === bottom)
      if (!doorWall) throw new Error('找不到用于安装入口的墙。')
      const doorId = id + '-door'
      await commit('安装厂房入口', [
        { type: 'addOpening', id: doorId, wallId: doorWall.id, offsetReferenceVertexId: doorWall.startVertexId,
          offsetMm: Math.round((right - left - 1800) / 2), widthMm: 1800, state: 'open', kind: 'door' },
        { type: 'setEntranceOpenings', ids: [...constraints.entranceOpeningIds, doorId] },
        { type: 'updateRoom', id, changes: { accessExpectation: 'required' } },
        ...faces.map((wall): CompositionCommand => ({ type: 'setVisualSurface', kind: 'wall', id: wall.id, style: material('deck') })),
      ])
    }
    await commit('布置屋面、设备和灯具', level.props.map(([key, x, y, rotationDeg, support], index) => {
      const roomId = rooms.get(support)
      return { type: 'addProp', id: floorId + '-' + key + '-' + index, floorId, layerId: support.endsWith('-cap') ? roofLayer : fixtureLayer,
        definitionRef: ref('prop', key), positionMm: { x, y }, rotationDeg,
        supportRef: roomId ? { kind: 'room', id: roomId } : platform(floorId, support) }
    }))
    await commit('实例化组合设备', (level.groups ?? []).map(([support, x, y, rotationDeg], index) => {
      const id = floorId + '-equipment-group-' + index
      return { type: 'instantiatePrefab', id, definitionRef: ref('prefab', 'pump-bank'), anchorMm: { x, y }, rotationDeg,
        layerId: fixtureLayer, supportRef: platform(floorId, support), memberIds: { tank: id + '-tank', switch: id + '-switch', pipe: id + '-pipe' } }
    }))
    const pipeRef = ref('prefab', 'cable-run')
    const { lengthMm: pipeLength, ...pipeStyle } = project.document.prefabDefinitions[pipeRef.id].pathStyle!
    for (const [name, visualWidthMm, centerline] of level.pipes ?? []) {
      await commit('沿实际路线安装冷却管 · ' + name, [{ type: 'setFenceAssembly', id: floorId + '-pipe-' + name, floorId,
        layerId: fixtureLayer, centerlineMm: centerline.map(point), closed: false, visibility: 'public', recipe: {
          ...pipeStyle, section: { kind: 'prefab', ref: pipeRef, lengthMm: pipeLength },
          dimensions: { ...pipeStyle.dimensions, visualWidthMm }, endClearanceMm: 0,
        } }])
    }
    for (const [name, widthMm, leadLengthMm, connection] of level.entrances ?? []) {
      const openingId = rooms.get(name) + '-door', pathId = floorId + '-entrance-' + name
      const port = resolveBuildingEntrancePort(project.document, openingId, widthMm)
      await commit('铺设厂房入口 · ' + name, [{ type: 'createPath', id: pathId, floorId, layerId: streetLayer, widthMm,
        centerlineMm: [port.outsideMm, ...connection.map(point)], supportRefs: [port.supportRef], materialRef: ref('material', 'service-asphalt') }])
      await commit('接续实际门洞 · ' + name, [{ type: 'bindPathAttachment', id: pathId + '-door-link', pathId, openingId,
        end: 'start', leadLengthMm, maxDisplacementMm: 1250 }])
    }
    const [text, x, y] = level.gm
    await commit('设置主持人注记', [{ type: 'createNote', id: floorId + '-gm-note', floorId, layerId: fixtureLayer, kind: 'clue',
      visibility: 'gm', text, anchor: { type: 'point', positionMm: { x, y } } }])
  }
  return project
}
