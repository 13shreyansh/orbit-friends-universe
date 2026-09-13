import { useEffect, useMemo } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

export const DEFAULT_PASSENGER_ASSET_URL = '/orbit-friends-universe/models/sc-cute-ip.glb'
const passengerCloneCache = new WeakMap<THREE.Object3D, THREE.Object3D>()

function clonePassengerOnce(scene: THREE.Object3D): THREE.Object3D {
  const cached = passengerCloneCache.get(scene)
  if (cached) return cached
  const clone = scene.clone(true)
  passengerCloneCache.set(scene, clone)
  return clone
}

interface CometPassengerProps {
  assetUrl?: string
  position?: THREE.Vector3 | [number, number, number]
}

export function CometPassenger({
  assetUrl = DEFAULT_PASSENGER_ASSET_URL,
  position = [-0.14, 0.72, 0],
}: CometPassengerProps) {
  const { scene } = useGLTF(assetUrl)
  const passenger = useMemo(() => clonePassengerOnce(scene), [scene])
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    const maximum = Math.max(size.x, size.y, size.z) || 1
    return { center, scale: 1.25 / maximum }
  }, [scene])

  useEffect(() => {
    passenger.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
    })
  }, [passenger])

  return (
    <group position={position} rotation={[0, 0, -0.12]} scale={fit.scale}>
      <primitive
        object={passenger}
        position={[-fit.center.x, -fit.center.y, -fit.center.z]}
      />
    </group>
  )
}

useGLTF.preload(DEFAULT_PASSENGER_ASSET_URL)
