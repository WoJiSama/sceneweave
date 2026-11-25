import type { DrawingMarkKind, GenerationDrawing } from '../../platform/browser/generation/drawing'
import type { PointMm } from '../../shared/model/scene'

export const OUTLINE_MS = 580
export const FILL_DELAY_MS = 380
export const FILL_MS = 340
export const DETAIL_MS = 340

export interface GenerationPlayback {
  token: object
  drawing: GenerationDrawing
  origin: PointMm
  startedAt: number
  endsAt: number
  marks: (GenerationDrawing['marks'][number] & { startsAt: number })[]
}

export function isDrawingDetail(kind: DrawingMarkKind): boolean {
  return kind === 'opening' || kind === 'prop' || kind === 'plant'
}

export function updateGenerationPlayback(previous: GenerationPlayback | undefined, drawing: GenerationDrawing,
  origin: PointMm | undefined, now: number): GenerationPlayback {
  const startedAt = previous?.startedAt ?? now
  const previousStarts = new Map(previous?.marks.map(mark => [mark.id, mark.startsAt]))
  const structure = drawing.marks.filter(mark => !isDrawingDetail(mark.kind))
  const details = drawing.marks.filter(mark => isDrawingDetail(mark.kind))
  const stagger = (index: number, total: number) => Math.min(65, 220 / total) * index
  const spaces = structure.map((mark, index) => ({ ...mark, startsAt: previousStarts.get(mark.id) ?? now + stagger(index, structure.length) }))
  const spacesEnd = spaces.reduce((end, mark) => Math.max(end, mark.startsAt + FILL_DELAY_MS + FILL_MS), startedAt)
  const detailStart = Math.max(now, spacesEnd - 30, startedAt + 770)
  const ornaments = details.map((mark, index) => ({ ...mark, startsAt: previousStarts.get(mark.id) ?? detailStart + stagger(index, details.length) }))
  const endsAt = ornaments.reduce((end, mark) => Math.max(end, mark.startsAt + DETAIL_MS), spacesEnd)
  return {
    token: previous?.token ?? {}, drawing, origin: previous?.origin ?? origin ?? drawing.bounds,
    startedAt, endsAt, marks: [...spaces, ...ornaments],
  }
}
