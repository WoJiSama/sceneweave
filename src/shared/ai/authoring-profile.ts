import { z } from 'zod'
import { AuthoringScopeSchema, AuthoringStartSchema, SceneAuthoringScopeSchema } from './authoring-protocol-v1.js'
const id = z.string().min(1).max(256).refine(value => value !== '__proto__')
const ids = (limit: number) => z.array(id).max(limit).refine(values => new Set(values).size === values.length)
/** Explicit counting-2 grant envelope. It does not change the legacy schemas. */
export const ProfiledSceneAuthoringScopeSchema = SceneAuthoringScopeSchema.extend({ entityIds: ids(8192) }).strict()
export const ProfiledAuthoringScopeSchema = AuthoringScopeSchema.extend({ targetIds: ids(2048),
  scene: ProfiledSceneAuthoringScopeSchema.nullable().optional() }).strict()
export const ProfiledLegacyStartSchema = AuthoringStartSchema.extend({ scope: ProfiledAuthoringScopeSchema }).strict()
