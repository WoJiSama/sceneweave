import type { BoundsMm, Decoration, PointMm, SceneDocument } from '../model/scene.js'
import { scenePresentation } from '../appearance/presentation.js'
import type { ProjectedDecoration } from '../projection/types.js'

/** Finite paint only. Compact records never acquire collider or support-object duties. */
export function decorationPaintGeometry(scene: SceneDocument, value: Decoration): ProjectedDecoration {
  const source = scene.propDefinitions[value.definitionRef.id]
  if (!source || source.version !== value.definitionRef.version || source.defaultAppearance.kind !== 'image') throw new Error('轻量装饰需要确切版本的固定图片定义。')
  const scale = value.scalePpm / 1_000_000, bounds = source.defaultVisualBoundsMm
  const presentation = scenePresentation(scene, value.id), root = presentation?.mode === 'nearSide' ? presentation.rootAnchorMm : { x: 0, y: 0 }
  return { id: value.id, positionMm: { ...value.positionMm }, rotationDeg: presentation?.mode === 'nearSide' ? 0 : value.rotationDeg,
    visualBoundsMm: { x: (bounds.x - root.x) * scale, y: (bounds.y - root.y) * scale, width: bounds.width * scale, height: bounds.height * scale },
    assetId: source.defaultAppearance.assetId, opacity: source.defaultAppearance.opacity, renderLayer: source.defaultRenderLayer, renderOrder: value.renderOrder }
}

export function decorationPaintPolygon(value: Pick<ProjectedDecoration, 'positionMm' | 'rotationDeg' | 'visualBoundsMm'>): PointMm[] {
  const bounds = value.visualBoundsMm, angle = value.rotationDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  return [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x + bounds.width, bounds.y + bounds.height], [bounds.x, bounds.y + bounds.height]]
    .map(([x, y]) => ({ x: value.positionMm.x + x * c - y * s, y: value.positionMm.y + x * s + y * c }))
}

export function decorationPaintBounds(value: Pick<ProjectedDecoration, 'positionMm' | 'rotationDeg' | 'visualBoundsMm'>): BoundsMm {
  const points = decorationPaintPolygon(value), x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y))
  return { x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y }
}
