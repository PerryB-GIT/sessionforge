interface LogoProps {
  size?: number
}

export function Logo({ size = 32 }: LogoProps) {
  const radius = Math.round(size * 0.22)

  // Lightning bolt points scaled to size
  // Original design in a 32x32 box: 18,4 10,18 15,18 14,28 22,14 17,14
  const scale = size / 32
  const boltPoints = [
    [18, 4],
    [10, 18],
    [15, 18],
    [14, 28],
    [22, 14],
    [17, 14],
  ]
    .map(([x, y]) => `${x * scale},${y * scale}`)
    .join(' ')

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="SessionForge"
    >
      <rect width={size} height={size} rx={radius} fill="#8B5CF6" />
      <polygon points={boltPoints} fill="white" />
    </svg>
  )
}
