import { describe, expect, it } from 'vitest'
import { fixture, runtime, validation } from '../../../application/workspace/test-fixtures.js'
import { applyCompositionDraftCommands } from '../../../shared/appearance/commands.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import type { SceneCommand } from '../../../shared/commands/commands.js'
import { prepareLibraryEntry } from '../../../shared/library/content.js'
import { importProject } from '../../../shared/project/file.js'
import { projectScene } from '../../../shared/projection/projection.js'
import type { Projection } from '../../../shared/projection/types.js'
import { cloneJson } from '../../../shared/validation/json.js'
import { directionToLight, shadowDirection } from '../../../shared/visual/directional-light.js'
import { ObliqueMesh, rectangle } from './oblique-mesh.js'
import { addWorldSurfaces, addWorldWalls } from './oblique-surfaces.js'
import { projectGround } from './projected-ground.js'
import { createReliefBrush } from '../../../shared/geometry/terrain-relief-edit.js'
import { createTerrainRelief, reliefBounds } from '../../../shared/geometry/terrain-relief.js'
import { createSupportQuery } from '../../../shared/geometry/support-sample.js'
import { wallGeometry } from '../../../shared/geometry/wall-paint-geometry.js'

const floorId = 'blank-floor'
const drawOnly = () => undefined
const canvas = (width: number, height: number) => ({
  width, height,
  getContext: () => ({ scale: drawOnly, translate: drawOnly, beginPath: drawOnly,
    moveTo: drawOnly, lineTo: drawOnly, closePath: drawOnly, fill: drawOnly }),
}) as unknown as HTMLCanvasElement

const content = (building = false) => {
  const { document } = fixture({ building }).project
  for (const id of Object.keys(document.props)) {
    delete document.props[id]
    delete document.entityLayers[id]
  }
  return createCompositionContent(document, runtime)
}
const edit = (source: ReturnType<typeof content>, ...commands: SceneCommand[]) => applyCompositionDraftCommands(source, commands, runtime)
const project = (source: ReturnType<typeof content>, audience: 'gm' | 'player' = 'gm') =>
  projectScene(source.document, audience, source.appearance, { floorId, spatial: true })
const meshed = (projection: Projection) => {
  const mesh = new ObliqueMesh()
  const surfaces = { mesh, projection, ground: projectGround(projection), blankGround: true, zOffset: 0,
    earthenSteps: new Map(), images: new Map(), texture: canvas(1, 1), temporaryCanvas: canvas }
  addWorldSurfaces(surfaces)
  addWorldWalls(surfaces, wallGeometry(projection.walls))
  return mesh
}
const vertices = (mesh: ObliqueMesh) => [...mesh.batches.values()].flatMap(values =>
  Array.from({ length: values.length / 8 }, (_, i) => values.slice(i * 8, i * 8 + 8)))

const terrain = { type: 'createTerrainArea', id: 'rock', floorId, visibility: 'public', surfaceStyle: null, groundElevationMm: 2000,
  boundaryMm: rectangle({ x: 6000, y: 4000, width: 12000, height: 10000 }) } as const

function cutHost() {
  return edit(content(), { ...terrain, boundaryMm: [...terrain.boundaryMm] },
    { type: 'setRockBody', id: 'rock', rockBody: { baseElevationMm: -500 } },
    { type: 'createRockShell', id: 'rock', widthMm: 1000, direction: { x: 0, y: 1 }, seed: 'cold-stable-shell',
      excludedSegmentIds: ['rock:segment:0', 'rock:segment:3'] },
    { type: 'addAttachmentSurface', id: 'rock-face', owner: { kind: 'terrainArea', id: 'rock' },
      feature: { kind: 'rockSourceFace', sourceSegmentIds: ['rock:segment:0'] }, capabilities: ['embed'] })
}
const cutRoad = (visibility: 'public' | 'gm', layerId: string): SceneCommand => ({
  type: 'createCarvedMountainPath', id: 'mountain-path', attachmentId: 'path-embed', walkSurfaceId: 'path-walk', sourceSurfaceId: 'rock-face',
  fromSurfaceRef: { kind: 'floor', id: floorId }, toSurfaceRef: { kind: 'terrainArea', id: 'rock' },
  pointsMm: [{ x: 6000, y: 6000, z: 0 }, { x: 16000, y: 6000, z: 2000 }], widthMm: 1000, cutSide: 'right', layerId, visibility, follow: 'follow',
})

