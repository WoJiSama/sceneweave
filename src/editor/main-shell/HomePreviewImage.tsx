import { createContext, useContext, useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'

export const HomePreviewsPaused = createContext(false)

export default function HomePreviewImage({ src, onLoad, ...props }: ComponentPropsWithoutRef<'img'>) {
  const image = useRef<HTMLImageElement>(null)
  const [loadedSrc, setLoadedSrc] = useState<string>()
  const paused = useContext(HomePreviewsPaused)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (paused) {
      setVisible(false)
      return
    }
    if (visible || !image.current) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true)
    })
    observer.observe(image.current)
    return () => observer.disconnect()
  }, [visible, paused])
  // Clearing an unfinished image source releases its connection while the dialog is open.
  const displaySrc = loadedSrc === src || (visible && !paused) ? src : undefined
  return <img fetchPriority="low" {...props} ref={image} src={displaySrc}
    onLoad={event => { setLoadedSrc(event.currentTarget.getAttribute('src') ?? undefined); onLoad?.(event) }}/>
}
