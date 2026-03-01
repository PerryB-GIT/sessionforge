'use client'

import { useEffect, useRef } from 'react'

interface AsciinemaPlayerLoaderProps {
  url: string
}

export function AsciinemaPlayerLoader({ url }: AsciinemaPlayerLoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let player: { dispose?: () => void } | null = null
    let cancelled = false

    import('asciinema-player').then(({ create }) => {
      if (cancelled || !containerRef.current) return
      player = create(url, containerRef.current, {
        theme: 'monokai',
        autoPlay: false,
        loop: false,
      })
    })

    return () => {
      cancelled = true
      player?.dispose?.()
    }
  }, [url])

  return <div ref={containerRef} />
}