describe('oblique geometry from the editable scene', () => {
  it('draws a saved shell and the exposed cut walls, with private cuts absent from the player mesh', () => {
    const source = cutHost()
    const shell = source.document.terrainAreas.rock.rockBody!.shell!
    const player = project(source, 'player')
    const savedFaces = player.rocks![0].spatial!.shellFaces
    expect(savedFaces).toHaveLength(Object.keys(shell.faces).length)
    const points = vertices(meshed(player))
    expect(points.some(([x, , z]) => x > 18000 && z > 0)).toBe(true)
    expect(points.some(([, , , , , normalZ]) => normalZ === 0)).toBe(true)
    const cut = edit(source, cutRoad('gm', source.document.entityLayers.rock))
    expect(project(cut).rocks![0].patches.length).toBeGreaterThan(0)
    expect(project(cut).rocks![0].spatial!.walls.some(wall => wall.lowMm.some(z => z > 0))).toBe(true)
    expect(vertices(meshed(project(cut, 'player')))).toEqual(points)
  })

  it('sculpts the rock crown around a saved cut while keeping its road, rim and player coverage', () => {
    const source = cutHost(), layer = source.document.entityLayers.rock
    const visible = edit(source, cutRoad('public', layer))
    const hidden = edit(source, cutRoad('gm', layer))
    const stroke = { points: [{ x: 10600, y: 6000 }, { x: 13600, y: 8600 }], radiusMm: 1800, amountMm: 460 }
    const brush = createReliefBrush(visible.document, floorId, 'rock')
    expect(brush.marks(stroke).length).toBeGreaterThan(0)
    expect(() => brush.plan(stroke, false)).toThrow(/保留承托/)
    const sculpt = (ground: typeof source, request: typeof stroke) => edit(ground,
      ...createReliefBrush(ground.document, floorId, 'rock').plan(request, true)
        .map(({ area, relief }): SceneCommand => ({ type: 'updateTerrainArea', id: area.id, changes: { relief } })))
    const after = sculpt(visible, stroke)
    expect(after.document.terrainConnections).toEqual(visible.document.terrainConnections)
    expect(after.document.terrainAreas.rock.rockBody).toEqual(visible.document.terrainAreas.rock.rockBody)
    const beforeQuery = createSupportQuery(visible.document, floorId), afterQuery = createSupportQuery(after.document, floorId)
    for (const p of [{ x: 10800, y: 6000 }, { x: 16300, y: 6400 }]) expect(afterQuery.sample(p)).toEqual(beforeQuery.sample(p))
    expect(afterQuery.sample({ x: 13600, y: 8600 })!.zMm).toBeGreaterThan(2350)
    const projectAfter = project(after)
    expect(projectAfter.rocks).toEqual(project(visible).rocks)
    expect(meshed(projectAfter).top).toBeGreaterThan(2350)

    expect(() => sculpt(hidden, stroke)).toThrow(/私密承托/)
    const away = { ...stroke, points: [{ x: 13000, y: 11000 }] }
    expect(vertices(meshed(project(sculpt(hidden, away), 'player')))).toEqual(vertices(meshed(project(sculpt(source, away), 'player'))))
    const bad = createTerrainRelief(reliefBounds(terrain.boundaryMm), p => Math.abs(p.y - 6000) < 900 && p.x > 9000 && p.x < 14000 ? 500 : 0)
    expect(() => edit(visible, { type: 'updateTerrainArea', id: 'rock', changes: { relief: bad } })).toThrow(/切口的完整接合/)
  })

  it('closes a shared edge with equal base levels, including a reversal of the actual high side', () => {
    const lower = { ...terrain, id: 'bottom', boundaryMm: rectangle({ x: 6000, y: 1000, width: 12000, height: 3000 }), groundElevationMm: 0 }
    const source = edit(content(), lower, { ...terrain, boundaryMm: [...terrain.boundaryMm], groundElevationMm: 0,
      relief: { version: 1, columns: 2, rows: 2, offsetsMm: [600, -600, 1200, -1200] } })
    const projection = project(source)
    expect(projection.edges).toHaveLength(0)
    expect(projection.spatialReliefEdges?.some(edge => edge.start.y === 4000 && edge.end.y === 4000)).toBe(true)
    const side = vertices(meshed(projection)).filter(([, y, , nx, , nz]) => y === 4000 && Math.abs(nx) < .01 && nz === 0)
    expect(side.some(([x, , z, , ny]) => x === 6000 && z === 600 && ny === -1)).toBe(true)
    expect(side.some(([x, , z, , ny]) => x === 18000 && z === -600 && ny === 1)).toBe(true)
    expect(side.some(([x, , z]) => x === 12000 && z === 0)).toBe(true)
  })

  it('uses explicit wall and window heights while hiding the full geometry of secret openings', () => {
    const wall = edit(content(true), { type: 'setWallHeight', id: 'wall-0', heightMm: 2900 })
    const opening = { type: 'addOpening', id: 'window', wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0',
      offsetMm: 2000, widthMm: 900, kind: 'window', vertical: { sillMm: 670, heightMm: 1030 } } as const
    const visible = edit(wall, opening)
    expect(meshed(project(visible)).top).toBe(2900)
    expect(vertices(meshed(project(visible))).some(([, , z]) => z === 1700)).toBe(true)
    expect(() => edit(visible, { type: 'setWallHeight', id: 'wall-0', heightMm: 1500 })).toThrow(/墙高/)
    const hidden = edit(wall, { ...opening, secret: true })
    expect(vertices(meshed(project(hidden, 'player')))).toEqual(vertices(meshed(project(wall, 'player'))))
  })

  it('retains a licensed side bitmap in the fixed library and only projects its visible uses', async () => {
    const original = fixture({ image: true })
    const data = cloneJson(original.project)
    const definition = data.document.propDefinitions.definition
    const asset = data.document.assets.image
    data.document.assets.side = { ...asset, id: 'side' }
    const binding = data.licenseBindings.find(row => row.subjectKind === 'asset' && row.subjectId === asset.id)!
    data.licenseBindings.push({ ...binding, subjectId: 'side' })
    definition.defaultVolume = { kind: 'box', heightMm: 1170, sideAssetId: 'side' }
    data.document.props.item.visibility = 'gm'
    const entry = await prepareLibraryEntry({ project: data, resources: original.resources }, { kind: 'prop', definitionId: definition.id }, validation)
    const reopened = await importProject(entry.capsule, validation)
    expect(reopened.project.document.assets.side.sha256).toBe(asset.sha256)
    expect(reopened.project.licenseBindings.some(row => row.subjectId === 'side')).toBe(true)
    expect(projectScene(data.document, 'gm', data.appearance, { floorId, spatial: true }).propVolumes!.item.sideAssetId).toBe('side')
    const covered = edit({ document: data.document, historyIdentity: data.historyIdentity, appearance: data.appearance },
      { type: 'upsertManualMask', id: 'side-mask', floorId, boundsMm: data.document.exportBoundsMm })
    expect(project(covered, 'player').assetIds).not.toContain('side')
  })

  it('uses the exterior of a solid and the opposite of the shadow direction for light', () => {
    const polygon = rectangle({ x: 0, y: 0, width: 1000, height: 200 })
    for (const ring of [polygon, [...polygon].reverse()]) {
      const mesh = new ObliqueMesh()
      mesh.solid({}, ring, 0, 900)
      const side = vertices(mesh).filter(([, y, , nx, , nz]) => y === 0 && nx === 0 && nz === 0)
      expect(side.length).toBeGreaterThan(0)
      expect(side.every(([, , , nx, ny]) => nx === 0 && ny === -1)).toBe(true)
    }
    const [x, y] = directionToLight({ lightDirectionDeg: 135 }), shadow = shadowDirection(135)
    expect(x * shadow.y - y * shadow.x).toBeCloseTo(0)
    expect(x * shadow.x + y * shadow.y).toBeLessThan(0)
  })
})
