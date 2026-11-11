import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../../shared/validation/json.js'
import { validateSceneDocument } from '../../../shared/validation/scene.js'
import { connectionFootprint } from '../../../shared/geometry/geometry.js'
import { polygonBoolean } from '../../../shared/geometry/polygon-boolean.js'
import { createCompositionContent } from '../../../shared/appearance/graph.js'
import { visualBase } from '../../../shared/visual/base.js'
import { projectScene } from '../../../shared/projection/projection.js'
import { checkTerrainRoute } from '../../../shared/geometry/terrain-travel.js'
import { resolveBuildingEntrancePort } from '../../../shared/generation/building-port.js'
import { createDetailedIslandDocument } from './detailed-island.js'
import { createThemePackSampleDocument } from './theme-pack-catalog.js'
import { createNaturalDetailIslandDocument, createNaturalDetailOutpostDocument } from './natural-detail-samples.js'
import { OUTPOST_VEGETATION_V2_GROUP_IDS } from './outpost-vegetation-v2.js'
import { VEGETATION_DETAIL_SPECS } from '../../../shared/visual/vegetation-detail-art.js'

const now = '2026-11-10T00:00:00.000Z'
describe('new independently identified natural detail samples', () => {
  it('connects explicit new rock profiles and grass transitions while retaining the old physical island and fixed art', () => {
    const original = createDetailedIslandDocument({ sceneId: 'same', now }), before = canonicalJson(original)
    const next = createNaturalDetailIslandDocument({ sceneId: 'same', now })
    expect(next.presetSnapshot.presetId).toBe('sceneweave-natural-detail-island')
    expect(next.terrainAreas['q1-low'].groundElevationMm).toBe(800)
    expect(next.terrainAreas['q1-high'].groundElevationMm).toBe(2600)
    const a = connectionFootprint(original.terrainConnections['q1-stairs']), b = connectionFootprint(next.terrainConnections['q1-stairs'])
    for (const [subject, clip] of [[a,b],[b,a]]) expect(polygonBoolean({ operation: 'difference', subject: [subject], clip: [clip] }).polygons).toEqual([])
    expect(next.terrainConnections['q1-stairs'].route!.renderProfile).toBe('naturalRockSteps2')
    expect(visualBase(next)!.edgeLooks['q1-crown-cliff'].renderProfile).toBe('rockRelief2')
    for (const key of ['assets','materials','propDefinitions','styleThemes','props','paths','terrainEdges','constraints','entityLayers'] as const) expect(next[key]).toEqual(original[key])
    for (const audience of ['gm','player'] as const) expect(projectScene(next,audience).connections[0].route!.renderProfile).toBe('naturalRockSteps2')
    expect(validateSceneDocument(next).ok).toBe(true); expect(canonicalJson(original)).toBe(before)
    expect(createDetailedIslandDocument({sceneId:'same',now})).toEqual(original)
  })
  it('builds three saved outpost densities using the same immutable artwork, complete real groups and clear door road', () => {
    const counts:number[]=[]
    for (const density of ['sparse','balanced','dense'] as const) {
      const source = createThemePackSampleDocument('wilderness',0,{sceneId:'same',now,outpostVegetation:density})
      const before=canonicalJson(source), next=createNaturalDetailOutpostDocument({sceneId:'same',now,density})
      expect(next.presetSnapshot.presetId).toBe('sceneweave-natural-detail-outpost')
      for (const key of ['floors','vertices','rooms','walls','openings','paths','terrainEdges','terrainConnections','constraints'] as const) expect(next[key]).toEqual(source[key])
      for (const [id,definition] of Object.entries(source.propDefinitions)) expect(next.propDefinitions[id]).toEqual(definition)
      for (const [id,asset] of Object.entries(source.assets)) expect(next.assets[id]).toEqual(asset)
      const members=OUTPOST_VEGETATION_V2_GROUP_IDS.flatMap(id=>Object.values(next.scatterGroups[id].members).flatMap(member=>member.propId?[next.props[member.propId]]:[]))
      for (const spec of VEGETATION_DETAIL_SPECS) expect(members.some(prop=>prop.definitionRef?.id===spec.definitionId)).toBe(true)
      counts.push(members.length)
      const path=next.paths['theme-sample-path-2'], port=resolveBuildingEntrancePort(next,'watch-entrance',path.widthMm)
      expect(checkTerrainRoute(next,{floorId:port.floorId,pointsMm:[port.insideMm,...path.centerlineMm],widthMm:path.widthMm}).issues).toEqual([])
      expect(validateSceneDocument(next).ok).toBe(true)
      let sequence=0
      const content=createCompositionContent(next,{ids:{nextId:()=>`natural-outpost-token-${++sequence}`},clock:{now:()=>now}})
      expect(content.document).toEqual(next)
      expect(validateSceneDocument(JSON.parse(canonicalJson(next))).ok).toBe(true)
      expect(canonicalJson(source)).toBe(before)
    }
    expect(counts[1]).toBeGreaterThan(counts[0]); expect(counts[2]).toBeGreaterThan(counts[1])
  }, 15000)
})
