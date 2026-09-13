import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { MemoryBookControls } from './components/MemoryBookControls'
import { MemoryPage } from './components/MemoryPage'
import { PageTurnAnimation } from './components/PageTurnAnimation'
import type {
  BookState,
  MemoryBookStage,
  MemoryPage as MemoryPageData,
  PageDirection,
} from './types'

export type { MemoryBookStage } from './types'

interface MemoryBookProps {
  stage: MemoryBookStage
  planetRadius: number
  pages: MemoryPageData[]
  onOpened: () => void
  onPageTurnStart: () => void
  onPageTurnComplete: () => void
  onAddMemory?: () => void
  friendName?: string
}

const OPENING_DURATION = 3
const PAGE_WIDTH = 0.86
const PAGE_HEIGHT = 1.18
const PAGE_ROOT_OVERLAP = 0.055
const PAGE_PANEL_WIDTH = PAGE_WIDTH + PAGE_ROOT_OVERLAP
const LEFT_PANEL_CENTER = -PAGE_WIDTH / 2 + PAGE_ROOT_OVERLAP / 2
const RIGHT_PANEL_CENTER = PAGE_WIDTH / 2 - PAGE_ROOT_OVERLAP / 2
const PAGE_FRONT_DEPTH = 0.045
const PAGE_STACK_DEPTH = 0.022
const COVER_DEPTH = 0.038

function smoothStep(value: number) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1)
  return clamped * clamped * (3 - 2 * clamped)
}

