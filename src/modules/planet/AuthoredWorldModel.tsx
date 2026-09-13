import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

interface AuthoredWorldModelProps {
  assetUrl: string
  radius?: number
}

export function AuthoredWorldModel({ assetUrl, radius = 1 }: AuthoredWorldModelProps) {
  const { scene } = useGLTF(assetUrl)
  const instance = useMemo(() => scene.clone(true), [scene])
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maximum = Math.max(size.x, size.y, size.z) || 1
    return { center, scale: (radius * 2) / maximum }
  }, [radius, scene])

  useEffect(() => {
    instance.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
    })
  }, [instance])

  return (
    <group scale={fit.scale}>
      <primitive object={instance} position={[-fit.center.x, -fit.center.y, -fit.center.z]} />
    </group>
  )
}
