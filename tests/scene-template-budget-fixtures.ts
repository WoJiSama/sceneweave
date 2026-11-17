import { fixture, runtime, validation } from '../src/application/workspace/test-fixtures'
import { fromBundle, toBundle } from '../src/application/workspace/project'
import { prepareCompositionCommands } from '../src/application/workspace/prepare'
import { createCompositionContent } from '../src/shared/appearance/graph'
import { prepareSceneTemplate } from '../src/shared/scene-templates/content'
import type { SceneCommand } from '../src/shared/commands/commands'

/** Real shared-wall geometry and independently editable furniture, with actual
 * portable bytes; this is a load fixture, not a published art sample. */
export async function largerBuildingTemplate(furniturePerRoom = 36) {
  const bundle = fixture({ building: true }), scene = bundle.project.document
  scene.exportBoundsMm.width = scene.exportBoundsMm.height = 60000
  scene.floors['blank-floor'].boundsMm.width = scene.floors['blank-floor'].boundsMm.height = 60000
  Object.assign(bundle.project, createCompositionContent(scene, runtime))
  let project = await fromBundle(bundle, validation)
  const layerId = scene.entityLayers.room, commands: SceneCommand[] = []
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (x || y) {
    const left = 3000 + x * 7000, top = 3000 + y * 7000
    commands.push({ type: 'createRoom', id: `large-room-${x}-${y}`, floorId: 'blank-floor', layerId, thicknessMm: 200,
      boundaryMm: [{ x: left, y: top }, { x: left + 7000, y: top }, { x: left + 7000, y: top + 7000 }, { x: left, y: top + 7000 }], purpose: `大建筑房间${x + y * 4 + 1}` })
  }
  project = await prepareCompositionCommands(project, commands, { validation, runtime })
  const data = structuredClone(toBundle(project).project), original = data.document.props.item
  data.document.props = {}; delete data.document.entityLayers.item; delete data.document.entityLayers.other
  for (const [index, room] of Object.values(data.document.rooms).entries()) for (let n = 0; n < furniturePerRoom; n++) {
    const id = `large-furniture-${index}-${n}`
    // The first vertex may be a shared endpoint: use actual minimum coordinates.
    const points = room.boundaryVertexIds.map(id => data.document.vertices[id]), x = Math.min(...points.map(v => v.xMm)), y = Math.min(...points.map(v => v.yMm))
    data.document.props[id] = { ...structuredClone(original), id, positionMm: { x: x + 1000 + n % Math.ceil(Math.sqrt(furniturePerRoom)) * Math.floor(5000 / Math.ceil(Math.sqrt(furniturePerRoom))), y: y + 1000 + Math.floor(n / Math.ceil(Math.sqrt(furniturePerRoom))) * Math.floor(5000 / Math.ceil(Math.sqrt(furniturePerRoom))) }, roomId: room.id, supportRef: { kind: 'room', id: room.id } }
    data.document.entityLayers[id] = layerId
  }
  Object.assign(data, createCompositionContent(data.document, runtime))
  return prepareSceneTemplate({ project: data, resources: project.resources }, { name: '十六房建筑负载样本', roomIds: Object.keys(data.document.rooms) }, { validation, runtime })
}