export function MemoryBook({
  stage,
  planetRadius,
  pages,
  onOpened,
  onPageTurnStart,
  onPageTurnComplete,
  onAddMemory,
  friendName,
}: MemoryBookProps) {
  const bookRef = useRef<THREE.Group>(null)
  const leftPageRef = useRef<THREE.Group>(null)
  const rightPageRef = useRef<THREE.Group>(null)
  const leftMaterialRef = useRef<THREE.MeshStandardMaterial>(null)
  const rightMaterialRef = useRef<THREE.MeshStandardMaterial>(null)
  const leftCoverMaterialRef = useRef<THREE.MeshStandardMaterial>(null)
  const rightCoverMaterialRef = useRef<THREE.MeshStandardMaterial>(null)
  const spineMaterialRef = useRef<THREE.MeshStandardMaterial>(null)
  const dustMaterialRef = useRef<THREE.PointsMaterial>(null)
  const dustRef = useRef<THREE.Points>(null)
  const auraRef = useRef<THREE.Group>(null)
  const violetLightRef = useRef<THREE.PointLight>(null)
  const warmLightRef = useRef<THREE.PointLight>(null)
  const leftShadowRef = useRef<THREE.MeshBasicMaterial>(null)
  const rightShadowRef = useRef<THREE.MeshBasicMaterial>(null)
  const elapsedRef = useRef(0)
  const openedSentRef = useRef(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [bookState, setBookState] = useState<BookState>('opened')
  const [pageDirection, setPageDirection] = useState<PageDirection | null>(null)
  const { size } = useThree()
  const narrow = size.width < 700
  const leftPage = pages[currentPage] ?? null
  const rightPage = pages[currentPage + 1] ?? null
  const activeVideoId = rightPage?.type === 'video'
    ? rightPage.id
    : leftPage?.type === 'video'
      ? leftPage.id
      : null
  const canPrevious = currentPage > 0
  const canNext = currentPage + 2 < pages.length
  const chapterLabel = currentPage === 0
    ? 'Where our story begins'
    : currentPage + 2 >= pages.length
      ? 'To be continued'
      : 'The moments that stayed'

  const dustPositions = useMemo(() => {
    const positions = new Float32Array(32 * 3)
    for (let index = 0; index < 32; index += 1) {
      const angle = index * 2.39996
      const radius = 0.68 + ((index * 17) % 13) * 0.05
      positions[index * 3] = Math.cos(angle) * radius
      positions[index * 3 + 1] = Math.sin(angle) * radius * 0.72
      positions[index * 3 + 2] = ((index * 23) % 17) * 0.024 - 0.15
    }
    return positions
  }, [])

  useEffect(() => {
    if (stage !== 'opening') return
    elapsedRef.current = 0
    openedSentRef.current = false
    setCurrentPage(0)
    setBookState('opened')
    setPageDirection(null)
  }, [stage])

  const requestPageTurn = useCallback((direction: PageDirection, remote = false) => {
    if (bookState === 'turning') return
    if (direction === 'previous' ? !canPrevious : !canNext) return
    if (!remote) window.dispatchEvent(new CustomEvent('orbit-local-page', { detail: { page: currentPage + (direction === 'previous' ? -2 : 2) } }))
    setBookState('turning')
    setPageDirection(direction)
    onPageTurnStart()
  }, [bookState, canNext, canPrevious, currentPage, onPageTurnStart])

  useEffect(() => {
    const sharedPage = (event: Event) => {
      const page = (event as CustomEvent<{page:number}>).detail.page
      if (stage === 'opening' || bookState === 'turning' || page === currentPage || !Number.isInteger(page) || page < 0 || page >= pages.length) return
      if (Math.abs(page - currentPage) === 2) requestPageTurn(page > currentPage ? 'next' : 'previous', true)
      else setCurrentPage(page)
    }
    window.addEventListener('orbit-shared-page', sharedPage)
    return () => window.removeEventListener('orbit-shared-page', sharedPage)
  }, [bookState, currentPage, pages.length, requestPageTurn, stage])

  const completePageTurn = useCallback(() => {
    setCurrentPage((value) => pageDirection === 'previous'
      ? Math.max(0, value - 2)
      : Math.min(Math.max(0, pages.length - 1), value + 2))
    setBookState('opened')
    setPageDirection(null)
    onPageTurnComplete()
  }, [onPageTurnComplete, pageDirection, pages.length])

  useFrame((state, delta) => {
    const book = bookRef.current
    const leftPage = leftPageRef.current
    const rightPage = rightPageRef.current
    if (!book || !leftPage || !rightPage) return

    if (stage === 'opening') elapsedRef.current = Math.min(OPENING_DURATION, elapsedRef.current + delta)
    else elapsedRef.current = OPENING_DURATION

    const elapsed = elapsedRef.current
    const reveal = smoothStep(elapsed / 0.5)
    const rise = smoothStep((elapsed - 0.5) / 1.5)
    const unfold = smoothStep((elapsed - 2) / 1)
    const floatOffset = elapsed >= OPENING_DURATION
      ? Math.sin(state.clock.elapsedTime * (Math.PI * 2 / 5.2)) * 0.055
      : 0

    const sceneScale = (narrow ? 1.04 : 1.32) * THREE.MathUtils.clamp(planetRadius, 0.82, 1.22)
    const baseX = 0
    const baseY = narrow ? planetRadius * 0.08 : planetRadius * 0.12
    const baseZ = planetRadius * 2.35

    book.position.set(baseX, baseY - 0.36 + rise * 0.36 + floatOffset, baseZ)
    book.scale.setScalar(sceneScale * THREE.MathUtils.lerp(0.8, 1, reveal))
    book.rotation.set(-0.065, narrow ? -0.025 : -0.045, 0.012 + floatOffset * 0.06)
    const breath = (Math.sin(state.clock.elapsedTime * 0.72) + 1) * 0.5
    if (dustRef.current) {
      dustRef.current.rotation.z = state.clock.elapsedTime * 0.025
      dustRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.48) * 0.025
    }
    if (auraRef.current) auraRef.current.rotation.z = -state.clock.elapsedTime * 0.012
    if (violetLightRef.current) violetLightRef.current.intensity = reveal * (0.2 + breath * 0.08)
    if (warmLightRef.current) warmLightRef.current.intensity = reveal * (0.3 + breath * 0.1)

    if (bookState !== 'turning') {
      leftPage.rotation.y = THREE.MathUtils.lerp(1.08, 0.075, unfold)
      rightPage.rotation.y = THREE.MathUtils.lerp(-1.08, -0.075, unfold)
    }

    const materials = [
      leftMaterialRef.current,
      rightMaterialRef.current,
      leftCoverMaterialRef.current,
      rightCoverMaterialRef.current,
      spineMaterialRef.current,
    ]
    for (const material of materials) {
      if (material) material.opacity = reveal
    }
    if (dustMaterialRef.current) dustMaterialRef.current.opacity = reveal * (0.22 + breath * 0.1)

    if (elapsed >= OPENING_DURATION && !openedSentRef.current) {
      openedSentRef.current = true
      onOpened()
    }
  })

  return (
    <group ref={bookRef} name="memory-book">
      <pointLight
        ref={warmLightRef}
        position={[0, 0.08, 0.48]}
        color="#dba47e"
        intensity={0.35}
        distance={3.2}
        decay={2}
      />
      <pointLight
        ref={violetLightRef}
        position={[0, 0.2, -0.18]}
        color="#8174bd"
        intensity={0.24}
        distance={3.6}
        decay={2}
      />

      <group ref={auraRef} position={[0, 0, -0.105]} name="memory-book-aura">
        <mesh scale={[1.12, 0.76, 1]}>
          <ringGeometry args={[0.91, 1.06, 64]} />
          <meshBasicMaterial
            color="#7469ad"
            transparent
            opacity={0.055}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh rotation={[0, 0, 0.45]} scale={[1.01, 0.71, 1]}>
          <ringGeometry args={[0.96, 1.01, 64]} />
          <meshBasicMaterial
            color="#d4a47f"
            transparent
            opacity={0.045}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      <group ref={leftPageRef} name="memory-book-left-hinge">
        <mesh name="memory-book-left-cover" position={[LEFT_PANEL_CENTER - 0.007, 0, -0.054]}>
          <boxGeometry args={[PAGE_PANEL_WIDTH + 0.028, PAGE_HEIGHT * 1.045, COVER_DEPTH]} />
          <meshStandardMaterial
            ref={leftCoverMaterialRef}
            color="#090b22"
            emissive="#211937"
            emissiveIntensity={0.32}
            metalness={0.48}
            roughness={0.46}
            transparent
          />
        </mesh>
        <mesh name="memory-book-left-page-stack" position={[LEFT_PANEL_CENTER, 0, -0.029]}>
          <boxGeometry args={[PAGE_PANEL_WIDTH, PAGE_HEIGHT * 1.005, PAGE_STACK_DEPTH]} />
          <meshStandardMaterial
            color="#77768a"
            emissive="#29243a"
            emissiveIntensity={0.12}
            metalness={0.08}
            roughness={0.82}
          />
        </mesh>
        <mesh name="memory-book-left-page-surface" position={[LEFT_PANEL_CENTER, 0, 0]}>
          <boxGeometry args={[PAGE_PANEL_WIDTH, PAGE_HEIGHT, PAGE_FRONT_DEPTH]} />
          <meshStandardMaterial
            ref={leftMaterialRef}
            color="#15172f"
            emissive="#372746"
            emissiveIntensity={0.24}
            metalness={0.26}
            roughness={0.56}
            transparent
          />
        </mesh>
        <mesh name="memory-book-left-gutter-shadow" position={[-0.036, 0, 0.026]}>
          <planeGeometry args={[0.13, PAGE_HEIGHT * 0.95]} />
          <meshBasicMaterial
            ref={leftShadowRef}
            color="#02030c"
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
        <mesh name="memory-book-left-outer-edge" position={[-PAGE_WIDTH + 0.006, 0, -0.01]}>
          <boxGeometry args={[0.012, PAGE_HEIGHT * 0.985, 0.076]} />
          <meshBasicMaterial color="#c29976" transparent opacity={0.15} />
        </mesh>
        <mesh name="memory-book-left-top-edge" position={[-PAGE_WIDTH / 2, PAGE_HEIGHT / 2 - 0.004, -0.01]}>
          <boxGeometry args={[PAGE_WIDTH * 0.98, 0.009, 0.076]} />
          <meshBasicMaterial color="#c29976" transparent opacity={0.12} />
        </mesh>
        <mesh name="memory-book-left-bottom-edge" position={[-PAGE_WIDTH / 2, -PAGE_HEIGHT / 2 + 0.004, -0.01]}>
          <boxGeometry args={[PAGE_WIDTH * 0.98, 0.009, 0.076]} />
          <meshBasicMaterial color="#c29976" transparent opacity={0.1} />
        </mesh>
        {stage !== 'opening' && (
          <MemoryPage
            page={leftPage}
            side="left"
            pageWidth={PAGE_WIDTH}
            activeVideo={leftPage?.id === activeVideoId}
            turning={pageDirection}
            compact={narrow}
          />
        )}
      </group>

      <group ref={rightPageRef} name="memory-book-right-hinge">
        <mesh name="memory-book-right-cover" position={[RIGHT_PANEL_CENTER + 0.007, 0, -0.054]}>
          <boxGeometry args={[PAGE_PANEL_WIDTH + 0.028, PAGE_HEIGHT * 1.045, COVER_DEPTH]} />
          <meshStandardMaterial
            ref={rightCoverMaterialRef}
            color="#090b22"
            emissive="#211937"
            emissiveIntensity={0.32}
            metalness={0.48}
            roughness={0.46}
            transparent
          />
        </mesh>
        <mesh name="memory-book-right-page-stack" position={[RIGHT_PANEL_CENTER, 0, -0.029]}>
          <boxGeometry args={[PAGE_PANEL_WIDTH, PAGE_HEIGHT * 1.005, PAGE_STACK_DEPTH]} />
          <meshStandardMaterial
            color="#77768a"
            emissive="#29243a"
            emissiveIntensity={0.12}
            metalness={0.08}
            roughness={0.82}
          />
        </mesh>
        <mesh name="memory-book-right-page-surface" position={[RIGHT_PANEL_CENTER, 0, 0]}>
          <boxGeometry args={[PAGE_PANEL_WIDTH, PAGE_HEIGHT, PAGE_FRONT_DEPTH]} />
          <meshStandardMaterial
            ref={rightMaterialRef}
            color="#15172f"
            emissive="#372746"
            emissiveIntensity={0.24}
            metalness={0.26}
            roughness={0.56}
            transparent
          />
        </mesh>
        <mesh name="memory-book-right-gutter-shadow" position={[0.036, 0, 0.026]}>
          <planeGeometry args={[0.13, PAGE_HEIGHT * 0.95]} />
          <meshBasicMaterial
            ref={rightShadowRef}
            color="#02030c"
            transparent
            opacity={0}
            depthWrite={false}
          />
        </mesh>
        <mesh name="memory-book-right-outer-edge" position={[PAGE_WIDTH - 0.006, 0, -0.01]}>
          <boxGeometry args={[0.012, PAGE_HEIGHT * 0.985, 0.076]} />
          <meshBasicMaterial color="#c29976" transparent opacity={0.15} />
        </mesh>
        <mesh name="memory-book-right-top-edge" position={[PAGE_WIDTH / 2, PAGE_HEIGHT / 2 - 0.004, -0.01]}>
          <boxGeometry args={[PAGE_WIDTH * 0.98, 0.009, 0.076]} />
          <meshBasicMaterial color="#c29976" transparent opacity={0.12} />
        </mesh>
        <mesh name="memory-book-right-bottom-edge" position={[PAGE_WIDTH / 2, -PAGE_HEIGHT / 2 + 0.004, -0.01]}>
          <boxGeometry args={[PAGE_WIDTH * 0.98, 0.009, 0.076]} />
          <meshBasicMaterial color="#c29976" transparent opacity={0.1} />
        </mesh>
        {stage !== 'opening' && (
          <MemoryPage
            page={rightPage}
            side="right"
            pageWidth={PAGE_WIDTH}
            activeVideo={rightPage?.id === activeVideoId}
            turning={pageDirection}
            compact={narrow}
          />
        )}
      </group>

      <mesh name="memory-book-spine" position={[0, 0, -0.012]}>
        <capsuleGeometry args={[0.047, PAGE_HEIGHT * 0.89, 5, 12]} />
        <meshStandardMaterial
          ref={spineMaterialRef}
          color="#9a7452"
          emissive="#bd8a61"
          emissiveIntensity={0.5}
          metalness={0.64}
          roughness={0.34}
          transparent
        />
      </mesh>
      <mesh name="memory-book-spine-top-collar" position={[0, PAGE_HEIGHT * 0.472, -0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.049, 0.009, 6, 18]} />
        <meshStandardMaterial
          color="#9a7452"
          emissive="#bd8a61"
          emissiveIntensity={0.34}
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>
      <mesh name="memory-book-spine-bottom-collar" position={[0, -PAGE_HEIGHT * 0.472, -0.012]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.049, 0.009, 6, 18]} />
        <meshStandardMaterial
          color="#9a7452"
          emissive="#bd8a61"
          emissiveIntensity={0.34}
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>

      <points ref={dustRef} name="memory-book-stardust">
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dustPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={dustMaterialRef}
          color="#e7c1a1"
          size={0.025}
          sizeAttenuation
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <PageTurnAnimation
        direction={pageDirection}
        leftPageRef={leftPageRef}
        rightPageRef={rightPageRef}
        leftShadowRef={leftShadowRef}
        rightShadowRef={rightShadowRef}
        onComplete={completePageTurn}
      />

      {stage !== 'opening' && (
        <Html
          center
          position={[0, -PAGE_HEIGHT * 0.53, 0.12]}
          zIndexRange={[30, 20]}
          style={{ pointerEvents: 'auto' }}
        >
          <MemoryBookControls
            currentPage={currentPage}
            totalPages={pages.length}
            chapterLabel={chapterLabel}
            disabled={bookState === 'turning'}
            canPrevious={canPrevious}
            canNext={canNext}
            onTurn={requestPageTurn}
            onAddMemory={onAddMemory}
            friendName={friendName}
          />
        </Html>
      )}
    </group>
  )
}
