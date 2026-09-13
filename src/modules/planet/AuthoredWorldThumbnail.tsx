import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { AuthoredWorldModel } from './AuthoredWorldModel'

interface AuthoredWorldThumbnailProps {
  assetUrl: string
  className?: string
}

function ThumbnailScene({ assetUrl }: Pick<AuthoredWorldThumbnailProps, 'assetUrl'>) {
  return (
    <>
      <ambientLight intensity={0.9} color="#b8d6ff" />
      <directionalLight position={[-3, 4, 5]} intensity={2.8} color="#fff0df" />
      <directionalLight position={[4, -1, -3]} intensity={1.1} color="#8ebcff" />
      <group rotation={[-0.08, -0.34, 0]}>
        <AuthoredWorldModel assetUrl={assetUrl} radius={1} />
      </group>
    </>
  )
}

export function AuthoredWorldThumbnail({ assetUrl, className }: AuthoredWorldThumbnailProps) {
  const hostRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '120px' },
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return (
    <span ref={hostRef} className={className} aria-hidden="true">
      {visible && (
        <Canvas
          frameloop="demand"
          camera={{ position: [0, 0.28, 4.25], fov: 34 }}
          dpr={[1, 1.25]}
          gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
        >
          <Suspense fallback={null}>
            <ThumbnailScene assetUrl={assetUrl} />
          </Suspense>
        </Canvas>
      )}
    </span>
  )
}
