import { describe, expect, it } from 'vitest'
import { fixture, runtime } from '../../application/workspace/test-fixtures.js'
import { cloneJson } from '../validation/json.js'
import { createHistoryIdentity, createHistoryIdentityTrace, validateHistoryIdentityShape } from '../history/identity.js'
import type { HistoryIdentity } from '../model/history.js'
import type { AttachmentScene } from './topology.js'
import { applyAttachmentCommand, attachmentCommandSchemas, type AttachmentCommand } from './commands.js'
import { followAttachments } from './state.js'
import { syncNewAttachmentProofs, validateAttachmentProofs } from './identity.js'
import { inspectAttachments } from './validation.js'
import { resolvePropContact } from './contact.js'
import { createCarvedStrip } from '../carved-rock/index.js'
import type { AttachmentSurface } from './contracts.js'
import { createEmbeddedAttachmentPlan } from './state.js'

function setup(building = false) {
  const scene = fixture({ building }).project.document
  const host = scene.props.item, child = scene.props.other
  host.positionMm = { x: 6000, y: 6000 }; host.rotationDeg = 0; host.footprintMm = { width: 2400, height: 1600 }; host.footprintOffsetMm = { x: 0, y: 0 }; host.blocksMovement = false
  child.positionMm = { x: 6200, y: 6000 }; child.rotationDeg = 0; child.footprintMm = { width: 400, height: 200 }; child.footprintOffsetMm = { x: 0, y: 0 }; child.blocksMovement = false
  return { scene: scene as AttachmentScene, identity: createHistoryIdentity(scene, runtime) }
}
const top: AttachmentCommand = { type: 'addAttachmentSurface', id: 'table-top', owner: { kind: 'prop', id: 'item' },
  feature: { kind: 'propTop', polygonLocalMm: [{ x: -1000, y: -600 }, { x: 1000, y: -600 }, { x: 1000, y: 600 }, { x: -1000, y: 600 }], heightLocalMm: 800 }, capabilities: ['support'] }
const bind: AttachmentCommand = { type: 'bindPropAttachment', id: 'on-table', childId: 'other', surfaceId: 'table-top', mode: 'support', follow: 'follow', anchorState: 'manual',
  anchor: { kind: 'horizontal', localMm: { x: 200, y: 0 }, heightOffsetMm: 0, rotationOffsetDeg: 0 } }
function command(state: ReturnType<typeof setup>, value: AttachmentCommand) {
  const before = cloneJson(state.scene), trace = createHistoryIdentityTrace(state.identity, before, runtime)
  applyAttachmentCommand(state.scene, value, runtime, state.identity)
  const observed = trace.capture(state.scene)
  syncNewAttachmentProofs(before, state.scene, observed)
  state.identity = trace.finish(state.scene)
}
function supported() { const s = setup(); command(s, top); command(s, bind); return s }

