import type { CSSProperties } from 'react'

export const memoryFrameConfig = {
  borderGlowIntensity: 0.46,
  floatingSpeedSeconds: 7,
  borderRadiusPx: 22,
  backgroundOpacity: 0.64,
  blurAmountPx: 10,
  floatDistancePx: 5,
  tiltDegrees: 0.55,
} as const

export type MemoryFrameStyle = CSSProperties & {
  '--memory-frame-glow': number
  '--memory-frame-float-speed': string
  '--memory-frame-radius': string
  '--memory-frame-background-opacity': number
  '--memory-frame-blur': string
  '--memory-frame-float-distance': string
  '--memory-frame-tilt': string
}

export function getMemoryFrameStyle(): MemoryFrameStyle {
  return {
    '--memory-frame-glow': memoryFrameConfig.borderGlowIntensity,
    '--memory-frame-float-speed': `${memoryFrameConfig.floatingSpeedSeconds}s`,
    '--memory-frame-radius': `${memoryFrameConfig.borderRadiusPx}px`,
    '--memory-frame-background-opacity': memoryFrameConfig.backgroundOpacity,
    '--memory-frame-blur': `${memoryFrameConfig.blurAmountPx}px`,
    '--memory-frame-float-distance': `${memoryFrameConfig.floatDistancePx}px`,
    '--memory-frame-tilt': `${memoryFrameConfig.tiltDegrees}deg`,
  }
}
