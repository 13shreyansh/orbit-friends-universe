import { Canvas } from '@react-three/fiber'
import type { ReactNode } from 'react'
import { useSceneStore } from '../../store/useSceneStore'
import { isLowPerformanceDevice } from '../../utils/performance'

interface CosmosCanvasProps {
  children: ReactNode
}

export function CosmosCanvas({ children }: CosmosCanvasProps) {
  const setReady = useSceneStore((state) => state.setReady)
  const navigateBack = useSceneStore((state) => state.navigateBack)

  return (
    <Canvas
      style={{ position: 'fixed', inset: 0 }}
      dpr={isLowPerformanceDevice ? [1, 1] : [1, 2]}
      gl={{ antialias: !isLowPerformanceDevice, powerPreference: 'high-performance' }}
      camera={{ position: [0, 4, 14], fov: 50, near: 0.1, far: 100 }}
      onCreated={() => setReady()}
      onPointerMissed={() => navigateBack()}
    >
      {children}
    </Canvas>
  )
}
