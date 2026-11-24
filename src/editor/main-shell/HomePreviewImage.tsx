import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'

export default function HomePreviewImage({ src, ...props }: ComponentPropsWithoutRef<'img'>) {
  const image = useRef<HTMLImageElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (visible || !image.current) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setVisible(true)
    })
    observer.observe(image.current)
    return () => observer.disconnect()
  }, [visible])
  return <img fetchPriority="low" {...props} ref={image} src={visible ? src : undefined}/>
}
