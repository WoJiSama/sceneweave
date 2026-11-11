import { z } from 'zod'

/** Opaque six-digit RGB only: arbitrary CSS and alpha-bearing colors are not persisted. */
export const sceneOutputBackgroundSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('solid'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '背景颜色必须为六位十六进制 RGB，例如 #F4F0E5。') }).strict(),
  z.object({ mode: z.literal('transparent') }).strict(),
])
