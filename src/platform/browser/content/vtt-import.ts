import { z } from 'zod'
import { fromBundle } from '../../../application/workspace/project.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { inspectDependencies } from '../../../shared/geometry/dependencies.js'
import type { PointMm } from '../../../shared/model/scene.js'
import { sha256Bytes } from '../../../shared/project/binary.js'
import { parseBoundedJson } from '../../../shared/project/json.js'
import { PACKAGE_LIMITS } from '../../../shared/project/limits.js'
import { createMemoryResources } from '../../../shared/project/resources.js'
import { encodeUtf8 } from '../../../shared/validation/json.js'
import { runtime, validation } from '../runtime.js'
import { normalizeBrowserImage } from '../images/adapter.js'
import { createVisualBlankDocument } from './visual-samples.js'

const point = z.object({ x: z.number().finite(), y: z.number().finite() })
const line = z.array(point).min(2).max(1025)
const uvtt = z.object({
  format: z.literal(.2),
  resolution: z.object({ map_origin: point, map_size: point, pixels_per_grid: z.number().int().min(1).max(2048) }),
  image: z.string().min(1).max(Math.ceil(PACKAGE_LIMITS.imageBytes / 3) * 4),
  line_of_sight: z.array(line).max(1024).default([]),
  objects_line_of_sight: z.array(line).max(1024).default([]),
  portals: z.array(z.object({ bounds: z.tuple([point, point]), closed: z.boolean(), freestanding: z.boolean().optional() })).max(256).default([]),
  lights: z.array(z.object({
    position: point, range: z.number().positive(), intensity: z.number().min(0).max(20),
    color: z.string().regex(/^(?:[a-f0-9]{2})?[a-f0-9]{6}$/i), shadows: z.boolean().default(true),
  })).max(64).default([]),
})
const foundry = z.object({
  name: z.string().trim().min(1).max(120),
  width: z.number().int().positive().max(32000),
  height: z.number().int().positive().max(32000),
  grid: z.object({ type: z.literal(1), size: z.number().int().min(1).max(2048), distance: z.number().positive() }),
  levels: z.array(z.object({ _id: z.string().min(1) })).max(1).optional(),
  walls: z.array(z.object({
    c: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
    move: z.number().int().min(0).default(1), sight: z.number().int().min(0).default(1),
    door: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
    ds: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  })).max(1024).default([]),
  lights: z.array(z.object({
    x: z.number().finite(), y: z.number().finite(), walls: z.boolean().default(true), hidden: z.boolean().default(false),
    config: z.object({ dim: z.number().nonnegative().default(0), bright: z.number().nonnegative().default(0),
      alpha: z.number().min(0).max(1).default(.5), color: z.string().regex(/^#[a-f0-9]{6}$/i).nullish() }),
  })).max(64).default([]),
})
export const VTT_FILE_BYTES = 32 * 1024 * 1024
export type VttImportOptions = { title: string; gridMm: number; attribution: string; license: string }
type ImportedWall = { points: PointMm[]; movement: boolean; sight: boolean;
  opening?: { kind: 'door' | 'window'; open: boolean; locked: boolean; secret: boolean } }
type ImportedLight = { position: PointMm; range: number; intensity: number; color: string; shadows: boolean; hidden?: boolean }

function readVttJson(bytes: Uint8Array, foundryScene = false): unknown {
  if (bytes.length === 0 || bytes.length > VTT_FILE_BYTES) throw new Error('VTT 文件须为非空且不超过 32 MiB。')
  return parseBoundedJson(bytes, { values: 0 }, foundryScene ? { values: 120_000, depth: 32 } : { values: 30_000, depth: 12 })
}

export async function importUvtt(bytes: Uint8Array, options: VttImportOptions, signal: AbortSignal) {
  signal.throwIfAborted()
  const checked = uvtt.safeParse(readVttJson(bytes))
  if (!checked.success) throw new Error('仅支持含内嵌图片的 Universal VTT 0.2 文件。请检查比例、墙线、门和灯的字段。')
  const input = checked.data
  const binary = atob(input.image.replace(/^data:image\/(?:png|jpeg|webp);base64,/, ''))
  const original = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) original[i] = binary.charCodeAt(i)
  const image = await normalizeBrowserImage(original, '', { signal })
  const { map_origin: origin, map_size: size, pixels_per_grid: ppg } = input.resolution
  if (Math.abs(size.x * ppg - image.record.pixelWidth) > 1 || Math.abs(size.y * ppg - image.record.pixelHeight) > 1) throw new Error('VTT 底图尺寸与每格像素和地图格数不符。')
  const wallRows: ImportedWall[] = [...input.line_of_sight, ...input.objects_line_of_sight].map(points => ({ points, movement: true, sight: true }))
  for (const portal of input.portals) wallRows.push({ points: portal.bounds, movement: true, sight: true,
    opening: { kind: portal.closed ? 'door' : 'window', open: false, locked: false, secret: false } })
  return createVttProject(image, origin, size, wallRows, input.lights, options, 'Universal VTT 0.2', signal)
}

export async function importFoundryScene(bytes: Uint8Array, backdrop: Uint8Array, originPx: PointMm, options: VttImportOptions, signal: AbortSignal) {
  signal.throwIfAborted()
  const checked = foundry.safeParse(readVttJson(bytes, true))
  if (!checked.success) throw new Error('请选择从 Foundry 导出的单层方格场景 JSON，包含尺寸、格距和墙线。')
  const scene = checked.data
  if (!Number.isSafeInteger(originPx.x) || !Number.isSafeInteger(originPx.y)) throw new Error('Foundry 底图原点须为整数像素。')
  const grid = scene.grid.size, toGrid = (x: number, y: number) => ({ x: x / grid, y: y / grid })
  const walls: ImportedWall[] = scene.walls.map(({ c, move, sight, door, ds }) => ({
    points: [toGrid(c[0], c[1]), toGrid(c[2], c[3])], movement: move !== 0, sight: sight !== 0,
    ...(door ? { opening: { kind: 'door', open: ds === 1, locked: ds === 2, secret: door === 2 } } : {}),
  }))
  const lights: ImportedLight[] = scene.lights.filter(light => light.config.dim || light.config.bright).map(light => ({
    position: toGrid(light.x, light.y), range: Math.max(light.config.dim, light.config.bright) / scene.grid.distance,
    intensity: light.config.alpha * 10, color: light.config.color ?? '#FFFFFF', shadows: light.walls, hidden: light.hidden,
  }))
  const image = await normalizeBrowserImage(backdrop, '', { signal })
  return createVttProject(image, toGrid(originPx.x, originPx.y), toGrid(scene.width, scene.height),
    walls, lights, { ...options, title: scene.name }, 'Foundry VTT Scene', signal)
}

async function createVttProject(image: Awaited<ReturnType<typeof normalizeBrowserImage>>, origin: PointMm, size: PointMm,
  wallRows: ImportedWall[], lights: ImportedLight[], options: VttImportOptions, source: string, signal: AbortSignal) {
  const grid = z.number().int().min(100).max(10000).parse(options.gridMm)
  const attribution = z.string().trim().min(1).max(240).parse(options.attribution)
  const license = z.string().trim().min(1).max(4000).parse(options.license)
  const widthMm = Math.round(size.x * grid), heightMm = Math.round(size.y * grid)
  const scene = createVisualBlankDocument({ title: options.title, widthMm, heightMm, preset: 'investigation', gridVisible: true })
  scene.constraints = { entranceOpeningIds: [], wallEndClearanceMm: 0, pathChecks: [] }
  scene.units = { world: 'mm', display: 'm', gridSizeMm: grid, snapMm: Math.max(1, Math.floor(grid / 10)), gridVisible: true }
  scene.presetSnapshot = { presetId: 'uvtt-import', presetVersion: 1, distanceMode: 'metric', gridSizeMm: grid, source: `${source}，由导入者确认每格毫米数。` }
  const floor = Object.values(scene.floors)[0], floorId = floor.id
  const layerId = Object.values(scene.userLayers).find(value => value.floorId === floorId && value.name === '建筑')?.id
    ?? Object.values(scene.userLayers).find(value => value.floorId === floorId)!.id
  scene.materials = {}; scene.propDefinitions = {}; scene.styleThemes = {}; scene.activeStyleThemeRef = null
  const hash = image.record.sha256, licenseHash = sha256Bytes(encodeUtf8(license))
  const assetId = `vtt-image-${hash}`, bounds = { x: 0, y: 0, width: widthMm, height: heightMm }
  floor.artwork = { assetId, boundsMm: bounds }
  scene.assets = { [assetId]: { id: assetId, sha256: hash, mimeType: 'image/png', pixelWidth: image.record.pixelWidth, pixelHeight: image.record.pixelHeight,
    logicalSizeMm: { width: widthMm, height: heightMm }, licenseRef: `vtt-${licenseHash}`, origin: { kind: 'imported', attribution, canEmbed: true } } }
  const convert = (p: PointMm): PointMm => {
    const x = Math.round((p.x - origin.x) * grid), y = Math.round((p.y - origin.y) * grid)
    if (![x, y].every(Number.isSafeInteger) || x < 0 || x > widthMm || y < 0 || y > heightMm) throw new Error('VTT 中有坐标超出底图。')
    return { x, y }
  }
  const vertices = new Map<string, string>(), walls = new Map<string, string>(), common = { floorId, editLocked: false }
  const addVertex = ({ x, y }: PointMm) => {
    const key = `${x},${y}`, existing = vertices.get(key)
    if (existing) return existing
    const id = `vtt-vertex-${vertices.size + 1}`
    vertices.set(key, id); scene.vertices[id] = { id, ...common, xMm: x, yMm: y }; scene.entityLayers[id] = layerId
    return id
  }
  const addWall = (a: PointMm, b: PointMm, row: ImportedWall) => {
    signal.throwIfAborted()
    const start = addVertex(a), end = addVertex(b), key = [start, end].sort().join('|')
    if (start === end) throw new Error('VTT 墙线换算到毫米后长度为零。')
    const existing = walls.get(key)
    if (existing) {
      const wall = scene.walls[existing]
      if (wall.blocksMovement !== row.movement || wall.blocksSight !== row.sight) throw new Error('VTT 重复墙段的阻挡设置冲突。')
      return existing
    }
    if (walls.size >= 1024) throw new Error('VTT 编辑导入最多支持 1024 条墙段。')
    const id = `vtt-wall-${walls.size + 1}`
    walls.set(key, id)
    scene.walls[id] = { id, ...common, startVertexId: start, endVertexId: end, thicknessMm: 80, blocksMovement: row.movement, blocksSight: row.sight, topStyle: null }
    scene.entityLayers[id] = layerId
    return id
  }
  const openedWalls = new Set<string>()
  for (const row of wallRows) {
    const points = row.points.map(convert)
    for (let offset = 1; offset < points.length; offset++) addWall(points[offset - 1], points[offset], row)
    if (!row.opening) continue
    const [a, b] = points, wallId = addWall(a, b, row), wall = scene.walls[wallId]
    if (openedWalls.has(wallId)) throw new Error('VTT 中有重叠门窗。')
    openedWalls.add(wallId)
    const id = `vtt-opening-${openedWalls.size}`
    scene.openings[id] = { id, ...common, wallId, offsetReferenceVertexId: wall.startVertexId, offsetMm: 0,
      widthMm: Math.floor(Math.hypot(b.x - a.x, b.y - a.y)), kind: row.opening.kind,
      state: row.opening.open ? 'open' : 'closed', locked: row.opening.locked, secret: row.opening.secret, revealed: false }
    scene.entityLayers[id] = layerId
  }
  if (scene.visual?.version !== 3 || scene.visual.base.version !== 2) throw new Error('VTT 导入所需的灯光系统不可用。')
  for (const [index, light] of lights.entries()) {
    const id = `vtt-light-${index + 1}`
    scene.visual.base.base.lights[id] = { id, ...common, layerId, visibility: light.hidden ? 'gm' : 'public', positionMm: convert(light.position),
      radiusMm: Math.round(light.range * grid), color: `#${light.color.slice(-6).toUpperCase()}`, intensity: light.intensity / 10,
      enabled: true, wallOcclusion: light.shadows }
  }
  const content = createCompositionContent(scene, runtime)
  signal.throwIfAborted()
  return fromBundle({ project: {
    ...content, format: 'sceneweave-complete-project', schemaVersion: 1, authoringSources: {},
    assets: { [hash]: image.record },
    licenses: { [licenseHash]: { sha256: licenseHash, text: license } },
    licenseBindings: inspectDependencies(content.document).subjects.map(subject => ({ ...subject, licensePath: `licenses/${licenseHash}.txt`, embedding: 'allowed' })),
  }, resources: createMemoryResources(new Map([[hash, image.bytes]])) }, { ...validation, signal })
}
