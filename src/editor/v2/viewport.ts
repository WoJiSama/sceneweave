import type { BoundsMm, PointMm } from '../../core/v2/types'

/** Ephemeral view state. It never enters the scene document, history or exports. */
export interface MapViewportV2 { zoom: number; panX: number; panY: number }
export interface ViewportSizeV2 { width: number; height: number }
export const FIT_VIEWPORT_V2: MapViewportV2 = { zoom: 1, panX: 0, panY: 0 }
export const MIN_VIEW_ZOOM_V2 = .25
export const MAX_VIEW_ZOOM_V2 = 8

export function fittedMapSizeV2(size: ViewportSizeV2, bounds: BoundsMm): ViewportSizeV2 {
  const scale = Math.min(size.width / bounds.width, size.height / bounds.height)
  return { width: bounds.width * scale, height: bounds.height * scale }
}
export function constrainViewportV2(view: MapViewportV2, size: ViewportSizeV2, bounds: BoundsMm): MapViewportV2 {
  const zoom = Math.max(MIN_VIEW_ZOOM_V2, Math.min(MAX_VIEW_ZOOM_V2, Number.isFinite(view.zoom) ? view.zoom : 1))
  const fit = fittedMapSizeV2(size, bounds)
  // Keep at least a small part of the map reachable; Fit always restores the whole view.
  const limitX = Math.max(0, (fit.width * zoom + size.width) / 2 - Math.min(32, size.width / 2))
  const limitY = Math.max(0, (fit.height * zoom + size.height) / 2 - Math.min(32, size.height / 2))
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, Number.isFinite(value) ? value : 0))
  return { zoom, panX: clamp(view.panX, limitX), panY: clamp(view.panY, limitY) }
}
/** Resize editor chrome without refitting the world. Clamp only at existing view limits. */
export function resizeViewportV2(view: MapViewportV2, previous: ViewportSizeV2, next: ViewportSizeV2, bounds: BoundsMm): MapViewportV2 {
  const oldFit = fittedMapSizeV2(previous, bounds), nextFit = fittedMapSizeV2(next, bounds)
  const requestedZoom = view.zoom * oldFit.width / nextFit.width
  const zoom = Math.max(MIN_VIEW_ZOOM_V2, Math.min(MAX_VIEW_ZOOM_V2, requestedZoom))
  // Pan is measured in screen pixels. It stays constant when scale is retained;
  // at a zoom limit, scale pan by the same ratio to retain the center world point.
  const scaleRatio = nextFit.width * zoom / (oldFit.width * view.zoom)
  return constrainViewportV2({ zoom, panX: view.panX * scaleRatio, panY: view.panY * scaleRatio }, next, bounds)
}
/** Keep the map point under the pointer fixed while zooming, except at pan limits. */
export function zoomViewportV2(view: MapViewportV2, factor: number, pointer: PointMm, size: ViewportSizeV2, bounds: BoundsMm): MapViewportV2 {
  const zoom = Math.max(MIN_VIEW_ZOOM_V2, Math.min(MAX_VIEW_ZOOM_V2, view.zoom * (Number.isFinite(factor) && factor > 0 ? factor : 1)))
  const ratio = zoom / view.zoom, x = pointer.x - size.width / 2, y = pointer.y - size.height / 2
  return constrainViewportV2({ zoom, panX: x - (x - view.panX) * ratio, panY: y - (y - view.panY) * ratio }, size, bounds)
}
export function viewportMapRectV2(view: MapViewportV2, size: ViewportSizeV2, bounds: BoundsMm) {
  const fit = fittedMapSizeV2(size, bounds), width = fit.width * view.zoom, height = fit.height * view.zoom
  return { x: (size.width - width) / 2 + view.panX, y: (size.height - height) / 2 + view.panY, width, height }
}
export function viewportToWorldV2(point: PointMm, view: MapViewportV2, size: ViewportSizeV2, bounds: BoundsMm): PointMm {
  const rect = viewportMapRectV2(view, size, bounds)
  return { x: bounds.x + (point.x - rect.x) / rect.width * bounds.width, y: bounds.y + (point.y - rect.y) / rect.height * bounds.height }
}
