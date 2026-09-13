export function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.35} color="#8fa8ff" />
      <directionalLight
        position={[4, 3, 5]}
        intensity={1.1}
        color="#cfe0ff"
      />
      <pointLight position={[-6, -2, -4]} intensity={0.4} color="#5b6bff" />
    </>
  )
}
