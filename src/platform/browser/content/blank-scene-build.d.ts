declare module 'virtual:sceneweave-blank-scene' {
  const archive: { url: string; bytes: number; sha256: string }
  export default archive
  export const development: { project: import('../../../shared/model/project').ProjectData; paths: Record<string, string> }
}

declare module 'virtual:sceneweave-starter-catalog' {
  const catalog: { project: import('../../../shared/model/project').ProjectData; paths: Record<string, string> }
  export default catalog
}

declare module 'virtual:sceneweave-fixed-downloads' {
  const manifest: import('./fixed-download-manifest').FixedDownloadManifest
  export default manifest
}
