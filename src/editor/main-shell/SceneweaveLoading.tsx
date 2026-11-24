export default function SceneweaveLoading({ label, fullScreen = false }: { label: string; fullScreen?: boolean }) {
  return <div className={fullScreen ? 'sceneweave-loading sceneweave-loading-screen' : 'sceneweave-loading'} role="status">
    <span className="sceneweave-loading-mark" aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={64} height={64}/>
    </span>
    <span className="sceneweave-loading-label">{label}</span>
  </div>
}
