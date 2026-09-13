import { Html } from '@react-three/drei'
import type { CSSProperties } from 'react'

interface HoverLabelProps {
  name: string
  color: string
  radius: number
}

const labelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  whiteSpace: 'nowrap',
  padding: '4px 10px',
  fontSize: '11px',
  fontWeight: 500,
  letterSpacing: '0.03em',
  color: 'rgba(255, 255, 255, 0.92)',
  background: 'rgba(6, 8, 20, 0.75)',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  borderRadius: '999px',
}

export function HoverLabel({ name, color, radius }: HoverLabelProps) {
  return (
    <Html position={[0, radius + 0.3, 0]} center style={{ pointerEvents: 'none' }}>
      <div style={labelStyle}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: color,
            flexShrink: 0,
          }}
        />
        {name}
      </div>
    </Html>
  )
}
