'use client'

import { useEffect } from 'react'

interface AsciinemaPlayerLoaderProps {
  url: string
}

export function AsciinemaPlayerLoader({ url }: AsciinemaPlayerLoaderProps) {
  useEffect(() => {
    let player: { dispose?: () => void } | null = null

    import('asciinema-player').then(({ create }) => {
      const container = document.getElementById('asciinema-player-container')
      if (!container) return
      player = create(url, container, {
        theme: 'monokai',
        autoPlay: false,
        loop: false,
      })
    })

    return () => {
      player?.dispose?.()
    }
  }, [url])

  return <div id="asciinema-player-container" />
}