describe('explicit instance attachment contact and continuity', () => {
  it('supports the full physical footprint and records the real table elevation without changing root support', () => {
    const s = supported(), contact = resolvePropContact(s.scene, 'other')
    expect(contact.actualSurfaceId).toBe('table-top'); expect(contact.contactElevationMm).toBe(800)
    expect(contact.rootSupportRef).toEqual(s.scene.props.item.supportRef)
    expect(inspectAttachments(s.scene)).toEqual([]); expect(validateAttachmentProofs(s.scene, s.identity)).toEqual([])
    expect(s.identity.structureTokens?.['table-top'].kind).toBe('attachmentSurface')
    expect(s.identity.structureTokens?.['on-table'].kind).toBe('attachment')
  })
  it('rejects a rotated footprint even while its root point and all floor support are valid', () => {
    const s = setup(); command(s, top)
    s.scene.props.other.footprintMm = { width: 1600, height: 1000 }
    expect(() => command(s, { ...bind, anchor: { kind: 'horizontal', localMm: { x: 0, y: 0 }, heightOffsetMm: 0, rotationOffsetDeg: 45 } })).toThrow(/完整旋转占地/)
  })
  it('rejects a horizontal face outside the host actual footprint and forbids a hovering height offset', () => {
    const s = setup()
    expect(() => command(s, { ...top, feature: { kind: 'propTop', polygonLocalMm: [{ x: -2000, y: -2000 }, { x: 2000, y: -2000 }, { x: 2000, y: 2000 }], heightLocalMm: 800 } })).toThrow(/承托面超出宿主/)
    command(s, top)
    expect(() => command(s, { ...bind, anchor: { kind: 'horizontal', localMm: { x: 0, y: 0 }, heightOffsetMm: 1, rotationOffsetDeg: 0 } })).toThrow(/悬空/)
  })
  it('moves and rotates a manual local anchor once, preserving its stored local placement and real birth proofs', () => {
    const s = supported(), before = cloneJson(s.scene), proofs = cloneJson(s.scene.attachments!['on-table'].proofs)
    s.scene.props.item.positionMm = { x: 7000, y: 6500 }; s.scene.props.item.rotationDeg = 90
    const result = followAttachments(before, s.scene, s.identity)
    expect(s.scene.props.other.positionMm).toEqual({ x: 7000, y: 6700 }); expect(s.scene.props.other.rotationDeg).toBe(90)
    expect(s.scene.attachments!['on-table'].anchor).toEqual(bind.type === 'bindPropAttachment' ? bind.anchor : null)
    expect(s.scene.attachments!['on-table'].proofs).toEqual(proofs)
    expect(new Set(result.affectedIds)).toEqual(new Set(['other', 'on-table']))
    expect(resolvePropContact(s.scene, 'other').contactElevationMm).toBe(800)
    expect(inspectAttachments(s.scene)).toEqual([])
  })
  it('turns explicit in-face child editing into a manual local anchor and rejects leaving the face', () => {
    const s = supported(), before = cloneJson(s.scene)
    s.scene.props.other.positionMm = { x: 6500, y: 6100 }
    followAttachments(before, s.scene, s.identity)
    expect(s.scene.attachments!['on-table'].anchor).toMatchObject({ localMm: { x: 500, y: 100 } })
    const next = cloneJson(s.scene); s.scene.props.other.positionMm = { x: 9000, y: 9000 }
    expect(() => followAttachments(next, s.scene, s.identity)).toThrow(/完整旋转占地/)
  })
  it('respects fixed placement and all recursive note or layer locks during real host following', () => {
    const fixed = supported(); fixed.scene.attachments!['on-table'].follow = 'fixed'
    const baseline = cloneJson(fixed.scene); fixed.scene.props.item.positionMm.x += 100
    expect(() => followAttachments(baseline, fixed.scene, fixed.identity)).toThrow(/fixed/)
    for (const lock of ['layer', 'note'] as const) {
      const s = supported()
      if (lock === 'layer') s.scene.userLayers[s.scene.entityLayers.other].editLocked = true
      else {
        s.scene.notes.locked = { id: 'locked', floorId: s.scene.props.other.floorId, editLocked: true, kind: 'note', text: 'protected', visibility: 'gm', anchor: { type: 'entity', entityKind: 'prop', entityId: 'other' } }
        s.scene.entityLayers.locked = s.scene.entityLayers.other
      }
      const previous = cloneJson(s.scene); s.scene.props.item.positionMm.x += 100
      expect(() => followAttachments(previous, s.scene, s.identity)).toThrow(/锁定/)
    }
  })
  it('refuses implicit host deletion, support switching, self cycles and a public child on a private host', () => {
    const deleted = supported(), before = cloneJson(deleted.scene); delete deleted.scene.props.item
    expect(() => followAttachments(before, deleted.scene, deleted.identity)).toThrow(/不存在|删除/)
    const secret = setup(); secret.scene.props.item.visibility = 'gm'; command(secret, top)
    expect(() => command(secret, bind)).toThrow(/公开/)
    const self = setup(); command(self, top)
    expect(() => command(self, { ...bind, childId: 'item' })).toThrow(/自附着|成环/)
  })
  it('does not refresh existing surface or relation claims when a host birth has retired', () => {
    const s = supported(), before = cloneJson(s.scene), changed = cloneJson(s.identity)
    changed.propTokens.item = 'different-real-host-birth'
    expect(validateAttachmentProofs(s.scene, changed).some(issue => issue.code === 'ATTACHMENT_SURFACE_PROOF')).toBe(true)
    expect(() => syncNewAttachmentProofs(before, s.scene, changed)).toThrow(/退休|失效/)
  })
  it('refuses reusing a detached surface ID and prevents public witness injection', () => {
    const s = supported(); command(s, { type: 'detachPropAttachment', id: 'on-table' }); command(s, { type: 'removeAttachmentSurface', id: 'table-top' })
    expect(() => command(s, top)).toThrow(/退休|占用/)
    expect(attachmentCommandSchemas[0].safeParse({ ...top, proofs: { lineageId: 'forged' } }).success).toBe(false)
    expect(attachmentCommandSchemas[2].safeParse({ ...bind, proofs: { child: 'forged' } }).success).toBe(false)
  })
  it('counts attachment births in the common identity budget and rejects globally reused topology tokens', () => {
    const s = supported(), malformed = cloneJson(s.identity)
    malformed.structureTokens!['on-table'].topologyToken = malformed.structureTokens!['table-top'].token
    expect(() => validateHistoryIdentityShape(malformed)).toThrow(/全局唯一/)
    const oversized: HistoryIdentity = cloneJson(s.identity)
    for (let i = 0; i < 65536; i++) oversized.structureTokens![`retired-surface-${i}`] = { kind: 'attachmentSurface', token: `birth-${i}`, topologyToken: `topo-${i}`, topologyHash: 'a'.repeat(64) }
    expect(() => validateHistoryIdentityShape(oversized)).toThrow(/65536/)
  })
  it('rejects host following when actual recursively updated relations and children exceed 256 targets', () => {
    const s = setup(), template = cloneJson(s.scene.props.other), layerId = s.scene.entityLayers.other
    for (let i = 0; i < 129; i++) { const childId = `child-${i}`; s.scene.props[childId] = { ...cloneJson(template), id: childId }; s.scene.entityLayers[childId] = layerId }
    s.identity = createHistoryIdentity(s.scene, runtime); command(s, top)
    const initial = cloneJson(s.scene), trace = createHistoryIdentityTrace(s.identity, initial, runtime)
    for (let i = 0; i < 129; i++) applyAttachmentCommand(s.scene, { ...bind, id: `relation-${i}`, childId: `child-${i}` }, runtime, s.identity)
    const observed = trace.capture(s.scene); syncNewAttachmentProofs(initial, s.scene, observed); s.identity = trace.finish(s.scene)
    const before = cloneJson(s.scene); s.scene.props.item.positionMm.x += 100
    expect(() => followAttachments(before, s.scene, s.identity)).toThrow(/预算超限|256/)
    expect(before.props.item.positionMm.x).toBe(6000)
  })
  it('proves the chosen wall side and height, rejecting a wrong side and any overlap with a real opening', () => {
    const s = setup(true)
    const wall: AttachmentCommand = { type: 'addAttachmentSurface', id: 'wall-face', owner: { kind: 'wall', id: 'wall-0' }, feature: { kind: 'wallSide', referenceVertexId: 'vertex-0', side: 'left', startMm: 0, endMm: 7000, lowMm: 0, highMm: 3000 }, capabilities: ['hang'] }
    command(s, wall)
    const hang: AttachmentCommand = { type: 'bindPropAttachment', id: 'lamp-hang', childId: 'other', surfaceId: 'wall-face', mode: 'hang', follow: 'follow', anchorState: 'managed',
      anchor: { kind: 'vertical', referenceVertexId: 'vertex-0', alongMm: 2000, heightMm: 1800, heightExtentMm: 400, normalOffsetMm: 100, rotationOffsetDeg: 0 } }
    command(s, hang)
    expect(resolvePropContact(s.scene, 'other').contactElevationMm).toBe(1800)
    const moved = cloneJson(s.scene); s.scene.props.other.positionMm.y = 2900
    expect(() => followAttachments(moved, s.scene, s.identity)).toThrow(/错误墙侧|墙体/)
    const opening = setup(true)
    opening.scene.openings.door = { id: 'door', floorId: 'blank-floor', editLocked: false, wallId: 'wall-0', offsetReferenceVertexId: 'vertex-0', offsetMm: 1800, widthMm: 1000, kind: 'door', state: 'open', locked: false, secret: false, revealed: false }
    opening.scene.entityLayers.door = opening.scene.entityLayers.item
    opening.identity = createHistoryIdentity(opening.scene, runtime); command(opening, wall)
    expect(() => command(opening, hang)).toThrow(/门窗开口/)
  })
  it('signs a newly materialized road only after its real birth and follows complete manual geometry by rigid translation', () => {
    const s = setup(), layerId = s.scene.entityLayers.item
    delete s.scene.props.item; delete s.scene.props.other; delete s.scene.entityLayers.item; delete s.scene.entityLayers.other
    const host = { id: 'rock', floorId: 'blank-floor', editLocked: false, visibility: 'public' as const, groundElevationMm: 2000,
      rockBody: { baseElevationMm: -500 }, coveragePriority: 0, surfaceStyle: null, blocksMovement: false, blocksSight: false, movementCostMultiplier: 1,
      boundaryMm: [{ x: 1000, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 1000, y: 8000 }].map((positionMm, i) => ({ id: `rp-${i}`, segmentId: `rs-${i}`, positionMm })) }
    s.scene.terrainAreas.rock = host; s.scene.entityLayers.rock = layerId; s.identity = createHistoryIdentity(s.scene, runtime)
    command(s, { type: 'addAttachmentSurface', id: 'rock-face', owner: { kind: 'terrainArea', id: 'rock' }, feature: { kind: 'rockSourceFace', sourceSegmentIds: ['rs-0'] }, capabilities: ['embed'] })
    const before = cloneJson(s.scene), trace = createHistoryIdentityTrace(s.identity, before, runtime)
    const strip = cloneJson(createCarvedStrip(host, { attachmentId: 'road-embed', walkSurfaceId: 'road-walk', sourceSegmentIds: ['rs-0'], cutSide: 'right', widthMm: 1000,
      pointsMm: [{ x: 1000, y: 1500, z: 0 }, { x: 10000, y: 1500, z: 2000 }] }, runtime))
    strip.stations[0].state = 'manual'
    s.scene.terrainConnections.road = { id: 'road', floorId: 'blank-floor', editLocked: false, visibility: 'public', kind: 'ramp', widthMm: 1000,
      from: { surfaceRef: { kind: 'floor', id: 'blank-floor' }, positionMm: { x: 1000, y: 1500 } },
      to: { surfaceRef: { kind: 'terrainArea', id: 'rock' }, positionMm: { x: 10000, y: 1500 } },
      openingId: null, blocksMovement: false, movementCostMultiplier: 1, surfaceStyle: null, carvedStrip: strip }
    s.scene.entityLayers.road = layerId
    s.scene.attachmentSurfaces!['road-walk'] = { id: 'road-walk', owner: { kind: 'terrainConnection', id: 'road' }, feature: { kind: 'carvedWalk', faceIds: [...strip.walkFaceIds] }, capabilities: ['support', 'walk'] } as AttachmentSurface
    const plan = createEmbeddedAttachmentPlan(s.scene, { id: 'road-embed', connectionId: 'road', surfaceIds: ['rock-face'], follow: 'follow', managedScope: 'wholeStrip', anchorState: 'manual' }, s.identity)
    expect(plan.attachment.proofs).toBeUndefined()
    ;(s.scene.attachments ??= {})['road-embed'] = plan.attachment
    const observed = trace.capture(s.scene); syncNewAttachmentProofs(before, s.scene, observed); s.identity = trace.finish(s.scene)
    expect(s.scene.attachments!['road-embed'].proofs.child.birthToken).toBe(s.identity.outdoorTokens.road.token)
    const saved = cloneJson(s.scene), oldProofs = cloneJson(s.scene.attachments!['road-embed'].proofs), station = cloneJson(strip.stations[0])
    for (const p of s.scene.terrainAreas.rock.boundaryMm) p.positionMm.x += 200
    followAttachments(saved, s.scene, s.identity)
    expect(s.scene.terrainConnections.road.carvedStrip!.stations[0]).toEqual(station)
    expect(s.scene.terrainConnections.road.carvedStrip!.verticesMm[station.centerVertexId].x).toBe(1200)
    expect(s.scene.terrainConnections.road.from.positionMm.x).toBe(1200)
    expect(s.scene.attachments!['road-embed'].proofs).toEqual(oldProofs)
    expect(inspectAttachments(s.scene)).toEqual([])
    const baseline = cloneJson(s.scene); s.scene.terrainAreas.rock.groundElevationMm += 1
    expect(() => followAttachments(baseline, s.scene, s.identity)).toThrow(/同高程|刚性/)
  })
})
