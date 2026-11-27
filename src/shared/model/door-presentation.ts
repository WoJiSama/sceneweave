import { z } from 'zod'

/** Presentation of an open door, relative to the saved opening direction. */
export const doorPresentationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['single', 'double']), side: z.enum(['left', 'right']) }).strict(),
  z.object({ kind: z.literal('frame') }).strict(),
])
export type DoorPresentation = z.infer<typeof doorPresentationSchema>
export const WIDE_DOOR_MM = 1200
export function wideDoorPresentation(kind: 'door' | 'window', widthMm: number): DoorPresentation | undefined {
  return kind === 'door' && widthMm > WIDE_DOOR_MM ? { kind: 'double', side: 'left' } : undefined
}
